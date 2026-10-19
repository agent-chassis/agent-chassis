import { INTEGRATED_SLICE_REDISPATCH_CODE } from "@agent-chassis/wiki-core/src/lib/integrated-slice-dispatch.mjs";
import { servedGuidanceRead, servedControlledAcceptanceRecovery, servedControlledAcceptanceFailure, projectControlledFailureFacts } from "./task-start-agent-guidance.mjs";
export { servedGuidanceRead } from "./task-start-agent-guidance.mjs";
import { readRecordAuthoringRevision, saveRecord } from "@agent-chassis/wiki-core/src/operations/save-record.mjs";
import { WK_BASE_SELECTION } from
  "@agent-chassis/agent-launch-cli/src/lib/worktree-substrate-exact-unit-identity.mjs";
import { buildDispatchToolExceptionDetail, projectDispatchFailureDetail } from "./dispatch-tool-helpers.mjs";
import { EXACT_SLICE_TARGET_REASON } from "./dispatch-tools/agent-dispatch-refusal-projection.mjs";
import { INTEGRATE_WORK_TOOL_NAME } from "./task-integrate-work-schema.mjs";

const START_TOOL = "start_agent";
const RESULT_TOOL = "get_run_result";
const unknown = reason => ({ state: "unknown", reason });

export async function startAgentBaseCorrection({ wkId, workspace, request }) {
  return { correction: { root_unit: wkId, revision: await readRecordAuthoringRevision({ repoRoot: workspace.dir, unit: wkId }),
    required_choice: "base_branch", save_tool: "save_record", retry: { ...request } },
  call: { kind: "guidance", tool: "workspace_read_wiki", arguments: { subject: wkId },
    information: "Read the root's current revision for a caller-authored base_branch save; reading leaves the prerequisite unchanged." } };
}

export function startAgentBaseSelection({ wkId, branch, selection, saved }) {
  const defaulted = selection === WK_BASE_SELECTION.DEFAULTED;
  return { root_unit: wkId, branch, roles: ["wk_base", "publication_target"], selection, saved,
    information: `${branch} is both the base ${wkId} is cut from and the branch its work is published to. ` + (!defaulted
      ? `It is the root's saved base_branch.`
      : saved ? `The root saved no base_branch, so this start saved the configured checkout's current branch as its base_branch.`
        : `The root saves no base_branch, so this is the configured checkout's current branch at preview time: nothing is ` +
          `written, and an actual start saves the branch current then. Save base_branch on ${wkId} through save_record first to choose another.`) };
}

