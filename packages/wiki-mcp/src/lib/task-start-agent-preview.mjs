import { loadIntegratedSliceDispatchRefusal } from "@agent-chassis/wiki-core/src/operations/validate-dispatch.mjs";
import { resolveStartedAgentDispatchSelection } from "./dispatch-tools/agent-dispatch-route.mjs";
import { admitAgentDispatchRequest } from "./dispatch-tools/agent-dispatch-request-admission.mjs";
import { projectManagedLifecycleCapabilities } from "./dispatch-diagnostic-routes.mjs";
import { boundedRecoveryDetail, exactSliceTargetAuthoring, missingInitiativeAuthoring, missingInitiativeRead } from
  "./dispatch-tools/agent-dispatch-refusal-projection.mjs";
import { MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch.mjs";
import { preflightWorkerScope } from "@agent-chassis/agent-launch-cli/src/lib/worker-scope-preflight.mjs";
import { WORKER_SCOPE_BASE_SELECTION_MISSING_DECISION_CODE } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch-readiness-shape.mjs";
import { servedGuidanceRead, startAgentBaseCorrection, startAgentBaseSelection } from "./task-start-agent-response.mjs";
import { WK_BASE_SELECTION } from
  "@agent-chassis/agent-launch-cli/src/lib/worktree-substrate-exact-unit-identity.mjs";
import { servedControlledAcceptanceRecovery, servedControlledAcceptanceFailure, projectControlledFailureFacts } from "./task-start-agent-guidance.mjs";
export { servedUnitAssessment } from "./task-start-agent-guidance.mjs";

export async function previewStartAgent({ request, context, workspace }) {
  const backend = context.dispatchBackend;
  const authorityFacts = await backend.getManagedLifecycleCapabilityAuthorityFacts();
  const lifecycle = await projectManagedLifecycleCapabilities({
    registeredToolNames: context.registeredToolNames, authorityFacts,
    requestContracts: context.requestContracts,
    isPaidTier: context.isPaidTier === true });
  if (request.subject === undefined) {
    const facts = backend.getDispatchModelCapabilityFacts({ ...request, workspace_dir: workspace.dir });
    if (facts.refusal) return { accepted: false, refusal: facts.refusal };
    return { outcome: "preview", preview_kind: "capability", role: request.role,
      capabilities: lifecycle, effects: { child_started: false } };
  }
  const selected = await resolveStartedAgentDispatchSelection({ args: request, ...context, jsonContent: value => value });
  if (selected.response) return selected.response;
  const args = selected.args;
  if (args.role === "worker" && args.diff_base_sha !== undefined) return { accepted: false,
    refusal: { code: "caller_supplied_committed_slice_authority", reason: "worker_review_pair_forbidden" } };
  if (args.role === "worker") {
    const completed = await loadIntegratedSliceDispatchRefusal({ dir: workspace.dir, unitAddress: args.subject });
    if (completed !== null) return completed;
  }
  const targetRefusal = backend.resolveWorkerTargetRefusal(args);
  if (targetRefusal !== null) return exactSliceTargetAuthoring(targetRefusal,
    { ...context, subject: args.subject, dir: workspace.dir });
  const admission = admitAgentDispatchRequest({ ...context, args, jsonContent: value => value });
  if (admission.response) return admission.response;
  const plan = backend.planLaunch({ ...args, workspace_dir: workspace.dir });
  if (plan.accepted !== true) return { accepted: false, refusal: plan.refusal };
  let assessment, scope = null, baseSelection = null, controlledRecovery = null, controlledFailure = null,
    initiative = null, authoredRecovery = null;
  if (args.role === "reviewer" || args.role === "redteam") {
    await backend.resolveAdvisoryReviewMaterial({ ...args, workspace_alias: workspace.repo });
    assessment = { material_selected: true, execution_admitted: "unchecked" };
  } else {

    const readiness = await context.validateDispatch({ dir: workspace.dir, unitAddress: args.subject,
      dispatch_role: "implementation", mode: "strict", suppress_live_graph_resolution: true,
      worker_scope_preflight: preflightWorkerScope });
    scope = readiness.worker_scope_preflight ?? null;
    if (readiness.dispatchable === false &&
        readiness.decision_code === WORKER_SCOPE_BASE_SELECTION_MISSING_DECISION_CODE) {
      const root = await startAgentBaseCorrection({ wkId: args.subject.split("#", 1)[0], workspace, request });
      baseSelection = { correction: root.correction, ...await servedGuidanceRead(root.call, context.requestContracts) };
    }

    if (readiness.dispatchable === false && readiness.decision_code === MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE) {
      const authoring = missingInitiativeAuthoring(readiness);
      initiative = { authoring, ...await servedGuidanceRead({ kind: "guidance", ...missingInitiativeRead(authoring) },
        context.requestContracts) };
    }

    if (readiness.dispatchable === false && readiness.controlled_acceptance_failure !== undefined) {
      controlledRecovery = await servedControlledAcceptanceRecovery(readiness.controlled_acceptance_failure, context.requestContracts);
    }
    if (readiness.dispatchable === false && baseSelection === null && initiative === null && controlledRecovery === null) {
      authoredRecovery = await servedGuidanceRead({ kind: "guidance", tool: "workspace_read_wiki",
        arguments: { subject: args.subject },
        information: "Read this assignment's current correction context and revision. Reading changes no readiness." }, context.requestContracts);
    }
    controlledFailure = readiness.controlled_acceptance_failure === undefined ? null
      : servedControlledAcceptanceFailure(readiness.controlled_acceptance_failure, controlledRecovery);
    const displayedReadiness = controlledFailure === null ? readiness : projectControlledFailureFacts(readiness, controlledFailure);
    assessment = { readiness: boundedRecoveryDetail(displayedReadiness, { dispatchable: readiness.dispatchable,
      ...(readiness.dispatchable === false ? { reasons: readiness.reasons } : {}),
      ...(readiness.structural_readiness === undefined ? {} : { structural_readiness: readiness.structural_readiness }),
      ...(scope === null ? {} : { worker_scope_preflight: scope }),
      ...(initiative === null ? {} : { initiative_authoring: initiative.authoring }) }),
      execution_admitted: "unchecked" };
  }
  const readinessOwners = [baseSelection, initiative, controlledRecovery, authoredRecovery].filter(owner => owner !== null);
  const nextCalls = readinessOwners.flatMap(owner => owner.call ? [owner.call] : []);
  return { outcome: "preview", preview_kind: "action", subject: args.subject, role: args.role,
    ...(controlledFailure === null ? {} : { controlled_acceptance_failure: controlledFailure }), assessment,
    next_calls: nextCalls,

    ...(scope?.base?.selection === undefined ? {} : { base_selection: startAgentBaseSelection({
      wkId: args.subject.split("#", 1)[0], branch: scope.base.ref, selection: scope.base.selection,
      saved: scope.base.selection === WK_BASE_SELECTION.SAVED }) }),
    ...(baseSelection === null ? {} : { correction: baseSelection.correction,
      ...(baseSelection.limitation ? { readiness_guidance_limitation: baseSelection.limitation } : {}) }),
    ...(initiative?.limitation ? { readiness_guidance_limitation: initiative.limitation } : {}),
    ...(authoredRecovery?.limitation ? { readiness_guidance_limitation: authoredRecovery.limitation } : {}),
    ...(controlledRecovery?.limitation ? { contract_assessment_limitation: controlledRecovery.limitation } : {}),
    effects: { cache: "not_consumed",
      child_started: false, canonical_written: false, runtime_prepared: false, integration_requested: false },
    capabilities: lifecycle };
}
