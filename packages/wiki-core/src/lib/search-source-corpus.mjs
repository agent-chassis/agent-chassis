import path from "node:path";
import { readdir } from "node:fs/promises";
import { loadManifest } from "./contract.mjs";
import { parseMarkdownPage, walkMarkdownFiles } from "./wiki-page.mjs";
import { resolveContractContext, resolvePageFacets, GENERATED_VIEW_NAMES } from "./wiki.mjs";
import { parseWorkRecordJson, validateWorkRecord } from "./work-record-schema.mjs";
import { validateRecordByKind } from "./work-record-kind-registry.mjs";
import { loadWorkRecordById } from "./work-record-store.mjs";
import { projectWorkRecordEntrySearchSources } from "./work-record-entry-projection.mjs";
import { captureSearchSource, digestSearchProjectionContext } from "./search-source-reader.mjs";
import { projectCanonicalRecordPassages, projectMarkdownPassages, SEARCH_PASSAGE_PROJECTION_VERSION } from "./search-passages.mjs";

const CAPTURED_WORK_RECORD_PATTERN = /^wiki\/work-records\/WK-[0-9]{4}\.json$/u;

export async function projectCapturedWorkRecordEntrySources(targetDir, capturedCorpus, {
  repository,
  history = false
}) {
  const root = path.resolve(targetDir);
  const captures = new Map(capturedCorpus.captures
    .filter((capture) => CAPTURED_WORK_RECORD_PATTERN.test(capture.relativePath))
    .map((capture) => [capture.relativePath, capture]));
  const capturedPath = (filePath) => path.relative(root, path.resolve(String(filePath))).split(path.sep).join("/");
  const recordStore = {
    async readText(filePath) {
      const capture = captures.get(capturedPath(filePath));
      if (!capture) {
        const error = new Error(`Work record is not part of the captured corpus: ${capturedPath(filePath)}`);
        error.code = "ENOENT";
        throw error;
      }
      return capture.text;
    },
    async pathExists(filePath) {
      return captures.has(capturedPath(filePath));
    }
  };
  const loads = new Map();
  const loadCapturedWorkRecordById = ({ id }) => {
    if (!loads.has(id)) loads.set(id, loadWorkRecordById({ dir: root, id, recordStore }));
    return loads.get(id);
  };

  const sources = [];
  const diagnostics = [];
  for (const [relativePath, capture] of captures) {
    const loaded = await loadCapturedWorkRecordById({ id: path.posix.basename(relativePath, ".json") });
    if (!loaded.valid || !loaded.record) continue;
    const projected = await projectWorkRecordEntrySearchSources({ record: loaded.record, repository,
      dir: root, history, loadWorkRecordById: loadCapturedWorkRecordById });
    for (const descriptor of projected.descriptors) {
      sources.push({ relativePath, sourceDigest: capture.digest, descriptor });
    }
    diagnostics.push(...projected.diagnostics);
  }
  return { sources, diagnostics };
}

