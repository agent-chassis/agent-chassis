
import { resolveValueDefinitions, lexicalScopeKey, compatibleValueTypes } from './controlled-value-definitions-v1.mjs';
import { ControlledValueError, valueCanonicalKey, valueReferences } from './controlled-values-v1.mjs';
import { createValueLowering, valueName, celString, celTypedEquality, celTypePredicate } from './cel-value-lowering.mjs';
import { VALUE_CEL_ENVIRONMENT, celTypeDescriptor } from './cel-observation-model.mjs';
import { conformityExpression } from './closed-membership.mjs';
export const isValueConstraint = row => row.definition === true || row.relation?.startsWith('value:')
  || row.for_each !== undefined || row.within !== undefined || row.clauses?.some(clause => clause.domain !== undefined);
const all = expressions => expressions.length ? expressions.map(expression => `(${expression})`).join(' && ') : 'true';
const identityKey = entity => valueCanonicalKey(entity.identity);

export function valueInventoryRows(operator, subject, operand) {
  const v = int => ({ value: { literal: { int64Value: String(int) } } });
  const b = boolean => ({ value: { literal: { boolValue: boolean } } });
  const s = string => ({ value: { literal: { stringValue: string } } });
  const base = { form: 'statement', subject, applies: { mode: 'unconditional', context: [] } };
  const type = operator.signature.type_rule;
  let operands = operator.signature.positional_payloads.map(() => v(1)), body = null;
  if (['boolean_binary', 'boolean_unary'].includes(type)) operands = operands.map(() => b(true));
  if (type === 'choose') operands = [b(true), v(1), v(2)];
  if (type === 'string_contains') operands = [s('abc'), s('b')];
  if (type === 'substring') operands = [s('abc'), v(0), v(2)];
  if (type === 'size') operands = [s('abc')];
  if (type === 'sum') operands = [{ value: { list: { element_type: 'int', items: [v(1).value, v(2).value] } } }];
  if (type === 'type_test') operands = [v(1), { type: 'int' }];
  if (type === 'presence') operands = [{ value: { selection: { from: { list: { element_type: 'int', items: [v(1).value] } }, path: [{ index: v(0).value }] } } }];
  if (type === 'observation') operands = [{ observation: { operation: subject, occurrence: operand, root: 'completion', path: [{ field: 'payload' }], type: 'int' } }];
  if (type === 'duration_add' || type === 'timestamp_difference') operands = [0, 1].map(() => ({ value: { literal: { objectValue: {
    '@type': `type.googleapis.com/google.protobuf.${type === 'duration_add' ? 'Duration' : 'Timestamp'}`,
    value: type === 'duration_add' ? '1s' : '2026-01-01T00:00:00Z' } } } }));
  if (['map_over', 'filter_over', 'exists_in'].includes(type)) {
    const scope = { owner: subject, path: [0] };
    body = { identity: 'sample-body', constraint: { ...base, subject: operand, definition: true, within: scope,
      relation: 'value:equals', operands: [type === 'map_over' ? v(2) : b(true)] } };
    operands = [{ value: { list: { element_type: 'int', items: [v(1).value, v(2).value] } } },
      { binding: { scope, bind: { value: 'value' } } }, { value: { referent: operand } }];
  }
  const definition = { identity: 'sample-definition', constraint: { ...base, definition: true, relation: operator.term === 'value:not_equals' ? 'value:equals' : operator.term, operands } };
  return [...(body ? [body] : []), definition, ...(type === 'observation' ? [] : [{ identity: 'sample', constraint: { ...base, nature: 'behavior', modality: 'MUST', relation: operator.term, operands } }])];
}

