

import { resolveRecordAuthoringDefinition } from '@agent-chassis/wiki-core/src/lib/record-authoring-shared-definitions.mjs';
import { FIND_PROOFS_TASK } from '@agent-chassis/controlled-contract/proof-discovery-task';

export const PROOF_PART_KINDS = Object.freeze(['overview', 'comparisons', 'authoring', 'parameter', 'constraint']);

const MATCH_TIERS = Object.freeze(['assertion_match', 'partial_assertion_match',
  'navigation_or_exclusion_match']);
const SAVE_TASK = 'save_record';
const call = args => ({ tool: FIND_PROOFS_TASK, arguments: args });
const selecting = (locator, selection) => call({ result: locator, selection });

const INDEX_MEANING = 'Lexical candidates in the ranking owner\'s order, grouped by match tier; ' +
  'none is selected. assertion_match: every property term occurs in assertion, constraint or ' +
  'definition text; partial_assertion_match: some; navigation_or_exclusion_match: none. ' +
  'A proof outside this list is not ruled out.';
const CATALOGUE_MEANING = 'Every listed proof, once, in the catalogue owner\'s order; none is ' +
  'selected or recommended. A short description is navigation prose, not the admitted ' +
  'assertion: select a proof to read its complete meaning before binding it.';
const NO_MATCH_MEANING = 'No lexical match. This neither shows that no proof applies nor ' +
  'recommends opting out: send another property query or a known proof_name.';
const COMPARISON_MEANING = 'Comparisons are guidance for telling proofs apart; they are ' +
  'not part of the admitted assertion. Each alternative offers a read, never a selection for you.';
const SOURCE_SCOPE = 'host package catalogue; not the content of a frozen review candidate';

export function proofDiscoveryAlternatives(request = {}) {
  const context = request.target_family === undefined ? {} : { target_family: request.target_family };
  return {
    browse: call({}),
    refine: { tool: FIND_PROOFS_TASK, executable: false, known_arguments: context,
      missing_caller_input: ['query'] },
    named: { tool: FIND_PROOFS_TASK, executable: false, known_arguments: context,
      missing_caller_input: ['proof_name'] }
  };
}

const rowVariants = row => { const alternatives = row.oneOf ?? row.anyOf;
  return Array.isArray(alternatives) && alternatives.every(variant => variant.type === 'object') ? alternatives : [row]; };

const ROW_IDENTITIES = Object.freeze(['key', 'row_id', 'id']);
function rowMembers(row) {
  const variants = rowVariants(row);
  const names = [...new Set(variants.flatMap(variant => Object.keys(variant.properties)))];
  return { members: names.filter(name => !ROW_IDENTITIES.includes(name)),

    variants: variants.map(variant => ({
      identity: ROW_IDENTITIES.filter(name => Object.hasOwn(variant.properties, name)),
      required: [...(variant.required ?? [])] })) };
}

const identityRequired = row => row.variants.every(variant =>
  variant.identity.some(name => variant.required.includes(name)));
const rowProperty = (row, name) => rowVariants(row).find(variant => Object.hasOwn(variant.properties, name))
  .properties[name];

export function authoringSchemaMembers(changeSchema) {

  const declared = node => resolveRecordAuthoringDefinition(changeSchema, node);

  const batch = declared(changeSchema.properties.requirements);
  const [requirement, membership] = batch.properties.requirements.items.oneOf.map(declared);
  const obligation = declared(changeSchema.properties.obligations.items);
  return {
    requirements: { field: 'changes.requirements.requirements', batch_members: Object.keys(batch.properties),
      ...rowMembers(requirement),
      verification: rowMembers(declared(rowProperty(requirement, 'verification'))),
      closed_membership: rowMembers(membership) },
    obligations: { ...rowMembers(obligation),
      proof: rowMembers(declared(rowProperty(obligation, 'proof'))).members,
      case: rowMembers(declared(rowProperty(obligation, 'case'))) }
  };
}

export function familyAuthoringFacts(caseAuthoring, familyId) {
  const family = caseAuthoring.families[familyId];
  const mechanism = caseAuthoring.falsification[family.falsification];
  return {
    family_id: familyId, runner: family.runner, source_suffixes: family.source_suffixes,
    target: { variant: family.target_variant, ...caseAuthoring.target_variants[family.target_variant],
      ...(family.provider ? { provider: family.provider } : {}),

      ...Object.fromEntries(Object.entries(family).filter(([member]) => member.endsWith('_form'))) },
    falsification: { mechanism: family.falsification, strategies: mechanism.strategies,
      field_patterns: mechanism.field_patterns, target_constraint: { ...mechanism.target_constraint,
        examples: mechanism.target_constraint.examples.filter(example => family.languages.includes(example.language)) } }
  };
}

