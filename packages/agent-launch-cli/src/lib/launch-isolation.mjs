

import { spawn } from "node:child_process";
import path from "node:path";
import { statSync, realpathSync } from "node:fs";
import {
  MCP_SANDBOX_RUNTIME_BLOCKER_CODES,
  McpSandboxProfileError,
  buildMcpSandboxProfileMountPlan
} from "./mcp-sandbox-profile.mjs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION,
  BubblewrapIsolationError,
  assertAbsoluteSafePath,
  fail,
  isNonEmptyString,
  isWithinRepo
} from "./launch-isolation-errors.mjs";
import {
  assertExistingDirectory,
  normalizeBindEntry,
  prepareWritableFiles,
  realpathExisting,
  validateAndResolveCwd
} from "./launch-isolation-paths.mjs";
import {
  DEFAULT_SYSTEM_READ_ONLY_ROOTS,
  collectCodexMcpReadOnlyRoots,
  resolveExecutableForPlan,
  resolverPathFromEnv
} from "./launch-isolation-executable.mjs";
import {
  DEFAULT_FAMILY_RUNTIME_MOUNT_PREFIXES,
  DEFAULT_FAMILY_RUNTIME_WRITABLE_MOUNT_PREFIXES,
  resolveFamilyRuntimeHomePolicyProfile,
  assertFamilyRuntimeReadOnlyRootSafe,
  assertFamilyRuntimeWritableRootSafe,
  normalizeCommandResolutionOverride
} from "./launch-isolation-family-runtime.mjs";
import { applyBwrapEnvPolicy } from "./launch-isolation-env-policy.mjs";
import {
  assertBubblewrapAvailable,
  buildSystemBaselineArgs,
  collectDedupedSrcBinds,
  collectRealpathDedupedRoots
} from "./launch-isolation-bwrap.mjs";

export {
  BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  isWithinRepo
} from "./launch-isolation-errors.mjs";
export { prepareWritableFiles } from "./launch-isolation-paths.mjs";
export {
  DEFAULT_SYSTEM_READ_ONLY_ROOTS,
  DEFAULT_FAMILY_SYSTEM_READ_ONLY_ROOTS,
  readCodexConfigText,
  parseCodexMcpConfig
} from "./launch-isolation-executable.mjs";
export {
  DEFAULT_FAMILY_RUNTIME_EXECUTABLE_PREFIXES,
  FAMILY_RUNTIME_EXECUTABLE_DENIED_PATHS,
  DEFAULT_FAMILY_RUNTIME_MOUNT_PREFIXES,
  DEFAULT_FAMILY_RUNTIME_WRITABLE_MOUNT_PREFIXES,
  FAMILY_RUNTIME_MOUNT_DENIED_PATHS,
  FAMILY_RUNTIME_MOUNT_BROAD_DENIED_ROOTS,
  deriveFamilyRuntimeHomePolicyProfile,
  resolveFamilyRuntimeHomePolicyProfile,
  resolveFamilyRuntimeExecutable,
  buildFamilyRuntimeCommandResolution,
  mergeFamilyRuntimeReadOnlyRoots
} from "./launch-isolation-family-runtime.mjs";
export {
  DEFAULT_BWRAP_ENV_SECRET_DENY_NAME_PATTERNS,
  DEFAULT_BWRAP_ENV_SECRET_DENY_NAMES,
  DEFAULT_BWRAP_ENV_BEHAVIOR_AFFECTING_DENY_NAMES,
  applyBwrapEnvPolicy
} from "./launch-isolation-env-policy.mjs";
export { assertBubblewrapAvailable } from "./launch-isolation-bwrap.mjs";

const BIND_DEDUP_SEPARATOR = "\u0000";

