

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildBlockedDispatchResult,
  buildBlockedRunStatusResult,
  buildBlockedRunWaitResult,
  buildBlockedRunsListResult,
  buildDispatchToolExceptionDetail,
  compactRuntimeBlockerTaxonomy
} from "../../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import {
  PUBLIC_REDACTION_REASON_VALUES,
  projectLauncherRedactionReason
} from "../../packages/wiki-core/src/lib/refusal-payload.mjs";
import {
  captureStructuredDiagnostic
} from "../../packages/wiki-core/src/lib/diagnostic-projection.mjs";
import {
  PACKAGE_LOCAL_IDENTITY_NAMESPACE_VALUES,
  isDeclaredPackageLocalIdentity,
  isPreservableSemanticIdentity,
  isRuntimeBlockerCode,
  projectPublicBlockerCodeForIdentity
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  loadRuntimeBlockerTaxonomy,
  RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  LAUNCHER_TRANSITION_ABSENT_BACKEND_CAUSES,
  LAUNCHER_TRANSITION_FAILURES,
  LAUNCHER_TRANSITION_UNCLASSIFIED_CODE as CORE_LAUNCHER_TRANSITION_UNCLASSIFIED_CODE,
  classifyLauncherTransitionBackendRefusal
} from "../../packages/agent-launch-cli/src/lib/launcher-transition-plan.mjs";

const LAUNCHER_TRANSITION_UNCLASSIFIED_CODE =
  "launcher_transition.authenticated_backend_refusal_unclassified.v1";

test("WK-2352 the registry and the core owner agree on the unclassified code", () => {
  assert.equal(CORE_LAUNCHER_TRANSITION_UNCLASSIFIED_CODE, LAUNCHER_TRANSITION_UNCLASSIFIED_CODE);
});

const LAUNCHER_TRANSITION_EXPECTATIONS = Object.freeze({
  "launcher_transition.prospective_lifecycle_unavailable.v1": {
    category: "work_record_readiness", actor_recovery: "coordinator", blocking: true
  },
  "launcher_transition.lifecycle_allocation_failed.v1": {
    category: "work_record_readiness", actor_recovery: "coordinator", blocking: true
  },
  "launcher_transition.dependency_identity_unresolved.v1": {
    category: "work_record_readiness", actor_recovery: "coordinator", blocking: true
  },
  "launcher_transition.publication_identity_unresolved.v1": {
    category: "work_record_readiness", actor_recovery: "coordinator", blocking: true
  },
  "launcher_transition.cce_policy_refused.v1": {
    category: "role_policy", actor_recovery: "coordinator", blocking: true
  },
  "launcher_transition.findings_route_authentication_failed.v1": {
    category: "route", actor_recovery: "coordinator", blocking: true
  },
  "launcher_transition.runtime_backend_unavailable.v1": {
    category: "backend", actor_recovery: "operator", blocking: true
  },
  [LAUNCHER_TRANSITION_UNCLASSIFIED_CODE]: {
    category: "backend", actor_recovery: "operator", blocking: true
  }
});

test("WK-2352 launcher transition vocabulary is closed and exact", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const emittedCodes = Object.values(LAUNCHER_TRANSITION_FAILURES).map((entry) => entry.code);
  const expectedCodes = [...emittedCodes, LAUNCHER_TRANSITION_UNCLASSIFIED_CODE];
  const matchingEntries = taxonomy.codes.filter((entry) => expectedCodes.includes(entry.code));

  assert.equal(new Set(matchingEntries.map((entry) => entry.code)).size, matchingEntries.length,
    "launcher transition registry entries must not duplicate codes");
  const byCode = new Map(matchingEntries.map((entry) => [entry.code, entry]));

  assert.equal(new Set(expectedCodes).size, expectedCodes.length,
    "launcher transition expectations must not duplicate codes");
  assert.equal(new Set(emittedCodes).size, emittedCodes.length,
    "transition contract must not emit duplicate codes");

  for (const code of expectedCodes) {
    const entry = byCode.get(code);
    assert.ok(entry, `registry must register ${code}`);
    const expected = LAUNCHER_TRANSITION_EXPECTATIONS[code];
    assert.deepEqual(
      { category: entry.category, actor_recovery: entry.actor_recovery, blocking: entry.blocking },
      expected,
      `${code} must preserve its parent-contract authority and recovery posture`
    );
    assert.ok(typeof entry.summary === "string" && entry.summary.length > 0,
      `${code} must have a bounded operator meaning`);
    assert.ok(typeof entry.detail === "string" && entry.detail.length > 0,
      `${code} must describe bounded recovery`);
  }
});

