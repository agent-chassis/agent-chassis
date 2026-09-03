import { createHash } from "node:crypto";

import { validateObligationCoverageCarrier } from "./obligation-coverage-carrier.mjs";
import {
  STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS,
  classifyStableTestProofRuntimeReadiness,
  validateStableTestProofContract
} from "./test-proof-contract-v1.mjs";
import { assertAdmittedProofPackSnapshot } from "./admitted-proof-packs.mjs";

const RESOLUTION_SCHEMA_VERSION = "controlled-contract-proof-obligation-resolution.v1";
const NOT_EXECUTABLE = Object.freeze({
  OBLIGATION_UNKNOWN: "verify_proof.obligation_unknown.v1",
  OBLIGATION_NOT_PACK_BACKED: "verify_proof.obligation_not_pack_backed.v1",
  OBLIGATION_NOT_TEST_BACKED: "verify_proof.obligation_not_test_backed.v1",
  BEHAVIOR_CLAIM_MISSING: "verify_proof.behavior_claim_missing.v1",
  MANDATORY_BEHAVIOR_COVERAGE_INCOMPLETE:
    "verify_proof.mandatory_behavior_coverage_incomplete.v1",
  QUALIFYING_VERIFICATION_MISSING: "verify_proof.qualifying_verification_missing.v1",
  QUALIFYING_VERIFICATION_AMBIGUOUS: "verify_proof.qualifying_verification_ambiguous.v1",
  TEST_PROOF_BINDING_MISSING: "verify_proof.test_proof_binding_missing.v1",
  TEST_PROOF_BINDING_AMBIGUOUS: "verify_proof.test_proof_binding_ambiguous.v1",
  RUNTIME_TEST_INVENTORY_MISSING: "verify_proof.runtime_test_inventory_missing.v1",
  RUNTIME_TEST_SELECTION_MISSING: "verify_proof.runtime_test_selection_missing.v1",
  RUNTIME_TEST_SELECTION_INVALID: "verify_proof.runtime_test_selection_invalid.v1",
  DECLARED_TARGET_MISSING: "verify_proof.declared_target_missing.v1",
  DECLARED_TARGET_AMBIGUOUS: "verify_proof.declared_target_ambiguous.v1",
  PROOF_PLAN_ENTRY_MISSING: "verify_proof.proof_plan_entry_missing.v1",
  PROOF_PLAN_ENTRY_AMBIGUOUS: "verify_proof.proof_plan_entry_ambiguous.v1",
  POST_DELIVERY_PACK_UNAVAILABLE: "verify_proof.post_delivery_pack_unavailable.v1"
});
const DEFERRED_BINDING_DIAGNOSTICS = new Set([
  "stable_test_proof_missing",
  "stable_test_proof_claim_duplicate"
]);

class ProofObligationResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofObligationResolutionError";
    this.code = code;
    this.details = structuredClone(details);
  }
}

const compare = (left, right) => String(left).localeCompare(String(right));

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compare).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonicalDigest(value) {
  return `sha256:${createHash("sha256").update(
    `${JSON.stringify(canonicalValue(value), null, 2)}\n`
  ).digest("hex")}`;
}

