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

export function registerProofAuthoringTools({ defineTool, z, focus, respond, identity, inputBoundary }) {
  for (const tool of CONTROLLED_CONTRACT_OBLIGATION_COVERAGE_TOOL_DEFINITIONS) {
    const operation = tool.name === 'workspace_validate_proof' ? 'validate' : tool.name.split('_').at(-1);
    const inputSchema = inputBoundary(
      requestSchema(z, tool.inputSchema, tool.inputSchema.$defs,
        { memoize: operation === 'upsert' }).extend({ focus })
    );
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
    }, args => respond(operation, args, workspace => {
      const { repo, unit, focus, obligation_id, diagnostic_group_id,
        expected_content_digest, parameter_detail, inventory, cursor,
        contract_requirements, controlled_acceptance, removal_scope, ...changes } = args;
      return handlers[tool.name]({ repoRoot: workspace.dir, ...identity(unit), focus: focus ?? null,
        ...(obligation_id === undefined ? {} : { obligationId: obligation_id }),
        ...(diagnostic_group_id === undefined ? {} : { diagnosticGroupId: diagnostic_group_id }),
        ...(Object.hasOwn(args, 'expected_content_digest') ? { expectedContentDigest: expected_content_digest } : {}),
        ...(contract_requirements === undefined ? {} : {
          contractRequirements: contract_requirements }),
        ...(controlled_acceptance === undefined ? {} : {
          controlledAcceptance: controlled_acceptance }),
        ...(removal_scope === undefined ? {} : { removalScope: removal_scope }),
        ...(parameter_detail === undefined ? {} : { parameterDetail: parameter_detail }),
        ...(inventory === undefined ? {} : { inventory }),
        ...(cursor === undefined ? {} : { cursor }), ...changes });
    }), { losslessDelivery: true });
  }
}
