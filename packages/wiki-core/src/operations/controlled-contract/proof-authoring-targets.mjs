import { controlledContractCarrierFilename, withCanonicalControlledContractSourceLease } from '../../lib/controlled-contract-tools.mjs';
import { withOrderedCoverageLocks } from './acceptance-coverage-rebase.mjs';
import { assertObligationCoverageSourcePathIntegrity } from './acceptance-coverage-facts.mjs';
import { compileControlledContractAuthoringProspectiveMembers, settleControlledContractAuthoringProspectiveMembers } from './authoring-prospective-settlement.mjs';

export async function settleProofAuthoringCases({ input, initial, candidate, assertCurrent, assertDefinitions, options }) {
  return withCanonicalControlledContractSourceLease({ repoRoot: input.repoRoot, wkId: input.wkId,
    focus: input.focus, mutation: { carrierKind: 'contract',
      obligationSources: initial.sources.map(entry => ({ selectedUnit: entry.selectedUnit })) } }, async source => {
    const files = await Promise.all(initial.sources.map(entry => assertObligationCoverageSourcePathIntegrity({
      ...input, selectedUnit: entry.selectedUnit })));
    return withOrderedCoverageLocks(files.map(({ file }) => `${file}.lock`), 'obligation_coverage_persistence_busy', async () => {
      await assertCurrent();

      const prospective = candidate.nativeChanged ? compileControlledContractAuthoringProspectiveMembers({
        wkId: input.wkId, focus: input.focus, source, contributions: [{ owner: "authored_case_native_retirement",
          carrier_kind: "contract", filename: controlledContractCarrierFilename({ ...input, carrierKind: "contract" }),
          content: candidate.canonicalContract }] }) : { source: { generation: typeof source.canonical_set.generation === 'string'
        ? source.canonical_set.generation : source.canonical_set.generation?.id ?? null,
        manifest_content_digest: source.manifest_content_digest, record_source_digest: source.record_source_digest ?? null },
        contributions: [], changed_filenames: [], invalidated_proof_plan: false, member_digests: {} };
      return settleControlledContractAuthoringProspectiveMembers({ repoRoot: input.repoRoot, wkId: input.wkId,
        focus: input.focus, source, prospective, selectedUnit: initial.selectedUnit, publishCarriers: candidate.nativeChanged,
        obligationSources: candidate.sourceChanges.map(entry => ({ initial: { ...initial,
          selectedUnit: entry.selectedUnit, source: entry.source }, content: entry.content,
          assertCurrent: assertDefinitions, persistenceEffects: options.persistenceEffects })),
        targetRecord: candidate.targetsChanged ? candidate.record : null, assertDefinitions });
    });
  });
}
