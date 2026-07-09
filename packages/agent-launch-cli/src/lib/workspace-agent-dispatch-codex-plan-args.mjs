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
  provisioned_worktree_git_binding = null
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
