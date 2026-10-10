

import assert from "node:assert/strict";
import test from "node:test";

import { NATIVE_TEST_CASE_AUTHORING_GUIDANCE } from
  "../../packages/controlled-contract/lib/native-test-proof-authoring.mjs";
import {
  TEST_PROOF_PROVIDER_AUTHORING_FACTS,
  authoredNativeTestSelector,
  isTestProofSourcePath,
  resolveAuthoredNativeTestTarget,
  resolveNativeTestSelector,
  testProofSelectorKind,
  testRuntimeRunner
} from "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";

const select = (providerId, nodeId, options = {}) => resolveNativeTestSelector(
  { provider_id: providerId, provider_version: "1.0.0", node_id: nodeId }, options);
const refused = (result, pointer) => {
  assert.equal(result.valid, false, JSON.stringify(result));
  assert.equal(result.code, "stable_test_proof_selector_invalid");
  assert.equal(result.pointer, pointer);
};

test("native selectors require exact registered provider and target identity", () => {
  const exact = select("launcher.jest", 'web/a.test.ts::["suite","case"]', { path: "web/a.test.ts" });
  assert.deepEqual([exact.valid, exact.selector_kind, exact.path, exact.selection],
    [true, "jest_title_path", "web/a.test.ts", { title_path: ["suite", "case"] }]);
  assert.deepEqual(select("launcher.go-test", "calc/a_test.go::TestAnswer").selection,
    { identifier_path: ["TestAnswer"] });
  assert.deepEqual(select("launcher.cargo-test", "src/calc.rs::tests::answer").selection,
    { identifier_path: ["tests", "answer"] });
  assert.deepEqual(select("launcher.stestr", "unit/test_a.py::A.test_b").selection,
    { identifier_path: ["A", "test_b"] });

  refused(select("launcher.unknown", "a.test.ts::[\"x\"]"), "/test_selector/provider_id");
  refused(select("runner.jest", "a.test.ts::[\"x\"]"), "/test_selector/provider_id");
  refused(select("launcher.jest-scalar-return", "a.test.ts::[\"x\"]"), "/test_selector/provider_id");
  refused(resolveNativeTestSelector({ provider_id: "launcher.jest", provider_version: "2.0.0",
    node_id: "a.test.ts::[\"x\"]" }), "/test_selector/provider_version");
  refused(resolveNativeTestSelector({ provider_id: "launcher.jest", node_id: "a.test.ts::[\"x\"]" }),
    "/test_selector");
  refused(resolveNativeTestSelector({ provider_id: "launcher.jest", provider_version: "1.0.0",
    node_id: "a.test.ts::[\"x\"]", command: "jest" }), "/test_selector");
  for (const nodeId of [
    'a.test.ts::[ "x"]', 'a.test.ts::[]', "a.test.ts::x", 'a.py::["x"]', '../a.test.ts::["x"]',
    '/abs.test.ts::["x"]', 'a/./b.test.ts::["x"]', `a.test.ts::${JSON.stringify(Array(33).fill("x"))}`,
    'a.test.ts::["x",1]'
  ]) refused(select("launcher.jest", nodeId), "/test_selector/node_id");
  refused(select("launcher.jest", 'a.test.ts::["x"]', { path: "b.test.ts" }), "/test_selector/node_id");
  for (const nodeId of ["calc/a_test.go::testAnswer", "calc/a.go::TestAnswer", "calc/a_test.go::TestA/sub"]) {
    refused(select("launcher.go-test", nodeId), "/test_selector/node_id");
  }
  for (const nodeId of ["tests/a.rs::", "tests/a.rs::a:b", "tests/a.rs::a::1b", "tests/a.py::a"]) {
    refused(select("launcher.cargo-test", nodeId), "/test_selector/node_id");
  }
  for (const nodeId of ["unit/test_a.py::A.test;rm", "unit/test_a.py::", "unit/test_a.ts::A.b"]) {
    refused(select("launcher.stestr", nodeId), "/test_selector/node_id");
  }

  assert.equal(testProofSelectorKind({ provider_id: "runner.pytest", node_id: "x" }), null);
  assert.equal(testProofSelectorKind({ provider_id: "launcher.pytest", node_id: "x" }), "pytest_node_id");
  assert.equal(testProofSelectorKind({ provider_id: "launcher.vitest", node_id: "x" }), "vitest_title_path");
  assert.equal(testProofSelectorKind({ name: "x", nesting: 0 }), "node_test_name");
  assert.equal(testRuntimeRunner({ name: "vitest" }).runner_id, "runner.vitest");
  assert.equal(testRuntimeRunner({ runnerId: "vitest" }), null);
  assert.equal(isTestProofSourcePath("go_test_name", "calc/answer.go"), true);
  assert.equal(isTestProofSourcePath("go_test_name", "calc/answer.rs"), false);
  assert.equal(isTestProofSourcePath("jest_title_path", "src/answer.py"), false);
});

