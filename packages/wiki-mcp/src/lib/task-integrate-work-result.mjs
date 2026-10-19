

import { projectPublishedIntegrationReceipt } from "./dispatch-run-status-integration-receipt-projection.mjs";
import { describeRetainedArtifactFile, describeRetentionFailure, jsonContent }
  from "./mcp-response.mjs";
import { readSelectedResponseSource, retainSelectedResponseSource,
  selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { distillCapturedCauses } from "./dispatch-tool-helpers.mjs";
import { COMMITTED_SLICE_REVIEW_ADMISSION_CODES }
  from "@agent-chassis/agent-launch-cli/src/lib/committed-slice-review-admission.mjs";

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

const COMMIT_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function projectSourceInspection(result) {
  const finalization = result?.cleanup?.wk_checkout;
  const checkout = finalization?.checkout;
  if (finalization?.state === "superseded" || checkout?.state === "superseded") return { state: "superseded" };
  if (finalization?.state === "pending") return { state: "pending" };
  if (result?.integrated !== true || result.integration_effects_unconfirmed === true ||
      finalization?.state !== "complete" || !isRecord(checkout) ||
      !["synchronized", "current"].includes(checkout.state) || checkout.clean !== true ||
      typeof checkout.worktree_path !== "string" || checkout.worktree_path.length === 0 ||
      typeof checkout.branch_ref !== "string" || checkout.branch_ref.length === 0 ||
      typeof checkout.target_sha !== "string" || !COMMIT_RE.test(checkout.target_sha) ||
      checkout.target_sha !== result.wk_sha || typeof checkout.target_tree !== "string" ||
      !COMMIT_RE.test(checkout.target_tree)) return { state: "unavailable" };
  return { state: "synchronized", worktree_path: checkout.worktree_path, integrated_sha: checkout.target_sha,
    guidance: "Integration observed a clean exact checkout. Inspect source at this path through this session's " +
      "permitted file-reading tools; confirm it still matches integrated_sha. This is a historical observation, " +
      "not a guarantee of current contents, cleanliness or access." };
}

const isScalarFact = (value) => typeof value === "boolean" || typeof value === "number" ||
  typeof value === "string";
const refuse = (reason, details = {}) => {
  throw selectedResponseQueryInvalidError(INTEGRATION_ORIGINAL_PRODUCER, reason, details);
};

function outcomeOf(original, admits = isScalarFact) {
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
      checkout_code: result.cleanup.wk_checkout.code ?? null } : {}),
    ...(isRecord(result.cleanup.slice_checkout) ? { slice_checkout_state: result.cleanup.slice_checkout.state,
      slice_checkout_code: result.cleanup.slice_checkout.code ?? null } : {}) };
  if (admits !== isScalarFact) return outcome;
  const written = projectPublishedIntegrationReceipt({ integration: result }).integration.transition;
  if (isRecord(written?.written_record)) outcome.written_record = written.written_record.omitted;
  return outcome;
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
    const frame = (outcome, state) => ({ schema_version: INTEGRATION_ORIGINAL_SUMMARY_SCHEMA_VERSION,
      producer: INTEGRATION_ORIGINAL_PRODUCER, repository: workspace.repo, subject, outcome,
      source_inspection: projectSourceInspection(carrier.result), original: state });
    return Object.freeze(frame(outcomeOf(carrier), original));
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

function failureMeaning(value) {
  if (value?.code === COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED &&
      value.detail?.reason === "committed_slice_delta_not_applicable") return {
    code: value.code, reason: value.detail.reason,
    message: "The selected immutable delivery conflicts with the current WK tip." };

  const evidence = value?.evidence ?? value?.cause;
  const [origin] = distillCapturedCauses(evidence?.schema_version ===
    "agent_launch.post_worker_lifecycle_failure_evidence.v1" ? evidence.thrown : evidence);
  return { code: value?.code ?? origin?.code ?? null,
    message: value?.message ?? origin?.message ?? value?.reason ?? null };
}

