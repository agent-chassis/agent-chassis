import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createReadinessEnvelope,
  WORK_RECORD_DISPATCH_SCHEMA_VERSION
} from "../../packages/wiki-core/src/lib/work-record-dispatch-readiness-shape.mjs";
import {
  createDispatchReadinessForUnit,
  createRecordLevelDispatchReadiness
} from "../../packages/wiki-core/src/operations/work-records-shared.mjs";

const CONSUMER_PATHS = [
  "packages/wiki-core/src/operations/work-records-shared.mjs"
];

test("shared readiness consumers delegate envelope construction to the owner", () => {
  const unit = {
    kind: "slice",
    address: "WK-2323#SLICE-007",
    record_id: "WK-2323",
    slice_id: "SLICE-007"
  };

  assert.deepEqual(
    createDispatchReadinessForUnit("WK-2323", unit),
    createReadinessEnvelope({
      recordId: "WK-2323",
      unit,
      policy: { clusters: [], blast_radius: { level: "low", reasons: [], accepted_escalation_id: null } },
      state: { graph_available: false, dirty_state: "clean", staleness: "fresh" },
      reasons: [],
      decisionCode: "dispatchable",
      dispatchable: true,
      acceptedEscalations: [],
      canonicalRefs: [],
      derivedEvidence: [],
      validationHints: [],
      recovery: {
        graph_impact: "not_required",
        admission_metrics: "not_required",
        target_resolution: "not_required"
      }
    })
  );
  const recordReadiness = createRecordLevelDispatchReadiness("WK-2323");
  assert.equal(recordReadiness.unit.address, "WK-2323");
  assert.equal(recordReadiness.schema_version, WORK_RECORD_DISPATCH_SCHEMA_VERSION);
  assert.deepEqual(recordReadiness.clusters, []);
  assert.deepEqual(recordReadiness.blast_radius, {
    level: "low",
    reasons: [],
    accepted_escalation_id: null
  });
  assert.equal(recordReadiness.dispatchable, true);
  assert.equal(recordReadiness.decision_code, "dispatchable");
  assert.equal(recordReadiness.state.dirty_state, "clean");
  assert.equal(recordReadiness.state.staleness, "fresh");
  assert.deepEqual(recordReadiness.recovery, {
    graph_impact: "not_required",
    admission_metrics: "not_required",
    target_resolution: "not_required"
  });
  assert.deepEqual(createDispatchReadinessForUnit("WK-2323", unit).clusters, []);
  assert.equal(createDispatchReadinessForUnit("WK-2323", unit).state.dirty_state, "clean");
  assert.equal(createDispatchReadinessForUnit("WK-2323", unit).state.staleness, "fresh");
  assert.equal(createDispatchReadinessForUnit("WK-2323", unit).clusters.some(
    (cluster) => cluster?.cluster_id === "selected_unit"
  ), false);
});

test("readiness consumers contain no local dispatch envelope schema or fallback literals", async () => {
  for (const path of CONSUMER_PATHS) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /schema_version:\s*[\"']dispatch-readiness\.v1[\"']/);
    assert.doesNotMatch(source, /edge_source:\s*[\"']unavailable[\"']/);
    assert.doesNotMatch(source, /dirty_graph_mode:\s*[\"']unavailable[\"']/);
  }
});
