

import { isDeepStrictEqual } from "node:util";

import {
  classifySemanticIdentity,
  getRuntimeBlockerEntry,
  isPreservableSemanticIdentity,
  isPublicMechanicalRefusalCode,
  isRuntimeBlockerCode,
  projectPublicBlockerCodeForIdentity
} from "./runtime-blocker-taxonomy.mjs";
import {
  isCanonicalNextCallTool,
  isMachineCheckableSuccessPredicate,
  validateContinuationCalls
} from "./next-calls-descriptor.mjs";

export const PUBLIC_REFUSAL_SCHEMA_VERSION = "public-mechanical-refusal.v1";

const AUTHENTICATED_POLICY_FIELDS = Object.freeze([
  "authority",
  "decision_id",
  "exact_returned_policy",
  "ratified",
  "reasons",
  "remediation",
  "verdict"
]);

const LAUNCHER_CLASSIFICATION_FIELDS = Object.freeze([
  "authority_limb",
  "cause_category",
  "launcher_cause",
  "transition_cause"
]);

const definitionsByCode = new Map();

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneAndFreeze(value, seen = new Set()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError("refusal definitions must not contain cycles");
    }
    seen.add(value);
    const copy = value.map((entry) => cloneAndFreeze(entry, seen));
    seen.delete(value);
    return Object.freeze(copy);
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) {
      throw new TypeError("refusal definitions must not contain cycles");
    }
    seen.add(value);
    const copy = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneAndFreeze(entry, seen)])
    );
    seen.delete(value);
    return Object.freeze(copy);
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  throw new TypeError("refusal definitions must contain only controlled data values");
}

function assertStableString(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`refusal definition ${field} must be a non-empty stable string`);
  }
}

function assertPayloadFields(fields) {
  if (!isPlainObject(fields)) {
    throw new TypeError("refusal payload fields must be a plain object");
  }
  if (Object.hasOwn(fields, "code")) {
    throw new TypeError("refusal payload code comes from its registered definition");
  }
  if (Object.hasOwn(fields, "next_action")) {
    throw new TypeError("next_action belongs beside the refusal payload in its envelope");
  }
}

function payloadFor(definition, fields) {
  assertPayloadFields(fields);
  return { code: definition.code, ...fields };
}

const POSIX_ERRNO_RE = /^E[A-Z0-9]+$/u;

export function isPlatformErrorCode(code) {
  return typeof code === "string" && (POSIX_ERRNO_RE.test(code) || code.startsWith("ERR_"));
}

export const PUBLIC_SEMANTIC_CODE_RE = /^[a-z][a-z0-9_]{2,127}$/u;

export function boundPublicSemanticCode(code, fallback) {
  if (typeof code !== "string") return fallback;
  if (isPlatformErrorCode(code)) return fallback;
  if (isPreservableSemanticIdentity(code)) return code;
  return PUBLIC_SEMANTIC_CODE_RE.test(code) ? code : fallback;
}

export const PUBLIC_REDACTION_REASONS = Object.freeze({

  SECRET_MATERIAL: "secret_material",

  LAUNCHER_PRIVATE_STATE: "launcher_private_state",

  INTERNAL_IDENTIFIER: "internal_identifier",

  PERSONAL_DATA: "personal_data"
});

export const PUBLIC_REDACTION_REASON_VALUES = Object.freeze(
  Object.values(PUBLIC_REDACTION_REASONS)
);

const PUBLIC_REDACTION_REASON_SET = new Set(PUBLIC_REDACTION_REASON_VALUES);

export { isPreservableSemanticIdentity, projectPublicBlockerCodeForIdentity };

export function isPublicRedactionReason(reason) {
  return typeof reason === "string" && PUBLIC_REDACTION_REASON_SET.has(reason);
}

const LAUNCHER_PRIVATE_REDACTION_REASON_PROJECTION = Object.freeze({
  secret_material: PUBLIC_REDACTION_REASONS.SECRET_MATERIAL,
  launcher_private_state: PUBLIC_REDACTION_REASONS.LAUNCHER_PRIVATE_STATE,
  internal_identifier: PUBLIC_REDACTION_REASONS.INTERNAL_IDENTIFIER,
  personal_data: PUBLIC_REDACTION_REASONS.PERSONAL_DATA
});

export function projectLauncherRedactionReason(privateReason) {
  const projected = typeof privateReason === "string"
    ? LAUNCHER_PRIVATE_REDACTION_REASON_PROJECTION[privateReason]
    : undefined;
  if (projected === undefined) {
    throw new TypeError(
      `unknown launcher-private redaction reason ${JSON.stringify(privateReason)}; the public redaction vocabulary is closed`
    );
  }
  return projected;
}

