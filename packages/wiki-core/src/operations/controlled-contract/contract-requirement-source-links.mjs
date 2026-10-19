

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import sourceDefinitions from "@agent-chassis/controlled-contract/schema/controlled-acceptance-requirement-definitions.v1.schema.json" with { type: "json" };

import { ControlledContractToolError } from "../../lib/controlled-contract-tool-shared.mjs";

export const REQUIREMENT_SOURCE_FIELD = "sections.user_requirements";
export const REQUIREMENT_SOURCE_LOCATION_UNIT = "utf16_code_units";
export const REQUIREMENT_SOURCE_STATES = Object.freeze({ absent: "absent", current: "current", stale: "stale" });
export const REQUIREMENT_SOURCE_CODES = Object.freeze({
  OCCURRENCE_WITHOUT_PASSAGE: "controlled_contract_requirement_source_occurrence_without_passage",
  SOURCE_TEXT_ABSENT: "controlled_contract_requirement_source_text_absent",
  PASSAGE_NOT_FOUND: "controlled_contract_requirement_source_passage_not_found",
  OCCURRENCE_REQUIRED: "controlled_contract_requirement_source_occurrence_required",
  OCCURRENCE_OUT_OF_RANGE: "controlled_contract_requirement_source_occurrence_out_of_range"
});

const LISTED_MATCHES = 16;

const fail = (code, message, details) => { throw new ControlledContractToolError(code, message, { changed: false, path: details.field,
  ...(details.field.startsWith("exception.") ? {} : {
    guidance_path: ["save_record_inputs", "requirement_batch", "source_link", "repair"] }), ...details }); };

export const requirementSourceDigest = text => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

export function requirementSourceMatches(text, passage) {
  const starts = [];
  for (let from = text.indexOf(passage); from !== -1; from = text.indexOf(passage, from + 1)) starts.push(from);
  return starts;
}

