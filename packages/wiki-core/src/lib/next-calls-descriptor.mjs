

import { isDeepStrictEqual } from "node:util";
import { WORK_RECORD_STATUS_VALUES } from "./work-record-schema-constants.mjs";
import {
  CANONICAL_NEXT_CALL_TOOL_NAMES,
  isCanonicalNextCallTool,
  isCanonicalReadOnlyTool
} from "./next-calls-canonical-tools.mjs";
import { argumentValidatorFor } from "./next-calls-schema-compiler.mjs";

export const NEXT_CALLS_DESCRIPTOR_VERSION = "next-calls-descriptor.v1";

export { CANONICAL_NEXT_CALL_TOOL_NAMES, isCanonicalNextCallTool };

export const CONTINUATION_CONTRACT_VERSION = "callable-continuation.v1";

export const SUCCESS_PREDICATE_OPERATORS = Object.freeze([
  "equals",
  "not_equals",
  "is_true",
  "is_false",
  "is_present",
  "is_absent"
]);

const SUCCESS_PREDICATE_OPERATOR_SET = new Set(SUCCESS_PREDICATE_OPERATORS);
const VALUE_BEARING_OPERATORS = new Set(["equals", "not_equals"]);
const SUCCESS_PREDICATE_KEYS = new Set(["fact", "operator", "value"]);

const FACT_IDENTITY_RE = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/u;

const UNRESOLVED_STRING_RE = /^(?:\$|<.*>$|(?:TODO|TBD|FIXME|XXX)\b)/iu;

const ORDINARY_TASK_TEXT_SELECTOR_KEYS = new Set([
  "field",
  "text",
  "member",
  "offset",
  "length"
]);

function isOrdinaryTaskTextSelector(value) {
  if (!isPlainObjectValue(value) || value.field !== "sections.tasks" ||
      typeof value.text !== "string" || value.text.trim() === "" ||
      Object.keys(value).some((key) => !ORDINARY_TASK_TEXT_SELECTOR_KEYS.has(key))) {
    return false;
  }
  if (value.member !== undefined && !["index", "text", "status"].includes(value.member)) {
    return false;
  }
  if (value.offset !== undefined && (!Number.isSafeInteger(value.offset) || value.offset < 0)) {
    return false;
  }
  if (value.length !== undefined && (!Number.isSafeInteger(value.length) || value.length < 1)) {
    return false;
  }
  if ((value.offset !== undefined || value.length !== undefined) && value.member !== "text") {
    return false;
  }
  return true;
}

function isPlainObjectValue(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const SELECTED_RECORD_MEMBER_SELECTOR_KEYS = new Set([
  "path", "offset", "limit", "length", "expected_source_digest"
]);

function isSelectedRecordMemberSelector(value) {
  return isPlainObjectValue(value) && Array.isArray(value.path) &&
    Object.keys(value).every((key) => SELECTED_RECORD_MEMBER_SELECTOR_KEYS.has(key)) &&
    value.path.every((segment) => typeof segment === "string" ||
      (Number.isSafeInteger(segment) && segment >= 0));
}

export function isUnresolvedArgumentValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    return value.trim() === "" || UNRESOLVED_STRING_RE.test(value.trim());
  }
  if (Array.isArray(value)) return value.some(isUnresolvedArgumentValue);
  if (isPlainObjectValue(value)) return Object.values(value).some(isUnresolvedArgumentValue);
  return false;
}

export function unresolvedArgumentNames(callArguments) {
  if (!isPlainObjectValue(callArguments)) return [];
  return Object.entries(callArguments)
    .filter(([name, value]) => {

      if (name === "slice_status") {
        const statuses = Array.isArray(value) ? value : [value];
        if (statuses.every((status) => typeof status === "string" &&
            WORK_RECORD_STATUS_VALUES.includes(status.trim()))) return false;
      }
      if (name === "ordinary_field" && isOrdinaryTaskTextSelector(value)) {
        const selectorArguments = { ...value };
        delete selectorArguments.text;
        return isUnresolvedArgumentValue(selectorArguments);
      }
      if (name === "member" && isSelectedRecordMemberSelector(value)) {
        const selectorArguments = { ...value };
        delete selectorArguments.path;
        return isUnresolvedArgumentValue(selectorArguments);
      }
      return isUnresolvedArgumentValue(value);
    })
    .map(([name]) => name)
    .sort();
}

