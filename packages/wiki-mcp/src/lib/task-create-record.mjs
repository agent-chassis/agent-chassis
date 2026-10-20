import { sessionAuthoringSchema } from "./record-authoring-session-exposure.mjs";

import { getManifestRecordBirthKinds } from "@agent-chassis/wiki-core/src/lib/contract.mjs";
import { recordAuthoringChangeSchema, recordAuthoringIssueByMemberPath, validateRecordAuthoringChanges } from "@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs";
import { createRecordFromInitial } from "@agent-chassis/wiki-core/src/operations/create.mjs";
import { serializeWorkRecordDiagnosticValue } from "@agent-chassis/wiki-core/src/operations/work-record-persistence-diagnostics.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { saveRecordFailureMeaning } from './save-record-response.mjs';
import { creationCause, creationConflictSubject, creationFacts, creationMaintenance, creationRecovery } from "./create-record-response.mjs";
import { createCreateRecordInputExposure } from "./create-record-input-exposure.mjs";
import { compactInputSchemaAdvertisement } from "./input-schema-exposure.mjs";
import { requestSchema } from "./proof-request-schema.mjs";
import { REQUIREMENT_BIRTH_SCHEMA_ENTRY_STATEMENT } from "./requirement-authoring-guidance.mjs";
import { resolveContractAssessmentContext } from "./task-assess-contract.mjs";
import { contractAssessmentAuthorityIdentity } from "./controlled-contract-query-context.mjs";
import { parseToolProfile } from "./tool-profile.mjs";
import { CREATE_RECORD_ROUTE } from "./record-authoring-maintenance-subject.mjs";
import { createSaveRecordMaintenance } from "./save-record-maintenance.mjs";
import { buildSaveRecordOriginalCall, buildSaveRecordRetryCall } from "./task-save-record-tools.mjs";
import { retainedFindingsReferenceResolver } from "./work-record-entry-tools.mjs";
import { readRetainedGraphImpact } from "./retained-graph-impact.mjs";
import { projectPublicationOutcome } from "./work-record-write-route-helpers.mjs";
import { readSelectedResponseSource, retainSelectedResponseSource, selectedResponseDeliveryBound, selectedResponseQueryInvalidError } from "./selected-response-snapshot.mjs";
import { describeRetentionFailure, guardToolHandler, jsonContent, measureMcpInlineResultBytes, selectedFullContent, completeProducedContent } from "./mcp-response.mjs";
import { projectToolInputValidationFailure } from "./register-tool.mjs";
import { createMutationRecovery, mutationAuthorityIdentity, mutationRecoverySchema } from './record-mutation-recovery.mjs';

export const CREATE_RECORD_TOOL_NAME = CREATE_RECORD_ROUTE;

export function createCreateRecordInputContract(z, registeredTier = null) {
  const kinds = getManifestRecordBirthKinds().map(row => row.kind);
  const initialSchemas = Object.fromEntries(kinds.map(kind => [kind, recordAuthoringChangeSchema(kind, "birth")]));
  const title = z.string().min(1).regex(/\S/u, "title must be nonempty text")
    .describe("The exact title of the record to create.");
  const initials = kinds.map(kind => requestSchema(z, initialSchemas[kind], initialSchemas[kind].$defs, { memoize: true })
    .describe(`${kind} initial context, selected exclusively by kind.`));
  const variants = kinds.map((kind, index) => z.object({ kind: z.literal(kind), title,
    initial: kind === "source" ? initials[index] : initials[index].optional() }).strict());

  const advertisedInputSchema = z.object({ kind: z.enum(kinds).optional(), title: title.optional(),
    initial: z.union(initials).optional().describe("Initial context for the selected kind. Required for source; source metadata must be explicitly supplied."),
    recover: mutationRecoverySchema(z).optional()
  }).strict().describe("Create one record in the session-bound repository. The server enforces the selected kind's closed initial schema; source requires initial. No repository selector.");

  const compactInitial = compactInitialAlternatives(kinds, Object.fromEntries(Object.entries(initialSchemas).map(([kind, schema]) => [kind, sessionAuthoringSchema(schema, registeredTier)])));
  const publishedInputSchemaProjection = (converted) => {
    const { anyOf: typed, ...declared } = converted?.properties?.initial ?? {};
    if (!Array.isArray(typed) || typed.length !== compactInitial.length) {
      throw new TypeError("workspace_create_record publication: the converted request no longer declares one initial alternative per kind");
    }
    return { ...converted, properties: { ...converted.properties, initial: { anyOf: compactInitial, ...declared } } };
  };
  const mutationSchema = z.discriminatedUnion('kind', variants);
  const recoverySchema = z.object({ recover: mutationRecoverySchema(z) }).strict();
  return Object.freeze({ inputSchema: z.union([mutationSchema, recoverySchema]), mutationSchema, recoverySchema, advertisedInputSchema, initialSchemas,
    publishedInputSchemaProjection });
}

