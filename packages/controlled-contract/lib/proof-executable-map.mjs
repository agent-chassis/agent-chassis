

import { CASE_COMPONENT_FIELD, CASE_VERIFICATION_ASSOCIATION_FIELD,
  linkedNativeTestProofs } from './native-test-proof-authoring.mjs';
import { resolveStableTestProofProviderBindings } from './test-proof-contract-v1.mjs';

import { loadPackParameterContract, describePackParameters, inspectParameterSource,
  deriveParameterRole, validateParameterDependencies } from './pack-parameters.mjs';
import { loadExactAdmittedProofPackMeaning } from './admitted-proof-packs.mjs';
import { canonicalDigest, deepFreeze } from './deterministic-projection-primitives.mjs';
import { loadPinnedProofSelection } from './proof-authoring-selection.mjs';

import {
  assertProofAuthoringDraft,
  assessProofAuthoringRowSemantics,
  AUTHORED_BINDING_OWNER_CODES,
  OBLIGATION_COVERAGE_UPSERT_TOOL as UPSERT_TOOL,
  PROOF_PREREQUISITE_CODES,
  proofDiagnostic as diagnostic,
  registeredRecoveryTemplate,
  proofOwnerDiagnostic as ownerDiagnostic,
  proofProblem as problem,
  ProofAuthoringError,
  raiseErrorCode,
  selectProofAuthoringRows
} from './proof-contract.mjs';
import { buildProofAuthoringSkeleton } from './proof-authoring-skeleton.mjs';

const implementedConstructors = Object.freeze({
  '@agent-chassis/controlled-contract#buildProofAuthoringSkeleton': buildProofAuthoringSkeleton
});
const identity = pack => `${pack.profile.profile_id}@${pack.profile.profile_version}`;
const pin = pack => ({ proof_name: pack.profile.profile_id, proof_version: pack.profile.profile_version,
  profile_digest: pack.profile_digest, parameter_contract_digest: pack.parameter_contract_digest,
  admission_digest: pack.admission_digest });

const PROVIDER_BOUND_TEST_VALIDITY = 'provider_bound_test_validity.v1';
const NONBLOCKING_TEST_ROUTE_CAUSES = new Set([
  'construction_capability_unavailable',
  'dependency_recipe_unavailable'
]);
const CATEGORY_STAGE = Object.freeze({ author_input: 'authored_inputs',
  canonical_source: 'canonical_sources', system_capability: 'system_capability' });

const BINDING_DERIVED_SOURCES = Object.freeze({
  typed_referent: Object.freeze({ binding_field: 'system_under_test_boundary.subject_reference_ids',
    authored_case_field: 'component' }),
  test_assertion_selector: Object.freeze({ binding_field: 'test_selector',
    authored_case_field: 'target' })
});

function requirementsForPack(pack) {
  const testExecutionRequired =
    pack.profile.stable_capabilities?.test_validity === PROVIDER_BOUND_TEST_VALIDITY;
  return {
    execution_family: testExecutionRequired
      ? 'provider_bound_test_validity' : 'definition_evaluation',
    requirements: {
      authored_case: testExecutionRequired ? 'required' : 'not_applicable',
      native_test_binding: testExecutionRequired ? 'required' : 'not_applicable',
      declared_test_target: testExecutionRequired ? 'required' : 'not_applicable',
      test_execution_evidence: testExecutionRequired ? 'required' : 'not_applicable'
    }
  };
}

export async function resolveSelectedProofRequirements(selection, owners = {}) {
  const pack = await loadPinnedProofSelection(selection, {
    loadExact: owners.loadExact ?? loadExactAdmittedProofPackMeaning
  });
  return deepFreeze({ definition: pin(pack), ...requirementsForPack(pack) });
}

