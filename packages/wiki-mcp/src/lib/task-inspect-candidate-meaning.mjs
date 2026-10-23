import { canonicalCurrentTerminalReviewContract, projectTerminalReviewUnit } from './dispatch-terminal-review-contract.mjs';
import { candidateInspectionReadCall } from './task-inspect-candidate-read-call.mjs';

function atPointer(document, pointer) {
  let value = document;
  if (pointer === '') return { present: true, value };
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return { present: false };
    value = value[key];
  }
  return { present: true, value };
}

function unavailableContract(cause, source) {
  return {
    unavailable: 'The compared authored differences could not be read from the work record.',
    problem: {
      operation: 'read_compared_authored_contract',
      source,
      condition: cause.projection_code ?? cause.code,
      ...(cause.failure == null ? {} : { cause: cause.failure }),
      ...(cause.missing_facts?.length ? { missing_facts: cause.missing_facts } : {}),
      ...(cause.ambiguous_facts?.length ? { ambiguous_facts: cause.ambiguous_facts } : {}),
      effects: { observation_only: true },
      uncertainty: 'The authored differences needed to choose a correction are unavailable.',
      recovery: { state: 'no_supported_route',
        stopping_condition: 'Stop choosing an authored correction from this comparison; no supported repair was established.' }
    }
  };
}

export function candidateDifferenceMeaning({ mainRepo, wkId, selection, requestSchemaAuthority = null }) {
  const divergence = selection.review?.divergence;
  if (divergence == null) return null;
  const historical = selection.context.current.observation.context.candidateRecord;
  const current = canonicalCurrentTerminalReviewContract({ mainRepo, recordId: wkId });
  if (current.ok !== true) return unavailableContract(current.cause, 'current_work_record');
  if (historical.digest !== divergence.historical_digest || current.contract.digest !== divergence.live_digest) {
    return { unavailable: 'The compared authored inputs moved; inspect the WK again after movement settles before choosing an authored correction.',
      reobserve: candidateInspectionReadCall({ subject: wkId }, {
        information: 'After the compared authored inputs stop moving, observe current candidate status and the authored differences needed for a review decision. Inspection changes nothing.',
        requestSchemaAuthority }) };
  }
  const before = projectTerminalReviewUnit(historical.record);
  if (before.ok !== true) return unavailableContract(before.cause, 'candidate_work_record');
  const historicalContract = JSON.parse(before.contracts.canonical_parent_wk_contract);
  const liveContract = JSON.parse(current.contract.review_unit.canonical_parent_wk_contract);
  const differences = [];
  for (const row of divergence.differences) {
    const oldValue = atPointer(historicalContract, row.path);
    const newValue = atPointer(liveContract, row.path);
    if (!oldValue.present && !newValue.present) return {
      unavailable: `The authored values for changed field ${row.path} are unavailable in the compared contracts.`
    };
    differences.push({ ...row, ...(oldValue.present ? { before: oldValue.value } : {}),
      ...(newValue.present ? { after: newValue.value } : {}) });
  }
  return { differences };
}