const DEFERRED_INITIAL_MEMBER = "requirements";
const DEFERRED_INITIAL_REQUIREMENTS = "One batch of controlled requirements {entities, requirements, collections, unresolved}, " +
  `validated in full by the server. Its complete declaration: ${REQUIREMENT_BIRTH_SCHEMA_ENTRY_STATEMENT}, then the selection that answer returns.`;

export const CREATE_RECORD_INITIAL_CONTRACT_GUIDANCE =
  "initial lists every member of the selected kind; a member shown without a type has its complete schema in that " +
  'kind\'s context: workspace_read_wiki {"reads":[{"subject":{"record_kind":"<kind>"}}]}, then the returned reference with select ' +
  '{"input_contract":{"tool":"workspace_create_record","members":[...]}} naming every member the creation needs in one ' +
  "read. A schema already read stays valid; reading one is never required.";
function compactInitialAlternatives(kinds, initialSchemas) {
  return kinds.map((kind) => {
    const compact = compactInputSchemaAdvertisement(initialSchemas[kind]);
    return { ...compact, description: `${kind} initial context, selected exclusively by kind.`,
      properties: Object.fromEntries(Object.entries(compact.properties).map(([member, node]) =>
        [member, kind === "work_item" && member === DEFERRED_INITIAL_MEMBER ? { description: DEFERRED_INITIAL_REQUIREMENTS } : node])) };
  });
}

export function buildCreateRecordReadCall({ unit, kind, path }) {
  let subject;
  switch (kind) {
    case "work_item": case "decision": case "initiative": subject = unit; break;
    case "source": case "area": subject = path; break;
    default: throw new TypeError(`Unsupported creation read kind '${String(kind)}'`);
  }
  return buildNextCall({ tool: "workspace_read_wiki", arguments: { reads: [{ subject }] }, recommended: false });
}

export function buildCreateRecordCorrectionCall({ unit, revision, changes }) {
  return buildNextCall({ tool: "save_record", arguments: { unit, revision, changes }, recommended: true });
}

const notCaused = Object.freeze({ canonical_docs_written: false, proofs_executed: false,
  agent_started: false, delivery_integrated: false, landing_established: false });

const addressed = diagnostics => diagnostics.map(row => {
  const path = row.path?.replace(/^changes(?=\.|$)/u, "initial") ?? "$";
  return { ...row, path, ...(typeof row.message === "string" && typeof row.path === "string" &&
    row.message.startsWith(row.path) ? { message: `${path}${row.message.slice(row.path.length)}` } : {}),

  ...(row.path_segments === undefined ? {} : { path_segments: ["initial", ...row.path_segments.slice(1)] }) };
});
const unpublishedCandidate = allocation => allocation?.publication_state === "not_published";

