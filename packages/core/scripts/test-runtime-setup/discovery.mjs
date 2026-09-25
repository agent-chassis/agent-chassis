

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const SKIPPED_DIRECTORIES = Object.freeze([
  ".git", ".agent-launch", ".agent-runs", ".cache", ".venv", "venv", "__pycache__",
  "node_modules", "vendor", "target", "dist", "build", "coverage"
]);

export const MANIFEST_SEARCH_DEPTH = 3;

export const FIXTURE_DIRECTORY_NAMES = Object.freeze([
  "fixtures", "__fixtures__", "test-fixtures", "testdata", "examples", "example"
]);

export const EXCLUSION_REASONS = Object.freeze({
  IGNORED: "ignored_by_repository",
  FIXTURE: "test_fixture_or_example",
  COVERED: "covered_by_enclosing_environment",
  NO_INPUTS: "no_dependency_inputs"
});

const MANIFEST_EVIDENCE = Object.freeze([
  Object.freeze({ manifest: "go.mod", ecosystem: "go_modules", language: "go" }),
  Object.freeze({ manifest: "Cargo.toml", ecosystem: "cargo", language: "rust" }),
  Object.freeze({ manifest: "deno.json", ecosystem: "deno", language: "typescript" }),
  Object.freeze({ manifest: "deno.jsonc", ecosystem: "deno", language: "typescript" }),
  Object.freeze({ manifest: "package.json", ecosystem: "npm", language: "javascript" }),
  Object.freeze({ manifest: "pyproject.toml", ecosystem: "python", language: "python" }),
  Object.freeze({ manifest: "requirements.txt", ecosystem: "python", language: "python" }),
  Object.freeze({ manifest: "test-requirements.txt", ecosystem: "python", language: "python" }),
  Object.freeze({ manifest: "requirements-dev.txt", ecosystem: "python", language: "python" })
]);

export const MANIFEST_NAMES = Object.freeze([
  ...new Set(MANIFEST_EVIDENCE.map(({ manifest }) => manifest))]);

const PYTHON_REQUIREMENT_FILES = Object.freeze(
  ["requirements.txt", "test-requirements.txt", "requirements-dev.txt"]);

const NPM_RUNNER_PACKAGES = Object.freeze({ jest: "jest", vitest: "vitest", mocha: "mocha",
  ava: "ava", lib0: "lib0-testing" });
const PYTHON_RUNNER_PACKAGES = Object.freeze({ pytest: "pytest", stestr: "stestr" });
const PACKAGE_SUPPLIED_RUNNERS = new Set([...Object.values(NPM_RUNNER_PACKAGES),
  ...Object.values(PYTHON_RUNNER_PACKAGES)]);
const NPM_DEPENDENCY_FIELDS = Object.freeze(["dependencies", "devDependencies",
  "optionalDependencies", "peerDependencies"]);

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function npmFacts(text) {
  const manifest = text === null ? null : parseJson(text);

  const optionalPeers = new Set(Object.entries(manifest?.peerDependenciesMeta ?? {})
    .filter(([, meta]) => meta?.optional === true).map(([name]) => name));
  const declared = new Set(NPM_DEPENDENCY_FIELDS.flatMap((field) =>
    Object.keys(manifest?.[field] ?? {}).filter((name) =>
      field !== "peerDependencies" || !optionalPeers.has(name))));
  const workspaces = Array.isArray(manifest?.workspaces) ? manifest.workspaces
    : Array.isArray(manifest?.workspaces?.packages) ? manifest.workspaces.packages : [];
  return {
    declaresDependencies: declared.size > 0,
    runners: Object.entries(NPM_RUNNER_PACKAGES).filter(([name]) => declared.has(name))
      .map(([, runner]) => runner),
    workspaces: workspaces.filter((pattern) => typeof pattern === "string")
  };
}

function pythonRunners(text) {
  return Object.entries(PYTHON_RUNNER_PACKAGES)
    .filter(([name]) => new RegExp(`(^|[^\\w-])${name}([^\\w-]|$)`, "mu").test(text ?? ""))
    .map(([, runner]) => runner);
}

