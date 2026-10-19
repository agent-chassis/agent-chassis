import { controlledContractContentDigest } from '../../lib/controlled-contract-tools.mjs';

export function reconcileProofAuthoringCandidate({ pkg, captured, candidate }) {
  const digest = content => content == null ? null : controlledContractContentDigest(content);
  candidate.sourceChanges = candidate.sources.flatMap(entry => {
    const prior = captured.sources.find(source => source.selectedUnit === entry.selectedUnit)?.source ?? null;
    entry.source = prior;
    if (digest(entry.content) === digest(prior?.content)) return [];
    const validated = pkg.validateObligationCoverageDraft(entry.content);
    if (!validated.valid) throw new Error('semantic preparation produced an invalid source');
    entry.content = validated.carrier;
    return [{ selectedUnit: entry.selectedUnit, source: prior, content: entry.content }];
  });
  candidate.content = candidate.sources.find(entry => entry.selectedUnit === captured.selectedUnit)?.content ?? null;
  candidate.rootContent = candidate.sources.find(entry => entry.selectedUnit === null)?.content ?? null;
}
