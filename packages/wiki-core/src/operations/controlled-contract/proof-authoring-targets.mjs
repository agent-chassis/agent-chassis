import { prepareGraphEvidenceSidecarSettlement } from "../work-records-graph-impact.mjs";
import { ControlledContractToolError, controlledContractCarrierFilename, controlledContractContentDigest,
  withCanonicalControlledContractSourceLease } from '../../lib/controlled-contract-tools.mjs';
import { computeWorkRecordSourceDigest } from '../../lib/work-record-schema.mjs';
import { prepareValidatedWorkRecordSettlement } from '../work-records-store-io.mjs';
import { compileControlledContractAuthoringProspectiveMembers, settleControlledContractAuthoringProspectiveMembers } from './authoring-prospective-settlement.mjs';
import { coverageSelectorRecovery } from './coverage-recovery-guidance.mjs';
import { bindProofAuthoringRevision } from './proof-authoring-revision.mjs';
import { resolveProofAuthoringSource } from './proof-authoring-source.mjs';
import { assertBirthProofAuthoringSource, birthProofAuthoringAuthority,
  bindBirthProofAuthoringProspectiveSource } from './saved-proof-source.mjs';
import { withBirthControlledContractSourceLease } from '../../lib/controlled-contract-source-lease-acquisition.mjs';

const same = (left, right) => controlledContractContentDigest(left) === controlledContractContentDigest(right);

export function assertProofAuthoringReadback(final, candidate) {
  const population = sources => sources.map(entry => entry.selectedUnit ?? '').sort().join('\u0000');
  const matches = population(final.sources) === population(candidate.sources) &&
    candidate.sources.every(entry => same(entry.content ?? null,
      final.sources.find(actual => actual.selectedUnit === entry.selectedUnit)?.source?.content ?? null)) &&
    same(final.source?.content ?? null, candidate.content) && same(final.record, candidate.record) &&
    same(final.cases, candidate.cases) && same(final.contract?.content ?? null, candidate.canonicalContract);
  if (!matches) throw new ControlledContractToolError('obligation_coverage_readback_moved',
    'Authored state moved before the save receipt could be read back');
}

function withProofAuthoringSettlementLease({ input, initial, population = initial.sources }, callback) {
  const birth = birthProofAuthoringAuthority(initial);
  const acquire = birth ? withBirthControlledContractSourceLease : withCanonicalControlledContractSourceLease;
  return acquire({ repoRoot: input.repoRoot, wkId: input.wkId,
    ...(birth ? { recordLease: birth.recordLease } : {}),
    focus: input.focus, mutation: { carrierKind: 'contract',
      obligationSources: population.map(entry => ({ selectedUnit: entry.selectedUnit })) } }, callback);
}

export function prospectiveProofAuthoringSource(initial, candidate) {
  const selectedSource = candidate.sources.find(entry =>
    entry.selectedUnit === initial.selectedUnit)?.content ?? null;
  const parentSource = candidate.sources.find(entry => entry.selectedUnit === null)
    ?.content ?? null;
  return bindBirthProofAuthoringProspectiveSource(initial, {
    ...initial,
    record: candidate.record,
    unit: candidate.unit,
    recordSourceDigest: computeWorkRecordSourceDigest(candidate.record),
    cases: candidate.cases,
    sources: candidate.sources.map(entry => ({ ...entry,
      source: entry.content === undefined ? null : {
        content: entry.content,
        content_digest: controlledContractContentDigest(entry.content)
      } })),
    source: selectedSource === null ? null : {
      content: selectedSource,
      content_digest: controlledContractContentDigest(selectedSource)
    },
    caseSource: parentSource === null ? null : {
      content: parentSource,
      content_digest: controlledContractContentDigest(parentSource)
    },
    contract: candidate.canonicalContract === null ? null : {
      content: candidate.canonicalContract,
      content_digest: controlledContractContentDigest(candidate.canonicalContract)
    }
  });
}

function settleProofAuthoringCandidate({ input, initial, candidate, source, assertDefinitions, options,
  publishCarriers, targetRecord, evidenceParticipants = [], dependencies = {} }) {
  const prospective = publishCarriers ? compileControlledContractAuthoringProspectiveMembers({
    wkId: input.wkId, focus: input.focus, source, contributions: [{ owner: "authored_case_native_retirement",
      carrier_kind: "contract", filename: controlledContractCarrierFilename({ ...input, carrierKind: "contract" }),
      content: candidate.canonicalContract }] }) : { source: { generation: typeof source.canonical_set.generation === 'string'
    ? source.canonical_set.generation : source.canonical_set.generation?.id ?? null,
    manifest_content_digest: source.manifest_content_digest, record_source_digest: source.record_source_digest ?? null },
    contributions: [], changed_filenames: [], invalidated_proof_plan: false, member_digests: {} };
  const proofSourceOverride = prospectiveProofAuthoringSource(initial, candidate);
  return settleControlledContractAuthoringProspectiveMembers({ repoRoot: input.repoRoot, wkId: input.wkId,
    focus: input.focus, source, prospective, selectedUnit: initial.selectedUnit, publishCarriers,
    obligationSources: candidate.sourceChanges.map(entry => ({ initial: { ...initial,
      selectedUnit: entry.selectedUnit, source: entry.source }, content: entry.content,
      assertCurrent: assertDefinitions, persistenceEffects: options.persistenceEffects })),
    targetRecord,
    compilerContract: candidate.contract,
    proofSourceOverride, evidenceParticipants,
    assertDefinitions }, dependencies);
}

