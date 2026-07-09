import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  writeJsonAtomic
} from "@agent-chassis/agent-launch-core/src/lib/filesystem.mjs";
import {
  assertFile,
  isDirectory,
  writeLine,
  writeRaw,
  writeStderr
} from "./codex-role-io.mjs";
import {
  appendRepoProfileThreadSuffix
} from "./agent-launch-repo-profile-config.mjs";
import {
  WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR,
  WIKI_MCP_SERVER_PACKAGE_SUBPATH,
  ensureWikiMcpResponseStateDir,
  resolveLauncherConfiguredWorkspaceAlias,
  resolveWikiMcpServerPath
} from "./codex-role-mcp-env.mjs";
import {
  titleFromPage
} from "./codex-role-orchestrator-history.mjs";

import {
  sanitizeOrchestratorPathSegment
} from "./orchestrator-launch-settings.mjs";
import {
  CLAUDE_ORCHESTRATOR_HEADLESS_COORDINATION_EDIT_ALLOW,
  CLAUDE_ORCHESTRATOR_HEADLESS_DENY_TOOLS,
  CLAUDE_ORCHESTRATOR_HEADLESS_MODE,
  CLAUDE_ORCHESTRATOR_MCP_CONFIG_SCHEMA_VERSION,
  buildClaudeOrchestratorHeadlessPermissionSettings,
  buildClaudeOrchestratorMcpConfig,
  isValidClaudeOrchestratorWorkspaceAlias,
  resolveClaudeOrchestratorLocalSettings
} from "./claude-orchestrator-plan-settings.mjs";

import {
  createOrchestratorDispatchSidecarAdapter,
  startOrchestratorDispatchSidecar
} from "./orchestrator-dispatch-sidecar.mjs";
import {
  HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR
} from "./host-write-authority-substrate.mjs";
import {
  createHostWriteAuthorityBrokerPlanLaunch
} from "./workspace-agent-dispatch-codex-executor.mjs";
import {
  createHostWriteAuthorityBrokerClaudePlanLaunch,
  resolveLauncherOwnedClaudeRuntimeFacts
} from "./workspace-agent-dispatch-claude-executor.mjs";
import {
  createHostWriteAuthorityBrokerAgyPlanLaunch
} from "./workspace-agent-dispatch-agy-executor.mjs";
import {
  buildInteractiveOrchestratorBwrapPlan,
  resolveFamilyRuntimeExecutable,
  spawnIsolated
} from "./launch-isolation.mjs";

import {
  buildInteractiveOrchestratorLaunchPlan,
  buildHeadlessOrchestratorBwrapPlan,
  probeOrchestratorBwrapAvailability,
  ORCHESTRATOR_ISOLATION_MODES,
  OPERATOR_DIRECT_MODE_WARNING
} from "./orchestrator-launch-isolation.mjs";
import {
  renderLauncherFamilyOrchestratorPrompt
} from "./workspace-agent-role-contract.mjs";

import {
  hasResumableOrchestratorSession,
  superviseInteractiveOrchestratorLaunch,
  resolveHeadlessLogTarget,
  openHeadlessStdio,
  HeadlessDirectModeError,
  ORCHESTRATOR_INTERACTIVE_STDIO
} from "./orchestrator-launch-runtime.mjs";

import {
  mintLauncherOwnedClaudeNativePermissionSettings,
  probeClaudeNativePermissionEnforcement,
  CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
  CLAUDE_NATIVE_PERMISSION_PROBE_UNPROVEN_REASON
} from "./workspace-agent-claude-launch-support.mjs";

import {
  makeOrchestratorRefusal,
  composeOrchestratorRefusalReason,
  ORCHESTRATOR_REFUSAL_REASON_KINDS
} from "./orchestrator-refusal-taxonomy.mjs";
import {
  LAUNCHER_WRITE_POSTURES,
  LAUNCHER_WRITE_POSTURE_FAMILIES,
  resolveLauncherRoleWritePosture
} from "./workspace-agent-family-policy.mjs";

const CLAUDE_ORCHESTRATOR_HEADLESS_SETTINGS_RUNTIME_DIR =
  "headless-native-permission-settings";
