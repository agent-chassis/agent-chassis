import { createHash } from "node:crypto";

import { compiledValidators } from "./compiled-validator-cache.mjs";
import ASSESSMENT_SCHEMA_V2 from
  "../schema/controlled-contract-assessment.v2.schema.json" with { type: "json" };
import ASSESSMENT_SCHEMA_V3 from
  "../schema/controlled-contract-assessment.v3.schema.json" with { type: "json" };
import { compareCodeUnits } from "./equality-normalization-v1.mjs";
import {
  StableTestProofContractError,
  resolveStableTestProofProviderBindings,
  validateStableTestProofContract
} from "./test-proof-contract-v1.mjs";
import { validateTestProofRuntimeEvidenceV2 } from "./test-proof-runtime-evidence-v2.mjs";

const MAX_TEST_PROOF_ASSESSMENT_INDEX_BYTES = 4096;
const SEMANTIC_JUDGMENT = "not_performed_coordinator_owned";
const RUNTIME_ASSESSMENT_VERSION = "controlled-contract-assessment.v3";
const RUNTIME_RECEIPT_CAPABILITY = Object.freeze({
  candidate: "candidate_execution",
  falsifier: "falsifier_execution",
  traversal: "boundary_traversal"
});
const { validateTestProofAssessmentSchema } = await compiledValidators(
  "controlled-contract.test-proof-assessment.v2",
  { validators: { validateTestProofAssessmentSchema: ASSESSMENT_SCHEMA_V2 } }
);
const { validateRuntimeTestProofAssessmentSchema } = await compiledValidators(
  "controlled-contract.test-proof-assessment.v3",
  { validators: { validateRuntimeTestProofAssessmentSchema: ASSESSMENT_SCHEMA_V3 } }
);
const compare = (left, right) => String(left).localeCompare(String(right));

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compare).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function canonicalDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function fieldDiagnostic(code, field, details = {}) {
  return { code, field, ...details };
}

function directBindingDiagnostics(binding, index) {
  const root = `/test_proofs/${index}`;
  const diagnostics = [];
  const required = [
    "test_proof_id", "verification_claim_id", "system_under_test_boundary",
    "observable_result", "candidate_execution_provider", "falsifiers",
    "traversal_provider", "coverage_disposition", "prohibited_shortcuts"
  ];
  for (const field of required) if (!binding || !Object.hasOwn(binding, field)) diagnostics.push(
    fieldDiagnostic("test_proof_required_field_missing", `${root}/${field}`)
  );
  if (!Array.isArray(binding?.falsifiers) || binding.falsifiers.length === 0) diagnostics.push(
    fieldDiagnostic("test_proof_falsifiers_empty", `${root}/falsifiers`)
  );
  if (!binding.prohibited_shortcuts?.includes("source_text_inspection")) diagnostics.push(
    fieldDiagnostic("test_proof_source_text_shortcut_not_prohibited",
      `${root}/prohibited_shortcuts`)
  );
  if (!binding.system_under_test_boundary?.boundary_id) diagnostics.push(
    fieldDiagnostic("test_proof_sut_boundary_invalid", `${root}/system_under_test_boundary`)
  );
  if (binding.system_under_test_boundary?.kind === "module" &&
      !binding.system_under_test_boundary.runtime_module_path) diagnostics.push(
    fieldDiagnostic("test_proof_runtime_module_path_missing",
      `${root}/system_under_test_boundary/runtime_module_path`)
  );
  if (!binding.observable_result?.observable_id) diagnostics.push(
    fieldDiagnostic("test_proof_observable_invalid", `${root}/observable_result`)
  );
  if (!binding.coverage_disposition?.baseline_state) diagnostics.push(
    fieldDiagnostic("test_proof_coverage_disposition_invalid", `${root}/coverage_disposition`)
  );
  for (const [falsifierIndex, falsifier] of (binding.falsifiers ?? []).entries()) {
    if (!falsifier?.execution_provider) diagnostics.push(fieldDiagnostic(
      "test_proof_provider_binding_missing",
      `${root}/falsifiers/${falsifierIndex}/execution_provider`
    ));
    if (!falsifier?.mutation) diagnostics.push(fieldDiagnostic(
      "test_proof_falsifier_mutation_missing",
      `${root}/falsifiers/${falsifierIndex}/mutation`
    ));
  }
  if (binding.traversal_provider?.mode === "provider") for (const field of [
    "boundary_kind", "observation_mechanism", "observation_seam", "evidence_artifact_type"
  ]) if (!binding.traversal_provider[field]) diagnostics.push(fieldDiagnostic(
    "test_proof_traversal_provider_field_missing", `${root}/traversal_provider/${field}`
  ));
  return diagnostics;
}

