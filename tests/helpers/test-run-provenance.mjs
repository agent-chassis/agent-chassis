

import { spawnManagedTestProcess } from "./managed-test-process.mjs";

const GIT_READ_TIMEOUT_MS = 5000;
const REVISION_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

async function boundedGit(repoRoot, args) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
  let managed;
  try {
    managed = spawnManagedTestProcess({
      command: "git", args: ["--no-optional-locks", ...args],
      spawnOptions: { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"] }
    }, { displayLabel: `provenance git ${args[0]}`, stdoutTailBytes: 4096, stderrTailBytes: 1024,
      naturalExitTimeoutMs: 0, sigtermTimeoutMs: 500, sigkillTimeoutMs: 500 });
  } catch (error) {
    return { ok: false, reason: `git could not start: ${error.message}` };
  }
  let timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), GIT_READ_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([managed.waitForExit(), expired]);
    if (result === null) {
      await managed.stop().catch(() => {});
      return { ok: false, reason: `git ${args[0]} exceeded ${GIT_READ_TIMEOUT_MS}ms` };
    }
    if (result.error !== null) return { ok: false, reason: `git ${args[0]} failed: ${result.error.message}` };
    if (result.code !== 0) {
      return { ok: false, reason: `git ${args[0]} exited ${result.code}: ${result.stderrTail.trim().slice(0, 200)}` };
    }
    return { ok: true, stdout: result.stdoutTail };
  } catch (error) {
    return { ok: false, reason: `git ${args[0]} settlement failed: ${error.message}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function readSourceProvenance(repoRoot) {
  const head = await boundedGit(repoRoot, ["rev-parse", "--verify", "HEAD"]);
  const revision = head.ok ? head.stdout.trim() : "";
  if (!head.ok || !REVISION_PATTERN.test(revision)) {
    const reason = head.ok ? "HEAD is not a full object name" : head.reason;
    return Object.freeze({ source_revision: null, dirty: null, patch_identity: null,
      unavailable: Object.freeze([{ quantity: "source_revision", reason },
        { quantity: "patch_identity", reason }]) });
  }
  const status = await boundedGit(repoRoot, ["status", "--porcelain=v1", "--untracked-files=normal"]);
  if (!status.ok) {
    return Object.freeze({ source_revision: revision, dirty: null, patch_identity: null,
      unavailable: Object.freeze([{ quantity: "patch_identity", reason: status.reason }]) });
  }
  const dirty = status.stdout.length > 0;
  return Object.freeze({
    source_revision: revision,
    dirty,
    patch_identity: dirty ? null : "clean",
    unavailable: Object.freeze(dirty
      ? [{ quantity: "patch_identity", reason: "working tree is dirty; no exact patch identity is established" }]
      : [])
  });
}