export function isMachineCheckableSuccessPredicate(predicate) {
  if (!isPlainObjectValue(predicate)) return false;
  for (const key of Object.keys(predicate)) {
    if (!SUCCESS_PREDICATE_KEYS.has(key)) return false;
  }
  if (typeof predicate.fact !== "string" || !FACT_IDENTITY_RE.test(predicate.fact)) return false;
  if (!SUCCESS_PREDICATE_OPERATOR_SET.has(predicate.operator)) return false;
  const carriesValue = Object.hasOwn(predicate, "value");
  if (VALUE_BEARING_OPERATORS.has(predicate.operator)) {

    return carriesValue && !isUnresolvedArgumentValue(predicate.value);
  }
  return !carriesValue;
}

export function evaluateSuccessPredicate(predicate, observedFacts) {
  if (!isMachineCheckableSuccessPredicate(predicate)) {
    throw new TypeError("evaluateSuccessPredicate requires a machine-checkable predicate");
  }
  if (!isPlainObjectValue(observedFacts) || !Object.hasOwn(observedFacts, predicate.fact)) {
    return "unobserved";
  }
  const observed = observedFacts[predicate.fact];
  switch (predicate.operator) {
    case "equals":
      return isDeepStrictEqual(observed, predicate.value);
    case "not_equals":
      return !isDeepStrictEqual(observed, predicate.value);
    case "is_true":
      return observed === true;
    case "is_false":
      return observed === false;
    case "is_present":
      return observed !== null && observed !== undefined;
    default:
      return observed === null || observed === undefined;
  }
}

function jsonPredicateBytes(predicate) {
  try {
    const encoded = JSON.stringify(predicate);
    return typeof encoded === "string" ? encoded : null;
  } catch (error) {

    void error;
    return null;
  }
}

function sameCallRecoveryErrors(
  entry,
  where,
  { originatingTool, decidingFacts, observedFacts }
) {
  const declaresPrerequisite = Object.hasOwn(entry, "prerequisite_predicate");
  if (originatingTool === null || originatingTool === undefined) {
    if (declaresPrerequisite) {
      return [`${where}.prerequisite_predicate cannot be validated without the originating tool identity`];
    }
    return [];
  }
  if (typeof originatingTool !== "string" || originatingTool.trim() === "") {
    return ["originatingTool must be a non-empty canonical tool identity when provided"];
  }

  const isSameCall = entry.tool === originatingTool;
  if (!isSameCall) {
    if (declaresPrerequisite) {
      return [`${where}.prerequisite_predicate is reserved for a next call that invokes the originating tool; fresh independent actions retain their owner-defined semantics`];
    }
    return [];
  }

  if (!declaresPrerequisite) {
    return [`${where} invokes the originating tool ${JSON.stringify(originatingTool)} but declares no prerequisite_predicate`];
  }

  const prerequisite = entry.prerequisite_predicate;
  if (!isMachineCheckableSuccessPredicate(prerequisite)) {
    return [`${where}.prerequisite_predicate must use the existing success-predicate grammar`];
  }

  const prerequisiteBytes = jsonPredicateBytes(prerequisite);
  const successBytes = jsonPredicateBytes(entry.success_predicate);
  if (
    prerequisiteBytes === null ||
    successBytes === null ||
    prerequisiteBytes !== successBytes
  ) {
    return [`${where}.prerequisite_predicate must be byte-identical to ${where}.success_predicate`];
  }

  if (!Array.isArray(decidingFacts)) {
    return [`${where}.prerequisite_predicate cannot be validated without the published deciding facts`];
  }
  const fact = decidingFacts.find(
    (candidate) =>
      isPlainObjectValue(candidate) && candidate.field === prerequisite.fact
  );
  if (!fact) {
    return [`${where}.prerequisite_predicate names ${JSON.stringify(prerequisite.fact)}, which is not a published deciding fact`];
  }
  if (fact.redacted === true) {
    return [`${where}.prerequisite_predicate names redacted deciding fact ${JSON.stringify(prerequisite.fact)}; redacted data cannot select recovery`];
  }
  if (fact.omitted === true) {
    return [`${where}.prerequisite_predicate names omitted deciding fact ${JSON.stringify(prerequisite.fact)}; an unpublished value cannot select recovery`];
  }
  if (!Object.hasOwn(fact, "value")) {
    return [`${where}.prerequisite_predicate names deciding fact ${JSON.stringify(prerequisite.fact)}, but its value is not published`];
  }

  if (!isPlainObjectValue(observedFacts) || !Object.hasOwn(observedFacts, prerequisite.fact)) {
    return [`${where}.prerequisite_predicate names ${JSON.stringify(prerequisite.fact)}, which is unobserved in the returned result`];
  }

  const publishedFact = { [prerequisite.fact]: fact.value };
  if (
    evaluateSuccessPredicate(prerequisite, observedFacts) !== false ||
    evaluateSuccessPredicate(prerequisite, publishedFact) !== false
  ) {
    return [`${where}.prerequisite_predicate is already true in the returned result; repeating the same call cannot recover it`];
  }

  return [];
}

