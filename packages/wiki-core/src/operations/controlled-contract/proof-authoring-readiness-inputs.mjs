

import { ControlledContractToolError, controlledContractContentDigest,
  readControlledContractCarrierFile, resolveCanonicalControlledContractCarrierSet }
  from '../../lib/controlled-contract-tools.mjs';
import { resolveObligationCoverageFacts, resolveAcceptanceCoverageFacts }
  from './acceptance-coverage-facts.mjs';
import { classifyControlledContractRuntimeEligibility }
  from '../../lib/controlled-contract-runtime-proof-eligibility.mjs';
import { proofAuthoringCompletenessSummary } from './proof-authoring-source.mjs';
import { loadControlledContractPackage } from './package-runtime.mjs';
import { projectProofAuthoringDiagnosticGroups } from
  './proof-authoring-diagnostic-projection.mjs';
import { projectControlledContractRequirements } from
  './contract-requirement-authoring.mjs';
import { coverageUnitArguments } from './coverage-recovery-guidance.mjs';

const identities = new WeakMap();

function stageCounts(declarations, stage, states) {
  return Object.fromEntries(states.map(status => [status, declarations.filter(row =>
    row.stages[stage].status === status).length]));
}

function capabilityRecovery(declarations) {
  const affected = declarations.filter(row =>
    row.stages.system_capability.status === 'unavailable');
  const ownerCodes = [...new Set(affected.flatMap(row =>
    row.stages.system_capability.diagnostic_codes))].sort();
  const grouped = new Map();
  for (const row of affected) for (const blocker of
    row.stages.system_capability.blockers ?? []) {
    const key = JSON.stringify({ selected_route: blocker.selected_route,
      unavailable_operation: blocker.unavailable_operation === null ? null : {
        kind: blocker.unavailable_operation.kind,
        id: blocker.unavailable_operation.id,
        identity: blocker.unavailable_operation.identity,
        state: blocker.unavailable_operation.state
      },
      responsible_owner: blocker.responsible_owner,
      owner_code: blocker.owner_code });
    const current = grouped.get(key) ?? {
      selected_route: blocker.selected_route,
      unavailable_operation: blocker.unavailable_operation === null ? null : {
        kind: blocker.unavailable_operation.kind,
        id: blocker.unavailable_operation.id,
        identity: blocker.unavailable_operation.identity,
        state: blocker.unavailable_operation.state
      },
      responsible_owner: blocker.responsible_owner,
      recovery_status: blocker.recovery?.status ?? 'unavailable',
      supported_next_call: blocker.recovery?.supported_next_call ?? null,
      affected_obligation_ids: [], owner_codes: [] };
    current.affected_obligation_ids.push(row.obligation_id);
    const ownerCode = blocker.owner_code;
    if (ownerCode !== undefined) current.owner_codes.push(ownerCode);
    grouped.set(key, current);
  }
  const blockers = [...grouped.values()].map(blocker => Object.freeze({
    ...blocker,
    affected_obligation_ids: Object.freeze([...new Set(
      blocker.affected_obligation_ids)].sort()),
    affected_obligation_count: new Set(blocker.affected_obligation_ids).size,
    owner_codes: Object.freeze([...new Set(blocker.owner_codes)].sort()),
    why_required: `The exact ${blocker.selected_route} route requires this operation for the affected obligations.`
  })).sort((left, right) => JSON.stringify(left.unavailable_operation)
    .localeCompare(JSON.stringify(right.unavailable_operation)));
  const owners = [...new Set(blockers.map(blocker =>
    blocker.responsible_owner).filter(Boolean))].sort();
  const operations = blockers.map(blocker => blocker.unavailable_operation)
    .filter(Boolean);
  const supportedCalls = [...new Map(blockers.map(blocker =>
    blocker.supported_next_call).filter(Boolean).map(call =>
    [JSON.stringify(call), call])).values()];
  const fullySupported = blockers.length > 0 && blockers.every(blocker =>
    blocker.supported_next_call !== null) && supportedCalls.length === 1;
  return Object.freeze({
    schema_version: 'controlled-acceptance-capability-recovery.v1',
    stage: 'system_capability',
    reason_code: 'controlled_acceptance_system_capability_unavailable',
    responsible_owner: owners.length === 1 ? owners[0] : 'multiple_system_owners',
    affected_obligation_count: affected.length,
    affected_obligation_ids: Object.freeze(affected.map(row => row.obligation_id)),
    owner_codes: Object.freeze(ownerCodes),
    unavailable_operations: Object.freeze(operations),
    explanation: operations.length === 0
      ? 'The selected route has an unresolved system-capability assessment; no supported author-input repair is established.'
      : `The selected routes require ${operations.length} unavailable system operation${operations.length === 1 ? '' : 's'}; valid author inputs cannot supply them.`,
    recovery_status: fullySupported ? 'supported' : 'unavailable',
    supported_next_call: fullySupported ? supportedCalls[0] : null,
    operator_action: null,
    blockers: Object.freeze(blockers)
  });
}

