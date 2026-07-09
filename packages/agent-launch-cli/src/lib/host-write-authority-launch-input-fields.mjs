

export const HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELDS = Object.freeze([
  "caller_session_id",
  "role",
  "subject",
  "workspace_alias",
  "workspace_dir",
  "readiness",
  "run_id",
  "monitor_handle",
  "app",
  "codex_role",
  "model",
  "source_tool_surface",
  "provisionedWorktreeGitBinding",
  "provisioned_worktree_git_binding",
  "dispatchWorktreeRoot"
]);

const HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELD_SET = new Set(
  HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELDS
);

export const HOST_WRITE_AUTHORITY_MODEL_HINT_DISPOSITION = Object.freeze({
  claude: Object.freeze({
    family: "claude",
    accepts_supported_typed_hint: true,
    refuses_unsupported_typed_hint: false,
    ignores_hint: false,
    prose: "Claude may honor a supported typed model hint."
  }),
  codex: Object.freeze({
    family: "codex",
    accepts_supported_typed_hint: false,
    refuses_unsupported_typed_hint: true,
    ignores_hint: false,
    prose: "Codex explicitly refuses unsupported typed model hints; it does not ignore them."
  }),
  agy: Object.freeze({
    family: "agy",
    accepts_supported_typed_hint: false,
    refuses_unsupported_typed_hint: true,
    ignores_hint: false,
    prose: "Agy explicitly refuses unsupported typed model hints; it does not ignore them."
  })
});

export function hasHostWriteAuthorityLaunchInputField(field) {
  return HOST_WRITE_AUTHORITY_LAUNCH_INPUT_FIELD_SET.has(field);
}

export function getHostWriteAuthorityModelHintDisposition(family) {
  if (typeof family !== "string") {
    return null;
  }

  return HOST_WRITE_AUTHORITY_MODEL_HINT_DISPOSITION[family.toLowerCase()] ?? null;
}

export function describeHostWriteAuthorityModelHintDisposition(family) {
  const disposition = getHostWriteAuthorityModelHintDisposition(family);
  return disposition ? disposition.prose : null;
}
