import { neutralEffortMapping, resolveExplicitOverrideSelection, OPENCODE_NATIVE_MODEL_CAPABILITIES } from "./agent-launch-profiles.mjs";
import { buildFamilyModelFlagArgs, FAMILY_MODEL_DISPOSITIONS } from "./workspace-agent-family-policy.mjs";
import { TERMINAL_STRUCTURED_ROLE_RESULT_MODES } from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import { BACKEND_MISSING_RESULT_CODES } from "@agent-chassis/agent-launch-core";
import { buildMissingResultPayload, detectNoFindingsLine } from "./workspace-agent-launch-core.mjs";
import { buildFinalResultEnvelope, buildFindingsPayload, buildNoFindingsPayload } from "./workspace-agent-family-adapter-core.mjs";
import { decodeOpenCodeEventStream, isOpenCodeNativeSessionId } from "./workspace-agent-opencode-final-result.mjs";
import { resolveAgentRoleResultSchemaJson } from "@agent-chassis/agent-launch-core/src/lib/agent-role-result-schema-path.mjs";

export const OPENCODE_NATIVE_VERSION = "1.19.3";

export function buildOpenCodeCommandLine({ executable, leadingArgs = [], model,
  effort, prompt, headless = true, resultMode, nativeSessionId = null } = {}) {
  const selected = resolveExplicitOverrideSelection({ app: "opencode", model });
  if (!selected?.ok || selected.model === null) throw new Error(`OpenCode requires an explicitly registered provider/model: ${model}`);
  const nativeModel = OPENCODE_NATIVE_MODEL_CAPABILITIES[selected.model];
  const mapped = neutralEffortMapping({ family: "opencode", effort });
  if (!nativeModel || typeof mapped?.variant !== "string" || !nativeModel.variants.includes(mapped.variant)) {
    throw Object.assign(new Error(`OpenCode effort variant ${effort} is unavailable for ${model}`),
      { code: "opencode_model_effort_unavailable", detail: { model, effort, supported_variants: nativeModel?.variants ?? [] } });
  }
  if (typeof executable !== "string" || executable.length === 0 ||
      typeof prompt !== "string" || prompt.length === 0) throw new TypeError("OpenCode executable and prompt are required");
  if (!Object.values(TERMINAL_STRUCTURED_ROLE_RESULT_MODES).includes(resultMode)) {
    throw new TypeError("OpenCode requires the launcher-frozen result mode");
  }
  if (resultMode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED) {
    if (!headless || nativeSessionId !== null) throw new TypeError("OpenCode schema workers require a fresh headless native session");
    const [providerID, ...modelParts] = model.split("/");
    return Object.freeze({ command: executable, resultMode, nativeModel,
      args: Object.freeze([...leadingArgs, "serve", "--pure", "--hostname", "127.0.0.1", "--port", "0", "--mdns=false"]),
      nativePrompt: Object.freeze({ model: { providerID, modelID: modelParts.join("/") },
        agent: "launcher", variant: mapped.variant,
        format: { type: "json_schema", schema: JSON.parse(resolveAgentRoleResultSchemaJson()) },
        parts: [{ type: "text", text: prompt }] }) });
  }
  if (nativeSessionId !== null && !isOpenCodeNativeSessionId(nativeSessionId)) {
    throw new TypeError("OpenCode resume requires an observed explicit native session ID");
  }
  const args = [...leadingArgs, ...(headless ? ["run", "--format", "json"] : []), "--pure",
    ...buildFamilyModelFlagArgs({ disposition: FAMILY_MODEL_DISPOSITIONS.HONOR, model, flag: "--model" }),
    ...(headless ? ["--variant", mapped.variant] : []), "--agent", "launcher"];
  if (nativeSessionId !== null) args.push("--session", nativeSessionId);
  if (headless) args.push("--", prompt);
  else args.push("--prompt", prompt);
  return Object.freeze({ command: executable, args: Object.freeze(args), resultMode, nativeModel });
}

export function captureOpenCodeFinalResult({ status, exit, stdout, role, subject } = {}) {
  const missing = (reason, detail) => buildMissingResultPayload(
    BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED, reason, detail);
  const decoded = decodeOpenCodeEventStream(stdout);
  if (!decoded.ok && ["opencode_native_error", "opencode_native_tool_error"].includes(decoded.reason)) {
    return missing(decoded.reason, { ...(decoded.detail ?? {}), exit: exit ?? null,
      native_session_id: decoded.nativeSessionId });
  }
  if (status !== "succeeded" || exit?.code !== 0 || exit?.signal || exit?.error) {
    return missing("opencode_process_failed", { exit: exit ?? null });
  }
  if (!decoded.ok) return missing(decoded.reason, {
    ...(decoded.detail ?? {}), native_session_id: decoded.nativeSessionId
  });
  const source = { native_session_id: decoded.nativeSessionId,
    native_message_id: decoded.terminalMessageId, native_version: OPENCODE_NATIVE_VERSION };
  const noFindings = detectNoFindingsLine(decoded.text);
  return buildFinalResultEnvelope({ kind: noFindings ? "no_findings" : "findings",
    payload: noFindings
      ? buildNoFindingsPayload({ reason: noFindings, format: "markdown", role, subject, source, text: decoded.text })
      : buildFindingsPayload({ schemaVersion: "opencode-final-message.v1", format: "markdown",
          role, subject, source, text: decoded.text }) });
}
