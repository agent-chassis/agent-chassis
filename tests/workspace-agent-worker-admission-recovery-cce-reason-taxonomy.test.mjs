import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNeedsReviewRecoveryDetail,
  buildRejectRecoveryDetail,
  projectWorkerAdmissionRecovery
} from "../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission-recovery.mjs";
import {
  evaluateWorkerAdmissionDecision
} from "../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission.mjs";

const UNIT = Object.freeze({
  address: "WK-1330#SLICE-024",
  record_id: "WK-1330",
  slice_id: "SLICE-024"
});

function recoveryV1(actions, overrides = {}) {
  return {
    schema_version: "worker_admission.recovery.v1",
    projection_mode: "bounded_current_decision_recovery",
    authority: "advisory_recovery_only",
    requires_resubmission: true,
    truncated: false,
    actions,
    ...overrides
  };
}

test("SLICE-024 renders valid CCE recovery.v1 needs_review actions as advisory resubmission guidance", () => {
  const recovery = buildNeedsReviewRecoveryDetail({
    unit: UNIT,
    remote: {
      aggregate_decision: "needs_review",
      recovery: recoveryV1([
        {
          kind: "obtain_review_attestation",
          reason_codes: ["review_attestation_source_mismatch"],
          fields: ["review_attestations.source"],
          controls: ["validation_command_count"],
          next_action: "Record a valid review attestation for validation_command_count, then resubmit."
        },
        {
          kind: "obtain_accepted_authority",
          reason_codes: ["accepted_authority_scope_mismatch"],
          fields: ["accepted_authorities.scope"],
          next_action: "Replace the mismatched accepted authority with one scoped to this unit."
        }
      ])
    }
  });

  assert.equal(recovery.classification, "cce_recovery_v1");
  assert.equal(recovery.recovery_source, "cce_recovery_v1");
  assert.equal(recovery.is_deny_or_reject, false);
  assert.equal(recovery.selected_unit_address, UNIT.address);
  assert.deepEqual(recovery.recovery_action_kinds, [
    "obtain_review_attestation",
    "obtain_accepted_authority"
  ]);
  assert.deepEqual(recovery.reason_codes, [
    "review_attestation_source_mismatch",
    "accepted_authority_scope_mismatch"
  ]);
  assert.deepEqual(recovery.fields, ["review_attestations.source", "accepted_authorities.scope"]);
  assert.deepEqual(recovery.controls, ["validation_command_count"]);
  assert.match(recovery.next_actions[0], /Record a valid review attestation/);
  assert.match(recovery.authority_note, /advisory resubmission guidance only/);
  assert.match(recovery.authority_note, /not review evidence, accepted authority, admission/);
  assert.match(recovery.authority_note, /fresh CCE worker-admission decision/);
});

test("SLICE-024 renders valid CCE recovery.v1 reject actions without pretending a pack_result exists", () => {
  const recovery = buildRejectRecoveryDetail({
    unit: UNIT,
    remote: {
      aggregate_decision: "reject",
      recovery: recoveryV1([
        {
          kind: "fix_metrics",
          reason_codes: ["work_unit_metrics_missing", "work_unit_metric_malformed"],
          fields: ["metrics.write_scope_total_loc"],
          next_action: "Regenerate bounded work-unit metrics, then resubmit."
        },
        {
          kind: "fix_local_hard_refusal",
          reason_codes: ["local_hard_refusal"],
          problem_types: ["/errors/local-hard-refusal"],
          next_action: "Resolve the local hard refusal before resubmitting."
        }
      ])
    }
  });

  assert.equal(recovery.classification, "cce_recovery_v1");
  assert.equal(recovery.recovery_source, "cce_recovery_v1");
  assert.equal(recovery.is_deny_or_reject, true);
  assert.equal(Object.hasOwn(recovery, "pack_result"), false);
  assert.deepEqual(recovery.reason_codes, [
    "work_unit_metrics_missing",
    "work_unit_metric_malformed",
    "local_hard_refusal"
  ]);
  assert.deepEqual(recovery.problem_types, ["/errors/local-hard-refusal"]);
  assert.deepEqual(recovery.fields, ["metrics.write_scope_total_loc"]);
  assert.match(recovery.next_actions[0], /Regenerate bounded work-unit metrics/);
  assert.match(recovery.authority_note, /not review evidence, accepted authority, admission/);
});