const CLAUDE_ORCHESTRATOR_HEADLESS_SETTINGS_PROJECTED_PATH =
  "<launcher-minted-headless-settings>/settings.json";

export const CLAUDE_ORCHESTRATOR_PLAN_SCHEMA_VERSION =
  "claude-orchestrator-plan.v1";
export const CLAUDE_ORCHESTRATOR_RUNTIME_STATE_SCHEMA_VERSION =
  "claude-orchestrator-runtime-state.v1";

export {
  CLAUDE_ORCHESTRATOR_HEADLESS_COORDINATION_EDIT_ALLOW,
  CLAUDE_ORCHESTRATOR_HEADLESS_DENY_TOOLS,
  CLAUDE_ORCHESTRATOR_HEADLESS_MODE,
  CLAUDE_ORCHESTRATOR_MCP_CONFIG_SCHEMA_VERSION,
  buildClaudeOrchestratorHeadlessPermissionSettings
} from "./claude-orchestrator-plan-settings.mjs";

export const CLAUDE_ORCHESTRATOR_STATE_DIR_NAME = "claude-orch";

const CLAUDE_ORCHESTRATOR_COMMAND = "claude";

export const CLAUDE_ORCHESTRATOR_NO_PRIOR_SESSION_REASON =
  composeOrchestratorRefusalReason(
    CLAUDE_ORCHESTRATOR_COMMAND,
    ORCHESTRATOR_REFUSAL_REASON_KINDS.NO_PRIOR_SESSION
  );
export const CLAUDE_ORCHESTRATOR_LOCAL_CONFIG_REFUSAL_REASON =
  composeOrchestratorRefusalReason(
    CLAUDE_ORCHESTRATOR_COMMAND,
    ORCHESTRATOR_REFUSAL_REASON_KINDS.LOCAL_CONFIG_INVALID
  );

export const CLAUDE_ORCHESTRATOR_WIKI_MCP_UNRESOLVED_REASON =
  composeOrchestratorRefusalReason(
    CLAUDE_ORCHESTRATOR_COMMAND,
    ORCHESTRATOR_REFUSAL_REASON_KINDS.WIKI_MCP_UNRESOLVED
  );

function makeRefusal(code, message, detail = null) {
  return makeOrchestratorRefusal({
    command: CLAUDE_ORCHESTRATOR_COMMAND,
    code,
    message,
    detail
  });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function projectedClaudeOrchestratorHeadlessSettingsPath(runtimeDir) {
  return path.join(
    runtimeDir,
    CLAUDE_ORCHESTRATOR_HEADLESS_SETTINGS_RUNTIME_DIR,
    CLAUDE_ORCHESTRATOR_HEADLESS_SETTINGS_PROJECTED_PATH
  );
}

function withClaudeOrchestratorHeadlessSettingsPath(args, settingsPath) {
  const nextArgs = [...args];
  const settingsIndex = nextArgs.indexOf("--settings");
  if (settingsIndex === -1) {
    throw new Error("claude-orchestrator: headless argv is missing --settings");
  }
  nextArgs[settingsIndex + 1] = settingsPath;
  return nextArgs;
}

async function findRepoRoot(start) {
  let current = path.resolve(start);
  if (!(await isDirectory(current))) {
    current = path.dirname(current);
  }
  while (true) {
    if (
      await isDirectory(path.join(current, "wiki")) &&
      await isDirectory(path.join(current, "docs"))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`expected repo with wiki/ and docs/ at or above: ${start}`);
    }
    current = parent;
  }
}

function claudeOrchestratorStateDirFor({ env, repo, initiative }) {
  const base = path.join(
    env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
    CLAUDE_ORCHESTRATOR_STATE_DIR_NAME
  );
  return path.join(
    base,
    sanitizeOrchestratorPathSegment(repo),
    sanitizeOrchestratorPathSegment(initiative)
  );
}

function buildClaudeOrchestratorPrompt({ initiative, threadName, focus, headless = false }) {

  return renderLauncherFamilyOrchestratorPrompt({ appName: "Claude", renameHintLabel: "Claude", initiative, threadName, focus, headless });
}

