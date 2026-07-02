import path from "node:path";
import { readdir, stat } from "node:fs/promises";

import { getLauncherConfigDir, getTokenStateDir } from "../lib/config.mjs";
import { findRepoRoot } from "../lib/git.mjs";
import { getAgentRunsDir } from "../lib/paths.mjs";
import { fileExists, readJson, removePath } from "../lib/filesystem.mjs";

async function listDirs(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dirPath, entry.name));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isOlderThan(stats, seconds) {
  return Date.now() - stats.mtimeMs > seconds * 1000;
}

function isAlive(target) {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    return true;
  }
}

function isRecordedProcessAlive(state) {
  if (state.pgid) {
    try {
      process.kill(-state.pgid, 0);
      return true;
    } catch (error) {
      if (error?.code !== "ESRCH") {
        return true;
      }
    }
  }
  return state.pid ? isAlive(state.pid) : false;
}

export async function cleanupAgentRuns() {
  const repoRoot = await findRepoRoot(process.cwd());
  const agentRunsDir = getAgentRunsDir(repoRoot);
  const removed = [];
  let changed = true;

  while (changed) {
    changed = false;

    for (const reviewDir of await listDirs(path.join(agentRunsDir, "reviews"))) {
      const reviewPath = path.join(reviewDir, "metadata", "review.json");
      if (!(await fileExists(reviewPath))) {
        const stats = await stat(reviewDir);
        if (isOlderThan(stats, 3600)) {
          await removePath(reviewDir);
          removed.push(reviewDir);
          changed = true;
        }
      }
    }

    for (const handoffDir of await listDirs(path.join(agentRunsDir, "runs"))) {
      for (const runDir of await listDirs(handoffDir)) {
        const statePath = path.join(runDir, "metadata", "state.json");
        const metaPath = path.join(runDir, "metadata", "meta.json");
        const provenancePath = path.join(runDir, "metadata", "provenance.json");
        if (!(await fileExists(statePath))) {
          if (await fileExists(metaPath) || await fileExists(provenancePath)) {
            continue;
          }
          const stats = await stat(runDir);
          if (isOlderThan(stats, 300)) {
            await removePath(runDir);
            removed.push(runDir);
            changed = true;
          }
        }
      }
    }

    const launchingDir = getTokenStateDir("launching");
    try {
      const tokens = await readdir(launchingDir);
      for (const tokenName of tokens) {
        const tokenPath = path.join(launchingDir, tokenName);
        const tokenStats = await stat(tokenPath);
        const reviewId = tokenName.replace(/\.token$/, "");
        let associatedRun = null;
        for (const handoffDir of await listDirs(path.join(agentRunsDir, "runs"))) {
          for (const runDir of await listDirs(handoffDir)) {
            const launchPath = path.join(runDir, "metadata", "launch.json");
            if (!(await fileExists(launchPath))) {
              continue;
            }
            const launch = await readJson(launchPath);
            if (launch.review_id === reviewId) {
              associatedRun = runDir;
              break;
            }
          }
          if (associatedRun) {
            break;
          }
        }

        if (!associatedRun) {
          if (isOlderThan(tokenStats, 300)) {
            await removePath(tokenPath);
            removed.push(tokenPath);
            changed = true;
          }
          continue;
        }

        const statePath = path.join(associatedRun, "metadata", "state.json");
        if (!(await fileExists(statePath))) {
          continue;
        }
        const state = await readJson(statePath);
        const heartbeatAgeMs = Date.now() - Date.parse(state.heartbeat_at);
        if (heartbeatAgeMs > (300 + 300) * 1000 && !isRecordedProcessAlive(state)) {
          await removePath(tokenPath);
          removed.push(tokenPath);
          changed = true;
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  return { removed };
}
