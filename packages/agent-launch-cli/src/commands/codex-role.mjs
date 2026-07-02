import path from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "node:fs/promises";
import { spawn } from "node:child_process";

import { loadWorkRecordById } from "@agent-chassis/wiki-core";

import { parseArgs } from "../lib/cli.mjs";
import {
  BubblewrapIsolationError,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  assertBubblewrapAvailable,
  spawnIsolated
} from "../lib/launch-isolation.mjs";
import {
  WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES,
  WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS,
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS,
  buildWorkspaceAgentFailOpenPlan
} from "../lib/launch-isolation-failopen.mjs";
import {
  WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS
} from "../lib/workspace-agent-run-enforcement.mjs";

import {
  OPERATOR_DIRECT_MODE_WARNING,
  ORCHESTRATOR_ISOLATION_MODES,
  probeOrchestratorBwrapAvailability
} from "../lib/orchestrator-launch-isolation.mjs";
import {
  createOrchestratorDispatchSidecarAdapter,
  startOrchestratorDispatchSidecar
} from "../lib/orchestrator-dispatch-sidecar.mjs";

import {
  spawnOrchestratorAndWait
} from "../lib/orchestrator-launch-runtime.mjs";
import {
  buildWorkerPlan,
  ensureNewWorkerWriteRoots
} from "../lib/codex-worker-plan.mjs";

import {
  createHostWriteAuthorityBrokerClaudePlanLaunch
} from "../lib/workspace-agent-dispatch-claude-executor.mjs";
import {
  createHostWriteAuthorityBrokerAgyPlanLaunch
} from "../lib/workspace-agent-dispatch-agy-executor.mjs";

import {
  createHostWriteAuthorityBrokerPlanLaunch
} from "../lib/workspace-agent-dispatch-codex-executor.mjs";
import {
  resolveFindingsOnlyAcceptanceContract
} from "../lib/workspace-agent-findings-role-context.mjs";

import {
  runHostWriteAuthorityBroker
} from "./host-write-authority-broker.mjs";
export {
  runHostWriteAuthorityBroker,
  HOST_WRITE_AUTHORITY_BROKER_SOCKET_ENV_VAR,
  HOST_WRITE_AUTHORITY_BROKER_LEGACY_SOCKET_DISABLED_REASON,
  resolveHostWriteAuthorityBrokerSocketPath
} from "./host-write-authority-broker.mjs";

import {
  isDirectory,
  readFileIfExists,
  tailLines,
  writeLine,
  writeRaw,
  writeStderr
} from "../lib/codex-role-io.mjs";
import {
  buildCodexWritableSandboxArgs,
  hasGlobSyntax,
  launcherBinWrapperPermissionRoots,
  looksLikeFileScopeEntry,
  normalizeProjectScopeEntry,
  parentDirectoryForScopeEntry,
  projectPermissionWritesForScope
} from "../lib/codex-role-write-scope.mjs";
import {
  redteamPrompt,
  reviewPrompt,
  reviewPromptSubjectPath
} from "../lib/codex-role-prompts.mjs";
import {
  runCodexOrchestratorList
} from "../lib/codex-role-orchestrator-history.mjs";
import {
  AGENT_RUN_PROVENANCE_SCHEMA_VERSION,
  recordHeartbeatTick,
  resolveHeartbeatIntervalSeconds,
  writeDirectLaunchProvenance,
  writeHeartbeatLog
} from "../lib/codex-role-run-capture.mjs";
import { formatRefusal } from "../lib/codex-role-refusal-format.mjs";
import {
  CODEX_WIKI_MCP_SERVER_NAME,
  WIKI_MCP_SERVER_PACKAGE_SUBPATH,
  WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR,
  WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
  WIKI_MCP_WORKSPACE_DIR_ENV_VAR,
  buildCodexWikiMcpEnvOverride,
  buildCodexWorkspaceMcpEnvOverrides,
  ensureWikiMcpResponseStateDir,
  injectCodexConfigOverridesBeforeFinalPositional,
  quoteTomlString,
  resolveLauncherConfiguredWorkspaceAlias,
  resolveWikiMcpServerPath,
  selectWikiMcpServerEnv
} from "../lib/codex-role-mcp-env.mjs";

import {
  buildCodexWikiMcpServerOverrides,
  collectCodexSynthesizedWikiMcpReadOnlyRoots,
  detectCodexWikiMcpServerPosture,
  rebuildCodexPlanIsolationWithReadOnlyRoot
} from "../lib/codex-role-wiki-mcp-override.mjs";

import {
  buildCodexRoleBubblewrapPlan,
  buildFastDecommissionedRefusalPlan,
  buildOrchestratorPlan,
  buildReadOnlyPlan,
  ensureRefusalDependencyEvidence,
  findRepoRoot,
  isolationSummaryForPublic
} from "../lib/workspace-agent-codex-role-adapter.mjs";

export {
  AGENT_RUN_PROVENANCE_SCHEMA_VERSION,
  CODEX_WIKI_MCP_SERVER_NAME,
  buildCodexWritableSandboxArgs,
  hasGlobSyntax,
  isDirectory,
  launcherBinWrapperPermissionRoots,
  looksLikeFileScopeEntry,
  normalizeProjectScopeEntry,
  parentDirectoryForScopeEntry,
  projectPermissionWritesForScope,
  quoteTomlString,
  redteamPrompt,
  reviewPrompt,
  reviewPromptSubjectPath,
  runCodexOrchestratorList,
  createHostWriteAuthorityBrokerPlanLaunch
};

