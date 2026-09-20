import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION,
  assertAbsoluteSafePath,
  fail,
  isNonEmptyString
} from "./launch-isolation-errors.mjs";
import { prepareWritableFiles } from "./launch-isolation-paths.mjs";
import {
  prepareReadOnlyProjectionMountpoints,
  prepareRequiredReadOnlyFiles
} from "./launch-isolation-required-read-only-files.mjs";
import { DEFAULT_SYSTEM_READ_ONLY_ROOTS } from "./launch-isolation-executable.mjs";
import { prepareBubblewrapPlanCore } from "./launch-isolation-plan-core.mjs";
import {
  composeDecisionsReadOnlyOverlay,
  prepareBubblewrapPlanMounts,
  resolveDecisionsReadOnlyCarveout
} from "./launch-isolation-plan-mounts.mjs";
import { buildBubblewrapArgs } from "./launch-isolation-bwrap-args.mjs";
import {
  prepareGitStatusWrapperProjection
} from "./launch-isolation-git-status-wrapper.mjs";
import { prepareSparseWorkerWritableDirectories } from "./launch-isolation-worker-scope.mjs";
import {
  assertCheckoutDerivedGitMetadata,
  assertFindingsRoleGitMetadataReadOnly
} from "./launch-isolation-findings-git-metadata.mjs";

import { assertTrustedStdioMcpConduitBinding } from "./stdio-mcp-conduit-contract.mjs";

export function buildBubblewrapLaunchPlan(options = {}) {
  const preparation = { rollback: () => null };
  try {
    return composeBubblewrapLaunchPlan(options, preparation);
  } catch (error) {
    preparation.rollback();
    throw error;
  }
}

