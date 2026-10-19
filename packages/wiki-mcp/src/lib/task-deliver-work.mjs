

import { z as defaultZ } from "zod";
import { setWorkRecordStatusByUnit } from "../../../wiki-core/src/operations/work-records.mjs";
import { createWorkspaceCommitExecution } from "./workspace-commit-tool.mjs";
import { prepareDeliverWorkResponse } from "./task-deliver-work-response.mjs";
import { prepareWorkerDeliveryAnswer } from "./task-deliver-work-worker-answer.mjs";
import { DELIVERY_ORIGINAL_PRODUCER, publishDeliveryReceiptForSession, pendingDeliveryReceiptForSession,
  composeDeliveryCheckoutRetryOriginal, retainDeliveryCheckoutRetryForSession, readDeliveryOriginalForSession } from "./task-deliver-work-result.mjs";
import { activeMcpInlineByteLimit, measureMcpInlineResultBytes, jsonContent } from "./mcp-response.mjs";
import { readSelectedResponseProjection } from "./selected-response-snapshot.mjs";
import { finalizeDeliveryCheckout } from "./delivery-checkout-finalization.mjs";
import { createToolInputValidationError } from "./register-tool.mjs";
import { resolveLauncherRunState, LauncherSessionContractRefusal } from "./launcher-run-credential.mjs";
import { parseToolProfile } from "./tool-profile.mjs";
import { LAUNCHER_AGENT_SESSION_CONTRACT_REFUSAL_CODES } from
  "../../../agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import { captureDiagnosticEvidence } from "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";

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
      scopeRefusal: settled?.scope?.refusal ?? null
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
  const { inputContract } = execution();
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

    if (session.credential === null) return execution().handler(parsed.data);
    if (publicDelivery) {
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
      } catch (error) {
        return prepareResponse({ workspace: trustedWorkspace, authenticatedSubject: session.assignedUnit,
          error, isError: true, stage: "receipt_recovery", responseEnv: responseConfiguration, publicDelivery });
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
