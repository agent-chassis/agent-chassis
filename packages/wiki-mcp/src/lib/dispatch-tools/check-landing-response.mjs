

import { isDeepStrictEqual } from "node:util";

const CAUSE_FIELDS = new Set([
  "stage", "phase", "reason", "category", "code", "name", "message", "value", "field", "issue",
  "state", "object_format", "observation_reason", "failed_operation", "cause_code",
  "ref", "wk_ref", "candidate_ref", "proposal", "matched", "fields", "role", "required_roles",
  "expected", "observed", "expected_head", "observed_head",
  "authored_base_branch", "captured_base_branch", "selector", "selectors", "remotes", "remote"
]);

function causeFacts(cause) {
  const projected = Object.fromEntries(Object.entries(cause).filter(([key]) => CAUSE_FIELDS.has(key)));
  if (cause.subject !== undefined) {
    projected.subject = typeof cause.subject === "object" && cause.subject !== null
      ? Object.fromEntries(Object.entries(cause.subject).filter(([key]) => ["assigned_unit", "unit", "repo"].includes(key)))
      : cause.subject;
  }
  if (projected.value !== null && typeof projected.value === "object") delete projected.value;
  for (const key of ["recorded_destination", "selected_destination"]) {
    if (cause[key] != null) projected[key] = Object.fromEntries(Object.entries(cause[key])
      .filter(([field]) => ["transport", "remote"].includes(field)));
  }

  if (typeof cause.prerequisite?.ref === "string") projected.ref = cause.prerequisite.ref;
  return projected;
}

export function projectCheckLandingCause(cause) {
  if (cause == null) return null;
  const failures = [];
  const seen = new Set();
  function facts(node) {
    if (node == null || typeof node !== "object" || seen.has(node)) return {};
    seen.add(node);

    const result = { ...causeFacts(node), ...facts(node.detail), ...facts(node.details) };
    for (const failure of node.evidence?.cause_chain ?? []) failures.push(facts(failure));
    for (const key of ["observation", "probe"]) {
      if (node[key] != null) failures.push(facts(node[key]));
    }
    if (node.cause != null) failures.push(facts(node.cause));
    if (node.envelope?.cause_diagnostic != null) failures.push(facts(node.envelope.cause_diagnostic));
    return result;
  }
  const deciding = facts(cause);
  const clean = (value) => {
    const result = { ...value };
    if (result.reason !== undefined) delete result.category;
    if (result.code === result.reason) delete result.code;
    if (result.message === result.reason || result.message === result.code) delete result.message;
    if (result.reason !== undefined || result.code !== undefined || result.message !== undefined) delete result.name;
    return result;
  };
  const decision = clean(deciding);
  const same = isDeepStrictEqual;
  const contains = (a, b) => Object.entries(b).every(([key, value]) => same(a[key], value));
  const distinct = [];
  for (const failure of failures) {
    const item = clean(failure);
    for (const key of Object.keys(item)) if (same(item[key], decision[key]) ||
      ["code", "message"].includes(key) && item[key] === decision.reason) delete item[key];
    if (Object.keys(item).length === 0 || distinct.some(existing => contains(existing, item))) continue;
    for (let i = distinct.length - 1; i >= 0; i--) if (contains(item, distinct[i])) distinct.splice(i, 1);
    distinct.push(item);
  }
  return { ...decision, ...(distinct.length === 0 ? {} : { failures: distinct }) };
}

export function checkLandingAction(body) {
  if (body.state !== "awaiting_human_landing" || body.handoff == null) return null;
  const handoff = body.handoff;
  if (body.transport === "hosted") {
    return { actor: body.landing_authority, proposal: handoff.pull_request_number,
      base_branch: handoff.base_branch };
  }
  return { actor: body.landing_authority, action: "land_exact_handoff_head",
    head: handoff.commit, base_branch: handoff.base_branch,
    ...(body.transport === "git"
      ? { remote: handoff.destination.remote, branch: handoff.branch }
      : { ref: handoff.handoff_ref }) };
}

function projectRecovery(recovery) {
  if (recovery == null) return undefined;
  const { state, responsible_actor, prerequisite, operator_action, missing_component,
    intended_request: intended } = recovery;
  if (responsible_actor == null) return { state, stopping_condition:
    "No supported correction call is available here." };
  return { state, responsible_actor, prerequisite,
    ...(operator_action === undefined ? {} : { operator_action }),
    ...(missing_component === undefined ? {} : { missing_component }),
    ...(responsible_actor != null && intended?.callable !== false && intended != null
      ? { retry_after_correction: intended } : {}) };
}

export function projectCheckLandingAnswer(body, { action = null, detail = false, later = null,
  detailCall = null } = {}) {
  const recovery = projectRecovery(body.recovery ?? body.refusal?.recovery);
  const cause = projectCheckLandingCause(body.cause ?? body.blocker?.detail);
  return {
    accepted: body.accepted,
    subject: body.subject,
    request_mode: body.request_mode,
    ...(body.state === undefined ? { blocker: { code: body.blocker.code, reason: body.blocker.reason,
      ...(cause === null ? {} : { detail: cause }) } } : { state: body.state,
      ...(cause === null ? {} : { cause }) }),
    ...(body.selection_authenticated === false && body.selection != null
      ? { selection: body.selection, selection_authenticated: false } : {}),
    ...(!detail && body.state === "awaiting_human_landing" && body.selection_authenticated === true && later === null
      ? { selection: body.selection } : {}),
    ...(body.state !== "awaiting_human_landing" ? {} : {
      ...((detail || detailCall === null) && action !== null ? {} : { landing_authority: body.landing_authority }),
      ...(detail || detailCall === null ? action === null
        ? { limitation: "The observer supplied no usable landing action target." }
        : { landing_action: action } : {}),
      ...(later === null ? {} : { observe_later: later }) }),
    ...(recovery === undefined ? {} : { recovery }),

    ...(body.effects === null ? { effects: null }
      : body.effects?.object_cache_fetch === "uncertain" ||
        (body.state === "unavailable" || body.state === "contradictory") &&
          body.effects?.object_cache_fetch === "completed" ? { effects: body.effects } : {}),
    ...(!detail && detailCall !== null ? { next_calls: [{ ...detailCall, purpose: "landing_action" }] } : {})
  };
}
