import { inspectReferenceRole, referenceRoleCardinalityMatches } from './proof-parameter-refinements.mjs';
import schema from '../schema/controlled-contract-pack-parameter-contract.v1.schema.json' with { type: 'json' };
import nativeSchema from '../schema/controlled-acceptance-contract.v1.schema.json' with { type: 'json' };
import selectorSchema from '../schema/controlled-acceptance-test-proof-definitions.v1.schema.json' with { type: 'json' };
import inputSchema from '../schema/controlled-contract-verification-profile-input.v2.schema.json' with { type: 'json' };
import { compiledValidators } from './compiled-validator-cache.mjs';
import { validateProfileSchemaV1 } from './verification-profile-schema-v1.mjs';
import { profileDigest } from './profile-digest.mjs';
import { deepFreeze } from './deterministic-projection-primitives.mjs';
import { exactPopulation, inspectPackParameterCoverage, parameterFailure,
  profileConstraints, profileRoles, roleConstraintRefs } from './pack-parameter-coverage.mjs';

const { validateSchema, validateIdentity, validateSelector, validateReferenceList } = await compiledValidators(
  'controlled-contract.pack-parameters.v1', { validators: {
    validateSchema: schema,
    validateIdentity: nativeSchema.$defs.reference.properties.identity,
    validateSelector: selectorSchema.$defs.test_selector,
    validateReferenceList: inputSchema.properties.reference_bindings.items.properties.reference_ids
  } });
const validated = new WeakMap();

function unique(values, field) { exactPopulation(values, [...new Set(values)], field); }
function resolvePointer(profile, pointer) {
  if (!pointer.startsWith('/')) parameterFailure('reference_invalid', pointer, 'expected profile JSON pointer');
  let value = profile;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      parameterFailure('reference_invalid', pointer, 'reference does not exist in bound profile');
    }
    value = value[key];
  }
  return value;
}

