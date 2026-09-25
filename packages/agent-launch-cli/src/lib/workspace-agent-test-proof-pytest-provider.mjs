

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { launcherArtifact } from "./workspace-agent-test-proof-node-observation.mjs";
import { nativeRuntimeTestId } from "./workspace-agent-test-proof-runtime-identity.mjs";

export const PYTEST_PROOF_PLUGIN_PATH = fileURLToPath(
  new URL("./workspace_agent_test_proof_pytest.py", import.meta.url));
export const PYTEST_PROOF_PROTOCOL_SCHEMA_VERSION = "workspace-agent-test-proof-pytest-events.v1";
export const PYTEST_PROOF_CONFIGURATION_SCHEMA_VERSION =
  "workspace-agent-test-proof-pytest-configuration.v1";
export const PYTEST_RUNTIME_INPUTS_SCHEMA_VERSION =
  "workspace-agent-test-proof-pytest-runtime-inputs.v2";
export const PYTEST_FAULT_REASON_CODE = "test_proof_fault.result_inversion.v1";

export const PYTEST_PROVIDER_MODES = Object.freeze({
  "launcher.pytest": "candidate",
  "launcher.pytest-scalar-return": "falsifier",
  "launcher.pytest-call-trace": "traversal"
});

export const PYTEST_PROVIDER_ERROR_CODES = Object.freeze({
  INTERPRETER_UNAVAILABLE: "test_proof_native_interpreter_unavailable",
  RUNTIME_UNAVAILABLE: "test_proof_native_runtime_unavailable",
  RUNTIME_INPUTS_MOVED: "test_proof_native_runtime_inputs_stale",
  PREPARATION_INTERRUPTED: "test_proof_native_preparation_interrupted"
});

const SYSTEM_READ_ONLY_PREFIXES = Object.freeze(["/usr", "/etc", "/opt", "/lib", "/lib64", "/bin", "/sbin"]);
const HOST_LOCATE_OUTPUT_CAP_BYTES = 65536;

const HOST_LOCATE_PROGRAM = [
  "import importlib.metadata as metadata, importlib.util, json, os, platform, sys",
  "def report(origins, missing):",
  "    print(json.dumps({'executable': os.path.realpath(sys.executable), 'version': platform.python_version(), 'origins': origins, 'missing': sorted(missing)}))",
  "try:",
  "    from packaging.requirements import Requirement",
  "    from packaging.utils import canonicalize_name",
  "except ModuleNotFoundError as error:",
  "    report({}, [error.name or 'packaging'])",
  "    raise SystemExit(0)",
  "owners = {}",
  "for module, distributions in metadata.packages_distributions().items():",
  "    for distribution in distributions:",
  "        owners.setdefault(canonicalize_name(distribution), set()).add(module)",
  "seen, queue, missing = set(), ['pytest'], []",
  "while queue:",
  "    name = canonicalize_name(queue.pop())",
  "    if name in seen:",
  "        continue",
  "    seen.add(name)",
  "    try:",
  "        requirements = metadata.requires(name) or []",
  "    except metadata.PackageNotFoundError:",
  "        missing.append(name)",
  "        continue",
  "    for text in requirements:",
  "        requirement = Requirement(text)",
  "        if requirement.marker is None or requirement.marker.evaluate({'extra': ''}):",
  "            queue.append(requirement.name)",
  "origins = {}",
  "for module in sorted({module for name in seen for module in owners.get(name, ()) if not module.startswith('__')}):",
  "    spec = importlib.util.find_spec(module)",
  "    origins[module] = None if spec is None or spec.origin is None else os.path.realpath(spec.origin)",
  "print(json.dumps({'executable': os.path.realpath(sys.executable), 'version': platform.python_version(), 'origins': origins, 'missing': sorted(missing)}))"
].join("\n");

export class PytestProviderError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "PytestProviderError";
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = null) {
  throw new PytestProviderError(code, message, detail);
}

function sha256Digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function underSystemRoot(absolute) {
  return SYSTEM_READ_ONLY_PREFIXES.some((prefix) =>
    absolute === prefix || absolute.startsWith(`${prefix}/`));
}

function fileDigest(absolute) {
  return sha256Digest(readFileSync(absolute));
}