const CALLER_SELECTABLE_DEFINITION_KEYS = new Set(["code", "namespace"]);

function taxonomyDerivedDefinition(code, namespace) {
  const entry = getRuntimeBlockerEntry(code);
  if (!entry) {
    throw new TypeError(
      `refusal code ${JSON.stringify(code)} is not registered in runtime-blocker-codes.v1.json`
    );
  }
  return cloneAndFreeze({
    code: entry.code,
    namespace,

    category: entry.category,
    blocking: Boolean(entry.blocking),
    actor_recovery: entry.actor_recovery ?? null,
    summary: entry.summary,
    recovery: Object.hasOwn(entry, "recovery")
      ? JSON.parse(JSON.stringify(entry.recovery))
      : null
  });
}

export function defineRefusalCode(definition) {
  const spec = typeof definition === "string" ? { code: definition } : definition;
  if (!isPlainObject(spec)) {
    throw new TypeError("refusal definition must be a registered code or a plain object");
  }
  assertStableString(spec.code, "code");

  const authored = Object.keys(spec).filter((key) => !CALLER_SELECTABLE_DEFINITION_KEYS.has(key));
  if (authored.length > 0) {
    throw new TypeError(
      `refusal definitions are derived from runtime-blocker-codes.v1.json; caller-defined field(s) ${authored.sort().join(", ")} are refused`
    );
  }

  const namespace = spec.namespace ?? null;
  if (namespace !== null) assertStableString(namespace, "namespace");

  const candidate = taxonomyDerivedDefinition(spec.code, namespace);
  const existing = definitionsByCode.get(candidate.code);
  if (existing) {
    if (isDeepStrictEqual(existing, candidate)) return existing;
    throw new TypeError(
      `divergent refusal definition for registered code ${JSON.stringify(candidate.code)}`
    );
  }

  definitionsByCode.set(candidate.code, candidate);
  return candidate;
}

export function buildRefusal(definition, fields = {}) {
  const registered = isPlainObject(definition)
    ? definitionsByCode.get(definition.code)
    : undefined;
  if (registered !== definition) {
    throw new TypeError("buildRefusal requires a registered refusal definition");
  }
  return payloadFor(registered, fields);
}

export function forwardRefusal(code, fields = {}) {

  if (!isRuntimeBlockerCode(code)) {
    throw new TypeError("forwardRefusal requires a registered refusal code");
  }
  const registered = definitionsByCode.get(code) ?? defineRefusalCode(code);
  return payloadFor(registered, fields);
}

const DECIDING_FACT_KEYS = new Set([
  "field",
  "value",
  "redacted",
  "redaction_reason",
  "omitted",
  "retrieval"
]);

const RETRIEVAL_KINDS = new Set(["complete", "ranged", "paginated"]);

function validateDecidingFact(fact, errors) {
  if (!isPlainObject(fact)) {
    errors.push("deciding_fact must be a plain object");
    return;
  }
  for (const key of Object.keys(fact)) {
    if (!DECIDING_FACT_KEYS.has(key)) {
      errors.push(`deciding_fact declares unknown field ${key}`);
    }
  }

  if (typeof fact.field !== "string" || fact.field.trim() === "") {
    errors.push("deciding_fact must name a non-empty field identity");
  }

  const redacted = fact.redacted === true;
  const omitted = fact.omitted === true;

  if (redacted && omitted) {
    errors.push("deciding_fact cannot be both redacted and omitted");
  }

  if (redacted) {
    if (Object.hasOwn(fact, "value")) {
      errors.push("a redacted deciding_fact must not carry its value");
    }
    if (!isPublicRedactionReason(fact.redaction_reason)) {
      errors.push(
        `deciding_fact redaction_reason must be one of the closed public reasons: ${PUBLIC_REDACTION_REASON_VALUES.join(", ")}`
      );
    }
  } else if (Object.hasOwn(fact, "redaction_reason")) {

    errors.push("deciding_fact carries a redaction_reason without being redacted");
  }

  if (omitted) {

    const retrieval = fact.retrieval;
    if (!isPlainObject(retrieval)) {
      errors.push("an omitted deciding_fact must document a lossless retrieval route");
    } else {
      if (!RETRIEVAL_KINDS.has(retrieval.kind)) {
        errors.push(
          `deciding_fact retrieval.kind must be one of ${[...RETRIEVAL_KINDS].join(", ")}`
        );
      }
      if (!isCanonicalNextCallTool(retrieval.route)) {
        errors.push(
          `deciding_fact retrieval.route must name a canonical MCP route; got ${JSON.stringify(retrieval.route)}`
        );
      }
    }
  } else if (Object.hasOwn(fact, "retrieval")) {
    errors.push("deciding_fact carries a retrieval route without being omitted");
  }

  if (!redacted && !omitted && !Object.hasOwn(fact, "value")) {
    errors.push("a published deciding_fact must carry its value");
  }
}

