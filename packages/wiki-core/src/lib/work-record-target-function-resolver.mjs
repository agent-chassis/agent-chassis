const WORK_RECORD_TARGET_FUNCTION_RESOLVER_PROVIDER = Object.freeze({
  id: "portfolio-local.target-function-resolver",
  version: "0.1.0",
  mode: "local"
});

const WORK_RECORD_TARGET_FUNCTION_RESOLVER_SUPPORTED_KIND_VALUES = new Set(["function"]);
const WORK_RECORD_TARGET_TEST_CASE_RESOLVER_SUPPORTED_KIND_VALUES = new Set(["test_case"]);
const WORK_RECORD_TARGET_FUNCTION_RESOLVER_OPERATION_VALUES = new Set([
  "create",
  "modify",
  "delete",
  "inspect"
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeRepoPath(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replaceAll("\\", "/").replace(/^\.\//u, "") : null;
}

function normalizeControlledValue(value, allowedValues) {
  const normalized = normalizeString(value)?.toLowerCase().replaceAll("-", "_").replace(/\s+/gu, "_") ?? null;
  return normalized && allowedValues.has(normalized) ? normalized : null;
}

function normalizeTarget(value) {
  const target = isObject(value) ? value : {};
  const operation = normalizeControlledValue(target.operation, WORK_RECORD_TARGET_FUNCTION_RESOLVER_OPERATION_VALUES);
  return {
    path: normalizeRepoPath(target.path),
    kind: normalizeString(target.kind)?.toLowerCase() ?? null,
    name: normalizeString(target.name),
    operation,
    optional: target.optional === true
  };
}

function normalizeSelectedUnit(value) {
  if (!isObject(value)) {
    return null;
  }

  const recordId = normalizeString(value.record_id ?? value.recordId);
  const sliceId = normalizeString(value.slice_id ?? value.sliceId);
  const address = normalizeString(value.address ?? value.work_unit_address ?? value.workUnitAddress);
  const repo = normalizeString(value.repo ?? value.repository);
  if (!recordId && !sliceId && !address && !repo) {
    return null;
  }

  return {
    kind: normalizeString(value.kind)?.toLowerCase() ?? null,
    address,
    record_id: recordId,
    slice_id: sliceId,
    repo
  };
}

function normalizeSpan(startLine, endLine) {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    return null;
  }

  return {
    start_line: startLine,
    end_line: endLine,
    line_count: endLine - startLine + 1
  };
}

function normalizeFanout(candidateCount) {
  if (!Number.isInteger(candidateCount) || candidateCount < 0) {
    return null;
  }

  return {
    direct_reference_count: candidateCount,
    affected_symbol_count: candidateCount
  };
}

function createEvidence(target, status, reason, options = {}) {
  const span = options.span ?? null;
  const candidateCount = Number.isInteger(options.candidateCount) ? options.candidateCount : 0;
  return {
    target_resolution_evidence_status:
      status === "resolved" || status === "not_applicable"
        ? "present"
        : status === "ambiguous"
          ? "partial"
          : "degraded",
    target_resolution_provider: options.provider ?? WORK_RECORD_TARGET_FUNCTION_RESOLVER_PROVIDER,
    target_resolution_target: target,
    target_resolution_status: status,
    target_resolution_status_reason: reason,
    target_resolution_span: span,
    target_resolution_fanout: options.fanout ?? (candidateCount > 0 ? normalizeFanout(candidateCount) : null),
    target_resolution_candidates: Array.isArray(options.candidates) ? options.candidates : [],
    source_record_digest: normalizeString(options.source_record_digest),
    selected_unit: normalizeSelectedUnit(options.selected_unit),
    payload_bound_input_digest: normalizeString(options.payload_bound_input_digest)
  };
}

function isIdentifierStart(character) {
  return /[A-Za-z_$]/u.test(character);
}

function isIdentifierPart(character) {
  return /[A-Za-z0-9_$]/u.test(character);
}

function tokenizeJavaScriptSource(sourceText) {
  const tokens = [];
  if (!isNonEmptyString(sourceText)) {
    return tokens;
  }

  const text = String(sourceText).replace(/\r\n?/gu, "\n");
  let index = 0;
  let line = 1;

  while (index < text.length) {
    const character = text[index];

    if (character === "\n") {
      line += 1;
      index += 1;
      continue;
    }

    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }

    if (character === "/" && text[index + 1] === "/") {
      index += 2;
      while (index < text.length && text[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (character === "/" && text[index + 1] === "*") {
      index += 2;
      while (index < text.length) {
        if (text[index] === "\n") {
          line += 1;
          index += 1;
          continue;
        }
        if (text[index] === "*" && text[index + 1] === "/") {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      const quote = character;
      index += 1;
      while (index < text.length) {
        if (text[index] === "\n") {
          line += 1;
          index += 1;
          continue;
        }
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (character === "`") {
      index += 1;
      while (index < text.length) {
        if (text[index] === "\n") {
          line += 1;
          index += 1;
          continue;
        }
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === "`") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (character === "=" && text[index + 1] === ">") {
      tokens.push({
        type: "arrow",
        value: "=>",
        line,
        start: index,
        end: index + 2
      });
      index += 2;
      continue;
    }

    if (character === "?" && text[index + 1] === ".") {
      tokens.push({
        type: "?.",
        value: "?.",
        line,
        start: index,
        end: index + 2
      });
      index += 2;
      continue;
    }

    if ("(){}[];,=*.".includes(character)) {
      tokens.push({
        type: character,
        value: character,
        line,
        start: index,
        end: index + 1
      });
      index += 1;
      continue;
    }

    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (index < text.length && isIdentifierPart(text[index])) {
        index += 1;
      }
      tokens.push({
        type: "identifier",
        value: text.slice(start, index),
        line,
        start,
        end: index
      });
      continue;
    }

    index += 1;
  }

  return tokens;
}

function lineStartsFromSourceText(sourceText) {
  const text = String(sourceText).replace(/\r\n?/gu, "\n");
  const lineStarts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return { text, lineStarts };
}

function lineNumberForOffset(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid];
    const end = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = mid - 1;
      continue;
    }
    if (offset >= end) {
      low = mid + 1;
      continue;
    }
    return mid + 1;
  }
  return 1;
}

function lineTextAt(sourceText, lineStarts, lineNumber) {
  const start = lineStarts[lineNumber - 1] ?? 0;
  const end = lineNumber < lineStarts.length ? lineStarts[lineNumber] - 1 : sourceText.length;
  return sourceText.slice(start, end);
}

function hasFunctionDeclarationLine(lineText, targetName) {
  const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const functionDeclarationPattern = new RegExp(
    `^\\s*(?:export\\s+(?:default\\s+)?)?(?:async\\s+)?function(?:\\s*\\*)?\\s+${escapedName}\\b`,
    "u"
  );
  return functionDeclarationPattern.test(lineText);
}

function hasFunctionBindingLine(lineText, targetName) {
  const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const bindingPattern = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escapedName}\\b`, "u");
  return bindingPattern.test(lineText);
}

function findCandidateStartTokenIndex(tokens, lineNumber, lineStarts, sourceText) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].line === lineNumber) {
      return index;
    }
  }

  const lineStart = lineStarts[lineNumber - 1] ?? 0;
  const lineEnd = lineNumber < lineStarts.length ? lineStarts[lineNumber] - 1 : sourceText.length;
  const startOffset = Math.min(lineStart, lineEnd);
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].start >= startOffset) {
      return index;
    }
  }

  return -1;
}

function findTopLevelFunctionExpressionToken(tokens, startIndex) {
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === "(") {
      parenDepth += 1;
      continue;
    }
    if (token.type === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (token.type === "[") {
      bracketDepth += 1;
      continue;
    }
    if (token.type === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (parenDepth > 0 || bracketDepth > 0) {
      continue;
    }

    if (token.type === "{") {
      return null;
    }
    if (token.type === "identifier" && token.value === "function") {
      return { kind: "function", tokenIndex: index };
    }
    if (token.type === "arrow") {
      return { kind: "arrow", tokenIndex: index };
    }
    if (token.type === ";" || token.type === "," || token.type === "}") {
      return null;
    }
  }

  return null;
}

function findBlockSpanFromTokenIndex(tokens, tokenIndex, lineStarts) {
  let parenDepth = 0;
  let bracketDepth = 0;
  let bodyStartToken = null;
  let braceDepth = 0;

  for (let index = tokenIndex; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!bodyStartToken) {
      if (token.type === "(") {
        parenDepth += 1;
        continue;
      }
      if (token.type === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        continue;
      }
      if (token.type === "[") {
        bracketDepth += 1;
        continue;
      }
      if (token.type === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
        continue;
      }
      if (token.type === "{") {
        if (parenDepth === 0 && bracketDepth === 0) {
          bodyStartToken = token;
          braceDepth = 1;
        }
        continue;
      }
      continue;
    }

    if (token.type === "{") {
      braceDepth += 1;
      continue;
    }
    if (token.type === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) {
        return normalizeSpan(
          lineNumberForOffset(lineStarts, tokens[tokenIndex].start),
          lineNumberForOffset(lineStarts, token.end - 1)
        );
      }
      continue;
    }
  }

  return null;
}

function findConciseArrowSpanFromTokenIndex(tokens, startTokenIndex, arrowTokenIndex, lineStarts) {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let lastTokenIndex = arrowTokenIndex;

  for (let index = arrowTokenIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === "(") {
      parenDepth += 1;
      lastTokenIndex = index;
      continue;
    }
    if (token.type === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      lastTokenIndex = index;
      continue;
    }
    if (token.type === "[") {
      bracketDepth += 1;
      lastTokenIndex = index;
      continue;
    }
    if (token.type === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      lastTokenIndex = index;
      continue;
    }
    if (token.type === "{") {
      braceDepth += 1;
      lastTokenIndex = index;
      continue;
    }
    if (token.type === "}") {
      if (braceDepth > 0) {
        braceDepth -= 1;
        lastTokenIndex = index;
        continue;
      }
      if (parenDepth === 0 && bracketDepth === 0) {
        return normalizeSpan(
          lineNumberForOffset(lineStarts, tokens[startTokenIndex].start),
          lineNumberForOffset(lineStarts, tokens[lastTokenIndex].end - 1)
        );
      }
      lastTokenIndex = index;
      continue;
    }
    if (token.type === "arrow") {
      lastTokenIndex = index;
      continue;
    }
    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && (token.type === ";" || token.type === ",")) {
      return normalizeSpan(
        lineNumberForOffset(lineStarts, tokens[startTokenIndex].start),
        lineNumberForOffset(lineStarts, tokens[lastTokenIndex].end - 1)
      );
    }

    lastTokenIndex = index;
  }

  if (lastTokenIndex >= arrowTokenIndex) {
    return normalizeSpan(
      lineNumberForOffset(lineStarts, tokens[startTokenIndex].start),
      lineNumberForOffset(lineStarts, tokens[lastTokenIndex].end - 1)
    );
  }

  return null;
}

function createCandidate(target, tokenIndex, tokens, lineStarts, sourceText, kind, arrowTokenIndex = null) {
  const span =
    kind === "arrow"
      ? (() => {
          if (arrowTokenIndex === null) {
            return null;
          }
          const nextToken = tokens[arrowTokenIndex + 1] ?? null;
          if (nextToken?.type === "{") {
            return findBlockSpanFromTokenIndex(tokens, tokenIndex, lineStarts);
          }
          return findConciseArrowSpanFromTokenIndex(tokens, tokenIndex, arrowTokenIndex, lineStarts);
        })()
      : findBlockSpanFromTokenIndex(tokens, tokenIndex, lineStarts);

  if (!span) {
    return null;
  }

  return {
    path: target.path,
    kind: target.kind,
    name: target.name,
    span
  };
}

function resolveFunctionDeclarationCandidates(target, tokens, lineStarts, sourceText) {
  const candidates = [];
  for (let lineNumber = 1; lineNumber <= lineStarts.length; lineNumber += 1) {
    const line = lineTextAt(sourceText, lineStarts, lineNumber);
    if (!hasFunctionDeclarationLine(line, target.name)) {
      continue;
    }
    const tokenIndex = findCandidateStartTokenIndex(tokens, lineNumber, lineStarts, sourceText);
    if (tokenIndex < 0) {
      continue;
    }
    const candidate = createCandidate(target, tokenIndex, tokens, lineStarts, sourceText, "function");
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function resolveFunctionBindingCandidates(target, tokens, lineStarts, sourceText) {
  const candidates = [];

  for (let lineNumber = 1; lineNumber <= lineStarts.length; lineNumber += 1) {
    const line = lineTextAt(sourceText, lineStarts, lineNumber);
    if (!hasFunctionBindingLine(line, target.name)) {
      continue;
    }

    const tokenIndex = findCandidateStartTokenIndex(tokens, lineNumber, lineStarts, sourceText);
    if (tokenIndex < 0) {
      continue;
    }

    const bindingNameIndex = tokens.findIndex(
      (token, index) =>
        index >= tokenIndex &&
        token.type === "identifier" &&
        (token.value === "const" || token.value === "let" || token.value === "var")
    );
    if (bindingNameIndex < 0) {
      continue;
    }

    let sawAssignment = false;
    let rightHandSideStartIndex = null;
    let arrowTokenIndex = null;
    let parenDepth = 0;
    let bracketDepth = 0;

    for (let index = bindingNameIndex + 1; index < tokens.length; index += 1) {
      const token = tokens[index];

      if (!sawAssignment) {
        if (token.type === "=") {
          sawAssignment = true;
        }
        if (token.type === ";" || token.type === ",") {
          break;
        }
        continue;
      }

      if (token.type === "(") {
        parenDepth += 1;
        continue;
      }
      if (token.type === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        continue;
      }
      if (token.type === "[") {
        bracketDepth += 1;
        continue;
      }
      if (token.type === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
        continue;
      }

      if (parenDepth === 0 && bracketDepth === 0) {
        if (token.type === "{") {
          break;
        }
        if (token.type === "identifier" && token.value === "function") {
          rightHandSideStartIndex = tokenIndex;
          break;
        }
        if (token.type === "arrow") {
          arrowTokenIndex = index;
          rightHandSideStartIndex = tokenIndex;
          break;
        }
        if (token.type === ";" || token.type === ",") {
          break;
        }
      }
    }

    if (rightHandSideStartIndex === null) {
      continue;
    }

    const candidate =
      arrowTokenIndex === null
        ? createCandidate(target, tokenIndex, tokens, lineStarts, sourceText, "function")
        : createCandidate(target, tokenIndex, tokens, lineStarts, sourceText, "arrow", arrowTokenIndex);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return candidates;
}

function aggregateCandidateSpan(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const startLines = candidates.map((candidate) => candidate.span?.start_line).filter((value) => Number.isInteger(value));
  const endLines = candidates.map((candidate) => candidate.span?.end_line).filter((value) => Number.isInteger(value));
  if (startLines.length === 0 || endLines.length === 0) {
    return null;
  }

  const startLine = Math.min(...startLines);
  const endLine = Math.max(...endLines);
  return normalizeSpan(startLine, endLine);
}

function isRepositoryJavaScriptTestPath(path) {
  if (!isNonEmptyString(path) || path.startsWith("/") || path.includes("\0")) {
    return false;
  }

  const normalizedPath = normalizeRepoPath(path);
  if (!normalizedPath || normalizedPath.startsWith("../") || normalizedPath.includes("/../")) {
    return false;
  }

  return /(?:^|\/)[^/]+\.test\.(?:mjs|js)$/u.test(normalizedPath);
}

function extractNodeTestLocalBindings(sourceText) {
  const bindings = new Set();
  const text = String(sourceText).replace(/\r\n?/gu, "\n");
  const importPattern =
    /^\s*import\s+(?:(?<defaultName>[A-Za-z_$][\w$]*)(?:\s*,\s*)?)?(?:\{\s*(?<named>[^}]+)\s*\})?\s*from\s*["']node:test["']\s*;?/gmu;

  for (const match of text.matchAll(importPattern)) {
    const defaultName = normalizeString(match.groups?.defaultName);
    const namedBindings = normalizeString(match.groups?.named);
    if (!defaultName && !namedBindings) {
      continue;
    }

    if (defaultName) {
      bindings.add(defaultName);
    }

    if (!namedBindings) {
      continue;
    }

    for (const rawBinding of namedBindings.split(",")) {
      const binding = normalizeString(rawBinding);
      if (!binding) {
        continue;
      }
      const aliasMatch = /^(?<imported>[A-Za-z_$][\w$]*)(?:\s+as\s+(?<local>[A-Za-z_$][\w$]*))?$/u.exec(binding);
      if (aliasMatch?.groups?.imported === "test") {
        bindings.add(aliasMatch.groups.local ?? "test");
      }
    }
  }

  return bindings;
}

function parseQuotedLiteralAt(sourceText, startOffset) {
  const quote = sourceText[startOffset];
  if (quote !== "'" && quote !== '"') {
    return null;
  }

  let value = "";
  for (let index = startOffset + 1; index < sourceText.length; index += 1) {
    const character = sourceText[index];
    if (character === "\n") {
      return null;
    }
    if (character === "\\") {
      const nextCharacter = sourceText[index + 1];
      if (nextCharacter === undefined || nextCharacter === "\n") {
        return null;
      }
      value += nextCharacter;
      index += 1;
      continue;
    }
    if (character === quote) {
      return {
        value,
        endOffset: index + 1
      };
    }
    value += character;
  }

  return null;
}

function findMatchingCallCloseTokenIndex(tokens, openParenTokenIndex) {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = openParenTokenIndex; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === "(") {
      parenDepth += 1;
      continue;
    }
    if (token.type === ")") {
      parenDepth -= 1;
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        return index;
      }
      continue;
    }
    if (token.type === "[") {
      bracketDepth += 1;
      continue;
    }
    if (token.type === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (token.type === "{") {
      braceDepth += 1;
      continue;
    }
    if (token.type === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    }
  }

  return -1;
}

function isDirectCallExpression(tokens, calleeTokenIndex, openParenTokenIndex) {
  const previousToken = tokens[calleeTokenIndex - 1] ?? null;
  return previousToken?.type !== "." && previousToken?.type !== "?." && openParenTokenIndex === calleeTokenIndex + 1;
}

function findMatchingTokenIndex(tokens, openTokenIndex, openType, closeType) {
  let depth = 0;

  for (let index = openTokenIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === openType) {
      depth += 1;
      continue;
    }
    if (token.type === closeType) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function tokenRangeContainsIndex(tokens, startTokenIndex, endTokenIndex, containedTokenIndex) {
  if (startTokenIndex < 0 || endTokenIndex < 0 || containedTokenIndex < 0) {
    return false;
  }

  const startToken = tokens[startTokenIndex] ?? null;
  const endToken = tokens[endTokenIndex] ?? null;
  const containedToken = tokens[containedTokenIndex] ?? null;
  return Boolean(
    startToken &&
      endToken &&
      containedToken &&
      startToken.start <= containedToken.start &&
      containedToken.end <= endToken.end
  );
}

function tokenRangeIncludesIdentifier(tokens, startTokenIndex, endTokenIndex, identifierName) {
  for (let index = startTokenIndex; index <= endTokenIndex; index += 1) {
    const token = tokens[index];
    if (token?.type === "identifier" && token.value === identifierName) {
      return true;
    }
  }

  return false;
}

function findNextTokenOfType(tokens, startTokenIndex, tokenType, stopTokenTypes = new Set()) {
  for (let index = startTokenIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (stopTokenTypes.has(token?.type)) {
      return -1;
    }
    if (token?.type === tokenType) {
      return index;
    }
  }

  return -1;
}

function findEnclosingBraceRange(tokens, tokenIndex) {
  const openBraceIndexes = [];
  for (let index = 0; index <= tokenIndex; index += 1) {
    const token = tokens[index];
    if (token.type === "{") {
      openBraceIndexes.push(index);
      continue;
    }
    if (token.type === "}") {
      openBraceIndexes.pop();
    }
  }

  const openBraceIndex = openBraceIndexes.at(-1);
  if (openBraceIndex === undefined) {
    return {
      startTokenIndex: 0,
      endTokenIndex: tokens.length - 1
    };
  }

  const closeBraceIndex = findMatchingTokenIndex(tokens, openBraceIndex, "{", "}");
  return {
    startTokenIndex: openBraceIndex,
    endTokenIndex: closeBraceIndex >= 0 ? closeBraceIndex : tokens.length - 1
  };
}

function hasVariableDeclaratorNamed(tokens, declarationTokenIndex, identifierName) {
  for (let index = declarationTokenIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "identifier") {
      return token.value === identifierName;
    }
    if (token.type === "=" || token.type === ";" || token.type === "{" || token.type === "}") {
      return false;
    }
  }

  return false;
}

function localDeclarationShadowsIdentifierAtCall(tokens, declarationTokenIndex, calleeTokenIndex, identifierName) {
  const declarationToken = tokens[declarationTokenIndex];
  const declarationRange = findEnclosingBraceRange(tokens, declarationTokenIndex);
  if (!tokenRangeContainsIndex(tokens, declarationRange.startTokenIndex, declarationRange.endTokenIndex, calleeTokenIndex)) {
    return false;
  }

  if (declarationToken.type === "identifier" && ["const", "let", "var"].includes(declarationToken.value)) {
    return hasVariableDeclaratorNamed(tokens, declarationTokenIndex, identifierName);
  }

  const nameToken = tokens[declarationTokenIndex + 1] ?? null;
  return declarationToken.type === "identifier" && declarationToken.value === "function" && nameToken?.value === identifierName;
}

function functionParameterShadowsIdentifierAtCall(tokens, functionTokenIndex, calleeTokenIndex, identifierName) {
  const paramsOpenIndex = findNextTokenOfType(tokens, functionTokenIndex + 1, "(", new Set(["{", ";"]));
  if (paramsOpenIndex < 0) {
    return false;
  }

  const paramsCloseIndex = findMatchingTokenIndex(tokens, paramsOpenIndex, "(", ")");
  if (paramsCloseIndex < 0 || !tokenRangeIncludesIdentifier(tokens, paramsOpenIndex + 1, paramsCloseIndex - 1, identifierName)) {
    return false;
  }

  const bodyOpenIndex = findNextTokenOfType(tokens, paramsCloseIndex + 1, "{", new Set([";", ","]));
  if (bodyOpenIndex < 0) {
    return false;
  }

  const bodyCloseIndex = findMatchingTokenIndex(tokens, bodyOpenIndex, "{", "}");
  return tokenRangeContainsIndex(tokens, bodyOpenIndex, bodyCloseIndex, calleeTokenIndex);
}

function findArrowParameterRange(tokens, arrowTokenIndex) {
  const previousToken = tokens[arrowTokenIndex - 1] ?? null;
  if (!previousToken) {
    return null;
  }

  if (previousToken.type === "identifier") {
    return {
      startTokenIndex: arrowTokenIndex - 1,
      endTokenIndex: arrowTokenIndex - 1
    };
  }

  if (previousToken.type !== ")") {
    return null;
  }

  let depth = 0;
  for (let index = arrowTokenIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.type === ")") {
      depth += 1;
      continue;
    }
    if (token.type === "(") {
      depth -= 1;
      if (depth === 0) {
        return {
          startTokenIndex: index + 1,
          endTokenIndex: arrowTokenIndex - 2
        };
      }
    }
  }

  return null;
}

function arrowParameterShadowsIdentifierAtCall(tokens, arrowTokenIndex, calleeTokenIndex, identifierName) {
  const parameterRange = findArrowParameterRange(tokens, arrowTokenIndex);
  if (
    !parameterRange ||
    !tokenRangeIncludesIdentifier(tokens, parameterRange.startTokenIndex, parameterRange.endTokenIndex, identifierName)
  ) {
    return false;
  }

  const bodyStartIndex = arrowTokenIndex + 1;
  if (tokens[bodyStartIndex]?.type === "{") {
    const bodyCloseIndex = findMatchingTokenIndex(tokens, bodyStartIndex, "{", "}");
    return tokenRangeContainsIndex(tokens, bodyStartIndex, bodyCloseIndex, calleeTokenIndex);
  }

  for (let index = bodyStartIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (index === calleeTokenIndex) {
      return true;
    }
    if (token.type === ";" || token.type === "," || token.type === "}") {
      return false;
    }
  }

  return false;
}

function isNodeTestBindingShadowedAtCall(tokens, calleeTokenIndex, bindingName) {
  for (let index = 0; index < calleeTokenIndex; index += 1) {
    const token = tokens[index];
    if (
      token.type === "identifier" &&
      ["const", "let", "var", "function"].includes(token.value) &&
      localDeclarationShadowsIdentifierAtCall(tokens, index, calleeTokenIndex, bindingName)
    ) {
      return true;
    }
    if (token.type === "identifier" && token.value === "function") {
      if (functionParameterShadowsIdentifierAtCall(tokens, index, calleeTokenIndex, bindingName)) {
        return true;
      }
      continue;
    }
    if (token.type === "arrow" && arrowParameterShadowsIdentifierAtCall(tokens, index, calleeTokenIndex, bindingName)) {
      return true;
    }
  }

  return false;
}

function resolveTestCaseCandidates(target, tokens, lineStarts, sourceText, nodeTestBindings) {
  const candidates = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const openParenToken = tokens[index + 1];
    if (
      token.type !== "identifier" ||
      !nodeTestBindings.has(token.value) ||
      openParenToken?.type !== "(" ||
      !isDirectCallExpression(tokens, index, index + 1)
    ) {
      continue;
    }

    if (isNodeTestBindingShadowedAtCall(tokens, index, token.value)) {
      continue;
    }

    const literalStart = openParenToken.end;
    let offset = literalStart;
    while (offset < sourceText.length && /\s/u.test(sourceText[offset])) {
      offset += 1;
    }

    const literal = parseQuotedLiteralAt(sourceText, offset);
    if (!literal || literal.value !== target.name) {
      continue;
    }

    const closeParenTokenIndex = findMatchingCallCloseTokenIndex(tokens, index + 1);
    if (closeParenTokenIndex < 0) {
      continue;
    }

    const span = normalizeSpan(
      lineNumberForOffset(lineStarts, token.start),
      lineNumberForOffset(lineStarts, tokens[closeParenTokenIndex].end - 1)
    );
    if (!span) {
      continue;
    }

    candidates.push({
      path: target.path,
      kind: target.kind,
      name: target.name,
      span
    });
  }

  return candidates;
}

export function resolveBoundedJavaScriptFunctionTargetFromSourceText(value = {}) {
  const target = normalizeTarget(value.target ?? value);
  const sourceText = normalizeString(value.source_text ?? value.sourceText);
  const provider = value.provider ?? WORK_RECORD_TARGET_FUNCTION_RESOLVER_PROVIDER;
  const sourceRecordDigest = normalizeString(value.source_record_digest ?? value.sourceRecordDigest);
  const selectedUnit = normalizeSelectedUnit(value.selected_unit ?? value.selectedUnit ?? value.unit);
  const payloadBoundInputDigest = normalizeString(
    value.payload_bound_input_digest ?? value.payloadBoundInputDigest ?? value.expected_payload_bound_input_digest
  );

  if (!target.path || !sourceText) {
    return createEvidence(
      target,
      "missing_path",
      "declared target path was unavailable to the provider",
      {
        provider,
        source_record_digest: sourceRecordDigest,
        selected_unit: selectedUnit,
        payload_bound_input_digest: payloadBoundInputDigest
      }
    );
  }

  if (target.operation === "create") {
    return createEvidence(
      target,
      "not_applicable",
      "create target; no pre-existing symbol expected",
      {
        provider,
        source_record_digest: sourceRecordDigest,
        selected_unit: selectedUnit,
        payload_bound_input_digest: payloadBoundInputDigest
      }
    );
  }

  if (!WORK_RECORD_TARGET_FUNCTION_RESOLVER_SUPPORTED_KIND_VALUES.has(target.kind)) {
    return createEvidence(
      target,
      "unsupported_kind",
      "provider does not support the declared target kind",
      {
        provider,
        source_record_digest: sourceRecordDigest,
        selected_unit: selectedUnit,
        payload_bound_input_digest: payloadBoundInputDigest
      }
    );
  }

  const { text, lineStarts } = lineStartsFromSourceText(sourceText);
  const tokens = tokenizeJavaScriptSource(text);
  const declarationCandidates = resolveFunctionDeclarationCandidates(target, tokens, lineStarts, text);
  const bindingCandidates = resolveFunctionBindingCandidates(target, tokens, lineStarts, text);
  const candidates = [...declarationCandidates, ...bindingCandidates];

  if (candidates.length === 0) {
    return createEvidence(
      target,
      "unresolved",
      "no supported target matched the declared target",
      {
        provider,
        source_record_digest: sourceRecordDigest,
        selected_unit: selectedUnit,
        payload_bound_input_digest: payloadBoundInputDigest
      }
    );
  }

  if (candidates.length > 1) {
    return createEvidence(
      target,
      "ambiguous",
      "multiple candidates matched and no deterministic winner was selected",
      {
        provider,
        candidateCount: candidates.length,
        span: aggregateCandidateSpan(candidates),
        candidates,
        source_record_digest: sourceRecordDigest,
        selected_unit: selectedUnit,
        payload_bound_input_digest: payloadBoundInputDigest
      }
    );
  }

  return createEvidence(target, "resolved", "exactly one target span or structural target was identified", {
    provider,
    candidateCount: 1,
    span: candidates[0].span,
    candidates: [],
    source_record_digest: sourceRecordDigest,
    selected_unit: selectedUnit,
    payload_bound_input_digest: payloadBoundInputDigest
  });
}

export function resolveBoundedJavaScriptTestCaseTargetFromSourceText(value = {}) {
  const target = normalizeTarget(value.target ?? value);
  const sourceTextInput = value.source_text ?? value.sourceText;
  const sourceText = typeof sourceTextInput === "string" ? sourceTextInput : null;
  const provider = value.provider ?? WORK_RECORD_TARGET_FUNCTION_RESOLVER_PROVIDER;
  const sourceRecordDigest = normalizeString(value.source_record_digest ?? value.sourceRecordDigest);
  const selectedUnit = normalizeSelectedUnit(value.selected_unit ?? value.selectedUnit ?? value.unit);
  const payloadBoundInputDigest = normalizeString(
    value.payload_bound_input_digest ?? value.payloadBoundInputDigest ?? value.expected_payload_bound_input_digest
  );

  if (!target.path) {
    return createEvidence(target, "missing_path", "declared target path was unavailable to the provider", {
      provider,
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      payload_bound_input_digest: payloadBoundInputDigest
    });
  }

  if (!isNonEmptyString(sourceText)) {
    return createEvidence(target, "provider_unavailable", "no bounded source text supplied for expected_edit_targets entry", {
      provider,
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      payload_bound_input_digest: payloadBoundInputDigest
    });
  }

  if (target.operation === "create") {
    return createEvidence(target, "not_applicable", "create target; no pre-existing symbol expected", {
      provider,
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      payload_bound_input_digest: payloadBoundInputDigest
    });
  }

  if (!WORK_RECORD_TARGET_TEST_CASE_RESOLVER_SUPPORTED_KIND_VALUES.has(target.kind)) {
    return createEvidence(target, "unsupported_kind", "provider does not support the declared target kind", {
      provider,
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      payload_bound_input_digest: payloadBoundInputDigest
    });
  }

  if (!isRepositoryJavaScriptTestPath(target.path)) {
    return createEvidence(target, "provider_unavailable", "target path is not a supported repository JavaScript test file", {
      provider,
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      payload_bound_input_digest: payloadBoundInputDigest
    });
  }

  const { text, lineStarts } = lineStartsFromSourceText(sourceText);
  const nodeTestBindings = extractNodeTestLocalBindings(text);
  if (nodeTestBindings.size === 0) {
    return createEvidence(target, "provider_unavailable", "no supported explicit node:test binding was found", {
      provider,
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      payload_bound_input_digest: payloadBoundInputDigest
    });
  }

  const tokens = tokenizeJavaScriptSource(text);
  const candidates = resolveTestCaseCandidates(target, tokens, lineStarts, text, nodeTestBindings);

  if (candidates.length === 0) {
    return createEvidence(target, "unresolved", "no supported target matched the declared target", {
      provider,
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      payload_bound_input_digest: payloadBoundInputDigest
    });
  }

  if (candidates.length > 1) {
    return createEvidence(target, "ambiguous", "multiple candidates matched and no deterministic winner was selected", {
      provider,
      candidateCount: candidates.length,
      span: aggregateCandidateSpan(candidates),
      candidates,
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      payload_bound_input_digest: payloadBoundInputDigest
    });
  }

  return createEvidence(target, "resolved", "exactly one target span or structural target was identified", {
    provider,
    candidateCount: 1,
    span: candidates[0].span,
    candidates: [],
    source_record_digest: sourceRecordDigest,
    selected_unit: selectedUnit,
    payload_bound_input_digest: payloadBoundInputDigest
  });
}

export {
  WORK_RECORD_TARGET_FUNCTION_RESOLVER_OPERATION_VALUES,
  WORK_RECORD_TARGET_FUNCTION_RESOLVER_PROVIDER,
  WORK_RECORD_TARGET_FUNCTION_RESOLVER_SUPPORTED_KIND_VALUES,
  WORK_RECORD_TARGET_TEST_CASE_RESOLVER_SUPPORTED_KIND_VALUES,
  createEvidence as createBoundedJavaScriptFunctionTargetResolutionEvidence,
  normalizeSpan as normalizeBoundedJavaScriptFunctionSpan,
  normalizeTarget as normalizeBoundedJavaScriptFunctionTarget
};
