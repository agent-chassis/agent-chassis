

const list = value => Array.isArray(value) ? value : [];
const pick = (value, fields) => Object.fromEntries(fields.filter(field => value?.[field] !== undefined)
  .map(field => [field, structuredClone(value[field])]));
const SOURCE_FIELDS = ['path', 'state', 'reason', 'start_line', 'end_line', 'line_count', 'source_text', 'selected_lines', 'relationship_kind'];
const ROW_FIELDS = ['hit_id', 'symbol', 'path', 'line', 'caller_symbol', 'callee_symbol',
  'document_path', 'lines', 'occurrence_count', 'kind', 'relationship_kind'];
const RELATION_FIELDS = ['id', 'kind', 'basis', 'input_path', 'path', 'symbol', 'direction',
  'reason', 'severity', 'state', 'status_reason', 'direct', 'from_path', 'to_path', 'qualification', 'match_types'];
const PREVIEW_ROWS = 3;
const INLINE_SOURCE_BYTES = 1024;

export function codeSource(value) {
  return pick(value, SOURCE_FIELDS);
}

function location(value) {
  const row = pick(value, ROW_FIELDS);
  if (!row.path && !row.document_path && (value.newPath || value.oldPath)) row.path = value.newPath ?? value.oldPath;
  if (!row.symbol && value.symbol_key) row.symbol_key = value.symbol_key;
  if (value?.source) row.source = pick(value.source, ['state', 'reason', 'region_id']);
  return row;
}

function candidate(value) {
  return { id: value.symbol_key, ...pick(value, ['symbol', 'path', 'indexer']),
    ...pick(value, ['relationship_kind']),
    ...(value.source ? { source: pick(value.source, ['state', 'reason']) }
      : value.region_ids?.length ? { source: { state: 'available', region_id: value.region_ids[0] } } : {}) };
}

function affected(value) {
  return { path: value.path, relationships: list(value.relationships).map(row => pick(row, RELATION_FIELDS)) };
}

const SUBJECT_PROJECTIONS = Object.freeze({
  source: codeSource,
  definitions: location, references: location, callers: location, callees: location,
  candidates: candidate,
  source_hits: value => ({ ...location(value),
    ...pick(value.occurrence?.payload, ['symbol', 'range']),
    ...(value.occurrence ? { path: value.occurrence.document_path,
      kind: (value.occurrence.payload?.symbol_roles & 1) === 1 ? 'definition' : 'reference' } : {}),
    ...(value.call_edge ? { path: value.call_edge.document_path, lines: value.call_edge.lines } : {}) }),
  context_regions: value => pick(value, ['region_id', 'path', 'kind', 'start_line', 'end_line', 'source_text', 'selected_lines', 'relationship_kind']),
  complete_files: codeSource,
  affected_files: affected,
  semantic_relationships: value => pick(value, RELATION_FIELDS),
  semantic_resolution: value => ({ ...pick(value, RELATION_FIELDS),
    candidates: list(value.candidates).map(row => pick(row, ['path', 'symbol'])) }),
  related_code_paths: value => value,
  canonical_refs: value => pick(value, ['id', 'title', 'path', 'match_types']),
  structural_impacts: value => pick(value, RELATION_FIELDS),
  invalid_diff_records: value => ({ ...pick(value, ['record_index', 'code', 'reason']),
    ...pick(value.input_record, ['changeKind', 'oldPath', 'newPath']) }),
  unsupported_changes: value => pick(value, ['record_index', 'code', 'changeKind', 'oldPath', 'newPath']),
  validation_hints: value => pick(value, ['input_path', 'relative_path', 'valid', 'reason', 'code', 'record_index']),
  invalid_paths: value => value,
  affected_paths: value => value,
  path_limits: value => value,
  narrowing_sources: value => pick(value, ['kind', 'selector', 'paths', 'resolution_state'])
});

export function codePathLimits(answer) {
  return list(answer.graph_state?.unavailable_paths).map(path => ({ path,
    reason: list(answer.derived_evidence).find(entry => entry.kind === 'sidecar_graph_path_state' && entry.input_path === path)?.reason
      ?? 'graph_unavailable_for_path' }));
}

export function codeUnsupportedChanges(answer) {
  return list(answer.validated_diff_records).filter(record => record.supported === false)
    .map(record => ({ ...pick(record, ['record_index', 'changeKind', 'oldPath', 'newPath']),
      code: 'unsupported_change_kind' }));
}

