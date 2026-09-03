

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RUNTIME_BLOCKER_CODES,
  RUNTIME_BLOCKER_CATEGORY_VALUES,
  RUNTIME_BLOCKER_CODE_VALUES,
  RUNTIME_BLOCKER_DESCRIPTOR,
  RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES,
  RUNTIME_BLOCKER_TAXONOMY_OWNER,
  RUNTIME_BLOCKER_TAXONOMY_SCHEMA_VERSION,
  WK_0532_BOOTSTRAP_SUBSET,
  assertRuntimeBlockerSubset,
  evaluateGraphImpactBlocker,
  getRuntimeBlockerEntry,
  isBlockingRuntimeBlocker,
  isRuntimeBlockerCode,
  loadRuntimeBlockerTaxonomy,
  NON_REGISTRABLE_AUTHORITY_IDENTITIES,
  PRIVATE_CAUSE_DECLARATION_VALUES,
  assertRuntimeBlockerDescriptorShape,
  classifySemanticIdentity,
  getPrivateCauseKind,
  isDeclaredPrivateCause,
  isPublicMechanicalRefusalCode
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  isCanonicalNextCallTool,
  unresolvedArgumentNames
} from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";
import {
  STDIO_MCP_CLEANUP_BLOCKER_REASON,
  STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";
import { BOOTSTRAP_STATE_CODES } from "../../packages/wiki-core/src/lib/agent-dispatch-identity.mjs";
import { evaluateCoordinationPreflight } from "../../packages/wiki-core/src/lib/coordination-preflight.mjs";

test("taxonomy descriptor declares every required category", () => {
  for (const category of [
    "role_policy",
    "caller_identity",
    "work_record_readiness",
    "transport",
    "backend",
    "filesystem",
    "sandbox",
    "validation",
    "route",
    "discovery",
    "review_transport",
    "monitor_handle",
    "bootstrap",
    "graph_impact",
    "graph_impact_persistence",
    "taxonomy",
    "operator_recovery"
  ]) {
    assert.ok(
      RUNTIME_BLOCKER_CATEGORY_VALUES.includes(category),
      `category ${category} must be declared`
    );
  }
});

test("taxonomy descriptor declares every required stable code", () => {
  const required = [
    "role_policy_violation",
    "caller_role_mismatch",
    "caller_supplied_identity",
    "work_record_readiness_failure",
    "missing_structured_transport",
    "backend_unavailable",
    "read_only_mount",
    "sandbox_write_denial",
    "validation_failure",
    "unsupported_route",
    "non_mcp_role_route_blocked",
    "hidden_route_reached",
    "hidden_route_discovery_leak",
    "mcp_reviewer_dispatch_missing",
    "review_transport_runtime_failure",
    "mandatory_review_transport_blocked",
    "monitor_handle_unknown",
    "monitor_handle_subject_mismatch",
    "monitor_handle_caller_mismatch",
    "monitor_handle_replay",
    "bootstrap_exception_active",
    "bootstrap_review_missing",
    "bootstrap_exception_consumed",
    "graph_impact_unavailable",
    "graph_impact_query_error",
    "graph_impact_artifact_missing",
    "graph_impact_rebuild_required",
    "graph_impact_degraded_overlay",
    "graph_impact_unknown_state",
    "graph_impact_persistence_unavailable",
    "taxonomy_corpus_unavailable",
    "operator_recovery_needed",
    "stdio_mcp_lifecycle_protocol_incompatible",
    "managed_lifecycle_required",
    "managed_worktree_provisioning_unavailable",
    "managed_slice_tip_reconcile_required"
  ];
  for (const code of required) {
    assert.ok(isRuntimeBlockerCode(code), `taxonomy must declare code ${code}`);
    assert.ok(RUNTIME_BLOCKER_CODE_VALUES.includes(code));
  }
});

test("WK-2333 modeled recovery and response failures have specific registered identities", () => {
  const modeledCodes = [
    "launcher_declaration_missing",
    "authority_binding_unratified",
    "decision_envelope_malformed",
    "decision_envelope_unknown",
    "decision_envelope_contradictory",
    "decision_envelope_unauthenticated",
    "launcher_transition.backend_refusal_identity_missing.v1",
    "launcher_transition.backend_refusal_identity_unknown.v1",
    "runtime_materialization_failed",
    "worker_admission_recovery_missing",
    "worker_admission_recovery_malformed",
    "worker_admission_recovery_unknown_version",
    "worker_admission_recovery_unknown_field",
    "worker_admission_recovery_wrong_projection_mode",
    "worker_admission_recovery_authority_mismatch",
    "worker_admission_recovery_resubmission_mismatch",
    "worker_admission_recovery_truncated",
    "worker_admission_recovery_actions_malformed",
    "worker_admission_recovery_route_unavailable",
    "workspace_repo_resolution_invalid",
    "mcp_response.handler_exception.v1",
    "mcp_response.platform_failure.v1"
  ];
  for (const code of modeledCodes) {
    assert.equal(isRuntimeBlockerCode(code), true, code);
    assert.notEqual(code, "operator_recovery_needed");
  }
  const operator = getRuntimeBlockerEntry("operator_recovery_needed");
  assert.match(operator.summary, /authenticated unexpected condition/i);
  assert.match(operator.consumer_notes, /exact authenticated external condition/i);
});

test("WK-2333 taxonomy prose never redirects modeled envelope defects to operator recovery", () => {
  const envelopeCodes = [
    "decision_envelope_malformed",
    "decision_envelope_unknown",
    "decision_envelope_contradictory",
    "decision_envelope_unauthenticated"
  ];
  for (const code of envelopeCodes) {
    const entry = getRuntimeBlockerEntry(code);
    assert.match(entry.consumer_notes, new RegExp(`Publish ${code} directly`));
    assert.match(entry.consumer_notes, /no supported next call/i);
    assert.doesNotMatch(entry.consumer_notes, /operator_recovery_needed/);
  }

  const authority = getRuntimeBlockerEntry("authority_binding_unratified");
  assert.match(authority.consumer_notes, /Publish authority_binding_unratified directly/);
  assert.match(authority.consumer_notes, /authority owner must ratify/i);
  assert.doesNotMatch(authority.consumer_notes, /operator_recovery_needed/);

  const backend = getRuntimeBlockerEntry("backend_unavailable");
  assert.doesNotMatch(backend.consumer_notes, /operator_recovery_needed/);

  for (const code of [
    "launcher_transition.backend_refusal_identity_missing.v1",
    "launcher_transition.backend_refusal_identity_unknown.v1"
  ]) {
    const entry = getRuntimeBlockerEntry(code);
    assert.equal(entry.category, "validation");
    assert.equal(entry.actor_recovery, "none");
    assert.doesNotMatch(JSON.stringify(entry), /operator_recovery_needed/);
  }
});

test("WK-1781 composition refusal publishes its specific identity and deployment continuation", () => {
  const entry = getRuntimeBlockerEntry("stdio_mcp_lifecycle_protocol_incompatible");
  assert.ok(entry);
  assert.equal(entry.category, "operator_recovery");
  assert.equal(entry.actor_recovery, "operator");
  assert.equal(entry.blocking, true);
  assert.equal(entry.recovery,
    "deploy one coherent build and restart the long-lived backend");
  assert.match(entry.consumer_notes, /Publish stdio_mcp_lifecycle_protocol_incompatible directly/);
  assert.match(entry.consumer_notes, /retry the original structured operation/);
  assert.doesNotMatch(entry.consumer_notes, /operator_recovery_needed/);
});

test("managed lifecycle blockers have distinct stable categories and structured recovery", () => {
  const lifecycle = getRuntimeBlockerEntry("managed_lifecycle_required");
  const provisioning = getRuntimeBlockerEntry("managed_worktree_provisioning_unavailable");

  assert.equal(lifecycle.category, "work_record_readiness");
  assert.equal(provisioning.category, "backend");
  assert.notEqual(lifecycle.category, provisioning.category);
  assert.equal(lifecycle.blocking, true);
  assert.equal(provisioning.blocking, true);
  assert.equal(lifecycle.actor_recovery, "coordinator");
  assert.equal(provisioning.actor_recovery, "operator");

  for (const entry of [lifecycle, provisioning]) {
    assert.deepEqual(entry.recovery?.kind, "structured_route");
    assert.equal(entry.recovery?.route, "workspace_coordination_preflight");
    const recovery = JSON.stringify(entry.recovery);
    assert.doesNotMatch(recovery, /\b(?:shell|env|environment|wrapper|root)\b/i);
  }
});

test("WK-1694 the slice-tip reconciliation blocker is coordinator-owned review recovery, not a provisioning-capability failure", () => {
  const reconcile = getRuntimeBlockerEntry("managed_slice_tip_reconcile_required");
  const provisioning = getRuntimeBlockerEntry("managed_worktree_provisioning_unavailable");

  assert.ok(reconcile, "the taxonomy must register managed_slice_tip_reconcile_required");
  assert.equal(reconcile.code, "managed_slice_tip_reconcile_required");
  assert.equal(RUNTIME_BLOCKER_CODES.MANAGED_SLICE_TIP_RECONCILE_REQUIRED, reconcile.code);
  assert.equal(reconcile.category, "backend");
  assert.equal(reconcile.blocking, true, "the launch fails closed");

  assert.equal(reconcile.actor_recovery, "coordinator");
  assert.notEqual(reconcile.actor_recovery, provisioning.actor_recovery);
  assert.equal(reconcile.recovery.kind, "structured_route");
  assert.equal(reconcile.recovery.route, "workspace_agent_dispatch");
  assert.notEqual(reconcile.recovery.route, provisioning.recovery.route);
  assert.notEqual(
    reconcile.recovery.route,
    "workspace_coordination_preflight",
    "reconciliation recovery is exact-slice review, never a capability preflight"
  );
  assert.equal(reconcile.recovery.arguments.role, "reviewer");

  assert.match(reconcile.summary, /provisioning is available/i);
  assert.match(reconcile.detail, /before any attempt binding, ref mutation, worktree mutation/i);
  assert.match(reconcile.detail, /does not assert that the prior worker terminated/i);
  assert.match(reconcile.detail, /no authority to delete, move, reset, rebase, or integrate any ref/i);
  assert.match(reconcile.detail, /nor to launch a replacement worker/i);
  assert.match(reconcile.consumer_notes, /review/i);

  assert.ok(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES.includes(reconcile.category));
  assert.doesNotMatch(JSON.stringify(reconcile.recovery), /\b(?:shell|env|environment|wrapper|root)\b/i);

  assert.equal(provisioning.actor_recovery, "operator");
  assert.equal(provisioning.recovery.route, "workspace_coordination_preflight");
});

test("deferred managed runtime codes are not published", () => {
  for (const code of [
    "managed_attempt_state_unavailable",
    "managed_controller_unavailable",
    "managed_bootstrap_executor_unavailable"
  ]) {
    assert.equal(isRuntimeBlockerCode(code), false, `${code} remains deferred`);
  }
});

test("every taxonomy entry has category and actor_recovery fields", () => {
  const allowedActorRecovery = new Set(
    RUNTIME_BLOCKER_DESCRIPTOR.actor_recovery_values ?? []
  );
  for (const entry of RUNTIME_BLOCKER_DESCRIPTOR.codes) {
    assert.equal(typeof entry.code, "string");
    assert.equal(typeof entry.category, "string");
    assert.equal(typeof entry.summary, "string");
    assert.equal(typeof entry.blocking, "boolean");
    assert.ok(entry.actor_recovery, `${entry.code} must declare actor_recovery`);
    assert.ok(
      allowedActorRecovery.has(entry.actor_recovery),
      `${entry.code} actor_recovery ${entry.actor_recovery} must be in the controlled vocabulary`
    );
  }
});

const WK_1509_REGISTERED_COMPACT_READ_LABELS = Object.freeze([
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
  "compact_read_selected_detail_required",
  "controlled_contract_proof_plan_request_missing",
  "controlled_contract_evaluation_input_missing",
  "controlled_contract_proof_plan_missing",
  "controlled_contract_proof_plan_stale"
]);

const WK_1509_UNREGISTERED_COMPACT_READ_STATES = Object.freeze([
  "compact_read_token_accepted",
  "compact_read_not_required"
]);

test("RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES is the dispatch/launch allowlist and excludes read_disclosure nudge categories (WK-1509 B1)", () => {

  assert.ok(
    Array.isArray(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES),
    "RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES must be exported as an array"
  );
  assert.ok(
    Object.isFrozen(RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES),
    "the dispatch-facing allowlist must be frozen"
  );
  assert.ok(
    !RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES.includes("read_disclosure"),
    "read_disclosure is a self-recoverable nudge category and must be excluded from the dispatch-facing allowlist"
  );

  const NON_DISPATCH_CATEGORIES = ["read_disclosure", "controlled_contract"];
  for (const category of RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES) {
    assert.ok(
      RUNTIME_BLOCKER_CATEGORY_VALUES.includes(category),
      `dispatch-facing category ${category} must be a registered descriptor category`
    );
  }
  for (const category of NON_DISPATCH_CATEGORIES) {
    assert.ok(
      RUNTIME_BLOCKER_CATEGORY_VALUES.includes(category),
      `${category} must be a registered descriptor category`
    );
    assert.ok(
      !RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES.includes(category),
      `${category} is not a dispatch/launch category and must be excluded from the allowlist`
    );
  }
  assert.deepEqual(
    RUNTIME_BLOCKER_CATEGORY_VALUES.filter(
      (category) => !RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES.includes(category)
    ).sort(),
    [...NON_DISPATCH_CATEGORIES].sort(),
    "the only categories outside the dispatch-facing allowlist are the declared non-dispatch ones"
  );
});

test("caller_retry is a member of the actor_recovery controlled vocabulary (WK-1509 B3)", () => {
  const actorRecovery = RUNTIME_BLOCKER_DESCRIPTOR.actor_recovery_values ?? [];
  assert.ok(
    actorRecovery.includes("caller_retry"),
    "actor_recovery_values must include caller_retry"
  );
});

test("refusal-facing compact-read labels are registered as read_disclosure / caller_retry / non-blocking nudge codes (WK-1509 B3)", () => {
  for (const code of WK_1509_REGISTERED_COMPACT_READ_LABELS) {
    const entry = getRuntimeBlockerEntry(code);
    assert.ok(entry, `compact-read label ${code} must be registered in the taxonomy`);
    assert.equal(entry.code, code);
    assert.equal(
      entry.category,
      "read_disclosure",
      `${code} must be categorized as read_disclosure`
    );
    assert.equal(
      entry.actor_recovery,
      "caller_retry",
      `${code} must declare actor_recovery caller_retry`
    );
    assert.equal(entry.blocking, false, `${code} must be non-blocking`);

    assert.ok(
      typeof entry.detail === "string" && /corrected/i.test(entry.detail),
      `${code} must carry the corrected-args semantics in its detail`
    );
  }

  const readDisclosureCodes = RUNTIME_BLOCKER_DESCRIPTOR.codes
    .filter((entry) => entry.category === "read_disclosure")
    .map((entry) => entry.code);
  assert.deepEqual(
    readDisclosureCodes.slice().sort(),
    WK_1509_REGISTERED_COMPACT_READ_LABELS.slice().sort(),
    "read_disclosure category must contain exactly the WK-1509 compact-read label set"
  );
});

test("transient/accepted compact-read states are NOT registered as reason labels (WK-1509 B3)", () => {
  for (const code of WK_1509_UNREGISTERED_COMPACT_READ_STATES) {
    assert.equal(
      isRuntimeBlockerCode(code),
      false,
      `transient/accepted state ${code} must not be registered as a taxonomy code`
    );
    assert.equal(getRuntimeBlockerEntry(code), null);
  }
});

test("compact-read reason labels carry no cryptographic-authenticity wording (WK-1599 SLICE-004)", () => {

  const forbidden = /\b(signature|signatures|signed|signing|hmac|mac|authenticit\w*|issuer|issuance|cryptograph\w*|unforgeab\w*|verif(?:y|ies|ied|ication))\b/i;
  for (const code of WK_1509_REGISTERED_COMPACT_READ_LABELS) {
    const entry = getRuntimeBlockerEntry(code);
    assert.ok(entry, `compact-read label ${code} must be registered`);
    for (const field of ["summary", "detail", "consumer_notes"]) {
      const text = entry[field];
      if (typeof text !== "string") continue;
      assert.equal(
        forbidden.test(text),
        false,
        `${code}.${field} must not reintroduce cryptographic-authenticity wording: ${JSON.stringify(text)}`
      );
    }
  }

  const malformed = getRuntimeBlockerEntry("compact_read_token_malformed");
  assert.match(malformed.summary, /acknowledgment/i);
});

test("monitor_handle_* codes are present with category monitor_handle (WK-0526 dispatch contract)", () => {

  const monitorCodes = [
    "monitor_handle_unknown",
    "monitor_handle_subject_mismatch",
    "monitor_handle_caller_mismatch",
    "monitor_handle_replay"
  ];
  for (const code of monitorCodes) {
    const entry = getRuntimeBlockerEntry(code);
    assert.ok(entry, `monitor_handle family must include ${code}`);
    assert.equal(entry.code, code);
    assert.equal(
      entry.category,
      "monitor_handle",
      `${code} must be categorized as monitor_handle`
    );
    assert.equal(entry.blocking, true, `${code} must be blocking`);
    assert.ok(typeof entry.summary === "string" && entry.summary.length > 0);
  }

  const monitorEntriesByCategory = RUNTIME_BLOCKER_DESCRIPTOR.codes.filter(
    (entry) => entry.category === "monitor_handle"
  );
  assert.deepEqual(
    monitorEntriesByCategory.map((entry) => entry.code).sort(),
    monitorCodes.slice().sort(),
    "monitor_handle category must contain exactly the WK-0526 monitor-handle family"
  );
});

test("taxonomy entries do not declare self-referential aliases", () => {

  for (const entry of RUNTIME_BLOCKER_DESCRIPTOR.codes) {
    if (!Array.isArray(entry.aliases)) continue;
    for (const alias of entry.aliases) {
      assert.notEqual(
        alias,
        entry.code,
        `${entry.code} declares a self-referential alias`
      );
    }
  }
});

test("WK-0532 BOOTSTRAP_STATE_CODES are string-equal to taxonomy entries", () => {
  for (const literal of Object.values(BOOTSTRAP_STATE_CODES)) {
    assert.ok(
      WK_0532_BOOTSTRAP_SUBSET.includes(literal),
      `WK-0532 BOOTSTRAP_STATE_CODES.${literal} must be present in wk_0532_bootstrap_subset`
    );
    const entry = getRuntimeBlockerEntry(literal);
    assert.ok(entry, `WK-0532 bootstrap literal ${literal} must have a taxonomy entry`);
    assert.equal(entry.code, literal);
    assert.equal(
      Boolean(entry.wk_0532_subset),
      true,
      `${literal} must be marked wk_0532_subset in the descriptor`
    );
  }
});

test("identity refusal codes use a dotted/versioned grammar and are intentionally NOT in the runtime blocker enum", () => {

  assert.equal(isRuntimeBlockerCode("agent_dispatch_identity.caller_supplied_role.v1"), false);
  const taxonomyEntry = getRuntimeBlockerEntry("caller_supplied_identity");
  assert.ok(taxonomyEntry.aliases.includes("agent_dispatch_identity.caller_supplied_role.v1"));
});

test("graph_impact_state_map covers exhaustive (graph_state, staleness, dirty_state, overlay_state) cases", () => {

  const blockingCases = [
    [{ graph_state: "unavailable" }, "graph_impact_unavailable"],
    [{ graph_state: "error" }, "graph_impact_unavailable"],
    [{ graph_state: "query_error" }, "graph_impact_query_error"]
  ];
  for (const [input, expectedCode] of blockingCases) {
    const result = evaluateGraphImpactBlocker(input);
    assert.ok(result, `case ${JSON.stringify(input)} must map to a taxonomy code`);
    assert.equal(
      result.code,
      expectedCode,
      `case ${JSON.stringify(input)} must map to ${expectedCode}`
    );
    assert.equal(result.blocking, true, `case ${JSON.stringify(input)} must be blocking`);
  }

  const degradedOverlayCases = [
    { staleness: "missing", dirty_state: "dirty_worktree", overlay_state: "active" },
    { staleness: "stale", dirty_state: "dirty_worktree", overlay_state: "active" },
    { staleness: "rebuild_required", dirty_state: "dirty_worktree", overlay_state: "active" },
    { staleness: "unknown", overlay_state: "active" },
    { dirty_state: "dirty_worktree", overlay_state: "active", staleness: "fresh" }
  ];
  for (const input of degradedOverlayCases) {
    const result = evaluateGraphImpactBlocker(input);
    assert.ok(result, `case ${JSON.stringify(input)} must map to a taxonomy code`);
    assert.equal(
      result.code,
      "graph_impact_degraded_overlay",
      `case ${JSON.stringify(input)} must map to graph_impact_degraded_overlay`
    );
    assert.equal(result.blocking, false, `case ${JSON.stringify(input)} must be non-blocking`);
  }

  const nonBlockingRebuildCases = [
    { staleness: "missing", overlay_state: "absent" },
    { staleness: "stale", dirty_state: "clean", overlay_state: "absent" },
    { staleness: "rebuild_required", dirty_state: "clean", overlay_state: "absent" },
    { staleness: "unknown", overlay_state: "absent" }
  ];
  for (const input of nonBlockingRebuildCases) {
    const result = evaluateGraphImpactBlocker(input);
    assert.equal(
      result,
      null,
      `staleness case ${JSON.stringify(input)} must be non-blocking (rebuilt at current HEAD)`
    );
  }
});

test("graph_impact_state_map default outcome is clean_proceed", () => {

  const result = evaluateGraphImpactBlocker({
    graph_state: "available",
    staleness: "fresh",
    dirty_state: "clean",
    overlay_state: "absent"
  });
  assert.equal(result, null);
  assert.equal(
    RUNTIME_BLOCKER_DESCRIPTOR.graph_impact_state_map.default_outcome,
    "clean_proceed"
  );
});

test("loadRuntimeBlockerTaxonomy emits a complete descriptor snapshot", () => {
  const snapshot = loadRuntimeBlockerTaxonomy();
  assert.equal(snapshot.schema_version, RUNTIME_BLOCKER_TAXONOMY_SCHEMA_VERSION);
  assert.equal(RUNTIME_BLOCKER_TAXONOMY_OWNER, "IN-0016");
  assert.equal(RUNTIME_BLOCKER_DESCRIPTOR.owner, RUNTIME_BLOCKER_TAXONOMY_OWNER);
  assert.equal(snapshot.owner, RUNTIME_BLOCKER_TAXONOMY_OWNER);
  assert.ok(snapshot.codes.length >= 20);
  for (const entry of snapshot.codes) {
    assert.equal(typeof entry.actor_recovery, "string");
    assert.equal(typeof entry.category, "string");
  }
  assert.ok(Array.isArray(snapshot.actor_recovery_values));
  assert.ok(Array.isArray(snapshot.graph_impact_state_map.rules));
});

test("assertRuntimeBlockerSubset rejects ad hoc codes and enforces required codes", () => {
  assert.equal(assertRuntimeBlockerSubset(["read_only_mount", "missing_structured_transport"]), true);
  assert.throws(() => assertRuntimeBlockerSubset(["read_only_mount", "made_up_code"]), /not in taxonomy/);
  assert.throws(
    () =>
      assertRuntimeBlockerSubset(["read_only_mount"], {
        required: ["missing_structured_transport"]
      }),
    /required codes missing/
  );
  assert.equal(
    assertRuntimeBlockerSubset(["read_only_mount", "missing_structured_transport"], {
      required: ["missing_structured_transport"]
    }),
    true
  );
});

test("isBlockingRuntimeBlocker matches the descriptor blocking field", () => {
  assert.equal(isBlockingRuntimeBlocker(RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT), true);
  assert.equal(isBlockingRuntimeBlocker(RUNTIME_BLOCKER_CODES.GRAPH_IMPACT_DEGRADED_OVERLAY), false);
  assert.equal(isBlockingRuntimeBlocker("nonexistent_code"), false);
});

const PREFLIGHT_DISPATCH_ROUTES = Object.freeze([
  "workspace_agent_dispatch",
  "workspace_agent_dispatch:reviewer"
]);

function preflight(role, overrides = {}) {
  return evaluateCoordinationPreflight({
    role,
    available_structured_routes: PREFLIGHT_DISPATCH_ROUTES,
    ...overrides
  });
}

function readOnlyMountBlocker(envelope) {
  return envelope.blockers.find((entry) => entry.code === "read_only_mount");
}

test("read-only reviewer/redteam preflight treats read_only_mount as writeback-only", () => {

  assert.equal(isBlockingRuntimeBlocker(RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT), true);

  for (const role of ["reviewer", "redteam"]) {

    const envelope = preflight(role, {
      repo_mount_writable: false,
      repo_readable: true,
      docs_writable: false,
      wiki_writable: false
    });

    assert.equal(readOnlyMountBlocker(envelope), undefined, `${role} must not emit read_only_mount`);
    assert.equal(envelope.blocking, false, `${role} analysis must proceed`);
    assert.equal(envelope.analysis_blocked, false);

    assert.equal(envelope.writeback.blocked, true, `${role} writeback must be flagged blocked`);
    assert.ok(
      typeof envelope.writeback.remediation === "string" &&
        envelope.writeback.remediation.length > 0,
      `${role} writeback must carry remediation`
    );
    assert.equal(envelope.next_action, "proceed_read_only_dispatch_writeback_blocked");

    const evidence = envelope.filesystem_diagnostics.find(
      (entry) => entry.kind === "writeback_blocked_evidence"
    );
    assert.ok(evidence, `${role} must expose writeback_blocked_evidence`);
    assert.equal(evidence.classification, "writeback_blocked");
    assert.equal(evidence.blocking, false);
    assert.equal(evidence.read_only_dispatch_requested, true);
  }
});

test("read-only role preflight keeps writeback available when docs/wiki stay writable", () => {
  for (const role of ["reviewer", "redteam"]) {
    const envelope = preflight(role, {
      repo_mount_writable: false,
      repo_readable: true,
      docs_writable: true,
      wiki_writable: true
    });
    assert.equal(envelope.blocking, false);
    assert.equal(readOnlyMountBlocker(envelope), undefined);
    assert.equal(envelope.writeback.blocked, false);
    assert.equal(envelope.writeback.remediation, null);
    assert.equal(envelope.next_action, "proceed");
    const evidence = envelope.filesystem_diagnostics.find(
      (entry) => entry.kind === "read_only_mount_evidence"
    );
    assert.ok(evidence);
    assert.equal(evidence.classification, "writeback_available");
    assert.equal(evidence.carveout_applied, true);
  }
});

test("read-only role preflight fails closed when repo inputs are unreadable", () => {
  for (const role of ["reviewer", "redteam"]) {
    const envelope = preflight(role, {
      repo_mount_writable: false,
      repo_readable: false,
      docs_writable: false,
      wiki_writable: false
    });
    const blocker = readOnlyMountBlocker(envelope);
    assert.ok(blocker, `${role} must block when inputs are unreadable`);
    assert.equal(blocker.blocking, true);
    assert.equal(blocker.evidence.classification, "analysis_blocked");
    assert.equal(envelope.blocking, true);
    assert.equal(envelope.analysis_blocked, true);
    assert.equal(envelope.writeback.blocked, false);
    assert.equal(envelope.next_action, "resolve_blockers");
  }
});

test("write-capable roles keep fail-closed read_only_mount on a fully read-only mount", () => {
  for (const role of ["coordinator", "worker", "human_operator", "unknown"]) {
    const envelope = preflight(role, {
      repo_mount_writable: false,
      repo_readable: true,
      docs_writable: false,
      wiki_writable: false
    });
    const blocker = readOnlyMountBlocker(envelope);
    assert.ok(blocker, `${role} must keep the read_only_mount blocker`);
    assert.equal(blocker.blocking, true);
    assert.equal(envelope.blocking, true);
    assert.equal(envelope.analysis_blocked, true);
    assert.equal(envelope.writeback.blocked, false, `${role} writeback flag is for findings-only roles`);
    assert.equal(envelope.next_action, "resolve_blockers");
  }
});

test("WK-1678 stdio MCP conduit blocker codes are registered, blocking, and dispatch-facing", () => {

  const codes = [
    ...Object.values(STDIO_MCP_CONDUIT_ERROR_CODES),
    STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON,
    STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
    STDIO_MCP_CLEANUP_BLOCKER_REASON
  ].filter((code, index, all) => all.indexOf(code) === index).sort();
  assert.ok(codes.length >= 20, "the conduit vocabulary must be non-trivial");
  for (const code of codes) {
    assert.ok(isRuntimeBlockerCode(code), `${code} must be registered in the canonical taxonomy`);
    const entry = getRuntimeBlockerEntry(code);
    assert.equal(entry.blocking, true, `${code} must be blocking`);
    assert.equal(entry.actor_recovery, "operator", `${code} recovery is operator-side`);
    assert.ok(
      RUNTIME_BLOCKER_CATEGORY_VALUES.includes(entry.category),
      `${code} must use a known category`
    );

    assert.ok(
      RUNTIME_BLOCKER_DISPATCH_FACING_CATEGORIES.includes(entry.category),
      `${code} must be dispatch-facing`
    );
    assert.ok(entry.summary.length > 0);
    assert.ok(entry.detail.length > 0, `${code} must carry causal detail`);
    assert.ok(entry.consumer_notes.length > 0, `${code} must tell consumers how to use it`);

    assert.equal(RUNTIME_BLOCKER_CODES[code.toUpperCase()], code);
  }

  assertRuntimeBlockerSubset(codes, { required: codes });

  const registeredConduitCodes = RUNTIME_BLOCKER_CODE_VALUES
    .filter((code) => code.startsWith("stdio_mcp_"))
    .sort();
  assert.deepEqual(registeredConduitCodes, codes,
    "the registered stdio-MCP codes must be exactly the codes the launcher can emit");
});

test("WK-1678 M4: every registered conduit blocker code has behavioural test coverage", async () => {

  const { readdir, readFile } = await import("node:fs/promises");

  const testsRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  async function collectTestSources(dir) {
    const collected = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collected.push(...(await collectTestSources(full)));
      } else if (entry.name.endsWith(".test.mjs")) {
        collected.push({ name: entry.name, text: await readFile(full, "utf8") });
      }
    }
    return collected;
  }
  const sources = await collectTestSources(testsRoot);
  assert.ok(
    sources.length > 0,
    "the conduit-coverage scan found no test files; an empty corpus cannot evidence coverage"
  );

  const spellings = new Map();
  for (const [key, code] of Object.entries(STDIO_MCP_CONDUIT_ERROR_CODES)) {
    spellings.set(code, [code, `STDIO_MCP_CONDUIT_ERROR_CODES.${key}`]);
  }
  spellings.set(STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON,
    [STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON, "STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON"]);
  spellings.set(STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
    [STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON, "STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON"]);
  spellings.set(STDIO_MCP_CLEANUP_BLOCKER_REASON,
    [STDIO_MCP_CLEANUP_BLOCKER_REASON, "STDIO_MCP_CLEANUP_BLOCKER_REASON"]);

  const uncovered = [];
  for (const code of RUNTIME_BLOCKER_CODE_VALUES.filter((c) => c.startsWith("stdio_mcp_"))) {
    const accepted = spellings.get(code) ?? [code];
    const covering = sources.filter(({ name, text }) =>
      name !== "runtime-blocker-taxonomy.test.mjs" &&
      accepted.some((spelling) => text.includes(spelling)));
    if (covering.length === 0) uncovered.push(code);
  }
  assert.deepEqual(uncovered, [],
    "every registered stdio-MCP conduit blocker code needs a test that drives its producer");
});

