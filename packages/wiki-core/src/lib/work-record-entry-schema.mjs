

export const WORK_RECORD_TEXT_REFERENCE_PREFIX = "wktext.v1.";
export const WORK_RECORD_CONTENT_MAX_PARTS = 256;
export const WORK_RECORD_SELECTION_MAX_UTF8_BYTES = 4096;
export const WORK_RECORD_TEXT_PAGE_DEFAULT_SCALARS = 512;
export const WORK_RECORD_TEXT_PAGE_MAX_SCALARS = 1024;
export const WORK_RECORD_AMBIGUITY_DEFAULT_CHOICES = 5;
export const WORK_RECORD_AMBIGUITY_MAX_CHOICES = 25;
export const WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES = 8192;

export const WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES = 2048;

export const WORK_RECORD_ENTRY_BODY_PAGE_MAX_SCALARS = WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES;
export const WORK_RECORD_ENTRY_TITLE_MAX_SCALARS = 256;
export const WORK_RECORD_ENTRY_TITLE_MAX_UTF8_BYTES = 1024;
export const WORK_RECORD_ENTRY_KIND_MAX_SCALARS = 64;
export const WORK_RECORD_ENTRY_KIND_MAX_UTF8_BYTES = 256;
export const WORK_RECORD_ENTRY_METADATA_PAGE_DEFAULT = 25;
export const WORK_RECORD_ENTRY_METADATA_PAGE_MAX = 50;
export const WORK_RECORD_ENTRY_REFERENCE_PREFIX = "wkentry.v1.";

export const WORK_RECORD_REFERENCE_FIELDS = Object.freeze([
  "v", "p", "r", "w", "u", "f", "i", "g", "o", "l", "t"
]);

