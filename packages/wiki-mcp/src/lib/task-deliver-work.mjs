

import { z as defaultZ } from "zod";
import { setWorkRecordStatusByUnit } from "../../../wiki-core/src/operations/work-records.mjs";
import { createWorkspaceCommitExecution } from "./workspace-commit-tool.mjs";
import { prepareDeliverWorkResponse } from "./task-deliver-work-response.mjs";
import { prepareWorkerDeliveryAnswer, completionReconciliationCall } from "./task-deliver-work-worker-answer.mjs";
import { DELIVERY_ORIGINAL_PRODUCER, publishDeliveryReceiptForSession, pendingDeliveryReceiptForSession,
  composeDeliveryCheckoutRetryOriginal, retainDeliveryCheckoutRetryForSession, readDeliveryOriginalForSession,
  pendingDeliveryCompletionReleaseForSession } from "./task-deliver-work-result.mjs";
import { activeMcpInlineByteLimit, measureMcpInlineResultBytes, jsonContent } from "./mcp-response.mjs";
import { readSelectedResponseProjection, selectedResponseLocatorSchema } from "./selected-response-snapshot.mjs";
import { finalizeDeliveryCheckout } from "./delivery-checkout-finalization.mjs";
import { createToolInputValidationError } from "./register-tool.mjs";
import { resolveLauncherRunState, LauncherSessionContractRefusal } from "./launcher-run-credential.mjs";
import { parseToolProfile } from "./tool-profile.mjs";
import { LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES } from
  "../../../agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import { captureDiagnosticEvidence } from "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import path from "node:path";
import { readManagedCompletion, reconcileManagedDeliveryCompletion } from
  "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { resolveWorktreeBinding } from "../../../agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { projectFailureDiagnosis } from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";

