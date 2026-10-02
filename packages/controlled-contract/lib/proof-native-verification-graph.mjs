import { linkedNativeTestProofs } from './native-test-proof-authoring.mjs';
const compare = (left, right) => String(left).localeCompare(String(right));

function explicitlyNamedIds(row, kind, indexes) {
  return (row.controlled_contract_node_ids ?? []).filter((id) => indexes[kind].has(id)).sort(compare);
}

export function createNativeVerificationIndex(contract) {
  const claims = new Map((contract.claims ?? []).map(claim => [claim.claim_id, claim]));
  const relations = new Map((contract.relations ?? []).map(relation => [relation.relation_id, relation]));
  const adjacent = new Map(), proofBindings = new Map();
  for (const relation of relations.values()) if (relation.role === 'verifies') {
    for (const id of [relation.relation_id, relation.source_claim_id, relation.target_claim_id]) {
      if (!adjacent.has(id)) adjacent.set(id, []);
      adjacent.get(id).push(relation);
    }
  }
  for (const proof of contract.test_proofs ?? []) {
    if (!proofBindings.has(proof.verification_claim_id)) proofBindings.set(proof.verification_claim_id, []);
    proofBindings.get(proof.verification_claim_id).push(proof);
  }
  return { claims, relations, adjacent, proofBindings, claim: new Set(claims.keys()), relation: new Set(relations.keys()) };
}

function resolveBehaviorAndVerificationPopulation(row, contract, indexes = createNativeVerificationIndex(contract)) {
  const { claims, relations } = indexes;
  const explicitVerifications = explicitlyNamedIds(row, "claim", indexes).filter((id) =>
    claims.get(id)?.kind === "verification");
  const selected = row.case_id ? [...new Set(linkedNativeTestProofs(contract, row)
    .map(proof => proof.verification_claim_id))].sort(compare) : null;
  const linked = selected === null ? row : { ...row, controlled_contract_node_ids: [...new Set([
    ...(row.controlled_contract_node_ids ?? []), ...selected])] };
  const explicitClaims = explicitlyNamedIds(linked, "claim", indexes);
  const explicitRelations = explicitlyNamedIds(linked, "relation", indexes);
  const explicitBehaviors = explicitClaims.filter((id) => claims.get(id)?.kind === "behavior");
  const linkedVerifications = explicitClaims.filter((id) => claims.get(id)?.kind === "verification");
  const candidateRelations = [...new Map([...explicitRelations, ...explicitBehaviors, ...linkedVerifications]
    .flatMap(id => indexes.adjacent.get(id) ?? []).map(relation => [relation.relation_id, relation])).values()];
  const behaviorIds = [...new Set([
    ...explicitBehaviors,
    ...candidateRelations.map(({ target_claim_id: id }) => id).filter((id) =>
      claims.get(id)?.kind === "behavior")
  ])].sort(compare);
  const eligible = [...new Set(candidateRelations.filter((relation) =>
    behaviorIds.includes(relation.target_claim_id) &&
    claims.get(relation.source_claim_id)?.kind === "verification" &&
    claims.get(relation.source_claim_id)?.verification_method === "test_execution"
  ).map(({ source_claim_id: id }) => id))].sort(compare);
  const eligibleRelationIds = candidateRelations.filter((relation) =>
    behaviorIds.includes(relation.target_claim_id) &&
    eligible.includes(relation.source_claim_id)
  ).map(({ relation_id: id }) => id).sort(compare);
  const qualifying = selected === null ? eligible : eligible.filter(id => selected.includes(id));
  const relationIds = eligibleRelationIds.filter(id => qualifying.includes(relations.get(id).source_claim_id));
  return { claims, explicitRelations, explicitVerifications, selected, eligible, eligibleRelationIds,
    behaviorIds, qualifying, relationIds };
}

function applicableMandatoryBehaviors(row, contract, claims) {
  const named = new Set(row.controlled_contract_node_ids ?? []);
  return [...new Set((contract.collections ?? []).filter(({ collection_id: id,
    purpose, member_claim_ids: members = [] }) =>
    purpose === "mandatory_verify_proof_behaviors" &&
      (named.has(id) || members.some((member) => named.has(member)))
  ).flatMap(({ member_claim_ids: members = [] }) => members).filter((id) =>
    claims.get(id)?.kind === "behavior"
  ))].sort(compare);
}

export { resolveBehaviorAndVerificationPopulation, applicableMandatoryBehaviors };

export function resolveNativeProofBinding(graph, index) {
  if (graph.qualifying.length !== 1) return null;
  const verificationId = graph.qualifying[0];
  const bindings = index.proofBindings.get(verificationId) ?? [];
  return { verification_id: verificationId, arity: bindings.length,
    proof: bindings.length === 1 ? bindings[0] : null,
    reason_code: bindings.length === 1 ? null : bindings.length === 0
      ? 'verify_proof.test_proof_binding_missing.v1' : 'verify_proof.test_proof_binding_ambiguous.v1',
    owner_code: bindings.length === 1 ? null : bindings.length === 0
      ? 'stable_test_proof_missing' : 'stable_test_proof_claim_duplicate',
    join_kind: 'test_proof', path: '/test_proofs' };
}
