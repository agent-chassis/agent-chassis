export { buildPublicSelectionSchema } from './public-selection-schema.mjs';
export { resolvePublicSelections, projectPublicSelection } from './public-selection-resolution.mjs';

export async function createPublicSelectionSource({ captured, population }) {
  if (!captured || typeof captured.authoringIdentity !== 'string' || !['all', 'assigned'].includes(population))
    throw new TypeError('Public selection requires a captured authoring identity and authorized complete population.');
  const { projectObligationCoverageFromSource } = await import('./obligation-coverage-query.mjs');
  const coverage = await projectObligationCoverageFromSource(captured, { population, view: 'complete' });
  const { loadControlledContractProofAuthoring } = await import('./package-runtime.mjs');
  const { criterionIdentityInputs } = await import('./criterion-identity-projection.mjs');
  const pkg = await loadControlledContractProofAuthoring();
  const identities = new Map(pkg.deriveCriterionIdentities(criterionIdentityInputs(captured.unit?.acceptance?.criteria ?? []))
    .map(row => [row.identity, row]));
  return { coverage: { ...coverage, acceptance_criteria: coverage.acceptance_criteria.map(row => ({ ...row, identity_source: identities.get(row.identity)?.source,
    authored: structuredClone(captured.unit.acceptance.criteria[row.position]) })) },
    authoringIdentity: captured.authoringIdentity };
}
