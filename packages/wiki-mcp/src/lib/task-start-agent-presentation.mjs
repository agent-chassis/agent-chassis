

import { servedGuidanceRead } from './task-start-agent-guidance.mjs';

const omit = (value, fields) => Object.fromEntries(Object.entries(value ?? {})
  .filter(([key]) => !fields.includes(key)));
const calls = value => value.next_calls ?? [];
const selected = value => Object.fromEntries(['subject', 'role', 'attempt_id', 'status', 'terminal']
  .filter(key => value[key] !== undefined && value[key] !== null).map(key => [key, value[key]]));
const noLaunch = Object.freeze({ child_started: false });
const uncertainty = { state: 'unknown', reason: 'the launch owner did not establish whether a child started' };
const baseSelection = value => Object.fromEntries(['root_unit', 'branch', 'selection', 'saved']
  .map(key => [key, value[key]]));

function controlledFailure(failure) {
  return { ...omit(failure, ['owner_call']),
    ...(failure.deciding_causes === undefined ? {} : { deciding_causes: failure.deciding_causes.map(cause => ({
      ...omit(cause, ['summary', ...(cause.explanation === failure.explanation ? ['explanation'] : [])]),
      ...(cause.correction === undefined ? {} : {
        correction: omit(cause.correction, ['next_calls', 'instruction']) }) })) }) };
}

function failureMeaning(value) {
  const failure = value.failure ?? value;
  if (failure.refusal?.base_selection_save !== undefined) {
    return { reason: failure.refusal.code,
      detail: { base_selection_save: failure.refusal.base_selection_save } };
  }
  const blocker = failure.blocker ?? failure.refusal ?? failure;
  const detail = blocker.detail ?? failure.detail;
  const reason = detail?.originating_detail?.reason ?? detail?.refusal_reason ?? blocker.reason ?? value.reason ?? value.code;
  const identity = detail?.originating_detail?.identity_correction;
  if (identity !== undefined) return { reason, detail: { rejected: identity.rejected,
    correction_unit: identity.unit, authored_field: identity.authored_field } };
  const assignment = detail?.originating_detail?.assignment_correction;
  if (assignment !== undefined) return { reason, detail: { correction_unit: assignment.unit,
    authored_field: assignment.authored_field } };
  const dependencies = detail?.originating_detail;
  if (reason === 'saved_assignment_binding_stale' && dependencies?.binding_change !== undefined) return { reason,
    code: dependencies.cause.code, detail: { changed: dependencies.binding_change.field,
      record: dependencies.binding_change.record,
      retained_work: "unchanged; no new worker authority or work transfer",
      ...(dependencies.retained_delivery === undefined ? {} : { delivery: dependencies.retained_delivery }),
      ...(dependencies.delivery_problem === undefined ? {} : { delivery_problem: dependencies.delivery_problem }) } };
  if (['scope_existence_base_unresolved', 'scope_existence_base_selection_missing'].includes(reason) && dependencies?.resolution_failure) {
    const cause = dependencies.resolution_failure;
    return { reason, detail: { base_branch: dependencies.base_branch,
      cause: { code: cause.code, message: cause.message.replace(/^agent-launch worktree-substrate:\s*/u, '') } } };
  }
  if (dependencies?.failure_class === 'dependency' && dependencies.dependency_diagnostics?.length) {
    return { reason, detail: { dependencies: dependencies.dependency_diagnostics.map(entry => ({
      dependency: entry.dependency, cause: entry.reason,
      ...(entry.failure_code === undefined ? {} : { code: entry.failure_code }) })) } };
  }
  if (detail !== undefined && (detail === null || typeof detail !== 'object' || Array.isArray(detail))) {
    return { reason, detail };
  }
  const data = omit(detail, ['app', 'classification_state', 'refusal_code', 'refusal_reason',
    'authority_limb', 'transition_failure', 'schema_rejected', 'redactions', 'retained_evidence',
    'admission', 'controlled_acceptance_failure', 'recovery', 'schema_version', 'tool',
    'error_name', 'error_message_redactions']);
  if (data.reason === reason) delete data.reason;
  if (data.cause_code === value.code) delete data.cause_code;

  if (data.cause?.code === reason) delete data.cause;
  if (data.cause?.source !== undefined) data.cause = omit(data.cause, ['source', 'classification_code']);
  if (data.readiness !== undefined) {
    data.readiness = omit(data.readiness, ['schema_version', 'recovery']);
  }
  if (data.originating_detail !== undefined) data.originating_detail = omit(data.originating_detail,
    ['prior_tuple', 'reservation_holder', 'continuation', 'liveness', 'explanation']);
  return { reason, ...(Object.keys(data).length === 0 ? {} : { detail: data }),
    ...(failure.failed_stage === undefined ? {} : { stage: failure.failed_stage }) };
}