export function validatePackParameterContract(contract, profile) {
  if (!validateSchema(contract)) parameterFailure('schema_invalid', '/',
    'parameter contract must satisfy its closed schema', { diagnostics: structuredClone(validateSchema.errors) });
  if (!validateProfileSchemaV1(profile)) parameterFailure('profile_invalid', '/profile',
    'bound profile must satisfy its incumbent schema');
  for (const [field, value] of Object.entries({ profile_id: profile.profile_id,
    profile_version: profile.profile_version, profile_digest: profileDigest(profile) })) {
    if (contract[field] !== value) parameterFailure('identity_mismatch', `/${field}`,
      'companion does not bind this exact profile', { expected: value, actual: contract[field] });
  }
  unique(contract.parameters.map(p => p.name), '/parameters');
  unique(contract.capabilities.map(p => p.id), '/capabilities');
  exactPopulation(contract.capabilities.map(p => p.kind),
    ['constructor', 'canonical_resolver', 'observation_acquisition', 'evaluation'], '/capabilities/kinds');
  const roles = profileRoles(profile), roleNames = roles.map(p => p.role);
  const capability = id => {
    const result = contract.capabilities.find(c => c.id === id);
    if (!result) parameterFailure('capability_invalid', '/capabilities', 'unknown capability identity');
    return result;
  };
  for (const p of contract.parameters) {
    unique(p.roles, `/parameters/${p.name}/roles`);
    if (!p.roles.length) parameterFailure('reference_invalid', '/parameters', 'slot requires exact role refinements');
    const refinements = p.roles.map(role => {
      if (!roleNames.includes(role)) parameterFailure('reference_invalid', '/parameters', 'unknown role');
      const family = profile.reference_roles.some(r => r.role === role) ? 'reference_roles' : 'number_roles';
      return `/${family}/${profile[family].findIndex(r => r.role === role)}`;
    });
    exactPopulation(p.refinement_refs, refinements, `/parameters/${p.name}/refinement_refs`);
    const referenceRoles = p.roles.map(name => profile.reference_roles.find(r => r.role === name));
    if (referenceRoles.some(role => !role)) parameterFailure('value_kind_invalid', '/parameters',
      'numeric expectations are internal producers, not semantic referent inputs');
    if (p.value_kind === 'test_assertion_selector' && referenceRoles.some(r => !r.allowed_type_terms.includes('cc:test'))) {
      parameterFailure('value_kind_invalid', '/parameters', 'assertion selectors refine test referents');
    }
    if (p.value_kind === 'complete_population' && referenceRoles.every(r =>
      r.cardinality === 'exactly_one' && !r.allowed_type_terms.includes('cc:population'))) parameterFailure(
      'value_kind_invalid', '/parameters', 'population slots require a population or member-list refinement');
    if (p.value_kind === 'typed_policy_reference' && referenceRoles.some(r =>
      !r.allowed_type_terms.some(type => ['cc:artifact', 'cc:configuration', 'cc:criterion'].includes(type)))) {
      parameterFailure('value_kind_invalid', '/parameters', 'policy slots must retain an incumbent policy value type');
    }
    exactPopulation(p.applicability_refs,
      [...new Set(p.roles.flatMap(role => roleConstraintRefs(profile, role)))].sort(),
      `/parameters/${p.name}/applicability_refs`);
    if (p.source.policy === 'canonical' || p.source.mapping !== null && p.source.mapping !== undefined) {
      const source = capability(p.source.mapping);
      if (source.kind !== 'canonical_resolver') parameterFailure('source_invalid', '/parameters',
        'canonical relationships require a canonical resolver capability');
    }
    if (p.source.policy === 'derived') for (const input of p.source.inputs) {
      if (!contract.parameters.some(s => s.name === input)) parameterFailure('source_invalid', '/parameters',
        'derivation input is not a semantic parameter');
    }
  }
  const visited = new Set(), visiting = new Set();
  const visitSource = slot => {
    if (visiting.has(slot.name)) parameterFailure('derivation_cycle', '/parameters', 'cyclic semantic source');
    if (visited.has(slot.name)) return;
    visiting.add(slot.name);
    if (slot.source.policy === 'derived') for (const input of slot.source.inputs) {
      visitSource(contract.parameters.find(p => p.name === input));
    }
    visiting.delete(slot.name); visited.add(slot.name);
  };
  contract.parameters.forEach(visitSource);
  inspectPackParameterCoverage(contract, profile);
  for (const row of contract.role_producers) {
    const role = roles.find(r => r.role === row.role);
    if (row.parameter !== null && !contract.parameters.some(p => p.name === row.parameter && p.roles.includes(row.role))) {
      parameterFailure('producer_invalid', '/role_producers', 'producer slot does not refine its role');
    }
    if (row.kind === 'semantic_parameter' && row.parameter === null) parameterFailure(
      'producer_invalid', '/role_producers', 'semantic producer requires a slot');
    if (row.kind === 'canonical_relationship' && (row.parameter === null ||
      contract.parameters.find(p => p.name === row.parameter).source.policy !== 'canonical')) parameterFailure(
      'producer_invalid', '/role_producers', 'canonical producer requires a canonical-only slot');
    if (row.capability !== null) capability(row.capability);
    if (row.kind === 'definition_constant' &&
        (role.minimum === undefined || role.minimum !== role.maximum)) parameterFailure(
      'derivation_invalid', '/role_producers', 'constant must be fixed by the exact number refinement');
    if (row.kind === 'complete_population_count') {
      const inputs = (profile.reference_role_count_bindings ?? []).filter(b => b.number_role === row.role)
        .map(b => b.reference_role);
      if (!inputs.length) parameterFailure('derivation_invalid', '/role_producers', 'count has no source binding');
      exactPopulation(row.inputs, inputs, '/role_producers/inputs');
    }
    if (row.kind === 'same_reference_alias') {
      if (row.inputs.length !== 1 || !profile.reference_binding_patterns.some(p =>
        p.comparison === 'same_reference' && p.roles.includes(row.role) && p.roles.includes(row.inputs[0]))) {
        parameterFailure('derivation_invalid', '/role_producers', 'alias requires exact same-reference evidence');
      }
    }
    if (['observation_requirement', 'capability_gap'].includes(row.kind) && row.gap === null) {
      parameterFailure('capability_invalid', '/role_producers', 'unavailable producer requires an owned gap');
    }
    if (row.kind === 'constructor_output' && (row.capability === null ||
      capability(row.capability).kind !== 'constructor' || capability(row.capability).state !== 'implemented')) parameterFailure(
      'capability_invalid', '/role_producers', 'constructor output requires its exact constructor');
  }
  const constructor = capability(contract.construction.capability);
  if (constructor.kind !== 'constructor') parameterFailure('construction_invalid', '/construction', 'not a constructor');
  exactPopulation(contract.construction.semantic_inputs, contract.parameters.map(p => p.name), '/construction/semantic_inputs');
  exactPopulation(contract.construction.declaration_outputs,
    contract.role_producers.filter(p => p.kind === 'constructor_output').map(p => p.role), '/construction/declaration_outputs');
  exactPopulation(contract.construction.required_observations,
    contract.role_producers.filter(p => p.kind === 'observation_requirement').map(p => p.role), '/construction/required_observations');
  for (const cap of contract.capabilities) {

    if (cap.state === 'implemented' ? cap.implementation_version === null
      : cap.implementation_version !== null) parameterFailure('capability_invalid', '/capabilities',
      'implemented capability names its own implementation version; unavailable capabilities have none');
    if (cap.state === 'implemented' && (cap.identity === null || cap.evidence_kind === 'requirement' || cap.gap !== null)) {
      parameterFailure('capability_invalid', '/capabilities', 'implemented capability requires exact identity and evidence');
    }
    if (cap.state === 'unavailable' && cap.gap === null) parameterFailure(
      'capability_invalid', '/capabilities', 'unavailable capability requires an owned gap');
    const known = {
      constructor: ['@agent-chassis/controlled-contract#buildProofAuthoringSkeleton'],
      canonical_resolver: [], observation_acquisition: [],
      evaluation: ['@agent-chassis/controlled-contract#evaluateVerificationProfileV1',
        '@agent-chassis/controlled-contract#resolveExactProofEvaluator']
    };
    if (cap.state === 'implemented' && !known[cap.kind].includes(cap.identity)) parameterFailure(
      'capability_invalid', '/capabilities', 'metadata cannot introduce executable capability identities');
    if (cap.state === 'implemented' && cap.kind === 'constructor' &&
      profile.profile_id !== 'proof.integration.prefix-safety') parameterFailure(
      'capability_invalid', '/capabilities', 'the integration builder is not a general named-pack constructor');
  }
  if (contract.dependencies.state === 'complete') for (const d of contract.dependencies.packs) {
    for (const ref of d.applicability_refs) resolvePointer(profile, ref);
  }
  const result = deepFreeze(structuredClone(contract));
  validated.set(result, deepFreeze(structuredClone(profile)));
  return result;
}

