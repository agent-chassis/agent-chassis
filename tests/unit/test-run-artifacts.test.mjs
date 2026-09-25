import assert from "node:assert/strict";
import {
  chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { allocateTestRunArtifacts, writeRunMetadata } from "../helpers/test-run-artifacts.mjs";
import { TEST_RUN_CONTEXT_ENV, encodeTestRunContext } from "../helpers/test-run-context.mjs";
import { createTestFixture } from "../helpers/test-fixture.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";
import { runnerOwnedRootContaining } from "../helpers/test-runner-roots.mjs";

const CREATE_FAILED = "test_runner.artifact_create_failed.v1";

async function base(t) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const directory = mkdtempSync("/tmp/agent-chassis-artifact-case-");
  scope.add(`artifact case ${directory}`, () => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function disposableBase(t) {
  const fixture = await createTestFixture({ prefix: "run-artifacts-" });
  t.after(() => fixture.dispose());
  return fixture.rootPath;
}

const refuses = (promise, pattern) => assert.rejects(promise,
  (error) => error.code === CREATE_FAILED && pattern.test(error.message));

test("each allocation is a new private directory and never reuses an earlier run", async (t) => {
  const explicit = path.join(await base(t), "requested", "deeper");
  const first = await allocateTestRunArtifacts({ explicitBase: explicit, env: {} });
  const second = await allocateTestRunArtifacts({ explicitBase: explicit, env: {} });
  assert.notEqual(first.runDir, second.runDir);
  assert.notEqual(first.runId, second.runId);
  assert.equal(path.dirname(first.runDir), explicit, "a missing requested base is created");
  for (const directory of [explicit, first.runDir, path.join(first.runDir, "components")]) {
    assert.equal(statSync(directory).mode & 0o777, 0o700, directory);
  }
  assert.equal(first.baseSource, "explicit");
  assert.equal(first.parent, null);
});

test("a base inside a disposable runner root is refused before anything is created", async (t) => {

  const disposable = runnerOwnedRootContaining(os.tmpdir());
  if (disposable === null) {
    t.skip("not running under tests/run-tests.mjs");
    return;
  }
  await refuses(allocateTestRunArtifacts({ env: {}, defaultBase: os.tmpdir() }), /disposable runner root/u);
  const inside = path.join(os.tmpdir(), "artifacts-here");
  await refuses(allocateTestRunArtifacts({ explicitBase: inside, env: {} }), /disposable runner root/u);
  assert.equal(readdirSync(os.tmpdir()).includes("artifacts-here"), false);
  const fixtureRoot = await disposableBase(t);
  await refuses(allocateTestRunArtifacts({ explicitBase: path.join(fixtureRoot, "x"), env: {} }),
    /disposable runner root/u);
  const current = await base(t);
  await refuses(allocateTestRunArtifacts({ explicitBase: path.join(current, "x"), env: {},
    currentRoots: [current] }), /this run's disposable root/u);
});

test("a nested run allocates beneath its validated outer run and records ancestry", async (t) => {
  const outer = await allocateTestRunArtifacts({ explicitBase: path.join(await base(t), "outer"), env: {} });
  writeRunMetadata(outer.runDir, { schema_version: "test-run.v1", run_id: outer.runId });
  const env = { [TEST_RUN_CONTEXT_ENV]: encodeTestRunContext({ runId: outer.runId, runDir: outer.runDir }) };
  const [left, right] = await Promise.all([allocateTestRunArtifacts({ env }), allocateTestRunArtifacts({ env })]);
  for (const nested of [left, right]) {
    assert.equal(path.dirname(nested.runDir), path.join(outer.runDir, "nested"));
    assert.deepEqual(nested.parent, { run_id: outer.runId, run_dir: outer.runDir });
    assert.equal(nested.baseSource, "inherited");
  }
  assert.notEqual(left.runDir, right.runDir, "concurrent nested runs never share a directory");

  const wrongRun = encodeTestRunContext({ runId: "00000000-0000-4000-8000-00000000000f", runDir: outer.runDir });
  await refuses(allocateTestRunArtifacts({ env: { [TEST_RUN_CONTEXT_ENV]: wrongRun } }), /does not belong/u);
  const link = path.join(path.dirname(outer.runDir), "link");
  symlinkSync(outer.runDir, link);
  await refuses(allocateTestRunArtifacts({ env: { [TEST_RUN_CONTEXT_ENV]:
    encodeTestRunContext({ runId: outer.runId, runDir: link }) } }), /not a plain directory/u);
  chmodSync(outer.runDir, 0o755);
  await refuses(allocateTestRunArtifacts({ env }), /permissions are not 0700/u);
  chmodSync(outer.runDir, 0o700);
  await refuses(allocateTestRunArtifacts({ env: { [TEST_RUN_CONTEXT_ENV]: "{" } }), /not JSON/u);
});

test("run metadata is replaced whole, never partially rewritten", async (t) => {
  const run = await allocateTestRunArtifacts({ explicitBase: await base(t), env: {} });
  writeRunMetadata(run.runDir, { status: "incomplete" });
  writeRunMetadata(run.runDir, { status: "tests_passed" });
  const entries = readdirSync(run.runDir).sort();
  assert.deepEqual(entries, ["components", "run.json"]);
  assert.equal(statSync(path.join(run.runDir, "run.json")).mode & 0o777, 0o600);
  mkdirSync(path.join(run.runDir, "run.json.pending"));
  writeFileSync(path.join(run.runDir, "unrelated"), "kept");
  writeRunMetadata(run.runDir, { status: "tests_failed" });
  assert.ok(readdirSync(run.runDir).includes("unrelated"), "no pruning of other entries");
});
