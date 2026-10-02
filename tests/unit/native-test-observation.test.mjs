

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
import { captureTestFailureDiagnostic, isLauncherTestFailureDiagnostic, nativeRecordFailureDiagnostic,
  unavailableTestFailureDiagnostic } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-error-diagnostic.mjs";
import { createNativeReportObserver } from
  "../../packages/agent-launch-cli/src/lib/test-execution/confined-capture.mjs";
import { goTestReport } from "../../packages/agent-launch-cli/src/lib/test-execution/proof-providers/go-test.mjs";
import { cargoTestReport } from
  "../../packages/agent-launch-cli/src/lib/test-execution/proof-providers/cargo-test.mjs";
import { denoTestReport } from "../../packages/agent-launch-cli/src/lib/test-execution/proof-providers/deno.mjs";

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

  assert.deepEqual(read(sibling), { valid: false, code: "test_proof_structured_events_unselected_execution",
    detail: { provider_id: "launcher.jest", provider_version: "1.0.0", selected_node_id: NODE_ID,
      record_kind: "test_start", observed_node_id: nativeNodeId(FILE, SIBLING, IDENTITY), writer: "main",
      sequence: 3, record_index: 3, record_count: 7 } });
  const unselectedResult = passingRun();
  unselectedResult.splice(3, 1, { kind: "test_result", file: FILE, test: SIBLING, outcome: "passed",
    assertion_failure: false, src: "worker" });
  assert.deepEqual(read(unselectedResult).detail, { provider_id: "launcher.jest", provider_version: "1.0.0",
    selected_node_id: NODE_ID, record_kind: "test_result", observed_node_id: nativeNodeId(FILE, SIBLING, IDENTITY),
    observed_outcome: "passed", writer: "worker", sequence: 0, record_index: 3, record_count: 7 });
  assert.equal(read(passingRun().slice(0, -1)).code, "test_proof_structured_test_inventory_incomplete");
  assert.deepEqual(read(passingRun(), 1), { valid: false,
    code: "test_proof_structured_events_exit_status_mismatch",
    detail: { provider_id: "launcher.jest", provider_version: "1.0.0", selected_node_id: NODE_ID,
      selected_outcome: "passed", exit_code: 1, record_count: 7 } },
  "a passing result cannot come from a failing process");
  const duplicate = passingRun();
  duplicate.splice(2, 0, { kind: "collected", file: FILE, test: SELECTED });
  assert.equal(read(duplicate).code, "test_proof_structured_test_identity_duplicate");
  assert.equal(read(duplicate).detail.record_index, 2);
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
      failure_diagnostic: captureTestFailureDiagnostic(Object.assign(new Error("41 !== 42"),
        { name: "AssertionError" })) },
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

const failedRun = (diagnostic, { assertion = true, extra = [], end = { kind: "session_end" } } = {}) => [
  { kind: "session_start" },
  { kind: "collected", file: FILE, test: SELECTED },
  { kind: "test_start", file: FILE, test: SELECTED },
  ...extra,
  { kind: "test_result", file: FILE, test: SELECTED, outcome: "failed", assertion_failure: assertion,
    ...(diagnostic === undefined ? {} : { failure_diagnostic: diagnostic }) },
  end
];

