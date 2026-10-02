

import { createHash } from "node:crypto";

import { criterionIdentityDigest } from "@agent-chassis/controlled-contract";

import { buildDispatchContinuation } from "./dispatch-tool-helpers.mjs";
import {
  SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION,
  selectedResponseQueryInvalidError
} from "./selected-response-snapshot.mjs";

export const RUN_STATUS_RETAINED_DOCUMENT_ROUTE = "workspace_agent_run_status";
export const RUN_STATUS_AUTHORED_DOCUMENT_DETAIL_KIND = "authored_document";
export const RUN_STATUS_AUTHORED_DOCUMENT_DETAIL_SCHEMA_VERSION =
  "workspace-agent-run-status-authored-document-detail.v1";

export const TERMINAL_CANDIDATE_CONTROLLED_GENERATION_CARRIER_MEMBER =
  "terminal_candidate_controlled_generation";
export const INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER = "integration_transition_record";
export const RUN_STATUS_AUTHORED_DOCUMENTS = Object.freeze({
  canonical_parent_wk_contract: Object.freeze({
    meaning: "parent_wk_contract", shape: "work_record" }),
  review_unit_contract: Object.freeze({
    meaning: "review_unit_contract", shape: "work_record_unit" }),
  [TERMINAL_CANDIDATE_CONTROLLED_GENERATION_CARRIER_MEMBER]: Object.freeze({
    meaning: "controlled_generation", shape: "controlled_generation" }),
  [INTEGRATION_TRANSITION_RECORD_CARRIER_MEMBER]: Object.freeze({
    meaning: "integration_transition_record", shape: "work_record" })
});

const SELECTION_FIELDS = Object.freeze(["unit", "section", "criterion", "entry", "carrier",
  "focus", "obligation"]);
const WORK_RECORD_SELECTIONS = new Set(["unit", "section", "criterion", "entry"]);
const GENERATION_SELECTIONS = new Set(["carrier", "focus", "section", "obligation"]);

const SUMMARY_SCALAR_MAX_UTF8_BYTES = 512;
const SOURCE_REF_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/u;
const SOURCE_SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function authoredDocumentDigest(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function serializeRetainedObject(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

export function authoredDocumentDetailSchema(z) {
  return z.object({
    kind: z.literal(RUN_STATUS_AUTHORED_DOCUMENT_DETAIL_KIND),
    source: z.object({
      ref_id: z.string().regex(SOURCE_REF_ID_PATTERN),
      sha256: z.string().regex(SOURCE_SHA256_PATTERN)
    }).strict(),
    document: z.enum(Object.keys(RUN_STATUS_AUTHORED_DOCUMENTS)),
    unit: z.string().min(1).max(256).optional(),
    section: z.string().min(1).max(128).optional(),
    criterion: z.string().min(1).max(512).optional(),
    entry: z.number().int().min(0).optional(),
    carrier: z.string().min(1).max(4096).optional(),
    focus: z.string().min(1).max(512).optional(),
    obligation: z.string().min(1).max(512).optional()
  }).strict();
}

export function authoredDocumentCall({ repository, subject, attemptId, source, document,
  selection = {}, recommended = true }) {
  try {
    return buildDispatchContinuation({
      tool: RUN_STATUS_RETAINED_DOCUMENT_ROUTE,
      arguments: {
        ...(typeof repository === "string" && repository.length > 0 ? { repo: repository } : {}),
        subject,
        ...(typeof attemptId === "string" ? { attempt_id: attemptId } : {}),
        detail: { kind: RUN_STATUS_AUTHORED_DOCUMENT_DETAIL_KIND,
          source: { ref_id: source.ref_id, sha256: source.sha256 }, document, ...selection }
      },
      successPredicate: { fact: "monitor.authored_document_detail_read", operator: "is_true" },
      recommended
    });
  } catch {
    return null;
  }
}

export function buildRetainedDocumentRetrieval(retention, { members }) {
  if (retention === null || retention === undefined) {
    return {
      state: "unavailable",
      code: "authored_contract_source_not_retained",
      meaning: "this response retained no source, so the omitted document is not readable from it"
    };
  }
  if (retention.state !== "retained") {
    return {
      state: "unavailable",
      code: typeof retention.code === "string" ? retention.code : "authored_contract_source_not_retained",
      meaning: "retention failed for this observation; no current read substitutes for the omitted document"
    };
  }
  const calls = {};
  for (const member of members) {
    const call = authoredDocumentCall({ repository: retention.repository, subject: retention.unit,
      attemptId: retention.observation_identity?.attempt_id ?? null, source: retention.locator,
      document: member });
    if (call === null) {
      return {
        state: "unavailable",
        code: "authored_document_read_route_unavailable",
        meaning: "the retained source exists but this registration publishes no checkable read for it"
      };
    }
    calls[member] = call;
  }
  return {
    state: "retained",
    source_schema_version: SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION,
    source: { ref_id: retention.locator.ref_id, sha256: retention.locator.sha256 },

    binding: {
      route: RUN_STATUS_RETAINED_DOCUMENT_ROUTE,
      repository: retention.repository,
      unit: retention.unit,
      observation_identity: retention.observation_identity
    },
    carrier_members: retention.members,

    document_calls: calls
  };
}

const utf8Bytes = (value) => Buffer.byteLength(
  typeof value === "string" ? value : JSON.stringify(value) ?? "", "utf8");
const isScalar = (value) => value === null || typeof value !== "object";

function invalid(reason, details) {
  return selectedResponseQueryInvalidError(RUN_STATUS_RETAINED_DOCUMENT_ROUTE, reason, details);
}

function memberInventory(value, prefix = "") {
  return Object.entries(value).map(([name, member]) => ({
    section: `${prefix}${name}`,
    type: Array.isArray(member) ? "array" : member === null ? "null" : typeof member,
    ...(Array.isArray(member) ? { count: member.length } : {}),
    utf8_bytes: utf8Bytes(member)
  }));
}

function summaryScalars(value) {
  return Object.fromEntries(Object.entries(value).filter(([, member]) => isScalar(member) &&
    utf8Bytes(member) <= SUMMARY_SCALAR_MAX_UTF8_BYTES));
}

function parseRetainedJson(text, facts) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw invalid("retained_document_unparseable", { ...facts,
      cause: typeof error?.message === "string" ? error.message : String(error) });
  }
}

