

import path from "node:path";
import {
  cloneJson,
  isObject,
  parseDispatchUnitAddress
} from "./work-records-shared.mjs";
import { writeValidatedWorkRecord } from "./work-records-store-io.mjs";
import {
  carryForwardPersistedReviewAttestations,
  isWorkerAdmissionDerivedEvidenceForUnit,
  upsertWorkerAdmissionDerivedEvidenceEntries
} from "./work-records-admission-evidence.mjs";
import {
  evaluateWorkRecordAdmissionDerivedEvidence
} from "../lib/work-record-admission.mjs";
import {
  buildWorkRecordAdmissionDerivedEvidenceSidecarRelativePath,
  computeWorkRecordAdmissionDerivedEvidenceSidecarDigest,
  createPersistedWorkerAdmissionDerivedEvidence,
  createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary,
  writeWorkRecordAdmissionDerivedEvidenceSidecar
} from "../lib/work-record-admission-derived-evidence-persist.mjs";
import { buildGraphEvidenceSidecarEntry } from "../lib/work-record-graph-evidence-sidecar.mjs";
import {
  canonicalizeWorkRecordReadScope,
  computeWorkRecordSourceDigest,
  validateWorkRecord
} from "../lib/work-record-schema.mjs";
import { getWorkRecordPath, loadWorkRecordById } from "../lib/work-record-store.mjs";
import {
  createInvalidGraphImpactPersistResult,
  normalizePersistedGraphImpact
} from "./work-records-graph-impact-normalize.mjs";
import {
  compactPersistedGraphImpactEntry,
  createPersistedGraphImpactEntry,
  createPersistedGraphImpactSummary,
  createPersistedGraphImpactSummaryRef,
  extractGraphImpactRawEvidenceToken
} from "./work-records-graph-impact-entry.mjs";
import {
  buildGraphSidecarWrite,
  recheckGraphSidecarUnchanged,
  rollbackGraphSidecarWrite,
  writeTextFileAtomically
} from "./work-records-graph-impact-sidecar-io.mjs";

export { recheckGraphSidecarUnchanged, rollbackGraphSidecarWrite };