function serializedCarrierDigest(value) {
  return `sha256:${createHash("sha256").update(
    `${JSON.stringify(value, null, 2)}\n`
  ).digest("hex")}`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertDigest(name, value, expected) {

  const actual = serializedCarrierDigest(value);
  if (expected !== undefined && expected !== actual) throw new ProofObligationResolutionError(
    "verify_proof.identity_digest_mismatch.v1",
    `${name} does not reproduce its bound digest`,
    { identity: name, expected, actual }
  );
  return actual;
}

function notExecutable(obligationId, reasonCode, details = {}, identity = {},
  authorityLimb = null) {
  return deepFreeze({
    schema_version: RESOLUTION_SCHEMA_VERSION,
    status: "not_executable",
    authority: "non_authoritative",
    obligation_id: obligationId,
    reason_code: reasonCode,
    details: structuredClone(details),
    ...(authorityLimb === null ? {} : { authority_limb: authorityLimb }),
    ...structuredClone(identity)
  });
}

const RUNTIME_READINESS_REASON_CODES = Object.freeze({
  [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_INVENTORY]:
    NOT_EXECUTABLE.RUNTIME_TEST_INVENTORY_MISSING,
  [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.MISSING_SELECTION]:
    NOT_EXECUTABLE.RUNTIME_TEST_SELECTION_MISSING,
  [STABLE_TEST_PROOF_RUNTIME_READINESS_REASONS.INVALID_SELECTION]:
    NOT_EXECUTABLE.RUNTIME_TEST_SELECTION_INVALID
});

function runtimeReadinessDetails(readiness, verificationId) {
  const candidates = readiness.current_test_ids.slice(0, 16);
  return {
    readiness_reason: readiness.reason,
    verification_id: verificationId,
    selected_test_id: readiness.selected_test_id,
    candidate_test_ids: candidates,
    candidate_total: readiness.candidate_total,
    candidate_test_ids_omitted: readiness.candidate_total - candidates.length,
    recovery_operation: "workspace_controlled_test_proof_patch",
    complete_retrieval: {
      tool: "workspace_controlled_test_proof_query",
      arguments: { verification_ids: [verificationId] }
    },
    admissibility_effect: "none"
  };
}

function planEntriesFor(mapping, proofPlan) {
  return (proofPlan?.packs ?? []).filter((entry) =>
    entry.profile_id === mapping.profile_id &&
    entry.profile_version === mapping.profile_version &&
    entry.requested_intents?.includes(mapping.requested_intent)
  );
}

function explicitlyNamedIds(row, kind, indexes) {
  return row.controlled_contract_node_ids.filter((id) => indexes[kind].has(id)).sort(compare);
}

function resolveBehaviorAndVerificationPopulation(row, contract) {
  const claims = new Map((contract.claims ?? []).map((claim) => [claim.claim_id, claim]));
  const relations = new Map((contract.relations ?? []).map((relation) =>
    [relation.relation_id, relation]));
  const indexes = {
    claim: new Set(claims.keys()),
    relation: new Set(relations.keys())
  };
  const explicitClaims = explicitlyNamedIds(row, "claim", indexes);
  const explicitRelations = explicitlyNamedIds(row, "relation", indexes);
  const explicitBehaviors = explicitClaims.filter((id) => claims.get(id)?.kind === "behavior");
  const explicitVerifications = explicitClaims.filter((id) =>
    claims.get(id)?.kind === "verification");
  const candidateRelations = [...relations.values()].filter((relation) =>
    relation.role === "verifies" &&
    (explicitRelations.includes(relation.relation_id) ||
      explicitBehaviors.includes(relation.target_claim_id) ||
      explicitVerifications.includes(relation.source_claim_id))
  );
  const behaviorIds = [...new Set([
    ...explicitBehaviors,
    ...candidateRelations.map(({ target_claim_id: id }) => id).filter((id) =>
      claims.get(id)?.kind === "behavior")
  ])].sort(compare);
  const qualifying = [...new Set(candidateRelations.filter((relation) =>
    behaviorIds.includes(relation.target_claim_id) &&
    claims.get(relation.source_claim_id)?.kind === "verification" &&
    claims.get(relation.source_claim_id)?.verification_method === "test_execution"
  ).map(({ source_claim_id: id }) => id))].sort(compare);
  const relationIds = candidateRelations.filter((relation) =>
    behaviorIds.includes(relation.target_claim_id) &&
    qualifying.includes(relation.source_claim_id)
  ).map(({ relation_id: id }) => id).sort(compare);
  return { claims, explicitRelations, explicitVerifications, behaviorIds, qualifying, relationIds };
}

function applicableMandatoryBehaviors(row, contract, claims) {
  const named = new Set(row.controlled_contract_node_ids);
  return [...new Set((contract.collections ?? []).filter(({ collection_id: id,
    purpose, member_claim_ids: members = [] }) =>
    purpose === "mandatory_verify_proof_behaviors" &&
      (named.has(id) || members.some((member) => named.has(member)))
  ).flatMap(({ member_claim_ids: members = [] }) => members).filter((id) =>
    claims.get(id)?.kind === "behavior"
  ))].sort(compare);
}

function resolveProofObligationRuntime({
  obligationId,
  obligationCoverage,
  obligationCoverageDigest,
  controlledContract,
  contractDigest,
  contractGeneration,
  proofPlan,
  proofPlanDigest,
  declaredTargetProjection = null,
  postDeliveryPack = null
}) {
  if (typeof obligationId !== "string" || obligationId.length === 0) {
    throw new ProofObligationResolutionError(
      "verify_proof.obligation_id_invalid.v1", "obligation_id must be a non-empty string"
    );
  }
  const coverageValidation = validateObligationCoverageCarrier(obligationCoverage);
  if (!coverageValidation.valid) throw new ProofObligationResolutionError(
    "verify_proof.obligation_coverage_invalid.v1",
    "obligation coverage is invalid",
    { diagnostics: coverageValidation.diagnostics }
  );
  const contractValidation = validateStableTestProofContract(controlledContract);
  const contractDiagnostics = contractValidation.diagnostics?.diagnostics ?? [];
  const onlyDeferredBindingDiagnostics = contractDiagnostics.length > 0 &&
    contractDiagnostics.every(({ code }) => DEFERRED_BINDING_DIAGNOSTICS.has(code));
  if (!contractValidation.valid && !onlyDeferredBindingDiagnostics) {
    throw new ProofObligationResolutionError(
    "verify_proof.controlled_contract_invalid.v1",
    "controlled contract is invalid",
    { diagnostics: contractValidation.diagnostics }
    );
  }
  const coverageDigest = assertDigest(
    "obligation_coverage", obligationCoverage, obligationCoverageDigest
  );
  const resolvedContractDigest = assertDigest("controlled_contract", controlledContract,
    contractDigest);
  const resolvedProofPlanDigest = assertDigest("proof_plan", proofPlan, proofPlanDigest);
  if (!/^sha256:[0-9a-f]{64}$/u.test(contractGeneration ?? "")) {
    throw new ProofObligationResolutionError(
      "verify_proof.contract_generation_invalid.v1",
      "contract generation must be an exact sha256 identity"
    );
  }
  const rows = obligationCoverage.obligations.filter(({ obligation_id: id }) =>
    id === obligationId);
  if (rows.length === 0) return notExecutable(obligationId, NOT_EXECUTABLE.OBLIGATION_UNKNOWN);
  if (rows.length !== 1) throw new ProofObligationResolutionError(
    "verify_proof.obligation_identity_ambiguous.v1",
    "obligation coverage contains a duplicate obligation identity",
    { obligation_id: obligationId, count: rows.length }
  );
  const row = rows[0];
  if (row.mechanism.kind !== "test") return notExecutable(
    obligationId, NOT_EXECUTABLE.OBLIGATION_NOT_TEST_BACKED,
    { mechanism_kind: row.mechanism.kind }
  );
  if (row.proof.kind !== "pack_mapping") return notExecutable(
    obligationId, NOT_EXECUTABLE.OBLIGATION_NOT_PACK_BACKED,
    { proof_kind: row.proof.kind }
  );
  const planEntries = planEntriesFor(row.proof, proofPlan);
  if (planEntries.length === 0) return notExecutable(
    obligationId, NOT_EXECUTABLE.PROOF_PLAN_ENTRY_MISSING);
  if (planEntries.length > 1) return notExecutable(
    obligationId, NOT_EXECUTABLE.PROOF_PLAN_ENTRY_AMBIGUOUS,
    { count: planEntries.length }
  );
  const graph = resolveBehaviorAndVerificationPopulation(row, controlledContract);
  if (graph.behaviorIds.length === 0) return notExecutable(
    obligationId, NOT_EXECUTABLE.BEHAVIOR_CLAIM_MISSING);
  const applicableMandatory = applicableMandatoryBehaviors(row, controlledContract, graph.claims);
  const missingMandatory = applicableMandatory.filter((id) => !graph.behaviorIds.includes(id));
  if (missingMandatory.length > 0) return notExecutable(
    obligationId, NOT_EXECUTABLE.MANDATORY_BEHAVIOR_COVERAGE_INCOMPLETE,
    { missing_behavior_claim_ids: missingMandatory }
  );
  if (graph.qualifying.length === 0) return notExecutable(
    obligationId, NOT_EXECUTABLE.QUALIFYING_VERIFICATION_MISSING);
  if (graph.qualifying.length > 1) return notExecutable(
    obligationId, NOT_EXECUTABLE.QUALIFYING_VERIFICATION_AMBIGUOUS,
    { verification_ids: graph.qualifying }
  );
  const verificationId = graph.qualifying[0];
  if (graph.explicitVerifications.length > 0 &&
      (graph.explicitVerifications.length !== 1 ||
       graph.explicitVerifications[0] !== verificationId)) {
    throw new ProofObligationResolutionError(
      "verify_proof.explicit_verification_disagreement.v1",
      "explicit verification nodes disagree with the derived verification",
      { explicit: graph.explicitVerifications, derived: verificationId }
    );
  }
  if (graph.explicitRelations.some((id) => !graph.relationIds.includes(id))) {
    throw new ProofObligationResolutionError(
      "verify_proof.explicit_relation_disagreement.v1",
      "explicit relation nodes disagree with qualifying verifies relations",
      { explicit: graph.explicitRelations, derived: graph.relationIds }
    );
  }
  const proofBindings = controlledContract.test_proofs.filter(
    ({ verification_claim_id: id }) => id === verificationId);
  if (proofBindings.length === 0) return notExecutable(
    obligationId, NOT_EXECUTABLE.TEST_PROOF_BINDING_MISSING,
    { verification_id: verificationId }
  );
  if (proofBindings.length > 1) return notExecutable(
    obligationId, NOT_EXECUTABLE.TEST_PROOF_BINDING_AMBIGUOUS,
    { verification_id: verificationId, count: proofBindings.length }
  );
  const readiness = classifyStableTestProofRuntimeReadiness(proofBindings[0]);
  if (readiness.status !== "ready") return notExecutable(
    obligationId,
    RUNTIME_READINESS_REASON_CODES[readiness.reason],
    runtimeReadinessDetails(readiness, verificationId),
    { verification_id: verificationId },
    "mechanical_failure"
  );
  if (declaredTargetProjection?.status === "refused") {
    throw new ProofObligationResolutionError(
      "verify_proof.declared_target_integrity_refused.v1",
      "declared target projection failed an integrity binding",
      { verification_id: verificationId,
        diagnostics: structuredClone(declaredTargetProjection.diagnostics ?? []) }
    );
  }
  if (declaredTargetProjection?.status !== "resolved") return notExecutable(
    obligationId,
    declaredTargetProjection?.status === "ambiguous"
      ? (declaredTargetProjection.reason_code ?? NOT_EXECUTABLE.DECLARED_TARGET_AMBIGUOUS)
      : (declaredTargetProjection?.reason_code ?? NOT_EXECUTABLE.DECLARED_TARGET_MISSING),
    { target_projection_status: declaredTargetProjection?.status ?? "absent" },
    { verification_id: verificationId }
  );
  if (declaredTargetProjection.verification_id !== verificationId) {
    throw new ProofObligationResolutionError(
      "verify_proof.declared_target_verification_mismatch.v1",
      "declared target is bound to a different verification",
      { expected: verificationId, actual: declaredTargetProjection.verification_id }
    );
  }
  if (postDeliveryPack === null) return notExecutable(
    obligationId, NOT_EXECUTABLE.POST_DELIVERY_PACK_UNAVAILABLE);
  assertAdmittedProofPackSnapshot(postDeliveryPack);
  if (postDeliveryPack.profile?.profile_id !== row.proof.profile_id ||
      postDeliveryPack.profile?.evaluation_stages?.includes("post_delivery") !== true) {
    throw new ProofObligationResolutionError(
      "verify_proof.post_delivery_pack_binding_mismatch.v1",
      "resolved post-delivery pack does not match the obligation profile and stage",
      { profile_id: row.proof.profile_id }
    );
  }
  const proofPlanEntry = structuredClone(planEntries[0]);
  return deepFreeze({
    schema_version: RESOLUTION_SCHEMA_VERSION,
    status: "executable",
    authority: "non_authoritative",
    obligation_id: obligationId,
    obligation: structuredClone(row),
    contract_generation: contractGeneration,
    contract_digest: resolvedContractDigest,
    obligation_coverage_digest: coverageDigest,
    proof_plan_digest: resolvedProofPlanDigest,
    proof_plan_entry: proofPlanEntry,
    proof_plan_entry_digest: canonicalDigest(proofPlanEntry),
    behavior_claim_ids: graph.behaviorIds,
    verification_id: verificationId,
    relation_ids: graph.relationIds,
    test_proof: structuredClone(proofBindings[0]),
    declared_target: structuredClone(declaredTargetProjection),
    post_delivery_pack: postDeliveryPack
  });
}

function digestIdentity(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function exactCaptureIdentity(entry) {
  const binding = entry?.exact_binding;
  if (binding === null || binding === undefined) return null;
  const captureRootDigest = digestIdentity(
    binding.capture_root_digest ?? binding.root_digest ?? binding.exact_capture_root_digest
  );
  const sourcesDigest = digestIdentity(
    binding.sources_digest ?? binding.exact_sources_digest
  );
  if (captureRootDigest === null || sourcesDigest === null) {
    throw new ProofObligationResolutionError(
      "verify_proof.exact_capture_binding_incomplete.v1",
      "conditional exact-capture binding is missing its root or source identity"
    );
  }
  return { capture_root_digest: captureRootDigest, sources_digest: sourcesDigest };
}

function buildProofVerificationResult({ resolution, semanticFacts, evaluation }) {
  if (resolution?.status !== "executable" || semanticFacts?.status !== "facts" ||
      !["satisfied", "unsatisfied"].includes(evaluation?.satisfaction)) {
    throw new ProofObligationResolutionError(
      "verify_proof.result_input_invalid.v1",
      "a verification result requires executable resolution, semantic facts, and exact evaluation"
    );
  }
  const pack = resolution.post_delivery_pack;
  assertAdmittedProofPackSnapshot(pack);
  const evaluator = pack?.test_validity_evaluator;
  if (pack?.evaluation_stage !== "post_delivery" || evaluator?.status !== "resolved") {
    throw new ProofObligationResolutionError(
      "verify_proof.result_pack_identity_invalid.v1",
      "a verification result requires the exact admitted post-delivery evaluator"
    );
  }
  const admission = pack.admission;
  const proofInstance = {
    contract_generation: resolution.contract_generation,
    contract_digest: resolution.contract_digest,
    obligation_coverage_digest: resolution.obligation_coverage_digest,
    proof_plan_digest: resolution.proof_plan_digest,
    proof_plan_entry_digest: resolution.proof_plan_entry_digest,
    profile: {
      profile_id: pack.profile.profile_id,
      profile_version: pack.profile.profile_version,
      digest: digestIdentity(pack.profile_digest)
    },
    admission: {
      schema_version: admission.schema_version,
      digest: digestIdentity(pack.admission_digest)
    },
    certification: structuredClone(pack.certification_identity),
    guarantee: { digest: digestIdentity(admission.guarantee_digest) },
    evaluation_stage: "post_delivery",
    exact_capture: exactCaptureIdentity(resolution.proof_plan_entry),
    behavior_claim_ids: [...resolution.behavior_claim_ids],
    verification_id: resolution.verification_id,
    relation_ids: [...resolution.relation_ids],
    declared_target: {
      target_id: resolution.declared_target.target_id,
      operation: resolution.declared_target.operation,
      target: resolution.declared_target.target,
      unit: resolution.declared_target.unit,
      controlled_contract_generation:
        resolution.declared_target.controlled_contract_generation,
      source_snapshot_digest: resolution.declared_target.source_snapshot_digest
    },
    test_proof_id: resolution.test_proof.test_proof_id,
    evaluator: {
      registry_id: evaluator.registry_id,
      registry_version: evaluator.registry_version,
      implementation_id: evaluator.implementation_id,
      implementation_version: evaluator.implementation_version,
      implementation_digest: evaluator.implementation_digest
    },
    candidate: structuredClone(semanticFacts.execution_identity.candidate),
    receipt_population: structuredClone(semanticFacts.receipt_population)
  };
  const body = {
    schema_version: "controlled-contract-proof-verification-result.v1",
    status: evaluation.satisfaction,
    authority: "non_authoritative",
    obligation_id: resolution.obligation_id,
    reason_code: null,
    diagnostics: structuredClone(evaluation.diagnostics ?? []),
    proof_instance: proofInstance
  };
  return deepFreeze({ ...body, result_digest: canonicalDigest(body) });
}

function buildNotExecutableProofVerificationResult({ obligationId, reasonCode,
  diagnostics = [] }) {
  const body = {
    schema_version: "controlled-contract-proof-verification-result.v1",
    status: "not_executable",
    authority: "non_authoritative",
    obligation_id: obligationId,
    reason_code: reasonCode,
    diagnostics: structuredClone(diagnostics),
    proof_instance: null
  };
  return deepFreeze({ ...body, result_digest: canonicalDigest(body) });
}

export {
  NOT_EXECUTABLE as PROOF_OBLIGATION_NOT_EXECUTABLE_CODES,
  ProofObligationResolutionError,
  RESOLUTION_SCHEMA_VERSION as PROOF_OBLIGATION_RESOLUTION_SCHEMA_VERSION,
  buildNotExecutableProofVerificationResult,
  buildProofVerificationResult,
  canonicalDigest as canonicalProofVerificationDigest,
  resolveProofObligationRuntime
};
