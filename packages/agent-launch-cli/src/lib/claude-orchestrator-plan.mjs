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
  appendRepoProfileThreadSuffix,
  loadRepoProfileLocalConfig,
} from "./agent-launch-repo-profile-config.mjs";
import { getLauncherProfile } from "./agent-launch-profiles.mjs";
import {
  WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR,
  WIKI_MCP_SERVER_PACKAGE_SUBPATH,
  buildWikiMcpServerNodeCommand,
  ensureWikiMcpResponseStateDir,
  resolveLauncherConfiguredWorkspaceAlias,
  resolveWikiMcpServerPath,
  selectWikiMcpServerEnv
} from "./codex-role-mcp-env.mjs";
import {
  titleFromPage
} from "./codex-role-orchestrator-history.mjs";

import {
  buildOrchestratorSettings,
  sanitizeOrchestratorPathSegment
} from "./orchestrator-launch-settings.mjs";

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
  ORCHESTRATOR_INTERACTIVE_STDIO
} from "./orchestrator-launch-runtime.mjs";

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

export const CLAUDE_ORCHESTRATOR_PLAN_SCHEMA_VERSION =
  "claude-orchestrator-plan.v1";
export const CLAUDE_ORCHESTRATOR_MCP_CONFIG_SCHEMA_VERSION =
  "claude-orchestrator-mcp-config.v1";
export const CLAUDE_ORCHESTRATOR_RUNTIME_STATE_SCHEMA_VERSION =
  "claude-orchestrator-runtime-state.v1";

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

const CLAUDE_ORCHESTRATOR_WORKSPACE_ALIAS_PATTERN =
  /^[A-Za-z0-9._-]+$/;

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

function buildClaudeOrchestratorPrompt({ initiative, threadName, focus }) {
  return renderLauncherFamilyOrchestratorPrompt({ appName: "Claude", renameHintLabel: "Claude", initiative, threadName, focus });
}

function resolveClaudeOrchestratorLocalSettings({ repo, initiative, resolvedProfile }) {
  const localConfig = loadRepoProfileLocalConfig(repo);
  if (localConfig.refused) {
    return {
      refusal: {
        code: CLAUDE_ORCHESTRATOR_LOCAL_CONFIG_REFUSAL_REASON,
        message: "repo-local Claude orchestrator config refused",
        detail: {
          refusal_reason: localConfig.refusal_reason,
          diagnostics: localConfig.diagnostics
        }
      }
    };
  }

  const launcherProfile = isNonEmptyString(resolvedProfile?.profile_name)
    ? getLauncherProfile(resolvedProfile.profile_name)
    : null;
  const profileModel = isNonEmptyString(resolvedProfile?.model)
    ? resolvedProfile.model
    : isNonEmptyString(resolvedProfile?.default_model)
      ? resolvedProfile.default_model
      : null;
  const profileEffort = isNonEmptyString(launcherProfile?.planner_default_effort)
    ? launcherProfile.planner_default_effort
    : isNonEmptyString(resolvedProfile?.default_effort)
      ? resolvedProfile.default_effort
      : "default";

  const sharedSettings = buildOrchestratorSettings({
    appLabel: "Claude",
    env: {
      ORCHESTRATOR_EFFORT: localConfig.values.ORCHESTRATOR_EFFORT
    },
    localEffortKey: "ORCHESTRATOR_EFFORT",
    profile: {
      model: profileModel,
      effort: profileEffort
    },
    profileEffortKey: "effort",
    profileModelKey: "model",
    repoName: path.basename(repo),
    roleLabel: "orchestrator",
    stateDirName: CLAUDE_ORCHESTRATOR_STATE_DIR_NAME,
    subject: initiative
  });

  return {
    localConfig,
    settings: {
      model: sharedSettings.model ?? null,
      model_source: isNonEmptyString(resolvedProfile?.model_source)
        ? resolvedProfile.model_source
        : "profile_default",
      effort: sharedSettings.effort ?? profileEffort,
      effort_source: sharedSettings.effortSource === "local"
        ? "repo_local_config"
        : isNonEmptyString(launcherProfile?.planner_default_effort_source)
          ? launcherProfile.planner_default_effort_source
          : "profile_default",
      threadName: sharedSettings.threadName,
      thread_suffix: localConfig.normalized_thread_suffix
    }
  };
}

