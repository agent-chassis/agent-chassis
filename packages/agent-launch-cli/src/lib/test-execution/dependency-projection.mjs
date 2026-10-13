

import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync,
  statSync, symlinkSync, readdirSync } from "node:fs";
import path from "node:path";

import { inspectDependencyMountpoint } from "../dependency-mountpoint-occupant.mjs";
import { NPM_POPULATION_EXCLUDE, npmInstallationTrees, workingCopyTree } from
  "../test-runtime-setup/npm-installation.mjs";
import { selectNpmDependencyTree } from "./current-runtime.mjs";

export const DEPENDENCY_PROJECTION_CONFLICT_CODE = "test_runtime_dependency_projection_conflict";
export const SELECTED_SOURCE_UNAVAILABLE_CODE = "test_runtime_selected_source_unavailable";

function projectionError(destination, installation, occupant, mismatch) {
  const absent = occupant.state === "absent";
  const message = absent
    ? `npm dependency projection at ${destination} could not be published for selected installation ${installation}`
    : `npm dependency projection at ${destination} conflicts with the selected installation ${installation}`;
  return Object.assign(new Error(message), {
    code: DEPENDENCY_PROJECTION_CONFLICT_CODE,
    detail: { destination, selected_installation: installation, occupant, mismatch,
      correction: absent
        ? `ensure the checkout parent ${path.dirname(destination)} exists and is writable, then rerun the selected test capability`
        : `the checkout owner must stop consumers of this checkout, remove only the identified stale ` +
          `node_modules entry at ${destination}, then rerun the selected test capability` }
  });
}

function occupantDescription(destination) {
  const state = inspectDependencyMountpoint(destination);
  if (state.state === "absent") return { state: state.state };
  if (state.state === "empty_directory") return { state: state.state, identity: state.identity };
  try {
    const target = readlinkSync(destination);
    return { state: state.state, kind: "symlink", target };
  } catch {
    return { state: state.state, kind: state.kind };
  }
}

