import assert from "node:assert/strict";
import test from "node:test";
import { decodeAgyFinalResult } from "../../packages/agent-launch-cli/src/lib/workspace-agent-agy-final-result.mjs";

const envelope = { status: "SUCCESS", conversation_id: "055a398f-db14-4c5f-abbb-1bf03f8120a7",
  response: "No findings.\n" };
const decode = (extra = {}, options = {}) => decodeAgyFinalResult({
  stdout: JSON.stringify({ ...envelope, ...extra }), ...options });

test("Agy extracts native text and invocation ID without creating delivery evidence", () => {
  assert.deepEqual(decode(), { ok: true, text: envelope.response,
    nativeSessionId: envelope.conversation_id, structuredOutput: undefined, enforcedSchema: undefined });
});

test("Agy transports structured output and enforced schema as native facts", () => {
  const structured_output = { count: 1 };
  const json_schema = { type: "object", required: ["count"] };
  const decoded = decode({ structured_output, json_schema });
  assert.deepEqual(decoded.structuredOutput, structured_output);
  assert.deepEqual(decoded.enforcedSchema, json_schema);
  assert.equal(decoded.delivery, undefined);
});

test("Agy exit-zero permission denial cannot become a successful response", () => {
  for (const stderr of ["Tool run_command was soft-denied", "Permission denied for tool wiki",
    "Tool run_command requires approval"]) {
    assert.equal(decode({}, { stderr }).reason, "agy_permission_denied");
  }
});

test("Agy native errors win over plausible final prose", () => {
  for (const status of ["ERROR", "CANCELED", "INTERRUPTED", "INVALID"]) {
    assert.equal(decode({ status, error: "native failure" }).reason, "agy_native_error");
  }
  assert.equal(decode({ error: "failure despite SUCCESS" }).reason, "agy_native_error");
});

test("Agy refuses incomplete, contradictory, malformed and truncated output", () => {
  for (const status of ["RUNNING", "WAITING", "UNKNOWN", null]) {
    assert.equal(decode({ status }).reason, "agy_result_incomplete");
  }
  for (const stdout of ["{", "null", "[]", JSON.stringify(envelope) + "\n{}",
    JSON.stringify({ event: "step_update", step_update: { text_delta: "No findings." } })]) {
    assert.equal(decodeAgyFinalResult({ stdout }).ok, false);
  }
  assert.equal(decodeAgyFinalResult({ stdout: "" }).reason, "agy_result_missing");
  assert.equal(decode({}, { truncated: true }).reason, "agy_output_truncated");
  assert.equal(decode({ conversation_id: "" }).reason, "agy_session_id_missing");
  assert.equal(decode({ response: "" }).reason, "agy_response_missing");
});

const stream = (events = []) => [
  { event: "init", conversation_id: envelope.conversation_id, init: { model: "declared-native-id" } },
  ...events,
  { event: "result", result: envelope }
].map(event => JSON.stringify(event)).join("\n");

test("native stream-json captures one exact conversation and terminal result", () => {
  assert.equal(decodeAgyFinalResult({ stdout: stream([{ event: "step_update", step_update: {
    conversation_id: envelope.conversation_id, step_index: 0, state: "DONE", step_type: "user_input" } }]) }).text, envelope.response);
  for (const stdout of [stream().split("\n")[0], stream() + "\n" + JSON.stringify({ event: "result", result: envelope }),
    stream().replaceAll(envelope.conversation_id, "other").split("\n")[0] + "\n" + stream().split("\n").at(-1)]) {
    assert.equal(decodeAgyFinalResult({ stdout }).ok, false);
  }
});

test("native timeout, denied-action facts and failed required tool cannot become success at exit zero", () => {
  for (const response of ["", "plausible partial answer"]) {
    assert.equal(decode({ response }, { stderr: "[agy] print timeout after 1m30s with turn in progress; returning partial output" }).reason,
      "agy_print_timeout");
  }
  assert.equal(decode({ denied_actions: [{ action: "read_file" }] }).reason, "agy_permission_denied");
  assert.equal(decodeAgyFinalResult({ stdout: stream([{ event: "step_update", step_update: {
    conversation_id: envelope.conversation_id, state: "ERROR", step_type: "tool" } }]) }).reason, "agy_native_tool_error");
});

test("a corrected native MCP invocation recovers its operation error without hiding other failures", () => {
  const step = (state, tool, parameters) => ({ event: "step_update", step_update: {
    conversation_id: envelope.conversation_id, state, step_type: "tool", tool_name: "call_mcp_tool",
    tool_info: { parameters: { ServerName: "wiki", ToolName: tool, Arguments: parameters } } } });
  assert.equal(decodeAgyFinalResult({ stdout: stream([
    step("ERROR", "workspace_read_wiki", { wrong: true }), step("DONE", "workspace_read_wiki", { assignment: true })
  ]) }).ok, true);
  assert.equal(decodeAgyFinalResult({ stdout: stream([
    step("ERROR", "workspace_read_wiki", { wrong: true }), step("DONE", "workspace_deliver_work", {})
  ]) }).reason, "agy_native_tool_error");
});
