

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify, types as utilTypes } from "node:util";

import { signalProcessGroup, terminateProcessGroup } from "./process-group.mjs";
import { goModuleCachePopulation } from "./runtime-inputs/ecosystem-inputs-go.mjs";
import { observeSidecarProviderDependencies } from "./sidecar-scip-project-inputs.mjs";
import { sidecarLanguageExtensions } from "./sidecar-language-descriptions.mjs";
import { describeSidecarGoToolchains } from "./sidecar-scip-go-toolchain.mjs";
import {
  describeSidecarRustProjects,
  isSidecarRustManifest,
  SIDECAR_RUST_INDEXER,
  sidecarRustProcessEnvironment
} from "./sidecar-scip-rust-projects.mjs";
import {
  discoverSidecarGoProjects,
  materializeSidecarProviderArgs,
  observeSidecarProjectTools,
  SCIP_TYPESCRIPT_PROJECT_CONFIG,
  SIDECAR_SCIP_PROVIDER_ADAPTERS,
  sidecarGoProcessEnvironment,
  sidecarProjectArgs,
  sidecarProjectSettings
} from "./sidecar-scip-projects.mjs";
import { materializeTypescriptConfigPackages } from "./sidecar-scip-typescript-config.mjs";
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
export const SCIP_INDEXER_STDERR_LIMIT_BYTES = 64 * 1024;

export const SCIP_INDEXER_DIAGNOSTIC_STDOUT_BYTES = 4 * 1024;
export const SCIP_INDEXER_SIGTERM_GRACE_MS = 500;
export const SCIP_INDEXER_SIGKILL_GRACE_MS = 500;

export const SCIP_INDEXER_STDOUT_LIMIT_BYTES = 4 * 1024 * 1024;

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

async function terminateScipProcessGroup(child) {
  try {
    await terminateProcessGroup(child.pid, {
      termGraceMs: SCIP_INDEXER_SIGTERM_GRACE_MS,
      killGraceMs: SCIP_INDEXER_SIGKILL_GRACE_MS
    });
  } catch (cause) {
    if (cause?.code === "process_group_reap_timeout") {
      throw new SidecarScipProvisionError(
        "SCIP provider process group remained present after SIGKILL",
        { code: "scip_indexer_reap_timeout", cause }
      );
    }
    throw cause;
  }
}

function boundedStderrAppend(chunks, chunk, retainedBytes) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = SCIP_INDEXER_STDERR_LIMIT_BYTES - retainedBytes;
  if (remaining > 0) chunks.push(bytes.subarray(0, remaining));
  return retainedBytes + bytes.length;
}

