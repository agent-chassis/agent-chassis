import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import {
  captureStructuredDiagnostic
} from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";

import {
  createDispatchToolRegistry,
  readStructuredResult
} from "../../packages/wiki-mcp/src/lib/dispatch-tools-test-helpers.mjs";
import { errorContent, readOperatorOnlyEvidence, readSpilledMcpContentReference }
  from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  buildDispatchToolExceptionDetail,
  DISPATCH_FAILURE_ORIGINALS,
  distillDispatchFailureDetail,
  projectDispatchFailureDetail,
  projectRecordedFailureDetail
} from "../../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";
import {
  captureTestFailureDiagnostic,
  isLauncherTestFailureDiagnostic,
  projectSelectedTestFailureDiagnostic
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-test-proof-error-diagnostic.mjs";

function assertObservedByRead(detail) {
  assert.equal(Object.hasOwn(detail, "evidence"), false, "the capture is not published");
  assert.deepEqual(detail.retained_evidence, { retained: false, reason: "observed_by_read",
    meaning: "a read writes nothing; repeating it observes the same failure again",
    audience: "operator", fields: ["thrown"] });
}

async function retainedAtSeam(error) {
  const scope = createTestResourceScope();
  try {
    const stateDir = await scope.acquire("response-state",
      () => mkdtemp(path.join(tmpdir(), "dispatch-exception-seam-")),
      (dir) => rm(dir, { recursive: true, force: true }));
    const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
    const detail = buildDispatchToolExceptionDetail("workspace_agent_run_status", error, { env });
    assert.equal(detail.retained_evidence.retained, true);
    assert.deepEqual(detail.retained_evidence.fields, ["thrown"]);
    return readOperatorOnlyEvidence(detail.retained_evidence, { env });
  } finally {
    await scope.dispose();
  }
}

async function monitorFailure(tool, input, error) {
  const tools = createDispatchToolRegistry({
    backend: {
      startLaunch() { throw error; },
      getRunStatus() { throw error; },
      waitForRunStatus() { throw error; }
    }
  });
  return readStructuredResult(await tools.get(tool).handler(input));
}

test("short ordinary monitoring diagnostics are returned byte-for-byte", async () => {
  const message = "caller-controlled <script>!? /looks/like/a/path";
  const structured = await monitorFailure(
    "workspace_agent_run_status",
    { subject: "WK-1160#SLICE-012" },
    new Error(message)
  );
  assert.equal(structured.accepted, false);

  assert.equal(structured.blocker.code, RUNTIME_BLOCKER_CODES["MCP_RESPONSE.HANDLER_EXCEPTION.V1"]);
  assert.notEqual(structured.blocker.code, "operator_recovery_needed");
  assert.equal(structured.blocker.reason, "run_status_tool_exception");
  assert.equal(structured.blocker.detail.error_message, message);
  assert.deepEqual(structured.blocker.detail.error_message_redactions, []);
  assert.equal(Object.hasOwn(structured.blocker.detail, "error_message_truncated"), false);

  assertObservedByRead(structured.blocker.detail);
  const thrown = (await retainedAtSeam(new Error(message))).thrown.value;
  assert.equal(thrown.message, message);
  assert.equal(typeof thrown.stack, "string");
});

test("multiline Unicode diagnostics larger than the former cap remain complete", async () => {
  const message = `line one 🚀\n${"detail-!?.,[]{}".repeat(1_000)}`;
  const structured = await monitorFailure(
    "workspace_agent_run_status",
    { subject: "WK-1160#SLICE-012", timeout_ms: 1 },
    new Error(message)
  );
  assert.equal(structured.blocker.reason, "run_status_tool_exception");
  assert.equal(structured.blocker.detail.error_message, message);
  assert.deepEqual(structured.blocker.detail.error_message_redactions, []);
});

test("an ordinary path remains value-identical", async () => {
  const internalPath = "/home/user/agent-chassis/wiki/work-records/WK-1160.json";
  const error = new Error(`Cannot open ${internalPath}; caller suffix remains /ordinary/text`);
  const structured = await monitorFailure(
    "workspace_agent_run_status",
    { subject: "WK-1160#SLICE-012" },
    error
  );
  assert.equal(structured.blocker.detail.error_message, error.message);
  assert.deepEqual(structured.blocker.detail.error_message_redactions, []);
  assert.equal(JSON.stringify(structured).includes(internalPath), true);
});

test("a structured diagnostic keeps its declared values exact in the message, cause and evidence", async () => {
  const secret = "token-secret-value";
  const message = `backend refused ${secret}; retry is not selected from this text`;
  const error = captureStructuredDiagnostic(message,
    { sensitiveValues: [{ field: "credential", value: secret, reason: "secret_material" }] });
  const structured = await monitorFailure(
    "workspace_agent_run_status",
    { subject: "WK-1160#SLICE-012" },
    error
  );
  assert.equal(structured.blocker.detail.error_message, message);
  assert.deepEqual(structured.blocker.detail.error_message_redactions, []);
  assert.deepEqual(structured.blocker.detail.cause_chain, [{ message }]);
  assert.doesNotMatch(JSON.stringify(structured), /\[redacted:/u);

  assert.equal(structured.refusal.deciding_facts.some(
    (fact) => JSON.stringify(fact).includes(secret)), false);
  assert.equal(JSON.stringify(structured.refusal.recovery).includes(secret), false);
  assertObservedByRead(structured.blocker.detail);
  const evidence = await retainedAtSeam(error);
  const thrown = evidence.thrown.value;
  assert.equal(thrown.schema_version, "structured-diagnostic.v1");
  assert.equal(thrown.value, message);
  assert.deepEqual(thrown.sensitive_values,
    [{ field: "credential", value: secret, reason: "secret_material" }]);
  assert.equal(evidence.operation, "workspace_agent_run_status");
  assert.deepEqual(evidence.thrown.capture_failures, []);
});

test("a structured object diagnostic keeps its semantic facts exact and its raw output unpublished", async () => {
  const secret = "token-secret-value";
  const value = { operation: "fetch", credential_hint: secret, attempts: 2,
    process: { status: 128, stderr: "fatal: remote rejected" } };
  const error = captureStructuredDiagnostic(value,
    { sensitiveValues: [{ field: "credential", value: secret, reason: "secret_material" }] });
  const structured = await monitorFailure(
    "workspace_agent_run_status", { subject: "WK-1160#SLICE-012" }, error);
  const published = { operation: "fetch", credential_hint: secret, attempts: 2, process: { status: 128 } };
  assert.deepEqual(structured.blocker.detail.error_message, published);
  assert.deepEqual(structured.blocker.detail.cause_chain, [{ message: published }]);
  assert.equal(JSON.stringify(structured).includes("fatal: remote rejected"), false,
    "raw process output is not published");
  assertObservedByRead(structured.blocker.detail);
  assert.deepEqual((await retainedAtSeam(error)).thrown.value.value, value);
});

test("a malformed structured diagnostic carrier is refused by the schema owner, not published", async () => {
  const malformed = { schema_version: "structured-diagnostic.v1", value: "x",
    sensitive_values: [{ field: "credential", value: "x", reason: "not_a_reason" }] };
  await assert.rejects(monitorFailure("workspace_agent_run_status", { subject: "WK-1160#SLICE-012" }, malformed),
    { name: "TypeError", message: "structured diagnostic must use the closed schema and redaction vocabulary" });
});

test("the dispatch exception projection and generic errorContent publish the same original", async () => {
  const scope = createTestResourceScope();
  try {
    const stateDir = await scope.acquire("response-state",
      () => mkdtemp(path.join(tmpdir(), "dispatch-diagnostic-agreement-")),
      (dir) => rm(dir, { recursive: true, force: true }));
    const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
    const secret = "token-secret-value";
    for (const original of [`refused ${secret}`, { operation: "fetch", nested: { token: secret, list: [1, null] } }]) {
      const carrier = captureStructuredDiagnostic(original,
        { sensitiveValues: [{ field: "credential", value: secret, reason: "secret_material" }] });
      const detail = buildDispatchToolExceptionDetail("workspace_agent_run_status", carrier, { env });
      assert.deepEqual(detail.error_message, original);
      assert.deepEqual(detail.error_message, errorContent(carrier).structuredContent.diagnostic);
      assert.deepEqual(detail.error_message_redactions, []);
    }
  } finally {
    await scope.dispose();
  }
});

test("a dispatch evidence retention failure keeps its actual cause and publishes no capture", async () => {
  const scope = createTestResourceScope();
  try {
    const root = await scope.acquire("response-root",
      () => mkdtemp(path.join(tmpdir(), "dispatch-retention-failure-")),
      (dir) => rm(dir, { recursive: true, force: true }));
    const occupied = path.join(root, "occupied");
    await writeFile(occupied, "not a directory\n");
    const stateDir = path.join(occupied, "state");
    const error = new Error("outer failure", { cause: Object.assign(new Error("inner"), {
      code: "E_INNER", stderr: "raw process output" }) });
    const detail = buildDispatchToolExceptionDetail("workspace_agent_run_status", error,
      { env: { WIKI_MCP_RESPONSE_STATE_DIR: stateDir } });

    assert.equal(detail.error_message, "outer failure");
    assert.deepEqual(detail.cause_chain.map(({ message }) => message), ["outer failure", "inner"]);

    const retention = detail.retained_evidence;
    assert.equal(retention.retained, false);
    assert.equal(retention.failed_operation, "retain_operator_only_evidence");
    assert.deepEqual(retention.subject, { fields: ["thrown"] });
    assert.deepEqual(retention.fields, ["thrown"]);
    assert.equal(retention.cause_code, "ENOTDIR");
    assert.deepEqual([retention.cause.code, retention.cause.syscall, retention.cause.path],
      ["ENOTDIR", "mkdir", stateDir]);
    assert.ok(retention.cause.message.includes(stateDir), retention.cause.message);
    for (const field of ["ref_id", "sha256", "audience"]) {
      assert.equal(Object.hasOwn(retention, field), false, `no dead locator field ${field}`);
    }
    assert.equal(JSON.stringify(detail).includes("raw process output"), false,
      "the withheld capture is not published because retention failed");
    assert.deepEqual(await readdir(root), ["occupied"], "reporting the failure retained nothing");
  } finally {
    await scope.dispose();
  }
});

test("a recorded failure's projection is pure; only the recording seam retains its original", async () => {
  const scope = createTestResourceScope();
  try {
    const stateDir = await scope.acquire("response-state",
      () => mkdtemp(path.join(tmpdir(), "dispatch-failure-projection-split-")),
      (dir) => rm(dir, { recursive: true, force: true }));
    const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
    const RAW = "fatal: RAW-PROCESS-CAPTURE 🙂";
    const detail = Object.freeze({
      operation: "integrate", subject: "WK-2716#SLICE-001",
      offending_paths: ["README.md"],
      native: { argv: ["git", "merge-tree"], result: { status: 129, signal: null, stderr: RAW, output: [null, "", RAW] } },
      evidence: { schema_version: "agent_launch.diagnostic_evidence.v1", segments: [], capture_failures: [],
        value: { $type: "Error", name: "Error", message: "merge refused", stack: "Error: merge refused\n    at /srv/x.mjs:1:1",
          properties: { code: "E_MERGE", detail: { capability: { state: "unsupported" }, process: { status: 129, stderr: RAW } } } } }
    });
    const pure = distillDispatchFailureDetail(detail);
    assert.deepEqual(pure.withheld, ["detail.native.result.stderr", "detail.native.result.output", "detail.evidence"]);
    assert.deepEqual(pure.detail.native, { argv: ["git", "merge-tree"], result: { status: 129, signal: null } },
      "a native spawn result's own facts are kept");
    assert.deepEqual(pure.detail.evidence.cause_chain, [{ name: "Error", message: "merge refused", code: "E_MERGE" }],
      "a captured level publishes its scalar facts; its nested objects stay in the original");
    assert.deepEqual(distillDispatchFailureDetail(detail, { nested: true }).detail.evidence.cause_chain,
      [{ name: "Error", message: "merge refused", code: "E_MERGE",
        detail: { capability: { state: "unsupported" }, process: { status: 129 } } }],
      "the lifecycle form keeps each level's structured facts, never its raw output or trace");

    const reads = [0, 1, 2].map(() => projectRecordedFailureDetail(detail,
      { original: DISPATCH_FAILURE_ORIGINALS.ATTEMPT_JOURNAL }));
    for (const read of reads) assert.deepEqual(read, reads[0]);
    assert.deepEqual(reads[0].retained_evidence, { retained: true, owner: "managed_worker_attempt_journal",
      audience: "operator", fields: pure.withheld });
    const observed = buildDispatchToolExceptionDetail("workspace_agent_run_status",
      Object.assign(new Error("read failed"), { details: detail }),
      { env, original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION });
    assert.deepEqual(observed.retained_evidence, { ...DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION,
      audience: "operator", fields: ["thrown"] });
    assert.equal(observed.details.retained_evidence.retained, false);
    assert.deepEqual(await readdir(stateDir), [], "no read-side projection writes an artifact");
    for (const value of [...reads, observed]) {
      const rendered = JSON.stringify(value);
      assert.equal(rendered.includes("RAW-PROCESS-CAPTURE") || rendered.includes("/srv/x.mjs"), false);
    }

    const recorded = projectDispatchFailureDetail(detail, { env });
    const { retained_evidence: retention, ...facts } = recorded;
    const { retained_evidence: _read, ...readFacts } = reads[0];
    assert.deepEqual(facts, readFacts, "reads and the recording seam publish the same facts");
    assert.equal(retention.retained, true);
    assert.deepEqual(retention.fields, pure.withheld);
    assert.deepEqual(readOperatorOnlyEvidence(retention, { env }), JSON.parse(JSON.stringify(detail)),
      "the retained original is the producer's complete value");
    const artifacts = await readdir(stateDir, { recursive: true });
    assert.ok(artifacts.length > 0, "the recording seam retained its original");

    assert.throws(() => readSpilledMcpContentReference({ ref_id: retention.ref_id }, { env }),
      (error) => error?.envelope?.reason === "content_reference_selected_owner_required" &&
        error.envelope.refusal.deciding_facts.some(({ field, value }) =>
          field === "content_reference.operator_only" && value === true));
  } finally {
    await scope.dispose();
  }
});

test("a typed test-failure call trace is published exactly while server stacks stay withheld", async () => {
  const scope = createTestResourceScope();
  try {
    const stateDir = await scope.acquire("response-state",
      () => mkdtemp(path.join(tmpdir(), "dispatch-typed-trace-")),
      (dir) => rm(dir, { recursive: true, force: true }));
    const env = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
    let failing;
    try {
      (function selectedTestAssertion() { throw new Error("expected 1 to equal 2 — ünïcodé"); })();
    } catch (error) {
      failing = error;
    }
    const graph = captureTestFailureDiagnostic(failing);
    assert.equal(isLauncherTestFailureDiagnostic(graph), true);
    const SERVER_STACK = "Error: server internals\n    at /srv/wiki-mcp/private.mjs:9:9";
    const lookalike = { ...structuredClone(graph), root_error: "missing-error" };
    assert.equal(isLauncherTestFailureDiagnostic(lookalike), false, "the lookalike is not a valid graph");
    const thrown = Object.assign(new Error("run observation failed"), {
      code: "run_status_observation_failed",
      details: { operation: "observe", failure_diagnostic: graph, lookalike, stack: SERVER_STACK }
    });
    const tools = createDispatchToolRegistry({
      responseEnv: env,
      backend: {
        getRunStatus: async () => { throw thrown; },
        waitForRunStatus: async () => { throw thrown; },
        readManagedRunObservation: async () => ({ ok: false, code: "run_detail_unavailable" })
      }
    });
    const handler = tools.get("workspace_agent_run_status").handler;
    const responses = [];
    for (let read = 0; read < 2; read += 1) {
      responses.push(readStructuredResult(await handler({ subject: "WK-2716#SLICE-001" })));
    }
    assert.deepEqual(responses[1], responses[0], "a repeated read answers identically");
    const [response] = responses;
    assert.equal(response.accepted, false, JSON.stringify(response));
    const published = response.blocker.detail.details;

    assert.deepEqual(published.failure_diagnostic, JSON.parse(JSON.stringify(
      projectSelectedTestFailureDiagnostic(graph))));
    assert.equal(published.failure_diagnostic.error.stack, failing.stack,
      "the failing test's call trace is published exactly");
    assert.equal(published.failure_diagnostic.error.message, failing.message);

    const rendered = JSON.stringify(response);
    assert.equal(rendered.includes("/srv/wiki-mcp/private.mjs"), false, "the server stack is withheld");
    assert.equal(Object.hasOwn(published, "stack"), false);
    assert.deepEqual(published.retained_evidence.fields.includes("detail.stack"), true);
    assert.equal(JSON.stringify(published.lookalike).includes("\"stack\""), false,
      "a lookalike graph is distilled like any detail");
    assert.deepEqual(published.retained_evidence.retained, false, "observed by a read, retained nowhere");
    assert.deepEqual(await readdir(stateDir), [], "the read writes no artifact");
  } finally {
    await scope.dispose();
  }
});
