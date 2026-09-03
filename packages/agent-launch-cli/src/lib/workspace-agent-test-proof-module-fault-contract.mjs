import { createHash } from "node:crypto";

export const TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION =
  "workspace-agent-test-proof-module-fault.v1";

export function validateTestProofModuleFaultConfiguration(configuration) {
  if (configuration?.schema_version !== TEST_PROOF_MODULE_FAULT_SCHEMA_VERSION ||
      configuration.strategy !== "dependency_failure" ||
      configuration.mechanism !== "module_substitution" ||
      typeof configuration.mutation_id !== "string" ||
      typeof configuration.module_path !== "string" ||
      typeof configuration.failure_reason_code !== "string") {
    throw new Error("launcher module-fault configuration is unsupported");
  }
  return configuration;
}

export function buildTestProofFaultModuleUrl(configuration) {
  const value = validateTestProofModuleFaultConfiguration(configuration);
  return `data:text/javascript;base64,${Buffer.from(
    buildTestProofFaultModuleSource(value, [])
  ).toString("base64")}`;
}

function validateExportNames(exportNames) {
  if (!Array.isArray(exportNames) || exportNames.length > 512 ||
      exportNames.some((name) => typeof name !== "string" || name.length === 0 ||
        name.length > 256 || /[\u0000-\u001f\u007f]/u.test(name)) ||
      new Set(exportNames).size !== exportNames.length) {
    throw new Error("launcher module-fault export shape is unsupported");
  }
  return [...exportNames].sort();
}

export function buildTestProofFaultModuleSource(configuration, exportNames) {
  const value = validateTestProofModuleFaultConfiguration(configuration);
  const names = validateExportNames(exportNames);
  const attestationCode = testProofFaultMutationAttestationCode(value);
  return [
    "function launcherAppliedDependencyFailure() {",
    `const error = new Error(${JSON.stringify("launcher-applied dependency failure")});`,
    `error.code = ${JSON.stringify(value.failure_reason_code)};`,
    `error.mutation_id = ${JSON.stringify(value.mutation_id)};`,
    `error.cause = Object.assign(new Error(${JSON.stringify(
      "launcher-applied mutation attestation"
    )}), { code: ${JSON.stringify(attestationCode)} });`,
    "throw error;",
    "}",
    ...names.map((name) => name === "default"
      ? "export default launcherAppliedDependencyFailure;"
      : `export { launcherAppliedDependencyFailure as ${JSON.stringify(name)} };`)
  ].join("\n");
}

export function testProofFaultMutationAttestationCode(configuration) {
  const value = validateTestProofModuleFaultConfiguration(configuration);
  const identity = JSON.stringify({
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
