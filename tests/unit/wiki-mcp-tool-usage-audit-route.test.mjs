import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import * as boundaryModule from "../../packages/wiki-mcp/src/lib/tool-usage-audit-mcp-tools.mjs";
import * as compositionHelpers from "../../packages/wiki-mcp/src/lib/server-composition-helpers.mjs";
import { projectPublicVerifyProofRefusal, projectVerifyProofFailure } from
  "../../packages/wiki-mcp/src/lib/verify-proof-public-result.mjs";
import { TestProofRuntimeIdentityError } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-runtime-identity.mjs";
import { ControlledContractToolError } from
  "../../packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs";

test("the live tool-usage audit route, event ring, and production origin context are retired", async () => {

  assert.deepEqual(Object.keys(boundaryModule).sort(), ["createToolUsageAuditBoundaryRecorder"]);
  assert.deepEqual(
    Object.keys(boundaryModule.createToolUsageAuditBoundaryRecorder()).sort(),
    ["observeToolCall", "wrapHandler"]
  );

  await assert.rejects(
    import(new URL("../../packages/wiki-mcp/src/lib/tool-usage-audit/live-recorder.mjs", import.meta.url).href),
    { code: "ERR_MODULE_NOT_FOUND" }
  );

  for (const retired of [
    "createProductionToolUsageAuditOrigin",
    "createProductionToolUsageAuditSelectedContext"
  ]) {
    assert.equal(retired in compositionHelpers, false, `${retired} is retired`);
  }

  const serverSource = await readFile(
    new URL("../../packages/wiki-mcp/src/server.mjs", import.meta.url),
    "utf8"
  );
  for (const retired of [
    "registerToolUsageAuditTools",
    "createProductionToolUsageAudit",
    "tool_usage_audit_recorder_error"
  ]) {
    assert.equal(serverSource.includes(retired), false, `server.mjs no longer references ${retired}`);
  }
});

const SENTINEL = "trajectory-sentinel-6f1d";

function trajectoryHarness({ monotonicNs = undefined } = {}) {
  const records = [];
  const writer = { enqueue: (record) => records.push(record), countHealth: () => {} };
  const recorder = boundaryModule.createToolUsageAuditBoundaryRecorder({
    writer, now: () => new Date("2026-09-27T10:15:00.000Z"),
    ...(monotonicNs === undefined ? {} : { monotonicNs })
  });
  const calls = [];
  const tools = new Map();
  const register = (name, respond) => {
    tools.set(name, recorder.wrapHandler(name, async (args) => {
      calls.push({ name, args });
      return respond(args);
    }));
  };
  const trajectories = () => records.filter((record) => record.kind === "trajectory")
    .map(({ tool, correlation, trajectory }) => [tool, correlation, trajectory]);
  return { records, calls, register, call: (name, args) => tools.get(name)(args), trajectories };
}

const structured = (value) => ({ content: [], structuredContent: value });

test("an emitted proof authoring query is followed but does not prove prerequisite repair", async () => {
  const h = trajectoryHarness();
  const correction = { tool: "workspace_controlled_contract_obligation_coverage_query",
    arguments: { unit: "WK-2716" } };
  const refusal = projectPublicVerifyProofRefusal(projectVerifyProofFailure(
    new TestProofRuntimeIdentityError("test_proof_test_selector_invalid", "invalid selector", {
      package_code: "stable_test_proof_selector_invalid",
      authority_limb: "mechanical_failure", admissibility_effect: "none",
      recovery_call: correction
    }), { subject: "OBL-1" }));
  assert.deepEqual(refusal.next_calls, [{ ...correction, recommended: true }]);
  h.register("workspace_verify_proof", () => ({ ...structured(refusal), isError: true }));
  h.register(correction.tool, () => structured({ unit: "WK-2716" }));
  await h.call("workspace_verify_proof", { subject: "OBL-1" });
  await h.call(correction.tool, correction.arguments);
  assert.deepEqual(h.trajectories(), [
    ["workspace_verify_proof", "none", "unobserved"],
    [correction.tool, "refusal_replacement", "refusal_recovery_unassessed"]
  ]);
});

test("an emitted source inspection read does not count as recovered verification", async () => {
  const h = trajectoryHarness();
  const subject = "test-proof-choice";
  const sources = [{ unit: "WK-2716" }, { unit: "WK-2716", focus: "scale" }];
  const original = projectVerifyProofFailure(new ControlledContractToolError(
    "verify_proof.source_tuple_ambiguous.v1", "source is ambiguous",
    { authority_limb: "mechanical_failure", subject, match_count: 2,
      source_choices: sources, choice_count: 2 }), { subject, request: { subject } });
  const readCall = (source) => ({ tool: "workspace_verify_proof", recommended: false,
    arguments: { subject, source, result: { ref_id: "choice", sha256: "a".repeat(64) } } });
  const fits = () => true;
  const overview = projectPublicVerifyProofRefusal(original, { readCall, fits });
  const selected = projectPublicVerifyProofRefusal(original,
    { readCall, fits, selectedSource: sources[1] });
  h.register("workspace_verify_proof", (args) => ({ ...structured(
    args.result === undefined ? overview : selected), isError: true }));
  await h.call("workspace_verify_proof", { subject });
  await h.call(overview.next_calls[1].tool, overview.next_calls[1].arguments);
  assert.deepEqual(h.trajectories(), [
    ["workspace_verify_proof", "none", "unobserved"],
    ["workspace_verify_proof", "refusal_replacement", "refusal_recovery_unassessed"]
  ]);
  assert.deepEqual(selected.next_calls[0].arguments, original.recovery.choices[1].arguments);
});