export async function persistWorkRecordGraphImpactByUnit({
  dir = ".",
  unitAddress,
  graphImpact = null,
  graph_impact = null,
  graphImpactSummaryRef = null,
  graph_impact_summary_ref = null,
  expectedSourceDigest = null,
  recordStore = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const requestedUnit = parseDispatchUnitAddress(unitAddress);

  if (!requestedUnit.ok) {
    return createInvalidGraphImpactPersistResult({
      diagnostics: [
        {
          code: requestedUnit.error.code,
          severity: "error",
          message: requestedUnit.error.message,
          path: requestedUnit.error.path
        }
      ]
    });
  }

  const normalizedGraphImpactInput = normalizePersistedGraphImpact(graphImpact ?? graph_impact);
  if (normalizedGraphImpactInput.issue) {
    return createInvalidGraphImpactPersistResult({
      recordId: requestedUnit.recordId,
      diagnostics: [
        {
          code: normalizedGraphImpactInput.issue.code,
          severity: "error",
          message: normalizedGraphImpactInput.issue.message,
          path: normalizedGraphImpactInput.issue.path
        }
      ]
    });
  }

  const loaded = await loadWorkRecordById({
    dir: targetDir,
    id: requestedUnit.recordId,
    recordStore
  });

  if (!loaded.record) {
    return {
      ...loaded,
      graph_impact: null,
      derived_evidence: null,
      written: false
    };
  }

  const currentSourceDigest = loaded.source_digest || computeWorkRecordSourceDigest(loaded.record);

  if (expectedSourceDigest !== null && expectedSourceDigest !== undefined) {
    if (typeof expectedSourceDigest !== "string" || expectedSourceDigest.length === 0) {
      return createInvalidGraphImpactPersistResult({
        recordId: loaded.record.id,
        diagnostics: [
          {
            code: "invalid_expected_source_digest",
            severity: "error",
            message: "expected source digest must be a non-empty string",
            path: "expected_source_digest"
          }
        ]
      });
    }
    if (expectedSourceDigest !== currentSourceDigest) {
      return {
        ...loaded,
        valid: false,
        graph_impact: normalizedGraphImpactInput.graph_impact,
        derived_evidence: null,
        written: false,
        record_id: loaded.record.id,
        expected_source_digest: expectedSourceDigest,
        current_source_digest: currentSourceDigest,
        diagnostics: [
          ...loaded.diagnostics,
          {
            code: "stale_source_digest",
            severity: "error",
            message: "expected source digest does not match the current on-disk record",
            path: "expected_source_digest"
          }
        ]
      };
    }
  }

  if (
    normalizedGraphImpactInput.graph_impact.source_record_digest &&
    normalizedGraphImpactInput.graph_impact.source_record_digest !== currentSourceDigest
  ) {
    return {
      ...loaded,
      valid: false,
      graph_impact: normalizedGraphImpactInput.graph_impact,
      derived_evidence: null,
      written: false,
      diagnostics: [
        ...loaded.diagnostics,
        {
          code: "stale_source_digest",
          severity: "error",
          message: "graph-impact source digest does not match the current on-disk record",
          path: "graph_impact.source_record_digest"
        }
      ]
    };
  }

  if (
    normalizedGraphImpactInput.graph_impact.record_id &&
    normalizedGraphImpactInput.graph_impact.record_id !== loaded.record.id
  ) {
    return createInvalidGraphImpactPersistResult({
      recordId: loaded.record.id,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          message: `graph-impact record_id must be ${loaded.record.id}`,
          path: "graph_impact.record_id"
        }
      ]
    });
  }

  if (
    normalizedGraphImpactInput.graph_impact.unit &&
    (!isObject(normalizedGraphImpactInput.graph_impact.unit) ||
      normalizedGraphImpactInput.graph_impact.unit.kind !== requestedUnit.unit.kind ||
      normalizedGraphImpactInput.graph_impact.unit.address !== requestedUnit.unit.address ||
      normalizedGraphImpactInput.graph_impact.unit.record_id !== requestedUnit.unit.record_id ||
      normalizedGraphImpactInput.graph_impact.unit.slice_id !== requestedUnit.unit.slice_id)
  ) {
    return createInvalidGraphImpactPersistResult({
      recordId: loaded.record.id,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          message: "graph-impact unit does not match the requested unit address",
          path: "graph_impact.unit"
        }
      ]
    });
  }

  if (
    normalizedGraphImpactInput.graph_impact.slice_id &&
    normalizedGraphImpactInput.graph_impact.slice_id !== requestedUnit.unit.slice_id
  ) {
    return createInvalidGraphImpactPersistResult({
      recordId: loaded.record.id,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          message: `graph-impact slice_id must be ${requestedUnit.unit.slice_id}`,
          path: "graph_impact.slice_id"
        }
      ]
    });
  }

  const generatedAt = new Date().toISOString();

  const updatedRecord = canonicalizeWorkRecordReadScope(cloneJson(loaded.record));
  const stampSourceDigest = computeWorkRecordSourceDigest(updatedRecord);

  const selectedSlice =
    requestedUnit.unit.kind === "slice"
      ? Array.isArray(updatedRecord.slices)
        ? updatedRecord.slices.find(
            (entry) => isObject(entry) && entry.id === requestedUnit.unit.slice_id
          ) || null
        : null
      : null;

  if (requestedUnit.unit.kind === "slice" && !selectedSlice) {
    return createInvalidGraphImpactPersistResult({
      recordId: loaded.record.id,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          message: `Selected slice ${requestedUnit.unit.slice_id} does not exist on ${loaded.record.id}`,
          path: "unit"
        }
      ]
    });
  }

  const graphImpactSummary = createPersistedGraphImpactSummary(
    normalizedGraphImpactInput.graph_impact,
    requestedUnit.unit,
    stampSourceDigest
  );
  const rawEvidenceToken = extractGraphImpactRawEvidenceToken(
    normalizedGraphImpactInput.graph_impact,
    graphImpactSummaryRef ?? graph_impact_summary_ref ?? null
  );
  const graphImpactSummaryRefInput = graphImpactSummaryRef ?? graph_impact_summary_ref ?? null;
  const graphImpactSummaryRefEntry = createPersistedGraphImpactSummaryRef(
    graphImpactSummary,
    stampSourceDigest,
    rawEvidenceToken,
    graphImpactSummaryRefInput
  );

  const persistedEntry = await createPersistedGraphImpactEntry({
    dir: targetDir,
    record: updatedRecord,
    graphImpact: normalizedGraphImpactInput.graph_impact,
    graphImpactSummary,
    graphImpactSummaryRef: graphImpactSummaryRefEntry,
    requestedUnit: requestedUnit.unit,
    selectedSlice,
    sourceDigest: stampSourceDigest,
    generatedAt
  });

  let sidecarEntry;
  try {
    sidecarEntry = buildGraphEvidenceSidecarEntry({
      unit: requestedUnit.unit,
      graph_impact: persistedEntry.graph_impact,
      graph_impact_summary: persistedEntry.graph_impact_summary,
      graph_impact_summary_ref: persistedEntry.graph_impact_summary_ref,
      source_record_digest: stampSourceDigest,
      generated_at: generatedAt
    });
  } catch (error) {
    return createInvalidGraphImpactPersistResult({
      recordId: loaded.record.id,
      diagnostics: [
        {
          code: "graph_sidecar_entry_unbuildable",
          severity: "error",
          message: error?.message || "could not build a graph sidecar entry for the persisted graph-impact evidence",
          path: "graph_sidecar"
        }
      ]
    });
  }

  const sidecarWrite = await buildGraphSidecarWrite({
    targetDir,
    recordId: loaded.record.id,
    sidecarEntry,
    generatedAt
  });
  if (!sidecarWrite.ok) {
    return {
      ...loaded,
      valid: false,
      graph_impact: persistedEntry.graph_impact,
      derived_evidence: persistedEntry,
      written: false,
      diagnostics: [...loaded.diagnostics, sidecarWrite.diagnostic]
    };
  }

  const fullGraphImpactForResponse = compactPersistedGraphImpactEntry(persistedEntry, sidecarWrite.inlineRef);

  const priorAdmissionEntry = Array.isArray(loaded.record.derived_evidence)
    ? loaded.record.derived_evidence.find((entry) =>
        isWorkerAdmissionDerivedEvidenceForUnit(entry, loaded.record.id, requestedUnit.unit)
      ) || null
    : null;
  await carryForwardPersistedReviewAttestations(
    priorAdmissionEntry,
    persistedEntry,
    targetDir,
    stampSourceDigest
  );

  const admissionSummary = createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary(
    evaluateWorkRecordAdmissionDerivedEvidence(persistedEntry)
  );
  const admissionSidecarRelativePath =
    buildWorkRecordAdmissionDerivedEvidenceSidecarRelativePath(persistedEntry);
  const admissionSidecarAbsolutePath = path.resolve(targetDir, admissionSidecarRelativePath);
  const admissionSidecarPayload = cloneJson(persistedEntry);
  const admissionSidecarDigest =
    computeWorkRecordAdmissionDerivedEvidenceSidecarDigest(admissionSidecarPayload);
  const compactPersistedEntry = createPersistedWorkerAdmissionDerivedEvidence(persistedEntry, {
    sidecarPath: admissionSidecarRelativePath,
    sidecarDigest: admissionSidecarDigest,
    admissionSummary
  });

  updatedRecord.derived_evidence = upsertWorkerAdmissionDerivedEvidenceEntries(
    updatedRecord,
    compactPersistedEntry
  );

  const sourceDigest = computeWorkRecordSourceDigest(updatedRecord);
  const diagnostics = validateWorkRecord(updatedRecord, {
    sourcePath: loaded.source_path,
    sourceDigest
  });
  if (diagnostics.some((entry) => entry.severity === "error")) {

    return {
      ...loaded,
      valid: false,
      diagnostics,
      record: updatedRecord,
      source_digest: sourceDigest,
      graph_impact: fullGraphImpactForResponse,
      derived_evidence: compactPersistedEntry,
      written: false
    };
  }

  const recheck = await recheckGraphSidecarUnchanged({
    absolutePath: sidecarWrite.absolutePath,
    existedBefore: sidecarWrite.existedBefore,
    priorText: sidecarWrite.priorText
  });
  if (!recheck.ok) {
    return {
      ...loaded,
      valid: false,
      graph_impact: fullGraphImpactForResponse,
      derived_evidence: compactPersistedEntry,
      written: false,
      diagnostics: [...loaded.diagnostics, recheck.diagnostic]
    };
  }

  await writeTextFileAtomically(sidecarWrite.absolutePath, sidecarWrite.text);

  await writeWorkRecordAdmissionDerivedEvidenceSidecar(
    admissionSidecarAbsolutePath,
    admissionSidecarPayload
  );

  const writeResult = await writeValidatedWorkRecord({
    dir: targetDir,
    record: updatedRecord,
    expectedSourceDigest: currentSourceDigest,
    recordStore
  });

  if (!writeResult.written) {
    const rollback = await rollbackGraphSidecarWrite({
      absolutePath: sidecarWrite.absolutePath,
      existedBefore: sidecarWrite.existedBefore,
      priorText: sidecarWrite.priorText,
      expectedText: sidecarWrite.text
    });
    return {
      ...loaded,
      ...writeResult,
      valid: Boolean(writeResult.valid),
      diagnostics: rollback.diagnostic
        ? [...writeResult.diagnostics, rollback.diagnostic]
        : writeResult.diagnostics,
      record: updatedRecord,
      source_digest: sourceDigest,
      graph_impact: fullGraphImpactForResponse,
      derived_evidence: compactPersistedEntry,
      written: false,
      canonical_record_path: writeResult.canonical_record_path || loaded.source_path || null
    };
  }

  return {
    ...loaded,
    ...writeResult,
    valid: writeResult.valid,
    diagnostics: writeResult.diagnostics,
    record: updatedRecord,
    source_digest: sourceDigest,
    graph_impact: fullGraphImpactForResponse,
    derived_evidence: compactPersistedEntry,
    admission_sidecar_path: admissionSidecarRelativePath,
    admission_sidecar_digest: admissionSidecarDigest,
    graph_sidecar_path: sidecarWrite.relativePath,
    graph_sidecar_digest: sidecarWrite.digest,
    graph_entry_digest: sidecarEntry.graph_entry_digest,
    replay_detail_available: sidecarEntry.replay_detail_available === true,
    selected_unit: requestedUnit.unit,
    canonical_record_path: writeResult.canonical_record_path || getWorkRecordPath(targetDir, updatedRecord.id)
  };
}
