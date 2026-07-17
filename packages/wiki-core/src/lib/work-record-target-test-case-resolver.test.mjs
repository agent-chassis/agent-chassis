import test from "node:test";
import assert from "node:assert/strict";

import {
  WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER,
  resolveBoundedJavaScriptTestCaseTargetFromSourceText
} from "./work-record-target-test-case-resolver.mjs";

function resolve(sourceText, overrides = {}) {
  const { target: targetOverrides = {}, ...inputOverrides } = overrides;
  return resolveBoundedJavaScriptTestCaseTargetFromSourceText({
    sourceText,
    target: {
      path: "packages/wiki-core/src/lib/sample.test.mjs",
      kind: "test_case",
      name: "selected test",
      operation: "modify",
      ...targetOverrides
    },
    ...inputOverrides
  });
}

function assertFailsClosed(result) {
  assert.notEqual(result.target_resolution_status, "resolved");
  assert.notEqual(result.target_resolution_evidence_status, "present");
  assert.equal(result.target_resolution_span, null);
}

function assertProviderUnavailable(result, message) {
  assert.equal(result.target_resolution_status, "provider_unavailable", message);
  assert.equal(result.target_resolution_evidence_status, "degraded", message);
  assert.deepEqual(result.target_resolution_provider, { id: null, version: null, mode: "unavailable" }, message);
  assert.notDeepEqual(result.target_resolution_provider, WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER, message);
  assertFailsClosed(result);
}

function supportedSource(binding = "test") {
  return `import test from "node:test";\n${binding}("selected test", () => {});\n`;
}

test("resolves supported static node:test bindings to a bounded top-level call span", () => {
  const sources = [
    'import test from "node:test";\n\ntest("selected test", () => {\n  return true;\n});\n',
    'import { test } from "node:test";\n\ntest("selected test", () => {});\n',
    'import { test as scenario } from "node:test";\n\nscenario("selected test", () => {});\n'
  ];

  const [defaultImport, namedImport, aliasedImport] = sources.map((sourceText) => resolve(sourceText));
  assert.deepEqual(defaultImport.target_resolution_span, { start_line: 3, end_line: 5, line_count: 3 });
  assert.deepEqual(namedImport.target_resolution_span, { start_line: 3, end_line: 3, line_count: 1 });
  assert.deepEqual(aliasedImport.target_resolution_span, { start_line: 3, end_line: 3, line_count: 1 });
  for (const result of [defaultImport, namedImport, aliasedImport]) {
    assert.equal(result.target_resolution_status, "resolved");
    assert.deepEqual(result.target_resolution_provider, WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER);
    assert.deepEqual(result.target_resolution_fanout, { direct_reference_count: 1, affected_symbol_count: 1 });
  }
});

test("preserves source-record, selected-unit, and payload digest bindings while minting only local provider identity", () => {
  const result = resolve('import test from "node:test";\ntest("selected test", () => {});\n', {
    provider: { id: "caller.provider", version: "999", mode: "remote" },
    target_resolution_provider: { id: "spoofed.provider" },
    sourceRecordDigest: "sha256:source",
    selectedUnit: {
      kind: "slice",
      address: "agent-chassis:WK-1313#SLICE-010",
      recordId: "WK-1313",
      sliceId: "SLICE-010",
      repository: "agent-chassis"
    },
    expected_payload_bound_input_digest: "sha256:payload"
  });

  assert.deepEqual(result.target_resolution_provider, {
    id: "portfolio-local.target-test-case-resolver",
    version: "0.1.0",
    mode: "local"
  });
  assert.equal(result.source_record_digest, "sha256:source");
  assert.deepEqual(result.selected_unit, {
    kind: "slice",
    address: "agent-chassis:WK-1313#SLICE-010",
    record_id: "WK-1313",
    slice_id: "SLICE-010",
    repo: "agent-chassis"
  });
  assert.equal(result.payload_bound_input_digest, "sha256:payload");
});

