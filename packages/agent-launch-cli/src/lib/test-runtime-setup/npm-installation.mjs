

import { lstatSync, readdirSync, readlinkSync, realpathSync, statSync, existsSync } from "node:fs";
import path from "node:path";

import { NPM_LOCK, NPM_MANIFEST, PNPM_LOCK, directoryReader, npmManifestFacts, resolveNpmWorkspace } from
  "./npm-workspace.mjs";
import { TestRuntimeSetupError } from "./toolchains.mjs";
import { npmExecutableEntries } from "./npm-executable-entries.mjs";

export const DEPENDENCIES_MISSING = "test_runtime_dependencies_missing";
export const DEPENDENCY_INPUT_INACCESSIBLE = "test_runtime_dependency_input_inaccessible";
export const ENVIRONMENT_AMBIGUOUS = "test_runtime_environment_ambiguous";
export const MANIFEST_INVALID = "test_runtime_manifest_invalid";

export const NPM_POPULATION_EXCLUDE = Object.freeze([".cache", ".vite", ".vite-temp"]);

const NOT_THERE = new Set(["ENOENT", "ENOTDIR"]);
const within = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
const posix = (relative) => relative.split(path.sep).join("/");
const treeDirectory = (projectDir, owner) => owner === "." ? projectDir : path.join(projectDir, owner);

function fail(code, message, { condition, input, cause, effects, uncertainty = "none beyond the named cause",
  action, actor = "operator", ...detail }) {
  throw new TestRuntimeSetupError(code, message, { ...detail, condition, input, cause,
    effects: effects ?? "setup published no usable runtime; nothing was installed, changed or removed",
    uncertainty, action: Object.freeze({ actor, statement: action }), correction: action });
}

export function npmInstallationTrees(dependency) {
  if (dependency?.status !== "present") return [];
  const tree = (owner, { dir, workspace_links: workspace, local_links: local }) =>
    Object.freeze({ owner, dir, workspace_links: workspace, local_links: local });
  return [
    ...(typeof dependency.dir === "string" ? [tree(".", dependency)] : []),
    ...dependency.member_trees.map((entry) => tree(entry.member, entry))
  ];
}

export function resolveInstalledPackage(trees, fromOwner, name) {
  const searched = [];
  for (let owner = fromOwner; ; owner = path.posix.dirname(owner)) {
    const tree = trees.find((entry) => entry.owner === owner);
    if (tree !== undefined) {
      const candidate = path.join(tree.dir, name);
      searched.push(candidate);
      let present = true;
      try {
        lstatSync(candidate);
      } catch (error) {
        if (!NOT_THERE.has(error?.code)) return { status: "inaccessible", path: candidate, errno: error?.code ?? null };
        present = false;
      }
      if (present) {
        try {
          statSync(candidate);
        } catch (error) {
          if (!NOT_THERE.has(error?.code)) {
            return { status: "inaccessible", path: candidate, errno: error?.code ?? null };
          }
          let target = null;
          try { target = readlinkSync(candidate); } catch { target = null; }
          return { status: "broken", path: candidate, target };
        }
        return { status: "found", tree, dir: candidate };
      }
    }
    if (owner === ".") return { status: "missing", searched };
  }
}

function nodeModulesEntries(nodeModules) {
  const entries = [];
  for (const name of readdirSync(nodeModules).sort()) {
    if (name.startsWith(".")) continue;
    const absolute = path.join(nodeModules, name);
    if (name.startsWith("@") && lstatSync(absolute).isDirectory()) {
      for (const scoped of readdirSync(absolute).sort()) {
        entries.push({ name: `${name}/${scoped}`, absolute: path.join(absolute, scoped) });
      }
    } else {
      entries.push({ name, absolute });
    }
  }
  return entries;
}

export function classifyTreeEntries({ modules, treeDir, treeDirs, projectDir, projectReal, members, localCopies }) {
  const copies = new Map(localCopies.map(({ package: name, directory }) => [name, directory]));
  return nodeModulesEntries(treeDir).map(({ name, absolute }) => {
    if (!lstatSync(absolute).isSymbolicLink()) {
      return copies.has(name) ? { name, absolute, class: "local", directory: copies.get(name), copy: true }
        : { name, absolute, class: "installed" };
    }
    const target = readlinkSync(absolute);

    const declared = path.isAbsolute(target) ? null
      : posix(path.relative(projectDir, path.resolve(path.dirname(path.join(modules, name)), target)));
    if (declared !== null && members.includes(declared)) return { name, absolute, class: "workspace", member: declared };
    let real;
    try {
      real = realpathSync(absolute);
    } catch (error) {
      return { name, absolute, class: "broken", target, errno: error?.code ?? null };
    }
    if (treeDirs.some((dir) => within(dir, real))) return { name, absolute, class: "installed", real };
    if (!within(projectReal, real)) return { name, absolute, class: "external", real };
    const directory = posix(path.relative(projectReal, real)) || ".";

    if (directory.split("/").includes("node_modules")) return { name, absolute, class: "installed", real };
    return members.includes(directory) ? { name, absolute, class: "workspace", member: directory, real }
      : { name, absolute, class: "local", directory, real };
  });
}

