

import { loadAdmittedProofPackMeaning, loadExactAdmittedProofPackMeaning, readProofPackCatalog }
  from './admitted-proof-packs.mjs';
import { deepFreeze } from './deterministic-projection-primitives.mjs';
import { PROOF_AUTHORING_FIELDS, PROOF_EXCEPTION_ACTIONS, validateProofAuthoringAmendment as validateAmendment,
  validateProofExceptionRationale } from './obligation-coverage-carrier.mjs';

import { OBLIGATION_COVERAGE_UPSERT_TOOL, ProofAuthoringError, assertProofAuthoringDraft,
  registeredRecoveryInstruction } from './proof-contract.mjs';
import { FIND_PROOFS_TASK } from './proof-discovery-task.mjs';

export { ProofAuthoringError, assertProofAuthoringDraft };
const pinFields = Object.freeze(['profile_digest', 'parameter_contract_digest', 'admission_digest']);
export { PROOF_AUTHORING_FIELDS, PROOF_AUTHORING_FIELD_SCHEMAS, PROOF_EXCEPTION_ACTIONS,
  PROOF_EXCEPTION_RATIONALE_SCHEMA } from './obligation-coverage-carrier.mjs';

export async function pinProofSelection(proofName, {
  catalog = readProofPackCatalog, load = loadAdmittedProofPackMeaning
} = {}) {
  const current = await catalog();

  if (!current.packs.some(pack => pack.profile_id === proofName)) throw new ProofAuthoringError(
    'proof_name_unknown', `proof_name ${JSON.stringify(proofName)} is not a proof catalog entry; ` +
      'select an exact catalog name or omit proof_name', {
      phase: 'request', field: 'proof_name', proof_name: proofName
    });
  const pack = await load(proofName);
  return deepFreeze({ proof_name: pack.profile.profile_id,
    proof_version: pack.profile.profile_version,
    ...Object.fromEntries(pinFields.map(key => [key, pack[key]])) });
}

const SELECTION_SAVE = registeredRecoveryInstruction({ route: OBLIGATION_COVERAGE_UPSERT_TOOL });

export async function loadPinnedProofSelection(selection, {
  loadExact = loadExactAdmittedProofPackMeaning
} = {}) {
  if (!selection?.proof_name) throw new ProofAuthoringError('proof_unselected',
    `No proof is selected. ${FIND_PROOFS_TASK} lists candidates for the caller's own property query and ` +
      `selects none; the caller chooses proof.name. ${SELECTION_SAVE}`,
    { field: 'proof_name', discovery_input: 'query' });
  if (selection.proof_version === null) throw new ProofAuthoringError('proof_unpinned',
    `The saved proof name has no admitted pin. ${FIND_PROOFS_TASK} reads that proof_name; the caller supplies ` +
      `an exact catalog name as proof.name. ${SELECTION_SAVE} Removing the selection instead uses changes.remove.obligations.`,
    { field: 'proof_name', proof_name: selection.proof_name, discovery_input: 'proof_name' });
  const pack = await loadExact({ profileId: selection.proof_name,
    profileVersion: selection.proof_version });
  for (const key of pinFields) if (pack[key] !== selection[key]) throw new ProofAuthoringError(
    'definition_integrity_mismatch', 'The exact definition differs from the saved pin', {
      field: key, expected: selection[key], actual: pack[key]
    });
  return pack;
}

async function amendRow(content, rowIndex, obligationId, changes, owners) {
  if (!validateAmendment(changes)) throw new ProofAuthoringError('request_invalid',
    'Amendment fields must satisfy the closed request schema', {
      phase: 'request', issues: structuredClone(validateAmendment.errors)
    });
  const unsupported = Object.keys(changes).filter(key => !PROOF_AUTHORING_FIELDS.includes(key));
  if (unsupported.length) throw new ProofAuthoringError('request_invalid',
    'Unsupported amendment fields', { phase: 'request', fields: unsupported });
  const overlap = (changes.clear_parameters ?? []).filter(name => Object.hasOwn(changes.parameters ?? {}, name));
  if (overlap.length) throw new ProofAuthoringError('request_invalid',
    'A parameter cannot be set and cleared in the same amendment', {
      phase: 'request', fields: overlap, field: 'clear_parameters'
    });
  let row = rowIndex.get(obligationId);
  if (!row) {
    row = { obligation_id: obligationId };
    content.obligations.push(row);
    rowIndex.set(obligationId, row);
  }
  for (const key of ['statement', 'controlled_contract_node_ids', 'mechanism']) {
    if (!Object.hasOwn(changes, key)) continue;
    if (key === 'mechanism' && changes[key] === null) delete row[key];
    else row[key] = structuredClone(changes[key]);
  }
  if (Object.hasOwn(changes, 'acceptance_criteria')) {
    if (changes.acceptance_criteria.length === 0) delete row.acceptance_criteria;
    else {
      if (typeof owners.criteria !== 'function') throw new ProofAuthoringError('request_invalid',
        'Acceptance-criterion associations need the selected unit\'s criteria', { phase: 'request',
          field: 'acceptance_criteria' });
      row.acceptance_criteria = owners.criteria(changes.acceptance_criteria, obligationId);
    }
  }
  if (changes.refresh_proof_version === true && !(changes.proof_name ?? row.selection?.proof_name)) {
    throw new ProofAuthoringError('proof_unselected', 'Select a proof name before refreshing its version', { phase: 'request' });
  }
  const selecting = Object.hasOwn(changes, 'proof_name') || Object.keys(changes.parameters ?? {}).length > 0 ||
    row.selection !== undefined && ['parameters', 'clear_parameters', 'refresh_proof_version']
      .some(key => Object.hasOwn(changes, key));
  if (selecting) {
    const selection = row.selection ?? { proof_name: null, proof_version: null,
      profile_digest: null, parameter_contract_digest: null, admission_digest: null, parameters: {} };
    const name = changes.proof_name ?? selection.proof_name;
    const repin = changes.refresh_proof_version === true || Object.hasOwn(changes, 'proof_name') &&
      (name !== selection.proof_name || selection.proof_version === null);
    if (repin && name !== null) Object.assign(selection, await owners.pin(name));
    for (const [key, value] of Object.entries(changes.parameters ?? {})) Object.defineProperty(
      selection.parameters, key, { value: structuredClone(value), enumerable: true, configurable: true, writable: true });
    for (const key of changes.clear_parameters ?? []) delete selection.parameters[key];
    row.selection = selection;
  }
  assertNoProofExceptionConflict(row, obligationId);
  return row;
}