function runtimePackagePath(origin) {
  return path.basename(origin) === "__init__.py" ? path.dirname(origin) : origin;
}

function treeDigest(absolute) {
  if (!statSync(absolute).isDirectory()) return fileDigest(absolute);
  const hash = createHash("sha256");
  const visit = (directory, prefix) => {
    for (const name of readdirSync(directory).sort()) {
      if (name === "__pycache__") continue;
      const child = path.join(directory, name);
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(child).isDirectory()) visit(child, relative);
      else hash.update(`${JSON.stringify([relative, fileDigest(child)])}\n`);
    }
  };
  visit(absolute, "");
  return `sha256:${hash.digest("hex")}`;
}

function measureRuntimeInputs({ interpreter, interpreterVersion, runtimePackages }) {
  const identity = {
    schema_version: PYTEST_RUNTIME_INPUTS_SCHEMA_VERSION,
    interpreter_version: interpreterVersion,
    interpreter_digest: fileDigest(interpreter),
    provider_asset_digest: fileDigest(PYTEST_PROOF_PLUGIN_PATH),
    runtime_package_digests: Object.fromEntries(Object.entries(runtimePackages)
      .map(([name, absolute]) => [name, treeDigest(absolute)]))
  };
  return { ...identity, runtime_inputs_digest: sha256Digest(JSON.stringify(canonicalize(identity))) };
}

function resolveInterpreter(searchPath) {
  for (const directory of String(searchPath ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, "python3");
    try {
      accessSync(candidate, constants.X_OK);
      const real = realpathSync(candidate);
      if (statSync(real).isFile()) return real;
    } catch {

    }
  }
  return null;
}

function interruptionError(budget) {
  const interruption = budget?.interruption?.() ?? null;
  return interruption === null ? null : new PytestProviderError(
    PYTEST_PROVIDER_ERROR_CODES.PREPARATION_INTERRUPTED,
    "native provider preparation was interrupted by the invocation execution budget",
    { interruption });
}

function locateInstalledRuntime(interpreter, budget) {
  const pending = interruptionError(budget);
  if (pending !== null) return Promise.reject(pending);
  const remainingMs = budget?.remainingMs?.() ?? 30000;
  return new Promise((resolve, reject) => {
    const child = execFile(interpreter, ["-E", "-P", "-c", HOST_LOCATE_PROGRAM], {
      cwd: path.dirname(PYTEST_PROOF_PLUGIN_PATH),
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      timeout: Math.max(1, remainingMs),
      killSignal: "SIGKILL",
      maxBuffer: HOST_LOCATE_OUTPUT_CAP_BYTES,
      ...(budget?.signal ? { signal: budget.signal } : {})
    }, (error, stdout, stderr) => {
      const interrupted = interruptionError(budget);
      if (interrupted !== null) return reject(interrupted);

      if (error) return reject(new PytestProviderError(PYTEST_PROVIDER_ERROR_CODES.RUNTIME_UNAVAILABLE,
        "installed interpreter could not run the launcher runtime locate program",
        locateFailureDetail("runtime_locate_failed", error, stderr)));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new PytestProviderError(PYTEST_PROVIDER_ERROR_CODES.RUNTIME_UNAVAILABLE,
        "installed interpreter returned an unreadable runtime location",
        locateFailureDetail("runtime_locate_output_invalid", null, stderr))); }
    });
    child.stdin?.end();
  });
}

function locateFailureDetail(failure, error, stderr) {
  return {
    failure,
    exit_code: typeof error?.code === "number" ? error.code : null,
    signal: typeof error?.signal === "string" ? error.signal : null,
    errno: typeof error?.code === "string" ? error.code : null,
    stderr: typeof stderr === "string" ? stderr : String(stderr ?? "")
  };
}

const RUNTIME_CACHE = new Map();

