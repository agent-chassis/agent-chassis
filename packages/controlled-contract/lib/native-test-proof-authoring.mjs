import { NODE_TEST_SELECTOR_KIND, TEST_PROOF_PROVIDER_AUTHORING_FACTS, TEST_PROOF_PROVIDER_CATALOG,
  authoredNativeTestSelector, resolveAuthoredNativeTestTarget, resolveNativeTestSelector, testProofFalsifierProvider,
  testProofSelectorKind, testRuntimeRunner } from './test-proof-provider-registry.mjs';
import schema from './stable-contract-schema-v1.mjs';
import { compiledValidators } from './compiled-validator-cache.mjs';
import { canonicalDigest } from './deterministic-projection-primitives.mjs';

import { ProofAuthoringError } from './proof-contract.mjs';
import { CLOSED_NODE_TEST_TARGET_SCHEMA } from './test-proof-providers/node-test.mjs';

const closed = properties => ({ type: 'object', additionalProperties: false, properties });
const defs = schema.$defs;
const inline = value => {
  if (Array.isArray(value)) return value.map(inline);
  if (value === null || typeof value !== 'object') return value;
  if (value.$ref) {
    let ref = schema;
    for (const key of value.$ref.slice(2).split('/')) ref = ref[key];
    return inline(ref);
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inline(child)]));
};
const nodeSelectorArm = defs.test_selector.oneOf.find(({ required }) => required.includes('name'));
const nativeSelectorArm = defs.test_selector.oneOf.find(({ required }) => required.includes('node_id'));
const nativeMutationBranch = defs.falsifier.allOf.find(branch =>
  branch.if?.properties?.mutation?.properties?.mechanism?.enum !== undefined);
const nativeSourcePath = inline(nativeMutationBranch.then.properties.mutation.properties.module_path);

const nativeCaseTarget = { ...closed({
  provider: { ...closed({ provider_id: inline(nativeSelectorArm.properties.provider_id),
    provider_version: inline(nativeSelectorArm.properties.provider_version) }),
  required: ['provider_id', 'provider_version'] },
  path: nativeSourcePath,
  selector: { ...closed({ node_id: inline(nativeSelectorArm.properties.node_id) }), required: ['node_id'] }
}), required: ['provider', 'path', 'selector'] };
export const NATIVE_TEST_CASE_SCHEMA = closed({
  case_id: { type: "string", pattern: "^case-[a-zA-Z0-9][a-zA-Z0-9._:-]*$" },
  verification_id: inline(defs.claim_id),
  component: { oneOf: [{ ...closed({ reference_id: inline(defs.reference_id) }), required: ['reference_id'] }, { ...closed({ type_term: inline(defs.reference.properties.type_term),
    identity: inline(defs.reference.properties.identity) }), required: ['type_term', 'identity'] }] },
  target: { oneOf: [closed({ path: inline(CLOSED_NODE_TEST_TARGET_SCHEMA), selector: inline({
    ...nodeSelectorArm, required: [] }) }), nativeCaseTarget] },
  observation: closed({ kind: inline(defs.observable_result.properties.kind) }),
  falsification: closed({
    support: { enum: ['provider', 'registry_unsupported'] },
    strategy: { enum: [...new Set(TEST_PROOF_PROVIDER_CATALOG.providers.flatMap(
      provider => provider.falsifier_strategies))] },
    ...Object.fromEntries(['module_path', 'entry_export', 'operation', 'function_name', 'replacement'].map(key => [key,
      inline(key === 'operation' ? { ...defs.falsifier.properties.mutation.properties[key], required: [] }
        : defs.falsifier.properties.mutation.properties[key])])) })
});

const caseFalsificationFields = Object.keys(NATIVE_TEST_CASE_SCHEMA.properties.falsification.properties)
  .filter(field => field !== 'strategy');
function matchesCondition(condition, value) {
  const keys = Object.keys(condition).filter(key => key !== 'type');
  if (keys.some(key => !['properties', 'required'].includes(key))) {
    throw new TypeError(`unsupported falsifier branch condition keyword in ${JSON.stringify(keys)}`);
  }
  if ((condition.required ?? []).some(key => !Object.hasOwn(value, key))) return false;
  return Object.entries(condition.properties ?? {}).every(([key, child]) => {
    if (!Object.hasOwn(value, key)) return true;
    if (Object.hasOwn(child, 'const')) return value[key] === child.const;
    if (Object.hasOwn(child, 'enum')) return child.enum.includes(value[key]);
    return matchesCondition(child, value[key]);
  });
}
function strategyFields(strategy, mechanism) {
  const required = new Set(defs.falsifier.properties.mutation.required);
  const forbidden = new Set();
  for (const branch of defs.falsifier.allOf) {
    const applied = matchesCondition(branch.if, { strategy, mutation: { mechanism } }) ? branch.then : branch.else;
    const mutation = applied?.properties?.mutation ?? {};
    for (const field of mutation.required ?? []) required.add(field);
    for (const alternative of mutation.not?.anyOf ?? []) for (const field of alternative.required) forbidden.add(field);
  }
  const authored = fields => caseFalsificationFields.filter(field => fields.has(field));
  return { required: ['strategy', ...authored(required)], not_allowed: authored(forbidden),
    server_derived: [...required].filter(field => !caseFalsificationFields.includes(field)).sort() };
}

