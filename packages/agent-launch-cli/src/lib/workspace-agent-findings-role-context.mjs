import { readFile } from 'node:fs/promises';

import { SLICE_ID_PATTERN } from '@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs';
import {
  validateAcceptanceCriterionEntry,
} from '@agent-chassis/wiki-core/src/lib/work-record-schema-validators.mjs';
import {
  projectWorkRecordTestProofValidation,
  renderWorkRecordValidationEntry,
} from '@agent-chassis/wiki-core/src/lib/work-record-test-proof-bindings.mjs';

import { LauncherRoleContractError } from './workspace-agent-role-contract.mjs';
import { digestTrustedExactReviewEvidence } from
  './workspace-agent-dispatch-run-receipt.mjs';

const WK_ID_RE = /^WK-(\d{4})$/;
const MAX_DIAGNOSTIC_ITEMS = 6;
export const FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION =
  'workspace-agent-frozen-findings-only-acceptance-contract.v1';
export const FROZEN_STANDALONE_FINDINGS_ACCEPTANCE_CONTRACT_SCHEMA_VERSION =
  'workspace-agent-frozen-standalone-findings-acceptance-contract.v1';

export const FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION =
  'workspace-agent-frozen-slice-level-findings-only-acceptance-contract.v1';
export const ADVISORY_REVIEW_PRESENTATION_SCHEMA_VERSION =
  'workspace-agent-advisory-review-presentation.v1';

function truncateList(values, limit = MAX_DIAGNOSTIC_ITEMS) {
  if (!Array.isArray(values)) {
    return [];
  }

  if (values.length <= limit) {
    return values.slice();
  }

  const items = values.slice(0, limit);
  items.push(`...${values.length - limit} more`);
  return items;
}

function normalizeText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();
  return text ? text : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRecordId(value) {
  const text = normalizeText(value);
  if (!text || !WK_ID_RE.test(text)) {
    return null;
  }

  return text;
}

function normalizeSliceId(value) {
  const text = normalizeText(value);
  if (!text || !SLICE_ID_PATTERN.test(text)) {
    return null;
  }

  return text;
}

function parseAddress(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const [recordId, sliceId, ...rest] = text.split('#');
  if (rest.length > 0) {
    return null;
  }

  const normalizedRecordId = normalizeRecordId(recordId);
  if (!normalizedRecordId) {
    return null;
  }

  if (sliceId == null) {
    return {
      kind: 'work_item',
      address: normalizedRecordId,
      recordId: normalizedRecordId,
      sliceId: null,
    };
  }

  const normalizedSliceId = normalizeSliceId(sliceId);
  if (!normalizedSliceId) {
    return null;
  }

  return {
    kind: 'slice',
    address: `${normalizedRecordId}#${normalizedSliceId}`,
    recordId: normalizedRecordId,
    sliceId: normalizedSliceId,
  };
}

