

import { readWorkRecordById } from "@agent-chassis/wiki-core";

import { projectNextActionScalar } from "./mcp-response.mjs";
import {
  projectDiagnostic
} from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";

import {
  classifyDispatchSubject
} from "./dispatch-subject-classifier.mjs";
import {
  AGENT_DISPATCH_MONITOR_HANDLE_PREFIX,
  AGENT_DISPATCH_SCHEMA_VERSION,
  AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE,
  AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD,
  AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE,
  AGENT_RUN_STATUS_SCHEMA_VERSION,
  AGENT_RUN_WAIT_SCHEMA_VERSION,
  AGENT_RUNS_LIST_SCHEMA_VERSION,
  BACKEND_REFUSAL_TO_DISPATCH_BLOCKER,
  DISPATCH_BLOCKER_CODES,
  DISPATCH_SUBJECT_KIND_TO_ROUTE_KIND
} from "./dispatch-tool-constants.mjs";

import {
  RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES,
  getRuntimeBlockerEntry,
  isPreservableSemanticIdentity,
  isRuntimeBlockerCode,
  projectPublicBlockerCodeForIdentity
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  buildContinuationCall,
  validateNextCalls
} from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import {
  buildPublicMechanicalRefusal
} from "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";

import { createReadySliceInputSchema } from "./work-record-write-tools.mjs";
import { z as zodOwner } from "zod";

const registeredRequestSchemas = new Map();
const ownerRequestSchemaScopesByRegistrar = new WeakMap();
const ownerRequestSchemaAuthorityTokens = new WeakSet();

function ownerRequestSchemaScopeForRegistrar(registerTool) {
  if (typeof registerTool !== "function") {
    throw new TypeError("owner-supplied request-schema registration requires a registerTool function");
  }
  const existing = ownerRequestSchemaScopesByRegistrar.get(registerTool);
  if (existing !== undefined) return existing;
  const entries = new Map();
  const authority = Object.freeze({
    lookup(toolName) {
      return entries.get(toolName)?.requestSchema;
    }
  });
  const scope = Object.freeze({ entries, authority });
  ownerRequestSchemaAuthorityTokens.add(authority);
  ownerRequestSchemaScopesByRegistrar.set(registerTool, scope);
  return scope;
}

function assertOwnerRequestSchemaAuthority(authority) {
  if (!ownerRequestSchemaAuthorityTokens.has(authority)) {
    throw new TypeError("request-schema authority must come from a registered tool fixture");
  }
}

function unwrapZodType(schema) {
  let current = schema;

  for (let depth = 0; depth < 10 && current?._def; depth += 1) {
    const typeName = current._def.typeName;
    if (typeName === "ZodOptional" || typeName === "ZodNullable") current = current._def.innerType;
    else if (typeName === "ZodDefault") current = current._def.innerType;
    else if (typeName === "ZodEffects") current = current._def.schema;
    else if (typeName === "ZodBranded" || typeName === "ZodReadonly") current = current._def.type;
    else return current;
  }
  return current;
}

