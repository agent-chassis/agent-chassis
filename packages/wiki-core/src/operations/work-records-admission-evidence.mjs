

import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  cloneJson,
  createContextualizedStructuralTargetMetrics,
  createDispatchReadinessForUnit,
  createRecordLevelDispatchReadiness,
  isObject,
  normalizeNonEmptyString,
  parseDispatchUnitAddress
} from "./work-records-shared.mjs";
import { writeValidatedWorkRecord } from "./work-records-store-io.mjs";
import {
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR,
  WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION,
  createWorkRecordAdmissionDerivedEvidence,
  createWorkRecordAdmissionRecordLocalInputs,
  evaluateWorkRecordAdmissionDerivedEvidence,
  systemUtcClock
} from "../lib/work-record-admission.mjs";
import { validateReviewAttestation } from "../lib/work-record-review-attestation.mjs";
import {
  buildWorkRecordAdmissionDerivedEvidenceSidecarRelativePath,
  computeWorkRecordAdmissionDerivedEvidenceSidecarDigest,
  createPersistedWorkerAdmissionDerivedEvidence,
  createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary,
  writeWorkRecordAdmissionDerivedEvidenceSidecar
} from "../lib/work-record-admission-derived-evidence-persist.mjs";
import {
  canonicalizeWorkRecordReadScope,
  computeWorkRecordSourceDigest,
  validateWorkRecord
} from "../lib/work-record-schema.mjs";
import { getWorkRecordPath, loadWorkRecordById } from "../lib/work-record-store.mjs";
import { carryForwardSourceCompatibleGraphImpactEvidence } from "../lib/work-record-admission-graph-impact-carry.mjs";

function isWorkerAdmissionDerivedEvidenceDiagnosticPath(diagnosticPath) {
  const normalizedPath = String(diagnosticPath || "");
  return normalizedPath === "derived_evidence" || normalizedPath.startsWith("derived_evidence[");
}

function getDerivedEvidenceDiagnosticIndex(diagnosticPath) {
  const match = /^derived_evidence\[(\d+)\](?:\.|$)/.exec(String(diagnosticPath || ""));
  return match ? Number.parseInt(match[1], 10) : null;
}

function isSelectedUnitAdmissionSummaryRefreshDiagnostic(record, diagnostic, requestedUnit) {
  const diagnosticPath = String(diagnostic?.path || "");
  if (
    diagnostic?.code !== "invalid_record" ||
    diagnosticPath !== `derived_evidence[${getDerivedEvidenceDiagnosticIndex(diagnosticPath)}].admission_summary.result`
  ) {
    return false;
  }
  const index = getDerivedEvidenceDiagnosticIndex(diagnosticPath);
  if (index === null || !Array.isArray(record?.derived_evidence)) {
    return false;
  }
  const entry = record.derived_evidence[index];
  return (
    isCompactWorkerAdmissionEntryWithSidecar(entry) &&
    isWorkerAdmissionDerivedEvidenceForUnit(entry, record.id, requestedUnit)
  );
}

const WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME =
  "workspace_work_record_refresh_admission_metrics";
const WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_BLOCKER =
  "missing_structured_metric_refresh_route";

function buildWorkerAdmissionDerivedEvidenceStructuredRefreshRoute() {
  return WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME;
}

function buildWorkerAdmissionDerivedEvidenceRefreshCommand(unitAddress) {
  return `npm run wiki -- work-records refresh-admission-metrics --id ${unitAddress}`;
}