export function authoredFalsificationFacts({ strategies, field_patterns: fieldPatterns, target_constraint: targetConstraint }) {
  return { strategies: Object.fromEntries(Object.entries(strategies).map(([strategy, fields]) =>
    [strategy, { required: fields.required, not_allowed: fields.not_allowed }])),
  field_patterns: fieldPatterns, target_constraint: targetConstraint };
}

export function familyChoiceFacts(caseAuthoring) {
  return Object.entries(caseAuthoring.families).map(([familyId, family]) => (
    { family_id: familyId, runner: family.runner, source_suffixes: family.source_suffixes,
      selector_fields: caseAuthoring.target_variants[family.target_variant].fields
        .filter(field => field.startsWith('selector.')) }));
}

const awaitsFamily = (carrier, proof) => proof.verification_capability !== null && carrier.family === null;

function familyChoice(carrier, proof) {
  return { input: 'target_family', input_of: FIND_PROOFS_TASK,
    meaning: 'The family that runs the test decides the case target and falsification, and none is ' +
      'chosen for the caller: no call here has been made. Each call is a fresh read of the CURRENT ' +
      'catalogue entry for this proof with that family, returning a new result; this retained ' +
      'result is not changed and stays without a family.',
    choices: familyChoices(carrier).map(choice => ({ ...choice,
      call: call({ proof_name: proof.proof_name, target_family: choice.family_id,
        part: { kind: 'authoring' } }) })) };
}

function familyChoices(carrier) {
  return carrier.recognition.status === 'ambiguous'
    ? carrier.family_choices.filter(choice => carrier.recognition.families.includes(choice.family_id))
    : carrier.family_choices;
}

function queryFamilyChoices(carrier) {
  return carrier.family === null && ['ambiguous', 'conflicting'].includes(carrier.recognition.status)
    ? { choose_family: { input: 'target_family', input_of: FIND_PROOFS_TASK,
      meaning: 'Choose the intended test runner; this refines the query context, selects no proof and authorizes no execution.',
      choices: familyChoices(carrier).map(choice => ({ ...choice,
        call: call({ query: carrier.request.query, target_family: choice.family_id }) })) } } : {};
}

function authoredTarget({ variant: _variant, ...target }) {
  return target;
}

function familySelection(carrier) {
  const { family, recognition } = carrier;
  const explicit = carrier.request.target_family ?? null;
  const contradicted = explicit !== null && recognition.families.length > 0 &&
    !recognition.families.includes(explicit);
  return {
    selected: family?.family_id ?? null,
    ...(family === null && ['ambiguous', 'conflicting'].includes(recognition.status)
      ? { query_recognition: recognition.status,
        ...(recognition.status === 'ambiguous' ? { query_named: recognition.families }
          : { query_terms: recognition.provider_terms }) } : {}),
    ...(contradicted ? { observation: 'the query words name another family; the explicit ' +
      'target_family is the selection and the query words are not' } : {})
  };
}

function envelope(carrier, locator, currentness, body, nextCalls) {
  return { result: locator,
    source: { currentness: typeof currentness === 'string' ? currentness : currentness.status,
      ...(typeof currentness === 'string' ? {} : { inspection_failure: currentness.failure }), scope: SOURCE_SCOPE },
    ...body, next_calls: nextCalls };
}

const INDEX_SELECTION_MEANING = 'Choose a listed proof first. Copy select.known_arguments, keep result ' +
  'unchanged, and add selection.proof_name with that identity to compose executable arguments. ' +
  'This form is not executable until you supply that choice. A later part goes inside selection, as selection.part.';

