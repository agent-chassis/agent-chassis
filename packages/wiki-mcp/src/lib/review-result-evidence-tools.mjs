

import {
  recordWorkRecordReviewResultEvidence,
  WORKSPACE_RECORD_REVIEW_RESULT_EVIDENCE_TOOL_NAME
} from "../../../wiki-core/src/operations/work-record-review-results.mjs";
import {
  deriveStructuredResultStatusFromDiagnostics,
  projectReviewResultEvidenceForWorkerAdmission,
  REVIEW_RESULT_EVIDENCE_AUTHORITY,
  reviewResultEvidenceAuthorityEffects
} from "../../../wiki-core/src/lib/work-record-review-results.mjs";

const REVIEW_RESULT_ROUTE_FORBIDDEN_CALLER_FIELDS = new Set([
  "accepted_authorities",
  "authority",
  "argv",
  "claimed_identity",
  "classification",
  "cwd",
  "dir",
  "env",
  "environment",
  "filesystem_root",
  "final_result",
  "final_result_body",
  "final_response_text",
  "identity",
  "outcome",
  "path",
  "policy",
  "prompt",
  "prose",
  "raw_final_result",
  "raw_request",
  "request",
  "request_payload",
  "review_attestations",
  "review_completion",
  "review_outcome",
  "review_result",
  "root",
  "shell_output",
  "source_digest",
  "status",
  "structured_role_result",
  "workspace_dir"
]);

const REVIEW_RESULT_ROUTE_ROLE_CLASSES = new Set(["reviewer", "redteam"]);
const REVIEW_RESULT_ROUTE_RUNTIME_FAILURE_STATUSES = new Set([
  "failed",
  "cancelled",
  "canceled",
  "timed_out",
  "timeout",
  "rejected",
  "inconclusive"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function reviewResultRouteRefusal(decisionCode, reasons, extra = {}) {
  return {
    tool: WORKSPACE_RECORD_REVIEW_RESULT_EVIDENCE_TOOL_NAME,
    recorded: false,
    evidence_only: true,
    authority: REVIEW_RESULT_EVIDENCE_AUTHORITY,
    decision_code: decisionCode,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
    ...reviewResultEvidenceAuthorityEffects(),
    ...projectReviewResultEvidenceForWorkerAdmission(),
    ...extra
  };
}

function collectReviewResultForbiddenCallerFields(args) {
  if (!isPlainObject(args)) return [];
  return Object.keys(args)
    .filter((key) => REVIEW_RESULT_ROUTE_FORBIDDEN_CALLER_FIELDS.has(key))
    .sort((left, right) => left.localeCompare(right));
}

function createReviewResultForbiddenInputSchema(zod) {
  return Object.fromEntries(
    [...REVIEW_RESULT_ROUTE_FORBIDDEN_CALLER_FIELDS].map((field) => [
      field,
      zod.unknown().optional()
    ])
  );
}

function normalizeReviewResultRunRef(value) {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  const unknownKeys = keys.filter((key) => key !== "run_id" && key !== "monitor_handle");
  if (unknownKeys.length > 0) {
    return { invalid: true, reason: `review_run_ref contains unsupported fields: ${unknownKeys.sort().join(", ")}` };
  }
  const runId = trimmed(value.run_id);
  const monitorHandle = trimmed(value.monitor_handle);
  if (!runId && !monitorHandle) {
    return { invalid: true, reason: "review_run_ref must name a backend-minted run_id or monitor_handle" };
  }
  return { run_id: runId, monitor_handle: monitorHandle };
}

function normalizeReviewResultCandidate(value) {
  if (!isPlainObject(value)) return undefined;
  const candidate = {};
  const kind = trimmed(value.kind);
  if (kind) candidate.kind = kind;
  if (Number.isInteger(value.payload_bytes) && value.payload_bytes >= 0) {
    candidate.payload_bytes = value.payload_bytes;
  }
  return Object.keys(candidate).length > 0 ? candidate : undefined;
}

const REVIEW_RESULT_ROUTE_RETAINED_DIAGNOSTICS = 20;

const REVIEW_RESULT_SUPPORTED_STRUCTURED_ROLE_RESULT_SCHEMA_VERSIONS = new Set([
  "workspace-agent-dispatch-structured-role-result.v1",
  "structured-role-result.evidence.v1"
]);

function normalizeReviewResultDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => isPlainObject(entry) && trimmed(entry.code))
    .slice(0, REVIEW_RESULT_ROUTE_RETAINED_DIAGNOSTICS)
    .map((entry) => ({
      code: trimmed(entry.code),
      ...(trimmed(entry.path) ? { path: trimmed(entry.path) } : {})
    }));
}

