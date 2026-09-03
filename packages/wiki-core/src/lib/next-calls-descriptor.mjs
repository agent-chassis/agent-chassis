

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const NEXT_CALLS_DESCRIPTOR_VERSION = "next-calls-descriptor.v1";

const TOOL_DISCOVERY_DIR = path.join(THIS_DIR, "../../data/tool-discovery");
const TOOL_DISCOVERY_MANIFEST = path.join(TOOL_DISCOVERY_DIR, "manifest.json");

const CANONICAL_NEXT_CALL_TOOL_KIND = "mcp_tool";

function loadCanonicalNextCallToolNames() {
  const manifest = JSON.parse(readFileSync(TOOL_DISCOVERY_MANIFEST, "utf8"));
  if (!Array.isArray(manifest.fragments) || manifest.fragments.length === 0) {
    throw new Error(
      "next-calls canonical corpus: tool-discovery manifest declares no fragments"
    );
  }
  const names = new Set();
  const seen = new Set();
  for (const fragment of manifest.fragments) {
    const file = fragment?.file;
    if (typeof file !== "string" || file.length === 0) {
      throw new Error("next-calls canonical corpus: fragment entry declares no file");
    }
    const parsed = JSON.parse(readFileSync(path.join(TOOL_DISCOVERY_DIR, file), "utf8"));
    if (!Array.isArray(parsed.tools)) {
      throw new Error(`next-calls canonical corpus: fragment ${file} declares no tools array`);
    }
    for (const entry of parsed.tools) {
      const toolName = entry?.tool_name;
      if (typeof toolName !== "string" || toolName.length === 0) {
        throw new Error(`next-calls canonical corpus: fragment ${file} declares a nameless tool`);
      }

      if (seen.has(toolName)) {
        throw new Error(
          `next-calls canonical corpus: duplicate tool_name ${toolName} in fragment ${file}`
        );
      }
      seen.add(toolName);
      if (entry.kind === CANONICAL_NEXT_CALL_TOOL_KIND) names.add(toolName);
    }
  }
  if (names.size === 0) {
    throw new Error("next-calls canonical corpus: assembled corpus names no MCP tools");
  }
  return Object.freeze(names);
}

export const CANONICAL_NEXT_CALL_TOOL_NAMES = loadCanonicalNextCallToolNames();

export function isCanonicalNextCallTool(tool) {
  return typeof tool === "string" && CANONICAL_NEXT_CALL_TOOL_NAMES.has(tool);
}

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

function isPlainObjectValue(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
    .filter(([, value]) => isUnresolvedArgumentValue(value))
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

const requireFromModule = createRequire(import.meta.url);

let ajvInstance = null;
const compiledBySchema = new WeakMap();

function argumentValidatorFor(schema) {
  const cached = compiledBySchema.get(schema);
  if (cached) return cached;
  if (ajvInstance === null) {
    const loaded = requireFromModule("ajv");
    const Ajv = loaded.default ?? loaded;

    ajvInstance = new Ajv({ strict: false, allErrors: true });
  }
  const compiled = ajvInstance.compile(schema);
  compiledBySchema.set(schema, compiled);
  return compiled;
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

function toolNarrowingPredicate(knownTools) {
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
  throw new TypeError("validateNextCalls knownTools must be an array, Set, or predicate");
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
      (entry) => isPlainObjectValue(entry) && entry.disallowed !== true
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
    validateEntryContinuation(entry, where, {
      observedFacts,
      requireContinuationContract,
      errors
    });
    if (requireContinuationContract && entry.disallowed !== true) {
      errors.push(...sameCallRecoveryErrors(entry, where, {
        originatingTool,
        decidingFacts,
        observedFacts
      }));
    }

    if (
      requireContinuationContract &&
      entry.disallowed !== true &&
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
  return doThisNext ? renderNextCall(doThisNext) : null;
}
