import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readlinkSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "./terminal-review-materialization.mjs";
import { defaultTerminalCandidateRunGit } from "./terminal-wk-candidate.mjs";
import {
  assertBubblewrapAvailable,
  buildBubblewrapLaunchPlan
} from "./launch-isolation.mjs";

export const TERMINAL_CANDIDATE_VALIDATION_SCHEMA_VERSION =
  "agent_launch.reviewer_validation_evidence.v2";

export const TERMINAL_CANDIDATE_VALIDATION_CODES = Object.freeze({
  INVALID_ARGUMENT: "agent_launch.terminal_candidate_validation.invalid_argument.v1",
  DEPENDENCY_UNAVAILABLE: "agent_launch.terminal_candidate_validation.dependency_unavailable.v1",
  DEPENDENCY_REDIRECTED: "agent_launch.terminal_candidate_validation.dependency_redirected.v1",
  DEPENDENCY_INCOMPATIBLE: "agent_launch.terminal_candidate_validation.dependency_incompatible.v1",
  DEPENDENCY_STALE: "agent_launch.terminal_candidate_validation.dependency_stale.v1",
  TARGET_INVALID: "agent_launch.terminal_candidate_validation.target_invalid.v1",
  VALIDATION_FAILED: "agent_launch.terminal_candidate_validation.failed.v1"
});

const OUTPUT_CAP_BYTES = 64 * 1024;
const TIMEOUT_MS = 30_000;
const MANIFEST_NAMES = Object.freeze([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock"
]);
const LOCK_COMPARISON_FIELDS = Object.freeze(["version", "resolved", "integrity", "link"]);
const DEPENDENCY_PROJECTION_SCHEMA_VERSION =
  "agent_launch.reviewer_dependency_projection.v1";
const DEPENDENCY_PROJECTION_METADATA = ".agent-launch-projection.json";
const PROJECTION_BUILD_ATTEMPTS = 3;

export class TerminalCandidateValidationError extends Error {
  constructor(message, { code, detail = null, cause = null } = {}) {
    super(`terminal candidate validation: ${message}`);
    this.name = "TerminalCandidateValidationError";
    this.code = code;
    this.detail = detail;
    if (cause !== null) this.cause = cause;
  }
}

function fail(code, message, detail = null, cause = null) {
  throw new TerminalCandidateValidationError(message, { code, detail, cause });
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(file, code, message) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(code, message, { path: file }, error);
  }
}

function assertRealDirectory(target, code, message) {
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    fail(code, message, { path: target }, error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(code, message, { path: target, directory: stat.isDirectory(), symlink: stat.isSymbolicLink() });
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function collectDependencyProjectionEntry({
  source, relative, mainRepo, checkoutPath, nodeModules, entries, dependencySources
}) {
  const sourceStat = lstatSync(source);
  if (sourceStat.isSymbolicLink()) {
    const realTarget = realpathSync(source);
    const workspaceTarget = isWithin(mainRepo, realTarget) && !isWithin(nodeModules, realTarget);
    const projectedTarget = workspaceTarget
      ? path.join(checkoutPath, path.relative(mainRepo, realTarget))
      : realTarget;
    if (!existsSync(projectedTarget)) {
      fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
        "workspace dependency target is absent from the exact reviewed checkout", {
          source, real_target: realTarget,
          reviewed_target: projectedTarget
        });
    }
    if (!workspaceTarget) dependencySources.add(projectedTarget);
    entries.push({
      path: relative,
      kind: "symlink",
      target: projectedTarget,
      target_kind: statSync(projectedTarget).isDirectory() ? "dir" : "file"
    });
    return;
  }
  if (sourceStat.isDirectory()) {
    const leaf = path.basename(source);
    if (leaf === ".bin" || leaf.startsWith("@")) {
      entries.push({ path: relative, kind: "directory" });
      for (const entry of readdirSync(source).sort()) {
        collectDependencyProjectionEntry({
          source: path.join(source, entry), relative: path.join(relative, entry),
          mainRepo, checkoutPath, nodeModules, entries, dependencySources
        });
      }
      return;
    }
    dependencySources.add(source);
    entries.push({ path: relative, kind: "symlink", target: source, target_kind: "dir" });
    return;
  }
  if (sourceStat.isFile()) {
    dependencySources.add(source);
    entries.push({ path: relative, kind: "symlink", target: source, target_kind: "file" });
    return;
  }
  fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
    "dependency entry has an unsupported filesystem type", { source });
}