export {
  CODEX_ROLE_FAST_REFUSAL_DIAGNOSTIC,
  CODEX_ROLE_FAST_REFUSAL_GATE_CODE,
  CODEX_ROLE_ISOLATION_FAIL_CLOSED_MODE,
  CODEX_ROLE_ISOLATION_SCHEMA_VERSION,
  ROLE_CONFIG,
  buildCodexReviewerWriteScopeRefusal,
  buildCodexRoleBubblewrapPlan,
  buildCodexRoleIsolationInputs,
  buildFastDecommissionedRefusalPlan,
  buildHeadlessPlan,
  enforceReviewerWriteScope,
  findRepoRoot,
  stripNestedCodexSandboxArgs
} from "../lib/workspace-agent-codex-role-adapter.mjs";

const CODEX_ROLE_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const BROKEN_OR_TAMPERED_BWRAP_DIAGNOSTIC_CODES = new Set([
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_NOT_EXECUTABLE,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_PROBE_FAILED,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED
]);

const ORCHESTRATOR_RESUME_PLAIN_SPAWN_PROVENANCE_CODE =
  "agent_launch.codex_orchestrator_resume.unenforced_plain_spawn.v1";

function formatBubblewrapIsolationRefusal(role, err) {
  const base =
    `codex-${role}: bubblewrap isolation refused: ${err.code}: ${err.message}`;
  if (err.code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE) {
    return `${base}\nRemediation: install bubblewrap (bwrap) on PATH, or use an explicit supported unsandboxed opt-out/direct-mode path only where the invoked launch surface documents and supports it. Structured role launches remain fail-closed unless that surface has an explicit operator opt-in.`;
  }
  if (BROKEN_OR_TAMPERED_BWRAP_DIAGNOSTIC_CODES.has(err.code)) {
    return `${base}\nRemediation: repair or reinstall bubblewrap (bwrap), then retry. A present but unusable bwrap backend is treated as broken or tampered and is not remediated by structured-role opt-out/direct mode.`;
  }
  return base;
}

const HELP_TEXT = `agent-launch codex-role <role> <ID> [instructions...]

INTERNAL IMPLEMENTATION PATH. The canonical operator surface is
\`agent-launch worker|review|redteam|orchestrator|resume\` with the
canonical option grammar [--profile <profile>] [--app <app>] [--model <model>].
codex-role remains callable in-package for the canonical commands and for
existing in-process callers; it is not the documented operator surface.

Internal roles:
  orch IN-####           Orchestrator launch (canonical: agent-launch orchestrator)
  orch-resume IN-####    Orchestrator resume (canonical: agent-launch resume)
  worker <unit-address>  Implementation worker (canonical: agent-launch worker)
  review <unit-address>  Findings-only review (canonical: agent-launch review)
  redteam <subject>      Findings-only redteam (canonical: agent-launch redteam)
  list                   List orchestrator runtime history

Options:
  --dry-run-json         Print the launch plan without starting Codex

Spark is a canonical worker profile selected via
\`agent-launch worker --profile worker_spark\` (or its shorthand --spark);
authority role remains worker.

Decommissioned: --fast, worker-fast, and worker_fast are refused with the
resolver-owned FAST_PROFILE_REFUSAL_DIAGNOSTIC pointing at
\`agent-launch worker --profile worker_spark\`.
`;

export async function runCodexRole(argv, io = {}, context = {}) {
  const { positionals, options } = parseArgs(argv);
  const [rawRole, rawSubject, ...rest] = positionals;
  const role = normalizeRole(rawRole);

  if (!role || role === "help" || options.help || options.h) {
    writeLine(io.stdout, HELP_TEXT);
    return;
  }

  if (role === "list") {
    await runCodexOrchestratorList(argv.slice(1), io);
    return;
  }

  if (role === "host-write-authority-broker") {
    await runHostWriteAuthorityBroker(argv.slice(1), io);
    return;
  }

  if (hasFastFlagSpelling(options)) {
    const plan = buildFastDecommissionedRefusalPlan({
      role: "worker-fast",
      subject: typeof rawSubject === "string" ? rawSubject : "",
      env: process.env
    });
    await executePlan(plan, io);
    return;
  }

  const promptArgs = stripLeadingDashDash(rest);
  const plan = await buildCodexRolePlan({
    role,
    subject: rawSubject,
    promptArgs,
    env: process.env,
    cwd: process.cwd(),
    resolvedProfile: context.resolvedProfile ?? null
  });

  attachOperatorOrchestratorIsolation(plan, {
    probeBwrapAvailability: context.probeBwrapAvailability
  });

  if (options["dry-run-json"] === true) {
    writeLine(io.stdout, JSON.stringify(publicPlan(plan), null, 2));
    return;
  }

  plan.provenanceInputs = {
    promptArgs: [...promptArgs]
  };

  await executePlan(plan, io);
}

