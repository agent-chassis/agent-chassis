

import { bindProofAuthoringRevision } from './proof-authoring-revision.mjs';
import { findObligation, unitAddress } from './proof-authoring-preparation.mjs';
import { ControlledContractToolError, assertControlledContractOperationInput,
  controlledContractContentDigest } from '../../lib/controlled-contract-tools.mjs';
import { loadControlledContractProofAuthoring } from './package-runtime.mjs';
import { proofAuthoringOperation } from './refusal.mjs';
import { assessSavedContractSource, independentOwnerFailure } from './proof-authoring-assessment.mjs';
import { resolveProofAuthoringSource, resolveProofAuthoringContext } from './proof-authoring-source.mjs';
import { obligationCoverageResolutionInput } from './proof-authoring-persistence.mjs';
import { addressedCorrectionCall, PROOF_VALIDATION_EXECUTION,
  PROOF_VALIDATION_SELECTED_DIAGNOSIS_SCHEMA_VERSION, proofAuthoringGroupDiagnosis,
  proofValidationAssessment, proofValidationIssues, projectProofAuthoringDiagnosticGroups,
  semanticCauseGroupDiagnosis, usedCorrectionDefinitions } from
  './proof-authoring-diagnostic-projection.mjs';
import { projectProofAuthoringContractInputs } from './proof-authoring-contract-inputs.mjs';
import { acceptanceCriterionInventory, assessAcceptanceCriterionCoverage } from
  './acceptance-criterion-coverage.mjs';
import { inspectControlledContractDesignWorkbenchOperation } from
  './design-workbench-operations.mjs';
import { projectControlledContractTerminalGapDetails, semanticCauseCorrection,
  semanticCauseMeaning, semanticCauseSubject } from
  './terminal-gap-classification.mjs';

function validationCall(resolved, fields = {}) {
  return { tool: 'workspace_validate_proof', arguments: {
    unit: unitAddress(resolved), ...(resolved.focus === null ? {} : { focus: resolved.focus }), ...fields
  } };
}

function wholeUnitCriterionCoverage(pkg, resolved, validObligationIds) {
  return assessAcceptanceCriterionCoverage({
    inventory: acceptanceCriterionInventory(pkg, resolved.unit),
    obligations: resolved.source?.content?.obligations ?? [],
    validObligationIds, wkId: resolved.wkId, selectedUnit: resolved.selectedUnit,
    focus: resolved.focus });
}
function selectedObligationCoverageScope(resolved) {
  return Object.freeze({ scope: 'selected_obligation', whole_unit_assessed: false,
    reason: 'A selected obligation\'s validation does not assess the unit\'s acceptance-criterion coverage.',
    supported_next_call: validationCall(resolved) });
}

function validationAssessment(resolved, result) {
  const rows = result.rows ?? [];
  const assessedRows = rows.filter(row => row.selected_proof_assessment !== null &&
    row.selected_proof_assessment !== undefined);
  const stageCount = (stage, status) => assessedRows.filter(row =>
    row.selected_proof_assessment?.stages?.[stage]?.status === status).length;
  const authoredValid = rows.filter(row => row.status === 'valid').length;
  const routeDiagnostics = assessedRows.flatMap(row => row.diagnostics).filter(diagnostic =>
    diagnostic.problem?.route_assessment !== undefined);
  const routeEffectCount = effect => routeDiagnostics.filter(diagnostic =>
    diagnostic.problem.route_assessment.effect === effect).length;
  const prevents = assessedRows.filter(row =>
    row.selected_proof_assessment.prevents_selected_route === true).length;
  return {
    authored: { status: rows.length > 0 && authoredValid === rows.length ? 'valid' : 'invalid',
      obligations: result.counts.obligations, valid: authoredValid, invalid: rows.length - authoredValid,
      explicit_gaps: result.counts.explicit_gaps, unselected: result.counts.unselected },
    route: {
      status: assessedRows.length === 0 ? 'not_assessed' : assessedRows.every(row =>
        row.selected_proof_assessment.prevents_selected_route === false)
        ? 'clear' : routeEffectCount('unresolved') > 0 ? 'unresolved' : 'blocked',
      assessed: assessedRows.length,
      prevents,
      stages: {
        authored_inputs: { complete: stageCount('authored_inputs', 'complete'),
          incomplete: stageCount('authored_inputs', 'incomplete') },
        canonical_sources: { current: stageCount('canonical_sources', 'current'),
          unresolved: stageCount('canonical_sources', 'unresolved') },
        system_capability: { available: stageCount('system_capability', 'available'),
          unavailable: stageCount('system_capability', 'unavailable') },
        execution_evidence: { not_started: stageCount('execution_evidence', 'not_started'),
          credit_granted: 0 }
      }
    },
    authoring_occurrence_effects: { scope: 'selected_routes_only', blocking: routeEffectCount('blocking'),
      nonblocking: routeEffectCount('nonblocking'), unresolved: routeEffectCount('unresolved') }
  };
}

