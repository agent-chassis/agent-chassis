

import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { existsSync, writeFileSync, rmSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { types as utilTypes } from "node:util";

import { captureProcessIdentity } from "./process-identity.mjs";
import { withSidecarUpdaterLock } from "./sidecar-store-lifecycle.mjs";
import { sidecarRustConfiguration } from "./sidecar-scip-cargo-scratch.mjs";
import { signalProcessGroup, terminateProcessGroup } from "./process-group.mjs";
import { goModuleCachePopulation, parseGoQuotedDiagnostic } from "./runtime-inputs/ecosystem-inputs-go.mjs";
import { observeSidecarProviderDependencies } from "./sidecar-scip-project-inputs.mjs";
import { describeSidecarGoToolchains } from "./sidecar-scip-go-toolchain.mjs";
import {
  describeSidecarRustProjects,
  isSidecarRustManifest,
  SIDECAR_RUST_INDEXER,
  sidecarRustProcessEnvironment
} from "./sidecar-scip-rust-projects.mjs";
import {
  discoverSidecarGoProjects,
  discoverSidecarPythonProjects,
  materializeSidecarProviderArgs,
  observeSidecarProjectTools,
  SCIP_TYPESCRIPT_PROJECT_CONFIG,
  SIDECAR_SCIP_PROVIDER_ADAPTERS,
  sidecarGoProcessEnvironment,
  sidecarProjectArgs,
  sidecarTypescriptProjectConfigs,
  sidecarProjectSettings
} from "./sidecar-scip-projects.mjs";
import { groupTypescriptProjects } from "./sidecar-scip-typescript-plan.mjs";
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

function boundedStderrCapture() {
  const headLimit = SCIP_INDEXER_STDERR_LIMIT_BYTES / 2;
  const tailLimit = SCIP_INDEXER_STDERR_LIMIT_BYTES - headLimit;
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let bytes = 0;
  const text = (buffer) => {
    let start = 0;
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;

    return new StringDecoder("utf8").write(buffer.subarray(start));
  };
  return {
    append(chunk) {
      const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += next.length;
      if (head.length < headLimit) {
        head = Buffer.concat([head, next.subarray(0, headLimit - head.length)]);
      }

      tail = next.length >= tailLimit ? Buffer.from(next.subarray(-tailLimit))
        : Buffer.from(Buffer.concat([tail, next]).subarray(-tailLimit));
    },
    read() {
      const truncated = bytes > SCIP_INDEXER_STDERR_LIMIT_BYTES;
      const marker = "\n[stderr truncated]\n";
      const overlap = Math.max(0, head.length + tail.length - bytes);
      return { bytes, truncated, text: truncated
        ? text(head.subarray(0, headLimit - Buffer.byteLength(marker))) + marker + text(tail)
        : text(Buffer.concat([head, tail.subarray(overlap)])) };
    }
  };
}

export function runBoundedScipIndexerProcess({ executable, args, cwd, outputPath, env = undefined,
  captureStdout = false, ownerDirectory = null, timeoutMs = SCIP_INDEXER_DEFAULT_DEADLINE_MS, spawnProcess = spawn } = {}) {
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

    const processRecord = ownerDirectory ? path.join(ownerDirectory, `process-${child.pid}.json`) : null;
    if (processRecord) {
      try { writeFileSync(processRecord, JSON.stringify(captureProcessIdentity(child.pid)), { flag: "wx", mode: 0o600 }); }
      catch (error) { signalProcessGroup(child.pid, "SIGKILL"); reject(error); return; }
    }
    const stderr = boundedStderrCapture();
    const stdoutChunks = [];
    let stdoutBytes = 0;
    let terminalReason = null;
    let settled = false;
    let deadlineTimer = null;
    let exit = null;
    let closed;
    const close = new Promise((resolveClose) => { closed = resolveClose; });

    const diagnosticChunks = [];
    let diagnosticBytes = 0;
    let diagnosticTail = Buffer.alloc(0);
    const onDiagnosticStdout = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      diagnosticTail = Buffer.concat([diagnosticTail, bytes.subarray(-SCIP_INDEXER_DIAGNOSTIC_STDOUT_BYTES)])
        .subarray(-SCIP_INDEXER_DIAGNOSTIC_STDOUT_BYTES);
      const remaining = SCIP_INDEXER_DIAGNOSTIC_STDOUT_BYTES - diagnosticBytes;
      if (remaining > 0) diagnosticChunks.push(bytes.subarray(0, remaining));
      diagnosticBytes += Math.min(bytes.length, Math.max(remaining, 0));
    };
    const diagnosticStdout = () => Buffer.concat(captureStdout ? stdoutChunks : diagnosticChunks)
      .subarray(0, SCIP_INDEXER_DIAGNOSTIC_STDOUT_BYTES).toString("utf8");
    const failureText = () => [stderr.read().text, diagnosticStdout()]
      .map((value) => value.trim()).filter(Boolean).join("\n");
    const withDiagnostics = (error) => Object.assign(error, {
      ...(exit ? { exit } : {}), diagnostics: { stderr: stderr.read() },
      diagnostic_stdout_tail: diagnosticTail.toString("utf8")
    });
    const rejectFailure = (error) => {

      if (error.code === "scip_indexer_exit_failed") error.message += `: ${failureText()}`;
      reject(withDiagnostics(error));
    };
    const cleanup = () => {
      clearTimeout(deadlineTimer);
      if (processRecord) rmSync(processRecord, { force: true });
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

      void Promise.all([terminateScipProcessGroup(child), close]).then(
        () => finish(() => rejectFailure(reason)),
        (cause) => finish(() => rejectFailure(cause?.code === "scip_indexer_reap_timeout"
          ? cause
          : new SidecarScipProvisionError(
              `SCIP provider process tree could not be terminated: ${cause?.message ?? cause}`,
              { code: "scip_indexer_process_tree_termination_failed", cause }
            )))
      );
    };
    const onStderr = (chunk) => {
      stderr.append(chunk);
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
      exit = Object.freeze({ code, signal });
      closed();
      if (terminalReason !== null) return;
      if (code !== 0 || signal !== null) {
        beginTermination(new SidecarScipProvisionError(
          `SCIP provider exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
          { code: "scip_indexer_exit_failed" }
        ));
        return;
      }
      clearTimeout(deadlineTimer);
      void terminateScipProcessGroup(child).then(
        () => (captureStdout ? Promise.resolve(Buffer.concat(stdoutChunks)) : readFile(outputPath)).then(
          (bytes) => finish(() => resolve(bytes)),
          (cause) => finish(() => rejectFailure(new SidecarScipProvisionError(
            `SCIP provider produced no output at ${outputPath}: ${cause.message}`,
            { code: "scip_indexer_output_missing", cause }
          )))
        ),
        (cause) => finish(() => rejectFailure(new SidecarScipProvisionError(
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

async function defaultRunIndexer({ executable, args, cwd, env, outputPath, deadlineMs, ownerDirectory }) {
  return runBoundedScipIndexerProcess({ executable, args, cwd, env, outputPath, ownerDirectory, timeoutMs: deadlineMs });
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

export function discoverSidecarScipProjects(trackedPaths, { goFiles = new Map(), goToolchains = new Map(),
  rustProjects = [], typescriptConfigs = new Map(), repoRoot = null } = {}) {
  if (!Array.isArray(trackedPaths)) {
    throw new TypeError("SCIP project discovery requires the current checkout paths");
  }
  const projects = [];
  for (const config of sidecarTypescriptProjectConfigs(trackedPaths)) {
    const { population: typescriptConfigPackages = [], missing: typescriptConfigMissing = [] } =
      typescriptConfigs.get(config) ?? {};
    projects.push(Object.freeze({ key: `scip-typescript#${config}`,
      indexer: "scip-typescript", project: config,
      dependency_population: typescriptConfigPackages.length > 0
        ? Object.freeze([...typescriptConfigPackages].sort()) : null,
      ...(typescriptConfigMissing.length > 0 ? {
        dependency_limitation: Object.freeze({ code: "scip_typescript_config_input_unavailable",
          message: `${config} requires unavailable configuration: ${typescriptConfigMissing.join("; ")}; ` +
            "restore the missing input, then explicitly build again (nothing is generated or installed here)" }),
        dependency_blocks_provider: true
      } : {}) }));
  }
  return [...groupTypescriptProjects(projects, typescriptConfigs), ...discoverSidecarPythonProjects(trackedPaths, repoRoot),
    ...discoverSidecarGoProjects(trackedPaths, goFiles, goToolchains), ...rustProjects];
}