function criterionIdentity(criterion, position) {
  if (isObjectRecord(criterion) && typeof criterion.typed_identity === "string") {
    return criterion.typed_identity;
  }
  const text = typeof criterion === "string" ? criterion
    : isObjectRecord(criterion) && typeof criterion.text === "string" ? criterion.text : null;
  return text === null ? null : `derived:${criterionIdentityDigest(position, text)}`;
}

function entryTitle(entry) {
  const current = Array.isArray(entry?.versions)
    ? entry.versions.find((version) => version?.id === entry.current_version) : undefined;
  return typeof current?.title === "string" ? current.title : null;
}

function workRecordUnits(record, shape) {
  if (shape === "work_record_unit") {
    return [{ unit: typeof record.id === "string" ? record.id : null, value: record }];
  }
  const { slices, ...root } = record;
  const units = [{ unit: record.id, value: root }];
  if (Array.isArray(slices)) {
    for (const slice of slices) {
      if (isObjectRecord(slice) && typeof slice.id === "string") {
        units.push({ unit: `${record.id}#${slice.id}`, value: slice });
      }
    }
  }
  return units;
}

function resolveWorkRecordSelection(record, shape, detail, facts) {
  const units = workRecordUnits(record, shape);
  const selected = detail.unit === undefined ? null : units.find(({ unit }) => unit === detail.unit);
  if (detail.unit !== undefined && selected === undefined) {
    throw invalid("unit_unknown", { ...facts, unit: detail.unit, units: units.map(({ unit }) => unit) });
  }
  const unit = selected ?? units[0];
  const unitValue = unit.value;
  if (detail.criterion !== undefined) {
    if (detail.section !== undefined && detail.section !== "acceptance") {
      throw invalid("selection_not_applicable", { ...facts, selection: ["section", "criterion"] });
    }
    const criteria = Array.isArray(unitValue?.acceptance?.criteria) ? unitValue.acceptance.criteria : [];
    const position = criteria.findIndex((criterion, index) =>
      criterionIdentity(criterion, index) === detail.criterion);
    if (position < 0) {
      throw invalid("criterion_unknown", { ...facts, unit: unit.unit, criterion: detail.criterion,
        criteria_total: criteria.length });
    }
    return { level: "criterion", unit: unit.unit, value: criteria[position],
      identity: { criterion: detail.criterion, position } };
  }
  if (detail.entry !== undefined) {
    if (detail.section !== undefined && detail.section !== "sections.entries") {
      throw invalid("selection_not_applicable", { ...facts, selection: ["section", "entry"] });
    }
    const entries = Array.isArray(unitValue?.sections?.entries) ? unitValue.sections.entries : [];
    const entry = entries.find((candidate) => candidate?.id === detail.entry);
    if (entry === undefined) {
      throw invalid("entry_unknown", { ...facts, unit: unit.unit, entry: detail.entry,
        entries_total: entries.length });
    }
    return { level: "entry", unit: unit.unit, value: entry, identity: { entry: detail.entry } };
  }
  if (detail.section !== undefined) {
    const named = detail.section.startsWith("sections.")
      ? { holder: unitValue?.sections, name: detail.section.slice("sections.".length) }
      : { holder: unitValue, name: detail.section };
    if (!isObjectRecord(named.holder) || !Object.hasOwn(named.holder, named.name) ||
        (named.holder === unitValue && named.name === "slices")) {
      throw invalid("section_unknown", { ...facts, unit: unit.unit, section: detail.section,
        sections: [...Object.keys(unitValue ?? {}).filter((name) => name !== "slices"),
          ...Object.keys(isObjectRecord(unitValue?.sections) ? unitValue.sections : {})
            .map((name) => `sections.${name}`)] });
    }
    return { level: "section", unit: unit.unit, value: named.holder[named.name],
      section: detail.section };
  }
  if (selected !== null) return { level: "unit", unit: unit.unit, value: unitValue };
  return { level: "document", unit: unit.unit, value: record, units };
}

