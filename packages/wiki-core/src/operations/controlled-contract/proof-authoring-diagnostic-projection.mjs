import { controlledContractContentDigest } from "../../lib/controlled-contract-tools.mjs";

export const PROOF_AUTHORING_DIAGNOSTIC_PROJECTION_VERSION =
  "proof-authoring-diagnostic-projection.v2";

const AFFECTED_OBLIGATION_PREVIEW_LIMIT = 16;

function unitAddress({ wkId, selectedUnit }) {
  return selectedUnit === null ? wkId : `${wkId}#${selectedUnit}`;
}

function detailCall({ wk_id: wkId, focus, selected_unit: selectedUnit }, diagnosticGroupId) {
  return Object.freeze({
    tool: "workspace_validate_proof",
    arguments: Object.freeze({
      unit: unitAddress({ wkId, selectedUnit }),
      ...(focus === null ? {} : { focus }),
      diagnostic_group_id: diagnosticGroupId
    })
  });
}

export function proofAuthoringDiagnosticGroupId(resultIdentity, version, semanticKey) {
  return `diagnostic-group-${controlledContractContentDigest({
    result_identity: resultIdentity,
    projection_version: version,
    semantic_key: semanticKey
  }).replace(/^sha256:/u, "")}`;
}

function compactCause(group) {
  const diagnostic = group.occurrences?.[0]?.diagnostic ?? null;
  const problem = diagnostic?.problem ?? null;
  if (problem?.cause && typeof problem.cause === "object") {
    return Object.freeze({
      category: problem.category ?? group.category,
      kind: problem.cause.kind ?? null,
      definition_sensitive: problem.definition_sensitive === true
    });
  }
  return Object.freeze({
    category: group.category,
    kind: "owner_diagnostic",
    definition_sensitive: false
  });
}

const OBLIGATION_COVERAGE_UPSERT_TOOL =
  "workspace_controlled_contract_obligation_coverage_upsert";

function authoringSelection(group, source) {
  const caseIds = new Map();
  for (const occurrence of group.occurrences ?? []) {
    const obligationId = occurrence?.obligation_id;
    const caseId = occurrence?.diagnostic?.problem?.cause?.case_id;
    if (typeof obligationId !== "string" || caseIds.has(obligationId)) continue;
    if (typeof caseId === "string") caseIds.set(obligationId, caseId);
  }
  const affected = (group.affected_obligation_ids ?? [])
    .slice(0, AFFECTED_OBLIGATION_PREVIEW_LIMIT)
    .filter((obligationId) => typeof obligationId === "string");
  if (affected.length === 0) return null;
  return Object.freeze({
    unit: unitAddress({ wkId: source.wk_id, selectedUnit: source.selected_unit }),
    obligations: Object.freeze(affected.map((obligationId) => Object.freeze({
      obligation_id: obligationId,
      ...(caseIds.has(obligationId)
        ? { case: Object.freeze({ case_id: caseIds.get(obligationId) }) }
        : {})
    })))
  });
}

function compactSupportedNextCall(call, group, source) {
  if (call === null || call === undefined) return call ?? null;
  if (call.tool !== OBLIGATION_COVERAGE_UPSERT_TOOL) return call;
  const selection = authoringSelection(group, source);
  if (selection === null) return call;
  return Object.freeze({ ...call, arguments: Object.freeze({
    ...(call.arguments ?? {}), ...selection }) });
}

function compactRouteAssessment(group, source) {
  const route = group.route_assessment;
  const operation = route?.unavailable_operation;
  const recovery = route?.recovery;
  return Object.freeze({
    effect: route?.effect ?? 'unresolved',
    stage: route?.stage ?? 'unclassified',
    selected_route: route?.selected_route ?? 'unknown',
    owner_code: route?.owner_code ?? group.code,
    reason: route?.reason ?? 'Selected-route applicability is unresolved.',
    unavailable_operation: operation === null || operation === undefined ? null
      : Object.freeze({ kind: operation.kind, id: operation.id,
        identity: operation.identity, state: operation.state,
        description: operation.description }),
    responsible_owner: route?.responsible_owner ?? group.owner,
    recovery: recovery === null || recovery === undefined ? null
      : Object.freeze({ status: recovery.status,
        supported_next_call: compactSupportedNextCall(
          recovery.supported_next_call, group, source),
        operator_action: recovery.operator_action,
        explanation: recovery.explanation })
  });
}