function reviewResultCompleteDiagnosticCount(value) {
  const suppliedCount = Array.isArray(value.diagnostics) ? value.diagnostics.length : 0;
  const stated = value.diagnostic_count;
  if (stated === undefined || stated === null) return suppliedCount;
  if (!Number.isInteger(stated) || stated < 0) return null;
  if (stated < suppliedCount) return null;
  return stated;
}

function reviewResultStructuredRoleResultSource(status, finalResult) {
  for (const container of [status, finalResult]) {
    if (!isPlainObject(container)) continue;
    if (!Object.hasOwn(container, "structured_role_result")) continue;

    if (container.structured_role_result === undefined) continue;
    return { present: true, value: container.structured_role_result };
  }
  return { present: false, value: undefined };
}

const REVIEW_RESULT_ABSENT_STRUCTURED_ROLE_RESULT = Object.freeze({ state: "absent" });

function malformedStructuredRoleResultProjection(reason) {
  return { state: "malformed", reason };
}

function normalizeStructuredRoleResultForReviewResultOperation(source) {
  if (!source.present) return REVIEW_RESULT_ABSENT_STRUCTURED_ROLE_RESULT;
  const value = source.value;
  if (!isPlainObject(value)) {
    return malformedStructuredRoleResultProjection(
      "trusted structured_role_result is present but is not a structured-role-result projection object"
    );
  }
  if (!REVIEW_RESULT_SUPPORTED_STRUCTURED_ROLE_RESULT_SCHEMA_VERSIONS.has(value.schema_version)) {
    return malformedStructuredRoleResultProjection(
      "trusted structured_role_result carries a missing or unsupported schema_version"
    );
  }
  const candidate = normalizeReviewResultCandidate(value.candidate);
  if (value.valid !== true) {
    const diagnostics = normalizeReviewResultDiagnostics(value.diagnostics);
    const diagnosticCount = reviewResultCompleteDiagnosticCount(value);
    if (diagnosticCount === null) {
      return malformedStructuredRoleResultProjection(
        "trusted structured_role_result states a diagnostic_count that is not a complete count of its own diagnostics"
      );
    }
    return {
      state: "invalid_projection",
      projection: {
        valid: false,
        diagnostics,
        diagnostic_count: diagnosticCount,
        ...(candidate ? { candidate } : {})
      }
    };
  }

  const sourceResult = isPlainObject(value.result) ? value.result : {};
  const claims = isPlainObject(value.claims) ? value.claims : {};
  const reportedRole =
    trimmed(claims.reported_role) ?? trimmed(sourceResult.reported_role) ?? trimmed(value.reported_role);
  const reportedSubject =
    trimmed(claims.reported_subject) ??
    trimmed(sourceResult.reported_subject) ??
    trimmed(value.reported_subject);
  const reportedOutcome =
    trimmed(claims.reported_outcome) ??
    trimmed(sourceResult.reported_outcome) ??
    trimmed(value.reported_outcome);
  if (!reportedRole || !reportedSubject || !reportedOutcome) {
    return malformedStructuredRoleResultProjection(
      "trusted structured_role_result is valid but carries no readable claims"
    );
  }

  const findingCounts = isPlainObject(sourceResult.finding_counts)
    ? sourceResult.finding_counts
    : isPlainObject(value.finding_counts)
      ? value.finding_counts
      : null;
  const reviewedControls = Array.isArray(sourceResult.reviewed_controls)
    ? sourceResult.reviewed_controls
    : Array.isArray(value.reviewed_controls)
      ? value.reviewed_controls
      : null;
  const reviewedControlCount = reviewedControls
    ? reviewedControls.length
    : Number.isInteger(value.reviewed_control_count) && value.reviewed_control_count >= 0
      ? value.reviewed_control_count
      : null;

  return {
    state: "valid_projection",
    projection: {
      valid: true,
      claims: {
        reported_role: reportedRole,
        reported_subject: reportedSubject,
        reported_outcome: reportedOutcome
      },
      ...(findingCounts ? { finding_counts: findingCounts } : {}),
      ...(reviewedControlCount === null ? {} : { reviewed_control_count: reviewedControlCount }),
      ...(candidate ? { candidate } : {})
    }
  };
}