const TITLE_PATH_FAMILIES = ["jest", "vitest", "mocha", "ava", "deno", "lib0-testing"];
const SOURCE = { ava: "test/a.test.ts", deno: "mod_test.ts", jest: "web/a.test.ts" };

const composed = (family, titles) => `${SOURCE[family]}::${JSON.stringify(titles)}`;
const delivered = (family, nodeId) => JSON.parse(JSON.stringify({ test_selector: {
  provider_id: `launcher.${family}`, provider_version: "1.0.0", node_id: nodeId } })).test_selector;

const provider = (family) => ({ provider_id: `launcher.${family}`, provider_version: "1.0.0" });
const authoredTarget = (family, path, selector) => ({ provider: provider(family), path, selector });

test("title-path families publish title_path as their authored selector and no node_id form", () => {
  const facts = Object.fromEntries(TEST_PROOF_PROVIDER_AUTHORING_FACTS.map((family) => [family.family_id, family]));
  const guidance = NATIVE_TEST_CASE_AUTHORING_GUIDANCE;
  assert.deepEqual(TITLE_PATH_FAMILIES.filter((family) => !Object.hasOwn(facts, family)), []);
  for (const [family, fact] of Object.entries(facts)) {
    const published = guidance.families[family];
    assert.doesNotMatch(JSON.stringify([fact.selector, published]), /node_id_encoding|JSON\.stringify|backslash/u,
      `${family} states no serialization`);
    if (!TITLE_PATH_FAMILIES.includes(family)) {

      assert.equal(Object.hasOwn(fact.selector, "authored"), false, family);
      assert.equal(published.node_id_form, fact.selector.node_id_form ?? undefined, family);
      assert.equal(published.target_variant, fact.selector.provider_qualified ? "provider_qualified" : "node_test");
      continue;
    }
    assert.equal(fact.selector.authored.member, "title_path", family);

    assert.match(fact.selector.node_id_form, /::<canonical JSON array /u, family);
    assert.equal(Object.hasOwn(published, "node_id_form"), false, family);
    assert.doesNotMatch(JSON.stringify(published), /node_id/u, family);

    assert.equal(published.title_path_form, fact.selector.authored.form, family);
    assert.doesNotMatch(published.title_path_form, /node_id|::|canonical JSON/u, family);
    assert.equal(published.target_variant, "provider_title_path", family);
  }
  assert.deepEqual(guidance.target_variants.provider_title_path.fields,
    ["provider.provider_id", "provider.provider_version", "path", "selector.title_path"]);
  assert.deepEqual(guidance.target_variants.provider_qualified.fields,
    ["provider.provider_id", "provider.provider_version", "path", "selector.node_id"]);
  assert.deepEqual([guidance.families.ava.title_path_form, guidance.families.deno.title_path_form,
    guidance.families["lib0-testing"].title_path_form, guidance.families.jest.title_path_form].map((form) =>
    form.split(";")[0]), ["array holding the one literal test title", "array holding the one literal Deno.test name",
    "array [runTests module key, test function name]", "array of 1..32 literal titles"]);
  assert.deepEqual([guidance.families["go-test"].node_id_form, guidance.families.pytest.node_id_form],
    [facts["go-test"].selector.node_id_form, facts.pytest.selector.node_id_form]);
  assert.equal(guidance.families["go-test"].node_id_form,
    "<normalized repository-relative *_test.go path>::<top-level TestXxx function>");
});

