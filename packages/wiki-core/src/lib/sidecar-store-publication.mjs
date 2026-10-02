import { sidecarGraphEdgeId, sidecarGraphNodeId } from "./sidecar-graph-contributions.mjs";
import { isConcreteSidecarCommit } from "./sidecar-repository-identity.mjs";
import {
  decodeSidecarStorePayload,
  encodeSidecarStorePayload,
  prepareSidecarStorePayload,
  readSidecarStorePayload,
  reuseOrEncodeSidecarStorePayload,
  samePreparedSidecarStorePayload,
  sameSidecarStorePayload
} from "./sidecar-store-codec.mjs";
import {
  assertStoreSymbolEdge,
  binaryCompare,
  decodeStoreUnitPayload,
  materializeStoreEdge,
  materializeStoreNode,
  readStorePublication,
  selectStoreCounts,
  selectedDataError,
  storeContributionKey,
  storeUnitContributionAttributes
} from "./sidecar-store-queries.mjs";
import { SIDECAR_STORE_STRING_REFERENCES } from "./sidecar-store-schema.mjs";

export const SIDECAR_PREPARED_DELTA_REFUSAL_CODES = Object.freeze({
  TRANSACTION_OPEN: "sidecar_publication_transaction_open",
  PREDECESSOR_STALE: "sidecar_prepared_delta_predecessor_stale",
  SEQUENCE_INVALID: "sidecar_publication_sequence_invalid"
});