function selectedProofPrerequisites({ pack, contract, row, context }) {
  const selectedRequirements = requirementsForPack(pack);
  const testExecutionRequired =
    selectedRequirements.requirements.native_test_binding === 'required';
  const casePresent = typeof row.case_id === 'string' &&
    (context.case_definitions ?? []).some(entry => entry.case_id === row.case_id);
  const bindings = testExecutionRequired ? linkedNativeTestProofs({
    relations: context.contract_relations ?? [], test_proofs: context.test_declarations ?? []
  }, row) : [];
  let bindingStatus = testExecutionRequired ? 'missing' : 'not_applicable';
  let bindingProblem = null;
  if (testExecutionRequired && bindings.length === 1) {
    try {
      resolveStableTestProofProviderBindings(bindings[0]);
      bindingStatus = 'complete';
    } catch (error) {
      bindingStatus = 'invalid';
      bindingProblem = { owner: '@agent-chassis/controlled-contract',
        owner_code: error?.code ?? 'stable_test_proof_binding_invalid',
        owner_details: error?.details ?? null };
    }
  } else if (testExecutionRequired && bindings.length > 1) bindingStatus = 'ambiguous';
  const verificationId = bindings.length === 1 ? bindings[0].verification_claim_id : null;
  const targetProjection = context.test_target_declarations;

  const targetCount = verificationId === null ? 0 :
    (targetProjection?.executable_declarations ?? []).reduce((count, declaration) =>
      count + declaration.verification_ids.filter(id => id === verificationId).length, 0) +
    (context.native_case_targets ?? []).filter(target => target.verification_id === verificationId).length;
  const targetStatus = !testExecutionRequired ? 'not_applicable'
    : targetProjection?.status === 'invalid' ? 'invalid'
      : verificationId === null || targetCount === 0 ? 'missing'
        : targetCount === 1 ? 'complete' : 'ambiguous';
  return {
    schema_version: 'selected-proof-prerequisite-assessment.v1',
    definition: pin(pack), execution_family: selectedRequirements.execution_family,
    semantic_inputs: structuredClone(contract.construction.semantic_inputs),
    canonical_inputs: structuredClone(contract.construction.canonical_inputs),
    required_observations: structuredClone(contract.construction.required_observations),
    requirements: selectedRequirements.requirements,
    authored_case: { status: !testExecutionRequired ? 'not_applicable'
      : casePresent ? 'complete' : 'missing', case_id: row.case_id ?? null },
    native_test_binding: { status: bindingStatus, binding_count: bindings.length,
      verification_id: verificationId, test_proof_id: bindings.length === 1
        ? bindings[0].test_proof_id : null, problem: bindingProblem },
    declared_test_target: { status: targetStatus, binding_count: targetCount,
      verification_id: verificationId },
    capability_contract: {
      construction: structuredClone(contract.capabilities.find(capability =>
        capability.id === contract.construction.capability) ?? null),
      dependencies: structuredClone(contract.dependencies)
    }
  };
}

function declaredTargetOwnerProblem(status, context) {
  if (status !== 'invalid') return null;
  const [first] = context.test_target_declarations?.diagnostics ?? [];

  const { code, recovery: _unusedRecovery, ...details } = first ?? {};
  return { owner_code: code ?? 'declared_test_target_projection_invalid',
    owner_details: Object.keys(details).length === 0 ? null : structuredClone(details) };
}

function nativeBindingCondition(binding) {
  if (binding.status !== 'invalid') return binding.status;
  return AUTHORED_BINDING_OWNER_CODES.includes(binding.problem?.owner_code)
    ? 'case_incomplete' : 'provider_unresolved';
}

function declaredTargetCondition(target) {
  if (target.status !== 'missing') return target.status;
  return target.verification_id === null ? 'verification_unresolved' : 'undeclared';
}

function selectedProofPrerequisiteDiagnostics(prerequisites, path, context = {}) {
  if (prerequisites.requirements.native_test_binding !== 'required') return [];
  const result = [];
  const caseId = prerequisites.authored_case.case_id;
  if (prerequisites.authored_case.status !== 'complete') result.push(diagnostic(
    'obligation_coverage_authored_case_missing', `${path}/case_id`,
    'The selected test-validity route requires one saved authored case', {
      case_id: caseId },
    problem('author_input', 'selected_route_prerequisite', {
      prerequisite: 'authored_case', status: prerequisites.authored_case.status })));

  const binding = prerequisites.native_test_binding;
  if (binding.status !== 'complete') result.push(raiseErrorCode(PROOF_PREREQUISITE_CODES,
    { family: 'native_test_binding', condition: nativeBindingCondition(binding) }, {
      path: `${path}/case_id`,
      facts: { verification_id: binding.verification_id,
        binding_count: binding.binding_count, case_id: caseId,
        prerequisite: 'native_test_binding', status: binding.status,
        owner_code: binding.problem?.owner_code ?? null,
        owner_details: binding.problem?.owner_details ?? null } }));
  const target = prerequisites.declared_test_target;
  if (target.status !== 'complete') {
    const owner = declaredTargetOwnerProblem(target.status, context);
    result.push(raiseErrorCode(PROOF_PREREQUISITE_CODES,
      { family: 'declared_test_target', condition: declaredTargetCondition(target) }, {
        path: `${path}/case_id`,
        facts: { verification_id: target.verification_id,
          binding_count: target.binding_count, case_id: caseId,
          prerequisite: 'declared_test_target', status: target.status,
          owner_code: owner?.owner_code ?? null,
          owner_details: owner?.owner_details ?? null } }));
  }
  return result;
}

function unavailableOperation(diagnostic) {
  const cause = diagnostic.problem?.cause ?? {};
  if (cause.kind === 'construction_capability_unavailable') {
    const capability = cause.capability ?? diagnostic.capability ?? {};
    return { kind: capability.kind ?? 'constructor', id: capability.id ?? 'construction',
      identity: capability.identity ?? null, state: capability.state ?? 'unavailable',
      description: capability.gap?.missing ?? diagnostic.reason };
  }
  if (cause.kind === 'dependency_recipe_unavailable') return {
    kind: 'dependency_recipe', id: 'dependencies', identity: null,
    state: 'unavailable', description: cause.gap?.missing ?? diagnostic.reason
  };
  if (cause.kind === 'reachable_dependency_unresolved') return {
    kind: 'reachable_dependency', id: 'dependencies', identity: null,
    state: 'unresolved', description: diagnostic.reason
  };
  if (cause.kind === 'dependency_contract_failure') return {
    kind: 'dependency_contract', id: cause.owner_code ?? diagnostic.code,
    identity: null, state: 'invalid', description: diagnostic.reason
  };
  return { kind: cause.kind ?? 'owner_operation', id: diagnostic.code,
    identity: cause.capability_identity ?? null, state: 'unavailable',
    description: diagnostic.reason };
}

