
import {
  chmodSync, closeSync, constants as fsConstants, existsSync, fstatSync,
  lstatSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync,
  rmSync, writeFileSync
} from "node:fs";
import path from "node:path";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const TEST_TEMP_PARENT = "/tmp";
const RUNNER_ROOT_MARKER = ".agent-chassis-runner-owned.json";
const RUNNER_ROOT_MARKER_SCHEMA = "agent-chassis-test-runner-root.v2";
const RUNNER_ROOT_REPOSITORY = "agent-chassis/agent-chassis";
const RUNNER_ROOT_SPECS = Object.freeze({
  home: Object.freeze({
    prefix: "agent-chassis-hermetic-home-",
    purpose: "hermetic-home"
  }),
  temp: Object.freeze({
    prefix: "agent-chassis-test-tmp-",
    purpose: "test-tmp"
  })
});
const PROC_BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";

function runnerRootSpecForName(name) {
  for (const [kind, spec] of Object.entries(RUNNER_ROOT_SPECS)) {
    if (!name.startsWith(spec.prefix)) continue;
    const suffix = name.slice(spec.prefix.length);
    if (/^[A-Za-z0-9]{6}$/u.test(suffix)) return { kind, ...spec };
  }
  return null;
}

function boundedRunnerRootPath(rootPath) {
  const resolved = path.resolve(rootPath);
  if (path.dirname(resolved) !== path.resolve(TEST_TEMP_PARENT)) return null;
  const spec = runnerRootSpecForName(path.basename(resolved));
  return spec ? { path: resolved, ...spec } : null;
}

export function runnerOwnedRootContaining(candidate) {
  let current = path.resolve(candidate);
  while (true) {
    const bounded = boundedRunnerRootPath(current);
    if (bounded) return bounded.path;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function currentUidBigInt() {
  return typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
}

function privateDirectoryProblem(directoryStat) {
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    return "not a plain directory";
  }
  const uid = currentUidBigInt();
  if (uid === null || directoryStat.uid !== uid) return "not owned by the current uid";
  if ((directoryStat.mode & 0o777n) !== 0o700n) return "permissions are not 0700";
  return null;
}

export function inspectPrivateDirectory(directory) {
  let directoryStat;
  try {
    directoryStat = lstatSync(directory, { bigint: true });
  } catch (error) {
    return error?.code === "ENOENT" ? "does not exist" : errorMessage(error);
  }
  return privateDirectoryProblem(directoryStat);
}

function readLinuxBootId() {
  if (process.platform !== "linux" || !existsSync(PROC_BOOT_ID_PATH)) return null;
  const bootId = readFileSync(PROC_BOOT_ID_PATH, "utf8").trim();
  return bootId.length > 0 ? bootId : null;
}

function parseLinuxProcessStartTicks(statText, pid) {
  const closeParen = statText.lastIndexOf(") ");
  if (closeParen < 0) throw new Error(`malformed /proc/${pid}/stat: missing command terminator`);
  const fieldsFromState = statText.slice(closeParen + 2).trim().split(/\s+/u);
  const startTicks = fieldsFromState[19];
  if (!/^\d+$/u.test(startTicks ?? "")) {
    throw new Error(`malformed /proc/${pid}/stat: missing process start time`);
  }
  return startTicks;
}

function inspectLinuxProcess(pid) {
  if (process.platform !== "linux") return { state: "unknown", reason: "non-linux host" };
  const statPath = `/proc/${pid}/stat`;
  try {
    const statText = readFileSync(statPath, "utf8");
    return { state: "present", startTicks: parseLinuxProcessStartTicks(statText, pid) };
  } catch (error) {
    if (error && error.code === "ENOENT") return { state: "absent" };
    return { state: "unknown", reason: errorMessage(error) };
  }
}

function currentRunnerOwnerIdentity() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const bootId = readLinuxBootId();
  const processIdentity = inspectLinuxProcess(process.pid);
  return Object.freeze({
    pid: process.pid,
    uid,
    boot_id: bootId,
    process_start_ticks: processIdentity.state === "present"
      ? processIdentity.startTicks
      : null
  });
}

