import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  assertAbsoluteSafePath,
  fail,
  isNonEmptyString
} from "./launch-isolation-errors.mjs";
import {
  assertExistingDirectory,
  realpathExisting
} from "./launch-isolation-paths.mjs";
import {
  resolveExecutableForPlan,
  resolverPathFromEnv
} from "./launch-isolation-executable.mjs";
import {
  normalizeCommandResolutionOverride,
  resolveFamilyRuntimeHomePolicyProfile
} from "./launch-isolation-family-runtime.mjs";
import { normalizeProvisionedWorktreeGitIsolation } from "./launch-isolation-git-binding.mjs";
import { buildSparseWorkerNamespace } from "./launch-isolation-worker-scope.mjs";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT } from "@agent-chassis/wiki-core";

function sparseNamespaceShowsPrivatePath(namespace, privatePath) {
  if (namespace === null) return true;
  const visible = [...namespace.readable, ...namespace.writable].map(({ absolute }) => absolute);
  return visible.some((entry) => privatePath === entry || privatePath.startsWith(`${entry}${path.sep}`));
}

function resolvePrivateReadOnlyMasks(repoReal, sparseWorkerNamespace, writableRoots) {
  const privatePath = path.join(
    repoReal, ...CONTROLLED_CONTRACT_PRIVATE_PATH_ROOT.split("/")
  );
  if (!sparseNamespaceShowsPrivatePath(sparseWorkerNamespace, privatePath)) return Object.freeze([]);
  if (sparseWorkerNamespace !== null &&
      !sparseWorkerNamespace.exclusions.some(({ absolute }) => absolute === privatePath)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PRIVATE_REPOSITORY_PATH_CONFINEMENT_UNAVAILABLE,
      "worker scope authority does not carry the required private-family exclusion"
    );
  }
  let stat;
  try {
    stat = lstatSync(privatePath);
  } catch (error) {
    if (error?.code === "ENOENT" && !(Array.isArray(writableRoots) && writableRoots.some((root) =>
      typeof root === "string" && path.isAbsolute(root) &&
      (privatePath === path.normalize(root) || privatePath.startsWith(`${path.normalize(root)}${path.sep}`))
    ))) return Object.freeze([]);
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PRIVATE_REPOSITORY_PATH_CONFINEMENT_UNAVAILABLE,
      "private repository path could not be inspected",
      { errno: error?.code ?? null }
    );
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(privatePath) !== privatePath) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PRIVATE_REPOSITORY_PATH_CONFINEMENT_UNAVAILABLE,
      "private repository path is not a canonical directory"
    );
  }
  return Object.freeze([privatePath]);
}

export function prepareBubblewrapPlanCore({
  repo,
  command,
  args,
  env,
  writableRoots,
  writableFiles,
  provisionedWorktreeGitIdentity,
  provisionedWorktreeGitBinding,
  workerScopeAuthority,
  familyRuntimeMountPrefixes,
  familyRuntimePolicyProfile,
  commandResolution,
  systemReadOnlyRoots,
  tmpfsDirs,
  maskTmpfsDirs,
  newSession
}) {
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
  const provisionedGitIsolation = normalizeProvisionedWorktreeGitIsolation(
    provisionedWorktreeGitIdentity ?? provisionedWorktreeGitBinding,
    repoReal
  );
  const sparseWorkerNamespace = workerScopeAuthority === null || workerScopeAuthority === undefined
    ? null
    : buildSparseWorkerNamespace({
        authority: workerScopeAuthority,
        repoReal,
        writableRoots,
        writableFiles
      });
  const privateReadOnlyMaskDirsResolved = resolvePrivateReadOnlyMasks(
    repoReal, sparseWorkerNamespace, writableRoots
  );

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
  return {
    repoReal,
    provisionedGitIsolation,
    sparseWorkerNamespace,
    resolvedFamilyRuntimePolicyProfile,
    systemRoots,
    tmpfsDirsResolved,
    maskTmpfsDirsResolved,
    privateReadOnlyMaskDirsResolved,
    familyRuntimeApprovedPrefixes,
    resolvedCommand
  };
}
