import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSelectedDerivedEvidence } from './initiative-status-evidence.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = process.cwd();
const INITIATIVE_STATUS_TAXONOMY_RELATIVE_PATH = 'packages/wiki-core/data/initiative-status-actions.v1.json';
const RUNTIME_BLOCKER_TAXONOMY_RELATIVE_PATH = 'packages/wiki-core/data/runtime-blocker-codes.v1.json';
const WORK_RECORDS_RELATIVE_DIR = 'wiki/work-records';
export const INITIATIVE_STATUS_ACTION_LIMIT = 5;
const DEFAULT_TOP_ACTION_LIMIT = INITIATIVE_STATUS_ACTION_LIMIT;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function sortStrings(values) {
  return uniqueStrings(values).sort((left, right) => left.localeCompare(right));
}

function resolveRepoPath(repoRoot, ...segments) {
  return path.resolve(repoRoot ?? DEFAULT_REPO_ROOT, ...segments);
}

function readJsonFile(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function walk(value, visitor, key = null, parent = null, pathParts = []) {
  visitor(value, key, parent, pathParts);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      walk(value[index], visitor, String(index), value, pathParts.concat(String(index)));
    }
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    walk(childValue, visitor, childKey, value, pathParts.concat(childKey));
  }
}

function normalizeRuntimeBlockerTaxonomy(raw) {
  const codes = [];

  walk(raw, (value, key) => {
    if (typeof value === 'string' && /code/i.test(String(key ?? ''))) {
      codes.push(value.trim());
      return;
    }

    if (Array.isArray(value) && /code/i.test(String(key ?? ''))) {
      for (const entry of value) {
        if (typeof entry === 'string' && entry.trim()) {
          codes.push(entry.trim());
        }
      }
    }
  });

  return sortStrings(codes);
}

function normalizeLocalReasonCodeEntry(entry) {
  if (!isPlainObject(entry)) {
    return null;
  }

  const code = asNonEmptyString(entry.code);
  if (!code) {
    return null;
  }

  return {
    ...entry,
    code,
    label: asNonEmptyString(entry.label) ?? null,
    default_action: asNonEmptyString(entry.default_action) ?? null,
    blocking: Boolean(entry.blocking),
    description: asNonEmptyString(entry.description) ?? null,
  };
}

function normalizeActionKindEntry(entry, reasonCodeEntriesByAction) {
  if (!isPlainObject(entry)) {
    return null;
  }

  const kind = asNonEmptyString(entry.kind);
  if (!kind) {
    return null;
  }

  const reasonCodeEntries = reasonCodeEntriesByAction.get(kind) ?? [];

  return {
    ...entry,
    kind,
    label: asNonEmptyString(entry.label) ?? null,
    suggested_tool: asNonEmptyString(entry.suggested_tool) ?? null,
    priority: asNonEmptyString(entry.priority) ?? 'medium',
    advisory_only: Boolean(entry.advisory_only ?? true),
    default_description: asNonEmptyString(entry.default_description) ?? null,
    verbose_description: asNonEmptyString(entry.verbose_description) ?? null,
    reason_code: reasonCodeEntries[0]?.code ?? null,
    reason_codes: reasonCodeEntries.map((reasonCodeEntry) => reasonCodeEntry.code),
  };
}

function buildReasonCodeEntriesByAction(localReasonCodeEntries) {
  const byAction = new Map();

  for (const entry of localReasonCodeEntries) {
    const actionKind = asNonEmptyString(entry.default_action);
    if (!actionKind) {
      continue;
    }

    const entries = byAction.get(actionKind) ?? [];
    entries.push(entry);
    byAction.set(actionKind, entries);
  }

  return byAction;
}