function dependencyProjectionSnapshot({ mainRepo, checkoutPath, projectionRoot, canonicalModules }) {
  assertRealDirectory(checkoutPath, TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
    "exact reviewed checkout is unavailable");
  const canonicalCheckout = realpathSync(checkoutPath);
  if (canonicalCheckout !== checkoutPath) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
      "exact reviewed checkout is redirected", { expected: checkoutPath, actual: canonicalCheckout });
  }
  const manifests = compareManifestBytes(mainRepo, checkoutPath);
  const marker = assertInstallMarkerCoherent(mainRepo, canonicalModules);
  const entries = [];
  const dependencySources = new Set();
  for (const entry of readdirSync(canonicalModules).sort()) {
    collectDependencyProjectionEntry({
      source: path.join(canonicalModules, entry), relative: entry,
      mainRepo, checkoutPath, nodeModules: canonicalModules, entries, dependencySources
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  const installationFacts = {
    node_modules: canonicalModules,
    marker_digest: marker.marker_digest,
    entries
  };
  const installationDigest = hashBytes(JSON.stringify(installationFacts));
  const identityFacts = {
    schema_version: DEPENDENCY_PROJECTION_SCHEMA_VERSION,
    projection_base: projectionRoot,
    checkout_path: canonicalCheckout,
    manifests,
    installation_digest: `sha256:${installationDigest}`
  };
  return {
    entries,
    dependencySources,
    installationDigest,
    projectionDigest: hashBytes(JSON.stringify(identityFacts))
  };
}

function projectionMetadata(snapshot) {
  return {
    schema_version: DEPENDENCY_PROJECTION_SCHEMA_VERSION,
    projection_identity: `sha256:${snapshot.projectionDigest}`,
    installation_digest: `sha256:${snapshot.installationDigest}`,
    entry_count: snapshot.entries.length
  };
}

function fsyncPath(target) {
  const fd = openSync(target, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function materializeDependencyProjection(root, snapshot) {
  for (const entry of snapshot.entries) {
    const destination = path.join(root, entry.path);
    if (entry.kind === "directory") {
      mkdirSync(destination, { recursive: true, mode: 0o700 });
    } else {
      mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      symlinkSync(entry.target, destination, entry.target_kind);
    }
  }
  const metadataPath = path.join(root, DEPENDENCY_PROJECTION_METADATA);
  writeFileSync(metadataPath, `${JSON.stringify(projectionMetadata(snapshot))}\n`, { mode: 0o600 });
  chmodSync(metadataPath, 0o444);
  for (const entry of [...snapshot.entries].reverse()) {
    if (entry.kind === "directory") chmodSync(path.join(root, entry.path), 0o555);
  }
  chmodSync(root, 0o555);
  fsyncPath(metadataPath);
  fsyncPath(root);
}

function verifyDependencyProjection(root, snapshot) {
  assertRealDirectory(root, TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
    "reviewer dependency projection is redirected or invalid");
  if (realpathSync(root) !== root || (statSync(root).mode & 0o222) !== 0) return false;
  const expectedChildren = new Map([["", new Set([DEPENDENCY_PROJECTION_METADATA])]]);
  for (const entry of snapshot.entries) {
    const parent = path.dirname(entry.path) === "." ? "" : path.dirname(entry.path);
    if (!expectedChildren.has(parent)) expectedChildren.set(parent, new Set());
    expectedChildren.get(parent).add(path.basename(entry.path));
    if (entry.kind === "directory" && !expectedChildren.has(entry.path)) {
      expectedChildren.set(entry.path, new Set());
    }
    const target = path.join(root, entry.path);
    let stat;
    try {
      stat = lstatSync(target);
    } catch {
      return false;
    }
    if (entry.kind === "directory") {
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o222) !== 0) return false;
    } else if (!stat.isSymbolicLink() || readlinkSync(target) !== entry.target ||
        !existsSync(entry.target) || statSync(entry.target).isDirectory() !== (entry.target_kind === "dir")) {
      return false;
    }
  }
  for (const [relative, expected] of expectedChildren) {
    const actual = readdirSync(path.join(root, relative)).sort();
    if (actual.length !== expected.size || actual.some((entry) => !expected.has(entry))) return false;
  }
  const metadataPath = path.join(root, DEPENDENCY_PROJECTION_METADATA);
  const metadataStat = lstatSync(metadataPath);
  if (!metadataStat.isFile() || metadataStat.isSymbolicLink() || (metadataStat.mode & 0o222) !== 0) return false;
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    return false;
  }
  return JSON.stringify(metadata) === JSON.stringify(projectionMetadata(snapshot));
}

function quarantineInvalidProjection(root) {
  for (let attempt = 0; attempt < PROJECTION_BUILD_ATTEMPTS; attempt += 1) {
    const quarantine = `${root}.invalid-${process.pid}-${Date.now()}-${attempt}`;
    try {
      renameSync(root, quarantine);
      fsyncPath(path.dirname(root));
      return;
    } catch (error) {
      if (error?.code === "ENOENT") return;
      if (error?.code !== "EEXIST") throw error;
    }
  }
  fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_STALE,
    "invalid reviewer dependency projection could not be quarantined", { projection_root: root });
}

