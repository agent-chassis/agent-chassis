

export const ACTOR_RECOVERY_VALUES = new Set(["operator", "coordinator", "caller_retry", "launcher"]);

const RECOVERY_STATES = new Set(["callable", "guidance", "no_supported_route"]);
const RECOVERY_ROLE_VALUES = new Set(["worker", "reviewer", "redteam"]);
const RECOVERY_ROUTE_RE = /^[a-z][a-z0-9_]{0,63}$/u;
const RECOVERY_SUBJECT_RE = /^(?:WK-\d{4})(?:#SLICE-\d{3})?$/u;
const BOUNDED_TOKEN_RE = /^[a-z][a-z0-9_.-]{0,159}$/u;
const GUIDANCE_ARGUMENT_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/u;
const GUIDANCE_ARGUMENT_STRING_MAX = 256;
const GUIDANCE_ARGUMENT_MAX_DEPTH = 2;
const GUIDANCE_INFORMATION_MAX = 512;
const RECOVERY_PROSE_FIELDS = Object.freeze([
  "prerequisite", "operator_action", "retry_condition", "explanation"
]);
const RECOVERY_PROSE_MAX = 2048;

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const accept = (value) => ({ ok: true, value });
const reject = { ok: false, value: null };

function validateRecoveryState(value) {
  return typeof value === "string" && RECOVERY_STATES.has(value) ? accept(value) : reject;
}

function validateRecoveryRoute(value) {
  if (value === null) return accept(null);
  return typeof value === "string" && RECOVERY_ROUTE_RE.test(value) ? accept(value) : reject;
}

function validateRecoveryArgs(value) {
  if (value === null || value === undefined) return accept(null);
  if (!isPlainObject(value)) return reject;
  const projected = {};
  for (const key of Object.keys(value)) {
    if (key === "role") {
      if (value.role === null) { projected.role = null; continue; }
      if (typeof value.role !== "string" || !RECOVERY_ROLE_VALUES.has(value.role)) return reject;
      projected.role = value.role;
      continue;
    }
    if (key === "subject") {
      if (typeof value.subject !== "string" || !RECOVERY_SUBJECT_RE.test(value.subject)) return reject;
      projected.subject = value.subject;
      continue;
    }
    return reject;
  }
  return accept(Object.freeze(projected));
}

function projectGuidanceArgs(value, depth = 0) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) return null;
  const projected = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!GUIDANCE_ARGUMENT_KEY_RE.test(key)) return null;
    if (typeof entry === "string") {
      if (entry.length === 0 || entry.length > GUIDANCE_ARGUMENT_STRING_MAX) return null;
    } else if (typeof entry === "number") {
      if (!Number.isFinite(entry)) return null;
    } else if (typeof entry !== "boolean") {
      if (depth >= GUIDANCE_ARGUMENT_MAX_DEPTH) return null;
      const nested = projectGuidanceArgs(entry, depth + 1);
      if (nested === null) return null;
      projected[key] = nested;
      continue;
    }
    projected[key] = entry;
  }
  return Object.freeze(projected);
}

function validateActorRecovery(value) {
  return typeof value === "string" && ACTOR_RECOVERY_VALUES.has(value) ? accept(value) : reject;
}

function validateNextAction(value) {
  return typeof value === "string" && BOUNDED_TOKEN_RE.test(value) ? accept(value) : reject;
}

function validateSubjectField(value) {
  return typeof value === "string" && RECOVERY_SUBJECT_RE.test(value) ? accept(value) : reject;
}

function validateRoleField(value) {
  return typeof value === "string" && RECOVERY_ROLE_VALUES.has(value) ? accept(value) : reject;
}

function validateRecoveryProse(value, schemaRejected) {
  const prose = {};
  for (const field of RECOVERY_PROSE_FIELDS) {
    if (value[field] === undefined) continue;
    if (typeof value[field] !== "string" || value[field].length === 0 ||
        value[field].length > RECOVERY_PROSE_MAX) {
      schemaRejected.push(`detail.recovery.${field}`);
      continue;
    }
    prose[field] = value[field];
  }
  if (value.responsible_actor !== undefined) {
    const responsibleActor = validateActorRecovery(value.responsible_actor);
    if (!responsibleActor.ok) {
      schemaRejected.push("detail.recovery.responsible_actor");
    } else {
      prose.responsible_actor = responsibleActor.value;
    }
  }
  return prose;
}

