

import test from "node:test";
import assert from "node:assert/strict";

import {
  prepareCommittedHeadGraphAdmission
} from "../../packages/wiki-mcp/src/lib/dispatch-tools/graph-admission.mjs";
import {
  getRuntimeBlockerEntry
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const READINESS = Object.freeze({
  dispatchable: false,
  decision_code: "missing_graph_impact",
  recovery: Object.freeze({ graph_impact: "recoverable_stale", admission_metrics: "fresh" })
});

const REVALIDATED_READINESS = Object.freeze({
  dispatchable: true,
  decision_code: "dispatchable",
  recovery: Object.freeze({ graph_impact: "fresh", admission_metrics: "fresh" })
});

const ENVELOPE = Object.freeze({ schema_version: "graph-impact.v1", paths: [] });

function boundedRecoveryDetail(readiness, extra = {}) {
  return {
    readiness_decision_code: readiness?.decision_code ?? null,
    recovery: readiness?.recovery ?? null,
    ...extra
  };
}

function graphDerivationRequiredForDispatch(state) {
  return state === "fresh" || state === "recoverable_stale" || state === "recoverable_missing";
}

async function prepare({ generate, readiness = READINESS } = {}) {
  const validateCalls = [];
  const result = await prepareCommittedHeadGraphAdmission({
    readiness,
    dir: "/dev/null/workspace",
    unitAddress: "WK-2316#SLICE-005",
    readinessDispatchRole: "implementation",
    graphDerivationRequiredForDispatch,
    generateGraphImpactEvidence: generate,
    validateDispatch: async (options) => {
      validateCalls.push(options);
      return REVALIDATED_READINESS;
    },
    boundedRecoveryDetail
  });
  return { ...result, validateCalls };
}

const graphFailureFamilies = [
  {
    name: "the derivation throws",
    generate: async () => {
      throw new Error("graph query failed");
    },
    code: "graph_impact_query_error",
    reason: "graph_impact_query_error",
    cause: "graph.query_error",
    detailKey: "issue",
    detailValue: "graph_generation_failed"
  },
  {
    name: "the current-HEAD baseline is unavailable",
    generate: async () => ({ written: false, graph_available: false, outcome: "graph_unavailable" }),
    code: "graph_impact_query_error",
    reason: "graph_head_unbuildable",
    cause: "graph.query_error",
    detailKey: "outcome",
    detailValue: "graph_unavailable"
  },
  {
    name: "the baseline reports an unbuildable HEAD",
    generate: async () => ({ written: false, graph_available: false, outcome: "graph_head_unbuildable" }),
    code: "graph_impact_query_error",
    reason: "graph_head_unbuildable",
    cause: "graph.query_error",
    detailKey: "outcome",
    detailValue: "graph_head_unbuildable"
  },
  {
    name: "a successful derivation yields no trusted envelope",
    generate: async () => ({ written: true, graph_available: true }),
    code: "graph_impact_persistence_unavailable",
    reason: "graph_impact_recovery_failed",
    cause: "graph.persistence_unavailable",
    detailKey: "outcome",
    detailValue: "not_persisted"
  },
  {
    name: "a null envelope is returned explicitly",
    generate: async () => ({ written: true, graph_available: true, graph_impact_envelope: null, outcome: "persist_failed" }),
    code: "graph_impact_persistence_unavailable",
    reason: "graph_impact_recovery_failed",
    cause: "graph.persistence_unavailable",
    detailKey: "outcome",
    detailValue: "persist_failed"
  }
];

for (const family of graphFailureFamilies) {
  test(`graph admission refuses with ${family.code} when ${family.name}`, async () => {
    const { refusal, recoveredGraphImpact, validateCalls } = await prepare({ generate: family.generate });

    assert.ok(refusal, "a graph failure must refuse");
    assert.equal(refusal.accepted, false);
    assert.equal(refusal.blocker.code, family.code);
    assert.equal(refusal.blocker.reason, family.reason);
    assert.equal(refusal.blocker.detail.cause, family.cause);
    assert.equal(refusal.blocker.detail.authority_limb, "mechanical_failure");
    assert.equal(refusal.blocker.detail.actor_recovery, "operator");

    assert.equal(refusal.blocker.detail[family.detailKey], family.detailValue);
    assert.equal(refusal.blocker.detail.readiness_decision_code, "missing_graph_impact");
    assert.deepEqual(refusal.blocker.detail.recovery, READINESS.recovery);

    assert.equal(recoveredGraphImpact, null);
    assert.deepEqual(validateCalls, []);
  });

  test(`the ${family.code} refusal for "${family.name}" is never a work-record defect`, async () => {
    const { refusal } = await prepare({ generate: family.generate });
    assert.notEqual(refusal.blocker.code, "work_record_readiness_failure");
    const entry = getRuntimeBlockerEntry(refusal.blocker.code);
    assert.ok(entry, "the emitted code must be registered");
    assert.ok(
      entry.category === "graph_impact" || entry.category === "graph_impact_persistence",
      `${refusal.blocker.code} must be a graph-family code, got ${entry.category}`
    );
    assert.equal(entry.actor_recovery, "operator");
  });
}

test("a successful derivation threads its envelope into revalidation and does not refuse", async () => {
  const { refusal, readiness, recoveredGraphImpact, validateCalls } = await prepare({
    generate: async () => ({ written: true, graph_available: true, graph_impact_envelope: ENVELOPE })
  });

  assert.equal(refusal, null);
  assert.equal(recoveredGraphImpact, ENVELOPE);
  assert.equal(readiness, REVALIDATED_READINESS);
  assert.equal(validateCalls.length, 1);
  assert.equal(validateCalls[0].graph_impact, ENVELOPE);
  assert.equal(validateCalls[0].mode, "strict");
  assert.equal(validateCalls[0].dispatch_role, "implementation");
});

test("a unit that does not require derivation revalidates without deriving", async () => {
  let derivations = 0;
  const { refusal, recoveredGraphImpact, validateCalls } = await prepare({
    readiness: { ...READINESS, recovery: { graph_impact: "not_required", admission_metrics: "fresh" } },
    generate: async () => {
      derivations += 1;
      return { written: true, graph_available: true, graph_impact_envelope: ENVELOPE };
    }
  });

  assert.equal(derivations, 0, "a not_required unit never enters the graph resolver");
  assert.equal(refusal, null);
  assert.equal(recoveredGraphImpact, null);
  assert.equal(validateCalls.length, 1);
  assert.equal(validateCalls[0].graph_impact, null);
});

test("graph admission derives at most once per dispatch", async () => {
  let derivations = 0;
  await prepare({
    generate: async () => {
      derivations += 1;
      return { written: true, graph_available: true, graph_impact_envelope: ENVELOPE };
    }
  });
  assert.equal(derivations, 1);
});

test("no graph refusal carries an exact returned policy result", async () => {
  for (const family of graphFailureFamilies) {
    const { refusal } = await prepare({ generate: family.generate });
    assert.equal(refusal.policy_result, undefined);
    assert.notEqual(refusal.blocker.code, "launcher_transition.cce_policy_refused.v1");
    assert.equal(
      JSON.stringify(refusal).includes("worker_admission_review_threshold_exceeded"),
      false
    );
  }
});