export async function resolveInstalledPytestRuntime({ executionBudget = null, configured = null } = {}) {

  const interpreter = configured === null ? resolveInterpreter(process.env.PATH)
    : configured.interpreter;
  if (interpreter === null) fail(PYTEST_PROVIDER_ERROR_CODES.INTERPRETER_UNAVAILABLE,
    "no installed python3 interpreter is available to the launcher");
  let interpreterReal;
  try {
    interpreterReal = realpathSync(interpreter);
  } catch (error) {
    fail(PYTEST_PROVIDER_ERROR_CODES.INTERPRETER_UNAVAILABLE,
      "the configured python interpreter is not available", { errno: error?.code ?? null });
  }

  const cacheKey = `${interpreter}\0${interpreterReal}\0${process.env.HOME ?? ""}`;
  let located = RUNTIME_CACHE.get(cacheKey);
  if (located === undefined) {
    located = await locateInstalledRuntime(interpreter, executionBudget);
    RUNTIME_CACHE.set(cacheKey, located);
  }
  const modules = Object.keys(located.origins ?? {}).sort();
  const missing = [...(Array.isArray(located.missing) ? located.missing : []),
    ...modules.filter((name) => typeof located.origins[name] !== "string")];
  if (located.executable !== interpreterReal || !modules.includes("pytest") || !modules.includes("_pytest") ||
      missing.length > 0) {
    RUNTIME_CACHE.delete(cacheKey);

    if (located.executable !== interpreterReal) fail(PYTEST_PROVIDER_ERROR_CODES.RUNTIME_UNAVAILABLE,
      "installed interpreter located its runtime under a different executable",
      { failure: "runtime_interpreter_mismatch", missing });
    fail(PYTEST_PROVIDER_ERROR_CODES.RUNTIME_UNAVAILABLE,
      "installed interpreter does not provide the complete pytest runtime",
      { failure: "runtime_inputs_missing",
        missing: missing.length > 0 ? missing : ["pytest", "_pytest"].filter((name) => !modules.includes(name)) });
  }
  const runtimePackages = Object.fromEntries(modules.map((name) =>
    [name, runtimePackagePath(located.origins[name])]));
  let measured;
  try {
    measured = measureRuntimeInputs({ interpreter, interpreterVersion: located.version, runtimePackages });
  } catch (error) {
    RUNTIME_CACHE.delete(cacheKey);
    fail(PYTEST_PROVIDER_ERROR_CODES.RUNTIME_INPUTS_MOVED,
      "installed pytest runtime inputs moved", { errno: error?.code ?? null });
  }
  const runtimePaths = [...new Set(Object.values(runtimePackages).map((entry) => path.dirname(entry)))].sort();

  const hostBinds = [
    ...Object.values(runtimePackages).sort(), path.dirname(interpreter), PYTEST_PROOF_PLUGIN_PATH
  ].filter((absolute, index, all) => !underSystemRoot(absolute) && all.indexOf(absolute) === index)
    .map((absolute) => Object.freeze({ src: absolute, dst: absolute }));
  const configuredBinds = (configured?.read_only_binds ?? [])
    .filter(({ src, dst }) => !hostBinds.some((bind) => bind.src === src && bind.dst === dst))
    .map(({ src, dst }) => Object.freeze({ src, dst }));
  return Object.freeze({
    ...measured,
    interpreter,
    runtime_source: configured === null ? "launcher_path" : "launcher_readiness",
    readiness_digest: configured?.readiness_digest ?? null,

    environment: configured?.route?.environment ?? null,
    route: configured?.route ?? null,

    dependency_roots: Object.freeze([...(configured?.dependency_roots ?? [])]),
    dependency_population: configured === null ? null : Object.freeze({
      source: "launcher_readiness", readiness_digest: configured.readiness_digest,
      environment: configured.route?.environment ?? null, route: configured.route ?? null,

      toolchains: configured.toolchains, dependencies: configured.dependencies }),
    runtime_packages: Object.freeze(runtimePackages),
    runtime_paths: Object.freeze(runtimePaths),
    read_only_binds: Object.freeze([...hostBinds, ...configuredBinds])
  });
}

export function assertInstalledPytestRuntimeCurrent(runtime) {
  let current;
  try {
    current = measureRuntimeInputs({ interpreter: runtime.interpreter,
      interpreterVersion: runtime.interpreter_version, runtimePackages: runtime.runtime_packages });
  } catch (error) {
    fail(PYTEST_PROVIDER_ERROR_CODES.RUNTIME_INPUTS_MOVED, "installed pytest runtime inputs moved",
      { errno: error?.code ?? null });
  }
  const changed = ["interpreter_digest", "provider_asset_digest", "runtime_package_digests",
    "runtime_inputs_digest"].filter((field) =>
    JSON.stringify(canonicalize(current[field])) !== JSON.stringify(canonicalize(runtime[field])));
  if (changed.length > 0) fail(PYTEST_PROVIDER_ERROR_CODES.RUNTIME_INPUTS_MOVED,
    "installed pytest runtime inputs changed after runtime resolution", { changed });
  return runtime;
}