test("every registered code is a public mechanical refusal code and nothing else is", () => {

  assert.ok(RUNTIME_BLOCKER_CODE_VALUES.length > 100);
  for (const code of RUNTIME_BLOCKER_CODE_VALUES) {
    assert.equal(isPublicMechanicalRefusalCode(code), true, code);
    assert.equal(classifySemanticIdentity(code), "public_mechanical_code", code);
    assert.equal(isDeclaredPrivateCause(code), false, code);
  }

  for (const anonymous of ["", "invented_public_code", "backend_unavailable_v2", null, 42]) {
    assert.equal(isPublicMechanicalRefusalCode(anonymous), false, String(anonymous));
  }
});

test("a private cause is not registered merely because it exists", () => {
  assert.ok(PRIVATE_CAUSE_DECLARATION_VALUES.length >= 2);
  const registered = new Set(RUNTIME_BLOCKER_CODE_VALUES);
  for (const declaration of PRIVATE_CAUSE_DECLARATION_VALUES) {
    assert.ok(declaration.owner_package.length > 0);
    assert.ok(declaration.causes.length > 0);
    for (const cause of declaration.causes) {
      assert.equal(registered.has(cause), false, `${cause} must stay unregistered`);
      assert.equal(isPublicMechanicalRefusalCode(cause), false, cause);
      assert.equal(getPrivateCauseKind(cause), declaration.kind, cause);
    }
  }
});

