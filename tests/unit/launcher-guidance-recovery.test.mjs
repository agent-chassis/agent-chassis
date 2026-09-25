

import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyLauncherTransitionBackendRefusal
} from "../../packages/agent-launch-core/src/lib/launcher-transition-plan.mjs";
import { BACKEND_REFUSAL_CODES } from
  "../../packages/agent-launch-core/src/lib/dispatch-runtime.mjs";

const GUIDANCE = Object.freeze({
  state: "guidance",
  route: "workspace_tools_describe",
  args: { tool_name: "workspace_work_record_edit",
    input_contract: { kind: "field", field: "base_branch", scope: "record" } },
  information: "The ordinary editor's record-level base_branch field contract.",
  responsible_actor: "operator",
  prerequisite: "the canonical WK record must explicitly select base_branch",
  operator_action: "choose an existing branch and author it through the ordinary editor",
  retry_condition: "resubmit the original dispatch after the edit"
});

function omit(value, key) {
  const { [key]: removed, ...rest } = value;
  void removed;
  return rest;
}

function refusal(recovery, extra = {}) {
  return {
    schema_version: "workspace-agent-dispatch-backend.v1",
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      reason: "managed_worktree_base_selection_missing",
      detail: {
        cause: { type: "managed_wk_bootstrap_failure", code: "worktree_substrate_git_failed" },
        diagnostic: { message: "base selection missing", detail: { required_ref: null } },
        failure_stage: "pre_worker_worktree_provisioning",
        required_ref: null,
        actor_recovery: "operator",
        ...(recovery === undefined ? {} : { recovery }),
        ...extra
      }
    }
  };
}

function withoutRecovery(classification) {
  const { recovery, next_action: nextAction, diagnostics, schema_rejected: rejected, ...rest } =
    classification;
  void recovery; void nextAction; void rejected;
  const { recovery: declared, ...detail } = diagnostics;
  void declared;
  return { ...rest, detail };
}

test("a declared guidance recovery is preserved, not callable and not downgraded", () => {
  const classification = classifyLauncherTransitionBackendRefusal(refusal(GUIDANCE));
  assert.deepEqual(classification.recovery, GUIDANCE);
  assert.equal(Object.isFrozen(classification.recovery), true);
  assert.equal(classification.next_action, null);
  assert.deepEqual(classification.schema_rejected, []);
  assert.equal(classification.actor_recovery, "operator");
  assert.deepEqual(classification.diagnostics.recovery, GUIDANCE,
    "the complete producer detail remains diagnostic data");
});

test("guidance changes neither cause, authority nor any other classification field", () => {
  const guided = classifyLauncherTransitionBackendRefusal(refusal(GUIDANCE));
  const unguided = classifyLauncherTransitionBackendRefusal(refusal({
    state: "no_supported_route", route: null, responsible_actor: "operator",
    prerequisite: GUIDANCE.prerequisite
  }));
  assert.deepEqual(withoutRecovery(guided), withoutRecovery(unguided));
  assert.equal(guided.cause.code, "worktree_substrate_git_failed");
  assert.equal(guided.refusal_reason, "managed_worktree_base_selection_missing");
  assert.equal(guided.authority_limb, "mechanical_failure");
  assert.equal(guided.blocker_code, "agent_launch.launch_failed_before_start.v1");
});

test("malformed guidance is rejected as authority and stays visible as diagnostics", () => {
  const cases = [
    [omit(GUIDANCE, "information"), "detail.recovery.information"],
    [{ ...GUIDANCE, information: "x".repeat(513) }, "detail.recovery.information"],
    [{ ...GUIDANCE, args: null }, "detail.recovery.args"],
    [{ ...GUIDANCE, args: ["tool_name"] }, "detail.recovery.args"],
    [{ ...GUIDANCE, args: { tool_name: "x".repeat(257) } }, "detail.recovery.args"],
    [{ ...GUIDANCE, args: { Tool: "workspace_work_record_edit" } }, "detail.recovery.args"],
    [{ ...GUIDANCE, args: { a: { b: { c: { d: "deep" } } } } }, "detail.recovery.args"],
    [{ ...GUIDANCE, route: null }, "detail.recovery.route"],
    [{ ...GUIDANCE, route: "Not A Route" }, "detail.recovery.route"],
    [omit(GUIDANCE, "responsible_actor"), "detail.recovery.responsible_actor"],
    [{ ...GUIDANCE, responsible_actor: "anyone" }, "detail.recovery.responsible_actor"],
    [omit(GUIDANCE, "prerequisite"), "detail.recovery.prerequisite"],
    [{ ...GUIDANCE, state: "hint" }, "detail.recovery.state"]
  ];
  for (const [recovery, rejected] of cases) {
    const classification = classifyLauncherTransitionBackendRefusal(refusal(recovery));
    assert.ok(classification.schema_rejected.includes(rejected),
      `${rejected}: ${JSON.stringify(classification.schema_rejected)}`);
    assert.deepEqual(classification.recovery, { state: "no_supported_route", route: null });
    assert.equal(classification.next_action, null);
    assert.deepEqual(classification.diagnostics.recovery,
      JSON.parse(JSON.stringify(recovery)));
  }
});

test("malformed guidance never falls back to a declared dispatch triple", () => {
  const classification = classifyLauncherTransitionBackendRefusal(refusal(
    omit(GUIDANCE, "information"),
    { actor_recovery: "coordinator", next_action: "workspace_agent_dispatch",
      next_action_args: { role: "worker", subject: "WK-0001#SLICE-001" } }
  ));
  assert.equal(classification.recovery.state, "callable",
    "only a VALID declared recovery takes precedence; the declared triple still applies");
  assert.equal(classification.next_action, "workspace_agent_dispatch");
  const guided = classifyLauncherTransitionBackendRefusal(refusal(GUIDANCE,
    { actor_recovery: "coordinator", next_action: "workspace_agent_dispatch",
      next_action_args: { role: "worker", subject: "WK-0001#SLICE-001" } }));
  assert.equal(guided.recovery.state, "guidance", "a valid declared guidance takes precedence");
  assert.equal(guided.next_action, null);
});

test("unrelated declared recoveries keep their current classification", () => {
  const callable = classifyLauncherTransitionBackendRefusal(refusal({
    state: "callable", route: "workspace_agent_dispatch",
    args: { role: "reviewer", subject: "WK-0001#SLICE-001" }
  }));
  assert.deepEqual(callable.recovery, { state: "callable", route: "workspace_agent_dispatch",
    args: { role: "reviewer", subject: "WK-0001#SLICE-001" } });
  assert.equal(callable.next_action, "workspace_agent_dispatch");
  const none = classifyLauncherTransitionBackendRefusal(refusal({
    state: "no_supported_route", route: null, responsible_actor: "operator",
    prerequisite: "p", operator_action: "a", retry_condition: "r", explanation: "e"
  }));
  assert.deepEqual(none.recovery, { state: "no_supported_route", route: null,
    responsible_actor: "operator", prerequisite: "p", operator_action: "a",
    retry_condition: "r", explanation: "e" });
  const absent = classifyLauncherTransitionBackendRefusal(refusal(undefined));
  assert.deepEqual(absent.recovery, { state: "no_supported_route", route: null });
  assert.equal(absent.next_action, null);
});
