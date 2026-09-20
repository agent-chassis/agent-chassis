import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonBytes, sha256 } from "../lib/exact-binding-common.mjs";
import {
  executeDeterministicProjection,
  executeUncappedIntegrationPrefixProjection,
  runTransformerTwice
} from "../lib/deterministic-projection.mjs";

function documents({ atomic = false } = {}) {
  return [{
    schema_version: "controlled-contract.integration-prefix-dag.v1",
    slices: [{ slice_id: "consumer" }, { slice_id: "producer" }],
    depends_on: [{ predecessor_slice_id: "producer", successor_slice_id: "consumer" }]
  }, {
    schema_version: "controlled-contract.integration-units.v1",
    integration_units: atomic
      ? [{ unit_id: "producer-consumer", slice_ids: ["consumer", "producer"] }]
      : [{ unit_id: "consumer", slice_ids: ["consumer"] },
        { unit_id: "producer", slice_ids: ["producer"] }]
  }, {
    schema_version: "controlled-contract.execution-path-requirements.v1",
    execution_paths: [{
      path_id: "managed-read",
      required_branches: ["target-absent", "target-present"]
    }]
  }];
}

function sourceBytes(options) {
  return documents(options).map((value) => canonicalJsonBytes(value, { file: true }));
}

function capacityDocuments({ unitCount, branchCount }) {
  const slices = Array.from({ length: unitCount }, (_, index) =>
    `slice-${String(index).padStart(2, "0")}`);
  return [{
    schema_version: "controlled-contract.integration-prefix-dag.v1",
    slices: slices.map((slice_id) => ({ slice_id })),
    depends_on: slices.slice(1).map((successor, index) => ({
      predecessor_slice_id: slices[index], successor_slice_id: successor
    }))
  }, {
    schema_version: "controlled-contract.integration-units.v1",
    integration_units: slices.map((sliceId, index) => ({
      unit_id: `unit-${String(index).padStart(2, "0")}`, slice_ids: [sliceId]
    }))
  }, {
    schema_version: "controlled-contract.execution-path-requirements.v1",
    execution_paths: [{
      path_id: "bounded-path",
      required_branches: Array.from({ length: branchCount }, (_, index) =>
        `branch-${String(index).padStart(5, "0")}`)
    }]
  }];
}

test("derives every independently integrable prefix and required branch", () => {
  const census = JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", sourceBytes()
  ));
  assert.deepEqual(census.prefixes.map(({ slice_ids: ids }) => ids.join(",")).sort(),
    ["", "consumer,producer", "producer"]);
  assert.equal(census.cases.length, 6);
});

test("an omitted producer-only prefix changes the derived census bytes", () => {
  const sources = sourceBytes();
  const complete = executeDeterministicProjection("integration-prefix-census.v1", sources);
  const census = JSON.parse(complete);
  const id = census.prefixes.find(({ slice_ids: ids }) =>
    ids.length === 1 && ids[0] === "producer").prefix_id;
  census.prefixes = census.prefixes.filter(({ prefix_id: prefixId }) => prefixId !== id);
  census.cases = census.cases.filter(({ prefix_id: prefixId }) => prefixId !== id);
  assert.notEqual(sha256(canonicalJsonBytes(census, { file: true })), sha256(complete));
});

test("an atomic unit partition derives a different census than independent units", () => {
  const independent = executeDeterministicProjection(
    "integration-prefix-census.v1", sourceBytes()
  );
  const atomic = executeDeterministicProjection(
    "integration-prefix-census.v1", sourceBytes({ atomic: true })
  );
  assert.notEqual(sha256(independent), sha256(atomic));
});

test("a genuinely indivisible integration unit has no producer-only prefix", () => {
  const census = JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", sourceBytes({ atomic: true })
  ));
  assert.equal(census.prefixes.length, 2);
  assert.equal(census.prefixes.some(({ slice_ids: ids }) =>
    ids.length === 1 && ids[0] === "producer"), false);
});

test("noncanonical source bytes, incomplete unit partitions, and DAG cycles are refused", () => {
  const noncanonical = sourceBytes();
  noncanonical[0] = Buffer.from(`${JSON.stringify(documents()[0], null, 2)}\n`);
  assert.throws(() => executeDeterministicProjection(
    "integration-prefix-census.v1", noncanonical
  ));
  const missing = documents();
  missing[1].integration_units.pop();
  assert.throws(() => executeDeterministicProjection("integration-prefix-census.v1",
    missing.map((value) => canonicalJsonBytes(value, { file: true }))));
  const cyclic = documents();
  cyclic[0].depends_on.unshift({
    predecessor_slice_id: "consumer", successor_slice_id: "producer"
  });
  assert.throws(() => executeDeterministicProjection("integration-prefix-census.v1",
    cyclic.map((value) => canonicalJsonBytes(value, { file: true }))));
});

test("nondeterministic package transformers are mechanically refused", () => {
  let count = 0;
  assert.throws(() => runTransformerTwice(() => ({ count: ++count }), [], []), {
    code: "projection_transformer_nondeterministic"
  });
});

test("exact capacity bounds succeed without truncation", () => {
  const units = capacityDocuments({ unitCount: 20, branchCount: 1 })
    .map((value) => canonicalJsonBytes(value, { file: true }));
  assert.equal(JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", units
  )).cases.length, 21);
  const cases = capacityDocuments({ unitCount: 9, branchCount: 10000 })
    .map((value) => canonicalJsonBytes(value, { file: true }));
  assert.equal(JSON.parse(executeDeterministicProjection(
    "integration-prefix-census.v1", cases
  )).cases.length, 100000);
});

test("over-limit populations return the stable typed diagnostic", () => {
  for (const values of [
    capacityDocuments({ unitCount: 21, branchCount: 1 }),
    capacityDocuments({ unitCount: 9, branchCount: 10001 })
  ]) assert.throws(() => executeDeterministicProjection(
    "integration-prefix-census.v1",
    values.map((value) => canonicalJsonBytes(value, { file: true }))
  ), { code: "projection_population_limit_exceeded" });
});

test("package authoring has an explicit uncapped route through the shared census owner", () => {
  const sources = capacityDocuments({ unitCount: 21, branchCount: 1 })
    .map((value) => canonicalJsonBytes(value, { file: true }));
  assert.throws(() => executeDeterministicProjection(
    "integration-prefix-census.v1", sources
  ), { code: "projection_population_limit_exceeded" });
  const result = JSON.parse(executeUncappedIntegrationPrefixProjection(sources));
  assert.equal(result.prefixes.length, 22);
  assert.equal(result.cases.length, 22);
});

test("repeated derivation remains deterministic", () => {
  const sources = sourceBytes();
  assert.equal(new Set(Array.from({ length: 25 }, () => sha256(
    executeDeterministicProjection("integration-prefix-census.v1", sources)
  ))).size, 1);
});