const USER_REQUIREMENTS_COMPARISON_TARGETS = Object.freeze({
  whole_unit: 'the authored contract and obligations',
  selected_obligation: 'this obligation (whole-unit validity and coverage unassessed)',
  authored_scope: 'the authored scope'
});
function userRequirementsComparison(resolved, scope, deps) {
  if (deps.presentation?.orchestrator !== true) return {};
  const recorded = resolved.record?.sections?.user_requirements;
  const state = typeof recorded !== 'string' ? 'not_recorded' : recorded.length === 0 ? 'empty' : 'recorded';
  return { user_requirements_comparison: {
    scope,
    advisory: `Before dispatch, compare the current user requirements with ${USER_REQUIREMENTS_COMPARISON_TARGETS[scope]} ` +
      'for omissions, unjustified narrowing and unrequested scope; authored validity does not establish coverage of ' +
      'the user request.' + (state === 'recorded' ? '' : ' None are recorded, so coverage is unestablished.'),
    requirements: state,
    read_call: state === 'not_recorded' ? null : { tool: 'workspace_work_record_summary',
      arguments: { unit: resolved.wkId, ordinary_field: { field: 'sections.user_requirements' } } }
  } };
}

const dispatchNotAssessed = resolved => ({ status: 'not_assessed',
  call: { tool: 'workspace_validate_dispatch', arguments: { unit: unitAddress(resolved) } } });

function compactCriterionCoverage(coverage) {
  return { status: coverage.status, criteria: coverage.criterion_count, covered: coverage.covered_count,
    uncovered: coverage.uncovered_count, stale: coverage.stale_association_count,
    correction: coverage.correction };
}

function validationEnvelope(resolved, { sourceDigest, contextDigest }) {
  return { unit: unitAddress(resolved), content_digest: resolved.revision,
    source: { status: resolved.source === null ? 'source_absent' : 'source_present',
      source_digest: sourceDigest, context_digest: contextDigest } };
}

function publicOwnerFailure(failure) {
  return { code: failure.code, ownership: failure.ownership, responsible_owner: failure.responsible_owner,
    message: failure.message, cause: { code: failure.cause.code, class: failure.cause.class },
    details: failure.details === null ? null : structuredClone(failure.details),
    recovery: { actor_recovery: 'system_owner',
      explanation: 'An independent validation owner failed; this is not an authored-input defect, and changing ' +
        'authored proof inputs is not an established correction.' } };
}

function refuseOversizedValidationAnswer({ scope, bytes, limit, reason, nextCalls = [] }) {
  throw new ControlledContractToolError('proof_validation_answer_exceeds_compact_class',
    `The validation answer for ${JSON.stringify(scope)} measures ${bytes} bytes, above the ${limit}-byte compact class`, {
      changed: false, phase: 'delivery', scope, measured_bytes: bytes, limit, reason,
      next_calls: nextCalls });
}