function providerDiagnostics(binding, index) {
  const root = `/test_proofs/${index}`;
  try {
    resolveStableTestProofProviderBindings(binding);
    return [];
  } catch (error) {
    if (!(error instanceof StableTestProofContractError)) throw error;
    return error.details.diagnostics.diagnostics.map((item) => ({
      code: `test_proof_${item.code}`,
      field: `${root}${item.pointer === "/" ? "" : item.pointer}`,
      package_diagnostic: item
    }));
  }
}

function bindingDiagnostics(binding, index, validation, verificationId) {
  const root = `/test_proofs/${index}`;
  const structuralDiagnostics = (validation.diagnostics?.diagnostics ?? []).filter((item) =>
    !validation.valid || item.verification_claim_id === verificationId ||
      item.test_proof_id === binding?.test_proof_id || item.pointer === root ||
      item.pointer?.startsWith(`${root}/`)
  ).map((item) => fieldDiagnostic(
    item.code.startsWith("test_proof_") ? item.code : `test_proof_${item.code}`,
    item.field ?? item.pointer ?? root, { package_diagnostic: item }
  ));
  return [...directBindingDiagnostics(binding, index), ...providerDiagnostics(binding, index),
    ...structuralDiagnostics].sort((left, right) =>
    compare(`${left.field}:${left.code}`, `${right.field}:${right.code}`));
}

function testExecutionVerificationClaims(contract) {
  return (contract?.claims ?? []).filter(({ kind, verification_method: method }) =>
    kind === "verification" && method === "test_execution"
  ).sort((left, right) => compare(left.claim_id, right.claim_id));
}

function perVerificationResults(contract, validation) {
  const claims = testExecutionVerificationClaims(contract);
  const proofs = Array.isArray(contract?.test_proofs) ? contract.test_proofs : [];
  if (validation.family !== "stable_v1") return claims.map(
    ({ claim_id: verificationId }) => ({
      verification_id: verificationId,
      status: "invalid",
      test_proof_id: null,
      diagnostics: (validation.diagnostics?.diagnostics ?? []).map((item) =>
        fieldDiagnostic(`test_proof_${item.code}`, item.pointer ?? "/", {
          package_diagnostic: item
        })),
      semantic_judgment: SEMANTIC_JUDGMENT
    })
  );
  return claims.map(({ claim_id: verificationId }) => {
    const matches = proofs.map((binding, index) => ({ binding, index })).filter(
      ({ binding }) => binding?.verification_claim_id === verificationId
    );
    if (matches.length === 0) return {
      verification_id: verificationId,
      status: "missing_binding",
      test_proof_id: null,
      diagnostics: [fieldDiagnostic(
        "test_proof_binding_missing", "/test_proofs", { verification_id: verificationId }
      )],
      semantic_judgment: SEMANTIC_JUDGMENT
    };
    if (matches.length > 1) {
      const diagnostics = [fieldDiagnostic(
        "test_proof_binding_ambiguous", "/test_proofs", { verification_id: verificationId }
      ), ...matches.flatMap(({ binding, index }) =>
        bindingDiagnostics(binding, index, validation, verificationId))].sort((left, right) =>
        compare(`${left.field}:${left.code}`, `${right.field}:${right.code}`));
      return { verification_id: verificationId, status: "ambiguous_binding", test_proof_id: null,
        diagnostics, semantic_judgment: SEMANTIC_JUDGMENT };
    }
    const { binding, index } = matches[0];
    const root = `/test_proofs/${index}`;
    const diagnostics = bindingDiagnostics(binding, index, validation, verificationId);
    return {
      verification_id: verificationId,
      status: diagnostics.length === 0 ? "valid" : "invalid",
      test_proof_id: binding?.test_proof_id ?? null,
      diagnostics,
      semantic_judgment: SEMANTIC_JUDGMENT
    };
  });
}

function compactIndex(results, artifact, contractFamily) {
  const all = results.map(({ verification_id: verificationId, status, diagnostics }) => ({
    verification_id: verificationId, status, diagnostic_count: diagnostics.length
  }));
  const status = contractFamily === "v0.2" ? "migration_required"
    : results.length === 0 ? "not_applicable"
      : results.every(({ status: resultStatus }) => resultStatus === "valid")
        ? "proven" : "not_proven";
  const selected = [];
  for (const item of all) {
    const candidate = {
      schema_version: "controlled-contract-test-proof-assessment-index.v1",
      axis: "test_proof", status, result_count: all.length,
      returned_count: selected.length + 1,
      omitted_count: all.length - selected.length - 1,
      results: [...selected, item], artifact, byte_length: 1
    };
    candidate.byte_length = Buffer.byteLength(canonicalJson(candidate));
    if (candidate.byte_length > MAX_TEST_PROOF_ASSESSMENT_INDEX_BYTES) break;
    selected.push(item);
  }
  const index = {
    schema_version: "controlled-contract-test-proof-assessment-index.v1",
    axis: "test_proof", status, result_count: all.length,
    returned_count: selected.length, omitted_count: all.length - selected.length,
    results: selected, artifact, byte_length: 1
  };
  index.byte_length = Buffer.byteLength(canonicalJson(index));
  return index;
}

