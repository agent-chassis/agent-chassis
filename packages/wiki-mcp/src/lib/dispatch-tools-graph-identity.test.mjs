import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { registerDispatchTools } from "./dispatch-tools.mjs";
import { prepareCommittedHeadGraphAdmission } from "./dispatch-tools/graph-admission.mjs";
import { allocateLauncherTransitionPlan } from "@agent-chassis/agent-launch-core/src/lib/launcher-transition-plan.mjs";
import { SidecarGraphIndexUnbuildableError } from "../../../wiki-core/src/lib/sidecar-graph-impact-artifact.mjs";

const GRAPH = Object.freeze({ query_kind: "graph_impact_paths", committed_head_test_envelope: true });
const HANDOFF = Object.freeze({ authored_source_digest: "a", full_persistence_snapshot_digest: "b", reviewed_unit_digest: "c" });
const ready = (graph = "fresh", admission = "fresh") => ({ dispatchable: true, decision_code: "dispatchable", reasons: [], recovery: { graph_impact: graph, admission_metrics: admission, target_resolution: "not_required" } });

const ROUTING = Object.freeze({
  ok: true, role: "worker", subject: "WK-1769#SLICE-001", target: "WK-1769#SLICE-001",
  target_role: "worker", routeKind: "slice", app: "codex", model: "fixture-model", backend: "codex"
});

const CONFIRMED_NO_CCE_AUTHORITY = Object.freeze({
  evaluated: true,
  authority: "local_only_config",
  status: "local_only_fail_open",
  effect: "local_only_fail_open",
  admissible: true,
  authenticated_request_sent: false,
  pack_backed: false,
  node_engine_backed: false,
  binding_status: null
});

function harness({ initial = ready("recoverable_stale"), graphError = false } = {}) {
  const handlers = new Map();
  const calls = { graph: 0, admission: 0, backend: 0 };
  const phases = [];
  let validations = 0;
  registerDispatchTools({
    registerTool: (name, _definition, handler) => handlers.set(name, handler),
    registeredToolNames: new Set(["workspace_record_graph_impact_evidence"]), workspaceRepos: [], z,
    jsonContent: (value) => ({ structuredContent: value }), errorContent: (error) => { throw error; },
    resolveWorkspaceRepo: () => ({ repo: "demo", dir: "/resolved/repo" }), dispatchSessionIdentity: "wk1769",
    validateDispatch: async (options) => { validations += 1; phases.push(options); if (options.node_engine_admissibility) return { ...ready(), admissibility: CONFIRMED_NO_CCE_AUTHORITY }; return validations === 1 ? initial : ready("fresh", "recoverable_missing"); },
    generateGraphImpactEvidence: async () => { calls.graph += 1; if (graphError) throw new SidecarGraphIndexUnbuildableError("graph failed", { code: "base_artifact_corrupt" }); return { graph_available: true, graph_impact_envelope: GRAPH }; },
    refreshAdmissionEvidence: async () => { calls.admission += 1; return { written: true }; },
    validateLaunchIntent: async (options) => { phases.push(options); return { readiness: ready(), private_handoff: HANDOFF }; },
    revalidatePrivateHandoff: async () => ({ valid: true }),
    dispatchBackend: { resolveBackendRoutingDecision: () => ROUTING, startLaunch: async (input) => { calls.backend += 1; return { accepted: true, run_id: "wkdb_1769", monitor_handle: "wkmh_1769", app: ROUTING.app, model: ROUTING.model, backend: ROUTING.backend, role: input.role, subject: input.subject, status: "launching", terminal: false, started_at: "2026-07-26T00:00:00Z", updated_at: "2026-07-26T00:00:00Z", launcher_transition_plan: allocateLauncherTransitionPlan(input.launcher_transition_plan, { subject: input.subject, selection: ROUTING, readiness: input.readiness }) }; } }
  });
  return { calls, phases, invoke: async () => (await handlers.get("workspace_agent_dispatch")({ role: "worker", subject: "WK-1769#SLICE-001" })).structuredContent };
}

test("registered route uses the exported helper for one graph/admission preparation", async () => {
  assert.equal(typeof prepareCommittedHeadGraphAdmission, "function");
  const h = harness();
  assert.equal((await h.invoke()).accepted, true);
  assert.deepEqual(h.calls, { graph: 1, admission: 1, backend: 1 });
});

test("registered route preserves typed admission refusals and zero mutation", async () => {
  const h = harness({ initial: ready("recoverable_stale", "nonrecoverable_malformed") });
  const result = await h.invoke();
  assert.equal(result.blocker.reason, "admission_evidence_nonrecoverable");
  assert.deepEqual(h.calls, { graph: 0, admission: 0, backend: 0 });
});

test("a failed graph preparation is captured once and reused without refusing dispatch", async () => {
  const h = harness({ graphError: true });
  const result = await h.invoke();

  assert.equal(result.accepted, true);
  assert.deepEqual(h.calls, { graph: 1, admission: 1, backend: 1 });

  const later = h.phases.slice(1);
  assert.equal(later.length, 3);
  const captured = later[0].graph_preparation_failure;
  assert.equal(captured.code, "base_artifact_corrupt");
  for (const options of later) {
    assert.equal(options.graph_preparation_failure, captured);
    assert.equal(Object.hasOwn(options, "graph_impact"), false);
  }
});