test("trajectory observations follow correlated next calls and preserve unknown cases", async () => {
  const h = trajectoryHarness();
  h.register("workspace_tool_router_recommend", () => structured({ next_calls: [
    { tool: "workspace_work_record_summary", arguments: { unit: "WK-2716" }, recommended: true },
    { tool: "workspace_read_page", arguments: { id: "WK-2716" } }
  ] }));
  h.register("workspace_work_record_summary", (args) => structured(args.unit === "WK-2716" ? {
    unit: args.unit, next_calls: [
      { tool: "workspace_read_page", arguments: { unit: "WK-2716" }, recommended: true },
      { tool: "workspace_search", arguments: { query: "WK-2716" }, disallowed: true }
    ] } : { unit: args.unit }));
  h.register("workspace_read_page", () => structured({ page: SENTINEL }));
  h.register("workspace_search", () => structured({ results: [] }));
  let recovers = true;
  h.register("workspace_agent_run_status", (args) => args.recovered === undefined
    ? structured({ refusal: { code: "selected_response_snapshot_unavailable", next_calls: [{
      tool: "workspace_agent_run_status", arguments: { subject: "WK-2716", recovered: "yes" },
      success_predicate: { fact: "monitor.detail_read", operator: "is_true" } }] } })
    : structured({ observed_facts: { "monitor.detail_read": recovers } }));

  await h.call("workspace_tool_router_recommend", { task: SENTINEL });

  await h.call("workspace_work_record_summary", { unit: "WK-2716" });

  await h.call("workspace_read_page", { unit: "WK-2716" });

  await h.call("workspace_tool_router_recommend", { task: SENTINEL });
  await h.call("workspace_search", { query: SENTINEL });
  await h.call("workspace_tool_router_recommend", { task: SENTINEL });
  await h.call("workspace_read_page", { id: "WK-2716" });

  await h.call("workspace_work_record_summary", { unit: "WK-2716" });
  await h.call("workspace_search", { query: "WK-2716" });

  await h.call("workspace_agent_run_status", { subject: "WK-2716" });
  await h.call("workspace_agent_run_status", { subject: "WK-2716", recovered: "yes" });
  recovers = false;
  await h.call("workspace_agent_run_status", { subject: "WK-2716" });
  await h.call("workspace_agent_run_status", { subject: "WK-2716", recovered: "yes" });

  assert.deepEqual(h.trajectories(), [
    ["workspace_tool_router_recommend", "none", "unobserved"],
    ["workspace_work_record_summary", "router_recommendation", "followed"],
    ["workspace_read_page", "emitted_next_calls", "followed"],
    ["workspace_tool_router_recommend", "none", "unobserved"],
    ["workspace_search", "router_recommendation", "wrong_first_tool"],
    ["workspace_tool_router_recommend", "none", "unobserved"],
    ["workspace_read_page", "router_recommendation", "allowed_alternative"],
    ["workspace_work_record_summary", "none", "unobserved"],
    ["workspace_search", "emitted_next_calls", "ignored_recommendation"],
    ["workspace_agent_run_status", "none", "unobserved"],
    ["workspace_agent_run_status", "refusal_replacement", "refusal_recovered"],
    ["workspace_agent_run_status", "none", "unobserved"],
    ["workspace_agent_run_status", "refusal_replacement", "refusal_not_recovered"]
  ]);

  assert.equal(h.calls.length, 13);

  assert.equal(JSON.stringify(h.records).includes(SENTINEL), false);
  assert.equal(JSON.stringify(h.records).includes("WK-2716"), false);
  for (const record of h.records.filter((entry) => entry.kind === "trajectory")) {
    assert.deepEqual(Object.keys(record), ["schema_version", "kind", "hour_utc", "clock_status", "tool",
      "correlation", "trajectory"]);
  }
});

test("a refusal replacement whose follow-up publishes no facts is not assessable, and overlap is unknown", async () => {
  const h = trajectoryHarness({ monotonicNs: () => { throw new Error("clock unavailable"); } });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  h.register("workspace_agent_run_status", async (args) => args.retry === undefined
    ? structured({ refusal: { next_calls: [{ tool: "workspace_agent_run_status",
      arguments: { retry: true }, success_predicate: { fact: "monitor.detail_read", operator: "is_true" } }] } })
    : structured({ accepted: true }));
  h.register("workspace_read_page", async () => { await gate; return structured({ next_calls: [
    { tool: "workspace_agent_run_status", arguments: {}, recommended: true }] }); });

  await h.call("workspace_agent_run_status", {});
  await h.call("workspace_agent_run_status", { retry: true });

  const slow = h.call("workspace_read_page", {});
  await h.call("workspace_agent_run_status", {});
  release();
  await slow;
  await h.call("workspace_agent_run_status", {});

  assert.deepEqual(h.trajectories(), [
    ["workspace_agent_run_status", "none", "unobserved"],
    ["workspace_agent_run_status", "refusal_replacement", "refusal_recovery_unassessed"],
    ["workspace_agent_run_status", "none", "concurrent_unknown"],
    ["workspace_read_page", "none", "concurrent_unknown"],
    ["workspace_agent_run_status", "none", "unobserved"]
  ]);

  assert.ok(h.records.filter((record) => record.kind === "call")
    .every((record) => record.duration_status === "clock_unavailable"));
});