export function resolveRequirementSourceLink({ wkId, text, passage, occurrence, field }) {
  const at = member => `${field}.${member}`;
  const exceptionPassage = field.startsWith("exception.source_passages[");
  const omittedLink = exceptionPassage ? "exception.source_passages" : at("user_requirement");
  if (passage === undefined) {
    if (occurrence !== undefined) fail(REQUIREMENT_SOURCE_CODES.OCCURRENCE_WITHOUT_PASSAGE,
      `${at("user_requirement_occurrence")} chooses an occurrence of a passage the row does not state`,
      { field: at("user_requirement_occurrence"), correction: `supply ${at("user_requirement")} with the exact passage, or omit ${at("user_requirement_occurrence")}` });
    return null;
  }
  if (typeof text !== "string" || text.length === 0) fail(REQUIREMENT_SOURCE_CODES.SOURCE_TEXT_ABSENT,
    `${at("user_requirement")} names a passage, and ${wkId} has no saved ${REQUIREMENT_SOURCE_FIELD} text to find it in`,
    { field: at("user_requirement"), source: { wk_id: wkId, field: REQUIREMENT_SOURCE_FIELD },
      read_call: { tool: "workspace_read_wiki", arguments: { subject: wkId } },
      correction: (exceptionPassage
        ? `save changes.user_requirements on ${wkId} in an ordinary save first, read its current revision, then resubmit the exception`
        : `save the source text in the same request as changes.user_requirements on ${wkId}`) +
        `, or omit ${omittedLink} to save an unfinished draft with a source-accounting gap` });
  const starts = requirementSourceMatches(text, passage);
  const source = { wk_id: wkId, field: REQUIREMENT_SOURCE_FIELD, digest: requirementSourceDigest(text) };
  const located = starts.slice(0, LISTED_MATCHES).map((start, index) => ({ occurrence: index + 1, start, end: start + passage.length }));
  const matches = { match_count: starts.length, matches: located, location_unit: REQUIREMENT_SOURCE_LOCATION_UNIT, source,
    read_call: { tool: "workspace_read_wiki", arguments: { subject: wkId } } };
  if (starts.length === 0) fail(REQUIREMENT_SOURCE_CODES.PASSAGE_NOT_FOUND,
    `${at("user_requirement")} is not a passage of ${wkId} ${REQUIREMENT_SOURCE_FIELD}; the text is compared exactly, with no trimming, case folding or normalization`,
    { field: at("user_requirement"), ...matches,
      correction: `copy the passage exactly from ${wkId} ${REQUIREMENT_SOURCE_FIELD} as this save leaves it, or omit ${omittedLink} to save an unfinished draft with a source-accounting gap` });
  if (occurrence === undefined && starts.length > 1) fail(REQUIREMENT_SOURCE_CODES.OCCURRENCE_REQUIRED,
    `${at("user_requirement")} occurs ${starts.length} times in ${wkId} ${REQUIREMENT_SOURCE_FIELD}; state which one this requirement represents`,
    { field: at("user_requirement_occurrence"), ...matches, accepted_occurrences: { minimum: 1, maximum: starts.length },
      correction: `supply ${at("user_requirement_occurrence")} from 1 to ${starts.length}; "matches" lists where each occurrence starts and ends` });
  const chosen = occurrence ?? 1;
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > starts.length) fail(REQUIREMENT_SOURCE_CODES.OCCURRENCE_OUT_OF_RANGE,
    `${at("user_requirement_occurrence")} is ${JSON.stringify(chosen)}, and the passage occurs ${starts.length} time${starts.length === 1 ? "" : "s"} in ${wkId} ${REQUIREMENT_SOURCE_FIELD}`,
    { field: at("user_requirement_occurrence"), rejected_value: chosen, ...matches, accepted_occurrences: { minimum: 1, maximum: starts.length },
      correction: starts.length === 1 ? `supply ${at("user_requirement_occurrence")} 1 or omit it` : `supply ${at("user_requirement_occurrence")} from 1 to ${starts.length}` });
  const start = starts[chosen - 1];
  return Object.freeze({ user_requirement: passage, user_requirement_occurrence: chosen, source: Object.freeze(source),
    location: Object.freeze({ unit: REQUIREMENT_SOURCE_LOCATION_UNIT, start, end: start + passage.length }) });
}

export function describeRequirementSourceLink(stored, text) {
  if (stored === undefined || stored === null) return Object.freeze({ state: REQUIREMENT_SOURCE_STATES.absent });
  const current = typeof text === "string" && requirementSourceDigest(text) === stored.source?.digest;
  return Object.freeze({ state: current ? REQUIREMENT_SOURCE_STATES.current : REQUIREMENT_SOURCE_STATES.stale,
    user_requirement: stored.user_requirement, user_requirement_occurrence: stored.user_requirement_occurrence,
    source: Object.freeze({ ...stored.source }), location: Object.freeze({ ...stored.location }),
    ...(current ? {} : { current_source_digest: typeof text === "string" ? requirementSourceDigest(text) : null,
      correction: "resubmit the row with user_requirement (and its occurrence where the passage repeats) to link it to the current text" }) });
}

export function projectRequirementSourceLink(link) {
  const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined)
    .map(key => [key, structuredClone(value[key])]));
  return { ...pick(link, ['state', 'code', 'cause', 'reason', 'user_requirement', 'user_requirement_occurrence', 'location', 'correction']),
    ...(link.source?.field === undefined ? {} : { source: pick(link.source, ['wk_id', 'field']) }) };
}

