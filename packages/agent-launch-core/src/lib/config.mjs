import os from "node:os";
import path from "node:path";
import { statSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { readNonSecretWorkspaceEnvValue } from "@agent-chassis/wiki-core/src/lib/node-engine-env-bootstrap.mjs";
import {
  API_KEY_ENV_KEYS,
  CLIENT_REASON_CODES
} from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";

export const LAUNCHER_CONFIG_DIRNAME = ".agent-launch";
const WORKSPACE_MARKER_DIRS = ["wiki", "docs"];

function isWorkspaceRoot(dir) {
  for (const marker of WORKSPACE_MARKER_DIRS) {
    let info;
    try {
      info = statSync(path.join(dir, marker));
    } catch {
      return false;
    }
    if (!info.isDirectory()) {
      return false;
    }
  }
  return true;
}

export function resolveLauncherWorkspaceRoot(startDir = process.cwd()) {
  const resolvedStart = path.resolve(String(startDir || process.cwd()));
  let current = resolvedStart;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (isWorkspaceRoot(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return resolvedStart;
    }
    current = parent;
  }
}

function resolveWorkspaceDir(workspaceDir) {
  if (
    workspaceDir !== undefined
    && workspaceDir !== null
    && String(workspaceDir).length > 0
  ) {
    return path.resolve(String(workspaceDir));
  }
  return resolveLauncherWorkspaceRoot();
}

export function getLauncherConfigDir(workspaceDir) {
  return path.join(resolveWorkspaceDir(workspaceDir), LAUNCHER_CONFIG_DIRNAME);
}

export const LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY =
  "AGENT_LAUNCH_UNSANDBOXED";
export const LAUNCHER_CANONICAL_BWRAP_PATH = "/usr/bin:/bin";
export const LAUNCHER_PAID_NODE_ENGINE_KEY_ENV_KEYS = Object.freeze([
  ...API_KEY_ENV_KEYS
]);
export const LAUNCHER_PAID_NODE_ENGINE_POSTURE_REASON_CODES = Object.freeze({
  PAID_KEY_ABSENT: CLIENT_REASON_CODES.API_KEY_UNCONFIGURED,
  PAID_KEY_PRESENT:
    "agent_launch.launcher_paid_node_engine_key_present.v1",
  PAID_KEY_OPERATOR_OPT_OUT:
    "agent_launch.launcher_paid_node_engine_key_operator_opt_out.v1",
  OPT_OUT_INVALID: "launcher_unsandboxed_opt_in_invalid"
});

function parseBooleanWorkspaceEnvValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

export function resolveLauncherUnsandboxedOptIn({
  workspaceDir,
  readWorkspaceEnvValue = readNonSecretWorkspaceEnvValue
} = {}) {
  const envKey = LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY;
  const envDir = resolveWorkspaceDir(workspaceDir);
  const rawValue = readWorkspaceEnvValue({ dir: envDir, key: envKey });
  const parsed = parseBooleanWorkspaceEnvValue(rawValue);
  if (parsed === undefined) {
    return {
      ok: false,
      code: "launcher_unsandboxed_opt_in_invalid",
      reason: `${envKey} must be one of 1, 0, true, false, yes, no, on, or off when set in <workspace>/.env`,
      env_key: envKey,
      source: "workspace_env_invalid"
    };
  }
  if (parsed === null) {
    return {
      ok: true,
      enabled: false,
      env_key: envKey,
      source: "workspace_env_absent"
    };
  }
  return {
    ok: true,
    enabled: parsed,
    env_key: envKey,
    source: "workspace_env"
  };
}

function resolveLauncherPaidNodeEngineKeyPresence({
  workspaceDir,
  readWorkspaceEnvValue = readNonSecretWorkspaceEnvValue
} = {}) {
  const envDir = resolveWorkspaceDir(workspaceDir);
  for (const envKey of LAUNCHER_PAID_NODE_ENGINE_KEY_ENV_KEYS) {
    const rawValue = readWorkspaceEnvValue({ dir: envDir, key: envKey });
    if (typeof rawValue === "string" && rawValue.trim().length > 0) {
      return {
        present: true,
        source: envKey,
        preferred: envKey === LAUNCHER_PAID_NODE_ENGINE_KEY_ENV_KEYS[0]
      };
    }
  }
  return {
    present: false,
    source: null,
    preferred: null
  };
}

export function resolveLauncherPaidNodeEngineEnforcementPosture({
  workspaceDir,
  readWorkspaceEnvValue = readNonSecretWorkspaceEnvValue,
  resolveUnsandboxedOptIn = resolveLauncherUnsandboxedOptIn
} = {}) {
  const paidKey = resolveLauncherPaidNodeEngineKeyPresence({
    workspaceDir,
    readWorkspaceEnvValue
  });
  const optOut = resolveUnsandboxedOptIn({
    workspaceDir,
    readWorkspaceEnvValue
  });

  if (!optOut?.ok) {
    return {
      ok: false,
      code:
        optOut?.code
        ?? LAUNCHER_PAID_NODE_ENGINE_POSTURE_REASON_CODES.OPT_OUT_INVALID,
      reason:
        optOut?.reason
        ?? `${LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY} is invalid in <workspace>/.env`,
      paid_node_engine_key_present: paidKey.present,
      paid_node_engine_key_source: paidKey.source,
      paid_node_engine_key_preferred: paidKey.preferred,
      opt_out: {
        enabled: false,
        env_key: optOut?.env_key ?? LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY,
        source: optOut?.source ?? "workspace_env_invalid"
      },
      enforcement_required: true
    };
  }

  const optOutFacts = {
    enabled: optOut.enabled === true,
    env_key: optOut.env_key ?? LAUNCHER_UNSANDBOXED_OPT_IN_ENV_KEY,
    source: optOut.source ?? null
  };

  if (!paidKey.present) {
    return {
      ok: true,
      enforcement_required: false,
      reason_code:
        LAUNCHER_PAID_NODE_ENGINE_POSTURE_REASON_CODES.PAID_KEY_ABSENT,
      reason: "canonical paid Node Engine API key credential is absent",
      paid_node_engine_key_present: false,
      paid_node_engine_key_source: null,
      paid_node_engine_key_preferred: null,
      opt_out: optOutFacts
    };
  }

  if (optOutFacts.enabled) {
    return {
      ok: true,
      enforcement_required: false,
      reason_code:
        LAUNCHER_PAID_NODE_ENGINE_POSTURE_REASON_CODES.PAID_KEY_OPERATOR_OPT_OUT,
      reason:
        "canonical paid Node Engine API key credential is present and the operator explicitly opted out of local enforcement",
      paid_node_engine_key_present: true,
      paid_node_engine_key_source: paidKey.source,
      paid_node_engine_key_preferred: paidKey.preferred,
      opt_out: optOutFacts
    };
  }

  return {
    ok: true,
    enforcement_required: true,
    reason_code:
      LAUNCHER_PAID_NODE_ENGINE_POSTURE_REASON_CODES.PAID_KEY_PRESENT,
    reason: "canonical paid Node Engine API key credential is present",
    paid_node_engine_key_present: true,
    paid_node_engine_key_source: paidKey.source,
    paid_node_engine_key_preferred: paidKey.preferred,
    opt_out: optOutFacts
  };
}

export function resolveLauncherSchemaConstrainedTierIsPaid({
  workspaceDir,
  readWorkspaceEnvValue = readNonSecretWorkspaceEnvValue,
  resolvePosture = resolveLauncherPaidNodeEngineEnforcementPosture
} = {}) {
  let posture;
  try {
    posture = resolvePosture({ workspaceDir, readWorkspaceEnvValue });
  } catch {
    return false;
  }
  return posture?.ok === true && posture.paid_node_engine_key_present === true;
}

export function resolveLauncherCanonicalBwrapPath() {
  return {
    ok: true,
    path: LAUNCHER_CANONICAL_BWRAP_PATH,
    source: "launcher_canonical"
  };
}

export const LAUNCHER_RUNTIME_STATE_DIR_ENV = "AGENT_LAUNCH_RUNTIME_STATE_DIR";
export const LAUNCHER_RUNTIME_STATE_DIRNAME = "agent-launch-runtime";
export const LAUNCHER_RUNTIME_STATE_UNAVAILABLE_CODE =
  "launcher_runtime_state_unavailable";

function workspaceScopeSegment(workspaceDir) {
  const basis = resolveWorkspaceDir(workspaceDir);
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export function resolveLauncherRuntimeStateDir({ workspaceDir, env = process.env } = {}) {
  const provided = env?.[LAUNCHER_RUNTIME_STATE_DIR_ENV];
  let root;
  let source;
  if (typeof provided === "string" && provided.trim().length > 0) {
    const trimmed = provided.trim();
    if (!path.isAbsolute(trimmed)) {
      return {
        ok: false,
        code: LAUNCHER_RUNTIME_STATE_UNAVAILABLE_CODE,
        reason: `${LAUNCHER_RUNTIME_STATE_DIR_ENV} must be an absolute path; received a relative value`
      };
    }
    root = trimmed;
    source = "env";
  } else {
    root = path.join(os.tmpdir(), LAUNCHER_RUNTIME_STATE_DIRNAME);
    source = "tmpdir_default";
  }
  return {
    ok: true,
    dir: path.join(root, workspaceScopeSegment(workspaceDir)),
    source
  };
}

export async function ensureLauncherRuntimeStateDir({ workspaceDir, env = process.env } = {}) {
  const resolved = resolveLauncherRuntimeStateDir({ workspaceDir, env });
  if (!resolved.ok) {
    return resolved;
  }
  try {
    await mkdir(resolved.dir, { recursive: true });
    const probe = path.join(resolved.dir, `.write-probe-${randomBytes(6).toString("hex")}`);
    await writeFile(probe, "", { mode: 0o600 });
    await rm(probe, { force: true });
  } catch (error) {
    return {
      ok: false,
      code: LAUNCHER_RUNTIME_STATE_UNAVAILABLE_CODE,
      reason: `launcher runtime state directory is not writable (${error?.code ?? error?.message ?? error}): ${resolved.dir}`,
      dir: resolved.dir
    };
  }
  return { ok: true, dir: resolved.dir, source: resolved.source };
}

export function getLauncherRuntimeNonceDir({ workspaceDir, env = process.env } = {}) {
  const resolved = resolveLauncherRuntimeStateDir({ workspaceDir, env });
  if (!resolved.ok) {
    throw new Error(resolved.reason);
  }
  return path.join(resolved.dir, "role-guard-nonces");
}

export function getLauncherRegistryPath(workspaceDir) {
  return path.join(getLauncherConfigDir(workspaceDir), "launchers.v1.json");
}

export function resolveLauncherRegistryPath(overridePath, { workspaceDir } = {}) {
  if (overridePath === undefined || overridePath === null) {
    return getLauncherRegistryPath(workspaceDir);
  }
  if (typeof overridePath !== "string" || overridePath.length === 0) {
    throw new Error("Launcher registry override path must be a non-empty string");
  }
  return path.isAbsolute(overridePath)
    ? overridePath
    : path.resolve(process.cwd(), overridePath);
}

export const WORKER_FAMILY_OPERATOR_CONFIG_REFUSAL_REASON =
  "operator-config override is not authorized for worker-family agent-role launches; the verified launcher/MCP context handle that would authorize an override is not implemented in this build";

export const WORKER_FAMILY_OPERATOR_CONFIG_RELATIVE_REFUSAL_REASON =
  "operator-config override for worker-family launches must be an absolute path; relative paths are never resolved against worker-controlled cwd";

export function getWorkerFamilyTrustedLauncherConfigDir(workspaceDir) {
  return getLauncherConfigDir(workspaceDir);
}

export function getWorkerFamilyTrustedLauncherRegistryPath(workspaceDir) {
  return path.join(
    getWorkerFamilyTrustedLauncherConfigDir(workspaceDir),
    "launchers.v1.json"
  );
}

export function resolveWorkerFamilyLauncherRegistryPath(
  overridePath,
  { workspaceDir } = {}
) {
  if (overridePath === undefined || overridePath === null) {
    return {
      ok: true,
      path: getWorkerFamilyTrustedLauncherRegistryPath(workspaceDir)
    };
  }
  if (typeof overridePath !== "string" || overridePath.length === 0) {
    return {
      ok: false,
      reason: "operator-config path must be a non-empty string",
      kind: "invalid"
    };
  }
  if (!path.isAbsolute(overridePath)) {
    return {
      ok: false,
      reason: WORKER_FAMILY_OPERATOR_CONFIG_RELATIVE_REFUSAL_REASON,
      kind: "relative"
    };
  }
  return {
    ok: false,
    reason: WORKER_FAMILY_OPERATOR_CONFIG_REFUSAL_REASON,
    kind: "override_unauthorized"
  };
}

export function getTokenKeyPath(workspaceDir) {
  return path.join(getLauncherConfigDir(workspaceDir), "token.key");
}

export const TOKEN_STATE_DIRNAMES = ["pending", "launching", "consumed", "rejected"];

export function getTokenStateDir(state, workspaceDir, env = process.env) {
  const resolved = resolveLauncherRuntimeStateDir({ workspaceDir, env });
  if (!resolved.ok) {
    throw new Error(resolved.reason);
  }
  return path.join(resolved.dir, "token-state", state);
}

export async function ensureLauncherConfigDir(workspaceDir) {
  const dir = getLauncherConfigDir(workspaceDir);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function ensureTokenStateDirs(workspaceDir, env = process.env) {
  const ensured = await ensureLauncherRuntimeStateDir({ workspaceDir, env });
  if (!ensured.ok) {
    return ensured;
  }
  for (const state of TOKEN_STATE_DIRNAMES) {
    await mkdir(path.join(ensured.dir, "token-state", state), { recursive: true });
  }
  return ensured;
}

export async function ensureTokenKey(workspaceDir) {
  const keyPath = getTokenKeyPath(workspaceDir);
  try {
    await stat(keyPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    await ensureLauncherConfigDir(workspaceDir);
    await writeFile(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return readFile(keyPath, "utf8");
}
