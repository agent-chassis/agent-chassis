import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkRecordDispatch } from "../../packages/wiki-core/src/index.mjs";
import {
  NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE
} from "../../packages/wiki-core/src/lib/work-record-dispatch.mjs";
import { createCompactValidateDispatchResponse } from
  "../../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";
import {
  withTempRepo,
  makeNodeEnginePackResponse,
  packBackedEnvelope,
  countingFetch,
  completeNodeEngineEnv,
  buildAdmissionGateRecord,
  installAdmissionGateRecord,
  WORKSPACE_REPO,
  REQUEST_CONTRACT_DIGEST_ENV,
  BOUNDED_ADMISSIBILITY_KEYS,
  leakyProblemBody,
  FORBIDDEN_SUBSTRINGS,
  FORBIDDEN_PROBLEM_FIELD_NAMES,
  assertNoSecretLeak,
  PROBLEM_CASES,
  driveProblemReadiness,
  syntheticUndeterminedReadiness,
  packBackedEnvelopeWithoutReasons,
  driveNeedsReviewReadiness,
  assertNeedsReviewPublicOverlay,
  assertNeedsReviewPublicResponse,
  assertNoRawValueLeakAnywhere,
  GENERIC_DEFAULT_NEXT_ACTION_PATTERN,
  syntheticFailClosedReadiness,
  FAIL_CLOSED_CASES,
} from "../helpers/validate-dispatch-diagnostic-fixture.mjs";

for (const problemCase of PROBLEM_CASES) {
  test(`workspace_validate_dispatch compact surfaces operator next_action for ${problemCase.label}`, async () => {
    await withTempRepo(async (tempDir) => {
      const readiness = await driveProblemReadiness(tempDir, problemCase.problemType);

      assert.equal(readiness.dispatchable, false);
      assert.equal(readiness.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
      assert.equal(readiness.structural_readiness.dispatchable, true);
      assert.equal(readiness.admissibility.status, "undetermined");
      assert.equal(readiness.admissibility.admissible, false);
      assert.equal(readiness.admissibility.binding_status, "node_engine_unratified_placeholder");
      assert.equal(readiness.admissibility.ratified, false);

      assert.equal(readiness.admissibility.diagnostic_code, problemCase.expectedDiagnosticCode);

      const compact = createCompactValidateDispatchResponse(WORKSPACE_REPO, readiness);

      assert.equal(typeof compact.next_action, "string");
      problemCase.assertNextAction(compact.next_action);

      assert.equal(compact.admissibility.diagnostic_code, problemCase.expectedDiagnosticCode);
      assert.deepEqual(Object.keys(compact.admissibility).sort(), [...BOUNDED_ADMISSIBILITY_KEYS]);
      assert.equal(
        typeof compact.admissibility.authenticated_request_sent,
        "boolean",
        "authenticated_request_sent must remain bounded boolean metadata"
      );

      assertNoSecretLeak(compact, `compact ${problemCase.label}`);

    });
  });
}

test("worker-admission problem classes preserve DISTINCT bounded diagnostics under one shared decision_code", async () => {
  await withTempRepo(async (tempDir) => {
    const diagnostics = [];
    for (const problemCase of PROBLEM_CASES) {
      const readiness = await driveProblemReadiness(tempDir, problemCase.problemType);

      assert.equal(readiness.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
      diagnostics.push(readiness.admissibility.diagnostic_code);
    }

    assert.equal(new Set(diagnostics).size, PROBLEM_CASES.length, "each problem class must carry a distinct diagnostic_code");
  });
});

test("compact next_action is keyed from admissibility.diagnostic_code, not the shared decision_code", () => {
  const packInputRequired = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_pack_input_required")
  );
  const packInputInvalid = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_pack_input_invalid")
  );
  const digestMismatch = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_request_schema_digest_mismatch")
  );
  const graphTooLarge = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_precondition_graph_too_large")
  );
  const nonObjectData = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_non_object_data")
  );

  assert.equal(packInputRequired.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
  assert.equal(packInputInvalid.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
  assert.equal(digestMismatch.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
  assert.equal(graphTooLarge.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
  assert.equal(nonObjectData.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);

  const actions = new Set([
    packInputRequired.next_action,
    packInputInvalid.next_action,
    digestMismatch.next_action,
    graphTooLarge.next_action,
    nonObjectData.next_action
  ]);
  assert.equal(actions.size, 5, "distinct diagnostics under one decision_code must yield distinct next_action");

  assert.match(packInputRequired.next_action, /missing/i);
  assert.match(packInputRequired.next_action, /(carrier|profile|pack[ -]?input)/i);
  assert.match(packInputInvalid.next_action, /(present|malformed|digest[ -]?vector|schema|conformance[ -]?failed)/i);
  assert.notEqual(
    packInputRequired.next_action,
    packInputInvalid.next_action,
    "pack_input_required and pack_input_invalid must not share generic policy-profile/digest-vector remediation"
  );
  assert.ok(digestMismatch.next_action.includes(REQUEST_CONTRACT_DIGEST_ENV));
  assert.match(graphTooLarge.next_action, /graph/i);
  assert.match(nonObjectData.next_action, /(malformed|non[ -]?object)/i);
  assert.match(nonObjectData.next_action, /data envelope/i);
});

test("compact next_action is deterministic for a given admissibility.diagnostic_code", () => {
  const first = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_request_schema_digest_mismatch")
  );
  const second = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticUndeterminedReadiness("node_engine_request_schema_digest_mismatch")
  );
  assert.equal(first.next_action, second.next_action);
});