test("a failed selected result carries its validated graph unchanged to the selected event", () => {
  const assertion = Object.assign(new Error("expected 41 to be 42"), { name: "AssertionError",
    expected: 42, actual: 41, cause: new RangeError("inner cause") });
  const diagnostic = captureTestFailureDiagnostic(assertion, { location: { file: FILE, line: 7, column: 3 },
    details: [{ label: "diff", text: "- 41\n+ 42" }], origin: { kind: "hook", name: "afterEach" } });
  const observed = projectNativeObservation({ channelBytes: stream(failedRun(diagnostic)), exitCode: 1,
    expectation: expectation() });
  assert.equal(observed.valid, true);
  const [event] = observed.structured_result.fail_events;
  assert.deepEqual(event.failure_diagnostic, diagnostic, "the graph is carried, never flattened and recaptured");
  assert.deepEqual(event.error_codes, ["jest.test_failure", "assertion_failure", "AssertionError"]);
  const root = event.failure_diagnostic.errors[0];
  assert.deepEqual([root.message, root.location, root.native_details, event.failure_diagnostic.origin],
    ["expected 41 to be 42", { file: FILE, line: 7, column: 3 }, [{ label: "diff", text: "- 41\n+ 42" }],
      { kind: "hook", name: "afterEach" }]);
  assert.deepEqual(event.failure_diagnostic.values.map(({ type, value }) => [type, value]),
    [["number", 42], ["number", 41]], "typed native operands stay typed");

  const read = (records, exitCode = 1) => readNativeObservation({ channelBytes: stream(records), exitCode,
    expectation: expectation() });
  assert.equal(read(failedRun(undefined)).code, "test_proof_structured_events_invalid");
  const legacy = failedRun(diagnostic);
  legacy[3] = { ...legacy[3], error: { name: "AssertionError" } };
  assert.equal(read(legacy).code, "test_proof_structured_events_invalid");
  for (const malformed of [{ ...diagnostic, status: "partial" }, { ...diagnostic, root_error: "error-9" },
    { ...diagnostic, origin: { kind: "sibling" } },
    { ...diagnostic, errors: [{ ...diagnostic.errors[0], location: { file: FILE, line: 0 } }, ...diagnostic.errors.slice(1)] },
    { ...diagnostic, errors: [{ ...diagnostic.errors[0], native_details: [] }, ...diagnostic.errors.slice(1)] },
    { ...diagnostic, errors: [{ ...diagnostic.errors[0], metadata: {} }, ...diagnostic.errors.slice(1)] },
    { ...diagnostic, issues: [{ path: "/error", reason: "invented_reason" }] }]) {
    assert.equal(read(failedRun(malformed)).code, "test_proof_structured_events_invalid");
  }
  const passedWithDiagnosis = passingRun();
  passedWithDiagnosis[passedWithDiagnosis.length - 2] = { ...passedWithDiagnosis.at(-2),
    failure_diagnostic: diagnostic };
  assert.equal(read(passedWithDiagnosis, 0).code, "test_proof_structured_events_invalid");

  assert.equal(readNativeObservation({ channelBytes: stream(failedRun(diagnostic), { nonce: "e".repeat(64) }),
    exitCode: 1, expectation: expectation() }).code, "test_proof_structured_events_cross_attempt");
});