function deriveReviewResultStructuredStatus(finalResult, rawStructuredRoleResult, normalizedRoleResult) {

  if (normalizedRoleResult.state === "absent") return "missing";

  if (normalizedRoleResult.state === "valid_projection") return null;

  if (trimmed(finalResult?.kind) === "missing_result") return "missing";

  return deriveStructuredResultStatusFromDiagnostics(rawStructuredRoleResult?.diagnostics);
}

function deriveReviewResultRuntimeFailureCode(status, finalResult) {
  const missingCode = trimmed(finalResult?.missing_result?.code);
  if (missingCode) return missingCode;
  const exitError = trimmed(status?.exit?.error);
  if (exitError && /^[a-z0-9][a-z0-9_.:-]{0,191}$/u.test(exitError)) return exitError;
  return trimmed(status?.status);
}

function mapReviewResultStatusRefusalToDecisionCode(status) {
  const code = status?.refusal?.code;
  if (code === "monitor_handle_subject_mismatch") {
    return "review_result_evidence.wrong_unit.v1";
  }
  return "review_result_evidence.untrusted_provenance.v1";
}

async function resolveTrustedReviewResultEvidenceRun({
  dispatchBackend,
  dispatchSessionIdentity,
  reviewRunRef
}) {
  const ref = normalizeReviewResultRunRef(reviewRunRef);
  if (!ref || ref.invalid === true) {
    return reviewResultRouteRefusal("review_result_evidence.untrusted_provenance.v1", [
      ref?.reason ?? "review_run_ref must be an object"
    ]);
  }
  if (!dispatchBackend || typeof dispatchBackend.getRunStatus !== "function") {
    return reviewResultRouteRefusal("review_result_evidence.untrusted_provenance.v1", [
      "trusted structured run-status resolver is unavailable in this MCP process"
    ]);
  }

  const status = await dispatchBackend.getRunStatus({
    caller_session_id: dispatchSessionIdentity,
    run_id: ref.run_id,
    monitor_handle: ref.monitor_handle
  });
  if (!status || status.accepted !== true) {
    return reviewResultRouteRefusal(mapReviewResultStatusRefusalToDecisionCode(status), [
      status?.refusal?.reason ?? "structured run-status resolver refused review_run_ref"
    ]);
  }

  const roleClass = trimmed(status.role);
  if (!REVIEW_RESULT_ROUTE_ROLE_CLASSES.has(roleClass)) {
    return reviewResultRouteRefusal("review_result_evidence.wrong_role.v1", [
      "resolved run is not a reviewer/redteam structured dispatch run"
    ]);
  }
  if (status.terminal !== true) {
    return reviewResultRouteRefusal("review_result_evidence.non_terminal.v1", [
      "resolved run is not terminal"
    ]);
  }
  const subjectAddress = trimmed(status.subject);
  if (!subjectAddress) {
    return reviewResultRouteRefusal("review_result_evidence.wrong_unit.v1", [
      "resolved run lacks a canonical subject address"
    ]);
  }

  const finalResult = isPlainObject(status.final_result) ? status.final_result : null;
  if (isPlainObject(status.review_result)) {
    return reviewResultRouteRefusal("review_result_evidence.completion_outcome.v1", [
      "clean reviewer/redteam review_result belongs to review attestation, not review-result evidence"
    ]);
  }
  const structuredRoleResultSource = reviewResultStructuredRoleResultSource(status, finalResult);
  const normalizedRoleResult =
    normalizeStructuredRoleResultForReviewResultOperation(structuredRoleResultSource);
  if (normalizedRoleResult.state === "malformed") {
    return reviewResultRouteRefusal("review_result_evidence.malformed.v1", [
      normalizedRoleResult.reason
    ]);
  }
  const structuredResultStatus = deriveReviewResultStructuredStatus(
    finalResult,
    structuredRoleResultSource.value,
    normalizedRoleResult
  );

  const structuredRoleResult =
    normalizedRoleResult.state === "invalid_projection"
      ? { ...normalizedRoleResult.projection, structured_result_status: structuredResultStatus }
      : normalizedRoleResult.projection;
  const terminalStatus = trimmed(status.status);
  const reviewRun = {
    run_id: trimmed(status.run_id) ?? ref.run_id ?? null,
    monitor_handle: trimmed(status.monitor_handle) ?? ref.monitor_handle ?? null,
    role_class: roleClass,
    terminal_status: terminalStatus,
    subject_address: subjectAddress,
    provenance_kind: "structured_dispatch_run"
  };
  const completedAt = trimmed(status.updated_at);
  if (completedAt) reviewRun.completed_at = completedAt;
  if (structuredResultStatus) reviewRun.structured_result_status = structuredResultStatus;
  if (REVIEW_RESULT_ROUTE_RUNTIME_FAILURE_STATUSES.has(terminalStatus)) {
    const runtimeFailureCode = deriveReviewResultRuntimeFailureCode(status, finalResult);
    if (runtimeFailureCode) reviewRun.runtime_failure_code = runtimeFailureCode;
  }

  return {
    ok: true,
    review_run: reviewRun,
    structured_role_result: structuredRoleResult
  };
}

