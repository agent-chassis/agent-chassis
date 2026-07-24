

import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultIntegrateManagedWorkerSlice
} from "../packages/agent-launch-cli/src/lib/trusted-slice-integration.mjs";

const INITIATIVE = "IN-1713";
const WK_ID = "WK-1713";
const SLICE_ID = "SLICE-001";
const SUBJECT = `${WK_ID}#${SLICE_ID}`;
const UNIT_ADDRESS = `${INITIATIVE}/${WK_ID}/${SLICE_ID}`;
const REPO_ID = "agent-chassis/agent-chassis";

const FORK = "a".repeat(40);
const WK_TIP = "b".repeat(40);
const DELIVERY = "c".repeat(40);

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
  return {
    resolveWorktreeBinding: ({ runId: requested }) => requested.endsWith(".slice") ? sliceBinding : wkBinding,
    defaultRunGit: ({ args }) => args[0] === "rev-parse" ? { ok: true, stdout: `${DELIVERY}\n` } : { ok: false, status: 1 },
    runGit: ({ args }) => args[0] === "rev-parse" ? { ok: true, stdout: `${DELIVERY}\n` } : { ok: false, status: 1 },
    integrateCommittedSlice: async () => {
      reached.value = true;
      return {
        schema_version: "slice-integration.v1",
        integrated: true,
        slice_ref: `refs/heads/${sliceBinding.output_branch}`,
        slice_sha: DELIVERY,
        delivery_sha: DELIVERY,
        wk_ref: `refs/heads/${wkBinding.output_branch}`,
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
    setWorkRecordStatusByUnit: async () => ({ valid: true, written: true }),
    digestTrustedExactReviewEvidence: () => `sha256:${"d".repeat(64)}`,
    releaseRetainedSlice: async () => {}
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