test("a native report adds diagnosis only: no selection, outcome, assertion or mutation credit", (t) => {
  const reported = nativeRecordFailureDiagnostic({ root: { name: "testing.T failure" },
    records: [{ message: "answer mismatch: got 43, want 42", location: { file: "answer_test.go", line: 12 } }] });
  const unavailable = unavailableTestFailureDiagnostic();
  const read = (records, nativeReport, exitCode = 1, exp = expectation()) => readNativeObservation({
    channelBytes: stream(records), exitCode, expectation: exp, nativeReport });

  const enriched = read(failedRun(unavailable, { assertion: false }), { selected_failure: reported });
  assert.deepEqual(enriched.selected.failure_diagnostic, reported);
  assert.equal(enriched.selected.assertion_failure, false, "a diagnostic message is not an assertion");
  assert.deepEqual([enriched.selected.outcome, enriched.executed_node_ids], ["failed", [NODE_ID]]);

  const panic = captureTestFailureDiagnostic(Object.assign(new Error("boom"), { name: "panic" }));
  assert.deepEqual(read(failedRun(panic), { selected_failure: reported }).selected.failure_diagnostic, panic);

  const passed = read(passingRun(), { selected_failure: reported }, 0);
  assert.equal(Object.hasOwn(passed.selected, "failure_diagnostic"), false);
  assert.equal(passed.selected.outcome, "passed");

  const untyped = nativeRecordFailureDiagnostic({ issues: [{ path: "/native_report",
    reason: "native_attribution_unavailable" }] });
  const limited = read(failedRun(unavailable, { assertion: false }), { selected_failure: untyped });
  assert.equal(limited.selected.failure_diagnostic.status, "unavailable");
  assert.deepEqual(limited.selected.failure_diagnostic.issues.map(({ reason }) => reason),
    ["error_not_supplied", "native_attribution_unavailable"]);

  for (const report of [{ selected_failure: { ...reported, status: "partial" } },
    { selected_failure: reported, unreadable: true }]) {
    const lossy = read(failedRun(unavailable, { assertion: false }), report);
    assert.equal(lossy.valid, true);
    assert.equal(lossy.selected.outcome, "failed");
    assert.ok(lossy.selected.failure_diagnostic.issues.some(({ reason }) =>
      reason === "native_report_unreadable"), JSON.stringify(lossy.selected.failure_diagnostic));
  }

  assert.equal(read(failedRun(reported).slice(0, -1), { selected_failure: reported }).code,
    "test_proof_structured_test_inventory_incomplete");

  const worktree = mkdtempSync(path.join(tmpdir(), "native-observation-report-"));
  t.after(() => rmSync(worktree, { recursive: true, force: true }));
  const source = "export function answer() { return 42; }\n";
  writeFileSync(path.join(worktree, "answer.mjs"), source);
  const MUTATED = "5".repeat(32);
  const falsifier = expectation({ capability: "falsifier_execution", worktree, instrumentation: {
    module_path: "answer.mjs", source_digest: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    function_name: "answer", original: 42, original_kind: "integer", replacement: 41,
    replacement_kind: "integer", functions: [{ name: "answer", line: 1 }],
    probes: [{ token: MUTATED, function_name: "answer", line: 1, mutated: true }] },
  mutation_id: "mutation-native", failure_reason_code: "test_proof_fault.result_inversion.v1",
  observation_seam: "jest_selected_test_body_failure" });
  const credit = (records) => projectNativeObservation({ channelBytes: stream(records), exitCode: 1,
    expectation: falsifier, nativeReport: { selected_failure: reported } });
  assert.equal(credit(failedRun(unavailable, { assertion: false,
    extra: [{ kind: "reach", token: MUTATED }] })).mutation_observed, false,
  "a reported assertion message earns no mutation detection");
  assert.equal(credit(failedRun(unavailable, { assertion: false })).mutation.mutated_entries_in_window, 0,
    "a report supplies no reach");
});

test("refusals nothing selected explains keep the run's original cause", () => {
  const read = (records, exitCode = 1, nativeReport = null, exp = expectation()) => readNativeObservation({
    channelBytes: stream(records), exitCode, expectation: exp, nativeReport });
  const startup = captureTestFailureDiagnostic(Object.assign(new Error("Cannot find module 'jest-config'"),
    { code: "MODULE_NOT_FOUND" }));
  assert.deepEqual(read([{ kind: "runtime_error", code: "test_proof_native_runner_unavailable",
    message: "Jest could not be loaded or started", failure_diagnostic: startup }]), { valid: false,
    code: "test_proof_native_runner_unavailable",
    detail: { message: "Jest could not be loaded or started", failure_diagnostic: startup } });
  assert.equal(read([{ kind: "runtime_error", code: "test_proof_native_runner_unavailable",
    failure_diagnostic: { ...startup, status: "partial" } }]).code, "test_proof_structured_events_invalid");

  const unhandled = captureTestFailureDiagnostic(new TypeError("unhandled rejection"));
  const withRunnerErrors = passingRun();
  withRunnerErrors[withRunnerErrors.length - 1] = { kind: "session_end", runner_errors: [unhandled],
    runner_error_count: 3 };
  const mismatch = read(withRunnerErrors, 1);
  assert.equal(mismatch.code, "test_proof_structured_events_exit_status_mismatch");
  assert.deepEqual([mismatch.detail.failure_diagnostic, mismatch.detail.runner_error_count, mismatch.detail.selected_outcome],
    [unhandled, 3, "passed"]);
  for (const end of [{ kind: "session_end", runner_errors: [], runner_error_count: 0 },
    { kind: "session_end", runner_errors: [unhandled], runner_error_count: 0 },
    { kind: "session_end", runner_errors: [{ ...unhandled, status: "partial" }], runner_error_count: 1 }]) {
    const malformed = passingRun();
    malformed[malformed.length - 1] = end;
    assert.equal(read(malformed, 0).code, "test_proof_structured_events_invalid");
  }

  const build = nativeRecordFailureDiagnostic({ records: [{ name: "error", code: "E0308",
    message: "mismatched types", location: { file: "tests/broken.rs", line: 2, column: 27 } }] });
  const incomplete = read([], 101, { build_failure: build }, expectation({ completion: "selected_result",
    declared_node_ids: [NODE_ID] }));
  assert.deepEqual([incomplete.code, incomplete.detail.failure_diagnostic],
    ["test_proof_structured_test_inventory_incomplete", build]);
  const sibling = passingRun();
  sibling.splice(3, 1, { kind: "test_start", file: FILE, test: SIBLING });
  assert.equal(Object.hasOwn(read(sibling, 0, { build_failure: build }).detail, "failure_diagnostic"), false);

  const started = read([{ kind: "session_start" }], 1, { build_failure: build },
    expectation({ completion: "selected_result", declared_node_ids: [NODE_ID] }));
  assert.equal(started.valid, false);
  assert.equal(Object.hasOwn(started.detail ?? {}, "failure_diagnostic"), false, JSON.stringify(started));
  const thrown = captureTestFailureDiagnostic(new Error("observed failure"));
  const observed = read(failedRun(thrown), 1, { build_failure: build });
  assert.deepEqual([observed.valid, observed.selected.outcome, observed.selected.failure_diagnostic],
    [true, "failed", thrown]);

  const lossy = read([], 101, { build_failure: build, unreadable: true }, expectation({
    completion: "selected_result", declared_node_ids: [NODE_ID] }));
  assert.deepEqual([lossy.detail.failure_diagnostic.errors, lossy.detail.failure_diagnostic.issues],
    [build.errors, [{ path: "/native_report", reason: "native_report_unreadable" }]]);
});