function workRecordNarrower(resolved) {
  const { level, value, unit } = resolved;
  if (level === "document") {
    return { summary: {
      record: summaryScalars(Object.fromEntries(["id", "schema_version", "title", "status", "record_kind",
        "work_kind"].filter((name) => Object.hasOwn(value, name)).map((name) => [name, value[name]]))),
      unit_count: resolved.units.length,
      units: resolved.units.map(({ unit: address, value: unitValue }) => ({ unit: address,
        ...(typeof unitValue?.title === "string" ? { title: unitValue.title } : {}),
        ...(typeof unitValue?.status === "string" ? { status: unitValue.status } : {}),
        utf8_bytes: utf8Bytes(unitValue) }))
    }, selections: resolved.units.map(({ unit: address }) => ({ unit: address })) };
  }
  if (level === "unit") {
    const inventory = memberInventory(value).filter(({ section }) => section !== "slices");
    return { summary: { unit, scalars: summaryScalars(value), sections: inventory },
      selections: inventory.filter(({ section }) => !isScalar(value[section]) ||
        utf8Bytes(value[section]) > SUMMARY_SCALAR_MAX_UTF8_BYTES)
        .map(({ section }) => ({ unit, section })) };
  }
  if (level === "section" && resolved.section === "acceptance" && isObjectRecord(value)) {
    const criteria = Array.isArray(value.criteria) ? value.criteria : [];
    const rows = criteria.map((criterion, position) => ({ criterion: criterionIdentity(criterion, position),
      position, utf8_bytes: utf8Bytes(criterion) }));
    return { summary: { unit, section: "acceptance",
      members: memberInventory(value), criteria: rows },
    selections: rows.filter(({ criterion }) => criterion !== null)
      .map(({ criterion }) => ({ unit, criterion })) };
  }
  if (level === "section" && resolved.section === "sections" && isObjectRecord(value)) {
    const inventory = memberInventory(value, "sections.");
    return { summary: { unit, section: "sections", sections: inventory },
      selections: inventory.map(({ section }) => ({ unit, section })) };
  }
  if (level === "section" && resolved.section === "sections.entries" && Array.isArray(value)) {
    const rows = value.map((entry) => ({ entry: entry?.id ?? null, title: entryTitle(entry),
      utf8_bytes: utf8Bytes(entry) }));
    return { summary: { unit, section: "sections.entries", entries: rows },
      selections: rows.filter(({ entry }) => Number.isInteger(entry)).map(({ entry }) => ({ unit, entry })) };
  }
  return null;
}

function generationCarrierRow(descriptor, manifest) {
  return {
    carrier: descriptor.path,
    ...(manifest ? { manifest: true } : {}),
    ...(typeof descriptor.focus === "string" || descriptor.focus === null ? { focus: descriptor.focus } : {}),
    ...(typeof descriptor.carrier_kind === "string" ? { carrier_kind: descriptor.carrier_kind } : {}),
    content_digest: descriptor.content_digest ?? null,
    byte_length: descriptor.byte_length ?? null
  };
}