function ordinaryAuthoringReadiness({ obligationCoverage, contract, wkId, focus,
  selectedUnit = null }) {
  const requirements = projectControlledContractRequirements(contract.content);
  const rows = obligationCoverage.source?.content?.obligations ?? [];
  const resolutionRows = new Map((obligationCoverage.resolution?.rows ?? []).map(
    row => [row.obligation_id, row]));
  const cases = obligationCoverage.source?.content?.cases ?? [];
  const declarations = [];
  const stageAssessments = [];
  for (const row of rows) {
    const resolution = resolutionRows.get(row.obligation_id) ?? null;
    const assessment = resolution?.selected_proof_assessment ?? null;

    const authoringCodes = Object.freeze([...(resolution?.authoring_diagnostic_codes ?? [])]);
    const authoringStatus = resolution?.authoring_status ?? 'incomplete';
    const routeStages = assessment?.stages ?? null;
    const stages = {
      authored_inputs: { status: authoringStatus, diagnostic_codes: authoringCodes,
        nonblocking_diagnostic_codes: routeStages?.authored_inputs.nonblocking_diagnostic_codes ?? [],
        unresolved_diagnostic_codes: routeStages?.authored_inputs.unresolved_diagnostic_codes ?? [] },
      canonical_sources: routeStages?.canonical_sources ?? { status: 'unresolved', diagnostic_codes: [],
        nonblocking_diagnostic_codes: [], unresolved_diagnostic_codes: [] },
      system_capability: routeStages?.system_capability ?? { status: 'unavailable', diagnostic_codes: [],
        nonblocking_diagnostic_codes: [], unresolved_diagnostic_codes: [], blockers: [] },
      execution_evidence: routeStages?.execution_evidence ?? { status: 'not_started',
        required_observations: [] }
    };
    stageAssessments.push({ obligation_id: row.obligation_id,
      execution_family: assessment?.execution_family ?? 'unresolved', stages });
    const testApplicable = assessment?.requirements.native_test_binding === 'required';
    const routeCodes = routeStages === null ? [] : [
      ...routeStages.authored_inputs.diagnostic_codes,
      ...routeStages.authored_inputs.nonblocking_diagnostic_codes,
      ...routeStages.authored_inputs.unresolved_diagnostic_codes,
      ...routeStages.canonical_sources.diagnostic_codes,
      ...routeStages.canonical_sources.nonblocking_diagnostic_codes,
      ...routeStages.canonical_sources.unresolved_diagnostic_codes,
      ...routeStages.system_capability.diagnostic_codes,
      ...routeStages.system_capability.nonblocking_diagnostic_codes,
      ...routeStages.system_capability.unresolved_diagnostic_codes];
    const reportedCodes = new Set([...authoringCodes, ...routeCodes,
      ...(assessment?.unresolved_diagnostic_codes ?? [])]);

    const executionFacts = typeof row.selection?.proof_name !== 'string' ? []
      : [...new Set((resolution?.diagnostics ?? [])
        .map(entry => entry.code).filter(code => !reportedCodes.has(code)))].sort();
    declarations.push(Object.freeze({
      obligation_id: row.obligation_id,
      case_id: row.case_id ?? null,
      case_present: testApplicable
        ? assessment.authored_case.status === 'complete' : null,
      binding_count: testApplicable
        ? assessment.native_test_binding.binding_count : null,
      binding_status: assessment?.native_test_binding.status ?? 'unresolved',
      ...(assessment?.native_test_binding.problem?.owner_code === undefined ? {} : {
        binding_problem: assessment.native_test_binding.problem.owner_code }),
      target_status: assessment?.declared_test_target.status ?? 'unresolved',
      input_status: resolution?.input_status ?? 'invalid',
      status: resolution === null ? 'incomplete'
        : resolution.status === 'valid' ? 'complete' : 'incomplete',
      selected_route: assessment?.execution_family ?? 'unresolved',

      blocking_diagnostic_codes: Object.freeze([...new Set([
        ...(routeStages?.authored_inputs.diagnostic_codes ?? []),
        ...(routeStages?.canonical_sources.diagnostic_codes ?? []),
        ...(routeStages?.system_capability.status === 'unavailable'
          ? routeStages.system_capability.diagnostic_codes : [])
      ])].sort()),
      nonblocking_diagnostic_codes: Object.freeze([...new Set([
        ...(stages.authored_inputs.nonblocking_diagnostic_codes ?? []),
        ...(stages.canonical_sources.nonblocking_diagnostic_codes ?? []),
        ...(stages.system_capability.nonblocking_diagnostic_codes ?? [])
      ])].sort()),
      unresolved_diagnostic_codes: Object.freeze(
        assessment?.unresolved_diagnostic_codes ?? []),

      ...(executionFacts.length === 0 ? {} : {
        reported_execution_diagnostic_codes: Object.freeze(executionFacts) })
    }));
  }
  const complete = requirements.requirements.length > 0 && rows.length > 0 &&
    declarations.every(row => row.status === 'complete');
  const authoringIncomplete = requirements.requirements.length === 0 || rows.length === 0 ||
    stageAssessments.some(row =>
    row.stages.authored_inputs.status !== 'complete');
  const canonicalIncomplete = stageAssessments.some(row =>
    row.stages.canonical_sources.status !== 'current');

  const addressed = coverageUnitArguments({ wkId, focus: focus ?? null, selectedUnit });
  const recovery = complete ? null : authoringIncomplete ? Object.freeze({
    tool: 'workspace_controlled_contract_obligation_coverage_query',
    arguments: addressed,
    follow_up_tool: 'workspace_controlled_contract_obligation_coverage_upsert'
  }) : canonicalIncomplete ? Object.freeze({
    tool: 'workspace_validate_proof',
    arguments: addressed
  }) : capabilityRecovery(stageAssessments);
  return Object.freeze({
    schema_version: 'proof-authoring-ordinary-readiness.v2',
    status: complete ? 'complete' : 'incomplete',
    obligation_count: rows.length,
    case_count: cases.length,
    complete_binding_count: declarations.filter(
      row => row.binding_status === 'complete').length,
    stage_counts: Object.freeze({
      authored_inputs: Object.freeze(stageCounts(stageAssessments, 'authored_inputs',
        ['complete', 'incomplete'])),
      canonical_sources: Object.freeze(stageCounts(stageAssessments, 'canonical_sources',
        ['current', 'unresolved'])),
      system_capability: Object.freeze(stageCounts(stageAssessments, 'system_capability',
        ['available', 'unavailable'])),
      execution_evidence: Object.freeze(stageCounts(stageAssessments, 'execution_evidence',
        ['not_started']))
    }),
    recovery,
    definition_readiness: definitionReadiness({ obligationCoverage,
      declarations, stageAssessments, recovery, authoringIncomplete }),
    declarations: Object.freeze(declarations)
  });
}

