import { isDeepStrictEqual } from "node:util";

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { SIDECAR_NAVIGATION_RESULT_FIELDS, fitNavigationSummary } from
  "@agent-chassis/wiki-core/src/lib/sidecar-navigation-projection.mjs";
import { RETAINED_ANSWER_NEXT_ACTION } from "@agent-chassis/wiki-core/src/lib/sidecar-query-projection.mjs";
import { SIDECAR_CODE_QUESTION_FIELDS, SIDECAR_CODE_QUESTION_RELATIONSHIPS } from
  "@agent-chassis/wiki-core/src/lib/sidecar-query-input.mjs";
import { SIDECAR_PUBLISHED_INDEX_UNAVAILABLE_CODE, pinnedQueryContext } from
  "@agent-chassis/wiki-core/src/lib/sidecar-published-preparation.mjs";
import { selectRetainedSourceLines } from
  "@agent-chassis/wiki-core/src/lib/sidecar-source-regions.mjs";
import { projectSidecarSymbolQueryForMcp } from
  "@agent-chassis/wiki-core/src/lib/sidecar-symbol-query.mjs";
import { jsonContent, measureMcpInlineResultBytes, selectedFullContent } from "./mcp-response.mjs";
import {
  containsReservedAssessmentEnvelope,
  createSelectedResponseSession,
  readSelectedResponseSource,
  selectedResponseCorrectableError,
  selectedResponseDetailSchema,
  selectedResponseQueryInvalidError
} from "./selected-response-snapshot.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";
import { inputContractMechanicalRefusal } from "./tool-discovery-input-guidance-delivery.mjs";

export const CODE_INDEX_SELECTED_SUMMARY_SCHEMA_VERSION = "code-index-selected-summary.v2";
export const CODE_INDEX_SELECTED_DETAIL_SCHEMA_VERSION = "code-index-selected-detail.v1";
export const CODE_INDEX_NAVIGATION_ANSWER_SCHEMA_VERSION = "code-index-question-navigation.v1";
export const CODE_INDEX_UNAVAILABLE_SCHEMA_VERSION = "code-index-unavailable.v1";

const COMPOSITION_MAX_PASSES = 3;

const QUERY_ARGUMENTS = SIDECAR_CODE_QUESTION_FIELDS;

const NAVIGATION_RELATIONSHIPS = SIDECAR_CODE_QUESTION_RELATIONSHIPS;

const NAVIGATION_RESULT_FIELDS = SIDECAR_NAVIGATION_RESULT_FIELDS;

const RETAINED_QUERY_MATERIAL = new Set(["input_diff_sources"]);
const DETAIL_FRAME_MEMBERS = new Set(["schema_version", "workspaceRepo", "query_kind", "observation",
  "selected_detail", "page", "next_calls", "read_mode", "mixed_source"]);

const ROW_IDENTITY_FIELDS = Object.freeze(["hit_id", "region_id", "edge_id", "id"]);
const ROW_PATH_FIELDS = Object.freeze(["path", "document_path", "input_path", "newPath", "oldPath"]);
const ROW_SYMBOL_FIELDS = Object.freeze(["symbol", "symbol_key", "symbol_id", "caller_symbol",
  "callee_symbol"]);
const SELECTION_FIELDS = Object.freeze(["selector", "path", "symbol", "relationship", "input_path", "lines"]);

const SELECTOR_KEYS = Object.freeze(["id", "path", "symbol", "relationship", "input_path", "lines"]);

const ANSWER_FACTS = "@answer";
const COLLECTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

const PREPARATION_TOOL = "workspace_code_index_build";
const PREPARATION_PURPOSE = "prepare_index";
export const CODE_INDEX_INSPECTION_PURPOSE = "inspect_evidence";

const STATUS_QUERY_KIND = "code_index_status";
export const CODE_INDEX_STATUS_DIAGNOSIS = "diagnosis";

export function createCodeIndexPreparationGuidance(contracts = null) {
  return async () => {
    const contract = contracts?.contractFor(PREPARATION_TOOL) ?? null;
    if (contract === null || !await contract.acceptsArguments({})) {
      return { state: "capability_unavailable", call: null,
        slot: { state: "capability_unavailable", missing_capability: "prepare_code_index" },
        sentence: "This session has no registered operation that prepares the code index " +
          "(preparation.missing_capability)." };
    }
    return { state: "action_available",
      call: { ...buildNextCall({ tool: PREPARATION_TOOL, arguments: {} }), purpose: PREPARATION_PURPOSE },
      slot: { state: "action_available", operation: PREPARATION_TOOL },
      sentence: `Call ${PREPARATION_TOOL} with {} (next_calls, purpose ${PREPARATION_PURPOSE}) to prepare ` +
        "current HEAD and wait." };
  };
}