export function codeMeaningSubjects(subjects, { project = true } = {}) {
  const publicSubjects = new Map();
  for (const [name, projection] of Object.entries(SUBJECT_PROJECTIONS)) {
    const subject = subjects.get(name);
    if (subject) {
      const rows = name === 'validation_hints' ? subject.rows.filter(row => row.valid === false) : subject.rows;
      publicSubjects.set(name, { ...subject, rows: project ? rows.map(projection) : rows });
    }
  }
  return publicSubjects;
}

export function codeCoverage(answer) {
  const coverage = answer.semantic_coverage ?? answer.scip_state;
  const limits = [];
  const freshness = answer.staleness ?? answer.freshness?.state;
  if (freshness === 'stale') limits.push({ code: 'stale_index',
    meaning: 'Results describe earlier indexed checkout content; absence does not establish absence in current code.' });
  if (coverage?.scip_available === false || coverage?.graph_available === false) {
    limits.push({ code: coverage.status_reason ?? 'symbol_index_unavailable',
      meaning: 'Symbol coverage is unavailable; absent results do not establish no matches.' });
  }
  const dependencies = coverage?.dependency_limitations ?? answer.dependency_limitations;
  if (list(dependencies).length > 0 || answer.graph_snapshot?.provider_coverage?.state === 'dependency_limited') {
    limits.push({ code: 'dependency_limited',
      ...(list(dependencies).length ? { causes: dependencies.map(dependency => pick(dependency, ['project', 'code', 'message'])) } : {}),
      meaning: 'Some project dependencies were unavailable; absent or unresolved results are incomplete.' });
  }
  const refresh = answer.preparation?.refresh ?? answer.refresh;
  if (refresh?.state === 'failed' && (freshness === 'stale' || coverage?.scip_available === false)) {
    limits.push({ code: refresh.failure.code, cause: refresh.failure.message,
      ...(refresh.failure.details?.publication_outcome ? { effects: refresh.failure.details.publication_outcome } : {}),
      meaning: 'Newer evidence requires correction of this cause.',
      ...(refresh.retry?.not_before ? { not_before: refresh.retry.not_before } : {}) });
  }
  const provider = answer.graph_snapshot?.provider_coverage ?? coverage?.coverage;
  if (list(provider?.inactive_projects).length ||
      list(provider?.projects).some(project => list(project.uncovered_documents).length)) {
    limits.push({ code: 'partial_symbol_coverage',
      meaning: 'Some project source is not indexed; absent results do not establish no matches.' });
  }
  if (coverage?.call_graph_available === false &&
      ['symbol_callers', 'symbol_callees'].includes(answer.query_kind)) {
    limits.push({ code: coverage.call_graph_unavailable_reason ?? coverage.call_graph_status_reason ?? 'call_attribution_unavailable',
      meaning: 'Call attribution is unavailable; definitions or references cannot establish calls.' });
  }
  return limits;
}

function inlineSource(source) {
  const result = codeSource(source);
  if (typeof result.source_text === 'string' && Buffer.byteLength(result.source_text) > INLINE_SOURCE_BYTES) {
    delete result.source_text;
  }
  return result;
}

function sourceAlreadyDelivered(summary, region) {
  return typeof summary.source?.source_text === 'string' && summary.source.path === region.path &&
    summary.source.start_line <= region.start_line && summary.source.end_line >= region.end_line;
}

export function projectCodeContext(answer, { limit = PREVIEW_ROWS } = {}) {
  const codeFiles = list(answer.affected_files).flatMap(file => {
    const relationships = list(file.relationships).filter(row => ['scip', 'graph'].includes(row.basis) &&
      !['docs_contract', 'work_scope_owner'].includes(row.kind));
    return relationships.length ? [{ path: file.path, relationships }] : [];
  });
  return { query_kind: answer.query_kind, path: answer.path, source: inlineSource(answer.source),
    ...(list(answer.definitions).length ? { definitions: answer.definitions.slice(0, limit).map(location) } : {}),
    ...(codeFiles.length ? { affected_files: codeFiles.slice(0, limit).map(affected) } : {}),
    ...(codeCoverage(answer).length ? { limitations: codeCoverage(answer) } : {}) };
}

