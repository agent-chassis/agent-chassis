import { createHash } from "node:crypto";

import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_ID,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION,
  TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03,
  validateTestProofContract
} from "../../../lib/test-proof-contract.mjs";

const PROFILE_ID = "proof.verification.test-validity";
const PROFILE_VERSION = "1.0.0";
const INPUT_VERSION = "controlled-contract-test-validity-evaluation-input.v1";
const SEMANTIC_JUDGMENT = "not_performed_coordinator_owned";

const compare = (left, right) => String(left).localeCompare(String(right));
const sorted = (values) => [...values].sort(compare);
const unique = (values) => new Set(values).size === values.length;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compare).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonicalDigest(value) {
  return createHash("sha256").update(
    `${JSON.stringify(canonicalValue(value), null, 2)}\n`
  ).digest("hex");
}

function diagnostic(code, field, details = {}) {
  return { code, field, ...details };
}

function providerEvidenceDiagnostics(authored, evidence, expectedCapability, field,
  missingCode) {
  if (!authored) return [diagnostic(missingCode, field)];
  const authoredDescriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: providerId }) => providerId === authored.provider_id
  );
  if (!authoredDescriptor) return [diagnostic(
    "test_validity_provider_unknown", `${field}/provider_id`,
    { provider_id: authored.provider_id ?? null }
  )];
  if (authored.provider_version !== authoredDescriptor.provider_version) return [diagnostic(
    "test_validity_provider_version_mismatch", `${field}/provider_version`,
    { expected: authoredDescriptor.provider_version, actual: authored.provider_version ?? null }
  )];
  if (authored.capability !== expectedCapability ||
      !authoredDescriptor.capabilities.includes(expectedCapability)) return [diagnostic(
    "test_validity_provider_capability_mismatch", `${field}/capability`,
    { expected: expectedCapability, actual: authored.capability ?? null }
  )];
  if (!evidence) return [diagnostic(missingCode, field)];
  const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: providerId }) => providerId === evidence.provider_id
  );
  if (!descriptor) return [diagnostic(
    "test_validity_provider_unknown", `${field}/provider_id`,
    { provider_id: evidence.provider_id ?? null }
  )];
  if (evidence.provider_version !== descriptor.provider_version ||
      evidence.provider_version !== authored?.provider_version) return [diagnostic(
    "test_validity_provider_version_mismatch", `${field}/provider_version`,
    { expected: authored?.provider_version ?? descriptor.provider_version,
      actual: evidence.provider_version ?? null }
  )];
  const diagnostics = [];
  if (evidence.provider_id !== authored?.provider_id) diagnostics.push(diagnostic(
    "test_validity_provider_identity_mismatch", `${field}/provider_id`,
    { expected: authored?.provider_id ?? null, actual: evidence.provider_id }
  ));
  if (evidence.capability !== expectedCapability ||
      !descriptor.capabilities.includes(expectedCapability)) diagnostics.push(diagnostic(
    "test_validity_provider_capability_mismatch", `${field}/capability`,
    { expected: expectedCapability, actual: evidence.capability ?? null }
  ));
  if (evidence.capability_snapshot_digest !==
      TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST) diagnostics.push(diagnostic(
    "test_validity_provider_snapshot_digest_mismatch",
    `${field}/capability_snapshot_digest`,
    { expected: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
      actual: evidence.capability_snapshot_digest ?? null }
  ));
  return diagnostics;
}

function launcherObservationDiagnostics(observation, field, expectedMechanism) {
  if (!observation || typeof observation !== "object") return [diagnostic(
    "test_validity_launcher_observation_missing", field
  )];
  const diagnostics = [];
  if (observation.mechanism !== expectedMechanism) diagnostics.push(diagnostic(
    "test_validity_launcher_observation_mechanism_mismatch", `${field}/mechanism`,
    { expected: expectedMechanism, actual: observation.mechanism ?? null }
  ));
  if (observation.test_controlled_output_used === true) diagnostics.push(diagnostic(
    "test_validity_test_controlled_output_forbidden", `${field}/test_controlled_output_used`
  ));
  const digest = observation.artifact_digest;
  const expectedId = typeof digest === "string" && /^sha256:[a-f0-9]{64}$/.test(digest)
    ? `artifact-${digest.slice(7)}` : null;
  if (observation.artifact_owner !== "launcher" ||
      observation.artifact_id !== expectedId) diagnostics.push(diagnostic(
    "test_validity_launcher_artifact_forged", `${field}/artifact_id`
  ));
  return diagnostics;
}

