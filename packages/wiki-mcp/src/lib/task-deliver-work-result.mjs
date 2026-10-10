

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { recordManagedDeliveryReceipt, findManagedDeliveryReceipt, readManagedRunObservation } from
  "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { deriveManagedRunIdentityTupleFromBindingPair, sameTuple } from
  "../../../agent-launch-cli/src/lib/managed-run-process-identity-contract.mjs";

import { serializeWorkRecordDiagnosticValue } from
  "@agent-chassis/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";

import { verifyExactSliceCommitBinding } from
  "../../../agent-launch-cli/src/lib/exact-slice-commit-binding.mjs";
import { resolveWorktreeBinding } from
  "../../../agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { managedTestAuthorityAuthenticated, managedTestAuthorityIdentity } from "./managed-test-source-context.mjs";
import { jsonContent, getResponseSpillConfig } from "./mcp-response.mjs";
import { readSelectedResponseEvidence, readSelectedResponseSource, retainSelectedResponseSource,
  selectedResponseLocatorNotCurrentError, selectedResponseQueryInvalidError, findSelectedResponseSources }
  from "./selected-response-snapshot.mjs";

export const DELIVERY_ORIGINAL_PRODUCER = "workspace_deliver_work";

const ORIGINAL_DIAGNOSTIC_PATH = `${DELIVERY_ORIGINAL_PRODUCER}.original`;

const RUN_FIELDS = Object.freeze(["launch_ref", "run_id", "retry_id"]);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

