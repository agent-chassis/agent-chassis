import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  AGENT_RUN_PROVENANCE_CONSTRUCTION_DIAGNOSTIC_CODE,
  buildAgentRunProvenanceEnvelope
} from "../../packages/agent-launch-core/src/lib/agent-run-provenance-envelope.mjs";
import {
  WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS,
  WORKSPACE_AGENT_RESULT_MODES,
  WORKSPACE_AGENT_TERMINAL_RESULT_MODE_FACTS_SCHEMA_VERSION,
  attachLauncherObservedTerminalResultModeFacts,
  buildLegacyWorkspaceAgentResultModeCompatibilityEnvelope,
  buildWorkspaceAgentResultModeEnvelope,
  classifyWorkspaceAgentResultMode,
  isWorkspaceAgentResultModeEnvelope,
  readLauncherObservedTerminalResultMode,
  readLauncherObservedTerminalResultModeFacts,
  validateWorkspaceAgentResultModeEnvelope,
  workspaceAgentResultModeEnvelopesEqual
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-result-mode.mjs";

const artifact = (path) => ({
  path,
  exists: true,
  byte_count: 3,
  sha256: "abc",
  media_kind: "application/json",
  sensitivity_class: "routine"
});

function facts(overrides = {}) {
  return {
    runId: "RUN-1",
    reviewId: "review-1",
    handoffId: "WK-1",
    selectedAgent: "codex",
    wkId: null,
    inId: null,
    entrypoint: null,
    profile: null,
    model: null,
    childPid: null,
    heartbeatTimeline: [],
    role: "worker",
    effectiveRole: "worker",
    subject: "repo:WK-1",
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:01.000Z",
    terminalStatus: "failed",
    exitStatus: 17,
    signal: "SIGTERM",
    runtimeCwd: "/run/agent-visible",
    runDir: "/run",
    argvRedacted: ["codex", "<review>"],
    authority: { trusted_binding: { kind: "review", id: "review-1" } },
    artifacts: { response_md: artifact("/run/response.md") },
    sourceContext: { review_json: artifact("/run/review.json") },
    ...overrides
  };
}

test("shared owner constructs the complete reviewed envelope", () => {
  const result = buildAgentRunProvenanceEnvelope(facts());
  assert.equal(result.ok, true);
  assert.equal(result.envelope.schema_version, "agent-run-provenance.v1");
  assert.equal(result.envelope.runtime.exit_status, 17);
  assert.equal(result.envelope.runtime.signal, "SIGTERM");
  assert.deepEqual(result.envelope.artifacts.response_md, artifact("/run/response.md"));
});

test("shared owner preserves supplied finite epochs and shapes optional source facts", () => {
  const result = buildAgentRunProvenanceEnvelope(facts({
    startedAtEpoch: Date.parse("2026-08-24T00:00:00.000Z"),
    completedAtEpoch: Date.parse("2026-08-24T00:00:01.000Z"),
    sourceContext: {
      prompt_digest: "sha256:prompt",
      prompt_source: "review_bundle",
      review_json: artifact("/run/review.json"),
      graph_impact_checkpoint: { state: "not_required" }
    }
  }));
  assert.equal(result.ok, true);
  assert.equal(result.envelope.runtime.started_at_epoch, Date.parse("2026-08-24T00:00:00.000Z"));
  assert.equal(result.envelope.runtime.completed_at_epoch, Date.parse("2026-08-24T00:00:01.000Z"));
  assert.deepEqual(result.envelope.source_context.graph_impact_checkpoint, { state: "not_required" });
});

test("shared owner rejects malformed emitted facts without partial provenance", () => {
  for (const overrides of [
    { sourceContext: { prompt_digest: 42 } },
    { sourceContext: { prompt_source: "" } },
    { childPid: -1 },
    { heartbeatTimeline: [{ at: "now", elapsed_seconds: 0, log_bytes: "0" }] },
    { artifacts: { response_md: { path: "/run/response.md", exists: true } } },
    { startedAtEpoch: Infinity },
    { completedAtEpoch: 1, startedAtEpoch: 2 }
    ,{ heartbeatTimeline: [{ at: "now", elapsed_seconds: 0, log_bytes: 0, extra: true }] }
    ,{ sourceContext: { graph_impact_checkpoint: {} } }
    ,{ sourceContext: { graph_impact_checkpoint: { state: "valid", override: { applied: true } } } }
  ]) {
    const result = buildAgentRunProvenanceEnvelope(facts(overrides));
    assert.equal(result.ok, false);
    assert.equal(result.envelope, undefined);
    assert.equal(result.diagnostic.type, "agent-run-provenance-construction-diagnostic.v1");
  }
});

test("missing construction facts produce no partial envelope and preserve terminal evidence", () => {
  const terminal = { status: "failed", exit: 17, signal: "SIGTERM" };
  const result = buildAgentRunProvenanceEnvelope(facts({ selectedAgent: undefined }));
  assert.equal(result.ok, false);
  assert.equal(result.envelope, undefined);
  assert.equal(result.diagnostic.code, AGENT_RUN_PROVENANCE_CONSTRUCTION_DIAGNOSTIC_CODE);
  assert.deepEqual(terminal, { status: "failed", exit: 17, signal: "SIGTERM" });
});

test("shared owner rejects malformed direct-capture facts without an envelope", () => {
  const result = buildAgentRunProvenanceEnvelope({
    captureMode: "direct",
    runId: "RUN-1",
    wrapper: "codex-role",
    role: "worker",
    subject: "WK-1",
    wkId: null,
    inId: null,
    entrypoint: null,
    profile: null,
    model: null,
    selectedAgent: "codex",
    childPid: null,
    runtimeCwd: "/workspace",
    runDir: "/run/RUN-1",
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:01.000Z",
    status: 0,
    terminalStatus: "completed",
    signal: null,
    argvRedacted: ["codex", ""],
    sourceContext: {},
    authority: {},
    artifacts: {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.envelope, undefined);
  assert.equal(result.diagnostic.code, AGENT_RUN_PROVENANCE_CONSTRUCTION_DIAGNOSTIC_CODE);
});

test("result-mode owner validates complete envelopes and compares them exactly", () => {
  const envelope = buildWorkspaceAgentResultModeEnvelope({
    mode: WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT,
    selected_contract: "schema_constrained"
  });
  assert.equal(isWorkspaceAgentResultModeEnvelope(envelope), true);
  assert.equal(validateWorkspaceAgentResultModeEnvelope(envelope), envelope);
  const reordered = {
    prose_authority: envelope.prose_authority,
    authority: envelope.authority,
    selected_contract: envelope.selected_contract,
    mode: envelope.mode,
    schema_version: envelope.schema_version
  };
  assert.equal(workspaceAgentResultModeEnvelopesEqual(envelope, reordered), true);
  assert.equal(workspaceAgentResultModeEnvelopesEqual(envelope, {
    ...envelope, selected_contract: "free_prose"
  }), false);
  assert.equal(isWorkspaceAgentResultModeEnvelope({
    ...envelope, mode: "invented_mode"
  }), false);
  const diagnostic = buildWorkspaceAgentResultModeEnvelope({
    mode: WORKSPACE_AGENT_RESULT_MODES.RUNTIME_FAILURE,
    diagnostic: "terminal_run_failed"
  });
  assert.equal(workspaceAgentResultModeEnvelopesEqual(envelope, diagnostic), false);
  assert.throws(() => buildWorkspaceAgentResultModeEnvelope({
    mode: WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT,
    selected_contract: WORKSPACE_AGENT_RESULT_MODES.RUNTIME_FAILURE
  }), /facts are malformed/);
  assert.equal(isWorkspaceAgentResultModeEnvelope({
    ...envelope,
    selected_contract: "vendor_local_contract"
  }), false);
});

test("result-mode owner transports only a closed selected-contract fact carrier", () => {
  for (const selectedContract of Object.values(WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS)) {
    const accepted = attachLauncherObservedTerminalResultModeFacts({ accepted: true }, {
      selectedContract
    });
    assert.deepEqual(readLauncherObservedTerminalResultModeFacts(accepted), {
      schema_version: WORKSPACE_AGENT_TERMINAL_RESULT_MODE_FACTS_SCHEMA_VERSION,
      selected_contract: selectedContract
    });
    assert.equal(readLauncherObservedTerminalResultMode(accepted), selectedContract);
    assert.equal(Object.hasOwn(accepted, "result_mode"), false);
  }
  for (const malformed of [
    WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS.FENCED,
    { selectedContract: WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT }
  ]) {
    assert.throws(
      () => attachLauncherObservedTerminalResultModeFacts({ accepted: true }, malformed),
      /facts are malformed/
    );
  }
});

test("legacy compatibility is explicit and never accepts current malformed evidence", () => {
  const envelope = buildLegacyWorkspaceAgentResultModeCompatibilityEnvelope({
    schema_version: "workspace-agent-exact-slice-review-receipt.v3",
    structured_outcome: null,
    terminal_run_status: "succeeded"
  });
  assert.equal(envelope.mode, WORKSPACE_AGENT_RESULT_MODES.LEGACY_COMPLETION);
  assert.equal(isWorkspaceAgentResultModeEnvelope(envelope), true);
  assert.throws(
    () => buildLegacyWorkspaceAgentResultModeCompatibilityEnvelope({
      result_mode: { mode: "malformed" }, terminal_run_status: "succeeded"
    }),
    /pre-explicit/
  );
  assert.throws(
    () => buildLegacyWorkspaceAgentResultModeCompatibilityEnvelope({
      schema_version: "workspace-agent-exact-slice-review-receipt.v4",
      structured_outcome: null, terminal_run_status: "succeeded"
    }),
    /pre-explicit/
  );
});

test("backend receipt production delegates complete-envelope validation to the result-mode owner", async () => {
  const source = await readFile(new URL(
    "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-receipts.mjs",
    import.meta.url
  ), "utf8");
  const boundary = source.slice(
    source.indexOf("async function persistExactSliceReviewReceiptUnderAuthority"),
    source.indexOf("return {", source.indexOf("async function persistExactSliceReviewReceiptUnderAuthority"))
  );
  assert.match(boundary, /validateWorkspaceAgentResultModeEnvelope\(\s*record\?\.final_result\?\.result_mode/u);
  assert.doesNotMatch(boundary, /record\?\.final_result\?\.result_mode\?\.mode/u);
  assert.doesNotMatch(boundary, /CONFIGURED_STRUCTURE_INVALID/u);
});

test("receipt schema and validation have no scalar result-mode vocabulary or default", async () => {
  const [schema, validation] = await Promise.all([
    readFile(new URL(
      "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-schema.mjs",
      import.meta.url
    ), "utf8"),
    readFile(new URL(
      "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-validation.mjs",
      import.meta.url
    ), "utf8")
  ]);
  assert.match(schema, /validateWorkspaceAgentResultModeEnvelope/u);
  assert.doesNotMatch(schema, /classifyExactSliceReviewReceiptResultMode/u);
  assert.match(validation, /validateWorkspaceAgentResultModeEnvelope/u);
  assert.doesNotMatch(validation, /Object\.values\(WORKSPACE_AGENT_RESULT_MODES\)/u);
});

test("receipt storage transports only owner-validated equal result-mode envelopes", async () => {
  const source = await readFile(new URL(
    "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-run-receipt-store.mjs",
    import.meta.url
  ), "utf8");
  assert.match(source, /validateWorkspaceAgentResultModeEnvelope\(finalResult\?\.result_mode\)/u);
  assert.match(source, /validateWorkspaceAgentResultModeEnvelope\(receipt\?\.result_mode\)/u);
  assert.match(source, /workspaceAgentResultModeEnvelopesEqual\(observed, recorded\)/u);
  assert.doesNotMatch(source, /\bboundedResultMode\b|\bRESULT_MODES\b/u);
});

test("backend recovery delegates exact current-evidence equality to the result-mode owner", async () => {
  const source = await readFile(new URL(
    "../../packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-recovery.mjs",
    import.meta.url
  ), "utf8");
  assert.match(source, /validateWorkspaceAgentResultModeEnvelope\(receipt\.result_mode\)/u);
  assert.match(source,
    /workspaceAgentResultModeEnvelopesEqual\(receiptResultMode, terminalResultMode\)/u);
  assert.match(source, /buildLegacyWorkspaceAgentResultModeCompatibilityEnvelope\(receipt\)/u);
  assert.doesNotMatch(source,
    /classifyWorkspaceAgentResultMode|WORKSPACE_AGENT_RESULT_MODES|result_mode\?\.mode/u);
});

test("result-mode classification fails loudly for malformed raw facts", () => {
  assert.throws(
    () => classifyWorkspaceAgentResultMode({
      record: { status: "succeeded" }, selectedContract: 42
    }),
    /facts are malformed/
  );
  assert.throws(
    () => classifyWorkspaceAgentResultMode({
      record: { status: "succeeded" }, terminalStructuredRoleResultMode: "fenced"
    }),
    /facts are malformed/
  );
  assert.throws(
    () => classifyWorkspaceAgentResultMode({
      record: { status: "succeeded" },
      missingOutput: true,
      finalResult: { kind: "missing_result", missing_result: { reason: 42 } }
    }),
    /facts are malformed/
  );
  for (const value of ["false", 0, {}, [], null, undefined]) {
    assert.throws(() => classifyWorkspaceAgentResultMode({
      record: { status: "failed" }, confinementFailure: true, missingOutput: value
    }), /facts are malformed/);
    assert.throws(() => classifyWorkspaceAgentResultMode({
      record: { status: "failed" }, confinementFailure: value
    }), /facts are malformed/);
  }
  for (const [booleanFacts, expectedMode] of [
    [{}, WORKSPACE_AGENT_RESULT_MODES.CONFIGURED_STRUCTURE_INVALID],
    [{ missingOutput: false, confinementFailure: false }, WORKSPACE_AGENT_RESULT_MODES.CONFIGURED_STRUCTURE_INVALID],
    [{ missingOutput: true, confinementFailure: false }, WORKSPACE_AGENT_RESULT_MODES.MISSING_OUTPUT],
    [{ missingOutput: true, confinementFailure: true }, WORKSPACE_AGENT_RESULT_MODES.CONFINEMENT_FAILURE],
    [{ missingOutput: true, confinementFailure: false, record: { status: "failed" } }, WORKSPACE_AGENT_RESULT_MODES.RUNTIME_FAILURE]
  ]) {
    assert.equal(classifyWorkspaceAgentResultMode({
      record: { status: "succeeded" }, ...booleanFacts
    }).mode, expectedMode);
  }
});

test("classification preserves selected-contract vocabulary without using it as outcome mode", () => {
  for (const selectedContract of Object.values(WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS)) {
    const freeProse = selectedContract === WORKSPACE_AGENT_SELECTED_RESULT_CONTRACTS.FREE_PROSE;
    const envelope = classifyWorkspaceAgentResultMode({
      record: { role: freeProse ? "reviewer" : "worker", status: "succeeded" },
      finalResult: freeProse ? { full_response: { text: "No findings." } } : { kind: "findings" },
      structuredRoleResult: { valid: !freeProse },
      selectedContract
    });
    assert.equal(envelope.mode, freeProse
      ? WORKSPACE_AGENT_RESULT_MODES.NEUTRAL_PROSE
      : WORKSPACE_AGENT_RESULT_MODES.STRUCTURED_RESULT);
    assert.equal(envelope.selected_contract, selectedContract);
    assert.notEqual(envelope.mode, envelope.selected_contract);
  }
});

test("result-mode classification snapshots boolean accessors exactly once", () => {
  for (const key of ["missingOutput", "confinementFailure"]) {
    let reads = 0;
    const facts = { record: { status: "succeeded" } };
    Object.defineProperty(facts, key, {
      get() { reads += 1; return false; }
    });
    assert.equal(
      classifyWorkspaceAgentResultMode(facts).mode,
      WORKSPACE_AGENT_RESULT_MODES.CONFIGURED_STRUCTURE_INVALID
    );
    assert.equal(reads, 1);
  }
  for (const key of ["missingOutput", "confinementFailure"]) {
    let reads = 0;
    const facts = { record: { status: "succeeded" } };
    Object.defineProperty(facts, key, {
      get() { reads += 1; return reads === 1 ? null : false; }
    });
    assert.throws(() => classifyWorkspaceAgentResultMode(facts), /facts are malformed/);
    assert.equal(reads, 1);
  }
});

test("direct owner accepts integer epoch seconds for millisecond ISO timestamps and preserves them", () => {
  const result = buildAgentRunProvenanceEnvelope({
    captureMode: "direct",
    runId: "RUN-1",
    wrapper: "codex-role",
    role: "worker",
    subject: "WK-1",
    wkId: null,
    inId: null,
    entrypoint: null,
    profile: null,
    model: null,
    selectedAgent: "codex",
    childPid: null,
    runtimeCwd: "/workspace",
    runDir: "/run/RUN-1",
    startedAt: "2026-08-24T00:00:00.123Z",
    completedAt: "2026-08-24T00:00:01.987Z",
    startedAtEpoch: 1787529600,
    completedAtEpoch: 1787529601,
    status: 0,
    terminalStatus: "completed",
    signal: null,
    argvRedacted: ["codex-role", "WK-1"],
    heartbeatTimeline: [],
    sourceContext: {},
    authority: {},
    artifacts: {}
  });
  assert.equal(result.ok, true);
  assert.equal(result.envelope.runtime.started_at_epoch, 1787529600);
  assert.equal(result.envelope.runtime.completed_at_epoch, 1787529601);
});

test("shared owner preserves a successful direct envelope shape and terminal facts", () => {
  const result = buildAgentRunProvenanceEnvelope({
    captureMode: "direct",
    runId: "RUN-1",
    wrapper: "codex-role",
    role: "worker",
    subject: "WK-1",
    selectedAgent: "codex",
    wkId: null,
    inId: null,
    entrypoint: null,
    profile: null,
    model: null,
    childPid: null,
    heartbeatTimeline: [],
    argvRedacted: ["codex-role", "WK-1"],
    sourceContext: { subject: null, prompt_digest: null, prompt_source: "generated_default" },
    authority: { agent_role: "worker" },
    runtimeCwd: "/workspace",
    runDir: "/run/RUN-1",
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:01.000Z",
    status: 0,
    terminalStatus: "completed",
    signal: null,
    artifacts: { final_response: null }
  });
  assert.equal(result.ok, true);
  assert.equal(result.envelope.runtime.status, "completed");
  assert.equal(result.envelope.runtime.exit_status, 0);
  assert.equal(result.envelope.runtime.signal, undefined);
  assert.equal(result.envelope.schema_version, "agent-run-provenance.v1");
});

test("shared owner preserves a signaled terminal fact without synthesizing an exit code", () => {
  const result = buildAgentRunProvenanceEnvelope({
    captureMode: "direct",
    runId: "RUN-1",
    wrapper: "codex-role",
    role: "worker",
    subject: "WK-1",
    selectedAgent: "codex",
    wkId: null,
    inId: null,
    entrypoint: null,
    profile: null,
    model: null,
    childPid: 42,
    heartbeatTimeline: [],
    argvRedacted: ["codex-role", "WK-1"],
    sourceContext: {},
    authority: {},
    runtimeCwd: "/workspace",
    runDir: "/run/RUN-1",
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:01.000Z",
    status: null,
    terminalStatus: "failed",
    signal: "SIGTERM",
    artifacts: {}
  });
  assert.equal(result.ok, true);
  assert.equal(result.envelope.runtime.exit_status, null);
  assert.equal(result.envelope.runtime.signal, "SIGTERM");
});

test("shared owner rejects contradictory direct terminal facts", () => {
  const result = buildAgentRunProvenanceEnvelope({
    captureMode: "direct",
    runId: "RUN-1",
    wrapper: "codex-role",
    role: "worker",
    subject: "WK-1",
    selectedAgent: "codex",
    wkId: null,
    inId: null,
    entrypoint: null,
    profile: null,
    model: null,
    childPid: null,
    heartbeatTimeline: [],
    argvRedacted: ["codex-role", "WK-1"],
    sourceContext: {},
    authority: {},
    runtimeCwd: "/workspace",
    runDir: "/run/RUN-1",
    startedAt: "2026-08-24T00:00:00.000Z",
    completedAt: "2026-08-24T00:00:01.000Z",
    status: 0,
    terminalStatus: "failed",
    signal: null,
    artifacts: {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.envelope, undefined);
  assert.equal(result.diagnostic.type, "agent-run-provenance-construction-diagnostic.v1");
});
