const DEFINITION_ROLE = 0x1;
const IGNORED_REASON_ORDER = [
  "invalid_definition_range",
  "absent_enclosing_range",
  "invalid_enclosing_range"
];

function decodedLineStarts(sourceText) {
  if (sourceText.length === 0) return [];
  const starts = [0];
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText.charCodeAt(index) === 0x0a && index + 1 < sourceText.length) {
      starts.push(index + 1);
    }
  }
  return starts;
}

export function decodeCommittedSource(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new TypeError("decodeCommittedSource requires a Buffer");
  }
  if (bytes.includes(0)) return { state: "unavailable", reason: "binary_source" };

  let sourceText;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { state: "unavailable", reason: "invalid_utf8" };
  }
  const lineStarts = decodedLineStarts(sourceText);
  return {
    state: "available",
    source_text: sourceText,
    line_count: lineStarts.length,
    line_starts: lineStarts
  };
}

function validRange(range, lineCount) {
  return Boolean(range) && Number.isSafeInteger(range.start_line) &&
    Number.isSafeInteger(range.end_line) && range.start_line > 0 &&
    range.start_line <= range.end_line && range.end_line <= lineCount;
}

function contains(outer, inner) {
  return outer.start_line <= inner.start_line && outer.end_line >= inner.end_line;
}

function roleIsDefinition(symbolRoles) {
  return Number.isSafeInteger(symbolRoles) && symbolRoles >= 0 &&
    (symbolRoles & DEFINITION_ROLE) === DEFINITION_ROLE;
}

function selectionBasis(primary, ignored) {
  return [primary, ...IGNORED_REASON_ORDER.filter((reason) => ignored.has(reason))];
}

function completeFile(source, primary, ignored = new Set()) {
  if (source.line_count === 0) {
    return {
      state: "available",
      kind: "complete_file",
      start_line: null,
      end_line: null,
      line_count: 0,
      source_text: "",
      selection_basis: ["empty_file"]
    };
  }
  return {
    state: "available",
    kind: "complete_file",
    start_line: 1,
    end_line: source.line_count,
    line_count: source.line_count,
    source_text: source.source_text,
    selection_basis: selectionBasis(primary, ignored)
  };
}

function selectedRegion(source, range, ignored) {
  const startOffset = source.line_starts[range.start_line - 1];
  const endOffset = source.line_starts[range.end_line] ?? source.source_text.length;
  return {
    state: "available",
    kind: "enclosing_definition",
    start_line: range.start_line,
    end_line: range.end_line,
    line_count: range.end_line - range.start_line + 1,
    source_text: source.source_text.slice(startOffset, endOffset),
    selection_basis: selectionBasis("enclosing_definition", ignored)
  };
}

export function selectCommittedSourceRegion({
  source,
  target_range: targetRange,
  definition_occurrences: definitionOccurrences
}) {
  if (!source || typeof source !== "object" ||
      !Array.isArray(definitionOccurrences)) {
    throw new TypeError("selectCommittedSourceRegion requires decoded source and occurrences");
  }
  if (source.state === "unavailable") {
    return { state: source.state, reason: source.reason };
  }
  if (source.state !== "available" || typeof source.source_text !== "string" ||
      !Number.isSafeInteger(source.line_count) || !Array.isArray(source.line_starts)) {
    throw new TypeError("selectCommittedSourceRegion requires decoded source and occurrences");
  }
  if (source.line_count === 0) return completeFile(source, "empty_file");
  if (!validRange(targetRange, source.line_count)) {
    return completeFile(source, "invalid_target_range");
  }

  const ignored = new Set();
  const distinctCandidates = new Map();
  for (const occurrence of definitionOccurrences) {
    if (!roleIsDefinition(occurrence?.symbol_roles)) continue;
    if (!validRange(occurrence.range, source.line_count)) {
      ignored.add("invalid_definition_range");
      continue;
    }
    if (occurrence.enclosing_range == null) {
      ignored.add("absent_enclosing_range");
      continue;
    }
    if (!validRange(occurrence.enclosing_range, source.line_count) ||
        !contains(occurrence.enclosing_range, occurrence.range)) {
      ignored.add("invalid_enclosing_range");
      continue;
    }
    if (contains(occurrence.enclosing_range, targetRange)) {
      const range = occurrence.enclosing_range;
      distinctCandidates.set(`${range.start_line}:${range.end_line}`, range);
    }
  }

  const candidates = [...distinctCandidates.values()].sort((left, right) =>
    left.start_line - right.start_line || right.end_line - left.end_line);
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      if (!contains(candidates[leftIndex], candidates[rightIndex]) &&
          !contains(candidates[rightIndex], candidates[leftIndex])) {
        return completeFile(source, "crossing_enclosing_ranges", ignored);
      }
    }
  }
  if (candidates.length === 0) {
    return completeFile(source, "enclosing_scope_unavailable", ignored);
  }
  return selectedRegion(source, candidates[0], ignored);
}