function cleanupFailure(rootPath, error) {
  return Object.freeze({
    root: rootPath,
    code: error && typeof error.code === "string" ? error.code : "runner_temp_cleanup_failed",
    message: errorMessage(error)
  });
}

function openRunnerRootHandle(rootPath) {
  const fd = openSync(
    rootPath,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW
  );
  return { fd, released: false };
}

function releaseRunnerRootHandle(handle) {
  if (!handle || handle.released) return null;
  handle.released = true;
  try {
    closeSync(handle.fd);
    return null;
  } catch (error) {
    const releaseError = new Error(
      `runner temp root handle could not be released: ${errorMessage(error)}`,
      { cause: error }
    );
    releaseError.code = "runner_temp_cleanup_handle_release_failed";
    return releaseError;
  }
}

function sameFileIdentity(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

function fileIdentityRecord(stat) {
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino) });
}

function makeRunnerRootRemovable(rootPath, rootStat) {
  const currentUid = typeof process.getuid === "function" ? BigInt(process.getuid()) : null;
  if (currentUid === null || rootStat.uid !== currentUid) {
    const error = new Error(`runner temp root is not owned by the runner uid: ${rootPath}`);
    error.code = "runner_temp_cleanup_owner_refused";
    throw error;
  }
  const visit = (directory) => {
    const directoryStat = lstatSync(directory, { bigint: true });
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      const error = new Error(`runner temp cleanup encountered a substituted directory: ${directory}`);
      error.code = "runner_temp_cleanup_substitution_refused";
      throw error;
    }
    if (directoryStat.uid !== currentUid || directoryStat.dev !== rootStat.dev) {
      const error = new Error(`runner temp cleanup crossed an ownership or mount boundary: ${directory}`);
      error.code = "runner_temp_cleanup_boundary_refused";
      throw error;
    }
    chmodSync(directory, 0o700);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      let childStat;
      try {
        childStat = lstatSync(child);
      } catch (error) {
        if (error && error.code === "ENOENT") continue;
        throw error;
      }
      if (childStat.isSymbolicLink()) continue;
      if (childStat.isDirectory()) visit(child);
    }
  };
  visit(rootPath);
}

