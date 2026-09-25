import { createHash } from "node:crypto";
import { compiledValidators } from "./compiled-validator-cache.mjs";

import TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2 from
  "../schema/controlled-contract-test-proof-runtime-evidence.v2.schema.json" with { type: "json" };
import {
  resolveTestProofProviderCompatibility,
  testProofSchemaVocabularyMismatches,
  testProofWitnessValidator
} from "./test-proof-provider-registry.mjs";
import { canonicalizeStableValue, compareCodeUnits } from
  "./equality-normalization-v1.mjs";
import { projectBoundedDiagnostics } from "./bounded-diagnostic-projection.mjs";

const TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2 =
  "controlled-contract-test-proof-runtime-evidence.v2";
const STALE_PROVIDER_VOCABULARY = testProofSchemaVocabularyMismatches("evidence",
  TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2);
if (STALE_PROVIDER_VOCABULARY.length > 0) {
  throw new Error("runtime evidence schema disagrees with the provider catalog at " +
    STALE_PROVIDER_VOCABULARY.join(", "));
}
const { validateSchema } = await compiledValidators(
  "controlled-contract.test-proof-runtime-evidence.v2",
  { validators: { validateSchema: TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2 } }
);

const canonical = (value) => JSON.stringify(canonicalizeStableValue(value));
const canonicalArray = (values) => values.every((value, index) => index === 0 ||
  compareCodeUnits(values[index - 1], value) < 0);

function failureDiagnosticReferences(diagnostic) {
  const errorIds = diagnostic.errors.map(({ id }) => id);
  const valueIds = diagnostic.values.map(({ id }) => id);
  const errorSet = new Set(errorIds);
  const valueSet = new Set(valueIds);
  const dangling = [];
  const duplicateEntries = [];
  const invalidShapes = [];
  const requireError = (id, path) => {
    if (!errorSet.has(id)) dangling.push({ id, path, kind: "error" });
  };
  const requireValue = (id, path) => {
    if (!valueSet.has(id)) dangling.push({ id, path, kind: "value" });
  };
  if (diagnostic.root_error !== null) requireError(diagnostic.root_error, "/root_error");
  diagnostic.errors.forEach((entry, index) => {
    for (const field of ["expected", "actual", "value"]) {
      if (entry[field] !== undefined) requireValue(entry[field], `/errors/${index}/${field}`);
    }
    if (entry.cause !== undefined) requireError(entry.cause, `/errors/${index}/cause`);
    (entry.aggregate_errors ?? []).forEach((id, offset) =>
      requireError(id, `/errors/${index}/aggregate_errors/${offset}`));
  });
  diagnostic.values.forEach((entry, index) => {
    const propertyKeys = (entry.properties ?? []).map(({ key }) => key);
    if (new Set(propertyKeys).size !== propertyKeys.length) {
      duplicateEntries.push(`/values/${index}/properties`);
    }
    (entry.properties ?? []).forEach(({ value }, offset) =>
      requireValue(value, `/values/${index}/properties/${offset}/value`));
    const elementIndices = (entry.elements ?? []).map(({ index: offset }) => offset);
    if (new Set(elementIndices).size !== elementIndices.length) {
      duplicateEntries.push(`/values/${index}/elements`);
    }
    (entry.elements ?? []).forEach(({ index: offset, value }, position) => {
      requireValue(value, `/values/${index}/elements/${position}/value`);
      if (offset >= entry.length) invalidShapes.push(`/values/${index}/elements/${position}/index`);
    });
    if (entry.type === "map") {
      entry.entries.forEach(({ key, value }, offset) => {
        requireValue(key, `/values/${index}/entries/${offset}/key`);
        requireValue(value, `/values/${index}/entries/${offset}/value`);
      });
      if (entry.entries.length !== entry.size) invalidShapes.push(`/values/${index}/size`);
    }
    if (entry.type === "set") {
      entry.entries.forEach((id, offset) =>
        requireValue(id, `/values/${index}/entries/${offset}`));
      if (entry.entries.length !== entry.size) invalidShapes.push(`/values/${index}/size`);
    }
    if (["array_buffer", "typed_array", "buffer"].includes(entry.type)) {
      const byteLength = Buffer.from(entry.bytes, "base64").byteLength;
      if (byteLength !== entry.byte_length) invalidShapes.push(`/values/${index}/byte_length`);
    }
  });
  return {
    duplicate_error_ids: errorIds.filter((id, index) => errorIds.indexOf(id) !== index),
    duplicate_value_ids: valueIds.filter((id, index) => valueIds.indexOf(id) !== index),
    dangling,
    duplicateEntries,
    invalidShapes
  };
}

