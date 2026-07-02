

import os from "node:os";
import path from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";

import { parseIssueFrontmatter } from "@agent-chassis/agent-launch-core";
import { parseArgs } from "./cli.mjs";
import {
  isDirectory,
  pathExists,
  readDirSafe,
  readFileIfExists,
  writeLine,
  writeRaw
} from "./codex-role-io.mjs";
import { sanitizeOrchestratorPathSegment } from "./orchestrator-launch-settings.mjs";

const CODEX_ORCH_STATE_DIR_NAME = "codex-orch";

const ORCHESTRATOR_LIST_HELP_TEXT = `agent-launch orchestrators [--json]

List Codex orchestrator runtime history under
$XDG_STATE_HOME/codex-orch/<repo_key>/<IN-####>.

Options:
  --json                 Emit machine-readable output
`;

export async function runCodexOrchestratorList(argv = [], io = {}, env = process.env) {
  const { positionals, options } = parseArgs(argv);
  if (options.help || options.h || positionals[0] === "help") {
    writeLine(io.stdout, ORCHESTRATOR_LIST_HELP_TEXT);
    return;
  }

  const allowedOptions = new Set(["json"]);
  const unknownOptions = Object.keys(options).filter((key) => !allowedOptions.has(key));
  if (unknownOptions.length > 0) {
    writeRaw(io.stderr, `agent-launch orchestrators: unknown option --${unknownOptions[0]}\n`);
    process.exitCode = 2;
    return;
  }
  if (positionals.length > 0) {
    writeRaw(io.stderr, `agent-launch orchestrators: unexpected argument ${positionals[0]}\n`);
    process.exitCode = 2;
    return;
  }

  const rows = await listOrchestrators(env);
  if (options.json) {
    writeLine(io.stdout, JSON.stringify({
      schema_version: "codex-orchestrator-list.v1",
      orchestrators: rows
    }, null, 2));
    return;
  }
  writeLine(io.stdout, formatOrchestratorList(rows));
}

async function listOrchestrators(env = process.env) {
  const base = path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), CODEX_ORCH_STATE_DIR_NAME);
  if (!(await pathExists(base))) {
    return [];
  }
  const rows = [];
  const repoDirs = await readDirSafe(base);
  for (const repoKey of repoDirs) {
    const repoDir = path.join(base, repoKey);
    if (!(await isDirectory(repoDir))) {
      continue;
    }
    for (const initiative of await readDirSafe(repoDir)) {
      if (!/^IN-[0-9]+$/.test(initiative)) {
        continue;
      }
      const dir = path.join(repoDir, initiative);
      const meta = await readMeta(path.join(dir, "meta.env"));
      const repo = meta.repo || await repoFromKey(repoKey);
      const repoName = meta.repo_name || (repo ? path.basename(repo) : repoKey);
      const page = repo ? path.join(repo, "wiki", "initiatives", `${initiative}.md`) : null;
      const fallbackTitle = page ? await titleFromPage(page).catch(() => "") : "";
      rows.push({
        initiative,
        repo: repoName,
        last_used_utc: meta.last_used_utc || await mtimeUtc(dir),
        title: meta.title || fallbackTitle
      });
    }
  }
  return rows.sort((left, right) =>
    `${left.repo}\0${left.initiative}`.localeCompare(`${right.repo}\0${right.initiative}`)
  );
}

function formatOrchestratorList(rows) {
  if (rows.length === 0) {
    return `No orchestrator runtime history found`;
  }
  const lines = [formatColumns(["IN", "REPO", "LAST_USED_UTC", "TITLE"])];
  for (const row of rows) {
    lines.push(formatColumns([row.initiative, row.repo, row.last_used_utc, row.title]));
  }
  return lines.join("\n");
}

function formatColumns(values) {
  return `${values[0].padEnd(10)}  ${values[1].padEnd(28)}  ${values[2].padEnd(20)}  ${values[3]}`;
}

export function runtimeDirFor({ env, repo, subject }) {
  const base = path.join(env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), CODEX_ORCH_STATE_DIR_NAME);
  return path.join(base, repoKey(repo), subjectKey(subject));
}

export function repoKey(repo) {
  return sanitizeOrchestratorPathSegment(repo);
}

export function subjectKey(subject) {
  return sanitizeOrchestratorPathSegment(subject);
}

async function repoFromKey(key) {
  const home = os.homedir();
  const candidates = [process.cwd(), ...await readDirSafe(home).then((entries) => entries.map((entry) => path.join(home, entry)))];
  for (const candidate of candidates) {
    if (repoKey(candidate) === key && await isDirectory(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function writeMeta(dir, values) {
  await writeFile(
    path.join(dir, "meta.env"),
    Object.entries(values).map(([key, value]) => `${key}=${value ?? ""}`).join("\n") + "\n",
    "utf8"
  );
}

async function readMeta(file) {
  const content = await readFileIfExists(file);
  const result = {};
  for (const line of content.split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) {
      result[line.slice(0, index)] = line.slice(index + 1);
    }
  }
  return result;
}

export async function titleFromPage(file) {
  const content = await readFile(file, "utf8");
  const frontmatter = parseIssueFrontmatter(content);
  return typeof frontmatter.title === "string" ? frontmatter.title : "";
}

async function mtimeUtc(file) {
  const info = await stat(file);
  return info.mtime.toISOString().replace(/\.\d{3}Z$/, "Z");
}
