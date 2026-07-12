

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";

import {
  writeValidatedKindRecord,
  getKindRecordPath
} from "../packages/wiki-core/src/lib/kind-record-store.mjs";
import { renderRecordByKindMarkdown } from "../packages/wiki-core/src/lib/work-record-kind-renderer.mjs";
import { runDecision } from "../packages/wiki-cli/src/commands/decision.mjs";
import { run } from "../packages/wiki-cli/src/run.mjs";

const WHOAMI = os.userInfo().username;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function withTempRepo(fn) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "agent-chassis-wk-1512-slice-006-"));
  try {
    await fn(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

function proposedDecision(overrides = {}) {
  return {
    id: "DEC-9512",
    record_kind: "decision",
    title: "Fixture decision",
    status: "proposed",
    date: "2026-07-11",
    owners: ["codex"],
    sections: {
      context: "Original context body.",
      decision: "Original decision body.",
      consequences: "Original consequences body."
    },
    ...overrides
  };
}

async function seed(repoRoot, record) {
  const result = await writeValidatedKindRecord({ repoRoot, record });
  assert.equal(result.written, true, `seed write should succeed for ${record.id}`);
  return result;
}

async function readJson(repoRoot, record) {
  const relativeJsonPath = await getKindRecordPath(record.record_kind, record.id);
  return JSON.parse(await readFile(path.resolve(repoRoot, relativeJsonPath), "utf8"));
}

async function readMarkdown(repoRoot, record) {
  const relativeJsonPath = await getKindRecordPath(record.record_kind, record.id);
  const relativeMarkdownPath = relativeJsonPath.replace(/\.json$/, ".md");
  return readFile(path.resolve(repoRoot, relativeMarkdownPath), "utf8");
}

async function assertLockstep(repoRoot, record) {
  const onDiskJson = await readJson(repoRoot, record);
  const projection = renderRecordByKindMarkdown(onDiskJson);
  assert.equal(projection.valid, true, "projection of the on-disk record must be valid");
  const onDiskMarkdown = await readMarkdown(repoRoot, record);
  assert.equal(onDiskMarkdown, projection.markdown, ".md must match the canonical projection of the .json");
  return onDiskJson;
}

test("runDecision ratify then unratify flip the DEC lifecycle via the CLI, in .json+.md lockstep", async () => {
  await withTempRepo(async (repoRoot) => {
    const record = proposedDecision();
    await seed(repoRoot, record);

    const ratified = await runDecision(["ratify", "--id", record.id, "--dir", repoRoot]);
    assert.equal(ratified.ok, true, "ratify of a proposed decision should succeed");
    assert.equal(ratified.id, record.id);
    assert.equal(ratified.status, "accepted", "CLI reports the resulting accepted status");
    assert.equal(ratified.written, true);
    assert.deepEqual(ratified.diagnostics, []);
    assert.ok(ratified.source_digest, "a fresh source digest is reported after the write");

    let onDiskJson = await assertLockstep(repoRoot, record);
    assert.equal(onDiskJson.status, "accepted");
    assert.equal(onDiskJson.ratified_by, WHOAMI, "the operator shell identity is stamped as approver");
    assert.match(onDiskJson.ratified, DATE_RE);
    assert.equal(onDiskJson.updated_by, WHOAMI);

    const unratified = await runDecision(["unratify", "--id", record.id, "--dir", repoRoot]);
    assert.equal(unratified.ok, true, "unratify of an accepted decision should succeed");
    assert.equal(unratified.status, "proposed", "CLI reports the resulting proposed status");
    assert.equal(unratified.written, true);

    onDiskJson = await assertLockstep(repoRoot, record);
    assert.equal(onDiskJson.status, "proposed");
    assert.equal(onDiskJson.ratified, null, "unratify clears the ratification date");
    assert.equal(onDiskJson.ratified_by, null, "unratify clears the approver");
    assert.equal(onDiskJson.updated_by, WHOAMI);
  });
});

test("run('decision', 'ratify', ...) dispatches through the wiki CLI and flips the DEC", async () => {
  await withTempRepo(async (repoRoot) => {
    const record = proposedDecision();
    await seed(repoRoot, record);

    await run(["decision", "ratify", "--id", record.id, "--dir", repoRoot]);

    const onDiskJson = await assertLockstep(repoRoot, record);
    assert.equal(onDiskJson.status, "accepted", "the dispatcher-invoked ratify persisted");
    assert.equal(onDiskJson.ratified_by, WHOAMI);
  });
});

test("runDecision ratify of an already-accepted DEC refuses (ok:false) with no write", async () => {
  await withTempRepo(async (repoRoot) => {
    const record = proposedDecision();
    await seed(repoRoot, record);

    const first = await runDecision(["ratify", "--id", record.id, "--dir", repoRoot]);
    assert.equal(first.ok, true, "the first ratify accepts the decision");

    const acceptedJsonBefore = await readJson(repoRoot, record);
    const acceptedMdBefore = await readMarkdown(repoRoot, record);

    const refused = await runDecision(["ratify", "--id", record.id, "--dir", repoRoot]);
    assert.equal(refused.ok, false, "re-ratifying an accepted decision must be refused");
    assert.equal(refused.written, false);
    assert.ok(
      refused.diagnostics.length > 0,
      "a refusal surfaces the underlying diagnostics"
    );

    const acceptedJsonAfter = await readJson(repoRoot, record);
    const acceptedMdAfter = await readMarkdown(repoRoot, record);
    assert.deepEqual(acceptedJsonAfter, acceptedJsonBefore, "the .json must be untouched after a refusal");
    assert.equal(acceptedMdAfter, acceptedMdBefore, "the .md must be untouched after a refusal");
  });
});

test("runDecision ratify of a missing DEC refuses (ok:false) with no write", async () => {
  await withTempRepo(async (repoRoot) => {
    const refused = await runDecision(["ratify", "--id", "DEC-9999", "--dir", repoRoot]);
    assert.equal(refused.ok, false, "ratifying a non-existent decision must be refused");
    assert.equal(refused.written, false);
    assert.equal(refused.status, null, "no resulting status when nothing was ratified");
    assert.ok(
      refused.diagnostics.length > 0,
      "a missing-record refusal surfaces the underlying diagnostics"
    );
  });
});