export class SidecarPreparedDeltaRefusalError extends Error {
  constructor(message, { code }) {
    super(message);
    this.name = "SidecarPreparedDeltaRefusalError";
    this.code = code;
  }
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${label} must be a non-empty NUL-free string`);
  }
  return value;
}

function json(value, label) {
  plainObject(value, label);
  return JSON.stringify(value);
}

function safeOrdinal(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function attributes(value, label) {
  const object = plainObject(value, label);
  for (const reserved of ["id", "kind", "from_node_id", "to_node_id", "discriminator"]) {
    if (Object.hasOwn(object, reserved)) {
      throw new TypeError(`${label} must not contain reserved field ${reserved}`);
    }
  }
  return object;
}

function compareContributions(left, right) {
  return binaryCompare(left.path, right.path) ||
    left.ordinal - right.ordinal ||
    binaryCompare(left.unit_key, right.unit_key);
}

function createStoreWriter(db) {
  const statements = new Map();
  const prepare = (sql) => {
    if (!statements.has(sql)) statements.set(sql, db.prepare(sql));
    return statements.get(sql);
  };
  const interned = (table, key) => {
    const cache = new Map();
    return (value) => {
      if (cache.has(value)) return cache.get(value);
      prepare(`INSERT INTO ${table}(value) VALUES (?) ON CONFLICT(value) DO NOTHING`).run(value);
      const id = prepare(`SELECT ${key} AS id FROM ${table} WHERE value = ?`).get(value).id;
      cache.set(value, id);
      return id;
    };
  };
  return {
    db,
    prepare,
    intern: interned("strings", "sid"),
    term: interned("vocabulary", "term_id"),
    released: new Set()
  };
}

function releaseSelected(writer, sql, ...parameters) {
  for (const row of writer.prepare(sql).all(...parameters)) {
    if (row.sid !== null) writer.released.add(row.sid);
  }
}

function detachUnit(writer, uid, affected) {
  for (const row of writer.prepare("SELECT node_sid FROM node_members WHERE uid = ?").all(uid)) {
    affected.nodes.add(row.node_sid);
  }
  for (const row of writer.prepare("SELECT eid FROM edge_members WHERE uid = ?").all(uid)) {
    affected.edges.add(row.eid);
  }
  releaseSelected(writer, "SELECT candidate_sid AS sid FROM resolution_candidates WHERE uid = ?", uid);
}

function upsertFiles(writer, change, affected) {
  for (const pathValue of change?.delete ?? []) {
    const relativePath = nonEmpty(pathValue, "file path");
    const file = writer.prepare("SELECT fid FROM files WHERE path = ?").get(relativePath);
    if (!file) continue;
    for (const unit of writer.prepare("SELECT uid FROM units WHERE fid = ?").all(file.fid)) {
      detachUnit(writer, unit.uid, affected);
    }
    writer.prepare("DELETE FROM files WHERE fid = ?").run(file.fid);
  }
  const upsert = writer.prepare(`INSERT INTO files(path, blob_oid, mode, input_identity)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET blob_oid=excluded.blob_oid, mode=excluded.mode,
      input_identity=excluded.input_identity
    WHERE files.blob_oid IS NOT excluded.blob_oid OR files.mode IS NOT excluded.mode
      OR files.input_identity IS NOT excluded.input_identity`);
  for (const file of change?.upsert ?? []) {
    plainObject(file, "file");
    const relativePath = nonEmpty(file.path, "file.path");
    const slash = relativePath.lastIndexOf("/");
    const directory = slash === -1 ? "" : relativePath.slice(0, slash);
    if (file.directory_path !== undefined && file.directory_path !== directory) {
      throw new TypeError(`file.directory_path must be '${directory}' for ${relativePath}`);
    }
    upsert.run(
      relativePath,
      nonEmpty(file.blob_oid, "file.blob_oid"),
      nonEmpty(file.mode, "file.mode"),
      nonEmpty(file.input_identity, "file.input_identity")
    );
  }
}

function normalizeUnit(unit, sourcePath) {
  const nodes = (unit.node_contributions ?? []).map((contribution, ordinal) => {
    const kind = nonEmpty(contribution.kind, "node contribution kind");
    const key = nonEmpty(contribution.key, "node contribution key");
    return {
      id: sidecarGraphNodeId(kind, key),
      kind,
      key,
      ordinal: safeOrdinal(contribution.ordinal ?? ordinal, "node contribution ordinal"),
      attributes: attributes(contribution.attributes ?? {}, "node contribution attributes")
    };
  });
  const edges = (unit.edge_contributions ?? []).map((contribution, ordinal) => {
    const kind = nonEmpty(contribution.kind, "edge contribution kind");
    const from = nonEmpty(contribution.from_node_id, "edge contribution from_node_id");
    const to = nonEmpty(contribution.to_node_id, "edge contribution to_node_id");
    const discriminator = contribution.discriminator ?? "";
    if (typeof discriminator !== "string") throw new TypeError("edge discriminator must be a string");
    return {
      id: sidecarGraphEdgeId(kind, from, to, discriminator),
      kind,
      from_node_id: from,
      to_node_id: to,
      discriminator,
      ordinal: safeOrdinal(contribution.ordinal ?? ordinal, "edge contribution ordinal"),
      attributes: attributes(contribution.attributes ?? {}, "edge contribution attributes")
    };
  });
  const dependencies = (unit.resolution_dependencies ?? []).map((dependency, ordinal) => ({
    ordinal: safeOrdinal(dependency.candidate_ordinal ?? ordinal, "dependency.candidate_ordinal"),
    candidate_path: nonEmpty(dependency.candidate_path, "dependency.candidate_path"),
    resolution_state: nonEmpty(dependency.resolution_state, "dependency.resolution_state")
  })).sort((left, right) => left.ordinal - right.ordinal);
  const payload = encodeSidecarStorePayload({
    facts: plainObject(unit.facts ?? {}, `extraction unit ${unit.unit_id} facts`),
    node_contributions: nodes.map(({ kind, key, ordinal, attributes: value }) =>
      ({ kind, key, ordinal, attributes: value })),
    edge_contributions: edges.map(({ id: _id, ...contribution }) => contribution)
  }, `extraction unit ${unit.unit_id} (${sourcePath})`);
  return { nodes, edges, dependencies, payload };
}

function sameDependencies(writer, uid, dependencies) {
  const stored = writer.prepare(`SELECT r.ordinal, s.value AS candidate_path, v.value AS state
    FROM resolution_candidates r JOIN strings s ON s.sid = r.candidate_sid
    JOIN vocabulary v ON v.term_id = r.state_id WHERE r.uid = ? ORDER BY r.ordinal`).all(uid);
  return stored.length === dependencies.length && stored.every((row, index) =>
    row.ordinal === dependencies[index].ordinal &&
    row.candidate_path === dependencies[index].candidate_path &&
    row.state === dependencies[index].resolution_state);
}

function replaceUnits(writer, units, affected, changedAttributes) {
  for (const unit of units ?? []) {
    plainObject(unit, "extraction unit");
    const unitKey = nonEmpty(unit.unit_id, "unit.unit_id");
    const existing = writer.prepare(`SELECT uid, fid, provider_kind_id, input_identity, payload
      FROM units WHERE unit_key = ?`).get(unitKey);
    if (unit.remove === true) {
      if (existing) {
        detachUnit(writer, existing.uid, affected);
        writer.prepare("DELETE FROM units WHERE uid = ?").run(existing.uid);
      }
      continue;
    }
    const sourcePath = nonEmpty(unit.source_path, "unit.source_path");
    const file = writer.prepare("SELECT fid FROM files WHERE path = ?").get(sourcePath);
    if (!file) throw new Error(`sidecar extraction unit ${unitKey} source ${sourcePath} is not a stored file`);
    const inputIdentity = nonEmpty(unit.input_identity, "unit.input_identity");
    const providerKindId = writer.term(nonEmpty(unit.provider_kind, "unit.provider_kind"));
    const prepared = normalizeUnit(unit, sourcePath);
    if (existing && existing.fid === file.fid && existing.provider_kind_id === providerKindId &&
        existing.input_identity === inputIdentity &&
        sameSidecarStorePayload(existing.payload, prepared.payload) &&
        sameDependencies(writer, existing.uid, prepared.dependencies)) {
      continue;
    }
    let uid;
    if (existing) {
      uid = existing.uid;
      detachUnit(writer, uid, affected);
      writer.prepare("DELETE FROM node_members WHERE uid = ?").run(uid);
      writer.prepare("DELETE FROM edge_members WHERE uid = ?").run(uid);
      writer.prepare("DELETE FROM resolution_candidates WHERE uid = ?").run(uid);
      writer.prepare(`UPDATE units SET fid = ?, provider_kind_id = ?, input_identity = ?,
        payload = ? WHERE uid = ?`).run(file.fid, providerKindId, inputIdentity, prepared.payload, uid);
    } else {
      uid = Number(writer.prepare(`INSERT INTO units(unit_key, fid, provider_kind_id,
        input_identity, payload) VALUES (?, ?, ?, ?, ?)`).run(
        unitKey, file.fid, providerKindId, inputIdentity, prepared.payload
      ).lastInsertRowid);
    }
    for (const dependency of prepared.dependencies) {
      writer.prepare(`INSERT INTO resolution_candidates(uid, ordinal, candidate_sid, state_id)
        VALUES (?, ?, ?, ?)`).run(uid, dependency.ordinal, writer.intern(dependency.candidate_path),
        writer.term(dependency.resolution_state));
    }
    const contributed = { nodes: new Map(), edges: new Map() };
    for (const node of prepared.nodes) {
      const sid = writer.intern(node.id);
      writer.prepare("INSERT INTO nodes(node_sid, kind_id) VALUES (?, ?) ON CONFLICT(node_sid) DO NOTHING")
        .run(sid, writer.term(node.kind));
      writer.prepare("INSERT INTO node_members(uid, node_sid, ordinal) VALUES (?, ?, ?)")
        .run(uid, sid, node.ordinal);
      affected.nodes.add(sid);
      contributed.nodes.set(storeContributionKey(node.id, node.ordinal), node.attributes);
    }
    for (const edge of prepared.edges) {
      const identity = [writer.intern(edge.from_node_id), writer.term(edge.kind),
        writer.intern(edge.to_node_id), edge.discriminator];
      writer.prepare(`INSERT INTO edges(from_sid, kind_id, to_sid, discriminator) VALUES (?, ?, ?, ?)
        ON CONFLICT(from_sid, kind_id, to_sid, discriminator) DO NOTHING`).run(...identity);
      const { eid } = writer.prepare(`SELECT eid FROM edges WHERE from_sid = ? AND kind_id = ?
        AND to_sid = ? AND discriminator = ?`).get(...identity);
      writer.prepare("INSERT INTO edge_members(uid, eid, ordinal) VALUES (?, ?, ?)")
        .run(uid, eid, edge.ordinal);
      affected.edges.add(eid);
      contributed.edges.set(storeContributionKey(edge.id, edge.ordinal), edge.attributes);
    }
    changedAttributes.set(uid, contributed);
  }
}

function resolveMemberAttributes(writer, plans, changedAttributes, element) {
  const pending = new Map();
  for (const plan of plans) {
    plan.attributes = new Array(plan.members.length);
    plan.members.forEach((member, index) => {
      const key = storeContributionKey(plan.id, member.ordinal);
      const changed = changedAttributes.get(member.uid)?.[element].get(key);
      if (changed) {
        plan.attributes[index] = changed;
      } else if (member.residual !== null) {
        plan.attributes[index] = decodeSidecarStorePayload(member.residual,
          `${element} ${plan.id} contribution residual`);
      } else {
        if (!pending.has(member.uid)) pending.set(member.uid, []);
        pending.get(member.uid).push({ key, assign: (value) => { plan.attributes[index] = value; } });
      }
    });
  }
  for (const [uid, requests] of pending) {
    const unit = writer.prepare("SELECT unit_key, payload FROM units WHERE uid = ?").get(uid);
    const contributions = storeUnitContributionAttributes(
      decodeStoreUnitPayload(unit.payload, unit.unit_key)
    )[element];
    for (const request of requests) {
      const value = contributions.get(request.key);
      if (!value) throw new Error(`extraction unit ${unit.unit_key} lacks contribution ${request.key}`);
      request.assign(value);
    }
  }
}

function writeMemberResiduals(writer, table, column, plan, rowId) {
  for (const [index, member] of plan.members.entries()) {
    const residual = plan.members.length > 1
      ? encodeSidecarStorePayload(plan.attributes[index], `${plan.id} contribution residual`)
      : null;
    if (sameSidecarStorePayload(member.residual, residual)) continue;
    writer.prepare(`UPDATE ${table} SET residual = ? WHERE uid = ? AND ${column} = ? AND ordinal = ?`)
      .run(residual, member.uid, rowId, member.ordinal);
  }
}

function sortedMembers(writer, table, column, rowId) {
  return writer.prepare(`SELECT m.uid, m.ordinal, m.residual, u.unit_key, f.path
    FROM ${table} m JOIN units u ON u.uid = m.uid JOIN files f ON f.fid = u.fid
    WHERE m.${column} = ?`).all(rowId).sort(compareContributions);
}

function recomputeAggregates(writer, affected, changedAttributes) {
  const nodePlans = [];
  const deletedNodes = [];
  for (const sid of affected.nodes) {
    const node = writer.prepare(`SELECT n.path_sid, n.residual, s.value AS id, v.value AS kind
      FROM nodes n JOIN strings s ON s.sid = n.node_sid JOIN vocabulary v ON v.term_id = n.kind_id
      WHERE n.node_sid = ?`).get(sid);
    if (!node) continue;
    const members = sortedMembers(writer, "node_members", "node_sid", sid);
    if (members.length === 0) {
      writer.prepare("DELETE FROM nodes WHERE node_sid = ?").run(sid);
      writer.released.add(sid);
      if (node.path_sid !== null) writer.released.add(node.path_sid);
      deletedNodes.push({ sid, id: node.id });
      continue;
    }
    nodePlans.push({ sid, ...node, members });
  }
  const edgePlans = [];
  for (const eid of affected.edges) {
    const edge = writer.prepare(`SELECT e.from_sid, e.to_sid, e.discriminator, e.residual,
      v.value AS kind, f.value AS from_id, t.value AS to_id
      FROM edges e JOIN vocabulary v ON v.term_id = e.kind_id
      JOIN strings f ON f.sid = e.from_sid JOIN strings t ON t.sid = e.to_sid
      WHERE e.eid = ?`).get(eid);
    if (!edge) continue;
    const members = sortedMembers(writer, "edge_members", "eid", eid);
    if (members.length === 0) {
      writer.prepare("DELETE FROM edges WHERE eid = ?").run(eid);
      continue;
    }
    edgePlans.push({
      eid, ...edge, members,
      id: sidecarGraphEdgeId(edge.kind, edge.from_id, edge.to_id, edge.discriminator)
    });
  }
  resolveMemberAttributes(writer, nodePlans, changedAttributes, "nodes");
  resolveMemberAttributes(writer, edgePlans, changedAttributes, "edges");

  for (const plan of nodePlans) {
    const { id: _id, kind: _kind, ...rest } = materializeStoreNode(plan.kind, plan.id, plan.attributes);
    const pathSid = typeof rest.path === "string" ? writer.intern(rest.path) : null;
    const residual = plan.members.length > 1
      ? encodeSidecarStorePayload(rest, `node ${plan.id} residual`)
      : null;
    if (plan.path_sid !== pathSid || !sameSidecarStorePayload(plan.residual, residual)) {
      if (plan.path_sid !== null && plan.path_sid !== pathSid) writer.released.add(plan.path_sid);
      writer.prepare("UPDATE nodes SET path_sid = ?, residual = ? WHERE node_sid = ?")
        .run(pathSid, residual, plan.sid);
    }
    writeMemberResiduals(writer, "node_members", "node_sid", plan, plan.sid);
  }
  for (const plan of edgePlans) {
    const {
      id: _id, kind: _kind, from_node_id: _from, to_node_id: _to, ...rest
    } = materializeStoreEdge({ kind: plan.kind, from: plan.from_id, to: plan.to_id,
      discriminator: plan.discriminator, id: plan.id }, plan.attributes);
    const residual = plan.members.length > 1
      ? encodeSidecarStorePayload(rest, `edge ${plan.id} residual`)
      : null;
    if (!sameSidecarStorePayload(plan.residual, residual)) {
      writer.prepare("UPDATE edges SET residual = ? WHERE eid = ?").run(residual, plan.eid);
    }
    writeMemberResiduals(writer, "edge_members", "eid", plan, plan.eid);
  }

  const nodeExists = writer.prepare("SELECT 1 AS present FROM nodes WHERE node_sid = ?");
  for (const plan of edgePlans) {
    if (!nodeExists.get(plan.from_sid) || !nodeExists.get(plan.to_sid)) {
      throw new Error(`sidecar edge ${plan.id} has a missing endpoint`);
    }
  }
  const incident = writer.prepare(`SELECT e.discriminator, v.value AS kind, f.value AS from_id,
    t.value AS to_id FROM edges e JOIN vocabulary v ON v.term_id = e.kind_id
    JOIN strings f ON f.sid = e.from_sid JOIN strings t ON t.sid = e.to_sid
    WHERE e.eid IN (SELECT eid FROM edges WHERE from_sid = ? UNION SELECT eid FROM edges WHERE to_sid = ?)
    LIMIT 1`);
  for (const node of deletedNodes) {
    const edge = incident.get(node.sid, node.sid);
    if (edge) {
      throw new Error(`sidecar edge ${sidecarGraphEdgeId(edge.kind, edge.from_id, edge.to_id,
        edge.discriminator)} has a missing endpoint`);
    }
  }
}

function storedProvider(providerIds, providerId, label) {
  const id = nonEmpty(providerId, `${label}.provider_id`);
  if (!providerIds.has(id)) throw new Error(`sidecar ${label} provider ${id} is not published`);
  return id;
}

function normalizeProviderInput(delta) {
  const providers = new Map();
  for (const provider of delta.providers ?? []) {
    const key = nonEmpty(provider.provider_id, "provider.provider_id");
    if (providers.has(key)) throw new Error(`sidecar provider ${key} is duplicated`);
    providers.set(key, {
      input_identity: nonEmpty(provider.input_identity, "provider.input_identity"),
      metadata: {
        descriptor: plainObject(provider.descriptor, "provider.descriptor"),
        coverage: plainObject(provider.coverage, "provider.coverage")
      }
    });
  }
  const symbols = new Map();
  for (const symbol of delta.symbols ?? []) {
    const providerId = storedProvider(providers, symbol.provider_id, "symbol");
    const symbolId = nonEmpty(symbol.symbol_id, "symbol.symbol_id");
    const documentPath = symbol.document_path ?? null;
    if (documentPath !== null) nonEmpty(documentPath, "symbol.document_path");
    const key = `${providerId}\0${symbolId}`;
    if (symbols.has(key)) throw new Error(`sidecar symbol ${key} is duplicated`);
    symbols.set(key, {
      providerId,
      symbolId,
      rawSymbol: nonEmpty(symbol.raw_symbol, "symbol.raw_symbol"),
      payload: { document_path: documentPath,
        payload: plainObject(symbol.payload ?? {}, "symbol.payload") }
    });
  }
  const documents = new Map();
  const document = (providerId, documentPath) => {
    const key = `${providerId}\0${documentPath}`;
    if (!documents.has(key)) {
      documents.set(key, { providerId, documentPath, occurrences: [], symbol_edges: [], refs: new Set() });
    }
    return documents.get(key);
  };
  const occurrenceKeys = new Set();
  for (const occurrence of delta.occurrences ?? []) {
    const providerId = storedProvider(providers, occurrence.provider_id, "occurrence");
    const symbolId = nonEmpty(occurrence.symbol_id, "occurrence.symbol_id");
    if (!symbols.has(`${providerId}\0${symbolId}`)) {
      throw new Error(`sidecar occurrence symbol ${symbolId} is not published`);
    }
    if (!Array.isArray(occurrence.range) || occurrence.range.length !== 4) {
      throw new TypeError("occurrence.range must contain four positions");
    }
    const range = occurrence.range.map((value, index) =>
      safeOrdinal(value, `occurrence.range[${index}]`));
    if (range[2] < range[0] || (range[2] === range[0] && range[3] < range[1])) {
      throw new TypeError("occurrence.range end must not precede its start");
    }
    const documentPath = nonEmpty(occurrence.document_path, "occurrence.document_path");
    const record = {
      symbol_id: symbolId,
      contribution_id: nonEmpty(occurrence.contribution_id, "occurrence.contribution_id"),
      document_ordinal: safeOrdinal(occurrence.document_ordinal, "occurrence.document_ordinal"),
      occurrence_ordinal: safeOrdinal(occurrence.occurrence_ordinal, "occurrence.occurrence_ordinal"),
      range,
      roles: safeOrdinal(occurrence.roles ?? 0, "occurrence.roles"),
      payload: plainObject(occurrence.payload ?? {}, "occurrence.payload")
    };
    const key = [providerId, symbolId, documentPath, record.contribution_id,
      record.document_ordinal, record.occurrence_ordinal].join("\0");
    if (occurrenceKeys.has(key)) throw new Error(`sidecar occurrence ${key} is duplicated`);
    occurrenceKeys.add(key);
    const target = document(providerId, documentPath);
    target.occurrences.push(record);
    target.refs.add(symbolId);
  }
  const edgeKeys = new Set();
  const externalEdges = new Map();
  for (const edge of delta.symbol_edges ?? []) {
    const providerId = storedProvider(providers, edge.provider_id, "symbol edge");
    const record = {
      edge_id: nonEmpty(edge.edge_id, "symbol edge edge_id"),
      kind: nonEmpty(edge.kind, "symbol edge kind"),
      from_symbol: edge.from_symbol ?? null,
      to_symbol: edge.to_symbol ?? null,
      line: edge.line === null || edge.line === undefined ? null : safeOrdinal(edge.line, "symbol edge line"),
      payload: plainObject(edge.payload ?? {}, "symbol edge payload")
    };
    for (const field of ["from_symbol", "to_symbol"]) {
      if (record[field] !== null) nonEmpty(record[field], `symbol edge ${field}`);
    }
    const key = `${providerId}\0${record.edge_id}`;
    if (edgeKeys.has(key)) throw new Error(`sidecar symbol edge ${key} is duplicated`);
    edgeKeys.add(key);
    const documentPath = edge.document_path ?? null;
    if (documentPath === null) {
      const { from_symbol: from, to_symbol: to, ...payload } = record;
      externalEdges.set(key, { providerId, from, to, payload, seid: null, relinked: null });
      continue;
    }
    const target = document(providerId, nonEmpty(documentPath, "symbol edge document_path"));
    target.symbol_edges.push(record);
    for (const symbol of [record.from_symbol, record.to_symbol]) {
      if (symbol !== null) target.refs.add(symbol);
    }
  }
  return { providers, symbols, documents, externalEdges };
}

function providerScope(delta, input) {
  if (delta.provider_keys === undefined) return null;
  if (!Array.isArray(delta.provider_keys)) throw new TypeError("provider_keys must be an array");
  const scope = new Set(delta.provider_keys.map((key) => nonEmpty(key, "provider_keys entry")));
  for (const key of input.providers.keys()) {
    if (!scope.has(key)) throw new Error(`sidecar provider ${key} is outside provider_keys`);
  }
  return scope;
}

function replaceProviderData(writer, delta) {
  if (delta.replace_provider_data !== true) {
    for (const field of ["providers", "symbols", "occurrences", "symbol_edges", "provider_keys"]) {
      const supplied = delta[field];
      if (supplied !== undefined && (!Array.isArray(supplied) || supplied.length > 0)) {
        throw new TypeError(`${field} requires replace_provider_data=true`);
      }
    }
    return;
  }
  const input = normalizeProviderInput(delta);
  const scope = providerScope(delta, input);
  const scopedProviders = writer.prepare("SELECT pid, provider_key FROM providers").all()
    .filter(({ provider_key: key }) => scope === null || scope.has(key));
  const providerIds = new Map();
  for (const [key, provider] of input.providers) {
    const existing = writer.prepare(
      "SELECT pid, input_identity, metadata FROM providers WHERE provider_key = ?"
    ).get(key);
    const metadata = reuseOrEncodeSidecarStorePayload(
      prepareSidecarStorePayload(provider.metadata, `provider ${key} metadata`), existing?.metadata);
    if (!existing) {
      providerIds.set(key, Number(writer.prepare(`INSERT INTO providers(provider_key, input_identity,
        metadata) VALUES (?, ?, ?)`).run(key, provider.input_identity, metadata).lastInsertRowid));
      continue;
    }
    if (existing.input_identity !== provider.input_identity || metadata !== existing.metadata) {
      writer.prepare("UPDATE providers SET input_identity = ?, metadata = ? WHERE pid = ?")
        .run(provider.input_identity, metadata, existing.pid);
    }
    providerIds.set(key, existing.pid);
  }

  const keptSymbols = new Set();
  for (const symbol of input.symbols.values()) {
    const pid = providerIds.get(symbol.providerId);
    const symbolSid = writer.intern(symbol.symbolId);
    const rawSid = writer.intern(symbol.rawSymbol);
    const existing = writer.prepare(
      "SELECT raw_sid, payload FROM provider_symbols WHERE symbol_sid = ? AND pid = ?"
    ).get(symbolSid, pid);
    const payload = reuseOrEncodeSidecarStorePayload(
      prepareSidecarStorePayload(symbol.payload, `symbol ${symbol.symbolId}`), existing?.payload);
    if (!existing) {
      writer.prepare("INSERT INTO provider_symbols(symbol_sid, pid, raw_sid, payload) VALUES (?, ?, ?, ?)")
        .run(symbolSid, pid, rawSid, payload);
    } else if (existing.raw_sid !== rawSid || payload !== existing.payload) {
      if (existing.raw_sid !== rawSid) writer.released.add(existing.raw_sid);
      writer.prepare("UPDATE provider_symbols SET raw_sid = ?, payload = ? WHERE symbol_sid = ? AND pid = ?")
        .run(rawSid, payload, symbolSid, pid);
    }
    keptSymbols.add(`${symbolSid}\0${pid}`);
  }
  for (const { pid } of scopedProviders) {
    for (const row of writer.prepare("SELECT symbol_sid, raw_sid FROM provider_symbols WHERE pid = ?").all(pid)) {
      if (keptSymbols.has(`${row.symbol_sid}\0${pid}`)) continue;
      writer.prepare("DELETE FROM provider_symbols WHERE symbol_sid = ? AND pid = ?").run(row.symbol_sid, pid);
      writer.released.add(row.symbol_sid);
      writer.released.add(row.raw_sid);
    }
  }

  const keptDocuments = new Set();
  const replaceRefs = (did, refs) => {
    releaseSelected(writer, "SELECT sid FROM provider_document_refs WHERE did = ?", did);
    writer.prepare("DELETE FROM provider_document_refs WHERE did = ?").run(did);
    for (const value of refs) {
      writer.prepare("INSERT INTO provider_document_refs(did, sid) VALUES (?, ?)")
        .run(did, writer.intern(value));
    }
  };
  for (const document of input.documents.values()) {
    const pid = providerIds.get(document.providerId);
    const documentSid = writer.intern(document.documentPath);
    const existing = writer.prepare(
      "SELECT did, payload FROM provider_documents WHERE document_sid = ? AND pid = ?"
    ).get(documentSid, pid);
    const payload = reuseOrEncodeSidecarStorePayload(prepareSidecarStorePayload({
      occurrences: document.occurrences, symbol_edges: document.symbol_edges
    }, `provider document ${document.documentPath}`), existing?.payload);
    if (existing && payload === existing.payload) {
      keptDocuments.add(existing.did);
      continue;
    }
    let did;
    if (existing) {
      did = existing.did;
      writer.prepare(`UPDATE provider_documents SET occurrence_count = ?, symbol_edge_count = ?,
        payload = ? WHERE did = ?`).run(document.occurrences.length, document.symbol_edges.length,
        payload, did);
    } else {
      did = Number(writer.prepare(`INSERT INTO provider_documents(document_sid, pid,
        occurrence_count, symbol_edge_count, payload) VALUES (?, ?, ?, ?, ?)`).run(
        documentSid, pid, document.occurrences.length, document.symbol_edges.length, payload
      ).lastInsertRowid);
    }
    replaceRefs(did, document.refs);
    keptDocuments.add(did);
  }
  for (const { pid } of scopedProviders) {
    for (const row of writer.prepare("SELECT did, document_sid FROM provider_documents WHERE pid = ?").all(pid)) {
      if (keptDocuments.has(row.did)) continue;
      replaceRefs(row.did, []);
      writer.prepare("DELETE FROM provider_documents WHERE did = ?").run(row.did);
      writer.released.add(row.document_sid);
    }
  }

  const storedEdgeKeys = new Set();
  const unmatchedEdges = [];
  for (const { pid, provider_key: providerKey } of scopedProviders) {
    const label = `symbol edge of provider ${providerKey}`;
    for (const row of writer.prepare(`SELECT e.seid, e.from_sid, e.to_sid, f.value AS from_symbol,
      t.value AS to_symbol, e.payload FROM provider_symbol_edges e
      LEFT JOIN strings f ON f.sid = e.from_sid LEFT JOIN strings t ON t.sid = e.to_sid
      WHERE e.pid = ?`).iterate(pid)) {
      const stored = readSidecarStorePayload(row.payload, label);
      const edgeId = assertStoreSymbolEdge(providerKey, stored.value).edge_id;
      const key = `${providerKey}\0${edgeId}`;
      if (storedEdgeKeys.has(key)) {
        throw selectedDataError(`symbol edge ${edgeId} of provider ${providerKey} is stored more than once`);
      }
      storedEdgeKeys.add(key);
      const edge = input.externalEdges.get(key);
      if (edge && samePreparedSidecarStorePayload(
        prepareSidecarStorePayload(edge.payload, `symbol edge ${edgeId}`), stored)) {
        edge.seid = row.seid;
        if (edge.from !== row.from_symbol || edge.to !== row.to_symbol) {
          edge.relinked = [row.from_sid, row.to_sid];
        }
        continue;
      }
      unmatchedEdges.push(row.seid, row.from_sid, row.to_sid);
    }
  }
  storedEdgeKeys.clear();
  for (let index = 0; index < unmatchedEdges.length; index += 3) {
    writer.prepare("DELETE FROM provider_symbol_edges WHERE seid = ?").run(unmatchedEdges[index]);
    for (const sid of [unmatchedEdges[index + 1], unmatchedEdges[index + 2]]) {
      if (sid !== null) writer.released.add(sid);
    }
  }
  for (const edge of input.externalEdges.values()) {
    if (edge.relinked !== null) {
      writer.prepare("UPDATE provider_symbol_edges SET from_sid = ?, to_sid = ? WHERE seid = ?")
        .run(edge.from === null ? null : writer.intern(edge.from),
          edge.to === null ? null : writer.intern(edge.to), edge.seid);
      for (const sid of edge.relinked) {
        if (sid !== null) writer.released.add(sid);
      }
    }
    if (edge.seid !== null) continue;
    writer.prepare("INSERT INTO provider_symbol_edges(pid, from_sid, to_sid, payload) VALUES (?, ?, ?, ?)")
      .run(providerIds.get(edge.providerId), edge.from === null ? null : writer.intern(edge.from),
        edge.to === null ? null : writer.intern(edge.to),
        encodeSidecarStorePayload(edge.payload, `symbol edge ${edge.payload.edge_id}`));
  }

  const keptProviders = new Set(providerIds.values());
  for (const { pid } of scopedProviders) {
    if (!keptProviders.has(pid)) writer.prepare("DELETE FROM providers WHERE pid = ?").run(pid);
  }
}

function releaseUnreferencedStrings(writer) {
  const unreferenced = SIDECAR_STORE_STRING_REFERENCES.map(([table, column]) =>
    `NOT EXISTS (SELECT 1 FROM ${table} WHERE ${column} = ?1)`).join(" AND ");
  const remove = writer.db.prepare(`DELETE FROM strings WHERE sid = ?1 AND ${unreferenced}`);
  for (const sid of writer.released) remove.run(sid);
}

export function publishPreparedDeltaInDatabase(db, delta) {
  plainObject(delta, "prepared delta");
  const expected = plainObject(delta.expected_publication, "expected_publication");
  const publication = plainObject(delta.publication, "publication");
  if (!isConcreteSidecarCommit(publication.repository_commit)) {
    throw new TypeError("publication.repository_commit must be a concrete lowercase commit id");
  }
  if (db.isTransaction) {
    throw new SidecarPreparedDeltaRefusalError(
      "sidecar publication owns its transaction; the connection already has one open",
      { code: SIDECAR_PREPARED_DELTA_REFUSAL_CODES.TRANSACTION_OPEN });
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = readStorePublication(db);
    if (
      current.store_incarnation !== expected.store_incarnation ||
      current.sequence !== String(expected.sequence)
    ) {
      throw new SidecarPreparedDeltaRefusalError("sidecar prepared delta predecessor is stale",
        { code: SIDECAR_PREPARED_DELTA_REFUSAL_CODES.PREDECESSOR_STALE });
    }
    const nextSequence = BigInt(current.sequence) + 1n;
    if (BigInt(publication.sequence) !== nextSequence) {
      throw new SidecarPreparedDeltaRefusalError("sidecar publication sequence must advance exactly once",
        { code: SIDECAR_PREPARED_DELTA_REFUSAL_CODES.SEQUENCE_INVALID });
    }

    const writer = createStoreWriter(db);
    const affected = { nodes: new Set(), edges: new Set() };
    const changedAttributes = new Map();
    upsertFiles(writer, delta.files, affected);
    replaceUnits(writer, delta.units, affected, changedAttributes);
    recomputeAggregates(writer, affected, changedAttributes);
    replaceProviderData(writer, delta);
    releaseUnreferencedStrings(writer);
    const counts = selectStoreCounts(db);
    db.prepare(`UPDATE publication SET sequence=?, repository_commit=?, repository_tree=?,
      generator_identity=?, base_input_identity_json=?, base_coverage_json=?,
      provider_input_identity_json=?, provider_coverage_json=?, counts_json=?, published_at=?
      WHERE singleton=1`).run(
      nextSequence,
      publication.repository_commit,
      nonEmpty(publication.repository_tree, "publication.repository_tree"),
      nonEmpty(publication.generator_identity, "publication.generator_identity"),
      json(publication.base_input_identity, "publication.base_input_identity"),
      json(publication.base_coverage, "publication.base_coverage"),
      json(publication.provider_input_identity, "publication.provider_input_identity"),
      json(publication.provider_coverage, "publication.provider_coverage"),
      JSON.stringify(counts),
      nonEmpty(publication.published_at, "publication.published_at")
    );
    const committedPublication = readStorePublication(db);
    db.exec("COMMIT");
    return committedPublication;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}
