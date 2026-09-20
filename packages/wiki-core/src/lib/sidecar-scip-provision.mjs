

import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify, types as utilTypes } from "node:util";

import {
  decodeScipIndex,
  normalizeScipIndex,
  SCIP_INDEXER_SPECS
} from "./sidecar-scip-normalize.mjs";

export class SidecarScipProvisionError extends Error {
  constructor(message, { code, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "SidecarScipProvisionError";
    this.code = code;
  }
}

export const SCIP_DEFAULT_CACHE_DIR = ".cache/repo-scip-index";

export const SCIP_STATUS_EXTRACTED = "scip_extracted";
export const SCIP_STATUS_NOT_APPLICABLE = "scip_not_applicable";

export const SCIP_INDEXER_DEFAULT_DEADLINE_MS = 300_000;
export const SCIP_INDEXER_MIN_DEADLINE_MS = 1_000;
export const SCIP_INDEXER_MAX_DEADLINE_MS = 3_600_000;
export const SCIP_INDEXER_RESOLUTION_DEADLINE_MS = 5_000;
export const SCIP_INDEXER_STDERR_LIMIT_BYTES = 64 * 1024;
export const SCIP_INDEXER_SIGTERM_GRACE_MS = 500;
export const SCIP_INDEXER_SIGKILL_GRACE_MS = 500;

export const SCIP_TYPESCRIPT_PROJECT_CONFIG = "tsconfig.json";

export function resolveScipProviderDeadlineMs(value) {
  const resolved = value ?? SCIP_INDEXER_DEFAULT_DEADLINE_MS;
  if (!Number.isInteger(resolved) || resolved < SCIP_INDEXER_MIN_DEADLINE_MS ||
      resolved > SCIP_INDEXER_MAX_DEADLINE_MS) {
    throw new TypeError(
      `SCIP provider deadline must be an integer from ${SCIP_INDEXER_MIN_DEADLINE_MS} through ${SCIP_INDEXER_MAX_DEADLINE_MS}ms`
    );
  }
  return resolved;
}

async function resolveInstalledIndexer(indexer, timeoutMs) {
  let stdout;
  try {
    ({ stdout } = await promisify(execFile)("which", [indexer], {
      maxBuffer: 64 * 1024,
      timeout: timeoutMs,
      killSignal: "SIGKILL"
    }));
  } catch (cause) {
    const outputExceeded = cause?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
    const timedOut = !outputExceeded &&
      (cause?.killed === true || cause?.signal === "SIGKILL");
    throw new SidecarScipProvisionError(
      timedOut
        ? `${indexer} executable resolution exceeded ${timeoutMs}ms`
        : outputExceeded
          ? `${indexer} executable resolution exceeded 65536 output bytes`
          : `${indexer} executable resolution failed: ${cause?.message ?? cause}`,
      {
        code: timedOut
          ? "scip_indexer_resolution_timeout"
          : outputExceeded
            ? "scip_indexer_resolution_output_limit"
            : "scip_indexer_resolution_failed",
        cause
      }
    );
  }
  const executable = stdout.trim().split("\n")[0];
  if (!path.isAbsolute(executable)) {
    throw new Error(`${indexer} resolved to a non-absolute executable path`);
  }
  await access(executable, fsConstants.X_OK);
  return executable;
}

function signalScipProcessTree(child, signal) {
  if (process.platform === "win32") {
    throw new SidecarScipProvisionError(
      "SCIP provider process-tree ownership is unavailable on win32",
      { code: "scip_indexer_process_tree_unsupported" }
    );
  }
  if (!Number.isInteger(child.pid) || child.pid <= 0) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function processGroupExists(child) {
  return signalScipProcessTree(child, 0);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForScipProcessGroupExit(child, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (!processGroupExists(child)) return true;
    await delay(10);
  }
  return !processGroupExists(child);
}

async function terminateScipProcessGroup(child) {
  if (!processGroupExists(child)) return;
  signalScipProcessTree(child, "SIGTERM");
  if (await waitForScipProcessGroupExit(child, SCIP_INDEXER_SIGTERM_GRACE_MS)) return;
  signalScipProcessTree(child, "SIGKILL");
  if (await waitForScipProcessGroupExit(child, SCIP_INDEXER_SIGKILL_GRACE_MS)) return;
  throw new SidecarScipProvisionError(
    "SCIP provider process group remained present after SIGKILL",
    { code: "scip_indexer_reap_timeout" }
  );
}

function boundedStderrAppend(chunks, chunk, retainedBytes) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = SCIP_INDEXER_STDERR_LIMIT_BYTES - retainedBytes;
  if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
  return retainedBytes + bytes.length;
}

export function runBoundedScipIndexerProcess({ executable, args, cwd, outputPath,
  timeoutMs = SCIP_INDEXER_DEFAULT_DEADLINE_MS, spawnProcess = spawn } = {}) {
  if (process.platform === "win32") {
    return Promise.reject(new SidecarScipProvisionError(
      "SCIP provider process-tree ownership is unavailable on win32",
      { code: "scip_indexer_process_tree_unsupported" }
    ));
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(executable, args, {
        cwd,
        shell: false,
        detached: true,
        stdio: ["ignore", "ignore", "pipe"]
      });
    } catch (cause) {
      reject(new SidecarScipProvisionError(
        `SCIP provider could not start: ${cause?.message ?? cause}`,
        { code: "scip_indexer_spawn_failed", cause }
      ));
      return;
    }

    const stderrChunks = [];
    let stderrBytes = 0;
    let terminalReason = null;
    let settled = false;
    let deadlineTimer = null;

    const stderrText = () => Buffer.concat(stderrChunks).toString("utf8");
    const cleanup = () => {
      clearTimeout(deadlineTimer);
      process.removeListener("exit", emergencyCleanup);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stderr?.removeListener?.("data", onStderr);
    };
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      cleanup();
      operation();
    };
    const emergencyCleanup = () => {
      try {
        signalScipProcessTree(child, "SIGKILL");
      } catch {

      }
    };
    const beginTermination = (reason) => {
      if (terminalReason !== null) return;
      terminalReason = reason;
      void terminateScipProcessGroup(child).then(
        () => finish(() => reject(reason)),
        (cause) => finish(() => reject(cause?.code === "scip_indexer_reap_timeout"
          ? cause
          : new SidecarScipProvisionError(
              `SCIP provider process tree could not be terminated: ${cause?.message ?? cause}`,
              { code: "scip_indexer_process_tree_termination_failed", cause }
            )))
      );
    };
    const onStderr = (chunk) => {
      stderrBytes = boundedStderrAppend(stderrChunks, chunk, stderrBytes);
      if (stderrBytes > SCIP_INDEXER_STDERR_LIMIT_BYTES) {
        beginTermination(new SidecarScipProvisionError(
          `SCIP provider stderr exceeded ${SCIP_INDEXER_STDERR_LIMIT_BYTES} bytes`,
          { code: "scip_indexer_stderr_limit_exceeded" }
        ));
      }
    };
    const onError = (cause) => {
      beginTermination(new SidecarScipProvisionError(
        `SCIP provider process failed: ${cause?.message ?? cause}`,
        { code: "scip_indexer_process_failed", cause }
      ));
    };
    const onClose = (code, signal) => {
      if (terminalReason !== null) return;
      if (code !== 0 || signal !== null) {
        beginTermination(new SidecarScipProvisionError(
          `SCIP provider exited with code ${code ?? "null"} signal ${signal ?? "null"}: ${stderrText()}`,
          { code: "scip_indexer_exit_failed" }
        ));
        return;
      }
      clearTimeout(deadlineTimer);
      void terminateScipProcessGroup(child).then(
        () => readFile(outputPath).then(
          (bytes) => finish(() => resolve(bytes)),
          (cause) => finish(() => reject(new SidecarScipProvisionError(
            `SCIP provider produced no output at ${outputPath}: ${cause.message}`,
            { code: "scip_indexer_output_missing", cause }
          )))
        ),
        (cause) => finish(() => reject(new SidecarScipProvisionError(
          `SCIP provider process tree could not be cleaned up: ${cause?.message ?? cause}`,
          { code: cause?.code === "scip_indexer_reap_timeout"
            ? cause.code : "scip_indexer_process_tree_termination_failed", cause }
        )))
      );
    };