const GO_EVENTS = [
  { Action: "run", Test: "TestAnswer" },
  { Action: "output", Test: "TestAnswer", Output: "=== RUN   TestAnswer\n", OutputType: "frame" },
  { Action: "output", Test: "TestAnswer", Output: "    answer_test.go:11: ordinary log marker\n" },
  { Action: "output", Test: "TestAnswer", Output: "    answer_test.go:12: answer mismatch: got 43, want 42\n",
    OutputType: "error" },
  { Action: "output", Test: "TestAnswer", Output: "    answer_test.go:13: after the assertion\n" },
  { Action: "output", Test: "TestSibling", Output: "    answer_test.go:40: sibling error\n", OutputType: "error" },
  { Action: "output", Test: "TestAnswer", Output: "--- FAIL: TestAnswer (0.00s)\n", OutputType: "frame" },
  { Action: "fail", Test: "TestAnswer" }
].map((event) => JSON.stringify({ Time: "2026-09-27T00:00:00Z", Package: "example.com/calc", ...event }));
const untyped = (lines) => lines.map((line) => {
  const { OutputType: _type, ...event } = JSON.parse(line);
  return JSON.stringify(event);
});
const readReport = (adapter, lines) => {
  const observer = createNativeReportObserver(adapter, { lineCapBytes: 4096 });
  observer.push(Buffer.from(lines.map((line) => `${line}\n`).join("")));
  return observer.finish();
};

test("the Go report adapter reads only the selected test's typed native error records", () => {
  const report = readReport(goTestReport("TestAnswer"), GO_EVENTS);
  assert.equal(report.unreadable, false);
  assert.equal(isLauncherTestFailureDiagnostic(report.selected_failure), true);
  assert.deepEqual(report.selected_failure.errors, [{ id: "error-0", name: "testing.T failure",
    message: "answer mismatch: got 43, want 42", location: { file: "answer_test.go", line: 12 } }]);
  assert.equal(JSON.stringify(report).includes("ordinary log marker"), false, "a log line is never a diagnosis");
  assert.equal(JSON.stringify(report).includes("sibling error"), false, "a sibling's record is never attributed");

  const continued = readReport(goTestReport("TestAnswer"), [
    JSON.stringify({ Action: "output", Test: "TestAnswer/sub", OutputType: "error",
      Output: "    helper_test.go:7: helper mismatch: got 1\n" }),
    JSON.stringify({ Action: "output", Test: "TestAnswer/sub", OutputType: "error-continue",
      Output: "        second line\n" })]);
  assert.deepEqual([continued.selected_failure.errors[0].message, continued.selected_failure.origin],
    ["helper mismatch: got 1\nsecond line", { kind: "subtest", name: "TestAnswer/sub" }]);
  assert.deepEqual(readReport(goTestReport("TestAnswer"), GO_EVENTS.filter((line) =>
    !line.includes("\"error\""))), { selected_failure: null, unreadable: false });
});

