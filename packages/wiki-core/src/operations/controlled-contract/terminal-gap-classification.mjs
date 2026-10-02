

import { createHash } from "node:crypto";

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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])])
  );
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function unitAddress(subject) {
  return subject?.selected_unit == null
    ? subject?.wk_id : `${subject.wk_id}#${subject.selected_unit}`;
}

function semanticCauseSource(workbench) {
  return Object.freeze({ ...structuredClone(workbench.subject ?? null),
    evaluated_population: structuredClone(
      workbench.evaluated_snapshot?.population ?? null) });
}

function diagnosticOwner(row) {
  return row.diagnostic_provenance?.owner ?? null;
}

function causeDetailCall(subject, semanticCauseId) {
  return Object.freeze({ tool: "workspace_validate_proof", arguments: Object.freeze({
    unit: unitAddress(subject),
    ...(subject?.focus == null ? {} : { focus: subject.focus }),
    diagnostic_group_id: semanticCauseId
  }) });
}

function causeCollectionCall(subject) {
  return Object.freeze({ tool: "workspace_validate_proof", arguments: Object.freeze({
    unit: unitAddress(subject),
    ...(subject?.focus == null ? {} : { focus: subject.focus }),
  }) });
}

function capped(values, limit) {
  return { listed: Object.freeze(values.slice(0, limit)),
    omitted: Math.max(0, values.length - limit) };
}

function recoveryForGroup(group, subject) {
  const authorities = [...new Map(group.occurrences.map(({ row }) =>
    row.repair_authority).filter((authority) =>
    authority?.status === "authenticated" &&
      typeof authority.semantic_owner === "string").map((authority) =>
    [authority.semantic_owner, authority])).values()];
  const guidance = group.occurrences.map(({ row }) => row.recovery_guidance)
    .find((entry) => entry && typeof entry === "object") ?? null;
  const internal = group.gap_class === "tooling_or_internal_invariant";
  const authored = authorities.length === 1 &&
    typeof guidance?.write_tool === "string";
  return Object.freeze({
    status: internal ? "system_owner_failure"
      : authored ? "authored_correction_available" : "inspection_only",
    actor_recovery: internal ? "system_owner" : authored ? "agent" : "none",
    explanation: internal
      ? "The semantic classifier or its owner failed; changing authored proof inputs is not an established correction."
      : authored
        ? `The authenticated ${authorities[0].semantic_owner} transition accepts an authored correction after reading the current source revision.`
        : "The cause can be inspected, but this assessment established no authenticated authored transition that repairs it.",
    inspection_call: null,
    correction: authored ? Object.freeze({
      semantic_owner: authorities[0].semantic_owner,
      read_tool: guidance.read_tool ?? null,
      write_tool: guidance.write_tool,
      validation_tool: guidance.validation_tool ?? null,
      arguments: Object.freeze({ unit: unitAddress(subject),
        ...(subject?.focus == null ? {} : { focus: subject.focus }) }),
      requires_authored_values: true
    }) : null
  });
}

function logicalCauses(rows, subject) {
  const causes = new Map();
  for (const { row, gap_class: gapClass } of rows) {
    const reasonCodes = [...(Array.isArray(row.reason_codes)
      ? row.reason_codes : [])];
    const obligationId = row.semantic_identity?.obligation_id ?? null;
    const key = JSON.stringify({ gapClass, reasonCodes, obligationId });
    const cause = causes.get(key) ?? {
      gap_class: gapClass,
      reason_codes: Object.freeze(reasonCodes),
      obligation_id: obligationId,
      occurrences: []
    };
    cause.occurrences.push({ row, gap_class: gapClass });
    causes.set(key, cause);
  }
  const values = [...causes.values()];
  const recoveryStatusCounts = Object.freeze(Object.fromEntries(
    ['authored_correction_available', 'system_owner_failure', 'inspection_only']
      .map(status => [status, values.filter(cause =>
        recoveryForGroup(cause, subject).status === status).length])));
  return Object.freeze({ count: values.length, recovery_status_counts: recoveryStatusCounts });
}