class DeliveryReceiptPublicationError extends Error {
  constructor(cause) {
    super(cause instanceof Error ? cause.message : cause.refusal?.reason ?? cause.code, { cause });
    this.name = "DeliveryReceiptPublicationError";
    this.code = cause.code ?? cause.refusal?.code;
    if (cause.envelope !== undefined) this.envelope = cause.envelope;
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

function readResult(request) {
  const rejected = !isRecord(request) ? ["request"] : Object.keys(request).filter((key) => key !== "result");
  const result = isRecord(request) ? request.result : undefined;
  if (rejected.length === 0 && (!isRecord(result) || Object.keys(result).join() !== "ref_id" ||
      typeof result.ref_id !== "string")) rejected.push("result");
  if (rejected.length > 0) {
    throw selectedResponseQueryInvalidError(DELIVERY_ORIGINAL_PRODUCER,
      "read_names_exactly_one_retained_result", { rejected_arguments: rejected });
  }
  return { ref_id: result.ref_id };
}

export function resolveDeliveryReceiptEnvironment({ workspace, sessionEnv, responseEnv, result,
  required = false }) {
  const state = resolveLauncherRunState(sessionEnv);
  if (!["worker", "orchestrator"].includes(state.role) ||
      !managedTestAuthorityAuthenticated(managedTestAuthorityIdentity(state))) {
    if (required) throw selectedResponseQueryInvalidError(DELIVERY_ORIGINAL_PRODUCER, "session_not_authenticated_result_reader");
    return { env: responseEnv, receipt: null };
  }
  const mainRepo = path.resolve(workspace.dir);
  const selected = findManagedDeliveryReceipt({ mainRepo, refId: result.ref_id,
    subject: state.role === "worker" ? state.assignedUnit : null });
  if (selected === null) {
    return { env: responseEnv, receipt: null };
  }
  const { receipt, dispatchTuple } = selected;
  if (receipt.repository !== workspace.repo) throw selectedResponseQueryInvalidError(
    DELIVERY_ORIGINAL_PRODUCER, "source_binding_mismatch", { binding_field: "repository" });
  if (receipt.result.ref_id !== result.ref_id) throw selectedResponseQueryInvalidError(
    DELIVERY_ORIGINAL_PRODUCER, "source_binding_mismatch", { binding_field: "delivery_receipt.result" });
  const tuple = receipt.producer_tuple;
  const binding = resolveWorktreeBinding({ mainRepo, launchRef: tuple.launch_ref, runId: tuple.run_id, retryId: tuple.retry_id });
  verifyExactSliceCommitBinding({ binding, mainRepo, assignedUnit: receipt.unit,
    launchRef: tuple.launch_ref, runId: tuple.run_id, retryId: tuple.retry_id });
  const derived = deriveManagedRunIdentityTupleFromBindingPair({ assignedUnit: receipt.unit,
    launchRef: tuple.launch_ref, wkBinding: {}, sliceBinding: binding, expectedRunId: dispatchTuple.run_id });
  if (!sameTuple(derived, dispatchTuple) || !isDeepStrictEqual(receipt.source,
      { digest: binding.source_digest, version: binding.source_version }) ||
      receipt.delivery.base !== binding.base_sha) throw selectedResponseQueryInvalidError(
    DELIVERY_ORIGINAL_PRODUCER, "source_binding_mismatch", { binding_field: "delivery_receipt" });
  return { env: { ...responseEnv, WIKI_MCP_RESPONSE_STATE_DIR: receipt.storage.state_dir }, receipt };
}

export function publishDeliveryReceiptForSession({ workspace, sessionEnv, responseEnv, result }) {
  if (resolveLauncherRunState(sessionEnv).role !== "worker") throw new DeliveryReceiptPublicationError(
    selectedResponseQueryInvalidError(DELIVERY_ORIGINAL_PRODUCER, "receipt_publication_requires_assigned_worker"));

  let evidence;
  const original = readDeliveryOriginalForSession({ workspace, sessionEnv, responseEnv, request: { result },
    project: ({ carrier, evidence: resolved }) => { evidence = resolved; return carrier; } });
  const state = resolveLauncherRunState(sessionEnv);
  const binding = resolveWorktreeBinding({ mainRepo: path.resolve(workspace.dir),
    launchRef: state.credential.launchRef, runId: state.credential.runId, retryId: state.credential.retryId });
  if (original.identity.repository !== workspace.repo || original.identity.unit !== state.assignedUnit ||
      !isDeepStrictEqual(original.identity.binding, binding)) throw new DeliveryReceiptPublicationError(
    selectedResponseQueryInvalidError(DELIVERY_ORIGINAL_PRODUCER, "source_binding_mismatch", { binding_field: "receipt_producer_identity" }));
  const receipt = { repository: workspace.repo, unit: original.identity.unit, producer: DELIVERY_ORIGINAL_PRODUCER,
    producer_tuple: { launch_ref: binding.launch_ref, run_id: binding.run_id, retry_id: binding.retry_id },
    source: { digest: binding.source_digest, version: binding.source_version },
    delivery: { commit: original.outcome.response.transaction.delivery_commit, base: binding.base_sha },
    result: evidence,
    storage: { state_dir: getResponseSpillConfig(responseEnv).stateDir } };
  const recorded = recordManagedDeliveryReceipt({ mainRepo: path.resolve(workspace.dir),
    subject: receipt.unit, sliceBinding: binding, receipt });
  if (!recorded.ok) throw new DeliveryReceiptPublicationError(recorded);
  return { state: "published", appended: recorded.appended, result };
}

export function pendingDeliveryReceiptForSession({ workspace, sessionEnv, responseEnv }) {
  const state = resolveLauncherRunState(sessionEnv);
  const credential = state.credential;
  const binding = resolveWorktreeBinding({ mainRepo: path.resolve(workspace.dir),
    launchRef: credential.launchRef, runId: credential.runId, retryId: credential.retryId });
  const originals = createDeliveryOriginals({ workspace, binding, credential, assignedUnit: state.assignedUnit, responseEnv });
  const observed = readManagedRunObservation({ mainRepo: path.resolve(workspace.dir), subject: state.assignedUnit, sliceBinding: binding });
  if (!observed.ok) throw Object.assign(new Error(observed.refusal?.reason ?? observed.code),
    { code: observed.code ?? observed.refusal?.code, cause: observed });
  const committed = originals.sources().filter(({ carrier }) => carrier.outcome?.response?.committed === true);
  const continued = new Set(committed.map(({ carrier }) => carrier.checkout_retry?.continues?.ref_id)
    .filter((refId) => typeof refId === "string"));
  const pending = committed.filter(({ result }) => !continued.has(result.ref_id));
  if (pending.length > 1 || new Set(committed.map(({ carrier }) =>
    carrier.outcome.response.transaction?.delivery_commit)).size > 1) {
    throw selectedResponseQueryInvalidError(DELIVERY_ORIGINAL_PRODUCER,
      "pending_delivery_receipt_ambiguous", { count: committed.length });
  }

  if (pending[0]?.current === false) throw selectedResponseLocatorNotCurrentError(DELIVERY_ORIGINAL_PRODUCER,
    { committed_delivery_original: true });
  return pending[0] ?? null;
}

export function composeDeliveryCheckoutRetryOriginal({ pending, checkout }) {
  const response = pending.carrier.outcome.response;
  return { ...pending.carrier,
    checkout: { state: "returned", result: checkout },
    checkout_retry: { continues: pending.result },
    outcome: { is_error: false, response: { ...response, checkout: checkout.state,
      transaction: { ...response.transaction, checkout: checkout.facts } } } };
}

export function retainDeliveryCheckoutRetryForSession({ workspace, sessionEnv, responseEnv, original }) {
  const state = resolveLauncherRunState(sessionEnv);
  const credential = state.credential;
  const binding = resolveWorktreeBinding({ mainRepo: path.resolve(workspace.dir),
    launchRef: credential.launchRef, runId: credential.runId, retryId: credential.retryId });
  const originals = createDeliveryOriginals({ workspace, binding, credential, assignedUnit: state.assignedUnit, responseEnv });
  const result = originals.retain({ original });
  return { result, current: true, carrier: originals.read({ result }) };
}

export function readDeliveryOriginalForSession({ workspace, sessionEnv = process.env,
  responseEnv = process.env, request, project = null }) {
  const state = resolveLauncherRunState(sessionEnv);
  if (!["worker", "orchestrator"].includes(state.role) ||
      !managedTestAuthorityAuthenticated(managedTestAuthorityIdentity(state))) {
    throw selectedResponseQueryInvalidError(DELIVERY_ORIGINAL_PRODUCER,
      "session_not_authenticated_result_reader", { role: state.role ?? null });
  }
  const result = readResult(request);
  const routed = resolveDeliveryReceiptEnvironment({ workspace, sessionEnv, responseEnv, result, required: true });
  responseEnv = routed.env;
  let credential = state.credential;
  let assignedUnit = state.assignedUnit;
  if (state.role === "orchestrator") {

    const { binding } = readSelectedResponseSource(routed.receipt?.result ?? result, { env: responseEnv,
      expected: { route: DELIVERY_ORIGINAL_PRODUCER, repository: workspace.repo } });
    if (!isRecord(binding.query_identity)) {
      throw selectedResponseQueryInvalidError(DELIVERY_ORIGINAL_PRODUCER,
        "source_binding_mismatch", { binding_field: "query_identity" });
    }
    credential = { launchRef: binding.query_identity.launch_ref,
      runId: binding.query_identity.run_id, retryId: binding.query_identity.retry_id };
    assignedUnit = binding.unit;
  }
  const binding = resolveWorktreeBinding({ mainRepo: path.resolve(workspace.dir),
    launchRef: credential.launchRef, runId: credential.runId, retryId: credential.retryId });
  return createDeliveryOriginals({ workspace, binding, credential, assignedUnit, responseEnv }).read({ result }, {
    recorded: routed.receipt?.result ?? null,
    project: ({ carrier, ...rest }) => {
      if (routed.receipt !== null && !isDeepStrictEqual(routed.receipt.delivery,
        { commit: carrier.outcome?.response?.transaction?.delivery_commit, base: binding.base_sha })) {
        throw selectedResponseQueryInvalidError(DELIVERY_ORIGINAL_PRODUCER, "source_binding_mismatch", { binding_field: "delivery" });
      }
      return project === null ? carrier : project({ carrier, ...rest, responseEnv });
    } });
}

export function createDeliveryOriginals({ workspace, binding, credential, assignedUnit,
  responseEnv = process.env }) {
  if (!isRecord(workspace) || typeof workspace.repo !== "string" || workspace.repo.length === 0 ||
      typeof workspace.dir !== "string" || !isRecord(credential)) {
    throw new TypeError("delivery originals require the configured workspace and the launcher credential");
  }
  const verified = verifyExactSliceCommitBinding({
    binding,
    mainRepo: path.resolve(workspace.dir),
    assignedUnit,
    launchRef: credential.launchRef,
    runId: credential.runId,
    retryId: credential.retryId
  });

  const { subject, ...launcherBinding } = JSON.parse(JSON.stringify(verified));
  const retainedBinding = deepFreeze({
    route: DELIVERY_ORIGINAL_PRODUCER,
    repository: workspace.repo,
    unit: subject,
    query_identity: Object.fromEntries(RUN_FIELDS.map((field) => [field, launcherBinding[field]])),
    authority_identity: Object.fromEntries(Object.entries(launcherBinding)
      .filter(([field]) => !RUN_FIELDS.includes(field)))
  });
  const env = Object.freeze({ ...responseEnv });

  const responseOwner = (envelope, options) => jsonContent(envelope, { env, ...options,
    selectedAccess: () => ({ operator_only: true }) });

  let retentionFailureStage = null;

  function retain({ original } = {}) {
    retentionFailureStage = null;
    let stage = "original_serialization";
    try {
      if (!isRecord(original)) {
        throw new TypeError("a delivery original is one JSON object");
      }
      const carrier = serializeWorkRecordDiagnosticValue(original, { path: ORIGINAL_DIAGNOSTIC_PATH });
      stage = "original_retention";
      return retainSelectedResponseSource({ carrier, binding: retainedBinding }, { responseOwner });
    } catch (error) {
      retentionFailureStage = stage;
      throw error;
    }
  }

  function read(request, { project = null, recorded = null } = {}) {
    const result = readResult(request);
    const { envelope: { carrier }, evidence } = readSelectedResponseEvidence(recorded ?? result,
      { env, expected: retainedBinding });
    return project === null ? carrier : project({ carrier, binding: retainedBinding, result, evidence });
  }

  return Object.freeze({ retain, read, sources: () => findSelectedResponseSources({ env, expected: retainedBinding }),
    retentionFailureStage: () => retentionFailureStage });
}