export function locateNpmInstallation({ projectDir, members }) {
  const located = [];
  const issues = [];
  for (const owner of [".", ...members]) {
    const modules = path.join(treeDirectory(projectDir, owner), "node_modules");
    try {

      const dir = realpathSync(modules);
      if (statSync(dir).isDirectory()) located.push({ owner, modules, dir });
    } catch (error) {
      if (!NOT_THERE.has(error?.code)) {
        issues.push({ kind: "inaccessible", owner, path: modules, errno: error?.code ?? null });
        continue;
      }
      let target = null;
      try { target = readlinkSync(modules); } catch { continue; }
      issues.push({ kind: "broken", owner, path: modules, target });
    }
  }
  if (located.length === 0) return { absent: true, issues };
  let projectReal = projectDir;
  try { projectReal = realpathSync(projectDir); } catch { projectReal = projectDir; }
  const workspace = resolveNpmWorkspace(".", directoryReader(projectDir));
  const treeDirs = located.map(({ dir }) => dir);
  const trees = [];
  for (const { owner, modules, dir } of located) {
    let entries;
    try {
      entries = classifyTreeEntries({ modules, treeDir: dir, treeDirs, projectDir, projectReal, members,
        localCopies: workspace.localCopies.filter((copy) => copy.owner === owner) });
    } catch (error) {
      issues.push({ kind: "inaccessible", owner, path: error?.path ?? dir, errno: error?.code ?? null });
      continue;
    }
    trees.push({ owner, dir,
      workspace_links: entries.filter((entry) => entry.class === "workspace")
        .map(({ name, member }) => Object.freeze({ package: name, member })),
      local_links: entries.filter((entry) => entry.class === "local")
        .map(({ name, directory, copy }) => Object.freeze({ package: name, directory,
          ...(copy === true ? { copy: true } : {}) })) });
  }
  if (trees.length === 0) return { absent: true, issues };
  const root = trees.find(({ owner }) => owner === ".") ?? null;
  const dirs = [...new Set(trees.map(({ dir }) => dir))].sort();
  return {
    source: root === null ? "member_node_modules" : "project_node_modules",
    dir: root?.dir ?? null,
    workspace_links: root?.workspace_links ?? [],
    local_links: root?.local_links ?? [],
    member_trees: trees.filter(({ owner }) => owner !== ".").map(({ owner, dir, workspace_links: workspace,
      local_links: local }) => Object.freeze({ member: owner, dir, workspace_links: workspace, local_links: local })),

    population: dirs.filter((dir) => !dirs.some((other) => other !== dir && within(other, dir))),
    exclude: [...NPM_POPULATION_EXCLUDE],
    issues
  };
}

export function npmPreparationFields(located) {
  return { workspace_links: located.workspace_links, local_links: located.local_links,
    member_trees: located.member_trees };
}

export function workingCopyTree(tree, workProjectDir) {
  const modules = path.join(treeDirectory(workProjectDir, tree.owner), "node_modules");
  const source = new Map([
    ...tree.workspace_links.map(({ package: name, member }) => [name, member]),
    ...tree.local_links.map(({ package: name, directory }) => [name, directory])]);
  if (source.size === 0) {
    return { owner: tree.owner, modules, installed: tree.dir, rebased: false, directories: [],
      links: [{ path: modules, target: tree.dir }], sources: [] };
  }
  const entries = nodeModulesEntries(tree.dir);
  const scopes = [...new Set(entries.map(({ name }) => name.includes("/") ? name.split("/")[0] : null)
    .filter(Boolean))];
  const rebase = (directory) => treeDirectory(workProjectDir, directory);
  const sources = [...source].map(([name, directory]) => ({ package: name, directory, path: rebase(directory) }));
  const executables = npmExecutableEntries(tree, modules, sources);

  const store = path.join(tree.dir, ".pnpm");
  const storeLinks = [];
  try {
    lstatSync(store);
    storeLinks.push({ path: path.join(modules, ".pnpm"), target: store });
  } catch (error) {
    if (!NOT_THERE.has(error?.code)) throw error;
  }
  return {
    owner: tree.owner, modules, installed: tree.dir, rebased: true,
    directories: [modules, ...scopes.map((scope) => path.join(modules, scope)), ...executables.directories],
    links: entries.map(({ name, absolute }) => ({ path: path.join(modules, name),
      target: source.has(name) ? rebase(source.get(name)) : absolute })).concat(storeLinks, executables.links),
    writes: executables.writes,

    sources
  };
}

