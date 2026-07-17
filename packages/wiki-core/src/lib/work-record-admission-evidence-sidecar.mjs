

import path from "node:path";
import { readFile } from "node:fs/promises";

import { cloneJson, isObject, normalizeStringEntry } from "./work-record-admission-shared.mjs";
import {
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION
} from "./work-record-admission-decision-codes.mjs";
import {
  computeWorkRecordAdmissionDerivedEvidenceSidecarBytesDigest
} from "./work-record-admission-derived-evidence-persist.mjs";

export const ADMISSION_EVIDENCE_SIDECAR_DIRECTORY = "wiki/work-records/evidence";

export class WorkerAdmissionSidecarError extends Error {
  constructor(code, message, diagnostics = {}) {
    super(message);
    this.name = "WorkerAdmissionSidecarError";
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export function unitsMatch(left, right) {
  const leftUnit = isObject(left) ? left : null;
  const rightUnit = isObject(right) ? right : null;
  return (
    leftUnit?.kind === rightUnit?.kind &&
    leftUnit?.address === rightUnit?.address &&
    leftUnit?.record_id === rightUnit?.record_id &&
    (leftUnit?.slice_id ?? null) === (rightUnit?.slice_id ?? null)
  );
}

export function findPersistedWorkerAdmissionEvidenceEntry(record, selectedUnit, sourceDigest) {
  const entries = Array.isArray(record?.derived_evidence) ? record.derived_evidence : [];
  return entries.find((entry) => (
    entry?.schema_version === WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION &&
    entry?.record_id === selectedUnit.record_id &&
    entry?.decision_kind === WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND &&
    entry?.source_record_digest === sourceDigest &&
    unitsMatch(entry.unit, selectedUnit)
  )) ?? null;
}

export function normalizeAdmissionSidecarPath(value) {
  const sidecarPath = normalizeStringEntry(value);
  if (!sidecarPath || path.isAbsolute(sidecarPath)) {
    return null;
  }
  const normalized = path.posix.normalize(sidecarPath);
  if (
    normalized !== sidecarPath ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    !normalized.startsWith(`${ADMISSION_EVIDENCE_SIDECAR_DIRECTORY}/`) ||
    !normalized.endsWith(".admission.json")
  ) {
    return null;
  }
  return normalized;
}

export function computeAdmissionSidecarDigest(value) {
  return computeAdmissionSidecarBytesDigest(`${JSON.stringify(value, null, 2)}\n`);
}

export function computeAdmissionSidecarBytesDigest(bytes) {
  return computeWorkRecordAdmissionDerivedEvidenceSidecarBytesDigest(bytes);
}

export function sidecarBindsToPersistedEntry(sidecar, entry) {
  return (
    isObject(sidecar) &&
    sidecar.schema_version === entry?.schema_version &&
    sidecar.record_id === entry?.record_id &&
    sidecar.source_record_digest === entry?.source_record_digest &&
    sidecar.generated_at === entry?.generated_at &&
    sidecar.decision_kind === entry?.decision_kind &&
    unitsMatch(sidecar.unit, entry?.unit) &&
    isObject(sidecar.normalized_request)
  );
}

export async function readPersistedWorkerAdmissionEvidenceSidecarEntry({ dir, entry }) {

  if (!isObject(entry)) {
    return null;
  }

  if (isObject(entry.normalized_request)) {
    return cloneJson(entry);
  }

  if (entry.sidecar_path === null || entry.sidecar_path === undefined) {
    if (entry.sidecar_digest === null || entry.sidecar_digest === undefined) {
      return null;
    }
  }

  const entryDiagnostics = {
    record_id: entry.record_id ?? null,
    unit: cloneJson(entry.unit ?? null),
    source_record_digest: entry.source_record_digest ?? null,
    sidecar_path: entry.sidecar_path ?? null
  };

  const sidecarPath = normalizeAdmissionSidecarPath(entry.sidecar_path);
  const expectedDigest = normalizeStringEntry(entry.sidecar_digest);
  if (!sidecarPath || !expectedDigest) {
    throw new WorkerAdmissionSidecarError(
      "sidecar_reference_malformed",
      "compact persisted derived-evidence entry references a sidecar with a missing or invalid sidecar_path/sidecar_digest",
      { ...entryDiagnostics, sidecar_digest: entry.sidecar_digest ?? null }
    );
  }

  let rawBytes;
  try {
    rawBytes = await readFile(path.resolve(dir, sidecarPath));
  } catch (error) {
    throw new WorkerAdmissionSidecarError(
      "sidecar_read_failed",
      `failed to read referenced admission evidence sidecar at ${sidecarPath}`,
      { ...entryDiagnostics, cause: error?.message ?? String(error) }
    );
  }

  const actualDigest = computeAdmissionSidecarBytesDigest(rawBytes);
  if (actualDigest !== expectedDigest) {
    throw new WorkerAdmissionSidecarError(
      "sidecar_digest_mismatch",
      `referenced admission evidence sidecar at ${sidecarPath} does not match its persisted digest`,
      {
        ...entryDiagnostics,
        expected_digest: expectedDigest,
        actual_digest: actualDigest
      }
    );
  }

  const raw = rawBytes.toString("utf8");
  let sidecar;
  try {
    sidecar = JSON.parse(raw);
  } catch (error) {
    throw new WorkerAdmissionSidecarError(
      "sidecar_parse_failed",
      `referenced admission evidence sidecar at ${sidecarPath} is not valid JSON`,
      { ...entryDiagnostics, cause: error?.message ?? String(error) }
    );
  }

  if (!sidecarBindsToPersistedEntry(sidecar, entry)) {
    throw new WorkerAdmissionSidecarError(
      "sidecar_binding_mismatch",
      `referenced admission evidence sidecar at ${sidecarPath} does not bind to its persisted entry`,
      entryDiagnostics
    );
  }

  return cloneJson(sidecar);
}

export async function readPersistedWorkerAdmissionEvidenceSidecar({ dir, record, selectedUnit, sourceDigest }) {
  const persistedEntry = findPersistedWorkerAdmissionEvidenceEntry(record, selectedUnit, sourceDigest);
  return readPersistedWorkerAdmissionEvidenceSidecarEntry({ dir, entry: persistedEntry });
}

export function attachPersistedReviewAttestations(derivedEvidence, persistedEvidence) {
  const persistedAttestations = persistedEvidence?.normalized_request?.evidence?.review_attestations;
  if (!Array.isArray(persistedAttestations) || persistedAttestations.length === 0) {
    return derivedEvidence;
  }
  const updated = cloneJson(derivedEvidence);
  if (!isObject(updated.normalized_request.evidence)) {
    updated.normalized_request.evidence = {};
  }
  updated.normalized_request.evidence.review_attestations = cloneJson(persistedAttestations);
  return updated;
}