function statusDiagnosis(summary) {
  const { input_identity: _identity, ...scip } = summary.scip_state ?? {};
  return { freshness: summary.freshness, status_reason: summary.status_reason,
    index_action: summary.index_action, artifact_exists: summary.artifact_exists,
    graph_available: summary.graph_available, dirty_state: summary.dirty_state,
    scip_state: summary.scip_state === null ? null : scip };
}

async function withStatusRecovery(response, preparation) {
  if (response.query_kind !== STATUS_QUERY_KIND ||
      response.selected_detail?.collection !== CODE_INDEX_STATUS_DIAGNOSIS) return response;
  const guidance = await preparation();
  const { next_calls: continuations, ...frame } = response;
  const diagnosis = frame[CODE_INDEX_STATUS_DIAGNOSIS];
  return { ...frame, preparation: guidance.slot,
    next_action: `Retained status diagnosis: index ${diagnosis?.status_reason ?? "unknown"}; SCIP: ${
      diagnosis?.scip_state?.status_reason ?? "unknown"}. It describes indexed_commit against the current_head ` +
      "that status read observed; observation compares indexed_commit with HEAD now, and neither is a new " +
      `status probe. ${guidance.sentence} This read prepared, refreshed and repaired nothing; ` +
      "graph_snapshot selects the complete provenance.",
    next_calls: [...(guidance.call === null ? [] : [{ ...guidance.call, recommended: true }]), ...continuations] };
}

function unavailableNextAction(refresh, preparation) {
  if (refresh?.state === "failed") {
    return "No usable published code index exists and its background preparation failed " +
      "(index_state.refresh.failure). Correct that cause, then repeat this call after " +
      `index_state.refresh.retry.not_before. ${preparation.sentence}`;
  }
  if (refresh?.state === "queued" || refresh?.state === "running") {
    return "No usable published code index exists yet; its preparation is " +
      `${refresh.state} in the background. Repeat this call to read the answer once it publishes. ` +
      preparation.sentence;
  }
  return "No usable published code index exists and no background preparation was started " +
    `(index_state.refresh). ${preparation.sentence}`;
}

export function createCodeIndexUnavailableResponse({ workspaceRepo, route, args, error, preparation }) {
  return {
    schema_version: CODE_INDEX_UNAVAILABLE_SCHEMA_VERSION,
    workspaceRepo,
    available: false,
    code: error.code,
    index_state: structuredClone(error.index_state),
    preparation: preparation.slot,
    next_action: unavailableNextAction(error.index_state?.refresh, preparation),
    next_calls: [buildNextCall({ tool: route, arguments: structuredClone(args), recommended: true }),
      ...(preparation.call === null ? [] : [preparation.call])]
  };
}

function responseContractError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function codeIndexDetailSchema(z) {
  const shared = selectedResponseDetailSchema(z).shape;
  return z.object({
    source: shared.source,
    collection: shared.collection,
    snapshot_identity: shared.snapshot_identity,
    cursor: shared.cursor,
    ordinal: shared.ordinal,
    selector: z.object({ id: z.string().min(1).max(4096) }).strict().optional(),
    path: z.string().min(1).max(4096).optional(),
    symbol: z.string().min(1).max(4096).optional(),
    relationship: z.string().min(1).max(256).optional(),
    input_path: z.string().min(1).max(4096).optional(),
    lines: z.object({ start_line: z.number().int().positive(),
      end_line: z.number().int().positive() }).strict().optional()
  }).strict();
}

const NAVIGATION_PART_COLLECTIONS = Object.freeze(["source_hits", "context_regions", "complete_files"]);
function selectableSubjects(carrier) {
  const subjects = new Map();
  for (const [name, value] of Object.entries(carrier)) {
    if (RETAINED_QUERY_MATERIAL.has(name) || DETAIL_FRAME_MEMBERS.has(name) ||
        !COLLECTION_NAME_PATTERN.test(name)) continue;
    if (Array.isArray(value)) subjects.set(name, { kind: "rows", rows: value });
    else if (plainObject(value)) subjects.set(name, { kind: "member", rows: [value] });
  }
  if (Array.isArray(carrier.symbol_resolution?.candidates)) {
    subjects.set("candidates", { kind: "rows", rows: carrier.symbol_resolution.candidates });
  } else if (plainObject(carrier.parts)) {
    const parts = Object.entries(carrier.parts).filter(([, part]) => plainObject(part));
    const across = (rowsOf) => parts.flatMap(([relationship, part]) => rowsOf(part).map((row) =>
      (plainObject(row) ? { ...row, relationship_kind: relationship } : row)));
    const candidates = across((part) => (Array.isArray(part.symbol_resolution?.candidates)
      ? part.symbol_resolution.candidates : []));
    if (candidates.length > 0) subjects.set("candidates", { kind: "rows", rows: candidates });
    for (const name of NAVIGATION_PART_COLLECTIONS) {
      if (subjects.has(name) || !parts.some(([, part]) => Array.isArray(part[name]))) continue;
      subjects.set(name, { kind: "rows", rows: across((part) => (Array.isArray(part[name]) ? part[name] : [])) });
    }
  }
  return subjects;
}

