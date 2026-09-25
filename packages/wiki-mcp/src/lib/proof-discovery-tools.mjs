import { createTaskResultSnapshotRegistry, TaskResultSnapshotError } from '@agent-chassis/controlled-contract';
import { discoverCompleteControlledProofIntentsOperation,
  discoverControlledProofIntentsOperation } from '@agent-chassis/wiki-core';
import { createControlledContractRefusal } from '@agent-chassis/wiki-core/src/operations/controlled-contract/refusal.mjs';
import { CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE } from '@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs';
import { PROOF_INTENT_DISCOVERY_CATALOG, PROOF_INTENT_DISCOVERY_QUERY_POLICY, isProofIntentDiscoveryQueryWithinLimit, proofVerificationCapability } from '@agent-chassis/controlled-contract/proof-intent-discovery';
import { measureMcpInlineResultBytes } from './mcp-response.mjs';
import { createToolInputValidationError } from './register-tool.mjs';
import { scalarRangeBytesWithinDeliveryBound, selectedResponseDeliveryBound } from './selected-response-snapshot.mjs';

export const PROOF_DISCOVERY_TOOL = 'workspace_controlled_proof_intents_discover';
const domain = 'proof_discovery';
const action = args => ({ tool: PROOF_DISCOVERY_TOOL, arguments: args });
const recovery = action({});
const candidateFields = ['proof_name', 'associations', 'essential_limitation', 'scope'];
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
      : { family_id: identified, family_facts: 'next_calls.case_authoring returns this ' +
          'family\'s provider identity, node_id form and falsification facts' }),

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

const CANDIDATE_ROW_MEANING = 'Lexical candidates, not selections, ordered by match_kind tier, ' +
  'then relevance: no later row has a higher tier. match_kind: ' +
  'assertion_match (all property terms in assertion, constraint or definition text), ' +
  'partial_assertion_match (some), navigation_or_exclusion_match (none). essential_limitation: ' +
  'the exclusion the query words touch, else null; null is not "no exclusions". A row\'s ' +
  'detail_action returns its complete assertion, exclusions and intent comparisons.';