export function projectIndex(carrier, locator, currentness) {
  const browse = carrier.mode === 'browse';
  const empty = carrier.proofs.length === 0;
  const partial = carrier.availability !== undefined;
  return envelope(carrier, locator, currentness, {
    ...(partial ? { availability: carrier.availability } : {}),
    ...(browse ? { answer: 'catalogue', population: carrier.population,
      meaning: partial ? 'Every available proof is listed once; the population is incomplete. ' +
        'Failed definitions cannot be selected and are not evidence of no applicable proof. None is selected or recommended.'
        : empty ? 'The catalogue lists no proofs; no proof can be selected from this result.' : CATALOGUE_MEANING,
      proofs: carrier.proofs.map(proof => proof.proof_name) }
      : { answer: 'matches', query: carrier.query, population: carrier.population,
        meaning: partial ? 'Only available definitions were searched; matches are incomplete. ' +
          'Unavailable definitions may match or apply; no proof is selected. ' + (empty
            ? 'No lexical matches were found among the available definitions.' : INDEX_MEANING)
          : empty ? NO_MATCH_MEANING : INDEX_MEANING,
        matches: MATCH_TIERS.map(tier => ({ tier,
          proofs: carrier.proofs.filter(proof => proof.match_kind === tier).map(proof => proof.proof_name) }))
          .filter(group => group.proofs.length > 0) }),

    short_descriptions: Object.fromEntries(carrier.proofs.map(proof =>
      [proof.proof_name, proof.short_description])),
    ...(browse || carrier.recognition.status === 'unspecified' && carrier.family === null
      ? {} : { family: familySelection(carrier) })
  }, empty ? browse ? {} : { ...proofDiscoveryAlternatives(carrier.request), ...queryFamilyChoices(carrier) } : {
    select: { tool: FIND_PROOFS_TASK, executable: false, known_arguments: { result: locator },
      missing_caller_input: ['selection.proof_name'] },
    selection: INDEX_SELECTION_MEANING,
    ...queryFamilyChoices(carrier)
  });
}

export function projectIndexSummary(carrier, locator, currentness) {
  const availability = carrier.availability === undefined ? {} : { availability: carrier.availability };
  if (carrier.mode === 'browse') return envelope(carrier, locator, currentness, {
    ...availability,
    answer: 'catalogue_summary', population: carrier.population, meaning: carrier.availability === undefined
      ? CATALOGUE_MEANING : 'The catalogue is incomplete: only available definitions can be selected. No proof is selected.',
    complete_index: 'next_calls.catalogue returns every available proof of this result, in order, in one answer'
  }, { catalogue: call({ result: locator }) });
  return envelope(carrier, locator, currentness, {
    ...availability,
    answer: 'matches_summary',
    query: carrier.query,
    population: carrier.population,
    meaning: carrier.availability === undefined ? INDEX_MEANING
      : 'Only available definitions were searched; matches are incomplete. Unavailable definitions may match or apply. No proof is selected.',
    matches_by_tier: MATCH_TIERS.map(tier => ({ tier,
      count: carrier.proofs.filter(proof => proof.match_kind === tier).length }))
      .filter(group => group.count > 0),
    complete_index: 'next_calls.matches returns every match of this result, in order, in one answer',
    ...(carrier.recognition.status === 'unspecified' && carrier.family === null
      ? {} : { family: familySelection(carrier) })
  }, { matches: call({ result: locator }) });
}

export function projectProofSummary(carrier, locator, currentness, proof) {
  return envelope(carrier, locator, currentness, {
    answer: 'proof_summary', proof: proofIdentity(proof),
    verification_capability: proof.verification_capability,
    parameter_count: proof.refinements.length, constraint_count: proof.constraints.length,
    complete_answer: 'next_calls.select returns the complete overview'
  }, { select: selecting(locator, { proof_name: proof.proof_name, part: { kind: 'overview' } }) });
}

const proofIdentity = proof => ({ name: proof.proof_name, version: proof.profile_version });
const parameterRefs = proof => new Set(proof.refinements.flatMap(parameter => parameter.applicability));

function overviewPart(proof) {
  const attached = parameterRefs(proof);
  return {
    short_description: proof.short_description, usage: proof.usage,
    assertion: proof.assertion,
    exclusions: proof.exclusions,

    parameters: proof.refinements.map(parameter => parameter.name),
    constraint_count: proof.constraints.length,
    unattached_constraints: proof.constraints.map(constraint => constraint.ref)
      .filter(ref => !attached.has(ref)),
    observations: proof.observations,

    verification_capability: proof.verification_capability
  };
}

