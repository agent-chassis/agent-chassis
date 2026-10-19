import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { presentRunObservation } from "../../packages/wiki-mcp/src/lib/task-get-run-result-delivery.mjs";
import { integrationReadOutcome, deliveryReadOutcome } from "../../packages/wiki-mcp/src/lib/get-run-result-outcome-projection.mjs";
import { createRegisteredToolRequestContractStore } from "../../packages/wiki-mcp/src/lib/registered-tool-request-contracts.mjs";
import { GET_RUN_RESULT_RETAINED_INPUT_SCHEMA } from "../../packages/wiki-mcp/src/lib/task-get-run-result.mjs";
import { captureDiagnosticEvidence } from "../../packages/agent-launch-cli/src/lib/diagnostic-evidence.mjs";

const subject = "WK-9732#SLICE-001";
const attempt_id = "wkdb_selected";
const result = { ref_id: "readAAAA" };
const detail = result_ => ({ tool: "get_run_result", arguments: { result: result_, detail: { member: "final_result" } } });
const present = (facts, request = { subject, attempt_id }) => presentRunObservation({ accepted: true,
  subject, run_id: attempt_id, role: "worker", ...facts }, detail, {}, subject, request);
function contracts() {
  const store = createRegisteredToolRequestContractStore();
  const schema = GET_RUN_RESULT_RETAINED_INPUT_SCHEMA;
  store.retain("get_run_result", { inputSchema: schema, advertisedInputSchema: schema, publishedInputSchema: schema });
  const delivery = z.object({}).strict();
  store.retain("workspace_deliver_work", { inputSchema: delivery, advertisedInputSchema: delivery, publishedInputSchema: delivery });
  return store.lookup;
}

test("run observation distinguishes timeout, execution failure and useful response availability", () => {
  const answer = present({ status: "failed", terminal: true, timed_out: true, producer_pending: true,
    exit: { code: 7, signal: null }, original_result: result,
    result_publication: { state: "published", attempts: 8 },
    original_publication: { state: "captured", bound: true },
    selected: { released: true, last_lifecycle_kind: "reservation_released", result_digest: "private-digest" } });
  assert.equal(answer.timed_out, true);
  assert.equal(answer.producer_pending, true);
  assert.deepEqual(answer.exit, { code: 7, signal: null });
  assert.deepEqual(answer.next_calls, [detail(result)]);
  for (const key of ["recorded", "original_publication", "result_publication", "observation", "final_result_summary"]) {
    assert.equal(Object.hasOwn(answer, key), false, key);
  }
  assert.equal(present({ status: "succeeded", terminal: true, producer_pending: false }).producer_pending, undefined,
    "a healthy completed answer omits routine producer bookkeeping");
});

test("run observation preserves a small unbound response and explicitly limits an oversized one", () => {
  const original = { kind: "worker", full_response: { text: "The worker's actual answer." } };
  const small = present({ status: "succeeded", terminal: true, selected: { result: original } });
  assert.equal(small.final_result.full_response.text, original.full_response.text);
  assert.equal(small.original.available, false);
  const cold = present({ selected: { result: original } });
  assert.equal(cold.terminal, undefined, "a recorded response alone is not a child termination observation");
  assert.equal(cold.final_result.full_response.text, original.full_response.text);
  const large = present({ status: "failed", terminal: true,
    final_result: { kind: "worker", full_response: { text: "Long answer. ".repeat(2000) } },
    original_publication: { state: "failed", stage: "original_capture" },
    completion_settlement_failure: { code: "ENOSPC", message: "The result store is full." } });
  assert.equal(large.result_limitation.code, "unretained_result_exceeds_delivery_bound");
  assert.equal(large.completion_settlement_failure.code, "ENOSPC");
  assert.deepEqual(large.next_calls, []);
  assert.ok(Buffer.byteLength(JSON.stringify(large)) < 8192);
});

