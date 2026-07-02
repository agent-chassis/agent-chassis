import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouteProblemRecoveryDetail
} from "../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission-recovery.mjs";

const UNIT = Object.freeze({
  address: "WK-1330#SLICE-060",
  record_id: "WK-1330",
  slice_id: "SLICE-060"
});

function routeProblemRecoveryV1(actions, overrides = {}) {
  return {
    schema_version: "worker_admission.recovery.v1",
    projection_mode: "route_problem_recovery",
    authority: "advisory_recovery_only",
    requires_resubmission: true,
    truncated: false,
    actions,
    ...overrides
  };
}

test("SLICE-060 renders explicit route-problem recovery.v1 actions as advisory guidance", () => {
  const recovery = buildRouteProblemRecoveryDetail({
    unit: UNIT,
    remote: {
      recovery: routeProblemRecoveryV1([
        {
          kind: "fix_pack_input",
          problem_types: ["/worker-admission/request-schema-unrecognized"],
          reason_codes: ["request_schema_unrecognized"],
          fields: ["request_contract_digest"],
          next_action: "Refresh the bound request schema digest, then resubmit."
        },
        {
          kind: "fix_precondition_graph_too_large",
          problem_types: ["/worker-admission/precondition-graph-too-large"],
          fields: ["precondition_graph"],
          next_action: "Split the target unit or reduce dependency fan-out, then resubmit."
        }
      ])
    }
  });

  assert.equal(recovery.classification, "cce_recovery_v1");
  assert.equal(recovery.recovery_source, "cce_recovery_v1");
  assert.equal(recovery.is_deny_or_reject, true);
  assert.equal(recovery.selected_unit_address, UNIT.address);
  assert.equal(Object.hasOwn(recovery, "pack_result"), false);
  assert.deepEqual(recovery.recovery_action_kinds, [
    "fix_pack_input",
    "fix_precondition_graph_too_large"
  ]);
  assert.deepEqual(recovery.problem_types, [
    "/worker-admission/request-schema-unrecognized",
    "/worker-admission/precondition-graph-too-large"
  ]);
  assert.deepEqual(recovery.reason_codes, ["request_schema_unrecognized"]);
  assert.deepEqual(recovery.fields, ["request_contract_digest", "precondition_graph"]);
  assert.deepEqual(recovery.controls, []);
  assert.match(recovery.next_actions[0], /Refresh the bound request schema digest/);
  assert.match(recovery.next_actions[1], /Split the target unit/);
  assert.match(recovery.authority_note, /advisory resubmission guidance only/);
  assert.match(recovery.authority_note, /not review evidence, accepted authority, admission/);
  assert.match(recovery.authority_note, /fresh CCE worker-admission decision/);
});

test("SLICE-060 rejects current-decision recovery when route-problem recovery is expected", () => {
  const recovery = buildRouteProblemRecoveryDetail({
    unit: UNIT,
    remote: {
      recovery: routeProblemRecoveryV1(
        [
          {
            kind: "fix_pack_input",
            problem_types: ["/worker-admission/request-schema-unrecognized"],
            next_action: "This wrong-mode action must not be rendered."
          }
        ],
        { projection_mode: "bounded_current_decision_recovery" }
      )
    }
  });

  assert.equal(recovery.classification, "cce_recovery_projection_mismatch");
  assert.equal(recovery.recovery_source, "cce_recovery_v1_projection_mismatch");
  assert.equal(recovery.is_deny_or_reject, true);
  assert.equal(Object.hasOwn(recovery, "pack_result"), false);
  assert.match(recovery.authority_note, /route-problem guidance/);
  assert.match(recovery.authority_note, /will not infer local recovery policy/);
  assert.match(recovery.next_actions[0], /fix the recovery\.v1 projection contract/);
});

test("SLICE-060 malformed route-problem recovery fails closed as projection mismatch", () => {
  const recovery = buildRouteProblemRecoveryDetail({
    unit: UNIT,
    remote: {
      recovery: routeProblemRecoveryV1([
        {
          kind: "fix_pack_input",
          problem_types: ["/worker-admission/request-schema-unrecognized"],
          local_policy_hint: "invent a local bypass",
          next_action: "This action has an unbounded extra field and must not be rendered."
        }
      ])
    }
  });

  assert.equal(recovery.classification, "cce_recovery_projection_mismatch");
  assert.equal(recovery.recovery_source, "cce_recovery_v1_projection_mismatch");
  assert.deepEqual(recovery.reason_codes ?? [], []);
  assert.equal(Object.hasOwn(recovery, "pack_result"), false);
  assert.match(recovery.authority_note, /could not validate/);
  assert.match(recovery.authority_note, /will not infer local recovery policy/);
});
