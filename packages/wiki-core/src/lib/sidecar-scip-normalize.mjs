

import { fromBinary } from "@bufbuild/protobuf";
import { IndexSchema } from "@scip-code/scip";

import {
  SIDECAR_GRAPH_SCHEMA_VERSION,
  SIDECAR_GRAPH_SCIP_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS
} from "./sidecar-graph-schema.mjs";

export const SCIP_PROTOCOL_VERSION = "0.8.1";

export const SCIP_INDEXER_SPECS = Object.freeze({
  "scip-typescript": Object.freeze({
    scheme: "scip-typescript",
    output: "typescript.scip"
  }),
  "scip-python": Object.freeze({
    scheme: "scip-python",
    output: "python.scip"
  }),
  "scip-go": Object.freeze({
    scheme: "scip-go",
    output: "go.scip"
  }),
  "rust-analyzer": Object.freeze({
    scheme: "rust-analyzer",
    output: "rust.scip"
  })
});

const SCIP_SYMBOL_ROLE_DEFINITION = 0x1;

export const SCIP_CALL_GRAPH_EXTRACTED = "scip_call_graph_extracted";
export const SCIP_CALL_GRAPH_UNAVAILABLE = "scip_call_graph_unavailable";
export const SCIP_CALL_GRAPH_REASON_ENCLOSING_RANGE_UNPOPULATED =
  "enclosing_range_unpopulated";

export async function decodeScipIndex(buffer) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw new TypeError("decodeScipIndex requires a Buffer/Uint8Array of .scip bytes");
  }
  return fromBinary(IndexSchema, buffer);
}

function hasDefinitionRole(symbolRoles) {
  return (Number(symbolRoles || 0) & SCIP_SYMBOL_ROLE_DEFINITION) === SCIP_SYMBOL_ROLE_DEFINITION;
}

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

export function createScipProviderDescriptor({ indexer, toolName, toolVersion }) {
  const name = toolName || indexer || "scip";
  const version = toolVersion || "unknown";
  const descriptor = {
    name,
    version,
    scip_protocol_version: SCIP_PROTOCOL_VERSION,
    cache_key: `${name}@${version}:scip@${SCIP_PROTOCOL_VERSION}`
  };

  for (const field of SIDECAR_GRAPH_SCIP_PROVIDER_DESCRIPTOR_REQUIRED_FIELDS) {
    if (typeof descriptor[field] !== "string" || descriptor[field].length === 0) {
      descriptor[field] = "unknown";
    }
  }
  return descriptor;
}

function parseLegacyRange(range) {
  if (!Array.isArray(range) || range.length < 3) {
    return null;
  }
  if (range.length !== 3 && range.length !== 4) return null;
  const nums = range.map(Number);
  if (nums.some((value) => !Number.isInteger(value) || value < 0)) {
    return null;
  }
  const parsed = nums.length === 3
    ? { startLine: nums[0], startChar: nums[1], endLine: nums[0], endChar: nums[2] }
    : { startLine: nums[0], startChar: nums[1], endLine: nums[2], endChar: nums[3] };
  return comparePosition(parsed.startLine, parsed.startChar, parsed.endLine, parsed.endChar) <= 0
    ? parsed
    : null;
}

function parseTypedRange(oneof, enclosing = false) {
  const singleCase = enclosing ? "singleLineEnclosingRange" : "singleLineRange";
  const multiCase = enclosing ? "multiLineEnclosingRange" : "multiLineRange";
  if (!oneof || oneof.case === undefined) return { range: null, unsupported: false };
  const value = oneof.value;
  if (oneof.case === singleCase) {
    return {
      range: parseLegacyRange([value?.line, value?.startCharacter, value?.endCharacter]),
      unsupported: false
    };
  }
  if (oneof.case === multiCase) {
    return {
      range: parseLegacyRange([
        value?.startLine, value?.startCharacter, value?.endLine, value?.endCharacter
      ]),
      unsupported: false
    };
  }
  return { range: null, unsupported: true };
}

function parseOccurrenceRange(occurrence, enclosing = false) {
  const oneof = enclosing ? occurrence?.typedEnclosingRange : occurrence?.typedRange;
  const typed = parseTypedRange(oneof, enclosing);
  if (oneof?.case !== undefined) return {
    ...typed,
    invalid: !typed.unsupported && !typed.range
  };
  const legacy = enclosing ? occurrence?.enclosingRange : occurrence?.range;
  if (!Array.isArray(legacy) || legacy.length === 0) {
    return { range: null, unsupported: false, invalid: !enclosing };
  }
  if (legacy.length !== 3 && legacy.length !== 4) {
    return { range: null, unsupported: true, invalid: false };
  }
  const range = parseLegacyRange(legacy);
  return { range, unsupported: false, invalid: !range };
}

