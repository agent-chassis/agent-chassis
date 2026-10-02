

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

export const UNSUPPORTED_REPOSITORY_SCOPE_SELECTOR = "unsupported_repository_scope_selector";
export const REPOSITORY_SCOPE_SELECTOR_KINDS = Object.freeze({
  GLOB: "glob_selector",
  DIRECTORY: "directory_scope"
});
export const REPOSITORY_SCOPE_ENUMERATION_GUIDANCE =
  "Globs and directory scopes are unsupported. Enumerate each required repository-relative file, " +
  "including intended new write files, then retry.";

const REPOSITORY_ROOT_SELECTORS = new Set([".", "./"]);
const GLOB_SYNTAX_RE = /[*?[\]{}]/u;

export function repositoryScopeSelectorRefusalMessage(field, entry) {
  return `${field} entry ${JSON.stringify(entry)} is not an individual file path. ` +
    REPOSITORY_SCOPE_ENUMERATION_GUIDANCE;
}

function unsupportedRepositoryScopeSelector(input, selectorKind) {
  return Object.freeze({
    ok: false,
    diagnostic: Object.freeze({
      code: UNSUPPORTED_REPOSITORY_SCOPE_SELECTOR,
      input,
      selector_kind: selectorKind
    })
  });
}

export function parseRepositoryScopeFileSelector(input) {
  if (REPOSITORY_ROOT_SELECTORS.has(input)) {
    return unsupportedRepositoryScopeSelector(input, REPOSITORY_SCOPE_SELECTOR_KINDS.DIRECTORY);
  }
  const parsed = parseRepositoryScopePath(input);
  if (!parsed.ok) return parsed;
  if (parsed.value.components.some((component) => GLOB_SYNTAX_RE.test(component))) {
    return unsupportedRepositoryScopeSelector(input, REPOSITORY_SCOPE_SELECTOR_KINDS.GLOB);
  }
  if (parsed.value.directory_hint) {
    return unsupportedRepositoryScopeSelector(input, REPOSITORY_SCOPE_SELECTOR_KINDS.DIRECTORY);
  }
  const { original, canonical_path: canonicalPath, components } = parsed.value;
  return Object.freeze({
    ok: true,
    value: Object.freeze({ original, canonical_path: canonicalPath, components })
  });
}

export const REPOSITORY_SCOPE_FIELDS = Object.freeze(["read_scope", "repo_paths", "write_scope"]);

export function findUnsupportedRepositoryScopeSelector(values) {
  if (!Array.isArray(values)) return null;
  for (const [index, entry] of values.entries()) {
    if (typeof entry !== "string") continue;

    for (const candidate of new Set([entry.trim(), normalizeRepositoryRelativePath(entry)])) {
      const parsed = parseRepositoryScopeFileSelector(candidate);
      if (!parsed.ok && parsed.diagnostic.code === UNSUPPORTED_REPOSITORY_SCOPE_SELECTOR) {
        return Object.freeze({ index, entry, selector_kind: parsed.diagnostic.selector_kind });
      }
    }
  }
  return null;
}

export function normalizeRepositoryRelativePath(value) {
  return String(value).trim().replace(/^\.\//u, "");
}

export function isRepositoryRelativePath(value) {
  const normalized = normalizeRepositoryRelativePath(value);
  return parseRepositoryScopePath(normalized).ok;
}
