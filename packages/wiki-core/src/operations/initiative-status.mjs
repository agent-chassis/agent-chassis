import {
  deriveInitiativeStatus,
  loadInitiativeStatusRecords,
  loadInitiativeStatusTaxonomy,
  readInitiativeStatusRecord,
  INITIATIVE_STATUS_ACTION_LIMIT,
} from '../lib/initiative-status.mjs';
import { loadKindRecordById } from '../lib/kind-record-store.mjs';

function initiativeStatusRefusal(code, message) {
  const error = new Error(message);
  error.name = 'InitiativeStatusError';
  error.code = code;
  error.envelope = Object.freeze({
    schema_version: 'initiative-status-refusal.v1',
    ok: false,
    cause: Object.freeze({
      code,
      message,
    }),
    next_calls: Object.freeze([Object.freeze({
      tool: 'workspace_search_repo',
      arguments: Object.freeze({ query: 'record_kind initiative', kind: 'wiki' }),
      recommended: true,
    })]),
  });
  return error;
}

function requireLoadedInitiative(loaded) {
  if (loaded?.record_kind !== 'initiative') {
    throw initiativeStatusRefusal(
      'initiative_identity_invalid',
      'Initiative must be one canonical IN-#### identity',
    );
  }
  if (loaded?.classification === 'loaded' && loaded.record_kind === 'initiative') {
    return loaded.record;
  }
  if (loaded?.classification === 'missing') {
    throw initiativeStatusRefusal(
      'initiative_not_found',
      'The requested canonical initiative record does not exist',
    );
  }
  if (loaded?.classification === 'invalid_identity') {
    throw initiativeStatusRefusal(
      'initiative_identity_invalid',
      'Initiative must be one canonical IN-#### identity',
    );
  }
  throw initiativeStatusRefusal(
    'initiative_record_invalid',
    'The requested canonical initiative record is malformed or identity-mismatched',
  );
}

function resolveRepoRoot(input = {}) {
  const repoAlias = typeof input.repo === 'string' && /[\\/]/.test(input.repo) ? input.repo : null;
  return (
    input.repoRoot ??
    input.repo_root ??
    repoAlias ??
    input.root ??
    input.workspaceRoot ??
    input.workspace_root ??
    null
  );
}

function resolveTopActionLimit(input = {}) {
  const raw = input.topActionLimit ?? input.top_action_limit ?? input.top_actions_limit ?? input.limit ?? null;
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  return INITIATIVE_STATUS_ACTION_LIMIT;
}

function loadRecordsForScope({ repoRoot, initiative, unit, records }) {
  if (Array.isArray(records)) {
    const selectedUnit = unit ? unit.match(/^(WK-\d{4})/)?.[1] ?? null : null;
    return records.filter((record) => {
      const canonical = record.record && typeof record.record === 'object' ? record.record : record;
      const recordId = String(canonical.id ?? record.id ?? '').trim();
      const recordInitiative = String(canonical.initiative ?? record.initiative ?? '').trim();
      if (selectedUnit && recordId !== selectedUnit) {
        return false;
      }
      if (!selectedUnit && initiative && recordInitiative !== initiative) {
        return false;
      }
      return true;
    });
  }

  if (unit) {
    const record = readInitiativeStatusRecord({ repoRoot, unit });
    return record ? [record] : [];
  }

  const allRecords = loadInitiativeStatusRecords({ repoRoot });
  if (!initiative) {
    return allRecords;
  }

  return allRecords.filter((record) => {
    const canonical = record.record && typeof record.record === 'object' ? record.record : record;
    return String(canonical.initiative ?? record.initiative ?? '').trim() === initiative;
  });
}

export function runInitiativeStatus(input = {}) {
  const repoRoot = resolveRepoRoot(input) ?? undefined;
  const initiative = input.initiative ?? input.initiative_id ?? null;
  const unit = input.unit ?? input.selectedUnit ?? input.selected_unit ?? null;
  const verbose = Boolean(input.verbose ?? input.includeEvidence ?? input.include_evidence ?? false);
  const selectedActionId = input.selectedActionId ?? input.selected_action_id ?? null;
  const topActionLimit = resolveTopActionLimit(input);
  const taxonomy = input.taxonomy ?? loadInitiativeStatusTaxonomy({ repoRoot });
  const derive = (initiativeRecord = input.initiative_record ?? input.initiativeRecord ?? null) => deriveInitiativeStatus({
    initiative,
    initiativeRecord,
    unit,
    records: loadRecordsForScope({ repoRoot, initiative, unit, records: input.records }),
    taxonomy,
    verbose,
    selectedActionId,
    topActionLimit,
  });

  if (initiative && !Array.isArray(input.records)) {
    return loadKindRecordById({ repoRoot, id: initiative }).then((loaded) => {
      const initiativeRecord = requireLoadedInitiative(loaded);
      return derive(initiativeRecord);
    });
  }
  return derive();
}

export function workspaceInitiativeStatus(input = {}) {
  return runInitiativeStatus(input);
}

export function getInitiativeStatus(input = {}) {
  return runInitiativeStatus(input);
}
