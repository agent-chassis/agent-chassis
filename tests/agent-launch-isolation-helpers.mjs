

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError
} from "../packages/agent-launch-cli/src/lib/launch-isolation.mjs";

export const CODES = BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..");

export const liveBwrap = (() => {
  try {
    const probe = spawnSync("bwrap", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (probe.error || probe.status !== 0) {
      return { available: false, reason: probe.error?.message ?? `status=${probe.status}` };
    }
    return { available: true, reason: null };
  } catch (err) {
    return { available: false, reason: err?.message ?? "spawn failed" };
  }
})();

export function expectIsolationError(fn, expectedCode) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof BubblewrapIsolationError, `expected BubblewrapIsolationError, got ${err?.constructor?.name}: ${err?.message}`);
    assert.equal(err.code, expectedCode, `expected code ${expectedCode}, got ${err.code} (${err.message})`);
    return err;
  }
  assert.fail(`expected BubblewrapIsolationError with code ${expectedCode}, but no error was thrown`);
  return null;
}

export function indexOfSequence(haystack, needle) {
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function makeTmpDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

const repoTmpRoot = path.join(repoRoot, "tests", ".tmp");
export function makeRepoTmpDir(prefix) {
  mkdirSync(repoTmpRoot, { recursive: true });
  return mkdtempSync(path.join(repoTmpRoot, prefix));
}

export function makeFakeCodexBinaryDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-launch-iso-fake-codex-"));
  const codex = path.join(dir, "codex");
  writeFileSync(codex, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(codex, 0o755);
  return dir;
}
