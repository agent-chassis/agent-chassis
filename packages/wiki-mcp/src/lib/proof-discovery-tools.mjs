import { createTaskResultSnapshotRegistry, TaskResultSnapshotError } from '@agent-chassis/controlled-contract';
import { discoverCompleteControlledProofIntentsOperation,
  discoverControlledProofIntentsOperation } from '@agent-chassis/wiki-core';
import { createControlledContractRefusal } from '@agent-chassis/wiki-core/src/operations/controlled-contract/refusal.mjs';
import { CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE } from '@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs';
import { PROOF_INTENT_DISCOVERY_CATALOG, PROOF_INTENT_DISCOVERY_QUERY_POLICY, isProofIntentDiscoveryQueryWithinLimit, proofVerificationCapability } from '@agent-chassis/controlled-contract/proof-intent-discovery';
import { activeMcpInlineByteLimit, completeInlineJsonContent,
  measureMcpInlineResultBytes } from './mcp-response.mjs';
import { createToolInputValidationError } from './register-tool.mjs';

export const PROOF_DISCOVERY_TOOL = 'workspace_controlled_proof_intents_discover';
const domain = 'proof_discovery';
const action = args => ({ tool: PROOF_DISCOVERY_TOOL, arguments: args });
const recovery = action({});
const candidateFields = ['proof_name', 'matching_assertion', 'essential_limitation', 'scope'];
const scopeFields = ['clause', 'ranking', 'provenance'];
const intentsById = new Map(PROOF_INTENT_DISCOVERY_CATALOG.intents.map(
  intent => [intent.intent_id, intent]
));

function comparisonClauses(candidate) {
  const associationIds = new Set(candidate.associations);
  if (associationIds.size !== candidate.associations.length) throw new TaskResultSnapshotError(
    'invalid', 'catalog_association_ambiguous', recovery);
  for (const intentId of associationIds) if (!intentsById.has(intentId)) {
    throw new TaskResultSnapshotError('invalid', 'catalog_association_unknown', recovery);
  }
  return PROOF_INTENT_DISCOVERY_CATALOG.intents.filter(
    intent => associationIds.has(intent.intent_id)
  ).flatMap(intent => intent.distinctions.map(({ from_intent_id, explanation }) => ({
    comparison: { intent_id: intent.intent_id, from_intent_id, explanation }
  })));
}

const upsertGuidance = CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE;
const UNSPECIFIED_PROVIDER = Object.freeze({ status: 'unspecified', provider_terms: [], families: [] });

const LISTED_FAMILIES = Object.freeze(Object.keys(upsertGuidance.case_authoring.families));
const SUPPORT_STATES = upsertGuidance.case_authoring.support_states;
const RECOGNITION_MEANING =
  'query words only: which listed family the caller named. Not an availability, ' +
  'compatibility, selector-validity or execution fact; unspecified means the query named ' +
  'no family, never that the catalog lists none.';
const withGuidancePath = (call, ...segments) => ({ ...call, arguments: { ...call.arguments,
  input_contract: { ...call.arguments.input_contract,
    path: [...call.arguments.input_contract.path, ...segments] } } });

function identifiedFamily(familyId) {
  const { falsification: mechanism, ...family } = upsertGuidance.case_authoring.families[familyId];
  return { family_id: familyId, ...family,
    falsification: { mechanism, ...upsertGuidance.case_authoring.falsification[mechanism] } };
}

function providerFacts(provider) {
  const identified = provider.status === 'identified' ? provider.families[0] : null;
  return {
    query_recognition: provider.status,
    recognition_meaning: RECOGNITION_MEANING,
    ...(provider.provider_terms.length ? { recognized_terms: provider.provider_terms } : {}),
    ...(provider.families.length ? { families: provider.families } : {}),
    listed_families: LISTED_FAMILIES,
    ...(identified === null
      ? { missing_selection: 'provider identity, node_id form and falsification fields are ' +
          'per family: name one listed family, or read every family through case_authoring' }
      : identifiedFamily(identified)),

    not_established: [SUPPORT_STATES.candidate_proof, SUPPORT_STATES.listed_family,
      SUPPORT_STATES.target_uninspected]
  };
}

function authoringCalls(provider) {
  const identified = provider.status === 'identified' ? provider.families[0] : null;
  const caseAuthoring = upsertGuidance.authority.case_authoring;
  return {
    case_authoring: identified === null ? caseAuthoring
      : withGuidancePath(caseAuthoring, 'families', identified),
    unresolved: upsertGuidance.authority.unresolved_coverage
  };
}