test("WK-2352 preserves the stdio conduit mechanical cause", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const entry = taxonomy.codes.find((candidate) =>
    candidate.code === "stdio_mcp_conduit_input_invalid"
  );
  assert.ok(entry);
  assert.equal(entry.category, "transport");
  assert.equal(entry.actor_recovery, "operator");
  assert.equal(entry.blocking, true);
  assert.equal(
    entry.code === "launcher_transition.runtime_backend_unavailable.v1",
    false,
    "stdio conduit input invalid must never alias runtime backend unavailable"
  );
});

const READ_DISCLOSURE_NUDGE_CODES = [
  "compact_first_required",
  "compact_read_token_missing",
  "compact_read_token_malformed",
  "compact_read_token_wrong_schema",
  "compact_read_token_wrong_tool_family",
  "compact_read_token_wrong_scope",
  "compact_read_token_wrong_selector",
  "compact_read_token_stale_source_digest",
  "compact_read_token_expired",
  "selected_slice_compact_detail_required",
  "compact_read_selected_detail_required"
];

test("WK-1509 read_disclosure category is NOT in the dispatch-facing allowlist", () => {
  assert.ok(
    !RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES.includes("read_disclosure"),
    "read_disclosure must be excluded from the dispatch-facing category allowlist"
  );
});

test("WK-1509 the registry actually registers the read_disclosure nudge labels", () => {

  const taxonomy = loadRuntimeBlockerTaxonomy();
  const byCode = new Map(taxonomy.codes.map((entry) => [entry.code, entry]));
  for (const code of READ_DISCLOSURE_NUDGE_CODES) {
    const entry = byCode.get(code);
    assert.ok(entry, `registry must register nudge label ${code}`);
    assert.equal(
      entry.category,
      "read_disclosure",
      `${code} must be category read_disclosure`
    );
    assert.equal(entry.actor_recovery, "caller_retry", `${code} must be caller_retry`);
    assert.equal(entry.blocking, false, `${code} must be non-blocking`);
  }
});

test("WK-1509 dispatch projection excludes read_disclosure nudge labels", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const projection = compactRuntimeBlockerTaxonomy(taxonomy);

  const projectedCodes = new Set(projection.codes.map((entry) => entry.code));
  const projectedCategories = new Set(projection.codes.map((entry) => entry.category));

  assert.ok(
    !projectedCategories.has("read_disclosure"),
    "read_disclosure category must not appear in the dispatch-facing projection"
  );

  for (const code of READ_DISCLOSURE_NUDGE_CODES) {
    assert.ok(
      !projectedCodes.has(code),
      `nudge label ${code} must not appear in the dispatch blocker catalog`
    );
  }
});

test("WK-1509 nudge labels are not counted in the dispatch projection counts", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const projection = compactRuntimeBlockerTaxonomy(taxonomy);

  const dispatchFacing = new Set(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES);
  const expectedDispatchFacingCodes = taxonomy.codes.filter((entry) =>
    dispatchFacing.has(entry.category)
  );
  const expectedBlocking = expectedDispatchFacingCodes.filter((entry) =>
    Boolean(entry.blocking)
  ).length;

  assert.equal(
    projection.code_count,
    expectedDispatchFacingCodes.length,
    "code_count must cover only dispatch-facing codes"
  );
  assert.equal(projection.codes.length, projection.code_count);
  assert.equal(
    projection.blocking_count + projection.nonblocking_count,
    projection.code_count,
    "blocking + nonblocking counts must cover every projected code"
  );
  assert.equal(projection.blocking_count, expectedBlocking);

  assert.ok(
    projection.code_count < taxonomy.codes.length,
    "projection must drop the registered read_disclosure nudge labels"
  );
});

