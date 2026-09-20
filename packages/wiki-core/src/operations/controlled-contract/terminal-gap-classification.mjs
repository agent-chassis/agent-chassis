

export const CONTROLLED_CONTRACT_TERMINAL_GAP_SCHEMA_VERSION =
  "controlled-contract-terminal-gap.v1";

export const CONTROLLED_CONTRACT_TERMINAL_GAP_CLASSES = Object.freeze([
  "missing_proof_or_evidence",
  "unsupported_proof_method",
  "unresolved_semantic_choice",
  "inconsistent_owner_facts",
  "owner_refusal",
  "stale_source",
  "tooling_or_internal_invariant"
]);

const UNCLASSIFIED = "tooling_or_internal_invariant";

const EXACT = Object.freeze({

  controlled_acceptance_disposition_missing: "unresolved_semantic_choice",

  controlled_contract_verification_continuation_inadmissible:
    "unresolved_semantic_choice",
  semantic_continuation_not_resolved: "unresolved_semantic_choice",
  no_single_incumbent_semantic_transition: "unresolved_semantic_choice",
  obligation_evidence_disposition_invalid: "unresolved_semantic_choice",
  explicit_gap: "unresolved_semantic_choice",

  obligation_coverage_explicit_gap: "unresolved_semantic_choice",
  obligation_coverage_proof_unselected: "unresolved_semantic_choice",
  controlled_acceptance_authored_inputs_incomplete: "unresolved_semantic_choice",
  explicit_gap_retains_runtime_proof_binding: "inconsistent_owner_facts",

  non_runtime: "unsupported_proof_method",
  obligation_proof_disposition_non_runtime: "unsupported_proof_method",
  controlled_contract_verification_method_non_runtime: "unsupported_proof_method",
  unevaluable: "unsupported_proof_method",
  unknown_mapping: "unsupported_proof_method",

  controlled_contract_cross_owner_identity_conflict: "inconsistent_owner_facts",
  controlled_contract_cross_owner_verification_method_conflict: "inconsistent_owner_facts",
  controlled_contract_design_workbench_row_identity_duplicate: "inconsistent_owner_facts",
  obligation_coverage_criterion_mapping_conflicting: "inconsistent_owner_facts",
  obligation_coverage_criterion_mapping_ambiguous: "inconsistent_owner_facts",
  stable_test_proof_selector_invalid: "inconsistent_owner_facts",
  test_selector_invalid: "inconsistent_owner_facts",
  invalid_record: "inconsistent_owner_facts",
  conflicting: "inconsistent_owner_facts",

  assessment_source_stale: "stale_source",
  obligation_coverage_not_current: "stale_source",
  obligation_coverage_criterion_mapping_stale: "stale_source",
  controlled_contract_runtime_eligibility_mapping_not_current: "stale_source",

  obligation_coverage_criterion_mapping_absent: "missing_proof_or_evidence",
  assessment_unavailable: "missing_proof_or_evidence",
  assessment_population_retrieval_missing: "missing_proof_or_evidence",
  assessment_actionable_gaps_present: "missing_proof_or_evidence",
  controlled_contract_cross_owner_mandatory_claim_unmapped: "missing_proof_or_evidence",
  controlled_contract_obligation_omitted: "missing_proof_or_evidence",
  cross_carrier_integrity_not_clean: "inconsistent_owner_facts",
  runtime_test_proof_required: "missing_proof_or_evidence",
  proof_plan_rebuild_required: "missing_proof_or_evidence",
  runtime_proof_population_empty: "missing_proof_or_evidence",
  uncovered: "missing_proof_or_evidence",
  unmapped_mandatory_node: "missing_proof_or_evidence",
  not_ready: "missing_proof_or_evidence",
  incomplete: "missing_proof_or_evidence",

  controlled_contract_design_workbench_input_invalid: UNCLASSIFIED,
  controlled_contract_design_workbench_state_invalid: UNCLASSIFIED,
  controlled_contract_design_workbench_owner_accounting_invalid: UNCLASSIFIED,
  controlled_contract_design_workbench_owner_projection_invalid: UNCLASSIFIED
});

const PATTERNS = Object.freeze([
  Object.freeze({ match: /(?:_duplicate|_ambiguous|_conflict|_invalid)$/u,
    gap_class: "inconsistent_owner_facts" }),
  Object.freeze({ match: /(?:_stale|_not_current)$/u, gap_class: "stale_source" }),
  Object.freeze({ match: /(?:_refused|_refusal)$/u, gap_class: "owner_refusal" }),
  Object.freeze({ match: /(?:_non_runtime|_unsupported)$/u,
    gap_class: "unsupported_proof_method" }),
  Object.freeze({ match: /(?:_missing|_empty|_required|_unsatisfied|_absent)$/u,
    gap_class: "missing_proof_or_evidence" })
]);

export function classifyControlledContractTerminalGapCode(code) {
  if (typeof code !== "string" || code.length === 0) return UNCLASSIFIED;
  if (Object.hasOwn(EXACT, code)) return EXACT[code];
  for (const { match, gap_class: gapClass } of PATTERNS) {
    if (match.test(code)) return gapClass;
  }
  return UNCLASSIFIED;
}

function classifyRow(row) {
  const codes = [...(Array.isArray(row.reason_codes) ? row.reason_codes : []),
    ...(typeof row.non_actionable_reason === "string"
      ? [row.non_actionable_reason] : [])];
  const classified = codes.map(classifyControlledContractTerminalGapCode)
    .filter((gapClass) => gapClass !== UNCLASSIFIED);
  return classified[0] ?? UNCLASSIFIED;
}

