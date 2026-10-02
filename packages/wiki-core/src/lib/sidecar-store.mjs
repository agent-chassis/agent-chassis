import { randomUUID } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import { copyFile, mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  CRASH_DURABLE_EFFECTS,
  createAsyncEffects,
  planPreparedReplacement,
  runCrashDurablePlanAsync
} from "./crash-durable-state.mjs";
import { sidecarGraphEdgeId, sidecarGraphNodeId } from "./sidecar-graph-contributions.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";
import { normalizeSidecarRepoPath } from "./sidecar-paths.mjs";
import { decodeSidecarStorePayload } from "./sidecar-store-codec.mjs";
import {
  assertGraphSchema,
  configureReadableSqlite,
  initializeGraphSchema,
  SIDECAR_STORE_GRAPH_FILE,
  SIDECAR_STORE_LIFECYCLE_FILE
} from "./sidecar-store-schema.mjs";
import {
  classifyLifecycleFailure,
  throwIfSidecarPreparationCancelled,
  withSidecarUpdaterLock
} from "./sidecar-store-lifecycle.mjs";
import { publishPreparedDeltaInDatabase } from "./sidecar-store-publication.mjs";
import {
  binaryCompare,
  chunkList,
  decodeStoreUnitPayload,
  lookupStoreStringIds,
  marks,
  readStorePublication,
  selectedDataError,
  selectStoreAdjacency,
  selectStoreDirectoryMembership,
  selectStoreFiles,
  selectStoreGraphImpact,
  selectStoreNodes,
  selectStoreOccurrences,
  selectStoreOccurrencesByDocument,
  selectStoreProviders,
  selectStoreSymbolEdges,
  selectStoreSymbolEdgesByDocument,
  selectStoreSymbolOccurrences,
  selectStoreSymbols,
  storeContributionKey
} from "./sidecar-store-queries.mjs";

export const SIDECAR_DEFAULT_STORE_CACHE_DIR = ".cache/repo-code-index";
export const SIDECAR_GRAPH_CANDIDATE_PREFIX = ".graph-candidate-";

const SIDECAR_RUNTIME_FLOOR = Object.freeze({ node: "24.20.0", sqlite: "3.53.4" });

const READER_PAGE_CACHE_KIB = 16 * 1024;
const WRITER_PAGE_CACHE_KIB = 32 * 1024;

