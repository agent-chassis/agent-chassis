import path from "node:path";

import { readCommittedBlobBytes } from "./sidecar-committed-blobs.mjs";
import { compareSidecarCommittedTrees } from "./sidecar-committed-diff.mjs";
import { ensureSidecarIndex } from "./sidecar-ensure.mjs";
import { isSidecarGraphExtractionSourcePath } from "./sidecar-graph-extractors.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";
import {
  classifySidecarPreparation,
  isSidecarBaseInputPath,
  prepareSidecarIncrementalDelta,
  SIDECAR_EXTRACTION_BASIS
} from "./sidecar-incremental.mjs";
import { filterSidecarSourcePaths, isSidecarScipProviderInputPath } from "./sidecar-paths.mjs";
import {
  discoverSidecarScipProjects,
  runScipProjectsFromCommittedSnapshot,
  SCIP_STATUS_EXTRACTED,
  SCIP_STATUS_NOT_APPLICABLE,
  snapshotScipOptions
} from "./sidecar-scip-provision.mjs";
import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import {
  SIDECAR_DEFAULT_ARTIFACT_FILE,
  SIDECAR_DEFAULT_CACHE_DIR,
  resolveSidecarGeneratorIdentity,
  runSidecarGit
} from "./sidecar-status.mjs";
import { throwIfSidecarPreparationCancelled } from "./sidecar-store-lifecycle.mjs";
import { publishSidecarGraphCandidate } from "./sidecar-store.mjs";
import { publishPreparedDeltaInDatabase } from "./sidecar-store-publication.mjs";
import { binaryCompare } from "./sidecar-store-queries.mjs";
import { SIDECAR_STORE_SCHEMA_VERSION } from "./sidecar-store-schema.mjs";

const ZERO_METRICS = Object.freeze({
  parsed_files: 0, affected_units: 0, file_upserts: 0, file_deletes: 0,
  provider_projects_run: 0, provider_projects_reused: 0
});

export class SidecarBuildRefusalError extends Error {
  constructor(message, { code, envelope } = {}) {
    super(message);
    this.name = "SidecarBuildRefusalError";
    this.code = code;
    this.envelope = envelope;
  }
}

function parseTreeRecord(record) {
  const tab = record.indexOf("\t");
  const metadata = tab === -1 ? [] : record.slice(0, tab).split(" ");
  if (metadata.length !== 3) throw new Error(`invalid git ls-tree record: ${record}`);
  return { mode: metadata[0], type: metadata[1], blob_oid: metadata[2], path: record.slice(tab + 1) };
}

async function collectTrackedSources(repoRoot, commit) {
  const raw = await runSidecarGit(repoRoot,
    ["--no-replace-objects", "ls-tree", "-r", "-z", commit],
    { maxBuffer: 64 * 1024 * 1024 });
  const tracked = raw ? raw.split("\0").filter(Boolean).map(parseTreeRecord) : [];
  const filtered = filterSidecarSourcePaths(tracked.map(({ path: value }) => value));
  const included = new Set(filtered.included);
  const files = tracked.filter((entry) => included.has(entry.path) && entry.type === "blob")
    .map(({ path: value, mode, blob_oid }) => ({
      path: value, mode, blob_oid, input_identity: `${blob_oid}:${mode}`
    }));
  return {
    tracked_paths: tracked.map(({ path: value }) => value),
    tracked_count: tracked.length,
    files,
    source_count: files.length,
    symlink_count: files.filter(({ mode }) => mode === "120000").length,
    gitlink_count: tracked.filter((entry) => entry.mode === "160000" && included.has(entry.path)).length,
    rejected: filtered.rejected
  };
}

async function readPreparedSources(repoRoot, files, selectedPaths) {
  const selected = files.filter(({ path: value }) =>
    selectedPaths.has(value) && isSidecarGraphExtractionSourcePath(value));
  const objectIds = [...new Set(selected.map(({ blob_oid }) => blob_oid))];
  const bytes = await readCommittedBlobBytes({ repoRoot, objectIds });
  return selected.map((file) => {
    const entry = bytes.get(file.blob_oid.toLowerCase());
    if (entry?.state !== "available") {
      const error = new Error(`committed graph source is unavailable: ${file.path}`);
      error.code = entry?.reason ?? "committed_blob_unavailable";
      throw error;
    }
    return { path: file.path, content: entry.bytes.toString("utf8"),
      input_identity: file.input_identity };
  });
}

function symbolValue(nodeId) {
  return typeof nodeId === "string" && nodeId.startsWith("symbol:")
    ? nodeId.slice("symbol:".length)
    : null;
}

