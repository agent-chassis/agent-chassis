

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  authenticateNativeEvents,
  nativeNodeId,
  projectNativeObservation,
  readNativeObservation
} from "../../packages/agent-launch-cli/src/lib/test-execution/native-observation.mjs";

const NONCE = "a".repeat(64);
const FILE = "project/answer.test.mjs";
const SELECTED = ["answer", "returns 42"];
const SIBLING = ["answer", "sibling"];
const IDENTITY = Object.freeze({ kind: "json_title_path" });
const NODE_ID = nativeNodeId(FILE, SELECTED, IDENTITY);

function stream(records, { nonce = NONCE } = {}) {
  const seq = new Map();
  return Buffer.from(records.map((record) => {
    const src = record.src ?? "main";
    const next = seq.get(src) ?? 0;
    seq.set(src, next + 1);
    return `${JSON.stringify({ v: 1, nonce, src, seq: next, ...record })}\n`;
  }).join(""));
}

function expectation(overrides = {}) {
  return { capability: "candidate_execution", family_id: "jest", provider_id: "launcher.jest",
    provider_version: "1.0.0", candidate_mechanism: "jest_circus_events", identity_format: IDENTITY,
    completion: "session_end", window_start: "test_start", declared_node_ids: [],
    attempt_nonce: NONCE, node_id: NODE_ID, target: FILE, target_test_id: `test-${"b".repeat(64)}`,
    runtime_inputs_digest: `sha256:${"c".repeat(64)}`, ...overrides };
}

const passingRun = (extra = []) => [
  { kind: "session_start", runner: { name: "jest" } },
  { kind: "collected", file: FILE, test: SELECTED },
  { kind: "collected", file: FILE, test: SIBLING },
  { kind: "test_result", file: FILE, test: SIBLING, outcome: "skipped", assertion_failure: false },
  { kind: "test_start", file: FILE, test: SELECTED },
  ...extra,
  { kind: "test_result", file: FILE, test: SELECTED, outcome: "passed", assertion_failure: false },
  { kind: "session_end" }
];

test("the record stream is authenticated before anything is read", () => {
  const exp = expectation();
  assert.equal(authenticateNativeEvents({ channelBytes: stream(passingRun()), expectation: exp }).valid, true);
  assert.equal(authenticateNativeEvents({ channelBytes: stream(passingRun(), { nonce: "d".repeat(64) }),
    expectation: exp }).code, "test_proof_structured_events_cross_attempt");
  assert.equal(authenticateNativeEvents({ channelBytes: Buffer.alloc(0), expectation: exp,
    channelOverflow: true }).code, "test_proof_structured_events_oversized");
  const bytes = stream(passingRun());
  assert.equal(authenticateNativeEvents({ channelBytes: bytes.subarray(0, bytes.length - 3),
    expectation: exp }).code, "test_proof_structured_events_invalid", "a torn final record");
  const skipped = bytes.toString("utf8").split("\n");
  skipped.splice(1, 1);
  assert.equal(authenticateNativeEvents({ channelBytes: Buffer.from(skipped.join("\n")), expectation: exp })
    .code, "test_proof_structured_events_lifecycle_invalid", "a missing sequence number");
  const forged = `${JSON.stringify({ v: 1, nonce: NONCE, src: "main", seq: 0, kind: "test_result",
    test: SELECTED, outcome: "passed" })}\n`;
  assert.equal(authenticateNativeEvents({ channelBytes: Buffer.from(forged), expectation: exp }).code,
    "test_proof_structured_events_invalid", "a record without its closed fields");
  assert.equal(authenticateNativeEvents({ channelBytes: "not bytes", expectation: exp }).code,
    "test_proof_structured_events_invalid");
});

test("only the exact selected test may execute and must complete", () => {
  const exp = expectation();
  const read = (records, exitCode = 0, overrides = {}) => readNativeObservation({
    channelBytes: stream(records), exitCode, expectation: { ...exp, ...overrides } });
  const passed = read(passingRun());
  assert.equal(passed.valid, true);
  assert.deepEqual(passed.executed_node_ids, [NODE_ID]);
  assert.deepEqual(passed.discovered_node_ids, [NODE_ID, nativeNodeId(FILE, SIBLING, IDENTITY)].sort());

  const sibling = passingRun();
  sibling.splice(3, 1, { kind: "test_start", file: FILE, test: SIBLING });
  assert.equal(read(sibling).code, "test_proof_structured_events_unselected_execution");
  assert.equal(read(passingRun().slice(0, -1)).code, "test_proof_structured_test_inventory_incomplete");
  assert.equal(read(passingRun(), 1).code, "test_proof_structured_events_exit_status_mismatch",
    "a passing result cannot come from a failing process");
  const duplicate = passingRun();
  duplicate.splice(2, 0, { kind: "collected", file: FILE, test: SELECTED });
  assert.equal(read(duplicate).code, "test_proof_structured_test_identity_duplicate");
  const afterEnd = [...passingRun(), { kind: "collected", file: FILE, test: SIBLING }];
  assert.equal(read(afterEnd).code, "test_proof_structured_events_lifecycle_invalid");

  const nothingRan = [
    ...passingRun().slice(0, 4),
    { kind: "test_result", file: FILE, test: SELECTED, outcome: "skipped", assertion_failure: false },
    { kind: "session_end" }
  ];
  const missing = read(nothingRan, 0, { node_id: nativeNodeId(FILE, ["answer", "absent"], IDENTITY) });
  assert.equal(missing.code, "test_proof_selected_identity_not_observed");
  assert.equal(missing.detail.observed_count, 2);
  assert.equal(read([{ kind: "runtime_error", code: "test_proof_native_selection_unsupported",
    message: "no" }]).code, "test_proof_native_selection_unsupported");
  assert.equal(read([{ kind: "runtime_error", code: "anything_else" }]).code,
    "test_proof_structured_events_invalid", "an observer cannot choose an arbitrary result code");

  const explicit = { window_start: "explicit" };
  const early = passingRun([{ kind: "window_end", file: FILE, test: SELECTED }]);
  assert.equal(read(early, 0, explicit).code, "test_proof_structured_events_lifecycle_invalid");
  assert.equal(read(passingRun([{ kind: "window_start", file: FILE, test: SELECTED }])).code,
    "test_proof_structured_events_lifecycle_invalid", "only explicit-window providers open windows");
});

