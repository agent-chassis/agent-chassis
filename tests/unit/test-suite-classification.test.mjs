

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INTEGRATION_DIR_REL,
  INTEGRATION_PROCESS_SIGNAL_SPECIFIERS,
  TEST_CLASSIFICATION_CODES,
  TestSuiteClassificationError,
  UNIT_DIR_REL,
  UNIT_SAFE_SIGNAL_EXCEPTIONS,
  assertNoCorpusViolations,
  auditTestCorpus,
  classifyTestPath,
  collectLocalImportClosure,
  enumerateFilesRecursively,
  enumerateTestFiles,
  enumerateTestSupportModules,
  extractModuleDependencies,
  findIntegrationProcessSignals,
  hasIntegrationProcessSignal,
  isPackageLocalTestPath,
  isSupportedTestPath,
  isUncategorizedTestPath,
  loadTestCorpus,
} from "../test-suite-classification.mjs";

function dirent(name, kind) {
  return {
    name,
    isDirectory: () => kind === "dir",
    isFile: () => kind === "file",
    isSymbolicLink: () => kind === "link",
  };
}

function makeFs(tree, files = {}) {
  return {
    listDir: (abs) => tree[abs] ?? [],
    dirExists: (abs) => Object.prototype.hasOwnProperty.call(tree, abs),
    readFile: (abs) => {
      if (!(abs in files)) throw new Error(`no such file: ${abs}`);
      return files[abs];
    },
  };
}

function captureRefusal(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof TestSuiteClassificationError, `unexpected error: ${err}`);
    return err;
  }
  throw new assert.AssertionError({ message: "expected a classification refusal" });
}

const SPAWNING_SOURCE = 'import { spawn } from "node:child_process";\nexport const go = spawn;\n';
const PURE_SOURCE = 'import test from "node:test";\ntest("x", () => {});\n';

test("directory location is the sole category authority", () => {
  assert.equal(classifyTestPath(`${UNIT_DIR_REL}/a.test.mjs`), "unit");
  assert.equal(classifyTestPath(`${INTEGRATION_DIR_REL}/a.test.mjs`), "integration");
  assert.equal(classifyTestPath(`${UNIT_DIR_REL}/nested/deep/a.test.mjs`), "unit");
  assert.equal(classifyTestPath(`${INTEGRATION_DIR_REL}/nested/a.test.mjs`), "integration");

  assert.equal(classifyTestPath(`${UNIT_DIR_REL}/helper.mjs`), null);
  assert.equal(classifyTestPath("tests/a.test.mjs"), null);
  assert.equal(classifyTestPath("tests/fixtures/a.test.mjs"), null);

  assert.equal(classifyTestPath("tests/unitary/a.test.mjs"), null);
});

test("source prose, string literals, and imported names decide nothing", () => {

  const prosey = [
    "// this test explains how bwrap confinement works",
    'const doc = "claude-worker spawns through bin/agent-launch";',
    "// probeClaudeRuntime and spawnSync are discussed but never called",
    'test("pure", () => {});',
  ].join("\n");

  assert.equal(classifyTestPath(`${UNIT_DIR_REL}/prosey.test.mjs`), "unit");
  assert.equal(classifyTestPath(`${INTEGRATION_DIR_REL}/prosey.test.mjs`), "integration");

  assert.equal(hasIntegrationProcessSignal(prosey), false);
});

test("the supported-corpus predicate and the uncategorized predicate are complements over tests/**", () => {
  assert.equal(isSupportedTestPath(`${UNIT_DIR_REL}/a.test.mjs`), true);
  assert.equal(isUncategorizedTestPath(`${UNIT_DIR_REL}/a.test.mjs`), false);
  assert.equal(isSupportedTestPath("tests/a.test.mjs"), false);
  assert.equal(isUncategorizedTestPath("tests/a.test.mjs"), true);
  assert.equal(isUncategorizedTestPath("tests/fixtures/a.test.mjs"), true);

  assert.equal(isSupportedTestPath("tests/helper.mjs"), false);
  assert.equal(isUncategorizedTestPath("tests/helper.mjs"), false);

  assert.equal(isUncategorizedTestPath("packages/wiki-core/src/a.test.mjs"), false);
});

