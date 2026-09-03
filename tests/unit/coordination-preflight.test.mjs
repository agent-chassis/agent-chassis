import assert from "node:assert/strict";
import test from "node:test";

import {
  CCE_POLICY_PROJECTION_SCHEMA_VERSIONS,
  COORDINATION_PREFLIGHT_COMPLETE_RETRIEVAL,
  COORDINATION_PREFLIGHT_COVERAGE_SCHEMA_VERSION,
  COORDINATION_PREFLIGHT_FACT_FAMILY_IDS,
  COORDINATION_PREFLIGHT_LOCAL_HANDLING_VALUES,
  authenticateCoordinationPreflightOwnerFacts,
  evaluateCoordinationPreflight
} from "../../packages/wiki-core/src/lib/coordination-preflight.mjs";
import {
  AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
  resolveCallerIdentity
} from "../../packages/wiki-core/src/lib/agent-dispatch-identity.mjs";

const AVAILABLE_STRUCTURED_ROUTES = Object.freeze([
  "workspace_agent_dispatch",
  "workspace_agent_dispatch:reviewer"
]);

function evaluate(role, overrides = {}) {
  return evaluateCoordinationPreflight({
    role,
    available_structured_routes: AVAILABLE_STRUCTURED_ROUTES,
    ...overrides
  });
}

function readOnlyMountEvidence(envelope) {
  return envelope.filesystem_diagnostics.find(
    (entry) => entry.kind === "read_only_mount_evidence"
  );
}

function coordinatorReadonlyTargetDispatchEvidence(envelope) {
  return envelope.filesystem_diagnostics.find(
    (entry) =>
      entry.kind === "read_only_mount_evidence" &&
      entry.classification === "coordinator_readonly_target_dispatch"
  );
}

function readOnlyMountBlocker(envelope) {
  return envelope.blockers.find((entry) => entry.code === "read_only_mount");
}

test("WK-0641 reviewer and redteam preflight do not block solely on repo_mount_writable=false when docs/wiki remain writable", () => {
  for (const role of ["reviewer", "redteam"]) {
    const envelope = evaluate(role, {
      repo_mount_writable: false,
      docs_writable: true,
      wiki_writable: true
    });

    assert.equal(envelope.blocking, false);
    assert.equal(readOnlyMountBlocker(envelope), undefined);
    assert.equal(envelope.repo_mount_writable, false);
    assert.equal(envelope.docs_writable, true);
    assert.equal(envelope.wiki_writable, true);

    const evidence = readOnlyMountEvidence(envelope);
    assert.ok(evidence, `${role} preflight must preserve read-only mount evidence`);
    assert.equal(evidence.blocking, false);
    assert.equal(evidence.carveout_applied, true);
    assert.equal(evidence.read_only_dispatch_requested, true);
  }
});

test("WK-0641 worker preflight still blocks on repo_mount_writable=false", () => {
  const envelope = evaluate("worker", {
    repo_mount_writable: false,
    docs_writable: true,
    wiki_writable: true
  });

  const blocker = readOnlyMountBlocker(envelope);
  assert.ok(blocker, "worker preflight must keep the repo-root read-only blocker");
  assert.equal(envelope.blocking, true);
  assert.equal(blocker.blocking, true);
  assert.equal(blocker.evidence.repo_mount_writable, false);
  assert.equal(blocker.evidence.docs_writable, true);
  assert.equal(blocker.evidence.wiki_writable, true);
  assert.equal(blocker.evidence.read_only_dispatch_requested, false);
  assert.equal(blocker.evidence.read_only_dispatch_carveout_applied, false);

  const evidence = readOnlyMountEvidence(envelope);
  assert.ok(evidence, "worker preflight must still expose filesystem evidence");
  assert.equal(evidence.blocking, true);
  assert.equal(evidence.carveout_applied, false);
});

