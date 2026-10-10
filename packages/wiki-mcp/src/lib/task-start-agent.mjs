import { createAgentDispatchPipeline, resolveStartedAgentDispatchSelection } from "./dispatch-tools/agent-dispatch-route.mjs";
import { exactSliceTargetAuthoring } from "./dispatch-tools/agent-dispatch-refusal-projection.mjs";
import { resolveContractAssessmentContext } from "./task-assess-contract.mjs";
import { buildDispatchToolExceptionDetail, projectDispatchFailureDetail } from "./dispatch-tool-helpers.mjs";
import { previewStartAgent } from "./task-start-agent-preview.mjs";
import { startAgentAccepted, startAgentBaseCorrection, startAgentBaseSelection, startAgentRefusal,
  saveStartAgentDefaultBase } from "./task-start-agent-response.mjs";
import { selectInitialWkBaseBranch } from
  "@agent-chassis/agent-launch-cli/src/lib/worktree-substrate-exact-unit-identity.mjs";

export function createStartAgentTask({ workspace, sessionEnv = process.env, responseEnv = process.env,
  inputContract, dispatchContext, buildResultCall = null, requestContracts = null }) {
  const context = { ...dispatchContext, workspaceRepos: [workspace],
    resolveWorkspaceRepo: () => workspace, responseEnv, requestContracts };
  async function prepare(request) {
    const parsed = inputContract.inputSchema.safeParse(request);
    if (!parsed.success) throw inputContract.inputValidationError(request, parsed.error);
    const args = parsed.data;
    let stage = "authentication";
    try {
      const { context: session } = await resolveContractAssessmentContext({ workspace, sessionEnv });
      if (session.role !== "orchestrator") return startAgentRefusal({
        code: "start_agent_orchestrator_required", authority_limb: "mechanical_failure",
        reason: "the trusted session is not an orchestrator" }, { workspace, request: args, responseEnv });
      const backend = context.dispatchBackend;
      stage = "composition";
      if (typeof backend?.startLaunch !== "function" || typeof backend?.startAdvisoryReview !== "function" ||
          typeof backend?.getDispatchModelCapabilityFacts !== "function" ||
          typeof backend?.resolveWorkerTargetRefusal !== "function") return startAgentRefusal({
        code: "start_agent_composition_unavailable", reason: "prepared backend is required" },
        { workspace, request: args, responseEnv });
      if (args.preview === true) {
        stage = "preview";
        const preview = await previewStartAgent({ request: args, context, workspace });

        const calls = preview.next_calls ?? [];
        return preview.outcome === "preview" ? { ...preview, repository: workspace.repo,
          next_calls: calls, allowed_next_calls: calls } : startAgentRefusal(preview,
          { workspace, request: args, responseEnv, requestContracts });
      }
      stage = "selection";
      const selected = await resolveStartedAgentDispatchSelection({ args, ...context, jsonContent: value => value });
      if (selected.response) return startAgentRefusal(selected.response,
        { workspace, request: args, responseEnv, requestContracts });

      if (selected.args.role === "worker" && args.diff_base_sha !== undefined) return startAgentRefusal({
        code: "caller_supplied_committed_slice_authority", reason: "worker_review_pair_forbidden" },
        { workspace, request: selected.args, responseEnv });
      const targetRefusal = backend.resolveWorkerTargetRefusal(selected.args);
      if (targetRefusal !== null) return startAgentRefusal(await exactSliceTargetAuthoring(targetRefusal,
        { ...context, subject: selected.args.subject, dir: workspace.dir }),
      { workspace, request: selected.args, responseEnv, requestContracts });
      let correction = null;

      let defaulted = null, defaultAttempted = false;
      stage = "dispatch";
      const run = createAgentDispatchPipeline({ ...context, jsonContent: value => value,
        projectAcceptedLaunch: ({ launch }) => startAgentAccepted({ launch, workspace, buildResultCall, requestContracts, responseEnv }),
        buildMissingBaseGuidance: async ({ wkId, classification }) => {
          const proposal = defaultAttempted ? null : await selectInitialWkBaseBranch({
            mainRepo: classification.diagnostics.repository_path, baseBranch: undefined });
          defaultAttempted = true;
          const save = proposal === null ? null
            : await saveStartAgentDefaultBase({ wkId, branch: proposal.branch, workspace });
          if (save?.saved === true) {
            defaulted = startAgentBaseSelection({ wkId, ...proposal, saved: true });
            return { code: "managed_worktree_base_selection_defaulted", authority_limb: "mechanical_failure" };
          }

          const root = await startAgentBaseCorrection({ wkId, workspace, request: args });
          correction = root.correction;
          return { code: save === null ? "managed_worktree_base_selection_missing"
            : "managed_worktree_base_selection_save_failed", authority_limb: "mechanical_failure",
            original_failure: { code: classification.refusal_code, reason: classification.refusal_reason,
              detail: classification.diagnostics },
            ...(save === null ? {} : { base_selection_save: { branch: proposal.branch, ...save } }),
            next_calls: [root.call],
            recovery: { state: "choice_required", responsible_actor: "operator", root_unit: wkId } };
        } });
      let result = await run(selected.args);
      if (defaulted !== null) result = await run(selected.args);

      const named = value => defaulted === null ? value : { ...value, base_selection: defaulted };
      if (result.outcome === "started" && result.base_selection_reassessment?.original_failure !== undefined) {
        return named({ ...result, base_selection_reassessment: { ...result.base_selection_reassessment,
          original_failure: projectDispatchFailureDetail(result.base_selection_reassessment.original_failure,
            { env: responseEnv }) } });
      }
      return named(["started", "refused"].includes(result.outcome) ? result : await startAgentRefusal(result, {
        workspace, request: selected.args, responseEnv, correction, requestContracts }));
    } catch (error) {
      return startAgentRefusal({ code: error.code ?? "start_agent_preparation_failed", failed_stage: stage,
        detail: buildDispatchToolExceptionDetail("start_agent", error, { env: responseEnv }) },
      { workspace, request: args, responseEnv });
    }
  }
  return Object.freeze({ prepare, inputContract });
}
