

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildNeedsReviewRecoveryDetail,
  buildRejectRecoveryDetail,
  buildRouteProblemRecoveryDetail,
  buildPreconditionRecoveryDetail,
  buildRemoteGateRefusalRecoveryDetail,
  projectPackResultReasonFacts,
  projectWorkerAdmissionRecovery
} from "../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission-recovery.mjs";

const GOLDEN = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/workspace-agent-worker-admission-recovery.golden.json", import.meta.url)),
    "utf8"
  )
);

const unit = { address: "portfolio:WK-9#SLICE-3", record_id: "WK-9", slice_id: "SLICE-3" };

const CASES = {
  needs_review_threshold: () => buildNeedsReviewRecoveryDetail({ unit, remote: { aggregate_decision: "needs_review", pack_result_reasons: [
    { code: "review_threshold_exceeded", field: "write_scope_total_loc", observed: 812, threshold: 200 },
    { code: "review_threshold_exceeded", field: "acceptance_criteria_count", observed: 9, threshold: 6 },
    { code: "bogus_ns.review_threshold_exceeded.v1", field: "reviewer_approved", observed: "x" }
  ] } }),
  needs_review_no_reasons: () => buildNeedsReviewRecoveryDetail({ unit, remote: { aggregate_decision: "needs_review", pack_result_reasons: [] } }),
  reject_threshold: () => buildRejectRecoveryDetail({ unit, remote: { aggregate_decision: "reject", pack_result_reasons: [ { code: "reject_threshold_exceeded", field: "max_write_file_loc", observed: 1500, threshold: 1200 } ] } }),
  reject_other: () => buildRejectRecoveryDetail({ unit, remote: { aggregate_decision: "reject", pack_result_reasons: [ { code: "review_threshold_exceeded", field: "write_scope_count", observed: 7 } ] } }),
  cce_recovery_v1: () => buildNeedsReviewRecoveryDetail({ unit, remote: { aggregate_decision: "needs_review", recovery: {
    schema_version: "worker_admission.recovery.v1", authority: "advisory_recovery_only", requires_resubmission: true, truncated: false,
    projection_mode: "bounded_current_decision_recovery",
    actions: [ { kind: "split_or_reduce_scope", controls: ["write_scope_total_loc"], next_action: "Split it", remedy_guidance: {
      paths: [ { remedy: "self_attest_bounded_target_plan", applies_when: "small_edit_in_large_file" } ],
      expected_edit_targets_shape: { target_fields: ["name","path"], kind_values: ["function"], operation_values: ["modify"] } } } ] } } }),
  route_problem: () => buildRouteProblemRecoveryDetail({ unit, remote: { recovery: {
    schema_version: "worker_admission.recovery.v1", authority: "advisory_recovery_only", requires_resubmission: true, truncated: false,
    projection_mode: "route_problem_recovery", actions: [ { kind: "fix_policy_profile" } ] } } }),
  precondition_unsat: () => buildPreconditionRecoveryDetail({ unit, reasonCode: "unsatisfied_dependencies", evidence: { unsatisfied_count: 2, incomplete_upstream_ids: ["WK-1","WK-2"] } }),
  precondition_cycle: () => buildPreconditionRecoveryDetail({ unit, reasonCode: "dependency_cycle", evidence: { cycles: [["A","B","A"]], cycle_ids: ["c1"] } }),
  gate_unratified: () => buildRemoteGateRefusalRecoveryDetail({ unit, remoteGateCode: "remote_admit_unratified" }),
  reason_facts: () => projectPackResultReasonFacts({ pack_result_reasons: [ { code: "review_threshold_exceeded", field: "write_scope_total_loc", observed: 5, threshold: 3 }, { code: "junk" } ] }),
  top_projector: () => projectWorkerAdmissionRecovery({ unit, aggregate_decision: "reject", pack_result_reasons: [ { code: "reject_threshold_exceeded", field: "max_write_file_loc", observed: 1500, threshold: 1200 } ] })
};

test("worker-admission recovery projection is byte-identical to the extraction golden", () => {
  const goldenKeys = Object.keys(GOLDEN).sort();
  const caseKeys = Object.keys(CASES).sort();
  assert.deepEqual(caseKeys, goldenKeys, "golden fixture and live cases must cover the same keys");
  for (const key of caseKeys) {
    assert.equal(
      JSON.stringify(CASES[key]()),
      JSON.stringify(GOLDEN[key]),
      `recovery projection '${key}' must reproduce the golden output byte-for-byte`
    );
  }
});