function validateTestProofRuntimeEvidenceV2(evidence) {
  if (!validateSchema(evidence)) return Object.freeze({
    schema_valid: false,
    schema_errors: Object.freeze(structuredClone(validateSchema.errors ?? [])),
    diagnostics: projectBoundedDiagnostics([]),
    valid: false,
    semantic_judgment: "not_performed_coordinator_owned"
  });
  const diagnostics = [];
  const { evidence_identity: identity, contract_binding: binding } = evidence;
  const emit = (code, pointer, details = {}) => diagnostics.push({
    code, pointer, keyword: "stableRuntimeEvidence", message: code, ...details
  });
  if (identity.verification_id !== binding.verification_claim_id) emit(
    "runtime_verification_identity_binding_mismatch", "/evidence_identity/verification_id",
    { expected_identity: binding.verification_claim_id,
      actual_identity: identity.verification_id }
  );
  if (!identity.selected_unit.startsWith(`${identity.wk_id}#`) &&
      identity.selected_unit !== identity.wk_id) emit(
    "runtime_selected_unit_wk_mismatch", "/evidence_identity/selected_unit"
  );

  const validateProvider = (provider, capability, pointer) => {
    const result = resolveTestProofProviderCompatibility({
      provider,
      capability,
      pointer,
      require_snapshot: true,
      observation_mechanism: capability === "traversal_unsupported"
        ? undefined : provider?.observation_mechanism,
      evidence_artifact_types: capability === "traversal_unsupported"
        ? undefined : provider?.evidence_artifact_types
    });
    if (!result.valid) diagnostics.push(result.diagnostic);
    return result.descriptor;
  };
  const artifactById = new Map();
  for (const [index, artifact] of evidence.artifacts.entries()) {
    const digest = `sha256:${createHash("sha256").update(
      `${canonical(artifact.payload)}\n`, "utf8"
    ).digest("hex")}`;
    if (artifact.digest !== digest || artifact.artifact_id !== `artifact-${digest.slice(7)}`) {
      emit("runtime_artifact_identity_digest_mismatch", `/artifacts/${index}`);
    }
    artifactById.set(artifact.artifact_id, artifact);
  }
  const linkedPayloads = (row, kind) => row.evidence_artifact_ids
    .map((artifactId) => artifactById.get(artifactId))
    .filter((artifact) => artifact?.kind === kind)
    .map(({ payload }) => payload);

  const witnessed = (row, kind, mechanism, context) => {
    const validator = testProofWitnessValidator(kind, mechanism);
    return validator !== null && linkedPayloads(row, kind).some((payload) =>
      validator(payload, identity.test_id, context));
  };
  const candidateDescriptor = validateProvider(evidence.execution_result.provider,
    "candidate_execution", "/execution_result/provider");
  evidence.falsifier_executions.forEach((entry, index) => {
    validateProvider(entry.provider, "falsifier_execution",
      `/falsifier_executions/${index}/provider`);
    if (entry.target_verification_id !== binding.verification_claim_id) emit(
      "runtime_falsifier_verification_identity_mismatch",
      `/falsifier_executions/${index}/target_verification_id`
    );
    if (entry.status === "detected" && (entry.mutation.observed !== true ||
        entry.evidence_artifact_ids.length === 0 ||
        !witnessed(entry, "falsifier_result", entry.mutation.mechanism, entry.mutation))) emit(
      "runtime_falsifier_launcher_evidence_missing", `/falsifier_executions/${index}`
    );
  });

  const falsifierLimitations = new Map();
  evidence.capability_limitations.forEach((entry, index) => {
    if (entry.check_kind !== "falsifier" || entry.check_id === null) return;
    falsifierLimitations.set(entry.check_id, { entry, index });
  });
  const limitedFalsifiers = new Set();
  evidence.falsifier_executions.forEach((entry, index) => {
    if (entry.provider_support !== "unsupported") return;
    limitedFalsifiers.add(entry.falsifier_id);
    const recorded = falsifierLimitations.get(entry.falsifier_id)?.entry;
    if (recorded === undefined || recorded.reason_code !== entry.limitation.reason_code ||
        canonical(recorded.detail) !== canonical(entry.limitation.detail)) emit(
      "runtime_falsifier_limitation_incoherent", `/falsifier_executions/${index}/limitation`
    );
  });
  for (const [falsifierId, { index }] of falsifierLimitations) {
    if (!limitedFalsifiers.has(falsifierId)) emit(
      "runtime_falsifier_limitation_incoherent", `/capability_limitations/${index}`,
      { actual_identity: falsifierId }
    );
  }
  evidence.boundary_traversals.forEach((entry, index) => {
    const descriptor = validateProvider(entry.provider,
      entry.provider_support === "unsupported" ? "traversal_unsupported" : "boundary_traversal",
      `/boundary_traversals/${index}/provider`);
    if (entry.status === "proven" && (descriptor === null ||
        !descriptor.observation_mechanisms.includes(entry.observation_mechanism) ||
        !descriptor.observation_seams.includes(entry.observation_seam) ||
        entry.evidence_artifact_ids.length === 0 ||
        !witnessed(entry, "boundary_trace", entry.observation_mechanism, entry))) emit(
      "runtime_traversal_launcher_evidence_missing", `/boundary_traversals/${index}`
    );
  });
  if (candidateDescriptor !== null && evidence.execution_result.structured_result.mechanism !==
      candidateDescriptor.observation_mechanisms[0]) emit(
    "runtime_structured_result_mechanism_mismatch", "/execution_result/structured_result/mechanism",
    { expected_identity: candidateDescriptor.observation_mechanisms[0],
      actual_identity: evidence.execution_result.structured_result.mechanism }
  );
  const evidenceRows = [evidence.execution_result, ...evidence.boundary_traversals,
    ...evidence.falsifier_executions];
  for (const [index, row] of evidenceRows.entries()) for (const artifactId of
    row.evidence_artifact_ids) {
    const artifact = artifactById.get(artifactId);
    if (!artifact) emit("dangling_runtime_evidence_artifact", `/evidence/${index}`,
      { actual_identity: artifactId });
    else if (!row.provider.evidence_artifact_types.includes(artifact.kind)) emit(
      "runtime_evidence_artifact_kind_mismatch", `/evidence/${index}`,
      { expected_identity: row.provider.evidence_artifact_types,
        actual_identity: artifact.kind }
    );
  }
  const linkedExecutionArtifacts = evidence.execution_result.evidence_artifact_ids
    .map((artifactId) => artifactById.get(artifactId))
    .filter((artifact) => artifact?.kind === "structured_test_result");
  if (linkedExecutionArtifacts.length !== 1 ||
      canonical(linkedExecutionArtifacts[0]?.payload) !==
        canonical(evidence.execution_result.structured_result)) emit(
    "runtime_structured_result_artifact_mismatch", "/execution_result/structured_result"
  );
  const diagnosticPopulations = [evidence.execution_result.structured_result,
    ...evidence.artifacts.filter(({ kind }) => kind === "structured_test_result")
      .map(({ payload }) => payload)];
  diagnosticPopulations.forEach((structuredResult, populationIndex) => {
    structuredResult.fail_events.forEach((event, eventIndex) => {
      const pointer = `/failure_diagnostics/${populationIndex}/${eventIndex}`;
      const refs = failureDiagnosticReferences(event.failure_diagnostic);
      if (refs.duplicate_error_ids.length > 0) emit(
        "runtime_failure_diagnostic_error_identity_duplicate", `${pointer}/errors`,
        { actual_identity: [...new Set(refs.duplicate_error_ids)] }
      );
      if (refs.duplicate_value_ids.length > 0) emit(
        "runtime_failure_diagnostic_value_identity_duplicate", `${pointer}/values`,
        { actual_identity: [...new Set(refs.duplicate_value_ids)] }
      );
      for (const dangling of refs.dangling) emit(
        "runtime_failure_diagnostic_reference_dangling", `${pointer}${dangling.path}`,
        { actual_identity: dangling.id, expected_identity: dangling.kind }
      );
      for (const path of refs.duplicateEntries) emit(
        "runtime_failure_diagnostic_graph_entry_duplicate", `${pointer}${path}`
      );
      for (const path of refs.invalidShapes) emit(
        "runtime_failure_diagnostic_value_shape_invalid", `${pointer}${path}`
      );
    });
  });
  const ordered = [
    ...Object.entries(evidence.test_inventory).filter(([key]) => key.endsWith("_test_ids")),
    ["boundary_traversals", evidence.boundary_traversals.map(({ boundary_id: id }) => id)],
    ["falsifier_executions", evidence.falsifier_executions.map(
      ({ falsifier_id: id }) => id)],
    ["observed_shortcuts", evidence.observed_shortcuts],
    ["artifacts", evidence.artifacts.map(({ artifact_id: id }) => id)]
  ];
  for (const [field, values] of ordered) if (!canonicalArray(values)) emit(
    "noncanonical_runtime_evidence_population", `/${field}`
  );
  const structured = evidence.execution_result.structured_result;
  const summary = structured.summary;
  if (structured.exit_code !== evidence.execution_result.exit_code) emit(
    "runtime_execution_exit_code_mismatch", "/execution_result/structured_result/exit_code"
  );
  if (summary.passed !== structured.pass_events.length ||
      summary.failed !== structured.fail_events.length ||
      summary.tests !== summary.passed + summary.failed + summary.skipped +
        summary.cancelled + summary.todo) emit(
    "runtime_structured_result_count_mismatch", "/execution_result/structured_result/summary"
  );
  const discovered = new Set(evidence.test_inventory.discovered_test_ids);
  if (evidence.test_inventory.selected_test_id !== identity.test_id ||
      evidence.test_inventory.declared_test_ids[0] !== identity.test_id) emit(
    "runtime_selected_test_identity_mismatch", "/test_inventory/selected_test_id",
    { expected_identity: identity.test_id,
      actual_identity: evidence.test_inventory.selected_test_id }
  );
  if (!discovered.has(identity.test_id)) emit(
    "runtime_selected_test_not_discovered", "/evidence_identity/test_id"
  );
  for (const field of ["executed_test_ids", "skipped_test_ids"]) for (const testId of
    evidence.test_inventory[field]) if (!discovered.has(testId)) emit(
      "runtime_test_not_discovered", `/test_inventory/${field}`,
      { actual_identity: testId }
    );
  return Object.freeze({
    schema_valid: true,
    schema_errors: Object.freeze([]),
    diagnostics: projectBoundedDiagnostics(diagnostics),
    valid: diagnostics.length === 0,
    semantic_judgment: "not_performed_coordinator_owned"
  });
}

export {
  TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2,
  TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2,
  validateTestProofRuntimeEvidenceV2
};
