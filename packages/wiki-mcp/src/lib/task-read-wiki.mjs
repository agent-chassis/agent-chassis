import { shareReadWikiDefinitions } from './read-wiki-contract-presentation.mjs';
import { completeProducedContent } from './mcp-response.mjs';
import { scopeDirectory, entryJson, entryNode, entryNodeValue } from './read-wiki-semantic-navigation.mjs';
import { readTaskSelection, readDocumentSections } from './read-wiki-focused-selections.mjs';
import { canonicalJson } from '@agent-chassis/wiki-core/src/lib/controlled-requirement-authoring-schema.mjs';
import { DEFAULT_EXCEPTION_PUBLICATION } from "@agent-chassis/wiki-core/src/lib/controlled-acceptance-publication-config.mjs";
import { readRequirementModel } from "./requirement-model-read.mjs";
import { searchChoice, searchLimitations, searchPathSubject } from "./read-wiki-search-presentation.mjs";
import { readWikiRefusal } from "./read-wiki-refusal.mjs";
import { createReadWikiInputDiagnosis } from './read-wiki-input-diagnosis.mjs';
import { readWikiCurrentness } from "./read-wiki-currentness.mjs";
import { decodeSearchToken } from "@agent-chassis/wiki-core/src/lib/search-source-reader.mjs";
import { sessionRequirementAuthoringGuidance, requirementGuidanceRevision, requirementGuidanceDetailNavigation } from "./requirement-authoring-guidance.mjs";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { groupCompleteSchemaDiagnostics } from "@agent-chassis/controlled-contract/bounded-diagnostics";
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
import { validateWorkRecord } from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import { projectWorkRecordPrivateScopePolicyFacts } from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import { readSearchInventory } from "@agent-chassis/wiki-core/src/operations/search.mjs";
import { readWorkRecordEntry } from "@agent-chassis/wiki-core/src/operations/work-record-entries.mjs";
import { decodeWorkRecordEntryReference, findExactScalarMatches, resolveWorkRecordEntryContent,
  selectWorkRecordSourceText, selectWorkRecordReferenceText } from
  "@agent-chassis/wiki-core/src/lib/work-record-entry-content.mjs";
import { ControlledContractToolError } from "@agent-chassis/wiki-core/src/lib/controlled-contract-tool-shared.mjs";
import { runInitiativeStatus } from "@agent-chassis/wiki-core/src/operations/initiative-status.mjs";
import { obligationCoverageQueryOperation, queryControlledContractObligationCoverageOperation, captureObligationCoverageSource } from
  "@agent-chassis/wiki-core/src/operations/controlled-contract/obligation-coverage-query.mjs";

import { assertObligationCoverageQueryScope, resolveObligationCoverageQueryContext } from
  "./controlled-contract-query-context.mjs";
import { buildWorkspaceIntegrationStatus } from "./integration-status-tools.mjs";
import { FindingsSourceRefusal, FINDINGS_SOURCE_REFUSAL_CONDITIONS, resolveAuthenticatedFindingsSource, WIKI_MCP_AGENT_SESSION_CONTRACT_ENV_VAR,
  WIKI_MCP_REVIEW_MATERIALIZATION_DIR_ENV_VAR } from "./launcher-run-credential.mjs";
import { guardManagedAssignmentRead, readManagedAssignmentPresentation } from "./managed-assignment-read.mjs";
import { buildNextCall } from "./mcp-response.mjs";
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
import { createReadWikiInputSchema, createReadWikiReadSchema, describeReadWikiTool, requirementChoiceQueryIssue, WORK_RECORD_PLANNING_READ_FIELDS } from "./task-read-wiki-schema.mjs";
import { READ_WIKI_SOURCE_KINDS as KIND, READ_WIKI_TOOL, createReadWikiGrants } from
  "./task-read-wiki-selection.mjs";
import { readCloseoutReceipt, readCompleteCloseoutReceipt } from "./work-record-closeout-response.mjs";
import { SAVE_RECORD_ROUTE } from "./save-record-maintenance.mjs";
import { readSourceBoundAuthoringRevision, readCompleteSearchSource } from "@agent-chassis/wiki-core/src/operations/read.mjs";
import { isPlatformErrorCode } from "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
import { workRecordProseRegistryEntries } from
  "@agent-chassis/wiki-core/src/lib/work-record-contract-edit-operations.mjs";
import { summarizeTerminalReviewDesignation } from
  "@agent-chassis/wiki-core/src/lib/work-record-summary.mjs";
import { analyzeWorkRecordFindingsUnit } from "@agent-chassis/wiki-core/src/lib/work-record-findings-semantics.mjs";

