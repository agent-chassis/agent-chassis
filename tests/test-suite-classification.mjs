

import path from "node:path";

export const TESTS_ROOT_REL = "tests";
export const UNIT_DIR_REL = "tests/unit";
export const INTEGRATION_DIR_REL = "tests/integration";
export const PACKAGES_ROOT_REL = "packages";
export const TEST_FILE_SUFFIX = ".test.mjs";

export const RUNNER_REL = "tests/run-tests.mjs";
export const CLASSIFICATION_MODULE_REL = "tests/test-suite-classification.mjs";

export const TEST_CATEGORY_DIRS = Object.freeze([
  Object.freeze({ category: "unit", dir: UNIT_DIR_REL }),
  Object.freeze({ category: "integration", dir: INTEGRATION_DIR_REL }),
]);

export const TEST_CATEGORIES = Object.freeze(["unit", "integration"]);

export const TEST_CLASSIFICATION_CODES = Object.freeze({
  UNCATEGORIZED_TEST_PATH: "test_suite_classification.uncategorized_test_path.v1",
  DUPLICATE_TEST_BASENAME: "test_suite_classification.duplicate_test_basename.v1",
  ESCAPING_TEST_PATH: "test_suite_classification.escaping_test_path.v1",
  INTEGRATION_SIGNAL_IN_UNIT: "test_suite_classification.integration_signal_in_unit.v1",
  UNKNOWN_EXCEPTION_PATH: "test_suite_classification.unknown_exception_path.v1",
});

export class TestSuiteClassificationError extends Error {
  constructor(message, { code, paths = [] } = {}) {
    super(message);
    this.name = "TestSuiteClassificationError";
    this.code = code;
    this.paths = paths;
  }
}

export function toPosixPath(p) {
  return String(p).split(path.sep).join("/");
}

function isUnder(relPath, dirRel) {
  return relPath === dirRel || relPath.startsWith(`${dirRel}/`);
}

export function classifyTestPath(relPath) {
  const rel = toPosixPath(relPath);
  if (!rel.endsWith(TEST_FILE_SUFFIX)) return null;
  for (const { category, dir } of TEST_CATEGORY_DIRS) {
    if (isUnder(rel, dir)) return category;
  }
  return null;
}

export function isSupportedTestPath(relPath) {
  return classifyTestPath(relPath) !== null;
}

export function isUncategorizedTestPath(relPath) {
  const rel = toPosixPath(relPath);
  if (!rel.endsWith(TEST_FILE_SUFFIX)) return false;
  if (!isUnder(rel, TESTS_ROOT_REL)) return false;
  return classifyTestPath(rel) === null;
}

export function isPackageLocalTestPath(relPath) {
  const rel = toPosixPath(relPath);
  if (!rel.endsWith(TEST_FILE_SUFFIX)) return false;
  const segments = rel.split("/");
  return segments.length >= 3 && segments[0] === PACKAGES_ROOT_REL;
}

export function enumerateFilesRecursively({ absDir, relDir, listDir, skip = () => false }) {
  const out = [];
  const walk = (abs, rel) => {
    const entries = [...listDir(abs)].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (skip(childRel, entry)) continue;
      const childAbs = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  };
  walk(absDir, relDir);
  return out;
}

export function enumerateTestTreeFiles({ repoRoot, listDir, dirExists = () => true }) {
  const absTests = path.join(repoRoot, TESTS_ROOT_REL);
  if (!dirExists(absTests)) return [];
  return enumerateFilesRecursively({ absDir: absTests, relDir: TESTS_ROOT_REL, listDir });
}

export function enumerateTestFiles({ repoRoot, listDir, dirExists }) {
  return enumerateTestTreeFiles({ repoRoot, listDir, dirExists }).filter((rel) =>
    rel.endsWith(TEST_FILE_SUFFIX),
  );
}

export function enumerateTestSupportModules({ repoRoot, listDir, dirExists }) {
  return enumerateTestTreeFiles({ repoRoot, listDir, dirExists }).filter(
    (rel) => (rel.endsWith(".mjs") || rel.endsWith(".js")) && !rel.endsWith(TEST_FILE_SUFFIX),
  );
}