function falsificationFieldPatterns(mechanism, strategies) {
  const mutation = defs.falsifier.properties.mutation.properties;
  const native = nativeMutationBranch.if.properties.mutation.properties.mechanism.enum.includes(mechanism);
  const enforced = { module_path: native ? nativeSourcePath : inline(defs.repo_module_path),
    function_name: inline(mutation.function_name) };
  const required = new Set(strategies.flatMap(strategy => strategyFields(strategy, mechanism).required));
  return Object.fromEntries(Object.entries(enforced).filter(([field, declared]) =>
    required.has(field) && typeof declared.pattern === 'string').map(([field, declared]) => [field, declared.pattern]));
}
const leafFields = (node, prefix = '') => Object.entries(node.properties).flatMap(([field, child]) =>
  child.type === 'object' && child.properties ? leafFields(child, `${prefix}${field}.`) : [`${prefix}${field}`]);
const [nodeTargetArm, storedNativeTargetArm] = NATIVE_TEST_CASE_SCHEMA.properties.target.oneOf;

const structuredSelectors = new Map();
for (const family of TEST_PROOF_PROVIDER_AUTHORING_FACTS.filter(family => family.selector.authored !== undefined)) {
  const { member, schema: declared } = family.selector.authored;
  const alternatives = structuredSelectors.get(member) ?? [];
  if (!alternatives.some(schema => JSON.stringify(schema) === JSON.stringify(declared))) alternatives.push(structuredClone(declared));
  structuredSelectors.set(member, alternatives);
}
const authoredNativeTargetArm = { ...storedNativeTargetArm, properties: { ...storedNativeTargetArm.properties,
  selector: closed({ ...storedNativeTargetArm.properties.selector.properties,
    ...Object.fromEntries([...structuredSelectors].map(([member, anyOf]) => [member, { anyOf }])) }),
  provider: { ...storedNativeTargetArm.properties.provider, properties: { ...storedNativeTargetArm.properties.provider.properties,
    provider_id: { enum: TEST_PROOF_PROVIDER_AUTHORING_FACTS.filter(family => family.selector.provider_qualified)
      .map(family => family.candidate_execution.provider_id) } } } },
  allOf: TEST_PROOF_PROVIDER_AUTHORING_FACTS.filter(family => family.selector.provider_qualified).map(family => {
    const member = family.selector.authored?.member ?? 'node_id';
    return { if: { properties: { provider: { properties: { provider_id: { const: family.candidate_execution.provider_id } }, required: ['provider_id'] } }, required: ['provider'] },
      then: { properties: { provider: { properties: { provider_version: { const: family.candidate_execution.provider_version } } },
        path: family.selector.path_schema,
        selector: { ...closed({ [member]: family.selector.authored?.schema ?? family.selector.literal_schema }), required: [member],
          description: `This provider accepts only selector.${member}. Remove incompatible selector members; preserve any supplied valid ${member} meaning.` } } } };
  }) };
const nodeTargetFields = leafFields(nodeTargetArm);

const nativeTargetFields = member => leafFields(authoredNativeTargetArm).filter(field =>
  !field.startsWith('selector.') || field === `selector.${member}`);
const LITERAL_SELECTOR_MEMBER = Object.keys(storedNativeTargetArm.properties.selector.properties)[0];

const nativeTargetVariant = member => member === LITERAL_SELECTOR_MEMBER ? 'provider_qualified' : `provider_${member}`;
const familySelectorMember = family => family.selector.authored?.member ?? LITERAL_SELECTOR_MEMBER;
const falsifierMechanisms = new Map(TEST_PROOF_PROVIDER_AUTHORING_FACTS.map(({ falsifier_execution: falsifier }) =>
  [falsifier.mechanism, falsifier]));

export const CASE_VERIFICATION_ASSOCIATION_FIELD = 'obligations[].case.verification_id';

export const CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD = 'obligations[].case.verification';

export const CASE_VERIFICATION_OWNERSHIP_RECOVERY = Object.freeze({
  condition: 'verification_owned_by_another_case',
  choices: Object.freeze([Object.freeze({ when: 'same_test', field: 'obligations[].case.id' }),
    Object.freeze({ when: 'different_test', field: 'requirements[].verification' })]),
  correction: 'If the obligation means the saved test, explicitly reuse its saved case with case:{id} in changes.obligations. ' +
    'If it means a different test, preserve the complete requirement and entity declarations in changes.requirements, ' +
    'author distinct verification meaning with verification.key, and use that request-local $key in the intended obligation claims and case.verification. ' +
    'Use the supported semantic target when amending saved meaning. Preserve all other submitted work; no case or verification is chosen automatically.',
  submitted: Object.freeze({ condition: 'competing_submitted_cases',
    correction: 'These submitted cases explicitly select the same verification; none is a saved owner. ' +
      'Decide whether these are distinct tests or genuinely shared evidence. A new case key cannot be used as case.id in the same save, and a batch cannot repeat identical formal predicates merely to add a verification. ' +
      'If staging is acceptable, explicitly choose one complete case/use to save first, label its case.key, and retain the remaining intended uses for a subsequent save. ' +
      'Then follow this diagnostic’s details.recovery.after_initial_save for saved semantic selections and current write context. For shared evidence, use the first receipt’s issued case identity; ' +
      'for a distinct test, author its complete additional verification with verification.key and associate its intended requirement/check and case using this second request’s $keys. ' +
      'Preserve every original requirement, obligation statement, source link, unrelated edit and runtime meaning. If the work must be atomic, stop without publishing: this conflicting population has no supported single-save correction. ' +
      'No test identity, winner, staging decision or correspondence is inferred.' })
});

