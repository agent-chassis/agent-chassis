import { readFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../../lib/exact-binding-common.mjs";

const STATIC_MODULE_SPECIFIER =
  /\b(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/gu;
const DYNAMIC_MODULE_SPECIFIER = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;
const IMPORT_META_URL_SPECIFIER =
  /\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/gu;

function localSpecifiers(source) {
  const specifiers = new Set();
  for (const expression of [
    STATIC_MODULE_SPECIFIER,
    DYNAMIC_MODULE_SPECIFIER,
    IMPORT_META_URL_SPECIFIER
  ]) {
    expression.lastIndex = 0;
    for (const match of source.matchAll(expression)) {
      if (match[1].startsWith(".")) specifiers.add(match[1]);
    }
  }
  return [...specifiers].sort();
}

async function executableDependencyClosure(repositoryRoot, executableModule) {
  const root = path.resolve(repositoryRoot);
  const entry = path.resolve(root, executableModule);
  const pending = [entry];
  const visited = new Set([entry]);
  const dependencies = new Map();
  while (pending.length > 0) {
    const owner = pending.pop();
    const source = await readFile(owner, "utf8");
    for (const specifier of localSpecifiers(source)) {
      const resolved = path.resolve(path.dirname(owner), specifier);
      const relative = path.relative(root, resolved).split(path.sep).join("/");
      if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(
        `executable dependency escapes repository root: ${specifier}`
      );
      const bytes = await readFile(resolved);
      dependencies.set(relative, sha256(bytes));
      if (path.extname(resolved) === ".mjs" && !visited.has(resolved)) {
        visited.add(resolved);
        pending.push(resolved);
      }
    }
  }
  dependencies.delete(path.relative(root, entry).split(path.sep).join("/"));
  return [...dependencies]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dependencyPath, digest]) => ({ path: dependencyPath, sha256: digest }));
}

export {
  executableDependencyClosure,
  localSpecifiers
};