export function buildBubblewrapLaunchPlan({
  repo,
  command,
  args = [],
  cwd = null,
  env = null,
  readOnlyRoots = [],
  writableRoots = [],
  writableFiles = [],
  runtimeRoots = [],
  mcpSandboxProfile = null,
  homePolicy = null,
  familyRuntimeReadOnlyRoots = [],
  familySystemReadOnlyRoots = null,
  familyRuntimeWritableRoots = null,
  familyRuntimeMountPrefixes = null,
  familyRuntimePolicyProfile = null,
  envPolicy = null,
  commandResolution = null,
  systemReadOnlyRoots = DEFAULT_SYSTEM_READ_ONLY_ROOTS,

  tmpfsDirs = [],
  maskTmpfsDirs = [],
  shareNet = true,

  newSession = true,
  bwrapPath = null
} = {}) {
  if (typeof newSession !== "boolean") {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      `newSession must be a boolean, got: ${typeof newSession}`
    );
  }
  if (!isNonEmptyString(repo)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.REPO_INVALID,
      `repo must be a non-empty string, got: ${typeof repo}`
    );
  }
  const repoNormalized = assertAbsoluteSafePath(repo, "repo");
  assertExistingDirectory(repoNormalized, "repo", BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.REPO_INVALID);

  const repoReal = realpathExisting(repoNormalized, "repo", BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.REPO_INVALID);

  const resolvedFamilyRuntimePolicyProfile = familyRuntimePolicyProfile ?? (() => {
    const resolved = resolveFamilyRuntimeHomePolicyProfile();
    if (resolved.ok) return resolved.profile;
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      resolved.reason,
      resolved.detail ?? null
    );
  })();

  if (!isNonEmptyString(command)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_INVALID,
      "command must be a non-empty string"
    );
  }
  if (!Array.isArray(args)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ARGS_INVALID,
      "args must be an array of strings"
    );
  }
  for (const entry of args) {
    if (typeof entry !== "string") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ARGS_INVALID,
        `args entries must be strings, got: ${typeof entry}`
      );
    }
  }

  if (!Array.isArray(systemReadOnlyRoots)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "systemReadOnlyRoots must be an array"
    );
  }
  const systemRoots = systemReadOnlyRoots.map((root, idx) =>
    assertAbsoluteSafePath(root, `systemReadOnlyRoots[${idx}]`)
  );

  if (!Array.isArray(tmpfsDirs)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "tmpfsDirs must be an array"
    );
  }
  const tmpfsDirsResolved = tmpfsDirs.map((dir, idx) =>
    assertAbsoluteSafePath(dir, `tmpfsDirs[${idx}]`)
  );
  if (!Array.isArray(maskTmpfsDirs)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "maskTmpfsDirs must be an array"
    );
  }
  const maskTmpfsDirsResolved = [];
  const seenMaskTmpfs = new Set();
  for (let i = 0; i < maskTmpfsDirs.length; i += 1) {
    const dir = assertAbsoluteSafePath(maskTmpfsDirs[i], `maskTmpfsDirs[${i}]`);
    if (seenMaskTmpfs.has(dir)) continue;
    seenMaskTmpfs.add(dir);
    maskTmpfsDirsResolved.push(dir);
  }

  const effectiveFamilyRuntimeMountPrefixes = familyRuntimeMountPrefixes
    ?? resolvedFamilyRuntimePolicyProfile.mountPrefixes;
  if (
    !Array.isArray(effectiveFamilyRuntimeMountPrefixes)
    || effectiveFamilyRuntimeMountPrefixes.length === 0
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "familyRuntimeMountPrefixes must be a non-empty array"
    );
  }
  const familyRuntimeApprovedPrefixes = effectiveFamilyRuntimeMountPrefixes.map((prefix, idx) =>
    assertAbsoluteSafePath(prefix, `familyRuntimeMountPrefixes[${idx}]`)
  );

  const resolverPathEnv = resolverPathFromEnv(env);
  const resolvedCommand = (commandResolution === null || commandResolution === undefined)
    ? resolveExecutableForPlan({
        command,
        pathEnv: resolverPathEnv,
        systemRoots,
        repoReal
      })
    : normalizeCommandResolutionOverride(commandResolution, {
        approvedPrefixes: familyRuntimeApprovedPrefixes,
        repoReal,
        policyProfile: resolvedFamilyRuntimePolicyProfile
      });
  const mcpReadOnlyRoots = collectCodexMcpReadOnlyRoots({
    env,
    pathEnv: resolverPathEnv,
    systemRoots,
    repoReal
  });
  let mcpSandboxProfilePlan = null;
  if (mcpSandboxProfile !== null && mcpSandboxProfile !== undefined) {
    if (typeof mcpSandboxProfile !== "object" || Array.isArray(mcpSandboxProfile)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL,
        "mcpSandboxProfile must be a plain object",
        {
          runtime_blocker_code: MCP_SANDBOX_RUNTIME_BLOCKER_CODES.SANDBOX_WRITE_DENIAL,
          reason: "profile_request_invalid"
        }
      );
    }
    try {
      mcpSandboxProfilePlan = buildMcpSandboxProfileMountPlan({
        repo: repoReal,
        launcherRole: mcpSandboxProfile.launcherRole,
        capabilities: mcpSandboxProfile.capabilities
      });
    } catch (err) {
      if (err instanceof McpSandboxProfileError) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL,
          err.message,
          err.detail ?? null
        );
      }
      throw err;
    }
  }

  if (!Array.isArray(writableRoots)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "writableRoots must be an array"
    );
  }
  const effectiveWritableRoots = [
    ...writableRoots,
    ...(mcpSandboxProfilePlan?.writableRoots ?? [])
  ];

  const writable = collectRealpathDedupedRoots(effectiveWritableRoots, "writableRoots", {
    requireInsideRepo: true,
    repoReal
  });

  let gitReal = null;
  try {
    gitReal = realpathSync(path.join(repoReal, ".git"));
  } catch {
    gitReal = null;
  }
  for (const dir of writable) {
    if (dir === repoReal) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL,
        `writable root must never be the repo root: ${dir}`,
        { writableRoot: dir, repoReal }
      );
    }
    if (
      gitReal !== null &&
      (dir === gitReal || isWithinRepo(dir, gitReal) || isWithinRepo(gitReal, dir))
    ) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL,
        `writable root must never be or contain the gitdir: ${dir}`,
        { writableRoot: dir, gitReal }
      );
    }
  }

  const effectiveWritableFiles = [
    ...writableFiles,
    ...(mcpSandboxProfilePlan?.writableFiles ?? [])
  ];
  const writableFileEntries = prepareWritableFiles(effectiveWritableFiles, repoReal);

  if (!Array.isArray(runtimeRoots)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "runtimeRoots must be an array"
    );
  }

  const runtime = collectRealpathDedupedRoots(runtimeRoots, "runtimeRoots", {
    requireInsideRepo: false,
    repoReal
  });

  if (!Array.isArray(readOnlyRoots)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "readOnlyRoots must be an array"
    );
  }
  const readOnly = [];
  const seenReadOnly = new Set();
  for (let i = 0; i < readOnlyRoots.length; i += 1) {
    const bind = normalizeBindEntry(readOnlyRoots[i], `readOnlyRoots[${i}]`);
    const key = `${bind.src}${BIND_DEDUP_SEPARATOR}${bind.dst}`;
    if (seenReadOnly.has(key)) continue;
    seenReadOnly.add(key);
    readOnly.push(bind);
  }
  for (let i = 0; i < mcpReadOnlyRoots.length; i += 1) {
    const src = assertAbsoluteSafePath(mcpReadOnlyRoots[i], `mcpReadOnlyRoots[${i}]`);
    const key = `${src}${BIND_DEDUP_SEPARATOR}${src}`;
    if (seenReadOnly.has(key)) continue;
    seenReadOnly.add(key);
    readOnly.push({ src, dst: src });
  }

  for (let i = 0; i < resolvedCommand.extraReadOnlyRoots.length; i += 1) {
    const src = assertAbsoluteSafePath(
      resolvedCommand.extraReadOnlyRoots[i],
      `commandResolverReadOnlyRoots[${i}]`
    );
    const key = `${src}${BIND_DEDUP_SEPARATOR}${src}`;
    if (seenReadOnly.has(key)) continue;
    seenReadOnly.add(key);
    readOnly.push({ src, dst: src });
  }

  const homeReads = [];
  if (homePolicy !== null && homePolicy !== undefined) {
    if (typeof homePolicy !== "object" || Array.isArray(homePolicy)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.HOME_POLICY_INVALID,
        "homePolicy must be a plain object"
      );
    }
    for (const key of Object.keys(homePolicy)) {
      if (key !== "reads") {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.HOME_POLICY_INVALID,
          `homePolicy has unknown key: ${key} (only "reads" is supported; broad writable $HOME is not exposed)`
        );
      }
    }
    const reads = Array.isArray(homePolicy.reads) ? homePolicy.reads : null;
    if (homePolicy.reads !== undefined && reads === null) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.HOME_POLICY_INVALID,
        "homePolicy.reads must be an array of bind entries"
      );
    }
    const seenHome = new Set();
    if (reads) {
      for (let i = 0; i < reads.length; i += 1) {
        const bind = normalizeBindEntry(reads[i], `homePolicy.reads[${i}]`);
        const key = `${bind.src}${BIND_DEDUP_SEPARATOR}${bind.dst}`;
        if (seenHome.has(key)) continue;
        seenHome.add(key);
        homeReads.push(bind);
      }
    }
  }

  if (!Array.isArray(familyRuntimeReadOnlyRoots)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "familyRuntimeReadOnlyRoots must be an array"
    );
  }
  const familyRuntime = collectDedupedSrcBinds(
    familyRuntimeReadOnlyRoots,
    "familyRuntimeReadOnlyRoots",
    (src, entryLabel) => assertFamilyRuntimeReadOnlyRootSafe(src, entryLabel, {
      approvedPrefixes: familyRuntimeApprovedPrefixes,
      repoReal,
      policyProfile: resolvedFamilyRuntimePolicyProfile
    })
  );

  if (
    familyRuntimeWritableRoots !== null
    && familyRuntimeWritableRoots !== undefined
    && !Array.isArray(familyRuntimeWritableRoots)
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "familyRuntimeWritableRoots must be an array or null"
    );
  }
  const familyRuntimeWritable = [];
  const seenFamilyRuntimeWritable = new Set();
  if (Array.isArray(familyRuntimeWritableRoots)) {
    const approvedWritablePrefixes =
      resolvedFamilyRuntimePolicyProfile.writableMountPrefixes.map((prefix, idx) =>
      assertAbsoluteSafePath(prefix, `DEFAULT_FAMILY_RUNTIME_WRITABLE_MOUNT_PREFIXES[${idx}]`)
    );
    for (let i = 0; i < familyRuntimeWritableRoots.length; i += 1) {
      const src = assertAbsoluteSafePath(
        familyRuntimeWritableRoots[i],
        `familyRuntimeWritableRoots[${i}]`
      );
      assertFamilyRuntimeWritableRootSafe(src, `familyRuntimeWritableRoots[${i}]`, {
        approvedPrefixes: approvedWritablePrefixes,
        repoReal,
        policyProfile: resolvedFamilyRuntimePolicyProfile
      });
      try {
        const st = statSync(src);
        if (!st.isDirectory()) {
          fail(
            BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
            `familyRuntimeWritableRoots[${i}] must be a directory: ${src}`
          );
        }
      } catch (err) {
        if (err instanceof BubblewrapIsolationError) throw err;
        if (err?.code === "ENOENT" || err?.code === "ENOTDIR") {
          fail(
            BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.WRITABLE_RUNTIME_ROOT_NOT_VISIBLE_IN_NAMESPACE,
            `familyRuntimeWritableRoots[${i}] is not visible in the current mount namespace: ${src}`,
            { src, errno: err.code }
          );
        }
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PATH_NOT_DIRECTORY,
          `familyRuntimeWritableRoots[${i}] stat failed: ${src}`,
          { errno: err?.code ?? null }
        );
      }
      if (seenFamilyRuntimeWritable.has(src)) continue;
      seenFamilyRuntimeWritable.add(src);
      familyRuntimeWritable.push({ src, dst: src });
    }
  }

  if (
    familySystemReadOnlyRoots !== null
    && familySystemReadOnlyRoots !== undefined
    && !Array.isArray(familySystemReadOnlyRoots)
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "familySystemReadOnlyRoots must be an array or null"
    );
  }
  const familySystemReadOnly = Array.isArray(familySystemReadOnlyRoots)
    ? collectDedupedSrcBinds(familySystemReadOnlyRoots, "familySystemReadOnlyRoots")
    : [];

  const cwdInput = cwd === null || cwd === undefined ? repoReal : cwd;
  const cwdNormalized = validateAndResolveCwd(cwdInput, repoReal);

  const setEnv = {};
  if (env !== null && env !== undefined) {
    if (typeof env !== "object" || Array.isArray(env)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ENV_INVALID,
        "env must be a plain object of string values"
      );
    }
    for (const [k, v] of Object.entries(env)) {
      if (!isNonEmptyString(k)) {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ENV_INVALID,
          `env keys must be non-empty strings`
        );
      }
      if (typeof v !== "string") {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.ENV_INVALID,
          `env[${k}] must be a string, got: ${typeof v}`
        );
      }
      setEnv[k] = v;
    }
  }

  const { env: policedEnv, droppedKeys: envPolicyDroppedKeys } = applyBwrapEnvPolicy(
    setEnv,
    envPolicy
  );

  const bwrapArgs = [];
  bwrapArgs.push(...buildSystemBaselineArgs({ systemReadOnlyRoots: systemRoots, shareNet, newSession, tmpfsDirs: tmpfsDirsResolved }));
  bwrapArgs.push("--ro-bind", repoReal, repoReal);
  for (const { src, dst } of readOnly) {
    bwrapArgs.push("--ro-bind", src, dst);
  }
  for (const { src, dst } of homeReads) {
    bwrapArgs.push("--ro-bind-try", src, dst);
  }
  for (const { src, dst } of familySystemReadOnly) {
    bwrapArgs.push("--ro-bind-try", src, dst);
  }
  for (const { src, dst } of familyRuntime) {
    bwrapArgs.push("--ro-bind-try", src, dst);
  }

  for (const { src, dst } of familyRuntimeWritable) {
    bwrapArgs.push("--dir", dst);
    bwrapArgs.push("--bind", src, dst);
  }
  for (const dir of writable) {
    bwrapArgs.push("--bind", dir, dir);
  }

  for (const { real } of writableFileEntries) {
    bwrapArgs.push("--bind", real, real);
  }
  for (const dir of runtime) {
    bwrapArgs.push("--bind", dir, dir);
  }

  for (const dir of maskTmpfsDirsResolved) {
    bwrapArgs.push("--tmpfs", dir);
  }
  for (const [k, v] of Object.entries(policedEnv)) {
    bwrapArgs.push("--setenv", k, v);
  }
  bwrapArgs.push("--chdir", cwdNormalized);

  bwrapArgs.push("--", resolvedCommand.argvCommand, ...args);

  const pinnedBwrapPath = isNonEmptyString(bwrapPath)
    ? assertAbsoluteSafePath(bwrapPath, "bwrapPath")
    : null;

  return Object.freeze({
    schemaVersion: BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION,
    bwrapPath: pinnedBwrapPath,
    bwrapArgs: Object.freeze(bwrapArgs),
    childCommand: resolvedCommand.argvCommand,
    childCommandInput: command,
    childArgs: Object.freeze([...args]),
    repo: repoReal,
    cwd: cwdNormalized,
    shareNet: shareNet === true,
    env: Object.freeze({ ...policedEnv }),
    envPolicyDroppedKeys: Object.freeze([...envPolicyDroppedKeys]),
    writableRoots: Object.freeze([...writable]),
    writableFiles: Object.freeze(
      writableFileEntries.map((entry) => Object.freeze({ ...entry }))
    ),
    runtimeRoots: Object.freeze([...runtime]),
    tmpfsDirs: Object.freeze([...tmpfsDirsResolved]),
    maskTmpfsDirs: Object.freeze([...maskTmpfsDirsResolved]),
    readOnlyRoots: Object.freeze(readOnly.map((b) => Object.freeze({ ...b }))),
    homePolicyReads: Object.freeze(homeReads.map((b) => Object.freeze({ ...b }))),
    familySystemReadOnlyRoots: Object.freeze(
      familySystemReadOnly.map((b) => Object.freeze({ ...b }))
    ),
    familyRuntimeReadOnlyRoots: Object.freeze(
      familyRuntime.map((b) => Object.freeze({ ...b }))
    ),
    familyRuntimeWritableRoots: Object.freeze(
      familyRuntimeWritable.map((b) => Object.freeze({ ...b }))
    ),
    systemReadOnlyRoots: Object.freeze([...systemRoots]),
    mcpSandboxProfile: mcpSandboxProfilePlan === null
      ? null
      : Object.freeze({
          schemaVersion: mcpSandboxProfilePlan.schemaVersion,
          launcherRole: mcpSandboxProfilePlan.launcherRole,
          grantedCapabilities: Object.freeze([...mcpSandboxProfilePlan.grantedCapabilities]),
          requestedCapabilities: Object.freeze([...mcpSandboxProfilePlan.requestedCapabilities]),
          fixedPathClasses: Object.freeze([...mcpSandboxProfilePlan.fixedPathClasses]),
          exactFilePathClasses: Object.freeze([
            ...mcpSandboxProfilePlan.exactFilePathClasses
          ]),
          runtimePathClasses: Object.freeze([...mcpSandboxProfilePlan.runtimePathClasses]),
          writableRoots: Object.freeze([...mcpSandboxProfilePlan.writableRoots]),
          writableFiles: Object.freeze([...mcpSandboxProfilePlan.writableFiles])
        })
  });
}

export {
  INTERACTIVE_ORCHESTRATOR_COORDINATION_WRITABLE_SUBPATHS,
  buildInteractiveOrchestratorBwrapPlan
} from "./orchestrator-launch-isolation.mjs";

export function spawnIsolated(plan, stdioOptions = {}) {
  if (!plan || typeof plan !== "object" || plan.schemaVersion !== BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
      `spawnIsolated requires a plan from buildBubblewrapLaunchPlan (schema ${BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION})`
    );
  }
  const parentEnv = stdioOptions.env && typeof stdioOptions.env === "object" ? stdioOptions.env : process.env;
  const resolved = assertBubblewrapAvailable({
    env: parentEnv,
    bwrapPath: plan.bwrapPath
  });
  let child;
  try {
    child = spawn(resolved, plan.bwrapArgs, {
      stdio: stdioOptions.stdio ?? "inherit",
      env: parentEnv,
      detached: stdioOptions.detached === true,
      signal: stdioOptions.signal ?? undefined
    });
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED,
      `bwrap child failed to spawn: ${resolved}`,
      { errno: err?.code ?? null, message: err?.message ?? null }
    );
  }
  return child;
}
