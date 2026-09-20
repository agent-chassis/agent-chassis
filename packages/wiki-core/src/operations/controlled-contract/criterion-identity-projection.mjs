

import { ACCEPTANCE_CRITERION_METADATA_KEYS } from
  "../../lib/work-record-ready-slice-contract.mjs";

const IDENTITY_OMITTED_CRITERION_KEYS = new Set(ACCEPTANCE_CRITERION_METADATA_KEYS);

export function criterionIdentityInput(criterion) {
  if (criterion === null || typeof criterion !== "object" || Array.isArray(criterion)) {
    return criterion;
  }
  const projected = {};
  for (const [key, value] of Object.entries(criterion)) {
    if (IDENTITY_OMITTED_CRITERION_KEYS.has(key)) continue;
    projected[key] = structuredClone(value);
  }
  return projected;
}

export function criterionIdentityInputs(criteria) {
  return Array.isArray(criteria) ? criteria.map(criterionIdentityInput) : criteria;
}