    child.stderr?.on?.("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
    process.once("exit", emergencyCleanup);
    deadlineTimer = setTimeout(() => {
      beginTermination(new SidecarScipProvisionError(
        `SCIP provider exceeded ${timeoutMs}ms`,
        { code: "scip_indexer_timeout" }
      ));
    }, timeoutMs);
  });
}

async function defaultRunIndexer({ repoRoot, indexer, spec, cacheDir, tsconfigPath, committedHead,
  deadlineMs }) {
  const startedAt = Date.now();
  const executable = await resolveInstalledIndexer(indexer,
    Math.min(SCIP_INDEXER_RESOLUTION_DEADLINE_MS, deadlineMs));
  const remainingMs = deadlineMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    throw new SidecarScipProvisionError(
      `SCIP provider exceeded ${deadlineMs}ms during executable resolution`,
      { code: "scip_indexer_timeout" }
    );
  }
  const outputPath = path.join(repoRoot, cacheDir, spec.output);

  const projectDir = path.dirname(tsconfigPath) || ".";
  if (indexer === "scip-python" && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(committedHead)) {
    throw new Error("scip-python requires the captured commit as its project version");
  }
  const args =
    indexer === "scip-typescript"
      ? ["index", "--cwd", repoRoot, "--output", outputPath, projectDir]
      : [
          "index", "--cwd", repoRoot, "--output", outputPath, "--quiet",
          "--project-version", committedHead
        ];
  return runBoundedScipIndexerProcess({ executable, args, cwd: repoRoot,
    outputPath, timeoutMs: remainingMs });
}
export function snapshotScipOptions(rawOptions, entries, label) {
  if (rawOptions !== undefined && utilTypes.isProxy(rawOptions)) throw new TypeError(`${label} options must not be a Proxy`);
  if (rawOptions !== undefined &&
      ((typeof rawOptions !== "object" && typeof rawOptions !== "function") || rawOptions === null)) throw new TypeError(`${label} options must be an object`);
  const options = Object.create(null);
  for (const [key, fallback] of entries) {
    const descriptor = rawOptions === undefined ? undefined : Object.getOwnPropertyDescriptor(rawOptions, key);
    if (descriptor && !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} option '${key}' must be an own data property`);
    options[key] = descriptor?.value === undefined ? fallback : descriptor.value;
  }
  return options;
}

export function discoverSidecarScipProjects(trackedPaths) {
  if (!Array.isArray(trackedPaths)) {
    throw new TypeError("SCIP project discovery requires the committed tracked paths");
  }
  const projects = [];
  if (trackedPaths.includes(SCIP_TYPESCRIPT_PROJECT_CONFIG)) {
    projects.push(Object.freeze({ key: `scip-typescript#${SCIP_TYPESCRIPT_PROJECT_CONFIG}`,
      indexer: "scip-typescript", project: SCIP_TYPESCRIPT_PROJECT_CONFIG }));
  }
  if (trackedPaths.some((value) => /\.pyi?$/.test(value))) {
    projects.push(Object.freeze({ key: "scip-python#.", indexer: "scip-python", project: "." }));
  }
  return projects;
}

