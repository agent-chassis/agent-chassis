

import path from "node:path";

import {
  LAUNCHER_PAID_NODE_ENGINE_POSTURE_REASON_CODES,
  LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY,
  resolveLauncherPaidNodeEngineEnforcementPosture
} from "@agent-chassis/agent-launch-core/src/lib/config.mjs";

import { DEFAULT_SYSTEM_READ_ONLY_ROOTS } from "./launch-isolation.mjs";
import { resolveLauncherOwnedHostHome } from "./launcher-runtime-home-policy.mjs";

import {
  LAUNCHER_ISOLATION_SUPPORTED_ROLES,
  LAUNCHER_ISOLATION_WRITER_ROLES,
  LAUNCHER_ISOLATION_READER_ROLES,
  isLauncherIsolationRole,
  deriveWorkerWritableRoots,
  deriveWorkerWritableFiles,
  deriveOrchestratorWritableRoots,
  deriveOrchestratorRuntimeRoots,
  deriveWorkerRuntimeRoots,
  deriveReviewWritableRoots,
  deriveReviewWritableFiles,
  deriveReviewRuntimeRoots,
  deriveRoleHomePolicyReads,
  assertSourceHomeIsNotWritable
} from "./workspace-agent-launch-adapter-contract.mjs";

export const CODEX_ROLE_ISOLATION_SCHEMA_VERSION = "codex-role-isolation.v1";
export const CODEX_ROLE_ISOLATION_FAIL_CLOSED_MODE = "bubblewrap";
export const CODEX_ROLE_PAID_KEY_POSTURE_SOURCE =
  "launcher_paid_node_engine_enforcement_posture";

export {
  LAUNCHER_PAID_NODE_ENGINE_POSTURE_REASON_CODES as CODEX_ROLE_PAID_NODE_ENGINE_POSTURE_REASON_CODES
};

export {
  LAUNCHER_ISOLATION_SUPPORTED_ROLES as CODEX_ROLE_ISOLATION_SUPPORTED_ROLES,
  LAUNCHER_ISOLATION_WRITER_ROLES as CODEX_ROLE_ISOLATION_WRITER_ROLES,
  LAUNCHER_ISOLATION_READER_ROLES as CODEX_ROLE_ISOLATION_READER_ROLES,
  isLauncherIsolationRole as isCodexRoleIsolationRole,
  deriveWorkerWritableRoots,
  deriveWorkerWritableFiles,
  deriveOrchestratorWritableRoots,
  deriveOrchestratorRuntimeRoots,
  deriveWorkerRuntimeRoots,
  deriveReviewWritableRoots,
  deriveReviewWritableFiles,
  deriveReviewRuntimeRoots,
  deriveRoleHomePolicyReads as deriveCodexRoleHomePolicyReads,
  assertSourceHomeIsNotWritable
};

export const CODEX_ROLE_FORWARDED_ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
  "TZ",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
  "REQUESTS_CA_BUNDLE",
  "CODEX_HOME",
  "CODEX_SOURCE_HOME",
  "CODEX_WORKER_MODEL",
  "CODEX_ORCH_REPO",
  "CODEX_ORCH_THREAD_NAME",
  "CODEX_ORCH_RUNTIME_DIR",
  "AGENT_ROLE",
  "AGENT_IN",
  "AGENT_WK",
  "AGENT_SUBJECT"
]);

export const CODEX_BWRAP_ENV_POLICY = Object.freeze({
  allow: CODEX_ROLE_FORWARDED_ENV_ALLOWLIST
});

export const CODEX_ROLE_LAUNCHER_INTERNAL_ENV_DENYLIST = Object.freeze([
  "CODEX_WORKER_PROFILE",
  "CODEX_REVIEWER_PROFILE",
  "CODEX_REDTEAM_PROFILE",
  "AGENT_LAUNCH_ISOLATION_EXTRA_RUNTIME_ROOTS",
  LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY,
  "AGENT_LAUNCH_CODEX_BIN_DIR",
  "AGENT_LAUNCH_BWRAP",
  "AGENT_LAUNCH_TIMESTAMP",
  "AGENT_LAUNCH_ROLE_GUARD_CONTEXT_PATH",
  "AGENT_LAUNCH_ROLE_GUARD_RUN_ID"
]);