export function projectProofAuthoringDiagnosticGroups({
  grouped,
  resultIdentity,
  wkId,
  focus = null,
  selectedUnit = null
}) {
  if (!grouped || typeof grouped.version !== "string" ||
      grouped.identity_digest !== resultIdentity || !Array.isArray(grouped.groups) ||
      !Array.isArray(grouped.categories)) {
    throw new TypeError("Grouped proof-authoring diagnostics are required");
  }
  const source = Object.freeze({ wk_id: wkId, focus, selected_unit: selectedUnit });
  const groups = grouped.groups.map((group) => {
    const diagnosticGroupId = proofAuthoringDiagnosticGroupId(
      resultIdentity, grouped.version, group.semantic_key
    );
    const affected = Array.isArray(group.affected_obligation_ids)
      ? group.affected_obligation_ids : [];
    return Object.freeze({
      diagnostic_group_id: diagnosticGroupId,
      category: group.category,
      owner: group.owner,
      code: group.code,
      severity: group.severity,
      actionable_meaning: group.actionable_meaning,
      cause: compactCause(group),
      route_effect: group.route_effect,
      route_assessment: compactRouteAssessment(group, source),
      occurrence_count: group.occurrence_count,
      affected_obligation_count: group.affected_obligation_count,
      global_occurrence_count: group.global_occurrence_count,
      affected_obligation_ids: Object.freeze(
        affected.slice(0, AFFECTED_OBLIGATION_PREVIEW_LIMIT)
      ),
      affected_obligation_ids_truncated:
        affected.length > AFFECTED_OBLIGATION_PREVIEW_LIMIT,
      detail_call: detailCall(source, diagnosticGroupId)
    });
  });
  return Object.freeze({
    schema_version: PROOF_AUTHORING_DIAGNOSTIC_PROJECTION_VERSION,
    source,
    result_identity: resultIdentity,
    grouping_version: grouped.version,
    counts: Object.freeze(structuredClone(grouped.counts)),
    categories: Object.freeze(structuredClone(grouped.categories)),
    groups: Object.freeze(groups)
  });
}

export const PROOF_VALIDATION_ASSESSMENT_SCHEMA_VERSION = "proof-validation-assessment.v2";
export const PROOF_VALIDATION_SELECTED_DIAGNOSIS_SCHEMA_VERSION =
  "proof-validation-selected-diagnosis.v1";
export const PROOF_VALIDATION_ALLOWED_SELECTORS = Object.freeze(["diagnostic_group_id", "obligation_id"]);
export const PROOF_VALIDATION_EXECUTION = Object.freeze({
  status: "not_started", proofs_executed: 0, credit_granted: 0 });

const ISSUE_EFFECTS = new Set(["blocking", "unresolved"]);
const ISSUE_SEMANTIC_RECOVERIES = new Set(["authored_correction_available", "system_owner_failure"]);

const SUBJECT_NON_FACTS = new Set(["code", "reason", "owner", "severity", "problem", "kind", "obligation_id",
  "actor_recovery", "owner_details", "route_assessment", "definition_sensitive"]);

export function proofAuthoringGroupMeaning(group, raw) {
  const route = group.route_assessment;
  const first = raw.occurrences[0]?.diagnostic ?? null;
  const assessed = first?.problem?.route_assessment !== undefined;
  return Object.freeze({
    owner: group.owner,
    code: group.code,
    category: group.category,
    effect: route.effect,
    stage: route.stage,
    route: route.selected_route,
    ...(route.responsible_owner !== null && route.responsible_owner !== group.owner
      ? { responsible_owner: route.responsible_owner } : {}),
    reason: assessed || typeof first?.reason !== "string" ? route.reason : first.reason
  });
}

export function proofValidationIssues({ authoringGroups, rawGroups, semanticGroups, semanticMeaning }) {
  const authoring = authoringGroups.map((group, index) => ({ group, raw: rawGroups[index] }))
    .filter(({ group }) => ISSUE_EFFECTS.has(group.route_assessment.effect))
    .map(({ group, raw }) => ({ meaning: proofAuthoringGroupMeaning(group, raw), subjects: group.affected_obligation_count,
      occurrences: group.occurrence_count, call: group.detail_call,
      obligation_ids: [...group.affected_obligation_ids],
      obligations_omitted: group.affected_obligation_count - group.affected_obligation_ids.length }));
  const semantic = semanticGroups.filter(group => ISSUE_SEMANTIC_RECOVERIES.has(group.recovery.status))
    .map(group => ({ meaning: semanticMeaning(group), subjects: group.affected_obligation_count,
      occurrences: group.occurrence_count, call: group.detail_call,
      obligation_ids: [...group.affected_obligation_ids],
      obligations_omitted: group.affected_obligation_ids_omitted }));
  return [...authoring, ...semantic];
}

function indexedIssues(issues) {
  const meanings = [];
  const index = new Map();
  const rows = issues.map(({ meaning, ...issue }) => {
    const key = JSON.stringify(meaning);
    if (!index.has(key)) { index.set(key, meanings.length); meanings.push(meaning); }
    return { meaning: index.get(key), ...issue };
  });
  return { meanings, issues: rows };
}

