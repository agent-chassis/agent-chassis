

import { NATIVE_CONTRACT_SCHEMA_V1 } from '@agent-chassis/controlled-contract/native-contract';
import { REQUIREMENT_SOURCE_PASSAGES_SCHEMA } from '../../lib/requirement-source-passage-schema.mjs';
export const RECORD_AUTHORING_LABEL_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
export const RECORD_AUTHORING_LABEL_REFERENCE_PATTERN = '^\\$[a-z][a-z0-9-]{0,63}$';
const object = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });
const text = { type: 'string', minLength: 1 };
const localKey = { type: 'string', pattern: RECORD_AUTHORING_LABEL_REFERENCE_PATTERN,
  description: 'A $key declared in this request, in one shared label namespace. Its kind must fit this association; it selects no saved identity.' };
const absent = { type: 'array', minItems: 1, uniqueItems: true, items: text };
const value = { anyOf: [{ type: 'object', additionalProperties: true },
  { type: 'array', items: { type: 'object', additionalProperties: true } },
  ...['string', 'number', 'boolean', 'null'].map(type => ({ type }))] };
const readbackObject = { type: 'object', additionalProperties: true,
  description: 'A partial object pattern from public readback; match every supplied field without expanding its associations.' };
const entityPattern = { ...object({ type_term: text, identity: readbackObject }, []),
  description: 'A partial public entity pattern: type_term and/or identity, not a request-local entity label.' };
const patternValues = { subject: entityPattern, verifier: entityPattern,
  behavior: readbackObject, observes: readbackObject, fails_when: readbackObject, runtime_test: readbackObject,
  modality: text, nature: text, relation: text, method: text, definition: { type: 'boolean' },
  user_requirement: text, user_requirement_occurrence: { type: 'integer', minimum: 1 } };
const pattern = fields => ({ ...object(Object.fromEntries([...fields.map(field => [field, patternValues[field] ?? value]), ['absent', absent]]), []), minProperties: 1 });
const requirementPattern = pattern(['subject', 'modality', 'nature', 'definition', 'behavior', 'membership', 'applies', 'for_each', 'within', 'user_requirement', 'user_requirement_occurrence', 'verification']);
const statementPattern = pattern(['subject', 'modality', 'nature', 'behavior', 'relation', 'objects', 'applies', 'for_each', 'within', 'membership']);
const verificationPattern = pattern(['method', 'verifier', 'observes', 'fails_when', 'runtime_test']);
const kind = name => ({ type: 'string', const: name });
const requirement = { oneOf: [object({ kind: kind('requirement'), match: requirementPattern }, ['kind', 'match']),
  object({ kind: kind('requirement'), obligation: text }, ['kind', 'obligation'])] };

export function unresolvedMeaningSelector(meaning) {
  const match = Object.fromEntries(['text', 'reason', 'candidate_concept'].filter(key => meaning[key] !== undefined)
    .map(key => [key, meaning[key]]));
  if (meaning.source_passages === undefined) match.absent = ['source_passages'];
  else match.source_passages = meaning.source_passages.map(({ user_requirement, user_requirement_occurrence }) => ({
    user_requirement, ...(user_requirement_occurrence === undefined ? {} : { user_requirement_occurrence }) }));
  return { kind: 'unresolved', match };
}

export function buildPublicSelectionSchema({ kinds, allowLocalKeys = false }) {
  const schemas = {
    requirement,
    claim: object({ kind: kind('claim'), requirement: allowLocalKeys ? { oneOf: [requirement, localKey] } : requirement,
      match: statementPattern }, ['kind', 'requirement', 'match']),
    verification: { oneOf: [object({ kind: kind('verification'), requirement, match: verificationPattern }, ['kind', 'requirement']),
      object({ kind: kind('verification'), case: text }, ['kind', 'case'])] },
    collection: object({ kind: kind('collection'), match: { ...pattern(['kind', 'purpose', 'members']), properties: {
      kind: { enum: [...NATIVE_CONTRACT_SCHEMA_V1.$defs.collection.properties.collection_kind.enum] },
      purpose: text, members: { type: 'array', items: requirement }, absent } } }, ['kind', 'match']),
    case: object({ kind: kind('case'), id: text }, ['kind', 'id']),
    obligation: object({ kind: kind('obligation'), id: text }, ['kind', 'id']),
    criterion: object({ kind: kind('criterion'), match: { ...object({ text, typed_identity: text }, []), minProperties: 1 } }, ['kind', 'match']),
    unresolved: object({ kind: kind('unresolved'), match: object({ text, reason: text, candidate_concept: text,
      source_passages: { ...REQUIREMENT_SOURCE_PASSAGES_SCHEMA,
        description: 'The complete saved passage list. Match authored text and any supplied occurrence, including stale bindings; never rebind against current prose. Omitted occurrence leaves that choice unconstrained.' },
      absent: { ...absent, items: { enum: ['reason', 'candidate_concept', 'source_passages'] } } }, ['text']) }, ['kind', 'match']),
    entity: object({ kind: kind('entity'), identity: { type: 'object', minProperties: 1, additionalProperties: true }, type_term: text }, ['kind', 'identity'])
  };
  if (!Array.isArray(kinds) || !kinds.length || kinds.some(name => !Object.hasOwn(schemas, name)))
    throw new TypeError('Public selector kinds must name a nonempty supported set.');
  const options = [...new Set(kinds)].map(name => structuredClone(schemas[name]));
  if (allowLocalKeys) options.push(structuredClone(localKey));
  return options.length === 1 ? options[0] : { oneOf: options };
}
