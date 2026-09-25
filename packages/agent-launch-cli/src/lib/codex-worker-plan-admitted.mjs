import path from "node:path";

import {
  collectSliceDeclaredWritableFiles,
  isolationWritableDirectoriesForLaunch,
  planResolvedWritableDirectories,
  planWorkerWriteScopeNewDirectories,
  projectPermissionWritesForResolvedScope,
  projectPermissionWritesForWorkerLaunch
} from "./codex-worker-write-scope-plan.mjs";
import { deriveWritableMountsFromResolvedScope } from "./workspace-agent-write-scope.mjs";
import { composeWorkerTestRuntime } from "./test-execution/worker-runtime.mjs";

import { resolveDispatchedRoleModel } from "./agent-launch-profiles.mjs";
import {
  buildModelUnsetRefusal
} from "./codex-worker-plan-refusals.mjs";

export async function buildAdmittedCodexWorkerPlan({
  role,
  wk,
  env,
  repo,
  resolvedProfile,
  frozenWorkerScopeAuthority,
  gate,
  loaded,
  sliceId,
  recordId,
  unitAddress,
  managedWorkerCommitRequired,
  worktree_provisioning,
  serverProvisionedWorktreeGitBinding,
  remoteAdmissionProvenance,

  terminalStructuredRoleResultMode,
  buildCodexWritableSandboxArgs,
  buildHeadlessPlan,
  ROLE_CONFIG
}) {

  const resolvedScope = frozenWorkerScopeAuthority?.resolved_scope ?? null;
  const resolvedMounts = resolvedScope
    ? deriveWritableMountsFromResolvedScope({ workspaceDir: repo, resolvedScope })
    : null;
  const writeScope = gate.launch_packet.canonical_summary.write_scope;
  const projectPermissionWrites = resolvedScope
    ? projectPermissionWritesForResolvedScope(resolvedScope)
    : await projectPermissionWritesForWorkerLaunch(repo, writeScope);
  const preparedNewWriteRoots = resolvedScope
    ? await planResolvedWritableDirectories(repo, resolvedScope)
    : await planWorkerWriteScopeNewDirectories(repo, writeScope);
  const selectedSliceForWritables = sliceId && Array.isArray(loaded.record.slices)
    ? loaded.record.slices.find((slice) => slice && slice.id === sliceId) || null
    : null;
  const isolationWritableProjectRoots = resolvedMounts?.writableRoots
    ?? await isolationWritableDirectoriesForLaunch(repo, writeScope);
  const isolationWritableFiles = resolvedMounts?.writableFiles ?? (await collectSliceDeclaredWritableFiles({
    repo,
    record: loaded.record,
    selectedSlice: selectedSliceForWritables,
    writeScope
  })).map((relPath) => path.resolve(repo, relPath));
  const sandboxArgs = buildCodexWritableSandboxArgs(repo, {
    writableProjectRoots: projectPermissionWrites
  });

  const roleModel = resolveDispatchedRoleModel({ role, resolvedProfile, dir: repo });
  if (!roleModel.ok) {
    return buildModelUnsetRefusal({
      role,
      env,
      repo,
      recordId,
      unitAddress,
      reason: roleModel.reason,
      detail: roleModel.detail
    });
  }
  const model = roleModel.model;
  const config = ROLE_CONFIG[role];

  const profile = typeof resolvedProfile?.backend_profile_key === "string"
    && resolvedProfile.backend_profile_key.length > 0
    ? resolvedProfile.backend_profile_key
    : config.defaultProfile;
  const prompt = gate.launch_packet.prompt;

  const managedGitlessRepoCheckSkip = managedWorkerCommitRequired
    ? ["--skip-git-repo-check"]
    : [];
  const baseArgs = [
    "--disable", "shell_snapshot",
    "-C", repo,
    ...sandboxArgs,
    "-a", "never",
    "-p", profile,
    "exec",
    ...managedGitlessRepoCheckSkip,
    "--ignore-user-config",
    "--ignore-rules"
  ];
  const headlessPlan = await buildHeadlessPlan({
    role,
    subject: unitAddress,
    repo,
    env: {
      ...env,
      AGENT_ROLE: config.envRole,
      AGENT_WK: recordId,
      AGENT_SUBJECT: unitAddress,
    },
    logPrefix: config.logPrefix,
    verbose: env[config.verboseEnv] === "1",
    model,
    argsPrefix: baseArgs,
    prompt,
    terminalStructuredRoleResultMode,
    writableProjectRoots: isolationWritableProjectRoots,
    writableFiles: isolationWritableFiles,

    workerScopeAuthority: frozenWorkerScopeAuthority
  });
  headlessPlan.preparedNewWriteRoots = preparedNewWriteRoots;
  headlessPlan.worker_scope_authority = frozenWorkerScopeAuthority;
  headlessPlan.worktree_provisioning = worktree_provisioning;

  headlessPlan.worker_test_runtime = headlessPlan.mode !== "refusal" &&
    frozenWorkerScopeAuthority != null && typeof worktree_provisioning?.main_repo === "string"
    ? composeWorkerTestRuntime({ mainRepo: worktree_provisioning.main_repo, checkout: repo,
      workerScopeAuthority: frozenWorkerScopeAuthority })
    : null;
  if (serverProvisionedWorktreeGitBinding !== null) {
    headlessPlan.provisionedWorktreeGitBinding = serverProvisionedWorktreeGitBinding;
    headlessPlan.provisioned_worktree_git_binding = serverProvisionedWorktreeGitBinding;
  }

  if (remoteAdmissionProvenance) {
    headlessPlan.workerAdmissionRemote = remoteAdmissionProvenance;
  }
  return headlessPlan;
}
