

import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { link, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";

import { cloneJson, isObject, normalizeStringEntry } from "./work-record-admission-shared.mjs";
import { ensureDirectory } from "./wiki-shared.mjs";
import { createCompactWorkRecordAdmissionDerivedEvidence } from "./work-record-admission-derived-evidence.mjs";
import { SLICE_ID_PATTERN } from "./work-record-schema-constants.mjs";

export const WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY =
  "wiki/work-records/evidence";

const READ_ONLY_FILESYSTEM_ERROR_CODES = new Set(["EROFS", "EACCES", "EPERM"]);
const NO_CLOBBER_UNSUPPORTED_ERROR_CODES = new Set([
  "EXDEV",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EPERM"
]);
const DIAGNOSTIC_FILESYSTEM_ERROR_CODES = new Set([
  "EACCES",
  "EEXIST",
  "EIO",
  "EMFILE",
  "ENFILE",
  "ENOENT",
  "ENOSPC",
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EPERM",
  "EROFS",
  "EXDEV"
]);
const RECORD_ID_PATTERN = /^WK-[0-9]{4}$/u;
const SIDECAR_DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/u;
const CARRIER_FACTS_RECORDED_RULE = "carrier_facts_recorded_no_local_admissibility_judgment";
const CARRIER_FACTS_RECORDED_REASON =
  "carrier facts are structurally complete for Node Engine evaluation";

function resolveAdmissionSidecarIdentity(derivedEvidence) {
  const recordId = normalizeStringEntry(derivedEvidence?.record_id);
  const unit = isObject(derivedEvidence?.unit) ? derivedEvidence.unit : null;
  const sliceId =
    unit?.kind === "slice"
      ? normalizeStringEntry(unit.slice_id) ||
        normalizeStringEntry(String(unit.address || "").split("#")[1])
      : null;
  if (!recordId || !RECORD_ID_PATTERN.test(recordId)) {
    throw new TypeError("admission sidecar record_id must use canonical WK-#### grammar");
  }
  if (unit?.kind === "slice" && (!sliceId || !SLICE_ID_PATTERN.test(sliceId))) {
    throw new TypeError("admission sidecar slice_id must use canonical slice grammar");
  }
  return {
    recordId,
    sliceId: unit?.kind === "slice" ? sliceId : null,
    unitAddress: normalizeStringEntry(unit?.address) || recordId
  };
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

export function buildWorkRecordAdmissionDerivedEvidenceSidecarRelativePath(
  derivedEvidence,
  sidecarDigest = null
) {
  const identity = resolveAdmissionSidecarIdentity(derivedEvidence);
  const digest = sidecarDigest ?? computeWorkRecordAdmissionDerivedEvidenceSidecarDigest(derivedEvidence);
  const match = SIDECAR_DIGEST_PATTERN.exec(String(digest));
  if (!match) {
    throw new TypeError("admission sidecar digest must be sha256 plus 64 lowercase hex characters");
  }
  const unitSegment = identity.sliceId ? `.${identity.sliceId}` : "";
  return (
    `${WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY}/` +
    `${identity.recordId}${unitSegment}.sha256-${match[1]}.admission.json`
  );
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
  return computeWorkRecordAdmissionDerivedEvidenceSidecarBytesDigest(
    serializeWorkRecordAdmissionDerivedEvidenceSidecar(value)
  );
}

export function serializeWorkRecordAdmissionDerivedEvidenceSidecar(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function computeWorkRecordAdmissionDerivedEvidenceSidecarBytesDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function prepareWorkRecordAdmissionDerivedEvidenceSidecar(value) {
  const identity = resolveAdmissionSidecarIdentity(value);
  const bytes = serializeWorkRecordAdmissionDerivedEvidenceSidecar(value);
  const digest = computeWorkRecordAdmissionDerivedEvidenceSidecarBytesDigest(bytes);
  return {
    bytes,
    digest,
    recordId: identity.recordId,
    relativePath: buildWorkRecordAdmissionDerivedEvidenceSidecarRelativePath(value, digest),
    unitAddress: identity.unitAddress,
    value: cloneJson(value)
  };
}

function normalizeFilesystemCauseCode(error) {
  const causeCode = isObject(error) ? normalizeStringEntry(error.code) : null;
  return causeCode && DIAGNOSTIC_FILESYSTEM_ERROR_CODES.has(causeCode) ? causeCode : null;
}

function createPublicationDiagnostic({
  code,
  identity,
  sidecarPath,
  operation,
  causeCode = null
}) {
  const messages = {
    sidecar_destination_content_conflict:
      "immutable admission sidecar destination already contains different bytes",
    sidecar_no_clobber_unsupported:
      "destination filesystem does not support required hard-link no-clobber publication",
    sidecar_publication_failed: "immutable admission sidecar publication failed"
  };
  return {
    code,
    severity: "error",
    message: messages[code],
    record_id: identity.recordId,
    unit_address: identity.unitAddress,
    sidecar_path: sidecarPath,
    operation,
    ...(causeCode ? { cause_code: causeCode } : {})
  };
}

function publicationFailure({ code, identity, sidecarPath, operation, error = null }) {
  return {
    ok: false,
    created: false,
    diagnostic: createPublicationDiagnostic({
      code,
      identity,
      sidecarPath,
      operation,
      causeCode: normalizeFilesystemCauseCode(error)
    })
  };
}

export async function publishWorkRecordAdmissionDerivedEvidenceSidecar({
  targetDir,
  publication,
  linkFile = link,
  openFile = open,
  readDestination = readFile
}) {
  const prepared = publication?.bytes && publication?.relativePath
    ? publication
    : prepareWorkRecordAdmissionDerivedEvidenceSidecar(publication?.value ?? publication);
  const identity = {
    recordId: prepared.recordId,
    unitAddress: prepared.unitAddress
  };
  const expectedDigest = computeWorkRecordAdmissionDerivedEvidenceSidecarBytesDigest(prepared.bytes);
  const expectedBytes = serializeWorkRecordAdmissionDerivedEvidenceSidecar(prepared.value);
  if (expectedDigest !== prepared.digest || expectedBytes !== prepared.bytes) {
    return publicationFailure({
      code: "sidecar_publication_failed",
      identity,
      sidecarPath: prepared.relativePath,
      operation: "validate_prepared_bytes"
    });
  }
  const expectedPath = buildWorkRecordAdmissionDerivedEvidenceSidecarRelativePath(
    prepared.value,
    prepared.digest
  );
  if (expectedPath !== prepared.relativePath) {
    return publicationFailure({
      code: "sidecar_publication_failed",
      identity,
      sidecarPath: expectedPath,
      operation: "validate_prepared_path"
    });
  }

  const directory = path.resolve(targetDir, WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY);
  const destinationPath = path.resolve(targetDir, prepared.relativePath);
  const digestHex = prepared.digest.slice("sha256:".length);
  const sliceSegment = prepared.value?.unit?.kind === "slice"
    ? `.${prepared.value.unit.slice_id}`
    : "";
  const stageBasename =
    `.${prepared.recordId}${sliceSegment}.sha256-${digestHex}.stage-` +
    `${randomBytes(16).toString("hex")}.admission.tmp`;
  const stagePath = path.join(directory, stageBasename);
  let stageCreated = false;

  try {
    try {
      await ensureDirectory(directory);
    } catch (error) {
      return publicationFailure({
        code: "sidecar_publication_failed",
        identity,
        sidecarPath: prepared.relativePath,
        operation: "stage",
        error
      });
    }
    let handle = null;
    try {
      handle = await openFile(stagePath, "wx");
      stageCreated = true;
      await handle.writeFile(prepared.bytes, { encoding: "utf8" });
      await handle.sync();
      await handle.close();
      handle = null;
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
      }
      return publicationFailure({
        code: "sidecar_publication_failed",
        identity,
        sidecarPath: prepared.relativePath,
        operation: "stage",
        error
      });
    }

    try {
      await linkFile(stagePath, destinationPath);
      return {
        ok: true,
        created: true,
        digest: prepared.digest,
        relativePath: prepared.relativePath
      };
    } catch (error) {
      if (error?.code === "EEXIST") {
        let destinationBytes;
        try {
          destinationBytes = await readDestination(destinationPath);
        } catch (readError) {
          return publicationFailure({
            code: "sidecar_publication_failed",
            identity,
            sidecarPath: prepared.relativePath,
            operation: "destination_read",
            error: readError
          });
        }
        if (Buffer.from(prepared.bytes, "utf8").equals(destinationBytes)) {
          return {
            ok: true,
            created: false,
            digest: prepared.digest,
            relativePath: prepared.relativePath
          };
        }
        return publicationFailure({
          code: "sidecar_destination_content_conflict",
          identity,
          sidecarPath: prepared.relativePath,
          operation: "link",
          error
        });
      }
      if (NO_CLOBBER_UNSUPPORTED_ERROR_CODES.has(error?.code)) {
        return publicationFailure({
          code: "sidecar_no_clobber_unsupported",
          identity,
          sidecarPath: prepared.relativePath,
          operation: "link",
          error
        });
      }
      return publicationFailure({
        code: "sidecar_publication_failed",
        identity,
        sidecarPath: prepared.relativePath,
        operation: "link",
        error
      });
    }
  } finally {
    if (stageCreated) {
      try {
        await rm(stagePath, { force: true });
      } catch {

      }
    }
  }
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