function generationDescriptors(generation) {
  const rows = [];
  for (const [list, manifest] of [[generation.descriptors, false], [generation.manifest_descriptors, true]]) {
    if (!Array.isArray(list)) continue;
    for (const descriptor of list) {
      if (isObjectRecord(descriptor) && typeof descriptor.path === "string") rows.push({ descriptor, manifest });
    }
  }
  return rows;
}

function decodeGenerationCarrier(descriptor, facts) {
  const encoded = descriptor.bytes_base64;
  const bytes = typeof encoded === "string" ? Buffer.from(encoded, "base64") : null;
  if (bytes === null || bytes.toString("base64") !== encoded) {
    throw invalid("retained_carrier_undecodable", { ...facts, carrier: descriptor.path });
  }
  const observed = { content_digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    byte_length: bytes.byteLength };
  if (observed.content_digest !== descriptor.content_digest || observed.byte_length !== descriptor.byte_length) {
    throw invalid("retained_carrier_integrity_mismatch", { ...facts, carrier: descriptor.path,
      expected: { content_digest: descriptor.content_digest ?? null, byte_length: descriptor.byte_length ?? null },
      observed });
  }
  return parseRetainedJson(bytes.toString("utf8"), { ...facts, carrier: descriptor.path });
}

function obligationCollections(carrier) {
  if (!isObjectRecord(carrier)) return [];
  return Object.entries(carrier).filter(([, member]) => Array.isArray(member) &&
    member.some((row) => isObjectRecord(row) && typeof row.obligation_id === "string"))
    .map(([name, rows]) => ({ name, rows }));
}

function resolveGenerationSelection(generation, detail, facts) {
  const rows = generationDescriptors(generation);
  if (detail.carrier === undefined && detail.focus === undefined) {
    if (detail.section !== undefined || detail.obligation !== undefined) {
      throw invalid("selection_not_applicable", { ...facts,
        selection: SELECTION_FIELDS.filter((field) => detail[field] !== undefined),
        requires: ["carrier", "focus"] });
    }
    return { level: "document", rows };
  }
  let matches = rows.filter(({ descriptor, manifest }) =>
    (detail.carrier === undefined || descriptor.path === detail.carrier) &&
    (detail.focus === undefined || (!manifest && descriptor.focus === detail.focus)));
  if (matches.length === 0) {
    throw invalid("carrier_unknown", { ...facts,
      ...(detail.carrier === undefined ? {} : { carrier: detail.carrier }),
      ...(detail.focus === undefined ? {} : { focus: detail.focus }),
      carriers_total: rows.length });
  }
  if (matches.length > 1) {
    throw invalid("focus_ambiguous", { ...facts, focus: detail.focus,
      carriers: matches.map(({ descriptor }) => descriptor.path) });
  }
  [matches] = matches;
  const carrierPath = matches.descriptor.path;
  const decoded = decodeGenerationCarrier(matches.descriptor, facts);
  const carrierSelection = { carrier: carrierPath };
  if (detail.obligation !== undefined) {
    const found = [];
    for (const { name, rows: obligations } of obligationCollections(decoded)) {
      for (const row of obligations) {
        if (isObjectRecord(row) && row.obligation_id === detail.obligation) found.push({ name, row });
      }
    }
    if (found.length === 0) {
      throw invalid("obligation_unknown", { ...facts, carrier: carrierPath, obligation: detail.obligation,
        obligation_collections: obligationCollections(decoded).map(({ name }) => name) });
    }
    return { level: "obligation", carrierSelection, value: found.length === 1 ? found[0].row
      : found.map(({ name, row }) => ({ collection: name, value: row })),
    identity: { carrier: carrierPath, obligation: detail.obligation,
      collections: found.map(({ name }) => name) } };
  }
  if (detail.section !== undefined) {
    if (!isObjectRecord(decoded) || !Object.hasOwn(decoded, detail.section)) {
      throw invalid("section_unknown", { ...facts, carrier: carrierPath, section: detail.section,
        sections: isObjectRecord(decoded) ? Object.keys(decoded) : [] });
    }
    return { level: "section", carrierSelection, value: decoded[detail.section],
      section: detail.section, decoded };
  }
  return { level: "carrier", carrierSelection, value: decoded, descriptor: matches };
}

