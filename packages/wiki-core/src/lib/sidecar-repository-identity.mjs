import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function runGit(dir, args) {
  return execFileAsync("git", ["--no-replace-objects", "-C", dir, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
}

function oneLine(value, label) {
  const lines = String(value).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1 || lines[0].includes("\0")) {
    throw new Error(`${label} did not resolve to exactly one value`);
  }
  return lines[0];
}

export function isConcreteSidecarCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

export async function resolveSidecarRepositoryIdentity({ dir = "." } = {}) {
  const requested = path.resolve(String(dir || "."));
  const first = oneLine(
    (await runGit(requested, ["rev-parse", "--show-toplevel"])).stdout,
    "sidecar repository"
  );
  if (!path.isAbsolute(first)) {
    throw new Error("sidecar repository top level is not absolute");
  }
  const canonical = await realpath(first);
  const second = oneLine(
    (await runGit(canonical, ["rev-parse", "--show-toplevel"])).stdout,
    "canonical sidecar repository"
  );
  if ((await realpath(second)) !== canonical) {
    throw new Error("sidecar repository identity is ambiguous");
  }
  return canonical;
}

export async function resolveCommittedHead(repositoryIdentity) {
  const head = oneLine(
    (await runGit(repositoryIdentity, ["rev-parse", "--verify", "HEAD^{commit}"])).stdout,
    "sidecar committed HEAD"
  ).toLowerCase();
  if (!isConcreteSidecarCommit(head)) {
    throw new Error("sidecar committed HEAD is not a concrete commit");
  }
  return head;
}
