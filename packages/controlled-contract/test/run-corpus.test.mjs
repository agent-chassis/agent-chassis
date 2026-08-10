import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadCorpus,
  parseArgs,
  selectItems,
  sourceCoverage
} from "./development/tools/run-corpus.mjs";

test("corpus runner defaults to one recent slice-criteria pass", () => {
  const options = parseArgs(["--dry-run", "--from", "1850", "--to", "WK-1924"]);
  assert.equal(options.units, "slices");
  assert.equal(options.surface, "criteria");
  assert.equal(options.repetitions, 1);
  assert.equal(options.concurrency, 12);
  assert.equal(options.resume, true);
});

test("corpus runner selects slice criteria without parent leakage", async () => {
  const recordsDir = await mkdtemp(path.join(os.tmpdir(), "cc-corpus-v026-test-"));
  try {
    await writeFile(path.join(recordsDir, "WK-1850.json"), JSON.stringify({
      id: "WK-1850",
      work_kind: "design",
      acceptance: { criteria: ["Parent criterion."] },
      slices: [{
        id: "SLICE-001",
        work_kind: "implementation",
        read_scope: ["docs/example.md"],
        repo_paths: [],
        write_scope: ["docs/example.md"],
        acceptance: {
          criteria: ["First slice criterion.", { text: "Second slice criterion.", exclusive: true }],
          validation: ["Validate the slice."]
        }
      }]
    }), "utf8");
    const options = {
      ...parseArgs(["--dry-run", "--from", "1850", "--to", "1851"]),
      recordsDir
    };
    const corpus = await loadCorpus(options);
    assert.deepEqual(corpus.recordsFound, ["WK-1850"]);
    assert.deepEqual(corpus.recordsMissing, ["WK-1851"]);
    assert.deepEqual(corpus.items.map((item) => item.sourceCriterionId), [
      "WK-1850#SLICE-001:criteria:0001",
      "WK-1850#SLICE-001:criteria:0002"
    ]);
    assert.ok(corpus.items.every((item) => item.workKind === "implementation"));
  } finally {
    await rm(recordsDir, { recursive: true, force: true });
  }
});

test("corpus runner spread sampling preserves range coverage", () => {
  const items = Array.from({ length: 9 }, (_, index) => ({ id: index }));
  assert.deepEqual(
    selectItems(items, { limit: 3, sample: "spread" }).map((item) => item.id),
    [0, 4, 8]
  );
  assert.deepEqual(
    selectItems(items, { limit: 3, sample: "first" }).map((item) => item.id),
    [0, 1, 2]
  );
});

test("current corpus runner reports one source segment for duplicate residue reasons", () => {
  const row = {
    source_text: "First obligation. Second obligation.",
    compiler: {
      evaluation: {
        residue: [
          { text: "Second obligation.", reason: "unsupported_by_controlled_grammar" },
          { text: "Second obligation.", reason: "invalid_controlled_claim" }
        ]
      }
    }
  };
  assert.deepEqual(sourceCoverage(row), {
    sourceSegments: 2,
    sourceSegmentsWithResidue: 1,
    sourceSegmentsWithoutResidue: 1
  });
});
