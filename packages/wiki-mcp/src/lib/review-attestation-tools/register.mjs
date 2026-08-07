

import {
  buildReviewAttestation,
  computeReviewedUnitSourceDigest,
  REVIEW_ATTESTATION_AUTHORITY,
  REVIEW_ATTESTATION_REVIEW_OUTCOME_VALUES
} from "@agent-chassis/wiki-core/src/lib/work-record-review-attestation.mjs";
import { SLICE_ID_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  classifyNonNegativeInteger,
  computeNormalizedInputDigest
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-shared.mjs";
import {
  computeNormalizedRequestOutputHash,
  evaluateWorkRecordAdmissionDerivedEvidence
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-derived-evidence.mjs";
import {
  createPersistedWorkerAdmissionDerivedEvidence,
  createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary,
  prepareWorkRecordAdmissionDerivedEvidenceSidecar
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-derived-evidence-persist.mjs";
import {
  readPersistedWorkerAdmissionEvidenceSidecar,
  WorkerAdmissionSidecarError
} from "@agent-chassis/wiki-core/src/lib/work-record-admission-evidence-sidecar.mjs";
import {
  materializeWorkRecordAdmissionDerivedEvidence,
  readWorkRecordById
} from "@agent-chassis/wiki-core";
import {
  computeWorkRecordPersistenceSnapshotDigest,
  writeValidatedWorkRecordWithAdmissionSidecars
} from "@agent-chassis/wiki-core/src/operations/work-records-store-io.mjs";
import {
  upsertWorkerAdmissionDerivedEvidenceEntries
} from "@agent-chassis/wiki-core/src/operations/work-records-admission-evidence.mjs";

const TOOL_NAME = "workspace_record_review_attestation";

const ACCEPTED_REVIEW_STATUS = "accepted";

const RECORDED_DECISION_CODE = "review_attestation.recorded.v1";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function trimmed(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseWorkRecordUnitAddress(unitAddress) {
  const normalizedAddress = typeof unitAddress === "string" ? unitAddress.trim() : "";
  if (!normalizedAddress) {
    return null;
  }
  const pieces = normalizedAddress.split("#");
  if (pieces.length > 2 || !/^WK-[0-9]{4}$/.test(pieces[0])) {
    return null;
  }
  if (pieces.length === 1) {
    return { kind: "work_item", address: pieces[0], record_id: pieces[0], slice_id: null };
  }
  const sliceId = pieces[1];
  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return null;
  }
  return { kind: "slice", address: normalizedAddress, record_id: pieces[0], slice_id: sliceId };
}

function recordHasSlice(record, sliceId) {
  return Array.isArray(record?.slices) && record.slices.some((slice) => slice && slice.id === sliceId);
}

function getLoadedWorkRecordUnit(record, unit) {
  if (!isObject(record) || !unit) {
    return null;
  }
  if (unit.kind === "work_item") {
    return record;
  }
  if (!Array.isArray(record?.slices)) {
    return null;
  }
  return record.slices.find((slice) => slice && slice.id === unit.slice_id) ?? null;
}

function unitReferenceCandidates(unit) {

  if (unit.kind === "slice") {
    return new Set([unit.address, `${unit.record_id}#${unit.slice_id}`]);
  }
  return new Set([unit.address, unit.record_id]);
}

function unitRecordReferencesUnit(unitRecord, targetUnit) {
  if (!isObject(unitRecord) || !targetUnit) {
    return false;
  }
  const targetRefs = unitReferenceCandidates(targetUnit);
  for (const fieldName of ["depends_on", "related", "blocks"]) {
    const values = Array.isArray(unitRecord[fieldName]) ? unitRecord[fieldName] : [];
    for (const value of values) {
      const ref = trimmed(value);
      if (ref && targetRefs.has(ref)) {
        return true;
      }
    }
  }
  return false;
}

function unitsHaveDurableRelationship(leftRecord, leftUnit, rightRecord, rightUnit) {
  return unitRecordReferencesUnit(leftRecord, rightUnit) || unitRecordReferencesUnit(rightRecord, leftUnit);
}

function nextActionForRefusal(decisionCode) {
  switch (decisionCode) {
    case "review_attestation.unaccepted_status.v1":
      return "Retry workspace_record_review_attestation with status=accepted after trusted review evidence is ready.";
    case "review_attestation.stale_source_digest.v1":
      return "Reload the current canonical work-record digest, then retry workspace_record_review_attestation with that digest.";
    case "review_attestation.wrong_role.v1":
      return "Use workspace_work_record_shape_review_unit for an empty-write-scope findings-only reviewer/redteam unit, then workspace_agent_dispatch; retry after terminal clean review.";
    case "review_attestation.non_terminal.v1":
      return "Poll workspace_agent_run_status for the trusted review run and retry only after terminal-success review evidence exists.";
    case "review_attestation.wrong_unit.v1":
      return "Reload the canonical units and repair the durable review-target relationship before dispatching review and retrying attestation.";
    case "review_attestation.blocking_findings.v1":
    case "review_attestation.unaccepted_outcome.v1":
      return "Remediate the findings, dispatch a fresh trusted findings-only review, then retry only after an accepted structured outcome.";
    case "review_attestation.untrusted_provenance.v1":
      return "Dispatch a trusted findings-only reviewer/redteam, poll workspace_agent_run_status, then retry with its backend-minted run reference.";
    case "review_attestation.missing_trusted_review_result_api.v1":
      return "Use workspace_agent_run_status to obtain trusted structured review_result evidence before retrying attestation.";
    default:
      return null;
  }
}

function refusal(decisionCode, reasons, extra = {}) {
  const nextAction = nextActionForRefusal(decisionCode);
  return {
    tool: TOOL_NAME,
    recorded: false,
    launch_authoritative: false,
    decision_code: decisionCode,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
    ...extra,
    ...(nextAction ? { next_action: nextAction } : {})
  };
}

function buildDispatchReadinessForUnit(record, unit) {
  return {
    record_id: unit.record_id,
    unit,
    dispatchable: true,
    decision_code: "review_attestation.record_time_materialization.v1",
    reasons: []
  };
}

async function createFullEvidenceForAttestation({ workspace, record, unit, sourceDigest }) {
  const priorFullEvidence = await readPersistedWorkerAdmissionEvidenceSidecar({
    dir: workspace.dir,
    record,
    selectedUnit: unit,
    sourceDigest
  });
  if (priorFullEvidence) {
    return priorFullEvidence;
  }
  return materializeWorkRecordAdmissionDerivedEvidence({
    record,
    repo: record.repo,
    dispatch_readiness: buildDispatchReadinessForUnit(record, unit)
  });
}

function refreshNormalizedRequestOutputHashes(normalizedRequest) {
  if (!isObject(normalizedRequest)) {
    return;
  }
  const outputHash = computeNormalizedRequestOutputHash(normalizedRequest);
  if (Array.isArray(normalizedRequest.artifact_refs)) {
    for (const ref of normalizedRequest.artifact_refs) {
      if (
        isObject(ref) &&
        isNonEmptyString(ref.produced_by_preparation_output_hash) &&
        ref.produced_by_preparation_output_hash !== "not_applicable"
      ) {
        ref.produced_by_preparation_output_hash = outputHash;
      }
    }
  }
  if (Array.isArray(normalizedRequest.preparation_audit_refs)) {
    for (const ref of normalizedRequest.preparation_audit_refs) {
      if (isObject(ref) && isNonEmptyString(ref.output_hash)) {
        ref.output_hash = outputHash;
      }
    }
  }
}

function upsertReviewAttestation(fullEvidence, attestation) {
  const updated = cloneJson(fullEvidence);
  if (!isObject(updated.normalized_request)) {
    throw new Error(`${TOOL_NAME} could not materialize a full worker-admission evidence sidecar`);
  }
  if (!isObject(updated.normalized_request.evidence)) {
    updated.normalized_request.evidence = {};
  }
  const current = Array.isArray(updated.normalized_request.evidence.review_attestations)
    ? updated.normalized_request.evidence.review_attestations
    : [];
  updated.normalized_request.evidence.review_attestations = [
    ...current.filter((entry) => entry?.attestation_id !== attestation.attestation_id),
    cloneJson(attestation)
  ];
  refreshNormalizedRequestOutputHashes(updated.normalized_request);
  return updated;
}

async function persistReviewAttestation({
  workspace,
  loaded,
  unit,
  sourceDigest,
  recordSourceDigest,
  attestation
}) {
  const persistenceSnapshotDigest = computeWorkRecordPersistenceSnapshotDigest(loaded.record);
  const updatedRecord = cloneJson(loaded.record);
  const fullEvidence = await createFullEvidenceForAttestation({
    workspace,
    record: updatedRecord,
    unit,
    sourceDigest
  });
  const fullEvidenceWithAttestation = upsertReviewAttestation(fullEvidence, attestation);
  const admissionSummary = createWorkRecordAdmissionDerivedEvidenceCompactAdmissionSummary(
    evaluateWorkRecordAdmissionDerivedEvidence(fullEvidenceWithAttestation)
  );
  const sidecarPublication =
    prepareWorkRecordAdmissionDerivedEvidenceSidecar(fullEvidenceWithAttestation);
  const sidecarRelativePath = sidecarPublication.relativePath;
  const sidecarDigest = sidecarPublication.digest;
  const compactEntry = createPersistedWorkerAdmissionDerivedEvidence(fullEvidenceWithAttestation, {
    sidecarPath: sidecarRelativePath,
    sidecarDigest,
    admissionSummary,
    retainInlineTargetResolutionBinding: true
  });
  updatedRecord.derived_evidence = upsertWorkerAdmissionDerivedEvidenceEntries(
    updatedRecord,
    compactEntry,
    sourceDigest
  );

  const writeResult = await writeValidatedWorkRecordWithAdmissionSidecars({
    dir: workspace.dir,
    record: updatedRecord,
    expectedSourceDigest: recordSourceDigest,
    expectedPersistenceSnapshotDigest: persistenceSnapshotDigest,
    admissionSidecars: [sidecarPublication]
  });
  if (!writeResult?.written) {
    const error = new Error(`${TOOL_NAME} failed to persist review attestation`);
    error.code = writeResult?.diagnostics?.[0]?.code ?? "work_record_write_failed";
    error.diagnostics = writeResult?.diagnostics ?? [];
    throw error;
  }
  return {
    evidence: fullEvidenceWithAttestation,
    compact_entry: compactEntry,
    sidecar_path: sidecarRelativePath,
    sidecar_digest: sidecarDigest,
    source_digest: sourceDigest,
    record_source_digest: writeResult.source_digest ?? recordSourceDigest
  };
}

function normalizeReviewRunRef(value) {
  if (!isObject(value)) {
    return null;
  }
  const runId = trimmed(value.run_id);
  const monitorHandle = trimmed(value.monitor_handle);
  if (!runId && !monitorHandle) {
    return null;
  }
  return { run_id: runId, monitor_handle: monitorHandle };
}

function mapRunStatusRefusalToDecisionCode(status) {
  const code = status?.refusal?.code;
  if (code === "monitor_handle_subject_mismatch") {
    return "review_attestation.wrong_unit.v1";
  }
  return "review_attestation.untrusted_provenance.v1";
}

function trustedReviewResultApiBlocker(reason) {
  return refusal(
    "review_attestation.missing_trusted_review_result_api.v1",
    [reason],
    {
      blocker: {
        code: "review_attestation.missing_trusted_review_result_api.v1",
        missing_api:
          "dispatchBackend.getRunStatus().review_result.{review_outcome,blocking_finding_count,medium_finding_count|clean_review}"
      }
    }
  );
}

function normalizeTrustedReviewResult(value) {
  if (!isObject(value)) {
    return null;
  }
  const reviewOutcome = trimmed(value.review_outcome);
  const blockingCount = classifyNonNegativeInteger(value.blocking_finding_count);
  const mediumCount = classifyNonNegativeInteger(value.medium_finding_count);
  if (blockingCount.status === "invalid" || mediumCount.status === "invalid") {
    return { invalid: true };
  }
  const hasFindingCounts = blockingCount.status === "valid" && mediumCount.status === "valid";
  const trustedCleanReview = value.clean_review === true || value.no_findings === true;
  const derivedReviewOutcome =
    reviewOutcome ??
    (trustedCleanReview
      ? "no_findings"
      : hasFindingCounts
        ? "passed_no_blocking_or_medium_findings"
        : null);
  if (!derivedReviewOutcome && !hasFindingCounts && !trustedCleanReview) {
    return null;
  }
  return {
    review_outcome: derivedReviewOutcome,
    blocking_finding_count: hasFindingCounts ? blockingCount.value : null,
    medium_finding_count: hasFindingCounts ? mediumCount.value : null,
    trusted_clean_review: trustedCleanReview === true && !hasFindingCounts
  };
}

function deriveTrustedReviewResult(status) {
  const structuredResult = normalizeTrustedReviewResult(status?.review_result);
  if (structuredResult) {
    return structuredResult;
  }
  return null;
}

async function resolveTrustedReviewRun({
  dispatchBackend,
  dispatchSessionIdentity,
  reviewRunRef
}) {
  const ref = normalizeReviewRunRef(reviewRunRef);
  if (!ref) {
    return refusal("review_attestation.untrusted_provenance.v1", [
      "review_run_ref must name a backend-minted run_id or monitor_handle"
    ]);
  }
  if (!dispatchBackend || typeof dispatchBackend.getRunStatus !== "function") {
    return refusal("review_attestation.untrusted_provenance.v1", [
      "trusted structured run-status resolver is unavailable in this MCP process"
    ]);
  }
  const status = await dispatchBackend.getRunStatus({
    caller_session_id: dispatchSessionIdentity,
    run_id: ref.run_id,
    monitor_handle: ref.monitor_handle
  });
  if (!status || status.accepted !== true) {
    return refusal(mapRunStatusRefusalToDecisionCode(status), [
      status?.refusal?.reason ?? "structured run-status resolver refused review_run_ref"
    ]);
  }
  const roleClass = trimmed(status.role);
  if (!["reviewer", "redteam"].includes(roleClass)) {
    return refusal("review_attestation.wrong_role.v1", [
      "resolved run is not a reviewer/redteam structured dispatch run"
    ]);
  }
  if (status.terminal !== true || !["succeeded", "completed"].includes(trimmed(status.status))) {
    return refusal("review_attestation.non_terminal.v1", [
      "resolved run is not in a terminal-success status"
    ]);
  }
  const reviewedAt = trimmed(status.updated_at);
  if (!reviewedAt) {
    return refusal("review_attestation.non_terminal.v1", [
      "resolved run lacks a trusted completion timestamp to derive reviewed_at"
    ]);
  }
  const trustedReviewResult = deriveTrustedReviewResult(status);
  if (trustedReviewResult?.invalid === true) {
    return refusal("review_attestation.blocking_findings.v1", [
      "trusted structured review_result finding counts must be non-negative integers"
    ]);
  }
  if (!trustedReviewResult) {
    return trustedReviewResultApiBlocker(
      "structured run-status resolver does not expose trusted review_result counts or a trusted clean-review signal"
    );
  }
  return {
    ok: true,
    run: {
      run_id: trimmed(status.run_id),
      role_class: roleClass,
      terminal_status: trimmed(status.status),
      subject_address: status.subject,
      provenance_kind: "structured_dispatch_run",
      reviewed_at: reviewedAt,
      review_result: trustedReviewResult
    }
  };
}

export function registerReviewAttestationTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  dispatchBackend = null,
  dispatchSessionIdentity = null
}) {
  registerTool(
    TOOL_NAME,
    {
      description:
        "Write-capable: record bounded, portfolio-local review-attestation evidence for a WK or tracker-local slice after a trusted findings-only reviewer/redteam run completes. Trusted facts (review_outcome, reviewed_at, role/subject) are derived from structured run metadata, never caller input. Does NOT run admission-time validation and does NOT create launch authority: stored evidence is authority=portfolio_local_reference, the route never writes accepted_authorities[] and never converts needs_review to admit — Node Engine remains the sole admit authority. See docs/tool-discovery.md for the full record-time contract and rejected input classes.",
	      inputSchema: {
	        repo: z.string().optional(),
	        unit: z.string(),
	        review_run_ref: z
	          .object({
	            run_id: z.string().optional(),
	            monitor_handle: z.string().optional()
	          })
	          .strict(),
        reviewed_controls: z.array(z.string()),
        status: z.string().optional(),
        review_outcome: z.string().optional(),
        expires_at: z.string(),
        expected_source_digest: z.string().optional(),
        reviewer_role_class: z.string().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const unit = parseWorkRecordUnitAddress(args.unit);
        if (!unit) {
          return errorContent(
            new Error(`${TOOL_NAME} requires a valid work-record unit address (WK-#### or WK-#####slice-id)`)
          );
        }

        if (isNonEmptyString(args.status) && trimmed(args.status) !== ACCEPTED_REVIEW_STATUS) {
          return jsonContent(
            refusal("review_attestation.unaccepted_status.v1", [
              `only status="${ACCEPTED_REVIEW_STATUS}" is recordable in v1`
            ])
          );
        }

        const loaded = await readWorkRecordById({ dir: workspace.dir, id: unit.record_id });
        if (!loaded || !loaded.record) {
          return errorContent(
            new Error(`${TOOL_NAME} could not load canonical work record ${unit.record_id}`)
          );
        }
        const canonicalRecordRepo = trimmed(loaded.record.repo);
        if (!canonicalRecordRepo) {
          return errorContent(
            new Error(`${TOOL_NAME} could not resolve canonical repo for ${unit.record_id}`)
          );
        }
        if (unit.kind === "slice" && !recordHasSlice(loaded.record, unit.slice_id)) {
          return jsonContent(
            refusal("review_attestation.wrong_unit.v1", [
              `slice ${unit.slice_id} is not present in ${unit.record_id}`
            ])
          );
        }
        const targetUnitRecord = getLoadedWorkRecordUnit(loaded.record, unit);
        if (!targetUnitRecord) {
          return jsonContent(
            refusal("review_attestation.wrong_unit.v1", [
              "selected target unit could not be materialized from the canonical record"
            ])
          );
        }
        const recordSourceDigest = trimmed(loaded.source_digest);
        const digestRecord = cloneJson(loaded.record);
        const sourceDigest = trimmed(computeReviewedUnitSourceDigest(
          unit.kind === "slice"
            ? { record: digestRecord, selected_slice_id: unit.slice_id }
            : digestRecord
        ));
        if (!recordSourceDigest || !sourceDigest) {
          return errorContent(
            new Error(`${TOOL_NAME} could not compute canonical digests for ${unit.address}`)
          );
        }

        if (
          isNonEmptyString(args.expected_source_digest) &&
          trimmed(args.expected_source_digest) !== recordSourceDigest
        ) {
          return jsonContent(
            refusal("review_attestation.stale_source_digest.v1", [
              "expected_source_digest does not match the current canonical record source_digest"
            ])
          );
        }

        const resolvedRun = await resolveTrustedReviewRun({
          dispatchBackend,
          dispatchSessionIdentity,
          reviewRunRef: args.review_run_ref
        });
        if (!resolvedRun.ok) {
          return jsonContent(resolvedRun);
        }
        const trustedRun = resolvedRun.run;
        const runRoleClass = trustedRun.role_class;
        const hintedRoleClass = trimmed(args.reviewer_role_class);
        if (hintedRoleClass && runRoleClass && hintedRoleClass !== runRoleClass) {
          return jsonContent(
            refusal("review_attestation.wrong_role.v1", [
              "reviewer_role_class hint does not match the structured run role class"
            ])
          );
        }
        const reviewerRoleClass = runRoleClass ?? hintedRoleClass;
        const reviewedAt = trustedRun.reviewed_at;
        const trustedReviewResult = trustedRun.review_result;
        if (!reviewedAt) {
          return jsonContent(
            refusal("review_attestation.non_terminal.v1", [
              "structured run reference lacks a trusted completion timestamp to derive reviewed_at"
            ])
          );
        }
        const runSubjectAddress = trimmed(trustedRun.subject_address);
        if (!runSubjectAddress) {
          return jsonContent(
            refusal("review_attestation.wrong_unit.v1", [
              "structured run reference lacks a canonical subject address"
            ])
          );
        }
        const runSubjectUnit = parseWorkRecordUnitAddress(runSubjectAddress);
        if (!runSubjectUnit) {
          return jsonContent(
            refusal("review_attestation.wrong_unit.v1", [
              "structured run subject is not a canonical work-record unit address"
            ])
          );
        }
        let reviewUnitForAttestation = null;
        if (runSubjectAddress !== unit.address) {
          const loadedReview = await readWorkRecordById({
            dir: workspace.dir,
            id: runSubjectUnit.record_id
          });
          if (!loadedReview || !loadedReview.record || loadedReview.valid !== true) {
            return jsonContent(
              refusal("review_attestation.wrong_unit.v1", [
                "structured run subject is not a valid canonical review unit"
              ])
            );
          }
          if (runSubjectUnit.kind === "slice" && !recordHasSlice(loadedReview.record, runSubjectUnit.slice_id)) {
            return jsonContent(
              refusal("review_attestation.wrong_unit.v1", [
                `slice ${runSubjectUnit.slice_id} is not present in ${runSubjectUnit.record_id}`
              ])
            );
          }
          const reviewUnitRecord = getLoadedWorkRecordUnit(loadedReview.record, runSubjectUnit);
          if (!reviewUnitRecord) {
            return jsonContent(
              refusal("review_attestation.wrong_unit.v1", [
                "resolved review unit could not be materialized from the canonical record"
              ])
            );
          }
          const reviewUnitWorkKind = trimmed(reviewUnitRecord.work_kind);
          if (!["review", "redteam"].includes(reviewUnitWorkKind)) {
            return jsonContent(
              refusal("review_attestation.wrong_role.v1", [
                "resolved review unit is not a findings-only reviewer/redteam work item"
              ])
            );
          }
          if (!Array.isArray(reviewUnitRecord.write_scope) || reviewUnitRecord.write_scope.length !== 0) {
            return jsonContent(
              refusal("review_attestation.wrong_role.v1", [
                "resolved review unit must have an empty write_scope"
              ])
            );
          }
          if (!unitsHaveDurableRelationship(reviewUnitRecord, runSubjectUnit, targetUnitRecord, unit)) {
            return jsonContent(
              refusal("review_attestation.wrong_unit.v1", [
                "resolved review unit does not have a durable relationship to the target unit"
              ])
            );
          }

          reviewUnitForAttestation = {
            address: runSubjectUnit.address,
            record_id: runSubjectUnit.record_id,
            slice_id: runSubjectUnit.slice_id
          };
        }
        const reviewOutcome = trustedReviewResult?.review_outcome;
        if (!reviewOutcome || !REVIEW_ATTESTATION_REVIEW_OUTCOME_VALUES.includes(reviewOutcome)) {
          return jsonContent(
            refusal("review_attestation.unaccepted_outcome.v1", [
              "trusted structured review result did not produce an accepted review_outcome"
            ])
          );
        }

        const attestationId = `ra:${computeNormalizedInputDigest({
          repo: canonicalRecordRepo,
          unit: unit.address,
          run_id: trustedRun.run_id,
          source_digest: sourceDigest
        }).slice("sha256:".length)}`;

        const built = buildReviewAttestation({
          attestation_id: attestationId,
          repo: canonicalRecordRepo,
          unit,
          reviewed_controls: args.reviewed_controls,
          reviewer_role_class: reviewerRoleClass,
          review_outcome: reviewOutcome,
          blocking_finding_count: trustedReviewResult.blocking_finding_count,
          medium_finding_count: trustedReviewResult.medium_finding_count,
          trusted_clean_review: trustedReviewResult.trusted_clean_review === true,
          source_digest: sourceDigest,
          reviewed_at: reviewedAt,
          expires_at: args.expires_at,
          ...(reviewUnitForAttestation ? { review_unit: reviewUnitForAttestation } : {}),
          review_run: {
            run_id: trustedRun.run_id,
            role_class: trustedRun.role_class,
            terminal_status: trustedRun.terminal_status,
            subject_address: runSubjectAddress,
            provenance_kind: trustedRun.provenance_kind
          }
        });
        if (!built.ok) {
          return jsonContent(refusal(built.decision_code, built.reasons));
        }
        const attestation = built.attestation;

        const persisted = await persistReviewAttestation({
          workspace,
          loaded,
          unit,
          sourceDigest,
          recordSourceDigest,
          attestation
        });

        return jsonContent({
          tool: TOOL_NAME,
          recorded: true,
          launch_authoritative: false,
          authority: REVIEW_ATTESTATION_AUTHORITY,
          repo: canonicalRecordRepo,
          selected_unit: unit,
          source_digest: sourceDigest,
          decision_code: RECORDED_DECISION_CODE,
          attestation_id: attestation.attestation_id,
          attestation_digest: attestation.attestation_digest,
          reviewed_controls: attestation.reviewed_controls,
          reviewer_role_class: attestation.reviewer_role_class,
          review_outcome: reviewOutcome,
          reviewed_at: attestation.reviewed_at,
          expires_at: attestation.expires_at,
          evidence: {
            persisted: true,
            sidecar_path: persisted.sidecar_path,
            sidecar_digest: persisted.sidecar_digest
          }
        });
      } catch (error) {
        if (error instanceof WorkerAdmissionSidecarError) {
          error.envelope = {
            schema_version: "worker-admission-sidecar-error.v1",
            code: error.code,
            message: error.message,
            record_id: error.diagnostics?.record_id ?? null,
            unit_address: error.diagnostics?.unit?.address ?? null,
            sidecar_path: error.diagnostics?.sidecar_path ?? null
          };
        }
        return errorContent(error);
      }
    }
  );
}