test("WK-0641 coordinator preflighting worker dispatch does not block on read-only repo root when docs and wiki are writable", () => {
  const envelope = evaluate("coordinator", {
    caller_session_role: "coordinator",
    target_dispatch_role: "worker",
    repo_mount_writable: false,
    repo_readable: true,
    docs_writable: true,
    wiki_writable: true
  });

  assert.equal(envelope.blocking, false, "coordinator worker dispatch must not block on read-only repo root");
  assert.equal(readOnlyMountBlocker(envelope), undefined, "no read_only_mount blocker expected");

  const mismatchBlocker = envelope.blockers.find((b) => b.code === "caller_role_mismatch");
  assert.equal(mismatchBlocker, undefined, "no caller_role_mismatch when caller and role are both coordinator");

  assert.equal(envelope.repo_mount_writable, false, "raw mount fact preserved");
  assert.equal(envelope.docs_writable, true);
  assert.equal(envelope.wiki_writable, true);
  assert.equal(envelope.target_dispatch_role, "worker");

  const evidence = readOnlyMountEvidence(envelope);
  assert.ok(evidence, "coordinator worker dispatch preflight must emit read-only mount evidence");
  assert.equal(evidence.blocking, false);
  assert.equal(evidence.carveout_applied, true);
  assert.equal(evidence.coordinator_dispatching_worker, true);
  assert.equal(evidence.target_dispatch_role, "worker");
  assert.equal(evidence.classification, "coordinator_worker_dispatch");
});

test("WK-0641 coordinator direct write preflight without target worker dispatch still blocks on read-only repo root", () => {
  const envelope = evaluate("coordinator", {
    caller_session_role: "coordinator",
    repo_mount_writable: false,
    docs_writable: true,
    wiki_writable: true
  });

  const blocker = readOnlyMountBlocker(envelope);
  assert.ok(blocker, "coordinator without target dispatch must block on read-only repo root");
  assert.equal(envelope.blocking, true);
  assert.equal(blocker.blocking, true);
  assert.equal(envelope.target_dispatch_role, null);
});

test("WK-0641 coordinator dispatching worker still blocks when docs or wiki not writable", () => {
  for (const [surface, overrides] of [
    ["docs", { docs_writable: false, wiki_writable: true }],
    ["wiki", { docs_writable: true, wiki_writable: false }]
  ]) {
    const envelope = evaluate("coordinator", {
      caller_session_role: "coordinator",
      target_dispatch_role: "worker",
      repo_mount_writable: false,
      repo_readable: true,
      ...overrides
    });

    const blocker = readOnlyMountBlocker(envelope);
    assert.ok(blocker, `coordinator worker dispatch must block when ${surface} is not writable`);
    assert.equal(envelope.blocking, true);
    assert.equal(blocker.blocking, true);

    const evidence = readOnlyMountEvidence(envelope);
    assert.ok(evidence, "must still emit filesystem evidence");
    assert.equal(evidence.blocking, true);
    assert.equal(evidence.carveout_applied, false);
    assert.equal(evidence.coordinator_dispatching_worker, true);
  }
});

test("WK-0641 role=worker with caller_session_role=coordinator is caller_role_mismatch not the recommended target-role workaround", () => {
  const envelope = evaluate("worker", {
    caller_session_role: "coordinator",
    repo_mount_writable: false,
    docs_writable: true,
    wiki_writable: true
  });

  const mismatchBlocker = envelope.blockers.find((b) => b.code === "caller_role_mismatch");
  assert.ok(mismatchBlocker, "role=worker/caller=coordinator must emit caller_role_mismatch");
  assert.equal(envelope.blocking, true);
  assert.equal(mismatchBlocker.evidence.requested_role, "worker");
  assert.equal(mismatchBlocker.evidence.caller_session_role, "coordinator");
});

test("WK-1781 composition incompatibility keeps route registration visible and blocks effective dispatch", () => {
  const result = evaluate("coordinator", {
    target_dispatch_role: "worker",
    structured_dispatch_compatibility: {
      available: false,
      gate_outcome: "incompatible",
      fact: Object.freeze({
        schema_version: "stdio-mcp-conduit-composition-compatibility.v1",
        backend_generation_id: "managed_stdio_mcp_backend.test",
        producer_protocol_generation: "producer.v1",
        consumer_protocol_generation: "consumer.v1",
        compatibility_state: "incompatible",
        source: "launcher_active_composition"
      }),
      blocker: {
        code: "operator_recovery_needed",
        cause: "stdio_mcp_lifecycle_protocol_incompatible",
        recovery: "deploy one coherent build and restart the long-lived backend",
        gate_outcome: "incompatible"
      }
    }
  });
  assert.equal(result.structured_dispatch.route_registered, true);
  assert.equal(result.structured_dispatch.available, false);
  assert.equal(result.structured_dispatch.gate_outcome, "incompatible");
  assert.ok(result.available_structured_routes.includes("workspace_agent_dispatch"));
  const blocker = result.blockers.find((entry) => entry.code === "operator_recovery_needed");
  assert.ok(blocker);
  assert.deepEqual(blocker.evidence, {
    cause: "stdio_mcp_lifecycle_protocol_incompatible",
    recovery: "deploy one coherent build and restart the long-lived backend",
    gate_outcome: "incompatible"
  });
  assert.equal(result.blocking, true);
});

