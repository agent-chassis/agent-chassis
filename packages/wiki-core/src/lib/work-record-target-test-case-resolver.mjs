export const WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER = Object.freeze({
  id: "portfolio-local.target-test-case-resolver",
  version: "0.1.0",
  mode: "local"
});
export const WORK_RECORD_TARGET_TEST_CASE_RESOLVER_SUPPORTED_KIND_VALUES = new Set(["test_case"]);
const OPERATION_VALUES = new Set(["create", "modify", "delete", "inspect"]);
function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function repoPath(value) {
  return stringValue(value)?.replaceAll("\\", "/").replace(/^\.\//u, "") ?? null;
}
function controlled(value, allowed) {
  const normalized = stringValue(value)?.toLowerCase().replaceAll("-", "_").replace(/\s+/gu, "_") ?? null;
  return normalized && allowed.has(normalized) ? normalized : null;
}
function targetFrom(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    path: repoPath(input.path),
    kind: stringValue(input.kind)?.toLowerCase() ?? null,
    name: stringValue(input.name),
    operation: controlled(input.operation, OPERATION_VALUES),
    optional: input.optional === true
  };
}
function selectedUnitFrom(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const unit = {
    kind: stringValue(value.kind)?.toLowerCase() ?? null,
    address: stringValue(value.address ?? value.work_unit_address ?? value.workUnitAddress),
    record_id: stringValue(value.record_id ?? value.recordId),
    slice_id: stringValue(value.slice_id ?? value.sliceId),
    repo: stringValue(value.repo ?? value.repository)
  };
  return Object.values(unit).some(Boolean) ? unit : null;
}
function spanFrom(startLine, endLine) {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) return null;
  return { start_line: startLine, end_line: endLine, line_count: endLine - startLine + 1 };
}
function evidence(target, status, reason, options = {}) {
  const candidateCount = Number.isInteger(options.candidateCount) ? options.candidateCount : 0;
  return {
    target_resolution_evidence_status: status === "resolved" || status === "not_applicable" ? "present" : status === "ambiguous" ? "partial" : "degraded",
    target_resolution_provider: WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER,
    target_resolution_target: target,
    target_resolution_status: status,
    target_resolution_status_reason: reason,
    target_resolution_span: options.span ?? null,
    target_resolution_fanout: candidateCount > 0 ? { direct_reference_count: candidateCount, affected_symbol_count: candidateCount } : null,
    target_resolution_candidates: Array.isArray(options.candidates) ? options.candidates : [],
    source_record_digest: stringValue(options.source_record_digest),
    selected_unit: selectedUnitFrom(options.selected_unit),
    payload_bound_input_digest: stringValue(options.payload_bound_input_digest)
  };
}
function isTestFile(path) {
  return Boolean(path && !path.startsWith("/") && !path.includes("\0") && !path.startsWith("../") && !path.includes("/../") && /(?:^|\/)[^/]+\.test\.(?:mjs|js)$/u.test(path));
}
function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) if (text[index] === "\n") starts.push(index + 1);
  return starts;
}
function lineFor(starts, offset) {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1;
  return line + 1;
}

const isIdentifierStart = (character) => /[A-Za-z_$]/u.test(character);
const isIdentifierPart = (character) => /[A-Za-z0-9_$]/u.test(character);

function readString(text, index, line) {
  const quote = text[index];
  let value = "";
  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "\n") return null;
    if (character === "\\") {
      if (text[cursor + 1] === undefined || text[cursor + 1] === "\n") return null;
      value += text[cursor + 1];
      cursor += 1;
      continue;
    }
    if (character === quote) return { token: { type: "string", value, line, start: index, end: cursor + 1 }, next: cursor + 1 };
    value += character;
  }
  return null;
}