function assertNoProofExceptionConflict(row, obligationId) {
  if (row.proof_opt_out !== true || (row.selection === undefined && row.case_id === undefined)) return;
  throw new ProofAuthoringError('proof_opt_out_conflict',
    'An obligation cannot both decline proof and keep a proof selection or case', {
      phase: 'request', field: 'proof_opt_out', obligation_id: obligationId,
      holds: { proof_opt_out: true, selection: row.selection !== undefined, case_id: row.case_id ?? null },
      correction: 'Keep one decision. The saved proof selection or case is removed only by its own explicit ' +
        'removal; a recorded proof exception is withdrawn only by its own explicit withdrawal.'
    });
}

export function applyProofAuthoringException(source, obligationId, { action, rationale } = {}) {
  if (!PROOF_EXCEPTION_ACTIONS.includes(action)) throw new ProofAuthoringError('request_invalid',
    'A proof exception is applied or withdrawn', { phase: 'request', field: 'action' });
  const content = structuredClone(assertProofAuthoringDraft(source));
  const row = content.obligations.find(value => value.obligation_id === obligationId);
  if (!row) throw new ProofAuthoringError('obligation_not_found', 'The obligation does not exist',
    { phase: 'request', obligation_id: obligationId });
  if (action === 'withdraw') {
    if (rationale !== undefined) throw new ProofAuthoringError('request_invalid',
      'Withdrawing a proof exception takes no rationale', { phase: 'request', field: 'rationale' });
    delete row.proof_opt_out;
    delete row.proof_opt_out_rationale;
    return assertProofAuthoringDraft(content);
  }
  if (!validateProofExceptionRationale(rationale)) throw new ProofAuthoringError('request_invalid',
    'A proof exception states a trimmed, nonempty rationale', { phase: 'request', field: 'rationale',
      issues: structuredClone(validateProofExceptionRationale.errors ?? []) });
  row.proof_opt_out = true;
  row.proof_opt_out_rationale = rationale;
  assertNoProofExceptionConflict(row, obligationId);
  return assertProofAuthoringDraft(content);
}

export async function upsertProofAuthoringSelection(source, obligations, owners = {}) {
  if (!Array.isArray(obligations) || obligations.length === 0 ||
      new Set(obligations.map(row => row?.obligation_id)).size !== obligations.length) {
    throw new ProofAuthoringError('request_invalid', 'Supply a nonempty list of unique obligation identities');
  }
  const content = structuredClone(assertProofAuthoringDraft(source));
  const rowIndex = new Map(content.obligations.map(row => [row.obligation_id, row]));
  const pins = new Map();
  const batchOwners = { pin: async name => {
    if (!pins.has(name)) pins.set(name, pinProofSelection(name, owners));
    return pins.get(name);
  }, criteria: owners.criteria };
  for (const item of obligations) {
    const { obligation_id, ...changes } = item;
    await amendRow(content, rowIndex, obligation_id, changes, batchOwners);
  }
  content.obligations.sort((a, b) => a.obligation_id < b.obligation_id ? -1 : a.obligation_id > b.obligation_id ? 1 : 0);
  return assertProofAuthoringDraft(content);
}

export function removeProofAuthoringSelection(source, obligationId) {
  const content = structuredClone(assertProofAuthoringDraft(source));
  const row = content.obligations.find(value => value.obligation_id === obligationId);
  if (!row) throw new ProofAuthoringError('obligation_not_found', 'The obligation does not exist',
    { obligation_id: obligationId });
  delete row.selection;
  delete row.case_id;
  return assertProofAuthoringDraft(content);
}
