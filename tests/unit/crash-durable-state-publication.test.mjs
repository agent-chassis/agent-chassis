

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CRASH_DURABLE_EFFECTS,
  CRASH_DURABLE_FAULTS,
  CRASH_DURABLE_RESULTS,
  compensationFor,
  createAsyncEffects,
  createSyncEffects,
  planLogicalAppend,
  planReplacement,
  runCrashDurablePlanAsync,
  runCrashDurablePlanSync
} from "../../packages/wiki-core/src/lib/crash-durable-state.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const PRIOR_BYTES = '{"generation":1}\n';
const NEXT_BYTES = '{"generation":2}\n';

const REPLACEMENT_BOUNDARIES = Object.freeze([
  CRASH_DURABLE_FAULTS.PRIVATE_CREATED,
  CRASH_DURABLE_FAULTS.PARTIAL_BYTES_WRITTEN,
  CRASH_DURABLE_FAULTS.COMPLETE_BYTES_WRITTEN,
  CRASH_DURABLE_FAULTS.FILE_SYNCED,
  CRASH_DURABLE_FAULTS.TARGET_PUBLISHED,
  CRASH_DURABLE_FAULTS.DIRECTORY_SYNCED
]);

function workspace(cleanups) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wk2357-publication-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function seedPriorTarget(dir) {
  const targetPath = path.join(dir, "authoritative.json");
  writeFileSync(targetPath, PRIOR_BYTES, "utf8");
  return targetPath;
}

function injectorFor(boundary) {
  if (boundary === null) return null;
  return (fault) => {
    if (fault === boundary) throw new Error(`injected at ${fault}`);
  };
}

const cleanups = [];

test("every publication boundary leaves the prior state readable or the new state fully durable", async (t) => {
  t.after(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  for (const boundary of [null, ...REPLACEMENT_BOUNDARIES]) {
    for (const flavour of ["sync", "async"]) {
      const dir = workspace(cleanups);
      const targetPath = seedPriorTarget(dir);
      const privatePath = path.join(dir, "authoritative.json.private");
      const plan = planReplacement({ targetPath, privatePath, bytes: NEXT_BYTES });
      const effects = flavour === "sync"
        ? createSyncEffects({ faultInjector: injectorFor(boundary) })
        : createAsyncEffects({ faultInjector: injectorFor(boundary) });
      const result = flavour === "sync"
        ? runCrashDurablePlanSync(plan, effects)
        : await runCrashDurablePlanAsync(plan, effects);

      assert.equal(result.failed_fault, boundary, `${flavour}/${boundary}: the injected boundary is the reported one`);

      const onDisk = readFileSync(targetPath, "utf8");
      if (boundary === null || boundary === CRASH_DURABLE_FAULTS.DIRECTORY_SYNCED) {

        assert.equal(onDisk, NEXT_BYTES, `${flavour}/${boundary}: the new state is fully durable`);
      } else {

        assert.equal(onDisk, PRIOR_BYTES, `${flavour}/${boundary}: the prior durable state is preserved byte for byte`);
        assert.equal(
          result.classification,
          CRASH_DURABLE_RESULTS.PRIOR_PRESERVED,
          `${flavour}/${boundary}: a pre-publication failure classifies as prior-preserved`
        );

        assert.equal(existsSync(privatePath), false, `${flavour}/${boundary}: the private path is discarded`);
        assert.equal(existsSync(targetPath), true, `${flavour}/${boundary}: the canonical target is never removed`);
      }
    }
  }
});

test("an injected failure is propagated and never converted into success", async (t) => {
  const dir = workspace(cleanups);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const targetPath = seedPriorTarget(dir);
  const privatePath = path.join(dir, "authoritative.json.private");
  const plan = planReplacement({ targetPath, privatePath, bytes: NEXT_BYTES });

  const result = runCrashDurablePlanSync(
    plan,
    createSyncEffects({ faultInjector: injectorFor(CRASH_DURABLE_FAULTS.FILE_SYNCED) })
  );
  assert.notEqual(result.error, null, "the injected error is carried on the result");
  assert.match(result.error.message, /injected at file_synced/u);
  assert.notEqual(
    result.classification,
    CRASH_DURABLE_RESULTS.PUBLISHED,
    "a failed boundary never classifies as published"
  );
});

test("sync and async interpreters produce identical traces at every boundary", async () => {
  for (const boundary of [null, ...REPLACEMENT_BOUNDARIES]) {
    const syncDir = workspace(cleanups);
    const asyncDir = workspace(cleanups);
    const build = (dir) => {
      const targetPath = seedPriorTarget(dir);
      return {
        targetPath,
        plan: planReplacement({
          targetPath,
          privatePath: path.join(dir, "authoritative.json.private"),
          bytes: NEXT_BYTES
        })
      };
    };
    const syncCase = build(syncDir);
    const asyncCase = build(asyncDir);

    const syncResult = runCrashDurablePlanSync(
      syncCase.plan,
      createSyncEffects({ faultInjector: injectorFor(boundary) })
    );
    const asyncResult = await runCrashDurablePlanAsync(
      asyncCase.plan,
      createAsyncEffects({ faultInjector: injectorFor(boundary) })
    );

    assert.deepEqual(
      syncResult.trace,
      asyncResult.trace,
      `boundary ${boundary}: identical operation order and cleanup authority`
    );
    assert.equal(syncResult.classification, asyncResult.classification, `boundary ${boundary}: identical classification`);
    assert.equal(syncResult.failed_fault, asyncResult.failed_fault, `boundary ${boundary}: identical failed boundary`);
    assert.equal(
      readFileSync(syncCase.targetPath, "utf8"),
      readFileSync(asyncCase.targetPath, "utf8"),
      `boundary ${boundary}: identical resulting durable bytes`
    );
  }
});

test("a logical append is a serialized copy-on-write publication of the complete image", async (t) => {
  const dir = workspace(cleanups);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const targetPath = path.join(dir, "journal.jsonl");
  writeFileSync(targetPath, PRIOR_BYTES, "utf8");
  const privatePath = path.join(dir, "journal.jsonl.private");

  const plan = planLogicalAppend({
    targetPath,
    privatePath,
    priorBytes: PRIOR_BYTES,
    appendedBytes: NEXT_BYTES
  });
  const result = await runCrashDurablePlanAsync(plan, createAsyncEffects({}));

  assert.equal(result.classification, CRASH_DURABLE_RESULTS.PUBLISHED);
  assert.equal(
    readFileSync(targetPath, "utf8"),
    `${PRIOR_BYTES}${NEXT_BYTES}`,
    "logical append ordering and bytes are preserved through copy-on-write publication"
  );

  const torn = await runCrashDurablePlanAsync(
    planLogicalAppend({
      targetPath,
      privatePath,
      priorBytes: `${PRIOR_BYTES}${NEXT_BYTES}`,
      appendedBytes: '{"generation":3}\n'
    }),
    createAsyncEffects({ faultInjector: injectorFor(CRASH_DURABLE_FAULTS.COMPLETE_BYTES_WRITTEN) })
  );
  assert.equal(torn.classification, CRASH_DURABLE_RESULTS.PRIOR_PRESERVED);
  assert.equal(
    readFileSync(targetPath, "utf8"),
    `${PRIOR_BYTES}${NEXT_BYTES}`,
    "a torn private tail cannot corrupt the prior durable append result"
  );
});

test("the plan is immutable and performs no I/O of its own", () => {
  const plan = planReplacement({
    targetPath: "/tmp/x/target.json",
    privatePath: "/tmp/x/target.json.private",
    bytes: "{}\n"
  });
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.steps));
  for (const step of plan.steps) assert.ok(Object.isFrozen(step));
  assert.deepEqual(
    plan.steps.map((step) => step.effect),
    [
      CRASH_DURABLE_EFFECTS.CREATE_PRIVATE_EXCLUSIVE,
      CRASH_DURABLE_EFFECTS.WRITE_BYTES,
      CRASH_DURABLE_EFFECTS.WRITE_BYTES,
      CRASH_DURABLE_EFFECTS.SYNC_FILE,
      CRASH_DURABLE_EFFECTS.PUBLISH_RENAME,
      CRASH_DURABLE_EFFECTS.SYNC_DIRECTORY
    ],
    "the closed publication protocol is exactly create/write/fsync/rename/dirfsync"
  );

  assert.equal(existsSync("/tmp/x/target.json.private"), false);

  assert.throws(
    () => planReplacement({ targetPath: "/tmp/a/t.json", privatePath: "/tmp/b/t.private", bytes: "" }),
    /sibling/u
  );
});

