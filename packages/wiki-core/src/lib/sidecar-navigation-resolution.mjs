import { parseScipSymbol } from "./sidecar-scip-normalize.mjs";

const POSITION_UNRESOLVED = "symbol_not_resolved_at_position";
const POSITION_AMBIGUOUS = "ambiguous_symbol_at_position";
const EXPLICIT_UNRESOLVED = "symbol_not_resolved";
const EXPLICIT_AMBIGUOUS = "ambiguous_symbol";
export const NATIVE_IDENTITY_UNAVAILABLE = "native_identity_unavailable";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function nativeOccurrenceIdentity(row) {
  return JSON.stringify(["occurrence", row.provider_id, row.symbol_id, row.document_path,
    row.contribution_id, row.document_ordinal, row.occurrence_ordinal]);
}

export function isNativeDefinition(row) {
  const roles = row.payload?.symbol_roles;
  return Number.isSafeInteger(roles) && (roles & 1) === 1;
}

function validRange(range) {
  return Number.isSafeInteger(range?.start_line) && Number.isSafeInteger(range?.end_line) &&
    range.start_line > 0 && range.start_line <= range.end_line;
}

export function compareNativeRows(left, right) {
  const [leftRange, rightRange] = [left.payload.range, right.payload.range];
  return compareText(left.document_path, right.document_path) ||
    Number(validRange(rightRange)) - Number(validRange(leftRange)) ||
    (leftRange?.start_line ?? 0) - (rightRange?.start_line ?? 0) ||
    compareText(nativeOccurrenceIdentity(left), nativeOccurrenceIdentity(right));
}

function selectedNativeRows(selection) {
  const rows = new Map();
  for (const row of [...selection.occurrences, ...selection.position_occurrences]) {
    if (typeof row.payload?.symbol_key !== "string") continue;
    const id = nativeOccurrenceIdentity(row);
    if (!rows.has(id)) rows.set(id, structuredClone(row));
  }
  return [...rows.values()].sort(compareNativeRows);
}

function symbolFacts(selection, rows) {
  const projects = selection.publication?.provider_coverage?.projects;
  const indexers = new Map((Array.isArray(projects) ? projects : [])
    .filter((project) => typeof project?.key === "string" && typeof project.indexer === "string")
    .map((project) => [project.key, project.indexer]));
  return selection.symbols.map((symbol) => {
    const native = rows.filter((row) => row.provider_id === symbol.provider_id &&
      row.symbol_id === symbol.symbol_id);
    const nativeKeys = new Set(native.map((row) => row.payload.symbol_key));
    const nativeIndexers = new Set(native.map((row) => row.payload.indexer));
    const indexer = nativeIndexers.size === 1 ? [...nativeIndexers][0]
      : native.length === 0 ? indexers.get(symbol.provider_id) : undefined;
    const key = nativeKeys.size === 1 ? [...nativeKeys][0]
      : native.length === 0 && indexer && !parseScipSymbol(symbol.raw_symbol).local
        ? JSON.stringify([indexer, symbol.raw_symbol]) : null;
    return { ...structuredClone(symbol), symbol_key: key, indexer: indexer ?? null,
      limitations: key === null ? [NATIVE_IDENTITY_UNAVAILABLE] : [] };
  });
}

function distinctJson(values) {
  const found = new Map(values.filter((value) => value && typeof value === "object")
    .map((value) => [JSON.stringify(value), value]));
  return [...found.keys()].sort(compareText).map((key) => structuredClone(found.get(key)));
}

function candidateFor(key, { rows, facts, anchors }) {
  const own = rows.filter((row) => row.payload.symbol_key === key);
  const ownFacts = facts.filter((fact) => fact.symbol_key === key);
  const first = own[0]?.payload;
  const symbol = first?.symbol ?? ownFacts[0].raw_symbol;
  const resolutionFacts = distinctJson([...own.map((row) => row.payload.resolution),
    ...ownFacts.map((fact) => fact.payload?.resolution)]);
  return {
    symbol_key: key,
    indexer: first?.indexer ?? ownFacts[0].indexer,
    symbol,
    path: parseScipSymbol(symbol).local ? first?.path ?? null : null,
    provider_ids: [...new Set([...own, ...ownFacts].map((entry) => entry.provider_id))]
      .sort(compareText),
    resolution_facts: resolutionFacts,
    rows: own,
    anchors: anchors.filter((row) => row.payload.symbol_key === key),
    symbol_document_paths: ownFacts.map((fact) => fact.document_path)
      .filter((value) => typeof value === "string" && value.length > 0),
    external: resolutionFacts.some((fact) => fact.unresolved_reason === "external_symbol_information")
  };
}

export function resolveNativeNavigation({ input, selection }) {
  const rows = selectedNativeRows(selection);
  const facts = symbolFacts(selection, rows);
  const position = !Object.hasOwn(input, "symbol");
  const anchors = position
    ? rows.filter((row) => row.document_path === input.path && validRange(row.payload.range) &&
      row.payload.range.start_line <= input.line && input.line <= row.payload.range.end_line)
    : [];
  const keys = new Set(anchors.map((row) => row.payload.symbol_key));
  if (!position) {
    for (const row of rows) {
      if (row.payload.symbol === input.symbol &&
          (!Object.hasOwn(input, "path") || row.payload.path === input.path)) {
        keys.add(row.payload.symbol_key);
      }
    }
    for (const fact of facts) {
      if (fact.raw_symbol === input.symbol && fact.symbol_key !== null &&
          !parseScipSymbol(fact.raw_symbol).local) keys.add(fact.symbol_key);
    }
  }
  const candidates = [...keys].sort(compareText)
    .map((key) => candidateFor(key, { rows, facts, anchors }));
  const [only] = candidates;
  let state = "unresolved";
  let reason = position ? POSITION_UNRESOLVED : EXPLICIT_UNRESOLVED;
  if (candidates.length > 1) {
    [state, reason] = ["ambiguous", position ? POSITION_AMBIGUOUS : EXPLICIT_AMBIGUOUS];
  } else if (only && (only.rows.some(isNativeDefinition) ||
      only.resolution_facts.some((fact) => fact.state === "resolved"))) {
    [state, reason] = ["resolved", "symbol_resolved"];
  } else if (only) {
    reason = "symbol_resolution_unresolved";
  }
  return {
    symbol: candidates.length === 1 ? only.symbol : candidates.length === 0 && !position
      ? input.symbol : null,
    resolution: {
      kind: position ? "path_position" : "explicit_symbol",
      state,
      status_reason: reason,
      ...(Object.hasOwn(input, "path") ? { path: input.path } : {}),
      ...(position ? { line: input.line, character: input.character ?? null,
        position_granularity: "line" } : {})
    },
    candidates,
    symbol_facts: facts
  };
}
