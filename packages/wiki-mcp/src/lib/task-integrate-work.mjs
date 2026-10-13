
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
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { parseToolProfile, shouldExposeTool } from "./tool-profile.mjs";
import { selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";

export function integrateWorkBackendOptions({ workspace, sessionEnv = process.env, responseEnv = sessionEnv,
  backendOptions: { synchronizeIntegratedWkWorktree: synchronizeWkWorktree = synchronizeIntegratedWkWorktree,
    releaseRetainedSlice: releaseSlice = releaseRetainedSlice, ...backendOptions } }) {
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
  z = defaultZ, preparedDispatchBackend }) {
  const env = Object.freeze({ ...sessionEnv });
  const responseConfiguration = Object.freeze({ ...responseEnv });
  const trustedWorkspace = Object.freeze({ ...workspace, dir: path.resolve(workspace.dir) });
  const inputContract = createIntegrateWorkInputContract(z);
  const originals = createIntegrationOriginals({ workspace: trustedWorkspace, sessionEnv: env, responseEnv: responseConfiguration });
  const backend = preparedDispatchBackend;
  function authenticate() {
    const role = parseToolProfile(env);
    const session = resolveLauncherRunState(env);
    if (session.role !== role || !shouldExposeTool(role, INTEGRATE_WORK_TOOL_NAME)) {
      throw selectedResponseQueryInvalidError(INTEGRATE_WORK_TOOL_NAME, "session_not_entitled_to_integration", { role });
    }
    return session;
  }
  async function prepare(request) {
    authenticate();
    let result;
    let original;
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
      result = await backend.requestCommittedSliceIntegration({ subject: identity.unit,
        approved_request: parsed.data, approvedDelivery: { subject: identity.unit, commit, base: binding.base_sha,
          slice_ref: binding.output_branch, launch_ref: binding.launch_ref, run_id: binding.run_id, retry_id: binding.retry_id } });
      original = resolveCommittedSliceIntegrationOriginal(result);
    } catch (error) {
      result = { integrated: false, code: error.code ?? null, reason: error.message,
        cause: captureDiagnosticEvidence(error) };
      original = { captured: true, retained: originals.retain({ subject: null, original: { request, result } }) };
    }
    return prepareIntegrateWorkResponse({ result, original, request, responseEnv: responseConfiguration });
  }
  return Object.freeze({ inputContract, prepare, backend });
}
