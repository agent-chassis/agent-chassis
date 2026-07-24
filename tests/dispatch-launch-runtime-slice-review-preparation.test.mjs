import test from "node:test";
import assert from "node:assert/strict";

import {
  SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
  SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS
} from "../packages/agent-launch-cli/src/lib/trusted-operation-contracts.mjs";
import {
  createDirectSliceReviewPreparationAdapter,
  validateSliceReviewPreparationResult
} from "../packages/wiki-mcp/src/lib/dispatch-launch-runtime.mjs";

const MAIN_REPO = "/launcher/owned/main-repo";

const REQUEST = Object.freeze({
  assigned_unit: "WK-1687#SLICE-001",
  launch_ref: "refs/agent-launch/wk-1687/slice-001",
  run_id: "wkdb_937cf33a3adceda6",
  retry_id: 0
});

function canonicalPreparation(overrides = {}) {
  return {
    schema_version: SLICE_REVIEW_SURFACE_PREPARATION_SCHEMA_VERSION,
    assigned_unit: REQUEST.assigned_unit,
    launch_ref: REQUEST.launch_ref,
    run_id: REQUEST.run_id,
    retry_id: REQUEST.retry_id,
    worktree_identity_digest: "sha256:9f2b1c",
    worktree_path: "/launcher/owned/worktrees/wk-1687-slice-001",
    slice_ref: "refs/agent-launch/wk-1687/slice-001",
    base_sha: "1111111111111111111111111111111111111111",
    reviewed_sha: "a450802df874c122eed960867aaafa3dcd533710",
    reviewed_tree: "2222222222222222222222222222222222222222",
    verified_parts: [...SLICE_REVIEW_SURFACE_PREPARATION_VERIFIED_PARTS],
    ...overrides
  };
}

function adapterReturning(preparation, { onCall } = {}) {
  return createDirectSliceReviewPreparationAdapter(MAIN_REPO, {
    prepareSurface: async (args) => {
      if (onCall) {
        onCall(args);
      }
      return preparation;
    }
  });
}

test("WK-1688 adapter accepts the canonical slice-review-surface-preparation.v1 result", async () => {

  const preparation = canonicalPreparation();
  assert.ok(
    !("prepared" in preparation),
    "the canonical producer result must carry no prepared field"
  );

  const seenArgs = [];
  const adapter = adapterReturning(preparation, { onCall: (args) => seenArgs.push(args) });
  const result = await adapter({ ...REQUEST });

  assert.deepEqual(result, { accepted: true, preparation });

  assert.deepEqual(seenArgs, [{
    mainRepo: MAIN_REPO,
    assignedUnit: REQUEST.assigned_unit,
    launchRef: REQUEST.launch_ref,
    runId: REQUEST.run_id,
    retryId: REQUEST.retry_id
  }]);
});

test("WK-1688 adapter refuses null and malformed preparation results", async () => {
  for (const malformed of [null, undefined, "prepared", 7, true, [], []]) {
    const adapter = adapterReturning(malformed);
    await assert.rejects(
      adapter({ ...REQUEST }),
      /direct slice-review preparation returned an invalid trusted result/u,
      `malformed result ${JSON.stringify(malformed) ?? String(malformed)} must be refused`
    );
  }
});

test("WK-1688 adapter refuses a wrong or absent schema version", async () => {
  const wrongVersions = [
    "slice-review-surface-preparation.v2",
    "worktree-identity-binding.v2",
    "",
    undefined
  ];
  for (const schema_version of wrongVersions) {
    const adapter = adapterReturning(canonicalPreparation({ schema_version }));
    await assert.rejects(
      adapter({ ...REQUEST }),
      /direct slice-review preparation returned an invalid trusted result/u,
      `schema_version ${String(schema_version)} must be refused`
    );
  }
});

test("WK-1688 adapter refuses every exact-tuple mismatch", async () => {
  const mismatches = [
    { assigned_unit: "WK-1687#SLICE-002" },
    { launch_ref: "refs/agent-launch/wk-1687/slice-002" },
    { run_id: "wkdb_0000000000000000" },
    { retry_id: 1 },

    { assigned_unit: undefined },
    { launch_ref: undefined },
    { run_id: undefined },
    { retry_id: undefined }
  ];
  for (const override of mismatches) {
    const adapter = adapterReturning(canonicalPreparation(override));
    await assert.rejects(
      adapter({ ...REQUEST }),
      /direct slice-review preparation returned an invalid trusted result/u,
      `tuple drift ${JSON.stringify(override)} must be refused`
    );
  }
});

test("WK-1688 adapter still binds the exact launcher tuple before calling the producer", async () => {

  let called = false;
  const adapter = createDirectSliceReviewPreparationAdapter(MAIN_REPO, {
    prepareSurface: async () => {
      called = true;
      return canonicalPreparation();
    }
  });

  const badRequests = [
    null,
    {},
    { ...REQUEST, assigned_unit: "WK-1687" },
    { ...REQUEST, retry_id: -1 },
    { ...REQUEST, retry_id: "0" },
    { ...REQUEST, launch_ref: "" },

    { ...REQUEST, main_repo: "/attacker/repo" }
  ];
  for (const request of badRequests) {
    await assert.rejects(
      adapter(request),
      /trusted lifecycle operation requires the exact launcher tuple/u,
      `request ${JSON.stringify(request)} must be refused before the producer runs`
    );
  }
  assert.equal(called, false, "the producer must not run for a malformed tuple");
});

test("WK-1688 the exported validator pins the canonical contract, with no prepared field", () => {
  const bound = { ...REQUEST };
  assert.equal(validateSliceReviewPreparationResult(canonicalPreparation(), bound), true);

  assert.equal(
    validateSliceReviewPreparationResult(canonicalPreparation({ prepared: true }), bound),
    true
  );
  assert.equal(validateSliceReviewPreparationResult(null, bound), false);
  assert.equal(
    validateSliceReviewPreparationResult(canonicalPreparation({ schema_version: "x" }), bound),
    false
  );
});
