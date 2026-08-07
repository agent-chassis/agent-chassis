import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerCommittedSliceIntegrationRoute } from "./dispatch-tools/committed-slice-integration-route.mjs";

const SUBJECT = "WK-1784#SLICE-002";
function harness(requestCommittedSliceIntegration) {
  const calls = { backend: [], workspace: [] };
  let tool;
  registerCommittedSliceIntegrationRoute({
    registerTool: (name, config, handler) => { tool = { name, config, handler }; },
    workspaceRepos: [], z, jsonContent: (value) => value,
    resolveWorkspaceRepo: (...args) => { calls.workspace.push(args); return {}; },
    dispatchBackend: requestCommittedSliceIntegration && {
      requestCommittedSliceIntegration: async (request) => {
        calls.backend.push(request); return requestCommittedSliceIntegration(request);
      }
    },
    committedSliceIntegrationToolName: "workspace_integrate_committed_slice",
    callerNodeEngineAuthorityFields: ["node_engine"],
    callerCommittedSliceAuthorityFields: ["slice_ref"],
    callerCcePolicyAuthorityFields: ["authority"]
  });
  return {
    calls, tool,
    invoke: (args) => tool.handler(tool.config.inputSchema.parse(args))
  };
}

test("committed-slice integration route preserves registration and outcomes", async (t) => {
  await t.test("caller-authority refusal", async () => {
    const h = harness(async () => assert.fail("backend called"));
    assert.equal(h.tool.name, "workspace_integrate_committed_slice");
    assert.throws(() => h.tool.config.inputSchema.parse({ subject: SUBJECT, extra: true }));
    const result = await h.invoke({ subject: SUBJECT, slice_ref: "caller-ref", authority: {} });
    assert.deepEqual(result.blocker.detail.refused_fields, ["slice_ref", "authority"]);
    assert.deepEqual(h.calls, { backend: [], workspace: [] });
  });
  await t.test("invalid subject", async () => {
    const h = harness(async () => assert.fail("backend called"));
    const result = await h.invoke({ subject: "WK-1784" });
    assert.equal(result.blocker.reason, "committed_slice_integration_subject_invalid");
    assert.deepEqual(h.calls, { backend: [], workspace: [] });
  });
  await t.test("missing backend", async () => {
    const h = harness(null); const result = await h.invoke({ subject: SUBJECT, repo: "demo" });
    assert.equal(result.blocker.code, "backend_unavailable");
    assert.equal(h.calls.workspace.length, 1);
  });
  await t.test("accepted integration", async () => {
    const integration = { integrated: true, policy_posture: "free_substrate" };
    const h = harness(async () => integration);
    const dispositions = [{ review_run_id: "review-1", finding_id: "F-1", disposition: "defer" }];
    const result = await h.invoke({ subject: SUBJECT, dispositions });
    assert.deepEqual(result.integration, integration);
    assert.deepEqual(h.calls.backend, [{ subject: SUBJECT, dispositions }]);
  });
  await t.test("backend refusal", async () => {
    const refusal = { code: "cce_policy_denied", reason: "policy_denied" };
    const h = harness(async () => ({ integrated: false, refusal }));
    const result = await h.invoke({ subject: SUBJECT });
    assert.deepEqual([result.blocker.code, result.blocker.reason], ["validation_failure", "policy_denied"]);
    assert.deepEqual(result.blocker.detail, { cce_policy_refusal: refusal });
  });
  await t.test("thrown exception", async () => {
    const h = harness(async () => { throw new Error("integration exploded"); });
    const result = await h.invoke({ subject: SUBJECT });
    assert.deepEqual([result.blocker.code, result.blocker.reason],
      ["operator_recovery_needed", "dispatch_tool_exception"]);
  });
});
