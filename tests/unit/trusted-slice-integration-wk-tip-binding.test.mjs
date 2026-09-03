

import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultIntegrateManagedWorkerSlice
} from "../../packages/agent-launch-cli/src/lib/trusted-slice-integration.mjs";

const INITIATIVE = "IN-1713";
const WK_ID = "WK-1713";
const SLICE_ID = "SLICE-001";
const SUBJECT = `${WK_ID}#${SLICE_ID}`;
const UNIT_ADDRESS = `${INITIATIVE}/${WK_ID}/${SLICE_ID}`;
const REPO_ID = "agent-chassis/agent-chassis";

const FORK = "a".repeat(40);
const WK_TIP = "b".repeat(40);
const DELIVERY = "c".repeat(40);
const TARGET_DIGEST = `sha256:${"d".repeat(64)}`;
const CONTRACT_GENERATION = Object.freeze({
  generation: "sha256:contract-generation"
});

function makeSliceBinding({ launchRef, runId, base = WK_TIP } = {}) {
  return {
    schema_version: "worktree-identity-binding.v2",
    launch_ref: launchRef,
    run_id: `${runId}.slice`,
    retry_id: 0,
    unit_address: UNIT_ADDRESS,
    initiative: INITIATIVE,
    record_id: WK_ID,
    slice_id: SLICE_ID,
    base_ref: `wk/${INITIATIVE}/${WK_ID}`,
    base_sha: base,
    output_branch: `slice/${INITIATIVE}/${WK_ID}/${SLICE_ID}`,
    worktree_path: `/tmp/slice-${INITIATIVE}-${WK_ID}-${SLICE_ID}`,
    read_scope: [],
    repo_paths: [],
    write_scope: ["delivery.txt"],
    write_scope_source: `wiki/work-records/${WK_ID}.json#${SLICE_ID}`,
    selected_unit: {
      kind: "slice",
      address: SUBJECT,
      record_id: WK_ID,
      slice_id: SLICE_ID,
      repo: REPO_ID
    },
    source_digest: `sha256:${"c".repeat(64)}`,
    source_version: "work-record.v1",
    checkout_mode: "full"
  };
}

function makeWkBinding({ launchRef, runId, base = FORK, wkTip = WK_TIP, extra = null, drop = null } = {}) {
  const binding = {
    schema_version: "worktree-identity-binding.v1",
    launch_ref: launchRef,
    run_id: `${runId}.wk`,
    retry_id: 0,
    unit_address: `${INITIATIVE}/${WK_ID}`,
    initiative: INITIATIVE,
    record_id: WK_ID,
    slice_id: null,
    base_ref: "main",
    base_sha: base,
    output_branch: `wk/${INITIATIVE}/${WK_ID}`,
    worktree_path: `/tmp/wk-${INITIATIVE}-${WK_ID}`,
    write_scope: ["delivery.txt"],
    write_scope_source: `wiki/work-records/${WK_ID}.json`,
    wk_tip_sha: wkTip
  };
  if (drop) delete binding[drop];
  if (extra) Object.assign(binding, extra);
  return binding;
}

const BINDING_MISMATCH = "agent_launch.slice_integration.binding_mismatch.v1";

function makeDeps({ launchRef, runId, sliceBinding, wkBinding, reached }) {
  const sliceRef = `refs/heads/${sliceBinding.output_branch}`;
  const wkRef = `refs/heads/${wkBinding.output_branch}`;
  return {
    resolveWorktreeBinding: ({ runId: requested }) => requested.endsWith(".slice") ? sliceBinding : wkBinding,
    runGit: async ({ args }) => args[0] === "rev-parse" ? { ok: true, stdout: `${DELIVERY}\n` } : { ok: false, status: 1 },
    canonicalCommittedSliceIntegration: async ({ context, boundaryAuthorization }) => {
      assert.equal(context.integration_binding.wk_tip_sha, wkBinding.wk_tip_sha);
      assert.deepEqual(context.integration_binding.contract_generation, CONTRACT_GENERATION);
      assert.equal(boundaryAuthorization.target.slice_ref, sliceRef);
      reached.value = true;
      return {
        schema_version: "slice-integration.v1",
        integrated: true,
        slice_ref: sliceRef,
        slice_sha: DELIVERY,
        delivery_sha: DELIVERY,
        wk_ref: wkRef,
        wk_sha: DELIVERY,
        empty_delivery: false,
        review_target: null
      };
    },
    reconcileIntegratedSliceRecord: () => null,
    SliceIntegrationError: class SliceIntegrationError extends Error {
      constructor(message, opts) { super(message); this.code = opts?.code; this.detail = opts?.detail; }
    },
    SLICE_INTEGRATION_DIAGNOSTIC_CODES: { INVALID_ARG: "agent_launch.slice_integration.invalid_arg.v1", BINDING_MISMATCH },
    readCanonicalContractGenerationIdentity: () => CONTRACT_GENERATION,
    setWorkRecordStatusByUnit: async () => ({ valid: true, written: true }),
    digestTrustedExactReviewEvidence: () => `sha256:${"d".repeat(64)}`,
    releaseRetainedSlice: async () => {}
  };
}

