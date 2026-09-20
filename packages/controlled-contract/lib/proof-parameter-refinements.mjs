
export function referenceRoleCardinalityMatches(role, count) {
  return !((role.cardinality === 'exactly_one' && count !== 1) ||
    (role.cardinality === 'one_or_more' && count < 1) ||
    (role.cardinality === 'zero_or_one' && count > 1));
}

export const referenceRoleTypeMatches = (role, type) => role.allowed_type_terms.includes(type);
export const referenceRoleIdentityMatches = (role, kind) => !role.allowed_identity_kinds || role.allowed_identity_kinds.includes(kind);
export function referenceRoleValueMatches(role, reference) {
  return (reference.type_term === undefined || referenceRoleTypeMatches(role, reference.type_term)) &&
    referenceRoleIdentityMatches(role, reference.identity.kind);
}

export function inspectReferenceRole(role, references) {
  if (references === undefined) return { status: 'missing' };
  const cardinality = referenceRoleCardinalityMatches(role, references.length);
  const invalid = references.map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => !referenceRoleValueMatches(role, reference));
  return { status: cardinality && invalid.length === 0 ? 'available' : 'incompatible',
    cardinality, invalid_indices: invalid.map(({ index }) => index) };
}
