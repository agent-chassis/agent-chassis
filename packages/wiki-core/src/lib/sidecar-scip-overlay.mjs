// SCIP optional symbol-precision overlay (WK-1230#SLICE-005).
//
// SCIP is a DERIVED symbol layer that coexists alongside the shipped tree-sitter
// `imports_module` edges (sidecar-graph-extractors.mjs). It NEVER touches the base
// graph: the overlay is materialized as a distinct `scip_overlay` artifact section
// so existing graph_impact_paths/diff/context-for-path traversals (which read
// `artifact.graph`) are byte-identical whether SCIP is on or off.
//
// Two concerns are split so ingestion is CI-testable WITHOUT escalation (RT-L1):
//   (A) decode + normalize -- deterministic, pure, CI-tested. `decodeScipIndex`
//       (protobufjs over the embedded scip.proto subset) and `normalizeScipIndex`
//       (decoded Index -> repo-code-graph symbol nodes + defines/references edges).
//       The committed decoder dependency (protobufjs) is exercised in CI against a
//       tiny committed binary .scip fixture (tests/fixtures/wiki-core-scip.mjs),
//       so the decode path has a real CI-coverage story, not just normalize.
//   (B) `buildScipOverlay` -- the escalated wrapper. Runs scip-typescript /
//       scip-python (on-demand, NOT base-build dependencies) into an IGNORED .scip
//       cache, decodes via (A), normalizes, and reconciles against the base graph's
//       file nodes. CI does not depend on the external indexers being installed.
//
// Grounding: the normalization rules below are anchored in the SLICE-001 indexer
// spike (real .scip shape): roles Definition/Reference, `local N` symbols are
// local-only (never cross-file edges), and references whose SymbolInformation is
// missing (the spike's 80 Python externals + lib.es5/builtins) are preserved as
// resolution.state external/unresolved metadata, never fabricated definition edges.

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import protobuf from "protobufjs";

import {
  SIDECAR_GRAPH_SCHEMA_VERSION,
  SIDECAR_GRAPH_SCIP_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS
} from "./sidecar-graph-schema.mjs";

// The SCIP protocol/CLI version whose schema field-numbers this decoder targets
// (sourcegraph/scip, Apache-2.0; primary-source verified in WK-1230#SLICE-001).
export const SCIP_PROTOCOL_VERSION = "0.8.1";

// On-demand indexers (NOT base-build dependencies). scip-typescript is Apache-2.0,
// scip-python is MIT (both primary-source verified in WK-1230#SLICE-001). They are
// invoked via `npx` by the (B) wrapper only when SCIP is configured + requested.
export const SCIP_INDEXER_SPECS = Object.freeze({
  "scip-typescript": Object.freeze({
    package: "@sourcegraph/scip-typescript@0.4.0",
    scheme: "scip-typescript",
    output: "typescript.scip"
  }),
  "scip-python": Object.freeze({
    package: "@sourcegraph/scip-python@0.6.6",
    scheme: "scip-python",
    output: "python.scip"
  })
});

// Ignored runtime cache dir for generated .scip artifacts. NEVER committed
// (6.1MB/12s on this repo, too big/slow for per-build) and NEVER placed under the
// repo source tree / HOME / XDG -- it lives under the repo-local `.cache/` runtime
// dir, the same launcher-writable cache root the base index already uses, and is
// gitignored (both `.cache/` and an explicit `*.scip` rule).
export const SCIP_DEFAULT_CACHE_DIR = ".cache/repo-scip-index";