function makeAuthorization({ sliceBinding, wkBinding }) {
  const sliceRef = `refs/heads/${sliceBinding.output_branch}`;
  return {
    context: {
      review_admission_kind: "canonical_committed_slice",
      review_subject: SUBJECT,
      initiative: INITIATIVE,
      record_id: WK_ID,
      review_slice_id: SLICE_ID,
      slice_ref: sliceRef,
      diff_base_sha: sliceBinding.base_sha,
      committed_target_digest: TARGET_DIGEST,
      integration_binding: {
        wk_ref: `refs/heads/${wkBinding.output_branch}`,
        wk_tip_sha: wkBinding.wk_tip_sha,
        contract_generation: CONTRACT_GENERATION
      }
    },
    contract_generation: CONTRACT_GENERATION,
    boundaryAuthorization: {
      target: {
        subject: SUBJECT,
        initiative: INITIATIVE,
        slice_ref: sliceRef,
        reviewed_sha: DELIVERY,
        diff_base_sha: sliceBinding.base_sha,
        committed_target_digest: TARGET_DIGEST
      }
    }
  };
}

async function integrate({ launchRef, runId, sliceBinding, wkBinding }) {
  const reached = { value: false };
  let error = null;
  let result = null;
  try {
    result = await defaultIntegrateManagedWorkerSlice({
      mainRepo: "/tmp/repo-wk-tip-binding-gate",
      assignedUnit: SUBJECT,
      launchRef,
      runId,
      retryId: 0,
      authorizedRequest: makeAuthorization({ sliceBinding, wkBinding }),
      deps: makeDeps({ launchRef, runId, sliceBinding, wkBinding, reached })
    });
  } catch (err) {
    error = err;
  }
  return { reached: reached.value, error, result };
}

test("WK-1634#SLICE-008: integration ACCEPTS a WK binding whose wk_tip_sha equals the slice base, even when the fixed fork base_sha differs", async () => {
  const launchRef = "launch-accept";
  const runId = "run-accept";
  const { reached, error, result } = await integrate({
    launchRef,
    runId,
    sliceBinding: makeSliceBinding({ launchRef, runId, base: WK_TIP }),

    wkBinding: makeWkBinding({ launchRef, runId, base: FORK, wkTip: WK_TIP })
  });
  assert.equal(error, null, error ? error.message : "");
  assert.equal(reached, true, "the binding gate must pass and reach integrateCommittedSlice");
  assert.equal(result.integrated, true);
});

test("WK-1634#SLICE-008: the fixed base_sha is NOT compared to the slice base — matching base_sha but a disagreeing wk_tip_sha still refuses", async () => {
  const launchRef = "launch-basenotcompared";
  const runId = "run-basenotcompared";
  const { reached, error } = await integrate({
    launchRef,
    runId,
    sliceBinding: makeSliceBinding({ launchRef, runId, base: WK_TIP }),

    wkBinding: makeWkBinding({ launchRef, runId, base: WK_TIP, wkTip: "e".repeat(40) })
  });
  assert.equal(reached, false, "must refuse before any integration mutation");
  assert.ok(error, "must throw");
  assert.equal(error.code, BINDING_MISMATCH);
  assert.match(error.message, /wk_tip_sha/);
});

test("WK-1634#SLICE-008: a disagreeing wk_tip_sha refuses", async () => {
  const launchRef = "launch-disagree";
  const runId = "run-disagree";
  const { reached, error } = await integrate({
    launchRef,
    runId,
    sliceBinding: makeSliceBinding({ launchRef, runId, base: WK_TIP }),
    wkBinding: makeWkBinding({ launchRef, runId, base: FORK, wkTip: "f".repeat(40) })
  });
  assert.equal(reached, false);
  assert.equal(error?.code, BINDING_MISMATCH);
});

test("WK-1634#SLICE-008: a malformed wk_tip_sha refuses", async () => {
  const launchRef = "launch-malformed";
  const runId = "run-malformed";
  const { reached, error } = await integrate({
    launchRef,
    runId,
    sliceBinding: makeSliceBinding({ launchRef, runId, base: WK_TIP }),
    wkBinding: makeWkBinding({ launchRef, runId, base: FORK, wkTip: "not-a-sha" })
  });
  assert.equal(reached, false);
  assert.equal(error?.code, BINDING_MISMATCH);
});