export const CASE_COMPONENT_FIELD = 'obligations[].case.component';
export const NATIVE_TEST_CASE_AUTHORING_GUIDANCE = deepFreezeGuidance({
  schema_version: 'controlled-contract-native-case-authoring-guidance.v1',
  purpose: 'Author case.target, case.observation and case.falsification for an obligation verified by ' +
    'test_execution: choose the family that runs the test, copy its provider identity, write the selector ' +
    'member its target variant lists in its form, author the observable result the test inspects as ' +
    'case.observation (the derived binding\'s observable_result comes from it), and use the falsification ' +
    'fields of its mechanism. Falsifier providers are server-derived.',
  target_variants: {
    node_test: { fields: nodeTargetFields, path_owner: 'the owning unit work-record node_test declaration',
      path_pattern: nodeTargetArm.properties.path.pattern },
    [nativeTargetVariant(LITERAL_SELECTOR_MEMBER)]: { fields: nativeTargetFields(LITERAL_SELECTOR_MEMBER),
      path_owner: 'the case; path is the source node_id names',
      path_pattern: authoredNativeTargetArm.properties.path.pattern },
    ...Object.fromEntries([...structuredSelectors.keys()].map(member => [nativeTargetVariant(member), {
      fields: nativeTargetFields(member),
      path_owner: `the case; path is the test source file, written once, and selector.${member} holds the ` +
        'values the family form states as the request\'s own JSON array',
      path_pattern: authoredNativeTargetArm.properties.path.pattern }]))
  },

  verification_association: {
    field: CASE_VERIFICATION_ASSOCIATION_FIELD,
    eligible: 'One test_execution verification claim_id the SAME obligation makes eligible: a verification ' +
      'claim it lists in its own controlled_contract_node_ids, or one an explicit verifies relationship ties ' +
      'to a requirement claim it lists there. A requirement already records which verification verifies it, ' +
      'so linking only the requirement claim is enough and the verification identity is not repeated. ' +
      'Eligibility reads these semantic facts alone; whether an executable binding exists never changes it.',
    correction: 'List the requirement claim, or the verification claim_id itself, in the obligation ' +
      "controlled_contract_node_ids, and name an eligible claim_id in the case's verification_id when " +
      'several are eligible. Replacing the verification a saved case names is the same amendment.',
    omission: 'A case may omit verification_id. A saved case that names an eligible verification keeps it. ' +
      'Otherwise exactly one eligible, selectable verification is adopted. With none or several the save still ' +
      'commits and the case stays an unresolved draft that names no verification: nothing is chosen for the ' +
      'author, and the draft cannot be executed.',

    authoring: {
      method: 'test_execution',
      field: CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD,
      links_field: 'obligations[].claims',
      omit_when: 'the case already names an eligible verification, or the obligation claims make exactly one ' +
        'test_execution verification eligible, no other case owns it and no other amended unbound case proposes it: the saved one is kept and the sole one ' +
        'is adopted. A listed requirement makes each verification that verifies it eligible, so claims need not ' +
        'repeat the verification',
      choose_when: 'the obligation claims make several test_execution verifications eligible, listed there or ' +
        'verifying a requirement listed there: name one of them',
      unresolved: 'With no eligible verification, several, one that another case owns, or several amended unbound cases proposing the same one, the save still commits ' +
        'every change and reports the case as a saved incomplete draft with its missing association or complete ' +
        'candidates. One explicit selection, or resubmitting the obligation once its claims make a sole ' +
        'verification eligible, resolves that same case; no case identity or other case member is repeated.'
    },
    derived_from_association: 'Every proposition identity on the derived test binding comes from the ' +
      'named canonical verification claim. Those identities are derived and are never authored: a case ' +
      'that names no eligible verification derives a placeholder binding whose propositions are absent, ' +
      'which validation reports as the unfinished content of that case.',
    identities: 'The guidance member required_object_shapes.requirement_rebinding.complete_case_population ' +
      'states which saved-contract read carries each requirement verification_claim_ids and each case verification_id. ' +
      'Read the identities there; this member states only which combination of them is eligible.',

    cardinality: 'One verification identity belongs to at most one case_id. Several obligations may use one ' +
      'case by naming its case_id; a different case_id naming a verification another case already owns is ' +
      'refused, and nothing is saved.',
    unbound_competition: {
      condition: 'competing_unbound_cases',
      choices: [{ when: 'different_tests', field: 'requirements[].verification',
        then: 'obligations[].case.verification' },
      { when: 'genuinely_shared_evidence', field: 'obligations[].case.id' }],
      correction: 'Several unbound cases can select the same verification. No competitor is an existing owner. ' +
        'If these are different tests, author distinct verification meanings through additional_verification, ' +
        'then explicitly associate each case with its intended verification through save_record. ' +
        'If evidence is genuinely shared, explicitly select a verification for one case and reuse that case ' +
        'only where its test establishes the intended behaviors. An individual explicit selection remains ' +
        'possible; resubmitting competing obligations together does not choose a winner. ' +
        'Preserve original requirements, source links and intended evidence mappings. Never replace unrelated ' +
        'claims with a successful case\'s claim to clear validation. The caller supplies the missing meaning; ' +
        'assessment cannot decide whether tests establish the same behavior.'
    },
    additional_verification: 'A genuinely distinct test of the same requirement needs its own verification. ' +
      'Read the current unit with workspace_read_wiki {subject:<unit>} for its revision and reference. ' +
      'Using that reference, select {contract:"requirements",view:"row",row_id:<saved row_id>} and follow ' +
      'its emitted verifications read. These are templates: use the returned unit, reference and row_id. ' +
      'Preserve the complete row.input meaning, including nature, modality, subject, behavior, applicability, ' +
      'scopes, membership and source link where present. Replace bound entity objects with their ids. ' +
      'Recover verification meaning from the verifications read; resolve its select and runtime boundary ' +
      'references through the returned references. Declare each used entity with type_term and identity, ' +
      'including verifier-only aliases. Native select objects are not batch input. ' +
      'Call save_record with the current unit and revision and changes.requirements:{entities:<declarations>,' +
      'requirements:[<complete requirement row>]}. This is an incomplete template, not an executable call. ' +
      'For the additional test, omit id and row_id, supply a new request-local key, and author a ' +
      'verification that differs in verifier, observes or fails_when. If a read omits required meaning, stop ' +
      'and report that gap; do not guess it. The ' +
      'requirement claims keep their claim_ids; the existing verification, its case and its links are unchanged; ' +
      'label verification.key to receive its identity in bindings.verification. Link that identity beside ' +
      'the requirement claim in changes.obligations[].claims and name it in case.verification. Identical meaning ' +
      'resubmitted returns the same identities. For the same test, explicitly reuse a known saved case with ' +
      'changes.obligations[].case:{id}; the obligation key or id and its meaning remain caller choices. ' +
      'Read back the row, verifications, cases and affected obligations to check the saved relationships. ' +
      'On a stale revision, reread the unit and saved meaning before rebuilding the request.'
  },

  case_identity: {
    field: 'obligations[].case',
    omit_when: 'the case is the obligation\'s own: a new obligation receives a generated case identity and an ' +
      'amended obligation reuses its stored case, keeping every omitted member',
    choose_when: 'case.id deliberately selects a different or shared saved case; case.key labels a new case so ' +
      'its generated identity is returned in bindings.case'
  },

  component: {
    field: CASE_COMPONENT_FIELD,
    forms: '{type_term, identity} names the intended component and reuses a ' +
      'saved reference with that exact type_term and identity.',
    role_constraint: "When the selected proof declares a component parameter, its refinements constrain accepted " +
      "type_terms, identity kinds and cardinality. Inspect that proof's parameter contract when those constraints " +
      "matter. A mismatch is refused with obligation_coverage_prospective_incompatible and the actual failed role.",
    identity_uniqueness: 'One identity names one referent and has one type_term across the contract. A ' +
      '{type_term, identity} whose identity is saved under another type_term is refused ' +
      '(duplicate_reference_identity) with the saved and requested reference. Decide the single type of that ' +
      'referent where it is authored; do not rename it through another identity kind or term to pass.',

    module_source: 'A module test binding derives its runtime module path only from the resolved component ' +
      "identity: {kind: 'repository_path', repository, path} supplies path when it names a module source the schema accepts. A " +
      'profile_term or other descriptive identity names meaning, not a source location, and supplies no ' +
      'module path even when its term mentions a file. Author the actual repository and path; the module ' +
      'path itself is derived and never authored.',
    identities: "The unit's workspace_read_wiki selection {contract: 'references'} returns authored type_term and identity meaning."
  },

  observation: {
    field: 'obligations[].case.observation',
    purpose: 'An object whose kind classifies the observable result the test inspects. Assertion prose or a ' +
      'description of expected behavior is not an observation value. Choose kind for the result the test ' +
      'actually inspects; no kind is a default.',
    input_schema: structuredClone(NATIVE_TEST_CASE_SCHEMA.properties.observation)
  },

  support_states: {
    candidate_proof: 'discovery lexically matched a catalog proof; not a capability fact',
    listed_family: 'a listed family runs the language; not a target fact',
    family_absent: 'no listed family owns that source suffix or runner; the catalog lists none for it',
    request_invalid: 'the save refused the request shape, an unknown provider_id, or a provider_version the catalog does not list; a request defect is not a fact about the target, the family or the language',
    target_selector_valid: 'save accepted provider, path and selector form',
    target_uninspected: 'A planned test may be named before implementation. Save validates the target form; test existence and falsifier target shape are checked only when verify_proof runs',
    unsupported_demonstrated: 'a verify_proof attempt refused this exact target with one of its mechanism target_constraint refusal_codes and reasons',
    unresolved: 'An unknown execution fact is not an authored gap. Keep acceptance required and select the proof; omit an unknown execution case. If supplying a case, complete its authored inputs and choose a listed strategy or the explicit no-falsifier form. Never substitute that form for malformed supplied mechanics'
  },
  target_shape_limits: 'A mechanism mutates only the shape its target_constraint states, and a listed family is no assurance that the code under test has that shape. Author the case for the behavior the obligation requires: when no accepted shape exists, author the case without a falsifier and keep the obligation required. Do not add, export or reshape a production function so that it fits the mutation.',
  falsification_support: {
    provider: 'the case declares a falsifier: author strategy and its mechanism fields',
    registry_unsupported: 'Falsification is optional: {support: "registry_unsupported"} declares no falsifier for this case, without separate permission, installation-wide provider absence or a failed mutation attempt. Acceptance remains required. The selected test can pass and its execution evaluation can be satisfied; absent falsification supplies no detection evidence and that pass does not establish the linked requirement behavior. verify_proof reports the limitation and the actual requirement relationship; nothing is retried, waived or installed for it'
  },
  falsification: Object.fromEntries([...falsifierMechanisms].map(([mechanism, falsifier]) => [mechanism, {
    strategies: Object.fromEntries(falsifier.strategies.map(strategy =>
      [strategy, strategyFields(strategy, mechanism)])),
    field_patterns: falsificationFieldPatterns(mechanism, falsifier.strategies),
    target_constraint: falsifier.target_constraint
  }])),

  families: Object.fromEntries(TEST_PROOF_PROVIDER_AUTHORING_FACTS.map(family => [family.family_id, {
    languages: family.languages, runner: testRuntimeRunner({ runnerId: family.runner_id }).name,
    target_variant: family.selector.provider_qualified ? nativeTargetVariant(familySelectorMember(family)) : 'node_test',
    ...(family.selector.provider_qualified ? { provider: {
      provider_id: family.candidate_execution.provider_id,
      provider_version: family.candidate_execution.provider_version } } : {}),
    ...(family.selector.authored !== undefined
      ? { [`${family.selector.authored.member}_form`]: family.selector.authored.form }
      : family.selector.node_id_form === null ? {} : { node_id_form: family.selector.node_id_form }),
    source_suffixes: family.selector.source_suffixes,
    falsification: family.falsifier_execution.mechanism
  }]))
});
function deepFreezeGuidance(value) {
  if (value && typeof value === 'object') for (const child of Object.values(value)) deepFreezeGuidance(child);
  return Object.freeze(value);
}
const nullable = value => ({ anyOf: [structuredClone(value), { type: 'null' }] });
const nativeCaseProperties = NATIVE_TEST_CASE_SCHEMA.properties;
const nativeFalsificationProperties = nativeCaseProperties.falsification.properties;
const nativeOperation = nativeFalsificationProperties.operation;

