import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerForgeHandoffRoute } from "../../packages/wiki-mcp/src/lib/dispatch-tools/forge-handoff-route.mjs";
function harness(adapter) {
  const calls = { adapter: [], workspace: [] };
  let tool;
  registerForgeHandoffRoute({
    registerTool: (name, config, handler) => { tool = { name, config, handler }; },
    workspaceRepos: [], z, jsonContent: (value) => value,
    resolveWorkspaceRepo: (...args) => { calls.workspace.push(args); return {}; },
    invokeWkForgeHandoffAdapter: adapter && (async (unit) => {
      calls.adapter.push(unit); return adapter(unit);
    })
  });
  return { calls, tool };
}
test("forge handoff route preserves registration and refusal/acceptance paths", async (t) => {
  await t.test("invalid assigned unit", async () => {
    const h = harness(async () => assert.fail("adapter called"));
    assert.equal((await h.tool.handler({ assigned_unit: "WK-1" })).blocker.reason, "wk_forge_handoff_subject_invalid");
    assert.deepEqual(h.calls, { adapter: [], workspace: [] });
  });
  await t.test("missing backend", async () => {
    const h = harness(null); const result = await h.tool.handler({ assigned_unit: "WK-1784" });
    assert.equal(result.blocker.code, "backend_unavailable");
  });
  await t.test("accepted handoff", async () => {
    const handoff = { kind: "handed_off" }; const h = harness(async () => ({ accepted: true, forge_handoff: handoff }));
    const result = await h.tool.handler({ assigned_unit: "WK-1784", repo: "demo" });
    assert.deepEqual(result.forge_handoff, handoff); assert.deepEqual(h.calls.adapter, ["WK-1784"]);
  });
  await t.test("accepted handoff publishes only an observed live-record fact", async () => {
    const fact = "forge_handoff.live_record_published";
    for (const value of [true, false]) {
      const handoff = { kind: "handed_off", live_record_published: value };
      const result = await harness(async () => ({ accepted: true, forge_handoff: handoff }))
        .tool.handler({ assigned_unit: "WK-1784" });
      assert.deepEqual(result.observed_facts, { [fact]: value });
    }

    const unobserved = { reason: "closeout_chain_unobservable", observation: "parent" };
    const handoff = { kind: "handed_off", live_record_published_unobserved: unobserved };
    const result = await harness(async () => ({ accepted: true, forge_handoff: handoff }))
      .tool.handler({ assigned_unit: "WK-1784" });
    assert.equal(Object.hasOwn(result, "observed_facts"), false);
    assert.deepEqual(result.forge_handoff.live_record_published_unobserved, unobserved);
    assert.equal(Object.hasOwn(await harness(async () => ({ accepted: true, forge_handoff: { kind: "handed_off" } }))
      .tool.handler({ assigned_unit: "WK-1784" }), "observed_facts"), false);
  });
  await t.test("mapped backend refusal", async () => {
    const h = harness(async () => ({ accepted: false, refusal: { code: "backend_unavailable", reason: "forge_offline", detail: { category: "transport" } } }));
    const result = await h.tool.handler({ assigned_unit: "WK-1784" });
    assert.deepEqual([result.blocker.code, result.blocker.reason], ["backend_unavailable", "forge_offline"]);
  });
  await t.test("thrown backend exception", async () => {
    const h = harness(async () => { throw new Error("forge exploded"); });
    const result = await h.tool.handler({ assigned_unit: "WK-1784" });
    assert.deepEqual([result.blocker.code, result.blocker.reason],
      ["mcp_response.handler_exception.v1", "dispatch_tool_exception"]);
  });
});

