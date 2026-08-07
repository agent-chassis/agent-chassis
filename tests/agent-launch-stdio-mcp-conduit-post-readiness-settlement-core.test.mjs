import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  STDIO_MCP_CONDUIT_ERROR_CODES
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";
import { __testing } from
  "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs";

function createLifecycle(role = "worker") {
  const child = new EventEmitter();
  const ready = new PassThrough();
  child.stdio = [null, null, null, ready];
  const lifecycle = __testing.observeConduitLifecycle({
    child,
    role,
    serverStartupTimeoutMs: 5_000,
    clientReadinessTimeoutMs: 5_000,
    expectedToolNames: ["commit"]
  });
  const emit = (event) => ready.write(`${JSON.stringify(event)}\n`);
  return { child, lifecycle, emit, ready };
}

async function reachReadiness(fixture) {
  fixture.emit({
    schema_version: "wiki-mcp-launcher-readiness.v2",
    lifecycle_protocol_generation: "stdio-mcp-conduit-lifecycle-vocabulary.v1",
    ready: true,
    tools: ["commit"]
  });
  fixture.lifecycle.beginClientReadiness();
  fixture.emit({
    schema_version: "wiki-mcp-launcher-client-initialized.v1",
    initialized: true
  });
  fixture.emit({
    schema_version: "wiki-mcp-launcher-tools-listed.v1",
    tools_listed: true,
    tools: ["commit"]
  });
  await fixture.lifecycle.clientReady;
}

test("WK-1745 SLICE-005: post-readiness typed failures settle exactly once", async (t) => {
  const cases = [
    {
      name: "client restarted",
      code: STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_RELAY_RESTARTED,
      fail({ emit }) {
        emit({
          schema_version: "wiki-mcp-launcher-client-restarted.v1",
          restarted: true,
          restart_count: 1
        });
      }
    },
    {
      name: "duplicate tools/list",
      code: STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
      fail({ emit }) {
        emit({
          schema_version: "wiki-mcp-launcher-tools-listed.v1",
          tools_listed: true,
          tools: ["unexpected"]
        });
      }
    },
    {
      name: "malformed event",
      code: STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_READINESS_FAILED,
      fail({ ready }) { ready.write("{not-json}\n"); }
    },
    {
      name: "server failure",
      code: STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_EXIT,
      fail({ child }) { child.emit("exit", 7, null); }
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const fixture = createLifecycle();
      await reachReadiness(fixture);
      const settlement = fixture.lifecycle.failureSettlement;
      assert.equal(settlement, fixture.lifecycle.failureSettlement,
        "the failure channel is memoized");

      scenario.fail(fixture);
      const first = await settlement;
      assert.equal(first.code, scenario.code);
      assert.equal(fixture.lifecycle.currentFailure(), first);
      assert.doesNotReject(fixture.lifecycle.clientReady,
        "late failure must not rewrite resolved readiness");

      fixture.emit({ schema_version: "invalid-duplicate" });
      fixture.child.emit("close", 9, "SIGKILL");
      assert.equal(await fixture.lifecycle.failureSettlement, first,
        "duplicate events retain the first initiating typed failure");
      fixture.ready.destroy();
    });
  }
});
