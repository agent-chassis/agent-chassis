

import assert from "node:assert/strict";
import test from "node:test";

import {
  isTestProofSourcePath,
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