function gapGroups(rows, subject) {
  const grouped = new Map();
  for (const { row, gap_class: gapClass } of rows) {
    const reasonCodes = [...(Array.isArray(row.reason_codes) ? row.reason_codes : [])];
    const owner = diagnosticOwner(row);
    const key = JSON.stringify({ gapClass, reasonCodes, owner });
    const current = grouped.get(key) ?? { gap_class: gapClass,
      reason_codes: Object.freeze(reasonCodes), diagnostic_owner: owner,
      occurrence_count: 0, obligations: new Set(), occurrences: [] };
    current.occurrence_count += 1;
    current.occurrences.push({ row, gap_class: gapClass });
    const obligationId = row.semantic_identity?.obligation_id;
    if (typeof obligationId === "string") current.obligations.add(obligationId);
    grouped.set(key, current);
  }
  const groups = [...grouped.values()].map((group) => {
    const ids = capped([...group.obligations].sort(), GAP_GROUP_OBLIGATION_LIMIT);
    const semanticCauseId = `diagnostic-group-${digest({
      kind: "computed_semantic_cause",
      source: subject ?? null,
      gap_class: group.gap_class,
      reason_codes: group.reason_codes,
      diagnostic_owner: group.diagnostic_owner
    })}`;
    const recovery = Object.freeze({ ...recoveryForGroup(group, subject),
      inspection_call: causeDetailCall(subject, semanticCauseId) });
    return Object.freeze({
      semantic_cause_id: semanticCauseId,
      diagnostic_group_id: semanticCauseId,
      gap_class: group.gap_class,
      reason_codes: group.reason_codes,
      diagnostic_owner: group.diagnostic_owner,
      responsible_owner: group.diagnostic_owner,
      repair_authority: Object.freeze({
        status: recovery.status === "authored_correction_available"
          ? "authenticated" : "unavailable",
        semantic_owner: recovery.correction?.semantic_owner ?? null
      }),
      recovery,
      occurrence_count: group.occurrence_count,
      affected_obligation_count: group.obligations.size,
      affected_obligation_ids: ids.listed,
      affected_obligation_ids_omitted: ids.omitted,
      detail_call: causeDetailCall(subject, semanticCauseId),
      occurrences: Object.freeze(group.occurrences.map(({ row, gap_class: gapClass }) =>
        Object.freeze({
          row_id: row.row_id,
          gap_class: gapClass,
          semantic_identity: structuredClone(row.semantic_identity ?? null),
          reason_codes: Object.freeze([...(row.reason_codes ?? [])]),
          non_actionable_reason: row.non_actionable_reason ?? null,
          diagnostic_provenance: structuredClone(row.diagnostic_provenance ?? null),
          repair_authority: structuredClone(row.repair_authority ?? null),
          evidence: structuredClone(row.evidence ?? null),
          recovery_guidance: structuredClone(row.recovery_guidance ?? null)
        })))
    });
  }).sort((left, right) =>
    CONTROLLED_CONTRACT_TERMINAL_GAP_CLASSES.indexOf(left.gap_class) -
      CONTROLLED_CONTRACT_TERMINAL_GAP_CLASSES.indexOf(right.gap_class) ||
    JSON.stringify(left.reason_codes).localeCompare(JSON.stringify(right.reason_codes)));
  const affected = [...new Set([...grouped.values()].flatMap((group) =>
    [...group.obligations]))].sort();
  const inlineAffected = capped(affected, AFFECTED_OBLIGATION_LIMIT);
  const inlineGroups = capped(groups, GAP_GROUP_LIMIT);
  return { groups: inlineGroups.listed.map(({ occurrences: _occurrences,
    recovery: _recovery, ...group }) => Object.freeze(group)),
    all_groups: Object.freeze(groups),
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
  const source = semanticCauseSource(workbench);
  const grouped = gapGroups(rows, source);
  const logical = logicalCauses(rows, source);
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_TERMINAL_GAP_SCHEMA_VERSION,
    acceptable: rows.length === 0,
    primary_gap_class: primary,
    gap_class_counts: Object.freeze(counts),
    gap_classes_present: Object.freeze(present),
    total_gap_count: rows.length,
    observation_count: rows.length,

    gap_groups: grouped.groups,
    gap_group_count: grouped.group_count,
    logical_cause_count: logical.count,
    recovery_status_counts: logical.recovery_status_counts,
    gap_groups_omitted: grouped.groups_omitted,
    affected_obligation_ids: grouped.affected_obligation_ids,
    affected_obligation_ids_omitted: grouped.affected_obligation_ids_omitted,
    affected_obligation_count: grouped.affected_obligation_count,
    detail_call: causeCollectionCall(source),
    evidence: Object.freeze(rows.slice(0, evidenceLimit).map(
      ({ row, gap_class: gapClass }) => Object.freeze({
        row_id: row.row_id,
        gap_class: gapClass,
        reason_codes: Object.freeze([...(Array.isArray(row.reason_codes)
          ? row.reason_codes : [])]),

        obligation_id: row.semantic_identity?.obligation_id ?? null,
        diagnostic_owner: diagnosticOwner(row),
        responsible_owner: diagnosticOwner(row),
        repair_authority: structuredClone(row.repair_authority ?? null)
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

export function semanticCauseMeaning(group) {
  return Object.freeze({
    owner: group.diagnostic_owner ?? null,
    gap_class: group.gap_class,
    reason_codes: Object.freeze([...group.reason_codes]),
    recovery: group.recovery.status,
    reason: group.recovery.explanation
  });
}

const isTypedEvidence = (value) => value === null ||
  ["string", "number", "boolean"].includes(typeof value) ||
  (Array.isArray(value) && value.length <= 16 &&
    value.every((item) => ["string", "number"].includes(typeof item)));

export function semanticCauseSubject(occurrence) {
  const evidence = occurrence.evidence !== null && typeof occurrence.evidence === "object" &&
    !Array.isArray(occurrence.evidence)
    ? Object.fromEntries(Object.entries(occurrence.evidence).filter(([, value]) =>
      isTypedEvidence(value)).map(([name, value]) => [name, structuredClone(value)]))
    : {};
  return Object.freeze({
    obligation_id: occurrence.semantic_identity?.obligation_id ?? null,
    row_id: occurrence.row_id ?? null,
    semantic_identity: structuredClone(occurrence.semantic_identity ?? null),
    ...(occurrence.non_actionable_reason === null ||
      occurrence.non_actionable_reason === undefined
      ? {} : { non_actionable_reason: occurrence.non_actionable_reason }),
    ...(Object.keys(evidence).length === 0 ? {} : { evidence })
  });
}

export function semanticCauseCorrection(group) {
  const correction = group.recovery?.correction ?? null;
  return correction === null ? null : Object.freeze({
    semantic_owner: correction.semantic_owner,
    read_tool: correction.read_tool,
    write_tool: correction.write_tool,
    validation_tool: correction.validation_tool
  });
}

export function projectControlledContractTerminalGapDetails({ workbench } = {}) {
  const rows = [
    ...workbench.actionable_rows.map((row) =>
      ({ row, gap_class: actionableGapClass(row) })),
    ...workbench.non_actionable_rows.map((row) =>
      ({ row, gap_class: classifyRow(row) }))
  ];
  const source = semanticCauseSource(workbench);
  const grouped = gapGroups(rows, source);
  const logical = logicalCauses(rows, source);
  return Object.freeze({
    schema_version: "controlled-contract-semantic-cause-detail.v1",
    source,
    total_occurrence_count: rows.length,
    observation_count: rows.length,
    group_count: grouped.group_count,
    logical_cause_count: logical.count,
    recovery_status_counts: logical.recovery_status_counts,
    groups: grouped.all_groups
  });
}
