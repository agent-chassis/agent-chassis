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

const obligationDigest = `sha256:${"c".repeat(64)}`;
const READINESS_PROFILE_ID = "proof.design.implementation-readiness";
const DORMANCY_PROFILE_ID = "proof.dormancy.nonactivation";

const readinessSnapshot = await loadAdmittedProofPack(READINESS_PROFILE_ID);
const dormancySnapshot = await loadAdmittedProofPack(DORMANCY_PROFILE_ID);

function genuineAssessment(snapshot, build) {
  const fixture = build({ profile: snapshot.profile });
  return evaluateStableProofPackFixtureV1({
    contract: fixture.contract, profile: snapshot.profile,
    evaluation_input: fixture.input
  });
}

const readinessAssessment = genuineAssessment(
  readinessSnapshot, buildImplementationReadinessFixture
);
const dormancyAssessment = genuineAssessment(
  dormancySnapshot, buildDormancyNonactivationFixture
);
const READINESS_COMPONENT = "design-names-grounded-loci";
const READINESS_NODE = "claim-design-names-grounded-loci";
const DORMANCY_COMPONENT = "activation-population-is-empty";
const DORMANCY_NODE = "claim-activation-population-is-empty";

function selectorPack(packId, { input = true, evaluated = true,
  exact = false, profileDiscrimination = "proven" } = {}) {
  const snapshot = exact ? dormancySnapshot : readinessSnapshot;
  const assessment = exact ? dormancyAssessment : readinessAssessment;
  return {
    pack_id: packId,
    requested_intents: ["implementation-readiness"],
    pack_snapshot: snapshot,
    assessment: evaluated ? assessment : null,
    evaluation_input_present: input,
    profile_discrimination: profileDiscrimination,
    exact_binding: null
  };
}

function obligationRow(id, proof, nodeId = `node-${id.toLowerCase()}`) {
  return {
    obligation_id: id,
    source_locator: `/acceptance/criteria/${Number(id.slice(4)) - 1}`,
    source_locator_digest: obligationDigest,
    statement: `Implement ${id} exactly.`,
    controlled_contract_node_ids: [nodeId],
    mechanism: { owner: "packages/example.mjs", kind: "code_symbol",
      selector: `owner-${id.toLowerCase()}` },
    proof
  };
}

function obligationMapping(packId, componentId = READINESS_COMPONENT,
  profileId = READINESS_PROFILE_ID) {
  const profileVersion = profileId === DORMANCY_PROFILE_ID
    ? dormancySnapshot.profile.profile_version
    : readinessSnapshot.profile.profile_version;
  return { kind: "pack_mapping", pack_id: packId,
    requested_intent: "implementation-readiness",
    profile_id: profileId, profile_version: profileVersion,
    selector: { kind: "claim", component_id: componentId },
    evaluation_stage: "pre_dispatch" };
}

