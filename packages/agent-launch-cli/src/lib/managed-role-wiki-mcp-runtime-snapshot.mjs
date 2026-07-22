

import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";

import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import { resolveAgentRoleResultSchemaPath } from "@agent-chassis/agent-launch-core/src/lib/agent-role-result-schema-path.mjs";
import {
  SESSION_ROLE_TOOL_ACCESS_POLICY_PATH,
  TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL,
  loadToolDiscoveryDescriptor,
  resolveRoleToolGrantsFromPolicy,
  resolveToolTierVisibility,
  tierVisibilityAllows
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";

import {
  CODEX_WIKI_MCP_SERVER_NAME,
  WIKI_MCP_ASSIGNED_UNIT_ENV_VAR,
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
  resolveCodexRoleWikiMcpToolProfile
} from "./codex-role-mcp-env.mjs";

import { buildCodexRoleBubblewrapPlan } from "./codex-role-adapter-isolation.mjs";
import { spawnIsolated } from "./launch-isolation.mjs";

export const MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION =
  "managed-wiki-mcp-runtime-snapshot.v1";

export const MANAGED_WIKI_MCP_RUNTIME_PACKAGES = Object.freeze([
  "@agent-chassis/wiki-mcp",
  "@agent-chassis/wiki-core",
  "@agent-chassis/agent-launch-cli",
  "@agent-chassis/agent-launch-core"
]);

export const MANAGED_WIKI_MCP_RUNTIME_STAGING_DIR_NAME = ".agent-mcp-runtimes";

const STAGED_REPO_DIR_NAME = "repo";
const STAGED_MANIFEST_FILE_NAME = "manifest.json";
const NODE_MODULES_DIR_NAME = "node_modules";
const WORKSPACE_SCOPE_DIR_NAME = "@agent-chassis";

const MEMBER_DIAGNOSTIC_LIMIT = 20;

const requireFromRuntimeSnapshot = createRequire(import.meta.url);

export class ManagedWikiMcpRuntimeError extends Error {
  constructor(code, message, detail = {}) {
    super(`${code}: ${message}`);
    this.name = "ManagedWikiMcpRuntimeError";
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

function snapshotIncomplete(message, detail) {
  return new ManagedWikiMcpRuntimeError(
    RUNTIME_BLOCKER_CODES.MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_INCOMPLETE,
    message,
    detail
  );
}

function dependencyUnavailable(message, detail) {
  return new ManagedWikiMcpRuntimeError(
    RUNTIME_BLOCKER_CODES.MANAGED_WIKI_MCP_RUNTIME_DEPENDENCY_UNAVAILABLE,
    message,
    detail
  );
}

function boundedMembers(members) {
  const list = Array.from(members);
  return Object.freeze({
    total: list.length,
    shown: Math.min(list.length, MEMBER_DIAGNOSTIC_LIMIT),
    members: Object.freeze(list.slice(0, MEMBER_DIAGNOSTIC_LIMIT))
  });
}

function runGit(repositoryRoot, args, { input = null } = {}) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, ...args], {
      encoding: "buffer",
      maxBuffer: 512 * 1024 * 1024,
      ...(input === null ? {} : { input })
    });
  } catch (error) {
    throw snapshotIncomplete(`git ${args[0]} failed in ${repositoryRoot}`, {
      git_argv: args.slice(0, 4),
      repository_root: repositoryRoot,
      cause: String(error?.stderr?.toString?.("utf8") || error?.message || error).slice(0, 400)
    });
  }
}

function readPackageJsonName(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))?.name ?? null;
  } catch {
    return null;
  }
}