class TestProofRuntimeAssessmentError extends Error {
  constructor(diagnostics) {
    const code = diagnostics[0]?.code ?? "test_proof_runtime_refused";
    super(code);
    this.name = "TestProofRuntimeAssessmentError";
    this.code = code;
    this.assessment_scope = "runtime";
    this.authority = "non_authoritative";
    this.diagnostics = Object.freeze(structuredClone(diagnostics));
  }
}

function deepFreezeValue(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeValue(child);
  return Object.freeze(value);
}

function refuseRuntime(diagnostics) {
  throw new TestProofRuntimeAssessmentError([...diagnostics].sort((left, right) =>
    compareCodeUnits(`${left.field}:${left.code}`, `${right.field}:${right.code}`)));
}

function refuseRuntimeAt(code, field, details = {}) {
  refuseRuntime([fieldDiagnostic(code, field, details)]);
}

function assertClosedRuntimeInput(value, allowed, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuseRuntimeAt(
    "test_proof_runtime_input_invalid", field,
    { expected_identity: "closed object", actual_identity: value === null ? null : typeof value }
  );
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key)).sort(
    compareCodeUnits);
  if (unsupported.length > 0) refuseRuntimeAt("test_proof_runtime_input_invalid", field,
    { expected_identity: allowed, actual_identity: unsupported });
}

function runtimeSelectedBindings(contract, expectedVerificationIds) {
  const proofs = Array.isArray(contract?.test_proofs) ? contract.test_proofs : [];
  const diagnostics = [];
  const selected = new Map();
  for (const verificationId of expectedVerificationIds) {
    const matches = proofs.filter(
      (binding) => binding?.verification_claim_id === verificationId);
    if (matches.length === 0) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_binding_missing", "/test_proofs",
      { verification_id: verificationId }));
    else if (matches.length > 1) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_binding_ambiguous", "/test_proofs",
      { verification_id: verificationId, actual_identity: matches.length }));
    else selected.set(verificationId, matches[0]);
  }
  if (diagnostics.length > 0) refuseRuntime(diagnostics);
  return selected;
}

function bindRuntimeReceiptPopulation(receipts, expectedVerificationIds) {
  const diagnostics = [];
  const byVerification = new Map();
  receipts.forEach((receipt, index) => {
    const field = `/runtime/receipts/${index}`;
    const verificationId = receipt.evidence_identity.verification_id;
    if (!expectedVerificationIds.includes(verificationId)) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_receipt_unexpected", field,
      { expected_identity: expectedVerificationIds, actual_identity: verificationId }));
    else if (byVerification.has(verificationId)) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_receipt_duplicate", field, { actual_identity: verificationId }));
    else byVerification.set(verificationId, { evidence: receipt, index });
  });
  for (const verificationId of expectedVerificationIds) if (!byVerification.has(
    verificationId
  )) diagnostics.push(fieldDiagnostic("test_proof_runtime_receipt_missing",
    "/runtime/receipts", { expected_identity: verificationId }));
  if (diagnostics.length > 0) refuseRuntime(diagnostics);
  return byVerification;
}

function runtimeReceipt({
  evidenceId, verificationId, kind, rowKey, status, provider, artifactIds, identity
}) {
  const evidenceArtifactIds = [...artifactIds].sort(compareCodeUnits);
  const content = {
    evidence_id: evidenceId, verification_id: verificationId, kind, row: rowKey, status,
    provider_id: provider.provider_id, provider_version: provider.provider_version,
    capability: RUNTIME_RECEIPT_CAPABILITY[kind],
    evidence_artifact_ids: evidenceArtifactIds,
    run_id: identity.run_id, source_snapshot_digest: identity.source_snapshot_digest
  };

  return {
    receipt_id: `receipt-${canonicalDigest({ evidence_id: evidenceId, kind, row: rowKey })}`,
    verification_id: verificationId,
    kind,
    status,
    provider: {
      provider_id: provider.provider_id,
      provider_version: provider.provider_version,
      capability: RUNTIME_RECEIPT_CAPABILITY[kind]
    },
    authenticated_identity: {
      run_id: identity.run_id,
      source_snapshot_digest: identity.source_snapshot_digest,
      receipt_digest: `sha256:${canonicalDigest(content)}`
    },
    evidence_artifact_ids: evidenceArtifactIds
  };
}