function tokensFrom(sourceText) {
  const tokens = [];
  let line = 1;
  for (let index = 0; index < sourceText.length;) {
    const character = sourceText[index];
    if (character === "\n") { line += 1; index += 1; continue; }
    if (/\s/u.test(character)) { index += 1; continue; }
    if (character === "/" && sourceText[index + 1] === "/") { index += 2; while (index < sourceText.length && sourceText[index] !== "\n") index += 1; continue; }
    if (character === "/" && sourceText[index + 1] === "*") { index += 2; while (index < sourceText.length && (sourceText[index] !== "*" || sourceText[index + 1] !== "/")) { if (sourceText[index] === "\n") line += 1; index += 1; } index += 2; continue; }
    if (character === "/") { index += 1; while (index < sourceText.length && sourceText[index] !== "/" && sourceText[index] !== "\n") index += sourceText[index] === "\\" ? 2 : 1; index += sourceText[index] === "/" ? 1 : 0; continue; }
    if (character === "'" || character === '"') { const result = readString(sourceText, index, line); if (result) tokens.push(result.token); index = result?.next ?? index + 1; continue; }
    if (character === "`") { index += 1; while (index < sourceText.length && sourceText[index] !== "`") { if (sourceText[index] === "\n") line += 1; index += sourceText[index] === "\\" ? 2 : 1; } index += 1; continue; }
    if (character === "?" && sourceText[index + 1] === ".") { tokens.push({ type: "?.", value: "?.", line, start: index, end: index + 2 }); index += 2; continue; }
    if ("(){}[],;.*=".includes(character)) { tokens.push({ type: character, value: character, line, start: index, end: index + 1 }); index += 1; continue; }
    if (isIdentifierStart(character)) { const start = index; index += 1; while (index < sourceText.length && isIdentifierPart(sourceText[index])) index += 1; tokens.push({ type: "identifier", value: sourceText.slice(start, index), line, start, end: index }); continue; }
    index += 1;
  }
  return tokens;
}

function nodeTestBindings(tokens) {
  const bindings = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.value !== "import") continue;
    const importLine = tokens[index].line, importEnd = tokens.findIndex((token, tokenIndex) => tokenIndex > index && (token.type === ";" || token.line > importLine)), beforeImportEnd = (tokenIndex) => tokenIndex > index && (importEnd < 0 || tokenIndex < importEnd);
    const fromIndex = tokens.findIndex((token, tokenIndex) => beforeImportEnd(tokenIndex) && token.type === "identifier" && token.value === "from");
    const specifier = tokens[fromIndex + 1];
    if (fromIndex < 0 || specifier?.type !== "string" || specifier.value !== "node:test") continue;
    if (tokens[index + 1]?.type === "identifier" && tokens[index + 1].value !== "from") bindings.set(tokens[index + 1].value, index + 1);
    const openBraceIndex = tokens.findIndex((token, tokenIndex) => beforeImportEnd(tokenIndex) && tokenIndex < fromIndex && token.type === "{");
    const closeBraceIndex = tokens.findIndex((token, tokenIndex) => tokenIndex > openBraceIndex && tokenIndex < fromIndex && token.type === "}");
    for (let specIndex = openBraceIndex + 1; openBraceIndex >= 0 && specIndex < closeBraceIndex; specIndex += 1) {
      if (tokens[specIndex]?.type === "identifier" && tokens[specIndex].value !== "test" && tokens[specIndex + 1]?.value === "as") { specIndex += 2; continue; }
      if (tokens[specIndex]?.type !== "identifier" || tokens[specIndex].value !== "test") continue;
      const local = tokens[specIndex + 1]?.value === "as" && tokens[specIndex + 2]?.type === "identifier" ? specIndex + 2 : specIndex;
      bindings.set(tokens[local].value, local);
      specIndex = local;
    }
  }
  return bindings;
}

function matching(tokens, openIndex, openType, closeType) {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].type === openType) depth += 1;
    if (tokens[index].type === closeType && --depth === 0) return index;
  }
  return -1;
}

