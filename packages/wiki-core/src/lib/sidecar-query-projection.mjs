export const CODE_INDEX_COMPACT_LIMIT = 20;
export const RETAINED_ANSWER_NEXT_ACTION =
  "The complete original answer is retained at full_result.content_reference; read it with its " +
  "read_tool. verbose:true runs a new evaluation and does not recover this answer.";

export const IMPACT_SELECTED_DETAIL_NEXT_ACTION =
  "Omitted impact rows and fields are retained; follow selected_detail.next_calls. " +
  "verbose:true runs a new evaluation and does not recover this answer.";

const list = (value) => (Array.isArray(value) ? value : []);

function shown(values, project = (value) => value) {
  const all = list(values);
  const returned = all.slice(0, CODE_INDEX_COMPACT_LIMIT).map((value) => structuredClone(project(value)));
  return { values: returned,
    count: { total: all.length, returned: returned.length, truncated: all.length > returned.length } };
}

function compactRef(ref) {
  return { id: ref?.id ?? null, title: ref?.title ?? null, path: ref?.path ?? null,
    source_kind: ref?.source_kind ?? null, status: ref?.status ?? null,
    match_types: list(ref?.match_types), score: ref?.score ?? null, rank: ref?.rank ?? null };
}

function compactImpact(impact) {
  return { kind: impact?.kind ?? null, input_path: impact?.input_path ?? null,
    severity: impact?.severity ?? null, reason: impact?.reason ?? null };
}

function summaryAffectedFile(file) {
  return { path: file?.path ?? null, relationship_count: list(file?.relationships).length };
}

function compactGraphState(graphState) {
  if (!graphState) return null;
  const { diff_path_states: states, ...rest } = graphState;
  return { ...structuredClone(rest), ...(states ? { diff_path_state_count: states.length } : {}) };
}

function committedFacts(result) {
  return {
    query_kind: result?.query_kind ?? null,
    index_head: result?.index_head ?? null,
    index_tree: result?.index_tree ?? null,
    dirty_state: result?.dirty_state ?? "unknown",
    staleness: result?.staleness ?? "unknown",
    graph_snapshot: structuredClone(result?.graph_snapshot ?? null),
    scip_state: structuredClone(result?.scip_state ?? null),
    graph_state: compactGraphState(result?.graph_state)
  };
}

function populations(result, specs) {
  const fields = {};
  const counts = {};
  for (const [field, project] of specs) {
    const { values, count } = shown(result?.[field], project);
    fields[field] = values;
    counts[field] = count;
  }
  return { fields, counts };
}

function unadmittedPopulations(result, specs) {
  return {
    fields: Object.fromEntries(specs.map(([field]) => [field, []])),
    counts: Object.fromEntries(specs.map(([field]) => {
      const total = list(result?.[field]).length;
      return [field, { total, returned: 0, truncated: total > 0 }];
    }))
  };
}

function createRowAdmission(result, specs, fits, initial) {
  let summary = initial;
  const admit = (candidate) => {
    if (!fits(candidate)) return false;
    summary = candidate;
    return true;
  };
  const open = new Set(specs.map(([field]) => field));
  const admitRound = () => {
    for (const [field, project = (value) => value] of specs) {
      if (!open.has(field)) continue;
      const rows = list(result?.[field]);
      const next = summary[field].length;
      if (next >= Math.min(rows.length, CODE_INDEX_COMPACT_LIMIT)) {
        open.delete(field);
        continue;
      }
      const values = [...summary[field], structuredClone(project(rows[next]))];
      const count = { total: rows.length, returned: values.length, truncated: rows.length > values.length };
      if (!admit({ ...summary, [field]: values, counts: { ...summary.counts, [field]: count } })) {
        open.delete(field);
      }
    }
  };
  return { admit, admitRound, open, current: () => summary };
}

function stateScalars(state) {
  if (state === null || typeof state !== "object") return state ?? null;
  const facts = {};
  for (const [key, value] of Object.entries(state)) {
    if (Array.isArray(value)) facts[`${key}_count`] = value.length;
    else if (value === null || typeof value !== "object") facts[key] = value;
  }
  return facts;
}

function contextSource(source) {
  if (!source) return null;
  const { source_text: text, ...rest } = source;
  return { ...structuredClone(rest), ...(text === undefined ? {} : { source_text_omitted: true }) };
}

const CONTEXT_GRAPH_PATH_POPULATIONS = Object.freeze([["graph_paths"]]);

const CONTEXT_EXCLUDED_GRAPH_KINDS = new Set(["docs_contract", "work_scope_owner"]);

function contextGraphPaths(affectedFiles) {
  return affectedFiles.flatMap((file) => {
    const eligible = list(file?.relationships).filter((relationship) =>
      relationship?.basis === "graph" && !CONTEXT_EXCLUDED_GRAPH_KINDS.has(relationship.kind));
    return eligible.length === 0 ? [] : [{ path: file.path,
      kinds: [...new Set(eligible.map((relationship) => relationship.kind))].sort(),
      path_relationship_count: eligible.length }];
  });
}