test("the package-local rule is owned here for WK-1632 and matches only packages/**", () => {
  assert.equal(isPackageLocalTestPath("packages/wiki-core/src/lib/a.test.mjs"), true);
  assert.equal(isPackageLocalTestPath("packages/wiki-mcp/a.test.mjs"), true);
  assert.equal(isPackageLocalTestPath("packages/a.test.mjs"), false);
  assert.equal(isPackageLocalTestPath(`${UNIT_DIR_REL}/a.test.mjs`), false);
  assert.equal(isPackageLocalTestPath("packages/wiki-core/src/lib/a.mjs"), false);
});

test("enumeration is recursive, sorted, and independent of directory iteration order", () => {
  const tree = {
    "/r/tests": [dirent("unit", "dir"), dirent("run-tests.mjs", "file")],
    "/r/tests/unit": [
      dirent("z.test.mjs", "file"),
      dirent("nested", "dir"),
      dirent("a.test.mjs", "file"),
    ],
    "/r/tests/unit/nested": [dirent("m.test.mjs", "file")],
  };
  const forward = enumerateFilesRecursively({
    absDir: "/r/tests",
    relDir: "tests",
    listDir: (abs) => tree[abs] ?? [],
  });

  const reversed = enumerateFilesRecursively({
    absDir: "/r/tests",
    relDir: "tests",
    listDir: (abs) => [...(tree[abs] ?? [])].reverse(),
  });
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, [
    "tests/run-tests.mjs",
    "tests/unit/a.test.mjs",
    "tests/unit/nested/m.test.mjs",
    "tests/unit/z.test.mjs",
  ]);
});

test("symlinks are never followed and never emitted", () => {
  const tree = {
    "/r/tests": [dirent("unit", "dir")],
    "/r/tests/unit": [dirent("real.test.mjs", "file"), dirent("escape.test.mjs", "link")],
  };
  const found = enumerateFilesRecursively({
    absDir: "/r/tests",
    relDir: "tests",
    listDir: (abs) => tree[abs] ?? [],
  });
  assert.deepEqual(found, ["tests/unit/real.test.mjs"]);
});

test("test files and support modules are enumerated as disjoint sets", () => {
  const tree = {
    "/r/tests": [dirent("unit", "dir"), dirent("shared.mjs", "file"), dirent("notes.md", "file")],
    "/r/tests/unit": [dirent("a.test.mjs", "file"), dirent("local-helper.mjs", "file")],
  };
  const fsx = makeFs(tree);
  assert.deepEqual(enumerateTestFiles({ repoRoot: "/r", ...fsx }), ["tests/unit/a.test.mjs"]);
  assert.deepEqual(enumerateTestSupportModules({ repoRoot: "/r", ...fsx }), [
    "tests/shared.mjs",
    "tests/unit/local-helper.mjs",
  ]);
});

test("the signal is the process-module import, in every call shape the old regex missed", () => {
  assert.deepEqual([...INTEGRATION_PROCESS_SIGNAL_SPECIFIERS], [
    "node:child_process",
    "child_process",
  ]);

  assert.equal(hasIntegrationProcessSignal('import { spawn } from "node:child_process";'), true);
  assert.equal(hasIntegrationProcessSignal('import { execFile } from "node:child_process";'), true);
  assert.equal(hasIntegrationProcessSignal('import { fork } from "node:child_process";'), true);
  assert.equal(hasIntegrationProcessSignal('import { spawnSync } from "child_process";'), true);
  assert.equal(hasIntegrationProcessSignal('const cp = await import("node:child_process");'), true);
  assert.equal(hasIntegrationProcessSignal('const cp = require("node:child_process");'), true);

  assert.equal(hasIntegrationProcessSignal("// calls spawnSync somewhere else\n"), false);
  assert.equal(hasIntegrationProcessSignal('import { spawn } from "./my-helper.mjs";'), false);
});

