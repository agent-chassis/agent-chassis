

import path from "node:path";
import { MCP_SANDBOX_RUNTIME_BLOCKER_CODES } from "./mcp-sandbox-profile.mjs";

export const GLOB_CHARACTERS = /[*?\[\]{}]/;

export const BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION = "bubblewrap-launch-plan.v1";

export const BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES = Object.freeze({
  BWRAP_UNAVAILABLE: "agent_launch.isolation.bwrap_unavailable.v1",
  BWRAP_NOT_EXECUTABLE: "agent_launch.isolation.bwrap_not_executable.v1",
  BWRAP_PROBE_FAILED: "agent_launch.isolation.bwrap_probe_failed.v1",
  BWRAP_SPAWN_FAILED: "agent_launch.isolation.bwrap_spawn_failed.v1",
  PATH_NOT_ABSOLUTE: "agent_launch.isolation.path_not_absolute.v1",
  PATH_HAS_GLOB: "agent_launch.isolation.path_has_glob.v1",
  PATH_HAS_TRAVERSAL: "agent_launch.isolation.path_has_traversal.v1",
  PATH_OUTSIDE_REPO: "agent_launch.isolation.path_outside_repo.v1",
  PATH_MISSING_PARENT: "agent_launch.isolation.path_missing_parent.v1",
  PATH_NOT_DIRECTORY: "agent_launch.isolation.path_not_directory.v1",
  PATH_NOT_FILE: "agent_launch.isolation.path_not_file.v1",
  WRITABLE_FILE_NAMESPACE_READ_ONLY: "agent_launch.isolation.writable_file_namespace_read_only.v1",
  REPO_INVALID: "agent_launch.isolation.repo_invalid.v1",
  COMMAND_INVALID: "agent_launch.isolation.command_invalid.v1",
  COMMAND_UNRESOLVABLE: "agent_launch.isolation.command_unresolvable.v1",

  COMMAND_RESOLUTION_UNTRUSTED: "agent_launch.isolation.command_resolution_untrusted.v1",
  EXECUTABLE_PATH_DENIED: "agent_launch.isolation.executable_path_denied.v1",
  EXECUTABLE_PATH_OUTSIDE_RUNTIME_PREFIXES: "agent_launch.isolation.executable_path_outside_runtime_prefixes.v1",
  ARGS_INVALID: "agent_launch.isolation.args_invalid.v1",
  CWD_INVALID: "agent_launch.isolation.cwd_invalid.v1",
  ENV_INVALID: "agent_launch.isolation.env_invalid.v1",
  ENV_POLICY_INVALID: "agent_launch.isolation.env_policy_invalid.v1",
  HOME_POLICY_INVALID: "agent_launch.isolation.home_policy_invalid.v1",
  BIND_ENTRY_INVALID: "agent_launch.isolation.bind_entry_invalid.v1",

  FAMILY_RUNTIME_ROOT_DENIED: "agent_launch.isolation.family_runtime_root_denied.v1",
  FAMILY_RUNTIME_ROOT_OUTSIDE_PREFIXES: "agent_launch.isolation.family_runtime_root_outside_prefixes.v1",

  REQUIRED_RUNTIME_ROOT_INACCESSIBLE: "agent_launch.isolation.required_runtime_root_inaccessible.v1",

  WRITABLE_RUNTIME_ROOT_NOT_VISIBLE_IN_NAMESPACE: "agent_launch.isolation.writable_runtime_root_not_visible_in_namespace.v1",
  READ_ONLY_MOUNT: MCP_SANDBOX_RUNTIME_BLOCKER_CODES.READ_ONLY_MOUNT,
  SANDBOX_WRITE_DENIAL: MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL,
  PLAN_INVALID: "agent_launch.isolation.plan_invalid.v1"
});

export class BubblewrapIsolationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(message);
    this.name = "BubblewrapIsolationError";
    this.code = code ?? "agent_launch.isolation.error.v1";
    if (detail !== null) {
      this.detail = detail;
    }
    if (cause !== null) {
      this.cause = cause;
    }
  }
}

export function fail(code, message, detail = null) {
  throw new BubblewrapIsolationError(`agent-launch isolation: ${message}`, { code, detail });
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function assertAbsoluteSafePath(p, label) {
  if (!isNonEmptyString(p)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_ABSOLUTE,
      `${label} must be a non-empty string, got: ${typeof p}`
    );
  }
  if (!path.isAbsolute(p)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_ABSOLUTE,
      `${label} must be an absolute path: ${p}`
    );
  }
  if (GLOB_CHARACTERS.test(p)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_HAS_GLOB,
      `${label} must not contain glob characters: ${p}`
    );
  }
  for (const seg of p.split(path.sep)) {
    if (seg === "..") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_HAS_TRAVERSAL,
        `${label} must not contain ".." segments: ${p}`
      );
    }
  }
  const normalized = path.normalize(p);
  if (normalized !== p && normalized + path.sep !== p) {

    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_ABSOLUTE,
      `${label} must be in canonical form (got ${p}, normalized ${normalized})`
    );
  }

  if (normalized.length > 1 && normalized.endsWith(path.sep)) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

export function isWithinRepo(absolute, repoAbsolute) {
  if (absolute === repoAbsolute) return true;
  const prefix = repoAbsolute === path.sep ? path.sep : repoAbsolute + path.sep;
  return absolute.startsWith(prefix);
}
