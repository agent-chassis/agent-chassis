

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
  isPlainObject,
  validateRefusalRecoveryContract
} from "./refusal-recovery-contract.mjs";

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

export {
  isPublicRedactionReason,
  PUBLIC_REDACTION_REASONS,
  PUBLIC_REDACTION_REASON_VALUES
} from "./refusal-recovery-contract.mjs";

export { isPreservableSemanticIdentity, projectPublicBlockerCodeForIdentity };

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
  { observedFacts = null, requestSchemas = null, registeredTools = null } = {}
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

  validateRefusalRecoveryContract(candidate, errors, {
    observedFacts: evaluationFacts,
    requestSchemas,
    registeredTools
  });

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
  request_schemas: requestSchemas = null,
  registered_tools: registeredTools = null
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
    requestSchemas,
    registeredTools
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
