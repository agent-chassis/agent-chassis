import { DEFAULT_EXCEPTION_PUBLICATION } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { sessionAuthoringSchema, sessionAuthoringDescription } from "./record-authoring-session-exposure.mjs";
import { recordAuthoringAvailability } from "@agent-chassis/wiki-core/src/lib/record-authoring-availability.mjs";
import { CREATION_MAINTENANCE_UNIT_PATTERN } from "./record-authoring-maintenance-subject.mjs";

import { RECORD_AUTHORING_LABEL_PATTERN, RECORD_AUTHORING_LABEL_REFERENCE_PATTERN, RECORD_AUTHORING_SLICE_CONTEXT,
  WORK_ITEM_SLICE_CONTRACT_MEMBERS, recordAuthoringChangeSchema, recordAuthoringIssueByMemberPath, validateRecordAuthoringChanges } from "@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs";
import { RECORD_AUTHORING_EXCEPTION_SCHEMA, retiredExceptionMemberPaths, validateRecordAuthoringException } from
  "@agent-chassis/wiki-core/src/lib/record-authoring-exception.mjs";
import { saveRecord } from "@agent-chassis/wiki-core/src/operations/save-record.mjs";
import { REQUIREMENT_BATCH_CODES } from "@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-projection.mjs";
import { validateSaveRecordScopes } from "@agent-chassis/agent-launch-cli/src/lib/save-record-scope-validation.mjs";

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
import { createSaveRecordInputExposure } from "./save-record-input-exposure.mjs";
import { compactInputSchemaAdvertisement, isScalarMemberDeclaration } from "./input-schema-exposure.mjs";
import { createSaveRecordInputNavigation } from "./save-record-input-navigation.mjs";
import { projectSaveRecordResponse, saveRecordFailureMeaning } from "./save-record-response.mjs";
import { proofRefreshRecovery } from "@agent-chassis/wiki-core/src/lib/proof-refresh-guidance.mjs";
import { createMutationRecovery, mutationRecoverySchema } from './record-mutation-recovery.mjs';

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

export const SAVE_RECORD_MEMBER_CONTRACT_GUIDANCE =
  "changes lists every member. For untyped members' full schemas, use saved record context choices or its " +
  "reference with select " +
  '{"input_contract":{"tool":"save_record","members":[...]}} for all needed members at once. ' +
  "Read schemas stay valid after saves; reading is optional.";

export const SAVE_RECORD_EXCEPTION_SELECTION = '{"input_contract":{"tool":"save_record","operation":"exception"}}';
export const SAVE_RECORD_EXCEPTION_ENTRY_GUIDANCE =
  `A deliberate exception, sent alone. Contract: select ${SAVE_RECORD_EXCEPTION_SELECTION}`;