test("WK-1509 dispatch projection still includes the dispatch-facing categories", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const projection = compactRuntimeBlockerTaxonomy(taxonomy);

  const projectedCodes = new Set(projection.codes.map((entry) => entry.code));
  const projectedCategories = new Set(projection.codes.map((entry) => entry.category));

  assert.ok(
    projectedCodes.has("role_policy_violation"),
    "role_policy_violation must remain in the dispatch projection"
  );
  assert.ok(
    projectedCodes.has("backend_unavailable"),
    "backend_unavailable must remain in the dispatch projection"
  );

  const dispatchFacing = new Set(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES);
  for (const category of projectedCategories) {
    assert.ok(
      dispatchFacing.has(category),
      `projected category ${category} must be dispatch-facing`
    );
  }

  assert.ok(
    projectedCategories.has("role_policy"),
    "role_policy dispatch-facing category must be present"
  );
});

test("WK-2352 only the demonstrated-absence causes select runtime_backend_unavailable", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const byCode = new Map(taxonomy.codes.map((entry) => [entry.code, entry]));

  assert.deepEqual([...LAUNCHER_TRANSITION_ABSENT_BACKEND_CAUSES].sort(),
    ["backend_unavailable", "launch_backend_unavailable"]);
  const registeredAbsence = byCode.get("backend_unavailable");
  assert.ok(registeredAbsence);
  assert.equal(registeredAbsence.category, "backend");
  assert.equal(registeredAbsence.actor_recovery, "operator");

  for (const cause of LAUNCHER_TRANSITION_ABSENT_BACKEND_CAUSES) {
    const classification = classifyLauncherTransitionBackendRefusal({
      schema_version: "workspace-agent-dispatch-backend.v1",
      accepted: false,
      refusal: { code: "backend_unavailable", reason: cause, detail: null }
    });
    assert.equal(classification.state, "actual_backend_unavailable");
    assert.equal(classification.transition_failure.code,
      "launcher_transition.runtime_backend_unavailable.v1");
  }

  for (const entry of taxonomy.codes) {
    if (entry.category !== "backend") continue;
    if (LAUNCHER_TRANSITION_ABSENT_BACKEND_CAUSES.includes(entry.code)) continue;
    if (entry.code.startsWith("launcher_transition.")) continue;
    const classification = classifyLauncherTransitionBackendRefusal({
      schema_version: "workspace-agent-dispatch-backend.v1",
      accepted: false,
      refusal: { code: "operator_recovery_needed", reason: entry.code, detail: null }
    });
    assert.notEqual(classification.state, "actual_backend_unavailable", entry.code);
    assert.notEqual(classification.transition_failure.code,
      "launcher_transition.runtime_backend_unavailable.v1", entry.code);
  }
});

test("WK-2352 the unclassified code is registered but is not a plan failure", () => {
  const taxonomy = loadRuntimeBlockerTaxonomy();
  const entry = taxonomy.codes.find((candidate) =>
    candidate.code === LAUNCHER_TRANSITION_UNCLASSIFIED_CODE);
  assert.ok(entry, "the unclassified code must be registered and enumerable");
  assert.equal(entry.blocking, true);

  assert.equal(
    Object.values(LAUNCHER_TRANSITION_FAILURES)
      .some((failure) => failure.code === LAUNCHER_TRANSITION_UNCLASSIFIED_CODE),
    false
  );
});

test("WK-2352 stdio_mcp_conduit_input_invalid keeps its registered transport recovery", () => {
  const classification = classifyLauncherTransitionBackendRefusal({
    schema_version: "workspace-agent-dispatch-backend.v1",
    accepted: false,
    refusal: {
      code: "operator_recovery_needed",
      reason: "stdio_mcp_conduit_input_invalid",
      detail: { message: "raw" }
    }
  });
  const entry = loadRuntimeBlockerTaxonomy().codes.find((candidate) =>
    candidate.code === "stdio_mcp_conduit_input_invalid");

  assert.equal(classification.actor_recovery, entry.actor_recovery);
  assert.equal(classification.cause.code, entry.code);
  assert.notEqual(classification.transition_failure.code,
    "launcher_transition.runtime_backend_unavailable.v1");
});