export async function describeSidecarGoToolchainsInCheckout({ sourceRepoRoot, trackedPaths, goFiles, privateRoot, env = process.env,
  deadlineMs = SCIP_INDEXER_DEFAULT_DEADLINE_MS }) {
  return describeSidecarGoToolchains({ projects: discoverSidecarGoProjects(trackedPaths, goFiles), checkoutRoot: sourceRepoRoot, privateRoot, env,
    timeoutMs: resolveScipProviderDeadlineMs(deadlineMs), run: (request) => runBoundedScipIndexerProcess({ ...request, ownerDirectory: privateRoot }) });
}

export async function describeSidecarRustProjectsInCheckout({ sourceRepoRoot, privateRoot, trackedPaths,
  env = process.env, deadlineMs = SCIP_INDEXER_DEFAULT_DEADLINE_MS }) {
  const manifests = trackedPaths.filter(isSidecarRustManifest);
  if (manifests.length === 0) return [];
  const timeoutMs = resolveScipProviderDeadlineMs(deadlineMs);
  try {
    return await describeSidecarRustProjects({ manifests, env, timeoutMs,
      checkoutRoot: sourceRepoRoot, privateRoot,
      run: (request) => runBoundedScipIndexerProcess({ ...request, ownerDirectory: privateRoot }) });
  } catch (error) {
    if (error instanceof SidecarScipProvisionError) throw error;
    throw new SidecarScipProvisionError(
      `checkout Rust project description failed: ${String(error?.message ?? error).slice(0, 500)}`,
      { code: "scip_rust_description_failed", cause: error });
  }
}

