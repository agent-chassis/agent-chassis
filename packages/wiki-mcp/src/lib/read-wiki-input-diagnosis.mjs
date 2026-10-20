

import { isDeepStrictEqual } from 'node:util';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const at = (value, path) => path.reduce((held, key) => held?.[key], value);
const unique = rows => rows.filter((row, index) => !rows.slice(0, index).some(held => isDeepStrictEqual(held, row)));
const received = value => value === null ? 'null' : Array.isArray(value) ? 'array'
  : Number.isInteger(value) ? 'integer' : typeof value;
const sourceNames = ['subject', 'search', 'assignment', 'reference'];

function relevantBranches(issue) {
  const ranked = issue.unionErrors.map(error => {
    const unsupported = error.issues.filter(row => row.code === 'unrecognized_keys')
      .reduce((sum, row) => sum + row.keys.length, 0);
    const missing = error.issues.filter(row => row.code === 'invalid_type' && row.received === 'undefined').length;
    return { issues: error.issues, rank: [unsupported, missing] };
  });
  ranked.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
  return ranked.filter(row => isDeepStrictEqual(row.rank, ranked[0].rank)).map(row => row.issues);
}

function expectedType(path, type) {
  const key = path.at(-1);
  if (key === 'reads') return 'a nonempty array of Read objects';
  if (key === 'select') return 'an object naming one granted selection; omit select only when source context is intended';
  if (key === 'subject') return 'a known subject string or a declared structured subject';
  if (key === 'reference') return 'an issued reference object, preserved unchanged';
  if (key === 'search') return 'a search object with query or inventory:true';
  return type === 'undefined' ? 'an omitted field' : `a value of type ${type}`;
}

function fieldsFrom(issues, args, envelope = false) {
  return unique(issues.flatMap(issue => {
    const path = issue.path;
    if (issue.code === 'invalid_union') {
      const branches = relevantBranches(issue), fields = branches.map(rows => fieldsFrom(rows, args, envelope));
      if (branches.length === 1) return fields[0];
      const deciding = unique(fields.flat()).filter(field => at(args, field.path) !== undefined ||
        fields.every(branch => branch.some(row => isDeepStrictEqual(row.path, field.path))));
      return deciding.length ? deciding : [{ path, cause: 'The supplied object does not identify one supported form.',
        expected: 'choose one declared form and supply its required fields' }];
    }
    if (issue.code === 'unrecognized_keys') return issue.keys.map(key => ({ path: [...path, key],
      cause: 'Unsupported field.', expected: envelope && path.length === 0
        ? 'read fields belong inside each reads item; the envelope accepts only reads'
        : 'use a declared field at this location; do not silently drop intended constraints' }));
    if (issue.code === 'custom' && issue.message.startsWith('exactly one source')) return [];
    if (issue.code === 'invalid_type') return [{ path,
      cause: issue.received === 'undefined' ? 'Required value is missing.' : `Received ${received(at(args, path))}.`,
      expected: expectedType(path, issue.expected) }];
    if (issue.code === 'invalid_enum_value' || issue.code === 'invalid_literal') return [{ path,
      cause: at(args, path) === undefined ? 'Required value is missing.' : 'The supplied value is not supported here.', expected: path.at(-1) === 'field'
        ? 'a granted readable field path for the selected source'
        : `one of ${(issue.options ?? [issue.expected]).map(value => JSON.stringify(value)).join(', ')}` }];
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
    return fieldsFrom(issues, args);
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

  function item(args, validationError) {
    const missing_inputs = [];
    let invalid_fields;
    if (!object(args)) {
      invalid_fields = [{ path: [], cause: `Received ${received(args)}.`, expected: sourceForm }];
      missing_inputs.push({ path: [], choice: 'Supply the intended source and requested meaning as a Read object.' });
    } else {
      invalid_fields = itemFields(args, validationError);
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
      if (args.select !== undefined && !shape.select.safeParse(args.select).success)
        missing_inputs.push({ path: ['select'], choice: 'Choose a supported selection preserving the intended meaning; omit select only to request source context.' });
    }
    const query = queryIssueOf(args?.select);
    if (query) {
      const path = ['select', query.code === 'requirement_query_not_applicable' ? 'view' : 'query'];
      invalid_fields = unique([...invalid_fields.filter(field => !isDeepStrictEqual(field.path, path)),
        { path, cause: query.message, expected: query.code === 'requirement_query_not_applicable' ? 'view:"choices" when using query'
          : 'nonblank caller-authored words with contract:"requirements", view:"choices"' }]);
    }
    const corrected = normalizeItem(args);
    const next_calls = !isDeepStrictEqual(corrected, args) && readSchema.safeParse(corrected).success ? [call({ reads: [corrected] })] : [];
    const subject = object(args) ? ['subject', 'reference'].find(key => args[key] !== undefined && shape[key]?.safeParse(args[key]).success) : undefined;
    return { code: query?.code ?? 'workspace_read_wiki_selection_invalid',
      ...(subject === undefined ? {} : { subject: args[subject] }),
      cause: query?.message ?? 'The read item does not match the current request form.', invalid_fields: unique(invalid_fields),
      effects: { writes: [] }, next_calls,
      recovery: next_calls.length ? { state: 'callable', correction: 'Use the returned call; it preserves the supplied source and requested meaning.' }
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
      if (args.reads === undefined) corrected = { reads: [normalizeItem(args)] };
      else if (object(args.reads) && outer.length === 0) corrected = { reads: [normalizeItem(args.reads)] };
      else if (Array.isArray(args.reads) && outer.every(key => Object.hasOwn(shape, key) || selectionKeys.has(key))) {
        const reads = args.reads.map(normalizeItem);
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