const BUILDERS = [
  ["buildBlockedDispatchResult", buildBlockedDispatchResult],
  ["buildBlockedRunStatusResult", buildBlockedRunStatusResult],
  ["buildBlockedRunWaitResult", buildBlockedRunWaitResult],
  ["buildBlockedRunsListResult", buildBlockedRunsListResult]
];

const REGISTERED_CODE = "operator_recovery_needed";
const CANONICAL_TOOL = "workspace_agent_dispatch";

for (const [name, build] of BUILDERS) {
  test(`WK-2359: ${name} accepts a registered code and a canonical next call`, () => {
    const envelope = build({
      blockerCode: REGISTERED_CODE,
      reason: "example_reason",
      detail: { field: "value" },
      nextCalls: [{ tool: CANONICAL_TOOL, recommended: true }]
    });
    assert.equal(envelope.accepted, false);
    assert.equal(envelope.blocker.code, REGISTERED_CODE);
    assert.equal(isRuntimeBlockerCode(envelope.blocker.code), true);
    assert.equal(envelope.blocker.reason, "example_reason");
    assert.deepEqual(envelope.blocker.detail, { field: "value" });

    assert.equal(envelope.next_action, CANONICAL_TOOL);
  });

  test(`WK-2359: ${name} refuses an unregistered public code`, () => {
    assert.throws(
      () => build({ blockerCode: "invented_public_code", reason: "r" }),
      /registered runtime blocker code/,
      `${name} must not publish an unregistered code`
    );
    assert.throws(() => build({ blockerCode: null, reason: "r" }), /registered runtime blocker code/);
    assert.throws(() => build({ blockerCode: 7, reason: "r" }), /registered runtime blocker code/);
  });

  test(`WK-2359: ${name} refuses an invalid next call`, () => {
    assert.throws(
      () => build({
        blockerCode: REGISTERED_CODE,
        reason: "r",
        nextCalls: [{ tool: "not_a_registered_route" }]
      }),
      /invalid next calls/,
      `${name} must not publish a next call the agent cannot invoke`
    );
  });

  test(`WK-2359: ${name} never treats a private launcher action token as a tool`, () => {
    assert.throws(
      () => build({
        blockerCode: REGISTERED_CODE,
        reason: "r",
        nextCalls: [{ tool: "restore_wk_lifecycle", recommended: true }]
      }),
      /invalid next calls/
    );
  });

  test(`WK-2359: ${name} keeps its envelope shape when no remedy is supplied`, () => {
    const envelope = build({ blockerCode: REGISTERED_CODE, reason: "r" });
    assert.equal(Object.hasOwn(envelope, "next_action"), false,
      "the remedy slot must stay absent rather than materialize as null");
    assert.equal(envelope.blocker.detail, null);
  });
}

test("WK-2359: the runs-list envelope carries the same blocker limb as its siblings", () => {

  const runsList = buildBlockedRunsListResult({ blockerCode: REGISTERED_CODE, reason: "r" });
  const dispatch = buildBlockedDispatchResult({ blockerCode: REGISTERED_CODE, reason: "r" });
  assert.deepEqual(runsList.blocker, dispatch.blocker);
  assert.equal(runsList.runs, null);
  assert.equal(runsList.accepted, false);
});

test("WK-2359: identical inputs build an identical blocked envelope", () => {
  const input = {
    blockerCode: REGISTERED_CODE,
    reason: "example_reason",
    detail: { field: "value" },
    nextCalls: [{ tool: CANONICAL_TOOL, recommended: true }]
  };
  assert.deepEqual(
    buildBlockedDispatchResult({ ...input }),
    buildBlockedDispatchResult({ ...input })
  );
});

