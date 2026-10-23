import test from "node:test";
import assert from "node:assert/strict";
import { prepareDeliverWorkResponse } from "../../packages/wiki-mcp/src/lib/task-deliver-work-response.mjs";
import { measureMcpInlineResultBytes } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { selectedResponseDeliveryBound } from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";

const candidate = "c".repeat(40), selected = "d".repeat(40), base = "b".repeat(40), tree = "7".repeat(40);
const subject = "WK-1429#SLICE-004", ref = "refs/heads/slice/IN-0011/WK-1429/SLICE-004";
const locator = { ref_id: "aB3_dE9x" };
const settled = (extra = {}) => ({ commit_object: "created", delivery_ref: "advanced", submitted_for_review: true,
  checkout: "complete",
  transaction: { ref, base_sha: base, candidate_commit: candidate, delivery_commit: selected, delivered_tree: tree,
    canonical_review: { state: "review", written: true, status: "review" }, compensation: { state: "not_required" },
    checkout: { state: "complete", code: null } },
  original: { available: true, operator_only: true, locator }, ...extra });
const observe = (outcome, paths = ["a", "b"]) => ({ identity: { unit: subject }, transactionOutcome: outcome,
  ref, phases: { scope_verification: { state: "returned", result: { changed_paths: paths } } } });
function prepare(outcome, options = {}) {
  const before = JSON.stringify(outcome);
  const frame = prepareDeliverWorkResponse({ workspace: { repo: "fixture/repo" }, outcome,
    observation: observe(outcome), ...options });
  assert.equal(JSON.stringify(outcome), before, "projection leaves the complete owner result unchanged");
  assert.equal(frame.registered, false);
  assert.equal(frame.delivery.measured_bytes, measureMcpInlineResultBytes(frame, { isError: frame.isError }));
  assert.equal(frame.delivery.fits, frame.delivery.measured_bytes <= selectedResponseDeliveryBound(options.responseEnv));
  assert.equal(frame.delivery.complete_transport_required, !frame.delivery.fits);
  assert.equal(frame.delivery.delivered, false);
  assert.equal(JSON.stringify(frame).includes("next_calls"), false);
  assert.equal(JSON.stringify(frame).includes("workspace_integrate"), false);
  assert.deepEqual(Object.values(frame.body.effects).slice(4), [false, false, false, false, false]);
  return frame;
}

for (const [label, extra, pathCount] of [
  ["fresh", {}, 2], ["equivalent replay selects the existing delivery", { delivery_ref: "unchanged", idempotent: true }, 2],
  ["empty", { empty_delivery: true }, 0]
]) test(`delivered ${label}`, () => {
  const outcome = settled(extra);
  const frame = prepare(outcome, { observation: observe(outcome, Array(pathCount).fill("path")) });
  assert.equal(frame.body.outcome, "delivered");
  assert.deepEqual(frame.body.selected_delivery, { commit: selected, base });
  assert.notEqual(frame.body.selected_delivery.commit, candidate);
  assert.equal(frame.body.tree, tree);
  assert.equal(frame.body.changed_path_count, pathCount);
  assert.equal(frame.body.next_action.completed_step, 1);
  assert.match(frame.body.next_action.instruction, /agent-role-result.v1.*terminate/);
  assert.deepEqual(frame.continuations.original.request, { result: locator });
  assert.equal(frame.continuations.original.availability, "pending_delivery_reader");
});