test("needs_review next_action surfaces the consolidated WK-1031#SLICE-087 review-required recovery", async () => {
  await withTempRepo(async (tempDir) => {
    const record = buildAdmissionGateRecord("WK-9970", [
      "packages/wiki-core/src/lib/admission-gate-clean.mjs"
    ]);
    await installAdmissionGateRecord(tempDir, record);

    const fetchImpl = countingFetch(makeNodeEnginePackResponse(200, packBackedEnvelope("needs_review", [
      { code: "review_threshold_exceeded", field: "write_scope_total_loc", observed: 222, threshold: 200 }
    ])));
    const readiness = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: "WK-9970",
      node_engine_admissibility: { env: completeNodeEngineEnv(), fetchImpl }
    });

    assert.equal(readiness.decision_code, NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE);
    assert.equal(readiness.admissibility.status, "needs_review");
    assert.equal(readiness.admissibility.diagnostic_code, "node_engine_needs_review");

    const compact = createCompactValidateDispatchResponse(WORKSPACE_REPO, readiness);
    assert.equal(compact.dispatchable, false);
    assert.equal(compact.admissibility.recovery_validation.state, "valid");

    assert.equal(typeof compact.next_action, "string");
    assert.doesNotMatch(
      compact.next_action,
      GENERIC_DEFAULT_NEXT_ACTION_PATTERN,
      "needs_review next_action must not fall to the generic \"Resolve blocking issue\" default"
    );

    assert.match(
      compact.next_action,
      /(reduc|split|narrow)/i,
      "needs_review next_action must surface the reduce/split/narrow recovery actions"
    );
    assert.match(
      compact.next_action,
      /workspace_agent_dispatch/,
      "needs_review next_action must surface the sole review route"
    );

    assert.match(compact.next_action, /dispatch-and-validation\.md/);
    assert.doesNotMatch(
      compact.next_action,
      /\bWK-\d{4}/,
      "needs_review next_action must not carry work-record provenance"
    );
    assert.match(
      compact.next_action,
      /Review-required \(needs_review\) remediation contract/,
      "needs_review next_action must reference the dispatch-and-validation.md remediation contract"
    );

    assert.match(
      compact.next_action,
      /non-?launchable/i,
      "needs_review next_action must keep the result non-launchable"
    );
    assert.doesNotMatch(
      compact.next_action,
      /(admit locally|local[ -]?admit|fail[ -]?open)/i,
      "needs_review next_action must not imply local admit (no A4 fail-open)"
    );
    assert.doesNotMatch(
      compact.next_action,
      /(reviewer|redteam)/i,
      "needs_review next_action must be role-agnostic (DEC-0112, no reviewer-vs-redteam split)"
    );

    assert.ok(
      !compact.next_action.includes(REQUEST_CONTRACT_DIGEST_ENV),
      "needs_review next_action must not borrow the request-contract digest remediation"
    );
    assert.doesNotMatch(compact.next_action, /policy[ -]?profile/i, "needs_review next_action must not borrow policy-profile remediation");
    assert.doesNotMatch(compact.next_action, /dependency graph/i, "needs_review next_action must not borrow dependency-graph remediation");
    assert.doesNotMatch(compact.next_action, /data envelope/i, "needs_review next_action must not borrow non-object-data remediation");
    assert.doesNotMatch(compact.next_action, /(malformed|digest[ -]?vector|conformance[ -]?failed)/i, "needs_review next_action must not borrow problem-class remediation");

    assertNoSecretLeak(compact, "compact needs_review");
  });
});

