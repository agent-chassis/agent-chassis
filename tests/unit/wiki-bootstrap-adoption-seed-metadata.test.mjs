import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getStaticIn0001AdoptionSeed,
  renderStaticIn0001AdoptionSeedMarkdown
} from "../../packages/wiki-core/src/index.mjs";
import { ensureAdoptionInitiative } from "../../packages/wiki-core/src/lib/wiki-scaffold.mjs";

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

test("IN-0001 renderer emits only the first-work placeholder", () => {
  assert.equal(
    renderStaticIn0001AdoptionSeedMarkdown(),
    "# Start the first real work\n\nIn-progress placeholder for the repository's first real work.\n"
  );
});

test("ensureAdoptionInitiative writes an in-progress first-work initiative", async () => {
  const targetDir = await mkdtemp(path.join(os.tmpdir(), "wiki-bootstrap-adoption-"));
  try {
    const seed = getStaticIn0001AdoptionSeed();
    const result = await ensureAdoptionInitiative(targetDir, {
      seed,
      body: renderStaticIn0001AdoptionSeedMarkdown(seed),
      date: "2026-08-14"
    });
    const rendered = await readFile(path.join(targetDir, result.relativePath), "utf8");

    assert.equal(result.relativePath, "wiki/initiatives/IN-0001.md");
    assert.ok(rendered.includes("\nstatus: in_progress\n"));
    assert.ok(rendered.includes("\npriority: medium\n"));
    assert.ok(rendered.includes("\narea: work\n"));
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});