test("WK-1634#SLICE-008: a WK binding missing wk_tip_sha entirely refuses (pre-SLICE-008 shape)", async () => {
  const launchRef = "launch-missing";
  const runId = "run-missing";
  const { reached, error } = await integrate({
    launchRef,
    runId,
    sliceBinding: makeSliceBinding({ launchRef, runId, base: WK_TIP }),
    wkBinding: makeWkBinding({ launchRef, runId, drop: "wk_tip_sha" })
  });
  assert.equal(reached, false);
  assert.equal(error?.code, BINDING_MISMATCH);
});

test("WK-1634#SLICE-008: wk_tip_sha is part of the exact WK-binding key set — an extra field refuses", async () => {
  const launchRef = "launch-extra";
  const runId = "run-extra";
  const { reached, error } = await integrate({
    launchRef,
    runId,
    sliceBinding: makeSliceBinding({ launchRef, runId, base: WK_TIP }),

    wkBinding: makeWkBinding({ launchRef, runId, base: FORK, wkTip: WK_TIP, extra: { smuggled_authority: "x" } })
  });
  assert.equal(reached, false);
  assert.equal(error?.code, BINDING_MISMATCH);
});

test("WK-2266#SLICE-007: missing launcher authorization refuses before the canonical adapter", async () => {
  const launchRef = "launch-no-authorization";
  const runId = "run-no-authorization";
  const sliceBinding = makeSliceBinding({ launchRef, runId });
  const wkBinding = makeWkBinding({ launchRef, runId });
  const reached = { value: false };
  await assert.rejects(
    defaultIntegrateManagedWorkerSlice({
      mainRepo: "/tmp/repo-wk-tip-binding-gate",
      assignedUnit: SUBJECT,
      launchRef,
      runId,
      retryId: 0,
      deps: makeDeps({ launchRef, runId, sliceBinding, wkBinding, reached })
    }),
    (error) => error.code === BINDING_MISMATCH
  );
  assert.equal(reached.value, false);
});

test("WK-2266#SLICE-007: a stale authorized generation refuses before the canonical adapter", async () => {
  const launchRef = "launch-stale-generation";
  const runId = "run-stale-generation";
  const sliceBinding = makeSliceBinding({ launchRef, runId });
  const wkBinding = makeWkBinding({ launchRef, runId });
  const reached = { value: false };
  const authorization = makeAuthorization({ sliceBinding, wkBinding });
  authorization.contract_generation = { generation: "sha256:stale" };
  await assert.rejects(
    defaultIntegrateManagedWorkerSlice({
      mainRepo: "/tmp/repo-wk-tip-binding-gate",
      assignedUnit: SUBJECT,
      launchRef,
      runId,
      retryId: 0,
      authorizedRequest: authorization,
      deps: makeDeps({ launchRef, runId, sliceBinding, wkBinding, reached })
    }),
    (error) => error.code === BINDING_MISMATCH
  );
  assert.equal(reached.value, false);
});

test("WK-2266#SLICE-007: an unchanged WK tip with a changed current generation refuses", async () => {
  const launchRef = "launch-current-generation";
  const runId = "run-current-generation";
  const sliceBinding = makeSliceBinding({ launchRef, runId });
  const wkBinding = makeWkBinding({ launchRef, runId });
  const reached = { value: false };
  const deps = makeDeps({ launchRef, runId, sliceBinding, wkBinding, reached });
  deps.readCanonicalContractGenerationIdentity = () => ({ generation: "sha256:current" });
  await assert.rejects(
    defaultIntegrateManagedWorkerSlice({
      mainRepo: "/tmp/repo-wk-tip-binding-gate",
      assignedUnit: SUBJECT,
      launchRef,
      runId,
      retryId: 0,
      authorizedRequest: makeAuthorization({ sliceBinding, wkBinding }),
      deps
    }),
    (error) => error.code === BINDING_MISMATCH
  );
  assert.equal(reached.value, false);
});

for (const mainRepo of ["relative-repo", "/tmp/repo-wk-tip-binding-gate/../repo-wk-tip-binding-gate"]) {
  test(`WK-2266#SLICE-007: rejects non-normalized mainRepo ${mainRepo}`, async () => {
    const launchRef = "launch-invalid-repo";
    const runId = `run-invalid-${mainRepo.replace(/[^a-z]+/gu, "-")}`;
    const sliceBinding = makeSliceBinding({ launchRef, runId });
    const wkBinding = makeWkBinding({ launchRef, runId });
    const reached = { value: false };
    await assert.rejects(
      defaultIntegrateManagedWorkerSlice({
        mainRepo,
        assignedUnit: SUBJECT,
        launchRef,
        runId,
        retryId: 0,
        authorizedRequest: makeAuthorization({ sliceBinding, wkBinding }),
        deps: makeDeps({ launchRef, runId, sliceBinding, wkBinding, reached })
      }),
      (error) => error.code === "agent_launch.slice_integration.invalid_arg.v1"
    );
    assert.equal(reached.value, false);
  });
}