test("an older untyped Go report makes no attribution and says so", () => {

  const report = readReport(goTestReport("TestAnswer"), untyped(GO_EVENTS));
  assert.deepEqual(report.selected_failure, unavailableTestFailureDiagnostic(
    [{ path: "/native_report", reason: "native_attribution_unavailable" }]));
  assert.equal(JSON.stringify(report).includes("answer mismatch"), false);

  const run = (line) => [GO_EVENTS[0], GO_EVENTS[1], line, GO_EVENTS[6], GO_EVENTS[7]];
  const errorf = run(GO_EVENTS[3]);
  const logged = run(untyped([GO_EVENTS[3]])[0]);
  assert.deepEqual(untyped(errorf), untyped(logged));
  assert.equal(readReport(goTestReport("TestAnswer"), errorf).selected_failure.errors[0].message,
    "answer mismatch: got 43, want 42");
  assert.deepEqual(readReport(goTestReport("TestAnswer"), logged), { selected_failure: null, unreadable: false });
  for (const lines of [untyped(errorf), untyped(logged)]) {
    assert.deepEqual(readReport(goTestReport("TestAnswer"), lines).selected_failure,
      report.selected_failure);
  }
});

test("an older untyped Go report names the failed assertion's message and location", {
  todo: "WK-2670 entries 282/286: older Go (for example 1.24.4) writes testing.T errors and logs through the " +
    "same untyped report output, so the report alone cannot tell them apart; this required diagnosis remains unmet"
}, () => {
  const report = readReport(goTestReport("TestAnswer"), untyped(GO_EVENTS));
  const [root] = report.selected_failure?.errors ?? [];
  assert.equal(root?.message, "answer mismatch: got 43, want 42");
  assert.deepEqual(root?.location, { file: "answer_test.go", line: 12 });
});

test("the Cargo report adapter reads compiler errors from Cargo's structured JSON only", () => {
  const compilerMessage = JSON.stringify({ reason: "compiler-message", message: {
    rendered: "error[E0308]: mismatched types\n --> tests/broken.rs:2:28\n", $message_type: "diagnostic",
    children: [{ level: "help", message: "try a string slice", spans: [], children: [] }],
    level: "error", message: "mismatched types", code: { code: "E0308", explanation: "long text" },
    spans: [{ file_name: "tests/broken.rs", line_start: 2, column_start: 28, is_primary: true,
      label: "expected `u8`, found `&str`" }, { file_name: "tests/broken.rs", line_start: 2, column_start: 23,
      is_primary: false, label: "expected due to this" }] } });
  const report = readReport(cargoTestReport(), [
    JSON.stringify({ reason: "compiler-artifact" }), compilerMessage,
    JSON.stringify({ reason: "compiler-message", message: { level: "failure-note", message: "For more information",
      spans: [], children: [] } }),
    "running 1 test", "test broken ... FAILED", JSON.stringify({ reason: "build-finished", success: false })]);
  assert.deepEqual(report.build_failure.errors, [{ id: "error-0", name: "error", message: "mismatched types",
    code: "E0308", location: { file: "tests/broken.rs", line: 2 },
    native_details: [{ label: "primary_span", text: "expected `u8`, found `&str`" },
      { label: "help", text: "try a string slice" }] }]);
  assert.equal(JSON.stringify(report).includes("rendered"), false);
  assert.equal(JSON.stringify(report).includes("long text"), false, "the code explanation is not a diagnosis");
  assert.deepEqual(readReport(cargoTestReport(), ["test answer ... ok"]), { build_failure: null, unreadable: false });
});

const WORK = "/scratch/attempt/work";
const denoAt = (file, line, column, indent = "    ") =>
  `${indent}at \u001b[0m\u001b[36mfile://${WORK}/${file}\u001b[0m:\u001b[0m\u001b[33m${line}` +
  `\u001b[0m:\u001b[0m\u001b[33m${column}\u001b[0m`;