const UNRESOLVED_OBLIGATION_LIMIT = 8;

function definitionReadiness({ obligationCoverage, declarations,
  stageAssessments, recovery, authoringIncomplete }) {

  const incompleteAuthoredInputs = new Map();
  for (const row of stageAssessments) {
    if (row.stages.authored_inputs.status === 'complete') continue;
    incompleteAuthoredInputs.set(row.obligation_id, [...new Set([
      ...(incompleteAuthoredInputs.get(row.obligation_id) ?? []),
      ...row.stages.authored_inputs.diagnostic_codes])].sort());
  }
  const unresolved = [...incompleteAuthoredInputs.keys()].sort();
  const digest = obligationCoverage.source?.content_digest ?? null;
  return Object.freeze({
    schema_version: 'controlled-acceptance-definition-readiness.v1',
    complete: declarations.filter(row => row.status === 'complete').length,
    incomplete: declarations.filter(row => row.status !== 'complete').length,

    unresolved_obligation_count: unresolved.length,
    unresolved_obligations: Object.freeze(unresolved.slice(0, UNRESOLVED_OBLIGATION_LIMIT)
      .map(id => Object.freeze({ obligation_id: id,
        authored_input_diagnostic_codes: Object.freeze(incompleteAuthoredInputs.get(id)) }))),
    unresolved_obligations_omitted: Math.max(0,
      unresolved.length - UNRESOLVED_OBLIGATION_LIMIT),
    execution: Object.freeze({
      status: 'not_started',
      owner: 'workspace_verify_proof',

      required_before_authoring: false,
      creates_definitions: false,
      explanation: 'Execution evidence is produced by workspace_verify_proof after the declared tests exist. It is not the absent authoring input, and no verification call creates a proof definition.'
    }),

    correction: recovery === null || authoringIncomplete !== true ? null
      : Object.freeze({
        read_tool: recovery.tool,
        write_tool: recovery.follow_up_tool,
        arguments: Object.freeze({ ...recovery.arguments }),
        expected_content_digest_from: 'read_tool_response.content_digest',
        observed_source_content_digest: digest,
        authored_by: 'caller',
        effect: 'author_the_missing_verification_meaning'
      })
  });
}
function identity(facts, acceptance) {
  return controlledContractContentDigest({ record: facts.record,
    source: facts.source?.content_digest ?? null,
    contract: facts.contract.content_digest,
    generation: facts.canonicalSet.generation,
    manifest: facts.canonicalSet.manifest_content_digest,
    context: facts.resolution?.context_digest ?? null,
    definitions: facts.resolution?.definition_identities ?? [],
    acceptance: acceptance?.carrier?.content_digest ?? null });
}
export async function resolveProofAuthoringReadinessInputs(input, canonicalSet) {
  const contract = await readControlledContractCarrierFile({ ...input,
    carrierKind: 'contract', canonicalSet });
  const obligationCoverage = await resolveObligationCoverageFacts(input, {
    canonicalOverride: { canonicalSet, contract }, allowIncomplete: true,
    savedApplications: true });
  const acceptanceCoverage = await resolveAcceptanceCoverageFacts(input, {
    canonicalOverride: { canonicalSet, contract, obligationSource: obligationCoverage.source },
    savedApplications: true, obligationFacts: obligationCoverage });
  const resolution = obligationCoverage.resolution;
  const pkg = await loadControlledContractPackage();
  const proofAuthoringDiagnostics = resolution === null ? null
    : projectProofAuthoringDiagnosticGroups({
      grouped: pkg.groupProofAuthoringDiagnostics(resolution),
      resultIdentity: resolution.identity_digest,
      wkId: input.wkId,
      focus: input.focus ?? null,
      selectedUnit: input.selectedUnit ?? null
    });
  const derivedContract = obligationCoverage.contract;
  const completeness = proofAuthoringCompletenessSummary(obligationCoverage);
  const ordinaryReadiness = ordinaryAuthoringReadiness({
    obligationCoverage,
    contract: derivedContract,
    wkId: input.wkId,
    focus: input.focus ?? null,
    selectedUnit: input.selectedUnit ?? null
  });

  const source = { work_record_id: input.wkId,
    selected_unit: input.selectedUnit ?? null, focus: input.focus ?? null,
    generation_id: typeof canonicalSet.generation === 'string' ? canonicalSet.generation
      : canonicalSet.generation?.id ?? null,
    manifest_digest: canonicalSet.manifest_content_digest ?? null,
    controlled_contract_digest: contract.content_digest,
    saved_application_digest: obligationCoverage.source?.content_digest ?? null };
  const facts = {
    authoringState: { schema_version: 'controlled-contract-authoring-state.v1',
      stage: ordinaryReadiness.stage_counts.authored_inputs.incomplete === 0
        ? 'complete' : 'proof_authoring_required',
      selected_resources: { contract: { content_digest: contract.content_digest } },
      saved_applications: completeness,
      unresolved_decisions: ordinaryReadiness.status === 'complete' ? null : {

        reason_code: ordinaryReadiness.recovery?.reason_code ??
          (resolution === null ? 'obligation_coverage_source_not_found'
            : ordinaryReadiness.stage_counts.authored_inputs.incomplete > 0
              ? 'controlled_acceptance_authored_inputs_incomplete'
              : 'obligation_coverage_resolution_required'),
        stage: ordinaryReadiness.recovery?.stage ?? 'authored_inputs' },
      next_calls: typeof ordinaryReadiness.recovery?.tool === 'string'
        ? [ordinaryReadiness.recovery] : [] },

    contractAssessment: { source, source_current: true,
      saved_application_resolution: resolution,
      saved_applications: completeness,
      state: resolution === null ? 'obligation_coverage_source_not_found'
        : resolution.status !== 'valid' ? 'obligation_coverage_resolution_required'
          : 'obligation_coverage_resolved',
      total_count: resolution?.total ?? 0, omitted_count: 0 },
    obligationCoverage, acceptanceCoverage, proofAuthoringDiagnostics,
    testProofBindings: structuredClone(derivedContract.content.test_proofs ?? []),
    runtimeProofEligibility: classifyControlledContractRuntimeEligibility(
      derivedContract.content, obligationCoverage
    ),
    ordinaryAuthoringReadiness: ordinaryReadiness,
    testProofSource: { wk_id: input.wkId, selected_unit: input.selectedUnit ?? null,
      focus: input.focus ?? null,
      carrier_kind: 'contract', content_digest: contract.content_digest }
  };
  identities.set(facts, { input, digest: identity(obligationCoverage, acceptanceCoverage),
    ordinaryReadiness: facts.ordinaryAuthoringReadiness,
    proofAuthoringDiagnostics: facts.proofAuthoringDiagnostics });
  return facts;
}
export function bindProofAuthoringReadinessInputs(ownerInput, savedFacts) {
  identities.set(ownerInput, identities.get(savedFacts));
}
export function projectBoundProofAuthoringOrdinaryReadiness(ownerInput) {
  return identities.get(ownerInput)?.ordinaryReadiness ??
    ownerInput?.ordinaryAuthoringReadiness ?? null;
}
export function projectBoundProofAuthoringDiagnostics(ownerInput) {
  return identities.get(ownerInput)?.proofAuthoringDiagnostics ??
    ownerInput?.proofAuthoringDiagnostics ?? null;
}
export async function assertProofAuthoringReadinessCurrent(ownerInput) {
  const bound = identities.get(ownerInput);
  if (bound === undefined) return;
  const canonicalSet = await resolveCanonicalControlledContractCarrierSet(bound.input);
  const current = await resolveProofAuthoringReadinessInputs(bound.input, canonicalSet);
  const actual = identity(current.obligationCoverage, current.acceptanceCoverage);
  if (actual !== bound.digest) throw new ControlledContractToolError(
    'controlled_acceptance_source_not_current', 'Saved readiness inputs changed during classification',
    { changed: false, responsible_owner: 'resolveProofAuthoringReadinessInputs',
      expected_content_digest: bound.digest, actual_content_digest: actual });
}
