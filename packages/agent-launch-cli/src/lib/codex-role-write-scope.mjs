

import path from "node:path";
import { statSync } from "node:fs";
import { stat } from "node:fs/promises";

export function launcherBinWrapperPermissionRoots(entry) {
  return entry.startsWith("packages/agent-launch-cli/bin/");
}

export function buildCodexWritableSandboxArgs(repo, {
  writableProjectRoots = [],
  writableAbsoluteRoots = []
} = {}) {
  const args = ["-s", "workspace-write"];
  const seen = new Set();
  const pushAddDir = (target) => {
    if (typeof target !== "string" || target.length === 0) {
      return;
    }
    try {
      if (!statSync(target).isDirectory()) {
        return;
      }
    } catch {

      if (looksLikeFileScopeEntry(target)) {
        return;
      }
    }
    if (seen.has(target)) {
      return;
    }
    seen.add(target);
    args.push("--add-dir", target);
  };
  for (const entry of Array.isArray(writableAbsoluteRoots) ? writableAbsoluteRoots : []) {
    if (typeof entry !== "string" || !path.isAbsolute(entry)) {
      continue;
    }
    pushAddDir(entry);
  }
  for (const root of Array.isArray(writableProjectRoots) ? writableProjectRoots : []) {
    if (typeof root !== "string" || root.length === 0) {
      continue;
    }
    if (hasGlobSyntax(root)) {
      continue;
    }
    const normalized = root.replace(/\/+$/, "");
    if (normalized === "" || normalized === ".") {
      continue;
    }
    pushAddDir(path.resolve(repo, normalized));
  }
  return args;
}

export async function projectPermissionWritesForScope(repo, writeScope) {
  const roots = [];
  const seen = new Set();
  for (const entry of Array.isArray(writeScope) ? writeScope : []) {
    const root = await projectPermissionRootForScopeEntry(repo, entry);
    if (!root || seen.has(root)) {
      continue;
    }
    seen.add(root);
    roots.push(root);
  }
  return roots;
}

async function projectPermissionRootForScopeEntry(repo, entry) {
  const normalized = normalizeProjectScopeEntry(entry);
  if (!normalized || hasGlobSyntax(normalized)) {
    return normalized;
  }
  const withoutTrailingSlash = normalized.replace(/\/+$/, "") || ".";
  try {
    const stats = await stat(path.join(repo, withoutTrailingSlash));
    if (stats.isFile()) {
      return parentDirectoryForScopeEntry(withoutTrailingSlash);
    }
  } catch {
    if (looksLikeFileScopeEntry(withoutTrailingSlash)) {
      return parentDirectoryForScopeEntry(withoutTrailingSlash);
    }
  }
  return withoutTrailingSlash;
}

export function parentDirectoryForScopeEntry(entry) {
  const parent = path.posix.dirname(entry);
  return parent === "" ? "." : parent;
}

const KNOWN_FILE_SCOPE_BASENAMES = new Set([
  "Dockerfile",
  "Containerfile",
  "Makefile",
  "GNUmakefile",
  "Rakefile",
  "Gemfile",
  "Procfile",
  "Vagrantfile",
  "Pipfile",
  "Brewfile",
  "Justfile",
  "Berksfile",
  "Cargo.lock",
  "CODEOWNERS",
  "OWNERS",
  "MAINTAINERS",
  "AUTHORS",
  "CONTRIBUTORS",
  "LICENSE",
  "COPYING",
  "NOTICE",
  "PATENTS",
  "CHANGELOG",
  "CHANGES",
  "HISTORY",
  "NEWS",
  "README",
  "INSTALL",
  "TODO",
  "VERSION"
]);

const KNOWN_FILE_SCOPE_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".csv",
  ".tsv",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".lock",
  ".log",
  ".env",
  ".ini",
  ".cfg",
  ".conf",
  ".rules",
  ".lic",
  ".license",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".d.ts",
  ".py",
  ".pyi",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".scala",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".cxx",
  ".hpp",
  ".hh",
  ".m",
  ".mm",
  ".swift",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".pl",
  ".php",
  ".lua",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".dockerfile",
  ".mk",
  ".mak",
  ".make",
  ".cmake",
  ".gradle",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".bin",
  ".schema"
]);

export function looksLikeFileScopeEntry(entry) {
  const basename = path.posix.basename(entry);
  if (!basename || basename === "." || basename === "..") {
    return false;
  }
  if (KNOWN_FILE_SCOPE_BASENAMES.has(basename)) {
    return true;
  }
  if (basename.startsWith(".") && basename.indexOf(".", 1) === -1) {
    return true;
  }
  if (launcherBinWrapperPermissionRoots(entry)) {
    return true;
  }
  const lastDot = basename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === basename.length - 1) {
    return false;
  }
  const ext = basename.slice(lastDot).toLowerCase();
  return KNOWN_FILE_SCOPE_EXTENSIONS.has(ext);
}

export function normalizeProjectScopeEntry(entry) {
  if (typeof entry !== "string") {
    return null;
  }
  const normalized = entry.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
  return normalized || ".";
}

export function hasGlobSyntax(entry) {
  return /[*?\[\]{}]/.test(entry);
}