export async function buildClaudeOrchestratorPlan({
  role,
  initiative,
  promptArgs = [],
  env = process.env,
  cwd = process.cwd(),
  resolvedProfile = null,
  resolveWikiMcpServer = resolveWikiMcpServerPath,
  probeBwrapAvailability = probeOrchestratorBwrapAvailability,

  headless = false,
  logFile = null,
  dispatchWorktreeRoot = null,
  mintNativePermissionSettings = mintLauncherOwnedClaudeNativePermissionSettings
} = {}) {
  if (role !== "orch" && role !== "orch-resume") {
    throw new Error(`buildClaudeOrchestratorPlan only supports orch/orch-resume (got ${role})`);
  }
  const isHeadless = headless === true && role !== "orch-resume";
  if (!isNonEmptyString(initiative) || !/^IN-[0-9]+$/.test(initiative)) {
    throw new Error(`claude-orchestrator: expected initiative id like IN-0004, got: ${initiative}`);
  }

  const mcpServerPath = resolveWikiMcpServer();
  if (!isNonEmptyString(mcpServerPath)) {
    return makeRefusal(
      CLAUDE_ORCHESTRATOR_WIKI_MCP_UNRESOLVED_REASON,
      `claude-orchestrator: cannot resolve the wiki MCP server from the installed ` +
        `${WIKI_MCP_SERVER_PACKAGE_SUBPATH} package; @agent-chassis/wiki-mcp ` +
        `installs with @agent-chassis/agent-launch-cli, so reinstall the launcher ` +
        `package in the launching environment`,
      { wiki_mcp_package_subpath: WIKI_MCP_SERVER_PACKAGE_SUBPATH }
    );
  }

  const repo = await findRepoRoot(cwd);
  const initiativePath = path.join(repo, "wiki", "initiatives", `${initiative}.md`);
  await assertFile(initiativePath, `${role}: missing initiative page`);
  const repoName = path.basename(repo);
  const runtimeDir = claudeOrchestratorStateDirFor({ env, repo, initiative });
  const responseStateDir = ensureWikiMcpResponseStateDir({
    runtimeDir,
    workspaceDir: repo
  });
  const title = await titleFromPage(initiativePath);

  const localSettings = resolveClaudeOrchestratorLocalSettings({
    repo,
    initiative,
    resolvedProfile,
    localConfigRefusalReason: CLAUDE_ORCHESTRATOR_LOCAL_CONFIG_REFUSAL_REASON,
    stateDirName: CLAUDE_ORCHESTRATOR_STATE_DIR_NAME
  });
  if (localSettings.refusal) {
    return makeRefusal(
      localSettings.refusal.code,
      localSettings.refusal.message,
      localSettings.refusal.detail
    );
  }

  const threadName = appendRepoProfileThreadSuffix(
    localSettings.settings.threadName,
    localSettings.settings.thread_suffix
  );
  const workspaceAlias = resolveLauncherConfiguredWorkspaceAlias({
    env,
    repo,
    mcpServerName: "wiki"
  });
  const workspaceDir = repo;
  const model = localSettings.settings.model;
  const effort = localSettings.settings.effort;
  const prompt = role === "orch-resume"
    ? null
    : buildClaudeOrchestratorPrompt({
        initiative,
        threadName,
        focus: promptArgs.join(" "),
        headless: isHeadless
      });
  const mcpConfigPath = path.join(runtimeDir, "mcp-config.json");
  const mcpConfigBase = buildClaudeOrchestratorMcpConfig({
    repo,
    mcpServerPath,
    workspaceAlias,
    workspaceDir,
    dispatchWorktreeRoot,
    responseStateDir,
    initiative,
    threadName,
    model,
    effort
  });

  await writeJsonAtomic(mcpConfigPath, mcpConfigBase);

  const orchEnv = {
    ...env,
    AGENT_ROLE: "orchestrator",
    AGENT_IN: initiative,
    CLAUDE_ORCH_THREAD_NAME: threadName,
    CLAUDE_ORCH_RUNTIME_DIR: runtimeDir,
    [WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR]: responseStateDir,
    WIKI_MCP_WORKSPACE_DIR: workspaceDir
  };
  if (isValidClaudeOrchestratorWorkspaceAlias(workspaceAlias)) {
    orchEnv.WIKI_MCP_WORKSPACE_ALIAS = workspaceAlias;
  } else {
    delete orchEnv.WIKI_MCP_WORKSPACE_ALIAS;
  }
  delete orchEnv[HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR];

  const writePosture = resolveLauncherRoleWritePosture({
    role: "orchestrator",
    family: LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT
  });
  if (
    writePosture.ok !== true ||
    writePosture.posture !== LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE
  ) {
    throw new Error("claude-orchestrator: shared launcher write-posture did not return coordination-write posture");
  }

  const headlessSettings = isHeadless
    ? buildClaudeOrchestratorHeadlessPermissionSettings()
    : null;
  const headlessSettingsPath = isHeadless
    ? projectedClaudeOrchestratorHeadlessSettingsPath(runtimeDir)
    : null;
  if (
    isHeadless &&
    mintNativePermissionSettings !== mintLauncherOwnedClaudeNativePermissionSettings
  ) {
    const availability = await mintNativePermissionSettings({
      workspaceDir: repo,
      writeScope: [],
      env,
      buildSettings: () => buildClaudeOrchestratorHeadlessPermissionSettings()
    });
    if (availability && availability.ok === false) {
      return makeRefusal(
        availability.code ?? CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
        availability.reason ?? "launcher could not mint Claude headless orchestrator native-permission settings",
        availability.detail ?? null
      );
    }
  }

  const args = [
    "--permission-mode",
    "default",
    "--disallowedTools",
    "Bash",
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config"
  ];

  if (isHeadless) {
    args.push("--print", "--settings", headlessSettingsPath);
  }
  if (isNonEmptyString(model)) {
    args.push("--model", model);
  }
  if (role === "orch-resume") {
    args.push("--resume");
  } else if (isNonEmptyString(prompt)) {
    args.push(prompt);
  }

  const isolation = buildClaudeOrchestratorIsolationSummary(
    probeBwrapAvailability({ env: orchEnv })
  );

  let headlessLogTarget = null;
  if (isHeadless) {
    try {
      headlessLogTarget = resolveHeadlessLogTarget({
        runtimeDir,
        logFileOverride: logFile,
        isolationMode: isolation.mode
      });
    } catch (error) {
      if (error instanceof HeadlessDirectModeError) {
        return makeRefusal(error.code, error.reason, { isolation_mode: isolation.mode });
      }
      throw error;
    }
  }

  return {
    schema_version: CLAUDE_ORCHESTRATOR_PLAN_SCHEMA_VERSION,
    planner_kind: "claude_orchestrator",
    mode: isHeadless ? CLAUDE_ORCHESTRATOR_HEADLESS_MODE : "interactive",
    role,
    subject: initiative,
    repo,
    repo_name: repoName,
    runtimeDir,
    dispatchWorktreeRoot,
    isolation,
    headless: isHeadless,
    headlessLogTarget,
    headlessSettings,
    headlessSettingsPath,
    threadName,
    title,
    command: "claude",
    args,
    env: orchEnv,
    mcpServerPath,
    mcpConfigPath,
    mcpConfigBase,
    mcpConfig: { ...mcpConfigBase },
    settings: {
      model,
      effort,
      model_source: localSettings.settings.model_source,
      effort_source: localSettings.settings.effort_source,
      local_config_source: localSettings.localConfig.source,
      local_config_values: localSettings.localConfig.values
    },
    dispatchSidecar: {
      kind: "host_write_authority_localhost",
      host: "127.0.0.1",
      envVar: HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR,
      mcpServerName: "wiki"
    }
  };
}

