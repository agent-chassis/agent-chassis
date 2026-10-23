

import { isDeepStrictEqual } from 'node:util';
import { validationConstraintContext, enrichValidationIssue } from './tool-validation-constraints.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const at = (value, path) => path.reduce((held, key) => held?.[key], value);
const unique = rows => rows.filter((row, index) => !rows.slice(0, index).some(held => isDeepStrictEqual(held, row)));
const received = value => value === null ? 'null' : Array.isArray(value) ? 'array'
  : Number.isInteger(value) ? 'integer' : typeof value;
const sourceNames = ['subject', 'search', 'assignment', 'reference'];

function relevantBranches(issue) {
  const ranked = issue.unionErrors.map(error => {
    const wrongType = error.issues.filter(row => row.code === 'invalid_type' &&
      row.received !== 'undefined' && isDeepStrictEqual(row.path, issue.path)).length;
    const unsupported = error.issues.filter(row => row.code === 'unrecognized_keys')
      .reduce((sum, row) => sum + row.keys.length, 0);
    const missing = error.issues.filter(row => (['invalid_type', 'invalid_literal'].includes(row.code) && row.received === undefined) ||
      (row.code === 'invalid_type' && row.received === 'undefined')).length;
    return { issues: error.issues, rank: [wrongType, unsupported, missing] };
  });
  ranked.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
  return ranked.filter(row => isDeepStrictEqual(row.rank, ranked[0].rank)).map(row => row.issues);
}

function expectedType(path, type) {
  const key = path.at(-1);
  if (key === 'reads') return 'a nonempty array of Read objects';
  if (key === 'select') return 'an object naming one granted selection; omit select only when source context is intended';
  if (key === 'subject') return 'a known subject string or a declared structured subject';
  if (key === 'reference') return 'an issued reference object, preserved unchanged';
  if (key === 'search') return 'a search object with query or inventory:true';
  if (key === 'members' && path.at(-2) === 'input_contract') return 'a nonempty array naming the authoring members needed together';
  return type === 'undefined' ? 'an omitted field' : `a value of type ${type}`;
}

