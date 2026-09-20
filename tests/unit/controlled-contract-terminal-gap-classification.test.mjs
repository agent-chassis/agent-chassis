import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONTROLLED_CONTRACT_TERMINAL_GAP_CLASSES,
  classifyControlledContractTerminalGapCode,
  classifyControlledContractTerminalGaps
} from
  "../../packages/wiki-core/src/operations/controlled-contract/terminal-gap-classification.mjs";

const WORKBENCH_OWNER_SOURCES = Object.freeze([
  "../../packages/wiki-core/src/lib/controlled-contract-design-workbench.mjs",
  "../../packages/wiki-core/src/lib/controlled-contract-runtime-proof-eligibility.mjs",
  "../../packages/wiki-core/src/operations/controlled-contract/design-workbench-actionability.mjs",
  "../../packages/wiki-core/src/operations/controlled-contract/proof-authoring-readiness-inputs.mjs",
  "../../packages/controlled-contract/lib/proof-authoring-resolution.mjs",
  "../../packages/controlled-contract/lib/proof-authoring-selection.mjs",

  "../../packages/controlled-contract/lib/proof-contract.mjs"
].map((path) => new URL(path, import.meta.url)));

const RETIRED_REASON_CODES = Object.freeze(new Set([
  "explicit_gap_retains_runtime_proof_binding"
]));

const COMPOSED_REASON_CODE_STEMS = Object.freeze(new Map([
  ["obligation_coverage_proof_unselected", "proof_unselected"]
]));

function workbench(actionable = [], nonActionable = []) {
  return { actionable_rows: actionable, non_actionable_rows: nonActionable };
}

function row(rowId, { reasons = [], forms = [], nonActionable = null } = {}) {
  return { row_id: rowId, reason_codes: reasons, eligible_response_forms: forms,
    ...(nonActionable === null ? {} : { non_actionable_reason: nonActionable }) };
}

test("the class vocabulary covers every kind D5 requires and nothing else", () => {
  assert.deepEqual([...CONTROLLED_CONTRACT_TERMINAL_GAP_CLASSES].sort(), [
    "inconsistent_owner_facts", "missing_proof_or_evidence", "owner_refusal",
    "stale_source", "tooling_or_internal_invariant", "unresolved_semantic_choice",
    "unsupported_proof_method"
  ]);
});

test("each gap kind maps to its own stable class", () => {
  const expected = {
    obligation_coverage_criterion_mapping_absent: "missing_proof_or_evidence",
    runtime_proof_binding_missing: "missing_proof_or_evidence",
    non_runtime: "unsupported_proof_method",
    unevaluable: "unsupported_proof_method",
    semantic_continuation_not_resolved: "unresolved_semantic_choice",
    no_single_incumbent_semantic_transition: "unresolved_semantic_choice",
    controlled_acceptance_disposition_missing: "unresolved_semantic_choice",
    obligation_coverage_criterion_mapping_ambiguous: "inconsistent_owner_facts",
    runtime_proof_identity_duplicate: "inconsistent_owner_facts",

    stable_test_proof_selector_invalid: "inconsistent_owner_facts",
    test_selector_invalid: "inconsistent_owner_facts",
    obligation_coverage_criterion_mapping_stale: "stale_source",
    assessment_source_stale: "stale_source",
    some_owner_refusal: "owner_refusal"
  };
  for (const [code, gapClass] of Object.entries(expected)) {
    assert.equal(classifyControlledContractTerminalGapCode(code), gapClass, code);
  }
});

test("an unrecognised code is reported as a tooling gap, not guessed", () => {
  assert.equal(classifyControlledContractTerminalGapCode("a_code_nobody_defined"),
    "tooling_or_internal_invariant");
  assert.equal(classifyControlledContractTerminalGapCode(null),
    "tooling_or_internal_invariant");
  assert.equal(classifyControlledContractTerminalGapCode(""),
    "tooling_or_internal_invariant");
});

const WORKBENCH_REASON_CODES = Object.freeze([
  "acceptance_coverage_population_empty", "acceptance_criterion_population_empty",
  "assessment_actionable_gaps_present", "assessment_population_retrieval_missing",
  "assessment_source_stale", "assessment_unavailable", "conflicting",
  "contract_assessment_population_empty",
  "controlled_acceptance_disposition_missing",
  "controlled_contract_cross_owner_identity_conflict",
  "controlled_contract_cross_owner_identity_missing",
  "controlled_contract_cross_owner_mandatory_claim_unmapped",
  "controlled_contract_cross_owner_verification_method_conflict",
  "controlled_contract_obligation_omitted",
  "controlled_contract_runtime_eligibility_mapping_not_current",
  "controlled_contract_verification_method_non_runtime",
  "cross_carrier_integrity_not_clean",
  "controlled_acceptance_authored_inputs_incomplete", "explicit_gap",
  "explicit_gap_retains_runtime_proof_binding", "incomplete", "invalid_record",
  "non_runtime", "no_single_incumbent_semantic_transition",
  "obligation_coverage_explicit_gap", "obligation_coverage_proof_unselected",
  "obligation_coverage_criterion_mapping_absent",
  "obligation_coverage_criterion_mapping_ambiguous",
  "obligation_coverage_criterion_mapping_conflicting",
  "obligation_coverage_criterion_mapping_stale", "obligation_coverage_not_current",
  "obligation_coverage_obligation_id_duplicate",
  "obligation_coverage_population_empty", "obligation_criterion_population_empty",
  "obligation_evidence_disposition_invalid",
  "obligation_proof_disposition_non_runtime",
  "obligation_runtime_proof_binding_ambiguous",
  "obligation_runtime_proof_binding_missing",
  "obligation_verification_claim_ambiguous", "obligation_verification_claim_missing",
  "proof_plan_rebuild_required", "runtime_proof_binding_missing",
  "runtime_proof_identity_duplicate",
  "runtime_proof_obligation_missing", "runtime_proof_population_empty",
  "runtime_test_proof_required", "semantic_continuation_not_resolved",
  "stable_test_proof_selector_invalid", "uncovered", "unevaluable",
  "unknown_mapping", "unmapped_mandatory_node"
]);