test("the signal is found through a transitive tests/-local helper closure", () => {
  const sources = new Map([
    [
      `${UNIT_DIR_REL}/a.test.mjs`,
      'import test from "node:test";\nimport { go } from "../helpers/mid.mjs";\ntest("x", () => go);\n',
    ],
    ["tests/helpers/mid.mjs", 'export { go } from "./spawner.mjs";\n'],
    ["tests/helpers/spawner.mjs", SPAWNING_SOURCE],
  ]);
  assert.deepEqual(collectLocalImportClosure(`${UNIT_DIR_REL}/a.test.mjs`, sources), [
    "tests/helpers/mid.mjs",
    "tests/helpers/spawner.mjs",
  ]);
  const signals = findIntegrationProcessSignals(`${UNIT_DIR_REL}/a.test.mjs`, sources);
  assert.deepEqual(signals, [{ carrier: "tests/helpers/spawner.mjs", kind: "imported" }]);
});

test("an import cycle in the closure terminates", () => {
  const sources = new Map([
    [`${UNIT_DIR_REL}/a.test.mjs`, 'import { x } from "../helpers/one.mjs";\n'],
    ["tests/helpers/one.mjs", 'export { x } from "./two.mjs";\n'],
    ["tests/helpers/two.mjs", 'export { x } from "./one.mjs";\nexport const x = 1;\n'],
  ]);
  assert.deepEqual(collectLocalImportClosure(`${UNIT_DIR_REL}/a.test.mjs`, sources), [
    "tests/helpers/one.mjs",
    "tests/helpers/two.mjs",
  ]);
});

test("dependency extraction covers static, side-effect, and dynamic import forms", () => {
  const deps = extractModuleDependencies(
    [
      'import { a } from "./a.mjs";',
      'export { b } from "./b.mjs";',
      'import "./side-effect.mjs";',
      'const c = await import("./c.mjs");',
      'const notAnImport = `import { z } from "./nope.mjs";`;',
    ].join("\n"),
  );
  assert.ok(deps.all.includes("./a.mjs"));
  assert.ok(deps.all.includes("./b.mjs"));
  assert.ok(deps.all.includes("./side-effect.mjs"));
  assert.deepEqual(deps.dynamicImportSpecifiers, ["./c.mjs"]);
});

test("dependency occurrences are lossless and retain kind and source location", () => {
  const deps = extractModuleDependencies([
    'import { a } from "./shared.mjs";',
    'import "./side-effect.mjs";',
    'export { b } from "./exported.mjs";',
    'await import("./shared.mjs");',
    'await import("./shared.mjs");',
  ].join("\n"));
  assert.deepEqual(deps.occurrences.map(({ kind, specifier }) => ({ kind, specifier })), [
    { kind: "static", specifier: "./shared.mjs" },
    { kind: "side-effect", specifier: "./side-effect.mjs" },
    { kind: "static", specifier: "./exported.mjs" },
    { kind: "dynamic-literal", specifier: "./shared.mjs" },
    { kind: "dynamic-literal", specifier: "./shared.mjs" },
  ]);
  assert.deepEqual(deps.occurrences[3].location, { line: 4, column: 6 });
  assert.deepEqual(deps.importSpecifiers, ["./shared.mjs", "./exported.mjs", "./side-effect.mjs"]);
  assert.deepEqual(deps.dynamicImportSpecifiers, ["./shared.mjs"]);
  assert.deepEqual(deps.all, ["./shared.mjs", "./exported.mjs", "./side-effect.mjs"]);
});

test("only multiline direct assert.rejects literal imports carry direct-call context", () => {
  const direct = extractModuleDependencies([
    "await assert.rejects(",
    "  import(",
    '    "./gone.mjs"',
    "  ),",
    "  /missing/",
    ");",
  ].join("\n")).occurrences.find((item) => item.kind === "dynamic-literal");
  assert.deepEqual(direct.enclosingCall, {
    callee: "assert.rejects",
    argumentIndex: 0,
    direct: true,
  });

  for (const source of [
    'assert.rejects(() => import("./arrow.mjs"));',
    'assert.rejects(Promise.resolve(import("./nested.mjs")));',
    'assert["rejects"](import("./computed-member.mjs"));',
    'const rejects = assert.rejects; rejects(import("./aliased.mjs"));',
    'assert.rejects((import("./parenthesized.mjs")));',
  ]) {
    const occurrence = extractModuleDependencies(source).occurrences
      .find((item) => item.kind === "dynamic-literal");
    assert.equal(occurrence.enclosingCall, null, source);
  }
});