function findPackageContainerDir(filePath) {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;
  for (let i = 0; i < 32; i += 1) {
    try {
      if (statSync(path.join(dir, "package.json")).isFile()) return dir;
    } catch {

    }
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

function findNamedPackageDir(filePath, packageName) {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;
  for (let i = 0; i < 40; i += 1) {
    if (readPackageJsonName(dir) === packageName) return dir;
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return null;
}

function resolveRuntimePackageDir(packageName) {
  for (const spec of [`${packageName}/package.json`, packageName]) {
    let resolvedReal;
    try {
      resolvedReal = realpathSync(requireFromRuntimeSnapshot.resolve(spec));
    } catch {
      continue;
    }
    const dir = spec.endsWith("/package.json")
      ? path.dirname(resolvedReal)
      : findNamedPackageDir(resolvedReal, packageName);
    if (dir && readPackageJsonName(dir) === packageName) return dir;
  }
  throw snapshotIncomplete(`cannot resolve runtime package ${packageName}`, {
    package: packageName
  });
}

function resolveNodeInterpreterDirRoot() {
  try {
    const nodeDir = path.dirname(realpathSync(process.execPath));
    return path.isAbsolute(nodeDir) ? nodeDir : null;
  } catch {
    return null;
  }
}

export function resolveManagedWikiMcpRuntimeSource(serverPath) {
  if (typeof serverPath !== "string" || !path.isAbsolute(serverPath)) {
    throw snapshotIncomplete("requires an absolute installed wiki-MCP server module path", {
      server_path: String(serverPath)
    });
  }
  let serverReal;
  try {
    serverReal = realpathSync(serverPath);
  } catch {
    throw snapshotIncomplete(`wiki-MCP server module path does not resolve: ${serverPath}`, {
      server_path: serverPath
    });
  }
  const wikiMcpPackageDir = findPackageContainerDir(serverReal);
  if (!wikiMcpPackageDir) {
    throw snapshotIncomplete("cannot resolve the wiki-MCP package directory", {
      server_path: serverReal
    });
  }
  const packagesDir = path.dirname(wikiMcpPackageDir);
  if (path.basename(packagesDir) !== "packages") {
    throw snapshotIncomplete(
      `wiki-MCP package is not under a workspace 'packages' directory: ${wikiMcpPackageDir}`,
      { package_dir: wikiMcpPackageDir }
    );
  }
  const repositoryRoot = path.dirname(packagesDir);

  const packageDirs = [];
  for (const packageName of MANAGED_WIKI_MCP_RUNTIME_PACKAGES) {
    const packageDir = resolveRuntimePackageDir(packageName);
    const relToRoot = path.relative(repositoryRoot, packageDir);
    if (relToRoot === "" || relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
      throw snapshotIncomplete(
        `runtime package ${packageName} resolves outside the repository root: ${packageDir}`,
        { package: packageName, package_dir: packageDir, repository_root: repositoryRoot }
      );
    }
    packageDirs.push({
      packageName,
      absolute: packageDir,
      relative: relToRoot.split(path.sep).join("/")
    });
  }

  return Object.freeze({
    repositoryRoot,
    serverPath: serverReal,
    serverRelativePath: path.relative(repositoryRoot, serverReal).split(path.sep).join("/"),
    packageDirs: Object.freeze(packageDirs)
  });
}

export function resolveCommittedRuntimeRevision(repositoryRoot) {
  const commit = runGit(repositoryRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
    .toString("utf8")
    .trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw snapshotIncomplete(
      `runtime source repository has no committed HEAD revision: ${repositoryRoot}`,
      { repository_root: repositoryRoot, observed: commit.slice(0, 80) }
    );
  }
  return commit;
}

export function enumerateCommittedRuntimeMembers({ repositoryRoot, commit, packageDirs }) {
  const members = [];
  for (const pkg of packageDirs) {
    const stdout = runGit(repositoryRoot, ["ls-tree", "-r", "-z", commit, "--", pkg.relative]);
    let packageMemberCount = 0;
    for (const record of stdout.toString("utf8").split("\0")) {
      if (record.length === 0) continue;
      const tab = record.indexOf("\t");
      if (tab < 0) {
        throw snapshotIncomplete("malformed git ls-tree record in runtime snapshot", {
          package: pkg.packageName,
          record: record.slice(0, 120)
        });
      }
      const [mode, type, oid] = record.slice(0, tab).split(" ");
      const relPath = record.slice(tab + 1);
      if (type !== "blob") {
        throw snapshotIncomplete(
          `runtime snapshot member is not a regular file (type ${type}): ${relPath}`,
          { package: pkg.packageName, member: relPath, git_mode: mode, git_type: type }
        );
      }
      if (mode !== "100644" && mode !== "100755") {
        throw snapshotIncomplete(
          `runtime snapshot member has a non-regular file mode ${mode}: ${relPath}`,
          { package: pkg.packageName, member: relPath, git_mode: mode }
        );
      }
      members.push({ mode, oid, path: relPath });
      packageMemberCount += 1;
    }
    if (packageMemberCount === 0) {
      throw snapshotIncomplete(
        `runtime package ${pkg.packageName} has no tracked members at ${commit.slice(0, 12)}`,
        { package: pkg.packageName, package_path: pkg.relative, commit }
      );
    }
  }
  members.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return members;
}

export function computeRuntimeSnapshotDigest({ commit, members }) {
  const hash = createHash("sha256");
  hash.update(MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION);
  hash.update("\0");
  hash.update(commit);
  for (const member of members) {
    hash.update("\0");
    hash.update(`${member.mode} ${member.oid} ${member.path}`);
  }
  return `sha256-${hash.digest("hex")}`;
}

export function resolveManagedWikiMcpRuntimeStagingRoot(repositoryRoot) {
  return path.join(
    path.dirname(repositoryRoot),
    MANAGED_WIKI_MCP_RUNTIME_STAGING_DIR_NAME,
    path.basename(repositoryRoot)
  );
}

export function verifyCanonicalDependencyInstallation({ repositoryRoot, packageDirs, stagedRepoDir }) {
  const canonical = path.join(repositoryRoot, NODE_MODULES_DIR_NAME);
  let canonicalReal;
  try {
    canonicalReal = realpathSync(canonical);
  } catch {
    throw dependencyUnavailable(
      `the owning repository's canonical node_modules installation is missing: ${canonical}`,
      { expected: canonical, repository_root: repositoryRoot }
    );
  }

  if (canonicalReal !== canonical) {
    throw dependencyUnavailable(
      "the canonical node_modules installation is redirected away from the owning repository",
      { expected: canonical, resolved: canonicalReal }
    );
  }
  try {
    if (!statSync(canonicalReal).isDirectory()) throw new Error("not a directory");
  } catch {
    throw dependencyUnavailable(
      `the canonical node_modules installation is not a directory: ${canonicalReal}`,
      { expected: canonicalReal }
    );
  }

  const installMarker = path.join(canonicalReal, ".package-lock.json");
  if (!existsSync(installMarker)) {
    throw dependencyUnavailable(
      "the canonical node_modules installation carries no npm installed-tree marker",
      { expected_marker: installMarker }
    );
  }

  const aliasFailures = [];
  for (const pkg of packageDirs) {
    const aliasPath = path.join(canonicalReal, pkg.packageName);
    let aliasReal = null;
    try {
      aliasReal = realpathSync(aliasPath);
    } catch {
      aliasFailures.push(`${pkg.packageName}: missing`);
      continue;
    }
    if (aliasReal !== pkg.absolute) {
      aliasFailures.push(`${pkg.packageName}: resolves to ${aliasReal}, expected ${pkg.absolute}`);
    }
  }
  if (aliasFailures.length > 0) {
    throw dependencyUnavailable(
      "the canonical node_modules installation is missing or redirects expected workspace aliases",
      { alias_failures: boundedMembers(aliasFailures) }
    );
  }

  if (!existsSync(path.join(repositoryRoot, "package-lock.json"))) {
    throw dependencyUnavailable(
      "the owning repository has no package-lock.json to anchor installation compatibility",
      { repository_root: repositoryRoot }
    );
  }
  const workspaceNames = new Set(MANAGED_WIKI_MCP_RUNTIME_PACKAGES);
  const missingDependencies = [];
  for (const pkg of packageDirs) {
    const stagedManifestPath = path.join(stagedRepoDir, pkg.relative, "package.json");
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(stagedManifestPath, "utf8"));
    } catch (error) {
      throw snapshotIncomplete(
        `staged runtime package manifest is missing or malformed: ${pkg.relative}/package.json`,
        { package: pkg.packageName, cause: String(error?.message ?? error).slice(0, 200) }
      );
    }
    for (const dependency of Object.keys(manifest?.dependencies ?? {})) {
      if (workspaceNames.has(dependency)) continue;
      if (!existsSync(path.join(canonicalReal, dependency, "package.json"))) {
        missingDependencies.push(`${pkg.packageName} -> ${dependency}`);
      }
    }
  }
  if (missingDependencies.length > 0) {
    throw dependencyUnavailable(
      "the canonical node_modules installation does not satisfy the snapshot's committed dependencies",
      { missing_dependencies: boundedMembers(missingDependencies) }
    );
  }
  return canonicalReal;
}

const STATIC_SPECIFIER_PATTERN =
  /(?:^|[\s;}])(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|(?:^|[\s;}])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function resolveStagedRelativeSpecifier(stagedRepoDir, importerRel, specifier) {
  const base = path.posix.join(path.posix.dirname(importerRel), specifier);
  const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}/index.mjs`, `${base}/index.js`];
  for (const candidate of candidates) {
    if (candidate.startsWith("..")) return null;
    const absolute = path.join(stagedRepoDir, candidate);
    try {
      if (statSync(absolute).isFile()) return candidate;
    } catch {

    }
  }
  return null;
}

function resolveStagedPackageEntry(stagedRepoDir, packageRelative) {
  const manifestPath = path.join(stagedRepoDir, packageRelative, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
  const dot = manifest?.exports?.["."];
  const fromExports = typeof dot === "string"
    ? dot
    : (typeof dot?.import === "string" ? dot.import : (typeof dot?.default === "string" ? dot.default : null));
  const candidates = [fromExports, manifest?.main, "index.mjs", "index.js"].filter(
    (value) => typeof value === "string" && value.length > 0
  );
  for (const candidate of candidates) {
    const relative = path.posix.normalize(path.posix.join(packageRelative, candidate));
    try {
      if (statSync(path.join(stagedRepoDir, relative)).isFile()) return relative;
    } catch {

    }
  }
  return null;
}

function extractStaticSpecifiers(source) {
  const specifiers = [];
  STATIC_SPECIFIER_PATTERN.lastIndex = 0;
  let match;
  while ((match = STATIC_SPECIFIER_PATTERN.exec(source)) !== null) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (typeof specifier === "string" && specifier.length > 0) specifiers.push(specifier);
  }
  return specifiers;
}

export function detectStagedRuntimeImportCompleteness({ stagedRepoDir, entrypointRelative }) {
  const unresolved = [];
  const visited = new Set();
  const queue = [entrypointRelative];
  while (queue.length > 0) {
    const current = queue.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    if (!/\.(mjs|js)$/.test(current)) continue;
    let source;
    try {
      source = readFileSync(path.join(stagedRepoDir, current), "utf8");
    } catch (error) {
      throw snapshotIncomplete(`staged runtime member is unreadable: ${current}`, {
        member: current,
        cause: String(error?.message ?? error).slice(0, 200)
      });
    }
    for (const specifier of extractStaticSpecifiers(source)) {
      if (specifier.startsWith("node:") || specifier.startsWith("data:")) continue;
      if (specifier.startsWith(".")) {
        const target = resolveStagedRelativeSpecifier(stagedRepoDir, current, specifier);
        if (target === null) {
          unresolved.push(`${current} -> ${specifier}`);
          continue;
        }
        queue.push(target);
        continue;
      }
      if (!specifier.startsWith(`${WORKSPACE_SCOPE_DIR_NAME}/`)) continue;
      const segments = specifier.split("/");
      const packageName = `${segments[0]}/${segments[1]}`;
      if (!MANAGED_WIKI_MCP_RUNTIME_PACKAGES.includes(packageName)) {
        unresolved.push(`${current} -> ${specifier} (workspace package outside the superset)`);
        continue;
      }
      const packageRelative = `packages/${segments[1]}`;
      const subpath = segments.slice(2).join("/");
      const target = subpath.length === 0
        ? resolveStagedPackageEntry(stagedRepoDir, packageRelative)
        : resolveStagedRelativeSpecifier(stagedRepoDir, `${packageRelative}/x`, `./${subpath}`);
      if (target === null) {
        unresolved.push(`${current} -> ${specifier} (target not tracked at the frozen commit)`);
        continue;
      }
      queue.push(target);
    }
  }
  if (unresolved.length > 0) {
    throw snapshotIncomplete(
      "the committed runtime snapshot has unresolved intra-runtime imports",
      { unresolved_imports: boundedMembers(unresolved) }
    );
  }
  return Object.freeze({ analyzed_modules: visited.size });
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

export function verifyStagedRuntime({ target, commit, digest, members }) {
  const manifestPath = path.join(target, STAGED_MANIFEST_FILE_NAME);
  const manifest = readManifest(manifestPath);
  if (manifest === null) {
    throw snapshotIncomplete(
      `staged runtime directory exists but carries no readable manifest: ${target}`,
      { staged_root: target, expected_manifest: manifestPath }
    );
  }
  const mismatches = [];
  if (manifest.schema_version !== MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION) {
    mismatches.push(`schema_version=${String(manifest.schema_version)}`);
  }
  if (manifest.commit !== commit) mismatches.push(`commit=${String(manifest.commit)}`);
  if (manifest.digest !== digest) mismatches.push(`digest=${String(manifest.digest)}`);
  if (manifest.member_count !== members.length) {
    mismatches.push(`member_count=${String(manifest.member_count)}`);
  }
  if (mismatches.length > 0) {
    throw snapshotIncomplete(
      `staged runtime manifest conflicts with the requested snapshot: ${target}`,
      { staged_root: target, expected_commit: commit, expected_digest: digest, mismatches: boundedMembers(mismatches) }
    );
  }
  const stagedRepoDir = path.join(target, STAGED_REPO_DIR_NAME);
  const sizes = manifest.member_sizes ?? {};
  const corrupt = [];
  for (const member of members) {
    let stats;
    try {
      stats = lstatSync(path.join(stagedRepoDir, member.path));
    } catch {
      corrupt.push(`${member.path}: absent`);
      continue;
    }
    if (!stats.isFile()) {
      corrupt.push(`${member.path}: not a regular file`);
      continue;
    }
    const expectedSize = sizes[member.path];
    if (typeof expectedSize === "number" && stats.size !== expectedSize) {
      corrupt.push(`${member.path}: size ${stats.size}, expected ${expectedSize}`);
    }
  }
  if (corrupt.length > 0) {
    throw snapshotIncomplete(
      `staged runtime is incomplete or corrupt: ${target}`,
      { staged_root: target, commit, digest, corrupt_members: boundedMembers(corrupt) }
    );
  }
  return stagedRepoDir;
}

export function materializeMembers({ repositoryRoot, stagedRepoDir, members }) {
  const batchInput = Buffer.from(`${members.map((member) => member.oid).join("\n")}\n`, "utf8");
  const stdout = runGit(repositoryRoot, ["cat-file", "--batch"], { input: batchInput });
  const memberSizes = {};
  let offset = 0;
  for (const member of members) {
    const newline = stdout.indexOf(0x0a, offset);
    if (newline < 0) {
      throw snapshotIncomplete(`truncated git object stream at member: ${member.path}`, {
        member: member.path,
        oid: member.oid
      });
    }
    const header = stdout.toString("utf8", offset, newline).trim();
    const [oid, type, sizeText] = header.split(" ");
    if (type !== "blob" || oid !== member.oid) {
      throw snapshotIncomplete(
        `git object for runtime member ${member.path} is missing or not a blob`,
        { member: member.path, oid: member.oid, header: header.slice(0, 120) }
      );
    }
    const size = Number.parseInt(sizeText, 10);
    if (!Number.isFinite(size) || size < 0) {
      throw snapshotIncomplete(`git object for runtime member ${member.path} has no valid size`, {
        member: member.path,
        header: header.slice(0, 120)
      });
    }
    const start = newline + 1;
    const content = stdout.subarray(start, start + size);
    const absolute = path.join(stagedRepoDir, member.path);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, { mode: member.mode === "100755" ? 0o555 : 0o444 });
    memberSizes[member.path] = size;
    offset = start + size + 1;
  }
  return memberSizes;
}

function composeStagedNodeModules({ stagedRepoDir, canonicalNodeModules, packageDirs }) {
  const stagedNodeModules = path.join(stagedRepoDir, NODE_MODULES_DIR_NAME);
  mkdirSync(stagedNodeModules, { recursive: true });
  for (const entry of readdirSync(canonicalNodeModules)) {
    if (entry === WORKSPACE_SCOPE_DIR_NAME) continue;
    symlinkSync(path.join(canonicalNodeModules, entry), path.join(stagedNodeModules, entry));
  }
  const scopeDir = path.join(stagedNodeModules, WORKSPACE_SCOPE_DIR_NAME);
  mkdirSync(scopeDir, { recursive: true });
  for (const pkg of packageDirs) {
    const leaf = pkg.packageName.split("/").pop();
    symlinkSync(
      path.relative(scopeDir, path.join(stagedRepoDir, pkg.relative)),
      path.join(scopeDir, leaf)
    );
  }
  return stagedNodeModules;
}

export function resolveManagedWikiMcpRuntimeSnapshot(serverPath) {
  const source = resolveManagedWikiMcpRuntimeSource(serverPath);
  const nodeInterpreterDir = resolveNodeInterpreterDirRoot();
  if (!nodeInterpreterDir) {
    throw snapshotIncomplete("cannot resolve the node interpreter directory", {});
  }
  const commit = resolveCommittedRuntimeRevision(source.repositoryRoot);
  const members = enumerateCommittedRuntimeMembers({
    repositoryRoot: source.repositoryRoot,
    commit,
    packageDirs: source.packageDirs
  });
  const digest = computeRuntimeSnapshotDigest({ commit, members });
  const stagingRoot = resolveManagedWikiMcpRuntimeStagingRoot(source.repositoryRoot);
  const target = path.join(stagingRoot, digest);

  let stagedRepoDir;
  if (existsSync(target)) {

    stagedRepoDir = verifyStagedRuntime({ target, commit, digest, members });
  } else {
    mkdirSync(stagingRoot, { recursive: true });
    const pending = `${target}.pending.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
    try {
      const pendingRepoDir = path.join(pending, STAGED_REPO_DIR_NAME);
      mkdirSync(pendingRepoDir, { recursive: true });
      const memberSizes = materializeMembers({
        repositoryRoot: source.repositoryRoot,
        stagedRepoDir: pendingRepoDir,
        members
      });
      const canonicalNodeModules = verifyCanonicalDependencyInstallation({
        repositoryRoot: source.repositoryRoot,
        packageDirs: source.packageDirs,
        stagedRepoDir: pendingRepoDir
      });
      composeStagedNodeModules({
        stagedRepoDir: pendingRepoDir,
        canonicalNodeModules,
        packageDirs: source.packageDirs
      });
      detectStagedRuntimeImportCompleteness({
        stagedRepoDir: pendingRepoDir,
        entrypointRelative: source.serverRelativePath
      });

      writeFileSync(
        path.join(pending, STAGED_MANIFEST_FILE_NAME),
        `${JSON.stringify(
          {
            schema_version: MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
            commit,
            digest,
            repository_root: source.repositoryRoot,
            packages: source.packageDirs.map((pkg) => pkg.packageName),
            entrypoint: source.serverRelativePath,
            member_count: members.length,
            member_sizes: memberSizes
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      try {
        renameSync(pending, target);
      } catch (error) {

        if (!existsSync(target)) {
          throw snapshotIncomplete(`cannot publish the staged runtime: ${target}`, {
            staged_root: target,
            cause: String(error?.message ?? error).slice(0, 200)
          });
        }
      }
      stagedRepoDir = verifyStagedRuntime({ target, commit, digest, members });
    } finally {
      if (existsSync(pending)) rmSync(pending, { recursive: true, force: true });
    }
  }

  const canonicalNodeModules = verifyCanonicalDependencyInstallation({
    repositoryRoot: source.repositoryRoot,
    packageDirs: source.packageDirs,
    stagedRepoDir
  });

  const entrypoint = path.join(stagedRepoDir, source.serverRelativePath);
  if (!existsSync(entrypoint)) {
    throw snapshotIncomplete(`staged runtime entrypoint is absent: ${entrypoint}`, {
      staged_root: target,
      entrypoint,
      commit,
      digest
    });
  }

  return Object.freeze({
    schema_version: MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
    commit,
    digest,
    repository_root: source.repositoryRoot,
    staged_root: target,
    staged_repo_dir: stagedRepoDir,
    entrypoint,
    node_interpreter_dir: nodeInterpreterDir,
    canonical_node_modules: canonicalNodeModules,
    member_count: members.length,

    read_only_roots: Object.freeze([nodeInterpreterDir, target, canonicalNodeModules])
  });
}

let cachedRoleToolGrants = null;
let cachedTierVisibility = null;

export const MANAGED_WIKI_MCP_PREFLIGHT_REGISTERED_TIER = TOOL_DISCOVERY_REGISTERED_TIER_FREE_LOCAL;

async function loadTierVisibility() {
  if (cachedTierVisibility === null) {
    const descriptor = await loadToolDiscoveryDescriptor();
    cachedTierVisibility = new Map(
      (descriptor?.tools ?? []).map((entry) => [entry.tool_name, resolveToolTierVisibility(entry)])
    );
  }
  return cachedTierVisibility;
}

export async function resolvePolicyDerivedRoleToolNames(
  role,
  { registeredTier = MANAGED_WIKI_MCP_PREFLIGHT_REGISTERED_TIER } = {}
) {
  const sessionRole = resolveCodexRoleWikiMcpToolProfile(role);
  if (cachedRoleToolGrants === null) {
    const policy = JSON.parse(readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
    cachedRoleToolGrants = resolveRoleToolGrantsFromPolicy(policy);
  }
  const grant = cachedRoleToolGrants.get(sessionRole);
  if (!(grant instanceof Set) || grant.size === 0) {
    throw snapshotIncomplete(
      `the central role->tool access policy grants no tools to session role ${sessionRole}`,
      { role, session_role: sessionRole }
    );
  }
  const tierVisibility = await loadTierVisibility();
  const names = [...grant]
    .filter((name) => {
      const visibility = tierVisibility.get(name);

      return visibility === undefined
        ? true
        : tierVisibilityAllows(visibility, registeredTier);
    })
    .sort();
  if (names.length === 0) {
    throw snapshotIncomplete(
      `no tool granted to session role ${sessionRole} is registrable at tier ${registeredTier}`,
      { role, session_role: sessionRole, registered_tier: registeredTier }
    );
  }
  return Object.freeze(names);
}

export async function composeManagedRoleWikiMcpRuntimeManifest({
  confined,
  role,
  serverPath,
  buildServerOverrides
}) {
  if (confined !== true) return null;
  if (typeof buildServerOverrides !== "function") {
    throw snapshotIncomplete(
      "the managed wiki-MCP runtime manifest requires a launcher-owned override builder",
      { role: String(role) }
    );
  }
  const snapshot = resolveManagedWikiMcpRuntimeSnapshot(serverPath);
  return Object.freeze({
    schema_version: MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
    role,
    snapshot,
    commit: snapshot.commit,
    digest: snapshot.digest,

    config_overrides: Object.freeze([...buildServerOverrides(snapshot.entrypoint)]),
    read_only_roots: snapshot.read_only_roots,
    expected_tool_names: await resolvePolicyDerivedRoleToolNames(role)
  });
}

export const MANAGED_ROLE_LAUNCHER_ARTIFACT_ROUTING_SCHEMA_VERSION =
  "managed-wiki-mcp-runtime-artifact-routing.v1";

export const MANAGED_ROLE_LAUNCHER_ARTIFACT_FLAG = "--output-schema";

const REGULAR_BLOB_MODES = Object.freeze(["100644", "100755"]);

function artifactRoutingRefusal(message, detail = {}) {
  return snapshotIncomplete(message, {
    artifact_flag: MANAGED_ROLE_LAUNCHER_ARTIFACT_FLAG,
    ...detail
  });
}

function resolveCommittedArtifactMember({ snapshot, source }) {
  const expected = resolveAgentRoleResultSchemaPath();
  if (typeof source !== "string" || source.length === 0) {
    throw artifactRoutingRefusal("launcher-owned artifact argument carries no value");
  }
  if (!path.isAbsolute(source) || path.normalize(source) !== source) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact argument must be an absolute, canonical path",
      { source }
    );
  }
  let stats;
  try {
    stats = lstatSync(source);
  } catch {
    throw artifactRoutingRefusal(
      "launcher-owned artifact source is absent from the live runtime repository",
      { source }
    );
  }
  if (stats.isSymbolicLink()) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact source is redirected through a symlink",
      { source }
    );
  }
  if (!stats.isFile()) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact source is not a regular file",
      { source }
    );
  }

  if (realpathSync(source) !== realpathSync(expected)) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact argument does not name the expected role-result schema surface",
      { source, expected }
    );
  }
  const relative = path.relative(snapshot.repository_root, source).split(path.sep).join("/");
  if (relative.length === 0 || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact source escapes the repository owning the staged snapshot",
      { source, repository_root: snapshot.repository_root }
    );
  }

  const listed = runGit(snapshot.repository_root, [
    "ls-tree", snapshot.commit, "--", relative
  ]).toString("utf8");
  const entry = /^(\d{6}) (blob|tree|commit) ([0-9a-f]+)\t/u.exec(listed);
  if (entry === null) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact is not tracked at the frozen snapshot revision",
      { source, member: relative, commit: snapshot.commit }
    );
  }
  const [, mode, type, oid] = entry;
  if (type !== "blob" || !REGULAR_BLOB_MODES.includes(mode)) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact is not a regular blob member at the frozen snapshot revision",
      { source, member: relative, commit: snapshot.commit, mode, type }
    );
  }
  return Object.freeze({ member: relative, oid, mode });
}

function resolveStagedArtifactCounterpart({ snapshot, member, oid }) {
  const manifestPath = path.join(snapshot.staged_root, STAGED_MANIFEST_FILE_NAME);
  const manifest = readManifest(manifestPath);
  if (manifest === null) {
    throw artifactRoutingRefusal(
      "staged runtime carries no readable manifest for launcher-owned artifact routing",
      { staged_root: snapshot.staged_root, expected_manifest: manifestPath }
    );
  }
  const mismatches = [];
  if (manifest.schema_version !== MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION) {
    mismatches.push(`schema_version=${String(manifest.schema_version)}`);
  }
  if (manifest.commit !== snapshot.commit) mismatches.push(`commit=${String(manifest.commit)}`);
  if (manifest.digest !== snapshot.digest) mismatches.push(`digest=${String(manifest.digest)}`);
  if (manifest.repository_root !== snapshot.repository_root) {
    mismatches.push(`repository_root=${String(manifest.repository_root)}`);
  }
  if (mismatches.length > 0) {
    throw artifactRoutingRefusal(
      "staged runtime manifest conflicts with the snapshot serving this role",
      {
        staged_root: snapshot.staged_root,
        expected_commit: snapshot.commit,
        expected_digest: snapshot.digest,
        mismatches: boundedMembers(mismatches)
      }
    );
  }
  const sizes = manifest.member_sizes ?? {};
  if (!Object.prototype.hasOwnProperty.call(sizes, member)) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact is absent from the staged runtime manifest member set",
      { member, staged_root: snapshot.staged_root, commit: snapshot.commit }
    );
  }
  const staged = path.join(snapshot.staged_repo_dir, member);
  let stats;
  try {
    stats = lstatSync(staged);
  } catch {
    throw artifactRoutingRefusal(
      "staged counterpart of the launcher-owned artifact is absent",
      { member, staged }
    );
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw artifactRoutingRefusal(
      "staged counterpart of the launcher-owned artifact is not a regular file",
      { member, staged }
    );
  }
  const expectedSize = sizes[member];
  if (typeof expectedSize === "number" && stats.size !== expectedSize) {
    throw artifactRoutingRefusal(
      "staged counterpart of the launcher-owned artifact has the wrong size",
      { member, staged, size: stats.size, expected_size: expectedSize }
    );
  }

  const stagedOid = runGit(snapshot.repository_root, [
    "hash-object", "-t", "blob", "--", staged
  ]).toString("utf8").trim();
  if (stagedOid !== oid) {
    throw artifactRoutingRefusal(
      "staged counterpart of the launcher-owned artifact does not match the committed object",
      { member, staged, committed_oid: oid, staged_oid: stagedOid }
    );
  }
  return staged;
}

export function rewriteManagedRoleLauncherArtifactArgs({ plan, manifest }) {
  const args = plan?.args;
  if (!Array.isArray(args)) return null;
  const indices = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === MANAGED_ROLE_LAUNCHER_ARTIFACT_FLAG) indices.push(index);
  }
  if (indices.length === 0) return null;
  if (indices.length > 1) {
    throw artifactRoutingRefusal(
      "managed confined role argv carries duplicate launcher-owned artifact arguments",
      { occurrences: indices.length }
    );
  }
  const snapshot = manifest?.snapshot;
  if (!snapshot || manifest.schema_version !== MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION ||
      manifest.commit !== snapshot.commit || manifest.digest !== snapshot.digest) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact routing requires the exact staged runtime manifest tuple",
      { schema_version: manifest?.schema_version ?? null }
    );
  }
  const flagIndex = indices[0];
  const valueIndex = flagIndex + 1;

  if (valueIndex > args.length - 2) {
    throw artifactRoutingRefusal(
      "launcher-owned artifact argument is missing its value",
      { arg_index: flagIndex, argv_length: args.length }
    );
  }
  const source = args[valueIndex];
  const { member, oid, mode } = resolveCommittedArtifactMember({ snapshot, source });
  const staged = resolveStagedArtifactCounterpart({ snapshot, member, oid });
  args[valueIndex] = staged;
  return Object.freeze({
    schema_version: MANAGED_ROLE_LAUNCHER_ARTIFACT_ROUTING_SCHEMA_VERSION,
    commit: snapshot.commit,
    digest: snapshot.digest,
    rewritten: Object.freeze([Object.freeze({
      arg: MANAGED_ROLE_LAUNCHER_ARTIFACT_FLAG,
      member,
      oid,
      mode,
      source,
      staged
    })])
  });
}

export function buildManagedRoleWikiMcpPreflightEnv({ role, assignedUnit, plan }) {
  const planEnv = plan?.env ?? {};
  return {
    PATH: typeof planEnv.PATH === "string" && planEnv.PATH.length > 0 ? planEnv.PATH : "/usr/bin:/bin",
    HOME: typeof planEnv.HOME === "string" ? planEnv.HOME : "",
    [WIKI_MCP_TOOL_PROFILE_ENV_VAR]: resolveCodexRoleWikiMcpToolProfile(role),
    [WIKI_MCP_ASSIGNED_UNIT_ENV_VAR]: typeof assignedUnit === "string" ? assignedUnit : ""
  };
}

export const MANAGED_WIKI_MCP_PREFLIGHT_SERVER_NAME = CODEX_WIKI_MCP_SERVER_NAME;

export const MANAGED_WIKI_MCP_PREFLIGHT_TIMEOUT_MS = 20_000;

function computePreflightBinding({ snapshot, role, registeredTier, expectedToolNames, bwrapArgs }) {
  const hash = createHash("sha256");
  const field = (label, value) => {
    hash.update("\0");
    hash.update(label);
    hash.update("\0");
    hash.update(value);
  };
  field("schema", MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION);
  field("commit", snapshot.commit);
  field("digest", snapshot.digest);
  field("entrypoint", snapshot.entrypoint);
  field("role", String(role));
  field("registered_tier", String(registeredTier));
  field("tools", expectedToolNames.join(","));

  try {
    field("policy", readFileSync(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, "utf8"));
  } catch (error) {
    throw snapshotIncomplete("the central role->tool access policy is unreadable at preflight", {
      role,
      cause: String(error?.message ?? error).slice(0, 200)
    });
  }

  field("node_modules", snapshot.canonical_node_modules);
  try {
    field("install_marker", readFileSync(path.join(snapshot.canonical_node_modules, ".package-lock.json"), "utf8"));
  } catch (error) {
    throw dependencyUnavailable("the canonical installation's npm installed-tree marker is unreadable at preflight", {
      node_modules: snapshot.canonical_node_modules,
      cause: String(error?.message ?? error).slice(0, 200)
    });
  }

  field("bwrap_topology", JSON.stringify(bwrapArgs));
  return `sha256-${hash.digest("hex")}`;
}

function initializeAndListTools(child, timeoutMs) {
  return new Promise((resolve) => {
    let buffer = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...value, stderr });
    };
    const timer = setTimeout(() => finish({ reason: "timeout" }), timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          if (message.error) {
            finish({ reason: "initialize_error", error: message.error });
            return;
          }
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`
          );
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`
          );
        } else if (message.id === 2) {
          if (message.error) {
            finish({ reason: "tools_list_error", error: message.error });
            return;
          }
          finish({ tools: (message.result?.tools ?? []).map((tool) => tool.name).sort() });
        }
      }
    });
    child.on("error", (error) => finish({ reason: "spawn_error", error: String(error?.message ?? error) }));
    child.on("exit", (code, signal) => finish({ reason: "exited", exit_code: code, signal }));
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "agent-launch-managed-wiki-mcp-preflight", version: "1.0.0" }
        }
      })}\n`
    );
  });
}