export function runBoundedScipIndexerProcess({ executable, args, cwd, outputPath, env = undefined,
  captureStdout = false, timeoutMs = SCIP_INDEXER_DEFAULT_DEADLINE_MS, spawnProcess = spawn } = {}) {
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
        ...(env === undefined ? {} : { env }),
        stdio: ["ignore", "pipe", "pipe"]
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
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let terminalReason = null;
    let settled = false;
    let deadlineTimer = null;

    const stderrText = () => Buffer.concat(stderrChunks).toString("utf8");
    const diagnosticChunks = [];
    let diagnosticBytes = 0;
    const onDiagnosticStdout = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = SCIP_INDEXER_DIAGNOSTIC_STDOUT_BYTES - diagnosticBytes;
      if (remaining > 0) diagnosticChunks.push(bytes.subarray(0, remaining));
      diagnosticBytes += Math.min(bytes.length, Math.max(remaining, 0));
    };
    const failureText = () => [stderrText(), Buffer.concat(captureStdout ? stdoutChunks : diagnosticChunks)
      .subarray(0, SCIP_INDEXER_DIAGNOSTIC_STDOUT_BYTES).toString("utf8")]
      .map((value) => value.trim()).filter(Boolean).join("\n");
    const cleanup = () => {
      clearTimeout(deadlineTimer);
      process.removeListener("exit", emergencyCleanup);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.stderr?.removeListener?.("data", onStderr);
      child.stdout?.removeListener?.("data", onStdout);
      child.stdout?.removeListener?.("data", onDiagnosticStdout);
    };
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      cleanup();
      operation();
    };
    const emergencyCleanup = () => {
      try {
        signalProcessGroup(child.pid, "SIGKILL");
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
    const onStdout = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (stdoutBytes > SCIP_INDEXER_STDOUT_LIMIT_BYTES) {
        beginTermination(new SidecarScipProvisionError(
          `SCIP provider stdout exceeded ${SCIP_INDEXER_STDOUT_LIMIT_BYTES} bytes`,
          { code: "scip_indexer_stdout_limit_exceeded" }
        ));
        return;
      }
      stdoutChunks.push(bytes);
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
        beginTermination(Object.assign(new SidecarScipProvisionError(
          `SCIP provider exited with code ${code ?? "null"} signal ${signal ?? "null"}: ${failureText()}`,
          { code: "scip_indexer_exit_failed" }
        ), { exit: Object.freeze({ code, signal }) }));
        return;
      }
      clearTimeout(deadlineTimer);
      void terminateScipProcessGroup(child).then(
        () => (captureStdout ? Promise.resolve(Buffer.concat(stdoutChunks)) : readFile(outputPath)).then(
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
    child.stdout?.on?.("data", captureStdout ? onStdout : onDiagnosticStdout);
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

async function defaultRunIndexer({ executable, args, cwd, env, outputPath, deadlineMs }) {
  return runBoundedScipIndexerProcess({ executable, args, cwd, env, outputPath, timeoutMs: deadlineMs });
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

const PYTHON_SYNTAX = new Set(sidecarLanguageExtensions(["python"], { declarations: true }));

export function discoverSidecarScipProjects(trackedPaths, { goFiles = new Map(), goToolchains = new Map(),
  rustProjects = [], typescriptConfigPackages = [], typescriptConfigMissing = [] } = {}) {
  if (!Array.isArray(trackedPaths)) {
    throw new TypeError("SCIP project discovery requires the committed tracked paths");
  }
  const projects = [];
  if (trackedPaths.includes(SCIP_TYPESCRIPT_PROJECT_CONFIG)) {
    projects.push(Object.freeze({ key: `scip-typescript#${SCIP_TYPESCRIPT_PROJECT_CONFIG}`,
      indexer: "scip-typescript", project: SCIP_TYPESCRIPT_PROJECT_CONFIG,
      dependency_population: typescriptConfigPackages.length > 0
        ? Object.freeze([...typescriptConfigPackages].sort()) : null,
      ...(typescriptConfigMissing.length > 0 ? {
        dependency_limitation: Object.freeze({ code: "scip_typescript_config_package_unavailable",
          message: `${SCIP_TYPESCRIPT_PROJECT_CONFIG} extends configuration package${
            typescriptConfigMissing.length === 1 ? "" : "s"} ${[...typescriptConfigMissing].sort().join(", ")
          }, not installed in the repository's node_modules; install ${
            typescriptConfigMissing.length === 1 ? "it" : "them"} (nothing is installed here), then prepare again` }),
        dependency_blocks_provider: true
      } : {}) }));
  }
  if (trackedPaths.some((value) => PYTHON_SYNTAX.has(path.posix.extname(value)))) {
    projects.push(Object.freeze({ key: "scip-python#.", indexer: "scip-python", project: "." }));
  }
  return [...projects, ...discoverSidecarGoProjects(trackedPaths, goFiles, goToolchains), ...rustProjects];
}

export async function describeSidecarGoToolchainsAtCommit({ trackedPaths, goFiles, env = process.env,
  deadlineMs = SCIP_INDEXER_DEFAULT_DEADLINE_MS }) {
  return describeSidecarGoToolchains({ projects: discoverSidecarGoProjects(trackedPaths, goFiles), goFiles, env,
    timeoutMs: resolveScipProviderDeadlineMs(deadlineMs), run: (request) => runBoundedScipIndexerProcess(request) });
}

export async function describeSidecarRustProjectsAtCommit({ sourceRepoRoot, committedHead, trackedPaths,
  env = process.env, deadlineMs = SCIP_INDEXER_DEFAULT_DEADLINE_MS }) {
  const manifests = trackedPaths.filter(isSidecarRustManifest);
  if (manifests.length === 0) return [];
  const timeoutMs = resolveScipProviderDeadlineMs(deadlineMs);
  try {
    return await describeSidecarRustProjects({ manifests, env, timeoutMs,
      withSnapshot: (operation) => withCommittedSnapshot(sourceRepoRoot, committedHead, operation),
      run: (request) => runBoundedScipIndexerProcess(request) });
  } catch (error) {
    if (error instanceof SidecarScipProvisionError) throw error;
    throw new SidecarScipProvisionError(
      `committed Rust project description failed: ${String(error?.message ?? error).slice(0, 500)}`,
      { code: "scip_rust_description_failed", cause: error });
  }
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

function projectExecutables(project, required) {
  const tool = project.record?.tool ?? observeSidecarProjectTools(project, process.env);
  const unusable = tool.find(({ status }) => status !== "found");
  if (unusable && required) {
    throw new SidecarScipProvisionError(unusable.status === "absent"
      ? `${project.key} executable ${unusable.role} is not installed`
      : `${project.key} executable ${unusable.role} lookup failed: ${unusable.message}`,
    { code: unusable.status === "absent" ? "scip_indexer_absent" : "scip_indexer_resolution_failed" });
  }
  return tool;
}

const GO_UNLOCATED_LINE = "!unlocated";
const GO_MODULE_FIELDS = "{{.Path}}\t{{.Version}}\t{{.Dir}}\t{{.GoMod}}";

function goListedText(quoted) {
  try { return String(JSON.parse(quoted)); } catch { return quoted.replace(/^"|"$/gu, ""); }
}

async function observeGoDependencies({ tool, env, cwd, timeoutMs, prior }) {
  const go = tool.find(({ role }) => role === "go").resolved_path;
  const unavailable = (detail, cause) => new SidecarScipProvisionError(
    `Go packages or dependencies are unavailable offline: ${String(detail).slice(0, 500)}`,
    { code: cause?.code === "scip_indexer_timeout" ? cause.code : "scip_go_dependencies_unavailable", cause });
  const list = (args) => runBoundedScipIndexerProcess({ executable: go, cwd, env, captureStdout: true, timeoutMs,
    args: ["list", "-e", ...args] });
  const unlocatedIn = (lines) => {
    const unlocated = new Map();
    for (const line of lines.filter((value) => value.startsWith(`${GO_UNLOCATED_LINE}\t`))) {
      const [, subject, quoted = ""] = line.split("\t");
      if (!unlocated.has(subject)) unlocated.set(subject, goListedText(quoted));
    }
    return unlocated;
  };
  let lines;
  let unlocated;
  let blocksProvider = false;
  try {
    lines = (await list(["-deps", "-test", "-f", `{{with .Module}}${GO_MODULE_FIELDS}{{end}}` +

      `{{if and .Error (not .Dir)}}\n${GO_UNLOCATED_LINE}\t{{.ImportPath}}\t` +
      "{{printf \"%q\" .Error.Err}}{{end}}", "./..."])).toString("utf8").split("\n");
    unlocated = unlocatedIn(lines);
  } catch (cause) {
    if (cause?.code !== "scip_indexer_exit_failed" || !Number.isInteger(cause.exit?.code) ||
        cause.exit.signal !== null) {
      throw unavailable(cause?.message ?? cause, cause);
    }
    try {
      lines = (await list(["-m", "-f", `{{if .Error}}${GO_UNLOCATED_LINE}\t{{.Path}}@{{.Version}}\t` +
        `{{printf "%q" .Error.Err}}{{else}}${GO_MODULE_FIELDS}{{end}}`, "all"])).toString("utf8").split("\n");
    } catch {
      throw unavailable(cause.message, cause);
    }
    unlocated = unlocatedIn(lines);
    if (unlocated.size === 0) throw unavailable(cause.message, cause);
    blocksProvider = true;
  }
  const missing = unlocated.size > 0
    ? unavailable([...unlocated].map(([subject, error]) => `${subject}: ${error}`).join("; ")) : null;
  const population = env.GOMODCACHE
    ? goModuleCachePopulation(lines.filter((value) => !value.startsWith(GO_UNLOCATED_LINE)).join("\n"),
      env.GOMODCACHE, existsSync) : [];
  return { dependencies: observeSidecarProviderDependencies(population, { prior }),
    limitation: missing ? { code: missing.code, message: missing.message } : null, blocksProvider };
}

function rebaseDocuments(decoded, projectDir) {
  if (projectDir === ".") return decoded;
  for (const document of decoded.documents ?? []) {
    if (typeof document?.relativePath === "string") {
      document.relativePath = path.posix.normalize(path.posix.join(projectDir, document.relativePath));
    }
  }
  return decoded;
}

async function runProject({ project, spec, sourceRepoRoot, snapshotRoot, committedHead, deadline, baseFileNodeIds,
  runIndexer, attempt }) {
  const startedAt = Date.now();
  const adapter = SIDECAR_SCIP_PROVIDER_ADAPTERS[project.indexer];
  const tool = projectExecutables(project, runIndexer === defaultRunIndexer || project.indexer === "scip-go" ||
    project.indexer === SIDECAR_RUST_INDEXER);
  const outputPath = path.join(snapshotRoot, SCIP_DEFAULT_CACHE_DIR, spec.output);
  let env;
  let cwd = snapshotRoot;
  let dependencies = null;
  if (project.indexer === "scip-go") {
    env = sidecarGoProcessEnvironment({ tool,
      settings: project.record?.settings ?? sidecarProjectSettings(project, process.env),
      snapshotRoot, privateRoot: path.dirname(snapshotRoot) });
    cwd = path.join(snapshotRoot, project.project);
    const observed = await observeGoDependencies({ tool, env, cwd, timeoutMs: deadline,
      prior: project.record?.dependencies ?? null });
    dependencies = observed.dependencies;
    attempt.dependency_limitation = observed.limitation;
    attempt.dependency_blocks_provider = observed.blocksProvider;
    if (dependencies.state === "unavailable") {
      throw new SidecarScipProvisionError(
        `Go dependency population ${dependencies.population.join(", ")} could not be measured: ${dependencies.code}`,
        { code: "scip_go_dependencies_unavailable" });
    }
  } else if (project.indexer === SIDECAR_RUST_INDEXER) {

    env = sidecarRustProcessEnvironment({ settings: project.record.settings,
      privateRoot: path.dirname(snapshotRoot) });
    cwd = path.join(snapshotRoot, project.project);
    dependencies = project.record.dependencies;
  } else if (project.indexer === "scip-typescript" && project.dependency_population) {

    await materializeTypescriptConfigPackages({ sourceRepoRoot, snapshotRoot,
      population: project.dependency_population });
    dependencies = project.record?.dependencies ?? null;
  }
  attempt.input_record = project.record ? { ...project.record, dependencies } : null;
  const remaining = deadline - (Date.now() - startedAt);
  if (remaining <= 0) {
    throw new SidecarScipProvisionError(`SCIP provider exceeded ${deadline}ms`, { code: "scip_indexer_timeout" });
  }
  const resolved = (role) => tool.find((entry) => entry.role === role)?.resolved_path ?? null;
  const args = materializeSidecarProviderArgs(project.record?.invocation.args ?? sidecarProjectArgs(project),
    { snapshotRoot, outputPath, committedHead });

  const launch = adapter.runtime
    ? { executable: resolved(adapter.runtime), args: [resolved("indexer"), ...args] }
    : { executable: resolved("indexer"), args };
  const bytes = await runIndexer({
    repoRoot: snapshotRoot, indexer: project.indexer, spec, cacheDir: SCIP_DEFAULT_CACHE_DIR,
    tsconfigPath: project.indexer === "scip-typescript" ? project.project : SCIP_TYPESCRIPT_PROJECT_CONFIG,
    committedHead, deadlineMs: adapter.dependencies ? remaining : deadline,
    ...launch, cwd, env, outputPath
  });
  const layer = normalizeScipIndex(rebaseDocuments(await decodeScipIndex(bytes), cwd === snapshotRoot
    ? "." : project.project), { indexer: project.indexer, baseFileNodeIds });

  if (attempt.dependency_blocks_provider && layer.coverage.document_count === 0) {
    return { input_record: attempt.input_record, dependency_unavailable: {
      dependency_limitation: attempt.dependency_limitation,
      provider_failure: `SCIP provider ${project.indexer} exited successfully and reported no document` } };
  }
  return { ...layer, input_record: attempt.input_record, dependency_limitation: attempt.dependency_limitation };
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
        const attempt = { dependency_limitation: project.dependency_limitation ?? null, input_record: null,
          dependency_blocks_provider: project.dependency_blocks_provider === true };
        try {
          layers.set(project.key, await runProject({ project, spec, sourceRepoRoot, snapshotRoot, committedHead,
            deadline, baseFileNodeIds, runIndexer, attempt }));
        } catch (cause) {
          if (attempt.dependency_limitation && attempt.dependency_blocks_provider &&
              cause?.code === "scip_indexer_exit_failed" &&
              Number.isInteger(cause.exit?.code) && cause.exit.signal === null) {
            layers.set(project.key, { input_record: attempt.input_record, dependency_unavailable: {
              dependency_limitation: attempt.dependency_limitation,
              provider_failure: String(cause.message).slice(0, 500) } });
            continue;
          }
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
