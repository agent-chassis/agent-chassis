import { scopeDirectory, entryJson, entryNode, entryNodeValue } from './read-wiki-semantic-navigation.mjs';
import { canonicalJson } from '@agent-chassis/wiki-core/src/lib/controlled-requirement-authoring-schema.mjs';
import { DEFAULT_EXCEPTION_PUBLICATION } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { readRequirementModel, requirementQuerySelection } from "./requirement-model-read.mjs";
import { searchChoice, searchLimitations, searchPathSubject } from "./read-wiki-search-presentation.mjs";
import { readWikiRefusal } from "./read-wiki-refusal.mjs";
import { readWikiContractMeaning } from "./read-wiki-contract-presentation.mjs";
import { readWikiCurrentness } from "./read-wiki-currentness.mjs";
import { projectRequirementDefinitionMeaning } from '@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-description-sources.mjs';
import { decodeSearchToken } from "@agent-chassis/wiki-core/src/lib/search-source-reader.mjs";
import { sessionRequirementAuthoringGuidance, requirementGuidanceRevision, requirementGuidanceDetailNavigation } from "./requirement-authoring-guidance.mjs";

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
} from "./selected-response-snapshot.mjs";
import { REQUIREMENT_GUIDANCE_SUBJECT, resolveRequirementAuthoringGuidance,
  requirementCaseFamilySelections } from
  "./requirement-authoring-guidance.mjs";
import { createReadWikiInputContractReader } from "./task-read-wiki-input-contract.mjs";
import { createSaveRecordInputNavigation } from "./save-record-input-navigation.mjs";
import { SAVE_RECORD_TOOL_NAME, saveRecordUnitVariant } from "./task-save-record-tools.mjs";
import { createReadWikiContextDelivery } from "./read-wiki-context-delivery.mjs";
import { createReadWikiRecordKindSource } from "./task-read-wiki-record-kind.mjs";
import { publishedReadWikiInputSchema } from "./task-read-wiki-selection-forms.mjs";
import { createReadWikiInputSchema, describeReadWikiTool, requirementChoiceQueryIssue, WORK_RECORD_PLANNING_READ_FIELDS } from "./task-read-wiki-schema.mjs";
import { READ_WIKI_SOURCE_KINDS as KIND, READ_WIKI_TOOL, createReadWikiGrants } from
  "./task-read-wiki-selection.mjs";
import { readCloseoutReceipt, readCompleteCloseoutReceipt } from "./work-record-closeout-response.mjs";
import { SAVE_RECORD_ROUTE } from "./save-record-maintenance.mjs";
import { readSourceBoundAuthoringRevision, readCompleteSearchSource } from "@agent-chassis/wiki-core/src/operations/read.mjs";
import { isPlatformErrorCode } from "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
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
const selectionName = (select) => Object.keys(select).find((key) => !["version", "history", "parameters", "view", "row_id"].includes(key));
const scalars = (value) => Array.from(String(value)).length;

function valueAt(source, address) {
  return address.reduce((current, key) => (current === null || current === undefined ? undefined : current[key]), source);
}

function workFields(scope) {
  const fields = WORK_RECORD_EDIT_FIELD_REGISTRY.filter((entry) => entry.applicability.includes(scope));
  const registered = new Set(fields.map(entry => entry.field));
  return [...fields, ...WORK_RECORD_PLANNING_READ_FIELDS.filter(field => !registered.has(field))
    .map(field => ({ field, kind: "planning", canonical_address: [field] }))];
}