export async function buildCodexRolePlan({
  role,
  subject,
  promptArgs = [],
  env = process.env,
  cwd = process.cwd(),
  resolvedProfile = null,
  workspaceAlias = null,
  workspaceDir = null,
  sourceToolSurface = null,

  terminalStructuredRoleResultMode = undefined
} = {}) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "orch" || normalizedRole === "orch-resume") {
    return buildOrchestratorPlan({
      role: normalizedRole,
      initiative: subject,
      promptArgs,
      env,
      cwd,
      resolvedProfile
    });
  }
  if (normalizedRole === "worker-fast") {
    return buildFastDecommissionedRefusalPlan({ role: normalizedRole, subject, env });
  }
  if (normalizedRole === "worker") {
    const workerPlan = await buildWorkerPlan({
      role: normalizedRole,
      wk: subject,
      promptArgs,
      env,
      cwd,
      resolvedProfile,
      workspaceAlias,
      workspaceDir,
      sourceToolSurface
    });
    if (workerPlan && typeof workerPlan === "object" && workerPlan.mode !== "refusal") {
      const workspaceMcpEnvOverrides = buildCodexWorkspaceMcpEnvOverrides({
        workspaceAlias,
        workspaceDir
      });
      if (workspaceMcpEnvOverrides.length > 0 && Array.isArray(workerPlan.args)) {
        injectCodexConfigOverridesBeforeFinalPositional(workerPlan.args, workspaceMcpEnvOverrides);
      }
    }
    return ensureRefusalDependencyEvidence(workerPlan);
  }
  if (normalizedRole === "review") {
    const acceptance = await resolveCodexReadOnlyAcceptance({
      role: normalizedRole,
      subject,
      cwd,
      workspaceDir
    });
    return buildReadOnlyPlan({
      role: normalizedRole,
      subject,
      promptArgs,
      env,
      cwd,
      resolvedProfile,
      workspaceAlias,
      workspaceDir,
      terminalStructuredRoleResultMode,
      ...acceptance
    });
  }
  if (normalizedRole === "redteam") {
    const acceptance = await resolveCodexReadOnlyAcceptance({
      role: normalizedRole,
      subject,
      cwd,
      workspaceDir
    });
    return buildReadOnlyPlan({
      role: normalizedRole,
      subject,
      promptArgs,
      env,
      cwd,
      resolvedProfile,
      workspaceAlias,
      workspaceDir,
      terminalStructuredRoleResultMode,
      ...acceptance
    });
  }
  throw new Error(`Unknown codex role: ${role}\n\n${HELP_TEXT}`);
}

async function resolveCodexReadOnlyAcceptance({ role, subject, cwd, workspaceDir }) {
  if (typeof subject !== "string" || !subject.startsWith("WK-")) {
    return {};
  }
  const repo = workspaceDir ?? await findRepoRoot(cwd);
  return resolveFindingsOnlyAcceptanceContract({
    role,
    subject,
    workspaceDir: repo,
    loadWorkRecord: loadWorkRecordById
  });
}

async function executePlan(plan, io) {
  if (plan.mode === "refusal") {
    writeRaw(io.stdout, `${formatRefusal(plan.refusal)}\n`);
    process.exitCode = 1;
    return;
  }

  if (Array.isArray(plan.preparedNewWriteRoots) && plan.preparedNewWriteRoots.length > 0) {
    await ensureNewWorkerWriteRoots(plan.repo, plan.preparedNewWriteRoots, plan.role);
  }

  let sidecarHandle = null;
  try {
    sidecarHandle = await maybeStartOrchestratorDispatchSidecar(plan, io);
  } catch (err) {
    writeStderr(
      io.stderr,
      `codex-${plan.role}: failed to start host write authority sidecar: ${err?.message ?? String(err)}\n`
    );
    process.exitCode = 1;
    return;
  }

  try {
    await runPlannedChild(plan, io);
  } finally {
    if (sidecarHandle !== null) {
      try {
        await sidecarHandle.stop();
      } catch {

      }
    }
  }
}