const DENO_CHECK_FAILED = ["", "\u001b[0m\u001b[1m\u001b[31merror\u001b[0m: Type checking failed.", "",
  "  \u001b[0m\u001b[36minfo:\u001b[0m The program failed type-checking, but it still might work correctly.",
  "  \u001b[0m\u001b[36mhint:\u001b[0m Re-run with \u001b[0m\u001b[4m--no-check\u001b[0m to skip type-checking."];
const DENO_MISSING_MODULE = ["\u001b[0m\u001b[32mCheck\u001b[0m .launcher-test-proof/deno-entry.js",
  `\u001b[0m\u001b[1mTS2307 \u001b[0m[\u001b[0m\u001b[1m\u001b[31mERROR\u001b[0m]: Cannot find module 'file://${WORK}/deno/missing.ts'.`,
  denoAt("deno/answer_test.ts", 2, 32), ...DENO_CHECK_FAILED];
const DENO_TYPE_ERROR = ["\u001b[0m\u001b[32mCheck\u001b[0m .launcher-test-proof/deno-entry.js",
  "\u001b[0m\u001b[1mTS2322 \u001b[0m[\u001b[0m\u001b[1m\u001b[31mERROR\u001b[0m]: Type 'number' is not assignable to type 'string'.",
  "    const value: string = await settled(answer);", "\u001b[0m\u001b[31m          ~~~~~\u001b[0m",
  denoAt("deno/answer_test.ts", 7, 11), "",
  "\u001b[0m\u001b[1mTS2322 \u001b[0m[\u001b[0m\u001b[1m\u001b[31mERROR\u001b[0m]: Type 'string' is not assignable to type 'number'.",
  "export function answer(): number { return \"x\"; }", "\u001b[0m\u001b[31m                                  ~~~~~~\u001b[0m",
  denoAt("deno/answer.ts", 1, 35), "",
  "    The expected type comes from the return type of this signature.", "    export function answer(): number {",
  denoAt("deno/other.ts", 3, 9, "        "), "",
  "\u001b[0m\u001b[1mTS2345 \u001b[0m[\u001b[0m\u001b[1m\u001b[31mERROR\u001b[0m]: Argument of type 'number' is not assignable to parameter of type 'string'.",
  "    assertEquals(value, 42);", "\u001b[0m\u001b[31m                        ~~\u001b[0m",
  denoAt("../outside/mod.ts", 8, 25), "",
  "Found 3 errors.", ...DENO_CHECK_FAILED];

