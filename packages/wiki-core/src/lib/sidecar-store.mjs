import { configureReadableSqlite, classifySqliteFailure } from "./sqlite-runtime.mjs";
import { existsSync } from "node:fs";
import { lstat, mkdir, truncate, rm } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { sidecarGraphEdgeId, sidecarGraphNodeId } from "./sidecar-graph-contributions.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";
import { normalizeSidecarRepoPath } from "./sidecar-paths.mjs";
import { decodeSidecarStorePayload } from "./sidecar-store-codec.mjs";
import {
  assertGraphSchema,
  initializeGraphSchema,
  SIDECAR_STORE_SCHEMA_VERSION,
  SIDECAR_STORE_GRAPH_FILE,
  SIDECAR_STORE_LIFECYCLE_FILE
} from "./sidecar-store-schema.mjs";
import {
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
  selectStoreDocumentSymbolEdges,
  selectStoreFiles,
  selectStoreExistingPrefixes,
  selectStoreGraphImpact,
  selectStoreNodes,
  selectStoreOccurrences,
  selectStoreOccurrencesByDocument,
  selectStoreProviders,
  selectStoreSymbolEdges,
  selectStoreSymbolEdgesByDocument,
  selectStoreSymbolOccurrences,
  selectStoreSymbolDefinitionOccurrences,
  selectStoreSymbols,
  selectStoreSymbolsReferencedElsewhere,
  storeContributionKey
} from "./sidecar-store-queries.mjs";