function inventoryDiagnostics(binding, input) {
  const diagnostics = [];
  const declared = input.test_inventory?.declared_test_ids ?? [];
  const observed = input.test_inventory?.observed_tests ?? [];
  const observedIds = observed.map(({ test_id: testId }) => testId);
  const baseline = input.test_inventory?.baseline_executed_test_ids ?? [];
  if (!unique(declared)) diagnostics.push(diagnostic(
    "test_validity_declared_test_duplicate", "/test_inventory/declared_test_ids"
  ));
  if (!unique(observedIds)) diagnostics.push(diagnostic(
    "test_validity_observed_test_duplicate", "/test_inventory/observed_tests"
  ));
  for (const testId of declared) if (!observedIds.includes(testId)) diagnostics.push(diagnostic(
    "test_validity_declared_test_removed", "/test_inventory/observed_tests",
    { test_id: testId }
  ));
  for (const testId of observedIds) if (!declared.includes(testId)) diagnostics.push(diagnostic(
    "test_validity_undeclared_test_observed", "/test_inventory/observed_tests",
    { test_id: testId }
  ));
  for (const item of observed) if (item.status === "skipped" && baseline.includes(item.test_id)) {
    diagnostics.push(diagnostic(
      "test_validity_newly_skipped_test", "/test_inventory/observed_tests",
      { test_id: item.test_id }
    ));
  }
  for (const item of observed) if (item.status === "failed") diagnostics.push(diagnostic(
    "test_validity_observed_test_failed", "/test_inventory/observed_tests",
    { test_id: item.test_id }
  ));
  const coverage = binding.coverage_disposition;
  if (coverage.baseline_state === "complete_executed_inventory") {
    const dispositionIds = coverage.items.map(({ test_id: testId }) => testId);
    for (const testId of baseline) if (!dispositionIds.includes(testId)) diagnostics.push(diagnostic(
      "test_validity_coverage_undispositioned", "/test_inventory/baseline_executed_test_ids",
      { test_id: testId }
    ));
  } else if (baseline.length > 0) diagnostics.push(diagnostic(
    "test_validity_coverage_baseline_conflict", "/test_inventory/baseline_executed_test_ids"
  ));
  return diagnostics;
}

function falsifierDiagnostics(binding, input) {
  const diagnostics = [];
  const executions = input.falsifier_executions ?? [];
  if (executions.length !== binding.falsifiers.length) diagnostics.push(diagnostic(
    "test_validity_falsifier_provider_population_incomplete", "/falsifier_executions",
    { expected: binding.falsifiers.length, actual: executions.length }
  ));
  const executionIds = executions.map(({ falsifier_id: falsifierId }) => falsifierId);
  if (!unique(executionIds)) diagnostics.push(diagnostic(
    "test_validity_falsifier_execution_duplicate", "/falsifier_executions"
  ));
  for (const falsifier of binding.falsifiers) {
    const field = `/falsifier_executions/${falsifier.falsifier_id}`;
    const execution = executions.find(
      ({ falsifier_id: falsifierId }) => falsifierId === falsifier.falsifier_id
    );
    if (!execution) {
      diagnostics.push(diagnostic("test_validity_falsifier_missing", field));
      continue;
    }
    diagnostics.push(...providerEvidenceDiagnostics(
      falsifier.execution_provider, execution.provider, "falsifier_execution",
      `${field}/provider`, "test_validity_falsifier_provider_missing"
    ));
    if (execution.provider?.strategy !== falsifier.strategy) diagnostics.push(diagnostic(
      "test_validity_provider_strategy_mismatch", `${field}/provider/strategy`,
      { expected: falsifier.strategy, actual: execution.provider?.strategy ?? null }
    ));
    diagnostics.push(...launcherObservationDiagnostics(
      execution.observation, `${field}/observation`, "node_test_structured_events"
    ));
    if (execution.skipped) diagnostics.push(diagnostic(
      "test_validity_falsifier_skipped", `${field}/skipped`
    ));
    if (!execution.isolated) diagnostics.push(diagnostic(
      "test_validity_falsifier_not_isolated", `${field}/isolated`
    ));
    if (!execution.target_verification_failed) diagnostics.push(diagnostic(
      "test_validity_falsifier_inert", `${field}/target_verification_failed`
    ));
    if (execution.mutation?.applied !== true) diagnostics.push(diagnostic(
      "test_validity_falsifier_mutation_unobserved", `${field}/mutation/applied`
    ));
    if (execution.mutation?.mutation_id !== falsifier.mutation?.mutation_id ||
        execution.mutation?.strategy !== falsifier.strategy) diagnostics.push(diagnostic(
      "test_validity_falsifier_mutation_mismatch", `${field}/mutation`
    ));
    if (execution.mutation?.target_verification_id !== binding.verification_claim_id) {
      diagnostics.push(diagnostic(
        "test_validity_falsifier_wrong_verification",
        `${field}/mutation/target_verification_id`,
        { expected: binding.verification_claim_id,
          actual: execution.mutation?.target_verification_id ?? null }
      ));
    }
    if (execution.failure_reason_source !== "launcher_structured_event") diagnostics.push(diagnostic(
      "test_validity_falsifier_reason_unauthenticated", `${field}/failure_reason_source`
    ));
    const expectedFailureReasonCode = `test_proof_fault.${falsifier.strategy}.v1`;
    if (execution.failure_reason_code !== expectedFailureReasonCode) diagnostics.push(diagnostic(
      "test_validity_falsifier_reason_mismatch", `${field}/failure_reason_code`,
      { expected: expectedFailureReasonCode, actual: execution.failure_reason_code ?? null }
    ));
    if (execution.failure_proposition_id !== falsifier.proposition_id) {
      diagnostics.push(diagnostic(
        "test_validity_falsifier_wrong_target", `${field}/failure_proposition_id`,
        { expected: falsifier.proposition_id, actual: execution.failure_proposition_id ?? null }
      ));
    }
  }
  for (const falsifierId of executionIds) if (!binding.falsifiers.some(
    ({ falsifier_id: candidate }) => candidate === falsifierId
  )) diagnostics.push(diagnostic(
    "test_validity_falsifier_undeclared", `/falsifier_executions/${falsifierId}`
  ));
  return diagnostics;
}