export function isAuthoritativeRequestSchema(schema) {
  if (!isPlainObjectValue(schema)) return false;
  if (schema.type !== "object" || !isPlainObjectValue(schema.properties)) return false;
  if (!Object.hasOwn(schema, "required")) return true;
  return (
    Array.isArray(schema.required) && schema.required.every((name) => typeof name === "string")
  );
}

function requestSchemaLookup(requestSchemas) {
  if (requestSchemas === null || requestSchemas === undefined) return null;
  if (typeof requestSchemas === "function") return requestSchemas;
  if (requestSchemas instanceof Map) return (tool) => requestSchemas.get(tool);
  if (isPlainObjectValue(requestSchemas)) {
    return (tool) => (Object.hasOwn(requestSchemas, tool) ? requestSchemas[tool] : undefined);
  }
  throw new TypeError("requestSchemas must be a Map, plain object, or lookup function");
}

export function requestContractErrors(tool, callArguments, schema) {
  if (!isAuthoritativeRequestSchema(schema)) {
    return [
      `no authoritative request schema is available for ${JSON.stringify(tool)}; an unvalidatable call is not a validated call`
    ];
  }
  const supplied = isPlainObjectValue(callArguments) ? callArguments : {};
  const errors = [];

  const missing = (schema.required ?? []).filter((name) => !Object.hasOwn(supplied, name)).sort();
  if (missing.length > 0) {
    errors.push(
      `omits ${missing.join(", ")}, which the request schema for ${tool} requires`
    );
  }

  const unknown = Object.keys(supplied)
    .filter((name) => !Object.hasOwn(schema.properties, name))
    .sort();
  if (unknown.length > 0 && schema.additionalProperties !== true) {
    errors.push(
      `declares ${unknown.join(", ")}, which the request schema for ${tool} does not accept`
    );
  }

  const validate = argumentValidatorFor(schema);
  if (!validate(supplied)) {
    for (const detail of validate.errors ?? []) {

      if (detail.keyword === "required" || detail.keyword === "additionalProperties") continue;
      errors.push(`${detail.instancePath || "/"} ${detail.message}`.trim());
    }
  }
  return errors;
}