function encodeConfiguration(configuration) {
  return Buffer.from(JSON.stringify(configuration), "utf8").toString("base64url");
}

export function buildPytestProviderRun({
  mode,
  runtime,
  worktree,
  selectedTest,
  attemptNonce,
  selection = null
}) {
  const configuration = {
    schema_version: PYTEST_PROOF_CONFIGURATION_SCHEMA_VERSION,
    mode,
    root: worktree,
    runtime_paths: [...runtime.runtime_paths],
    runtime_packages: Object.values(runtime.runtime_packages).sort(),
    dependency_roots: [...(runtime.dependency_roots ?? [])],
    node_id: selectedTest.node_id,
    target_path: selectedTest.file,
    attempt_nonce: attemptNonce,
    ...(mode === "falsifier" ? {
      fault: { module_path: selection.mutation.module_path,
        function_name: selection.mutation.function_name,
        replacement: selection.mutation.replacement },
      trace_module_path: selection.mutation.module_path
    } : {}),
    ...(mode === "traversal" ? { trace_module_path: selection.module_path } : {})
  };
  return Object.freeze({
    command: runtime.interpreter,
    args: Object.freeze(["-I", "-B", PYTEST_PROOF_PLUGIN_PATH, encodeConfiguration(configuration)]),
    read_only_binds: runtime.read_only_binds,
    target_extensions: Object.freeze([".py"]),
    expectation: Object.freeze({
      family_id: "pytest",
      capability: mode === "probe" ? "preparation" : mode === "candidate" ? "candidate_execution"
        : mode === "falsifier" ? "falsifier_execution" : "boundary_traversal",
      mode,
      attempt_nonce: attemptNonce,
      node_id: selectedTest.node_id,
      target: selectedTest.file,
      target_test_id: selectedTest.test_id,
      provider_id: selectedTest.provider_id,
      provider_version: selectedTest.provider_version,
      runtime_inputs_digest: runtime.runtime_inputs_digest,
      worktree,
      ...(mode === "falsifier" ? { falsifier_id: selection.falsifier_id,
        mutation_id: selection.mutation.mutation_id, module_path: selection.mutation.module_path,
        function_name: selection.mutation.function_name, replacement: selection.mutation.replacement,
        failure_reason_code: selection.failure_reason_code } : {}),
      ...(mode === "traversal" ? { module_path: selection.module_path,
        observation_seam: selection.observation_seam } : {})
    })
  });
}

const PHASE_ORDER = Object.freeze(["setup", "call", "teardown"]);
const PHASE_OUTCOMES = new Set(["passed", "failed", "skipped"]);

function refusal(code, detail = null) {
  return { valid: false, code, ...(detail === null ? {} : { detail }) };
}

function selectedIdentityNotObserved(expectation, collected) {
  const candidates = collected.map((nodeId) => {
    const separator = nodeId.indexOf("::");
    const file = separator < 0 ? null : nodeId.slice(0, separator);
    return { test_id: nativeRuntimeTestId({ provider_id: expectation.provider_id,
      provider_version: expectation.provider_version, path: file ?? expectation.target, node_id: nodeId }),
    file, name: nodeId, nesting: null, status: "skipped", error_codes: [] };
  });
  return refusal("test_proof_selected_identity_not_observed", {
    expected_test_id: expectation.target_test_id,
    target: expectation.target,
    observed_count: candidates.length,
    returned_count: candidates.length,
    omitted_count: 0,
    observed_identity_candidates: candidates,
    file_wrapper_status: null,
    file_wrapper_error_codes: [],
    observed_failures: [],
    observed_failure_count: 0
  });
}