export async function prepareIntegrateWorkResponse({ result, original, request,
  receivingRole, requestContracts, selection = null }) {
  const retained = original?.captured === true ? original.retained : null;
  const locator = retained?.original?.locator ?? null;
  const integrated = result.integration_effects_unconfirmed === true ? null : result.integrated === true;
  const effects = { integrated,
    record: result.record_reconciliation?.state ?? (result.transition?.written === true ? "written"
      : integrated === true ? "unconfirmed" : "not_attempted"),
    retirement: result.cleanup?.managed_identity_retirement?.state ?? "not_attempted",
    checkout: result.cleanup?.wk_checkout?.state ?? "not_attempted",
    slice_checkout: result.cleanup?.slice_checkout?.state ?? "not_attempted" };
  const complete = integrated === true && result.cleanup?.state === "complete" &&
    effects.checkout !== "superseded" && !["pending", "blocked"].includes(effects.record) &&
    result.recovery_failure === undefined;
  const outcome = integrated !== true ? integrated === null ? "unresolved" : "refused"
    : complete && locator !== null ? "integrated" : "partial";
  const subject = selection?.subject ?? retained?.subject ?? null;
  const statedEffects = Object.fromEntries(Object.entries({ record: result.record_reconciliation?.state ??
    (result.transition?.written === true ? "written" : undefined),
    retirement: result.cleanup?.managed_identity_retirement?.state, checkout: result.cleanup?.wk_checkout?.state,
    slice_checkout: result.cleanup?.slice_checkout?.state }).filter(([, value]) => value !== undefined));
  const body = { schema_version: "integrate-work.v1", outcome,
    ...(subject === null ? {} : { subject }),
    effects: outcome === "integrated" ? { integrated: true }
      : integrated === true ? effects : { integrated, ...statedEffects },
    ...(result.delivery_sha == null && result.wk_sha == null ? {} : {
      delivery: { commit: result.delivery_sha ?? null, integrated_sha: result.wk_sha ?? null } }),

    ...(locator === null ? { original: { available: false } } : {}),
    next_calls: locator === null ? [] : [{ tool: "get_run_result", arguments: { result: locator },
      recommended: false, condition: "if further integration outcome detail is needed" }] };
  if (outcome !== "integrated") {
    if (request?.delivery !== undefined) body.selection = request.delivery;

    const retentionFailure = retained?.original?.retention_failure;
    const failures = [result.refusal,
      integrated !== true || result.code != null ? result : undefined,
      { evidence: result.recovery_failure },
      ...[result.record_reconciliation, result.cleanup?.wk_checkout,
        result.cleanup?.managed_identity_retirement, result.cleanup?.slice_checkout].filter(isOutstandingEffect),
      { code: retentionFailure?.cause_code, message: retentionFailure?.message },
      { code: original?.evidence?.code, evidence: original?.evidence }].map(failureMeaning);
    body.cause = failures.find(value => value.code !== null || value.message !== null) ?? { code: null, message: null };

    body.remaining = Object.entries({
      record: result.record_reconciliation,
      retirement: result.cleanup?.managed_identity_retirement,
      checkout: result.cleanup?.wk_checkout, slice_checkout: result.cleanup?.slice_checkout
    }).filter(([, value]) => isOutstandingEffect(value))
      .map(([effect, value]) => {
        const { code, message } = failureMeaning(value);
        return { effect, state: value.state, owner: INTEGRATION_REMAINDER_OWNERS[effect],
          ...(code == null || code === body.cause.code ? {} : { code }),
          ...(message == null || message === body.cause.message ? {} : { message }) };
      });
    if (body.remaining.length === 0) delete body.remaining;
    if (result.recovery !== undefined) body.recovery = result.recovery;
  }
  let correction = result.correction;
  const stale = result.code === "agent_launch.slice_integration.approved_delivery_mismatch.v1";
  if (stale && typeof selection?.attempt_id === "string") correction = {
    reason: "approved_delivery_changed",
    message: "This approval no longer identifies the current delivery. Observe the same attempt before choosing again; " +
      "if it returns this same delivery, stop. Do not substitute a current commit or retry this approval unchanged.",
    call: buildNextCall({ tool: "get_run_result", recommended: true,
      arguments: { subject: selection.subject, attempt_id: selection.attempt_id } }) };
  if (correction !== undefined) {
    body.correction = { reason: correction.reason, message: correction.message };
    body.next_calls.unshift(correction.call);
  }
  if (stale && selection?.observation_unavailable !== undefined) {
    body.observation_unavailable = selection.observation_unavailable;
  }
  const repairable = integrated === true && outcome === "partial" && result.approval_refusal === undefined &&
    (body.remaining?.some(item => item.state !== "superseded") ||
      result.recovery_failure !== undefined && result.cleanup?.state !== "complete" ||
      result.cleanup?.state === "pending");
  if (repairable && request?.delivery !== undefined) {
    body.recovery = { state: "after_correction", message: "Integration stands. This result supplies no correction call for the reported " +
      "remaining cause. Stop while it persists; after that condition changes, the exact-selection call recovers only unfinished effects." };
    body.next_calls.push({ tool: "integrate_work", arguments: request, recommended: false,
      condition: result.cleanup?.wk_checkout?.state === "superseded"
        ? "after the reported record, retirement or slice cleanup cause is corrected; explicit recovery only"
        : "after the reported record, retirement, checkout or slice cleanup cause is corrected; explicit recovery only" });
  }

  if (integrated === true && typeof result.wk_sha === "string" && COMMIT_RE.test(result.wk_sha) &&
      typeof subject === "string" && subject.length > 0 && receivingRole === "orchestrator") {
    body.next_calls.push({ ...buildNextCall({ tool: "verify_proof", arguments: { subject, git_sha: result.wk_sha },
      condition: "if required verification of this integrated commit is still outstanding" }),
      recommended: false });
  }
  if (outcome !== "integrated" && body.recovery === undefined) body.recovery = correction !== undefined
    ? { state: "observe_before_selection" } : {
    state: "no_supported_route",
    message: complete
      ? "Integration is complete, but its historical result is unavailable. Do not repeat integration to recreate evidence."
      : effects.checkout === "superseded"
        ? "Integration stands; a newer integration owns the checkout. Repeating this delivery cannot restore it."
        : "Stop this integration request at the reported cause. No supported in-session correction is available; " +
          "do not retry unchanged or replace the selected source." };
  const permitted = [], limitations = [];
  for (const call of body.next_calls) {
    const contract = requestContracts?.contractFor(call.tool);
    const reason = !shouldExposeTool(receivingRole, call.tool) ||
      call.tool === "integrate_work" && receivingRole !== "orchestrator" ? "operation_not_permitted"
      : contract == null ? "operation_not_registered"
        : await contract.acceptsArguments(call.arguments) ? null : "arguments_not_supported";
    if (reason === null) permitted.push(call);
    else if (call.tool === "integrate_work" || call === correction?.call) limitations.push({ tool: call.tool, reason,
      message: "This continuation is unavailable in this session. Stop this dependent step; no call was made." });
  }
  body.next_calls = permitted;
  if (limitations.length > 0) body.continuation_limitations = limitations;
  if (repairable && !permitted.some(call => call.tool === "integrate_work")) body.recovery = {
    state: "no_supported_route", message: "Integration stands, but this session cannot finalize the reported remaining effects. " +
      "Stop this recovery; do not reapply work or replace the selected source." };
  if (correction !== undefined && !permitted.includes(correction.call)) body.recovery = {
    state: "no_supported_route", message: "The required source observation is unavailable in this session. " +
      "Stop this selection correction; do not retry the rejected approval or choose a replacement source." };
  return Object.freeze({ registered: false, body, approval: request, source: locator });
}

const INTEGRATION_REMAINDER_OWNERS = Object.freeze({
  record: "canonical work-record persistence owner",
  retirement: "managed worker identity owner",
  checkout: "owned WK checkout synchronization owner",
  slice_checkout: "exact-slice checkout reaper"
});

function isOutstandingEffect(value) {
  return ["pending", "blocked", "superseded", "failed"].includes(value?.state);
}
