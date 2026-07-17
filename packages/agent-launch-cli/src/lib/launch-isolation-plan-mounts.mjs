import path from "node:path";
import { realpathSync, statSync } from "node:fs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  assertAbsoluteSafePath,
  fail,
  isNonEmptyString,
  isWithinRepo
} from "./launch-isolation-errors.mjs";
import {
  normalizeBindEntry,
  validateAndResolveCwd
} from "./launch-isolation-paths.mjs";
import {
  assertFamilyRuntimeReadOnlyRootSafe,
  assertFamilyRuntimeWritableRootSafe
} from "./launch-isolation-family-runtime.mjs";
import { applyBwrapEnvPolicy } from "./launch-isolation-env-policy.mjs";
import {
  collectDedupedSrcBinds,
  collectRealpathDedupedRoots
} from "./launch-isolation-bwrap.mjs";

const BIND_DEDUP_SEPARATOR = "\u0000";

function assertHomeWritableDstOutsideRepo(dst, repoReal, label) {
  if (isWithinRepo(dst, repoReal)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL,
      `${label} dst must resolve outside the repo (write_scope owns in-repo writable binds): ${dst}`,
      { dst, repoReal }
    );
  }
  let probe = dst;
  for (;;) {
    let real;
    try {
      real = realpathSync(probe);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return;
      probe = parent;
      continue;
    }
    if (isWithinRepo(real, repoReal)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL,
        `${label} dst realpath must resolve outside the repo (write_scope owns in-repo writable binds): ${dst} -> ${real}`,
        { dst, real, repoReal }
      );
    }
    return;
  }
}

export function prepareBubblewrapPlanMounts({
  writableRoots,
  writableFiles,
  runtimeRoots,
  readOnlyRoots,
  homePolicy,
  familyRuntimeReadOnlyRoots,
  familySystemReadOnlyRoots,
  familyRuntimeWritableRoots,
  env,
  envPolicy,
  cwd,
  repoReal,
  sparseWorkerNamespace,
  mcpSandboxProfilePlan,
  mcpReadOnlyRoots,
  resolvedCommand,
  familyRuntimeApprovedPrefixes,
  resolvedFamilyRuntimePolicyProfile
}) {
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

  if (!Array.isArray(writableFiles)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "writableFiles must be an array"
    );
  }
  const effectiveWritableFiles = [
    ...writableFiles,
    ...(mcpSandboxProfilePlan?.writableFiles ?? [])
  ];
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
    if (
      sparseWorkerNamespace !== null &&
      isWithinRepo(bind.dst, repoReal) &&
      bind.src !== "/dev/null"
    ) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL,
        `readOnlyRoots[${i}] may not widen the sparse repository namespace: ${bind.dst}`
      );
    }
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

  const inRepoSecretFileMasks = readOnly.filter(
    ({ src, dst }) => src === "/dev/null" && isWithinRepo(dst, repoReal)
  );

  const homeReads = [];

  const homeWritableFiles = [];
  if (homePolicy !== null && homePolicy !== undefined) {
    if (typeof homePolicy !== "object" || Array.isArray(homePolicy)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.HOME_POLICY_INVALID,
        "homePolicy must be a plain object"
      );
    }
    for (const key of Object.keys(homePolicy)) {
      if (key !== "reads" && key !== "writableFiles") {
        fail(
          BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.HOME_POLICY_INVALID,
          `homePolicy has unknown key: ${key} (only "reads" and "writableFiles" are supported; broad writable $HOME is not exposed)`
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
    const writableFilesPolicy = Array.isArray(homePolicy.writableFiles)
      ? homePolicy.writableFiles
      : null;
    if (homePolicy.writableFiles !== undefined && writableFilesPolicy === null) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.HOME_POLICY_INVALID,
        "homePolicy.writableFiles must be an array of bind entries"
      );
    }
    const seenHomeWritable = new Set();
    if (writableFilesPolicy) {
      for (let i = 0; i < writableFilesPolicy.length; i += 1) {
        const bind = normalizeBindEntry(
          writableFilesPolicy[i],
          `homePolicy.writableFiles[${i}]`
        );
        assertHomeWritableDstOutsideRepo(
          bind.dst,
          repoReal,
          `homePolicy.writableFiles[${i}]`
        );
        const key = `${bind.src}${BIND_DEDUP_SEPARATOR}${bind.dst}`;
        if (seenHomeWritable.has(key)) continue;
        seenHomeWritable.add(key);
        homeWritableFiles.push(bind);
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

  return {
    writable,
    effectiveWritableFiles,
    runtime,
    readOnly,
    inRepoSecretFileMasks,
    homeReads,
    homeWritableFiles,
    familyRuntime,
    familyRuntimeWritable,
    familySystemReadOnly,
    cwdNormalized,
    policedEnv,
    envPolicyDroppedKeys
  };
}
