import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  loadCanonicalState,
  readMarkdownPage,
  resolveContractContext
} from "../lib/wiki.mjs";
import {
  WORK_RECORD_DIRECTORY_NAME,
  loadWorkRecordById,
  loadWorkRecordByPath
} from "../lib/work-record-store.mjs";
import {
  TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES,
  calculateSliceAgentNotesBytes,
  shouldSuppressTrackerSliceDetail
} from "../lib/work-record-projection-helpers.mjs";
import { projectSelectedWorkRecordUnit } from "../lib/work-record-selected-unit-projection.mjs";

const WORK_RECORD_ID_PATTERN = /^(WK|IN|DEC|SRC)-\d+$/;
const WORK_RECORD_RELATIVE_PREFIX = `${WORK_RECORD_DIRECTORY_NAME}/`;
const WORK_RECORD_JSON_RELATIVE_PATH_PATTERN =
  /^wiki\/work-records\/WK-[0-9]{4}\.json$/;

const GRAPH_EVIDENCE_RELATIVE_PATH_PATTERN =
  /^wiki\/work-records\/evidence\/WK-[0-9]{4}\.graph\.json$/;
const WORK_RECORD_NAMESPACE_CLAIM_PATTERN =
  /^(?:\.\/)?wiki\/+work-records(?:\/|$)/;
const COMPACT_DIAGNOSTICS_LIMIT = 5;
const COMPACT_LINKS_LIMIT = 5;
const EXTERNAL_URL_PATTERN = /^https?:\/\//i;
const WORKING_SLICES_LIMIT = 30;

function isWorkRecordId(value) {
  return WORK_RECORD_ID_PATTERN.test(String(value));
}

function claimsReservedWorkRecordNamespace(value) {
  const normalized = path.posix.normalize(String(value));
  return normalized === WORK_RECORD_DIRECTORY_NAME ||
    normalized.startsWith(WORK_RECORD_RELATIVE_PREFIX);
}

function missingWikiRecordError(normalizedId) {
  const message = `Wiki record not found: ${normalizedId}`;
  const error = new Error(message);
  error.envelope = {
    error: true,
    code: "missing_json_record",
    record_id: normalizedId,
    message
  };
  return error;
}

function isWorkRecordJsonRelativePath(relativePath) {
  return WORK_RECORD_JSON_RELATIVE_PATH_PATTERN.test(relativePath);
}

function isGraphEvidenceSidecarRelativePath(relativePath) {
  return GRAPH_EVIDENCE_RELATIVE_PATH_PATTERN.test(relativePath);
}

