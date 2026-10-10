import { resolveStartedAgentDispatchSelection } from "./dispatch-tools/agent-dispatch-route.mjs";
import { admitAgentDispatchRequest } from "./dispatch-tools/agent-dispatch-request-admission.mjs";
import { projectManagedLifecycleCapabilities } from "./dispatch-diagnostic-routes.mjs";
import { boundedRecoveryDetail, exactSliceTargetAuthoring, missingInitiativeAuthoring, missingInitiativeRead } from
  "./dispatch-tools/agent-dispatch-refusal-projection.mjs";
import { MISSING_INITIATIVE_REF_NAMESPACE_DECISION_CODE } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch.mjs";
import { readRecordAuthoringRevision } from "@agent-chassis/wiki-core/src/operations/save-record.mjs";
import { graphDerivationRequiredForDispatch } from "./dispatch-tools/dispatch-admission-policy.mjs";
import { preflightWorkerScope } from "@agent-chassis/agent-launch-cli/src/lib/worker-scope-preflight.mjs";
import { WORKER_SCOPE_BASE_SELECTION_MISSING_DECISION_CODE } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch-readiness-shape.mjs";
import { servedGuidanceRead, startAgentBaseCorrection, startAgentBaseSelection } from "./task-start-agent-response.mjs";
import { WK_BASE_SELECTION } from
  "@agent-chassis/agent-launch-cli/src/lib/worktree-substrate-exact-unit-identity.mjs";
import { contractAssessmentCall } from "./task-assess-contract-surface.mjs";

const CONTROLLED_ACCEPTANCE_INCOMPLETE = "controlled_acceptance_incomplete";

export async function servedSliceAssessment(unit, requestContracts) {
  const call = { kind: "guidance", recommended: true, ...contractAssessmentCall({ unit }),
    information: "Assess this exact slice to read which of its acceptance criteria no obligation covers and the " +
      "authored correction; assessing executes no proof, grants no credit and changes no readiness." };
  const limit = (code, cause) => ({ limitation: { code, tool: call.tool, ...(cause === undefined ? {} : { cause }) } });
  try {
    const contract = requestContracts?.contractFor?.(call.tool);
    if (!contract) return limit("contract_assessment_consumer_unavailable");
    return await contract.acceptsArguments(call.arguments) === true ? { call }
      : limit("contract_assessment_full_contract_rejected");
  } catch (error) {
    return limit("contract_assessment_validation_failed", { code: error.code ?? null, message: error.message });
  }
}

const coverage = (assessed, unchecked) => ({ assessed, unchecked,
  assessed_count: assessed.length, unchecked_count: unchecked.length,
  total_count: assessed.length + unchecked.length });

const REVIEWER_PREVIEW_PLANE = "structured_dispatch";
function reviewerPreviewCapabilities(capabilities) {
  return { schema_version: capabilities.schema_version, enforcement: capabilities.enforcement,
    planes: capabilities.planes.filter(({ name, status }) => name === REVIEWER_PREVIEW_PLANE && status !== "available")
      .map(plane => ({ name: plane.name, available: plane.available, status: plane.status, blockers: plane.blockers,
        cause: plane.cause, gate_outcome: plane.gate_outcome, recovery: plane.recovery,
        corrective_action: plane.corrective_action })) };
}

