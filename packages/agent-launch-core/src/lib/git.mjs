import path from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_GIT_MAX_BUFFER = 64 * 1024 * 1024;

function gitInvocationPrefix({ repo, gitDir, workTree, quotePath }) {
  const hasRepo = typeof repo === "string" && repo.length > 0;
  const hasExplicitWorkTree = typeof gitDir === "string" && gitDir.length > 0
    && typeof workTree === "string" && workTree.length > 0;
  if (hasRepo === hasExplicitWorkTree) {
    throw new TypeError("runGitAsync requires exactly one repository selector");
  }
  const prefix = hasRepo
    ? ["-C", repo]
    : ["--git-dir", gitDir, "--work-tree", workTree];
  if (quotePath === true) prefix.push("-c", "core.quotePath=false");
  return prefix;
}

export function boundGitStderr(text, limit) {
  const full = typeof text === "string" ? text : "";
  const stderrBytes = Buffer.byteLength(full, "utf8");
  if (!Number.isSafeInteger(limit) || limit < 0 || full.length <= limit) {
    return { stderr: full, stderr_truncated: false, stderr_bytes: stderrBytes };
  }
  let end = limit;
  const last = full.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { stderr: full.slice(0, end), stderr_truncated: true, stderr_bytes: stderrBytes };
}

export async function runGitAsync({
  repo = null,
  gitDir = null,
  workTree = null,
  args,
  quotePath = false,
  env = undefined,
  input = undefined,
  maxBuffer = DEFAULT_GIT_MAX_BUFFER,
  stderrLimit = null,
  timeoutMs = null
} = {}) {
  let prefix;
  try {
    prefix = gitInvocationPrefix({ repo, gitDir, workTree, quotePath });
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) };
  }
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    return { ok: false, error: "runGitAsync args must be an array of strings" };
  }
  if (!Number.isSafeInteger(maxBuffer) || maxBuffer < 1) {
    return { ok: false, error: "runGitAsync maxBuffer must be a positive safe integer" };
  }
  if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) {
    return { ok: false, error: "runGitAsync timeoutMs must be null or a positive safe integer" };
  }

  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn("git", [...prefix, ...args], {
        env: env === undefined ? process.env : env,
        stdio: [input === undefined || input === null ? "ignore" : "pipe", "pipe", "pipe"]
      });
    } catch (error) {
      resolve({ ok: false, error: error?.message ?? String(error) });
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    let spawnError = null;
    let timedOut = false;
    let timeoutTimer = null;

    const capture = (chunks, stream) => (chunk) => {
      if (overflow) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stream === "stdout") stdoutBytes += bytes.length;
      else stderrBytes += bytes.length;
      if (stdoutBytes > maxBuffer || stderrBytes > maxBuffer) {
        overflow = true;
        stdoutChunks.length = 0;
        stderrChunks.length = 0;
        child.kill("SIGTERM");
        return;
      }
      chunks.push(bytes);
    };

    child.stdout.on("data", capture(stdoutChunks, "stdout"));
    child.stderr.on("data", capture(stderrChunks, "stderr"));
    child.once("error", (error) => {
      spawnError = error;
    });

    const bounding = Number.isSafeInteger(stderrLimit) && stderrLimit >= 0;
    const capturedStderr = () => {
      const fullStderr = Buffer.concat(stderrChunks).toString("utf8");
      return bounding ? boundGitStderr(fullStderr, stderrLimit) : { stderr: fullStderr };
    };

    child.once("close", (status, signal) => {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      if (timedOut) {
        resolve({
          ok: false,
          error: `git process timed out after ${timeoutMs}ms`,
          timed_out: true,
          status: typeof status === "number" ? status : null,
          signal: signal ?? null,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          ...capturedStderr()
        });
        return;
      }
      if (overflow) {

        resolve({
          ok: false,
          error: "git output exceeded maxBuffer",
          overflow: true,
          status: typeof status === "number" ? status : null,
          signal: signal ?? null,
          stdout: "",
          stderr: "",
          ...(bounding ? { stderr_truncated: true, stderr_bytes: null } : {})
        });
        return;
      }
      if (spawnError !== null) {
        resolve({
          ok: false,
          error: spawnError.message ?? String(spawnError),
          status: typeof status === "number" ? status : null,
          signal: signal ?? null,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          ...capturedStderr()
        });
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const bounded = capturedStderr();
      if (typeof status !== "number" || status !== 0) {
        resolve({ ok: false, status: status ?? null, signal: signal ?? null, stdout, ...bounded });
        return;
      }
      resolve({ ok: true, stdout, status, signal: signal ?? null, ...bounded });
    });

    if (timeoutMs !== null) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch (error) {
          if (spawnError === null) spawnError = error;
        }
      }, timeoutMs);
      if (typeof timeoutTimer.unref === "function") timeoutTimer.unref();
    }

    if (input !== undefined && input !== null) {
      child.stdin.once("error", (error) => {
        if (spawnError === null) spawnError = error;
      });
      child.stdin.end(input);
    }
  });
}

export async function findRepoRoot(startPath) {
  let current = path.resolve(startPath);
  while (true) {
    try {
      await access(path.join(current, ".git"), constants.F_OK);
      return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not find repo root from ${startPath}`);
    }
    current = parent;
  }
}

export async function assertAgentRunsNotTracked(repoRoot) {
  try {
    await execFileAsync("git", ["-C", repoRoot, "ls-files", "--error-unmatch", ".agent-runs"]);
    throw new Error(".agent-runs is tracked by git; refuse to proceed");
  } catch (error) {
    if (error instanceof Error && error.message === ".agent-runs is tracked by git; refuse to proceed") {
      throw error;
    }
    return;
  }
}
