import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  createStdioMcpConnectionAdmission
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-connection-admission.mjs";
import {
  createStdioMcpConduitLocalBacking,
  projectStdioMcpChannelLocalBacking
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-channel.mjs";
import {
  STDIO_MCP_CONDUIT_ERROR_CODES,
  StdioMcpConduitError
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-errors.mjs";

const generation = () => ({ input: new PassThrough(), output: new PassThrough(), ready: true });
const root = () => mkdtempSync(join(tmpdir(), "stdio-mcp-admission-backing-"));

test("local admission backing is a permanently single-use endpoint/token pair", async () => {
  const privateRoot = root();
  const backing = createStdioMcpConduitLocalBacking(privateRoot);
  const alias = createStdioMcpConduitLocalBacking(privateRoot);
  const { endpointSource, tokenSource } = projectStdioMcpChannelLocalBacking(backing);
  let createGenerationCalls = 0;
  const createGeneration = () => { createGenerationCalls += 1; return generation(); };
  const first = createStdioMcpConnectionAdmission({ createGeneration, backing });

  try {
    assert.equal(first.isOpen(), false);
    assert.equal(createGenerationCalls, 0);
    assert.deepEqual(readdirSync(privateRoot), []);
    for (const reusedBacking of [backing, alias]) {
      assert.throws(
        () => createStdioMcpConnectionAdmission({ createGeneration, backing: reusedBacking }),
        (error) => {
          assert.ok(error instanceof StdioMcpConduitError);
          assert.equal(error.code, STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID);
          return true;
        }
      );
      assert.equal(createGenerationCalls, 0);
      assert.deepEqual(readdirSync(privateRoot), []);
    }
    const listening = new Promise((resolve) => first.server.once("listening", resolve));
    assert.equal(first.open(), true);
    await listening;
    await first.settle();
    assert.throws(() => statSync(endpointSource), { code: "ENOENT" });
    assert.throws(() => statSync(tokenSource), { code: "ENOENT" });

    assert.throws(
      () => createStdioMcpConnectionAdmission({ createGeneration, backing }),
      (error) => error instanceof StdioMcpConduitError &&
        error.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID
    );
    assert.equal(createGenerationCalls, 0);
    assert.deepEqual(readdirSync(privateRoot), []);
    assert.throws(() => statSync(endpointSource), { code: "ENOENT" });
    assert.throws(() => statSync(tokenSource), { code: "ENOENT" });
  } finally {
    await first.settle();
    rmSync(privateRoot, { recursive: true, force: true });
  }
});