test("structured title authoring preserves canonical native selector identity", () => {
  const hard = ['says "hello"', "back\\slash \\\" both", "caf\u00e9 \u6f22\u5b57 \ud83e\uddea", "a::b", "plain"];
  const corpus = [
    ["jest", "web/a.test.ts", ["suite", ...hard]],
    ["vitest", "web/nested/a.test.mts", [...hard].reverse()],
    ["mocha", "test/clamp.test.ts", ["clamp", "preserves in-range values"]],
    ["mocha", "test/clamp.test.ts", ["dup", "dup", hard[1]]],
    ...hard.map((title) => ["ava", "test/a.test.ts", [title]]),
    ...hard.map((title) => ["deno", "mod_test.ts", [title]]),
    ["lib0-testing", "tests/index.mjs", [hard[0], "testReturns42"]],
    ["lib0-testing", "tests/index.js", [hard[2], "benchmark$1"]]
  ];
  assert.deepEqual([...new Set(corpus.map(([family]) => family))].sort(), [...TITLE_PATH_FAMILIES].sort());
  for (const [family, path, titles] of corpus) {
    const label = `${family} ${JSON.stringify(titles)}`;

    const authored = resolveAuthoredNativeTestTarget(JSON.parse(JSON.stringify(
      authoredTarget(family, path, { title_path: titles }))));
    assert.equal(authored.valid, true, `${label} ${JSON.stringify(authored)}`);

    assert.equal(authored.node_id, `${path}::${JSON.stringify(titles)}`, label);
    const canonical = resolveNativeTestSelector({ ...provider(family), node_id: authored.node_id }, { path });
    assert.equal(canonical.valid, true, label);
    assert.deepEqual([authored.selector_kind, authored.provider_id, authored.provider_version, authored.path,
      authored.selection], [canonical.selector_kind, canonical.provider_id, canonical.provider_version, path,
      { title_path: titles }], label);

    assert.deepEqual(authoredNativeTestSelector({ ...provider(family), node_id: authored.node_id }),
      { title_path: titles }, label);
  }

  for (const [family, path, nodeId] of [["go-test", "calc/a_test.go", "calc/a_test.go::TestAnswer"],
    ["pytest", "tests/test_a.py", "tests/test_a.py::test_answer[42]"],
    ["cargo-test", "src/calc.rs", "src/calc.rs::tests::answer"], ["stestr", "unit/test_a.py", "unit/test_a.py::A.test_b"]]) {
    const literal = resolveAuthoredNativeTestTarget(authoredTarget(family, path, { node_id: nodeId }));
    assert.deepEqual([literal.valid, literal.node_id, literal.path], [true, nodeId, path], family);
    assert.deepEqual(authoredNativeTestSelector({ ...provider(family), node_id: nodeId }), { node_id: nodeId });
    refused(resolveAuthoredNativeTestTarget(authoredTarget(family, path, { title_path: ["TestAnswer"] })),
      "/target/selector/title_path");
  }

  const obsolete = resolveAuthoredNativeTestTarget(authoredTarget("jest", "web/a.test.ts",
    { node_id: 'web/a.test.ts::["suite","case"]' }));
  refused(obsolete, "/target/selector/node_id");
  assert.match(obsolete.expected_identity, /^selector\.title_path: /u);
  refused(resolveAuthoredNativeTestTarget(authoredTarget("jest", "web/a.test.ts",
    { title_path: ["suite", "case"], node_id: 'web/a.test.ts::["suite","case"]' })), "/target/selector/node_id");
  refused(resolveAuthoredNativeTestTarget(authoredTarget("jest", "web/a.test.ts", {})), "/target/selector/title_path");

  for (const [family, path, titles] of [["ava", "test/a.test.ts", ["suite", "case"]], ["deno", "mod_test.ts", []],
    ["lib0-testing", "tests/index.mjs", ["answer", "returns42"]], ["lib0-testing", "tests/index.mjs", ["testReturns42"]],
    ["jest", "web/a.test.ts", Array(33).fill("x")], ["jest", "web/a.test.ts", ["x", 1]], ["jest", "web/a.test.ts", [""]],
    ["jest", "web/a.test.ts", ["line\nbreak"]], ["jest", "web/a.test.ts", ["x".repeat(1025)]],
    ["jest", "web/a.test.ts", "suite"], ["mocha", "web/a.test.ts", ["lone \ud800"]]]) {
    const result = resolveAuthoredNativeTestTarget(authoredTarget(family, path, { title_path: titles }));
    refused(result, "/target/selector/title_path");
    assert.equal(result.expected_identity, NATIVE_TEST_CASE_AUTHORING_GUIDANCE.families[family].title_path_form,
      `${family} ${JSON.stringify(titles).slice(0, 60)}`);
  }
  for (const [family, path] of [["jest", "web/a.py"], ["jest", "../a.test.ts"], ["lib0-testing", "tests/index.ts"],
    ["deno", "mod_test.cjs"], ["jest", "/abs/a.test.ts"]]) {
    refused(resolveAuthoredNativeTestTarget(authoredTarget(family, path, { title_path: ["a", "testB"].slice(
      family === "deno" ? 1 : 0) })), "/target/path");
  }
  refused(resolveAuthoredNativeTestTarget(authoredTarget("jest-scalar-return", "web/a.test.ts", { title_path: ["a"] })),
    "/target/provider/provider_id");
  refused(resolveAuthoredNativeTestTarget({ ...authoredTarget("jest", "web/a.test.ts", { title_path: ["a"] }),
    provider: { provider_id: "launcher.jest", provider_version: "2.0.0" } }), "/target/provider/provider_version");

  const at = (titles) => resolveAuthoredNativeTestTarget(authoredTarget("jest", "a.test.ts", { title_path: titles }));
  const fits = ["x".repeat(1024), "x".repeat(1024), "x".repeat(1024), "x".repeat(1000)];
  assert.equal([...`a.test.ts::${JSON.stringify(fits)}`].length, 4096);
  assert.equal(at(fits).valid, true);
  const over = at([...fits.slice(0, 3), "x".repeat(1001)]);
  refused(over, "/target/selector/title_path");
  assert.match(over.expected_identity, /4096 Unicode scalars/u);
  assert.doesNotMatch(over.expected_identity, /node_id|JSON/u);
  const quoted = ['"'.repeat(1024), '"'.repeat(1024)];
  assert.equal(at(quoted.map((title) => title.replaceAll('"', "q"))).valid, true);
  refused(at(quoted), "/target/selector/title_path");
});

