import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerDispatchTools } from "./dispatch-tools.mjs";
import { prepareCommittedHeadGraphAdmission } from "./dispatch-tools/graph-admission.mjs";

const GRAPH = Object.freeze({ query_kind: "graph_impact_paths", committed_head_test_envelope: true });
const HANDOFF = Object.freeze({ authored_source_digest: "a", full_persistence_snapshot_digest: "b", reviewed_unit_digest: "c" });
const ready = (graph = "fresh", admission = "fresh") => ({ dispatchable: true, decision_code: "dispatchable", reasons: [], recovery: { graph_impact: graph, admission_metrics: admission, target_resolution: "not_required" } });

function harness({ initial = ready("recoverable_stale"), graphError = false } = {}) {
  const handlers = new Map();
  const calls = { graph: 0, admission: 0, backend: 0 };
  let validations = 0;
  registerDispatchTools({
    registerTool: (name, _definition, handler) => handlers.set(name, handler),
    registeredToolNames: new Set(["workspace_record_graph_impact_evidence"]), workspaceRepos: [], z,
    jsonContent: (value) => ({ structuredContent: value }), errorContent: (error) => { throw error; },
    resolveWorkspaceRepo: () => ({ repo: "demo", dir: "/resolved/repo" }), dispatchSessionIdentity: "wk1769",
    validateDispatch: async (options) => { validations += 1; if (options.node_engine_admissibility) return { ...ready(), admissibility: { status: "admit" } }; return validations === 1 ? initial : ready("fresh", "recoverable_missing"); },
    generateGraphImpactEvidence: async () => { calls.graph += 1; if (graphError) throw new Error("graph failed"); return { graph_available: true, graph_impact_envelope: GRAPH }; },
    refreshAdmissionEvidence: async () => { calls.admission += 1; return { written: true }; },
    validateLaunchIntent: async () => ({ readiness: ready(), private_handoff: HANDOFF }),
    revalidatePrivateHandoff: async () => ({ valid: true }),
    dispatchBackend: { startLaunch: async (input) => { calls.backend += 1; return { accepted: true, run_id: "wkdb_1769", monitor_handle: "wkmh_1769", app: "codex", model: "gpt-5", backend: "test", role: input.role, subject: input.subject, status: "launching", terminal: false, started_at: "2026-07-26T00:00:00Z", updated_at: "2026-07-26T00:00:00Z" }; } }
  });
  return { calls, invoke: async () => (await handlers.get("workspace_agent_dispatch")({ role: "worker", subject: "WK-1769#SLICE-001" })).structuredContent };
}

test("registered route uses the exported helper for one graph/admission preparation", async () => {
  assert.equal(typeof prepareCommittedHeadGraphAdmission, "function");
  const h = harness();
  assert.equal((await h.invoke()).accepted, true);
  assert.deepEqual(h.calls, { graph: 1, admission: 1, backend: 1 });
});

test("registered route preserves typed refusals and zero mutation", async (t) => {
  const cases = [["admission", { initial: ready("recoverable_stale", "nonrecoverable_malformed") }, "admission_evidence_nonrecoverable", 0], ["graph", { graphError: true }, "graph_impact_query_error", 1]];
  for (const [name, options, reason, graphCalls] of cases) await t.test(name, async () => {
    const h = harness(options); const result = await h.invoke();
    assert.equal(result.blocker.reason, reason);
    assert.deepEqual(h.calls, { graph: graphCalls, admission: 0, backend: 0 });
  });
});
