import { createHash } from "node:crypto";
import { Session } from "node:inspector";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION =
  "workspace-agent-test-proof-module-fault.v1";

const MODULE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_@./-]+\.(?:cjs|js|mjs)$/u;
const EXPORT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const BASE_FIELDS = ["schema_version", "strategy", "mechanism", "mutation_id", "module_path",
  "failure_reason_code", "attempt_nonce"];
const FORCED_FIELDS = ["entry_export", "operation", "invocation"];
const WITNESS_IDENTITY = /^[a-f0-9]{64}$/u;

export const TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE = Object.freeze({
  code: "test_proof_forced_invocation_export_identity_mismatch",
  reasons: Object.freeze({
    missing: Object.freeze({ witness: "launcherIdentityAbsentExport",
      template: "Function `{export}` does not exist in `{module}`." }),
    not_function: Object.freeze({ witness: "launcherIdentityNoncallableExport",
      template: "Export `{export}` in `{module}` is not a function." }),
    wrong_name: Object.freeze({ witness: "launcherIdentityMisnamedExport",
      template: "Function exported as `{export}` in `{module}` does not have the required name `{export}`." }),
    unreadable: Object.freeze({ witness: "launcherIdentityUnreadableExport",
      template: "Cannot read function `{export}` in `{module}`." })
  })
});

export function formatTestProofForcedInvocationIdentityMessage(template, identity) {
  return template.replace(/\{(export|module)\}/gu, (_placeholder, field) =>
    field === "export" ? identity.export_name : identity.module_path);
}

export function projectTestProofForcedInvocationIdentityFailure(detail) {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail) ||
      Object.keys(detail).sort().join(",") !== "export_name,module_path,reason" ||
      typeof detail.reason !== "string" ||
      !Object.hasOwn(TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.reasons, detail.reason) ||
      typeof detail.module_path !== "string" || !MODULE_PATH.test(detail.module_path) ||
      typeof detail.export_name !== "string" || !EXPORT_NAME.test(detail.export_name)) {
    return null;
  }
  const identity = { module_path: detail.module_path, export_name: detail.export_name };
  return Object.freeze({ reason: detail.reason, ...identity,
    message: formatTestProofForcedInvocationIdentityMessage(
      TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.reasons[detail.reason].template, identity) });
}

export function validateTestProofModuleFaultConfiguration(configuration) {
  const forced = configuration?.strategy === "forced_invocation";
  const fields = forced ? [...BASE_FIELDS, ...FORCED_FIELDS] : BASE_FIELDS;
  if (configuration?.schema_version !== TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION ||
      !["dependency_failure", "forced_invocation"].includes(configuration.strategy) ||
      configuration.mechanism !== "module_substitution" ||
      !/^mutation-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(configuration.mutation_id) ||
      !MODULE_PATH.test(configuration.module_path) ||
      configuration.failure_reason_code !== `test_proof_fault.${configuration.strategy}.v1` ||
      typeof configuration.attempt_nonce !== "string" ||
      !WITNESS_IDENTITY.test(configuration.attempt_nonce) ||
      Object.keys(configuration).some(key => !fields.includes(key))) {
    throw new Error("launcher module-fault configuration is unsupported");
  }
  if (forced && (!EXPORT_NAME.test(configuration.entry_export ?? "") ||
      configuration.invocation !== "first_original_return_no_arguments" ||
      !configuration.operation || Object.keys(configuration.operation).sort().join(",") !== "export_name,module_path" ||
      !MODULE_PATH.test(configuration.operation.module_path ?? "") ||
      !EXPORT_NAME.test(configuration.operation.export_name ?? "") ||
      configuration.module_path === configuration.operation.module_path)) {
    throw new Error("launcher forced-invocation selection is unsupported");
  }
  return configuration;
}

