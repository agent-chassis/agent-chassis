import path from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