function expectedLayout(copy) {
  return {
    directories: copy.directories.map((directory) => path.relative(copy.modules, directory)).sort(),
    links: copy.links.map(({ path: linkPath, target }) => ({
      name: path.relative(copy.modules, linkPath), target
    })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

function matchesPublishedWorkspace(copy) {
  const { modules: destination, installed: installation } = copy;
  let generation;
  try { generation = realpathSync(destination); } catch { return { matches: false, actual: null }; }
  const parent = path.dirname(destination);
  const prefix = `${path.basename(destination)}.portfolio-test-`;
  if (path.dirname(generation) !== parent || !path.basename(generation).startsWith(prefix)) {
    return { matches: false, actual: { generation } };
  }
  const modules = generation;
  const expected = expectedLayout(copy);
  const expectedNames = new Set(expected.links.map(({ name }) => name));
  const scopes = new Set(expected.directories.filter((name) => name !== "")
    .map((name) => name.split(path.sep)[0]));
  try {
    for (const scope of scopes) {
      const scopePath = path.join(modules, scope);
      try {
        if (!lstatSync(scopePath).isDirectory()) return { matches: false, actual: { generation, mismatch: scope } };
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
        return { matches: false, actual: { generation, mismatch: scope, errno: error.code, path: scopePath } };
      }
      const expectedScoped = [...expectedNames].filter((name) => name.startsWith(`${scope}${path.sep}`))
        .map((name) => name.slice(scope.length + 1)).sort();
      const actualScoped = readdirSync(scopePath).sort();
      if (actualScoped.length !== expectedScoped.length ||
          actualScoped.some((name, index) => name !== expectedScoped[index])) {
        return { matches: false, actual: { generation, mismatch: scope, entries: actualScoped } };
      }
    }

    const generated = (name) => NPM_POPULATION_EXCLUDE.includes(name) &&
      lstatSync(path.join(modules, name)).isDirectory();
    const actualTop = new Set(readdirSync(modules).filter((name) => !generated(name)));
    const expectedTop = new Set([...expectedNames].map((name) => name.split(path.sep)[0]).concat([...scopes]));
    if (actualTop.size !== expectedTop.size || [...actualTop].some((name) => !expectedTop.has(name))) {
      return { matches: false, actual: { generation, entries: [...actualTop].sort() } };
    }
    for (const entry of expected.links) {
      const actualTarget = readlinkSync(path.join(modules, entry.name));
      if (actualTarget !== entry.target) return { matches: false,
        actual: { generation, mismatch: entry.name, target: actualTarget } };
    }
    return { matches: true, generation, installation };
  } catch (error) {
    return { matches: false, actual: { generation, errno: error?.code ?? null, path: error?.path ?? null } };
  }
}

function verifyTree(copy) {
  const { modules: destination, installed: installation } = copy;
  const occupant = occupantDescription(destination);
  if (occupant.state === "absent") return Object.freeze({ status: "absent", destination, installation, occupant });
  const conflict = (mismatch) => Object.freeze({ status: "conflict", destination, installation, occupant, mismatch });
  try {
    if (realpathSync(destination) === realpathSync(installation)) {
      return Object.freeze({ status: "verified", destination, installation });
    }
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
  }
  if (copy.rebased && occupant.state === "occupied" && occupant.kind === "symlink") {
    const verified = matchesPublishedWorkspace(copy);
    return verified.matches
      ? Object.freeze({ status: "verified", destination, installation, generation: verified.generation })
      : conflict(verified.actual);
  }
  return conflict({ expected: copy.rebased ? "equivalent workspace projection" : installation });
}

function requiredTrees(dependency, projectHostDir) {
  return npmInstallationTrees(dependency).map((tree) => workingCopyTree(tree, projectHostDir))
    .filter(({ owner, modules }) => {
      if (owner === ".") return true;
      try { return statSync(path.dirname(modules)).isDirectory(); } catch { return false; }
    });
}

function memberLayout(trees) {
  return trees.some(({ owner }) => owner !== ".") ? { trees: Object.freeze(trees) } : {};
}

export function verifyNpmDependencyProjection({ dependency, projectHostDir }) {
  if (dependency?.status !== "present") return Object.freeze({ status: "unselected" });
  const trees = requiredTrees(dependency, projectHostDir).map((copy) =>
    Object.freeze({ owner: copy.owner, ...verifyTree(copy) }));
  if (trees.length === 0) return Object.freeze({ status: "unselected" });
  const { owner: _owner, ...deciding } = trees.find(({ status }) => status === "conflict") ??
    trees.find(({ status }) => status === "absent") ?? trees[0];
  return Object.freeze({ ...deciding, ...memberLayout(trees) });
}

export function verifiedNpmDependencyMappings({ repositoryRoot, checkoutRoot }) {
  return (directory) => {
    const destination = path.join(directory, "node_modules");
    const relative = path.relative(checkoutRoot, directory).split(path.sep).join("/") || ".";
    let stat;
    try {
      stat = lstatSync(destination);
    } catch {
      return [];
    }

    if (!stat.isSymbolicLink() && (!stat.isDirectory() || relative.split("/").includes("node_modules"))) return [];
    const selected = selectNpmDependencyTree({ repositoryRoot, checkoutRoot, directory: relative });
    if (selected === null) return [];
    const projectHostDir = selected.project === "." ? checkoutRoot : path.join(checkoutRoot, selected.project);
    const verified = verifyTree(workingCopyTree(selected.tree, projectHostDir));
    if (verified.status !== "verified") return [];
    return verified.generation === undefined ? [destination] : [destination, verified.generation];
  };
}

function runGitIn(checkout, args) {
  const result = spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8", env: process.env,
    maxBuffer: 16 * 1024 * 1024 });
  return { status: result.error ? null : result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "",
    error: result.error ?? null };
}

export const DEPENDENCY_EXCLUSION_FAILED_CODE = "test_runtime_dependency_exclusion_failed";

export function excludeNpmDependencyProjection({ checkoutRoot, projection, runGit = runGitIn }) {
  const created = (projection === null ? [] : projection.trees ?? [projection])
    .filter(({ reused }) => reused === false);
  if (created.length === 0) return Object.freeze([]);
  const checkout = realpathSync(checkoutRoot);
  const destinations = created.map(({ destination }) => destination);
  const refuse = (message, cause, known = {}) => {
    throw Object.assign(new Error(`${message} for the dependency mapping at ${destinations.join(", ")}`), {
      code: DEPENDENCY_EXCLUSION_FAILED_CODE,
      detail: { checkout, destination: destinations[0], destinations, lines: known.lines ?? null,
        exclusion_file: known.file ?? null, cause,
        correction: "repair the named cause, or add the named lines to the repository's Git info/exclude " +
          "yourself, then rerun the selected test capability" } });
  };

  const ask = (args, answers, known) => {
    const result = runGit(checkout, args);
    if (result.status === null || !answers.includes(result.status)) {
      refuse(`git ${args.join(" ")} failed`, { args, status: result.status,
        stderr: (result.stderr ?? "").trim().slice(-4096), errno: result.error?.code ?? null }, known);
    }
    return result;
  };

  const top = runGit(checkout, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    if (top.status === 128 && /not a git repository/iu.test(top.stderr ?? "")) return Object.freeze([]);
    refuse("git rev-parse --show-toplevel failed", { args: ["rev-parse", "--show-toplevel"], status: top.status,
      stderr: (top.stderr ?? "").trim().slice(-4096), errno: top.error?.code ?? null });
  }
  if (top.stdout.trim() !== checkout) return Object.freeze([]);
  const lines = [];
  for (const [absolute, suffix] of created.flatMap(({ destination, generation = null }) =>
    [[destination, ""], [generation, "/"]])) {
    if (absolute === null) continue;
    const relative = path.relative(checkout, absolute).split(path.sep).join("/");
    if (relative === "" || relative.startsWith("../") || path.isAbsolute(relative)) continue;
    if (ask(["ls-files", "-z", "--", relative], [0]).stdout.length > 0) continue;

    if (ask(["check-ignore", "-q", "--", `${relative}${suffix}`], [0, 1]).status === 0) continue;
    lines.push(`/${relative}${suffix}`);
  }
  if (lines.length === 0) return Object.freeze([]);
  const file = ask(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], [0], { lines })
    .stdout.trim();
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      refuse("the Git exclude file cannot be read", { errno: error?.code ?? null }, { lines, file });
    }
  }
  const present = new Set(text.split("\n").map((line) => line.trim()));
  const added = lines.filter((line) => !present.has(line));
  if (added.length === 0) return Object.freeze([]);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${text === "" || text.endsWith("\n") ? "" : "\n"}${added.join("\n")}\n`);
  } catch (error) {
    refuse("the Git exclude file cannot be written", { errno: error?.code ?? null }, { lines: added, file });
  }
  return Object.freeze(added);
}

function publishTree(copy) {
  const { modules: destination, installed: installation } = copy;
  if (!copy.rebased) {
    try {
      symlinkSync(installation, destination, "dir");
      return { destination, installation, reused: false };
    } catch (error) {
      if (error?.code !== "EEXIST") throw projectionError(destination, installation,
        occupantDescription(destination), { publish_errno: error?.code ?? null });
      const current = occupantDescription(destination);
      if (current.kind === "symlink") {
        try {
          if (realpathSync(destination) === realpathSync(installation)) {
            return { destination, installation, reused: true };
          }
        } catch (resolveError) {
          if (resolveError?.code !== "ENOENT" && resolveError?.code !== "ENOTDIR") throw resolveError;
        }
      }
      throw projectionError(destination, installation, current, { expected: installation });
    }
  }
  const generation = path.join(path.dirname(destination), `${path.basename(destination)}.portfolio-test-`);
  let temporary = null;
  try {
    temporary = mkdtempSync(generation);
    for (const directory of copy.directories) {
      mkdirSync(path.join(temporary, path.relative(destination, directory)), { recursive: true });
    }
    for (const link of copy.links) {
      const projectedPath = path.join(temporary, path.relative(destination, link.path));
      mkdirSync(path.dirname(projectedPath), { recursive: true });
      symlinkSync(link.target, projectedPath);
    }
    try {
      symlinkSync(temporary, destination, "dir");
      temporary = null;
      return { destination, installation, generation: realpathSync(destination), reused: false };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = occupantDescription(destination);
      if (current.kind === "symlink") {
        const verified = matchesPublishedWorkspace(copy);
        if (verified.matches) {
          rmSync(temporary, { recursive: true, force: true });
          temporary = null;
          return { destination, installation, generation: verified.generation, reused: true };
        }
        throw projectionError(destination, installation, current, verified.actual);
      }
      throw projectionError(destination, installation, current, { expected: "equivalent workspace projection" });
    }
  } catch (error) {
    if (temporary !== null) rmSync(temporary, { recursive: true, force: true });
    if (error?.code === DEPENDENCY_PROJECTION_CONFLICT_CODE) throw error;
    throw projectionError(destination, installation, occupantDescription(destination),
      { construction_path: temporary, errno: error?.code ?? null, message: error?.message ?? String(error) });
  }
}

function missingSources(copy) {
  return copy.sources.filter(({ path: directory }) => {
    try { return !statSync(directory).isDirectory(); } catch { return true; }
  });
}

export function ensureNpmDependencyProjection({ dependency, projectHostDir }) {
  if (dependency?.status !== "present") return null;
  const planned = requiredTrees(dependency, projectHostDir).map((copy) => ({ copy, incumbent: verifyTree(copy) }));
  if (planned.length === 0) return null;
  const conflicting = planned.find(({ incumbent }) => incumbent.status === "conflict");
  if (conflicting !== undefined) {
    const { destination, installation, occupant, mismatch } = conflicting.incumbent;
    throw projectionError(destination, installation, occupant, mismatch);
  }
  for (const { copy, incumbent } of planned) {
    const missing = incumbent.status === "absent" ? missingSources(copy) : [];
    if (missing.length === 0) continue;
    throw Object.assign(new Error(`npm dependency projection at ${copy.modules} links ` +
      `${missing.map(({ package: name }) => name).join(", ")} to source this checkout does not hold`), {
      code: SELECTED_SOURCE_UNAVAILABLE_CODE,
      detail: { destination: copy.modules, selected_installation: copy.installed, missing_sources: missing,
        condition: "an installed link names local source that the tree being tested does not contain",
        input: missing.map(({ path: directory }) => directory),
        cause: "the directory does not exist in the selected checkout",
        effects: "nothing was published; no test ran, and source of another checkout was not substituted",
        uncertainty: "none beyond the named cause",
        action: { actor: "checkout owner", statement: "restore the named directories in this checkout, or " +
          "reinstall the project's dependencies for the packages it now declares, then rerun the selected test " +
          "capability" } }
    });
  }
  const settled = [];
  for (const [index, { copy, incumbent }] of planned.entries()) {
    if (incumbent.status === "verified") {
      settled.push(Object.freeze({ owner: copy.owner, destination: incumbent.destination,
        installation: incumbent.installation,
        ...(incumbent.generation === undefined ? {} : { generation: incumbent.generation }), reused: true }));
      continue;
    }
    try {
      settled.push(Object.freeze({ owner: copy.owner, ...publishTree(copy) }));
    } catch (error) {
      if (error?.code !== DEPENDENCY_PROJECTION_CONFLICT_CODE) throw error;
      const published = settled.filter(({ reused }) => !reused);
      error.message = settled.length === 0 ? error.message
        : `${error.message}; the dependency layout of ${projectHostDir} is incomplete`;
      error.detail = { ...error.detail, layout: { complete: false,
        published: published.map(({ destination }) => destination),
        reused: settled.filter(({ reused }) => reused).map(({ destination }) => destination),
        unpublished: planned.slice(index).map(({ copy: pending }) => pending.modules),
        retry: "published and reused destinations are kept and verified again by the next run" } };
      Object.defineProperty(error, "published", { value: Object.freeze(published), enumerable: false });
      throw error;
    }
  }
  const [first] = settled;
  const { owner: _owner, ...own } = first;
  return Object.freeze({ ...own, reused: settled.every(({ reused }) => reused), ...memberLayout(settled) });
}