export function codeIndexCollectionCounts(carrier) {
  return Object.fromEntries([...selectableSubjects(carrier)]
    .filter(([, subject]) => subject.kind === "rows")
    .map(([name, subject]) => [name, subject.rows.length]));
}

function rowIdentity(row) {
  if (typeof row === "string") return row;
  if (!plainObject(row)) return null;
  const field = ROW_IDENTITY_FIELDS.find((name) => typeof row[name] === "string");
  return field === undefined ? null : row[field];
}

function rowPath(row) {
  if (typeof row === "string") return row;
  if (!plainObject(row)) return null;
  const field = ROW_PATH_FIELDS.find((name) => typeof row[name] === "string");
  return field === undefined ? null : row[field];
}

function namesPath(row, path) {
  if (typeof row === "string") return row === path;
  return plainObject(row) && ROW_PATH_FIELDS.some((field) => row[field] === path);
}

function namesSymbol(row, symbol) {
  if (!plainObject(row)) return false;
  return ROW_SYMBOL_FIELDS.some((field) => row[field] === symbol) ||
    (Array.isArray(row.symbol_keys) && row.symbol_keys.includes(symbol));
}

function withRelationship(row, relationship) {
  if (!plainObject(row)) return null;
  if (row.kind === relationship || row.relationship_kind === relationship) return row;
  let matched = false;
  const selected = { ...row };
  for (const [field, value] of Object.entries(row)) {
    if (!Array.isArray(value) || !value.some((entry) => plainObject(entry) && typeof entry.kind === "string")) {
      continue;
    }
    selected[field] = value.filter((entry) => entry?.kind === relationship);
    matched ||= selected[field].length > 0;
  }
  return matched ? selected : null;
}

function selectRows(rows, selection) {
  const selected = [];
  const positions = [];
  for (const [position, row] of rows.entries()) {
    if (selection.selector !== undefined && rowIdentity(row) !== selection.selector.id) continue;
    if (selection.path !== undefined && !namesPath(row, selection.path)) continue;
    if (selection.symbol !== undefined && !namesSymbol(row, selection.symbol)) continue;
    let chosen = selection.relationship === undefined ? row : withRelationship(row, selection.relationship);
    if (chosen !== null && selection.input_path !== undefined) {
      if (!Array.isArray(chosen.relationships)) continue;
      const relationships = chosen.relationships.filter((entry) => entry?.input_path === selection.input_path);
      if (relationships.length === 0) continue;
      chosen = { ...chosen, relationships };
    }
    if (chosen !== null) {
      selected.push(chosen);
      positions.push(position);
    }
  }
  return { selected, positions };
}

export async function describeRetainedObservation(binding, resolveCurrentObservationIdentity) {
  const retained = binding?.observation_identity ?? null;
  const observation = { kind: "retained_prior_observation", observation_identity: retained };
  if (typeof resolveCurrentObservationIdentity !== "function" || typeof retained !== "string") {
    return { ...observation, state: "unavailable", unavailable_reason: "observation_identity_unrecorded" };
  }
  try {
    const current = await resolveCurrentObservationIdentity(Object.freeze({ ...binding }));
    return { ...observation, state: current === retained ? "current" : "changed" };
  } catch (error) {

    return { ...observation, state: "unavailable",
      unavailable_reason: typeof error?.code === "string" ? error.code : "current_observation_identity_unreadable",
      ...(Number.isInteger(error?.code) ? { exit_code: error.code } : {}) };
  }
}

function selectionOf(detail) {
  const selection = {};
  for (const field of SELECTION_FIELDS) {
    if (detail[field] !== undefined) selection[field] = structuredClone(detail[field]);
  }
  return selection;
}

export function selectCodeIndexRetainedCollection({ route, carrier, detail }) {
  const subjects = selectableSubjects(carrier);
  return selectFromSubject({ route, collections: [...subjects.keys()],
    subject: subjects.get(detail.collection), detail });
}

