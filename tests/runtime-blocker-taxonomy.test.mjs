

import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNTIME_BLOCKER_CODES,
  RUNTIME_BLOCKER_CATEGORY_VALUES,
  RUNTIME_BLOCKER_CODE_VALUES,
  RUNTIME_BLOCKER_DESCRIPTOR,
  RUNTIME_BLOCKER_TAXONOMY_OWNER,
  RUNTIME_BLOCKER_TAXONOMY_SCHEMA_VERSION,
  WK_0532_BOOTSTRAP_SUBSET,
  assertRuntimeBlockerSubset,
  evaluateGraphImpactBlocker,
  getRuntimeBlockerEntry,
  isBlockingRuntimeBlocker,
  isRuntimeBlockerCode,
  loadRuntimeBlockerTaxonomy
} from "../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { BOOTSTRAP_STATE_CODES } from "../packages/wiki-core/src/lib/agent-dispatch-identity.mjs";
import { evaluateCoordinationPreflight } from "../packages/wiki-core/src/lib/coordination-preflight.mjs";

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
    "operator_recovery_needed"
  ];
  for (const code of required) {
    assert.ok(isRuntimeBlockerCode(code), `taxonomy must declare code ${code}`);
    assert.ok(RUNTIME_BLOCKER_CODE_VALUES.includes(code));
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

  const cases = [
    [{ graph_state: "unavailable" }, "graph_impact_unavailable", true],
    [{ graph_state: "error" }, "graph_impact_unavailable", true],
    [{ graph_state: "query_error" }, "graph_impact_query_error", true],
    [
      { staleness: "missing", overlay_state: "absent" },
      "graph_impact_artifact_missing",
      true
    ],
    [
      { staleness: "missing", dirty_state: "dirty_worktree", overlay_state: "active" },
      "graph_impact_degraded_overlay",
      false
    ],
    [
      { staleness: "stale", dirty_state: "clean", overlay_state: "absent" },
      "graph_impact_rebuild_required",
      true
    ],
    [
      { staleness: "stale", dirty_state: "dirty_worktree", overlay_state: "active" },
      "graph_impact_degraded_overlay",
      false
    ],
    [
      { staleness: "rebuild_required", dirty_state: "clean", overlay_state: "absent" },
      "graph_impact_rebuild_required",
      true
    ],
    [
      { staleness: "rebuild_required", dirty_state: "dirty_worktree", overlay_state: "active" },
      "graph_impact_degraded_overlay",
      false
    ],
    [
      { staleness: "unknown", overlay_state: "absent" },
      "graph_impact_unknown_state",
      true
    ],
    [
      { staleness: "unknown", overlay_state: "active" },
      "graph_impact_degraded_overlay",
      false
    ],
    [
      { dirty_state: "dirty_worktree", overlay_state: "active", staleness: "fresh" },
      "graph_impact_degraded_overlay",
      false
    ]
  ];
  for (const [input, expectedCode, expectedBlocking] of cases) {
    const result = evaluateGraphImpactBlocker(input);
    assert.ok(result, `case ${JSON.stringify(input)} must map to a taxonomy code`);
    assert.equal(
      result.code,
      expectedCode,
      `case ${JSON.stringify(input)} must map to ${expectedCode}`
    );
    assert.equal(result.blocking, expectedBlocking, `case ${JSON.stringify(input)} blocking mismatch`);
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