export function createCreateRecordSurface({ workspace, z, responseEnv = process.env, sessionEnv = process.env,
  generateAndLint, assessment = null, resolveRetainedFindingsSource = null, dispatchSessionIdentity = null,
  registeredTier = null, birthOptions = {}, maintenanceOptions = {} }) {
  const contract = createCreateRecordInputContract(z, registeredTier);
  const role = parseToolProfile(sessionEnv);
  let context = null;
  const authorize = async () => {
    if (role !== "orchestrator" && role !== "operator") throw selectedResponseQueryInvalidError(CREATE_RECORD_ROUTE,
      "create_session_role_not_authorized", { role });
    context = (await resolveContractAssessmentContext({ workspace, sessionEnv })).context;
  };
  const maintenance = createSaveRecordMaintenance({ workspace, responseEnv, generateAndLint, ...maintenanceOptions,
    authorityIdentity: unit => contractAssessmentAuthorityIdentity(context, { unit }) });
  const recovery = createMutationRecovery({ route: CREATE_RECORD_ROUTE, workspace, responseEnv,
    authorityIdentity: unit => contractAssessmentAuthorityIdentity(context, { unit }) });
  const resolveExternalReference = retainedFindingsReferenceResolver(resolveRetainedFindingsSource, dispatchSessionIdentity);

  async function execute(request, onProgress) {
    const parsed = contract.mutationSchema.safeParse(request);
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

            ...birthOptions.owners, registeredTier },
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
        for (const field of ["record", "revision", "record_source_digest", "bindings", "requirement_rows", "entries",
          "criterion_identity_changes", "changed_fields", "receipt", "assessment", "assessed_source", "assessment_unavailable"]) {
          if (created[field] !== undefined) body[field] = created[field];
        }
        if (created.assessment_carrier?.original !== undefined) body.assessment_original = created.assessment_carrier.original;
        body.mutation_request = parsed.data;
        published = body;
        const settled = await maintenance.settleCreation(body, { unit: created.id, kind, source, readIdentity,
          recordSourceDigest: created.record_source_digest ?? null }, onProgress);
        body = { ...settled.complete, original: settled.original };
      } catch (error) {
        const allocation = error.creation ?? (published === null ? null : { id: published.unit,
          relativeFile: published.source.path, ...projectPublicationOutcome(published),
          allocator_state_advanced: published.allocator_state_advanced, consumed_id: published.consumed_id });
        const publication = projectPublicationOutcome(allocation ?? { written: error.details?.changed === false ? false : null });
        body = { ...(published ?? {}), outcome: error.code === "create_record_initial_invalid" || error.details?.changed === false ? "refused" : "failed",
          unit: unpublishedCandidate(allocation) ? null : allocation?.id ?? null, kind, title, ...publication,
          ...(typeof allocation?.revision === "string" ? { revision: allocation.revision } : {}),
          ...(allocation?.bindings === undefined ? {} : { bindings: allocation.bindings }),
          ...(allocation?.requirement_rows === undefined ? {} : { requirement_rows: allocation.requirement_rows }),
          ...(allocation?.receipt === undefined ? {} : { receipt: allocation.receipt }),
          ...(allocation?.record_source_digest === undefined ? {} : { record_source_digest: allocation.record_source_digest }),
          ...(allocation === null ? {} : { allocation }),
          diagnostics: addressed(error.diagnostics ?? [{ code: error.code ?? "create_record_failed", severity: "error",
            path: "$", message: error.message,
            ...(error.code === 'controlled_contract_carrier_validation_failed' ? {
              details: saveRecordFailureMeaning(error.details) } : {}) }]),
          cause: { code: error.code ?? null, message: error.message,
            ...(error.details === undefined ? {} : { details: serializeWorkRecordDiagnosticValue(error.details) }),
            ...(error.cause === undefined ? {} : { cause: serializeWorkRecordDiagnosticValue(error.cause) }),
            ...(error.cleanup_failures === undefined ? {} : { cleanup_failures: serializeWorkRecordDiagnosticValue(error.cleanup_failures) }) },
          effects: { published: publication.written === null ? "unknown" : publication.written, ...notCaused } };
        body.mutation_request = parsed.data;
        const source = publication.written === true && allocation?.relativeFile
          ? { path: allocation.relativeFile } : null;
        if (source !== null) body.source = source;
        const settled = await maintenance.settleCreation(body, source === null ? null : {
          unit: allocation.id, kind, source, readIdentity: { repository: workspace.repo, id: allocation.id, path: source.path },
          recordSourceDigest: allocation.record_source_digest ?? null }, onProgress);
        body = { ...settled.complete, original: settled.original };
      }
    }
    return { body };
  }
  async function prepare(request) {
    await authorize();
    if (request?.recover !== undefined) {
      const query = contract.inputSchema.safeParse(request);
      const original = query.success && contract.mutationSchema.safeParse(request.recover.request);
      if (!original?.success) return { body: { outcome: 'mutation_outcome_unavailable', effects: { published: 'unknown' },
        cause: { code: 'mutation_recovery_request_invalid', message: 'Recovery requires the exact original valid creation request.' },
        diagnostics: (original?.error?.issues ?? query.error?.issues ?? []).map(issue => ({ code: 'mutation_recovery_request_invalid',
          path: ['recover', 'request', ...issue.path].join('.'), message: issue.message })),
        recovery: { correction: 'Supply the exact request that was submitted. This read does not execute it; changing authored values just to obtain a match cannot recover the original operation.' } } };
      const recovered = recovery.observe(original.data, request.recover.unit);
      return { ...recovered, body: await maintenance.observeBody(recovered.body) };
    }
    const parsed = contract.mutationSchema.safeParse(request);
    const tracked = parsed.success ? recovery.start(parsed.data) : null;
    const result = await execute(request, tracked?.record);
    if (tracked !== null) maintenance.retainObservation(result.body);
    tracked?.record(result.body);
    return { ...result, source: tracked?.retained, read: tracked?.read };
  }
  function retainDetail(carrier) {
    return retainSelectedResponseSource({ binding: { route: CREATE_RECORD_ROUTE, repository: workspace.repo,
      unit: carrier.unit ?? null, query_identity: { operation: "creation_detail", unit: carrier.unit ?? null },
      authority_identity: mutationAuthorityIdentity(workspace, { ...contractAssessmentAuthorityIdentity(context, { unit: carrier.unit ?? null }), route: CREATE_RECORD_ROUTE }) }, carrier },
    { responseOwner: (envelope, options) => jsonContent(envelope, { env: responseEnv, ...options,
      selectedAccess: () => ({ operator_only: true }) }) });
  }
  async function original(source) {
    await authorize();
    const retained = readSelectedResponseSource(source, { env: responseEnv, route: CREATE_RECORD_ROUTE,
      expected: { route: CREATE_RECORD_ROUTE, repository: workspace.repo } });
    if (retained.binding.query_identity?.operation !== "creation_detail") return maintenance.readOriginal(source);
    const unit = retained.binding.unit;
    return readSelectedResponseSource(source, { env: responseEnv, route: CREATE_RECORD_ROUTE, expected: {
      route: CREATE_RECORD_ROUTE, repository: workspace.repo, unit,
      query_identity: { operation: "creation_detail", unit },
      authority_identity: mutationAuthorityIdentity(workspace, { ...contractAssessmentAuthorityIdentity(context, { unit }), route: CREATE_RECORD_ROUTE }) } });
  }
  return Object.freeze({ inputContract: contract, prepare, original, retainDetail });
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
    const prepared = await surface.prepare(request);
    const { body } = prepared;
    const result = creationFacts(body);
    const maintenance = creationMaintenance(body);
    if (maintenance !== null) result.maintenance = maintenance;
    const recovery = creationRecovery(body, maintenance);
    if (recovery !== null) result.recovery = recovery;
    const nextCalls = [...(body.next_calls ?? [])];
    if (body.maintenance?.state === 'maintenance_attempt_in_progress' && body.original?.available) nextCalls.push({
      tool: 'save_record', arguments: { unit: body.unit, maintenance_observe: { save_result: body.original.locator } }, recommended: true });
    if (request.recover !== undefined && body.outcome === 'mutation_outcome_unknown') nextCalls.push({
      tool: CREATE_RECORD_TOOL_NAME, arguments: request, recommended: true });
    if (body.original?.available && body.maintenance?.state !== 'maintenance_attempt_in_progress' && body.maintenance?.members?.some(row => row.state !== "succeeded")) {
      nextCalls.push({ ...buildRetryCall(body.unit, body.original.locator), recommended: false });
    }
    const conflict = creationConflictSubject(body);
    const sourcePath = conflict ?? (unpublishedCandidate(body.allocation) ? undefined : body.source?.path ?? body.allocation?.relativeFile);
    if (result.continuation?.state === 'current_context_required') nextCalls.push({
      tool: 'workspace_read_wiki', executable: false,
      known_arguments: { reads: [{ subject: body.unit }] },
      missing_caller_input: ['reads[0].for_changes'],
      information: 'If editing next, supply the intended save members in for_changes and use contexts[unit].revision. Creation is complete.'
    });
    else if (sourcePath !== undefined) nextCalls.push({ ...buildSubjectCall({ unit: body.unit, kind: body.kind, path: sourcePath }),
      recommended: body.effects?.published === "unknown" });
    const complete = { ...result, complete: true, next_calls: nextCalls };
    if (measureMcpInlineResultBytes(complete) <= selectedResponseDeliveryBound(responseEnv)) return jsonContent(complete, { env: responseEnv });
    if (prepared.source !== undefined) {
      try { return selectedFullContent({ source: prepared.source, retained: prepared.retained ?? prepared.read(), projection: complete }); }
      catch (error) { complete.delivery_failure = creationCause(error); }
    }

    let detail;
    try { detail = surface.retainDetail(complete); }
    catch (error) { detail = { failure: describeRetentionFailure(error, {
      operation: "retain_creation_detail", subject: { unit: body.unit } }) }; }
    const summary = { ...result, bindings: undefined,
      ...(result.diagnostics === undefined ? {} : { diagnostics: result.diagnostics.slice(0, 1) }),
      ...(maintenance === null ? {} : { maintenance: { ...maintenance, failures: maintenance.failures?.map(row => ({ ...row,
        ...(row.findings === undefined ? {} : { findings: row.findings.slice(0, 1) }) })) } }) };
    if (detail.failure === undefined) return jsonContent({ ...summary, complete: false,
      next_calls: [{ ...buildOriginalCall(detail), recommended: true }, ...nextCalls] }, { env: responseEnv });

    delete complete.delivery_failure;
    return completeProducedContent(complete);
  }
  async function readOriginal(source) {
    const retained = await surface.original(source);
    const maintenance = creationMaintenance(retained.carrier);
    const recovery = creationRecovery(retained.carrier, maintenance);
    return selectedFullContent({ source, retained, projection: retained.binding.query_identity.operation === "creation_detail"
      ? retained.carrier : { ...creationFacts(retained.carrier),
        ...(maintenance === null ? {} : { maintenance }), ...(recovery === null ? {} : { recovery }) } });
  }
  return Object.freeze({ inputContract: surface.inputContract, handle, readOriginal });
}