function bindRuntimeFalsifiers(binding, evidence, diagnostics, root) {
  const declared = (binding.falsifiers ?? []).map(({ falsifier_id: id }) => id);
  const seen = new Set();
  evidence.falsifier_executions.forEach((entry, index) => {
    const field = `${root}/falsifier_executions/${index}`;
    if (!declared.includes(entry.falsifier_id)) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_falsifier_unexpected", field,
      { expected_identity: [...declared].sort(compareCodeUnits),
        actual_identity: entry.falsifier_id }));
    else if (seen.has(entry.falsifier_id)) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_falsifier_duplicate", field,
      { actual_identity: entry.falsifier_id }));
    else seen.add(entry.falsifier_id);
    if (entry.status !== "detected") diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_falsifier_inert", `${field}/status`,
      { expected_identity: "detected", actual_identity: entry.status }));
    if (entry.evidence_artifact_ids.length === 0) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_receipt_evidence_missing", `${field}/evidence_artifact_ids`));
  });
  for (const falsifierId of [...declared].sort(compareCodeUnits)) if (!seen.has(
    falsifierId
  )) diagnostics.push(fieldDiagnostic("test_proof_runtime_falsifier_missing",
    `${root}/falsifier_executions`, { expected_identity: falsifierId }));
  return {
    exact: declared.length > 0 && seen.size === declared.length &&
      evidence.falsifier_executions.length === declared.length,
    activated: evidence.falsifier_executions.length > 0 &&
      evidence.falsifier_executions.every(({ status }) => status === "detected")
  };
}

function bindRuntimeTraversals(binding, evidence, diagnostics, root) {
  const boundaryId = binding.system_under_test_boundary?.boundary_id;
  const observableId = binding.observable_result?.observable_id;
  const seen = new Set();
  evidence.boundary_traversals.forEach((entry, index) => {
    const field = `${root}/boundary_traversals/${index}`;
    if (entry.boundary_id !== boundaryId || entry.observable_id !== observableId) {
      diagnostics.push(fieldDiagnostic("test_proof_runtime_traversal_unexpected", field,
        { expected_identity: [boundaryId ?? null, observableId ?? null],
          actual_identity: [entry.boundary_id, entry.observable_id] }));
    } else if (seen.has(entry.boundary_id)) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_traversal_duplicate", field,
      { actual_identity: entry.boundary_id }));
    else seen.add(entry.boundary_id);
    if (entry.status !== "proven") diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_traversal_unproven", `${field}/status`,
      { expected_identity: "proven", actual_identity: entry.status }));
    if (entry.evidence_artifact_ids.length === 0) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_receipt_evidence_missing", `${field}/evidence_artifact_ids`));
  });
  if (!seen.has(boundaryId)) diagnostics.push(fieldDiagnostic(
    "test_proof_runtime_traversal_missing", `${root}/boundary_traversals`,
    { expected_identity: boundaryId ?? null }));
  return {
    exact: seen.size === 1 && seen.has(boundaryId) &&
      evidence.boundary_traversals.length === 1,
    proven: evidence.boundary_traversals.length > 0 &&
      evidence.boundary_traversals.every(({ status }) => status === "proven")
  };
}

function bindRuntimeCandidate(binding, evidence, diagnostics, root) {
  const execution = evidence.execution_result;
  const inventory = evidence.test_inventory;
  if (execution.status !== "passed") diagnostics.push(fieldDiagnostic(
    "test_proof_runtime_candidate_failed", `${root}/execution_result/status`,
    { expected_identity: "passed", actual_identity: execution.status }));
  if (execution.evidence_artifact_ids.length === 0) diagnostics.push(fieldDiagnostic(
    "test_proof_runtime_receipt_evidence_missing",
    `${root}/execution_result/evidence_artifact_ids`));
  if (inventory.newly_skipped_test_ids.length > 0) diagnostics.push(fieldDiagnostic(
    "test_proof_runtime_newly_skipped_population",
    `${root}/test_inventory/newly_skipped_test_ids`,
    { actual_identity: inventory.newly_skipped_test_ids }));
  if (inventory.unexpected_test_ids.length > 0) diagnostics.push(fieldDiagnostic(
    "test_proof_runtime_unexpected_test_population",
    `${root}/test_inventory/unexpected_test_ids`,
    { actual_identity: inventory.unexpected_test_ids }));
  if (!inventory.executed_test_ids.includes(evidence.evidence_identity.test_id)) {
    diagnostics.push(fieldDiagnostic("test_proof_runtime_selected_test_not_executed",
      `${root}/test_inventory/executed_test_ids`,
      { expected_identity: evidence.evidence_identity.test_id }));
  }
  const prohibited = (binding.prohibited_shortcuts ?? []).filter((shortcut) =>
    evidence.observed_shortcuts.includes(shortcut)).sort(compareCodeUnits);
  if (prohibited.length > 0) diagnostics.push(fieldDiagnostic(
    "test_proof_runtime_prohibited_shortcut_observed", `${root}/observed_shortcuts`,
    { actual_identity: prohibited }));
  return {
    candidateSuccess: execution.status === "passed" &&
      execution.evidence_artifact_ids.length > 0 &&
      inventory.newly_skipped_test_ids.length === 0 &&
      inventory.unexpected_test_ids.length === 0 &&
      inventory.executed_test_ids.includes(evidence.evidence_identity.test_id),
    discriminationClean: prohibited.length === 0
  };
}

