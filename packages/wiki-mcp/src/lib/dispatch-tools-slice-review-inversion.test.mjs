import assert from "node:assert/strict";
import test from "node:test";

import { runPostWorkerSliceLifecycle } from "./dispatch-run-monitor-routes.mjs";
import { createResumableLifecycleHarness } from "./dispatch-tools-test-helpers.mjs";

test("A2a: a terminal worker FREEZES the slice target, moves the SLICE to review with the parent ACTIVE, and dispatches a per-slice reviewer with ZERO integration", async () => {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: false });
  const parked = await runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
    status: { ...harness.status }
  , deps: harness.deps });

  assert.equal(parked.phase, "awaiting-slice-review");
  assert.equal(parked.integrated, false, "nothing integrates before the slice review is accepted");
  assert.equal(parked.integration, null);
  assert.equal(harness.counts().integrationCalls, 0, "ZERO integration");
  assert.equal(harness.counts().bindCalls, 0, "no whole-WK review context is bound");

  assert.equal(harness.sliceStatus(), "review");
  assert.deepEqual(harness.statusWrites, [{ unitAddress: "WK-1537#SLICE-001", status: "review" }]);
  assert.equal(parked.wk_transitioned_to_review, false);

  const frozen = harness.frozenSliceTargets.at(-1);
  assert.equal(frozen.ref, harness.sliceRef);
  assert.equal(frozen.sha, harness.reviewedSha);
  assert.equal(frozen.slice_level_review, true);
  assert.ok(!("complete_parent_wk_contract" in frozen));
  assert.ok(!("accumulated_wk_diff" in frozen));

  assert.equal(parked.reviewer_dispatch.args.role, "reviewer");
  assert.equal(parked.reviewer_dispatch.args.subject, "WK-1537#SLICE-001");
  assert.equal(parked.reviewer_dispatch.context.workspace_dir, harness.sliceWorktree);
  assert.equal(parked.reviewer_dispatch.context.slice_level_review, true);
});

test("A2a: FINDINGS leave the slice in UNRESOLVED REVIEW — repeated polls integrate ZERO times and never re-freeze", async () => {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: false });
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  for (let poll = 0; poll < 3; poll += 1) {
    const parked = await runPostWorkerSliceLifecycle({ workspace, status: { ...harness.status }, deps: harness.deps });
    assert.equal(parked.integrated, false);
    assert.equal(parked.phase, "awaiting-slice-review");
  }
  assert.equal(harness.counts().integrationCalls, 0, "an unresolved review never integrates, however often it is polled");
});

test("A2a: a verified Proof A integrates EXACTLY ONCE and carries the launcher-owned binding to the gate", async () => {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: true });
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const captured = [];
  const deps = {
    ...harness.deps,
    integrateCommittedSlice: async (input) => {
      captured.push(input);
      await input.transitionToReview({ unitAddress: "WK-1537", status: "review", expectedSourceDigest: null });
      return harness.integrationResult;
    }
  };
  const finalized = await runPostWorkerSliceLifecycle({ workspace, status: { ...harness.status }, deps });
  assert.equal(finalized.integrated, true);
  assert.equal(captured.length, 1, "exactly one integration");

  assert.equal(captured[0].sliceReviewAcceptance.review_run_id, "run-slice-reviewer");
  assert.equal(captured[0].sliceReviewAcceptance.reviewed_sha, harness.reviewedSha);
  assert.equal(captured[0].commit, harness.reviewedSha, "the reviewed SHA is what integrates");
});

test("A2a: a CORRECTIVE COMMIT that moved the slice SHA does not integrate on the stale acceptance", async () => {

  const harness = createResumableLifecycleHarness({
    sliceReviewAccepted: true,
    acceptedSha: "c".repeat(40)
  });
  const parked = await runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
    status: { ...harness.status },
    deps: harness.deps
  });
  assert.equal(parked.phase, "awaiting-slice-review");
  assert.equal(parked.integrated, false);
  assert.equal(parked.reason, "slice_review_acceptance_sha_moved");
  assert.equal(harness.counts().integrationCalls, 0, "a moved SHA integrates ZERO times");
});

test("A2a: an ABSENT acceptance resolver is never read as no-findings", async () => {
  const harness = createResumableLifecycleHarness();
  const deps = { ...harness.deps };
  delete deps.resolveSliceReviewAcceptanceBinding;
  const parked = await runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
    status: { ...harness.status },
    deps
  });
  assert.equal(parked.phase, "awaiting-slice-review");
  assert.equal(harness.counts().integrationCalls, 0, "a missing resolver refuses; silence is not acceptance");
});

test("tier-owned free/local policy reports review but does not park integration on absent evidence", async () => {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: false });
  let captured = null;
  const finalized = await runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
    status: { ...harness.status },
    deps: {
      ...harness.deps,
      reviewEnforcementMode: "policy_only",
      integrateCommittedSlice: async (input) => {
        captured = input;
        return { ...harness.integrationResult, review_target: null };
      }
    }
  });
  assert.equal(finalized.integrated, true);
  assert.equal(captured.sliceReviewAcceptance, null);
  assert.equal(captured.reviewEnforcementMode, "policy_only");
  assert.equal(
    Object.prototype.hasOwnProperty.call(captured.deps, "resolveSliceReviewAcceptanceProof"),
    false,
    "free/local policy-only progress must not fabricate a proof resolver"
  );
});

test("WK-1603 the in-process per-WK mutex is removed: two slices of the same WK integrate CONCURRENTLY (no serialization)", async () => {
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const makeDeps = (label, gate) => {
    const harness = createResumableLifecycleHarness();
    return {
      ...harness.deps,
      integrateCommittedSlice: async () => {
        order.push(`${label}:enter`);
        if (gate) await gate;
        order.push(`${label}:exit`);
        return { ...harness.integrationResult, review_target: null };
      }
    };
  };
  const first = runPostWorkerSliceLifecycle({
    workspace,
    status: { ...createResumableLifecycleHarness().status, run_id: "run-conc-A" },
    deps: makeDeps("A", firstGate)
  });
  const second = runPostWorkerSliceLifecycle({
    workspace,
    status: { ...createResumableLifecycleHarness().status, run_id: "run-conc-B" },
    deps: makeDeps("B", null)
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ["A:enter", "B:enter", "B:exit"], "the second slice integrates without waiting for the first");
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["A:enter", "B:enter", "B:exit", "A:exit"]);
});
