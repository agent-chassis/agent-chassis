

export const MODALITIES = Object.freeze(['MUST', 'MAY']);
export const CLOSURE = 'closed';
export const GOVERNS = 'membership';
const MEMBER = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const IMPLICIT = Object.freeze(['class', 'predicate', 'members_where', 'all_of_type']);
const MAY_LIMIT = 12;
const byMember = (left, right) => left.member < right.member ? -1 : left.member > right.member ? 1 : 0;

export function normalizeClauses(value, field, refuse) {
  if (!Array.isArray(value) || !value.length) refuse(field, 'must be a nonempty list of MUST/MAY clauses',
    '[{ modality: "MUST" | "MAY", member }]');
  const seen = new Map();
  const clauses = value.map((clause, index) => {
    const at = `${field}[${index}]`;
    if (clause === null || typeof clause !== 'object' || Array.isArray(clause)) refuse(at, 'must be an object',
      ['modality', 'member']);
    for (const key of Object.keys(clause)) {

      if (IMPLICIT.includes(key)) refuse(`${at}.${key}`,
        'identifies members by a class or predicate, which this prototype cannot represent', ['modality', 'member'],
        'name the members explicitly, or keep the clause as an open item of category missing_catalog_capability',
        { kind: 'unsupported_form', capability: 'closed population identified by a defined class or predicate' });
      if (key !== 'modality' && key !== 'member') refuse(`${at}.${key}`, 'is not a field of a clause',
        ['modality', 'member'], `remove ${key}`);
    }
    if (!MODALITIES.includes(clause.modality)) refuse(`${at}.modality`,
      `${JSON.stringify(clause.modality)} is not a clause modality`, MODALITIES,
      clause.modality === 'MUST_NOT' ? 'omit the member: a closed specification forbids everything it does not list'
        : typeof clause.modality === 'string' && MODALITIES.includes(clause.modality.toUpperCase())
          ? `use ${JSON.stringify(clause.modality.toUpperCase())}` : 'use "MUST" or "MAY"');
    if (typeof clause.member !== 'string' || !MEMBER.test(clause.member)) refuse(`${at}.member`,
      'must name one member', 'letters, digits and . _ : / - with no spaces');
    if (seen.has(clause.member)) refuse(`${at}.member`,
      `${clause.member} already has a ${seen.get(clause.member)} clause`, null, 'state each member once');
    seen.set(clause.member, clause.modality);
    return { member: clause.member, modality: clause.modality };
  });
  return { closure: CLOSURE, governs: GOVERNS, clauses: clauses.sort(byMember) };
}

export function normalizeMembers(value, field, refuse) {
  if (!Array.isArray(value) || !value.length) refuse(field, 'must be a nonempty list of member names', 'member names');
  value.forEach((member, index) => {
    if (typeof member !== 'string' || !MEMBER.test(member)) refuse(`${field}[${index}]`, 'must name one member',
      'letters, digits and . _ : / - with no spaces');
  });
  if (new Set(value).size !== value.length) refuse(field, 'names a member twice', null, 'state each member once');
  return [...value].sort();
}

export function derive(specification) {
  return { required: specification.clauses.filter(row => row.modality === 'MUST').map(row => row.member),
    permitted: specification.clauses.map(row => row.member) };
}

const literal = members => `[${members.map(member => JSON.stringify(member)).join(', ')}]`;

export function conformityExpression(specification, present, { memberLiteral = JSON.stringify, permittedPredicate = null } = {}) {
  const { required, permitted } = derive(specification);
  const list = values => `[${values.map(memberLiteral).join(', ')}]`;
  return `${list(required)}.all(m, m in ${present}) && ${present}.all(m, ${permittedPredicate ?? `m in ${list(permitted)}`})`;
}
export const requiredExpression = (members, present) => `${literal(members)}.all(m, m in ${present})`;
export const memberListLiteral = literal;

export function assessMembership(specification, present) {
  const { required, permitted } = derive(specification);
  const violations = [...required.filter(member => !present.includes(member))
    .map(member => ({ kind: 'must_member_absent', member })),
  ...[...new Set(present)].filter(member => !permitted.includes(member))
    .map(member => ({ kind: 'closure_member_not_permitted', member }))];
  return { conforms: violations.length === 0, violations };
}

export function clauseDifferences(required, described) {
  const before = new Map(required.clauses.map(row => [row.member, row.modality]));
  const after = new Map(described.clauses.map(row => [row.member, row.modality]));
  const rows = [];
  for (const member of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const was = before.get(member) ?? null;
    const is = after.get(member) ?? null;
    if (was === is) continue;
    rows.push({ member, required: was, described: is,
      text: was === null ? `${member} is not in the requirement; the description permits it as ${is}`
        : is === null ? `${member} is ${was} in the requirement; the description does not list it, so forbids it`
          : `${member} changed from ${was} to ${is}` });
  }
  if (required.closure !== described.closure || required.governs !== described.governs) rows.push({ member: null,
    required: `${required.closure} ${required.governs}`, described: `${described.closure} ${described.governs}`,
    text: `closure changed from ${required.closure} ${required.governs} to ${described.closure} ${described.governs}` });
  return rows;
}

export const renderClauses = specification => specification.clauses.map(row => `${row.modality} ${row.member}`).join(', ');

export function allowedMemberSets(specification) {
  const { required } = derive(specification);
  const optional = specification.clauses.filter(row => row.modality === 'MAY').map(row => row.member);
  if (optional.length > MAY_LIMIT) return null;
  const sets = [];
  for (let mask = 0; mask < 2 ** optional.length; mask += 1) {
    sets.push([...required, ...optional.filter((member, index) => mask & (1 << index))].sort());
  }
  return sets.sort((left, right) => left.length - right.length || (left.join('\u0000') < right.join('\u0000') ? -1 : 1));
}

export function membershipEffect(original, changed) {
  const before = allowedMemberSets(original);
  const after = allowedMemberSets(changed);
  if (before === null || after === null) return { relation: 'not_computed', reason: 'too many MAY members to enumerate' };
  const key = set => set.join('\u0000');
  const was = new Set(before.map(key));
  const is = new Set(after.map(key));
  const removed = before.filter(set => !is.has(key(set)));
  const added = after.filter(set => !was.has(key(set)));
  const modality = specification => new Map(specification.clauses.map(row => [row.member, row.modality]));
  const [old, now] = [modality(original), modality(changed)];
  return { relation: !removed.length && !added.length ? 'same_allowed_sets' : !added.length ? 'narrows_allowed_sets'
    : !removed.length ? 'expands_allowed_sets' : 'changes_allowed_sets',
  allowed_before: before, allowed_after: after, no_longer_allowed: removed, newly_allowed: added,
  requirements_added: [...now].filter(([member, value]) => value === 'MUST' && old.get(member) !== 'MUST').map(([member]) => member),
  requirements_removed: [...old].filter(([member, value]) => value === 'MUST' && now.get(member) !== 'MUST').map(([member]) => member),
  permissions_added: [...now.keys()].filter(member => !old.has(member)),
  permissions_removed: [...old.keys()].filter(member => !now.has(member)) };
}