const cases = [
  ["scope refusal", { delivery_ref: "unchanged", submitted_for_review: false,
    transaction: { ref, base_sha: base, candidate_commit: candidate, delivery_commit: null },
    scope: { contained: false, refusal: { code: "OUT_OF_SCOPE" } } }, "refused"],
  ["materialization throw", { commit_object: "unknown", delivery_ref: "unchanged", submitted_for_review: false,
    stage: "materialization", code: "MATERIALIZE", transaction: { ref } }, "uncertain"],
  ["scope verification throw", { delivery_ref: "unchanged", submitted_for_review: false,
    stage: "scope_verification", code: "SCOPE", transaction: { ref, candidate_commit: candidate } }, "refused"],
  ["publication throw", { delivery_ref: "unknown", submitted_for_review: false,
    stage: "publication", code: "PUBLISH", transaction: { ref, candidate_commit: candidate } }, "uncertain"],
  ["publication proved no effect", { delivery_ref: "unchanged", submitted_for_review: false,
    stage: "publication", transaction: { ref, candidate_commit: candidate } }, "refused"],
  ["transition failed without restoration", { submitted_for_review: false }, "partial"],
  ["restored and definitely not submitted", { delivery_ref: "restored", submitted_for_review: false }, "refused"],
  ["restored but submission unknown", { delivery_ref: "restored", submitted_for_review: null }, "uncertain"],
  ["compensation failed with known advanced ref", { submitted_for_review: false,
    transaction: { ref, canonical_review: { state: "refused", decision_code: "WRITE_FAILED" },
      compensation: { state: "failed", cause: { code: "CAS_FAILED" } } } }, "partial"],
  ["unknown ref", { delivery_ref: "unknown" }, "uncertain"],
  ["unknown submission", { submitted_for_review: null }, "uncertain"],
  ["unknown commit object", { commit_object: "unknown" }, "uncertain"],
  ["candidate cannot establish selected delivery", { transaction: { ref, base_sha: base, candidate_commit: candidate } }, "partial"]
];
for (const [label, facts, expected] of cases) test(label, () => {
  const outcome = settled(facts);
  const frame = prepare(outcome, { isError: label.includes("throw") });
  assert.equal(frame.body.outcome, expected);
  assert.equal(frame.body.effects.submitted_for_review, outcome.submitted_for_review);
  assert.equal(frame.body.effects.delivery_ref, outcome.delivery_ref);
  assert.notEqual(frame.body.next_action.action, "emit_diagnostic_evidence_then_terminate");
});

test("recorded completion recovery distinguishes refused publication from an unknown candidate object", () => {
  const outcome = settled({ committed: false, commit_object: "unknown", delivery_ref: "unchanged", submitted_for_review: false,
    stage: "materialization", completion_recovery: { available: true },
    transaction: { ref, canonical_review: { state: "not_attempted" }, delivery_commit: null } });
  const recorded = prepareDeliverWorkResponse({ workspace: { repo: "fixture/repo" }, outcome,
    observation: observe(outcome), historicalObservation: true });
  assert.equal(recorded.body.outcome, "refused");
  assert.equal(recorded.body.effects.commit_object, "unknown");
  assert.equal(recorded.body.next_action.action, "inspect_failed_delivery");
  assert.match(recorded.body.next_action.instruction, /historical result read performs no correction/u);
  const unestablished = prepare({ ...outcome, completion_recovery: { available: false } });
  assert.equal(unestablished.body.outcome, "uncertain");
});

for (const success of [true, false]) test(`failed output preserves ${success ? "delivered" : "refused"} settlement`, () => {
  const owner = settled(success ? {} : { delivery_ref: "unchanged", submitted_for_review: false,
    transaction: { ref, base_sha: base, candidate_commit: candidate } });
  const frame = prepare({ commit_object: owner.commit_object, delivery_ref: owner.delivery_ref,
    submitted_for_review: owner.submitted_for_review,
    output: { state: "failed", stage: "original_serialization" },
    original: { available: false, retention_failure: { code: "SERIALIZER", cause: { detail: "large" } } } },
  { observation: observe(owner), isError: true });
  assert.equal(frame.body.outcome, success ? "delivered" : "refused");
  assert.equal(frame.body.output.state, "failed");
  assert.equal(frame.body.original.availability, "unavailable");
  assert.equal(frame.body.next_action.action, "repair_response_state");
  assert.equal(frame.continuations.original, undefined);
});