export async function saveStartAgentDefaultBase({ wkId, branch, workspace }) {
  try {
    const saved = await saveRecord({ repoRoot: workspace.dir, unit: wkId,
      revision: await readRecordAuthoringRevision({ repoRoot: workspace.dir, unit: wkId }),
      changes: { base_branch: branch } }, { repository: workspace.repo });
    return saved.outcome === "saved" ? { saved: true }
      : { saved: false, outcome: saved.outcome, diagnostics: saved.diagnostics ?? [] };
  } catch (error) {
    return { saved: false, outcome: "failed", ...(error?.save_record === undefined ? {} : { effects: error.save_record.effects ?? null }),
      cause: { code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 512) } };
  }
}
export async function startAgentRefusal(value, { workspace, request, responseEnv, correction = null,
  requestContracts = null, beforeLaunch = false }) {
  const refusal = value?.refusal ?? value?.blocker ?? value;
  const completed = value?.code === INTEGRATED_SLICE_REDISPATCH_CODE ? value
    : value?.blocker?.detail?.originating_detail?.integrated_slice ??
      value?.refusal?.detail?.integrated_slice ?? null;
  if (completed !== null && completed.detail.subject === request.subject) {
    const { parent, assignment_authoring: authoring, integrated_delivery_sha } = completed.detail;
    const served = await servedGuidanceRead({ kind: "guidance", tool: "workspace_read_wiki",
      arguments: { subject: parent }, information: `Read ${parent} and its current revision, then author a new slice through save_record changes.ready_slices with caller-chosen contents. Start the newly saved slice.` }, requestContracts,
    { unavailableCode: "integrated_slice_parent_read_unavailable" });
    return { outcome: "refused", repository: workspace.repo, subject: request.subject, role: request.role ?? "worker",
      code: INTEGRATED_SLICE_REDISPATCH_CODE, reason: completed.reason,
      integrated_delivery_sha, assignment_authoring: authoring,
      failure: projectDispatchFailureDetail(value, { env: responseEnv }),
      authority_limb: "mechanical_failure", next_calls: served.call ? [served.call] : [],
      ...(served.limitation ? { readiness_guidance_limitation: served.limitation } : {}),
      effects: { child_started: false, runtime_prepared: false, canonical_written: false, integration_requested: false } };
  }

  const definition = value?.blocker?.reason === "repository_test_definition_unavailable"
    ? value.blocker : refusal?.reason === "repository_test_definition_unavailable" ? refusal : null;
  if (definition !== null) {
    const served = await servedGuidanceRead({ kind: "guidance", tool: "workspace_read_wiki",
      arguments: { subject: request.subject }, information: "Read this assignment and its current revision. " +
        "Correct changes.validation.repository_tests through save_record with caller-authored declarations whose definition files exist at the selected Git source, then retry this slice." }, requestContracts);
    return { outcome: "refused", repository: workspace.repo, subject: request.subject, role: "worker",
      code: value?.blocker?.code ?? refusal.code, failure: projectDispatchFailureDetail(value, { env: responseEnv }),
      assignment_authoring: { unit: request.subject, save_tool: "save_record",
        placement: "changes.validation.repository_tests", values: "caller_authored" },
      next_calls: served.call ? [served.call] : [],
      ...(served.limitation ? { readiness_guidance_limitation: served.limitation } : {}),
      effects: { child_started: false, runtime_prepared: false, canonical_written: false } };
  }
  const nextCalls = [];
  let guidanceLimitation = null;
  const controlledFailure = value?.blocker?.detail?.controlled_acceptance_failure ??
    value?.blocker?.detail?.originating_detail?.controlled_acceptance_failure ?? null;
  let controlledProjection = controlledFailure;
  if (controlledFailure !== null) {
    const served = controlledFailure.requested_unit === request.subject
      ? await servedControlledAcceptanceRecovery(controlledFailure, requestContracts)
      : { limitation: { code: "controlled_acceptance_requested_unit_mismatch" } };
    controlledProjection = servedControlledAcceptanceFailure(controlledFailure, served);
    if (served.limitation) guidanceLimitation = served.limitation;
    else {

      const offered = (refusal.next_calls ?? []).some(call => call.kind === "guidance" &&
        call.tool === served.call.tool && JSON.stringify(call.arguments) === JSON.stringify(served.call.arguments));
      if (offered) nextCalls.push(served.call);
      else guidanceLimitation = value?.blocker?.detail?.readiness_guidance_limitation ?? {
        code: "controlled_acceptance_navigation_not_offered", tool: served.call.tool,
        ...(value?.blocker?.detail?.schema_rejected?.length > 0 ? {
          rejected_fields: value.blocker.detail.schema_rejected } : {}),
        ...(refusal.carried?.guidance_unavailable === undefined ? {} : { cause: refusal.carried.guidance_unavailable }) };
    }
  }

  const authoringUnit = value?.blocker?.reason === "canonical_dispatch_intent_unresolved"
    ? value.blocker.detail?.assignment_authoring?.unit
    : value?.refusal?.reason === EXACT_SLICE_TARGET_REASON ? value.refusal.assignment_authoring?.unit
      : value?.blocker?.detail?.initiative_authoring?.unit;
  const authoring = authoringUnit !== undefined && typeof request.subject === "string" &&
    [request.subject, request.subject.split("#", 1)[0]].includes(authoringUnit);
  const guidanceSubject = correction?.root_unit ?? (authoring ? authoringUnit : request.subject);
  if (controlledFailure === null && (correction !== null || refusal?.recovery?.state === "guidance" && (authoring ||
      value?.readiness?.dispatchable === false && value?.blocker?.reason === "work_record_not_dispatchable"))) {
    for (const call of refusal.next_calls ?? []) {
      if (call.kind !== "guidance" || call.tool !== "workspace_read_wiki" ||
          call.arguments?.subject !== guidanceSubject || Object.keys(call.arguments).length !== 1) continue;
      const served = await servedGuidanceRead(call, requestContracts);
      if (served.limitation) guidanceLimitation = served.limitation;
      else nextCalls.push(served.call);
    }
  }

  const classified = controlledFailure === null && value?.refusal?.carried?.launcher_backend_refusal !== undefined;
  let correctionLimitation = null;

  let observationLimitation = null;
  const observes = classified && value.refusal.recovery?.state === "guidance";
  const dependencyDetail = value.blocker?.detail?.originating_detail ?? value.blocker?.detail;
  const identityCorrection = classified ? dependencyDetail?.identity_correction : null;
  const assignmentCorrection = classified ? dependencyDetail?.assignment_correction : null;
  const correctionParent = identityCorrection?.unit === request.subject ? identityCorrection.parent
    : assignmentCorrection?.requested_unit === request.subject ? assignmentCorrection.unit : null;
  if (observes && correctionParent === request.subject?.split('#')[0]) {
    const proposal = dependencyDetail.recovery;
    const offered = (value.refusal.next_calls ?? []).find(call => call.kind === 'guidance' &&
      call.tool === 'workspace_read_wiki' && call.arguments?.subject === correctionParent &&
      Object.keys(call.arguments).length === 1);
    if (proposal?.route === 'workspace_read_wiki' && offered) {
      const served = await servedGuidanceRead(offered, requestContracts);
      if (served.limitation) guidanceLimitation = served.limitation;
      else nextCalls.push(served.call);
    }
  } else if (observes) {
    const offered = (value.refusal.next_calls ?? []).filter(call => call.kind === "guidance" && call.tool === RESULT_TOOL);
    const limit = code => { observationLimitation = { code, tool: RESULT_TOOL }; };
    if (offered.length !== 1) limit("existing_attempt_read_not_offered");
    else {
      const [call] = offered, args = call.arguments ?? {};
      if (args.subject !== request.subject) limit("existing_attempt_read_subject_foreign");
      else if ((args.attempt_id !== undefined && (typeof args.attempt_id !== "string" || args.attempt_id === "")) ||
          Object.keys(args).some(key => key !== "subject" && key !== "attempt_id")) limit("existing_attempt_read_unclassified");
      else {
        const contract = requestContracts?.contractFor?.(RESULT_TOOL);
        if (!contract) limit("existing_attempt_read_full_contract_unavailable");
        else if (await contract.acceptsArguments(args) !== true) limit("existing_attempt_read_full_contract_rejected");
        else nextCalls.push(call);
      }
    }
  } else if (controlledFailure === null && value?.refusal?.carried?.guidance_unavailable !== undefined) {
    observationLimitation = { code: "existing_attempt_read_not_offered", tool: RESULT_TOOL };
  }
  if (classified && !observes && value.refusal.carried.guidance_unavailable === undefined) {
    const offered = value.refusal.recovery?.state === "callable" && value.refusal.route === START_TOOL
      ? (value.refusal.next_calls ?? []).filter(call => call.tool === START_TOOL && call.kind !== "guidance") : [];
    const limit = code => { correctionLimitation = { code, tool: START_TOOL }; };
    if (offered.length !== 1) limit("start_correction_not_offered");
    else {
      const [call] = offered, args = call.arguments ?? {};
      if (args.subject !== request.subject) limit("start_correction_subject_foreign");
      else if (typeof args.role !== "string" || Object.keys(args).some(key => key !== "role" && key !== "subject") ||
          call.prerequisite_predicate === undefined) limit("start_correction_arguments_unclassified");
      else {
        const contract = requestContracts?.contractFor?.(START_TOOL);
        if (!contract) limit("start_correction_full_contract_unavailable");
        else if (await contract.acceptsArguments(args) !== true) limit("start_correction_full_contract_rejected");
        else nextCalls.push(call);
      }
    }
  }

  const proposal = classified ? value.blocker?.detail?.recovery : null;
  let recovery = null;
  if (proposal?.state === "guidance" && proposal.route === RESULT_TOOL && typeof proposal.explanation === "string" &&
      proposal.args?.subject === request.subject) {
    const read = nextCalls.find(call => call.tool === RESULT_TOOL) ?? null;
    const served = (requestContracts?.contractFor?.(INTEGRATE_WORK_TOOL_NAME) ?? null) !== null;
    recovery = { instruction: proposal.explanation, prerequisite: proposal.prerequisite, blocker_unchanged: true,
      subject: request.subject, attempt_id: typeof proposal.args.attempt_id === "string" ? proposal.args.attempt_id
        : unknown("the committed delivery's history elects no single attempt"),
      steps: [read === null ? { tool: RESULT_TOOL, state: "unavailable", limitation: observationLimitation }
        : { tool: RESULT_TOOL, state: "offered", arguments: read.arguments, yields: "delivery.references" },
      served ? { tool: INTEGRATE_WORK_TOOL_NAME, state: "awaits_delivery_locator",
        requires: { delivery: "the delivery locator the read returns; a subject, commit SHA or final-result locator is not one" } }
        : { tool: INTEGRATE_WORK_TOOL_NAME, state: "unavailable",
          limitation: { code: "integration_route_not_served", tool: INTEGRATE_WORK_TOOL_NAME } }] };
  }
  return { outcome: "refused", repository: workspace.repo,
    subject: request.subject ?? null, role: request.role ?? null,
    code: value?.blocker?.code ?? refusal?.code ?? refusal?.reason ?? "start_agent_refused",
    ...(controlledProjection === null ? {} : { controlled_acceptance_failure: controlledProjection }),
    ...(recovery === null ? {} : { recovery }),
    failure: controlledProjection === null ? projectDispatchFailureDetail(value, { env: responseEnv })
      : projectControlledFailureFacts(projectDispatchFailureDetail(value, { env: responseEnv }), controlledProjection),
    authority_limb: value?.authority_limb ?? value?.transition_failure?.authority_limb ??
      refusal?.authority_limb ?? "mechanical_failure",
    source: null, enforcement: unknown("no accepted launcher observation"),

    effects: { child_started: beforeLaunch || request.preview === true || refusal?.effects_started === false ? false
      : unknown("the refusal owner's evidence remains in failure"),
      integration_requested: false }, ...(correction === null ? {} : { correction }),
    ...(guidanceLimitation === null ? {} : { readiness_guidance_limitation: guidanceLimitation }),
    ...(correctionLimitation === null ? {} : { correction_limitation: correctionLimitation }),
    ...(observationLimitation === null ? {} : { observation_limitation: observationLimitation }),
    next_calls: nextCalls };
}