test("fails closed on parser errors", () => {
  const result = resolve('import test from "node:test";\ntest("selected test", () => {\n');
  assert.equal(result.target_resolution_status, "provider_unavailable");
  assertFailsClosed(result);
});

test("rejects dynamic imports, require bindings, and unsupported node:test aliases", () => {
  const sources = [
    'const { test } = await import("node:test");\ntest("selected test", () => {});\n',
    'const test = require("node:test");\ntest("selected test", () => {});\n',
    'import { describe as test } from "node:test";\ntest("selected test", () => {});\n',
    'import * as test from "node:test";\ntest("selected test", () => {});\n'
  ];
  for (const sourceText of sources) {
    const result = resolve(sourceText);
    assert.equal(result.target_resolution_status, "provider_unavailable");
    assertFailsClosed(result);
  }
});

test("rejects global, member, property, and non-top-level calls", () => {
  const cases = [
    'test("selected test", () => {});\n',
    'import test from "node:test";\ntest.only("selected test", () => {});\n',
    'import test from "node:test";\nconst suite = { test };\nsuite.test("selected test", () => {});\n',
    'import test from "node:test";\nfunction register() {\n  test("selected test", () => {});\n}\n'
  ];
  for (const sourceText of cases) assertFailsClosed(resolve(sourceText));
});

test("rejects shadowed supported bindings", () => {
  const cases = [
    'import test from "node:test";\nconst test = () => {};\ntest("selected test", () => {});\n',
    'import { test as scenario } from "node:test";\nfunction scenario() {}\nscenario("selected test", () => {});\n',
    'import test from "node:test";\nfunction register(test) {\n  test("selected test", () => {});\n}\n'
  ];
  for (const sourceText of cases) assertFailsClosed(resolve(sourceText));
});

test("rejects module-scope var conflicts throughout top-level control flow", () => {
  const declarations = [
    "{ var test; }",
    "if (flag) { var test; }",
    "if (flag) {} else { var test; }",
    "for (let index = 0; index < 1; index += 1) { var test; }",
    "for (var test in values) {}",
    "for (var test of values) {}",
    "while (flag) { var test; }",
    "do { var test; } while (flag);",
    "switch (value) { case 1: var test; break; default: break; }",
    "try { var test; } catch (error) {} finally {}",
    "try {} catch (error) { var test; } finally {}",
    "try {} finally { var test; }",
    "scope: { var test; }",
    "var other, test, third;",
    "var { test } = source;",
    "var [test] = source;"
  ];

  for (const declaration of declarations) {
    const result = resolve(`import test from "node:test";\n${declaration}\ntest("selected test", () => {});\n`);
    assert.notEqual(result.target_resolution_status, "resolved", declaration);
    assertFailsClosed(result);
    assert.deepEqual(result.target_resolution_provider, { id: null, version: null, mode: "unavailable" });
    assert.equal(result.target_resolution_status_reason, "supported node:test binding conflicted with a module-scope declaration");
  }
});

test("does not collect var declarations across nested function or class boundaries", () => {
  const nestedDeclarations = [
    "function helper() { var test; }",
    "const helper = function () { var test; };",
    "const helper = () => { var test; };",
    "const holder = { method() { var test; } };",
    "class Holder { method() { var test; } }"
  ];

  for (const declaration of nestedDeclarations) {
    const result = resolve(`import test from "node:test";\n${declaration}\ntest("selected test", () => {});\n`);
    assert.equal(result.target_resolution_status, "resolved");
    assert.deepEqual(result.target_resolution_span, { start_line: 3, end_line: 3, line_count: 1 });
  }
});

