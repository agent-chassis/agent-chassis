import { SLICE_ID_PATTERN } from '../../../wiki-core/src/lib/work-record-schema-constants.mjs';

export const WORK_RECORD_SUBJECT_KIND = 'work_record';
export const WORK_RECORD_SLICE_SUBJECT_KIND = 'work_record_slice';
export const INITIATIVE_SUBJECT_KIND = 'initiative';

export const SUBJECT_KIND_WORK_RECORD = WORK_RECORD_SUBJECT_KIND;
export const SUBJECT_KIND_WORK_RECORD_SLICE = WORK_RECORD_SLICE_SUBJECT_KIND;
export const SUBJECT_KIND_INITIATIVE = INITIATIVE_SUBJECT_KIND;
export const SUBJECT_KIND_NULL = null;

const WORK_RECORD_ID_PATTERN = /^WK-\d{4}$/;
const INITIATIVE_ID_PATTERN = /^IN-\d{4}$/;

function testSchemaSliceIdPattern(sliceId) {
  if (SLICE_ID_PATTERN instanceof RegExp) {
    return new RegExp(SLICE_ID_PATTERN.source, SLICE_ID_PATTERN.flags).test(sliceId);
  }

  if (typeof SLICE_ID_PATTERN === 'string') {
    return new RegExp(SLICE_ID_PATTERN).test(sliceId);
  }

  return false;
}

function classifyRecordId(subject) {
  if (WORK_RECORD_ID_PATTERN.test(subject)) {
    return {
      subject_kind: WORK_RECORD_SUBJECT_KIND,
      record_id: subject,
      slice_id: null,
    };
  }

  if (INITIATIVE_ID_PATTERN.test(subject)) {
    return {
      subject_kind: INITIATIVE_SUBJECT_KIND,
      record_id: subject,
      slice_id: null,
    };
  }

  return null;
}

export function classifyDispatchSubject(subject) {
  if (typeof subject !== 'string' || subject.length === 0) {
    return null;
  }

  const firstHashIndex = subject.indexOf('#');
  if (firstHashIndex === -1) {
    return classifyRecordId(subject);
  }

  if (firstHashIndex !== subject.lastIndexOf('#')) {
    return null;
  }

  const recordId = subject.slice(0, firstHashIndex);
  const sliceId = subject.slice(firstHashIndex + 1);

  if (!WORK_RECORD_ID_PATTERN.test(recordId) || sliceId.length === 0) {
    return null;
  }

  if (!testSchemaSliceIdPattern(sliceId)) {
    return null;
  }

  return {
    subject_kind: WORK_RECORD_SLICE_SUBJECT_KIND,
    record_id: recordId,
    slice_id: sliceId,
  };
}

export const classifyDispatchSubjectKind = classifyDispatchSubject;
export const classifySubjectKind = classifyDispatchSubject;