function loadInitiativeStatusTaxonomyFromDisk(repoRoot = DEFAULT_REPO_ROOT) {
  const taxonomyPath = resolveRepoPath(repoRoot, INITIATIVE_STATUS_TAXONOMY_RELATIVE_PATH);
  const raw = readJsonFile(taxonomyPath);
  const localReasonCodeEntries = Array.isArray(raw.local_reason_codes)
    ? raw.local_reason_codes.map((entry) => normalizeLocalReasonCodeEntry(entry)).filter(Boolean)
    : [];
  const reasonCodeEntriesByAction = buildReasonCodeEntriesByAction(localReasonCodeEntries);
  const actionKindEntries = Array.isArray(raw.action_kinds)
    ? raw.action_kinds.map((entry) => normalizeActionKindEntry(entry, reasonCodeEntriesByAction)).filter(Boolean)
    : [];
  const runtimeBlockerPath = resolveRepoPath(repoRoot, RUNTIME_BLOCKER_TAXONOMY_RELATIVE_PATH);
  const runtimeBlockerRaw = readJsonFile(runtimeBlockerPath);
  const runtimeBlockerCodes = normalizeRuntimeBlockerTaxonomy(runtimeBlockerRaw);
  const localReasonCodeStrings = localReasonCodeEntries.map((entry) => entry.code);
  const reasonCodeByDefaultAction = Object.fromEntries(
    [...reasonCodeEntriesByAction.entries()].map(([actionKind, entries]) => [
      actionKind,
      entries.map((entry) => entry.code),
    ]),
  );

  return {
    taxonomy_path: taxonomyPath,
    schema_version: asNonEmptyString(raw.schema_version) ?? 'initiative-status-actions.v1',
    raw,
    actions: actionKindEntries,
    action_kinds: actionKindEntries,
    localReasonCodes: localReasonCodeStrings,
    local_reason_codes: localReasonCodeEntries,
    reasonCodeVocabulary: localReasonCodeStrings,
    reason_code_vocabulary: localReasonCodeStrings,
    reason_code_by_default_action: reasonCodeByDefaultAction,
    reasonCodeByDefaultAction: reasonCodeByDefaultAction,
    runtimeBlockerCodes,
    runtime_blocker_codes: runtimeBlockerCodes,
    runtimeBlockerSource: runtimeBlockerPath,
  };
}

export function loadInitiativeStatusTaxonomy(options = {}) {
  const repoRoot = asNonEmptyString(options.repoRoot) ?? DEFAULT_REPO_ROOT;
  return loadInitiativeStatusTaxonomyFromDisk(repoRoot);
}

export const loadInitiativeStatusActions = loadInitiativeStatusTaxonomy;

function normalizeWorkRecord(raw) {
  if (!isPlainObject(raw)) {
    return null;
  }

  if (isPlainObject(raw.record) && asNonEmptyString(raw.record.id)) {
    return raw.record;
  }

  return raw;
}

function normalizeLoadedRecordEntry(entry) {
  if (!isPlainObject(entry)) {
    return null;
  }

  const record = normalizeWorkRecord(entry);
  if (!record) {
    return null;
  }

  return {
    source_path: asNonEmptyString(entry.source_path ?? entry.sourcePath) ?? null,
    raw: isPlainObject(entry.raw) ? entry.raw : entry,
    record,
  };
}

function isSliceAddress(unit) {
  return typeof unit === 'string' && unit.includes('#');
}

function splitUnitAddress(unit) {
  const [recordId, sliceId] = String(unit).split('#', 2);
  return {
    recordId: asNonEmptyString(recordId),
    sliceId: asNonEmptyString(sliceId),
  };
}

function findSliceById(root, sliceId) {
  let found = null;

  walk(root, (value) => {
    if (found || !isPlainObject(value)) {
      return;
    }

    if (asNonEmptyString(value.id) === sliceId) {
      found = value;
    }
  });

  return found;
}

function collectWorkRecordFiles(repoRoot) {
  return readdirSync(resolveRepoPath(repoRoot, WORK_RECORDS_RELATIVE_DIR), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(WORK_RECORDS_RELATIVE_DIR, entry.name));
}

function loadWorkRecordById(repoRoot, recordId) {
  const filePath = resolveRepoPath(repoRoot, WORK_RECORDS_RELATIVE_DIR, `${recordId}.json`);
  const raw = readJsonFile(filePath);
  return {
    source_path: filePath,
    raw,
    record: normalizeWorkRecord(raw),
  };
}

function getSelectionInfo(record, unit) {
  const recordId = asNonEmptyString(record?.id);
  const normalizedUnit = asNonEmptyString(unit) ?? recordId;

  if (!normalizedUnit) {
    return null;
  }

  if (!isSliceAddress(normalizedUnit)) {
    return {
      kind: 'record',
      address: normalizedUnit,
      record_id: recordId,
      slice_id: null,
      entry: record,
    };
  }

  const { recordId: addressRecordId, sliceId } = splitUnitAddress(normalizedUnit);
  if (!addressRecordId || !sliceId) {
    return null;
  }

  const slice = findSliceById(record, sliceId);
  return {
    kind: 'slice',
    address: normalizedUnit,
    record_id: recordId,
    slice_id: sliceId,
    entry: slice,
  };
}

function getStatus(node) {
  return asNonEmptyString(node?.status) ?? null;
}

function getWorkKind(node) {
  return asNonEmptyString(node?.work_kind) ?? asNonEmptyString(node?.workKind) ?? null;
}

function hasReviewRunReference(node) {
  if (!isPlainObject(node)) {
    return false;
  }

  const refs = [node.review_run_ref, node.reviewRunRef, node.review_run, node.reviewRun, node.review_run_handle, node.reviewRunHandle];
  return refs.some((ref) => {
    if (!isPlainObject(ref)) {
      return false;
    }

    return Boolean(asNonEmptyString(ref.monitor_handle) || asNonEmptyString(ref.run_id) || asNonEmptyString(ref.runId));
  });
}

