import test from "node:test";
import assert from "node:assert/strict";

import * as launchRuntime from "../../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import {
  composePostWorkerSliceLifecycle,
  resolveLauncherOwnedLifecycleDeps
} from "../../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";
import {
  createResumableLifecycleHarness,
  RETIRED_POST_WORKER_REVIEW_SEAMS
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";

const PROVISIONING = Object.freeze({ mainRepo: "/launcher/owned/main-repo" });

const RETIRED_COMPOSITION_INPUTS = Object.freeze({
  hostSliceReviewPreparationAdapter: () => { throw new Error("retired preparation adapter"); },
  reviewEnforcementMode: "enforced",
  terminalReviewEvidenceMode: "live_materializer",
  materializeTerminalReviewWorktree: () => { throw new Error("retired materializer"); },
  bindFrozenSliceReviewContext: () => { throw new Error("retired slice review binding"); },
  bindFrozenReviewContext: () => { throw new Error("retired review binding"); }
});

const REVIEW_CAPABILITY_KEYS = Object.freeze([
  ...Object.keys(RETIRED_COMPOSITION_INPUTS),
  ...RETIRED_POST_WORKER_REVIEW_SEAMS
]);

function terminalCandidateCoordinator() {
  return Object.freeze({
    prepareTerminalCandidate: async () => ({ prepared: true })
  });
}

test("the launch runtime exports no slice-review preparation capability", () => {
  for (const retired of [
    "createDirectSliceReviewPreparationAdapter",
    "validateSliceReviewPreparationResult"
  ]) {
    assert.equal(Object.hasOwn(launchRuntime, retired), false, retired);
  }
});

test("no managed provisioning composes nothing, whatever the caller supplies", () => {
  for (const worktreeProvisioning of [null, undefined]) {
    assert.deepEqual(resolveLauncherOwnedLifecycleDeps({
      worktreeProvisioning,
      directSliceIntegrationAdapter: async () => ({ accepted: true }),
      terminalCandidateCoordinator: terminalCandidateCoordinator(),
      ...RETIRED_COMPOSITION_INPUTS
    }), {}, String(worktreeProvisioning));
  }
  assert.deepEqual(resolveLauncherOwnedLifecycleDeps(), {});
});

test("managed provisioning composes only integration and terminal candidate capabilities", () => {
  const directSliceIntegrationAdapter = async () => ({ accepted: true });
  const coordinator = terminalCandidateCoordinator();
  const composed = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: PROVISIONING,
    directSliceIntegrationAdapter,
    terminalCandidateCoordinator: coordinator,
    ...RETIRED_COMPOSITION_INPUTS
  });

  assert.deepEqual(Object.keys(composed).sort(), [
    "hostSliceIntegrationAdapter",
    "prepareTerminalCandidate"
  ]);
  assert.equal(composed.hostSliceIntegrationAdapter, directSliceIntegrationAdapter);
  assert.equal(composed.prepareTerminalCandidate, coordinator.prepareTerminalCandidate);
  assert.equal(Object.hasOwn(composed, "validateTerminalCandidate"), false);
  for (const key of REVIEW_CAPABILITY_KEYS) {
    assert.equal(Object.hasOwn(composed, key), false, key);
  }
});

test("an incomplete managed composition stays fail-closed and adds no review capability", () => {
  const composed = resolveLauncherOwnedLifecycleDeps({
    worktreeProvisioning: PROVISIONING,
    ...RETIRED_COMPOSITION_INPUTS
  });
  assert.deepEqual(composed, {});
});

test("the composed lifecycle wrapper forwards only launcher-owned wiring over caller deps", async () => {
  const directSliceIntegrationAdapter = async () => ({ accepted: true });
  const calls = [];
  const lifecycle = async (request) => {
    calls.push(request);
    return null;
  };
  const composed = composePostWorkerSliceLifecycle({
    worktreeProvisioning: PROVISIONING,
    directSliceIntegrationAdapter,
    lifecycle,
    ...RETIRED_COMPOSITION_INPUTS
  });
  const callerIntegration = async () => ({ accepted: true });
  const workspace = { dir: "/launcher/owned/main-repo" };
  const status = { role: "worker" };
  await composed({
    workspace,
    status,
    deps: { hostSliceIntegrationAdapter: callerIntegration, callerOnly: 1 }
  });

  assert.equal(calls.length, 1);
  const { deps } = calls[0];
  assert.equal(calls[0].workspace, workspace);
  assert.equal(calls[0].status, status);

  assert.equal(deps.hostSliceIntegrationAdapter, directSliceIntegrationAdapter);
  assert.equal(deps.callerOnly, 1);

  assert.deepEqual(Object.keys(deps).sort(), ["callerOnly", "hostSliceIntegrationAdapter"]);
});

test("caller-supplied review seams are never exercised by the composed real lifecycle", async () => {
  const harness = createResumableLifecycleHarness();
  let integrations = 0;
  const composed = composePostWorkerSliceLifecycle({
    worktreeProvisioning: PROVISIONING,
    directSliceIntegrationAdapter: async () => {
      integrations += 1;
      harness.setCanonicalStatus("review");
      return { accepted: true, integration: harness.integrationResult };
    },
    ...RETIRED_COMPOSITION_INPUTS
  });
  const callerReviewSeams = Object.fromEntries(Object.keys(RETIRED_COMPOSITION_INPUTS)
    .filter((key) => typeof RETIRED_COMPOSITION_INPUTS[key] === "function")
    .map((key) => [key, RETIRED_COMPOSITION_INPUTS[key]]));
  const result = await composed({
    workspace: { dir: "/tmp/main-repo-IN-0021-WK-1537" },
    status: harness.status,
    deps: { ...harness.deps, ...callerReviewSeams }
  });

  assert.equal(integrations, 1);
  assert.equal(result.phase, "finalized");
  assert.equal(result.integrated, true);
  assert.equal(result.wk_transitioned_to_review, true);
  for (const key of ["slice_review", "reviewer_dispatch", "terminal_review_materialization",
    "empty_delivery", "terminal_candidate"]) {
    assert.equal(Object.hasOwn(result, key), false, key);
  }

  assert.deepEqual(harness.reviewSeamCalls(), []);

  assert.equal(harness.counts().declaredUnitCalls, 0);
});