export async function settleProofAuthoringCases({ input, initial, candidate, assertCurrent, assertDefinitions, options }) {
  return withProofAuthoringSettlementLease({ input, initial }, async source => {
    await assertCurrent();
    return settleProofAuthoringCandidate({ input, initial, candidate, source, assertDefinitions, options,
      publishCarriers: candidate.nativeChanged,
      targetRecord: candidate.targetsChanged ? candidate.record : null });
  });
}

export async function settlePreparedRecordAuthoring({ input, initial, preparation, options = {} }) {
  const birth = birthProofAuthoringAuthority(initial);
  const candidate = structuredClone(preparation.candidate);
  if (input.wkId !== initial.wkId || (input.selectedUnit ?? null) !== initial.selectedUnit ||
      (input.focus ?? null) !== initial.focus || candidate.record?.id !== initial.record.id) {
    throw new ControlledContractToolError('obligation_coverage_request_invalid',
      'Joint settlement target does not match its captured source', { changed: false, phase: 'request' });
  }
  const target = { repoRoot: input.repoRoot, wkId: initial.wkId, focus: initial.focus,
    selectedUnit: initial.selectedUnit };
  const resolveCurrent = async () => bindProofAuthoringRevision(
    await (options.resolveFacts ?? resolveProofAuthoringSource)(target));
  const recordChanged = birth !== null || !same(candidate.record, initial.record);
  const publishCarriers = !same(candidate.canonicalContract, initial.contract?.content ?? null);
  return withProofAuthoringSettlementLease({ input: target, initial, population: candidate.sources }, async source => {
    if (birth) await assertBirthProofAuthoringSource(initial, candidate.sources.map(entry => entry.selectedUnit));
    const current = birth ? initial : await resolveCurrent();
    if (current.authoringIdentity !== initial.authoringIdentity) throw new ControlledContractToolError(
      'obligation_coverage_final_compare_stale', 'Combined authoring revision changed before effects',
      { changed: false, next_calls: coverageSelectorRecovery({ family: 'obligation', input: target }) });
    await preparation.assertDefinitions();
    const observe = async (snapshot) => typeof options.observeCommitted === 'function'
      ? { observed: await options.observeCommitted(snapshot) } : {};
    if (!recordChanged && !publishCarriers && candidate.sourceChanges.length === 0) {
      return { no_op: true, receipt: null, snapshot: current, ...(await observe(current)) };
    }
    const receipt = await settleProofAuthoringCandidate({ input: target, initial, candidate, source,
      assertDefinitions: preparation.assertDefinitions, options, publishCarriers,
      targetRecord: recordChanged ? candidate.record : null,
      evidenceParticipants: preparation.graphEvidenceContribution === undefined ? [] : [{ name: "graph_evidence",
        prepare: () => prepareGraphEvidenceSidecarSettlement({ contribution: preparation.graphEvidenceContribution,
          recordId: target.wkId, sourceDigest: initial.recordSourceDigest, dir: target.repoRoot,
          recordLease: birth?.recordLease ?? null, effects: options.persistenceEffects }) }],
      dependencies: { ...(options.retain ? { retain: options.retain } : {}),
        prepareRecordSettlement: ({ targetRecord }) => prepareValidatedWorkRecordSettlement({
          dir: target.repoRoot, id: target.wkId, record: targetRecord, lease: source.record_lease,
          proofPosturePreparation: preparation.contractInputs?.proofPosturePreparation ?? null,
          graphEvidenceContribution: preparation.graphEvidenceContribution ?? null,
          ...(options.persistenceEffects ? { persistenceEffects: options.persistenceEffects } : {}) }) } });

    let snapshot;
    try {
      snapshot = await resolveCurrent();
      assertProofAuthoringReadback(snapshot, candidate);
      await preparation.assertDefinitions();
    } catch (error) {
      const { changed: _changed, ...details } = error?.details ?? {};
      throw new ControlledContractToolError(error?.code ?? 'obligation_coverage_readback_failed',
        error?.message ?? 'Joint authoring publication committed but its readback failed', {
          ...details, changed: true, retry_safe: false, publication_outcome: 'established',
          publication_phase: 'post_commit_readback' }, error);
    }
    return { no_op: false, receipt, snapshot, ...(await observe(snapshot)) };
  });
}