function authoringContext(provider, page, capabilityOf) {
  const testExecution = page.items.some(item => capabilityOf(item.proof_name) !== null);
  return {

    population: page.query === null ? { catalogue: page.total }
      : { query_matches: page.total, catalogue: page.catalogue_total },
    scope: page.total === 0 ? 'No lexical match; no proof is ruled out.'
      : page.remaining > 0 ? `${page.remaining} unread may apply.`
        : page.query === null ? 'Every listed proof.' : 'All lexical matches; no proof is ruled out.',
    row_meaning: CANDIDATE_ROW_MEANING,
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

function candidateAuthoring(provider, proofName, capabilityOf) {
  const capability = capabilityOf(proofName);
  if (capability === null) return null;
  const identified = provider.status === 'identified' ? provider.families[0] : null;
  const family = identified === null ? null : upsertGuidance.case_authoring.families[identified];
  const caseAuthoring = upsertGuidance.authority.case_authoring;
  return {
    verification_capability: capability,
    meaning: 'observed through its authored selected test; mutation the provider can apply is ' +
      'additional falsification evidence for that same proof, and unavailable mutation is a capability ' +
      'limitation that neither earns nor withholds credit. Author the required case.target and case.falsification through ' +
      'case_authoring; discovery establishes neither applicability nor an executable target',
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

export function projectProofDiscoveryResponse(page, { rangeBytes,
  verificationCapability: capabilityOf = proofVerificationCapability }) {
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

  const firstDetailAuthoring = () => page.collection === 'scope' && page.offset === 0
    ? candidateAuthoring(page.provider_context ?? UNSPECIFIED_PROVIDER, name, capabilityOf) : null;
  const inventory = page.items.find(item => item.schema_version === 'task-result-row-projection.v1');
  if (inventory) {
    const authoring = firstDetailAuthoring();
    return { proof_name: inventory.proof_name, complete: false,
      fields: fields(inventory.fields, { id: inventory.stable_id }),
      total: page.total, returned: page.returned, remaining: page.remaining, continuation: next,
      ...(authoring === null ? {} : { authoring }) };
  }
  const envelope = { results: page.collection === 'candidates' ? page.items.map(item => ({

    proof_name: item.proof_name, intent_ids: item.associations,

    ...(item.ranking.match_kind === 'catalog_entry' ? {} : { match_kind: item.ranking.match_kind }),
    essential_limitation: item.essential_limitation,

    ...(capabilityOf(item.proof_name) === null ? {}
      : { verification_capability: capabilityOf(item.proof_name) }),
    detail_action: action({ snapshot_identity: page.task_result_identity,
      collection: 'scope', selector: { proof_name: item.proof_name } })
  })) : page.items.map(item => item.clause),
  total: page.total, returned: page.returned, remaining: page.remaining, continuation: next };
  if (page.collection === 'candidates' && page.offset === 0 && page.provider_context) {
    envelope.authoring = authoringContext(page.provider_context, page, capabilityOf);
  }
  if (page.collection === 'scope') {
    envelope.proof_name = name;
    if (page.offset === 0 && page.items.length) {
      envelope.detail_actions = {
        ranking: inspectAction(page, ['ranking'], {}, { id: page.items[0].id }),
        provenance: inspectAction(page, ['provenance'], {}, { id: page.items[0].id })
      };
      const authoring = firstDetailAuthoring();
      if (authoring !== null) envelope.authoring = authoring;
    }
  }
  return envelope;
}

export function createProofDiscoverySession({ discover = discoverControlledProofIntentsOperation,
  discoverComplete = discover === discoverControlledProofIntentsOperation
    ? discoverCompleteControlledProofIntentsOperation : discover,

  verificationCapability = proofVerificationCapability,
  maximumBytes = selectedResponseDeliveryBound(), now, capacity, onMeasured = () => {} } = {}) {

  const context = { rangeBytes: scalarRangeBytesWithinDeliveryBound(maximumBytes), verificationCapability };
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
          ? { provider_context: result.provider_context } : {}),
        ...(collection === 'candidates' && selector === null
          ? { query: result.query, catalogue_total: result.catalogue_total } : {}) };
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
      const queried = Object.hasOwn(args, 'query');
      const request = direct ? args : queried ? { query: args.query } : {};

      if (queried && !isProofIntentDiscoveryQueryWithinLimit(args.query)) await discover(args);
      const search = () => queried ? discoverComplete(request) : discover(request);
      const result = await search();
      const candidates = result.candidates.map(candidate => ({ ...candidate, scope: {
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

      const context = direct ? {} : { provider_context: result.provider_context ?? UNSPECIFIED_PROVIDER,
        query: result.query ?? null, catalogue_total: result.candidate_count };
      const identity = registry.put({ domain, result: { candidates, scope, ...context },
        sourceIdentity: result.source_identity, recovery: action(request),
        resolveCurrentSourceIdentity: async () => {
          try { return (await search()).source_identity; }
          catch (error) {

            if (error.code === 'proof_discovery_source_changed') return error.details.source_identity;
            throw error;
          }
        } });
      page = await registry.query({ domain, identity, collection: direct ? 'scope' : 'candidates',
        selector: direct ? { proof_name: args.proof_name } : null, maximumItems: 256,
        recovery: action(request) });
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
    description: 'Find proof candidates by the property to establish, browse compactly with no query, or inspect a known proof_name. Ranked bounded pages give compact rows (identity, match kind, relevant limitation, capability, detail_action); a query adds no unmatched proof and continuation reaches every match. A candidate\'s detail holds its complete assertion and exclusions. ' +
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
      return jsonContent(await session.run(parsed));
    } catch (error) { return errorContent(createControlledContractRefusal(error)); }
  }, { losslessDelivery: true });
}