export function prepareReviewerDependencyProjection({
  mainRepo,
  checkoutPath,
  projectionRoot
} = {}) {
  const nodeModules = path.join(mainRepo, "node_modules");
  assertRealDirectory(nodeModules, TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_UNAVAILABLE,
    "canonical main repository node_modules is unavailable");
  const canonicalModules = realpathSync(nodeModules);
  if (canonicalModules !== nodeModules) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
      "canonical main repository node_modules is redirected", { expected: nodeModules, actual: canonicalModules });
  }
  if (typeof projectionRoot !== "string" || !path.isAbsolute(projectionRoot) ||
      isWithin(mainRepo, projectionRoot) || isWithin(checkoutPath, projectionRoot)) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.INVALID_ARGUMENT,
      "reviewer dependency projection must be an absolute launcher path outside canonical repository state");
  }
  if (existsSync(projectionRoot)) {
    const legacyStat = lstatSync(projectionRoot);
    if (!legacyStat.isDirectory() || legacyStat.isSymbolicLink()) {
      fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
        "legacy reviewer dependency projection path is redirected or invalid", {
          projection_root: projectionRoot
        });
    }
  }
  const projectionParent = path.dirname(projectionRoot);
  mkdirSync(projectionParent, { recursive: true, mode: 0o700 });
  assertRealDirectory(projectionParent, TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
    "reviewer dependency projection parent is redirected or invalid");
  if (realpathSync(projectionParent) !== projectionParent) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
      "reviewer dependency projection parent is redirected", { projection_parent: projectionParent });
  }

  let snapshot;
  let publishedRoot;
  let projectionReady = false;
  for (let attempt = 0; attempt < PROJECTION_BUILD_ATTEMPTS; attempt += 1) {
    snapshot = dependencyProjectionSnapshot({ mainRepo, checkoutPath, projectionRoot, canonicalModules });
    publishedRoot = `${projectionRoot}.projection-${snapshot.projectionDigest}`;
    if (existsSync(publishedRoot)) {
      if (verifyDependencyProjection(publishedRoot, snapshot)) {
        const after = dependencyProjectionSnapshot({ mainRepo, checkoutPath, projectionRoot, canonicalModules });
        if (after.projectionDigest === snapshot.projectionDigest) {
          projectionReady = true;
          break;
        }
        continue;
      }
      quarantineInvalidProjection(publishedRoot);
    }
    const temporaryRoot = mkdtempSync(`${projectionRoot}.tmp-`);
    try {
      materializeDependencyProjection(temporaryRoot, snapshot);
      const afterBuild = dependencyProjectionSnapshot({ mainRepo, checkoutPath, projectionRoot, canonicalModules });
      if (afterBuild.projectionDigest !== snapshot.projectionDigest) continue;
      try {
        renameSync(temporaryRoot, publishedRoot);
        fsyncPath(projectionParent);
      } catch (error) {
        if (!existsSync(publishedRoot) || !["EEXIST", "ENOTEMPTY"].includes(error?.code)) throw error;
      }
      if (!verifyDependencyProjection(publishedRoot, snapshot)) {
        quarantineInvalidProjection(publishedRoot);
        continue;
      }
      const afterPublish = dependencyProjectionSnapshot({ mainRepo, checkoutPath, projectionRoot, canonicalModules });
      if (afterPublish.projectionDigest === snapshot.projectionDigest) {
        projectionReady = true;
        break;
      }
    } finally {
      if (existsSync(temporaryRoot)) {
        chmodSync(temporaryRoot, 0o700);
        for (const entry of snapshot.entries) {
          const target = path.join(temporaryRoot, entry.path);
          if (entry.kind === "directory" && existsSync(target)) chmodSync(target, 0o700);
        }
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    }
  }
  if (!projectionReady || !snapshot || !publishedRoot || !verifyDependencyProjection(publishedRoot, snapshot)) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_STALE,
      "reviewer dependency installation did not stabilize during projection publication");
  }
  const substrateReadOnlyBinds = Object.freeze(
    [...snapshot.dependencySources].sort().map((source) => Object.freeze({ src: source, dst: source }))
  );
  return Object.freeze({
    schema_version: DEPENDENCY_PROJECTION_SCHEMA_VERSION,
    projection_identity: `sha256:${snapshot.projectionDigest}`,
    installation_digest: `sha256:${snapshot.installationDigest}`,
    projection_root: publishedRoot,
    read_only_bind: Object.freeze({
      src: publishedRoot,
      dst: path.join(checkoutPath, "node_modules")
    }),
    substrate_read_only_binds: substrateReadOnlyBinds,
    read_only_binds: Object.freeze([
      Object.freeze({ src: publishedRoot, dst: path.join(checkoutPath, "node_modules") }),
      ...substrateReadOnlyBinds
    ]),
    workspace_links_resolve_against_reviewed_checkout: true
  });
}

