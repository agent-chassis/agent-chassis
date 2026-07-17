import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION,
  assertAbsoluteSafePath,
  isNonEmptyString
} from "./launch-isolation-errors.mjs";
import { prepareWritableFiles } from "./launch-isolation-paths.mjs";
import { DEFAULT_SYSTEM_READ_ONLY_ROOTS } from "./launch-isolation-executable.mjs";
import { prepareBubblewrapPlanCore } from "./launch-isolation-plan-core.mjs";
import { prepareBubblewrapPlanMounts } from "./launch-isolation-plan-mounts.mjs";
import { buildBubblewrapArgs } from "./launch-isolation-bwrap-args.mjs";

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
  provisionedWorktreeGitIdentity = null,
  workerScopeAuthority = null,
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
  provisionedWorktreeGitBinding = null,
  shareNet = true,

  newSession = true,
  bwrapPath = null
} = {}) {
  const {
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
  } = prepareBubblewrapPlanCore({
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
  });

  const {
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
  } = prepareBubblewrapPlanMounts({
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
  });

  const pinnedBwrapPath = isNonEmptyString(bwrapPath)
    ? assertAbsoluteSafePath(bwrapPath, "bwrapPath")
    : null;

  const writableFilePreparation = prepareWritableFiles(effectiveWritableFiles, repoReal, {
    refuseSymlinks: sparseWorkerNamespace !== null,
    attemptBinding: sparseWorkerNamespace === null
      ? null
      : Object.freeze({
          unit_address: sparseWorkerNamespace.authority.unit_address,
          selected_unit_address: sparseWorkerNamespace.authority.selected_unit.address,
          source_digest: sparseWorkerNamespace.authority.source_digest
        })
  });
  const writableFileEntries = writableFilePreparation.entries;

  const bwrapArgs = buildBubblewrapArgs({
    systemRoots,
    shareNet,
    newSession,
    tmpfsDirsResolved,
    sparseWorkerNamespace,
    repoReal,
    maskTmpfsDirsResolved,
    inRepoSecretFileMasks,
    readOnly,
    homeReads,
    homeWritableFiles,
    familySystemReadOnly,
    familyRuntime,
    familyRuntimeWritable,
    writable,
    writableFileEntries,
    runtime,
    provisionedGitIsolation,
    policedEnv,
    cwdNormalized,
    resolvedCommand,
    args
  });

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
      writableFileEntries.map((entry) => Object.freeze({
        real: entry.real,
        precreated: entry.precreated
      }))
    ),
    writableFilePrecreationCleanup: writableFilePreparation.cleanup,
    workerScopeAuthority: sparseWorkerNamespace?.authority ?? null,
    sparseWorkerNamespace,
    runtimeRoots: Object.freeze([...runtime]),
    provisionedWorktreeGitIsolation: provisionedGitIsolation,
    tmpfsDirs: Object.freeze([...tmpfsDirsResolved]),
    maskTmpfsDirs: Object.freeze([...maskTmpfsDirsResolved]),
    readOnlyRoots: Object.freeze(readOnly.map((b) => Object.freeze({ ...b }))),
    homePolicyReads: Object.freeze(homeReads.map((b) => Object.freeze({ ...b }))),
    homePolicyWritableFiles: Object.freeze(
      homeWritableFiles.map((b) => Object.freeze({ ...b }))
    ),
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