function authoringPart(carrier, proof, caseGuidance) {
  const needsCase = proof.verification_capability !== null;
  const family = needsCase ? carrier.family : null;
  const members = carrier.authoring_members;
  const obligation = 'changes.obligations[0]';
  const known = { proof: { name: proof.proof_name } };
  const missing = ['unit', 'revision',
    `${obligation}.key (a new obligation) or .id (an existing one)`,
    `${obligation}.statement`,
    `${obligation}.criteria: held criterion ids or $key labels of changes.criteria`,
    `${obligation}.claims: authored semantic selections or $key labels of changes.requirements.requirements`];
  missing.push(...proof.refinements.filter(parameter => parameter.source.policy === 'configurable' &&
    !optionalParameter(parameter)).map(parameter => `${obligation}.proof.parameters.${parameter.name}`));
  const caseInputs = [];
  if (needsCase) {

    if (identityRequired(members.obligations.case)) {
      caseInputs.push(`${obligation}.case.key (new) or .id (existing)`);
    }
    caseInputs.push(`${obligation}.case.component`, `${obligation}.case.observation.kind`);
    if (family !== null) {
      caseInputs.push(...family.target.fields.filter(field => !field.startsWith('provider.'))
        .map(field => `${obligation}.case.target.${field}`),
      `${obligation}.case.falsification: one listed strategy with its required members, ` +
        'or {support: "registry_unsupported"} to declare no falsifier for this case');
    }
  }
  return {

    case: needsCase ? 'required for execution, not proof selection or implementation admission: omit an unknown case; a supplied incomplete case remains an authored defect. A complete case may name a planned test before it exists'
      : 'none: this proof declares no test-execution capability',

    ...(needsCase && carrier.case_choices !== undefined ? { case_choices: carrier.case_choices } : {}),
    ...(needsCase && caseGuidance !== null ? {
      case_guidance_selection: { guidance: caseGuidance.arguments.reads[0].subject.topic }
    } : {}),
    ...(needsCase ? { family: { ...familySelection(carrier), ...(family === null
      ? { missing_input: 'target_family', missing_input_of: FIND_PROOFS_TASK,
        choose: 'next_calls.choose_family lists every family with the exact call that reads this ' +
          'authoring for it' }
      : { runner: family.runner, source_suffixes: family.source_suffixes, target: authoredTarget(family.target),
        falsification: authoredFalsificationFacts(family.falsification) }) } } : {}),

    parameters: { ...parameterChoices(proof), authored_as: parameterAuthoringAdvice(proof, needsCase) },
    save: { task: SAVE_TASK, executable: false, changes: { obligations: [known] }, missing_inputs: missing,
      ...(needsCase ? { execution_case_inputs: caseInputs } : {}),

      ...(awaitsFamily(carrier, proof) ? { awaits_family: {
        fields: [`${obligation}.case.target`, `${obligation}.case.falsification`],
        meaning: `target_family is an input of ${FIND_PROOFS_TASK}, never of ${SAVE_TASK}: these fields' ` +
          'members are listed as missing inputs by the authoring answer of the chosen family' } } : {}),
      meaning: 'changes carries only values this result establishes; every missing input is the ' +
        'caller\'s own authored fact and none is defaulted. This checklist describes a new complete ' +
        'proof decision, without an execution case; execution_case_inputs apply only when supplying a case. ' +
        'The family.target.provider is required in a supplied native target. Discovery does not inspect an existing unit for missing values. Incomplete drafts ' +
        'remain savable. Held current facts save without rediscovery.' },
    not_established: ['that this proof applies to the requirement',
      ...(needsCase ? ['that the target test exists or has a shape the falsifier accepts'] : []),
      'any proof execution or credit']
  };
}

const OPTIONAL_CARDINALITIES = Object.freeze(['zero_or_more', 'zero_or_one']);
function parameterAuthoringAdvice(proof, needsCase) {
  const names = policy => proof.refinements.filter(parameter => parameter.source.policy === policy)
    .map(parameter => parameter.name).join(', ');
  const canonical = names('canonical'), configurable = names('configurable'), derived = names('derived');
  return [
    ...(canonical ? [`canonical parameters (${canonical}) are source-owned` +
      (needsCase ? ': derived from the authored case' : '') + '; do not supply them in proof.parameters.'] : []),
    ...(configurable ? [`proof.parameters accepts explicit values only for configurable parameters (${configurable}), ` +
      'each replacing that value whole; a fully authored selection supplies every required configurable value.'] : []),
    ...(derived ? [`derived parameters (${derived}) are source-owned; do not supply them in proof.parameters.`] : []),
    'The parameter part carries its source policy, value kind and accepted value schema.'
  ].join(' ');
}

const optionalParameter = parameter => parameter.refinements.length > 0 && parameter.refinements.every(
  refinement => OPTIONAL_CARDINALITIES.includes(refinement.value?.cardinality));

