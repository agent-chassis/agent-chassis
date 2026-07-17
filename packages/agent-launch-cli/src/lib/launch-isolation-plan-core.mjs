import {
  MCP_SANDBOX_RUNTIME_BLOCKER_CODES,
  McpSandboxProfileError,
  buildMcpSandboxProfileMountPlan
} from "./mcp-sandbox-profile.mjs";
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
  collectCodexMcpReadOnlyRoots,
  resolveExecutableForPlan,
  resolverPathFromEnv
} from "./launch-isolation-executable.mjs";
import {
  normalizeCommandResolutionOverride,
  resolveFamilyRuntimeHomePolicyProfile
} from "./launch-isolation-family-runtime.mjs";
import { normalizeProvisionedWorktreeGitIsolation } from "./launch-isolation-git-binding.mjs";
import { buildSparseWorkerNamespace } from "./launch-isolation-worker-scope.mjs";

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
  mcpSandboxProfile,
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
    repoReal,
    {
      projectReadOnlyBinds: workerScopeAuthority === null || workerScopeAuthority === undefined
    }
  );
  const sparseWorkerNamespace = workerScopeAuthority === null || workerScopeAuthority === undefined
    ? null
    : buildSparseWorkerNamespace({
        authority: workerScopeAuthority,
        repoReal,
        writableRoots,
        writableFiles
      });

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
    if (sparseWorkerNamespace !== null) {
      fail(
        BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.SANDBOX_WRITE_DENIAL,
        "managed sparse workers do not accept a general MCP sandbox profile"
      );
    }
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

  return {
    repoReal,
    provisionedGitIsolation,
    sparseWorkerNamespace,
    resolvedFamilyRuntimePolicyProfile,
    systemRoots,
    tmpfsDirsResolved,
    maskTmpfsDirsResolved,
    familyRuntimeApprovedPrefixes,
    resolvedCommand,
    mcpReadOnlyRoots,
    mcpSandboxProfilePlan
  };
}
