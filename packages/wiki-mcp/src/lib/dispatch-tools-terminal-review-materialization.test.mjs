import assert from "node:assert/strict";
import test from "node:test";

import {
  TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES,
  TERMINAL_REVIEW_VERIFY_PARTS,
  TerminalReviewMaterializationError
} from "../../../agent-launch-cli/src/lib/host-write-authority-substrate/terminal-review-materialization.mjs";
import {
  runPostWorkerSliceLifecycle,
  TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE
} from "./dispatch-run-monitor-routes.mjs";
import {
  composePostWorkerSliceLifecycle,
  resolveLauncherOwnedLifecycleDeps
} from "./dispatch-launch-runtime.mjs";
import {
  createDispatchToolRegistry,
  createResumableLifecycleHarness,
  parseStructuredTextResponse,
  terminalReviewAttestation
} from "./dispatch-tools-test-helpers.mjs";

const WORKSPACE = Object.freeze({ repo: "agent-chassis", dir: "/home/user/agent-chassis" });

function staleWorktreeVerify() {
  throw new TerminalReviewMaterializationError("materialized review checkout failed part write_tree_is_frozen_tree", {
    code: TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
    detail: { part: "write_tree_is_frozen_tree" }
  });
}

test("WK-1623#SLICE-007 the terminal materialize runs against the exact frozen target and the attestation reaches the reviewer dispatch", async () => {
  const harness = createResumableLifecycleHarness();
  const finalized = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status },
    deps: harness.deps
  });

  assert.equal(harness.materializeCalls.length, 1);
  assert.deepEqual(
    {
      mainRepo: harness.materializeCalls[0].mainRepo,
      worktreePath: harness.materializeCalls[0].worktreePath,
      wkRef: harness.materializeCalls[0].wkRef,
      frozenSha: harness.materializeCalls[0].frozenSha
    },
    {
      mainRepo: WORKSPACE.dir,
      worktreePath: harness.wkWorktree,
      wkRef: harness.wkRef,
      frozenSha: harness.reviewedSha
    }
  );
  assert.equal(typeof harness.materializeCalls[0].runGit, "function");

  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 1 });
  assert.equal(finalized.reviewer_dispatch.args.role, "reviewer");
  assert.equal(finalized.terminal_review_materialization.reviewed_sha, harness.reviewedSha);
  assert.equal(finalized.terminal_review_materialization.worktree_path, harness.wkWorktree);
  assert.deepEqual(
    finalized.reviewer_dispatch.context.terminal_review_materialization,
    finalized.terminal_review_materialization
  );
});

test("WK-1623#SLICE-007 an ABSENT materializer refuses before the review context is bound", async () => {

  const harness = createResumableLifecycleHarness({ materialize: null });
  await assert.rejects(
    runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status: { ...harness.status }, deps: harness.deps }),
    (error) => error.code === TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE &&
      /cannot be proven current/.test(error.message)
  );

  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 0 });
});

test("WK-1623#SLICE-007 a null or unbound attestation refuses before the review context is bound", async () => {
  const forgeries = [
    ["null attestation", () => null],
    ["undefined attestation", () => undefined],
    ["missing verify parts", (args) => ({
      ...terminalReviewAttestation(args),
      verified_parts: TERMINAL_REVIEW_VERIFY_PARTS.slice(0, 5)
    })],
    ["verified:false", (args) => ({ ...terminalReviewAttestation(args), verified: false })],
    ["bound to another worktree", (args) => ({
      ...terminalReviewAttestation(args),
      worktree_path: "/tmp/some-other-worktree"
    })],
    ["bound to another SHA", (args) => ({ ...terminalReviewAttestation(args), reviewed_sha: "f".repeat(40) })]
  ];
  for (const [label, materialize] of forgeries) {
    const harness = createResumableLifecycleHarness({ materialize });
    await assert.rejects(
      runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status: { ...harness.status }, deps: harness.deps }),
      (error) => error.code === TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.ATTESTATION_INVALID,
      label
    );
    assert.equal(harness.counts().bindCalls, 0, `${label}: no reviewer context may be bound`);
  }
});

test("WK-1623#SLICE-007 a RECOVERED review target with no verified materialize refuses and launches no reviewer", async () => {

  const routes = [

    ["no materializer composed on the recovery route", null,
      TERMINAL_REVIEW_MATERIALIZER_UNAVAILABLE_CODE],

    ["a stale persistent worktree", staleWorktreeVerify,
      TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED]
  ];
  for (const [label, materialize, code] of routes) {
    const harness = createResumableLifecycleHarness({ materialize });
    harness.setCanonicalStatus("review");
    await assert.rejects(
      runPostWorkerSliceLifecycle({
        workspace: WORKSPACE,
        status: { ...harness.status },
        deps: { ...harness.deps, recoveryOnly: true }
      }),
      (error) => error.code === code,
      label
    );

    assert.deepEqual(harness.counts(), { integrationCalls: 0, bindCalls: 0 }, label);
  }
});

