

import path from "node:path";
import { performance } from "node:perf_hooks";
import { rename, rm } from "node:fs/promises";

import { isObject } from "./work-records-shared.mjs";
import {
  computeWorkRecordSourceDigest,
  validateWorkRecord
} from "../lib/work-record-schema.mjs";
import { getWorkRecordPath, loadWorkRecordByPath } from "../lib/work-record-store.mjs";
import {
  publishWorkRecordAdmissionDerivedEvidenceSidecar
} from "../lib/work-record-admission-derived-evidence-persist.mjs";
import {
  admissionArtifactReferenceUnavailableDiagnostic,
  findUnavailableNewAdmissionArtifactReferences
} from "../lib/work-record-admission-artifact-references.mjs";
import {
  WORK_RECORD_PERSISTENCE_PHASES,
  WORK_RECORD_PUBLICATION_STATES,
  appendWorkRecordPersistenceFailure,
  obsoleteDocsInputDiagnostic,
  persistenceOutcomeFields,
  projectAdmissionSidecarPublications,
  publicationStateFromCrashDurableResult,
  staleWorkRecordPersistenceResult,
  workRecordInputContractRefusal,
  workRecordPersistenceResult
} from "./work-record-persistence-diagnostics.mjs";

export async function settleWorkRecordPersistenceWithOptionalLock({
  targetDir,
  settleUnderLock,
  lockAlreadyHeld,
  lockFaultInjector,
  withWorkRecordWriteLock
}) {
  if (!lockAlreadyHeld) {
    return withWorkRecordWriteLock(targetDir, settleUnderLock, {
      settle: true,
      faultInjector: lockFaultInjector
    });
  }
  try {
    return { value: await settleUnderLock(), callback_error: null, release_error: null };
  } catch (error) {
    return { value: undefined, callback_error: error, release_error: null };
  }
}

