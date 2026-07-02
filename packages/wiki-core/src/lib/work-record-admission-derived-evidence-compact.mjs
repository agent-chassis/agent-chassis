

import {
  cloneJson,
  isObject,
  normalizeStringEntry
} from "./work-record-admission-shared.mjs";
import { WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION } from "./work-record-admission-decision-codes.mjs";

function normalizeCompactDerivedEvidenceSidecarField(options, camelKey, snakeKey) {
  return Object.prototype.hasOwnProperty.call(options, camelKey) ||
    Object.prototype.hasOwnProperty.call(options, snakeKey);
}

function normalizeCompactDerivedEvidenceSidecarValue(value) {
  return normalizeStringEntry(value) ?? null;
}

export function createCompactWorkRecordAdmissionDerivedEvidence(entry, options = {}) {
  if (!isObject(entry)) {
    throw new Error("createCompactWorkRecordAdmissionDerivedEvidence requires entry");
  }

  const compactEntry = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === "normalized_request") {
      continue;
    }
    compactEntry[key] = cloneJson(value);
  }

  if (normalizeCompactDerivedEvidenceSidecarField(options, "sidecarPath", "sidecar_path")) {
    compactEntry.sidecar_path = normalizeCompactDerivedEvidenceSidecarValue(
      options.sidecarPath ?? options.sidecar_path
    );
  }
  if (normalizeCompactDerivedEvidenceSidecarField(options, "sidecarDigest", "sidecar_digest")) {
    compactEntry.sidecar_digest = normalizeCompactDerivedEvidenceSidecarValue(
      options.sidecarDigest ?? options.sidecar_digest
    );
  }
  if (normalizeCompactDerivedEvidenceSidecarField(options, "admissionSummary", "admission_summary")) {
    const admissionSummary = options.admissionSummary ?? options.admission_summary;
    compactEntry.admission_summary = isObject(admissionSummary) ? cloneJson(admissionSummary) : null;
  }

  return compactEntry;
}

export function isCompactWorkerAdmissionDerivedEvidence(entry) {
  return isObject(entry) &&
    normalizeStringEntry(entry.schema_version) === WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION &&
    !Object.prototype.hasOwnProperty.call(entry, "normalized_request");
}