function providerRows(project, layer) {
  const provider_id = project.key;
  const symbols = (layer.graph_nodes ?? []).filter(({ kind }) => kind === "symbol").map((node) => ({
    provider_id, symbol_id: node.symbol, raw_symbol: node.symbol, document_path: null, payload: node
  }));
  const symbolKeys = new Set(symbols.map((entry) => entry.symbol_id));
  const ensureSymbol = (symbol) => {
    if (symbol && !symbolKeys.has(symbol)) {
      symbolKeys.add(symbol);
      symbols.push({ provider_id, symbol_id: symbol, raw_symbol: symbol,
        document_path: null, payload: { symbol } });
    }
  };
  const symbol_edges = [];
  for (const edge of layer.graph_edges ?? []) {
    if (!["defines_symbol", "references_symbol", "calls_symbol"].includes(edge.kind)) continue;
    const from = symbolValue(edge.from_node_id);
    const to = symbolValue(edge.to_node_id);
    ensureSymbol(from);
    ensureSymbol(to);
    symbol_edges.push({
      provider_id, edge_id: edge.id, kind: edge.kind, from_symbol: from, to_symbol: to,
      document_path: edge.path ?? null,
      line: Number.isSafeInteger(edge.line) ? edge.line : null, payload: edge
    });
  }
  const documentOrdinals = new Map();
  const occurrences = (layer.symbol_occurrences ?? []).map((occurrence) => {
    ensureSymbol(occurrence.symbol);
    const ordinal = documentOrdinals.get(occurrence.path) ?? 0;
    documentOrdinals.set(occurrence.path, ordinal + 1);
    return {
      provider_id, symbol_id: occurrence.symbol, document_path: occurrence.path,
      contribution_id: `document:${occurrence.path}`, document_ordinal: 0,
      occurrence_ordinal: ordinal,
      range: [occurrence.range.start_line, occurrence.range.start_character ?? 0,
        occurrence.range.end_line, occurrence.range.end_character ?? 0],
      roles: occurrence.symbol_roles ?? 0, payload: occurrence
    };
  });
  return { symbols, occurrences, symbol_edges };
}

function providerCoverageEntry(project, layer, inputCommit) {
  const coverage = layer.coverage ?? {};
  return {
    key: project.key, indexer: project.indexer, project: project.project,
    input_commit: inputCommit, descriptor: layer.provider_descriptor,
    document_count: coverage.document_count ?? 0,
    covered_document_count: coverage.covered_document_count ?? 0,
    occurrence_count: coverage.occurrence_count ?? 0,
    symbol_count: coverage.symbol_count ?? 0,
    call_graph_available: coverage.call_graph_available === true
  };
}

function providerCoverage(entries) {
  return {
    state: "complete",
    projects: entries,
    scip_available: entries.length > 0,
    graph_available: entries.some(({ symbol_count }) => symbol_count > 0),
    call_graph_available: entries.some(({ call_graph_available }) => call_graph_available),
    status_reason: entries.length > 0 ? SCIP_STATUS_EXTRACTED : SCIP_STATUS_NOT_APPLICABLE
  };
}

function providerInputIdentity(head, generatorIdentity, entries) {
  return {
    index_head: head,
    generator_identity: generatorIdentity,
    projects: Object.fromEntries(entries.map(({ key, input_commit }) => [key, input_commit]))
  };
}

export function createSidecarBuildEnvelope({ cacheDir, git, publication, action, metrics }) {
  const relativeArtifact = path.posix.join(cacheDir, SIDECAR_DEFAULT_ARTIFACT_FILE);
  const base = publication.base_coverage ?? {};
  const provider = publication.provider_coverage ?? {};
  const graphState = { graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION, graph_available: true,
    edge_source: "base_index", dirty_graph_mode: "base_index_only", unavailable_paths: [],
    status_reason: "graph_store_available" };
  const scipState = { scip_available: provider.scip_available === true,
    graph_available: provider.graph_available === true, staleness: "fresh",
    index_action: "use", status_reason: provider.status_reason ?? "scip_not_prepared",
    input_identity: publication.provider_input_identity,
    call_graph_available: provider.call_graph_available === true };
  const graphSnapshot = {
    schema_version: "graph-snapshot.v1", store_incarnation: publication.store_incarnation,
    publication_sequence: publication.sequence, repository_commit: publication.repository_commit,
    repository_tree: publication.repository_tree, store_schema_version: SIDECAR_STORE_SCHEMA_VERSION,
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION, generator_identity: publication.generator_identity,
    base_input_identity: publication.base_input_identity, base_coverage: publication.base_coverage,
    provider_input_identity: publication.provider_input_identity,
    provider_coverage: publication.provider_coverage
  };
  return createSidecarResultEnvelope({
    source_kind: "code_index", canonicality: "derived", evidence_basis: "git_tree",
    index_head: git.index_head, index_tree: git.index_tree,
    dirty_state: git.dirty_state, dirty_details: git.dirty_details, staleness: "fresh",
    canonical_refs: [], derived_evidence: [{
      kind: "sidecar_index_build", action, cache_path: cacheDir,
      artifact_path: relativeArtifact, artifact_schema_version: SIDECAR_STORE_SCHEMA_VERSION,
      source_count: base.source_count ?? 0, rejected_source_count: base.rejected_source_count ?? 0,
      metrics, graph_snapshot: graphSnapshot,
      provenance: { source_kind: "code_index", canonicality: "derived", evidence_basis: "git_tree" }
    }], graph_snapshot: graphSnapshot,
    cache_path: cacheDir, artifact_path: relativeArtifact, artifact_exists: true,
    artifact_schema_version: SIDECAR_STORE_SCHEMA_VERSION,
    expected_artifact_schema_version: SIDECAR_STORE_SCHEMA_VERSION,
    build_action: action, graph_state: graphState, scip_state: scipState,
    source_count: base.source_count ?? 0,
    regular_file_count: base.regular_file_count ?? 0,
    symlink_count: base.symlink_count ?? 0, gitlink_count: base.gitlink_count ?? 0,
    rejected_source_count: base.rejected_source_count ?? 0, status_reason: "build_complete"
  });
}