test("WK-1309 MCP needs_review with missing or empty pack reasons fails closed as a malformed decision envelope", async (t) => {
  const cases = [
    ["missing reasons array", packBackedEnvelopeWithoutReasons("needs_review")],
    ["empty reasons array", packBackedEnvelope("needs_review", [])]
  ];

  for (const [name, body] of cases) {
    await t.test(name, async () => {
      const readiness = await driveNeedsReviewReadiness(body);

      assert.equal(readiness.dispatchable, false);
      assert.equal(readiness.decision_code, NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE);
      assert.equal(readiness.admissibility.status, "undetermined");
      assert.equal(readiness.admissibility.admissible, false);
      assert.equal(readiness.admissibility.diagnostic_code, "node_engine_decision_envelope_malformed");
      assert.equal(readiness.admissibility.exact_policy_payload_issue, "decision_reasons_malformed");

      const ordinary = createCompactValidateDispatchResponse(WORKSPACE_REPO, readiness);
      assert.equal(ordinary.dispatchable, false);
      assert.equal(ordinary.admissibility.status, "undetermined");
      assert.equal(ordinary.admissibility.needs_review_recovery, undefined);
      assert.doesNotMatch(ordinary.next_action, /Dispatch .* via workspace_agent_dispatch/);
      assertNoSecretLeak(ordinary, `ordinary ${name} malformed needs_review`);
    });
  }
});

test("WK-1309 MCP needs_review with unrecognized reasons leaks no raw unknown values anywhere public", async () => {
  const rawUnknownCode = "operator_secret_policy.override_all";
  const rawUnknownField = "packages.wiki_core.src.secret_file";
  const rawUnknownObserved = "LEAKY_UNKNOWN_OBSERVED";
  const rawUnknownEvidenceKey = "raw_unknown_reason_evidence";
  const rawUnknownEvidenceValue = "LEAKY_UNKNOWN_REASON_EVIDENCE";
  const secondaryUnknownCode = "another_unrecognized_reason";
  const secondaryUnknownField = "another_unrecognized_field";

  const body = packBackedEnvelope("needs_review", [
    {
      code: rawUnknownCode,
      field: rawUnknownField,
      observed: rawUnknownObserved,
      threshold: 99,
      evidence: { [rawUnknownEvidenceKey]: rawUnknownEvidenceValue }
    },
    { code: secondaryUnknownCode, field: secondaryUnknownField }
  ]);
  const producerRecovery = structuredClone(body.pack_result.recovery);
  const readiness = await driveNeedsReviewReadiness(body);
  const { ordinary, recovery } = assertNeedsReviewPublicResponse(readiness);

  assert.deepEqual(readiness.admissibility.reasons, []);
  assert.deepEqual(ordinary.admissibility.reasons, []);

  assert.deepEqual(recovery.recovery, producerRecovery);

  assertNoRawValueLeakAnywhere(
    { ordinary },
    [rawUnknownObserved, rawUnknownEvidenceKey, rawUnknownEvidenceValue]
  );

  const locallyProjected = structuredClone(ordinary);
  delete locallyProjected.admissibility.recovery_validation;
  delete locallyProjected.admissibility.recovery_diagnostic_carrier;
  assertNoRawValueLeakAnywhere(
    { ordinary: locallyProjected },
    [rawUnknownCode, rawUnknownField, secondaryUnknownCode, secondaryUnknownField]
  );
  assertNoSecretLeak(ordinary, "ordinary unrecognized needs_review recovery");
});