function normalizeUnitLike(value) {
  if (typeof value === 'string') {
    return parseAddress(value);
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const address = normalizeText(value.address ?? value.unit ?? value.id);
  const recordId = normalizeRecordId(value.recordId ?? value.record_id ?? value.record);
  const sliceId = normalizeSliceId(value.sliceId ?? value.slice_id ?? value.slice);

  if (address) {
    const parsed = parseAddress(address);
    if (!parsed) {
      return null;
    }

    if (recordId && parsed.recordId !== recordId) {
      return null;
    }

    if (sliceId && parsed.sliceId !== sliceId) {
      return null;
    }

    return parsed;
  }

  if (!recordId) {
    return null;
  }

  if (!sliceId) {
    return {
      kind: 'work_item',
      address: recordId,
      recordId,
      sliceId: null,
    };
  }

  return {
    kind: 'slice',
    address: `${recordId}#${sliceId}`,
    recordId,
    sliceId,
  };
}

function normalizeUnit(value) {
  const unit = normalizeUnitLike(value);
  if (!unit) {
    return null;
  }

  return {
    ...unit,
    kind: unit.kind === 'slice' ? 'slice' : 'work_item',
  };
}

function parseSelectedUnit(value) {
  if (value == null || value === '') {
    return { unit: null, state: 'missing' };
  }

  const unit = normalizeUnit(value);
  if (!unit) {
    return { unit: null, state: 'invalid' };
  }

  return { unit, state: 'valid' };
}

function sameSelectedUnit(subject, selectedUnit) {
  if (!subject || !selectedUnit) {
    return false;
  }

  return subject.address === selectedUnit.address;
}

function resolveContextAcceptance(section, unitLabel) {
  const classified = classifyFindingsAcceptanceSection(section);
  if (classified.state !== 'valid') {
    return {
      value: null,
      state: classified.state,
      detail: classified.detail ?? 'acceptance_section_empty',
    };
  }

  return {
    value: {
      unitLabel,
      criteria: classified.criteria,
      validation: classified.validation,
    },
    state: classified.state,
    detail: null,
  };
}

function summarizeWorkRecord(record) {
  return {
    id: normalizeRecordId(record?.id ?? record?.record_id),
    title: normalizeText(record?.title),
    status: normalizeText(record?.status),
    workKind: normalizeText(record?.work_kind ?? record?.workKind),
  };
}

function buildDiagnostics({ reason, subject, selectedUnit, record, slice, source, details }) {
  return {
    reason,
    subject: subject ? { address: subject.address, kind: subject.kind } : null,
    selectedUnit: selectedUnit ? { address: selectedUnit.address, kind: selectedUnit.kind } : null,
    record: record ? summarizeWorkRecord(record) : null,
    slice: slice ? { id: slice.id ?? slice.slice_id ?? null, title: normalizeText(slice.title) } : null,
    source: source ?? null,
    details: details ? truncateList(Array.isArray(details) ? details : [details]) : [],
  };
}

function fail(code, message, diagnostics) {
  return {
    ok: false,
    error: { code, message, diagnostics },
    diagnostics,
  };
}

function prepareSubjectContext(input) {
  const subject = normalizeUnit(input.subject);
  if (!subject) {
    return {
      error: fail(
        'invalid_subject',
        'A valid WK or WK#slice subject is required.',
        buildDiagnostics({ reason: 'invalid_subject', details: ['subject_missing_or_invalid'] }),
      ),
    };
  }

  const selectedUnitState = parseSelectedUnit(input.selectedUnit);
  if (selectedUnitState.state !== 'valid') {
    const missing = selectedUnitState.state === 'missing';
    return {
      error: fail(
        missing ? 'missing_selected_unit' : 'invalid_selected_unit',
        missing
          ? 'Selected-unit context is required for prompt rendering.'
          : 'Selected-unit context is malformed or invalid.',
        buildDiagnostics({
          reason: missing ? 'missing_selected_unit' : 'invalid_selected_unit',
          subject,
          details: [missing ? 'selected_unit_missing' : 'selected_unit_invalid'],
        }),
      ),
    };
  }

  const selectedUnit = selectedUnitState.unit;
  if (!sameSelectedUnit(subject, selectedUnit)) {
    return {
      error: fail(
        'selected_unit_mismatch',
        'Selected-unit context does not match the requested subject.',
        buildDiagnostics({
          reason: 'selected_unit_mismatch',
          subject,
          selectedUnit,
          details: ['subject_and_selected_unit_addresses_differ'],
        }),
      ),
    };
  }

  return { subject, selectedUnit };
}

function loadWorkRecordFromSource(input, subject, selectedUnit) {
  if (isPlainObject(input.workRecord)) {
    return input.workRecord;
  }

  if (typeof input.readWorkRecord === 'function') {
    return input.readWorkRecord(subject.recordId, { subject, selectedUnit });
  }

  return null;
}

function validateWorkRecordForSubject(record, subject) {
  const recordId = normalizeRecordId(record?.id ?? record?.record_id);
  if (!recordId || recordId !== subject.recordId) {
    return null;
  }

  if (subject.kind === 'work_item') {
    const acceptance = resolveContextAcceptance(record.acceptance, recordId);
    return {
      record,
      slice: null,
      acceptance: acceptance.value,
      acceptanceState: acceptance.state,
      acceptanceDetail: acceptance.detail,
      source: 'workRecord.acceptance',
    };
  }

  const slices = Array.isArray(record.slices) ? record.slices : [];
  const slice = slices.find((entry) => {
    const entryId = normalizeSliceId(entry?.id ?? entry?.slice_id);
    return entryId === subject.sliceId;
  });

  if (!slice) {
    return { record, slice: null, acceptance: null, source: 'workRecord.slices' };
  }

  const acceptance = resolveContextAcceptance(
    slice.acceptance,
    `${recordId}#${subject.sliceId}`,
  );
  return {
    record,
    slice,
    acceptance: acceptance.value,
    acceptanceState: acceptance.state,
    acceptanceDetail: acceptance.detail,
    source: 'workRecord.slices[].acceptance',
  };
}

function finalizeContext({ subject, selectedUnit, workRecord }) {
  if (!isPlainObject(workRecord)) {
    return fail(
      'subject_unresolved',
      'The canonical work record could not be resolved for the requested subject.',
      buildDiagnostics({
        reason: 'subject_unresolved',
        subject,
        selectedUnit,
        source: 'workRecord_loader_returned_empty',
        details: ['work_record_loader_returned_nullish'],
      }),
    );
  }

  const resolved = validateWorkRecordForSubject(workRecord, subject);
  if (!resolved) {
    return fail(
      'record_invalid',
      'The loaded work record is invalid or does not match the requested subject.',
      buildDiagnostics({
        reason: 'record_invalid',
        subject,
        selectedUnit,
        record: workRecord,
        source: 'work_record_shape',
        details: ['record_id_invalid_or_mismatched'],
      }),
    );
  }

  if (subject.kind === 'slice' && !resolved.slice) {
    return fail(
      'subject_unresolved',
      'The requested slice could not be resolved from the canonical work record.',
      buildDiagnostics({
        reason: 'subject_unresolved',
        subject,
        selectedUnit,
        record: workRecord,
        source: 'workRecord.slices',
        details: ['slice_id_not_found'],
      }),
    );
  }

  if (!resolved.acceptance) {
    const acceptanceInvalid = resolved.acceptanceState === 'invalid';
    const acceptanceDetail = resolved.acceptanceDetail ?? 'acceptance_section_empty';
    return fail(
      'record_invalid',
      acceptanceInvalid
        ? `The canonical work record acceptance section is invalid (${acceptanceDetail}).`
        : 'The canonical work record is missing required acceptance criteria or validation.',
      buildDiagnostics({
        reason: 'record_invalid',
        subject,
        selectedUnit,
        record: workRecord,
        slice: resolved.slice,
        source: resolved.source,
        details: [
          acceptanceInvalid
            ? acceptanceDetail
            : 'acceptance_or_validation_missing',
        ],
      }),
    );
  }

  const recordSummary = summarizeWorkRecord(workRecord);
  const acceptanceCriteria = resolved.acceptance.criteria.slice();
  const validation = resolved.acceptance.validation.slice();

  return {
    ok: true,
    subject,
    selectedUnit,
    record: recordSummary,
    slice: resolved.slice
      ? {
          id: normalizeSliceId(resolved.slice.id ?? resolved.slice.slice_id),
          title: normalizeText(resolved.slice.title),
          status: normalizeText(resolved.slice.status),
        }
      : null,
    acceptanceCriteria,
    validation,
    renderContext: {
      subjectAddress: subject.address,
      subjectKind: subject.kind,
      selectedUnitAddress: selectedUnit.address,
      selectedUnitKind: selectedUnit.kind,
      recordId: recordSummary.id,
      recordTitle: recordSummary.title,
      recordStatus: recordSummary.status,
      workKind: recordSummary.workKind,
      acceptanceCriteria: acceptanceCriteria.slice(),
      validation: validation.slice(),
    },
    diagnostics: buildDiagnostics({
      reason: 'resolved',
      subject,
      selectedUnit,
      record: workRecord,
      slice: resolved.slice,
      source: resolved.source,
      details: [
        `acceptance_criteria_count:${acceptanceCriteria.length}`,
        `validation_count:${validation.length}`,
      ],
    }),
  };
}

export function resolveWorkspaceAgentFindingsRoleContext(input = {}) {
  const prepared = prepareSubjectContext(input);
  if (prepared.error) {
    return prepared.error;
  }

  const { subject, selectedUnit } = prepared;

  const recordSource = loadWorkRecordFromSource(input, subject, selectedUnit);
  if (recordSource == null) {
    return fail(
      'subject_unresolved',
      'The canonical work record could not be resolved for the requested subject.',
      buildDiagnostics({
        reason: 'subject_unresolved',
        subject,
        selectedUnit,
        source: 'no_work_record_source',
        details: ['no_work_record_source_provided'],
      }),
    );
  }

  if (typeof recordSource?.then === 'function') {
    return fail(
      'subject_unreadable',
      'The helper cannot resolve asynchronous work records through the synchronous resolver.',
      buildDiagnostics({
        reason: 'subject_unreadable',
        subject,
        selectedUnit,
        source: 'async_loader',
        details: ['use_loadWorkspaceAgentFindingsRoleContext_for_async_sources'],
      }),
    );
  }

  return finalizeContext({ subject, selectedUnit, workRecord: recordSource });
}

export async function loadWorkspaceAgentFindingsRoleContext(input = {}) {
  const prepared = prepareSubjectContext(input);
  if (prepared.error) {
    return prepared.error;
  }

  const { subject, selectedUnit } = prepared;

  let workRecord = isPlainObject(input.workRecord) ? input.workRecord : null;

  if (!workRecord && typeof input.readWorkRecord === 'function') {
    try {
      workRecord = await input.readWorkRecord(subject.recordId, { subject, selectedUnit });
    } catch (error) {
      return fail(
        'subject_unreadable',
        'The canonical work record could not be read.',
        buildDiagnostics({
          reason: 'subject_unreadable',
          subject,
          selectedUnit,
          source: 'readWorkRecord',
          details: errorDetails(error),
        }),
      );
    }
  }

  if (!workRecord && typeof input.workRecordPath === 'string') {
    try {
      workRecord = JSON.parse(await readFile(input.workRecordPath, 'utf8'));
    } catch (error) {
      return fail(
        'subject_unreadable',
        'The canonical work record could not be read.',
        buildDiagnostics({
          reason: 'subject_unreadable',
          subject,
          selectedUnit,
          source: 'workRecordPath',
          details: errorDetails(error),
        }),
      );
    }
  }

  if (!workRecord) {
    return fail(
      'subject_unresolved',
      'The canonical work record could not be resolved for the requested subject.',
      buildDiagnostics({
        reason: 'subject_unresolved',
        subject,
        selectedUnit,
        source: 'no_work_record_source',
        details: ['no_work_record_source_provided'],
      }),
    );
  }

  return finalizeContext({ subject, selectedUnit, workRecord });
}

function isCanonicalAcceptanceCriterion(entry) {
  const diagnostics = [];
  validateAcceptanceCriterionEntry(diagnostics, entry, 'criteria', { allowString: true });
  return diagnostics.length === 0;
}

function findingsAcceptanceCriterionText(entry) {
  if (typeof entry === 'string') {
    return normalizeText(entry);
  }
  if (isPlainObject(entry)) {
    return normalizeText(entry.text);
  }
  return null;
}

export function classifyFindingsAcceptanceSection(section) {
  if (!isPlainObject(section) ||
      !Array.isArray(section.criteria) ||
      !Array.isArray(section.validation)) {
    return { state: 'invalid', detail: 'acceptance_section_malformed' };
  }
  const criteriaEmpty = section.criteria.length === 0;
  const validationEmpty = section.validation.length === 0;
  if (criteriaEmpty && validationEmpty) {
    return { state: 'empty' };
  }
  if (criteriaEmpty !== validationEmpty) {
    return { state: 'invalid', detail: 'acceptance_section_asymmetric' };
  }
  const criteria = [];
  for (const entry of section.criteria) {
    if (!isCanonicalAcceptanceCriterion(entry)) {
      return { state: 'invalid', detail: 'acceptance_criterion_not_canonical' };
    }
    const text = findingsAcceptanceCriterionText(entry);
    if (text === null) {
      return { state: 'invalid', detail: 'acceptance_criterion_not_renderable' };
    }
    criteria.push(text);
  }
  const projectedValidation = projectWorkRecordTestProofValidation({
    selectedUnit: { acceptance: section },
  });
  if (projectedValidation.status !== 'valid') {
    return { state: 'invalid', detail: 'acceptance_validation_invalid' };
  }
  const validation = projectedValidation.validation_entries
    .map(renderWorkRecordValidationEntry);
  return { state: 'valid', criteria, validation };
}

function classifyStandaloneParentReviewMaterial(section) {
  const classified = classifyFindingsAcceptanceSection(section);
  if (classified.state !== 'invalid' ||
      classified.detail !== 'acceptance_section_asymmetric' ||
      !isPlainObject(section) ||
      !Array.isArray(section.criteria) || section.criteria.length === 0 ||
      !Array.isArray(section.validation) || section.validation.length !== 0) {
    return classified;
  }
  const criteria = [];
  for (const entry of section.criteria) {
    if (!isCanonicalAcceptanceCriterion(entry)) {
      return { state: 'invalid', detail: 'acceptance_criterion_not_canonical' };
    }
    const text = findingsAcceptanceCriterionText(entry);
    if (text === null) {
      return { state: 'invalid', detail: 'acceptance_criterion_not_renderable' };
    }
    criteria.push(text);
  }
  return { state: 'draft_review_material', criteria, validation: [] };
}

function resolveSliceLevelFindingsOnlyAcceptance({ role, subject, frozenReviewContract }) {
  try {
    if (!isPlainObject(frozenReviewContract) ||
        frozenReviewContract.schema_version !== FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION ||
        frozenReviewContract.review_subject !== subject ||
        typeof frozenReviewContract.canonical_parent_wk_contract !== 'string' ||
        typeof frozenReviewContract.review_unit_contract !== 'string') {
      throw new Error('frozen slice-level findings-only acceptance contract is incomplete or subject-mismatched');
    }
    const parent = JSON.parse(frozenReviewContract.canonical_parent_wk_contract);
    const reviewUnit = JSON.parse(frozenReviewContract.review_unit_contract);
    const parsedSubject = parseAddress(subject);
    if (!parsedSubject || parsedSubject.kind !== 'slice' || parent?.id !== parsedSubject.recordId ||
        reviewUnit?.id !== parsedSubject.sliceId ||

        reviewUnit.work_kind !== 'implementation') {
      throw new Error('frozen slice-level findings-only acceptance contract identity is stale or malformed');
    }
    const parentReviewUnit = Array.isArray(parent.slices)
      ? parent.slices.find((slice) => normalizeSliceId(slice?.id ?? slice?.slice_id) === parsedSubject.sliceId)
      : null;
    if (!parentReviewUnit || JSON.stringify(parentReviewUnit) !== frozenReviewContract.review_unit_contract) {
      throw new Error('frozen slice review unit is not the exact selected unit in the frozen parent contract');
    }

    const parentAcceptance = classifyFindingsAcceptanceSection(parent.acceptance);
    const reviewAcceptance = classifyFindingsAcceptanceSection(reviewUnit.acceptance);

    if (parentAcceptance.state === 'invalid') {
      throw new Error(
        `frozen parent acceptance is malformed or asymmetric (parent: ${parentAcceptance.detail})`,
      );
    }
    if (reviewAcceptance.state !== 'valid') {
      throw new Error(
        reviewAcceptance.state === 'empty'
          ? 'frozen slice review unit acceptance and validation are empty (selected_review_unit: acceptance_section_empty)'
          : `frozen slice review unit acceptance is missing or malformed (selected_review_unit: ${reviewAcceptance.detail})`,
      );
    }
    const inheritedCriteria = parentAcceptance.state === 'valid' ? parentAcceptance.criteria : [];
    const inheritedValidation =
      parentAcceptance.state === 'valid' ? parentAcceptance.validation : [];
    return {
      acceptanceCriteria: [...inheritedCriteria, ...reviewAcceptance.criteria],
      acceptanceValidation: [...inheritedValidation, ...reviewAcceptance.validation],
    };
  } catch (error) {
    throw new LauncherRoleContractError(
      `${error?.message ?? String(error)} (frozen_slice_level_findings_only_contract_invalid)`,
      {
        code: 'frozen_slice_level_findings_only_contract_invalid',
        detail: { role: role ?? null, subject: subject ?? null },
      },
    );
  }
}

const STANDALONE_FINDINGS_CONTRACT_FIELDS = Object.freeze([
  'canonical_parent_wk_contract',
  'canonical_parent_wk_contract_digest',
  'canonical_source_digest',
  'contract_digest',
  'initiative',
  'intended_agent_role',
  'record_id',
  'repository',
  'review_purpose',
  'review_slice_id',
  'review_subject',
  'review_unit_contract',
  'review_unit_contract_digest',
  'schema_version',
  'target_commit',
  'target_ref',
  'work_kind',
  'write_scope',
]);

class StandaloneFindingsContractFailure extends Error {
  constructor(contractSide, mismatchClass) {
    super('frozen standalone findings acceptance contract is invalid');
    this.contractSide = contractSide;
    this.mismatchClass = mismatchClass;
  }
}

function refuseStandaloneContract(contractSide, mismatchClass) {
  throw new StandaloneFindingsContractFailure(contractSide, mismatchClass);
}

function exactOwnFields(value, fields) {
  return isPlainObject(value) &&
    Object.keys(value).sort().join('\u0000') === fields.slice().sort().join('\u0000');
}

function expectedStandaloneRole(workKind) {
  if (workKind === 'review') return 'reviewer';
  if (workKind === 'redteam') return 'redteam';
  return null;
}

function resolveStandaloneFindingsOnlyAcceptance({ role, subject, frozenReviewContract }) {
  try {
    if (!exactOwnFields(frozenReviewContract, STANDALONE_FINDINGS_CONTRACT_FIELDS) ||
        frozenReviewContract.schema_version !==
          FROZEN_STANDALONE_FINDINGS_ACCEPTANCE_CONTRACT_SCHEMA_VERSION) {
      refuseStandaloneContract('envelope', 'malformed');
    }
    if (frozenReviewContract.review_subject !== subject) {
      refuseStandaloneContract('envelope', 'subject_mismatch');
    }
    if (typeof frozenReviewContract.canonical_parent_wk_contract !== 'string') {
      refuseStandaloneContract('parent', 'malformed');
    }
    if (typeof frozenReviewContract.review_unit_contract !== 'string') {
      refuseStandaloneContract('selected_unit', 'malformed');
    }
    if (typeof frozenReviewContract.repository !== 'string' ||
        frozenReviewContract.repository.trim().length === 0 ||
        !WK_ID_RE.test(frozenReviewContract.record_id) ||
        typeof frozenReviewContract.initiative !== 'string' ||
        !/^IN-\d{4}$/u.test(frozenReviewContract.initiative) ||
        !(frozenReviewContract.review_slice_id === null ||
          SLICE_ID_PATTERN.test(frozenReviewContract.review_slice_id)) ||
        !new Set(['standalone', 'standalone_findings', 'exact_slice', 'terminal_whole_wk'])
          .has(frozenReviewContract.review_purpose) ||
        !Array.isArray(frozenReviewContract.write_scope) ||
        frozenReviewContract.write_scope.length !== 0 ||
        typeof frozenReviewContract.target_ref !== 'string' ||
        frozenReviewContract.target_ref.length === 0 ||
        typeof frozenReviewContract.target_commit !== 'string' ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(frozenReviewContract.target_commit) ||
        typeof frozenReviewContract.canonical_source_digest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(frozenReviewContract.canonical_source_digest) ||
        typeof frozenReviewContract.canonical_parent_wk_contract_digest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(
          frozenReviewContract.canonical_parent_wk_contract_digest,
        ) ||
        typeof frozenReviewContract.review_unit_contract_digest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(frozenReviewContract.review_unit_contract_digest) ||
        typeof frozenReviewContract.contract_digest !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/u.test(frozenReviewContract.contract_digest)) {
      refuseStandaloneContract('envelope', 'malformed');
    }
    if (digestTrustedExactReviewEvidence(
      frozenReviewContract.canonical_parent_wk_contract,
    ) !== frozenReviewContract.canonical_parent_wk_contract_digest) {
      refuseStandaloneContract('parent', 'contract_moved');
    }
    if (digestTrustedExactReviewEvidence(
      frozenReviewContract.review_unit_contract,
    ) !== frozenReviewContract.review_unit_contract_digest) {
      refuseStandaloneContract('selected_unit', 'contract_moved');
    }
    const { contract_digest: contractDigest, ...contractBody } = frozenReviewContract;
    if (digestTrustedExactReviewEvidence(contractBody) !== contractDigest) {
      refuseStandaloneContract('envelope', 'binding_mismatch');
    }

    let parent;
    try {
      parent = JSON.parse(frozenReviewContract.canonical_parent_wk_contract);
    } catch {
      refuseStandaloneContract('parent', 'malformed');
    }
    let reviewUnit;
    try {
      reviewUnit = JSON.parse(frozenReviewContract.review_unit_contract);
    } catch {
      refuseStandaloneContract('selected_unit', 'malformed');
    }
    const parsedSubject = parseAddress(subject);
    const wholeRecord = parsedSubject?.kind === 'work_item';
    if (!parsedSubject ||
        (parsedSubject.kind !== 'slice' && !wholeRecord) ||
        parsedSubject.recordId !== frozenReviewContract.record_id ||
        (wholeRecord
          ? frozenReviewContract.review_slice_id !== null
          : parsedSubject.sliceId !== frozenReviewContract.review_slice_id) ||
        parent?.id !== frozenReviewContract.record_id ||
        parent?.repo !== frozenReviewContract.repository ||
        parent?.initiative !== frozenReviewContract.initiative) {
      refuseStandaloneContract('parent', 'identity_mismatch');
    }
    const embeddedReviewUnit = wholeRecord
      ? parent
      : Array.isArray(parent.slices)
        ? parent.slices.find(
          (slice) => normalizeSliceId(slice?.id ?? slice?.slice_id) === parsedSubject.sliceId,
        )
        : null;
    if (!embeddedReviewUnit ||
        JSON.stringify(embeddedReviewUnit) !== frozenReviewContract.review_unit_contract) {
      refuseStandaloneContract('selected_unit', 'contract_moved');
    }
    const intendedRole = expectedStandaloneRole(reviewUnit?.work_kind);
    const canonicalReviewPurpose = reviewUnit?.review_purpose ?? 'standalone';
    const roleCompatible = intendedRole === 'reviewer'
      ? role === 'review' || role === 'reviewer'
      : role === intendedRole;
    if (reviewUnit?.id !== (wholeRecord
      ? frozenReviewContract.record_id
      : frozenReviewContract.review_slice_id) ||
        reviewUnit.work_kind !== frozenReviewContract.work_kind ||
        reviewUnit.dispatch_intent?.intended_agent_role !==
          frozenReviewContract.intended_agent_role ||
        intendedRole === null || frozenReviewContract.intended_agent_role !== intendedRole ||
        canonicalReviewPurpose !== frozenReviewContract.review_purpose ||
        !Array.isArray(reviewUnit.write_scope) || reviewUnit.write_scope.length !== 0 ||
        !roleCompatible) {
      refuseStandaloneContract('selected_unit', 'findings_shape_mismatch');
    }

    const parentAcceptance = wholeRecord
      ? classifyFindingsAcceptanceSection(parent.acceptance)
      : classifyStandaloneParentReviewMaterial(parent.acceptance);
    const reviewAcceptance = classifyFindingsAcceptanceSection(reviewUnit.acceptance);
    if (wholeRecord && parentAcceptance.state !== 'valid') {
      refuseStandaloneContract('parent', 'acceptance_invalid');
    }
    if (!wholeRecord &&
        !new Set(['valid', 'empty', 'draft_review_material']).has(parentAcceptance.state)) {
      refuseStandaloneContract('parent', 'acceptance_invalid');
    }
    if (reviewAcceptance.state !== 'valid') {
      refuseStandaloneContract('selected_unit', 'acceptance_invalid');
    }
    return wholeRecord
      ? {
          acceptanceCriteria: parentAcceptance.criteria,
          acceptanceValidation: parentAcceptance.validation,
        }
      : {
          acceptanceCriteria: [
            ...(parentAcceptance.criteria ?? []),
            ...reviewAcceptance.criteria,
          ],
          acceptanceValidation: [
            ...(parentAcceptance.validation ?? []),
            ...reviewAcceptance.validation,
          ],
        };
  } catch (error) {
    const contractSide = error instanceof StandaloneFindingsContractFailure
      ? error.contractSide
      : 'envelope';
    const mismatchClass = error instanceof StandaloneFindingsContractFailure
      ? error.mismatchClass
      : 'malformed';
    throw new LauncherRoleContractError(
      'Frozen standalone findings acceptance contract is invalid ' +
        '(frozen_standalone_findings_contract_invalid)',
      {
        code: 'frozen_standalone_findings_contract_invalid',
        detail: {
          role: role ?? null,
          subject: subject ?? null,
          contract_side: contractSide,
          mismatch_class: mismatchClass,
        },
      },
    );
  }
}

function looksLikeStandaloneFindingsContract(contract) {
  return isPlainObject(contract) && (
    contract.schema_version === FROZEN_STANDALONE_FINDINGS_ACCEPTANCE_CONTRACT_SCHEMA_VERSION ||
    Object.hasOwn(contract, 'canonical_source_digest') ||
    Object.hasOwn(contract, 'target_commit') ||
    Object.hasOwn(contract, 'review_purpose')
  );
}

function resolveAdvisoryReviewPresentation({ role, subject, contract }) {
  if (!isPlainObject(contract) ||
      Object.keys(contract).sort().join('\u0000') !== [
        'canonical_parent_wk_contract',
        'review_subject',
        'review_unit_contract',
        'role',
        'schema_version',
      ].sort().join('\u0000') ||
      contract.schema_version !== ADVISORY_REVIEW_PRESENTATION_SCHEMA_VERSION ||
      contract.review_subject !== subject || contract.role !== role ||
      typeof contract.canonical_parent_wk_contract !== 'string' ||
      typeof contract.review_unit_contract !== 'string') {
    throw new LauncherRoleContractError('Advisory review presentation is malformed.', {
      code: 'advisory_review_presentation_invalid',
    });
  }
  let parent;
  let selected;
  try {
    parent = JSON.parse(contract.canonical_parent_wk_contract);
    selected = JSON.parse(contract.review_unit_contract);
  } catch {
    throw new LauncherRoleContractError('Advisory review presentation is malformed.', {
      code: 'advisory_review_presentation_invalid',
    });
  }
  const parsed = parseAddress(subject);
  const embedded = parsed?.kind === 'work_item'
    ? parent
    : parent?.slices?.find((slice) => slice?.id === parsed?.sliceId) ?? null;
  if (!parsed || parent?.id !== parsed.recordId || embedded === null ||
      canonicalizeComparable(embedded) !== canonicalizeComparable(selected)) {
    throw new LauncherRoleContractError('Advisory review presentation identity mismatched.', {
      code: 'advisory_review_presentation_invalid',
    });
  }
  const parentAcceptance = classifyFindingsAcceptanceSection(parent.acceptance);
  const selectedAcceptance = classifyFindingsAcceptanceSection(selected.acceptance);
  if (selectedAcceptance.state !== 'valid') {
    throw new LauncherRoleContractError('Advisory review acceptance is invalid.', {
      code: 'advisory_review_presentation_invalid',
    });
  }
  return parsed.kind === 'work_item'
    ? {
        acceptanceCriteria: selectedAcceptance.criteria,
        acceptanceValidation: selectedAcceptance.validation,
      }
    : {
        acceptanceCriteria: [
          ...(parentAcceptance.state === 'valid' ? parentAcceptance.criteria : []),
          ...selectedAcceptance.criteria,
        ],
        acceptanceValidation: [
          ...(parentAcceptance.state === 'valid' ? parentAcceptance.validation : []),
          ...selectedAcceptance.validation,
        ],
      };
}

function canonicalizeComparable(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeComparable).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalizeComparable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function resolveFindingsOnlyAcceptanceContract({
  role,
  subject,
  workspaceDir,
  loadWorkRecord,
  frozenReviewContract = null,
} = {}) {
  if (role === 'worker') {
    return null;
  }

  if (frozenReviewContract !== null && frozenReviewContract !== undefined) {
    if (frozenReviewContract?.schema_version === ADVISORY_REVIEW_PRESENTATION_SCHEMA_VERSION) {
      return resolveAdvisoryReviewPresentation({
        role,
        subject,
        contract: frozenReviewContract,
      });
    }
    if (looksLikeStandaloneFindingsContract(frozenReviewContract)) {
      return resolveStandaloneFindingsOnlyAcceptance({ role, subject, frozenReviewContract });
    }

    if (isPlainObject(frozenReviewContract) &&
        frozenReviewContract.schema_version === FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION) {
      return resolveSliceLevelFindingsOnlyAcceptance({ role, subject, frozenReviewContract });
    }
    try {
      if (!isPlainObject(frozenReviewContract) ||
          frozenReviewContract.schema_version !== FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION ||
          frozenReviewContract.review_subject !== subject ||
          typeof frozenReviewContract.canonical_parent_wk_contract !== 'string' ||
          typeof frozenReviewContract.review_unit_contract !== 'string') {
        throw new Error('frozen findings-only acceptance contract is incomplete or subject-mismatched');
      }
      const parent = JSON.parse(frozenReviewContract.canonical_parent_wk_contract);
      const reviewUnit = JSON.parse(frozenReviewContract.review_unit_contract);
      const parsedSubject = parseAddress(subject);
      if (!parsedSubject || parsedSubject.kind !== 'slice' || parent?.id !== parsedSubject.recordId ||
          parent.status !== 'review' || reviewUnit?.id !== parsedSubject.sliceId) {
        throw new Error('frozen findings-only acceptance contract identity is stale or malformed');
      }
      const parentReviewUnit = Array.isArray(parent.slices)
        ? parent.slices.find((slice) => normalizeSliceId(slice?.id ?? slice?.slice_id) === parsedSubject.sliceId)
        : null;
      if (!parentReviewUnit || JSON.stringify(parentReviewUnit) !== frozenReviewContract.review_unit_contract) {
        throw new Error('frozen review unit is not the exact selected unit in the frozen parent contract');
      }

      const parentAcceptance = classifyFindingsAcceptanceSection(parent.acceptance);
      const reviewAcceptance = classifyFindingsAcceptanceSection(reviewUnit.acceptance);
      if (parentAcceptance.state !== 'valid' || reviewAcceptance.state !== 'valid') {
        const failed = parentAcceptance.state !== 'valid' ? parentAcceptance : reviewAcceptance;
        const contributor = parentAcceptance.state !== 'valid' ? 'parent' : 'selected_review_unit';
        throw new Error(
          'frozen parent or review unit acceptance/validation is missing or invalid ' +
            `(${contributor}: ${failed.detail ?? 'acceptance_section_empty'})`,
        );
      }
      return {
        acceptanceCriteria: [...parentAcceptance.criteria, ...reviewAcceptance.criteria],
        acceptanceValidation: [...parentAcceptance.validation, ...reviewAcceptance.validation],
      };
    } catch (error) {
      throw new LauncherRoleContractError(
        `${error?.message ?? String(error)} (frozen_findings_only_contract_invalid)`,
        {
          code: 'frozen_findings_only_contract_invalid',
          detail: { role: role ?? null, subject: subject ?? null },
        },
      );
    }
  }

  const readWorkRecord =
    typeof loadWorkRecord === 'function' &&
    typeof workspaceDir === 'string' &&
    workspaceDir.length > 0
      ? async (recordId) => {
          const loaded = await loadWorkRecord({ dir: workspaceDir, id: recordId });
          if (!loaded || typeof loaded !== 'object') {
            return null;
          }
          if (loaded.valid !== true) {
            const err = new Error('canonical work record is invalid');
            err.code = 'record_invalid';
            throw err;
          }
          return loaded.record ?? null;
        }
      : undefined;

  const context = await loadWorkspaceAgentFindingsRoleContext({
    subject,
    selectedUnit: subject,
    readWorkRecord,
  });

  if (!context || context.ok !== true) {
    const envelopeError = context?.error ?? {};
    throw new LauncherRoleContractError(
      `${envelopeError.message ?? 'findings-only subject resolution failed'} (${envelopeError.code ?? 'findings_only_subject_resolution_failed'})`,
      {
        code: envelopeError.code ?? 'findings_only_subject_resolution_failed',
        detail: {
          role: role ?? null,
          subject: subject ?? null,
          workspaceDir: workspaceDir ?? null,
          diagnostics: envelopeError.diagnostics ?? context?.diagnostics ?? null,
        },
      },
    );
  }

  return {
    acceptanceCriteria: context.acceptanceCriteria,
    acceptanceValidation: context.validation,
  };
}

function errorDetails(error) {
  return [
    error && typeof error === 'object' && 'code' in error ? `code:${String(error.code)}` : 'read_failed',
    error && typeof error === 'object' && 'message' in error
      ? `message:${String(error.message)}`
      : 'no_error_message',
  ];
}

export default {
  loadWorkspaceAgentFindingsRoleContext,
  resolveFindingsOnlyAcceptanceContract,
  resolveWorkspaceAgentFindingsRoleContext,
};
