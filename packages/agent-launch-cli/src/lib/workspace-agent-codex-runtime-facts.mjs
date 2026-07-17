

import path from "node:path";
import { accessSync, constants as fsConstants, statSync } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  symlink,
  unlink
} from "node:fs/promises";

import { pathExists } from "./codex-role-io.mjs";
import { runtimeDirFor } from "./codex-role-orchestrator-history.mjs";
import {
  resolveLauncherOwnedHostHome
} from "./launcher-runtime-home-policy.mjs";
import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";

export function resolveCodexSourceHome(env, {
  readHostHome,
  workerScopeAuthority = null,
  role = null,
  subject = null
} = {}) {
  const frozenWorkerScopeAuthority = assertFrozenWorkerScopeAuthority(workerScopeAuthority, {
    role: role ?? "worker",
    subject,
    required: workerScopeAuthority !== null
  });
  if (env && typeof env.CODEX_SOURCE_HOME === "string" && env.CODEX_SOURCE_HOME.length > 0) {
    const explicit = resolveLauncherOwnedHostHome({
      readHostHome: () => env.CODEX_SOURCE_HOME,
      source: "codex_source_home"
    });
    if (!explicit.ok) return explicit;
    return { ok: true, sourceHome: explicit.launcherOwnedHostHome, workerScopeAuthority: frozenWorkerScopeAuthority };
  }
  const hostHome = resolveLauncherOwnedHostHome({
    readHostHome,
    source: "codex_source_home"
  });
  if (!hostHome.ok) return hostHome;
  return { ok: true, sourceHome: path.join(hostHome.launcherOwnedHostHome, ".codex"), workerScopeAuthority: frozenWorkerScopeAuthority };
}

function resolveCodexBinaryDir(env) {
  if (env && typeof env.AGENT_LAUNCH_CODEX_BIN_DIR === "string" && env.AGENT_LAUNCH_CODEX_BIN_DIR.length > 0) {
    const explicit = env.AGENT_LAUNCH_CODEX_BIN_DIR;
    if (path.isAbsolute(explicit)) {
      return explicit;
    }
  }
  const pathEnv = env && typeof env.PATH === "string" ? env.PATH : "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, "codex");
    try {
      const st = statSync(candidate);
      if (!st.isFile()) continue;
      accessSync(candidate, fsConstants.X_OK);
      return dir;
    } catch {
      continue;
    }
  }
  return null;
}

const CODEX_ROLE_SYSTEM_ROOT_PREFIXES = Object.freeze([
  "/usr",
  "/opt",
  "/lib",
  "/lib64",
  "/bin",
  "/sbin"
]);

function isUnderSystemReadOnlyRoot(p) {
  for (const root of CODEX_ROLE_SYSTEM_ROOT_PREFIXES) {
    if (p === root) return true;
    if (p.startsWith(root + path.sep)) return true;
  }
  return false;
}

export function classifyCodexBinaryDir(env) {
  const binDir = resolveCodexBinaryDir(env);
  if (!binDir) return { binDir: null, underSystemRoot: false };
  try {
    const st = statSync(binDir);
    if (!st.isDirectory()) return { binDir: null, underSystemRoot: false };
  } catch {
    return { binDir: null, underSystemRoot: false };
  }
  return { binDir, underSystemRoot: isUnderSystemReadOnlyRoot(binDir) };
}

const AGENT_LAUNCH_ISOLATION_EXTRA_RUNTIME_ROOTS_ENV = "AGENT_LAUNCH_ISOLATION_EXTRA_RUNTIME_ROOTS";

export function collectExtraRuntimeRootsFromEnv(env) {
  const raw = env && typeof env[AGENT_LAUNCH_ISOLATION_EXTRA_RUNTIME_ROOTS_ENV] === "string"
    ? env[AGENT_LAUNCH_ISOLATION_EXTRA_RUNTIME_ROOTS_ENV]
    : "";
  if (!raw) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw.split(path.delimiter)) {
    if (!entry || !path.isAbsolute(entry) || seen.has(entry)) continue;
    try {
      const st = statSync(entry);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

export function sanitizeCodexChildEnv(env) {
  const sanitized = { ...env };
  for (const key of ["TMPDIR", "TMP", "TEMP", "NODE_COMPILE_CACHE", "NODE_OPTIONS"]) {
    delete sanitized[key];
  }
  return sanitized;
}

export async function setupCodexRuntimeHome({ env = {}, repo, subject, role, readHostHome } = {}) {
  const sourceHomeResult = resolveCodexSourceHome(env, { readHostHome });
  if (!sourceHomeResult.ok) return sourceHomeResult;
  const sourceHome = sourceHomeResult.sourceHome;
  const runtimeBase = env.CODEX_ORCH_RUNTIME_DIR || runtimeDirFor({ env, repo, subject });

  const runtimeHome = path.join(runtimeBase, "codex-home");

  try {
    await mkdir(runtimeHome, { recursive: true });
  } catch (error) {
    const reason = error?.code ? ` (${error.code})` : "";
    throw new Error(
      `codex-${role}: launcher runtime directory is not writable: ${runtimeBase}${reason}`
    );
  }
  await selfHealStaleRuntimeConfig(path.join(runtimeHome, "config.toml"));
  for (const name of [
    "auth.json",
    "version.json",
    "models_cache.json",
    "skills",
    "memories"
  ]) {
    const source = path.join(sourceHome, name);
    const target = path.join(runtimeHome, name);
    if (await pathExists(source) && !(await pathExists(target))) {
      try {
        await symlink(source, target);
      } catch {

      }
    }
  }
  try {
    await mkdir(path.join(runtimeHome, "log"), { recursive: true });

    await selfHealStaleSessionsSymlink(path.join(runtimeHome, "sessions"));
    await mkdir(path.join(runtimeHome, "sessions"), { recursive: true });
    await mkdir(path.join(runtimeHome, "tmp"), { recursive: true });
    await mkdir(path.join(runtimeHome, "shell_snapshots"), { recursive: true });
    await mkdir(path.join(runtimeHome, "rules"), { recursive: true });
    await access(path.join(runtimeHome, "tmp"), fsConstants.W_OK);
  } catch (error) {
    const reason = error?.code ? ` (${error.code})` : "";
    throw new Error(`codex-${role}: launcher runtime directory is not writable: ${runtimeHome}${reason}`);
  }
  return {
    ...env,
    CODEX_HOME: runtimeHome
  };
}

async function selfHealStaleSessionsSymlink(sessionsPath) {
  let entry;
  try {
    entry = await lstat(sessionsPath);
  } catch {
    return;
  }
  if (!entry.isSymbolicLink()) {
    return;
  }
  try {
    await unlink(sessionsPath);
  } catch {

  }
}

async function selfHealStaleRuntimeConfig(configPath) {
  let entry;
  try {
    entry = await lstat(configPath);
  } catch {
    return;
  }
  if (!entry.isSymbolicLink() && !entry.isFile()) {
    return;
  }
  try {
    await unlink(configPath);
  } catch {

  }
}

export async function ensureWritableDirectory(dir, role, description) {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, fsConstants.W_OK);
  } catch (error) {
    const reason = error?.code ? ` (${error.code})` : "";
    throw new Error(`codex-${role}: ${description} is not writable: ${dir}${reason}`);
  }
}
