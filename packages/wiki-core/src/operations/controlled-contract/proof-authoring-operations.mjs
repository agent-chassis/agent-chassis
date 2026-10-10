import { bindProofAuthoringRevision } from './proof-authoring-revision.mjs';
import { prepareProofAuthoringMutation, unitAddress } from './proof-authoring-preparation.mjs';
import { assertProofAuthoringReadback, settleProofAuthoringCases } from './proof-authoring-targets.mjs';
import { ControlledContractToolError, assertControlledContractOperationInput,
  controlledContractContentDigest, withCanonicalControlledContractSourceLease } from '../../lib/controlled-contract-tools.mjs';
import { loadControlledContractProofAuthoring } from './package-runtime.mjs';
import { proofAuthoringOperation } from './refusal.mjs';
import { resolveProofAuthoringSource } from './proof-authoring-source.mjs';
import { persistObligationCoverageCarrier, obligationCoverageResolutionInput } from './proof-authoring-persistence.mjs';
import { coverageSelectorRecovery } from './coverage-recovery-guidance.mjs';
import { CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE } from '../../lib/work-record-proof-posture.mjs';

const own = (value, key) => Object.hasOwn(value, key);
export async function refuseMalformedControlledContractObligationCoverageRequest({ operation, issueCount, issues }) {
  return proofAuthoringOperation(async () => {
    throw new ControlledContractToolError('obligation_coverage_request_invalid',
      'Obligation request failed its closed schema', { changed: false, phase: 'request', operation,
        issue_count: issueCount, issues: structuredClone(issues) });
  });
}
function assertCAS(input, resolved) {
  const actual = resolved.revision;
  if (input.expectedContentDigest !== actual) throw new ControlledContractToolError(
    'obligation_coverage_content_digest_mismatch', 'Source content-digest CAS mismatched', {
      changed: false, phase: 'admission', expected_content_digest: input.expectedContentDigest,
      actual_content_digest: actual,

      next_calls: coverageSelectorRecovery({ family: 'obligation', input })
    });
}
async function mutation(input, remove, options) {
  return proofAuthoringOperation(async () => {
    let persistenceStarted = false;
    let committed = false;
    try {
      const pkg = await loadControlledContractProofAuthoring();
      assertControlledContractOperationInput(input, ['repoRoot', 'wkId', 'focus', 'selectedUnit',
        'expectedContentDigest', ...(remove ? ['obligationId', 'removalScope'] : [
          'obligations', 'contractRequirements', 'controlledAcceptance'])]);
      if (!own(input, 'expectedContentDigest')) throw new ControlledContractToolError(
        'obligation_coverage_request_invalid', 'A combined revision is required');
      const target = obligationCoverageResolutionInput(input);
      const resolveSource = options.resolveFacts ?? resolveProofAuthoringSource;
      const resolveRevision = async () => bindProofAuthoringRevision(await resolveSource(target));
      const initial = await resolveRevision();
      assertCAS(input, initial);

      if (!remove && !['obligations', 'contractRequirements', 'controlledAcceptance'].some(key => own(input, key))) {
        throw new ControlledContractToolError('obligation_coverage_request_invalid',
          'Supply obligations, contract requirements, controlled acceptance, or a combination');
      }
      const { candidate, contractInputs, editsRequirements, editsPosture, requirementRetirements,
        retirement, assertDefinitions } = await prepareProofAuthoringMutation({
        pkg, initial, input, remove, now: options.now });
      const assertCurrent = async () => {
        const current = await resolveRevision();
        if (current.revision !== initial.revision) throw new ControlledContractToolError(
          'obligation_coverage_final_compare_stale', 'Combined authoring revision changed before effects',
          { next_calls: coverageSelectorRecovery({ family: 'obligation', input }) });
        await assertDefinitions();
        return current;
      };
      persistenceStarted = true;
      if (candidate.nativeChanged || candidate.sourceChanges.some(entry => entry.selectedUnit !== initial.selectedUnit) || candidate.targetsChanged) {
        await settleProofAuthoringCases({ input: target, initial, candidate, assertCurrent, assertDefinitions, options });
        committed = true;
      } else if (candidate.content !== null && controlledContractContentDigest(candidate.content) !==
          controlledContractContentDigest(initial.source?.content ?? null)) {
        const receipt = await (options.persistCarrier ?? persistObligationCoverageCarrier)({ input,
          expectedSnapshot: initial, content: candidate.content,
          bytes: Buffer.from(`${JSON.stringify(candidate.content, null, 2)}\n`),
          write: controlledContractContentDigest(candidate.content) !== initial.source?.content_digest,
          resolveFacts: assertCurrent, directorySync: true, classifyPostCommit: true, draftObligation: true,
          ...(options.persistenceEffects ? { persistenceEffects: options.persistenceEffects } : {}),
          withSourceLease: options.withSourceLease ?? ((_args, callback) => withCanonicalControlledContractSourceLease({
            ...target, mutation: { carrierKind: 'contract', obligationSources: initial.sources.map(entry => ({ selectedUnit: entry.selectedUnit })) } }, callback)) });
        committed = receipt.changed === true;
        if (receipt.status === 'post_commit_failure') return { ...receipt, unit: unitAddress(initial) };
      }
      const final = await resolveRevision();
      assertProofAuthoringReadback(final, candidate);
      await assertDefinitions();

      return { unit: unitAddress(initial), saved: candidate.saved, unchanged: candidate.unchanged, content_digest: final.revision,

        ...(editsPosture && input.controlledAcceptance?.disposition === 'opted_out'
          ? { controlled_acceptance: CONTROLLED_ACCEPTANCE_OPT_OUT_PROVENANCE } : {}),
        ...(editsRequirements ? { requirement_bindings: (contractInputs.requirementCompilation?.compiled ?? []).map((entry, index) => ({
          input_index: index, claim_id: entry.claim_id, verification_claim_id: entry.verification_claim_id,
          test_proof_id: entry.test_proof_id, replaced_claim_id: entry.replaced_claim_id })) } : {}),
        ...(retirement === null ? {} : { requirement_retirements: {
          selections: requirementRetirements.map(fact => ({ input_index: fact.retire_index, claim_id: fact.claim_id,
            retired_verification_claim_ids: fact.retired_verification_ids,
            surviving_verification_claim_ids: fact.surviving_verification_ids })),
          retired_obligation_count: candidate.retirement.retired_uses.length,
          retired_case_count: candidate.retirement.retired_case_ids.length } }) };
    } catch (error) {
      if (committed) return { unit: input.selectedUnit ? `${input.wkId}#${input.selectedUnit}` : input.wkId,
        status: 'post_commit_failure', commit_state: 'committed', failure_code: error.code ?? 'obligation_coverage_readback_failed',
        next_calls: [{ tool: 'workspace_controlled_contract_obligation_coverage_query', arguments: {
          unit: input.selectedUnit ? `${input.wkId}#${input.selectedUnit}` : input.wkId,
          ...(input.focus ? { focus: input.focus } : {}) } }] };
      if (!persistenceStarted) error.details = { ...error.details, changed: false, phase: error.details?.phase ?? 'admission' };
      throw error;
    }
  });
}

export const upsertControlledContractObligationCoverageOperation = (input, options = {}) => mutation(input, false, options);
export const removeControlledContractObligationCoverageOperation = (input, options = {}) => mutation(input, true, options);