function dependencyTokens(sourceText) {
  const text = String(sourceText ?? "");
  const tokens = [];
  const templateExpressions = [];
  let index = 0;
  let line = 1;
  let column = 0;

  const advance = () => {
    const ch = text[index++];
    if (ch === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
    return ch;
  };
  const skipQuoted = (quote) => {
    advance();
    while (index < text.length) {
      const ch = advance();
      if (ch === "\\") {
        if (index < text.length) advance();
      } else if (ch === quote) {
        return;
      }
    }
  };
  const skipLineComment = () => {
    advance();
    advance();
    while (index < text.length && text[index] !== "\n") advance();
  };
  const skipBlockComment = () => {
    advance();
    advance();
    while (index < text.length) {
      if (text[index] === "*" && text[index + 1] === "/") {
        advance();
        advance();
        return;
      }
      advance();
    }
  };
  const skipRegex = () => {
    advance();
    let inClass = false;
    while (index < text.length) {
      const ch = advance();
      if (ch === "\\") {
        if (index < text.length) advance();
      } else if (ch === "[") {
        inClass = true;
      } else if (ch === "]") {
        inClass = false;
      } else if (ch === "/" && !inClass) {
        while (/[A-Za-z]/.test(text[index] ?? "")) advance();
        return;
      } else if (ch === "\n") {
        return;
      }
    }
  };
  const scanTemplateRaw = ({ opening }) => {
    if (opening) advance();
    while (index < text.length) {
      const ch = text[index];
      if (ch === "\\") {
        advance();
        if (index < text.length) advance();
      } else if (ch === "`") {
        advance();
        return;
      } else if (ch === "$" && text[index + 1] === "{") {
        advance();
        advance();
        templateExpressions.push({ braceDepth: 0 });
        return;
      } else {
        advance();
      }
    }
  };
  const regexCanStart = () => {
    const previous = tokens.at(-1);
    if (!previous) return true;
    if (["string", "number"].includes(previous.type)) return false;
    if (previous.type === "identifier") {
      return new Set(["case", "delete", "do", "else", "in", "instanceof", "new", "of", "return", "throw", "typeof", "void", "yield", "await"]).has(previous.value);
    }
    if (previous.value === ")") {
      let depth = 0;
      for (let cursor = tokens.length - 1; cursor >= 0; cursor -= 1) {
        if (tokens[cursor].value === ")") depth += 1;
        else if (tokens[cursor].value === "(") {
          depth -= 1;
          if (depth === 0) {
            return new Set(["if", "for", "while", "with", "switch", "catch"])
              .has(tokens[cursor - 1]?.value);
          }
        }
      }
      return false;
    }
    return !["]", "++", "--"].includes(previous.value);
  };

  while (index < text.length) {
    const ch = text[index];
    if (/\s/.test(ch)) {
      advance();
      continue;
    }
    if (ch === "/" && text[index + 1] === "/") {
      skipLineComment();
      continue;
    }
    if (ch === "/" && text[index + 1] === "*") {
      skipBlockComment();
      continue;
    }
    if (ch === "`") {
      scanTemplateRaw({ opening: true });
      continue;
    }
    if (ch === "/" && regexCanStart()) {
      skipRegex();
      continue;
    }

    const start = index;
    const startLine = line;
    const startColumn = column;
    if (ch === "{" && templateExpressions.length > 0) {
      templateExpressions.at(-1).braceDepth += 1;
    } else if (ch === "}" && templateExpressions.length > 0) {
      const frame = templateExpressions.at(-1);
      if (frame.braceDepth === 0) {
        advance();
        templateExpressions.pop();
        scanTemplateRaw({ opening: false });
        continue;
      }
      frame.braceDepth -= 1;
    }
    if (ch === '"' || ch === "'") {
      skipQuoted(ch);
      tokens.push({
        type: "string",
        value: text.slice(start + 1, index - 1),
        start,
        end: index,
        line: startLine,
        column: startColumn,
      });
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      advance();
      while (/[A-Za-z0-9_$]/.test(text[index] ?? "")) advance();
      tokens.push({ type: "identifier", value: text.slice(start, index), start, end: index, line: startLine, column: startColumn });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      advance();
      while (/[A-Za-z0-9_.]/.test(text[index] ?? "")) advance();
      tokens.push({ type: "number", value: text.slice(start, index), start, end: index, line: startLine, column: startColumn });
      continue;
    }
    const two = text.slice(index, index + 2);
    const value = ["=>", "?.", "++", "--", "&&", "||", "??", "==", "!=", ">=", "<=", "**"].includes(two)
      ? (advance(), advance(), two)
      : advance();
    tokens.push({ type: "punctuator", value, start, end: index, line: startLine, column: startColumn });
  }
  return tokens;
}

function matchingParens(tokens) {
  const pairs = new Map();
  const stack = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === "(") stack.push(index);
    else if (tokens[index].value === ")" && stack.length > 0) {
      const open = stack.pop();
      pairs.set(open, index);
      pairs.set(index, open);
    }
  }
  return pairs;
}

