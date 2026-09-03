import assert from "node:assert/strict";
import test from "node:test";

import { finalizeAdvisoryProcessLaunch } from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-advisory-result-settlement.mjs";

function structuredText() {
  return JSON.stringify({
    schema_version: "agent-role-result.v1",
    reported_role: "reviewer",
    reported_subject: "WK-2405",
    reported_outcome: "no_findings",
    summary: "No findings.",
    findings: [],
    finding_counts: {
      total: 0, blocking: 0, critical: 0, high: 0, medium: 0,
      low: 0, info: 0
    },
    reviewed_controls: [{ control_id: "wk-2405-cutover", result: "pass" }]
  });
}

async function settle({
  text = null,
  status = "succeeded",
  formalResultContract = null,
  settle
}) {
  return await finalizeAdvisoryProcessLaunch({
    executorResult: {
      accepted: true,
      status,
      exit: { code: status === "succeeded" ? 0 : 1, signal: null },
      final_result: text === null ? null : {
        kind: "no_findings",
        no_findings: { reason: "captured" },
        full_response: { format: "markdown", text }
      }
    },
    runs: new Map(),
    settleFormalReviewAttestation: settle,
    run_id: "run-advisory-settlement",
    monitor_handle: "monitor-advisory-settlement",
    app: "codex",
    resolvedModel: "gpt-5.6-sol",
    resolvedBackend: "codex-in-process",
    role: "reviewer",
    subject: "WK-2405",
    workspace_alias: "agent-chassis",
    caller_session_id: "session-advisory-settlement",
    startedAt: "2026-09-01T00:00:00.000Z",
    advisoryReviewInput: { formal_result_contract: formalResultContract }
  });
}

function advisory(result) {
  return result.final_result.advisory_review;
}

function assertAdvisoryOnly(result) {
  assert.equal(advisory(result).authority, "advisory_only");
  assert.deepEqual(Object.keys(advisory(result)).sort(), [
    "advisory_output",
    "authority",
    "execution_status",
    "formal_attestation",
    "kind",
    "schema_observation"
  ]);
}

test("ordinary advisory settlement keeps schema-invalid text usable and never attests", async () => {
  let calls = 0;
  const result = await settle({
    text: "Unstructured but useful reviewer text.",
    settle: async () => { calls += 1; }
  });
  assert.equal(calls, 0);
  assert.equal(result.final_result.advisory_review.advisory_output.available, true);
  assert.equal(result.final_result.advisory_review.advisory_output.usable, true);
  assert.equal(result.final_result.advisory_review.schema_observation.adherent, false);
  assert.deepEqual(result.final_result.advisory_review.formal_attestation, {
    requested: false, available: false, reason: "not_requested"
  });
  assertAdvisoryOnly(result);
});

test("complete clean, severe, and schema-invalid advisory text is retained", async () => {
  const cases = [
    "No findings. The complete reviewed range is clean.",
    "Critical: authorization can cross the declared boundary.\nHigh: stop publication.",
    "{ schema-invalid but still useful reviewer text"
  ];
  for (const text of cases) {
    const result = await settle({ text });
    assert.equal(result.final_result.full_response.text, text);
    assert.deepEqual(advisory(result).advisory_output, {
      available: true,
      usable: true,
      text
    });
    assertAdvisoryOnly(result);
  }
});

test("absent output is reported without inventing advisory text", async () => {
  const result = await settle({ text: null });
  assert.deepEqual(advisory(result).advisory_output, {
    available: false,
    usable: false
  });
  assert.equal(Object.hasOwn(advisory(result).advisory_output, "text"), false);
  assertAdvisoryOnly(result);
});

test("failed execution retains captured advisory text", async () => {
  const text = "Medium: execution failed after this complete observation was captured.";
  const result = await settle({ text, status: "failed" });
  assert.equal(advisory(result).execution_status, "failed");
  assert.deepEqual(advisory(result).advisory_output, {
    available: true,
    usable: true,
    text
  });
  assertAdvisoryOnly(result);
});

test("schema-constrained advisory settlement derives formal attestation exactly once", async () => {
  let calls = 0;
  const result = await settle({
    text: structuredText(),
    formalResultContract: Object.freeze({ mode: "schema_constrained" }),
    settle: async ({ record, formalResult }) => {
      calls += 1;
      assert.equal(record.run_id, "run-advisory-settlement");
      assert.equal(formalResult.reported_outcome, "no_findings");
      return Object.freeze({
        available: true,
        reason: "derived_and_published_during_original_settlement",
        attestation_id: "attestation-wk-2405"
      });
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.final_result.advisory_review.formal_attestation, {
    requested: true,
    available: true,
    reason: "derived_and_published_during_original_settlement",
    attestation_id: "attestation-wk-2405"
  });
  assertAdvisoryOnly(result);
});

test("every advisory result shape has the same automatic authority posture", async () => {
  const results = await Promise.all([
    settle({ text: "No findings." }),
    settle({ text: "Critical: boundary violation." }),
    settle({ text: "schema-invalid advisory" }),
    settle({ text: null }),
    settle({ text: "captured before failure", status: "failed" })
  ]);
  assert.deepEqual(results.map((result) => advisory(result).authority),
    Array(results.length).fill("advisory_only"));
  for (const result of results) assertAdvisoryOnly(result);
});