async function runPlannedChild(plan, io) {
  if (plan.operatorIsolation?.refusal) {
    writeStderr(
      io.stderr,
      `${formatOrchestratorResumeFailOpenRefusal(plan)}\n`
    );
    process.exitCode = 1;
    return;
  }

  if (plan.operatorIsolation?.mode === ORCHESTRATOR_ISOLATION_MODES.DIRECT) {
    writeStderr(io.stderr, `${OPERATOR_DIRECT_MODE_WARNING}\n`);
    if (plan.operatorIsolation?.failOpenWarning) {
      writeStderr(
        io.stderr,
        `${formatOrchestratorResumePlainSpawnProvenance(plan)}\n`
      );
    }
    const status = await spawnDirectAndWait(plan.command, plan.args, {
      cwd: plan.repo,
      env: plan.env,
      stdio: "inherit"
    });
    process.exitCode = status ?? 0;
    return;
  }

  let bwrapPlan = null;
  let plainSpawnDecision = null;
  if (plan.operatorIsolation) {
    try {
      bwrapPlan = buildCodexRoleBubblewrapPlan(plan);
      assertBubblewrapAvailable({ env: plan.env, bwrapPath: bwrapPlan.bwrapPath });
    } catch (err) {
      if (err instanceof BubblewrapIsolationError) {
        writeStderr(
          io.stderr,
          `${formatBubblewrapIsolationRefusal(plan.role, err)}\n`
        );
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  } else {
    const prepared = prepareCodexRoleSandboxLaunch(plan);
    if (prepared.outcome === "refused") {
      writeStderr(
        io.stderr,
        `${formatCodexRoleSandboxFailOpenRefusal(plan, prepared.decision, prepared.error)}\n`
      );
      process.exitCode = 1;
      return;
    }
    if (prepared.outcome === "plain") {
      plainSpawnDecision = prepared.decision;
    } else {
      bwrapPlan = prepared.bwrapPlan;
    }
  }

  if (plan.mode === "interactive") {
    await runInteractiveOrchestratorChild({ plan, io, bwrapPlan });
    return;
  }
  if (plan.mode === "headless-verbose") {
    await runHeadlessVerboseChild({ plan, io, bwrapPlan, plainSpawnDecision });
    return;
  }
  await runHeadlessCaptureChild({ plan, io, bwrapPlan, plainSpawnDecision });
}

async function handleHeadlessLateBwrapFailure({ plan, io, error, runPlain }) {
  if (!(error instanceof BubblewrapIsolationError)) {
    throw error;
  }
  const decision = buildCodexRoleSandboxFailOpenPlan(plan, error);
  if (decision.disposition === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN) {
    await runPlain(decision);
    return true;
  }
  writeStderr(
    io.stderr,
    `${formatCodexRoleSandboxFailOpenRefusal(plan, decision, error)}\n`
  );
  process.exitCode = 1;
  return true;
}

export async function runHeadlessVerboseChild({
  plan,
  io,
  bwrapPlan,
  plainSpawnDecision = null,
  spawnEnforced = spawnIsolatedAndWait,
  spawnPlain = spawnDirectAndWait
} = {}) {
  const runPlain = async (decision) => {
    emitCodexRolePlainSpawnNotice(plan, io, decision);
    const status = await spawnPlain(plan.command, plan.args, {
      cwd: plan.repo,
      env: plan.env,
      stdio: "inherit"
    });
    process.exitCode = status ?? 0;
  };
  if (plainSpawnDecision) {
    await runPlain(plainSpawnDecision);
    return;
  }
  try {
    const status = await spawnEnforced(bwrapPlan, {
      env: plan.env,
      stdio: "inherit"
    });
    process.exitCode = status;
  } catch (err) {
    await handleHeadlessLateBwrapFailure({ plan, io, error: err, runPlain });
  }
}

export async function runHeadlessCaptureChild({
  plan,
  io,
  bwrapPlan,
  plainSpawnDecision = null,
  spawnEnforced = spawnIsolated,
  spawnPlain = spawn
} = {}) {
  const intervalSeconds = resolveHeartbeatIntervalSeconds(plan.env);
  writeStderr(
    io.stderr,
    `${plan.logPrefix}: started; heartbeat every ${intervalSeconds}s; log: ${plan.logPath}\n`
  );
  const startedAt = new Date().toISOString();
  const startedAtEpoch = Math.floor(Date.now() / 1000);
  const heartbeatPath = path.join(plan.runDir, "heartbeat.log");
  const heartbeatTimeline = [];
  const stdout = await open(plan.logPath, "w");
  let child = null;
  let heartbeatTimer = null;
  let status;
  let enforced = !plainSpawnDecision;
  const stdio = ["ignore", stdout.fd, stdout.fd];
  try {
    if (!enforced) {
      emitCodexRolePlainSpawnNotice(plan, io, plainSpawnDecision);
    }

    let spawned = null;
    if (enforced) {
      try {
        spawned = spawnEnforced(bwrapPlan, { env: plan.env, stdio });
      } catch (err) {
        if (!(err instanceof BubblewrapIsolationError)) {
          throw err;
        }
        const decision = buildCodexRoleSandboxFailOpenPlan(plan, err);
        if (decision.disposition !== WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN) {
          writeStderr(
            io.stderr,
            `${formatCodexRoleSandboxFailOpenRefusal(plan, decision, err)}\n`
          );
          process.exitCode = 1;
          return;
        }
        enforced = false;
        emitCodexRolePlainSpawnNotice(plan, io, decision);
      }
    }
    if (!enforced) {
      spawned = spawnPlain(plan.command, Array.isArray(plan.args) ? [...plan.args] : [], {
        cwd: plan.repo,
        env: plan.env,
        stdio
      });
    }
    child = spawned;
    status = await new Promise((resolve, reject) => {
      heartbeatTimer = setInterval(() => {
        void recordHeartbeatTick({ io, plan, startedAtEpoch, heartbeatTimeline });
      }, intervalSeconds * 1000);
      if (typeof heartbeatTimer.unref === "function") {
        heartbeatTimer.unref();
      }
      child.on("error", reject);
      child.on("close", resolve);
    });
  } finally {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
    }
    await stdout.close().catch(() => {});
  }
  const completedAt = new Date().toISOString();
  const completedAtEpoch = Math.floor(Date.now() / 1000);
  const childPid = child && typeof child.pid === "number" ? child.pid : null;

  await writeHeartbeatLog(heartbeatPath, heartbeatTimeline);

  const final = await readFileIfExists(plan.finalPath);
  if (final) {
    writeRaw(io.stdout, final);
    if (!final.endsWith("\n")) {
      writeRaw(io.stdout, "\n");
    }
  } else {
    writeStderr(io.stderr, `${plan.logPrefix}: no final response was captured.\n`);
  }

  await writeDirectLaunchProvenance(plan, {
    startedAt,
    startedAtEpoch,
    completedAt,
    completedAtEpoch,
    status,
    childPid,
    heartbeatPath,
    heartbeatTimeline,
    moduleDir: CODEX_ROLE_MODULE_DIR
  });

  writeStderr(io.stderr, `\n${plan.logPrefix}: exited with status ${status}. Full log: ${plan.logPath}\n`);
  if (status !== 0) {
    writeStderr(io.stderr, `${plan.logPrefix}: last log lines:\n`);
    writeStderr(io.stderr, tailLines(await readFileIfExists(plan.logPath), 40));
    process.exitCode = status;
  }
}

export async function maybeStartOrchestratorDispatchSidecar(plan, io = {}) {
  const handle = await startOrchestratorDispatchSidecar({
    plan,
    io,
    adapter: createCodexOrchestratorDispatchSidecarAdapter()
  });
  if (!handle) return null;
  return {
    endpoint: handle.endpoint,
    mcpEnvOverride: handle.applyContext?.mcpEnvOverride ?? null,
    mcpResponseStateDir: handle.applyContext?.mcpResponseStateDir ?? null,
    stop: () => handle.stop()
  };
}

export function createCodexOrchestratorDispatchSidecarAdapter() {
  return createOrchestratorDispatchSidecarAdapter({

    createBrokerPlanLaunch: ({ env, cwd }) =>
      createHostWriteAuthorityBrokerPlanLaunch({ env, cwd }),
    appPlanLaunchBuilders: {
      codex: ({ env, cwd }) => createHostWriteAuthorityBrokerPlanLaunch({ env, cwd }),
      claude: ({ env }) => createHostWriteAuthorityBrokerClaudePlanLaunch({ env }),
      agy: ({ env }) => createHostWriteAuthorityBrokerAgyPlanLaunch({ env })
    },
    spawnLaunch: (bwrapPlan, opts) => spawnIsolated(bwrapPlan, opts),

    applyEndpointToPlan: ({ plan, descriptor, endpointValue, envVar }) => {
      const mcpServerName = typeof descriptor.mcpServerName === "string" && descriptor.mcpServerName.length > 0
        ? descriptor.mcpServerName
        : CODEX_WIKI_MCP_SERVER_NAME;

      const posture = detectCodexWikiMcpServerPosture({
        env: plan.env,
        mcpServerName
      });

      if (posture === "url") {
        return {
          mcpServerPosture: posture,
          mcpEnvOverride: null,
          mcpEnvOverrides: [],
          mcpEnvOverrideSpan: null,
          mcpWorkspaceAliasOverride: null,
          mcpWorkspaceDirOverride: null,
          synthesizedWikiMcpServerPath: null,
          originalIsolation: null
        };
      }

      const workspaceAlias = resolveLauncherConfiguredWorkspaceAlias({
        env: plan.env,
        repo: plan.repo,
        mcpServerName
      });

      const workspaceDir = typeof plan.repo === "string" && plan.repo.length > 0 && path.isAbsolute(plan.repo)
        ? plan.repo
        : null;
      const responseStateDir = ensureWikiMcpResponseStateDir({
        runtimeDir: plan.runtimeDir,
        workspaceDir: plan.repo
      });
      const mcpEnvOverrides = [];

      let synthesizedWikiMcpServerPath = null;
      let originalIsolation = null;
      if (posture === "absent") {
        synthesizedWikiMcpServerPath = resolveWikiMcpServerPath();
        if (!synthesizedWikiMcpServerPath) {
          throw new Error(
            "codex orchestrator wiki MCP override cannot resolve " +
            `${WIKI_MCP_SERVER_PACKAGE_SUBPATH}; @agent-chassis/wiki-mcp must be ` +
            "installed in the launcher package context"
          );
        }
        for (const serverOverride of buildCodexWikiMcpServerOverrides({
          mcpServerName,
          serverPath: synthesizedWikiMcpServerPath,
          repo: plan.repo
        })) {
          mcpEnvOverrides.push(serverOverride);
        }

        originalIsolation = rebuildCodexPlanIsolationWithReadOnlyRoot(
          plan,
          collectCodexSynthesizedWikiMcpReadOnlyRoots(synthesizedWikiMcpServerPath)
        );
      }

      const wikiServerEnv = selectWikiMcpServerEnv({
        workspaceAlias,
        workspaceDir,
        responseStateDir,
        endpointEnvVar: envVar,
        endpointValue
      });
      let mcpWorkspaceAliasOverride = null;
      let mcpWorkspaceDirOverride = null;
      let mcpResponseStateDirOverride = null;
      let mcpEnvOverride = null;
      for (const [envKey, envValue] of Object.entries(wikiServerEnv)) {
        const override = buildCodexWikiMcpEnvOverride({
          mcpServerName,
          envVar: envKey,
          value: envValue
        });
        if (envKey === WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR) {
          mcpWorkspaceAliasOverride = override;
        } else if (envKey === WIKI_MCP_WORKSPACE_DIR_ENV_VAR) {
          mcpWorkspaceDirOverride = override;
        } else if (envKey === WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR) {
          mcpResponseStateDirOverride = override;
        } else if (envKey === envVar) {
          mcpEnvOverride = override;
        }
        mcpEnvOverrides.push(override);
      }

      const insertionIndex = Array.isArray(plan.args)
        ? (plan.args.length > 0 ? plan.args.length - 1 : 0)
        : 0;
      if (Array.isArray(plan.args)) {
        for (const override of [...mcpEnvOverrides].reverse()) {
          plan.args.splice(insertionIndex, 0, "-c", override);
        }
      }
      return {
        mcpServerPosture: posture,
        mcpEnvOverride,
        mcpEnvOverrides,
        mcpEnvOverrideSpan: Array.isArray(plan.args)
          ? { start: insertionIndex, length: mcpEnvOverrides.length * 2 }
          : null,
        mcpWorkspaceAliasOverride,
        mcpWorkspaceDirOverride,
        mcpResponseStateDirOverride,
        mcpResponseStateDir: responseStateDir,
        synthesizedWikiMcpServerPath,
        originalIsolation
      };
    },
    removeEndpointFromPlan: ({ plan, applyContext }) => {

      if (applyContext?.originalIsolation && plan && typeof plan === "object") {
        plan.isolation = applyContext.originalIsolation;
      }
      if (!Array.isArray(plan.args)) return;
      const span = applyContext?.mcpEnvOverrideSpan;
      if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.length) || span.length <= 0) {
        return;
      }
      if (span.start < 0 || span.start + span.length > plan.args.length) return;
      plan.args.splice(span.start, span.length);
    }
  });
}

