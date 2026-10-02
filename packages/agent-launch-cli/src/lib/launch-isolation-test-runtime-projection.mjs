

import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { inspectDependencyMountpoint } from "./dependency-mountpoint-occupant.mjs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  fail,
  isWithinRepo
} from "./launch-isolation-errors.mjs";
import { readShebangLine, resolveBasenameOnPath } from "./launch-isolation-executable.mjs";
import { prependPathEntry } from "./launch-isolation-package-asset.mjs";
import {
  createMissingDirectoryLeaf,
  releasePreparedDirectoriesOnRefusal
} from "./launch-isolation-worker-scope.mjs";
import { TEST_RUNTIME_READINESS_CODES, loadReadiness } from "./test-runtime-setup/readiness.mjs";
import {
  WorkerTestRuntimePreparationError,
  isComposedWorkerTestRuntime
} from "./test-execution/worker-runtime.mjs";

const REFUSED = BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.TEST_RUNTIME_PROJECTION_REFUSED;

function refuse(message, detail) {
  fail(REFUSED, message, { authority_limb: "mechanical", ...detail });
}

function directoryIdentity(absolute) {
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) });
}

function sourceIdentity(src) {
  let real;
  try {
    real = realpathSync(src);
  } catch (error) {
    refuse(`prepared dependency source is unavailable: ${src}`,
      { source: src, errno: error?.code ?? null });
  }
  const stat = statSync(real);
  if (!stat.isDirectory()) refuse(`prepared dependency source is not a directory: ${src}`, { source: src });
  return Object.freeze({ real, dev: String(stat.dev), ino: String(stat.ino) });
}

export function prepareWorkerTestRuntimeMounts({ workerTestRuntime = null, sparseWorkerNamespace,
  repoReal, writableRoots = [], runtimeRoots = [] }) {
  if (workerTestRuntime === null || workerTestRuntime === undefined) return null;
  if (!isComposedWorkerTestRuntime(workerTestRuntime)) {
    refuse("worker test runtime must be the launcher-composed projection", {});
  }
  if (sparseWorkerNamespace === null) {
    refuse("a worker test runtime projection requires frozen worker scope authority", {});
  }
  const visible = [...sparseWorkerNamespace.readable, ...sparseWorkerNamespace.writable];
  const mutableRoots = [...writableRoots, ...runtimeRoots];
  const created = [];
  const skeletonDirs = [];
  const mounts = [];
  try {
    for (const mount of workerTestRuntime.dependencyMounts) {
      const { dst } = mount;
      const context = { project: mount.project, ecosystem: mount.ecosystem, mountpoint: dst };
      if (!isWithinRepo(dst, repoReal) || dst === repoReal) {
        refuse(`dependency destination is outside the worker checkout: ${dst}`, context);
      }
      const conflicting = visible.filter((entry) => isWithinRepo(entry.absolute, dst));
      if (conflicting.length > 0) {
        refuse(`scope members lie at or below the read-only dependency destination ${dst}`,
          { ...context, members: conflicting.map((entry) => entry.absolute) });
      }
      const source = sourceIdentity(mount.src);
      const alias = mutableRoots.find((root) => isWithinRepo(source.real, root) || isWithinRepo(root, source.real));
      if (alias !== undefined) {
        refuse(`prepared dependency source ${source.real} would also be writable through ${alias}`,
          { ...context, source: source.real, writable_root: alias });
      }
      const container = visible.find((entry) => entry.kind === "directory" &&
        isWithinRepo(dst, entry.absolute));
      let owned = false;
      if (container === undefined) {

        skeletonDirs.push(dst);
      } else {
        const occupant = inspectDependencyMountpoint(dst);
        if (occupant.state === "occupied") {
          refuse(`the dependency mountpoint ${dst} is occupied by a ${occupant.kind}; it was preserved unchanged`,
            { ...context, occupant: occupant.kind, preserved: true });
        }
        if (occupant.state === "absent") {
          const leaf = createMissingDirectoryLeaf(dst, `test runtime dependency mountpoint ${mount.project}`,
            repoReal, Object.freeze({ access: "test_runtime_dependency", member_kind: "mountpoint",
              index: mounts.length, path: path.relative(repoReal, dst) }));
          if (leaf !== null) { created.push(leaf); owned = true; }
        }
      }
      mounts.push(Object.freeze({ src: mount.src, dst, project: mount.project, ecosystem: mount.ecosystem,
        source, skeleton: container === undefined, owned,
        destination: container === undefined ? null : directoryIdentity(dst) }));
    }
  } catch (error) {

    throw releasePreparedDirectoriesOnRefusal(error, created, repoReal);
  }
  return Object.freeze({
    readOnlyBinds: workerTestRuntime.readOnlyBinds,
    tmpfsDirs: Object.freeze([workerTestRuntime.scratchRoot]),
    skeletonDirs: Object.freeze(skeletonDirs),
    dependencyBinds: Object.freeze(mounts.map(({ src, dst }) => Object.freeze({ src, dst }))),
    mounts: Object.freeze(mounts),
    sources: workerTestRuntime.sources,
    created: Object.freeze(created),
    pathPrefix: workerTestRuntime.pathPrefix,
    commands: workerTestRuntime.commands,
    identity: workerTestRuntime.identity,
    publication: workerTestRuntime.publication
  });
}