function hasReviewResultEvidence(node) {
  if (!isPlainObject(node)) {
    return false;
  }

  const candidates = [
    node.review_result,
    node.reviewResult,
    node.review_result_evidence,
    node.reviewResultEvidence,
    node.review_completion,
    node.reviewCompletion,
    node.review_attestation,
    node.reviewAttestation,
  ];

  return candidates.some((candidate) => isPlainObject(candidate) || typeof candidate === 'string');
}

function getReviewOutcome(node) {
  if (!isPlainObject(node)) {
    return null;
  }

  const reviewObjects = [
    node.review_result,
    node.reviewResult,
    node.review_completion,
    node.reviewCompletion,
    node.review_attestation,
    node.reviewAttestation,
  ];

  for (const reviewObject of reviewObjects) {
    if (!isPlainObject(reviewObject)) {
      continue;
    }

    const outcome = asNonEmptyString(
      reviewObject.review_outcome ?? reviewObject.reviewOutcome ?? reviewObject.outcome ?? reviewObject.status ?? reviewObject.result,
    );
    if (outcome) {
      return outcome;
    }
  }

  return null;
}

function getDispatchIntent(node) {
  if (!isPlainObject(node)) {
    return null;
  }

  const dispatchIntent = node.dispatch_intent ?? node.dispatchIntent;
  if (!isPlainObject(dispatchIntent)) {
    return null;
  }

  return dispatchIntent;
}

function collectSelectedEvidence(selection, record) {
  return collectSelectedDerivedEvidence(selection, record);
}

function evidenceHasStructuredState(evidence, nameNeedles, stateNeedles) {
  for (const root of evidence) {
    let matched = false;
    walk(root, (value, key, _parent, pathParts) => {
      const keyText = String(key ?? '').toLowerCase();
      const pathText = pathParts.join('.').toLowerCase();
      const valueText = typeof value === 'string' ? value.toLowerCase() : '';
      const inScope = nameNeedles.some((needle) => keyText.includes(needle) || pathText.includes(needle));
      if (!inScope) {
        return;
      }
      matched ||=
        (value === true && /required|missing|stale|degraded|unavailable|incomplete/.test(keyText)) ||
        (value === false && /available|complete|fresh|present/.test(keyText)) ||
        (valueText && stateNeedles.some((needle) => valueText === needle || valueText.includes(`${needle}_`))) ||
        (Array.isArray(value) && value.length > 0 && /missing|incomplete|issue/.test(keyText)) ||
        (isPlainObject(value) && Object.keys(value).length > 0 && /missing|incomplete|issue/.test(keyText));
    });
    if (matched) {
      return true;
    }
  }
  return false;
}

function getRuntimeBlockerCodes(taxonomy, evidence) {
  const recognized = new Set(taxonomy.runtimeBlockerCodes ?? taxonomy.runtime_blocker_codes ?? []);
  const codeKeys = new Set(['decision_code', 'decision_codes', 'blocker_code', 'runtime_blocker_code']);
  const found = [];

  for (const root of evidence) {
    walk(root, (value, key) => {
      if (!codeKeys.has(String(key ?? ''))) {
        return;
      }
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        const code = asNonEmptyString(entry);
        if (code && recognized.has(code)) {
          found.push(code);
        }
      }
    });
  }

  return sortStrings(found);
}

function makeEvidenceAction(taxonomy, selection, needles, overrides) {
  const selected = findBestActionMatch(taxonomy, needles, overrides.reason_code);
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    target_unit: selection.address,
    priority: 'high',
    blocking: true,
    ...overrides,
  });
}

function getStructuredEvidenceAction(taxonomy, selection, record) {
  const evidence = collectSelectedEvidence(selection, record);
  const runtimeCodes = getRuntimeBlockerCodes(taxonomy, evidence);
  if (runtimeCodes.length > 0) {
    return makeEvidenceAction(taxonomy, selection, ['runtime', 'blocker'], {
      kind: 'resolve_runtime_blocker',
      suggested_tool: 'workspace_runtime_blocker_taxonomy',
      priority: 'critical',
      reason_code: 'runtime_blocker_present',
      summary: `Resolve structured runtime blocker evidence for ${selection.address}.`,
      runtime_blocker_code_refs: runtimeCodes,
    });
  }

  if (
    evidenceHasStructuredState(evidence, ['graph_impact', 'graph-impact'], ['missing', 'stale', 'degraded', 'unavailable', 'required'])
  ) {
    return makeEvidenceAction(taxonomy, selection, ['graph', 'impact'], {
      kind: 'record_graph_impact_evidence',
      suggested_tool: 'workspace_record_graph_impact_evidence',
      reason_code: 'graph_impact_evidence_needed',
      summary: 'Record or refresh selected-unit graph-impact evidence before continuing.',
    });
  }

  if (
    evidenceHasStructuredState(evidence, ['admission', 'metric'], ['missing', 'stale', 'incomplete']) ||
    evidence.some((entry) =>
      ['missing_metrics', 'missing_evidence', 'required_metric_missing', 'freshness_state', 'completeness_issues'].some((field) =>
        Object.prototype.hasOwnProperty.call(entry, field),
      ),
    )
  ) {
    return makeEvidenceAction(taxonomy, selection, ['admission', 'metrics'], {
      kind: 'refresh_admission_metrics',
      suggested_tool: 'workspace_work_record_refresh_admission_metrics',
      reason_code: 'admission_metrics_stale_or_missing',
      summary: 'Refresh selected-unit worker-admission metric evidence before continuing.',
    });
  }

  return null;
}