test("the Deno report adapter reads its type check's diagnostics, never excerpts or noise", () => {
  const deno = () => denoTestReport({ workRoot: WORK, instrumented: "deno/answer.ts" });
  assert.deepEqual(readReport(deno(), DENO_MISSING_MODULE), { unreadable: false,
    build_failure: nativeRecordFailureDiagnostic({ records: [{ name: "error", code: "TS2307",
      message: `Cannot find module 'file://${WORK}/deno/missing.ts'.`,
      location: { file: "deno/answer_test.ts", line: 2, column: 32 } }] }) });

  const typed = readReport(deno(), DENO_TYPE_ERROR);
  assert.deepEqual(typed.build_failure.errors.slice(1).map(({ code, message, location }) =>
    ({ code, message, location })), [
    { code: "TS2322", message: "Type 'number' is not assignable to type 'string'.",
      location: { file: "deno/answer_test.ts", line: 7, column: 11 } },
    { code: "TS2322", message: "Type 'string' is not assignable to type 'number'.",
      location: { file: "deno/answer.ts", line: 1 } },
    { code: "TS2345", message: "Argument of type 'number' is not assignable to parameter of type 'string'.",
      location: undefined }]);
  assert.deepEqual(typed.build_failure.issues, []);
  for (const excerpt of ["await settled", "~~~", "expected type comes", "other.ts", "--no-check", "\u001b"]) {
    assert.equal(JSON.stringify(typed).includes(excerpt), false, `the report carries ${excerpt}`);
  }

  const unreadable = unavailableTestFailureDiagnostic([{ path: "/native_report",
    reason: "native_report_unreadable" }]);
  const noise = ["TS2322 is the code we expect", `    at file://${WORK}/deno/answer_test.ts:1:1`,
    "Found 3 errors.", "error: Test failed"];
  assert.deepEqual(readReport(deno(), noise), { build_failure: unreadable, unreadable: false });
  assert.deepEqual(readReport(deno(), ["thread 'main' panicked at cli/main.rs:1:1", "unexpected state"]),
    { build_failure: unreadable, unreadable: false });
  assert.deepEqual(readReport(deno(), []), { build_failure: null, unreadable: false });
  assert.deepEqual(readReport(deno(), ["", "   "]), { build_failure: null, unreadable: false });

  const hinted = readReport(deno(), [
    "TS2307 [ERROR]: Import \"@std/nope\" not a dependency and not in import map from \"file:///x.ts\"",
    "  hint: If you want to use the JSR package, try running `deno add jsr:@std/nope`",
    denoAt("deno/answer_test.ts", 1, 19), ...DENO_CHECK_FAILED]);
  assert.deepEqual([hinted.build_failure.errors[0].message, hinted.build_failure.issues],
    ["Import \"@std/nope\" not a dependency and not in import map from \"file:///x.ts\"",
      [{ path: "/native_report/0/message", reason: "native_report_unreadable" }]]);
  assert.equal(JSON.stringify(hinted).includes("deno add"), false);
  const chained = readReport(deno(), [...DENO_MISSING_MODULE.slice(0, 3),
    "TS2322 [ERROR]: Type '{ a: string; }' is not assignable to type 'A'.",
    "  Types of property 'a' are incompatible.", "const a: A = { a: \"x\" };", "      ^",
    denoAt("deno/answer_test.ts", 4, 7), "Found 2 errors.", ...DENO_CHECK_FAILED]);
  assert.deepEqual(chained.build_failure.issues,
    [{ path: "/native_report/1/message", reason: "native_report_unreadable" }]);
  assert.equal(JSON.stringify(chained).includes("incompatible"), false);

  const truncated = readReport(deno(), DENO_TYPE_ERROR.slice(0, 5));
  assert.deepEqual([truncated.build_failure.errors[0].code, truncated.build_failure.issues],
    ["TS2322", [{ path: "/native_report", reason: "native_report_unreadable" }]]);
  assert.deepEqual(readReport(deno(), ["Check x.js", "error: something new", ...DENO_CHECK_FAILED]).build_failure,
    unavailableTestFailureDiagnostic([{ path: "/native_report", reason: "native_report_unreadable" }]));
  const unrecognized = readReport(deno(), [...DENO_MISSING_MODULE.slice(0, 3), "Found 2 errors.",
    ...DENO_CHECK_FAILED]);
  assert.deepEqual(unrecognized.build_failure.issues,
    [{ path: "/native_report", reason: "native_report_unreadable" }]);

  const many = Array.from({ length: 20 }, (_, index) => [
    `TS2322 [ERROR]: diagnostic ${index}`, denoAt("deno/answer_test.ts", index + 1, 1)]).flat();
  const bounded = readReport(deno(), [...many, "Found 20 errors.", ...DENO_CHECK_FAILED]);
  assert.deepEqual([bounded.build_failure.errors.length - 1, bounded.build_failure.issues],
    [16, [{ path: "/native_report", reason: "capture_budget_exceeded" }]]);
});

test("native report framing reads before elision, bounds lines and survives adapter failure", () => {
  const seen = [];
  const observer = createNativeReportObserver({ stream: "stdout", line: (text) => seen.push(text),
    finish: () => ({ lines: seen.length }) }, { lineCapBytes: 8 });
  for (const chunk of ["ab", "c\nde", "f\n", "x".repeat(20), "\nlast"]) observer.push(Buffer.from(chunk));
  assert.deepEqual(observer.finish(), { lines: 3, unreadable: true });
  assert.deepEqual(seen, ["abc", "def", "last"], "an oversized line is dropped whole; later lines are read");
  const failing = createNativeReportObserver({ line: () => { throw new Error("adapter defect"); },
    finish: () => ({ selected_failure: null }) });
  failing.push(Buffer.from("one\ntwo\n"));
  assert.deepEqual(failing.finish(), { unreadable: true }, "a failed adapter is an explicit loss, never facts");
});