export function buildNextCall(spec = {}) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new TypeError("buildNextCall requires an entry spec object");
  }
  const { tool, arguments: callArguments, recommended, disallowed, ...payload } = spec;
  if (typeof tool !== "string" || tool.trim() === "") {
    throw new TypeError("buildNextCall requires a non-empty string `tool`");
  }

  if (!isCanonicalNextCallTool(tool)) {
    throw new TypeError(
      `buildNextCall \`tool\` must name a canonical MCP route; ${JSON.stringify(tool)} is not registered`
    );
  }
  if (recommended !== undefined && typeof recommended !== "boolean") {
    throw new TypeError("buildNextCall `recommended` must be a boolean when provided");
  }
  if (disallowed !== undefined && typeof disallowed !== "boolean") {
    throw new TypeError("buildNextCall `disallowed` must be a boolean when provided");
  }
  if (recommended === true && disallowed === true) {
    throw new TypeError(
      "a recommended next-call cannot also be disallowed (recommended must be an allowed member)"
    );
  }
  if (
    callArguments !== undefined &&
    callArguments !== null &&
    (typeof callArguments !== "object" || Array.isArray(callArguments))
  ) {
    throw new TypeError("buildNextCall `arguments` must be a plain object when provided");
  }
  const entry = { tool, ...payload };
  if (callArguments !== undefined && callArguments !== null) {

    const unresolved = unresolvedArgumentNames(callArguments);
    if (unresolved.length > 0) {
      throw new TypeError(
        `buildNextCall \`arguments\` must be complete; ${unresolved.join(", ")} ${unresolved.length === 1 ? "is" : "are"} unresolved`
      );
    }
    entry.arguments = { ...callArguments };
  }
  if (Object.hasOwn(entry, "success_predicate") && !isMachineCheckableSuccessPredicate(entry.success_predicate)) {
    throw new TypeError(
      "buildNextCall `success_predicate` must name one fact, a closed operator, and a value only where the operator compares one"
    );
  }
  if (
    Object.hasOwn(entry, "prerequisite_predicate") &&
    !isMachineCheckableSuccessPredicate(entry.prerequisite_predicate)
  ) {
    throw new TypeError(
      "buildNextCall `prerequisite_predicate` must use the existing success-predicate grammar"
    );
  }
  if (recommended === true) entry.recommended = true;
  if (disallowed === true) entry.disallowed = true;
  if (Object.hasOwn(entry, "kind")) {
    const kindErrors = entryKindErrors(entry, "buildNextCall entry");
    if (kindErrors.length > 0) throw new TypeError(kindErrors.join("; "));
  }
  return entry;
}

export function buildNextCalls(specs, { knownTools = null } = {}) {
  if (!Array.isArray(specs)) {
    throw new TypeError("buildNextCalls requires an array of call specifications");
  }
  const entries = specs.map((spec) => buildNextCall(spec));
  const seenTools = new Set();
  for (const [index, entry] of entries.entries()) {
    if (seenTools.has(entry.tool)) {
      throw new TypeError(
        `next-calls entry[${index}] duplicates tool "${entry.tool}"; constructed tool identities must be unique`
      );
    }
    seenTools.add(entry.tool);
  }
  const validation = validateNextCalls(entries, { knownTools });
  if (!validation.valid) {
    throw new TypeError(`next-calls violate the canonical descriptor contract: ${validation.errors.join("; ")}`);
  }
  return entries;
}

export function buildContinuationCall(spec = {}, { requestSchema = null } = {}) {
  const entry = buildNextCall(spec);
  if (!Object.hasOwn(entry, "success_predicate")) {
    throw new TypeError(
      "buildContinuationCall requires a machine-checkable `success_predicate`; a continuation with no checkable outcome is advice, not a route"
    );
  }
  if (entry.disallowed === true) {
    throw new TypeError("a disallowed entry is not a continuation");
  }

  const contractErrors = requestContractErrors(entry.tool, entry.arguments, requestSchema);
  if (contractErrors.length > 0) {
    throw new TypeError(
      `buildContinuationCall \`arguments\` must satisfy the request contract of ${entry.tool}: ${contractErrors.join("; ")}`
    );
  }
  return entry;
}

export const NEXT_CALL_KIND_GUIDANCE = "guidance";

export const GUIDANCE_INFORMATION_MAX_LENGTH = 512;

const GUIDANCE_ENTRY_KEYS = new Set(["kind", "tool", "arguments", "recommended", "information"]);

export function isGuidanceNextCall(entry) {
  return isPlainObjectValue(entry) && entry.kind === NEXT_CALL_KIND_GUIDANCE;
}

