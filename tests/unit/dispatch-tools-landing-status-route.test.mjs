import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerLandingStatusRoute } from
  "../../packages/wiki-mcp/src/lib/dispatch-tools/landing-status-route.mjs";

function harness(adapter) {
  const calls = { adapter: [], workspace: [] };
  let tool;
  registerLandingStatusRoute({
    registerTool: (name, config, handler) => { tool = { name, config, handler }; },
    workspaceRepos: [], z, jsonContent: (value) => value,
    resolveWorkspaceRepo: (...args) => { calls.workspace.push(args); return {}; },
    invokeWkLandingStatusAdapter: adapter && (async (unit) => {
      calls.adapter.push(unit);
      return adapter(unit);
    })
  });
  return { calls, tool };
}

test("the landing-status route is registered read-only with a closed input", () => {
  const { tool } = harness(null);
  assert.equal(tool.name, "workspace_wk_landing_status");
  assert.match(tool.config.description, /Read-only/u);
  assert.equal(tool.config.inputSchema.safeParse({ assigned_unit: "WK-2672", candidate: "x" }).success, false,
    "caller input cannot name candidate, ref or landing facts");
});

test("every landing observation state is a successful read carried unchanged", async () => {
  for (const state of ["awaiting_human_landing", "landed", "contradictory", "unavailable"]) {
    const landing = Object.freeze({ state, cause: state === "unavailable" ? { reason: "r" } : null });
    const h = harness(async () => ({ accepted: true, landing }));
    const result = await h.tool.handler({ assigned_unit: "WK-2672", repo: "demo" });
    assert.deepEqual(result, {
      schema_version: "workspace-wk-landing-status.v1",
      assigned_unit: "WK-2672",
      landing,
      blocker: null
    }, state);
    assert.deepEqual(h.calls.adapter, ["WK-2672"]);
  }
});

test("a malformed subject, an absent observer and an observer refusal refuse with no continuation", async () => {
  const invalid = harness(async () => assert.fail("adapter called"));
  const malformed = await invalid.tool.handler({ assigned_unit: "WK-1" });
  assert.equal(malformed.blocker.reason, "wk_landing_status_subject_invalid");
  assert.equal(malformed.refusal.no_supported_route, true);
  assert.deepEqual(invalid.calls, { adapter: [], workspace: [] });

  const absent = await harness(null).tool.handler({ assigned_unit: "WK-2672" });
  assert.equal(absent.blocker.code, "backend_unavailable");
  assert.equal(absent.blocker.reason, "wk_landing_status_observer_unavailable");

  const refusal = { ok: false, category: "request_invalid", detail: { reason: "invalid_request" } };
  const refused = await harness(async () => ({ accepted: false, refusal })).tool.handler({ assigned_unit: "WK-2672" });
  assert.equal(refused.blocker.reason, "wk_landing_status_refused");
  assert.deepEqual(refused.refusal.carried.landing_observer_refusal, refusal);

  const thrown = await harness(async () => { throw new Error("observer exploded"); })
    .tool.handler({ assigned_unit: "WK-2672" });
  assert.deepEqual([thrown.blocker.code, thrown.blocker.reason],
    ["mcp_response.handler_exception.v1", "dispatch_tool_exception"]);
});