function authoringContext(provider, page) {
  const testExecution = page.items.some(item =>
    proofVerificationCapability(item.proof_name) !== null);
  return {
    scope: page.total === 0 ? 'No lexical match; no proof is ruled out.'
      : page.remaining > 0 ? `${page.remaining} unread may apply.`
        : 'All lexical matches; no proof is ruled out.',
    ...(testExecution ? {
      candidate_route: 'a candidate row detail_action carries that proof\'s own authoring ' +
        'route; reading the remaining pages is not a prerequisite for following it',
      provider: providerFacts(provider)
    } : {}),
    next_calls: {
      ...(page.total === 0 ? { browse: action({}) } : {}),
      ...authoringCalls(provider)
    }
  };
}

function completeCatalogueAuthoring(provider, proofs, matchedCount, queried) {
  const testExecution = proofs.some(item => proofVerificationCapability(item.proof_name) !== null);
  return {
    scope: queried
      ? `Complete admitted catalogue; ${matchedCount} query matches are ranked first. Query relevance hides no proof.`
      : 'Complete admitted catalogue; no proof is hidden by a preview or page boundary.',
    ...(testExecution ? { provider: providerFacts(provider) } : {}),
    next_calls: authoringCalls(provider)
  };
}

function conciseRelevance(ranking, matched) {
  if (!matched) return { matched: false };
  return { matched: true, match_kind: ranking.match_kind,
    relevance_score: ranking.relevance_score, matched_terms: ranking.matched_terms,
    unmatched_terms: ranking.unmatched_terms, semantic_terms: ranking.semantic_terms,
    provider_terms: ranking.provider_terms };
}

function completeCatalogueCandidates(catalogue, ranked, queried) {
  const rankedByName = new Map(ranked.candidates.map(candidate => [candidate.proof_name, candidate]));
  const catalogueByName = new Map(catalogue.candidates.map(candidate => [candidate.proof_name, candidate]));
  if (rankedByName.size !== ranked.candidates.length ||
      [...rankedByName.keys()].some(name => !catalogueByName.has(name)) ||
      queried && (ranked.truncated || ranked.returned_count !== ranked.total_match_count)) {
    throw new TaskResultSnapshotError('invalid', 'catalogue_query_population_inconsistent', recovery);
  }
  return [...ranked.candidates,
    ...catalogue.candidates.filter(candidate => !rankedByName.has(candidate.proof_name))];
}

function completeCatalogueProjection({ candidates, ranked, identity, queried }) {
  const rankedNames = new Set(ranked.candidates.map(candidate => candidate.proof_name));
  const capabilitySetIds = new Map();
  const capabilitySets = [];
  const proofs = candidates.map(candidate => {
    const matched = rankedNames.has(candidate.proof_name);
    const capabilityKey = JSON.stringify(candidate.capabilities);
    let capabilitySet = capabilitySetIds.get(capabilityKey);
    if (capabilitySet === undefined) {
      capabilitySet = `capability-set-${capabilitySets.length + 1}`;
      capabilitySetIds.set(capabilityKey, capabilitySet);
      capabilitySets.push({ capability_set: capabilitySet, capabilities: candidate.capabilities });
    }
    return {
      id: candidate.id,
      proof_name: candidate.proof_name,
      proof_version: candidate.profile_version,
      assertion: candidate.assertion,
      exclusions: candidate.exclusions,
      intent_ids: candidate.associations,
      capability_set: capabilitySet,
      ...(proofVerificationCapability(candidate.proof_name) === null ? {}
        : { verification_capability: proofVerificationCapability(candidate.proof_name) }),
      ...(queried ? { relevance: conciseRelevance(candidate.ranking, matched),
        relevant_limitation: matched ? candidate.essential_limitation : null } : {}),
      detail_selector: { proof_name: candidate.proof_name }
    };
  });
  return {
    schema_version: 'controlled-proof-selection-catalogue.v1',
    complete: true,
    query: queried ? ranked.query : null,
    total: proofs.length,
    returned: proofs.length,
    remaining: 0,
    source_identity: ranked.source_identity,
    capability_sets: capabilitySets,
    detail_operation: {
      tool: PROOF_DISCOVERY_TOOL,
      fixed_arguments: { snapshot_identity: identity, collection: 'scope' },
      selector_field: 'selector.proof_name'
    },
    proofs,
    authoring: completeCatalogueAuthoring(ranked.provider_context ?? UNSPECIFIED_PROVIDER,
      proofs, ranked.total_match_count, queried)
  };
}