test("the classifier separates the three identity kinds that look alike", () => {

  assert.equal(classifySemanticIdentity("retry_launch"), "private_launcher_token");
  assert.equal(classifySemanticIdentity("consume_selected_result"), "private_launcher_token");

  assert.equal(
    classifySemanticIdentity("frozen_standalone_findings_contract_invalid"),
    "private_launcher_cause"
  );
  assert.equal(classifySemanticIdentity("findings_shape_mismatch"), "private_launcher_cause");

  assert.equal(
    classifySemanticIdentity("worker_admission.accepted_authority.v1"),
    "private_package_cause"
  );

  assert.equal(
    classifySemanticIdentity("launcher_transition.findings_route_authentication_failed.v1"),
    "public_mechanical_code"
  );
  assert.equal(classifySemanticIdentity("attacker.supplied.evil.v1"), "unrecognized");
});

test("authenticated authority identities are declared and never registered locally", () => {
  assert.ok(NON_REGISTRABLE_AUTHORITY_IDENTITIES.includes("worker_admission_review_threshold_exceeded"));
  for (const identity of NON_REGISTRABLE_AUTHORITY_IDENTITIES) {
    assert.equal(isRuntimeBlockerCode(identity), false, identity);
    assert.equal(classifySemanticIdentity(identity), "authenticated_authority", identity);
  }
});

