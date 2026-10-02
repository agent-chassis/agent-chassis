

import path from "node:path";

import { observeExecutable } from "./executable-lookup.mjs";
import { TOOLCHAIN_DESCRIPTIONS } from "./toolchain-descriptions.mjs";

const PYTHON_DESCRIBE_PROGRAM = [
  "import json, os, platform, sys, sysconfig",
  "print(json.dumps({'executable': os.path.realpath(sys.executable),",
  "  'version': platform.python_version(), 'prefix': sys.base_prefix,",
  "  'stdlib': os.path.realpath(sysconfig.get_paths()['stdlib'])}))"
].join("\n");
const PYTHON_VERSION = /^\d+\.\d+\.\d+(?:[a-z]+\d*)?$/u;

function failure(request, code, phase, message, correction, evidence = {}) {
  return { status: "failed", code, phase, toolchain: request.description?.name ?? null,
    executable: request.executable ?? null, source: request.source ?? null,
    message, correction, ...evidence };
}

function isAbsolutePath(value) {
  return typeof value === "string" && value.length > 0 && path.isAbsolute(value);
}

function isEnvironment(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string");
}

function requestProblem({ description, executable, requiredRoles, source, probe, probeContext }) {
  if (!Object.values(TOOLCHAIN_DESCRIPTIONS).includes(description)) return "description must be a shared description";
  if (!isAbsolutePath(executable)) return "executable must be a nonempty absolute path";
  if (!Array.isArray(requiredRoles) || requiredRoles.length === 0) return "requiredRoles must be a nonempty array";
  const unknown = requiredRoles.filter((role) =>
    typeof role !== "string" || !Object.hasOwn(description.executables, role));
  if (unknown.length > 0) return `unknown ${description.name} roles ${unknown.map(String).join(", ")}`;
  if (typeof source !== "string" || source.length === 0) return "source must be a nonempty string";
  if (typeof probe !== "function") return "probe must be a bounded process function";
  const { cwd, env, timeoutMs, signal } = probeContext ?? {};
  if (!isAbsolutePath(cwd)) return "probeContext.cwd must be an absolute path";
  if (env === null || typeof env !== "object" ||
      !["root", "describe", "version"].every((name) => isEnvironment(env[name]))) {
    return "probeContext.env must map root, describe and version to string environments";
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return "probeContext.timeoutMs must be positive and finite";
  if (signal !== undefined && !(signal instanceof AbortSignal)) return "probeContext.signal must be an AbortSignal";
  return null;
}

function invalidOutput(request, phase, probed, reason, cause) {
  return failure(request, "runtime_input_installation_output_invalid", phase,
    `${phase} probe ${probed.command} for ${request.description.name} returned unusable output: ${reason}`,
    `make ${probed.command} report a complete ${request.description.name} installation, or select another`,
    { command: probed.command, args: probed.args, result: probed.result,
      ...(cause === undefined ? {} : { cause }) });
}

async function runProbe(request, phase, command, args, env) {
  const { cwd, timeoutMs, signal } = request.probeContext;
  const evidence = { command, args: [...args] };
  const probeFailed = (message, correction, fields) => failure(request,
    "runtime_input_installation_probe_failed", phase, message, correction, { ...evidence, ...fields });
  let result;
  try {
    result = await request.probe({ command, args: [...args], cwd, env: { ...env },
      deadline: Date.now() + timeoutMs, signal, output: "text" });
  } catch (cause) {
    return probeFailed(`${phase} probe ${command} for ${request.description.name} threw: ${cause?.message ?? String(cause)}`,
      "repair the injected process capability so it returns a process outcome", { cause });
  }

  if (result?.ok !== true || typeof result.stdout !== "string") {
    return probeFailed(`${phase} probe ${command} for ${request.description.name} did not succeed`,
      `repair ${command} so ${[command, ...args].join(" ")} succeeds, or select another installation`, { result });
  }
  return { ...evidence, result, text: result.stdout.trim() };
}

async function describePython(request) {
  const probed = await runProbe(request, "describe", request.executable,
    ["-I", "-B", "-c", PYTHON_DESCRIBE_PROGRAM], request.probeContext.env.describe);
  if (probed.status === "failed") return probed;
  let described;
  try {
    described = JSON.parse(probed.text);
  } catch (cause) {
    return invalidOutput(request, "describe", probed, "output is not JSON", cause);
  }
  if (described === null || typeof described !== "object" || Array.isArray(described)) {
    return invalidOutput(request, "describe", probed, "output is not a JSON object");
  }
  for (const field of ["executable", "prefix", "stdlib"]) {
    if (!isAbsolutePath(described[field])) {
      return invalidOutput(request, "describe", probed, `${field} is not a nonempty absolute path`);
    }
  }
  if (typeof described.version !== "string" || !PYTHON_VERSION.test(described.version)) {
    return invalidOutput(request, "describe", probed, "version is not a numeric Python version");
  }
  const executables = { python: described.executable };
  return componentFailure(request, described.prefix, executables) ?? { root: described.prefix, executables,
    population: [described.executable, described.stdlib],
    population_exclude: ["__pycache__", "site-packages", "dist-packages"], version: described.version };
}

async function locateRoot(request) {
  const { description, executable } = request;
  if (!description.host_root_probe) return { root: description.hostRoot(executable) };
  const probed = await runProbe(request, "root", executable, description.host_root_probe,
    request.probeContext.env.root);
  if (probed.status === "failed") return probed;
  if (!isAbsolutePath(probed.text)) {
    return invalidOutput(request, "root", probed, "toolchain root is not a nonempty absolute path");
  }
  return { root: probed.text };
}

function componentFailure(request, root, executables) {
  const missing = [];
  for (const [role, file] of Object.entries(executables)) {
    const observation = observeExecutable({ executable: file });
    if (observation.status === "failed") {
      return failure(request, "runtime_input_installation_component_lookup_failed", "components",
        `component lookup for ${request.description.name} role ${role} at ${file} failed: ${observation.message}`,
        observation.correction, { root, role, path: file, observation,
          ...(observation.cause === undefined ? {} : { cause: observation.cause }) });
    }
    if (observation.status === "absent") missing.push({ role, path: file });
  }
  if (missing.length === 0) return null;
  return failure(request, "runtime_input_installation_components_missing", "components",
    `${request.description.name} installation at ${root} is missing ${missing.map(({ role }) => role).join(", ")}`,
    `install the missing components at ${missing.map(({ path: file }) => file).join(", ")}, or select a complete installation`,
    { root, required_roles: Object.keys(executables), missing });
}

async function observeLayout(request) {
  const { description, requiredRoles, probeContext } = request;
  const located = await locateRoot(request);
  if (located.status === "failed") return located;
  const { root } = located;

  const roles = new Set([...requiredRoles, description.probe.executable]);
  const executables = Object.fromEntries(Object.entries(description.executables)
    .filter(([role]) => roles.has(role)).map(([role, relative]) => [role, path.join(root, relative)]));
  const missing = componentFailure(request, root, executables);
  if (missing !== null) return missing;
  const command = executables[description.probe.executable];
  const probed = await runProbe(request, "version", command, description.probe.args, {
    ...probeContext.env.version,
    PATH: [path.dirname(command), probeContext.env.version.PATH].filter(Boolean).join(path.delimiter),
    RUSTC: executables.rustc ?? "" });
  if (probed.status === "failed") return { ...probed, root };
  const version = description.probe.version(probed.text);
  if (version === null) {
    return { ...invalidOutput(request, "version", probed, "version text is not recognized"), root };
  }
  return { root, executables, population: description.population.map((relative) => path.join(root, relative)),
    population_exclude: [], version };
}

export async function observeToolchainInstallation(request) {
  const problem = requestProblem(request ?? {});
  if (problem !== null) {
    return failure(request ?? {}, "runtime_input_installation_invalid", "request", `installation observation request: ${problem}`,
      "call observeToolchainInstallation with a shared description, absolute executable, known roles and probe context");
  }
  const observed = request.description.name === "python"
    ? await describePython(request) : await observeLayout(request);
  if (observed.status === "failed") return observed;
  return { status: "observed", ...observed, source: request.source };
}