export const NATIVE_TEST_CASE_AMENDMENT_SCHEMA = closed({
  ...nativeCaseProperties,
  target: { oneOf: [nodeTargetArm, authoredNativeTargetArm] },
  falsification: nullable(closed({
    ...nativeFalsificationProperties,
    strategy: nullable(nativeFalsificationProperties.strategy),
    support: nativeFalsificationProperties.support,
    module_path: nullable(nativeFalsificationProperties.module_path),
    entry_export: nullable(nativeFalsificationProperties.entry_export),
    function_name: nullable(nativeFalsificationProperties.function_name),
    replacement: nullable(nativeFalsificationProperties.replacement),
    operation: nullable(closed({
      ...nativeOperation.properties,
      module_path: nullable(nativeOperation.properties.module_path),
      export_name: nullable(nativeOperation.properties.export_name)
    }))
  }))
});
const completeSchema = structuredClone(schema);
completeSchema.properties.test_proofs.items = { $ref: '#/$defs/test_proof_binding' };
for (const name of ['references', 'propositions', 'claims']) completeSchema.properties[name].minItems = 1;
export const { validateCompleteNativeTestProof, validateCompleteNativeContract, validateNativeTestCase } =
  await compiledValidators('controlled-contract.native-test-authoring.v1', { validators: {
    validateCompleteNativeTestProof: { ...defs.test_proof_binding, $defs: defs },
    validateCompleteNativeContract: completeSchema,
    validateNativeTestCase: NATIVE_TEST_CASE_SCHEMA
  } });