// Minimal subset of sourcegraph/scip's scip.proto. Only the messages/fields the
// overlay reads are declared; protobuf3 decode skips every other (unknown) field,
// so this stays forward-compatible with the full indexer output. Field numbers are
// authoritative (scip.proto @ main). Embedded as a string so the decoder needs no
// on-disk .proto data file (keeps everything inside this slice's write scope).
const SCIP_PROTO_SOURCE = `
syntax = "proto3";
package scip;
message Index {
  Metadata metadata = 1;
  repeated Document documents = 2;
  repeated SymbolInformation external_symbols = 3;
}
message Metadata {
  int32 version = 1;
  ToolInfo tool_info = 2;
  string project_root = 3;
  int32 text_document_encoding = 4;
}
message ToolInfo {
  string name = 1;
  string version = 2;
  repeated string arguments = 3;
}
message Document {
  string relative_path = 1;
  repeated Occurrence occurrences = 2;
  repeated SymbolInformation symbols = 3;
  string language = 4;
  string text = 5;
  int32 position_encoding = 6;
}
message Occurrence {
  repeated int32 range = 1;
  string symbol = 2;
  int32 symbol_roles = 3;
  repeated string override_documentation = 4;
  int32 syntax_kind = 5;
  repeated int32 enclosing_range = 7;
}
message SymbolInformation {
  string symbol = 1;
  repeated string documentation = 3;
  repeated Relationship relationships = 4;
  int32 kind = 5;
  string display_name = 6;
  string enclosing_symbol = 8;
}
message Relationship {
  string symbol = 1;
  bool is_reference = 2;
  bool is_implementation = 3;
  bool is_type_definition = 4;
  bool is_definition = 5;
}
`;

// SCIP SymbolRole bitmask (scip.proto enum SymbolRole). Only Definition is
// load-bearing here: a Definition-role occurrence DEFINES the symbol in its
// document; everything else (Reference/ReadAccess/WriteAccess/...) is a reference.
const SCIP_SYMBOL_ROLE_DEFINITION = 0x1;

// Call-graph (SLICE-003) status vocabulary. The calls_symbol attribution layer
// REQUIRES Occurrence.enclosing_range to be populated on definitions; when it is
// not (the SLICE-001 spike observed enclosing/syntax fields frequently
// Unspecified), the layer self-disables rather than emit a wrong/empty graph.
export const SCIP_CALL_GRAPH_EXTRACTED = "scip_call_graph_extracted";
export const SCIP_CALL_GRAPH_UNAVAILABLE = "scip_call_graph_unavailable";
export const SCIP_CALL_GRAPH_REASON_ENCLOSING_RANGE_UNPOPULATED =
  "enclosing_range_unpopulated";

let scipRootPromise = null;

function getScipRoot() {
  if (!scipRootPromise) {
    // keepCase preserves snake_case field names (relative_path, symbol_roles, ...)
    // so the decoded object matches the SCIP wire shape the SLICE-001 spike recorded.
    scipRootPromise = Promise.resolve(protobuf.parse(SCIP_PROTO_SOURCE, { keepCase: true }).root);
  }
  return scipRootPromise;
}

// Decode raw .scip protobuf bytes into a plain decoded Index object. This is the
// committed decoder (protobufjs, BSD-3-Clause; primary-source verified). CI
// exercises it against the tiny committed fixture; the (B) wrapper uses it on the
// real indexer output.
export async function decodeScipIndex(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError("decodeScipIndex requires a Buffer/Uint8Array of .scip bytes");
  }
  const root = await getScipRoot();
  const IndexType = root.lookupType("scip.Index");
  const message = IndexType.decode(buffer);
  return IndexType.toObject(message, {
    defaults: true,
    arrays: true,
    objects: true,
    longs: Number,
    enums: Number,
    bytes: String
  });
}

function hasDefinitionRole(symbolRoles) {
  return (Number(symbolRoles || 0) & SCIP_SYMBOL_ROLE_DEFINITION) === SCIP_SYMBOL_ROLE_DEFINITION;
}

// Parse a SCIP symbol moniker. `local <id>` symbols are document-local (the same
// `local 1` string means different things in different documents), so they are
// flagged local and never promoted to cross-file symbol nodes/edges. Global
// monikers are `<scheme> <manager> <name> <version> <descriptors...>`.
export function parseScipSymbol(symbol) {
  if (typeof symbol !== "string" || symbol.length === 0) {
    return { kind: "empty", local: false, scheme: null };
  }
  if (symbol === "local" || symbol.startsWith("local ")) {
    return { kind: "local", local: true, scheme: "local" };
  }
  const spaceIndex = symbol.indexOf(" ");
  const scheme = spaceIndex === -1 ? symbol : symbol.slice(0, spaceIndex);
  return { kind: "global", local: false, scheme: scheme || "unknown" };
}

function fileNodeIdForPath(relativePath) {
  return `file:${relativePath}`;
}

function symbolNodeId(symbol) {
  return `symbol:${symbol}`;
}

function scipProvenance(relativePath) {
  return {
    source_kind: "scip",
    canonicality: "derived",
    evidence_basis: "scip",
    ...(relativePath ? { path: relativePath } : {})
  };
}