test("rejects missing or unsupported target operations without trusted provider evidence", () => {
  const operations = [undefined, null, "", "   ", "execute", 0, true, {}, []];
  const omitted = resolveBoundedJavaScriptTestCaseTargetFromSourceText({
    sourceText: supportedSource(),
    target: {
      path: "packages/wiki-core/src/lib/sample.test.mjs",
      kind: "test_case",
      name: "selected test"
    }
  });
  const results = [omitted, ...operations.map((operation) => resolve(supportedSource(), { target: { operation } }))];
  for (const result of results) {
    assertFailsClosed(result);
    assert.equal(result.target_resolution_status, "provider_unavailable");
    assert.equal(result.target_resolution_status_reason, "declared target operation was missing or unsupported");
    assert.deepEqual(result.target_resolution_provider, { id: null, version: null, mode: "unavailable" });
  }
});

test("rejects missing or unsupported target names without echoing supplied values", () => {
  const invalidNames = [undefined, null, "", "   ", 17, true, { title: "selected test" }, ["selected test"]];
  const omitted = resolveBoundedJavaScriptTestCaseTargetFromSourceText({
    sourceText: supportedSource(),
    target: {
      path: "packages/wiki-core/src/lib/sample.test.mjs",
      kind: "test_case",
      operation: "modify"
    }
  });
  const results = [omitted, ...invalidNames.map((name) => resolve(supportedSource(), { target: { name } }))];

  for (const result of results) {
    assertFailsClosed(result);
    assert.equal(result.target_resolution_status, "provider_unavailable");
    assert.equal(result.target_resolution_status_reason, "declared target name was missing or unsupported");
    assert.deepEqual(result.target_resolution_provider, { id: null, version: null, mode: "unavailable" });
    assert.equal(result.target_resolution_target.name, null);
    assert.equal(result.target_resolution_fanout, null);
    assert.deepEqual(result.target_resolution_candidates, []);
  }
});

test("requires ordinary static string titles while preserving exact trimmed-name matches", () => {
  const rejectedSources = [
    'import test from "node:test";\nconst title = "selected test";\ntest(title, () => {});\n',
    'import test from "node:test";\ntest(`selected test`, () => {});\n',
    'import test from "node:test";\ntest(`selected ${suffix}`, () => {});\n',
    'import test from "node:test";\ntest("selected " + "test", () => {});\n',
    'import test from "node:test";\ntest(String.raw`selected test`, () => {});\n',
    'import test from "node:test";\ntest();\n'
  ];
  for (const sourceText of rejectedSources) assertFailsClosed(resolve(sourceText));

  const singleQuoted = resolve("import test from 'node:test';\ntest('selected test', () => {});\n", {
    target: { name: "  selected test  " }
  });
  const doubleQuoted = resolve('import test from "node:test";\ntest("selected test", () => {});\n');
  for (const result of [singleQuoted, doubleQuoted]) {
    assert.equal(result.target_resolution_status, "resolved");
    assert.equal(result.target_resolution_target.name, "selected test");
  }
});

test("validates target names before treating create operations as not applicable", () => {
  const validCreate = resolve(supportedSource(), { target: { operation: "create" } });
  assert.equal(validCreate.target_resolution_status, "not_applicable");

  const missingCreate = resolveBoundedJavaScriptTestCaseTargetFromSourceText({
    sourceText: supportedSource(),
    target: {
      path: "packages/wiki-core/src/lib/sample.test.mjs",
      kind: "test_case",
      operation: "create"
    }
  });
  const invalidCreate = resolve(supportedSource(), { target: { name: false, operation: "create" } });
  for (const result of [missingCreate, invalidCreate]) {
    assertFailsClosed(result);
    assert.equal(result.target_resolution_status, "provider_unavailable");
    assert.equal(result.target_resolution_status_reason, "declared target name was missing or unsupported");
    assert.deepEqual(result.target_resolution_provider, { id: null, version: null, mode: "unavailable" });
    assert.deepEqual(result.target_resolution_candidates, []);
  }
});

