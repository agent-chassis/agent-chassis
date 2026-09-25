

import { linkedNativeTestProofs } from './native-test-proof-authoring.mjs';
import { deepFreeze } from './deterministic-projection-primitives.mjs';
import { diagnosticCodes, resolveProofExecutableMap } from './proof-executable-map.mjs';
import { AUTHORED_BINDING_OWNER_CODES, proofAuthoringPopulationDiagnostics,
  ProofAuthoringError } from './proof-contract.mjs';
import { validateObligationCoverageCarrier } from './obligation-coverage-carrier.mjs';

const EXECUTION_OWNED_PREREQUISITES = new Set(['native_test_binding', 'declared_test_target']);

function executionOwnedPrerequisite(entry, row) {
  const cause = entry.problem?.cause ?? {};
  if (cause.kind === 'selected_route_prerequisite') {

    if (cause.prerequisite === 'authored_case') return typeof row.case_id !== 'string';
    if (!EXECUTION_OWNED_PREREQUISITES.has(cause.prerequisite)) return false;
    return !(cause.prerequisite === 'native_test_binding' &&
      AUTHORED_BINDING_OWNER_CODES.includes(cause.owner_code));
  }
  if (cause.kind === 'derived_parameter_prerequisite_missing') {
    return EXECUTION_OWNED_PREREQUISITES.has(cause.authored_prerequisite?.prerequisite);
  }

  if (cause.kind === 'parameter_source') {
    return cause.source_policy?.policy === 'configurable' &&
      cause.assessment?.status === 'missing';
  }
  return false;
}

export async function resolveProofAuthoring(source, context = {}, owners = {}) {
  const { draft, parameter_only: parameterOnly, entries, map } =
    await resolveProofExecutableMap(source, context, owners);
  const results = entries.map(({ row, semantic_diagnostics: semanticDiagnostics }, index) => {
    const facts = map.rows[index];

    const semanticStatus = semanticDiagnostics.length === 0 ? 'valid' : 'invalid';

    const routeStages = facts.selected_proof_assessment?.stages ?? null;
    const authoringBlockers = facts.diagnostics.filter(entry =>
      entry.problem?.route_assessment?.effect === 'blocking' &&
      entry.problem.route_assessment.stage === 'authored_inputs' &&
      !executionOwnedPrerequisite(entry, row));
    const authoringStatus = semanticStatus === 'valid' && authoringBlockers.length === 0
      ? 'complete' : 'incomplete';
    const canonicalCurrent = routeStages === null ||
      routeStages.canonical_sources.status === 'current';
    const rowStatus = authoringStatus === 'complete' && canonicalCurrent ? 'valid' : 'invalid';

    return { obligation_id: facts.obligation_id,
      status: rowStatus,
      semantic_status: semanticStatus,
      semantic_diagnostic_codes: diagnosticCodes(semanticDiagnostics),
      authoring_status: authoringStatus,
      authoring_diagnostic_codes: diagnosticCodes([...semanticDiagnostics, ...authoringBlockers]),
      disposition: row.gap ? 'explicit_gap' : row.selection?.proof_name ? 'selected' : 'unselected',
      input_status: facts.input_status, construction_status: facts.construction_status,
      definition: facts.definition,
      resolved_identity: facts.resolved_identity,
      selected_proof_assessment: facts.selected_proof_assessment,
      diagnostics: facts.diagnostics };
  });

  const projectRow = ({ row }) => {
    const result = results.find(entry => entry.obligation_id === row.obligation_id);
    const { case_id, ...meaning } = row;
    if (case_id) meaning.controlled_contract_node_ids = [...new Set([...(meaning.controlled_contract_node_ids ?? []),
      ...linkedNativeTestProofs({ relations: context.contract_relations ?? [], test_proofs: context.test_declarations ?? [] }, row).map(proof => proof.verification_claim_id)])];

    return { ...structuredClone(meaning),
      design_status: result.selected_proof_assessment?.readiness_status === 'complete'
        ? 'valid' : 'invalid',
      resolved_identity: result.resolved_identity,
      selected_proof_assessment: structuredClone(result.selected_proof_assessment),
      diagnostics: structuredClone(result.diagnostics) };
  };
  const completeRows = entries.filter(entry => entry.resolved).map(projectRow);

  const obligationFacts = entries.map(projectRow);
  let mapping = null;
  if (!parameterOnly && results.length > 0 && completeRows.length === results.length) {
    const validation = validateObligationCoverageCarrier({ schema_version: 'resolved-obligation-coverage.v1',
      wk_id: draft.wk_id, selected_unit: draft.selected_unit, focus: draft.focus,
      source_digest: map.source_digest, context_digest: map.context_digest,
      definition_identities: map.definition_identities, obligations: completeRows });
    if (!validation.valid) throw new ProofAuthoringError('resolved_selection_invalid',
      'The resolver produced an invalid saved-selection projection', { validation });
    mapping = validation.carrier;
  }

  const executableRow = row => row.selected_proof_assessment?.readiness_status === 'complete';
  return deepFreeze({ status: mapping && results.every(executableRow) ? 'valid' : 'invalid',
  semantic_status: results.length > 0 && results.every(row => row.semantic_status === 'valid')
    ? 'valid' : 'invalid',
  source_digest: map.source_digest,
    context_digest: map.context_digest, definition_identities: map.definition_identities,
    identity_digest: map.identity_digest,
    diagnostics: proofAuthoringPopulationDiagnostics(results.length),
    total: results.length, returned: results.length, omitted: 0,
    rows: results, dependencies: map.dependencies, mapping,
    obligation_facts: obligationFacts,
    counts: { obligations: results.length, resolved_selections: completeRows.length,
      valid: results.filter(executableRow).length,
      invalid: results.filter(row => !executableRow(row)).length,
      explicit_gaps: results.filter(row => row.disposition === 'explicit_gap').length,
      unselected: entries.filter(entry => !entry.row.selection?.proof_name).length,
      dependency_nodes: map.dependencies.length } });
}

export {
  PROOF_AUTHORING_SHARED_CONSTRAINTS_VERSION,
  shareRepeatedProofConstraints
} from './proof-authoring-diagnostic-groups.mjs';