function spawnIsolatedAndWait(bwrapPlan, options) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnIsolated(bwrapPlan, options);
    } catch (err) {
      reject(err);
      return;
    }
    child.on("error", reject);
    child.on("close", resolve);
  });
}

const CODEX_ORCHESTRATOR_RUNTIME_STATE_SCHEMA_VERSION =
  "codex-orchestrator-runtime-state.v1";

function codexOrchestratorSessionDescriptor(plan) {
  return {
    schema_version: CODEX_ORCHESTRATOR_RUNTIME_STATE_SCHEMA_VERSION,
    mode: plan.mode,
    role: plan.role,
    subject: plan.subject,
    repo: plan.repo,
    runtime_dir: plan.runtimeDir,
    thread_name: plan.env?.CODEX_ORCH_THREAD_NAME ?? null,
    command: plan.command,
    args: plan.args
  };
}

function spawnDirectAndWait(command, args, options) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, Array.isArray(args) ? [...args] : [], options);
    } catch (err) {
      reject(err);
      return;
    }
    child.on("error", reject);
    child.on("close", resolve);
  });
}

function isOperatorOrchestratorInteractivePlan(plan) {
  return Boolean(plan)
    && plan.mode === "interactive"
    && (plan.role === "orch" || plan.role === "orch-resume");
}