function createReviewResultStructuredProjection(resolvedRun) {
  const structured = resolvedRun.structured_role_result;
  const projection = {
    structured_result_status: resolvedRun.review_run.structured_result_status ?? null
  };
  if (!structured) return projection;
  if (structured.valid === false) {
    projection.structured_result_valid = false;
    projection.retained_diagnostics = structured.diagnostics;
    projection.retained_diagnostic_count = structured.diagnostics.length;
    projection.diagnostic_count = structured.diagnostic_count;
    if (structured.candidate) projection.candidate = structured.candidate;
    return projection;
  }
  projection.structured_result_valid = true;
  projection.reported_outcome = structured.claims.reported_outcome;
  if (structured.finding_counts) {
    projection.finding_counts = structured.finding_counts;
    projection.total_finding_count = structured.finding_counts.total ?? null;
    projection.blocking_finding_count = structured.finding_counts.blocking ?? null;
    projection.medium_finding_count = structured.finding_counts.medium ?? null;
  }
  if (Number.isInteger(structured.reviewed_control_count)) {
    projection.reviewed_control_count = structured.reviewed_control_count;
  }
  return projection;
}

function createCompactReviewResultEvidenceResponse(workspaceRepo, result, resolvedRun) {
  return {
    ...createReviewResultStructuredProjection(resolvedRun),
    workspaceRepo,
    tool: WORKSPACE_RECORD_REVIEW_RESULT_EVIDENCE_TOOL_NAME,
    recorded: result?.recorded === true,
    evidence_only: true,
    authority: result?.authority ?? REVIEW_RESULT_EVIDENCE_AUTHORITY,
    decision_code: result?.decision_code ?? null,
    reasons: Array.isArray(result?.reasons) ? result.reasons : [],
    valid: result?.valid === true,
    written: result?.written === true,
    record_id: result?.record_id ?? null,
    selected_unit: result?.selected_unit ?? null,
    source_digest: result?.source_digest ?? null,
    expected_source_digest: result?.expected_source_digest ?? null,
    current_source_digest: result?.current_source_digest ?? null,
    evidence_id: result?.evidence_id ?? null,
    evidence_digest: result?.evidence_digest ?? null,
    evidence_class: result?.evidence_class ?? null,
    reviewer_role_class: result?.reviewer_role_class ?? null,
    recorded_at: result?.recorded_at ?? null,
    evidence: result?.evidence ?? null,
    ...reviewResultEvidenceAuthorityEffects(),
    ...projectReviewResultEvidenceForWorkerAdmission()
  };
}

export function registerReviewResultEvidenceTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  dispatchBackend,
  dispatchSessionIdentity
}) {
  registerTool(
    WORKSPACE_RECORD_REVIEW_RESULT_EVIDENCE_TOOL_NAME,
    {
      description:
        "Write-capable: record bounded non-completion review-result evidence for a WK or tracker-local slice after a trusted reviewer/redteam run resolves to changes_requested, a missing structured result, an invalid structured result, or a runtime failure. An invalid structured result keeps its own evidence class - invalid_result, malformed_result, oversized_result, duplicate_result, multiple_result, ordinary_json_result, or trailing_prose_result - and never collapses into missing_result; missing_result covers only a run with no structured result at all or an explicit launcher final_result.kind missing_result. The route resolves review facts from structured run metadata, never caller-supplied filesystem roots, identity, policy, outcome strings, raw final_result/prose, or structured_role_result payloads. Evidence is coordination-only: it does not satisfy review completion, grant dispatch or launch authority, write accepted_authorities[], create review attestation, or change status.",
      inputSchema: {
        repo: z.string().optional(),
        unit: z.string(),
        review_run_ref: z
          .object({
            run_id: z.string().optional(),
            monitor_handle: z.string().optional()
          })
          .strict(),
        review_unit: z.string().optional(),
        required_role_class: z.string().optional(),
        expected_source_digest: z.string().optional(),
        ...createReviewResultForbiddenInputSchema(z)
      }
    },
    async (args) => {
      try {
        const forbiddenFields = collectReviewResultForbiddenCallerFields(args);
        if (forbiddenFields.length > 0) {
          return jsonContent(
            reviewResultRouteRefusal("review_result_evidence.forbidden_authority_input.v1", [
              `caller-supplied filesystem/authority fields are not accepted: ${forbiddenFields.join(", ")}`
            ])
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const resolvedRun = await resolveTrustedReviewResultEvidenceRun({
          dispatchBackend,
          dispatchSessionIdentity,
          reviewRunRef: args.review_run_ref
        });
        if (!resolvedRun.ok) {
          return jsonContent(resolvedRun);
        }

        const result = await recordWorkRecordReviewResultEvidence({
          dir: workspace.dir,
          unit: args.unit,
          review_run: resolvedRun.review_run,
          ...(resolvedRun.structured_role_result
            ? { structured_role_result: resolvedRun.structured_role_result }
            : {}),
          ...(args.review_unit ? { review_unit: args.review_unit } : {}),
          ...(args.required_role_class ? { required_role_class: args.required_role_class } : {}),
          ...(args.expected_source_digest
            ? { expected_source_digest: args.expected_source_digest }
            : {})
        });

        return jsonContent(
          createCompactReviewResultEvidenceResponse(workspace.repo, result, resolvedRun)
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
