import { isDeepStrictEqual } from "node:util";

import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { buildPublicMechanicalRefusal } from "@agent-chassis/wiki-core/src/lib/refusal-payload.mjs";
import { fitNavigationSummary } from "@agent-chassis/wiki-core/src/lib/sidecar-navigation-projection.mjs";
import { selectRetainedSourceLines } from
  "@agent-chassis/wiki-core/src/lib/sidecar-source-regions.mjs";
import { projectSidecarSymbolQueryForMcp } from
  "@agent-chassis/wiki-core/src/lib/sidecar-symbol-query.mjs";
import { measureMcpInlineResultBytes } from "./mcp-response.mjs";
import {
  SELECTED_RESPONSE_QUERY_INVALID_CODE,
  readSelectedResponseSource,
  retainSelectedResponseSource,
  selectedResponseDeliveryBound,
  selectedResponseQueryInvalidError
} from "./selected-response-snapshot.mjs";
import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";

export const CODE_INDEX_SELECTED_SUMMARY_SCHEMA_VERSION = "code-index-selected-summary.v2";
export const CODE_INDEX_SELECTED_DETAIL_SCHEMA_VERSION = "code-index-selected-detail.v1";
export const CODE_INDEX_NAVIGATION_ANSWER_SCHEMA_VERSION = "code-index-question-navigation.v1";

const QUERY_ARGUMENTS = Object.freeze(["cacheDir", "includeSuppressed", "paths",
  "patchText", "diffRecords", "liveGit", "path", "symbol", "line", "character", "relationship"]);

const NAVIGATION_RELATIONSHIPS = Object.freeze(["definition", "references", "callers", "callees"]);

const NAVIGATION_RESULT_FIELDS = Object.freeze({ definition: "definitions",
  find_references: "references", symbol_callers: "callers", symbol_callees: "callees" });

const RETAINED_QUERY_MATERIAL = new Set(["input_diff_sources"]);
const DETAIL_FRAME_MEMBERS = new Set(["schema_version", "workspaceRepo", "query_kind", "observation",
  "selected_detail", "next_calls"]);

const ROW_IDENTITY_FIELDS = Object.freeze(["hit_id", "region_id", "edge_id", "id"]);
const ROW_PATH_FIELDS = Object.freeze(["path", "document_path", "input_path", "newPath", "oldPath"]);
const ROW_SYMBOL_FIELDS = Object.freeze(["symbol", "symbol_key", "symbol_id", "caller_symbol",
  "callee_symbol"]);
const SELECTION_FIELDS = Object.freeze(["selector", "path", "symbol", "relationship", "input_path", "lines"]);

const COMPACT_MEMBER_MAX_UTF8_BYTES = 512;

const MAXIMUM_ROW_CALLS = 3;
const COLLECTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/u;

function responseContractError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const utf8Bytes = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");

export function codeIndexDetailSchema(z) {
  return z.object({
    source: z.object({
      ref_id: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/u),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u)
    }).strict(),
    collection: z.string().regex(COLLECTION_NAME_PATTERN),
    selector: z.object({ id: z.string().min(1).max(4096) }).strict().optional(),
    path: z.string().min(1).max(4096).optional(),
    symbol: z.string().min(1).max(4096).optional(),
    relationship: z.string().min(1).max(256).optional(),
    input_path: z.string().min(1).max(4096).optional(),
    lines: z.object({ start_line: z.number().int().positive(),
      end_line: z.number().int().positive() }).strict().optional()
  }).strict();
}

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
    const candidates = Object.entries(carrier.parts).flatMap(([relationship, part]) =>
      (Array.isArray(part?.symbol_resolution?.candidates) ? part.symbol_resolution.candidates : [])
        .map((candidate) => ({ ...candidate, relationship_kind: relationship })));
    if (candidates.length > 0) subjects.set("candidates", { kind: "rows", rows: candidates });
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
  for (const row of rows) {
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
    if (chosen !== null) selected.push(chosen);
  }
  return selected;
}

