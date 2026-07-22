

import path from "node:path";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";

import {
  assertBubblewrapAvailable,
  BubblewrapIsolationError,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  buildBubblewrapLaunchPlan,
  buildFamilyRuntimeCommandResolution,
  mergeFamilyRuntimeReadOnlyRoots,
  resolveFamilyRuntimeExecutable
} from "./launch-isolation.mjs";
import {
  buildOrchestratorMcpSandboxProfileRequest
} from "./mcp-sandbox-profile.mjs";

function fail(code, message, detail = null) {
  throw new BubblewrapIsolationError(`agent-launch isolation: ${message}`, { code, detail });
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function deriveLauncherOwnedDispatchWorktreeRoot(repo) {
  if (!isNonEmptyString(repo)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.REPO_INVALID,
      `orchestrator managed-worktree root requires a repo path, got: ${typeof repo}`
    );
  }
  const repoReal = realpathSync(path.resolve(repo));
  return path.join(path.dirname(repoReal), ".agent-worktrees", path.basename(repoReal));
}

export function prepareLauncherOwnedDispatchWorktreeRoot({
  repo,
  dispatchWorktreeRoot = null
} = {}) {
  const derivedRoot = deriveLauncherOwnedDispatchWorktreeRoot(repo);
  if (
    dispatchWorktreeRoot !== null &&
    (!isNonEmptyString(dispatchWorktreeRoot) || path.resolve(dispatchWorktreeRoot) !== derivedRoot)
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      `carried dispatchWorktreeRoot disagrees with launcher-derived root for ${realpathSync(path.resolve(repo))}`,
      { carried: dispatchWorktreeRoot, derived: derivedRoot }
    );
  }

  mkdirSync(derivedRoot, { recursive: true });
  const rootStat = lstatSync(derivedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(derivedRoot) !== derivedRoot) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      `launcher-derived managed-worktree root must be an exact real directory: ${derivedRoot}`
    );
  }
  return derivedRoot;
}

export const INTERACTIVE_ORCHESTRATOR_COORDINATION_WRITABLE_SUBPATHS = Object.freeze([
  "docs",
  "wiki"
]);

export const ORCHESTRATOR_ISOLATION_MODES = Object.freeze({
  BUBBLEWRAP: "bubblewrap",
  DIRECT: "direct"
});

export const ORCHESTRATOR_DIRECT_LAUNCH_PLAN_SCHEMA_VERSION =
  "orchestrator-direct-launch-plan.v1";

export const OPERATOR_DIRECT_MODE_WARNING =
  "agent-launch: bubblewrap (bwrap) is unavailable or unsupported on this host; " +
  "the operator orchestrator is launching in DIRECT mode. OS-level bubblewrap " +
  "filesystem isolation is NOT active and no sandboxed write-scope enforcement " +
  "applies — only your normal OS user permissions protect the repository. This " +
  "weaker posture is operator-only and is never used for structured " +
  "worker/reviewer/redteam dispatch.";

function buildOrchestratorIsolationMetadata({ mode, diagnostic = null } = {}) {
  const isDirect = mode === ORCHESTRATOR_ISOLATION_MODES.DIRECT;
  return Object.freeze({
    mode,
    backend: mode,
    bwrap_available: !isDirect,
    os_filesystem_isolation: !isDirect,
    write_scope_enforced: !isDirect,
    warning: isDirect ? OPERATOR_DIRECT_MODE_WARNING : null,
    diagnostic: diagnostic ? Object.freeze({ ...diagnostic }) : null
  });
}

export function probeOrchestratorBwrapAvailability({ env = process.env, bwrapPath = null } = {}) {
  try {
    const resolved = assertBubblewrapAvailable({ env, bwrapPath });
    return { available: true, bwrapPath: resolved, diagnostic: null };
  } catch (error) {
    if (error instanceof BubblewrapIsolationError) {
      return {
        available: false,
        bwrapPath: null,
        diagnostic: {
          code: error.code,
          message: error.message,
          detail: error.detail ?? null
        }
      };
    }
    throw error;
  }
}