const recordPaths = (change) => [change.oldPath, change.newPath].filter(Boolean);

export async function updateSidecarIndex({
  repoRoot, paths, head, tree, mode, observed, lock,
  signal = null, buildHooks = null, providerDeadlineMs = undefined
}) {
  const publication = observed.state === "available" && observed.publication?.repository_commit
    ? observed.publication : null;
  let generator = null;
  const generatorIdentity = async () => {
    generator ??= (await resolveSidecarGeneratorIdentity({ repoRoot, index_head: head }))
      .generator_identity;
    return generator;
  };
  const classification = await classifySidecarPreparation({
    publication, requestedCommit: head, mode, generatorIdentity,
    compare: () => compareSidecarCommittedTrees({
      repoRoot, fromCommit: publication.repository_commit, toCommit: head
    })
  });
  if (classification.action === "reuse") {
    return { action: "coalesced", publication, metrics: ZERO_METRICS };
  }
  throwIfSidecarPreparationCancelled(signal);
  const clean = classification.action === "clean";
  const records = classification.comparison?.records ?? [];
  const sources = await collectTrackedSources(repoRoot, head);
  const generatorValue = publication?.repository_commit === head
    ? publication.generator_identity
    : await generatorIdentity();
  const baseRecords = clean ? [] : records.filter((change) =>
    recordPaths(change).some(isSidecarBaseInputPath));

  const projects = discoverSidecarScipProjects(sources.tracked_paths);
  const priorCoverage = !clean && publication?.provider_coverage?.state === "complete"
    ? publication.provider_coverage : null;
  const priorProjects = new Map((priorCoverage?.projects ?? []).map((entry) => [entry.key, entry]));
  const reused = [];
  const rerun = [];
  for (const project of projects) {
    const prior = priorProjects.get(project.key);
    const changed = records.some((change) => recordPaths(change).some((value) =>
      isSidecarScipProviderInputPath(project.indexer, value)));
    if (prior && !changed) reused.push(prior);
    else rerun.push(project);
  }
  const removedKeys = [...priorProjects.keys()].filter((key) =>
    !projects.some((project) => project.key === key));

  if ((clean || baseRecords.length > 0) && typeof buildHooks?.beforeGraphExtraction === "function") {
    await buildHooks.beforeGraphExtraction();
  }
  throwIfSidecarPreparationCancelled(signal);
  const layers = await runScipProjectsFromCommittedSnapshot({
    sourceRepoRoot: repoRoot, committedHead: head, projects: rerun,
    baseFileNodeIds: new Set(sources.files.map(({ path: value }) => `file:${value}`)),
    deadlineMs: providerDeadlineMs
  });
  throwIfSidecarPreparationCancelled(signal);
  const entries = [
    ...reused,
    ...rerun.map((project) => providerCoverageEntry(project, layers.get(project.key), head))
  ].sort((left, right) => binaryCompare(left.key, right.key));

  let providerData = null;
  if (rerun.length > 0 || removedKeys.length > 0 || priorCoverage === null) {
    const rows = rerun.map((project) => providerRows(project, layers.get(project.key)));
    providerData = {

      ...(priorCoverage ? { provider_keys: [...rerun.map(({ key }) => key), ...removedKeys] } : {}),
      providers: rerun.map((project) => ({
        provider_id: project.key, descriptor: layers.get(project.key).provider_descriptor,
        input_identity: head, coverage: entries.find(({ key }) => key === project.key)
      })),
      symbols: rows.flatMap(({ symbols }) => symbols),
      occurrences: rows.flatMap(({ occurrences }) => occurrences),
      symbol_edges: rows.flatMap(({ symbol_edges }) => symbol_edges)
    };
  }
  const target = {
    repository_commit: head, repository_tree: tree, generator_identity: generatorValue,
    files: sources.files,
    base_input_identity: SIDECAR_EXTRACTION_BASIS,
    base_coverage: { state: "complete", tracked_count: sources.tracked_count,
      source_count: sources.source_count, rejected_source_count: sources.rejected.length,
      regular_file_count: sources.files.filter(({ mode }) => mode !== "120000").length,
      symlink_count: sources.symlink_count, gitlink_count: sources.gitlink_count },
    provider_input_identity: providerInputIdentity(head, generatorValue, entries),
    provider_coverage: providerCoverage(entries),
    published_at: new Date().toISOString()
  };
  const selected = clean
    ? new Set(sources.files.map(({ path: value }) => value))
    : new Set(baseRecords.flatMap(recordPaths));
  const preparedSources = await readPreparedSources(repoRoot, sources.files, selected);
  throwIfSidecarPreparationCancelled(signal);

  let plan = null;
  let published;
  try {
    published = await publishSidecarGraphCandidate({
      paths, lock, signal, basis: clean || publication === null ? "empty" : "published",
      apply: async (graph) => {
        plan = await prepareSidecarIncrementalDelta({ graph, target, clean,
          sources: preparedSources, diffRecords: baseRecords, providerData });
        throwIfSidecarPreparationCancelled(signal);
        return publishPreparedDeltaInDatabase(graph, plan.delta);
      }
    });
  } catch (error) {

    if (!clean && error?.code === "sidecar_selected_data_invalid") {
      return updateSidecarIndex({ repoRoot, paths, head, tree, mode: "rebuild", observed, lock,
        signal, buildHooks, providerDeadlineMs });
    }
    throw error;
  }
  return {
    action: clean ? (publication ? "rebuild" : "build") : classification.action,
    publication: published,
    metrics: { ...plan.metrics, provider_projects_run: rerun.length,
      provider_projects_reused: reused.length }
  };
}