function responsibleOwner(diagnostic, operation) {
  const cause = diagnostic.problem?.cause ?? {};
  return cause.capability?.gap?.owner ?? diagnostic.capability?.gap?.owner ??
    cause.gap?.owner ?? diagnostic.gap?.owner ?? diagnostic.owner ?? operation?.id ?? null;
}

function authoredPrerequisiteCorrection({ prerequisite, status, authored_case_field }) {
  if (prerequisite === 'authored_case') return `author the '${authored_case_field}' field of the case this obligation uses`;
  return status === 'ambiguous'
    ? 'link this obligation to exactly one authored case so it resolves one native test binding'
    : 'link this obligation to one authored case (its case_id and case definition)';
}

function escapeJsonPointerToken(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

export function typedBindingFailurePaths(diagnostic) {
  return [...new Set(typedBindingFailures(diagnostic).map(({ path }) => path))].sort();
}

function typedBindingFailures(diagnostic) {
  const diagnostics = diagnostic.problem?.cause?.owner_details?.diagnostics;
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics.flatMap(entry => {
    const base = typeof entry?.pointer === 'string' ? entry.pointer
      : typeof entry?.instancePath === 'string' ? entry.instancePath : null;
    if (base === null) return [];
    const property = entry?.keyword === 'required' &&
      typeof entry?.params?.missingProperty === 'string'
      ? entry.params.missingProperty
      : entry?.keyword === 'additionalProperties' &&
        typeof entry?.params?.additionalProperty === 'string'
        ? entry.params.additionalProperty : null;
    const suffix = property === null ? '' : `/${escapeJsonPointerToken(property)}`;
    const path = `${base === '/' ? '' : base}${suffix}`;
    return [{ keyword: entry?.keyword, path: path.length === 0 ? '/' : path }];
  });
}

const RUNTIME_MODULE_PATH = '/system_under_test_boundary/runtime_module_path';

export const OCCURRENCE_CORRECTION_CLAUSES = deepFreeze({
  component: { field: CASE_COMPONENT_FIELD, guidance: 'case_authoring.component' },
  association: { field: CASE_VERIFICATION_ASSOCIATION_FIELD,
    guidance: 'case_authoring.verification_association' },
  case_content: { field: 'obligations[].case', guidance: 'case_authoring' }
});

export function occurrenceRecoveryFacts(diagnostic) {
  if (diagnostic?.code !== 'obligation_coverage_native_binding_case_incomplete') return null;
  const failures = typedBindingFailures(diagnostic);
  const failedFields = [...new Map(failures.map(entry => [`${entry.path}\u0000${entry.keyword}`,
    { keyword: entry.keyword ?? null, path: entry.path }])).values()]
    .sort((left, right) => left.path.localeCompare(right.path) ||
      String(left.keyword).localeCompare(String(right.keyword)));
  const association = failures.some(({ path }) =>
    path === '/verification_claim_id' || path.endsWith('/proposition_id'));
  const moduleSource = failures.some(({ keyword, path }) =>
    keyword === 'required' && path === RUNTIME_MODULE_PATH);
  const corrections = failures.length === 0 ? [] : [
    ...(moduleSource ? ['component'] : []),
    ...(association ? ['association'] : []),
    ...(moduleSource || association ? [] : ['case_content'])];
  return deepFreeze({ failed_fields: failedFields, association_correction: association,
    module_source_correction: moduleSource, corrections });
}

export function occurrenceRecoverySummary(diagnostic, recovery, { failedFields = 'owner_diagnostics' } = {}) {
  const facts = occurrenceRecoveryFacts(diagnostic);
  if (facts === null) return recovery.summary;
  const published = failedFields === 'public';
  if (facts.failed_fields.length === 0) {
    return `Use the upsert's ${OCCURRENCE_CORRECTION_CLAUSES.case_content.guidance} guidance${published ? '' : ' and inspect the structured owner diagnostic details'}. No typed failed field path was published, so this refusal does not identify a verification-association repair. Never supply or edit the derived binding itself.`;
  }
  const count = new Set(facts.failed_fields.map(({ path }) => path)).size;
  const pathSummary = `Typed derived-binding validation reported ${count} failed field ${count === 1 ? 'path' : 'paths'}; ${published ? 'each subject\'s failed_fields lists them' : 'the complete paths remain in the structured owner diagnostics'}.`;
  const correction = facts.association_correction
    ? ` Use the upsert's ${OCCURRENCE_CORRECTION_CLAUSES.association.guidance} guidance when the failed proposition identities must be derived from an eligible test_execution verification.`
    : ` The typed failures do not identify the verification association as invalid; preserve valid requirement/verification links and use the upsert's ${OCCURRENCE_CORRECTION_CLAUSES.case_content.guidance} guidance to supply the omitted case meaning.`;
  const componentCorrection = facts.module_source_correction
    ? ` The derived binding has no runtime module path, which is derived only from the resolved ${OCCURRENCE_CORRECTION_CLAUSES.component.field} when its identity is a repository_path (by value, or through the saved reference a reference_id selects); a profile_term or other descriptive identity names no module source, even when it mentions a file. Author that component with the actual repository and path under the upsert's ${OCCURRENCE_CORRECTION_CLAUSES.component.guidance} guidance.`
    : '';
  return `${pathSummary}${correction}${componentCorrection} Never supply or edit the derived binding itself.`;
}

export function occurrencePublicRecovery(diagnostic) {
  const recovery = diagnostic?.problem?.route_assessment?.recovery ?? null;
  if (recovery === null) return null;
  const registered = Object.hasOwn(diagnostic.problem?.cause ?? {}, 'actor_recovery')
    ? registeredRecoveryTemplate(PROOF_PREREQUISITE_CODES, diagnostic.code) : null;
  const instructions = registered === null ? recovery.operator_action ?? null
    : `${occurrenceRecoverySummary(diagnostic, registered, { failedFields: 'public' })} Supported next call: ${registered.route}.`;
  return deepFreeze({ explanation: recovery.explanation ?? null, instructions });
}

function registeredRecoveryProjection(diagnostic, operation) {
  const cause = diagnostic.problem?.cause ?? {};
  if (!Object.hasOwn(cause, 'actor_recovery')) return null;
  const recovery = registeredRecoveryTemplate(PROOF_PREREQUISITE_CODES, diagnostic.code);

  if (recovery === null) return {
    status: 'unavailable', supported_next_call: null, operator_action: null,
    explanation: `No authoring route clears ${diagnostic.code}: ${operation === null ? diagnostic.reason : `${operation.kind} '${operation.id}' is ${operation.state}`}${cause.owner_code === null ? '' : ` (${cause.owner_code})`}, which is recovered by the ${cause.actor_recovery} actor.`
  };
  return {
    status: 'operator_action',
    supported_next_call: { tool: recovery.route ?? null, kind: recovery.kind,
      arguments: Object.fromEntries(Object.entries(recovery.argument_bindings ?? {})
        .map(([argument, fact]) => [argument, cause[fact] ?? null])) },
    operator_action: `${occurrenceRecoverySummary(diagnostic, recovery)} Supported next call: ${recovery.route}.`,
    explanation: `${recovery.prerequisite === undefined ? '' : `This refusal states that ${recovery.prerequisite}. `}Success condition: ${recovery.success_condition}`
  };
}

function recoveryForDiagnostic({ diagnostic, effect, stage, operation, owner }) {
  if (effect === 'nonblocking') return {
    status: 'not_required', supported_next_call: null, operator_action: null,
    explanation: 'This retained owner limitation is not required by the selected route and does not need recovery for that route to proceed.'
  };
  const registered = registeredRecoveryProjection(diagnostic, operation);
  if (registered !== null) return registered;
  const prerequisite = diagnostic.problem?.cause?.authored_prerequisite;
  if (stage === 'authored_inputs' && prerequisite !== undefined) return {
    status: 'operator_action', supported_next_call: null,
    operator_action: `Query the current saved selection, then through ${UPSERT_TOOL} with its returned content digest ${authoredPrerequisiteCorrection(prerequisite)}. The native test binding and this parameter are derived from that case; never edit the binding or supply the parameter directly.`,
    explanation: `This parameter is unavailable only because its authored prerequisite ${prerequisite.prerequisite} is ${prerequisite.status}; validation cannot invent the authored case content.`
  };
  if (stage === 'authored_inputs') return {
    status: 'operator_action', supported_next_call: null,
    operator_action: 'Query the current saved selection, then amend the affected obligations through workspace_controlled_contract_obligation_coverage_upsert with its returned content digest.',
    explanation: `The required correction depends on operator-authored meaning identified by ${diagnostic.code}; validation cannot invent the replacement value.`
  };
  const operationLabel = operation === null ? diagnostic.code
    : `${operation.kind} '${operation.id}'`;
  return { status: 'unavailable', supported_next_call: null,
    operator_action: null,
    explanation: `No supported recovery is declared by ${owner ?? diagnostic.owner ?? 'the responsible owner'} for ${operationLabel}; changing valid proof-authoring inputs cannot repair canonical sources or system capabilities.`
  };
}

function assessDiagnostic(diagnostic, prerequisites) {
  const category = diagnostic.problem?.category ?? 'unclassified';
  const causeKind = diagnostic.problem?.cause?.kind ?? 'owner_diagnostic';
  const selectedRoute = prerequisites.execution_family;

  const nonblocking = category === 'system_capability' &&
    selectedRoute === 'provider_bound_test_validity' &&
    NONBLOCKING_TEST_ROUTE_CAUSES.has(causeKind);
  const effect = nonblocking ? 'nonblocking'
    : Object.hasOwn(CATEGORY_STAGE, category) ? 'blocking' : 'unresolved';
  const stage = CATEGORY_STAGE[category] ?? 'unclassified';
  const operation = category === 'system_capability'
    ? unavailableOperation(diagnostic) : null;
  const owner = responsibleOwner(diagnostic, operation);
  const reason = nonblocking
    ? `The exact ${selectedRoute} route executes through its authored case, native test binding and declared target, not this generic recipe; ${operation.description} is retained context but is not a prerequisite of that route.`
    : effect === 'unresolved'
      ? 'The diagnostic owner did not establish whether this occurrence applies to the selected route, so the route cannot proceed.'
      : category === 'system_capability'
        ? `The exact ${selectedRoute} route requires ${operation.kind} '${operation.id}': ${operation.description}`
        : `${diagnostic.reason} This ${stage} prerequisite prevents the exact ${selectedRoute} route from proceeding.`;
  return { schema_version: 'selected-proof-diagnostic-route-assessment.v1',
    effect, stage, selected_route: selectedRoute, owner_code: diagnostic.code, reason,
    unavailable_operation: operation, responsible_owner: owner,
    recovery: recoveryForDiagnostic({ diagnostic, effect, stage, operation,
      owner }) };
}

function assessedDiagnostic(diagnostic, prerequisites) {
  return { ...diagnostic, problem: { ...diagnostic.problem,
    route_assessment: assessDiagnostic(diagnostic, prerequisites) } };
}

export const diagnosticCodes = entries => [...new Set(entries.map(entry => entry.code))].sort();

function completeSelectedProofAssessment({ prerequisites, diagnostics,
  inputStatus }) {
  const testRequired = prerequisites.requirements.native_test_binding === 'required';
  const testInputsComplete = !testRequired ||
    prerequisites.authored_case.status === 'complete' &&
    prerequisites.native_test_binding.status === 'complete' &&
    prerequisites.declared_test_target.status === 'complete';
  const assessedDiagnostics = diagnostics.map(diagnostic =>
    assessedDiagnostic(diagnostic, prerequisites));
  const byStage = stage => assessedDiagnostics.filter(entry =>
    entry.problem.route_assessment.stage === stage);
  const byEffect = (entries, effect) => entries.filter(entry =>
    entry.problem.route_assessment.effect === effect);
  const blocking = entries => entries.filter(entry =>
    entry.problem.route_assessment.effect !== 'nonblocking');
  const authorDiagnostics = byStage('authored_inputs');
  const sourceDiagnostics = byStage('canonical_sources');
  const capabilityDiagnostics = byStage('system_capability');
  const unresolvedDiagnostics = byStage('unclassified');
  const authoringStatus = inputStatus === 'valid' &&
    blocking(authorDiagnostics).length === 0 && testInputsComplete
    ? 'complete' : 'incomplete';
  const sourceStatus = blocking(sourceDiagnostics).length === 0
    ? 'current' : 'unresolved';
  const capabilityStatus = blocking(capabilityDiagnostics).length === 0
    ? 'available' : 'unavailable';
  const readinessStatus = authoringStatus === 'complete' &&
    sourceStatus === 'current' && capabilityStatus === 'available' &&
    unresolvedDiagnostics.length === 0 ? 'complete' : 'incomplete';
  const stage = (entries, status) => ({ status,
    diagnostic_codes: diagnosticCodes(byEffect(entries, 'blocking')),
    blocking_diagnostic_codes: diagnosticCodes(byEffect(entries, 'blocking')),
    nonblocking_diagnostic_codes: diagnosticCodes(byEffect(entries, 'nonblocking')),
    unresolved_diagnostic_codes: diagnosticCodes(byEffect(entries, 'unresolved')) });
  return deepFreeze({
    diagnostics: assessedDiagnostics,
    assessment: { ...prerequisites,
      assessment_status: unresolvedDiagnostics.length === 0 ? 'resolved' : 'unresolved',
      unresolved_diagnostic_codes: diagnosticCodes(unresolvedDiagnostics),
      stages: {
        authored_inputs: stage(authorDiagnostics, authoringStatus),
        canonical_sources: stage(sourceDiagnostics, sourceStatus),
        system_capability: { ...stage(capabilityDiagnostics, capabilityStatus),
          satisfied_by: testRequired && testInputsComplete
            ? 'native_provider_bound_test_binding' : null,
          blockers: blocking(capabilityDiagnostics).map(entry =>
            entry.problem.route_assessment) },
        execution_evidence: { status: 'not_started', credit_granted: 0,
          required_observations: structuredClone(prerequisites.required_observations) }
      },
      prevents_selected_route: readinessStatus !== 'complete',
      readiness_status: readinessStatus }
  });
}

export async function resolveProofExecutableMap(source, context = {}, owners = {}) {
  const draft = assertProofAuthoringDraft(source);
  const parameterOnly = context.assessment_intent === 'known_parameters';
  const loadExact = owners.loadExact ?? loadExactAdmittedProofPackMeaning;
  const loadContract = owners.loadContract ?? loadPackParameterContract;
  const contracts = new Map(), definitions = new Map(), nodes = new Map();
  if (typeof context.source_digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(context.source_digest)) {
    throw new ProofAuthoringError('source_identity_missing', 'Resolution requires the canonical source owner content digest');
  }
  const sourceDigest = context.source_digest;
  const contextDigest = `sha256:${canonicalDigest(context)}`;
  const loadDefinition = async selection => {
    const pack = await loadPinnedProofSelection(selection, { loadExact });
    const key = identity(pack);
    if (!contracts.has(key)) {
      definitions.set(key, pack);
      contracts.set(key, loadContract(pack));
    }
    return pack;
  };
  async function dependencies(pack, visiting = new Set()) {
    const key = identity(pack);
    if (visiting.has(key)) return;
    visiting.add(key);
    const contract = contracts.get(key);
    if (contract.dependencies.state === 'complete') for (const dependency of contract.dependencies.packs) {
      const childKey = `${dependency.profile_id}@${dependency.profile_version}`;
      if (!contracts.has(childKey)) {
        const child = await loadExact({ profileId: dependency.profile_id, profileVersion: dependency.profile_version });
        definitions.set(childKey, child); contracts.set(childKey, loadContract(child));
        await dependencies(child, visiting);
      }
    }
    visiting.delete(key);
  }
  const { rowIndices, selected } = selectProofAuthoringRows(draft, context);
  const rows = [];
  for (const row of selected) {
    const path = `/obligations/${rowIndices.get(row.obligation_id)}`;

    const semanticDiagnostics = assessProofAuthoringRowSemantics(row, path, context);
    const diagnostics = [...semanticDiagnostics];
    let pack = null;
    try { pack = await loadDefinition(row.selection); await dependencies(pack); }
    catch (error) {

      if (!error?.code || !/^(obligation_coverage_|proof_pack_|pack_parameter_)/u.test(error.code)) throw error;
      diagnostics.push(ownerDiagnostic(error, `${path}/selection`));
    }
    let prerequisites = null;
    if (pack && !parameterOnly) {
      prerequisites = selectedProofPrerequisites({ pack,
        contract: contracts.get(identity(pack)), row, context });
      diagnostics.push(...selectedProofPrerequisiteDiagnostics(prerequisites, path, context));
    }
    rows.push({ row, path, pack, diagnostics, prerequisites, semanticDiagnostics });
  }
  let dependencyFailure = null;
  try { validateParameterDependencies([...contracts.values()]); }
  catch (error) {
    if (!error?.code?.startsWith('pack_parameter_')) throw error;
    dependencyFailure = ownerDiagnostic(error, '/dependencies', problem('system_capability',
      'dependency_contract_failure', { owner_code: error.code, details: error.details ?? null },
      { definitionSensitive: true }));
  }

  async function expand(pack, parameters, canonical, stack = new Set()) {
    const key = canonicalDigest({ definition: pin(pack), parameters, canonical });
    if (nodes.has(key)) return nodes.get(key);
    const contract = contracts.get(identity(pack));
    const detail = describePackParameters(contract), diagnostics = [];
    const effective = {}, roleBindings = {}, derived = {};
    const node = { identity: key, definition: pin(pack), effective_parameters: effective,
      derived_roles: derived, dependencies: [], diagnostics,
      input_status: 'valid', construction_status: 'unavailable', construction: null };
    nodes.set(key, node);
    for (const name of Object.keys(parameters)) if (!contract.parameters.some(p => p.name === name)) diagnostics.push(
      diagnostic('obligation_coverage_parameter_unknown', `/parameters/${name}`,
        'Parameter is not declared by this exact definition', {},
        problem('author_input', 'unknown_explicit_parameter', { parameter: name }, { definitionSensitive: true })));
    for (const slot of detail.parameters) {
      const source = inspectParameterSource(contract, slot.name, {
        ...(Object.hasOwn(parameters, slot.name) ? { explicit: parameters[slot.name] } : {}),
        ...(Object.hasOwn(canonical, slot.name) ? { canonical: canonical[slot.name] } : {}),
        ...(canonical.reference_facts?.[slot.name] ? { canonical_references: canonical.reference_facts[slot.name] } : {})
      });
      effective[slot.name] = source;
      if (source.status !== 'available') {

        const prerequisite = source.status === 'missing'
          ? canonical.authored_prerequisites?.[slot.name] : undefined;
        const category = source.status === 'canonical_conflict' || slot.source.policy === 'configurable' ||
          prerequisite !== undefined ? 'author_input'
          : slot.source.policy === 'derived' ? 'system_capability' : 'canonical_source';
        diagnostics.push(diagnostic(
        `obligation_coverage_parameter_${source.status}`, `/parameters/${slot.name}`,
        prerequisite === undefined ? source.reason ?? `The exact slot source is ${source.status}`
          : `Parameter ${slot.name} is derived from the native test binding field ${prerequisite.binding_field}, which is unavailable because ${prerequisite.prerequisite} is ${prerequisite.status}`,
        { source_policy: slot.source, refinements: slot.refinements, assessment: source },
        problem(category, prerequisite === undefined ? 'parameter_source' : 'derived_parameter_prerequisite_missing', {
          parameter: slot.name, source_policy: slot.source, refinements: slot.refinements, assessment: source,
          ...(prerequisite === undefined ? {} : { authored_prerequisite: structuredClone(prerequisite) }) },
        { definitionSensitive: true })));
      }

    }
    Object.assign(roleBindings, canonical.role_bindings ?? {});
    for (const producer of contract.role_producers) if (['definition_constant', 'same_reference_alias',
      'complete_population_count'].includes(producer.kind)) {
      const result = deriveParameterRole(contract, producer.role, roleBindings);
      derived[producer.role] = result;
      if (result.status === 'incompatible') diagnostics.push(diagnostic(
        'obligation_coverage_derivation_incompatible', `/role_producers/${producer.role}`,
        result.reason, { derivation: result }, problem('canonical_source',
          'canonical_derivation_incompatible', { role: producer.role, derivation: result },
          { definitionSensitive: true })));
    }
    node.input_status = diagnostics.length ? 'invalid' : 'valid';
    const capability = contract.capabilities.find(cap => cap.id === contract.construction.capability);
    if (!parameterOnly) {
    if (capability.state !== 'implemented') diagnostics.push(diagnostic(
      'obligation_coverage_construction_unavailable', '/construction', capability.gap?.missing ?? 'Constructor unavailable',
      { capability }, problem('system_capability', 'construction_capability_unavailable',
        { capability }, { definitionSensitive: true })));
    else {
      const canonicalInput = context.construction_inputs?.[capability.identity];
      if (canonicalInput === undefined) {
        node.construction_status = 'unresolved';
        diagnostics.push(diagnostic('obligation_coverage_construction_sources_missing', '/construction/canonical_inputs',
          'The constructor requires its declared canonical sources; scope lists are not a substitute',
          { requirements: contract.construction.canonical_inputs,
            ...(context.construction_source_diagnostics?.[capability.identity] ? { source_failure: context.construction_source_diagnostics[capability.identity] } : {}) },
          problem('canonical_source', 'construction_canonical_sources_missing', {
            capability_identity: capability.identity,
            requirements: contract.construction.canonical_inputs,
            ...(context.construction_source_diagnostics?.[capability.identity]
              ? { source_failure: context.construction_source_diagnostics[capability.identity] } : {})
          }, { definitionSensitive: true })));
      } else if (node.input_status === 'valid') {
        const constructor = implementedConstructors[capability.identity];
        if (!constructor) throw new Error('Validated constructor has no package capability owner');
        try { node.construction = await constructor(canonicalInput); node.construction_status = 'complete'; }
        catch (error) {
          if (!/^(proof_authoring_|integration_prefix_)/u.test(error?.code ?? '')) throw error;
          diagnostics.push(ownerDiagnostic(error, '/construction', problem('system_capability',
            'construction_owner_failure', { owner_code: error.code, details: error.details ?? null },
            { definitionSensitive: true }))); node.construction_status = 'invalid';
        }
      }
    }
    }
    if (contract.dependencies.state === 'unresolved') diagnostics.push(diagnostic(
      'obligation_coverage_dependencies_unresolved', '/dependencies', contract.dependencies.gap.missing,
      { gap: contract.dependencies.gap }, problem('system_capability', 'dependency_recipe_unavailable',
        { gap: contract.dependencies.gap }, { definitionSensitive: true })));
    else if (!dependencyFailure && !stack.has(identity(pack))) {
      const next = new Set(stack).add(identity(pack));
      for (const dependency of contract.dependencies.packs) {
        const child = definitions.get(`${dependency.profile_id}@${dependency.profile_version}`);
        const values = {};
        for (const mapping of dependency.input_mappings) if (effective[mapping.parameter]?.status === 'available') {
          Object.defineProperty(values, mapping.input, { value: effective[mapping.parameter].value, enumerable: true });
        }
        const expanded = await expand(child, values, {}, next);
        node.dependencies.push({ identity: expanded.identity, output_uses: structuredClone(dependency.output_uses) });
      }
    }
    if (node.dependencies.some(edge => nodes.get(edge.identity).diagnostics.length > 0)) {
      diagnostics.push(diagnostic('obligation_coverage_dependency_unresolved', '/dependencies',
        'A reachable dependency has incomplete input or construction', { dependencies: node.dependencies.map(edge => edge.identity) },
        problem('system_capability', 'reachable_dependency_unresolved', {
          dependencies: node.dependencies.map(edge => edge.identity)
        }, { definitionSensitive: true })));
    }
    return node;
  }
  function canonicalInputs(row, pack) {
    const supplied = context.canonical_parameters?.[row.obligation_id];
    if (supplied !== undefined) return supplied;
    const contract = contracts.get(identity(pack));
    const tests = linkedNativeTestProofs({ relations: context.contract_relations ?? [],
      test_proofs: context.test_declarations ?? [] }, row);

    const bindingRoute = requirementsForPack(pack).requirements.native_test_binding === 'required';
    const prerequisites = {};
    const withPrerequisites = values => Object.keys(prerequisites).length === 0 ? values
      : { ...values, authored_prerequisites: prerequisites };
    const derivedSlots = contract.parameters.filter(slot => slot.source.policy === 'canonical' &&
      slot.source.mapping === 'canonical-source' && Object.hasOwn(BINDING_DERIVED_SOURCES, slot.value_kind));
    const absent = (slot, fact) => {
      if (bindingRoute) prerequisites[slot.name] = { ...fact, ...BINDING_DERIVED_SOURCES[slot.value_kind] };
    };

    if (tests.length !== 1) {
      for (const slot of derivedSlots) absent(slot, { prerequisite: 'native_test_binding',
        status: tests.length === 0 ? 'missing' : 'ambiguous', binding_count: tests.length });
      return withPrerequisites({});
    }
    const [test] = tests;
    const targets = [
      ...(context.test_target_declarations?.executable_declarations ?? []).filter(
        target => target.verification_ids.includes(test.verification_claim_id)),
      ...(context.native_case_targets ?? []).filter(target =>
        target.verification_id === test.verification_claim_id).map(target => ({ target: target.path }))
    ];
    const references = new Map((context.contract_references ?? []).map(ref => [ref.reference_id, ref]));
    const boundary = test.system_under_test_boundary?.subject_reference_ids;
    const values = { reference_facts: {}, ...(targets.length === 1 ? { canonical_test_source: {
      verification_id: test.verification_claim_id,
      test_proof_id: test.test_proof_id,
      target: targets[0].target
    } } : {}) };
    for (const slot of contract.parameters) {
      if (slot.source.policy !== 'canonical' || slot.source.mapping !== 'canonical-source') continue;
      if (slot.value_kind === 'test_assertion_selector' && (test.test_selector?.node_id !== undefined ||
          test.test_selector?.name !== undefined && test.test_selector?.nesting !== undefined)) values[slot.name] = test.test_selector;
      else if (slot.value_kind === 'typed_referent' && boundary !== undefined && boundary.every(id => references.has(id))) {
        values.reference_facts[slot.name] = boundary.map(id => references.get(id));
        values[slot.name] = boundary.length === 1 ? references.get(boundary[0]).identity : boundary.map(id => references.get(id).identity);
      }
    }

    if (row.case_id) for (const slot of derivedSlots) {
      const fieldAbsent = slot.value_kind === 'typed_referent' ? boundary === undefined
        : !Object.hasOwn(values, slot.name);
      if (fieldAbsent) absent(slot, { prerequisite: 'authored_case', status: 'incomplete' });
    }
    return withPrerequisites(values);
  }
  const rowFacts = [], entries = [];
  for (const entry of rows) {
    const { row, pack, diagnostics, path, prerequisites, semanticDiagnostics } = entry;
    let node = null;
    if (pack) {
      node = await expand(pack, row.selection.parameters, canonicalInputs(row, pack));
      diagnostics.push(...node.diagnostics.map(d => ({ ...d, path: `${path}/selection${d.path}` })));
    }
    if (dependencyFailure) diagnostics.push(dependencyFailure);
    const completed = prerequisites === null ? null
      : completeSelectedProofAssessment({ prerequisites, diagnostics,
        inputStatus: node?.input_status ?? 'invalid' });

    rowFacts.push({ obligation_id: row.obligation_id,
      input_status: node?.input_status ?? 'invalid', construction_status: node?.construction_status ?? 'unresolved',
      definition: pack ? pin(pack) : row.selection ? Object.fromEntries(Object.entries(row.selection).filter(([key]) => key !== 'parameters')) : null,
      resolved_identity: node?.identity ?? null,
      selected_proof_assessment: completed?.assessment ?? null,
      diagnostics: completed?.diagnostics ?? diagnostics });
    entries.push({ row, semantic_diagnostics: semanticDiagnostics, resolved: pack !== null });
  }
  const definitionIdentities = [...definitions.values()].sort((a, b) => identity(a).localeCompare(identity(b))).map(pin);

  return { draft, parameter_only: parameterOnly, entries,
    map: deepFreeze({ source_digest: sourceDigest, context_digest: contextDigest,
      definition_identities: definitionIdentities,
      identity_digest: canonicalDigest({ sourceDigest, contextDigest, definitionIdentities }),
      rows: rowFacts, dependencies: [...nodes.values()] }) };
}