async function removeSnapshotSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) await rm(target, { force: true });
    else if (entry.isDirectory()) await removeSnapshotSymlinks(target);
  }
}

async function withCommittedSnapshot(sourceRepoRoot, committedHead, operation) {
  let snapshotContainer;
  let result;
  let failure = null;
  try {
    snapshotContainer = await mkdtemp(path.join(os.tmpdir(), "sidecar-scip-snapshot-"));
    const snapshotRoot = path.join(snapshotContainer, "repo");
    const archivePath = path.join(snapshotContainer, "snapshot.tar");
    await mkdir(snapshotRoot);
    await promisify(execFile)("git", ["--no-replace-objects", "-C", sourceRepoRoot, "archive",
      "--format=tar", `--output=${archivePath}`, committedHead], { maxBuffer: 1024 * 1024 });
    await promisify(execFile)("tar", ["-xf", archivePath, "-C", snapshotRoot],
      { maxBuffer: 1024 * 1024 });
    await removeSnapshotSymlinks(snapshotRoot);
    result = await operation(snapshotRoot);
  } catch (error) {
    failure = error;
  }
  if (snapshotContainer) {
    try {
      await rm(snapshotContainer, { recursive: true, force: true });
    } catch (error) {
      throw new SidecarScipProvisionError(
        `committed SCIP snapshot cleanup failed: ${String(error?.message ?? "unknown").slice(0, 500)}`,
        { code: "scip_snapshot_cleanup_failed", cause: failure ?? error }
      );
    }
  }
  if (failure) throw failure;
  return result;
}

