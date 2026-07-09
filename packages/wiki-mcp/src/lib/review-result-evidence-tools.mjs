

import {
  recordWorkRecordReviewResultEvidence,
  WORKSPACE_RECORD_REVIEW_RESULT_EVIDENCE_TOOL_NAME
} from "../../../wiki-core/src/operations/work-record-review-results.mjs";
import {
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

function normalizeReviewResultDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => isPlainObject(entry) && trimmed(entry.code))
    .slice(0, 20)
    .map((entry) => ({
      code: trimmed(entry.code),
      ...(trimmed(entry.path) ? { path: trimmed(entry.path) } : {})
    }));
}

function normalizeStructuredRoleResultForReviewResultOperation(value) {
  if (!isPlainObject(value)) return undefined;
  const candidate = normalizeReviewResultCandidate(value.candidate);
  if (value.valid === false) {
    return {
      valid: false,
      diagnostics: normalizeReviewResultDiagnostics(value.diagnostics),
      ...(candidate ? { candidate } : {})
    };
  }
  if (value.valid !== true) return undefined;

  const sourceResult = isPlainObject(value.result) ? value.result : {};
  const claims = isPlainObject(value.claims) ? value.claims : {};
  const result = {
    reported_role: trimmed(sourceResult.reported_role) ?? trimmed(claims.reported_role),
    reported_subject: trimmed(sourceResult.reported_subject) ?? trimmed(claims.reported_subject),
    reported_outcome: trimmed(sourceResult.reported_outcome) ?? trimmed(claims.reported_outcome),
    summary: sourceResult.summary ?? null,
    findings: Array.isArray(sourceResult.findings)
      ? sourceResult.findings
      : Array.isArray(value.findings)
        ? value.findings
        : null,
    finding_counts: isPlainObject(sourceResult.finding_counts)
      ? sourceResult.finding_counts
      : isPlainObject(value.finding_counts)
        ? value.finding_counts
        : null,
    reviewed_controls: Array.isArray(sourceResult.reviewed_controls)
      ? sourceResult.reviewed_controls
      : Array.isArray(value.reviewed_controls)
        ? value.reviewed_controls
        : null
  };
  if (
    !result.reported_role ||
    !result.reported_subject ||
    !result.reported_outcome ||
    !Array.isArray(result.findings) ||
    !isPlainObject(result.finding_counts) ||
    !Array.isArray(result.reviewed_controls)
  ) {
    return undefined;
  }
  return {
    valid: true,
    result,
    ...(candidate ? { candidate } : {})
  };
}

function deriveReviewResultStructuredStatus(finalResult, structuredRoleResult) {
  if (structuredRoleResult?.valid === false) return "invalid";
  if (trimmed(finalResult?.kind) === "missing_result") return "missing";
  if (!structuredRoleResult) return "missing";
  if (structuredRoleResult.valid === true) return null;
  return "invalid";
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
  const rawStructuredRoleResult = isPlainObject(status.structured_role_result)
    ? status.structured_role_result
    : isPlainObject(finalResult?.structured_role_result)
      ? finalResult.structured_role_result
      : null;
  const structuredRoleResult =
    normalizeStructuredRoleResultForReviewResultOperation(rawStructuredRoleResult);
  const structuredResultStatus =
    deriveReviewResultStructuredStatus(finalResult, structuredRoleResult);
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

function createCompactReviewResultEvidenceResponse(workspaceRepo, result) {
  return {
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
        "Write-capable: record bounded non-completion review-result evidence for a WK or tracker-local slice after a trusted reviewer/redteam run resolves to changes_requested, missing structured result, or runtime failure. The route resolves review facts from structured run metadata, never caller-supplied filesystem roots, identity, policy, outcome strings, raw final_result/prose, or structured_role_result payloads. Evidence is coordination-only: it does not satisfy review completion, grant dispatch or launch authority, write accepted_authorities[], create review attestation, or change status.",
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

        return jsonContent(createCompactReviewResultEvidenceResponse(workspace.repo, result));
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