export function accountRequirementSourceResidual(authored, sourceText, exceptions = []) {
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    return { measurement_performed: false, accounting_status: 'unknown', source_field: REQUIREMENT_SOURCE_FIELD,
      reason: `no ${REQUIREMENT_SOURCE_FIELD} text is saved, so no residual can be accounted` };
  }
  const digest = requirementSourceDigest(sourceText);
  const links = { current: 0, stale_excluded: 0, absent: 0, inconsistent_row_ids: [] };
  const covering = [];
  const exceptionIntervals = [];
  const exceptionLinks = { current: 0, stale_excluded: 0, absent: 0, inconsistent_row_ids: [] };
  for (const row of [...(authored?.rows ?? []).map(row => ({ ...row, category: "formal" })),
    ...exceptions.map(row => ({ ...row, category: "exception" }))]) {
    const counts = row.category === "formal" ? links : exceptionLinks;
    const link = row.source ?? { state: REQUIREMENT_SOURCE_STATES.absent };
    if (link.state === REQUIREMENT_SOURCE_STATES.absent) { counts.absent += 1; continue; }
    if (link.state !== REQUIREMENT_SOURCE_STATES.current) { counts.stale_excluded += 1; continue; }
    const { start, end } = link.location ?? {};
    if (link.source?.digest !== digest || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
        end <= start || end > sourceText.length || link.location.unit !== REQUIREMENT_SOURCE_LOCATION_UNIT ||
        link.source?.field !== REQUIREMENT_SOURCE_FIELD || typeof link.user_requirement !== 'string' || link.user_requirement.length === 0 ||
        !Number.isInteger(link.user_requirement_occurrence) || link.user_requirement_occurrence < 1 ||
        sourceText.slice(start, end) !== link.user_requirement ||
        requirementSourceMatches(sourceText, link.user_requirement)[link.user_requirement_occurrence - 1] !== start) {
      counts.inconsistent_row_ids.push(row.row_id);
      continue;
    }
    counts.current += 1;
    (row.category === "formal" ? covering : exceptionIntervals).push({ start, end });
  }
  const union = intervals => {
    const result = [];
    for (const interval of intervals.sort((left, right) => left.start - right.start || left.end - right.end)) {
      const last = result.at(-1);
      if (last !== undefined && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
      else result.push({ ...interval });
    }
    return result;
  };
  const formal = union(covering), excepted = union(exceptionIntervals);
  const linked = union([...formal, ...excepted]);
  const segments = [];
  const unmapped = (start, end) => {
    if (end <= start) return;
    const text = sourceText.slice(start, end);
    segments.push({ start, end, text, whitespace_only: text.trim().length === 0 });
  };
  let cursor = 0;
  for (const interval of linked) { unmapped(cursor, interval.start); cursor = interval.end; }
  unmapped(cursor, sourceText.length);
  const length = intervals => intervals.reduce((total, interval) => total + interval.end - interval.start, 0);
  return { measurement_performed: true,
    accounting_status: segments.some(segment => !segment.whitespace_only) ? 'incomplete' : 'complete', source_field: REQUIREMENT_SOURCE_FIELD,
    source: { digest, length: sourceText.length, unit: REQUIREMENT_SOURCE_LOCATION_UNIT }, links, exception_links: exceptionLinks,
    formal: { interval_count: formal.length, length: length(formal), intervals: formal },
    excepted: { interval_count: excepted.length, length: length(excepted), intervals: excepted },
    linked: { interval_count: linked.length, length: length(linked), intervals: linked },
    unmapped: { segment_count: segments.length, length: length(segments), segments } };
}

export function resolveExceptionSourcePassages({ wkId, text, passages }) {
  if (passages === undefined) return undefined;
  return passages.map((selection, index) => resolveRequirementSourceLink({ wkId, text,
    passage: selection.user_requirement, occurrence: selection.user_requirement_occurrence,
    field: `exception.source_passages[${index}]` }));
}