function publicClaudeOrchestratorPlan(plan) {
  return {
    schema_version: plan.schema_version,
    planner_kind: plan.planner_kind,
    mode: plan.mode,
    role: plan.role,
    subject: plan.subject,
    repo: plan.repo,
    repo_name: plan.repo_name,
    runtime_dir: plan.runtimeDir,

    isolation: plan.isolation,

    headless: plan.headless === true,
    headless_log_target: plan.headlessLogTarget ?? null,
    headless_settings: plan.headlessSettings ?? null,
    thread_name: plan.threadName,
    title: plan.title,
    command: plan.command,
    args: plan.args,
    settings: plan.settings,
    mcp_config_path: plan.mcpConfigPath,
    dispatch_sidecar: plan.dispatchSidecar,
    env: {
      AGENT_ROLE: plan.env.AGENT_ROLE,
      AGENT_IN: plan.env.AGENT_IN,
      CLAUDE_ORCH_THREAD_NAME: plan.env.CLAUDE_ORCH_THREAD_NAME,
      CLAUDE_ORCH_RUNTIME_DIR: plan.env.CLAUDE_ORCH_RUNTIME_DIR,
      WIKI_MCP_RESPONSE_STATE_DIR: plan.env.WIKI_MCP_RESPONSE_STATE_DIR,
      WIKI_MCP_WORKSPACE_ALIAS: plan.env.WIKI_MCP_WORKSPACE_ALIAS ?? null,
      WIKI_MCP_WORKSPACE_DIR: plan.env.WIKI_MCP_WORKSPACE_DIR
    }
  };
}

