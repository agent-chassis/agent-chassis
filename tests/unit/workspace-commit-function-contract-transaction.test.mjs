

import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNED_UNIT,
  BASE_SHA,
  COMMIT_SHA,
  TREE_SHA,
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

  assert.equal(payload.submitted_for_review, null);

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
      assert.equal(payload.delivery_ref, "restored");
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
  assert.equal(payload.submitted_for_review, null);
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

  assert.equal(payload.delivery_ref, "unknown");
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

  assert.equal(payload.submitted_for_review, null);
  assert.equal(payload.decision_code, "commit.review_transition_failed_unpublished.v1");

  assert.equal(payload.transaction.compensation.state, "not_required");
  assert.equal(payload.delivery_ref, "unchanged");
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

  assert.equal(payload.transition.no_op, true);
  assert.equal(payload.transition.written, false);
  assert.equal(payload.transition.status, "review");
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding", "materialize", "verify_measure", "commit_slice_ref", "transition"
  ]);
  assert.equal(state.calls.some((call) => call.op === "compensate_slice_ref"), false);
});

test("deliver_work preserves transition and compensation effects independently", async (t) => {

  const SLICE_REF = "refs/heads/slice/IN-0011/WK-1429/SLICE-004";
  const CANDIDATE = COMMIT_SHA;
  const EXISTING_DELIVERY = "d".repeat(40);
  const CONCURRENT_TIP = "e".repeat(40);
  const CONFLICT = "agent_launch.slice_integration.slice_commit_conflict.v1";
  const READ_INDETERMINATE = "agent_launch.slice_integration.slice_commit_read_indeterminate.v1";
  const COMPENSATION_CAS_LOST = "agent_launch.slice_integration.slice_commit_compensation_cas_lost.v1";
  const TRANSITION_INVALID = "work_record.exact_slice_implementation_review_transition_invalid.v1";
  const TRANSITION_WRONG_UNIT =
    "work_record.exact_slice_implementation_review_transition_binding_mismatch.v1";
  const BEFORE_PUBLICATION = ["resolve_binding", "materialize", "verify_measure"];
  const PUBLISHED = [...BEFORE_PUBLICATION, "commit_slice_ref"];
  const TRANSITIONED = [...PUBLISHED, "transition"];
  const COMPENSATED = [...TRANSITIONED, "compensate_slice_ref"];

  const assignedUnit = {
    kind: "slice", address: ASSIGNED_UNIT, record_id: "WK-1429", slice_id: "SLICE-004"
  };
  const transitionResult = (overrides) => ({
    valid: true, written: true, no_op: false, selected_unit: assignedUnit, status: "review", ...overrides
  });
  const replayed = () => publishedExactSliceAdvance({
    commit: EXISTING_DELIVERY, idempotent: true, ref_advanced: false
  });
  const thrown = (message, fields = {}, nested = null) => Object.assign(
    nested === null ? new Error(message) : new Error(message, { cause: nested }),
    fields
  );
  const transitionThrow = () => thrown(
    "transition cause marker",
    { code: "work_record.write_failed.v1" },
    thrown("nested transition cause marker", { code: "E_TRANSITION_NESTED" })
  );

  async function deliver(t, overrides) {
    const binding = exactSliceBinding({ output_branch: SLICE_REF });
    installIdentityStoreEnv(t, binding);
    const state = installState({ binding, advanced: publishedExactSliceAdvance(), ...overrides });
    const result = await (await registerCommitTool(t)).handler({});
    const ops = state.calls.map((call) => call.op);
    return { result, payload: result.structuredContent, state, ops };
  }

  function assertEffects(payload, { committed, commitObject, deliveryRef, submitted }) {
    assert.equal(payload.committed, committed);
    assert.equal(payload.commit_object, commitObject);
    assert.equal(payload.delivery_ref, deliveryRef);
    assert.equal(payload.submitted_for_review, submitted);
  }

  function assertIdentities(transaction, expected) {
    assert.equal(transaction.schema_version, "workspace-exact-slice-commit-transaction.v1");
    assert.deepEqual({
      ref: transaction.ref,
      base_sha: transaction.base_sha,
      delivered_tree: transaction.delivered_tree,
      candidate_commit: transaction.candidate_commit,
      delivery_commit: transaction.delivery_commit,
      prior_tip: transaction.prior_tip,
      attempted_commit: transaction.attempted_commit,
      published_commit: transaction.published_commit,
      observed_tip: transaction.observed_tip
    }, {
      ref: SLICE_REF,
      base_sha: BASE_SHA,
      delivered_tree: TREE_SHA,
      candidate_commit: CANDIDATE,
      delivery_commit: CANDIDATE,
      prior_tip: BASE_SHA,
      attempted_commit: CANDIDATE,
      published_commit: CANDIDATE,
      observed_tip: null,
      ...expected
    });
  }

  function assertRawTransition(transaction, { state, written, no_op: noOp, status, valid }) {
    assert.deepEqual({
      state: transaction.canonical_review.state,
      valid: transaction.canonical_review.valid,
      written: transaction.canonical_review.written,
      no_op: transaction.canonical_review.no_op,
      status: transaction.canonical_review.status
    }, { state, valid, written, no_op: noOp, status });
  }

  function assertExactCompensation(state) {
    const calls = state.calls.filter((call) => call.op === "compensate_slice_ref");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.sliceRef, SLICE_REF);
    assert.equal(calls[0].args.publishedCommit, CANDIDATE);
    assert.equal(calls[0].args.priorTip, BASE_SHA);
  }

  await t.test("successful publication and submission", async (t) => {
    const { payload, ops } = await deliver(t, {});
    assertEffects(payload, {
      committed: true, commitObject: "created", deliveryRef: "advanced", submitted: true
    });
    assert.equal(payload.commit, CANDIDATE);
    assertIdentities(payload.transaction, {});
    assertRawTransition(payload.transaction, {
      state: "review", valid: true, written: true, no_op: false, status: "review"
    });
    assert.deepEqual(payload.transaction.compensation, { state: "not_required" });
    assert.deepEqual(ops, TRANSITIONED);
  });

  await t.test("already-review no-op", async (t) => {
    const { payload, ops } = await deliver(t, {
      transitionResult: transitionResult({ written: false, no_op: true })
    });
    assertEffects(payload, {
      committed: true, commitObject: "created", deliveryRef: "advanced", submitted: true
    });
    assertRawTransition(payload.transaction, {
      state: "review", valid: true, written: false, no_op: true, status: "review"
    });
    assert.deepEqual(ops, TRANSITIONED);
  });

  await t.test("explicit no-write refusal", async (t) => {
    const { payload, state, ops } = await deliver(t, {
      transitionResult: transitionResult({ valid: false, written: false, status: "doing" })
    });
    assertEffects(payload, {
      committed: false, commitObject: "created", deliveryRef: "restored", submitted: false
    });
    assert.equal(payload.written, false);
    assert.equal(payload.decision_code, "commit.review_transition_failed_compensated.v1");
    assert.equal(payload.transaction.canonical_review.decision_code, TRANSITION_INVALID);
    assertRawTransition(payload.transaction, {
      state: "invalid", valid: false, written: false, no_op: false, status: "doing"
    });
    assertIdentities(payload.transaction, {});
    assertExactCompensation(state);
    assert.deepEqual(ops, COMPENSATED);
  });

  await t.test("invalid result", async (t) => {
    const { payload, ops } = await deliver(t, { transitionResult: null });
    assertEffects(payload, {
      committed: false, commitObject: "created", deliveryRef: "restored", submitted: null
    });
    assert.equal(payload.written, null);
    assert.equal(payload.transaction.canonical_review.decision_code, TRANSITION_INVALID);
    assert.equal(payload.transaction.canonical_review.reason, "transition_result_not_object");
    assertRawTransition(payload.transaction, {
      state: "invalid", valid: null, written: null, no_op: null, status: null
    });
    assert.deepEqual(ops, COMPENSATED);
  });

  await t.test("wrong-unit result", async (t) => {
    const { payload, ops } = await deliver(t, {
      transitionResult: transitionResult({
        selected_unit: { ...assignedUnit, address: "WK-1429#SLICE-005", slice_id: "SLICE-005" }
      })
    });

    assertEffects(payload, {
      committed: false, commitObject: "created", deliveryRef: "restored", submitted: null
    });
    assert.equal(payload.transaction.canonical_review.decision_code, TRANSITION_WRONG_UNIT);
    assertRawTransition(payload.transaction, {
      state: "invalid", valid: true, written: true, no_op: false, status: "review"
    });
    assert.deepEqual(ops, COMPENSATED);
  });

  await t.test("unknown canonical write survives a successful restoration", async (t) => {
    const { payload, state, ops } = await deliver(t, {
      transitionResult: transitionResult({
        valid: false, written: null, status: null, publication_state: "unknown"
      })
    });
    assertEffects(payload, {
      committed: false, commitObject: "created", deliveryRef: "restored", submitted: null
    });
    assert.equal(payload.written, null);
    assert.equal(payload.decision_code, "commit.review_transition_failed_compensated.v1");
    assertRawTransition(payload.transaction, {
      state: "invalid", valid: false, written: null, no_op: false, status: null
    });
    assert.deepEqual(payload.transaction.compensation, {
      state: "restored", ref: SLICE_REF, published_commit: CANDIDATE, restored_tip: BASE_SHA
    });
    assertExactCompensation(state);
    assert.deepEqual(ops, COMPENSATED);
  });

  await t.test("thrown transition", async (t) => {
    const { payload, state, ops } = await deliver(t, { transitionError: transitionThrow() });
    assertEffects(payload, {
      committed: false, commitObject: "created", deliveryRef: "restored", submitted: null
    });
    const review = payload.transaction.canonical_review;
    assert.equal(review.state, "threw");
    assert.equal(review.decision_code, "work_record.write_failed.v1");
    assert.deepEqual(review.diagnostic_serialization, { state: "complete" });
    assert.equal(review.cause.message, "transition cause marker");
    assert.equal(review.cause.cause.message, "nested transition cause marker");
    assert.equal(review.cause.cause.code, "E_TRANSITION_NESTED");
    assertIdentities(payload.transaction, {});
    assertExactCompensation(state);
    assert.deepEqual(ops, COMPENSATED);
  });

  await t.test("concurrent-tip compensation failure", async (t) => {
    const { payload, state, ops } = await deliver(t, {
      transitionError: transitionThrow(),
      compensationError: thrown(
        "compensation cause marker",
        { code: COMPENSATION_CAS_LOST, detail: { observed_tip: CONCURRENT_TIP } },
        thrown("nested compensation cause marker")
      )
    });
    assertEffects(payload, {
      committed: false, commitObject: "created", deliveryRef: "unknown", submitted: null
    });
    assert.equal(payload.decision_code, "commit.exact_slice_transaction_partial.v1");
    assertIdentities(payload.transaction, { observed_tip: CONCURRENT_TIP });
    const { canonical_review: review, compensation } = payload.transaction;
    assert.equal(compensation.state, "failed");
    assert.equal(compensation.decision_code, COMPENSATION_CAS_LOST);
    assert.equal(compensation.observed_tip, CONCURRENT_TIP);
    assert.equal(compensation.published_commit, CANDIDATE);
    assert.equal(compensation.prior_tip, BASE_SHA);
    assert.deepEqual(compensation.diagnostic_serialization, { state: "complete" });
    assert.equal(compensation.cause.message, "compensation cause marker");
    assert.equal(compensation.cause.detail.observed_tip, CONCURRENT_TIP);
    assert.equal(compensation.cause.cause.message, "nested compensation cause marker");
    assert.equal(review.cause.message, "transition cause marker");
    assert.equal(review.cause.cause.message, "nested transition cause marker");
    assertExactCompensation(state);
    assert.deepEqual(ops, COMPENSATED);
  });

  await t.test("equivalent replay with successful transition", async (t) => {
    const { payload, ops } = await deliver(t, { advanced: replayed() });
    assertEffects(payload, {
      committed: true, commitObject: "created", deliveryRef: "unchanged", submitted: true
    });

    assert.equal(payload.commit, EXISTING_DELIVERY);
    assert.equal(payload.idempotent, true);
    assertIdentities(payload.transaction, {
      delivery_commit: EXISTING_DELIVERY, published_commit: null
    });
    assert.deepEqual(ops, TRANSITIONED);
  });

  await t.test("equivalent replay with failed transition", async (t) => {
    const { payload, ops } = await deliver(t, {
      advanced: replayed(),
      transitionError: transitionThrow()
    });
    assertEffects(payload, {
      committed: false, commitObject: "created", deliveryRef: "unchanged", submitted: null
    });
    assert.equal(payload.decision_code, "commit.review_transition_failed_unpublished.v1");
    assertIdentities(payload.transaction, {
      delivery_commit: EXISTING_DELIVERY, published_commit: null
    });
    assert.equal(payload.transaction.canonical_review.cause.message, "transition cause marker");
    assert.deepEqual(payload.transaction.compensation, { state: "not_required" });

    assert.deepEqual(ops, TRANSITIONED);
  });

  const unpublished = {
    delivery_commit: null, prior_tip: null, published_commit: null
  };
  const publicationFailures = [
    ["known publication conflict", thrown("publication conflict marker", {
      code: CONFLICT,
      detail: { ref: SLICE_REF, base_sha: BASE_SHA, tree: TREE_SHA, observed_tip: CONCURRENT_TIP }
    }), "unchanged", CONCURRENT_TIP],
    ["pre-CAS read failure", thrown("pre-CAS read marker", {
      code: READ_INDETERMINATE,
      detail: { ref: SLICE_REF, base_sha: BASE_SHA }
    }, thrown("nested ref-store marker")), "unchanged", null],
    ["indeterminate post-CAS reread", thrown("post-CAS reread marker", {
      code: READ_INDETERMINATE,
      detail: { ref: SLICE_REF, base_sha: BASE_SHA, attempted_commit: CANDIDATE }
    }), "unknown", null],
    ["generic publication exception", thrown("generic publication marker"), "unknown", null],
    ["error code without stage evidence", thrown("bare conflict code marker", {
      code: CONFLICT
    }), "unknown", null]
  ];
  for (const [name, publicationError, deliveryRef, observedTip] of publicationFailures) {
    await t.test(name, async (t) => {
      const { result, payload, ops } = await deliver(t, { publicationError });
      assert.equal(result.isError, true);
      assert.equal(payload.stage, "publication");
      assert.equal(payload.code, publicationError.code ?? null);
      assertEffects(payload, {
        committed: false, commitObject: "created", deliveryRef, submitted: false
      });
      assertIdentities(payload.transaction, { ...unpublished, observed_tip: observedTip });
      assert.deepEqual(payload.diagnostic_serialization, { state: "complete" });
      assert.equal(payload.cause.message, publicationError.message);
      if (publicationError.cause) {
        assert.equal(payload.cause.cause.message, publicationError.cause.message);
      }
      assert.equal(payload.transaction.canonical_review.state, "not_attempted");
      assert.deepEqual(payload.transaction.compensation, { state: "not_required" });

      assert.deepEqual(ops, PUBLISHED);
    });
  }

  await t.test("scope-verification exception after candidate creation", async (t) => {
    const { result, payload, ops } = await deliver(t, {
      scopeError: thrown("scope verification marker", { code: "E_SCOPE" })
    });
    assert.equal(result.isError, true);
    assert.equal(payload.stage, "scope_verification");
    assert.equal(payload.code, "E_SCOPE");
    assertEffects(payload, {
      committed: false, commitObject: "created", deliveryRef: "unchanged", submitted: false
    });
    assertIdentities(payload.transaction, { ...unpublished, attempted_commit: null });
    assert.equal(payload.cause.message, "scope verification marker");
    assert.deepEqual(ops, BEFORE_PUBLICATION);
  });

  await t.test("materialization exception leaves the commit object unknown", async (t) => {
    const { result, payload, ops } = await deliver(t, {
      materializationError: thrown("materialization marker")
    });
    assert.equal(result.isError, true);
    assert.equal(payload.stage, "materialization");
    assertEffects(payload, {
      committed: false, commitObject: "unknown", deliveryRef: "unchanged", submitted: false
    });
    assert.equal(payload.transaction.ref, SLICE_REF);
    assert.equal(payload.transaction.candidate_commit, null);
    assert.equal(payload.cause.message, "materialization marker");
    assert.deepEqual(ops, ["resolve_binding", "materialize"]);
  });

  await t.test("independent diagnostic serialization failures", async (t) => {

    const unserializable = (message, fields = {}) => thrown(message, { ...fields, opaque: new Map() });
    const compensationFields = {
      code: COMPENSATION_CAS_LOST, detail: { observed_tip: CONCURRENT_TIP }
    };

    await t.test("transition cause", async (t) => {
      const { payload, ops } = await deliver(t, {
        transitionError: unserializable("unserializable transition marker"),
        compensationError: thrown("compensation cause marker", compensationFields)
      });
      const { canonical_review: review, compensation } = payload.transaction;
      assert.equal(review.cause, null);
      assert.equal(review.diagnostic_serialization.state, "failed");
      assert.match(
        review.diagnostic_serialization.cause.message,
        /^workspace_commit\.canonical_review\.opaque must be a plain object/u
      );
      assert.deepEqual(compensation.diagnostic_serialization, { state: "complete" });
      assert.equal(compensation.cause.message, "compensation cause marker");
      assert.deepEqual(ops, COMPENSATED);
    });

    await t.test("compensation cause", async (t) => {
      const { payload, ops } = await deliver(t, {
        transitionError: transitionThrow(),
        compensationError: unserializable("unserializable compensation marker", compensationFields)
      });
      const { canonical_review: review, compensation } = payload.transaction;
      assert.equal(compensation.cause, null);
      assert.equal(compensation.diagnostic_serialization.state, "failed");
      assert.match(
        compensation.diagnostic_serialization.cause.message,
        /^workspace_commit\.compensation\.opaque must be a plain object/u
      );

      assert.equal(compensation.observed_tip, CONCURRENT_TIP);
      assert.equal(payload.transaction.observed_tip, CONCURRENT_TIP);
      assert.deepEqual(review.diagnostic_serialization, { state: "complete" });
      assert.equal(review.cause.message, "transition cause marker");
      assert.deepEqual(ops, COMPENSATED);
    });
  });
});