test("comments, strings, templates, and regular expressions cannot create import occurrences", () => {
  const deps = extractModuleDependencies([
    '// import("./comment.mjs")',
    '/* import "./block.mjs"; */',
    'const quoted = "import(\\\"./string.mjs\\\")";',
    'const template = `import("./template.mjs")`;',
    'const pattern = /import\\(\"\\.\\/regex\\.mjs\"\\)/u;',
    'if (quoted) /import\\(\"\\.\\/control-regex\\.mjs\"\\)/u.test(quoted);',
    'loader.import("./method-lookalike.mjs");',
    'await import("./real.mjs");',
  ].join("\n"));
  assert.deepEqual(deps.all, ["./real.mjs"]);
  assert.deepEqual(deps.occurrences.map((item) => item.specifier), ["./real.mjs"]);
});

test("real code in a template interpolation remains an import occurrence", () => {
  const deps = extractModuleDependencies([
    'const rendered = `raw import("./raw.mjs") ${',
    '  import("./interpolation.mjs")',
    "}`;",
  ].join("\n"));
  assert.deepEqual(deps.all, ["./interpolation.mjs"]);
  assert.equal(deps.occurrences[0].location.line, 2);
});

test("computed and nested dynamic imports remain visible and never gain direct context", () => {
  const deps = extractModuleDependencies([
    'assert.rejects(import("./" + name));',
    'await import(target);',
    'await import(`../../packages/wiki-core/src/lib/read.mjs?fast-path=${Date.now()}`);',
    'assert.rejects(load(import("./nested.mjs")));',
  ].join("\n"));
  assert.equal(deps.occurrences[0].kind, "dynamic-computed");
  assert.equal(deps.occurrences[0].specifier, null);
  assert.equal(deps.occurrences[1].kind, "dynamic-computed");
  assert.equal(deps.occurrences[2].kind, "dynamic-computed");
  assert.deepEqual(deps.all, ["./nested.mjs"]);
  const nested = deps.occurrences.find((item) => item.specifier === "./nested.mjs");
  assert.equal(nested.kind, "dynamic-literal");
  assert.equal(nested.enclosingCall, null);
});

test(".all and transitive process placement still include direct assert.rejects imports", () => {
  const rel = `${UNIT_DIR_REL}/negative-process.test.mjs`;
  const sources = new Map([[rel, 'await assert.rejects(import("node:child_process"));\n']]);
  assert.deepEqual(extractModuleDependencies(sources.get(rel)).all, ["node:child_process"]);
  assert.deepEqual(findIntegrationProcessSignals(rel, sources), [{ carrier: rel, kind: "self" }]);
});

function auditOf(entries, policy = {}) {
  const sources = new Map(entries);
  return auditTestCorpus({
    testFiles: [...sources.keys()].filter((k) => k.endsWith(".test.mjs")),
    sources,
    exceptions: [],
    enrolled: [],
    backlog: [],
    ...policy,
  });
}

test("an uncategorized top-level test is refused with a stable code, not reclassified", () => {
  const audit = auditOf([
    [`${UNIT_DIR_REL}/ok.test.mjs`, PURE_SOURCE],
    ["tests/stray.test.mjs", PURE_SOURCE],
  ]);
  assert.deepEqual(audit.violations.uncategorized, ["tests/stray.test.mjs"]);

  assert.deepEqual(audit.unit, [`${UNIT_DIR_REL}/ok.test.mjs`]);
  assert.deepEqual(audit.integration, []);

  const err = captureRefusal(() => assertNoCorpusViolations(audit));
  assert.equal(err.code, TEST_CLASSIFICATION_CODES.UNCATEGORIZED_TEST_PATH);
  assert.deepEqual(err.paths, ["tests/stray.test.mjs"]);
});

