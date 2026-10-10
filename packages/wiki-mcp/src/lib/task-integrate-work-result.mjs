

import { projectPublishedIntegrationReceipt } from "./dispatch-run-status-integration-receipt-projection.mjs";
import { describeRetainedArtifactFile, describeRetentionFailure, jsonContent, measureMcpInlineResultBytes }
  from "./mcp-response.mjs";
import { readSelectedResponseSource, retainSelectedResponseSource, selectedResponseDeliveryBound,
  selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";

export const INTEGRATION_ORIGINAL_PRODUCER = "workspace_integrate_committed_slice";
export const INTEGRATION_ORIGINAL_SUMMARY_SCHEMA_VERSION = "integration-original-summary.v1";

const RETAIN_OPERATION = "retain_integration_original";

const SPILL_PERSISTENCE_FAILED_CODE = "mcp_response.spill_persistence_failed.v1";
const isPersistenceFailure = (error) => error?.code === SPILL_PERSISTENCE_FAILED_CODE &&
  error.envelope?.code === SPILL_PERSISTENCE_FAILED_CODE && error.envelope.response_spilled === false;

const OUTCOME_FACTS = Object.freeze(["accepted", "integrated", "reason", "code", "public_blocker_code",
  "empty_delivery", "integrated_state", "delivery_sha", "slice_sha", "wk_sha", "previous_wk_sha", "slice_ref",
  "wk_ref", "integration_effects_unconfirmed"]);
const SUMMARY_STRING_MAX_CHARS = 256;

const MINIMAL_FACT_MAX_BYTES = 128;

const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isShortFact = (value) => typeof value === "boolean" || typeof value === "number" ||
  (typeof value === "string" && value.length <= SUMMARY_STRING_MAX_CHARS);
const isMinimalFact = (value) => isShortFact(value) &&
  (typeof value !== "string" || Buffer.byteLength(value, "utf8") <= MINIMAL_FACT_MAX_BYTES);
const refuse = (reason, details = {}) => {
  throw selectedResponseQueryInvalidError(INTEGRATION_ORIGINAL_PRODUCER, reason, details);
};

function outcomeOf(original, admits = isShortFact) {
  const { result } = original;

  if (!isRecord(result)) {
    return Object.hasOwn(original, "completed_recovery_result")
      ? { result_recorded: false, completed_recovery_result: isRecord(original.completed_recovery_result)
        ? factsOf(original.completed_recovery_result, admits) : null }
      : { result_recorded: false };
  }
  return { result_recorded: true, ...factsOf({ ...result,
    saved_dispositions: original.saved_dispositions ?? result.saved_dispositions }, admits) };
}

export const projectCompletedRecoveryResult = (completed) =>
  outcomeOf({ completed_recovery_result: completed }).completed_recovery_result;

function factsOf(result, admits) {
  const outcome = {};
  for (const fact of OUTCOME_FACTS) if (admits(result[fact])) outcome[fact] = result[fact];
  for (const [member, facts] of [["blocker", ["code", "reason"]], ["record_reconciliation", ["state"]]]) {
    if (!isRecord(result[member])) continue;
    outcome[member] = Object.fromEntries(facts.filter((fact) => admits(result[member][fact]))
      .map((fact) => [fact, result[member][fact]]));
  }
  const saved = result.saved_dispositions;
  if (isRecord(saved)) outcome.saved_dispositions = { state: saved.state,
    source: saved.source ?? null, row_count: Array.isArray(saved.rows) ? saved.rows.length : 0,
    ...(saved.cause === undefined ? {} : { cause_code: saved.cause.code }) };
  if (isRecord(result.cleanup)) outcome.cleanup = { state: result.cleanup.state,
    retirement_state: result.cleanup.managed_identity_retirement?.state ?? null,
    retirement_code: result.cleanup.managed_identity_retirement?.code ?? null,
    ...(isRecord(result.cleanup.wk_checkout) ? { checkout_state: result.cleanup.wk_checkout.state,
      checkout_code: result.cleanup.wk_checkout.code ?? null } : {}) };
  if (admits !== isShortFact) return outcome;
  const written = projectPublishedIntegrationReceipt({ integration: result }).integration.transition;
  if (isRecord(written?.written_record)) outcome.written_record = written.written_record.omitted;
  return outcome;
}

function minimalOutcomeOf(original) {
  const full = outcomeOf(original);
  const minimal = outcomeOf(original, isMinimalFact);
  return { ...minimal, summarized: "minimal", reason: "outcome_summary_exceeds_response_bound",
    omitted_facts: Object.keys(full).filter((fact) => JSON.stringify(full[fact]) !== JSON.stringify(minimal[fact])) };
}

export function createIntegrationOriginals({ workspace, sessionEnv = process.env, responseEnv = process.env }) {

  const responseOwner = (envelope, options) => jsonContent(envelope, { env: responseEnv, ...options,
    selectedAccess: () => ({ operator_only: true }) });

  function authenticateSession() {
    const profile = parseToolProfile(sessionEnv);
    if (!shouldExposeTool(profile, "integrate_work")) {
      refuse("session_not_entitled_to_integration", { profile, operation: INTEGRATION_ORIGINAL_PRODUCER });
    }
  }

  function summarize(subject, carrier, original) {
    const bound = selectedResponseDeliveryBound(responseEnv);
    const frame = (outcome, state) => ({ schema_version: INTEGRATION_ORIGINAL_SUMMARY_SCHEMA_VERSION,
      producer: INTEGRATION_ORIGINAL_PRODUCER, repository: workspace.repo, subject, outcome, original: state });
    const minimal = minimalOutcomeOf(carrier);
    const candidates = [frame(outcomeOf(carrier), original), frame(minimal, original)];
    if (isRecord(original.retention_failure)) {
      const { cause: _cause, cause_serialization_failure: _failure, ...known } = original.retention_failure;
      candidates.push(frame(minimal, { ...original, retention_failure: { ...known, cause_omitted: true } }));
    }
    for (const candidate of candidates) {
      if (measureMcpInlineResultBytes(candidate) <= bound) return Object.freeze(candidate);
    }
    return refuse("projection_exceeds_delivery_bound", { bound });
  }

  const retained = (locator) => ({ available: true, locator,
    file: describeRetainedArtifactFile(locator, { env: responseEnv }) });

  function retain({ subject, original }) {
    authenticateSession();
    if (!(subject === null || typeof subject === "string" && subject.length > 0 &&
        subject.length <= SUMMARY_STRING_MAX_CHARS) || !isRecord(original)) {
      throw new TypeError("an integration original is one JSON object retained for one subject or for none");
    }
    let locator;
    try {
      locator = retainSelectedResponseSource({ carrier: original, binding: {
        route: INTEGRATION_ORIGINAL_PRODUCER, repository: workspace.repo, unit: subject } }, { responseOwner });
    } catch (error) {

      if (!isPersistenceFailure(error)) throw error;
      return summarize(subject, original, { available: false, locator: null, file: null,
        retention_failure: describeRetentionFailure(error, { operation: RETAIN_OPERATION, subject: { subject } }) });
    }
    return summarize(subject, original, retained(locator));
  }

  function read(request, { project = null } = {}) {
    authenticateSession();
    const rejected = !isRecord(request) ? ["request"] : Object.keys(request).filter((key) => key !== "result");
    const result = isRecord(request) ? request.result : undefined;
    if (rejected.length === 0 && (!isRecord(result) || Object.keys(result).join() !== "ref_id" ||
        typeof result.ref_id !== "string")) rejected.push("result");
    if (rejected.length > 0) refuse("read_names_exactly_one_retained_result", { rejected_arguments: rejected });
    const locator = { ref_id: result.ref_id };
    const { binding, carrier } = readSelectedResponseSource(locator, { env: responseEnv,
      expected: { route: INTEGRATION_ORIGINAL_PRODUCER, repository: workspace.repo } });
    if (!(binding.unit === null || typeof binding.unit === "string") || !isRecord(carrier)) {
      refuse("source_binding_mismatch", { binding_field: "unit" });
    }
    const summary = summarize(binding.unit, carrier, retained(locator));
    return project === null ? summary : project({ binding, carrier, summary });
  }

  return Object.freeze({ retain, read });
}

export function prepareIntegrateWorkResponse({ result, original, request, responseEnv }) {
  const retained = original?.captured === true ? original.retained : null;
  const locator = retained?.original?.locator ?? null;
  const saved = result.saved_dispositions;
  const body = {
    schema_version: "integrate-work.v1",
    outcome: result.integrated !== true ? result.integration_effects_unconfirmed === true ? "unresolved" : "refused"
      : result.cleanup?.state === "complete" && result.cleanup.wk_checkout?.state !== "superseded" &&
      result.record_reconciliation?.state !== "pending" && result.record_reconciliation?.state !== "blocked" &&
      result.recovery_failure === undefined ? "integrated" : "partial",
    effects: { integrated: result.integration_effects_unconfirmed === true ? null : result.integrated === true,
      record: result.record_reconciliation?.state ?? (result.transition?.written === true ? "written"
        : result.integrated === true ? "unconfirmed" : "not_attempted"),
      retirement: result.cleanup?.managed_identity_retirement?.state ?? "not_attempted",

      checkout: result.cleanup?.wk_checkout?.state ?? "not_attempted" },
    delivery: { commit: result.delivery_sha ?? null, integrated_sha: result.wk_sha ?? null },
    saved_dispositions: saved === null || saved === undefined ? { state: "unconsumed" } : {
      state: saved.state, source: saved.source ?? null, row_count: saved.rows?.length ?? 0,
      cause_code: saved.cause?.code ?? null },
    policy: result.boundary_authorization?.policy_posture ?? result.policy_posture ?? "not_evaluated",
    cause: result.refusal === undefined ? { code: result.code ?? result.recovery_failure?.value?.properties?.code ?? result.record_reconciliation?.code ??
      result.cleanup?.wk_checkout?.code ?? result.cleanup?.managed_identity_retirement?.code ?? retained?.original?.retention_failure?.cause_code ??
      original?.evidence?.value?.properties?.code ?? null,
    message: result.reason ?? result.recovery_failure?.value?.message ?? result.record_reconciliation?.reason ??
      result.cleanup?.wk_checkout?.message ?? original?.evidence?.value?.message ?? null }
      : { code: result.refusal.code ?? null, message: result.refusal.reason ?? null },
    original: retained?.original ?? { available: false, locator: null,
      cause: original?.evidence?.code ?? "integration_original_unavailable" },
    next_calls: locator === null ? [] : [{ tool: "get_run_result", arguments: { result: locator }, recommended: true }]
  };
  if (body.outcome === "integrated" && body.original.available !== true) body.outcome = "partial";
  if (body.outcome === "partial" && result.approval_refusal === undefined && request?.delivery !== undefined &&
      (result.cleanup?.state !== "complete" || result.record_reconciliation?.state === "pending" ||
        result.record_reconciliation?.state === "blocked" || result.recovery_failure !== undefined)) body.next_calls.push({
    tool: "integrate_work", arguments: request, recommended: false,

    condition: result.cleanup?.wk_checkout?.state === "superseded"
      ? "after the reported record or retirement cause is corrected; explicit recovery only"
      : "after the reported record, retirement or checkout cause is corrected; explicit recovery only" });

  const integratedSubject = retained?.subject;
  if (result.integrated === true && result.integration_effects_unconfirmed !== true &&
      typeof result.wk_sha === "string" && COMMIT_RE.test(result.wk_sha) &&
      typeof integratedSubject === "string" && integratedSubject.length > 0) body.next_calls.push({
    tool: "verify_proof", arguments: { subject: integratedSubject, git_sha: result.wk_sha }, recommended: false,
    condition: "optional: verifies saved proofs on the integrated WK commit, not the worker's delivery commit" });
  const bound = selectedResponseDeliveryBound(responseEnv);
  if (measureMcpInlineResultBytes(body) > bound) {
    body.cause = { code: body.cause.code, message_omitted: true };
    const { file: _file, ...originalState } = body.original;
    body.original = originalState;
    if (body.original.retention_failure !== undefined) {
      const { cause: _cause, cause_serialization_failure: _serialization, ...failure } = body.original.retention_failure;
      body.original = { ...body.original, retention_failure: { ...failure, cause_detail_omitted: true } };
    }
  }
  if (measureMcpInlineResultBytes(body) > bound) refuse("projection_exceeds_delivery_bound", { bound });
  return Object.freeze({ registered: false, body, approval: request });
}
