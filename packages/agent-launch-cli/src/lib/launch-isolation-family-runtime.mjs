

import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import {
  resolveLauncherRuntimeHomePolicyFacts
} from "./launcher-runtime-home-policy.mjs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  assertAbsoluteSafePath,
  fail,
  isNonEmptyString
} from "./launch-isolation-errors.mjs";
import {
  resolveBasenameOnPath,
  resolverPathFromEnv
} from "./launch-isolation-executable.mjs";

const EMPTY_FROZEN_LIST = Object.freeze([]);

const FAMILY_RUNTIME_RESOLVER_OUTPUT_BRAND = Symbol(
  "agent_launch.family_runtime_resolver_output.v1"
);
const FAMILY_RUNTIME_COMMAND_RESOLUTION_BRAND = Symbol(
  "agent_launch.family_runtime_command_resolution.v1"
);

function stampBrand(obj, brand) {
  Object.defineProperty(obj, brand, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false
  });
  return obj;
}

export function deriveFamilyRuntimeHomePolicyProfile({ policyFacts } = {}) {
  if (policyFacts === undefined || policyFacts === null) {
    return EMPTY_FAMILY_RUNTIME_POLICY_PROFILE;
  }
  const facts = policyFacts;
  const localPrefix = path.dirname(path.dirname(facts.paths.executable));
  const geminiParent = path.join(facts.launcherOwnedHostHome, ".gemini");
  const deniedPrefixes = facts.deniedPaths.filter(
    (denied) => denied !== facts.launcherOwnedHostHome
  );
  return Object.freeze({
    policyFacts: facts,
    localPrefix,
    geminiParent,
    executablePrefixes: Object.freeze([
      localPrefix,
      ...facts.systemRuntimePrefixes
    ]),
    executableDeniedPaths: Object.freeze([...deniedPrefixes]),
    broadHome: facts.launcherOwnedHostHome,
    mountPrefixes: Object.freeze([
      localPrefix,
      path.join(geminiParent, "antigravity-cli"),
      path.join(geminiParent, "config"),
      ...facts.systemRuntimePrefixes
    ]),
    writableMountPrefixes: Object.freeze([
      geminiParent
    ]),
    mountDeniedPaths: Object.freeze([...deniedPrefixes]),
    mountBroadDeniedRoots: Object.freeze([
      facts.launcherOwnedHostHome,
      geminiParent
    ])
  });
}

const EMPTY_FAMILY_RUNTIME_POLICY_PROFILE = Object.freeze({
  policyFacts: null,
  localPrefix: null,
  geminiParent: null,
  executablePrefixes: EMPTY_FROZEN_LIST,
  executableDeniedPaths: EMPTY_FROZEN_LIST,
  broadHome: null,
  mountPrefixes: EMPTY_FROZEN_LIST,
  writableMountPrefixes: EMPTY_FROZEN_LIST,
  mountDeniedPaths: EMPTY_FROZEN_LIST,
  mountBroadDeniedRoots: EMPTY_FROZEN_LIST
});

export function resolveFamilyRuntimeHomePolicyProfile(options = {}) {
  const resolved = resolveLauncherRuntimeHomePolicyFacts({
    ...options,
    source: options.source ?? "family_runtime_host_home"
  });
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    profile: deriveFamilyRuntimeHomePolicyProfile({ policyFacts: resolved.facts })
  };
}

const LEGACY_FAMILY_RUNTIME_POLICY_PROFILE = EMPTY_FAMILY_RUNTIME_POLICY_PROFILE;

export const DEFAULT_FAMILY_RUNTIME_EXECUTABLE_PREFIXES =
  LEGACY_FAMILY_RUNTIME_POLICY_PROFILE.executablePrefixes;

export const FAMILY_RUNTIME_EXECUTABLE_DENIED_PATHS =
  LEGACY_FAMILY_RUNTIME_POLICY_PROFILE.executableDeniedPaths;

function isUnderPrefix(target, prefix) {
  if (target === prefix) return true;
  const boundary = prefix === path.sep ? path.sep : prefix + path.sep;
  return target.startsWith(boundary);
}