test("a nested uncategorized test under tests/fixtures/ is refused too", () => {

  const audit = auditOf([["tests/fixtures/orphan.test.mjs", PURE_SOURCE]]);
  assert.deepEqual(audit.violations.uncategorized, ["tests/fixtures/orphan.test.mjs"]);
  assert.throws(() => assertNoCorpusViolations(audit), {
    code: TEST_CLASSIFICATION_CODES.UNCATEGORIZED_TEST_PATH,
  });
});

test("a unit test that imports node:child_process DIRECTLY is refused", () => {
  const audit = auditOf([
    [`${UNIT_DIR_REL}/spawns.test.mjs`, `${PURE_SOURCE}${SPAWNING_SOURCE}`],
  ]);
  assert.deepEqual(audit.violations.integrationSignalInUnit.map((v) => v.test), [
    `${UNIT_DIR_REL}/spawns.test.mjs`,
  ]);
  assert.deepEqual(audit.violations.integrationSignalInUnit[0].signals, [
    { carrier: `${UNIT_DIR_REL}/spawns.test.mjs`, kind: "self" },
  ]);
  const err = captureRefusal(() => assertNoCorpusViolations(audit));
  assert.equal(err.code, TEST_CLASSIFICATION_CODES.INTEGRATION_SIGNAL_IN_UNIT);
  assert.match(err.message, /never reclassifies/);
});

test("a unit test that reaches a KNOWN SPAWNING HELPER is refused", () => {

  const audit = auditOf([
    [
      `${UNIT_DIR_REL}/uses-helper.test.mjs`,
      'import test from "node:test";\nimport { go } from "../helpers/spawner.mjs";\ntest("x", () => go);\n',
    ],
    ["tests/helpers/spawner.mjs", SPAWNING_SOURCE],
  ]);
  assert.deepEqual(audit.violations.integrationSignalInUnit[0].signals, [
    { carrier: "tests/helpers/spawner.mjs", kind: "imported" },
  ]);
  assert.throws(() => assertNoCorpusViolations(audit), {
    code: TEST_CLASSIFICATION_CODES.INTEGRATION_SIGNAL_IN_UNIT,
  });
});

test("the same spawning test placed under tests/integration/ is accepted", () => {

  const audit = auditOf([
    [`${INTEGRATION_DIR_REL}/spawns.test.mjs`, SPAWNING_SOURCE],
  ]);
  assert.deepEqual(audit.violations.integrationSignalInUnit, []);
  assert.deepEqual(audit.integration, [`${INTEGRATION_DIR_REL}/spawns.test.mjs`]);
  assert.doesNotThrow(() => assertNoCorpusViolations(audit));
});

test("a duplicate test basename across the two category directories is refused", () => {
  const audit = auditOf([
    [`${UNIT_DIR_REL}/same.test.mjs`, PURE_SOURCE],
    [`${INTEGRATION_DIR_REL}/same.test.mjs`, PURE_SOURCE],
  ]);
  assert.deepEqual(audit.violations.duplicates, [
    {
      basename: "same.test.mjs",
      paths: [`${INTEGRATION_DIR_REL}/same.test.mjs`, `${UNIT_DIR_REL}/same.test.mjs`],
    },
  ]);
  const err = captureRefusal(() => assertNoCorpusViolations(audit));
  assert.equal(err.code, TEST_CLASSIFICATION_CODES.DUPLICATE_TEST_BASENAME);
});

test("a path escaping the tests/ root is refused", () => {
  const audit = auditOf([
    [`${UNIT_DIR_REL}/ok.test.mjs`, PURE_SOURCE],
    ["packages/wiki-core/src/outside.test.mjs", PURE_SOURCE],
  ]);
  assert.deepEqual(audit.violations.escaping, ["packages/wiki-core/src/outside.test.mjs"]);
  const err = captureRefusal(() => assertNoCorpusViolations(audit));
  assert.equal(err.code, TEST_CLASSIFICATION_CODES.ESCAPING_TEST_PATH);
});

