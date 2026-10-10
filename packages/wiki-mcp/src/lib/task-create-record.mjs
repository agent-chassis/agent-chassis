

import { getManifestRecordBirthKinds } from "@agent-chassis/wiki-core/src/lib/contract.mjs";
import { recordAuthoringChangeSchema, validateRecordAuthoringChanges } from "@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs";
import { createRecordFromInitial } from "@agent-chassis/wiki-core/src/operations/create.mjs";
import { serializeWorkRecordDiagnosticValue } from "@agent-chassis/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { requestSchema } from "./proof-request-schema.mjs";
import { resolveContractAssessmentContext } from "./task-assess-contract.mjs";
import { contractAssessmentAuthorityIdentity } from "./controlled-contract-query-context.mjs";
import { parseToolProfile } from "./tool-profile.mjs";
import { CREATE_RECORD_ROUTE } from "./record-authoring-maintenance-subject.mjs";
import { createSaveRecordMaintenance } from "./save-record-maintenance.mjs";
import { buildSaveRecordOriginalCall, buildSaveRecordRetryCall } from "./task-save-record-tools.mjs";
import { retainedFindingsReferenceResolver } from "./work-record-entry-tools.mjs";
import { readRetainedGraphImpact } from "./graph-impact-persistence-tools.mjs";
import { projectPublicationOutcome } from "./work-record-write-route-helpers.mjs";
import { selectedResponseDeliveryBound, selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { guardToolHandler, jsonContent, measureMcpInlineResultBytes, selectedFullContent } from "./mcp-response.mjs";
import { projectToolInputValidationFailure } from "./register-tool.mjs";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";

export const CREATE_RECORD_TOOL_NAME = CREATE_RECORD_ROUTE;

export function createCreateRecordInputContract(z) {
  const kinds = getManifestRecordBirthKinds().map(row => row.kind);
  const initialSchemas = Object.fromEntries(kinds.map(kind => [kind, recordAuthoringChangeSchema(kind, "birth")]));
  const title = z.string().min(1).regex(/\S/u, "title must be nonempty text")
    .describe("The exact title of the record to create.");
  const initials = kinds.map(kind => requestSchema(z, initialSchemas[kind], initialSchemas[kind].$defs, { memoize: true })
    .describe(`${kind} initial context, selected exclusively by kind.`));
  const variants = kinds.map((kind, index) => z.object({ kind: z.literal(kind), title,
    initial: kind === "source" ? initials[index] : initials[index].optional() }).strict());

  const advertisedInputSchema = z.object({ kind: z.enum(kinds), title,
    initial: z.union(initials).optional().describe("Initial context for the selected kind. Required for source; source metadata must be explicitly supplied.")
  }).strict().describe("Create one record in the session-bound repository. The server enforces the selected kind's closed initial schema; source requires initial. No repository selector.");
  return Object.freeze({ inputSchema: z.discriminatedUnion("kind", variants), advertisedInputSchema, initialSchemas });
}

export function buildCreateRecordReadCall({ unit, kind, path }) {
  let subject;
  switch (kind) {
    case "work_item": case "decision": case "initiative": subject = unit; break;
    case "source": case "area": subject = path; break;
    default: throw new TypeError(`Unsupported creation read kind '${String(kind)}'`);
  }
  return buildNextCall({ tool: "workspace_read_wiki", arguments: { subject }, recommended: true });
}

export function buildCreateRecordCorrectionCall({ unit, revision, changes }) {
  return buildNextCall({ tool: "save_record", arguments: { unit, revision, changes }, recommended: true });
}

const notCaused = Object.freeze({ canonical_docs_written: false, proofs_executed: false,
  agent_started: false, delivery_integrated: false, landing_established: false });

const addressed = diagnostics => diagnostics.map(row => {
  const path = row.path?.replace(/^changes(?=\.|$)/u, "initial") ?? "$";
  return { ...row, path, ...(typeof row.message === "string" && typeof row.path === "string" &&
    row.message.startsWith(row.path) ? { message: `${path}${row.message.slice(row.path.length)}` } : {}) };
});
const MISPLACED_MEMBER = "record_authoring_member_not_applicable";
const unpublishedCandidate = allocation => allocation?.publication_state === "not_published" && allocation.consumed_id === null;

export function createCreateRecordSurface({ workspace, z, responseEnv = process.env, sessionEnv = process.env,
  generateAndLint, assessment = null, resolveRetainedFindingsSource = null, dispatchSessionIdentity = null,
  birthOptions = {}, maintenanceOptions = {} }) {
  const contract = createCreateRecordInputContract(z);
  const role = parseToolProfile(sessionEnv);
  let context = null;
  const authorize = async () => {
    if (role !== "orchestrator" && role !== "operator") throw selectedResponseQueryInvalidError(CREATE_RECORD_ROUTE,
      "create_session_role_not_authorized", { role });
    context = (await resolveContractAssessmentContext({ workspace, sessionEnv })).context;
  };
  const maintenance = createSaveRecordMaintenance({ workspace, responseEnv, generateAndLint, ...maintenanceOptions,
    authorityIdentity: unit => contractAssessmentAuthorityIdentity(context, { unit }) });
  const resolveExternalReference = retainedFindingsReferenceResolver(resolveRetainedFindingsSource, dispatchSessionIdentity);

  async function prepare(request) {
    await authorize();
    const parsed = contract.inputSchema.safeParse(request);
    let body;
    if (!parsed.success) {
      const owner = getManifestRecordBirthKinds().some(row => row.kind === request?.kind)
        ? validateRecordAuthoringChanges(request.kind, "birth", request.initial ?? {}) : [];
      const diagnostics = owner.length > 0 ? addressed(owner) : parsed.error.issues.flatMap(row =>
        (row.keys ?? [null]).map(key => ({ code: "create_record_request_invalid", severity: "error",
          path: [...row.path, ...(key === null ? [] : [key])].join(".") || "$",
          message: key === null ? row.message : `${key} is not an accepted creation member` })));
      body = { outcome: "refused", unit: null, diagnostics, effects: { published: false, ...notCaused } };
    } else {
      const { kind, title, initial } = parsed.data;
      let published = null;
      try {
        const created = await createRecordFromInitial({ repoRoot: workspace.dir, kind, title, initial }, {
          ...birthOptions, owners: { repository: workspace.repo,
            ...(resolveExternalReference === null ? {} : { resolveExternalReference }),
            resolveRetainedGraphEvidence: source => readRetainedGraphImpact(source, { repository: workspace.repo, responseEnv }),
            ...birthOptions.owners },
          ...(assessment === null ? {} : { assess: async ({ wkId }) => {
            const { body: observed } = await assessment.prepare({ unit: wkId });
            return { assessment: observed.assessment, original: observed.original };
          } }) });
        const source = created.source ?? { path: created.relativeFile,
          source_digest: created.record_source_digest ?? created.revision };
        const readIdentity = { repository: workspace.repo, id: created.id, path: created.relativeFile,
          ...(created.revision === undefined ? {} : { revision: created.revision }) };
        body = { outcome: "created", unit: created.id, kind, title, source, read_identity: readIdentity,
          ...projectPublicationOutcome(created),
          allocator_state_advanced: created.allocator_state_advanced ?? null,
          consumed_id: kind === "area" ? null : created.id,
          effects: { published: created.written, ...notCaused } };
        for (const field of ["record", "revision", "record_source_digest", "bindings", "entries",
          "criterion_identity_changes", "changed_fields", "receipt", "assessment", "assessed_source", "assessment_unavailable"]) {
          if (created[field] !== undefined) body[field] = created[field];
        }
        if (created.assessment_carrier?.original !== undefined) body.assessment_original = created.assessment_carrier.original;
        published = body;
        const settled = await maintenance.settleCreation(body, { unit: created.id, kind, source, readIdentity,
          recordSourceDigest: created.record_source_digest ?? null });
        body = { ...settled.complete, original: settled.original };
      } catch (error) {
        const allocation = error.creation ?? (published === null ? null : { id: published.unit,
          relativeFile: published.source.path, ...projectPublicationOutcome(published),
          allocator_state_advanced: published.allocator_state_advanced, consumed_id: published.consumed_id });
        const publication = projectPublicationOutcome(allocation ?? { written: error.details?.changed === false ? false : null });
        body = { ...(published ?? {}), outcome: error.code === "create_record_initial_invalid" || error.details?.changed === false ? "refused" : "failed",
          unit: unpublishedCandidate(allocation) ? null : allocation?.id ?? null, kind, title, ...publication,
          ...(allocation === null ? {} : { allocation }),
          diagnostics: addressed(error.diagnostics ?? [{ code: error.code ?? "create_record_failed", severity: "error",
            path: "$", message: error.message }]),
          cause: { code: error.code ?? null, message: error.message,
            ...(error.details === undefined ? {} : { details: serializeWorkRecordDiagnosticValue(error.details) }),
            ...(error.cause === undefined ? {} : { cause: serializeWorkRecordDiagnosticValue(error.cause) }),
            ...(error.cleanup_failures === undefined ? {} : { cleanup_failures: serializeWorkRecordDiagnosticValue(error.cleanup_failures) }) },
          effects: { published: publication.written === null ? "unknown" : publication.written, ...notCaused } };
        const settled = await maintenance.settleCreation(body, null);
        body = { ...settled.complete, original: settled.original };
      }
    }
    return { body, observation: maintenance.retainObservation(body) };
  }
  async function original(source) { await authorize(); return maintenance.readOriginal(source); }
  return Object.freeze({ inputContract: contract, prepare, original });
}

export function createCreateRecordTask(configuration) {
  const { responseEnv = process.env, buildOriginalCall = buildSaveRecordOriginalCall,
    buildRetryCall = buildSaveRecordRetryCall, buildSubjectCall = buildCreateRecordReadCall } = configuration;
  const probe = { ref_id: "AAAAAAAA" };
  buildOriginalCall(probe);
  buildRetryCall("WK-0001", probe);
  buildSubjectCall({ unit: "WK-0001", kind: "work_item", path: "wiki/work-records/WK-0001.json" });
  const surface = createCreateRecordSurface(configuration);
  async function handle(request) {
    const { body, observation } = await surface.prepare(request);
    const nextCalls = [];
    if (observation.available) nextCalls.push(buildOriginalCall(observation.locator));
    else if (body.original?.available) nextCalls.push(buildOriginalCall(body.original.locator));
    if (body.original?.available && body.maintenance?.members.some(row => row.state !== "succeeded")) {
      nextCalls.push(buildRetryCall(body.unit, body.original.locator));
    }
    const sourcePath = unpublishedCandidate(body.allocation) ? undefined : body.source?.path ?? body.allocation?.relativeFile;
    if (sourcePath !== undefined) nextCalls.push(buildSubjectCall({ unit: body.unit, kind: body.kind, path: sourcePath }));
    const complete = { ...body, observation, complete: true, next_calls: nextCalls };
    if (measureMcpInlineResultBytes(complete) <= selectedResponseDeliveryBound(responseEnv)) {
      return jsonContent(complete, { env: responseEnv });
    }
    return jsonContent({ outcome: body.outcome, unit: body.unit, kind: body.kind, revision: body.revision,
      complete: false, populations: { bindings: Object.values(body.bindings ?? {}).reduce((n, rows) => n + Object.keys(rows).length, 0),
        diagnostics: body.diagnostics?.length ?? 0, entries: body.entries?.length ?? 0,
        maintenance_members: body.maintenance?.members.length ?? 0 },
      maintenance: { applicable: body.maintenance.applicable, attempt: body.maintenance.attempt, state: body.maintenance.state,
        members: body.maintenance.members.map(({ member, state }) => ({ member, state })) },
      ...(body.outcome === "created" ? {} : { ...projectPublicationOutcome(body),
        ...(body.allocation === undefined ? {} : { allocation: {
          id: body.allocation.id, relativeFile: body.allocation.relativeFile, ...projectPublicationOutcome(body.allocation),
          allocator_state_advanced: body.allocation.allocator_state_advanced, consumed_id: body.allocation.consumed_id } }) }),
      effects: body.effects, original: body.original, observation: observation.available ? observation : {
        available: false, locator: null, reason: "creation_observation_unavailable" },
      complete_detail: { available: observation.available, original_scope: "creation_facts_before_maintenance" },
      ...(body.cause === undefined ? {} : { cause: { code: body.cause.code, message: body.cause.message } }),
      next_calls: nextCalls }, { env: responseEnv });
  }
  async function readOriginal(source) {
    return selectedFullContent({ source, retained: await surface.original(source), member: "carrier" });
  }
  return Object.freeze({ inputContract: surface.inputContract, handle, readOriginal });
}

export function registerCreateRecordTools({ registerTool, ...configuration }) {
  const task = createCreateRecordTask(configuration);
  const requestContracts = registeredToolRequestContracts(registerTool);
  registerTool(CREATE_RECORD_TOOL_NAME, { description: "Create one draft with its explicitly supplied initial meaning in the session-bound repository. Source requires real metadata. Maintenance recovery uses the immutable creation result and never repeats birth.",
    inputSchema: task.inputContract.inputSchema,
    advertisedInputSchema: task.inputContract.advertisedInputSchema, writeSemantics: "none",

    inputValidationErrorProjector: async ({ args, validationError }) => {
      const initial = args?.initial;
      if (initial === null || typeof initial !== "object" || Array.isArray(initial) ||
          !validationError.issues.every(issue => issue.path[0] === "initial") ||
          !getManifestRecordBirthKinds().some(row => row.kind === args.kind)) return null;
      const owner = validateRecordAuthoringChanges(args.kind, "birth", initial);
      if (!owner.some(row => row.code === MISPLACED_MEMBER)) return null;
      return { terminal_result: { ...jsonContent(await projectToolInputValidationFailure({
        tool: CREATE_RECORD_TOOL_NAME, args, validationError, ownerDiagnostics: addressed(owner),
        requestContract: requestContracts.contractFor(CREATE_RECORD_TOOL_NAME)
      }), { env: configuration.responseEnv ?? process.env }), isError: true } };
    } },
  guardToolHandler(task.handle, { env: configuration.responseEnv ?? process.env }));
  return task;
}
