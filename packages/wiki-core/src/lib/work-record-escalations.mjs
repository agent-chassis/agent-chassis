import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";

import {
  WORK_RECORD_ESCALATION_KIND_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_CANONICALITY_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_EVIDENCE_BASIS_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_SOURCE_KIND_VALUES,
  computeWorkRecordSourceDigest,
  createWorkRecordDiagnostic,
  validateWorkRecord
} from "./work-record-schema.mjs";
import { WORK_RECORD_POLICY_BLAST_RADIUS_LEVEL_VALUES } from "./work-record-policy.mjs";
import { getWorkRecordPath, loadWorkRecordById } from "./work-record-store.mjs";

export const WORK_RECORD_ESCALATION_AUTHORING_STATUS_VALUES = Object.freeze([
  "proposed",
  "accepted"
]);

export const WORK_RECORD_ESCALATION_NON_AUTHORABLE_RECORD_STATUSES = Object.freeze([
  "done",
  "cancelled",
  "parked"
]);

export const WORK_RECORD_ESCALATION_TRUST_GATE_SOURCES = Object.freeze([
  "env",
  "operator_confirm"
]);

const WORK_RECORD_ESCALATION_REREAD_UNREADABLE_CODES = Object.freeze([
  "EACCES",
  "EPERM",
  "EIO",
  "ENOTDIR",
  "EISDIR",
  "ELOOP",
  "EMFILE",
  "ENFILE"
]);

const WORK_RECORD_ESCALATION_REREAD_MESSAGES = Object.freeze({
  precondition_reread_missing:
    "Canonical work record was absent during the escalation pre-write reread; retry with a fresh load",
  precondition_reread_malformed:
    "Canonical work record was unparsable during the escalation pre-write reread; retry with a fresh load",
  precondition_reread_unreadable:
    "Canonical work record was unreadable during the escalation pre-write reread; retry with a fresh load",
  precondition_reread_failed:
    "Canonical work record reread failed for an unclassified reason; retry with a fresh load"
});

