import test from "node:test";
import assert from "node:assert/strict";

import { projectSelectedUnitGraphBearingPaths } from "../packages/wiki-core/src/lib/work-record-dispatch-graph-projection.mjs";

test("selected-unit graph projection uses the normalized write/repo union without sibling scope", () => {
  const selectedUnit = {
    kind: "slice",
    address: "WK-1768#SLICE-001",
    record_id: "WK-1768",
    slice_id: "SLICE-001"
  };
  const projection = projectSelectedUnitGraphBearingPaths({
    selectedUnit,
    subject: {
      write_scope: ["packages/app/src/core.mjs", "packages/app/src/new-file.mjs"],
      repo_paths: ["packages/app/src/core.mjs", "tests/core.test.mjs", "docs/core.md"]
    },
    committedSourcePaths: ["packages/app/src/core.mjs", "tests/core.test.mjs"]
  });

  assert.deepEqual(projection.selected_unit, selectedUnit);
  assert.deepEqual(projection.graph_bearing_paths, [
    "packages/app/src/core.mjs",
    "tests/core.test.mjs"
  ]);
  assert.deepEqual(projection.excluded_paths, [
    { path: "docs/core.md", reason: "non_graph_bearing" },
    { path: "packages/app/src/new-file.mjs", reason: "absent_from_committed_artifact" }
  ]);
  assert.equal("projection_digest" in projection, false);
  assert.equal(JSON.stringify(projection).includes("packages/sibling"), false);
});

test("creates inside committed function and test containers retain graph coverage", () => {
  const projection = projectSelectedUnitGraphBearingPaths({
    selectedUnit: { kind: "slice", address: "WK-9000#SLICE-001" },
    subject: {
      write_scope: ["packages/app/src/existing.mjs", "tests/existing.test.mjs"],
      repo_paths: []
    },
    committedSourcePaths: ["packages/app/src/existing.mjs", "tests/existing.test.mjs"]
  });

  assert.deepEqual(projection.graph_bearing_paths, [
    "packages/app/src/existing.mjs",
    "tests/existing.test.mjs"
  ]);
  assert.deepEqual(projection.excluded_paths, []);
});
