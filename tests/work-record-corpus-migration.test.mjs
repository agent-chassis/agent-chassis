

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";

import {
  buildMigratedRecord,
  migrateCorpus
} from "../packages/wiki-core/src/lib/work-record-corpus-migration.mjs";
import {
  getRecordKindSpec,
  validateRecordByKind
} from "../packages/wiki-core/src/lib/work-record-kind-registry.mjs";
import { readMarkdownPage } from "../packages/wiki-core/src/lib/wiki-page.mjs";

const NORMAL_DECISION = `---
id: DEC-9001
title: A normal decision
status: proposed
date: 2026-07-10
owners: [codex]
related: [DEC-9002]
---

# A normal decision

## Context
Baseline context for the decision.

## Decision
We decide to proceed with the migration engine.

## Consequences
Downstream slices consume canonical JSON.
`;

const NORMAL_INITIATIVE = `---
id: IN-9001
title: A normal initiative
status: in_progress
priority: high
owner: codex
created: 2026-07-01
updated: 2026-07-10
---

# A normal initiative

## Summary
An initiative that spans several work records.

## Goals
Make IN/DEC records structured first.

## Milestones
Registry, migration, mutation routes.
`;

const SCALAR_DRIFT_DECISION = `---
id: DEC-9002
title: A decision with scalar docs and related
status: accepted
date: 2026-07-09
owners: [codex]
docs: docs/operating-model.md
related: DEC-9001
---

# A decision with scalar docs and related

## Context
Legacy frontmatter used scalar docs/related.

## Decision
Normalize scalar string-array fields on migration.

## Consequences
Both scalar-drift records build clean.
`;

const INVALID_DECISION = `---
id: DEC-9003
title: An invalid decision
status: totally_bogus_status
date: 2026-07-08
owners: [codex]
---

# An invalid decision

## Context
This record carries an out-of-vocabulary status.

## Decision
It should never be persisted.

## Consequences
It lands in failures[].
`;

const JUNK_KEY_DECISION = `---
id: DEC-9004
title: A decision carrying template junk frontmatter
status: proposed
date: 2026-07-11
owners: [codex]
# lifecycle: stable
# topics:
# Add overrides only when needed
bogus_key: some_value
---

# A decision carrying template junk frontmatter

## Context
The record template ships a YAML comment block the loader leaks as keys.

## Decision
Migration drops every # comment key and off-spec key.

## Consequences
The canonical .json carries only decision.v1 spec fields.
`;

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function buildFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk1449-corpus-"));
  const decisionsDir = path.join(repoRoot, "wiki", "decisions");
  const initiativesDir = path.join(repoRoot, "wiki", "initiatives");
  await mkdir(decisionsDir, { recursive: true });
  await mkdir(initiativesDir, { recursive: true });

  await writeFile(path.join(decisionsDir, "DEC-9001.md"), NORMAL_DECISION, "utf8");
  await writeFile(path.join(decisionsDir, "DEC-9002.md"), SCALAR_DRIFT_DECISION, "utf8");
  await writeFile(path.join(decisionsDir, "DEC-9003.md"), INVALID_DECISION, "utf8");
  await writeFile(path.join(initiativesDir, "IN-9001.md"), NORMAL_INITIATIVE, "utf8");

  return repoRoot;
}

