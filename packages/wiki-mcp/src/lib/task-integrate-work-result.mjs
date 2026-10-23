

import { projectPublishedIntegrationReceipt } from "./dispatch-run-status-integration-receipt-projection.mjs";
import { describeRetainedArtifactFile, describeRetentionFailure, jsonContent }
  from "./mcp-response.mjs";
import { findSelectedResponseSources, readSelectedResponseSource, retainSelectedResponseSource,
  selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { distillCapturedCauses } from "./dispatch-tool-helpers.mjs";
import { isDeepStrictEqual } from "node:util";
import { COMMITTED_SLICE_REVIEW_ADMISSION_CODES }
  from "@agent-chassis/agent-launch-cli/src/lib/committed-slice-review-admission.mjs";
import { defaultTerminalCandidateRunGit } from
  "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate.mjs";
import { classifyAncestryObservation, mintGitFailure, TERMINAL_WK_CANDIDATE_CODES } from
  "@agent-chassis/agent-launch-cli/src/lib/terminal-wk-candidate-ref-publication.mjs";

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
        route: INTEGRATION_ORIGINAL_PRODUCER, repository: workspace.repo, unit: subject,
        query_identity: null } }, { responseOwner });
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

  function preparationAccounts({ units, delivery: requestedDelivery = null, approvedDelivery = null }) {
    authenticateSession();
    const accounts = new Map();
    for (const unit of units) {
      const sources = findSelectedResponseSources({ env: responseEnv, expected: {
        route: INTEGRATION_ORIGINAL_PRODUCER, repository: workspace.repo, unit,
        query_identity: null, authority_identity: undefined } });
      for (const { carrier, current } of sources) {
        const delivery = carrier.request?.delivery;
        const result = carrier.result;
        const approved = carrier.approved_delivery;
        if (!current || typeof delivery?.ref_id !== 'string' || result?.integrated !== true ||
            requestedDelivery !== null && requestedDelivery.ref_id !== delivery.ref_id ||
            approvedDelivery !== null && !isDeepStrictEqual(approvedDelivery, approved) ||
            approved?.subject !== unit || approved.commit !== result.delivery_sha ||
            !COMMIT_RE.test(result.slice_sha ?? '')) continue;
        const account = accounts.get(delivery.ref_id) ?? { complete: null, pending: [], entries: [] };
        const entry = { unit, delivery, integrated: result.slice_sha, result };
        account.entries.push(entry);
        if (result.candidate_preparation?.state === 'complete' && result.recovery_failure === undefined) {

          if (account.complete?.result.cleanup?.state !== 'complete' || result.cleanup?.state === 'complete') account.complete = entry;
        } else if ((result.review_target != null || result.integrated_state === 'final') &&
            result.record_reconciliation?.state !== 'pending' && result.record_reconciliation?.state !== 'blocked') {
          account.pending.push(entry);
        }
        accounts.set(delivery.ref_id, account);
      }
    }
    return accounts;
  }
  function deliveryPreparation({ unit, delivery = null, approvedDelivery = null }) {

    if (delivery === null && approvedDelivery === null) throw new TypeError('delivery preparation requires its authenticated selection');
    const accounts = preparationAccounts({ units: [unit], delivery, approvedDelivery });
    if (accounts.size !== 1) return null;
    const account = accounts.values().next().value;
    const entries = account.entries;
    if (new Set(entries.map(entry => JSON.stringify([entry.result.delivery_sha, entry.integrated]))).size !== 1) {
      refuse('retained_delivery_integration_disagrees');
    }
    return { ...(account.complete ?? entries[0]), complete: account.complete !== null };
  }
  async function unfinishedPreparation({ units, candidate = null, delivery = null }) {
    const accounts = preparationAccounts({ units, delivery });
    const choices = [];
    for (const account of accounts.values()) {
      if (account.complete) continue;
      for (const pending of account.pending) {
        if (candidate === null) {
          if (!choices.some(row => row.delivery.ref_id === pending.delivery.ref_id)) choices.push(pending);
          continue;
        }
        const compared = await defaultTerminalCandidateRunGit({ repo: workspace.dir,
          args: ['merge-base', '--is-ancestor', pending.integrated, candidate.wk_tip], env: null });
        const ancestry = classifyAncestryObservation(compared);
        if (ancestry === 'failed') throw mintGitFailure(TERMINAL_WK_CANDIDATE_CODES.GIT_FAILED,
          'could not compare the selected candidate with its integrated implementation', compared,
          { args: ['merge-base'], path: candidate.wk_ref });
        if (ancestry === 'ancestor' && !choices.some(row => row.delivery.ref_id === pending.delivery.ref_id)) choices.push(pending);
      }
    }
    if (choices.length !== 1) return null;
    if (candidate === null) return choices[0];
    return { tool: 'integrate_work', arguments: { delivery: choices[0].delivery,
      candidate_version: candidate.version_decision.version_identity } };
  }
  return Object.freeze({ retain, read, unfinishedPreparation, deliveryPreparation });
}

