

import { isLosslessMcpSpillDelivery } from "./mcp-response.mjs";

export const CLOSEOUT_LINT_STATUS_TRIGGER_VALUES = ["review", "done"];
const CLOSEOUT_LINT_FINDING_LIMIT = 3;

export class CloseoutLintResultContractError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "CloseoutLintResultContractError";
    this.code = "closeout_lint_result_contract_error";
    this.result_tuple = Object.freeze({
      valid: Boolean(result?.valid),
      written: Boolean(result?.written),
      no_op: Boolean(result?.no_op)
    });
  }
}

function closeoutLintDeferred(reason, applicable, nextAction, extra = {}) {
  return {
    ran: false,
    applicable,
    ok: null,
    cleanly_closeable: null,
    generated_views: "not_evaluated",
    reason,
    ...extra,
    next_action: nextAction
  };
}

export function buildDeferredCloseoutLint({ result, transitionApplicable }) {
  const valid = Boolean(result?.valid);

  const written = result?.written === null ? null : Boolean(result?.written);
  const noOp = Boolean(result?.no_op);

  if (written !== false && noOp) {
    throw new CloseoutLintResultContractError(
      written === null
        ? "closeout mutation result cannot be no_op with an unknown publication"
        : "closeout mutation result cannot be both written and no_op",
      result
    );
  }
  if (noOp && !valid) {
    throw new CloseoutLintResultContractError(
      "closeout mutation result cannot be no_op and invalid",
      result
    );
  }

  if (written === null) {
    return closeoutLintDeferred(
      "publication_unknown",
      null,
      "canonical publication could not be established: inspect the canonical record with " +
        "workspace_read_page before deciding any further action; do not repeat this write",
      { write_effects_retained: null }
    );
  }
  if (written && !valid) {
    return closeoutLintDeferred(
      "persisted_but_invalid",
      false,
      "repair the persisted invalid work record before requesting repository verification"
    );
  }
  if (!written && !noOp) {
    return closeoutLintDeferred(
      "write_not_applied",
      false,
      "repair the reported mutation diagnostics and retry the write"
    );
  }
  if (!transitionApplicable) {
    return closeoutLintDeferred(
      "transition_not_applicable",
      false,
      "repository closeout verification applies only to status review/done or a closure mutation"
    );
  }

  if (noOp) {
    return closeoutLintDeferred(
      "no_canonical_mutation",
      false,
      "this request changed no canonical bytes, so no repository check was run; call " +
        "workspace_generate_and_lint directly to verify repository state you did not change"
    );
  }
  return closeoutLintDeferred(
    "deferred_after_write",
    true,
    "after all intended closeout mutations, call workspace_generate_and_lint once to verify the repository state observed by that invocation"
  );
}

function compactCloseoutLintFinding(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    return finding;
  }
  return {
    code: finding.code ?? null,
    path: finding.path ?? null,
    message: finding.message ?? finding.summary ?? null
  };
}

function closeoutLintHasSuppressedDetail(closeoutLint, compactCloseoutLint) {
  if (!closeoutLint || typeof closeoutLint !== "object" || Array.isArray(closeoutLint)) {
    return false;
  }
  if (Array.isArray(closeoutLint.top_findings) && closeoutLint.top_findings.length > CLOSEOUT_LINT_FINDING_LIMIT) {
    return true;
  }
  const compactKeys = new Set(Object.keys(compactCloseoutLint));
  return Object.keys(closeoutLint).some((key) => {
    if (compactKeys.has(key)) {
      return false;
    }
    const value = closeoutLint[key];
    if (value === null || value === undefined || value === false) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    return true;
  });
}

export function shapeCloseoutLintResponse(closeoutLint, { verbose = false } = {}) {
  if (verbose) {
    return {
      closeout_lint: closeoutLint,
      detail_available: false
    };
  }

  const compactCloseoutLint = {
    ran: closeoutLint?.ran ?? null,
    applicable: closeoutLint?.applicable ?? null,
    ok: closeoutLint?.ok ?? null,
    cleanly_closeable: closeoutLint?.cleanly_closeable ?? null,
    error_count: closeoutLint?.error_count ?? 0,
    top_findings: Array.isArray(closeoutLint?.top_findings)
      ? closeoutLint.top_findings.slice(0, CLOSEOUT_LINT_FINDING_LIMIT).map((finding) => compactCloseoutLintFinding(finding))
      : []
  };

  if (closeoutLint?.generated_views) {
    compactCloseoutLint.generated_views = closeoutLint.generated_views;
  }
  if (closeoutLint?.reason) {
    compactCloseoutLint.reason = closeoutLint.reason;
  }

  for (const field of ["cause_code", "cause_message", "write_effects_retained",
    "warning_count", "finding_count_total"]) {
    if (closeoutLint?.[field] === undefined || closeoutLint[field] === null) continue;
    compactCloseoutLint[field] = closeoutLint[field];
  }

  if (Number.isInteger(compactCloseoutLint.finding_count_total)) {
    compactCloseoutLint.findings_returned = compactCloseoutLint.top_findings.length;
    compactCloseoutLint.findings_truncated =
      compactCloseoutLint.top_findings.length < compactCloseoutLint.finding_count_total;
  }

  if (closeoutLint?.next_action) {
    compactCloseoutLint.next_action = closeoutLint.next_action;
  }

  return {
    closeout_lint: compactCloseoutLint,
    detail_available: closeoutLintHasSuppressedDetail(closeoutLint, compactCloseoutLint)
  };
}

