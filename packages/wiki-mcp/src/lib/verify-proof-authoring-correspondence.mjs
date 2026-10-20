import { parseProofSourceUnitAddress } from
  '@agent-chassis/wiki-core/src/operations/controlled-contract/saved-proof-source.mjs';
import { ControlledContractToolError } from '@agent-chassis/wiki-core/src/lib/controlled-contract-tool-shared.mjs';

export async function proofAuthoringCorrespondence({ context, unit, ambiguities }) {
  const missing = message => ({ code: 'verify_proof.authored_verification_correspondence_missing.v1', message });
  if (!ambiguities.length || ambiguities.some(row => !Array.isArray(row.verificationIds) ||
      new Set(row.verificationIds).size < 2 || row.verificationIds.some(id => typeof id !== 'string' || !id.length)))
    return missing('The retained ambiguity has no complete competing-verification correspondence. No authored correction can be selected.');
  const [{ captureObligationCoverageSource }, { createPublicSelectionSource, resolvePublicSelections }] = await Promise.all([
    import('@agent-chassis/wiki-core/src/operations/controlled-contract/obligation-coverage-query.mjs'),
    import('@agent-chassis/wiki-core/src/operations/controlled-contract/public-selection.mjs')
  ]);
  const { wkId, selectedUnit } = parseProofSourceUnitAddress(unit);
  let source;
  try {
    const captured = await captureObligationCoverageSource({ repoRoot: context.sourceRoot, wkId,
      selectedUnit, focus: null });
    source = await createPublicSelectionSource({ captured, population: context.population });
  } catch (error) {
    if (!(error instanceof ControlledContractToolError)) throw error;
    return { code: error.code,
      message: 'The authenticated saved authoring source could not establish verification correspondence. The retained proof failure stands; no authored correction can be selected.' };
  }
  const associated = await resolvePublicSelections({ source, intent: 'read', selectors: ambiguities.map(row =>
    ({ kind: 'requirement', obligation: row.obligationId })) });
  for (const [index, result] of associated.results.entries()) {
    if (result.status !== 'resolved') return { code: result.issue.code, message: result.issue.cause };
    const linked = new Set(result.matches.flatMap(match => match.verifications.map(check => check.id)));
    if (ambiguities[index].verificationIds.some(id => !linked.has(id)))
      return missing('The ambiguous obligation has no complete authored requirement correspondence for its competing verifications. Native verification identities alone cannot identify an authored correction.');
  }
  const { results: [verifications] } = await resolvePublicSelections({ source, intent: 'read', population: 'verifications' });
  if (verifications.status !== 'resolved') return { code: verifications.issue.code, message: verifications.issue.cause };
  const ids = new Set(ambiguities.flatMap(row => row.verificationIds));
  const targets = verifications.matches.filter(match => ids.has(match.internal.claim_id) && match.selector?.requirement);
  if ([...ids].some(id => !targets.some(match => match.internal.claim_id === id)))
    return missing('The competing verifications have no complete public authored selection. No association was guessed.');
  const selectable = await resolvePublicSelections({ source, intent: 'write', expectedRevision: source.authoringIdentity,
    selectors: targets.map(match => match.selector) });
  const unresolved = selectable.results.find((result, index) => result.status !== 'resolved' || result.matches.length !== 1 ||
    result.matches[0].internal.claim_id !== targets[index].internal.claim_id);
  if (unresolved) return missing('The authored verification correspondence cannot be selected uniquely by public meaning. No candidate was selected.');
  return null;
}