function failureMeaning(value) {
  if (value?.code === COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED &&
      value.detail?.reason === "committed_slice_delta_not_applicable" ||
      value?.code === 'agent_launch.slice_integration.rebase_conflict.v1') {
    const native = value.detail?.merge_tree;
    return { code: value.code, ...(value.detail?.reason === undefined ? {} : { reason: value.detail.reason }),
      message: "The selected immutable delivery conflicts with the current WK tip.",
      ...(native?.operation === undefined ? {} : { operation: native.operation }),
      ...(native?.identities === undefined ? {} : { sources: native.identities }),
      ...(native?.conflicts?.state === 'available' ? { conflicted_paths: native.conflicts.paths }
        : { affected_paths: { state: 'unavailable', cause: native?.conflicts?.cause ?? 'conflict_paths_unestablished' } }) };
  }

  const evidence = value?.recovery_failure ?? value?.evidence ?? value?.cause;
  const [origin, ...nested] = distillCapturedCauses(evidence?.schema_version ===
    "agent_launch.post_worker_lifecycle_failure_evidence.v1" ? evidence.thrown : evidence);

  const describe = cause => ({
    ...(cause?.code == null ? {} : { code: cause.code }),
    ...(cause?.message == null && cause?.reason == null ? {} : { message: cause.message ?? cause.reason }),
    ...(cause?.process_failure?.errors?.length > 0 ? { diagnostics: cause.process_failure.errors } : {})
  });
  const primary = describe(origin);
  const causes = nested.map(describe).filter(cause => Object.keys(cause).length > 0);
  return { code: value?.code ?? origin?.code ?? null,
    message: primary.message ?? value?.message ?? value?.reason ?? null,
    ...(primary.diagnostics === undefined ? {} : { diagnostics: primary.diagnostics }),
    ...(causes.length === 0 ? {} : { causes }) };
}