function firstDenyingPrefix(absolutePath, deniedPaths) {
  for (const denied of deniedPaths) {
    if (isUnderPrefix(absolutePath, denied)) return denied;
  }
  return null;
}

function isUnderAnyPrefix(absolutePath, approvedPrefixes) {
  for (const prefix of approvedPrefixes) {
    if (isUnderPrefix(absolutePath, prefix)) return true;
  }
  return false;
}

function overlapsRepoWriteRoot(absolutePath, repoReal) {
  if (!isNonEmptyString(repoReal)) return false;
  return (
    absolutePath === repoReal
    || isUnderPrefix(absolutePath, repoReal)
    || isUnderPrefix(repoReal, absolutePath)
  );
}

function assertFamilyRuntimeExecutablePathSafe(absolutePath, label, approvedPrefixes, policyProfile) {
  const profile = policyProfile ?? LEGACY_FAMILY_RUNTIME_POLICY_PROFILE;
  if (absolutePath === profile.broadHome) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.EXECUTABLE_PATH_DENIED,
      `${label} must not resolve to the broad home root: ${absolutePath}`
    );
  }
  const denied = firstDenyingPrefix(absolutePath, profile.executableDeniedPaths);
  if (denied !== null) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.EXECUTABLE_PATH_DENIED,
      `${label} must not resolve into a denied credential path (${denied}): ${absolutePath}`
    );
  }
  if (!isUnderAnyPrefix(absolutePath, approvedPrefixes)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.EXECUTABLE_PATH_OUTSIDE_RUNTIME_PREFIXES,
      `${label} must resolve under a launcher-approved runtime prefix: ${absolutePath}`
    );
  }
}

export const DEFAULT_FAMILY_RUNTIME_MOUNT_PREFIXES = Object.freeze([
  ...LEGACY_FAMILY_RUNTIME_POLICY_PROFILE.mountPrefixes
]);

export const DEFAULT_FAMILY_RUNTIME_WRITABLE_MOUNT_PREFIXES = Object.freeze([
  ...LEGACY_FAMILY_RUNTIME_POLICY_PROFILE.writableMountPrefixes
]);

export const FAMILY_RUNTIME_MOUNT_DENIED_PATHS = Object.freeze([
  ...LEGACY_FAMILY_RUNTIME_POLICY_PROFILE.mountDeniedPaths
]);

export const FAMILY_RUNTIME_MOUNT_BROAD_DENIED_ROOTS = Object.freeze([
  ...LEGACY_FAMILY_RUNTIME_POLICY_PROFILE.mountBroadDeniedRoots
]);

function assertFamilyRuntimeReadOnlyRootSafe(absolutePath, label, { approvedPrefixes, repoReal, policyProfile }) {
  const profile = policyProfile ?? LEGACY_FAMILY_RUNTIME_POLICY_PROFILE;
  for (const broad of profile.mountBroadDeniedRoots) {
    if (absolutePath === broad) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FAMILY_RUNTIME_ROOT_DENIED,
        `${label} must not mount the broad root ${broad}: ${absolutePath}`
      );
    }
  }
  const denied = firstDenyingPrefix(absolutePath, profile.mountDeniedPaths);
  if (denied !== null) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FAMILY_RUNTIME_ROOT_DENIED,
      `${label} must not mount a denied credential path (${denied}): ${absolutePath}`
    );
  }
  if (overlapsRepoWriteRoot(absolutePath, repoReal)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FAMILY_RUNTIME_ROOT_DENIED,
      `${label} must not overlap the repo write root (${repoReal}): ${absolutePath}`
    );
  }
  if (!isUnderAnyPrefix(absolutePath, approvedPrefixes)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FAMILY_RUNTIME_ROOT_OUTSIDE_PREFIXES,
      `${label} must resolve under an approved family-runtime mount prefix: ${absolutePath}`
    );
  }
}