function workspaceManifestPaths(packageJson) {
  const raw = Array.isArray(packageJson?.workspaces)
    ? packageJson.workspaces
    : Array.isArray(packageJson?.workspaces?.packages)
      ? packageJson.workspaces.packages
      : [];
  const paths = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0 || /[*?{}[\]]/u.test(entry) || path.isAbsolute(entry)) {
      fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_INCOMPATIBLE,
        "workspace manifest declaration is not a fixed repo-relative path", { entry });
    }
    const normalized = path.posix.normalize(entry.replaceAll("\\", "/"));
    if (normalized === ".." || normalized.startsWith("../") || normalized === ".") {
      fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_INCOMPATIBLE,
        "workspace manifest declaration escapes the repository", { entry });
    }
    paths.push(`${normalized}/package.json`);
  }
  return paths.sort();
}

function compareManifestBytes(mainRepo, checkoutPath) {
  const rootPackage = readJson(path.join(mainRepo, "package.json"),
    TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_INCOMPATIBLE,
    "main repository package.json is unreadable");
  const relativePaths = [...MANIFEST_NAMES, ...workspaceManifestPaths(rootPackage)];
  const hashes = [];
  for (const relative of relativePaths) {
    const mainPath = path.join(mainRepo, relative);
    const candidatePath = path.join(checkoutPath, relative);
    const mainExists = existsSync(mainPath);
    const candidateExists = existsSync(candidatePath);
    if (mainExists !== candidateExists) {
      fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_INCOMPATIBLE,
        "candidate and installed dependency manifests differ", { path: relative, main_exists: mainExists, candidate_exists: candidateExists });
    }
    if (!mainExists) continue;
    const mainBytes = readFileSync(mainPath);
    const candidateBytes = readFileSync(candidatePath);
    if (!mainBytes.equals(candidateBytes)) {
      fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_INCOMPATIBLE,
        "candidate manifest is not byte-compatible with the installed dependency root", { path: relative });
    }
    hashes.push([relative, hashBytes(mainBytes)]);
  }
  return hashes;
}