function assertBuildHooks(buildHooks) {
  if (buildHooks == null) return;
  if (!buildHooks || typeof buildHooks !== "object" || Array.isArray(buildHooks)) {
    throw new TypeError("sidecar build buildHooks must be an object");
  }
  const unsupported = Reflect.ownKeys(buildHooks)
    .filter((key) => key !== "beforeGraphExtraction").map(String);
  if (unsupported.length > 0) {
    throw new TypeError(`sidecar build does not support buildHooks key(s): ${unsupported.join(", ")}`);
  }
}

export async function buildSidecarIndex(rawOptions) {
  const options = snapshotScipOptions(rawOptions, [["dir", "."],
    ["cacheDir", SIDECAR_DEFAULT_CACHE_DIR], ["artifactFile", SIDECAR_DEFAULT_ARTIFACT_FILE],
    ["rebuild", false], ["scip", undefined], ["buildHooks", null], ["signal", null],
    ["providerDeadlineMs", undefined]], "sidecar build");

  if (rawOptions !== undefined && Object.hasOwn(rawOptions, "scipOptions")) {
    throw new TypeError(
      "sidecar build does not accept caller SCIP options; canonical publication uses the provisioned indexers"
    );
  }
  if (options.scip === false) {
    throw new TypeError("sidecar build always prepares every applicable SCIP provider; scip:false is not supported");
  }
  if (options.artifactFile !== SIDECAR_DEFAULT_ARTIFACT_FILE) {
    throw new TypeError(`sidecar build artifactFile is fixed as ${SIDECAR_DEFAULT_ARTIFACT_FILE}`);
  }
  if (typeof options.rebuild !== "boolean") throw new TypeError("sidecar build rebuild must be a boolean");
  assertBuildHooks(options.buildHooks);
  const ensured = await ensureSidecarIndex({
    dir: options.dir, cacheDir: options.cacheDir, mode: options.rebuild ? "rebuild" : "update",
    signal: options.signal, buildHooks: options.buildHooks,
    providerDeadlineMs: options.providerDeadlineMs, dirtyState: true
  });
  return ensured.build ?? createSidecarBuildEnvelope({
    cacheDir: ensured.status.cache_path,
    git: ensured.status,
    publication: ensured.publication,
    action: ensured.action,
    metrics: ZERO_METRICS
  });
}