function traversalDiagnostics(binding, input) {
  const traversal = input.boundary_traversal;
  const authored = binding.traversal_provider;
  if (authored?.mode === "registry_unsupported") {
    if (!traversal) return [diagnostic(
      "test_validity_traversal_evidence_missing", "/boundary_traversal"
    )];
    const registryValid = traversal.provider?.registry_id === TEST_PROOF_PROVIDER_REGISTRY_ID &&
      traversal.provider?.registry_version === TEST_PROOF_PROVIDER_REGISTRY_VERSION &&
      traversal.provider?.capability === "traversal_unsupported" &&
      traversal.provider?.capability_snapshot_digest ===
        TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST;
    return traversal.provider_support === "unsupported" && traversal.result === "review_only" &&
      traversal.authenticated === true && registryValid
      ? []
      : [diagnostic(
        "test_validity_unsupported_traversal_overclaimed", "/boundary_traversal/result"
      )];
  }
  if (!traversal || traversal.provider_support === "supported") {
    if (!traversal) return [diagnostic(
      "test_validity_traversal_evidence_missing", "/boundary_traversal"
    )];
    const diagnostics = [];
    diagnostics.push(...providerEvidenceDiagnostics(
      authored, traversal.provider, "boundary_traversal", "/boundary_traversal/provider",
      "test_validity_traversal_provider_missing"
    ));
    if (traversal.provider?.boundary_kind !== binding.system_under_test_boundary.kind) {
      diagnostics.push(diagnostic(
        "test_validity_provider_boundary_mismatch", "/boundary_traversal/provider/boundary_kind",
        { expected: binding.system_under_test_boundary.kind,
          actual: traversal.provider?.boundary_kind ?? null }
      ));
    }
    diagnostics.push(...launcherObservationDiagnostics(
      traversal.observation, "/boundary_traversal/observation", "node_test_v8_coverage"
    ));
    if (traversal.instrumented !== true) diagnostics.push(diagnostic(
      "test_validity_traversal_instrumentation_missing", "/boundary_traversal/instrumented"
    ));
    if (traversal.observation_seam !== authored?.observation_seam) diagnostics.push(diagnostic(
      "test_validity_traversal_observation_seam_mismatch",
      "/boundary_traversal/observation_seam",
      { expected: authored?.observation_seam ?? null,
        actual: traversal.observation_seam ?? null }
    ));
    if (traversal.result !== "proven") diagnostics.push(diagnostic(
      "test_validity_supported_traversal_not_proven", "/boundary_traversal/result"
    ));
    if (!traversal.authenticated) diagnostics.push(diagnostic(
      "test_validity_traversal_unauthenticated", "/boundary_traversal/authenticated"
    ));
    if (traversal.boundary_id !== binding.system_under_test_boundary.boundary_id) {
      diagnostics.push(diagnostic(
        "test_validity_traversal_wrong_boundary", "/boundary_traversal/boundary_id"
      ));
    }
    if (traversal.observable_id !== binding.observable_result.observable_id) {
      diagnostics.push(diagnostic(
        "test_validity_traversal_wrong_observable", "/boundary_traversal/observable_id"
      ));
    }
    return diagnostics;
  }
  return [diagnostic(
    "test_validity_unsupported_traversal_overclaimed", "/boundary_traversal/result"
  )];
}