test("preserves create, modify, delete, and inspect operation controls", () => {
  const expectedStatuses = new Map([
    ["create", "not_applicable"],
    ["modify", "resolved"],
    ["delete", "resolved"],
    ["inspect", "resolved"]
  ]);
  for (const [operation, expectedStatus] of expectedStatuses) {
    const result = resolve(supportedSource(), { target: { operation } });
    assert.equal(result.target_resolution_status, expectedStatus);
    assert.equal(result.target_resolution_evidence_status, "present");
    assert.deepEqual(result.target_resolution_provider, WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER);
    assert.equal(result.target_resolution_target.operation, operation);
  }
});

test("returns ambiguous evidence for duplicate matching top-level test names", () => {
  const result = resolve('import test from "node:test";\ntest("selected test", () => {});\ntest("selected test", () => {});\n');
  assert.equal(result.target_resolution_status, "ambiguous");
  assert.equal(result.target_resolution_evidence_status, "partial");
  assert.deepEqual(result.target_resolution_span, { start_line: 2, end_line: 3, line_count: 2 });
  assert.equal(result.target_resolution_candidates.length, 2);
  assert.deepEqual(result.target_resolution_fanout, { direct_reference_count: 2, affected_symbol_count: 2 });
});

test("fails closed for missing source and non-test repository paths", () => {
  const missing = resolve(undefined);
  assert.equal(missing.target_resolution_status, "provider_unavailable");
  assertFailsClosed(missing);

  const nonTestPath = resolve('import test from "node:test";\ntest("selected test", () => {});\n', {
    target: { path: "packages/wiki-core/src/lib/sample.mjs" }
  });
  assert.equal(nonTestPath.target_resolution_status, "provider_unavailable");
  assertFailsClosed(nonTestPath);
});

test("fails closed for noncanonical test paths through the direct parser helper", () => {

  const supported = 'import test from "node:test";\ntest("selected test", () => {});\n';
  const rejectedPaths = [
    "C:/repo/example.test.mjs",
    "C:\\repo\\example.test.mjs",
    "\\\\server\\share\\example.test.mjs",
    "/absolute/example.test.mjs",
    "../example.test.mjs",
    "packages/../../example.test.mjs",
    "packages/./example.test.mjs",
    "packages//example.test.mjs",
    "packages\\wiki-core\\example.test.mjs",
    "  packages/wiki-core/example.test.mjs  ",
    "\tpackages/wiki-core/example.test.mjs",
    "packages/wiki-core/example.test.mjs\n",
    `packages/wiki-core/name${String.fromCharCode(0)}.test.mjs`,
    "packages/wiki-core/example.js",
    "packages/wiki-core/example.mjs",
    "packages/wiki-core/example.test.ts"
  ];
  for (const badPath of rejectedPaths) {
    const result = resolve(supported, { target: { path: badPath } });
    assert.equal(result.target_resolution_status, "provider_unavailable", JSON.stringify(badPath));
    assert.deepEqual(result.target_resolution_provider, { id: null, version: null, mode: "unavailable" }, JSON.stringify(badPath));
    assertFailsClosed(result);
  }

  for (const badPath of [42, true, {}, [], "", "   "]) {
    assertFailsClosed(resolve(supported, { target: { path: badPath } }));
  }

  for (const goodPath of [
    "packages/wiki-core/src/lib/example.test.mjs",
    "packages/wiki-core/src/lib/example.test.js",
    "example.test.mjs"
  ]) {
    const result = resolve(supported, { target: { path: goodPath } });
    assert.equal(result.target_resolution_status, "resolved", goodPath);
    assert.equal(result.target_resolution_target.path, goodPath, goodPath);
  }
});

test("rejects malformed import spoofs and regex or string pseudo-imports", () => {
  const cases = [
    'import test from node:test;\ntest("selected test", () => {});\n',
    'const spoof = /import test from "node:test"/;\ntest("selected test", () => {});\n',
    'const spoof = "import test from \\\"node:test\\\"";\ntest("selected test", () => {});\n',
    'import { test as scenario } from "node:\\x74est";\nscenario("selected test", () => {});\n'
  ];
  for (const sourceText of cases) assertFailsClosed(resolve(sourceText));
});