test("falsifier and traversal credit comes only from launcher-credentialed probes in the selected window", (t) => {
  const worktree = mkdtempSync(path.join(tmpdir(), "native-observation-"));
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  const source = "export function answer() { return 42; }\n";
  writeFileSync(path.join(worktree, "answer.mjs"), source);
  const digest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  const MUTATED = "1".repeat(32);
  const HELPER = "2".repeat(32);
  const instrumentation = { module_path: "answer.mjs", source_digest: digest, function_name: "answer",
    original: 42, original_kind: "integer", replacement: 41, replacement_kind: "integer",
    functions: [{ name: "answer", line: 1 }, { name: "helper", line: 2 }],
    probes: [{ token: MUTATED, function_name: "answer", line: 1, mutated: true },
      { token: HELPER, function_name: "helper", line: 2, mutated: false }] };
  const reach = (mutated) => ({ kind: "reach", token: mutated ? MUTATED : HELPER });
  const failingRun = (extra, assertion = true) => [
    { kind: "session_start" },
    { kind: "collected", file: FILE, test: SELECTED },
    ...extra.before ?? [],
    { kind: "test_start", file: FILE, test: SELECTED },
    ...extra.inside ?? [],
    { kind: "test_result", file: FILE, test: SELECTED, outcome: "failed", assertion_failure: assertion,
      error: { name: "AssertionError", message: "41 !== 42" } },
    { kind: "session_end" }
  ];
  const falsifier = expectation({ capability: "falsifier_execution", worktree, instrumentation,
    mutation_id: "mutation-native", failure_reason_code: "test_proof_fault.result_inversion.v1",
    observation_seam: "jest_selected_test_body_failure" });
  const project = (records, exp = falsifier, exitCode = 1) => projectNativeObservation({
    channelBytes: stream(records), exitCode, expectation: exp });

  const detected = project(failingRun({ inside: [reach(true)] }));
  assert.equal(detected.mutation_observed, true);
  assert.equal(detected.mutation.mutated_entries_in_window, 1);
  assert.equal(detected.mutation.selected_outcome, "failed");

  const outside = project(failingRun({ before: [reach(true)] }));
  assert.equal(outside.mutation_observed, false, "an import-time or sibling reach is not detection");
  assert.equal(outside.mutation.mutated_entries_in_window, 0);
  assert.equal(project(failingRun({ inside: [reach(false)] })).mutation_observed, false,
    "an unmutated function entry is not the declared mutation");
  assert.equal(project(failingRun({ inside: [reach(true)] }, false)).mutation_observed, false,
    "a non-assertion failure is not detection");

  assert.equal(project(failingRun({ inside: [{ kind: "reach", token: "3".repeat(32) }] })).code,
    "test_proof_structured_events_reach_unauthenticated");
  assert.equal(project(failingRun({ inside: [{ kind: "reach", token: HELPER, mutated: true,
    function_name: "answer" }] })).mutation_observed, false);
  for (const forged of [{ kind: "reach", module_path: "answer.mjs", function_name: "answer", line: 1,
    mutated: true }, { kind: "reach", token: "answer.mjs" }]) {
    assert.equal(project(failingRun({ inside: [forged] })).code, "test_proof_structured_events_invalid");
  }

  const traversal = expectation({ capability: "boundary_traversal", worktree, instrumentation,
    observation_seam: "jest_selected_test_body" });
  const traversed = project(passingRun([reach(false)]), traversal, 0);
  assert.equal(traversed.traversal_observed, true);
  const notTraversed = project([...passingRun().slice(0, 1), reach(false), ...passingRun().slice(1)],
    traversal, 0);
  assert.equal(notTraversed.traversal_observed, false, "a reach before the selected test is not traversal");
  assert.equal(project(passingRun([{ kind: "reach", token: "4".repeat(32) }]), traversal, 0).code,
    "test_proof_structured_events_reach_unauthenticated");

  writeFileSync(path.join(worktree, "answer.mjs"), `${source}// moved\n`);
  assert.equal(project(failingRun({ inside: [reach(true)] })).code,
    "test_proof_structured_events_source_mismatch", "evidence stays bound to the instrumented source");
});

test("native node identities use the provider's closed spelling", () => {
  assert.equal(nativeNodeId("a.test.ts", ["x", "y"], IDENTITY), 'a.test.ts::["x","y"]');
  assert.equal(nativeNodeId("pkg/a_test.go", ["TestX"], { kind: "joined", separator: "/" }),
    "pkg/a_test.go::TestX");
  assert.equal(nativeNodeId("tests/a.rs", ["m", "t"], { kind: "joined", separator: "::" }),
    "tests/a.rs::m::t");
});
