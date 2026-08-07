import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  createStdioMcpConnectionAdmission,
  createStdioMcpConnectionAdmissionForResourceScope
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-connection-admission.mjs";
import { createStdioMcpConduitLocalBacking, projectStdioMcpChannelLocalBacking } from
  "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-channel.mjs";
import { countProcessLocalStdioMcpConduits } from
  "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";

const generation = () => ({ input: new PassThrough(), output: new PassThrough(), ready: true });
const root = (label) => mkdtempSync(join(tmpdir(), `stdio-mcp-admission-${label}-`));

function create(backing, factory) {
  return factory({ createGeneration: generation, backing });
}

async function open(admission) {
  const listening = new Promise((resolve) => admission.server.once("listening", resolve));
  assert.equal(admission.open(), true);
  await listening;
}

test("standalone admission owns one process-local registration until settlement", async () => {
  const privateRoot = root("standalone");
  const backing = createStdioMcpConduitLocalBacking(privateRoot);
  const { endpointSource, tokenSource } = projectStdioMcpChannelLocalBacking(backing);
  const baseline = countProcessLocalStdioMcpConduits();
  const admission = create(backing, createStdioMcpConnectionAdmission);

  try {
    assert.equal(countProcessLocalStdioMcpConduits(), baseline + 1);
    await open(admission);
    const settlement = admission.settle();
    assert.strictEqual(admission.settle(), settlement);
    assert.equal(countProcessLocalStdioMcpConduits(), baseline + 1);
    assert.equal(await settlement, null);
    assert.equal(countProcessLocalStdioMcpConduits(), baseline);
    assert.deepEqual(readdirSync(privateRoot), []);
    assert.throws(() => statSync(endpointSource), { code: "ENOENT" });
    assert.throws(() => statSync(tokenSource), { code: "ENOENT" });
  } finally {
    await admission.settle();
    rmSync(privateRoot, { recursive: true, force: true });
  }
});

test("resource-scoped admission leaves process-local ownership to its caller", async () => {
  const privateRoot = root("resource-scope");
  const backing = createStdioMcpConduitLocalBacking(privateRoot);
  const { endpointSource, tokenSource } = projectStdioMcpChannelLocalBacking(backing);
  const baseline = countProcessLocalStdioMcpConduits();
  const standalone = create(backing, createStdioMcpConnectionAdmissionForResourceScope);

  try {
    assert.equal(countProcessLocalStdioMcpConduits(), baseline);
    await open(standalone);
    assert.deepEqual(Object.keys(standalone).sort(), [
      "cleanupFailure", "close", "counts", "isOpen", "open", "server", "settle", "token", "tokenFile"
    ]);
    const settlement = standalone.settle();
    assert.strictEqual(standalone.settle(), settlement);
    assert.equal(countProcessLocalStdioMcpConduits(), baseline);
    assert.equal(await settlement, null);
    assert.equal(countProcessLocalStdioMcpConduits(), baseline);
    assert.deepEqual(readdirSync(privateRoot), []);
    assert.throws(() => statSync(endpointSource), { code: "ENOENT" });
    assert.throws(() => statSync(tokenSource), { code: "ENOENT" });
  } finally {
    await standalone.settle();
    rmSync(privateRoot, { recursive: true, force: true });
  }
});
