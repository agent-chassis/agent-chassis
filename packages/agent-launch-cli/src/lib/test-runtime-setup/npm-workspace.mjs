

import { readFileSync } from "node:fs";
import path from "node:path";

import { parseDocument } from "yaml";
import { TestRuntimeSetupError } from "./toolchains.mjs";

export const NPM_MANIFEST = "package.json";
export const NPM_CONFIG = ".npmrc";
export const NPM_LOCK = "package-lock.json";
export const PNPM_LOCK = "pnpm-lock.yaml";
export const PNPM_WORKSPACE = "pnpm-workspace.yaml";

export const NPM_LOCKS = Object.freeze([
  Object.freeze({ name: NPM_LOCK, manager: "npm", installed_metadata: "node_modules/.package-lock.json",
    install: "npm ci" }),
  Object.freeze({ name: PNPM_LOCK, manager: "pnpm", installed_metadata: "node_modules/.modules.yaml",
    install: "pnpm install --frozen-lockfile" })
]);

export const NPM_RUNNER_PACKAGES = Object.freeze({ jest: "jest", vitest: "vitest", mocha: "mocha",
  ava: "ava", lib0: "lib0-testing" });
const NPM_DEPENDENCY_FIELDS = Object.freeze(["dependencies", "devDependencies",
  "optionalDependencies", "peerDependencies"]);
const NPM_REQUIRED_FIELDS = Object.freeze(["dependencies", "devDependencies"]);
const ARCHIVE_RE = /\.(?:tgz|tar\.gz|tar)$/u;

const at = (project, name) => project === "." ? name : `${project}/${name}`;

function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseYamlObject(text) {
  const document = parseDocument(text, { prettyErrors: false, uniqueKeys: false });
  if (document.errors.length > 0) {
    return { value: null, error: document.errors[0].message };
  }
  const value = document.toJS({ maxAliasCount: 64 });
  return value !== null && typeof value === "object" && !Array.isArray(value) ? { value, error: null }
    : { value: null, error: null };
}

function lockDirectory(value) {
  if (typeof value !== "string" || value === "" || path.posix.isAbsolute(value)) return null;
  const normalized = path.posix.normalize(value.replace(/\/+$/u, ""));
  return normalized === ".." || normalized.startsWith("../") ? null : normalized;
}

export function npmManifestFacts(text) {
  const manifest = typeof text === "string" ? parseJsonObject(text) : null;
  const scriptsValid = manifest?.scripts === undefined || (manifest.scripts !== null &&
    typeof manifest.scripts === "object" && !Array.isArray(manifest.scripts) &&
    Object.values(manifest.scripts).every((command) => typeof command === "string"));
  const dependenciesValid = NPM_DEPENDENCY_FIELDS.every((field) => manifest?.[field] === undefined ||
    (manifest[field] !== null && typeof manifest[field] === "object" && !Array.isArray(manifest[field]) &&
      Object.values(manifest[field]).every((specifier) => typeof specifier === "string")));

  const optionalPeers = new Set(Object.entries(manifest?.peerDependenciesMeta ?? {})
    .filter(([, meta]) => meta?.optional === true).map(([name]) => name));
  const declared = [...new Set(NPM_DEPENDENCY_FIELDS.flatMap((field) =>
    Object.keys(manifest?.[field] ?? {}).filter((name) =>
      field !== "peerDependencies" || !optionalPeers.has(name))))].sort();
  const workspaces = Array.isArray(manifest?.workspaces) ? manifest.workspaces
    : Array.isArray(manifest?.workspaces?.packages) ? manifest.workspaces.packages : [];
  const manager = /^(npm|pnpm)@/u.exec(typeof manifest?.packageManager === "string"
    ? manifest.packageManager : "")?.[1] ?? null;
  return Object.freeze({
    valid: manifest !== null,
    scriptsValid,
    dependenciesValid,
    testScripts: Object.freeze(Object.entries(scriptsValid ? manifest?.scripts ?? {} : {})
      .filter(([name, command]) => /^test(?:$|[:-].+)/u.test(name) && command.trim() !== "")
      .map(([name]) => name).sort()),
    name: typeof manifest?.name === "string" ? manifest.name : null,
    declared: Object.freeze(declared),
    declaresDependencies: declared.length > 0,
    required: Object.freeze([...new Set(NPM_REQUIRED_FIELDS.flatMap((field) =>
      Object.keys(manifest?.[field] ?? {})))].sort()),
    runners: Object.freeze(Object.entries(NPM_RUNNER_PACKAGES).filter(([name]) => declared.includes(name))
      .map(([, runner]) => runner)),
    workspaces: Object.freeze(workspaces.filter((pattern) => typeof pattern === "string")),
    workspaceDeclared: manifest !== null && Object.hasOwn(manifest, "workspaces"),
    packageManagerDeclared: manifest !== null && Object.hasOwn(manifest, "packageManager"),
    packageManager: manager
  });
}