export function createDeliverWorkSurface({ workspace, sessionEnv = process.env, responseEnv = sessionEnv,
  z = defaultZ, executionFactory = createWorkspaceCommitExecution, writeStatus = setWorkRecordStatusByUnit,

  finalizeCheckout = finalizeDeliveryCheckout, publicDelivery = false }) {
  const env = { ...sessionEnv };
  const responseConfiguration = { ...responseEnv };
  const trustedWorkspace = Object.freeze({ ...workspace });
  const workerAnswers = new WeakMap();
  function prepareResponse(options) {
    const frame = prepareDeliverWorkResponse(options);
    const settled = options.observation?.transactionOutcome ?? options.outcome;
    workerAnswers.set(frame, prepareWorkerDeliveryAnswer(frame, {
      inputInvalid: options.inputInvalid === true,
      scopeRefusal: settled?.scope?.refusal ?? null,
      completionRecovery: settled?.completion_recovery ?? null
    }));
    return frame;
  }
  function publish(result) {
    try { return publishDeliveryReceiptForSession({ workspace: trustedWorkspace, sessionEnv: env,
      responseEnv: responseConfiguration, result }); }
    catch (error) { return { state: "failed", result, code: error.code, message: error.message,
      cause: captureDiagnosticEvidence(error) }; }
  }

  function execution(subject = null) {
    const project = (outcome, options, error = null, isError = false) => prepareResponse({
      workspace: trustedWorkspace, outcome, observation: options?.deliveryObservation,
      authenticatedSubject: subject, error, isError, responseEnv: responseConfiguration, publicDelivery,
      receiptPublication: publicDelivery && outcome.committed === true && outcome.original?.available === true
        ? publish(outcome.original.locator) : null });
    return executionFactory({ workspaceRepos: [trustedWorkspace], z,
      resolveWorkspaceRepo: () => trustedWorkspace, setWorkRecordStatusByUnit: writeStatus,
      env, responseEnv: responseConfiguration, finalizeCheckout,
      jsonContent: (payload, options) => project(payload, options),
      errorContent: (error, options) => project(error.envelope ?? {}, options, error, true) });
  }
  const requestSchema = z.object({ reconcile: selectedResponseLocatorSchema(z).optional() }).strict();
  const inputContract = { inputSchema: requestSchema.default({}), advertisedInputSchema: requestSchema };
  const completionBinding = session => ({ mainRepo: path.resolve(trustedWorkspace.dir), subject: session.assignedUnit,
    sliceBinding: resolveWorktreeBinding({ mainRepo: path.resolve(trustedWorkspace.dir),
      launchRef: session.credential.launchRef, runId: session.credential.runId, retryId: session.credential.retryId }) });
  function retainedFailure({ carrier, result }) {
    const frame = prepareResponse({ workspace: trustedWorkspace,
      outcome: { ...carrier.outcome.response, original: { available: true, locator: result } },
      observation: { identity: carrier.identity, phases: carrier, transactionOutcome: carrier.outcome.response },
      responseEnv: responseConfiguration, publicDelivery, historicalObservation: true });
    workerAnswers.get(frame).effects_scope = "retained_transaction";
    return frame;
  }
  function reconcile(session, result) {
    let frame;
    try {
      const carrier = readDeliveryOriginalForSession({ workspace: trustedWorkspace, sessionEnv: env,
        responseEnv: responseConfiguration, request: { result } });
      frame = retainedFailure({ carrier, result });
      const released = reconcileManagedDeliveryCompletion({ ...completionBinding(session), original: carrier });
      if (!released.ok) throw Object.assign(new Error(released.cause ?? released.refusal?.reason ??
        "the selected transaction's completion release was not established"),
      { code: released.code ?? released.refusal?.code,
        ...(released.cause_code == null && released.refusal?.detail?.errno == null ? {} : {
          cause: { code: released.cause_code ?? released.refusal.detail.errno,
            message: released.cause ?? released.refusal?.reason ?? "the selected attempt binding could not be established" }
        }) });
      const answer = workerAnswers.get(frame);
      const corrected = prepareWorkerDeliveryAnswer(frame, { completionRecovery: { available: true } });
      workerAnswers.set(frame, { ...corrected, outcome: "completion_restored", stage: "completion_reconciliation",
        diagnostics: answer.diagnostics.filter(row => row.stage !== "completion_release"),
        effects_scope: "retained_transaction", invocation_effects: { commit_transaction_executed: false } });
    } catch (error) {
      const authenticatedEvidence = frame !== undefined;
      frame ??= prepareResponse({ workspace: trustedWorkspace, authenticatedSubject: session.assignedUnit,
        error, isError: true, stage: "completion_reconciliation", responseEnv: responseConfiguration, publicDelivery });
      const answer = workerAnswers.get(frame);
      const retryable = authenticatedEvidence && error.code === "attempt_partition_contended";
      workerAnswers.set(frame, { ...answer,
        outcome: authenticatedEvidence && frame.body.outcome !== "uncertain" ? "refused" : "uncertain",
        stage: "completion_reconciliation",
        ...(authenticatedEvidence ? { effects_scope: "retained_transaction" } : {}),
        effects: authenticatedEvidence ? Object.fromEntries(["commit_object", "delivery_ref", "submitted_for_review", "checkout"]
          .map(key => [key, frame.body.effects[key]])) : { commit_object: "unknown", delivery_ref: "unknown",
          submitted_for_review: null, checkout: null },
        diagnostics: [...(authenticatedEvidence ? answer.diagnostics.filter(row => row.stage !== "completion_release") : []),
          { stage: "completion_reconciliation", ...projectFailureDiagnosis(error) }],
        invocation_effects: { commit_transaction_executed: false },
        next_action: { action: retryable ? "reconcile_completion" : "stop", instruction: retryable
          ? "Completion release is not established. Correct the reported cause within existing authority before repeating this exact reconciliation. No delivery or review submission was replayed; do not retry either completion alternative."
          : "The selected transaction cannot establish completion release. No delivery or review submission was replayed. Preserve prior effects and acknowledgments; do not retry either completion alternative or clear the claim." },
        next_calls: retryable ? [completionReconciliationCall(result)] : [] });
      frame.isError = true;
    }
    return frame;
  }
  async function prepare(request) {
    const parsed = await inputContract.inputSchema.safeParseAsync(request);
    if (!parsed.success) {
      const error = createToolInputValidationError({ tool: DELIVERY_ORIGINAL_PRODUCER, validationError: parsed.error });
      return prepareResponse({ workspace: trustedWorkspace, outcome: error.envelope ?? {}, error,
        isError: true, stage: "input_validation", inputInvalid: true, responseEnv: responseConfiguration, publicDelivery });
    }
    let session;
    try {
      const role = parseToolProfile(env);
      session = resolveLauncherRunState(env);
      if (role !== "worker") throw new LauncherSessionContractRefusal(
        LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES.FACT_MISMATCH,
        "delivery preparation requires an authenticated launcher worker session");
    } catch (error) {
      return prepareResponse({ workspace: trustedWorkspace, error, isError: true,
        stage: "authentication", responseEnv: responseConfiguration, publicDelivery });
    }

    if (parsed.data.reconcile !== undefined) return reconcile(session, parsed.data.reconcile);
    if (session.credential === null) return execution().handler(parsed.data);
    if (publicDelivery) {
      let recoveryStage = "receipt_recovery";
      try {
        const pending = pendingDeliveryReceiptForSession({ workspace: trustedWorkspace, sessionEnv: env,
          responseEnv: responseConfiguration });
        if (pending !== null) {

          let recovered = pending;
          let retention = null;
          const checkoutRecovery = pending.carrier.outcome.response.checkout === "pending";
          if (checkoutRecovery) {
            const original = composeDeliveryCheckoutRetryOriginal({ pending,
              checkout: await finalizeCheckout({ workspaceDir: trustedWorkspace.dir,
                credential: session.credential, assignedUnit: session.assignedUnit,
                deliveryCommit: pending.carrier.outcome.response.transaction.delivery_commit }) });
            try {
              recovered = retainDeliveryCheckoutRetryForSession({ workspace: trustedWorkspace, sessionEnv: env,
                responseEnv: responseConfiguration, original });
            } catch (error) {

              recovered = { result: null, carrier: original };
              retention = { state: "failed", stage: "original_retention", code: error.code ?? null,
                message: error.message, cause: captureDiagnosticEvidence(error) };
            }
          }
          const response = recovered.carrier.outcome.response;
          return prepareResponse({ workspace: trustedWorkspace,
            outcome: { ...response, ...(retention === null ? { original: { available: true, locator: recovered.result } }
              : { output: retention, original: { available: false, retention_failure: retention } }) },
            observation: { identity: recovered.carrier.identity, phases: recovered.carrier,
              transactionOutcome: response }, responseEnv: responseConfiguration,
            publicDelivery, historicalObservation: true, receiptRecovery: true, checkoutRecovery,
            receiptPublication: retention === null ? publish(recovered.result) : null });
        }
        recoveryStage = "completion_recovery";
        const observed = readManagedCompletion(completionBinding(session));
        if (!observed.ok) throw Object.assign(new Error(observed.refusal?.reason ?? observed.code),
          { code: observed.code ?? observed.refusal?.code, cause: observed.refusal });
        const release = pendingDeliveryCompletionReleaseForSession({ workspace: trustedWorkspace, sessionEnv: env,
          responseEnv: responseConfiguration, intent: observed.completion });
        if (release !== null) return retainedFailure(release);
      } catch (error) {
        return prepareResponse({ workspace: trustedWorkspace, authenticatedSubject: session.assignedUnit,
          error, isError: true, stage: recoveryStage, responseEnv: responseConfiguration, publicDelivery });
      }
    }
    return execution(session.assignedUnit).handler(parsed.data);
  }
  async function deliver(frame) {
    if (!workerAnswers.has(frame)) throw new TypeError("delivery frame belongs to a different serving composition");
    const answer = workerAnswers.get(frame);
    const source = frame.body.original?.locator;
    if (source == null || measureMcpInlineResultBytes(answer) <= activeMcpInlineByteLimit(responseConfiguration)) {
      const result = jsonContent(answer, { env: responseConfiguration });
      return frame.isError ? { ...result, isError: true } : result;
    }
    const result = await readDeliveryOriginalForSession({ workspace: trustedWorkspace, sessionEnv: env,
      responseEnv: responseConfiguration, request: { result: source },
      project: ({ binding, responseEnv: sourceEnv }) => readSelectedResponseProjection(source, {
        env: sourceEnv, expected: binding, project: () => answer }) });
    if (frame.isError) result.isError = true;
    return result;
  }
  return Object.freeze({ inputContract, prepare, deliver });
}