function recoveryMeaning(value) {
  if (value.recovery?.instruction) return { instruction: value.recovery.instruction };
  const failure = value.failure ?? value;
  const recovery = failure.blocker?.detail?.recovery ?? failure.refusal?.recovery;
  if (recovery === undefined || recovery === null) return null;

  const result = Object.fromEntries(['prerequisite', 'responsible_actor', 'operator_action',
    'retry_condition', 'explanation'].filter(key => recovery[key] !== undefined)
    .map(key => [key, recovery[key]]));
  return Object.keys(result).length === 0 ? null : result;
}

function relevantCapabilityGaps(value) {
  const available = value.capabilities;
  const planes = available?.planes ?? available?.unavailable_planes ?? [];
  const relevant = value.role === 'worker'
    ? ['structured_dispatch', 'repository_read_boundary', 'managed_worktree_provisioning']
    : ['structured_dispatch'];
  return planes.filter(plane => relevant.includes(plane.name) && plane.status !== 'available')
    .map(plane => ({ capability: plane.name, status: plane.status, codes: plane.blockers,
      ...(plane.cause == null ? {} : { cause: plane.cause }),
      ...(typeof plane.recovery === 'string' ? { correction: plane.recovery } : {
        stopping_condition: `The configured ${plane.name} capability is ${plane.status}; no executable repair is offered by its owner.` }) }));
}

async function previewMeaning(value, { request, requestContracts }) {
  const readiness = value.assessment?.readiness;
  const capabilityGaps = relevantCapabilityGaps(value);
  const blocked = readiness?.dispatchable === false || capabilityGaps.length > 0;
  const result = { outcome: 'preview', preview_kind: value.preview_kind, ...selected(value),
    decision: blocked ? 'gaps' : 'allowed',
    scope: value.preview_kind === 'capability' ? 'configured_role' : 'saved_action',
    limit: 'Launch-time admission remains unchecked. This preview grants no authorization and reserves no source.',
    effects: noLaunch, next_calls: [] };
  if (capabilityGaps.length > 0) result.capability_gaps = capabilityGaps;
  if (readiness?.dispatchable === false) {
    result.gap = { code: readiness.readiness_decision_code,
      ...(readiness.reasons?.length ? { reasons: readiness.reasons } : {}),
      ...(readiness.initiative_authoring === undefined ? {} : { authoring: readiness.initiative_authoring }),
      ...(readiness.worker_scope_preflight?.status === 'refused'
        ? { scope: readiness.worker_scope_preflight.reason } : {}) };
    result.next_calls = calls(value);
    if (value.controlled_acceptance_failure) {
      result.controlled_acceptance_failure = controlledFailure(value.controlled_acceptance_failure);
    }
  }
  if (value.correction) result.correction = omit(value.correction, ['retry']);
  if (value.base_selection) result.base_selection = baseSelection(value.base_selection);
  for (const key of ['readiness_guidance_limitation', 'contract_assessment_limitation']) {
    if (value[key]) result[key] = value[key];
  }
  if (!blocked && value.preview_kind === 'action') {

    const args = { subject: value.subject, role: value.role,
      ...(request.material === undefined ? {} : { material: request.material }),
      ...(request.diff_base_sha === undefined ? {} : {
        diff_base_sha: request.diff_base_sha, reviewed_sha: request.reviewed_sha }) };
    const offered = await servedGuidanceRead({ tool: 'start_agent', arguments: args }, requestContracts);
    if (offered.call) result.next_calls = [offered.call];
    else result.start_limitation = offered.limitation;
  }
  if (blocked && result.next_calls.length === 0 && !value.controlled_acceptance_failure && readiness?.dispatchable === false) {
    result.stopping_condition = 'The readiness owner offered no supported correction for this saved action.';
  }
  return result;
}

function startedMeaning(value) {
  const result = { outcome: 'started', ...selected(value), next_calls: calls(value) };

  if (value.cleanup && value.cleanup.state !== 'unknown') result.cleanup_failure = value.cleanup;
  if (value.result?.publication?.state === 'failed') result.result_problem = value.result.publication;
  if (value.continuation_failure) result.observation_problem = observationProblem(value.continuation_failure);
  if (result.next_calls.length === 0) {
    result.stopping_condition = 'The child started, but this serving session cannot offer its exact-attempt result read. Do not start it again to obtain status.';
  }
  if (value.base_selection) result.base_selection = baseSelection(value.base_selection);
  return result;
}

function observationProblem(failure) {
  return { reason: failure.error_message,
    ...(failure.cause_code === undefined ? {} : { code: failure.cause_code }) };
}

