import { CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_TOOL_DEFINITIONS,
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE,
  CONTROLLED_CONTRACT_REQUIREMENT_REQUEST_GUIDANCE_LOCATIONS } from
  '@agent-chassis/wiki-core/src/lib/controlled-contract-tools.mjs';
import { upsertControlledContractObligationCoverageOperation,
  removeControlledContractObligationCoverageOperation, queryControlledContractObligationCoverageOperation,
  validateProofOperation } from
  '@agent-chassis/wiki-core/src/operations/controlled-contract.mjs';
import { CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_DECLARED_INPUT_SCHEMA } from
  '@agent-chassis/wiki-core/src/operations/controlled-contract/contract-requirement-input-schema.mjs';
import { MCP_WRITE_SEMANTICS } from './register-tool.mjs';
import { INPUT_CONTRACT_SCHEMA_SOURCES } from './compact-tool-declaration-registry.mjs';
import { requestSchema } from './proof-request-schema.mjs';
import { proofAuthoringSchema, proofAuthoringUnitInputSchema } from './proof-authoring-input-schema.mjs';
import { obligationCoverageQueryOperation, refuseObligationCoverageQuery,
  resolveObligationCoverageQueryRevision } from
  '@agent-chassis/wiki-core/src/operations/controlled-contract/obligation-coverage-query.mjs';
import { assertObligationCoverageQueryScope, obligationCoverageQueryAuthorityIdentity,
  resolveObligationCoverageQueryContext } from './controlled-contract-query-context.mjs';
import { createObligationCoverageQuerySelection, OBLIGATION_COVERAGE_QUERY_ROUTE } from
  './controlled-contract-query-response.mjs';
import { measureMcpInlineResultBytes } from './mcp-response.mjs';
import { selectedResponseDeliveryBound } from './selected-response-snapshot.mjs';
import { isOrchestratorPresentationSession } from './tool-profile.mjs';

export { requestSchema };

const handlers = Object.freeze({
  workspace_controlled_contract_obligation_coverage_upsert: upsertControlledContractObligationCoverageOperation,
  workspace_controlled_contract_obligation_coverage_remove: removeControlledContractObligationCoverageOperation,
  workspace_controlled_contract_obligation_coverage_query: queryControlledContractObligationCoverageOperation,
  workspace_validate_proof: validateProofOperation
});

function upsertDeclaration(z, focus) {
  const declared = CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_UPSERT_DECLARED_INPUT_SCHEMA;
  return requestSchema(z, declared, declared.$defs, { memoize: true })
    .extend({ focus }).describe(declared.description);
}

const QUERY_LIVE_SELECTORS = Object.freeze(['focus', 'obligation_id', 'parameter_detail', 'inventory', 'view']);

function queryObservationIdentity(focus, revision) {
  if (revision === null) return null;
  return focus === undefined || focus === null ? revision : `${focus}@${revision}`;
}

function parseQueryObservationIdentity(observation) {
  if (typeof observation !== 'string') return null;
  const at = observation.lastIndexOf('@');
  return at < 0 ? { focus: null, revision: observation }
    : { focus: observation.slice(0, at), revision: observation.slice(at + 1) };
}