function wholeLineRange(range) {
  if (!range) return null;
  const startLine = range.startLine + 1;
  const producerLastLine = range.endLine + (range.endChar === 0 ? 0 : 1);
  return { start_line: startLine, end_line: Math.max(startLine, producerLastLine) };
}

function firstRangeLine(occurrence) {
  return wholeLineRange(parseOccurrenceRange(occurrence).range)?.start_line ?? null;
}

function symbolKey(indexer, relativePath, symbol) {
  return JSON.stringify(
    parseScipSymbol(symbol).local ? [indexer, relativePath, symbol] : [indexer, symbol]
  );
}

function comparePosition(aLine, aChar, bLine, bChar) {
  if (aLine !== bLine) {
    return aLine - bLine;
  }
  return aChar - bChar;
}

function scopeContainsRange(scope, range) {
  return (
    comparePosition(scope.startLine, scope.startChar, range.startLine, range.startChar) <= 0 &&
    comparePosition(range.endLine, range.endChar, scope.endLine, scope.endChar) <= 0
  );
}

function buildScopeIndex(occurrences) {
  const scopes = [];
  for (const occurrence of occurrences) {
    if (!hasDefinitionRole(occurrence?.symbolRoles)) {
      continue;
    }
    const symbol = occurrence?.symbol;
    if (typeof symbol !== "string" || symbol.length === 0) {
      continue;
    }
    const enclosing = parseOccurrenceRange(occurrence, true).range;
    if (!enclosing) {
      continue;
    }
    scopes.push({ ...enclosing, symbol, local: parseScipSymbol(symbol).local });
  }
  return scopes;
}

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

