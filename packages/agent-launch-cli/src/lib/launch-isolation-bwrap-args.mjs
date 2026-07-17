import { buildSystemBaselineArgs } from "./launch-isolation-bwrap.mjs";
import { sparseNamespaceSkeleton } from "./launch-isolation-worker-scope.mjs";

export function buildBubblewrapArgs({
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
}) {

  const bwrapArgs = [];
  bwrapArgs.push(...buildSystemBaselineArgs({ systemReadOnlyRoots: systemRoots, shareNet, newSession, tmpfsDirs: tmpfsDirsResolved }));
  if (sparseWorkerNamespace === null) {
    bwrapArgs.push("--ro-bind", repoReal, repoReal);
  } else {

    bwrapArgs.push("--tmpfs", repoReal);
    for (const dir of sparseWorkerNamespace.skeleton) {
      bwrapArgs.push("--dir", dir);
    }
    for (const dir of sparseNamespaceSkeleton(maskTmpfsDirsResolved, repoReal)) {
      bwrapArgs.push("--dir", dir);
    }
    for (const dir of maskTmpfsDirsResolved) {
      bwrapArgs.push("--dir", dir);
    }
    for (const entry of sparseWorkerNamespace.readable) {
      bwrapArgs.push("--ro-bind", entry.absolute, entry.absolute);
    }

    for (const entry of sparseWorkerNamespace.writable) {
      bwrapArgs.push("--ro-bind", entry.absolute, entry.absolute);
    }
    for (const { src, dst } of inRepoSecretFileMasks) {
      bwrapArgs.push("--ro-bind", src, dst);
    }
    bwrapArgs.push("--remount-ro", repoReal);
  }
  for (const { src, dst } of readOnly) {
    bwrapArgs.push("--ro-bind", src, dst);
  }
  for (const { src, dst } of homeReads) {
    bwrapArgs.push("--ro-bind-try", src, dst);
  }

  for (const { src, dst } of homeWritableFiles) {
    bwrapArgs.push("--bind", src, dst);
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

  if (sparseWorkerNamespace === null) {
    for (const { src, dst } of provisionedGitIsolation?.readOnlyBinds ?? []) {
      bwrapArgs.push("--ro-bind", src, dst);
    }
  }

  for (const { src, dst } of inRepoSecretFileMasks) {
    bwrapArgs.push("--ro-bind", src, dst);
  }

  for (const dir of maskTmpfsDirsResolved) {
    bwrapArgs.push("--tmpfs", dir);
    if (sparseWorkerNamespace !== null) {
      bwrapArgs.push("--remount-ro", dir);
    }
  }
  for (const [k, v] of Object.entries(policedEnv)) {
    bwrapArgs.push("--setenv", k, v);
  }
  bwrapArgs.push("--chdir", cwdNormalized);

  bwrapArgs.push("--", resolvedCommand.argvCommand, ...args);

  return bwrapArgs;
}