async function withCheckoutWorkspace(sourceRepoRoot, privateRoot, operation) {
  if (privateRoot) return operation(sourceRepoRoot, privateRoot);
  return withSidecarUpdaterLock(path.join(sourceRepoRoot, ".cache/repo-code-index/lifecycle.sqlite"),
    (lock) => operation(sourceRepoRoot, lock.workspace_path), { indexing: true });
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
  try {
    return parseGoQuotedDiagnostic(quoted);
  } catch (cause) {
    throw new SidecarScipProvisionError(`Go dependency listing returned an invalid quoted diagnostic: ${cause.message}`,
      { code: "scip_go_dependency_output_invalid", cause });
  }
}

async function observeGoDependencies({ tool, env, cwd, timeoutMs, prior }) {
  const go = tool.find(({ role }) => role === "go").resolved_path;
  const unavailable = (detail, cause) => new SidecarScipProvisionError(
    `Go packages or dependencies are unavailable offline: ${String(detail).slice(0, 500)}`,
    { code: cause?.code === "scip_indexer_timeout" ? cause.code : "scip_go_dependencies_unavailable", cause });
  const list = (args) => runBoundedScipIndexerProcess({ executable: go, cwd, env, captureStdout: true, timeoutMs, ownerDirectory: env.HOME ? path.dirname(env.HOME) : null,
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
      throw cause;
    }
    try {
      lines = (await list(["-m", "-f", `{{if .Error}}${GO_UNLOCATED_LINE}\t{{.Path}}@{{.Version}}\t` +
        `{{printf "%q" .Error.Err}}{{else}}${GO_MODULE_FIELDS}{{end}}`, "all"])).toString("utf8").split("\n");
    } catch (secondary) {
      throw new SidecarScipProvisionError(`Go package load failed: ${cause.message.slice(0, 170)}; ` +
        `module probe also failed (${secondary.code ?? "untyped"}): ${secondary.message.slice(0, 170)}`,
        { code: secondary.code ?? "scip_go_dependency_probe_failed", cause: new AggregateError([cause, secondary]) });
    }
    unlocated = unlocatedIn(lines);
    if (unlocated.size === 0) throw cause;
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

async function runProject({ project, spec, checkoutRoot, privateRoot, deadline, baseFileNodeIds,
  runIndexer, attempt }) {
  const startedAt = Date.now();
  const adapter = SIDECAR_SCIP_PROVIDER_ADAPTERS[project.indexer];
  const tool = projectExecutables(project, runIndexer === defaultRunIndexer || project.indexer === "scip-go" ||
    project.indexer === SIDECAR_RUST_INDEXER);
  const outputPath = path.join(privateRoot, spec.output);
  let env;
  let cwd = checkoutRoot;
  let dependencies = null;
  if (project.indexer === "scip-go") {
    env = sidecarGoProcessEnvironment({ tool,
      settings: project.record?.settings ?? sidecarProjectSettings(project, process.env),
      checkoutRoot, privateRoot });
    cwd = path.join(checkoutRoot, project.project);
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
      privateRoot });
    cwd = path.join(checkoutRoot, project.project);
    dependencies = project.record.dependencies;
  } else if (project.indexer === "scip-python") {
    cwd = path.join(checkoutRoot, project.project);
  } else if (project.indexer === "scip-typescript" && project.dependency_population) {
    dependencies = project.record?.dependencies ?? null;
  }
  attempt.input_record = project.record ? { ...project.record, dependencies } : null;
  const remaining = deadline - (Date.now() - startedAt);
  if (remaining <= 0) {
    throw new SidecarScipProvisionError(`SCIP provider exceeded ${deadline}ms`, { code: "scip_indexer_timeout" });
  }
  const resolved = (role) => tool.find((entry) => entry.role === role)?.resolved_path ?? null;
  const args = materializeSidecarProviderArgs(project.record?.invocation.args ?? sidecarProjectArgs(project),
    { checkoutRoot, outputPath });
  if (project.indexer === SIDECAR_RUST_INDEXER) {
    args.push("--config-path", await sidecarRustConfiguration({ privateRoot, project: project.project }));
  }

  const groupedTypescript = project.indexer === "scip-typescript" && project.membership?.state === "resolved";
  if (groupedTypescript) rmSync(`${outputPath}.projects.json`, { force: true });
  const launch = groupedTypescript
    ? { executable: resolved("node"), args: [
      ...adapter.runtimeArgs(project.record?.settings ?? sidecarProjectSettings(project, process.env)),
      fileURLToPath(new URL("./sidecar-scip-typescript-runner.mjs", import.meta.url)),
      resolved("indexer"), ...args] }
    : adapter.runtime
    ? { executable: resolved(adapter.runtime), args: [
      ...adapter.runtimeArgs(project.record?.settings ?? sidecarProjectSettings(project, process.env)),
      resolved("indexer"), ...args] }
    : { executable: resolved("indexer"), args };
  let bytes;
  bytes = await runIndexer({
      repoRoot: checkoutRoot, indexer: project.indexer, spec,
      tsconfigPath: project.indexer === "scip-typescript" ? project.project : SCIP_TYPESCRIPT_PROJECT_CONFIG,
      ownerDirectory: privateRoot, deadlineMs: adapter.dependencies ? remaining : deadline,
      ...launch, cwd, env, outputPath
    });
  let configurationCoverage = null;
  if (groupedTypescript) {
    let text;
    try { text = await readFile(`${outputPath}.projects.json`, "utf8"); }
    catch (cause) {
      if (cause.code !== "ENOENT") throw cause;
      throw new SidecarScipProvisionError(`SCIP provider ${project.key} returned no configuration coverage`,
        { code: "scip_indexer_output_invalid", cause });
    }
    try { configurationCoverage = JSON.parse(text); }
    catch (cause) {
      throw new SidecarScipProvisionError(`SCIP provider ${project.key} returned malformed configuration coverage: ${cause.message}`,
        { code: "scip_indexer_output_invalid", cause });
    }
  }
  if (groupedTypescript && (!Array.isArray(configurationCoverage) ||
      configurationCoverage.some(member => member === null || typeof member !== "object" ||
        typeof member.configuration !== "string" || !Array.isArray(member.diagnostics) ||
        member.diagnostics.some(diagnostic => !Number.isInteger(diagnostic?.code) || typeof diagnostic.message !== "string")) ||
      JSON.stringify(configurationCoverage.map((member) => member.configuration).sort()) !==
        JSON.stringify([...project.configurations].sort()) ||
      configurationCoverage.some((member) => !["indexed", "empty_project", "configuration_error", "configuration_unavailable"].includes(member.state) ||
        !Number.isSafeInteger(member.document_count) || member.document_count < 0))) {
    throw new SidecarScipProvisionError(`SCIP provider ${project.key} returned invalid configuration coverage`,
      { code: "scip_indexer_output_invalid" });
  }
  const configurationErrors = configurationCoverage?.filter(member =>
    member.state === "configuration_error" || member.state === "configuration_unavailable") ?? [];
  if (configurationErrors.length > 0) {
    attempt.dependency_limitation = {
      code: configurationErrors.some(member => member.state === "configuration_error")
        ? "scip_typescript_configuration_invalid" : "scip_typescript_config_input_unavailable",
      message: configurationErrors.map(member => `${member.configuration}: ${member.diagnostics
        .map(diagnostic => `TS${diagnostic.code}: ${diagnostic.message}`).join("; ")}`).join("; ")
    };
    attempt.dependency_blocks_provider = true;
  }
  const emptyProject = configurationCoverage?.every(member => member.state === "empty_project") === true;
  const decoded = await decodeScipIndex(bytes);
  if (project.indexer === "scip-typescript") {

    const documents = new Map();
    for (const document of decoded.documents) {
      let merged = documents.get(document.relativePath);
      if (!merged) {
        merged = { document: { ...document, occurrences: [], symbols: [] }, occurrences: new Map(), symbols: new Set() };
        documents.set(document.relativePath, merged);
      }
      const counts = new Map();
      for (const occurrence of document.occurrences) {
        const identity = JSON.stringify(occurrence);
        const count = (counts.get(identity) ?? 0) + 1;
        counts.set(identity, count);
        if (count <= (merged.occurrences.get(identity) ?? 0)) continue;
        merged.document.occurrences.push(occurrence);
        merged.occurrences.set(identity, count);
      }
      for (const symbol of document.symbols) {
        const identity = JSON.stringify(symbol);
        if (merged.symbols.has(identity)) continue;
        merged.symbols.add(identity);
        merged.document.symbols.push(symbol);
      }
    }
    decoded.documents = [...documents.values()].map(({ document }) => document);
  }
  const rebased = rebaseDocuments(decoded, cwd === checkoutRoot ? "." : project.project);
  if (project.indexer === "scip-python" && project.excluded_roots?.length > 0) {
    rebased.documents = rebased.documents.filter((document) => !project.excluded_roots.some((root) =>
      document.relativePath?.startsWith(`${root}/`)));
  }
  const layer = normalizeScipIndex(rebased, { indexer: project.indexer, baseFileNodeIds });

  if (attempt.dependency_blocks_provider && layer.coverage.document_count === 0) {
    return { input_record: attempt.input_record, dependency_unavailable: {
      dependency_limitation: attempt.dependency_limitation,
      ...(configurationCoverage ? { configuration_coverage: configurationCoverage } : {}),
      provider_failure: configurationCoverage ? JSON.stringify(configurationCoverage)
        : `SCIP provider ${project.indexer} exited successfully and reported no document` } };
  }
  const usable = layer.symbol_occurrences.length > 0;
  return { ...layer, empty_project: emptyProject, usable_navigation: usable,
    ...(configurationCoverage ? { configuration_coverage: configurationCoverage } : {}),
    input_record: attempt.input_record, dependency_limitation: attempt.dependency_limitation };
}