export function isUnicodeScalarString(value) {
  if (typeof value !== "string") return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function utf8Length(value) {
  return Buffer.byteLength(value, "utf8");
}

export function checkedAdd(left, right) {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) {
    return null;
  }
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

function issue(code, message, path = "value") {
  return { code, severity: "error", authority_limb: "mechanical", message, path };
}

function exactObjectKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

const CURRENT_VERSION_KEYS = ["id", "title", "kind", "content", "scalar_length", "utf8_bytes", "provenance"];
const HISTORICAL_VERSION_KEYS = ["id", "title", "kind", "content", "provenance"];
const HISTORICAL_RECEIPT_KEYS = ["request_key", "fingerprint", "version_id"];

export function workRecordEntryVersionFormat(entry, version) {
  if (exactObjectKeys(version, CURRENT_VERSION_KEYS)) return "current";
  if (entry && typeof entry === "object" && Object.hasOwn(entry, "receipt") &&
      exactObjectKeys(version, HISTORICAL_VERSION_KEYS)) return "historical";
  return null;
}

function isHistoricalWorkRecordEntryShape(entry) {
  return Boolean(entry && typeof entry === "object" && (Object.hasOwn(entry, "receipt") ||
    (Array.isArray(entry.versions) && entry.versions.some(version =>
      exactObjectKeys(version, HISTORICAL_VERSION_KEYS)))));
}

function validateLeaf(value, path) {
  if (exactObjectKeys(value, ["text"])) {
    if (typeof value.text !== "string") {
      return issue("work_record_content_text_invalid", "text must be a string", `${path}.text`);
    }
    if (!isUnicodeScalarString(value.text)) {
      return issue("work_record_content_unicode_invalid", "text must contain only Unicode scalar values", `${path}.text`);
    }
    return null;
  }
  if (exactObjectKeys(value, ["ref"])) {
    if (typeof value.ref !== "string" || value.ref.length === 0) {
      return issue("work_record_content_reference_invalid", "ref must be one nonempty opaque returned string", `${path}.ref`);
    }
    if (!isUnicodeScalarString(value.ref)) {
      return issue("work_record_content_unicode_invalid", "ref must contain only Unicode scalar values", `${path}.ref`);
    }
    return null;
  }
  return issue(
    "work_record_content_leaf_invalid",
    "content leaves are closed objects containing exactly text or ref",
    path
  );
}

export function validateWorkRecordEntryContent(value, { path = "value" } = {}) {
  const direct = validateLeaf(value, path);
  if (direct === null) return { ok: true, leaves: [value] };
  if (!exactObjectKeys(value, ["parts"])) {
    return { ok: false, diagnostic: issue(
      "work_record_content_invalid",
      "value must be exactly {text}, {ref}, or {parts:[nonempty flat text/ref leaves]}",
      path
    ) };
  }
  if (!Array.isArray(value.parts) || value.parts.length === 0) {
    return { ok: false, diagnostic: issue(
      "work_record_content_parts_invalid",
      "parts must be a nonempty array",
      `${path}.parts`
    ) };
  }
  if (value.parts.length > WORK_RECORD_CONTENT_MAX_PARTS) {
    return { ok: false, diagnostic: issue(
      "work_record_content_parts_limit_exceeded",
      `parts accepts at most ${WORK_RECORD_CONTENT_MAX_PARTS} leaves`,
      `${path}.parts`
    ) };
  }
  for (const [index, leaf] of value.parts.entries()) {
    const leafIssue = validateLeaf(leaf, `${path}.parts[${index}]`);
    if (leafIssue !== null) return { ok: false, diagnostic: leafIssue };
  }
  return { ok: true, leaves: value.parts };
}

export function workRecordEditUsesEntryContent(entry, action) {
  if (!entry) return false;
  if (entry.kind === "scalar") return entry.value_schema?.entry_content === true;
  if (entry.kind === "task") return entry.value_schema?.[action]?.entry_content === true;
  return false;
}

export function validateSelectionLiteral(text) {
  if (typeof text !== "string" || text.length === 0) {
    return issue("ordinary_field_selection_empty", "selection.text must be nonempty", "ordinary_field.selection.text");
  }
  if (!isUnicodeScalarString(text)) {
    return issue("ordinary_field_selection_unicode_invalid", "selection.text must contain only Unicode scalar values", "ordinary_field.selection.text");
  }
  if (utf8Length(text) > WORK_RECORD_SELECTION_MAX_UTF8_BYTES) {
    return issue(
      "ordinary_field_selection_too_large",
      `selection.text must be at most ${WORK_RECORD_SELECTION_MAX_UTF8_BYTES} UTF-8 bytes`,
      "ordinary_field.selection.text"
    );
  }
  return null;
}

export function validateWorkRecordEntryTitle(value, { required = false, path = "title" } = {}) {
  if (value === undefined && !required) return null;
  if (typeof value !== "string" || value.length === 0 || !isUnicodeScalarString(value) ||
      Array.from(value).length > WORK_RECORD_ENTRY_TITLE_MAX_SCALARS ||
      utf8Length(value) > WORK_RECORD_ENTRY_TITLE_MAX_UTF8_BYTES) return issue(
    "work_record_entry_title_invalid",
    `title must be nonempty and fit ${WORK_RECORD_ENTRY_TITLE_MAX_SCALARS} scalars/${WORK_RECORD_ENTRY_TITLE_MAX_UTF8_BYTES} UTF-8 bytes`,
    path
  );
  return null;
}

export function validateWorkRecordEntryKind(value, { path = "kind" } = {}) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !isUnicodeScalarString(value) ||
      Array.from(value).length > WORK_RECORD_ENTRY_KIND_MAX_SCALARS ||
      utf8Length(value) > WORK_RECORD_ENTRY_KIND_MAX_UTF8_BYTES) return issue(
    "work_record_entry_kind_invalid",
    `kind must fit ${WORK_RECORD_ENTRY_KIND_MAX_SCALARS} scalars/${WORK_RECORD_ENTRY_KIND_MAX_UTF8_BYTES} UTF-8 bytes`,
    path
  );
  return null;
}

