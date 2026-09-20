

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DIAGNOSTIC_EVIDENCE_MAX_DEPTH
} from "../../packages/agent-launch-cli/src/lib/diagnostic-evidence.mjs";

import {
  RUNTIME_BLOCKER_CODES,
  getRuntimeBlockerEntry,
  isRuntimeBlockerCode
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  DISPATCH_BLOCKER_CODES,
  DISPATCH_MECHANICAL_BLOCKER_CODES
} from "../../packages/wiki-mcp/src/lib/dispatch-tool-constants.mjs";
import {
  RUNTIME_BLOCKER_CLASSIFIER_STATE_TABLE,
  RuntimeBlockerClassifierError,
  classifyMechanicalRuntimeBlocker
} from "../../packages/wiki-mcp/src/lib/dispatch-tools/runtime-blocker-classifier.mjs";
import {
  buildDispatchToolExceptionDetail,
  mapBackendRefusalToDispatchCode
} from "../../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import { errorContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  BACKEND_REFUSAL_CODES
} from "../../packages/agent-launch-core/src/lib/dispatch-runtime.mjs";
import {
  classifyLauncherTransitionBackendRefusal
} from "../../packages/agent-launch-core/src/lib/launcher-transition-plan.mjs";
import {
  ATTEMPT_LINEAGE_RESOLUTION_STATES
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-settlement.mjs";
import {
  COMMITTED_SLICE_INTEGRATION_PUBLIC_BLOCKER_CODES
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs";
import {
  STDIO_MCP_CONDUIT_COMPOSITION_OUTER_BLOCKER,
  STDIO_MCP_CONDUIT_COMPOSITION_REFUSAL_CAUSE,
  buildManagedStdioMcpCompositionRefusal
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-composition-compatibility.mjs";
import {
  evaluateCoordinationPreflight
} from "../../packages/wiki-core/src/lib/coordination-preflight.mjs";

const OPERATOR = "operator_recovery_needed";

const AUTHENTICATED_EXTERNAL = Object.freeze({
  producer: "unexpected_external",
  condition: "authenticated_condition"
});

test("a launch that never started publishes its own registered identity, not the operator catch-all", () => {
  assert.equal(
    BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
    "agent_launch.launch_failed_before_start.v1"
  );
  assert.notEqual(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, OPERATOR);
  assert.equal(isRuntimeBlockerCode(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START), true);
  const entry = getRuntimeBlockerEntry(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START);

  assert.equal(entry.actor_recovery, "operator");
  assert.equal(entry.blocking, true);
  assert.match(entry.detail, /pre-start/iu);
});

test("the launcher-transition projection carries a startup refusal's exact cause through the public code", () => {

  const classification = classifyLauncherTransitionBackendRefusal({
    schema_version: "workspace-agent-dispatch-backend.v1",
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      reason: "ensure_new_worker_write_roots_failed",
      detail: { message: "EACCES: permission denied, mkdir '/managed/roots/WK-0001'" }
    }
  });
  assert.equal(classification.blocker_code, "agent_launch.launch_failed_before_start.v1");
  assert.notEqual(classification.blocker_code, OPERATOR);

  assert.equal(
    classification.refusal_code,
    BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START
  );
  assert.equal(classification.refusal_reason, "ensure_new_worker_write_roots_failed");
  assert.equal(classification.cause.code, "ensure_new_worker_write_roots_failed");
  assert.equal(classification.cause.source, "refusal.reason");
  assert.deepEqual(classification.diagnostics, {
    message: "EACCES: permission denied, mkdir '/managed/roots/WK-0001'"
  });
  assert.deepEqual(classification.redactions, []);

  assert.deepEqual(classification.recovery, { state: "no_supported_route", route: null });
});

test("an undeclared backend refusal identity states that it is undeclared instead of claiming an external condition", () => {
  const classification = classifyLauncherTransitionBackendRefusal({
    schema_version: "workspace-agent-dispatch-backend.v1",
    accepted: false,
    refusal: { code: "not_a_registered_identity_at_all", reason: "whatever", detail: null }
  });
  assert.equal(
    classification.blocker_code,
    "launcher_transition.backend_refusal_identity_unknown.v1"
  );
  assert.notEqual(classification.blocker_code, OPERATOR);
});

test("a family executor preserves a registered conduit identity instead of the pre-start code", async () => {

  const sources = await Promise.all([
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-claude-executor.mjs",
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-codex-in-process-runtime.mjs"
  ].map((relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8")));
  for (const source of sources) {
    assert.match(
      source,
      /isRuntimeBlockerCode\((?:err|error)\?\.code\)\s*\n?\s*\?\s*(?:err|error)\.code/u,
      "the conduit catch must publish a registered producer identity when one exists"
    );
  }
});

test("attempt-lineage settlement has no operator-recovery state left to publish", () => {
  const states = Object.values(ATTEMPT_LINEAGE_RESOLUTION_STATES);
  assert.deepEqual(states.slice().sort(), ["selected", "unresolved"]);
  assert.equal(states.includes(OPERATOR), false);
});

test("committed-slice integration publishes no operator catch-all limb", () => {
  assert.equal(COMMITTED_SLICE_INTEGRATION_PUBLIC_BLOCKER_CODES.includes(OPERATOR), false);
  for (const code of COMMITTED_SLICE_INTEGRATION_PUBLIC_BLOCKER_CODES) {
    assert.equal(isRuntimeBlockerCode(code), true, `${code} must be registered`);
  }

  assert.ok(COMMITTED_SLICE_INTEGRATION_PUBLIC_BLOCKER_CODES.includes(
    "agent_launch.slice_integration.cce_policy_refused.v1"));
  assert.ok(COMMITTED_SLICE_INTEGRATION_PUBLIC_BLOCKER_CODES.includes(
    "agent_launch.slice_integration.classification_unavailable.v1"));
});

test("the unclassifiable-integration identity admits it has no route rather than inventing a next call", () => {
  const entry = getRuntimeBlockerEntry(
    "agent_launch.slice_integration.classification_unavailable.v1"
  );
  assert.equal(entry.actor_recovery, "none");
  assert.equal(Object.hasOwn(entry, "recovery"), false);
  assert.match(entry.detail, /no mechanically supported continuation exists/iu);

  assert.match(entry.detail, /No integration occurred/iu);
});

test("a known lifecycle protocol incompatibility publishes its own identity, with the cause preserved beside it", () => {
  assert.equal(
    STDIO_MCP_CONDUIT_COMPOSITION_OUTER_BLOCKER,
    "stdio_mcp_lifecycle_protocol_incompatible"
  );
  assert.notEqual(STDIO_MCP_CONDUIT_COMPOSITION_OUTER_BLOCKER, OPERATOR);
  for (const outcome of ["incompatible", "unknown", "missing_fact", "malformed_fact",
    "stale_fact", "backend_generation_mismatch", "spawned_producer_generation_mismatch",
    "spawned_producer_generation_unavailable"]) {
    const refusal = buildManagedStdioMcpCompositionRefusal(outcome);
    assert.equal(refusal.code, "stdio_mcp_lifecycle_protocol_incompatible", outcome);

    assert.equal(refusal.cause, STDIO_MCP_CONDUIT_COMPOSITION_REFUSAL_CAUSE, outcome);
    assert.match(refusal.recovery, /coherent build/iu, outcome);
    assert.equal(refusal.gate_outcome, outcome, outcome);
  }
});

test("coordination preflight republishes that identity rather than the operator catch-all", () => {
  const result = evaluateCoordinationPreflight({
    role: "coordinator",
    repo_mount_writable: true,
    docs_writable: true,
    wiki_writable: true,
    dispatch_route_available: true,
    structured_dispatch_compatibility: {
      available: false,
      gate_outcome: "incompatible",
      fact: null,
      blocker: {
        code: "stdio_mcp_lifecycle_protocol_incompatible",
        cause: "stdio_mcp_lifecycle_protocol_incompatible",
        recovery: "deploy one coherent build and restart the long-lived backend",
        gate_outcome: "incompatible"
      }
    }
  });
  const codes = result.blockers.map((entry) => entry.code);
  assert.equal(codes.includes(OPERATOR), false);
  assert.ok(codes.includes("stdio_mcp_lifecycle_protocol_incompatible"));
  const blocker = result.blockers.find(
    (entry) => entry.code === "stdio_mcp_lifecycle_protocol_incompatible"
  );

  assert.deepEqual(blocker.evidence, {
    cause: "stdio_mcp_lifecycle_protocol_incompatible",
    recovery: "deploy one coherent build and restart the long-lived backend",
    gate_outcome: "incompatible"
  });
});

test("an untyped internal throw is a handler exception, never an external condition", async () => {
  const result = await errorContent(
    Object.assign(new Error("something inside the portfolio went wrong"), {}),
    { route: "workspace_agent_dispatch" }
  );
  const envelope = result.structuredContent;
  assert.equal(envelope.code, "mcp_response.handler_exception.v1");
  assert.notEqual(envelope.code, OPERATOR);
  assert.equal(JSON.stringify(envelope).includes(OPERATOR), false);
  assert.equal(getRuntimeBlockerEntry(envelope.code).actor_recovery, "none");
});

test("the complete diagnostic evidence of a thrown failure survives to the public detail", () => {
  const inner = Object.assign(new Error("git exited 128 for ref refs/wk/WK-0001"), {
    code: "agent_launch.slice_integration.git_failed.v1",
    errno: -2,
    failing_value: { ref: "refs/wk/WK-0001", exit_code: 128 }
  });
  const outer = Object.assign(new Error("committed slice integration failed"), {
    code: "agent_launch.slice_integration.classification_unavailable.v1",
    cause: inner
  });

  const detail = buildDispatchToolExceptionDetail("workspace_integrate_committed_slice", outer);

  assert.equal(detail.tool, "workspace_integrate_committed_slice");
  assert.equal(detail.error_message, "committed slice integration failed");

  const captured = detail.evidence.thrown;
  assert.deepEqual(captured.capture_failures, [], "nothing may be dropped without disclosure");
  assert.equal(captured.value.message, "committed slice integration failed");
  assert.equal(
    captured.value.properties.code,
    "agent_launch.slice_integration.classification_unavailable.v1"
  );

  assert.equal(captured.value.cause.message, "git exited 128 for ref refs/wk/WK-0001");
  assert.equal(
    captured.value.cause.properties.code,
    "agent_launch.slice_integration.git_failed.v1"
  );
  assert.equal(captured.value.cause.properties.errno, -2);
  assert.deepEqual(captured.value.cause.properties.failing_value, {
    ref: "refs/wk/WK-0001",
    exit_code: 128
  });
  assert.equal(typeof captured.value.stack, "string");
});

test("evidence deeper than one encoded value's budget is retrievable, not merely disclosed", () => {

  let deep = { credential_free_leaf: "the deepest failing value" };
  for (let level = 0; level < DIAGNOSTIC_EVIDENCE_MAX_DEPTH + 4; level += 1) {
    deep = { next: deep };
  }
  const detail = buildDispatchToolExceptionDetail(
    "workspace_agent_run_status",
    Object.assign(new Error("deep failure"), { detail: deep })
  );
  assert.deepEqual(detail.evidence.thrown.capture_failures, []);
  assert.ok(detail.evidence.thrown.segments.length >= 1);
  assert.equal(
    JSON.stringify(detail.evidence).includes("the deepest failing value"),
    true,
    "the value below the per-node budget must survive to the public detail"
  );
});

test("nothing is removed from the detail: no producer declares a value to remove", () => {

  const message = "spawn failed presenting sk-live-LOOKS-LIKE-A-TOKEN at "
    + "/srv/launcher/private/conduit/in.fifo";
  const thrown = Object.assign(new Error(message), {
    errno: -13,
    detail: { path: "/srv/launcher/private/conduit/in.fifo", digest: "sha256:abc123" }
  });
  const detail = buildDispatchToolExceptionDetail("workspace_agent_dispatch", thrown);

  assert.equal(detail.error_message, message);
  assert.deepEqual(detail.error_message_redactions, []);
  assert.equal(detail.evidence.thrown.value.message, message);
  assert.equal(detail.evidence.thrown.value.properties.errno, -13);
  assert.deepEqual(detail.evidence.thrown.value.properties.detail, {
    path: "/srv/launcher/private/conduit/in.fifo",
    digest: "sha256:abc123"
  });
  const serialized = JSON.stringify(detail);
  for (const fragment of [
    "sk-live-LOOKS-LIKE-A-TOKEN",
    "/srv/launcher/private/conduit/in.fifo",
    "sha256:abc123"
  ]) {
    assert.equal(serialized.includes(fragment), true, `${fragment} must cross verbatim`);
  }
});

test("a non-Error thrown value is preserved rather than summarised away", () => {
  const detail = buildDispatchToolExceptionDetail("workspace_agent_run_status", {
    kind: "plain_object_throw",
    observed: { attempt_id: "att-1", exit: 7 }
  });
  assert.deepEqual(detail.evidence.thrown.value, {
    kind: "plain_object_throw",
    observed: { attempt_id: "att-1", exit: 7 }
  });
  assert.deepEqual(detail.evidence.thrown.capture_failures, []);
});

test("the classifier refuses an unauthenticated or forged external-condition claim", () => {
  const forged = [
    undefined,
    null,
    {},
    { authenticated: false, external_condition: "host_supervisor_revoked_runtime" },
    { authenticated: "true", external_condition: "host_supervisor_revoked_runtime" },
    { authenticated: true },
    { authenticated: true, external_condition: "" }
  ];
  for (const detail of forged) {
    assert.throws(
      () => classifyMechanicalRuntimeBlocker({ ...AUTHENTICATED_EXTERNAL, detail }),
      (error) => {
        assert.ok(error instanceof RuntimeBlockerClassifierError);
        assert.equal(error.code, "authenticated_external_condition_required");
        return true;
      },
      JSON.stringify(detail ?? null)
    );
  }
});

test("a tooling defect cannot be relabelled as an external condition through the classifier", () => {

  assert.throws(
    () => classifyMechanicalRuntimeBlocker({ producer: "handler", condition: "threw" }),
    (error) => error.code === "unknown_producer"
  );
  assert.throws(
    () => classifyMechanicalRuntimeBlocker({
      producer: "unexpected_external",
      condition: "tooling_defect"
    }),
    (error) => error.code === "unknown_condition"
  );
});

test("an attached external_condition never moves a modeled producer onto the break-glass code", () => {
  const classified = classifyMechanicalRuntimeBlocker({
    producer: "mcp_response",
    condition: "handler_exception",
    detail: { authenticated: true, external_condition: "host_supervisor_revoked_runtime" }
  });
  assert.equal(classified.code, "mcp_response.handler_exception.v1");
  assert.notEqual(classified.code, OPERATOR);
});

test("a missing route is not an external condition", () => {
  const classified = classifyMechanicalRuntimeBlocker({
    producer: "recovery_contract",
    condition: "no_supported_route"
  });
  assert.equal(classified.code, "worker_admission_recovery_route_unavailable");
  assert.notEqual(classified.code, OPERATOR);
  assert.equal(classified.detail.no_supported_route, true);
  assert.deepEqual(classified.detail.next_calls, []);
});

test("the one authenticated external-condition path still works and keeps its exact condition", () => {
  const classified = classifyMechanicalRuntimeBlocker({
    ...AUTHENTICATED_EXTERNAL,
    detail: { authenticated: true, external_condition: "host_supervisor_revoked_runtime" }
  });
  assert.equal(classified.code, OPERATOR);
  assert.equal(classified.cause, "unexpected_external.authenticated_condition");
  assert.equal(classified.owning_boundary, "external.authenticated-condition");

  assert.equal(classified.detail.external_condition, "host_supervisor_revoked_runtime");
  assert.equal(classified.detail.authenticated, true);
  assert.equal(classified.detail.no_supported_route, true);
});

test("no route-facing dispatch constant resolves to the operator catch-all", () => {

  const offenders = Object.entries(DISPATCH_BLOCKER_CODES)
    .filter(([, code]) => code === OPERATOR)
    .map(([key]) => key);
  assert.deepEqual(offenders, []);
});

test("exactly one classifier state-table pair may resolve to the operator catch-all", () => {
  const pairs = Object.entries(RUNTIME_BLOCKER_CLASSIFIER_STATE_TABLE).flatMap(
    ([producer, family]) => Object.entries(family)
      .filter(([, code]) => code === OPERATOR)
      .map(([condition]) => `${producer}.${condition}`)
  );
  assert.deepEqual(pairs, ["unexpected_external.authenticated_condition"]);

  assert.equal(DISPATCH_MECHANICAL_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED, OPERATOR);
  assert.equal(RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED, OPERATOR);
});

test("the corrected producers name the operator identity nowhere in their source", async () => {

  const owned = [
    "packages/agent-launch-core/src/lib/dispatch-runtime.mjs",
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs",
    "packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-settlement.mjs",
    "packages/wiki-mcp/src/lib/dispatch-run-monitor-routes.mjs",
    "packages/wiki-mcp/src/lib/dispatch-tools/agent-dispatch-launch-route.mjs",
    "packages/wiki-mcp/src/lib/dispatch-tools/agent-dispatch-route.mjs",
    "packages/wiki-mcp/src/lib/dispatch-tools/agent-dispatch-identity-route.mjs",
    "packages/wiki-mcp/src/lib/dispatch-tools/agent-dispatch-refusal-projection.mjs",
    "packages/wiki-mcp/src/lib/dispatch-tools/committed-slice-integration-route.mjs",
    "packages/wiki-mcp/src/lib/dispatch-tools/forge-handoff-route.mjs",
    "packages/wiki-mcp/src/lib/dispatch-tools/dispatch-admission-policy.mjs"
  ];
  for (const relative of owned) {
    const source = await readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

    const code = source
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    assert.doesNotMatch(code, /OPERATOR_RECOVERY_NEEDED/u, relative);
    assert.doesNotMatch(code, /["']operator_recovery_needed["']/u, relative);
  }
});

test("a backend cannot mint the break-glass identity by declaring it as its refusal code", () => {

  const forged = classifyLauncherTransitionBackendRefusal({
    schema_version: "workspace-agent-dispatch-backend.v1",
    accepted: false,
    refusal: {
      code: OPERATOR,
      reason: "stdio_mcp_conduit_input_invalid",
      detail: { message: "createStdioMcpConduit refused /srv/launcher/private/conduit" }
    }
  });

  assert.equal(forged.blocker_code, "stdio_mcp_conduit_input_invalid");
  assert.notEqual(forged.blocker_code, OPERATOR);

  assert.equal(forged.refusal_code, OPERATOR);
  assert.deepEqual(forged.diagnostics, {
    message: "createStdioMcpConduit refused /srv/launcher/private/conduit"
  });
});

test("a forged break-glass claim with no registered cause resolves to the unclassified identity", () => {
  const forged = classifyLauncherTransitionBackendRefusal({
    schema_version: "workspace-agent-dispatch-backend.v1",
    accepted: false,
    refusal: { code: OPERATOR, reason: "an_unmodeled_thing_happened", detail: null }
  });
  assert.equal(
    forged.blocker_code,
    "launcher_transition.authenticated_backend_refusal_unclassified.v1"
  );
  assert.notEqual(forged.blocker_code, OPERATOR);
});

test("an undeclared thrown identity does not borrow a launcher-transition limb", () => {

  const unowned = "verify_proof_cache.evidence_delivery_failed.v1";
  assert.equal(isRuntimeBlockerCode(unowned), false);
  const projected = mapBackendRefusalToDispatchCode(unowned);
  assert.equal(projected, "launcher_transition.backend_refusal_identity_unknown.v1");

  const monitoring = getRuntimeBlockerEntry(
    "agent_launch.monitor.proof_verification_evidence_unavailable.v1"
  );
  assert.equal(monitoring.category, "transport");
  assert.match(monitoring.detail, /recorded verification result itself is unchanged/iu);
});

test("every corrected identity is blocking and none claims the operation proceeded", () => {
  const corrected = [
    "agent_launch.launch_failed_before_start.v1",
    "agent_launch.monitor.subject_observation_unavailable.v1",
    "agent_launch.monitor.run_detail_unavailable.v1",
    "agent_launch.monitor.proof_verification_evidence_unavailable.v1",
    "agent_launch.post_worker_lifecycle.recovery_unresponsive.v1",
    "agent_launch.post_worker_lifecycle.recovery_failed.v1",
    "agent_launch.managed_corrective_status.launcher_retirement_incomplete.v1",
    "agent_launch.slice_integration.cce_policy_refused.v1",
    "agent_launch.slice_integration.classification_unavailable.v1",
    "stdio_mcp_lifecycle_protocol_incompatible",
    "mcp_response.handler_exception.v1"
  ];
  for (const code of corrected) {
    const entry = getRuntimeBlockerEntry(code);
    assert.ok(entry, `${code} must be registered`);
    assert.equal(entry.blocking, true, `${code} must still refuse`);
    assert.equal(
      entry.actor_recovery === "automatic_proceed",
      false,
      `${code} must not authorise an automatic continuation`
    );
  }
});

test("the identities that truly have no callable route say so, and the two that do name it", () => {

  const noRoute = [
    "agent_launch.launch_failed_before_start.v1",
    "agent_launch.slice_integration.classification_unavailable.v1",
    "mcp_response.handler_exception.v1"
  ];
  for (const code of noRoute) {
    assert.equal(Object.hasOwn(getRuntimeBlockerEntry(code), "recovery"), false, code);
  }
  const retirement = getRuntimeBlockerEntry(
    "agent_launch.managed_corrective_status.launcher_retirement_incomplete.v1"
  );
  assert.equal(retirement.actor_recovery, "caller_retry");
  assert.equal(retirement.recovery.route, "workspace_agent_run_status");
  assert.deepEqual(retirement.recovery.argument_bindings, {
    subject: "corrective_status_slice_unit"
  });
});