const same = (a, b) => canonicalDigest(a) === canonicalDigest(b);
const providerSelectorKind = provider => TEST_PROOF_PROVIDER_CATALOG.providers.find(descriptor =>
  descriptor.provider_id === provider?.provider_id)?.selector_kind;
const runtimeModulePathPatterns = defs.system_under_test_boundary.properties.runtime_module_path.anyOf
  .map(entry => new RegExp(inline(entry).pattern, 'u'));
export const isNativeCaseTarget = target => target !== null && typeof target === 'object' &&
  Object.hasOwn(target, 'provider');

export function resolveNativeCaseTarget(target) {
  const resolved = resolveNativeTestSelector({ provider_id: target?.provider?.provider_id,
    provider_version: target?.provider?.provider_version, node_id: target?.selector?.node_id },
  { path: target?.path, pointer: '/target' });
  if (!resolved.valid) throw new ProofAuthoringError('case_target_invalid',
    'A native case target must be one listed provider-qualified literal selection of its own source path', {
      pointer: resolved.pointer, expected: resolved.expected_identity, actual: resolved.actual_identity });
  return resolved;
}

const CASE_TARGET_FIELD = 'obligations[].case.target';
const caseTargetField = pointer => `${CASE_TARGET_FIELD}${pointer.replace(/^\/target/u, '').replaceAll('/', '.')}`;

