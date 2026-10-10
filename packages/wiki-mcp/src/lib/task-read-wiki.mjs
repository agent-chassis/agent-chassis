

import { createHash } from "node:crypto";
import { groupCompleteSchemaDiagnostics } from "@agent-chassis/controlled-contract/bounded-diagnostics";
import { authorableNativeCaseTarget } from "@agent-chassis/controlled-contract/native-test-cases";
import { registeredToolRequestContracts } from "./registered-tool-request-contracts.mjs";
import { createInitiativeGuidanceProjector } from "./task-read-wiki-guidance.mjs";

import {
  getWikiRecord,
  lintRepo,
  loadManifest,
  readWikiPage,
  readWorkRecordById,
  validateDocsPolicyOperation
} from "@agent-chassis/wiki-core";
import { WORK_RECORD_EDIT_FIELD_REGISTRY } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import { projectWorkRecordFreshness } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { projectWorkRecordPrivateScopePolicyFacts } from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import { readSearchInventory } from "@agent-chassis/wiki-core/src/operations/search.mjs";
import { readWorkRecordEntry } from "@agent-chassis/wiki-core/src/operations/work-record-entries.mjs";
import { decodeWorkRecordEntryReference, findExactScalarMatches, resolveWorkRecordEntryContent,
  selectWorkRecordSourceText, selectWorkRecordReferenceText } from
  "@agent-chassis/wiki-core/src/lib/work-record-entry-content.mjs";
import { ControlledContractToolError } from "@agent-chassis/wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import { runInitiativeStatus } from "@agent-chassis/wiki-core/src/operations/initiative-status.mjs";
import { obligationCoverageQueryOperation, queryControlledContractObligationCoverageOperation } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/obligation-coverage-query.mjs";

import { assertObligationCoverageQueryScope, resolveObligationCoverageQueryContext } from
  "./controlled-contract-query-context.mjs";
import { buildWorkspaceIntegrationStatus } from "./integration-status-tools.mjs";
import { FindingsSourceRefusal, resolveAuthenticatedFindingsSource, WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR,
  WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR } from "./launcher-run-credential.mjs";
import { guardManagedAssignmentRead, readManagedAssignmentPresentation } from "./managed-assignment-read.mjs";
import { buildNextCall } from "./mcp-response.mjs";
import { createToolInputValidationError } from "./register-tool.mjs";
import {
  readSelectedResponseProjection,
  readSelectedResponseSource,
  retainSelectedResponseSource,
  selectedResponseCorrectableError,
  selectedResponseQueryInvalidError,
  selectedResponseRequestSchema
} from "./selected-response-snapshot.mjs";
import { REQUIREMENT_AUTHORING_GUIDANCE, REQUIREMENT_AUTHORING_GUIDANCE_REVISION,
  REQUIREMENT_AUTHORING_GUIDANCE_TOPICS, REQUIREMENT_GUIDANCE_SUBJECT, resolveRequirementAuthoringGuidance } from
  "./requirement-authoring-guidance.mjs";
import { createReadWikiInputSchema, describeReadWikiTool } from "./task-read-wiki-schema.mjs";
import { READ_WIKI_SOURCE_KINDS as KIND, READ_WIKI_TOOL, createReadWikiGrants } from
  "./task-read-wiki-selection.mjs";
import { readCloseoutReceipt, readCompleteCloseoutReceipt } from "./work-record-closeout-response.mjs";
import { SAVE_RECORD_ROUTE } from "./save-record-maintenance.mjs";
import { compareObservedWorkRecords } from "./work-record-read-tools.mjs";
import { readSourceBoundAuthoringRevision, readCompleteSearchSource } from "@agent-chassis/wiki-core/src/operations/read.mjs";
import { workRecordProseRegistryEntries } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import { parseWorkRecordSummaryUnit, summarizeTerminalReviewDesignation } from
  "@agent-chassis/wiki-core/src/lib/work-record-summary.mjs";
import { analyzeWorkRecordFindingsUnit } from "@agent-chassis/wiki-core/src/lib/work-record-findings-semantics.mjs";
import { projectWorkRecordNavigation } from "./work-record-read-navigation.mjs";