function attachCloseoutLintResponse(response, closeoutLint, { verbose = false } = {}) {
  const shaped = shapeCloseoutLintResponse(closeoutLint, { verbose });
  response.closeout_lint = shaped.closeout_lint;
  response.cleanly_closeable = shaped.closeout_lint?.cleanly_closeable ?? null;
  if (shaped.detail_available) {
    response.detail_available = true;
  }
  return response;
}

function closeoutChecksUnavailable(error) {
  return {
    ran: false,
    applicable: true,
    ok: null,
    cleanly_closeable: null,
    generated_views: "not_evaluated",
    reason: "check_execution_unavailable",
    cause_code: typeof error?.code === "string" ? error.code : null,
    cause_message: typeof error?.message === "string" ? error.message : null,

    write_effects_retained: true,
    next_action: "resolve the reported check-execution cause, then call " +
      "workspace_generate_and_lint once to verify the repository state"
  };
}

function closeoutChecksResult(produced) {
  const lint = produced?.lint && typeof produced.lint === "object" && !Array.isArray(produced.lint)
    ? produced.lint
    : produced;
  const findings = Array.isArray(lint?.findings) ? lint.findings : [];
  const warnings = Array.isArray(lint?.warnings) ? lint.warnings : [];
  const errorCount = Number.isInteger(lint?.error_count) ? lint.error_count : null;
  const ok = typeof lint?.ok === "boolean" ? lint.ok : errorCount === 0;
  return {
    ran: true,
    applicable: true,
    ok,
    cleanly_closeable: ok,
    generated_views: "regenerated",
    error_count: errorCount ?? 0,
    warning_count: Number.isInteger(lint?.warning_count) ? lint.warning_count : warnings.length,

    finding_count_total: findings.length,
    findings_returned: findings.length,
    findings_truncated: false,
    top_findings: findings,
    warnings,
    next_action: typeof lint?.next_action === "string" ? lint.next_action : null
  };
}

export async function runCloseoutChecks({ result, transitionApplicable, workspaceDir, generateAndLint }) {
  const deferred = buildDeferredCloseoutLint({ result, transitionApplicable });

  if (deferred.applicable !== true) return deferred;
  if (typeof generateAndLint !== "function") {
    return closeoutChecksUnavailable({ code: "closeout_check_executor_unavailable" });
  }
  try {
    return closeoutChecksResult(
      await generateAndLint({ dir: workspaceDir, includeAllFindings: true })
    );
  } catch (error) {
    return closeoutChecksUnavailable(error);
  }
}

const ORIGINAL_DETAIL_NEXT_ACTION =
  "read the complete original closeout result with workspace_read_mcp_content_reference " +
  "using full_result.content_reference; it needs no further write or check execution";
const ORIGINAL_DETAIL_UNAVAILABLE_NEXT_ACTION =
  "the complete original closeout result could not be retained, so it cannot be read back; " +
  "the effects reported here still stand and repeating this request would change nothing";

const UNKNOWN_PUBLICATION_STATE = "unknown";
const NOT_WRITTEN_DIAGNOSTIC_CODE = "write_response_not_written";
const UNKNOWN_PUBLICATION_NEXT_ACTION =
  "canonical publication could not be established: inspect the canonical record with " +
  "workspace_read_page before deciding any further action; do not repeat this write";

function applyPublicationCertainty(frame, publicationState) {
  if (publicationState !== UNKNOWN_PUBLICATION_STATE) {
    return frame;
  }
  frame.publication_state = UNKNOWN_PUBLICATION_STATE;
  frame.written = null;

  frame.status = null;
  frame.ok = false;
  if (Array.isArray(frame.diagnostics)) {
    frame.diagnostics = frame.diagnostics.filter(
      (entry) => entry?.code !== NOT_WRITTEN_DIAGNOSTIC_CODE);
    frame.diagnostics.push({
      code: "work_record_publication_unknown",
      severity: "error",
      message:
        "canonical publication could not be established; whether this write landed is unknown",
      path: "publication_state"
    });
  }
  frame.next_action = UNKNOWN_PUBLICATION_NEXT_ACTION;
  return frame;
}

export function composeCloseoutResponse({
  payload, closeoutLint, publicationState = null, verbose = false, jsonContent, shapeWriteResponse
}) {

  const complete = applyPublicationCertainty(
    attachCloseoutLintResponse(
      shapeWriteResponse({ ...payload }, { verbose: true }), closeoutLint, { verbose: true }),
    publicationState
  );
  if (verbose === true) {
    return jsonContent(complete);
  }

  const bounded = applyPublicationCertainty(
    attachCloseoutLintResponse(
      shapeWriteResponse(payload, { verbose: false }), closeoutLint, { verbose: false }),
    publicationState
  );
  if (bounded.detail_available !== true) {

    return jsonContent(bounded);
  }

  const retained = jsonContent(complete, { forceSpill: true });
  if (!isLosslessMcpSpillDelivery(retained)) {
    bounded.full_result = { retained: false, next_action: ORIGINAL_DETAIL_UNAVAILABLE_NEXT_ACTION };

    if (bounded.next_action !== UNKNOWN_PUBLICATION_NEXT_ACTION) {
      bounded.next_action = ORIGINAL_DETAIL_UNAVAILABLE_NEXT_ACTION;
    }
    return jsonContent(bounded);
  }

  const envelope = retained.structuredContent;
  bounded.full_result = {
    retained: true,
    content_reference: envelope.content_reference,
    total_bytes: envelope.total_bytes,
    sha256: envelope.content_reference.sha256,
    next_action: ORIGINAL_DETAIL_NEXT_ACTION
  };

  if (bounded.next_action !== UNKNOWN_PUBLICATION_NEXT_ACTION) {
    bounded.next_action = ORIGINAL_DETAIL_NEXT_ACTION;
  }
  return jsonContent(bounded);
}