test("every reason code the workbench owners emit is classified", async () => {
  const source = (await Promise.all(WORKBENCH_OWNER_SOURCES.map((url) =>
    readFile(url, "utf8")))).join("\n");

  const absent = WORKBENCH_REASON_CODES.filter((code) =>
    !RETIRED_REASON_CODES.has(code) &&
    !new RegExp(`["']${COMPOSED_REASON_CODE_STEMS.get(code) ?? code}["']`, "u")
      .test(source));
  assert.deepEqual(absent, [],
    "the guarded vocabulary must still track its owner sources");
  const unclassified = WORKBENCH_REASON_CODES.filter((code) =>
    classifyControlledContractTerminalGapCode(code) === "tooling_or_internal_invariant");
  assert.deepEqual(unclassified, [],
    "each workbench reason code needs an explicit terminal-gap class");
});

test("a substantive actionable row is an unresolved choice, never missing evidence", () => {
  const gaps = classifyControlledContractTerminalGaps({
    workbench: workbench([row("obligation_coverage:one",
      { reasons: ["obligation_runtime_proof_binding_missing"],
        forms: ["obligation_wording", "mapping_selection"] })])
  });
  assert.equal(gaps.primary_gap_class, "unresolved_semantic_choice");
  assert.equal(gaps.gap_class_counts.unresolved_semantic_choice, 1);
  assert.equal(gaps.gap_class_counts.missing_proof_or_evidence, 0);
  assert.equal(gaps.acceptable, false);
});

test("a mechanically actionable row keeps its owner's own class", () => {
  const gaps = classifyControlledContractTerminalGaps({
    workbench: workbench([row("authoring_stage:one",
      { reasons: ["runtime_test_proof_required"], forms: ["advance_authoring"] })])
  });
  assert.equal(gaps.primary_gap_class, "missing_proof_or_evidence");
});

test("an empty workbench with no repair outcome is acceptable", () => {
  const gaps = classifyControlledContractTerminalGaps({ workbench: workbench() });
  assert.equal(gaps.acceptable, true);
  assert.equal(gaps.primary_gap_class, null);
  assert.equal(gaps.total_gap_count, 0);
});

test("a repair outcome is metadata and never joins the gap population", () => {

  const population = workbench([], [row("obligation_coverage:one",
    { reasons: ["obligation_coverage_criterion_mapping_absent"],
      nonActionable: "obligation_coverage_criterion_mapping_absent" })]);
  const withoutRepair = classifyControlledContractTerminalGaps({
    workbench: population });
  const gaps = classifyControlledContractTerminalGaps({
    workbench: population,
    repairOutcome: { attempted: true, settled: false, gap_class: "owner_refusal",
      reason_code: "controlled_contract_owner_refused_example",
      responsible_owner: "proof_plan" }
  });
  assert.equal(gaps.total_gap_count, 1);
  assert.equal(gaps.total_gap_count, withoutRepair.total_gap_count);
  assert.deepEqual({ ...gaps.gap_class_counts },
    { ...withoutRepair.gap_class_counts });
  assert.equal(gaps.gap_class_counts.owner_refusal, 0);
  assert.equal(gaps.gap_class_counts.missing_proof_or_evidence, 1);

  assert.equal(gaps.primary_gap_class, "missing_proof_or_evidence");

  assert.equal(Object.values(gaps.gap_class_counts)
    .reduce((total, value) => total + value, 0), gaps.total_gap_count);

  assert.equal(gaps.repair_outcome.responsible_owner, "proof_plan");
  assert.equal(gaps.repair_outcome.gap_class, "owner_refusal");
  assert.equal(gaps.repair_outcome.reason_code,
    "controlled_contract_owner_refused_example");
});

test("evidence is bounded and reports its exact omitted count", () => {
  const rows = Array.from({ length: 25 }, (_, index) =>
    row(`obligation_coverage:${index}`,
      { reasons: ["obligation_coverage_criterion_mapping_absent"] }));
  const gaps = classifyControlledContractTerminalGaps({
    workbench: workbench([], rows), evidenceLimit: 20 });
  assert.equal(gaps.total_gap_count, 25, "the denominator stays exact");
  assert.equal(gaps.evidence.length, 20);
  assert.equal(gaps.evidence_omitted, 5);
  assert.equal(gaps.gap_class_counts.missing_proof_or_evidence, 25);
});

test("the classification is stable across runs for one workbench", () => {
  const build = () => classifyControlledContractTerminalGaps({
    workbench: workbench(
      [row("authoring_stage:one", { reasons: ["non_runtime"], forms: ["advance_authoring"] })],
      [row("acceptance_coverage:one", { reasons: ["uncovered"] })])
  });
  assert.deepEqual(JSON.parse(JSON.stringify(build())),
    JSON.parse(JSON.stringify(build())));
});