export function assertValidatedParameterContract(contract) {
  const profile = validated.get(contract);
  if (!profile) parameterFailure('snapshot_unrecognized', '/', 'use the validated parameter snapshot');
  return profile;
}

export function describePackParameters(contract) {
  const profile = assertValidatedParameterContract(contract);
  return deepFreeze({ profile_id: contract.profile_id, profile_version: contract.profile_version,
    profile_digest: contract.profile_digest, total: contract.parameters.length,
    returned: contract.parameters.length, omitted: 0,
    parameters: contract.parameters.map(p => ({ ...structuredClone(p),
      refinements: p.refinement_refs.map(ref => ({ ref, value: structuredClone(resolvePointer(profile, ref)) })),
      constraints: p.applicability_refs.map(ref => ({ ref, value: structuredClone(resolvePointer(profile, ref)) })) })),
    construction: structuredClone(contract.construction), dependencies: structuredClone(contract.dependencies),
    capabilities: structuredClone(contract.capabilities),
    constraints: structuredClone(profileConstraints(profile)) });
}

export function inspectParameterSource(contract, name, { explicit, canonical, canonical_references } = {}) {
  const profile = assertValidatedParameterContract(contract);
  const slot = contract.parameters.find(p => p.name === name);
  if (!slot) parameterFailure('source_invalid', '/parameters', 'unknown parameter');
  if (slot.source.policy !== 'configurable' && explicit !== undefined) return { status: 'canonical_conflict' };
  if (slot.source.policy === 'derived') return { status: 'derived', operation: slot.source.operation };
  const value = explicit === undefined ? (slot.source.mapping === null ? undefined : canonical) : explicit;
  if (value === undefined) return { status: 'missing', mapping: slot.source.mapping };
  const valid = slot.value_kind === 'test_assertion_selector' ? validateSelector(value) :
    Array.isArray(value) ? value.every(validateIdentity) : validateIdentity(value);
  if (!valid) return { status: 'incompatible', reason: 'incumbent_identity_or_selector_schema' };
  if (slot.value_kind !== 'test_assertion_selector') for (const roleName of slot.roles) {
    const role = profile.reference_roles.find(r => r.role === roleName);
    const values = Array.isArray(value) ? value : [value];
    const references = canonical_references ?? values.map(identity => ({ identity }));
    if (role && inspectReferenceRole(role, references).status === 'incompatible') {
      return { status: 'incompatible', reason: 'exact_role_refinement',
        role: structuredClone(role), actual_references: structuredClone(references) };
    }
  }
  return { status: 'available', source: explicit === undefined ? 'canonical' : 'explicit', value: structuredClone(value) };
}