function sharedRuntimeIdentity(evidence) {
  return {
    run_id: evidence.evidence_identity.run_id,
    wk_id: evidence.evidence_identity.wk_id,
    selected_unit: evidence.evidence_identity.selected_unit,
    attempt: evidence.evidence_identity.attempt,
    contract_digest: evidence.contract_binding.contract_digest,
    source_snapshot_digest: evidence.evidence_identity.source_snapshot_digest,
    generation_digest: evidence.evidence_identity.controlled_contract_generation
  };
}

function assertRuntimeSharedIdentityEquality(members) {
  const expected = sharedRuntimeIdentity(members[0].evidence);
  const keys = Object.keys(expected).sort(compareCodeUnits);
  const diagnostics = [];
  for (const { evidence, index } of members.slice(1)) {
    const actual = sharedRuntimeIdentity(evidence);
    for (const key of keys) if (actual[key] !== expected[key]) diagnostics.push(
      fieldDiagnostic("test_proof_runtime_receipt_identity_mismatch",
        `/runtime/receipts/${index}/${key}`,
        { expected_identity: expected[key], actual_identity: actual[key] }));
  }
  if (diagnostics.length > 0) refuseRuntime(diagnostics);
  return expected;
}

function assertRuntimeReceiptIdentityEquality(receipts, identity) {
  const diagnostics = [];
  const seen = new Set();
  receipts.forEach((receipt, index) => {
    const field = `/receipts/${index}`;
    if (receipt.authenticated_identity.run_id !== identity.run_id ||
        receipt.authenticated_identity.source_snapshot_digest !==
          identity.source_snapshot_digest) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_receipt_identity_mismatch", field,
      { expected_identity: [identity.run_id, identity.source_snapshot_digest],
        actual_identity: [receipt.authenticated_identity.run_id,
          receipt.authenticated_identity.source_snapshot_digest] }));
    if (seen.has(receipt.receipt_id)) diagnostics.push(fieldDiagnostic(
      "test_proof_runtime_receipt_identity_duplicate", field,
      { actual_identity: receipt.receipt_id }));
    else seen.add(receipt.receipt_id);
  });
  if (diagnostics.length > 0) refuseRuntime(diagnostics);
}