test("pre-admission errors have zero effects, no authenticated subject or captured original", () => {
  const frame = prepare({}, { observation: null, error: Object.assign(new Error("bad input"), { code: "INPUT" }),
    isError: true, stage: "input_validation", inputInvalid: true });
  assert.equal(frame.body.subject, null);
  assert.equal(frame.body.outcome, "refused");
  assert.equal(frame.body.changed_path_count, null);
  assert.equal(frame.body.changed_paths_measurement, "unmeasured");
  assert.equal(frame.body.original.availability, "not_captured");
  assert.deepEqual(frame.continuations.correction, { availability: "pending_activation", request: {} });
  assert.equal(frame.body.diagnostics[0].code, "INPUT");
});

test("missing launcher tuple projects the transaction owner's reasons without capturing an original", () => {
  const reason = "WIKI_MCP_COMMIT_LAUNCH_REF/WIKI_MCP_COMMIT_RUN_ID launcher tuple is required; commit refuses to derive identity from worker input, serialized environment bindings, or the current checkout";
  const outcome = { tool: "commit", committed: false, commit_object: "not_created", delivery_ref: "unchanged",
    submitted_for_review: false, valid: false, written: false,
    decision_code: "commit.missing_launcher_binding.v1", reasons: [reason] };
  const frame = prepare(outcome, { observation: null });
  assert.equal(frame.isError, false, "returned refusal keeps the owner's JSON channel");
  assert.equal(frame.body.outcome, "refused");
  assert.equal(frame.body.subject, null);
  assert.equal(frame.body.selected_delivery, null);
  assert.equal(frame.body.stage, "binding_resolution");
  assert.equal(frame.body.diagnostics[0].code, "commit.missing_launcher_binding.v1");
  assert.equal(frame.body.diagnostics[0].message, reason);
  assert.equal(frame.body.next_action.actor, "launcher provisioning / identity-store owner");
  assert.equal(frame.body.next_action.action, "reconcile_launcher_binding");
  assert.equal(frame.body.original.availability, "not_captured");
  assert.equal(frame.body.original.locator, null);
  assert.equal(frame.continuations.original, undefined);
});

test("multibyte refusal reasons retain their complete deciding meaning", () => {
  for (const [reason, omitted] of [["原因🧪".repeat(51), false], ["原因🧪".repeat(52), true]]) {
    const frame = prepare({ decision_code: "commit.missing_launcher_binding.v1", reasons: [reason] },
      { observation: null, responseEnv: { WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "512" } });
    assert.equal(frame.delivery.bound_bytes, 8192);
    assert.equal(frame.body.diagnostics[0].message, reason);
    assert.equal(frame.body.omitted_detail.includes("binding_resolution.message"), false);
    assert.equal(frame.body.original.availability, "not_captured");
    assert.equal(frame.body.original.locator, null);
    assert.equal(frame.continuations.original, undefined);
  }
});

test("native errors and message-bearing outcomes keep their existing diagnostic meanings", () => {
  const frame = prepare({}, { observation: null, stage: "authentication", isError: true,
    error: Object.assign(new Error("launcher agent session contract is absent"), { code: "session_contract_missing" }) });
  assert.equal(frame.body.diagnostics[0].message, "launcher agent session contract is absent");
  assert.equal(frame.body.diagnostics[0].code, "session_contract_missing");
  assert.equal(frame.isError, true);
  for (const source of [{ message: "owner message" }, { cause: { message: "owner cause" } }, { reason: "owner reason" }]) {
    const projected = prepare({ ...source, reasons: ["collection explanation"] }, { observation: null });
    assert.equal(projected.body.diagnostics[0].message, source.message ?? source.cause?.message ?? source.reason);
  }
});

