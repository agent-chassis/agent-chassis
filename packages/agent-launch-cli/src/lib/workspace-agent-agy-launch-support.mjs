import { BACKEND_MISSING_RESULT_CODES } from "@agent-chassis/agent-launch-core";
import { buildMissingResultPayload, detectNoFindingsLine } from "./workspace-agent-launch-core.mjs";
import { buildFinalResultEnvelope, buildFindingsPayload, buildNoFindingsPayload } from "./workspace-agent-family-adapter-core.mjs";
import { decodeAgyFinalResult } from "./workspace-agent-agy-final-result.mjs";
import { isDeepStrictEqual } from "node:util";
import { parseAgentRoleResult } from "@agent-chassis/agent-launch-core/src/lib/agent-role-result.mjs";
import { resolveModelRuntime } from "./agent-launch-model-registry.mjs";
import { neutralEffortMapping, resolveExplicitOverrideSelection } from "./agent-launch-profiles.mjs";
import { buildFamilyModelFlagArgs, FAMILY_MODEL_DISPOSITIONS } from "./workspace-agent-family-policy.mjs";
import { TERMINAL_STRUCTURED_ROLE_RESULT_MODES } from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";

export const AGY_NATIVE_VERSION = "1.4.0";

export function buildAgyCommandLine({ executable, model, effort, prompt,
  leadingArgs = [],
  headless = true, resultMode, schema = null, nativeSessionId = null,

  timeoutSeconds = 0 } = {}) {
  const selection = resolveExplicitOverrideSelection({ app: "agy", model });
  if (!selection?.ok || selection.model === null) {
    throw new Error(`Agy requires an explicitly registered native model: ${model}`);
  }
  const selected = resolveModelRuntime(selection.model);
  const mapped = neutralEffortMapping({ family: "agy", effort });
  if (mapped?.effort !== selected.default_effort) {
    throw new Error(`Agy model ${model} requires effort ${selected.default_effort}; received ${effort}`);
  }
  if (typeof executable !== "string" || executable.length === 0 ||
      typeof prompt !== "string" || prompt.length === 0) {
    throw new TypeError("Agy executable and prompt are required");
  }
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 0) {
    throw new RangeError("Agy print timeout must be nonnegative integer seconds; 0 disables the native timer");
  }
  if (!Object.values(TERMINAL_STRUCTURED_ROLE_RESULT_MODES).includes(resultMode)) {
    throw new TypeError("Agy requires the launcher-frozen result mode");
  }
  const args = [...leadingArgs, ...buildFamilyModelFlagArgs({ disposition: FAMILY_MODEL_DISPOSITIONS.HONOR,
    model, flag: "--model" }), "--effort", mapped.effort, "--dangerously-skip-permissions"];
  if (resultMode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED) {
    if (!headless || schema === null || typeof schema !== "object" || Array.isArray(schema)) {
      throw new TypeError("Agy schema-constrained output requires a headless run and the launcher schema");
    }
    args.push("--json-schema", JSON.stringify(schema));
  }
  if (nativeSessionId !== null) {
    if (typeof nativeSessionId !== "string" || nativeSessionId.trim().length === 0) {
      throw new TypeError("Agy resume requires an observed explicit native session ID");
    }
    args.push("--conversation", nativeSessionId);
  }
  if (headless) args.push("--output-format", "stream-json", "--print-timeout", `${timeoutSeconds}s`,
    "--disable-slash-commands", "--print", prompt);
  else args.push("--prompt-interactive", prompt);
  return Object.freeze({ command: executable, args: Object.freeze(args), resultMode });
}

export function captureAgyFinalResult({ status, exit, stdout, stderr, role, subject, schema = null } = {}) {
  const missing = (reason, detail) => buildMissingResultPayload(
    BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED, reason, detail);
  const decoded = decodeAgyFinalResult({ stdout, stderr });
  if (!decoded.ok && ["agy_native_error", "agy_native_tool_error"].includes(decoded.reason)) {
    return missing(decoded.reason, { ...(decoded.detail ?? {}), exit: exit ?? null,
      native_session_id: decoded.nativeSessionId });
  }
  if (status !== "succeeded" || exit?.code !== 0 || exit?.signal || exit?.error) {
    return missing("agy_process_failed", { exit: exit ?? null });
  }
  if (!decoded.ok) return missing(decoded.reason, {
    ...(decoded.detail ?? {}), native_session_id: decoded.nativeSessionId
  });
  if (schema !== null && (decoded.structuredOutput === undefined || !isDeepStrictEqual(decoded.enforcedSchema, schema))) {
    return missing("agy_native_schema_not_enforced", { native_session_id: decoded.nativeSessionId });
  }
  const text = schema === null ? decoded.text : JSON.stringify(decoded.structuredOutput);
  if (schema !== null && !parseAgentRoleResult(text).valid) {
    return missing("agy_native_schema_output_invalid", { native_session_id: decoded.nativeSessionId });
  }
  const source = { native_session_id: decoded.nativeSessionId,
    native_version: AGY_NATIVE_VERSION };
  const noFindings = detectNoFindingsLine(text);
  return buildFinalResultEnvelope({ kind: noFindings ? "no_findings" : "findings",
    payload: noFindings
      ? buildNoFindingsPayload({ reason: noFindings, format: "markdown", role, subject, source, text })
      : buildFindingsPayload({ schemaVersion: "agy-final-message.v1", format: schema === null ? "markdown" : "json",
          role, subject, source, text }) });
}