test("buildMigratedRecord normalizes scalar string-array drift to one-element arrays", async () => {
  const repoRoot = await buildFixture();
  try {
    const built = await buildMigratedRecord({
      repoRoot,
      kind: "decision",
      id: "DEC-9002",
      dir: "wiki/decisions"
    });

    assert.equal(built.error, null, "the scalar-drift record loads without error");
    assert.deepEqual(
      built.diagnostics,
      [],
      "the scalar-drift record validates clean after normalization"
    );

    assert.deepEqual(built.record.docs, ["docs/operating-model.md"]);
    assert.deepEqual(built.record.related, ["DEC-9001"]);
    assert.deepEqual(built.normalizedFields.sort(), ["docs", "related"]);
    assert.equal(built.record.record_kind, "decision");

    assert.ok(built.record.sections.context.length > 0);
    assert.ok(built.record.sections.decision.length > 0);
    assert.ok(built.record.sections.consequences.length > 0);

    assert.equal(typeof built.source_digest, "string");
    assert.ok(!("source_digest" in built.record));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("migrateCorpus(write:true) persists valid records, skips invalid, and never touches the .md", async () => {
  const repoRoot = await buildFixture();
  try {
    const decisionsDir = path.join(repoRoot, "wiki", "decisions");
    const initiativesDir = path.join(repoRoot, "wiki", "initiatives");

    const mdBefore = {
      "DEC-9001": await readFile(path.join(decisionsDir, "DEC-9001.md"), "utf8"),
      "DEC-9002": await readFile(path.join(decisionsDir, "DEC-9002.md"), "utf8"),
      "DEC-9003": await readFile(path.join(decisionsDir, "DEC-9003.md"), "utf8"),
      "IN-9001": await readFile(path.join(initiativesDir, "IN-9001.md"), "utf8")
    };

    const result = await migrateCorpus({ repoRoot, write: true });

    assert.equal(result.schema_version, "corpus-migration.v1");

    assert.equal(result.clean, 3, "three records validate clean");
    const writtenIds = result.written.map((entry) => entry.id).sort();
    assert.deepEqual(writtenIds, ["DEC-9001", "DEC-9002", "IN-9001"]);

    const failureIds = result.failures.map((entry) => entry.id);
    assert.deepEqual(failureIds, ["DEC-9003"], "only the invalid decision fails");
    assert.ok(
      Array.isArray(result.failures[0].diagnostics) && result.failures[0].diagnostics.length > 0,
      "the failure carries validation diagnostics"
    );

    const driftIds = result.drift.map((entry) => entry.id);
    assert.deepEqual(driftIds, ["DEC-9002"], "only the scalar-drift record is in drift[]");
    assert.deepEqual(result.drift[0].normalized.sort(), ["docs", "related"]);

    for (const id of ["DEC-9001", "DEC-9002"]) {
      const jsonPath = path.join(decisionsDir, `${id}.json`);
      assert.ok(await fileExists(jsonPath), `${id}.json is written`);
      const record = JSON.parse(await readFile(jsonPath, "utf8"));
      assert.deepEqual(validateRecordByKind(record), [], `${id}.json validates via the registry`);
    }
    const inJsonPath = path.join(initiativesDir, "IN-9001.json");
    assert.ok(await fileExists(inJsonPath), "IN-9001.json is written");
    assert.deepEqual(
      validateRecordByKind(JSON.parse(await readFile(inJsonPath, "utf8"))),
      [],
      "IN-9001.json validates via the registry"
    );

    assert.equal(
      await fileExists(path.join(decisionsDir, "DEC-9003.json")),
      false,
      "the invalid decision is NOT persisted"
    );

    const dec9002 = JSON.parse(await readFile(path.join(decisionsDir, "DEC-9002.json"), "utf8"));
    assert.deepEqual(dec9002.docs, ["docs/operating-model.md"]);
    assert.deepEqual(dec9002.related, ["DEC-9001"]);

    for (const [id, before] of Object.entries(mdBefore)) {
      const dir = id.startsWith("IN-") ? initiativesDir : decisionsDir;
      const after = await readFile(path.join(dir, `${id}.md`), "utf8");
      assert.equal(after, before, `${id}.md is untouched by migration`);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("migrateCorpus is idempotent: re-running produces byte-identical .json", async () => {
  const repoRoot = await buildFixture();
  try {
    const decisionsDir = path.join(repoRoot, "wiki", "decisions");
    const initiativesDir = path.join(repoRoot, "wiki", "initiatives");

    await migrateCorpus({ repoRoot, write: true });
    const firstPass = {
      "DEC-9001": await readFile(path.join(decisionsDir, "DEC-9001.json"), "utf8"),
      "DEC-9002": await readFile(path.join(decisionsDir, "DEC-9002.json"), "utf8"),
      "IN-9001": await readFile(path.join(initiativesDir, "IN-9001.json"), "utf8")
    };

    const secondResult = await migrateCorpus({ repoRoot, write: true });
    assert.deepEqual(
      secondResult.written.map((entry) => entry.id).sort(),
      ["DEC-9001", "DEC-9002", "IN-9001"]
    );

    for (const [id, firstBytes] of Object.entries(firstPass)) {
      const dir = id.startsWith("IN-") ? initiativesDir : decisionsDir;
      const secondBytes = await readFile(path.join(dir, `${id}.json`), "utf8");
      assert.equal(secondBytes, firstBytes, `${id}.json is byte-identical on re-run`);
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("migration drops junk keys: # YAML-comment and off-spec frontmatter keys never reach the record", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk1449-junk-"));
  const decisionsDir = path.join(repoRoot, "wiki", "decisions");
  try {
    await mkdir(decisionsDir, { recursive: true });
    const filePath = path.join(decisionsDir, "DEC-9004.md");
    await writeFile(filePath, JUNK_KEY_DECISION, "utf8");

    const page = await readMarkdownPage(repoRoot, filePath);
    const leakedKeys = Object.keys(page.frontmatter);
    assert.ok(
      leakedKeys.some((key) => key.startsWith("#")),
      "the frontmatter loader leaks the template YAML comment block as # keys"
    );
    assert.ok(
      leakedKeys.includes("bogus_key"),
      "the stray off-spec key is present in the loaded frontmatter"
    );

    const built = await buildMigratedRecord({
      repoRoot,
      kind: "decision",
      id: "DEC-9004",
      dir: "wiki/decisions"
    });

    assert.equal(built.error, null, "the junk-frontmatter record loads without error");
    assert.deepEqual(built.diagnostics, [], "the migrated record validates clean");

    const recordKeys = Object.keys(built.record);

    assert.deepEqual(
      recordKeys.filter((key) => key.startsWith("#")),
      [],
      "no #-prefixed comment key reaches the migrated record"
    );

    const spec = getRecordKindSpec("decision");
    const allowedKeys = new Set([
      ...Object.keys(spec.requiredTopLevel),
      ...Object.keys(spec.optionalTopLevel),
      "sections"
    ]);
    const offSpecKeys = recordKeys.filter((key) => !allowedKeys.has(key));
    assert.deepEqual(offSpecKeys, [], "no key outside the decision.v1 spec reaches the record");

    assert.ok(!("bogus_key" in built.record), "the stray off-spec key is dropped");
    assert.ok(!("# lifecycle" in built.record), "the # lifecycle comment key is dropped");
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
