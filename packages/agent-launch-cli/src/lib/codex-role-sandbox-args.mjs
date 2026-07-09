

import path from "node:path";
import { realpathSync } from "node:fs";

import { isNonEmptyStringInternal } from "./codex-role-io.mjs";

export function isCodexOrchestratorRole(role) {
  return role === "orch" || role === "orch-resume";
}

export function extractRepoInternalAddDirRoots(argv, repo) {
  if (!Array.isArray(argv) || !isNonEmptyStringInternal(repo)) return [];
  const repoPrefix = repo.endsWith(path.sep) ? repo : repo + path.sep;
  const out = [];
  const seen = new Set();
  for (let i = 0; i < argv.length - 1; i += 1) {
    if (argv[i] !== "--add-dir") continue;
    const v = argv[i + 1];
    if (typeof v !== "string" || !path.isAbsolute(v)) continue;
    if (v !== repo && !v.startsWith(repoPrefix)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function envToSetenvMap(env) {
  const out = {};
  if (!env || typeof env !== "object") return out;
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function codexArgsWithSandboxRepoRealpath(args, repo) {
  if (!Array.isArray(args)) return args;
  let repoReal;
  try {
    repoReal = realpathSync(repo);
  } catch {
    return args;
  }
  return args.map((arg, idx) => {
    if (arg === repo && args[idx - 1] === "-C") {
      return repoReal;
    }
    return arg;
  });
}