export function storedNativeCaseTarget(target) {
  if (!isNativeCaseTarget(target)) return target;
  const resolved = resolveAuthoredNativeTestTarget(target, { pointer: '/target' });
  if (!resolved.valid) {
    const replacement = resolved.replacement_member === undefined ? null
      : `${CASE_TARGET_FIELD}.selector.${resolved.replacement_member}`;
    throw new ProofAuthoringError('case_target_invalid', replacement === null
      ? 'A native case target must satisfy the rule its listed provider states for the named member'
      : 'This provider takes another selector member; the named one is not an input of its case target', {
      pointer: resolved.pointer, field: caseTargetField(resolved.pointer), expected: resolved.expected_identity,
      actual: resolved.actual_identity,
      ...(replacement === null ? {} : resolved.replacement_valid === true ? { preserve_field: replacement,
        correction: `Remove the incompatible selector member and retain the supplied selector.${resolved.replacement_member} unchanged; it already satisfies this provider's selection rule.` }
        : { correction_field: replacement,
        correction: `Remove this member and ${resolved.replacement_present ? 'correct the supplied' : 'author'} selector.${resolved.replacement_member} for this provider: ` +
          `${resolved.expected_identity.slice(`selector.${resolved.replacement_member}: `.length)}. ` +
          'The provider derives the stored test identity from it; no serialized identity is authored.' }) });
  }
  return { provider: { provider_id: resolved.provider_id, provider_version: resolved.provider_version },
    path: resolved.path, selector: { node_id: resolved.node_id } };
}

export function authorableNativeCaseTarget(target) {
  if (!isNativeCaseTarget(target)) return target;
  return { ...target, selector: authoredNativeTestSelector({ provider_id: target.provider?.provider_id,
    provider_version: target.provider?.provider_version, node_id: target.selector?.node_id }) };
}
export function linkedNativeTestProofs(contract, row) {
  if (row.case_id) return contract.test_proofs.filter(proof => proof.test_proof_id ===
    `test-proof-${canonicalDigest({ case_id: row.case_id }).slice(0,40)}`);
  const links = new Set(row.controlled_contract_node_ids ?? []);
  for (const relation of contract.relations) if (relation.role === 'verifies' && links.has(relation.target_claim_id)) {
    links.add(relation.source_claim_id);
  }
  return contract.test_proofs.filter(proof => links.has(proof.verification_claim_id));
}

export function eligibleCaseVerificationIds(contract, row) {
  const named = new Set(row.controlled_contract_node_ids ?? []);
  const verifying = new Set((contract.relations ?? []).filter(relation => relation.role === 'verifies' &&
    named.has(relation.target_claim_id)).map(relation => relation.source_claim_id));
  return [...new Set((contract.claims ?? []).filter(claim => claim.kind === 'verification' &&
    claim.verification_method === 'test_execution' && (named.has(claim.claim_id) || verifying.has(claim.claim_id)))
    .map(claim => claim.claim_id))].sort();
}

export function caseUseExcludesVerification(row, verificationId, verificationClaimIds) {
  const known = (row.controlled_contract_node_ids ?? []).filter(id => verificationClaimIds.has(id));
  return known.length > 0 && !known.includes(verificationId);
}

export function boundVerificationClaim(contract, verificationId, identity = {}) {
  const claim = contract.claims.find(candidate => candidate.claim_id === verificationId &&
    candidate.kind === 'verification' && candidate.verification_method === 'test_execution');
  if (claim === undefined) throw new ProofAuthoringError('case_verification_unlinked',
    'The verification identity this case names is not a test_execution verification claim the contract carries',
    { ...identity, verification_claim_id: verificationId });
  return claim;
}

function mergeKnown(target, changes) {
  for (const [key, value] of Object.entries(changes)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      target[key] ??= {}; mergeKnown(target[key], value);
    } else target[key] = structuredClone(value);
  }
  return target;
}

function caseTargetSelectorKind(target, binding) {
  if (isNativeCaseTarget(target)) return resolveNativeCaseTarget(target).selector_kind;
  if (target !== undefined && target !== null) return NODE_TEST_SELECTOR_KIND;
  if (Object.hasOwn(binding.test_selector ?? {}, 'provider_id')) {
    return testProofSelectorKind({ ...binding.test_selector, node_id: binding.test_selector.node_id ?? '' }) ?? undefined;
  }
  return binding.test_selector === undefined ? undefined : NODE_TEST_SELECTOR_KIND;
}

function caseSelectorKind(target, binding, strategy) {
  const kind = caseTargetSelectorKind(target, binding);
  if (kind === undefined || testProofFalsifierProvider(kind, strategy) !== null) return kind;
  throw new ProofAuthoringError('case_falsification_unsupported',
    'The case target provider family does not implement this falsification strategy', {
      strategy, selector_kind: kind,
      strategies: TEST_PROOF_PROVIDER_CATALOG.providers.filter(provider => provider.selector_kind === kind)
        .flatMap(provider => provider.falsifier_strategies) });
}

