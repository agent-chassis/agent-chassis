

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_LIFECYCLE_FAILURE_REASONS,
  STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
  STDIO_MCP_LIFECYCLE_VALIDATION_RULES
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";
import {
  __testing as conduitCoreTesting
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs";
import {
  buildOrchestratorStdioMcpDiagnostic,
  renderOrchestratorStdioMcpDiagnostic
} from "../../packages/agent-launch-cli/src/lib/orchestrator-launch-runtime.mjs";
import {
  LAUNCHER_READINESS_SCHEMA_VERSIONS,
  createLauncherObservingTransport
} from "../../packages/wiki-mcp/src/lib/launcher-readiness-observer.mjs";

const { observeConduitLifecycle } = conduitCoreTesting;

function createLifecycle({ role = "reviewer", tools = ["commit"], clientMs = 5_000 } = {}) {
  const child = new EventEmitter();
  const ready = new PassThrough();
  child.stdio = [null, null, null, ready];
  const lifecycle = observeConduitLifecycle({
    child,
    role,
    serverStartupTimeoutMs: 5_000,
    clientReadinessTimeoutMs: clientMs,
    expectedToolNames: tools
  });
  lifecycle.serverReady.catch(() => {});
  lifecycle.clientReady.catch(() => {});
  return {
    child,
    ready,
    lifecycle,
    emit: (event) => ready.write(`${JSON.stringify(event)}\n`),
    close: () => ready.destroy()
  };
}

function registration(tools = ["commit"]) {
  return {
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.SERVER_READY,
    lifecycle_protocol_generation: STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
    ready: true,
    tools
  };
}

async function afterRegistration(fixture) {
  fixture.emit(registration());
  await fixture.lifecycle.serverReady;
  fixture.lifecycle.beginClientReadiness();
  return fixture;
}

async function reachReadiness(fixture) {
  await afterRegistration(fixture);
  fixture.emit({
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_INITIALIZED,
    initialized: true
  });
  fixture.emit({
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.TOOLS_LISTED,
    tools_listed: true,
    tools: ["commit"]
  });
  await fixture.lifecycle.clientReady;
  return fixture;
}

function observeGeneration(drive, { error = null, closeIt = true } = {}) {
  const events = [];
  const inner = {
    sessionId: "generation",
    async start() {},
    async send(message) { inner.sent.push(message); },
    async close() {},
    sent: [],
    deliver(message) { inner.onmessage?.(message, {}); }
  };
  const transport = createLauncherObservingTransport(inner, {
    emit: (event) => events.push(event)
  });
  transport.onmessage = () => {};
  transport.onclose = () => {};
  transport.onerror = () => {};
  drive({ inner, transport });
  if (error !== null) inner.onerror?.(error);
  if (closeIt) inner.onclose();
  return events;
}

const PROBE_REQUEST = Object.freeze({
  jsonrpc: "2.0", id: "probe-1", method: "server/discover", params: {}
});

test("WK-2040: the exact discovery probe hands readiness to a real initialize and tools/list",
  async () => {
    const [probeClose, ...rest] = observeGeneration(({ inner }) => {
      inner.deliver(PROBE_REQUEST);
    });
    assert.deepEqual(rest, []);
    assert.deepEqual(probeClose, {
      schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_DISCOVERY_PROBE_CLOSED,
      closed: true,
      discovery_probe: true
    });

    const probe = await afterRegistration(createLifecycle());
    probe.emit(probeClose);
    assert.deepEqual(await probe.lifecycle.discoveryProbeClosed, { discoveryProbe: true });
    assert.equal(probe.lifecycle.currentFailure(), null);
    assert.equal(probe.lifecycle.isClientReady(), false);
    assert.equal(probe.lifecycle.currentPhase(), "terminal");
    probe.close();

    const real = await reachReadiness(createLifecycle());
    assert.equal(real.lifecycle.isClientReady(), true);
    assert.equal(real.lifecycle.currentPhase(), "ready");
    assert.equal(real.lifecycle.currentFailure(), null);
    real.close();
  });

test("WK-2040: an ordinary pre-initialize close still fails closed", async () => {
  const [ordinary] = observeGeneration(() => {});
  assert.deepEqual(ordinary, {
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
    closed: true
  });
  const fixture = await afterRegistration(createLifecycle());
  fixture.emit(ordinary);
  const failure = await fixture.lifecycle.failureSettlement;
  assert.equal(failure.code, STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED);
  assert.equal(failure.detail.lifecycle_reason,
    STDIO_MCP_LIFECYCLE_FAILURE_REASONS.CLIENT_CLOSED_BEFORE_READINESS);
  assert.equal(failure.detail.lifecycle_validation_rule,
    STDIO_MCP_LIFECYCLE_VALIDATION_RULES.PHASE_NOT_PERMITTED);
  fixture.close();
});

test("WK-2040: an abrupt or errored discovery connection is never reported as a probe",
  async (t) => {
    const cases = [
      ["transport error after the probe request", { error: new Error("reset") }],
      ["probe request that later initializes", {
        drive: ({ inner }) => {
          inner.deliver(PROBE_REQUEST);
          inner.deliver({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
        }
      }],
      ["server/discover after initialize", {
        drive: ({ inner }) => {
          inner.deliver({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
          inner.deliver({ ...PROBE_REQUEST, id: 2 });
        }
      }],
      ["non-request server/discover notification", {
        drive: ({ inner }) => {
          inner.deliver({ jsonrpc: "2.0", method: "server/discover", params: {} });
        }
      }]
    ];
    for (const [name, { drive = ({ inner }) => inner.deliver(PROBE_REQUEST), error = null }]
      of cases) {
      await t.test(name, async () => {
        const events = observeGeneration(drive, { error });
        const close = events.at(-1);
        assert.equal(close.schema_version, LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED);
        assert.equal(Object.prototype.hasOwnProperty.call(close, "discovery_probe"), false);
      });
    }
  });

test("WK-2040: malformed and extra-field client-close evidence fails closed with its rule",
  async (t) => {
    const cases = [

      ["discovery_probe on the ordinary close", {
        schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
        closed: true,
        discovery_probe: true
      }, STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_CLOSED,
      STDIO_MCP_LIFECYCLE_VALIDATION_RULES.UNPERMITTED_EVENT_KEY],
      ["arbitrary extra key", {
        schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
        closed: true,
        operator_note: "anything"
      }, STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_CLOSED,
      STDIO_MCP_LIFECYCLE_VALIDATION_RULES.UNPERMITTED_EVENT_KEY],
      ["missing closed", {
        schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED
      }, STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_CLOSED,
      STDIO_MCP_LIFECYCLE_VALIDATION_RULES.MISSING_REQUIRED_EVENT_KEY],
      ["closed is not exactly true", {
        schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
        closed: "yes"
      }, STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_CLOSED,
      STDIO_MCP_LIFECYCLE_VALIDATION_RULES.FIELD_VALUE_NOT_EXACT],
      ["probe evidence missing its marker", {
        schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_DISCOVERY_PROBE_CLOSED,
        closed: true
      }, STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_DISCOVERY_PROBE_CLOSED,
      STDIO_MCP_LIFECYCLE_VALIDATION_RULES.MISSING_REQUIRED_EVENT_KEY],
      ["probe evidence with a false marker", {
        schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_DISCOVERY_PROBE_CLOSED,
        closed: true,
        discovery_probe: false
      }, STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_DISCOVERY_PROBE_CLOSED,
      STDIO_MCP_LIFECYCLE_VALIDATION_RULES.FIELD_VALUE_NOT_EXACT]
    ];
    for (const [name, event, reason, rule] of cases) {
      await t.test(name, async () => {
        const fixture = await afterRegistration(createLifecycle());
        fixture.emit(event);
        const failure = await fixture.lifecycle.failureSettlement;
        assert.equal(failure.code, STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED);
        assert.equal(failure.detail.lifecycle_reason, reason);
        assert.equal(failure.detail.lifecycle_validation_rule, rule);
        assert.equal(fixture.lifecycle.currentPhase(), "failed");
        fixture.close();
      });
    }
  });

test("WK-2040: a well-formed probe close outside the pre-initialize phase fails closed",
  async (t) => {
    const probeClose = {
      schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_DISCOVERY_PROBE_CLOSED,
      closed: true,
      discovery_probe: true
    };
    await t.test("after initialize", async () => {
      const fixture = await afterRegistration(createLifecycle());
      fixture.emit({
        schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_INITIALIZED,
        initialized: true
      });
      fixture.emit(probeClose);
      const failure = await fixture.lifecycle.failureSettlement;
      assert.equal(failure.detail.lifecycle_reason,
        STDIO_MCP_LIFECYCLE_FAILURE_REASONS.UNEXPECTED_CLIENT_DISCOVERY_PROBE_CLOSED);
      assert.equal(failure.detail.lifecycle_validation_rule,
        STDIO_MCP_LIFECYCLE_VALIDATION_RULES.PHASE_NOT_PERMITTED);
      fixture.close();
    });
    await t.test("after readiness", async () => {
      const fixture = await reachReadiness(createLifecycle());
      fixture.emit(probeClose);
      const failure = await fixture.lifecycle.failureSettlement;
      assert.equal(failure.detail.lifecycle_reason,
        STDIO_MCP_LIFECYCLE_FAILURE_REASONS.UNEXPECTED_CLIENT_DISCOVERY_PROBE_CLOSED);
      fixture.close();
    });
  });

test("WK-2040: every later lifecycle failure retains the negotiated generations",
  async (t) => {
    const cases = [
      ["client close before readiness", async (fixture) => {
        await afterRegistration(fixture);
        fixture.emit({
          schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED, closed: true
        });
      }],
      ["malformed close evidence", async (fixture) => {
        await afterRegistration(fixture);
        fixture.emit({
          schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
          closed: true,
          discovery_probe: true
        });
      }],
      ["duplicate initialize", async (fixture) => {
        await afterRegistration(fixture);
        fixture.emit({
          schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_INITIALIZED,
          initialized: true
        });
        fixture.emit({
          schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_INITIALIZED,
          initialized: true
        });
      }],
      ["relay restart", async (fixture) => {
        await reachReadiness(fixture);
        fixture.emit({
          schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_RESTARTED,
          restarted: true,
          restart_count: 1
        });
      }],
      ["client tool-surface mismatch", async (fixture) => {
        await afterRegistration(fixture);
        fixture.emit({
          schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_INITIALIZED,
          initialized: true
        });
        fixture.emit({
          schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.TOOLS_LISTED,
          tools_listed: true,
          tools: ["commit", "unexpected"]
        });
      }],
      ["unknown lifecycle schema", async (fixture) => {
        await afterRegistration(fixture);
        fixture.emit({ schema_version: "wiki-mcp-launcher-something.v9", whatever: true });
      }],
      ["abnormal server loss", async (fixture) => {
        await afterRegistration(fixture);
        fixture.child.emit("exit", 9, "SIGKILL");
      }],
      ["client readiness timeout", async (fixture) => {
        await afterRegistration(fixture);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }]
    ];
    for (const [name, drive] of cases) {
      await t.test(name, async () => {
        const fixture = createLifecycle({ clientMs: 20 });
        await drive(fixture);
        const failure = await fixture.lifecycle.failureSettlement;
        assert.equal(failure.detail.producer_protocol_generation,
          STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
          `${name} must retain the negotiated producer generation`);
        assert.equal(failure.detail.consumer_protocol_generation,
          STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION);
        assert.equal(failure.detail.lifecycle_protocol_generation,
          STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION,
          `${name} must no longer report a null generation`);
        fixture.close();
      });
    }
  });

test("WK-2040: a failure before any registration reports an unnegotiated producer", async () => {
  const fixture = createLifecycle();
  fixture.emit({ schema_version: "wiki-mcp-launcher-readiness.future", ready: true, tools: [] });
  const failure = await fixture.lifecycle.failureSettlement;
  assert.equal(failure.code, STDIO_MCP_CONDUIT_ERROR_CODES.LIFECYCLE_PROTOCOL_INCOMPATIBLE);
  assert.deepEqual(fixture.lifecycle.negotiatedProtocolGenerations(), {
    producer: null,
    consumer: STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION
  });
  fixture.close();
});

test("WK-2040: the durable diagnostic distinguishes a grammar drift from malformed content",
  async () => {
    const fixture = await afterRegistration(createLifecycle());
    fixture.emit({
      schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
      closed: true,
      discovery_probe: true
    });
    const failure = await fixture.lifecycle.failureSettlement;
    const diagnostic = buildOrchestratorStdioMcpDiagnostic({
      failure, runId: "wkdb_diagnostic_probe"
    });
    assert.equal(diagnostic.stdio_mcp_reason,
      STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED);
    assert.equal(diagnostic.stdio_mcp_detail.lifecycle_reason,
      STDIO_MCP_LIFECYCLE_FAILURE_REASONS.MALFORMED_CLIENT_CLOSED);
    assert.equal(diagnostic.stdio_mcp_detail.lifecycle_validation_rule,
      STDIO_MCP_LIFECYCLE_VALIDATION_RULES.UNPERMITTED_EVENT_KEY);
    assert.equal(diagnostic.stdio_mcp_detail.producer_protocol_generation,
      STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION);
    assert.equal(diagnostic.stdio_mcp_detail.consumer_protocol_generation,
      STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION);

    const rendered = renderOrchestratorStdioMcpDiagnostic(null, diagnostic).join("\n");
    assert.match(rendered, /validation_rule=unpermitted_event_key/u);
    assert.match(rendered,
      new RegExp(`producer=${STDIO_MCP_LIFECYCLE_PROTOCOL_GENERATION.replace(/\./gu, "\\.")}`, "u"));
    fixture.close();
  });

test("WK-2040: the diagnostic admits only launcher tokens and carries no free text", () => {
  const diagnostic = buildOrchestratorStdioMcpDiagnostic({
    runId: "wkdb_forged",
    failure: {
      code: STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_FAILED,
      message: "secret prompt text",
      detail: {
        lifecycle_reason: "invented_reason",
        lifecycle_phase: "invented_phase",
        lifecycle_event_class: "invented_class",
        lifecycle_validation_rule: "invented rule with spaces",
        producer_protocol_generation: "not a token; rm -rf /",
        consumer_protocol_generation: "\n../../etc/shadow"
      }
    }
  });
  const detail = diagnostic.stdio_mcp_detail;
  assert.equal(detail.lifecycle_reason, null);
  assert.equal(detail.lifecycle_phase, null);
  assert.equal(detail.lifecycle_event_class, null);
  assert.equal(detail.lifecycle_validation_rule, null);
  assert.equal(detail.producer_protocol_generation, null);
  assert.equal(detail.consumer_protocol_generation, null);
  assert.equal(JSON.stringify(diagnostic).includes("secret prompt text"), false);
  assert.equal(JSON.stringify(diagnostic).includes("etc/shadow"), false);
});

test("WK-2040: the first lifecycle cause is retained across later evidence", async () => {
  const fixture = await afterRegistration(createLifecycle());
  fixture.emit({
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED,
    closed: true,
    discovery_probe: true
  });
  const first = await fixture.lifecycle.failureSettlement;
  fixture.emit({
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_DISCOVERY_PROBE_CLOSED,
    closed: true,
    discovery_probe: true
  });
  fixture.child.emit("exit", 9, "SIGKILL");
  assert.strictEqual(await fixture.lifecycle.failureSettlement, first);
  assert.strictEqual(fixture.lifecycle.currentFailure(), first);
  fixture.close();
});

test("WK-2040: a duplicate ordinary close after readiness still fails closed", async () => {
  const fixture = await reachReadiness(createLifecycle());
  const close = {
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.CLIENT_CLOSED, closed: true
  };
  fixture.emit(close);
  fixture.emit(close);
  const failure = await fixture.lifecycle.failureSettlement;
  assert.equal(failure.detail.lifecycle_reason,
    STDIO_MCP_LIFECYCLE_FAILURE_REASONS.DUPLICATE_CLIENT_CLOSED);
  fixture.close();
});