function assessRuntimeTestProofContract(contract, runtime) {
  assertClosedRuntimeInput(runtime, ["receipts"], "/runtime");
  const validation = validateStableTestProofContract(contract);
  if (validation.family !== "stable_v1" || !validation.valid) refuseRuntimeAt(
    "test_proof_runtime_contract_invalid", "/", {
      expected_identity: "valid stable_v1 test-proof contract",
      actual_identity: validation.family,
      package_diagnostic: validation.diagnostics ?? null
    });
  const expected = testExecutionVerificationClaims(contract).map(
    ({ claim_id: claimId }) => claimId);
  if (expected.length === 0) refuseRuntimeAt(
    "test_proof_runtime_expected_population_empty", "/claims");
  const receipts = runtime.receipts;
  if (!Array.isArray(receipts) || receipts.length === 0) refuseRuntimeAt(
    "test_proof_runtime_receipt_population_missing", "/runtime/receipts",
    { expected_identity: expected.length,
      actual_identity: Array.isArray(receipts) ? receipts.length : null });
  const invalid = receipts.flatMap((receipt, index) => {
    const result = validateTestProofRuntimeEvidenceV2(receipt);
    return result.valid ? [] : [fieldDiagnostic("test_proof_runtime_receipt_invalid",
      `/runtime/receipts/${index}`, {
        schema_valid: result.schema_valid,
        package_diagnostic: result.schema_valid ? result.diagnostics : null,
        ...(result.schema_valid ? {} : {
          schema_errors: structuredClone([...result.schema_errors].slice(0, 8))
        })
      })];
  });
  if (invalid.length > 0) refuseRuntime(invalid);
  const bound = bindRuntimeReceiptPopulation(receipts, expected);
  const bindings = runtimeSelectedBindings(contract, expected);

  const members = expected.map((verificationId) => ({
    verificationId,
    binding: bindings.get(verificationId),
    ...bound.get(verificationId)
  }));
  const shared = assertRuntimeSharedIdentityEquality(members);

  const diagnostics = [];
  const assessed = members.map(({ verificationId, binding, evidence, index }) => {
    const root = `/runtime/receipts/${index}`;
    if (evidence.contract_binding.test_proof_id !== binding.test_proof_id) diagnostics.push(
      fieldDiagnostic("test_proof_runtime_binding_mismatch",
        `${root}/contract_binding/test_proof_id`, {
          expected_identity: binding.test_proof_id,
          actual_identity: evidence.contract_binding.test_proof_id
        }));
    const candidate = bindRuntimeCandidate(binding, evidence, diagnostics, root);
    return {
      verificationId,
      evidence,
      candidate,
      falsifiers: bindRuntimeFalsifiers(binding, evidence, diagnostics, root),
      traversals: bindRuntimeTraversals(binding, evidence, diagnostics, root)
    };
  });
  if (diagnostics.length > 0) refuseRuntime(diagnostics);

  const populationExact = assessed.every(
    ({ falsifiers, traversals }) => falsifiers.exact && traversals.exact);
  const identity = {
    run_id: shared.run_id,
    wk_id: shared.wk_id,
    selected_unit: shared.selected_unit,
    attempt: shared.attempt,
    verifications: assessed.map(({ verificationId, evidence }) => ({
      verification_id: verificationId,
      test_id: evidence.evidence_identity.test_id
    })),
    contract_digest: shared.contract_digest,
    source_snapshot_digest: shared.source_snapshot_digest,
    generation_digest: shared.generation_digest
  };
  const receiptIdentity = {
    run_id: identity.run_id,
    source_snapshot_digest: identity.source_snapshot_digest
  };
  const projected = assessed.flatMap(({ verificationId, evidence }) => {
    const evidenceId = evidence.evidence_identity.evidence_id;
    const common = { evidenceId, verificationId, identity: receiptIdentity };
    return [
      runtimeReceipt({ ...common, kind: "candidate", rowKey: "execution_result",
        status: "passed", provider: evidence.execution_result.provider,
        artifactIds: evidence.execution_result.evidence_artifact_ids }),
      ...[...evidence.falsifier_executions].sort((left, right) =>
        compareCodeUnits(left.falsifier_id, right.falsifier_id)).map((entry) =>
        runtimeReceipt({ ...common, kind: "falsifier", rowKey: entry.falsifier_id,
          status: "detected", provider: entry.provider,
          artifactIds: entry.evidence_artifact_ids })),
      ...[...evidence.boundary_traversals].sort((left, right) =>
        compareCodeUnits(left.boundary_id, right.boundary_id)).map((entry) =>
        runtimeReceipt({ ...common, kind: "traversal", rowKey: entry.boundary_id,
          status: "proven", provider: entry.provider,
          artifactIds: entry.evidence_artifact_ids }))
    ];
  });
  assertRuntimeReceiptIdentityEquality(projected, identity);
  const candidateSuccess = assessed.every(({ candidate }) => candidate.candidateSuccess);
  const discriminationClean = assessed.every(
    ({ candidate }) => candidate.discriminationClean);
  const runtimeTruth = candidateSuccess && populationExact ? "proven" : "not_proven";
  const profileDiscrimination = assessed.every(
    ({ falsifiers, traversals }) => falsifiers.activated && traversals.proven) &&
    discriminationClean ? "proven" : "not_proven";
  const assessment = {
    schema_version: RUNTIME_ASSESSMENT_VERSION,
    assessment_scope: "runtime",
    authority: "non_authoritative",
    assessment_status: runtimeTruth === "proven" && profileDiscrimination === "proven"
      ? "proven" : "not_proven",
    assessment_identity: identity,
    runtime_truth: runtimeTruth,
    profile_discrimination: profileDiscrimination,
    population: {
      candidate_count: assessed.length,
      falsifier_count: assessed.reduce(
        (count, { evidence }) => count + evidence.falsifier_executions.length, 0),
      traversal_count: assessed.reduce(
        (count, { evidence }) => count + evidence.boundary_traversals.length, 0),
      complete: populationExact
    },
    receipts: projected,
    diagnostics: []
  };
  if (!validateRuntimeTestProofAssessmentSchema(assessment)) refuseRuntimeAt(
    "test_proof_runtime_assessment_invalid", "/", {
      package_diagnostic: structuredClone(
        validateRuntimeTestProofAssessmentSchema.errors ?? [])
    });
  return deepFreezeValue(assessment);
}

