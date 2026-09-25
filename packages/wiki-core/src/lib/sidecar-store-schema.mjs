import { randomUUID } from "node:crypto";

export const SIDECAR_STORE_SCHEMA_VERSION = "repo-code-store.v6";
export const SIDECAR_LIFECYCLE_SCHEMA_VERSION = "repo-code-lifecycle.v1";
export const SIDECAR_STORE_GRAPH_FILE = "graph.sqlite";
export const SIDECAR_STORE_LIFECYCLE_FILE = "lifecycle.sqlite";
export const SIDECAR_STORE_MEMBERSHIP_CHUNK_SIZE = 128;

export const SIDECAR_STORE_STRING_REFERENCES = Object.freeze([
  Object.freeze(["nodes", "node_sid"]),
  Object.freeze(["nodes", "path_sid"]),
  Object.freeze(["resolution_candidates", "candidate_sid"]),
  Object.freeze(["provider_documents", "document_sid"]),
  Object.freeze(["provider_document_refs", "sid"]),
  Object.freeze(["provider_symbols", "symbol_sid"]),
  Object.freeze(["provider_symbols", "raw_sid"]),
  Object.freeze(["provider_symbol_edges", "from_sid"]),
  Object.freeze(["provider_symbol_edges", "to_sid"])
]);