function zodValueSchema(schema) {
  const inner = unwrapZodType(schema);
  const typeName = inner?._def?.typeName;
  switch (typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return inner._def.checks?.some((check) => check.kind === "int")
        ? { type: "integer" }
        : { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral":
      return { enum: [inner._def.value] };
    case "ZodEnum":
      return { type: "string", enum: [...inner._def.values] };
    case "ZodNativeEnum":
      return { enum: Object.values(inner._def.values) };
    case "ZodArray":
      return { type: "array", items: zodValueSchema(inner._def.type) };
    case "ZodObject":
      return zodObjectSchema(inner);
    case "ZodRecord":
      return { type: "object" };
    default:

      return {};
  }
}

function zodObjectSchema(objectSchema) {
  const shape = typeof objectSchema._def.shape === "function"
    ? objectSchema._def.shape()
    : objectSchema.shape;
  const properties = {};
  const required = [];
  for (const [key, value] of Object.entries(shape ?? {})) {
    properties[key] = zodValueSchema(value);
    if (typeof value?.isOptional === "function" ? !value.isOptional() : true) required.push(key);
  }
  const schema = { type: "object", properties };
  if (required.length > 0) schema.required = required;

  schema.additionalProperties = false;
  return schema;
}

export function deriveRequestSchema(declaredInput) {
  if (declaredInput === null || declaredInput === undefined) return null;
  const objectSchema = typeof declaredInput?._def?.typeName === "string"
    ? unwrapZodType(declaredInput)
    : zodOwner.object(declaredInput);
  if (objectSchema?._def?.typeName !== "ZodObject") return null;
  return zodObjectSchema(objectSchema);
}

export function recordRegisteredRequestSchema(toolName, declaredInput) {
  if (typeof toolName !== "string" || toolName.length === 0) return;
  const derived = deriveRequestSchema(declaredInput);
  if (derived === null) return;
  registeredRequestSchemas.set(toolName, Object.freeze(derived));
}

export function recordOwnerRegisteredRequestSchema({ registerTool, toolName, declaredInput }) {
  if (typeof registerTool !== "function") {
    throw new TypeError("owner-supplied request-schema registration requires a registerTool function");
  }
  if (typeof toolName !== "string" || toolName.trim().length === 0) {
    throw new TypeError("owner-supplied request-schema registration requires a tool name");
  }
  const declaredObject = declaredInput && typeof declaredInput === "object" &&
    !Array.isArray(declaredInput);
  const declaredZodObject = declaredInput?._def?.typeName === "ZodObject";
  const declaredZodShape = declaredObject && !declaredInput?._def &&
    Object.values(declaredInput).every(
      (value) => typeof value?._def?.typeName === "string"
    );
  if (!declaredZodObject && !declaredZodShape) {
    throw new TypeError(
      `owner-supplied request-schema registration for ${toolName} is malformed`
    );
  }
  let requestSchema;
  try {
    requestSchema = deriveRequestSchema(declaredInput);
  } catch (error) {
    throw new TypeError(
      `owner-supplied request-schema registration for ${toolName} is malformed`,
      { cause: error }
    );
  }
  if (requestSchema === null) {
    throw new TypeError(
      `owner-supplied request-schema registration for ${toolName} is malformed`
    );
  }
  const scope = ownerRequestSchemaScopeForRegistrar(registerTool);
  const prior = scope.entries.get(toolName);
  if (prior !== undefined) {
    if (prior.declaredInput !== declaredInput) {
      throw new TypeError(
        `conflicting owner-supplied request schema registration for ${toolName}`
      );
    }
    return prior.requestSchema;
  }
  const frozenRequestSchema = Object.freeze(requestSchema);
  scope.entries.set(toolName, Object.freeze({ declaredInput, requestSchema: frozenRequestSchema }));
  return frozenRequestSchema;
}

export function requestSchemaAuthorityForRegistration(registerTool) {
  return ownerRequestSchemaScopeForRegistrar(registerTool).authority;
}

export function withRecordedRequestSchemas(registerTool) {
  const scope = ownerRequestSchemaScopeForRegistrar(registerTool);
  const wrapped = (toolName, definition, handler) => {
    recordRegisteredRequestSchema(toolName, definition?.inputSchema);
    return registerTool(toolName, definition, handler);
  };
  ownerRequestSchemaScopesByRegistrar.set(wrapped, scope);
  return wrapped;
}

recordRegisteredRequestSchema(
  "workspace_work_record_ready_slice",
  createReadySliceInputSchema(zodOwner)
);

export function dispatchRequestSchemaAuthority(toolName, ownerAuthority = null) {
  if (ownerAuthority !== null) {
    assertOwnerRequestSchemaAuthority(ownerAuthority);
    const ownerSchema = ownerAuthority.lookup(toolName);
    if (ownerSchema !== undefined) return ownerSchema;
  }
  return registeredRequestSchemas.get(toolName);
}

export function hasRequestSchemaAuthority(toolName, ownerAuthority = null) {
  return dispatchRequestSchemaAuthority(toolName, ownerAuthority) !== undefined;
}

export function buildDispatchContinuation({
  tool,
  arguments: callArguments = undefined,
  successPredicate,
  recommended = true,
  requestSchemaAuthority = null
}) {
  const requestSchema = dispatchRequestSchemaAuthority(tool, requestSchemaAuthority);
  if (requestSchema === undefined) return null;
  return buildContinuationCall({
    tool,
    ...(callArguments === undefined ? {} : { arguments: callArguments }),
    recommended,
    success_predicate: successPredicate
  }, { requestSchema });
}

export function buildDispatchMechanicalRefusal({
  code,
  decidingFacts,
  observedFacts,
  nextCalls = null,
  noSupportedRoute = false,
  recovery,
  route = null,
  carried = null,
  requestSchemaAuthority = null
}) {
  return buildPublicMechanicalRefusal({
    code,
    deciding_facts: decidingFacts,
    ...(nextCalls === null ? {} : { next_calls: nextCalls }),
    ...(noSupportedRoute ? { no_supported_route: true } : {}),
    recovery,
    route,
    ...(carried === null ? {} : { carried }),
    observed_facts: observedFacts,
    request_schemas: (toolName) =>
      dispatchRequestSchemaAuthority(toolName, requestSchemaAuthority)
  });
}

export function registryRecoveryContinuation(code, observedFacts) {
  const recovery = getRuntimeBlockerEntry(code)?.recovery;
  if (!recovery || typeof recovery !== "object" || typeof recovery.route !== "string") return null;
  const bindings = recovery.argument_bindings ?? {};
  const callArguments = { ...(recovery.arguments ?? {}) };
  for (const [argument, fact] of Object.entries(bindings)) {
    if (!observedFacts || !Object.hasOwn(observedFacts, fact)) return null;
    callArguments[argument] = observedFacts[fact];
  }
  const successFact = `${recovery.route}.prerequisite_satisfied`;
  if (!observedFacts || observedFacts[successFact] !== false) return null;
  const call = buildDispatchContinuation({
    tool: recovery.route,
    arguments: callArguments,
    successPredicate: { fact: successFact, operator: "is_true" }
  });
  if (call === null) return null;
  return {
    call,
    prerequisite: recovery.prerequisite ?? recovery.kind ?? "the registered recovery prerequisite is not satisfied",
    successCondition: recovery.success_condition
  };
}

export const NO_SUPPORTED_ROUTE_RECOVERY = Object.freeze({ state: "no_supported_route" });

export function mapBackendRefusalToDispatchCode(code) {
  if (typeof code !== "string") {
    return "launcher_transition.backend_refusal_identity_missing.v1";
  }
  const projected = BACKEND_REFUSAL_TO_DISPATCH_BLOCKER[code];
  if (projected !== undefined) return projected;
  if (isRuntimeBlockerCode(code)) return code;

  const declared = projectPublicBlockerCodeForIdentity(code);
  if (declared !== null) return declared;
  return "launcher_transition.backend_refusal_identity_unknown.v1";
}

export function classifyAgentDispatchSubject(subject) {
  const classified = classifyDispatchSubject(subject);
  if (!classified) {
    return null;
  }
  return DISPATCH_SUBJECT_KIND_TO_ROUTE_KIND[classified.subject_kind] ?? null;
}

export function isAcceptedSubjectForRole(role, subjectKind) {
  if (!subjectKind) return false;
  if (role === "worker" || role === "reviewer") {
    return (
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD ||
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE
    );
  }
  if (role === "redteam") {
    return (
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD ||
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE ||
      subjectKind === AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE
    );
  }
  return false;
}

export async function loadReviewerSubjectAdmissionContext({ dir, unitAddress }) {

  const parts = String(unitAddress).split("#");
  const recordId = parts[0];
  const sliceId = parts.length === 2 ? parts[1] : null;
  let loaded;
  try {
    loaded = await readWorkRecordById({ dir, id: recordId });
  } catch {
    return null;
  }
  if (!loaded || !loaded.record) return null;
  const record = loaded.record;
  const selectedSlice = sliceId && Array.isArray(record.slices)
    ? record.slices.find((entry) => entry && entry.id === sliceId) || null
    : null;
  const selectedUnit = selectedSlice ?? record;
  if (sliceId) {
    if (!selectedSlice) return null;
  }
  const writeScope = Array.isArray(selectedUnit.write_scope) ? selectedUnit.write_scope : [];
  return {
    record_id: recordId,
    slice_id: sliceId,
    title: typeof selectedUnit.title === "string" ? selectedUnit.title : record.title ?? null,
    work_kind: typeof selectedUnit.work_kind === "string" ? selectedUnit.work_kind : record.work_kind ?? null,
    write_scope: writeScope,
    repo_paths: Array.isArray(selectedUnit.repo_paths) ? selectedUnit.repo_paths : [],
    acceptance: selectedUnit.acceptance ?? null
  };
}

export function omitNullFields(obj) {

  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function compactRuntimeBlockerTaxonomy(taxonomy) {

  const dispatchFacing = new Set(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES);
  const allCodes = Array.isArray(taxonomy.codes) ? taxonomy.codes : [];
  const codes = allCodes.filter((entry) => dispatchFacing.has(entry.category));
  const blockingCount = codes.filter((entry) => Boolean(entry.blocking)).length;
  const allCategories = Array.isArray(taxonomy.code_categories) ? taxonomy.code_categories : [];
  const categories = allCategories.filter((category) => dispatchFacing.has(category));
  return {
    schema_version: taxonomy.schema_version,
    verbose: false,
    code_count: codes.length,
    category_count: categories.length,
    blocking_count: blockingCount,
    nonblocking_count: codes.length - blockingCount,
    codes: codes.map((entry) => ({
      code: entry.code,
      category: entry.category,
      blocking: Boolean(entry.blocking),
      summary: entry.summary,
      actor_recovery: entry.actor_recovery ?? null
    }))
  };
}

export function summarizeRunStatusFinalResult(finalResult) {

  const fullResponse =
    finalResult.full_response && typeof finalResult.full_response === "object"
      ? finalResult.full_response
      : null;
  const text = typeof fullResponse?.text === "string" ? fullResponse.text : null;
  const structuredRoleResult = summarizeStructuredRoleResultEvidence(
    finalResult.structured_role_result
  );
  const resultMode = finalResult.result_mode &&
      typeof finalResult.result_mode === "object" &&
      !Array.isArray(finalResult.result_mode) &&
      finalResult.result_mode.schema_version === "workspace-agent-result-mode.v1" &&
      typeof finalResult.result_mode.mode === "string"
    ? {
        schema_version: finalResult.result_mode.schema_version,
        mode: finalResult.result_mode.mode,
        selected_contract: finalResult.result_mode.selected_contract ?? null,
        diagnostic: finalResult.result_mode.diagnostic ?? null,
        authority: "launcher_observation_only",
        prose_authority: "none"
      }
    : null;
  const advisoryReview = summarizeAdvisoryReview(finalResult.advisory_review);
  return {
    kind: finalResult.kind ?? null,
    schema_version: finalResult.schema_version ?? null,
    writeback_kind: finalResult.writeback?.kind ?? null,
    missing_result_code: finalResult.missing_result?.code ?? null,
    full_response_present: Boolean(text),
    full_response_chars: text ? text.length : 0,
    ...(structuredRoleResult?.summary_budget ? {
      managed_result_projection: {
        schema_version: "workspace-agent-managed-result-projection.v1",
        projection_scope: "controlled_managed_result_members",
        source_member_count: 2,
        returned_member_count: 1,
        omitted_member_count: 1,
        omissions: [{
          member: "captured_response",
          reason: "captured_response_omitted_from_compact_mode",
          complete_mode: { include_final_result: true }
        }]
      }
    } : {}),
    ...(resultMode ? { result_mode: resultMode } : {}),
    ...(advisoryReview ? { advisory_review: advisoryReview } : {}),
    ...(structuredRoleResult ? { structured_role_result: structuredRoleResult } : {})
  };
}

function summarizeAdvisoryReview(advisoryReview) {
  if (!advisoryReview || typeof advisoryReview !== "object" || Array.isArray(advisoryReview)) {
    return null;
  }
  const output = advisoryReview.advisory_output;
  const schema = advisoryReview.schema_observation;
  const formalAttestation = advisoryReview.formal_attestation;
  const posture = advisoryReview.automatic_lifecycle_posture;
  if (!output || typeof output !== "object" || !schema || typeof schema !== "object" ||
      !formalAttestation || typeof formalAttestation !== "object" ||
      !posture || typeof posture !== "object") {
    return null;
  }
  return {
    kind: "advisory_review",
    execution_status: advisoryReview.execution_status ?? "unknown",
    advisory_output: {
      available: output.available === true,
      usable: output.usable === true,
      ...(output.available === true ? {
        content_reference: {
          member: "final_result.advisory_review.advisory_output.text",
          complete_mode: { include_final_result: true }
        }
      } : {})
    },
    schema_observation: {
      adherent: schema.adherent === true,
      diagnostic_count: Array.isArray(schema.diagnostics) ? schema.diagnostics.length : 0,
      diagnostic_codes: Array.isArray(schema.diagnostics)
        ? schema.diagnostics.map((entry) => entry?.code)
          .filter((code) => typeof code === "string").slice(0, 20)
        : []
    },
    formal_attestation: {
      requested: formalAttestation.requested === true,
      available: formalAttestation.available === true,
      reason: formalAttestation.reason ?? null,
      ...(formalAttestation.attestation_id ? {
        attestation_id: formalAttestation.attestation_id
      } : {})
    },
    coordinator_guidance: advisoryReview.coordinator_guidance,
    automatic_lifecycle_posture: posture
  };
}

function summarizeStructuredRoleResultEvidence(structuredRoleResult) {
  if (!structuredRoleResult || typeof structuredRoleResult !== "object" || Array.isArray(structuredRoleResult)) {
    return null;
  }
  const diagnostics = Array.isArray(structuredRoleResult.diagnostics)
    ? structuredRoleResult.diagnostics
    : [];
  const diagnosticCodes = diagnostics
    .map((diagnostic) => diagnostic?.code)
    .filter((code) => typeof code === "string" && code.length > 0)
    .slice(0, 20);
  const candidate =
    structuredRoleResult.candidate &&
    typeof structuredRoleResult.candidate === "object" &&
    !Array.isArray(structuredRoleResult.candidate)
      ? structuredRoleResult.candidate
      : null;
  const claims =
    structuredRoleResult.claims &&
    typeof structuredRoleResult.claims === "object" &&
    !Array.isArray(structuredRoleResult.claims)
      ? structuredRoleResult.claims
      : null;
  const findingCounts =
    structuredRoleResult.finding_counts &&
    typeof structuredRoleResult.finding_counts === "object" &&
    !Array.isArray(structuredRoleResult.finding_counts)
      ? structuredRoleResult.finding_counts
      : null;

  return omitNullFields({
    valid: structuredRoleResult.valid === true,
    status: structuredRoleResult.valid === true ? "valid" : "invalid",
    reported_role: typeof claims?.reported_role === "string" ? claims.reported_role : null,
    reported_subject: typeof claims?.reported_subject === "string" ? claims.reported_subject : null,
    reported_outcome: typeof claims?.reported_outcome === "string" ? claims.reported_outcome : null,

    summary_budget:
      structuredRoleResult.valid === true &&
      structuredRoleResult.summary_budget &&
      typeof structuredRoleResult.summary_budget === "object" &&
      !Array.isArray(structuredRoleResult.summary_budget)
        ? structuredRoleResult.summary_budget
        : null,
    total_finding_count: Number.isInteger(findingCounts?.total) ? findingCounts.total : null,
    blocking_finding_count: Number.isInteger(findingCounts?.blocking)
      ? findingCounts.blocking
      : null,
    medium_finding_count: Number.isInteger(findingCounts?.medium) ? findingCounts.medium : null,
    reviewed_control_count: Array.isArray(structuredRoleResult.reviewed_controls)
      ? structuredRoleResult.reviewed_controls.length
      : null,
    diagnostic_count: diagnostics.length,
    diagnostic_codes: diagnosticCodes,
    candidate_kind: typeof candidate?.kind === "string" ? candidate.kind : null,
    candidate_payload_bytes: Number.isInteger(candidate?.payload_bytes)
      ? candidate.payload_bytes
      : null
  });
}

export function compactRunStatusReviewResult(reviewResult) {
  if (!reviewResult || typeof reviewResult !== "object" || Array.isArray(reviewResult)) {
    return null;
  }
  const compact = omitNullFields({
    review_outcome: reviewResult.review_outcome ?? null,
    clean_review: typeof reviewResult.clean_review === "boolean" ? reviewResult.clean_review : null,
    no_findings: typeof reviewResult.no_findings === "boolean" ? reviewResult.no_findings : null,
    blocking_finding_count: Number.isInteger(reviewResult.blocking_finding_count)
      ? reviewResult.blocking_finding_count
      : null,
    medium_finding_count: Number.isInteger(reviewResult.medium_finding_count)
      ? reviewResult.medium_finding_count
      : null
  });
  return Object.keys(compact).length > 0 ? compact : null;
}

function assertRegisteredBlockerCode(blockerCode) {
  if (!isRuntimeBlockerCode(blockerCode)) {
    throw new TypeError(
      `blocked envelope requires a registered runtime blocker code; ${JSON.stringify(blockerCode)} is not in runtime-blocker-codes.v1.json`
    );
  }
  return blockerCode;
}

function canonicalBlockerLimb({ blockerCode, reason, detail, refusal }) {
  return {
    code: refusal ? refusal.code : assertRegisteredBlockerCode(blockerCode),
    reason: reason ?? null,
    detail: detail ?? null
  };
}

function assertTransportableNextCalls(nextCalls, refusal) {
  if (refusal !== null && refusal !== undefined) return;
  if (nextCalls === null || nextCalls === undefined) return;
  const { valid, errors } = validateNextCalls(nextCalls);
  if (!valid) {
    throw new TypeError(`blocked envelope carries invalid next calls: ${errors.join("; ")}`);
  }
}

function canonicalRefusalSlot(refusal) {
  return refusal ? { refusal } : {};
}

function resolveEnvelopeNextAction({ nextAction, nextCalls, refusal }) {
  const supplied = resolveRefusalNextAction({ nextAction, nextCalls });
  if (supplied !== null && supplied !== undefined) return supplied;
  if (refusal && Array.isArray(refusal.next_calls)) {
    return projectNextActionScalar(refusal.next_calls);
  }
  return null;
}

function resolveRefusalNextAction({ nextAction = null, nextCalls = null } = {}) {

  if (Array.isArray(nextCalls)) {
    return projectNextActionScalar(nextCalls);
  }
  return nextAction ?? null;
}

function refusalNextActionSlot(nextAction) {

  return nextAction === null || nextAction === undefined ? {} : { next_action: nextAction };
}

export function buildBlockedDispatchResult({ blockerCode, reason, detail = null, nextAction = null, nextCalls = null, refusal = null }) {
  assertTransportableNextCalls(nextCalls, refusal);
  return {
    schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
    accepted: false,
    blocker: canonicalBlockerLimb({ blockerCode, reason, detail, refusal }),
    transport: "mcp",
    run_id: null,
    monitor_handle: null,
    readiness: null,
    ...canonicalRefusalSlot(refusal),
    ...refusalNextActionSlot(resolveEnvelopeNextAction({ nextAction, nextCalls, refusal }))
  };
}

export function buildBlockedRunStatusResult({ blockerCode, reason, detail = null, nextAction = null, nextCalls = null, refusal = null }) {
  assertTransportableNextCalls(nextCalls, refusal);
  return {
    schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION,
    accepted: false,
    blocker: canonicalBlockerLimb({ blockerCode, reason, detail, refusal }),
    run_id: null,
    status: null,
    ...canonicalRefusalSlot(refusal),
    ...refusalNextActionSlot(resolveEnvelopeNextAction({ nextAction, nextCalls, refusal }))
  };
}

export function buildBlockedRunWaitResult({ blockerCode, reason, detail = null, nextAction = null, nextCalls = null, refusal = null }) {
  assertTransportableNextCalls(nextCalls, refusal);
  return {
    schema_version: AGENT_RUN_WAIT_SCHEMA_VERSION,
    accepted: false,
    blocker: canonicalBlockerLimb({ blockerCode, reason, detail, refusal }),
    run_id: null,
    status: null,
    timed_out: null,
    ...canonicalRefusalSlot(refusal),
    ...refusalNextActionSlot(resolveEnvelopeNextAction({ nextAction, nextCalls, refusal }))
  };
}

export function buildBlockedRunsListResult({
  blockerCode,
  reason,
  detail = null,
  nextAction = null,
  nextCalls = null,
  refusal = null
}) {
  assertTransportableNextCalls(nextCalls, refusal);
  return {
    schema_version: AGENT_RUNS_LIST_SCHEMA_VERSION,
    accepted: false,
    blocker: canonicalBlockerLimb({ blockerCode, reason, detail, refusal }),
    runs: null,
    ...canonicalRefusalSlot(refusal),
    ...refusalNextActionSlot(resolveEnvelopeNextAction({ nextAction, nextCalls, refusal }))
  };
}

export const SLICE_REVIEW_POSTCHECK_FAILED_CODE =
  "agent_launch.slice_review_materialization.postcheck_failed.v1";

export const SAFE_POSTCHECK_MISMATCH_FIELDS = Object.freeze([
  "worktreeIdentityDigest",
  "canonicalWorktreePath",
  "gitDir",
  "commonDirectory",
  "objectDirectory",
  "objectAlternates",
  "targetRegistration",
  "sliceRef",
  "headSymbolicRef",
  "headSha",
  "reviewedSha",
  "reviewedTree",
  "baseSha",
  "baseTree",
  "sequencerState"
]);

const SAFE_POSTCHECK_MISMATCH_FIELD_SET = new Set(SAFE_POSTCHECK_MISMATCH_FIELDS);

export function projectSafePostcheckMismatchField(error) {
  if (error === null || typeof error !== "object") return null;
  if (error.code !== SLICE_REVIEW_POSTCHECK_FAILED_CODE) return null;
  if (!Object.hasOwn(error, "detail")) return null;
  const detail = error.detail;
  if (detail === null || typeof detail !== "object") return null;

  if (Array.isArray(detail)) return null;

  if (Object.getPrototypeOf(detail) !== Object.prototype) return null;

  const keys = Reflect.ownKeys(detail);
  if (keys.length !== 1 || keys[0] !== "field") return null;
  const descriptor = Object.getOwnPropertyDescriptor(detail, "field");

  if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
    return null;
  }
  if (typeof descriptor.value !== "string") return null;

  if (!SAFE_POSTCHECK_MISMATCH_FIELD_SET.has(descriptor.value)) return null;
  return descriptor.value;
}

export function buildDispatchToolExceptionDetail(toolName, error) {
  const diagnostic = projectDiagnostic(error, {
    fieldPrefix: `${toolName}.thrown_diagnostic`
  });

  const mismatchField = projectSafePostcheckMismatchField(error);

  const causeIdentity = isPreservableSemanticIdentity(error?.code) ? error.code : null;
  return {
    tool: toolName,
    error_name: error instanceof Error ? error.name : null,
    error_message: diagnostic.value,
    error_message_redactions: diagnostic.redactions,
    ...(causeIdentity === null ? {} : { cause_code: causeIdentity }),
    ...(mismatchField === null ? {} : { postcheck_mismatch_field: mismatchField })
  };
}

export function resolveMonitorHandleAlwaysUnknown(token) {

  if (typeof token !== "string" || !token.startsWith(AGENT_DISPATCH_MONITOR_HANDLE_PREFIX)) {
    return {
      blocker_code: DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN,
      reason: "monitor_handle_not_minted_by_server"
    };
  }
  return {
    blocker_code: DISPATCH_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN,
    reason: "monitor_handle_unknown_to_server"
  };
}
