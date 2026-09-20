

import { ControlledContractToolError, controlledContractContentDigest }
  from '../../lib/controlled-contract-tools.mjs';
import { loadControlledContractPackage } from './package-runtime.mjs';
import {
  parseProofSourceUnitAddress,
  projectSavedProofCase,
  resolveDerivedProofContract,
  resolveSavedProofContext,
  resolveSavedProofSource
} from './saved-proof-source.mjs';

export {
  parseProofSourceUnitAddress as parseProofAuthoringUnitAddress,
  resolveSavedProofSource as resolveProofAuthoringSource,
  resolveSavedProofContext as resolveProofAuthoringContext,
  resolveDerivedProofContract as resolveDerivedProofAuthoringContract
};
const resolveProofAuthoringSource = resolveSavedProofSource;
const resolveProofAuthoringContext = resolveSavedProofContext;

export function proofAuthoringCarrierContent(resolved, rows) {
  return { ...(resolved.source?.content ?? { schema_version: 'controlled-contract-obligation-coverage.v3', wk_id: resolved.wkId,
    selected_unit: resolved.selectedUnit ?? null, focus: resolved.focus ?? null }),
    obligations: structuredClone(rows).sort((a, b) => a.obligation_id < b.obligation_id ? -1 : a.obligation_id > b.obligation_id ? 1 : 0) };
}
export async function resolveProofAuthoringCompleteness(input, options = {}) {
  const { resolveObligationCoverageFacts } = await import('./acceptance-coverage-facts.mjs');
  return resolveObligationCoverageFacts(input, { ...options, allowIncomplete: true });
}

export function proofAuthoringCompletenessSummary(facts) {
  const resolution = facts.resolution ?? facts.obligationResolution;
  if (resolution == null) return Object.freeze({ status: 'absent', authored_obligations: 0, resolved_obligations: 0 });
  return Object.freeze({ status: resolution.status === 'valid' ? 'complete' : 'unresolved',
    authored_obligations: resolution.total, resolved_obligations: resolution.mapping?.obligations.length ?? 0,
    source_digest: resolution.source_digest, context_digest: resolution.context_digest,
    counts: resolution.counts,
    validation: { tool: 'workspace_validate_proof', arguments: {
      unit: facts.selectedUnit == null ? facts.wkId : `${facts.wkId}#${facts.selectedUnit}`,
      ...(facts.focus == null ? {} : { focus: facts.focus }) } } });
}
export function proofAuthoringIncompleteResult(facts) {
  const completeness = proofAuthoringCompletenessSummary(facts);
  return Object.freeze({ status: 'obligation_resolution_incomplete', changed: false,
    obligation_resolution: completeness, next_calls: [completeness.validation],
    authority: { authoritative: false, grants: [] } });
}

async function sharedConstraintProjection(causes) {
  const { shareRepeatedProofConstraints } = await import('@agent-chassis/controlled-contract/proof-authoring');
  return shareRepeatedProofConstraints(causes);
}

export async function assessProspectiveProofParameters(resolved, obligationIds, { deferRefusal = false } = {}) {
  const context = await resolveProofAuthoringContext(resolved, { assessmentIntent: 'known_parameters' });
  if (obligationIds !== undefined) context.obligation_ids = obligationIds;
  const { resolveProofAuthoring } = await import('@agent-chassis/controlled-contract/proof-authoring');
  const assessment = await resolveProofAuthoring(resolved.source.content, context);
  const incompatibleCodes = new Set(['obligation_coverage_parameter_incompatible', 'obligation_coverage_parameter_canonical_conflict',
    'obligation_coverage_parameter_unknown', 'obligation_coverage_derivation_incompatible', 'obligation_coverage_definition_integrity_mismatch']);
  const causes = assessment.rows.flatMap(row => row.diagnostics.filter(d => incompatibleCodes.has(d.code) ||
    /^(proof_pack_|pack_parameter_)/u.test(d.code) && ![
      'proof_pack_exact_version_not_current', 'proof_pack_exact_version_unavailable',
      'proof_pack_exact_evaluator_unavailable'
    ].includes(d.code))
    .map(d => ({ obligation_id: row.obligation_id, ...d })));
  if (causes.length && !deferRefusal) throw new ControlledContractToolError('obligation_coverage_prospective_incompatible',
    'Known prospective proof parameters contradict their exact selected definitions', {
      changed: false, limb: 'mechanical_failure', member_count: new Set(causes.map(c => c.obligation_id)).size,
      cause_count: causes.length, ...(await sharedConstraintProjection(causes)) });
  return deferRefusal ? { ...assessment, causes } : assessment;
}

export async function assessProspectiveProofUses(uses) {
  const assessments = await Promise.all(uses.map(async resolved => ({ resolved,
    assessment: await assessProspectiveProofParameters(resolved, undefined, { deferRefusal: true }) })));
  const causes = assessments.flatMap(({ resolved, assessment }) => assessment.causes.map(cause => ({
    unit: resolved.selectedUnit === null ? resolved.wkId : `${resolved.wkId}#${resolved.selectedUnit}`, ...cause })));
  if (causes.length) throw new ControlledContractToolError('obligation_coverage_prospective_incompatible',
    'Known prospective proof parameters contradict their exact selected definitions', {
      changed: false, limb: 'mechanical_failure', member_count: new Set(causes.map(c => `${c.unit}/${c.obligation_id}`)).size,
      cause_count: causes.length, ...(await sharedConstraintProjection(causes)) });
  return { definition_identities: assessments.flatMap(({ assessment }) => assessment.definition_identities) };
}

export async function inspectNativePublicationProofParameters({ repoRoot, wkId, focus, contract, sourceOverride }) {
  const root = await resolveProofAuthoringSource({ repoRoot, wkId, focus, selectedUnit: null });
  const pkg = await loadControlledContractPackage();
  for (const definition of sourceOverride?.cases ?? root.cases) {
    if (contract.test_proofs.some(proof => proof.verification_claim_id === pkg.authoredCaseVerificationId(definition))) {
      throw new ControlledContractToolError('obligation_coverage_case_native_edit_forbidden',
        'Authored cases are edited through obligation upsert; native bindings are derived', {
          changed: false, limb: 'mechanical_failure', case_id: definition.case_id });
    }
  }
  const identities = [];
  for (const selectedUnit of [null, ...root.record.slices.map(slice => slice.id)]) {
    const resolved = sourceOverride?.selectedUnit === selectedUnit ? sourceOverride :
      selectedUnit === null ? root : await resolveProofAuthoringSource({ repoRoot, wkId, focus, selectedUnit });
    if (resolved.source === null) continue;
    const assessment = await assessProspectiveProofParameters({ ...resolved,
      ...(sourceOverride ? { cases: sourceOverride.cases } : {}),
      contract: { content: contract, content_digest: controlledContractContentDigest(contract) } });
    identities.push({ unit: selectedUnit, source: resolved.source.content_digest,
      targets: resolved.unit.acceptance.validation, definitions: assessment.definition_identities });
  }
  return controlledContractContentDigest(identities);
}