const RECOVERY_STATES = new Set(["callable", "no_supported_route"]);

function validateRecovery(recovery, decidingFacts, errors, options = {}) {
  const { hasNextCalls = false, candidate = null } = options;
  if (!isPlainObject(recovery)) {
    errors.push("recovery must be a plain object");
    return;
  }
  if (!RECOVERY_STATES.has(recovery.state)) {
    errors.push(`recovery.state must be one of ${[...RECOVERY_STATES].join(", ")}`);
    return;
  }

  if (recovery.state === "no_supported_route") {
    if (Object.hasOwn(recovery, "operation")) {
      errors.push("a no_supported_route recovery must not name an operation");
    }
    return;
  }

  if (typeof recovery.prerequisite !== "string" || recovery.prerequisite.trim() === "") {
    errors.push("a callable recovery must name the currently false prerequisite");
  }
  if (!isCanonicalNextCallTool(recovery.operation)) {
    errors.push(
      `a callable recovery must name a canonical operation capable of changing the prerequisite; got ${JSON.stringify(recovery.operation)}`
    );
  }
  if (typeof recovery.success_condition !== "string" || recovery.success_condition.trim() === "") {
    errors.push("a callable recovery must state a machine-checkable success condition");
  }

  if (hasNextCalls && isCanonicalNextCallTool(recovery.operation)) {
    const offered = candidate?.next_calls ?? [];

    const namesOperation = offered.some(
      (entry) =>
        isPlainObject(entry) && entry.tool === recovery.operation && entry.disallowed !== true
    );
    if (!namesOperation) {
      errors.push(
        `recovery names operation ${JSON.stringify(recovery.operation)}, which no offered, non-disallowed next call invokes`
      );
    }
  }
  if (!isMachineCheckableSuccessPredicate(recovery.success_predicate)) {
    errors.push(
      "a callable recovery must state its success as a machine-checkable predicate"
    );
  }

  if (Object.hasOwn(recovery, "selected_from")) {
    const selectedFrom = recovery.selected_from;
    if (!Array.isArray(selectedFrom) || selectedFrom.length === 0) {
      errors.push("recovery.selected_from must be a non-empty array of deciding-fact identities");
      return;
    }
    const byField = new Map(
      decidingFacts
        .filter((fact) => isPlainObject(fact) && typeof fact.field === "string")
        .map((fact) => [fact.field, fact])
    );
    for (const field of selectedFrom) {
      const fact = byField.get(field);
      if (!fact) {
        errors.push(`recovery.selected_from names unknown deciding fact ${JSON.stringify(field)}`);
        continue;
      }
      if (fact.redacted === true) {
        errors.push(
          `recovery.selected_from names redacted deciding fact ${JSON.stringify(field)}; redacted data must not select recovery`
        );
      }
      if (fact.omitted === true) {
        errors.push(
          `recovery.selected_from names omitted deciding fact ${JSON.stringify(field)}; an unpublished value must not select recovery`
        );
      }
    }
  }
}

function validateOwnedFieldConfinement(candidate, errors) {
  for (const field of AUTHENTICATED_POLICY_FIELDS) {
    if (Object.hasOwn(candidate, field)) {
      errors.push(
        `${field} is authenticated CCE policy content; it travels inside carried and is never authored on the refusal envelope`
      );
    }
  }
  for (const field of LAUNCHER_CLASSIFICATION_FIELDS) {
    if (Object.hasOwn(candidate, field)) {
      errors.push(
        `${field} is launcher transition classification owned by WK-2388; this carrier validates a carried classification and never derives one`
      );
    }
  }
}

function validateCarriedLauncherClassification(carried, errors) {
  if (!isPlainObject(carried) || !Object.hasOwn(carried, "launcher_transition")) return;
  const transition = carried.launcher_transition;
  if (!isPlainObject(transition)) {
    errors.push("carried.launcher_transition must be the object the launcher classified");
    return;
  }
  for (const field of ["cause_category", "authority_limb"]) {
    if (typeof transition[field] !== "string" || transition[field].trim() === "") {
      errors.push(
        `carried.launcher_transition must carry the launcher-selected ${field}; this carrier cannot supply one`
      );
    }
  }
}