const GRAPH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS store_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  store_schema_version TEXT NOT NULL,
  graph_schema_version TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS publication (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  store_incarnation TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  repository_commit TEXT,
  repository_tree TEXT,
  generator_identity TEXT,
  base_input_identity_json TEXT NOT NULL,
  base_coverage_json TEXT NOT NULL,
  provider_input_identity_json TEXT NOT NULL,
  provider_coverage_json TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  published_at TEXT
) STRICT;
CREATE TABLE IF NOT EXISTS vocabulary (
  term_id INTEGER PRIMARY KEY,
  value TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE IF NOT EXISTS strings (
  sid INTEGER PRIMARY KEY,
  value TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE IF NOT EXISTS files (
  fid INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  blob_oid TEXT NOT NULL,
  mode TEXT NOT NULL,
  input_identity TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS units (
  uid INTEGER PRIMARY KEY,
  unit_key TEXT NOT NULL UNIQUE,
  fid INTEGER NOT NULL REFERENCES files(fid) ON DELETE CASCADE,
  provider_kind_id INTEGER NOT NULL REFERENCES vocabulary(term_id),
  input_identity TEXT NOT NULL,
  payload BLOB NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS units_file_idx ON units(fid);
CREATE TABLE IF NOT EXISTS resolution_candidates (
  uid INTEGER NOT NULL REFERENCES units(uid) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  candidate_sid INTEGER NOT NULL REFERENCES strings(sid),
  state_id INTEGER NOT NULL REFERENCES vocabulary(term_id),
  PRIMARY KEY (uid, ordinal)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS resolution_candidates_candidate_idx
  ON resolution_candidates(candidate_sid);
CREATE TABLE IF NOT EXISTS nodes (
  node_sid INTEGER PRIMARY KEY REFERENCES strings(sid),
  kind_id INTEGER NOT NULL REFERENCES vocabulary(term_id),
  path_sid INTEGER REFERENCES strings(sid),
  residual BLOB
) STRICT;
CREATE INDEX IF NOT EXISTS nodes_path_idx ON nodes(path_sid) WHERE path_sid IS NOT NULL;
CREATE TABLE IF NOT EXISTS edges (
  eid INTEGER PRIMARY KEY,
  from_sid INTEGER NOT NULL REFERENCES nodes(node_sid) DEFERRABLE INITIALLY DEFERRED,
  kind_id INTEGER NOT NULL REFERENCES vocabulary(term_id),
  to_sid INTEGER NOT NULL REFERENCES nodes(node_sid) DEFERRABLE INITIALLY DEFERRED,
  discriminator TEXT NOT NULL,
  residual BLOB,
  UNIQUE (from_sid, kind_id, to_sid, discriminator)
) STRICT;
CREATE INDEX IF NOT EXISTS edges_to_idx ON edges(to_sid);
CREATE TABLE IF NOT EXISTS node_members (
  uid INTEGER NOT NULL REFERENCES units(uid) ON DELETE CASCADE,
  node_sid INTEGER NOT NULL REFERENCES nodes(node_sid) DEFERRABLE INITIALLY DEFERRED,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  residual BLOB,
  PRIMARY KEY (uid, node_sid, ordinal)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS node_members_node_idx ON node_members(node_sid);
CREATE TABLE IF NOT EXISTS edge_members (
  uid INTEGER NOT NULL REFERENCES units(uid) ON DELETE CASCADE,
  eid INTEGER NOT NULL REFERENCES edges(eid) DEFERRABLE INITIALLY DEFERRED,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  residual BLOB,
  PRIMARY KEY (uid, eid, ordinal)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS edge_members_edge_idx ON edge_members(eid);
CREATE TABLE IF NOT EXISTS providers (
  pid INTEGER PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE,
  input_identity TEXT NOT NULL,
  metadata BLOB NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS provider_documents (
  did INTEGER PRIMARY KEY,
  document_sid INTEGER NOT NULL REFERENCES strings(sid),
  pid INTEGER NOT NULL REFERENCES providers(pid) ON DELETE CASCADE,
  occurrence_count INTEGER NOT NULL CHECK (occurrence_count >= 0),
  symbol_edge_count INTEGER NOT NULL CHECK (symbol_edge_count >= 0),
  payload BLOB NOT NULL,
  UNIQUE (document_sid, pid)
) STRICT;
CREATE TABLE IF NOT EXISTS provider_document_refs (
  did INTEGER NOT NULL REFERENCES provider_documents(did) ON DELETE CASCADE,
  sid INTEGER NOT NULL REFERENCES strings(sid),
  PRIMARY KEY (did, sid)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS provider_document_refs_sid_idx ON provider_document_refs(sid);
CREATE TABLE IF NOT EXISTS provider_symbols (
  symbol_sid INTEGER NOT NULL REFERENCES strings(sid),
  pid INTEGER NOT NULL REFERENCES providers(pid) ON DELETE CASCADE,
  raw_sid INTEGER NOT NULL REFERENCES strings(sid),
  payload BLOB NOT NULL,
  PRIMARY KEY (symbol_sid, pid)
) STRICT, WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS provider_symbols_raw_idx ON provider_symbols(raw_sid);
CREATE TABLE IF NOT EXISTS provider_symbol_edges (
  seid INTEGER PRIMARY KEY,
  pid INTEGER NOT NULL REFERENCES providers(pid) ON DELETE CASCADE,
  from_sid INTEGER REFERENCES strings(sid),
  to_sid INTEGER REFERENCES strings(sid),
  payload BLOB NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS provider_symbol_edges_from_idx
  ON provider_symbol_edges(from_sid) WHERE from_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_symbol_edges_to_idx
  ON provider_symbol_edges(to_sid) WHERE to_sid IS NOT NULL;
`;

const LIFECYCLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS lifecycle_schema (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version TEXT NOT NULL
) STRICT;
`;

function scalar(db, sql) {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return statement.get();
}

export function configureWritableSqlite(db) {
  db.exec("PRAGMA busy_timeout = 0");
  db.exec("PRAGMA foreign_keys = ON");
  const mode = String(db.prepare("PRAGMA journal_mode = DELETE").get().journal_mode).toLowerCase();
  if (mode !== "delete") throw new Error(`sidecar SQLite journal mode is '${mode}', expected 'delete'`);
  db.exec("PRAGMA synchronous = FULL");
}

export function configureReadableSqlite(db) {
  db.exec("PRAGMA busy_timeout = 0");
  db.exec("PRAGMA foreign_keys = ON");
  const mode = String(db.prepare("PRAGMA journal_mode").get().journal_mode).toLowerCase();
  if (mode !== "delete") throw new Error(`sidecar SQLite journal mode is '${mode}', expected 'delete'`);
}

export function initializeLifecycleSchema(db) {
  configureWritableSqlite(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(LIFECYCLE_SCHEMA_SQL);
    db.prepare(`INSERT INTO lifecycle_schema(singleton, schema_version) VALUES (1, ?)
      ON CONFLICT(singleton) DO NOTHING`).run(SIDECAR_LIFECYCLE_SCHEMA_VERSION);
    assertLifecycleSchema(db);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function assertLifecycleSchema(db) {
  const row = db.prepare(
    "SELECT schema_version FROM lifecycle_schema WHERE singleton = 1"
  ).get();
  if (row?.schema_version !== SIDECAR_LIFECYCLE_SCHEMA_VERSION) {
    throw new Error("sidecar lifecycle schema marker is missing or incompatible");
  }
}

export function initializeGraphSchema(db, { graphSchemaVersion }) {
  if (typeof graphSchemaVersion !== "string" || graphSchemaVersion.length === 0) {
    throw new TypeError("graphSchemaVersion must be a non-empty string");
  }
  configureWritableSqlite(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(GRAPH_SCHEMA_SQL);
    db.prepare(`INSERT INTO store_schema(singleton, store_schema_version, graph_schema_version)
      VALUES (1, ?, ?) ON CONFLICT(singleton) DO NOTHING`)
      .run(SIDECAR_STORE_SCHEMA_VERSION, graphSchemaVersion);
    db.prepare(`INSERT INTO publication(
      singleton, store_incarnation, sequence, repository_commit, repository_tree,
      generator_identity, base_input_identity_json, base_coverage_json,
      provider_input_identity_json, provider_coverage_json, counts_json, published_at
    ) VALUES (1, ?, 0, NULL, NULL, NULL, '{}', '{}', '{}', '{}', '{}', NULL)
      ON CONFLICT(singleton) DO NOTHING`).run(randomUUID());
    assertGraphSchema(db, { graphSchemaVersion });
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function assertGraphSchema(db, { graphSchemaVersion }) {
  let row;
  try {
    row = db.prepare(`SELECT store_schema_version, graph_schema_version
      FROM store_schema WHERE singleton = 1`).get();
  } catch (cause) {
    if (/no such table: store_schema/i.test(cause?.message ?? "")) {
      const error = new Error("sidecar graph store schema is absent", { cause });
      error.code = "sidecar_graph_structural_unusable";
      throw error;
    }
    throw cause;
  }
  if (
    row?.store_schema_version !== SIDECAR_STORE_SCHEMA_VERSION ||
    row?.graph_schema_version !== graphSchemaVersion
  ) {
    const error = new Error("sidecar graph store schema marker is missing or incompatible");
    error.code = "sidecar_graph_structural_unusable";
    throw error;
  }
  let publication;
  try {
    publication = scalar(db, "SELECT sequence FROM publication WHERE singleton = 1");
  } catch (cause) {
    if (/no such table: publication/i.test(cause?.message ?? "")) {
      const error = new Error("sidecar graph store publication is absent", { cause });
      error.code = "sidecar_graph_structural_unusable";
      throw error;
    }
    throw cause;
  }
  if (!publication || publication.sequence < 0n) {
    const error = new Error("sidecar graph store publication marker is missing or invalid");
    error.code = "sidecar_graph_structural_unusable";
    throw error;
  }
}
