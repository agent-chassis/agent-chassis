

import path from "node:path";
import { lstat } from "node:fs/promises";

import { WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY } from
  "./work-record-admission-derived-evidence-persist.mjs";

export const ADMISSION_ARTIFACT_DIRECTORY = WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SIDECAR_DIRECTORY;

const RECORD_ID_SOURCE = "WK-[0-9]{4}";
const UNIT_SEGMENT_SOURCE = "(?:SLICE-[0-9]{3}|[a-z0-9][a-z0-9-]*)";
const DIGEST_SEGMENT_SOURCE = "sha256-[a-f0-9]{64}";
const IMMUTABLE_BASENAME_SOURCE =
  `${RECORD_ID_SOURCE}(?:\\.${UNIT_SEGMENT_SOURCE})?\\.${DIGEST_SEGMENT_SOURCE}\\.admission\\.json`;

const IMMUTABLE_BASENAME_PATTERN = new RegExp(
  `^(${RECORD_ID_SOURCE})(?:\\.${UNIT_SEGMENT_SOURCE})?\\.${DIGEST_SEGMENT_SOURCE}\\.admission\\.json$`,
  "u"
);
const STAGE_BASENAME_PATTERN = new RegExp(
  `^\\.(${RECORD_ID_SOURCE})(?:\\.${UNIT_SEGMENT_SOURCE})?\\.${DIGEST_SEGMENT_SOURCE}` +
    "\\.stage-[a-f0-9]{32}\\.admission\\.tmp$",
  "u"
);
const DIRECTORY_PREFIX = `${ADMISSION_ARTIFACT_DIRECTORY}/`;
const IMMUTABLE_PATH_PATTERN = new RegExp(`^${DIRECTORY_PREFIX}${IMMUTABLE_BASENAME_SOURCE}$`, "u");
const EMBEDDED_PATH_SOURCE = `${DIRECTORY_PREFIX}${IMMUTABLE_BASENAME_SOURCE}`;

const EMBEDDED_PATH_MARKER = ".admission.json";

export function classifyAdmissionArtifactBasename(basename) {
  if (typeof basename !== "string") return null;
  const immutable = IMMUTABLE_BASENAME_PATTERN.exec(basename);
  if (immutable) return { kind: "immutable", record_id: immutable[1] };
  const stage = STAGE_BASENAME_PATTERN.exec(basename);
  if (stage) return { kind: "stage", record_id: stage[1] };
  return null;
}

export function isAdmissionArtifactPath(value) {
  return typeof value === "string" && IMMUTABLE_PATH_PATTERN.test(value);
}

function addEmbeddedAdmissionArtifactPaths(text, into) {
  if (!text.includes(EMBEDDED_PATH_MARKER)) return;
  const pattern = new RegExp(EMBEDDED_PATH_SOURCE, "gu");
  for (const match of text.matchAll(pattern)) into.add(match[0]);
}

export function collectRetainedAdmissionArtifactPaths(value, into = new Set()) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      addEmbeddedAdmissionArtifactPaths(current, into);
    } else if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry);
    } else if (current !== null && typeof current === "object") {
      for (const key of Object.keys(current)) {
        addEmbeddedAdmissionArtifactPaths(key, into);
        pending.push(current[key]);
      }
    }
  }
  return into;
}

function addStructuralPath(value, into) {
  if (isAdmissionArtifactPath(value)) into.add(value);
}

function addStructuralList(list, into) {
  if (!Array.isArray(list)) return;
  for (const entry of list) addStructuralPath(entry, into);
}

function addSidecarPaths(value, into) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry);
    } else if (current !== null && typeof current === "object") {
      for (const [key, entry] of Object.entries(current)) {
        if (key === "sidecar_path") addStructuralPath(entry, into);
        else pending.push(entry);
      }
    }
  }
}

export function collectStructuralAdmissionArtifactReferences(record) {
  const into = new Set();
  if (record === null || typeof record !== "object" || Array.isArray(record)) return into;
  addStructuralList(record.read_scope, into);
  addStructuralList(record.repo_paths, into);
  for (const slice of Array.isArray(record.slices) ? record.slices : []) {
    if (slice === null || typeof slice !== "object") continue;
    addStructuralList(slice.read_scope, into);
    addStructuralList(slice.repo_paths, into);
  }
  addSidecarPaths(record, into);
  return into;
}

export async function findUnavailableNewAdmissionArtifactReferences({
  targetDir,
  previousRecord,
  proposedRecord,
  statPath = lstat
}) {
  const previous = collectStructuralAdmissionArtifactReferences(previousRecord);
  const introduced = [...collectStructuralAdmissionArtifactReferences(proposedRecord)]
    .filter((entry) => !previous.has(entry))
    .sort();
  const unavailable = [];
  for (const relativePath of introduced) {
    try {
      const stats = await statPath(path.resolve(targetDir, relativePath));
      if (!stats.isFile()) unavailable.push({ path: relativePath, reason: "nonregular", cause_code: null });
    } catch (error) {
      unavailable.push({
        path: relativePath,
        reason: error?.code === "ENOENT" ? "missing" : "unreadable",
        cause_code: typeof error?.code === "string" ? error.code : null
      });
    }
  }
  return unavailable;
}

export function admissionArtifactReferenceUnavailableDiagnostic(recordId, unavailable) {
  return {
    code: "admission_artifact_reference_unavailable",
    severity: "error",
    message:
      "newly referenced admission artifacts must exist as regular files before canonical publication",
    ...(recordId ? { record_id: recordId } : {}),
    sidecar_path: unavailable[0]?.path ?? null,
    references: unavailable.map((entry) => ({ ...entry }))
  };
}