function cargoWorkspaceMembers(text) {
  const section = /^\[workspace\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/mu.exec(text ?? "")?.[1] ?? null;
  if (section === null) return null;
  const members = /^\s*members\s*=\s*\[([\s\S]*?)\]/mu.exec(section)?.[1] ?? "";
  return [...members.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
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

function membersOf(project, patterns, candidates) {
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

function lockedWorkspaceDirectories(project, readFile) {
  const lock = parseJson(readFile(project === "." ? "package-lock.json" : `${project}/package-lock.json`) ?? "");
  const keys = Object.keys(lock?.packages ?? {});
  return keys.filter((key) => key !== "" && !key.split("/").includes("node_modules") &&
    !key.split("/").some((segment) => segment === "" || segment === "." || segment === ".."))
    .map((key) => project === "." ? key : `${project}/${key}`);
}

const segmentsOf = (directory) => directory === "." ? [] : directory.split("/");
const isFixturePath = (directory) => segmentsOf(directory)
  .some((segment) => FIXTURE_DIRECTORY_NAMES.includes(segment));
const contains = (ancestor, directory) => ancestor === "." || directory === ancestor ||
  directory.startsWith(`${ancestor}/`);

function ignoredByRepository(root, relatives) {
  if (relatives.length === 0) return new Set();
  const result = spawnSync("git", ["-C", root, "check-ignore", "--stdin", "-z"], {
    input: relatives.join("\0"), encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (result.status !== 0 && result.status !== 1) return new Set();
  return new Set(result.stdout.split("\0").filter(Boolean));
}

export function collectRepositoryManifests(root, { depth = MANIFEST_SEARCH_DEPTH } = {}) {
  const skipped = new Set(SKIPPED_DIRECTORIES);
  const names = new Set(MANIFEST_NAMES);
  const found = [];
  const excluded = [];
  const walk = (directory, relative, remaining) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = relative === "." ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (remaining === 0 || skipped.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(path.join(directory, entry.name), child, remaining - 1);
      } else if (entry.isFile() && names.has(entry.name)) {
        found.push(child);
      }
    }
  };
  try {
    if (!statSync(root).isDirectory()) return { manifests: [], excluded };
  } catch {
    return { manifests: [], excluded };
  }
  walk(root, ".", depth);
  const ignored = ignoredByRepository(root, found);
  for (const relative of found) {
    if (ignored.has(relative)) excluded.push({ path: relative, reason: EXCLUSION_REASONS.IGNORED });
  }
  return { manifests: found.filter((relative) => !ignored.has(relative)),
    excluded: excluded.sort((left, right) => left.path.localeCompare(right.path)) };
}

export function repositoryManifestReader(root) {
  return (relative) => {
    try {
      return readFileSync(path.join(root, relative), "utf8");
    } catch {
      return null;
    }
  };
}

export function discoverRuntimeEnvironments({ manifests, runners, readFile }) {

  const byProject = new Map();
  for (const relative of [...manifests].sort()) {
    const evidence = MANIFEST_EVIDENCE.find(({ manifest }) => manifest === path.posix.basename(relative));
    if (evidence === undefined) continue;
    const directory = path.posix.dirname(relative);
    const key = `${evidence.ecosystem}\0${directory}`;
    const entry = byProject.get(key) ?? { ecosystem: evidence.ecosystem, language: evidence.language,
      project: directory, evidence: [], runners: [], declaresDependencies: false, workspaces: null,
      requirementFiles: false };
    const text = readFile(relative);
    entry.evidence.push(relative);
    if (evidence.ecosystem === "npm") {
      const facts = npmFacts(text);
      entry.runners.push(...facts.runners);
      entry.declaresDependencies = facts.declaresDependencies;
      if (facts.workspaces.length > 0) entry.workspaces = facts.workspaces;
    } else if (evidence.ecosystem === "python") {
      entry.runners.push(...pythonRunners(text));
      if (PYTHON_REQUIREMENT_FILES.includes(evidence.manifest)) entry.requirementFiles = true;
    } else if (evidence.ecosystem === "cargo") {
      entry.workspaces = cargoWorkspaceMembers(text);
    }
    byProject.set(key, entry);
  }
  const all = [...byProject.values()];

  const memberOf = new Map();
  for (const declarer of all.filter(({ workspaces }) => workspaces !== null && workspaces.length > 0)) {
    const walked = all.filter(({ ecosystem }) => ecosystem === declarer.ecosystem)
      .map(({ project }) => project);
    const locked = declarer.ecosystem === "npm" ? lockedWorkspaceDirectories(declarer.project, readFile) : [];
    declarer.members = membersOf(declarer.project, declarer.workspaces,
      [...new Set([...walked, ...locked])]).filter((member) => {
      const directory = declarer.project === "." ? member : `${declarer.project}/${member}`;
      if (walked.includes(directory)) return true;
      const text = readFile(`${directory}/package.json`);
      if (text === null) return false;

      const facts = npmFacts(text);
      declarer.evidence.push(`${directory}/package.json`);
      declarer.runners.push(...facts.runners);
      declarer.declaresDependencies ||= facts.declaresDependencies;
      return true;
    });
    for (const member of declarer.members) {
      const directory = declarer.project === "." ? member : `${declarer.project}/${member}`;
      memberOf.set(`${declarer.ecosystem}\0${directory}`, declarer);
    }
  }
  const environments = [];
  const excluded = [];
  const units = [];
  const owned = all.filter((entry) => memberOf.has(`${entry.ecosystem}\0${entry.project}`));
  for (const entry of owned) {
    const owner = memberOf.get(`${entry.ecosystem}\0${entry.project}`);
    owner.evidence.push(...entry.evidence);
    owner.runners.push(...entry.runners);
    owner.declaresDependencies ||= entry.declaresDependencies;
  }
  for (const entry of all.filter((candidate) => !owned.includes(candidate))) {
    if (isFixturePath(entry.project)) {
      for (const file of entry.evidence) excluded.push({ path: file, reason: EXCLUSION_REASONS.FIXTURE });
      continue;
    }
    units.push(entry);
  }
  for (const entry of units.sort((left, right) => left.project.localeCompare(right.project))) {
    if (entry.ecosystem === "npm" && entry.project !== "." && !entry.declaresDependencies &&
        entry.workspaces === null &&
        readFile(entry.project === "." ? "package-lock.json" : `${entry.project}/package-lock.json`) === null) {

      const enclosing = units.filter((unit) => unit.ecosystem === "npm" && unit !== entry &&
        contains(unit.project, entry.project)).sort((left, right) =>
        right.project.length - left.project.length)[0];
      if (enclosing !== undefined) {
        for (const file of entry.evidence) {
          excluded.push({ path: file, reason: EXCLUSION_REASONS.COVERED,
            environment: `npm@${enclosing.project}` });
        }
        continue;
      }
    }
    if (entry.ecosystem === "python" && !entry.requirementFiles && entry.runners.length === 0) {
      for (const file of entry.evidence) excluded.push({ path: file, reason: EXCLUSION_REASONS.NO_INPUTS });
      continue;
    }
    const catalog = runners.filter(({ dependency_ecosystem: ecosystem }) => ecosystem === entry.ecosystem);
    if (catalog.length === 0) continue;
    const builtIn = catalog.map(({ name }) => name).filter((name) => !PACKAGE_SUPPLIED_RUNNERS.has(name));
    const declared = [...new Set(entry.runners)].filter((name) => catalog.some((runner) => runner.name === name));
    environments.push(Object.freeze({
      id: `${entry.ecosystem}@${entry.project}`,
      ecosystem: entry.ecosystem,
      language: entry.language,
      project: entry.project,
      members: Object.freeze([...(entry.members ?? [])]),
      evidence: Object.freeze([...new Set(entry.evidence)].sort()),
      runners: Object.freeze([...new Set([...builtIn, ...declared])].sort())
    }));
  }
  return {
    environments: environments.sort((left, right) => left.id.localeCompare(right.id)),
    excluded: excluded.sort((left, right) => left.path.localeCompare(right.path))
  };
}

export function environmentsForLanguage(environments, language, runners) {
  if (language === null) return environments;
  return environments.filter((environment) => runners.some((runner) =>
    runner.dependency_ecosystem === environment.ecosystem && runner.languages.includes(language)));
}