const WORK_UNIT_PATTERN = /^(WK-[0-9]{4})(?:#(SLICE-[0-9]{3}))?$/u;
const KIND_RECORD_PATTERN = /^(?:DEC|IN)-[0-9]{4}$/u;
const DOCUMENT_PATH_PATTERN = /^(?:docs|wiki)\/.+\.md$/u;

const SEARCH_CONTEXT_LIMIT = 8;

const SOURCE_OWNERS = Object.freeze({
  getWikiRecord, lintRepo, loadManifest, readWikiPage, readWorkRecordById, validateDocsPolicyOperation,
  readSearchInventory, readWorkRecordEntry, resolveWorkRecordEntryContent, runInitiativeStatus,
  queryControlledContractObligationCoverageOperation, captureObligationCoverageSource, buildWorkspaceIntegrationStatus,
  resolveObligationCoverageQueryContext, readManagedAssignmentPresentation, readCloseoutReceipt,
  readSourceBoundAuthoringRevision, readCompleteSearchSource, readCompleteCloseoutReceipt,
  resolveAuthenticatedFindingsSource
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const selectionName = (select) => Object.keys(select).find((key) => !["version", "history", "parameters", "view", "match", "where", "include", "query", "directory", "path", "full"].includes(key));
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
  const advertisedInputSchema = createReadWikiInputSchema(z, grants, exceptionPublication, { advertise: true });
  const readSchema = createReadWikiReadSchema(z, grants, exceptionPublication);
  const bulkScope = new AsyncLocalStorage();
  const cached = (kind, key, load) => {
    const cache = bulkScope.getStore()?.cache;
    if (!cache) return load();
    const identity = JSON.stringify([kind, key]);
    if (!cache.has(identity)) cache.set(identity, Promise.resolve().then(load));
    return cache.get(identity);
  };
  const owners = { ...SOURCE_OWNERS, ...deps };
  const projectInitiativeGuidance = createInitiativeGuidanceProjector(requestContracts);
  const { granted } = grants;

  const invalid = (reason, details = {}) => readWikiRefusal(reason, details, details.next_calls ?? []);
  const call = (argumentsValue, recommended = false) =>
    buildNextCall({ tool: READ_WIKI_TOOL, arguments: { reads: [argumentsValue] }, recommended });
  const inputDiagnosis = createReadWikiInputDiagnosis({ readSchema, inputSchema,
    queryIssueOf: requirementChoiceQueryIssue,
    call: argumentsValue => buildNextCall({ tool: READ_WIKI_TOOL, arguments: argumentsValue, recommended: true }) });

  const followUps = (argumentList) => ({
    next_calls: argumentList.map((item, index) => call(item, index === 0))
  });
  const correctable = (reason, details, corrected, prerequisite, successCondition) => {
    if (!readSchema.safeParse(corrected).success) throw new TypeError(`read_wiki_correction_not_accepted: ${reason}`);
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
    return Object.assign(new Error(refusal.message), { code: refusal.code,
      sourceUnavailable: [FINDINGS_SOURCE_REFUSAL_CONDITIONS.BINDING_ABSENT,
        FINDINGS_SOURCE_REFUSAL_CONDITIONS.REPOSITORY_UNAVAILABLE,
        FINDINGS_SOURCE_REFUSAL_CONDITIONS.MATERIALIZATION_UNAVAILABLE,
        FINDINGS_SOURCE_REFUSAL_CONDITIONS.MATERIALIZATION_UNREADABLE].includes(refusal.code), envelope: {
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
      binding: `Choose one ${population}[i]; use {reads:[{reference:{ref:${population}[i].source.reference},select:{field:"text"}}]} unchanged to read its complete source. No hit is selected by default.` };
  }

  async function resolveSubject(workspace, subject, capturedRecord = null) {
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
      const loaded = capturedRecord ?? await owners.readWorkRecordById({ dir: workspace.dir, id: workUnit[1] });
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
    return cached('assignment', null, loadAssignmentResource);
  }
  function loadAssignmentResource() {
    guardManagedAssignmentRead({ assignment: true }, { env });
    const { assignedUnit, digest, presentation } = owners.readManagedAssignmentPresentation({ env });
    return { source_kind: KIND.ASSIGNMENT, subject: { assignment: true }, unit: assignedUnit,
      revision: projectWorkRecordFreshness(digest), presentation,
      facts: { ...presentation.identity, guidance_scalars: scalars(presentation.guidance) } };
  }

  function boundSubject(workspace, subject) {
    return cached('subject', [workspace.repo, subject], () => loadBoundSubject(workspace, subject));
  }
  async function capturedContract(workspace, unit) {
    return cached('capture', [workspace.repo, unit], async () => {
      const context = await owners.resolveObligationCoverageQueryContext({ env, workspace });
      assertObligationCoverageQueryScope(context, { unit });
      const [wkId, selectedUnit] = unit.split('#');
      let captured;
      try { captured = await owners.captureObligationCoverageSource({ repoRoot: context.sourceRoot, wkId,
        selectedUnit: selectedUnit ?? null, focus: null }); }
      catch (error) { throw Object.assign(error, { sourceUnavailable: true }); }
      return { captured, population: context.population };
    });
  }
  async function loadBoundSubject(workspace, subject) {
    if (typeof subject === 'string' && KIND_RECORD_PATTERN.test(subject)) {
      const bound = await owners.readSourceBoundAuthoringRevision({ dir: workspace.dir, unit: subject, readSource: () => resolveSubject(workspace, subject) });
      if (!bound.ok) throw correctable('source_moved', { subject, cause: 'The current canonical record moved during capture.' },
        { subject }, 'Capture must describe one current source.', 'Reacquires the same canonical subject; no write is retried.');
      return { ...bound.source, authoring_revision: bound.revision };
    }
    if (typeof subject !== 'string' || !WORK_UNIT_PATTERN.test(subject)) return resolveSubject(workspace, subject);
    requireGrant(KIND.RECORD, 'context');
    let captured;
    try { ({ captured } = await capturedContract(workspace, subject)); }
    catch (error) {
      if (error.code === 'acceptance_coverage_selected_unit_not_found') throw correctable('slice_not_found',
        { subject, cause: error.message }, { subject: subject.split('#')[0] },
        'The slice must exist in the captured work record.', 'Returns the same parent context; no other slice is selected.');
      if (error.code === 'acceptance_coverage_canonical_source_unavailable' && error.details?.cause === 'ENOENT' &&
          error.details.source === 'canonical work record') throw invalid('subject_not_found', {
        subject, cause: { code: error.code, message: `No saved work record exists for ${subject}.` },
        ...(granted(KIND.SEARCH, 'context') ? { next_calls: [call({ search: { query: subject } })] } : {}) });
      throw error;
    }

    const diagnostics = validateWorkRecord(captured.record, { sourceDigest: captured.recordSourceDigest });
    const loaded = { record: captured.record, source_digest: captured.recordSourceDigest,
      valid: diagnostics.every(row => row.severity !== 'error'), diagnostics };
    return { ...await resolveSubject(workspace, subject, loaded), authoring_revision: captured.authoringIdentity };
  }

  function searchResource(workspace, request) {
    return cached('search', [workspace.repo, request], () => loadSearchResource(workspace, request));
  }
  async function loadSearchResource(workspace, request) {
    let inventory;
    try {
      inventory = await owners.readSearchInventory({ dir: workspace.dir, repository: workspace.repo,
        ...(request.query === null ? {} : { query: request.query }), history: request.history, ...request.where });
    } catch (error) {
      if (error.envelope !== undefined) throw error;
      throw Object.assign(invalid(error.code ?? 'search_source_unavailable', { subject: { search: request },
        cause: { code: error.code ?? 'search_source_unavailable', message: error.message }, details: error.details,
        recovery: { state: 'no_supported_route', actor: findingsSession ? 'coordinator_or_operator' : 'repository_owner',
          reason: 'Repair the stated search source condition; no match population was established and this read repairs nothing.' } }), { sourceUnavailable: true });
    }
    return { source_kind: KIND.SEARCH, subject: request, unit: null, revision: inventory.source_signature, inventory };
  }

  function reopen(workspace, carrier) {
    if (carrier.source_kind === KIND.ASSIGNMENT) return assignmentResource();
    if (carrier.source_kind === KIND.SEARCH) return searchResource(workspace, carrier.subject);
    return boundSubject(workspace, carrier.subject);
  }

  const bindingFor = async (workspace, unit) => {
    const authority = await cached('authority', workspace.repo, () => sessionAuthority(workspace));
    const binding = { route: READ_WIKI_TOOL, repository: workspace.repo, unit: unit ?? null, authority_identity: authority };
    return binding;
  };

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
        add({ contract: 'requirements', view: 'choices' });
        add({ contract: "requirements" });
        add({ contract: 'verifications' });
        add({ contract: 'collections' });
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
        add({ field: 'body', view: 'sections' });
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
        const topics = resource.subject.topic === undefined ? sessionGuidanceTopics : [resource.subject.topic];
        for (const topic of topics) add({ guidance: [...topic] });
        break;
      }
      case KIND.SEARCH:
        add({ inventory: "matches" });
        add({ currentness: true });
        break;
      case KIND.ASSIGNMENT:
        add({ field: "guidance" });
        add({ field: "test_commands" });
        add({ contract: "requirements" }, KIND.ASSIGNED_CONTRACT);
        add({ contract: 'verifications' }, KIND.ASSIGNED_CONTRACT);
        add({ contract: 'collections' }, KIND.ASSIGNED_CONTRACT);
        add({ contract: 'obligations' }, KIND.ASSIGNED_CONTRACT);
        add({ contract: 'criteria' }, KIND.ASSIGNED_CONTRACT);
        add({ contract: 'references' }, KIND.ASSIGNED_CONTRACT);
        add({ contract: "cases" }, KIND.ASSIGNED_CONTRACT);
        add({ contract: "coverage" }, KIND.ASSIGNED_CONTRACT);
        break;
      case KIND.ENTRY:
        add({ field: "text" });
        break;
      case KIND.PACKAGE_DOCUMENT:
        add({ field: 'text', view: 'sections' });
        add({ field: "text" });
        break;
      default:
        break;
    }
    return selections;
  }

  function contextResult(workspace, resource, reference, extra = {}) {
    const context = {};
    const selections = applicableSelections(resource, context);
    const primary = resource.source_kind === KIND.ASSIGNMENT ||
      resource.source_kind === KIND.REQUIREMENT_GUIDANCE && resource.subject.topic !== undefined ? selections.slice(0, 1) : [];

    const selectedFirst = resource.source_kind === KIND.ASSIGNMENT ||
      resource.source_kind === KIND.REQUIREMENT_GUIDANCE && resource.subject.topic !== undefined;
    const nextCalls = primary.map((select, index) => call({ reference, select },
      selectedFirst && index === 0));
    const concrete = new Set(nextCalls.map(next => JSON.stringify(next.arguments.reads[0].select)));
    const choices = selections.filter(select => !concrete.has(JSON.stringify(select)));
    const publicFacts = Object.fromEntries(Object.entries(resource.facts ?? {}).filter(([key, value]) =>
      key === 'valid' && value === false ||
      ['title', 'status', 'work_kind', 'record_kind', 'review_purpose', 'terminal_review_designation', 'assigned_unit'].includes(key)));
    return {
      source_kind: resource.source_kind, subject: resource.subject,
      ...(resource.scope === 'record' && resource.facts.slice_count > 0
        ? { slice_design: { state: 'not_read' } } : {}),
      complete: false, ...(Object.keys(publicFacts).length ? { facts: publicFacts } : {}),
      ...context, ...extra, reference,
      ...(choices.length ? { selections: choices,
        selection_context: { tool: READ_WIKI_TOOL,
          binding: "Choose needed selections; call {reads:[{reference,select:selections[i]},...]} with this answer's reference unchanged. Choices are optional, not continuations." } } : {}),
      next_calls: nextCalls
    };
  }

  async function subjectContext(args) {
    const workspace = resolveWorkspaceReadRepo({});
    const resource = await boundSubject(workspace, args.subject);
    const select = args.select ?? (resource.source_kind === KIND.REQUIREMENT_GUIDANCE && resource.subject.topic
      ? { guidance: resource.subject.topic } : { context: true });
    const name = selectionName(select);
    requireGrant(resource.source_kind, name);
    const reference = await retainResource(workspace, resource);
    if (args.for_changes !== undefined) await collectWriteContext(workspace, resource, reference, args.for_changes);
    if (name === 'context') {
      if (args.for_changes !== undefined) return completeProducedContent({});
      const result = contextResult(workspace, resource, reference);
      return contextContent(resource.source_kind === KIND.RECORD_KIND ? await withAuthoringChoices(result, resource) : result, workspace, resource);
    }
    if (name === 'input_contract') return completeProducedContent(await readInputContract({ carrier: resource, select, reference,
      requireGrant, reopen: async () => resource,
      readSavedContract: granted(resource.source_kind, 'contract') ? unit => publicSelectionSource(workspace, unit) : null }));
    return deliver(reference, workspace, await bindingFor(workspace, resource.unit), select,
      () => selectValue(workspace, resource, select, reference));
  }

  async function collectWriteContext(workspace, resource, reference, members) {
    if (![KIND.RECORD, KIND.CANONICAL_RECORD].includes(resource.source_kind) || sessionRole === 'worker' || findingsSession && launcherBound())
      throw invalid('authoring_context_unavailable', { subject: resource.subject,
        cause: 'This source is frozen, historical or not a current writable saved unit. No current write revision is supplied.' });
    const scopes = bulkScope.getStore().writeRequests;
    const held = scopes.get(resource.unit);
    if (held && held.resource.authoring_revision !== resource.authoring_revision)
      throw invalid('source_moved', { subject: resource.subject, cause: 'The same unit moved while this request was being captured.' });
    scopes.set(resource.unit, { workspace, resource, reference,
      members: [...new Set([...(held?.members ?? []), ...members])] });
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
    const resource = await assignmentResource();
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
    return { inventory: 'matches', members: inventory.members.map(member => searchMember(member, inventory.query)),
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
      reference, results: shown,
      ...searchLimitations(inventory), selection_context: searchHitBinding('results'),
      next_calls: navigation.map(select => call({ reference, select })) }, workspace, resource);
  }

  function fieldNotApplicable(resource, field, fields, reference) {
    const details = { subject: resource.subject, field, applicable: fields.map(item => item.field),
      selection_context: { tool: READ_WIKI_TOOL, reference,
        binding: 'Choose a needed applicable field; call {reads:[{reference,select:{field:<chosen field>}}]}. No field is selected by default.' } };
    const corrected = { reference, select: { inventory: 'fields' } };
    if (!granted(KIND.RECORD, 'inventory') || !readSchema.safeParse(corrected).success) {
      return invalid("field_not_applicable", details);
    }
    return correctable("field_not_applicable", details, corrected,
      "select.field names a field this saved work unit carries",
      'The call returns field meaning and exact selected-read bindings from the same source.');
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
          return { inventory: "fields", members,
            ...(members.length > 0 && granted(KIND.RECORD, "field") ? { selection_context: selectionContext(reference,
              "Call {reads:[{reference,select:{field:members[i].field}}]} with this reference unchanged.") } : {}) };
        }
        if (select.inventory === "entries") {
          const members = (owner.sections?.entries ?? []).map((entry) => ({ entry: entry.id,
            current_version: entry.current_version,
            title: entry.versions.find((version) => version.id === entry.current_version)?.title ?? null,
            kind: entry.versions.find((version) => version.id === entry.current_version)?.kind ?? null,
            ...(granted(KIND.RECORD, 'entry') ? { navigation: call({ reference, select: { entry: entry.id, version: entry.current_version,
              ...(entryJson(entry.versions.find(version => version.id === entry.current_version)?.content?.text ?? '').status === 'json'
                ? { view: 'structure' } : {}) } }) } : {}) }));
          return { inventory: "entries", members,
            ...(members.length > 0 && granted(KIND.RECORD, "entry") ? {
              selection_context: { tool: READ_WIKI_TOOL, reference,
                binding: 'For history choose members[i].entry; call {reads:[{reference,select:{entry:members[i].entry,history:true}}]} unchanged. Current content uses that member’s navigation.' },
              next_calls: [] } : { next_calls: [] }) };
        }
        if (select.inventory === "tasks") {
          const value = readTaskSelection(owner.sections?.tasks ?? [], select, reference, (reason, facts) => correctable(reason,
            { subject: resource.subject, ...facts, effects: { writes: [] },
              cause: facts?.cause ?? 'The requested task meaning must select exactly one task in this saved unit.' },
            { reference, select: { inventory: 'tasks' } }, 'Supply distinguishing authored task meaning from this source.',
            'Returns the complete task choices for the same unit; no task is substituted.'),
            [workspace.repo, resource.subject, resource.revision]);
          return { ...value, ...(select.match === undefined && granted(KIND.RECORD, 'field')
            ? { full_selection: call({ reference, select: { field: 'sections.tasks' } }) } : {}) };
        }
        if (select.inventory === "slices" && scope === "record") {
          const slices = record.slices ?? [];
          const titles = new Map();
          for (const slice of slices) titles.set(slice.title ?? null, (titles.get(slice.title ?? null) ?? 0) + 1);

          const choices = slices.map((slice) => ({ unit: `${record.id}#${slice.id}`,
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
          return { inventory: "slices", members,
            ...(members.length > 0 && granted(KIND.RECORD, "context") ? {
              selection_context: { tool: READ_WIKI_TOOL,
                binding: "Use {reads:[{subject:members[i].unit}]} unchanged to open each slice's context, then its returned reference and selections to read its contents." },
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
            { subject: resource.subject, field: entry.field, directory: select.directory,
              cause: reason === 'scope_directory_requires_paths'
                ? 'This saved field is not a list of path strings; it cannot be opened as a directory.'
                : 'The requested directory has no paths in this saved scope.' },
            { reference, select: { field: entry.field,
              ...(reason === 'scope_directory_requires_paths' ? {} : { directory: '.' }) } },
            reason === 'scope_directory_requires_paths'
              ? 'Inspect the saved field value before deciding whether to correct it; repeating the directory request cannot change it.'
              : 'Choose a directory returned by this scope tree.',
            reason === 'scope_directory_requires_paths'
              ? 'Returns the exact saved field for inspection; it does not repair the value or establish a directory view.'
              : 'Returns the root directory inventory without expanding the complete scope.'));
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
          const missingAction = () => {
            const details = { subject: resource.subject, action: select.action,
              cause: 'The selected action is not available in this initiative\'s current work choices.',
              effects: { writes: [] } };
            if (granted(KIND.CANONICAL_RECORD, 'membership')) return correctable('action_not_found', details,
              { reference, select: { membership: 'work' } },
              'Choose an action from this initiative\'s current work membership; no substitute was selected.',
              'Returns current work choices for the same initiative; reading starts no action.');
            return invalid('action_not_found', { ...details, recovery: { state: 'no_supported_route',
              missing_capability: 'canonical_record.membership',
              reason: 'This session cannot discover replacement initiative work choices.' } });
          };

          const unit = WORK_UNIT_PATTERN.test(select.action) ? select.action : null;
          if (unit !== null) {
            const loaded = await owners.readWorkRecordById({ dir: workspace.dir, id: unit.split("#")[0] });
            const absent = !loaded.record && (loaded.diagnostics ?? []).some(row => row.code === 'missing_json_record');
            if (!absent && !loaded.record) {
              throw invalid('action_source_unavailable', { subject: resource.subject, action: select.action,
                source_unit: unit, operation: 'read_saved_work_record', diagnostics: loaded.diagnostics ?? [],
                cause: `Cannot determine the selected action because its saved source ${unit} is invalid or unreadable.`,
                effects: { writes: [] }, recovery: { state: 'no_supported_route', caller_correctable: false,
                  actor: findingsSession ? 'coordinator_or_operator' : 'repository_owner',
                  reason: 'Repair the reported saved-source condition before selecting this action; a read cannot repair or replace it.' } });
            }
            if (loaded.record?.initiative !== resource.subject) {
              throw missingAction();
            }
          }
          const status = await owners.runInitiativeStatus({ repoRoot: workspace.dir,
            initiative: resource.subject, ...(unit === null ? {} : { unit }), verbose: true });
          const selected = status.top_actions.find(action => (action.id ?? action.target_unit) === select.action);
          if (selected === undefined || unit !== null &&
              (!status.evidence.unit_resolved || status.evidence.initiative_mismatch)) {
            throw missingAction();
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
      if (name === 'field' && select.field === 'body' && select.view === 'sections') {
        return readDocumentSections({ markdown: resource.value.markdown, body: resource.value.body,
          title: resource.value.title, source: resource.subject, identity: [workspace.repo, resource.subject, resource.revision] }, select, reference, (reason, facts) => correctable(reason,
          { subject: resource.subject, ...facts, effects: { writes: [] },
            cause: facts?.cause ?? 'The requested section meaning must select exactly one passage in this document.' },
          { reference, select: { field: 'body', view: 'sections' } }, 'Supply distinguishing authored section meaning.',
          'Returns the section choices for the same document; no section is substituted.'));
      }
      if (name === "field" && (select.field === "markdown" || select.field === "body")) {
        return { field: select.field, value: resource.value[select.field] };
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
      const detailCalls = requirementGuidanceDetailNavigation(select.guidance)
        .map(({ selection, recommended, ...facts }) => ({ ...call({ reference, select: selection }, recommended), ...facts }));
      for (const detail of detailCalls) {
        if (!(await inputSchema.safeParseAsync(detail.arguments)).success) {
          throw new TypeError("requirement_guidance_detail_call_not_accepted: serving registrar rejected detail navigation");
        }
      }
      const families = registeredTier === 'paid_cce' ? requirementCaseFamilySelections(select.guidance) : [];
      return { guidance: [...select.guidance], value: resolved.value,
        ...(detailCalls.length ? { next_calls: detailCalls } : {}),
        ...(families.length ? { reference, selections: families,
          selection_context: { tool: READ_WIKI_TOOL,
            binding: "Choose needed selections; call {reads:[{reference,select:selections[i]},...]} with this answer's reference unchanged." } } : {}) };
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
              binding: `Choose versions[i].version_id; call {reads:[{reference,select:{entry:${JSON.stringify(select.entry)},version:versions[i].version_id}}]} unchanged.` } };
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
      const document = { ...entryJson(body.body.value),
        selection_source: [workspace.repo, resource.subject, body.entry_id, body.version_id] };
      const refuseNode = (reason, facts = {}) => correctable(reason,
        { entry: body.entry_id, version: body.version_id, ...facts },
        { reference, select: { entry: body.entry_id, version: body.version_id,
          ...(['entry_structure_member_not_found', 'selection_ambiguous', 'selection_kind_mismatch'].includes(reason) ? { view: 'structure', path: facts.resolved_path } : {}) } },
        reason === 'entry_structure_member_not_found' ? 'Choose a member returned by the containing structure.'
          : 'This immutable entry must contain structured JSON.',
        reason === 'entry_structure_member_not_found' ? 'Returns the containing structure’s choices in the same immutable version; no member is substituted.'
          : 'Returns the complete unchanged entry text.');
      const node = select.full === true
        ? { path, value: entryNodeValue(document, path, refuseNode), complete: true }
        : entryNode(document, path, refuseNode);
      const selection = { entry: body.entry_id, version: body.version_id, view: 'structure', path };
      return { entry: body.entry_id, version: body.version_id, reference: material.reference,
        ...node,
        next_calls: [],
        ...(select.full === true || !node.members?.length ? {} : { selection_context: {
          tool: READ_WIKI_TOOL, reference, select: selection,
          binding: 'Choose the needed members; append members[i].name (object field) or {match:members[i].match} (array member) to select.path. Call {reads:[{reference,select},...]}. No member is selected by default.' } }),
        ...(select.full === true || node.complete ? {} : { full_selection: call({ reference, select: { ...selection, full: true } }) }),
        original: call({ reference: { ref: material.reference }, select: { field: 'text' } }) };
    }
    return { entry_id: body.entry_id, version_id: body.version_id,
      body: { value: body.body.value }, material_binding: { value: { ref: material.reference } },
      ...(entryJson(body.body.value).status === 'json' ? { structure: call({ reference,
        select: { entry: body.entry_id, version: body.version_id, view: 'structure' } }) } : {}) };

  }

  async function publicSelectionSource(workspace, unit) {
    return cached('contract', [workspace.repo, unit], async () => {
      const { captured, population } = await capturedContract(workspace, unit);
      const selectionOwner = deps.publicSelectionOwner ?? await import('@agent-chassis/wiki-core/src/operations/controlled-contract/public-selection.mjs');
      try { return await selectionOwner.createPublicSelectionSource({ captured, population }); }
      catch (error) {
        if (error.details?.phase !== 'projection') throw error;

        const subjects = (captured.contract?.content.authored_requirements?.rows ?? [])
          .filter(row => row.claim_ids.includes(error.details.claim_id)).map(row => row.input.subject)
          .filter(subject => subject?.identity !== undefined)
          .map(subject => ({ identity: subject.identity, ...(subject.type_term === undefined ? {} : { type_term: subject.type_term }) }));
        const known = [...new Map(subjects.map(subject => [JSON.stringify(subject), subject])).values()];
        const details = Object.fromEntries(['field', 'collection', 'uncertainty']
          .filter(key => error.details[key] !== undefined).map(key => [key, error.details[key]]));
        throw Object.assign(error, { sourceUnavailable: true, envelope: {
          code: error.code, subject: unit, cause: { code: error.code, message: error.message },
          details: { ...details, correspondence: known.length ? { state: 'known', authored_subjects: known }
            : { state: 'unavailable', cause: 'No authored declaration correspondence is established for the failed relationship.' } },
          effects: { writes: [] },
          stopping_condition: error.details.correction ?? 'The complete saved contract has an inconsistent relationship. No supported semantic save can safely infer the missing meaning.'
        } });
      }
    });
  }

  async function selectContract(workspace, unit, select, reference) {
    const source = await publicSelectionSource(workspace, unit);
    const selectionOwner = deps.publicSelectionOwner ?? await import('@agent-chassis/wiki-core/src/operations/controlled-contract/public-selection.mjs');
    const { default: Ajv } = await import('ajv/dist/2020.js');
    const validate = new Ajv({ strict: false }).compile(selectionOwner.buildPublicSelectionSchema({
      kinds: ['requirement', 'claim', 'verification', 'collection', 'case', 'obligation', 'entity', 'criterion', 'unresolved'] }));
    if (select.where !== undefined && !validate(select.where)) throw invalid('selection_pattern_invalid', { subject: unit, field: 'select.where',
      cause: 'The requested selector does not satisfy the shared public selection grammar.',
      fields: validate.errors.map(({ instancePath, message }) => ({ path: instancePath, message })) });
    return readRequirementModel(source, select, reference, { selectionOwner });
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
    if (name === "context") return completeProducedContent(contextResult(workspace, resource, subject));
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
    if (name === "context") return completeProducedContent(contextResult(null, resource, subject));
    if (!(name === "field" && select.field === "text")) {
      throw invalid("selection_not_applicable", { source_kind: KIND.PACKAGE_DOCUMENT, select });
    }
    const owner = { repo: identity.owner_package };
    const descriptor = await retainResource(owner, resource);
    return deliver(descriptor, null, await bindingFor(owner, identity.path), select,
      async () => select.view !== 'sections' ? { field: "text", value: text }
        : readDocumentSections({ markdown: text, body: text, title: identity.path, source: identity.path,
          identity: [identity.owner_package, identity.owner_package_version, identity.path, identity.sha256] },
          select, subject, (reason, facts) => correctable(reason,
            { subject, ...facts, effects: { writes: [] },
              cause: facts?.cause ?? 'The requested section meaning must select exactly one passage in the serving package document.' },
            { reference: subject, select: { field: 'text', view: 'sections' } },
            'Supply distinguishing authored section meaning.', 'Returns section choices from the same serving package document.')), true);
  }

  function receiptRead(args, source, binding, workspace) {
    const select = args.select ?? { context: true };
    const name = selectionName(select);
    requireGrant(KIND.RECEIPT, name);
    if (!(name === 'context' || name === 'inventory' && select.inventory === 'findings'))
      throw invalid('selection_not_applicable', { subject: binding.unit,
        cause: 'This captured receipt supplies its complete findings and effects, not a current saved-record selection.' });
    return owners.readCompleteCloseoutReceipt({ repository: workspace.repo, unit: binding.unit, env,
      receipt: source, project: original => ({ operation: original.operation, unit: original.unit,
        effects: original.effects, ...(original.closeout_lint?.ok === true ? {} : { closeout_lint: original.closeout_lint }),
        findings: (original.findings ?? []).map(({ finding_id: _address, ...meaning }) => meaning) }) });
  }

  async function receiptSelectionRefusal(source, stored, select) {
    const selection = selectionName(select ?? { context: true });
    const details = { subject: stored.unit, source_kind: KIND.RECEIPT, selection,
      cause: 'This reference names a captured save outcome; the requested saved content belongs to its current unit.' };
    const direct = ['contract', 'field', 'inventory'].includes(selection) &&
      (selection !== 'field' || readableWorkFields(stored.unit?.includes('#') ? 'slice' : 'record').some(row => row.field === select.field)) &&
      (selection !== 'inventory' || ['fields', 'entries', 'tasks', 'slices'].includes(select.inventory));
    const corrected = { subject: stored.unit, ...(direct ? { select } : {}) };
    if (stored.route !== SAVE_RECORD_ROUTE || readOriginalReference === null ||
        !WORK_UNIT_PATTERN.test(String(stored.unit)) ||
        !grants.rows.some((row) => row.source_kind === KIND.RECEIPT) || !granted(KIND.RECORD, "context") ||
        !readSchema.safeParse(corrected).success) return invalid("selection_not_granted", details);

    const original = await readOriginalReference({ args: { reference: source }, source, binding: stored });
    if (original === null || original.isError === true || original.structuredContent?.unit !== stored.unit) {
      return invalid("selection_not_granted", details);
    }
    return correctable("selection_not_granted", details, corrected,
      "the reference names a save receipt, which offers no record or contract selection",
      "the call reads the requested content from the saved unit's current source; it does not replay the save");
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
      if (args.for_changes !== undefined) throw invalid('authoring_context_unavailable', {
        subject: stored.unit, cause: 'A captured operation receipt supplies no current write context. Request the current target unit separately.' });
      const requested = selectionName(args.select ?? { context: true });
      if (!granted(KIND.RECEIPT, requested)) throw await receiptSelectionRefusal(source, stored, args.select);
      if (readOriginalReference !== null) {
        const original = await readOriginalReference({ args, source, binding: stored });
        if (original !== null) return original;
      }
      return receiptRead(args, source, stored, workspace);
    }
    const expected = await bindingFor(workspace, stored.unit);
    const select = args.select ?? { context: true };
    const name = selectionName(select);
    const grantKind = (carrier) => (carrier.source_kind === KIND.ASSIGNMENT &&
      (name === "contract" || name === "obligation") ? KIND.ASSIGNED_CONTRACT : carrier.source_kind);
    const sourceMoved = (carrier, resource) => correctable("source_moved", { source_kind: carrier.source_kind,
      subject: carrier.subject, cause: 'The retained selection source has moved; its requested content was not replaced.' },
    carrier.source_kind === KIND.SEARCH
      ? { search: Object.fromEntries(Object.entries({ query: carrier.subject.query ?? undefined,
          where: Object.keys(carrier.subject.where).length > 0 ? carrier.subject.where : undefined,
          history: carrier.subject.history || undefined, inventory: carrier.subject.inventory || undefined })
          .filter(([, value]) => value !== undefined)) }
      : carrier.source_kind === KIND.ASSIGNMENT ? { assignment: true } : { subject: carrier.subject },
    "the selected source changed after this reference was returned",
    "the call returns the current context of the same subject and a fresh reference; it does not apply the earlier selection");

    if (name === 'context' || args.for_changes !== undefined) {
      const { carrier } = readSelectedResponseSource(source, { env, expected });
      const resource = await reopen(workspace, carrier);
      if (carrier.revision !== null && resource.revision !== carrier.revision ||
          carrier.authoring_revision !== undefined && resource.authoring_revision !== carrier.authoring_revision)
        throw sourceMoved(carrier, resource);
      if (args.for_changes !== undefined) await collectWriteContext(workspace, resource, source, args.for_changes);
      if (name === 'context') {
        requireGrant(carrier.source_kind, 'context');
        const result = contextResult(workspace, resource, source);
        return contextContent(resource.source_kind === KIND.RECORD_KIND ? await withAuthoringChoices(result, resource) : result, workspace, resource);
      }
    }
    return deliver(source, workspace, expected, select, async (carrier) => {

      if (name === "input_contract") {

        return readInputContract({ carrier, select, reference: source, requireGrant, reopen: () => reopen(workspace, carrier),
          readSavedContract: !granted(carrier.source_kind, "contract") ? null : async (unit) =>
            publicSelectionSource(workspace, unit) });
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

  function issueResult(error, args) {
    const envelope = error.envelope ?? error.structuredContent ?? {};
    const code = envelope.code ?? error.code ?? 'workspace_read_wiki_source_unavailable';
    const { schema_version: _schema, accepted: _accepted, code: _code, subject, cause,
      next_calls, ...facts } = envelope;
    const details = error.details === undefined ? undefined : { ...error.details,
      ...(Array.isArray(error.details.schema_errors) ? { schema_errors: groupCompleteSchemaDiagnostics(error.details.schema_errors) } : {}) };
    const issue = { code, subject: subject ?? args.subject ?? args.reference ?? (args.assignment ? { assignment: true } : { search: args.search }),
      cause: cause ?? { code, message: error.message ?? code },
      ...(details === undefined || Object.hasOwn(facts, 'details') ? {} : { details }), ...facts,
      ...(next_calls?.length ? { next_calls } : {}) };
    return { status: code === 'selection_ambiguous' ? 'ambiguous'
      : error.sourceUnavailable || code.includes('unavailable') || code.includes('unreadable') || ['source', 'projection'].includes(error.details?.phase)
        || isPlatformErrorCode(code) ? 'unavailable' : 'refused', issue };
  }

  async function readItem(args) {
    try {
      const parsed = await readSchema.safeParseAsync(args);
      if (!parsed.success) return { status: 'refused', issue: inputDiagnosis.item(args, parsed.error) };
      args = parsed.data;
      if (args.for_changes !== undefined && (args.select?.version !== undefined || args.select?.history === true ||
          args.reference?.ref !== undefined || args.reference?.tool_name !== undefined))
        throw invalid('authoring_context_unavailable', { subject: args.subject ?? args.reference,
          cause: 'An immutable, historical or package selection supplies no current write context. Request the current target unit separately in the same reads array.' });
      authenticateFrozenReviewSource();
      let reply;
      if (args.reference !== undefined) reply = await referenceRead(args);
      else if (args.search !== undefined) {
        if (args.for_changes !== undefined) throw invalid('authoring_context_unavailable', { cause: 'Search is not a writable unit.' });
        if (args.select !== undefined) {
          const workspace = resolveWorkspaceReadRepo({});
          const resource = await searchResource(workspace, { query: args.search.query ?? null,
            where: args.search.where ?? {}, history: args.search.history === true, inventory: args.search.inventory === true });
          requireGrant(KIND.SEARCH, selectionName(args.select));
          reply = await selectValue(workspace, resource, args.select, await retainResource(workspace, resource));
          reply = completeProducedContent(reply);
        } else reply = await searchContext(args);
      } else if (args.subject !== undefined) reply = await subjectContext(args);
      else {
        if (args.for_changes !== undefined) throw invalid('authoring_context_unavailable', { cause: 'A frozen assignment is not current writable content.' });
        if (args.select === undefined || args.select.context) reply = await assignmentContext();
        else {
          const workspace = resolveWorkspaceRepo(workspaceRepos, undefined);
          const resource = await assignmentResource();
          requireGrant(['contract', 'obligation'].includes(selectionName(args.select)) ? KIND.ASSIGNED_CONTRACT : KIND.ASSIGNMENT,
            selectionName(args.select));
          const reference = await retainResource(workspace, resource);
          reply = await deliver(reference, workspace, await bindingFor(workspace, resource.unit), args.select,
            () => selectValue(workspace, resource, args.select, reference));
        }
      }
      const value = reply.structuredContent;
      if (reply.isError === true) return issueResult({ structuredContent: value }, args);
      if (value === undefined) throw new TypeError('The selected reader did not supply complete structured meaning.');
      if (['ok', 'partial', 'unavailable', 'refused', 'ambiguous'].includes(value.status))
        return { status: value.status, ...(value.value === undefined ? {} : { value: value.value }),
          ...(value.issue === undefined ? {} : { issue: value.issue }), ...(value.issues === undefined ? {} : { issues: value.issues }),
          ...(value.next_calls?.length ? { next_calls: value.next_calls } : {}) };
      const { next_calls: calls, revision: _writeRevision, source_kind: _sourceKind, ...meaning } = value;
      return { status: 'ok', value: meaning,
        ...(calls?.length ? { next_calls: calls } : {}) };
    } catch (error) {
      return issueResult(error, args ?? {});
    }
  }

  const projectInputFailure = async ({ args, validationError }) => ({
    terminal_result: errorContent({ envelope: inputDiagnosis.envelope(args, validationError) })
  });

  return {
    name: READ_WIKI_TOOL,
    config: { description: describeReadWikiTool(advertisedInputSchema), inputSchema, advertisedInputSchema,
      publishedInputSchemaProjection: publishedReadWikiInputSchema, inputValidationErrorProjector: projectInputFailure },
    handler: args => bulkScope.run({ cache: new Map(), writeRequests: new Map() }, async () => {
      const results = [];

      for (const read of args.reads) results.push(await readItem(read));
      const contexts = {};
      for (const [unit, { workspace, resource, reference, members }] of bulkScope.getStore().writeRequests) {
        try {
          const focused = await withAuthoringChoices({ reference, revision: resource.authoring_revision }, resource, members);
          const { unit: _repeatedUnit, ...identity } = focused.authoring_context ?? {};
          contexts[unit] = { revision: focused.revision,
            ...(focused.authoring_context === undefined ? {} : { authoring_context: identity }),
            ...(focused.next_calls?.length ? { next_calls: focused.next_calls } : {}) };
        } catch (error) {

          for (let index = 0; index < args.reads.length; index++)
            if (args.reads[index]?.for_changes && (args.reads[index].subject === unit || args.reads[index].reference?.ref_id === reference.ref_id))
              results[index] = results[index].status === 'ok' && args.reads[index].select !== undefined
                ? { status: 'partial', value: results[index].value, issues: [issueResult(error, args.reads[index]).issue],
                  ...(results[index].next_calls ? { next_calls: results[index].next_calls } : {}) }
                : issueResult(error, args.reads[index]);
        }
      }
      const shared = shareReadWikiDefinitions(results, args.reads.map(read => {
        if (read === null || typeof read !== 'object' || Array.isArray(read)) return null;
        const { select: _select, for_changes: _changes, ...source } = read;
        return source;
      }));
      const value = { results, ...(Object.keys(contexts).length ? { contexts } : {}), ...(shared.length ? { shared } : {}) };

      return completeProducedContent(value);
    }),
    call, acquireSavedUnitReference
  };

}

export function registerReadWikiTools({ registerTool, ...composition }) {
  const task = createReadWikiTask({ ...composition, requestContracts: registeredToolRequestContracts(registerTool) });
  if (task !== null) registerTool(task.name, task.config, task.handler);
  return task;
}
