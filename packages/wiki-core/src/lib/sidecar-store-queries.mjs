import {
  createGraphBuilder,
  sidecarGraphEdgeId,
  sidecarGraphNodeId
} from "./sidecar-graph-contributions.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "./sidecar-graph-schema.mjs";
import { decodeSidecarStorePayload } from "./sidecar-store-codec.mjs";
import { SIDECAR_STORE_MEMBERSHIP_CHUNK_SIZE } from "./sidecar-store-schema.mjs";

function chunks(values, { allowEmpty = false } = {}) {
  const unique = [...new Set((values ?? []).filter((value) =>
    typeof value === "string" && (allowEmpty || value.length > 0)
  ))];
  return chunkList(unique);
}

export function chunkList(values) {
  const result = [];
  for (let index = 0; index < values.length; index += SIDECAR_STORE_MEMBERSHIP_CHUNK_SIZE) {
    result.push(values.slice(index, index + SIDECAR_STORE_MEMBERSHIP_CHUNK_SIZE));
  }
  return result;
}

export function marks(values) {
  return values.map(() => "?").join(", ");
}

export function binaryCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function selectedDataError(message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "sidecar_selected_data_invalid";
  return error;
}

function parseJson(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw selectedDataError(`sidecar store ${label} is not valid JSON`, cause);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw selectedDataError(`sidecar store ${label} must decode to an object or array`);
  }
  return parsed;
}

