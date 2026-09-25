import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import {
  ACCEPTANCE_COVERAGE_STATES,
  AcceptanceCoverageError,
  GAP_WARNING,
  OBLIGATION_COVERAGE_OUTCOMES,
  RESULT_PRECEDENCE,
  evaluateAcceptanceCoverage,
  isAcceptanceCoverageComplete
} from "../lib/acceptance-coverage.mjs";
import { deriveCriterionIdentitySet } from "../lib/acceptance-coverage-identity.mjs";
import { loadAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import { buildObligationGuaranteeSelectorIndex }
  from "../lib/obligation-coverage-guarantee-selectors.mjs";
import { buildDormancyNonactivationFixture }
  from "./proof-packs/dormancy-nonactivation-v1-fixture.mjs";
import { buildImplementationReadinessFixture }
  from "./proof-packs/implementation-readiness-v1-adequacy.mjs";
import { evaluateStableProofPackFixtureV1 }
  from "./support/stable-v1-proof-pack-runtime.mjs";

const identitySet = deriveCriterionIdentitySet({
  criteria: ["covered", "uncovered", "duplicate", "unknown", "outside", "residue", "bad"],
  selectedUnitDigest: "unit", bindings: {
    contractDigest: "contract", proofPlanDigest: "plan", selectedPackDigest: "pack",
    mappingDigest: "mapping"
  }
});
const [covered, uncovered, duplicate, unknown, outside, residue, infeasible] =
  identitySet.identities.map(({ identity }) => identity);
const base = {
  criteria: identitySet,
  contractNodes: [{ id: "node-covered" }, { id: "node-duplicate" }, { id: "node-outside" }],
  selectedPackNodeIds: ["node-covered", "node-duplicate"],
  mappings: [{ criterionIdentity: covered, nodeIds: ["node-covered"] }]
};

test("exports the fixed state vocabulary", () => {
  assert.deepEqual(ACCEPTANCE_COVERAGE_STATES, [
    "covered", "uncovered", "duplicate", "unknown", "stale", "outside_pack",
    "retained_residue", "infeasible"
  ]);
});

test("exports and uses the evaluator result precedence", () => {
  assert.deepEqual(RESULT_PRECEDENCE, [
    "stale", "duplicate", "infeasible", "retained_residue", "unknown",
    "outside_pack", "uncovered", "covered"
  ]);
  const result = evaluateAcceptanceCoverage({ ...base, mappings: [
    { criterionIdentity: covered, nodeIds: ["node-covered"] },
    { criterionIdentity: covered, residue: true },
    { criterionIdentity: covered, infeasible: true }
  ] });
  assert.equal(result.states[0].state, RESULT_PRECEDENCE[2]);
  assert.deepEqual(result.merge_precedence, RESULT_PRECEDENCE);
});

test("classifies complete, missing, duplicate, unknown, outside-pack, residue and infeasible mappings", () => {
  const result = evaluateAcceptanceCoverage({
    ...base,
    mappings: [
      { criterionIdentity: covered, nodeIds: ["node-covered"] },
      { criterionIdentity: duplicate, nodeIds: ["node-duplicate", "node-duplicate"] },
      { criterionIdentity: unknown, nodeIds: ["node-missing"] },
      { criterionIdentity: outside, nodeIds: ["node-outside"] },
      { criterionIdentity: residue, residue: true },
      { criterionIdentity: infeasible, infeasible: true }
    ]
  });
  assert.deepEqual(Object.fromEntries(result.states.map(({ criterion_identity, state }) =>
    [criterion_identity, state])), {
    [covered]: "covered", [uncovered]: "uncovered", [duplicate]: "duplicate",
    [unknown]: "unknown", [outside]: "outside_pack", [residue]: "retained_residue",
    [infeasible]: "infeasible"
  });
  assert.equal(result.complete, false);
  assert.deepEqual(result.warnings, [GAP_WARNING]);
});

test("unknown criterion mappings are reported separately without claiming coverage", () => {
  const result = evaluateAcceptanceCoverage({ ...base, mappings: [
    { criterionIdentity: "not-in-the-identity-set", nodeIds: ["node-covered"] }
  ] });
  assert.deepEqual(result.unknown_mappings.map(({ state }) => state), ["unknown"]);
  assert.equal(result.states[0].state, "uncovered");
});

test("stale identity sets make every current criterion stale", () => {
  const changed = deriveCriterionIdentitySet({
    criteria: ["changed", "uncovered", "duplicate", "unknown", "outside", "residue", "bad"],
    selectedUnitDigest: "unit", bindings: identitySet.bindings
  });
  const result = evaluateAcceptanceCoverage({ ...base, criteria: changed,
    priorCriterionIdentities: identitySet });
  assert.equal(result.stale, true);
  assert.equal(new Set(result.states.map(({ state }) => state)).size, 1);
  assert.equal(result.states[0].state, "stale");
  assert.equal(result.mapping_outcomes[0].state, "unknown");
});

test("a complete evaluation emits no marker warning", () => {
  const result = evaluateAcceptanceCoverage({
    criteria: { ...identitySet, identities: [identitySet.identities[0]] },
    contractNodes: [{ id: "node-covered" }], selectedPackNodeIds: ["node-covered"],
    mappings: [{ criterionIdentity: covered, nodeIds: ["node-covered"] }]
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(isAcceptanceCoverageComplete(result), true);
});

test("duplicate identities in the current set cannot share one covered mapping", () => {
  const duplicateSet = { ...identitySet, identities: [
    { ...identitySet.identities[0], identity: "typed:T-1", source: "typed" },
    { ...identitySet.identities[1], identity: "typed:T-1", source: "typed" }
  ] };
  const result = evaluateAcceptanceCoverage({ ...base, criteria: duplicateSet,
    mappings: [{ criterionIdentity: "typed:T-1", nodeIds: ["node-covered"] }] });
  assert.deepEqual(result.states.map(({ state }) => state), ["duplicate", "duplicate"]);
  assert.deepEqual(result.mapping_outcomes.map(({ state }) => state), ["covered"]);
  assert.notEqual(result.complete, true);
});

test("mapping outcomes preserve the cause of a mixed criterion gap", () => {
  const result = evaluateAcceptanceCoverage({ ...base, mappings: [
    { criterionIdentity: covered, nodeIds: ["node-covered"] },
    { criterionIdentity: covered, nodeIds: ["node-missing"] }
  ] });
  assert.equal(result.states[0].state, "unknown");
  assert.deepEqual(result.mapping_outcomes.map(({ state }) => state), ["covered", "unknown"]);
});

test("comparison details and stale disposition survive criterion and binding changes", () => {
  const changed = { ...identitySet, identities: [
    { ...identitySet.identities[0], text: "changed", source: "typed", identity: "typed:T-1" }
  ] };
  const priorTyped = { ...identitySet, identities: [
    { ...identitySet.identities[0], source: "typed", identity: "typed:T-1" }
  ] };
  const changedResult = evaluateAcceptanceCoverage({ ...base, criteria: changed, priorCriterionIdentities: priorTyped });
  assert.equal(changedResult.stale, true);
  assert.equal(changedResult.states[0].state, "stale");
  assert.equal(changedResult.identity_comparison.staleCriteria[0].reason, "changed");
  const bindingSet = deriveCriterionIdentitySet({ criteria: ["covered", "uncovered", "duplicate", "unknown", "outside", "residue", "bad"], selectedUnitDigest: "unit", bindings: { ...identitySet.bindings, contractDigest: "changed" } });
  const bindingResult = evaluateAcceptanceCoverage({ ...base, priorCriterionIdentities: identitySet, criteria: bindingSet });
  assert.deepEqual(bindingResult.identity_comparison.bindingChanges, ["contractDigest"]);
  assert.ok(bindingResult.states.every(({ state }) => state === "stale"));
  assert.equal(bindingResult.mapping_outcomes[0].state, "covered");
});

test("reports mandatory nodes with no authored mapping and validates warning against the published schema", async () => {
  const result = evaluateAcceptanceCoverage({ ...base, contractNodes: [
    { id: "node-covered", mandatory: true }, { id: "node-required", mandatory: true }
  ] });
  assert.deepEqual(result.unmapped_mandatory_node_ids, ["node-required"]);
  assert.equal(result.complete, false);
  assert.equal(isAcceptanceCoverageComplete(result), false);
  const schema = JSON.parse(await readFile(join(import.meta.dirname,
    "../schema/acceptance-coverage-gap-warning.v1.schema.json"), "utf8"));
  const validate = new Ajv2020().compile(schema);
  assert.equal(validate(result.warnings[0]), true);
});

test("gap-state mappings do not discharge mandatory nodes", () => {
  const duplicateSet = { ...identitySet, identities: [
    { ...identitySet.identities[0], identity: "typed:T-1", source: "typed" },
    { ...identitySet.identities[1], identity: "typed:T-1", source: "typed" }
  ] };
  const duplicateResult = evaluateAcceptanceCoverage({
    ...base,
    criteria: duplicateSet,
    contractNodes: [{ id: "node-covered", mandatory: true }],
    mappings: [{ criterionIdentity: "typed:T-1", nodeIds: ["node-covered"] }]
  });
  assert.deepEqual(duplicateResult.unmapped_mandatory_node_ids, ["node-covered"]);

  const outsideResult = evaluateAcceptanceCoverage({
    ...base,
    contractNodes: [{ id: "node-outside", mandatory: true }],
    selectedPackNodeIds: [],
    mappings: [{ criterionIdentity: covered, nodeIds: ["node-outside"] }]
  });
  assert.deepEqual(outsideResult.unmapped_mandatory_node_ids, ["node-outside"]);
});

test("rejects non-canonical input spellings", () => {
  for (const key of ["criterionIdentities", "criterion_identity_set", "authoredMappings", "authored_mappings", "contract_nodes", "selected_pack_node_ids", "stale"]) {
    assert.throws(() => evaluateAcceptanceCoverage({ ...base, [key]: key === "stale" ? true : [] }), AcceptanceCoverageError);
  }
  assert.throws(() => evaluateAcceptanceCoverage({ ...base, mappings: [{ criterion_identity: covered, node_ids: ["node-covered"] }] }), AcceptanceCoverageError);
  assert.throws(() => evaluateAcceptanceCoverage({ ...base, contractNodes: [{ nodeId: "node-covered" }] }), AcceptanceCoverageError);
  assert.throws(() => evaluateAcceptanceCoverage({ ...base,
    contractNodes: [{ id: "node-covered", manditory: true }] }), AcceptanceCoverageError);
  assert.throws(() => evaluateAcceptanceCoverage({ ...base,
    contractNodes: [{ id: "node-covered", mandatory: "yes" }] }), AcceptanceCoverageError);
});

test("rejects non-boolean mapping flags before classification", () => {
  for (const flag of ["residue", "infeasible"]) {
    assert.throws(
      () => evaluateAcceptanceCoverage({ ...base, mappings: [{
        criterionIdentity: covered, nodeIds: ["node-covered"], [flag]: "true"
      }] }),
      (error) => error instanceof AcceptanceCoverageError &&
        error.code === "acceptance_coverage_input_invalid" &&
        error.message === `mappings[0].${flag} must be a boolean`
    );
  }
});

test("rejects duplicate contract node identities before Map collapse", () => {
  assert.throws(
    () => evaluateAcceptanceCoverage({ ...base,
      contractNodes: [{ id: "node-covered" }, { id: "node-covered", mandatory: true }] }),
    (error) => error instanceof AcceptanceCoverageError &&
      error.code === "acceptance_coverage_duplicate_contract_node_identity" &&
      error.message === "contractNodes contains duplicate id: node-covered"
  );
});

test("uses shared identity entry validation and preserves evaluator errors", () => {
  assert.throws(
    () => evaluateAcceptanceCoverage({ ...base, criteria: {
      ...identitySet, identities: [{ ...identitySet.identities[0], unsupported: true }]
    } }),
    (error) => error instanceof AcceptanceCoverageError &&
      error.code === "acceptance_coverage_input_invalid" &&
      /unsupported keys/u.test(error.message)
  );
});

test("validation messages describe only the accepted input shape", () => {
  assert.throws(
    () => evaluateAcceptanceCoverage({ ...base, criteria: {
      ...identitySet, identities: [covered]
    } }),
    (error) => error instanceof AcceptanceCoverageError &&
      /criteria\.identities\[0\] must be an identity object/u.test(error.message) &&
      !/criterionIdentities|identity string/u.test(error.message)
  );
  assert.throws(
    () => evaluateAcceptanceCoverage({ ...base, mappings: [{ nodeIds: [] }] }),
    (error) => error instanceof AcceptanceCoverageError &&
      /mappings\[0\]\.criterionIdentity/u.test(error.message) &&
      !/authoredMappings/u.test(error.message)
  );
});

import { pinProofSelection } from '../lib/proof-authoring-selection.mjs';
import { resolveProofAuthoring } from '../lib/proof-authoring-resolution.mjs';
test('real saved selections evaluate as design associations and never prove execution', async () => {
  const selection = { ...await pinProofSelection('proof.verification.test-validity'), parameters: {} };
  const resolution = await resolveProofAuthoring({ schema_version: 'controlled-contract-obligation-coverage.v3',
    wk_id: 'WK-2095', selected_unit: null, focus: null,
    obligations: [{ obligation_id: 'OBL-ONE', statement: 'Author one association', selection }] },
  { source_digest: `sha256:${'c'.repeat(64)}` });
  const evaluation = evaluateAcceptanceCoverage({ obligationCoverage: resolution.mapping });
  assert.equal(evaluation.complete, false);
  assert.equal(evaluation.obligation_outcomes[0].outcome, 'design_invalid');
  assert.deepEqual(evaluation.obligation_outcomes[0].selection, selection);
  const stale = evaluateAcceptanceCoverage({ obligationCoverage: resolution.mapping, staleObligationIds: ['OBL-ONE'] });
  assert.equal(stale.obligation_outcomes[0].outcome, 'stale');
  assert.throws(() => evaluateAcceptanceCoverage({ obligationCoverage: resolution.mapping, staleObligationIds: ['OBL-ABSENT'] }),
    { code: 'acceptance_coverage_stale_obligation_unknown' });
  assert.deepEqual(OBLIGATION_COVERAGE_OUTCOMES,
    ['stale', 'design_invalid', 'selected']);

  const valid = structuredClone(resolution.mapping); valid.obligations[0].diagnostics = [];
  valid.obligations[0].design_status = 'valid';
  valid.obligations[0].selected_proof_assessment.readiness_status = 'complete';
  valid.obligations[0].selected_proof_assessment.prevents_selected_route = false;
  valid.obligations[0].selected_proof_assessment.stages.authored_inputs = {
    status: 'complete', diagnostic_codes: [], blocking_diagnostic_codes: [],
    nonblocking_diagnostic_codes: [], unresolved_diagnostic_codes: []
  };
  valid.obligations[0].selected_proof_assessment.stages.system_capability = {
    ...valid.obligations[0].selected_proof_assessment.stages.system_capability,
    diagnostic_codes: [], blocking_diagnostic_codes: [],
    nonblocking_diagnostic_codes: [], unresolved_diagnostic_codes: []
  };
  const selected = evaluateAcceptanceCoverage({ obligationCoverage: valid });
  assert.equal(selected.obligation_outcomes[0].outcome, 'selected');
  assert.equal(selected.complete, false);
});