function createQueryHandler({ respond, identity, sessionEnv, responseEnv, querySourceDeps,
  resolveWorkspace, z }) {
  const context = (workspace) => resolveObligationCoverageQueryContext({
    env: sessionEnv, workspace, deps: querySourceDeps });
  const selection = createObligationCoverageQuerySelection({
    unitSchema: proofAuthoringUnitInputSchema(z),
    env: responseEnv,

    resolveCurrentObservationIdentity: async (retained) => {
      const parsed = parseQueryObservationIdentity(retained.observation_identity);
      if (parsed === null) return null;
      const resolved = await context(resolveWorkspace(retained.repository));
      const { wkId, selectedUnit } = identity(retained.unit);
      return queryObservationIdentity(parsed.focus, await resolveObligationCoverageQueryRevision({
        repoRoot: resolved.sourceRoot, wkId, selectedUnit, focus: parsed.focus }));
    }
  });
  return (args) => respond('query', args, async (workspace) => {
    const prepared = await obligationCoverageQueryOperation(async () => {
      const resolved = await context(workspace);
      assertObligationCoverageQueryScope(resolved, { unit: args.unit, focus: args.focus });
      const { wkId, selectedUnit } = identity(args.unit);
      if (args.detail !== undefined) {
        const conflicts = QUERY_LIVE_SELECTORS.filter((key) => args[key] !== undefined);
        if (conflicts.length > 0) refuseObligationCoverageQuery('obligation_coverage_request_invalid',
          'detail reads the retained query result; live selection controls cannot be combined with it', {
            phase: 'request', failed_condition: 'detail_with_live_selector',
            subject: { unit: args.unit }, actor: resolved.role, rejected_arguments: conflicts,
            next_calls: [{ tool: OBLIGATION_COVERAGE_QUERY_ROUTE, arguments: {
              ...(args.repo === undefined ? {} : { repo: args.repo }), unit: args.unit, detail: args.detail } }] });
      }

      const sourceGeneration = resolved.managed ? await resolveObligationCoverageQueryRevision({
        repoRoot: resolved.sourceRoot, wkId, selectedUnit, focus: null }) : null;
      const authorityIdentity = obligationCoverageQueryAuthorityIdentity(resolved, {
        unit: args.unit, sourceGeneration });
      if (args.detail !== undefined) return { resolved, authorityIdentity };
      const carrier = await handlers[OBLIGATION_COVERAGE_QUERY_ROUTE]({ repoRoot: resolved.sourceRoot,
        wkId, selectedUnit, focus: args.focus ?? null,
        ...(args.obligation_id === undefined ? {} : { obligationId: args.obligation_id }),
        ...(args.parameter_detail === undefined ? {} : { parameterDetail: args.parameter_detail }),
        ...(args.inventory === undefined ? {} : { inventory: args.inventory }),
        ...(args.view === undefined ? {} : { view: args.view }),
        population: resolved.population });
      return { resolved, authorityIdentity, carrier };
    });
    if (args.detail !== undefined) {
      return selection.detail({ workspaceRepo: workspace.repo, unit: args.unit,
        authorityIdentity: prepared.authorityIdentity, detail: args.detail });
    }
    const carrier = { ...prepared.carrier, source_authority: {
      role: prepared.resolved.role, source_kind: prepared.resolved.identity.source.kind,
      population_kind: prepared.resolved.identity.population.kind } };
    return selection.publish({ workspaceRepo: workspace.repo, carrier,
      view: args.view ?? 'compact',
      queryIdentity: { focus: args.focus ?? null, obligation_id: args.obligation_id ?? null,
        parameter_detail: args.parameter_detail === true, inventory: args.inventory === true,
        view: args.view ?? 'compact' },
      observationIdentity: queryObservationIdentity(args.focus, carrier.content_digest),
      authorityIdentity: prepared.authorityIdentity });
  });
}

export function registerProofAuthoringTools({ defineTool, z, focus, respond, identity, inputBoundary,
  validationDeps = Object.freeze({}), sessionEnv = process.env, responseEnv = process.env,
  querySourceDeps = Object.freeze({}), resolveWorkspace }) {
  const queryHandler = createQueryHandler({ respond, identity, sessionEnv, responseEnv,
    querySourceDeps, resolveWorkspace, z });

  const validationDelivery = Object.freeze({ measure: measureMcpInlineResultBytes,
    limit: selectedResponseDeliveryBound(responseEnv) });

  const validationPresentation = Object.freeze({
    orchestrator: isOrchestratorPresentationSession(sessionEnv) });
  for (const tool of CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_TOOL_DEFINITIONS) {
    const operation = tool.name === 'workspace_validate_proof' ? 'validate' : tool.name.split('_').at(-1);
    const inputSchema = inputBoundary(proofAuthoringSchema(tool, z, focus));
    defineTool(tool.name, {
      description: tool.description,
      writeSemantics: ['upsert', 'remove'].includes(operation)
        ? MCP_WRITE_SEMANTICS.ITEM_UPSERT : MCP_WRITE_SEMANTICS.NONE,
      inputSchema,
      ...(operation === 'upsert'
        ? { advertisedInputSchema: upsertDeclaration(z, focus),
          inputContractSchemaSource: INPUT_CONTRACT_SCHEMA_SOURCES.ADVERTISED,
          inputContractAuthoringGuidance:
            CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE,
          inputContractRequestGuidanceLocations:
            CONTROLLED_CONTRACT_REQUIREMENT_REQUEST_GUIDANCE_LOCATIONS,
          inputContractUnprojectedConstraints: [{
            path: "$.contract_requirements",
            reason: "owner_validated_semantic_constraints",
            guidance_path: ["overview"]
          }] }
        : {})
    }, operation === 'query' ? queryHandler : args => respond(operation, args, workspace => {
      const { repo, unit, focus, obligation_id, diagnostic_group_id,
        expected_content_digest,
        contract_requirements, controlled_acceptance, removal_scope, ...changes } = args;
      const operationInput = { repoRoot: workspace.dir, ...identity(unit), focus: focus ?? null,
        ...(obligation_id === undefined ? {} : { obligationId: obligation_id }),
        ...(diagnostic_group_id === undefined ? {} : { diagnosticGroupId: diagnostic_group_id }),
        ...(Object.hasOwn(args, 'expected_content_digest') ? { expectedContentDigest: expected_content_digest } : {}),
        ...(contract_requirements === undefined ? {} : {
          contractRequirements: contract_requirements }),
        ...(controlled_acceptance === undefined ? {} : {
          controlledAcceptance: controlled_acceptance }),
        ...(removal_scope === undefined ? {} : { removalScope: removal_scope }), ...changes };
      return tool.name === 'workspace_validate_proof'
        ? handlers[tool.name](operationInput, { ...validationDeps, delivery: validationDelivery,
          presentation: validationPresentation })
        : handlers[tool.name](operationInput);
    }), { losslessDelivery: operation !== 'validate' });
  }
}