test("WK-2359: every launcher-private redaction reason has a public projection", () => {

  const refusal = classifyLauncherTransitionBackendRefusal({
    schema_version: "workspace-agent-dispatch-backend.v1",
    accepted: false,
    refusal: {
      code: "launch_refused",
      reason: "managed_worktree_provisioning_unavailable",
      detail: {

        message: captureStructuredDiagnostic(
          "failed at /home/user/secret/path using super-secret-token",
          {
            sensitiveValues: [{
              field: "credential",
              value: "super-secret-token",
              reason: "secret_material"
            }]
          }
        ),
        observed_canonical_status: "launcher_internal"
      }
    }
  });

  assert.ok(refusal.redactions.length > 0, "the fixture must actually redact something");
  for (const signal of refusal.redactions) {
    const projected = projectLauncherRedactionReason(signal.reason);
    assert.ok(
      PUBLIC_REDACTION_REASON_VALUES.includes(projected),
      `private reason ${signal.reason} must project into the public vocabulary`
    );

    assert.equal(typeof signal.field, "string");
    assert.ok(signal.field.length > 0);
  }
});

test("WK-2359: an unmapped private redaction reason fails rather than escaping", () => {
  assert.throws(
    () => projectLauncherRedactionReason("some_future_private_reason"),
    /public redaction vocabulary is closed/
  );
  const retiredReason = ["sensitive", "error", "text"].join("_");
  assert.throws(
    () => projectLauncherRedactionReason(retiredReason),
    /public redaction vocabulary is closed/
  );
});

test("WK-2359: the backend refusal builder accepts every registered backend code", async () => {
  const { buildRefusal, dispatchRefusal, statusRefusal } = await import(
    "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-refusal.mjs"
  );
  const { BACKEND_REFUSAL_CODES } = await import("@agent-chassis/agent-launch-core");

  for (const code of Object.values(BACKEND_REFUSAL_CODES)) {
    assert.equal(isRuntimeBlockerCode(code), true,
      `BACKEND_REFUSAL_CODES.${code} must be a registered taxonomy identity`);
    const envelope = buildRefusal("workspace-agent-dispatch-backend.v1", code, "r", null);
    assert.equal(envelope.accepted, false);
    assert.equal(envelope.refusal.code, code);
    assert.equal(envelope.refusal.reason, "r");
    assert.equal(envelope.refusal.detail, null);

    assert.equal(dispatchRefusal(code, "r").refusal.code, code);
    assert.equal(statusRefusal(code, "r").refusal.code, code);
  }
});

test("WK-2359: the backend refusal builder refuses an ad-hoc code", async () => {
  const { buildRefusal, dispatchRefusal, statusRefusal } = await import(
    "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-refusal.mjs"
  );
  for (const bad of ["x_blocked", "backend_said_no", "", null, undefined, 42]) {
    assert.throws(
      () => buildRefusal("workspace-agent-dispatch-backend.v1", bad, "r", null),
      /registered runtime blocker code/,
      `ad-hoc code ${String(bad)} must be refused`
    );
  }
  assert.throws(() => dispatchRefusal("x_blocked", "r"), /registered runtime blocker code/);
  assert.throws(() => statusRefusal("x_blocked", "r"), /registered runtime blocker code/);
});

const KNOWN_DOTTED_IDENTITIES = [
  "launcher_transition.cce_policy_refused.v1",
  "launcher_transition.runtime_backend_unavailable.v1",
  "agent_launch.terminal_candidate.route_failure.v1",
  "agent_dispatch_identity.ambient_env_role.v1",
  "worker_admission.accepted_authority.v1",
  "mcp_response.spill_persistence_failed.v1",
  "review_attestation.blocking_findings.v1",
  "node_engine_api_client.api_key_unconfigured.v1"
];

const UNKNOWN_DOTTED_STRINGS = [
  "attacker.supplied.evil.v1",
  "evil.v1",
  "launcher_transition_evil.spoofed.v1",
  "not_a_namespace.something.v1",
  "..v1",
  "agent_launch.no_version_suffix",
  "AGENT_LAUNCH.upper.v1",
  "agent_launch.trailing.v",
  "agent_launch.bad segment.v1"
];

