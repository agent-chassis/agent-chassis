

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const SKIPPED_DIRECTORIES = Object.freeze([
  ".git", ".agent-launch", ".agent-runs", ".cache", ".venv", "venv", "__pycache__",
  "node_modules", "vendor", "target", "dist", "build", "coverage"
]);

export const MANIFEST_SEARCH_DEPTH = 3;

const MANIFEST_EVIDENCE = Object.freeze([
  Object.freeze({ manifest: "go.mod", ecosystem: "go_modules", language: "go" }),
  Object.freeze({ manifest: "Cargo.toml", ecosystem: "cargo", language: "rust" }),
  Object.freeze({ manifest: "deno.json", ecosystem: "deno", language: "typescript" }),
  Object.freeze({ manifest: "deno.jsonc", ecosystem: "deno", language: "typescript" }),
  Object.freeze({ manifest: "package.json", ecosystem: "npm", language: "javascript",
    narrow: narrowNpmRunners }),
  Object.freeze({ manifest: "pyproject.toml", ecosystem: "python", language: "python",
    narrow: narrowPythonRunners }),
  Object.freeze({ manifest: "requirements.txt", ecosystem: "python", language: "python",
    narrow: narrowPythonRunners }),
  Object.freeze({ manifest: "test-requirements.txt", ecosystem: "python", language: "python",
    narrow: narrowPythonRunners }),
  Object.freeze({ manifest: "requirements-dev.txt", ecosystem: "python", language: "python",
    narrow: narrowPythonRunners })
]);

export const MANIFEST_NAMES = Object.freeze([
  ...new Set(MANIFEST_EVIDENCE.map(({ manifest }) => manifest))]);

const NPM_RUNNER_PACKAGES = Object.freeze({ jest: "jest", vitest: "vitest", mocha: "mocha",
  ava: "ava", lib0: "lib0-testing" });
const NODE_TEST_SCRIPT = /\bnode\b[^\n]*--test|node:test/u;
const PYTHON_RUNNER_PACKAGES = Object.freeze({ pytest: "pytest", stestr: "stestr" });

function narrowNpmRunners(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return null;
  }
  if (manifest === null || typeof manifest !== "object") return null;
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {})]);
  const identified = [...new Set(Object.entries(NPM_RUNNER_PACKAGES)
    .filter(([packageName]) => declared.has(packageName)).map(([, runner]) => runner))];
  if (identified.length > 0) return identified.sort();
  const script = manifest.scripts?.test;
  return typeof script === "string" && NODE_TEST_SCRIPT.test(script) ? ["node-test"] : null;
}

function narrowPythonRunners(text) {
  const identified = Object.entries(PYTHON_RUNNER_PACKAGES)
    .filter(([packageName]) => new RegExp(`(^|[^\\w-])${packageName}([^\\w-]|$)`, "mu").test(text))
    .map(([, runner]) => runner);
  return identified.length > 0 ? [...new Set(identified)].sort() : null;
}

export function collectRepositoryManifests(root, { depth = MANIFEST_SEARCH_DEPTH } = {}) {
  const skipped = new Set(SKIPPED_DIRECTORIES);
  const names = new Set(MANIFEST_NAMES);
  const found = [];
  const walk = (directory, relative, remaining) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory()) {
        if (remaining === 0 || skipped.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(path.join(directory, entry.name),
          relative === "." ? entry.name : `${relative}/${entry.name}`, remaining - 1);
      } else if (entry.isFile() && names.has(entry.name)) {
        found.push(relative === "." ? entry.name : `${relative}/${entry.name}`);
      }
    }
  };
  try {
    if (!statSync(root).isDirectory()) return found;
  } catch {
    return found;
  }
  walk(root, ".", depth);
  return found;
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

export function discoverRuntimeProjects({ manifests, runners, readFile }) {
  const byProject = new Map();
  for (const relative of [...manifests].sort()) {
    const name = path.posix.basename(relative);
    const evidence = MANIFEST_EVIDENCE.find((candidate) => candidate.manifest === name);
    if (evidence === undefined) continue;
    const directory = path.posix.dirname(relative);
    const project = directory === "." ? "." : directory;
    const key = `${project}\0${evidence.ecosystem}`;
    const existing = byProject.get(key);
    const found = existing ?? { project, language: evidence.language,
      ecosystem: evidence.ecosystem, evidence: [], identified: [] };
    found.evidence.push(relative);
    const text = evidence.narrow === undefined ? null : readFile(relative);
    const narrowed = evidence.narrow === undefined || text === null ? null : evidence.narrow(text);
    if (narrowed !== null) found.identified.push(...narrowed);
    byProject.set(key, found);
  }
  const discovered = [];
  for (const found of byProject.values()) {
    const available = runners.filter(({ dependency_ecosystem: ecosystem }) =>
      ecosystem === found.ecosystem).map(({ name }) => name).sort();
    if (available.length === 0) continue;
    const identified = [...new Set(found.identified)].filter((name) => available.includes(name)).sort();
    discovered.push(Object.freeze({
      project: found.project,
      language: found.language,
      ecosystem: found.ecosystem,
      evidence: Object.freeze([...found.evidence]),

      runners: Object.freeze(identified.length > 0 ? identified : available),
      identified: identified.length > 0 || available.length === 1
    }));
  }
  return discovered.sort((left, right) => `${left.project}\0${left.ecosystem}`
    .localeCompare(`${right.project}\0${right.ecosystem}`));
}

export function runtimeSelectionCandidates(discovered, { language = null, runners = [] } = {}) {
  const byName = new Map(runners.map((runner) => [runner.name, runner]));
  const candidates = [];
  for (const project of discovered) {
    if (language !== null && !project.runners.some((name) =>
      (byName.get(name)?.languages ?? []).includes(language))) continue;
    for (const name of project.runners) {
      if (language !== null && !(byName.get(name)?.languages ?? []).includes(language)) continue;
      candidates.push(Object.freeze({ runner: name, project: project.project,
        language: project.language, evidence: project.evidence,
        identified: project.identified }));
    }
  }
  return candidates;
}

export function chooseRuntimeSelection({ explicit = [], saved = null, discovered = [],
  language = null, runners = [] } = {}) {
  if (explicit.length > 0) {
    return { status: "resolved", source: "command line", selection: explicit };
  }
  if (saved !== null && saved.length > 0) {
    return { status: "resolved", source: "saved repository configuration", selection: saved };
  }
  const candidates = runtimeSelectionCandidates(discovered, { language, runners });
  if (candidates.length === 0) return { status: "none", language };
  const settled = candidates.length === 1 && candidates[0].identified;
  if (settled) {
    return { status: "resolved", source: `repository evidence (${candidates[0].evidence.join(", ")})`,
      selection: [{ runner: candidates[0].runner, project: candidates[0].project }],
      discovered: candidates[0] };
  }
  return { status: "ambiguous", candidates };
}
