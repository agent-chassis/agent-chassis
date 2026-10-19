import assert from "node:assert/strict";
import test from "node:test";
import { captureOpenCodeSchemaFinalResult } from "../../packages/agent-launch-cli/src/lib/workspace-agent-opencode-final-result.mjs";
import { parseAgentRoleResult } from "../../packages/agent-launch-core/src/lib/agent-role-result.mjs";
import { decodeOpenCodeEventStream, isOpenCodeNativeSessionId,
  OPENCODE_EVENT_PROTOCOL_VERSION } from "../../packages/agent-launch-cli/src/lib/workspace-agent-opencode-final-result.mjs";

const sessionID = "ses_qualification";
const part = (type, fields = {}, messageID = "msg_final") => ({ type,
  timestamp: 1, sessionID, part: { type: ({ step_start: "step-start",
    step_finish: "step-finish", tool_use: "tool" })[type] ?? type,
    id: `prt_${type}`, sessionID, messageID, ...fields } });
const start = part("step_start");
const text = part("text", { text: "No findings.\nResidual detail.", time: { start: 1, end: 2 } });
const finish = part("step_finish", { reason: "stop", cost: 0, tokens: { input: 1, output: 2 } });
const stream = (...events) => events.map(event => JSON.stringify(event)).join("\n") + "\n";

test("OpenCode 1.19.3 JSONL extracts final text and exact session identity", () => {
  assert.equal(OPENCODE_EVENT_PROTOCOL_VERSION, "1.19.3");
  const decoded = decodeOpenCodeEventStream(stream(start, text, finish));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.text, text.part.text);
  assert.equal(decoded.nativeSessionId, sessionID);
  assert.equal(decoded.terminalMessageId, "msg_final");
  assert.deepEqual(decoded.tools, []);
  assert.equal(isOpenCodeNativeSessionId("--continue"), false);
  assert.equal(isOpenCodeNativeSessionId("ses_../../latest"), false);
});

test("native tool loops retain final-message text, with tool events as observations only", () => {
  const earlier = "msg_tools";
  const tools = part("tool_use", { tool: "wiki_get_status", callID: "call_fixture",
    state: { status: "completed", output: "fixture observation" } }, earlier);
  const decoded = decodeOpenCodeEventStream(stream(
    part("step_start", { id: "prt_earlier_start" }, earlier), tools,
    part("step_finish", { id: "prt_earlier_end", reason: "tool-calls" }, earlier), start, text, finish));
  assert.equal(decoded.ok, true);
  assert.equal(decoded.text, text.part.text);
  assert.deepEqual(decoded.tools, [{ tool: "wiki_get_status", status: "completed", callId: "call_fixture" }]);
});

test("native errors and tool denial after plausible prose cannot become clean reviews", () => {
  const error = { type: "error", sessionID, error: { name: "APIError", data: { message: "provider rejected" } } };
  assert.equal(decodeOpenCodeEventStream(stream(start, text, finish, error)).reason, "opencode_native_error");
  const denied = part("tool_use", { tool: "edit", callID: "call_denied",
    state: { status: "error", error: "permission denied" } });
  const decoded = decodeOpenCodeEventStream(stream(start, denied, text, finish));
  assert.equal(decoded.ok, false);
  assert.equal(decoded.reason, "opencode_native_tool_error");
  assert.equal(decoded.detail.message, "permission denied");
});

test("malformed, truncated, contradictory and incomplete streams fail explicitly", () => {
  const cases = [
    ["", "opencode_stdout_empty"], ["{", "opencode_event_json_invalid"],
    ['{"type":"result","result":"No findings."}', "opencode_event_type_invalid"],
    [stream(start, text), "opencode_terminal_completion_missing"],
    [stream(start, finish), "opencode_final_text_missing"],
    [stream(text, finish), "opencode_step_start_missing"],
    [stream(start, { ...text, sessionID: "ses_other" }, finish), "opencode_session_id_conflict"],
    [stream(start, { ...text, part: { ...text.part, sessionID: "ses_other" } }, finish), "opencode_part_identity_invalid"],
    [stream(start, text, { ...text, part: { ...text.part, text: "contradiction" } }, finish), "opencode_part_conflict"],
    [stream(start, text, { ...finish, part: { ...finish.part, reason: "length" } }), "opencode_completion_incomplete"],
    [stream(start, { ...text, part: { ...text.part, time: { start: 1 } } }, finish), "opencode_text_incomplete"],
    [stream(start, part("tool_use", { state: { status: "completed" } }), text, finish), "opencode_tool_event_invalid"],
    [stream({ ...start, sessionID: undefined }), "opencode_session_id_missing"],
    [stream(start, text, finish) + '{"type":', "opencode_event_json_invalid"]
  ];
  for (const [value, reason] of cases) assert.equal(decodeOpenCodeEventStream(value).reason, reason);
  assert.equal(decodeOpenCodeEventStream(stream(start, text, finish), { maxBytes: 32 }).reason,
    "opencode_stream_too_large");
});

test("identical repeated completed part events do not duplicate the response", () => {
  assert.equal(decodeOpenCodeEventStream(stream(start, text, text, finish)).text, text.part.text);
});

test("native structured reports delegate validation and reject invalid role, subject and service exits", async () => {
  const report = { schema_version: "agent-role-result.v1", reported_role: "worker", reported_subject: "WK-9203#SLICE-001",
    reported_outcome: "completed", findings: [], finding_counts: { total: 0, blocking: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    reviewed_controls: [], summary: "Delivered fixture." };
  const facts = { role: "worker", subject: report.reported_subject, exit: { code: null, signal: "SIGTERM", error: null },
    sessionState: { work: Promise.resolve(), error: null, teardownRequested: true,
      result: { report, nativeSessionId: "ses_fixture", terminalMessageId: "msg_final", requestMessageId: "msg_request" } } };
  const valid = await captureOpenCodeSchemaFinalResult(facts);
  assert.equal(parseAgentRoleResult(valid.findings.text).valid, true);
  assert.deepEqual(JSON.parse(valid.findings.text), report);
  for (const patch of [{ reported_role: "reviewer" }, { reported_subject: "WK-9999" }, { reported_outcome: "invented" },
    { finding_counts: {} }, { extra: "forbidden" }]) {
    const result = await captureOpenCodeSchemaFinalResult({ ...facts,
      sessionState: { ...facts.sessionState, result: { ...facts.sessionState.result, report: { ...report, ...patch } } } });
    assert.equal(result.missing_result.reason, "opencode_schema_report_invalid");
  }
  for (const exit of [{ code: 0, signal: null }, { code: 1, signal: null }, { code: null, signal: "SIGKILL" }]) {
    assert.equal((await captureOpenCodeSchemaFinalResult({ ...facts, exit })).missing_result.reason, "opencode_schema_service_failed");
  }
  assert.equal((await captureOpenCodeSchemaFinalResult({ ...facts,
    sessionState: { ...facts.sessionState, teardownRequested: false } })).kind, "missing_result");
});