test("returns the canonical unavailable provider for every provider_unavailable fail-closed family", () => {
  const good = 'import test from "node:test";\ntest("selected test", () => {});\n';
  const families = {
    "missing source": resolve(undefined),
    "blank source": resolve("   \n  "),
    "invalid absolute path": resolve(good, { target: { path: "/etc/passwd" } }),
    "non-repository parent-escape path": resolve(good, { target: { path: "../outside/sample.test.mjs" } }),
    "non-test repository path": resolve(good, { target: { path: "packages/wiki-core/src/lib/sample.mjs" } }),
    "global test call (no node:test binding)": resolve('test("selected test", () => {});\n'),
    "dynamic import binding": resolve('const { test } = await import("node:test");\ntest("selected test", () => {});\n'),
    "require binding": resolve('const test = require("node:test");\ntest("selected test", () => {});\n'),
    "unsupported named alias": resolve('import { describe as test } from "node:test";\ntest("selected test", () => {});\n'),
    "namespace import binding": resolve('import * as test from "node:test";\ntest("selected test", () => {});\n'),
    "module-scope binding conflict": resolve('import test from "node:test";\nconst test = () => {};\ntest("selected test", () => {});\n'),
    "parser failure on unparseable source": resolve('import test from "node:test";\ntest("selected test", () => {\n'),
    "missing operation": resolve(good, { target: { operation: undefined } }),
    "unsupported operation": resolve(good, { target: { operation: "execute" } }),
    "missing name": resolve(good, { target: { name: undefined } }),
    "non-string name": resolve(good, { target: { name: 17 } })
  };
  for (const [family, result] of Object.entries(families)) {
    assertProviderUnavailable(result, family);
    assert.equal(result.target_resolution_fanout, null, family);
    assert.deepEqual(result.target_resolution_candidates, [], family);
  }
});

test("provider_unavailable evidence never inherits caller-supplied provider, status, reason, span, or provenance", () => {
  const result = resolve('test("selected test", () => {});\n', {
    provider: { id: "caller.provider", version: "999", mode: "local" },
    target_resolution_provider: { id: "spoofed.provider", version: "spoof", mode: "local" },
    target_resolution_status: "resolved",
    target_resolution_status_reason: "caller claims resolved",
    target_resolution_span: { start_line: 1, end_line: 1, line_count: 1 },
    facet_provenance: { span: "authored_record" }
  });
  assertProviderUnavailable(result, "caller-spoofed provider_unavailable");
  assert.equal(result.target_resolution_status_reason, "no supported explicit node:test binding was found");
});

test("supported resolved and ambiguous outcomes keep their locally minted provider identity", () => {
  const resolved = resolve('import test from "node:test";\ntest("selected test", () => {});\n', {
    provider: { id: "caller.provider", version: "999", mode: "remote" }
  });
  assert.equal(resolved.target_resolution_status, "resolved");
  assert.equal(resolved.target_resolution_evidence_status, "present");
  assert.deepEqual(resolved.target_resolution_provider, WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER);
  assert.deepEqual(resolved.target_resolution_span, { start_line: 2, end_line: 2, line_count: 1 });

  const ambiguous = resolve('import test from "node:test";\ntest("selected test", () => {});\ntest("selected test", () => {});\n', {
    provider: { id: "caller.provider", version: "999", mode: "remote" }
  });
  assert.equal(ambiguous.target_resolution_status, "ambiguous");
  assert.equal(ambiguous.target_resolution_evidence_status, "partial");
  assert.deepEqual(ambiguous.target_resolution_provider, WORK_RECORD_TARGET_TEST_CASE_RESOLVER_PROVIDER);
  assert.equal(ambiguous.target_resolution_candidates.length, 2);
});