export function validateWorkRecordEntries(entries, { path = "sections.entries" } = {}) {
  if (entries === undefined) return [];
  const diagnostics = [];
  if (!Array.isArray(entries)) return [issue("work_record_entries_invalid", "entries must be an array", path)];
  const ids = new Set();
  for (const [index, entry] of entries.entries()) {
    const itemPath = `${path}[${index}]`;
    const receiptBearing = Boolean(entry && typeof entry === "object" && Object.hasOwn(entry, "receipt"));
    if (!exactObjectKeys(entry, receiptBearing ? ["id", "current_version", "versions", "receipt"]
      : ["id", "current_version", "versions"]) ||
        !Number.isSafeInteger(entry.id) || entry.id <= 0 || ids.has(entry.id) ||
        !Number.isSafeInteger(entry.current_version) || entry.current_version <= 0 ||
        !Array.isArray(entry.versions) || entry.versions.length === 0) {
      diagnostics.push(issue("work_record_entry_invalid", "entry identity, current version, and immutable versions are required", itemPath)); continue;
    }
    ids.add(entry.id); let current = false; const versions = new Set();
    const historicalVersions = new Set(); let appended = false;
    for (const [vIndex, version] of entry.versions.entries()) {
      const vPath = `${itemPath}.versions[${vIndex}]`;
      const format = workRecordEntryVersionFormat(entry, version);
      if (format === null || (format === "historical" && appended) ||
          !Number.isSafeInteger(version.id) || version.id <= 0 || versions.has(version.id) ||
          typeof version.title !== "string" || typeof version.kind !== "string" ||
          (format === "current" && (!Number.isSafeInteger(version.scalar_length) || version.scalar_length < 0 ||
            !Number.isSafeInteger(version.utf8_bytes) || version.utf8_bytes < 0)) ||
          !version.provenance || typeof version.provenance !== "object" || Array.isArray(version.provenance)) {
        diagnostics.push(issue("work_record_entry_version_invalid", "entry versions must be closed immutable values", vPath)); continue;
      }
      if (format === "historical") historicalVersions.add(version.id); else appended = true;
      versions.add(version.id); current ||= version.id === entry.current_version;
      const shape = validateWorkRecordEntryContent(version.content, { path: `${vPath}.content` });
      if (!shape.ok) diagnostics.push(shape.diagnostic);
      const titleIssue = validateWorkRecordEntryTitle(version.title, { required: true, path: `${vPath}.title` });
      const kindIssue = validateWorkRecordEntryKind(version.kind, { path: `${vPath}.kind` });
      if (titleIssue) diagnostics.push(titleIssue);
      if (kindIssue) diagnostics.push(kindIssue);
    }
    if (receiptBearing && (!exactObjectKeys(entry.receipt, HISTORICAL_RECEIPT_KEYS) ||
        typeof entry.receipt.request_key !== "string" || entry.receipt.request_key.length === 0 ||
        typeof entry.receipt.fingerprint !== "string" ||
        !historicalVersions.has(entry.receipt.version_id))) {
      diagnostics.push(issue("work_record_entry_receipt_invalid",
        "a historical receipt is exactly {request_key,fingerprint,version_id} naming a retained historical version",
        `${itemPath}.receipt`));
    }
    if (!current) diagnostics.push(issue("work_record_entry_current_version_missing", "current_version must name a retained version", itemPath));
  }
  return diagnostics;
}

export function validateWorkRecordEntryPopulation(record) {
  const diagnostics = [];
  const seen = new Map();
  const units = [{ unit: record, path: "sections.entries" },
    ...(Array.isArray(record?.slices) ? record.slices.map((unit, index) =>
      ({ unit, path: `slices[${index}].sections.entries` })) : [])];
  for (const { unit, path } of units) {
    const entries = unit?.sections?.entries;
    if (!Array.isArray(entries)) continue;
    for (const [index, entry] of entries.entries()) {
      if (!Number.isSafeInteger(entry?.id)) continue;
      if (seen.has(entry.id)) diagnostics.push(issue(
        "work_record_entry_identity_duplicate",
        `entry id ${entry.id} is already owned at ${seen.get(entry.id)}`,
        `${path}[${index}].id`
      ));
      else seen.set(entry.id, `${path}[${index}]`);
    }
  }
  return diagnostics;
}

export function preservesWorkRecordEntryHistory(persistedRecord, proposedRecord) {
  const units = record => [{ address: record?.id, unit: record },
    ...(Array.isArray(record?.slices) ? record.slices.map(unit =>
      ({ address: `${record.id}#${unit.id}`, unit })) : [])];
  const proposedUnits = new Map(units(proposedRecord).map(value => [value.address, value.unit]));
  for (const { address, unit } of units(persistedRecord)) {
    const priorEntries = unit?.sections?.entries;
    if (!Array.isArray(priorEntries) || priorEntries.length === 0) continue;
    const nextEntries = proposedUnits.get(address)?.sections?.entries;
    if (!Array.isArray(nextEntries)) return false;
    for (const prior of priorEntries) {
      const next = nextEntries.find(entry => entry?.id === prior.id);
      if (!next || !Array.isArray(next.versions) || next.versions.length < prior.versions.length) return false;
      if (JSON.stringify(next.receipt) !== JSON.stringify(prior.receipt)) return false;
      for (let index = 0; index < prior.versions.length; index += 1) {
        if (JSON.stringify(next.versions[index]) !== JSON.stringify(prior.versions[index])) return false;
      }
      if (next.versions.length === prior.versions.length) {
        if (next.current_version !== prior.current_version) return false;
      } else if (next.versions.length === prior.versions.length + 1) {
        if (next.current_version !== next.versions.at(-1)?.id ||
            workRecordEntryVersionFormat({}, next.versions.at(-1)) !== "current") return false;
      } else {
        return false;
      }
    }
  }

  const priorIds = new Set(units(persistedRecord).flatMap(({ unit }) =>
    Array.isArray(unit?.sections?.entries) ? unit.sections.entries.map(entry => entry?.id) : []));
  for (const { unit } of units(proposedRecord)) {
    for (const entry of Array.isArray(unit?.sections?.entries) ? unit.sections.entries : []) {
      if (!priorIds.has(entry?.id) && isHistoricalWorkRecordEntryShape(entry)) return false;
    }
  }
  return true;
}
