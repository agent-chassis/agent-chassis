import { validateAndResolveNativeContract } from "./native-contract-carrier.mjs";

const DECOMPOSITION_VERSION = "controlled-contract-decomposition.experimental.v0.4";
const DEFAULT_MANDATORY_MODALITIES = Object.freeze(["MUST", "MUST_NOT"]);
const DEPENDENCY_ROLES = Object.freeze(["depends_on", "precedes"]);
const DEFAULT_COHESION_ROLES = Object.freeze(["refines"]);
const VERIFICATION_ROLES = Object.freeze(["verifies"]);
const TRACEABILITY_ROLES = Object.freeze(["derives_from", "traces", "replaces"]);
const HIERARCHY_ROLES = Object.freeze(["satisfies"]);

function compareIds(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  if (leftString < rightString) return -1;
  if (leftString > rightString) return 1;
  return 0;
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => compareIds(left, right)));
}

function referencedIds(proposition) {
  if (!proposition) return [];
  return [...new Set([
    proposition.subject_reference_id,
    ...(proposition.applicability_context?.operand_reference_ids ?? []),
    ...(proposition.operands ?? [])
      .filter(({ kind }) => kind === "reference")
      .map(({ reference_id }) => reference_id)
  ])].sort(compareIds);
}

function propositionIdsForClaims(claims, includeFalsifiers = false) {
  return [...new Set(claims.flatMap((claim) => [
    claim.proposition_id,
    ...(includeFalsifiers && claim.kind === "verification"
      ? [claim.falsifying_proposition_id]
      : [])
  ]))].sort(compareIds);
}

function propositionsForClaims(claims, propositionById, includeFalsifiers = false) {
  return propositionIdsForClaims(claims, includeFalsifiers)
    .map((id) => propositionById.get(id))
    .filter(Boolean);
}

