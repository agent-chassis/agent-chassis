import { createHash } from "node:crypto";
import { compiledValidators } from "./compiled-validator-cache.mjs";

import TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2 from
  "../schema/controlled-contract-test-proof-runtime-evidence.v2.schema.json" with { type: "json" };
import {
  resolveTestProofProviderCompatibility
} from "./test-proof-provider-registry.mjs";
import { canonicalizeStableValue, compareCodeUnits } from
  "./equality-normalization-v1.mjs";
import { projectBoundedDiagnostics } from "./bounded-diagnostic-projection.mjs";

const TEST_PROOF_RUNTIME_EVIDENCE_VERSION_V2 =
  "controlled-contract-test-proof-runtime-evidence.v2";
const { validateSchema } = await compiledValidators(
  "controlled-contract.test-proof-runtime-evidence.v2",
  { validators: { validateSchema: TEST_PROOF_RUNTIME_EVIDENCE_SCHEMA_V2 } }
);

const canonical = (value) => JSON.stringify(canonicalizeStableValue(value));
const canonicalArray = (values) => values.every((value, index) => index === 0 ||
  compareCodeUnits(values[index - 1], value) < 0);

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
  };
  validateProvider(evidence.execution_result.provider, "candidate_execution",
    "/execution_result/provider");
  evidence.falsifier_executions.forEach((entry, index) => {
    validateProvider(entry.provider, "falsifier_execution",
      `/falsifier_executions/${index}/provider`);
    if (entry.target_verification_id !== binding.verification_claim_id) emit(
      "runtime_falsifier_verification_identity_mismatch",
      `/falsifier_executions/${index}/target_verification_id`
    );
    if (entry.status === "detected" && (entry.mutation.observed !== true ||
        entry.evidence_artifact_ids.length === 0)) emit(
      "runtime_falsifier_launcher_evidence_missing", `/falsifier_executions/${index}`
    );
  });
  evidence.boundary_traversals.forEach((entry, index) => {
    validateProvider(entry.provider, entry.provider_support === "unsupported"
      ? "traversal_unsupported" : "boundary_traversal",
    `/boundary_traversals/${index}/provider`);
    if (entry.status === "proven" && (entry.observation_mechanism !==
        "node_test_v8_coverage" || entry.observation_seam !==
        "node_test_structured_assertion" || entry.evidence_artifact_ids.length === 0)) emit(
      "runtime_traversal_launcher_evidence_missing", `/boundary_traversals/${index}`
    );
  });
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