export function projectSidecarContextCompact(result, { fits }) {
  const evaluated = Array.isArray(result?.affected_files);
  const graphPaths = { graph_paths: contextGraphPaths(evaluated ? result.affected_files : []) };
  const { fields, counts } = unadmittedPopulations(graphPaths, CONTEXT_GRAPH_PATH_POPULATIONS);
  if (!evaluated) counts.graph_paths = { total: null, returned: 0, truncated: false };
  const summary = {
    query_kind: result?.query_kind ?? null,
    index_head: result?.index_head ?? null,
    index_tree: result?.index_tree ?? null,
    dirty_state: result?.dirty_state ?? "unknown",
    staleness: result?.staleness ?? "unknown",
    graph_state: stateScalars(result?.graph_state),
    scip_state: stateScalars(result?.scip_state),
    freshness_basis: result?.freshness_basis ?? null,
    graph_basis: result?.graph_basis ?? null,
    dirty_details: structuredClone(result?.dirty_details ?? null),
    dirty_details_counting: result?.dirty_details_counting ?? null,
    overlay_state: result?.overlay_state ?? "unknown",
    overlay_source_count: result?.overlay_source_count ?? null,
    overlay_coverage: structuredClone(result?.overlay_coverage ?? null),
    context_available: "compact",
    verbose: false,
    path: result?.path ?? null,
    loc: result?.loc ?? null,
    source: contextSource(result?.source),
    ...fields,
    counts,
    path_relationship_total: evaluated
      ? graphPaths.graph_paths.reduce((total, row) => total + row.path_relationship_count, 0) : null,
    next_action: RETAINED_ANSWER_NEXT_ACTION
  };
  if (!fits(summary)) throw new RangeError("context summary identity exceeds the complete-frame class");
  const rows = createRowAdmission(graphPaths, CONTEXT_GRAPH_PATH_POPULATIONS, fits, summary);
  while (rows.open.size > 0) rows.admitRound();
  return rows.current();
}

export function projectSidecarImpactCompact(result) {
  const diff = Array.isArray(result?.input_diff_sources);
  const { fields, counts } = populations(result, [["validated_paths"], ["invalid_paths"],
    ["affected_files"], ["canonical_refs", compactRef], ["likely_tests"], ["related_code_paths"],
    ["structural_impacts", compactImpact], ["missing_update_hints"],
    ...(diff ? [["invalid_diff_records"], ["affected_paths"]] : [])]);
  return {
    ...committedFacts(result),
    input: structuredClone(result?.input ?? null),
    impact_state: structuredClone(result?.impact_state ?? null),
    ...(diff ? { input_diff_sources: structuredClone(result.input_diff_sources) } : {}),
    ...fields,
    counts,
    summary_counts: structuredClone(result?.summary?.counts ?? null),
    warning_counts: structuredClone(result?.summary?.warning_counts ?? null),
    next_action: RETAINED_ANSWER_NEXT_ACTION
  };
}

const IMPACT_SUMMARY_SUBJECT_MEMBERS = Object.freeze(["impact_state", "input"]);
const IMPACT_SUMMARY_STATE_MEMBERS = Object.freeze(["graph_state", "scip_state", "summary_counts",
  "warning_counts"]);
const IMPACT_SUMMARY_TRAILING_MEMBERS = Object.freeze(["graph_snapshot", "input_diff_sources"]);

const IMPACT_SUMMARY_POPULATIONS = Object.freeze([["likely_tests"], ["affected_files", summaryAffectedFile],
  ["related_code_paths"], ["structural_impacts", compactImpact], ["missing_update_hints"],
  ["canonical_refs", compactRef], ["validated_paths"], ["invalid_paths"],
  ["invalid_diff_records"], ["affected_paths"]]);

export function projectSidecarImpactSelectedSummary(result, { fits }) {
  const compact = projectSidecarImpactCompact(result);
  const diff = Array.isArray(result?.input_diff_sources);
  const populations = IMPACT_SUMMARY_POPULATIONS.filter(([field]) =>
    diff || !["invalid_diff_records", "affected_paths"].includes(field));
  const members = [...IMPACT_SUMMARY_SUBJECT_MEMBERS, ...IMPACT_SUMMARY_STATE_MEMBERS,
    ...IMPACT_SUMMARY_TRAILING_MEMBERS].filter((member) => Object.hasOwn(compact, member));
  const { fields, counts } = unadmittedPopulations(result, populations);
  const initial = {
    query_kind: compact.query_kind,
    index_head: compact.index_head,
    index_tree: compact.index_tree,
    dirty_state: compact.dirty_state,
    staleness: compact.staleness,
    omitted_members: members,
    ...fields,
    counts,
    next_action: IMPACT_SELECTED_DETAIL_NEXT_ACTION
  };
  if (!fits(initial)) throw new RangeError("impact summary identity exceeds the complete-frame class");
  const rows = createRowAdmission(result, populations, fits, initial);
  const admitMember = (member) => {
    if (!members.includes(member)) return;
    const summary = rows.current();
    rows.admit({ ...summary, [member]: compact[member],
      omitted_members: summary.omitted_members.filter((candidate) => candidate !== member) });
  };
  IMPACT_SUMMARY_SUBJECT_MEMBERS.forEach(admitMember);
  rows.admitRound();
  IMPACT_SUMMARY_STATE_MEMBERS.forEach(admitMember);
  while (rows.open.size > 0) rows.admitRound();
  IMPACT_SUMMARY_TRAILING_MEMBERS.forEach(admitMember);
  return rows.current();
}