function buildCodexOrchestratorIsolationSummary(availability) {
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

function backendAvailabilityFromOrchestratorProbe(
  availability,
  source = "codex_orchestrator_resume_probe"
) {
  if (!availability || typeof availability !== "object") {
    return {
      ok: false,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.UNTRUSTED,
      backend: null,
      reason: "orchestrator bwrap probe result missing or malformed",
      diagnostic: null,
      source
    };
  }
  if (availability.available === true) {
    return {
      ok: true,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.AVAILABLE,
      backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP,
      reason: "bwrap backend is available for Codex orchestrator resume",
      diagnostic: null,
      source
    };
  }

  const diagnostic = availability.diagnostic && typeof availability.diagnostic === "object"
    ? {
        code: availability.diagnostic.code ?? null,
        message: availability.diagnostic.message ?? null,
        detail: availability.diagnostic.detail ?? null
      }
    : null;
  if (diagnostic?.code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE) {
    return {
      ok: true,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.NO_SUPPORTED_ENABLED_BACKEND,
      backend: null,
      reason: "bwrap backend is unavailable for Codex orchestrator resume",
      diagnostic,
      source
    };
  }
  if (BROKEN_OR_TAMPERED_BWRAP_DIAGNOSTIC_CODES.has(diagnostic?.code)) {
    return {
      ok: false,
      state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.TAMPERED_OR_BROKEN,
      backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.BWRAP,
      reason: "bwrap backend is present but unusable for Codex orchestrator resume",
      diagnostic,
      source
    };
  }
  return {
    ok: false,
    state: WORKSPACE_AGENT_BACKEND_AVAILABILITY_STATES.UNTRUSTED,
    backend: null,
    reason: "orchestrator bwrap probe did not return a trusted availability decision",
    diagnostic,
    source
  };
}

function backendAvailabilityFromCodexRoleBwrapError(error) {
  return backendAvailabilityFromOrchestratorProbe(
    {
      available: false,
      diagnostic: {
        code: error?.code ?? null,
        message: error?.message ?? null,
        detail: error?.detail ?? null
      }
    },
    "codex_role_bwrap_isolation"
  );
}

export function buildCodexRoleSandboxFailOpenPlan(plan, error, {
  resolveEnforcementPosture,
  resolveUnsandboxedOptIn
} = {}) {
  return buildWorkspaceAgentFailOpenPlan({
    launchFacts: {
      command: plan.command,
      args: plan.args,
      cwd: plan.repo,
      env: plan.env
    },
    role: plan.role,
    subject: plan.subject,
    workspaceDir: plan.repo,
    classifyIsolationBackendAvailability: () =>
      backendAvailabilityFromCodexRoleBwrapError(error),
    ...(resolveEnforcementPosture ? { resolveEnforcementPosture } : {}),
    ...(resolveUnsandboxedOptIn ? { resolveUnsandboxedOptIn } : {})
  });
}

export function prepareCodexRoleSandboxLaunch(plan, {
  buildBwrapPlan = buildCodexRoleBubblewrapPlan,
  assertBackendAvailable = assertBubblewrapAvailable,
  resolveSandboxFailOpenPlan = buildCodexRoleSandboxFailOpenPlan
} = {}) {
  let bwrapPlan;
  try {
    bwrapPlan = buildBwrapPlan(plan);
    assertBackendAvailable({ env: plan.env, bwrapPath: bwrapPlan.bwrapPath });
  } catch (err) {
    if (!(err instanceof BubblewrapIsolationError)) {
      throw err;
    }
    const decision = resolveSandboxFailOpenPlan(plan, err);
    if (decision.disposition === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN) {
      return { outcome: "plain", decision, error: err };
    }
    return { outcome: "refused", decision, error: err };
  }
  return { outcome: "enforced", bwrapPlan };
}

const CODEX_ROLE_PLAIN_SPAWN_PROVENANCE_CODE =
  "agent_launch.codex_role.unenforced_plain_spawn.v1";

function formatCodexRolePlainSpawnProvenance(plan, decision) {
  const warning = decision?.warning ?? {};
  const posture = warning.enforcement_posture ?? {};
  const backend = warning.backend_availability ?? {};
  return `${CODEX_ROLE_PLAIN_SPAWN_PROVENANCE_CODE}: ${JSON.stringify({
    role: plan.role,
    subject: plan.subject,
    disposition: WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN,
    enforced: false,
    isolation_backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE,
    reason_code: posture.reason_code ?? null,
    reason: posture.reason ?? null,
    paid_node_engine_key_present: posture.paid_node_engine_key_present === true,
    opt_out: posture.opt_out ?? null,
    backend_state: backend.state ?? null,
    backend_reason: backend.reason ?? null
  })}`;
}

function emitCodexRolePlainSpawnNotice(plan, io, decision) {
  const message = decision?.warning?.message
    ?? "filesystem isolation is NOT active; this structured role launch is running unenforced";
  writeStderr(io.stderr, `codex-${plan.role}: WARNING: ${message}\n`);
  writeStderr(io.stderr, `${formatCodexRolePlainSpawnProvenance(plan, decision)}\n`);
}

function formatCodexRoleSandboxFailOpenRefusal(plan, decision, error) {
  const refusal = decision?.refusal ?? null;
  const reason = refusal?.reason ?? "enforcement_required";
  const remediation = Array.isArray(refusal?.detail?.remediation)
    ? refusal.detail.remediation
    : [
        "install or repair the configured isolation backend (bubblewrap)",
        "remove the paid Chassis Control Engine key for local/free unenforced posture",
        "set the explicit unsandboxed opt-out only if the operator deliberately accepts unenforced local execution"
      ];
  const diagnosticText = error?.code
    ? `: ${error.code}: ${error.message ?? "isolation backend unavailable or unusable"}`
    : "";
  return [
    `codex-${plan.role}: structured role launch refused: a paid enforcement key requires an enforced isolation backend${diagnosticText} (${reason})`,
    `Remediation: ${remediation.join("; ")}.`
  ].join("\n");
}

function buildCodexOrchestratorResumeFailOpenPlan(plan, availability) {
  return buildWorkspaceAgentFailOpenPlan({
    launchFacts: {
      command: plan.command,
      args: plan.args,
      cwd: plan.repo,
      env: plan.env
    },
    role: plan.role,
    subject: plan.subject,
    workspaceDir: plan.repo,
    classifyIsolationBackendAvailability: () =>
      backendAvailabilityFromOrchestratorProbe(availability)
  });
}

function buildCodexOrchestratorResumeIsolationSummary(plan, availability) {
  if (availability?.available === true) {
    return buildCodexOrchestratorIsolationSummary(availability);
  }

  const failOpenPlan = buildCodexOrchestratorResumeFailOpenPlan(plan, availability);
  if (failOpenPlan.disposition === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN) {
    return {
      ...buildCodexOrchestratorIsolationSummary(availability),
      fail_open_disposition: failOpenPlan.disposition,
      failOpenWarning: failOpenPlan.warning ?? null,
      enforcement: failOpenPlan.enforcement ?? null,
      isolation: failOpenPlan.isolation ?? null
    };
  }
  return {
    mode: ORCHESTRATOR_ISOLATION_MODES.BUBBLEWRAP,
    operator_direct_mode_allowed: true,
    bwrap_available: false,
    os_filesystem_isolation: true,
    write_scope_enforced: true,
    warning: null,
    diagnostic: availability?.diagnostic ?? null,
    fail_open_disposition: failOpenPlan.disposition,
    refusal: failOpenPlan.refusal ?? {
      reason: WORKSPACE_AGENT_FAIL_OPEN_CLOSED_REASONS.BACKEND_AVAILABILITY_UNTRUSTED,
      detail: null
    },
    enforcement: failOpenPlan.enforcement ?? null
  };
}

function formatOrchestratorResumeFailOpenRefusal(plan) {
  const refusal = plan.operatorIsolation.refusal;
  const reason = refusal?.reason ?? "unknown";
  const detail = refusal?.detail ?? null;
  const diagnostic = detail?.backend_availability?.diagnostic
    ?? plan.operatorIsolation?.diagnostic
    ?? null;
  const diagnosticText = diagnostic?.code
    ? `: ${diagnostic.code}: ${diagnostic.message ?? "bwrap backend unavailable or unusable"}`
    : "";
  const remediation = Array.isArray(detail?.remediation)
    ? detail.remediation
    : [
        "install or repair bubblewrap (bwrap)",
        "remove the paid Node Engine key for local/free unenforced posture",
        "set the explicit unsandboxed opt-out only if the operator deliberately accepts unenforced local execution"
      ];
  return [
    `codex-${plan.role}: bubblewrap isolation refused for Codex orchestrator resume: ${reason}${diagnosticText}`,
    `Remediation: ${remediation.join("; ")}.`
  ].join("\n");
}

function formatOrchestratorResumePlainSpawnProvenance(plan) {
  const warning = plan.operatorIsolation.failOpenWarning;
  const posture = warning?.enforcement_posture ?? {};
  const backend = warning?.backend_availability ?? {};
  return `${ORCHESTRATOR_RESUME_PLAIN_SPAWN_PROVENANCE_CODE}: ${JSON.stringify({
    role: plan.role,
    subject: plan.subject,
    disposition: WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN,
    enforced: false,
    isolation_backend: WORKSPACE_AGENT_RUN_ISOLATION_BACKENDS.NONE,
    reason_code: posture.reason_code ?? null,
    reason: posture.reason ?? null,
    paid_node_engine_key_present: posture.paid_node_engine_key_present === true,
    opt_out: posture.opt_out ?? null,
    backend_state: backend.state ?? null,
    backend_reason: backend.reason ?? null
  })}`;
}

export function buildCodexOrchestratorResumeLateBwrapSpawnFailureSummary(plan, error) {
  const availability = {
    available: false,
    diagnostic: {
      code: error?.code ?? null,
      message: error?.message ?? null,
      detail: error?.detail ?? null
    }
  };
  return buildCodexOrchestratorResumeIsolationSummary(plan, availability);
}

export async function runInteractiveOrchestratorChild({
  plan,
  io,
  bwrapPlan,
  spawnOrchestrator = spawnOrchestratorAndWait,
  spawnLaunch = spawnIsolated,
  spawnDirect = spawnDirectAndWait
} = {}) {
  let outcome;
  try {
    outcome = await spawnOrchestrator({
      runtimeDir: plan.runtimeDir,
      descriptor: codexOrchestratorSessionDescriptor(plan),
      bwrapPlan,
      spawnLaunch,
      spawnOptions: { env: plan.env }
    });
  } catch (err) {
    if (!(err instanceof BubblewrapIsolationError) || plan.role !== "orch-resume") {
      throw err;
    }
    plan.operatorIsolation =
      buildCodexOrchestratorResumeLateBwrapSpawnFailureSummary(plan, err);
    await dispatchOrchestratorResumeLateBwrapFallback(plan, io, err, { spawnDirect });
    return;
  }
  process.exitCode = outcome.exitCode;
}

async function dispatchOrchestratorResumeLateBwrapFallback(
  plan,
  io,
  error,
  { spawnDirect = spawnDirectAndWait } = {}
) {
  if (
    plan.operatorIsolation?.mode === ORCHESTRATOR_ISOLATION_MODES.DIRECT
    && plan.operatorIsolation?.failOpenWarning
  ) {
    writeStderr(io.stderr, `${OPERATOR_DIRECT_MODE_WARNING}\n`);
    writeStderr(
      io.stderr,
      `${formatOrchestratorResumePlainSpawnProvenance(plan)}\n`
    );
    const status = await spawnDirect(plan.command, plan.args, {
      cwd: plan.repo,
      env: plan.env,
      stdio: "inherit"
    });
    process.exitCode = status ?? 0;
    return;
  }
  if (plan.operatorIsolation?.refusal) {
    writeStderr(
      io.stderr,
      `${formatOrchestratorResumeFailOpenRefusal(plan)}\n`
    );
    process.exitCode = 1;
    return;
  }
  writeStderr(
    io.stderr,
    `${formatBubblewrapIsolationRefusal(plan.role, error)}\n`
  );
  process.exitCode = 1;
}

export function attachOperatorOrchestratorIsolation(plan, {
  probeBwrapAvailability = probeOrchestratorBwrapAvailability
} = {}) {
  if (!isOperatorOrchestratorInteractivePlan(plan)) {
    return plan;
  }
  const probe = (probeBwrapAvailability ?? probeOrchestratorBwrapAvailability)({
    env: plan.env
  });
  plan.operatorIsolation = plan.role === "orch-resume"
    ? buildCodexOrchestratorResumeIsolationSummary(plan, probe)
    : buildCodexOrchestratorIsolationSummary(probe);
  return plan;
}

function publicPlan(plan) {
  return {
    mode: plan.mode,
    role: plan.role,
    subject: plan.subject,
    repo: plan.repo,
    command: plan.command,
    args: plan.args,
    prepared_new_write_roots: Array.isArray(plan.preparedNewWriteRoots)
      ? plan.preparedNewWriteRoots.map((entry) => ({
          scope_entry: entry.scope_entry,
          directory: entry.directory
        }))
      : [],
    refusal: plan.refusal ? {
      wrapper_gate_code: plan.refusal.wrapper_gate_code,
      allowed: plan.refusal.allowed,
      unit_address: plan.refusal.unit_address,
      expected_unit_address: plan.refusal.expected_unit_address,
      diagnostics: plan.refusal.diagnostics,
      readiness: plan.refusal.readiness,

      worker_admission: plan.refusal.worker_admission ?? null,
      remote_worker_admission: plan.refusal.remote_worker_admission ?? null,
      dependency_evidence: plan.refusal.dependency_evidence ?? null
    } : null,
    runtime_dir: plan.runtimeDir,
    run_dir: plan.runDir,
    final_path: plan.finalPath,
    log_path: plan.logPath,
    env: {
      AGENT_ROLE: plan.env.AGENT_ROLE,
      AGENT_IN: plan.env.AGENT_IN,
      AGENT_WK: plan.env.AGENT_WK,
      AGENT_SUBJECT: plan.env.AGENT_SUBJECT,
      CODEX_HOME: plan.env.CODEX_HOME,
      CODEX_ORCH_THREAD_NAME: plan.env.CODEX_ORCH_THREAD_NAME,
      CODEX_ORCH_RUNTIME_DIR: plan.env.CODEX_ORCH_RUNTIME_DIR
    },
    isolation: isolationSummaryForPublic(plan.isolation),

    operator_isolation: plan.operatorIsolation ?? null
  };
}

export function normalizeRole(role) {
  if (typeof role !== "string") {
    return role;
  }
  if (role === "worker-fast" || role === "worker_fast") {
    return "worker-fast";
  }
  if (role === "worker-spark" || role === "worker_spark") {

    return null;
  }
  return role;
}

function hasFastFlagSpelling(options) {
  if (!options || typeof options !== "object") {
    return false;
  }
  return (
    options.fast === true
    || options["worker-fast"] === true
    || options.worker_fast === true
  );
}

function stripLeadingDashDash(values) {
  return values[0] === "--" ? values.slice(1) : values;
}