export function authenticateLauncherPytestEnvelope({
  protocolText,
  expectation,
  reporterProtocolOverflow = false
} = {}) {
  if (reporterProtocolOverflow === true) return refusal("test_proof_structured_events_oversized");
  let envelope;
  try { envelope = JSON.parse(protocolText); } catch {
    return refusal("test_proof_structured_events_invalid");
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(",") !== "payload,payload_sha256,schema_version" ||
      envelope.schema_version !== PYTEST_PROOF_PROTOCOL_SCHEMA_VERSION ||
      typeof envelope.payload !== "string" || !/^[a-f0-9]{64}$/u.test(envelope.payload_sha256)) {
    return refusal("test_proof_structured_events_invalid");
  }
  if (createHash("sha256").update(envelope.payload, "utf8").digest("hex") !== envelope.payload_sha256) {
    return refusal("test_proof_structured_events_digest_mismatch");
  }
  let payload;
  try { payload = JSON.parse(envelope.payload); } catch {
    return refusal("test_proof_structured_events_invalid");
  }
  if (payload?.schema_version !== PYTEST_PROOF_PROTOCOL_SCHEMA_VERSION) {
    return refusal("test_proof_structured_events_invalid");
  }
  if (payload.attempt_nonce !== expectation?.attempt_nonce) {
    return refusal("test_proof_structured_events_cross_attempt");
  }
  if (payload.mode !== expectation.mode || payload.node_id !== expectation.node_id ||
      payload.target_path !== expectation.target) {
    return refusal("test_proof_structured_events_binding_mismatch");
  }
  if (payload.runtime_error?.code === "pytest_unavailable") {
    return refusal(PYTEST_PROVIDER_ERROR_CODES.RUNTIME_UNAVAILABLE);
  }

  if (payload.import_policy?.cached_bytecode !== "ignored" ||
      payload.import_policy?.sourceless_bytecode !== "refused") {
    return refusal("test_proof_native_import_policy_unenforced");
  }
  const population = payload.dependency_population;
  if (!Array.isArray(population?.members) || population.count !== population.members.length ||
      population.members.some((member) => typeof member !== "string")) {
    return refusal("test_proof_structured_events_invalid");
  }
  if (population.count > 0) {
    return refusal("test_proof_native_dependency_population_unsupported",
      { count: population.count, members: population.members.slice(0, 64) });
  }
  if (expectation.mode === "probe") return { valid: true, payload, payload_sha256: envelope.payload_sha256 };
  if (payload.fault?.status === "unsupported") {
    return refusal("test_proof_python_fault_unsupported", { reason: payload.fault.reason ?? null });
  }
  if (payload.runtime_error !== null) return refusal("test_proof_structured_events_invalid");
  const collected = payload.collection?.collected_node_ids;
  const phases = payload.phases;
  if (!Array.isArray(collected) || !Array.isArray(phases) ||
      collected.some((nodeId) => typeof nodeId !== "string")) {
    return refusal("test_proof_structured_events_invalid");
  }
  if (new Set(collected).size !== collected.length) {
    return refusal("test_proof_structured_test_identity_duplicate");
  }
  if (!collected.includes(expectation.node_id)) {
    return selectedIdentityNotObserved(expectation, collected);
  }
  if (phases.some((phase) => phase?.nodeid !== expectation.node_id)) {
    return refusal("test_proof_structured_events_unselected_execution");
  }
  const order = phases.map((phase) => PHASE_ORDER.indexOf(phase.when));
  if (phases.some((phase) => !PHASE_OUTCOMES.has(phase.outcome)) || order.includes(-1)) {
    return refusal("test_proof_structured_events_invalid");
  }
  if (new Set(order).size !== order.length) {
    return refusal("test_proof_structured_test_identity_duplicate");
  }
  if (order.some((position, index) => index > 0 && position <= order[index - 1])) {
    return refusal("test_proof_structured_events_lifecycle_invalid");
  }
  const byPhase = Object.fromEntries(phases.map((phase) => [phase.when, phase]));
  const setupPassed = byPhase.setup?.outcome === "passed";
  if (byPhase.setup === undefined || byPhase.teardown === undefined ||
      (setupPassed && byPhase.call === undefined) || (!setupPassed && byPhase.call !== undefined)) {
    return refusal("test_proof_structured_test_inventory_incomplete");
  }
  return { valid: true, payload, byPhase, payload_sha256: envelope.payload_sha256 };
}

function sourceDigestCurrent(expectation, modulePath, observedDigest) {
  try {
    return fileDigest(path.join(expectation.worktree, modulePath)) === observedDigest;
  } catch {
    return false;
  }
}

