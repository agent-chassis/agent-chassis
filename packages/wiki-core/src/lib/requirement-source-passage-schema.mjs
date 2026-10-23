

export const REQUIREMENT_SOURCE_PASSAGES_SCHEMA = Object.freeze({
  type: 'array', minItems: 1, maxItems: 64,
  description: 'Caller-authored exact passages of sections.user_requirements. Choose user_requirement_occurrence where repeated. Omission infers no source binding.',
  items: Object.freeze({ type: 'object', additionalProperties: false, required: ['user_requirement'],
    properties: Object.freeze({ user_requirement: { type: 'string', minLength: 1 },
      user_requirement_occurrence: { type: 'integer', minimum: 1 } }) })
});