const LAUNCHER_INTERNAL_ENV_PREFIXES = Object.freeze([
  "AGENT_LAUNCH_ISOLATION_",
  "AGENT_LAUNCH_ROLE_GUARD_"
]);

export function isLauncherInternalIsolationEnvKey(key) {
  if (typeof key !== "string" || key.length === 0) return false;
  if (CODEX_ROLE_LAUNCHER_INTERNAL_ENV_DENYLIST.includes(key)) return true;
  for (const prefix of LAUNCHER_INTERNAL_ENV_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

export function resolveCodexRolePaidKeyEnforcementPosture({
  workspaceDir,
  readWorkspaceEnvValue,
  resolveUnsandboxedOptIn
} = {}) {
  const posture = resolveLauncherPaidNodeEngineEnforcementPosture({
    workspaceDir,
    readWorkspaceEnvValue,
    resolveUnsandboxedOptIn
  });
  return {
    schema_version: CODEX_ROLE_ISOLATION_SCHEMA_VERSION,
    posture_source: CODEX_ROLE_PAID_KEY_POSTURE_SOURCE,
    ...posture
  };
}

export function resolveCodexSourceHome(env, { readHostHome } = {}) {
  if (env && typeof env === "object"
    && typeof env.CODEX_SOURCE_HOME === "string"
    && env.CODEX_SOURCE_HOME.length > 0) {
    const explicit = resolveLauncherOwnedHostHome({
      readHostHome: () => env.CODEX_SOURCE_HOME,
      source: "codex_source_home"
    });
    if (!explicit.ok) return explicit;
    return { ok: true, sourceHome: explicit.launcherOwnedHostHome };
  }
  const hostHome = resolveLauncherOwnedHostHome({
    readHostHome,
    source: "codex_source_home"
  });
  if (!hostHome.ok) return hostHome;
  return { ok: true, sourceHome: path.join(hostHome.launcherOwnedHostHome, ".codex") };
}

export function selectForwardedChildEnv(env, {
  allowlist = CODEX_ROLE_FORWARDED_ENV_ALLOWLIST,
  denylist = CODEX_ROLE_LAUNCHER_INTERNAL_ENV_DENYLIST
} = {}) {
  const out = {};
  if (!env || typeof env !== "object") return out;
  const denied = new Set(Array.isArray(denylist) ? denylist : []);
  const allowed = new Set(Array.isArray(allowlist) ? allowlist : []);
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (denied.has(key)) continue;
    if (isLauncherInternalIsolationEnvKey(key)) continue;
    if (!allowed.has(key)) continue;
    out[key] = value;
  }
  return out;
}

export function stripNestedCodexSandboxArgs(args) {
  if (!Array.isArray(args)) return args;
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if ((a === "-s" || a === "--sandbox") && i + 1 < args.length) {
      i += 1;
      continue;
    }
    if (a === "--add-dir" && i + 1 < args.length) {
      i += 1;
      continue;
    }
    out.push(a);
  }
  out.unshift("-s", "danger-full-access");
  return out;
}

export function nestedCodexSandboxArgPairLengthAt(args, index) {
  if (!Array.isArray(args)) return 0;
  if (typeof index !== "number" || !Number.isInteger(index)) return 0;
  if (index < 0 || index + 1 >= args.length) return 0;
  const a = args[index];
  if (a === "-s" || a === "--sandbox" || a === "--add-dir") return 2;
  return 0;
}

export const CODEX_ROLE_DEFAULT_SYSTEM_READ_ONLY_ROOTS = DEFAULT_SYSTEM_READ_ONLY_ROOTS;
