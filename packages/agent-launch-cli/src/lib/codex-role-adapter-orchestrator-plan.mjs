

import path from "node:path";
import { mkdir } from "node:fs/promises";

import { summarizeDispatchReadinessDependencies } from "@agent-chassis/agent-launch-core/src/lib/work-record-gate.mjs";
import { HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR } from "./host-write-authority-substrate.mjs";
import { assertFile } from "./codex-role-io.mjs";
import { orchestratorPrompt } from "./codex-role-prompts.mjs";
import {
  runtimeDirFor,
  titleFromPage,
  writeMeta
} from "./codex-role-orchestrator-history.mjs";

import {
  buildOrchestratorThreadName
} from "./orchestrator-launch-settings.mjs";

import { resolveHeadlessLogTarget } from "./orchestrator-launch-runtime.mjs";
import { CODEX_WIKI_MCP_SERVER_NAME } from "./codex-role-mcp-env.mjs";
import { launcherRoleWritableRootPolicy } from "./workspace-agent-family-policy.mjs";
import { codexModelArgs } from "./codex-role-reasoning-effort.mjs";
import {
  buildCodexFactResolutionRefusalPlan,
  isCodexFactResolutionRefusal
} from "./codex-role-fact-refusal.mjs";
import {
  buildCodexApprovalArgsForRole,
  buildCodexRoleIsolationInputs,
  buildCodexWritableSandboxArgsForRole,
  findRepoRoot
} from "./codex-role-adapter-isolation.mjs";

export async function buildOrchestratorPlan({ role, initiative, promptArgs, env, cwd, resolvedProfile = null, headless = false, logFile = null }) {
  assertId(initiative, /^IN-[0-9]+$/, "initiative id like IN-0004", role);
  const repo = await findRepoRoot(env.CODEX_ORCH_REPO || cwd);
  const initiativePath = path.join(repo, "wiki", "initiatives", `${initiative}.md`);
  await assertFile(initiativePath, `${role}: missing initiative page`);
  const repoName = path.basename(repo);
  const runtimeDir = runtimeDirFor({ env, repo, subject: initiative });
  await mkdir(runtimeDir, { recursive: true });
  const title = await titleFromPage(initiativePath);
  const baseThreadName = buildOrchestratorThreadName({
    subject: initiative,
    repoName,
    roleLabel: "orchestrator"
  });
  const threadName = env.CODEX_ORCH_THREAD_NAME || baseThreadName;
  const action = role === "orch-resume" ? "resume" : "launch";
  await writeMeta(runtimeDir, {
    repo,
    repo_name: repoName,
    initiative,
    title,
    thread_name: threadName,
    last_action: action,
    last_used_utc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  });

  const writableRootPolicy = launcherRoleWritableRootPolicy({ role });
  if (!writableRootPolicy.ok) {
    throw new Error(`codex-${role}: ${writableRootPolicy.reason}`);
  }
  const sandboxArgs = buildCodexWritableSandboxArgsForRole(role, repo, {
    writableProjectRoots: writableRootPolicy.writableProjectRoots,
    writableAbsoluteRoots: [runtimeDir]
  });
  const approvalArgs = buildCodexApprovalArgsForRole(role);
  const profile = typeof resolvedProfile?.backend_profile_key === "string"
    && resolvedProfile.backend_profile_key.length > 0
    ? resolvedProfile.backend_profile_key
    : "orchestrator";
  const modelArgs = codexModelArgs(resolvedProfile);

  const isHeadless = headless === true && role !== "orch-resume";
  const prompt = role === "orch-resume"
    ? null
    : orchestratorPrompt({ initiative, threadName, focus: promptArgs.join(" "), headless: isHeadless });
  const execSubcommandArgs = isHeadless ? ["exec", "--ignore-rules"] : [];
  const codexArgs = role === "orch-resume"
    ? [
        "--disable", "shell_snapshot",
        "resume",
        "-C", repo,
        ...sandboxArgs,
        ...approvalArgs,
        "-p", profile,
        ...modelArgs,
        threadName
      ]
    : [
        "--disable", "shell_snapshot",
        "-C", repo,
        ...sandboxArgs,
        ...approvalArgs,
        "-p", profile,
        ...execSubcommandArgs,
        ...modelArgs,
        prompt
      ];

  const orchEnv = {
    ...env,
    AGENT_ROLE: "orchestrator",
    AGENT_IN: initiative,
    CODEX_ORCH_THREAD_NAME: threadName,
    CODEX_ORCH_RUNTIME_DIR: runtimeDir
  };

  delete orchEnv[HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR];
  const isolation = buildCodexRoleIsolationInputs({
    role,
    repo,
    env,
    runtimeDir
  });
  if (isCodexFactResolutionRefusal(isolation)) {
    return buildCodexFactResolutionRefusalPlan({
      role,
      subject: initiative,
      repo,
      env: orchEnv,
      result: isolation
    });
  }

  const dispatchSidecar = {
    kind: "host_write_authority_localhost",
    host: "127.0.0.1",
    envVar: HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR,

    mcpServerName: CODEX_WIKI_MCP_SERVER_NAME
  };

  const headlessLogTarget = isHeadless
    ? resolveHeadlessLogTarget({ runtimeDir, logFileOverride: logFile })
    : null;
  return {
    mode: isHeadless ? "orchestrator-headless" : "interactive",
    role,
    subject: initiative,
    repo,
    runtimeDir,
    command: "codex",
    args: codexArgs,
    env: orchEnv,
    isolation,
    dispatchSidecar,
    headless: isHeadless,
    headlessLogTarget
  };
}

export function ensureRefusalDependencyEvidence(plan) {
  if (!plan || plan.mode !== "refusal" || !plan.refusal || typeof plan.refusal !== "object") {
    return plan;
  }
  if (plan.refusal.dependency_evidence !== undefined && plan.refusal.dependency_evidence !== null) {
    return plan;
  }
  plan.refusal.dependency_evidence = summarizeDispatchReadinessDependencies(plan.refusal.readiness);
  return plan;
}

function assertId(value, pattern, expected, role) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`codex-${role}: expected ${expected}, got: ${value}`);
  }
}
