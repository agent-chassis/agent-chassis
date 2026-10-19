
import path from "node:path";
import { realpathSync } from "node:fs";
import { z as defaultZ } from "zod";
import { resolveUniqueManagedLifecycleBindingPairForRecovery } from "@agent-chassis/agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { synchronizeIntegratedWkWorktree } from "@agent-chassis/agent-launch-cli/src/lib/integrated-wk-worktree.mjs";
import { releaseRetainedSlice } from "@agent-chassis/agent-launch-cli/src/lib/worktree-reaper.mjs";
import { digestTrustedExactReviewEvidence } from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-validation.mjs";
import { resolveCommittedSliceIntegrationOriginal } from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import { captureDiagnosticEvidence } from "@agent-chassis/agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { readSavedReviewDispositions } from "@agent-chassis/wiki-core/src/operations/work-record-dispositions.mjs";
import { createIntegrateWorkInputContract, INTEGRATE_WORK_TOOL_NAME } from "./task-integrate-work-schema.mjs";
import { createIntegrationOriginals, INTEGRATION_ORIGINAL_PRODUCER, prepareIntegrateWorkResponse } from "./task-integrate-work-result.mjs";
import { readDeliveryOriginalForSession } from "./task-deliver-work-result.mjs";
import { withDeliveryFinalization } from "./dispatch-integration-finalization.mjs";
import { LauncherSessionContractRefusal, resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";
import { createObservationOriginals } from "./task-get-run-result-delivery.mjs";
import { classifyAgentDispatchSubject } from "./dispatch-tool-helpers.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { readSelectedResponseProjection } from "./selected-response-snapshot.mjs";
import { activeMcpInlineByteLimit, measureMcpInlineResultBytes, jsonContent } from "./mcp-response.mjs";

export function integrateWorkBackendOptions({ workspace, sessionEnv = process.env, responseEnv = sessionEnv,
  backendOptions: { synchronizeIntegratedWkWorktree: synchronizeWkWorktree = synchronizeIntegratedWkWorktree,
    releaseRetainedSlice: releaseSlice = releaseRetainedSlice, prepareTerminalCandidate = null, ...backendOptions } }) {
  const env = Object.freeze({ ...sessionEnv });
  const responseConfiguration = Object.freeze({ ...responseEnv });
  const trustedWorkspace = Object.freeze({ ...workspace, dir: path.resolve(workspace.dir) });
  const canonicalMainRepo = realpathSync(backendOptions.worktreeProvisioning.mainRepo);
  if (realpathSync(trustedWorkspace.dir) !== canonicalMainRepo) {
    throw new TypeError("integration backend must bind the single configured workspace");
  }
  const originals = createIntegrationOriginals({ workspace: trustedWorkspace, sessionEnv: env, responseEnv: responseConfiguration });
  return { ...backendOptions,
    readIntegrationDispositions: readSavedReviewDispositions,
    retainCommittedSliceIntegrationOriginal: input => {

      if (realpathSync(trustedWorkspace.dir) !== canonicalMainRepo) {
        throw new Error("the configured workspace repository is not the integration runtime's main repository");
      }
      return originals.retain(input);
    },
    finalizeCommittedSliceIntegration: async (integration, { approvedDelivery, retireManagedWorkerIdentity }) => {

      let pair;
      try {
        pair = resolveUniqueManagedLifecycleBindingPairForRecovery({ mainRepo: trustedWorkspace.dir,
          launchRef: approvedDelivery.launch_ref, expectedSubject: approvedDelivery.subject, allowMissingSliceWorktree: true });
      } catch (error) {
        return { ...integration, cleanup_pending: true, cleanup: { state: "pending",
          managed_identity_retirement: { state: "pending", retired: false, code: error.code ?? "delivery_worker_tuple_unavailable",
            evidence: captureDiagnosticEvidence(error) },
          wk_checkout: { state: "pending", code: error.code ?? "delivery_worker_tuple_unavailable" },
          slice_checkout: { state: "pending", reaped: false, code: error.code ?? "delivery_worker_tuple_unavailable" } } };
      }
      if (pair?.slice_binding?.run_id !== approvedDelivery.run_id ||
          pair?.slice_binding?.retry_id !== approvedDelivery.retry_id ||
          pair?.slice_binding?.base_sha !== approvedDelivery.base) {
        return { ...integration, cleanup_pending: true, cleanup: { state: "pending",
          managed_identity_retirement: { state: "pending", retired: false, code: "delivery_worker_tuple_unavailable" },
          wk_checkout: { state: "pending", code: "delivery_worker_tuple_unavailable" },
          slice_checkout: { state: "pending", reaped: false, code: "delivery_worker_tuple_unavailable" } } };
      }
      const finalIntegration = integration.review_target != null ||
        integration.recovered === true && integration.integrated_state === 'final';
      if (finalIntegration && prepareTerminalCandidate !== null) {

        await prepareTerminalCandidate({ integration, initiative: pair.wk_binding.initiative,
          wkId: approvedDelivery.subject.split('#')[0], wkRef: integration.wk_ref,
          baseSha: pair.wk_binding.base_sha, baseRef: pair.wk_binding.base_ref,
          preserveSelectedCandidate: true });
      }
      const finalized = await withDeliveryFinalization({ integration }, {
        status: { subject: approvedDelivery.subject, monitor_handle: approvedDelivery.launch_ref, run_id: pair.run_id },
        bindings: { wk: pair.wk_binding, slice: pair.slice_binding },
        deps: { retireManagedWorkerIdentity: backendOptions.requireManagedProvisioning === true ? retireManagedWorkerIdentity : null,

          synchronizeIntegratedWkWorktree: () => synchronizeWkWorktree({ mainRepo: trustedWorkspace.dir,
            wkBinding: pair.wk_binding, integratedSha: integration.slice_sha }),

          reapIntegratedSliceCheckout: async () => {
            if (integration.delivery_sha !== approvedDelivery.commit) {
              throw Object.assign(new Error("the integration result does not state the approved delivery commit"),
                { code: "slice_checkout_reap_delivery_unconfirmed" });
            }
            return releaseSlice({ mainRepo: trustedWorkspace.dir, launchRef: pair.slice_binding.launch_ref,
              runId: pair.slice_binding.run_id, retryId: pair.slice_binding.retry_id,
              disposition: "successful-integration", workerTerminated: true, integrationSucceeded: true,
              integratedSha: approvedDelivery.commit,
              worktreeIdentityDigest: digestTrustedExactReviewEvidence(pair.slice_binding) });
          } } });
      const { integration: _integration, ...finalization } = finalized;
      return { ...integration, ...finalization };
    } };
}

export function createIntegrateWorkTask({ workspace, sessionEnv = process.env, responseEnv = sessionEnv,
  z = defaultZ, preparedDispatchBackend, requestContracts }) {
  const env = Object.freeze({ ...sessionEnv });
  const responseConfiguration = Object.freeze({ ...responseEnv });
  const trustedWorkspace = Object.freeze({ ...workspace, dir: path.resolve(workspace.dir) });
  const inputContract = createIntegrateWorkInputContract(z);
  const originals = createIntegrationOriginals({ workspace: trustedWorkspace, sessionEnv: env, responseEnv: responseConfiguration });
  const backend = preparedDispatchBackend;
  function authenticate() {
    const role = parseToolProfile(env);
    const session = resolveLauncherRunState(env);
    if (session.role === "operator") throw new LauncherSessionContractRefusal(
      "session_not_entitled_to_integration", "Integration requires an authenticated orchestrator session; operator sessions cannot integrate.");
    if (session.role !== role || !shouldExposeTool(role, INTEGRATE_WORK_TOOL_NAME)) {
      throw selectedResponseQueryInvalidError(INTEGRATE_WORK_TOOL_NAME, "session_not_entitled_to_integration", { role });
    }
    return session;
  }
  async function prepare(request) {
    try { authenticate(); }
    catch (error) {
      if (!(error instanceof LauncherSessionContractRefusal)) throw error;

      const frame = await prepareIntegrateWorkResponse({ request, responseEnv: responseConfiguration,
        receivingRole: parseToolProfile(env), requestContracts,
        original: { captured: false, evidence: { code: error.code } },
        result: { integrated: false, code: error.code, reason: error.message,
          recovery: { state: "no_supported_route", message: "Integration requires a launcher-authenticated session. " +
            "An authenticated orchestrator session is required. No in-session call creates or replaces that session; stop this integration request. " +
            "No delivery read, integration, record or checkout change, or result retention was attempted." } } });
      return { ...frame, isError: true };
    }
    let result;
    let original;
    let selection = null;
    let integrationRequested = false;
    try {
      const parsed = inputContract.inputSchema.safeParse(request);
      if (!parsed.success) throw selectedResponseQueryInvalidError(INTEGRATE_WORK_TOOL_NAME,
        "approve_exactly_one_delivery_original", { rejected_arguments: parsed.error.issues.map(issue => issue.path.join(".")) });
      if (typeof backend?.requestCommittedSliceIntegration !== "function") {
        throw selectedResponseQueryInvalidError(INTEGRATE_WORK_TOOL_NAME, "prepared_integration_backend_unavailable");
      }
      const delivery = readDeliveryOriginalForSession({ workspace: trustedWorkspace, sessionEnv: env,
        responseEnv: responseConfiguration, request: { result: parsed.data.delivery } });
      const identity = delivery.identity;
      const transaction = delivery.outcome?.response?.transaction;
      const commit = transaction?.delivery_commit;
      const binding = identity?.binding;
      if (typeof commit !== "string" || typeof binding?.base_sha !== "string" ||
          identity.repository !== trustedWorkspace.repo || identity.unit !== binding.selected_unit?.address ||
          binding.launch_ref !== identity.launch_ref || binding.run_id !== identity.run_id || binding.retry_id !== identity.retry_id) {
        throw selectedResponseQueryInvalidError(INTEGRATE_WORK_TOOL_NAME, "delivery_original_has_no_selected_delivery");
      }
      selection = { subject: identity.unit };
      integrationRequested = true;
      result = await backend.requestCommittedSliceIntegration({ subject: identity.unit,
        approved_request: parsed.data, approvedDelivery: { subject: identity.unit, commit, base: binding.base_sha,
          slice_ref: binding.output_branch, launch_ref: binding.launch_ref, run_id: binding.run_id, retry_id: binding.retry_id } });
      original = resolveCommittedSliceIntegrationOriginal(result);
      if (result.code === "agent_launch.slice_integration.approved_delivery_mismatch.v1") {
        try {

          const pair = resolveUniqueManagedLifecycleBindingPairForRecovery({ mainRepo: trustedWorkspace.dir,
            launchRef: binding.launch_ref, expectedSubject: identity.unit, allowMissingSliceWorktree: true });
          if (pair?.slice_binding?.run_id !== identity.run_id || pair?.slice_binding?.retry_id !== identity.retry_id ||
              typeof pair?.run_id !== "string" || pair.run_id.length === 0) {
            throw selectedResponseQueryInvalidError(INTEGRATE_WORK_TOOL_NAME, "delivery_observation_attempt_mismatch");
          }
          selection = { subject: identity.unit, attempt_id: pair.run_id };
        } catch (error) {

          selection = { subject: identity.unit, observation_unavailable: {
            code: error.code ?? null, message: error.message } };
        }
      }
    } catch (error) {

      const completed = error?.detail?.completed_integration_result ?? error?.detail?.completed_recovery_result;
      result = { ...(completed ?? { integrated: false,
        ...(integrationRequested ? { integration_effects_unconfirmed: true } : {}) }),
        code: error?.code ?? null,
        reason: error?.envelope?.observed_facts?.["selected_response.invalid_reason"] ?? error?.message,
        ...(completed == null ? { cause: captureDiagnosticEvidence(error) }
          : { recovery_failure: captureDiagnosticEvidence(error) }) };

      if (error?.envelope?.observed_facts?.["selected_response.invalid_reason"] === "source_binding_mismatch" &&
          inputContract.inputSchema.safeParse(request).success) {
        try {
          const { carrier, binding } = createObservationOriginals({ workspace: trustedWorkspace,
            sessionEnv: env, responseEnv: responseConfiguration }).read(request.delivery);
          if (binding.unit !== carrier.subject || classifyAgentDispatchSubject(carrier.subject) === null ||
              typeof carrier.run_id !== "string" || carrier.run_id.length === 0) {
            throw selectedResponseQueryInvalidError(INTEGRATE_WORK_TOOL_NAME, "observation_original_attempt_mismatch");
          }
          result.correction = { reason: "run_result_is_not_delivery",
            message: "delivery names a saved run result, not an authenticated delivery. Read this exact attempt's delivery facts; " +
              "only an authenticated delivery locator can be submitted for integration.",
            call: buildNextCall({ tool: "get_run_result", recommended: true,
              arguments: { subject: carrier.subject, attempt_id: carrier.run_id } }) };
        } catch (correctionError) {

          result.correction_unavailable = captureDiagnosticEvidence(correctionError);
        }
      }
      original = { captured: true, retained: originals.retain({ subject: selection?.subject ?? null,
        original: { request, result } }) };
    }
    return prepareIntegrateWorkResponse({ result, original, request, responseEnv: responseConfiguration,
      receivingRole: parseToolProfile(env), requestContracts, selection });
  }
  async function deliver(frame) {
    const source = frame.source;
    if (source == null || measureMcpInlineResultBytes(frame.body) <= activeMcpInlineByteLimit(responseConfiguration)) {
      const result = jsonContent(frame.body, { env: responseConfiguration });
      return frame.isError ? { ...result, isError: true } : result;
    }
    const result = await originals.read({ result: source }, { project: ({ binding }) =>
      readSelectedResponseProjection(source, { env: responseConfiguration, expected: binding, project: () => frame.body }) });
    if (frame.isError) result.isError = true;
    return result;
  }
  return Object.freeze({ inputContract, prepare, backend, deliver });
}
