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

function obligationProjectionRow(id, outcome, overrides = {}) {
  return {
    obligation_id: id, position: Number(id.slice(4)) - 1,
    source_locator: `/acceptance/criteria/${Number(id.slice(4)) - 1}`,
    controlled_contract_node_ids: [`node-${id.toLowerCase()}`],
    mechanism: { owner: "packages/example.mjs", kind: "code_symbol",
      selector: `owner-${id.toLowerCase()}` },
    proof: { kind: "pack_mapping", pack_id: "pack-one",
      requested_intent: "implementation-readiness",
      profile_id: "proof.design.implementation-readiness", profile_version: "2.0.0",
      selector: { kind: "claim", component_id: "component-one" },
      evaluation_stage: "pre_dispatch" },
    outcome, reason: outcome === "mechanically_proven" ? null : outcome,
    ...overrides
  };
}

function obligationEvaluation(rows = [
  obligationProjectionRow("OBL-001", "mechanically_proven"),
  obligationProjectionRow("OBL-002", "explicit_gap", {
    proof: { kind: "explicit_gap", gap_kind: "catalog_gap", reason: "No pack." }
  }),
  obligationProjectionRow("OBL-003", "guarantee_incompatible")
]) {
  return { mode: "obligation_coverage",
    schema_version: "controlled-contract-obligation-coverage.v1",
    wk_id: "WK-2095", focus: null, obligation_outcomes: rows,
    outcome_precedence: ["stale", "unmapped", "explicit_gap",
      "guarantee_incompatible", "mapped_input_missing",
      "mapped_pack_not_evaluated", "profile_proven_exact_binding_missing",
      "mechanically_proven"],
    diagnostics: [], orphan_selected_pack_ids: [], warnings: [],
    complete: rows.every(({ outcome }) => outcome === "mechanically_proven") };
}

test("obligation projection derives every count from admitted rows", () => {
  const result = projectAcceptanceCoverage({ evaluation: obligationEvaluation() });
  assert.equal(result.version, "acceptance-obligation-coverage-projection.v1");
  assert.equal(result.totals.total, 3);
  assert.deepEqual(result.totals.outcomes, {
    stale: 0, unmapped: 0, explicit_gap: 1, guarantee_incompatible: 1,
    mapped_input_missing: 0, mapped_pack_not_evaluated: 0,
    profile_proven_exact_binding_missing: 0, mechanically_proven: 1
  });
  assert.equal(result.totals.invalid_mapping, 1);
  assert.deepEqual(result.items.map(({ obligation_id: id }) => id),
    ["OBL-002", "OBL-003"]);
});

test("obligation projection counts change only when rows change", () => {
  const rows = obligationEvaluation().obligation_outcomes;
  const before = projectAcceptanceCoverage({ evaluation: obligationEvaluation(rows) });
  const changedRows = rows.map((row) => row.obligation_id === "OBL-003"
    ? { ...row, outcome: "mapped_input_missing" } : row);
  const after = projectAcceptanceCoverage({ evaluation: obligationEvaluation(changedRows) });
  assert.equal(before.totals.total, after.totals.total);
  assert.equal(before.totals.invalid_mapping, 1);
  assert.equal(after.totals.invalid_mapping, 0);
  assert.equal(after.totals.outcomes.mapped_input_missing, 1);
  const added = projectAcceptanceCoverage({ evaluation: obligationEvaluation([
    ...changedRows, obligationProjectionRow("OBL-004", "stale")
  ]) });
  assert.equal(added.totals.total, before.totals.total + 1);
  assert.equal(added.totals.outcomes.stale, 1);
});

test("obligation gap-first and targeted projections are deterministic", () => {
  const evaluation = obligationEvaluation();
  const reversed = obligationEvaluation([...evaluation.obligation_outcomes].reverse());
  assert.deepEqual(projectAcceptanceCoverage({ evaluation }),
    projectAcceptanceCoverage({ evaluation: reversed }));
  const targets = [
    [{ obligationId: "OBL-001" }, "OBL-001"],
    [{ sourceLocator: "/acceptance/criteria/1" }, "OBL-002"],
    [{ controlledContractNodeId: "node-obl-003" }, "OBL-003"],
    [{ mechanism: { owner: "packages/example.mjs", kind: "code_symbol",
      selector: "owner-obl-001" } }, "OBL-001"],
    [{ packId: "pack-one" }, "OBL-001"],
    [{ guaranteeSelector: { kind: "claim", componentId: "component-one" } },
      "OBL-001"],
    [{ outcome: "explicit_gap" }, "OBL-002"]
  ];
  for (const [selector, expected] of targets) {
    const result = projectAcceptanceCoverage({ evaluation, selector });
    assert.ok(result.items.some(({ obligation_id: id }) => id === expected),
      JSON.stringify(selector));
  }
});