// Grammar-less SCIP provider descriptor (RT-1): SCIP indexers have NO grammar, so
// the descriptor carries tool name + tool/indexer version + SCIP protocol version
// (SIDECAR_GRAPH_SCIP_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS), never grammar fields.
export function createScipProviderDescriptor({ indexer, toolName, toolVersion }) {
  const name = toolName || indexer || "scip";
  const version = toolVersion || "unknown";
  const descriptor = {
    name,
    version,
    scip_protocol_version: SCIP_PROTOCOL_VERSION,
    cache_key: `${name}@${version}:scip@${SCIP_PROTOCOL_VERSION}`
  };
  // Defensive: guarantee every required grammar-less field is a present string so
  // the SLICE-004 scip provider-identity invariant always holds for emitted items.
  for (const field of SIDECAR_GRAPH_SCIP_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS) {
    if (typeof descriptor[field] !== "string" || descriptor[field].length === 0) {
      descriptor[field] = "unknown";
    }
  }
  return descriptor;
}

function firstRangeLine(occurrence) {
  const range = Array.isArray(occurrence?.range) ? occurrence.range : [];
  // SCIP range is [startLine, startChar, (endLine,) endChar]; line is 0-based, so
  // surface a 1-based line to match the rest of the graph's line metadata.
  return range.length >= 1 ? Number(range[0]) + 1 : null;
}

// Parse a SCIP range/enclosing_range array into a start/end position pair. SCIP
// encodes a range as [startLine, startChar, endChar] (single-line) or
// [startLine, startChar, endLine, endChar] (multi-line); lines/chars are 0-based.
// An absent/empty/short array (the unpopulated enclosing_range case) -> null.
function parseScipRange(range) {
  if (!Array.isArray(range) || range.length < 3) {
    return null;
  }
  const nums = range.map(Number);
  if (nums.some((value) => !Number.isFinite(value))) {
    return null;
  }
  if (nums.length === 3) {
    return { startLine: nums[0], startChar: nums[1], endLine: nums[0], endChar: nums[2] };
  }
  return { startLine: nums[0], startChar: nums[1], endLine: nums[2], endChar: nums[3] };
}

// Lexicographic (line, then char) position comparison.
function comparePosition(aLine, aChar, bLine, bChar) {
  if (aLine !== bLine) {
    return aLine - bLine;
  }
  return aChar - bChar;
}

// True when `scope` (a parsed enclosing_range) contains the full `range`.
// Endpoints inclusive; attribution is fail-honest when no scope contains the
// complete reference interval.
function scopeContainsRange(scope, range) {
  return (
    comparePosition(scope.startLine, scope.startChar, range.startLine, range.startChar) <= 0 &&
    comparePosition(range.endLine, range.endChar, scope.endLine, scope.endChar) <= 0
  );
}

// Build the per-document scope index: every Definition-role occurrence carrying a
// non-empty enclosing_range becomes a scope (enclosing_range body-span + its
// symbol). LOCAL definitions are included so innermost-wins can detect a call that
// actually lives inside a local closure (which must fail-honest, not bleed up to an
// enclosing global). enclosing_symbol is deliberately NOT consulted (RT-A: it is
// symbol definition-nesting, not occurrence-positional).
function buildScopeIndex(occurrences) {
  const scopes = [];
  for (const occurrence of occurrences) {
    if (!hasDefinitionRole(occurrence?.symbol_roles)) {
      continue;
    }
    const symbol = occurrence?.symbol;
    if (typeof symbol !== "string" || symbol.length === 0) {
      continue;
    }
    const enclosing = parseScipRange(occurrence.enclosing_range);
    if (!enclosing) {
      continue;
    }
    scopes.push({ ...enclosing, symbol, local: parseScipSymbol(symbol).local });
  }
  return scopes;
}

// Select the INNERMOST scope whose body-span contains the full reference range.
// Innermost = the latest start (tie-break: earliest end); nested scopes don't
// partially overlap, so the latest containing start is the most deeply nested.
function innermostContainingScope(scopes, range) {
  let best = null;
  for (const scope of scopes) {
    if (!scopeContainsRange(scope, range)) {
      continue;
    }
    if (best === null) {
      best = scope;
      continue;
    }
    const startDelta = comparePosition(scope.startLine, scope.startChar, best.startLine, best.startChar);
    if (
      startDelta > 0 ||
      (startDelta === 0 &&
        comparePosition(scope.endLine, scope.endChar, best.endLine, best.endChar) < 0)
    ) {
      best = scope;
    }
  }
  return best;
}

