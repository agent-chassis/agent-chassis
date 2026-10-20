import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { createTaskResultSnapshotRegistry, TaskResultSnapshotError } from '@agent-chassis/controlled-contract';
import { discoverCompleteControlledProofIntentsOperation,
  discoverControlledProofIntentsOperation } from '@agent-chassis/wiki-core';
import { createControlledContractRefusal } from '@agent-chassis/wiki-core/src/operations/controlled-contract/refusal.mjs';
import { buildGuidanceCall } from '@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs';
import { CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE,
  ControlledContractToolError } from '@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs';
import { PROOF_INTENT_DISCOVERY_CATALOG, PROOF_INTENT_DISCOVERY_QUERY_POLICY, isProofIntentDiscoveryQueryWithinLimit, proofVerificationCapability, readProofDiscoverySourceIdentity } from '@agent-chassis/controlled-contract/proof-intent-discovery';
import { FIND_PROOFS_TASK, PROOF_NAME_INPUT_SCHEMA } from '@agent-chassis/controlled-contract/proof-discovery-task';
import { loadExactAdmittedProofPackMeaning } from '@agent-chassis/controlled-contract/proof-packs';
import { describePackParameters, loadPackParameterContract } from '@agent-chassis/controlled-contract/pack-parameters';
import nativeContractSchema from '@agent-chassis/controlled-contract/schema/controlled-acceptance-contract.v1.schema.json' with { type: 'json' };
import testProofSchema from '@agent-chassis/controlled-contract/schema/controlled-acceptance-test-proof-definitions.v1.schema.json' with { type: 'json' };
import { recordAuthoringChangeSchema } from '@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs';
import { WIKI_MCP_ASSIGNED_UNIT_ENV_VAR, WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR, WIKI_MCP_COMMIT_RUN_ID_ENV_VAR,
  WIKI_MCP_TOOL_PROFILE_ENV_VAR } from './launcher-run-credential.mjs';
import { registeredToolRequestContracts } from './registered-tool-request-contracts.mjs';
import { caseFamilyGuidanceCall } from './requirement-authoring-job-guidance.mjs';
import { measureMcpInlineResultBytes } from './mcp-response.mjs';
import { authoringSchemaMembers, familyAuthoringFacts, familyChoiceFacts, projectIndex, projectIndexSummary, projectProof,
  projectProofSummary, proofDiscoveryAlternatives } from './proof-discovery-response.mjs';