function shadowsBinding(tokens, callIndex, bindingName, importIndex) {
  const declarationWords = new Set(["const", "let", "var", "function", "class"]);
  for (let index = 0; index < callIndex; index += 1) {
    const token = tokens[index], closeIndex = token.type === "(" ? matching(tokens, index, "(", ")") : -1;
    const parameterList = closeIndex > index && closeIndex < callIndex && (tokens[index - 1]?.value === "function" || tokens[index - 1]?.value === "catch" || tokens[index - 2]?.value === "function" || (tokens[closeIndex + 1]?.type === "{" && !["if", "for", "while", "switch", "with"].includes(tokens[index - 1]?.value)) || tokens[closeIndex + 1]?.type === "=");
    if (parameterList && tokens.slice(index + 1, closeIndex).some((candidate) => candidate.value === bindingName)) return true;
    if (index === importIndex || token.type !== "identifier" || !declarationWords.has(token.value)) continue;
    let depth = 0, inPattern = true;
    for (let cursor = index + 1; cursor < callIndex; cursor += 1) {
      const candidate = tokens[cursor];
      if (candidate.type === ";" || (candidate.type === "{" && tokens[cursor - 1]?.type === ")")) break;
      if (candidate.type === "(" || candidate.type === "{" || candidate.type === "[") depth += 1;
      else if ((candidate.type === ")" || candidate.type === "}" || candidate.type === "]") && depth > 0) depth -= 1;
      else if (depth === 0 && candidate.type === ",") inPattern = true;
      else if (depth === 0 && candidate.type === "=") inPattern = false;
      if (inPattern && candidate.value === bindingName) return true;
    }
  }
  return false;
}

function candidatesFor(target, tokens, starts) {
  const bindings = nodeTestBindings(tokens);
  const candidates = [];
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const token = tokens[index];
    const openParen = tokens[index + 1];
    if (token.type !== "identifier" || !bindings.has(token.value) || openParen.type !== "(" || tokens[index - 1]?.type === "." || tokens[index - 1]?.type === "?.") continue;
    if (shadowsBinding(tokens, index, token.value, bindings.get(token.value))) continue;
    if (tokens[index + 2]?.type !== "string" || tokens[index + 2].value !== target.name) continue;
    const closeIndex = matching(tokens, index + 1, "(", ")");
    const span = closeIndex < 0 ? null : spanFrom(lineFor(starts, token.start), lineFor(starts, tokens[closeIndex].end - 1));
    if (span) candidates.push({ path: target.path, kind: target.kind, name: target.name, span });
  }
  return { candidates, hasBinding: bindings.size > 0 };
}

export function resolveBoundedJavaScriptTestCaseTargetFromSourceText(value = {}) {
  const target = targetFrom(value.target ?? value);
  const sourceText = typeof (value.source_text ?? value.sourceText) === "string" ? (value.source_text ?? value.sourceText).replace(/\r\n?/gu, "\n") : null;
  const options = {
    source_record_digest: value.source_record_digest ?? value.sourceRecordDigest,
    selected_unit: value.selected_unit ?? value.selectedUnit ?? value.unit,
    payload_bound_input_digest: value.payload_bound_input_digest ?? value.payloadBoundInputDigest ?? value.expected_payload_bound_input_digest
  };
  if (!target.path) return evidence(target, "missing_path", "declared target path was unavailable to the provider", options);
  if (!sourceText || sourceText.trim().length === 0) return evidence(target, "provider_unavailable", "no bounded source text supplied for expected_edit_targets entry", options);
  if (target.operation === "create") return evidence(target, "not_applicable", "create target; no pre-existing symbol expected", options);
  if (!WORK_RECORD_TARGET_TEST_CASE_RESOLVER_SUPPORTED_KIND_VALUES.has(target.kind)) return evidence(target, "unsupported_kind", "provider does not support the declared target kind", options);
  if (!isTestFile(target.path)) return evidence(target, "provider_unavailable", "target path is not a supported repository JavaScript test file", options);
  const { candidates, hasBinding } = candidatesFor(target, tokensFrom(sourceText), lineStarts(sourceText));
  if (!hasBinding) return evidence(target, "provider_unavailable", "no supported explicit node:test binding was found", options);
  if (candidates.length === 0) return evidence(target, "unresolved", "no supported target matched the declared target", options);
  if (candidates.length > 1) return evidence(target, "ambiguous", "multiple candidates matched and no deterministic winner was selected", { ...options, candidateCount: candidates.length, candidates, span: spanFrom(Math.min(...candidates.map((candidate) => candidate.span.start_line)), Math.max(...candidates.map((candidate) => candidate.span.end_line))) });
  return evidence(target, "resolved", "exactly one target span or structural target was identified", { ...options, candidateCount: 1, span: candidates[0].span });
}
