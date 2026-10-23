import { ControlledContractToolError, controlledContractContentDigest } from '../../lib/controlled-contract-tools.mjs';
import { prospectiveProofAuthoringSource } from './proof-authoring-targets.mjs';
import { reconcileProofAuthoringCandidate } from './proof-authoring-candidate-reconciliation.mjs';

export const PROOF_REFRESH_CORRECTION = 'Nothing was saved. Read the affected units and exact proof parameter contracts for diagnosis. ' +
  'Refresh cannot change authored inputs or selected versions. Cross-unit authored correction is unavailable through this request; ' +
  'the responsible owners are proof-authoring/save_record. Do not repeat per-unit saves against stale siblings.';

export async function prepareProofAuthoringRefresh({ pkg, initial, now, prepare, requirementAuthoring }) {
  if (initial.selectedUnit !== null) throw new ControlledContractToolError('obligation_coverage_request_invalid',
    'Whole-WK proof refresh requires the root WK source', { changed: false, limb: 'mechanical_failure', phase: 'request' });
  const captures = new Map(), members = [], failures = [];
  const sources = [];
  for (const entry of initial.sources) {
    const unit = entry.selectedUnit === null ? initial.wkId : `${initial.wkId}#${entry.selectedUnit}`;
    if (entry.source === null) { sources.push({ ...entry }); continue; }
    const refreshed = await pkg.refreshPinnedProofSelections(entry.source.content, { captures });
    members.push(...refreshed.members.map(member => ({ unit, ...member })));
    failures.push(...refreshed.failures.map(failure => ({ unit, ...failure })));
    sources.push({ ...entry, content: refreshed.content });
  }
  const staged = prospectiveProofAuthoringSource(initial, {
    record: initial.record, unit: initial.unit, cases: initial.cases,
    canonicalContract: initial.contract?.content ?? null, sources });
  let preparation;
  const retired = failures.find(failure => failure.code === 'proof_pack_exact_version_not_current');
  try {
    preparation = await prepare({ pkg, requirementAuthoring, initial: { ...staged, rows: staged.source?.content.obligations ?? [] },
      input: {}, now });
  } catch (error) {
    if (error?.details?.changed !== false) throw error;
    error.details = { ...error.details, refresh_failures: failures, correction: PROOF_REFRESH_CORRECTION };
    if (retired) throw new ControlledContractToolError(retired.code, retired.message, error.details, error);
    throw error;
  }
  if (failures.length) throw new ControlledContractToolError(retired?.code ?? 'obligation_coverage_prospective_incompatible',
    retired?.message ?? 'Exact selected definitions are unavailable; the whole refresh is refused', {
      changed: false, limb: 'mechanical_failure', member_count: failures.length,
      causes: failures, correction: PROOF_REFRESH_CORRECTION });

  const protectedState = (record, contract, cases, population) => controlledContractContentDigest([
    record, contract, cases, population.map(entry => [entry.selectedUnit, entry.content ?? null])]);
  if (protectedState(initial.record, initial.contract?.content ?? null, initial.cases, sources) !==
      protectedState(preparation.candidate.record, preparation.candidate.canonicalContract,
        preparation.candidate.cases, preparation.candidate.sources)) throw new ControlledContractToolError(
    'obligation_coverage_prospective_incompatible', 'Refresh preparation would change protected authored state', {
      changed: false, limb: 'mechanical_failure', affected: members,
      correction: PROOF_REFRESH_CORRECTION });
  reconcileProofAuthoringCandidate({ pkg, captured: initial, candidate: preparation.candidate });
  const assertDefinitions = preparation.assertDefinitions;
  const pins = await Promise.all([...captures.values()].map(async capture => (await capture).pin));
  preparation.assertDefinitions = async () => {
    for (const pin of pins) {
      try { await pkg.loadPinnedProofSelection(pin); } catch (error) {
        throw new ControlledContractToolError('obligation_coverage_final_compare_stale',
          error.message, { movement: 'definition', cause_code: error.code,
            cause_details: error.details, proof_name: pin.proof_name, proof_version: pin.proof_version }, error);
      }
    }
    await assertDefinitions();
  };
  preparation.refresh = {
    units_inspected: initial.sources.length,
    absent_sources: initial.sources.filter(entry => entry.source === null).length,
    empty_sources: initial.sources.filter(entry => entry.source?.content.obligations.length === 0).length,
    obligations_inspected: members.length,
    ...Object.fromEntries(['refreshed', 'current', 'unselected', 'unpinned', 'opted_out']
      .map(status => [status, members.filter(member => member.status === status).length])), members };
  return preparation;
}
