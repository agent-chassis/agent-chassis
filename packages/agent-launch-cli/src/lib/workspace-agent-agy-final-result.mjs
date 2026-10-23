

const TERMINAL_FAILURES = new Set(["ERROR", "CANCELED", "INTERRUPTED", "INVALID"]);
const PERMISSION_DENIAL = /\bsoft[- ]denied\b|\bpermission[^\n]*\bdenied\b|\btool[^\n]*\b(?:denied|requires approval|not allowed)\b/i;

export function decodeAgyFinalResult({ stdout, stderr = "", truncated = false } = {}) {
  const failure = (reason, detail = null) => Object.freeze({ ok: false, reason, detail });
  if (truncated) return failure("agy_output_truncated");
  if (/\[agy\] print timeout after /.test(stderr)) return failure("agy_print_timeout");
  if (typeof stdout !== "string" || stdout.trim().length === 0) {
    return failure("agy_result_missing");
  }
  let result;
  try {
    const lines = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    if (lines.length === 1 && lines[0].event === undefined) result = lines[0];
    else {
      const init = lines[0];
      if (init.event !== "init" || lines.at(-1).event !== "result" ||
          lines.filter(event => event.event === "result").length !== 1) return failure("agy_result_incomplete");
      result = lines.at(-1).result;
      if (!result || result.conversation_id !== init.conversation_id || lines.some(event =>
        event.step_update && event.step_update.conversation_id !== init.conversation_id)) return failure("agy_session_id_conflict");
      if (lines.some(event => !["init", "step_update", "result"].includes(event.event))) return failure("agy_event_type_invalid");
    }
  } catch (error) {
    return failure("agy_result_malformed", { message: error.message });
  }
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return failure("agy_result_malformed", { message: "expected one native JSON envelope" });
  }
  if (PERMISSION_DENIAL.test(stderr)) {
    return failure("agy_permission_denied", { diagnostic: stderr.split(/\r?\n/)
      .find((line) => PERMISSION_DENIAL.test(line)).slice(0, 1024) });
  }
  if (Array.isArray(result.denied_actions) && result.denied_actions.length > 0) {
    return failure("agy_permission_denied", { denied_actions: result.denied_actions });
  }
  if (TERMINAL_FAILURES.has(result.status) ||
      (result.error !== undefined && result.error !== "")) {
    return failure("agy_native_error", { status: result.status, error: result.error ?? null });
  }
  if (result.status !== "SUCCESS") {
    return failure("agy_result_incomplete", { status: result.status ?? null });
  }
  if (typeof result.conversation_id !== "string" || result.conversation_id.trim() === "") {
    return failure("agy_session_id_missing");
  }
  if (typeof result.response !== "string" || result.response.trim() === "") {
    return failure("agy_response_missing");
  }
  return Object.freeze({
    ok: true,
    text: result.response,
    nativeSessionId: result.conversation_id,
    structuredOutput: result.structured_output,
    enforcedSchema: result.json_schema
  });
}