test("WK-0641 docs_writable=false or wiki_writable=false stays blocking for every role", () => {
  for (const role of [
    "coordinator",
    "worker",
    "reviewer",
    "redteam",
    "human_operator",
    "unknown"
  ]) {
    for (const [surface, overrides] of [
      ["docs", { docs_writable: false, wiki_writable: true }],
      ["wiki", { docs_writable: true, wiki_writable: false }]
    ]) {
      const envelope = evaluate(role, {
        repo_mount_writable: true,
        ...overrides
      });

      const blocker = readOnlyMountBlocker(envelope);
      assert.ok(blocker, `${role} must block when ${surface} is not writable`);
      assert.equal(envelope.blocking, true);
      assert.equal(blocker.blocking, true);
      assert.equal(blocker.evidence.partial, true);
      assert.equal(blocker.evidence.repo_mount_writable, true);
      assert.equal(blocker.evidence.docs_writable, overrides.docs_writable);
      assert.equal(blocker.evidence.wiki_writable, overrides.wiki_writable);
      assert.equal(blocker.evidence.read_only_dispatch_carveout_applied, false);
    }
  }
});

test("WK-0641 coordinator preflighting reviewer/redteam dispatch does not block on read-only repo root", () => {
  for (const targetRole of ["reviewer", "redteam"]) {
    const envelope = evaluate("coordinator", {
      caller_session_role: "coordinator",
      target_dispatch_role: targetRole,
      repo_mount_writable: false,
      repo_readable: true,
      docs_writable: true,
      wiki_writable: true
    });

    assert.equal(
      envelope.blocking,
      false,
      `coordinator dispatching ${targetRole} must not block on read-only repo root`
    );
    assert.equal(
      readOnlyMountBlocker(envelope),
      undefined,
      `no read_only_mount blocker expected when coordinator dispatches ${targetRole}`
    );

    const mismatchBlocker = envelope.blockers.find((b) => b.code === "caller_role_mismatch");
    assert.equal(
      mismatchBlocker,
      undefined,
      `no caller_role_mismatch when role and caller_session_role are both coordinator`
    );

    assert.equal(envelope.target_dispatch_role, targetRole, "target_dispatch_role must be echoed in envelope");
    assert.equal(envelope.repo_mount_writable, false, "raw mount fact preserved");
    assert.equal(envelope.docs_writable, true);
    assert.equal(envelope.wiki_writable, true);

    const evidence = coordinatorReadonlyTargetDispatchEvidence(envelope);
    assert.ok(
      evidence,
      `coordinator ${targetRole} dispatch preflight must emit coordinator_readonly_target_dispatch evidence`
    );
    assert.equal(evidence.blocking, false);
    assert.equal(evidence.carveout_applied, true);
    assert.equal(evidence.coordinator_dispatching_readonly_role, true);
    assert.equal(evidence.target_dispatch_role, targetRole);
    assert.equal(evidence.classification, "coordinator_readonly_target_dispatch");
  }
});

test("WK-0641 role=reviewer with caller_session_role=coordinator is caller_role_mismatch not the supported coordinator preflight shape", () => {
  const envelope = evaluate("reviewer", {
    caller_session_role: "coordinator",
    repo_mount_writable: false,
    docs_writable: true,
    wiki_writable: true
  });

  const mismatchBlocker = envelope.blockers.find((b) => b.code === "caller_role_mismatch");
  assert.ok(mismatchBlocker, "role=reviewer/caller=coordinator must emit caller_role_mismatch");
  assert.equal(envelope.blocking, true);
  assert.equal(mismatchBlocker.evidence.requested_role, "reviewer");
  assert.equal(mismatchBlocker.evidence.caller_session_role, "coordinator");
});

function frozenLauncherPlan(overrides = {}) {
  return Object.freeze({
    schema_version: "launcher-transition-plan.v1",
    identity: "ltp-2359-001",
    phase: "prospective",
    subject: "WK-2359#SLICE-006",
    ...overrides
  });
}

