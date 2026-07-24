

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
  additionalReadOnlyRoots = []
}) {
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

  const schemaConstraintPath =
    terminalStructuredRoleResultMode === TERMINAL_STRUCTURED_ROLE_RESULT_MODES.SCHEMA_CONSTRAINED
      ? resolveAgentRoleResultSchemaPath()
      : null;
  const schemaConstraintArgs = schemaConstraintPath === null
    ? []
    : ["--output-schema", schemaConstraintPath];
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
  const baseIsolation = buildCodexRoleIsolationInputs({
    role,
    repo,
    env: runtimeEnv,
    writableProjectRoots,
    writableFiles,
    runtimeDir: runtimeEnv.CODEX_HOME,
    workerScopeAuthority,
    subject
  });
  if (isCodexFactResolutionRefusal(baseIsolation)) {
    return buildCodexFactResolutionRefusalPlan({
      role,
      subject,
      repo,
      env: runtimeEnv,
      result: baseIsolation
    });
  }

  const extraReadOnlyRoots = Array.isArray(additionalReadOnlyRoots)
    ? additionalReadOnlyRoots
    : [];
  const isolation = schemaConstraintPath === null && extraReadOnlyRoots.length === 0
    ? baseIsolation
    : Object.freeze({
        ...baseIsolation,
        read_only_roots: Object.freeze([
          ...baseIsolation.read_only_roots,
          ...(schemaConstraintPath === null ? [] : [schemaConstraintPath]),
          ...extraReadOnlyRoots
        ]),
        required_read_only_files: Object.freeze(
          schemaConstraintPath === null ? [] : [schemaConstraintPath]
        )
      });
  if (verbose) {
    const args = [...argsPrefix, ...modelArgs, ...schemaConstraintArgs, prompt];
    injectCodexConfigOverridesBeforeFinalPositional(args, [
      ...buildCodexReasoningEffortConfigOverrides({ role, repo, model })
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
    ...buildCodexReasoningEffortConfigOverrides({ role, repo, model })
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
