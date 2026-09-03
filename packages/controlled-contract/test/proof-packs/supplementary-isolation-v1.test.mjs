import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJsonBytes } from "../../lib/exact-binding-common.mjs";

import {
  assertCanonicalProjectionResult,
  executeDeterministicProjection,
  prepareDeterministicProjection,
  validateDeterministicProjectionGraph,
  validateDeterministicProjectionPopulation,
  validateDeterministicProjectionReference,
  validateDeterministicProjectionRelation
} from "../../lib/deterministic-projection.mjs";
import { buildSupplementaryIsolationSources } from "./supplementary-isolation-v1-fixture.mjs";

const transformerId = "supplementary-isolation-attempt-record.v1";

test("supplementary-isolation transformer is registered with exact projection surfaces", () => {
  const fixture = buildSupplementaryIsolationSources();
  const resultBytes = executeDeterministicProjection(transformerId, fixture.sourceBytes);
  const result = assertCanonicalProjectionResult(transformerId, resultBytes);
  assert.equal(result.schema_version,
    "controlled-acceptance-contract.experimental.v0.2");
  const prepared = prepareDeterministicProjection(transformerId, resultBytes);
  assert.deepEqual(prepared.population("core-members"), ["ref-core-member-a", "ref-core-member-b"]);
  assert.deepEqual(prepared.population("supplementary-results"), []);
  assert.equal(prepared.reference("attempt").reference_id, "ref-attempt");
  assert.equal(prepared.reference("supplementary-failure-reason").reference_id,
    "ref-failure-reason-selected");
  assert.equal(prepared.graph("supplementary-isolation-contract").claims.length,
    result.claims.length);
  assert.deepEqual(validateDeterministicProjectionRelation({
    relation_id: "derive-supplementary-isolation-attempt",
    transformer_id: transformerId,
    source_requirement_ids: ["a", "b", "c", "d"]
  }), []);
  assert.deepEqual(validateDeterministicProjectionPopulation(transformerId,
    "supplementary-results"), []);
  assert.deepEqual(validateDeterministicProjectionReference(transformerId, "attempt"), []);
  assert.deepEqual(validateDeterministicProjectionGraph(transformerId,
    "supplementary-isolation-contract"), []);
});

test("transformer derives both closed disclosure forms and no supplementary result", () => {
  for (const branch of ["present", "omitted"]) {
    const fixture = buildSupplementaryIsolationSources({ branch });
    const prepared = prepareDeterministicProjection(transformerId, fixture.projectionBytes);
    assert.deepEqual(prepared.population("supplementary-results"), [], branch);
    assert.equal(prepared.population("disclosed-omissions").length,
      branch === "omitted" ? 1 : 0, branch);
  }
});

test("projection records guarantee-breaking capture facts instead of laundering them", () => {
  const cases = [
    ["substituted-members", { finalCoreMembers: ["ref-core-member-a", "ref-core-member-c"] },
      "prop-sfi-core-members-forward"],
    ["false-count", { declaredCoreMemberCount: 99 }, "prop-sfi-core-member-count-captured"],
    ["supplementary-result", { supplementaryResults: ["ref-supplementary-result"] },
      "prop-sfi-supplementary-result-count-captured"],
    ["failure-before-settlement", { settlementSequence: 20, failureSequence: 10 },
      "prop-sfi-settlement-precedes-failure"],
    ["final-before-failure", { failureSequence: 30, finalSequence: 20 },
      "prop-sfi-failure-precedes-final"],
    ["changed-final-core-value", { finalCoreValue: "ref-different-final-core-value" },
      "prop-sfi-final-core-value"]
  ];
  for (const [label, options, propositionId] of cases) {
    const contract = JSON.parse(buildSupplementaryIsolationSources(options).projectionBytes);
    if (label === "false-count" || label === "supplementary-result") {
      assert.ok(contract.propositions.some(({ proposition_id: id }) => id === propositionId), label);
    } else {
      assert.equal(contract.propositions.some(({ proposition_id: id }) => id === propositionId), false,
        label);
    }
  }
});

test("cross-attempt source splicing is refused", () => {
  const primary = buildSupplementaryIsolationSources({ attemptSuffix: "primary" });
  const alternate = buildSupplementaryIsolationSources({ attemptSuffix: "alternate" });
  assert.throws(() => executeDeterministicProjection(transformerId, [
    primary.sourceBytes[0], alternate.sourceBytes[1], primary.sourceBytes[2], primary.sourceBytes[3]
  ]), ({ code }) => code === "supplementary_isolation_capture_splice");
});

test("event-specific captures must equal the attempt occurrence census", () => {
  for (const [label, options, kind] of [
    ["settlement", { settlements: 2 }, "core_settlement"],
    ["failure", { failures: 2 }, "supplementary_failure"],
    ["final-result", { results: 2 }, "final_result"]
  ]) {
    const fixture = buildSupplementaryIsolationSources(options);
    const attempt = structuredClone(fixture.attemptRecord);
    const indexes = attempt.occurrences.flatMap((entry, index) => entry.kind === kind ? [index] : []);
    attempt.occurrences.splice(indexes.at(-1), 1);
    assert.throws(() => executeDeterministicProjection(transformerId, [
      canonicalJsonBytes(attempt, { file: true }), ...fixture.sourceBytes.slice(1)
    ]), ({ code }) => code === "supplementary_isolation_occurrence_capture_mismatch", label);
  }
});
