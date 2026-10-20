

const object = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });
const text = { type: 'string', minLength: 1 };
const localKey = { type: 'string', pattern: '^\\$[A-Za-z][A-Za-z0-9_-]*$' };
const absent = { type: 'array', minItems: 1, uniqueItems: true, items: text };
const value = { anyOf: [{ type: 'object', additionalProperties: true },
  { type: 'array', items: { type: 'object', additionalProperties: true } },
  ...['string', 'number', 'boolean', 'null'].map(type => ({ type }))] };
const pattern = fields => ({ ...object(Object.fromEntries([...fields.map(field => [field, value]), ['absent', absent]]), []), minProperties: 1 });
const requirementPattern = pattern(['subject', 'modality', 'nature', 'definition', 'behavior', 'membership', 'applies', 'for_each', 'within', 'user_requirement', 'user_requirement_occurrence', 'verification']);
const statementPattern = pattern(['subject', 'modality', 'nature', 'behavior', 'relation', 'objects', 'applies', 'for_each', 'within', 'membership']);
const verificationPattern = pattern(['method', 'verifier', 'observes', 'fails_when', 'runtime_test']);
const kind = name => ({ type: 'string', const: name });
const requirement = { oneOf: [object({ kind: kind('requirement'), match: requirementPattern }, ['kind', 'match']),
  object({ kind: kind('requirement'), obligation: text }, ['kind', 'obligation'])] };

export function buildPublicSelectionSchema({ kinds, allowLocalKeys = false }) {
  const schemas = {
    requirement,
    claim: object({ kind: kind('claim'), requirement: allowLocalKeys ? { oneOf: [requirement, localKey] } : requirement,
      match: statementPattern }, ['kind', 'requirement', 'match']),
    verification: { oneOf: [object({ kind: kind('verification'), requirement, match: verificationPattern }, ['kind', 'requirement']),
      object({ kind: kind('verification'), case: text }, ['kind', 'case'])] },
    collection: object({ kind: kind('collection'), match: { ...pattern(['kind', 'purpose', 'members']), properties: {
      kind: text, purpose: text, members: { type: 'array', items: requirement }, absent } } }, ['kind', 'match']),
    case: object({ kind: kind('case'), id: text }, ['kind', 'id']),
    obligation: object({ kind: kind('obligation'), id: text }, ['kind', 'id']),
    criterion: object({ kind: kind('criterion'), match: { ...object({ text, typed_identity: text }, []), minProperties: 1 } }, ['kind', 'match']),
    unresolved: object({ kind: kind('unresolved'), match: object({ text, reason: text, candidate_concept: text,
      absent: { ...absent, items: { enum: ['reason', 'candidate_concept'] } } }, ['text']) }, ['kind', 'match']),
    entity: object({ kind: kind('entity'), identity: { type: 'object', minProperties: 1, additionalProperties: true }, type_term: text }, ['kind', 'identity'])
  };
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(name => !Object.hasOwn(schemas, name)))
    throw new TypeError('Public selector kinds must name a nonempty supported set.');
  const options = [...new Set(kinds)].map(name => structuredClone(schemas[name]));
  if (allowLocalKeys) options.push(structuredClone(localKey));
  return options.length === 1 ? options[0] : { oneOf: options };
}
