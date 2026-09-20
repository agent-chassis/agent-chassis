

export function planProofAuthoringRequirementRetirement({ retirements = [], contract = null }) {
  const claims = new Map((contract?.claims ?? []).map(claim => [claim.claim_id, claim]));
  const verified = new Map();
  for (const relation of contract?.relations ?? []) {
    if (relation.role !== 'verifies') continue;
    verified.set(relation.source_claim_id, [...(verified.get(relation.source_claim_id) ?? []),
      relation.target_claim_id]);
  }
  return Object.freeze({
    selections: Object.freeze([...retirements]),
    retiredRequirementIds: new Set(retirements.map(fact => fact.claim_id)),
    retiredVerificationIds: new Set(retirements.flatMap(fact => fact.retired_verification_ids)),

    supportedRequirements: id => !claims.has(id) ? []
      : claims.get(id).kind === 'verification' ? verified.get(id) ?? [] : [id]
  });
}

function classifyUse(plan, row, caseVerification) {
  const retiring = id => plan.retiredRequirementIds.has(id) || plan.retiredVerificationIds.has(id);
  const links = row.controlled_contract_node_ids ?? [];
  const caseRetires = caseVerification !== undefined && plan.retiredVerificationIds.has(caseVerification);
  const retiredIdentities = [...new Set([...links.filter(retiring), ...(caseRetires ? [caseVerification] : [])])].sort();
  if (retiredIdentities.length === 0) return null;
  const supported = [...new Set([...links, ...(caseVerification === undefined ? [] : [caseVerification])]
    .flatMap(plan.supportedRequirements))];
  const survivingLinkIds = links.filter(id => !retiring(id)).sort();
  const survivingRequirementIds = supported.filter(id => !plan.retiredRequirementIds.has(id)).sort();
  const retires = survivingLinkIds.length === 0 && (caseVerification === undefined || caseRetires) &&
    supported.length > 0 && survivingRequirementIds.length === 0;
  return { retires, retiredIdentities, survivingLinkIds, survivingRequirementIds };
}

export function reconcileProofAuthoringRequirementRetirement(plan, { sources, caseIds, verificationIdForCase }) {
  const verificationOf = caseId => caseId ? verificationIdForCase(caseId) || undefined : undefined;
  const contents = new Map();
  const retiredUses = [];
  const conflicts = [];
  for (const { selectedUnit, unit, content, amended } of sources) {
    if (!content) {
      contents.set(selectedUnit, content);
      continue;
    }
    const obligations = content.obligations.filter(row => {
      const use = classifyUse(plan, row, verificationOf(row.case_id));
      if (use === null) return true;
      const identity = { unit, obligation_id: row.obligation_id, ...(row.case_id ? { case_id: row.case_id } : {}),
        retired_identities: use.retiredIdentities };
      if (use.retires && !amended.has(row.obligation_id)) {
        retiredUses.push(identity);
        return false;
      }
      conflicts.push(use.retires ? { ...identity, condition: 'amended_use_retires' } : { ...identity,
        condition: 'mixed_use', surviving_link_ids: use.survivingLinkIds,
        surviving_requirement_claim_ids: use.survivingRequirementIds });
      return true;
    });
    contents.set(selectedUnit, obligations.length === content.obligations.length ? content : { ...content, obligations });
  }
  const order = (left, right) => left.unit.localeCompare(right.unit) || left.obligation_id.localeCompare(right.obligation_id);
  return Object.freeze({
    contents,
    retiredUses: retiredUses.sort(order),
    retiredCaseIds: new Set(caseIds.filter(caseId => plan.retiredVerificationIds.has(verificationOf(caseId)))),
    conflicts: conflicts.sort(order)
  });
}