export async function previewStartAgent({ request, context, workspace }) {
  const backend = context.dispatchBackend;
  const authorityFacts = await backend.getManagedLifecycleCapabilityAuthorityFacts();
  const lifecycle = await projectManagedLifecycleCapabilities({
    registeredToolNames: context.registeredToolNames, authorityFacts,
    requestContracts: context.requestContracts,
    isPaidTier: context.isPaidTier === true });
  const capabilitiesFor = role => role === "reviewer" ? reviewerPreviewCapabilities(lifecycle) : lifecycle;
  if (request.subject === undefined) {
    const facts = backend.getDispatchModelCapabilityFacts({ ...request, workspace_dir: workspace.dir });
    if (facts.refusal) return { accepted: false, refusal: facts.refusal };
    return { outcome: "preview", preview_kind: "capability", role: request.role,
      selection: facts, capabilities: capabilitiesFor(request.role), source: null,
      effects: { cache: "not_requested", child_started: false, canonical_written: false,
        runtime_prepared: false, integration_requested: false },
      coverage: coverage(["configured_model", "override_permission", "executor_availability", "capability_facts"],
        ["canonical_subject", "assignment", "CCE", "launch_time", "isolation"]) };
  }
  const selected = await resolveStartedAgentDispatchSelection({ args: request, ...context, jsonContent: value => value });
  if (selected.response) return selected.response;
  const args = selected.args;
  if (args.role === "worker" && args.diff_base_sha !== undefined) return { accepted: false,
    refusal: { code: "caller_supplied_committed_slice_authority", reason: "worker_review_pair_forbidden" } };
  const targetRefusal = backend.resolveWorkerTargetRefusal(args);
  if (targetRefusal !== null) return exactSliceTargetAuthoring(targetRefusal,
    { ...context, subject: args.subject, dir: workspace.dir });
  const admission = admitAgentDispatchRequest({ ...context, args, jsonContent: value => value });
  if (admission.response) return admission.response;
  const plan = backend.planLaunch({ ...args, workspace_dir: workspace.dir });
  if (plan.accepted !== true) return { accepted: false, refusal: plan.refusal };
  let source, assessment, graphDependent = false, scope = null, baseSelection = null, sliceAssessment = null,
    initiative = null;
  if (args.role === "reviewer" || args.role === "redteam") {
    const material = await backend.resolveAdvisoryReviewMaterial({ ...args, workspace_alias: workspace.repo });
    const target = material.normalized_target;
    source = { material_kind: material.material_kind, subject: args.subject,
      diff_base_sha: target.diff_base_sha, reviewed_sha: target.reviewed_sha,
      reviewed_tree: target.reviewed_tree_sha };
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

    if (readiness.dispatchable === false && readiness.decision_code === CONTROLLED_ACCEPTANCE_INCOMPLETE &&
        args.role === "worker" && args.subject.includes("#")) {
      sliceAssessment = await servedSliceAssessment(args.subject, context.requestContracts);
    }

    const recovery = readiness.recovery?.graph_impact;
    graphDependent = graphDerivationRequiredForDispatch(recovery) || recovery === "nonrecoverable_missing_paths";
    assessment = { readiness: boundedRecoveryDetail(readiness, { dispatchable: readiness.dispatchable,
      ...(readiness.structural_readiness === undefined ? {} : { structural_readiness: readiness.structural_readiness }),
      ...(scope === null ? {} : { worker_scope_preflight: scope }),
      ...(initiative === null ? {} : { initiative_authoring: initiative.authoring }) }),
      graph: { state: graphDependent ? "not_assessed" : "not_required" },
      execution_admitted: "unchecked" };
    const unknown = { state: "unknown", reason: graphDependent
      ? "committed graph snapshot not assessed" : "committed graph snapshot not required" };
    source = { subject: args.subject,
      revision: await readRecordAuthoringRevision({ repoRoot: workspace.dir, unit: args.subject }),
      repository_commit: unknown, repository_tree: unknown };
  }

  const scopeFacts = ["prospective_scope_base", "prospective_worker_scope"];
  const scopeAssessed = scope === null ? []
    : scope.status === "passed" || scope.status === "refused" ? scopeFacts
      : scope.reason?.code === WORKER_SCOPE_BASE_SELECTION_MISSING_DECISION_CODE ? scopeFacts.slice(0, 1) : [];
  const scopeCoverage = { assessed: scopeAssessed,
    unchecked: scope === null ? [] : scopeFacts.filter(fact => !scopeAssessed.includes(fact)) };
  return { outcome: "preview", preview_kind: "action", subject: args.subject, role: args.role,
    selection: { app: plan.app, model: plan.model, backend: plan.backend,
      executor_available: plan.executor_available }, capabilities: capabilitiesFor(args.role), source, assessment,

    ...(scope?.base?.selection === undefined ? {} : { base_selection: startAgentBaseSelection({
      wkId: args.subject.split("#", 1)[0], branch: scope.base.ref, selection: scope.base.selection,
      saved: scope.base.selection === WK_BASE_SELECTION.SAVED }) }),
    ...(baseSelection === null ? {} : { correction: baseSelection.correction,
      ...(baseSelection.limitation ? { readiness_guidance_limitation: baseSelection.limitation }
        : { next_calls: [baseSelection.call] }) }),
    ...(initiative === null ? {} : initiative.limitation
      ? { readiness_guidance_limitation: initiative.limitation } : { next_calls: [initiative.call] }),
    ...(sliceAssessment === null ? {} : sliceAssessment.limitation
      ? { contract_assessment_limitation: sliceAssessment.limitation } : { next_calls: [sliceAssessment.call] }),
    effects: { cache: "not_consumed",
      child_started: false, canonical_written: false, runtime_prepared: false, integration_requested: false },
    coverage: coverage(["canonical_subject", "configured_model", "override_permission", "executor_availability",
      args.role === "worker" ? "configured_worker_target" : "review_material",
      ...(args.role === "worker" ? ["authored_readiness"] : []), ...scopeCoverage.assessed],
      ["CCE", "launch_time", "isolation", "publication", "cleanup", ...(args.role === "worker" ? ["graph_admission"] : []),
        ...(graphDependent ? ["committed_graph"] : []), ...scopeCoverage.unchecked]) };
}
