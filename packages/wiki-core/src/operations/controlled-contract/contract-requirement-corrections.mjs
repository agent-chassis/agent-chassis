

import {
  CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS,
  ControlledContractToolError
} from "../../lib/controlled-contract-tools.mjs";

const DEPENDENCY_DETAIL_LIMIT = 32;

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, { changed: false, ...details });
}

const retirementGuidance = () =>
  [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.requirement_retirement];

export function requirementCorrectionTargets(contract, requirements) {
  const claims = new Map((contract?.claims ?? []).map((claim) =>
    [claim.claim_id, claim]));
  const targets = new Map();
  for (const [index, requirement] of requirements.entries()) {
    const target = requirement?.replace_claim_id;
    if (target === undefined) continue;
    const claim = claims.get(target);
    if (claim === undefined || claim.kind === "verification") fail(
      "controlled_contract_requirement_correction_target_invalid",
      `requirements[${index}].replace_claim_id does not select a stored requirement claim`,
      { field: `requirements[${index}].replace_claim_id`, replace_claim_id: target });
    if (targets.has(target)) fail(
      "controlled_contract_requirement_correction_conflicting",
      "one upsert cannot correct the same stored requirement twice",
      { replace_claim_id: target, requirement_indexes: [targets.get(target), index] });
    targets.set(target, index);
  }
  return targets;
}

export function requirementRetirementTargets(contract, retireClaimIds, correctionTargets) {
  const claims = new Map((contract?.claims ?? []).map((claim) => [claim.claim_id, claim]));
  const targets = new Map();
  for (const [index, claimId] of retireClaimIds.entries()) {
    const identity = { field: `retire_claim_ids[${index}]`, retire_claim_id: claimId,
      guidance_path: retirementGuidance() };
    const claim = claims.get(claimId);
    if (claim === undefined || claim.kind === "verification") fail(
      "controlled_contract_requirement_correction_target_invalid",
      `${identity.field} does not select a stored requirement claim`, identity);
    if (targets.has(claimId)) fail("controlled_contract_requirement_correction_conflicting",
      "one upsert cannot retire the same stored requirement twice",
      { ...identity, retire_indexes: [targets.get(claimId), index] });
    if (correctionTargets.has(claimId)) fail("controlled_contract_requirement_correction_conflicting",
      "one upsert cannot both replace and retire the same stored requirement",
      { ...identity, requirement_index: correctionTargets.get(claimId) });
    targets.set(claimId, index);
  }
  return targets;
}

function correctionFacts(content, compiled, targets, retireTargets) {
  const retiredRequirements = new Set([...[...targets]
    .filter(([claimId, index]) => compiled[index].claim_id !== claimId)
    .map(([claimId]) => claimId), ...retireTargets.keys()]);
  const compiledClaims = new Set(compiled.map((entry) => entry.claim_id));
  const verifies = content.relations.filter((relation) => relation.role === "verifies");
  const replacedEdges = new Set(verifies.filter((relation) => [...targets].some(([claimId, index]) =>
    relation.target_claim_id === claimId &&
    relation.source_claim_id !== compiled[index].verification_claim_id))
    .map((relation) => relation.relation_id));
  const liveTargets = new Map();
  for (const relation of verifies) {
    if (retiredRequirements.has(relation.target_claim_id) || replacedEdges.has(relation.relation_id)) continue;
    const targetsOf = liveTargets.get(relation.source_claim_id) ?? new Set();
    targetsOf.add(relation.target_claim_id);
    liveTargets.set(relation.source_claim_id, targetsOf);
  }
  const retiredVerifications = new Set();
  const corrections = [...targets].sort(([, left], [, right]) => left - right)
    .map(([priorClaimId, index]) => {
      const entry = compiled[index];
      const priorVerificationIds = [...new Set(verifies
        .filter((relation) => relation.target_claim_id === priorClaimId)
        .map((relation) => relation.source_claim_id))].sort();
      const retired = [];
      const surviving = [];
      for (const verificationId of priorVerificationIds) {
        const live = [...(liveTargets.get(verificationId) ?? [])];
        if (entry.verification_claim_id === verificationId) {
          surviving.push(verificationId);
        } else if (live.length === 0) {
          retired.push(verificationId);
          retiredVerifications.add(verificationId);
        } else {
          const unselected = live.filter((claimId) => !compiledClaims.has(claimId)).sort();
          if (unselected.length > 0) fail(
            "controlled_contract_requirement_correction_shared_verification",
            `requirements[${index}] would stop verifying its replacement with a verification that still serves another requirement`,
            { field: `requirements[${index}].replace_claim_id`, requirement_index: index,
              replace_claim_id: priorClaimId, verification_id: verificationId,
              requirement_claim_ids: unselected,
              guidance_path: [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.requirement_rebinding] });
          surviving.push(verificationId);
        }
      }
      return Object.freeze({
        requirement_index: index,
        prior_claim_id: priorClaimId,
        claim_id: entry.claim_id,
        verification_claim_id: entry.verification_claim_id,
        requirement_retired: retiredRequirements.has(priorClaimId),
        prior_verification_ids: Object.freeze(priorVerificationIds),
        retired_verification_ids: Object.freeze(retired),
        surviving_verification_ids: Object.freeze(surviving)
      });
    });
  const retirements = [...retireTargets].sort(([, left], [, right]) => left - right)
    .map(([claimId, index]) => {
      const priorVerificationIds = [...new Set(verifies
        .filter((relation) => relation.target_claim_id === claimId)
        .map((relation) => relation.source_claim_id))].sort();
      const retired = priorVerificationIds.filter((verificationId) =>
        (liveTargets.get(verificationId)?.size ?? 0) === 0);
      for (const verificationId of retired) retiredVerifications.add(verificationId);
      return Object.freeze({
        retire_index: index,
        claim_id: claimId,
        prior_verification_ids: Object.freeze(priorVerificationIds),
        retired_verification_ids: Object.freeze(retired),
        surviving_verification_ids: Object.freeze(priorVerificationIds
          .filter((verificationId) => !retired.includes(verificationId)))
      });
    });
  return { retiredRequirements, retiredVerifications, replacedEdges,
    corrections: Object.freeze(corrections), retirements: Object.freeze(retirements) };
}

