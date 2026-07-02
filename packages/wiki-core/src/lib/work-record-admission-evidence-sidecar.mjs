

import { createHash } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { cloneJson, isObject, normalizeStringEntry } from "./work-record-admission-shared.mjs";
import {
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_DECISION_KIND,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION
} from "./work-record-admission-decision-codes.mjs";

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
  return `sha256:${createHash("sha256")
    .update(`${JSON.stringify(value, null, 2)}\n`, "utf8")
    .digest("hex")}`;
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

export async function readPersistedWorkerAdmissionEvidenceSidecar({ dir, record, selectedUnit, sourceDigest }) {
  const persistedEntry = findPersistedWorkerAdmissionEvidenceEntry(record, selectedUnit, sourceDigest);

  if (!persistedEntry) {
    return null;
  }

  if (isObject(persistedEntry.normalized_request)) {
    return cloneJson(persistedEntry);
  }

  const entryDiagnostics = {
    record_id: persistedEntry.record_id ?? null,
    unit: cloneJson(persistedEntry.unit ?? null),
    source_record_digest: persistedEntry.source_record_digest ?? null,
    sidecar_path: persistedEntry.sidecar_path ?? null
  };

  const sidecarPath = normalizeAdmissionSidecarPath(persistedEntry.sidecar_path);
  const expectedDigest = normalizeStringEntry(persistedEntry.sidecar_digest);
  if (!sidecarPath || !expectedDigest) {
    throw new WorkerAdmissionSidecarError(
      "sidecar_reference_malformed",
      "compact persisted derived-evidence entry references a sidecar with a missing or invalid sidecar_path/sidecar_digest",
      { ...entryDiagnostics, sidecar_digest: persistedEntry.sidecar_digest ?? null }
    );
  }

  let raw;
  try {
    raw = await readFile(path.resolve(dir, sidecarPath), "utf8");
  } catch (error) {
    throw new WorkerAdmissionSidecarError(
      "sidecar_read_failed",
      `failed to read referenced admission evidence sidecar at ${sidecarPath}`,
      { ...entryDiagnostics, cause: error?.message ?? String(error) }
    );
  }

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

  if (!sidecarBindsToPersistedEntry(sidecar, persistedEntry)) {
    throw new WorkerAdmissionSidecarError(
      "sidecar_binding_mismatch",
      `referenced admission evidence sidecar at ${sidecarPath} does not bind to its persisted entry`,
      entryDiagnostics
    );
  }

  const actualDigest = computeAdmissionSidecarDigest(sidecar);
  if (actualDigest !== expectedDigest) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "worker_admission_sidecar_digest_mismatch",
      ...entryDiagnostics,
      expected_digest: expectedDigest,
      actual_digest: actualDigest
    }));
    return null;
  }

  return cloneJson(sidecar);
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
