import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerForgeHandoffRoute } from "./dispatch-tools/forge-handoff-route.mjs";
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
  await t.test("mapped backend refusal", async () => {
    const h = harness(async () => ({ accepted: false, refusal: { code: "backend_unavailable", reason: "forge_offline", detail: { category: "transport" } } }));
    const result = await h.tool.handler({ assigned_unit: "WK-1784" });
    assert.deepEqual([result.blocker.code, result.blocker.reason], ["backend_unavailable", "forge_offline"]);
  });
  await t.test("thrown backend exception", async () => {
    const h = harness(async () => { throw new Error("forge exploded"); });
    const result = await h.tool.handler({ assigned_unit: "WK-1784" });
    assert.deepEqual([result.blocker.code, result.blocker.reason], ["operator_recovery_needed", "dispatch_tool_exception"]);
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
  assert.deepEqual(mapped.refusal.carried.forge_executor_refusal, executorRefusal);

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
  assert.deepEqual(thrown.blocker.detail.error_message_redactions, []);
  const serialized = JSON.stringify(thrown.refusal);
  assert.equal(serialized.includes("/home/ordinary/path"), false,
    "diagnostics stay outside refusal authority");
  assert.equal(serialized.includes("forge exploded"), false, "no raw producer text reaches the carrier");
});