function validationDelivery(deps) {
  const delivery = deps.delivery ?? null;
  return delivery === null
    ? { fits: () => true, measure: () => 0, limit: null }
    : { fits: value => delivery.measure(value) <= delivery.limit, measure: delivery.measure,
      limit: delivery.limit };
}

const correctionAddress = resolved => ({ unit: unitAddress(resolved), focus: resolved.focus,
  contentDigest: resolved.revision });

function publicDiagnosis(diagnosis, subjects, { address, clauses }) {
  const call = addressedCorrectionCall(diagnosis.correction_route, subjects, address);
  return { ...diagnosis.selected, recovery: diagnosis.recovery, subjects,
    corrections: usedCorrectionDefinitions(subjects, clauses),
    correction_call: call,
    ...(call !== null && call.tool === UPSERT_TOOL_NAME ? { requires_authored_values: true } : {}) };
}

const UPSERT_TOOL_NAME = 'workspace_controlled_contract_obligation_coverage_upsert';

function capturedDiagnosis({ family, diagnosis, subjects }, { address, clauses }) {
  const { corrections, ...body } = publicDiagnosis(diagnosis, subjects, { address, clauses });
  return { entry: { family, ...body, correction_route: diagnosis.correction_route }, corrections };
}

export function narrowCapturedDiagnosis(inventory, captured, subjects) {
  const { family, subjects: _subjects, correction_call: _call, requires_authored_values: _values,
    correction_route: route, recovery, ...selected } = captured;
  const { entry, corrections } = capturedDiagnosis({ family,
    diagnosis: { selected, recovery, correction_route: route }, subjects }, {
    address: { unit: inventory.unit, focus: inventory.focus, contentDigest: inventory.content_digest },
    clauses: inventory.corrections });
  return { diagnosis: entry, corrections };
}

function diagnosisInventory({ resolved, envelope, obligationId, entries, families, clauses }) {
  const address = correctionAddress(resolved);
  const diagnoses = entries.map(entry => capturedDiagnosis(entry, { address, clauses }).entry);
  return { unit: envelope.unit, focus: resolved.focus, content_digest: envelope.content_digest,
    source: envelope.source,
    population: obligationId === undefined
      ? { scope: 'whole_unit', obligation_ids: (resolved.source?.content?.obligations ?? [])
        .map(obligation => obligation.obligation_id) }
      : { scope: 'selected_obligation', obligation_ids: [obligationId] },
    group_selectable: resolved.source !== null,
    complete: Object.values(families).every(family => family.status !== 'incomplete' &&
      family.status !== 'unavailable'),
    families, diagnoses,
    corrections: usedCorrectionDefinitions(diagnoses.flatMap(diagnosis => diagnosis.subjects), clauses) };
}
const familyAvailability = (failure, failed) => failure === null ? { status: 'complete', failure: null }
  : { status: failed, failure: publicOwnerFailure(failure) };

function selectedGroupAnswer({ envelope, diagnosis, resolved, clauses, delivery }) {
  const { subjects } = diagnosis;
  const build = (included, extra = {}) => {
    const body = publicDiagnosis(diagnosis, included, { address: correctionAddress(resolved), clauses });
    const { subjects: listed, corrections, correction_call: call, requires_authored_values: values,
      recovery, ...selected } = body;
    return { schema_version: PROOF_VALIDATION_SELECTED_DIAGNOSIS_SCHEMA_VERSION, ...envelope, selected,
      recovery, subjects: listed, corrections, correction_call: call,
      ...(values === undefined ? {} : { requires_authored_values: values }),
      subjects_total: subjects.length, subjects_omitted: subjects.length - included.length, ...extra,
      complete: included.length === subjects.length && extra.subject_index === undefined,
      execution: { ...PROOF_VALIDATION_EXECUTION } };
  };
  const complete = build(subjects);
  if (delivery.fits(complete)) return complete;
  const identified = subjects.every(subject => typeof subject.obligation_id === 'string');
  const ids = [...new Set(subjects.map(subject => subject.obligation_id))];
  const index = build([], { subject_index: { obligation_ids: ids, selector: 'obligation_id',
    call: validationCall(resolved) } });
  if (identified && ids.length > 0 && delivery.fits(index)) return index;
  let admitted = [];
  for (const subject of subjects) {
    const candidate = [...admitted, subject];
    if (!delivery.fits(build(candidate))) break;
    admitted = candidate;
  }
  if (admitted.length > 0) return build(admitted);
  const empty = build([]);
  if (delivery.fits(empty)) return empty;
  return refuseOversizedValidationAnswer({ scope: { unit: envelope.unit,
    diagnostic_group_id: diagnosis.selected.diagnostic_group_id }, bytes: delivery.measure(empty),
  limit: delivery.limit, reason: 'the selected group\'s shared cause and recovery alone exceed the compact class' });
}