function buildOrchestratorBwrapPlanForPosture({
  posture,
  newSession,
  repo,
  command,
  args = [],
  env = null,
  runtimeDir,

  appStateHomeDir = null,
  homeReadOnlyFiles = [],
  familyRuntimeReadOnlyRoots = [],
  familyRuntimePolicyProfile = null,
  dispatchWorktreeRoot = null,
  resolveExecutable = resolveFamilyRuntimeExecutable
} = {}) {
  if (!isNonEmptyString(repo)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.REPO_INVALID,
      `${posture} orchestrator profile requires a repo path, got: ${typeof repo}`
    );
  }
  if (!isNonEmptyString(runtimeDir)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      `${posture} orchestrator profile requires a runtimeDir path, got: ${typeof runtimeDir}`
    );
  }

  const envPath = env && typeof env === "object" ? env.PATH : null;
  const resolverPathEnv = typeof envPath === "string" && envPath.length > 0 ? envPath : null;
  const resolved = resolveExecutable({
    executablePath: command,
    pathEnv: resolverPathEnv,
    approvedRuntimePrefixes: familyRuntimePolicyProfile?.executablePrefixes,
    familyRuntimePolicyProfile,
    label: `${posture}OrchestratorExecutable`
  });
  const mergedFamilyRuntimeReadOnlyRoots = mergeFamilyRuntimeReadOnlyRoots(
    familyRuntimeReadOnlyRoots,
    resolved.readOnlyRoots
  );
  const commandResolution = buildFamilyRuntimeCommandResolution(resolved);
  const managedWorktreeReadRoot = prepareLauncherOwnedDispatchWorktreeRoot({
    repo,
    dispatchWorktreeRoot
  });

  const runtimeRoots = [runtimeDir];
  if (isNonEmptyString(appStateHomeDir)) {
    runtimeRoots.push(appStateHomeDir);
  }

  const reads = Array.isArray(homeReadOnlyFiles)
    ? homeReadOnlyFiles.filter((entry) => isNonEmptyString(entry))
    : [];
  const homePolicy = reads.length > 0 ? { reads: [...reads] } : null;

  const bwrapPlan = buildBubblewrapLaunchPlan({
    repo,
    command,
    args,
    cwd: repo,
    env,

    envPolicy: null,
    writableRoots: INTERACTIVE_ORCHESTRATOR_COORDINATION_WRITABLE_SUBPATHS.map((subpath) =>
      path.join(repo, subpath)
    ),
    mcpSandboxProfile: buildOrchestratorMcpSandboxProfileRequest(),
    readOnlyRoots: [managedWorktreeReadRoot],
    runtimeRoots,
    homePolicy,
    familyRuntimeReadOnlyRoots: mergedFamilyRuntimeReadOnlyRoots,
    commandResolution,
    familyRuntimePolicyProfile,
    shareNet: true,

    newSession
  });

  return Object.freeze({
    ...bwrapPlan,
    isolationMode: ORCHESTRATOR_ISOLATION_MODES.BUBBLEWRAP,
    isolation: buildOrchestratorIsolationMetadata({
      mode: ORCHESTRATOR_ISOLATION_MODES.BUBBLEWRAP
    })
  });
}

export function buildInteractiveOrchestratorBwrapPlan(profile = {}) {
  return buildOrchestratorBwrapPlanForPosture({
    ...profile,
    posture: "interactive",
    newSession: false
  });
}

export function buildHeadlessOrchestratorBwrapPlan(profile = {}) {
  return buildOrchestratorBwrapPlanForPosture({
    ...profile,
    posture: "headless",
    newSession: true
  });
}

export function buildInteractiveOrchestratorDirectPlan({
  repo,
  command,
  args = [],
  env = null,
  runtimeDir,
  appStateHomeDir = null,
  diagnostic = null
} = {}) {
  if (!isNonEmptyString(repo)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.REPO_INVALID,
      `interactive orchestrator direct profile requires a repo path, got: ${typeof repo}`
    );
  }
  if (!isNonEmptyString(runtimeDir)) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BIND_ENTRY_INVALID,
      `interactive orchestrator direct profile requires a runtimeDir path, got: ${typeof runtimeDir}`
    );
  }

  return Object.freeze({
    schemaVersion: ORCHESTRATOR_DIRECT_LAUNCH_PLAN_SCHEMA_VERSION,
    isolationMode: ORCHESTRATOR_ISOLATION_MODES.DIRECT,
    isolation: buildOrchestratorIsolationMetadata({
      mode: ORCHESTRATOR_ISOLATION_MODES.DIRECT,
      diagnostic
    }),
    warning: OPERATOR_DIRECT_MODE_WARNING,
    repo,
    cwd: repo,

    command,
    childCommand: command,
    childCommandInput: command,
    args: Object.freeze([...args]),
    childArgs: Object.freeze([...args]),
    env: env && typeof env === "object" && !Array.isArray(env)
      ? Object.freeze({ ...env })
      : null,
    runtimeDir,
    appStateHomeDir: isNonEmptyString(appStateHomeDir) ? appStateHomeDir : null,
    shareNet: true
  });
}

export function buildInteractiveOrchestratorLaunchPlan({
  operatorDirectModeAllowed = false,
  bwrapPath = null,
  ...profile
} = {}) {
  const probe = probeOrchestratorBwrapAvailability({
    env: profile.env ?? process.env,
    bwrapPath
  });
  if (probe.available) {
    return buildInteractiveOrchestratorBwrapPlan(profile);
  }
  if (operatorDirectModeAllowed !== true) {

    fail(
      probe.diagnostic?.code ?? BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE,
      probe.diagnostic?.message
        ? `bubblewrap isolation required but unavailable: ${probe.diagnostic.message}`
        : "bubblewrap isolation required but unavailable",
      probe.diagnostic?.detail ?? null
    );
  }
  return buildInteractiveOrchestratorDirectPlan({
    repo: profile.repo,
    command: profile.command,
    args: profile.args ?? [],
    env: profile.env ?? null,
    runtimeDir: profile.runtimeDir,
    appStateHomeDir: profile.appStateHomeDir ?? null,
    diagnostic: probe.diagnostic
  });
}