test("WK-2359: preflight renders no model, app, backend, or profile selection verdict", () => {
  const envelope = evaluate("coordinator", {
    target_dispatch_role: "worker",
    repo_mount_writable: true,
    repo_readable: true,
    docs_writable: true,
    wiki_writable: true,
    launcher_transition_plan: frozenLauncherPlan()
  });

  const serialized = JSON.stringify(envelope);
  const parsed = JSON.parse(serialized);

  function assertNoSelectionKey(node, path = "") {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((entry, index) => assertNoSelectionKey(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, value] of Object.entries(node)) {

      if (path === "" && key === "launcher_transition_plan") continue;
      assert.equal(
        ["selected_model", "model", "app", "selected_app", "profile", "selected_profile",
          "selected_backend", "launch_backend", "configuration"].includes(key),
        false,
        `preflight envelope must not carry a launch-selection key; found ${path}.${key}`
      );
      assertNoSelectionKey(value, `${path}.${key}`);
    }
  }
  assertNoSelectionKey(parsed);
});

test("WK-2359: preflight forwards the launcher transition plan byte-for-byte", () => {
  const plan = frozenLauncherPlan();
  const envelope = evaluate("coordinator", {
    target_dispatch_role: "worker",
    launcher_transition_plan: plan
  });

  assert.strictEqual(envelope.launcher_transition_plan, plan);
});

test("WK-2359: preflight refuses a launcher plan it cannot authenticate", () => {

  assert.throws(
    () => evaluate("coordinator", {
      target_dispatch_role: "worker",

      launcher_transition_plan: { schema_version: "launcher-transition-plan.v1" }
    }),
    /exact frozen launcher transition plan/
  );
  assert.throws(
    () => evaluate("coordinator", {
      target_dispatch_role: "worker",
      launcher_transition_plan: Object.freeze({ schema_version: "some-other-plan.v1" })
    }),
    /exact frozen launcher transition plan/
  );
});

test("WK-2359: preflight without a launcher plan reports absence rather than inventing one", () => {
  const envelope = evaluate("coordinator", { target_dispatch_role: "worker" });
  assert.equal(envelope.launcher_transition_plan, null,
    "preflight must not synthesize a plan the launcher did not provide");
});

test("WK-2359: the preflight envelope is frozen, so no consumer can graft a selection onto it", () => {
  const envelope = evaluate("coordinator", { target_dispatch_role: "worker" });
  assert.ok(Object.isFrozen(envelope));
});

function familyIndex(envelope) {
  return Object.fromEntries(
    envelope.coverage.families.map((entry) => [entry.family, entry])
  );
}

test("WK-2391: every fact family is disclosed with identity, origin, local handling, and boundary", () => {
  const envelope = evaluate("coordinator", { target_dispatch_role: "worker" });
  const coverage = envelope.coverage;

  assert.equal(coverage.schema_version, COORDINATION_PREFLIGHT_COVERAGE_SCHEMA_VERSION);

  assert.deepEqual(
    coverage.families.map((entry) => entry.family),
    [...COORDINATION_PREFLIGHT_FACT_FAMILY_IDS]
  );
  assert.equal(coverage.family_count, COORDINATION_PREFLIGHT_FACT_FAMILY_IDS.length);
  assert.deepEqual(
    coverage.local_handling_vocabulary,
    [...COORDINATION_PREFLIGHT_LOCAL_HANDLING_VALUES]
  );

  const seen = new Set();
  for (const entry of coverage.families) {
    assert.equal(seen.has(entry.family), false, `${entry.family} must be disclosed once`);
    seen.add(entry.family);

    assert.equal(typeof entry.evaluation_origin, "string");
    assert.ok(entry.evaluation_origin.length > 0, `${entry.family} needs an evaluation origin`);
    assert.ok(
      COORDINATION_PREFLIGHT_LOCAL_HANDLING_VALUES.includes(entry.local_handling),
      `${entry.family} local_handling ${entry.local_handling} is outside the closed vocabulary`
    );
    assert.equal(typeof entry.authoritative_boundary, "string");
    assert.ok(
      entry.authoritative_boundary.length > 0,
      `${entry.family} needs an authoritative boundary`
    );

    if (entry.local_handling !== "evaluated_locally") {
      assert.ok(
        coverage.deferred_boundaries.some(
          (deferred) =>
            deferred.family === entry.family &&
            deferred.authoritative_boundary === entry.authoritative_boundary &&
            deferred.local_handling === entry.local_handling
        ),
        `${entry.family} is not evaluated locally and must be listed as deferred`
      );
    }
  }

  assert.equal(
    coverage.evaluated_locally_count + coverage.projected_count + coverage.not_evaluated_count,
    coverage.family_count
  );
  assert.equal(
    coverage.omitted_count,
    coverage.projected_count + coverage.not_evaluated_count
  );
  assert.equal(coverage.deferred_boundaries.length, coverage.omitted_count);
  assert.deepEqual(coverage.complete_retrieval, COORDINATION_PREFLIGHT_COMPLETE_RETRIEVAL);

  const families = familyIndex(envelope);
  assert.equal(families.local_dispatch_structural_readiness.local_handling, "not_evaluated");
  assert.equal(
    families.local_dispatch_structural_readiness.authoritative_boundary,
    "workspace_validate_dispatch"
  );
  assert.equal(
    families.cce_declaration_admissibility_and_policy.authoritative_boundary,
    "chassis_control_engine"
  );
  assert.equal(
    families.launcher_backend_provisioning_and_spawn_readiness.authoritative_boundary,
    "agent_launch_launcher"
  );

  assert.equal(
    families.repository_docs_wiki_mount_and_writeback.local_handling,
    "evaluated_locally"
  );
  assert.equal(families.structured_route_registration.local_handling, "evaluated_locally");
});

