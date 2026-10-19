
const fields = ['label', 'owner', 'address'];
const value = referent => ({ value: { referent } });
const verification = () => ({ method: 'analysis', verifier: 'comparison-check',
  observes: { relation: 'reference:covers', objects: [{ referent: 'before-record' }, { referent: 'after-record' }] },
  fails_when: { relation: 'value:not_equals', objects: [value('before-record')] } });
const observation = (subject, root) => ({ subject, definition: true,
  behavior: { relation: 'value:observed_at', objects: [{ observation: {
    operation: 'edit-record', occurrence: 'call', root, path: [],
    type: { record: { fields: fields.map(name => ({ name, type: 'string', presence: 'required' })) } },
    snapshot: { subject: 'protected-fields', boundary: 'call' }
  } }] } });
const verifierDeclaration = { type_term: 'cc:test', identity: { kind: 'durable_id', domain: 'example-verifiers', value: 'comparison-check' } };
const literal = value => ({ value: { literal: typeof value === 'boolean' ? { boolValue: value } : { stringValue: value } } });
const captured = (subject, operation, root, path, type, snapshot) => ({ subject, definition: true,
  behavior: { relation: 'value:observed_at', objects: [{ observation: { operation, occurrence: 'call', root,
    path: path.map(field => ({ field })), type, ...(snapshot ? { snapshot: { subject: snapshot, boundary: 'call' } } : {}) } }] } });
const analysis = (subjects, fails_when) => ({ method: 'analysis', verifier: 'comparison-check',
  observes: { relation: 'reference:covers', objects: subjects.map(referent => ({ referent })) }, fails_when });
const exampleRead = name => ({ tool: 'workspace_read_wiki', arguments: {
  subject: { requirement_guidance: true, topic: ['compact_record_comparison', name] } } });
export const COMPACT_RECORD_PATTERN = Object.freeze({
  applicability: 'Group only fields with identical applicability, observation boundary and comparison semantics. The capture projects exactly label, owner and address from the same record at the same edit call; other fields are outside this invariant. Author separate rows where these conditions differ.',
  batch: { entities: { 'edit-record': 'cc:operation', call: 'cc:event', 'protected-fields': 'cc:state',
    'before-record': 'cc:state', 'after-record': 'cc:state', 'comparison-check': verifierDeclaration },
  requirements: [observation('before-record', 'before'), observation('after-record', 'after'),
    { key: 'protected', subject: 'after-record', modality: 'MUST',
      behavior: { relation: 'value:equals', objects: [value('before-record')] }, verification: verification(),
      user_requirement: 'The edit preserves label, owner and address.' }] },
  controls: { before: { label: 'A', owner: 'B', address: 'C', note: 'old' },
    after: { label: 'A', owner: 'B', address: 'C', note: 'new' },
    projection: fields, expected: 'conforms after projecting the protected fields; changing any protected field violates; a missing capture never conforms' },
  capture: 'The observer supplies exactly the protected projection for both snapshots of the same record at the same edit occurrence, before entry and after settlement. A typed record does not automatically project a larger object: passing the whole entry with a note is not this capture. Alternatively author supported field paths into the actual captured root. Equality of settled values does not prohibit a transient UI edit followed by restoration; retain any intended UI prohibition as unresolved until separately specified and observed.',
  planned_operation_read: exampleRead('planned_operation'),
  next_calls: [exampleRead('independent_expected'), exampleRead('conditional_boundary')],
  independent_expected: {
    source: 'The operation returns the configured label.',
    capture: 'completion is the actual read-label reply. before.label is obtained independently from authoritative configuration for that same operation occurrence, before entry. Capture the complete reply and the actual configuration field; do not copy the reply into the expected observation. The supplied metadata and correlation must be trustworthy; CEL does not authenticate the observer or execute the saved verification declaration.',
    batch: { entities: { 'read-label': 'cc:operation', call: 'cc:event', configuration: 'cc:state',
      actual: 'cc:state', expected: 'cc:state', 'comparison-check': verifierDeclaration },
    requirements: [captured('actual', 'read-label', 'completion', [], 'string'),
      captured('expected', 'read-label', 'before', ['label'], 'string', 'configuration'),
      { key: 'configured-label', subject: 'actual', modality: 'MUST',
        behavior: { relation: 'value:equals', objects: [value('expected')] },
        verification: analysis(['actual', 'expected'], { relation: 'value:not_equals', objects: [value('expected')] }),
        user_requirement: 'The operation returns the configured label.' }] },
    controls: { correct: 'Actual and independently configured labels agree.', wrong: 'Reply differs from the independently configured label.',
      copied: 'Copying a wrong reply into before.label can satisfy equality but violates the independent-capture assumption.',
      missing: 'A missing actual reply or independent configuration observation never establishes compliance.' }
  },
  conditional_boundary: {
    source: 'When eligible, the operation reports enabled. The required ineligible behavior is undecided.',
    boundary: 'This is a bounded one-way predicate, not a complete behavior specification. choose(condition, predicate, true) is true when the condition is false, regardless of the predicate. That branch remains unconstrained by this predicate. Do not use it as an automatic repair, add blanket MAY permissions or remove unresolved source meaning. Specify complementary behavior only from a source decision. Closed permissions and the empty-search warning in the selected relation definition still apply.',
    capture: 'arguments.eligible is the actual eligibility of this occurrence; completion is its actual reported mode. Test both condition branches with independent observations, including a contrary result while active and multiple results while inactive.',
    batch: { entities: { 'report-mode': 'cc:operation', call: 'cc:event', eligible: 'cc:state', reported: 'cc:state',
      matches: 'cc:state', 'one-way': 'cc:state', 'comparison-check': verifierDeclaration },
    requirements: [captured('eligible', 'report-mode', 'arguments', ['eligible'], 'bool'),
      captured('reported', 'report-mode', 'completion', [], 'string'),
      { subject: 'matches', definition: true, behavior: { relation: 'value:equal_to', objects: [value('reported'), literal('enabled')] } },
      { subject: 'one-way', definition: true, behavior: { relation: 'value:choose', objects: [value('eligible'), value('matches'), literal(true)] } },
      { key: 'eligible-mode', subject: 'one-way', modality: 'MUST', behavior: { relation: 'value:equals', objects: [literal(true)] },
        verification: analysis(['eligible', 'reported'], { relation: 'value:not_equals', objects: [literal(true)] }),
        user_requirement: 'When eligible, the operation reports enabled.' }],
    unresolved: [{ text: 'The required ineligible behavior is undecided.', reason: 'ambiguous_semantics' }] },
    evaluation_scope: 'Keep this original saved and incomplete. If evaluating only the stated predicate, save a separate explicitly labelled bounded fragment without the unresolved clause. A passing fragment cannot complete the original or supply its missing behavioral decision.'
  },
  append: { explanation: 'A later batch appends new rows and uses saved row-bound identities without redeclaration. Repeat the matching typed declaration of a verifier-only alias in each batch that uses it: native verification references persist, but aliases used only by verification are not saved row bindings. No extra save is needed. Matching redeclarations are accepted; conflicts are refused.',
    batch: { entities: { 'comparison-check': verifierDeclaration }, requirements: [
      { key: 'reverse', subject: 'before-record', modality: 'MUST',
        behavior: { relation: 'value:equals', objects: [value('after-record')] },
        verification: { ...verification(), fails_when: { relation: 'value:not_equals', objects: [value('after-record')] } } }
    ] } },
  source: 'Keep user_requirements word for word. Link each encoded rule to its exact source passage. Preserve all meaning not encoded in unresolved; omitting unresolved preserves the saved list, supplying it replaces the list. The example establishes no equivalence to arbitrary prose, implementation correctness or proof credit.'
});