function connectedComponents(claimIds, cohesiveRelations) {
  const adjacency = new Map(claimIds.map((id) => [id, new Set()]));
  for (const relation of cohesiveRelations) {
    adjacency.get(relation.source_claim_id).add(relation.target_claim_id);
    adjacency.get(relation.target_claim_id).add(relation.source_claim_id);
  }

  const visited = new Set();
  const components = [];
  for (const start of [...claimIds].sort(compareIds)) {
    if (visited.has(start)) continue;
    const pending = [start];
    const members = [];
    visited.add(start);
    while (pending.length > 0) {
      const current = pending.pop();
      members.push(current);
      for (const neighbor of [...adjacency.get(current)].sort(compareIds).reverse()) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    components.push(members.sort(compareIds));
  }
  return components.sort((left, right) => compareIds(left[0], right[0]));
}

function normalizeDependency(relation, componentByClaim) {
  const sourceComponentId = componentByClaim.get(relation.source_claim_id);
  const targetComponentId = componentByClaim.get(relation.target_claim_id);
  const [prerequisiteComponentId, dependentComponentId] = relation.role === "depends_on"
    ? [targetComponentId, sourceComponentId]
    : [sourceComponentId, targetComponentId];
  return {
    relation_id: relation.relation_id,
    role: relation.role,
    source_component_id: sourceComponentId,
    target_component_id: targetComponentId,
    prerequisite_component_id: prerequisiteComponentId,
    dependent_component_id: dependentComponentId
  };
}

function dependencyArcs(dependencies) {
  const byPair = new Map();
  for (const dependency of dependencies) {
    if (dependency.prerequisite_component_id === dependency.dependent_component_id) continue;
    const key = `${dependency.prerequisite_component_id}\u0000${dependency.dependent_component_id}`;
    const current = byPair.get(key) ?? {
      prerequisite_component_id: dependency.prerequisite_component_id,
      dependent_component_id: dependency.dependent_component_id,
      relation_ids: []
    };
    current.relation_ids.push(dependency.relation_id);
    byPair.set(key, current);
  }
  return [...byPair.values()]
    .map((arc) => ({ ...arc, relation_ids: arc.relation_ids.sort(compareIds) }))
    .sort((left, right) => compareIds(
      `${left.prerequisite_component_id}\u0000${left.dependent_component_id}`,
      `${right.prerequisite_component_id}\u0000${right.dependent_component_id}`
    ));
}

function resolveTopology(componentIds, arcs) {
  const outgoing = new Map(componentIds.map((id) => [id, new Set()]));
  const incoming = new Map(componentIds.map((id) => [id, new Set()]));
  for (const arc of arcs) {
    outgoing.get(arc.prerequisite_component_id).add(arc.dependent_component_id);
    incoming.get(arc.dependent_component_id).add(arc.prerequisite_component_id);
  }

  const remainingIncoming = new Map(
    [...incoming].map(([id, sources]) => [id, new Set(sources)])
  );
  const layers = [];
  const ordered = [];
  const orderedSet = new Set();
  let frontier = componentIds.filter((id) => remainingIncoming.get(id).size === 0)
    .sort(compareIds);
  while (frontier.length > 0) {
    layers.push(frontier);
    const next = new Set();
    for (const id of frontier) {
      ordered.push(id);
      orderedSet.add(id);
      for (const target of [...outgoing.get(id)].sort(compareIds)) {
        remainingIncoming.get(target).delete(id);
        if (remainingIncoming.get(target).size === 0) next.add(target);
      }
    }
    frontier = [...next].filter((id) => !orderedSet.has(id)).sort(compareIds);
  }

  const cyclicComponentIds = componentIds.filter((id) => !orderedSet.has(id)).sort(compareIds);
  const depthByComponent = new Map(componentIds.map((id) => [id, 0]));
  if (cyclicComponentIds.length === 0) {
    for (const id of ordered) {
      for (const target of outgoing.get(id)) {
        depthByComponent.set(
          target,
          Math.max(depthByComponent.get(target), depthByComponent.get(id) + 1)
        );
      }
    }
  }

  return {
    incoming,
    outgoing,
    topological_component_ids: cyclicComponentIds.length === 0 ? ordered : null,
    topological_layers: cyclicComponentIds.length === 0 ? layers : null,
    cyclic_component_ids: cyclicComponentIds,
    depth_by_component: depthByComponent
  };
}

function hasAlternatePath(start, target, outgoing, omittedPair) {
  const pending = [start];
  const visited = new Set([start]);
  while (pending.length > 0) {
    const current = pending.pop();
    for (const next of outgoing.get(current) ?? []) {
      if (current === omittedPair[0] && next === omittedPair[1]) continue;
      if (next === target) return true;
      if (visited.has(next)) continue;
      visited.add(next);
      pending.push(next);
    }
  }
  return false;
}

function annotateTransitiveArcs(arcs, topology) {
  if (topology.cyclic_component_ids.length > 0) {
    return arcs.map((arc) => ({ ...arc, transitively_redundant: null }));
  }
  return arcs.map((arc) => ({
    ...arc,
    transitively_redundant: hasAlternatePath(
      arc.prerequisite_component_id,
      arc.dependent_component_id,
      topology.outgoing,
      [arc.prerequisite_component_id, arc.dependent_component_id]
    )
  }));
}

function relationOverlay(relation, claimById, componentByBehaviorClaim) {
  const source = claimById.get(relation.source_claim_id);
  const target = claimById.get(relation.target_claim_id);
  return {
    relation_id: relation.relation_id,
    role: relation.role,
    source_claim_id: relation.source_claim_id,
    source_claim_kind: source.kind,
    source_component_id: componentByBehaviorClaim.get(source.claim_id) ?? null,
    target_claim_id: relation.target_claim_id,
    target_claim_kind: target.kind,
    target_component_id: componentByBehaviorClaim.get(target.claim_id) ?? null
  };
}

function resolveNativeContractDecomposition(contract, options = {}) {
  const validateContract = options.validate_contract ?? validateAndResolveNativeContract;
  const contractEvaluation = validateContract(contract);
  if (!contractEvaluation.schema_valid) {
    return {
      decomposition_version: DECOMPOSITION_VERSION,
      schema_valid: false,
      schema_errors: contractEvaluation.schema_errors,
      facts: null,
      diagnostics: [{ code: "contract_schema_invalid" }]
    };
  }

  const mandatoryModalities = new Set(
    options.mandatory_modalities ?? DEFAULT_MANDATORY_MODALITIES
  );
  const dependencyRoles = new Set(options.dependency_roles ?? DEPENDENCY_ROLES);
  const cohesionRoles = new Set(options.cohesion_roles ?? DEFAULT_COHESION_ROLES);
  const counterfactualFalsifierSemantics =
    options.counterfactual_falsifier_semantics ?? "applicability_mode";
  if (!["applicability_mode", "falsifier_role"].includes(
    counterfactualFalsifierSemantics
  )) throw new Error(
    `unsupported counterfactual falsifier semantics: ${counterfactualFalsifierSemantics}`
  );
  const claimById = new Map(contract.claims.map((claim) => [claim.claim_id, claim]));
  const propositionById = new Map(
    contract.propositions.map((proposition) => [proposition.proposition_id, proposition])
  );
  const referenceById = new Map(
    contract.references.map((reference) => [reference.reference_id, reference])
  );
  const diagnostics = [];
  const validRelations = [];
  for (const relation of contract.relations) {
    if (!claimById.has(relation.source_claim_id) || !claimById.has(relation.target_claim_id)) {
      diagnostics.push({
        code: "decomposition_relation_dangling",
        relation_id: relation.relation_id
      });
      continue;
    }
    validRelations.push(relation);
  }

  const behaviorClaims = contract.claims.filter(({ kind }) => kind === "behavior");
  const behaviorClaimIds = behaviorClaims.map(({ claim_id }) => claim_id);
  const behaviorClaimIdSet = new Set(behaviorClaimIds);
  const isBehaviorRelation = (relation) =>
    behaviorClaimIdSet.has(relation.source_claim_id) &&
    behaviorClaimIdSet.has(relation.target_claim_id);
  const cohesiveBehaviorRelations = validRelations.filter((relation) =>
    isBehaviorRelation(relation) && cohesionRoles.has(relation.role)
  );
  const behaviorDependencyRelations = validRelations.filter((relation) =>
    isBehaviorRelation(relation) && dependencyRoles.has(relation.role)
  );

  const memberGroups = connectedComponents(behaviorClaimIds, cohesiveBehaviorRelations);
  const componentIds = memberGroups.map((_, index) =>
    `component-${String(index + 1).padStart(3, "0")}`
  );
  const componentByBehaviorClaim = new Map();
  memberGroups.forEach((members, index) => {
    for (const claimId of members) componentByBehaviorClaim.set(claimId, componentIds[index]);
  });

  const dependencies = behaviorDependencyRelations
    .map((relation) => normalizeDependency(relation, componentByBehaviorClaim))
    .sort((left, right) => compareIds(left.relation_id, right.relation_id));
  const arcs = dependencyArcs(dependencies);
  const topology = resolveTopology(componentIds, arcs);
  if (topology.cyclic_component_ids.length > 0) diagnostics.push({
    code: "behavior_dependency_quotient_cycle",
    component_ids: topology.cyclic_component_ids
  });
  const annotatedArcs = annotateTransitiveArcs(arcs, topology);

  const validVerifiesRelations = validRelations.filter((relation) => {
    if (!VERIFICATION_ROLES.includes(relation.role)) return false;
    return claimById.get(relation.source_claim_id).kind === "verification" &&
      claimById.get(relation.target_claim_id).kind === "behavior";
  });
  const qualifyingVerifiesRelations = validVerifiesRelations.filter(
    (relation) => claimById.get(relation.source_claim_id).modality === "MUST"
  );
  const supplementaryVerifiesRelations = validVerifiesRelations.filter(
    (relation) => claimById.get(relation.source_claim_id).modality !== "MUST"
  );
  const verifiesBySource = new Map();
  const verifiersByTarget = new Map();
  for (const relation of validVerifiesRelations) {
    const targets = verifiesBySource.get(relation.source_claim_id) ?? [];
    targets.push(relation);
    verifiesBySource.set(relation.source_claim_id, targets);
  }
  for (const relation of qualifyingVerifiesRelations) {
    const sources = verifiersByTarget.get(relation.target_claim_id) ?? [];
    sources.push(relation);
    verifiersByTarget.set(relation.target_claim_id, sources);
  }

  const verificationClaims = contract.claims.filter(({ kind }) => kind === "verification");
  const verificationAttachments = verificationClaims.map((claim) => {
    const relations = verifiesBySource.get(claim.claim_id) ?? [];
    const targetBehaviorClaimIds = [...new Set(
      relations.map(({ target_claim_id }) => target_claim_id)
    )].sort(compareIds);
    const targetComponentIds = [...new Set(
      targetBehaviorClaimIds.map((id) => componentByBehaviorClaim.get(id)).filter(Boolean)
    )].sort(compareIds);
    return {
      verification_claim_id: claim.claim_id,
      verification_modality: claim.modality,
      qualifies_for_mandatory_coverage: claim.modality === "MUST",
      verifies_relation_ids: relations.map(({ relation_id }) => relation_id).sort(compareIds),
      target_behavior_claim_ids: targetBehaviorClaimIds,
      target_component_ids: targetComponentIds,
      attachment: targetComponentIds.length === 0
        ? "orphan"
        : targetComponentIds.length === 1
          ? "single_component"
          : "shared_components"
    };
  }).sort((left, right) => compareIds(
    left.verification_claim_id,
    right.verification_claim_id
  ));
  const attachmentByVerification = new Map(
    verificationAttachments.map((attachment) => [
      attachment.verification_claim_id,
      attachment
    ])
  );

  const components = memberGroups.map((claimIdsForComponent, index) => {
    const componentId = componentIds[index];
    const claims = claimIdsForComponent.map((id) => claimById.get(id));
    const mandatoryClaims = claims.filter(({ modality }) => mandatoryModalities.has(modality));
    const propositionIds = propositionIdsForClaims(claims);
    const propositions = propositionsForClaims(claims, propositionById);
    const referenceIds = [...new Set(propositions.flatMap(referencedIds))].sort(compareIds);
    const repositoryReferenceIds = referenceIds.filter((id) =>
      ["repository_path", "code_symbol"].includes(referenceById.get(id)?.identity?.kind)
    );
    const internalCohesiveRelations = cohesiveBehaviorRelations.filter((relation) =>
      componentByBehaviorClaim.get(relation.source_claim_id) === componentId &&
      componentByBehaviorClaim.get(relation.target_claim_id) === componentId
    );
    const attachedVerificationIds = verificationAttachments
      .filter(({ target_component_ids, qualifies_for_mandatory_coverage: qualifies }) =>
        qualifies && target_component_ids.includes(componentId)
      )
      .map(({ verification_claim_id }) => verification_claim_id);
    const supplementaryVerificationIds = verificationAttachments
      .filter(({ target_component_ids, qualifies_for_mandatory_coverage: qualifies }) =>
        !qualifies && target_component_ids.includes(componentId)
      )
      .map(({ verification_claim_id }) => verification_claim_id);
    const exclusiveVerificationIds = attachedVerificationIds.filter((id) =>
      attachmentByVerification.get(id).attachment === "single_component"
    );
    const sharedVerificationIds = attachedVerificationIds.filter((id) =>
      attachmentByVerification.get(id).attachment === "shared_components"
    );
    const incoming = [...topology.incoming.get(componentId)].sort(compareIds);
    const outgoing = [...topology.outgoing.get(componentId)].sort(compareIds);
    return {
      component_id: componentId,
      behavior_claim_ids: claimIdsForComponent,
      mandatory_behavior_claim_ids: mandatoryClaims.map(({ claim_id }) => claim_id),
      behavior_proposition_ids: propositionIds,
      behavior_reference_ids: referenceIds,
      behavior_repository_reference_ids: repositoryReferenceIds,
      cohesive_relation_ids: internalCohesiveRelations
        .map(({ relation_id }) => relation_id)
        .sort(compareIds),
      verification_claim_ids: attachedVerificationIds,
      supplementary_verification_claim_ids: supplementaryVerificationIds,
      exclusive_verification_claim_ids: exclusiveVerificationIds,
      shared_verification_claim_ids: sharedVerificationIds,
      incoming_dependency_component_ids: incoming,
      outgoing_dependency_component_ids: outgoing,
      dependency_depth: topology.depth_by_component.get(componentId),
      mandatory_bearing: mandatoryClaims.length > 0,
      complexity: {
        behavior_claim_count: claims.length,
        mandatory_behavior_count: mandatoryClaims.length,
        behavior_proposition_count: propositions.length,
        behavior_reference_count: referenceIds.length,
        cohesive_relation_count: internalCohesiveRelations.length,
        distinct_behavior_operator_count: new Set(
          propositions.map(({ operator }) => operator)
        ).size,
        behavior_operator_counts: countValues(
          propositions.map(({ operator }) => operator)
        ),
        conditional_behavior_proposition_count: propositions.filter(
          ({ applicability_context }) => applicability_context.mode !== "unconditional"
        ).length,
        attached_verification_count: attachedVerificationIds.length,
        supplementary_verification_count: supplementaryVerificationIds.length,
        exclusive_verification_count: exclusiveVerificationIds.length,
        shared_verification_count: sharedVerificationIds.length,
        max_verification_behavior_fan_out: Math.max(
          0,
          ...attachedVerificationIds.map((id) =>
            attachmentByVerification.get(id).target_behavior_claim_ids.length
          )
        ),
        max_verification_component_fan_out: Math.max(
          0,
          ...attachedVerificationIds.map((id) =>
            attachmentByVerification.get(id).target_component_ids.length
          )
        ),
        max_behavior_verifier_count: Math.max(
          0,
          ...claimIdsForComponent.map((id) => (verifiersByTarget.get(id) ?? []).length)
        ),
        dependency_in_degree: incoming.length,
        dependency_out_degree: outgoing.length
      }
    };
  });

  const repositoryReferenceOverlap = [];
  for (let leftIndex = 0; leftIndex < components.length; leftIndex += 1) {
    const left = components[leftIndex];
    const leftReferences = new Set(left.behavior_repository_reference_ids);
    for (let rightIndex = leftIndex + 1; rightIndex < components.length; rightIndex += 1) {
      const right = components[rightIndex];
      const sharedReferenceIds = right.behavior_repository_reference_ids
        .filter((id) => leftReferences.has(id));
      if (sharedReferenceIds.length === 0) continue;
      repositoryReferenceOverlap.push({
        left_component_id: left.component_id,
        right_component_id: right.component_id,
        shared_repository_reference_ids: sharedReferenceIds
      });
    }
  }

  const collectionAttachments = contract.collections.map((collection) => {
    const uniqueMemberClaimIds = [...new Set(collection.member_claim_ids)];
    const behaviorClaimIdsForCollection = uniqueMemberClaimIds
      .filter((id) => behaviorClaimIdSet.has(id));
    const nonbehaviorClaimIds = uniqueMemberClaimIds
      .filter((id) => claimById.has(id) && !behaviorClaimIdSet.has(id));
    if (collection.collection_kind !== "ordered_sequence") {
      behaviorClaimIdsForCollection.sort(compareIds);
      nonbehaviorClaimIds.sort(compareIds);
    }
    const targetComponentIds = [...new Set(
      behaviorClaimIdsForCollection.map((id) => componentByBehaviorClaim.get(id))
    )];
    if (collection.collection_kind !== "ordered_sequence") {
      targetComponentIds.sort(compareIds);
    }
    const verificationByMember = behaviorClaimIdsForCollection.map((behaviorClaimId) => {
      const verificationClaimIds = [...new Set(
        (verifiersByTarget.get(behaviorClaimId) ?? [])
          .map(({ source_claim_id }) => source_claim_id)
      )].sort(compareIds);
      const falsifyingPropositionIds = [...new Set(
        verificationClaimIds
          .map((id) => claimById.get(id)?.falsifying_proposition_id)
          .filter(Boolean)
      )].sort(compareIds);
      return {
        behavior_claim_id: behaviorClaimId,
        component_id: componentByBehaviorClaim.get(behaviorClaimId),
        verification_claim_ids: verificationClaimIds,
        falsifying_proposition_ids: falsifyingPropositionIds
      };
    });
    const membersByVerifier = new Map();
    const membersByFalsifier = new Map();
    for (const member of verificationByMember) {
      for (const verificationClaimId of member.verification_claim_ids) {
        const members = membersByVerifier.get(verificationClaimId) ?? new Set();
        members.add(member.behavior_claim_id);
        membersByVerifier.set(verificationClaimId, members);
      }
      for (const falsifyingPropositionId of member.falsifying_proposition_ids) {
        const members = membersByFalsifier.get(falsifyingPropositionId) ?? new Set();
        members.add(member.behavior_claim_id);
        membersByFalsifier.set(falsifyingPropositionId, members);
      }
    }
    const sharedVerificationClaimIds = [...membersByVerifier]
      .filter(([, members]) => members.size > 1)
      .map(([id]) => id)
      .sort(compareIds);
    const sharedFalsifyingPropositionIds = [...membersByFalsifier]
      .filter(([, members]) => members.size > 1)
      .map(([id]) => id)
      .sort(compareIds);
    const membersWithoutExclusiveFalsifierIds = verificationByMember
      .filter((member) => !member.falsifying_proposition_ids.some(
        (id) => membersByFalsifier.get(id)?.size === 1
      ))
      .map(({ behavior_claim_id }) => behavior_claim_id);
    return {
      collection_id: collection.collection_id,
      collection_kind: collection.collection_kind,
      behavior_claim_ids: behaviorClaimIdsForCollection,
      nonbehavior_claim_ids: nonbehaviorClaimIds,
      target_component_ids: targetComponentIds,
      attachment: targetComponentIds.length === 0
        ? "no_behavior_members"
        : targetComponentIds.length === 1
          ? "single_component"
          : "shared_components",
      verification_population: {
        verified_behavior_member_count: verificationByMember.filter(
          ({ verification_claim_ids }) => verification_claim_ids.length > 0
        ).length,
        distinct_verification_claim_count: membersByVerifier.size,
        distinct_falsifying_proposition_count: membersByFalsifier.size,
        shared_verification_claim_ids: sharedVerificationClaimIds,
        shared_falsifying_proposition_ids: sharedFalsifyingPropositionIds,
        members_without_exclusive_falsifier_ids: membersWithoutExclusiveFalsifierIds,
        members: verificationByMember
      }
    };
  }).sort((left, right) => compareIds(left.collection_id, right.collection_id));

  const relationOverlays = {
    verification: validRelations
      .filter(({ role }) => VERIFICATION_ROLES.includes(role))
      .map((relation) => relationOverlay(relation, claimById, componentByBehaviorClaim)),
    traceability: validRelations
      .filter(({ role }) => TRACEABILITY_ROLES.includes(role))
      .map((relation) => relationOverlay(relation, claimById, componentByBehaviorClaim)),
    hierarchy: validRelations
      .filter((relation) =>
        HIERARCHY_ROLES.includes(relation.role) ||
        (relation.role === "refines" && !isBehaviorRelation(relation))
      )
      .map((relation) => relationOverlay(relation, claimById, componentByBehaviorClaim)),
    nonbehavior_dependencies: validRelations
      .filter((relation) => dependencyRoles.has(relation.role) && !isBehaviorRelation(relation))
      .map((relation) => relationOverlay(relation, claimById, componentByBehaviorClaim))
  };
  for (const overlays of Object.values(relationOverlays)) {
    overlays.sort((left, right) => compareIds(left.relation_id, right.relation_id));
  }

  const evidenceClaimIds = contract.claims
    .filter(({ kind }) => kind === "evidence")
    .map(({ claim_id }) => claim_id)
    .sort(compareIds);
  const claimPropositions = propositionsForClaims(contract.claims, propositionById);
  const falsifierPropositions = propositionsForClaims(
    verificationClaims,
    propositionById,
    true
  ).filter(({ proposition_id }) => verificationClaims.some(
    ({ falsifying_proposition_id }) => falsifying_proposition_id === proposition_id
  ));
  const allOperativePropositions = propositionsForClaims(
    contract.claims,
    propositionById,
    true
  );
  const operativeReferenceIds = new Set(allOperativePropositions.flatMap(referencedIds));
  const declaredReferenceIds = contract.references
    .map(({ reference_id }) => reference_id)
    .sort(compareIds);
  const unusedReferenceIds = declaredReferenceIds
    .filter((id) => !operativeReferenceIds.has(id));
  const topologicalLayers = topology.topological_layers;
  const mandatoryBehaviorComponentCount = components.filter(
    ({ mandatory_bearing }) => mandatory_bearing
  ).length;
  const singletonBehaviorComponentCount = components.filter(
    ({ behavior_claim_ids }) => behavior_claim_ids.length === 1
  ).length;
  const dependencyDepth = topology.cyclic_component_ids.length === 0
    ? Math.max(0, ...topology.depth_by_component.values())
    : null;
  const maximumTopologicalFrontier = topologicalLayers
    ? Math.max(0, ...topologicalLayers.map((layer) => layer.length))
    : null;
  const maximumDependencyInDegree = Math.max(
    0,
    ...componentIds.map((id) => topology.incoming.get(id).size)
  );
  const maximumDependencyOutDegree = Math.max(
    0,
    ...componentIds.map((id) => topology.outgoing.get(id).size)
  );
  const decompositionValid = diagnostics.length === 0;

  return {
    decomposition_version: DECOMPOSITION_VERSION,
    schema_valid: true,
    schema_errors: [],
    facts: {
      claim_count: contract.claims.length,
      behavior_claim_count: behaviorClaims.length,
      verification_claim_count: verificationClaims.length,
      evidence_claim_count: evidenceClaimIds.length,
      behavior_component_count: components.length,
      mandatory_behavior_component_count: mandatoryBehaviorComponentCount,
      singleton_behavior_component_count: singletonBehaviorComponentCount,
      behavior_cohesion: {
        behavior_claim_count: behaviorClaims.length,
        cohesive_relation_count: cohesiveBehaviorRelations.length,
        component_count: components.length,
        singleton_component_count: singletonBehaviorComponentCount,
        cohesive_relations_per_behavior_claim: behaviorClaims.length === 0
          ? null
          : cohesiveBehaviorRelations.length / behaviorClaims.length,
        components_per_behavior_claim: behaviorClaims.length === 0
          ? null
          : components.length / behaviorClaims.length,
        singleton_component_share: components.length === 0
          ? null
          : singletonBehaviorComponentCount / components.length
      },
      mechanically_decomposable:
        mandatoryBehaviorComponentCount > 1 && decompositionValid,
      behavior_dependency_relation_count: behaviorDependencyRelations.length,
      behavior_dependency_arc_count: annotatedArcs.length,
      dependency_depth: dependencyDepth,
      maximum_topological_frontier: maximumTopologicalFrontier,
      maximum_dependency_in_degree: maximumDependencyInDegree,
      maximum_dependency_out_degree: maximumDependencyOutDegree,
      topological_component_ids: topology.topological_component_ids,
      topological_layers: topologicalLayers,
      reference_usage: {
        declared_reference_count: declaredReferenceIds.length,
        operative_reference_count: operativeReferenceIds.size,
        unused_reference_count: unusedReferenceIds.length,
        unused_reference_ids: unusedReferenceIds
      },
      repository_reference_overlap: repositoryReferenceOverlap,
      collection_overlay: {
        collection_count: collectionAttachments.length,
        single_component_collection_count: collectionAttachments.filter(
          ({ attachment }) => attachment === "single_component"
        ).length,
        shared_collection_count: collectionAttachments.filter(
          ({ attachment }) => attachment === "shared_components"
        ).length,
        no_behavior_members_collection_count: collectionAttachments.filter(
          ({ attachment }) => attachment === "no_behavior_members"
        ).length,
        attachments: collectionAttachments
      },
      verification_overlay: {
        verification_claim_count: verificationClaims.length,
        qualifying_verification_claim_count: verificationClaims.filter(
          ({ modality }) => modality === "MUST"
        ).length,
        supplementary_verification_claim_count: verificationClaims.filter(
          ({ modality }) => modality !== "MUST"
        ).length,
        attached_supplementary_verification_claim_ids: verificationAttachments
          .filter(({ qualifies_for_mandatory_coverage: qualifies }) => !qualifies)
          .map(({ verification_claim_id: verificationClaimId }) => verificationClaimId)
          .sort(compareIds),
        qualifying_verifies_relation_ids: qualifyingVerifiesRelations
          .map(({ relation_id }) => relation_id).sort(compareIds),
        supplementary_verifies_relation_ids: supplementaryVerifiesRelations
          .map(({ relation_id }) => relation_id).sort(compareIds),
        single_component_verification_count: verificationAttachments.filter(
          ({ attachment }) => attachment === "single_component"
        ).length,
        shared_verification_count: verificationAttachments.filter(
          ({ attachment }) => attachment === "shared_components"
        ).length,
        orphan_verification_count: verificationAttachments.filter(
          ({ attachment }) => attachment === "orphan"
        ).length,
        max_target_behavior_count: Math.max(
          0,
          ...verificationAttachments.map(({ target_behavior_claim_ids }) =>
            target_behavior_claim_ids.length
          )
        ),
        max_target_component_count: Math.max(
          0,
          ...verificationAttachments.map(({ target_component_ids }) =>
            target_component_ids.length
          )
        ),
        attachments: verificationAttachments
      },
      evidence_overlay: {
        evidence_claim_ids: evidenceClaimIds,
        dependency_relations: relationOverlays.nonbehavior_dependencies.filter(
          ({ source_claim_kind, target_claim_kind }) =>
            source_claim_kind === "evidence" || target_claim_kind === "evidence"
        )
      },
      relation_overlays: relationOverlays,
      complexity: {
        claim_count: contract.claims.length,
        mandatory_behavior_count: behaviorClaims.filter(
          ({ modality }) => mandatoryModalities.has(modality)
        ).length,
        verification_count: verificationClaims.length,
        evidence_count: evidenceClaimIds.length,
        proposition_count: allOperativePropositions.length,
        declared_reference_count: declaredReferenceIds.length,
        operative_reference_count: operativeReferenceIds.size,
        unused_reference_count: unusedReferenceIds.length,
        relation_count: contract.relations.length,
        distinct_relation_role_count: new Set(
          contract.relations.map(({ role }) => role)
        ).size,
        distinct_operator_count: new Set(
          allOperativePropositions.map(({ operator }) => operator)
        ).size,
        conditional_claim_proposition_count: claimPropositions.filter(
          ({ applicability_context }) => applicability_context.mode !== "unconditional"
        ).length,
        falsifier_proposition_count: falsifierPropositions.length,
        counterfactual_falsifier_count: counterfactualFalsifierSemantics ===
          "falsifier_role"
          ? falsifierPropositions.length
          : falsifierPropositions.filter(
            ({ applicability_context }) => applicability_context.mode === "counterfactual"
          ).length,
        closed_collection_count: contract.collections.filter(
          ({ collection_kind }) => collection_kind === "closed_set"
        ).length,
        operative_residue_count: contract.residue.length,
        behavior_component_count: components.length,
        mandatory_behavior_component_count: mandatoryBehaviorComponentCount,
        singleton_behavior_component_count: singletonBehaviorComponentCount,
        maximum_component_behavior_claim_count: Math.max(
          0,
          ...components.map(({ complexity }) => complexity.behavior_claim_count)
        ),
        shared_verification_count: verificationAttachments.filter(
          ({ attachment }) => attachment === "shared_components"
        ).length,
        behavior_dependency_arc_count: annotatedArcs.length,
        dependency_depth: dependencyDepth,
        maximum_topological_frontier: maximumTopologicalFrontier,
        maximum_dependency_in_degree: maximumDependencyInDegree,
        maximum_dependency_out_degree: maximumDependencyOutDegree
      },
      components,
      behavior_dependency_relations: dependencies,
      behavior_dependency_arcs: annotatedArcs
    },
    source_contract_diagnostics: contractEvaluation.diagnostics,
    diagnostics
  };
}

export {
  DECOMPOSITION_VERSION,
  DEFAULT_COHESION_ROLES,
  DEFAULT_MANDATORY_MODALITIES,
  DEPENDENCY_ROLES,
  HIERARCHY_ROLES,
  TRACEABILITY_ROLES,
  VERIFICATION_ROLES,
  resolveNativeContractDecomposition
};