function guidanceEntryErrors(entry, where) {
  const errors = [];
  for (const key of ["success_predicate", "prerequisite_predicate"]) {
    if (Object.hasOwn(entry, key)) {
      errors.push(`${where}.${key} is corrective; a guidance entry states no predicate`);
    }
  }
  if (Object.hasOwn(entry, "disallowed")) {
    errors.push(`${where} is guidance and cannot be disallowed`);
  }
  for (const key of Object.keys(entry)) {
    if (!GUIDANCE_ENTRY_KEYS.has(key) && !["success_predicate", "prerequisite_predicate",
      "disallowed"].includes(key)) {
      errors.push(`${where} declares ${key}, which a guidance entry does not carry`);
    }
  }
  if (typeof entry.tool === "string" && isCanonicalNextCallTool(entry.tool) &&
      !isCanonicalReadOnlyTool(entry.tool)) {
    errors.push(
      `${where} names ${entry.tool}, whose canonical side_effects are not exactly read_only; guidance is a read`
    );
  }
  if (!isPlainObjectValue(entry.arguments)) {
    errors.push(`${where}.arguments must be the complete argument object of the read`);
  }
  const information = entry.information;
  if (typeof information !== "string" || information.trim() === "" ||
      information.trim() !== information || information.length > GUIDANCE_INFORMATION_MAX_LENGTH) {
    errors.push(
      `${where}.information must state the question the read answers in 1..${GUIDANCE_INFORMATION_MAX_LENGTH} trimmed characters`
    );
  }
  return errors;
}

function entryKindErrors(entry, where) {
  if (!Object.hasOwn(entry, "kind")) return [];
  if (entry.kind !== NEXT_CALL_KIND_GUIDANCE) {
    return [`${where}.kind ${JSON.stringify(entry.kind)} is unknown; the only entry kind is "guidance"`];
  }
  return guidanceEntryErrors(entry, where);
}

function registeredToolPredicate(registeredTools) {
  if (registeredTools === null || registeredTools === undefined) return null;
  return toolNarrowingPredicate(registeredTools, "registeredTools");
}

function guidanceAdmissionErrors(entry, where, { requestSchema, isRegistered }) {
  const errors = [];
  if (isRegistered === null) {
    errors.push(
      `${where} cannot be admitted without the active server's registered tool set`
    );
  } else if (!isRegistered(entry.tool)) {
    errors.push(`${where} names ${entry.tool}, which the active server does not register`);
  }
  for (const error of requestContractErrors(entry.tool, entry.arguments, requestSchema)) {
    errors.push(`${where}.arguments ${error}`);
  }
  return errors;
}

export function buildGuidanceCall(spec = {}, { requestSchema = null, registeredTools = null } = {}) {
  if (!isPlainObjectValue(spec)) {
    throw new TypeError("buildGuidanceCall requires an entry spec object");
  }
  if (Object.hasOwn(spec, "kind") && spec.kind !== NEXT_CALL_KIND_GUIDANCE) {
    throw new TypeError(`buildGuidanceCall cannot build kind ${JSON.stringify(spec.kind)}`);
  }
  const entry = buildNextCall({ ...spec, kind: NEXT_CALL_KIND_GUIDANCE });
  const errors = guidanceAdmissionErrors(entry, "buildGuidanceCall entry", {
    requestSchema,
    isRegistered: registeredToolPredicate(registeredTools)
  });
  if (errors.length > 0) throw new TypeError(errors.join("; "));
  return entry;
}