export function proofValidationAssessment({ envelope, diagnostics, issues, fits = () => true }) {
  const build = (admitted) => {
    const { meanings, issues: rows } = indexedIssues(admitted);
    return {
      schema_version: PROOF_VALIDATION_ASSESSMENT_SCHEMA_VERSION,
      ...envelope,
      diagnostics: {
        authoring_groups: diagnostics.authoring_groups,
        semantic_groups: diagnostics.semantic_groups,
        meanings,
        issues: rows,
        issues_returned: rows.length,
        issues_omitted: issues.length - rows.length,
        subjects_included: false,
        authoring_occurrence_effects: diagnostics.authoring_occurrence_effects,
        semantic_logical_cause_recovery: diagnostics.semantic_logical_cause_recovery,
        issue_selection_basis: "group_recovery"
      },
      allowed_selectors: [...PROOF_VALIDATION_ALLOWED_SELECTORS]
    };
  };
  let admitted = [];
  for (const issue of issues) {
    const candidate = [...admitted, issue];
    if (!fits(build(candidate))) break;
    admitted = candidate;
  }
  return build(admitted);
}

const isTypedFact = value => value === null || ["string", "number", "boolean"].includes(typeof value) ||
  (Array.isArray(value) && value.length <= 16 && value.every(item => ["string", "number"].includes(typeof item)));

function authoringSubject(occurrence, recoveryFacts) {
  const { diagnostic } = occurrence;
  const cause = diagnostic.problem?.cause ?? {};
  const facts = {};
  for (const [name, value] of [...Object.entries(diagnostic), ...Object.entries(cause)]) {
    if (SUBJECT_NON_FACTS.has(name) || Object.hasOwn(facts, name) || value === null ||
        value === undefined || !isTypedFact(value)) continue;

    if (name === "owner_code" && value === diagnostic.code) continue;
    facts[name] = value;
  }
  const typed = recoveryFacts(diagnostic);
  return { obligation_id: occurrence.obligation_id, ...facts,
    ...(typed === null ? {} : { failed_fields: typed.failed_fields.map(field => ({ ...field })),
      corrections: [...typed.corrections] }) };
}

export function proofAuthoringGroupDiagnosis({ projected, raw, recoveryFacts, publicRecovery }) {
  const meaning = proofAuthoringGroupMeaning(projected, raw);
  const route = projected.route_assessment;
  const first = raw.occurrences[0]?.diagnostic ?? null;
  const recovery = (first === null ? null : publicRecovery(first)) ??
    { explanation: route.recovery?.explanation ?? null, instructions: null };
  const supported = route.recovery?.supported_next_call ?? null;
  return {
    selected: { diagnostic_group_id: projected.diagnostic_group_id, owner: meaning.owner, code: meaning.code,
      category: meaning.category, effect: meaning.effect, stage: meaning.stage, route: meaning.route,
      ...(meaning.responsible_owner === undefined ? {} : { responsible_owner: meaning.responsible_owner }),
      ...(projected.cause.kind === "owner_diagnostic" ? {} : { cause_kind: projected.cause.kind }),
      ...(route.unavailable_operation === null ? {} : { unavailable_operation: route.unavailable_operation }),
      meaning: meaning.reason },

    recovery: { ...(typeof first?.problem?.cause?.actor_recovery === "string"
      ? { actor_recovery: first.problem.cause.actor_recovery } : {}),
    explanation: recovery.explanation, instructions: recovery.instructions },
    subjects: raw.occurrences.map(occurrence => authoringSubject(occurrence, recoveryFacts)),
    correction_route: supported === null ? null : { tool: supported.tool, kind: supported.kind ?? null,
      arguments: supported.arguments ?? {} }
  };
}

export function semanticCauseGroupDiagnosis({ group, semanticMeaning, semanticSubject, semanticCorrection }) {
  const meaning = semanticMeaning(group);
  const correction = semanticCorrection(group);
  return {
    selected: { diagnostic_group_id: group.diagnostic_group_id, owner: meaning.owner,
      gap_class: meaning.gap_class, reason_codes: meaning.reason_codes, recovery_status: meaning.recovery,
      meaning: meaning.reason },

    recovery: { route: correction },
    subjects: group.occurrences.map(semanticSubject),
    correction_route: correction === null ? null
      : { tool: correction.write_tool, kind: "structured_route", arguments: group.recovery.correction.arguments }
  };
}

export function addressedCorrectionCall(route, subjects, { unit, focus, contentDigest }) {
  if (route === null || typeof route.tool !== "string") return null;
  if (route.tool !== OBLIGATION_COVERAGE_UPSERT_TOOL) return { tool: route.tool, kind: route.kind, arguments: route.arguments };
  const addressed = [...new Map(subjects.filter(subject => typeof subject.obligation_id === "string")
    .map(subject => [subject.obligation_id, { obligation_id: subject.obligation_id,
      ...(typeof subject.case_id === "string" ? { case: { case_id: subject.case_id } } : {}) }])).values()];
  if (addressed.length === 0) return null;
  return { tool: route.tool, kind: route.kind ?? "structured_route", arguments: {
    unit, ...(focus === null ? {} : { focus }), obligations: addressed, expected_content_digest: contentDigest } };
}

export function usedCorrectionDefinitions(subjects, clauses) {
  const used = [...new Set(subjects.flatMap(subject => subject.corrections ?? []))];
  return Object.fromEntries(used.map(clause => [clause, { ...clauses[clause] }]));
}