test("genuine evaluator proof selectors stay immutable through projection", async () => {
  const profileId = "proof.design.implementation-readiness";
  const componentId = "design-names-grounded-loci";
  const nodeId = "claim-design-names-grounded-loci";
  const packSnapshot = await loadAdmittedProofPack(profileId);
  const fixture = buildImplementationReadinessFixture({
    profile: packSnapshot.profile
  });
  const assessment = evaluateStableProofPackFixtureV1({
    contract: fixture.contract,
    profile: packSnapshot.profile,
    evaluation_input: fixture.input
  });
  const callerSelector = { kind: "claim", component_id: componentId };
  const callerMapping = {
    kind: "pack_mapping",
    pack_id: "pack-one",
    requested_intent: "implementation-readiness",
    profile_id: profileId,
    profile_version: "2.0.0",
    selector: callerSelector,
    evaluation_stage: "pre_dispatch"
  };
  const callerGap = {
    kind: "explicit_gap",
    gap_kind: "catalog_gap",
    reason: "No admitted proof component."
  };
  const obligation = (id, proof, controlledNodeId) => ({
    obligation_id: id,
    source_locator: `/acceptance/criteria/${Number(id.slice(4)) - 1}`,
    source_locator_digest: `sha256:${"c".repeat(64)}`,
    statement: `Implement ${id} exactly.`,
    controlled_contract_node_ids: [controlledNodeId],
    mechanism: {
      owner: "packages/example.mjs",
      kind: "code_symbol",
      selector: `owner-${id.toLowerCase()}`
    },
    proof
  });
  const evaluation = evaluateAcceptanceCoverage({
    obligationCoverage: {
      schema_version: "controlled-contract-obligation-coverage.v1",
      wk_id: "WK-2115",
      obligations: [
        obligation("OBL-001", callerMapping, nodeId),
        obligation("OBL-002", callerGap, "node-gap")
      ]
    },
    guaranteeSelectorIndex: buildObligationGuaranteeSelectorIndex({
      packs: [{
        pack_id: "pack-one",
        requested_intents: ["implementation-readiness"],
        pack_snapshot: packSnapshot,
        assessment,
        evaluation_input_present: true,
        profile_discrimination: "proven",
        exact_binding: null
      }]
    }),
    selectedPackIds: ["pack-one"]
  });
  const mappingRow = evaluation.obligation_outcomes.find(
    ({ obligation_id: id }) => id === "OBL-001"
  );
  const gapRow = evaluation.obligation_outcomes.find(
    ({ obligation_id: id }) => id === "OBL-002"
  );
  const originalMapping = structuredClone(mappingRow.proof);
  const before = projectAcceptanceCoverage({ evaluation });

  assert.equal(Object.isFrozen(mappingRow), true);
  assert.equal(Object.isFrozen(mappingRow.proof), true);
  assert.equal(Object.isFrozen(mappingRow.proof.selector), true);
  assert.equal(Object.isFrozen(gapRow.proof), true);
  assert.notStrictEqual(mappingRow.proof, callerMapping);
  assert.notStrictEqual(mappingRow.proof.selector, callerSelector);
  assert.equal(Object.isFrozen(callerMapping), false);
  assert.equal(Object.isFrozen(callerSelector), false);
  assert.equal(Object.isFrozen(callerGap), false);

  assert.throws(() => {
    mappingRow.proof.selector.kind = "relation";
  }, TypeError);
  assert.throws(() => {
    mappingRow.proof.selector.component_id = "forged-component";
  }, TypeError);
  assert.throws(() => {
    mappingRow.proof.selector = {
      kind: "relation", component_id: "forged-component"
    };
  }, TypeError);
  callerSelector.kind = "relation";
  callerSelector.component_id = "forged-component";

  assert.deepEqual(mappingRow.proof, originalMapping);
  assert.deepEqual(evaluation.outcome_precedence, OBLIGATION_COVERAGE_OUTCOMES);
  assert.deepEqual(evaluation.obligation_outcomes.map(
    ({ outcome }) => outcome), ["guarantee_incompatible", "explicit_gap"]);
  assert.equal(mappingRow.reason, "component_applicability_unproven");
  assert.equal(evaluation.complete, false);
  assert.equal(evaluation.obligation_outcomes.filter(
    ({ outcome }) => outcome === "mechanically_proven").length, 0);
  assert.deepEqual(before.totals, {
    total: 2,
    outcomes: {
      stale: 0,
      unmapped: 0,
      explicit_gap: 1,
      guarantee_incompatible: 1,
      mapped_input_missing: 0,
      mapped_pack_not_evaluated: 0,
      profile_proven_exact_binding_missing: 0,
      mechanically_proven: 0
    },
    invalid_mapping: 1
  });
  assert.equal(before.complete, false);
  assert.deepEqual(projectAcceptanceCoverage({ evaluation }), before);

  const originalTarget = projectAcceptanceCoverage({
    evaluation,
    selector: {
      guaranteeSelector: { kind: "claim", componentId }
    }
  });
  assert.deepEqual(originalTarget.items.map(({ obligation_id: id }) => id),
    ["OBL-001"]);
  const forgedTarget = projectAcceptanceCoverage({
    evaluation,
    selector: {
      guaranteeSelector: { kind: "relation", componentId: "forged-component" }
    }
  });
  assert.deepEqual(forgedTarget.items, []);
});

test("invalid obligation evaluations refuse without mutating a prior census", () => {
  const prior = projectAcceptanceCoverage({ evaluation: obligationEvaluation() });
  const snapshot = structuredClone(prior);
  const duplicate = obligationProjectionRow("OBL-001", "stale");
  assert.throws(() => projectAcceptanceCoverage({ evaluation: obligationEvaluation([
    duplicate, duplicate
  ]) }), (error) => error instanceof AcceptanceCoverageProjectionError &&
    error.code === "acceptance_coverage_projection_input_invalid");
  assert.deepEqual(prior, snapshot);
});