function findBestActionMatch(taxonomy, needles, fallbackReasonCode = null) {
  const normalizedNeedles = needles.map((needle) => needle.toLowerCase());
  const actions = taxonomy.actions ?? taxonomy.action_kinds ?? [];

  for (const needle of normalizedNeedles) {
    const exactMatch = actions.find((action) => {
      const haystack = [
        action.reason_code,
        action.kind,
        action.label,
        action.suggested_tool,
        action.summary,
        action.default_description,
        action.verbose_description,
      ]
        .filter(Boolean)
        .map((entry) => String(entry).toLowerCase());
      return haystack.some((entry) => entry.includes(needle));
    });

    if (exactMatch) {
      return exactMatch;
    }
  }

  if (fallbackReasonCode) {
    const byReasonCode = actions.find((action) => action.reason_code === fallbackReasonCode);
    if (byReasonCode) {
      return byReasonCode;
    }
  }

  return actions[0] ?? null;
}

function pickReasonCode(taxonomy, needles, fallbackIndex = 0) {
  const normalizedNeedles = needles.map((needle) => needle.toLowerCase()).filter(Boolean);
  const localReasonCodes = Array.isArray(taxonomy.local_reason_codes)
    ? taxonomy.local_reason_codes.map((entry) => asNonEmptyString(entry?.code)).filter(Boolean)
    : Array.isArray(taxonomy.localReasonCodes)
      ? taxonomy.localReasonCodes.map((entry) => asNonEmptyString(entry?.code ?? entry)).filter(Boolean)
      : [];

  for (const needle of normalizedNeedles) {
    const match = localReasonCodes.find((reasonCode) => String(reasonCode).toLowerCase().includes(needle));
    if (match) {
      return match;
    }
  }

  return localReasonCodes[fallbackIndex] ?? null;
}

function getDefaultReasonCodeForAction(taxonomy, actionKind) {
  const normalizedKind = asNonEmptyString(actionKind);
  if (!normalizedKind) {
    return null;
  }

  const reasonCodes = taxonomy.reason_code_by_default_action?.[normalizedKind];
  if (Array.isArray(reasonCodes) && reasonCodes.length > 0) {
    return asNonEmptyString(reasonCodes[0]) ?? null;
  }

  const reasonCodeEntry = Array.isArray(taxonomy.local_reason_codes)
    ? taxonomy.local_reason_codes.find((entry) => asNonEmptyString(entry.default_action) === normalizedKind)
    : null;

  return asNonEmptyString(reasonCodeEntry?.code) ?? null;
}

function normalizeActionFromTaxonomy(taxonomy, selectedAction, overrides = {}) {
  if (!selectedAction) {
    return null;
  }

  const fallbackReasonCode =
    asNonEmptyString(overrides.reason_code) ??
    asNonEmptyString(selectedAction.reason_code) ??
    asNonEmptyString(selectedAction.default_reason_code) ??
    getDefaultReasonCodeForAction(taxonomy, selectedAction.kind) ??
    asNonEmptyString(Array.isArray(selectedAction.reason_codes) ? selectedAction.reason_codes[0] : null) ??
    pickReasonCode(taxonomy, [selectedAction.kind, selectedAction.label, selectedAction.suggested_tool, selectedAction.summary].filter(Boolean)) ??
    pickReasonCode(taxonomy, ['action'], 0);

  const base = {
    reason_code: fallbackReasonCode,
    kind: overrides.kind ?? selectedAction.kind ?? 'action',
    suggested_tool: overrides.suggested_tool ?? selectedAction.suggested_tool ?? null,
    priority: overrides.priority ?? selectedAction.priority ?? 'medium',
    blocking: overrides.blocking ?? selectedAction.blocking ?? false,
    summary: overrides.summary ?? selectedAction.summary ?? null,
    target_unit: overrides.target_unit ?? null,
    target_role: overrides.target_role ?? null,
    evidence: overrides.evidence ?? undefined,
  };

  return base;
}