function composeBubblewrapLaunchPlan({
  repo,
  command,
  args = [],
  cwd = null,
  env = null,
  readOnlyRoots = [],
  requiredReadOnlyFiles = [],
  writableRoots = [],
  writableFiles = [],
  runtimeRoots = [],

  gitMetadataProjection = null,
  provisionedWorktreeGitIdentity = null,
  workerScopeAuthority = null,
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

  useSystemTmp = false,
  maskTmpfsDirs = [],
  provisionedWorktreeGitBinding = null,
  shareNet = true,

  newSession = true,
  bwrapPath = null,

  installGitStatusWrapper = false,
  stdioMcpConduit = null
} = {}, preparation = { rollback: () => null }) {
  if (
    gitMetadataProjection !== null
    && (provisionedWorktreeGitIdentity !== null || provisionedWorktreeGitBinding !== null)
  ) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_INVALID,
      "required Git metadata must be derived from the launcher-created checkout; supplied Git identity fields are forbidden"
    );
  }

  if (gitMetadataProjection !== null && workerScopeAuthority !== null) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_INVALID,
      "required Git metadata needs full repository read entitlement; a sparse read scope cannot receive a repository object store"
    );
  }
  const trustedStdioMcpConduit = stdioMcpConduit === null
    ? null
    : assertTrustedStdioMcpConduitBinding(stdioMcpConduit);
  const directoryPreparation = prepareSparseWorkerWritableDirectories({
    authority: workerScopeAuthority,
    repo
  });
  preparation.rollback = directoryPreparation.rollback;
  const {
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
    familyRuntimeMountPrefixes,
    familyRuntimePolicyProfile,
    commandResolution,
    systemReadOnlyRoots,
    tmpfsDirs,
    maskTmpfsDirs,
    newSession
  });

  const gitStatusWrapper = prepareGitStatusWrapperProjection({
    requested: installGitStatusWrapper === true,
    repoReal,
    privateReadOnlyMaskDirs: privateReadOnlyMaskDirsResolved,
    sparseWorkerNamespace,
    env,
    envPolicy,
    systemRoots
  });

  const findingsRoleGitMetadata = gitMetadataProjection === null
    ? null
    : assertCheckoutDerivedGitMetadata(gitMetadataProjection, repoReal);
  const effectiveReadOnlyRoots = Array.isArray(readOnlyRoots)
    ? [
        ...readOnlyRoots,
        ...(findingsRoleGitMetadata?.readOnlyBinds ?? [])
      ]
    : readOnlyRoots;

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
    readOnlyRoots: effectiveReadOnlyRoots,
    homePolicy,
    familyRuntimeReadOnlyRoots,
    familySystemReadOnlyRoots,
    familyRuntimeWritableRoots,
    env: gitStatusWrapper === null ? env : gitStatusWrapper.env,
    envPolicy: gitStatusWrapper === null ? envPolicy : gitStatusWrapper.envPolicy,
    cwd,
    repoReal,
    sparseWorkerNamespace,
    resolvedCommand,
    familyRuntimeApprovedPrefixes,
    resolvedFamilyRuntimePolicyProfile
  });

  assertFindingsRoleGitMetadataReadOnly(findingsRoleGitMetadata, {
    writableRoots: writable,
    writableFiles: effectiveWritableFiles,
    runtimeRoots: runtime,
    homeWritableFiles,
    familyRuntimeWritableRoots: familyRuntimeWritable
  });

  const decisionsCarveout = resolveDecisionsReadOnlyCarveout({
    repoReal,
    sparseWorkerNamespace,
    maskTmpfsDirsResolved,
    inRepoSecretFileMasks,
    writable,
    runtime
  });

  const requiredReadOnlyFileEntries = prepareRequiredReadOnlyFiles(
    requiredReadOnlyFiles,
    readOnly
  );

  const pinnedBwrapPath = isNonEmptyString(bwrapPath)
    ? assertAbsoluteSafePath(bwrapPath, "bwrapPath")
    : null;

  const writableFilePreparation = prepareWritableFiles(effectiveWritableFiles, repoReal, {
    refuseSymlinks: sparseWorkerNamespace !== null,
    preparedDirectories: directoryPreparation.entries,
    attemptBinding: sparseWorkerNamespace === null
      ? null
      : Object.freeze({
          unit_address: sparseWorkerNamespace.authority.unit_address,
          selected_unit_address: sparseWorkerNamespace.authority.selected_unit.address,
          source_digest: sparseWorkerNamespace.authority.source_digest
        })
  });
  const writableFileEntries = writableFilePreparation.entries;

  let readOnlyProjectionMountpoints;
  try {
    readOnlyProjectionMountpoints = prepareReadOnlyProjectionMountpoints(readOnly, {
      repoReal,
      writableRoots: writable,
      runtimeRoots: runtime,
      writableFiles: writableFileEntries,
      sparseWorkerNamespace,

      launchContext: {
        role: sparseWorkerNamespace === null ? null : "worker"
      }
    });
  } catch (error) {
    writableFilePreparation.cleanup.cleanup();
    throw error;
  }

  const decisionsReadOnly = composeDecisionsReadOnlyOverlay(decisionsCarveout, {
    writable,
    writableFileEntries,
    runtime
  });

  const bwrapArgs = buildBubblewrapArgs({
    systemRoots,
    shareNet,
    newSession,
    useSystemTmp,
    tmpfsDirsResolved,
    sparseWorkerNamespace,
    repoReal,
    maskTmpfsDirsResolved,
    privateReadOnlyMaskDirsResolved,
    inRepoSecretFileMasks,
    gitStatusWrapperReadOnlyBinds: gitStatusWrapper?.readOnlyBinds ?? [],
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
    gitNamespaceDirectories: findingsRoleGitMetadata?.namespaceDirectories ?? [],
    decisionsReadOnly,
    policedEnv,
    cwdNormalized,
    resolvedCommand,
    args,
    stdioMcpConduit: trustedStdioMcpConduit
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
    findingsRoleGitMetadata,
    tmpfsDirs: Object.freeze([...tmpfsDirsResolved]),
    maskTmpfsDirs: Object.freeze([...maskTmpfsDirsResolved]),
    privateReadOnlyMaskDirs: privateReadOnlyMaskDirsResolved,

    gitStatusWrapper: gitStatusWrapper === null
      ? null
      : Object.freeze({
          mountDir: gitStatusWrapper.mountDir,
          asset: gitStatusWrapper.asset,
          realGit: gitStatusWrapper.realGit,
          repo: gitStatusWrapper.repo,
          pathspec: gitStatusWrapper.pathspec
        }),
    filesystemConfidentiality: Object.freeze({
      guaranteed: true,
      enforcement_backend: "bwrap",
      private_repository_path_enforced: true
    }),
    readOnlyRoots: Object.freeze(readOnly.map((b) => Object.freeze({ ...b }))),
    ...(requiredReadOnlyFileEntries.length > 0
      ? { requiredReadOnlyFiles: requiredReadOnlyFileEntries }
      : {}),
    ...(readOnlyProjectionMountpoints.length > 0
      ? { readOnlyProjectionMountpoints }
      : {}),
    decisionsReadOnlyRoots: Object.freeze(decisionsReadOnly.map((b) => Object.freeze({ ...b }))),
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
    stdioMcpConduit: trustedStdioMcpConduit
  });
}
