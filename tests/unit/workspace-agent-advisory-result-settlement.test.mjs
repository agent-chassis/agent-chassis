import assert from "node:assert/strict";
import test from "node:test";

import {
  STDIO_MCP_CLEANUP_BLOCKER_REASON,
  STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  attachStdioMcpConduitLaunchOutcome,
  buildStdioMcpConduitTerminalProbe,
  describeStdioMcpConduitLaunchFailure,
  readStdioMcpConduitTerminalFailure
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";
import {
  finalizeAdvisoryProcessLaunch,
  resolveManagedFindingsSourceFromRecord,
  settleAndProjectAdvisoryProcess
} from
  "../../packages/agent-launch-cli/src/lib/workspace-agent-advisory-result-settlement.mjs";

function structuredText(overrides = {}) {
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
    reviewed_controls: [{ control_id: "wk-2405-cutover", result: "pass" }],
    ...overrides
  });
}

function capturedFinalResult(text) {
  return {
    kind: "no_findings",
    no_findings: { reason: "captured" },
    full_response: { format: "markdown", text }
  };
}

async function settle({
  text = null,
  status = "succeeded",
  runs = new Map(),
  formalResultContract = null,
  settle
}) {
  return await launchAdvisory({
    executorResult: {
      accepted: true,
      status,
      exit: { code: status === "succeeded" ? 0 : 1, signal: null },
      final_result: text === null ? null : capturedFinalResult(text)
    },
    runs,
    formalResultContract,
    settle
  });
}

