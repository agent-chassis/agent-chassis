

import test from "node:test";
import assert from "node:assert/strict";

import {
  orchestrateWorkerReadiness
} from "../../packages/wiki-mcp/src/lib/dispatch-tools/agent-dispatch-worker-readiness.mjs";
import {
  orchestrateAgentDispatchReadiness
} from "../../packages/wiki-mcp/src/lib/dispatch-tools/agent-dispatch-readiness.mjs";

const SUBJECT = "WK-2730#SLICE-001";
const HANDOFF = Object.freeze({
  authored_source_digest: "a", full_persistence_snapshot_digest: "b", reviewed_unit_digest: "c"
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

const MISSING_GRAPH_STATE = Object.freeze({
  graph_state: Object.freeze({ graph_available: false, staleness: "missing", edge_source: "unavailable" })
});

function ready({ graph = "recoverable_stale", admission = "fresh", dispatchable = true,
  decisionCode = "dispatchable" } = {}) {
  return {
    dispatchable,
    decision_code: decisionCode,
    reasons: dispatchable ? [] : [decisionCode],
    state: MISSING_GRAPH_STATE,
    recovery: { graph_impact: graph, admission_metrics: admission, target_resolution: "not_required" }
  };
}

function harness({ initial = ready(), cce = null } = {}) {
  const calls = { graph: 0, admission: 0, launchIntent: [], validate: [], handoff: 0 };
  const dependencies = {
    args: { role: "worker", subject: SUBJECT },
    workspace: { repo: "demo", dir: "/dev/null/workspace" },
    readinessDispatchRole: "implementation",
    launcherConfirmedNoCceAuthority: false,
    validateDispatch: async (options) => {
      calls.validate.push(options);
      if (!options.node_engine_admissibility) return initial;
      return cce ?? { ...ready({ graph: initial.recovery.graph_impact }), admissibility: CONFIRMED_NO_CCE_AUTHORITY };
    },
    validateLaunchIntent: async (options) => {
      calls.launchIntent.push(options);
      return { readiness: ready({ graph: initial.recovery.graph_impact }), private_handoff: HANDOFF };
    },
    revalidatePrivateHandoff: async () => { calls.handoff += 1; return { valid: true }; },

    generateGraphImpactEvidence: async () => { calls.graph += 1; throw new Error("graph producer entered"); },
    refreshAdmissionEvidence: async () => { calls.admission += 1; return { written: true }; },
    buildTransitionRefusal: (input) => ({ refused: true, ...input }),
    readinessFailure: (readiness) => ({ decision_code: readiness?.decision_code ?? null }),
    jsonContent: (value) => value
  };
  return { calls, dependencies };
}

const GRAPH_DEPENDENT_STATES = ["fresh", "recoverable_stale", "recoverable_missing", "recoverable_outdated",
  "nonrecoverable_missing_paths"];

for (const graph of GRAPH_DEPENDENT_STATES) {
  test(`a ${graph} graph is never prepared and every later phase stays suppressed`, async () => {
    const initial = ready({ graph });
    const { calls, dependencies } = harness({ initial });
    const result = await orchestrateWorkerReadiness({ ...dependencies, readiness: initial });

    assert.equal(result.response, null, JSON.stringify(result.response));
    assert.equal(calls.graph, 0, "no graph producer is entered");
    assert.equal(calls.launchIntent.length, 1);
    assert.equal(calls.validate.length, 2, "the revalidation and the one CCE evaluation");
    assert.equal(calls.handoff, 1);
    for (const options of [...calls.launchIntent, ...calls.validate]) {
      assert.equal(options.suppress_live_graph_resolution, true);
      assert.equal(options.mode, "strict");
      assert.equal(options.dispatch_role, "implementation");
      for (const fabricated of ["graph_impact", "graph_state", "graph_import_adjacency",
        "graph_preparation_failure"]) {
        assert.equal(Object.hasOwn(options, fabricated), false,
          `${fabricated} is not invented for an unassessed graph`);
      }
    }
    assert.equal(result.readiness.recovery.graph_impact, graph,
      "the reported graph classification is not relabelled");
  });
}

test("the full worker readiness route suppresses its initial pass and prepares nothing", async () => {
  const { calls, dependencies } = harness();
  const result = await orchestrateAgentDispatchReadiness({
    ...dependencies,
    subjectKind: "work_record",
    dispatchBackend: {},
    isPaidTier: false,
    loadReviewerSubjectAdmissionContext: async () => assert.fail("worker route loads no reviewer subject"),
    launcherTransitionFailures: {}
  });

  assert.equal(result.response, null, JSON.stringify(result.response));
  assert.equal(calls.graph, 0);
  assert.equal(calls.validate.length, 3, "initial readiness, its revalidation and the one CCE evaluation");
  assert.equal(calls.launchIntent.length, 1);
  for (const options of [...calls.validate, ...calls.launchIntent]) {
    assert.equal(options.suppress_live_graph_resolution, true);
    assert.equal(Object.hasOwn(options, "graph_impact"), false);
    assert.equal(Object.hasOwn(options, "graph_preparation_failure"), false);
  }
  assert.deepEqual(result.readiness.state, MISSING_GRAPH_STATE,
    "a missing graph stays reported as missing and unavailable");
});

test("a recoverable admission state is refreshed once without preparing the graph", async () => {
  const initial = ready({ admission: "recoverable_missing" });
  const { calls, dependencies } = harness({ initial });
  const result = await orchestrateWorkerReadiness({ ...dependencies, readiness: initial });

  assert.equal(result.response, null, JSON.stringify(result.response));
  assert.deepEqual([calls.graph, calls.admission], [0, 1]);
});

test("a graph-dependent unit that is not dispatchable refuses with its own cause before any later phase", async () => {
  const initial = ready({ dispatchable: false, decisionCode: "missing_validation" });
  const { calls, dependencies } = harness({ initial });
  const result = await orchestrateWorkerReadiness({ ...dependencies, readiness: initial });

  assert.equal(result.response.reason, "work_record_not_dispatchable");
  assert.deepEqual(result.response.failure, { decision_code: "missing_validation" });
  assert.deepEqual([calls.graph, calls.admission, calls.launchIntent.length, calls.validate.length, calls.handoff],
    [0, 0, 0, 1, 0]);
  assert.equal(calls.validate[0].suppress_live_graph_resolution, true);
});

test("a nonrecoverable admission state refuses before any later phase", async () => {
  const initial = ready({ admission: "nonrecoverable_malformed" });
  const { calls, dependencies } = harness({ initial });
  const result = await orchestrateWorkerReadiness({ ...dependencies, readiness: initial });

  assert.equal(result.response.reason, "admission_evidence_nonrecoverable");
  assert.deepEqual([calls.graph, calls.admission, calls.launchIntent.length, calls.validate.length, calls.handoff],
    [0, 0, 0, 0, 0]);
});

test("a CCE refusal keeps its cause and never reaches final handoff revalidation", async () => {
  const cce = {
    ...ready(),
    dispatchable: false,
    decision_code: "node_engine_not_admissible",
    admissibility: { ...CONFIRMED_NO_CCE_AUTHORITY, authority: "node_engine", status: "reject", effect: "reject",
      admissible: false, authenticated_request_sent: true, pack_backed: true, node_engine_backed: true }
  };
  const initial = ready();
  const { calls, dependencies } = harness({ initial, cce });
  const result = await orchestrateWorkerReadiness({ ...dependencies, readiness: initial });

  assert.notEqual(result.response, null, "a non-admitting CCE result refuses");
  assert.deepEqual([calls.graph, calls.handoff], [0, 0]);
  assert.equal(calls.validate.length, 2);
  assert.equal(calls.validate[1].suppress_live_graph_resolution, true);
});