async function startAgentResultCall({ args, buildResultCall, requestContracts, responseEnv, requireAttempt = false }) {
  let call = null, continuationFailure = null;
  if (buildResultCall !== null) {
    try {
      if (requireAttempt && (typeof args.attempt_id !== "string" || args.attempt_id.length === 0)) {
        throw new TypeError("start_agent exact-attempt observation identity is unavailable");
      }
      const candidate = await buildResultCall(args);
      const contract = requestContracts?.contractFor?.(candidate?.tool);
      if (candidate?.tool !== RESULT_TOOL || candidate.arguments?.subject !== args.subject ||
          candidate.arguments?.attempt_id !== args.attempt_id || !contract ||
          await contract.acceptsArguments(candidate.arguments) !== true ||
          Object.keys(candidate.arguments).some(key => !["subject", "attempt_id"].includes(key))) {
        throw new TypeError("start_agent result continuation lacks its enforced exact-attempt consumer contract");
      }
      call = candidate;
    } catch (error) {

      continuationFailure = buildDispatchToolExceptionDetail("start_agent", error, { env: responseEnv });
    }
  }
  return { call, continuationFailure };
}

export async function startAgentProblemObservation(value, { launch = null, request, buildResultCall,
  requestContracts, responseEnv }) {
  const args = { subject: request.subject,
    ...(typeof launch?.run_id === "string" ? { attempt_id: launch.run_id } : {}) };
  const { call, continuationFailure } = await startAgentResultCall({ args, buildResultCall, requestContracts, responseEnv });
  return { ...value, ...(launch === null ? {} : { attempt_id: launch.run_id, status: launch.status,
    effects: { ...value.effects, child_started: launch.launch_observation?.child_started === true ? true
      : unknown("the launch owner did not establish whether a child started") } }),
  next_calls: call === null ? [] : [call],
  ...(continuationFailure === null ? {} : { continuation_failure: continuationFailure }),
  ...(call === null ? { serving_dependency: "subject_attempt_result_consumer_not_composed" } : {}) };
}