export function deriveParameterRole(contract, roleName, referenceBindings = {}) {
  const profile = assertValidatedParameterContract(contract);
  const row = contract.role_producers.find(p => p.role === roleName);
  if (!row) parameterFailure('derivation_invalid', '/role_producers', 'unknown role');
  if (row.kind === 'definition_constant') {
    const value = profile.number_roles.find(r => r.role === roleName).minimum;
    const joins = (profile.reference_role_count_bindings ?? []).filter(b => b.number_role === roleName);
    for (const join of joins) if (Object.hasOwn(referenceBindings, join.reference_role) &&
      (!validateReferenceList(referenceBindings[join.reference_role]) || referenceBindings[join.reference_role].length !== value)) {
      return { status: 'incompatible', reason: 'fixed_count_join', value };
    }
    return { status: 'derived', source: [`/number_roles/${profile.number_roles.findIndex(r => r.role === roleName)}`, ...row.rule_refs],
      value, meaning: 'definition_expectation_not_observation' };
  }
  if (row.kind === 'same_reference_alias') {
    if (!Object.hasOwn(referenceBindings, row.inputs[0])) return { status: 'missing', source: row.inputs };
    if (!validateReferenceList(referenceBindings[row.inputs[0]])) return { status: 'incompatible', source: row.inputs };
    const size = referenceBindings[row.inputs[0]].length;
    for (const roleName of [row.role, ...row.inputs]) {
      const role = profile.reference_roles.find(r => r.role === roleName);
      if (!referenceRoleCardinalityMatches(role, size)) {
        return { status: 'incompatible', reason: 'exact_reference_cardinality', source: row.inputs };
      }
    }
    return { status: 'derived', source: row.inputs, value: structuredClone(referenceBindings[row.inputs[0]]) };
  }
  if (row.kind !== 'complete_population_count') return { status: 'capability_gap', role: roleName };
  if (row.inputs.some(input => !Object.hasOwn(referenceBindings, input))) return { status: 'missing', source: row.inputs };
  if (row.inputs.some(input => !validateReferenceList(referenceBindings[input]))) return { status: 'incompatible', source: row.inputs };
  const lengths = row.inputs.map(input => referenceBindings[input].length);
  if (new Set(lengths).size !== 1) return { status: 'incompatible', reason: 'conflicting_count_join', lengths };
  const role = profile.number_roles.find(r => r.role === roleName), value = lengths[0];
  if (role.minimum !== undefined && value < role.minimum || role.maximum !== undefined && value > role.maximum) {
    return { status: 'incompatible', reason: 'exact_number_refinement', value };
  }
  return { status: 'derived', source: row.inputs, value };
}