function remainingEffects(result, cause = {}) {
  return Object.entries({ record: result.record_reconciliation,
    retirement: result.cleanup?.managed_identity_retirement,
    checkout: result.cleanup?.wk_checkout, slice_checkout: result.cleanup?.slice_checkout
  }).filter(([, value]) => isOutstandingEffect(value)).map(([effect, value]) => {
    const { code, message, causes, diagnostics } = failureMeaning(value);
    return { effect, state: value.state,
      ...(code == null || code === cause.code ? {} : { code }),
      ...(message == null || message === cause.message ? {} : { message }),
      ...(diagnostics === undefined || isDeepStrictEqual(diagnostics, cause.diagnostics) ? {} : { diagnostics }),
      ...(causes === undefined || isDeepStrictEqual(causes, cause.causes) ? {} : { causes }) };
  });
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
    ...(result.delivery_sha == null && result.slice_sha == null ? {} : {
      delivery: { commit: result.delivery_sha ?? null, integrated_sha: result.slice_sha ?? null } }),

    ...(locator === null ? { original: { available: false } } : {}),
    next_calls: locator === null ? [] : [{ tool: "get_run_result", arguments: { result: locator },
      recommended: false, condition: "if further integration outcome detail is needed" }] };
  if (result.prior_integration !== undefined) {
    const remaining = remainingEffects({ cleanup: result.prior_cleanup });
    body.prior_integration = { ...result.prior_integration, ...(remaining.length === 0 ? {} : { remaining }) };
  }
  if (result.preparation_not_attempted === true) {
    body.effects_scope = 'this_invocation';
    body.effects.candidate_preparation = 'not_attempted';
  }
  if (outcome !== "integrated") {
    if (request?.delivery !== undefined) body.selection = request.delivery;
    if (request?.candidate_version !== undefined) body.candidate_version = request.candidate_version;

    const retentionFailure = retained?.original?.retention_failure;
    const failures = [result.refusal,
      integrated !== true || result.code != null ? result : undefined,
      { evidence: result.recovery_failure },
      ...[result.record_reconciliation, result.cleanup?.wk_checkout,
        result.cleanup?.managed_identity_retirement, result.cleanup?.slice_checkout].filter(isOutstandingEffect),
      { code: retentionFailure?.cause_code, message: retentionFailure?.message },
      { code: original?.evidence?.code, evidence: original?.evidence }].map(failureMeaning);
    body.cause = failures.find(value => value.code !== null || value.message !== null || value.causes !== undefined)
      ?? { code: null, message: null };

    body.remaining = remainingEffects(result, body.cause);
    if (body.remaining.length === 0) delete body.remaining;
    if (result.recovery !== undefined) body.recovery = result.recovery;
    if (body.cause.conflicted_paths !== undefined || body.cause.affected_paths !== undefined) body.recovery = {
      state: 'no_supported_route',
      message: 'An authorized implementation worker must resolve the conflicting content in the intended work. ' +
        'This immutable delivery cannot be edited or merged through this call. Preserve this selection; ' +
        'a corrected delivery requires a new explicit integration decision.' };
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
    if (correction.choice !== undefined) body.next_calls.push(correction.choice);
  }
  if (stale && selection?.observation_unavailable !== undefined) {
    body.observation_unavailable = selection.observation_unavailable;
  }
  const repairable = integrated === true && outcome === "partial" && result.approval_refusal === undefined &&
    correction?.reason !== 'candidate_preparation_selection_moved' &&
    (body.remaining?.some(item => item.state !== "superseded") ||
      result.recovery_failure !== undefined && result.cleanup?.state !== "complete" ||
      result.cleanup?.state === "pending");
  if (repairable && request?.delivery !== undefined) {
    body.recovery = { state: "after_correction", message: correction === undefined
      ? "Integration stands. The reported condition must be corrected before " +
        "the returned integration call can finish the remaining work. No correction call is available here."
      : "Integration stands. Follow the returned correction and resolve the reported condition before retrying this exact delivery " +
        "to finish only the remaining work." };
    body.next_calls.push({ tool: "integrate_work", arguments: request, recommended: false,
      condition: "after the reported remaining condition is corrected" });
  }

  if (integrated === true && typeof result.slice_sha === "string" && COMMIT_RE.test(result.slice_sha) &&
      typeof subject === "string" && subject.length > 0 && receivingRole === "orchestrator") {
    body.next_calls.push({ ...buildNextCall({ tool: "verify_proof", arguments: { subject, git_sha: result.slice_sha },
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
  const selectedPreparation = request?.candidate_version !== undefined &&
    result.candidate_preparation?.version === request.candidate_version ? result.candidate_preparation : null;
  if (selectedPreparation?.state === 'complete' || selectedPreparation?.state === 'incomplete') {
    body.observed_facts = { 'integration.preparation_complete': selectedPreparation.state === 'complete' };
  }
  if (selectedPreparation?.state === 'complete') {
    body.candidate_preparation = result.candidate_preparation;
    body.next_calls.push({ ...buildNextCall({ tool: 'workspace_publish_work',
      arguments: { subject: subject.split('#')[0] } }), recommended: false,
      condition: 'if publication remains intended and authorized; preparation grants no publication authority' });
  }
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
  if (correction !== undefined && !permitted.includes(correction.call)) {
    body.next_calls = body.next_calls.filter(call => call.tool !== "integrate_work");
    body.recovery = { state: "no_supported_route", message: "The required correction read is unavailable in this session. " +
      "Stop this correction; do not retry unchanged or choose a replacement source." };
  }
  return Object.freeze({ registered: false, body, approval: request, source: locator });
}

function isOutstandingEffect(value) {
  return ["pending", "blocked", "superseded", "failed"].includes(value?.state);
}
