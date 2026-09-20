import { canonicalDigest, deepFreeze } from './deterministic-projection-primitives.mjs';

export class PackParameterError extends Error {
  constructor(code, field, message, details = {}) {
    super(message);
    this.name = 'PackParameterError';
    this.code = `pack_parameter_${code}`;
    this.details = { limb: 'mechanical_failure', field, ...details };
  }
}

export function parameterFailure(code, field, message, details) {
  throw new PackParameterError(code, field, message, details);
}

export function profileRoles(profile) {
  return [...profile.reference_roles, ...profile.number_roles];
}

export function profileConstraints(profile) {
  return Object.entries(profile).flatMap(([key, value]) => {
    if (key.endsWith('_patterns') || ['distinct_reference_role_sets',
      'reference_role_count_bindings', 'falsifier_condition_bindings',
      'falsifier_occurrence_bindings'].includes(key)) {
      return value.map((constraint, index) => ({ ref: `/${key}/${index}`, constraint }));
    }
    return key === 'satisfaction_expression' || key === 'stable_capabilities'
      ? [{ ref: `/${key}`, constraint: value }] : [];
  });
}

export function roleConstraintRefs(profile, role) {
  const contains = value => value === role || (value !== null && typeof value === 'object' &&
    Object.values(value).some(contains));
  return profileConstraints(profile).filter(row => contains(row.constraint))
    .map(row => row.ref).sort();
}

export function exactPopulation(actual, expected, field) {
  const missing = expected.filter(value => !actual.includes(value));
  const extra = actual.filter(value => !expected.includes(value));
  const duplicate = actual.filter((value, index) => actual.indexOf(value) !== index);
  if (missing.length || extra.length || duplicate.length) parameterFailure(
    'coverage_mismatch', field, 'the exact population is not accounted for once',
    { missing, extra, duplicate });
}

export function inspectPackParameterCoverage(contract, profile) {
  exactPopulation(contract.role_producers.map(row => row.role),
    profileRoles(profile).map(row => row.role), '/role_producers');
  const rows = contract.role_producers.map(row => ({ ...structuredClone(row),
    refinement: structuredClone(profileRoles(profile).find(role => role.role === row.role)) }));
  for (const row of rows) exactPopulation(row.rule_refs,
    roleConstraintRefs(profile, row.role), `/role_producers/${row.role}/rule_refs`);
  return deepFreeze({ profile_id: profile.profile_id, profile_version: profile.profile_version,
    parameter_contract_digest: canonicalDigest(contract),
    total: rows.length, accounted: rows.length, returned: rows.length, omitted: 0,
    gaps: rows.filter(row => row.gap !== null).length,
    semantic_parameters: contract.parameters.length,
    internal_roles: rows.filter(row => row.kind !== 'semantic_parameter').length,
    rows, constraints: structuredClone(profileConstraints(profile)),
    capabilities: structuredClone(contract.capabilities) });
}

export function validateParameterDependencies(contracts) {
  const key = value => `${value.profile_id}@${value.profile_version}`;
  const byKey = new Map(contracts.map(value => [key(value), value]));
  exactPopulation(contracts.map(key), [...byKey.keys()], '/packs');
  const visiting = new Set(), visited = new Set();
  function visit(contract) {
    const id = key(contract);
    if (visiting.has(id)) parameterFailure('dependency_cycle', '/dependencies', id);
    if (visited.has(id)) return;
    visiting.add(id);
    if (contract.dependencies.state === 'complete') {
      const dependencies = contract.dependencies.packs;
      exactPopulation(dependencies.map(key), [...new Set(dependencies.map(key))], '/dependencies/packs');
      if (JSON.stringify(dependencies.map(key)) !== JSON.stringify(dependencies.map(key).sort())) {
        parameterFailure('dependency_order', '/dependencies/packs', 'dependencies require canonical order');
      }
      for (const dependency of dependencies) {
        const target = byKey.get(key(dependency));
        if (!target || target.profile_digest !== dependency.profile_digest) parameterFailure(
          'dependency_identity', '/dependencies', 'dependency requires its exact current definition');
        for (const mapping of dependency.input_mappings) {
          if (!target.parameters.some(p => p.name === mapping.input) ||
              !contract.parameters.some(p => p.name === mapping.parameter)) parameterFailure(
            'dependency_input', '/dependencies', 'input mapping must resolve at both ends');
        }
        exactPopulation(dependency.input_mappings.map(row => row.input),
          target.parameters.filter(p => p.source.policy === 'configurable').map(p => p.name),
          '/dependencies/input_mappings');
        for (const output of dependency.output_uses) if (!contract.role_producers.some(p => p.role === output)) {
          parameterFailure('dependency_output', '/dependencies', 'output use is not a declared role');
        }
        visit(target);
      }
    }
    visiting.delete(id); visited.add(id);
  }
  contracts.forEach(visit);
  return true;
}