function assertInstallMarkerCoherent(mainRepo, nodeModules) {
  const lockPath = path.join(mainRepo, "package-lock.json");
  const markerPath = path.join(nodeModules, ".package-lock.json");
  if (!existsSync(lockPath) || !existsSync(markerPath) || !statSync(markerPath).isFile()) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_UNAVAILABLE,
      "npm installation marker is absent or invalid", { lock_path: lockPath, marker_path: markerPath });
  }
  const lock = readJson(lockPath, TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_STALE,
    "package lock is unreadable");
  const marker = readJson(markerPath, TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_STALE,
    "npm installation marker is unreadable");
  if (!Number.isInteger(lock.lockfileVersion) || marker.lockfileVersion !== lock.lockfileVersion ||
      typeof lock.packages !== "object" || lock.packages === null ||
      typeof marker.packages !== "object" || marker.packages === null) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_STALE,
      "npm installation marker does not match the canonical lockfile version");
  }
  for (const [packagePath, installed] of Object.entries(marker.packages)) {
    const expected = lock.packages[packagePath];
    if (!expected || LOCK_COMPARISON_FIELDS.some((field) =>
      (installed?.[field] ?? null) !== (expected?.[field] ?? null))) {
      fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_STALE,
        "installed dependency marker disagrees with package-lock.json", { package_path: packagePath });
    }
  }
  const root = lock.packages[""] ?? {};
  const direct = { ...(root.dependencies ?? {}), ...(root.devDependencies ?? {}), ...(root.optionalDependencies ?? {}) };
  for (const name of Object.keys(direct)) {
    const packagePath = `node_modules/${name}`;
    const expected = lock.packages[packagePath];
    const installed = marker.packages[packagePath];
    if (!expected || !installed || expected.version !== installed.version) {
      fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_STALE,
        "a direct dependency is missing or stale in node_modules", { package: name });
    }
  }
  return { marker_path: markerPath, marker_digest: hashBytes(readFileSync(markerPath)) };
}

export function verifyTerminalCandidateDependencies({ binding, materialization } = {}) {
  assertTerminalCandidateMaterialization(materialization, binding);
  const mainRepo = binding.main_repo;
  const checkoutPath = materialization.checkout_path;
  const candidateRoot = materialization.candidate_root;
  const nodeModules = path.join(mainRepo, "node_modules");
  assertRealDirectory(nodeModules, TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_UNAVAILABLE,
    "canonical main repository node_modules is unavailable");
  const canonicalModules = realpathSync(nodeModules);
  if (canonicalModules !== nodeModules) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_REDIRECTED,
      "canonical main repository node_modules is redirected", { expected: nodeModules, actual: canonicalModules });
  }
  const manifestHashes = compareManifestBytes(mainRepo, checkoutPath);
  const marker = assertInstallMarkerCoherent(mainRepo, nodeModules);
  const projection = prepareReviewerDependencyProjection({
    mainRepo,
    checkoutPath,
    projectionRoot: path.join(candidateRoot, "node_modules")
  });
  const proofFacts = {
    main_repo: mainRepo,
    node_modules: canonicalModules,
    projection_root: projection.projection_root,
    projection_identity: projection.projection_identity,
    dependency_installation_digest: projection.installation_digest,
    reviewer_read_only_bind: projection.read_only_bind,
    reviewer_read_only_binds: projection.read_only_binds,
    workspace_links_resolve_against_reviewed_checkout:
      projection.workspace_links_resolve_against_reviewed_checkout,
    manifests: manifestHashes,
    installation_marker: marker,
    package_manager_posture: { offline: true, ignore_scripts: true }
  };
  return Object.freeze({
    schema_version: "agent_launch.terminal_candidate_dependency_proof.v1",
    ...proofFacts,
    digest: hashBytes(JSON.stringify(proofFacts))
  });
}

function createPrivateRuntime(runtimeRoot) {
  if (typeof runtimeRoot !== "string" || !path.isAbsolute(runtimeRoot) || path.normalize(runtimeRoot) !== runtimeRoot) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.INVALID_ARGUMENT,
      "validation runtime root must be an absolute normalized launcher path");
  }
  if (!existsSync(runtimeRoot)) mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  assertRealDirectory(runtimeRoot, TERMINAL_CANDIDATE_VALIDATION_CODES.INVALID_ARGUMENT,
    "validation runtime root is invalid");
  chmodSync(runtimeRoot, 0o700);
  const runRoot = mkdtempSync(path.join(runtimeRoot, "run-"));
  chmodSync(runRoot, 0o700);
  const home = path.join(runRoot, "home");
  const config = path.join(runRoot, "xdg-config");
  const tmp = path.join(runRoot, "tmp");
  for (const dir of [home, config, tmp]) mkdirSync(dir, { mode: 0o700 });
  return { runRoot, home, config, tmp };
}

