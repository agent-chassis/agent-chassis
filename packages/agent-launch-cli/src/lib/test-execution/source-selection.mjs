

import path from "node:path";

import { runGitAsync } from "../../../../agent-launch-core/src/lib/git.mjs";

export const WORKING_COPY_EXCLUSIONS = Object.freeze([".git", ".agent-launch", "node_modules", "target",
  "__pycache__", ".pytest_cache", ".stestr"]);
export const SOURCE_SELECTION_FAILED = "test_runtime_source_selection_failed";

const GIT_TIMEOUT_MS = 60000;
const GITLINK_MODE = "160000";

class SourceSelectionError extends Error {
  constructor(message, detail) {
    super(message);
    this.code = SOURCE_SELECTION_FAILED;
    this.detail = detail;
  }
}

async function git(directory, args) {
  const result = await runGitAsync({ repo: directory, args, timeoutMs: GIT_TIMEOUT_MS, stderrLimit: 4000 });
  if (!result.ok) {
    const reason = (result.stderr ?? "").trim() || result.error || `git exited ${result.status}`;
    throw new SourceSelectionError(`git ${args.join(" ")} failed in ${directory}: ${reason}`,
      { directory, git_args: args, git_status: result.status ?? null, timed_out: result.timed_out === true,
        stderr: result.stderr ?? null });
  }
  return result.stdout;
}

const records = (stdout) => stdout.split("\0").filter((record) => record !== "");

async function workingTreeFiles(directory) {
  const inside = (await git(directory, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (inside !== "true") {
    throw new SourceSelectionError(`${directory} is not inside a Git working tree`, { directory });
  }
  const files = new Set();
  const submodules = new Set();

  for (const record of records(await git(directory, ["ls-files", "-z", "--stage"]))) {
    const tab = record.indexOf("\t");
    const mode = record.slice(0, record.indexOf(" "));
    const relative = record.slice(tab + 1);
    if (mode === GITLINK_MODE) submodules.add(relative);
    else files.add(relative);
  }
  for (const relative of records(await git(directory, ["ls-files", "-z", "--others", "--exclude-standard"]))) {

    if (!relative.endsWith("/")) files.add(relative);
  }
  for (const submodule of submodules) {
    const root = path.join(directory, submodule);
    let top;
    try {
      top = (await git(root, ["rev-parse", "--show-toplevel"])).trim();
    } catch {
      continue;
    }

    if (path.resolve(top) !== path.resolve(root)) continue;
    for (const relative of await workingTreeFiles(root)) files.add(`${submodule}/${relative}`);
  }
  return files;
}

const excludedAtRoot = (relative) => WORKING_COPY_EXCLUSIONS.some((name) =>
  relative === name || relative.startsWith(`${name}/`));

export async function selectWorkingCopySource(projectDir) {
  try {
    const files = await workingTreeFiles(projectDir);
    return { ok: true, entries: [...files].filter((relative) => !excludedAtRoot(relative)).sort() };
  } catch (error) {
    if (!(error instanceof SourceSelectionError)) throw error;
    return { ok: false, code: error.code, message: error.message, detail: error.detail,
      recovery: "The project's source is selected through Git: run from the project's Git working tree " +
        "(`git init` a new project; no commit is needed) with a working `git` on PATH." };
  }
}