function parseObject(text, label) {
  const parsed = parseJson(text, label);
  if (Array.isArray(parsed)) throw selectedDataError(`sidecar store ${label} must decode to an object`);
  return parsed;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rows(db, sql, parameters = []) {
  return db.prepare(sql).all(...parameters);
}

export function readStorePublication(db) {
  const statement = db.prepare("SELECT * FROM publication WHERE singleton = 1");
  statement.setReadBigInts(true);
  const row = statement.get();
  if (!row || typeof row.store_incarnation !== "string" || row.store_incarnation.length === 0) {
    throw new Error("sidecar store publication is missing or invalid");
  }
  if (typeof row.sequence !== "bigint" || row.sequence < 0n) {
    throw new Error("sidecar store publication sequence is invalid");
  }
  return {
    store_incarnation: row.store_incarnation,
    sequence: row.sequence.toString(),
    repository_commit: row.repository_commit,
    repository_tree: row.repository_tree,
    generator_identity: row.generator_identity,
    base_input_identity: parseObject(row.base_input_identity_json, "base input identity"),
    base_coverage: parseObject(row.base_coverage_json, "base coverage"),
    provider_input_identity: parseObject(
      row.provider_input_identity_json,
      "provider input identity"
    ),
    provider_coverage: parseObject(row.provider_coverage_json, "provider coverage"),
    counts: parseObject(row.counts_json, "counts"),
    published_at: row.published_at
  };
}

export function lookupStoreStringIds(db, values) {
  const found = new Map();
  for (const chunk of chunks(values, { allowEmpty: true })) {
    for (const row of rows(db, `SELECT sid, value FROM strings WHERE value IN (${marks(chunk)})`, chunk)) {
      found.set(row.value, row.sid);
    }
  }
  return found;
}

function lookupTermIds(db, values) {
  const found = new Map();
  for (const chunk of chunks(values)) {
    for (const row of rows(db,
      `SELECT term_id, value FROM vocabulary WHERE value IN (${marks(chunk)})`, chunk)) {
      found.set(row.value, row.term_id);
    }
  }
  return values.map((value) => found.get(value) ?? -1);
}

function fileRow(row) {
  const slash = row.path.lastIndexOf("/");
  return {
    path: row.path,
    blob_oid: row.blob_oid,
    mode: row.mode,
    directory_path: slash === -1 ? "" : row.path.slice(0, slash),
    input_identity: row.input_identity
  };
}

export function selectStoreFiles(db, paths) {
  const found = new Map();
  for (const chunk of chunks(paths)) {
    for (const row of rows(db, `SELECT path, blob_oid, mode, input_identity
       FROM files WHERE path IN (${marks(chunk)})`, chunk)) {
      found.set(row.path, fileRow(row));
    }
  }
  return [...found.values()].sort((left, right) => binaryCompare(left.path, right.path));
}

export function selectStoreDirectoryMembership(db, directories) {
  const found = new Map();
  for (const chunk of chunks(directories, { allowEmpty: true })) {
    const clauses = [];
    const parameters = [];
    for (const directory of chunk) {
      if (directory === "") {
        clauses.push("1 = 1");
        continue;
      }
      const prefix = directory.endsWith("/") ? directory : `${directory}/`;
      clauses.push("(path >= ? AND path < ?)");
      parameters.push(prefix, `${prefix.slice(0, -1)}0`);
    }
    for (const row of rows(db, `SELECT path, blob_oid, mode, input_identity FROM files
       WHERE ${clauses.join(" OR ")}`, parameters)) {
      found.set(row.path, fileRow(row));
    }
  }
  return [...found.values()].sort((left, right) => binaryCompare(left.path, right.path));
}

export function storeContributionKey(id, ordinal) {
  return `${id}\0${ordinal}`;
}

export function decodeStoreUnitPayload(bytes, unitKey) {
  const label = `extraction unit ${unitKey}`;
  const value = decodeSidecarStorePayload(bytes, label);
  if (!plainObject(value.facts) || !Array.isArray(value.node_contributions) ||
      !Array.isArray(value.edge_contributions)) {
    throw selectedDataError(`${label} payload shape is invalid`);
  }
  for (const contribution of [...value.node_contributions, ...value.edge_contributions]) {
    if (!plainObject(contribution) || !plainObject(contribution.attributes) ||
        typeof contribution.kind !== "string" || !Number.isSafeInteger(contribution.ordinal)) {
      throw selectedDataError(`${label} contribution shape is invalid`);
    }
  }
  return value;
}

export function storeUnitContributionAttributes(payload) {
  const nodes = new Map();
  const edges = new Map();
  for (const contribution of payload.node_contributions) {
    nodes.set(storeContributionKey(
      sidecarGraphNodeId(contribution.kind, contribution.key), contribution.ordinal
    ), contribution.attributes);
  }
  for (const contribution of payload.edge_contributions) {
    edges.set(storeContributionKey(sidecarGraphEdgeId(
      contribution.kind, contribution.from_node_id, contribution.to_node_id,
      contribution.discriminator
    ), contribution.ordinal), contribution.attributes);
  }
  return { nodes, edges };
}

export function materializeStoreNode(kind, id, attributeList) {
  if (!id.startsWith(`${kind}:`)) throw new Error(`node ${id} does not have kind ${kind}`);
  const key = id.slice(kind.length + 1);
  const builder = createGraphBuilder();
  for (const attributes of attributeList) {
    if (builder.addNode(kind, key, attributes) !== id) {
      throw new Error(`node contribution identity mismatch for ${id}`);
    }
  }
  return builder.graphNodes()[0];
}

export function materializeStoreEdge({ kind, from, to, discriminator, id }, attributeList) {
  const builder = createGraphBuilder();
  for (const attributes of attributeList) {
    if (builder.addEdge(kind, from, to, { ...attributes, discriminator }) !== id) {
      throw new Error(`edge contribution identity mismatch for ${id}`);
    }
  }
  return builder.graphEdges()[0];
}

function selectedMaterialization(label, materialize) {
  try {
    return materialize();
  } catch (cause) {
    throw cause?.code === "sidecar_selected_data_invalid"
      ? cause
      : selectedDataError(`stored ${label} cannot be materialized`, cause);
  }
}

function readSingleContributorAttributes(db, requests, element) {
  const byUnit = new Map();
  for (const request of requests) {
    if (!byUnit.has(request.uid)) byUnit.set(request.uid, []);
    byUnit.get(request.uid).push(request);
  }
  for (const chunk of chunkList([...byUnit.keys()])) {
    for (const unit of rows(db,
      `SELECT uid, unit_key, payload FROM units WHERE uid IN (${marks(chunk)})`, chunk)) {
      const contributions = storeUnitContributionAttributes(
        decodeStoreUnitPayload(unit.payload, unit.unit_key)
      )[element];
      for (const request of byUnit.get(unit.uid)) {
        const attributes = contributions.get(request.key);
        if (!attributes) {
          throw selectedDataError(`extraction unit ${unit.unit_key} lacks contribution ${request.key}`);
        }
        request.resolve(attributes);
      }
      byUnit.delete(unit.uid);
    }
  }
  if (byUnit.size > 0) throw selectedDataError("selected contribution owner unit is missing");
}

function singleMembers(db, table, column, ids) {
  const found = new Map();
  for (const chunk of chunkList(ids)) {
    for (const row of rows(db, `SELECT ${column} AS id, uid, ordinal FROM ${table}
      WHERE ${column} IN (${marks(chunk)})`, chunk)) {
      if (found.has(row.id)) {
        throw selectedDataError(`selected ${table} row ${row.id} has several contributors but no residual`);
      }
      found.set(row.id, row);
    }
  }
  for (const id of ids) {
    if (!found.has(id)) throw selectedDataError(`selected ${table} row ${id} has no contributor`);
  }
  return found;
}

export function selectStoreNodesBySid(db, nodeSids) {
  const nodes = [];
  const singles = [];
  for (const chunk of chunkList([...new Set(nodeSids)])) {
    for (const row of rows(db, `SELECT n.node_sid, s.value AS id, v.value AS kind, n.residual
      FROM nodes n JOIN strings s ON s.sid = n.node_sid
      JOIN vocabulary v ON v.term_id = n.kind_id WHERE n.node_sid IN (${marks(chunk)})`, chunk)) {
      if (row.residual === null) {
        singles.push(row);
        continue;
      }
      const attributes = decodeSidecarStorePayload(row.residual, `node ${row.id} residual`);
      nodes.push({ ...attributes, id: row.id, kind: row.kind });
    }
  }
  const members = singleMembers(db, "node_members", "node_sid", singles.map((row) => row.node_sid));
  readSingleContributorAttributes(db, singles.map((row) => {
    const member = members.get(row.node_sid);
    return {
      uid: member.uid,
      key: storeContributionKey(row.id, member.ordinal),
      resolve: (attributes) => nodes.push(selectedMaterialization(`node ${row.id}`,
        () => materializeStoreNode(row.kind, row.id, [attributes])))
    };
  }), "nodes");
  return nodes.sort((left, right) => binaryCompare(left.id, right.id));
}

export function selectStoreNodes(db, nodeIds) {
  return selectStoreNodesBySid(db, [...lookupStoreStringIds(db, nodeIds).values()]);
}

function selectStoreEdgesByEid(db, edgeIds) {
  const edges = [];
  const singles = [];
  for (const chunk of chunkList([...new Set(edgeIds)])) {
    for (const row of rows(db, `SELECT e.eid, e.from_sid, e.to_sid, e.discriminator, e.residual,
      v.value AS kind, f.value AS from_id, t.value AS to_id
      FROM edges e JOIN vocabulary v ON v.term_id = e.kind_id
      JOIN strings f ON f.sid = e.from_sid JOIN strings t ON t.sid = e.to_sid
      WHERE e.eid IN (${marks(chunk)})`, chunk)) {
      const identity = {
        kind: row.kind, from: row.from_id, to: row.to_id, discriminator: row.discriminator,
        id: sidecarGraphEdgeId(row.kind, row.from_id, row.to_id, row.discriminator)
      };
      const endpoints = { from_sid: row.from_sid, to_sid: row.to_sid };
      if (row.residual === null) {
        singles.push({ eid: row.eid, identity, endpoints });
        continue;
      }
      const attributes = decodeSidecarStorePayload(row.residual, `edge ${identity.id} residual`);
      edges.push({ ...attributes, id: identity.id, kind: row.kind,
        from_node_id: row.from_id, to_node_id: row.to_id, ...endpoints });
    }
  }
  const members = singleMembers(db, "edge_members", "eid", singles.map((row) => row.eid));
  readSingleContributorAttributes(db, singles.map((row) => {
    const member = members.get(row.eid);
    return {
      uid: member.uid,
      key: storeContributionKey(row.identity.id, member.ordinal),
      resolve: (attributes) => edges.push({
        ...selectedMaterialization(`edge ${row.identity.id}`,
          () => materializeStoreEdge(row.identity, [attributes])),
        ...row.endpoints
      })
    };
  }), "edges");
  return edges.sort((left, right) => binaryCompare(left.id, right.id));
}

function publicEdges(edges) {
  return edges.map(({ from_sid: _from, to_sid: _to, ...edge }) => edge);
}

function adjacentEdgeIds(db, nodeSids) {
  const found = new Set();
  for (const chunk of chunkList([...new Set(nodeSids)])) {
    for (const row of rows(db, `SELECT eid FROM edges WHERE from_sid IN (${marks(chunk)})
      UNION SELECT eid FROM edges WHERE to_sid IN (${marks(chunk)})`, [...chunk, ...chunk])) {
      found.add(row.eid);
    }
  }
  return found;
}

export function selectStoreAdjacency(db, nodeIds) {
  const sids = [...lookupStoreStringIds(db, nodeIds).values()];
  return publicEdges(selectStoreEdgesByEid(db, [...adjacentEdgeIds(db, sids)]));
}

function directoryPrefixes(relativePath) {
  const prefixes = [];
  for (let index = relativePath.indexOf("/"); index !== -1;
    index = relativePath.indexOf("/", index + 1)) {
    prefixes.push(relativePath.slice(0, index + 1));
  }
  return prefixes;
}

export function selectStoreGraphImpact(db, inputPaths) {
  const paths = [...new Set((inputPaths ?? []).filter((value) =>
    typeof value === "string" && value.length > 0
  ))];
  const [moduleKind, importsKind, cliKind, mcpKind, mentionsKind, coversKind, documentsKind,
    ownsKind] = lookupTermIds(db, ["module", "imports_module", "registers_cli_command",
    "registers_mcp_tool", "mentions_schema_field", "covers_test", "documents_contract",
    "owns_write_scope"]);
  const pathSids = [...lookupStoreStringIds(db, paths).values()];
  const nodeSids = new Set();
  const pathNodeSids = new Set();
  const availablePaths = new Set();
  for (const chunk of chunkList(pathSids)) {
    for (const row of rows(db, `SELECT n.node_sid, s.value AS path FROM nodes n
      JOIN strings s ON s.sid = n.path_sid WHERE n.path_sid IN (${marks(chunk)})`, chunk)) {
      availablePaths.add(row.path);
      nodeSids.add(row.node_sid);
      pathNodeSids.add(row.node_sid);
    }
  }
  const unavailablePaths = paths.filter((value) => !availablePaths.has(value));
  for (const sid of lookupStoreStringIds(db,
    paths.flatMap((inputPath) => [`module:${inputPath}`, `file:${inputPath}`])).values()) {
    nodeSids.add(sid);
  }
  const edgeIds = adjacentEdgeIds(db, [...nodeSids]);
  const impacted = new Set();
  for (const chunk of chunkList(pathSids)) {
    for (const row of rows(db, `WITH RECURSIVE impacted(sid) AS (
      SELECT node_sid FROM nodes WHERE kind_id = ? AND path_sid IN (${marks(chunk)})
      UNION SELECT e.from_sid FROM edges e JOIN impacted i ON e.to_sid = i.sid
        WHERE e.kind_id = ?
    ) SELECT sid FROM impacted`, [moduleKind, ...chunk, importsKind])) {
      impacted.add(row.sid);
    }
  }
  const collect = (column, sids, kinds) => {
    for (const chunk of chunkList([...sids])) {
      for (const row of rows(db, `SELECT eid FROM edges WHERE ${column} IN (${marks(chunk)})
        AND kind_id IN (${marks(kinds)})`, [...chunk, ...kinds])) {
        edgeIds.add(row.eid);
      }
    }
  };
  collect("to_sid", impacted, [importsKind]);
  collect("from_sid", impacted, [cliKind, mcpKind, mentionsKind]);
  collect("to_sid", pathNodeSids, [coversKind, documentsKind]);

  const requested = new Set(paths);
  const scopePathSids = [...lookupStoreStringIds(db,
    paths.flatMap((inputPath) => [inputPath, ...directoryPrefixes(inputPath)])).values()];
  const scopeNodeSids = new Set();
  for (const chunk of chunkList(scopePathSids)) {
    for (const row of rows(db, `SELECT n.node_sid, s.value AS path FROM nodes n
      JOIN strings s ON s.sid = n.path_sid WHERE n.path_sid IN (${marks(chunk)})`, chunk)) {
      if (requested.has(row.path) || row.path.endsWith("/")) scopeNodeSids.add(row.node_sid);
    }
  }
  collect("to_sid", scopeNodeSids, [ownsKind]);
  const edges = selectStoreEdgesByEid(db, [...edgeIds]);
  for (const edge of edges) {
    nodeSids.add(edge.from_sid);
    nodeSids.add(edge.to_sid);
  }
  const nodes = selectStoreNodesBySid(db, [...nodeSids]);
  return {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_nodes: nodes,
    graph_edges: publicEdges(edges),
    graph_metadata: {
      selection: "indexed_reachable",
      input_path_count: paths.length,
      node_count: nodes.length,
      edge_count: edges.length
    },
    unavailable_paths: unavailablePaths
  };
}

export function selectStoreProviders(db) {
  return rows(db, "SELECT provider_key, input_identity, metadata FROM providers ORDER BY provider_key")
    .map((row) => {
      const metadata = decodeSidecarStorePayload(row.metadata, `provider ${row.provider_key} metadata`);
      if (!plainObject(metadata.descriptor) || !plainObject(metadata.coverage)) {
        throw selectedDataError(`provider ${row.provider_key} metadata shape is invalid`);
      }
      return {
        provider_id: row.provider_key,
        descriptor: metadata.descriptor,
        input_identity: row.input_identity,
        coverage: metadata.coverage
      };
    });
}

export function selectStoreSymbols(db, rawSymbols) {
  const found = [];
  for (const chunk of chunkList([...lookupStoreStringIds(db, rawSymbols).values()])) {
    for (const row of rows(db, `SELECT p.provider_key, s.value AS symbol_id, r.value AS raw_symbol,
      ps.payload FROM provider_symbols ps JOIN providers p ON p.pid = ps.pid
      JOIN strings s ON s.sid = ps.symbol_sid JOIN strings r ON r.sid = ps.raw_sid
      WHERE ps.raw_sid IN (${marks(chunk)})`, chunk)) {
      const value = decodeSidecarStorePayload(row.payload, `symbol ${row.symbol_id}`);
      if (!plainObject(value.payload) ||
          !(value.document_path === null || typeof value.document_path === "string")) {
        throw selectedDataError(`symbol ${row.symbol_id} payload shape is invalid`);
      }
      found.push({
        provider_id: row.provider_key,
        symbol_id: row.symbol_id,
        raw_symbol: row.raw_symbol,
        document_path: value.document_path,
        payload: value.payload
      });
    }
  }
  return found.sort((left, right) => binaryCompare(left.raw_symbol, right.raw_symbol) ||
    binaryCompare(left.provider_id, right.provider_id) ||
    binaryCompare(left.symbol_id, right.symbol_id));
}

function forEachSelectedDocument(db, column, ids, visit) {
  for (const chunk of chunkList([...new Set(ids)])) {
    for (const row of rows(db, `SELECT d.did, d.occurrence_count, d.symbol_edge_count, d.payload,
      p.provider_key, s.value AS document_path FROM provider_documents d
      JOIN providers p ON p.pid = d.pid JOIN strings s ON s.sid = d.document_sid
      WHERE d.${column} IN (${marks(chunk)})`, chunk)) {
      const label = `provider ${row.provider_key} document ${row.document_path}`;
      const value = decodeSidecarStorePayload(row.payload, label);
      if (!Array.isArray(value.occurrences) || !Array.isArray(value.symbol_edges) ||
          value.occurrences.length !== row.occurrence_count ||
          value.symbol_edges.length !== row.symbol_edge_count) {
        throw selectedDataError(`${label} payload shape is invalid`);
      }
      visit(row, value);
    }
  }
}

function referencedDocumentIds(db, sids) {
  const found = new Set();
  for (const chunk of chunkList(sids)) {
    for (const row of rows(db,
      `SELECT DISTINCT did FROM provider_document_refs WHERE sid IN (${marks(chunk)})`, chunk)) {
      found.add(row.did);
    }
  }
  return found;
}

function occurrenceRow(document, occurrence) {
  if (!plainObject(occurrence) || typeof occurrence.symbol_id !== "string" ||
      !Array.isArray(occurrence.range) || occurrence.range.length !== 4) {
    throw selectedDataError(`occurrence in ${document.document_path} is invalid`);
  }
  return {
    provider_id: document.provider_key,
    symbol_id: occurrence.symbol_id,
    document_path: document.document_path,
    contribution_id: occurrence.contribution_id,
    document_ordinal: occurrence.document_ordinal,
    occurrence_ordinal: occurrence.occurrence_ordinal,
    range: occurrence.range,
    roles: occurrence.roles,
    payload: occurrence.payload
  };
}

function selectReferencedOccurrences(db, symbolIds, include) {
  const found = [];
  const sids = [...lookupStoreStringIds(db, symbolIds).values()];
  forEachSelectedDocument(db, "did", [...referencedDocumentIds(db, sids)], (document, value) => {
    for (const occurrence of value.occurrences) {
      const row = occurrenceRow(document, occurrence);
      if (include(row)) found.push(row);
    }
  });
  return found.sort((left, right) => binaryCompare(left.provider_id, right.provider_id) ||
    binaryCompare(left.symbol_id, right.symbol_id) ||
    binaryCompare(left.document_path, right.document_path) ||
    left.document_ordinal - right.document_ordinal ||
    left.occurrence_ordinal - right.occurrence_ordinal);
}

export function selectStoreOccurrences(db, symbolIds) {
  const wanted = new Set(symbolIds ?? []);
  return selectReferencedOccurrences(db, symbolIds, (row) => wanted.has(row.symbol_id));
}

export function selectStoreSymbolOccurrences(db, symbols) {
  const keys = new Set(symbols.map(({ provider_id: providerId, symbol_id: symbolId }) =>
    `${providerId}\0${symbolId}`));
  return selectReferencedOccurrences(db, symbols.map(({ symbol_id: symbolId }) => symbolId),
    (row) => keys.has(`${row.provider_id}\0${row.symbol_id}`));
}

export function selectStoreOccurrencesByDocument(db, documentPaths) {
  const found = [];
  forEachSelectedDocument(db, "document_sid",
    [...lookupStoreStringIds(db, documentPaths).values()], (document, value) => {
      for (const occurrence of value.occurrences) found.push(occurrenceRow(document, occurrence));
    });
  return found.sort((left, right) => binaryCompare(left.document_path, right.document_path) ||
    left.range[0] - right.range[0] || left.range[1] - right.range[1] ||
    left.occurrence_ordinal - right.occurrence_ordinal ||
    binaryCompare(left.provider_id, right.provider_id) ||
    binaryCompare(left.symbol_id, right.symbol_id));
}

function symbolEdgeRow(providerId, documentPath, edge) {
  if (!plainObject(edge) || typeof edge.edge_id !== "string" || typeof edge.kind !== "string") {
    throw selectedDataError(`symbol edge of provider ${providerId} is invalid`);
  }
  return {
    provider_id: providerId,
    edge_id: edge.edge_id,
    kind: edge.kind,
    from_symbol: edge.from_symbol ?? null,
    to_symbol: edge.to_symbol ?? null,
    document_path: documentPath,
    line: edge.line ?? null,
    payload: edge.payload
  };
}

function compareSymbolEdges(left, right) {
  return binaryCompare(left.provider_id, right.provider_id) ||
    binaryCompare(left.edge_id, right.edge_id);
}

export function selectStoreSymbolEdges(db, rawSymbols) {
  const wanted = new Set(rawSymbols ?? []);
  const sids = [...lookupStoreStringIds(db, rawSymbols).values()];
  const found = [];
  forEachSelectedDocument(db, "did", [...referencedDocumentIds(db, sids)], (document, value) => {
    for (const edge of value.symbol_edges) {
      const row = symbolEdgeRow(document.provider_key, document.document_path, edge);
      if (wanted.has(row.from_symbol) || wanted.has(row.to_symbol)) found.push(row);
    }
  });

  for (const chunk of chunkList(sids)) {
    for (const row of rows(db, `SELECT p.provider_key, f.value AS from_symbol,
      t.value AS to_symbol, e.payload FROM provider_symbol_edges e
      JOIN providers p ON p.pid = e.pid
      LEFT JOIN strings f ON f.sid = e.from_sid LEFT JOIN strings t ON t.sid = e.to_sid
      WHERE e.seid IN (SELECT seid FROM provider_symbol_edges WHERE from_sid IN (${marks(chunk)})
        UNION SELECT seid FROM provider_symbol_edges WHERE to_sid IN (${marks(chunk)}))`,
    [...chunk, ...chunk])) {
      const value = decodeSidecarStorePayload(row.payload, `symbol edge of provider ${row.provider_key}`);
      found.push(symbolEdgeRow(row.provider_key, null, {
        ...value, from_symbol: row.from_symbol, to_symbol: row.to_symbol
      }));
    }
  }
  return [...new Map(found.map((edge) => [`${edge.provider_id}\0${edge.edge_id}`, edge])).values()]
    .sort(compareSymbolEdges);
}

export function selectStoreSymbolEdgesByDocument(db, documentPaths) {
  const found = [];
  forEachSelectedDocument(db, "document_sid",
    [...lookupStoreStringIds(db, documentPaths).values()], (document, value) => {
      for (const edge of value.symbol_edges) {
        found.push(symbolEdgeRow(document.provider_key, document.document_path, edge));
      }
    });
  return found.sort((left, right) => binaryCompare(left.document_path, right.document_path) ||
    (left.line ?? -1) - (right.line ?? -1) || compareSymbolEdges(left, right));
}

export function selectStoreCounts(db) {
  const value = (sql) => {
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    return BigInt(statement.get().count ?? 0n);
  };
  const count = (table) => value(`SELECT count(*) AS count FROM ${table}`).toString();
  return {
    files: count("files"),
    extraction_units: count("units"),
    nodes: count("nodes"),
    edges: count("edges"),
    providers: count("providers"),
    symbols: count("provider_symbols"),
    occurrences: value("SELECT sum(occurrence_count) AS count FROM provider_documents").toString(),
    symbol_edges: (value("SELECT sum(symbol_edge_count) AS count FROM provider_documents") +
      value("SELECT count(*) AS count FROM provider_symbol_edges")).toString()
  };
}