function selectedOutcome(byPhase) {
  const phases = Object.values(byPhase);
  if (phases.some(({ outcome }) => outcome === "failed")) return "failed";
  if (phases.some(({ outcome }) => outcome === "skipped")) return "skipped";
  return "passed";
}

function structuredResult(authenticated, expectation, exitCode) {
  const outcome = selectedOutcome(authenticated.byPhase);
  const failedPhase = PHASE_ORDER.map((when) => authenticated.byPhase[when])
    .find((phase) => phase?.outcome === "failed");
  const event = {
    type: outcome === "passed" ? "test:pass" : "test:fail",
    test_id: expectation.target_test_id,
    name: expectation.node_id,
    file: expectation.target,
    nesting: null,
    status: outcome === "passed" ? "passed" : "failed",
    error_codes: outcome === "failed" ? [...new Set(failedPhase.error_codes ?? [])] : [],
    ...(outcome === "failed" ? { failure_diagnostic: failedPhase.failure_diagnostic } : {})
  };
  return {
    outcome,
    result: {
      mechanism: "pytest_phase_events",
      exit_code: exitCode,
      summary: { passed: outcome === "passed" ? 1 : 0, failed: outcome === "failed" ? 1 : 0,
        skipped: outcome === "skipped" ? 1 : 0, cancelled: 0, todo: 0, tests: 1 },
      pass_events: outcome === "passed" ? [event] : [],
      fail_events: outcome === "failed" ? [event] : []
    }
  };
}

