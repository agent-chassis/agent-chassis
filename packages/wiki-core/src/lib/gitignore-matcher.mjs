import path from "node:path";
import { readFileSync } from "node:fs";

const NOT_IGNORED = { isIgnored: () => false };

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExpSource(pattern) {
  let source = "";
  let index = 0;

  while (index < pattern.length) {
    const character = pattern[index];

    if (character === "*") {
      if (pattern[index + 1] === "*") {
        let end = index;
        while (pattern[end] === "*") {
          end += 1;
        }
        const precededBySlash = index === 0 || pattern[index - 1] === "/";
        const followedBySlash = pattern[end] === "/";

        if (precededBySlash && followedBySlash) {

          source += "(?:[^/]+/)*";
          index = end + 1;
          continue;
        }
        if (precededBySlash && end === pattern.length) {

          source += ".*";
          index = end;
          continue;
        }

        return null;
      }

      source += "[^/]*";
      index += 1;
      continue;
    }

    if (character === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    if (character === "[" || character === "]" || character === "\\") {
      return null;
    }

    source += escapeRegExp(character);
    index += 1;
  }

  return source;
}

function parseGitignoreLine(rawLine) {
  let line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

  line = line.replace(/\s+$/, "");

  if (line === "" || line.startsWith("#")) {
    return { kind: "skip" };
  }
  if (line.startsWith("!")) {
    return { kind: "negation" };
  }
  if (line.includes("\\")) {
    return { kind: "unsupported" };
  }

  let dirOnly = false;
  if (line.endsWith("/")) {
    dirOnly = true;
    line = line.slice(0, -1);
  }

  let anchored = false;
  if (line.startsWith("/")) {
    anchored = true;
    line = line.slice(1);
  }
  if (line === "") {
    return { kind: "skip" };
  }

  if (line.includes("/")) {
    anchored = true;
  }

  const source = globToRegExpSource(line);
  if (source === null) {
    return { kind: "unsupported" };
  }

  return { kind: "pattern", anchored, dirOnly, matcher: new RegExp(`^${source}$`) };
}

function splitReferencePath(relativePath) {
  const raw = String(relativePath ?? "");
  const hadTrailingSlash = /\/$/.test(raw);
  const normalized = raw.replace(/^\.\//, "").replace(/\/+$/, "");

  if (!normalized || normalized.startsWith("/")) {
    return null;
  }

  const segments = normalized.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) {
    return null;
  }

  return { segments, hadTrailingSlash };
}

export function createGitignoreMatcher(targetDir) {
  if (!targetDir) {
    return NOT_IGNORED;
  }

  let contents;
  try {
    contents = readFileSync(path.join(targetDir, ".gitignore"), "utf8");
  } catch {
    return NOT_IGNORED;
  }

  const patterns = [];
  for (const rawLine of contents.split("\n")) {
    const parsed = parseGitignoreLine(rawLine);
    if (parsed.kind === "negation") {
      return NOT_IGNORED;
    }
    if (parsed.kind === "pattern") {
      patterns.push(parsed);
    }
  }

  if (patterns.length === 0) {
    return NOT_IGNORED;
  }

  return {
    isIgnored(relativePath) {
      const split = splitReferencePath(relativePath);
      if (!split) {
        return false;
      }

      const { segments, hadTrailingSlash } = split;
      for (let index = 0; index < segments.length; index += 1) {

        const fromRoot = segments.slice(0, index + 1).join("/");

        const isDirectory = index < segments.length - 1 || hadTrailingSlash;

        for (const pattern of patterns) {
          if (pattern.dirOnly && !isDirectory) {
            continue;
          }
          if (pattern.matcher.test(pattern.anchored ? fromRoot : segments[index])) {
            return true;
          }
        }
      }

      return false;
    }
  };
}