function removeBoundedRunnerRoot(rootPath, directoryHandle = null) {
  const bounded = boundedRunnerRootPath(rootPath);
  if (!bounded) {
    const error = new Error(`refusing cleanup outside an exact runner temp root: ${rootPath}`);
    error.code = "runner_temp_cleanup_path_refused";
    throw error;
  }
  let rootStat;
  try {
    rootStat = lstatSync(bounded.path, { bigint: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(bounded.path) !== bounded.path) {
    const error = new Error(`runner temp root was substituted before cleanup: ${bounded.path}`);
    error.code = "runner_temp_cleanup_substitution_refused";
    throw error;
  }
  if (directoryHandle && !sameFileIdentity(fstatSync(directoryHandle.fd, { bigint: true }), rootStat)) {
    const error = new Error(
      `runner temp root path no longer resolves to the held root directory: ${bounded.path}`
    );
    error.code = "runner_temp_cleanup_identity_refused";
    throw error;
  }
  makeRunnerRootRemovable(bounded.path, rootStat);
  rmSync(bounded.path, { recursive: true, force: true });
  if (existsSync(bounded.path)) {
    const error = new Error(`runner temp root still exists after cleanup: ${bounded.path}`);
    error.code = "runner_temp_cleanup_incomplete";
    throw error;
  }
}

export function cleanupRunnerOwnedRoots(roots) {
  const failures = [];
  for (const root of [...roots].reverse()) {
    try {
      removeBoundedRunnerRoot(root.path, root.directoryHandle ?? null);
    } catch (error) {
      failures.push(cleanupFailure(root.path, error));
    } finally {
      const releaseError = releaseRunnerRootHandle(root.directoryHandle);
      if (releaseError) failures.push(cleanupFailure(root.path, releaseError));
    }
  }
  return Object.freeze(failures);
}

export function createRunnerOwnedTempRoot(kind) {
  const spec = RUNNER_ROOT_SPECS[kind];
  if (!spec) throw new Error(`unknown runner temp-root kind: ${kind}`);
  const rootPath = mkdtempSync(path.join(TEST_TEMP_PARENT, spec.prefix));
  let directoryHandle = null;
  try {
    directoryHandle = openRunnerRootHandle(rootPath);
    chmodSync(rootPath, 0o700);
    const markerFd = openSync(path.join(rootPath, RUNNER_ROOT_MARKER), "wx", 0o600);
    try {
      const marker = Object.freeze({
        schema_version: RUNNER_ROOT_MARKER_SCHEMA,
        repository: RUNNER_ROOT_REPOSITORY,
        purpose: spec.purpose,
        root_basename: path.basename(rootPath),
        marker_identity: fileIdentityRecord(fstatSync(markerFd, { bigint: true })),
        owner: currentRunnerOwnerIdentity()
      });
      writeFileSync(markerFd, `${JSON.stringify(marker)}\n`, "utf8");
    } finally {
      closeSync(markerFd);
    }
    return Object.freeze({ kind, path: rootPath, directoryHandle });
  } catch (error) {
    const failures = cleanupRunnerOwnedRoots([{ kind, path: rootPath, directoryHandle }]);
    if (failures.length > 0) {
      const setupError = new Error(
        `runner temp-root setup failed (${errorMessage(error)}); ` +
        `partial cleanup also failed (${failures.map((failure) => failure.message).join("; ")})`,
        { cause: error }
      );
      setupError.code = "runner_temp_setup_and_cleanup_failed";
      setupError.cleanupFailures = failures;
      throw setupError;
    }
    throw error;
  }
}

function readRunnerRootMarker(markerPath) {
  const fd = openSync(
    markerPath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
  );
  try {
    const markerStat = fstatSync(fd, { bigint: true });
    if (!markerStat.isFile() || markerStat.nlink !== 1n) return { markerStat, markerText: null };
    return { markerStat, markerText: readFileSync(fd, "utf8") };
  } finally {
    closeSync(fd);
  }
}

function inspectRunnerRootOwnership(rootPath, directoryHandle) {
  const bounded = boundedRunnerRootPath(rootPath);
  if (!bounded) return { state: "unproven", reason: "path is not an exact runner root" };

  let rootStat;
  let markerStat;
  let rootRealPath;
  let markerText;
  try {
    rootStat = lstatSync(bounded.path, { bigint: true });
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return { state: "unproven", reason: "root is not a plain directory" };
    }
    rootRealPath = realpathSync(bounded.path);
    if (rootRealPath !== bounded.path) {
      return { state: "unproven", reason: "root does not resolve to its exact /tmp path" };
    }
    if (!sameFileIdentity(fstatSync(directoryHandle.fd, { bigint: true }), rootStat)) {
      return { state: "unproven", reason: "root path no longer resolves to the held directory" };
    }
    ({ markerStat, markerText } = readRunnerRootMarker(path.join(bounded.path, RUNNER_ROOT_MARKER)));
    if (markerText === null) {
      return { state: "unproven", reason: "ownership marker is not a single-link plain file" };
    }
  } catch (error) {
    return { state: "unproven", reason: errorMessage(error) };
  }

  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (currentUid === null || rootStat.uid !== BigInt(currentUid) || markerStat.uid !== BigInt(currentUid)) {
    return { state: "unproven", reason: "root and marker are not owned by the runner uid" };
  }
  if (privateDirectoryProblem(rootStat) !== null || (markerStat.mode & 0o777n) !== 0o600n) {
    return { state: "unproven", reason: "root or marker permissions do not match runner ownership" };
  }

  let marker;
  try {
    marker = JSON.parse(markerText);
  } catch (error) {
    return { state: "unproven", reason: `invalid ownership marker: ${errorMessage(error)}` };
  }
  const markerIdentity = fileIdentityRecord(markerStat);
  if (
    marker?.schema_version !== RUNNER_ROOT_MARKER_SCHEMA ||
    marker?.repository !== RUNNER_ROOT_REPOSITORY ||
    marker?.purpose !== bounded.purpose ||
    marker?.root_basename !== path.basename(bounded.path) ||
    marker?.owner?.uid !== currentUid ||
    !Number.isSafeInteger(marker?.owner?.pid) ||
    marker.owner.pid <= 0 ||
    typeof marker.owner.boot_id !== "string" ||
    marker.owner.boot_id.length === 0 ||
    typeof marker.owner.process_start_ticks !== "string" ||
    !/^\d+$/u.test(marker.owner.process_start_ticks)
  ) {
    return { state: "unproven", reason: "ownership marker fields do not match the root" };
  }

  if (
    marker?.marker_identity?.dev !== markerIdentity.dev ||
    marker?.marker_identity?.ino !== markerIdentity.ino
  ) {
    return { state: "unproven", reason: "ownership marker is not the file the runner created" };
  }
  return { state: "proven", bounded, marker, markerText, markerIdentity };
}

function inspectRunnerRootLiveness(proof, currentBootId) {
  if (proof.marker.owner.boot_id !== currentBootId) {
    return { state: "inactive", reason: "owner boot no longer active" };
  }
  const processIdentity = inspectLinuxProcess(proof.marker.owner.pid);
  if (processIdentity.state === "absent") {
    return { state: "inactive", reason: "owner process no longer exists" };
  }
  if (processIdentity.state !== "present") {
    return { state: "unknown", reason: processIdentity.reason };
  }
  if (processIdentity.startTicks !== proof.marker.owner.process_start_ticks) {
    return { state: "inactive", reason: "owner pid has been reused" };
  }
  return { state: "active" };
}

function sameRunnerRootProof(first, second) {
  return second.state === "proven" &&
    second.markerText === first.markerText &&
    second.markerIdentity.dev === first.markerIdentity.dev &&
    second.markerIdentity.ino === first.markerIdentity.ino;
}

export function recoverInactiveRunnerRoots() {
  const currentBootId = readLinuxBootId();
  if (currentBootId === null) {
    return Object.freeze({ removed: Object.freeze([]), failures: Object.freeze([]) });
  }
  const removed = [];
  const failures = [];
  const entries = readdirSync(TEST_TEMP_PARENT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !runnerRootSpecForName(entry.name)) continue;
    const rootPath = path.join(TEST_TEMP_PARENT, entry.name);

    let directoryHandle;
    try {
      directoryHandle = openRunnerRootHandle(rootPath);
    } catch {
      continue;
    }
    try {
      const firstProof = inspectRunnerRootOwnership(rootPath, directoryHandle);
      if (firstProof.state !== "proven") continue;
      if (inspectRunnerRootLiveness(firstProof, currentBootId).state !== "inactive") continue;

      const secondProof = inspectRunnerRootOwnership(rootPath, directoryHandle);
      if (!sameRunnerRootProof(firstProof, secondProof)) continue;
      if (inspectRunnerRootLiveness(secondProof, currentBootId).state !== "inactive") continue;
      try {
        removeBoundedRunnerRoot(rootPath, directoryHandle);
        removed.push(rootPath);
      } catch (error) {
        failures.push(cleanupFailure(rootPath, error));
      }
    } finally {
      const releaseError = releaseRunnerRootHandle(directoryHandle);
      if (releaseError) failures.push(cleanupFailure(rootPath, releaseError));
    }
  }
  return Object.freeze({
    removed: Object.freeze(removed),
    failures: Object.freeze(failures)
  });
}