test("large multibyte causes and scope/receipt collections stay in the unchanged original", () => {
  const huge = "原因🧪".repeat(50000);
  const outcome = settled({ submitted_for_review: null, delivery_ref: "unknown", receipts: Array(100).fill(huge),
    scope: { contained: true, detail: huge }, transaction: { ref, base_sha: base, delivery_commit: selected,
      candidate_commit: candidate, canonical_review: { state: "threw", cause: { code: "TRANSITION", message: huge,
        detail: { nested: huge } } }, compensation: { state: "failed", cause: { code: "COMPENSATION", message: huge } } } });
  const frame = prepare(outcome);
  assert.equal(frame.body.outcome, "uncertain");
  assert.deepEqual(frame.body.diagnostics.slice(1).map(d => d.code), ["TRANSITION", "COMPENSATION"]);
  assert.equal(JSON.stringify(frame).includes(huge), true);
  assert.equal(frame.body.omitted_detail.includes("canonical_review.message"), false);
  assert.ok(frame.body.omitted_detail.includes("receipts"));
  assert.deepEqual(frame.body.resource, { subject, ref });
});

test("below-minimum inline configuration remains 8 KiB and bounds the entire frame", () => {
  const responseEnv = { WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "512" };
  assert.equal(selectedResponseDeliveryBound(responseEnv), 8192);
  const frame = prepare(settled(), { responseEnv });
  assert.equal(frame.delivery.bound_bytes, 8192);
});

test("whole-frame admission accounts for escaped diagnostic strings alongside essential causes", () => {
  const message = "\u0000".repeat(240);
  const outcome = settled({ submitted_for_review: null, delivery_ref: "unknown", message, code: "TOP",
    cause: { message, code: "TOP_CAUSE" }, scope: { contained: false, refusal: { message, code: "SCOPE" } },
    transaction: { ref, base_sha: base, delivery_commit: selected,
      canonical_review: { state: "threw", cause: { code: "TRANSITION", message } },
      compensation: { state: "failed", cause: { code: "COMPENSATION", message } } } });
  const frame = prepare(outcome, { isError: true });
  assert.deepEqual(frame.body.diagnostics.map(diagnostic => diagnostic.code),
    ["TOP", "TOP_CAUSE", "SCOPE", "TRANSITION", "COMPENSATION"]);
  assert.ok(frame.body.diagnostics.every(diagnostic => diagnostic.message === message));
  assert.equal(frame.body.omitted_detail.includes("canonical_review.message"), false);
  assert.equal(frame.body.effects.submitted_for_review, null);
});

for (const member of ["commit_object", "delivery_ref", "submitted_for_review"]) test(`explicit null ${member} remains unknown, never zero or successful`, () => {
  const frame = prepare(settled({ [member]: null }));
  assert.equal(frame.body.effects[member], null);
  assert.equal(frame.body.outcome, "uncertain");
  assert.notEqual(frame.body.next_action.action, "emit_diagnostic_evidence_then_terminate");
});

test("a selected delivery with contradictory known commit-object facts cannot claim completion", () => {
  const frame = prepare(settled({ commit_object: "not_created" }));
  assert.equal(frame.body.effects.commit_object, "not_created");
  assert.equal(frame.body.outcome, "partial");
});

test("selected replay with proven failed submission is incomplete delivery", () => {
  const frame = prepare(settled({ delivery_ref: "unchanged", submitted_for_review: false }));
  assert.equal(frame.body.outcome, "partial");
  assert.deepEqual(frame.body.selected_delivery, { commit: selected, base });
  assert.equal(frame.body.effects.submitted_for_review, false);
});

test('public delivery flags name the permitted semantic reader without changing either flag', () => {
  const outcome = settled();
  const frame = prepareDeliverWorkResponse({ workspace: { repo: "fixture/repo" }, outcome,
    observation: observe(outcome), publicDelivery: true });
  assert.equal(frame.body.original.operator_only, true);
  assert.equal(frame.body.original.worker_read_available, true);
  assert.match(frame.body.original.reader_scope, /operator_only applies to generic retained-evidence access/u);
  assert.match(frame.body.original.reader_scope, /worker may follow the returned get_run_result call/u);
});
