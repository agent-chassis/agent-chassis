import { createHash } from "node:crypto";

import { assertProofAuthoringDraft } from "./proof-contract.mjs";
import { resolveBehaviorAndVerificationPopulation, applicableMandatoryBehaviors, createNativeVerificationIndex, resolveNativeProofBinding } from "./proof-native-verification-graph.mjs";
import {
  projectStableTestProofSelector,
  validateNativeTestProofAuthoringContract, resolveStableTestProofProviderBindings
} from "./test-proof-contract-v1.mjs";
import {
  isTestProofSourcePath,
  testProofProviderFamily,
  testProofSelectorKind
} from "./test-proof-provider-registry.mjs";
import { assertAdmittedProofPackSnapshot } from "./admitted-proof-packs.mjs";

const RESOLUTION_SCHEMA_VERSION = "controlled-contract-proof-obligation-resolution.v3";
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
  TEST_SELECTOR_INVALID: "verify_proof.test_selector_invalid.v1",
  TEST_PROOF_BINDING_SOURCE_PATH_INCOMPATIBLE:
    "verify_proof.test_proof_binding_source_path_incompatible.v1",
  DECLARED_TARGET_MISSING: "verify_proof.declared_target_missing.v1",
  DECLARED_TARGET_AMBIGUOUS: "verify_proof.declared_target_ambiguous.v1",
  EXECUTION_PACK_UNAVAILABLE: "verify_proof.execution_pack_unavailable.v1"
});
const PACK_BINDING = Object.freeze({
  EXECUTION_MISMATCH: "verify_proof.execution_pack_binding_mismatch.v1"
});

class ProofObligationResolutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProofObligationResolutionError";
    this.code = code;
    this.details = { authority_limb: "mechanical_failure", ...structuredClone(details) };
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

function incompatibleTestProofSourcePaths(proof) {
  const selectorKind = testProofSelectorKind(proof?.test_selector);
  const family = testProofProviderFamily(selectorKind);
  if (family === null) return [];
  const declared = [
    ...(proof.falsifiers ?? []).map((falsifier, index) => ({
      pointer: `/falsifiers/${index}/mutation/module_path`,
      module_path: falsifier?.mutation?.module_path
    })),
    ...(proof.system_under_test_boundary?.kind === "module" ? [{
      pointer: "/system_under_test_boundary/runtime_module_path",
      module_path: proof.system_under_test_boundary.runtime_module_path
    }] : [])
  ];
  return declared
    .filter(({ module_path: modulePath }) => modulePath !== undefined &&
      !isTestProofSourcePath(selectorKind, modulePath))
    .map((row) => ({ ...row, source_suffixes: [...family.source_suffixes] }));
}

