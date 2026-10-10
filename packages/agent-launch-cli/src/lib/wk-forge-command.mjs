

import { spawnSync } from "node:child_process";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import { resolveRemoteUrl } from "./wk-handoff-destination.mjs";
import { isPlainObject } from "./wk-forge-handoff-refusal.mjs";

const FORGE_HOST_RE = /^[a-z0-9.-]+$/u;

const FORGE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/u;

export function defaultRunGit({ repo, args, env = null }) {
  const argv = ["git", "-C", repo, "-c", "core.quotePath=false", ...args];
  let res;
  try {
    res = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8",
      env: env === null ? process.env : env,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err), native: { argv, error: err } };
  }
  if (res.error) {
    return { ok: false, error: res.error.message ?? String(res.error), native: { argv, result: res } };
  }
  if (res.status !== 0) {
    return {
      ok: false,
      status: res.status ?? null,
      stdout: typeof res.stdout === "string" ? res.stdout : "",

      stderr: typeof res.stderr === "string" ? res.stderr.slice(0, 2048) : null,
      native: { argv, result: res }
    };
  }
  return { ok: true, stdout: typeof res.stdout === "string" ? res.stdout : "" };
}

export function defaultRunGh({ args, cwd = null }) {
  const argv = ["gh", ...args];
  let res;
  try {
    res = spawnSync(argv[0], argv.slice(1), {
      encoding: "utf8",
      cwd: cwd ?? undefined,
      env: process.env,
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (error) {
    return { ok: false, argv, status: null, signal: null, stdout: null, stderr: null, spawn_error: error };
  }
  const outcome = {
    ok: res.status === 0 && res.error === undefined,
    argv,
    status: res.status ?? null,
    signal: res.signal ?? null,
    stdout: typeof res.stdout === "string" ? res.stdout : null,
    stderr: typeof res.stderr === "string" ? res.stderr : null
  };
  if (res.error === undefined) return outcome;
  return res.error?.code === "ENOBUFS"
    ? { ...outcome, capture_failure: res.error }
    : { ...outcome, spawn_error: res.error };
}

export function forgeCommandError(message, { operation, result, cause } = {}) {
  const { spawn_error: spawnError, capture_failure: captureFailure, ...facts } =
    isPlainObject(result) ? result : { result };
  const native = cause ?? spawnError ?? captureFailure;
  const error = new Error(message, native === undefined ? undefined : { cause: native });
  Object.assign(error, { operation, ...facts },
    captureFailure === undefined ? {} : { output_capture: "incomplete" });
  return error;
}

export const forgeCommandEvidence = (message, details) =>
  captureDiagnosticEvidence(forgeCommandError(message, details));

export function parseHttpsForgeRepositoryUrl(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.search !== "" || parsed.hash !== "") return null;
  const host = parsed.hostname.toLowerCase();
  if (!FORGE_HOST_RE.test(host)) return null;
  const segments = parsed.pathname.replace(/^\/+/u, "").split("/");
  if (segments.length !== 2) return null;
  const owner = segments[0];
  const name = segments[1].replace(/\.git$/u, "");
  if (!FORGE_SEGMENT_RE.test(owner) || !FORGE_SEGMENT_RE.test(name)) return null;
  return Object.freeze({ host, owner, name, https_url: `https://${host}/${owner}/${name}.git` });
}

export function resolveCanonicalForgeRepository({ repo, remoteName = "origin", deps = {} } = {}) {
  const remote = resolveRemoteUrl({ repo, remoteName, runGit: deps.runGit ?? defaultRunGit });
  if (remote.ok !== true) return remote;
  const identity = parseHttpsForgeRepositoryUrl(remote.url);
  if (identity === null) return { ok: false, reason: "remote_url_not_canonical_https" };
  return { ok: true, repository: identity };
}

export function sameForgeRepository(a, b) {
  return Boolean(a && b && a.host === b.host && a.owner === b.owner && a.name === b.name);
}