function selectFromSubject({ route, collections, subject, detail }) {
  if (subject === undefined) {
    throw selectedResponseQueryInvalidError(route, "collection_unknown", {
      collection: detail.collection,
      collections,
      ...(RETAINED_QUERY_MATERIAL.has(detail.collection) ? { retained_query_material: true } : {})
    });
  }
  const selection = selectionOf(detail);
  const filtered = Object.keys(selection).length > 0;
  if (selection.input_path !== undefined && (detail.collection !== "affected_files" ||
      selection.path === undefined && selection.selector === undefined)) {
    throw selectedResponseQueryInvalidError(route, "selection_not_applicable",
      { collection: detail.collection, selection: ["input_path"],
        required: "one affected file selected by path or selector.id" });
  }
  if (selection.lines !== undefined && (!new Set(["context_regions", "complete_files"])
    .has(detail.collection) || selection.path === undefined && selection.selector === undefined)) {
    throw selectedResponseQueryInvalidError(route, "selection_not_applicable",
      { collection: detail.collection, selection: ["lines"],
        required: "one retained region by selector.id or complete file by path" });
  }
  if (subject.kind === "member" && filtered) {
    throw selectedResponseQueryInvalidError(route, "selection_not_applicable",
      { collection: detail.collection, selection: Object.keys(selection) });
  }
  const chosen = filtered ? selectRows(subject.rows, selection)
    : { selected: subject.rows, positions: subject.rows.map((_row, position) => position) };
  let matched = chosen.selected;
  if (filtered && matched.length === 0) {
    throw selectedResponseQueryInvalidError(route, "selection_matched_nothing",
      { collection: detail.collection, selection });
  }
  let relationshipCounts = null;
  if (selection.input_path !== undefined) {
    if (matched.length !== 1) throw selectedResponseQueryInvalidError(route,
      "selection_ambiguous", { collection: detail.collection, selection });
    const original = subject.rows.find((row) => rowPath(row) === rowPath(matched[0]));
    relationshipCounts = { total: original.relationships.length,
      matched: matched[0].relationships.length, returned: matched[0].relationships.length,
      truncated: false };
  }
  if (selection.lines !== undefined) {
    if (matched.length !== 1) throw selectedResponseQueryInvalidError(route,
      "selection_ambiguous", { collection: detail.collection, selection });
    const [row] = matched;
    try {
      const source_text = selectRetainedSourceLines(row, selection.lines);
      matched = [{ ...row, source_text, selected_lines: { ...selection.lines } }];
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      throw selectedResponseQueryInvalidError(route, "source_lines_out_of_range",
        { collection: detail.collection, selection, retained_bounds:
          { start_line: row.start_line, end_line: row.end_line } });
    }
  }
  return { subject, selection, matched, relationshipCounts, positions: chosen.positions };
}

function sharedSelectorOf(detail) {
  const selector = { ...(detail.selector === undefined ? {} : { id: detail.selector.id }) };
  for (const key of SELECTOR_KEYS.slice(1)) {
    if (detail[key] !== undefined) selector[key] = structuredClone(detail[key]);
  }
  return Object.keys(selector).length === 0 ? null : selector;
}

function codeSelectionOf(selector) {
  const { id, ...filters } = selector ?? {};
  return { ...(id === undefined ? {} : { selector: { id } }), ...filters };
}

function projectCodeCollections(carrier) {
  const kinds = {};
  const collections = {};
  for (const [name, subject] of selectableSubjects(carrier)) {
    kinds[name] = subject.kind;
    collections[name] = subject.rows.map((row, position) => ({ id: String(position), value: row }));
  }
  return { [ANSWER_FACTS]: [{ id: ANSWER_FACTS, value: { kinds, query_kind: carrier.query_kind ?? null,
    workspaceRepo: carrier.workspaceRepo ?? null, source: answerSourceFacts(carrier) } }], ...collections };
}

function answerSourceFacts(answer) {
  if (!plainObject(answer.parts)) {
    return { indexed_commit: answer.indexed_commit ?? null,
      indexed_commit_short: answer.indexed_commit_short ?? null, current_head: answer.current_head ?? null };
  }
  const parts = Object.values(answer.parts).filter(plainObject);
  const one = (field) => {
    const values = [...new Set(parts.map((part) => part[field] ?? null))];
    return values.length === 1 ? values[0] : null;
  };

  const agreed = new Set(parts.map((part) => part.indexed_commit ?? null)).size <= 1;
  return { indexed_commit: one("indexed_commit"),
    indexed_commit_short: agreed ? one("indexed_commit_short") : null,
    current_head: one("current_head"), ...(agreed ? {} : { mixed_source: true }) };
}

function createCodeRowSelection(route) {
  const bySnapshot = new WeakMap();
  return ({ collections, collection, selector }) => {
    let selections = bySnapshot.get(collections);
    if (selections === undefined) bySnapshot.set(collections, selections = new Map());
    const key = JSON.stringify([collection, selector]);
    const held = selections.get(key);
    if (held !== undefined) return held;
    const facts = collections[ANSWER_FACTS][0].value;
    const projected = Object.hasOwn(facts.kinds, collection) ? collections[collection] : undefined;
    const { subject, selection, matched, relationshipCounts, positions } = selectFromSubject({ route,
      collections: Object.keys(facts.kinds),
      subject: projected === undefined ? undefined
        : { kind: facts.kinds[collection], rows: projected.map((row) => row.value) },
      detail: { collection, ...codeSelectionOf(selector) } });

    const rows = matched.map((row, index) => {
      const original = projected[positions[index]];
      return original.value === row ? original : Object.freeze({ id: original.id, value: row });
    });
    const selected = { rows, metadata: { kind: subject.kind, query_kind: facts.query_kind,
      workspaceRepo: facts.workspaceRepo, source: facts.source, selection, total: subject.rows.length,
      relationship_counts: relationshipCounts,

      rows } };
    selections.set(key, selected);
    return selected;
  };
}