function selectedObligationAnswer({ envelope, obligationId, row, route, diagnoses, ownerFailures,
  resolved, clauses, delivery, comparison }) {

  const build = (admitted) => ({ schema_version: PROOF_VALIDATION_SELECTED_DIAGNOSIS_SCHEMA_VERSION, ...envelope,
    selected: { obligation_id: obligationId, authored: row?.status ?? 'invalid',
      route: route === null ? 'not_assessed' : route.prevents_selected_route === false ? 'clear' : 'blocked' },
    owner_failures: ownerFailures,
    diagnoses: admitted.map(({ entry }) => entry),
    corrections: Object.assign({}, ...admitted.map(({ corrections }) => corrections)),
    diagnoses_total: diagnoses.length, diagnoses_returned: admitted.length,
    diagnoses_omitted: diagnoses.length - admitted.length,
    complete: admitted.length === diagnoses.length,
    acceptance_coverage: selectedObligationCoverageScope(resolved),
    ...(row?.status === 'valid' ? comparison : {}),
    execution: { ...PROOF_VALIDATION_EXECUTION } });
  const entries = diagnoses.map(({ diagnosis, subjects }) => {
    const { corrections, ...entry } = publicDiagnosis(diagnosis, subjects,
      { address: correctionAddress(resolved), clauses });
    return { entry, corrections };
  });
  let admitted = [];
  for (const entry of entries) {
    const candidate = [...admitted, entry];
    if (!delivery.fits(build(candidate))) break;
    admitted = candidate;
  }
  if (admitted.length === 0 && entries.length > 0) {
    return refuseOversizedValidationAnswer({ scope: { unit: envelope.unit, obligation_id: obligationId },
      bytes: delivery.measure(build(entries.slice(0, 1))), limit: delivery.limit,
      reason: 'the selected obligation\'s first indivisible diagnosis exceeds the compact class; ' +
        'no narrower existing selection states it' });
  }
  return build(admitted);
}

export async function validateProofOperation(input, deps = Object.freeze({})) {
  return (await assessProof(input, deps, { capture: false, fields: [...CAPTURE_FIELDS, 'diagnosticGroupId'] }))
    .assessment;
}

export async function captureProofAssessmentOperation(input, deps = Object.freeze({})) {
  return assessProof(input, { ...deps, delivery: null }, { capture: true, fields: CAPTURE_FIELDS });
}
const CAPTURE_FIELDS = Object.freeze(['repoRoot', 'wkId', 'focus', 'selectedUnit', 'obligationId']);