test("an exact-path unit-safe exception admits one signal-carrying unit test and nothing else", () => {
  const sources = new Map([
    [`${UNIT_DIR_REL}/excepted.test.mjs`, SPAWNING_SOURCE],
    [`${UNIT_DIR_REL}/not-excepted.test.mjs`, SPAWNING_SOURCE],
  ]);
  const audit = auditTestCorpus({
    testFiles: [...sources.keys()],
    sources,
    exceptions: [
      { test: `${UNIT_DIR_REL}/excepted.test.mjs`, reason: "reviewed: cannot start a process" },
    ],
  });
  assert.deepEqual(audit.violations.integrationSignalInUnit.map((v) => v.test), [
    `${UNIT_DIR_REL}/not-excepted.test.mjs`,
  ]);
  assert.deepEqual(audit.violations.staleExceptions, []);
});

test("an exception naming a path that is not a unit test is itself refused", () => {

  const sources = new Map([[`${UNIT_DIR_REL}/ok.test.mjs`, PURE_SOURCE]]);
  const audit = auditTestCorpus({
    testFiles: [...sources.keys()],
    sources,
    exceptions: [{ test: `${UNIT_DIR_REL}/deleted-long-ago.test.mjs`, reason: "stale" }],
  });
  assert.deepEqual(audit.violations.staleExceptions, [
    `${UNIT_DIR_REL}/deleted-long-ago.test.mjs`,
  ]);
  const err = captureRefusal(() => assertNoCorpusViolations(audit));
  assert.equal(err.code, TEST_CLASSIFICATION_CODES.UNKNOWN_EXCEPTION_PATH);
});

test("every shipped exception is exact-path, rationale-bearing, and unit-placed", () => {
  assert.ok(Array.isArray(UNIT_SAFE_SIGNAL_EXCEPTIONS));
  for (const entry of UNIT_SAFE_SIGNAL_EXCEPTIONS) {
    assert.equal(typeof entry.test, "string");

    assert.equal(classifyTestPath(entry.test), "unit", entry.test);
    assert.ok(entry.reason && entry.reason.length > 40,
      `${entry.test} needs a substantive rationale`);
  }

  assert.deepEqual(UNIT_SAFE_SIGNAL_EXCEPTIONS.map((e) => e.test), [
    "tests/unit/test-suite-classification.test.mjs",
  ]);
});

test("loadTestCorpus enumerates, audits, and returns the selectable corpus", () => {
  const tree = {
    "/r/tests": [dirent("unit", "dir"), dirent("integration", "dir"), dirent("helpers", "dir")],
    "/r/tests/unit": [dirent("pure.test.mjs", "file")],
    "/r/tests/integration": [dirent("spawns.test.mjs", "file")],
    "/r/tests/helpers": [dirent("spawner.mjs", "file")],
  };
  const files = {
    "/r/tests/unit/pure.test.mjs": PURE_SOURCE,
    "/r/tests/integration/spawns.test.mjs": SPAWNING_SOURCE,
    "/r/tests/helpers/spawner.mjs": SPAWNING_SOURCE,
  };
  const corpus = loadTestCorpus({
    repoRoot: "/r", ...makeFs(tree, files), exceptions: [], enrolled: [], backlog: [],
  });
  assert.deepEqual(corpus.unit, ["tests/unit/pure.test.mjs"]);
  assert.deepEqual(corpus.integration, ["tests/integration/spawns.test.mjs"]);
  assert.deepEqual(corpus.supportModules, ["tests/helpers/spawner.mjs"]);
});

test("loadTestCorpus refuses before returning any selectable set", () => {
  const tree = {
    "/r/tests": [dirent("unit", "dir")],
    "/r/tests/unit": [dirent("spawns.test.mjs", "file")],
  };
  const files = { "/r/tests/unit/spawns.test.mjs": SPAWNING_SOURCE };
  const err = captureRefusal(() =>
    loadTestCorpus({
    repoRoot: "/r", ...makeFs(tree, files), exceptions: [], enrolled: [], backlog: [],
  }));
  assert.equal(err.code, TEST_CLASSIFICATION_CODES.INTEGRATION_SIGNAL_IN_UNIT);
});

class CountingSources extends Map {
  reads = new Map();
  get(key) {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    return super.get(key);
  }
}

