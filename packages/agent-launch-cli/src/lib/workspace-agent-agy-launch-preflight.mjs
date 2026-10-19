import path from "node:path";
import { realpath, readFile } from "node:fs/promises";
import { projectStdioMcpChannelClientRegistration } from "./stdio-mcp-conduit-channel.mjs";
import { resolveConfiguredAgentExecutable } from "@agent-chassis/agent-launch-core/src/lib/registry.mjs";
import { ensureLauncherRuntimeStateDir } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import { resolveAgentRoleResultSchemaJson } from "@agent-chassis/agent-launch-core/src/lib/agent-role-result-schema-path.mjs";
import { TERMINAL_STRUCTURED_ROLE_RESULT_MODES } from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import { resolveFamilyRuntimeExecutable, resolveFamilyRuntimeHomePolicyProfile, isWithinRepo } from "./launch-isolation.mjs";
import { resolveRoleGuideInstructions, withRoleGuideInstructionsPrompt } from "./role-guide-instructions.mjs";
import { buildAgyCommandLine } from "./workspace-agent-agy-launch-support.mjs";

export function buildAgyNativeConfiguration({ conduitBinding }) {
  const registration = projectStdioMcpChannelClientRegistration(conduitBinding);
  return { mcpServers: { wiki: { command: registration.command, args: [...registration.args],
    env: { ...registration.env } } } };
}

export function agyResultModePreflight(resultMode) {
  if (!Object.values(TERMINAL_STRUCTURED_ROLE_RESULT_MODES).includes(resultMode)) {
    throw new TypeError("Agy requires the launcher-frozen result mode");
  }
  return null;
}

export async function prepareAgyLaunch({ input, configurationWorkspaceDir, resultMode, prompt, env, options }) {
  if (!path.isAbsolute(configurationWorkspaceDir ?? "")) {
    throw Object.assign(new Error("Agy executable configuration requires the validated owning repository"),
      { code: "agy_configuration_owner_invalid" });
  }
  const guideDelivery = resolveRoleGuideInstructions({ role: input.role, selection: input.model_selection,
    workspaceDir: input.workspace_dir, registeredTier: options.registeredTier,
    publishControlledAcceptanceOptOut: options.publishControlledAcceptanceOptOut });
  if (guideDelivery?.highPriority !== true) {
    throw Object.assign(new Error("Agy requires explicit high_priority_role_guide delivery"),
      { code: "agy_native_guide_delivery_unavailable" });
  }
  const guide = await readFile(guideDelivery.guidePath, "utf8");

  if (Buffer.byteLength(guide) > 24000) throw Object.assign(new Error("Agy guide exceeds native rule file budget"),
    { code: "agy_native_guide_budget_exceeded" });
  let configured;
  try {
    configured = await (options.resolveConfiguredExecutable ?? resolveConfiguredAgentExecutable)({
      agentName: "agy", workspaceDir: configurationWorkspaceDir });
  } catch (error) {
    throw Object.assign(new Error(`Agy executable configuration in ${configurationWorkspaceDir}: ${error.message}`,
      { cause: error }), { code: error.code, detail: error.detail });
  }
  const resolved = resolveFamilyRuntimeHomePolicyProfile();
  if (!resolved.ok) throw Object.assign(new Error("Launcher host runtime facts unavailable"), resolved);
  const profile = resolved.profile;
  const executable = resolveFamilyRuntimeExecutable({ executablePath: configured.executable, pathEnv: env.PATH,
    approvedRuntimePrefixes: profile.executablePrefixes, familyRuntimePolicyProfile: profile, label: "agyExecutable" });
  const schema = resultMode === "schema_constrained" ? JSON.parse(resolveAgentRoleResultSchemaJson()) : null;
  const commandLine = buildAgyCommandLine({ executable: configured.executable, leadingArgs: configured.leadingArgs,
    model: input.model, effort: input.model_selection?.effort ?? input.default_effort,
    prompt: withRoleGuideInstructionsPrompt(prompt, guideDelivery), resultMode, schema,
    headless: options.headless ?? true, nativeSessionId: options.nativeSessionId ?? null,
    timeoutSeconds: options.timeoutSeconds });
  const credentialsFile = await realpath(path.join(profile.broadHome, ".gemini/antigravity-cli/antigravity-oauth-token"));
  let nativeOnboarding = null;
  if (options.headless === false) {
    const onboarding = JSON.parse(await readFile(path.join(profile.broadHome,
      ".gemini/antigravity-cli/cache/onboarding.json"), "utf8"));
    nativeOnboarding = Object.fromEntries(["consumerOnboardingComplete", "enterpriseOnboardingComplete", "onboardingComplete"]
      .filter(key => typeof onboarding[key] === "boolean").map(key => [key, onboarding[key]]));
  }
  if (!path.isAbsolute(input.workspace_dir ?? "")) throw new Error("agy_checkout_invalid");
  const runtimeState = await ensureLauncherRuntimeStateDir({ workspaceDir: input.workspace_dir, env });
  if (!runtimeState.ok || isWithinRepo(runtimeState.dir, input.workspace_dir)) {
    throw Object.assign(new Error("Agy native state requires an external launcher-owned runtime root"),
      { code: "agy_runtime_state_unavailable", detail: runtimeState });
  }
  return { commandLine, guideDelivery, guide, profile, executable, credentialsFile,
    runtimeStateDir: runtimeState.dir, workspaceDir: input.workspace_dir, schema, nativeOnboarding };
}