const WORK_UNIT_PATTERN = /^(WK-[0-9]{4})(?:#(SLICE-[0-9]{3}))?$/u;
const KIND_RECORD_PATTERN = /^(?:DEC|IN)-[0-9]{4}$/u;
const DOCUMENT_PATH_PATTERN = /^(?:docs|wiki)\/.+\.md$/u;

const SEARCH_CONTEXT_LIMIT = 8;

const SOURCE_OWNERS = Object.freeze({
  getWikiRecord, lintRepo, loadManifest, readWikiPage, readWorkRecordById, validateDocsPolicyOperation,
  readSearchInventory, readWorkRecordEntry, resolveWorkRecordEntryContent, runInitiativeStatus,
  queryControlledContractObligationCoverageOperation, buildWorkspaceIntegrationStatus,
  resolveObligationCoverageQueryContext, readManagedAssignmentPresentation, readCloseoutReceipt,
  readSourceBoundAuthoringRevision, readCompleteSearchSource, readCompleteCloseoutReceipt,
  resolveAuthenticatedFindingsSource
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const selectionName = (select) => Object.keys(select).find((key) => !["version", "history", "parameters"].includes(key));
const scalars = (value) => Array.from(String(value)).length;

function valueAt(source, address) {
  return address.reduce((current, key) => (current === null || current === undefined ? undefined : current[key]), source);
}

function workFields(scope) {
  return WORK_RECORD_EDIT_FIELD_REGISTRY.filter((entry) => entry.applicability.includes(scope));
}

function reviewPurposeFact(unit) {
  const purpose = analyzeWorkRecordFindingsUnit(unit).effective_review_purpose;
  return purpose === null ? {} : { review_purpose: purpose };
}

function literalOccurrences(text, literal) {
  const length = scalars(literal);
  return findExactScalarMatches(text, literal).matches.map((offset) => ({ offset, length }));
}

export function createReadWikiTask({
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  resolveWorkspaceReadRepo,
  readPackageDocument = null,
  readOriginalReference = null,
  sessionRole,
  policy,
  requestContracts = null,
  env = process.env,
  deps = {}
}) {
  const grants = createReadWikiGrants(policy, sessionRole);
  const inputSchema = createReadWikiInputSchema(z, grants);
  if (inputSchema === null) return null;
  const owners = { ...SOURCE_OWNERS, ...deps };
  const projectInitiativeGuidance = createInitiativeGuidanceProjector(requestContracts);
  const requestSchema = selectedResponseRequestSchema(inputSchema._def.schema);
  const { granted } = grants;

  const invalid = (reason, details = {}) => selectedResponseQueryInvalidError(READ_WIKI_TOOL, reason, details);
  const call = (argumentsValue, recommended = false) =>
    buildNextCall({ tool: READ_WIKI_TOOL, arguments: argumentsValue, recommended });

  const followUps = (argumentList) => ({
    next_calls: argumentList.map((item, index) => call(item, index === 0))
  });
  const correctable = (reason, details, corrected, prerequisite, successCondition) =>
    selectedResponseCorrectableError(READ_WIKI_TOOL, reason, details,
      { arguments: corrected, requestSchema, prerequisite, successCondition });

  function requireGrant(sourceKind, selection) {
    if (!granted(sourceKind, selection)) {
      throw invalid("selection_not_granted", { source_kind: sourceKind, selection, role: sessionRole });
    }
  }

  const findingsSession = sessionRole === "reviewer" || sessionRole === "redteam";
  const launcherBound = () => [WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR, WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR]
    .some((name) => String(env[name] ?? "").trim() !== "");

  function frozenSourceRefusal(refusal) {
    return Object.assign(new Error(refusal.message), { code: refusal.code, envelope: {
      schema_version: "workspace-read-wiki-source-refusal.v1", accepted: false,
      code: refusal.code, subject: refusal.subject,
      cause: { code: refusal.code, message: refusal.message },
      next_calls: [], no_supported_route: true,
      recovery: { state: "no_supported_route", actor: "coordinator_or_operator", caller_correctable: false,
        missing_capability: "regenerate_frozen_review_source",
        reason: "The launcher captures a review source only when a coordinator dispatches a review; " +
          "no read repairs or replaces a captured source, and repeating this call reads the same source." },
      effects: { reads: [], writes: [] }
    } });
  }

  function authenticateFrozenReviewSource() {
    if (!findingsSession || !launcherBound()) return;
    try {
      owners.resolveAuthenticatedFindingsSource(env);
    } catch (error) {
      if (!(error instanceof FindingsSourceRefusal)) throw error;
      throw frozenSourceRefusal(error);
    }
  }

  async function sessionAuthority(workspace) {
    if (sessionRole === "worker") {
      const { presentation, authority_identity } = owners.readManagedAssignmentPresentation({ env });
      return { role: "worker", run_id: presentation.identity.run_id,
        assigned_unit: presentation.identity.assigned_unit, ...authority_identity };
    }
    if (findingsSession && !launcherBound()) {
      return { role: sessionRole, source: { kind: "canonical_workspace", repository: workspace.repo },
        population: { kind: "repository" } };
    }
    return (await owners.resolveObligationCoverageQueryContext({ env, workspace })).identity;
  }

  function guidanceTopicRefusal(path, resolved) {
    return correctable("requirement_guidance_topic_not_found", { guidance: [...path], code: resolved.code,
      segment_index: resolved.segment_index, resolved_path: resolved.resolved_path, expected: resolved.expected },
    { subject: REQUIREMENT_GUIDANCE_SUBJECT }, "the path must name a member of the requirement-authoring guidance",
    "the call returns the guidance context, whose selections are the readable topics");
  }

  function requirementGuidanceResource(subject) {
    requireGrant(KIND.REQUIREMENT_GUIDANCE, "context");
    const topic = subject.topic ?? null;
    if (topic !== null) {
      const resolved = resolveRequirementAuthoringGuidance(topic);
      if (!resolved.ok) throw guidanceTopicRefusal(topic, resolved);
    }
    return { source_kind: KIND.REQUIREMENT_GUIDANCE, unit: null, value: REQUIREMENT_AUTHORING_GUIDANCE,
      subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, ...(topic === null ? {} : { topic: [...topic] }) },
      revision: REQUIREMENT_AUTHORING_GUIDANCE_REVISION,
      facts: { schema_version: REQUIREMENT_AUTHORING_GUIDANCE.schema_version,
        overview: REQUIREMENT_AUTHORING_GUIDANCE.overview, ...(topic === null ? {} : { topic: [...topic] }),
        topic_count: REQUIREMENT_AUTHORING_GUIDANCE_TOPICS.length } };
  }

  async function resolveSubject(workspace, subject) {
    if (subject !== null && typeof subject === "object") {
      if (subject.contract === true) {
        requireGrant(KIND.MANIFEST, "context");
        const manifest = await owners.loadManifest();
        return { source_kind: KIND.MANIFEST, subject: { contract: true }, unit: null,
          revision: sha256(JSON.stringify(manifest)), value: manifest,
          facts: { version: manifest.version ?? null, type_count: Object.keys(manifest.types ?? {}).length } };
      }
      if (subject.requirement_guidance === true) return requirementGuidanceResource(subject);
      requireGrant(KIND.REPOSITORY, "context");
      return { source_kind: KIND.REPOSITORY, subject: { repository: true }, unit: null,
        revision: null, value: null, facts: { repository: workspace.repo } };
    }
    const workUnit = WORK_UNIT_PATTERN.exec(subject);
    if (workUnit !== null) {
      requireGrant(KIND.RECORD, "context");
      const loaded = await owners.readWorkRecordById({ dir: workspace.dir, id: workUnit[1] });
      if (!loaded.record) {
        throw invalid("subject_not_found", { subject, repository: workspace.repo,
          diagnostics: (loaded.diagnostics ?? []).map((item) => item.code) });
      }
      const slice = workUnit[2] === undefined ? null
        : (loaded.record.slices ?? []).find((candidate) => candidate.id === workUnit[2]) ?? null;
      if (workUnit[2] !== undefined && slice === null) {
        throw correctable("slice_not_found", { subject, repository: workspace.repo }, { subject: workUnit[1] },
          "the slice must exist in the saved record", "the call returns the record context, which lists its slices");
      }
      const owner = slice ?? loaded.record;
      return { source_kind: KIND.RECORD, subject, unit: subject, record: loaded.record, owner,
        scope: slice === null ? "record" : "slice", loaded,
        revision: projectWorkRecordFreshness(loaded.source_digest),
        facts: { id: subject, title: owner.title ?? null, status: owner.status ?? null,
          work_kind: owner.work_kind ?? null, ...reviewPurposeFact(owner), valid: loaded.valid === true,

          ...(slice === null
            ? { terminal_review_designation: summarizeTerminalReviewDesignation(loaded.record) } : {}),
          slice_count: slice === null ? (loaded.record.slices ?? []).length : undefined,
          entry_count: (owner.sections?.entries ?? []).length,
          task_count: (owner.sections?.tasks ?? []).length } };
    }
    if (KIND_RECORD_PATTERN.test(subject)) {
      requireGrant(KIND.CANONICAL_RECORD, "context");
      const record = await owners.getWikiRecord({ dir: workspace.dir, id: subject });
      return { source_kind: KIND.CANONICAL_RECORD, subject, unit: subject, value: record,
        revision: record.source_digest ?? sha256(JSON.stringify(record.record ?? null)),
        facts: { id: record.id, record_kind: record.record_kind ?? null, title: record.title ?? null,
          status: record.record?.status ?? null, valid: record.valid ?? null } };
    }
    if (DOCUMENT_PATH_PATTERN.test(subject)) {
      requireGrant(KIND.DOCUMENT, "context");
      const page = await owners.readWikiPage({ dir: workspace.dir, path: subject, include_body: true, include_raw: true });
      if (page.format !== "markdown") throw invalid("subject_not_document", { subject });
      return { source_kind: KIND.DOCUMENT, subject, unit: subject, value: page,
        revision: sha256(page.markdown),
        facts: { path: page.relativePath, title: page.title ?? null, id: page.id ?? null,
          body_scalars: scalars(page.body), backlink_count: page.backlink_count } };
    }
    throw invalid("subject_not_canonical", { subject,
      accepted: ["WK-0000", "WK-0000#SLICE-000", "DEC-0000", "IN-0000", "docs/<path>.md", "wiki/<path>.md",
        "{repository:true}", "{contract:true}",
        ...(granted(KIND.REQUIREMENT_GUIDANCE, "context") ? ["{requirement_guidance:true}"] : [])] });
  }

  function assignmentResource() {
    guardManagedAssignmentRead({ assignment: true }, { env });
    const { assignedUnit, digest, presentation } = owners.readManagedAssignmentPresentation({ env });
    return { source_kind: KIND.ASSIGNMENT, subject: { assignment: true }, unit: assignedUnit,
      revision: projectWorkRecordFreshness(digest), presentation,
      facts: { ...presentation.identity, guidance_scalars: scalars(presentation.guidance) } };
  }

  async function boundSubject(workspace, subject) {
    if (typeof subject !== "string" || !(WORK_UNIT_PATTERN.test(subject) || KIND_RECORD_PATTERN.test(subject))) {
      return resolveSubject(workspace, subject);
    }
    let bound;
    try {
      bound = await owners.readSourceBoundAuthoringRevision({ dir: workspace.dir, unit: subject,
        readSource: () => resolveSubject(workspace, subject) });
    } catch (error) {

      if (!(error instanceof ControlledContractToolError) ||
          error.code !== "acceptance_coverage_canonical_source_invalid" || error.envelope !== undefined) throw error;
      error.envelope = {
        schema_version: "workspace-read-wiki-source-refusal.v1", accepted: false,
        code: error.code, subject, repository: workspace.repo,
        cause: { code: error.code, message: error.message }, details: { ...error.details,
          schema_errors: groupCompleteSchemaDiagnostics(error.details.schema_errors) },
        next_calls: [], no_supported_route: true, recovery: { state: "no_supported_route",
          missing_capability: "repair_invalid_canonical_obligation_carrier",
          missing_inputs: ["authenticated current authoring revision"],
          reason: "The invalid source prevents acquiring a current write revision; no serving operation repairs invalid carrier bytes." },
        effects: { reads: [KIND.RECORD], writes: [] }
      };
      throw error;
    }
    if (!bound.ok) throw correctable("source_moved", { subject, observed_revision: bound.revision,
      current_revision: bound.current_revision }, { subject }, "the source moved while rendering",
      "the call returns a context and revision captured from the same source");
    return { ...bound.source, authoring_revision: bound.revision };
  }

  async function searchResource(workspace, request) {
    const inventory = await owners.readSearchInventory({ dir: workspace.dir, repository: workspace.repo,
      ...(request.query === null ? {} : { query: request.query }), history: request.history, ...request.where });
    return { source_kind: KIND.SEARCH, subject: request, unit: null, revision: inventory.source_signature, inventory };
  }

  function reopen(workspace, carrier) {
    if (carrier.source_kind === KIND.ASSIGNMENT) return assignmentResource();
    if (carrier.source_kind === KIND.SEARCH) return searchResource(workspace, carrier.subject);
    return boundSubject(workspace, carrier.subject);
  }

  const bindingFor = async (workspace, unit) => ({ route: READ_WIKI_TOOL, repository: workspace.repo,
    unit: unit ?? null, authority_identity: await sessionAuthority(workspace) });

  async function retainResource(workspace, resource, descriptor = {}) {
    return retainSelectedResponseSource({
      binding: { ...(await bindingFor(workspace, resource.unit)), observation_identity: resource.revision ?? null,
        query_identity: { source_kind: resource.source_kind, subject: resource.subject } },
      carrier: { source_kind: resource.source_kind, subject: resource.subject, revision: resource.revision ?? null,
        ...(resource.authoring_revision === undefined ? {} : { authoring_revision: resource.authoring_revision }),
        scope: resource.scope ?? null,
        ...(resource.inventory === undefined ? {} : { observed_records: resource.inventory.observed_records }), ...descriptor }
    }, { env });
  }

  function applicableSelections(resource, context = {}) {
    const selections = [];
    const add = (select, sourceKind = resource.source_kind) => {
      if (granted(sourceKind, selectionName(select))) selections.push(select);
    };
    switch (resource.source_kind) {
      case KIND.RECORD:
        if (context.user_requirements_extent?.length < context.user_requirements_extent?.total) {
          add({ field: "sections.user_requirements" });
        }
        if (context.context?.length < context.context?.total) add({ field: context.context.field });
        if (resource.facts.entry_count > 0) add({ inventory: "entries" });
        if (resource.facts.task_count > 0) add({ inventory: "tasks" });
        if (resource.scope === "record" && resource.facts.slice_count > 0) add({ inventory: "slices" });
        add({ inventory: "fields" });
        if (resource.facts.entry_count === 0) add({ inventory: "entries" });
        if (resource.facts.task_count === 0) add({ inventory: "tasks" });
        if (resource.scope === "record" && resource.facts.slice_count === 0) add({ inventory: "slices" });
        add({ integrity: true });
        add({ currentness: true });
        add({ contract: "coverage" });
        break;
      case KIND.CANONICAL_RECORD:
        add({ field: "record" });
        if (resource.value?.record_kind === "initiative") {
          add({ membership: "work" });
          add({ membership: "integration" });
        }
        break;
      case KIND.DOCUMENT:
        add({ field: "markdown" });
        add({ field: "body" });
        add({ integrity: true });
        break;
      case KIND.MANIFEST:
        add({ field: "manifest" });
        break;
      case KIND.REPOSITORY:
        add({ integrity: true });
        break;
      case KIND.REQUIREMENT_GUIDANCE: {

        const focused = resource.subject.topic === undefined ? [] : [resource.subject.topic];
        const listed = new Set(focused.map((topic) => JSON.stringify(topic)));
        for (const topic of [...focused, ...REQUIREMENT_AUTHORING_GUIDANCE_TOPICS
          .filter((candidate) => !listed.has(JSON.stringify(candidate)))]) add({ guidance: [...topic] });
        break;
      }
      case KIND.SEARCH:
        add({ inventory: "matches" });
        add({ currentness: true });
        break;
      case KIND.ASSIGNMENT:
        add({ field: "guidance" });
        add({ contract: "coverage" }, KIND.ASSIGNED_CONTRACT);
        break;
      case KIND.ENTRY:
      case KIND.PACKAGE_DOCUMENT:
        add({ field: "text" });
        break;
      default:
        break;
    }
    return selections;
  }

  function workContext(resource) {
    if (resource.source_kind !== KIND.RECORD || !granted(KIND.RECORD, "field")) return {};
    let requirements = {};
    if (sessionRole === "orchestrator") {
      const navigation = projectWorkRecordNavigation({ loaded: resource.loaded,
        unit: parseWorkRecordSummaryUnit(resource.subject), repository: null,
        isToolVisible: () => false, isOrchestratorPresentation: () => true });
      const { value, ...extent } = navigation.user_requirements;
      requirements = { user_requirements: value, user_requirements_extent: extent };
    }
    const text = resource.owner.sections?.summary;
    const summary = typeof text === "string" ? Array.from(text) : [];
    return { ...requirements, ...(summary.length === 0 ? {} : { context: {
      field: "sections.summary", unit: resource.subject, source_digest: resource.revision,
      value: summary.slice(0, 240).join(""), length: Math.min(summary.length, 240), total: summary.length
    } }) };
  }

  function contextResult(workspace, resource, reference, extra = {}) {
    const context = workContext(resource);
    const selections = applicableSelections(resource, context);

    const expanded = resource.source_kind === KIND.RECORD || resource.source_kind === KIND.REQUIREMENT_GUIDANCE
      ? selections.slice(0, 1) : selections;
    return {
      ...(workspace === null ? {} : { workspaceRepo: workspace.repo }),
      source_kind: resource.source_kind,
      subject: resource.subject,
      revision: resource.authoring_revision ?? resource.revision ?? null,
      ...(resource.authoring_revision === undefined ? {} : { source_revision: resource.revision }),
      complete: false,
      ...resource.facts === undefined ? {} : { facts: resource.facts },
      transport_retention: { performed: false },
      ...context,
      ...extra,
      reference,
      selections,
      effects: { reads: [resource.source_kind], writes: [] },

      observed_facts: { "selected_response.query_valid": true },
      ...followUps(expanded.map((select) => ({ reference, select })))
    };
  }

  async function subjectContext(args) {
    const workspace = resolveWorkspaceReadRepo({});
    const resource = await boundSubject(workspace, args.subject);
    requireGrant(resource.source_kind, "context");
    const reference = await retainResource(workspace, resource);
    return jsonContent(contextResult(workspace, resource, reference, {
      transport_retention: { performed: true, kind: "selected_resource_descriptor" } }));
  }

  async function assignmentContext() {
    const resource = assignmentResource();
    requireGrant(KIND.ASSIGNMENT, "context");
    const workspace = resolveWorkspaceRepo(workspaceRepos, undefined);
    return jsonContent(contextResult(workspace, resource, await retainResource(workspace, resource),
      { transport_retention: { performed: true, kind: "selected_resource_descriptor" } }));
  }

  async function searchContext(args) {
    const workspace = resolveWorkspaceReadRepo({});
    requireGrant(KIND.SEARCH, "context");
    const resource = await searchResource(workspace, { query: args.search.query ?? null, where: args.search.where ?? {},
      history: args.search.history === true, inventory: args.search.inventory === true });
    const { inventory } = resource;
    const shown = inventory.members.slice(0, SEARCH_CONTEXT_LIMIT).map((member) => ({
      relativePath: member.relativePath, id: member.id, title: member.title, heading: member.heading,
      ...(member.score === undefined ? {} : { score: member.score }), source: {
        kind: member.source.kind, scalar_length: member.source.scalar_length,
        ...(member.source.source_id === undefined ? {} : { source_id: member.source.source_id }),
        ...(member.source.unit === undefined ? {} : { unit: member.source.unit,
          entry_id: member.source.entry_id, version_id: member.source.version_id }) } }));
    return jsonContent(contextResult(workspace, resource, await retainResource(workspace, resource), {
      total_count: inventory.total_count, returned_count: shown.length,
      omitted_count: inventory.total_count - shown.length, filters: inventory.filters, results: shown,
      transport_retention: { performed: true, kind: "selected_resource_descriptor" } }));
  }

  function fieldNotApplicable(resource, field, fields, reference) {
    const details = { field, applicable: fields.map((item) => item.field), reference,
      selections: applicableSelections(resource, workContext(resource)) };
    const corrected = { reference, select: { context: true } };
    if (!granted(KIND.RECORD, "context") || !inputSchema.safeParse(corrected).success) {
      return invalid("field_not_applicable", details);
    }
    return correctable("field_not_applicable", details, corrected,
      "select.field names a field this saved work unit carries",
      "the call returns this reference's context and the selections it offers, from which the caller " +
        "chooses; it does not return the whole record or the refused field");
  }

  async function selectValue(workspace, resource, select, reference) {
    const name = selectionName(select);
    if (resource.source_kind === KIND.RECORD) {
      const { owner, scope, record, loaded } = resource;
      const fields = workFields(scope);
      if (name === "inventory") {
        if (select.inventory === "fields") {
          const members = fields.map((entry) => ({ field: entry.field, kind: entry.kind,
            present: valueAt(owner, entry.canonical_address) !== undefined }));
          return { inventory: "fields", total_count: members.length, members };
        }
        if (select.inventory === "entries") {
          const members = (owner.sections?.entries ?? []).map((entry) => ({ entry: entry.id,
            current_version: entry.current_version, version_count: entry.versions.length,
            title: entry.versions.find((version) => version.id === entry.current_version)?.title ?? null,
            kind: entry.versions.find((version) => version.id === entry.current_version)?.kind ?? null }));
          return { inventory: "entries", total_count: members.length, members,
            ...(members.length > 0 && granted(KIND.RECORD, "entry") ? {
              selection_context: { tool: READ_WIKI_TOOL, reference,
                binding: "Use this reference unchanged with select:{entry:members[i].entry}; optional version selects an exact saved version." },
              ...followUps([{ reference, select: { entry: members[0].entry } }]) } : { next_calls: [] }) };
        }
        if (select.inventory === "tasks") {
          const members = (owner.sections?.tasks ?? []).map((task, index) => ({ index, ...task }));
          return { inventory: "tasks", total_count: members.length, members };
        }
        if (select.inventory === "slices" && scope === "record") {
          const members = (record.slices ?? []).map((slice) => ({ id: slice.id, unit: `${record.id}#${slice.id}`,
            title: slice.title ?? null, status: slice.status ?? null, work_kind: slice.work_kind ?? null,
            ...reviewPurposeFact(slice) }));
          return { inventory: "slices", total_count: members.length, members };
        }
      }
      if (name === "field") {
        const parentRequirements = select.field === "sections.user_requirements";
        const entry = (parentRequirements ? workFields("record") : fields)
          .find((candidate) => candidate.field === select.field);
        if (entry === undefined) throw fieldNotApplicable(resource, select.field, fields, reference);
        const value = valueAt(parentRequirements ? record : owner, entry.canonical_address);
        return { field: entry.field, present: value !== undefined, value: value === undefined ? null : value,
          ...(parentRequirements ? { field_unit: record.id } : {}) };
      }
      if (name === "integrity") {
        return { integrity: "record", valid: loaded.valid === true, diagnostics: loaded.diagnostics ?? [],
          source_path_relative: loaded.source_path_relative,
          policy_facts: projectWorkRecordPrivateScopePolicyFacts(record) };
      }
      if (name === "text") {
        const choices = workRecordProseRegistryEntries(scope).flatMap(({ field }) => {
          const value = selectWorkRecordSourceText({ loaded, repository: workspace.repo, recordId: record.id,
            sliceId: scope === "slice" ? owner.id : null, field, literal: select.text });
          return value.ok ? value.choices : [];
        });
        for (let taskIndex = 0; taskIndex < (owner.sections?.tasks ?? []).length; taskIndex += 1) {
          const selected = selectWorkRecordSourceText({ loaded, repository: workspace.repo, recordId: record.id,
            sliceId: scope === "slice" ? owner.id : null, field: "sections.tasks.text", taskIndex, literal: select.text });
          if (selected.ok) choices.push(...selected.choices.map(choice => ({ ...choice, task_index: taskIndex })));
        }
        return { text: select.text, total_count: choices.length, ambiguous: choices.length > 1, choices };
      }
      if (name === "entry") return selectEntry(workspace, resource, select);
      if (name === "contract" || name === "obligation") return selectContract(workspace, resource.subject, select);
    }
    if (resource.source_kind === KIND.ASSIGNMENT) {
      if (name === "field" && select.field === "guidance") {
        return { field: "guidance", value: resource.presentation.guidance, identity: resource.presentation.identity,
          scalar_length: scalars(resource.presentation.guidance) };
      }
      if (name === "text") return selectText([{ field: "guidance", text: resource.presentation.guidance }], select.text);
      if (name === "contract" || name === "obligation") return selectContract(workspace, resource.unit, select);
    }
    if (resource.source_kind === KIND.CANONICAL_RECORD) {
      if (name === "field" && select.field === "record") {
        return { field: "record", value: resource.value.record ?? null, valid: resource.value.valid ?? null,
          diagnostics: resource.value.diagnostics ?? [] };
      }
      if (resource.value.record_kind === "initiative") {
        if (name === "membership" && select.membership === "work") {
          const status = await owners.runInitiativeStatus({ repoRoot: workspace.dir,
            initiative: resource.subject, verbose: true });
          return { membership: "work", ...(await projectInitiativeGuidance(status)),
            ...followUps(granted(KIND.CANONICAL_RECORD, "action")
              ? status.top_actions.map(action => ({ reference, select: { action: action.id ?? action.target_unit } })) : []) };
        }
        if (name === "membership" && select.membership === "integration") {
          return { membership: "integration", ...(await owners.buildWorkspaceIntegrationStatus({
            workspaceRepo: workspace.repo, workspaceDir: workspace.dir, initiative: resource.subject })) };
        }
        if (name === "action") {

          const unit = WORK_UNIT_PATTERN.test(select.action) ? select.action : null;
          if (unit !== null) {
            const loaded = await owners.readWorkRecordById({ dir: workspace.dir, id: unit.split("#")[0] });
            if (loaded.record?.initiative !== resource.subject) {
              throw invalid("action_not_found", { subject: resource.subject, action: select.action });
            }
          }
          const status = await owners.runInitiativeStatus({ repoRoot: workspace.dir,
            initiative: resource.subject, ...(unit === null ? {} : { unit }), verbose: true });
          const selected = status.top_actions.find(action => (action.id ?? action.target_unit) === select.action);
          if (selected === undefined || unit !== null &&
              (!status.evidence.unit_resolved || status.evidence.initiative_mismatch)) {
            throw invalid("action_not_found", { subject: resource.subject, action: select.action });
          }

          if (unit === null) {
            const { consistency: _rows, consistency_total: _total, consistency_returned: _returned,
              consistency_truncated: _truncated, ...facts } = status;
            return { action: select.action, ...(await projectInitiativeGuidance({ ...facts,
              top_actions: [selected], top_actions_total: 1,
              top_actions_returned: 1, top_actions_truncated: false, next_action: selected })) };
          }
          return { action: select.action, ...(await projectInitiativeGuidance(status)) };
        }
      }
    }
    if (resource.source_kind === KIND.DOCUMENT) {
      if (name === "field" && (select.field === "markdown" || select.field === "body")) {
        return { field: select.field, value: resource.value[select.field], scalar_length: scalars(resource.value[select.field]) };
      }
      if (name === "text") return selectText([{ field: "markdown", text: resource.value.markdown }], select.text);
      if (name === "integrity") {
        return { integrity: "document", ...(await owners.validateDocsPolicyOperation({ dir: workspace.dir,
          paths: [resource.subject], verbose: true, include_all_findings: true })) };
      }
    }
    if (resource.source_kind === KIND.MANIFEST && name === "field" && select.field === "manifest") {
      return { field: "manifest", value: resource.value };
    }
    if (resource.source_kind === KIND.REPOSITORY && name === "integrity") {
      return { integrity: "repository", ...(await owners.lintRepo({ dir: workspace.dir, includeAllFindings: true })) };
    }
    if (resource.source_kind === KIND.REQUIREMENT_GUIDANCE && name === "guidance") {
      const resolved = resolveRequirementAuthoringGuidance(select.guidance);
      if (!resolved.ok) throw guidanceTopicRefusal(select.guidance, resolved);

      const returned = JSON.stringify(select.guidance);
      return { guidance: [...select.guidance], value: resolved.value, reference,
        selections: applicableSelections(resource).filter((offered) => JSON.stringify(offered.guidance) !== returned) };
    }
    if (resource.source_kind === KIND.SEARCH && name === "inventory" && select.inventory === "matches") {
      const { inventory } = resource;
      return { inventory: "matches", total_count: inventory.total_count, filters: inventory.filters,
        query: inventory.query, history: inventory.history, members: inventory.members };
    }
    throw invalid("selection_not_applicable", { source_kind: resource.source_kind, select,
      applicable: applicableSelections(resource) });
  }

  async function selectEntry(workspace, resource, select) {
    const base = { dir: workspace.dir, repository: workspace.repo, callRepository: null, unit: resource.subject,
      entryId: select.entry };
    const refuse = (result) => invalid("entry_unavailable", { entry: select.entry, version: select.version ?? null,
      code: result.diagnostics?.[0]?.code ?? null, message: result.diagnostics?.[0]?.message ?? null });
    if (select.history === true) {
      const versions = [];
      for (let offset = 0, digest; ;) {
        const page = await owners.readWorkRecordEntry({ ...base, view: "history", offset,
          ...(offset === 0 ? {} : { expectedSourceDigest: digest }) });
        if (page.ok !== true) throw refuse(page);
        versions.push(...page.versions);
        if (page.next_calls.length === 0) {
          return { entry: select.entry, history: true, total_count: page.total_count, versions };
        }
        offset = versions.length;
        digest = page.source_digest;
      }
    }
    const body = await owners.readWorkRecordEntry({ ...base, version: select.version, includeBody: true });
    if (body.ok !== true) throw refuse(body);

    const material = await owners.readWorkRecordEntry({ ...base, entryId: body.entry_id,
      version: body.version_id, referenceOnly: true });
    if (material.ok !== true) throw refuse(material);
    const { next_calls: _calls, response_size: _size, ...entry } = body;
    return { entry: select.entry, ...entry, reference: material.reference };
  }

  async function selectContract(workspace, unit, select) {
    const [wkId] = unit.split("#");
    let context;

    const stored = await obligationCoverageQueryOperation(async () => {
      context = await owners.resolveObligationCoverageQueryContext({ env, workspace });
      assertObligationCoverageQueryScope(context, { unit });
      return owners.queryControlledContractObligationCoverageOperation({ repoRoot: context.sourceRoot, wkId,
        ...(unit === wkId ? {} : { selectedUnit: unit.split("#")[1] }), view: "complete", population: context.population,
        ...(select.obligation === undefined ? {} : { obligationId: select.obligation,
          ...(select.parameters === true ? { parameterDetail: true } : {}) }) });
    });
    if (stored?.ok === false) {
      throw Object.assign(new Error(stored.message ?? stored.code ?? "saved contract unavailable"),
        { code: stored.code, envelope: stored });
    }

    const saved = !Array.isArray(stored.cases) ? stored : { ...stored, cases: stored.cases.map((definition) =>
      definition.target === undefined ? definition
        : { ...definition, target: authorableNativeCaseTarget(definition.target) }) };
    if (select.obligation !== undefined) return { obligation: select.obligation, population: context.population, ...saved };
    const value = select.contract === "criteria" ? saved.acceptance_criteria
      : select.contract === "coverage" ? saved : saved[select.contract];
    return { contract: select.contract, population: context.population,
      present: saved.status !== "source_absent",
      total_count: Array.isArray(value) ? value.length : value === undefined || value === null ? 0 : 1,
      members: value ?? null };
  }

  function selectText(sources, literal) {
    const matches = sources.flatMap(({ field, text }) =>
      literalOccurrences(text, literal).map((occurrence) => ({ field, ...occurrence })));
    return { text: literal, total_count: matches.length, ambiguous: matches.length > 1, matches };
  }

  async function selectEntryText(workspace, decoded, literal) {
    const unit = decoded.u === null || decoded.u === undefined ? decoded.w : `${decoded.w}#${decoded.u}`;
    const base = { dir: workspace.dir, repository: workspace.repo, callRepository: null, unit };
    const references = ({ occurrence, offset, length, before_ref: before, match_ref: match, after_ref: after }) =>
      ({ occurrence, offset, length, before_ref: before, match_ref: match, after_ref: after });
    const selected = await owners.readWorkRecordEntry({ ...base, entryId: decoded.e, version: decoded.n,
      selection: { text: literal } });
    const state = selected.selection?.state;
    if (state === "unique") {
      return { text: literal, total_count: 1, ambiguous: false, choices: [references(selected.selection)] };
    }
    if (state === "no_match") return { text: literal, total_count: 0, ambiguous: false, choices: [] };
    if (state !== "ambiguous") {
      throw invalid("entry_unavailable", { code: selected.diagnostics?.[0]?.code ?? null,
        message: selected.diagnostics?.[0]?.message ?? null });
    }
    const choices = [];
    for (const choice of selected.selection.choices) {
      const resolved = await owners.readWorkRecordEntry({ ...base, continuation: choice.next_call.arguments.continuation });
      if (resolved.selection?.state !== "unique") {
        throw invalid("entry_choice_unavailable", { occurrence: choice.occurrence,
          code: resolved.diagnostics?.[0]?.code ?? null });
      }
      choices.push(references({ ...resolved.selection, occurrence: choice.occurrence }));
    }
    return { text: literal, total_count: selected.selection.total_count, ambiguous: true,
      returned_count: choices.length, choices };
  }

  function deliver(reference, workspace, expected, select, projectValue, retainedHere = false) {
    return readSelectedResponseProjection(reference, { env, expected, project: async ({ carrier }) => ({
      ...(workspace === null ? {} : { workspaceRepo: workspace.repo }),
      source_kind: carrier.source_kind, subject: carrier.subject, select, complete: true, next_calls: [],
      ...(await projectValue(carrier)),
      effects: { reads: [carrier.source_kind], writes: [] },
      transport_retention: { performed: retainedHere,
        ...(retainedHere ? { kind: "selected_resource_descriptor" } : {}) }
    }) });
  }

  async function ownerReferenceRead(args) {
    const workspace = resolveWorkspaceReadRepo({});
    const select = args.select ?? { context: true };
    const name = selectionName(select);
    requireGrant(KIND.ENTRY, name);
    const subject = { ref: args.reference.ref };
    const resolve = async () => {
      if (subject.ref.startsWith("ws1.")) {
        let selected;
        try {
          selected = await owners.readCompleteSearchSource({ dir: workspace.dir, repository: workspace.repo,
            reference: subject.ref });
        } catch (error) {
          const path = error.envelope?.subject?.path;

          if (!["search_source_changed", "search_source_reordered"].includes(error.code) ||
              !DOCUMENT_PATH_PATTERN.test(path) || !granted(KIND.DOCUMENT, "context")) throw error;
          throw correctable(error.code, { subject: error.envelope.subject,
            cause: { code: error.code, message: error.message } }, { subject: path },
          "the selected passage's source changed; inspect the current context of that source",
          "the call returns current source context and a fresh reference; the old passage is not replayed");
        }
        return { ...selected, value: selected.text, scalar_length: selected.length,
          utf8_bytes: Buffer.byteLength(selected.text, "utf8"), content_digest: selected.source_digest };
      }
      const resolved = await owners.resolveWorkRecordEntryContent({ content: { parts: [subject] },
        repository: workspace.repo, dir: workspace.dir, loadWorkRecordById: owners.readWorkRecordById });
      if (resolved.ok !== true) {
        throw invalid("reference_unavailable", { code: resolved.diagnostic?.code ?? null,
          message: resolved.diagnostic?.message ?? null });
      }
      return resolved;
    };
    const resolved = await resolve();
    const identity = { scalar_length: resolved.scalar_length, utf8_bytes: resolved.utf8_bytes,
      content_digest: resolved.content_digest ?? null, source_closure: resolved.source_closure ?? [] };
    const resource = { source_kind: KIND.ENTRY, subject, unit: null, revision: resolved.content_digest ?? null,
      facts: identity };
    if (name === "context") return jsonContent(contextResult(workspace, resource, subject));
    if (!((name === "field" && select.field === "text") || name === "text")) {
      throw invalid("selection_not_applicable", { source_kind: KIND.ENTRY, select });
    }
    const descriptor = await retainResource(workspace, resource);
    return deliver(descriptor, workspace, await bindingFor(workspace, null), select, async () => {
      if (name === "field") return { field: "text", value: resolved.value, ...identity };
      const decoded = decodeWorkRecordEntryReference(subject.ref);

      return decoded !== null && decoded.o === 0 && decoded.l === decoded.t
        ? selectEntryText(workspace, decoded, select.text)
        : subject.ref.startsWith("ws1.") ? selectText([{ field: "text", text: resolved.value }], select.text)
          : selectWorkRecordReferenceText({ reference: subject.ref, text: resolved.value, literal: select.text });
    }, true);
  }

  async function packageDocumentRead(args) {
    const select = args.select ?? { context: true };
    const name = selectionName(select);
    requireGrant(KIND.PACKAGE_DOCUMENT, name);
    if (readPackageDocument === null) throw invalid("package_documents_unavailable", {});
    const subject = { tool_name: args.reference.tool_name, path: args.reference.path };
    const { text, schema_version: _schema, ok: _ok, ...identity } = await readPackageDocument(subject,
      { operation: READ_WIKI_TOOL });
    const resource = { source_kind: KIND.PACKAGE_DOCUMENT, subject, unit: identity.path, revision: identity.sha256,
      facts: { ...identity, text_scalars: scalars(text) } };
    if (name === "context") return jsonContent(contextResult(null, resource, subject));
    if (!(name === "field" && select.field === "text")) {
      throw invalid("selection_not_applicable", { source_kind: KIND.PACKAGE_DOCUMENT, select });
    }
    const owner = { repo: identity.owner_package };
    const descriptor = await retainResource(owner, resource);
    return deliver(descriptor, null, await bindingFor(owner, identity.path), select,
      async () => ({ field: "text", value: text, ...identity }), true);
  }

  function receiptRead(args, source, binding, workspace) {
    const select = args.select ?? (args.reference.finding_id === undefined ? { context: true }
      : { finding: args.reference.finding_id });
    const name = selectionName(select);
    if (!grants.rows.some(row => row.source_kind === KIND.RECEIPT)) requireGrant(KIND.RECEIPT, name);
    const read = (findingId) => owners.readCloseoutReceipt({ repository: workspace.repo, unit: binding.unit, env,
      receipt: { ...source, ...(findingId === undefined ? {} : { finding_id: findingId }) } });

    const listing = read();
    requireGrant(KIND.RECEIPT, name);
    const present = { reads: [KIND.RECEIPT], writes: [], checks_run: [] };
    const frame = { workspaceRepo: workspace.repo, source_kind: KIND.RECEIPT, subject: binding.unit };
    if (name === "context") {
      return jsonContent({ ...frame, complete: listing.findings_omitted === 0, ...listing, reference: source,
        present_read_effects: present, ...followUps(listing.findings.slice(0, listing.next_calls.length)
          .map((item) => ({ reference: { ...source, finding_id: item.finding_id } }))) });
    }
    if (!(name === "finding" || name === "inventory" && select.inventory === "findings")) {
      throw invalid("selection_not_applicable", { source_kind: KIND.RECEIPT, select });
    }
    return owners.readCompleteCloseoutReceipt({ repository: workspace.repo, unit: binding.unit, env,
      receipt: { ...source, ...(name === "finding" ? { finding_id: select.finding } : {}) },
      project: original => ({ ...frame, select, complete: true, ...original,
        present_read_effects: present, next_calls: [] }) });
  }

  async function receiptSelectionRefusal(source, stored, selection) {
    const details = { source_kind: KIND.RECEIPT, selection, role: sessionRole };
    const corrected = { subject: stored.unit };
    if (stored.route !== SAVE_RECORD_ROUTE || readOriginalReference === null ||
        !WORK_UNIT_PATTERN.test(String(stored.unit)) ||
        !grants.rows.some((row) => row.source_kind === KIND.RECEIPT) || !granted(KIND.RECORD, "context") ||
        !inputSchema.safeParse(corrected).success) return invalid("selection_not_granted", details);

    const original = await readOriginalReference({ args: { reference: source }, source, binding: stored });
    if (original === null || original.isError === true || original.structuredContent?.unit !== stored.unit) {
      return invalid("selection_not_granted", details);
    }
    return correctable("selection_not_granted", details, corrected,
      "the reference names a save receipt, which offers no record or contract selection",
      "the call returns the current context of the receipt's saved unit and a fresh reference with the " +
        "selections it offers; it does not apply the refused selection");
  }

  async function referenceRead(args) {
    if (args.reference.ref !== undefined) return ownerReferenceRead(args);
    if (args.reference.tool_name !== undefined) return packageDocumentRead(args);
    const source = { ref_id: args.reference.ref_id };

    const stored = readSelectedResponseSource(source, { env, expected: {}, route: READ_WIKI_TOOL }).binding;
    const workspace = stored.route === READ_WIKI_TOOL && sessionRole === "worker"
      ? resolveWorkspaceRepo(workspaceRepos, undefined) : resolveWorkspaceReadRepo({});
    if (stored.repository !== workspace.repo) {
      throw invalid("reference_repository_mismatch", { session_repository: workspace.repo });
    }
    if (stored.route !== READ_WIKI_TOOL) {
      const requested = selectionName(args.select ?? { context: true });
      if (!granted(KIND.RECEIPT, requested)) throw await receiptSelectionRefusal(source, stored, requested);
      if (readOriginalReference !== null) {
        const original = await readOriginalReference({ args, source, binding: stored });
        if (original !== null) return original;
      }
      return receiptRead(args, source, stored, workspace);
    }
    if (args.reference.finding_id !== undefined) {
      throw invalid("finding_id_requires_receipt", { reference_route: READ_WIKI_TOOL });
    }
    const expected = await bindingFor(workspace, stored.unit);
    const select = args.select ?? { context: true };
    const name = selectionName(select);
    const grantKind = (carrier) => (carrier.source_kind === KIND.ASSIGNMENT &&
      (name === "contract" || name === "obligation") ? KIND.ASSIGNED_CONTRACT : carrier.source_kind);
    const sourceMoved = (carrier, resource) => correctable("source_moved", { source_kind: carrier.source_kind,
      subject: carrier.subject, observed_revision: carrier.authoring_revision ?? carrier.revision,
      current_revision: resource.authoring_revision ?? resource.revision },
    carrier.source_kind === KIND.SEARCH
      ? { search: Object.fromEntries(Object.entries({ query: carrier.subject.query ?? undefined,
          where: Object.keys(carrier.subject.where).length > 0 ? carrier.subject.where : undefined,
          history: carrier.subject.history || undefined, inventory: carrier.subject.inventory || undefined })
          .filter(([, value]) => value !== undefined)) }
      : carrier.source_kind === KIND.ASSIGNMENT ? { assignment: true } : { subject: carrier.subject },
    "the selected source changed after this reference was returned",
    "the call returns the current context of the same subject and a fresh reference; it does not apply the earlier selection");

    if (name === "context") {
      const { carrier } = readSelectedResponseSource(source, { env, expected });
      requireGrant(carrier.source_kind, "context");
      const resource = await reopen(workspace, carrier);
      if ((carrier.revision === null || resource.revision === carrier.revision) &&
          (carrier.authoring_revision === undefined || resource.authoring_revision === carrier.authoring_revision)) {
        return jsonContent(contextResult(workspace, resource, source));
      }

      return jsonContent(contextResult(workspace, resource, await retainResource(workspace, resource),
        { transport_retention: { performed: true, kind: "selected_resource_descriptor" },
          recovered: { code: "source_moved", applied: "fresh_context_of_same_subject", attempts: 1,
          observed_revision: carrier.authoring_revision ?? carrier.revision,
          current_revision: resource.authoring_revision ?? resource.revision, superseded_reference: source } }));
    }
    return deliver(source, workspace, expected, select, async (carrier) => {
      requireGrant(grantKind(carrier), name);
      if (name === "currentness" && carrier.source_kind === KIND.SEARCH) {
        const entries = carrier.observed_records;
        const compared = await compareObservedWorkRecords({ dir: workspace.dir, entries,
          readRecord: owners.readWorkRecordById });
        return { currentness: true, complete: compared.has_more === false, checked: compared.results, ...compared };
      }
      if (name === "currentness" && carrier.source_kind === KIND.RECORD) {
        const compared = await compareObservedWorkRecords({ dir: workspace.dir,
          entries: [{ id: carrier.subject.split("#")[0], observed_source_digest: carrier.revision }],
          readRecord: owners.readWorkRecordById });
        return { currentness: true, complete: compared.has_more === false, checked: compared.results, ...compared };
      }
      const resource = await reopen(workspace, carrier);

      const immutableEntryVersion = carrier.source_kind === KIND.RECORD && name === "entry" && select.version !== undefined;
      if (name === "currentness") resource.observed_revision = carrier.revision;
      else if (!immutableEntryVersion && (carrier.revision !== null && resource.revision !== carrier.revision ||
          carrier.authoring_revision !== undefined && resource.authoring_revision !== carrier.authoring_revision)) {
        throw sourceMoved(carrier, resource);
      }
      return { revision: resource.authoring_revision ?? resource.revision ?? null,
        ...(await selectValue(workspace, resource, select, source)) };
    });
  }

  const projectInputFailure = async ({ args, validationError, tool }) => {
    const { select: _select, ...withoutSelect } = args !== null && typeof args === "object" ? args : {};
    const corrected = args?.select !== undefined && inputSchema.safeParse(withoutSelect).success
      ? [withoutSelect] : [];
    return { terminal_result: errorContent(createToolInputValidationError({ tool, validationError,
      nextCalls: corrected.map((item) => call(item, true)) })) };
  };

  return {
    name: READ_WIKI_TOOL,
    config: {
      description: describeReadWikiTool(inputSchema),
      inputSchema,
      inputValidationErrorProjector: projectInputFailure
    },

    handler: async (args) => {
      try {
        authenticateFrozenReviewSource();
        if (args.reference !== undefined) return await referenceRead(args);
        if (args.search !== undefined) return await searchContext(args);
        if (args.subject !== undefined) return await subjectContext(args);
        if (args.assignment !== undefined) return await assignmentContext();
        throw invalid("source_not_available", { sources: Object.keys(args) });
      } catch (error) {
        return errorContent(error);
      }
    },
    call
  };
}

export function registerReadWikiTools({ registerTool, ...composition }) {
  const task = createReadWikiTask({ ...composition, requestContracts: registeredToolRequestContracts(registerTool) });
  if (task !== null) registerTool(task.name, task.config, task.handler);
  return task;
}