test("one audit scans a module once however many closures reach it", () => {
  const sources = new CountingSources([
    [`${UNIT_DIR_REL}/a.test.mjs`, 'import "../helpers/shared.mjs";\nimport "../helpers/mid.mjs";\n'],
    [`${UNIT_DIR_REL}/b.test.mjs`, 'import "../helpers/mid.mjs";\n'],
    [`${UNIT_DIR_REL}/c.test.mjs`, 'import "../helpers/shared.mjs";\n'],
    ["tests/helpers/mid.mjs", 'import "./shared.mjs";\nimport "./cycle.mjs";\n'],
    ["tests/helpers/cycle.mjs", 'import "./mid.mjs";\n'],
    ["tests/helpers/shared.mjs", SPAWNING_SOURCE],
  ]);
  const audit = auditTestCorpus({
    testFiles: [...sources.keys()].filter((k) => k.endsWith(".test.mjs")),
    sources,
    exceptions: [],
    enrolled: ["tests/helpers/shared.mjs", `${UNIT_DIR_REL}/a.test.mjs`],
    backlog: [{ path: "tests/helpers/mid.mjs" }],
  });
  assert.deepEqual(Object.fromEntries(sources.reads), Object.fromEntries(
    [...sources.keys()].map((key) => [key, 1])));

  assert.deepEqual(audit.violations.integrationSignalInUnit, ["a", "b", "c"].map((name) => ({
    test: `${UNIT_DIR_REL}/${name}.test.mjs`,
    signals: [{ carrier: "tests/helpers/shared.mjs", kind: "imported" }],
  })));
  assert.deepEqual(audit.violations.directSubprocessInEnrolled, ["tests/helpers/shared.mjs"]);
  assert.deepEqual(audit.violations.staleSubprocessBacklog, ["tests/helpers/mid.mjs"]);
});

test("a later loadTestCorpus observes a process import introduced after an earlier one", () => {
  const tree = {
    "/r/tests": [dirent("unit", "dir"), dirent("helpers", "dir")],
    "/r/tests/unit": [dirent("one.test.mjs", "file"), dirent("two.test.mjs", "file")],
    "/r/tests/helpers": [dirent("shared.mjs", "file")],
  };
  const files = {
    "/r/tests/unit/one.test.mjs": 'import "../helpers/shared.mjs";\n',
    "/r/tests/unit/two.test.mjs": 'import "../helpers/shared.mjs";\n',
    "/r/tests/helpers/shared.mjs": "export const value = 1;\n",
  };
  const load = () => loadTestCorpus({
    repoRoot: "/r", ...makeFs(tree, files), exceptions: [], enrolled: [], backlog: [],
  });
  assert.deepEqual(load().unit, ["tests/unit/one.test.mjs", "tests/unit/two.test.mjs"]);
  files["/r/tests/helpers/shared.mjs"] = SPAWNING_SOURCE;
  const err = captureRefusal(load);
  assert.equal(err.code, TEST_CLASSIFICATION_CODES.INTEGRATION_SIGNAL_IN_UNIT);
  assert.match(err.message, /tests\/helpers\/shared\.mjs/u);
  files["/r/tests/helpers/shared.mjs"] = "export const value = 2;\n";
  assert.deepEqual(load().unit, ["tests/unit/one.test.mjs", "tests/unit/two.test.mjs"]);
});

const HELPER_SOURCE = 'import { spawnManagedTestProcess } from "../helpers/managed-test-process.mjs";\n';

test("an enrolled file that spawns directly is refused with a stable code", () => {
  const rel = `${INTEGRATION_DIR_REL}/enrolled.test.mjs`;
  const audit = auditOf([[rel, SPAWNING_SOURCE]], { enrolled: [rel] });
  assert.deepEqual(audit.violations.directSubprocessInEnrolled, [rel]);
  const err = captureRefusal(() => assertNoCorpusViolations(audit));
  assert.equal(err.code, TEST_CLASSIFICATION_CODES.DIRECT_SUBPROCESS_IN_ENROLLED);
  assert.deepEqual(err.paths, [rel]);
  assert.match(err.message, /route process creation through a designated helper/u);
});