function assessPlanningTestProofContract(contract) {
  const validation = validateStableTestProofContract(contract);
  const results = perVerificationResults(contract, validation);
  const detail = {
    contract_family: validation.family,
    validation_valid: validation.valid,
    results
  };
  const contentDigest = canonicalDigest(detail);
  const contentReference =
    `controlled-contract-test-proof-assessment://sha256/${contentDigest}`;
  const identity = canonicalDigest({
    schema_version: "controlled-contract-assessment.v2",
    axis: "test_proof",
    content_digest: contentDigest
  });
  const assessment = {
    schema_version: "controlled-contract-assessment.v2",
    assessment_identity: identity,
    axis: "test_proof",
    authority: "non_authoritative",
    runtime_truth: "not_assessed",
    semantic_judgment: SEMANTIC_JUDGMENT,
    result_count: results.length,
    results,
    compact_index: compactIndex(results, contentReference, validation.family),
    lossless_artifact: {
      content_reference: contentReference,
      content_digest: contentDigest,
      detail_count: results.length,
      details: structuredClone(results)
    }
  };
  if (!validateTestProofAssessmentSchema(assessment)) throw new Error(
    `test-proof assessment emitted invalid output: ${JSON.stringify(
      validateTestProofAssessmentSchema.errors
    )}`
  );
  return assessment;
}

function assessTestProofContract(contract, options = undefined) {
  if (options === undefined) return assessPlanningTestProofContract(contract);
  assertClosedRuntimeInput(options, ["runtime"], "/options");
  if (options.runtime === undefined) return assessPlanningTestProofContract(contract);
  return assessRuntimeTestProofContract(contract, options.runtime);
}

function evaluateAdmittedTestValidity({ contract, evaluationInput, proofPack }) {
  const evaluate = proofPack?.test_validity_evaluator?.evaluate;
  if (typeof evaluate !== "function") throw new Error(
    "the exact admitted test-validity evaluator was not resolved"
  );
  const result = evaluate({ contract, evaluation_input: evaluationInput });
  return {
    ...result,
    profile: {
      profile_id: proofPack.profile.profile_id,
      profile_version: proofPack.profile.profile_version
    },
    admission: { profile_digest: proofPack.profile_digest },
    pattern_results: []
  };
}

function compactAssessmentOutput(assessment) {
  return {
    overall_code: assessment.overall_code,
    structure: assessment.structure,
    profile_discrimination: assessment.profile_discrimination,
    ...(assessment.exact_binding === undefined ? {} : { exact_binding: assessment.exact_binding }),
    assessment_scope: assessment.assessment_scope,
    residue_status: assessment.residue_status,
    authority: assessment.authority,
    repository_grounding_status: assessment.repository_grounding.status,
    grounded_mandatory_behavior_count: assessment.repository_grounding.grounded_count,
    total_mandatory_behavior_count: assessment.repository_grounding.total_mandatory_behavior_count,
    ungrounded_mandatory_behavior_claim_ids: assessment.repository_grounding.ungrounded_mandatory_behavior_claim_ids,
    diagnostic_count: assessment.diagnostics.length,
    review_signal_count: assessment.review_signals.length,
    residue_count: assessment.residue.length,
    exclusion_count: assessment.proof_exclusions.length,
    artifact: assessment.lossless_report.content_reference
  };
}

