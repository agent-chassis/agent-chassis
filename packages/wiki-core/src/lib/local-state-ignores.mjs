import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const AGENT_CHASSIS_GITIGNORE_ENTRIES = Object.freeze([
  "/.cache/repo-code-index/",
  "/.cache/wiki-search/",
  "/.cache/controlled-contract/assessments/",
  "/.cache/controlled-contract/validators/",
  "/.cache/test-proof-native/",
  "/.agent-launch/",
  "/agent-chassis-runtime.json",
  "/wiki/.wiki-mcp.json"
]);

function isEntryAlreadyCovered(lines, entry) {
  const bareEntry = entry.replace(/^\//u, "").replace(/\/$/u, "");
  let covered = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("!")) {
      const exception = line.slice(1).replace(/^\//u, "").replace(/\/$/u, "");
      if (/[*?[\\]/u.test(exception) || bareEntry === exception ||
          bareEntry.startsWith(`${exception}/`)) covered = false;
      continue;
    }
    const bareLine = line.replace(/^\//u, "").replace(/\/$/u, "");
    if ((bareLine === bareEntry && (entry.endsWith("/") || !line.endsWith("/"))) ||
        bareEntry.startsWith(`${bareLine}/`)) covered = true;
  }
  return covered;
}

export async function ensureAgentChassisGitignore(repositoryRoot) {
  const file = path.join(repositoryRoot, ".gitignore");
  try {
    let existing = "";
    try {
      existing = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const lines = existing.split("\n");
    const added = AGENT_CHASSIS_GITIGNORE_ENTRIES.filter((entry) => !isEntryAlreadyCovered(lines, entry));
    if (added.length === 0) return { updated: false, added: [] };
    const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(file, `${existing}${separator}${added.join("\n")}\n`, "utf8");
    return { updated: true, added };
  } catch (error) {
    throw new Error(`AgentChassis setup: failed to update .gitignore at ${file}: ${error.message}. ` +
      "Ensure the file is readable and writable.", { cause: error });
  }
}
