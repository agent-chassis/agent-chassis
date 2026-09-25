

import {
  GUIDANCE_INFORMATION_MAX_LENGTH,
  isCanonicalNextCallTool,
  isGuidanceNextCall,
  isMachineCheckableSuccessPredicate,
  validateContinuationCalls,
  validateGuidanceCalls
} from "./next-calls-descriptor.mjs";
import { isCanonicalReadOnlyTool } from "./next-calls-canonical-tools.mjs";

export function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

export function isPublicRedactionReason(reason) {
  return typeof reason === "string" && PUBLIC_REDACTION_REASON_SET.has(reason);
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

function validateSelectedFrom(selectedFrom, decidingFacts, errors) {
  if (!Array.isArray(selectedFrom) || selectedFrom.length === 0) {
    errors.push("recovery.selected_from must be a non-empty array of deciding-fact identities");
    return null;
  }
  const byField = new Map(
    decidingFacts
      .filter((fact) => isPlainObject(fact) && typeof fact.field === "string")
      .map((fact) => [fact.field, fact])
  );
  const selected = [];
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
    selected.push(fact);
  }
  return selected;
}

const RECOVERY_STATES = new Set(["callable", "guidance", "no_supported_route"]);

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
  if (recovery.state === "guidance") {
    validateGuidanceRecovery(recovery, decidingFacts, errors, options);
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
    validateSelectedFrom(recovery.selected_from, decidingFacts, errors);
  }
}

const GUIDANCE_RECOVERY_KEYS = new Set([
  "state", "operation", "responsible_actor", "prerequisite", "information",
  "selected_from", "blocker_unchanged", "operator_action", "retry_condition", "explanation"
]);
const GUIDANCE_PROSE_KEYS = ["operator_action", "retry_condition", "explanation"];
const GUIDANCE_PROSE_MAX_LENGTH = 2048;
export const RECOVERY_RESPONSIBLE_ACTORS = Object.freeze([
  "operator", "coordinator", "caller_retry", "launcher"
]);

const CALLER_KNOWLEDGE_FACT_RE =
  /(?:^|[._])(?:description|contract|guidance|schema|documentation)_(?:loaded|known|read|seen)$/u;

function isCallerKnowledgeFact(field, operation) {
  return typeof field === "string" && (CALLER_KNOWLEDGE_FACT_RE.test(field) ||
    (typeof operation === "string" && field.startsWith(`${operation}.`)));
}

function validateGuidanceRecovery(recovery, decidingFacts, errors, {
  candidate = null,
  observedFacts = null
} = {}) {
  for (const key of Object.keys(recovery)) {
    if (GUIDANCE_RECOVERY_KEYS.has(key)) continue;
    errors.push(key === "success_predicate" || key === "success_condition"
      ? `a guidance recovery declares ${key}; guidance promises no corrective outcome`
      : `a guidance recovery declares ${key}; guidance neither repairs the blocker nor grants authority`);
  }
  if (recovery.blocker_unchanged !== true) {
    errors.push("a guidance recovery must declare blocker_unchanged:true");
  }
  if (!isCanonicalReadOnlyTool(recovery.operation)) {
    errors.push(
      `a guidance recovery must name a canonical read-only operation; got ${JSON.stringify(recovery.operation)}`
    );
  } else {
    const offered = Array.isArray(candidate?.next_calls) ? candidate.next_calls : [];
    if (!offered.some((entry) => isGuidanceNextCall(entry) && entry.tool === recovery.operation)) {
      errors.push(
        `guidance recovery names operation ${JSON.stringify(recovery.operation)}, which no offered guidance entry invokes`
      );
    }
  }
  if (!RECOVERY_RESPONSIBLE_ACTORS.includes(recovery.responsible_actor)) {
    errors.push(
      `a guidance recovery responsible_actor must be one of ${RECOVERY_RESPONSIBLE_ACTORS.join(", ")}`
    );
  }
  if (typeof recovery.prerequisite !== "string" || recovery.prerequisite.trim() === "") {
    errors.push("a guidance recovery must name the still-failed prerequisite");
  }
  const information = recovery.information;
  if (typeof information !== "string" || information.trim() === "" ||
      information.length > GUIDANCE_INFORMATION_MAX_LENGTH) {
    errors.push(
      `a guidance recovery must state its information in 1..${GUIDANCE_INFORMATION_MAX_LENGTH} characters`
    );
  }
  for (const key of GUIDANCE_PROSE_KEYS) {
    if (Object.hasOwn(recovery, key) && (typeof recovery[key] !== "string" ||
        recovery[key].trim() === "" || recovery[key].length > GUIDANCE_PROSE_MAX_LENGTH)) {
      errors.push(`a guidance recovery ${key} must be 1..${GUIDANCE_PROSE_MAX_LENGTH} characters`);
    }
  }
  const selected = validateSelectedFrom(recovery.selected_from, decidingFacts, errors) ?? [];
  for (const fact of selected) {
    if (!isPlainObject(observedFacts) || !Object.hasOwn(fact, "value") ||
        !Object.hasOwn(observedFacts, fact.field)) continue;
    if (JSON.stringify(observedFacts[fact.field]) !== JSON.stringify(fact.value)) {
      errors.push(
        `recovery.selected_from fact ${JSON.stringify(fact.field)} is published with a value its observed fact contradicts`
      );
    }
  }
  const factNames = [
    ...decidingFacts.filter(isPlainObject).map((fact) => fact.field),
    ...(isPlainObject(observedFacts) ? Object.keys(observedFacts) : [])
  ];
  for (const field of new Set(factNames)) {
    if (isCallerKnowledgeFact(field, recovery.operation)) {
      errors.push(
        `fact ${JSON.stringify(field)} describes caller knowledge or the offered read; a refusal cannot observe it`
      );
    }
  }
}

export function validateRefusalRecoveryContract(candidate, errors, {
  observedFacts = null,
  requestSchemas = null,
  registeredTools = null
} = {}) {
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
  const guidance = candidate.recovery?.state === "guidance";
  if (hasNextCalls && hasNoRoute) {
    errors.push("a public refusal cannot both offer next calls and declare no supported route");
  }
  if (!hasNextCalls && !hasNoRoute) {
    errors.push(
      "a public refusal must offer a validated next call or explicitly declare no_supported_route"
    );
  }
  if (hasNextCalls) {
    const validation = guidance
      ? validateGuidanceCalls(candidate.next_calls, { requestSchemas, registeredTools })
      : validateContinuationCalls(candidate.next_calls, {
          observedFacts,
          requestSchemas,
          originatingTool: isCanonicalNextCallTool(candidate.route) ? candidate.route : null,
          decidingFacts: facts ?? []
        });
    for (const error of validation.errors) errors.push(`next_calls ${error}`);
  }

  validateRecovery(candidate.recovery, facts ?? [], errors, {
    hasNextCalls, candidate, observedFacts
  });

  if (hasNoRoute && candidate.recovery?.state === "callable") {
    errors.push("no_supported_route contradicts a callable recovery");
  }
  if (hasNoRoute && guidance) {
    errors.push("no_supported_route contradicts a guidance recovery");
  }
  if (!hasNextCalls && guidance) {
    errors.push("a guidance recovery requires its guidance next call");
  }
  if (hasNextCalls && candidate.recovery?.state === "no_supported_route") {
    errors.push("a callable next call contradicts a no_supported_route recovery");
  }
}
