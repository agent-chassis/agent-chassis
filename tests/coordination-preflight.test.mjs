import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateCoordinationPreflight
} from "../packages/wiki-core/src/lib/coordination-preflight.mjs";

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