test("WK-1623#SLICE-007 after a LATCHED materialize failure the next poll refuses again and never launches a reviewer", async () => {

  const harness = createResumableLifecycleHarness({ materialize: staleWorktreeVerify });
  const tools = createDispatchToolRegistry({
    backend: {
      getRunStatus: async () => ({
        accepted: true,
        run_id: harness.status.run_id,
        monitor_handle: harness.status.monitor_handle,
        role: "worker",
        subject: harness.status.subject,
        status: "succeeded",
        terminal: true,
        started_at: harness.status.started_at,
        updated_at: harness.status.updated_at
      }),
      runPostWorkerSliceLifecycle: harness.invoke
    }
  });

  for (const attempt of [1, 2, 3]) {
    const polled = parseStructuredTextResponse(
      await tools.get("workspace_agent_run_status").handler({ monitor_handle: harness.status.monitor_handle })
    );
    assert.equal(polled.accepted, true);
    assert.equal(
      polled.slice_lifecycle.error_code,
      TERMINAL_REVIEW_MATERIALIZATION_DIAGNOSTIC_CODES.VERIFY_FAILED,
      `poll ${attempt} must refuse with the classifiable verify code`
    );

    assert.equal(polled.slice_lifecycle.invoked, true);
    assert.equal(polled.slice_lifecycle.integrated, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(polled.slice_lifecycle, "reviewer_dispatch"),
      false,
      `poll ${attempt} must dispatch no reviewer against the stale worktree`
    );
  }

  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 0 });

  assert.equal(harness.materializeCalls.length, 3);
});

test("WK-1623#SLICE-007 a healthy materialize after a transient bind failure still launches exactly one reviewer", async () => {

  const harness = createResumableLifecycleHarness({ bindFailures: 1 });
  await assert.rejects(
    runPostWorkerSliceLifecycle({ workspace: WORKSPACE, status: { ...harness.status }, deps: harness.deps }),
    /injected post-integration context failure/
  );
  const resumed = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status },
    deps: harness.deps
  });
  assert.equal(resumed.phase, "finalized");
  assert.equal(resumed.reviewer_dispatch.args.role, "reviewer");
  assert.deepEqual(harness.counts(), { integrationCalls: 1, bindCalls: 2 });
  assert.equal(harness.materializeCalls.length, 2, "the resumed poll re-proves the worktree is current");
});

test("WK-1623#SLICE-007 a NON-FINAL slice needs no materialize: the gate is scoped to the reviewer-launching branch", async () => {

  const harness = createResumableLifecycleHarness({ materialize: null });
  const finalized = await runPostWorkerSliceLifecycle({
    workspace: WORKSPACE,
    status: { ...harness.status, run_id: "run-worker-nonfinal" },
    deps: {
      ...harness.deps,
      integrateCommittedSlice: async () => ({ ...harness.integrationResult, review_target: null })
    }
  });
  assert.equal(finalized.phase, "finalized");
  assert.equal(finalized.integrated, true);
  assert.equal(finalized.reviewer_dispatch, null);
  assert.equal(harness.counts().bindCalls, 0);
});

const BROKER_ADAPTER = async () => ({ accepted: true, integration: {} });
const PROVISIONING = Object.freeze({ mainRepo: "/main", worktreeRoot: "/wt" });

test("WK-1623#SLICE-007 the composition root supplies the materializer ONLY where this namespace can run it", async () => {

  const direct = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: PROVISIONING,
    hostSliceIntegrationAdapter: null
  });
  assert.equal(typeof direct.materializeTerminalReviewWorktree, "function");
  assert.equal("hostSliceIntegrationAdapter" in direct, false);

  const broker = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: PROVISIONING,
    hostSliceIntegrationAdapter: BROKER_ADAPTER
  });
  assert.equal("materializeTerminalReviewWorktree" in broker, false);
  assert.equal(broker.hostSliceIntegrationAdapter, BROKER_ADAPTER);

  const unprovisioned = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: null,
    hostSliceIntegrationAdapter: null
  });
  assert.deepEqual(unprovisioned, {});
});

test("WK-1623#SLICE-007 launcher-owned wiring is authoritative over any caller deps object", async () => {
  const captured = [];
  const composed = composePostWorkerSliceLifecycle({
    worktreeProvisioning: PROVISIONING,
    hostSliceIntegrationAdapter: null,
    lifecycle: async ({ deps }) => { captured.push(deps); return { phase: "finalized" }; }
  });

  const impostor = () => ({ verified: true, spoofed: true });
  await composed({
    workspace: { dir: "/main" },
    status: {},
    deps: { materializeTerminalReviewWorktree: impostor, callerExtra: 1 }
  });
  assert.notEqual(captured[0].materializeTerminalReviewWorktree, impostor,
    "the launcher spread must be applied LAST so caller deps cannot override it");
  assert.equal(typeof captured[0].materializeTerminalReviewWorktree, "function");

  assert.equal(captured[0].callerExtra, 1);

  captured.length = 0;
  await composed({
    workspace: { dir: "/main" },
    status: {},
    deps: {
      resolveManagedRunBinding: () => ({}),
      resolveCanonicalReviewUnit: () => ({}),
      bindFrozenReviewContext: () => ({}),
      recoveryOnly: true
    }
  });
  assert.equal(typeof captured[0].materializeTerminalReviewWorktree, "function",
    "the recovery route must receive the launcher-owned materializer");
  assert.equal(captured[0].recoveryOnly, true);
});