test("SLICE-024 public launcher refusal surfaces carry valid CCE recovery.v1 guidance", () => {
  const needsReviewDecision = evaluateWorkerAdmissionDecision({
    unit: UNIT,
    remote: {
      disposition: "structural_remote",
      effect: "needs_review",
      outcome: "pack_backed_result",
      pack_backed: true,
      node_engine_backed_success: true,
      node_engine_binding_ratified: true,
      recovery: recoveryV1([
        {
          kind: "fix_request_schema_digest",
          reason_codes: ["request_schema_unrecognized"],
          fields: ["request_contract_digest"],
          next_action: "Refresh the bound request schema digest, then resubmit."
        }
      ])
    }
  });
  const rejectDecision = evaluateWorkerAdmissionDecision({
    unit: UNIT,
    remote: {
      disposition: "structural_remote",
      effect: "reject",
      outcome: "pack_backed_result",
      pack_backed: true,
      node_engine_backed_success: true,
      node_engine_binding_ratified: true,
      recovery: recoveryV1([
        {
          kind: "fix_metrics",
          reason_codes: ["work_unit_metrics_missing"],
          fields: ["metrics.write_scope_count"],
          next_action: "Regenerate the missing metrics, then resubmit."
        }
      ])
    }
  });

  assert.equal(needsReviewDecision.allowed, false);
  assert.equal(needsReviewDecision.reason, "worker_admission_remote_needs_review");
  assert.equal(
    needsReviewDecision.detail.remote_needs_review_recovery.recovery_source,
    "cce_recovery_v1"
  );
  assert.deepEqual(
    needsReviewDecision.detail.remote_needs_review_recovery.reason_codes,
    ["request_schema_unrecognized"]
  );
  assert.match(
    needsReviewDecision.detail.remote_needs_review_recovery.authority_note,
    /not review evidence, accepted authority, admission/
  );

  assert.equal(rejectDecision.allowed, false);
  assert.equal(rejectDecision.reason, "worker_admission_remote_reject");
  assert.equal(rejectDecision.detail.remote_reject_recovery.recovery_source, "cce_recovery_v1");
  assert.deepEqual(
    rejectDecision.detail.remote_reject_recovery.reason_codes,
    ["work_unit_metrics_missing"]
  );
  assert.match(
    rejectDecision.detail.remote_reject_recovery.next_actions[0],
    /Regenerate the missing metrics/
  );
});

test("SLICE-024 legacy needs_review reason-fact recovery remains labeled as compatibility fallback", () => {
  const recovery = buildNeedsReviewRecoveryDetail({
    unit: UNIT,
    remote: {
      aggregate_decision: "needs_review",
      effect: "needs_review",
      outcome: "pack_backed_result",
      pack_backed: true,
      node_engine_backed_success: true,
      pack_result_reasons: [
        {
          code: "review_threshold_exceeded",
          field: "write_scope_total_loc",
          observed: 1840,
          threshold: 1200
        }
      ]
    }
  });

  assert.equal(recovery.classification, "review_threshold_exceeded");
  assert.equal(recovery.recovery_source, "legacy_reason_fact_recovery_compatibility_fallback");
  assert.deepEqual(recovery.review_threshold_controls, ["write_scope_total_loc"]);
  assert.deepEqual(recovery.reason_facts, [
    {
      reason_code: "review_threshold_exceeded",
      control: "write_scope_total_loc",
      observed: 1840,
      threshold: 1200
    }
  ]);
});

test("SLICE-024 malformed recovery summaries fail closed as projection mismatch", () => {
  const recovery = projectWorkerAdmissionRecovery({
    aggregate_decision: "needs_review",
    unit: UNIT,
    recovery: recoveryV1([
      {
        kind: "locally_inferred_fix",
        reason_codes: ["review_attestation_source_mismatch"],
        next_action: "This malformed action must not be rendered."
      }
    ])
  });

  assert.equal(recovery.classification, "cce_recovery_projection_mismatch");
  assert.equal(recovery.recovery_source, "cce_recovery_v1_projection_mismatch");
  assert.equal(recovery.is_deny_or_reject, false);
  assert.match(recovery.authority_note, /could not validate/);
  assert.match(recovery.authority_note, /will not infer local recovery policy/);
  assert.match(recovery.next_actions[0], /fix the recovery\.v1 projection contract/);
});

test("SLICE-024 route-problem recovery is out of scope for current-decision rendering", () => {
  const recovery = buildRejectRecoveryDetail({
    unit: UNIT,
    remote: {
      aggregate_decision: "reject",
      recovery: recoveryV1(
        [
          {
            kind: "fix_pack_input",
            problem_types: ["/errors/pack-input-invalid"],
            next_action: "Fix route problem input, then retry."
          }
        ],
        { projection_mode: "route_problem_recovery" }
      )
    }
  });

  assert.equal(recovery.classification, "cce_recovery_projection_mismatch");
  assert.equal(recovery.recovery_source, "cce_recovery_v1_projection_mismatch");
  assert.equal(Object.hasOwn(recovery, "pack_result"), false);
  assert.match(recovery.authority_note, /will not infer local recovery policy/);
});