function generationNarrower(resolved, generation) {
  if (resolved.level === "document") {
    const carriers = resolved.rows.map(({ descriptor, manifest }) => generationCarrierRow(descriptor, manifest));
    return { summary: {
      identity: Object.fromEntries(["schema_version", "wk_id", "generation_digest", "count",
        "manifest_identity", "repository", "record_source_digest", "wk_tip_sha"]
        .filter((name) => Object.hasOwn(generation, name) && isScalar(generation[name]))
        .map((name) => [name, generation[name]])),
      counts: {
        descriptors: Array.isArray(generation.descriptors) ? generation.descriptors.length : null,
        manifest_descriptors: Array.isArray(generation.manifest_descriptors)
          ? generation.manifest_descriptors.length : null
      },
      carriers
    }, selections: carriers.map(({ carrier }) => ({ carrier })) };
  }
  const { carrierSelection } = resolved;
  const decoded = resolved.level === "section" ? resolved.decoded : resolved.value;
  if (resolved.level === "carrier" && isObjectRecord(decoded)) {
    const obligations = obligationCollections(decoded).flatMap(({ name, rows }) => rows
      .filter((row) => isObjectRecord(row) && typeof row.obligation_id === "string")
      .map((row) => ({ obligation: row.obligation_id, collection: name, utf8_bytes: utf8Bytes(row) })));
    const inventory = memberInventory(decoded);
    return { summary: { ...carrierSelection, scalars: summaryScalars(decoded), sections: inventory,
      obligations },
    selections: [...obligations.map(({ obligation }) => ({ ...carrierSelection, obligation })),
      ...inventory.filter(({ section }) => !isScalar(decoded[section]) ||
        utf8Bytes(decoded[section]) > SUMMARY_SCALAR_MAX_UTF8_BYTES)
        .map(({ section }) => ({ ...carrierSelection, section }))] };
  }
  if (resolved.level === "section" && Array.isArray(resolved.value) &&
      resolved.value.some((row) => isObjectRecord(row) && typeof row.obligation_id === "string")) {
    const rows = resolved.value.map((row) => ({
      obligation: isObjectRecord(row) && typeof row.obligation_id === "string" ? row.obligation_id : null,
      utf8_bytes: utf8Bytes(row) }));
    return { summary: { ...carrierSelection, section: resolved.section, count: rows.length, obligations: rows },
      selections: rows.filter(({ obligation }) => obligation !== null)
        .map(({ obligation }) => ({ ...carrierSelection, obligation })) };
  }
  if (resolved.level === "section" && isObjectRecord(resolved.value)) {
    return { summary: { ...carrierSelection, section: resolved.section,
      members: memberInventory(resolved.value) }, selections: [] };
  }
  return null;
}

const LISTING_IDENTITY = Object.freeze({ units: "unit", entries: "entry", criteria: "criterion",
  carriers: "carrier", obligations: "obligation", sections: "section", members: "section" });

function fitSummary(summary, fits) {
  if (fits(summary)) return summary;
  const listings = Object.keys(summary).filter((key) => Object.hasOwn(LISTING_IDENTITY, key) &&
    Array.isArray(summary[key]));
  const reduced = { ...summary };
  for (const key of listings) {
    const identity = LISTING_IDENTITY[key];
    reduced[key] = summary[key].map((row) => (isObjectRecord(row)
      ? { [identity]: row[identity] ?? null, ...(row.utf8_bytes === undefined ? {} : { utf8_bytes: row.utf8_bytes }) }
      : row));
  }
  if (fits(reduced)) return reduced;
  const cut = { ...reduced, listed: {} };
  for (const key of listings) cut.listed[key] = { total: reduced[key].length, returned: reduced[key].length };
  const bySize = [...listings].sort((left, right) => utf8Bytes(reduced[right]) - utf8Bytes(reduced[left]));
  for (const key of bySize) {
    if (fits(cut)) return cut;
    let low = 0;
    let high = reduced[key].length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = { ...cut, [key]: reduced[key].slice(0, middle),
        listed: { ...cut.listed, [key]: { total: reduced[key].length, returned: middle } } };
      if (fits(candidate)) low = middle;
      else high = middle - 1;
    }
    cut[key] = reduced[key].slice(0, low);
    cut.listed = { ...cut.listed, [key]: { total: reduced[key].length, returned: low } };
  }
  return fits(cut) ? cut : null;
}

