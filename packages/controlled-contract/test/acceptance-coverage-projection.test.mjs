import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCEPTANCE_COVERAGE_AXES,
  AcceptanceCoverageProjectionError,
  projectAcceptanceCoverage
} from "../lib/acceptance-coverage-projection.mjs";
import {
  OBLIGATION_COVERAGE_OUTCOMES,
  evaluateAcceptanceCoverage
} from "../lib/acceptance-coverage.mjs";
import { deriveCriterionIdentitySet } from "../lib/acceptance-coverage-identity.mjs";
import { loadAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import { buildObligationGuaranteeSelectorIndex }
  from "../lib/obligation-coverage-guarantee-selectors.mjs";
import { buildImplementationReadinessFixture }
  from "./proof-packs/implementation-readiness-v1-adequacy.mjs";
import { evaluateStableProofPackFixtureV1 }
  from "./support/stable-v1-proof-pack-runtime.mjs";

const criteria = [
  "uncovered criterion", "outside pack", "structural gap", "missing owner",
  "missing verification", "scope conflict", "fully covered"
];
const bindings = {
  contractDigest: "contract", proofPlanDigest: "plan",
  selectedPackDigest: "pack", mappingDigest: "mapping"
};

function fixture(selectedUnitDigest = "unit", criterionTexts = criteria) {
  const criterionIdentities = deriveCriterionIdentitySet({
    criteria: criterionTexts, selectedUnitDigest, bindings
  });
  const ids = criterionIdentities.identities.map(({ identity }) => identity);
  const evaluation = evaluateAcceptanceCoverage({
    criteria: criterionIdentities,
    contractNodes: [
      { id: "node-outside" }, { id: "node-shared" }, { id: "node-owner" },
      { id: "node-verification" }, { id: "node-scope" },
      { id: "node-mandatory", mandatory: true }
    ],
    selectedPackNodeIds: [
      "node-shared", "node-owner", "node-verification", "node-scope"
    ],
    mappings: [
      { criterionIdentity: ids[1], nodeIds: ["node-outside"] },
      { criterionIdentity: ids[2], nodeIds: ["node-shared"] },
      { criterionIdentity: ids[3], nodeIds: ["node-owner"] },
      { criterionIdentity: ids[4], nodeIds: ["node-verification"] },
      { criterionIdentity: ids[5], nodeIds: ["node-scope"] },
      { criterionIdentity: ids[6], nodeIds: ["node-shared"] }
    ]
  });
  const criterionAxes = ids.map((criterionIdentity) => ({
    criterionIdentity,
    structuralVerification: "covered",
    implementationOwnership: "covered",
    verificationOwnership: "covered",
    scopeFeasibility: "covered"
  }));
  criterionAxes[2].structuralVerification = "uncovered";
  criterionAxes[3].implementationOwnership = "uncovered";
  criterionAxes[4].verificationOwnership = "uncovered";
  criterionAxes[5].scopeFeasibility = "infeasible";
  return { criterionIdentities, evaluation, criterionAxes, ids };
}

function projectionInput({ criterionIdentities, evaluation, criterionAxes }, extra = {}) {
  return { criterionIdentities, evaluation, criterionAxes, ...extra };
}

function completeFixture() {
  const criterionIdentities = deriveCriterionIdentitySet({
    criteria: ["complete criterion"], selectedUnitDigest: "unit", bindings
  });
  const identity = criterionIdentities.identities[0].identity;
  const evaluation = evaluateAcceptanceCoverage({
    criteria: criterionIdentities,
    contractNodes: [{ id: "node-complete", mandatory: true }],
    selectedPackNodeIds: ["node-complete"],
    mappings: [{ criterionIdentity: identity, nodeIds: ["node-complete"] }]
  });
  return {
    criterionIdentities, evaluation,
    criterionAxes: [{ criterionIdentity: identity,
      structuralVerification: "covered", implementationOwnership: "covered",
      verificationOwnership: "covered", scopeFeasibility: "covered" }]
  };
}

test("reports all six axes separately with only canonical states", () => {
  const input = fixture();
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  assert.deepEqual(result.axes.map(({ axis }) => axis), ACCEPTANCE_COVERAGE_AXES);
  assert.deepEqual(Object.fromEntries(result.axes.map(({ axis, state }) =>
    [axis, state])), {
    authored_contract_coverage: "uncovered",
    structural_verification: "uncovered",
    selected_pack_guarantee_coverage: "outside_pack",
    implementation_ownership: "uncovered",
    verification_ownership: "uncovered",
    scope_feasibility: "infeasible"
  });
  assert.equal(result.totals.criteria, criteria.length);
  assert.equal(result.totals.fully_covered_criteria, 1);
  assert.equal(result.covered_detail.total, 1);
});

test("the default is gap-first and contains no covered detail", () => {
  const input = fixture();
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  assert.deepEqual(result.page.items.map(({ axis }) => axis), [
    "authored_contract_coverage",
    "authored_contract_coverage",
    "selected_pack_guarantee_coverage",
    "verification_ownership",
    "implementation_ownership",
    "scope_feasibility",
    "structural_verification"
  ]);
  assert.ok(result.page.items.every(({ state }) => state !== "covered"));
  assert.equal(result.page.total, result.totals.gaps);
  assert.deepEqual(result.covered_detail.retrieval.selectors,
    ["criterionIdentity", "nodeId"]);
});

test("criterion and node selectors retrieve covered detail with continuation", () => {
  const input = fixture();
  const selectedCriterion = projectAcceptanceCoverage(projectionInput(input, {
    selector: { criterionIdentity: input.ids[6] }
  }));
  assert.equal(selectedCriterion.page.total, 1);
  assert.deepEqual(Object.values(selectedCriterion.page.items[0].axes),
    Array(6).fill("covered"));

  const first = projectAcceptanceCoverage(projectionInput(input, {
    selector: { nodeId: "node-shared" }, pageSize: 1
  }));
  assert.equal(first.page.total, 2);
  assert.equal(first.page.returned, 1);
  assert.equal(typeof first.page.continuation, "string");
  const second = projectAcceptanceCoverage(projectionInput(input, {
    cursor: first.page.continuation, pageSize: 1
  }));
  assert.equal(second.page.offset, 1);
  assert.equal(second.page.returned, 1);
  assert.equal(second.page.continuation, null);
  assert.notEqual(first.page.items[0].position, second.page.items[0].position);
});

test("continuations reject changed criterion identities but ignore provenance churn", () => {
  const input = fixture();
  const first = projectAcceptanceCoverage(projectionInput(input, { pageSize: 1 }));
  const provenanceOnly = fixture("different-unit-digest");
  assert.doesNotThrow(() => projectAcceptanceCoverage(projectionInput(provenanceOnly, {
    cursor: first.page.continuation, pageSize: 1
  })));

  const changed = fixture("unit", ["changed criterion", ...criteria.slice(1)]);
  assert.throws(
    () => projectAcceptanceCoverage(projectionInput(changed, {
      cursor: first.page.continuation, pageSize: 1
    })),
    (error) => error instanceof AcceptanceCoverageProjectionError &&
      error.code === "acceptance_coverage_projection_cursor_stale"
  );
});

test("rejects non-canonical axis states", () => {
  const input = fixture();
  input.criterionAxes[0].scopeFeasibility = "not_applicable";
  assert.throws(() => projectAcceptanceCoverage(projectionInput(input)),
    AcceptanceCoverageProjectionError);
});

test("retains evaluator completeness, warnings, unknown mappings, and source paths", () => {
  const input = fixture();
  const unknown = {
    index: input.evaluation.mapping_outcomes.length,
    criterion_identity: "unknown-criterion",
    node_ids: ["node-unknown"], state: "unknown"
  };
  input.evaluation = {
    ...input.evaluation,
    mapping_outcomes: [...input.evaluation.mapping_outcomes, unknown],
    unknown_mappings: [unknown], complete: false
  };
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  assert.equal(result.complete, false);
  assert.deepEqual(result.warnings, input.evaluation.warnings);
  assert.deepEqual(Object.fromEntries(result.axes.map(({ axis, state }) =>
    [axis, state])), {
    authored_contract_coverage: "unknown",
    structural_verification: "uncovered",
    selected_pack_guarantee_coverage: "outside_pack",
    implementation_ownership: "uncovered",
    verification_ownership: "uncovered",
    scope_feasibility: "infeasible"
  });
  assert.deepEqual(result.unknown_mappings, [unknown]);
  const unknownGap = result.page.items.find((item) => item.kind === "mapping");
  assert.deepEqual(unknownGap, {
    kind: "mapping", mapping_identity: "unknown-criterion",
    mapping_index: unknown.index, axis: "authored_contract_coverage",
    state: "unknown",
    mapping_outcome_path: ["evaluation", "mapping_outcomes", unknown.index]
  });
  assert.ok(result.totals.gaps > 0);
  assert.equal(result.totals.fully_covered_criteria, 0);
});

test("passes through a non-empty canonical evaluator-complete result", () => {
  const input = completeFixture();
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  assert.equal(result.complete, true);
  assert.equal(result.claim, "present");
  assert.deepEqual(result.axes.map(({ axis, state }) => [axis, state]),
    ACCEPTANCE_COVERAGE_AXES.map((axis) => [axis, "covered"]));
  assert.equal(result.totals.fully_covered_criteria, 1);
  assert.equal(result.covered_detail.total, 1);
});

test("preserves evaluator incompleteness when there are no projected gaps", () => {
  const input = completeFixture();
  input.evaluation = { ...input.evaluation, complete: false };
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  assert.equal(result.complete, false);
  assert.equal(result.unknown_mappings.length, 0);
  assert.equal(result.totals.gaps, 0);
  assert.equal(result.totals.fully_covered_criteria, 1);
});

test("gap items retain exact evaluator mapping attribution", () => {
  const input = fixture();
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  const outsidePackGap = result.page.items.find((item) =>
    item.axis === "selected_pack_guarantee_coverage");
  assert.deepEqual(outsidePackGap.mapping_indexes, [0]);
  assert.deepEqual(outsidePackGap.mapping_outcome_paths,
    [["evaluation", "mapping_outcomes", 0]]);
  assert.equal(input.evaluation.mapping_outcomes[0].criterion_identity,
    outsidePackGap.criterion_identity);
});

test("empty criteria project an explicit absent claim", () => {
  const criterionIdentities = deriveCriterionIdentitySet({
    criteria: [], selectedUnitDigest: "unit", bindings
  });
  const evaluation = evaluateAcceptanceCoverage({
    criteria: criterionIdentities, contractNodes: [],
    selectedPackNodeIds: [], mappings: []
  });
  const result = projectAcceptanceCoverage({
    criterionIdentities, evaluation, criterionAxes: [], pageSize: 100
  });
  assert.equal(result.claim, "absent");
  assert.equal(result.complete, true);
  assert.equal(result.totals.fully_covered_criteria, 0);
  assert.ok(result.axes.every(({ state }) => state === "unknown"));
});

test("unknown mappings alone gate covered totals and only authored rollup", () => {
  const input = completeFixture();
  const unknown = { index: input.evaluation.mapping_outcomes.length,
    criterion_identity: "unknown-criterion", node_ids: ["unknown"], state: "unknown" };
  input.evaluation = { ...input.evaluation,
    mapping_outcomes: [...input.evaluation.mapping_outcomes, unknown],
    unknown_mappings: [unknown], complete: false };
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  const authored = result.axes.find(({ axis }) => axis === "authored_contract_coverage");
  assert.equal(authored.state, "unknown");
  assert.equal(authored.totals_by_state.unknown, 1);
  assert.equal(result.axes.find(({ axis }) => axis === "structural_verification")
    .totals_by_state.unknown, 0);
  assert.equal(result.totals.fully_covered_criteria, 0);
  assert.equal(result.covered_detail.total, 0);
});

test("caller-axis gaps do not claim mapping causation", () => {
  const input = fixture();
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  const ownershipGap = result.page.items.find(({ axis }) =>
    axis === "implementation_ownership");
  assert.equal(Object.hasOwn(ownershipGap, "mapping_indexes"), false);
  assert.equal(Object.hasOwn(ownershipGap, "mapping_outcome_paths"), false);
});

test("mapping references reject non-integer and out-of-range indexes", () => {
  for (const mapping_indexes of [[0.5], [99]]) {
    const input = fixture();
    input.evaluation = { ...input.evaluation,
      states: input.evaluation.states.map((state, index) => index === 1
        ? { ...state, mapping_indexes } : state) };
    assert.throws(() => projectAcceptanceCoverage(projectionInput(input)),
      (error) => error instanceof AcceptanceCoverageProjectionError &&
        error.code === "acceptance_coverage_projection_mapping_reference_invalid");
  }
});

test("identity mismatch wins before malformed mapping outcomes", () => {
  const input = fixture();
  input.evaluation = {
    ...input.evaluation,
    states: input.evaluation.states.map((state, index) => index === 1
      ? { ...state, criterion_identity: "wrong-criterion", mapping_indexes: "bad" }
      : state),
    mapping_outcomes: [{ index: 0, node_ids: "bad" }]
  };
  assert.throws(() => projectAcceptanceCoverage(projectionInput(input)),
    (error) => error instanceof AcceptanceCoverageProjectionError &&
      error.code === "acceptance_coverage_projection_identity_mismatch");
});

test("RESULT_PRECEDENCE wins across real axis aggregation states", () => {
  const input = fixture();
  input.criterionAxes[1].structuralVerification = "stale";
  input.criterionAxes[2].structuralVerification = "duplicate";
  input.criterionAxes[3].structuralVerification = "retained_residue";
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  const structural = result.axes.find(({ axis }) => axis === "structural_verification");
  assert.equal(structural.state, "stale");
  assert.equal(structural.totals_by_state.stale, 1);
  assert.equal(structural.totals_by_state.duplicate, 1);
  assert.equal(structural.totals_by_state.retained_residue, 1);
  assert.equal(structural.totals_by_state.covered, 4);
});

test("mixed mappings preserve causal paths", () => {
  const input = fixture();
  const identity = input.ids[1];
  input.evaluation = {
    ...input.evaluation,
    states: input.evaluation.states.map((state, index) => index === 1
      ? { ...state, state: "outside_pack", mapping_indexes: [0, 6] } : state),
    mapping_outcomes: [
      ...input.evaluation.mapping_outcomes,
      { index: 6, criterion_identity: identity, node_ids: ["node-shared"], state: "covered" }
    ]
  };
  const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
  const mixedGap = result.page.items.find((item) =>
    item.criterion_identity === identity &&
    item.axis === "selected_pack_guarantee_coverage");
  assert.equal(mixedGap.state, "outside_pack");
  assert.deepEqual(mixedGap.mapping_indexes, [0]);
});

test("stale and duplicate criterion states use all mapped indexes as fallback", () => {
  for (const state of ["stale", "duplicate"]) {
    const input = fixture();
    const identity = input.ids[1];
    input.evaluation = {
      ...input.evaluation,
      states: input.evaluation.states.map((entry, index) => index === 1
        ? { ...entry, state, mapping_indexes: [0, 6] } : entry),
      mapping_outcomes: [...input.evaluation.mapping_outcomes,
        { index: 6, criterion_identity: identity, node_ids: ["node-shared"],
          state: "covered" }]
    };
    const result = projectAcceptanceCoverage(projectionInput(input, { pageSize: 100 }));
    const gap = result.page.items.find((item) =>
      item.criterion_identity === identity && item.axis === "authored_contract_coverage");
    assert.equal(gap.state, state);
    assert.deepEqual(gap.mapping_indexes, [0, 6]);
    assert.deepEqual(gap.mapping_outcome_paths, [
      ["evaluation", "mapping_outcomes", 0],
      ["evaluation", "mapping_outcomes", 6]
    ]);
  }
});

import { pinProofSelection } from '../lib/proof-authoring-selection.mjs';
import { resolveProofAuthoring } from '../lib/proof-authoring-resolution.mjs';
test('saved-selection projection retains exact pins and design gaps without granting proof credit', async () => {
  const selection = { ...await pinProofSelection('proof.verification.test-validity'), parameters: {} };
  const resolution = await resolveProofAuthoring({ schema_version: 'controlled-contract-obligation-coverage.v3',
    wk_id: 'WK-2095', selected_unit: null, focus: null,
    obligations: ['OBL-ONE', 'OBL-TWO'].map(obligation_id => ({ obligation_id, statement: 'Preserve the association', selection })) },
  { source_digest: `sha256:${'c'.repeat(64)}` });
  const evaluation = evaluateAcceptanceCoverage({ obligationCoverage: resolution.mapping });
  const all = projectAcceptanceCoverage({ evaluation });
  assert.equal(all.complete, false); assert.equal(all.totals.total, 2);
  assert.equal(all.totals.invalid_design, 2);
  assert.deepEqual(all.items[0].selection, selection);
  assert.equal(projectAcceptanceCoverage({ evaluation, selector: { obligationId: 'OBL-TWO' } }).items.length, 1);
  assert.equal(projectAcceptanceCoverage({ evaluation, selector: { proofName: selection.proof_name } }).items.length, 2);
  for (const selector of [{ sourceLocator: '/acceptance/criteria/0' }, { guaranteeSelector: { kind: 'claim', componentId: 'invented' } }]) {
    assert.throws(() => projectAcceptanceCoverage({ evaluation, selector }));
  }
});