function fieldsFrom(issues, args, envelope = false, declaration = () => ({})) {
  return unique(issues.flatMap(issue => {
    const path = issue.path;
    if (issue.code === 'invalid_union') {
      const branches = relevantBranches(issue), fields = branches.map(rows => fieldsFrom(rows, args, envelope, declaration));
      if (branches.length === 1) return fields[0];
      const deciding = unique(fields.flat()).filter(field => at(args, field.path) !== undefined ||
        fields.every(branch => branch.some(row => isDeepStrictEqual(row.path, field.path))));
      return deciding.length ? deciding : [{ path, cause: 'The supplied object does not identify one supported form.',
        expected: 'choose one declared form and supply its required fields' }];
    }
    if ((issue.code === 'unrecognized_keys' && issue.keys.includes('view') && path.at(-1) === 'input_contract') ||
        (['invalid_enum_value', 'invalid_literal'].includes(issue.code) && path.at(-1) === 'view' && path.at(-2) === 'input_contract')) {
      const fields = issue.code === 'unrecognized_keys' ? fieldsFrom([{ ...issue, keys: issue.keys.filter(key => key !== 'view') }], args, envelope, declaration) : [];
      return [...fields, { path: issue.code === 'unrecognized_keys' ? [...path, 'view'] : path,
        cause: 'The supplied authoring-schema view is not supported.',
        expected: 'omit view to read the complete schema for the selected members and branches; view:"choices" discovers branch choices' }];
    }
    if (issue.code === 'unrecognized_keys') return issue.keys.map(key => ({ path: [...path, key],
      cause: 'Unsupported field.', expected: envelope && path.length === 0
        ? 'read fields belong inside each reads item; the envelope accepts only reads'
        : declaration(path, args).members?.length ? `accepted fields here: ${declaration(path, args).members.join(', ')}; preserve intended constraints`
          : 'use a declared field at this location; do not silently drop intended constraints' }));
    if (issue.code === 'custom' && issue.message.startsWith('exactly one source')) return [];
    if (issue.code === 'invalid_type') {
      const choices = declaration(path, args).choices;
      return [{ path,
        cause: issue.received === 'undefined' ? 'Required value is missing.' : `Received ${received(at(args, path))}.`,
        expected: choices?.length ? 'choose one declared value' : expectedType(path, issue.expected),
        ...(choices?.length ? { choices } : {}) }];
    }
    if (issue.code === 'invalid_enum_value' || issue.code === 'invalid_literal') return [{ path,
      cause: at(args, path) === undefined ? 'Required value is missing.' : 'The supplied value is not supported here.', expected: path.at(-1) === 'field'
        ? 'a granted readable field path for the selected source'
        : `one of ${(issue.options ?? [issue.expected]).map(value => JSON.stringify(value)).join(', ')}` }];
    if (issue.code === 'invalid_string' && issue.validation === 'regex') return [{ path,
      cause: 'The supplied value does not match the declared format.',
      expected: path.join('.') === 'reference.ref_id' ? 'the eight-character ref_id returned by a current answer, preserved unchanged'
        : issue.constraint?.pattern ? `a string matching ${issue.constraint.pattern}` : issue.message }];
    if (issue.code === 'too_small' || issue.code === 'too_big') return [{ path,
      cause: 'The supplied value is outside the accepted bound.',
      expected: path.at(-1) === 'reads' ? expectedType(path, 'array')
        : issue.type === 'number' ? `a number ${issue.code === 'too_small' ? 'greater' : 'less'} than${issue.inclusive ? ' or equal to' : ''} ${issue.minimum ?? issue.maximum}`
          : `${issue.type} with ${issue.code === 'too_small' ? 'at least' : 'at most'} ${issue.minimum ?? issue.maximum} ${issue.type === 'string' ? 'characters' : 'items'}` }];
    return [{ path, cause: issue.message, expected: 'correct the stated constraint using the declared input form' }];
  }));
}