// Normalize a decoded .scip Index into a derived SCIP symbol layer. PURE and
// deterministic -- this is the CI-tested core (RT-L1). No filesystem, no indexer.
//
// Reconciliation (RT-I2): `baseFileNodeIds` is the set of `file:<path>` ids the
// base build admitted. defines_symbol/references_symbol edges originate at a file
// node, so a document whose file is NOT admitted becomes a coverage gap -- we emit
// no edges from it and fabricate no file node. Pass `null` to admit every document
// (used only by direct unit tests that aren't reconciling against a real base).
export function normalizeScipIndex(decodedIndex, {
  indexer = "scip",
  baseFileNodeIds = null,
  providerDescriptor = null
} = {}) {
  if (!decodedIndex || typeof decodedIndex !== "object") {
    throw new TypeError("normalizeScipIndex requires a decoded .scip Index object");
  }
  const documents = Array.isArray(decodedIndex.documents) ? decodedIndex.documents : [];
  const externalSymbols = Array.isArray(decodedIndex.external_symbols)
    ? decodedIndex.external_symbols
    : [];
  const toolInfo = decodedIndex.metadata?.tool_info ?? {};
  const descriptor =
    providerDescriptor ||
    createScipProviderDescriptor({
      indexer,
      toolName: toolInfo.name,
      toolVersion: toolInfo.version
    });

  // Symbols that carry an external SymbolInformation (no in-corpus definition):
  // these are the resolution-boundary symbols (stdlib/builtins/cross-package).
  const externalSymbolSet = new Set(
    externalSymbols.map((info) => info?.symbol).filter((symbol) => typeof symbol === "string")
  );

  // First pass: which global symbols have an in-corpus Definition occurrence in an
  // ADMITTED document. Only these resolve to `resolved`; everything else referenced
  // is preserved as `unresolved` (external boundary), never a fabricated definition.
  const definedSymbols = new Set();
  // Call-graph verify signal (info-2): how many Definition occurrences carry a
  // populated enclosing_range across ADMITTED documents. Counted over local AND
  // global defs (both form scopes); if zero, the call-graph layer self-disables.
  let definitionOccurrenceCount = 0;
  let enclosingRangeDefinitionCount = 0;
  for (const document of documents) {
    const relativePath = document?.relative_path;
    if (typeof relativePath !== "string") {
      continue;
    }
    if (baseFileNodeIds && !baseFileNodeIds.has(fileNodeIdForPath(relativePath))) {
      continue;
    }
    for (const occurrence of document.occurrences || []) {
      const symbol = occurrence?.symbol;
      if (typeof symbol !== "string" || symbol.length === 0) {
        continue;
      }
      if (hasDefinitionRole(occurrence.symbol_roles)) {
        definitionOccurrenceCount += 1;
        if (parseScipRange(occurrence.enclosing_range)) {
          enclosingRangeDefinitionCount += 1;
        }
      }
      if (parseScipSymbol(symbol).local) {
        continue;
      }
      if (hasDefinitionRole(occurrence.symbol_roles)) {
        definedSymbols.add(symbol);
      }
    }
  }
  // MANDATORY verify/degrade (info-2): the calls_symbol layer is only emitted when
  // at least one definition carries enclosing_range. Otherwise zero calls_symbol
  // edges + scip_call_graph_unavailable; defines_symbol/references_symbol untouched.
  const callGraphAvailable = enclosingRangeDefinitionCount > 0;

  const displayNames = new Map();
  for (const document of documents) {
    for (const info of document?.symbols || []) {
      if (typeof info?.symbol === "string" && typeof info.display_name === "string") {
        displayNames.set(info.symbol, info.display_name);
      }
    }
  }
  for (const info of externalSymbols) {
    if (typeof info?.symbol === "string" && typeof info.display_name === "string" && !displayNames.has(info.symbol)) {
      displayNames.set(info.symbol, info.display_name);
    }
  }

  const nodes = new Map();
  const edges = new Map();
  const uncoveredDocuments = [];
  const coveredPaths = [];

  // Aggregated calls_symbol edges: ONE per (caller,callee) with occurrence_count +
  // lines[] (RT-E). NOT addSymbolEdge's first-line-wins dedup. A reference whose
  // enclosing scope cannot be determined (module/top-level) or whose innermost
  // scope is a local-N symbol is fail-honest: NO edge, counted as unattributed.
  const callEdges = new Map();
  let unattributedReferenceCount = 0;
  function attributeCall(scopeIndex, occurrence, calleeSymbol, relativePath, line) {
    const referenceRange = parseScipRange(occurrence?.range);
    const scope = referenceRange ? innermostContainingScope(scopeIndex, referenceRange) : null;
    if (!scope || scope.local) {
      // No containing definition body-span, or innermost scope is a local-N symbol
      // (not nameable cross-file): never attribute to an arbitrary caller.
      unattributedReferenceCount += 1;
      return;
    }
    const caller = scope.symbol;
    const key = `${caller} ${calleeSymbol}`;
    let aggregate = callEdges.get(key);
    if (!aggregate) {
      aggregate = { caller, callee: calleeSymbol, path: relativePath, count: 0, lines: [] };
      callEdges.set(key, aggregate);
    }
    aggregate.count += 1;
    if (line != null) {
      aggregate.lines.push(line);
    }
  }

  const counts = {
    document_count: documents.length,
    covered_document_count: 0,
    occurrence_count: 0,
    definition_count: 0,
    reference_count: 0,
    local_symbol_count: 0,
    empty_symbol_count: 0
  };

  function resolutionFor(symbol) {
    if (definedSymbols.has(symbol)) {
      return { state: "resolved", dynamic_boundary: false };
    }
    const external = externalSymbolSet.has(symbol);
    return {
      state: "unresolved",
      dynamic_boundary: false,
      unresolved_reason: external ? "external_symbol_information" : "missing_symbol_information"
    };
  }

  function ensureSymbolNode(symbol, parsed) {
    const id = symbolNodeId(symbol);
    if (nodes.has(id)) {
      return id;
    }
    const resolution = resolutionFor(symbol);
    const node = {
      id,
      kind: "symbol",
      symbol,
      scheme: parsed.scheme,
      ...(displayNames.has(symbol) ? { display_name: displayNames.get(symbol) } : {}),
      resolution,
      coverage: { language: parsed.scheme, status: resolution.state },
      provider_descriptor: descriptor,
      provenance: scipProvenance(null)
    };
    nodes.set(id, node);
    return id;
  }

  function addSymbolEdge(kind, relativePath, symbol, line) {
    const fromNodeId = fileNodeIdForPath(relativePath);
    const toNodeId = symbolNodeId(symbol);
    const id = `edge:${kind}:${fromNodeId}->${toNodeId}`;
    if (edges.has(id)) {
      return;
    }
    const resolution = resolutionFor(symbol);
    edges.set(id, {
      id,
      kind,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      path: relativePath,
      ...(line != null ? { line } : {}),
      resolution,
      provider_descriptor: descriptor,
      provenance: scipProvenance(relativePath)
    });
  }

  for (const document of documents) {
    const relativePath = document?.relative_path;
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      continue;
    }
    const admitted = !baseFileNodeIds || baseFileNodeIds.has(fileNodeIdForPath(relativePath));
    if (!admitted) {
      // RT-I2: SCIP references a file the base graph did not admit -> a coverage
      // gap, NOT a dangling edge and NOT a fabricated file node.
      uncoveredDocuments.push(relativePath);
      continue;
    }
    counts.covered_document_count += 1;
    coveredPaths.push(relativePath);

    // Per-document scope index for caller attribution (empty when the call-graph
    // layer is disabled, so attribution is a no-op).
    const scopeIndex = callGraphAvailable ? buildScopeIndex(document.occurrences || []) : [];

    for (const occurrence of document.occurrences || []) {
      counts.occurrence_count += 1;
      const symbol = occurrence?.symbol;
      if (typeof symbol !== "string" || symbol.length === 0) {
        counts.empty_symbol_count += 1;
        continue;
      }
      const parsed = parseScipSymbol(symbol);
      if (parsed.local) {
        // `local N` is document-local -> never a cross-file symbol node/edge.
        counts.local_symbol_count += 1;
        continue;
      }
      const line = firstRangeLine(occurrence);
      ensureSymbolNode(symbol, parsed);
      if (hasDefinitionRole(occurrence.symbol_roles)) {
        counts.definition_count += 1;
        addSymbolEdge("defines_symbol", relativePath, symbol, line);
      } else {
        counts.reference_count += 1;
        addSymbolEdge("references_symbol", relativePath, symbol, line);
        // calls_symbol attribution: this is a non-definition reference to a GLOBAL
        // callee S (local callees were excluded above, as today). Attribute it to
        // the innermost enclosing definition (caller C) -> calls_symbol C->S.
        if (callGraphAvailable) {
          attributeCall(scopeIndex, occurrence, symbol, relativePath, line);
        }
      }
    }
  }

  // Materialize the aggregated calls_symbol edges (symbol->symbol). One edge per
  // (caller,callee) with occurrence_count + sorted lines[]; info-1: NO scalar
  // edge.line and NO top-level edge.path, so the edge can never enter the
  // find-references/definition position index (sidecar-symbol-query.mjs).
  for (const aggregate of callEdges.values()) {
    const callerParsed = parseScipSymbol(aggregate.caller);
    const calleeParsed = parseScipSymbol(aggregate.callee);
    ensureSymbolNode(aggregate.caller, callerParsed);
    ensureSymbolNode(aggregate.callee, calleeParsed);
    const fromNodeId = symbolNodeId(aggregate.caller);
    const toNodeId = symbolNodeId(aggregate.callee);
    const id = `edge:calls_symbol:${fromNodeId}->${toNodeId}`;
    edges.set(id, {
      id,
      kind: "calls_symbol",
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      occurrence_count: aggregate.count,
      lines: [...aggregate.lines].sort((left, right) => left - right),
      resolution: resolutionFor(aggregate.callee),
      provider_descriptor: descriptor,
      provenance: scipProvenance(aggregate.path)
    });
  }
  const callerEdgeCount = callEdges.size;

  const graphNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
  const graphEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));

  let resolvedSymbolCount = 0;
  let unresolvedSymbolCount = 0;
  for (const node of graphNodes) {
    if (node.resolution.state === "resolved") {
      resolvedSymbolCount += 1;
    } else {
      unresolvedSymbolCount += 1;
    }
  }

  const callGraphStatusReason = callGraphAvailable
    ? SCIP_CALL_GRAPH_EXTRACTED
    : SCIP_CALL_GRAPH_UNAVAILABLE;
  const enclosingRangePopulationRatio =
    definitionOccurrenceCount > 0 ? enclosingRangeDefinitionCount / definitionOccurrenceCount : 0;

  return {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    graph_nodes: graphNodes,
    graph_edges: graphEdges,
    provider_descriptor: descriptor,
    // Call-graph layer status (info-2). When unavailable, NO calls_symbol edges were
    // emitted; defines_symbol/references_symbol/find-references stay fully intact.
    call_graph_available: callGraphAvailable,
    call_graph_status_reason: callGraphStatusReason,
    ...(callGraphAvailable
      ? {}
      : { call_graph_unavailable_reason: SCIP_CALL_GRAPH_REASON_ENCLOSING_RANGE_UNPOPULATED }),
    // Coverage/document facts are carried SEPARATELY from graph facts.
    coverage: {
      indexer,
      tool_name: descriptor.name,
      tool_version: descriptor.version,
      scip_protocol_version: descriptor.scip_protocol_version,
      ...counts,
      symbol_count: graphNodes.length,
      resolved_symbol_count: resolvedSymbolCount,
      unresolved_symbol_count: unresolvedSymbolCount,
      external_symbol_count: externalSymbolSet.size,
      // Call-graph coverage, carried separately from graph facts.
      caller_edge_count: callerEdgeCount,
      unattributed_reference_count: unattributedReferenceCount,
      definition_occurrence_count: definitionOccurrenceCount,
      enclosing_range_definition_count: enclosingRangeDefinitionCount,
      enclosing_range_population_ratio: enclosingRangePopulationRatio,
      call_graph_available: callGraphAvailable,
      call_graph_status_reason: callGraphStatusReason,
      ...(callGraphAvailable
        ? {}
        : { call_graph_unavailable_reason: SCIP_CALL_GRAPH_REASON_ENCLOSING_RANGE_UNPOPULATED }),
      uncovered_documents: uncoveredDocuments.sort((left, right) => left.localeCompare(right)),
      covered_documents: coveredPaths.sort((left, right) => left.localeCompare(right))
    }
  };
}

