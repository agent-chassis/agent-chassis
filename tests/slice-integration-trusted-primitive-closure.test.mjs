import assert from "node:assert/strict";
import test from "node:test";

import { defaultIntegrateManagedWorkerSlice } from "../packages/agent-launch-cli/src/lib/trusted-slice-integration.mjs";

const SHA = "1".repeat(40);
const BASE_SHA = "2".repeat(40);
const MAIN_REPO = "/canonical/main-repo";
const UNIT = "WK-1888#SLICE-006";

function sliceBinding({ runId, worktreePath, baseSha }) {
  return {
    schema_version: "worktree-identity-binding.v2",
    launch_ref: "refs/heads/main",
    run_id: runId,
    retry_id: 0,
    unit_address: "IN-0031/WK-1888/SLICE-006",
    initiative: "IN-0031",
    record_id: "WK-1888",
    slice_id: "SLICE-006",
    base_ref: "wk/IN-0031/WK-1888",
    base_sha: baseSha,
    output_branch: "refs/heads/slice/IN-0031/WK-1888/SLICE-006",
    worktree_path: worktreePath,
    read_scope: ["AGENTS.md"],
    repo_paths: ["packages"],
    write_scope: ["packages/agent-launch-cli/src/lib/trusted-slice-integration.mjs"],
    write_scope_source: "wiki/work-records/WK-1888.json#SLICE-006",
    selected_unit: {
      kind: "slice",
      address: "WK-1888#SLICE-006",
      record_id: "WK-1888",
      slice_id: "SLICE-006",
      repo: null
    },
    source_digest: `sha256:${"3".repeat(64)}`,
    source_version: "work-record.v1",
    checkout_mode: "full"
  };
}

function wkBinding({ runId, baseSha }) {
  return {
    schema_version: "worktree-identity-binding.v1",
    launch_ref: "refs/heads/main",
    run_id: runId,
    retry_id: 0,
    unit_address: "IN-0031/WK-1888",
    initiative: "IN-0031",
    record_id: "WK-1888",
    slice_id: "",
    base_ref: "refs/heads/wk/IN-0031/WK-1888",
    base_sha: baseSha,
    output_branch: "refs/heads/wk/IN-0031/WK-1888",
    worktree_path: "/retained/wk",
    write_scope: ["packages/agent-launch-cli/src/lib/trusted-slice-integration.mjs"],
    write_scope_source: "work-record.v1",
    wk_tip_sha: baseSha
  };
}

test("trusted integration supplies the compound record CAS seam", async () => {
  let integrationArguments;
  let recordWrite;
  const setWorkRecordStatusByUnit = async () => {
    throw new Error("compound integration must not use setWorkRecordStatusByUnit");
  };
  const writeValidatedWorkRecord = async (input) => {
    assert.deepEqual(Object.keys(input).sort(), ["dir", "expectedSourceDigest", "record"].sort());
    assert.equal(input.dir, MAIN_REPO);
    assert.equal(input.expectedSourceDigest, "digest");
    assert.equal(input.record.id, "WK-1888");
    assert.equal(input.record.status, "review");
    assert.equal(input.record.slices[0].status, "done");
    recordWrite = input;
    return { valid: true, written: true, record: input.record };
  };
  const exactSliceBinding = sliceBinding({
    runId: "run-1.slice",
    worktreePath: "/retained/slice-IN-0031-WK-1888-SLICE-006",
    baseSha: BASE_SHA
  });
  const exactWkBinding = wkBinding({
    runId: "run-1.wk",
    baseSha: BASE_SHA
  });

  const result = await defaultIntegrateManagedWorkerSlice({
    mainRepo: MAIN_REPO,
    assignedUnit: "WK-1888#SLICE-006",
    launchRef: "refs/heads/main",
    runId: "run-1",
    retryId: 0,
    deps: {
      resolveWorktreeBinding: ({ runId }) => runId.endsWith(".slice") ? exactSliceBinding : exactWkBinding,
      defaultRunGit: () => ({ ok: true, stdout: `${SHA}\n` }),
      runGit: ({ args }) => args[0] === "merge-base"
        ? { ok: true, stdout: "" }
        : { ok: true, stdout: `${SHA}\n` },
      integrateCommittedSlice: async (args) => {
        integrationArguments = args;
        assert.equal(typeof args.writeRecordCas, "function");
        await args.writeRecordCas({
          record: {
            id: "WK-1888",
            status: "review",
            slices: [{ id: "SLICE-006", status: "done" }]
          },
          unitAddress: UNIT,
          expectedSourceDigest: "digest"
        });
        return {
          integrated: true,
          slice_ref: args.sliceRef,
          delivery_sha: SHA,
          review_target: "review-target"
        };
      },
      reconcileIntegratedSliceRecord: () => null,
      SliceIntegrationError: class SliceIntegrationError extends Error {},
      SLICE_INTEGRATION_DIAGNOSTIC_CODES: { BINDING_MISMATCH: "binding_mismatch", INVALID_ARG: "invalid_arg" },
      setWorkRecordStatusByUnit,
      writeValidatedWorkRecord,
      digestTrustedExactReviewEvidence: () => "evidence-digest",
      releaseRetainedSlice: async () => ({ reaped: true })
    }
  });

  assert.equal(result.integrated, true);
  assert.equal(typeof integrationArguments.writeRecordCas, "function");
  assert.equal(recordWrite.dir, MAIN_REPO);
  assert.equal(recordWrite.record.status, "review");
  assert.equal(recordWrite.record.slices[0].status, "done");
  assert.equal(result.review_target, "review-target");
  assert.equal(Object.hasOwn(recordWrite.record, "review_target"), false);
  assert.deepEqual(recordWrite.record.slices[0], {
    id: "SLICE-006",
    status: "done"
  });
});
