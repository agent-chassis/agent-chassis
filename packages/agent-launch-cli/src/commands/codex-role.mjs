import path from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "node:fs/promises";
import { spawn } from "node:child_process";

import { loadWorkRecordById } from "@agent-chassis/wiki-core";

import { parseArgs } from "../lib/cli.mjs";
import {
  BubblewrapIsolationError,
  assertBubblewrapAvailable,
  spawnIsolated
} from "../lib/launch-isolation.mjs";
import {
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS
} from "../lib/launch-isolation-failopen.mjs";

import {
  OPERATOR_DIRECT_MODE_WARNING,
  ORCHESTRATOR_ISOLATION_MODES
} from "../lib/orchestrator-launch-isolation.mjs";
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
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
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

import {
  buildCodexRoleSandboxFailOpenPlan,
  emitCodexRolePlainSpawnNotice,
  formatBubblewrapIsolationRefusal,
  formatCodexRoleSandboxFailOpenRefusal,
  formatOrchestratorResumeFailOpenRefusal,
  formatOrchestratorResumePlainSpawnProvenance,
  prepareCodexRoleSandboxLaunch
} from "../lib/codex-role-sandbox-fail-open.mjs";
export {
  buildCodexOrchestratorResumeLateBwrapSpawnFailureSummary,
  buildCodexRoleSandboxFailOpenPlan,
  prepareCodexRoleSandboxLaunch
} from "../lib/codex-role-sandbox-fail-open.mjs";
import {
  attachOperatorOrchestratorIsolation,
  runInteractiveOrchestratorChild,
  spawnDirectAndWait,
  spawnIsolatedAndWait
} from "../lib/codex-role-orchestrator-runtime.mjs";
export {
  attachOperatorOrchestratorIsolation,
  runInteractiveOrchestratorChild
} from "../lib/codex-role-orchestrator-runtime.mjs";
import {
  createCodexOrchestratorDispatchSidecarAdapter,
  maybeStartOrchestratorDispatchSidecar
} from "../lib/codex-role-dispatch-sidecar-adapter.mjs";
export {
  createCodexOrchestratorDispatchSidecarAdapter,
  maybeStartOrchestratorDispatchSidecar
} from "../lib/codex-role-dispatch-sidecar-adapter.mjs";

