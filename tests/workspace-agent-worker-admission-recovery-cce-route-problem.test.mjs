import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateWorkerAdmissionDecision
} from "../packages/agent-launch-cli/src/lib/workspace-agent-worker-admission.mjs";

const UNIT = Object.freeze({
  address: "WK-1330#SLICE-061",
  record_id: "WK-1330",
  slice_id: "SLICE-061"
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

function structuralRouteProblemRemote(recovery) {
  const remote = {
    disposition: "structural_remote",
    effect: null,
    outcome: "problem_response",
    pack_backed: false,
    node_engine_backed_success: false,
    node_engine_binding_ratified: false,
    problem_type: "/errors/pack-input-invalid"
  };
  if (recovery !== undefined) {
    remote.recovery = recovery;
  }
  return remote;
}

test("SLICE-061 launcher renders top-level route-problem recovery without pack_result", () => {
  const decision = evaluateWorkerAdmissionDecision({
    unit: UNIT,
    remote: structuralRouteProblemRemote(
      routeProblemRecoveryV1([
        {
          kind: "fix_request_schema_digest",
          reason_codes: ["request_schema_unrecognized"],
          problem_types: ["/errors/request-schema-digest-mismatch"],
          fields: ["request_contract_digest"],
          next_action: "Refresh the bound request schema digest, then resubmit."
        },
        {
          kind: "fix_pack_input",
          problem_types: ["/errors/pack-input-invalid"],
          fields: ["pack_input"],
          next_action: "Regenerate the worker-admission pack input, then resubmit."
        }
      ])
    )
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "worker_admission_remote_enforcement_unavailable");

  const recovery = decision.detail.remote_worker_admission_recovery;
  assert.equal(recovery.classification, "cce_recovery_v1");
  assert.equal(recovery.recovery_source, "cce_recovery_v1");
  assert.equal(recovery.is_deny_or_reject, true);
  assert.equal(recovery.selected_unit_address, UNIT.address);
  assert.equal(Object.hasOwn(recovery, "pack_result"), false);
  assert.equal(Object.hasOwn(recovery.cce_recovery, "pack_result"), false);
  assert.deepEqual(recovery.recovery_action_kinds, [
    "fix_request_schema_digest",
    "fix_pack_input"
  ]);
  assert.deepEqual(recovery.reason_codes, ["request_schema_unrecognized"]);
  assert.deepEqual(recovery.problem_types, [
    "/errors/request-schema-digest-mismatch",
    "/errors/pack-input-invalid"
  ]);
  assert.deepEqual(recovery.fields, ["request_contract_digest", "pack_input"]);
  assert.match(recovery.next_actions[0], /Refresh the bound request schema digest/);
  assert.match(recovery.next_actions[1], /Regenerate the worker-admission pack input/);
  assert.match(recovery.authority_note, /advisory resubmission guidance only/);
  assert.match(recovery.authority_note, /not review evidence, accepted authority, admission/);
  assert.match(recovery.authority_note, /fresh CCE worker-admission decision/);
});

test("SLICE-061 malformed route-problem recovery fails closed as projection mismatch", () => {
  const decision = evaluateWorkerAdmissionDecision({
    unit: UNIT,
    remote: structuralRouteProblemRemote(
      routeProblemRecoveryV1([
        {
          kind: "fix_pack_input",
          problem_types: ["/errors/pack-input-invalid"],
          local_authority_hint: "treat this as admitted",
          next_action: "This unbounded action must not be rendered."
        }
      ])
    )
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "worker_admission_remote_enforcement_unavailable");

  const recovery = decision.detail.remote_worker_admission_recovery;
  assert.equal(recovery.classification, "cce_recovery_projection_mismatch");
  assert.equal(recovery.recovery_source, "cce_recovery_v1_projection_mismatch");
  assert.equal(recovery.is_deny_or_reject, true);
  assert.equal(Object.hasOwn(recovery, "pack_result"), false);
  assert.deepEqual(recovery.reason_codes ?? [], []);
  assert.match(recovery.authority_note, /could not validate/);
  assert.match(recovery.authority_note, /route-problem guidance/);
  assert.match(recovery.authority_note, /will not infer local recovery policy/);
  assert.match(recovery.next_actions[0], /fix the recovery\.v1 projection contract/);
});

test("SLICE-061 current-decision recovery on a route problem fails closed", () => {
  const decision = evaluateWorkerAdmissionDecision({
    unit: UNIT,
    remote: structuralRouteProblemRemote(
      routeProblemRecoveryV1(
        [
          {
            kind: "fix_pack_input",
            problem_types: ["/errors/pack-input-invalid"],
            next_action: "Wrong projection mode must not be rendered."
          }
        ],
        { projection_mode: "bounded_current_decision_recovery" }
      )
    )
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "worker_admission_remote_enforcement_unavailable");
  assert.equal(
    decision.detail.remote_worker_admission_recovery.classification,
    "cce_recovery_projection_mismatch"
  );
  assert.match(
    decision.detail.remote_worker_admission_recovery.authority_note,
    /route-problem guidance/
  );
});

test("SLICE-061 route problems without recovery keep remote-gate guidance", () => {
  const decision = evaluateWorkerAdmissionDecision({
    unit: UNIT,
    remote: structuralRouteProblemRemote(undefined)
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "worker_admission_remote_enforcement_unavailable");
  assert.equal(
    decision.detail.remote_worker_admission_recovery.classification,
    "remote_enforcement_unavailable"
  );
});