export const SIDECAR_DEFAULT_STORE_CACHE_DIR = ".cache/repo-code-index";

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
  const db = new DatabaseSync(graphPath, { readOnly, timeout: 5000 });
  try {
    configureReadableSqlite(db, { journalMode: null });
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(`PRAGMA cache_size = -${readOnly ? READER_PAGE_CACHE_KIB : WRITER_PAGE_CACHE_KIB}`);
    if (!readOnly) db.exec("PRAGMA synchronous = FULL");
    db.exec("BEGIN");
    assertGraphSchema(db, { graphSchemaVersion: SIDECAR_GRAPH_SCHEMA_VERSION });
    db.exec("COMMIT");
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
  if (!existsSync(paths.graph_path)) return { state: "missing", artifact_exists: false, paths,
    required_store_schema_version: SIDECAR_STORE_SCHEMA_VERSION };
  try {
    return { state: "available", artifact_exists: true, paths,
      observed_store_schema_version: SIDECAR_STORE_SCHEMA_VERSION,
      required_store_schema_version: SIDECAR_STORE_SCHEMA_VERSION, publication: withPublishedGraph(paths, readStorePublication) };
  } catch (error) {
    return {
      state: error?.code === "sidecar_graph_structural_unusable"
        ? "structural_unusable"
        : classifySqliteFailure(error),
      paths,
      artifact_exists: true,
      observed_store_schema_version: error?.observed_store_schema_version ?? null,
      required_store_schema_version: SIDECAR_STORE_SCHEMA_VERSION,
      observed_graph_schema_version: error?.observed_graph_schema_version ?? null,
      error_code: error?.code ?? null,
      error_message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function updateSidecarGraph({ paths, lock, basis, apply, signal = null } = {}) {
  assertSidecarRuntimeSupported();
  if (!lock?.held || lock.lifecycle_path !== path.resolve(String(paths?.lifecycle_path ?? ""))) {
    throw new TypeError("sidecar graph update requires the held updater lock for its store");
  }
  if (basis !== "published" && basis !== "empty") throw new TypeError("sidecar graph basis must be 'published' or 'empty'");
  if (typeof apply !== "function") throw new TypeError("sidecar graph apply must be a function");
  throwIfSidecarPreparationCancelled(signal);
  try {
    const info = await lstat(paths.graph_path);
    if (!info.isFile()) {
      const error = new Error(`sidecar graph path is ${info.isSymbolicLink() ? "a symlink" : info.isDirectory() ? "a directory" : "not a regular file"}: ${paths.graph_path}`);
      error.code = "sidecar_graph_path_not_file";
      throw error;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  let graph = null;
  let before = null;
  let reset = false;
  try {
    if (basis === "empty") {
      graph = new DatabaseSync(paths.graph_path, { timeout: 5000 });
      try {

        graph.prepare("SELECT count(*) FROM sqlite_schema").get();
      } catch (error) {
        if (classifySqliteFailure(error) !== "coordination_unusable") throw error;
        graph.close();
        graph = null;

        await truncate(paths.graph_path, 0);
        for (const suffix of ["-journal", "-wal", "-shm"]) await rm(`${paths.graph_path}${suffix}`, { force: true });
        graph = new DatabaseSync(paths.graph_path, { timeout: 5000 });
      }
      initializeGraphSchema(graph, { graphSchemaVersion: SIDECAR_GRAPH_SCHEMA_VERSION, reset: true });
      reset = true;
    } else {
      graph = openSidecarGraphDatabase(paths.graph_path);
    }
    before = readStorePublication(graph);
    const publication = await apply(graph);
    if (graph.isTransaction) throw new Error("sidecar graph apply left an uncommitted transaction");
    return publication;
  } catch (error) {
    try {
      if (graph?.isOpen && graph.isTransaction) graph.exec("ROLLBACK");
      if (error && typeof error === "object" && error.publication_outcome === undefined) {
        const after = graph?.isOpen && before ? readStorePublication(graph) : null;
        error.publication_outcome = before && !after ? "unknown"
          : after && after.sequence !== before.sequence ? "published_with_error"
          : reset ? "unpublished" : "prior_preserved";
      }
    } catch (cause) {
      const failure = new AggregateError([error, cause],
        `sidecar update failed: ${error instanceof Error ? error.message : String(error)}; rollback or outcome observation failed: ${cause.message}`,
        { cause: error });
      failure.code = error.code ?? "sidecar_graph_update_failed";
      failure.publication_outcome = "unknown";
      throw failure;
    }
    throw error;
  } finally {
    if (graph?.isOpen) graph.close();
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
    await updateSidecarGraph({ paths, lock, basis: "empty", apply: readStorePublication });
  }, { signal: options.signal ?? null });
  return paths;
}

export async function publishPreparedDelta({ repoRoot, cacheDir, delta } = {}) {
  assertSidecarRuntimeSupported();
  const paths = resolveSidecarStorePaths({ repoRoot, cacheDir });
  return withSidecarUpdaterLock(paths.lifecycle_path, (lock) => updateSidecarGraph({
    paths, lock, basis: "published", apply: (graph) => publishPreparedDeltaInDatabase(graph, delta)
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

function uniqueSymbolEdges(edges) {
  return [...new Map(edges.map((edge) => [`${edge.provider_id}\0${edge.edge_id}`, edge])).values()];
}

function selectWholeSymbolFacts(graph, symbol, documentPath) {
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
  return {
    symbols,
    occurrences: selectStoreSymbolOccurrences(graph, symbols),
    positionOccurrences,
    symbolEdges: uniqueSymbolEdges([...documentEdges, ...selectStoreSymbolEdges(graph, rawSymbols)]),
    partialSymbols: []
  };
}

function selectPositionSymbolFacts(graph, documentPaths, positionSymbols, { planning = false,
  includeOutgoing = false } = {}) {
  const key = ({ provider_id: providerId, symbol_id: symbolId }) => `${providerId}\0${symbolId}`;
  const documentOccurrences = selectStoreOccurrencesByDocument(graph, documentPaths);
  const named = documentPaths.flatMap(documentPath => positionSymbols(
    documentOccurrences.filter(row => row.document_path === documentPath)));
  const namedKeys = new Set(named.map(key));
  const nativeKeys = new Set(documentOccurrences.filter(row => namedKeys.has(key(row)))
    .map(row => row.payload.symbol_key));
  const locals = named.filter(entry => entry.document_local === true);
  const localKeys = new Set(locals.map(key));
  const localIds = new Set(locals.map(entry => entry.symbol_id));
  const outgoing = planning && includeOutgoing ? documentOccurrences.filter(row =>
    (row.roles & 1) !== 1 && !row.payload.symbol?.startsWith("local ")) : [];
  const globalIds = [...new Set([...named, ...outgoing].map(entry => entry.symbol_id))]
    .filter(symbolId => !localIds.has(symbolId));
  const incomingIds = new Set(named.map(entry => entry.symbol_id));
  const outgoingKeys = new Set(outgoing.map(key));
  const symbols = selectStoreSymbols(graph, [...globalIds, ...localIds])
    .filter(row => !localIds.has(row.raw_symbol) || localKeys.has(key(row)))
    .filter(row => !planning || incomingIds.has(row.symbol_id) || outgoingKeys.has(key(row)));
  const globals = symbols.filter(row => !localIds.has(row.raw_symbol));
  const occurrences = planning ? [
    ...selectStoreSymbolOccurrences(graph, globals.filter(row => incomingIds.has(row.symbol_id)),
      row => nativeKeys.has(row.payload.symbol_key) || (row.roles & 1) === 1),
    ...selectStoreSymbolDefinitionOccurrences(graph, globals.filter(row =>
      outgoingKeys.has(key(row)) && !incomingIds.has(row.symbol_id)))
  ] : selectStoreSymbolOccurrences(graph, globals);
  return {
    symbols,
    occurrences,
    positionOccurrences: planning ? documentOccurrences
      : documentOccurrences.filter(row => namedKeys.has(key(row))),
    symbolEdges: planning ? [] : uniqueSymbolEdges([...selectStoreSymbolEdges(graph, globalIds),
      ...documentPaths.flatMap(documentPath => selectStoreDocumentSymbolEdges(graph, documentPath, locals))]),
    partialSymbols: documentPaths.flatMap(documentPath =>
      selectStoreSymbolsReferencedElsewhere(graph, documentPath, locals))
      .map(({ provider_id, symbol_id }) => ({ provider_id, symbol_id }))
  };
}

export function selectSidecarSymbolSelection(graph, { symbol = null, documentPath = null,
  positionSymbols = null, documentPaths = null, planning = false, includeOutgoing = false } = {}) {
  return readSnapshot(graph, () => {
    const publication = readStorePublication(graph);
    const { symbols, occurrences, positionOccurrences, symbolEdges, partialSymbols } =
      (documentPath || documentPaths) && !symbol && typeof positionSymbols === "function"
        ? selectPositionSymbolFacts(graph, documentPaths ?? [documentPath], positionSymbols, { planning, includeOutgoing })
        : selectWholeSymbolFacts(graph, symbol, documentPath);

    const sourcePaths = [...new Set([...(documentPaths ?? [documentPath]),
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
      partial_symbols: partialSymbols,
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
  documentPath = null,
  positionSymbols = null,
  documentPaths = null, planning = false, includeOutgoing = false
} = {}) {
  const storePaths = resolveSidecarStorePaths({ repoRoot, cacheDir });
  return withPublishedGraph(storePaths, (graph) =>
    selectSidecarSymbolSelection(graph, { symbol, documentPath, documentPaths, positionSymbols, planning, includeOutgoing }));
}

export function readSidecarPathExistence({ repoRoot, cacheDir, paths, prefixes }) {
  return withPublishedGraph(resolveSidecarStorePaths({ repoRoot, cacheDir }), graph =>
    readSnapshot(graph, () => ({ publication: readStorePublication(graph),
      files: selectStoreFiles(graph, paths), prefixes: selectStoreExistingPrefixes(graph, prefixes) })));
}