const resultType = { record: { fields: [
  { name: 'label', type: 'string', presence: 'required' },
  { name: 'count', type: 'int', presence: 'required' }
] } };
export const PLANNED_OPERATION_PATTERN = Object.freeze({
  source: 'The operation returns the requested payload.',
  author_supplies: 'Choose the new operation id, result fields/types, actual capture paths, required relationship, applicability and exact source passage from the intended contract. This example requires the complete structured reply to equal arguments.requested at the same call; adapt it only where that is the intended behavior. Do not infer values or conditions from prose.',
  batch: { entities: { planned: 'cc:operation', call: 'cc:event', actual: 'cc:state', expected: 'cc:state',
    'comparison-check': verifierDeclaration },
    requirements: [captured('actual', 'planned', 'completion', [], resultType),
      captured('expected', 'planned', 'arguments', ['requested'], resultType),
      { key: 'requested-result', subject: 'actual', modality: 'MUST',
        behavior: { relation: 'value:equals', objects: [value('expected')] },
        verification: analysis(['actual', 'expected'], { relation: 'value:not_equals', objects: [value('expected')] }),
        user_requirement: 'The operation returns the requested payload.' }] },
  meaning: 'completion captures the actual returned object; arguments.requested captures the independently supplied request. Both typed captures define values; MUST equals requires their relationship. A type declaration or existence assertion alone supplies no behavioral rule. Source-symbol equality establishes only equality, not mutation, ordering, preservation or subscription behavior. No implementation symbol is required. Preserve existing return/refinement rules, conditions, source links and intended evidence associations; add applicable definitions and relationships without replacing those rules.',
  preservation_read: { tool: 'workspace_read_wiki', arguments: {
    subject: { requirement_guidance: true, topic: ['compact_record_comparison'] } } },
  preservation: 'Select separately only when before/after preservation is intended; use the protected-field projection and its observation boundary, never equality of an entire larger object. Keep undecided meaning unresolved. Reading, saving and predicate controls execute no verification and grant zero implementation proof credit.'
});