function assessProof(input, deps, { capture, fields }) {
  return proofAuthoringOperation(async () => {
    assertControlledContractOperationInput(input, fields);
    if (input.obligationId !== undefined && input.diagnosticGroupId !== undefined) throw new ControlledContractToolError(
      'obligation_coverage_request_invalid', 'Select either one obligation or one diagnostic group', {
        changed: false, phase: 'request'
      });
    const delivery = validationDelivery(deps);
    const resolved = await bindProofAuthoringRevision(await resolveProofAuthoringSource(
      obligationCoverageResolutionInput(input), { requireSource: false }));
    if (resolved.source === null) {
      const assessment = await sourceAbsentValidation(resolved, input, delivery, deps);

      const absent = { status: 'not_applicable', failure: null };
      return { assessment, diagnosis_inventory: capture ? diagnosisInventory({ resolved, envelope: assessment,
        obligationId: undefined, entries: [], families: { authoring: absent, semantic: absent },
        clauses: {} }) : null };
    }
    const pkg = await loadControlledContractProofAuthoring();
    const obligationId = input.obligationId;
    if (obligationId !== undefined) findObligation(resolved, obligationId);

    const context = await resolveProofAuthoringContext(resolved, {});
    const { occurrenceRecoveryFacts, occurrencePublicRecovery, OCCURRENCE_CORRECTION_CLAUSES } =
      await import('@agent-chassis/controlled-contract/executable-map');
    const { result, executableMapFailure } = await assessSavedContractSource({ resolved, context }, deps);
    const grouped = pkg.groupProofAuthoringDiagnostics(result);
    const diagnosticProjection = projectProofAuthoringDiagnosticGroups({
      grouped,
      resultIdentity: result.identity_digest,
      wkId: resolved.wkId,
      focus: resolved.focus,
      selectedUnit: resolved.selectedUnit
    });
    const inspectDesignWorkbench = deps.inspectControlledContractDesignWorkbench ??
      inspectControlledContractDesignWorkbenchOperation;
    let workbenchFailure = null;
    let workbench = null;
    try {
      workbench = await inspectDesignWorkbench({
        repoRoot: input.repoRoot, wkId: input.wkId, focus: input.focus ?? null,
        selectedUnit: input.selectedUnit ?? null
      });
    } catch (error) {
      workbenchFailure = independentOwnerFailure(error,
        'controlled-contract-design-workbench');
      if (workbenchFailure === null) throw error;
    }
    const semanticDetails = workbench === null ? null :
      projectControlledContractTerminalGapDetails({ workbench });
    const semanticGroups = semanticDetails?.groups ?? [];
    const ownerFailures = [executableMapFailure, workbenchFailure].filter(Boolean).map(publicOwnerFailure);
    const assessment = validationAssessment(resolved, result);
    const envelope = validationEnvelope(resolved, { sourceDigest: result.source_digest,
      contextDigest: result.context_digest });
    const clauses = OCCURRENCE_CORRECTION_CLAUSES;
    const authoringDiagnosis = (index) => proofAuthoringGroupDiagnosis({
      projected: diagnosticProjection.groups[index], raw: grouped.groups[index],
      recoveryFacts: occurrenceRecoveryFacts, publicRecovery: occurrencePublicRecovery });
    const semanticDiagnosis = group => semanticCauseGroupDiagnosis({ group,
      semanticMeaning: semanticCauseMeaning, semanticSubject: semanticCauseSubject,
      semanticCorrection: semanticCauseCorrection });

    if (input.diagnosticGroupId !== undefined) {
      const proofIndex = diagnosticProjection.groups.findIndex(group =>
        group.diagnostic_group_id === input.diagnosticGroupId);
      const semanticGroup = semanticGroups.find(group =>
        group.semantic_cause_id === input.diagnosticGroupId);
      if (proofIndex === -1 && semanticGroup === undefined) {
        if (workbenchFailure !== null) {
          throw new ControlledContractToolError(
            'obligation_coverage_semantic_diagnostic_detail_unavailable',
            'Semantic diagnostic detail is unavailable because its system owner failed', {
              changed: false,
              diagnostic_group_id: input.diagnosticGroupId,
              ownership: 'system',
              responsible_owner: workbenchFailure.responsible_owner,
              cause: workbenchFailure.cause,
              independent_owner_failure: workbenchFailure,
              authored_assessment: { ...assessment.authored, source: envelope.source },
              next_calls: [validationCall(resolved)]
            });
        }
        throw new ControlledContractToolError(
          'obligation_coverage_diagnostic_group_not_found',
          'The diagnostic group is unknown or belongs to a different resolved snapshot', {
            changed: false, diagnostic_group_id: input.diagnosticGroupId,
            next_calls: [validationCall(resolved)]
          });
      }
      const diagnosis = proofIndex === -1 ? semanticDiagnosis(semanticGroup) : authoringDiagnosis(proofIndex);
      return { assessment: selectedGroupAnswer({ envelope, diagnosis, resolved, clauses, delivery }),
        diagnosis_inventory: null };
    }

    const ownerDiagnoses = () => {
      const whole = obligationId === undefined;
      const named = subject => whole || subject.obligation_id === obligationId;
      const authoring = grouped.groups.map((raw, index) => ({ raw, index }))
        .filter(({ raw }) => whole || raw.occurrences.some(occurrence => occurrence.obligation_id === obligationId))
        .map(({ index }) => {
          const diagnosis = authoringDiagnosis(index);
          return { family: 'authoring', diagnosis, subjects: diagnosis.subjects.filter(named),
            priority: ISSUE_PRIORITY.authoring(diagnosis.selected.effect) };
        });
      const semantic = semanticGroups.filter(group => whole || group.occurrences.some(occurrence =>
        occurrence.semantic_identity?.obligation_id === obligationId)).map(group => {
        const diagnosis = semanticDiagnosis(group);
        return { family: 'semantic', diagnosis, subjects: diagnosis.subjects.filter(named),
          priority: ISSUE_PRIORITY.semantic(group.recovery.status) };
      });
      return [...authoring, ...semantic].map((entry, order) => ({ ...entry, order }))
        .sort((left, right) => left.priority - right.priority || left.order - right.order);
    };
    const diagnoses = capture || obligationId !== undefined ? ownerDiagnoses() : [];
    const inventory = capture ? diagnosisInventory({ resolved, envelope, obligationId, entries: diagnoses,
      families: { authoring: familyAvailability(executableMapFailure, 'incomplete'),
        semantic: familyAvailability(workbenchFailure, 'unavailable') }, clauses }) : null;

    if (obligationId !== undefined) {
      const row = result.rows.find(entry => entry.obligation_id === obligationId) ?? null;
      return { assessment: selectedObligationAnswer({ envelope, obligationId, row,
        route: row?.selected_proof_assessment ?? null, diagnoses, ownerFailures, resolved, clauses, delivery,
        comparison: userRequirementsComparison(resolved, 'selected_obligation', deps) }),
      diagnosis_inventory: inventory };
    }

    const coverage = wholeUnitCriterionCoverage(pkg, resolved,
      result.rows.filter(row => row.status === 'valid').map(row => row.obligation_id));
    const issues = proofValidationIssues({ authoringGroups: diagnosticProjection.groups,
      rawGroups: grouped.groups, semanticGroups, semanticMeaning: semanticCauseMeaning });
    const answer = proofValidationAssessment({
      envelope: { ...envelope, authored: assessment.authored, route: assessment.route,
        owner_failures: ownerFailures, execution: { ...PROOF_VALIDATION_EXECUTION },
        dispatch: dispatchNotAssessed(resolved), acceptance_coverage: compactCriterionCoverage(coverage),
        ...(assessment.authored.status === 'valid'
          ? userRequirementsComparison(resolved, 'whole_unit', deps) : {}) },
      diagnostics: { authoring_groups: grouped.groups.length, semantic_groups: semanticDetails?.group_count ?? 0,
        authoring_occurrence_effects: assessment.authoring_occurrence_effects,
        semantic_logical_cause_recovery: semanticDetails?.recovery_status_counts ?? {
          authored_correction_available: 0, system_owner_failure: workbenchFailure === null ? 0 : 1,
          inspection_only: 0 } },
      issues, fits: delivery.fits });
    if (!delivery.fits(answer)) {
      refuseOversizedValidationAnswer({ scope: { unit: envelope.unit }, bytes: delivery.measure(answer),
        limit: delivery.limit, reason: 'the whole-unit assessment envelope alone exceeds the compact class',
        nextCalls: [] });
    }
    return { assessment: answer, diagnosis_inventory: inventory };
  });
}