test("a declared private cause cannot be smuggled in as a registered code", () => {
  const descriptor = JSON.parse(JSON.stringify(RUNTIME_BLOCKER_DESCRIPTOR));
  descriptor.codes.push({
    code: "frozen_standalone_findings_contract_invalid",
    category: "validation",
    actor_recovery: "coordinator",
    blocking: true,
    summary: "Launcher-private findings contract cause."
  });
  assert.throws(
    () => assertRuntimeBlockerDescriptorShape(descriptor),
    /is registered as a public mechanical code; a private cause is not published merely because it exists/
  );
});

const STRUCTURED_RECOVERIES = RUNTIME_BLOCKER_DESCRIPTOR.codes.filter(
  (entry) => entry.recovery && typeof entry.recovery === "object"
);

test("no registered recovery template leaves an argument unresolved (AUDIT-REFUSAL-009)", () => {

  for (const entry of STRUCTURED_RECOVERIES) {
    assert.deepEqual(
      unresolvedArgumentNames(entry.recovery.arguments ?? {}),
      [],
      `${entry.code} recovery leaves an argument unresolved`
    );
    for (const bound of Object.keys(entry.recovery.argument_bindings ?? {})) {
      assert.equal(
        Object.hasOwn(entry.recovery.arguments ?? {}, bound),
        false,
        `${entry.code} binds and fixes the same argument ${bound}`
      );
    }
    if (typeof entry.recovery.route === "string") {
      assert.equal(isCanonicalNextCallTool(entry.recovery.route), true, entry.code);
    }
  }
});