function candidateAuthoring(provider, proofName) {
  const capability = proofVerificationCapability(proofName);
  if (capability === null) return null;
  const identified = provider.status === 'identified' ? provider.families[0] : null;
  const family = identified === null ? null : upsertGuidance.case_authoring.families[identified];
  const caseAuthoring = upsertGuidance.authority.case_authoring;
  return {
    verification_capability: capability,
    meaning: 'this proof is observed through its authored selected test. Mutation, when the ' +
      'provider can apply it, supplies additional falsification evidence for that same proof; ' +
      'unavailable mutation does not erase the test observation. Author the existing required ' +
      'case.target and case.falsification fields through case_authoring; discovery establishes ' +
      'neither that the proof applies nor that any target can execute',
    provider: {
      query_recognition: provider.status,
      recognition_meaning: RECOGNITION_MEANING,
      listed_families: LISTED_FAMILIES,
      ...(identified === null ? {} : { family_id: identified,
        falsification_mechanism: family.falsification })
    },

    target_shape_limits: upsertGuidance.case_authoring.target_shape_limits,
    not_established: [SUPPORT_STATES.listed_family, SUPPORT_STATES.target_uninspected],
    next_calls: {
      ...authoringCalls(provider),
      falsifier_limits: identified === null
        ? withGuidancePath(caseAuthoring, 'falsification')
        : withGuidancePath(caseAuthoring, 'falsification', family.falsification, 'target_constraint')
    }
  };
}

function inspectAction(page, fieldPath, extra = {}, selector = page.selector) {
  return action({ snapshot_identity: page.task_result_identity, collection: page.collection,
    ...(selector === null ? {} : { selector }),
    ...(fieldPath === undefined ? {} : { field_path: fieldPath }), ...extra });
}

export function projectProofDiscoveryResponse(page, { rangeBytes = 1024 } = {}) {
  const next = page.continuation?.kind === 'cursor' ? action({ cursor: page.continuation.cursor }) : null;
  const name = page.proof_name;
  const fields = (entries, selector) => entries.map(field => ({
    field_path: field.path, value_kind: field.value_kind,
    detail_action: inspectAction(page, field.path, {}, selector)
  }));
  if (page.field_path) {
    if (page.range_required || Object.hasOwn(page, 'value_base64')) {
      const offset = page.offset;
      const length = page.length;
      const remaining = page.total - offset - length;
      return { proof_name: name, field_path: page.field_path, offset, length,
        total: page.total, value: page.value_base64 ?? '',
        continuation: remaining ? inspectAction(page, page.field_path, {
          offset: offset + length, length: Math.min(rangeBytes, remaining)
        }) : null };
    }
    if (page.fields) return { proof_name: name, complete: false,
      fields: fields(page.fields, page.selector), total: page.total,
      returned: page.returned, remaining: page.remaining, continuation: next };
    return { proof_name: name, field_path: page.field_path, value: page.value };
  }
  const inventory = page.items.find(item => item.schema_version === 'task-result-row-projection.v1');
  if (inventory) return { proof_name: inventory.proof_name, complete: false,
    fields: fields(inventory.fields, { id: inventory.stable_id }),
    total: page.total, returned: page.returned, remaining: page.remaining, continuation: next };
  const envelope = { results: page.collection === 'candidates' ? page.items.map(item => ({
    proof_name: item.proof_name, matching_assertion: item.matching_assertion,
    essential_limitation: item.essential_limitation,

    ...(proofVerificationCapability(item.proof_name) === null ? {}
      : { verification_capability: proofVerificationCapability(item.proof_name) }),
    detail_action: action({ snapshot_identity: page.task_result_identity,
      collection: 'scope', selector: { proof_name: item.proof_name } })
  })) : page.items.map(item => item.clause),
  total: page.total, returned: page.returned, remaining: page.remaining, continuation: next };
  if (page.collection === 'candidates' && page.offset === 0 && page.provider_context) {
    envelope.authoring = authoringContext(page.provider_context, page);
  }
  if (page.collection === 'scope') {
    envelope.proof_name = name;
    if (page.offset === 0 && page.items.length) {
      envelope.detail_actions = {
        ranking: inspectAction(page, ['ranking'], {}, { id: page.items[0].id }),
        provenance: inspectAction(page, ['provenance'], {}, { id: page.items[0].id })
      };
      const authoring = candidateAuthoring(page.provider_context ?? UNSPECIFIED_PROVIDER, name);
      if (authoring !== null) envelope.authoring = authoring;
    }
  }
  return envelope;
}