test("enrollment catches a DYNAMIC subprocess import, not only a static one", () => {

  const rel = `${INTEGRATION_DIR_REL}/dynamic.test.mjs`;
  const dynamic = 'const { execFileSync } = await import("node:child_process");\n';
  const audit = auditOf([[rel, dynamic]], { enrolled: [rel] });
  assert.deepEqual(audit.violations.directSubprocessInEnrolled, [rel]);
  assert.equal(captureRefusal(() => assertNoCorpusViolations(audit)).code,
    TEST_CLASSIFICATION_CODES.DIRECT_SUBPROCESS_IN_ENROLLED);
});

test("an enrolled file that routes through a designated helper passes", () => {
  const rel = `${INTEGRATION_DIR_REL}/enrolled.test.mjs`;
  const audit = auditOf([[rel, HELPER_SOURCE]], { enrolled: [rel] });
  assert.deepEqual(audit.violations.directSubprocessInEnrolled, []);
  assert.doesNotThrow(() => assertNoCorpusViolations(audit));
});

test("a designated helper is never enrolled against its own implementation", () => {

  const helper = "tests/helpers/managed-test-process.mjs";
  const audit = auditOf([
    [`${INTEGRATION_DIR_REL}/ok.test.mjs`, PURE_SOURCE],
    [helper, SPAWNING_SOURCE],
  ], { enrolled: [helper], designatedHelpers: [helper] });
  assert.deepEqual(audit.violations.directSubprocessInEnrolled, []);
  assert.deepEqual(audit.violations.subprocessEnrollmentConflicts, [helper]);
  assert.equal(captureRefusal(() => assertNoCorpusViolations(audit)).code,
    TEST_CLASSIFICATION_CODES.SUBPROCESS_ENROLLMENT_CONFLICT);
});

test("a migrated file cannot keep its backlog entry as a standing allowance", () => {
  const rel = "tests/helpers/migrated-fixture.mjs";

  const live = auditOf([
    [`${INTEGRATION_DIR_REL}/ok.test.mjs`, PURE_SOURCE],
    [rel, SPAWNING_SOURCE],
  ], { backlog: [{ path: rel, reason: "not migrated yet" }] });
  assert.deepEqual(live.violations.staleSubprocessBacklog, []);
  assert.doesNotThrow(() => assertNoCorpusViolations(live));

  const migrated = auditOf([
    [`${INTEGRATION_DIR_REL}/ok.test.mjs`, PURE_SOURCE],
    [rel, HELPER_SOURCE],
  ], { backlog: [{ path: rel, reason: "not migrated yet" }] });
  assert.deepEqual(migrated.violations.staleSubprocessBacklog, [rel]);
  const err = captureRefusal(() => assertNoCorpusViolations(migrated));
  assert.equal(err.code, TEST_CLASSIFICATION_CODES.STALE_SUBPROCESS_BACKLOG);
  assert.match(err.message, /add it to SUBPROCESS_HELPER_ENROLLED/u);
});

test("a path cannot be both enrolled and excused", () => {
  const rel = "tests/helpers/conflicted.mjs";
  const audit = auditOf([
    [`${INTEGRATION_DIR_REL}/ok.test.mjs`, PURE_SOURCE],
    [rel, SPAWNING_SOURCE],
  ], { enrolled: [rel], backlog: [{ path: rel, reason: "conflicting" }] });
  assert.deepEqual(audit.violations.subprocessEnrollmentConflicts, [rel]);
  assert.equal(captureRefusal(() => assertNoCorpusViolations(audit)).code,
    TEST_CLASSIFICATION_CODES.SUBPROCESS_ENROLLMENT_CONFLICT);
});

test("the SHIPPED enrollment and backlog hold against the real corpus", async () => {

  const { readFileSync, readdirSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  assert.doesNotThrow(() => loadTestCorpus({
    repoRoot,
    readFile: (abs) => readFileSync(abs, "utf8"),
    listDir: (abs) => readdirSync(abs, { withFileTypes: true }),
    dirExists: (abs) => existsSync(abs),
  }));
});