function validateDeclaredGuidance(value, route, schemaRejected) {
  const rejectedBefore = schemaRejected.length;
  if (typeof route !== "string") schemaRejected.push("detail.recovery.route");
  const args = projectGuidanceArgs(value.args);
  if (args === null) schemaRejected.push("detail.recovery.args");
  const information = value.information;
  if (typeof information !== "string" || information.trim() === "" ||
      information.length > GUIDANCE_INFORMATION_MAX) {
    schemaRejected.push("detail.recovery.information");
  }
  const prose = validateRecoveryProse(value, schemaRejected);
  if (typeof prose.prerequisite !== "string") {
    if (value.prerequisite === undefined) schemaRejected.push("detail.recovery.prerequisite");
  }
  if (typeof prose.responsible_actor !== "string" && value.responsible_actor === undefined) {
    schemaRejected.push("detail.recovery.responsible_actor");
  }
  if (schemaRejected.length !== rejectedBefore) return null;
  return Object.freeze({ state: "guidance", route, args, information, ...prose });
}

function validateDeclaredRecovery(value, schemaRejected) {
  if (value === undefined) return null;
  if (!isPlainObject(value)) {
    schemaRejected.push("detail.recovery");
    return null;
  }
  const state = validateRecoveryState(value.state);
  const route = validateRecoveryRoute(value.route);
  if (!state.ok) schemaRejected.push("detail.recovery.state");
  if (!route.ok) schemaRejected.push("detail.recovery.route");
  if (state.ok && route.ok && state.value === "guidance") {
    return validateDeclaredGuidance(value, route.value, schemaRejected);
  }
  const args = validateRecoveryArgs(value.args);
  if (!args.ok) schemaRejected.push("detail.recovery.args");
  if (!state.ok || !route.ok || !args.ok) return null;
  if (state.value === "callable" && typeof route.value !== "string") {
    schemaRejected.push("detail.recovery.route");
    return null;
  }
  if (state.value === "no_supported_route" && route.value !== null) {
    schemaRejected.push("detail.recovery.route");
    return null;
  }
  const prose = validateRecoveryProse(value, schemaRejected);
  return Object.freeze({
    state: state.value,
    route: route.value,
    ...(state.value === "callable" ? { args: args.value } : {}),
    ...prose
  });
}

function validateDeclaredNextActionArgs(value, schemaRejected) {
  if (value === undefined) return null;
  if (!isPlainObject(value)) {
    schemaRejected.push("detail.next_action_args");
    return null;
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "role" && key !== "subject")) {
    schemaRejected.push("detail.next_action_args");
    return null;
  }
  const role = value.role === null ? accept(null) : validateRoleField(value.role);
  const subject = validateSubjectField(value.subject);
  if (!role.ok) schemaRejected.push("detail.next_action_args.role");
  if (!subject.ok) schemaRejected.push("detail.next_action_args.subject");
  return role.ok && subject.ok
    ? Object.freeze({ role: role.value, subject: subject.value })
    : null;
}

export function selectDeclaredLauncherRecovery(detail, schemaRejected) {
  const declaredRecovery = validateDeclaredRecovery(detail.recovery, schemaRejected);
  const nextAction = validateNextAction(detail.next_action);
  if (detail.next_action !== undefined && !nextAction.ok) {
    schemaRejected.push("detail.next_action");
  }
  const actorRecovery = validateActorRecovery(detail.actor_recovery);
  if (detail.actor_recovery !== undefined && !actorRecovery.ok) {
    schemaRejected.push("detail.actor_recovery");
  }
  const nextActionArgs = validateDeclaredNextActionArgs(
    detail.next_action_args,
    schemaRejected
  );
  const declaredCallableArgs = nextAction.ok && nextAction.value === "workspace_agent_dispatch" &&
      actorRecovery.ok && actorRecovery.value === "coordinator" &&
      typeof nextActionArgs?.subject === "string"
    ? nextActionArgs
    : null;

  let recovery;
  if (declaredRecovery?.state === "guidance") {
    recovery = declaredRecovery;
  } else if (declaredRecovery !== null) {
    recovery = declaredRecovery.state === "callable" && typeof declaredRecovery.route === "string"
      ? Object.freeze({
          state: "callable",
          route: declaredRecovery.route,
          args: declaredRecovery.args ?? null
        })
      : Object.freeze({ ...declaredRecovery, state: "no_supported_route", route: null });
  } else if (declaredCallableArgs !== null) {
    recovery = Object.freeze({
      state: "callable",
      route: "workspace_agent_dispatch",
      args: Object.freeze({
        role: declaredCallableArgs.role ?? null,
        subject: declaredCallableArgs.subject
      })
    });
  } else {
    recovery = Object.freeze({ state: "no_supported_route", route: null });
  }
  return { recovery, actorRecovery };
}
