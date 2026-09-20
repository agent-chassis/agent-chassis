import { NODE_TEST_SELECTOR_KIND, TEST_PROOF_PROVIDER_AUTHORING_FACTS, TEST_PROOF_PROVIDER_CATALOG,
  resolveNativeTestSelector, testProofFalsifierProvider, testProofSelectorKind,
  testProofStrategySelectorKinds } from './test-proof-provider-registry.mjs';
import schema from './stable-contract-schema-v1.mjs';
import { compiledValidators } from './compiled-validator-cache.mjs';
import { canonicalDigest } from './deterministic-projection-primitives.mjs';

import { ProofAuthoringError } from './proof-contract.mjs';

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
  target: { oneOf: [closed({ path: inline(defs.repo_module_path), selector: inline({
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
const leafFields = (node, prefix = '') => Object.entries(node.properties).flatMap(([field, child]) =>
  child.type === 'object' && child.properties ? leafFields(child, `${prefix}${field}.`) : [`${prefix}${field}`]);
const [nodeTargetFields, nativeTargetFields] = NATIVE_TEST_CASE_SCHEMA.properties.target.oneOf.map(arm => leafFields(arm));
const falsifierMechanisms = new Map(TEST_PROOF_PROVIDER_AUTHORING_FACTS.map(({ falsifier_execution: falsifier }) =>
  [falsifier.mechanism, falsifier]));

export const CASE_VERIFICATION_ASSOCIATION_FIELD = 'obligations[].case.verification_id';
export const NATIVE_TEST_CASE_AUTHORING_GUIDANCE = deepFreezeGuidance({
  schema_version: 'controlled-contract-native-case-authoring-guidance.v1',
  purpose: 'Author case.target and case.falsification for an obligation verified by test_execution: ' +
    'choose the family that runs the test, copy its provider identity, write node_id in its form, and ' +
    'use the falsification fields of its mechanism. Falsifier providers are server-derived.',
  target_variants: {
    node_test: { fields: nodeTargetFields, path_owner: 'the owning unit work-record node_test declaration' },
    provider_qualified: { fields: nativeTargetFields, path_owner: 'the case; path is the source node_id names' }
  },

  verification_association: {
    field: CASE_VERIFICATION_ASSOCIATION_FIELD,
    eligible: 'One test_execution verification claim_id that the SAME obligation lists in its own ' +
      'controlled_contract_node_ids. Linking only the requirement claim leaves no eligible verification, ' +
      'because eligibility reads the obligation links themselves rather than following the requirement ' +
      'that verification verifies.',
    correction: 'Author both fields in one save: list the verification claim_id in the obligation ' +
      "controlled_contract_node_ids beside its requirement claim, and name that same claim_id in the case's " +
      'verification_id. Replacing the verification a saved case names is the same amendment.',
    omission: 'A case may omit verification_id while exactly one eligible verification is linked; that one ' +
      'is adopted. Zero eligible verifications leave the case unfinished, and more than one is ambiguous ' +
      'and must be named explicitly.',
    derived_from_association: 'Every proposition identity on the derived test binding comes from the ' +
      'named canonical verification claim. Those identities are derived and are never authored: a case ' +
      'that names no eligible verification derives a placeholder binding whose propositions are absent, ' +
      'which validation reports as the unfinished content of that case.',
    identities: 'The upsert guidance member required_object_shapes.requirement_rebinding.complete_case_population ' +
      'states which query output carries each requirement verification_claim_ids and each case verification_id. ' +
      'Read the identities there; this member states only which combination of them is eligible.'
  },

  support_states: {
    candidate_proof: 'discovery lexically matched a catalog proof; not a capability fact',
    listed_family: 'a listed family runs the language; not a target fact',
    family_absent: 'no listed family owns that source suffix or runner; the catalog lists none for it',
    request_invalid: 'the save refused the request shape, an unknown provider_id, or a provider_version the catalog does not list; a request defect is not a fact about the target, the family or the language',
    target_selector_valid: 'save accepted provider, path and node_id form',
    target_uninspected: 'test existence and falsifier target shape are checked only when workspace_verify_proof runs',
    unsupported_demonstrated: 'a workspace_verify_proof attempt refused this exact target with one of its mechanism target_constraint refusal_codes and reasons',
    unresolved: 'a fact above is unknown: keep acceptance required and record the obligation gap (unresolved_coverage)'
  },
  target_shape_limits: 'A mechanism mutates only the shape its target_constraint states, and a listed family is no assurance that the code under test has that shape. Author the case for the behavior the obligation requires: when no accepted shape exists, author the case without a falsifier and keep the obligation required. Do not add, export or reshape a production function so that it fits the mutation.',
  falsification_support: {
    provider: 'the case declares a falsifier: author strategy and its mechanism fields',
    registry_unsupported: 'the case declares no falsifier: author support alone, declare no falsifier, and expect workspace_verify_proof to run the selected test and report the absent falsification as a capability limitation. It is not a satisfied falsification and the obligation stays unmet on that axis'
  },
  falsification: Object.fromEntries([...falsifierMechanisms].map(([mechanism, falsifier]) => [mechanism, {
    strategies: Object.fromEntries(falsifier.strategies.map(strategy =>
      [strategy, strategyFields(strategy, mechanism)])),
    target_constraint: falsifier.target_constraint
  }])),
  families: Object.fromEntries(TEST_PROOF_PROVIDER_AUTHORING_FACTS.map(family => [family.family_id, {
    languages: family.languages, runner: family.runner,
    target_variant: family.selector.provider_qualified ? 'provider_qualified' : 'node_test',
    ...(family.selector.provider_qualified ? { provider: {
      provider_id: family.candidate_execution.provider_id,
      provider_version: family.candidate_execution.provider_version } } : {}),
    ...(family.selector.node_id_form === null ? {} : { node_id_form: family.selector.node_id_form }),
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
export function linkedNativeTestProofs(contract, row) {
  if (row.case_id) return contract.test_proofs.filter(proof => proof.test_proof_id ===
    `test-proof-${canonicalDigest({ case_id: row.case_id }).slice(0,40)}`);
  const links = new Set(row.controlled_contract_node_ids ?? []);
  for (const relation of contract.relations) if (relation.role === 'verifies' && links.has(relation.target_claim_id)) {
    links.add(relation.source_claim_id);
  }
  return contract.test_proofs.filter(proof => links.has(proof.verification_claim_id));
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
  if (kind !== undefined && testProofFalsifierProvider(kind, strategy) !== null) return kind;
  const owners = testProofStrategySelectorKinds(strategy);
  if (owners.length === 1) return owners[0];
  if (kind !== undefined && owners.length > 1) {
    throw new ProofAuthoringError('case_falsification_unsupported',
      'The case target provider family does not implement this falsification strategy', {
        strategy, selector_kind: kind,
        strategies: TEST_PROOF_PROVIDER_CATALOG.providers.filter(provider => provider.selector_kind === kind)
          .flatMap(provider => provider.falsifier_strategies) });
  }
  return undefined;
}

export function applyNativeTestProofCase({ contract, row, caseInput, subject, buildTemplate }) {
  if (!validateNativeTestCase(caseInput)) throw new ProofAuthoringError('case_invalid',
    'Case fields must satisfy native semantic types', { issues: structuredClone(validateNativeTestCase.errors) });
  const matches = linkedNativeTestProofs(contract, row);

  const association = (condition, eligible) => ({
    condition,
    field: CASE_VERIFICATION_ASSOCIATION_FIELD,
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
    'Select one returned verification identity',
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