function evaluateTestValidity({ contract, evaluation_input: input }) {
  const diagnostics = [];
  const contractResult = validateTestProofContract(contract);
  if (contract?.schema_version !== TEST_PROOF_CONTRACT_SCHEMA_VERSION_V03 ||
      !contractResult.valid) {
    diagnostics.push(diagnostic(
      "test_validity_contract_invalid", "/controlled_contract",
      { contract_diagnostics: contractResult.diagnostics }
    ));
    if ((contractResult.schema_errors ?? []).some(({ keyword, params }) =>
      keyword === "additionalProperties" && [
        "args", "argv", "callback", "command", "env", "execute", "executeCandidate",
        "executeFalsifier", "executable", "module", "module_path", "path", "shell"
      ].includes(params?.additionalProperty))) diagnostics.push(diagnostic(
      "test_validity_caller_executor_forbidden", "/controlled_contract/test_proofs"
    ));
  }
  if (input?.input_version !== INPUT_VERSION) diagnostics.push(diagnostic(
    "test_validity_input_version_invalid", "/input_version"
  ));
  const verificationId = input?.verification_id;
  const candidates = contract?.test_proofs?.filter(
    ({ verification_claim_id: claimId }) => claimId === verificationId
  ) ?? [];
  if (candidates.length !== 1) diagnostics.push(diagnostic(
    candidates.length === 0 ? "test_validity_binding_missing" : "test_validity_binding_ambiguous",
    "/verification_id", { verification_id: verificationId ?? null }
  ));
  const binding = candidates[0];
  if (binding) {
    if (input.test_proof_id !== binding.test_proof_id) diagnostics.push(diagnostic(
      "test_validity_test_proof_identity_mismatch", "/test_proof_id"
    ));
    if (!input.candidate_execution?.passed) diagnostics.push(diagnostic(
      "test_validity_candidate_failed", "/candidate_execution/passed"
    ));
    diagnostics.push(...providerEvidenceDiagnostics(
      binding.candidate_execution_provider, input.candidate_execution?.provider,
      "candidate_execution", "/candidate_execution/provider",
      "test_validity_candidate_provider_missing"
    ));
    diagnostics.push(...launcherObservationDiagnostics(
      input.candidate_execution?.observation, "/candidate_execution/observation",
      "node_test_structured_events"
    ));
    if (input.candidate_execution?.observed_boundary_id !==
        binding.system_under_test_boundary.boundary_id) diagnostics.push(diagnostic(
      "test_validity_sut_boundary_mismatch", "/candidate_execution/observed_boundary_id"
    ));
    if (input.candidate_execution?.observed_observable_id !==
        binding.observable_result.observable_id) diagnostics.push(diagnostic(
      "test_validity_observable_mismatch", "/candidate_execution/observed_observable_id"
    ));
    if (input.candidate_execution?.source_text_inspection_used === true) diagnostics.push(diagnostic(
      "test_validity_prohibited_source_text_inspection",
      "/candidate_execution/source_text_inspection_used"
    ));
    diagnostics.push(...falsifierDiagnostics(binding, input));
    diagnostics.push(...inventoryDiagnostics(binding, input));
    diagnostics.push(...traversalDiagnostics(binding, input));
  }
  diagnostics.sort((left, right) => compare(
    `${left.field}\u0000${left.code}`, `${right.field}\u0000${right.code}`
  ));
  return {
    result_version: "controlled-contract-test-validity-result.v1",
    profile_id: PROFILE_ID,
    profile_version: PROFILE_VERSION,
    verification_id: verificationId ?? null,
    satisfaction: diagnostics.length === 0 ? "satisfied" : "unsatisfied",
    diagnostics,
    semantic_judgment: SEMANTIC_JUDGMENT,
    input_digest: canonicalDigest({ contract, evaluation_input: input })
  };
}

export {
  INPUT_VERSION,
  PROFILE_ID,
  PROFILE_VERSION,
  SEMANTIC_JUDGMENT,
  canonicalDigest,
  evaluateTestValidity
};