export function validateGuidanceCalls(
  list,
  { requestSchemas = null, registeredTools = null, knownTools = null } = {}
) {
  if (!Array.isArray(list) || list.length === 0) {
    return { valid: false, errors: ["a guidance limb must offer at least one guidance entry"] };
  }
  const errors = [];
  const lookUpRequestSchema = requestSchemaLookup(requestSchemas);
  if (lookUpRequestSchema === null) {
    errors.push("guidance requires each named tool's registrar-scoped request schema; none was supplied");
  }
  const isRegistered = registeredToolPredicate(registeredTools);
  const narrowsTo = toolNarrowingPredicate(knownTools);
  const seenTools = new Set();
  list.forEach((entry, index) => {
    const where = `entry[${index}]`;
    if (!isPlainObjectValue(entry)) {
      errors.push(`${where} must be an object`);
      return;
    }
    if (!isGuidanceNextCall(entry)) {
      errors.push(
        Object.hasOwn(entry, "kind")
          ? entryKindErrors(entry, where)[0]
          : `${where} is not guidance; a guidance limb cannot mix corrective or router entries`
      );
      return;
    }
    if (typeof entry.tool !== "string" || !isCanonicalNextCallTool(entry.tool)) {
      errors.push(`${where} references tool ${JSON.stringify(entry.tool)} that is not in the canonical tool-discovery corpus`);
      return;
    }
    if (narrowsTo && !narrowsTo(entry.tool)) {
      errors.push(`${where} references unregistered tool "${entry.tool}"`);
    }
    if (seenTools.has(entry.tool)) errors.push(`${where} duplicates tool "${entry.tool}"`);
    seenTools.add(entry.tool);
    if (entry.recommended !== undefined && typeof entry.recommended !== "boolean") {
      errors.push(`${where}.recommended must be a boolean when present`);
    }
    errors.push(...guidanceEntryErrors(entry, where));
    if (isPlainObjectValue(entry.arguments)) {
      const unresolved = unresolvedArgumentNames(entry.arguments);
      if (unresolved.length > 0) {
        errors.push(`${where}.arguments leaves ${unresolved.join(", ")} unresolved; guidance carries complete arguments`);
      }
    }
    if (lookUpRequestSchema !== null) {
      errors.push(...guidanceAdmissionErrors(entry, where, {
        requestSchema: lookUpRequestSchema(entry.tool),
        isRegistered
      }));
    }
  });
  return { valid: errors.length === 0, errors };
}

export function renderNextCall(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const callArguments = entry.arguments;
  if (
    callArguments &&
    typeof callArguments === "object" &&
    !Array.isArray(callArguments) &&
    Object.keys(callArguments).length > 0
  ) {
    const body = Object.entries(callArguments)
      .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
      .join(", ");
    return `${entry.tool}({${body}})`;
  }
  return entry.tool;
}

function toolNarrowingPredicate(knownTools, label = "knownTools") {
  if (knownTools === null || knownTools === undefined) {
    return null;
  }
  if (typeof knownTools === "function") {
    return knownTools;
  }
  if (knownTools instanceof Set) {
    return (tool) => knownTools.has(tool);
  }
  if (Array.isArray(knownTools)) {
    const set = new Set(knownTools);
    return (tool) => set.has(tool);
  }
  throw new TypeError(`validateNextCalls ${label} must be an array, Set, or predicate`);
}

function validateEntryContinuation(entry, where, { observedFacts, requireContinuationContract, errors }) {
  const declaresPredicate = Object.hasOwn(entry, "success_predicate");
  if (!declaresPredicate) {
    if (requireContinuationContract && entry.disallowed !== true) {
      errors.push(
        `${where} declares no success_predicate; a continuation must state a machine-checkable outcome`
      );
    }
    return;
  }
  if (!isMachineCheckableSuccessPredicate(entry.success_predicate)) {
    errors.push(
      `${where}.success_predicate must name one fact, a closed operator (${SUCCESS_PREDICATE_OPERATORS.join(", ")}), and a value only where the operator compares one`
    );
    return;
  }
  if (!isPlainObjectValue(observedFacts)) return;

  const outcome = evaluateSuccessPredicate(entry.success_predicate, observedFacts);
  if (outcome === true) {

    errors.push(
      `${where}.success_predicate is already satisfied by the observed fact ${entry.success_predicate.fact}; an already-satisfied continuation cannot converge`
    );
  } else if (outcome === "unobserved") {
    errors.push(
      `${where}.success_predicate names ${entry.success_predicate.fact}, which the refusal does not carry as an observed fact; its convergence cannot be checked`
    );
  }
}

export function validateContinuationCalls(
  list,
  {
    knownTools = null,
    observedFacts = null,
    requestSchemas = null,
    originatingTool = null,
    decidingFacts = null
  } = {}
) {
  return validateNextCalls(list, {
    knownTools,
    observedFacts,
    requestSchemas,
    originatingTool,
    decidingFacts,
    requireContinuationContract: true
  });
}

