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

test("advisory findings do not themselves complete the coordinator continuation", async () => {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: false });
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  for (let poll = 0; poll < 3; poll += 1) {
    const parked = await runPostWorkerSliceLifecycle({ workspace, status: { ...harness.status }, deps: harness.deps });
    assert.equal(parked.integrated, false);
    assert.equal(parked.phase, "awaiting-slice-review");
  }
  assert.equal(harness.counts().integrationCalls, 0, "an unresolved review never integrates, however often it is polled");
});

test("clean review completion does not directly integrate or mint continuation authority", async () => {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: false });
  const workspace = { repo: "agent-chassis", dir: "/home/user/agent-chassis" };
  const parked = await runPostWorkerSliceLifecycle({ workspace, status: { ...harness.status }, deps: harness.deps });
  assert.equal(parked.integrated, false);
  assert.equal(parked.reason, "coordinator_integration_request_required");
  assert.equal(harness.counts().integrationCalls, 0);
});

test("target movement never bypasses the separate coordinator continuation", async () => {

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
  assert.equal(parked.reason, "coordinator_integration_target_moved");
  assert.equal(harness.counts().integrationCalls, 0, "a moved SHA integrates ZERO times");
});

test("an absent coordinator continuation resolver never becomes integration authority", async () => {
  const harness = createResumableLifecycleHarness();
  const deps = { ...harness.deps };
  delete deps.resolveCommittedSliceIntegrationContinuation;
  const parked = await runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
    status: { ...harness.status },
    deps
  });
  assert.equal(parked.phase, "awaiting-slice-review");
  assert.equal(harness.counts().integrationCalls, 0, "a missing resolver refuses; silence is not acceptance");
});

test("free/local policy still requires the separate coordinator integration request", async () => {
  const harness = createResumableLifecycleHarness({ sliceReviewAccepted: false });
  const parked = await runPostWorkerSliceLifecycle({
    workspace: { repo: "agent-chassis", dir: "/home/user/agent-chassis" },
    status: { ...harness.status },
    deps: { ...harness.deps, reviewEnforcementMode: "policy_only" }
  });
  assert.equal(parked.integrated, false);
  assert.equal(parked.reason, "coordinator_integration_request_required");
  assert.equal(harness.counts().integrationCalls, 0);
});