function makeRecordValidationAction(taxonomy, selection, overrides = {}) {
  const selected = findBestActionMatch(taxonomy, ['validate', 'record', 'invalid'], 'record_invalid');
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    kind: 'validate_record',
    suggested_tool: 'workspace_work_record_validate',
    target_unit: selection.address,
    priority: 'critical',
    blocking: true,
    summary: 'Validate the selected work record before continuing.',
    reason_code: 'record_invalid',
    ...overrides,
  });
}

function makeScopeMismatchAction(taxonomy, selection, overrides = {}) {
  const selected = findBestActionMatch(taxonomy, ['scope', 'split', 'broad', 'mismatch'], 'scope_mismatch');
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    kind: 'split_work',
    suggested_tool: 'workspace_work_record_upsert_slice',
    target_unit: selection.address,
    priority: 'critical',
    blocking: true,
    summary: 'The requested initiative and unit scope do not align; split or reselect the work.',
    reason_code: 'scope_mismatch',
    ...overrides,
  });
}

function makeNoAction(taxonomy, overrides = {}) {
  const selected = findBestActionMatch(taxonomy, ['no action', 'no_action', 'closed', 'complete'], null);
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    kind: 'no_action',
    suggested_tool: null,
    priority: 'low',
    blocking: false,
    reason_code: asNonEmptyString(overrides.reason_code) ?? 'no_pending_action',
    summary: 'No further coordinator action is needed.',
    ...overrides,
  });
}

function makeReviewDispatchAction(taxonomy, selection, overrides = {}) {
  const selected = findBestActionMatch(taxonomy, ['review', 'dispatch', 'reviewer'], null);
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    kind: 'dispatch_review',
    suggested_tool: 'workspace_agent_dispatch',
    target_unit: selection.address,
    target_role: 'reviewer',
    priority: 'high',
    blocking: true,
    reason_code: 'review_required',
    summary: 'Dispatch a reviewer for this unit.',
    ...overrides,
  });
}

function makeReviewStatusAction(taxonomy, selection, overrides = {}) {
  const selected = findBestActionMatch(taxonomy, ['review', 'status', 'inspect'], null);
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    kind: 'inspect',
    suggested_tool: 'workspace_agent_run_status',
    target_unit: selection.address,
    target_role: 'reviewer',
    priority: 'high',
    blocking: true,
    reason_code: 'review_result_ready',
    summary: 'Inspect the existing reviewer run status.',
    ...overrides,
  });
}

function makeDispatchValidationAction(taxonomy, selection, overrides = {}) {
  const selected = findBestActionMatch(taxonomy, ['validate', 'dispatch'], null);
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    kind: 'validate_dispatch',
    suggested_tool: 'workspace_validate_dispatch',
    target_unit: selection.address,
    priority: 'high',
    blocking: false,
    reason_code: 'record_needs_validation',
    summary: 'Validate dispatch readiness for this unit.',
    ...overrides,
  });
}

function makeSummaryAction(taxonomy, selection, overrides = {}) {
  const selected = findBestActionMatch(taxonomy, ['summary', 'inspect', 'status'], null);
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    kind: 'inspect',
    suggested_tool: 'workspace_work_record_summary',
    target_unit: selection.address,
    priority: 'medium',
    blocking: false,
    reason_code: 'record_needs_validation',
    summary: 'Inspect the work record summary for more context.',
    ...overrides,
  });
}

function makeCloseAction(taxonomy, selection, overrides = {}) {
  const selected = findBestActionMatch(taxonomy, ['close', 'complete', 'done'], null);
  const reasonCode = selection?.kind === 'slice' ? 'slice_ready_to_close' : 'parent_ready_to_close';
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    kind: selection?.kind === 'slice' ? 'mark_slice_done' : 'close_parent',
    suggested_tool: 'workspace_work_record_set_status',
    target_unit: selection.address,
    priority: 'medium',
    blocking: false,
    reason_code: reasonCode,
    summary: 'Mark the unit closed when closure conditions are satisfied.',
    ...overrides,
  });
}

function makeRemediationAction(taxonomy, selection, overrides = {}) {
  const selected = findBestActionMatch(taxonomy, ['remed', 'repair', 'fix', 'revise'], null);
  return normalizeActionFromTaxonomy(taxonomy, selected, {
    kind: 'create_remediation_slice',
    suggested_tool: 'workspace_work_record_summary',
    target_unit: selection.address,
    priority: 'high',
    blocking: true,
    reason_code: 'remediation_required',
    summary: 'Remediate the selected unit before retrying review or closure.',
    ...overrides,
  });
}

