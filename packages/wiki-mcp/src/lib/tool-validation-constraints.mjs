

import { projectZodRequestContract, unwrapRequestSchema, requestSchemaObjectShape,
  requestSchemaUnionOptions } from './zod-request-contract-projection.mjs';

const contexts = new WeakMap();
const valueAt = (value, path) => path.reduce((parent, part) => parent?.[part], value);
const typeOf = value => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

export function validationConstraintContext(inputSchema) {
  if (inputSchema == null) return null;
  if (contexts.has(inputSchema)) return contexts.get(inputSchema);
  const resolve = node => unwrapRequestSchema(node).schema;
  const variants = (node, value) => {
    const alternatives = requestSchemaUnionOptions(resolve(node));
    if (!alternatives) return [node];
    const shapes = alternatives.map(arm => requestSchemaObjectShape(resolve(arm)));
    let selected = alternatives.map((_arm, index) => index);
    for (const [key, supplied] of Object.entries(value && typeof value === 'object' ? value : {})) {

      const values = shapes.map(shape => {
        const field = resolve(shape[key]);
        return field?._def?.typeName === 'ZodLiteral' ? [field._def.value]
          : field?._def?.typeName === 'ZodEnum' ? field._def.values : null;
      });
      if (values.some(options => options === null)) continue;
      const matching = selected.filter(index => values[index].includes(supplied));
      if (matching.length) selected = matching;
    }
    return selected.map(index => alternatives[index]);
  };
  const nodesAt = (path, args) => {
    let nodes = [inputSchema], value = args;
    for (const part of path) {
      nodes = nodes.flatMap(node => variants(node, value).flatMap(alternative => {
      const node = resolve(alternative);
      return typeof part === 'number' ? node?._def?.type ?? [] : requestSchemaObjectShape(node)[part] ?? [];
      }));
      value = value?.[part];
    }
    return nodes.flatMap(node => variants(node, value)).filter(Boolean);
  };
  const facts = declared => {
    const { schema: node, description, refinements } = unwrapRequestSchema(declared);
    const shape = requestSchemaObjectShape(node);
    let body;
    if (node?._def?.typeName === 'ZodObject') body = { type: 'object',
      accepted_members: Object.keys(shape), required: Object.keys(shape).filter(key => !shape[key].isOptional()),
      ...(node._def.unknownKeys === 'strict' ? { additionalProperties: false } : {}),

      selectors: Object.fromEntries(Object.entries(shape).filter(([, child]) =>
        ['ZodLiteral', 'ZodEnum'].includes(resolve(child)?._def?.typeName)).map(([key, child]) => [key, facts(child)])) };
    else if (node?._def?.typeName === 'ZodArray') body = { type: 'array', items: facts(node._def.type),
      ...(node._def.minLength ? { minItems: node._def.minLength.value } : {}),
      ...(node._def.maxLength ? { maxItems: node._def.maxLength.value } : {}),
      ...(node._def.exactLength ? { minItems: node._def.exactLength.value, maxItems: node._def.exactLength.value } : {}) };
    else if (requestSchemaUnionOptions(node)) body = { alternatives: requestSchemaUnionOptions(node).map(facts) };
    else return projectZodRequestContract(declared)?.contract ?? {};
    const constraints = refinements.flatMap(refinement => refinement.declared ?? []);
    return { ...body, ...(description ? { description } : {}), ...(constraints.length ? { constraints } : {}) };
  };
  const locations = keys => {
    const cache = new WeakMap();
    const visit = (declared, ancestors) => {
      const node = resolve(declared);
      if (!node || ancestors.has(node)) return [];
      if (cache.has(node)) return cache.get(node);
      const next = new Set([...ancestors, node]), found = [];
      for (const [key, child] of Object.entries(requestSchemaObjectShape(node))) {
        if (keys.includes(key)) found.push([key, key]);
        found.push(...visit(child, next).map(([name, path]) => [name, `${key}${path.startsWith('[]') ? '' : '.'}${path}`]));
      }
      if (node._def?.typeName === 'ZodArray') found.push(...visit(node._def.type, next)
        .map(([name, path]) => [name, `[]${path ? '.' : ''}${path}`]));
      for (const child of requestSchemaUnionOptions(node) ?? []) found.push(...visit(child, next));
      cache.set(node, found);
      return found;
    };
    const result = {};
    for (const [key, path] of visit(inputSchema, new Set())) (result[key] ??= []).push(path);
    return Object.fromEntries(Object.entries(result).map(([key, paths]) => [key, [...new Set(paths)]]));
  };
  const context = { nodesAt, facts, locations, valueAt, typeOf };
  contexts.set(inputSchema, context);
  return context;
}

export function enrichValidationIssue(issue, context, args) {
  if (context === null) return issue;
  const path = typeof issue.path === 'string' ? issue.path.replace(/\[([0-9]+)\]/gu, '.$1').split('.')
    .map(part => /^[0-9]+$/u.test(part) ? Number(part) : part) : issue.path ?? [];
  const nodes = context.nodesAt(path, args);
  if (issue.code === 'unrecognized_keys') {
    const accepted = [...new Set(nodes.flatMap(node => Object.keys(requestSchemaObjectShape(unwrapRequestSchema(node).schema))))];
    const elsewhere = context.locations(issue.keys);
    return { ...issue, constraint: { ...issue.constraint,
      accepted_members: accepted,
      ...(Object.keys(elsewhere).length ? { accepted_key_paths: elsewhere } : {}) } };
  }
  if (['invalid_string', 'custom'].includes(issue.code)) {
    const declared = nodes.map(context.facts).filter(node => Object.keys(node).length);
    if (declared.length) return { ...issue, constraint: { ...issue.constraint,
      ...(declared.length === 1 ? declared[0] : { alternatives: declared }) } };
  }
  if (issue.unionErrors) {
    const value = context.valueAt(args, path);
    const score = branch => {
      const top = branch.issues.filter(child => child.path.length === path.length);
      return [top.some(child => child.code === 'invalid_type' && child.received !== 'undefined') ? 1 : 0,
        branch.issues.filter(child => child.code === 'invalid_literal' && child.received !== undefined).length,
        branch.issues.filter(child => child.received === 'undefined' ||
          child.code === 'invalid_literal' && child.received === undefined).length, branch.issues.length];
    };
    const ranked = issue.unionErrors.map((branch, index) => ({ branch, index, score: score(branch) }));
    ranked.sort((a, b) => {
      for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
      return a.index - b.index;
    });
    return { ...issue, unionErrors: ranked.map(({ branch }) => ({ issues: branch.issues.map(child =>
      enrichValidationIssue(child, context, args)) })),
    alternatives: nodes.map(node => ({ ...context.facts(node),
      ...(context.facts(node).type === context.typeOf(value) ? { supplied_type: true } : {}) })) };
  }
  return issue;
}
