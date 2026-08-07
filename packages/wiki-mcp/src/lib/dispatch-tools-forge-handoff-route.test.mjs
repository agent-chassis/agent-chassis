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