test("WK-2391: registering workspace_validate_dispatch never converts readiness into a locally evaluated fact", () => {

  const withRoute = evaluate("coordinator", {
    available_structured_routes: [
      "workspace_agent_dispatch",
      "workspace_agent_dispatch:reviewer",
      "workspace_validate_dispatch"
    ]
  });
  const withoutRoute = evaluate("coordinator");
  const registered = familyIndex(withRoute).local_dispatch_structural_readiness;
  const unregistered = familyIndex(withoutRoute).local_dispatch_structural_readiness;

  assert.equal(registered.state, "route_registered_not_called");
  assert.equal(unregistered.state, "route_not_registered");
  assert.equal(registered.local_handling, "not_evaluated");
  assert.equal(unregistered.local_handling, "not_evaluated");
});

test("WK-2391-S003-F1: only an accepted owner-minted identity fact is projected", () => {
  const accepted = resolveCallerIdentity({
    schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
    role_kind: "coordinator",
    trust_source: "launcher_minted",
    mint_evidence: "launcher-session-2391"
  });
  authenticateCoordinationPreflightOwnerFacts({ identity: accepted });

  const projected = familyIndex(evaluate("coordinator", { identity: accepted }))
    .coordinator_identity_and_role;
  assert.equal(projected.local_handling, "projected");
  assert.equal(projected.state, "accepted_owner_minted_identity");
  assert.equal(projected.authoritative_boundary, "workspace_agent_dispatch_identity_contract");

  const cases = [
    [null, "absent"],
    ["coordinator", "malformed_identity_envelope"],
    [Object.freeze({ accepted: false, refusal_code: "identity.refused.v1" }),
      "rejected_identity_envelope"],
    [Object.freeze({
      schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
      accepted: true,
      role_kind: "coordinator",
      trust_source: "launcher_minted",
      mint_evidence: "invented"
    }), "unauthenticated_identity_envelope"]
  ];

  for (const [identity, expectedState] of cases) {
    const family = familyIndex(evaluate("coordinator", { identity }))
      .coordinator_identity_and_role;
    assert.equal(family.state, expectedState);
    assert.equal(family.local_handling, "not_evaluated");
    assert.equal(family.authoritative_boundary, "workspace_agent_dispatch_identity_contract");
  }
});

test("WK-2391: a projected CCE policy fact stays CCE-owned and is never re-decided locally", () => {
  const projection = Object.freeze({
    schema_version: CCE_POLICY_PROJECTION_SCHEMA_VERSIONS[0],
    outcome: "admitted"
  });
  authenticateCoordinationPreflightOwnerFacts({ cce_policy_projection: projection });
  const envelope = evaluate("coordinator", {
    target_dispatch_role: "worker",
    cce_policy_projection: projection
  });
  const family = familyIndex(envelope).cce_declaration_admissibility_and_policy;

  assert.equal(family.local_handling, "projected");
  assert.equal(family.evaluation_origin, "chassis_control_engine");
  assert.equal(family.authoritative_boundary, "chassis_control_engine");
  assert.equal(family.policy_classification, "cce_owned_projection");

  assert.strictEqual(family.projected_fact, projection);

  assert.equal(family.local_policy_verdict, null);
});