test("compensation authority never reaches a canonical path", () => {
  const plan = planReplacement({
    targetPath: "/tmp/x/target.json",
    privatePath: "/tmp/x/target.json.private",
    bytes: "{}\n"
  });
  for (const boundary of REPLACEMENT_BOUNDARIES) {
    const compensation = compensationFor(plan, boundary);
    for (const entry of compensation) {
      assert.equal(entry.effect, CRASH_DURABLE_EFFECTS.DISCARD_PRIVATE);
      assert.equal(entry.privatePath, plan.privatePath, "compensation only ever addresses the private path");
    }
  }
  assert.deepEqual(
    compensationFor(plan, CRASH_DURABLE_FAULTS.DIRECTORY_SYNCED),
    [],
    "after publication there is nothing this substrate owns to compensate"
  );
  assert.deepEqual(compensationFor(plan, null), [], "a successful run compensates nothing");
});

test("promoting the helper into wiki-core adds no package, dependency edge, or cycle", () => {
  const manifest = (name) =>
    JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", name, "package.json"), "utf8"));

  const wikiCore = manifest("wiki-core");
  const launchCore = manifest("agent-launch-core");

  assert.deepEqual(
    Object.keys(wikiCore.dependencies ?? {}).sort(),
    ["@agent-chassis/controlled-contract", "@vscode/tree-sitter-wasm", "ajv", "protobufjs", "web-tree-sitter"],
    "wiki-core's dependency set is unchanged by this promotion"
  );

  assert.ok(
    Object.hasOwn(launchCore.dependencies ?? {}, "@agent-chassis/wiki-core"),
    "agent-launch-core already depends on wiki-core, so no new edge is introduced"
  );
  assert.equal(
    Object.hasOwn(wikiCore.dependencies ?? {}, "@agent-chassis/agent-launch-core"),
    false,
    "wiki-core does not depend back on agent-launch-core, so no cycle is created"
  );

  const source = readFileSync(
    path.join(REPO_ROOT, "packages/wiki-core/src/lib/crash-durable-state.mjs"),
    "utf8"
  );
  const imports = [...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(imports)].sort(),
    ["node:fs", "node:fs/promises", "node:path"],
    "the substrate imports only node builtins"
  );
});