export function observeLauncherPytestRun({
  protocolText,
  exitCode,
  expectation,
  reporterProtocolOverflow = false
} = {}) {
  const authenticated = authenticateLauncherPytestEnvelope({ protocolText, expectation,
    reporterProtocolOverflow });
  if (!authenticated.valid) return authenticated;
  const payload = authenticated.payload;
  if (expectation.mode === "probe") {
    return { valid: true, status: "prepared", pytest_version: payload.pytest_version,
      python: payload.python, runtime_inputs_digest: expectation.runtime_inputs_digest,
      import_policy: payload.import_policy, consumer_compilation: "none" };
  }
  const { outcome, result } = structuredResult(authenticated, expectation, exitCode);
  const structuredArtifact = launcherArtifact("structured_test_result", result);
  const status = outcome === "passed" ? "passed" : "failed";
  if (expectation.capability === "candidate_execution") {
    if ((exitCode === 0) !== (outcome !== "failed")) {
      return refusal("test_proof_structured_events_exit_status_mismatch");
    }
    const inventory = {
      mechanism: "pytest_phase_events",
      node_id: expectation.node_id,
      target: expectation.target,
      target_test_id: expectation.target_test_id,
      collected_node_ids: payload.collection.collected_node_ids,
      selected_node_ids: payload.collection.selected_node_ids,
      collection_errors: payload.collection.errors,
      phases: payload.phases.map(({ nodeid, when, outcome: phaseOutcome }) =>
        ({ nodeid, when, outcome: phaseOutcome })),
      pytest_version: payload.pytest_version,
      python: payload.python,
      runtime_inputs_digest: expectation.runtime_inputs_digest,
      import_policy: payload.import_policy,
      consumer_compilation: "none",
      application_dependency_population: { count: payload.dependency_population.count,
        members: [...payload.dependency_population.members] },
      attempt_nonce: expectation.attempt_nonce,
      payload_sha256: authenticated.payload_sha256,
      structured_event_digest: structuredArtifact.digest
    };
    const idFor = (nodeId) => {
      const separator = nodeId.indexOf("::");
      return nativeRuntimeTestId({ provider_id: expectation.provider_id,
        provider_version: expectation.provider_version,
        path: separator < 0 ? expectation.target : nodeId.slice(0, separator), node_id: nodeId });
    };
    return {
      valid: true,
      status: exitCode === 0 ? "passed" : "failed",
      selected_status: outcome,
      structured_result: result,
      test_inventory: {
        observed_test_ids: [...new Set(payload.collection.collected_node_ids.map(idFor))].sort(),
        executed_test_ids: outcome === "skipped" ? [] : [expectation.target_test_id],
        skipped_test_ids: outcome === "skipped" ? [expectation.target_test_id] : []
      },
      artifacts: [structuredArtifact, launcherArtifact("native_phase_observation", inventory)]
    };
  }
  if (expectation.capability === "falsifier_execution") {
    const fault = payload.fault;
    if (fault === null || typeof fault !== "object" || fault.module_path !== expectation.module_path ||
        fault.function_name !== expectation.function_name ||
        JSON.stringify(fault.replacement) !== JSON.stringify(expectation.replacement)) {
      return refusal("test_proof_structured_events_binding_mismatch");
    }
    if (!sourceDigestCurrent(expectation, fault.module_path, fault.source_digest)) {
      return refusal("test_proof_structured_events_source_mismatch");
    }
    const byPhase = authenticated.byPhase;
    const callAssertionFailure = byPhase.call?.outcome === "failed" &&
      byPhase.call.assertion_failure === true;
    const observed = fault.status === "applied" && fault.mutated_code !== null &&
      Number.isSafeInteger(fault.mutated_returns_in_call) && fault.mutated_returns_in_call > 0 &&
      byPhase.setup.outcome === "passed" && callAssertionFailure;
    const mutation = {
      mechanism: "python_scalar_return_substitution",
      strategy: "result_inversion",
      mutation_id: expectation.mutation_id,
      target_module_path: fault.module_path,
      function_name: fault.function_name,
      replacement: fault.replacement,
      replacement_type: fault.replacement_type,
      original: fault.original,
      original_type: fault.original_type,
      source_digest: fault.source_digest,
      fault_status: fault.status,
      mutated_code: fault.mutated_code,
      mutated_entries_in_call: fault.mutated_entries_in_call,
      mutated_returns_in_call: fault.mutated_returns_in_call,
      target_test_id: expectation.target_test_id,
      target_node_id: expectation.node_id,
      selected_phases: Object.fromEntries(PHASE_ORDER.map((when) =>
        [when, byPhase[when]?.outcome ?? null])),
      call_assertion_failure: callAssertionFailure,
      failure_reason_code: observed ? expectation.failure_reason_code : null,
      observed,
      attempt_nonce: expectation.attempt_nonce,
      structured_event_digest: structuredArtifact.digest
    };
    return {
      valid: true,
      status,
      mutation_observed: observed,
      failure_reason_code: observed ? expectation.failure_reason_code : null,
      mutation,
      structured_result: result,
      artifacts: [structuredArtifact, launcherArtifact("falsifier_result", mutation)]
    };
  }
  if (expectation.capability === "boundary_traversal") {
    const trace = payload.trace;
    if (trace === null || typeof trace !== "object" || trace.module_path !== expectation.module_path ||
        !Array.isArray(trace.calls)) return refusal("test_proof_structured_events_binding_mismatch");
    if (!sourceDigestCurrent(expectation, trace.module_path, trace.source_digest)) {
      return refusal("test_proof_structured_events_source_mismatch");
    }
    const calls = trace.calls.map((call) => ({ phase: call.phase,
      test_id: call.test_node_id === expectation.node_id ? expectation.target_test_id : null,
      code: call.code, source_digest: call.source_digest, entries: call.entries, returns: call.returns }));
    const targetPassObserved = outcome === "passed";
    const observed = calls.some((call) => call.phase === "call" && call.code?.kind === "function" &&
      call.test_id === expectation.target_test_id && call.code?.filename === trace.module_path &&
      call.source_digest === trace.source_digest && Number.isSafeInteger(call.entries) && call.entries > 0);
    const boundary = {
      mechanism: "python_call_trace",
      boundary_kind: "module",
      module_path: trace.module_path,
      source_digest: trace.source_digest,
      observable_seam: expectation.observation_seam,
      target_test_id: expectation.target_test_id,
      target_node_id: expectation.node_id,
      target_pass_observed: targetPassObserved,
      observed,
      calls,
      attempt_nonce: expectation.attempt_nonce,
      structured_event_digest: structuredArtifact.digest
    };
    return {
      valid: true,
      status,
      traversal_observed: observed && targetPassObserved,
      boundary_observation: boundary,
      structured_result: result,
      artifacts: [structuredArtifact, launcherArtifact("boundary_trace", boundary)]
    };
  }
  return refusal("test_proof_observation_capability_invalid");
}