test("obligation evaluation exports the eight exclusive outcomes and applies the reachable seven", () => {
  assert.deepEqual(OBLIGATION_COVERAGE_OUTCOMES, [
    "stale", "unmapped", "explicit_gap", "guarantee_incompatible",
    "mapped_input_missing", "mapped_pack_not_evaluated",
    "profile_proven_exact_binding_missing", "mechanically_proven"
  ]);
  const packs = [
    selectorPack("stale"), selectorPack("unmapped"), selectorPack("incompatible"),
    selectorPack("missing", { input: false }),
    selectorPack("unevaluated", { evaluated: false }),
    selectorPack("exact", { exact: true }), selectorPack("applicability")
  ];
  const obligations = [
    obligationRow("OBL-001", obligationMapping("stale"), READINESS_NODE),
    obligationRow("OBL-002", obligationMapping("unmapped"), "node-unmapped"),
    obligationRow("OBL-003", { kind: "explicit_gap", gap_kind: "catalog_gap",
      reason: "No admitted proof component." }, "node-gap"),
    obligationRow("OBL-004", obligationMapping("incompatible", "unknown-component"),
      "node-incompatible"),
    obligationRow("OBL-005", obligationMapping("missing"), "node-missing"),
    obligationRow("OBL-006", obligationMapping("unevaluated"), "node-unevaluated"),
    obligationRow("OBL-007", obligationMapping("exact", DORMANCY_COMPONENT,
      DORMANCY_PROFILE_ID), DORMANCY_NODE),
    obligationRow("OBL-008", obligationMapping("applicability"), READINESS_NODE)
  ];
  const result = evaluateAcceptanceCoverage({
    obligationCoverage: { schema_version:
      "controlled-contract-obligation-coverage.v1", wk_id: "WK-2095", obligations },
    guaranteeSelectorIndex: buildObligationGuaranteeSelectorIndex({ packs }),
    selectedPackIds: ["stale", "incompatible", "missing", "unevaluated", "exact",
      "applicability"],
    staleObligationIds: ["OBL-001"]
  });

  assert.deepEqual(result.obligation_outcomes.map(({ outcome }) => outcome), [
    "stale", "unmapped", "explicit_gap", "guarantee_incompatible",
    "mapped_input_missing", "mapped_pack_not_evaluated",
    "profile_proven_exact_binding_missing", "guarantee_incompatible"
  ]);
  assert.equal(result.obligation_outcomes[7].reason,
    "component_applicability_unproven");
  assert.deepEqual(result.outcome_precedence, OBLIGATION_COVERAGE_OUTCOMES);
  assert.equal(new Set(result.obligation_outcomes.map(
    ({ obligation_id: id }) => id)).size, 8);
  assert.equal(result.obligation_outcomes.filter(
    ({ outcome }) => outcome === "mechanically_proven").length, 0);
  assert.equal(result.complete, false);
});

test("stale wins before proof and profile discrimination alone never proves a row", () => {
  const packs = [selectorPack("proof")];
  const carrier = { schema_version: "controlled-contract-obligation-coverage.v1",
    wk_id: "WK-2095", obligations: [
      obligationRow("OBL-001", obligationMapping("proof"), READINESS_NODE),
      obligationRow("OBL-002", obligationMapping("proof", "whole-profile"), "node-other")
    ] };
  const result = evaluateAcceptanceCoverage({ obligationCoverage: carrier,
    guaranteeSelectorIndex: buildObligationGuaranteeSelectorIndex({ packs }),
    selectedPackIds: ["proof"], staleObligationIds: ["OBL-001"] });
  assert.equal(result.obligation_outcomes[0].outcome, "stale");
  assert.equal(result.obligation_outcomes[1].outcome, "guarantee_incompatible");
  assert.equal(result.obligation_outcomes[1].reason, "unknown_selector");
});

test("orphan selected packs are blocking diagnostics", () => {
  const packs = [selectorPack("proof"), selectorPack("orphan")];
  const result = evaluateAcceptanceCoverage({
    obligationCoverage: { schema_version:
      "controlled-contract-obligation-coverage.v1", wk_id: "WK-2095",
    obligations: [obligationRow("OBL-001", obligationMapping("proof"),
      READINESS_NODE)] },
    guaranteeSelectorIndex: buildObligationGuaranteeSelectorIndex({ packs }),
    selectedPackIds: ["proof", "orphan"]
  });
  assert.equal(result.obligation_outcomes[0].outcome, "guarantee_incompatible");
  assert.deepEqual(result.orphan_selected_pack_ids, ["orphan"]);
  assert.equal(result.diagnostics[0].severity, "blocking");
  assert.equal(result.complete, false);
  assert.equal(isAcceptanceCoverageComplete(result), false);
});

test("malformed obligation carriers refuse instead of degrading", () => {
  assert.throws(() => evaluateAcceptanceCoverage({
    obligationCoverage: { schema_version:
      "controlled-contract-obligation-coverage.v1", wk_id: "WK-2095",
    obligations: [], total: 0 },
    guaranteeSelectorIndex: buildObligationGuaranteeSelectorIndex({ packs: [] }),
    selectedPackIds: []
  }), (error) => error instanceof AcceptanceCoverageError &&
    error.code === "acceptance_coverage_obligation_carrier_invalid");
});

test("legacy criterion coverage imports and distinctions remain unchanged", () => {
  const result = evaluateAcceptanceCoverage(base);
  assert.equal(result.mode, undefined);
  assert.equal(Array.isArray(result.states), true);
  assert.equal(Object.hasOwn(result, "obligation_outcomes"), false);
  assert.equal(result.states[0].state, "covered");
});