const PLATFORM_CODES = [
  "ENOENT", "EACCES", "ENOSPC", "EISDIR", "EROFS", "EMFILE",
  "ERR_MODULE_NOT_FOUND", "ERR_REQUIRE_ESM", "ERR_UNKNOWN_FILE_EXTENSION"
];

test("WK-2359 dotted: a known identity is preserved verbatim in its private field", async () => {
  const { classifyControlledContractFailure, createControlledContractRefusal } = await import(
    "../../packages/wiki-core/src/operations/controlled-contract/refusal.mjs"
  );
  const { boundPublicSemanticCode } = await import(
    "../../packages/wiki-core/src/lib/refusal-payload.mjs"
  );

  for (const identity of KNOWN_DOTTED_IDENTITIES) {
    const classified = classifyControlledContractFailure({ code: identity });
    assert.equal(classified.disposition, "package_defined", identity);

    assert.equal(classified.reason_code, identity, identity);
    assert.notEqual(classified.reason_code, "controlled_contract_operation_failed");

    assert.equal(boundPublicSemanticCode(identity, "<fallback>"), identity, identity);

    const payload = createControlledContractRefusal(
      Object.assign(new Error("x"), { code: identity })
    ).envelope.warning.payload;
    assert.equal(payload.reason_code, identity, identity);
    assert.equal("internal_invariant" in payload.details, false, identity);
  }
});

test("WK-2359 dotted: the public blocker projection is registered and deterministic", () => {
  for (const identity of KNOWN_DOTTED_IDENTITIES) {
    const first = projectPublicBlockerCodeForIdentity(identity);
    const second = projectPublicBlockerCodeForIdentity(identity);
    assert.equal(first, second, `${identity} must project deterministically`);
    if (first === null) continue;
    assert.equal(
      isRuntimeBlockerCode(first),
      true,
      `${identity} projects to ${first}, which must be a REGISTERED public code`
    );
  }
});

test("WK-2359 dotted: a registered identity projects to ITSELF, never to a substitute", () => {

  for (const identity of [
    "launcher_transition.cce_policy_refused.v1",
    "agent_launch.terminal_candidate.route_failure.v1",
    "mcp_response.spill_persistence_failed.v1"
  ]) {
    assert.equal(isRuntimeBlockerCode(identity), true);
    assert.equal(projectPublicBlockerCodeForIdentity(identity), identity);
  }
});

test("WK-2359 dotted: every declared namespace projection names a registered code", () => {

  for (const namespace of PACKAGE_LOCAL_IDENTITY_NAMESPACE_VALUES) {
    const probe = `${namespace}.probe_identity.v1`;
    const projected = projectPublicBlockerCodeForIdentity(probe);
    if (projected === null) continue;
    assert.equal(isRuntimeBlockerCode(projected), true,
      `namespace ${namespace} projects to unregistered ${projected}`);
  }
});

test("WK-2359 dotted: an undeclared dotted string is rejected rather than trusted", async () => {
  const { classifyControlledContractFailure } = await import(
    "../../packages/wiki-core/src/operations/controlled-contract/refusal.mjs"
  );
  const { boundPublicSemanticCode } = await import(
    "../../packages/wiki-core/src/lib/refusal-payload.mjs"
  );

  for (const hostile of UNKNOWN_DOTTED_STRINGS) {
    assert.equal(isDeclaredPackageLocalIdentity(hostile), false, hostile);
    assert.equal(isPreservableSemanticIdentity(hostile), false, hostile);
    assert.equal(projectPublicBlockerCodeForIdentity(hostile), null, hostile);

    assert.equal(
      classifyControlledContractFailure({ code: hostile }).reason_code,
      "controlled_contract_operation_failed",
      hostile
    );
    assert.equal(boundPublicSemanticCode(hostile, "<fallback>"), "<fallback>", hostile);
  }
});

test("WK-2359 dotted: a declared namespace does not vouch for a malformed identity", () => {

  for (const malformed of [
    "agent_launch",
    "agent_launch.",
    "agent_launch..v1",
    "agent_launch.x.v",
    "agent_launch.x.v1234",
    "agent_launch.x.V1"
  ]) {
    assert.equal(isDeclaredPackageLocalIdentity(malformed), false, malformed);
  }
});

