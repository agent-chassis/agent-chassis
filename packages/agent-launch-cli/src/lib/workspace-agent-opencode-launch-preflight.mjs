import { isConfiguredOpenCodeModel } from "./agent-launch-role-config.mjs";
import { projectStdioMcpChannelClientRegistration } from "./stdio-mcp-conduit-channel.mjs";
import { TERMINAL_STRUCTURED_ROLE_RESULT_MODES } from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import { resolveConfiguredAgentExecutable } from "@agent-chassis/agent-launch-core/src/lib/registry.mjs";
import { resolveFamilyRuntimeExecutable, resolveFamilyRuntimeHomePolicyProfile } from "./launch-isolation.mjs";
import { resolveRoleGuideInstructions, withRoleGuideInstructionsPrompt } from "./role-guide-instructions.mjs";
import { buildOpenCodeCommandLine } from "./workspace-agent-opencode-launch-support.mjs";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { ensureLauncherRuntimeStateDir } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import { isWithinRepo } from "./launch-isolation.mjs";
import { serializeOpenCodeNativePermissions } from "./workspace-agent-opencode-native-permissions.mjs";

export function buildOpenCodeNativeConfiguration({ conduitBinding, model, guideDelivery, effort, permissionFacts, opencode = null } = {}) {
  const registration = projectStdioMcpChannelClientRegistration(conduitBinding);
  if (!guideDelivery?.guidePath || guideDelivery.highPriority !== true) {
    throw new Error("opencode_native_guide_delivery_unavailable: lower-priority compact reminders are unqualified");
  }

  return Object.freeze({ ...opencode, instructions: [], plugin: [], model, small_model: model, default_agent: "launcher", share: "disabled", autoupdate: false,
    permission: serializeOpenCodeNativePermissions(permissionFacts),
    agent: { launcher: { mode: "primary", model, ...(effort == null ? {} : { variant: effort }), prompt: `{file:${guideDelivery.guidePath}}` } },
    mcp: { wiki: { type: "local", command: [registration.command, ...registration.args],
      environment: { ...registration.env }, enabled: true } } });
}

export async function prepareOpenCodeLaunch({ input, resultMode, prompt, env, options }) {
  const guideDelivery = resolveRoleGuideInstructions({ role: input.role, selection: input.model_selection,
    workspaceDir: input.workspace_dir, registeredTier: options.registeredTier,
    publishControlledAcceptanceOptOut: options.publishControlledAcceptanceOptOut });
  if (guideDelivery?.highPriority !== true) {
    throw Object.assign(new Error("OpenCode lower-priority guide retention is unqualified; select high_priority_role_guide explicitly"),
      { code: "opencode_native_guide_delivery_unavailable" });
  }
  const configured = await (options.resolveConfiguredExecutable ?? resolveConfiguredAgentExecutable)({
    agentName: "opencode", workspaceDir: input.workspace_dir });
  const resolvedProfile = resolveFamilyRuntimeHomePolicyProfile();
  if (!resolvedProfile.ok) throw Object.assign(new Error("Launcher host runtime facts unavailable"), resolvedProfile);
  const profile = resolvedProfile.profile;
  const executable = resolveFamilyRuntimeExecutable({ executablePath: configured.executable, pathEnv: env.PATH,
    approvedRuntimePrefixes: profile.executablePrefixes, familyRuntimePolicyProfile: profile,
    label: "opencodeExecutable" });
  let ripgrep;
  try {
    ripgrep = (options.resolveRipgrepExecutable ?? resolveFamilyRuntimeExecutable)({ executablePath: "rg", pathEnv: env.PATH,
      approvedRuntimePrefixes: profile.executablePrefixes, familyRuntimePolicyProfile: profile,
      label: "opencodeRipgrep" });
  } catch (cause) {
    throw Object.assign(new Error("OpenCode native Glob/Grep require preinstalled ripgrep on the launcher PATH; install it or rebuild the prepared image before launch", { cause }),
      { code: "opencode_ripgrep_unavailable" });
  }
  const effort = input.model_selection === undefined ? input.default_effort : input.model_selection.effort;
  const commandLine = buildOpenCodeCommandLine({ executable: configured.executable, leadingArgs: configured.leadingArgs,
    model: input.model, effort,
    opencode: input.model_selection?.opencode,
    prompt: withRoleGuideInstructionsPrompt(prompt, guideDelivery), resultMode,
    headless: options.headless ?? true, nativeSessionId: options.nativeSessionId ?? null });

  let provider = null;
  let credentialsFile = null;
  if (!isConfiguredOpenCodeModel(input.model, input.model_selection?.opencode)
      && typeof env.GOOGLE_APPLICATION_CREDENTIALS === "string") {
    credentialsFile = await realpath(env.GOOGLE_APPLICATION_CREDENTIALS);
    const credential = JSON.parse(await readFile(credentialsFile, "utf8"));
    if (credential.type !== "service_account" || typeof credential.project_id !== "string") {
      throw Object.assign(new Error("OpenCode Vertex authentication requires the existing service-account credential"),
        { code: "opencode_provider_authentication_unavailable" });
    }
    provider = { [commandLine.nativeModel.provider]: { options: { project: credential.project_id, location: commandLine.nativeModel.location,
      googleAuthOptions: { keyFilename: credentialsFile } } } };
  }
  if (typeof input.workspace_dir !== "string" || !path.isAbsolute(input.workspace_dir)) {
    throw Object.assign(new Error("OpenCode requires the assigned absolute checkout"), { code: "opencode_checkout_invalid" });
  }
  const runtimeState = await ensureLauncherRuntimeStateDir({ workspaceDir: input.workspace_dir, env });
  if (!runtimeState.ok || isWithinRepo(runtimeState.dir, input.workspace_dir)) {
    throw Object.assign(new Error("OpenCode native state requires an external launcher-owned runtime root"),
      { code: "opencode_runtime_state_unavailable", detail: runtimeState });
  }
  return { commandLine, guideDelivery, profile, executable, provider, credentialsFile, model: input.model,
    opencode: input.model_selection?.opencode ?? null,
    runtimeReadOnlyRoots: ripgrep.readOnlyRoots,
    runtimeStateDir: runtimeState.dir, effort,
    nativePermissionContext: { role: input.role, workspaceDir: await realpath(input.workspace_dir),
      registeredTier: options.registeredTier,
      publishControlledAcceptanceOptOut: options.publishControlledAcceptanceOptOut } };
}

export function openCodeResultModePreflight(resultMode) {
  if (!Object.values(TERMINAL_STRUCTURED_ROLE_RESULT_MODES).includes(resultMode)) {
    throw new TypeError("OpenCode requires the launcher-frozen result mode");
  }
  return null;
}
