import { createHash } from "node:crypto";
import { getRecordKindSpec } from "./work-record-kind-registry.mjs";

export const SEARCH_PASSAGE_PROJECTION_VERSION = 2;

export function scalarLength(value) {
  return Array.from(String(value)).length;
}

export function sliceScalars(value, offset, length) {
  return Array.from(String(value)).slice(offset, offset + length).join("");
}

function stableId(parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
}

function markdownBodyStart(markdown, body) {
  const offset = markdown.length - body.length;
  if (offset < 0 || markdown.slice(offset) !== body) {
    throw new Error("Parsed Markdown body is not a suffix of captured source");
  }
  return offset;
}

export function projectMarkdownPassages({ capture, page, pageKind, retrievalFacets }) {
  const body = page.body;
  const bodyStart = markdownBodyStart(capture.text, body);
  const headings = [...body.matchAll(/^(#{2,6})[ \t]+(.+?)[ \t]*\r?$/gmu)];
  const boundaries = headings.map((match) => ({
    start: match.index,
    heading: match[2].trim()
  }));
  if (boundaries.length === 0 || boundaries[0].start > 0) {
    boundaries.unshift({ start: 0, heading: "Overview" });
  }
  return boundaries.map((boundary, ordinal) => {
    const end = boundaries[ordinal + 1]?.start ?? body.length;
    const originalText = body.slice(boundary.start, end);
    return makePassage({
      capture,
      pageKind,
      title: page.title,
      heading: boundary.heading,
      frontmatter: page.frontmatter ?? {},
      retrievalFacets,
      originalText,
      location: {
        kind: "markdown_section",
        section_ordinal: ordinal,
        source_code_unit_start: bodyStart + boundary.start,
        source_code_unit_end: bodyStart + end
      }
    });
  }).filter((passage) => passage.originalText.length > 0 || boundaries.length === 1);
}

function recordSectionFields(kind) {
  return Object.keys(getRecordKindSpec(kind)?.sectionSpec ?? {});
}

function collectStrings(value, pointer, output) {
  if (typeof value === "string") {
    output.push({ pointer, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStrings(entry, `${pointer}/${index}`, output));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => collectStrings(entry, `${pointer}/${escapePointer(key)}`, output));
  }
}

function escapePointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function projectCanonicalRecordPassages({ capture, record, pageKind, retrievalFacets, kind }) {
  const strings = [];
  collectStrings(record.title, "/title", strings);
  const sectionFields = recordSectionFields(kind);
  for (const key of sectionFields) {
    collectStrings(record.sections?.[key], `/sections/${key}`, strings);
  }
  if (kind === "work_item") {
    collectStrings(record.acceptance, "/acceptance", strings);
    (record.slices ?? []).forEach((slice, sliceIndex) => {
      collectStrings(slice.title, `/slices/${sliceIndex}/title`, strings);
      collectStrings(slice.acceptance, `/slices/${sliceIndex}/acceptance`, strings);
      for (const key of sectionFields) {
        collectStrings(slice.sections?.[key], `/slices/${sliceIndex}/sections/${key}`, strings);
      }
    });
  }
  if (strings.length === 0) strings.push({ pointer: "/title", value: String(record.title ?? record.id ?? "") });
  return strings.map(({ pointer, value }, ordinal) => makePassage({
    capture,
    pageKind,
    title: String(record.title ?? record.id ?? ""),
    heading: pointer,
    frontmatter: recordFrontmatter(record, kind),
    retrievalFacets,
    originalText: value,
    location: { kind: "json_scalar", pointer, occurrence_ordinal: ordinal }
  }));
}

function recordFrontmatter(record, kind) {
  return Object.fromEntries(Object.entries({
    id: record.id,
    type: record.record_kind ?? record.type ?? kind,
    status: record.status,
    priority: record.priority,
    owner: record.owner,
    owners: record.owners,
    area: record.area,
    initiative: record.initiative
  }).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function makePassage({ capture, pageKind, title, heading, frontmatter, retrievalFacets, originalText, location }) {
  const sourceId = stableId([capture.relativePath, location]);
  return {
    chunkId: `${capture.relativePath}#${sourceId}`,
    sourceId,
    pageKind,
    relativePath: capture.relativePath,
    title,
    heading,
    originalText,
    text: originalText,
    sourceDigest: capture.digest,
    sourceByteLength: capture.byteLength,
    scalarLength: scalarLength(originalText),
    location,
    frontmatter,
    retrievalFacets
  };
}

function lowercaseWithScalarOwners(value) {
  const lowered = [];
  const owners = [];
  Array.from(String(value)).forEach((scalar, scalarIndex) => {
    const lower = scalar.toLocaleLowerCase();
    lowered.push(lower);
    for (let unit = 0; unit < lower.length; unit += 1) owners.push(scalarIndex);
  });
  return { text: lowered.join(""), owners };
}

export function findPassageMatchRange(text, query, queryTokens) {
  const lowered = lowercaseWithScalarOwners(text);
  const candidates = [lowercaseWithScalarOwners(query).text, ...queryTokens]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  for (const candidate of candidates) {
    const codeUnitIndex = lowered.text.indexOf(candidate);
    if (codeUnitIndex < 0) continue;
    const start = lowered.owners[codeUnitIndex];
    const end = lowered.owners[codeUnitIndex + candidate.length - 1] + 1;
    return { offset: start, length: end - start };
  }
  return { offset: 0, length: Math.min(1, scalarLength(text)) };
}