export function validatePublicMechanicalRefusal(
  candidate,
  { observedFacts = null, requestSchemas = null } = {}
) {
  const errors = [];
  if (!isPlainObject(candidate)) {
    return { valid: false, errors: ["public refusal must be a plain object"] };
  }

  const evaluationFacts =
    observedFacts ?? (isPlainObject(candidate.observed_facts) ? candidate.observed_facts : null);

  if (!isPublicMechanicalRefusalCode(candidate.code)) {
    const classification = classifySemanticIdentity(candidate.code);
    errors.push(
      classification === "unrecognized"
        ? `public refusal code ${JSON.stringify(candidate.code)} is not registered in runtime-blocker-codes.v1.json`
        : `public refusal code ${JSON.stringify(candidate.code)} is a ${classification}; it is not registered in runtime-blocker-codes.v1.json as a public mechanical code`
    );
  }

  validateOwnedFieldConfinement(candidate, errors);
  validateCarriedLauncherClassification(candidate.carried, errors);

  const facts = Array.isArray(candidate.deciding_facts) ? candidate.deciding_facts : null;
  if (!facts || facts.length === 0) {
    errors.push("a public refusal must carry at least one deciding fact");
  } else {
    const seen = new Set();
    for (const fact of facts) {
      validateDecidingFact(fact, errors);
      if (isPlainObject(fact) && typeof fact.field === "string") {
        if (seen.has(fact.field)) {
          errors.push(`duplicate deciding fact identity ${JSON.stringify(fact.field)}`);
        }
        seen.add(fact.field);
      }
    }
  }

  const hasNextCalls = Array.isArray(candidate.next_calls) && candidate.next_calls.length > 0;
  const hasNoRoute = candidate.no_supported_route === true;
  if (hasNextCalls && hasNoRoute) {
    errors.push("a public refusal cannot both offer next calls and declare no supported route");
  }
  if (!hasNextCalls && !hasNoRoute) {
    errors.push(
      "a public refusal must offer a validated next call or explicitly declare no_supported_route"
    );
  }
  if (hasNextCalls) {
    const validation = validateContinuationCalls(candidate.next_calls, {
      observedFacts: evaluationFacts,
      requestSchemas,
      originatingTool: isCanonicalNextCallTool(candidate.route) ? candidate.route : null,
      decidingFacts: facts ?? []
    });
    for (const error of validation.errors) errors.push(`next_calls ${error}`);
  }

  validateRecovery(candidate.recovery, facts ?? [], errors, { hasNextCalls, candidate });

  if (hasNoRoute && candidate.recovery?.state === "callable") {
    errors.push("no_supported_route contradicts a callable recovery");
  }
  if (hasNextCalls && candidate.recovery?.state === "no_supported_route") {
    errors.push("a callable next call contradicts a no_supported_route recovery");
  }

  return { valid: errors.length === 0, errors };
}

export function buildPublicMechanicalRefusal({
  code,
  deciding_facts: decidingFacts,
  next_calls: nextCalls = null,
  no_supported_route: noSupportedRoute = false,
  recovery,
  route = null,
  carried = null,
  observed_facts: observedFacts = null,
  request_schemas: requestSchemas = null
} = {}) {
  const candidate = {
    schema_version: PUBLIC_REFUSAL_SCHEMA_VERSION,
    code,
    deciding_facts: decidingFacts,
    recovery
  };
  if (route !== null) candidate.route = route;
  if (nextCalls !== null) candidate.next_calls = nextCalls;
  if (noSupportedRoute === true) candidate.no_supported_route = true;
  if (carried !== null) candidate.carried = carried;

  const { valid, errors } = validatePublicMechanicalRefusal(candidate, {
    observedFacts,
    requestSchemas
  });
  if (!valid) {
    throw new TypeError(`invalid public mechanical refusal: ${errors.join("; ")}`);
  }

  const entry = getRuntimeBlockerEntry(code);
  const envelope = {
    schema_version: PUBLIC_REFUSAL_SCHEMA_VERSION,
    code,

    category: entry.category,
    blocking: Boolean(entry.blocking),
    summary: entry.summary,
    deciding_facts: decidingFacts.map((fact) => cloneAndFreeze({ ...fact })),
    recovery: cloneAndFreeze({ ...recovery }),
    route
  };
  if (nextCalls !== null) {
    envelope.next_calls = nextCalls.map((entry_) => cloneAndFreeze({ ...entry_ }));
  }
  if (noSupportedRoute === true) envelope.no_supported_route = true;

  if (observedFacts !== null) envelope.observed_facts = cloneAndFreeze({ ...observedFacts });

  if (carried !== null) envelope.carried = cloneAndFreeze(carried);

  return Object.freeze(envelope);
}