const CODEX_ROLE_MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

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
  const headless = options.headless === true || context.headless === true;
  const logFile = typeof options["log-file"] === "string"
    ? options["log-file"]
    : (typeof context.logFile === "string" ? context.logFile : null);
  const plan = await buildCodexRolePlan({
    role,
    subject: rawSubject,
    promptArgs,
    env: process.env,
    cwd: process.cwd(),
    resolvedProfile: context.resolvedProfile ?? null,
    headless,
    logFile,
    dispatchWorktreeRoot: context.dispatchWorktreeRoot ?? null,
    provisionedWorktreeGitBinding: context.provisionedWorktreeGitBinding ?? null,
    provisionedWorktreeGitIdentity: context.provisionedWorktreeGitIdentity ?? null,
    provisioned_worktree_git_binding: context.provisioned_worktree_git_binding ?? null,
    provisioned_worktree_git_identity: context.provisioned_worktree_git_identity ?? null
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
  dispatchWorktreeRoot = null,
  provisionedWorktreeGitBinding = null,
  provisionedWorktreeGitIdentity = null,
  provisioned_worktree_git_binding = null,
  provisioned_worktree_git_identity = null,
  worker_scope_authority = null,
  worktree_provisioning = null,

  hostWriteAuthorityEndpoint = null,
  sourceToolSurface = null,
  headless = false,
  logFile = null,

  terminalStructuredRoleResultMode = undefined,

  config_root_dir = null,
  trusted_frozen_review_contract = null
} = {}) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "orch" || normalizedRole === "orch-resume") {
    const orchestratorPlan = buildOrchestratorPlan({
      role: normalizedRole,
      initiative: subject,
      promptArgs,
      env,
      cwd,
      resolvedProfile,
      headless,
      logFile
    });
    if (typeof dispatchWorktreeRoot === "string" && dispatchWorktreeRoot.length > 0) {
      orchestratorPlan.dispatchWorktreeRoot = dispatchWorktreeRoot;
    }
    return orchestratorPlan;
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
      sourceToolSurface,
      provisionedWorktreeGitBinding,
      provisionedWorktreeGitIdentity,
      provisioned_worktree_git_binding,
      provisioned_worktree_git_identity,
      worker_scope_authority,
      worktree_provisioning,
      hostWriteAuthorityEndpoint
    });
    if (workerPlan && typeof workerPlan === "object" && workerPlan.mode !== "refusal") {
      const managedMainRepo = workerPlan.worktree_provisioning?.main_repo ?? null;
      const workspaceMcpEnvOverrides = buildCodexWorkspaceMcpEnvOverrides({
        workspaceAlias,
        workspaceDir: managedMainRepo ?? workspaceDir,
        dispatchWorktreeRoot
      }).filter((override) =>
        !override.startsWith(`mcp_servers.${CODEX_WIKI_MCP_SERVER_NAME}.env.${WIKI_MCP_TOOL_PROFILE_ENV_VAR}=`)
      );
      if (workspaceMcpEnvOverrides.length > 0 && Array.isArray(workerPlan.args)) {
        injectCodexConfigOverridesBeforeFinalPositional(workerPlan.args, workspaceMcpEnvOverrides);
      }
    }
    if (
      workerPlan &&
      typeof workerPlan === "object" &&
      workerPlan.mode !== "refusal" &&
      typeof dispatchWorktreeRoot === "string" &&
      dispatchWorktreeRoot.length > 0
    ) {
      workerPlan.dispatchWorktreeRoot = dispatchWorktreeRoot;
    }
    return ensureRefusalDependencyEvidence(workerPlan);
  }
  if (normalizedRole === "review") {
    const acceptance = await resolveCodexReadOnlyAcceptance({
      role: normalizedRole,
      subject,
      cwd,
      workspaceDir,

      frozenReviewContract: trusted_frozen_review_contract
    });
    const reviewPlan = await buildReadOnlyPlan({
      role: normalizedRole,
      subject,
      promptArgs,
      env,
      cwd,
      resolvedProfile,
      workspaceAlias,
      workspaceDir,
      dispatchWorktreeRoot,
      terminalStructuredRoleResultMode,

      canonicalRepo: config_root_dir,
      ...acceptance
    });
    if (typeof dispatchWorktreeRoot === "string" && dispatchWorktreeRoot.length > 0) {
      reviewPlan.dispatchWorktreeRoot = dispatchWorktreeRoot;
    }
    return reviewPlan;
  }
  if (normalizedRole === "redteam") {
    const acceptance = await resolveCodexReadOnlyAcceptance({
      role: normalizedRole,
      subject,
      cwd,
      workspaceDir
    });
    const redteamPlan = await buildReadOnlyPlan({
      role: normalizedRole,
      subject,
      promptArgs,
      env,
      cwd,
      resolvedProfile,
      workspaceAlias,
      workspaceDir,
      dispatchWorktreeRoot,
      terminalStructuredRoleResultMode,
      ...acceptance
    });
    if (typeof dispatchWorktreeRoot === "string" && dispatchWorktreeRoot.length > 0) {
      redteamPlan.dispatchWorktreeRoot = dispatchWorktreeRoot;
    }
    return redteamPlan;
  }
  throw new Error(`Unknown codex role: ${role}\n\n${HELP_TEXT}`);
}

async function resolveCodexReadOnlyAcceptance({ role, subject, cwd, workspaceDir, frozenReviewContract = null }) {
  if (typeof subject !== "string" || !subject.startsWith("WK-")) {
    return {};
  }
  const repo = workspaceDir ?? await findRepoRoot(cwd);
  return resolveFindingsOnlyAcceptanceContract({
    role,
    subject,
    workspaceDir: repo,
    loadWorkRecord: loadWorkRecordById,

    frozenReviewContract
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
  const supervisedOrchestratorPlan = isSupervisedOrchestratorPlan(plan);

  if (plan.operatorIsolation?.refusal) {
    writeStderr(
      io.stderr,
      `${formatOrchestratorResumeFailOpenRefusal(plan)}\n`
    );
    process.exitCode = 1;
    return;
  }

  if (
    plan.operatorIsolation?.mode === ORCHESTRATOR_ISOLATION_MODES.DIRECT
    && !isHeadlessOrchestratorPlan(plan)
  ) {
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
  if (plan.operatorIsolation || supervisedOrchestratorPlan) {
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

  if (supervisedOrchestratorPlan) {
    await runInteractiveOrchestratorChild({ plan, io, bwrapPlan });
    return;
  }
  if (plan.mode === "headless-verbose") {
    await runHeadlessVerboseChild({ plan, io, bwrapPlan, plainSpawnDecision });
    return;
  }
  await runHeadlessCaptureChild({ plan, io, bwrapPlan, plainSpawnDecision });
}

function isHeadlessOrchestratorPlan(plan) {
  return Boolean(plan)
    && (plan.headless === true || plan.mode === "orchestrator-headless")
    && (plan.role === "orch" || plan.role === "orch-resume");
}

function isSupervisedOrchestratorPlan(plan) {
  return Boolean(plan)
    && (plan.mode === "interactive" || isHeadlessOrchestratorPlan(plan))
    && (plan.role === "orch" || plan.role === "orch-resume");
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
    headless: plan.headless === true,
    headless_log_target: plan.headlessLogTarget ?? null,
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
