import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { registerLandingStatusRoute } from
  "../../packages/wiki-mcp/src/lib/dispatch-tools/landing-status-route.mjs";
import { DISPATCH_FAILURE_ORIGINALS } from "../../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

function harness(adapter, responseEnv = undefined) {
  const calls = { adapter: [], workspace: [] };
  let tool;
  registerLandingStatusRoute({
    registerTool: (name, config, handler) => { tool = { name, config, handler }; },
    ...(responseEnv === undefined ? {} : { responseEnv }),
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

  const { detail: observerDetail, ...observerIdentity } = refusal;
  assert.deepEqual(refused.refusal.carried.landing_observer_refusal, observerIdentity);
  assert.deepEqual(refused.blocker.detail.refusal, { ...observerIdentity, detail: observerDetail });

  const thrown = await harness(async () => { throw new Error("observer exploded"); })
    .tool.handler({ assigned_unit: "WK-2672" });
  assert.deepEqual([thrown.blocker.code, thrown.blocker.reason],
    ["mcp_response.handler_exception.v1", "dispatch_tool_exception"]);
});

function spillInventory(stateDir) {
  try {
    return readdirSync(stateDir, { recursive: true }).map(String).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

test("an observed landing cause is published as its specific cause; repeated reads withhold raw output and write nothing", async (t) => {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "landing-status-state-"));
  scope.add("response-state-dir", () => rmSync(stateDir, { recursive: true, force: true }));
  const carrier = Object.freeze({ schema_version: "landed-publication.v1", commit: "a".repeat(40) });
  const landing = { state: "unavailable", landed_publication: carrier, cause: {
    code: "agent_launch.wk_landing.observation_failed.v1", stage: "remote_query",
    native: { argv: ["git", "ls-remote"], stdout: "y".repeat(2048) },
    evidence: { schema_version: "agent_launch.diagnostic_evidence.v1", value: {
      $type: "Error", name: "Error", message: "remote query failed", stack: "Error: remote query failed\n    at /opt/y.mjs:2:2",
      properties: { code: "agent_launch.wk_landing.observation_failed.v1" } }, segments: [], capture_failures: [] } } };
  const refusal = { ok: false, category: "observation_failed",
    detail: { reason: "remote_query_failed", stderr: "RAW-LANDING-STDERR" } };
  const h = harness(async (unit) => (unit === "WK-2672"
    ? { accepted: true, landing } : { accepted: false, refusal }), { WIKI_MCP_RESPONSE_STATE_DIR: stateDir });
  const reads = [];
  for (let index = 0; index < 3; index += 1) {
    reads.push(await h.tool.handler({ assigned_unit: "WK-2672" }));
    reads.push(await h.tool.handler({ assigned_unit: "WK-2673" }));
  }
  const [observed, refused] = reads;
  assert.equal(observed.blocker, null);
  assert.equal(observed.landing.state, "unavailable");
  assert.deepEqual(observed.landing.landed_publication, carrier, "the landed carrier crosses unchanged");
  assert.equal(observed.landing.cause.code, "agent_launch.wk_landing.observation_failed.v1");
  assert.equal(observed.landing.cause.stage, "remote_query");
  assert.deepEqual(observed.landing.cause.native, { argv: ["git", "ls-remote"] },
    "the native invocation facts stay; only its captured output is withheld");
  assert.deepEqual(observed.landing.cause.evidence.cause_chain, [{ name: "Error",
    code: "agent_launch.wk_landing.observation_failed.v1", message: "remote query failed" }]);
  assert.deepEqual(observed.landing.cause.retained_evidence, {
    ...DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION, audience: "operator",
    fields: ["detail.native.stdout", "detail.evidence"]
  });
  assert.equal(refused.blocker.reason, "wk_landing_status_refused");
  assert.equal(refused.blocker.detail.refusal.detail.reason, "remote_query_failed");
  assert.deepEqual(refused.blocker.detail.refusal.detail.retained_evidence.fields, ["detail.stderr"]);
  for (const [index, read] of reads.entries()) {
    assert.deepEqual(read, reads[index % 2], "every read of the same observation answers identically");
    const serialized = JSON.stringify(read);
    for (const raw of ["y".repeat(2048), "/opt/y.mjs", "RAW-LANDING-STDERR", "ref_id"]) {
      assert.equal(serialized.includes(raw), false, `read ${index} published ${raw}`);
    }
  }
  assert.deepEqual(spillInventory(stateDir), [], "no landing read, successful or refused, retains an artifact");
  assert.deepEqual(h.calls.adapter, ["WK-2672", "WK-2673", "WK-2672", "WK-2673", "WK-2672", "WK-2673"]);
});