function buildClaudeOrchestratorMcpConfig({
  repo,
  mcpServerPath,
  workspaceAlias,
  workspaceDir,
  responseStateDir,
  endpointValue = null,
  initiative,
  threadName,
  model,
  effort
} = {}) {

  const wikiServerCommand = buildWikiMcpServerNodeCommand({ repo, serverPath: mcpServerPath });

  const env = selectWikiMcpServerEnv({
    workspaceAlias: isNonEmptyString(workspaceAlias) && CLAUDE_ORCHESTRATOR_WORKSPACE_ALIAS_PATTERN.test(workspaceAlias)
      ? workspaceAlias
      : null,
    workspaceDir,
    responseStateDir,
    endpointEnvVar: HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR,
    endpointValue
  });

  return {
    schema_version: CLAUDE_ORCHESTRATOR_MCP_CONFIG_SCHEMA_VERSION,
    orchestrator: {
      app: "claude",
      initiative,
      thread_name: threadName,
      repo,
      model,
      effort
    },
    mcpServers: {
      wiki: {
        command: wikiServerCommand.command,
        args: wikiServerCommand.args,
        env
      }
    }
  };
}

export async function buildClaudeOrchestratorPlan({
  role,
  initiative,
  promptArgs = [],
  env = process.env,
  cwd = process.cwd(),
  resolvedProfile = null,
  resolveWikiMcpServer = resolveWikiMcpServerPath,
  probeBwrapAvailability = probeOrchestratorBwrapAvailability
} = {}) {
  if (role !== "orch" && role !== "orch-resume") {
    throw new Error(`buildClaudeOrchestratorPlan only supports orch/orch-resume (got ${role})`);
  }
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

  const localSettings = resolveClaudeOrchestratorLocalSettings({ repo, initiative, resolvedProfile });
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
        focus: promptArgs.join(" ")
      });
  const mcpConfigPath = path.join(runtimeDir, "mcp-config.json");
  const mcpConfigBase = buildClaudeOrchestratorMcpConfig({
    repo,
    mcpServerPath,
    workspaceAlias,
    workspaceDir,
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
  if (isNonEmptyString(workspaceAlias) && CLAUDE_ORCHESTRATOR_WORKSPACE_ALIAS_PATTERN.test(workspaceAlias)) {
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

  const args = [
    "--permission-mode",
    "default",
    "--disallowedTools",
    "Bash",
    "--mcp-config",
    mcpConfigPath
  ];
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

  return {
    schema_version: CLAUDE_ORCHESTRATOR_PLAN_SCHEMA_VERSION,
    planner_kind: "claude_orchestrator",
    mode: "interactive",
    role,
    subject: initiative,
    repo,
    repo_name: repoName,
    runtimeDir,
    isolation,
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

async function runClaudeOrchestratorCommand(plan, io = {}) {
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

  const sidecarHandle = await startOrchestratorDispatchSidecar({
    plan,
    io,
    adapter: createClaudeOrchestratorDispatchSidecarAdapter()
  });

  try {
    await writeJsonAtomic(plan.mcpConfigPath, plan.mcpConfig);

    const outcome = await superviseInteractiveOrchestratorLaunch({
      runtimeDir: plan.runtimeDir,
      descriptor: claudeOrchestratorSessionDescriptor(plan),
      spawnChild: () => spawnClaudeOrchestratorChild({ plan, io })
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
      await writeJsonAtomic(plan.mcpConfigPath, plan.mcpConfigBase).catch(() => {});
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
  probeBwrapAvailability = probeOrchestratorBwrapAvailability
} = {}) {
  const plan = await buildClaudeOrchestratorPlan({
    role,
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

  if (dryRunJson) {
    writeLine(io.stdout, JSON.stringify(publicClaudeOrchestratorPlan(plan), null, 2));
    return plan;
  }

  return runClaudeOrchestratorCommand(plan, io);
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