test("WK-1309 MCP needs_review budget and target-plan recovery guidance are both independently visible", async () => {
  const rawUnknownCode = "operator_secret_policy.override_all";
  const rawUnknownField = "unknown_control";
  const rawUnknownObserved = "LEAKY_UNKNOWN_OBSERVED";
  const budgetEvidenceValue = "LEAKY_BUDGET_EVIDENCE";
  const targetEvidenceValue = "LEAKY_TARGET_PLAN_EVIDENCE";

  const controls = ["expected_changed_line_budget", "expected_edit_targets"];
  const producerRecovery = {
    schema_version: "worker_admission.recovery.v1",
    projection_mode: "bounded_current_decision_recovery",
    authority: "advisory_recovery_only",
    requires_resubmission: true,
    truncated: false,
    actions: [{
      kind: "split_or_reduce_scope",
      reason_codes: ["review_threshold_exceeded"],
      fields: controls,
      controls,
      next_action:
        "Reduce expected_changed_line_budget and repair expected_edit_targets, then resubmit."
    }]
  };
  const readiness = await driveNeedsReviewReadiness(
    packBackedEnvelope("needs_review", [
      {
        code: "review_threshold_exceeded",
        field: "expected_changed_line_budget",
        observed: null,
        threshold: 200,
        evidence: { selected_unit_budget: budgetEvidenceValue }
      },
      {
        code: "review_threshold_exceeded",
        field: "expected_edit_targets",
        observed: 0,
        threshold: 1,
        evidence: { target_resolution: targetEvidenceValue }
      },
      {
        code: rawUnknownCode,
        field: rawUnknownField,
        observed: rawUnknownObserved
      }
    ], { recovery: producerRecovery })
  );

  const { ordinary, recovery } = assertNeedsReviewPublicResponse(readiness);
  assert.deepEqual(
    ordinary.admissibility.reasons.map((reason) => reason.field),
    controls
  );
  assert.deepEqual(recovery.recovery, producerRecovery);
  assert.equal(recovery.recovery.projection_mode, "bounded_current_decision_recovery");
  assert.deepEqual([...recovery.recovery.actions[0].controls].sort(), controls);
  assert.match(recovery.recovery.actions[0].next_action, /expected_changed_line_budget/);
  assert.match(recovery.recovery.actions[0].next_action, /expected_edit_targets/);

  assertNoRawValueLeakAnywhere(
    { ordinary },
    [
      rawUnknownCode,
      rawUnknownField,
      rawUnknownObserved,
      budgetEvidenceValue,
      targetEvidenceValue
    ]
  );
  assertNoSecretLeak(ordinary, "ordinary mixed needs_review recovery");
});

for (const failCase of FAIL_CLOSED_CASES) {
  test(`workspace_validate_dispatch compact surfaces actionable next_action for ${failCase.label}`, () => {
    const compact = createCompactValidateDispatchResponse(
      WORKSPACE_REPO,
      syntheticFailClosedReadiness(failCase)
    );

    assert.equal(typeof compact.next_action, "string");
    assert.ok(compact.next_action.length > 0, `${failCase.label} next_action must be non-empty`);

    assert.doesNotMatch(
      compact.next_action,
      GENERIC_DEFAULT_NEXT_ACTION_PATTERN,
      `${failCase.label} next_action must not fall to the generic "Resolve blocking issue" default`
    );
    failCase.assertNextAction(compact.next_action);

    assert.equal(compact.admissibility.diagnostic_code, failCase.diagnosticCode);
    assertNoSecretLeak(compact, `compact ${failCase.label}`);
  });
}