export async function preflightManagedRoleWikiMcpRuntime({
  plan,
  manifest,
  role,
  assignedUnit,
  timeoutMs = MANAGED_WIKI_MCP_PREFLIGHT_TIMEOUT_MS
}) {
  const snapshot = manifest.snapshot;
  const expected = manifest.expected_tool_names;
  let bwrapPlan;
  try {
    bwrapPlan = buildCodexRoleBubblewrapPlan(plan, {
      commandOverride: process.execPath,
      argsOverride: [snapshot.entrypoint],
      envOverride: buildManagedRoleWikiMcpPreflightEnv({ role, assignedUnit, plan }),
      envPolicy: null
    });
  } catch (error) {
    throw snapshotIncomplete(
      "the role's bwrap mount topology could not be materialized for the staged runtime preflight",
      {
        role,
        commit: snapshot.commit,
        digest: snapshot.digest,
        cause: String(error?.message ?? error).slice(0, 300)
      }
    );
  }
  const binding = computePreflightBinding({
    snapshot,
    role,
    registeredTier: MANAGED_WIKI_MCP_PREFLIGHT_REGISTERED_TIER,
    expectedToolNames: expected,
    bwrapArgs: Array.isArray(bwrapPlan?.args) ? bwrapPlan.args : []
  });
  let child;
  try {
    child = spawnIsolated(bwrapPlan, { stdio: "pipe" });
  } catch (error) {
    throw snapshotIncomplete(
      "the staged wiki-MCP runtime could not be started in the role's bwrap namespace",
      {
        role,
        commit: snapshot.commit,
        digest: snapshot.digest,
        entrypoint: snapshot.entrypoint,
        preflight_binding: binding,
        cause: String(error?.message ?? error).slice(0, 300)
      }
    );
  }
  let outcome;
  try {
    outcome = await initializeAndListTools(child, timeoutMs);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  const context = {
    role,
    commit: snapshot.commit,
    digest: snapshot.digest,
    entrypoint: snapshot.entrypoint,
    staged_root: snapshot.staged_root,
    preflight_binding: binding,
    stderr_tail: String(outcome.stderr ?? "").slice(-600)
  };
  if (!Array.isArray(outcome.tools)) {
    throw snapshotIncomplete(
      `the staged wiki-MCP runtime failed its in-namespace MCP preflight (${outcome.reason})`,
      {
        ...context,
        preflight_failure: outcome.reason,
        ...(outcome.error === undefined ? {} : { error: outcome.error }),
        ...(outcome.exit_code === undefined ? {} : { exit_code: outcome.exit_code, signal: outcome.signal })
      }
    );
  }
  const missing = expected.filter((name) => !outcome.tools.includes(name));
  const unexpected = outcome.tools.filter((name) => !expected.includes(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw snapshotIncomplete(
      "the staged wiki-MCP runtime exposed a tool surface that is not the policy-derived role grant",
      {
        ...context,
        expected_tool_count: expected.length,
        observed_tool_count: outcome.tools.length,
        missing_tools: boundedMembers(missing),
        unexpected_tools: boundedMembers(unexpected)
      }
    );
  }
  return Object.freeze({
    schema_version: MANAGED_WIKI_MCP_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
    role,
    commit: snapshot.commit,
    digest: snapshot.digest,
    registered_tier: MANAGED_WIKI_MCP_PREFLIGHT_REGISTERED_TIER,
    canonical_node_modules: snapshot.canonical_node_modules,

    preflight_binding: binding,
    observed_tool_names: Object.freeze([...outcome.tools]),

    proves: "staged_runtime_completeness_and_role_tool_surface",
    does_not_prove: "codex_owned_mcp_client_initialization"
  });
}