function markdownAssessment(assessment) {
  const profileScope = "Proven means only that the authored controlled graph satisfied this admitted, adequacy-verified profile. It does not establish runtime truth.";
  const planningScope = "This planning assessment evaluates authored contract structure and proof-plan discrimination. Delivered runtime behavior is outside its scope.";
  const lines = [
    "# Controlled Contract Assessment", "",
    `## STRUCTURE: ${assessment.structure.toUpperCase()}`, "",
    `## PROFILE DISCRIMINATION: ${assessment.profile_discrimination.toUpperCase().replaceAll("_", " ")}`, "",
    ...(assessment.exact_binding === undefined ? [] : [
      `## EXACT BINDING: ${assessment.exact_binding.toUpperCase().replaceAll("_", " ")}`, ""
    ]),
    profileScope, "", "## ASSESSMENT SCOPE: PLANNING", "", planningScope, "",
    "## AUTHORITY: NON-AUTHORITATIVE", "", "## CATEGORICAL LIMITS", "",
    `- ${assessment.categorical_limits.omitted_obligations}`,
    `- ${assessment.categorical_limits.repository_grounding}`,
    `- ${assessment.categorical_limits.runtime_behavior}`,
    `- ${assessment.categorical_limits.implementation_readiness}`, "",
    `## RESIDUE: ${assessment.residue_status.toUpperCase().replaceAll("_", " ")}`, "",
    `Overall code: \`${assessment.overall_code}\``, "",
    `Assessment identity: \`${assessment.assessment_identity}\``, "",
    `Lossless report: \`${assessment.lossless_report.content_reference}\``, "",
    "## Profile guarantee", "",
    assessment.profile_guarantee?.guarantee ?? "No admitted profile was assessed.", "",
    "## Claim coverage", "",
    `Matched/profile-covered claims: ${assessment.matched_profile_covered_claims.length}`,
    `Structurally verified claim edges: ${assessment.structurally_verified_claim_edges.length}`,
    `Mandatory claims outside the selected profile: ${assessment.mandatory_claim_categories.outside_selected_profile.length}`,
    "", "## Repository grounding", "", `Status: ${assessment.repository_grounding.status}`,
    `Grounded mandatory behaviors: ${assessment.repository_grounding.grounded_count}/${assessment.repository_grounding.total_mandatory_behavior_count}`,
    `Ungrounded mandatory behavior claim IDs: ${assessment.repository_grounding.ungrounded_mandatory_behavior_claim_ids.length === 0 ? "none" : assessment.repository_grounding.ungrounded_mandatory_behavior_claim_ids.map((id) => `\`${id}\``).join(", ")}`,
    "", "## Proof exclusions", ""
  ];
  if (assessment.proof_exclusions.length === 0) lines.push("None.");
  else for (const exclusion of assessment.proof_exclusions) lines.push(
    `- \`${exclusion.exclusion_id}\` — adequacy control: ${exclusion.adequacy_control_outcome ?? "not observed"}`
  );
  lines.push("", "## Diagnostics", "");
  if (assessment.diagnostics.length === 0) lines.push("None.");
  else for (const diagnostic of assessment.diagnostics) lines.push(
    `- \`${diagnostic.source}\`: \`${JSON.stringify(canonicalValue(diagnostic.detail))}\``
  );
  lines.push("", "## Residue", "");
  if (assessment.residue.length === 0) lines.push("None.");
  else for (const item of assessment.residue) lines.push(
    `- \`${item.residue_id}\` (${item.reason}): ${item.text}`
  );
  lines.push("", "## Review signals", "");
  if (assessment.review_signals.length === 0) lines.push("None.");
  else for (const signal of assessment.review_signals) lines.push(
    `- \`${signal.code}\` collection \`${signal.collection_id}\`; members: ${signal.member_claim_ids.map((id) => `\`${id}\``).join(", ")}`
  );
  lines.push("", "## Review actions", "");
  if (assessment.review_actions.length === 0) lines.push("None.");
  else for (const review of assessment.review_actions) {
    const claims = review.claim_ids.length === 0 ? "" :
      ` [${review.claim_ids.map((id) => `\`${id}\``).join(", ")}]`;
    lines.push(`- \`${review.code}\`${claims}: ${review.description}`);
  }
  lines.push("", "## Required next evidence", "");
  for (const required of assessment.required_next_evidence) {
    const subjects = required.subject_ids.length === 0 ? "" :
      ` [${required.subject_ids.map((id) => `\`${id}\``).join(", ")}]`;
    lines.push(`- \`${required.code}\`${subjects}: ${required.description}`);
  }
  lines.push("", "## Source digests", "");
  for (const [name, digest] of Object.entries(assessment.digests.source)) lines.push(
    `- ${name}: ${digest === null ? "not applicable" : `\`${digest}\``}`
  );
  return `${lines.join("\n")}\n`;
}

export {
  ASSESSMENT_SCHEMA_V2,
  ASSESSMENT_SCHEMA_V3,
  MAX_TEST_PROOF_ASSESSMENT_INDEX_BYTES,
  RUNTIME_ASSESSMENT_VERSION,
  SEMANTIC_JUDGMENT,
  TestProofRuntimeAssessmentError,
  assessTestProofContract,
  validateRuntimeTestProofAssessmentSchema,
  canonicalDigest,
  canonicalJson,
  compactAssessmentOutput,
  evaluateAdmittedTestValidity,
  markdownAssessment,
  validateTestProofAssessmentSchema
};