export function applyNativeTestProofCase({ contract, row, caseInput, subject, buildTemplate }) {
  if (!validateNativeTestCase(caseInput)) throw new ProofAuthoringError('case_invalid',
    'Case fields must satisfy native semantic types', { issues: structuredClone(validateNativeTestCase.errors) });
  const matches = linkedNativeTestProofs(contract, row);

  const association = (condition, eligible) => ({
    condition,
    field: CASE_VERIFICATION_ASSOCIATION_AUTHORED_FIELD,
    obligation_id: row.obligation_id ?? null,
    case_id: caseInput.case_id ?? row.case_id ?? null,
    verification_id: caseInput.verification_id ?? null,
    eligible_verification_ids: [...new Set(eligible)].sort(),
    controlled_contract_node_ids: [...(row.controlled_contract_node_ids ?? [])].sort()
  });
  let binding;
  if (caseInput.verification_id !== undefined) {
    binding = matches.find(proof => proof.verification_claim_id === caseInput.verification_id);
    if (!binding) throw new ProofAuthoringError('case_selector_invalid',
      'Select a saved declaration associated with this obligation',
      association('unassociated_declaration', matches.map(proof => proof.verification_claim_id)));
  } else if (matches.length > 1) throw new ProofAuthoringError('case_selector_ambiguous',
    'Select one eligible verification by its authored meaning',
    association('ambiguous_declaration', matches.map(proof => proof.verification_claim_id)));
  else binding = matches[0];
  if (!binding) {
    const linkedClaims = contract.claims.filter(claim => claim.kind === 'verification' &&
      claim.verification_method === 'test_execution' && (row.controlled_contract_node_ids ?? []).includes(claim.claim_id));
    if (linkedClaims.length > 1) throw new ProofAuthoringError('case_selector_ambiguous',
      'The obligation links multiple verification claims',
      association('ambiguous_linked_verification', linkedClaims.map(claim => claim.claim_id)));

    const id = linkedClaims[0]?.claim_id ?? `claim-${canonicalDigest({ subject, obligation: row.obligation_id }).slice(0, 40)}`;
    binding = { test_proof_id: `test-proof-${id.slice(6)}`, verification_claim_id: id };
    contract.test_proofs.push(binding);
  }
  row.controlled_contract_node_ids = [...new Set([...(row.controlled_contract_node_ids ?? []), binding.verification_claim_id])].sort();
  const slug = binding.test_proof_id.slice(11);
  const claim = contract.claims.find(claim => claim.claim_id === binding.verification_claim_id);
  if (caseInput.component?.reference_id) {
    const reference = contract.references.find(ref => ref.reference_id === caseInput.component.reference_id);
    if (!reference) throw new ProofAuthoringError('case_reference_unknown', 'Component reference is absent');
    caseInput = { ...caseInput, component: { type_term: reference.type_term, identity: reference.identity } };
  }
  if (caseInput.component) {
    let reference = contract.references.find(ref => same(ref.identity, caseInput.component.identity) && ref.type_term === caseInput.component.type_term);
    if (!reference) {
      reference = { reference_id: `ref-${canonicalDigest({ subject, identity: caseInput.component.identity }).slice(0, 40)}`,
        ...structuredClone(caseInput.component) };
      contract.references.push(reference);
    }
    binding.system_under_test_boundary ??= { boundary_id: `sut-boundary-${slug}` };
    binding.system_under_test_boundary.subject_reference_ids = [reference.reference_id];
    if (caseInput.component.identity.kind === 'repository_path' &&
        runtimeModulePathPatterns.some(pattern => pattern.test(caseInput.component.identity.path))) {
      binding.system_under_test_boundary.kind = 'module';
      binding.system_under_test_boundary.runtime_module_path = caseInput.component.identity.path;
    } else {
      delete binding.system_under_test_boundary.runtime_module_path;
    }
  }
  if (isNativeCaseTarget(caseInput.target)) {
    const native = resolveNativeCaseTarget(caseInput.target);
    binding.test_selector = { provider_id: native.provider_id,
      provider_version: native.provider_version, node_id: native.node_id };
  } else if (caseInput.target?.selector) {
    if (Object.hasOwn(binding.test_selector ?? {}, 'provider_id')) binding.test_selector = {};
    binding.test_selector ??= {}; mergeKnown(binding.test_selector, caseInput.target.selector);
  }
  if (caseInput.observation) {
    binding.observable_result ??= { observable_id: `observable-${slug}` };
    mergeKnown(binding.observable_result, caseInput.observation);
  }
  if (binding.observable_result && claim?.proposition_id) binding.observable_result.proposition_id = claim.proposition_id;
  if (caseInput.falsification?.support === 'registry_unsupported') {
    const change = caseInput.falsification;
    if (Object.keys(change).length !== 1) throw new ProofAuthoringError('case_falsification_unsupported',
      'A case that declares no falsifier provider carries no falsifier mechanics', {
        fields: Object.keys(change).filter(field => field !== 'support') });
    const selectorKind = caseTargetSelectorKind(caseInput.target, binding);
    if (selectorKind === undefined) throw new ProofAuthoringError('case_target_invalid',
      'Authoring an unsupported falsification requires a target that names its provider family');
    const template = buildTemplate({ contract, verificationId: binding.verification_claim_id,
      selectorKind, falsificationSupport: 'registry_unsupported' }).binding;
    binding.falsifiers = [];
    binding.falsification_provider = structuredClone(template.falsification_provider);
    for (const key of ['candidate_execution_provider', 'traversal_provider', 'prohibited_shortcuts']) {
      if (template[key] !== undefined) binding[key] = structuredClone(template[key]);
    }
    if (binding.system_under_test_boundary?.kind === undefined && template.system_under_test_boundary.kind) {
      binding.system_under_test_boundary ??= { boundary_id: `sut-boundary-${slug}` };
      binding.system_under_test_boundary.kind = template.system_under_test_boundary.kind;
    }
  } else if (caseInput.falsification) {
    const change = caseInput.falsification;
    delete binding.falsification_provider;
    binding.falsifiers ??= [];
    let falsifier;
    if (change.falsifier_id !== undefined) {
      falsifier = binding.falsifiers.find(f => f.falsifier_id === change.falsifier_id);
      if (!falsifier) throw new ProofAuthoringError('case_falsifier_unknown', 'Falsifier identity does not belong to this declaration');
    } else if (binding.falsifiers.length > 1) throw new ProofAuthoringError('case_falsifier_ambiguous', 'Select a returned falsifier identity');
    else falsifier = binding.falsifiers[0];
    if (!falsifier) {
      falsifier = { falsifier_id: `falsifier-${slug}` };
      binding.falsifiers.push(falsifier);
    }
    if (change.strategy !== undefined) falsifier.strategy = change.strategy;

    const mutation = Object.fromEntries(Object.entries(change).filter(([key]) => !['strategy', 'falsifier_id', 'support'].includes(key)));
    if (Object.keys(mutation).length) {
      falsifier.mutation ??= { mutation_id: `mutation-${slug}` };
      mergeKnown(falsifier.mutation, mutation);
    }
    if (claim?.falsifying_proposition_id) falsifier.proposition_id = claim.falsifying_proposition_id;
    const selectorKind = falsifier.strategy === undefined ? undefined
      : caseSelectorKind(caseInput.target, binding, falsifier.strategy);
    if (selectorKind !== undefined) {
      const template = buildTemplate({ contract, verificationId: binding.verification_claim_id, strategy: falsifier.strategy,
        selectorKind }).binding;
      const templateFalsifier = template.falsifiers[0];

      const familyChanged = kind => kind !== undefined &&
        kind !== providerSelectorKind(templateFalsifier.execution_provider);
      falsifier.expected_outcome = templateFalsifier.expected_outcome;
      falsifier.mutation = { ...templateFalsifier.mutation, ...falsifier.mutation,
        mechanism: templateFalsifier.mutation.mechanism, target_kind: templateFalsifier.mutation.target_kind };
      if (templateFalsifier.execution_provider.provider_id && (!falsifier.execution_provider ||
          familyChanged(providerSelectorKind(falsifier.execution_provider)))) {
        falsifier.execution_provider = templateFalsifier.execution_provider;
      }
      for (const key of ['candidate_execution_provider', 'traversal_provider', 'prohibited_shortcuts']) {
        if (template[key] !== undefined && (binding[key] === undefined ||
            key !== 'prohibited_shortcuts' && familyChanged(providerSelectorKind(binding[key])))) {
          binding[key] = template[key];
        }
      }
      if (binding.system_under_test_boundary?.kind === undefined && template.system_under_test_boundary.kind) {
        binding.system_under_test_boundary ??= { boundary_id: `sut-boundary-${slug}` };
        binding.system_under_test_boundary.kind = template.system_under_test_boundary.kind;
      }
    }
  }
  contract.test_proofs.sort((a, b) => a.verification_claim_id.localeCompare(b.verification_claim_id));
  return binding;
}