const MECHANICAL_RESPONSE_KINDS = Object.freeze(["advance_authoring"]);

function actionableGapClass(row) {
  const forms = Array.isArray(row.eligible_response_forms)
    ? row.eligible_response_forms : [];
  return forms.length > 0 && forms.every((form) =>
    MECHANICAL_RESPONSE_KINDS.includes(form))
    ? classifyRow(row) : "unresolved_semantic_choice";
}

const GAP_GROUP_LIMIT = 6;
const GAP_GROUP_OBLIGATION_LIMIT = 4;
const AFFECTED_OBLIGATION_LIMIT = 8;

function capped(values, limit) {
  return { listed: Object.freeze(values.slice(0, limit)),
    omitted: Math.max(0, values.length - limit) };
}

function gapGroups(rows) {
  const grouped = new Map();
  for (const { row, gap_class: gapClass } of rows) {
    const reasonCodes = [...(Array.isArray(row.reason_codes) ? row.reason_codes : [])];
    const owner = row.semantic_owner ?? null;
    const key = JSON.stringify({ gapClass, reasonCodes, owner });
    const current = grouped.get(key) ?? { gap_class: gapClass,
      reason_codes: Object.freeze(reasonCodes), responsible_owner: owner,
      occurrence_count: 0, obligations: new Set() };
    current.occurrence_count += 1;
    const obligationId = row.semantic_identity?.obligation_id;
    if (typeof obligationId === "string") current.obligations.add(obligationId);
    grouped.set(key, current);
  }
  const groups = [...grouped.values()].map((group) => {
    const ids = capped([...group.obligations].sort(), GAP_GROUP_OBLIGATION_LIMIT);
    return Object.freeze({
      gap_class: group.gap_class,
      reason_codes: group.reason_codes,
      responsible_owner: group.responsible_owner,
      occurrence_count: group.occurrence_count,
      affected_obligation_count: group.obligations.size,
      affected_obligation_ids: ids.listed,
      affected_obligation_ids_omitted: ids.omitted
    });
  }).sort((left, right) =>
    CONTROLLED_CONTRACT_TERMINAL_GAP_CLASSES.indexOf(left.gap_class) -
      CONTROLLED_CONTRACT_TERMINAL_GAP_CLASSES.indexOf(right.gap_class) ||
    JSON.stringify(left.reason_codes).localeCompare(JSON.stringify(right.reason_codes)));
  const affected = [...new Set([...grouped.values()].flatMap((group) =>
    [...group.obligations]))].sort();
  const inlineAffected = capped(affected, AFFECTED_OBLIGATION_LIMIT);
  const inlineGroups = capped(groups, GAP_GROUP_LIMIT);
  return { groups: inlineGroups.listed,
    group_count: groups.length,
    groups_omitted: inlineGroups.omitted,
    affected_obligation_ids: inlineAffected.listed,
    affected_obligation_ids_omitted: inlineAffected.omitted,
    affected_obligation_count: affected.length };
}

export function classifyControlledContractTerminalGaps({ workbench,
  repairOutcome = null, evidenceLimit = 20 } = {}) {
  const counts = Object.fromEntries(
    CONTROLLED_CONTRACT_TERMINAL_GAP_CLASSES.map((gapClass) => [gapClass, 0]));
  const rows = [
    ...workbench.actionable_rows.map((row) =>
      ({ row, gap_class: actionableGapClass(row) })),
    ...workbench.non_actionable_rows.map((row) =>
      ({ row, gap_class: classifyRow(row) }))
  ];
  for (const { gap_class: gapClass } of rows) counts[gapClass] += 1;
  const present = CONTROLLED_CONTRACT_TERMINAL_GAP_CLASSES.filter(
    (gapClass) => counts[gapClass] > 0);

  const primary = present[0] ?? null;
  const grouped = gapGroups(rows);
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_TERMINAL_GAP_SCHEMA_VERSION,
    acceptable: rows.length === 0,
    primary_gap_class: primary,
    gap_class_counts: Object.freeze(counts),
    gap_classes_present: Object.freeze(present),
    total_gap_count: rows.length,

    gap_groups: grouped.groups,
    gap_group_count: grouped.group_count,
    gap_groups_omitted: grouped.groups_omitted,
    affected_obligation_ids: grouped.affected_obligation_ids,
    affected_obligation_ids_omitted: grouped.affected_obligation_ids_omitted,
    affected_obligation_count: grouped.affected_obligation_count,
    evidence: Object.freeze(rows.slice(0, evidenceLimit).map(
      ({ row, gap_class: gapClass }) => Object.freeze({
        row_id: row.row_id,
        gap_class: gapClass,
        reason_codes: Object.freeze([...(Array.isArray(row.reason_codes)
          ? row.reason_codes : [])]),

        obligation_id: row.semantic_identity?.obligation_id ?? null,
        responsible_owner: row.semantic_owner ?? null
      }))),
    evidence_omitted: Math.max(0, rows.length - evidenceLimit),
    repair_outcome: repairOutcome === null ? null : Object.freeze({
      attempted: repairOutcome.attempted === true,
      settled: repairOutcome.settled === true,
      gap_class: repairOutcome.gap_class ?? null,
      reason_code: repairOutcome.reason_code ?? null,
      responsible_owner: repairOutcome.responsible_owner ?? null
    })
  });
}