const EXCEPTION_UNIT_PATTERN = /^WK-[0-9]{4,}(?:#SLICE-[0-9]{3,})?$/u;

const SHAPE_VARIANTS = Object.freeze(["save", "retry", "exception", "observe", "recover"]);
function saveRecordRequestVariant(request) {
  const has = (key) => request !== null && typeof request === "object" && Object.hasOwn(request, key);
  if (has('recover')) return 'recover';
  if (has('maintenance_observe')) return 'observe';
  if (has("maintenance_retry") && !has("changes") && !has("revision") && !has("exception")) return "retry";
  return has("exception") && !has("changes") ? "exception" : "save";
}

const SAVE_UNIT_VARIANTS = Object.freeze([
  { name: "work_item", kind: "work_item", context: "existing", pattern: /^WK-[0-9]{4,}$/u, unit: "work item",
    advertised: "work_item" },
  { name: "work_item_slice", kind: "work_item", context: RECORD_AUTHORING_SLICE_CONTEXT,
    pattern: /^WK-[0-9]{4,}#SLICE-[0-9]{3,}$/u, unit: "work item slice", advertised: "work_item_slice" },
  { name: "initiative", kind: "initiative", context: "existing", pattern: /^IN-[0-9]{4}$/u, unit: "initiative",
    advertised: "initiative" },
  { name: "decision", kind: "decision", context: "existing", pattern: /^DEC-[0-9]{4}$/u, unit: "decision",
    advertised: "decision" }
].map((variant) => Object.freeze(variant)));

export const saveRecordUnitVariant = (unit) => SAVE_UNIT_VARIANTS.find(({ pattern }) => pattern.test(unit));

export function createSaveRecordInputContract(z, registeredTier = null) {
  const revision = z.string().min(1).describe("The unit's current revision from its read or a prior save.");
  const changeSchemas = Object.freeze(Object.fromEntries(SAVE_UNIT_VARIANTS.map(({ name, kind, context }) =>
    [name, recordAuthoringChangeSchema(kind, context)])));
  const saves = SAVE_UNIT_VARIANTS.map(({ name, pattern, unit }) => z.object({
    unit: z.string().regex(pattern).describe(`An existing ${unit} unit.`),
    revision,
    changes: requestSchema(z, changeSchemas[name], changeSchemas[name].$defs, { memoize: true })
      .refine((changes) => Object.keys(changes).length > 0, "Supply at least one change")
      .refine(changes => !Object.hasOwn(changes, 'refresh_proofs') || Object.keys(changes).length === 1,
        'Refresh must be the only change')
      .describe("Typed changes; omitted members are preserved.")
  }).strict());
  const retry = z.object({ unit: z.string().regex(CREATION_MAINTENANCE_UNIT_PATTERN), maintenance_retry: z.object({
    save_result: selectedResponseDetailSchema(z).shape.source
      .describe("The original save result whose failed or not-run maintenance is retried.")
  }).strict() }).strict();
  const observe = z.object({ unit: retry.shape.unit, maintenance_observe: retry.shape.maintenance_retry }).strict();
  const recover = z.object({ recover: mutationRecoverySchema(z) }).strict();

  const exception = z.object({
    unit: z.string().regex(EXCEPTION_UNIT_PATTERN).describe("An existing work item or work item slice unit."),
    revision,
    exception: requestSchema(z, RECORD_AUTHORING_EXCEPTION_SCHEMA, undefined)
      .describe(RECORD_AUTHORING_EXCEPTION_SCHEMA.description)
  }).strict();

  const shape = z.union([z.object({ unit: z.string().regex(UNIT_PATTERN), revision,
    changes: z.record(z.unknown()) }).strict(), retry,
  z.object({ unit: z.string().regex(UNIT_PATTERN), revision, exception: z.unknown() }).strict(), observe, recover]);

  const advertisedChanges = SAVE_UNIT_VARIANTS.filter(({ advertised }) => advertised !== null).map(({ kind, advertised }) => {
    const declared = changeSchemas[advertised];
    const converted = requestSchema(z, declared, declared.$defs, { memoize: true });
    const marked = WORK_ITEM_SLICE_CONTRACT_MEMBERS.filter((member) => declared.properties[member]?.description !== undefined);
    return converted.extend(Object.fromEntries(marked.map((member) =>
      [member, converted.shape[member].describe(declared.properties[member].description)])))
      .describe(`${advertised} changes, selected by the unit address.`);
  });
  const advertisedInputSchema = z.object({
    unit: retry.shape.unit.optional().describe("WK, WK#SLICE, IN or DEC for changes; any supported creation subject for authenticated maintenance retry/observation. Omit only for recover."),

    revision: revision.optional().describe("The unit's current revision."),
    changes: z.union(advertisedChanges).optional()
      .describe("Nonempty typed changes for the unit's kind. " + SAVE_RECORD_LABEL_GUIDANCE),

    exception: z.unknown().optional().describe(SAVE_RECORD_EXCEPTION_ENTRY_GUIDANCE),
    maintenance_retry: retry.shape.maintenance_retry.optional()
      .describe("Retry only the authenticated original create or save result."),
    maintenance_observe: observe.shape.maintenance_observe.optional().describe('Observe current maintenance of this original without checks or writes.'),
    recover: recover.shape.recover.optional()
  }).strict().describe("The server enforces exactly one of {unit,revision,changes}, {unit,revision,exception} or " +
    "{unit,maintenance_retry:{save_result}}, {unit,maintenance_observe:{save_result}} or {recover:{request:<exact original save request>}}. The server enforces kind and unit applicability. Recovery and observation execute no mutation or checks.");

  const compactChanges = SAVE_UNIT_VARIANTS.filter(({ advertised }) => advertised !== null).map(({ advertised }) => {
    const compact = compactInputSchemaAdvertisement(sessionAuthoringSchema(changeSchemas[advertised], registeredTier));

    return { ...compact, properties: Object.fromEntries(Object.entries(compact.properties).map(([member, node]) =>
      [member, isScalarMemberDeclaration(node) || WORK_ITEM_SLICE_CONTRACT_MEMBERS.includes(member) ? node
        : member === 'ready_slices' ? { description: "Select this member's full input_contract schema." } : {}])),
    description: `${advertised} changes, selected by the unit address.` };
  });
  const publishedInputSchemaProjection = (converted) => {
    const { anyOf: typed, ...declared } = converted?.properties?.changes ?? {};
    if (!Array.isArray(typed) || typed.length !== compactChanges.length) {
      throw new TypeError("save_record publication: the converted request no longer declares one changes alternative per published variant");
    }
    return { ...converted, properties: { ...converted.properties, changes: { anyOf: compactChanges, ...declared } } };
  };
  return Object.freeze({ inputSchema: z.union([...saves, retry, exception, observe, recover]), mutationSchema: z.union([...saves, exception]), advertisedInputSchema, shape, changeSchemas,
    exceptionSchema: RECORD_AUTHORING_EXCEPTION_SCHEMA, publishedInputSchemaProjection });
}

const refusedBody = (unit, diagnostics) => ({ outcome: "refused", unit, diagnostics,
  effects: { published: false, proofs_executed: false, agent_started: false, delivery_integrated: false,
    landing_established: false } });

function requestDiagnostics(error, request) {
  const selected = SHAPE_VARIANTS.indexOf(saveRecordRequestVariant(request));
  const issues = error.issues.flatMap((issue) => issue.unionErrors === undefined ? [issue]
    : issue.unionErrors[selected].issues);
  return issues.flatMap(({ path, code, message, keys }) => (keys ?? [null]).map((key) => ({
    code: "save_record_request_invalid", severity: "error",
    path: [...path, ...(key === null ? [] : [key])].join(".") || "$",
    message: key === null ? `${code}: ${message}` : `${key} is not an accepted member of a save_record request` })));
}

function refusalDiagnostics(contract, request, typedError) {
  const shaped = contract.shape.safeParse(request);
  if (!shaped.success) return requestDiagnostics(shaped.error, request);

  if (Object.hasOwn(request, "exception")) {
    const issues = validateRecordAuthoringException(request.exception);
    return issues.length > 0 ? [...issues] : typedError.issues.map(({ path, message }) => ({
      code: "save_record_request_invalid", severity: "error", path: path.join(".") || "$",
      message: EXCEPTION_UNIT_PATTERN.test(request.unit) ? message
        : "an exception is recorded on a work item or one of its slices; this unit takes none" }));
  }
  const variant = saveRecordUnitVariant(request.unit);
  if (variant === undefined || request.maintenance_retry !== undefined) return typedError.issues.map(({ path, message }) => ({
    code: "save_record_request_invalid", severity: "error", path: path.join(".") || "$", message }));
  const changes = validateRecordAuthoringChanges(variant.kind, variant.context, request.changes);
  return changes.length > 0 ? [...changes] : typedError.issues.map(({ path, code, message }) => ({
    code: "save_record_request_invalid", severity: "error", path: path.join(".") || "$", message: `${code}: ${message}` }));
}

export function createSaveRecordSurface({ workspace, z, responseEnv = process.env, sessionEnv = process.env, generateAndLint,
  assessment = null, resolveRetainedFindingsSource = null, dispatchSessionIdentity = null,
  registeredTier = null, exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION, saveOptions = {}, maintenanceOptions = {} }) {

  const resolveExternalReference = retainedFindingsReferenceResolver(resolveRetainedFindingsSource,
    dispatchSessionIdentity);
  const contract = createSaveRecordInputContract(z, registeredTier);
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
  const recovery = createMutationRecovery({ route: SAVE_RECORD_ROUTE, workspace, responseEnv, authorityIdentity });

  async function save(request, onProgress) {
    const { unit, revision, changes, exception } = request;
    let saved;
    try {

      saved = await saveRecord({ repoRoot: workspace.dir, unit, revision, changes, exception },
        { repository: workspace.repo, validateScopes: validateSaveRecordScopes,
          requirementGuidanceCall: path => requirementGuidanceRecoveryCall(path, registeredTier, exceptionPublication),
          ...(resolveExternalReference === null ? {} : { resolveExternalReference }),
          resolveRetainedGraphEvidence: source => readRetainedGraphImpact(source, { repository: workspace.repo, responseEnv }),
          ...saveOptions, registeredTier,
          ...(assessment === null ? {} : { assess: async () => {
            const { body } = await assessment.prepare({ unit });
            return { assessment: body.assessment, original: body.original };
          } }) });
    } catch (error) {

      if (error?.save_record === undefined) throw error;
      saved = { outcome: "failed", ...error.save_record, kind: saveRecordUnitKind(unit),
        cause: { code: error.code ?? null, message: error.message } };
    }
    if (saved.outcome === "refused") return saved;
    if (saved.assessment_carrier?.original !== undefined) saved.assessment_original = saved.assessment_carrier.original;
    saved = { ...saved, mutation_request: request };
    if (saved.outcome === 'failed' && saved.kind === undefined) return saved;
    const { complete, original } = await maintenance.settleInitial(saved, null, onProgress);
    return { ...complete, original };
  }

  async function prepare(request) {
    sessionContext = await authorize();
    const parsed = contract.inputSchema.safeParse(request);
    if (parsed.success && parsed.data.recover !== undefined) {
      const original = contract.mutationSchema.safeParse(parsed.data.recover.request);
      if (!original.success) return { body: { outcome: 'mutation_outcome_unavailable',
        cause: { code: 'mutation_recovery_request_invalid', message: 'Recovery requires the exact original valid save request.' },
        diagnostics: refusalDiagnostics(contract, parsed.data.recover.request, original.error).map(diagnostic => ({
          ...diagnostic, path: `recover.request.${diagnostic.path}` })),
        recovery: { correction: 'Supply the exact request that was submitted. This read does not execute it; changing authored values just to obtain a match cannot recover the original operation.' },
        effects: { published: 'unknown' } }, continuations: {} };
      const recovered = recovery.observe(original.data, parsed.data.recover.unit);
      return { ...recovered, body: await maintenance.observeBody(recovered.body), continuations: {} };
    }
    if (parsed.success && parsed.data.maintenance_observe !== undefined) return {
      body: await maintenance.observe({ unit: parsed.data.unit, saveResult: parsed.data.maintenance_observe.save_result }), continuations: {} };
    const unit = typeof request?.unit === "string" ? request.unit : null;
    const tracked = parsed.success && parsed.data.maintenance_retry === undefined ? recovery.start(parsed.data) : null;
    const preparedBody = !parsed.success
      ? refusedBody(unit, refusalDiagnostics(contract, request, parsed.error))
      : parsed.data.maintenance_retry === undefined ? await save(parsed.data, tracked.record)
        : await maintenance.retry({ unit: parsed.data.unit, saveResult: parsed.data.maintenance_retry.save_result });
    const observation = maintenance.retainObservation(preparedBody);
    const body = { ...preparedBody, observation };
    tracked?.record(body);

    const source = body.original?.locator ?? body.original_save ?? null;
    const pending = (body.maintenance?.members ?? body.result?.members ?? []).some((entry) => entry.state !== "succeeded") ||
      (body.attempt?.pending?.length ?? 0) > 0;
    const continuations = {
      ...(source !== null && pending ? { maintenance_retry: { unit: body.unit, maintenance_retry: { save_result: source } } } : {}),
      ...(body.retry === undefined ? {} : { maintenance_retry: body.retry }) };
    const bytes = measureMcpInlineResultBytes({ body, continuations });
    const bound = selectedResponseDeliveryBound(responseEnv);
    return { registered: false, body, continuations, source: tracked?.retained, read: tracked?.read,
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

export function createSaveRecordTask(configuration) {
  const { responseEnv = process.env, buildOriginalCall = buildSaveRecordOriginalCall,
    buildRetryCall = buildSaveRecordRetryCall, buildUnitReadCall = buildSaveRecordUnitReadCall,
    requestContracts = null, acquireSavedUnitReference = null } = configuration;

  const navigation = createSaveRecordInputNavigation({ requestContracts, saveTool: SAVE_RECORD_TOOL_NAME,
    readTool: buildUnitReadCall("WK-0001").tool, variantOf: saveRecordUnitVariant, exceptionPublication: configuration.exceptionPublication });

  const schemaGuidance = async (request) => {
    if (request?.maintenance_retry !== undefined) return null;
    if (request?.exception?.kind === "grammar" && !recordAuthoringAvailability(configuration.registeredTier).grammar_exception) return null;
    if (Object.hasOwn(request?.changes ?? {}, 'refresh_proofs') &&
        /^WK-[0-9]{4,}#SLICE-[0-9]{3,}$/u.test(request?.unit)) {
      const recovery = proofRefreshRecovery(request.unit);
      const call = buildUnitReadCall(recovery.read.arguments.subject);
      const served = requestContracts === null ||
        await requestContracts.contractFor(call.tool)?.acceptsArguments(call.arguments) === true;
      return { calls: served ? [call] : [], refresh_boundary: 'root_wk_only',
        then: recovery.then };
    }
    if (saveRecordRequestVariant(request) === "exception") {
      return navigation.exceptionGuidance({ unit: request?.unit, acquire: acquireSavedUnitReference, kind: request?.exception?.kind === "controlled_acceptance" ? "controlled_acceptance" : null });
    }
    const guidance = await navigation.refusalGuidance({ unit: request?.unit, changes: request?.changes,
      acquire: acquireSavedUnitReference });
    const retired = retiredExceptionMemberPaths(request?.changes);
    if (retired.length === 0) return guidance;
    const exception = await navigation.exceptionGuidance({ unit: request?.unit, acquire: acquireSavedUnitReference });
    return { ...(guidance ?? {}), calls: [...(guidance?.calls ?? []), ...(exception?.calls ?? [])],
      exception_contract: { not_accepted_members: retired,
        statement: "No member of changes records an exception. An exception is a separate, deliberate request " +
          "{unit, revision, exception}; nothing here proposes one or supplies its reason.",
        selection: SAVE_RECORD_EXCEPTION_SELECTION,
        ...(exception?.unavailable === undefined ? {} : { unavailable: exception.unavailable }) } };
  };

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

  async function ownerCorrectionCalls(body, selectedReads = []) {
    if (body.outcome !== "refused") return [];
    const reads = new Map();
    for (const call of (body.diagnostics ?? []).flatMap((entry) => [
      ...(entry.details?.next_calls ?? []), ...(entry.details?.refresh_recovery?.read ? [entry.details.refresh_recovery.read] : [])])) {
      const subject = call?.arguments?.subject;
      if (typeof subject !== "string" || Object.keys(call.arguments).length !== 1) continue;
      const read = buildUnitReadCall(subject);
      if (call.tool !== read.tool || reads.has(subject)) continue;
      if (requestContracts === null ||
          await requestContracts.contractFor(read.tool)?.acceptsArguments(read.arguments) === true) reads.set(subject, read);
    }
    return [...selectedReads, ...reads.values(), ...await ownerGuidanceCalls(body)];
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

  async function requirementIdentityRecovery(body) {
    const unitRead = buildUnitReadCall(body.unit);
    if (typeof acquireSavedUnitReference !== 'function') return null;
    const acquired = await acquireSavedUnitReference(body.unit);
    const call = buildNextCall({ tool: unitRead.tool, arguments: { reference: acquired.reference,
      select: { contract: 'requirements', view: 'identities' } } });
    return await served(call) ? { ...call, purpose: 'requirement_identities', recommended: true } : null;
  }
  const served = async call => requestContracts === null ||
    await requestContracts.contractFor(call.tool)?.acceptsArguments(call.arguments) === true;
  const surface = createSaveRecordSurface(configuration);
  async function hydrateMaintenanceOutcome(body) {
    if (!['joined_attempt', 'no_retry_needed'].includes(body.outcome)) return body;
    if (body.result !== undefined) return body;
    if (body.attempt?.outcome == null) return { ...body,
      cause: { code: 'save_record_maintenance_outcome_unavailable', message: 'The completed maintenance attempt has no readable retained outcome.' },
      recovery: { missing_capability: 'retained_maintenance_outcome',
        correction: 'Stop this outcome inspection. Do not repeat the canonical save or rerun checks to discover the completed result.' } };
    try {
      const retained = await surface.original(body.attempt.outcome);
      return { ...body, result: retained.carrier };
    } catch (error) {
      return { ...body, cause: { code: error.code, message: error.message }, recovery: {
        missing_capability: 'retained_maintenance_outcome',
        correction: 'The completed maintenance outcome cannot be read. Do not repeat the canonical save or rerun checks to discover that outcome.' } };
    }
  }
  async function retryCalls(body, continuations = {}) {
    const source = body.original?.locator ?? body.original_save;
    if (body.outcome === 'maintenance_attempt_in_progress' || body.maintenance?.state === 'maintenance_attempt_in_progress') {
      if (source === undefined) return [];
      const call = { tool: SAVE_RECORD_TOOL_NAME, arguments: { unit: body.unit,
        maintenance_observe: { save_result: source } }, recommended: true };
      return await served(call) ? [call] : [];
    }
    const failures = projectSaveRecordResponse(body).maintenance?.failures ?? [];
    if (failures.some(member => member.unavailable !== undefined && member.state !== 'succeeded')) return [];
    if ((body.maintenance?.coordination ?? body.coordination)?.stage === 'settled_attempt' &&
        projectSaveRecordResponse(body).maintenance === undefined) return [];
    const pending = (body.maintenance?.members ?? body.result?.members ?? body.members ?? [])
      .some(member => member.state !== 'succeeded');
    if (!pending && failures.some(member => member.unavailable !== undefined)) return [];
    const retry = continuations.maintenance_retry ?? body.retry ??
      (source !== undefined && pending ? { unit: body.unit, maintenance_retry: { save_result: source } } : null);
    if (retry === null || ['maintenance_outcome_unavailable'].includes(projectSaveRecordResponse(body).outcome)) return [];
    const call = { ...buildRetryCall(retry.unit, retry.maintenance_retry.save_result),
      prerequisite: 'Correct the reported maintenance cause before retrying; this call repeats no canonical mutation.' };
    return await served(call) ? [call] : [];
  }
  async function readOriginal(source) {
    const retained = await surface.original(source);
    const body = await hydrateMaintenanceOutcome(retained.carrier);
    const projection = projectSaveRecordResponse(body);
    projection.next_calls = await retryCalls(body);
    return selectedFullContent({ source, retained, projection });
  }
  async function handle(request) {
    let prepared;
    try {
      prepared = await surface.prepare(request);
    } catch (error) {
      if (request.maintenance_retry === undefined && request.maintenance_observe === undefined) throw error;
      const reason = error.envelope?.deciding_facts?.find(fact => fact.field === 'selected_response.invalid_reason')?.value;

      return { ...jsonContent({ outcome: 'failed', unit: request.unit,
        cause: { code: error.code ?? error.envelope?.code, message: error.message,
          ...(reason === undefined ? {} : { reason }),
          ...(error.details === undefined ? {} : { details: saveRecordFailureMeaning(
            Object.fromEntries(Object.entries(error.details).filter(([key]) => !['actor', 'action'].includes(key)))) }) },
        effects: { canonical_mutation_repeated: false,
          checks_ran: request.maintenance_observe !== undefined || reason !== undefined || error.execution_not_started === true ? false : 'unknown' },
        recovery: reason === undefined ? { missing_capability: 'maintenance_outcome_reconciliation',
          correction: 'The maintenance owner could not establish this retry outcome. Do not repeat the canonical save or retry unchanged to discover the outcome.' }
          : { missing_capability: 'authenticated_maintenance_original',
            correction: 'Use only the issued original save reference for this unit, if held. Otherwise stop this maintenance recovery; do not substitute a foreign reference or repeat the canonical save.' },
        next_calls: [] }, { env: responseEnv }), isError: true };
    }
    const body = await hydrateMaintenanceOutcome(prepared.body);
    const response = projectSaveRecordResponse(body);
    const calls = [...(body.next_calls ?? [])];

    try {
      const refresh = await staleRevisionCalls(body);
      if (refresh !== null) {
        calls.push(...refresh);
        if (refresh.length === 0) response.recovery = {
          missing_capability: 'same_unit_current_read',
          correction: 'No granted current read of this unit is served. Stop the dependent write; do not replay using the refusal revision.' };
      } else if (body.outcome === 'refused') {

        const unknownRow = body.diagnostics?.some(diagnostic => diagnostic.code === REQUIREMENT_BATCH_CODES.ROW_UNKNOWN);
        const identities = unknownRow ? await requirementIdentityRecovery(body) : null;
        calls.push(...await ownerCorrectionCalls(body, identities === null ? [] : [identities]));
      }
      calls.push(...await retryCalls(body, prepared.continuations));
      if (body.outcome === 'failed' && body.effects?.published !== false && typeof body.unit === 'string') {
        const read = buildUnitReadCall(body.unit);
        if (await served(read)) calls.push(read);
      }

      const historical = body.observation?.available ? body.observation.locator : body.original?.locator;
      if ((response.bindings !== undefined || response.exception !== undefined || response.persistence !== undefined ||
          body.outcome === 'failed') && historical != null) {
        const read = { ...buildOriginalCall(historical), recommended: false, purpose: 'saved_outcome' };
        if (await served(read)) calls.push(read);
      }
    } catch (error) {
      response.navigation_failure = { code: error.code ?? 'save_record_navigation_failed', message: error.message,
        correction: 'The save outcome above stands. Continuation discovery failed; do not repeat the mutation to recover navigation.' };
    }
    if (response.maintenance !== undefined && !calls.some(call => call.tool === SAVE_RECORD_TOOL_NAME) &&
        body.original?.available === false) response.recovery = {
      missing_capability: 'authenticated_maintenance_original',
      correction: 'The save stands, but its original receipt is unavailable. Maintenance-only retry cannot address this save; do not repeat the mutation.' };
    if (body.outcome === 'maintenance_attempt_in_progress' || body.maintenance?.state === 'maintenance_attempt_in_progress') {
      response.recovery = { correction: 'Completion is not yet recorded. Follow maintenance_observe after progress; do not repeat the save or rerun checks to discover the outcome.' };
    }
    if (request.recover !== undefined && body.outcome === 'mutation_outcome_unknown') calls.push({ tool: SAVE_RECORD_TOOL_NAME,
      arguments: request, recommended: true });
    response.next_calls = calls;
    if (measureMcpInlineResultBytes(response) <= selectedResponseDeliveryBound(responseEnv)) {
      return jsonContent(response, { env: responseEnv });
    }

    const source = prepared.source ?? (body.observation?.available ? body.observation.locator : body.original?.locator);
    if (source != null) {
      try {
        return selectedFullContent({ source, retained: prepared.retained ?? (prepared.read ? prepared.read() : await surface.original(source)), projection: response });
      } catch (error) {
        response.delivery_failure = { code: error.code, message: error.message };
      }
    }

    return jsonContent({ outcome: response.outcome, unit: response.unit, revision: response.revision,
      effects: response.effects ?? { published: body.effects?.published ?? 'unknown' },
      ...(response.diagnostics === undefined ? {} : { diagnostics: response.diagnostics.map(({ code, path, message, correction }) => ({ code, path, message, correction })) }),
      ...(response.cause === undefined ? {} : { cause: response.cause }),
      ...(response.maintenance === undefined ? {} : { maintenance: response.maintenance }),
      recovery: { missing_capability: 'authenticated_complete_save_delivery',
        correction: 'The reported save outcome and diagnostics stand, but complete identities or diagnostic detail could not be retained or delivered. Stop work that needs the unavailable detail; do not repeat the mutation or reconstruct mappings.' },
      ...(response.delivery_failure === undefined ? {} : { delivery_failure: response.delivery_failure }),
      next_calls: calls.filter(call => call.arguments.subject !== undefined) }, { env: responseEnv });
  }
  return Object.freeze({ inputContract: surface.inputContract, handle, readOriginal, schemaGuidance });
}

export function registerSaveRecordTools({ registerTool, ...configuration }) {
  const requestContracts = registeredToolRequestContracts(registerTool);
  const task = createSaveRecordTask({ ...configuration, requestContracts });
  registerTool(SAVE_RECORD_TOOL_NAME, { description: "Save one coherent authored change to an existing unit and run required maintenance. Retry names an immutable save result; it repeats no canonical mutation. " +
    'After acknowledgment or mappings are lost, use {recover:{request:<exact original save request>}} to observe retained operation state without executing it. ' +
    sessionAuthoringDescription(configuration.registeredTier) +
    (recordAuthoringAvailability(configuration.registeredTier).compile_requirements
      ? `Before authoring requirements, obligations or test cases, read their vocabulary and authoring guidance: ${REQUIREMENT_GUIDANCE_ENTRY_STATEMENT}. ` +
        `For the accepted terms of a requirement, read: ${REQUIREMENT_VOCABULARY_ENTRY_STATEMENT}. ` : "") +
    SAVE_RECORD_MEMBER_CONTRACT_GUIDANCE,
    inputSchema: task.inputContract.inputSchema,
    advertisedInputSchema: task.inputContract.advertisedInputSchema,
    publishedInputSchemaProjection: task.inputContract.publishedInputSchemaProjection, writeSemantics: "none",

    inputSchemaExposure: createSaveRecordInputExposure({ changeSchemas: task.inputContract.changeSchemas,
      variants: SAVE_UNIT_VARIANTS, registeredTier: configuration.registeredTier }),
    inputValidationErrorProjector: async ({ args, validationError }) => {
      const selected = saveRecordRequestVariant(args);
      const shaped = task.inputContract.shape.options[SHAPE_VARIANTS.indexOf(selected)].safeParse(args);
      const variant = shaped.success && selected !== "retry" ? saveRecordUnitVariant(args.unit) : undefined;

      const ownerDiagnostics = variant === undefined ? null
        : selected === "exception" ? validateRecordAuthoringException(args.exception)
          : validateRecordAuthoringChanges(variant.kind, variant.context, args.changes);
      const failure = await projectToolInputValidationFailure({
        tool: SAVE_RECORD_TOOL_NAME, args,
        validationError: shaped.success ? validationError : shaped.error,
        ownerDiagnostics: ownerDiagnostics?.length > 0 ? ownerDiagnostics.map(recordAuthoringIssueByMemberPath) : null,

        ownerGuidance: variant === undefined ? null : await task.schemaGuidance(args)
      });
      return { terminal_result: { ...jsonContent({ ...failure,
        ...(args?.changes !== null && typeof args?.changes === 'object' && Object.hasOwn(args.changes, 'refresh_proofs')
          ? { authority_limb: 'mechanical_failure' } : {})
      }, { env: configuration.responseEnv ?? process.env }), isError: true } };
    } },
  guardToolHandler(task.handle, { env: configuration.responseEnv ?? process.env }));
  return task;
}