export function createProofDiscoverySession({ discover = discoverControlledProofIntentsOperation,
  discoverComplete = discover === discoverControlledProofIntentsOperation
    ? discoverCompleteControlledProofIntentsOperation : discover,
  maximumBytes = activeMcpInlineByteLimit(), now, capacity, onMeasured = () => {} } = {}) {

  const context = { rangeBytes: Math.min(1024, Math.max(1, Math.floor(maximumBytes / 16))) };
  const project = page => projectProofDiscoveryResponse(page, context);
  const measure = page => measureMcpInlineResultBytes(project(page));
  const descriptors = {
    candidates: { collection: 'candidates', stable_id: 'id', selectors: ['id'], fields: candidateFields },
    scope: { collection: 'scope', stable_id: 'id', selectors: ['id', 'proof_name'], fields: scopeFields }
  };
  function rowsFor(result, collection, selector) {
    const rows = result[collection];
    const selected = selector === null ? rows : rows.filter(row =>
      Object.entries(selector).every(([key, value]) => row[key] === value));
    if (selector !== null && !selected.length) throw new TaskResultSnapshotError(
      'invalid', 'selector_unknown', recovery);
    if (collection === 'scope' && new Set(selected.map(row => row.proof_name)).size !== 1)
      throw new TaskResultSnapshotError('invalid', 'scope_requires_exact_proof', recovery);
    return selected;
  }
  const registry = createTaskResultSnapshotRegistry({ maximumBytes, maximumItems: 256,
    maximumScalarRangeBytes: context.rangeBytes, ...(now ? { now } : {}),
    ...(capacity ? { capacity } : {}),
    collectionDescriptor: (requestedDomain, collection) => requestedDomain === domain ? descriptors[collection] : null,
    projectPage: ({ result, collection, selector, ordinal, maximumItems }) => {
      const rows = rowsFor(result, collection, selector);
      return { items: rows.slice(ordinal, ordinal + maximumItems), matched_count: rows.length };
    },
    projectPageContext: ({ result, collection, selector }) => {
      const rows = rowsFor(result, collection, selector);
      return { proof_name: collection === 'scope' || selector !== null ? rows[0]?.proof_name : undefined,

        ...(result.provider_context && (collection === 'scope' || selector === null)
          ? { provider_context: result.provider_context } : {}) };
    },
    projectRow: (_domain, collection, row, descriptor) => ({
      schema_version: 'task-result-row-projection.v1', stable_id: row.id, proof_name: row.proof_name,
      fields: descriptor.fields.map(field => ({ path: [field],
        value_kind: row[field] === null ? 'null' : typeof row[field] }))
    }),
    measureProjectionBytes: measure,
    assertProjectionBound: (page, bound) => {
      const bytes = measure(page);
      if (bytes > bound) throw new TaskResultSnapshotError('invalid', 'projection_exceeds_delivery_bound', recovery);
      onMeasured({ payload: project(page), bytes });
      return page;
    },
    queryOperationForDomain: () => PROOF_DISCOVERY_TOOL
  });
  return { registry, async run(args) {
    let page;
    if (Object.hasOwn(args, 'cursor')) {
      page = await registry.query({ domain, cursor: args.cursor, recovery });
    } else if (Object.hasOwn(args, 'snapshot_identity')) {
      page = await registry.query({ domain, identity: args.snapshot_identity, collection: args.collection,
        selector: args.selector ?? null, fieldPath: args.field_path ?? null,
        offset: args.offset ?? null, length: args.length ?? null, recovery });
    } else {
      const direct = Object.hasOwn(args, 'proof_name');
      const request = direct ? args : Object.hasOwn(args, 'query') ? { query: args.query } : {};

      if (Object.hasOwn(args, 'query') && !isProofIntentDiscoveryQueryWithinLimit(args.query))
        await discover(args);
      const result = !direct && Object.hasOwn(args, 'query')
        ? await discoverComplete(request) : await discover(request);
      const catalogue = direct || !Object.hasOwn(args, 'query') ? result : await discover({});
      if (JSON.stringify(catalogue.source_identity) !== JSON.stringify(result.source_identity)) {
        throw new TaskResultSnapshotError('unavailable', 'source_identity_changed', recovery);
      }
      const completeCandidates = direct ? catalogue.candidates :
        completeCatalogueCandidates(catalogue, result, Object.hasOwn(args, 'query'));
      const candidates = completeCandidates.map(candidate => ({ ...candidate, scope: {
        assertion: candidate.assertion, exclusions: candidate.exclusions, constraints: candidate.constraints,
        refinements: candidate.refinements, provenance: candidate.provenance
      } }));
      const scope = candidates.flatMap(candidate => {
        const provenance = { ...candidate.provenance, associations: candidate.associations,
          constraints: candidate.constraints, refinements: candidate.refinements,
          observations: candidate.observations, capabilities: candidate.capabilities };
        const clauses = [{ assertion: candidate.assertion },
          ...candidate.exclusions.map(exclusion => ({ exclusion: exclusion.replace(/-/gu, ' ') })),
          ...comparisonClauses(candidate)];
        return clauses.map((clause, index) => ({ id: `${candidate.id}/${index}`,
          proof_name: candidate.proof_name, clause,
          ranking: candidate.ranking, provenance }));
      });

      const context = direct ? {} : { provider_context: result.provider_context ?? UNSPECIFIED_PROVIDER };
      const identity = registry.put({ domain, result: { candidates, scope, ...context },
        sourceIdentity: catalogue.source_identity, recovery: action(request),
        resolveCurrentSourceIdentity: async () => {
          try { return (await (!direct && Object.hasOwn(request, 'query')
            ? discoverComplete(request) : discover(request))).source_identity; }
          catch (error) {

            if (error.code === 'proof_discovery_source_changed') return error.details.source_identity;
            throw error;
          }
        } });
      if (!direct) {
        const projected = completeCatalogueProjection({ candidates: completeCandidates,
          ranked: result, identity,
          queried: Object.hasOwn(args, 'query') });
        onMeasured({ payload: projected, bytes: measureMcpInlineResultBytes(projected) });
        return projected;
      }
      page = await registry.query({ domain, identity, collection: 'scope',
        selector: { proof_name: args.proof_name }, maximumItems: 256, recovery: action(request) });
    }
    return project(page);
  } };
}