export function projectCodeImpact(answer, { limit = PREVIEW_ROWS } = {}) {
  const noChange = answer.impact_state?.state === 'no_change';
  const limits = noChange && !list(answer.narrowing_sources).length ? [] : codeCoverage(answer);
  if (list(answer.narrowing_sources).some(source => source.kind === 'symbol' && source.resolution_state !== 'resolved')) {
    limits.push({ code: 'narrowing_symbol_unresolved', meaning: 'The symbol narrower is unresolved or ambiguous; an empty narrowed scope does not establish no impact.' });
  }
  const impactState = noChange && !list(answer.narrowing_sources).length
    ? { state: 'no_change' } : structuredClone(answer.impact_state);
  return { query_kind: answer.query_kind, impact_state: impactState,
    ...(codePathLimits(answer).length ? { path_limits: codePathLimits(answer).slice(0, limit) } : {}),
    ...(noChange ? {} : { affected_files: list(answer.affected_files).slice(0, limit).map(affected) }),
    ...(list(answer.invalid_paths).length ? { invalid_paths: answer.invalid_paths.slice(0, limit) } : {}),
    ...(list(answer.validation_hints).some(hint => hint.valid === false)
      ? { validation_hints: answer.validation_hints.filter(hint => hint.valid === false).slice(0, limit)
        .map(SUBJECT_PROJECTIONS.validation_hints) } : {}),
    ...(list(answer.invalid_diff_records).length
      ? { invalid_diff_records: answer.invalid_diff_records.slice(0, limit).map(SUBJECT_PROJECTIONS.invalid_diff_records) } : {}),
    ...(codeUnsupportedChanges(answer).length ? { unsupported_changes: codeUnsupportedChanges(answer).slice(0, limit) } : {}),
    ...(list(answer.narrowing_sources).length
      ? { narrowing_sources: answer.narrowing_sources.map(SUBJECT_PROJECTIONS.narrowing_sources) } : {}),
    ...(limits.length ? { limitations: limits } : {}) };
}

export function projectCodeNavigation(answer, { limit = PREVIEW_ROWS } = {}) {
  const result = { query_kind: answer.query_kind, target: Object.fromEntries(
    Object.entries(answer.target).filter(([, value]) => value !== null)), relationships: {} };
  if (new Set(Object.values(answer.parts).map(part => part.indexed_commit ?? null)).size > 1) {
    result.limitations = [{ code: 'mixed_source', meaning: 'Relationships describe different indexed sources; they cannot establish a conclusion about one source version.' }];
  }
  for (const [relationship, part] of Object.entries(answer.parts)) {
    const field = ({ definition: 'definitions', references: 'references', callers: 'callers', callees: 'callees' })[relationship];
    const resolution = part.symbol_resolution;
    const candidates = list(resolution?.candidates);
    result.relationships[relationship] = { resolution: pick(resolution, ['state', 'status_reason', 'position_granularity']),
      [field]: list(part[field]).slice(0, limit).map(location),
      ...(candidates.length > 1 ? { candidates: candidates.slice(0, limit).map(row => ({ ...candidate(row), relationship_kind: relationship })) } : {}),
      ...(codeCoverage(part).length ? { limitations: codeCoverage(part) } : {}) };
  }
  return result;
}

export function selectedCodeCandidateMeaning(carrier, candidates, relationship) {
  if (candidates.length !== 1 || !relationship) return null;
  const part = carrier.parts?.[relationship];
  if (!part) return null;
  const field = ({ definition: 'definitions', references: 'references', callers: 'callers', callees: 'callees' })[relationship];
  const rows = list(carrier[field]).filter(row => row.symbol_key === candidates[0].symbol_key);
  const limits = codeCoverage(part);
  return { result_state: rows.length ? 'matched' : limits.length ? 'unknown' : 'no_matches',
    [field]: rows.map(location), ...(limits.length ? { limitations: limits } : {}) };
}

export function inlineCodeRegions(summary, subjects) {
  const ids = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.source?.region_id) ids.add(value.source.region_id);
    Object.values(value).forEach(member => {
      if (Array.isArray(member)) member.forEach(visit);
      else if (member && typeof member === 'object') visit(member);
    });
  };
  visit(summary);
  const unique = new Map();
  for (const region of subjects.get('context_regions')?.rows ?? []) {
    if (!ids.has(region.region_id) || Buffer.byteLength(region.source_text ?? '') > INLINE_SOURCE_BYTES) continue;
    if (sourceAlreadyDelivered(summary, region)) continue;
    const identity = JSON.stringify([region.region_id, region.path, region.start_line, region.end_line, region.source_text]);
    if (!unique.has(identity)) unique.set(identity, SUBJECT_PROJECTIONS.context_regions(region));
  }
  return [...unique.values()].slice(0, PREVIEW_ROWS);
}

export function qualifyCodeSourceLimits(summary, subjects) {
  const hits = subjects.get('source_hits')?.rows ?? [];
  for (const file of list(summary.affected_files)) {
    const symbols = new Set(list(file.relationships).map(row => row.symbol).filter(Boolean));
    const failures = hits.filter(hit => (hit.path ?? hit.occurrence?.document_path) === file.path &&
      symbols.has(hit.symbol ?? hit.occurrence?.payload?.symbol) && hit.source?.state === 'unavailable');
    const limits = new Map(failures.map(hit => [hit.source.reason, pick(hit.source, ['state', 'reason'])]));
    if (limits.size) file.source_limits = [...limits.values()];
  }
}