async function launchAdvisory({
  executorResult,
  runs = new Map(),
  formalResultContract = null,
  settle
}) {
  return await finalizeAdvisoryProcessLaunch({
    executorResult,
    runs,
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
    assert.equal(advisory(result).advisory_output.available, true);
    assert.equal(advisory(result).advisory_output.usable, true);
    assert.equal(advisory(result).advisory_output.text, text);
    assert.equal(advisory(result).advisory_output.source_reference.source_kind,
      "original_managed_findings");
    assert.equal(advisory(result).advisory_output.source_reference.utf8_bytes,
      Buffer.byteLength(text, "utf8"));
    assert.equal(advisory(result).advisory_output.source_reference.authority, "advisory_only");
    assert.equal(advisory(result).advisory_output.source_reference.attestation, false);
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
  assert.equal(advisory(result).advisory_output.available, true);
  assert.equal(advisory(result).advisory_output.usable, true);
  assert.equal(advisory(result).advisory_output.text, text);
  assert.equal(advisory(result).advisory_output.source_reference.source_kind,
    "original_managed_findings");
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

test("managed findings source refs preserve exact text and distinguish source failures", async () => {
  const text = "CRLF\r\ncombining e\u0301 astral \u{1f680} and \\\"escaping\\\"";
  const settled = await settle({ text });
  const reference = advisory(settled).advisory_output.source_reference.ref;
  const record = { ...settled, workspace_alias: "agent-chassis" };
  const before = structuredClone(record);
  const available = resolveManagedFindingsSourceFromRecord(record, reference, {
    callerSessionId: "session-advisory-settlement",
    repository: "agent-chassis"
  });
  assert.equal(available.ok, true);
  assert.equal(available.text, text);
  assert.equal(available.provenance.run_id, "run-advisory-settlement");
  assert.equal(available.provenance.attestation, false);
  assert.equal(available.provenance.authority, "advisory_only");
  assert.equal(Object.hasOwn(available.provenance, "findings"), false);
  assert.equal(resolveManagedFindingsSourceFromRecord(record, reference, {
    callerSessionId: "another-session", repository: "agent-chassis"
  }).state, "denied");
  assert.equal(resolveManagedFindingsSourceFromRecord({ ...record, run_id: "changed" }, reference, {
    callerSessionId: "session-advisory-settlement", repository: "agent-chassis"
  }).state, "changed");
  assert.equal(resolveManagedFindingsSourceFromRecord({ ...record, final_result: null }, reference, {
    callerSessionId: "session-advisory-settlement", repository: "agent-chassis"
  }).state, "expired");
  assert.equal(resolveManagedFindingsSourceFromRecord(record, `${reference}x`, {
    callerSessionId: "session-advisory-settlement", repository: "agent-chassis"
  }).state, "corrupt");
  for (const key of ["monitor_handle", "subject"]) {
    assert.equal(resolveManagedFindingsSourceFromRecord({ ...record, [key]: "changed" }, reference, {
      callerSessionId: "session-advisory-settlement", repository: "agent-chassis"
    }).state, "changed");
  }
  const changed = structuredClone(record);
  changed.final_result.advisory_review.advisory_output.text += "changed";
  assert.equal(resolveManagedFindingsSourceFromRecord(changed, reference, {
    callerSessionId: "session-advisory-settlement", repository: "agent-chassis"
  }).state, "changed");
  assert.deepEqual(record, before, "source resolution never mutates retained evidence");
});

test("authenticated source findings come only from the exact schema and role/subject checks", async () => {
  const member = { id: "F1", title: "Review e\u0301 \u{1f680}", severity: "low", blocking: false,
    affected_paths: [{ path: "src/example.mjs", line: 1 }], control_id: null };
  const empty = JSON.parse(structuredText());
  const withFindings = { reported_outcome: "passed_no_blocking_or_medium_findings", findings: [member],
    summary: "Captured review observations.",
    finding_counts: { ...empty.finding_counts, total: 1, low: 1 } };
  const options = { callerSessionId: "session-advisory-settlement", repository: "agent-chassis" };
  for (const [payload, expected] of [[withFindings, [member]], [{}, []]]) {
    for (const status of ["succeeded", "failed"]) {
      const text = structuredText(payload);
      const runs = new Map();
      await settle({ text, status, runs });
      const record = runs.get("run-advisory-settlement");
      assert.equal(advisory(record).schema_observation.adherent, true,
        JSON.stringify(advisory(record).schema_observation.diagnostics));
      const output = advisory(record).advisory_output;
      const before = structuredClone(record);
      const source = resolveManagedFindingsSourceFromRecord(record, output.source_reference.ref, options);
      assert.equal(source.ok, true);
      assert.equal(source.text, text);
      assert.deepEqual(source.provenance.findings, expected);
      for (const node of [source.provenance.findings, ...source.provenance.findings.flatMap(finding =>
        [finding, finding.affected_paths, ...finding.affected_paths])]) assert.ok(Object.isFrozen(node));
      for (const key of ["run_id", "monitor_handle", "subject"]) {
        assert.equal(source.provenance[key], record[key]);
      }
      assert.equal(source.provenance.value_digest, output.source_reference.value_digest);
      assert.equal(source.provenance.utf8_bytes, Buffer.byteLength(text, "utf8"));
      assert.equal(source.provenance.authority, "advisory_only");
      assert.equal(source.provenance.attestation, false);
      assert.equal(advisory(record).formal_attestation.requested, false);
      assert.deepEqual(record, before);
    }
  }
  for (const text of [
    structuredText({ ...withFindings, reported_role: "redteam" }),
    structuredText({ ...withFindings, reported_subject: "WK-9999" }),
    '{"schema_version":"agent-role-result.v1","findings":[]}',
    structuredText({ ...withFindings, finding_counts: empty.finding_counts }),
    structuredText({ ...withFindings, findings: [member, member],
      finding_counts: { ...empty.finding_counts, total: 2, low: 2 } })
  ]) {
    const runs = new Map();
    await settle({ text, runs });
    const record = structuredClone(runs.get("run-advisory-settlement"));
    record.final_result.advisory_review.schema_observation.adherent = true;
    const before = structuredClone(record);
    const output = advisory(record).advisory_output;
    const source = resolveManagedFindingsSourceFromRecord(record, output.source_reference.ref, options);
    assert.equal(source.ok, true);
    assert.equal(source.text, text);
    assert.equal(output.usable, true);
    assert.equal(Object.hasOwn(source.provenance, "findings"), false);
    assert.equal(source.provenance.authority, "advisory_only");
    assert.equal(source.provenance.attestation, false);
    assert.deepEqual(record, before, "persisted schema flags neither authenticate IDs nor change reads");
  }
});

const POLL_CLOCK = () => Date.parse("2026-09-01T00:00:05.000Z");

function typedConduitError(code, detail) {
  return Object.assign(new Error("stdio MCP conduit failure"), { code, detail });
}

function readinessTimeout() {
  return typedConduitError(STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT,
    { timeout_ms: 180_000, initialized: false });
}

function cleanupFailed() {
  return typedConduitError(STDIO_MCP_CONDUIT_ERROR_CODES.CLEANUP_FAILED,
    { failures: [{ resource: "conduit-directory", code: "EBUSY" }] });
}

function healthyConduit() {
  return { runId: "stdio-mcp-advisory", readinessFailure: null, cleanupFailure: null };
}

function scriptedChild(observations) {
  const queue = [...observations];
  let probes = 0;
  let complete;
  const completion = new Promise((resolve) => { complete = resolve; });
  const exit = () => {
    queue.splice(0, queue.length - 1);
    complete();
  };
  if (queue.length === 1) exit();
  return {
    handle: {
      accepted: true,
      status: "launching",
      completion,
      probe: async () => {
        probes += 1;
        return queue[0];
      }
    },
    probes: () => probes,
    exit
  };
}

async function launchWithConduit(conduit, observations) {
  const runs = new Map();
  const child = scriptedChild(observations);
  const launched = await launchAdvisory({
    executorResult: attachStdioMcpConduitLaunchOutcome(child.handle, conduit),
    runs
  });
  return { launched, record: runs.get(launched.run_id), child };
}

function poll(record) {
  return settleAndProjectAdvisoryProcess(record, { clock: POLL_CLOCK });
}

function expectedCarrier(conduit, observed) {
  return readStdioMcpConduitTerminalFailure(
    buildStdioMcpConduitTerminalProbe(describeStdioMcpConduitLaunchFailure(conduit), observed));
}

const RUNNING = Object.freeze({ status: "running", exit: null, final_result: null });
const KILLED_WITHOUT_OUTPUT = Object.freeze({
  status: "failed",
  exit: Object.freeze({ code: null, signal: "SIGKILL" }),
  final_result: null
});

test("initially terminal launch keeps the typed conduit carrier through later status", async () => {
  const conduit = { ...healthyConduit(), readinessFailure: readinessTimeout() };
  const probe = buildStdioMcpConduitTerminalProbe(
    describeStdioMcpConduitLaunchFailure(conduit), KILLED_WITHOUT_OUTPUT);
  const runs = new Map();
  const launched = await launchAdvisory({ executorResult: probe, runs });

  assert.equal(launched.terminal, true);
  assert.equal(launched.status, "failed");
  const carrier = readStdioMcpConduitTerminalFailure(probe);
  assert.deepEqual(launched.exit, { code: null, signal: "SIGKILL", conduit_failure: carrier });
  assert.equal(launched.exit.conduit_failure.reason, STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON);
  assert.equal(launched.exit.conduit_failure.detail.conduit_error_code,
    STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT);
  assert.equal(launched.exit.conduit_failure.cleanup_only, false);
  assert.equal(launched.final_result.missing_result.reason, "advisory_output_not_captured");
  assert.deepEqual(advisory(launched).advisory_output, { available: false, usable: false });

  const record = runs.get(launched.run_id);
  const first = await poll(record);
  const second = await poll(record);
  assert.deepEqual(first.exit, launched.exit);
  assert.deepEqual(second.exit, launched.exit);
});

test("a conduit failure discovered while polling survives zero-output settlement and repeated observation", async () => {
  const conduit = healthyConduit();
  const { launched, record, child } = await launchWithConduit(conduit,
    [RUNNING, KILLED_WITHOUT_OUTPUT]);
  assert.equal(launched.terminal, false);
  assert.equal(launched.exit, null);

  const running = await poll(record);
  assert.equal(running.terminal, false);
  assert.equal(running.exit, null, "no diagnostic exists before the failure");

  let completed = false;
  child.handle.completion.then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false, "a live child's completion is still pending");
  child.exit();
  assert.equal(await child.handle.completion, undefined);
  assert.equal(child.probes(), 1, "exit and awaiting completion do not probe");

  conduit.readinessFailure = readinessTimeout();
  const terminal = await poll(record);
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.status, "failed");
  assert.deepEqual(terminal.exit, {
    code: null,
    signal: "SIGKILL",
    conduit_failure: expectedCarrier(conduit, KILLED_WITHOUT_OUTPUT)
  });
  assert.equal(terminal.exit.conduit_failure.reason, STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON);
  assert.equal(terminal.exit.conduit_failure.detail.conduit_error_code,
    STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT);
  assert.equal(terminal.final_result.missing_result.reason, "advisory_output_not_captured");
  assert.deepEqual(terminal.final_result.advisory_review.advisory_output,
    { available: false, usable: false });

  const repeated = [await poll(record), await poll(record)];
  for (const observed of repeated) {
    assert.deepEqual(observed.exit, terminal.exit);
    assert.deepEqual(observed.final_result, terminal.final_result);
  }
  assert.equal(child.probes(), 2, "terminal settlement is not re-probed");
});

test("a failing conduit keeps captured advisory text byte-identical beside the cause", async () => {
  const text = "High: captured before the host wiki-MCP server exited.\r\n\u{1f680}";
  const failedWithText = Object.freeze({
    status: "failed",
    exit: Object.freeze({ code: 1, signal: null }),
    final_result: capturedFinalResult(text)
  });
  const conduit = healthyConduit();
  const { record, child } = await launchWithConduit(conduit, [RUNNING, failedWithText]);
  await poll(record);
  child.exit();
  conduit.readinessFailure = typedConduitError(STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_EXIT,
    { code: 1, signal: null });

  const terminal = await poll(record);
  assert.deepEqual(terminal.exit, {
    code: 1,
    signal: null,
    conduit_failure: expectedCarrier(conduit, failedWithText)
  });
  assert.equal(terminal.exit.conduit_failure.detail.conduit_error_code,
    STDIO_MCP_CONDUIT_ERROR_CODES.SERVER_EXIT);
  assert.equal(terminal.final_result.full_response.text, text);
  assert.equal(advisory(terminal).execution_status, "failed");
  assert.equal(advisory(terminal).advisory_output.usable, true);
  assert.equal(advisory(terminal).advisory_output.text, text);
  assert.deepEqual(advisory(terminal).formal_attestation, {
    requested: false, available: false, reason: "not_requested"
  });
  assertAdvisoryOnly(terminal);
});

test("cleanup-only conduit failure stays distinguishable from a child failure", async () => {
  const text = "No findings.";
  const succeeded = Object.freeze({
    status: "succeeded",
    exit: Object.freeze({ code: 0, signal: null }),
    final_result: capturedFinalResult(text)
  });
  const conduit = { ...healthyConduit(), cleanupFailure: cleanupFailed() };
  const { record } = await launchWithConduit(conduit, [succeeded]);

  const terminal = await poll(record);
  assert.equal(terminal.status, "failed");
  assert.deepEqual(terminal.exit, {
    code: 0,
    signal: null,
    conduit_failure: expectedCarrier(conduit, succeeded)
  });
  assert.equal(terminal.exit.conduit_failure.reason, STDIO_MCP_CLEANUP_BLOCKER_REASON);
  assert.equal(terminal.exit.conduit_failure.detail.conduit_error_code,
    STDIO_MCP_CONDUIT_ERROR_CODES.CLEANUP_FAILED);
  assert.equal(terminal.exit.conduit_failure.cleanup_only, true);
  assert.equal(advisory(terminal).advisory_output.text, text);
});

test("cleanup residue never replaces a primary conduit failure", async () => {
  const conduit = {
    ...healthyConduit(),
    readinessFailure: readinessTimeout(),
    cleanupFailure: cleanupFailed()
  };
  const { record } = await launchWithConduit(conduit, [KILLED_WITHOUT_OUTPUT]);

  const terminal = await poll(record);
  const carrier = terminal.exit.conduit_failure;
  assert.equal(carrier.reason, STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON);
  assert.equal(carrier.cleanup_only, false);
  assert.equal(carrier.detail.conduit_error_code,
    STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT);
  assert.equal(carrier.detail.cleanup_failure.code, STDIO_MCP_CONDUIT_ERROR_CODES.CLEANUP_FAILED);
});

test("runs without a typed conduit failure carry no fabricated diagnostic", async () => {
  const succeeded = Object.freeze({
    status: "succeeded",
    exit: Object.freeze({ code: 0, signal: null }),
    final_result: capturedFinalResult("No findings.")
  });
  const { record } = await launchWithConduit(healthyConduit(), [succeeded]);
  const healthy = await poll(record);
  assert.deepEqual(healthy.exit, { code: 0, signal: null });

  const lookAlike = Object.freeze({
    ...KILLED_WITHOUT_OUTPUT,
    conduit_failure: { reason: STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON, detail: null, cleanup_only: false }
  });
  const runs = new Map();
  const unbranded = await launchAdvisory({

    executorResult: { accepted: true, status: "launching", completion: Promise.resolve(),
      probe: async () => lookAlike },
    runs
  });
  const killed = await poll(runs.get(unbranded.run_id));
  assert.deepEqual(killed.exit, { code: null, signal: "SIGKILL" });

  const thrown = await launchAdvisory({
    executorResult: {
      accepted: true,
      status: "failed",
      exit: { code: null, signal: null, error_code: "advisory_process_failed" },
      final_result: null
    }
  });
  assert.deepEqual(thrown.exit, { code: null, signal: null, error_code: "advisory_process_failed" });
});