function normalizeRelativeRepoPath(targetDir, requestedPath) {
  if (!requestedPath) {
    throw new Error("readWikiPage requires path");
  }

  const requestedPathText = String(requestedPath);
  const requestedRelativePath = requestedPathText.trim().replace(/^\.\//, "");
  if (
    !path.isAbsolute(requestedPathText) &&
    (
      WORK_RECORD_NAMESPACE_CLAIM_PATTERN.test(requestedPathText.trim()) ||
      claimsReservedWorkRecordNamespace(requestedPathText.trim())
    ) &&
    !WORK_RECORD_JSON_RELATIVE_PATH_PATTERN.test(requestedRelativePath) &&
    !GRAPH_EVIDENCE_RELATIVE_PATH_PATTERN.test(requestedRelativePath)
  ) {
    throw new Error(`Malformed reserved work-record path: ${requestedPath}`);
  }

  const targetRoot = path.resolve(targetDir);
  const absolutePath = path.isAbsolute(requestedPathText)
    ? path.resolve(requestedPathText)
    : path.resolve(targetRoot, requestedPathText);
  const relativePath = path.relative(targetRoot, absolutePath).replaceAll(path.sep, "/");

  if (relativePath.startsWith("../") || relativePath === ".." || path.isAbsolute(relativePath)) {
    throw new Error(`Path escapes target repository: ${requestedPath}`);
  }

  return { absolutePath, relativePath };
}

function ensureReadablePathSuffix(relativePath, requestedPath) {
  if (relativePath.endsWith(".md")) {
    return;
  }
  if (isGraphEvidenceSidecarRelativePath(relativePath)) {
    return;
  }
  if (isWorkRecordJsonRelativePath(relativePath)) {
    return;
  }
  if (relativePath.startsWith(WORK_RECORD_RELATIVE_PREFIX)) {
    throw new Error(`Malformed reserved work-record path: ${requestedPath}`);
  }
  throw new Error(`Only markdown pages can be read: ${requestedPath}`);
}

function normalizeMarkdownLink(link, targetDir) {
  if (!link || typeof link !== "string") {
    return link;
  }
  if (EXTERNAL_URL_PATTERN.test(link)) {
    return link;
  }
  const linkWithoutFragment = link.split("#")[0];
  if (!linkWithoutFragment || !path.isAbsolute(linkWithoutFragment)) {
    return link;
  }
  const repoRoot = path.resolve(targetDir);
  const rel = path.relative(repoRoot, linkWithoutFragment).replaceAll(path.sep, "/");
  if (rel.startsWith("../") || rel === "..") {
    return link;
  }
  const fragment = link.indexOf("#") !== -1 ? link.slice(link.indexOf("#")) : "";
  return rel + fragment;
}

function normalizeMarkdownLinks(links, targetDir) {
  if (!Array.isArray(links)) {
    return [];
  }
  return links.map((link) => normalizeMarkdownLink(link, targetDir));
}

function pageKindForPath(relativePath, extensionNamespaces = []) {
  if (relativePath.startsWith("docs/")) {
    return "docs";
  }
  if (relativePath.startsWith(WORK_RECORD_RELATIVE_PREFIX)) {
    return "work-records";
  }
  if (relativePath.startsWith("wiki/issues/")) {
    return "issues";
  }
  if (relativePath.startsWith("wiki/initiatives/")) {
    return "initiatives";
  }
  if (relativePath.startsWith("wiki/decisions/")) {
    return "decisions";
  }
  if (relativePath.startsWith("wiki/sources/")) {
    return "sources";
  }
  if (relativePath.startsWith("wiki/areas/")) {
    return "areas";
  }
  for (const namespace of extensionNamespaces) {
    if (relativePath.startsWith(`wiki/${namespace}/`)) {
      return namespace;
    }
  }
  if (relativePath.startsWith("wiki/")) {
    return "wiki";
  }
  return "unknown";
}

function resolveReadOptions(opts = {}) {
  const verbose = opts.verbose === true;
  return {
    include_record: verbose || opts.include_record === true,
    include_body: verbose || opts.include_body === true,
    include_raw: verbose || opts.include_raw === true,
    include_links: verbose || opts.include_links === true
  };
}

function buildSliceCounts(slices) {
  const by_status = {};
  for (const s of slices) {
    const st = s.status ?? "unknown";
    by_status[st] = (by_status[st] || 0) + 1;
  }
  return { total: slices.length, by_status };
}

function buildTrackerSliceDetailOmissionMetadata(slices, includedSlices, returnedSlices) {
  const suppressedByStatus = {};
  let suppressedTotal = 0;
  for (const status of TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES) {
    suppressedByStatus[status] = 0;
  }
  for (const slice of slices) {
    if (!shouldSuppressTrackerSliceDetail(slice)) {
      continue;
    }
    const status = slice.status ?? "unknown";
    suppressedByStatus[status] = (suppressedByStatus[status] || 0) + 1;
    suppressedTotal += 1;
  }

  const currentSlicesOmittedCount = Math.max(0, includedSlices.length - returnedSlices.length);
  return {
    suppressed_statuses: TRACKER_SLICE_DETAIL_SUPPRESSED_STATUSES,
    suppressed_total: suppressedTotal,
    suppressed_by_status: suppressedByStatus,
    current_slices_total: includedSlices.length,
    current_slices_returned: returnedSlices.length,
    current_slices_limit: WORKING_SLICES_LIMIT,
    current_slices_truncated: currentSlicesOmittedCount > 0,
    current_slices_omitted_count: currentSlicesOmittedCount
  };
}

function summarizeWorkingSlice(slice) {
  const criteria = slice.acceptance?.criteria;
  const validation = slice.acceptance?.validation;
  return {
    id: slice.id,
    title: slice.title ?? null,
    status: slice.status ?? null,
    work_kind: slice.work_kind ?? null,
    depends_on: Array.isArray(slice.depends_on) ? slice.depends_on : [],
    acceptance_criteria_count: Array.isArray(criteria) ? criteria.length : 0,
    validation_count: Array.isArray(validation) ? validation.length : 0,
    agent_notes_bytes: calculateSliceAgentNotesBytes(slice)
  };
}

function projectSelectedSlice(slices, sliceId) {
  const slice = Array.isArray(slices) ? slices.find((s) => s.id === sliceId) : null;
  if (!slice) return null;
  return projectSelectedWorkRecordUnit(slice);
}

function serializeMarkdownPage(page, { raw, pageKind, targetDir, include_body = false, include_raw = false, include_links = false }) {
  const allBacklinks = Array.isArray(page.backlinks) ? page.backlinks : [];
  const rawMarkdownLinks = normalizeMarkdownLinks(page.markdownLinks, targetDir ?? ".");
  const allMarkdownLinks = rawMarkdownLinks;
  const backlinks = include_links ? allBacklinks : allBacklinks.slice(0, COMPACT_LINKS_LIMIT);
  const markdownLinks = include_links ? allMarkdownLinks : allMarkdownLinks.slice(0, COMPACT_LINKS_LIMIT);

  const isCompactDefault = !include_body && !include_raw && !include_links;

  const result = {
    format: "markdown",
    relativePath: page.relativePath,
    pageKind: isCompactDefault ? undefined : pageKind,
    title: page.title,
    id: page.frontmatter?.id || null,
    frontmatter: page.frontmatter,
    backlink_count: allBacklinks.length,
    backlinks,
    backlinks_truncated: !include_links && allBacklinks.length > COMPACT_LINKS_LIMIT,
    markdown_link_count: allMarkdownLinks.length,
    markdownLinks,
    markdownLinks_truncated: !include_links && allMarkdownLinks.length > COMPACT_LINKS_LIMIT
  };
  if (include_body) {
    result.absolutePath = page.path;
    result.body = page.body;
  }
  if (include_raw) {
    result.markdown = raw;
  }
  return result;
}

function serializeJsonWorkRecord(workRecord, { absolutePath, relativePath, raw, pageKind, include_record = false, include_raw = false, selected_slice = null }) {
  const title = workRecord.record?.title || workRecord.record_id || null;
  const rec = workRecord.record ?? {};
  const result = {
    format: "json-work-record",
    relativePath,
    pageKind,
    record_id: workRecord.record_id,
    title,
    status: rec.status ?? null,
    work_kind: rec.work_kind ?? null,
    record_kind: rec.record_kind ?? null,
    initiative: rec.initiative ?? null,
    owner: rec.owner ?? null,
    priority: rec.priority ?? null,
    valid: workRecord.valid,
    diagnostics: include_record
      ? (workRecord.diagnostics ?? [])
      : (workRecord.diagnostics ?? []).slice(0, COMPACT_DIAGNOSTICS_LIMIT)
  };

  if (!include_record) {
    const slices = Array.isArray(rec.slices) ? rec.slices : [];
    if (selected_slice == null && rec.work_kind === "tracker" && slices.length > 0) {
      const includedSlices = slices.filter((s) => !shouldSuppressTrackerSliceDetail(s));
      const returnedSlices = includedSlices.slice(0, WORKING_SLICES_LIMIT);
      result.slice_counts = buildSliceCounts(slices);
      result.slice_detail_omissions = buildTrackerSliceDetailOmissionMetadata(
        slices,
        includedSlices,
        returnedSlices
      );
      result.working_slices = returnedSlices.map(summarizeWorkingSlice);
    }
    if (selected_slice != null) {
      result.selected_slice_id = selected_slice;
      const found = projectSelectedSlice(slices, selected_slice);
      result.selected_slice = found;
      result.selected_slice_found = found !== null;
    }
  }

  if (include_record) {
    result.id = workRecord.record_id;
    result.source_path_relative = workRecord.source_path_relative ?? relativePath;
    result.source_digest = workRecord.source_digest ?? null;
    result.absolutePath = absolutePath;
    result.source_path = workRecord.source_path;
    result.record = workRecord.record;
    result.duplicate_claims = workRecord.duplicate_claims;
    result.markdown = null;
  }
  if (include_raw) {
    result.json = raw;
  }
  return result;
}

async function readWorkRecordJsonByPath(targetDir, absolutePath, relativePath, pageKind, { include_record = false, include_raw = false, selected_slice = null } = {}) {
  const workRecord = await loadWorkRecordByPath({ dir: targetDir, path: absolutePath });
  const missing = workRecord.diagnostics.some(
    (entry) => entry.code === "missing_json_record"
  );
  if (missing && !workRecord.record) {
    throw new Error(`Wiki record path not found: ${relativePath}`);
  }
  const raw = include_raw ? await readFile(absolutePath, "utf8") : null;
  return serializeJsonWorkRecord(workRecord, {
    absolutePath,
    relativePath,
    raw,
    pageKind,
    include_record,
    include_raw,
    selected_slice
  });
}

const GRAPH_EVIDENCE_SIDECAR_PAGE_KIND = "work-records-graph-evidence";

function computeGraphSidecarDigest(rawText) {
  const hash = createHash("sha256");
  hash.update(rawText);
  return `sha256:${hash.digest("hex")}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function summarizeGraphSidecarEntry(entry) {
  if (!isPlainObject(entry)) {
    return null;
  }
  return {
    unit_address: isPlainObject(entry.unit) ? (entry.unit.address ?? null) : null,
    graph_entry_digest: entry.graph_entry_digest ?? null,
    replay_detail_available: entry.replay_detail_available === true
  };
}

function summarizeGraphSidecarRecordEntry(recordEntry) {
  const summary = summarizeGraphSidecarEntry(recordEntry);
  if (summary === null) {
    return { available: false };
  }
  return { available: true, ...summary };
}

function buildGraphSidecarHeader(sidecar, { relativePath, graphSidecarDigest }) {
  return {
    format: "graph-evidence-sidecar",
    relativePath,
    pageKind: GRAPH_EVIDENCE_SIDECAR_PAGE_KIND,
    schema_version: isPlainObject(sidecar) ? (sidecar.schema_version ?? null) : null,
    record_id: isPlainObject(sidecar) ? (sidecar.record_id ?? null) : null,
    generated_at: isPlainObject(sidecar) ? (sidecar.generated_at ?? null) : null,
    updated_at: isPlainObject(sidecar) ? (sidecar.updated_at ?? null) : null,

    graph_sidecar_digest: graphSidecarDigest
  };
}

function serializeGraphEvidenceSidecar(sidecar, {
  relativePath,
  raw,
  rawText,
  include_record = false,
  include_raw = false,
  selected_slice = null,
  selected_record = false
}) {
  const graphSidecarDigest = computeGraphSidecarDigest(rawText);
  const header = buildGraphSidecarHeader(sidecar, { relativePath, graphSidecarDigest });
  const slicesMap = isPlainObject(sidecar) && isPlainObject(sidecar.slices) ? sidecar.slices : {};
  const recordEntry = isPlainObject(sidecar) ? sidecar.record ?? null : null;

  let result;
  if (include_record) {

    result = { ...header, sidecar };
  } else if (selected_record === true) {

    result = {
      ...header,
      selected_record: true,
      record_entry: isPlainObject(recordEntry) ? recordEntry : null,
      record_entry_found: isPlainObject(recordEntry)
    };
  } else if (selected_slice != null) {

    const entry = Object.prototype.hasOwnProperty.call(slicesMap, selected_slice)
      ? slicesMap[selected_slice]
      : null;
    result = {
      ...header,
      selected_slice_id: selected_slice,
      selected_slice: isPlainObject(entry) ? entry : null,
      selected_slice_found: isPlainObject(entry)
    };
  } else {

    const sliceIds = Object.keys(slicesMap);
    result = {
      ...header,
      record_entry: summarizeGraphSidecarRecordEntry(recordEntry),
      slice_count: sliceIds.length,
      slices: sliceIds.map((sliceId) => ({
        slice_id: sliceId,
        ...summarizeGraphSidecarEntry(slicesMap[sliceId])
      }))
    };
  }

  if (include_raw) {
    result.json = raw;
  }
  return result;
}

async function readGraphEvidenceSidecarByPath(absolutePath, relativePath, {
  include_record = false,
  include_raw = false,
  selected_slice = null,
  selected_record = false
} = {}) {
  if (selected_slice != null && selected_record === true) {
    throw new Error(
      "selected_slice and selected_record are mutually exclusive for graph-evidence sidecar reads"
    );
  }

  let rawText;
  try {
    rawText = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`Graph evidence sidecar not found: ${relativePath}`);
    }
    throw error;
  }

  let sidecar;
  try {
    sidecar = JSON.parse(rawText);
  } catch {
    throw new Error(`Graph evidence sidecar is not valid JSON: ${relativePath}`);
  }

  return serializeGraphEvidenceSidecar(sidecar, {
    relativePath,
    raw: include_raw ? rawText : null,
    rawText,
    include_record,
    include_raw,
    selected_slice,
    selected_record
  });
}

export async function readWikiPage({
  dir = ".",
  path: requestedPath,
  profile = null,
  extensionNamespaces = null,
  verbose = false,
  include_body = false,
  include_raw = false,
  include_record = false,
  include_links = false,
  selected_slice = null,
  selected_record = false
} = {}) {
  const targetDir = path.resolve(String(dir));
  const opts = resolveReadOptions({ verbose, include_body, include_raw, include_record, include_links });
  const context = await resolveContractContext(targetDir, {
    profile,
    extensionNamespaces
  });
  const { absolutePath, relativePath } = normalizeRelativeRepoPath(
    targetDir,
    requestedPath
  );
  ensureReadablePathSuffix(relativePath, requestedPath);

  const pageKind = pageKindForPath(relativePath, context.extensionNamespaces);

  if (isGraphEvidenceSidecarRelativePath(relativePath)) {
    return await readGraphEvidenceSidecarByPath(absolutePath, relativePath, {
      include_record: opts.include_record,
      include_raw: opts.include_raw,
      selected_slice: opts.include_record ? null : (selected_slice ?? null),
      selected_record: opts.include_record ? false : (selected_record === true)
    });
  }

  if (isWorkRecordJsonRelativePath(relativePath)) {
    return await readWorkRecordJsonByPath(targetDir, absolutePath, relativePath, pageKind, {
      include_record: opts.include_record,
      include_raw: opts.include_raw,
      selected_slice: opts.include_record ? null : (selected_slice ?? null)
    });
  }

  const raw = opts.include_raw ? await readFile(absolutePath, "utf8") : null;
  const page = await readMarkdownPage(targetDir, absolutePath);

  return serializeMarkdownPage(page, {
    raw,
    pageKind,
    targetDir,
    include_body: opts.include_body,
    include_raw: opts.include_raw,
    include_links: opts.include_links
  });
}

export async function getWikiRecord({
  dir = ".",
  id,
  profile = null,
  extensionNamespaces = null,
  verbose = false,
  include_record = false,
  include_body = false,
  include_raw = false,
  include_links = false,
  selected_slice = null
} = {}) {
  if (!id) {
    throw new Error("getWikiRecord requires id");
  }

  const targetDir = path.resolve(String(dir));
  const opts = resolveReadOptions({ verbose, include_record, include_body, include_raw, include_links });
  const context = await resolveContractContext(targetDir, {
    profile,
    extensionNamespaces
  });
  const normalizedId = String(id);

  if (isWorkRecordId(normalizedId)) {
    const workRecord = await loadWorkRecordById({ dir: targetDir, id: normalizedId });
    if (workRecord.record) {
      const absolutePath = workRecord.source_path;
      const relativePath = workRecord.source_path_relative;
      const raw = opts.include_raw ? await readFile(absolutePath, "utf8") : null;
      return serializeJsonWorkRecord(workRecord, {
        absolutePath,
        relativePath,
        raw,
        pageKind: "work-records",
        include_record: opts.include_record,
        include_raw: opts.include_raw,
        selected_slice: opts.include_record ? null : (selected_slice ?? null)
      });
    }
  }

  const state = await loadCanonicalState(targetDir, {
    extensionNamespaces: context.extensionNamespaces
  });
  const records = [
    ...state.issues,
    ...state.initiatives,
    ...state.decisions,
    ...state.sources,
    ...state.areas
  ];
  const page = records.find(
    (candidate) => String(candidate.frontmatter?.id || "") === normalizedId
  );

  if (page) {
    const raw = opts.include_raw ? await readFile(page.path, "utf8") : null;
    return serializeMarkdownPage(page, {
      raw,
      pageKind: pageKindForPath(page.relativePath, context.extensionNamespaces),
      targetDir,
      include_body: opts.include_body,
      include_raw: opts.include_raw,
      include_links: opts.include_links
    });
  }

  if (isWorkRecordId(normalizedId)) {
    const workRecord = await loadWorkRecordById({ dir: targetDir, id: normalizedId });
    if (workRecord.record) {
      const absolutePath = workRecord.source_path;
      const relativePath = workRecord.source_path_relative;
      const raw = opts.include_raw ? await readFile(absolutePath, "utf8") : null;
      return serializeJsonWorkRecord(workRecord, {
        absolutePath,
        relativePath,
        raw,
        pageKind: "work-records",
        include_record: opts.include_record,
        include_raw: opts.include_raw,
        selected_slice: opts.include_record ? null : (selected_slice ?? null)
      });
    }
  }

  throw missingWikiRecordError(normalizedId);
}