function directAssertRejectsContext(tokens, parens, importIndex, importCloseIndex) {
  const callOpen = importIndex - 1;
  if (tokens[callOpen]?.value !== "(") return null;
  const calleeStart = callOpen - 3;
  if (
    tokens[calleeStart]?.value !== "assert" ||
    tokens[calleeStart + 1]?.value !== "." ||
    tokens[calleeStart + 2]?.value !== "rejects" ||
    [".", "?."].includes(tokens[calleeStart - 1]?.value)
  ) return null;
  const afterImport = tokens[importCloseIndex + 1]?.value;
  if (afterImport !== "," && afterImport !== ")") return null;
  if (afterImport === ")" && parens.get(callOpen) !== importCloseIndex + 1) return null;
  return Object.freeze({ callee: "assert.rejects", argumentIndex: 0, direct: true });
}

function unique(values) {
  return [...new Set(values)];
}

export function extractModuleDependencies(sourceText) {
  const text = String(sourceText ?? "");
  const tokens = dependencyTokens(text);
  const parens = matchingParens(tokens);
  const occurrences = [];
  const add = (kind, specifier, token, endToken, context = null) => occurrences.push(Object.freeze({
    kind,
    specifier,
    start: token.start,
    end: endToken.end,
    location: Object.freeze({ line: token.line, column: token.column }),
    enclosingCall: context,
  }));

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === "import") {
      if ([".", "?."].includes(tokens[index - 1]?.value) || tokens[index + 1]?.value === ".") continue;
      if (tokens[index + 1]?.value === "(") {
        const close = parens.get(index + 1);
        if (close == null) {
          add("dynamic-computed", null, token, tokens.at(-1) ?? token);
          continue;
        }
        const literal = close === index + 3 && tokens[index + 2]?.type === "string";
        add(
          literal ? "dynamic-literal" : "dynamic-computed",
          literal ? tokens[index + 2].value : null,
          token,
          tokens[close],
          literal ? directAssertRejectsContext(tokens, parens, index, close) : null,
        );
        continue;
      }
      if (tokens[index + 1]?.type === "string") {
        add("side-effect", tokens[index + 1].value, token, tokens[index + 1]);
        continue;
      }
    }
    if (token.value !== "import" && token.value !== "export") continue;
    for (let cursor = index + 1; cursor < tokens.length && tokens[cursor].value !== ";"; cursor += 1) {
      if (tokens[cursor].value === "from" && tokens[cursor + 1]?.type === "string") {
        add("static", tokens[cursor + 1].value, token, tokens[cursor + 1]);
        break;
      }
      if (cursor > index + 1 && ["import", "export"].includes(tokens[cursor].value)) break;
    }
  }

  const staticFrom = unique(occurrences.filter((item) => item.kind === "static").map((item) => item.specifier));
  const sideEffect = unique(occurrences.filter((item) => item.kind === "side-effect").map((item) => item.specifier));
  const dynamic = unique(occurrences.filter((item) => item.kind === "dynamic-literal").map((item) => item.specifier));
  const requireSpecifiers = unique(tokens.flatMap((token, index) =>
    token.value === "require" && tokens[index + 1]?.value === "(" && tokens[index + 2]?.type === "string" && tokens[index + 3]?.value === ")"
      ? [tokens[index + 2].value]
      : []));
  return {
    importSpecifiers: [...staticFrom, ...sideEffect],
    dynamicImportSpecifiers: dynamic,
    all: unique([...staticFrom, ...sideEffect, ...dynamic]),
    occurrences,
    requireSpecifiers,
  };
}

