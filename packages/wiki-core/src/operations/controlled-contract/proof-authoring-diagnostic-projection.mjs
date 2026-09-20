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