function deriveActionForSelection(taxonomy, selection, { initiativeMismatch = false, record = null } = {}) {
  if (!selection?.entry) {
    return makeRecordValidationAction(taxonomy, selection ?? { address: null }, {
      target_unit: selection?.address ?? null,
      summary: 'Selected unit could not be resolved in the canonical work record.',
    });
  }

  if (initiativeMismatch) {
    return makeScopeMismatchAction(taxonomy, selection, {
      target_unit: selection.address,
      summary: `Selected unit ${selection.address} does not belong to the requested initiative.`,
    });
  }

  const status = getStatus(selection.entry);
  const workKind = getWorkKind(selection.entry);
  const reviewRunExists = hasReviewRunReference(selection.entry) || hasReviewRunReference(record ?? selection.entry);
  const reviewEvidenceExists = hasReviewResultEvidence(selection.entry) || hasReviewResultEvidence(record ?? selection.entry);
  const reviewOutcome = getReviewOutcome(selection.entry) ?? getReviewOutcome(record ?? selection.entry);

  const structuredEvidenceAction = getStructuredEvidenceAction(taxonomy, selection, record ?? selection.entry);
  if (structuredEvidenceAction) {
    return structuredEvidenceAction;
  }

  if (workKind === 'review' || status === 'review') {
    if (!reviewRunExists) {
      return makeReviewDispatchAction(taxonomy, selection, {
        summary: 'No reviewer run exists yet; dispatch review or inspect reviewer readiness first.',
      });
    }

    if (!reviewEvidenceExists) {
      return makeReviewStatusAction(taxonomy, selection, {
        summary: 'A reviewer run exists; inspect its status before any attestation write path.',
      });
    }

    if (reviewOutcome && reviewOutcome.toLowerCase() !== 'accepted') {
      return makeRemediationAction(taxonomy, selection, {
        summary: 'Review produced a non-accepted outcome; remediate before any completion step.',
      });
    }

    return makeCloseAction(taxonomy, selection, {
      summary: 'Reviewer evidence is present; close out the unit if the record is otherwise complete.',
    });
  }

  if (status === 'blocked') {
    return makeSummaryAction(taxonomy, selection, {
      blocking: true,
      priority: 'high',
      summary: 'The selected unit is blocked; inspect the record and blockers before retrying.',
    });
  }

  if (status === 'todo' || status === 'active' || status === 'inbox') {
    const dispatchIntent = getDispatchIntent(selection.entry);
    if (dispatchIntent && asNonEmptyString(dispatchIntent.target_unit) && dispatchIntent.target_unit !== 'none') {
      return makeDispatchValidationAction(taxonomy, selection, {
        summary: 'Validate dispatch readiness before launching the selected unit.',
      });
    }

    return makeSummaryAction(taxonomy, selection, {
      summary: 'Inspect the record summary for the next coordinator step.',
    });
  }

  if (status === 'done' || status === 'cancelled' || status === 'parked') {
    return makeNoAction(taxonomy, {
      target_unit: selection.address,
      reason_code: 'closed_or_inactive',
      summary: 'The selected unit is already in a terminal or parked state.',
    });
  }

  return makeSummaryAction(taxonomy, selection, {
    summary: 'Inspect the work record summary to determine the next step.',
  });
}

function loadRelevantRecords(repoRoot, initiative) {
  const recordFiles = collectWorkRecordFiles(repoRoot);
  const loaded = [];

  for (const relativePath of recordFiles) {
    const sourcePath = resolveRepoPath(repoRoot, relativePath);
    const raw = readJsonFile(sourcePath);
    const record = normalizeWorkRecord(raw);
    const recordInitiative = asNonEmptyString(record?.initiative ?? raw?.initiative);

    if (initiative && recordInitiative !== initiative) {
      continue;
    }

    loaded.push(normalizeLoadedRecordEntry({ source_path: sourcePath, raw, record }));
  }

  return loaded.filter(Boolean);
}

export function loadInitiativeStatusRecords(options = {}) {
  const repoRoot = asNonEmptyString(options.repoRoot) ?? DEFAULT_REPO_ROOT;
  const initiative = asNonEmptyString(options.initiative);
  return loadRelevantRecords(repoRoot, initiative);
}

export function readInitiativeStatusRecord(options = {}) {
  const repoRoot = asNonEmptyString(options.repoRoot) ?? DEFAULT_REPO_ROOT;
  const unit = asNonEmptyString(options.unit);

  if (!unit) {
    return null;
  }

  const { recordId } = splitUnitAddress(unit);
  if (!recordId) {
    return null;
  }

  try {
    return loadWorkRecordById(repoRoot, recordId).record;
  } catch {
    return null;
  }
}