function npmLockDisabled(text) {
  let disabled = false;
  for (const raw of (text ?? "").split(/\r?\n/u)) {
    const line = raw.replace(/\s*[#;].*$/u, "").trim();
    if (line.startsWith("[")) break;
    const setting = /^package-lock(\[\])?\s*(?:=(.*))?$/u.exec(line);
    if (setting !== null) disabled = setting[1] === undefined && setting[2]?.trim() === "false";
  }
  return disabled;
}

export function pnpmWorkspacePatterns(text) {
  const { value, error } = parseYamlObject(text);
  const packages = Array.isArray(value?.packages) ? value.packages : [];
  return Object.freeze({ patterns: Object.freeze(packages.filter((pattern) => typeof pattern === "string")),
    error });
}

function fileDirectory(specifier) {
  if (typeof specifier !== "string" || !specifier.startsWith("file:") || ARCHIVE_RE.test(specifier)) return null;
  return lockDirectory(specifier.slice("file:".length));
}

export function npmLockFacts(text) {
  const lock = typeof text === "string" ? parseJsonObject(text) : null;
  const directories = [];
  const localCopies = [];
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (key === "") continue;
    const segments = key.split("/");
    const modules = segments.lastIndexOf("node_modules");
    if (modules < 0) {
      if (lockDirectory(key) === key) directories.push(key);
      continue;
    }
    const directory = entry?.link === true ? null : fileDirectory(entry?.resolved);

    if (directory === null || segments.slice(0, modules).includes("node_modules")) continue;
    localCopies.push(Object.freeze({ owner: modules === 0 ? "." : segments.slice(0, modules).join("/"),
      package: segments.slice(modules + 1).join("/"), directory }));
  }
  return Object.freeze({ directories: Object.freeze(directories.sort()),
    localCopies: Object.freeze(localCopies) });
}

function pnpmImportersSection(text) {
  const key = /^importers:[ \t]*\r?$/mu.exec(text);
  if (key === null) return /^importers[ \t]*:/mu.test(text) ? text : "";
  const body = key.index + key[0].length;
  const next = /^[^\s#]/mu.exec(text.slice(body));
  return text.slice(key.index, next === null ? undefined : body + next.index);
}

export function pnpmLockFacts(text) {
  const { value, error } = typeof text === "string" ? parseYamlObject(pnpmImportersSection(text))
    : { value: null, error: null };
  const directories = [];
  const localCopies = [];
  const importers = value?.importers !== null && typeof value?.importers === "object" ? value.importers : {};
  for (const [key, importer] of Object.entries(importers)) {
    const owner = lockDirectory(key);
    if (owner === null) continue;
    if (owner !== ".") directories.push(owner);
    for (const field of NPM_DEPENDENCY_FIELDS) {
      for (const [name, dependency] of Object.entries(importer?.[field] ?? {})) {
        const directory = fileDirectory(typeof dependency === "string" ? dependency : dependency?.version);
        if (directory !== null) localCopies.push(Object.freeze({ owner, package: name, directory }));
      }
    }
  }
  return Object.freeze({ directories: Object.freeze(directories.sort()),
    localCopies: Object.freeze(localCopies), error });
}

function workspaceMatcher(pattern) {
  const negated = pattern.startsWith("!");
  const segments = (negated ? pattern.slice(1) : pattern).replace(/^\.\//u, "").replace(/\/+$/u, "")
    .split("/");
  const source = segments.map((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === "**") return last ? "(?:[^/]+(?:/[^/]+)*)?" : "(?:[^/]+/)*";
    return segment.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
      .join("[^/]*") + (last ? "" : "/");
  }).join("");
  const expression = new RegExp(`^${source}$`, "u");
  return { negated, test: (relative) => expression.test(relative) };
}

export function workspaceMembers(project, patterns, candidates) {
  const matchers = patterns.map(workspaceMatcher);
  return candidates.filter((directory) => {
    if (directory === project) return false;
    const relative = project === "." ? directory
      : directory.startsWith(`${project}/`) ? directory.slice(project.length + 1) : null;
    if (relative === null) return false;
    let included = false;
    for (const matcher of matchers) {
      if (matcher.test(relative)) included = !matcher.negated;
    }
    return included;
  }).map((directory) => project === "." ? directory : directory.slice(project.length + 1)).sort();
}

export function resolveNpmWorkspace(project, readFile) {
  const read = (name) => readFile(at(project, name));
  const manifest = npmManifestFacts(read(NPM_MANIFEST));
  const pnpmWorkspaceText = read(PNPM_WORKSPACE);
  const existing = NPM_LOCKS.filter(({ name }) => read(name) !== null);
  let selected = existing.length === 1 ? existing[0] : null;
  let ambiguous = [];
  if (existing.length > 1) {
    const declared = manifest.packageManager ?? (pnpmWorkspaceText === null ? null : "pnpm");
    const installed = existing.filter(({ installed_metadata: metadata }) => read(metadata) !== null);
    selected = existing.find(({ manager }) => manager === declared) ??
      (installed.length === 1 ? installed[0] : null);
    if (selected === null) ambiguous = existing.map(({ name }) => name);
  }

  const lockless = existing.length === 0 && !manifest.workspaceDeclared &&
    (!manifest.packageManagerDeclared || manifest.packageManager === "npm") && pnpmWorkspaceText === null &&
    read("node_modules/.modules.yaml") === null && read("npm-shrinkwrap.json") === null &&
    read("yarn.lock") === null && npmLockDisabled(read(NPM_CONFIG));
  const manager = selected?.manager ?? manifest.packageManager ??
    (pnpmWorkspaceText !== null ? "pnpm" : lockless ? "npm" : null);

  const pnpm = manager !== "pnpm" ? null
    : pnpmWorkspaceText === null ? Object.freeze({ patterns: Object.freeze([]), error: null })
      : pnpmWorkspacePatterns(pnpmWorkspaceText);

  let recorded;
  const lockFacts = () => {
    if (recorded === undefined) {
      const lockText = selected === null ? null : read(selected.name);
      recorded = lockText === null ? null
        : selected.manager === "pnpm" ? pnpmLockFacts(lockText) : npmLockFacts(lockText);
    }
    return recorded;
  };
  return Object.freeze({
    project,
    manifest,
    manager,
    lockless,
    lock: selected?.name ?? null,
    install: lockless ? "npm install" : selected?.install ??
      NPM_LOCKS.find((entry) => entry.manager === manager)?.install ?? null,
    ambiguous: Object.freeze(ambiguous),
    patterns: pnpm === null ? manifest.workspaces : pnpm.patterns,

    inputs: Object.freeze([...(selected === null ? ambiguous : [selected.name]),
      ...(lockless ? [NPM_CONFIG] : []),
      ...(pnpm === null || pnpmWorkspaceText === null ? [] : [PNPM_WORKSPACE])]),
    get lockedDirectories() {
      return Object.freeze((lockFacts()?.directories ?? []).map((directory) => at(project, directory)));
    },
    get localCopies() { return lockFacts()?.localCopies ?? Object.freeze([]); },

    get errors() {
      return Object.freeze([
        ...(pnpm?.error ? [{ file: at(project, PNPM_WORKSPACE), error: pnpm.error }] : []),
        ...(lockFacts()?.error ? [{ file: at(project, selected.name), error: lockFacts().error }] : [])]);
    }
  });
}

export function directoryReader(root) {
  return (relative) => {
    try {
      return readFileSync(path.join(root, relative), "utf8");
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      const input = path.join(root, relative);
      const action = `make ${input} readable to the user that runs setup, then rerun setup`;
      throw new TestRuntimeSetupError("test_runtime_dependency_input_inaccessible",
        `${input} cannot be read (${error.code}): ${error.message}`, {
          condition: "a dependency input cannot be read", input, errno: error.code, cause: error.message,
          effects: "no usable runtime was published by this detection", uncertainty: "the input's contents",
          action: { actor: "operator", statement: action }, correction: action
        });
    }
  };
}

export function runnerDeclaringPackage(facts, runner) {
  const owners = [...facts].filter(([, manifest]) => manifest.runners.includes(runner)).map(([owner]) => owner);
  return owners.includes(".") ? "." : owners.sort()[0] ?? ".";
}

export function enclosingPackage(members, relative) {
  return [...members].filter((member) => relative === member || relative.startsWith(`${member}/`))
    .sort((left, right) => right.length - left.length)[0] ?? ".";
}