function runtimeVersionAtLeast(actual, floor) {
  if (typeof actual !== "string" || !/^v?\d+\.\d+\.\d+/.test(actual)) return false;
  const left = actual.replace(/^v/, "").split(".").slice(0, 3).map(Number);
  const right = floor.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

export function assertSidecarRuntimeSupported(versions = process.versions) {
  for (const [name, floor] of Object.entries(SIDECAR_RUNTIME_FLOOR)) {
    if (!runtimeVersionAtLeast(versions?.[name], floor)) {
      const error = new Error(
        `sidecar SQLite store requires ${name} >=${floor}; received ${versions?.[name] ?? "missing"}`
      );
      error.code = "sidecar_runtime_unsupported";
      throw error;
    }
  }
}

export function resolveSidecarStorePaths({ repoRoot, cacheDir } = {}) {
  const root = path.resolve(String(repoRoot || "."));
  const relativeCacheDir = normalizeSidecarRepoPath(
    cacheDir || SIDECAR_DEFAULT_STORE_CACHE_DIR
  );
  const storeDir = path.join(root, relativeCacheDir);
  return Object.freeze({
    repo_root: root,
    cache_dir: relativeCacheDir,
    store_dir: storeDir,
    graph_path: path.join(storeDir, SIDECAR_STORE_GRAPH_FILE),
    lifecycle_path: path.join(storeDir, SIDECAR_STORE_LIFECYCLE_FILE)
  });
}

export function openSidecarGraphDatabase(graphPath, { readOnly = false } = {}) {
  if (!existsSync(graphPath)) {
    const error = new Error("sidecar graph database is missing");
    error.code = "missing";
    throw error;
  }
  const db = new DatabaseSync(graphPath, { readOnly, timeout: 0 });
  try {
    configureReadableSqlite(db);
    db.exec(`PRAGMA cache_size = -${readOnly ? READER_PAGE_CACHE_KIB : WRITER_PAGE_CACHE_KIB}`);
    if (!readOnly) db.exec("PRAGMA synchronous = FULL");
    assertGraphSchema(db, { graphSchemaVersion: SIDECAR_GRAPH_SCHEMA_VERSION });
    return db;
  } catch (error) {
    if (db.isOpen) db.close();
    throw error;
  }
}

export function createSidecarGraphDatabase(graphPath) {
  const graph = new DatabaseSync(graphPath, { timeout: 0 });
  try {
    initializeGraphSchema(graph, { graphSchemaVersion: SIDECAR_GRAPH_SCHEMA_VERSION });
  } finally {
    if (graph.isTransaction) graph.exec("ROLLBACK");
    if (graph.isOpen) graph.close();
  }
}

function withPublishedGraph(paths, operation) {
  const graph = openSidecarGraphDatabase(paths.graph_path, { readOnly: true });
  try {
    const result = operation(graph);
    if (result && typeof result.then === "function") {
      throw new TypeError("sidecar graph reads must be synchronous");
    }
    return result;
  } finally {
    if (graph.isTransaction) graph.exec("ROLLBACK");
    if (graph.isOpen) graph.close();
  }
}

function readSnapshot(db, operation) {
  if (db.isTransaction) return structuredClone(operation());
  db.exec("BEGIN");
  try {
    const result = operation();
    db.exec("COMMIT");
    return structuredClone(result);
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function readSidecarStoreStatus(options = {}) {
  const paths = resolveSidecarStorePaths(options);
  if (!existsSync(paths.graph_path)) return { state: "missing", paths };
  try {
    return { state: "available", paths, publication: withPublishedGraph(paths, readStorePublication) };
  } catch (error) {
    return {
      state: error?.code === "sidecar_graph_structural_unusable"
        ? "structural_unusable"
        : classifyLifecycleFailure(error),
      paths,
      error_code: error?.code ?? null,
      error_message: error instanceof Error ? error.message : String(error)
    };
  }
}

export class SidecarGraphPublicationError extends Error {
  constructor(message, { code, publicationOutcome, cause = null, trace = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SidecarGraphPublicationError";
    this.code = code;
    this.publication_outcome = publicationOutcome;
    this.trace = trace;
  }
}

const PUBLICATION_FAILURE_CODES = Object.freeze({
  prior_preserved: "sidecar_publication_failed",
  published_with_error: "sidecar_publication_incomplete",
  unknown: "sidecar_publication_unknown"
});

function priorPreserved(error) {
  if (error && typeof error === "object" && error.publication_outcome === undefined) {
    error.publication_outcome = "prior_preserved";
  }
  return error;
}

async function observeGraphPath(graphPath) {
  try {
    const info = await stat(graphPath, { bigint: true });
    return { exists: true, dev: info.dev.toString(), ino: info.ino.toString(),
      size: info.size.toString(), mtime_ns: info.mtimeNs.toString(), ctime_ns: info.ctimeNs.toString() };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

function sameObservation(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function publicationRunOutcome(run, { graphPath, candidate, predecessor }) {
  if (run.failed_fault === null) return "published";
  const rename = run.trace.find(({ effect }) => effect === CRASH_DURABLE_EFFECTS.PUBLISH_RENAME);
  if (rename?.outcome === "ok") return "published_with_error";
  if (rename?.outcome !== "failed") return "prior_preserved";
  const destination = await observeGraphPath(graphPath).catch(() => null);
  if (destination?.exists && destination.dev === candidate.dev && destination.ino === candidate.ino) {
    return "published_with_error";
  }
  return destination && sameObservation(destination, predecessor) ? "prior_preserved" : "unknown";
}

export async function publishSidecarGraphCandidate({
  paths,
  lock,
  basis,
  apply,
  signal = null,
  faultInjector = null
} = {}) {
  assertSidecarRuntimeSupported();
  if (!lock?.held || lock.lifecycle_path !== path.resolve(String(paths?.lifecycle_path ?? ""))) {
    throw new TypeError("sidecar graph publication requires the held updater lock for its store");
  }
  if (basis !== "published" && basis !== "empty") {
    throw new TypeError("sidecar graph candidate basis must be 'published' or 'empty'");
  }
  if (typeof apply !== "function") throw new TypeError("sidecar graph candidate apply must be a function");
  const predecessor = await observeGraphPath(paths.graph_path);
  if (existsSync(`${paths.graph_path}-journal`)) {
    throw new SidecarGraphPublicationError(
      "the published graph has a rollback journal; candidate publication does not own its recovery",
      { code: "recovery_pending", publicationOutcome: "prior_preserved" }
    );
  }
  if (basis === "published" && !predecessor.exists) {
    throw new SidecarGraphPublicationError("sidecar graph database is missing",
      { code: "missing", publicationOutcome: "prior_preserved" });
  }
  const candidatePath = path.join(paths.store_dir,
    `${SIDECAR_GRAPH_CANDIDATE_PREFIX}${randomUUID()}.sqlite`);
  let graph = null;
  let renamed = false;
  try {
    if (basis === "published") {
      await copyFile(paths.graph_path, candidatePath, fsConstants.COPYFILE_EXCL);
    } else {
      await (await open(candidatePath, "wx", 0o600)).close();
      createSidecarGraphDatabase(candidatePath);
    }
    graph = openSidecarGraphDatabase(candidatePath);
    const publication = await apply(graph);
    graph.close();
    graph = null;
    throwIfSidecarPreparationCancelled(signal);
    if (existsSync(`${candidatePath}-journal`)) {
      throw new SidecarGraphPublicationError(
        "sidecar graph candidate retained a rollback journal after its transaction",
        { code: "sidecar_publication_candidate_journal_retained", publicationOutcome: "prior_preserved" }
      );
    }
    if (!sameObservation(await observeGraphPath(paths.graph_path), predecessor)) {
      throw new SidecarGraphPublicationError(
        "the published graph changed while its candidate was prepared",
        { code: "sidecar_publication_destination_moved", publicationOutcome: "prior_preserved" }
      );
    }
    const candidate = await observeGraphPath(candidatePath);
    const run = await runCrashDurablePlanAsync(
      planPreparedReplacement({ targetPath: paths.graph_path, privatePath: candidatePath }),
      createAsyncEffects({ faultInjector })
    );
    const outcome = await publicationRunOutcome(run,
      { graphPath: paths.graph_path, candidate, predecessor });
    renamed = outcome !== "prior_preserved";
    if (outcome !== "published") {
      throw new SidecarGraphPublicationError(
        `sidecar graph publication ${outcome.replaceAll("_", " ")}: ${run.error?.message ?? "unknown failure"}`,
        { code: PUBLICATION_FAILURE_CODES[outcome], publicationOutcome: outcome,
          cause: run.error, trace: run.trace }
      );
    }
    try {
      await rm(`${candidatePath}-journal`, { force: true });
    } catch (cause) {
      throw new SidecarGraphPublicationError("sidecar graph was published but candidate cleanup failed",
        { code: PUBLICATION_FAILURE_CODES.published_with_error,
          publicationOutcome: "published_with_error", cause, trace: run.trace });
    }
    return publication;
  } catch (error) {

    if (!(error instanceof SidecarGraphPublicationError)) priorPreserved(error);
    throw error;
  } finally {
    if (graph?.isOpen && graph.isTransaction) graph.exec("ROLLBACK");
    if (graph?.isOpen) graph.close();

    if (!renamed) {
      await rm(`${candidatePath}-journal`, { force: true }).catch(() => {});
      await rm(candidatePath, { force: true }).catch(() => {});
    }
  }
}

export async function initializeSidecarStore(options = {}) {
  assertSidecarRuntimeSupported();
  const paths = resolveSidecarStorePaths(options);
  await mkdir(paths.store_dir, { recursive: true });
  await withSidecarUpdaterLock(paths.lifecycle_path, async (lock) => {
    if (existsSync(paths.graph_path)) {
      openSidecarGraphDatabase(paths.graph_path, { readOnly: true }).close();
      return;
    }
    await publishSidecarGraphCandidate({ paths, lock, basis: "empty",
      apply: (graph) => readStorePublication(graph) });
  }, { signal: options.signal ?? null });
  return paths;
}

export async function publishPreparedDelta({ repoRoot, cacheDir, delta, faultInjector = null } = {}) {
  assertSidecarRuntimeSupported();
  const paths = resolveSidecarStorePaths({ repoRoot, cacheDir });
  return withSidecarUpdaterLock(paths.lifecycle_path, (lock) => publishSidecarGraphCandidate({
    paths, lock, basis: "published", faultInjector,
    apply: (graph) => publishPreparedDeltaInDatabase(graph, delta)
  }));
}

function chunked(values) {
  return chunkList([...new Set(values ?? [])]);
}

function sameKeySet(expected, stored, label) {
  if (stored.size !== expected.size || [...stored.keys()].some((key) => !expected.has(key))) {
    throw selectedDataError(`${label} population is incomplete or inconsistent`);
  }
}

function validateSelectedUnitRows(graph, unit, payload) {
  const expectedNodes = new Map(payload.node_contributions.map((contribution) => [
    storeContributionKey(sidecarGraphNodeId(contribution.kind, contribution.key), contribution.ordinal),
    contribution.kind
  ]));
  const storedNodes = new Map();
  for (const row of graph.prepare(`SELECT s.value AS id, m.ordinal, m.residual AS member_residual,
    n.residual, v.value AS kind FROM node_members m
    LEFT JOIN nodes n ON n.node_sid = m.node_sid LEFT JOIN strings s ON s.sid = m.node_sid
    LEFT JOIN vocabulary v ON v.term_id = n.kind_id WHERE m.uid = ?`).all(unit.uid)) {
    const key = storeContributionKey(row.id, row.ordinal);
    if (row.id === null || row.kind === null || expectedNodes.get(key) !== row.kind) {
      throw selectedDataError(`stored node contribution identity is invalid: ${row.id}`);
    }
    for (const residual of [row.residual, row.member_residual]) {
      if (residual !== null) decodeSidecarStorePayload(residual, `node ${row.id} residual`);
    }
    storedNodes.set(key, row);
  }
  sameKeySet(expectedNodes, storedNodes, `extraction unit ${unit.unit_key} nodes`);
  const expectedEdges = new Set(payload.edge_contributions.map((contribution) =>
    storeContributionKey(sidecarGraphEdgeId(contribution.kind, contribution.from_node_id,
      contribution.to_node_id, contribution.discriminator), contribution.ordinal)));
  const storedEdges = new Map();
  for (const row of graph.prepare(`SELECT m.ordinal, m.residual AS member_residual, e.residual,
    e.discriminator, v.value AS kind, f.value AS from_id, t.value AS to_id,
    (SELECT count(*) FROM nodes WHERE node_sid IN (e.from_sid, e.to_sid)) AS endpoints
    FROM edge_members m LEFT JOIN edges e ON e.eid = m.eid
    LEFT JOIN vocabulary v ON v.term_id = e.kind_id LEFT JOIN strings f ON f.sid = e.from_sid
    LEFT JOIN strings t ON t.sid = e.to_sid WHERE m.uid = ?`).all(unit.uid)) {
    if (row.kind === null || row.from_id === null || row.to_id === null) {
      throw selectedDataError(`extraction unit ${unit.unit_key} edge structure is invalid`);
    }
    const id = sidecarGraphEdgeId(row.kind, row.from_id, row.to_id, row.discriminator);
    const expectedEndpoints = row.from_id === row.to_id ? 1 : 2;
    if (!expectedEdges.has(storeContributionKey(id, row.ordinal)) || row.endpoints !== expectedEndpoints) {
      throw selectedDataError(`selected edge ${id} structure is invalid`);
    }
    for (const residual of [row.residual, row.member_residual]) {
      if (residual !== null) decodeSidecarStorePayload(residual, `edge ${id} residual`);
    }
    storedEdges.set(storeContributionKey(id, row.ordinal), row);
  }
  sameKeySet(expectedEdges, storedEdges, `extraction unit ${unit.unit_key} edges`);
}

export function readSidecarIncrementalStateFromDatabase(graph, {
  sourcePaths = [], candidatePaths = [], allUnits = false, allFiles = false
} = {}) {
  return readSnapshot(graph, () => {
    const unitIds = new Set();
    if (allUnits) {
      for (const row of graph.prepare("SELECT uid FROM units").all()) unitIds.add(row.uid);
    }
    for (const chunk of chunked(sourcePaths)) {
      for (const row of graph.prepare(`SELECT u.uid FROM units u JOIN files f ON f.fid = u.fid
        WHERE f.path IN (${marks(chunk)})`).all(...chunk)) unitIds.add(row.uid);
    }
    for (const chunk of chunked([...lookupStoreStringIds(graph, candidatePaths).values()])) {
      for (const row of graph.prepare(
        `SELECT uid FROM resolution_candidates WHERE candidate_sid IN (${marks(chunk)})`
      ).all(...chunk)) unitIds.add(row.uid);
    }
    const units = [];
    for (const chunk of chunked([...unitIds])) {
      for (const row of graph.prepare(`SELECT u.uid, u.unit_key, f.path AS source_path,
        u.input_identity, v.value AS provider_kind, u.payload FROM units u
        JOIN files f ON f.fid = u.fid JOIN vocabulary v ON v.term_id = u.provider_kind_id
        WHERE u.uid IN (${marks(chunk)})`).all(...chunk)) {
        const payload = decodeStoreUnitPayload(row.payload, row.unit_key);
        if (payload.facts.source_path !== row.source_path) {
          throw selectedDataError(`extraction unit ${row.unit_key} source path is inconsistent`);
        }
        validateSelectedUnitRows(graph, row, payload);
        units.push({
          unit_id: row.unit_key, source_path: row.source_path,
          input_identity: row.input_identity, provider_kind: row.provider_kind,
          facts: payload.facts
        });
      }
    }
    units.sort((left, right) => binaryCompare(left.source_path, right.source_path) ||
      binaryCompare(left.unit_id, right.unit_id));
    const files = allFiles
      ? graph.prepare("SELECT path, blob_oid, mode, input_identity FROM files ORDER BY path").all()
      : [];
    return { publication: readStorePublication(graph), units, files };
  });
}

export function readSidecarIncrementalState({
  repoRoot,
  cacheDir,
  sourcePaths = [],
  candidatePaths = [],
  allUnits = false,
  allFiles = false
}) {
  const paths = resolveSidecarStorePaths({ repoRoot, cacheDir });
  return withPublishedGraph(paths, (graph) => readSidecarIncrementalStateFromDatabase(graph, {
    sourcePaths, candidatePaths, allUnits, allFiles
  }));
}

const COMMITTED_READ_SELECTIONS = new Set([
  "paths", "directories", "node_ids", "adjacent_to", "symbols",
  "occurrence_symbol_ids", "occurrence_document_paths"
]);

export function selectSidecarCommittedRead(graph, selection = {}) {
  for (const key of Object.keys(selection)) {
    if (!COMMITTED_READ_SELECTIONS.has(key)) {
      throw new TypeError(`unsupported sidecar store selection: ${key}`);
    }
  }
  return readSnapshot(graph, () => {
    const publication = readStorePublication(graph);
    return {
      publication,
      counts: publication.counts,
      files: selectStoreFiles(graph, selection.paths),
      directory_membership: selectStoreDirectoryMembership(graph, selection.directories),
      nodes: selectStoreNodes(graph, selection.node_ids),
      edges: selectStoreAdjacency(graph, selection.adjacent_to),
      symbols: selectStoreSymbols(graph, selection.symbols),
      occurrences: selectStoreOccurrences(graph, selection.occurrence_symbol_ids),
      position_occurrences: selectStoreOccurrencesByDocument(
        graph, selection.occurrence_document_paths
      )
    };
  });
}

export function withCommittedRead({ repoRoot, cacheDir, selection = {} } = {}) {
  const paths = resolveSidecarStorePaths({ repoRoot, cacheDir });
  return withPublishedGraph(paths, (graph) => selectSidecarCommittedRead(graph, selection));
}

export function selectSidecarGraphSelection(graph, { paths = [], directories = [] } = {}) {
  return readSnapshot(graph, () => {
    const publication = readStorePublication(graph);
    const selectedGraph = selectStoreGraphImpact(graph, paths);
    return {
      publication,
      counts: publication.counts,
      files: selectStoreFiles(graph, paths),
      directory_membership: selectStoreDirectoryMembership(graph, directories),
      graph: {
        graph_schema_version: selectedGraph.graph_schema_version,
        graph_nodes: selectedGraph.graph_nodes,
        graph_edges: selectedGraph.graph_edges,
        graph_metadata: selectedGraph.graph_metadata
      },
      unavailable_paths: selectedGraph.unavailable_paths
    };
  });
}

export function readSidecarGraphSelection({ repoRoot, cacheDir, paths = [], directories = [] } = {}) {
  const storePaths = resolveSidecarStorePaths({ repoRoot, cacheDir });
  return withPublishedGraph(storePaths,
    (graph) => selectSidecarGraphSelection(graph, { paths, directories }));
}

export function selectSidecarSymbolSelection(graph, { symbol = null, documentPath = null } = {}) {
  return readSnapshot(graph, () => {
    const publication = readStorePublication(graph);
    const documentEdges = documentPath
      ? selectStoreSymbolEdgesByDocument(graph, [documentPath])
      : [];
    const positionOccurrences = documentPath
      ? selectStoreOccurrencesByDocument(graph, [documentPath])
      : [];

    const requestedSymbols = new Set(symbol ? [symbol] : []);
    for (const edge of documentEdges) {
      if (edge.from_symbol) requestedSymbols.add(edge.from_symbol);
      if (edge.to_symbol) requestedSymbols.add(edge.to_symbol);
    }
    for (const row of positionOccurrences) requestedSymbols.add(row.symbol_id);
    const rawSymbols = [...requestedSymbols];
    const symbols = selectStoreSymbols(graph, rawSymbols);
    const occurrences = selectStoreSymbolOccurrences(graph, symbols);
    const symbolEdges = [
      ...new Map([
        ...documentEdges,
        ...selectStoreSymbolEdges(graph, rawSymbols)
      ].map((edge) => [`${edge.provider_id}\0${edge.edge_id}`, edge])).values()
    ];

    const sourcePaths = [...new Set([documentPath,
      ...[symbols, occurrences, positionOccurrences, symbolEdges].flat()
        .map((row) => row.document_path),
      ...symbolEdges.map((edge) => edge.payload?.provenance?.path)
    ].filter((value) => typeof value === "string" && value.length > 0))];
    return {
      publication,
      counts: publication.counts,
      providers: selectStoreProviders(graph),
      symbols,
      occurrences,
      position_occurrences: positionOccurrences,
      symbol_edges: symbolEdges,
      source_files: selectStoreFiles(graph, sourcePaths),
      source_definition_occurrences: selectStoreOccurrencesByDocument(graph, sourcePaths)
        .filter(({ roles }) => (roles & 1) === 1)
    };
  });
}

export function readSidecarSymbolSelection({
  repoRoot,
  cacheDir,
  symbol = null,
  documentPath = null
} = {}) {
  const storePaths = resolveSidecarStorePaths({ repoRoot, cacheDir });
  return withPublishedGraph(storePaths, (graph) =>
    selectSidecarSymbolSelection(graph, { symbol, documentPath }));
}