function kindCounts(values) {
  const counts = {};
  for (const value of values) {
    if (plainObject(value) && typeof value.kind === "string") counts[value.kind] = (counts[value.kind] ?? 0) + 1;
  }
  return Object.keys(counts).length > 0 ? counts : null;
}

function compactRowView(row) {
  if (!plainObject(row)) return row;
  const view = {};
  const omitted = {};
  for (const [field, value] of Object.entries(row)) {
    if (value === null || typeof value !== "object" && typeof value !== "string" ||
        utf8Bytes(value) <= COMPACT_MEMBER_MAX_UTF8_BYTES) {
      view[field] = value;
    } else if (Array.isArray(value)) {
      const kinds = kindCounts(value);
      omitted[field] = { count: value.length, ...(kinds === null ? {} : { kinds }) };
    } else {
      omitted[field] = { utf8_bytes: utf8Bytes(value) };
    }
  }
  return Object.keys(omitted).length === 0 ? view : { ...view, omitted };
}

function rowSubject(row) {
  const identity = rowIdentity(row);
  if (identity !== null && typeof row !== "string") return { selector: { id: identity } };
  const path = rowPath(row);
  return path === null ? null : { path };
}

function candidateSubject(row) {
  if (!plainObject(row)) return null;
  const symbol = row.symbol_key ?? row.symbol ?? null;
  const path = rowPath(row);
  if (typeof symbol !== "string" && path === null) return null;
  return { ...(typeof symbol === "string" ? { symbol } : {}),
    ...(path === null ? {} : { path }),
    ...(typeof row.relationship_kind === "string" ? { relationship: row.relationship_kind } : {}) };
}