export const emptyCaseContract = () => ({ schema_version: 'controlled-acceptance-contract.v1',
  vocabulary_version: 'controlled-contract-vocabulary.v1', profile_id: 'acceptance-contract.standard.v1',
  references: [], propositions: [], claims: [], relations: [], collections: [], residue: [], annotations: [],
  test_proof_version: 'controlled-contract-test-proof.v1', test_proofs: [] });
export const authoredCaseRevision = definition => `sha256:${canonicalDigest(definition)}`;
export const authoredCaseVerificationId = definition => definition.verification_id ??
  `claim-${canonicalDigest({ case_id: definition.case_id }).slice(0, 40)}`;
export function projectAuthoredTestCase(cases, row, { references = [], targets = [] } = {}) {
  if (!row.case_id) return [];
  const definition = cases.find(value => value.case_id === row.case_id);
  if (!definition) throw new ProofAuthoringError('case_unknown', 'The referenced case definition is absent', { case_id: row.case_id });
  const reference = definition.component?.reference_id ? references.find(ref => ref.reference_id === definition.component.reference_id) : undefined;

  const selectedTargets = definition.target?.owner_unit && !isNativeCaseTarget(definition.target) ? targets.filter(target => target.unit === definition.target.owner_unit &&
    target.verification_id === authoredCaseVerificationId(definition)) : [];
  if (selectedTargets.length > 1) throw new ProofAuthoringError('case_target_ambiguous', 'The case target reference is ambiguous');
  const target = selectedTargets[0];
  return [{ ...structuredClone(definition), ...(target ? { target: { ...definition.target, path: target.path } } : {}),
    case_revision: authoredCaseRevision({ definition, ...(reference ? { component_fact: reference } : {}),
      ...(target ? { target_fact: target } : {}) }) }];
}

export function deriveAuthoredTestCases({ contract: canonical, cases, buildTemplate }) {
  const contract = structuredClone(canonical ?? emptyCaseContract());
  const verificationOwners = new Set();
  for (const definition of [...cases].sort((a,b) => a.case_id.localeCompare(b.case_id))) {
    const verification = authoredCaseVerificationId(definition);
    if (verificationOwners.has(verification)) throw new ProofAuthoringError('case_verification_conflict',
      'Different cases cannot own one verification identity', { verification_id: verification });
    verificationOwners.add(verification);

    if (definition.verification_id !== undefined) {
      boundVerificationClaim(contract, verification, { case_id: definition.case_id });
    }
    contract.test_proofs = contract.test_proofs.filter(p => p.verification_claim_id !== verification);
    contract.test_proofs.push({ test_proof_id: `test-proof-${canonicalDigest({ case_id: definition.case_id }).slice(0,40)}`,
      verification_claim_id: verification });
    const row = { controlled_contract_node_ids: [verification] };
    const { owner_unit, ...target } = definition.target ?? {};
    applyNativeTestProofCase({ contract, row, caseInput: { ...definition, ...(definition.target ? { target } : {}), verification_id: verification },
      subject: { case_id: definition.case_id }, buildTemplate });
  }
  return contract;
}