function readableWorkFields(scope) {
  return [...workFields(scope), ...(scope === 'slice'
    ? workFields('record').filter(entry => entry.field === 'sections.user_requirements') : [])];
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
  registeredTier = null,
  exceptionPublication = DEFAULT_EXCEPTION_PUBLICATION,
  env = process.env,
  deps = {}
}) {
  const sessionGuidance = sessionRequirementAuthoringGuidance(registeredTier, exceptionPublication);
  const sessionGuidanceRevision = requirementGuidanceRevision(registeredTier, undefined, exceptionPublication);
  const sessionGuidanceTopics = Object.keys(sessionGuidance).filter(member => !["schema_version", "overview"].includes(member)).map(member => [member]);
  const grants = createReadWikiGrants(policy, sessionRole);
  const inputSchema = createReadWikiInputSchema(z, grants);
  if (inputSchema === null) return null;
  const advertisedInputSchema = createReadWikiInputSchema(z, grants, exceptionPublication);
  const owners = { ...SOURCE_OWNERS, ...deps };
  const projectInitiativeGuidance = createInitiativeGuidanceProjector(requestContracts);
  const { granted } = grants;

  const invalid = (reason, details = {}) => readWikiRefusal(reason, details, details.next_calls ?? []);
  const call = (argumentsValue, recommended = false) =>
    buildNextCall({ tool: READ_WIKI_TOOL, arguments: argumentsValue, recommended });

  const followUps = (argumentList) => ({
    next_calls: argumentList.map((item, index) => call(item, index === 0))
  });
  const correctable = (reason, details, corrected, prerequisite, successCondition) => {
    if (!inputSchema.safeParse(corrected).success) throw new TypeError(`read_wiki_correction_not_accepted: ${reason}`);
    return readWikiRefusal(reason, { ...details, recovery: { state: "callable", prerequisite,
      success_condition: successCondition } }, [call(corrected, true)]);
  };

  function requireGrant(sourceKind, selection) {
    if (!granted(sourceKind, selection)) {
      throw invalid("selection_not_granted", { source_kind: sourceKind, selection, role: sessionRole,
        cause: `Role ${sessionRole} is not granted ${selection} on ${sourceKind}.`,
        recovery: { state: 'no_supported_route', missing_capability: `${sourceKind}.${selection}`,
          reason: 'This session cannot perform the selected read. A read cannot grant the missing capability.' } });
    }
  }

  const selectionContext = (reference, binding) => ({ tool: READ_WIKI_TOOL, reference, binding });
  const readInputContract = createReadWikiInputContractReader({ requestContracts, invalid, readTool: READ_WIKI_TOOL, registeredTier, exceptionPublication });
  const recordKinds = createReadWikiRecordKindSource({ requestContracts, invalid, readTool: READ_WIKI_TOOL });
  const inputNavigation = createSaveRecordInputNavigation({ requestContracts, saveTool: SAVE_RECORD_TOOL_NAME,
    readTool: READ_WIKI_TOOL, variantOf: saveRecordUnitVariant, exceptionPublication });

  async function withAuthoringChoices(result, resource, forChanges) {
    if (forChanges !== undefined) {
      requireGrant(resource.source_kind, 'input_contract');
      const focused = await inputNavigation.focusedContext({ unit: resource.unit,
        reference: result.reference, members: forChanges });
      if (focused?.refusal) {
        const { code, ...details } = focused.refusal;
        throw correctable(code, { subject: resource.subject, ...details,
          effects: { reads: [resource.source_kind], writes: [] } },
          { reference: result.reference, select: { context: true } },
          'The requested members must be distinct members of this saved unit; none was selected or dropped.',
          'Returns ordinary context and complete job choices for the same unit; the caller chooses valid members.');
      }
      if (focused.unavailable) throw invalid('authoring_context_unavailable', { subject: resource.subject,
        requested_members: forChanges, ...focused.unavailable,
        effects: { reads: [resource.source_kind], writes: [] } });
      return { subject: resource.subject, revision: result.revision, reference: result.reference,
        authoring_context: focused.identity, next_calls: [focused.call] };
    }

    if (resource.source_kind === KIND.RECORD_KIND) {
      if (!granted(KIND.RECORD_KIND, "input_contract")) return result;
      const creation = await recordKinds.creationContractCall(resource.subject.record_kind, result.reference);
      return creation === null ? result : { ...result, next_calls: [...result.next_calls, creation] };
    }
    if (typeof resource.unit !== "string" || !granted(resource.source_kind, "input_contract")) return result;
    const choices = await inputNavigation.jobChoices({ unit: resource.unit, reference: result.reference });
    return choices.length === 0 ? result : { ...result, next_calls: [...result.next_calls, ...choices.filter(choice => choice.job !== undefined)] };
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
    if (resolved.code === "record_authoring_operation_unavailable") return correctable(resolved.code,
      { subject: { guidance: [...path] }, operation: resolved.operation, changed: false },
      { subject: REQUIREMENT_GUIDANCE_SUBJECT },
      "Compilation guidance is unavailable in this serving session; no schema was disclosed and nothing changed. Required meaning and applicability remain unchanged.",
      "Read supported authoring information; reading repairs no capability and changes no required meaning or applicability.");
    const correctionSubject = resolved.code === "case_guidance_family_not_supported"
      ? { ...REQUIREMENT_GUIDANCE_SUBJECT, topic: ["case_authoring"] } : REQUIREMENT_GUIDANCE_SUBJECT;
    return correctable("requirement_guidance_topic_not_found", { guidance: [...path], code: resolved.code,
      segment_index: resolved.segment_index, resolved_path: resolved.resolved_path, expected: resolved.expected },
    { subject: correctionSubject }, "the path must name a member of the requirement-authoring guidance",
    "the call returns the guidance context, whose selections are the readable topics");
  }

  function requirementGuidanceResource(subject) {
    requireGrant(KIND.REQUIREMENT_GUIDANCE, "context");
    const topic = subject.topic ?? null;
    if (topic !== null) {
      const resolved = resolveRequirementAuthoringGuidance(topic, registeredTier, exceptionPublication);
      if (!resolved.ok) throw guidanceTopicRefusal(topic, resolved);
    }
    return { source_kind: KIND.REQUIREMENT_GUIDANCE, unit: null, value: sessionGuidance,
      subject: { ...REQUIREMENT_GUIDANCE_SUBJECT, ...(topic === null ? {} : { topic: [...topic] }) },
      revision: sessionGuidanceRevision,
      facts: { schema_version: sessionGuidance.schema_version,
        overview: sessionGuidance.overview, ...(topic === null ? {} : { topic: [...topic] }),
        topic_count: sessionGuidanceTopics.length } };
  }

  function searchHitBinding(population) {
    return { tool: READ_WIKI_TOOL,
      binding: `Choose one ${population}[i]; use {reference:{ref:${population}[i].source.reference},select:{field:"text"}} unchanged to read its complete source. No hit is selected by default.` };
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

      if (Object.hasOwn(subject, "record_kind")) {
        requireGrant(KIND.RECORD_KIND, "context");
        return recordKinds.resource(subject.record_kind);
      }
      requireGrant(KIND.REPOSITORY, "context");
      return { source_kind: KIND.REPOSITORY, subject: { repository: true }, unit: null,
        revision: null, value: null, facts: { repository: workspace.repo } };
    }
    const workUnit = WORK_UNIT_PATTERN.exec(subject);
    if (workUnit !== null) {
      requireGrant(KIND.RECORD, "context");
      const loaded = await owners.readWorkRecordById({ dir: workspace.dir, id: workUnit[1] });
      if (!loaded.record) {
        if (!(loaded.diagnostics ?? []).some(row => row.code === 'missing_json_record')) {
          throw invalid('work_record_source_unavailable', { subject, diagnostics: loaded.diagnostics ?? [],
            cause: `The saved source for ${subject} is invalid or unreadable.`,
            recovery: { state: 'no_supported_route', actor: findingsSession ? 'coordinator_or_operator' : 'repository_owner',
              reason: 'Repair the reported canonical source before reading it; a read cannot replace invalid or captured content.' } });
        }
        throw invalid("subject_not_found", { subject, diagnostics: loaded.diagnostics ?? [],
          cause: `No saved work record exists for ${subject}.`,
          ...(granted(KIND.SEARCH, 'context') ? { next_calls: [call({ search: { query: subject } })] } : {}) });
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
        ...(granted(KIND.REQUIREMENT_GUIDANCE, "context") ? ["{requirement_guidance:true}"] : []),
        ...(granted(KIND.RECORD_KIND, "context") ? ["{record_kind:<kind>}"] : [])] });
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
          caller_correctable: false, actor: findingsSession ? "coordinator_or_operator" : "repository_owner",
          missing_capability: "repair_invalid_canonical_obligation_carrier",
          missing_inputs: ["authenticated current authoring revision"],
          reason: findingsSession
            ? "Repair the invalid carrier, then dispatch a fresh frozen review; reads cannot repair captured bytes."
            : "Repair the invalid carrier before acquiring its current revision." },
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
    let inventory;
    try {
      inventory = await owners.readSearchInventory({ dir: workspace.dir, repository: workspace.repo,
        ...(request.query === null ? {} : { query: request.query }), history: request.history, ...request.where });
    } catch (error) {
      if (error.envelope !== undefined) throw error;
      throw invalid(error.code ?? 'search_source_unavailable', { subject: { search: request },
        cause: { code: error.code ?? 'search_source_unavailable', message: error.message }, details: error.details,
        recovery: { state: 'no_supported_route', actor: findingsSession ? 'coordinator_or_operator' : 'repository_owner',
          reason: 'Repair the stated search source condition; no match population was established and this read repairs nothing.' } });
    }
    return { source_kind: KIND.SEARCH, subject: request, unit: null, revision: inventory.source_signature, inventory };
  }

  function reopen(workspace, carrier) {
    if (carrier.source_kind === KIND.ASSIGNMENT) return assignmentResource();
    if (carrier.source_kind === KIND.SEARCH) return searchResource(workspace, carrier.subject);
    return boundSubject(workspace, carrier.subject);
  }

  const bindingFor = async (workspace, unit) => ({ route: READ_WIKI_TOOL, repository: workspace.repo,
    unit: unit ?? null, authority_identity: await sessionAuthority(workspace) });

  const contextContent = createReadWikiContextDelivery({ env, jsonContent, bindingFor });

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
      if (granted(sourceKind, selectionName(select)) &&
          !selections.some(offered => JSON.stringify(offered) === JSON.stringify(select))) selections.push(select);
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
        if (resource.scope === "slice") add({ field: "sections.user_requirements" });
        if (resource.facts.entry_count === 0) add({ inventory: "entries" });
        if (resource.facts.task_count === 0) add({ inventory: "tasks" });
        if (resource.scope === "record" && resource.facts.slice_count === 0) add({ inventory: "slices" });
        add({ integrity: true });
        add({ currentness: true });
        add({ contract: "requirements", view: "summary" });
        add({ contract: "obligations", view: "associated" });
        add({ contract: "obligations", view: "proofs" });
        add({ contract: "cases" });
        add({ contract: "obligations" });
        add({ contract: "criteria" });
        add({ contract: "references" });
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
        for (const topic of [...focused, ...sessionGuidanceTopics
          .filter((candidate) => !listed.has(JSON.stringify(candidate)))]) add({ guidance: [...topic] });
        break;
      }
      case KIND.SEARCH:
        add({ inventory: "matches" });
        add({ currentness: true });
        break;
      case KIND.ASSIGNMENT:
        add({ field: "guidance" });
        add({ field: "test_commands" });
        add({ contract: "requirements", view: "summary" }, KIND.ASSIGNED_CONTRACT);
        add({ contract: "cases" }, KIND.ASSIGNED_CONTRACT);
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
      const { value, source_digest: _digest, offset: _offset, ...extent } = navigation.user_requirements;
      requirements = { user_requirements: value, user_requirements_extent: extent };
    }
    const text = resource.owner.sections?.summary;
    const summary = typeof text === "string" ? Array.from(text) : [];
    return { ...requirements, ...(summary.length === 0 ? {} : { context: {
      field: "sections.summary",
      value: summary.slice(0, 240).join(""), length: Math.min(summary.length, 240), total: summary.length
    } }) };
  }

  function contextResult(workspace, resource, reference, extra = {}) {
    const context = workContext(resource);
    const selections = applicableSelections(resource, context);
    const primary = [KIND.RECORD, KIND.REQUIREMENT_GUIDANCE, KIND.ASSIGNMENT].includes(resource.source_kind)
      ? selections.slice(0, 1) : selections;

    const nextCalls = primary.map((select, index) => call({ reference, select },
      resource.source_kind !== KIND.RECORD && index === 0));
    if (resource.source_kind === KIND.RECORD) {
      const purposes = { requirements: 'saved_requirements_summary', obligations: 'associated_review_meaning', cases: 'case_authoring_readback' };
      for (const select of selections.filter(select => select.view === 'summary' || select.view === 'associated' || select.contract === 'cases')) {
        if (!primary.includes(select)) nextCalls.push({ ...call({ reference, select }), purpose: purposes[select.contract] });
      }
    }
    const concrete = new Set(nextCalls.map(next => JSON.stringify(next.arguments.select)));
    const choices = selections.filter(select => !concrete.has(JSON.stringify(select)));
    const publicFacts = Object.fromEntries(Object.entries(resource.facts ?? {}).filter(([key, value]) =>
      key === 'valid' && value === false ||
      ['id', 'title', 'status', 'work_kind', 'record_kind', 'review_purpose', 'terminal_review_designation', 'assigned_unit'].includes(key)));
    return {
      source_kind: resource.source_kind, subject: resource.subject,
      ...(resource.authoring_revision === undefined ? {} : { revision: resource.authoring_revision }),
      ...(resource.scope === 'record' && resource.facts.slice_count > 0
        ? { slice_design: { state: 'not_read', count: resource.facts.slice_count } } : {}),
      complete: false, ...(Object.keys(publicFacts).length ? { facts: publicFacts } : {}),
      ...context, ...extra, reference,
      ...(choices.length ? { selections: choices,
        selection_context: { tool: READ_WIKI_TOOL,
          binding: "Choose one selections[i]; call {reference,select:selections[i]} with this answer's reference unchanged. Choices are optional, not continuations." } } : {}),
      next_calls: nextCalls
    };
  }

  async function subjectContext(args) {
    const workspace = resolveWorkspaceReadRepo({});
    const resource = await boundSubject(workspace, args.subject);
    requireGrant(resource.source_kind, "context");
    const reference = await retainResource(workspace, resource);
    return contextContent(await withAuthoringChoices(contextResult(workspace, resource, reference), resource, args.select?.for_changes), workspace, resource);
  }

  async function acquireSavedUnitReference(unit) {
    authenticateFrozenReviewSource();
    const workspace = resolveWorkspaceReadRepo({});
    const resource = await boundSubject(workspace, unit);
    requireGrant(resource.source_kind, "context");
    requireGrant(resource.source_kind, "input_contract");
    if (resource.unit !== unit) throw invalid("subject_not_found", { subject: unit, repository: workspace.repo });
    return { reference: await retainResource(workspace, resource),
      revision: resource.authoring_revision ?? resource.revision ?? null,
      effects: { reads: [resource.source_kind], writes: [],
        transport_retention: { performed: true, kind: "selected_resource_descriptor" } } };
  }

  async function assignmentContext() {
    const resource = assignmentResource();
    requireGrant(KIND.ASSIGNMENT, "context");
    const workspace = resolveWorkspaceRepo(workspaceRepos, undefined);
    return contextContent(contextResult(workspace, resource, await retainResource(workspace, resource)), workspace, resource);
  }

  const searchMember = (member, query) => searchChoice(member, query, subject => {
    const kind = WORK_UNIT_PATTERN.test(subject) ? KIND.RECORD : KIND_RECORD_PATTERN.test(subject) ? KIND.CANONICAL_RECORD : KIND.DOCUMENT;
    return granted(kind, 'context') ? call({ subject }) : undefined;
  });

  function searchInventory(resource) {
    const { inventory } = resource;
    return { inventory: 'matches', total_count: inventory.total_count,
      history: inventory.history, members: inventory.members.map(member => searchMember(member, inventory.query)),
      ...searchLimitations(inventory), selection_context: searchHitBinding('members') };
  }

  async function searchContext(args) {
    const workspace = resolveWorkspaceReadRepo({});
    requireGrant(KIND.SEARCH, 'context');
    const resource = await searchResource(workspace, { query: args.search.query ?? null, where: args.search.where ?? {},
      history: args.search.history === true, inventory: args.search.inventory === true });
    const reference = await retainResource(workspace, resource);
    if (args.search.inventory === true) return deliver(reference, workspace, await bindingFor(workspace, null),
      { inventory: 'matches' }, async () => searchInventory(resource));
    const { inventory } = resource;
    const shown = inventory.members.slice(0, SEARCH_CONTEXT_LIMIT).map(member => searchMember(member, inventory.query));
    const navigation = applicableSelections(resource).filter(select => select.inventory !== 'matches' || shown.length < inventory.total_count);
    return contextContent({ source_kind: KIND.SEARCH, complete: shown.length === inventory.total_count,
      reference, total_count: inventory.total_count, returned_count: shown.length,
      omitted_count: inventory.total_count - shown.length, history: inventory.history, results: shown,
      ...searchLimitations(inventory), selection_context: searchHitBinding('results'),
      next_calls: navigation.map(select => call({ reference, select })) }, workspace, resource);
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
      const fields = readableWorkFields(scope);
      if (name === "inventory") {
        if (select.inventory === "fields") {
          const members = fields.map((entry) => ({ field: entry.field, kind: entry.kind,
            present: valueAt(entry.field === "sections.user_requirements" ? record : owner, entry.canonical_address) !== undefined,
            ...(entry.field === "sections.user_requirements" ? { field_unit: record.id } : {}),
            ...(granted(KIND.RECORD, 'field') && ['read_scope', 'write_scope'].includes(entry.field) ? {
              navigation: call({ reference, select: { field: entry.field, directory: '.' } }) } : {}) }));
          return { inventory: "fields", total_count: members.length, members,
            ...(members.length > 0 && granted(KIND.RECORD, "field") ? { selection_context: selectionContext(reference,
              "Use this reference unchanged with select:{field:members[i].field}.") } : {}) };
        }
        if (select.inventory === "entries") {
          const members = (owner.sections?.entries ?? []).map((entry) => ({ entry: entry.id,
            current_version: entry.current_version, version_count: entry.versions.length,
            title: entry.versions.find((version) => version.id === entry.current_version)?.title ?? null,
            kind: entry.versions.find((version) => version.id === entry.current_version)?.kind ?? null,
            ...(granted(KIND.RECORD, 'entry') ? { navigation: call({ reference, select: { entry: entry.id, version: entry.current_version,
              ...(entryJson(entry.versions.find(version => version.id === entry.current_version)?.content?.text ?? '').status === 'json'
                ? { view: 'structure' } : {}) } }) } : {}) }));
          return { inventory: "entries", total_count: members.length, members,
            ...(members.length > 0 && granted(KIND.RECORD, "entry") ? {
              selection_context: { tool: READ_WIKI_TOOL, reference,
                binding: 'For history choose members[i].entry; call {reference,select:{entry:members[i].entry,history:true}} unchanged. Current content uses that member’s navigation.' },
              next_calls: [] } : { next_calls: [] }) };
        }
        if (select.inventory === "tasks") {
          const members = (owner.sections?.tasks ?? []).map((task, index) => ({ index, ...task }));
          return { inventory: "tasks", total_count: members.length, members };
        }
        if (select.inventory === "slices" && scope === "record") {
          const slices = record.slices ?? [];
          const titles = new Map();
          for (const slice of slices) titles.set(slice.title ?? null, (titles.get(slice.title ?? null) ?? 0) + 1);

          const choices = slices.map((slice) => ({ id: slice.id, unit: `${record.id}#${slice.id}`,
            title: slice.title ?? null, status: slice.status ?? null, work_kind: slice.work_kind ?? null,
            ...(titles.get(slice.title ?? null) > 1 && slice.expected_edit_targets?.length
              ? { targets: slice.expected_edit_targets } : {}),
            ...(titles.get(slice.title ?? null) > 1 && /^\s*#{1,6}\s+([^\r\n]+)(?:\r?\n|$)/u.test(slice.sections?.summary ?? '')
              ? { assignment_heading: /^\s*#{1,6}\s+([^\r\n]+)(?:\r?\n|$)/u.exec(slice.sections.summary)[1] } : {}),
            ...reviewPurposeFact(slice) }));
          const description = ({ id: _id, unit: _unit, ...meaning }) => canonicalJson(meaning);
          const counts = new Map();
          for (const choice of choices) counts.set(description(choice), (counts.get(description(choice)) ?? 0) + 1);
          const members = choices.map(choice => ({ ...choice,
            ...(counts.get(description(choice)) > 1 ? { choice_state: 'ambiguous' } : {}) }));
          return { inventory: "slices", total_count: members.length, members,
            ...(members.length > 0 && granted(KIND.RECORD, "context") ? {
              selection_context: { tool: READ_WIKI_TOOL,
                binding: "Use {subject:members[i].unit} unchanged to open each slice's context, then its returned reference and selections to read its contents." },
              next_calls: [] } : { next_calls: [] }) };
        }
      }
      if (name === "field") {
        const parentRequirements = select.field === "sections.user_requirements";
        const entry = (parentRequirements ? workFields("record") : fields)
          .find((candidate) => candidate.field === select.field);
        if (entry === undefined) throw fieldNotApplicable(resource, select.field, fields, reference);
        const value = valueAt(parentRequirements ? record : owner, entry.canonical_address);
        if (select.directory !== undefined) {
          const tree = scopeDirectory(value, select.directory, reason => correctable(reason,
            { field: entry.field, directory: select.directory },
            { reference, select: { field: entry.field, directory: '.' } },
            'choose a directory returned by this scope tree',
            'the call returns the root directory inventory without expanding the complete scope'));
          return { field: entry.field, ...tree, complete: tree.directories.length === 0,
            next_calls: tree.directories.map(child => call({ reference, select: { field: entry.field, directory: child.directory } })),
            full_selection: call({ reference, select: { field: entry.field } }) };
        }
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
      if (name === "entry") return selectEntry(workspace, resource, select, reference);
      if (name === "contract" || name === "obligation") return selectContract(workspace, resource.subject, select, reference, resource.source_kind);
    }
    if (resource.source_kind === KIND.ASSIGNMENT) {
      if (name === 'field' && select.field === 'test_commands') {
        const commands = resource.presentation.repository_test_binding?.commands ?? [];
        return { field: 'test_commands', unit: resource.unit, total_count: commands.length,
          commands: commands.map(command => ({ entrypoint: command.id, purpose: command.purpose,
            ...(command.default_selection === undefined ? {} : { default_selection: command.default_selection }),
            selections: command.selections.map(selection => ({ selection: selection.id,
              harness: selection.harness, ...(selection.environment === undefined ? {} : { environment: selection.environment }) })) })),
          ...(commands.length === 0 || requestContracts?.contractFor('workspace_run_test') == null ? {} : {
            selection_context: { tool: 'workspace_run_test',
              binding: 'Choose commands[i] and one of its selections[j]; call {entrypoint:commands[i].entrypoint,selection:commands[i].selections[j].selection}. No command is selected or executed by this read.' } }) };
      }
      if (name === "field" && select.field === "guidance") {
        return { field: "guidance", value: resource.presentation.guidance };
      }
      if (name === "text") return selectText([{ field: "guidance", text: resource.presentation.guidance }], select.text);
      if (name === "contract" || name === "obligation") return selectContract(workspace, resource.unit, select, reference, KIND.ASSIGNED_CONTRACT);
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
      const resolved = resolveRequirementAuthoringGuidance(select.guidance, registeredTier, exceptionPublication);
      if (!resolved.ok) throw guidanceTopicRefusal(select.guidance, resolved);

      const returned = JSON.stringify(select.guidance);
      const detailCalls = requirementGuidanceDetailNavigation(select.guidance)
        .map(({ selection, recommended, ...facts }) => ({ ...call({ reference, select: selection }, recommended), ...facts }));
      for (const detail of detailCalls) {
        if (!(await inputSchema.safeParseAsync(detail.arguments)).success) {
          throw new TypeError("requirement_guidance_detail_call_not_accepted: serving registrar rejected detail navigation");
        }
      }
      return { guidance: [...select.guidance], value: resolved.value, reference,
        coverage: { selection: "complete for this named selection", detail: "only explicitly selected structural detail is delivered" },
        ...(detailCalls.length ? { next_calls: detailCalls } : {}),
        selections: [...applicableSelections(resource).filter((offered) => JSON.stringify(offered.guidance) !== returned),
          ...(registeredTier === "paid_cce" ? requirementCaseFamilySelections(select.guidance) : [])] };
    }
    if (resource.source_kind === KIND.SEARCH && name === "inventory" && select.inventory === "matches") {
      return searchInventory(resource);
    }
    throw invalid("selection_not_applicable", { source_kind: resource.source_kind, select,
      applicable: applicableSelections(resource) });
  }

  async function selectEntry(workspace, resource, select, reference) {
    const base = { dir: workspace.dir, repository: workspace.repo, callRepository: null, unit: resource.subject,
      entryId: select.entry };
    const refuse = (result) => invalid("entry_unavailable", { entry: select.entry, version: select.version ?? null,
      code: result.diagnostics?.[0]?.code ?? null, message: result.diagnostics?.[0]?.message ?? null,
      diagnostics: result.diagnostics ?? [], effects: { writes: [], material_loaded: false } });
    if (select.history === true) {
      const versions = [];
      for (let offset = 0, digest; ;) {
        const page = await owners.readWorkRecordEntry({ ...base, view: "history", offset,
          ...(offset === 0 ? {} : { expectedSourceDigest: digest }) });
        if (page.ok !== true) throw refuse(page);
        versions.push(...page.versions.map(({ next_call: _nativeCall, ...version }) => version));
        if (page.next_calls.length === 0) {
          return { entry: select.entry, history: true, total_count: page.total_count, versions,
            selection_context: { tool: READ_WIKI_TOOL, reference,
              binding: `Choose versions[i].version_id; call {reference,select:{entry:${JSON.stringify(select.entry)},version:versions[i].version_id}} unchanged.` } };
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
    if (select.view === 'structure') {
      const path = select.path ?? [];
      const document = entryJson(body.body.value);
      const refuseNode = (reason, facts = {}) => correctable(reason,
        { entry: body.entry_id, version: body.version_id, ...facts },
        { reference, select: { entry: body.entry_id, version: body.version_id } },
        'this immutable entry must contain structured JSON with named members',
        'the call returns the complete unchanged entry text');
      const node = select.full === true
        ? { path, value: entryNodeValue(document, path, refuseNode), complete: true }
        : entryNode(document, path, refuseNode);
      const selection = { entry: body.entry_id, version: body.version_id, view: 'structure', path };
      return { entry: body.entry_id, version: body.version_id, reference: material.reference,
        ...node,
        next_calls: [],
        ...(select.full === true || !node.members?.length ? {} : { selection_context: {
          tool: READ_WIKI_TOOL, reference, select: selection,
          binding: 'Choose members[i].name for the task; append that name to select.path and call this tool with reference and select unchanged otherwise. No member is selected by default.' } }),
        ...(select.full === true || node.complete ? {} : { full_selection: call({ reference, select: { ...selection, full: true } }) }),
        original: call({ reference: { ref: material.reference }, select: { field: 'text' } }) };
    }
    return { entry: select.entry, entry_id: body.entry_id, version_id: body.version_id,
      body: { value: body.body.value }, reference: material.reference,
      material_binding: { value: { ref: material.reference },
        meaning: granted(KIND.RECORD, "input_contract")
          ? "Exact immutable source for sections.material_refs; choose the target unit and acquire its current revision and input contract before saving."
          : "Read-only immutable source; reopen through the returned call. This binding grants no authoring operation.",
        ...(granted(KIND.RECORD, "input_contract") ? { authoring: {
          complete: false, missing_inputs: ["caller-chosen target unit", "target's current revision"],
          current_context: { tool: READ_WIKI_TOOL,
            binding: "Use {subject:<caller-chosen target unit>,select:{context:true,for_changes:['material_refs']}}; follow its returned schema call before authoring.",
            member: "material_refs", value_from: "material_binding.value" } } } : {}) },
      next_calls: [call({ reference: { ref: material.reference }, select: { field: "text" } })],
      ...(entryJson(body.body.value).status === 'json' ? { structure: call({ reference,
        select: { entry: body.entry_id, version: body.version_id, view: 'structure' } }) } : {}) };
  }

  async function selectContract(workspace, unit, select, reference, grantKind) {
    const [wkId] = unit.split("#");
    let context;

    const stored = await obligationCoverageQueryOperation(async () => {
      context = await owners.resolveObligationCoverageQueryContext({ env, workspace });
      assertObligationCoverageQueryScope(context, { unit });
      return owners.queryControlledContractObligationCoverageOperation({ repoRoot: context.sourceRoot, wkId,
        ...(unit === wkId ? {} : { selectedUnit: unit.split("#")[1] }), view: "complete",
        population: select.contract === "obligations" && select.view === "associated" ? "assigned" : context.population,
        ...(select.obligation === undefined ? {} : { obligationId: select.obligation,
          ...(select.parameters === true ? { parameterDetail: true } : {}) }) });
    }).catch(error => {
      if (error.code !== "obligation_coverage_obligation_not_found") throw error;
      const { next_calls: _nativeCalls, ...facts } = error.details;
      throw correctable(error.code, { ...facts, native_message: error.message },
        { reference, select: { contract: "obligations" } }, "the obligation must belong to this authorized unit",
        "select an obligation_id from the saved obligations returned for this unit");
    });
    if (stored?.ok === false) {
      throw Object.assign(new Error(stored.message ?? stored.code ?? "saved contract unavailable"),
        { code: stored.code, envelope: stored });
    }
    if (select.obligation !== undefined && select.view === "row") return {
      obligation: select.obligation, view: "row", unit: stored.unit,
      scope: unit === wkId ? "record" : "slice",
      population: { mode: stored.population.mode, obligation_id: select.obligation,
        returned: { obligations: stored.obligations.length } },
      extent: { kind: "obligation_row", returned: stored.obligations.length, total: 1 },
      complete_contract: false, row: stored.obligations[0] };

    const saved = !Array.isArray(stored.cases) ? stored : { ...stored, cases: stored.cases.map((definition) =>
      definition.target === undefined ? definition
        : { ...definition, target: authorableNativeCaseTarget(definition.target) }) };
    if (select.obligation !== undefined) return { obligation: select.obligation, population: context.population, ...readWikiContractMeaning(saved) };
    if (select.contract === "requirements" && select.view !== undefined) {
      return projectRequirementDefinitionMeaning(readRequirementModel(saved, select, reference, { env,
        refuseRow: row_id => correctable("requirement_row_not_found", { unit, row_id },
          { reference, select: { contract: "requirements", view: "identities" } },
          "the row must belong to this authorized saved requirements population",
          "the call returns this population's complete saved row inventory; choose a returned row_id") }));
    }
    if (select.contract === 'obligations' && select.view === 'proofs') {
      const members = saved.obligations.map(row => ({ obligation_id: row.obligation_id,
        ...(row.statement === undefined ? {} : { statement: row.statement }),
        ...(typeof row.selection?.proof_name === 'string' ? { proof_name: row.selection.proof_name }
          : { proof_selection: row.proof_opt_out === true ? 'declined' : 'unselected' }) }));
      return { contract: 'obligations', view: 'proofs', unit: saved.unit,
        population: context.population, total_count: members.length, members,
        ...(requestContracts?.contractFor('workspace_find_proofs') == null ? {} : {
          selection_context: { tool: 'workspace_find_proofs',
            binding: 'Read a known member proof with {proof_name:members[i].proof_name}; when none is selected, author your own query from the obligation meaning. Discovery grants no execution permission.' } }) };
    }
    const componentIds = new Set(saved.cases.map(definition => definition.component?.reference_id).filter(Boolean));
    const componentReferences = saved.references.filter(row => componentIds.has(row.reference_id));
    const value = select.contract === "criteria" ? saved.acceptance_criteria
      : select.contract === "coverage" ? readWikiContractMeaning(saved) : saved[select.contract];
    return projectRequirementDefinitionMeaning({ contract: select.contract, population: context.population, source_state: saved.status,
      ...(unit !== wkId && saved.population.mode === 'all' ? {
        requirements_scope: { kind: 'parent_requirements', unit: wkId, slice_applicability: 'not_established' } } : {}),
      present: select.contract === "criteria" ? true : saved.status !== "source_absent",
      total_count: Array.isArray(value) ? value.length : value === undefined || value === null ? 0 : 1,
      members: value ?? null,
      ...(select.contract === "obligations" && select.view === "associated" ? { associated_meaning: {
        unit: saved.unit, population: saved.population, requirement_status: saved.requirement_status,
        controlled_acceptance: saved.controlled_acceptance, requirements: saved.requirements,
        definitions: saved.authored_requirements?.descriptions ?? null,
        references: saved.references, cases: saved.cases, acceptance_criteria: saved.acceptance_criteria,
        notes: saved.notes, residue: saved.residue, complete_contract: false },
 } : {}),

      ...(select.contract === "cases" ? { case_authoring: {
        unit: stored.unit, scope: unit === wkId ? "record" : "slice",
        revision: stored.content_digest,
        population: saved.population, complete_contract: false,
        obligations: saved.obligations,
        acceptance_criteria: saved.acceptance_criteria,
        references: componentReferences,
        notes: saved.notes, residue: saved.residue,
        extent: { obligations: saved.obligations.length, cases: saved.cases.length,
          component_references: componentReferences.length }
      } } : {}),

      ...(select.contract === "obligations" && Array.isArray(value) && value.length > 0 && granted(grantKind, "obligation")
        ? { selection_context: selectionContext(reference,
          "Use {reference,select:{obligation:members[i].obligation_id}} unchanged for associated meaning. Add parameters:true for parameter detail or view:'row' for the exact row; these modifiers cannot combine.") }
        : {}),

      ...(select.contract === "requirements" && saved.authored_requirements !== undefined
        ? { authored: saved.authored_requirements } : {}) });
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
      source_kind: carrier.source_kind, complete: true, next_calls: [],
      ...(await projectValue(carrier))
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
          const path = error.envelope?.subject?.path ??
            (["search_source_changed", "search_source_reordered"].includes(error.code)
              ? decodeSearchToken(subject.ref, 'source').path : undefined);
          const currentSubject = typeof path === 'string' ? searchPathSubject(path) : null;
          const currentKind = currentSubject === null ? null : WORK_UNIT_PATTERN.test(currentSubject) ? KIND.RECORD
            : KIND_RECORD_PATTERN.test(currentSubject) ? KIND.CANONICAL_RECORD : KIND.DOCUMENT;

          if (!["search_source_changed", "search_source_reordered"].includes(error.code) ||
              currentSubject === null || !granted(currentKind, "context")) throw error;
          throw correctable(error.code, { subject: error.envelope?.subject ?? { path },
            cause: { code: error.code, message: error.message } }, { subject: currentSubject },
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
          message: resolved.diagnostic?.message ?? null, diagnostic: resolved.diagnostic ?? null });
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
      if (name === "field") return { field: "text", value: resolved.value };
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
      async () => ({ field: "text", value: text }), true);
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
    const frame = { source_kind: KIND.RECEIPT, subject: binding.unit };
    const receiptMeaning = ({ observation: _observation, receipt: _receipt, next_calls: _calls, ...meaning }) => meaning;
    if (name === "context") {
      return jsonContent({ ...frame, complete: listing.findings_omitted === 0, ...receiptMeaning(listing), reference: source,
        ...(listing.findings.length && granted(KIND.RECEIPT, 'finding') ? {
          selection_context: { tool: READ_WIKI_TOOL, reference: source,
            binding: 'Choose findings[i].finding_id; call {reference,select:{finding:findings[i].finding_id}} unchanged.' } } : {}),
        next_calls: granted(KIND.RECEIPT, 'inventory') ? [call({ reference: source, select: { inventory: 'findings' } })] : [] });
    }
    if (!(name === "finding" || name === "inventory" && select.inventory === "findings")) {
      throw invalid("selection_not_applicable", { source_kind: KIND.RECEIPT, select });
    }
    return owners.readCompleteCloseoutReceipt({ repository: workspace.repo, unit: binding.unit, env,
      receipt: { ...source, ...(name === "finding" ? { finding_id: select.finding } : {}) },
      project: original => ({ ...frame, complete: true, ...receiptMeaning(original), next_calls: [] }) });
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
        return contextContent(await withAuthoringChoices(contextResult(workspace, resource, source), resource, select.for_changes), workspace, resource);
      }

      return contextContent(await withAuthoringChoices(contextResult(workspace, resource, await retainResource(workspace, resource),
        { recovered: { code: "source_moved", applied: "fresh_context_of_same_subject", attempts: 1,
          observed_revision: carrier.authoring_revision ?? carrier.revision,
          current_revision: resource.authoring_revision ?? resource.revision, superseded_reference: source } }), resource, select.for_changes), workspace, resource);
    }
    return deliver(source, workspace, expected, select, async (carrier) => {

      if (name === "input_contract") {

        return readInputContract({ carrier, select, reference: source, requireGrant, reopen: () => reopen(workspace, carrier),
          readSavedContract: !granted(carrier.source_kind, "contract") ? null : async (unit) =>
            (await selectContract(workspace, unit, { contract: "coverage" }, source, carrier.source_kind)).members });
      }
      const kind = grantKind(carrier);
      if (!policy.read_selections.some(row => row.source_kind === kind && row.selection === name) &&
          granted(carrier.source_kind, 'context')) {
        throw correctable('selection_not_applicable', { subject: carrier.subject, source_kind: kind, select },
          { reference: source, select: { context: true } }, 'Choose a selection applicable to this source kind.',
          'Returns the same source context and supported choices; it does not perform the refused selection.');
      }
      requireGrant(kind, name);
      if (name === 'currentness' && [KIND.SEARCH, KIND.RECORD].includes(carrier.source_kind)) {
        const entries = carrier.source_kind === KIND.SEARCH ? carrier.observed_records
          : [{ id: carrier.subject.split('#')[0], observed_source_digest: carrier.revision }];
        return readWikiCurrentness({ dir: workspace.dir, entries, readRecord: owners.readWorkRecordById,
          scope: carrier.source_kind === KIND.SEARCH ? 'observed_canonical_work_records_only' : 'observed_work_record',
          contextCall: granted(KIND.RECORD, 'context') ? subject => call({ subject }) : null });
      }
      const resource = await reopen(workspace, carrier);

      const immutableEntryVersion = carrier.source_kind === KIND.RECORD && name === "entry" && select.version !== undefined;
      if (name === "currentness") resource.observed_revision = carrier.revision;
      else if (!immutableEntryVersion && (carrier.revision !== null && resource.revision !== carrier.revision ||
          carrier.authoring_revision !== undefined && resource.authoring_revision !== carrier.authoring_revision)) {
        throw sourceMoved(carrier, resource);
      }
      return selectValue(workspace, resource, select, source);
    });
  }

  const projectInputFailure = async ({ args, validationError, tool }) => {
    const queryIssue = requirementChoiceQueryIssue(args?.select);
    if (queryIssue) {
      const replacement = { reference: args.reference, select: { contract: 'requirements', view: 'choices' } };
      const knownQuery = queryIssue.code === 'requirement_query_not_applicable' &&
        typeof args.select.query === 'string' && args.select.query.trim().length > 0;
      const { query: _query, ...requestedView } = args.select;
      const alternatives = knownQuery ? [
        { arguments: { ...replacement, select: { ...replacement.select, query: args.select.query } }, purpose: 'search_authored_requirements' },
        { arguments: { ...args, select: requestedView }, purpose: 'read_requested_view_without_query' }
      ].filter(next => inputSchema.safeParse(next.arguments).success).map(next => ({ ...call(next.arguments), purpose: next.purpose })) : [];
      return { terminal_result: errorContent(invalid(queryIssue.code, {
        subject: args.reference ?? args.subject ?? { assignment: args.assignment }, cause: queryIssue.message,
        requested_view: args.select.view,
        ...(!knownQuery && inputSchema.safeParse(replacement).success ? { selection_context: requirementQuerySelection(args.reference) } : {}),
        next_calls: alternatives,
        recovery: { state: 'caller_choice', ...(knownQuery ? {
          choice: 'Choose the query over requirements choices, or explicitly read the requested view without query. Neither was performed.'
        } : { missing_inputs: ['nonblank caller query'],
          reason: 'Choose caller words for requirements choices; no query was inferred and no inventory was read.' }) }
      })) };
    }
    const { select: _select, ...withoutSelect } = args !== null && typeof args === "object" ? args : {};
    const corrected = args?.select !== undefined && inputSchema.safeParse(withoutSelect).success
      ? [withoutSelect] : [];

    const published = advertisedInputSchema.safeParse(args);
    return { terminal_result: errorContent(createToolInputValidationError({ tool,
      validationError: published.success ? validationError : published.error,
      nextCalls: corrected.map((item) => ({ ...call(item, false),
        purpose: "optional_context_discovery",
        information: "Different read: returns source context without the refused selection. It is not a corrected request; the caller must choose how to express the original intent." })) })) };
  };

  return {
    name: READ_WIKI_TOOL,
    config: {
      description: describeReadWikiTool(inputSchema),
      inputSchema,
      advertisedInputSchema,

      publishedInputSchemaProjection: publishedReadWikiInputSchema,
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
        if (error.envelope?.schema_version === 'workspace-read-wiki-refusal.v1' && error.envelope.subject === undefined) {
          error.envelope.subject = args.subject ?? args.reference ?? (args.assignment ? { assignment: true } : { search: args.search });
        }

        const filesystemFailure = isPlatformErrorCode(error?.code) &&
          typeof error.path === "string" && typeof error.syscall === "string";
        if ((error instanceof ControlledContractToolError || filesystemFailure) && error.envelope === undefined) {
          error.envelope = {
            schema_version: "workspace-read-wiki-source-refusal.v1", accepted: false,
            code: filesystemFailure ? "workspace_read_wiki_source_unavailable" : error.code,
            subject: args.subject ?? args.reference, cause: { code: error.code, message: error.message },
            details: filesystemFailure ? { source_failure: { code: error.code, message: error.message,
              path: error.path, operation: error.syscall, errno: error.errno } } : error.details,
            next_calls: [], no_supported_route: true,
            recovery: { state: "no_supported_route", caller_correctable: false,
              actor: findingsSession ? "coordinator_or_operator" : "repository_owner",
              reason: findingsSession
                ? "The coordinator or operator must repair the reported source condition and dispatch a fresh frozen review. Reads cannot repair or replace captured content."
                : "The repository owner must repair the reported source path, permissions or content before it can be read." },
            effects: { writes: [] }
          };
        }
        return errorContent(error);
      }
    },
    call,
    acquireSavedUnitReference
  };
}

export function registerReadWikiTools({ registerTool, ...composition }) {
  const task = createReadWikiTask({ ...composition, requestContracts: registeredToolRequestContracts(registerTool) });
  if (task !== null) registerTool(task.name, task.config, task.handler);
  return task;
}