export async function runScipProjectsFromCommittedSnapshot(rawOptions) {
  const {
    sourceRepoRoot, committedHead, projects, baseFileNodeIds, deadlineMs, runIndexer
  } = snapshotScipOptions(rawOptions, [["sourceRepoRoot", undefined],
    ["committedHead", undefined], ["projects", undefined], ["baseFileNodeIds", null],
    ["deadlineMs", SCIP_INDEXER_DEFAULT_DEADLINE_MS], ["runIndexer", defaultRunIndexer]
  ], "committed-snapshot SCIP");
  if (typeof sourceRepoRoot !== "string" || sourceRepoRoot.length === 0) {
    throw new TypeError("committed-snapshot SCIP requires sourceRepoRoot");
  }
  if (typeof committedHead !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(committedHead)) {
    throw new SidecarScipProvisionError(
      "committed-snapshot SCIP requires one captured commit",
      { code: "scip_snapshot_head_unstable" }
    );
  }
  if (!Array.isArray(projects)) throw new TypeError("committed-snapshot SCIP requires projects");
  const deadline = resolveScipProviderDeadlineMs(deadlineMs);
  const layers = new Map();
  if (projects.length === 0) return layers;
  try {
    return await withCommittedSnapshot(sourceRepoRoot, committedHead, async (snapshotRoot) => {
      await mkdir(path.join(snapshotRoot, SCIP_DEFAULT_CACHE_DIR), { recursive: true });
      for (const project of projects) {
        const spec = SCIP_INDEXER_SPECS[project?.indexer];
        if (!spec || typeof project.key !== "string" || project.key.length === 0) {
          throw new TypeError(`unsupported SCIP project: ${JSON.stringify(project)}`);
        }
        try {
          const bytes = await runIndexer({
            repoRoot: snapshotRoot, indexer: project.indexer, spec, cacheDir: SCIP_DEFAULT_CACHE_DIR,
            tsconfigPath: project.indexer === "scip-typescript"
              ? project.project : SCIP_TYPESCRIPT_PROJECT_CONFIG,
            committedHead, deadlineMs: deadline
          });
          layers.set(project.key, normalizeScipIndex(await decodeScipIndex(bytes),
            { indexer: project.indexer, baseFileNodeIds }));
        } catch (cause) {
          throw new SidecarScipProvisionError(
            `required SCIP provider ${project.key} failed: ${String(cause?.message ?? cause).slice(0, 500)}`,
            { code: cause instanceof SidecarScipProvisionError ? cause.code : "scip_provider_failed", cause }
          );
        }
      }
      return layers;
    });
  } catch (error) {
    if (error instanceof SidecarScipProvisionError) throw error;
    throw new SidecarScipProvisionError(
      `committed SCIP snapshot provisioning failed: ${String(error?.message ?? "unknown").slice(0, 500)}`,
      { code: "scip_snapshot_provision_failed", cause: error }
    );
  }
}
