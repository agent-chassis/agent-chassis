

import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNED_UNIT,
  BASE_SHA,
  COMMIT_SHA,
  exactSliceBinding,
  installIdentityStoreEnv,
  installState,
  publishedExactSliceAdvance,
  registerCommitTool
} from "../helpers/workspace-commit-function-contract-harness.mjs";

test("commit refuses structural write_scope failure before ref advance or transition", async (t) => {
  const binding = exactSliceBinding();
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    scope: {
      contained: false,
      changed_paths: ["packages/wiki-mcp/src/server.mjs"],
      metrics: { measured: false },
      baseline: { measured: false },
      attestation: { state: "not_attested", reason: "free_tier" },
      expected_envelope_invariant: { checked: true, ok: true, blocking: false },
      refusal: {
        code: "OUT_OF_SCOPE",
        reasons: ["OUT_OF_SCOPE"],
        out_of_scope: ["packages/wiki-mcp/src/server.mjs"]
      }
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  const response = result.structuredContent;

  assert.equal(response.committed, false);
  assert.equal(response.submitted_for_review, false);
  assert.equal(response.decision_code, "commit.write_scope_refused.v1");
  assert.deepEqual(state.calls.map((call) => call.op), ["resolve_binding", "materialize", "verify_measure"]);
});

test("not-attested/free envelope and failed measurement do not block structural success", async (t) => {
  const binding = exactSliceBinding();
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    scope: {
      contained: true,
      changed_paths: ["tests/unit/workspace-commit-function-contract.test.mjs"],
      metrics: {
        measured: false,
        reason: "numstat_failed"
      },
      baseline: {
        measured: false,
        reason: "ls_tree_failed"
      },
      attestation: {
        schema_version: "envelope-attestation-marker.v1",
        state: "not_attested",
        reason: "free_tier"
      },
      expected_envelope_invariant: {
        checked: true,
        ok: false,
        blocking: false,
        reason: "expected_envelope_missing"
      },
      refusal: null
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  const response = result.structuredContent;

  assert.equal(response.committed, true);
  assert.equal(response.submitted_for_review, true);
  assert.equal(response.metrics.measured, false);
  assert.equal(response.baseline.measured, false);
  assert.equal(response.attestation.state, "not_attested");
  assert.equal(response.attestation.reason, "free_tier");
  assert.equal(response.expected_envelope_invariant.blocking, false);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding",
    "materialize",
    "verify_measure",
    "commit_slice_ref",
    "transition"
  ]);
});

test("WK-2214 transition throw does not publish the exact slice ref", async (t) => {
  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    advanced: publishedExactSliceAdvance(),
    transitionError: Object.assign(new Error("injected status writer failure"), {
      code: "work_record.write_failed.v1"
    })
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  const payload = result.structuredContent;
  assert.equal(payload.committed, false);
  assert.equal(payload.submitted_for_review, false);

  assert.equal(payload.decision_code, "commit.review_transition_failed_compensated.v1");
  assert.equal(payload.transaction.canonical_review.state, "threw");
  assert.equal(payload.transaction.compensation.state, "restored");
  assert.equal(payload.transaction.compensation.ref, "refs/heads/slice/IN-0011/WK-1429/SLICE-004");
  assert.equal(payload.transaction.compensation.published_commit, COMMIT_SHA);
  assert.equal(payload.transaction.compensation.restored_tip, BASE_SHA);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding", "materialize", "verify_measure",
    "commit_slice_ref", "transition", "compensate_slice_ref"
  ]);

  const compensation = state.calls.find((call) => call.op === "compensate_slice_ref");
  assert.equal(compensation.args.sliceRef, "refs/heads/slice/IN-0011/WK-1429/SLICE-004");
  assert.equal(compensation.args.publishedCommit, COMMIT_SHA);
  assert.equal(compensation.args.priorTip, BASE_SHA);
});

test("WK-2214 invalid and stale transition results do not publish the exact slice ref", async (t) => {
  const cases = [
    ["invalid non-review result", {
      valid: true,
      written: true,
      no_op: false,
      selected_unit: {
        kind: "slice", address: ASSIGNED_UNIT, record_id: "WK-1429", slice_id: "SLICE-004"
      },
      status: "doing"
    }, "work_record.exact_slice_implementation_review_transition_unconfirmed.v1"],
    ["stale status CAS", {
      valid: false,
      written: false,
      no_op: false,
      current_source_digest: `sha256:${"d".repeat(64)}`,
      selected_unit: {
        kind: "slice", address: ASSIGNED_UNIT, record_id: "WK-1429", slice_id: "SLICE-004"
      },
      status: null
    }, "work_record.exact_slice_implementation_review_transition_invalid.v1"]
  ];
  for (const [name, transitionResult, expectedCode] of cases) {
    await t.test(name, async (t) => {
      const binding = exactSliceBinding({
        output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
      });
      installIdentityStoreEnv(t, binding);
      const state = installState({
        binding,
        advanced: publishedExactSliceAdvance(),
        transitionResult
      });
      const tool = await registerCommitTool(t);
      const payload = (await tool.handler({})).structuredContent;
      assert.equal(payload.committed, false);
      assert.equal(payload.submitted_for_review, false);
      assert.equal(payload.transaction.canonical_review.decision_code, expectedCode);

      assert.equal(payload.decision_code, "commit.review_transition_failed_compensated.v1");
      assert.equal(payload.transaction.compensation.state, "restored");
      assert.equal(payload.transaction.compensation.published_commit, COMMIT_SHA);
      assert.equal(payload.transaction.compensation.restored_tip, BASE_SHA);
      assert.equal(payload.transaction.published_commit, COMMIT_SHA);
      assert.equal(payload.transaction.ref_advanced, true);
      assert.deepEqual(state.calls.map((call) => call.op), [
        "resolve_binding", "materialize", "verify_measure",
        "commit_slice_ref", "transition", "compensate_slice_ref"
      ]);
    });
  }
});