test("every forge-handoff refusal carries a deciding fact and one explicit limb", async (t) => {
  const cases = [
    {
      name: "malformed assigned unit",
      adapter: async () => assert.fail("adapter called"),
      args: { assigned_unit: "WK-1" },
      code: "validation_failure",
      fact: ["forge_handoff.assigned_unit_wellformed", false]
    },
    {
      name: "absent forge executor",
      adapter: null,
      args: { assigned_unit: "WK-1784" },
      code: "backend_unavailable",
      fact: ["forge_handoff.executor_registered", false]
    },
    {
      name: "executor refusal",
      adapter: async () => ({
        accepted: false,
        refusal: { code: "backend_unavailable", reason: "forge_offline", category: "transport" }
      }),
      args: { assigned_unit: "WK-1784" },
      code: "backend_unavailable",
      fact: ["forge_handoff.executor_accepted", false]
    }
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const result = await harness(item.adapter).tool.handler(item.args);
      const refusal = result.refusal;
      assert.equal(refusal.code, item.code);
      assert.equal(refusal.code, result.blocker.code, "the transport projects the carrier's code");
      const facts = Object.fromEntries(refusal.deciding_facts.map((f) => [f.field, f.value]));
      assert.equal(facts[item.fact[0]], item.fact[1]);

      assert.equal(refusal.no_supported_route, true);
      assert.equal(Object.hasOwn(refusal, "next_calls"), false);
      assert.equal(refusal.recovery.state, "no_supported_route");

      const again = await harness(item.adapter).tool.handler(item.args);
      assert.deepEqual(again.refusal, refusal);
    });
  }
});

test("an executor refusal crosses unchanged and a thrown diagnostic remains non-authoritative", async () => {
  const executorRefusal = {
    code: "backend_unavailable",
    reason: "forge_offline",
    category: "transport",
    detail: { operator_action: "restore the forge executor" }
  };
  const mapped = await harness(async () => ({ accepted: false, refusal: executorRefusal })).tool
    .handler({ assigned_unit: "WK-1784" });

  const { detail: executorDetail, ...executorIdentity } = executorRefusal;
  assert.deepEqual(mapped.refusal.carried.forge_executor_refusal, executorIdentity);
  assert.deepEqual(mapped.blocker.detail, executorDetail);

  const thrown = await harness(async () => {
    throw new Error("forge exploded at /home/ordinary/path");
  }).tool
    .handler({ assigned_unit: "WK-1784" });
  assert.equal(
    thrown.refusal.deciding_facts.some(
      (fact) => fact.field === "forge_handoff.thrown_diagnostic"
    ),
    false
  );
  assert.equal(thrown.blocker.detail.error_message,
    "forge exploded at /home/ordinary/path");
  assert.deepEqual(thrown.blocker.detail.cause_chain,
    [{ name: "Error", message: "forge exploded at /home/ordinary/path" }]);
  const serialized = JSON.stringify(thrown.refusal);
  assert.equal(serialized.includes("/home/ordinary/path"), false,
    "diagnostics stay outside refusal authority");
  assert.equal(serialized.includes("forge exploded"), false, "no raw producer text reaches the carrier");
});

test("selected forge refusal preserves CCE meaning and explicit operator authority", async () => {
  const policy = Object.freeze({ schema_version: "cce-returned-policy.v1", decision: "deny",
    reasons: ["forge_publication_requires_operator_confirmation"],
    remediation: { actor: "operator", action: "confirm the forge publication" },
    authority_binding: { digest: `sha256:${"c".repeat(64)}` } });
  const executorRefusal = {
    schema_version: "wk-forge-handoff-refusal.v1",
    code: "agent_launch.wk_forge_handoff.git_transport_failed.v1",
    category: "git_failed",
    reason: "wk_forge_handoff_git_failed",
    detail: {
      category: "git_failed",
      stage: "landing_base",
      responsible_actor: "operator",
      operator_action: "restore push access to the configured forge remote",
      exact_returned_policy: policy,
      process: { status: 128, stdout: "x".repeat(4096), stderr: "fatal: remote rejected" },
      evidence: { schema_version: "agent_launch.diagnostic_evidence.v1", value: {
        $type: "Error", name: "Error", message: "git push failed", stack: "Error: git push failed\n    at /opt/x.mjs:1:1",
        properties: { code: "agent_launch.wk_forge_handoff.git_transport_failed.v1" },
        cause: { $type: "Error", name: "Error", message: "exit 128", properties: { stderr: "fatal: remote rejected" } } },
        segments: [], capture_failures: [] }
    }
  };
  const result = await harness(async () => ({ accepted: false, refusal: executorRefusal })).tool
    .handler({ assigned_unit: "WK-1784" });

  assert.equal(result.refusal.code, result.blocker.code);
  assert.equal(result.blocker.reason, "wk_forge_handoff_git_failed");
  const { detail: _detail, ...identity } = executorRefusal;
  assert.deepEqual(result.refusal.carried.forge_executor_refusal, identity);

  const detail = result.blocker.detail;
  assert.deepEqual(detail.exact_returned_policy, policy);
  assert.equal(detail.responsible_actor, "operator");
  assert.equal(detail.operator_action, "restore push access to the configured forge remote");
  assert.equal(detail.stage, "landing_base");
  assert.equal(detail.process.status, 128);

  assert.deepEqual(detail.evidence.cause_chain, [
    { name: "Error", code: "agent_launch.wk_forge_handoff.git_transport_failed.v1", message: "git push failed" },
    { name: "Error", message: "exit 128" }
  ]);
  assert.equal(Object.hasOwn(detail.process, "stdout"), false);
  assert.equal(Object.hasOwn(detail.process, "stderr"), false);
  assert.equal(detail.retained_evidence.retained, true);
  assert.equal(detail.retained_evidence.audience, "operator");
  assert.deepEqual([...detail.retained_evidence.fields].sort(),
    ["detail.evidence", "detail.process.stderr", "detail.process.stdout"]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("x".repeat(4096)), false);
  assert.equal(serialized.includes("/opt/x.mjs"), false);

  assert.equal(result.refusal.no_supported_route, true);
  assert.equal(Object.hasOwn(result.refusal, "next_calls"), false);
  assert.equal(result.refusal.recovery.state, "no_supported_route");

  assert.equal(result.refusal.recovery.responsible_actor, "operator");
  assert.equal(result.refusal.recovery.operator_action,
    "restore push access to the configured forge remote");
});