function assertNoRetainedRetirementDependencies(content, removedClaims, retirements) {
  const retiring = new Set(retirements.flatMap((fact) =>
    [fact.claim_id, ...fact.retired_verification_ids]));
  const dependencies = [
    ...content.relations.filter((relation) => relation.role !== "verifies" &&
      [relation.source_claim_id, relation.target_claim_id].some((id) => retiring.has(id)) &&
      [relation.source_claim_id, relation.target_claim_id].some((id) => !removedClaims.has(id)))
      .map(({ relation_id, role, source_claim_id, target_claim_id }) => ({ kind: "relation",
        relation_id, role, source_claim_id, target_claim_id,
        retired_claim_ids: [source_claim_id, target_claim_id].filter((id) => retiring.has(id)) })),
    ...(content.collections ?? []).filter((collection) =>
      collection.member_claim_ids.some((id) => retiring.has(id)))
      .map(({ collection_id, collection_kind, member_claim_ids }) => ({ kind: "collection",
        collection_id, collection_kind,
        retired_claim_ids: [...new Set(member_claim_ids.filter((id) => retiring.has(id)))].sort() }))
  ];
  if (dependencies.length === 0) return;
  const retiredClaimIds = [...new Set(dependencies.flatMap((entry) => entry.retired_claim_ids))].sort();
  const selection = retirements.find((fact) => retiredClaimIds.some((id) =>
    id === fact.claim_id || fact.retired_verification_ids.includes(id)));
  fail("controlled_contract_requirement_retirement_dependency_conflict",
    "a retained relation or collection still names a claim this retirement removes",
    { field: `retire_claim_ids[${selection.retire_index}]`, retire_claim_id: selection.claim_id,
      retired_claim_ids: retiredClaimIds, dependency_count: dependencies.length,
      dependencies: dependencies.slice(0, DEPENDENCY_DETAIL_LIMIT), guidance_path: retirementGuidance() });
}

export function applyRequirementCorrections(content, requirements, compiled, targets,
  retainedReferenceIds, retireTargets = new Map()) {
  for (const [index, entry] of compiled.entries()) {
    if (retireTargets.has(entry.claim_id)) fail("controlled_contract_requirement_correction_conflicting",
      `requirements[${index}] compiles a requirement this upsert retires`,
      { field: `retire_claim_ids[${retireTargets.get(entry.claim_id)}]`, retire_claim_id: entry.claim_id,
        requirement_index: index, guidance_path: retirementGuidance() });
  }
  const { retiredRequirements, retiredVerifications, replacedEdges, corrections, retirements } =
    correctionFacts(content, compiled, targets, retireTargets);
  const removedClaims = new Set([...retiredRequirements, ...retiredVerifications]);
  if (removedClaims.size === 0 && replacedEdges.size === 0) return { content, corrections, retirements };
  assertNoRetainedRetirementDependencies(content, removedClaims, retirements);
  content.claims = content.claims.filter((claim) => !removedClaims.has(claim.claim_id));
  content.relations = content.relations.filter((relation) =>
    !replacedEdges.has(relation.relation_id) &&
    !removedClaims.has(relation.source_claim_id) &&
    !removedClaims.has(relation.target_claim_id));
  content.test_proofs = content.test_proofs.filter((proof) =>
    !removedClaims.has(proof.verification_claim_id));
  const usedPropositions = new Set(content.claims.flatMap((claim) => [
    claim.proposition_id, claim.falsifying_proposition_id
  ].filter(Boolean)));
  content.propositions = content.propositions.filter((proposition) =>
    usedPropositions.has(proposition.proposition_id));
  const usedReferences = new Set(retainedReferenceIds);
  for (const proposition of content.propositions) {
    usedReferences.add(proposition.subject_reference_id);
    for (const id of proposition.applicability_context?.operand_reference_ids ?? []) {
      usedReferences.add(id);
    }
    for (const operand of proposition.operands ?? []) {
      if (operand.kind === "reference") usedReferences.add(operand.reference_id);
    }
  }
  for (const proof of content.test_proofs) {
    for (const id of proof.system_under_test_boundary?.subject_reference_ids ?? []) {
      usedReferences.add(id);
    }
  }
  content.references = content.references.filter((reference) =>
    usedReferences.has(reference.reference_id));
  return { content, corrections, retirements };
}
