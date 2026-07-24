import path from "node:path";

import {
  collectSliceDeclaredWritableFiles,
  isolationWritableDirectoriesForLaunch,
  planWorkerWriteScopeNewDirectories,
  projectPermissionWritesForWorkerLaunch
} from "./codex-worker-write-scope-plan.mjs";

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
  buildCodexWritableSandboxArgs,
  buildHeadlessPlan,
  ROLE_CONFIG
}) {

  const writeScope = frozenWorkerScopeAuthority?.write_scope
    ?? gate.launch_packet.canonical_summary.write_scope;
  const projectPermissionWrites = await projectPermissionWritesForWorkerLaunch(repo, writeScope);
  const preparedNewWriteRoots = await planWorkerWriteScopeNewDirectories(repo, writeScope);
  const selectedSliceForWritables = sliceId && Array.isArray(loaded.record.slices)
    ? loaded.record.slices.find((slice) => slice && slice.id === sliceId) || null
    : null;
  const declaredWritableFiles = await collectSliceDeclaredWritableFiles({
    repo,
    record: loaded.record,
    selectedSlice: selectedSliceForWritables,
    writeScope
  });
  const isolationWritableProjectRoots = await isolationWritableDirectoriesForLaunch(repo, writeScope);
  const isolationWritableFiles = declaredWritableFiles.map((relPath) => path.resolve(repo, relPath));
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
    writableProjectRoots: isolationWritableProjectRoots,
    writableFiles: isolationWritableFiles,

    workerScopeAuthority: frozenWorkerScopeAuthority
  });
  headlessPlan.preparedNewWriteRoots = preparedNewWriteRoots;
  headlessPlan.worker_scope_authority = frozenWorkerScopeAuthority;
  headlessPlan.worktree_provisioning = worktree_provisioning;
  if (serverProvisionedWorktreeGitBinding !== null) {
    headlessPlan.provisionedWorktreeGitBinding = serverProvisionedWorktreeGitBinding;
    headlessPlan.provisioned_worktree_git_binding = serverProvisionedWorktreeGitBinding;
  }

  if (remoteAdmissionProvenance) {
    headlessPlan.workerAdmissionRemote = remoteAdmissionProvenance;
  }
  return headlessPlan;
}
