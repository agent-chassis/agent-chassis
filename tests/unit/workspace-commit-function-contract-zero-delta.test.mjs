

import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_SHA,
  COMMIT_SHA,
  TREE_SHA,
  exactSliceBinding,
  installIdentityStoreEnv,
  installState,
  registerCommitTool
} from "../helpers/workspace-commit-function-contract-harness.mjs";

test("WK-1713 an authenticated zero-delta delivery advances the ref to a same-tree child and submits for review", async (t) => {
  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      prior_tip: BASE_SHA,
      idempotent: false,
      ref_advanced: true,
      empty_delivery: true
    },
    scope: {
      contained: true,

      changed_paths: [],
      metrics: {
        measured: true,
        changed_line_count: { added: 0, deleted: 0, total: 0, binary_paths: [] },
        final_file_sizes: {},
        changed_file_count: 0,
        scope_count: 1
      },
      baseline: { measured: true, file_sizes_at_base: {} },
      attestation: {
        schema_version: "envelope-attestation-marker.v1",
        state: "not_attested",
        reason: "free_tier"
      },
      expected_envelope_invariant: { checked: true, ok: true, blocking: false },
      refusal: null
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  const payload = result.structuredContent;
  assert.equal(payload.committed, true);
  assert.equal(payload.submitted_for_review, true);
  assert.equal(payload.ref_advanced, true, "an authenticated zero-delta child still advances the ref");
  assert.equal(payload.empty_delivery, true);
  assert.equal(payload.commit, COMMIT_SHA, "the response names the authenticated same-tree child, never the base");
  assert.notEqual(payload.commit, BASE_SHA);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding",
    "materialize",
    "verify_measure",
    "commit_slice_ref",
    "transition"
  ]);
  assert.equal(state.calls.some((call) => call.op === "advance_ref"), false, "no WK ref advance");
  assert.equal(state.calls.some((call) => call.op === "compensate_slice_ref"), false);
});

test("WK-1713 an empty changed-path projection still authenticates a same-tree child, not a ref-unchanged no-op", async (t) => {
  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    scope: { contained: true, changed_paths: [], refusal: null },
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      prior_tip: BASE_SHA,
      idempotent: false,
      ref_advanced: true,
      empty_delivery: true
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, true);
  assert.equal(result.structuredContent.submitted_for_review, true);
  assert.equal(result.structuredContent.ref_advanced, true, "the ref advanced to the authenticated child");
  assert.equal(result.structuredContent.commit, COMMIT_SHA, "never the launcher-bound base");
  assert.notEqual(result.structuredContent.decision_code, "commit.empty_delivery.v1");
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding",
    "materialize",
    "verify_measure",
    "commit_slice_ref",
    "transition"
  ]);
});

test("WK-1694#SLICE-003 a one-path in-scope delivery still commits and advances the slice ref", async (t) => {

  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    scope: {
      contained: true,
      changed_paths: ["tests/unit/workspace-commit-function-contract.test.mjs"],
      metrics: {
        measured: true,
        changed_line_count: { added: 1, deleted: 0, total: 1, binary_paths: [] },
        final_file_sizes: { "tests/unit/workspace-commit-function-contract.test.mjs": 1 },
        changed_file_count: 1,
        scope_count: 1
      },
      baseline: { measured: true, file_sizes_at_base: { "tests/unit/workspace-commit-function-contract.test.mjs": 0 } },
      attestation: {
        schema_version: "envelope-attestation-marker.v1",
        state: "not_attested",
        reason: "free_tier"
      },
      expected_envelope_invariant: { checked: true, ok: true, blocking: false },
      refusal: null
    },
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      idempotent: false
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, true);
  assert.deepEqual(result.structuredContent.changed_paths, [
    "tests/unit/workspace-commit-function-contract.test.mjs"
  ]);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding",
    "materialize",
    "verify_measure",
    "commit_slice_ref",
    "transition"
  ]);
});
