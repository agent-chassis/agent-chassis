import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDormantStdioMcpLocalChannel,
  __testing as coreTesting
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs";
import {
  deriveStdioMcpConduitLocalBacking,
  projectStdioMcpChannelLocalBacking
} from "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-channel.mjs";

const ROOT = path.join(os.tmpdir(), "stdio-mcp-local-construction-");

const CORE_PATH = new URL(
  "../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs",
  import.meta.url
);

function coreSource() {
  return readFileSync(CORE_PATH, "utf8");
}

function localBacking(directory) {
  return projectStdioMcpChannelLocalBacking(
    deriveStdioMcpConduitLocalBacking(directory)
  );
}

async function captureReject(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("expected promise to reject");
}

async function assertNoLocalResidue(backing, code) {
  await assert.rejects(stat(backing.endpointSource), { code });
  await assert.rejects(stat(backing.tokenSource), { code });
}

test("core retains the three focused structural boundaries", () => {
  const source = coreSource();
  assert.doesNotMatch(source, /registerTrustedStdioMcpConduitBinding/);
  const constructorStart = source.indexOf(
    "export async function createStdioMcpConduitWithTrustedDependencies"
  );
  const constructorEnd = source.indexOf("\nexport ", constructorStart + 1);
  const constructorSource = source.slice(constructorStart, constructorEnd);
  assert.equal((constructorSource.match(/trusted\.makePrivateDirectory\s*\(/g) ?? []).length, 1);

  const sourceRoot = new URL("../packages/agent-launch-cli/src/", import.meta.url);
  const sourceFiles = readdirSync(sourceRoot, { recursive: true })
    .filter((file) => file.endsWith(".mjs"))
    .map((file) => new URL(file, sourceRoot));
  const callers = sourceFiles.filter((file) =>
    readFileSync(file, "utf8").includes("createDormantStdioMcpLocalChannel"));
  assert.deepEqual(callers.map((file) => file.href), [
    new URL("../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs", import.meta.url).href
  ]);
});

function lifecycleCapability() {
  return {
    bindingState: Object.freeze({ marker: true }),
    markClientProcessTerminal() {}
  };
}

test("local construction derives opaque sibling backing and awaits listener readiness", async () => {
  const root = await mkdtemp(ROOT);
  const scope = new coreTesting.ConduitResourceScope();
  const directory = path.join(root, "fifo");
  const backing = localBacking(directory);
  try {
    const result = await createDormantStdioMcpLocalChannel({
      scope,
      directory,
      identifier: "run-local",
      family: "codex",
      role: "worker",
      lifecycleCapability: lifecycleCapability(),
      createGeneration: () => ({ ready: true, input: { write() {} } })
    });
    assert.equal(result.admission.server.listening, true);
    assert.equal(result.channel.transport, "local");
  } finally {
    const failures = await scope.dispose();
    assert.deepEqual(failures, []);
    assert.equal(scope.disposed, true);
    await assertNoLocalResidue(backing, "ENOENT");
    await rm(root, { recursive: true, force: true });
  }
});

test("local construction preserves a synchronous open cause and pre-existing root", async () => {
  const root = await mkdtemp(ROOT);
  const scope = new coreTesting.ConduitResourceScope();
  const directory = path.join(root, "fifo");
  const backing = localBacking(directory);
  const siblingRoot = path.dirname(backing.endpointSource);
  await writeFile(siblingRoot, "occupied");
  try {
    const error = await captureReject(createDormantStdioMcpLocalChannel({
        scope,
        directory,
        identifier: "run-failing-local-sync",
        family: "codex",
        role: "worker",
        lifecycleCapability: lifecycleCapability(),
        createGeneration: () => ({ ready: true, input: { write() {} } })
      }));
    assert.equal(error.code, "EEXIST");
    assert.equal(existsSync(siblingRoot), true);
    assert.equal(scope.disposed, false);
  } finally {
    const failures = await scope.dispose();
    assert.deepEqual(failures, []);
    assert.equal(scope.disposed, true);
    assert.equal(existsSync(siblingRoot), true);
    await assertNoLocalResidue(backing, "ENOTDIR");
    await rm(root, { recursive: true, force: true });
  }
});

test("local construction preserves a pre-existing empty sibling root", async () => {
  const root = await mkdtemp(ROOT);
  const scope = new coreTesting.ConduitResourceScope();
  const directory = path.join(root, "fifo");
  const backing = localBacking(directory);
  const siblingRoot = path.dirname(backing.endpointSource);
  await mkdir(siblingRoot);
  try {
    const result = await createDormantStdioMcpLocalChannel({
      scope,
      directory,
      identifier: "run-pre-existing-empty-local",
      family: "codex",
      role: "worker",
      lifecycleCapability: lifecycleCapability(),
      createGeneration: () => ({ ready: true, input: { write() {} } })
    });
    assert.equal(result.admission.server.listening, true);
  } finally {
    const failures = await scope.dispose();
    assert.deepEqual(failures, []);
    assert.equal(scope.disposed, true);
    assert.equal(existsSync(siblingRoot), true);
    await assertNoLocalResidue(backing, "ENOENT");
    await rm(root, { recursive: true, force: true });
  }
});

test("local construction preserves asynchronous EINVAL cause and removes owned root", async () => {
  const root = await mkdtemp(ROOT);
  const scope = new coreTesting.ConduitResourceScope();
  const directory = path.join(root, "x".repeat(180));
  const backing = localBacking(directory);
  const siblingRoot = path.dirname(backing.endpointSource);
  try {
    const error = await captureReject(createDormantStdioMcpLocalChannel({
        scope,
        directory,
        identifier: "run-failing-local-async",
        family: "codex",
        role: "worker",
        lifecycleCapability: lifecycleCapability(),
        createGeneration: () => ({ ready: true, input: { write() {} } })
      }));
    assert.equal(error.code, "EINVAL");
    assert.equal(scope.disposed, false);
  } finally {
    const failures = await scope.dispose();
    assert.deepEqual(failures, []);
    assert.equal(scope.disposed, true);
    assert.equal(existsSync(siblingRoot), false);
    await assertNoLocalResidue(backing, "ENOENT");
    await rm(root, { recursive: true, force: true });
  }
});