export function accountParentRequirementSource(contract, record) {
  const text = record?.sections?.user_requirements;
  const describe = stored => {
    const link = describeRequirementSourceLink(stored, text);
    return link.state === 'current' && link.source.wk_id !== record.id
      ? { ...link, state: 'stale' } : link;
  };
  const authored = contract?.authored_requirements;
  const exceptions = (authored?.unresolved ?? []).flatMap((entry, index) =>
    (entry.grammar_exception?.source_passages ?? []).map((link, occurrence) => ({
      row_id: `u${index + 1}:${occurrence + 1}`, source: describe(link) })));
  if (record?.proof_posture?.controlled_contract?.required === false) {
    exceptions.push(...(record.proof_posture.controlled_contract.source_passages ?? []).map((link, index) => ({
      row_id: `${record.id}:${index + 1}`, source: describe(link) })));
  }

  const bindingGaps = entries => ({ without_passages: entries.filter(links => links.length === 0).length,
    stale_passages: entries.flat().filter(link => describe(link).state !== 'current').length });
  const grammar = bindingGaps((authored?.unresolved ?? []).filter(entry => entry.grammar_exception !== undefined)
    .map(entry => entry.grammar_exception.source_passages ?? []));
  const controlled = bindingGaps(record?.proof_posture?.controlled_contract?.required === false
    ? [record.proof_posture.controlled_contract.source_passages ?? []] : []);
  const gaps = Object.fromEntries([['grammar', grammar], ['controlled_acceptance', controlled]]
    .filter(([, counts]) => counts.without_passages > 0 || counts.stale_passages > 0));
  return { scope: 'parent_work_record', parent_unit: record?.id ?? null,
    ...(Object.keys(gaps).length === 0 ? {} : { exception_binding_gaps: gaps }),
    ...accountRequirementSourceResidual({ rows: (authored?.rows ?? []).map(row => ({
      row_id: row.row_id, source: describe(row.source) })) }, text, exceptions) };
}

export function compactRequirementSourceAccounting(facts) {
  return { scope: facts.scope, parent_unit: facts.parent_unit,
    accounting_status: facts.accounting_status, measurement_performed: facts.measurement_performed,
    source_field: facts.source_field, source: facts.source ?? null,
    formal_length: facts.formal?.length ?? 0, excepted_length: facts.excepted?.length ?? 0,
    accounted_length: facts.linked?.length ?? 0, remaining_length: facts.unmapped?.length ?? null,
    remaining_prose_segments: facts.unmapped?.segments.filter(row => !row.whitespace_only).length ?? null,
    correction: { tool: 'workspace_read_wiki', arguments: { subject: facts.parent_unit } },
    ...(facts.accounting_status !== 'incomplete' ? {} : { recovery: {
      ...(facts.exception_binding_gaps === undefined ? {} : { saved_exception_binding_gaps: facts.exception_binding_gaps }),
      missing: 'Current exact associations between original source passages and caller-authored requirements are missing for remaining prose.',
      instruction: 'Read the current parent revision, then author faithful requirements or restate saved rows with the exact passages each represents. Preserve the original prose and choose occurrences explicitly where passages repeat. Declaring acceptance required does not repair source accounting; historical assessment retrieval supplies no write revision.',
      guidance: [['save_record_inputs', 'requirement_batch', 'source_link'],
        ['save_record_inputs', 'requirement_batch', 'row_addressing'], ['requirement_schema', 'existing', 'requirement']]
        .map(topic => ({ tool: 'workspace_read_wiki', arguments: { subject: { requirement_guidance: true, topic } } }))
    } }),
    ...(facts.measurement_performed ? { link_meaning: 'Association only; semantic completeness, criterion coverage, execution capability, CEL enforcement and proof credit remain separate.' } : {}) };
}

let validateStoredPassages;
export function validStoredExceptionSourcePassages(passages) {
  if (validateStoredPassages === undefined) {
    const loaded = createRequire(import.meta.url)("ajv");
    const Ajv = loaded.default ?? loaded;
    validateStoredPassages = new Ajv({ strict: false }).compile({
      $defs: sourceDefinitions.$defs, type: 'array', minItems: 1, maxItems: 64,
      items: { $ref: '#/$defs/authored_requirement_source' } });
  }
  return validateStoredPassages(passages);
}