test("fail-closed admissibility dispositions each escape the generic default next_action", () => {
  for (const failCase of FAIL_CLOSED_CASES) {
    const compact = createCompactValidateDispatchResponse(
      WORKSPACE_REPO,
      syntheticFailClosedReadiness(failCase)
    );
    assert.doesNotMatch(
      compact.next_action,
      GENERIC_DEFAULT_NEXT_ACTION_PATTERN,
      `${failCase.label} must surface specific guidance, not the generic default`
    );
  }
});

test("the three not-configured dispositions share one configure-NODE_ENGINE remediation; unratified/unavailable are distinct", () => {
  const byCode = new Map();
  for (const failCase of FAIL_CLOSED_CASES) {
    const compact = createCompactValidateDispatchResponse(
      WORKSPACE_REPO,
      syntheticFailClosedReadiness(failCase)
    );
    byCode.set(failCase.diagnosticCode, compact.next_action);
  }

  assert.equal(
    byCode.get("node_engine_config_unavailable"),
    byCode.get("node_engine_route_unratified")
  );
  assert.equal(
    byCode.get("node_engine_route_unratified"),
    byCode.get("node_engine_request_contract_unbound")
  );

  const unratified = byCode.get("node_engine_admit_unratified");
  const unavailable = byCode.get("node_engine_unavailable");
  const configure = byCode.get("node_engine_config_unavailable");
  assert.equal(new Set([unratified, unavailable, configure]).size, 3, "the three remediation themes must be distinct");
});

test("auth_rejected / entitlement_rejected each surface a remediation distinct from node_engine_unavailable and each other", () => {
  const nextActionFor = (status, decisionCode, diagnosticCode) =>
    createCompactValidateDispatchResponse(
      WORKSPACE_REPO,
      syntheticFailClosedReadiness({ status, decisionCode, diagnosticCode })
    ).next_action;

  const authRejected = nextActionFor(
    "undetermined",
    NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
    "node_engine_auth_rejected"
  );
  const entitlementRejected = nextActionFor(
    "undetermined",
    NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
    "node_engine_entitlement_rejected"
  );
  const unavailable = nextActionFor(
    "unavailable",
    NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
    "node_engine_unavailable"
  );

  for (const [label, action] of [
    ["auth_rejected", authRejected],
    ["entitlement_rejected", entitlementRejected],
    ["unavailable", unavailable]
  ]) {
    assert.doesNotMatch(action, GENERIC_DEFAULT_NEXT_ACTION_PATTERN, `${label} must escape the generic default`);
  }

  assert.equal(
    new Set([authRejected, entitlementRejected, unavailable]).size,
    3,
    "auth_rejected, entitlement_rejected, and node_engine_unavailable must be three distinct remediations"
  );

  assert.ok(authRejected.includes("NODE_ENGINE_API_KEY"), "auth_rejected must name the key to rebind");
  assert.match(authRejected, /re-?bind/i, "auth_rejected must instruct a rebind");
  assert.match(entitlementRejected, /entitlement/i, "entitlement_rejected must reference entitlement");
  assert.match(entitlementRejected, /plan/i, "entitlement_rejected must reference the plan");

  assertNoSecretLeak({ authRejected, entitlementRejected, unavailable }, "auth/entitlement remediations");
});

test("fail-closed next_action is deterministic for a given diagnostic_code", () => {
  const first = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticFailClosedReadiness({
      status: "unratified",
      decisionCode: NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE,
      diagnosticCode: "node_engine_admit_unratified"
    })
  );
  const second = createCompactValidateDispatchResponse(
    WORKSPACE_REPO,
    syntheticFailClosedReadiness({
      status: "unratified",
      decisionCode: NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE,
      diagnosticCode: "node_engine_admit_unratified"
    })
  );
  assert.equal(first.next_action, second.next_action);
});