export async function startAgentAccepted({ launch, workspace, buildResultCall, requestContracts, responseEnv }) {
  const observation = launch.producer_observation;
  const { call, continuationFailure } = await startAgentResultCall({
    args: { subject: launch.subject, attempt_id: launch.run_id }, buildResultCall, requestContracts, responseEnv,
    requireAttempt: true });
  if (launch.launch_observation?.child_started !== true) {
    const refused = await startAgentRefusal({
      code: launch.exit?.error_code ?? "launcher_child_start_unestablished",
      reason: "the launcher did not establish a child start", detail: launch.final_result?.missing_result ?? null,
      status: launch.status, exit: launch.exit
    }, { workspace, request: { subject: launch.subject, role: launch.role }, responseEnv, requestContracts });
    return { ...refused, attempt_id: launch.run_id, status: launch.status,
      next_calls: call === null ? [] : [call],
      ...(continuationFailure === null ? {} : { continuation_failure: continuationFailure }),
      ...(call === null ? { serving_dependency: "subject_attempt_result_consumer_not_composed" } : {}) };
  }
  const material = launch.advisory_review_material;
  const source = material ? { material_kind: material.material_kind, base_sha: material.base_sha,
    reviewed_sha: material.reviewed_sha, reviewed_tree: material.reviewed_tree, material_digest: material.material_digest }
    : launch.selected_source ?? null;
  return { outcome: "started", repository: workspace.repo, subject: launch.subject, role: launch.role,
    attempt_id: launch.run_id, status: launch.status, terminal: launch.terminal,
    selection: { app: launch.app, model: launch.model, backend: launch.backend }, source,
    enforcement: launch.launch_observation?.enforcement ?? unknown("launcher did not expose isolation posture"),
    effects: { child_started: launch.launch_observation?.child_started ?? unknown("advisory owner reports its actual process status"),
      integration_requested: false },
    result: { available: launch.final_result !== null && launch.final_result !== undefined,
      producer_pending: observation?.producer_pending ?? unknown("producer observation not supplied"),
      durability: observation?.final_result_durability ?? unknown("producer durability not supplied"),
      ...(observation?.result_publication === undefined ? {} : { publication: observation.result_publication }) },
    cleanup: launch.exit?.managed_identity_settlement_failure === undefined
      ? unknown("cleanup remains producer-owned")
      : projectDispatchFailureDetail(launch.exit.managed_identity_settlement_failure, { env: responseEnv }),
    next_calls: call === null ? [] : [call],
    ...(continuationFailure === null ? {} : { continuation_failure: continuationFailure }),
    ...(call === null ? { serving_dependency: "subject_attempt_result_consumer_not_composed" } : {}) };
}