function assertFamilyRuntimeWritableRootSafe(absolutePath, label, { approvedPrefixes, repoReal, policyProfile }) {
  const profile = policyProfile ?? LEGACY_FAMILY_RUNTIME_POLICY_PROFILE;
  if (absolutePath === profile.broadHome) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FAMILY_RUNTIME_ROOT_DENIED,
      `${label} must not mount the broad root ${profile.broadHome}: ${absolutePath}`
    );
  }
  const denied = firstDenyingPrefix(absolutePath, profile.mountDeniedPaths);
  if (denied !== null) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FAMILY_RUNTIME_ROOT_DENIED,
      `${label} must not mount a denied credential path (${denied}): ${absolutePath}`
    );
  }
  if (overlapsRepoWriteRoot(absolutePath, repoReal)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FAMILY_RUNTIME_ROOT_DENIED,
      `${label} must not overlap the repo write root (${repoReal}): ${absolutePath}`
    );
  }
  if (!isUnderAnyPrefix(absolutePath, approvedPrefixes)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FAMILY_RUNTIME_ROOT_OUTSIDE_PREFIXES,
      `${label} must resolve under an approved writable family-runtime mount prefix: ${absolutePath}`
    );
  }
}

export function resolveFamilyRuntimeExecutable({
  executablePath,
  pathEnv = null,
  approvedRuntimePrefixes = DEFAULT_FAMILY_RUNTIME_EXECUTABLE_PREFIXES,
  familyRuntimePolicyProfile = LEGACY_FAMILY_RUNTIME_POLICY_PROFILE,
  label = "familyRuntimeExecutable",
  lstatFn = lstatSync,
  realpathFn = realpathSync
} = {}) {
  if (!isNonEmptyString(executablePath)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_INVALID,
      `${label} must be a non-empty string`
    );
  }
  if (!Array.isArray(approvedRuntimePrefixes) || approvedRuntimePrefixes.length === 0) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      `${label} approvedRuntimePrefixes must be a non-empty array`
    );
  }
  const approvedPrefixes = approvedRuntimePrefixes.map((p, i) =>
    assertAbsoluteSafePath(p, `${label}.approvedRuntimePrefixes[${i}]`)
  );

  let lexical;
  if (path.isAbsolute(executablePath)) {
    lexical = assertAbsoluteSafePath(executablePath, label);
  } else if (executablePath.includes("/") || executablePath.includes(path.sep)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_INVALID,
      `${label} must be an absolute path or a bare basename (got relative path with separator): ${executablePath}`
    );
  } else {
    const found = resolveBasenameOnPath(
      executablePath,
      resolverPathFromEnv(isNonEmptyString(pathEnv) ? { PATH: pathEnv } : null)
    );
    if (!found) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_UNRESOLVABLE,
        `${label} not found on trusted PATH: ${executablePath}`
      );
    }
    lexical = assertAbsoluteSafePath(found, label);
  }
  assertFamilyRuntimeExecutablePathSafe(lexical, label, approvedPrefixes, familyRuntimePolicyProfile);

  let isSymlink = false;
  try {
    isSymlink = lstatFn(lexical).isSymbolicLink();
  } catch (err) {
    if (err && err.code !== "ENOENT" && err.code !== "ENOTDIR") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_UNRESOLVABLE,
        `${label} lstat failed: ${lexical}`,
        { errno: err?.code ?? null }
      );
    }
  }

  let real = null;
  try {
    real = assertAbsoluteSafePath(realpathFn(lexical), `${label}.real`);
  } catch (err) {
    if (err instanceof BubblewrapIsolationError) throw err;
    if (err && err.code !== "ENOENT" && err.code !== "ENOTDIR") {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_UNRESOLVABLE,
        `${label} realpath failed: ${lexical}`,
        { errno: err?.code ?? null }
      );
    }
    real = null;
  }
  let installRoot = null;
  if (real !== null) {
    assertFamilyRuntimeExecutablePathSafe(real, `${label}.real`, approvedPrefixes, familyRuntimePolicyProfile);
    installRoot = path.dirname(real);
    assertFamilyRuntimeExecutablePathSafe(installRoot, `${label}.installRoot`, approvedPrefixes, familyRuntimePolicyProfile);
  }

  const readOnlyRoots = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!isNonEmptyString(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    readOnlyRoots.push(candidate);
  };
  add(path.dirname(lexical));
  if (real !== null) add(real);
  if (installRoot !== null) add(installRoot);

  return Object.freeze(stampBrand({
    executablePath: lexical,
    realExecutablePath: real,
    isSymlink,
    installRoot,
    readOnlyRoots: Object.freeze(readOnlyRoots)
  }, FAMILY_RUNTIME_RESOLVER_OUTPUT_BRAND));
}