export function buildTestProofFaultModuleUrl(configuration, worktree = process.cwd()) {
  const value = validateTestProofModuleFaultConfiguration(configuration);
  const url = pathToFileURL(path.resolve(worktree, value.module_path));
  url.searchParams.set("launcher_module_fault", testProofFaultMutationAttestationCode(value));
  return url.href;
}

export function buildTestProofFaultExportProbeUrl(configuration, worktree = process.cwd()) {
  const value = validateTestProofModuleFaultConfiguration(configuration);
  const url = pathToFileURL(path.resolve(worktree, value.module_path));
  url.searchParams.set("launcher_fault_export_probe", "1");
  return url.href;
}

export function classifyTestProofModuleFaultExports(namespace) {
  if (namespace === null || !["object", "function"].includes(typeof namespace)) {
    throw new Error("launcher module-fault export shape is unsupported");
  }
  return Object.keys(namespace).map((name) => ({
    name,
    callable: typeof namespace[name] === "function"
  }));
}

export function validateTestProofModuleFaultExportPopulation(exportPopulation, configuration = null) {
  if (!Array.isArray(exportPopulation) || exportPopulation.length > 512 ||
      exportPopulation.some((entry) => entry === null || typeof entry !== "object" ||
        Array.isArray(entry) || Object.keys(entry).sort().join(",") !== "callable,name" ||
        typeof entry.name !== "string" || entry.name.length === 0 ||
        entry.name.length > 256 || /[\u0000-\u001f\u007f]/u.test(entry.name) ||
        typeof entry.callable !== "boolean") ||
      new Set(exportPopulation.map(({ name }) => name)).size !== exportPopulation.length) {
    throw new Error("launcher module-fault export shape is unsupported");
  }
  const population = exportPopulation.map(({ name, callable }) => ({ name, callable }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (configuration !== null) {
    const value = validateTestProofModuleFaultConfiguration(configuration);
    if (value.strategy === "forced_invocation" && !population.some(({ name }) =>
      name === value.entry_export)) throw new Error("forced-invocation runner export is absent");
  }
  return population;
}

export function buildTestProofFaultModuleRegistrationSource(configuration, loaderUrl,
  worktree = process.cwd()) {
  const value = validateTestProofModuleFaultConfiguration(configuration);
  if (typeof loaderUrl !== "string") {
    throw new Error("launcher module-fault loader URL is unsupported");
  }
  const resolvedLoaderUrl = new URL(loaderUrl).href;
  const probeUrl = buildTestProofFaultExportProbeUrl(value, worktree);
  return [
    'import { register } from "node:module";',
    `const namespace = await import(${JSON.stringify(probeUrl)});`,
    `const classify = ${classifyTestProofModuleFaultExports.toString()};`,
    `register(${JSON.stringify(resolvedLoaderUrl)}, import.meta.url, ` +
      "{ data: { observed_exports: classify(namespace) } });"
  ].join("\n");
}

export function buildTestProofFaultModuleSource(configuration, exportPopulation) {
  const value = validateTestProofModuleFaultConfiguration(configuration);
  const population = validateTestProofModuleFaultExportPopulation(exportPopulation, value);
  if (value.strategy === "forced_invocation") {
    return forcedInvocationSource(value, population.map(({ name }) => name));
  }
  return dependencyFailureSource(value, population);
}

const MODULE_FAULT_WITNESSES = Object.freeze({
  dependency_failure: Object.freeze(["launcherObservedDependencyInvocation"]),
  forced_invocation: Object.freeze(["launcherObservedOriginalEntry",
    "launcherObservedOrderedOperationEntry", "launcherObservedInvalidOrder",
    "launcherObservedInspectionFailure",
    ...Object.values(TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.reasons)
      .map(({ witness }) => witness)])
});
export const TEST_PROOF_MODULE_FAULT_WITNESS_NAMES = MODULE_FAULT_WITNESSES;
const ALL_WITNESS_NAMES = Object.freeze([...new Set(Object.values(MODULE_FAULT_WITNESSES).flat())]);

const MODULE_FAULT_RECIPES = Object.freeze({
  dependency_failure: () => launcherDependencyFailureFactory,
  forced_invocation: () => launcherForcedInvocationFactory
});

export function testProofFaultMutationAttestationCode(configuration) {
  const value = validateTestProofModuleFaultConfiguration(configuration);
  const identity = JSON.stringify({
    ...(value.strategy === "forced_invocation" ? {
      entry_export: value.entry_export, operation: value.operation,
      invocation: value.invocation,
      identity_failure: TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE,
      identity_formatter_source: formatTestProofForcedInvocationIdentityMessage.toString()
    } : {}),
    attempt_nonce: value.attempt_nonce,
    recipe_source: MODULE_FAULT_RECIPES[value.strategy]().toString(),
    failure_reason_code: value.failure_reason_code,
    mechanism: value.mechanism,
    module_path: value.module_path,
    mutation_id: value.mutation_id,
    strategy: value.strategy
  });
  return `test_proof_fault_mutation.${createHash("sha256").update(identity).digest("hex")}`;
}

export function testProofRuntimeModuleIdentity(moduleUrl) {
  return `sha256:${createHash("sha256").update(moduleUrl, "utf8").digest("hex")}`;
}

function attemptFacts(value, attestationCode) {
  const witnessIdentity = attestationCode.split(".").at(-1);
  return Object.freeze({
    configuration: Object.freeze(structuredClone(value)),
    strategy: value.strategy,
    failure_reason_code: value.failure_reason_code,
    mutation_attestation_code: attestationCode,
    witness_identity: witnessIdentity,
    witness_module_path: value.module_path,
    witness_names: Object.freeze(Object.fromEntries(MODULE_FAULT_WITNESSES[value.strategy]
      .map(name => [name, `${name}_${witnessIdentity}`])))
  });
}

export function describeTestProofModuleFaultAttempt(configuration, worktree) {
  const value = validateTestProofModuleFaultConfiguration(structuredClone(configuration));
  if (typeof worktree !== "string" || worktree.length === 0) {
    throw new Error("launcher module-fault attempt requires the resolved worktree");
  }
  const facts = attemptFacts(value, testProofFaultMutationAttestationCode(value));
  return Object.freeze({ ...facts,
    fault_module_identity: `runtime-module-${testProofRuntimeModuleIdentity(
      buildTestProofFaultModuleUrl(value, worktree)).slice("sha256:".length)}` });
}

export function verifyTestProofModuleFaultExpectation(expectation) {
  const configuration = expectation?.configuration;
  if (configuration === null || typeof configuration !== "object" || Array.isArray(configuration)) {
    throw new Error("launcher module-fault expectation requires its closed configuration");
  }
  const value = validateTestProofModuleFaultConfiguration(structuredClone(configuration));
  const attestationCode = testProofFaultMutationAttestationCode(value);
  if (expectation.mutation_attestation_code !== attestationCode ||
      expectation.strategy !== value.strategy ||
      typeof expectation.fault_module_identity !== "string" ||
      !/^runtime-module-[a-f0-9]{64}$/u.test(expectation.fault_module_identity)) {
    throw new Error("launcher module-fault expectation identity does not match its configuration");
  }
  return attemptFacts(value, attestationCode);
}

export function parseTestProofModuleFaultWitnessName(name) {
  if (typeof name !== "string") return null;
  const separator = name.lastIndexOf("_");
  if (separator < 0) return null;
  const base = name.slice(0, separator);
  const identity = name.slice(separator + 1);
  return ALL_WITNESS_NAMES.includes(base) && WITNESS_IDENTITY.test(identity)
    ? Object.freeze({ base, identity }) : null;
}

function suffixRecipeWitnesses(recipe, strategy, identity) {
  let source = recipe;
  for (const name of MODULE_FAULT_WITNESSES[strategy]) {
    if (!source.includes(`function ${name}(`)) {
      throw new Error("launcher module-fault witness is not declared by the recipe");
    }
    source = source.replaceAll(name, `${name}_${identity}`);
  }
  return source;
}

function launcherDependencyFailureFactory(configuration) {
  function launcherObservedDependencyInvocation() { return true; }
  return function launcherAppliedDependencyFailure() {
    launcherObservedDependencyInvocation();
    const error = new Error("launcher-applied dependency failure");
    error.code = configuration.failure_reason_code;
    error.mutation_id = configuration.mutation_id;
    throw error;
  };
}

function dependencyFailureSource(configuration, population) {
  const identity = testProofFaultMutationAttestationCode(configuration).split(".").at(-1);
  const probeUrl = buildTestProofFaultExportProbeUrl(configuration);
  return [
    `const configuration = ${JSON.stringify(configuration)};`,
    suffixRecipeWitnesses(launcherDependencyFailureFactory.toString(),
      "dependency_failure", identity),
    "const launcherAppliedDependencyFailure = launcherDependencyFailureFactory(configuration);",
    ...population.map(({ name, callable }) => callable
      ? name === "default"
        ? "export default launcherAppliedDependencyFailure;"
        : `export { launcherAppliedDependencyFailure as ${JSON.stringify(name)} };`
      : name === "default"
        ? `export { default } from ${JSON.stringify(probeUrl)};`
        : `export { ${JSON.stringify(name)} } from ${JSON.stringify(probeUrl)};`)
  ].join("\n");
}

function launcherForcedInvocationFactory(originals, operations, configuration, identityFailure,
  formatIdentityMessage) {
  function launcherObservedOriginalEntry() { return true; }
  function launcherObservedOrderedOperationEntry() { return true; }
  function launcherObservedInvalidOrder() { return true; }
  function launcherObservedInspectionFailure() { return true; }
  function launcherIdentityAbsentExport() { return true; }
  function launcherIdentityNoncallableExport() { return true; }
  function launcherIdentityMisnamedExport() { return true; }
  function launcherIdentityUnreadableExport() { return true; }
  const identityWitnesses = new Map([launcherIdentityAbsentExport,
    launcherIdentityNoncallableExport, launcherIdentityMisnamedExport,
    launcherIdentityUnreadableExport].map(witness => [witness.name, witness]));
  function launcherObservedOperationThrow(error) {
    process.stderr.write(`${JSON.stringify({ kind: "forced_invocation_operation_error",
      name: error?.name ?? null, message: error?.message ?? String(error) })}\n`);
  }

  function launcherResolveExport(namespace, exportName, modulePath) {
    let reason = null;
    let value;
    let cause;
    if (!(exportName in namespace)) reason = "missing";
    else {
      try { value = namespace[exportName]; }
      catch (error) { reason = "unreadable"; cause = error; }
    }
    if (reason === null && typeof value !== "function") reason = "not_function";
    else if (reason === null && value.name !== exportName) reason = "wrong_name";
    if (reason === null) return value;
    const error = new Error(formatIdentityMessage(identityFailure.reasons[reason].template,
      { module_path: modulePath, export_name: exportName }),
    reason === "unreadable" ? { cause } : undefined);
    error.code = identityFailure.code;
    error.reason = reason;
    throw error;
  }
  const original = launcherResolveExport(originals, configuration.entry_export,
    configuration.module_path);
  let resolution = "unresolved";
  let operation;
  let resolutionError;
  let claimed = false;
  async function launcherInvokeSelectedOperation() {
    try { await operation(); }
    catch (error) { launcherObservedOperationThrow(error); }
  }
  return async function launcherForcedInvocation(...args) {

    if (resolution === "unresolved") {
      resolution = "failed";
      try {
        operation = launcherResolveExport(operations, configuration.operation.export_name,
          configuration.operation.module_path);
        resolution = "resolved";
      } catch (error) {
        resolutionError = error;
        identityWitnesses.get(identityFailure.reasons[error.reason].witness)();
      }
    }
    if (resolution === "failed") throw resolutionError;
    if (claimed) return original(...args);
    claimed = true;
    const session = new Session();
    session.connect();
    const post = (method, params = {}) => new Promise((resolve, reject) => {
      session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
    });
    let stage = 0;
    let entryBreakpoint;
    let operationBreakpoint;
    const bridge = `launcher-proof-${configuration.attempt_nonce}`;
    const paused = ({ params }) => {
      if (params.hitBreakpoints.includes(entryBreakpoint)) {
        if (stage === 0) { stage = 1; launcherObservedOriginalEntry(); }
        else launcherObservedInvalidOrder();
      }
      if (params.hitBreakpoints.includes(operationBreakpoint)) {
        if (stage === 2 && params.callFrames.some(frame =>
          frame.functionName === "launcherInvokeSelectedOperation")) {
          stage = 3;
          launcherObservedOrderedOperationEntry();
        } else launcherObservedInvalidOrder();
      }
      session.post("Debugger.resume", {}, error => {
        if (error) launcherObservedInspectionFailure();
      });
    };
    try {
      await post("Debugger.enable");

      Object.defineProperty(globalThis, bridge, { configurable: true, value: { original, operation } });
      for (const name of ["original", "operation"]) {
        const { result } = await post("Runtime.evaluate", {
          expression: `globalThis[${JSON.stringify(bridge)}].${name}`
        });
        const { breakpointId } = await post("Debugger.setBreakpointOnFunctionCall", { objectId: result.objectId });
        if (name === "original") entryBreakpoint = breakpointId;
        else operationBreakpoint = breakpointId;
      }
      delete globalThis[bridge];
      session.on("Debugger.paused", paused);
      const result = await original(...args);
      if (stage !== 1) {
        launcherObservedInspectionFailure();
        throw new Error("forced invocation did not observe original entry");
      }
      stage = 2;
      await launcherInvokeSelectedOperation();
      if (stage !== 3) {
        launcherObservedInspectionFailure();
        throw new Error("forced invocation did not observe the selected operation entry");
      }
      return result;
    } finally {
      delete globalThis[bridge];
      session.disconnect();
    }
  };
}

function forcedInvocationSource(configuration, names) {
  const identity = testProofFaultMutationAttestationCode(configuration).split(".").at(-1);
  const probeUrl = buildTestProofFaultExportProbeUrl(configuration);
  const operationUrl = pathToFileURL(path.resolve(process.cwd(),
    configuration.operation.module_path)).href;
  const { code, reasons } = TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE;
  const identityFailure = { code, reasons: Object.fromEntries(Object.entries(reasons).map(
    ([reason, descriptor]) => [reason, { ...descriptor, witness: `${descriptor.witness}_${identity}` }])) };
  const recipe = suffixRecipeWitnesses(launcherForcedInvocationFactory.toString(),
    "forced_invocation", identity);
  return [
    'import { Session } from "node:inspector";',
    `import * as originals from ${JSON.stringify(probeUrl)};`,
    `import * as operations from ${JSON.stringify(operationUrl)};`,
    `const configuration = ${JSON.stringify(configuration)};`,
    `const identityFailure = ${JSON.stringify(identityFailure)};`,
    formatTestProofForcedInvocationIdentityMessage.toString(),
    recipe,
    "const invoke = launcherForcedInvocationFactory(originals, operations, configuration, " +
      "identityFailure, formatTestProofForcedInvocationIdentityMessage);",
    ...names.map((name) => name === configuration.entry_export
      ? `export { invoke as ${JSON.stringify(name)} };`
      : name === "default"
        ? `export { default } from ${JSON.stringify(probeUrl)};`
        : `export { ${JSON.stringify(name)} } from ${JSON.stringify(probeUrl)};`)
  ].join("\n");
}