function writeClaudeOrchestratorMcpConfig(plan, endpointValue = null) {
  const nextConfig = buildClaudeOrchestratorMcpConfig({
    repo: plan.repo,
    mcpServerPath: plan.mcpServerPath,
    workspaceAlias: plan.env.WIKI_MCP_WORKSPACE_ALIAS ?? null,
    workspaceDir: plan.env.WIKI_MCP_WORKSPACE_DIR,
    dispatchWorktreeRoot: plan.dispatchWorktreeRoot,
    responseStateDir: plan.env.WIKI_MCP_RESPONSE_STATE_DIR,
    endpointValue,
    initiative: plan.subject,
    threadName: plan.threadName,
    model: plan.settings?.model ?? null,
    effort: plan.settings?.effort ?? null
  });
  plan.mcpConfig = nextConfig;
  return nextConfig;
}

export function createClaudeOrchestratorDispatchSidecarAdapter() {

  return createOrchestratorDispatchSidecarAdapter({
    createBrokerPlanLaunch: ({ env, cwd }) =>
      createHostWriteAuthorityBrokerClaudePlanLaunch({ env, cwd }),
    appPlanLaunchBuilders: {
      codex: ({ env, cwd }) => createHostWriteAuthorityBrokerPlanLaunch({ env, cwd }),
      claude: ({ env, cwd }) => createHostWriteAuthorityBrokerClaudePlanLaunch({ env, cwd }),
      agy: ({ env, cwd }) => createHostWriteAuthorityBrokerAgyPlanLaunch({ env, cwd })
    },
    spawnLaunch: (bwrapPlan, opts) => spawnIsolated(bwrapPlan, opts),
    applyEndpointToPlan: ({ plan, endpointValue }) => {
      writeClaudeOrchestratorMcpConfig(plan, endpointValue);
      return {
        mcpConfigPath: plan.mcpConfigPath,
        endpointValue,
        schema_version: CLAUDE_ORCHESTRATOR_MCP_CONFIG_SCHEMA_VERSION
      };
    },
    removeEndpointFromPlan: ({ plan, applyContext }) => {
      writeClaudeOrchestratorMcpConfig(plan, null);
      return applyContext ?? null;
    }
  });
}

function claudeOrchestratorSessionDescriptor(plan) {
  return {
    schema_version: CLAUDE_ORCHESTRATOR_RUNTIME_STATE_SCHEMA_VERSION,
    planner_kind: plan.planner_kind,
    mode: plan.mode,
    role: plan.role,
    subject: plan.subject,
    repo: plan.repo,
    repo_name: plan.repo_name,
    runtime_dir: plan.runtimeDir,
    thread_name: plan.threadName,
    title: plan.title,
    command: plan.command,
    args: plan.args,
    settings: plan.settings
  };
}