// ---------------------------------------------------------------------------
// (B) Escalated indexer-execution wrapper. NOT exercised by CI -- runs external
// indexers and writes the ignored .scip cache. Keep all decode/normalize logic in
// (A) so the testable core never depends on scip-typescript/scip-python.
// ---------------------------------------------------------------------------

// SCIP layer status reasons (mirrors the WK-1236 tree-sitter degrade vocabulary).
export const SCIP_STATUS_EXTRACTED = "scip_extracted";
export const SCIP_STATUS_NOT_CONFIGURED = "scip_not_configured";
export const SCIP_STATUS_INDEXER_UNAVAILABLE = "scip_indexer_unavailable";

function emptyScipLayer({ statusReason, errorReason = null, indexers = [] }) {
  return {
    graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
    scip_available: false,
    graph_available: false,
    status_reason: statusReason,
    ...(errorReason ? { error_reason: errorReason } : {}),
    graph_nodes: [],
    graph_edges: [],
    coverage: {
      indexers,
      document_count: 0,
      covered_document_count: 0,
      symbol_count: 0,
      uncovered_documents: []
    }
  };
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

// Default indexer runner: invoke the on-demand indexer via `npx` and read back the
// emitted .scip bytes. Throws on nonzero exit or missing output so the wrapper can
// degrade. Injectable (opts.runIndexer) so CI/unit tests never spawn a real tool.
function defaultRunIndexer({ repoRoot, indexer, spec, cacheDir, tsconfigPath }) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(repoRoot, cacheDir, spec.output);
    // scip-typescript indexes the project directory that contains the committed
    // tsconfig.json (positional arg); scip-python crawls the repo (Pyright env).
    const projectDir = path.dirname(tsconfigPath) || ".";
    const args =
      indexer === "scip-typescript"
        ? ["-y", spec.package, "index", "--cwd", repoRoot, "--output", outputPath, projectDir]
        : ["-y", spec.package, "index", "--cwd", repoRoot, "--output", outputPath, "--quiet"];
    const child = spawn("npx", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    const stderrChunks = [];
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${indexer} exited with code ${code}: ${Buffer.concat(stderrChunks).toString("utf8").slice(0, 2000)}`
          )
        );
        return;
      }
      try {
        resolve(await readFile(outputPath));
      } catch (error) {
        reject(new Error(`${indexer} produced no .scip output at ${outputPath}: ${error.message}`));
      }
    });
  });
}

// Build the SCIP overlay layer. NEVER throws -- both degrade cases return a clean
// `scip_available:false` layer, leaving the base graph + tree-sitter edges
// untouched:
//   (1) tsconfig absent / SCIP not configured -> scip_not_configured (operator
//       hard precondition; no inference, no fallback).
//   (2) indexer execution OR decode failure when configured -> scip_indexer_
//       unavailable (graph_available:false analog), the build never hard-fails.
export async function buildScipOverlay({
  repoRoot,
  baseFileNodeIds = null,
  cacheDir = SCIP_DEFAULT_CACHE_DIR,
  tsconfigPath = "tsconfig.json",
  indexers = ["scip-typescript", "scip-python"],
  runIndexer = defaultRunIndexer
} = {}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new TypeError("buildScipOverlay requires repoRoot");
  }

  // Degrade (1): the committed tsconfig is the hard precondition for the whole SCIP
  // overlay (like bwrap for the sandbox). Absent -> the layer is simply unavailable.
  const absoluteTsconfig = path.isAbsolute(tsconfigPath)
    ? tsconfigPath
    : path.join(repoRoot, tsconfigPath);
  if (!(await pathExists(absoluteTsconfig))) {
    return emptyScipLayer({ statusReason: SCIP_STATUS_NOT_CONFIGURED, indexers });
  }

  try {
    await mkdir(path.join(repoRoot, cacheDir), { recursive: true });
    const nodes = new Map();
    const edges = new Map();
    const providerDescriptors = [];
    const perIndexerCoverage = [];

    for (const indexer of indexers) {
      const spec = SCIP_INDEXER_SPECS[indexer];
      if (!spec) {
        throw new Error(`unknown SCIP indexer: ${indexer}`);
      }
      const buffer = await runIndexer({ repoRoot, indexer, spec, cacheDir, tsconfigPath });
      const decoded = await decodeScipIndex(buffer);
      const layer = normalizeScipIndex(decoded, { indexer, baseFileNodeIds });
      for (const node of layer.graph_nodes) {
        nodes.set(node.id, node);
      }
      for (const edge of layer.graph_edges) {
        edges.set(edge.id, edge);
      }
      providerDescriptors.push(layer.provider_descriptor);
      perIndexerCoverage.push(layer.coverage);
    }

    const graphNodes = [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id));
    const graphEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
    const callGraphAvailable = perIndexerCoverage.some((c) => c.call_graph_available === true);
    const callGraphUnavailableReason =
      perIndexerCoverage.find(
        (c) =>
          c.call_graph_available === false &&
          typeof c.call_graph_unavailable_reason === "string" &&
          c.call_graph_unavailable_reason.length > 0
      )?.call_graph_unavailable_reason || SCIP_CALL_GRAPH_REASON_ENCLOSING_RANGE_UNPOPULATED;

    return {
      graph_schema_version: SIDECAR_GRAPH_SCHEMA_VERSION,
      scip_available: true,
      status_reason: SCIP_STATUS_EXTRACTED,
      graph_nodes: graphNodes,
      graph_edges: graphEdges,
      provider_descriptors: providerDescriptors,
      coverage: {
        indexers: [...indexers],
        cache_dir: cacheDir,
        document_count: perIndexerCoverage.reduce((sum, c) => sum + (c.document_count || 0), 0),
        covered_document_count: perIndexerCoverage.reduce(
          (sum, c) => sum + (c.covered_document_count || 0),
          0
        ),
        symbol_count: graphNodes.length,
        edge_count: graphEdges.length,
        resolved_symbol_count: perIndexerCoverage.reduce(
          (sum, c) => sum + (c.resolved_symbol_count || 0),
          0
        ),
        unresolved_symbol_count: perIndexerCoverage.reduce(
          (sum, c) => sum + (c.unresolved_symbol_count || 0),
          0
        ),
        // Call-graph aggregates across indexers (SLICE-003). edge_count above is now
        // inclusive of calls_symbol; caller_edge_count is the precise caller-edge figure.
        caller_edge_count: perIndexerCoverage.reduce((sum, c) => sum + (c.caller_edge_count || 0), 0),
        unattributed_reference_count: perIndexerCoverage.reduce(
          (sum, c) => sum + (c.unattributed_reference_count || 0),
          0
        ),
        call_graph_available: callGraphAvailable,
        ...(callGraphAvailable
          ? {}
          : {
              call_graph_status_reason: SCIP_CALL_GRAPH_UNAVAILABLE,
              call_graph_unavailable_reason: callGraphUnavailableReason
            }),
        uncovered_documents: perIndexerCoverage
          .flatMap((c) => c.uncovered_documents || [])
          .sort((left, right) => left.localeCompare(right)),
        per_indexer: perIndexerCoverage
      }
    };
  } catch (error) {
    // Degrade (2): indexer exec or decode failure -> clean unavailable layer.
    return emptyScipLayer({
      statusReason: SCIP_STATUS_INDEXER_UNAVAILABLE,
      errorReason: error?.message ? String(error.message).slice(0, 500) : "scip_overlay_failed",
      indexers
    });
  }
}

// Remove the ignored .scip cache (used by the wrapper / integration cleanup).
export async function clearScipCache({ repoRoot, cacheDir = SCIP_DEFAULT_CACHE_DIR } = {}) {
  await rm(path.join(repoRoot, cacheDir), { recursive: true, force: true });
}

// Persist a decoded->normalized layer's cache metadata (advisory; lets the wrapper
// skip re-running indexers when neither HEAD nor the indexer versions changed).
export async function writeScipCacheMeta({ repoRoot, cacheDir = SCIP_DEFAULT_CACHE_DIR, meta }) {
  const metaPath = path.join(repoRoot, cacheDir, "scip-cache-meta.json");
  await mkdir(path.join(repoRoot, cacheDir), { recursive: true });
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}