export function codeSourceCalls({ subjects, source, summary, detailCall, binding, collection = null }) {
  const shown = collection ? summary[collection] : summary;
  const regions = subjects.get('context_regions')?.rows ?? [];
  const files = subjects.get('complete_files')?.rows ?? [];
  const hits = subjects.get('source_hits')?.rows ?? [];
  const calls = new Map();
  const inline = list(summary.context_regions);
  const add = (selection, information) => {
    const key = JSON.stringify(selection);
    calls.set(key, { ...detailCall(binding, { source, ...selection }), information });
  };
  const visit = (value, relationship = null) => {
    if (!value || typeof value !== 'object') return;
    if (value.source?.region_id) {
      const region = regions.find(row => row.region_id === value.source.region_id &&
        (!(value.relationship_kind ?? relationship) || row.relationship_kind === (value.relationship_kind ?? relationship)));
      if (region && !sourceAlreadyDelivered(summary, region) &&
          !inline.some(shown => shown.region_id === region.region_id && shown.source_text === region.source_text)) add({ collection: 'context_regions',
        selector: { id: region.region_id }, ...(region.relationship_kind ? { relationship: region.relationship_kind } : {}) },
        `Read source at ${region.path}:${region.start_line}-${region.end_line}.`);
    } else if (typeof value.path === 'string' && value.relationships) {
      const symbols = new Set(value.relationships.filter(row => row.kind === 'reference').map(row => row.symbol));
      const extents = new Set(hits.filter(hit => (hit.path ?? hit.occurrence?.document_path) === value.path &&
        symbols.has(hit.symbol ?? hit.occurrence?.payload?.symbol)).map(hit => hit.source?.region_id).filter(Boolean));
      if (extents.size) {
        for (const id of extents) {
          const region = regions.find(row => row.region_id === id);
          if (region && !sourceAlreadyDelivered(summary, region)) add({ collection: 'context_regions',
            selector: { id } }, `Read affected code at ${region.path}:${region.start_line}-${region.end_line}.`);
        }
      } else {
        const file = files.find(row => row.path === value.path);
        if (file?.state === 'available') add({ collection: 'complete_files', path: file.path }, `Read ${file.path}.`);
      }
    }
    for (const member of Object.values(value)) {
      if (member !== value.source) {
        if (Array.isArray(member)) member.forEach(entry => visit(entry, relationship));
        else if (member && typeof member === 'object') visit(member, relationship);
      }
    }
  };
  if (!collection && summary.relationships && !Array.isArray(summary.relationships)) {
    for (const [relationship, part] of Object.entries(summary.relationships)) visit(part, relationship);
  } else visit(shown, ({ definitions: 'definition', references: 'references', callers: 'callers', callees: 'callees' })[collection]);
  if (!collection && subjects.has('source') && summary.source?.state === 'available' &&
      summary.source.source_text === undefined) add({ collection: 'source' }, `Read ${summary.path}.`);
  return [...calls.values()];
}

export function projectCodeStatus(status, preparation) {
  const limits = codeCoverage({ ...status, scip_state: status.scip_state });
  const available = status.artifact_usable === true;
  const needsPreparation = status.staleness === 'stale' || status.index_action !== 'use' || status.scip_state?.index_action !== 'use';
  return { available, freshness: status.staleness ?? 'unknown',
    ...(status.status_reason ? { reason: status.status_reason } : {}),
    ...(limits.length ? { limitations: limits } : {}),
    ...(needsPreparation ? { preparation: preparation.slot } : {}),
    ...(status.read_error ? { cause: { code: status.read_error_code, message: status.read_error } } : {}),
    next_calls: needsPreparation && preparation.call ? [{ ...preparation.call,
      information: 'Prepare the index only if index maintenance is authorized for this task.' }] : [] };
}

export function codeCandidateCalls(summary, source, detailCall, binding) {
  const calls = [];
  for (const [relationship, part] of Object.entries(summary.relationships ?? {})) {
    const candidates = list(part.candidates);
    for (const chosen of candidates) {

      calls.push({ ...detailCall(binding, { source, collection: 'candidates',
        selector: { id: chosen.id }, relationship }), purpose: 'choose_symbol',
        information: `Inspect ${chosen.symbol}${chosen.path ? ` in ${chosen.path}` : ''} (${chosen.indexer}).` });
    }
  }
  return calls;
}