export function resolveLocalModule(specifier, fromRelPath, candidateKeys) {
  if (!specifier.startsWith(".")) return null;
  const dir = path.posix.dirname(toPosixPath(fromRelPath));
  const target = path.posix.normalize(path.posix.join(dir, specifier));
  for (const candidate of [target, `${target}.mjs`, `${target}.js`, `${target}/index.mjs`, `${target}/index.js`]) {
    if (candidateKeys.has(candidate)) return { resolved: candidate };
  }
  return { unresolved: target };
}

export const INTEGRATION_PROCESS_SIGNAL_SPECIFIERS = Object.freeze([
  "node:child_process",
  "child_process",
]);

export function hasIntegrationProcessSignal(sourceText) {
  const dependencies = extractModuleDependencies(sourceText);
  return [...dependencies.all, ...dependencies.requireSpecifiers]
    .some((specifier) => INTEGRATION_PROCESS_SIGNAL_SPECIFIERS.includes(specifier));
}

export const UNIT_SAFE_SIGNAL_EXCEPTIONS = Object.freeze([
  Object.freeze({
    test: "tests/unit/test-suite-classification.test.mjs",
    reason:
      "this module's own regression suite. It must exhibit the signal in every call " +
      "shape it claims to catch -- including `import(\"node:child_process\")` -- so those " +
      "specifiers appear as QUOTED TEST DATA inside its assertions. It imports " +
      "node:test and node:assert only, injects every filesystem read, and starts no " +
      "process. Segment-splitting the literals to dodge the match is exactly the " +
      "marker-hygiene workaround this cutover removed, so the exception is recorded " +
      "here instead, where a stale entry is itself a refusal.",
  }),
]);

export function collectLocalImportClosure(relPath, sources) {
  const key = toPosixPath(relPath);
  const seen = new Set();
  const stack = [key];
  while (stack.length > 0) {
    const current = stack.pop();
    const source = sources.get(current);
    if (typeof source !== "string") continue;
    for (const specifier of extractModuleDependencies(source).all) {
      const local = resolveLocalModule(specifier, current, sources);
      if (!local?.resolved) continue;
      if (seen.has(local.resolved)) continue;
      seen.add(local.resolved);
      stack.push(local.resolved);
    }
  }
  seen.delete(key);
  return [...seen].sort();
}

export function findIntegrationProcessSignals(relPath, sources) {
  const key = toPosixPath(relPath);
  const reasons = [];
  if (hasIntegrationProcessSignal(sources.get(key))) {
    reasons.push({ carrier: key, kind: "self" });
  }
  for (const dep of collectLocalImportClosure(key, sources)) {
    if (hasIntegrationProcessSignal(sources.get(dep))) {
      reasons.push({ carrier: dep, kind: "imported" });
    }
  }
  return reasons;
}

export function auditTestCorpus({ testFiles, sources, exceptions = UNIT_SAFE_SIGNAL_EXCEPTIONS }) {
  const unit = [];
  const integration = [];
  const uncategorized = [];
  const escaping = [];
  const byBasename = new Map();

  for (const raw of testFiles) {
    const rel = toPosixPath(raw);
    if (!isUnder(rel, TESTS_ROOT_REL) || rel.split("/").includes("..")) {
      escaping.push(rel);
      continue;
    }
    const basename = rel.slice(rel.lastIndexOf("/") + 1);
    if (!byBasename.has(basename)) byBasename.set(basename, []);
    byBasename.get(basename).push(rel);

    const category = classifyTestPath(rel);
    if (category === "unit") unit.push(rel);
    else if (category === "integration") integration.push(rel);
    else uncategorized.push(rel);
  }

  const duplicates = [...byBasename.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([basename, paths]) => ({ basename, paths: paths.slice().sort() }))
    .sort((a, b) => (a.basename < b.basename ? -1 : 1));

  const exceptionPaths = new Set(exceptions.map((entry) => toPosixPath(entry.test)));
  const unitSet = new Set(unit);
  const staleExceptions = [...exceptionPaths].filter((rel) => !unitSet.has(rel)).sort();

  const integrationSignalInUnit = [];
  for (const rel of unit) {
    if (exceptionPaths.has(rel)) continue;
    const signals = findIntegrationProcessSignals(rel, sources);
    if (signals.length > 0) integrationSignalInUnit.push({ test: rel, signals });
  }

  return {
    unit: unit.sort(),
    integration: integration.sort(),
    violations: {
      uncategorized: uncategorized.sort(),
      duplicates,
      escaping: escaping.sort(),
      integrationSignalInUnit,
      staleExceptions,
    },
  };
}