function claudeOrchestratorIsolationProfile({
  plan,
  resolveExecutable = resolveFamilyRuntimeExecutable,
  launcherOwnedHostHome = null,
  resolveClaudeRuntimeFacts = resolveLauncherOwnedClaudeRuntimeFacts
}) {
  const runtimeFactsResult = resolveClaudeRuntimeFacts({
    launcherOwnedHostHome: typeof launcherOwnedHostHome === "string" ? launcherOwnedHostHome : undefined,
    platform: os.platform()
  });
  if (!runtimeFactsResult || runtimeFactsResult.ok !== true) {
    const err = new Error(runtimeFactsResult?.reason ?? "launcher_runtime_home_fact_unresolvable");
    err.code = runtimeFactsResult?.reason ?? "launcher_runtime_home_fact_unresolvable";
    err.detail = runtimeFactsResult?.detail ?? { fact: "claude_orchestrator_host_home" };
    throw err;
  }
  const runtimeFacts = runtimeFactsResult.facts;
  const policyFacts = runtimeFacts.policyFacts;
  const hostHome = policyFacts.launcherOwnedHostHome;

  return {
    repo: plan.repo,
    command: plan.command,
    args: plan.args,
    env: plan.env,
    runtimeDir: plan.runtimeDir,
    appStateHomeDir: policyFacts.paths.claudeDirectory,
    homeReadOnlyFiles: [path.join(hostHome, ".claude.json")],
    familyRuntimeReadOnlyRoots: [runtimeFacts.readOnlyRoot],
    familyRuntimePolicyProfile: runtimeFacts.familyRuntimePolicyProfile,
    resolveExecutable
  };
}

export function buildClaudeOrchestratorBwrapPlan({
  plan,
  resolveExecutable = resolveFamilyRuntimeExecutable,
  launcherOwnedHostHome = null,
  resolveClaudeRuntimeFacts = resolveLauncherOwnedClaudeRuntimeFacts
} = {}) {
  return buildInteractiveOrchestratorBwrapPlan(
    claudeOrchestratorIsolationProfile({
      plan,
      resolveExecutable,
      launcherOwnedHostHome,
      resolveClaudeRuntimeFacts
    })
  );
}

export function buildClaudeOrchestratorLaunchPlan({
  plan,
  resolveExecutable = resolveFamilyRuntimeExecutable,
  launcherOwnedHostHome = null,
  resolveClaudeRuntimeFacts = resolveLauncherOwnedClaudeRuntimeFacts,
  operatorDirectModeAllowed = true
} = {}) {
  return buildInteractiveOrchestratorLaunchPlan({
    operatorDirectModeAllowed,
    ...claudeOrchestratorIsolationProfile({
      plan,
      resolveExecutable,
      launcherOwnedHostHome,
      resolveClaudeRuntimeFacts
    })
  });
}

export function buildClaudeOrchestratorHeadlessLaunchPlan({
  plan,
  resolveExecutable = resolveFamilyRuntimeExecutable,
  launcherOwnedHostHome = null,
  resolveClaudeRuntimeFacts = resolveLauncherOwnedClaudeRuntimeFacts,
  probeBwrapAvailability = probeOrchestratorBwrapAvailability
} = {}) {
  const probe = probeBwrapAvailability({ env: plan.env ?? process.env });
  if (probe.available !== true) {
    throw new HeadlessDirectModeError();
  }
  return buildHeadlessOrchestratorBwrapPlan(
    claudeOrchestratorIsolationProfile({
      plan,
      resolveExecutable,
      launcherOwnedHostHome,
      resolveClaudeRuntimeFacts
    })
  );
}

function buildClaudeOrchestratorIsolationSummary(availability) {
  const direct = availability?.available !== true;
  return {
    mode: direct
      ? ORCHESTRATOR_ISOLATION_MODES.DIRECT
      : ORCHESTRATOR_ISOLATION_MODES.BUBBLEWRAP,
    operator_direct_mode_allowed: true,
    bwrap_available: !direct,
    os_filesystem_isolation: !direct,
    write_scope_enforced: !direct,
    warning: direct ? OPERATOR_DIRECT_MODE_WARNING : null,
    diagnostic: direct ? (availability?.diagnostic ?? null) : null
  };
}