function parameterChoices(proof) {

  const linked = parameter => ({ name: parameter.name, constraints: parameter.applicability });
  return { required: proof.refinements.filter(parameter => !optionalParameter(parameter)).map(linked),
    optional: proof.refinements.filter(optionalParameter).map(linked) };
}

function parameterPart(proof, name) {
  const parameter = proof.refinements.find(entry => entry.name === name);
  return parameter === undefined ? null
    : { name, value_kind: parameter.value_kind, source: parameter.source,
      value_schema: parameter.value_schema,
      refinements: parameter.refinements, constraints: parameter.applicability };
}

function constraintPart(proof, ref) {
  return proof.constraints.find(entry => entry.ref === ref) ?? null;
}

export function projectProof(carrier, locator, currentness, proof, part, fits, caseGuidance = null) {
  const select = selection => selecting(locator, { proof_name: proof.proof_name, part: selection });
  const identity = { answer: 'proof', proof: proofIdentity(proof) };
  const form = (kind, member) => ({ kind, tool: FIND_PROOFS_TASK, executable: false,
    known_arguments: { result: locator, selection: { proof_name: proof.proof_name, part: { kind } } },
    missing_caller_input: [`selection.part.${member}`] });
  const inputs = () => [
    ...(proof.refinements.length ? [form('parameter', 'name')] : []),
    ...(proof.constraints.length ? [form('constraint', 'ref')] : [])
  ];
  const index = carrier.mode === 'search' ? { matches: call({ result: locator }) }
    : carrier.mode === 'browse' ? { catalogue: call({ result: locator }) } : {};
  const build = (body, calls) => envelope(carrier, locator, currentness,
    { ...identity, ...body }, { ...calls, ...index });
  if (part === null || part.kind === 'overview') {
    const parts = inputs();
    const overview = build({ overview: overviewPart(proof) },
      { select: select({ kind: 'authoring' }),
        ...(proof.comparisons.length ? { comparisons: select({ kind: 'comparisons' }) } : {}),
        ...(parts.length ? { parts } : {}) });
    return { payload: fits(overview) ? overview : projectProofSummary(carrier, locator, currentness, proof) };
  }
  if (part.kind === 'comparisons') {
    const comparisons = proof.comparisons.map(comparison => ({
      explanation: comparison.explanation,
      alternatives: comparison.alternatives.map(alternative => {
        const unavailable = carrier.unavailable_definitions?.find(candidate =>
          candidate.proof_name === alternative.name && candidate.proof_version === alternative.version);
        if (unavailable !== undefined) return { proof: alternative, availability: 'unavailable',
          failures: unavailable.failures,
          stopping_condition: 'This result has no admitted meaning for this alternative; it cannot establish the compared conclusion.' };
        const retained = carrier.proofs.some(candidate => candidate.proof_name === alternative.name &&
          candidate.profile_version === alternative.version);
        return { proof: alternative, read_scope: retained ? 'retained' : 'current',
          read: retained ? selecting(locator, { proof_name: alternative.name })
            : call({ proof_name: alternative.name,
              ...(carrier.family === null ? {} : { target_family: carrier.family.family_id }) }) };
      })
    }));
    return { payload: build({ comparisons, comparisons_meaning: COMPARISON_MEANING +
      (comparisons.some(comparison => comparison.alternatives.some(alternative => alternative.read_scope === 'current'))
        ? ' A current read may return a newer definition than the compared version.' : '') }, {
      select: select({ kind: 'authoring' }), overview: select({ kind: 'overview' })
    }) };
  }
  if (part.kind === 'authoring') return { payload: build({ authoring: authoringPart(carrier, proof, caseGuidance) }, {
    ...(awaitsFamily(carrier, proof) ? { choose_family: familyChoice(carrier, proof) } : {}),
    parts: [{ kind: 'overview', ...select({ kind: 'overview' }) }, ...inputs()],
    ...(caseGuidance === null ? {} : { case_guidance: caseGuidance })
  }) };
  if (part.kind === 'parameter') {
    const parameter = parameterPart(proof, part.name);
    if (parameter === null) return { unknown: { reason: 'parameter_unknown', name: part.name } };
    return { payload: build({ parameter }, parameter.constraints.length ? {
      constraints: parameter.constraints.map(ref => ({ ref, ...select({ kind: 'constraint', ref }) }))
    } : {}) };
  }
  const constraint = constraintPart(proof, part.ref);
  if (constraint === null) return { unknown: { reason: 'constraint_unknown', ref: part.ref } };
  return { payload: build({ constraint }, {}) };
}