export function createReadWikiInputDiagnosis({ readSchema, inputSchema, call, queryIssueOf }) {
  const shape = readSchema.innerType().shape;
  const sources = sourceNames.filter(key => Object.hasOwn(shape, key));
  const select = shape.select.unwrap();
  const alternatives = select.options ?? [select];
  const selectionKeys = new Set(alternatives.flatMap(schema => Object.keys(schema.shape)));
  const primaryKeys = new Set(alternatives.map(schema => Object.keys(schema.shape)[0]));
  const constraints = validationConstraintContext(readSchema);
  function declaration(path) {
    const facts = constraints.nodesAt(path).map(constraints.facts);
    return { members: [...new Set(facts.flatMap(fact => fact.accepted_members ?? []))],
      choices: [...new Set(facts.flatMap(fact => fact.enum ?? (Object.hasOwn(fact, 'const') ? [fact.const] : [])))] };
  }
  const sourceForm = `a Read object with exactly one source: ${sources.join(', ')}; select optionally names the requested meaning`;
  const prefixIssues = (issues, prefix) => issues.map(issue => ({ ...issue, path: [...prefix, ...issue.path],
    ...(issue.unionErrors ? { unionErrors: issue.unionErrors.map(error => ({ issues: prefixIssues(error.issues, prefix) })) } : {}) }));

  function itemFields(args, validationError) {
    let issues = validationError.issues;

    for (const [key, optional] of Object.entries(shape)) {
      if (args[key] === undefined) continue;
      const options = optional.unwrap().options;
      if (!options) continue;
      const parsed = options.map(schema => schema.safeParse(args[key]));
      if (parsed.some(result => result.success)) continue;
      issues = [...issues.filter(issue => issue.path[0] !== key), { code: 'invalid_union', path: [key],
        unionErrors: parsed.map(result => ({ issues: prefixIssues(result.error.issues, [key]) })) }];
    }
    const contract = args.select?.input_contract;
    if (object(contract) && ['full', 'schema'].includes(contract.view)) {

      const full = alternatives.filter(schema => {
        const declared = schema.shape.input_contract?.shape;
        return declared && !declared.view && (contract.operation === undefined ? !declared.operation : declared.operation);
      });
      if (full.length === 1) {
        const parsed = full[0].safeParse(args.select);
        if (!parsed.success) issues = [...issues.filter(issue => issue.path[0] !== 'select'), ...prefixIssues(parsed.error.issues, ['select'])];
      }
    }
    return fieldsFrom(issues.map(issue => enrichValidationIssue(issue, constraints, args)), args, false, declaration);
  }

  function normalizeItem(args) {
    if (!object(args)) return args;
    const extra = Object.keys(args).filter(key => !Object.hasOwn(shape, key));

    if (args.select === undefined && extra.length && extra.every(key => selectionKeys.has(key)) &&
        extra.filter(key => primaryKeys.has(key)).length === 1) {
      const result = { ...args, select: Object.fromEntries(extra.map(key => [key, args[key]])) };
      for (const key of extra) delete result[key];
      return normalizeItem(result);
    }
    if (object(args.select?.input_contract) && ['full', 'schema'].includes(args.select.input_contract.view)) {
      const { view: _view, ...input_contract } = args.select.input_contract;
      const corrected = { ...args, select: { ...args.select, input_contract } };

      if (readSchema.safeParse(corrected).success) return corrected;
    }
    if (object(args.select) && !shape.select.safeParse(args.select).success &&
        Object.keys(args.select).some(key => primaryKeys.has(key))) {
      const candidates = alternatives.flatMap(schema => {
        if (Object.keys(args.select).some(key => !schema.shape[key]?.safeParse(args.select[key]).success)) return [];
        const missing = Object.entries(schema.shape).filter(([key, field]) => args.select[key] === undefined && !field.isOptional());

        if (!missing.length || missing.some(([, field]) => field._def.typeName !== 'ZodLiteral')) return [];
        const candidate = { ...args, select: { ...args.select, ...Object.fromEntries(missing.map(([key, field]) => [key, field.value])) } };
        return readSchema.safeParse(candidate).success ? [candidate] : [];
      });
      const distinct = unique(candidates);
      if (distinct.length === 1) return distinct[0];
    }
    return args;
  }

  const closedValues = field => {
    while (field.isOptional() && field.unwrap) field = field.unwrap();
    return field._def.typeName === 'ZodEnum' ? field.options
      : field._def.typeName === 'ZodLiteral' ? [field.value] : [];
  };
  function structuralSelections(value) {
    if (typeof value === 'string') return unique(alternatives.flatMap(schema => {
      const key = Object.keys(schema.shape)[0];
      return closedValues(schema.shape[key]).includes(value) && schema.safeParse({ [key]: value }).success ? [[{ [key]: value }]] : [];
    }));
    if (Array.isArray(value) && value.length) {
      const members = value.map(structuralSelections);
      return members.every(choices => choices.length === 1) ? [members.flatMap(choices => choices[0])] : [];
    }
    if (!object(value)) return [];
    if (shape.select.safeParse(value).success) return [[value]];
    const entries = Object.entries(value);
    if (entries.length !== 1) return [];
    const [key, nested] = entries[0];
    const named = object(nested) ? alternatives.flatMap(schema => {
      const primary = Object.keys(schema.shape)[0];
      if (!closedValues(schema.shape[primary]).includes(key) || Object.hasOwn(nested, primary)) return [];
      const selection = { [primary]: key, ...nested };
      return schema.safeParse(selection).success ? [[selection]] : [];
    }) : [];
    if (object(nested) && alternatives.some(schema => closedValues(schema.shape[Object.keys(schema.shape)[0]]).includes(key)))
      return unique(named);

    return unique([...named, ...(!primaryKeys.has(key) || object(nested) ? structuralSelections(nested) : [])]);
  }
  function normalizedReads(args) {
    const normalized = normalizeItem(args);
    if (!isDeepStrictEqual(normalized, args) && readSchema.safeParse(normalized).success) return [normalized];
    if (!object(args) || !object(args.select)) return [args];
    const candidates = structuralSelections(args.select).map(selections => selections.map(select => ({ ...args, select })))
      .filter(reads => reads.every(read => readSchema.safeParse(read).success));
    return candidates.length === 1 ? candidates[0] : [args];
  }

  function item(args, validationError, { referenceDiscovery = false } = {}) {
    const missing_inputs = [];
    let invalid_fields;
    if (!object(args)) {
      invalid_fields = [{ path: [], cause: `Received ${received(args)}.`, expected: sourceForm }];
      missing_inputs.push({ path: [], choice: 'Supply the intended source and requested meaning as a Read object.' });
    } else {
      const placed = normalizeItem(args);
      const placedResult = readSchema.safeParse(placed);
      invalid_fields = !isDeepStrictEqual(placed, args) && !placedResult.success
        ? [...itemFields(placed, placedResult.error), ...Object.keys(args).filter(key => !Object.hasOwn(shape, key))
          .map(key => ({ path: [key], cause: 'Selection is outside select.', expected: `place ${key} inside select; preserve its supplied members and constraints` }))]
        : itemFields(args, validationError);
      if (object(args.select)) {
        const meanings = Object.keys(args.select).filter(key => primaryKeys.has(key));
        if (meanings.length > 1) {
          invalid_fields = invalid_fields.filter(field => !(field.path.length === 2 && field.path[0] === 'select' && meanings.includes(field.path[1])));
          invalid_fields.push({ path: ['select'], cause: `Several selection forms were supplied: ${meanings.join(', ')}.`,
            expected: 'one selection form per Read; request distinct meanings as separate reads in the same call' });
        }
      }
      const present = sources.filter(key => args[key] !== undefined);
      if (present.length !== 1) {
        invalid_fields.push({ path: [], cause: present.length ? `Several sources were supplied: ${present.join(', ')}.` : 'No granted source was supplied.',
          expected: sourceForm });
        missing_inputs.push({ path: [], choice: present.length ? 'Choose which supplied source to read.' : 'Supply the source you intend to read.' });
      } else if (!shape[present[0]].safeParse(args[present[0]]).success)
        missing_inputs.push({ path: [present[0]], choice: 'Supply the intended source using its declared form; no source was inferred.' });
      if (args.select !== undefined && !shape.select.safeParse(args.select).success) {
        const missingMembers = invalid_fields.find(field => field.path.join('.') === 'select.input_contract.members' && args.select?.input_contract?.members === undefined);
        missing_inputs.push(missingMembers ? { path: missingMembers.path, choice: 'Choose the authoring members needed together; no member is inferred.' }
          : { path: ['select'], choice: 'Choose a supported selection preserving the intended meaning; omit select only to request source context.' });
      }
      const required = invalid_fields.filter(field => field.cause === 'Required value is missing.');
      if (required.length) {
        for (let index = missing_inputs.length - 1; index >= 0; index--)
          if (missing_inputs[index].path.join('.') === 'select') missing_inputs.splice(index, 1);
        for (const field of required) if (!missing_inputs.some(input => isDeepStrictEqual(input.path, field.path)))
          missing_inputs.push({ path: field.path, choice: 'Supply this required value using the stated form; no caller choice was inferred.' });
      }
    }
    const query = queryIssueOf(args?.select);
    if (query) {
      const path = ['select', query.code === 'requirement_query_not_applicable' ? 'view' : 'query'];
      invalid_fields = unique([...invalid_fields.filter(field => !isDeepStrictEqual(field.path, path)),
        { path, cause: query.message, expected: query.code === 'requirement_query_not_applicable' ? 'view:"choices" when using query'
          : 'nonblank caller-authored words with contract:"requirements", view:"choices"' }]);
    }
    const corrected = normalizedReads(args);
    const exact = !isDeepStrictEqual(corrected, [args]) && corrected.every(read => readSchema.safeParse(read).success);
    const source = object(args) ? Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'select')) : null;
    const discovery = !exact && object(args?.select) && Object.keys(args.select).every(key => !primaryKeys.has(key))
      && source && (source.reference === undefined || referenceDiscovery) && readSchema.safeParse(source).success ? { ...call({ reads: [source] }), recommended: false,
        purpose: 'discover_supported_selections',
        information: 'Read supported choices for this same source only. This does not perform or replace the refused selection; retain its intended constraints when choosing.' } : null;
    const next_calls = exact ? [call({ reads: corrected })] : discovery ? [discovery] : [];
    const subject = object(args) ? ['subject', 'reference'].find(key => args[key] !== undefined && shape[key]?.safeParse(args[key]).success) : undefined;
    return { code: query?.code ?? 'workspace_read_wiki_selection_invalid',
      ...(subject === undefined ? {} : { subject: args[subject] }),
      cause: query?.message ?? 'The read item does not match the current request form.', invalid_fields: unique(invalid_fields),
      effects: { writes: [] }, next_calls,
      recovery: exact ? { state: 'callable', correction: 'Use the returned call; it preserves the supplied source and requested meaning.' }
        : { state: 'caller_choice', ...(missing_inputs.length ? { missing_inputs } : {}),
          correction: 'Correct the identified fields without dropping intended sources, selections or constraints.' } };
  }

  function envelope(args, validationError) {
    const invalid_fields = fieldsFrom(validationError.issues, args, true).map(field => field.path.length ? field : {
      ...field, expected: 'an object containing only a nonempty reads array' }), missing_inputs = [];
    if (Array.isArray(args?.reads)) for (const [index, read] of args.reads.entries()) {
      const parsed = readSchema.safeParse(read);
      if (!parsed.success) {
        const diagnosis = item(read, parsed.error);
        invalid_fields.push(...diagnosis.invalid_fields.map(field => ({ ...field, path: ['reads', index, ...field.path] })));
        missing_inputs.push(...(diagnosis.recovery.missing_inputs ?? []).map(field => ({ ...field, path: ['reads', index, ...field.path] })));
      }
    }
    let corrected = null;
    if (object(args)) {
      const outer = Object.keys(args).filter(key => key !== 'reads');
      if (args.reads === undefined) corrected = { reads: normalizedReads(args) };
      else if (object(args.reads) && outer.length === 0) corrected = { reads: normalizedReads(args.reads) };
      else if (Array.isArray(args.reads) && outer.every(key => Object.hasOwn(shape, key) || selectionKeys.has(key))) {
        const reads = args.reads.flatMap(normalizedReads);
        if (outer.every(key => args[key] === null)) corrected = { reads };
        else if (reads.length === 1 && object(reads[0]) && outer.every(key => args[key] === null || reads[0][key] === undefined || isDeepStrictEqual(args[key], reads[0][key]))) {
          corrected = { reads: [normalizeItem({ ...reads[0], ...Object.fromEntries(outer.filter(key => args[key] !== null).map(key => [key, args[key]])) })] };
        }
      }
    }
    const next_calls = corrected && inputSchema.safeParse(corrected).success && corrected.reads.every(read => readSchema.safeParse(read).success)
      ? [call(corrected)] : [];
    if (!next_calls.length && !missing_inputs.length) missing_inputs.push({ path: ['reads'],
      choice: 'Supply a nonempty reads array; each item must state its intended source and requested meaning. Resolve conflicting or unsupported fields explicitly.' });
    return { code: 'tool_input_validation_failed', accepted: false, tool: 'workspace_read_wiki',
      cause: 'The bulk envelope is invalid; no reads were performed.', invalid_fields: unique(invalid_fields),
      effects: { reads: [], writes: [] }, next_calls,
      recovery: next_calls.length ? { state: 'callable', correction: 'Use the returned current-schema call; the malformed request was not executed.' }
        : { state: 'caller_choice', missing_inputs, correction: 'Supply the identified caller choices and correct the fields before reading.' } };
  }
  return { item, envelope };
}