function classifyWorkRecordEscalationRereadFailure(error) {
  const code = typeof error?.code === "string" ? error.code : null;
  if (code === "ENOENT") {
    return "precondition_reread_missing";
  }
  if (error instanceof SyntaxError) {
    return "precondition_reread_malformed";
  }
  if (code !== null && WORK_RECORD_ESCALATION_REREAD_UNREADABLE_CODES.includes(code)) {
    return "precondition_reread_unreadable";
  }
  return "precondition_reread_failed";
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveSelectedSlice(record, sliceId) {
  if (!isNonEmptyString(sliceId) || !Array.isArray(record?.slices)) {
    return null;
  }

  return (
    record.slices.find(
      (slice) => isObject(slice) && String(slice.id) === String(sliceId)
    ) ?? null
  );
}

function toPosixRelativePath(targetDir, absolutePath) {
  return path.relative(targetDir, absolutePath).split(path.sep).join("/");
}

function createFailureResult({
  recordId = null,
  sourcePath = null,
  sourcePathRelative = null,
  diagnostics = [],
  operation = null,
  escalationId = null
} = {}) {
  return {
    valid: false,
    operation,
    record_id: recordId,
    escalation_id: escalationId,
    source_path: sourcePath,
    source_path_relative: sourcePathRelative,
    source_digest: null,
    record: null,
    escalation: null,
    diagnostics
  };
}

function createSuccessResult({
  recordId,
  sourcePath,
  sourcePathRelative,
  sourceDigest,
  record,
  escalation,
  operation
}) {
  return {
    valid: true,
    operation,
    record_id: recordId,
    escalation_id: escalation.id,
    source_path: sourcePath,
    source_path_relative: sourcePathRelative,
    source_digest: sourceDigest,
    record,
    escalation,
    diagnostics: []
  };
}

function buildEscalationRecord({
  record,
  escalationId,
  status,
  kind,
  reason,
  writeScope,
  sliceId = null,
  maxBlastRadius,
  acceptedByActor,
  acceptedById,
  acceptedBySource,
  acceptedAt,
  expiresAt = null,
  authorityRef,
  provenanceSourceKind,
  provenanceCanonicality,
  provenanceEvidenceBasis
}) {
  return {
    id: escalationId,
    kind,
    status,
    scope: {
      unit: record.id,
      slice_id: sliceId ?? null,
      write_scope: Array.isArray(writeScope) ? [...writeScope] : [],
      max_blast_radius: maxBlastRadius
    },
    reason,
    accepted_by: {
      actor: acceptedByActor,
      id: acceptedById,
      source: acceptedBySource
    },
    accepted_at: acceptedAt,
    expires_at: expiresAt ?? null,
    authority_ref: authorityRef,
    provenance: {
      source_kind: provenanceSourceKind,
      canonicality: provenanceCanonicality,
      evidence_basis: provenanceEvidenceBasis
    }
  };
}

function validateAuthoringOptions({
  recordId,
  escalationId,
  reason,
  acceptedAt,
  kind,
  status,
  maxBlastRadius,
  acceptedByActor,
  acceptedById,
  acceptedBySource,
  authorityRef,
  provenanceSourceKind,
  provenanceCanonicality,
  provenanceEvidenceBasis,
  sliceId,
  expiresAt,
  recordUpdated,
  trustGate
}) {
  const diagnostics = [];
  const escalationPath = "escalations[0]";

  function add(code, message, pathValue) {
    diagnostics.push(createWorkRecordDiagnostic(code, message, { path: pathValue }));
  }

  if (!isObject(trustGate)) {
    add(
      "missing_operator_trust",
      "trusted escalation authoring requires an operator trust gate; pass trustGate from a non-worker entrypoint",
      "trust_gate"
    );
  } else if (!WORK_RECORD_ESCALATION_TRUST_GATE_SOURCES.includes(trustGate.source)) {
    add(
      "missing_operator_trust",
      `trust_gate.source must be one of: ${WORK_RECORD_ESCALATION_TRUST_GATE_SOURCES.join(", ")}`,
      "trust_gate.source"
    );
  } else if (!isNonEmptyString(trustGate.attestation)) {
    add(
      "missing_operator_trust",
      "trust_gate.attestation must be a non-empty string",
      "trust_gate.attestation"
    );
  }

  const requiresAcceptanceMetadata = status === "accepted" || status === "proposed";

  if (!isNonEmptyString(recordId)) {
    add("invalid_record", "record id is required", "record_id");
  }
  if (!isNonEmptyString(escalationId)) {
    add("invalid_record", "escalation id is required", "escalation_id");
  }
  if (!isNonEmptyString(reason)) {
    add("invalid_record", "reason is required", `${escalationPath}.reason`);
  }
  if (requiresAcceptanceMetadata && !isNonEmptyString(acceptedAt)) {
    add("invalid_record", "accepted_at is required", `${escalationPath}.accepted_at`);
  }
  if (!WORK_RECORD_ESCALATION_AUTHORING_STATUS_VALUES.includes(status)) {
    add(
      "invalid_record",
      `${escalationPath}.status must be one of: ${WORK_RECORD_ESCALATION_AUTHORING_STATUS_VALUES.join(", ")}`,
      `${escalationPath}.status`
    );
  }
  if (!isNonEmptyString(kind)) {
    add("invalid_record", "kind is required", `${escalationPath}.kind`);
  } else if (!WORK_RECORD_ESCALATION_KIND_VALUES.includes(kind)) {
    add(
      "invalid_record",
      `${escalationPath}.kind must be one of: ${WORK_RECORD_ESCALATION_KIND_VALUES.join(", ")}`,
      `${escalationPath}.kind`
    );
  }
  if (!isNonEmptyString(maxBlastRadius)) {
    add(
      "invalid_record",
      `${escalationPath}.scope.max_blast_radius is required`,
      `${escalationPath}.scope.max_blast_radius`
    );
  } else if (!WORK_RECORD_POLICY_BLAST_RADIUS_LEVEL_VALUES.includes(maxBlastRadius)) {
    add(
      "invalid_record",
      `${escalationPath}.scope.max_blast_radius must be one of: ${WORK_RECORD_POLICY_BLAST_RADIUS_LEVEL_VALUES.join(", ")}`,
      `${escalationPath}.scope.max_blast_radius`
    );
  }
  if (acceptedByActor !== null && acceptedByActor !== undefined && !isNonEmptyString(acceptedByActor)) {
    add(
      "invalid_record",
      `${escalationPath}.accepted_by.actor is required`,
      `${escalationPath}.accepted_by.actor`
    );
  } else if (requiresAcceptanceMetadata && !isNonEmptyString(acceptedByActor)) {
    add(
      "invalid_record",
      `${escalationPath}.accepted_by.actor is required`,
      `${escalationPath}.accepted_by.actor`
    );
  } else if (acceptedByActor === "worker") {
    add(
      "invalid_record",
      `${escalationPath}.accepted_by.actor must not be worker`,
      `${escalationPath}.accepted_by.actor`
    );
  }
  if (acceptedById !== null && acceptedById !== undefined && !isNonEmptyString(acceptedById)) {
    add("invalid_record", `${escalationPath}.accepted_by.id is required`, `${escalationPath}.accepted_by.id`);
  } else if (requiresAcceptanceMetadata && !isNonEmptyString(acceptedById)) {
    add("invalid_record", `${escalationPath}.accepted_by.id is required`, `${escalationPath}.accepted_by.id`);
  }
  if (acceptedBySource !== null && acceptedBySource !== undefined && !isNonEmptyString(acceptedBySource)) {
    add(
      "invalid_record",
      `${escalationPath}.accepted_by.source is required`,
      `${escalationPath}.accepted_by.source`
    );
  } else if (requiresAcceptanceMetadata && !isNonEmptyString(acceptedBySource)) {
    add(
      "invalid_record",
      `${escalationPath}.accepted_by.source is required`,
      `${escalationPath}.accepted_by.source`
    );
  } else if (
    isNonEmptyString(acceptedBySource) &&
    ![
      "explicit_user_instruction",
      "accepted_decision",
      "reviewed_handoff",
      "closed_work_record"
    ].includes(acceptedBySource)
  ) {
    add(
      "invalid_record",
      `${escalationPath}.accepted_by.source must be one of: explicit_user_instruction, accepted_decision, reviewed_handoff, closed_work_record`,
      `${escalationPath}.accepted_by.source`
    );
  }
  if (authorityRef !== null && authorityRef !== undefined && !isNonEmptyString(authorityRef)) {
    add("invalid_record", `${escalationPath}.authority_ref is required`, `${escalationPath}.authority_ref`);
  } else if (requiresAcceptanceMetadata && !isNonEmptyString(authorityRef)) {
    add("invalid_record", `${escalationPath}.authority_ref is required`, `${escalationPath}.authority_ref`);
  }
  if (!isNonEmptyString(provenanceSourceKind)) {
    add(
      "invalid_record",
      `${escalationPath}.provenance.source_kind is required`,
      `${escalationPath}.provenance.source_kind`
    );
  } else if (!WORK_RECORD_ESCALATION_PROVENANCE_SOURCE_KIND_VALUES.includes(provenanceSourceKind)) {
    add(
      "invalid_record",
      `${escalationPath}.provenance.source_kind must be one of: ${WORK_RECORD_ESCALATION_PROVENANCE_SOURCE_KIND_VALUES.join(", ")}`,
      `${escalationPath}.provenance.source_kind`
    );
  }
  if (!isNonEmptyString(provenanceCanonicality)) {
    add(
      "invalid_record",
      `${escalationPath}.provenance.canonicality is required`,
      `${escalationPath}.provenance.canonicality`
    );
  } else if (!WORK_RECORD_ESCALATION_PROVENANCE_CANONICALITY_VALUES.includes(provenanceCanonicality)) {
    add(
      "invalid_record",
      `${escalationPath}.provenance.canonicality must be one of: ${WORK_RECORD_ESCALATION_PROVENANCE_CANONICALITY_VALUES.join(", ")}`,
      `${escalationPath}.provenance.canonicality`
    );
  }
  if (!isNonEmptyString(provenanceEvidenceBasis)) {
    add(
      "invalid_record",
      `${escalationPath}.provenance.evidence_basis is required`,
      `${escalationPath}.provenance.evidence_basis`
    );
  } else if (!WORK_RECORD_ESCALATION_PROVENANCE_EVIDENCE_BASIS_VALUES.includes(provenanceEvidenceBasis)) {
    add(
      "invalid_record",
      `${escalationPath}.provenance.evidence_basis must be one of: ${WORK_RECORD_ESCALATION_PROVENANCE_EVIDENCE_BASIS_VALUES.join(", ")}`,
      `${escalationPath}.provenance.evidence_basis`
    );
  }
  if (sliceId !== null && sliceId !== undefined && !isNonEmptyString(sliceId)) {
    add(
      "invalid_record",
      `${escalationPath}.scope.slice_id must be a non-empty string or null`,
      `${escalationPath}.scope.slice_id`
    );
  }
  if (expiresAt !== null && expiresAt !== undefined && !isNonEmptyString(expiresAt)) {
    add(
      "invalid_record",
      `${escalationPath}.expires_at must be a non-empty string or null`,
      `${escalationPath}.expires_at`
    );
  }
  if (recordUpdated !== null && recordUpdated !== undefined && !isNonEmptyString(recordUpdated)) {
    add("invalid_record", "record updated date must be non-empty when provided", "record_updated");
  }

  return diagnostics;
}

async function writeJsonAtomically(absolutePath, value) {
  const directory = path.dirname(absolutePath);
  await mkdir(directory, { recursive: true });

  const tempDir = await mkdtemp(path.join(directory, ".work-record-escalation-"));
  const tempPath = path.join(tempDir, path.basename(absolutePath));
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(tempPath, absolutePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function pathExists(absolutePath) {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function authorityRefPaths(targetDir, authorityRef) {
  const ref = String(authorityRef);
  const candidates = [];
  if (ref.startsWith("WK-")) {
    candidates.push(
      path.join(targetDir, "wiki", "work-records", `${ref}.json`),
      path.join(targetDir, "wiki", "issues", `${ref}.md`)
    );
  } else if (ref.startsWith("IN-")) {
    candidates.push(path.join(targetDir, "wiki", "initiatives", `${ref}.md`));
  } else if (ref.startsWith("DEC-")) {
    candidates.push(path.join(targetDir, "wiki", "decisions", `${ref}.md`));
  } else if (ref.startsWith("SRC-")) {
    candidates.push(path.join(targetDir, "wiki", "sources", `${ref}.md`));
  }
  return candidates;
}

async function authorityRefResolves(targetDir, authorityRef) {
  const candidates = authorityRefPaths(targetDir, authorityRef);
  if (candidates.length === 0) {
    return false;
  }
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return true;
    }
  }
  return false;
}

export async function authorWorkRecordEscalation({
  dir = ".",
  recordId,
  escalationId,
  status,
  kind,
  reason,
  acceptedByActor,
  acceptedById,
  acceptedBySource,
  acceptedAt,
  expiresAt = null,
  authorityRef,
  provenanceSourceKind,
  provenanceCanonicality,
  provenanceEvidenceBasis,
  sliceId = null,
  maxBlastRadius,
  recordUpdated = null,
  recordStore = null,
  trustGate = null,

  readCanonicalRecordText = (absolutePath) => readFile(absolutePath, "utf8")
} = {}) {
  const targetDir = path.resolve(String(dir));
  const diagnostics = validateAuthoringOptions({
    recordId,
    escalationId,
    reason,
    acceptedAt,
    kind,
    status,
    maxBlastRadius,
    acceptedByActor,
    acceptedById,
    acceptedBySource,
    authorityRef,
    provenanceSourceKind,
    provenanceCanonicality,
    provenanceEvidenceBasis,
    sliceId,
    expiresAt,
    recordUpdated,
    trustGate
  });
  if (diagnostics.length > 0) {
    return createFailureResult({
      recordId: isNonEmptyString(recordId) ? recordId : null,
      diagnostics,
      operation: status,
      escalationId: isNonEmptyString(escalationId) ? escalationId : null
    });
  }

  const loaded = await loadWorkRecordById({
    dir: targetDir,
    id: recordId,
    recordStore
  });
  if (!loaded.valid) {
    return createFailureResult({
      recordId,
      sourcePath: loaded.source_path,
      sourcePathRelative: loaded.source_path_relative,
      diagnostics: loaded.diagnostics,
      operation: status,
      escalationId
    });
  }

  if (
    isNonEmptyString(loaded.record?.status) &&
    WORK_RECORD_ESCALATION_NON_AUTHORABLE_RECORD_STATUSES.includes(loaded.record.status)
  ) {
    return createFailureResult({
      recordId,
      sourcePath: loaded.source_path,
      sourcePathRelative: loaded.source_path_relative,
      diagnostics: [
        createWorkRecordDiagnostic(
          "record_status_not_escalable",
          `Cannot author an escalation on a record with status ${loaded.record.status}`,
          { path: "status" }
        )
      ],
      operation: status,
      escalationId
    });
  }

  if (isNonEmptyString(authorityRef) && !(await authorityRefResolves(targetDir, authorityRef))) {
    return createFailureResult({
      recordId,
      sourcePath: loaded.source_path,
      sourcePathRelative: loaded.source_path_relative,
      diagnostics: [
        createWorkRecordDiagnostic(
          "unresolved_authority_ref",
          `authority_ref ${authorityRef} does not resolve to a canonical record under ${path.relative(process.cwd(), targetDir) || "."}`,
          { path: "escalations[0].authority_ref" }
        )
      ],
      operation: status,
      escalationId
    });
  }

  const existingEscalations = Array.isArray(loaded.record.escalations) ? loaded.record.escalations : [];
  if (existingEscalations.some((entry) => isObject(entry) && entry.id === escalationId)) {
    return createFailureResult({
      recordId,
      sourcePath: loaded.source_path,
      sourcePathRelative: loaded.source_path_relative,
      diagnostics: [
        createWorkRecordDiagnostic(
          "duplicate_escalation_id",
          `Escalation id ${escalationId} is already present on ${recordId}`,
          { path: `escalations[${existingEscalations.length}].id` }
        )
      ],
      operation: status,
      escalationId
    });
  }

  const baselineDigest = computeWorkRecordSourceDigest(loaded.record);
  const updatedRecord = cloneJson(loaded.record);
  if (isNonEmptyString(recordUpdated)) {
    updatedRecord.updated = recordUpdated;
  }

  const selectedSlice = resolveSelectedSlice(updatedRecord, sliceId);
  if (isNonEmptyString(sliceId) && !selectedSlice) {
    return createFailureResult({
      recordId,
      sourcePath: loaded.source_path,
      sourcePathRelative: loaded.source_path_relative,
      diagnostics: [
        createWorkRecordDiagnostic(
          "missing_slice",
          `selected slice ${sliceId} was not found on ${recordId}`,
          { path: "escalations[0].scope.slice_id" }
        )
      ],
      operation: status,
      escalationId
    });
  }

  const escalation = buildEscalationRecord({
    record: updatedRecord,
    escalationId,
    status,
    kind,
    reason,
    writeScope: selectedSlice ? selectedSlice.write_scope : updatedRecord.write_scope,
    sliceId,
    maxBlastRadius,
    acceptedByActor,
    acceptedById,
    acceptedBySource,
    acceptedAt,
    expiresAt,
    authorityRef,
    provenanceSourceKind,
    provenanceCanonicality,
    provenanceEvidenceBasis
  });
  updatedRecord.escalations = [...existingEscalations, escalation];

  const sourceDigest = computeWorkRecordSourceDigest(updatedRecord);
  const validationDiagnostics = validateWorkRecord(updatedRecord, {
    sourcePath: loaded.source_path,
    sourceDigest
  });
  if (validationDiagnostics.some((entry) => entry.severity === "error")) {
    return createFailureResult({
      recordId,
      sourcePath: loaded.source_path,
      sourcePathRelative: loaded.source_path_relative,
      diagnostics: validationDiagnostics,
      operation: status,
      escalationId
    });
  }

  const canonicalPath = getWorkRecordPath(targetDir, recordId);

  function rereadFailure(code) {
    return createFailureResult({
      recordId,
      sourcePath: canonicalPath,
      sourcePathRelative: toPosixRelativePath(targetDir, canonicalPath),
      diagnostics: [
        createWorkRecordDiagnostic(code, WORK_RECORD_ESCALATION_REREAD_MESSAGES[code], {
          path: "source_digest"
        })
      ],
      operation: status,
      escalationId
    });
  }

  let preWriteDiskRecord;
  try {
    preWriteDiskRecord = JSON.parse(await readCanonicalRecordText(canonicalPath));
  } catch (error) {
    return rereadFailure(classifyWorkRecordEscalationRereadFailure(error));
  }
  if (!isObject(preWriteDiskRecord)) {
    return rereadFailure("precondition_reread_malformed");
  }

  const preWriteDigest = computeWorkRecordSourceDigest(preWriteDiskRecord);
  if (preWriteDigest !== baselineDigest) {
    return createFailureResult({
      recordId,
      sourcePath: canonicalPath,
      sourcePathRelative: toPosixRelativePath(targetDir, canonicalPath),
      diagnostics: [
        createWorkRecordDiagnostic(
          "concurrent_record_modification",
          `Source digest for ${recordId} changed during escalation authoring; retry with a fresh load`,
          { path: "source_digest" }
        )
      ],
      operation: status,
      escalationId
    });
  }

  await writeJsonAtomically(canonicalPath, updatedRecord);

  return createSuccessResult({
    recordId,
    sourcePath: canonicalPath,
    sourcePathRelative: toPosixRelativePath(targetDir, canonicalPath),
    sourceDigest,
    record: updatedRecord,
    escalation,
    operation: status
  });
}

export async function proposeWorkRecordEscalation(options = {}) {
  return authorWorkRecordEscalation({
    ...options,
    status: "proposed"
  });
}

export async function acceptWorkRecordEscalation(options = {}) {
  return authorWorkRecordEscalation({
    ...options,
    status: "accepted"
  });
}
