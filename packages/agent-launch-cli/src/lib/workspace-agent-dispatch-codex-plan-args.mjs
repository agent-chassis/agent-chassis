function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveProvisionedWorktreeGitBinding({
  provisionedWorktreeGitBinding = null,
  provisioned_worktree_git_binding = null
} = {}) {
  const binding = provisionedWorktreeGitBinding ?? provisioned_worktree_git_binding ?? null;
  return isPlainObject(binding) ? binding : null;
}

function resolveDispatchWorktreeRoot(dispatchWorktreeRoot = null) {
  return typeof dispatchWorktreeRoot === "string" && dispatchWorktreeRoot.length > 0
    ? dispatchWorktreeRoot
    : null;
}

export function buildCodexDispatchWorkerPlanArgs({
  role,
  subject,
  promptArgs,
  env,
  cwd,
  resolvedProfile,
  workspaceAlias,
  workspaceDir,
  acceptanceCriteria,
  acceptanceValidation,
  sourceToolSurface,
  terminalStructuredRoleResultMode,
  dispatchWorktreeRoot = null,
  provisionedWorktreeGitBinding = null,
  provisioned_worktree_git_binding = null,
  worker_scope_authority = null,
  worktree_provisioning = null,

  hostWriteAuthorityEndpoint = null,

  configRootDir = null,
  trustedFrozenReviewContract = null
}) {
  const planArgs = {
    role,
    subject,
    promptArgs,
    env,
    cwd,
    resolvedProfile,
    workspaceAlias,
    workspaceDir,
    acceptanceCriteria,
    acceptanceValidation,
    sourceToolSurface,
    terminalStructuredRoleResultMode
  };
  if (worker_scope_authority !== null) {
    planArgs.worker_scope_authority = worker_scope_authority;
  }
  if (worktree_provisioning !== null) {
    planArgs.worktree_provisioning = worktree_provisioning;
  }
  if (typeof hostWriteAuthorityEndpoint === "string" && hostWriteAuthorityEndpoint.length > 0) {
    planArgs.hostWriteAuthorityEndpoint = hostWriteAuthorityEndpoint;
  }
  if (typeof configRootDir === "string" && configRootDir.length > 0) {
    planArgs.config_root_dir = configRootDir;
  }
  if (trustedFrozenReviewContract !== null && trustedFrozenReviewContract !== undefined) {
    planArgs.trusted_frozen_review_contract = trustedFrozenReviewContract;
  }
  const serverProvisionedWorktreeGitBinding = resolveProvisionedWorktreeGitBinding({
    provisionedWorktreeGitBinding,
    provisioned_worktree_git_binding
  });
  if (serverProvisionedWorktreeGitBinding !== null) {
    planArgs.provisionedWorktreeGitBinding = serverProvisionedWorktreeGitBinding;
    planArgs.provisioned_worktree_git_binding = serverProvisionedWorktreeGitBinding;
  }
  const serverDispatchWorktreeRoot = resolveDispatchWorktreeRoot(dispatchWorktreeRoot);
  if (serverDispatchWorktreeRoot !== null) {
    planArgs.dispatchWorktreeRoot = serverDispatchWorktreeRoot;
  }
  return planArgs;
}