function sourceLocation(row, carrier, collection) {
  const region = collection === "context_regions" ? row
    : (Array.isArray(carrier.context_regions) ? carrier.context_regions : [])
      .find((entry) => namesPath(entry, rowPath(row)) && Number.isSafeInteger(entry.start_line));
  if (!Number.isSafeInteger(region?.start_line) || region.start_line < 1) return null;
  return { start_line: region.start_line, end_line: region.start_line };
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

export function createCodeIndexAnswerSelection({ route, requestSchema, detailSchema, buildDetailArguments,
  resolveCurrentObservationIdentity = null, env = process.env }) {
  if (typeof route !== "string" || typeof buildDetailArguments !== "function" ||
      requestSchema === null || typeof requestSchema !== "object" ||
      typeof detailSchema?.safeParse !== "function") {
    throw new TypeError("a code answer selection requires route, requestSchema, detailSchema and buildDetailArguments");
  }
  const maximumBytes = selectedResponseDeliveryBound(env);
  const fits = (frame) => measureMcpInlineResultBytes(frame) <= maximumBytes;
  const detailCall = (repository, selection, extra = {}) => buildNextCall({ tool: route,
    arguments: buildDetailArguments(Object.freeze({ repository, unit: null }), selection), recommended: true,
    ...extra });

  const observationOf = (binding) => describeRetainedObservation(binding, resolveCurrentObservationIdentity);

  function selectFromRetained(repository, detail) {
    const envelope = readSelectedResponseSource(detail.source, { env,
      expected: { route, repository } });
    const subjects = selectableSubjects(envelope.carrier);
    const subject = subjects.get(detail.collection);
    if (subject === undefined) {
      throw selectedResponseQueryInvalidError(route, "collection_unknown", {
        collection: detail.collection,
        collections: [...subjects.keys()],
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
    let matched = filtered ? selectRows(subject.rows, selection) : subject.rows;
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
    return { envelope, subject, selection, matched, relationshipCounts };
  }

  function present({ repository, detail, selected, observation }) {
    const { envelope, subject, selection, matched, relationshipCounts } = selected;
    const carrier = envelope.carrier;
    const base = { source: { ref_id: detail.source.ref_id, sha256: detail.source.sha256 },
      collection: detail.collection };
    const frame = (rows, presentation, calls) => ({
      schema_version: CODE_INDEX_SELECTED_DETAIL_SCHEMA_VERSION,
      workspaceRepo: carrier.workspaceRepo ?? repository,
      query_kind: carrier.query_kind ?? null,
      observation,
      selected_detail: { source: base.source, collection: detail.collection, selection, presentation,
        counts: relationshipCounts === null ? { total: subject.rows.length, matched: matched.length,
          returned: rows.length, truncated: rows.length < matched.length }
          : { total: relationshipCounts.total, matched: relationshipCounts.matched,
            returned: Array.isArray(rows[0]?.relationships) ? rows[0].relationships.length : 0,
            truncated: !Array.isArray(rows[0]?.relationships) ||
              rows[0].relationships.length < relationshipCounts.matched } },
      [detail.collection]: subject.kind === "member" ? rows[0] : rows,
      next_calls: calls
    });
    const complete = frame(matched, "complete", []);
    if (fits(complete)) {
      if (detail.collection !== "candidates" || matched.length <= 1) return complete;
      const calls = [];
      for (const row of matched.slice(0, MAXIMUM_ROW_CALLS)) {
        const subject = candidateSubject(row);
        if (subject === null) continue;
        const call = detailCall(repository, { ...base, ...selection, ...subject });
        if (!fits(frame(matched, "complete", [...calls, call]))) break;
        calls.push(call);
      }
      return frame(matched, "complete", calls);
    }
    if (selection.lines !== undefined) {
      throw selectedResponseQueryInvalidError(route,
        selection.lines.start_line === selection.lines.end_line
          ? "selected_line_exceeds_delivery_bound" : "selected_lines_exceed_delivery_bound",
        { collection: detail.collection, selection,
          source_text_utf8_bytes: utf8Bytes(matched[0].source_text) });
    }

    const admitCalls = (rows, presentation, selections) => {
      const calls = [];
      for (const candidate of selections) {
        const next = [...calls, detailCall(repository, candidate)];
        if (!fits(frame(rows, presentation, next))) break;
        calls.push(next.at(-1));
      }
      return frame(rows, presentation, calls);
    };

    if (matched.length === 1) {
      const [row] = matched;
      const view = compactRowView(row);
      if (!fits(frame([view], "compact", []))) {
        throw selectedResponseQueryInvalidError(route, "selected_row_identity_exceeds_delivery_bound",
          { collection: detail.collection, selection });
      }
      const subjectSelection = subject.kind === "rows"
        ? ((detail.collection === "candidates" ? candidateSubject(row) : rowSubject(row)) ?? {}) : {};
      const narrower = [];
      for (const [field, facts] of Object.entries(view.omitted ?? {})) {
        for (const kind of Object.keys(facts.kinds ?? {})) {
          if (kind !== selection.relationship) {
            narrower.push({ ...base, ...selection, ...subjectSelection, relationship: kind });
          }
        }
        if (field === "relationships" && detail.collection === "affected_files" &&
            selection.relationship !== undefined) {
          const paths = [...new Set(row.relationships.map((entry) => entry?.input_path)
            .filter((path) => typeof path === "string"))];
          for (const input_path of paths.slice(0, MAXIMUM_ROW_CALLS)) narrower.push({ ...base, ...selection,
            ...subjectSelection, input_path });
        }
        if (field === "source_text") {
          const lines = sourceLocation(row, carrier, detail.collection);
          if (lines !== null) narrower.push({ ...base, ...selection,
            ...subjectSelection, lines });
        }

        const path = rowPath(row);
        if (field.endsWith("source_text") && path !== null && detail.collection !== "context_regions" &&
            Array.isArray(carrier.context_regions) && carrier.context_regions.some((region) =>
              namesPath(region, path))) {
          narrower.push({ ...base, collection: "context_regions", path });
        }
      }
      return admitCalls([view], "compact", narrower);
    }

    const drillDown = (count) => matched.slice(0, Math.min(count, MAXIMUM_ROW_CALLS))
      .map((row) => detail.collection === "candidates" ? candidateSubject(row) : rowSubject(row))
      .filter((candidate) => candidate !== null)
      .map((candidate) => detailCall(repository, { ...base, ...selection, ...candidate }));
    const views = [];
    for (const row of matched) {
      const next = [...views, compactRowView(row)];
      if (!fits(frame(next, "compact", drillDown(next.length)))) break;
      views.push(next.at(-1));
    }
    if (views.length === 0) {
      throw selectedResponseQueryInvalidError(route, "selected_row_identity_exceeds_delivery_bound",
        { collection: detail.collection, selection });
    }
    return frame(views, "compact", drillDown(views.length));
  }

  return Object.freeze({
    route,
    maximumBytes,
    requestSchema,
    detailSchema,

    retain({ binding, carrier, selection }) {
      const source = retainSelectedResponseSource({ binding, carrier,
        ownerCall: (locator) => ({ tool: route, arguments: buildDetailArguments(Object.freeze({
          repository: binding.repository, unit: null }), {
          source: { ref_id: locator.ref_id, sha256: locator.sha256 }, ...selection }) }),
        ownerRequestSchema: requestSchema }, { env });
      return source;
    },

    detailCall(binding, selection, extra = {}) {
      return detailCall(binding.repository, selection, extra);
    },

    async detail({ repository, detail }) {
      const selected = selectFromRetained(repository, detail);
      return present({ repository, detail, selected,
        observation: await observationOf(selected.envelope.binding) });
    },

    validate({ repository, detail }) {
      selectFromRetained(repository, detail);
    },

    observation: observationOf
  });
}

function initialSelection(counts, carrier, candidates) {
  const name = candidates.find((candidate) => counts[candidate] > 0) ??
    Object.keys(counts).find((candidate) => counts[candidate] > 0) ??
    candidates.find((candidate) => Object.hasOwn(counts, candidate)) ?? Object.keys(counts)[0];
  if (name === undefined) return null;
  const first = selectableSubjects(carrier).get(name)?.rows[0];
  const subject = first === undefined ? null : name === "candidates"
    ? candidateSubject(first) : rowSubject(first);
  return { collection: name, ...(subject ?? {}) };
}

export function createSelectedCodeIndexResponse({ workspaceRepo, result, carrier = result,
  projectSummary, session, queryIdentity, collections = [], offerEach = false,
  observationIdentity = result?.index_head ?? null }) {
  const full = { workspaceRepo, ...structuredClone(carrier) };
  const binding = { route: session.route, repository: workspaceRepo, unit: null,
    query_identity: queryIdentity, observation_identity: observationIdentity };
  const counts = codeIndexCollectionCounts(full);
  const selection = initialSelection(counts, full, collections);
  if (selection === null) throw new TypeError("a retained code answer has no selectable collection");
  const source = session.retain({ binding, carrier: full, selection });
  const selectedDetail = { schema_version: CODE_INDEX_SELECTED_SUMMARY_SCHEMA_VERSION, source,
    collections: counts };

  const offered = offerEach ? collections : ["candidates"];
  const nextCalls = [session.detailCall(binding, { source, ...selection }),
    ...(offered.filter((name) => name !== selection.collection && counts[name] > 0)
      .map((collection) => session.detailCall(binding, { source, collection }, { recommended: false })))];
  const frame = (summary) => ({ workspaceRepo, ...summary, selected_detail: selectedDetail,
    next_calls: nextCalls });
  return frame(projectSummary(result, {
    fits: (candidate) => measureMcpInlineResultBytes(frame(candidate)) <= session.maximumBytes
  }));
}

function detailOnlyCorrection(session, { repository, queryArguments, detail }) {
  const facts = [
    { field: "selected_response.query_valid", value: false },
    { field: "selected_response.invalid_reason", value: "detail_excludes_query_arguments" },
    { field: "selected_response.invalid_details", value: { arguments: queryArguments } }
  ];
  const predicate = { fact: "selected_response.query_valid", operator: "is_true" };
  const call = session.detailCall({ repository }, detail, { success_predicate: predicate,
    prerequisite_predicate: predicate });
  const error = new Error(`selected-response query is invalid: detail_excludes_query_arguments`);
  error.code = SELECTED_RESPONSE_QUERY_INVALID_CODE;
  error.envelope = buildPublicMechanicalRefusal({
    code: SELECTED_RESPONSE_QUERY_INVALID_CODE,
    deciding_facts: facts,
    next_calls: [call],
    recovery: {
      state: "callable",
      prerequisite: "a detail read selects a retained answer and carries no query argument",
      operation: session.route,
      success_condition: "the same selection without query arguments returns the selected detail",
      success_predicate: predicate,
      selected_from: ["selected_response.query_valid"]
    },
    route: session.route,
    observed_facts: Object.fromEntries(facts.map(({ field, value }) => [field, value])),
    request_schemas: { [session.route]: session.requestSchema }
  });
  return error;
}

async function readSelectedCodeIndexDetail({ args, session, workspace }) {
  const parsed = session.detailSchema.safeParse(args.detail);
  if (!parsed.success) {
    throw selectedResponseQueryInvalidError(session.route, "detail_invalid", {
      issues: parsed.error.issues.map(({ code, path }) => ({ code, path }))
    });
  }
  const detail = parsed.data;
  const queryArguments = QUERY_ARGUMENTS.filter((field) => args[field] !== undefined);
  if (queryArguments.length > 0) {
    session.validate({ repository: workspace.repo, detail });
    throw detailOnlyCorrection(session, { repository: workspace.repo, queryArguments, detail });
  }
  return session.detail({ repository: workspace.repo, detail });
}

export function createCodeIndexQueryHandler({ query, argumentNames, invalidCode, projectSummary,
  collections, session, requiredArguments = [], workspaceRepos, jsonContent, errorContent }) {
  return async (args = {}) => {
    try {
      const unknown = Object.keys(args ?? {}).filter((key) => !argumentNames.has(key));
      if (unknown.length > 0) {
        throw responseContractError(`code-index query does not accept: ${unknown.join(", ")}`, invalidCode);
      }
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      if (args.detail !== undefined) {
        return jsonContent(await readSelectedCodeIndexDetail({ args, session, workspace }));
      }
      const missing = requiredArguments.filter((field) => args[field] === undefined);
      if (missing.length > 0) {
        throw responseContractError(`code-index query requires: ${missing.join(", ")}`, invalidCode);
      }
      const { repo: _repo, ...queryIdentity } = args;
      const result = await query({ ...args, dir: workspace.dir });
      return jsonContent(createSelectedCodeIndexResponse({ workspaceRepo: workspace.repo, result,
        projectSummary, session, queryIdentity,
        collections: typeof collections === "function" ? collections(result) : collections }));
    } catch (error) {
      return errorContent(error);
    }
  };
}

export async function composeCodeIndexNavigationAnswer({ navigation, input, relationship }) {
  const requested = relationship === null ? NAVIGATION_RELATIONSHIPS : [relationship];
  const parts = {};
  for (const kind of requested) {
    parts[kind] = await navigation[kind](input);
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
    const resolutions = Object.values(parts).map((part) => part.resolution);
    const sharedResolution = resolutions.length > 0 && resolutions.every((resolution) =>
      isDeepStrictEqual(resolution, resolutions[0]));
    if (sharedResolution) for (const part of Object.values(parts)) {
      part.resolution = { state: part.resolution.state,
        candidate_count: part.resolution.candidate_count };
    }
    const actions = Object.values(parts).map((part) => part.next_action);
    const sharedAction = actions.length > 0 && actions.every((action) => action === actions[0]);
    if (sharedAction) for (const part of Object.values(parts)) delete part.next_action;
    return { schema_version: answer.schema_version, query_kind: answer.query_kind,
      relationship: answer.relationship,
      requested_relationships: [...answer.requested_relationships], target: { ...answer.target },
      ...(shared ? { graph_snapshot: snapshots[0] } : {}),
      ...(sharedScip ? { scip_state: scipStates[0] } : {}),
      ...(sharedResolution ? { resolution: resolutions[0] } : {}),
      ...(sharedAction ? { next_action: actions[0] } : {}), parts, counts };
  };
  return fitNavigationSummary(project, fits);
}

export function navigationCollections(result) {
  const field = NAVIGATION_RESULT_FIELDS[result?.query_kind];
  return field === undefined ? [] : [field, "candidates"];
}

async function answerCodeQuestion({ selected, queries, workspace, args, projections, session }) {

  const selectedArguments = { ...selected.arguments, dir: workspace.dir };
  const { repo: _repo, ...queryIdentity } = args;
  const common = { workspaceRepo: workspace.repo, session, queryIdentity };
  if (selected.query_kind === "impact") {
    const result = await queries.impact(selectedArguments);
    return createSelectedCodeIndexResponse({ ...common, result,
      projectSummary: projections.impactSummary, collections: ["affected_files"] });
  }
  if (selected.query_kind === "context") {
    const result = await queries.context(selectedArguments);
    return createSelectedCodeIndexResponse({ ...common, result,
      projectSummary: projections.contextSummary, collections: ["affected_files"] });
  }
  const answer = await composeCodeIndexNavigationAnswer({ navigation: queries.navigation,
    input: selectedArguments, relationship: selected.relationship });
  const carrier = navigationCarrier(answer);

  const heads = [...new Set(Object.values(answer.parts).map((part) => part?.index_head ?? null))];
  return createSelectedCodeIndexResponse({ ...common, result: answer, carrier, offerEach: true,
    observationIdentity: heads.length === 1 ? heads[0] : null,
    projectSummary: projectNavigationSummary,
    collections: [...answer.requested_relationships.map((relationship) =>
      NAVIGATION_RESULT_FIELDS[answer.parts[relationship]?.query_kind]).filter(Boolean), "candidates"] });
}

export function createCodeIndexImpactHandler({ selectQuestion, queries, argumentNames, invalidCode,
  alternatives = [], projections, session, workspaceRepos, jsonContent, errorContent }) {
  return async (args = {}) => {
    try {
      const unknown = Object.keys(args ?? {}).filter((key) => !argumentNames.has(key));
      if (unknown.length > 0) {

        throw responseContractError(`code-index query does not accept: ${unknown.join(", ")}` +
          (alternatives.length > 0 ? `. Supported code questions: ${alternatives
            .map((text, index) => `(${index + 1}) ${text}`).join(" ")}` : ""), invalidCode);
      }
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      if (args.detail !== undefined) {
        return jsonContent(await readSelectedCodeIndexDetail({ args, session, workspace }));
      }
      const { repo: _repo, ...question } = args;
      const selected = selectQuestion(question);
      return jsonContent(await answerCodeQuestion({ selected, queries, workspace, args, projections,
        session }));
    } catch (error) {
      return errorContent(error);
    }
  };
}

const NAVIGATION_TOOL_ARGUMENTS = new Set([
  "repo", "symbol", "path", "line", "character", "cacheDir", "detail"
]);

export function createCodeIndexNavigationHandler({ query, session, workspaceRepos, jsonContent,
  errorContent }) {
  return createCodeIndexQueryHandler({ query, argumentNames: NAVIGATION_TOOL_ARGUMENTS,
    invalidCode: "sidecar_navigation_input_invalid", workspaceRepos, jsonContent, errorContent,
    session, projectSummary: (result, { fits }) => projectSidecarSymbolQueryForMcp(result, { fits }),
    collections: navigationCollections });
}