import { createToolInputValidationError } from './register-tool.mjs';
import { readSelectedResponseProjection, retainSelectedResponseSource, scalarRangeBytesWithinDeliveryBound,
  selectedResponseCorrectableError, selectedResponseDeliveryBound, selectedResponseDetailSchema,
  selectedResponseQueryInvalidError, selectedResponseRequestSchema } from './selected-response-snapshot.mjs';

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
      ? { missing_selection: 'provider identity, selector form and falsification fields are ' +
          'per family: name one listed family, or read every family through case_authoring' }
      : { family_id: identified, family_facts: 'next_calls.case_authoring returns this ' +
          'family\'s provider identity, selector form and falsification facts' }),

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

  resolveCurrentSourceIdentity,

  verificationCapability = proofVerificationCapability,
  maximumBytes = selectedResponseDeliveryBound(), now, capacity, onMeasured = () => {} } = {}) {

  const packagedOwner = discover === discoverControlledProofIntentsOperation &&
    discoverComplete === discoverCompleteControlledProofIntentsOperation;
  if (resolveCurrentSourceIdentity === undefined && !packagedOwner) throw new TypeError(
    'proof discovery session: an injected discover or discoverComplete requires its own resolveCurrentSourceIdentity');
  const currentSourceIdentity = resolveCurrentSourceIdentity ?? readProofDiscoverySourceIdentity;
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
          ...candidate.exclusions.map(exclusion => ({ exclusion })),
          ...comparisonClauses(candidate)];
        return clauses.map((clause, index) => ({ id: `${candidate.id}/${index}`,
          proof_name: candidate.proof_name, clause,
          ranking: candidate.ranking, provenance }));
      });

      const context = direct ? {} : { provider_context: result.provider_context ?? UNSPECIFIED_PROVIDER,
        query: result.query ?? null, catalogue_total: result.candidate_count };
      const identity = registry.put({ domain, result: { candidates, scope, ...context },
        sourceIdentity: result.source_identity, recovery: action(request),

        resolveCurrentSourceIdentity: async () => currentSourceIdentity() });
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
    ? discoverCompleteControlledProofIntentsOperation : discover,
  resolveCurrentSourceIdentity }) {

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
  const session = createProofDiscoverySession({ discover, discoverComplete, resolveCurrentSourceIdentity });
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

const SOURCE_CHANGED_FACTS = Object.freeze({
  subject: 'the proof definitions this server process loaded',
  effects: 'none: nothing was retained and no canonical source was written',
  uncertainty: 'whether the files present now form one coherent built generation',
  capable_actor: 'operator',
  supported_action: 'restart the MCP server so the package loads one generation',
  missing_capability: 'in-process refresh: the package records no identity of its loaded ' +
    'implementation, validators or vocabulary, so a coherent data-only change cannot be told ' +
    'from a change of loaded code'
});

export function createFindProofsInputContract(z) {
  const nonEmpty = () => z.string().min(1);
  const proofName = meaning => z.string().min(PROOF_NAME_INPUT_SCHEMA.minLength).describe(meaning);
  const part = z.union([
    z.object({ kind: z.literal('overview') }).strict(),
    z.object({ kind: z.literal('comparisons') }).strict(),
    z.object({ kind: z.literal('authoring') }).strict(),
    z.object({ kind: z.literal('parameter'), name: nonEmpty() }).strict(),
    z.object({ kind: z.literal('constraint'), ref: nonEmpty() }).strict()
  ]).describe('Fresh read: one semantic part of proof_name; omitted, the overview. ' +
    'For a returned result use selection.part.');
  const fields = {

    query: nonEmpty().max(PROOF_INTENT_DISCOVERY_QUERY_POLICY.maximum_bytes)
      .describe(PROOF_INTENT_DISCOVERY_QUERY_POLICY.accepted_form),
    target_family: nonEmpty().describe('One listed test family id; selects authoring context only. ' +
      'Fresh proof_name or query request only, never beside result or selection.'),
    proof_name: proofName('Fresh read of the CURRENT catalogue: an exact proof catalog entry name.'),
    part,
    result: selectedResponseDetailSchema(z).shape.source
      .describe('An original result returned by this task, passed back unchanged. Valid alone.'),

    selection: z.object({
      proof_name: proofName('A proof listed in the result beside this selection.').optional(),
      part: part.describe('One semantic part of the selected proof; omitted, the overview.').optional()
    }).strict().describe('Reads within a returned original: requires result beside it. ' +
      'Takes no top-level proof_name, part, query or target_family.')
  };
  const inputSchema = z.union([

    z.object({}).strict(),
    z.object({ query: fields.query, target_family: fields.target_family.optional() }).strict(),
    z.object({ proof_name: fields.proof_name, target_family: fields.target_family.optional(),
      part: fields.part.optional() }).strict(),
    z.object({ result: fields.result, selection: fields.selection.optional() }).strict()
  ]);
  const advertisedInputSchema = z.object(Object.fromEntries(Object.entries(fields)
    .map(([name, field]) => [name, field.optional()]))).strict();
  const allowedFieldSets = inputSchema.options.map(option => Object.keys(option.shape));

  const fieldNames = Object.keys(fields);
  const requires = (option, name) => {
    const permitted = Object.keys(option.shape);
    const required = permitted.filter(field => field !== name && !option.shape[field].isOptional());
    const forbidden = fieldNames.filter(field => !permitted.includes(field));
    return { ...(required.length ? { required } : {}),
      ...(forbidden.length ? { not: { anyOf: forbidden.map(field => ({ required: [field] })) } } : {}) };
  };
  const dependencies = Object.fromEntries(fieldNames.map(name => {
    const permitting = inputSchema.options.filter(option => Object.hasOwn(option.shape, name))
      .map(option => requires(option, name));
    return [name, permitting.length === 1 ? permitting[0] : { anyOf: permitting }];
  }));
  const publishedInputSchemaProjection = converted => ({ ...converted, dependencies });
  return Object.freeze({ inputSchema, advertisedInputSchema, allowedFieldSets, publishedInputSchemaProjection,

    retainedSelectionSchema: inputSchema.options.find(option => Object.hasOwn(option.shape, 'selection')) });
}

export function createFindProofsSession({ workspace, z, sessionEnv = process.env, responseEnv = process.env, requestContracts = null,
  discover = discoverControlledProofIntentsOperation,
  discoverComplete = discover === discoverControlledProofIntentsOperation
    ? discoverCompleteControlledProofIntentsOperation : discover,
  resolveCurrentSourceIdentity,
  verificationCapability = proofVerificationCapability,

  authoringChangeSchema = () => recordAuthoringChangeSchema('work_item', 'existing'),
  caseAuthoring = () => upsertGuidance.case_authoring,
  onMeasured = () => {} }) {
  if (typeof workspace?.repo !== 'string' || workspace.repo.length === 0) throw new TypeError(
    'find_proofs session: the trusted workspace repository is required');
  const packagedOwner = discover === discoverControlledProofIntentsOperation &&
    discoverComplete === discoverCompleteControlledProofIntentsOperation;
  if (resolveCurrentSourceIdentity === undefined && !packagedOwner) throw new TypeError(
    'find_proofs session: an injected discover or discoverComplete requires its own resolveCurrentSourceIdentity');
  const currentSourceIdentity = resolveCurrentSourceIdentity ?? readProofDiscoverySourceIdentity;
  const contract = createFindProofsInputContract(z);

  const requestSchema = { ...selectedResponseRequestSchema(contract.advertisedInputSchema),
    ...selectedResponseRequestSchema(contract.inputSchema) };
  const bound = selectedResponseDeliveryBound(responseEnv);
  const fits = payload => measureMcpInlineResultBytes(payload) <= bound;
  const invalid = (reason, details) => selectedResponseQueryInvalidError(FIND_PROOFS_TASK, reason, details);
  const correctable = (reason, details, args, prerequisite, successCondition) =>
    selectedResponseCorrectableError(FIND_PROOFS_TASK, reason, details,
      { arguments: args, requestSchema, prerequisite, successCondition });

  const sessionFact = name => typeof sessionEnv?.[name] === 'string' && sessionEnv[name].trim().length > 0
    ? sessionEnv[name].trim() : null;
  const authorityIdentity = () => ({ role: sessionFact(WIKI_MCP_TOOL_PROFILE_ENV_VAR),
    assigned_unit: sessionFact(WIKI_MCP_ASSIGNED_UNIT_ENV_VAR),
    launch_ref: sessionFact(WIKI_MCP_COMMIT_LAUNCH_REF_ENV_VAR),
    run_id: sessionFact(WIKI_MCP_COMMIT_RUN_ID_ENV_VAR) });
  const expectedBinding = () => ({ route: FIND_PROOFS_TASK, repository: workspace.repo, unit: null,
    authority_identity: authorityIdentity() });

  const observedSources = discovery => {
    const sources = { discovery, authoring_schema: digestOf(authoringChangeSchema()),
      family_facts: digestOf(caseAuthoring()), parameter_value_schema: digestOf([
        nativeContractSchema.$defs.reference.properties.identity, testProofSchema.$defs.test_selector]) };
    return { identity: digestOf(sources), ...sources };
  };

  function selectedFamily(request, recognition, authoring) {
    const explicit = request.target_family ?? null;
    if (explicit !== null && !Object.hasOwn(authoring.families, explicit)) {
      const { target_family: _family, ...withoutFamily } = request;
      throw correctable('target_family_unknown',
        { target_family: explicit, listed_families: Object.keys(authoring.families) }, withoutFamily,
        'target_family is one listed family id',
        'the call repeats the preserved query or proof request without the invalid target_family; ' +
          'query recognition may still select a listed family; it does not select the requested invalid family');
    }
    const family = explicit ?? (recognition.status === 'identified' ? recognition.families[0] : null);
    return family === null ? null : familyAuthoringFacts(authoring, family);
  }

  async function capture(request) {
    const queried = Object.hasOwn(request, 'query');

    const browsing = !queried && !Object.hasOwn(request, 'proof_name');
    if (queried && !isProofIntentDiscoveryQueryWithinLimit(request.query)) {
      throw invalid('query_exceeds_byte_limit', { field: 'query',
        measurement: PROOF_INTENT_DISCOVERY_QUERY_POLICY.measurement,
        byte_length: Buffer.byteLength(request.query, 'utf8'),
        maximum_bytes: PROOF_INTENT_DISCOVERY_QUERY_POLICY.maximum_bytes,
        caller_action: 'send the property in fewer bytes; no shorter query is invented for the caller' });
    }
    const authoring = caseAuthoring();
    let result;
    try {
      result = queried ? await discoverComplete({ query: request.query })
        : await discover(browsing ? {} : { proof_name: request.proof_name });
    } catch (error) { throw discoveryRefusal(error, request); }
    const recognition = result.provider_context ?? UNSPECIFIED_PROVIDER;
    const family = selectedFamily(request, recognition, authoring);

    const parameterDescriptions = new Map();
    const parametersFor = async candidate => {
      const provenance = candidate.provenance;
      const key = digestOf(provenance);
      if (!parameterDescriptions.has(key)) {
        const pack = await loadExactAdmittedProofPackMeaning({ profileId: provenance.profile_id,
          profileVersion: provenance.profile_version });
        for (const field of ['profile_digest', 'admission_digest', 'parameter_contract_digest']) {
          if (pack[field] !== provenance[field]) throw Object.assign(
            new Error('proof parameter definition differs from the discovery answer'),
            { code: 'proof_discovery_source_changed', details: { field, changed: false } });
        }
        parameterDescriptions.set(key, describePackParameters(loadPackParameterContract(pack)));
      }
      const description = parameterDescriptions.get(key);
      return candidate.refinements.map(refinement => {
        const parameter = description.parameters.find(entry => entry.name === refinement.name);
        if (parameter === undefined) throw new TypeError(`discovery parameter has no owner: ${refinement.name}`);

        const identity = nativeContractSchema.$defs.reference.properties.identity;
        return { ...refinement, value_kind: parameter.value_kind, source: parameter.source,
          value_schema: parameter.value_kind === 'test_assertion_selector' ? testProofSchema.$defs.test_selector
            : { anyOf: [identity, { type: 'array', items: identity }] } };
      });
    };
    const parameters = [];
    const candidates = [];
    const unavailable = structuredClone(result.availability?.definitions ?? []);
    for (const candidate of result.candidates) {
      try {
        const values = await parametersFor(candidate);
        parameters.push(values);
        candidates.push(candidate);
      }
      catch (error) {
        const failure = discoveryRefusal(error, request);
        failure.details = { ...failure.details,
          subject: failure.details?.subject ?? { proof_name: candidate.proof_name,
            proof_version: candidate.profile_version },
          effects: failure.details?.effects ?? 'none: no result retained and no canonical source written',
          ...(failure.details?.stopping_condition || failure.details?.supported_action ? {} : {
            stopping_condition: 'The required parameter definition cannot be supplied. This acquisition returns no ' +
              'proof choices; discovery has no call to repair the definition. Do not treat this failure as no matches.'
          }) };
        if (!browsing && !queried || error.code === 'proof_discovery_source_changed') {
          throw createControlledContractRefusal(failure, { operation: FIND_PROOFS_TASK,
            stage: 'parameter_definition' });
        }
        unavailable.push({ proof_name: candidate.proof_name, proof_version: candidate.profile_version,
          failures: [{ code: error.code ?? null, message: error.message,
            details: error.details ?? {} }] });
      }
    }
    const availableCount = result.candidate_count - (unavailable.length - (result.availability?.unavailable ?? 0));
    if (unavailable.length > 0 && availableCount === 0) throw new ControlledContractToolError(
      'proof_discovery_definitions_unavailable', 'No definition in this proof catalogue is available.',
      { availability: { status: 'unavailable', definitions: unavailable },
        effects: 'none: no result retained and no canonical source written',
        stopping_condition: 'No proof can be selected; discovery has no call that restores these definitions.' });
    const carrier = {
      request, mode: queried ? 'search' : browsing ? 'browse' : 'detail', query: result.query ?? null,
      population: queried ? { matches: candidates.length, catalogue: result.candidate_count +
        (result.availability?.unavailable ?? 0) }
        : browsing ? { catalogue: candidates.length + unavailable.length } : { matches: 1 },
      ...((browsing || queried) && unavailable.length > 0 ? { availability: { status: 'partial',
        available: availableCount, unavailable: unavailable.length, definitions: unavailable } } : {}),
      ...(unavailable.length > 0 ? { unavailable_definitions: unavailable } : {}),
      recognition, family,

      ...(family === null ? { family_choices: familyChoiceFacts(authoring) } : {}),
      authoring_members: authoringSchemaMembers(authoringChangeSchema()),

      case_choices: { identity: authoring.case_identity,
        association: authoring.verification_association.authoring },
      source: observedSources(result.source_identity.discovery),
      proofs: candidates.map((candidate, index) => ({
        proof_name: candidate.proof_name, profile_version: candidate.profile_version,
        ...(queried ? { match_kind: candidate.ranking.match_kind } : {}),
        short_description: candidate.short_description, usage: candidate.usage,
        assertion: candidate.assertion, exclusions: candidate.exclusions,
        constraints: candidate.constraints, refinements: parameters[index],
        observations: candidate.observations, capabilities: candidate.capabilities,
        provenance: candidate.provenance,

        comparisons: comparisonClauses(candidate).map(({ comparison }) => ({
          explanation: comparison.explanation,
          alternatives: intentsById.get(comparison.from_intent_id).capable_packs
            .filter(pack => pack.profile_id !== candidate.proof_name).map(pack => ({
            name: pack.profile_id, version: pack.profile_version
          }))
        })).filter(comparison => comparison.alternatives.length > 0),
        verification_capability: verificationCapability(candidate.proof_name)
      }))
    };

    let after;
    try { after = observedSources((await currentSourceIdentity()).discovery); }
    catch (error) { throw discoveryRefusal(error, request); }
    if (!isDeepStrictEqual(after, carrier.source)) {
      throw discoveryRefusal(Object.assign(new Error('proof definitions moved while the answer was composed'),
        { code: 'proof_discovery_source_changed', details: { changed: false } }), request);
    }
    const { part: _part, ...queryIdentity } = request;
    const locator = retainSelectedResponseSource({ carrier,
      binding: { ...expectedBinding(), query_identity: queryIdentity, observation_identity: carrier.source },
      ownerCall: source => ({ tool: FIND_PROOFS_TASK, arguments: { result: source } }), ownerRequestSchema: requestSchema },
    { env: responseEnv });
    return { carrier, locator, currentness: 'current' };
  }

  function discoveryRefusal(error, request) {
    const code = error?.code;
    const details = { ...(error?.details ?? {}) };
    if (code === 'proof_discovery_identity_unknown') Object.assign(details, {
      subject: request.proof_name, effects: 'none', capable_actor: 'caller',
      recovery: { meaning: 'No proof has this exact name. Browse, supply the property to search, or correct the name; no proof is substituted.',
        next_calls: proofDiscoveryAlternatives(request) } });
    else if (code === 'proof_discovery_source_changed') {

      delete details.source_identity;
      delete details.changed;
      Object.assign(details, SOURCE_CHANGED_FACTS);
    }
    else if (['proof_intent_metadata_missing', 'proof_intent_metadata_unreadable'].includes(code)) {
      delete details.rebuild_command;
      Object.assign(details, { subject: details.path,
        effects: 'none: no result retained and no canonical source written',
        stopping_condition: 'The catalogue metadata cannot be read. Discovery has no call that restores it; ' +
          'this is unavailable evidence, not an empty catalogue or a negative search result.' });
    }
    else if (['proof_pack_exact_version_unavailable', 'proof_pack_exact_version_not_current'].includes(code)) {
      const exact = code === 'proof_pack_exact_version_not_current' ? details.requested : details;
      Object.assign(details, {
        subject: { proof_name: exact.profile_id, proof_version: exact.profile_version },
        effects: 'none: no result retained and no canonical source written',
        stopping_condition: 'This acquisition cannot supply the required exact definition. Stop conclusions that depend on it; ' +
          'discovery has no call that restores unavailable or retired definitions, and another definition is not a substitute.'
      });
    }
    else return error;
    return new ControlledContractToolError(code, error.message, details);
  }

  async function currentnessOf(binding) {
    try {
      return isDeepStrictEqual(observedSources((await currentSourceIdentity()).discovery),
        binding.observation_identity) ? 'current' : 'changed';
    } catch (error) {
      if (['proof_intent_metadata_missing', 'proof_intent_metadata_unreadable'].includes(error.code)) {
        return { status: 'unavailable', failure: { code: error.code, subject: error.details.path,
          cause: error.details.cause,
          stopping_condition: 'The retained meaning remains readable, but its currentness is unknown. ' +
            'Discovery has no call that restores the unreadable catalogue metadata.' } };
      }
      return { status: 'unavailable', failure: { code: error.code ?? null,
        message: error.message, details: error.details ?? null } };
    }
  }

  const selected = (locator, selection) => readSelectedResponseProjection(locator, { env: responseEnv,
    expected: expectedBinding(), project: async ({ binding, carrier }) =>
      answer({ carrier, locator, currentness: await currentnessOf(binding) }, selection, () => true) });

  async function answer({ carrier, locator, currentness }, selection, admits) {
    const indexCall = { result: locator };
    const named = selection.proof_name ?? null;
    const unavailable = carrier.availability?.definitions.find(entry => entry.proof_name === named);
    if (unavailable !== undefined) throw new ControlledContractToolError('proof_discovery_definition_unavailable',
      'The selected definition was unavailable in this original result.', {
        subject: { proof_name: unavailable.proof_name, proof_version: unavailable.proof_version },
        failures: unavailable.failures, effects: 'none: no selection, execution or canonical write',
        stopping_condition: 'This result has no admitted meaning for the failed definition; choose an available proof explicitly or stop.',
        recovery: { next_calls: { index: { tool: FIND_PROOFS_TASK, arguments: indexCall } } }
      });
    if (named === null && carrier.mode !== 'detail') {
      if (selection.part !== undefined) throw correctable('part_requires_proof_name',
        { part: selection.part, population: carrier.population }, indexCall,
        'a part is selected within one proof of this result: name selection.proof_name',
        `the call returns this result's complete ${carrier.mode === 'search' ? 'match index' : 'catalogue'}; ` +
          'it does not return the requested part');
      return projectIndex(carrier, locator, currentness);
    }
    const proof = named === null ? carrier.proofs[0] : carrier.proofs.find(entry => entry.proof_name === named);
    if (proof === undefined) throw correctable('proof_name_not_in_result',
      { proof_name: named, population: carrier.population }, indexCall,
      'selection.proof_name is a proof of this original result; another proof is a fresh proof_name request',
      'the call returns this original result without the selection; it does not return the requested proof');
    const part = selection.part ?? null;

    const offered = proof.verification_capability !== null && carrier.family !== null
      ? caseFamilyGuidanceCall(carrier.family.family_id) : null;
    const reader = requestContracts?.contractFor('workspace_read_wiki') ?? null;
    const caseGuidance = offered !== null && reader !== null && await reader.acceptsArguments(offered.arguments)
      ? offered : null;
    const projected = projectProof(carrier, locator, currentness, proof, part, admits, caseGuidance);
    if (projected.unknown) {
      const { reason, ...subject } = projected.unknown;
      throw correctable(reason, { proof_name: proof.proof_name, ...subject },
        { result: locator, selection: { proof_name: proof.proof_name, part: { kind: 'overview' } } },
        'the part names a parameter or constraint the selected proof lists',
        'the call returns the same proof\'s overview with valid parameter names and unattached constraint refs; ' +
          'use its authoring and parameter selections for attached refs; it does not return the requested part');
    }
    return projected.payload;
  }

  async function compact(captured) {
    const { carrier, locator, currentness } = captured;
    const complete = await answer(captured, {}, fits);
    if (fits(complete)) return complete;
    return carrier.mode === 'detail' ? projectProofSummary(carrier, locator, currentness, carrier.proofs[0])
      : projectIndexSummary(carrier, locator, currentness);
  }

  return { contract, requestSchema, bound, async run(args) {
    if (Object.hasOwn(args, 'result')) {
      return { selected: await selected({ ref_id: args.result.ref_id },
        args.selection ?? {}) };
    }
    const captured = await capture(args);

    if (args.part !== undefined) return { selected: await selected(captured.locator, { part: args.part }) };
    const payload = await compact(captured);
    const bytes = measureMcpInlineResultBytes(payload);
    if (bytes > bound) throw invalid('summary_exceeds_delivery_bound', { measured_bytes: bytes,
      bound_bytes: bound, metric: 'larger MCP representation', result: captured.locator,
      effects: 'the original result is retained complete; nothing was truncated' });
    onMeasured({ payload, bytes });
    return { payload };
  } };
}

const digestOf = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function registerFindProofsTool({ defineTool, z, jsonContent, errorContent, workspace, sessionEnv,
  responseEnv, ...owners }) {
  const session = createFindProofsSession({ workspace, z, sessionEnv, responseEnv,
    requestContracts: registeredToolRequestContracts(defineTool), ...owners });
  const { inputSchema, advertisedInputSchema, allowedFieldSets, publishedInputSchemaProjection,
    retainedSelectionSchema } = session.contract;

  const retainedRequestRefusal = args => {
    if (args === null || typeof args !== 'object' || Array.isArray(args) ||
        !(Object.hasOwn(args, 'selection') || Object.hasOwn(args, 'result'))) return null;
    const parsed = retainedSelectionSchema.safeParse(args);
    if (parsed.success) return null;
    if (Object.hasOwn(args, 'result')) return createToolInputValidationError({ tool: FIND_PROOFS_TASK,
      validationError: parsed.error, details: { allowed_field_sets: allowedFieldSets } });
    const { issues } = parsed.error;
    const current = issues.length === 1 && args.selection.proof_name !== undefined
      ? { proof_name: args.selection.proof_name,
        ...(args.selection.part === undefined ? {} : { part: args.selection.part }) } : null;
    return createToolInputValidationError({ tool: FIND_PROOFS_TASK,
      validationError: { message: `selection requires a result returned by ${FIND_PROOFS_TASK}.`, issues },
      details: { allowed_field_sets: allowedFieldSets, missing_input: 'result',
        correction: 'A selection reads within one original result: pass the result a ' +
          `${FIND_PROOFS_TASK} call returned, unchanged, beside the selection. No result is invented.` },
      nextCalls: current !== null && inputSchema.safeParse(current).success ? [buildGuidanceCall({
        tool: FIND_PROOFS_TASK, arguments: current,
        information: 'Reads the CURRENT catalogue entry for this proof_name instead. It is a different ' +
          'request: not the retained original the refused selection needs, and no substitute for it.' },
      { requestSchema: session.requestSchema, registeredTools: [FIND_PROOFS_TASK] })] : [] });
  };
  defineTool(FIND_PROOFS_TASK, {
    description: 'Browse with no arguments; use a held name or property query directly. Never mix request forms. ' +
      'Fresh read of the CURRENT catalogue: {proof_name, part?, target_family?}, or {query, target_family?} ' +
      'to search by the property to establish. ' +
      'Read from a returned original: {result, selection?: {proof_name?, part?}}. ' +
      'selection requires the returned result beside it; result alone is valid. Top-level proof_name and ' +
      'part belong to a fresh read. target_family belongs to a fresh proof_name or query request, never ' +
      'to a selection. ' +
      'Search returns lexical candidates, never selections. Proof reads return admitted assertions, exclusions and fit limits; ' +
      'authoring and comparisons are optional. ' +
      `Query limit: ${PROOF_INTENT_DISCOVERY_QUERY_POLICY.maximum_bytes} UTF-8 bytes. ` +
      'Reads only; executes and credits nothing.',
    inputSchema,
    advertisedInputSchema,
    publishedInputSchemaProjection,
    inputValidationErrorProjector: ({ args, validationError }) => ({ terminal_result: errorContent(
      retainedRequestRefusal(args) ?? createToolInputValidationError({ tool: FIND_PROOFS_TASK, validationError,
        details: { allowed_field_sets: allowedFieldSets } })) })
  }, async args => {
    try {
      const { selected, payload } = await session.run(inputSchema.parse(args));

      return selected ?? jsonContent(payload);
    } catch (error) {
      return errorContent(error?.envelope ? error : createControlledContractRefusal(error,
        { operation: FIND_PROOFS_TASK, stage: Object.hasOwn(args, 'result') ? 'retained_read' : 'acquisition' }));
    }
  }, { losslessDelivery: true });
  return session;
}
