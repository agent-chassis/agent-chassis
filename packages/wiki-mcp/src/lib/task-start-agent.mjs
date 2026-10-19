import { loadIntegratedSliceDispatchRefusal } from "@agent-chassis/wiki-core/src/operations/validate-dispatch.mjs";
import { createAgentDispatchPipeline, resolveStartedAgentDispatchSelection } from "./dispatch-tools/agent-dispatch-route.mjs";
import { exactSliceTargetAuthoring, projectWorkerInputRefusal } from "./dispatch-tools/agent-dispatch-refusal-projection.mjs";
import { resolveContractAssessmentContext } from "./task-assess-contract.mjs";
import { buildDispatchToolExceptionDetail, projectDispatchFailureDetail, requestSchemaAuthorityForRegistration } from "./dispatch-tool-helpers.mjs";
import { presentStartAgent } from "./task-start-agent-presentation.mjs";
import { previewStartAgent } from "./task-start-agent-preview.mjs";
import { startAgentAccepted, startAgentBaseCorrection, startAgentBaseSelection, startAgentRefusal,
  saveStartAgentDefaultBase, startAgentProblemObservation } from "./task-start-agent-response.mjs";
import { selectInitialWkBaseBranch } from
  "@agent-chassis/agent-launch-cli/src/lib/worktree-substrate-exact-unit-identity.mjs";

export function createStartAgentTask({ workspace, sessionEnv = process.env, responseEnv = process.env,
  inputContract, dispatchContext, buildResultCall = null, requestContracts = null }) {
  const context = { ...dispatchContext, workspaceRepos: [workspace],
    resolveWorkspaceRepo: () => workspace, sessionEnv, responseEnv, requestContracts };
  async function prepareRaw(request) {
    const parsed = inputContract.inputSchema.safeParse(request);
    if (!parsed.success) throw inputContract.inputValidationError(request, parsed.error);
    const args = parsed.data;
    let stage = "authentication", observedLaunch = null, defaulted = null;
    const refuse = (value, options) => startAgentRefusal(value, { ...options, beforeLaunch: stage !== "dispatch" });
    const observeProblem = (value, request) => startAgentProblemObservation(value, {
      launch: observedLaunch, request, buildResultCall, requestContracts, responseEnv });
    try {
      const { context: session } = await resolveContractAssessmentContext({ workspace, sessionEnv });
      if (session.role !== "orchestrator") return refuse({
        code: "start_agent_orchestrator_required", authority_limb: "mechanical_failure",
        reason: "the trusted session is not an orchestrator" }, { workspace, request: args, responseEnv });
      const backend = context.dispatchBackend;
      stage = "composition";
      if (typeof backend?.startLaunch !== "function" || typeof backend?.startAdvisoryReview !== "function" ||
          typeof backend?.getDispatchModelCapabilityFacts !== "function" ||
          typeof backend?.resolveWorkerTargetRefusal !== "function") return refuse({
        code: "start_agent_composition_unavailable", reason: "prepared backend is required" },
        { workspace, request: args, responseEnv });
      if (args.preview === true) {
        stage = "preview";
        const preview = await previewStartAgent({ request: args, context, workspace });

        const calls = preview.next_calls ?? [];
        return preview.outcome === "preview" ? { ...preview, repository: workspace.repo,
          next_calls: calls } : refuse(preview,
          { workspace, request: args, responseEnv, requestContracts });
      }
      stage = "selection";
      const selected = await resolveStartedAgentDispatchSelection({ args, ...context, jsonContent: value => value });
      if (selected.response) return refuse(selected.response,
        { workspace, request: args, responseEnv, requestContracts });

      if (selected.args.role === "worker" && args.diff_base_sha !== undefined) return refuse({
        code: "caller_supplied_committed_slice_authority", reason: "worker_review_pair_forbidden" },
        { workspace, request: selected.args, responseEnv });
      if (selected.args.role === "worker") {
        const completed = await loadIntegratedSliceDispatchRefusal({ dir: workspace.dir, unitAddress: selected.args.subject });
        if (completed !== null) return refuse(completed,
          { workspace, request: selected.args, responseEnv, requestContracts });
      }
      const targetRefusal = backend.resolveWorkerTargetRefusal(selected.args);
      if (targetRefusal !== null) return refuse(await exactSliceTargetAuthoring(targetRefusal,
        { ...context, subject: selected.args.subject, dir: workspace.dir }),
      { workspace, request: selected.args, responseEnv, requestContracts });
      if (selected.args.role === "worker") {
        if (typeof backend.preflightWorkerInputs !== "function") return refuse({
          code: "start_agent_composition_unavailable", reason: "worker input preflight is required"
        }, { workspace, request: selected.args, responseEnv, requestContracts });
        stage = "worker_inputs";
        const checked = await backend.preflightWorkerInputs({ ...selected.args,
          workspace_alias: workspace.repo, workspace_dir: workspace.dir });
        if (!checked.ok) return refuse(projectWorkerInputRefusal(checked, {
          ...selected.args, env: responseEnv,
          requestSchemaAuthority: requestSchemaAuthorityForRegistration(context.registerTool) }),
          { workspace, request: selected.args, responseEnv, requestContracts });
      }
      let correction = null;

      let defaultAttempted = false;
      stage = "dispatch";
      const run = createAgentDispatchPipeline({ ...context, jsonContent: value => value,

        dispatchBackend: { ...backend,
          startLaunch: async input => {
            const launch = await backend.startLaunch(input);
            if (launch?.accepted === true) observedLaunch = launch;
            return launch;
          },
          startAdvisoryReview: async input => {
            const launch = await backend.startAdvisoryReview(input);
            if (launch?.accepted === true) observedLaunch = launch;
            return launch;
          } },
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
      const refusal = ["started", "refused"].includes(result.outcome) ? result : await refuse(result, {
        workspace, request: selected.args, responseEnv, correction, requestContracts });
      const observationNeeded = (observedLaunch !== null && result.outcome === undefined) ||
        result.blocker?.reason === "dispatch_tool_exception";
      return named(refusal.outcome !== "started" && observationNeeded
        ? await observeProblem(refusal, selected.args) : refusal);
    } catch (error) {

      const captured = buildDispatchToolExceptionDetail("start_agent", error, { env: responseEnv });
      const refusal = await refuse({ code: error.code ?? "start_agent_preparation_failed", failed_stage: stage,
        reason: error.detail?.reason,
        detail: error.detail === undefined ? captured : projectDispatchFailureDetail(error.detail, { env: responseEnv }) },
      { workspace, request: args, responseEnv });
      const observed = stage === "dispatch" ? await observeProblem(refusal, args) : refusal;
      return defaulted === null ? observed : { ...observed, base_selection: defaulted };
    }
  }
  async function prepare(request) {
    return presentStartAgent(await prepareRaw(request), { request, requestContracts });
  }
  return Object.freeze({ prepare, inputContract });
}