test("an acceptance.validation drift proposal is offered only exactly, and its unavailability is stated", async () => {
  const { ACCEPTANCE_VALIDATION_DRIFT_GUIDANCE } = await import(
    "../../packages/agent-launch-cli/src/lib/wk-forge-handoff.mjs");
  const drift = { unit: "WK-1784", candidate: "c".repeat(40), field: "acceptance.validation",
    candidate_value: ["v"], observed_value: ["v", "limitation"], observed_source_digest: "0123456789abcdef",
    cas_argument: "expected_source_digest" };
  const refusalWith = (detail) => async () => ({ accepted: false, refusal: {
    code: "agent_launch.wk_forge_handoff.eligibility_refused.v1", category: "eligibility",
    detail: { stage: "closeout", reason: "local_WK_not_authenticated_against_candidate", ...detail } } });
  const exact = { projection: { reason: "unrelated_record_drift", fields: ["acceptance.validation"] },
    acceptance_validation_drift: drift, recovery: ACCEPTANCE_VALIDATION_DRIFT_GUIDANCE };

  const unavailable = await harness(refusalWith(exact)).tool.handler({ assigned_unit: "WK-1784" });
  assert.equal(unavailable.refusal.no_supported_route, true);
  assert.equal(unavailable.refusal.recovery.responsible_actor, "coordinator");
  assert.match(unavailable.refusal.recovery.explanation, /cannot be offered by this server: missing active_registered_tool_set, request_schema:workspace_tools_describe/u);
  assert.deepEqual(unavailable.blocker.detail.acceptance_validation_drift, drift);
  assert.equal(Object.hasOwn(unavailable.blocker.detail, "recovery"), false);

  for (const [label, detail] of [
    ["tampered proposal", { ...exact, recovery: { ...ACCEPTANCE_VALIDATION_DRIFT_GUIDANCE, route: "workspace_work_record_edit" } }],
    ["another unit", { ...exact, acceptance_validation_drift: { ...drift, unit: "WK-0001" } }],
    ["validation beside other drift", { ...exact,
      projection: { reason: "unrelated_record_drift", fields: ["acceptance.criteria", "acceptance.validation"] } }],
    ["genuine requirement drift", { projection: { reason: "unrelated_record_drift", fields: ["acceptance.criteria"] } }]
  ]) {
    const result = await harness(refusalWith(detail)).tool.handler({ assigned_unit: "WK-1784" });
    assert.equal(result.refusal.no_supported_route, true, label);
    assert.equal(result.refusal.recovery.responsible_actor, null, label);
    assert.deepEqual(result.blocker.detail.projection, detail.projection, label);
  }
});
