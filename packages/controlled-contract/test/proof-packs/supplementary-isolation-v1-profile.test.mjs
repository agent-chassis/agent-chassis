import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStableTestProofPopulation,
  evaluateStableProofPackFixtureV1,
  validateProfileSchemaV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../lib/stable-v1-migration.mjs";
import { buildSupplementaryIsolationSources } from "./supplementary-isolation-v1-fixture.mjs";
import {
  buildSupplementaryIsolationEvaluationInput,
  buildSupplementaryIsolationProfile
} from "./supplementary-isolation-v1-profile.mjs";
import { runProofPackAdequacyControls } from "./supplementary-isolation-v1-adequacy.mjs";

function evaluation(options = {}, mutate = ({ contract, evaluation_input, profile }) => ({
  contract, evaluation_input, profile
})) {
  const sourceContract = JSON.parse(
    buildSupplementaryIsolationSources(options).projectionBytes
  );
  const contract = migrateControlledAcceptanceContractV02ToV1({
    contract: sourceContract,
    testProofs: buildStableTestProofPopulation(sourceContract)
  });
  const profile = buildSupplementaryIsolationProfile();
  const evaluation_input = buildSupplementaryIsolationEvaluationInput(contract);
  return evaluateStableProofPackFixtureV1(mutate({ contract, evaluation_input, profile }));
}

test("exact-bound profile is schema-valid and uses one conjunctive exactly-one local branch", () => {
  const profile = buildSupplementaryIsolationProfile();
  assert.equal(validateProfileSchemaV1(profile), true);
  assert.deepEqual(validateProfileSemanticsV1(profile), []);
  assert.deepEqual(Object.keys(profile.satisfaction_expression), ["all_of"]);
  const alternatives = profile.satisfaction_expression.all_of.filter(({ any_of: value }) => value);
  assert.equal(alternatives.length, 1);
  assert.equal(alternatives[0].branch_cardinality, "exactly_one");
  assert.equal(Object.hasOwn(profile, "falsifier_occurrence_bindings"), false);
  assert.equal(profile.reference_binding_patterns.some(({ comparison }) =>
    comparison === "same_reference"), false);
});

test("truthful present and omitted exact captures satisfy", () => {
  for (const branch of ["present", "omitted"]) {
    assert.equal(evaluation({ branch }).satisfaction, "satisfied", branch);
  }
});

test("captured counterexamples independently fail profile satisfaction", () => {
  const cases = {
    "equal-cardinality-substituted-membership": {
      finalCoreMembers: ["ref-core-member-a", "ref-core-member-c"]
    },
    "identical-membership-false-count": { declaredCoreMemberCount: 99 },
    "dropped-core-member": { finalCoreMembers: ["ref-core-member-a"] },
    "supplementary-result-despite-unavailable": {
      supplementaryResults: ["ref-supplementary-result"], declaredResultCount: 1
    },
    "failure-before-settlement": { settlementSequence: 20, failureSequence: 10 },
    "final-before-failure": { failureSequence: 30, finalSequence: 20 },
    "multiple-settlements": { settlements: 2 },
    "multiple-failures": { failures: 2 },
    "multiple-final-results": { results: 2 },
    "wrong-reason": { disclosedReasons: ["ref-failure-reason-other"] },
    "multiple-reasons": {
      disclosedReasons: ["ref-failure-reason-selected", "ref-failure-reason-other"]
    },
    "missing-disclosure": { disclosedReasons: [] },
    "changed-final-core-value": { finalCoreValue: "ref-different-final-core-value" }
  };
  for (const [label, options] of Object.entries(cases)) {
    assert.notEqual(evaluation(options).satisfaction, "satisfied", label);
  }
});

test("equality aliases cannot launder substituted captured membership", () => {
  const result = evaluation({ finalCoreMembers: ["ref-core-member-a", "ref-core-member-c"] },
    ({ contract, evaluation_input, profile }) => {
      contract.propositions.push({
        proposition_id: "prop-authored-alias",
        subject_reference_id: "ref-core-member-c",
        operator: "reference:equals",
        applicability_context: { mode: "during", operand_reference_ids: ["ref-attempt"] },
        operands: [{ kind: "reference", reference_id: "ref-core-member-b" }]
      });
      contract.claims.push({ claim_id: "claim-authored-alias", kind: "evidence", modality: "MUST",
        proposition_id: "prop-authored-alias" });
      return { contract, evaluation_input, profile };
    });
  assert.notEqual(result.satisfaction, "satisfied");
});

test("every guarantee-critical profile weakening has a functional negative witness", async () => {
  const profile = buildSupplementaryIsolationProfile();
  const run = await runProofPackAdequacyControls({ profile, profile_digest: "0".repeat(64) });
  const controls = run.controls.filter(({ control_id: id }) => id.startsWith("weakening-"));
  assert.ok(controls.length >= 11);
  assert.deepEqual(controls.filter(({ implementation_outcome: outcome }) => outcome !== "killed"), []);
});