export function buildTerminalCandidateValidationEnv({ nodePath, runtime }) {
  if (typeof nodePath !== "string" || !path.isAbsolute(nodePath)) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.INVALID_ARGUMENT, "node executable must be launcher-resolved and absolute");
  }
  return Object.freeze({
    PATH: `${path.dirname(nodePath)}:/usr/bin:/bin`,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    CI: "1",
    HOME: runtime.home,
    XDG_CONFIG_HOME: runtime.config,
    TMPDIR: runtime.tmp,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    NPM_CONFIG_GLOBALCONFIG: "/dev/null",
    NPM_CONFIG_OFFLINE: "true",
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    YARN_ENABLE_NETWORK: "0",
    YARN_ENABLE_SCRIPTS: "0"
  });
}

function resolveTarget(checkoutPath, target) {
  if (typeof target !== "string" || target.length === 0 || path.isAbsolute(target) || target.includes("\0") || /[\r\n]/u.test(target)) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.TARGET_INVALID, "validation target must be a repo-relative path");
  }
  const absolute = path.resolve(checkoutPath, target);
  const relative = path.relative(checkoutPath, absolute);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ||
      ![".js", ".mjs"].includes(path.extname(absolute).toLowerCase()) || !existsSync(absolute) || !statSync(absolute).isFile()) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.TARGET_INVALID, "validation target is absent, invalid, or escapes the candidate", { target });
  }
  const realRoot = realpathSync(checkoutPath);
  const realTarget = realpathSync(absolute);
  const realRelative = path.relative(realRoot, realTarget);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.TARGET_INVALID, "validation target resolves outside the candidate", { target });
  }
  return { absolute: realTarget, relative: relative.split(path.sep).join("/") };
}

function bounded(value) {
  const buffer = Buffer.from(typeof value === "string" ? value : value == null ? "" : String(value));
  return {
    text: buffer.subarray(0, OUTPUT_CAP_BYTES).toString("utf8"),
    truncated: buffer.byteLength > OUTPUT_CAP_BYTES
  };
}

function runStep({ spawn, nodePath, flag, target, checkoutPath, env, runtime, dependencyBinds }) {
  const bwrapPath = assertBubblewrapAvailable({ env: process.env });
  const isolation = buildBubblewrapLaunchPlan({
    repo: checkoutPath,
    command: nodePath,
    args: [flag, target.absolute],
    cwd: checkoutPath,
    env,
    readOnlyRoots: dependencyBinds,
    runtimeRoots: [runtime.runRoot],
    findingsRole: "reviewer",
    shareNet: false,
    bwrapPath
  });
  const result = spawn(bwrapPath, isolation.bwrapArgs, {
    shell: false,
    encoding: "utf8",
    env: process.env,
    timeout: TIMEOUT_MS,
    maxBuffer: OUTPUT_CAP_BYTES
  });
  const stdout = bounded(result.stdout);
  const stderr = bounded(result.stderr);
  const timedOut = result.error?.code === "ETIMEDOUT";
  const overflow = result.error?.code === "ENOBUFS";
  return Object.freeze({
    step: `node ${flag}`,
    argv: Object.freeze(["node", flag, target.relative]),
    target: target.relative,
    ran: true,
    skipped: false,
    exit_code: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal ?? null,
    timed_out: timedOut,
    output_truncated: stdout.truncated || stderr.truncated || overflow,
    spawn_error: result.error && !timedOut && !overflow ? String(result.error.code ?? result.error.message) : null,
    stdout: stdout.text,
    stderr: stderr.text,
    ok: !result.error && result.status === 0
  });
}