export function normalizeScipIndex(decodedIndex, {
  indexer = "scip",
  baseFileNodeIds = null,
  providerDescriptor = null
} = {}) {
  if (!decodedIndex || typeof decodedIndex !== "object") {
    throw new TypeError("normalizeScipIndex requires a decoded .scip Index object");
  }
  const documents = Array.isArray(decodedIndex.documents) ? decodedIndex.documents : [];
  const externalSymbols = Array.isArray(decodedIndex.externalSymbols)
    ? decodedIndex.externalSymbols
    : [];
  const toolInfo = decodedIndex.metadata?.toolInfo ?? {};
  const descriptor =
    providerDescriptor ||
    createScipProviderDescriptor({
      indexer,
      toolName: toolInfo.name,
      toolVersion: toolInfo.version
    });

  const externalSymbolSet = new Set(
    externalSymbols.map((info) => info?.symbol).filter((symbol) => typeof symbol === "string")
  );

  const definedSymbols = new Set();

  let definitionOccurrenceCount = 0;
  let enclosingRangeDefinitionCount = 0;
  for (const document of documents) {
    const relativePath = document?.relativePath;
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
      if (hasDefinitionRole(occurrence.symbolRoles)) {
        definitionOccurrenceCount += 1;
        if (parseOccurrenceRange(occurrence, true).range) {
          enclosingRangeDefinitionCount += 1;
        }
      }
      if (parseScipSymbol(symbol).local) {
        continue;
      }
      if (hasDefinitionRole(occurrence.symbolRoles)) {
        definedSymbols.add(symbol);
      }
    }
  }

  const callGraphAvailable = enclosingRangeDefinitionCount > 0;

  const displayNames = new Map();
  for (const document of documents) {
    for (const info of document?.symbols || []) {
      if (typeof info?.symbol === "string" && typeof info.displayName === "string") {
        displayNames.set(info.symbol, info.displayName);
      }
    }
  }
  for (const info of externalSymbols) {
    if (typeof info?.symbol === "string" && typeof info.displayName === "string" && !displayNames.has(info.symbol)) {
      displayNames.set(info.symbol, info.displayName);
    }
  }

  const nodes = new Map();
  const edges = new Map();
  const uncoveredDocuments = [];
  const coveredPaths = [];
  const symbolOccurrences = [];

  const callEdges = new Map();
  let unattributedReferenceCount = 0;
  function attributeCall(scopeIndex, occurrence, calleeSymbol, relativePath, line) {
    const referenceRange = parseOccurrenceRange(occurrence).range;
    const scope = referenceRange ? innermostContainingScope(scopeIndex, referenceRange) : null;
    if (!scope || scope.local) {

      unattributedReferenceCount += 1;
      return;
    }
    const caller = scope.symbol;
    const key = `${caller} ${calleeSymbol}`;
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
    empty_symbol_count: 0,
    invalid_range_count: 0,
    unsupported_range_count: 0,
    invalid_enclosing_range_count: 0,
    unsupported_enclosing_range_count: 0
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
    const relativePath = document?.relativePath;
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      continue;
    }
    const admitted = !baseFileNodeIds || baseFileNodeIds.has(fileNodeIdForPath(relativePath));
    if (!admitted) {

      uncoveredDocuments.push(relativePath);
      continue;
    }
    counts.covered_document_count += 1;
    coveredPaths.push(relativePath);

    const scopeIndex = callGraphAvailable ? buildScopeIndex(document.occurrences || []) : [];
    const localDefinitions = new Set(
      (document.occurrences || [])
        .filter((occurrence) => hasDefinitionRole(occurrence?.symbolRoles))
        .map((occurrence) => occurrence?.symbol)
        .filter((symbol) => parseScipSymbol(symbol).local)
    );

    for (const [producerOrder, occurrence] of (document.occurrences || []).entries()) {
      counts.occurrence_count += 1;
      const symbol = occurrence?.symbol;
      if (typeof symbol !== "string" || symbol.length === 0) {
        counts.empty_symbol_count += 1;
        continue;
      }
      const parsed = parseScipSymbol(symbol);
      const parsedRange = parseOccurrenceRange(occurrence);
      const parsedEnclosingRange = parseOccurrenceRange(occurrence, true);
      if (parsedRange.unsupported) counts.unsupported_range_count += 1;
      else if (parsedRange.invalid) counts.invalid_range_count += 1;
      if (parsedEnclosingRange.unsupported) counts.unsupported_enclosing_range_count += 1;
      else if (
        (Array.isArray(occurrence.enclosingRange) && occurrence.enclosingRange.length > 0) ||
        occurrence.typedEnclosingRange?.case !== undefined
      ) {
        if (parsedEnclosingRange.invalid) counts.invalid_enclosing_range_count += 1;
      }
      const sourceRange = wholeLineRange(parsedRange.range);
      if (sourceRange) {
        const localResolution = parsed.local
          ? localDefinitions.has(symbol)
            ? { state: "resolved", dynamic_boundary: false }
            : { state: "unresolved", dynamic_boundary: false, unresolved_reason: "missing_local_definition" }
          : resolutionFor(symbol);
        symbolOccurrences.push({
          indexer,
          path: relativePath,
          symbol,
          symbol_key: symbolKey(indexer, relativePath, symbol),
          symbol_roles: Number(occurrence.symbolRoles || 0),
          range: sourceRange,
          enclosing_range: wholeLineRange(parsedEnclosingRange.range),
          resolution: localResolution,
          producer_order: producerOrder
        });
      }
      if (parsed.local) {

        counts.local_symbol_count += 1;
        continue;
      }
      const line = firstRangeLine(occurrence);
      ensureSymbolNode(symbol, parsed);
      if (hasDefinitionRole(occurrence.symbolRoles)) {
        counts.definition_count += 1;
        addSymbolEdge("defines_symbol", relativePath, symbol, line);
      } else {
        counts.reference_count += 1;
        addSymbolEdge("references_symbol", relativePath, symbol, line);

        if (callGraphAvailable) {
          attributeCall(scopeIndex, occurrence, symbol, relativePath, line);
        }
      }
    }
  }

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
  const orderedOccurrences = symbolOccurrences
    .sort((left, right) =>
      left.indexer.localeCompare(right.indexer) ||
      left.path.localeCompare(right.path) ||
      left.range.start_line - right.range.start_line ||
      left.range.end_line - right.range.end_line ||
      left.symbol_key.localeCompare(right.symbol_key) ||
      left.symbol_roles - right.symbol_roles ||
      left.producer_order - right.producer_order)
    .map(({ producer_order: _producerOrder, ...occurrence }) => occurrence);

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
    symbol_occurrences: orderedOccurrences,
    provider_descriptor: descriptor,

    call_graph_available: callGraphAvailable,
    call_graph_status_reason: callGraphStatusReason,
    ...(callGraphAvailable
      ? {}
      : { call_graph_unavailable_reason: SCIP_CALL_GRAPH_REASON_ENCLOSING_RANGE_UNPOPULATED }),

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
