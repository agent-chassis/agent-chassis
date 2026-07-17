

import path from "node:path";
import { mkdtemp } from "node:fs/promises";

import { resolveAgentRoleResultSchemaPath } from "@agent-chassis/agent-launch-core/src/lib/agent-role-result-schema-path.mjs";
import {
  TERMINAL_STRUCTURED_ROLE_RESULT_MODES
} from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import {
  ensureWritableDirectory,
  sanitizeCodexChildEnv,
  setupCodexRuntimeHome
} from "./workspace-agent-codex-runtime-facts.mjs";
import { subjectKey } from "./codex-role-orchestrator-history.mjs";
import {
  buildCodexWorkerWikiMcpEnvOverrides,
  buildCodexWorkspaceMcpEnvOverrides,
  injectCodexConfigOverridesBeforeFinalPositional
} from "./codex-role-mcp-env.mjs";
import {
  extractRepoInternalAddDirRoots
} from "./codex-role-sandbox-args.mjs";
import {
  buildCodexReasoningEffortConfigOverrides
} from "./codex-role-reasoning-effort.mjs";
import {
  buildCodexFactResolutionRefusalPlan,
  isCodexFactResolutionRefusal
} from "./codex-role-fact-refusal.mjs";
import {
  buildCodexRoleIsolationInputs,
  resolveCodexScopeMountWritePosture
} from "./codex-role-adapter-isolation.mjs";

export async function buildHeadlessPlan({
  role,
  subject,
  repo,
  env,
  logPrefix,
  verbose,
  argsPrefix,
  prompt,
  model = null,
  writableProjectRoots: explicitWritableProjectRoots = null,
  writableFiles: explicitWritableFiles = null,
  workspaceAlias = null,
  workspaceDir = null,
  dispatchWorktreeRoot = null,
  terminalStructuredRoleResultMode = undefined,
  workerScopeAuthority = null,
  workerWikiMcpAssignedUnit = null,
  managedWorker = false,
  workerWikiMcpWorktreeProvisioning = null,
  workerWikiMcpSliceBinding = null,

  workerWikiMcpHostWriteEndpoint = null
}) {
  const hasWorkerWikiMcpBinding = workerWikiMcpAssignedUnit !== null || managedWorker === true ||
    workerWikiMcpWorktreeProvisioning !== null || workerWikiMcpSliceBinding !== null;
  const workerWikiMcpEnvOverrides = hasWorkerWikiMcpBinding
    ? buildCodexWorkerWikiMcpEnvOverrides({
        assignedUnit: workerWikiMcpAssignedUnit,
        managedWorker,
        worktreeProvisioning: workerWikiMcpWorktreeProvisioning,
        sliceBinding: workerWikiMcpSliceBinding,
        hostWriteAuthorityEndpoint: workerWikiMcpHostWriteEndpoint
      })
    : [];
  const runtimeHomeResult = await setupCodexRuntimeHome({ env, repo, subject, role });
  if (isCodexFactResolutionRefusal(runtimeHomeResult)) {
    return buildCodexFactResolutionRefusalPlan({
      role,
      subject,
      repo,
      env,
      result: runtimeHomeResult
    });
  }
  const runtimeEnv = sanitizeCodexChildEnv(runtimeHomeResult);
  const modelArgs = typeof model === "string" && model.trim() !== "" ? ["-m", model.trim()] : [];

  const schemaConstraintArgs =
    terminalStructuredRoleResultMode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
      ? ["--output-schema", resolveAgentRoleResultSchemaPath()]
      : [];
  const workspaceMcpEnvOverrides = buildCodexWorkspaceMcpEnvOverrides({
    workspaceAlias,
    workspaceDir,
    dispatchWorktreeRoot
  });
  const writePosture = resolveCodexScopeMountWritePosture(role);
  const runDirBase = path.join(runtimeEnv.CODEX_HOME, "tmp");
  await ensureWritableDirectory(runDirBase, role, "launcher runtime directory");

  const writableProjectRoots = Array.isArray(explicitWritableProjectRoots)
    ? explicitWritableProjectRoots
    : (writePosture.scopeMount?.writableProjectRoots?.length > 0
        ? writePosture.scopeMount.writableProjectRoots
        : extractRepoInternalAddDirRoots(argsPrefix, repo));
  const writableFiles = Array.isArray(explicitWritableFiles)
    ? explicitWritableFiles
    : [];
  const isolation = buildCodexRoleIsolationInputs({
    role,
    repo,
    env: runtimeEnv,
    writableProjectRoots,
    writableFiles,
    runtimeDir: runtimeEnv.CODEX_HOME,
    workerScopeAuthority,
    subject
  });
  if (isCodexFactResolutionRefusal(isolation)) {
    return buildCodexFactResolutionRefusalPlan({
      role,
      subject,
      repo,
      env: runtimeEnv,
      result: isolation
    });
  }
  if (verbose) {
    const args = [...argsPrefix, ...modelArgs, ...schemaConstraintArgs, prompt];
    injectCodexConfigOverridesBeforeFinalPositional(args, [
      ...buildCodexReasoningEffortConfigOverrides({ role, repo, model }),
      ...workspaceMcpEnvOverrides,
      ...workerWikiMcpEnvOverrides
    ]);
    return {
      mode: "headless-verbose",
      role,
      subject,
      repo,
      command: "codex",
      args,
      env: runtimeEnv,
      isolation,
      worker_scope_authority: workerScopeAuthority
    };
  }

  const runDir = await mkdtemp(path.join(runDirBase, `${logPrefix}.${subjectKey(subject)}.`));
  const finalPath = path.join(runDir, "final.md");
  const logPath = path.join(runDir, "run.log");
  const args = [...argsPrefix, ...modelArgs, "--output-last-message", finalPath, ...schemaConstraintArgs, prompt];
  injectCodexConfigOverridesBeforeFinalPositional(args, [
    ...buildCodexReasoningEffortConfigOverrides({ role, repo, model }),
    ...workspaceMcpEnvOverrides,
    ...workerWikiMcpEnvOverrides
  ]);
  return {
    mode: "headless",
    role,
    subject,
    repo,
    command: "codex",
    args,
    env: runtimeEnv,
    runDir,
    finalPath,
    logPath,
    logPrefix,
    isolation,
    worker_scope_authority: workerScopeAuthority
  };
}