export function assertNoCorpusViolations(audit) {
  const { uncategorized, duplicates, escaping, integrationSignalInUnit, staleExceptions } =
    audit.violations;

  if (escaping.length > 0) {
    throw new TestSuiteClassificationError(
      `test path escapes the ${TESTS_ROOT_REL}/ root: ${escaping.join(", ")}`,
      { code: TEST_CLASSIFICATION_CODES.ESCAPING_TEST_PATH, paths: escaping },
    );
  }
  if (uncategorized.length > 0) {
    throw new TestSuiteClassificationError(
      `uncategorized test file(s) under ${TESTS_ROOT_REL}/: ${uncategorized.join(", ")}\n` +
        `every *${TEST_FILE_SUFFIX} must live under ${UNIT_DIR_REL}/ or ${INTEGRATION_DIR_REL}/; ` +
        "directory location is the only category authority",
      { code: TEST_CLASSIFICATION_CODES.UNCATEGORIZED_TEST_PATH, paths: uncategorized },
    );
  }
  if (duplicates.length > 0) {
    const rendered = duplicates.map((d) => `${d.basename} (${d.paths.join(", ")})`).join("; ");
    throw new TestSuiteClassificationError(
      `duplicate test basename(s): ${rendered}`,
      {
        code: TEST_CLASSIFICATION_CODES.DUPLICATE_TEST_BASENAME,
        paths: duplicates.flatMap((d) => d.paths),
      },
    );
  }
  if (staleExceptions.length > 0) {
    throw new TestSuiteClassificationError(
      `unit-safe signal exception names a path that is not a unit test: ${staleExceptions.join(", ")}`,
      { code: TEST_CLASSIFICATION_CODES.UNKNOWN_EXCEPTION_PATH, paths: staleExceptions },
    );
  }
  if (integrationSignalInUnit.length > 0) {
    const rendered = integrationSignalInUnit
      .map(({ test, signals }) => {
        const via = signals
          .map((s) => (s.kind === "self" ? "its own source" : s.carrier))
          .join(", ");
        return `${test} (via ${via})`;
      })
      .join("; ");
    throw new TestSuiteClassificationError(
      `integration-shaped test placed in ${UNIT_DIR_REL}/: ${rendered}\n` +
        `these import ${INTEGRATION_PROCESS_SIGNAL_SPECIFIERS[0]} directly or through a ` +
        `tests/ helper, so they can start a process. Move them to ${INTEGRATION_DIR_REL}/, ` +
        "or add an exact-path, rationale-bearing entry to UNIT_SAFE_SIGNAL_EXCEPTIONS. " +
        "This guard refuses the placement; it never reclassifies it.",
      {
        code: TEST_CLASSIFICATION_CODES.INTEGRATION_SIGNAL_IN_UNIT,
        paths: integrationSignalInUnit.map((entry) => entry.test),
      },
    );
  }
}

export function loadTestCorpus({ repoRoot, readFile, listDir, dirExists, exceptions }) {
  const testFiles = enumerateTestFiles({ repoRoot, listDir, dirExists });
  const supportModules = enumerateTestSupportModules({ repoRoot, listDir, dirExists });

  const sources = new Map();
  for (const rel of [...testFiles, ...supportModules]) {
    sources.set(rel, readFile(path.join(repoRoot, rel)));
  }

  const audit = auditTestCorpus({ testFiles, sources, exceptions });
  assertNoCorpusViolations(audit);
  return { unit: audit.unit, integration: audit.integration, sources, supportModules, audit };
}
