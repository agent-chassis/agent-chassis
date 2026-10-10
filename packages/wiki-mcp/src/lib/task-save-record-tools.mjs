import { CREATION_MAINTENANCE_UNIT_PATTERN } from "./record-authoring-maintenance-subject.mjs";

import { RECORD_AUTHORING_LABEL_PATTERN, RECORD_AUTHORING_LABEL_REFERENCE_PATTERN, RECORD_AUTHORING_SLICE_CONTEXT,
  WORK_ITEM_SLICE_CONTRACT_MEMBERS, recordAuthoringChangeSchema, validateRecordAuthoringChanges } from "@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs";
import { saveRecord } from "@agent-chassis/wiki-core/src/operations/save-record.mjs";

import { readRetainedGraphImpact } from "./graph-impact-persistence-tools.mjs";
import { guardToolHandler, jsonContent, measureMcpInlineResultBytes, selectedFullContent } from "./mcp-response.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { resolveContractAssessmentContext } from "./task-assess-contract.mjs";
import { contractAssessmentAuthorityIdentity } from "./controlled-contract-query-context.mjs";
import { parseToolProfile } from "./tool-profile.mjs";
import { selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { SAVE_RECORD_ROUTE } from "./save-record-maintenance.mjs";
import { requestSchema } from "./proof-request-schema.mjs";
import { createSaveRecordMaintenance } from "./save-record-maintenance.mjs";
import { retainedFindingsReferenceResolver } from "./work-record-entry-tools.mjs";
import { selectedResponseDeliveryBound, selectedResponseDetailSchema } from "./selected-response-snapshot.mjs";
import { projectToolInputValidationFailure } from "./register-tool.mjs";
import { REQUIREMENT_GUIDANCE_ENTRY_STATEMENT, REQUIREMENT_VOCABULARY_ENTRY_STATEMENT,
  requirementGuidanceRecoveryCall } from
  "./requirement-authoring-guidance.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";

export const SAVE_RECORD_TOOL_NAME = "save_record";
const STALE_REVISION_CODE = "save_record_revision_stale";
const UNIT_PATTERN = /^(?:WK-[0-9]{4,}(?:#SLICE-[0-9]{3,})?|IN-[0-9]{4}|DEC-[0-9]{4})$/u;
const KIND_BY_PREFIX = Object.freeze({ WK: "work_item", IN: "initiative", DEC: "decision" });

export const saveRecordUnitKind = (unit) => KIND_BY_PREFIX[unit.split("-")[0]];

if (RECORD_AUTHORING_LABEL_REFERENCE_PATTERN !== `^\\$${RECORD_AUTHORING_LABEL_PATTERN.slice(1)}`) {
  throw new Error("save_record label guidance states a reference as $ followed by a label; the owner patterns no longer agree");
}
export const SAVE_RECORD_LABEL_GUIDANCE =
  `A new row's key is a label matching ${RECORD_AUTHORING_LABEL_PATTERN}; other members reference it as $<key> ` +
  "only where a member's declaration takes a label, and it resolves to the row's issued identity, never to its " +
  "text. In slices and ready_slices rows, acceptance.criteria strings are literal text.";

const SAVE_UNIT_VARIANTS = Object.freeze([
  { name: "work_item", kind: "work_item", context: "existing", pattern: /^WK-[0-9]{4,}$/u, unit: "work item",
    advertised: "work_item_slice" },
  { name: "work_item_slice", kind: "work_item", context: RECORD_AUTHORING_SLICE_CONTEXT,
    pattern: /^WK-[0-9]{4,}#SLICE-[0-9]{3,}$/u, unit: "work item slice", advertised: null },
  { name: "initiative", kind: "initiative", context: "existing", pattern: /^IN-[0-9]{4}$/u, unit: "initiative",
    advertised: "initiative" },
  { name: "decision", kind: "decision", context: "existing", pattern: /^DEC-[0-9]{4}$/u, unit: "decision",
    advertised: "decision" }
].map((variant) => Object.freeze(variant)));

export const saveRecordUnitVariant = (unit) => SAVE_UNIT_VARIANTS.find(({ pattern }) => pattern.test(unit));

export function createSaveRecordInputContract(z) {
  const revision = z.string().min(1).describe("The unit's current revision from its read or a prior save.");
  const changeSchemas = Object.freeze(Object.fromEntries(SAVE_UNIT_VARIANTS.map(({ name, kind, context }) =>
    [name, recordAuthoringChangeSchema(kind, context)])));
  const saves = SAVE_UNIT_VARIANTS.map(({ name, pattern, unit }) => z.object({
    unit: z.string().regex(pattern).describe(`An existing ${unit} unit.`),
    revision,
    changes: requestSchema(z, changeSchemas[name], changeSchemas[name].$defs, { memoize: true })
      .refine((changes) => Object.keys(changes).length > 0, "Supply at least one change")
      .describe("Typed changes; omitted members are preserved.")
  }).strict());
  const retry = z.object({ unit: z.string().regex(CREATION_MAINTENANCE_UNIT_PATTERN), maintenance_retry: z.object({
    save_result: selectedResponseDetailSchema(z).shape.source
      .describe("The original save result whose failed or not-run maintenance is retried.")
  }).strict() }).strict();

  const shape = z.union([z.object({ unit: z.string().regex(UNIT_PATTERN), revision,
    changes: z.record(z.unknown()) }).strict(), retry]);

  const advertisedChanges = SAVE_UNIT_VARIANTS.filter(({ advertised }) => advertised !== null).map(({ kind, advertised }) => {
    const declared = changeSchemas[advertised];
    const converted = requestSchema(z, declared, declared.$defs);
    const marked = WORK_ITEM_SLICE_CONTRACT_MEMBERS.filter((member) => declared.properties[member]?.description !== undefined);
    return converted.extend(Object.fromEntries(marked.map((member) =>
      [member, converted.shape[member].describe(declared.properties[member].description)])))
      .describe(`${kind} changes, selected by the unit prefix.`);
  });
  const advertisedInputSchema = z.object({
    unit: retry.shape.unit.describe("WK, WK#SLICE, IN or DEC for changes; any supported creation subject, including SRC or area slug, for authenticated maintenance_retry."),
    revision: revision.optional().describe("Required with changes for a save; omit for maintenance_retry."),
    changes: z.union(advertisedChanges).optional()
      .describe("Nonempty typed changes for the unit's kind. Required with revision; omit for maintenance_retry. " +
        SAVE_RECORD_LABEL_GUIDANCE),
    maintenance_retry: retry.shape.maintenance_retry.optional()
      .describe("Retry only the authenticated original create or save result; omit revision and changes.")
  }).strict().describe("The server enforces exactly one of {unit,revision,changes} or " +
    "{unit,maintenance_retry:{save_result}}. WK, IN and DEC select their respective changes kind; " +
    "the server enforces kind and unit applicability and a nonempty change set before effects.");
  return Object.freeze({ inputSchema: z.union([...saves, retry]), advertisedInputSchema, shape, changeSchemas });
}

const ROW_IDENTITY_EXCLUSION = "key and id are mutually exclusive.";
const sameDeclaration = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function factoredRowIdentity(node, project) {
  const pair = node.anyOf;
  if (Object.keys(node).length !== 1 || !Array.isArray(pair) || pair.length !== 2) return null;
  const [created, existing] = pair;
  if (![created, existing].every((row) => row?.type === "object" && row.additionalProperties === false &&
      row.properties !== undefined && Object.keys(row).every((member) =>
    ["type", "properties", "required", "additionalProperties"].includes(member)))) return null;
  const { key, ...createdMembers } = created.properties;
  const { id, ...existingMembers } = existing.properties;
  if (key === undefined || id === undefined || Object.hasOwn(createdMembers, "id") ||
      Object.hasOwn(existingMembers, "key") || !sameDeclaration(createdMembers, existingMembers)) return null;
  const properties = project({ ...created.properties, id });
  const shared = (created.required ?? []).filter((member) => (existing.required ?? []).includes(member));
  const identity = (row, own, other) => {
    const required = (row.required ?? []).filter((member) => !shared.includes(member));
    return { type: "object",
      properties: Object.fromEntries([...new Set([own, ...required])].map((member) => [member, properties[member]])),
      ...(required.length > 0 ? { required } : {}), not: { required: [other] } };
  };
  return { allOf: [{ type: "object", properties, ...(shared.length > 0 ? { required: shared } : {}),
    additionalProperties: false }, { anyOf: [identity(created, "key", "id"), identity(existing, "id", "key")] }],
  description: ROW_IDENTITY_EXCLUSION };
}

export function factorSaveRecordRowIdentities(schema) {
  if (Array.isArray(schema)) return schema.map(factorSaveRecordRowIdentities);
  if (schema === null || typeof schema !== "object") return schema;
  const factored = factoredRowIdentity(schema, factorSaveRecordRowIdentities);
  if (factored !== null) return factored;
  const projected = Object.fromEntries(Object.entries(schema).map(([member, value]) =>
    [member, factorSaveRecordRowIdentities(value)]));
  if (projected.type === "array" && projected.items?.allOf !== undefined && projected.items.description) {
    projected.description = [projected.description, projected.items.description].filter(Boolean).join(" ");
  }
  return projected;
}

const refusedBody = (unit, diagnostics) => ({ outcome: "refused", unit, diagnostics,
  effects: { published: false, proofs_executed: false, agent_started: false, delivery_integrated: false,
    landing_established: false } });

function requestDiagnostics(error, request) {
  const retry = request !== null && typeof request === "object" && Object.hasOwn(request, "maintenance_retry") &&
    !Object.hasOwn(request, "changes") && !Object.hasOwn(request, "revision");
  const issues = error.issues.flatMap((issue) => issue.unionErrors === undefined ? [issue]
    : issue.unionErrors[retry ? 1 : 0].issues);
  return issues.flatMap(({ path, code, message, keys }) => (keys ?? [null]).map((key) => ({
    code: "save_record_request_invalid", severity: "error",
    path: [...path, ...(key === null ? [] : [key])].join(".") || "$",
    message: key === null ? `${code}: ${message}` : `${key} is not an accepted member of a save_record request` })));
}

function refusalDiagnostics(contract, request, typedError) {
  const shaped = contract.shape.safeParse(request);
  if (!shaped.success) return requestDiagnostics(shaped.error, request);
  const variant = saveRecordUnitVariant(request.unit);
  if (variant === undefined || request.maintenance_retry !== undefined) return typedError.issues.map(({ path, message }) => ({
    code: "save_record_request_invalid", severity: "error", path: path.join(".") || "$", message }));
  const changes = validateRecordAuthoringChanges(variant.kind, variant.context, request.changes);
  return changes.length > 0 ? [...changes] : typedError.issues.map(({ path, code, message }) => ({
    code: "save_record_request_invalid", severity: "error", path: path.join(".") || "$", message: `${code}: ${message}` }));
}

export function createSaveRecordSurface({ workspace, z, responseEnv = process.env, sessionEnv = process.env, generateAndLint,
  assessment = null, resolveRetainedFindingsSource = null, dispatchSessionIdentity = null,
  saveOptions = {}, maintenanceOptions = {} }) {

  const resolveExternalReference = retainedFindingsReferenceResolver(resolveRetainedFindingsSource,
    dispatchSessionIdentity);
  const contract = createSaveRecordInputContract(z);
  const role = parseToolProfile(sessionEnv);
  const authorize = async () => {
    if (role !== "orchestrator" && role !== "operator") throw selectedResponseQueryInvalidError(SAVE_RECORD_ROUTE,
      "save_session_role_not_authorized", { role });
    return (await resolveContractAssessmentContext({ workspace, sessionEnv })).context;
  };
  let sessionContext = null;
  const authorityIdentity = (unit) => ({ ...contractAssessmentAuthorityIdentity(sessionContext, { unit }),
    route: SAVE_RECORD_ROUTE });
  const maintenance = createSaveRecordMaintenance({ workspace, responseEnv, generateAndLint,
    ...maintenanceOptions, authorityIdentity });

  async function save({ unit, revision, changes }) {
    let saved;
    try {

      saved = await saveRecord({ repoRoot: workspace.dir, unit, revision, changes },
        { repository: workspace.repo, requirementGuidanceCall: requirementGuidanceRecoveryCall,
          ...(resolveExternalReference === null ? {} : { resolveExternalReference }),
          resolveRetainedGraphEvidence: source => readRetainedGraphImpact(source, { repository: workspace.repo, responseEnv }),
          ...saveOptions,
          ...(assessment === null ? {} : { assess: async () => {
            const { body } = await assessment.prepare({ unit });
            return { assessment: body.assessment, original: body.original };
          } }) });
    } catch (error) {

      if (error?.save_record === undefined) throw error;
      return { outcome: "failed", ...error.save_record,
        ...(error.save_record.effects?.published === true ? maintenance.receiptUnavailable() : {}),
        cause: { code: error.code ?? null, message: error.message } };
    }
    if (saved.outcome === "refused") return saved;
    if (saved.assessment_carrier?.original !== undefined) saved.assessment_original = saved.assessment_carrier.original;
    const { complete, original } = await maintenance.settleInitial(saved);
    return { ...complete, original };
  }

  async function prepare(request) {
    sessionContext = await authorize();
    const parsed = contract.inputSchema.safeParse(request);
    const unit = typeof request?.unit === "string" ? request.unit : null;
    const preparedBody = !parsed.success
      ? refusedBody(unit, refusalDiagnostics(contract, request, parsed.error))
      : parsed.data.maintenance_retry === undefined ? await save(parsed.data)
        : await maintenance.retry({ unit: parsed.data.unit, saveResult: parsed.data.maintenance_retry.save_result });
    const observation = maintenance.retainObservation(preparedBody);
    const body = { ...preparedBody, observation };

    const source = body.original?.locator ?? body.original_save ?? null;
    const pending = (body.maintenance?.members ?? body.result?.members ?? []).some((entry) => entry.state !== "succeeded") ||
      (body.attempt?.pending?.length ?? 0) > 0;
    const continuations = {
      ...(source !== null && pending ? { maintenance_retry: { unit: body.unit, maintenance_retry: { save_result: source } } } : {}),
      ...(body.retry === undefined ? {} : { maintenance_retry: body.retry }) };
    const bytes = measureMcpInlineResultBytes({ body, continuations });
    const bound = selectedResponseDeliveryBound(responseEnv);
    return { registered: false, body, continuations,
      delivery: { delivered: false, measured_bytes: bytes, bound_bytes: bound, fits: bytes <= bound,
        complete_transport_required: bytes > bound } };
  }

  async function original(source) {
    sessionContext = await authorize();
    return maintenance.readOriginal(source);
  }
  return Object.freeze({ inputContract: contract, prepare, original });
}

export function buildSaveRecordOriginalCall(source) {
  return buildNextCall({ tool: "workspace_read_wiki", arguments: { reference: source }, recommended: true });
}

export function buildSaveRecordUnitReadCall(unit) {
  return buildNextCall({ tool: "workspace_read_wiki", arguments: { subject: unit }, recommended: true });
}
export function buildSaveRecordRetryCall(unit, source) {
  return buildNextCall({ tool: SAVE_RECORD_TOOL_NAME,
    arguments: { unit, maintenance_retry: { save_result: source } }, recommended: true });
}

function compactRetentionFailure(failure) {
  if (failure === undefined) return undefined;
  const { cause, ...identity } = failure;
  const { stack: _stack, envelope, ...facts } = cause;
  const { stack: _causeStack, ...filesystem } = envelope?.cause_diagnostic ?? {};
  return { ...identity, complete: false, omitted_detail: ["stack", "envelope"],
    cause: { ...facts, ...(envelope === undefined ? {} : { cause_diagnostic: filesystem }) } };
}

function proseSaveReceipt(request, body) {
  if (!["saved", "no_op"].includes(body.outcome)) return null;
  const fields = Object.keys(request.changes ?? {});
  if (saveRecordUnitKind(request.unit) !== "work_item" || fields.length === 0 ||
      !fields.every(field => field === "notes" || field === "entries")) return null;
  const { assessment: _assessment, assessment_original: assessmentOriginal, ...receipt } = body;
  return { ...receipt,
    ...(assessmentOriginal?.retention_failure === undefined ? {} : { assessment_original: assessmentOriginal }),
    complete: false, assessment_detail: {
      available: body.assessment != null && (body.observation.available || body.original?.available === true),
      assessed_source: body.assessed_source ?? null
    } };
}

export function createSaveRecordTask(configuration) {
  const { responseEnv = process.env, buildOriginalCall = buildSaveRecordOriginalCall,
    buildRetryCall = buildSaveRecordRetryCall, buildUnitReadCall = buildSaveRecordUnitReadCall,
    requestContracts = null } = configuration;

  const probe = { ref_id: "AAAAAAAA" };
  buildOriginalCall(probe);
  buildRetryCall("WK-0001", probe);
  buildUnitReadCall("WK-0001#SLICE-001");

  async function staleRevisionCalls(body) {
    if (body.outcome !== "refused" || typeof body.unit !== "string" ||
        !body.diagnostics?.some((entry) => entry.code === STALE_REVISION_CODE)) return null;
    const read = buildUnitReadCall(body.unit);
    const served = requestContracts === null ||
      await requestContracts.contractFor(read.tool)?.acceptsArguments(read.arguments) === true;
    return served ? [read] : [];
  }

  async function ownerCorrectionCalls(body) {
    if (body.outcome !== "refused") return [];
    const reads = new Map();
    for (const call of (body.diagnostics ?? []).flatMap((entry) => entry.details?.next_calls ?? [])) {
      const subject = call?.arguments?.subject;
      if (typeof subject !== "string" || Object.keys(call.arguments).length !== 1) continue;
      const read = buildUnitReadCall(subject);
      if (call.tool !== read.tool || reads.has(subject)) continue;
      if (requestContracts === null ||
          await requestContracts.contractFor(read.tool)?.acceptsArguments(read.arguments) === true) reads.set(subject, read);
    }
    return [...reads.values(), ...await ownerGuidanceCalls(body)];
  }

  async function ownerGuidanceCalls(body) {
    const calls = new Map();
    const collect = (value) => {
      if (value === null || typeof value !== "object") return;
      if (!Array.isArray(value) && value.guidance_call !== undefined) {
        calls.set(JSON.stringify(value.guidance_call.arguments), value.guidance_call);
      }
      Object.values(value).forEach(collect);
    };
    collect((body.diagnostics ?? []).map((entry) => entry.details));
    const served = [];
    for (const call of calls.values()) {
      if (requestContracts === null ||
          await requestContracts.contractFor(call.tool)?.acceptsArguments(call.arguments) === true) served.push(call);
    }
    return served;
  }
  const surface = createSaveRecordSurface(configuration);
  async function readOriginal(source) {
    const retained = await surface.original(source);
    return selectedFullContent({ source, retained, member: "carrier" });
  }
  async function handle(request) {
    const { body, continuations } = await surface.prepare(request);
    const refresh = await staleRevisionCalls(body);

    const retained = refresh !== null ? [] : body.observation.available ? [buildOriginalCall(body.observation.locator)]
      : body.original?.available === true ? [buildOriginalCall(body.original.locator)] : [];
    const recovery = [...(refresh ?? await ownerCorrectionCalls(body)),
      ...(continuations.maintenance_retry === undefined ? [] : [buildRetryCall(
        continuations.maintenance_retry.unit, continuations.maintenance_retry.maintenance_retry.save_result)])];
    const prose = proseSaveReceipt(request, body);
    const inlineComplete = prose === null && body.outcome !== "failed";

    const read = body.outcome === "saved" && body.effects?.published === true && typeof body.unit === "string"
      ? buildUnitReadCall(body.unit) : null;
    const current = read !== null && (requestContracts === null ||
      await requestContracts.contractFor(read.tool)?.acceptsArguments(read.arguments) === true) ? read : null;
    const withCurrent = (calls) => {
      if (current === null) return calls;
      const { recommended: _recommended, ...alongside } = current;
      return [...calls, calls.length === 0 ? current : alongside];
    };
    const nextCalls = withCurrent([...retained, ...recovery]);
    const complete = { ...(prose ?? { ...body, complete: true }),
      next_calls: inlineComplete ? withCurrent(recovery) : nextCalls };
    const bound = selectedResponseDeliveryBound(responseEnv);
    if (measureMcpInlineResultBytes(complete) <= bound) return jsonContent(complete, { env: responseEnv });

    const counts = { fields: Object.keys(body).length,
      bindings: Object.values(body.bindings ?? {}).reduce((count, rows) => count + Object.keys(rows).length, 0),
      changed_fields: body.changed_fields?.length ?? 0,
      diagnostics: body.diagnostics?.length ?? 0,
      maintenance_members: body.maintenance?.members?.length ?? body.result?.members?.length ?? 0 };
    const summary = { outcome: body.outcome, unit: body.unit, revision: body.revision ?? null,
      complete: false, populations: counts, original: body.original, observation: body.observation,
      effects: { published: body.effects?.published ?? false,
        canonical_mutation_repeated: body.effects?.canonical_mutation_repeated ?? false,
        proofs_executed: false, agent_started: false, delivery_integrated: false, landing_established: false },
      next_calls: nextCalls };
    if (prose !== null) {

      summary.effects = body.effects;
      for (const field of ["changed_fields", "maintenance", "diagnostics", "persistence",
        "assessment_unavailable", "assessment_original", "assessment_detail"]) {
        if (prose[field] !== undefined) summary[field] = prose[field];
      }
    }
    if (!body.observation.available) {
      summary.complete_detail = { available: false, reason: "save_observation_unavailable",
        original_scope: body.original?.available === true ? "save_facts_before_maintenance" : null };
      summary.effects = body.effects;
      for (const field of ["original", "observation", "assessment_original"]) {
        if (summary[field]?.retention_failure !== undefined) summary[field] = { ...summary[field],
          retention_failure: compactRetentionFailure(summary[field].retention_failure) };
      }
      const maintenance = body.maintenance ?? body.result;
      if (maintenance !== undefined) {
        const { members, checked_source: _checked, ...state } = maintenance;
        summary.maintenance = { ...state, members: prose === null
          ? members.map(({ member, state }) => ({ member, state })) : members };
        if (state.outcome_retention_failure !== undefined) summary.maintenance.outcome_retention_failure =
          compactRetentionFailure(state.outcome_retention_failure);
      }
      if (body.attempt !== undefined) summary.attempt = body.attempt;
      if (body.cause !== undefined) summary.cause = body.cause;
    }
    return jsonContent(summary, { env: responseEnv });
  }
  return Object.freeze({ inputContract: surface.inputContract, handle, readOriginal });
}

export function registerSaveRecordTools({ registerTool, ...configuration }) {
  const requestContracts = registeredToolRequestContracts(registerTool);
  const task = createSaveRecordTask({ ...configuration, requestContracts });
  registerTool(SAVE_RECORD_TOOL_NAME, { description: "Save one coherent authored change to an existing unit and complete its required maintenance. Retry names an immutable save result and repeats no canonical mutation. " +
    `Before authoring requirements, obligations or test cases, read their vocabulary and authoring guidance: ${REQUIREMENT_GUIDANCE_ENTRY_STATEMENT}. ` +
    `For the accepted terms of a requirement, read: ${REQUIREMENT_VOCABULARY_ENTRY_STATEMENT}.`,
    inputSchema: task.inputContract.inputSchema,
    advertisedInputSchema: task.inputContract.advertisedInputSchema,
    publishedInputSchemaProjection: factorSaveRecordRowIdentities, writeSemantics: "none",
    inputValidationErrorProjector: async ({ args, validationError }) => {
      const retry = args !== null && typeof args === "object" && Object.hasOwn(args, "maintenance_retry") &&
        !Object.hasOwn(args, "changes") && !Object.hasOwn(args, "revision");
      const shaped = task.inputContract.shape.options[retry ? 1 : 0].safeParse(args);
      const variant = shaped.success && !retry ? saveRecordUnitVariant(args.unit) : undefined;
      const ownerDiagnostics = variant === undefined ? null
        : validateRecordAuthoringChanges(variant.kind, variant.context, args.changes);
      return { terminal_result: { ...jsonContent(await projectToolInputValidationFailure({
        tool: SAVE_RECORD_TOOL_NAME, args,
        validationError: shaped.success ? validationError : shaped.error,
        ownerDiagnostics: ownerDiagnostics?.length > 0 ? ownerDiagnostics : null,
        requestContract: requestContracts.contractFor(SAVE_RECORD_TOOL_NAME)
      }), { env: configuration.responseEnv ?? process.env }), isError: true } };
    } },
  guardToolHandler(task.handle, { env: configuration.responseEnv ?? process.env }));
  return task;
}