function presentCodeDetail(response) {
  const { page } = response;
  const retained = page.retained_source;
  const facts = page.selected;
  const rows = page.items.map((row) => {
    if (Object.hasOwn(row, "value")) return row.value;
    const original = facts.rows.find((entry) => entry.id === row.id);
    if (original === undefined) throw new TypeError("selected code row is absent from its authenticated selection");
    return original.value;
  });
  const nested = facts.relationship_counts;
  return {
    schema_version: CODE_INDEX_SELECTED_DETAIL_SCHEMA_VERSION,
    workspaceRepo: facts.workspaceRepo ?? retained.repository,
    query_kind: facts.query_kind,

    read_mode: "retained",
    ...facts.source,
    observation: response.observation,
    selected_detail: { source: { ref_id: retained.ref_id },
      collection: page.collection, selection: facts.selection, presentation: "complete",
      counts: nested === null ? { total: facts.total, matched: page.total, returned: page.returned,
        truncated: page.returned < page.total }
        : { total: nested.total, matched: nested.matched, returned: page.returned === 0 ? 0 : nested.matched,
          truncated: page.returned === 0 } },
    page: { collection: page.collection, total: page.total, offset: page.offset, returned: page.returned,
      has_more: page.complete !== true },
    [page.collection]: facts.kind === "member" ? rows[0] ?? null : rows,
    next_calls: response.next_calls
  };
}

export function createCodeIndexAnswerSelection({ route, requestSchema, detailSchema, buildDetailArguments,
  resolveCurrentObservationIdentity = null, env = process.env }) {
  if (typeof route !== "string" || typeof buildDetailArguments !== "function" ||
      requestSchema === null || typeof requestSchema !== "object" ||
      typeof detailSchema?.safeParse !== "function" ||
      typeof detailSchema.shape?.cursor?.safeParse !== "function") {
    throw new TypeError("a code answer selection requires route, requestSchema, detailSchema and buildDetailArguments");
  }
  const detailCall = (repository, selection, extra = {}) => buildNextCall({ tool: route,
    arguments: buildDetailArguments(Object.freeze({ repository, unit: null }), selection), recommended: true,
    ...extra });
  const observationOf = (binding) => describeRetainedObservation(binding, resolveCurrentObservationIdentity);
  const session = createSelectedResponseSession({ route, requestSchema, env,

    describeObservation: (retained) => observationOf({ ...retained,
      observation_identity: retained.observation_identity ?? null }),

    completePageDelivery: { acceptsCursor: (cursor) => detailSchema.shape.cursor.safeParse(cursor).success },

    buildDetailArguments: (binding, { selector, ...shared }) =>
      buildDetailArguments(binding, { ...shared, ...codeSelectionOf(selector) }),
    projectCollections: projectCodeCollections, selectorKeys: SELECTOR_KEYS,

    selectRows: createCodeRowSelection(route), projectRow: (_domain, _collection, row) =>
      containsReservedAssessmentEnvelope(row) ? row : { id: row.id },
    presentResponse: presentCodeDetail });

  const authenticated = (repository, detail) => readSelectedResponseSource(detail.source, { env,
    expected: { route, repository } });

  return Object.freeze({
    route,
    maximumBytes: session.maximumBytes,
    requestSchema,
    detailSchema,

    retain({ binding, carrier, selection }) {
      return session.retain({ binding, carrier,
        ownerCall: (locator) => ({ tool: route, arguments: buildDetailArguments(Object.freeze({
          repository: binding.repository, unit: null }), {
          source: { ref_id: locator.ref_id }, ...selection }) }),
        ownerRequestSchema: requestSchema });
    },

    detailCall(binding, selection, extra = {}) {
      return detailCall(binding.repository, selection, extra);
    },

    async detail({ repository, detail, extend = null }) {
      const retained = authenticated(repository, detail);
      const { selector: _id, path: _path, symbol: _symbol, relationship: _relationship,
        input_path: _input, lines: _lines, ...shared } = detail;
      const selector = sharedSelectorOf(detail);
      const response = await session.detail({ expected: { route, repository },
        detail: { ...shared, ...(selector === null ? {} : { selector }) } });
      return selectedFullContent({ source: detail.source, retained,
        projection: extend === null ? response : await extend(response) });
    },

    validate({ repository, detail }) {
      selectCodeIndexRetainedCollection({ route, carrier: authenticated(repository, detail).carrier, detail });
    },

    observation: observationOf
  });
}

