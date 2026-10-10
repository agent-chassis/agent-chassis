

import path from "node:path";
import { randomBytes } from "node:crypto";
import { lstat, readFile, rename, unlink } from "node:fs/promises";
import {
  CRASH_DURABLE_EFFECTS,
  createAsyncEffects,
  planReplacement,
  runCrashDurablePlanAsync
} from "../lib/crash-durable-state.mjs";
import { findUnavailableNewAdmissionArtifactReferences } from
  "../lib/work-record-admission-artifact-references.mjs";

export function serializeCanonicalWorkRecord(record) {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export async function publishCanonicalWorkRecord({
  canonicalRecordPath,
  record,
  canonicalReplace = rename,
  faultInjector = null,
  canonicalBytes
}) {
  const bytes = canonicalBytes ?? serializeCanonicalWorkRecord(record);
  const privatePath = path.join(
    path.dirname(canonicalRecordPath),
    `.${path.basename(canonicalRecordPath)}.publish-${process.pid}-${randomBytes(8).toString("hex")}`
  );

  const effects = {
    ...createAsyncEffects({ mode: 0o666, faultInjector }),
    [CRASH_DURABLE_EFFECTS.PUBLISH_RENAME]: async (step) => {
      if (typeof faultInjector === "function" && step.fault !== null) faultInjector(step.fault);
      await canonicalReplace(step.privatePath, step.targetPath);
    }
  };
  const result = await runCrashDurablePlanAsync(
    planReplacement({ targetPath: canonicalRecordPath, privatePath, bytes }),
    effects
  );
  return result;
}

export async function guardOrdinaryWorkRecordPublication({
  targetDir,
  canonicalRecordPath,
  record,
  recordId,
  recordStore,
  guardSourceDigest,
  loadRecord,
  retainedHistoryMutationDiagnostic
}) {
  const currentLoaded = await loadRecord({
    dir: targetDir,
    path: canonicalRecordPath,
    recordStore
  });
  const currentSourceDigest = currentLoaded.source_digest || null;
  if (currentSourceDigest !== guardSourceDigest) {
    return { status: "stale", current_source_digest: currentSourceDigest };
  }
  const retainedHistoryMutation = retainedHistoryMutationDiagnostic(
    currentLoaded.record, record, recordId);
  if (retainedHistoryMutation) {
    return { status: "retained_history_mutation", diagnostic: retainedHistoryMutation };
  }
  const unavailableReferences = await findUnavailableNewAdmissionArtifactReferences({
    targetDir,
    previousRecord: currentLoaded.record,
    proposedRecord: record
  });
  if (unavailableReferences.length > 0) {
    return { status: "admission_artifact_reference_unavailable", unavailableReferences };
  }
  return { status: "clear", currentLoaded, current_source_digest: currentSourceDigest };
}

export async function settleOrdinaryWorkRecordPublication({
  canonicalReplace,
  canonicalFaultInjector,
  ...guardInput
}) {
  const guard = await guardOrdinaryWorkRecordPublication(guardInput);
  if (guard.status !== "clear") return guard;
  const publication = await publishCanonicalWorkRecord({
    canonicalRecordPath: guardInput.canonicalRecordPath,
    record: guardInput.record,
    canonicalReplace,
    faultInjector: canonicalFaultInjector
  });
  return { status: "publication", publication, current_source_digest: guard.current_source_digest };
}

export async function restoreCanonicalWorkRecordBytes({ canonicalRecordPath, priorBytes, publishedBytes }) {
  const failure = (code, message, details = {}) => {
    const error = new Error(message); error.code = code; error.details = details; throw error;
  };
  if (priorBytes === null) {

    const absent = async () => {
      try { return await lstat(canonicalRecordPath); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    };
    try {
      const entry = await absent();
      if (entry === null) return { restored: false, verified_absent: true };
      if (!entry.isFile() || !(await readFile(canonicalRecordPath)).equals(publishedBytes)) {
        failure("work_record_target_compensation_stale", "Target compensation cannot remove unrelated changes");
      }
      try { await unlink(canonicalRecordPath); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (await absent() !== null) {
        failure("work_record_target_compensation_failed", "Birth target absence could not be verified");
      }
      return { restored: true, verified_absent: true };
    } catch (cause) {
      if (cause.code === "work_record_target_compensation_stale" ||
          cause.code === "work_record_target_compensation_failed") throw cause;
      const error = new Error("Birth target absence could not be restored", { cause });
      error.code = "work_record_target_compensation_failed";
      error.details = { cause_code: cause.code, verified_absent: false };
      throw error;
    }
  }
  const current = await readFile(canonicalRecordPath);
  if (current.equals(priorBytes)) return { restored: false };
  if (!current.equals(publishedBytes)) {
    failure("work_record_target_compensation_stale", "Target compensation cannot replace unrelated changes");
  }
  const result = await publishCanonicalWorkRecord({
    canonicalRecordPath, canonicalBytes: priorBytes.toString("utf8") });
  if (result.failed_fault !== null || !(await readFile(canonicalRecordPath)).equals(priorBytes)) {
    failure("work_record_target_compensation_failed", "Exact prior target bytes were not restored",
      { failed_fault: result.failed_fault });
  }
  return { restored: true };
}