export function buildFamilyRuntimeCommandResolution(resolved) {
  if (
    resolved === null
    || typeof resolved !== "object"
    || resolved[FAMILY_RUNTIME_RESOLVER_OUTPUT_BRAND] !== true
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_RESOLUTION_UNTRUSTED,
      "commandResolution can only be minted from resolveFamilyRuntimeExecutable output"
    );
  }

  const deferTargetToWorkerBwrap =
    resolved.isSymlink === true && resolved.realExecutablePath === null;
  if (!deferTargetToWorkerBwrap) return null;

  return Object.freeze(stampBrand({
    argvCommand: resolved.executablePath,
    extraReadOnlyRoots: []
  }, FAMILY_RUNTIME_COMMAND_RESOLUTION_BRAND));
}

export function mergeFamilyRuntimeReadOnlyRoots(authAllowlist, executableRoots) {
  const merged = [];
  const seen = new Set();
  for (const list of [authAllowlist, executableRoots]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!isNonEmptyString(entry) || seen.has(entry)) continue;
      seen.add(entry);
      merged.push(entry);
    }
  }
  return merged;
}

export function normalizeCommandResolutionOverride(commandResolution, {
  approvedPrefixes,
  repoReal,
  policyProfile = LEGACY_FAMILY_RUNTIME_POLICY_PROFILE
}) {
  if (
    typeof commandResolution !== "object"
    || commandResolution === null
    || Array.isArray(commandResolution)
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_INVALID,
      "commandResolution override must be a plain object with { argvCommand, extraReadOnlyRoots }"
    );
  }
  if (commandResolution[FAMILY_RUNTIME_COMMAND_RESOLUTION_BRAND] !== true) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_RESOLUTION_UNTRUSTED,
      "commandResolution override must be produced by buildFamilyRuntimeCommandResolution "
        + "(launcher-owned family-runtime resolver provenance); a plain object that merely "
        + "satisfies the approved-prefix mount policy is not accepted"
    );
  }
  const allowedKeys = new Set(["argvCommand", "extraReadOnlyRoots"]);
  for (const key of Object.keys(commandResolution)) {
    if (!allowedKeys.has(key)) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.COMMAND_INVALID,
        `commandResolution override has unknown key: ${key}`
      );
    }
  }
  const argvCommand = assertAbsoluteSafePath(
    commandResolution.argvCommand,
    "commandResolution.argvCommand"
  );
  assertFamilyRuntimeReadOnlyRootSafe(argvCommand, "commandResolution.argvCommand", {
    approvedPrefixes,
    repoReal,
    policyProfile
  });
  const rawRoots = commandResolution.extraReadOnlyRoots;
  if (rawRoots !== undefined && rawRoots !== null && !Array.isArray(rawRoots)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      "commandResolution.extraReadOnlyRoots must be an array of absolute paths"
    );
  }
  const extraReadOnlyRoots = [];
  if (Array.isArray(rawRoots)) {
    for (let i = 0; i < rawRoots.length; i += 1) {
      const root = assertAbsoluteSafePath(
        rawRoots[i],
        `commandResolution.extraReadOnlyRoots[${i}]`
      );
      assertFamilyRuntimeReadOnlyRootSafe(
      root,
      `commandResolution.extraReadOnlyRoots[${i}]`,
      { approvedPrefixes, repoReal, policyProfile }
    );
      extraReadOnlyRoots.push(root);
    }
  }
  return { argvCommand, extraReadOnlyRoots };
}

export {
  assertFamilyRuntimeReadOnlyRootSafe,
  assertFamilyRuntimeWritableRootSafe
};