function isRecordLevelWorkerAdmissionDerivedEvidenceEntry(entry, recordId) {
  return (
    isObject(entry) &&
    entry.decision_kind === "work_unit_atomicity" &&
    entry.record_id === recordId &&
    isObject(entry.unit) &&
    entry.unit.kind === "work_item" &&
    entry.unit.address === recordId &&
    entry.unit.record_id === recordId &&
    entry.unit.slice_id === null
  );
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function getWorkerAdmissionDerivedEvidenceIssueForUnit(record, sourceDigest, requestedUnit) {
  if (!Array.isArray(record?.derived_evidence)) {
    return {
      issue: {
        code: "missing_worker_admission_derived_evidence",
        message: "missing worker-admission derived evidence",
        details: {}
      }
    };
  }

  const recordId = isObject(record) && typeof record.id === "string" ? record.id : null;
  const matchingEntries = [];

  for (let index = 0; index < record.derived_evidence.length; index += 1) {
    const entry = record.derived_evidence[index];
    if (isWorkerAdmissionDerivedEvidenceForUnit(entry, recordId, requestedUnit)) {
      matchingEntries.push({ entry, index });
    }
  }

  if (matchingEntries.length === 0) {
    return {
      issue: {
        code: "missing_worker_admission_derived_evidence",
        message: "missing worker-admission derived evidence",
        details: {}
      }
    };
  }

  for (const { entry, index } of matchingEntries) {
    if (
      typeof entry.schema_version === "string" &&
      entry.schema_version !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION
    ) {
      return {
        issue: {
          code: "outdated_worker_admission_derived_evidence",
          message: "worker-admission derived evidence schema version is outdated",
          details: {
            derived_evidence_index: index,
            derived_evidence_schema_version: entry.schema_version
          }
        }
      };
    }

    if (
      isObject(entry.generator) &&
      typeof entry.generator.version === "string" &&
      entry.generator.version !== WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_GENERATOR.version
    ) {
      return {
        issue: {
          code: "outdated_worker_admission_derived_evidence",
          message: "worker-admission derived evidence generator version is outdated",
          details: {
            derived_evidence_index: index,
            derived_evidence_generator_version: entry.generator.version
          }
        }
      };
    }

    if (typeof entry.source_record_digest === "string" && entry.source_record_digest !== sourceDigest) {
      return {
        issue: {
          code: "stale_worker_admission_derived_evidence",
          message: "worker-admission derived evidence is stale",
          details: {
            derived_evidence_index: index,
            source_digest: entry.source_record_digest,
            current_source_digest: sourceDigest
          }
        }
      };
    }
  }

  return {
    entry: matchingEntries[0].entry,
    index: matchingEntries[0].index,
    issue: null
  };
}

function createWorkerAdmissionDerivedEvidenceRefusal(
  issue,
  recordId,
  unitAddress = null,
  { structuredRefreshRouteAvailable = true } = {}
) {
  const structuredRefreshRoute = buildWorkerAdmissionDerivedEvidenceStructuredRefreshRoute();
  const refreshCommand = buildWorkerAdmissionDerivedEvidenceRefreshCommand(
    unitAddress || recordId
  );
  const humanOperatorFallback = {
    refresh_command: refreshCommand
  };
  const refusal = {
    code: issue.code,
    message: issue.message,
    refresh_route: structuredRefreshRoute,

    refresh_command: structuredRefreshRoute,
    details: {
      ...issue.details,
      refresh_route: structuredRefreshRoute,
      human_operator_fallback: humanOperatorFallback
    }
  };

  if (!structuredRefreshRouteAvailable) {
    refusal.code = WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_BLOCKER;
    refusal.message = `structured refresh route ${structuredRefreshRoute} is unavailable`;
    refusal.details = {
      ...issue.details,
      blocked_issue_code: issue.code,
      refresh_route: structuredRefreshRoute,
      human_operator_fallback: humanOperatorFallback
    };
  }

  if (typeof unitAddress === "string" && unitAddress.includes("#")) {
    refusal.unit_address = unitAddress;
  }

  return refusal;
}

async function createLiveWorkerAdmissionDerivedEvidence({
  dir,
  record,
  requestedUnit
}) {
  const selectedSlice =
    requestedUnit.kind === "slice" && Array.isArray(record.slices)
      ? record.slices.find((entry) => isObject(entry) && entry.id === requestedUnit.slice_id) || null
      : null;

  if (requestedUnit.kind === "slice" && !selectedSlice) {
    return {
      issue: {
        code: "invalid_record",
        message: `Selected slice ${requestedUnit.slice_id} does not exist on ${record.id}`,
        details: {}
      }
    };
  }

  const materializationSubject =
    requestedUnit.kind === "slice"
      ? {
          ...cloneJson(selectedSlice),
          id: record.id,
          kind: "slice",
          slice_id: selectedSlice.id
        }
      : record;
  const sourceRecordDigest = computeWorkRecordSourceDigest(record);
  const recordLocalInputs = await createWorkRecordAdmissionRecordLocalInputs({
    dir,
    record: materializationSubject
  });
  const contextualStructuralTargetMetrics = createContextualizedStructuralTargetMetrics(
    materializationSubject,
    recordLocalInputs,
    requestedUnit.unit,
    sourceRecordDigest
  );
  const dispatchReadiness =
    requestedUnit.kind === "slice"
      ? createDispatchReadinessForUnit(record.id, requestedUnit)
      : createRecordLevelDispatchReadiness(record.id);

  return {
    evidence: createWorkRecordAdmissionDerivedEvidence({
      record,
      repo: record.repo,
      work_unit_metrics: recordLocalInputs.work_unit_metrics,
      file_stats: recordLocalInputs.file_stats,
      validation_command_metadata: recordLocalInputs.validation_command_metadata,
      runtime_mode_metadata: recordLocalInputs.runtime_mode_metadata,
      artifact_kind_metadata: recordLocalInputs.artifact_kind_metadata,
      structural_target_metrics: contextualStructuralTargetMetrics,
      metric_source_provenance: contextualStructuralTargetMetrics.metric_source_provenance,
      dispatch_readiness: dispatchReadiness,

      clock: systemUtcClock
    })
  };
}

function isWorkerAdmissionDerivedEvidenceForUnit(entry, recordId, unit) {
  return (
    isObject(entry) &&
    entry.decision_kind === "work_unit_atomicity" &&
    entry.record_id === recordId &&
    isObject(entry.unit) &&
    entry.unit.kind === unit.kind &&
    entry.unit.address === unit.address &&
    entry.unit.record_id === recordId &&
    entry.unit.slice_id === unit.slice_id
  );
}

function resolveWorkerAdmissionReviewAttestationRepoBinding(derivedEvidence, previousEntry, persistedEvidence) {
  const repoCandidates = [
    derivedEvidence?.normalized_request?.subject?.repo,
    derivedEvidence?.repo,
    persistedEvidence?.normalized_request?.subject?.repo,
    persistedEvidence?.repo,
    previousEntry?.normalized_request?.subject?.repo,
    previousEntry?.repo
  ]
    .map((repo) => normalizeNonEmptyString(repo))
    .filter(Boolean);

  if (repoCandidates.length === 0) {
    return null;
  }

  const [firstCandidate, ...otherCandidates] = repoCandidates;
  if (otherCandidates.some((repo) => repo !== firstCandidate)) {
    return null;
  }

  return firstCandidate;
}

async function carryForwardPersistedReviewAttestations(
  previousEntry,
  derivedEvidence,
  dir,
  currentSourceDigest
) {
  if (!isObject(previousEntry) || !isObject(derivedEvidence)) {
    return;
  }

  const recordId = normalizeNonEmptyString(previousEntry.record_id) || normalizeNonEmptyString(derivedEvidence.record_id);
  const unit = isObject(derivedEvidence.unit) ? derivedEvidence.unit : null;
  const currentDigest = normalizeNonEmptyString(currentSourceDigest);
  const freshDigest = normalizeNonEmptyString(derivedEvidence.source_record_digest);
  const previousDigest = normalizeNonEmptyString(previousEntry.source_record_digest);
  if (
    !recordId ||
    !unit ||
    !isWorkerAdmissionDerivedEvidenceForUnit(previousEntry, recordId, unit) ||
    !currentDigest ||
    !freshDigest ||
    previousDigest !== currentDigest ||
    freshDigest !== currentDigest
  ) {
    return;
  }

  const freshReviewAttestations = derivedEvidence.normalized_request?.evidence?.review_attestations;
  if (Array.isArray(freshReviewAttestations) && freshReviewAttestations.length > 0) {
    return;
  }

  let persistedEvidence = null;
  if (isObject(previousEntry.normalized_request)) {
    persistedEvidence = previousEntry;
  } else if (isCompactWorkerAdmissionEntryWithSidecar(previousEntry)) {
    const rehydrated = await evaluateCompactWorkerAdmissionEntryViaSidecar({
      dir,
      entry: previousEntry
    });
    persistedEvidence = rehydrated?.evidence ?? null;
  }

  const persistedAttestations = persistedEvidence?.normalized_request?.evidence?.review_attestations;
  if (!Array.isArray(persistedAttestations) || persistedAttestations.length === 0) {
    return;
  }

  const selectedUnitAddress = normalizeNonEmptyString(unit.address);
  const currentRepo = resolveWorkerAdmissionReviewAttestationRepoBinding(
    derivedEvidence,
    previousEntry,
    persistedEvidence
  );
  if (!currentRepo) {
    return;
  }
  const admittingRunId = `refresh:${recordId}:${selectedUnitAddress || "unknown"}:${freshDigest}`;
  const now = new Date().toISOString();
  const validatedAttestations = [];
  for (const attestation of persistedAttestations) {
    if (!isObject(attestation)) {
      continue;
    }
    const reviewerRoleClass = normalizeNonEmptyString(attestation.reviewer_role_class);
    const reviewedControls = Array.isArray(attestation.reviewed_controls)
      ? attestation.reviewed_controls
      : null;
    const verdict = validateReviewAttestation(attestation, {
      repo: currentRepo,
      unit_address: selectedUnitAddress,
      source_digest: freshDigest,
      required_role_class: reviewerRoleClass,
      required_controls: reviewedControls,
      admitting_run_id: admittingRunId,
      now
    });
    if (verdict?.valid === true) {
      validatedAttestations.push(cloneJson(attestation));
    }
  }

  if (validatedAttestations.length === 0) {
    return;
  }

  if (!isObject(derivedEvidence.normalized_request.evidence)) {
    derivedEvidence.normalized_request.evidence = {};
  }
  derivedEvidence.normalized_request.evidence.review_attestations = validatedAttestations;
}

function upsertWorkerAdmissionDerivedEvidenceEntries(record, derivedEvidence, currentSourceDigest = null) {
  const entries = Array.isArray(record.derived_evidence) ? record.derived_evidence : [];
  const previousEntry = entries.find((entry) =>
    isWorkerAdmissionDerivedEvidenceForUnit(entry, record.id, derivedEvidence.unit)
  );
  if (previousEntry) {
    carryForwardSourceCompatibleGraphImpactEvidence(previousEntry, derivedEvidence, currentSourceDigest);
  }
  const filteredEntries = entries.filter(
    (entry) => !isWorkerAdmissionDerivedEvidenceForUnit(entry, record.id, derivedEvidence.unit)
  );
  return [...filteredEntries, derivedEvidence];
}

function createInvalidRefreshResult({ recordId = null, diagnostics = [] } = {}) {
  return {
    record_id: recordId,
    source_path: null,
    source_digest: null,
    record: null,
    diagnostics,
    derived_evidence: null,
    valid: false,
    written: false,
    canonical_record_path: null
  };
}

function createStaleRefreshResult({
  loaded,
  currentSourceDigest,
  expectedSourceDigest,
  diagnostics = []
} = {}) {
  return {
    ...loaded,
    valid: false,
    written: false,
    record: loaded?.record ?? null,
    source_digest: currentSourceDigest,
    expected_source_digest: expectedSourceDigest,
    current_source_digest: currentSourceDigest,
    diagnostics: [...(Array.isArray(loaded?.diagnostics) ? loaded.diagnostics : []), ...diagnostics],
    derived_evidence: null
  };
}

function isCompactWorkerAdmissionEntryWithSidecar(entry) {
  return (
    isObject(entry) &&
    !Object.prototype.hasOwnProperty.call(entry, "normalized_request") &&
    typeof entry.sidecar_path === "string" &&
    entry.sidecar_path.length > 0 &&
    typeof entry.sidecar_digest === "string" &&
    entry.sidecar_digest.length > 0
  );
}

function rehydratedSidecarBindsToCompactEntry(rehydrated, entry) {
  if (!isObject(rehydrated) || !isObject(entry)) {
    return false;
  }
  if (!isObject(rehydrated.normalized_request)) {
    return false;
  }
  const rehydratedUnit = isObject(rehydrated.unit) ? rehydrated.unit : null;
  const entryUnit = isObject(entry.unit) ? entry.unit : null;
  if (!rehydratedUnit || !entryUnit) {
    return false;
  }
  return (
    normalizeNonEmptyString(rehydrated.schema_version) === normalizeNonEmptyString(entry.schema_version) &&
    normalizeNonEmptyString(rehydrated.decision_kind) === normalizeNonEmptyString(entry.decision_kind) &&
    normalizeNonEmptyString(rehydrated.record_id) === normalizeNonEmptyString(entry.record_id) &&
    normalizeNonEmptyString(rehydrated.source_record_digest) ===
      normalizeNonEmptyString(entry.source_record_digest) &&
    normalizeNonEmptyString(rehydrated.generated_at) === normalizeNonEmptyString(entry.generated_at) &&
    normalizeNonEmptyString(rehydratedUnit.kind) === normalizeNonEmptyString(entryUnit.kind) &&
    normalizeNonEmptyString(rehydratedUnit.address) === normalizeNonEmptyString(entryUnit.address) &&
    normalizeNonEmptyString(rehydratedUnit.record_id) === normalizeNonEmptyString(entryUnit.record_id) &&
    normalizeNonEmptyString(rehydratedUnit.slice_id) === normalizeNonEmptyString(entryUnit.slice_id)
  );
}

async function evaluateCompactWorkerAdmissionEntryViaSidecar({ dir, entry }) {
  if (!isCompactWorkerAdmissionEntryWithSidecar(entry)) {
    return null;
  }
  let rehydrated;
  try {
    const sidecarAbsolutePath = path.resolve(dir, entry.sidecar_path);
    rehydrated = JSON.parse(await readFile(sidecarAbsolutePath, "utf8"));
  } catch {
    return null;
  }
  if (!isObject(rehydrated)) {
    return null;
  }
  let rehydratedDigest;
  try {
    rehydratedDigest = computeWorkRecordAdmissionDerivedEvidenceSidecarDigest(rehydrated);
  } catch {
    return null;
  }
  if (rehydratedDigest !== entry.sidecar_digest) {
    return null;
  }
  if (!rehydratedSidecarBindsToCompactEntry(rehydrated, entry)) {
    return null;
  }
  try {
    return { admission: evaluateWorkRecordAdmissionDerivedEvidence(rehydrated), evidence: rehydrated };
  } catch {
    return null;
  }
}

const LARGE_FILE_AUTHORITY_SENSITIVE_DECISION_CODES = new Set([
  "worker_admission.work_unit_atomicity.max_write_file_loc_denied.v1",
  "worker_admission.work_unit_atomicity.large_file_dec_authority_missing_or_expired.v1",
  "worker_admission.work_unit_atomicity.large_file_requires_review.v1",
  "worker_admission.work_unit_atomicity.large_file_pressure_annotated.v1"
]);

function admissionDecisionIsLargeFileAuthoritySensitive(admission) {
  if (!isObject(admission)) {
    return false;
  }
  if (
    typeof admission.decision_code === "string" &&
    LARGE_FILE_AUTHORITY_SENSITIVE_DECISION_CODES.has(admission.decision_code)
  ) {
    return true;
  }
  return (
    Array.isArray(admission.decision_codes) &&
    admission.decision_codes.some(
      (code) => typeof code === "string" && LARGE_FILE_AUTHORITY_SENSITIVE_DECISION_CODES.has(code)
    )
  );
}

export async function evaluateWorkRecordAdmissionDerivedEvidenceById({
  dir = ".",
  id,
  unitAddress = null,
  structuredRefreshRouteAvailable: structuredRefreshRouteAvailableOption = true,
  structured_refresh_route_available: structuredRefreshRouteAvailableSnake = null,
  recordStore = null
} = {}) {
  const targetDir = path.resolve(String(dir));
  const structuredRefreshRouteAvailable =
    structuredRefreshRouteAvailableSnake ?? structuredRefreshRouteAvailableOption;
  const requestedUnit = parseDispatchUnitAddress(unitAddress ?? id);
  if (!requestedUnit.ok) {
    return {
      valid: false,
      source_path: null,
      source_path_relative: null,
      source_digest: null,
      record_id: null,
      record: null,
      diagnostics: [
        {
          code: requestedUnit.error.code,
          severity: "error",
          message: requestedUnit.error.message,
          path: requestedUnit.error.path
        }
      ],
      duplicate_claims: [],
      record_level_derived_evidence: null,
      record_level_derived_evidence_index: null,
      admission: null,
      admission_refusal: createWorkerAdmissionDerivedEvidenceRefusal(
        {
          code: requestedUnit.error.code,
          message: requestedUnit.error.message,
          details: {}
        },
        id,
        typeof unitAddress === "string" ? unitAddress : null,
        { structuredRefreshRouteAvailable }
      )
    };
  }

  const loaded = await loadWorkRecordById({ dir: targetDir, id: requestedUnit.recordId, recordStore });

  if (!loaded.record) {
    return {
      ...loaded,
      record_level_derived_evidence: null,
      admission: null,
      admission_refusal: null
    };
  }

  const derivedEvidenceDiagnostic = loaded.diagnostics.find(
    (entry) =>
      entry.severity === "error" &&
      isWorkerAdmissionDerivedEvidenceDiagnosticPath(entry.path)
  );
  if (derivedEvidenceDiagnostic) {
    const recordId = loaded.record_id || loaded.record.id || id;
    return {
      ...loaded,
      record_level_derived_evidence: null,
      admission: null,
      admission_refusal: createWorkerAdmissionDerivedEvidenceRefusal(
        {
          code: "malformed_worker_admission_derived_evidence",
          message: "worker-admission derived evidence is malformed",
          details: {
            diagnostic_code: derivedEvidenceDiagnostic.code,
            diagnostic_path: derivedEvidenceDiagnostic.path
          }
        },
        recordId,
        null,
        { structuredRefreshRouteAvailable }
      )
    };
  }

  const sourceDigest = loaded.source_digest || computeWorkRecordSourceDigest(loaded.record);
  const issueOrEntry = getWorkerAdmissionDerivedEvidenceIssueForUnit(
    loaded.record,
    sourceDigest,
    requestedUnit.unit
  );
  if (issueOrEntry?.issue) {
    const recordId = loaded.record_id || loaded.record.id || id;
    if (issueOrEntry.issue.code === "missing_worker_admission_derived_evidence") {
      const liveEvidence = await createLiveWorkerAdmissionDerivedEvidence({
        dir: targetDir,
        record: loaded.record,
        requestedUnit: requestedUnit.unit
      });
      if (liveEvidence.evidence) {
        return {
          ...loaded,
          selected_unit: requestedUnit.unit,
          record_level_derived_evidence: liveEvidence.evidence,
          record_level_derived_evidence_index: null,
          admission: evaluateWorkRecordAdmissionDerivedEvidence(liveEvidence.evidence),
          admission_refusal: null,
          admission_source: "live_unmaterialized"
        };
      }
      if (liveEvidence.issue) {
        return {
          ...loaded,
          record_level_derived_evidence: null,
          admission: null,
          admission_refusal: createWorkerAdmissionDerivedEvidenceRefusal(
            liveEvidence.issue,
            recordId,
            requestedUnit.unit.kind === "slice" ? requestedUnit.unit.address : null,
            { structuredRefreshRouteAvailable }
          )
        };
      }
    }
    return {
      ...loaded,
      record_level_derived_evidence: null,
      admission: null,
      admission_refusal: createWorkerAdmissionDerivedEvidenceRefusal(
        issueOrEntry.issue,
        recordId,
        requestedUnit.unit.kind === "slice" ? requestedUnit.unit.address : null,
        { structuredRefreshRouteAvailable }
      )
    };
  }

  const admission = evaluateWorkRecordAdmissionDerivedEvidence(issueOrEntry.entry);

  if (admissionDecisionIsLargeFileAuthoritySensitive(admission)) {
    const sidecarAdmission = await evaluateCompactWorkerAdmissionEntryViaSidecar({
      dir: targetDir,
      entry: issueOrEntry.entry
    });
    if (sidecarAdmission) {
      return {
        ...loaded,
        selected_unit: requestedUnit.unit,
        record_level_derived_evidence: sidecarAdmission.evidence,
        record_level_derived_evidence_index: issueOrEntry.index,
        admission: sidecarAdmission.admission,
        admission_refusal: null,
        admission_source: "rehydrated_admission_sidecar"
      };
    }
  }

  return {
    ...loaded,
    selected_unit: requestedUnit.unit,
    record_level_derived_evidence: issueOrEntry.entry,
    record_level_derived_evidence_index: issueOrEntry.index,
    admission,
    admission_refusal: null
  };
}

export function materializeWorkRecordAdmissionDerivedEvidence({
  record,
  ...options
} = {}) {
  return createWorkRecordAdmissionDerivedEvidence({
    record,

    clock: systemUtcClock,
    ...options
  });
}

export async function refreshWorkRecordAdmissionDerivedEvidenceById({
  dir = ".",
  id,
  unitAddress = null,
  expectedSourceDigest: expectedSourceDigestOption = null,
  expected_source_digest: expectedSourceDigestSnake = null,
  recordStore = null,
  ...options
} = {}) {
  const targetDir = path.resolve(String(dir));
  const expectedSourceDigest = expectedSourceDigestOption ?? expectedSourceDigestSnake;
  const requestedUnit = parseDispatchUnitAddress(unitAddress ?? id);
  if (!requestedUnit.ok) {
    return createInvalidRefreshResult({
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

  const loaded = await loadWorkRecordById({ dir: targetDir, id: requestedUnit.recordId, recordStore });

  if (loaded.diagnostics.some((entry) => entry.code === "missing_json_record")) {
    return loaded;
  }

  if (!loaded.record) {
    return loaded;
  }

  const currentSourceDigest = loaded.source_digest || computeWorkRecordSourceDigest(loaded.record);

  if (expectedSourceDigest !== null && expectedSourceDigest !== undefined) {
    if (typeof expectedSourceDigest !== "string" || expectedSourceDigest.length === 0) {
      return {
        ...loaded,
        valid: false,
        written: false,
        record: loaded.record,
        source_digest: currentSourceDigest,
        expected_source_digest: expectedSourceDigest,
        current_source_digest: null,
        diagnostics: [
          ...(Array.isArray(loaded.diagnostics) ? loaded.diagnostics : []),
          {
            code: "invalid_expected_source_digest",
            severity: "error",
            message: "expected source digest must be a non-empty string",
            path: loaded.source_path || null
          }
        ],
        derived_evidence: null
      };
    }

    if (currentSourceDigest !== expectedSourceDigest) {
      return createStaleRefreshResult({
        loaded,
        currentSourceDigest,
        expectedSourceDigest,
        diagnostics: [
          {
            code: "stale_source_digest",
            severity: "error",
            message: "expected source digest does not match the current on-disk record",
            path: loaded.source_path || null
          }
        ]
      });
    }
  }

  const validationErrors = loaded.diagnostics.filter(
    (entry) =>
      entry.severity === "error" &&
      !isSelectedUnitAdmissionSummaryRefreshDiagnostic(
        loaded.record,
        entry,
        requestedUnit.unit
      )
  );
  if (
    validationErrors.some((entry) => !isWorkerAdmissionDerivedEvidenceDiagnosticPath(entry.path))
  ) {
    return loaded;
  }

  const updatedRecord = canonicalizeWorkRecordReadScope(cloneJson(loaded.record));
  updatedRecord.updated = todayDateString();

  const materializedSourceDigest = computeWorkRecordSourceDigest(updatedRecord);
  const selectedSlice =
    requestedUnit.unit.kind === "slice"
      ? Array.isArray(updatedRecord.slices)
        ? updatedRecord.slices.find((entry) => isObject(entry) && entry.id === requestedUnit.unit.slice_id) ||
          null
        : null
      : null;

  if (requestedUnit.unit.kind === "slice" && !selectedSlice) {
    return {
      ...loaded,
      valid: false,
      diagnostics: [
        ...loaded.diagnostics,
        {
          code: "invalid_record",
          severity: "error",
          message: `Selected slice ${requestedUnit.unit.slice_id} does not exist on ${loaded.record.id}`,
          path: "unit"
        }
      ],
      written: false
    };
  }

  const priorDerivedEvidenceEntry = Array.isArray(loaded.record.derived_evidence)
    ? loaded.record.derived_evidence.find((entry) =>
        isWorkerAdmissionDerivedEvidenceForUnit(entry, loaded.record.id, requestedUnit.unit)
      ) || null
    : null;

  const materializationSubject =
    requestedUnit.unit.kind === "slice"
      ? {
          ...cloneJson(selectedSlice),
          id: loaded.record.id,
          kind: "slice",
          slice_id: selectedSlice.id
        }
      : updatedRecord;
  const {
    dispatch_readiness: dispatchReadinessOption,
    dispatchReadiness: camelDispatchReadiness,
    work_unit_metrics: workUnitMetricsOption,
    workUnitMetrics: camelWorkUnitMetrics,
    file_stats: fileStatsOption,
    fileStats: camelFileStats,
    validation_command_metadata: validationCommandMetadataOption,
    validationCommandMetadata: camelValidationCommandMetadata,
    runtime_mode_metadata: runtimeModeMetadataOption,
    runtimeModeMetadata: camelRuntimeModeMetadata,
    artifact_kind_metadata: artifactKindMetadataOption,
    artifactKindMetadata: camelArtifactKindMetadata,
    metric_source_provenance: metricSourceProvenanceOption,
    metricSourceProvenance: camelMetricSourceProvenance,
    ...refreshOptions
  } = options;
  const dispatchReadinessBase =
    dispatchReadinessOption ??
    camelDispatchReadiness ??
    (requestedUnit.unit.kind === "slice"
      ? createDispatchReadinessForUnit(updatedRecord.id, requestedUnit.unit)
      : createRecordLevelDispatchReadiness(updatedRecord.id));
  const dispatchReadiness = {
    ...dispatchReadinessBase,
    record_id: updatedRecord.id,
    unit: requestedUnit.unit
  };
  const recordLocalInputs = await createWorkRecordAdmissionRecordLocalInputs({
    dir: targetDir,
    record: materializationSubject,

    sourceRecordDigestOverride: materializedSourceDigest
  });
  const contextualStructuralTargetMetrics = createContextualizedStructuralTargetMetrics(
    materializationSubject,
    recordLocalInputs,
    requestedUnit.unit,
    materializedSourceDigest
  );
  const derivedEvidence = createWorkRecordAdmissionDerivedEvidence({
    record: updatedRecord,
    repo: updatedRecord.repo,
    work_unit_metrics: workUnitMetricsOption ?? camelWorkUnitMetrics ?? recordLocalInputs.work_unit_metrics,
    file_stats: fileStatsOption ?? camelFileStats ?? recordLocalInputs.file_stats,
    validation_command_metadata:
      validationCommandMetadataOption ??
      camelValidationCommandMetadata ??
      recordLocalInputs.validation_command_metadata,
    runtime_mode_metadata:
      runtimeModeMetadataOption ?? camelRuntimeModeMetadata ?? recordLocalInputs.runtime_mode_metadata,
    artifact_kind_metadata:
      artifactKindMetadataOption ?? camelArtifactKindMetadata ?? recordLocalInputs.artifact_kind_metadata,
    structural_target_metrics: contextualStructuralTargetMetrics,
    metric_source_provenance:
      metricSourceProvenanceOption ??
      camelMetricSourceProvenance ??
      contextualStructuralTargetMetrics.metric_source_provenance,

    clock: systemUtcClock,
    ...refreshOptions,
    dispatch_readiness: dispatchReadiness
  });
  await carryForwardPersistedReviewAttestations(
    priorDerivedEvidenceEntry,
    derivedEvidence,
    targetDir,
    currentSourceDigest
  );
  const admissionSummary = createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary(
    evaluateWorkRecordAdmissionDerivedEvidence(derivedEvidence)
  );
  const sidecarRelativePath = buildWorkRecordAdmissionDerivedEvidenceSidecarRelativePath(derivedEvidence);
  const sidecarAbsolutePath = path.resolve(targetDir, sidecarRelativePath);
  const sidecarPayload = cloneJson(derivedEvidence);
  const sidecarDigest = computeWorkRecordAdmissionDerivedEvidenceSidecarDigest(sidecarPayload);
  const persistedDerivedEvidence = createPersistedWorkerAdmissionDerivedEvidence(derivedEvidence, {
    sidecarPath: sidecarRelativePath,
    sidecarDigest,
    admissionSummary,

    retainInlineTargetResolutionBinding: true
  });
  updatedRecord.derived_evidence = upsertWorkerAdmissionDerivedEvidenceEntries(
    updatedRecord,
    persistedDerivedEvidence,
    currentSourceDigest
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
      derived_evidence: derivedEvidence,
      written: false
    };
  }

  await writeWorkRecordAdmissionDerivedEvidenceSidecar(sidecarAbsolutePath, sidecarPayload);

  const writeResult = await writeValidatedWorkRecord({
    dir: targetDir,
    record: updatedRecord,
    expectedSourceDigest: currentSourceDigest,
    recordStore
  });

  return {
    ...loaded,
    ...writeResult,
    valid: writeResult.valid,
    diagnostics: writeResult.diagnostics,
    record: updatedRecord,
    source_digest: writeResult.source_digest || sourceDigest,
    derived_evidence: derivedEvidence,
    written: Boolean(writeResult.written),
    canonical_record_path: writeResult.canonical_record_path || getWorkRecordPath(targetDir, updatedRecord.id)
  };
}

export {
  upsertWorkerAdmissionDerivedEvidenceEntries,

  carryForwardPersistedReviewAttestations,
  isWorkerAdmissionDerivedEvidenceForUnit
};
