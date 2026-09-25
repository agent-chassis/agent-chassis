function frozen(value) {
  return Object.freeze(value);
}

export function classifyControlledContractRuntimeEligibility(contract,
  obligationCoverage) {
  const claims = new Map((contract.claims ?? []).map((claim) =>
    [claim.claim_id, claim]));
  const proofs = new Map();
  for (const proof of contract.test_proofs ?? []) {
    const values = proofs.get(proof.verification_claim_id) ?? [];
    values.push(proof);
    proofs.set(proof.verification_claim_id, values);
  }
  const currentObligationIds = new Set(
    (obligationCoverage?.authoringApplicability?.selection_relationships ?? [])
      .map(({ obligation_id: obligationId }) => obligationId)
  );
  const population = (obligationCoverage?.rows ?? []).map((obligation) => {
    const proofKind = obligation.selection ? 'saved_selection' : null;
    const mappingClassification = proofKind === "saved_selection" ? "mapped" : "invalid";
    const common = {
      obligation_id: obligation.obligation_id,
      mechanism_kind: obligation.mechanism?.kind ?? null,
      proof_kind: proofKind,
      mapping_classification: mappingClassification,
      mapping_reason_code: null
    };
    if (obligation.design_status !== 'valid') return frozen({
      ...common, verification_id: null, classification: 'unresolved',
      reason_code: obligation.diagnostics?.[0]?.code ?? 'obligation_coverage_design_invalid',
      verification_method: null
    });
    if (proofKind !== "saved_selection") return frozen({
      ...common,
      verification_id: null,
      classification: "non_runtime",
      reason_code: "obligation_proof_disposition_non_runtime",
      verification_method: null
    });
    if (obligationCoverage?.sourceCurrent !== true ||
        !currentObligationIds.has(obligation.obligation_id)) return frozen({
      ...common,
      verification_id: null,
      classification: "conflicting",
      reason_code: "controlled_contract_runtime_eligibility_mapping_not_current",
      verification_method: null
    });
    const verificationIds = new Set(obligation.controlled_contract_node_ids ?? []);
    for (const relation of contract.relations ?? []) if (relation.role === 'verifies' &&
        verificationIds.has(relation.target_claim_id)) verificationIds.add(relation.source_claim_id);
    const verificationClaims = [...verificationIds]
      .map((id) => claims.get(id))
      .filter((claim) => claim?.kind === "verification");
    if (verificationClaims.length !== 1) return frozen({
      ...common,
      verification_id: verificationClaims[0]?.claim_id ?? null,
      classification: "conflicting",
      reason_code: verificationClaims.length === 0
        ? "obligation_verification_claim_missing"
        : "obligation_verification_claim_ambiguous",
      verification_method: null
    });
    const [claim] = verificationClaims;
    const contractRuntime = claim.verification_method === "test_execution";

    const authoredMechanismKind = obligation.mechanism?.kind ?? null;
    const workRecordRuntime = authoredMechanismKind === null
      ? contractRuntime : authoredMechanismKind === "test";
    if (contractRuntime !== workRecordRuntime) return frozen({
      ...common,
      verification_id: claim.claim_id,
      classification: "conflicting",
      reason_code: "controlled_contract_cross_owner_verification_method_conflict",
      verification_method: claim.verification_method
    });
    const proofBindings = proofs.get(claim.claim_id) ?? [];
    if (contractRuntime && proofBindings.length > 1) return frozen({
      ...common,
      verification_id: claim.claim_id,
      classification: "conflicting",
      reason_code: "runtime_test_proof_binding_ambiguous",
      verification_method: claim.verification_method,
      proof_binding_count: proofBindings.length
    });
    return frozen({
      ...common,
      verification_id: claim.claim_id,
      classification: contractRuntime ? "runtime" : "non_runtime",
      reason_code: contractRuntime ? "runtime_test_proof_required"
        : "controlled_contract_verification_method_non_runtime",
      verification_method: claim.verification_method,
      test_proof_id: proofBindings[0]?.test_proof_id ?? null,
      proof_binding_count: proofBindings.length
    });
  });

  for (const proof of contract.test_proofs ?? []) {
    if (population.some(row => row.verification_id === proof.verification_claim_id)) continue;
    population.push(frozen({ obligation_id: null,
      verification_id: proof.verification_claim_id, test_proof_id: proof.test_proof_id,
      classification: 'unresolved', mapping_classification: 'unresolved',

      reason_code: obligationCoverage?.source == null ? 'obligation_coverage_source_not_found'
        : (obligationCoverage.rows ?? []).length === 0 &&
          obligationCoverage.resolution?.mapping === null
          ? 'obligation_coverage_resolution_required'
          : 'runtime_proof_obligation_missing',
      verification_method: claims.get(proof.verification_claim_id)?.verification_method ?? null,
      proof_binding_count: proofs.get(proof.verification_claim_id).length }));
  }
  return frozen(population);
}

export function resolveControlledContractDeclarationPopulation(bindings, obligationCoverage, eligibility) {
  const declaredVerificationIds = [...new Set(bindings.map(binding => binding.verification_claim_id))];
  const applicability = eligibility ?? declaredVerificationIds.flatMap(verificationId => {
    const matches = (obligationCoverage?.rows ?? []).filter(obligation =>
      obligation.selection != null && obligation.design_status === 'valid' &&
      obligation.controlled_contract_node_ids?.includes(verificationId));
    return matches.length === 0 ? [{ verification_id: verificationId,
      obligation_id: null, classification: 'unresolved',
      reason_code: 'runtime_proof_obligation_missing' }] : matches.map(match => ({
      verification_id: verificationId, obligation_id: match.obligation_id,
      classification: 'runtime', reason_code: 'runtime_test_proof_required'
    }));
  });
  const population = bindings.flatMap(binding => {
    const matches = applicability.filter(entry => entry.verification_id === binding.verification_claim_id);
    const relationships = matches.length === 0 ? [{
      obligation_id: null, verification_id: binding.verification_claim_id,
      classification: 'unresolved', reason_code: 'runtime_proof_obligation_missing'
    }] : matches;
    return relationships.map(relationship => ({ ...relationship,
      test_proof_id: binding.test_proof_id, binding }));
  });

  population.push(...applicability.filter(entry => !bindings.some(binding =>
    binding.verification_claim_id === entry.verification_id)));
  return { applicability, population };
}