function collectOpenUnitEntries(records) {
  const units = [];
  const consistency = [];
  const consistencySeen = new Set();

  for (const { record } of records) {
    if (!record || !asNonEmptyString(record.id)) {
      continue;
    }

    const recordStatus = getStatus(record);

    const parentTerminal = recordStatus === 'done' || recordStatus === 'cancelled';
    if (recordStatus !== 'done' && recordStatus !== 'cancelled' && recordStatus !== 'parked') {
      units.push({
        kind: 'record',
        address: record.id,
        record_id: record.id,
        slice_id: null,
        entry: record,
        record,
      });
    }

    const sliceArrays = [
      record.slices,
      record.working_slices,
      record.review_slices,
      record.sections?.slices,
      record.sections?.working_slices,
    ];

    for (const sliceArray of sliceArrays) {
      if (!Array.isArray(sliceArray)) {
        continue;
      }

      for (const slice of sliceArray) {
        if (!isPlainObject(slice) || !asNonEmptyString(slice.id)) {
          continue;
        }

        const sliceStatus = getStatus(slice);
        if (sliceStatus === 'done' || sliceStatus === 'cancelled' || sliceStatus === 'parked') {
          continue;
        }

        if (parentTerminal) {
          const consistencyKey = `${record.id}#${slice.id}`;
          if (!consistencySeen.has(consistencyKey)) {
            consistencySeen.add(consistencyKey);
            consistency.push({
              kind: 'open_slice_under_terminal_parent',
              address: consistencyKey,
              record_id: record.id,
              slice_id: slice.id,
              record_status: recordStatus,
              slice_status: sliceStatus,
              priority: 'low',
            });
          }
          continue;
        }

        units.push({
          kind: 'slice',
          address: `${record.id}#${slice.id}`,
          record_id: record.id,
          slice_id: slice.id,
          entry: slice,
          record,
        });
      }
    }
  }

  return { units, consistency };
}

function summarizeCounts(units) {
  const counts = {
    total: units.length,
    todo: 0,
    active: 0,
    review: 0,
    blocked: 0,
    done: 0,
    other: 0,
  };

  for (const unit of units) {
    const status = getStatus(unit.entry) ?? 'other';
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    } else {
      counts.other += 1;
    }
  }

  return counts;
}

function compareActions(left, right) {
  const priorityRank = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
  const leftPriority = priorityRank[left.priority] ?? 1;
  const rightPriority = priorityRank[right.priority] ?? 1;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  if (Boolean(left.blocking) !== Boolean(right.blocking)) {
    return left.blocking ? -1 : 1;
  }

  return String(left.target_unit ?? '').localeCompare(String(right.target_unit ?? ''));
}

function compactTopActions(actions, limit = DEFAULT_TOP_ACTION_LIMIT) {
  return actions.slice(0, limit);
}

function createActionCandidateSummary(selection, action, record) {
  return {
    id: selection.address,
    kind: action.kind,
    target_unit: action.target_unit ?? selection.address,
    reason_code: action.reason_code,
    suggested_tool: action.suggested_tool,
    target_role: action.target_role ?? null,
    priority: action.priority,
    blocking: Boolean(action.blocking),
    summary: action.summary ?? null,
    record_id: record?.id ?? selection.record_id ?? null,
  };
}