export function createSelectedCodeIndexResponse({ workspaceRepo, result, carrier = result,
  projectSummary, session, queryIdentity, collections = [],
  semanticChoices = false, readMode = "query",
  observationIdentity = result?.indexed_commit ?? result?.index_head ?? null }) {
  const full = { workspaceRepo, ...structuredClone(carrier) };
  const binding = { route: session.route, repository: workspaceRepo, unit: null,
    query_identity: queryIdentity, observation_identity: observationIdentity };
  const subjects = selectableSubjects(full);
  if (subjects.size === 0) throw new TypeError("a retained code answer has no selectable collection");
  const counts = codeIndexCollectionCounts(full);

  const names = [...new Set([...collections.filter((name) => subjects.has(name)), ...subjects.keys()])];
  const populated = names.filter((name) => subjects.get(name).rows.length > 0);
  const preferred = populated[0] ?? names[0];
  const { source, snapshot_identity } = session.retain({ binding, carrier: full,
    selection: { collection: preferred } });
  const selectedDetail = { schema_version: CODE_INDEX_SELECTED_SUMMARY_SCHEMA_VERSION, source,
    collections: counts,
    ...(semanticChoices ? { snapshot_identity,
      selection_arguments: "Use detail:{source:selected_detail.source,snapshot_identity:selected_detail.snapshot_identity,...choice}." } : {}) };
  const callsFor = (offered) => offered.map((collection, index) =>
    session.detailCall(binding, { source, snapshot_identity, collection }, { recommended: index === 0 }));
  const frame = (summary, offered) => ({ workspaceRepo, ...summary, read_mode: readMode,
    ...answerSourceFacts(full), selected_detail: { ...selectedDetail,
      ...(semanticChoices ? { choices: offered.map((collection) => ({ collection })) } : {}) },
    next_calls: callsFor(semanticChoices ? [preferred] : offered) });

  const whole = (name) => (subjects.get(name).kind === "member" ? subjects.get(name).rows[0]
    : subjects.get(name).rows);
  const owed = (candidate) => populated.filter((name) => (semanticChoices && name === preferred) ||
    !isDeepStrictEqual(candidate[name], whole(name)));
  const fitted = (withCalls) => projectSummary(result, { fits: (candidate) =>
    measureMcpInlineResultBytes(frame(candidate, withCalls ? owed(candidate) : [])) <= session.maximumBytes });
  let summary;
  try {
    summary = fitted(true);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    summary = fitted(false);
  }
  return frame(summary, owed(summary));
}

function detailOnlyCorrection(session, { repository, queryArguments, detail }) {
  return selectedResponseCorrectableError(session.route, "detail_excludes_query_arguments",
    { arguments: queryArguments }, {
      arguments: session.detailCall({ repository }, detail).arguments,
      requestSchema: session.requestSchema,
      prerequisite: "a detail read selects a retained answer and carries no query argument",
      successCondition: "the same selection without query arguments returns the selected detail" });
}

async function readSelectedCodeIndexDetail({ args, session, workspace, preparation }) {
  const parsed = session.detailSchema.safeParse(args.detail);
  if (!parsed.success) {
    throw selectedResponseQueryInvalidError(session.route, "detail_invalid", {
      issues: parsed.error.issues.map(({ code, path }) => ({ code, path }))
    });
  }
  const detail = parsed.data;
  const queryArguments = QUERY_ARGUMENTS.filter((field) => args[field] !== undefined);
  if (queryArguments.length > 0) {

    await session.detail({ repository: workspace.repo, detail });
    throw detailOnlyCorrection(session, { repository: workspace.repo, queryArguments, detail });
  }
  return session.detail({ repository: workspace.repo, detail,
    extend: (response) => withStatusRecovery(response, preparation) });
}

export async function composeCodeIndexNavigationAnswer({ navigation, input, relationship, prepare = null }) {
  const requested = relationship === null ? NAVIGATION_RELATIONSHIPS : [relationship];
  let parts;
  for (let pass = 1; ; pass += 1) {
    const context = typeof prepare === "function"
      ? pinnedQueryContext(await prepare({ dir: input.dir, cacheDir: input.cacheDir })) : null;
    parts = {};
    try {
      for (const kind of requested) {
        parts[kind] = await navigation[kind](input, context);
      }
      break;
    } catch (error) {
      if (context === null || error?.code !== "repository_snapshot_changed" ||
          pass >= COMPOSITION_MAX_PASSES) throw error;
    }
  }
  return { schema_version: CODE_INDEX_NAVIGATION_ANSWER_SCHEMA_VERSION, query_kind: "code_question_navigation",
    relationship, requested_relationships: [...requested], target: { symbol: input.symbol ?? null,
      path: input.path ?? null, line: input.line ?? null, character: input.character ?? null }, parts };
}

