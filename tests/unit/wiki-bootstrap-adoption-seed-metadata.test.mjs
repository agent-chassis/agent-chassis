import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { getStaticIn0001AdoptionSeed } from "../../packages/wiki-core/src/index.mjs";
import { ensureAdoptionInitiative } from "../../packages/wiki-core/src/lib/wiki-scaffold.mjs";
import { renderRecordByKindMarkdown } from "../../packages/wiki-core/src/lib/work-record-kind-renderer.mjs";
import { validateRecordByKind } from "../../packages/wiki-core/src/lib/work-record-kind-registry.mjs";

test("IN-0001 seed exposes the minimal first-work placeholder result", () => {
  const seed = getStaticIn0001AdoptionSeed();

  assert.equal(seed.record_id, "IN-0001");
  assert.equal(seed.title, "Start the first real work");
  assert.equal(seed.summary, "In-progress placeholder for the repository's first real work.");
  assert.deepEqual(seed.target_surfaces, []);
  assert.deepEqual(seed.owned_work, []);
  assert.deepEqual(seed.required_checks, []);
  assert.deepEqual(seed.seed_work_record_templates, undefined);
});

test("ensureAdoptionInitiative writes valid canonical JSON and its exact projection", async () => {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "wiki-bootstrap-adoption-"));
  try {
    const seed = getStaticIn0001AdoptionSeed();
    const result = await ensureAdoptionInitiative(targetDir, {
      seed,
      date: "2026-08-14"
    });
    const record = JSON.parse(await readFile(path.join(targetDir, result.relativePath), "utf8"));
    const rendered = await readFile(path.join(targetDir, result.projectionPath), "utf8");

    assert.equal(result.relativePath, "wiki/initiatives/IN-0001.json");
    assert.equal(result.projectionPath, "wiki/initiatives/IN-0001.md");
    assert.deepEqual(validateRecordByKind(record), []);
    assert.equal(record.record_kind, "initiative");
    assert.equal(record.status, "in_progress");
    assert.equal(record.priority, "medium");
    assert.equal(record.area, "work");
    assert.equal(rendered, renderRecordByKindMarkdown(record).markdown);
    assert.ok(rendered.includes("\nstatus: in_progress\n"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("ensureAdoptionInitiative refuses a projection-only legacy initiative", async () => {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "wiki-bootstrap-adoption-legacy-"));
  try {
    const projectionPath = path.join(targetDir, "wiki", "initiatives", "IN-0001.md");
    await mkdir(path.dirname(projectionPath), { recursive: true });
    await writeFile(projectionPath, "---\nid: IN-0001\n---\n\n# Legacy projection\n", "utf8");

    await assert.rejects(
      ensureAdoptionInitiative(targetDir, { seed: getStaticIn0001AdoptionSeed() }),
      /generated projection.*canonical .*IN-0001\.json is missing.*structured kind-record migration/s
    );
    await assert.rejects(
      readFile(path.join(targetDir, "wiki", "initiatives", "IN-0001.json"), "utf8"),
      { code: "ENOENT" }
    );
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});