test("WK-2214 publication failure remains typed after the status transition without rollback", async (t) => {
  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const publicationError = Object.assign(new Error("injected slice ref publication failure"), {
    code: "agent_launch.slice_integration.slice_commit_conflict.v1"
  });
  const state = installState({
    binding,
    publicationError
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.isError, true);

  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding", "materialize", "verify_measure", "commit_slice_ref"
  ]);
  assert.equal(state.calls.filter((call) => call.op === "transition").length, 0);
  assert.equal(state.calls.filter((call) => call.op === "compensate_slice_ref").length, 0);
});

test("WK-2367 a lost compensation across the publish/transition window is a typed partial transaction", async (t) => {

  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const observedTip = "e".repeat(40);
  const compensationError = Object.assign(new Error("injected compensation CAS failure"), {
    code: "agent_launch.slice_integration.slice_commit_compensation_failed.v1",
    detail: { observed_tip: observedTip }
  });
  const state = installState({
    binding,
    advanced: publishedExactSliceAdvance(),
    transitionError: Object.assign(new Error("injected status writer failure"), {
      code: "work_record.write_failed.v1"
    }),
    compensationError
  });
  const tool = await registerCommitTool(t);

  const payload = (await tool.handler({})).structuredContent;
  assert.equal(payload.committed, false);
  assert.equal(payload.submitted_for_review, false);
  assert.equal(payload.decision_code, "commit.exact_slice_transaction_partial.v1");
  assert.equal(payload.transaction.schema_version, "workspace-exact-slice-commit-transaction.v1");
  assert.equal(payload.transaction.canonical_review.state, "threw");
  assert.equal(payload.transaction.canonical_review.decision_code, "work_record.write_failed.v1");
  assert.equal(payload.transaction.compensation.state, "failed");
  assert.equal(
    payload.transaction.compensation.decision_code,
    "agent_launch.slice_integration.slice_commit_compensation_failed.v1"
  );
  assert.equal(payload.transaction.compensation.ref, "refs/heads/slice/IN-0011/WK-1429/SLICE-004");
  assert.equal(payload.transaction.compensation.published_commit, COMMIT_SHA);
  assert.equal(payload.transaction.compensation.prior_tip, BASE_SHA);
  assert.equal(payload.transaction.compensation.observed_tip, observedTip);
  assert.equal(payload.transaction.published_commit, COMMIT_SHA);
  assert.equal(payload.transaction.prior_tip, BASE_SHA);
  assert.equal(payload.transaction.ref_advanced, true);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding", "materialize", "verify_measure",
    "commit_slice_ref", "transition", "compensate_slice_ref"
  ]);
});

test("WK-1699 an idempotent replay with transition failure never compensates a prior delivery", async (t) => {
  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const priorDelivery = "d".repeat(40);
  const state = installState({
    binding,
    advanced: publishedExactSliceAdvance({
      commit: priorDelivery,
      idempotent: true,
      ref_advanced: false
    }),
    transitionResult: { valid: false, written: false, no_op: false, status: null }
  });
  const tool = await registerCommitTool(t);

  const payload = (await tool.handler({})).structuredContent;
  assert.equal(payload.committed, false);
  assert.equal(payload.submitted_for_review, false);
  assert.equal(payload.decision_code, "commit.review_transition_failed_unpublished.v1");

  assert.equal(payload.transaction.compensation.state, "not_required");
  assert.equal(payload.transaction.ref_advanced, false);
  assert.equal(payload.transaction.published_commit, null);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding", "materialize", "verify_measure", "commit_slice_ref", "transition"
  ]);
  assert.equal(state.calls.some((call) => call.op === "compensate_slice_ref"), false);
});

test("WK-1699 an equivalent replay converges and accepts an already-review canonical no-op", async (t) => {
  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const existing = "d".repeat(40);
  const state = installState({
    binding,
    advanced: publishedExactSliceAdvance({
      commit: existing,
      idempotent: true,
      ref_advanced: false
    }),
    transitionResult: {
      valid: true,
      written: false,
      no_op: true,
      selected_unit: {
        kind: "slice",
        address: ASSIGNED_UNIT,
        record_id: "WK-1429",
        slice_id: "SLICE-004"
      },
      status: "review"
    }
  });
  const tool = await registerCommitTool(t);

  const payload = (await tool.handler({})).structuredContent;
  assert.equal(payload.committed, true);
  assert.equal(payload.submitted_for_review, true);
  assert.equal(payload.idempotent, true);
  assert.equal(payload.ref_advanced, false);
  assert.equal(payload.transition.result.no_op, true);
  assert.equal(payload.transition.result.status, "review");
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding", "materialize", "verify_measure", "commit_slice_ref", "transition"
  ]);
  assert.equal(state.calls.some((call) => call.op === "compensate_slice_ref"), false);
});