export async function runScipProjectsFromCheckout(rawOptions) {
  const {
    sourceRepoRoot, privateRoot, projects, baseFileNodeIds, deadlineMs, runIndexer
  } = snapshotScipOptions(rawOptions, [["sourceRepoRoot", undefined],
    ["privateRoot", undefined], ["projects", undefined], ["baseFileNodeIds", null],
    ["deadlineMs", SCIP_INDEXER_DEFAULT_DEADLINE_MS], ["runIndexer", defaultRunIndexer]
  ], "checkout SCIP");
  if (typeof sourceRepoRoot !== "string" || sourceRepoRoot.length === 0) {
    throw new TypeError("checkout SCIP requires sourceRepoRoot");
  }
  if (!Array.isArray(projects)) throw new TypeError("checkout SCIP requires projects");
  const deadline = resolveScipProviderDeadlineMs(deadlineMs);
  const layers = new Map();
  if (projects.length === 0) return layers;
  try {
    return await withCheckoutWorkspace(sourceRepoRoot, privateRoot, async (checkoutRoot, privateRoot) => {
      await mkdir(privateRoot, { recursive: true });
      for (const project of projects) {
        const spec = SCIP_INDEXER_SPECS[project?.indexer];
        if (!spec || typeof project.key !== "string" || project.key.length === 0) {
          throw new TypeError(`unsupported SCIP project: ${JSON.stringify(project)}`);
        }
        const attempt = { dependency_limitation: project.dependency_limitation ?? null, input_record: null,
          dependency_blocks_provider: project.dependency_blocks_provider === true };
        try {
          layers.set(project.key, await runProject({ project, spec, checkoutRoot, privateRoot,
            deadline, baseFileNodeIds, runIndexer, attempt }));
        } catch (cause) {
          if (attempt.dependency_limitation && attempt.dependency_blocks_provider &&
              cause?.code === "scip_indexer_exit_failed" &&
              Number.isInteger(cause.exit?.code) && cause.exit.signal === null &&
              project.indexer !== "scip-typescript") {
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
      `checkout SCIP provisioning failed: ${String(error?.message ?? "unknown").slice(0, 500)}`,
      { code: "scip_checkout_provision_failed", cause: error }
    );
  }
}
