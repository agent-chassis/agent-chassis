const DEFAULT_MANDATORY_MODALITIES = Object.freeze(["MUST", "MUST_NOT"]);
const DEFAULT_ACYCLIC_ROLES = Object.freeze([
  "derives_from", "refines", "replaces", "depends_on", "precedes"
]);
const CLAIM_KINDS = Object.freeze(["behavior", "evidence", "verification"]);
const CLAIM_MODALITIES = Object.freeze(["MUST", "MUST_NOT", "SHOULD", "SHOULD_NOT", "MAY"]);

function compareIds(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  if (leftString < rightString) return -1;
  if (leftString > rightString) return 1;
  return 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareIds).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function compareDiagnostics(left, right) {
  const codeOrder = compareIds(left.code, right.code);
  if (codeOrder !== 0) return codeOrder;
  return compareIds(
    JSON.stringify(canonicalValue(left)),
    JSON.stringify(canonicalValue(right))
  );
}

function duplicateIds(entries, key) {
  const seen = new Set();
  const duplicates = new Set();
  for (const entry of entries) {
    const id = entry?.[key];
    if (typeof id !== "string" || id.length === 0) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort(compareIds);
}

function findCycles(relations, roles, knownClaimIds) {
  const adjacency = new Map([...knownClaimIds].map((id) => [id, []]));
  for (const relation of relations) {
    if (!roles.has(relation.role)) continue;
    if (!knownClaimIds.has(relation.source_claim_id)) continue;
    if (!knownClaimIds.has(relation.target_claim_id)) continue;
    const [from, to] = relation.role === "depends_on"
      ? [relation.target_claim_id, relation.source_claim_id]
      : [relation.source_claim_id, relation.target_claim_id];
    adjacency.get(from).push(to);
  }
  for (const targets of adjacency.values()) targets.sort(compareIds);

  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = new Map();

  function visit(id) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const canonical = [...new Set(cycle.slice(0, -1))].sort(compareIds).join("\u0000");
      cycles.set(canonical, cycle);
      return;
    }
    if (visited.has(id)) return;

    visiting.add(id);
    stack.push(id);
    for (const target of adjacency.get(id) ?? []) visit(target);
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of [...knownClaimIds].sort(compareIds)) visit(id);
  return [...cycles.values()].sort((left, right) =>
    compareIds(left.join("\u0000"), right.join("\u0000"))
  );
}