test("managed_lifecycle_required no longer publishes a wrong-role, already-true remedy", () => {

  const recovery = getRuntimeBlockerEntry("managed_lifecycle_required").recovery;
  assert.equal(recovery.route, "workspace_coordination_preflight");
  assert.equal(recovery.arguments.role, "coordinator");
  assert.equal(
    Object.hasOwn(recovery.arguments, "target_dispatch_role"),
    false,
    "the dispatch role must not be hard-coded to one role"
  );
  assert.equal(recovery.argument_bindings.target_dispatch_role, "refused_dispatch_role");
  assert.match(recovery.prerequisite, /no fresh managed-lifecycle capability fact/i);

  assert.match(recovery.success_condition, /the dispatch role the refusal names/i);
});

test("the reviewer remediation names the exact structured authoring call (AUTHREADY-005)", () => {
  const remediation = getRuntimeBlockerEntry("role_policy_violation")
    .reasons.find(({ reason }) => reason === "reviewer_write_scope_nonempty").remediation;

  assert.equal(remediation.route, "workspace_work_record_ready_slice");
  assert.equal(isCanonicalNextCallTool(remediation.route), true);

  assert.equal(remediation.arguments.review_purpose, "standalone");
  assert.equal(remediation.arguments.shaping_mode, "review");
  assert.deepEqual(remediation.arguments.write_scope, []);
  assert.deepEqual(unresolvedArgumentNames(remediation.arguments), []);
  assert.equal(remediation.argument_bindings.unit, "reviewed_parent_wk_unit");

  assert.equal(Object.hasOwn(remediation, "suggested_unit_id_examples"), false);
  assert.equal(Object.hasOwn(remediation, "repo_paths"), false);
  assert.match(remediation.summary, /server-allocated slice id/i);
  assert.doesNotMatch(JSON.stringify(remediation), /WK-#####/u);
});