test("public final result preserves distinct authored meaning, failures and explicit partial outcomes", () => {
  const missing = { code: "report_incomplete", reason: "A required section was not captured." };
  const writeback = { kind: "writeback_failed", detail: { code: "EACCES", subject: "WK-2776",
    updated: null, message: "The update outcome is unknown." } };
  const final = { schema_version: "internal.v1", kind: "findings", findings: { affected_path: "selected.mjs",
    metadata: { reproduction: "The authored field remains substantive." } },
    full_response: { format: "markdown", text: "The complete authored review.", source: { capture_path: "/internal/capture" } },
    missing_result: missing, writeback, structured_role_result: { valid: true, finding_counts: { total: 1 } },
    advisory_review: { authority: "advisory_only", execution_status: "completed",
      advisory_output: { available: true, usable: true, text: "A distinct authored supplement." },
      schema_observation: { adherent: false, diagnostics: ["Routine parser observations"] },
      formal_attestation: { requested: true, available: false, reason: "schema_non_adherent" } } };
  const observed = presentRunObservation({ ok: true, final_result: final }, detail, {}, "WK-2776");
  assert.deepEqual(observed.final_result, { kind: "findings", findings: final.findings,
    full_response: { format: "markdown", text: final.full_response.text }, missing_result: missing, writeback,
    advisory_review: { advisory_output: { text: "A distinct authored supplement." },
      formal_attestation: { available: false, reason: "schema_non_adherent" } } });
  assert.equal(final.full_response.source.capture_path, "/internal/capture", "presentation does not rewrite the retained input");
  const routine = presentRunObservation({ ok: true, final_result: { kind: "no_findings",
    no_findings: { reason: "No findings." }, writeback: { kind: "no_writeback_expected", detail: null } } }, detail, {}, "WK-2776");
  assert.equal(routine.final_result.writeback, undefined);
});

test("run receipt choices with any failed population never approve a successful subset", () => {
  const cause = { code: "selected_response_query_invalid", reason: "source_locator_not_current", receipts: 1 };
  const answer = present({ status: "succeeded", terminal: true,
    delivery: { available: true, references: [result], cause } });
  assert.deepEqual(answer.delivery, { available: false, references: [], cause });
  assert.deepEqual(answer.next_calls, []);
});

test("cold attempt choices distinguish result availability without inventing process termination", () => {
  const answer = present({ ok: false, code: "attempt_selection_ambiguous", attempts: [
    { dispatch_tuple: { run_id: attempt_id }, result: { kind: "worker" }, released: true },
    { dispatch_tuple: null, result: null, released: false }
  ] });
  const [choice] = answer.attempt_choices;
  assert.equal(choice.role, "worker");
  assert.equal(choice.result_available, true);
  assert.equal(choice.terminal, undefined);
  assert.equal(choice.released, undefined);
  assert.deepEqual(choice.call.arguments, { subject, attempt_id });
  assert.equal(answer.attempt_choices[1].call, undefined, "an unpublished identity cannot become a subject-only self-read");
  assert.equal(answer.attempt_choices[1].selection_limitation.code, "attempt_identity_unavailable");
});

test("integration original read preserves unknown effects and confirmed recovery without a self-read", async () => {
  const requestContracts = contracts();
  const context = { result, subject, role: "orchestrator", responseEnv: {}, requestContracts };
  const thrown = captureDiagnosticEvidence(Object.assign(new Error("Integration result unavailable."), { code: "fixture.unknown" }));
  const unknown = await integrationReadOutcome({ ...context, carrier: { request: {}, thrown } });
  assert.equal(unknown.outcome, "unresolved");
  assert.equal(unknown.effects.integrated, null);
  assert.equal(unknown.cause.code, "fixture.unknown");
  assert.deepEqual(unknown.next_calls, []);
  const partial = await integrationReadOutcome({ ...context, carrier: { request: {}, thrown,
    completed_recovery_result: { integrated: true, wk_sha: "b".repeat(40), cleanup: { state: "pending" } } } });
  assert.equal(partial.effects.integrated, true);
  assert.equal(partial.outcome, "partial");
  assert.equal(partial.cause.code, "fixture.unknown");
  assert.equal(partial.delivery.integrated_sha, "b".repeat(40));
});

test("delivery original read offers only role-eligible optional inspection", async () => {
  const carrier = { identity: { unit: subject }, outcome: { is_error: false, response: {
    commit_object: "created", delivery_ref: "advanced", submitted_for_review: true, checkout: "complete",
    transaction: { delivery_commit: "c".repeat(40), base_sha: "d".repeat(40),
      checkout: { state: "complete" } }
  } } };
  const context = { workspace: { repo: "fixture/repo" }, carrier, result, responseEnv: {}, requestContracts: contracts() };
  const coordinator = await deliveryReadOutcome({ ...context, role: "orchestrator" });
  assert.equal(coordinator.outcome, "delivered");
  assert.equal(coordinator.effects, undefined);
  assert.equal(coordinator.next_action, undefined);
  assert.deepEqual(coordinator.next_calls.map(call => call.arguments.detail?.member), ['changes', 'reviews']);
  assert.equal(coordinator.next_calls.some(call => call.tool === "workspace_deliver_work"), false);
  const worker = await deliveryReadOutcome({ ...context, role: "worker" });
  assert.equal(worker.recovery, undefined);
  assert.deepEqual(worker.next_calls.map(call => call.arguments.detail?.member), ['changes']);
  assert.equal(worker.next_calls.some(call => call.tool === "integrate_work"), false);
});
