import { parseScipSymbol } from "./sidecar-scip-normalize.mjs";

const EXPLICIT_UNRESOLVED = "symbol_not_resolved";
const EXPLICIT_AMBIGUOUS = "ambiguous_symbol";
const NATIVE_IDENTITY_UNAVAILABLE = "native_identity_unavailable";

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

export function validNativeRange(range) {
  return Number.isSafeInteger(range?.start_line) && Number.isSafeInteger(range?.end_line) &&
    range.start_line > 0 && range.start_line <= range.end_line;
}

export function compareNativeRows(left, right) {
  const [leftRange, rightRange] = [left.payload.range, right.payload.range];
  return compareText(left.document_path, right.document_path) ||
    Number(validNativeRange(rightRange)) - Number(validNativeRange(leftRange)) ||
    (leftRange?.start_line ?? 0) - (rightRange?.start_line ?? 0) ||
    (leftRange?.start_character ?? 0) - (rightRange?.start_character ?? 0) ||
    (leftRange?.end_line ?? 0) - (rightRange?.end_line ?? 0) ||
    (leftRange?.end_character ?? 0) - (rightRange?.end_character ?? 0) ||
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
  const partial = new Set((selection.partial_symbols ?? []).map((symbol) =>
    `${symbol.provider_id}\0${symbol.symbol_id}`));
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
    const whole = !partial.has(`${symbol.provider_id}\0${symbol.symbol_id}`);
    const key = nativeKeys.size === 1 && whole ? [...nativeKeys][0]
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

export function nativeMultiplicityRows(rows) {
  const signature = (row) => JSON.stringify([row.payload.symbol_key, row.document_path, row.payload.range,
    row.payload.symbol_roles, row.payload.enclosing_range]);
  const populations = new Map();
  for (const row of rows) {
    if (row.payload.indexer !== "scip-typescript") continue;
    const key = signature(row);
    if (!populations.has(key)) populations.set(key, new Map());
    const projects = populations.get(key);
    projects.set(row.provider_id, (projects.get(row.provider_id) ?? 0) + 1);
  }

  const projectOf = new Map();
  for (const [key, projects] of populations) {
    projectOf.set(key, [...projects].sort(([left, a], [right, b]) => b - a || compareText(left, right))[0][0]);
  }
  const admit = (row) => {
    if (row.payload.indexer !== "scip-typescript") return true;
    return projectOf.get(signature(row)) === row.provider_id;
  };
  return rows.filter(admit);
}

export function nativeSelectionCandidates(selection, { select = null } = {}) {
  const rows = selectedNativeRows(selection);
  const facts = symbolFacts(selection, rows);
  const selected = select === null ? null : select(rows, facts);
  const keys = selected === null ? new Set([...rows.map(row => row.payload.symbol_key),
    ...facts.map(fact => fact.symbol_key).filter(key => key !== null)]) : selected.keys;
  const candidates = [...keys].sort(compareText).map(key => candidateFor(key,
    { rows, facts, anchors: selected?.anchors ?? [] }));
  const [only] = candidates;
  return { candidates, symbol_facts: facts, ...(selected === null ? {} : {
    state: candidates.length > 1 ? "ambiguous" : only && (only.rows.some(isNativeDefinition) ||
      only.resolution_facts.some(fact => fact.state === "resolved")) ? "resolved" : "unresolved"
  }) };
}

export function resolveExplicitNativeIdentity({ input, selection }) {
  const { candidates, symbol_facts, state } = nativeSelectionCandidates(selection, { select: (rows, facts) => {
    const keys = new Set();
    for (const row of rows) {
      if (row.payload.symbol === input.symbol &&
          (!Object.hasOwn(input, "path") || row.payload.path === input.path)) keys.add(row.payload.symbol_key);
    }
    for (const fact of facts) {
      if (fact.raw_symbol === input.symbol && fact.symbol_key !== null &&
          !parseScipSymbol(fact.raw_symbol).local) keys.add(fact.symbol_key);
    }
    return { keys };
  } });
  return { symbol: candidates.length === 1 ? candidates[0].symbol : candidates.length === 0 ? input.symbol : null,
    resolution: { kind: "explicit_symbol", state,
      status_reason: state === "ambiguous" ? EXPLICIT_AMBIGUOUS : state === "resolved" ? "symbol_resolved"
        : candidates.length ? "symbol_resolution_unresolved" : EXPLICIT_UNRESOLVED,
      ...(Object.hasOwn(input, "path") ? { path: input.path } : {}) }, candidates, symbol_facts };
}

export function nativeDefinitionSymbols(rows) {
  const named = new Map();
  for (const row of rows.filter(isNativeDefinition)) {
    named.set(`${row.provider_id}\0${row.symbol_id}`, { provider_id: row.provider_id,
      symbol_id: row.symbol_id, document_local: parseScipSymbol(row.payload.symbol).local });
  }
  return [...named.values()];
}
