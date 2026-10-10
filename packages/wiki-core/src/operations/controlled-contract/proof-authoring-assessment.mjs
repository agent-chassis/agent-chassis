import { controlledContractContentDigest } from '../../lib/controlled-contract-tools.mjs';

const INDEPENDENT_OWNER_PASSTHROUGH_CODES = new Set([
  'controlled_acceptance_source_not_current',
  'controlled_acceptance_proof_posture_invalid',
  'obligation_coverage_source_not_found'
]);

function independentOwnerRefusal(error) {
  const code = error?.code;
  return typeof code === 'string' && (
    INDEPENDENT_OWNER_PASSTHROUGH_CODES.has(code) ||
    code.startsWith('acceptance_coverage_canonical_source_') ||
    code.startsWith('controlled_contract_carrier_') ||
    code.startsWith('controlled_contract_generation_')
  );
}

export function independentOwnerFailure(error, responsibleOwner) {

  if (independentOwnerRefusal(error)) return null;
  const code = typeof error?.code === 'string'
    ? error.code : 'independent_owner_failure';
  const originalDetails = error?.details !== null &&
      typeof error?.details === 'object'
    ? structuredClone(error.details) : null;
  return Object.freeze({
    code,
    ownership: 'system',
    responsible_owner: responsibleOwner,
    message: typeof error?.message === 'string'
      ? error.message : 'An independent validation owner failed',
    details: originalDetails === null ? null : Object.freeze(originalDetails),
    cause: Object.freeze({
      code,
      class: typeof error?.name === 'string' ? error.name : null,
      details: originalDetails === null ? null : Object.freeze(structuredClone(originalDetails))
    })
  });
}

function semanticValidationResult(resolved, semantic, context, failure) {
  const sourceDigest = resolved.source.content_digest;
  const contextDigest = controlledContractContentDigest({
    contract_nodes: context.contract_nodes ?? [],
    selected_unit: resolved.selectedUnit
  });
  const rows = semantic.rows.map((row) => {
    const sourceRow = resolved.rows.find(({ obligation_id: id }) => id === row.obligation_id);

    const complete = row.status === 'complete' && row.accounting.status === 'accounted';
    return {
      obligation_id: row.obligation_id,
      status: complete ? 'valid' : 'invalid',
      semantic_status: row.status === 'complete' ? 'valid' : 'invalid',
      semantic_diagnostic_codes: row.diagnostics.map(({ code }) => code),
      authoring_status: complete ? 'complete' : 'incomplete',
      authoring_diagnostic_codes: [...new Set([...row.accounting.diagnostic_codes,
        ...row.diagnostics.map(({ code }) => code)])].sort(),
      accounting: row.accounting,
      disposition: sourceRow?.gap ? 'explicit_gap'
        : sourceRow?.selection?.proof_name ? 'selected' : 'unselected',
      input_status: row.status,
      construction_status: 'unresolved',
      definition: null,
      resolved_identity: null,
      selected_proof_assessment: null,
      diagnostics: structuredClone(row.diagnostics)
    };
  });
  return Object.freeze({
    status: 'invalid',
    semantic_status: semantic.status === 'complete' ? 'valid' : 'invalid',
    source_digest: sourceDigest,
    context_digest: contextDigest,
    identity_digest: controlledContractContentDigest({ sourceDigest, contextDigest,
      semantic, failure }),
    definition_identities: [],
    diagnostics: structuredClone(semantic.diagnostics),
    rows,
    dependencies: [],
    mapping: null,
    obligation_facts: [],
    counts: {
      obligations: rows.length,
      resolved_selections: 0,
      valid: 0,
      invalid: rows.length,
      explicit_gaps: rows.filter(({ disposition }) => disposition === 'explicit_gap').length,
      unselected: rows.filter(({ disposition }) => disposition === 'unselected').length,
      dependency_nodes: 0
    }
  });
}

export async function assessSavedContractSource({ resolved, context }, deps = {}) {
  const { assessProofAuthoringSemantics } =
    await import('@agent-chassis/controlled-contract/proof-contract');
  const semanticAssessment = assessProofAuthoringSemantics(resolved.source.content, context);
  let executableMapFailure = null;
  let result;
  try {
    const { resolveProofAuthoring: defaultResolveProofAuthoring } =
      await import('@agent-chassis/controlled-contract/proof-authoring');
    const resolveProofAuthoring = deps.resolveProofAuthoring ?? defaultResolveProofAuthoring;
    result = await resolveProofAuthoring(resolved.source.content, context);
  } catch (error) {
    executableMapFailure = independentOwnerFailure(error, 'proof-authoring-executable-map');
    if (executableMapFailure === null) throw error;
    result = semanticValidationResult(resolved, semanticAssessment, context,
      executableMapFailure);
  }
  return { semanticAssessment, result, executableMapFailure };
}