test("a composed title-path node_id survives the request's JSON and a pre-escaped one stays refused", () => {
  const titles = ['says "hello"', 'back\\slash \\" both', "caf\u00e9 \u6f22\u5b57 \ud83e\uddea", "plain"];
  for (const family of ["ava", "deno"]) {
    for (const title of titles) {
      const nodeId = composed(family, [title]);
      const selected = resolveNativeTestSelector(delivered(family, nodeId));
      assert.deepEqual([selected.valid, selected.path, selected.selection],
        [true, SOURCE[family], { title_path: [title] }], `${family} ${title}`);

      const preEscaped = `${SOURCE[family]}::${JSON.stringify([title]).replace(/^\["/u, '[\\"').replace(/"\]$/u, '\\"]')}`;
      assert.notEqual(preEscaped, nodeId);
      refused(resolveNativeTestSelector(delivered(family, preEscaped)), "/test_selector/node_id");
      refused(select(`launcher.${family}`, JSON.stringify(nodeId).slice(1, -1)), "/test_selector/node_id");
    }

    refused(select(`launcher.${family}`, `${SOURCE[family]}::[ "plain"]`), "/test_selector/node_id");
    refused(select(`launcher.${family}`, `${SOURCE[family]}::["caf\\u00e9"]`), "/test_selector/node_id");
    refused(select(`launcher.${family}`, composed(family, ["suite", "case"])), "/test_selector/node_id");
    refused(select(`launcher.${family}`, composed(family, [])), "/test_selector/node_id");
  }

  const nested = resolveNativeTestSelector(delivered("jest", composed("jest", titles)));
  assert.deepEqual(nested.selection, { title_path: titles });
  refused(select("launcher.jest", composed("jest", Array(33).fill("x"))), "/test_selector/node_id");
});