export async function runValidatedWorkRecordAdmissionTransaction({
  dir = ".",
  record: inputRecord,
  expectedSourceDigest,
  expectedPersistenceSnapshotDigest,
  admissionSidecars = [],
  cleanupAdmissionSidecars = null,
  recordStore = null,
  canonicalReplace = rename,
  persistenceEffects = {},
  lockAlreadyHeld = false
} = {}, dependencies) {
  const {
    maintainRecordOwnedAdmissionArtifacts,
    computeWorkRecordPersistenceSnapshotDigest,
    createStoreDiagnostic,
    preservesReviewProvenance,
    preservesWorkRecordEntryHistory,
    entryHistoryMutationDiagnostic,
    validateWorkRecordEntryIntegrity,
    publishCanonicalWorkRecord,
    reviewProvenanceHistoryMutationDiagnostic,
    withWorkRecordWriteLock,
    writeJsonFileToTemp
  } = dependencies;
  const targetDir = path.resolve(String(dir));
  const record = inputRecord;
  const recordId = typeof record?.id === "string" ? record.id : null;
  const canonicalRecordPath = recordId ? getWorkRecordPath(targetDir, recordId) : null;
  const obsoleteInput = obsoleteDocsInputDiagnostic(record);
  if (obsoleteInput) {
    return workRecordInputContractRefusal({
      record,
      sourceDigest: null,
      canonicalRecordPath,
      diagnostic: obsoleteInput
    });
  }
  const sourceDigest = isObject(record) ? computeWorkRecordSourceDigest(record) : null;
  const diagnostics = isObject(record)
    ? validateWorkRecord(record, { sourcePath: canonicalRecordPath, sourceDigest })
    : [createStoreDiagnostic("invalid_record", "work record must be an object")];
  if (!canonicalRecordPath || diagnostics.some((entry) => entry.severity === "error")) {
    return {
      valid: false,
      written: false,
      diagnostics,
      diagnostic_count: diagnostics.length,
      record: isObject(record) ? record : null,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  }
  if (typeof expectedSourceDigest !== "string" || expectedSourceDigest.length === 0) {
    return {
      valid: false,
      written: false,
      diagnostics: [createStoreDiagnostic(
        "invalid_expected_source_digest",
        "expected source digest must be a non-empty string",
        { recordId }
      )],
      diagnostic_count: 1,
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  }
  if (typeof expectedPersistenceSnapshotDigest !== "string" ||
      expectedPersistenceSnapshotDigest.length === 0) {
    return {
      valid: false,
      written: false,
      diagnostics: [createStoreDiagnostic(
        "invalid_expected_persistence_snapshot_digest",
        "expected persistence snapshot digest must be a non-empty string",
        { recordId }
      )],
      diagnostic_count: 1,
      record,
      source_digest: sourceDigest,
      canonical_record_path: canonicalRecordPath
    };
  }

  const stageJsonFile = persistenceEffects.stageJsonFile ?? writeJsonFileToTemp;
  const publishAdmissionSidecar = persistenceEffects.publishAdmissionSidecar ??
    publishWorkRecordAdmissionDerivedEvidenceSidecar;
  const maintainAdmissionArtifacts = persistenceEffects.maintainAdmissionArtifacts ??
    maintainRecordOwnedAdmissionArtifacts;
  const observeLockHeld = typeof persistenceEffects.observeLockHeld === "function"
    ? persistenceEffects.observeLockHeld
    : null;
  const loadRecord = persistenceEffects.loadRecordByPath ?? loadWorkRecordByPath;
  const removeAdmissionArtifact = persistenceEffects.removeAdmissionArtifact ?? rm;
  const removeTemporaryDirectory = persistenceEffects.removeTemporaryDirectory ?? rm;
  const canonicalFaultInjector = persistenceEffects.canonicalFaultInjector ?? null;
  const lockFaultInjector = persistenceEffects.lockFaultInjector ?? null;

  let tempWrite = null;
  let result = null;
  try {
    try {
      tempWrite = await stageJsonFile(canonicalRecordPath, record);
    } catch (error) {
      result = appendWorkRecordPersistenceFailure({
        valid: true,
        diagnostics,
        record,
        source_digest: sourceDigest,
        canonical_record_path: canonicalRecordPath
      }, {
        phase: WORK_RECORD_PERSISTENCE_PHASES.STAGING,
        cause: error,
        publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
        recordId,
        canonicalRecordPath
      });
    }
    if (result === null) {
      let lockHeldSince = null;
      const settleUnderLock = async () => {
        lockHeldSince = performance.now();
        let currentLoaded;
        try {
          currentLoaded = await loadRecord({
            dir: targetDir,
            path: canonicalRecordPath,
            recordStore
          });
        } catch (error) {
          return appendWorkRecordPersistenceFailure({
            valid: true,
            diagnostics,
            record,
            source_digest: sourceDigest,
            canonical_record_path: canonicalRecordPath
          }, {
            phase: WORK_RECORD_PERSISTENCE_PHASES.TRANSACTION_PREPARATION,
            cause: error,
            publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
            recordId,
            canonicalRecordPath
          });
        }
        const currentSourceDigest = currentLoaded.source_digest || null;
        if (currentSourceDigest !== expectedSourceDigest) {
          const stale = staleWorkRecordPersistenceResult({
            record,
            canonicalRecordPath,
            sourceDigest,
            code: "stale_source_digest",
            currentSourceDigest,
            expectedSourceDigest
          });
          return {
            ...stale,
            ...persistenceOutcomeFields(WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED),
            diagnostic_count: stale.diagnostics.length
          };
        }
        const currentSnapshotDigest =
          computeWorkRecordPersistenceSnapshotDigest(currentLoaded.record);
        if (currentSnapshotDigest !== expectedPersistenceSnapshotDigest) {
          const stale = staleWorkRecordPersistenceResult({
            record,
            canonicalRecordPath,
            sourceDigest,
            code: "stale_persistence_snapshot_digest"
          });
          return {
            ...stale,
            ...persistenceOutcomeFields(WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED),
            diagnostic_count: stale.diagnostics.length
          };
        }

        if (!preservesReviewProvenance(currentLoaded.record, record)) {
          return workRecordPersistenceResult({
            valid: false,
            record,
            sourceDigest,
            canonicalRecordPath,
            publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
            ok: false,
            diagnostics: [reviewProvenanceHistoryMutationDiagnostic(recordId)]
          });
        }
        if (!preservesWorkRecordEntryHistory(currentLoaded.record, record)) {
          return workRecordPersistenceResult({
            valid: false,
            record,
            sourceDigest,
            canonicalRecordPath,
            publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
            ok: false,
            diagnostics: [entryHistoryMutationDiagnostic(recordId)]
          });
        }
        const entryIntegrity = await validateWorkRecordEntryIntegrity({
          record,
          repository: record.repo,
          dir: targetDir,
          loadWorkRecordById: async ({ dir, id }) => loadRecord({
            dir,
            path: getWorkRecordPath(dir, id),
            recordStore
          })
        });
        if (!entryIntegrity.ok) {
          return workRecordPersistenceResult({
            valid: false,
            record,
            sourceDigest,
            canonicalRecordPath,
            publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
            ok: false,
            diagnostics: [entryIntegrity.diagnostic]
          });
        }

        const publications = [];
        const rollbackCreatedSidecars = async (baseResult) => {
          let rolledBack = baseResult;
          for (const created of publications.filter((entry) => entry.created)) {
            try {
              await removeAdmissionArtifact(path.resolve(targetDir, created.relativePath), {
                force: true
              });
            } catch (error) {
              rolledBack = appendWorkRecordPersistenceFailure(rolledBack, {
                phase: WORK_RECORD_PERSISTENCE_PHASES.CLEANUP,
                cause: error,
                publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
                failureRole: "secondary",
                recordId,
                canonicalRecordPath
              });
            }
          }
          return rolledBack;
        };

        for (const publication of admissionSidecars) {
          let published;
          try {
            published = await publishAdmissionSidecar({ targetDir, publication });
          } catch (error) {
            const failed = appendWorkRecordPersistenceFailure({
              valid: true,
              diagnostics,
              record,
              source_digest: sourceDigest,
              canonical_record_path: canonicalRecordPath,
              admission_sidecar_publications: projectAdmissionSidecarPublications(publications)
            }, {
              phase: WORK_RECORD_PERSISTENCE_PHASES.SIDECAR_PUBLICATION,
              cause: error,
              publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
              recordId,
              canonicalRecordPath
            });
            return rollbackCreatedSidecars(failed);
          }
          if (!published.ok) {
            const failed = appendWorkRecordPersistenceFailure({
              valid: false,
              diagnostics,
              record,
              source_digest: sourceDigest,
              canonical_record_path: canonicalRecordPath,
              admission_sidecar_publications: projectAdmissionSidecarPublications(publications)
            }, {
              phase: WORK_RECORD_PERSISTENCE_PHASES.SIDECAR_PUBLICATION,
              cause: published.diagnostic,
              producerDiagnostic: published.diagnostic,
              publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
              recordId,
              canonicalRecordPath
            });
            return rollbackCreatedSidecars(failed);
          }
          publications.push(published);
        }

        const unavailableReferences = await findUnavailableNewAdmissionArtifactReferences({
          targetDir,
          previousRecord: currentLoaded.record,
          proposedRecord: record
        });
        if (unavailableReferences.length > 0) {
          return rollbackCreatedSidecars(workRecordPersistenceResult({
            valid: false,
            record,
            sourceDigest,
            canonicalRecordPath,
            publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
            ok: false,
            diagnostics: [admissionArtifactReferenceUnavailableDiagnostic(recordId, unavailableReferences)],
            admission_sidecar_publications: projectAdmissionSidecarPublications(publications)
          }));
        }

        let publication;
        try {
          publication = await publishCanonicalWorkRecord({
            canonicalRecordPath,
            record,
            canonicalReplace,
            faultInjector: canonicalFaultInjector
          });
        } catch (error) {
          return appendWorkRecordPersistenceFailure({
            valid: true,
            diagnostics,
            record,
            source_digest: null,
            canonical_record_path: canonicalRecordPath,
            admission_sidecar_publications: projectAdmissionSidecarPublications(publications)
          }, {
            phase: WORK_RECORD_PERSISTENCE_PHASES.CANONICAL_PUBLICATION,
            cause: error,
            publicationState: WORK_RECORD_PUBLICATION_STATES.UNKNOWN,
            recordId,
            canonicalRecordPath
          });
        }
        if (publication.failed_fault !== null) {
          const publicationState = publicationStateFromCrashDurableResult(publication);
          let failed = appendWorkRecordPersistenceFailure({
            valid: true,
            diagnostics,
            record,
            source_digest: sourceDigest,
            canonical_record_path: canonicalRecordPath,
            current_source_digest: currentSourceDigest,
            admission_sidecar_publications: projectAdmissionSidecarPublications(publications)
          }, {
            phase: WORK_RECORD_PERSISTENCE_PHASES.CANONICAL_PUBLICATION,
            cause: publication.error ?? "canonical work-record publication failed",
            publicationState,
            recordId,
            canonicalRecordPath,
            failedFault: publication.failed_fault,
            trace: publication.trace
          });
          if (publicationState === WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED) {
            failed = await rollbackCreatedSidecars(failed);
          }
          return failed;
        }

        const cleanupMode = cleanupAdmissionSidecars?.mode ??
          (publications.length > 0 ? "remove" : null);
        let cleanup = null;
        try {
          cleanup = cleanupMode
            ? await maintainAdmissionArtifacts({
                targetDir,
                record,
                mode: cleanupMode,
                retainedPaths: publications.map((entry) => entry.relativePath),
                recordStore,
                instrumentation: persistenceEffects.maintenanceInstrumentation ?? null,
                ...(typeof persistenceEffects.unlinkAdmissionArtifact === "function"
                  ? { unlinkArtifact: persistenceEffects.unlinkAdmissionArtifact }
                  : {})
              })
            : null;
        } catch (error) {
          return appendWorkRecordPersistenceFailure(workRecordPersistenceResult({
            valid: true,
            record,
            sourceDigest,
            canonicalRecordPath,
            publicationState: WORK_RECORD_PUBLICATION_STATES.PUBLISHED,
            ok: true,
            diagnostics,
            current_source_digest: currentSourceDigest,
            admission_sidecar_publications: projectAdmissionSidecarPublications(publications)
          }), {
            phase: WORK_RECORD_PERSISTENCE_PHASES.CLEANUP,
            cause: error,
            publicationState: WORK_RECORD_PUBLICATION_STATES.PUBLISHED,
            recordId,
            canonicalRecordPath
          });
        }
        let publishedResult = workRecordPersistenceResult({
          valid: cleanup ? cleanup.ok : true,
          record,
          sourceDigest,
          canonicalRecordPath,
          publicationState: WORK_RECORD_PUBLICATION_STATES.PUBLISHED,
          ok: cleanup ? cleanup.ok : true,
          diagnostics,
          current_source_digest: currentSourceDigest,
          admission_sidecar_publications: projectAdmissionSidecarPublications(publications),
          admission_sidecar_cleanup: cleanup
        });
        if (cleanup && !cleanup.ok) {
          publishedResult = appendWorkRecordPersistenceFailure(publishedResult, {
            phase: WORK_RECORD_PERSISTENCE_PHASES.CLEANUP,
            cause: cleanup.diagnostic,
            producerDiagnostic: cleanup.diagnostic,
            publicationState: WORK_RECORD_PUBLICATION_STATES.PUBLISHED,
            recordId,
            canonicalRecordPath
          });
        }
        return publishedResult;
      };
      const lockOutcome = await settleWorkRecordPersistenceWithOptionalLock({
        targetDir,
        settleUnderLock,
        lockAlreadyHeld,
        lockFaultInjector,
        withWorkRecordWriteLock
      });
      if (observeLockHeld !== null && lockHeldSince !== null) {

        observeLockHeld({ held_ms: performance.now() - lockHeldSince });
      }

      if (lockOutcome.acquisition_error) {
        result = appendWorkRecordPersistenceFailure({
          valid: true,
          diagnostics,
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath
        }, {
          phase: WORK_RECORD_PERSISTENCE_PHASES.LOCK_ACQUISITION,
          cause: lockOutcome.acquisition_error,
          publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
          recordId,
          canonicalRecordPath
        });
      } else if (lockOutcome.callback_error) {
        result = appendWorkRecordPersistenceFailure({
          valid: true,
          diagnostics,
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath
        }, {
          phase: WORK_RECORD_PERSISTENCE_PHASES.TRANSACTION_PREPARATION,
          cause: lockOutcome.callback_error,
          publicationState: WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
          recordId,
          canonicalRecordPath
        });
      } else {
        result = lockOutcome.value;
      }
      if (lockOutcome.release_error) {
        result = appendWorkRecordPersistenceFailure(result, {
          phase: WORK_RECORD_PERSISTENCE_PHASES.LOCK_RELEASE,
          cause: lockOutcome.release_error,
          publicationState: result?.publication_state ??
            WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
          failureRole: result?.ok === false ? "secondary" : "primary",
          recordId,
          canonicalRecordPath
        });
      }
    }
  } finally {
    if (tempWrite) {
      try {
        await removeTemporaryDirectory(tempWrite.tempDir, { recursive: true, force: true });
      } catch (error) {
        result = appendWorkRecordPersistenceFailure(result ?? {
          valid: true,
          diagnostics,
          record,
          source_digest: sourceDigest,
          canonical_record_path: canonicalRecordPath
        }, {
          phase: WORK_RECORD_PERSISTENCE_PHASES.CLEANUP,
          cause: error,
          publicationState: result?.publication_state ??
            WORK_RECORD_PUBLICATION_STATES.NOT_PUBLISHED,
          failureRole: result?.ok === false ? "secondary" : "primary",
          recordId,
          canonicalRecordPath
        });
      }
    }
  }
  return result;
}