export function validateNextCalls(
  list,
  {
    knownTools = null,
    observedFacts = null,
    requestSchemas = null,
    originatingTool = null,
    decidingFacts = null,
    requireContinuationContract = false
  } = {}
) {
  if (!Array.isArray(list)) {
    return { valid: false, errors: ["next-calls list must be an array"] };
  }
  const narrowsTo = toolNarrowingPredicate(knownTools);
  const lookUpRequestSchema = requestSchemaLookup(requestSchemas);
  const errors = [];
  if (requireContinuationContract) {

    const callable = list.filter(
      (entry) => isPlainObjectValue(entry) && entry.disallowed !== true &&
        !Object.hasOwn(entry, "kind")
    );
    if (callable.length === 0) {
      errors.push(
        "a continuation must offer at least one non-disallowed callable entry; a disallowed-only list states no executable next step"
      );
    }
    if (lookUpRequestSchema === null) {
      errors.push(
        "the callable-continuation contract requires each named tool's authoritative request schema; none was supplied"
      );
    }
  }
  if (requireContinuationContract && !isPlainObjectValue(observedFacts)) {

    errors.push(
      "the callable-continuation contract requires the authenticated facts the refusal observed"
    );
  }
  list.forEach((entry, index) => {
    const where = `entry[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${where} must be an object`);
      return;
    }
    if (typeof entry.tool !== "string" || entry.tool.trim() === "") {
      errors.push(`${where} must have a non-empty string tool`);
    }
    if (entry.recommended !== undefined && typeof entry.recommended !== "boolean") {
      errors.push(`${where}.recommended must be a boolean when present`);
    }
    if (entry.disallowed !== undefined && typeof entry.disallowed !== "boolean") {
      errors.push(`${where}.disallowed must be a boolean when present`);
    }
    if (entry.recommended === true && entry.disallowed === true) {
      errors.push(
        `${where} is flagged both recommended and disallowed; a recommended entry must be an allowed subset member`
      );
    }
    if (
      entry.arguments !== undefined &&
      entry.arguments !== null &&
      (typeof entry.arguments !== "object" || Array.isArray(entry.arguments))
    ) {
      errors.push(`${where}.arguments must be a plain object when present`);
    } else if (isPlainObjectValue(entry.arguments)) {

      const unresolved = unresolvedArgumentNames(entry.arguments);
      if (unresolved.length > 0) {
        errors.push(
          `${where}.arguments leaves ${unresolved.join(", ")} unresolved; a published next call must carry complete arguments`
        );
      }
    }
    if (Object.hasOwn(entry, "kind")) {

      errors.push(...entryKindErrors(entry, where));
      if (requireContinuationContract && isGuidanceNextCall(entry)) {
        errors.push(
          `${where} is informational guidance; it is not a corrective continuation`
        );
      }
    } else {
      validateEntryContinuation(entry, where, {
        observedFacts,
        requireContinuationContract,
        errors
      });
    }
    if (requireContinuationContract && entry.disallowed !== true &&
        !Object.hasOwn(entry, "kind")) {
      errors.push(...sameCallRecoveryErrors(entry, where, {
        originatingTool,
        decidingFacts,
        observedFacts
      }));
    }

    if (
      requireContinuationContract &&
      entry.disallowed !== true &&
      !Object.hasOwn(entry, "kind") &&
      lookUpRequestSchema !== null &&
      isCanonicalNextCallTool(entry.tool)
    ) {
      for (const error of requestContractErrors(
        entry.tool,
        entry.arguments,
        lookUpRequestSchema(entry.tool)
      )) {
        errors.push(`${where}.arguments ${error}`);
      }
    }
    if (typeof entry.tool === "string" && entry.tool.trim() !== "") {
      if (!isCanonicalNextCallTool(entry.tool)) {
        errors.push(
          `${where} references tool "${entry.tool}" that is not in the canonical tool-discovery corpus`
        );
      } else if (narrowsTo && !narrowsTo(entry.tool)) {
        errors.push(`${where} references unregistered tool "${entry.tool}"`);
      }
    }
  });
  return { valid: errors.length === 0, errors };
}

export function pickDoThisNext(list) {
  if (!Array.isArray(list)) {
    return null;
  }
  return list.find((entry) => entry && typeof entry === "object" && entry.recommended === true) ?? null;
}

export function projectNextActionScalar(list) {
  const doThisNext = pickDoThisNext(list);

  if (!doThisNext || isGuidanceNextCall(doThisNext)) return null;
  return renderNextCall(doThisNext);
}
