

const REBIND_FIELD = "rebind_case_ids";

export function planProofAuthoringRequirementRebinding({ corrections = [], requirements = [] }) {
  const requirementLinks = new Map();
  const verificationLinks = new Map();
  const retiredVerificationIds = new Set();
  const selections = [];
  for (const correction of corrections) {
    if (correction.requirement_retired) {
      requirementLinks.set(correction.prior_claim_id, correction.claim_id);
    }
    for (const verificationId of correction.retired_verification_ids) {
      retiredVerificationIds.add(verificationId);
      if (correction.verification_claim_id === null) continue;
      const replacements = verificationLinks.get(verificationId) ?? new Set();
      replacements.add(correction.verification_claim_id);
      verificationLinks.set(verificationId, replacements);
    }
    const requirement = requirements[correction.requirement_index];
    const caseIds = requirement?.[REBIND_FIELD];
    selections.push(Object.freeze({
      ...correction,
      field: `requirements[${correction.requirement_index}].${REBIND_FIELD}`,
      case_ids: caseIds === undefined ? null : Object.freeze([...caseIds]),
      authored_runtime_test: requirement?.verification?.runtime_test ?? null
    }));
  }
  const exactLinks = new Map([
    ...requirementLinks,
    ...[...verificationLinks].filter(([, replacements]) => replacements.size === 1)
      .map(([verificationId, replacements]) => [verificationId, [...replacements][0]])
  ]);
  return Object.freeze({
    selections: Object.freeze(selections),
    retiredVerificationIds,
    exactLinks,
    ambiguousLinks: new Map([...verificationLinks]
      .filter(([, replacements]) => replacements.size > 1)
      .map(([verificationId, replacements]) => [verificationId, [...replacements].sort()])),
    rebindOperationCount: selections.reduce((count, selection) =>
      count + (selection.case_ids?.length ?? 0), 0),
    changesLinks: exactLinks.size > 0
  });
}

export function remapProofAuthoringObligationLinks(content, plan) {
  if (content === null || content === undefined || !plan.changesLinks) return content;
  let changed = false;
  const obligations = content.obligations.map(row => {
    const links = row.controlled_contract_node_ids;
    if (!Array.isArray(links) || !links.some(id => plan.exactLinks.has(id))) return row;
    changed = true;
    return { ...row, controlled_contract_node_ids:
      [...new Set(links.map(id => plan.exactLinks.get(id) ?? id))] };
  });
  return changed ? { ...content, obligations } : content;
}

export function proofAuthoringRebindingIntents(plan, verificationIdForCase) {
  return plan.selections.flatMap(selection => (selection.case_ids ?? []).flatMap(caseId => {
    const current = verificationIdForCase(caseId);
    if (current === undefined || !selection.retired_verification_ids.includes(current)) return [];
    return [{ case_id: caseId, path: "/verification_id", value: selection.verification_claim_id,
      obligation_id: selection.field }];
  }));
}