function navigationCarrier(answer) {
  const parts = {};
  const rows = {};
  for (const [relationship, result] of Object.entries(answer.parts)) {
    const field = NAVIGATION_RESULT_FIELDS[result?.query_kind];
    const { [field]: population, ...envelope } = structuredClone(result ?? {});
    parts[relationship] = envelope;
    if (field !== undefined) rows[field] = Array.isArray(population) ? population : [];
  }
  return { schema_version: answer.schema_version, query_kind: answer.query_kind,
    relationship: answer.relationship, requested_relationships: [...answer.requested_relationships],
    target: { ...answer.target }, parts, ...rows };
}

function projectNavigationSummary(answer, { fits }) {
  const project = (limit) => {
    const parts = {};
    const counts = {};
    for (const [relationship, result] of Object.entries(answer.parts)) {
      parts[relationship] = projectSidecarSymbolQueryForMcp(result, { limit });
      counts[relationship] = parts[relationship].result_count
        ?? { total: null, returned: null, truncated: null };
    }

    const snapshots = Object.values(parts).map((part) => part.graph_snapshot);
    const shared = snapshots.length > 0 && snapshots.every((snapshot) => isDeepStrictEqual(snapshot, snapshots[0]));
    if (shared) for (const part of Object.values(parts)) delete part.graph_snapshot;
    const scipStates = Object.values(parts).map((part) => part.scip_state);
    const sharedScip = scipStates.length > 0 && scipStates.every((state) =>
      isDeepStrictEqual(state, scipStates[0]));
    if (sharedScip) for (const part of Object.values(parts)) delete part.scip_state;
    const freshness = Object.values(parts).map((part) => part.freshness);
    const sharedFreshness = freshness.length > 0 && freshness.every((state) =>
      isDeepStrictEqual(state, freshness[0]));
    if (sharedFreshness) for (const part of Object.values(parts)) delete part.freshness;
    const resolutions = Object.values(parts).map((part) => part.resolution);
    const sharedResolution = resolutions.length > 0 && resolutions.every((resolution) =>
      isDeepStrictEqual(resolution, resolutions[0]));
    if (sharedResolution) for (const part of Object.values(parts)) {
      part.resolution = { state: part.resolution.state,
        candidate_count: part.resolution.candidate_count };
    }

    let retainedAction = false;
    for (const part of Object.values(parts)) {
      if (typeof part.next_action !== "string" || !part.next_action.endsWith(RETAINED_ANSWER_NEXT_ACTION)) continue;
      retainedAction = true;
      const own = part.next_action.slice(0, -RETAINED_ANSWER_NEXT_ACTION.length).trimEnd();
      if (own === "") delete part.next_action;
      else part.next_action = own;
    }
    const actions = Object.values(parts).map((part) => part.next_action ?? null);
    const sharedAction = actions.length > 0 && actions[0] !== null &&
      actions.every((action) => action === actions[0]);
    if (sharedAction) for (const part of Object.values(parts)) delete part.next_action;
    const answerAction = [sharedAction ? actions[0] : null, retainedAction ? RETAINED_ANSWER_NEXT_ACTION : null]
      .filter(Boolean).join(" ");
    return { schema_version: answer.schema_version, query_kind: answer.query_kind,
      relationship: answer.relationship,
      requested_relationships: [...answer.requested_relationships], target: { ...answer.target },
      ...(sharedFreshness ? { freshness: freshness[0] } : {}),
      ...(shared ? { graph_snapshot: snapshots[0] } : {}),
      ...(sharedScip ? { scip_state: scipStates[0] } : {}),
      ...(sharedResolution ? { resolution: resolutions[0] } : {}),
      ...(answerAction === "" ? {} : { next_action: answerAction }), parts, counts };
  };
  return fitNavigationSummary(project, fits);
}

async function answerCodeQuestion({ selected, queries, workspace, args, projections, session }) {

  const selectedArguments = { ...selected.arguments, dir: workspace.dir };
  const common = { workspaceRepo: workspace.repo, session, queryIdentity: args };
  if (selected.query_kind === "impact") {
    const result = await queries.impact(selectedArguments);
    return createSelectedCodeIndexResponse({ ...common, result,
      projectSummary: projections.impactSummary, collections: ["affected_files"] });
  }
  if (selected.query_kind === "context") {
    const result = await queries.context(selectedArguments);
    return createSelectedCodeIndexResponse({ ...common, result,
      projectSummary: projections.contextSummary, collections: ["source"], semanticChoices: true });
  }
  const answer = await composeCodeIndexNavigationAnswer({ navigation: queries.navigation,
    input: selectedArguments, relationship: selected.relationship,
    prepare: queries.prepareNavigation ?? null });
  const carrier = navigationCarrier(answer);

  const heads = [...new Set(Object.values(answer.parts).map((part) =>
    part?.indexed_commit ?? part?.index_head ?? null))];
  return createSelectedCodeIndexResponse({ ...common, result: answer, carrier,
    observationIdentity: heads.length === 1 ? heads[0] : null,
    projectSummary: projectNavigationSummary,
    collections: [...answer.requested_relationships.map((relationship) =>
      NAVIGATION_RESULT_FIELDS[answer.parts[relationship]?.query_kind]).filter(Boolean), "candidates"] });
}