export function runTerminalCandidateValidation({
  binding,
  materialization,
  target,
  runtimeRoot,
  nodePath = process.execPath,
  runGit = defaultTerminalCandidateRunGit,
  spawn = spawnSync
} = {}) {
  if (typeof spawn !== "function" || typeof runGit !== "function") {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.INVALID_ARGUMENT, "launcher validation dependencies are missing");
  }
  verifyTerminalCandidateCheckout({ binding, candidateRoot: materialization?.candidate_root, runGit });
  const before = verifyTerminalCandidateDependencies({ binding, materialization });
  const resolvedTarget = resolveTarget(materialization.checkout_path, target);
  const runtime = createPrivateRuntime(runtimeRoot);
  const env = buildTerminalCandidateValidationEnv({ nodePath, runtime });
  const dependencyMountpoint = path.join(materialization.checkout_path, "node_modules");
  const createdDependencyMountpoint = !existsSync(dependencyMountpoint);
  if (createdDependencyMountpoint) mkdirSync(dependencyMountpoint, { mode: 0o700 });
  let check;
  let test;
  try {
    check = runStep({
        spawn,
        nodePath,
        flag: "--check",
        target: resolvedTarget,
        checkoutPath: materialization.checkout_path,
        env,
        runtime,
        dependencyBinds: before.reviewer_read_only_binds
      });
    test = check.ok
      ? runStep({
          spawn,
          nodePath,
          flag: "--test",
          target: resolvedTarget,
          checkoutPath: materialization.checkout_path,
          env,
          runtime,
          dependencyBinds: before.reviewer_read_only_binds
        })
      : Object.freeze({
        step: "node --test", argv: Object.freeze(["node", "--test", resolvedTarget.relative]),
        target: resolvedTarget.relative, ran: false, skipped: true,
        skipped_reason: "node --check failed; node --test not run", exit_code: null,
        signal: null, timed_out: false, output_truncated: false, spawn_error: null,
        stdout: "", stderr: "", ok: false
      });
  } finally {
    if (createdDependencyMountpoint) rmSync(dependencyMountpoint, { recursive: true, force: true });
  }
  verifyTerminalCandidateCheckout({ binding, candidateRoot: materialization.candidate_root, runGit });
  const after = verifyTerminalCandidateDependencies({ binding, materialization });
  if (after.digest !== before.digest) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.DEPENDENCY_STALE,
      "dependency proof changed during validation", { before: before.digest, after: after.digest });
  }
  return Object.freeze({
    schema_version: TERMINAL_CANDIDATE_VALIDATION_SCHEMA_VERSION,
    unit: binding.canonical_wk_id,
    subject: binding.canonical_wk_id,
    target: resolvedTarget.relative,
    candidate: binding.candidate,
    reviewed_sha: binding.candidate,
    base: binding.base,
    diff_base_sha: binding.base,
    wk_tip: binding.wk_tip,
    dependency_digest: before.digest,
    environment_keys: Object.freeze(Object.keys(env).sort()),
    runtime_root: runtime.runRoot,
    steps: Object.freeze([check, test]),
    command: Object.freeze(["node", "--test", resolvedTarget.relative]),
    exit_status: test.ran ? test.exit_code : check.exit_code,
    stdout: test.ran ? test.stdout : check.stdout,
    stderr: test.ran ? test.stderr : check.stderr,
    timed_out: check.timed_out || test.timed_out,
    output_truncated: check.output_truncated || test.output_truncated,
    advisory: true,
    integration_effect: "none",
    ok: check.ok && test.ok
  });
}

export function runAllTerminalCandidateValidations({ targets, ...options } = {}) {
  if (!Array.isArray(targets) || targets.some((target) => typeof target !== "string" || target.length === 0)) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.INVALID_ARGUMENT,
      "terminal lifecycle requires every canonical whole-WK validation target");
  }
  const results = [];
  for (const target of targets) {
    const result = runTerminalCandidateValidation({ ...options, target });
    results.push(result);
  }
  return Object.freeze(results);
}

export function bindReviewerValidationEvidence(evidence, {
  reviewerRunId,
  subject,
  reviewedSha,
  diffBaseSha
} = {}) {
  if (!Array.isArray(evidence) || typeof reviewerRunId !== "string" || reviewerRunId.length === 0 ||
      typeof subject !== "string" || subject.length === 0) {
    fail(TERMINAL_CANDIDATE_VALIDATION_CODES.INVALID_ARGUMENT,
      "reviewer validation evidence binding requires evidence, reviewer run id, and subject");
  }
  return Object.freeze(evidence.map((entry) => {
    if (entry?.reviewed_sha !== reviewedSha || entry?.diff_base_sha !== diffBaseSha || entry?.advisory !== true) {
      fail(TERMINAL_CANDIDATE_VALIDATION_CODES.INVALID_ARGUMENT,
        "reviewer validation evidence disagrees with the exact review target", {
          target: entry?.target ?? null,
          expected_reviewed_sha: reviewedSha,
          actual_reviewed_sha: entry?.reviewed_sha ?? null,
          expected_diff_base_sha: diffBaseSha,
          actual_diff_base_sha: entry?.diff_base_sha ?? null
        });
    }
    return Object.freeze({
      ...entry,
      reviewer_run_id: reviewerRunId,
      subject,
      finding_disposition: entry.ok === true ? "passing_evidence" : "advisory_finding"
    });
  }));
}