function notExecutable(obligationId, reasonCode, details = {}, identity = {},
  authorityLimb = "mechanical_failure") {
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

function digestIdentity(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function assertTestValidityExecutionPack(pack) {
  assertAdmittedProofPackSnapshot(pack);
  if (pack.profile.profile_id !== "proof.verification.test-validity" ||
      pack.test_validity_evaluator?.implementation_id !==
        "proof.verification.test-validity.execution-evaluator") {
    throw new ProofObligationResolutionError(PACK_BINDING.EXECUTION_MISMATCH,
      "execution requires the exact admitted test-validity execution definition",
      { profile_id: pack.profile.profile_id, profile_version: pack.profile.profile_version });
  }
}

function packIdentity(pack) {
  return {
    profile_id: pack.profile.profile_id,
    profile_version: pack.profile.profile_version,
    profile_digest: digestIdentity(pack.profile_digest),
    admission_digest: digestIdentity(pack.admission_digest)
  };
}

function assertSelectedExecutionDefinition(selected, pack) {
  const actual = packIdentity(pack);
  if (selected?.proof_name !== actual.profile_id || selected.proof_version !== actual.profile_version ||
      digestIdentity(selected.profile_digest) !== actual.profile_digest ||
      digestIdentity(selected.admission_digest) !== actual.admission_digest ||
      selected.parameter_contract_digest !== pack.parameter_contract_digest) {
    throw new ProofObligationResolutionError(PACK_BINDING.EXECUTION_MISMATCH,
      "Saved selection does not identify the authenticated execution definition", { selected, actual });
  }
}

const PREPARED = new WeakSet();
export function prepareProofObligationRuntime({ wkId, focus = null, obligationCoverage,
  obligationCoverageDigest, controlledContract, contractDigest, contractGeneration }) {
  assertProofAuthoringDraft(obligationCoverage);
  const contractValidation = validateNativeTestProofAuthoringContract(controlledContract);
  if (!contractValidation.valid) {
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
  if (!/^sha256:[0-9a-f]{64}$/u.test(contractGeneration ?? "")) {
    throw new ProofObligationResolutionError(
      "verify_proof.contract_generation_invalid.v1",
      "contract generation must be an exact sha256 identity"
    );
  }
  if (obligationCoverage.wk_id !== wkId || obligationCoverage.focus !== focus) throw new ProofObligationResolutionError(
    "verify_proof.contract_generation_mismatch.v1", "Saved source tuple differs from the selected native contract");
  const prepared = Object.freeze({ wkId, focus, obligationCoverage, controlledContract,
    contractGeneration, coverageDigest, resolvedContractDigest,
    rows: new Map(obligationCoverage.obligations.map(row => [row.obligation_id, row])),
    nativeIndex: createNativeVerificationIndex(controlledContract) });
  PREPARED.add(prepared);
  return prepared;
}

function resolveProofObligationRuntime({ prepared, obligationId, resolvedRow, resolvedNode,
  executionSourceBinding, declaredTargetProjection = null, executionPack = null }) {
  if (!PREPARED.has(prepared)) throw new ProofObligationResolutionError(
    "verify_proof.server_context_unavailable.v1", "Native binding requires a prepared canonical population");
  const { controlledContract, contractGeneration, coverageDigest, resolvedContractDigest } = prepared;
  const row = prepared.rows.get(obligationId);
  if (!row) return notExecutable(obligationId, NOT_EXECUTABLE.OBLIGATION_UNKNOWN);

  if (resolvedRow?.selected_proof_assessment?.requirements?.test_execution_evidence !== "required") {
    return notExecutable(obligationId, NOT_EXECUTABLE.OBLIGATION_NOT_TEST_BACKED, {
      mechanism_kind: row.mechanism?.kind ?? null,
      test_execution_evidence: resolvedRow?.selected_proof_assessment?.requirements
        ?.test_execution_evidence ?? null
    });
  }
  const graph = resolveBehaviorAndVerificationPopulation(row, controlledContract, prepared.nativeIndex);
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
  const nativeBinding = resolveNativeProofBinding(graph, prepared.nativeIndex);
  if (nativeBinding?.proof) {
    try { resolveStableTestProofProviderBindings(nativeBinding.proof); }
    catch (error) {
      if (!error.code?.startsWith('stable_test_proof_') && !error.code?.startsWith('test_proof_provider_')) throw error;
      return notExecutable(obligationId, 'verify_proof.test_proof_binding_incomplete.v1',
        { owner_code: error.code, ...error.details });
    }
    const incompatible = incompatibleTestProofSourcePaths(nativeBinding.proof);
    if (incompatible.length > 0) return notExecutable(obligationId,
      NOT_EXECUTABLE.TEST_PROOF_BINDING_SOURCE_PATH_INCOMPATIBLE, {
        selector_kind: testProofSelectorKind(nativeBinding.proof.test_selector),
        incompatible_source_paths: incompatible
      });
  }

  if (nativeBinding.reason_code !== null) {
    const { proof, ...details } = nativeBinding;
    return notExecutable(obligationId, nativeBinding.reason_code, details);
  }
  const proofBindings = [nativeBinding.proof];

  try {
    projectStableTestProofSelector(proofBindings[0]);
  } catch (error) {
    return notExecutable(
      obligationId,
      NOT_EXECUTABLE.TEST_SELECTOR_INVALID,
      { verification_id: verificationId, package_code: error?.code ?? null,
        admissibility_effect: "none" },
      { verification_id: verificationId },
      "mechanical_failure"
    );
  }
  if (declaredTargetProjection?.status === "refused") {
    throw new ProofObligationResolutionError(
      "verify_proof.declared_target_integrity_refused.v1",
      "declared target projection failed an integrity binding",
      { obligation_id: obligationId, verification_id: verificationId, join_kind: "declared_target",
        arity: declaredTargetProjection.binding_count ?? null,
        diagnostics: structuredClone(declaredTargetProjection.diagnostics ?? []) }
    );
  }
  if (declaredTargetProjection?.status !== "resolved") return notExecutable(
    obligationId,
    declaredTargetProjection?.status === "ambiguous"
      ? (declaredTargetProjection.reason_code ?? NOT_EXECUTABLE.DECLARED_TARGET_AMBIGUOUS)
      : (declaredTargetProjection?.reason_code ?? NOT_EXECUTABLE.DECLARED_TARGET_MISSING),
    { target_projection_status: declaredTargetProjection?.status ?? "absent",
      arity: declaredTargetProjection?.reason_code === NOT_EXECUTABLE.DECLARED_TARGET_MISSING ? 0 : null,

      path: proofBindings[0].test_selector?.provider_id !== undefined
        ? "/cases/target" : "/acceptance/validation" },
    { verification_id: verificationId }
  );
  if (declaredTargetProjection.verification_id !== verificationId) {
    throw new ProofObligationResolutionError(
      "verify_proof.declared_target_verification_mismatch.v1",
      "declared target is bound to a different verification",
      { expected: verificationId, actual: declaredTargetProjection.verification_id }
    );
  }
  if (executionPack === null) return notExecutable(
    obligationId, NOT_EXECUTABLE.EXECUTION_PACK_UNAVAILABLE);
  assertTestValidityExecutionPack(executionPack);
  if (!resolvedRow?.resolved_identity || resolvedRow.input_status !== "valid" || !resolvedNode ||
      resolvedNode.identity !== resolvedRow.resolved_identity) return notExecutable(
    obligationId, "verify_proof.runtime_inputs_unavailable.v1", {
      resolved_node_identity: resolvedRow?.resolved_identity ?? null,
      diagnostics: resolvedRow?.diagnostics ?? []
    });
  if (resolvedNode.dependencies.length > 0) return notExecutable(obligationId,
    "verify_proof.runtime_dependency_unavailable.v1", { dependencies: resolvedNode.dependencies });
  const selected = resolvedRow.definition;
  assertSelectedExecutionDefinition(selected, executionPack);
  return deepFreeze({
    schema_version: RESOLUTION_SCHEMA_VERSION,
    status: "executable",
    authority: "non_authoritative",
    obligation_id: obligationId,
    obligation: structuredClone(row),
    contract_generation: contractGeneration,
    contract_digest: resolvedContractDigest,
    obligation_coverage_digest: coverageDigest,
    execution_source_binding: executionSourceBinding,
    ...(row.case_id ? { authored_case: executionSourceBinding.cases.find(definition => definition.case_id === row.case_id) } : {}),
    selected_definition: structuredClone(selected),
    resolved_node_identity: resolvedNode.identity,
    behavior_claim_ids: graph.behaviorIds,
    verification_id: verificationId,
    relation_ids: graph.relationIds,
    test_proof: structuredClone(proofBindings[0]),
    declared_target: structuredClone(declaredTargetProjection),
    execution_pack: executionPack
  });
}

function buildProofVerificationResult({ resolution, semanticFacts, evaluation }) {
  if (resolution?.status !== "executable" || semanticFacts?.status !== "facts" ||
      !["satisfied", "unsatisfied"].includes(evaluation?.satisfaction)) {
    throw new ProofObligationResolutionError(
      "verify_proof.result_input_invalid.v1",
      "a verification result requires executable resolution, semantic facts, and exact evaluation"
    );
  }
  const pack = resolution.execution_pack;
  assertTestValidityExecutionPack(pack);
  const evaluator = pack?.test_validity_evaluator;
  if (evaluator?.status !== "resolved") {
    throw new ProofObligationResolutionError(
      "verify_proof.result_pack_identity_invalid.v1",
      "a verification result requires the exact admitted execution evaluator"
    );
  }
  if (!resolution.selected_definition || !/^sha256:[0-9a-f]{64}$/u.test(resolution.execution_source_binding?.binding_digest ?? "") ||
      !/^[0-9a-f]{64}$/u.test(resolution.resolved_node_identity ?? "")) throw new ProofObligationResolutionError(
    "verify_proof.result_input_invalid.v1", "Results require the invocation saved-source binding");
  assertSelectedExecutionDefinition(resolution.selected_definition, pack);
  const admission = pack.admission;
  const proofInstance = {
    ...(resolution.authored_case ? { authored_case: structuredClone(resolution.authored_case) } : {}),
    contract_generation: resolution.contract_generation,
    contract_digest: resolution.contract_digest,
    obligation_coverage_digest: resolution.obligation_coverage_digest,
    execution_source_binding: resolution.execution_source_binding,
    selected_definition: resolution.selected_definition,
    resolved_node_identity: resolution.resolved_node_identity,
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
    schema_version: "controlled-contract-proof-verification-result.v3",
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
    schema_version: "controlled-contract-proof-verification-result.v3",
    status: "not_executable",
    authority: "non_authoritative",
    obligation_id: obligationId,
    reason_code: reasonCode,
    authority_limb: "mechanical_failure",
    diagnostics: structuredClone(diagnostics),
    proof_instance: null
  };
  return deepFreeze({ ...body, result_digest: canonicalDigest(body) });
}

export {
  assertTestValidityExecutionPack,
  NOT_EXECUTABLE as PROOF_OBLIGATION_NOT_EXECUTABLE_CODES,
  PACK_BINDING as PROOF_PACK_BINDING_REASON_CODES,
  ProofObligationResolutionError,
  RESOLUTION_SCHEMA_VERSION as PROOF_OBLIGATION_RESOLUTION_SCHEMA_VERSION,
  buildNotExecutableProofVerificationResult,
  buildProofVerificationResult,
  canonicalDigest as canonicalProofVerificationDigest,
  resolveProofObligationRuntime
};