async function jsonPaths(targetDir, directory, pattern) {
  let entries;
  try { entries = await readdir(path.join(targetDir, directory), { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  return entries.filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => `${directory}/${entry.name}`).sort();
}

async function markdownPaths(targetDir, directory) {
  return (await walkMarkdownFiles(path.join(targetDir, directory)))
    .map((file) => path.relative(targetDir, file).replaceAll(path.sep, "/"))
    .filter((file) => !GENERATED_VIEW_NAMES.has(path.posix.basename(file)));
}

function canonicalFacets(kind, record) {
  return {
    canonicality: "canonical",
    retrieval_role: ["record"],
    knowledge_role: kind === "decision" ? "decision" : "work",
    maintenance_mode: "operational",
    retrieval_visibility: "default",
    lifecycle: ["expired", "superseded"].includes(String(record.status)) ? "historical" : "active",
    sensitivity: "normal"
  };
}

export async function enumerateSearchSourcePaths(targetDir, { profile = null, extensionNamespaces = null } = {}) {
  const context = await resolveContractContext(targetDir, { profile, extensionNamespaces });
  const manifest = await loadManifest();
  const markdown = [
    ...(await markdownPaths(targetDir, "docs")),
    ...(await markdownPaths(targetDir, manifest.types.source.directory)),
    ...(await markdownPaths(targetDir, manifest.types.area.directory))
  ];
  let wikiEntries = [];
  try { wikiEntries = await readdir(path.join(targetDir, "wiki"), { withFileTypes: true }); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  markdown.push(...wikiEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !GENERATED_VIEW_NAMES.has(entry.name))
    .map((entry) => `wiki/${entry.name}`));
  for (const namespace of context.extensionNamespaces) markdown.push(...await markdownPaths(targetDir, `wiki/${namespace}`));

  const canonical = [
    ...(await jsonPaths(targetDir, "wiki/work-records", /^WK-[0-9]{4}\.json$/u)),
    ...(await jsonPaths(targetDir, manifest.types.initiative.directory, /^IN-[0-9]{4}\.json$/u)),
    ...(await jsonPaths(targetDir, manifest.types.decision.directory, /^DEC-[0-9]{4}\.json$/u))
  ];
  return {
    context,
    paths: [...new Set([...markdown, ...canonical])].sort(),
    contextDigest: digestResolvedSearchProjectionContext(context)
  };
}

export function digestResolvedSearchProjectionContext(context) {
  return digestSearchProjectionContext({
    projection: SEARCH_PASSAGE_PROJECTION_VERSION,
    profile: context.profile,
    extensionNamespaces: context.extensionNamespaces,
    inference: context.metadata?.inference ?? null
  });
}

export async function captureSearchSourceCorpus(targetDir, options = {}) {
  const census = await enumerateSearchSourcePaths(targetDir, options);
  const captures = [];
  for (const relativePath of census.paths) captures.push(await captureSearchSource(targetDir, relativePath));
  return {
    ...census,
    captures,
    totalSourceBytes: captures.reduce((total, capture) => total + capture.byteLength, 0),
    sourceDigests: Object.fromEntries(captures.map((capture) => [capture.relativePath, capture.digest]))
  };
}

export async function buildSearchSourceCorpus(targetDir, options = {}) {
  const census = options.capturedCorpus ?? await captureSearchSourceCorpus(targetDir, options);
  const sources = [];
  for (const capture of census.captures) {
    sources.push(await projectCapturedSearchSource(targetDir, capture, census.context));
  }
  return {
    context: census.context,
    contextDigest: census.contextDigest,
    sources,
    sourceDigests: census.sourceDigests,
    totalSourceBytes: census.totalSourceBytes,
    passages: sources.flatMap((source) => source.passages)
  };
}

export async function projectCapturedSearchSource(targetDir, capture, context) {
    const relativePath = capture.relativePath;
    if (relativePath.endsWith(".json")) {
      if (!/^wiki\/(?:work-records\/WK|initiatives\/IN|decisions\/DEC)-[0-9]{4}\.json$/u.test(relativePath)) {
        const error = new Error(`Unregistered JSON search source: ${relativePath}`);
        error.code = "search_source_unregistered_json";
        throw error;
      }
      const parsed = relativePath.startsWith("wiki/work-records/")
        ? parseWorkRecordJson(capture.text, { sourcePath: capture.absolutePath })
        : (() => { try { return { ok: true, value: JSON.parse(capture.text), diagnostics: [] }; } catch (error) { return { ok: false, diagnostics: [{ message: error.message }] }; } })();
      if (!parsed.ok) throw new Error(`Invalid canonical search source ${relativePath}: ${parsed.diagnostics.map((item) => item.message).join("; ")}`);
      const record = parsed.value;
      const diagnostics = relativePath.startsWith("wiki/work-records/")
        ? validateWorkRecord(record, { sourcePath: capture.absolutePath })
        : validateRecordByKind(record);
      if (diagnostics.some((item) => item.severity === "error")) {
        const error = new Error(`Invalid canonical search source ${relativePath}: ${diagnostics.filter((item) => item.severity === "error").map((item) => item.message).join("; ")}`);
        error.code = "search_source_invalid_canonical_record";
        throw error;
      }
      const kind = record.record_kind ?? "work_item";
      return { capture, record, passages: projectCanonicalRecordPassages({
        capture, record, kind,
        pageKind: kind === "initiative" ? "initiatives" : kind === "decision" ? "decisions" : "issues",
        retrievalFacets: canonicalFacets(kind, record)
      }) };
    }
    const page = parseMarkdownPage(targetDir, capture.absolutePath, capture.text);
    const relative = capture.relativePath;
    const pageKind = relative.startsWith("docs/") ? "docs"
      : relative.startsWith("wiki/sources/") ? "sources"
      : relative.startsWith("wiki/areas/") ? "areas"
      : relative.split("/").length >= 3 ? relative.split("/")[1] : "wiki";
    const retrievalFacets = resolvePageFacets(page, { manifest: context.manifest, metadata: context.metadata }).effective;
    return { capture, page, passages: projectMarkdownPassages({ capture, page, pageKind, retrievalFacets }) };
}