export function planNamespaceOnlyMountpoints({ repoReal, readOnlyBinds = [] }) {
  const missing = [];
  for (const bind of readOnlyBinds) {
    const dst = bind?.dst;
    const src = bind?.src;
    if (typeof dst !== "string" || typeof src !== "string" || dst === repoReal ||
        !isWithinRepo(dst, repoReal)) continue;
    let source;
    try { source = statSync(src); } catch { continue; }
    if (!source.isDirectory()) continue;
    try {
      lstatSync(dst);
      continue;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        refuse(`dependency mountpoint could not be inspected: ${dst}`,
          { mountpoint: dst, errno: error?.code ?? null });
      }
    }
    if (!missing.includes(dst)) missing.push(dst);
  }

  const outer = readOnlyBinds.map((bind) => bind?.dst).filter((dst) => typeof dst === "string");
  const own = missing.filter((dst) => !outer.some((other) => other !== dst && isWithinRepo(dst, other)));
  missing.length = 0;
  missing.push(...own);
  if (missing.length === 0) return null;
  const chain = new Set([repoReal]);
  for (const mountpoint of missing) {
    for (let dir = path.dirname(mountpoint); dir !== repoReal; dir = path.dirname(dir)) chain.add(dir);
  }
  const created = new Set([...chain, ...missing]);
  created.delete(repoReal);
  const depth = (dir) => dir.split("/").length;
  const args = ["--tmpfs", repoReal];
  for (const dir of [...chain].sort((left, right) => depth(left) - depth(right) || left.localeCompare(right))) {
    if (dir !== repoReal) args.push("--dir", dir);
    let entries = [];
    try {
      const stat = lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        refuse(`a dependency mountpoint ancestor is not a real directory: ${dir}`, { ancestor: dir });
      }
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(dir, entry.name);
      if (created.has(child)) continue;
      if (entry.isSymbolicLink()) args.push("--symlink", readlinkSync(child), child);
      else args.push("--ro-bind", child, child);
    }
  }
  for (const mountpoint of [...missing].sort()) {
    if (!chain.has(mountpoint)) args.push("--dir", mountpoint);
  }
  args.push("--remount-ro", repoReal);
  return Object.freeze({ mountpoints: Object.freeze([...missing].sort()), args: Object.freeze(args) });
}

export function projectWorkerTestRuntimeEnv(env, prepared) {
  if (prepared === null || env === null || typeof env !== "object") return env;
  return { ...env, PATH: prependPathEntry(env.PATH, prepared.pathPrefix) };
}

export function pinHarnessInterpreter({ resolvedCommand, args, pathEnv, prepared }) {
  const unchanged = { argvCommand: resolvedCommand.argvCommand, args };
  if (prepared === null) return unchanged;
  const shebang = readShebangLine(resolvedCommand.argvCommand);
  if (shebang === null || shebang.envInterpreterName === null ||
      !prepared.commands.includes(shebang.envInterpreterName)) return unchanged;
  const interpreter = resolveBasenameOnPath(shebang.envInterpreterName, pathEnv ?? "");
  if (interpreter === null) {
    refuse(`the harness interpreter ${shebang.envInterpreterName} is not on the launcher search path`,
      { command: resolvedCommand.argvCommand });
  }

  const line = readFileSync(resolvedCommand.argvCommand, "utf8").split("\n", 1)[0].slice(2).trim();
  const tokens = line.split(/\s+/u);
  const extra = tokens.slice(tokens.indexOf(shebang.envInterpreterName) + 1);
  return { argvCommand: realpathSync(interpreter), args: [...extra, resolvedCommand.argvCommand, ...args] };
}

function unchangedDirectory(expected) {
  try {
    const stat = statSync(realpathSync(expected.src));
    return realpathSync(expected.src) === expected.real &&
      String(stat.dev) === expected.dev && String(stat.ino) === expected.ino;
  } catch { return false; }
}

function assertPreparationUnchanged(identity) {
  if (identity === null || identity.readiness_digest === null) return;
  const current = loadReadiness(identity.repository);
  if (current.ok && current.record.readiness_digest === identity.readiness_digest) return;
  const environments = identity.projects.map(({ environment }) => environment);
  throw new WorkerTestRuntimePreparationError({
    code: TEST_RUNTIME_READINESS_CODES.PREPARATION_CHANGED,
    message: `the test-runtime preparation changed after this launch was composed (${current.ok
      ? "a newer ready preparation" : current.code})`,
    detail: { ...(current.detail ?? {}), current_code: current.ok ? null : current.code,
      readiness_digest: current.ok ? current.record.readiness_digest : current.detail?.readiness_digest ?? null },
    recovery: current.recovery
  }, { environments, repository: identity.repository, composedDigest: identity.readiness_digest });
}

export function assertWorkerTestRuntimeMountsUnchanged(prepared) {
  assertPreparationUnchanged(prepared?.identity ?? null);
  for (const source of prepared?.sources ?? []) {
    if (unchangedDirectory(source)) continue;
    refuse(`projected runtime source changed before spawn: ${source.src}`,
      { source: source.src, destination: source.dst, expected_identity: { real: source.real,
        dev: source.dev, ino: source.ino } });
  }
  for (const mount of prepared?.mounts ?? []) {
    const context = { project: mount.project, ecosystem: mount.ecosystem, mountpoint: mount.dst };
    let source;
    try { source = statSync(realpathSync(mount.src)); } catch { source = null; }
    if (source === null || String(source.dev) !== mount.source.dev || String(source.ino) !== mount.source.ino) {
      refuse(`prepared dependency source changed before spawn: ${mount.src}`, { ...context, source: mount.src });
    }
    if (mount.destination === null) continue;
    const occupant = inspectDependencyMountpoint(mount.dst);
    if (occupant.state !== "empty_directory" || occupant.identity.dev !== mount.destination.dev ||
        occupant.identity.ino !== mount.destination.ino) {
      refuse(`dependency mountpoint changed before spawn: ${mount.dst}`,
        { ...context, occupant: occupant.state === "occupied" ? occupant.kind : occupant.state, preserved: true });
    }
  }
}