export function deriveInitiativeStatus(options = {}) {
  const repoRoot = asNonEmptyString(options.repoRoot) ?? DEFAULT_REPO_ROOT;
  const initiative = asNonEmptyString(options.initiative);
  const unit = asNonEmptyString(options.unit);
  const verbose = Boolean(options.verbose);
  const selectedActionId = asNonEmptyString(options.selectedActionId ?? options.selected_action_id);
  const topActionLimitRaw = Number(options.topActionLimit ?? options.top_action_limit ?? options.top_actions_limit ?? DEFAULT_TOP_ACTION_LIMIT);
  const topActionLimit = Number.isFinite(topActionLimitRaw) && topActionLimitRaw > 0 ? Math.trunc(topActionLimitRaw) : DEFAULT_TOP_ACTION_LIMIT;
  const taxonomy = isPlainObject(options.taxonomy) ? options.taxonomy : loadInitiativeStatusTaxonomy({ repoRoot });
  const providedRecords = Array.isArray(options.records) ? options.records.map(normalizeLoadedRecordEntry).filter(Boolean) : null;

  let selection = null;
  let selectedRecord = null;
  let initiativeMismatch = false;

  if (unit) {
    const { recordId, sliceId } = splitUnitAddress(unit);
    if (!recordId) {
      return {
        schema_version: 'initiative-status.v1',
        scope: { initiative, unit },
        counts: { total: 0, todo: 0, active: 0, review: 0, blocked: 0, done: 0, other: 0 },
        top_actions: [
          makeRecordValidationAction(taxonomy, { address: unit }, {
            target_unit: unit,
            summary: 'The selected unit address is malformed.',
          }),
        ],
        next_action: makeRecordValidationAction(taxonomy, { address: unit }, {
          target_unit: unit,
          summary: 'The selected unit address is malformed.',
        }),
        truncated: false,
      };
    }

    const providedRecordEntry = providedRecords?.find(
      (entry) => asNonEmptyString(entry.record?.id) === recordId || asNonEmptyString(entry.record_id) === recordId,
    );

    if (providedRecordEntry?.record) {
      selectedRecord = providedRecordEntry.record;
      selection = getSelectionInfo(providedRecordEntry.record, unit);
    } else {
      try {
        const loaded = loadWorkRecordById(repoRoot, recordId);
        selectedRecord = loaded.record;
        selection = getSelectionInfo(loaded.record, unit);
      } catch (error) {
        return {
          schema_version: 'initiative-status.v1',
          scope: { initiative, unit },
          counts: { total: 0, todo: 0, active: 0, review: 0, blocked: 0, done: 0, other: 0 },
          top_actions: [
            makeRecordValidationAction(taxonomy, { address: unit }, {
              target_unit: unit,
              summary: `Unable to load the selected unit record: ${error instanceof Error ? error.message : String(error)}`,
            }),
          ],
          next_action: makeRecordValidationAction(taxonomy, { address: unit }, {
            target_unit: unit,
            summary: `Unable to load the selected unit record: ${error instanceof Error ? error.message : String(error)}`,
          }),
          truncated: false,
        };
      }
    }

    if (!selection?.entry && sliceId) {
      selection = {
        kind: 'slice',
        address: unit,
        record_id: asNonEmptyString(selectedRecord?.id) ?? recordId,
        slice_id: sliceId,
        entry: null,
      };
    }

    const recordInitiative = asNonEmptyString(selectedRecord?.initiative ?? providedRecordEntry?.raw?.initiative);
    initiativeMismatch = Boolean(initiative && recordInitiative && recordInitiative !== initiative);
  }

  const records = unit
    ? [normalizeLoadedRecordEntry({ source_path: null, raw: selectedRecord, record: selectedRecord })].filter(Boolean)
    : providedRecords ?? loadRelevantRecords(repoRoot, initiative);

  const scan = unit ? null : collectOpenUnitEntries(records);
  const openUnits = unit ? [selection].filter(Boolean) : scan.units;
  const consistency = unit ? [] : scan.consistency;
  const counts = summarizeCounts(openUnits);

  const actions = [];
  if (unit && selection) {
    const action = deriveActionForSelection(taxonomy, selection, {
      initiativeMismatch,
      record: selectedRecord,
    });
    actions.push(createActionCandidateSummary(selection, action, selectedRecord));
  } else {
    for (const candidate of openUnits) {
      const action = deriveActionForSelection(taxonomy, candidate, { record: candidate.record });
      actions.push(createActionCandidateSummary(candidate, action, candidate.record));
    }
  }

  actions.sort(compareActions);
  if (selectedActionId) {
    const selectedActionIndex = actions.findIndex((action) => {
      const candidates = [action.id, action.target_unit, action.record_id].filter(Boolean).map((value) => String(value));
      return candidates.some((candidate) => candidate === selectedActionId);
    });

    if (selectedActionIndex > 0) {
      const [selectedAction] = actions.splice(selectedActionIndex, 1);
      actions.unshift(selectedAction);
    }
  }

  const topActions = compactTopActions(actions, topActionLimit);
  const nextAction = topActions[0] ?? makeNoAction(taxonomy, { target_unit: unit ?? initiative ?? null });

  const result = {
    schema_version: 'initiative-status.v1',
    scope: {
      initiative: initiative ?? null,
      unit: unit ?? null,
    },
    counts,
    top_actions: topActions,
    next_action: nextAction,
    truncated: actions.length > topActions.length,
  };

  if (!unit) {
    result.consistency = consistency;
  }

  if (verbose) {
    result.evidence = {
      taxonomy_path: taxonomy.taxonomy_path,
      runtime_blocker_source: taxonomy.runtimeBlockerSource,
      local_reason_codes: taxonomy.localReasonCodes,
      unit_resolved: Boolean(selection?.entry),
      initiative_mismatch: initiativeMismatch,
      selected_record_id: selectedRecord?.id ?? null,
    };
  }

  return result;
}

export function workspaceInitiativeStatus(options = {}) {
  return deriveInitiativeStatus(options);
}

export const initiativeStatus = workspaceInitiativeStatus;
export const getInitiativeStatus = workspaceInitiativeStatus;

export default {
  INITIATIVE_STATUS_ACTION_LIMIT,
  loadInitiativeStatusTaxonomy,
  loadInitiativeStatusActions,
  loadInitiativeStatusRecords,
  readInitiativeStatusRecord,
  deriveInitiativeStatus,
  workspaceInitiativeStatus,
  initiativeStatus,
  getInitiativeStatus,
};
