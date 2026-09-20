import { controlledContractContentDigest, resolveCanonicalControlledContractCarrierSet } from '../../lib/controlled-contract-tools.mjs';

export async function bindProofAuthoringRevision(resolved) {
  const canonicalSet = resolved.canonicalSet ?? await resolveCanonicalControlledContractCarrierSet({
    repoRoot: resolved.repoRoot, wkId: resolved.wkId, focus: resolved.focus });
  const contract = canonicalSet.members.find(member => member.carrier_kind === 'contract') ?? null;
  const record = resolved.record;
  const state = { unit: resolved.wkId, selected_unit: resolved.selectedUnit, focus: resolved.focus,
    work_record: resolved.recordSourceDigest ?? controlledContractContentDigest(record),
    obligation_sources: (resolved.sources ?? []).map(entry => [entry.selectedUnit, entry.source?.content_digest ?? null]),
    obligation_source: resolved.source?.content_digest ?? null,
    native_manifest: canonicalSet.manifest_content_digest,
    native_members: canonicalSet.members.map(member => [member.filename, member.content_digest]),
    target_authoring: [record.acceptance.validation, ...record.slices.map(slice => [slice.id, slice.acceptance.validation])] };
  const absent = resolved.source === null && !resolved.caseSource &&
    (resolved.sources ?? []).every(entry => entry.source === null) &&
    canonicalSet.members.length === 0 &&
    record.acceptance.validation.length === 0 &&
    record.slices.every(slice => slice.acceptance.validation.length === 0) &&
    !Object.hasOwn(record, 'proof_posture');
  const authoringIdentity = controlledContractContentDigest(state);
  return { ...resolved, contract, canonicalSet, revision: absent ? null : authoringIdentity,
    authoringIdentity };
}
