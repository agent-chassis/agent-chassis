

import path from "node:path";
import {
  accessSync,
  constants as fsConstants,
  statSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { resolveLauncherCanonicalBwrapPath } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  assertAbsoluteSafePath,
  fail,
  isNonEmptyString,
  isWithinRepo
} from "./launch-isolation-errors.mjs";
import {
  assertExistingDirectoryOrSafeParent,
  realpathExistingOrSafeParent
} from "./launch-isolation-paths.mjs";

export function collectRealpathDedupedRoots(entries, label, { requireInsideRepo, repoReal }) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < entries.length; i += 1) {
    const lexical = assertAbsoluteSafePath(entries[i], `${label}[${i}]`);

    const real = realpathExistingOrSafeParent(lexical, `${label}[${i}]`);
    if (requireInsideRepo && !isWithinRepo(real, repoReal)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_OUTSIDE_REPO,
        `${label}[${i}] must resolve to repo or a repo descendant: lexical ${lexical} -> real ${real} (repo real ${repoReal})`
      );
    }
    assertExistingDirectoryOrSafeParent(real, `${label}[${i}]`);
    if (!seen.has(real)) {
      seen.add(real);
      out.push(real);
    }
  }
  return out;
}

export function collectDedupedSrcBinds(entries, label, validate = null) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < entries.length; i += 1) {
    const src = assertAbsoluteSafePath(entries[i], `${label}[${i}]`);
    if (validate !== null) validate(src, `${label}[${i}]`);
    if (seen.has(src)) continue;
    seen.add(src);
    out.push({ src, dst: src });
  }
  return out;
}

export function buildSystemBaselineArgs({ systemReadOnlyRoots, shareNet, newSession = true, tmpfsDirs = [] }) {
  const args = [
    "--unshare-user-try",
    "--unshare-ipc",
    "--unshare-pid",
    "--unshare-uts",
    "--unshare-cgroup-try",
    "--die-with-parent"
  ];

  if (newSession) {
    args.push("--new-session");
  }
  args.push(
    "--clearenv",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp"
  );

  if (!Array.isArray(tmpfsDirs)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "tmpfsDirs must be an array"
    );
  }
  for (let i = 0; i < tmpfsDirs.length; i += 1) {
    const dir = assertAbsoluteSafePath(tmpfsDirs[i], `tmpfsDirs[${i}]`);
    args.push("--tmpfs", dir);
  }
  if (!shareNet) {
    args.push("--unshare-net");
  }
  for (const root of systemReadOnlyRoots) {
    args.push("--ro-bind-try", root, root);
  }
  return args;
}

function resolveBwrapFromEnv(env) {
  const view = env && typeof env === "object" ? env : {};
  if (isNonEmptyString(view.BWRAP_BINARY)) {
    return view.BWRAP_BINARY;
  }
  const pathEnv = isNonEmptyString(view.PATH) ? view.PATH : "/usr/bin:/bin";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "bwrap");
    let st;
    try {
      st = statSync(candidate);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeCanonicalBwrapResolution(resolution) {
  if (!resolution || typeof resolution !== "object" || resolution.ok !== true) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_PROBE_FAILED,
      "launcher-canonical bwrap resolution unavailable"
    );
  }
  const bwrapPath = isNonEmptyString(resolution.bwrapPath)
    ? resolution.bwrapPath
    : (isNonEmptyString(resolution.binary) ? resolution.binary : null);
  const pathEnv = isNonEmptyString(resolution.path) ? resolution.path : null;
  if (!bwrapPath && !pathEnv) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_PROBE_FAILED,
      "launcher-canonical bwrap resolution did not provide a binary or PATH"
    );
  }
  return { bwrapPath, pathEnv };
}

function resolveBwrapFromCanonicalPath(pathEnv) {
  if (!isNonEmptyString(pathEnv)) return null;
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "bwrap");
    try {
      statSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export function probeLauncherCanonicalBwrapAvailability({
  resolveCanonicalBwrapPath = resolveLauncherCanonicalBwrapPath
} = {}) {
  const resolver = typeof resolveCanonicalBwrapPath === "function"
    ? resolveCanonicalBwrapPath
    : resolveLauncherCanonicalBwrapPath;
  try {
    const { bwrapPath, pathEnv } = normalizeCanonicalBwrapResolution(resolver());
    const candidate = isNonEmptyString(bwrapPath)
      ? bwrapPath
      : resolveBwrapFromCanonicalPath(pathEnv);
    const canonicalEnv = { PATH: pathEnv };
    const resolved = assertBubblewrapAvailable({
      env: canonicalEnv,
      bwrapPath: candidate
    });
    return { available: true, bwrapPath: resolved, diagnostic: null };
  } catch (error) {
    if (error instanceof BubblewrapIsolationError) {
      return {
        available: false,
        bwrapPath: null,
        diagnostic: {
          code: error.code,
          message: error.message,
          detail: error.detail ?? null
        }
      };
    }
    throw error;
  }
}

export function assertBubblewrapAvailable({ env = process.env, bwrapPath = null } = {}) {
  const view = env && typeof env === "object" ? env : process.env;
  const candidate = isNonEmptyString(bwrapPath)
    ? bwrapPath
    : resolveBwrapFromEnv(view);
  if (!candidate) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE,
      "bwrap backend binary not found in launcher-supplied search path"
    );
  }
  if (!path.isAbsolute(candidate)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE,
      `bwrap path must be absolute: ${candidate}`
    );
  }
  let st;
  try {
    st = statSync(candidate);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE,
      `bwrap path stat failed: ${candidate}`,
      { errno: err?.code ?? null }
    );
  }
  if (!st.isFile()) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_NOT_EXECUTABLE,
      `bwrap path is not a regular file: ${candidate}`
    );
  }
  try {
    accessSync(candidate, fsConstants.X_OK);
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_NOT_EXECUTABLE,
      `bwrap is not executable: ${candidate}`,
      { errno: err?.code ?? null }
    );
  }
  let probe;
  try {
    probe = spawnSync(candidate, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: isNonEmptyString(view.PATH) ? view.PATH : "/usr/bin:/bin" }
    });
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED,
      `bwrap version probe failed to spawn: ${candidate}`,
      { errno: err?.code ?? null, message: err?.message ?? null }
    );
  }
  if (probe.error) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED,
      `bwrap version probe error: ${candidate}`,
      { errno: probe.error.code ?? null, message: probe.error.message ?? null }
    );
  }
  if (probe.status !== 0) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_PROBE_FAILED,
      `bwrap version probe exited with status=${probe.status} signal=${probe.signal ?? null}`,
      {
        status: probe.status,
        signal: probe.signal ?? null,
        stderr: probe.stderr ? probe.stderr.toString("utf8").slice(0, 512) : null
      }
    );
  }
  return candidate;
}