export function presentAuthoredDocument({ envelope, detail, fits, call }) {
  const spec = RUN_STATUS_AUTHORED_DOCUMENTS[detail.document];
  const facts = { document: detail.document };
  const text = envelope.carrier?.[detail.document];
  if (spec === undefined || typeof text !== "string") {
    throw invalid("document_not_retained", { ...facts,
      carrier_members: Object.keys(envelope.carrier ?? {}) });
  }
  const allowed = spec.shape === "controlled_generation" ? GENERATION_SELECTIONS : WORK_RECORD_SELECTIONS;
  const offered = SELECTION_FIELDS.filter((field) => detail[field] !== undefined);
  const refused = offered.filter((field) => !allowed.has(field));
  if (refused.length > 0) {
    throw invalid("selection_not_applicable", { ...facts, selection: refused, selections: [...allowed] });
  }
  const document = parseRetainedJson(text, facts);
  if (!isObjectRecord(document)) {
    throw invalid("retained_document_unparseable", { ...facts, cause: "the retained document is not an object" });
  }
  const selection = Object.fromEntries(offered.map((field) => [field, detail[field]]));
  const resolved = spec.shape === "controlled_generation"
    ? resolveGenerationSelection(document, detail, facts)
    : resolveWorkRecordSelection(document, spec.shape, detail, facts);
  const base = {
    schema_version: RUN_STATUS_AUTHORED_DOCUMENT_DETAIL_SCHEMA_VERSION,
    kind: RUN_STATUS_AUTHORED_DOCUMENT_DETAIL_KIND,
    document: detail.document,
    meaning: spec.meaning,
    evidence_class: "historical_attempt_snapshot",
    current_record_read_is_equivalent: false,
    grants_authority: false,
    source: { ref_id: detail.source.ref_id, sha256: detail.source.sha256 },
    retained_source: {
      route: envelope.binding.route,
      repository: envelope.binding.repository,
      unit: envelope.binding.unit,
      observation_identity: envelope.binding.observation_identity
    },
    document_identity: { digest: authoredDocumentDigest(text), utf8_bytes: utf8Bytes(text) },
    selection,
    level: resolved.level
  };
  const frame = (fields, calls) => ({ detail: { ...base, ...fields }, next_calls: calls });

  if (resolved.level !== "document" || spec.shape !== "controlled_generation") {
    const complete = frame({ presentation: "complete", value: resolved.value,
      ...(resolved.identity === undefined ? {} : { identity: resolved.identity }) }, []);
    if (fits(complete)) return complete;
  }
  const narrower = spec.shape === "controlled_generation"
    ? generationNarrower(resolved, document)
    : workRecordNarrower(resolved);
  if (narrower === null) {

    throw invalid("selected_value_exceeds_delivery_bound", { ...facts, selection,
      level: resolved.level, utf8_bytes: utf8Bytes(resolved.value) });
  }
  const total = narrower.selections.length;
  const summaryFrame = (candidate, calls) => frame({ presentation: "summary", summary: candidate,
    narrower_selections: { total, offered: calls.length } }, calls);

  let firstIndex = -1;
  let firstCall = null;
  for (const [index, candidate] of narrower.selections.entries()) {
    firstCall = call(candidate, true);
    if (firstCall !== null) {
      firstIndex = index;
      break;
    }
  }
  let fitted = firstCall === null ? null
    : fitSummary(narrower.summary, (candidate) => fits(summaryFrame(candidate, [firstCall])));
  const reserved = fitted !== null;
  if (!reserved) fitted = fitSummary(narrower.summary, (candidate) => fits(summaryFrame(candidate, [])));
  if (fitted === null) {
    throw invalid("selected_summary_exceeds_delivery_bound", { ...facts, selection,
      level: resolved.level, utf8_bytes: utf8Bytes(narrower.summary) });
  }
  const summary = { presentation: "summary", summary: fitted };

  const calls = reserved ? [firstCall] : [];
  for (const candidate of narrower.selections.slice(reserved ? firstIndex + 1 : 0)) {
    const next = call(candidate, calls.length === 0);
    if (next === null) continue;
    const withCall = [...calls, next];
    if (!fits(frame({ ...summary, narrower_selections: { total: narrower.selections.length,
      offered: withCall.length } }, withCall))) break;
    calls.push(next);
  }
  return frame({ ...summary, narrower_selections: { total: narrower.selections.length,
    offered: calls.length } }, calls);
}