function codeQuestionInputError(error, route, alternatives) {
  const details = { tool: route, alternatives: error.alternatives ?? alternatives };
  for (const field of ["conflicting_selectors", "supported_relationships", "path_code"]) {
    if (error[field] !== undefined) details[field] = error[field];
  }
  error.envelope = {
    code: error.code, accepted: false, diagnostic: error.message,
    refusal: inputContractMechanicalRefusal(error.code, error.message, details),
    next_calls: [], recovery: { state: "choice_required", responsible_actor: "caller" }
  };
  return error;
}

export function createCodeIndexQuestionHandler({ selectQuestion, queries, argumentNames, invalidCode,
  alternatives = [], projections, session, workspaceRepos, jsonContent, errorContent,
  preparation = createCodeIndexPreparationGuidance() }) {
  const supported = alternatives.length === 0 ? "" : `. Supported code questions: ${alternatives
    .map((text, index) => `(${index + 1}) ${text}`).join(" ")}`;
  return async (args = {}) => {
    let workspace = null;
    try {
      const unknown = Object.keys(args ?? {}).filter((key) => !argumentNames.has(key));
      if (unknown.length > 0) {

        throw codeQuestionInputError(responseContractError(
          `code-index query does not accept: ${unknown.join(", ")}${supported}`, invalidCode),
        session.route, alternatives);
      }
      if (args.status !== undefined) {
        const others = Object.keys(args).filter((key) => key !== "status" && args[key] !== undefined);
        if (args.status !== true || others.length > 0) {
          throw codeQuestionInputError(responseContractError("status:true is an alternative of its own: it reports the " +
            `published index and accepts no question or detail${args.status !== true ? "" : `; received ${
              others.join(", ")}`}${supported}`, invalidCode), session.route, alternatives);
        }
        workspace = resolveWorkspaceRepo(workspaceRepos);
        const status = await queries.status({ dir: workspace.dir });
        const guidance = await preparation();
        const summary = projections.status(workspace.repo, status, guidance);

        const needsPreparation = summary.preparation?.state !== "not_needed";
        const prepare = summary.preparation?.state === "action_available" ? guidance.call : null;
        const diagnosisFirst = needsPreparation && (summary.available === true || prepare === null);
        const response = createSelectedCodeIndexResponse({ workspaceRepo: workspace.repo,
          result: { ...status, ...answerSourceFacts(summary), query_kind: STATUS_QUERY_KIND,
            ...(needsPreparation ? { [CODE_INDEX_STATUS_DIAGNOSIS]: statusDiagnosis(summary) } : {}) },
          projectSummary: () => summary, session, queryIdentity: args,
          collections: [...(diagnosisFirst ? [CODE_INDEX_STATUS_DIAGNOSIS] : []),
            "graph_snapshot", "derived_evidence", "scip_state"], semanticChoices: true, readMode: "status",
          observationIdentity: summary.indexed_commit });

        const prepareFirst = prepare !== null && !diagnosisFirst;
        const inspections = response.next_calls.map(({ recommended, ...call }) => ({ ...call,
          ...(recommended === true && diagnosisFirst ? { recommended } : {}),
          purpose: CODE_INDEX_INSPECTION_PURPOSE }));
        return jsonContent({ ...response,
          ...(needsPreparation || alternatives.length === 0 ? {} : { supported_questions: [...alternatives] }),
          next_calls: prepare === null ? inspections
            : prepareFirst ? [{ ...prepare, recommended: true }, ...inspections] : [...inspections, prepare] });
      }
      workspace = resolveWorkspaceRepo(workspaceRepos);
      if (args.detail !== undefined) {
        return await readSelectedCodeIndexDetail({ args, session, workspace, preparation });
      }
      let selected;
      try {
        selected = selectQuestion(args);
      } catch (error) {
        if (error?.code !== invalidCode && error?.code !== "sidecar_navigation_input_invalid") throw error;
        throw codeQuestionInputError(error, session.route, alternatives);
      }
      return jsonContent(await answerCodeQuestion({ selected, queries, workspace, args, projections,
        session }));
    } catch (error) {
      if (error?.code === SIDECAR_PUBLISHED_INDEX_UNAVAILABLE_CODE && workspace !== null) {
        return jsonContent(createCodeIndexUnavailableResponse({ workspaceRepo: workspace.repo,
          route: session.route, args, error, preparation: await preparation() }));
      }
      return errorContent(error);
    }
  };
}
