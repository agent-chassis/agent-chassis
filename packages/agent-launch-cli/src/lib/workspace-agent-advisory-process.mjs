import { captureLauncherAgentSessionContract } from "./stdio-mcp-conduit-authority.mjs";
import { resolveLaunchSelection } from "./workspace-agent-dispatch-run-lifecycle-selection.mjs";
import { finalizeAdvisoryProcessLaunch } from "./workspace-agent-advisory-result-settlement.mjs";

export function createAdvisoryProcessRunner({
  executors,
  executorRegistryEntries,
  familyAwareWiring,
  runs,
  clock,
  runIdFactory,
  monitorHandleFactory,
  settleFormalReviewAttestation = null
}) {
  return async function startAdvisoryProcess(input = {}) {
    const reviewInput = input.advisory_review_input;
    const selection = resolveLaunchSelection({
      role: input.role,
      subject: input.subject,
      caller_session_id: input.caller_session_id,
      app: input.app,
      model: input.model,
      workspace_dir: reviewInput?.private_checkout_root,
      config_root_dir: reviewInput?.repository,
      executors,
      executorRegistryEntries,
      familyAwareWiring
    });
    if (!selection.ok) return selection.refusal;

    const run_id = runIdFactory();
    const monitor_handle = monitorHandleFactory();
    const startedAt = new Date(clock()).toISOString();
    let executorResult;
    let sessionContract = null;
    try {
      const captured = await captureLauncherAgentSessionContract(() =>
        selection.familyExecutor({
          caller_session_id: input.caller_session_id,
          role: input.role,
          subject: input.subject,
          workspace_alias: input.workspace_alias ?? null,
          workspace_dir: reviewInput.private_checkout_root,
          config_root_dir: reviewInput.repository,
          run_id,
          monitor_handle,
          app: selection.app,
          model: selection.resolvedModel,
          backend: selection.resolvedBackend,
          backend_profile: selection.resolvedBackendProfile,
          default_effort: selection.resolvedDefaultEffort,
          routeKind: selection.routeKind,
          applicable: selection.applicable,
          advisory_review_input: reviewInput
        })
      );
      executorResult = captured.result;
      sessionContract = captured.sessionContract;
    } catch (error) {
      executorResult = Object.freeze({
        accepted: true,
        status: "failed",
        exit: Object.freeze({ code: null, signal: null, error_code: "advisory_process_failed" }),
        final_result: Object.freeze({
          kind: "missing_result",
          missing_result: Object.freeze({
            code: "advisory_process_failed",
            reason: error?.code ?? "advisory_process_failed",
            detail: null
          })
        })
      });
    }

    return finalizeAdvisoryProcessLaunch({
      executorResult,
      runs,
      settleFormalReviewAttestation,
      run_id,
      monitor_handle,
      app: selection.app,
      resolvedModel: selection.resolvedModel,
      resolvedBackend: selection.resolvedBackend,
      role: input.role,
      subject: input.subject,
      workspace_alias: input.workspace_alias,
      caller_session_id: input.caller_session_id,
      startedAt,
      advisoryReviewInput: reviewInput,
      sessionContract,
      cleanup: input.cleanup ?? null
    });
  };
}