export function registerCreateRecordTools({ registerTool, ...configuration }) {
  const task = createCreateRecordTask(configuration);
  registerTool(CREATE_RECORD_TOOL_NAME, { description: "Create one draft with its explicitly supplied initial meaning in the session-bound repository. Source requires real metadata. Maintenance recovery uses the immutable creation result and never repeats birth. " +
    'After acknowledgment or mappings are lost, use {recover:{request:<exact original creation request>}}. It only observes retained state; identical operations remain ambiguous. ' +
    CREATE_RECORD_INITIAL_CONTRACT_GUIDANCE,
    inputSchema: task.inputContract.inputSchema,
    advertisedInputSchema: task.inputContract.advertisedInputSchema,
    publishedInputSchemaProjection: task.inputContract.publishedInputSchemaProjection, writeSemantics: "none",

    inputSchemaExposure: createCreateRecordInputExposure({ initialSchemas: task.inputContract.initialSchemas, registeredTier: configuration.registeredTier }),

    inputValidationErrorProjector: async ({ args, validationError }) => {
      const recovery = args?.recover !== undefined;
      const selected = (recovery ? task.inputContract.recoverySchema : task.inputContract.mutationSchema).safeParse(args);
      const failure = selected.success ? validationError : selected.error;
      const initial = args?.initial;
      const owner = !recovery && initial !== null && typeof initial === "object" && !Array.isArray(initial) &&
        getManifestRecordBirthKinds().some(row => row.kind === args.kind)
        ? validateRecordAuthoringChanges(args.kind, "birth", initial) : null;
      const ownerDiagnostics = owner?.length > 0 ? [
        ...failure.issues.filter(issue => issue.path[0] !== "initial"),
        ...addressed(owner).map(recordAuthoringIssueByMemberPath)
      ] : null;
      return { terminal_result: { ...jsonContent(await projectToolInputValidationFailure({
        tool: CREATE_RECORD_TOOL_NAME, args, validationError: failure,
        ownerDiagnostics, ownerGuidance: !recovery && getManifestRecordBirthKinds().some(row => row.kind === args?.kind) &&
          (owner?.length > 0 || failure.issues.some(issue => issue.path[0] === "initial"))
          ? { calls: [buildNextCall({ tool: "workspace_read_wiki",
            arguments: { reads: [{ subject: { record_kind: args.kind } }] }, recommended: false })] } : null
      }), { env: configuration.responseEnv ?? process.env }), isError: true } };
    } },
  guardToolHandler(task.handle, { env: configuration.responseEnv ?? process.env }));
  return task;
}
