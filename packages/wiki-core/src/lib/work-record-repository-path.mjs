

import { posix as pathPosix } from "node:path";

function invalidRepositoryScopePath(input) {
  return Object.freeze({
    ok: false,
    diagnostic: Object.freeze({
      code: "invalid_repository_scope_path",
      input
    })
  });
}

export function parseRepositoryScopePath(input) {
  if (typeof input !== "string" || input.length === 0 || input !== input.trim() ||
      input.startsWith("-") || input.startsWith("~") || input.includes("\\") ||
      /[\x00-\x1f\x7f]/u.test(input)) {
    return invalidRepositoryScopePath(input);
  }

  const directoryHint = input.endsWith(pathPosix.sep);
  if (directoryHint && input.endsWith(`${pathPosix.sep}${pathPosix.sep}`)) {
    return invalidRepositoryScopePath(input);
  }
  const canonicalPath = directoryHint ? input.slice(0, -1) : input;
  const components = canonicalPath.split(pathPosix.sep);
  if (!canonicalPath || pathPosix.isAbsolute(canonicalPath) || /^[A-Za-z]:/u.test(canonicalPath) ||
      pathPosix.normalize(canonicalPath) !== canonicalPath ||
      components.some((component) => !component || component === "." || component === "..")) {
    return invalidRepositoryScopePath(input);
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      original: input,
      canonical_path: canonicalPath,
      directory_hint: directoryHint,
      components: Object.freeze(components)
    })
  });
}

export function compileRepositoryScopePath(input) {
  const parsed = parseRepositoryScopePath(input);
  if (!parsed.ok) return parsed;

  const selector = parsed.value;
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      ...selector,
      matches(candidate) {
        const parsedCandidate = parseRepositoryScopePath(candidate);
        if (!parsedCandidate.ok) return false;
        const candidatePath = parsedCandidate.value.canonical_path;
        if (pathPosix.matchesGlob(candidatePath, selector.canonical_path)) return true;
        return selector.directory_hint && pathPosix.matchesGlob(
          candidatePath,
          `${selector.canonical_path}${pathPosix.sep}**`
        );
      }
    })
  });
}

export function repositoryScopeGlobIndex(selector) {
  return selector.components.findIndex((component) => /[*?[\]{}]/u.test(component));
}

export function repositoryScopePathMatches(input, candidate) {
  const compiled = compileRepositoryScopePath(input);
  return compiled.ok && compiled.value.matches(candidate);
}

export function normalizeRepositoryRelativePath(value) {
  return String(value).trim().replace(/^\.\//u, "");
}

export function isRepositoryRelativePath(value) {
  const normalized = normalizeRepositoryRelativePath(value);
  return parseRepositoryScopePath(normalized).ok;
}
