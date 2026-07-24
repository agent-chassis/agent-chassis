import { readFile } from 'node:fs/promises';

import { SLICE_ID_PATTERN } from '@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs';
import { validateAcceptanceCriterionEntry } from '@agent-chassis/wiki-core/src/lib/work-record-schema-validators.mjs';

import { LauncherRoleContractError } from './workspace-agent-role-contract.mjs';

const WK_ID_RE = /^WK-(\d{4})$/;
const MAX_DIAGNOSTIC_ITEMS = 6;
export const FROZEN_FINDINGS_ONLY_ACCEPTANCE_CONTRACT_SCHEMA_VERSION =
  'workspace-agent-frozen-findings-only-acceptance-contract.v1';

export const FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION =
  'workspace-agent-frozen-slice-level-findings-only-acceptance-contract.v1';

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

function normalizeAcceptance(section, unitLabel) {
  if (!isPlainObject(section)) {
    return null;
  }

  const criteria = Array.isArray(section.criteria)
    ? section.criteria.map(normalizeText).filter(Boolean)
    : null;
  const validation = Array.isArray(section.validation)
    ? section.validation.map(normalizeText).filter(Boolean)
    : null;

  if (!criteria || !validation || criteria.length === 0 || validation.length === 0) {
    return null;
  }

  return { unitLabel, criteria, validation };
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
    return {
      record,
      slice: null,
      acceptance: normalizeAcceptance(record.acceptance, recordId),
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

  return {
    record,
    slice,
    acceptance: normalizeAcceptance(slice.acceptance, `${recordId}#${subject.sliceId}`),
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
    return fail(
      'record_invalid',
      'The canonical work record is missing required acceptance criteria or validation.',
      buildDiagnostics({
        reason: 'record_invalid',
        subject,
        selectedUnit,
        record: workRecord,
        slice: resolved.slice,
        source: resolved.source,
        details: ['acceptance_or_validation_missing_or_invalid'],
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

function classifyFindingsAcceptanceSection(section) {
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
  const validation = [];
  for (const entry of section.validation) {
    const text = normalizeText(entry);
    if (text === null) {
      return { state: 'invalid', detail: 'acceptance_validation_invalid' };
    }
    validation.push(text);
  }
  return { state: 'valid', criteria, validation };
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
        parent.status === 'review' ||
        reviewUnit?.id !== parsedSubject.sliceId ||

        reviewUnit.work_kind !== 'implementation' ||
        reviewUnit.status !== 'review') {
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
        `frozen parent acceptance is malformed or asymmetric (${parentAcceptance.detail})`,
      );
    }
    if (reviewAcceptance.state !== 'valid') {
      throw new Error(
        reviewAcceptance.state === 'empty'
          ? 'frozen slice review unit acceptance and validation are empty'
          : `frozen slice review unit acceptance is missing or malformed (${reviewAcceptance.detail})`,
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
      const parentAcceptance = normalizeAcceptance(parent.acceptance, parsedSubject.recordId);
      const reviewAcceptance = normalizeAcceptance(reviewUnit.acceptance, subject);
      if (!parentAcceptance || !reviewAcceptance) {
        throw new Error('frozen parent or review unit acceptance/validation is missing or invalid');
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