function resolveNativeContractDag(contract, options = {}) {
  const claims = Array.isArray(contract?.claims) ? contract.claims : [];
  const relations = Array.isArray(contract?.relations) ? contract.relations : [];
  const collections = Array.isArray(contract?.collections) ? contract.collections : [];
  const mandatoryModalities = new Set(
    options.mandatory_modalities ?? DEFAULT_MANDATORY_MODALITIES
  );
  const acyclicRoles = new Set(options.acyclic_roles ?? DEFAULT_ACYCLIC_ROLES);
  const diagnostics = [];

  if (claims.length === 0) diagnostics.push({ code: "empty_contract" });

  for (const claimId of duplicateIds(claims, "claim_id")) {
    diagnostics.push({ code: "duplicate_claim_id", claim_id: claimId });
  }
  for (const relationId of duplicateIds(relations, "relation_id")) {
    diagnostics.push({ code: "duplicate_relation_id", relation_id: relationId });
  }
  for (const collectionId of duplicateIds(collections, "collection_id")) {
    diagnostics.push({ code: "duplicate_collection_id", collection_id: collectionId });
  }

  const claimById = new Map();
  for (const [index, claim] of claims.entries()) {
    if (typeof claim?.claim_id !== "string" || claim.claim_id.length === 0) {
      diagnostics.push({ code: "missing_claim_id", claim_index: index });
      continue;
    }
    if (!claimById.has(claim.claim_id)) claimById.set(claim.claim_id, claim);
    if (!CLAIM_KINDS.includes(claim.kind)) {
      diagnostics.push({
        code: "invalid_claim_kind",
        claim_id: claim.claim_id,
        actual_kind: claim.kind ?? null
      });
    }
    if (!CLAIM_MODALITIES.includes(claim.modality)) {
      diagnostics.push({
        code: "invalid_claim_modality",
        claim_id: claim.claim_id,
        actual_modality: claim.modality ?? null
      });
    }
  }

  const validVerifiesRelations = [];
  const qualifyingVerifiesRelations = [];
  const supplementaryVerifiesRelations = [];
  for (const [index, relation] of relations.entries()) {
    const relationId = relation?.relation_id ?? `relation-index-${index}`;
    const source = claimById.get(relation?.source_claim_id);
    const target = claimById.get(relation?.target_claim_id);

    if (!source) {
      diagnostics.push({
        code: "dangling_relation_source",
        relation_id: relationId,
        source_claim_id: relation?.source_claim_id ?? null
      });
    }
    if (!target) {
      diagnostics.push({
        code: "dangling_relation_target",
        relation_id: relationId,
        target_claim_id: relation?.target_claim_id ?? null
      });
    }
    if (!source || !target || relation?.role !== "verifies") continue;

    if (source.kind !== "verification") {
      diagnostics.push({
        code: "verifies_source_type_mismatch",
        relation_id: relationId,
        source_claim_id: source.claim_id,
        actual_kind: source.kind ?? null
      });
      continue;
    }
    if (target.kind !== "behavior") {
      diagnostics.push({
        code: "verifies_target_type_mismatch",
        relation_id: relationId,
        target_claim_id: target.claim_id,
        actual_kind: target.kind ?? null
      });
      continue;
    }
    validVerifiesRelations.push(relation);
    if (source.modality === "MUST") qualifyingVerifiesRelations.push(relation);
    else supplementaryVerifiesRelations.push(relation);
  }

  const knownClaimIds = new Set(claimById.keys());
  for (const cycle of findCycles(relations, acyclicRoles, knownClaimIds)) {
    diagnostics.push({ code: "relation_cycle", claim_path: cycle });
  }

  const verifiedBehaviorIds = new Set(
    qualifyingVerifiesRelations.map((relation) => relation.target_claim_id)
  );
  const traceablyVerifiedBehaviorIds = new Set(
    validVerifiesRelations.map((relation) => relation.target_claim_id)
  );
  const attachedVerificationIds = new Set(
    qualifyingVerifiesRelations.map((relation) => relation.source_claim_id)
  );
  const mandatoryBehaviorIds = [...claimById.values()]
    .filter((claim) => claim.kind === "behavior" && mandatoryModalities.has(claim.modality))
    .map((claim) => claim.claim_id)
    .sort(compareIds);
  const uncoveredMandatoryBehaviorIds = mandatoryBehaviorIds
    .filter((claimId) => !verifiedBehaviorIds.has(claimId));

  for (const claimId of uncoveredMandatoryBehaviorIds) {
    diagnostics.push({ code: "mandatory_behavior_unverified", claim_id: claimId });
  }
  const unattachedMandatoryVerificationIds = [...claimById.values()]
    .filter((claim) =>
      claim.kind === "verification" && claim.modality === "MUST" &&
      !attachedVerificationIds.has(claim.claim_id)
    )
    .map((claim) => claim.claim_id)
    .sort(compareIds);
  for (const claimId of unattachedMandatoryVerificationIds) diagnostics.push({
    code: "mandatory_verification_unattached",
    claim_id: claimId
  });

  const collectionCoverage = [];
  for (const collection of collections) {
    const collectionId = collection.collection_id ?? null;
    const members = Array.isArray(collection.member_claim_ids)
      ? collection.member_claim_ids
      : [];
    const duplicateMembers = members.filter((id, index) => members.indexOf(id) !== index);
    for (const memberId of [...new Set(duplicateMembers)].sort(compareIds)) {
      diagnostics.push({
        code: "duplicate_collection_member",
        collection_id: collectionId,
        claim_id: memberId
      });
    }

    const missingMembers = [...new Set(members)]
      .filter((id) => !claimById.has(id))
      .sort(compareIds);
    for (const memberId of missingMembers) {
      diagnostics.push({
        code: "dangling_collection_member",
        collection_id: collectionId,
        claim_id: memberId
      });
    }

    if (collection?.collection_kind !== "closed_set") continue;

    const existingMembers = [...new Set(members)]
      .filter((id) => claimById.has(id))
      .sort(compareIds);
    const mandatoryBehaviorMemberIds = existingMembers.filter((id) => {
      const claim = claimById.get(id);
      return claim.kind === "behavior" && mandatoryModalities.has(claim.modality);
    });
    const uncoveredMemberIds = mandatoryBehaviorMemberIds
      .filter((id) => !verifiedBehaviorIds.has(id));
    collectionCoverage.push({
      collection_id: collectionId,
      member_claim_ids: existingMembers,
      verified_member_claim_ids: existingMembers.filter((id) => verifiedBehaviorIds.has(id)),
      mandatory_behavior_member_claim_ids: mandatoryBehaviorMemberIds,
      nonbehavior_member_claim_ids: existingMembers.filter(
        (id) => claimById.get(id).kind !== "behavior"
      ),
      uncovered_member_claim_ids: uncoveredMemberIds,
      declared_member_coverage_complete:
        missingMembers.length === 0 && uncoveredMemberIds.length === 0
    });
  }

  return {
    graph_version: "controlled-contract-local-dag.experimental.v0.1",
    facts: {
      claim_count: claims.length,
      relation_count: relations.length,
      collection_count: collections.length,
      mandatory_behavior_claim_ids: mandatoryBehaviorIds,
      verified_behavior_claim_ids: [...verifiedBehaviorIds].sort(compareIds),
      traceably_verified_behavior_claim_ids:
        [...traceablyVerifiedBehaviorIds].sort(compareIds),
      qualifying_verifies_relation_ids: qualifyingVerifiesRelations
        .map(({ relation_id }) => relation_id).sort(compareIds),
      supplementary_verifies_relation_ids: supplementaryVerifiesRelations
        .map(({ relation_id }) => relation_id).sort(compareIds),
      supplementary_verification_claim_count: [...claimById.values()].filter(
        (claim) => claim.kind === "verification" && claim.modality !== "MUST"
      ).length,
      supplementary_verification_claim_ids: [...new Set(
        supplementaryVerifiesRelations.map(({ source_claim_id }) => source_claim_id)
      )].sort(compareIds),
      attached_supplementary_verification_claim_ids: [...new Set(
        supplementaryVerifiesRelations.map(({ source_claim_id }) => source_claim_id)
      )].sort(compareIds),
      uncovered_mandatory_behavior_claim_ids: uncoveredMandatoryBehaviorIds,
      unattached_mandatory_verification_claim_ids: unattachedMandatoryVerificationIds,
      closed_collection_coverage: collectionCoverage
    },
    diagnostics: diagnostics.sort(compareDiagnostics)
  };
}

export {
  CLAIM_KINDS,
  CLAIM_MODALITIES,
  DEFAULT_ACYCLIC_ROLES,
  DEFAULT_MANDATORY_MODALITIES,
  resolveNativeContractDag
};