export function lowerValueSpecification(rows, { selectedConstraintIds = null, applicability, knownObservations } = {}) {
  const resolved = resolveValueDefinitions(rows), roots = new Map(), auxiliary = new Map(), counter = new Map();
  const scopeBindings = new Map();
  const needed = new Set(), governing = new Set(), scopesBuilt = new Map(), expressions = new Map();
  const activeScopes = new Set();
  const scopeOf = row => row.for_each?.at(-1)?.scope ?? row.within ?? null;
  const dependencies = row => [row.subject, ...(['if', 'unless'].includes(row.applies?.mode) ? row.applies.context : []),
    ...(row.operands ?? []).flatMap(operand => operand.reference ? [operand.reference] : []),
    ...valueReferences([...(row.operands ?? []), ...(row.clauses ?? []).flatMap(clause => clause.domain ? [clause.domain] : []),
      ...(row.for_each ?? []).map(declaration => declaration.domain)])];
  function collect(definition) {
    if (!definition || needed.has(definition.key)) return;
    needed.add(definition.key);
    collectScope(definition.scope);
    for (const input of definition.constraint.operands ?? []) {
      const scope = input === definition.constraint.operands[2] && definition.constraint.operands[1]?.binding
        ? definition.constraint.operands[1].binding.scope : definition.scope;
      if (input.value) for (const reference of valueReferences(input.value)) collect(resolved.lookup(reference, scope));
    }
  }
  function collectScope(scope) {
    if (!scope || activeScopes.has(lexicalScopeKey(scope))) return;
    activeScopes.add(lexicalScopeKey(scope));
    const entry = resolved.scopes.get(lexicalScopeKey(scope));
    if (!entry) throw Object.assign(new Error('scope has no declaring row'), { code: 'value_scope_unknown' });
    collectScope(entry.parent);
    for (const reference of valueReferences(entry.domain)) collect(resolved.lookup(reference, entry.parent));
  }
  for (const row of rows) if (selectedConstraintIds === null || selectedConstraintIds.has(row.identity)) {
    governing.add(row.identity);
    collectScope(scopeOf(row.constraint));
    if (row.constraint.definition) collect(resolved.lookup(row.constraint.subject, row.constraint.within ?? null));
    else for (const entity of dependencies(row.constraint)) collect(resolved.lookup(entity, scopeOf(row.constraint)));
  }
  let previous;
  do {
    previous = needed.size + governing.size;
    const subjects = new Set([...needed].map(key => identityKey(resolved.definitions.get(key).constraint.subject)));
    for (const row of rows) if (!row.constraint.definition && ['MUST', 'MUST_NOT', 'MAY'].includes(row.constraint.modality)
      && subjects.has(identityKey(row.constraint.subject))) {
      governing.add(row.identity);
      collectScope(scopeOf(row.constraint));
      for (const entity of dependencies(row.constraint)) collect(resolved.lookup(entity, scopeOf(row.constraint)));
    }
  } while (previous !== needed.size + governing.size);
  const qualifierDiagnostics = rows.filter(row => governing.has(row.identity) && row.constraint.unmapped_fields).map(row => ({ reason: 'value_qualifier_unsupported', subject: row.constraint.subject, cause: 'Declared qualifiers have no typed lowering', effects: { changed: false }, actor: 'requirement_author', recovery: 'Use supported qualifiers or retain the unresolved meaning explicitly.' }));
  const diagnostics = [...qualifierDiagnostics, ...resolved.diagnostics.filter(row => selectedConstraintIds === null
    || [...needed].some(key => row.definition_identity
      ? resolved.definitions.get(key).identity === row.definition_identity
      : identityKey(resolved.definitions.get(key).constraint.subject) === identityKey(row.subject)))];

  for (const { identity, constraint: row } of rows.filter(row => governing.has(row.identity) && !row.constraint.definition)) {
    const uses = [{ value: { referent: row.subject }, path: ['subject'] },
      ...(['if', 'unless'].includes(row.applies?.mode) ? row.applies.context.map((entity, index) =>
        ({ value: { referent: entity }, path: ['applies', 'context', index] })) : []),
      ...(row.operands ?? []).flatMap((operand, index) => operand.value
        ? [{ value: operand.value, path: ['operands', index, 'value'], scope: index === 2 && row.operands[1]?.binding ? row.operands[1].binding.scope : scopeOf(row) }]
        : operand.reference ? [{ value: { referent: operand.reference }, path: ['operands', index, 'reference'] }] : []),
      ...(row.clauses ?? []).flatMap((clause, index) => clause.domain ? [{ value: clause.domain, path: ['clauses', index, 'domain'] }] : []),
      ...(row.for_each ?? []).map((entry, index) => ({ value: entry.domain, path: ['for_each', index, 'domain'], scope: resolved.parentScope(entry.scope) }))];
    for (const use of uses) {
      const activeScope = Object.hasOwn(use, 'scope') ? use.scope : scopeOf(row);
      try { resolved.typeOf(use.value, activeScope); } catch (error) {
        if (!(error instanceof ControlledValueError)) throw error;
        diagnostics.push({ reason: error.code, subject: row.subject, referent: error.details.subject,
          cause: error.details.cause, scope: activeScope, constraint_identity: identity,
          use_path: [...use.path, ...(error.details.use_path ?? []).filter((part, index) => !(use.path.length === 1 && use.path[0] === 'subject' && index === 0 && part === 'referent')
            && !(use.path[0] === 'applies' && index === 0 && part === 'referent')
            && !(use.path.at(-1) === 'reference' && index === 0 && part === 'referent'))],
          ...(error.details.root_cause ? { root_cause: error.details.root_cause } : {}),
          effects: error.details.effects, actor: error.details.actor, recovery: error.details.recovery });
      }
    }
  }
  const rootBinding = observation => {
    const { path: _path, type: _type, ...provenance } = observation;
    const name = valueName(['observation_root', provenance]);
    if (!roots.has(name)) roots.set(name, { name, type: 'dyn', type_descriptor: celTypeDescriptor('dyn'), fact: 'value_root',
      ...structuredClone(provenance), root_type: 'dyn', meaning: 'Complete captured root data for this exact operation occurrence and snapshot boundary; expected types do not filter outputs.' });
    return roots.get(name);
  };
  const locals = (scope, local) => {
    let selected = scope;
    for (let i = 0; local && i < local.depth; i += 1) selected = resolved.parentScope(selected);
    const entry = resolved.scopes.get(lexicalScopeKey(selected));
    const prefix = valueName(['local', selected]);
    const domain = resolved.typeOf(entry.domain, resolved.parentScope(selected));
    const first = `${prefix}_first`, value = `${prefix}_value`;
    const provenance = lowering.value(entry.domain, resolved.parentScope(selected)).provenance;
    return local ? { name: local.slot === 'value' ? value : first, provenance }
      : { first, value, type: domain, provenance };
  };
  const bindAux = (scope, token) => {
    const key = lexicalScopeKey(scope), index = counter.get(key) ?? 0;
    counter.set(key, index + 1);
    const name = `${valueName(['selection', scope])}_${index}`;
    auxiliary.set(key, [...(auxiliary.get(key) ?? []), { name, token }]);
    return name;
  };
  const wrap = (bindings, body) => bindings.reduceRight((body, row) => `cel.bind(${row.name}, ${row.token}, ${body})`, body);
  const localDefinitions = scope => resolved.ordered.filter(definition => needed.has(definition.key) && lexicalScopeKey(definition.scope) === lexicalScopeKey(scope));
  const tokenBindings = scope => {
    const out = [];
    for (const definition of localDefinitions(scope)) {
      const key = lexicalScopeKey(scope), before = auxiliary.get(key)?.length ?? 0;
      const token = lowering.token(definition.constraint);
      out.push(...(auxiliary.get(key) ?? []).slice(before), { name: valueName(definition.key), token });
    }
    return out;
  };
  const normative = scope => rows.filter(row => governing.has(row.identity) && !row.constraint.definition
    && lexicalScopeKey(scopeOf(row.constraint)) === lexicalScopeKey(scope));
  const scopeBody = (scope, body, { obligations = true, capture = false } = {}) => {
    const key = `${lexicalScopeKey(scope)}:${body}:${obligations}:${capture}`;
    if (scopesBuilt.has(key)) return scopesBuilt.get(key);
    const prior = [...(auxiliary.get(lexicalScopeKey(scope)) ?? [])];
    const bindings = tokenBindings(scope), before = auxiliary.get(lexicalScopeKey(scope))?.length ?? 0;
    for (const row of normative(scope)) expressions.set(row.identity, constraintExpression(row.constraint));
    const checks = normative(scope).filter(row => row.constraint.form === 'closed_membership'
      || ['MUST', 'MUST_NOT'].includes(row.constraint.modality)).map(row => expressions.get(row.identity));
    checks.push(...permissionExpressions(scope));
    const extra = (auxiliary.get(lexicalScopeKey(scope)) ?? []).slice(before);
    const name = valueName(['scope_body', scope]);
    const content = capture ? `cel.bind(${name}, ${body}, dyn({"value": ${name}.value, "valid": ${name}.valid, "present": ${name}.present, "obligations": ${all(checks)}}))`
      : obligations ? all([body, ...checks]) : body;
    const result = wrap([...bindings, ...prior, ...extra], content);
    scopesBuilt.set(key, result);
    return result;
  };
  const lowering = createValueLowering(resolved, { rootBinding, scopeBody, locals, bindAux });
  const guard = row => {
    if (!row.applies || row.applies.mode === 'unconditional') return { valid: 'true', active: 'true' };
    if (!['if', 'unless'].includes(row.applies.mode)) {
      const read = [], scope = applicability(row.applies, read);
      for (const binding of read) scopeBindings.set(binding.name, binding);
      return { valid: knownObservations(read.map(binding => binding.name)), active: scope.applies };
    }
    const facts = row.applies.context.map(entity => lowering.value({ referent: entity }, scopeOf(row)));
    if (facts.some(fact => fact.type !== 'bool')) throw Object.assign(new Error('applicability requires Boolean definitions'), { code: 'value_condition_type_invalid' });
    return { valid: all(facts.flatMap(fact => [fact.valid, fact.present])),
      active: row.applies.mode === 'unless' ? `!(${all(facts.map(fact => fact.expression))})` : all(facts.map(fact => fact.expression)) };
  };
  function constraintExpression(row) {
    const scope = scopeOf(row), actual = lowering.value({ referent: row.subject }, scope), condition = guard(row);
    let body;
    if (['reference:precedes', 'reference:follows'].includes(row.relation)) {
      const events = [actual, ...row.operands.map(operand => lowering.value({ referent: operand.reference }, scope))];
      if (events.some(event => !event.provenance) || events.some(event => valueCanonicalKey(event.provenance) !== valueCanonicalKey(actual.provenance))) {
        throw Object.assign(new Error('bound events require the same declared operation occurrence and ordering root'), { code: 'value_event_provenance_mismatch' });
      }
      if (events.some(event => !event.type?.record?.fields.some(field => field.name === 'position' && field.type === 'int'))) {
        throw Object.assign(new Error('bound events require int position'), { code: 'value_event_type_invalid' });
      }
      const order = row.relation === 'reference:precedes' ? '<' : '>';
      body = `(${all(events.flatMap(event => [event.valid, event.present]))}) ? (${all(events.slice(1).map(event => `${actual.expression}.position ${order} ${event.expression}.position`))}) : false`;
      if (row.modality === 'MUST_NOT') body = `!(${body})`;
    } else if (row.form === 'closed_membership') {
      if (!actual.type?.list) throw Object.assign(new Error('data membership subject must be a typed list'), { code: 'value_membership_type_invalid' });
      const domains = row.clauses.map(clause => lowering.value(clause.domain, scope));
      if (domains.some(domain => !domain.type?.list || !compatibleValueTypes(actual.type.list, domain.type.list))) {
        throw Object.assign(new Error('membership domains and subject need compatible list element types'), { code: 'value_membership_type_invalid' });
      }
      const lookup = new Map(row.clauses.map((clause, i) => [valueCanonicalKey(clause.domain), domains[i]]));
      body = `(${all([actual.valid, actual.present, ...domains.flatMap(domain => [domain.valid, domain.present])])}) ? `
        + `(${conformityExpression(row, actual.expression, { domainExpression: domain => lookup.get(valueCanonicalKey(domain)).expression,
          typedEquality: (a, b) => celTypedEquality(a, b, actual.type.list) })}) : false`;
    } else {
      const expected = lowering.result(row, scope);
      if (!compatibleValueTypes(actual.type, expected.type)) throw Object.assign(new Error('subject and calculated value types differ'), { code: 'value_equation_type_invalid' });
      const equal = `(${actual.present}) && (${expected.present}) ? (${celTypedEquality(actual.expression, expected.expression, actual.type)}) : false`;
      const positive = row.relation === 'value:not_equals' ? `!(${equal})` : equal;
      body = `(${all([actual.valid, expected.valid])}) ? (${row.modality === 'MUST_NOT' ? `!(${positive})` : positive}) : false`;
    }
    return `(${condition.valid}) ? ((${condition.active}) ? (${body}) : true) : false`;
  }
  function permissionExpressions(scope) {
    const groups = new Map();
    for (const row of normative(scope).filter(row => row.constraint.relation?.startsWith('value:'))) {
      const key = identityKey(row.constraint.subject);
      groups.set(key, [...(groups.get(key) ?? []), row.constraint]);
    }
    return [...groups.values()].map(clauses => {
      const actual = lowering.value({ referent: clauses[0].subject }, scope);
      const permits = clauses.filter(row => ['MUST', 'MAY'].includes(row.modality) && row.relation !== 'value:not_equals').map(row => {
        const condition = guard(row), expected = lowering.result(row, scope);
        return `(${condition.valid}) ? ((${condition.active}) ? ((${expected.valid}) && (${expected.present}) ? (${celTypedEquality(actual.expression, expected.expression, actual.type)}) : false) : false) : false`;
      });
      return `(${actual.valid}) ? ((${actual.present}) ? (${permits.map(expression => `(${expression})`).join(' || ') || 'false'}) : true) : false`;
    });
  }
  if (diagnostics.length) {
    const constraints = rows.filter(row => governing.has(row.identity) || (row.constraint.definition
      && needed.has(resolved.lookup(row.constraint.subject, row.constraint.within ?? null)?.key))).map(row => {
      const own = diagnostics.find(diagnostic => diagnostic.definition_identity === row.identity || diagnostic.constraint_identity === row.identity);
      let failure = own;
      if (!failure) try {
        if (row.constraint.definition) resolved.typeOf({ referent: row.constraint.subject }, row.constraint.within ?? null);
        else {
          for (const entity of dependencies(row.constraint)) resolved.typeOf({ referent: entity }, scopeOf(row.constraint));
          if (row.constraint.relation?.startsWith('value:')) {
            const actual = resolved.typeOf({ referent: row.constraint.subject }, scopeOf(row.constraint));
            const expected = resolved.resultType(row.constraint);
            if (!compatibleValueTypes(actual, expected)) throw new ControlledValueError('value_equation_type_invalid',
              row.constraint.subject, 'subject and calculated value types differ', 'Correct the declared subject or operand type.');
          }
        }
      } catch (error) {
        if (!(error instanceof ControlledValueError)) throw error;
        failure = { reason: error.code, cause: error.details.cause, referent: error.details.subject,
          root_cause: error.details.root_cause ?? null };
      }
      return { identity: row.identity, expression: null, resolution: failure ? 'unresolved' : 'resolved',
        requires_definition_context: true,
        ...(failure ? { not_lowered: { reason: failure.reason, gap: failure.cause, diagnostic: failure } }
          : { expression_withheld: 'whole_specification_incomplete' }) };
    });
    return { constraints, conformity: null, admissible: null, recommended: null, bindings: [], input_contract: [],
      unresolved_definitions: diagnostics, environment: structuredClone(VALUE_CEL_ENVIRONMENT) };
  }
  try {

    const globalBindings = tokenBindings(null), before = auxiliary.get('')?.length ?? 0;
    for (const row of normative(null)) expressions.set(row.identity, constraintExpression(row.constraint));
    const mandatory = normative(null).filter(row => row.constraint.form === 'closed_membership' || ['MUST', 'MUST_NOT'].includes(row.constraint.modality)).map(row => expressions.get(row.identity));
    const quantify = entry => {
      const outer = resolved.parentScope(entry.scope), domain = lowering.value(entry.domain, outer), slots = locals(entry.scope, null);
      const childBodies = [...resolved.scopes.values()].filter(child => lexicalScopeKey(child.parent) === lexicalScopeKey(entry.scope)
        && activeScopes.has(lexicalScopeKey(child.scope)))
        .map(quantify);
      const body = scopeBody(entry.scope, all(childBodies));
      return `(${domain.valid}) && (${domain.present}) ? ${domain.expression}.all(${slots.first}, ${slots.value}, ${body}) : false`;
    };
    for (const entry of resolved.scopes.values()) if (!resolved.parentScope(entry.scope)
      && activeScopes.has(lexicalScopeKey(entry.scope))) mandatory.push(quantify(entry));
    mandatory.push(...permissionExpressions(null));
    const extra = (auxiliary.get('') ?? []).slice(before);
    const body = wrap([...globalBindings, ...extra], all(mandatory));
    const known = scopeBindings.size ? knownObservations([...scopeBindings.keys()]) : null;
    const conformity = known === null ? body : `${known} ? (${body}) : false`;
    const constraints = rows.filter(row => governing.has(row.identity) || (row.constraint.definition && needed.has(resolved.lookup(row.constraint.subject, row.constraint.within ?? null)?.key)))
      .map(row => ({ identity: row.identity, expression: row.constraint.definition ? null : expressions.get(row.identity) ?? null,
        requires_definition_context: true, force: row.constraint.definition ? 'structural' : row.constraint.modality === 'MAY' ? 'permitted' : 'mandatory',
        reads: [...roots.keys(), ...scopeBindings.keys()], ...(row.constraint.definition ? { role: 'value_definition' } : {}) }));
    return { constraints, conformity: diagnostics.length ? null : conformity, admissible: diagnostics.length ? null : known === null ? 'true' : `${known} ? true : false`, recommended: null,
      bindings: [...roots.values(), ...scopeBindings.values()], input_contract: [...roots.values()].map(root => ({ kind: 'observation_transport', operation: root.operation,
        occurrence: root.occurrence, root: root.root, snapshot: root.snapshot ?? null, reads: [root.name],
        requirement_shape: 'conformity', completeness: 'supplied_evidence_boundary', expected_value_substitution: false })),
      unresolved_definitions: diagnostics, environment: { language: 'CEL', macros: ['all', 'exists', 'map', 'filter'], ...structuredClone(VALUE_CEL_ENVIRONMENT) } };
  } catch (error) {
    if (!error.code?.startsWith('value_')) throw error;
    diagnostics.push({ reason: error.code, cause: error.details?.cause ?? error.message, subject: error.details?.subject ?? null,
      effects: { changed: false }, actor: 'requirement_author', recovery: 'Correct the named typed definition through the requirement batch.' });
    return { constraints: rows.map(row => ({ identity: row.identity, expression: null,
      not_lowered: { reason: error.code, gap: error.message } })), conformity: null, admissible: null, recommended: null,
      bindings: [...roots.values(), ...scopeBindings.values()], input_contract: [], unresolved_definitions: diagnostics, environment: structuredClone(VALUE_CEL_ENVIRONMENT) };
  }
}