const FIELD_PATH_MAX_SEGMENTS = 32;

export function registerProofDiscoveryTool({ defineTool, z, jsonContent, errorContent,
  discover = discoverControlledProofIntentsOperation,
  discoverComplete = discover === discoverControlledProofIntentsOperation
    ? discoverCompleteControlledProofIntentsOperation : discover }) {

  const nonEmpty = () => z.string().min(1);
  const fields = {
    query: nonEmpty(),
    proof_name: nonEmpty().max(256),
    cursor: nonEmpty(),
    snapshot_identity: nonEmpty(),
    collection: z.enum(['candidates', 'scope']),
    selector: z.object({ id: nonEmpty().optional(), proof_name: nonEmpty().optional() }).strict(),
    field_path: z.array(z.union([nonEmpty(), z.number().int().nonnegative()]))
      .min(1).max(FIELD_PATH_MAX_SEGMENTS),
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive()
  };
  const optional = (...names) => Object.fromEntries(names.map(name => [name, fields[name].optional()]));
  const inputSchema = z.union([
    z.object({ query: fields.query.describe(PROOF_INTENT_DISCOVERY_QUERY_POLICY.accepted_form).optional() }).strict(),
    z.object({ proof_name: fields.proof_name }).strict(),
    z.object({ cursor: fields.cursor }).strict(),
    z.object({ snapshot_identity: fields.snapshot_identity, collection: fields.collection,
      ...optional('selector', 'field_path', 'offset', 'length') }).strict()
  ]);
  const advertisedInputSchema = z.object(optional(...Object.keys(fields))).strict();

  const allowedFieldSets = inputSchema.options.map(option => Object.keys(option.shape));
  const session = createProofDiscoverySession({ discover, discoverComplete });
  defineTool(PROOF_DISCOVERY_TOOL, {
    description: 'Return the complete admitted proof catalogue in one response, optionally ranking query matches first, or inspect a known proof_name. Catalogue rows include exact identity, assertion, exclusions, applicability and capability facts; shared facts occur once. Query terms never hide proofs. Targeted detail may use emitted snapshot-bound operations. ' +
      `Query limit: ${PROOF_INTENT_DISCOVERY_QUERY_POLICY.maximum_bytes} UTF-8 bytes. ` +
      'Discovery is read-only; it does not select, map, construct or execute proofs.',
    inputSchema,
    advertisedInputSchema,
    inputValidationErrorProjector: ({ validationError }) => ({ terminal_result: errorContent(
      createToolInputValidationError({ tool: PROOF_DISCOVERY_TOOL, validationError,
        details: { allowed_field_sets: allowedFieldSets } })) })
  }, async args => {
    try {
      const parsed = inputSchema.parse(args);
      const payload = await session.run(parsed);
      return Object.hasOwn(parsed, 'proof_name') || Object.hasOwn(parsed, 'cursor') ||
        Object.hasOwn(parsed, 'snapshot_identity') ? jsonContent(payload) : completeInlineJsonContent(payload);
    } catch (error) { return errorContent(createControlledContractRefusal(error)); }
  }, { losslessDelivery: true });
}