test("WK-2391-S003-F2: absent, malformed, unrecognized, and unauthenticated CCE carriers stay non-policy", () => {

  const cases = [
    [null, "absent"],
    ["cce-boundary-policy-decision.v1", "malformed_carrier"],
    [Object.freeze({ schema_version: "some-other-carrier.v1" }), "unrecognized_carrier"],
    [{ schema_version: CCE_POLICY_PROJECTION_SCHEMA_VERSIONS[0] }, "unauthenticated_carrier"],

    [Object.freeze({
      schema_version: CCE_POLICY_PROJECTION_SCHEMA_VERSIONS[0],
      outcome: "admitted"
    }), "unauthenticated_carrier"]
  ];

  for (const [carrier, expectedState] of cases) {
    const envelope = evaluate("coordinator", {
      target_dispatch_role: "worker",
      cce_policy_projection: carrier
    });
    const family = familyIndex(envelope).cce_declaration_admissibility_and_policy;

    assert.equal(family.state, expectedState);
    assert.equal(family.local_handling, "not_evaluated");
    assert.equal(family.policy_classification, "non_policy");
    assert.equal(family.projected_fact, null);
    assert.equal(family.local_policy_verdict, null);
    assert.equal(family.authoritative_boundary, "chassis_control_engine");

    assert.equal(envelope.blocking, false, `${expectedState} must not become a local refusal`);
    assert.equal(
      envelope.blockers.some((entry) => String(entry.code).includes("policy")),
      false,
      `${expectedState} must not mint a policy blocker`
    );
  }
});

test("WK-2391: an unsupplied launcher or composition projection reports absence, never availability", () => {
  const envelope = evaluate("coordinator", { target_dispatch_role: "worker" });
  const families = familyIndex(envelope);

  assert.equal(families.launcher_active_composition_compatibility.local_handling, "not_evaluated");
  assert.equal(
    families.launcher_active_composition_compatibility.state,
    "no_composition_fact_supplied"
  );
  assert.equal(
    families.launcher_backend_provisioning_and_spawn_readiness.local_handling,
    "not_evaluated"
  );

  const projected = evaluate("coordinator", {
    target_dispatch_role: "worker",
    structured_dispatch_compatibility: { available: true, gate_outcome: "compatible", fact: null }
  });
  const composition = familyIndex(projected).launcher_active_composition_compatibility;
  assert.equal(composition.local_handling, "projected");
  assert.equal(composition.authoritative_boundary, "agent_launch_launcher");
});

test("WK-2391: a proceed result is scoped and never claims complete launch readiness", () => {
  const envelope = evaluate("coordinator", {
    target_dispatch_role: "worker",
    repo_mount_writable: true,
    docs_writable: true,
    wiki_writable: true,
    structured_dispatch_compatibility: { available: true, gate_outcome: "compatible", fact: null }
  });

  assert.equal(envelope.blocking, false);
  assert.equal(envelope.next_action, "proceed");

  const scope = envelope.proceed_scope;
  assert.equal(scope.next_action, "proceed");
  assert.equal(scope.proceed, true);
  assert.equal(scope.scope, "locally_evaluated_and_projected_coordination_facts");

  assert.equal(scope.asserts_complete_launch_readiness, false);
  assert.equal(scope.launch_readiness_owner, "agent_launch_launcher");
  assert.match(scope.summary, /not complete launch readiness/u);

  const deferred = new Set(scope.deferred_boundaries.map((entry) => entry.family));
  assert.ok(deferred.has("local_dispatch_structural_readiness"));
  assert.ok(deferred.has("cce_declaration_admissibility_and_policy"));
  assert.ok(deferred.has("launcher_backend_provisioning_and_spawn_readiness"));
  assert.deepEqual(scope.deferred_boundaries, envelope.coverage.deferred_boundaries);
});

test("WK-2391: a blocked preflight carries the same scoping caveat as a proceed", () => {

  const blocked = evaluate("worker", {
    repo_mount_writable: false,
    docs_writable: true,
    wiki_writable: true
  });

  assert.equal(blocked.blocking, true);
  assert.equal(blocked.proceed_scope.next_action, "resolve_blockers");
  assert.equal(blocked.proceed_scope.proceed, false);
  assert.equal(blocked.proceed_scope.asserts_complete_launch_readiness, false);
  assert.ok(blocked.proceed_scope.deferred_boundaries.length > 0);
});
