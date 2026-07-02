

import { createHash } from "node:crypto";
import path from "node:path";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";

import { cloneJson, isObject, normalizeStringEntry } from "./work-record-admission-shared.mjs";
import { ensureDirectory } from "./wiki-shared.mjs";
import { createCompactWorkRecordAdmissionDerivedEvidence } from "./work-record-admission-derived-evidence.mjs";

export const WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY =
  "wiki/work-records/evidence";

const READ_ONLY_FILESYSTEM_ERROR_CODES = new Set(["EROFS", "EACCES", "EPERM"]);
const CARRIER_FACTS_RECORDED_RULE = "carrier_facts_recorded_no_local_admissibility_judgment";
const CARRIER_FACTS_RECORDED_REASON =
  "carrier facts are structurally complete for Node Engine evaluation";

function sanitizeWorkRecordAdmissionDerivedEvidenceSidecarSegment(segment) {
  const normalized = normalizeStringEntry(segment);
  if (!normalized) {
    return "slice";
  }
  return encodeURIComponent(normalized);
}

function isReadOnlyFilesystemError(error) {
  const code = isObject(error) ? normalizeStringEntry(error.code) : null;
  return READ_ONLY_FILESYSTEM_ERROR_CODES.has(code);
}

function createWorkRecordAdmissionDerivedEvidenceSidecarWriteError(filePath, error) {
  const directory = path.dirname(filePath);
  const causeCode = isObject(error) ? normalizeStringEntry(error.code) : null;
  const causeMessage =
    isObject(error) && typeof error.message === "string" && error.message.trim()
      ? error.message
      : "filesystem write failed";
  const structured = {
    schema_version: "runtime-blocker-codes.v1",
    code: "read_only_mount",
    category: "filesystem",
    blocking: true,
    summary: "Mounted repository filesystem is read-only and required writes cannot be applied.",
    evidence: {
      operation: "writeWorkRecordAdmissionDerivedEvidenceSidecar",
      file_path: filePath,
      directory,
      cause_code: causeCode,
      cause_message: causeMessage
    }
  };
  const wrapped = new Error(
    `failed to persist worker-admission sidecar at ${filePath}: ${causeMessage}`
  );
  wrapped.name = "WorkRecordAdmissionDerivedEvidenceSidecarWriteError";
  wrapped.code = structured.code;
  wrapped.path = filePath;
  wrapped.directory = directory;
  wrapped.envelope = structured;
  if (error) {
    wrapped.cause = error;
  }
  return wrapped;
}

export function buildWorkRecordAdmissionDerivedEvidenceSidecarRelativePath(derivedEvidence) {
  const recordId = normalizeStringEntry(derivedEvidence?.record_id) || "WK-unknown";
  const unit = isObject(derivedEvidence?.unit) ? derivedEvidence.unit : null;
  if (unit?.kind === "slice") {
    const sliceId = sanitizeWorkRecordAdmissionDerivedEvidenceSidecarSegment(
      normalizeStringEntry(unit.slice_id) || String(unit.address || "").split("#")[1] || "slice"
    );
    return `${WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY}/${recordId}.${sliceId}.admission.json`;
  }
  return `${WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY}/${recordId}.admission.json`;
}

function isCleanCarrierFactsRecordedResult(admission) {
  if (!isObject(admission) || admission.decision != null || admission.decision_code != null) {
    return false;
  }
  const decisionCodes = Array.isArray(admission.decision_codes) ? admission.decision_codes : [];
  if (decisionCodes.length > 0) {
    return false;
  }
  const matchedRules = Array.isArray(admission.matched_rules) ? admission.matched_rules : [];
  if (matchedRules.includes(CARRIER_FACTS_RECORDED_RULE)) {
    return true;
  }
  const reasons = Array.isArray(admission.reasons) ? admission.reasons : [];
  return reasons.includes(CARRIER_FACTS_RECORDED_REASON);
}

function projectCompactAdmissionResult(admission) {
  if (admission.decision === "review_required") {
    return "review";
  }
  if (admission.decision != null) {
    return admission.decision;
  }
  if (isCleanCarrierFactsRecordedResult(admission)) {
    return "allow";
  }
  return null;
}

export function createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary(admission) {
  if (!isObject(admission)) {
    return null;
  }
  const result = projectCompactAdmissionResult(admission);
  return {
    result,
    dispatchable: result === "allow",
    decision_codes: Array.isArray(admission.decision_codes) ? admission.decision_codes.slice() : []
  };
}