async function refusedMeaning(value, { request, requestContracts }) {
  const failure = value.failure ?? {};
  const origin = failure.blocker?.detail?.originating_detail;
  const problem = failureMeaning(value);

  const live = origin?.verdict === 'live' && origin?.liveness?.sandbox === 'alive';
  const next = [], options = [];
  let correctionReadLimitation = null;
  for (const call of calls(value)) {
    if (call.tool !== 'start_agent') {
      next.push(problem.reason === 'saved_assignment_binding_stale'
        ? { tool: call.tool, arguments: call.arguments } : call);
      continue;
    }
    const changesRole = call.arguments.role !== value.role;
    const changesSource = call.arguments.diff_base_sha !== request.diff_base_sha ||
      call.arguments.reviewed_sha !== request.reviewed_sha ||
      JSON.stringify(call.arguments.material) !== JSON.stringify(request.material);
    if (changesRole || changesSource) {
      const designChoice = call.arguments.material?.kind === 'canonical_design';
      options.push({ action: changesRole ? 'separate_review' : designChoice ? 'select_saved_design' : 'different_source', authorization: 'required',
        instruction: designChoice
          ? 'Choose this only if the intended review target is the saved design and its selected findings. The pinned checkout is supporting context; this does not review the rejected code range.'
          : call.arguments.diff_base_sha === undefined
          ? 'This is a separate action using the saved subject source at start time; it does not correct the original request.'
          : problem.reason === 'saved_assignment_binding_stale'
            ? 'Review the exact retained range as a separate authorized action. This does not rebind, integrate or resume the blocked worker.'
            : 'This separate action uses the explicit range shown; it does not correct the original request.',
        call: { tool: call.tool, arguments: call.arguments } });
    } else if (call.prerequisite_predicate !== undefined) {

      if (origin?.worker_scope_path !== undefined) {
        const read = await servedGuidanceRead({ kind: 'guidance', tool: 'workspace_read_wiki',
          arguments: { reads: [{ subject: value.subject, for_changes: [origin.worker_scope_path.field] }] }, information: 'Read the current assignment and correct the named scope path before starting this same action.' }, requestContracts);
        if (read.call) next.push(read.call);
        else correctionReadLimitation = read.limitation;
      }
    } else next.push(call);
  }
  if (live) {
    const attempt = next.find(call => call.tool === 'get_run_result')?.arguments.attempt_id ?? origin.prior_tuple?.run_id;
    return { outcome: 'already_started', ...selected(value),
      ...(attempt === undefined ? {} : { attempt_id: attempt }), next_calls: next,
      ...(value.observation_limitation ? { observation_limitation: value.observation_limitation } : {}),
      ...(next.length === 0 ? { stopping_condition: 'The existing live attempt cannot be observed through this session. Do not start a replacement.' } : {}) };
  }
  const result = { outcome: 'refused', ...selected(value), code: problem.code ?? value.code,
    failure: omit(problem, ['code']), effects: { child_started: request.preview === true || live || origin?.verdict !== undefined
      ? false : value.effects?.child_started ?? uncertainty }, next_calls: next };
  if (failure.refusal?.base_selection_save !== undefined) {
    result.code = failure.refusal.code;
    result.effects.child_started = false;
  }
  if (value.controlled_acceptance_failure) {
    result.controlled_acceptance_failure = controlledFailure(value.controlled_acceptance_failure);

    delete result.failure;
  }
  const recovery = recoveryMeaning(value);
  if (recovery && !value.controlled_acceptance_failure) result.recovery = recovery;
  if (options.length > 0) result.options = options;
  for (const key of ['correction', 'assignment_authoring', 'integrated_delivery_sha', 'base_selection',
    'readiness_guidance_limitation', 'correction_limitation', 'observation_limitation']) {
    if (value[key] !== undefined) result[key] = key === 'correction' ? omit(value[key], ['retry'])
      : key === 'base_selection' ? baseSelection(value[key]) : value[key];
  }
  if (result.assignment_authoring === undefined && failure.refusal?.assignment_authoring !== undefined) {
    result.assignment_authoring = failure.refusal.assignment_authoring;
  }
  if (result.readiness_guidance_limitation === undefined && failure.refusal?.readiness_guidance_limitation !== undefined) {
    result.readiness_guidance_limitation = failure.refusal.readiness_guidance_limitation;
  }
  if (value.continuation_failure) result.observation_problem = observationProblem(value.continuation_failure);
  if (correctionReadLimitation) result.correction_limitation = correctionReadLimitation;
  if (next.length === 0) result.stopping_condition = options.length > 0
    ? 'The original start remains blocked; the separate action requires its own authorization.'
    : result.correction !== undefined
      ? `The start remains blocked until ${result.correction.required_choice} is saved on ${result.correction.root_unit} through ${result.correction.save_tool}.`
    : problem.detail?.delivery === 'not_recorded'
      ? 'No authenticated delivery exists for the retained tip and no supported work-transfer route is available. The commit and dirty edits are preserved; a review cannot authorize adoption.'
    : problem.detail?.delivery === 'unavailable'
      ? 'The retained delivery cannot be authenticated. The original worker remains blocked and its work is preserved; no transfer is authorized. Do not retry unchanged.'
    : value.serving_dependency ? 'This session cannot offer observation of the issued attempt; do not retry launch to obtain status.'
      : `No supported correction is available for ${problem.reason} on ${value.subject ?? 'the selected role'}.`;
  return result;
}

export async function presentStartAgent(value, context) {
  if (value.outcome === 'preview') return previewMeaning(value, context);
  if (value.outcome === 'started') return startedMeaning(value);
  return refusedMeaning(value, context);
}
