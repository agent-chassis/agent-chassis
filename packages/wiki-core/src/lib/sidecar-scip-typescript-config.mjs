

import { existsSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const CONFIG_CHAIN_LIMIT = 32;

function parseConfig(text) {
  let json = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
      index += 1;
      json += text.slice(start, index);
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      json += char;
      index += 1;
    }
  }
  try {
    return JSON.parse(json.replace(/,(\s*[}\]])/gu, "$1"));
  } catch {

    return null;
  }
}

export function typescriptConfigExtends(text) {
  const value = parseConfig(String(text ?? ""))?.extends;
  return (Array.isArray(value) ? value : [value]).filter((entry) => typeof entry === "string" && entry.length > 0);
}

const isRelative = (specifier) => specifier.startsWith("./") || specifier.startsWith("../") ||
  specifier === "." || specifier === "..";

function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

function isDirectory(directory) {
  try { return statSync(directory).isDirectory(); } catch { return false; }
}

function configFile(base) {
  return [base, `${base}.json`, path.join(base, "tsconfig.json")].find(isFile) ?? null;
}

function packageConfigFile(packageRoot) {
  let manifest = null;
  try { manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")); } catch {   }
  const root = manifest?.exports?.["."] ?? manifest?.exports;
  const exported = typeof root === "string" ? root : root?.default;
  const named = [manifest?.tsconfig, exported].find((entry) => typeof entry === "string");
  return configFile(path.join(packageRoot, named ?? "tsconfig.json"));
}

export async function typescriptConfigPackagePopulation({ repoRoot, configPath, trackedPaths, readCommitted }) {
  const root = path.resolve(repoRoot);
  const tracked = new Set(trackedPaths);
  const committedBelow = (relative) => trackedPaths.some((value) => value.startsWith(`${relative}/`));
  const packages = new Set();
  const missing = new Set();
  const seen = new Set();

  const pending = [{ committed: configPath }];
  while (pending.length > 0 && seen.size < CONFIG_CHAIN_LIMIT) {
    const current = pending.shift();
    const identity = current.committed ?? current.installed;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const text = current.committed ? await readCommitted(current.committed) : readFileSync(current.installed, "utf8");
    if (typeof text !== "string") continue;
    const directory = current.committed
      ? path.posix.dirname(current.committed) : path.dirname(current.installed);
    for (const specifier of typescriptConfigExtends(text)) {
      if (path.isAbsolute(specifier)) continue;
      if (isRelative(specifier)) {
        if (current.installed) {
          const file = configFile(path.resolve(directory, specifier));
          if (file) pending.push({ installed: file });
          continue;
        }
        const base = path.posix.normalize(path.posix.join(directory, specifier));
        const committed = [base, `${base}.json`, path.posix.join(base, "tsconfig.json")]
          .find((candidate) => tracked.has(candidate));
        if (committed) pending.push({ committed });
        continue;
      }
      const segments = specifier.split("/");
      const name = segments.slice(0, specifier.startsWith("@") ? 2 : 1).join("/");
      const subpath = segments.slice(specifier.startsWith("@") ? 2 : 1).join("/");

      let from = current.committed ? path.join(root, directory) : directory;
      let packageRoot = null;
      while (packageRoot === null) {
        const candidate = path.join(from, "node_modules", name);
        if (isDirectory(candidate)) packageRoot = candidate;
        else if (from === root || path.dirname(from) === from) break;
        else from = path.dirname(from);
      }
      if (packageRoot === null) {
        missing.add(specifier);
        continue;
      }
      const relative = path.relative(root, packageRoot).split(path.sep).join("/");
      if (relative.startsWith("../") || committedBelow(relative)) continue;
      packages.add(packageRoot);
      const file = subpath ? configFile(path.join(packageRoot, subpath)) : packageConfigFile(packageRoot);
      if (file) pending.push({ installed: file });
    }
  }
  return { population: [...packages].sort(), missing: [...missing].sort() };
}

export async function materializeTypescriptConfigPackages({ sourceRepoRoot, snapshotRoot, population }) {
  for (const packageRoot of population) {
    const destination = path.join(snapshotRoot, path.relative(sourceRepoRoot, packageRoot));
    if (existsSync(destination)) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(packageRoot, destination, { recursive: true, dereference: true });
  }
}