function createCompactInlineTargetResolutionEvidence(value) {
  if (!isObject(value)) {
    return null;
  }
  const expectedEditTargets = Array.isArray(value.expected_edit_targets)
    ? value.expected_edit_targets
    : [];

  const hasResolvedTarget = expectedEditTargets.some(
    (target) => isObject(target) && target.resolution_status === "resolved"
  );
  if (value.binding_status !== "trusted" || !hasResolvedTarget) {
    return null;
  }
  const metricSourceProvenance = isObject(value.metric_source_provenance)
    ? value.metric_source_provenance
    : null;
  return {
    binding_status: value.binding_status ?? null,
    binding_reason: value.binding_reason ?? null,
    target_resolution_evidence_status: value.target_resolution_evidence_status ?? null,
    source_record_digest: normalizeStringEntry(value.source_record_digest) ?? null,
    selected_unit: cloneJson(value.selected_unit ?? null),
    payload_bound_input_digest: normalizeStringEntry(value.payload_bound_input_digest) ?? null,
    expected_edit_targets: expectedEditTargets.map((target) => ({
      path: target?.path ?? null,
      kind: target?.kind ?? null,
      name: target?.name ?? null,
      operation: target?.operation ?? null,
      optional: target?.optional === true,
      resolution_status: target?.resolution_status ?? null
    })),
    metric_source_provenance: metricSourceProvenance
      ? {
          binding_status: metricSourceProvenance.binding_status ?? null,
          binding_reason: metricSourceProvenance.binding_reason ?? null,
          source_record_digest: normalizeStringEntry(metricSourceProvenance.source_record_digest) ?? null,
          selected_unit: cloneJson(metricSourceProvenance.selected_unit ?? null),
          payload_bound_input_digest:
            normalizeStringEntry(metricSourceProvenance.payload_bound_input_digest) ?? null
        }
      : null
  };
}

export function createPersistedWorkerAdmissionDerivedEvidence(entry, options = {}) {
  const compactEntry = createCompactWorkRecordAdmissionDerivedEvidence(entry, {
    sidecarPath: options.sidecarPath,
    sidecarDigest: options.sidecarDigest,
    admissionSummary: options.admissionSummary
  });
  if (isObject(compactEntry.metric_summary)) {
    const compactMetricSummary = cloneJson(compactEntry.metric_summary);
    delete compactMetricSummary.feature_vector;
    delete compactMetricSummary.target_resolution_evidence;
    if (isObject(compactMetricSummary.structural_target_metrics)) {
      const compactStructuralTargetMetrics = cloneJson(compactMetricSummary.structural_target_metrics);
      delete compactStructuralTargetMetrics.targets;
      delete compactStructuralTargetMetrics.metric_source_provenance;
      delete compactStructuralTargetMetrics.metricSourceProvenance;
      compactMetricSummary.structural_target_metrics = compactStructuralTargetMetrics;
    }
    compactEntry.metric_summary = compactMetricSummary;
  }
  const compactInlineTargetResolutionEvidence =
    options.retainInlineTargetResolutionBinding === true
      ? createCompactInlineTargetResolutionEvidence(compactEntry.target_resolution_evidence)
      : null;
  if (compactInlineTargetResolutionEvidence) {
    compactEntry.target_resolution_evidence = compactInlineTargetResolutionEvidence;
  } else {
    delete compactEntry.target_resolution_evidence;
  }
  return compactEntry;
}

export function computeWorkRecordAdmissionDerivedEvidenceSidecarDigest(value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export async function writeWorkRecordAdmissionDerivedEvidenceSidecar(filePath, value) {
  const directory = path.dirname(filePath);
  let tempDir = null;
  let primaryError = null;

  try {
    await ensureDirectory(directory);
    tempDir = await mkdtemp(path.join(directory, ".record-tmp-"));
    const tempPath = path.join(tempDir, path.basename(filePath));

    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(tempPath, filePath);
  } catch (error) {
    primaryError = error;
    if (isReadOnlyFilesystemError(error)) {
      throw createWorkRecordAdmissionDerivedEvidenceSidecarWriteError(filePath, error);
    }
    throw error;
  } finally {
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        if (!primaryError) {
          throw error;
        }
      }
    }
  }
}