test("WK-2359 dotted: a platform code is never admitted as a semantic identity", async () => {
  const { classifyControlledContractFailure } = await import(
    "../../packages/wiki-core/src/operations/controlled-contract/refusal.mjs"
  );
  const { boundPublicSemanticCode } = await import(
    "../../packages/wiki-core/src/lib/refusal-payload.mjs"
  );

  for (const code of PLATFORM_CODES) {
    assert.equal(isPreservableSemanticIdentity(code), false, code);
    assert.equal(isDeclaredPackageLocalIdentity(code), false, code);
    const classified = classifyControlledContractFailure({ code });
    assert.equal(classified.disposition, "platform", code);
    assert.equal(classified.reason_code, "controlled_contract_platform_failure", code);
    assert.notEqual(classified.reason_code, code);
    assert.equal(boundPublicSemanticCode(code, "<fallback>"), "<fallback>", code);
  }
});

test("WK-2359 dotted: platform detection precedes identity membership", () => {

  assert.equal(isPreservableSemanticIdentity("ERR_MODULE_NOT_FOUND"), false);
  assert.equal(isPreservableSemanticIdentity("ENOENT"), false);
});

test("WK-2359 dotted: the monitoring exception diagnostic preserves the dotted cause", () => {

  const identity = "agent_launch.terminal_candidate.route_failure.v1";
  const detail = buildDispatchToolExceptionDetail(
    "workspace_agent_run_status",
    Object.assign(new Error("route failed"), { code: identity })
  );
  assert.equal(detail.cause_code, identity);
  assert.equal(detail.error_message, "route failed");
});

test("WK-2359 dotted: the exception diagnostic admits no untrusted or platform cause", () => {
  for (const code of ["attacker.supplied.evil.v1", "ENOENT", "ERR_MODULE_NOT_FOUND"]) {
    const detail = buildDispatchToolExceptionDetail(
      "workspace_agent_run_status",
      Object.assign(new Error("boom"), { code })
    );
    assert.equal(Object.hasOwn(detail, "cause_code"), false, code);
  }

  const plain = buildDispatchToolExceptionDetail("t", new Error("boom"));
  assert.equal(Object.hasOwn(plain, "cause_code"), false);
});

test("WK-2359 dotted: the recovery projection does not replace a declared cause", async () => {
  const { mapBackendRefusalToDispatchCode } = await import(
    "../../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs"
  );

  assert.equal(
    mapBackendRefusalToDispatchCode("launcher_transition.cce_policy_refused.v1"),
    "launcher_transition.cce_policy_refused.v1"
  );

  const projected = mapBackendRefusalToDispatchCode("agent_dispatch_identity.ambient_env_role.v1");
  assert.equal(projected, "caller_supplied_identity");
  assert.equal(isRuntimeBlockerCode(projected), true);

  assert.equal(
    mapBackendRefusalToDispatchCode("attacker.supplied.evil.v1"),
    "launcher_transition.backend_refusal_identity_unknown.v1"
  );
  assert.equal(
    mapBackendRefusalToDispatchCode(undefined),
    "launcher_transition.backend_refusal_identity_missing.v1"
  );
  assert.equal(
    mapBackendRefusalToDispatchCode({ code: "unusable" }),
    "launcher_transition.backend_refusal_identity_missing.v1"
  );
});

test("WK-2359 dotted: the launcher-transition classifier keeps its dotted cause end to end", () => {

  const classification = classifyLauncherTransitionBackendRefusal({
    schema_version: "workspace-agent-dispatch-backend.v1",
    accepted: false,
    refusal: {
      code: "launch_refused",
      reason: "managed_worktree_provisioning_unavailable",
      detail: { cause: { code: "controlled_contract_repository_unavailable" } }
    }
  });

  assert.equal(classification.cause.code, "controlled_contract_repository_unavailable");

  assert.equal(isRuntimeBlockerCode(classification.blocker_code), true);
});