const ISSUE_PRIORITY = Object.freeze({
  authoring: effect => effect === 'blocking' || effect === 'unresolved' ? 0 : 2,
  semantic: status => status === 'authored_correction_available' || status === 'system_owner_failure' ? 1 : 3
});

async function sourceAbsentValidation(resolved, input, delivery, deps) {
  if (input.obligationId !== undefined) findObligation(resolved, input.obligationId);
  if (input.diagnosticGroupId !== undefined) throw new ControlledContractToolError(
    'obligation_coverage_diagnostic_group_not_found',
    'The diagnostic group is unknown or belongs to a different resolved snapshot', {
      changed: false, diagnostic_group_id: input.diagnosticGroupId, next_calls: [validationCall(resolved)] });
  const contractInputs = projectProofAuthoringContractInputs(resolved);
  const coveragePkg = await loadControlledContractProofAuthoring();
  const findings = [];
  if (contractInputs.controlled_acceptance.status === 'unset') findings.push({
    category: 'author_input', code: 'controlled_acceptance_disposition_missing',
    reason: 'Controlled-acceptance applicability has not been authored',
    owner: 'work-record-proof-posture' });
  if (contractInputs.controlled_acceptance.status === 'invalid') findings.push({
    category: 'canonical_source', code: 'controlled_acceptance_proof_posture_invalid',
    reason: contractInputs.controlled_acceptance.problem, owner: 'work-record-proof-posture' });
  if (contractInputs.controlled_acceptance.disposition === 'required' &&
      contractInputs.requirements.requirements.length === 0) findings.push({
    category: 'author_input', code: 'controlled_contract_requirements_missing',
    reason: 'Controlled acceptance applies but no contract requirements are saved',
    owner: 'contract-requirement-authoring' });
  if (contractInputs.controlled_acceptance.disposition === 'required') findings.push({
    category: 'author_input', code: 'obligation_coverage_source_not_found',
    reason: 'No proof-authoring obligations are saved', owner: 'proof-authoring-source' });
  const identity = controlledContractContentDigest({ contract_inputs: contractInputs, diagnostics: findings });
  const issues = findings.map(finding => ({ meaning: { owner: finding.owner, code: finding.code,
    category: finding.category, reason: finding.reason }, subjects: 0, occurrences: 1, call: null,
  obligation_ids: [], obligations_omitted: 0 }));
  const zero = { obligations: 0, valid: 0, invalid: 0, explicit_gaps: 0, unselected: 0 };
  return proofValidationAssessment({
    envelope: { ...validationEnvelope(resolved, { sourceDigest: null, contextDigest: identity }),
      authored: { status: findings.length === 0 ? 'valid' : 'invalid', ...zero },
      route: { status: 'not_assessed', assessed: 0, prevents: 0, stages: {
        authored_inputs: { complete: 0, incomplete: 0 }, canonical_sources: { current: 0, unresolved: 0 },
        system_capability: { available: 0, unavailable: 0 },
        execution_evidence: { not_started: 0, credit_granted: 0 } } },
      owner_failures: [], execution: { ...PROOF_VALIDATION_EXECUTION }, dispatch: dispatchNotAssessed(resolved),
      acceptance_coverage: compactCriterionCoverage(wholeUnitCriterionCoverage(coveragePkg, resolved, [])),
      ...(findings.length === 0 ? userRequirementsComparison(resolved, 'authored_scope', deps) : {}) },
    diagnostics: { authoring_groups: findings.length, semantic_groups: 0,
      authoring_occurrence_effects: { scope: 'selected_routes_only', blocking: 0, nonblocking: 0, unresolved: 0 },
      semantic_logical_cause_recovery: { authored_correction_available: 0, system_owner_failure: 0,
        inspection_only: 0 } },
    issues, fits: delivery.fits });
}