function spawnClaudeOrchestratorChild({ plan, io = {} }) {

  if (plan.headless === true) {
    const headlessLaunchPlan = buildClaudeOrchestratorHeadlessLaunchPlan({ plan });
    const opened = openHeadlessStdio(plan.headlessLogTarget);
    try {
      return spawnIsolated(headlessLaunchPlan, { stdio: opened.stdio });
    } finally {
      opened.close();
    }
  }
  const launchPlan = buildClaudeOrchestratorLaunchPlan({ plan });
  if (launchPlan.isolationMode === ORCHESTRATOR_ISOLATION_MODES.DIRECT) {
    writeStderr(io.stderr, `${launchPlan.warning}\n`);
    return spawn(launchPlan.command, [...launchPlan.args], {
      cwd: launchPlan.cwd,
      env: launchPlan.env ?? plan.env,
      stdio: ORCHESTRATOR_INTERACTIVE_STDIO
    });
  }
  return spawnIsolated(launchPlan, { stdio: ORCHESTRATOR_INTERACTIVE_STDIO });
}

async function runClaudeOrchestratorCommand(plan, io = {}, {
  verifyNativePermissionEnforcement = probeClaudeNativePermissionEnforcement,
  mintNativePermissionSettings = mintLauncherOwnedClaudeNativePermissionSettings,
  resolveClaudeRuntimeFacts = resolveLauncherOwnedClaudeRuntimeFacts
} = {}) {
  if (plan.mode === "refusal") {
    const refusal = {
      schema_version: CLAUDE_ORCHESTRATOR_PLAN_SCHEMA_VERSION,
      planner_kind: "claude_orchestrator",
      ...plan
    };
    writeLine(io.stdout, JSON.stringify(refusal, null, 2));
    process.exitCode = 2;
    return refusal;
  }

  let launchPlan = plan;
  if (plan.headless === true) {
    const settingsRuntimeDir = path.join(
      plan.runtimeDir,
      CLAUDE_ORCHESTRATOR_HEADLESS_SETTINGS_RUNTIME_DIR
    );
    const minted = await mintNativePermissionSettings({
      workspaceDir: plan.repo,
      writeScope: [],
      env: {
        ...plan.env,
        AGENT_LAUNCH_RUNTIME_STATE_DIR: settingsRuntimeDir
      },
      buildSettings: () => buildClaudeOrchestratorHeadlessPermissionSettings()
    });
    if (
      !minted ||
      minted.ok !== true ||
      typeof minted.settingsPath !== "string" ||
      minted.settingsPath.length === 0
    ) {
      const reason = minted?.code ?? CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON;
      writeStderr(
        io.stderr,
        `claude orchestrator: ${minted?.reason ?? "launcher could not mint Claude headless orchestrator native-permission settings"}\n`
      );
      process.exitCode = 1;
      return {
        status: "failed",
        exitCode: 1,
        signal: null,
        refusal: { code: reason, detail: minted?.detail ?? null }
      };
    }
    launchPlan = {
      ...plan,
      args: withClaudeOrchestratorHeadlessSettingsPath(plan.args, minted.settingsPath),
      headlessSettings: minted.settings ?? buildClaudeOrchestratorHeadlessPermissionSettings(),
      headlessSettingsPath: minted.settingsPath
    };

    const factsResult = resolveClaudeRuntimeFacts({});
    const claudePath = factsResult?.ok === true ? factsResult.facts.symlink : null;
    const enforcementProof = await verifyNativePermissionEnforcement({
      claudePath,
      env: launchPlan.env
    });
    if (!enforcementProof || enforcementProof.ok !== true) {
      const reason = enforcementProof?.reason ?? CLAUDE_NATIVE_PERMISSION_PROBE_UNPROVEN_REASON;
      writeStderr(io.stderr, `claude orchestrator: ${reason}\n`);
      process.exitCode = 1;
      return {
        status: "failed",
        exitCode: 1,
        signal: null,
        refusal: { code: reason, detail: enforcementProof?.detail ?? enforcementProof?.checks ?? null }
      };
    }
  }

  const sidecarHandle = await startOrchestratorDispatchSidecar({
    plan: launchPlan,
    io,
    adapter: createClaudeOrchestratorDispatchSidecarAdapter()
  });

  try {
    await writeJsonAtomic(launchPlan.mcpConfigPath, launchPlan.mcpConfig);

    const outcome = await superviseInteractiveOrchestratorLaunch({
      runtimeDir: launchPlan.runtimeDir,
      descriptor: claudeOrchestratorSessionDescriptor(launchPlan),
      spawnChild: () => spawnClaudeOrchestratorChild({ plan: launchPlan, io })
    });

    if (outcome.status !== "succeeded") {
      process.exitCode = 1;
    }
    return {
      status: outcome.status,
      exitCode: outcome.exitCode,
      signal: outcome.signal
    };
  } catch (error) {
    writeStderr(io.stderr, `claude orchestrator: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
    throw error;
  } finally {
    try {
      await sidecarHandle?.stop();
    } finally {
      await writeJsonAtomic(launchPlan.mcpConfigPath, launchPlan.mcpConfigBase).catch(() => {});
    }
  }
}

export async function runClaudeOrchestrator({
  role,
  initiative,
  promptArgs = [],
  env = process.env,
  cwd = process.cwd(),
  resolvedProfile = null,
  io = {},
  dryRunJson = false,

  headless = false,
  logFile = null,
  probeBwrapAvailability = probeOrchestratorBwrapAvailability,
  mintNativePermissionSettings = mintLauncherOwnedClaudeNativePermissionSettings,
  verifyNativePermissionEnforcement = probeClaudeNativePermissionEnforcement
} = {}) {
  const plan = await buildClaudeOrchestratorPlan({
    role,
    initiative,
    promptArgs,
    env,
    cwd,
    resolvedProfile,
    probeBwrapAvailability,
    headless,
    logFile,
    mintNativePermissionSettings
  });

  if (plan.mode === "refusal") {
    const refusal = {
      schema_version: CLAUDE_ORCHESTRATOR_PLAN_SCHEMA_VERSION,
      planner_kind: "claude_orchestrator",
      ...plan
    };
    if (dryRunJson) {
      writeLine(io.stdout, JSON.stringify(refusal, null, 2));
    } else {
      writeRaw(io.stderr, `${plan.refusal.message}\n`);
    }
    process.exitCode = 2;
    return refusal;
  }

  if (dryRunJson) {
    writeLine(io.stdout, JSON.stringify(publicClaudeOrchestratorPlan(plan), null, 2));
    return plan;
  }

  return runClaudeOrchestratorCommand(plan, io, {
    verifyNativePermissionEnforcement,
    mintNativePermissionSettings
  });
}

export async function runClaudeOrchestratorResume({
  role,
  initiative,
  promptArgs = [],
  env = process.env,
  cwd = process.cwd(),
  resolvedProfile = null,
  io = {},
  dryRunJson = false,
  probeBwrapAvailability = probeOrchestratorBwrapAvailability
} = {}) {
  const plan = await buildClaudeOrchestratorPlan({
    role: "orch-resume",
    initiative,
    promptArgs,
    env,
    cwd,
    resolvedProfile,
    probeBwrapAvailability
  });

  if (plan.mode === "refusal") {
    const refusal = {
      schema_version: CLAUDE_ORCHESTRATOR_PLAN_SCHEMA_VERSION,
      planner_kind: "claude_orchestrator",
      ...plan
    };
    if (dryRunJson) {
      writeLine(io.stdout, JSON.stringify(refusal, null, 2));
    } else {
      writeRaw(io.stderr, `${plan.refusal.message}\n`);
    }
    process.exitCode = 2;
    return refusal;
  }

  if (!(await hasResumableOrchestratorSession(plan.runtimeDir))) {
    const refusal = makeRefusal(
      CLAUDE_ORCHESTRATOR_NO_PRIOR_SESSION_REASON,
      `no prior Claude orchestrator session found for ${initiative}`,
      { runtime_dir: plan.runtimeDir, thread_name: plan.threadName }
    );
    if (dryRunJson) {
      writeLine(io.stdout, JSON.stringify({
        schema_version: CLAUDE_ORCHESTRATOR_PLAN_SCHEMA_VERSION,
        planner_kind: "claude_orchestrator",
        ...refusal
      }, null, 2));
    } else {
      writeRaw(io.stderr, `${refusal.refusal.message}\n`);
    }
    process.exitCode = 2;
    return refusal;
  }

  if (dryRunJson) {
    writeLine(io.stdout, JSON.stringify(publicClaudeOrchestratorPlan(plan), null, 2));
    return plan;
  }

  return runClaudeOrchestratorCommand(plan, io);
}