function installAction(workspace, projectDir) {
  return workspace.install === null
    ? `install the project's dependencies in ${projectDir} with its own package manager, then rerun setup`
    : `install the project's locked dependencies with its own package manager (for example \`${workspace.install}\` ` +
      `in ${projectDir}), then rerun setup`;
}

function describeIssue({ kind, path: input, errno, target }) {
  return kind === "broken" ? `${input} links ${target}, which does not exist` : `${input} cannot be read (${errno})`;
}

export const NPM_ECOSYSTEM = Object.freeze({
  name: "npm",
  toolchains: Object.freeze(["node"]),

  projectCommands: Object.freeze({}),

  manifests(projectDir, { members = [] } = {}) {
    const manifest = path.join(projectDir, NPM_MANIFEST);
    if (!existsSync(manifest)) return { status: "none", files: {} };
    const workspace = resolveNpmWorkspace(".", directoryReader(projectDir));
    if (!workspace.manifest.valid) {
      fail(MANIFEST_INVALID, `${manifest} is not valid JSON`, { manifest, condition: "the package manifest is not a JSON object",
        input: manifest, cause: "JSON parse failure", action: `correct ${manifest}, then rerun setup` });
    }
    if (members.length === 0 && !workspace.manifest.declaresDependencies) {
      return { status: "none", files: { [NPM_MANIFEST]: manifest } };
    }
    const files = { [NPM_MANIFEST]: manifest,
      ...Object.fromEntries(workspace.inputs.map((name) => [name, path.join(projectDir, name)])),
      ...Object.fromEntries(members
        .map((member) => [`${member}/${NPM_MANIFEST}`, path.join(projectDir, member, NPM_MANIFEST)])
        .filter(([, file]) => existsSync(file))) };

    if (workspace.lock === null && workspace.ambiguous.length === 0) {
      return { status: "lock_missing", required: `${NPM_LOCK} or ${PNPM_LOCK}`, files };
    }
    return { status: "present", files };
  },

  locate: locateNpmInstallation,

  async detect({ projectDir, project, members, complete = true }) {
    const located = locateNpmInstallation({ projectDir, members });
    if (!complete) return located.absent === true ? { absent: true } : located;
    const workspace = resolveNpmWorkspace(".", directoryReader(projectDir));
    const dependencyRoot = path.join(projectDir, "node_modules");
    if (workspace.ambiguous.length > 0) {
      const locks = workspace.ambiguous.map((name) => path.join(projectDir, name));
      fail(ENVIRONMENT_AMBIGUOUS, `project ${project} has ${workspace.ambiguous.join(" and ")} and nothing says ` +
        "which one its installation was made from", { project, candidates: locks,
        condition: "two package-manager locks own the same installation root", input: locks,
        cause: "package.json names no packageManager, there is no pnpm-workspace.yaml, and node_modules holds " +
          "neither or both package managers' installation metadata",
        uncertainty: "which lock the installed dependencies correspond to",
        action: "remove the lock the project does not use, or name the package manager in package.json " +
          "`packageManager`, then rerun setup" });
    }
    const [unreadable] = workspace.errors;
    if (unreadable !== undefined) {
      const file = path.join(projectDir, unreadable.file);
      fail(MANIFEST_INVALID, `${file} cannot be parsed: ${unreadable.error}`, { manifest: file,
        condition: "a workspace declaration or lock of the installation is not readable YAML", input: file,
        cause: unreadable.error, uncertainty: "which packages are workspace members and what the lock installs",
        action: `correct ${file} with the project's own package manager, then rerun setup` });
    }
    const [inaccessible] = located.issues.filter(({ kind }) => kind === "inaccessible");
    if (inaccessible !== undefined) {
      fail(DEPENDENCY_INPUT_INACCESSIBLE, `installed dependencies of project ${project}: ` +
        describeIssue(inaccessible), { project, dependency_root: dependencyRoot, errno: inaccessible.errno,
        condition: "an installed dependency tree cannot be inspected", input: inaccessible.path,
        cause: `${inaccessible.errno} while reading it`,
        uncertainty: "whether the tree holds the declared packages",
        action: `make ${inaccessible.path} readable to the user that runs setup, then rerun setup` });
    }
    if (located.absent === true) {
      const [broken] = located.issues;
      fail(DEPENDENCIES_MISSING, `project ${project} has no installed node_modules`, { project,
        dependency_root: dependencyRoot, missing: [], searched: [".", ...members].map((owner) =>
          path.join(treeDirectory(projectDir, owner), "node_modules")),
        condition: "neither the installation root nor a workspace member has a node_modules", input: dependencyRoot,
        cause: broken === undefined ? "no dependency tree exists" : describeIssue(broken),
        action: installAction(workspace, projectDir) });
    }
    const trees = npmInstallationTrees({ status: "present", ...located });
    const reader = directoryReader(projectDir);
    const unresolved = [];
    for (const owner of [".", ...members]) {
      const declaring = owner === "." ? NPM_MANIFEST : `${owner}/${NPM_MANIFEST}`;
      for (const name of npmManifestFacts(reader(declaring)).required) {
        const found = resolveInstalledPackage(trees, owner, name);
        if (found.status !== "found") unresolved.push({ package: name, declared_in: declaring, ...found });
      }
    }
    const [denied] = unresolved.filter(({ status }) => status === "inaccessible");
    if (denied !== undefined) {
      fail(DEPENDENCY_INPUT_INACCESSIBLE, `installed package ${denied.package} of project ${project} cannot be ` +
        `inspected at ${denied.path} (${denied.errno})`, { project, dependency_root: dependencyRoot,
        package: denied.package, declared_in: denied.declared_in, errno: denied.errno,
        condition: "an installed package cannot be inspected", input: denied.path,
        cause: `${denied.errno} while reading it`, uncertainty: "whether the package is installed",
        action: `make ${denied.path} readable to the user that runs setup, then rerun setup` });
    }
    if (unresolved.length > 0) {
      const missing = [...new Set(unresolved.map(({ package: name }) => name))].sort();
      const broken = unresolved.filter(({ status }) => status === "broken")
        .map(({ package: name, path: link, target }) => ({ package: name, link, target }));
      fail(DEPENDENCIES_MISSING, `project ${project} has no installed ${missing.join(", ")} in its node_modules`,
        { project, dependency_root: dependencyRoot, missing, broken_links: broken,
          unresolved: unresolved.map(({ package: name, declared_in: declaring, status, searched, path: link }) =>
            ({ package: name, declared_in: declaring, status, searched: searched ?? [link] })),
          condition: "packages a manifest requires are not installed where that package resolves them",
          input: dependencyRoot,
          cause: broken.length > 0 ? `${broken[0].link} links ${broken[0].target}, which does not exist`
            : "the named packages are in neither the declaring package's node_modules nor an ancestor's",
          action: installAction(workspace, projectDir) });
    }
    return located;
  },

  runtimeBinding({ dependency, projectHostDir }) {
    const trees = npmInstallationTrees(dependency);
    const binds = [];
    const mountpoints = [];
    const placed = trees.map((tree) => {
      const destination = path.join(treeDirectory(projectHostDir, tree.owner), "node_modules");
      let existing = null;
      try { existing = realpathSync(destination); } catch { existing = null; }
      if (existing === tree.dir) {
        binds.push({ src: tree.dir, dst: tree.dir });
      } else {
        binds.push({ src: tree.dir, dst: destination });
        mountpoints.push(destination);
      }
      return Object.freeze({ owner: tree.owner, source: tree.dir, path: destination });
    });
    return { binds, mountpoints, links: [], env: {},
      values: trees.length === 0 ? {} : { node_modules_trees: Object.freeze(placed) } };
  },

  workingCopyBinding({ dependency, workProjectDir }) {
    const copies = npmInstallationTrees(dependency).map((tree) => workingCopyTree(tree, workProjectDir));
    return {
      binds: copies.map(({ installed }) => ({ src: installed, dst: installed })),
      mountpoints: [],

      directories: copies.flatMap(({ owner, modules, directories }) =>
        [...(owner === "." ? [] : [path.dirname(modules)]), ...directories]),
      links: copies.flatMap(({ links }) => links),
      writes: copies.flatMap(({ writes = [] }) => writes),
      env: {},
      values: { node_modules_trees: Object.freeze(copies.map(({ owner, installed, modules }) =>
        Object.freeze({ owner, source: installed, path: modules }))) }
    };
  }
});
