import assert from "node:assert/strict";
import test from "node:test";
import { createOpenCodeSchemaRequestMessageId, decodeOpenCodeSchemaResponse, decodeOpenCodeSchemaUsageParts }
  from "../../packages/agent-launch-cli/src/lib/workspace-agent-opencode-schema-protocol.mjs";

const expected = { sessionId: "ses_fixture", messageId: "msg_request", directory: "/fixture",
  prompt: { agent: "launcher", model: { providerID: "google-vertex", modelID: "gemini-3.8-flash" }, variant: "medium" } };

test("request identities retain the pinned native chronological prefix and unique suffix", () => {
  const earlier = Date.now();
  const a = createOpenCodeSchemaRequestMessageId();
  const b = createOpenCodeSchemaRequestMessageId();
  const later = Date.now();
  assert.match(a, /^msg_[0-9a-f]{26}$/u);
  assert.notEqual(a, b);
  const prefix = BigInt(`0x${a.slice(4, 16)}`);
  assert.equal(prefix & 0xfffn, 0n);
  assert.ok(prefix >= ((BigInt(earlier) << 12n) & 0xffffffffffffn));
  assert.ok(prefix <= ((BigInt(later) << 12n) & 0xffffffffffffn));
});
function response() {
  return { info: { sessionID: expected.sessionId, parentID: expected.messageId, id: "msg_final", role: "assistant",
    path: { cwd: expected.directory }, agent: "launcher", providerID: "google-vertex", modelID: "gemini-3.8-flash",
    variant: "medium", time: { completed: 1 }, finish: "stop", structured: { fixture: true } }, parts: [] };
}
test("verified OpenCode 1.19.3 info.structured is bound to the exact request and selection", () => {
  const decoded = decodeOpenCodeSchemaResponse(response(), expected);
  assert.deepEqual(decoded.report, { fixture: true });
  assert.equal(decoded.nativeSessionId, "ses_fixture");
  assert.equal(decoded.terminalMessageId, "msg_final");
  assert.equal(decoded.requestMessageId, "msg_request");
});
test("missing reports, SDK field guesses, errors after plausible text and incomplete replies fail closed", () => {
  for (const [change, code] of [
    [info => { delete info.structured; info.structured_output = { fixture: true }; }, "opencode_schema_report_missing"],
    [info => { info.structured = "plausible ordinary prose"; }, "opencode_schema_report_missing"],
    [info => { info.finish = "length"; }, "opencode_schema_completion_missing"],
    [info => { delete info.time.completed; }, "opencode_schema_completion_missing"],
    [info => { info.error = { name: "StructuredOutputError", data: { message: "no report" } }; }, "opencode_native_error"],
    [info => { info.error = { name: "APIError", data: { message: "provider error" } }; }, "opencode_native_error"]
  ]) {
    const value = response();
    value.parts.push({ sessionID: "ses_fixture", messageID: "msg_final", type: "text", text: "Completed successfully." });
    change(value.info);
    assert.throws(() => decodeOpenCodeSchemaResponse(value, expected), error => error.code === code);
  }
});
test("cross-session, prior-message, model, variant, directory and part identities are refused", () => {
  for (const patch of [{ sessionID: "ses_other" }, { parentID: "msg_prior" }, { id: "bad" },
    { providerID: "another" }, { modelID: "another" }, { variant: "low" },
    { path: { cwd: "/other" } }, { agent: "build" }, { role: "user" }]) {
    assert.throws(() => decodeOpenCodeSchemaResponse({ ...response(), info: { ...response().info, ...patch } }, expected),
      error => error.code === "opencode_schema_identity_mismatch");
  }
  assert.throws(() => decodeOpenCodeSchemaResponse({ ...response(), parts: [{ sessionID: "ses_other", messageID: "msg_final" }] }, expected),
    error => error.code === "opencode_schema_part_identity_mismatch");
});

test("API accounting selects only exact-session native step parts without aggregating counters", () => {
  const part = { id: "prt_step", sessionID: "ses_fixture", messageID: "msg_final", type: "step-finish",
    tokens: { input: 2 }, cost: 0.1 };
  const message = { info: { id: "msg_final", sessionID: "ses_fixture", tokens: { input: 999 } },
    parts: [part, { ...part, type: "text" }] };
  assert.deepEqual(decodeOpenCodeSchemaUsageParts([message], "ses_fixture"), [part]);
  assert.throws(() => decodeOpenCodeSchemaUsageParts([message], "ses_other"), /another session/);
  assert.throws(() => decodeOpenCodeSchemaUsageParts([{ ...message, parts: [{ ...part, messageID: "msg_other" }] }], "ses_fixture"),
    /another session/);
  assert.throws(() => decodeOpenCodeSchemaUsageParts({}, "ses_fixture"), /message array/);
});
