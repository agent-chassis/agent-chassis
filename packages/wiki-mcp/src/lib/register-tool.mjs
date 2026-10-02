

import { shouldExposeTool } from "./tool-profile.mjs";
import { guardToolHandler } from "./mcp-response.mjs";
import { isDeepStrictEqual } from "node:util";
import {
  AGENT_TOOL_LIVE_DESCRIPTION_HARD_LIMIT_CHARACTERS
} from "@agent-chassis/wiki-core/src/lib/tool-discovery/descriptor.mjs";
import {
  MCP_CALLABLE_REPRESENTATION_IDS,
  evaluateMcpCallableContractConformance
} from "@agent-chassis/wiki-core/src/lib/mcp-callable-contract-conformance.mjs";
import {
  INPUT_CONTRACT_SCHEMA_SOURCES,
  recordCompactToolDeclaration,
  registeredToolInputGuidance,
  registeredToolInputGuidanceRequestLocations
} from "./compact-tool-declaration-registry.mjs";
import {
  projectCompactInputRecovery,
  rejectedFieldPath
} from "./compact-input-recovery.mjs";
import { inputContractMechanicalRefusal } from "./tool-discovery-input-guidance-delivery.mjs";
import {
  bindRegisteredToolRequestContracts,
  createRegisteredToolRequestContractStore
} from "./registered-tool-request-contracts.mjs";

export const MCP_WRITE_SEMANTICS = Object.freeze({
  WHOLE_FIELD_REPLACEMENT: "whole_field_replacement",
  NESTED_MERGE_REPLACEMENT: "nested_merge_replacement",
  ACTION_REPLACE_OR_APPEND: "action_replace_or_append",
  ITEM_UPSERT: "item_upsert",
  NONE: "none"
});

export const MCP_WRITE_SEMANTICS_STATEMENTS = Object.freeze({
  [MCP_WRITE_SEMANTICS.WHOLE_FIELD_REPLACEMENT]:
    "Replaces the whole field; omitted entries are dropped.",
  [MCP_WRITE_SEMANTICS.NESTED_MERGE_REPLACEMENT]:
    "Supplied fields replace whole values; sections merges; partial nested objects refuse.",
  [MCP_WRITE_SEMANTICS.ACTION_REPLACE_OR_APPEND]:
    "Replace actions write whole values; append actions add one item.",
  [MCP_WRITE_SEMANTICS.ITEM_UPSERT]:
    "Only the named items change; each supplied item replaces it wholly.",
  [MCP_WRITE_SEMANTICS.NONE]: null
});

export const MCP_WRITE_SEMANTICS_VALUES = Object.freeze(
  Object.keys(MCP_WRITE_SEMANTICS_STATEMENTS)
);

export function composeWriteSemanticsDescription(description, writeSemantics, name) {
  if (writeSemantics === undefined || writeSemantics === null) {
    return description;
  }
  if (!Object.prototype.hasOwnProperty.call(MCP_WRITE_SEMANTICS_STATEMENTS, writeSemantics)) {
    throw new Error(
      `Unsupported writeSemantics '${writeSemantics}' declared by tool ${name}; expected one of: ${MCP_WRITE_SEMANTICS_VALUES.join(", ")}`
    );
  }
  const statement = MCP_WRITE_SEMANTICS_STATEMENTS[writeSemantics];
  if (!statement) {
    return description;
  }
  const authored = typeof description === "string" ? description.trim() : "";
  return authored ? `${authored} ${statement}` : statement;
}

const MAX_EFFECTS_UNWRAP_DEPTH = 32;
export const MCP_CALLABLE_OWNER_PROJECTION_PARAM =
  "mcp_callable_contract_owner_projection";
const MCP_CALLABLE_OWNER_PROJECTION_SCHEMA_VERSION =
  "mcp-callable-contract-owner-projection.v1";

export function projectMcpCallableOwnerIssues({
  ownerId,
  tool,
  issues,
  ownerResult = {}
}) {
  const diagnostics = (Array.isArray(issues) ? issues : []).map((issue) => ({
    ...issue,
    severity: "error"
  }));
  const first = diagnostics[0] ?? {};
  const envelope = {
    schema_version: "work-record-selector-refusal.v1",
    tool,
    accepted: false,
    refusal_code: first.code,
    diagnostics,
    ...ownerResult
  };
  const representations = ["route_validation", "handler_acceptance", "public_result"];
  const ownerFacts = [
    {
      fact_id: `${tool}:selector-identity`,
      owner_id: ownerId,
      fact_kind: "recovery_fact",
      value: { code: first.code },
      required_representations: representations,
      claim_ids: ["claim-representations", "claim-recovery", "claim-ownership", "claim-seed"]
    },
    {
      fact_id: `${tool}:selector-diagnostics`,
      owner_id: ownerId,
      fact_kind: "owner_fact",
      value: diagnostics,
      required_representations: representations,
      claim_ids: ["claim-retrieval", "claim-integrity"]
    },
    {
      fact_id: `${tool}:selector-envelope`,
      owner_id: ownerId,
      fact_kind: "owner_fact",
      value: envelope,
      required_representations: ["public_result"],
      claim_ids: ["claim-recovery", "claim-ownership"]
    }
  ];
  if (Object.hasOwn(ownerResult, "recovery_actor")) {
    ownerFacts.push({
      fact_id: `${tool}:selector-recovery-actor`,
      owner_id: ownerId,
      fact_kind: "recovery_actor",
      value: ownerResult.recovery_actor,
      required_representations: ["public_result"],
      claim_ids: ["claim-recovery"]
    });
  }
  if (Object.hasOwn(ownerResult, "corrected_call")) {
    ownerFacts.push({
      fact_id: `${tool}:selector-corrected-call`,
      owner_id: ownerId,
      fact_kind: "corrected_call",
      value: ownerResult.corrected_call,
      required_representations: ["public_result"],
      claim_ids: ["claim-recovery"]
    });
  }
  return {
    schema_version: MCP_CALLABLE_OWNER_PROJECTION_SCHEMA_VERSION,
    expected_owner_fact_ids: ownerFacts.map((fact) => fact.fact_id),
    owner_facts: ownerFacts,
    supported_calls: Array.isArray(ownerResult.supported_calls)
      ? ownerResult.supported_calls
      : Object.hasOwn(ownerResult, "corrected_call") ? [ownerResult.corrected_call] : [],
    envelope
  };
}

function evaluateEffectsOwnerProjections(projections, { name, role, tier }) {
  const unique = [];
  for (const projection of projections) {
    if (!unique.some((entry) => isDeepStrictEqual(entry, projection))) unique.push(projection);
  }
  const primary = unique[0] ?? {};
  const memberId = `${role}:${tier}:${name}`;
  const ownerFacts = unique.flatMap((projection) =>
    Array.isArray(projection?.owner_facts) ? projection.owner_facts : []
  ).map((fact) => ({ ...fact, member_id: fact?.member_id ?? memberId }));
  const representations = Object.fromEntries(MCP_CALLABLE_REPRESENTATION_IDS.map(
    (representationId) => [representationId, [{
      member_id: memberId,
      facts: ownerFacts
        .filter((fact) => Array.isArray(fact.required_representations) &&
          fact.required_representations.includes(representationId))
        .map(({ fact_id, owner_id, fact_kind, value }) =>
          ({ fact_id, owner_id, fact_kind, value }))
    }]]
  ));
  return evaluateMcpCallableContractConformance({
    schema_version: "mcp-callable-contract-conformance-input.v1",
    inventory: {
      registered_member_ids: [memberId],
      owner_fact_ids: primary.expected_owner_fact_ids
    },
    population: [{ member_id: memberId, tool_name: name, role, tier, visibility: "included" }],
    owner_facts: ownerFacts,
    supported_calls: unique.flatMap((projection) =>
      Array.isArray(projection?.supported_calls) ? projection.supported_calls : []
    ),
    representations
  }, { collection: "diagnostics", offset: 0, limit: 100 });
}

function isZodV3SchemaInstance(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value._def !== undefined &&
    value._zod === undefined
  );
}

function unwrapEffectsInputSchemaToZodObject(schema) {
  if (!isZodV3SchemaInstance(schema)) {
    return null;
  }
  let current = schema;
  let sawEffects = false;
  for (let depth = 0; depth < MAX_EFFECTS_UNWRAP_DEPTH; depth += 1) {
    const def = current?._def;
    if (!def) {
      return null;
    }
    if (def.typeName === "ZodEffects") {
      sawEffects = true;
      current = def.schema;
      continue;
    }
    break;
  }
  if (!sawEffects) {
    return null;
  }
  return current?._def?.typeName === "ZodObject" ? current : null;
}

function declarationOnlySchemaView(schema) {
  const passthrough = { value: (input) => input, enumerable: false };
  const passthroughSafe = {
    value: (input) => ({ success: true, data: input }), enumerable: false
  };
  return Object.create(schema, {
    parse: passthrough,
    parseAsync: { value: async (input) => input, enumerable: false },
    safeParse: passthroughSafe,
    safeParseAsync: {
      value: async (input) => ({ success: true, data: input }), enumerable: false
    }
  });
}

export const TOOL_INPUT_VALIDATION_FAILED = "tool_input_validation_failed";

export function createToolInputValidationError({ tool, validationError, details = {}, nextCalls = [] }) {
  const message = `${tool}: ${validationError.message}`;
  const refusal = inputContractMechanicalRefusal(TOOL_INPUT_VALIDATION_FAILED, message, {
    tool,
    rejected_field_paths: [...new Set(validationError.issues.map(
      (issue) => rejectedFieldPath(issue.path)
    ))],
    validator_diagnostics: validationError.issues
  }, nextCalls);
  const error = new Error(message);
  error.envelope = { ...refusal, diagnostic: { ...details, ...refusal.diagnostic } };
  return error;
}

function createEffectsEnforcingHandler(
  effectsSchema,
  downstreamHandler,
  name,
  role,
  tier,
  compactContractRecovery = false,
  inputValidationErrorProjector = null
) {
  return async (args, extra) => {
    const parsed = await effectsSchema.safeParseAsync(args);
    if (!parsed.success) {
      const projectedFailure = inputValidationErrorProjector === null
        ? null
        : await inputValidationErrorProjector({
          args,
          validationError: parsed.error,
          tool: name,
          role,
          tier
        });
      if (projectedFailure?.terminal_result !== undefined) {
        return projectedFailure.terminal_result;
      }
      if (projectedFailure !== null &&
          (projectedFailure === undefined || projectedFailure.projection === undefined)) {
        throw new TypeError(
          `${name} inputValidationErrorProjector returned an unrecognized result`
        );
      }
      const projections = projectedFailure === null
        ? parsed.error.issues
          .map((issue) => issue?.params?.[MCP_CALLABLE_OWNER_PROJECTION_PARAM])
          .filter((projection) => projection !== undefined)
        : [projectedFailure.projection];
      if (projections.length > 0) {
        const conformance = evaluateEffectsOwnerProjections(projections, { name, role, tier });
        const error = new Error(parsed.error.message);
        if (conformance.status === "conformant") {
          error.envelope = {
            ...projections[0].envelope,
            ...(Array.isArray(projectedFailure?.next_calls) &&
                projectedFailure.next_calls.length > 0
              ? { next_calls: projectedFailure.next_calls }
              : {})
          };
        } else {
          error.envelope = conformance;
        }
        throw error;
      }
      throw createToolInputValidationError({ tool: name, validationError: parsed.error });
    }
    const result = await downstreamHandler(parsed.data, extra);
    return compactContractRecovery
      ? projectCompactInputRecovery({
        result,
        toolName: name,
        guidance: registeredToolInputGuidance(name),
        requestGuidanceLocations: registeredToolInputGuidanceRequestLocations(name)
      })
      : result;
  };
}

export function createRegisterTool({
  server,
  toolProfile,
  registeredTier,
  mcpToolTierRegistrationPolicy,
  toolUsageAuditBoundary,
  registeredToolNames,
  structuredLog,

  responseEnv = process.env
}) {

  const requestContracts = createRegisteredToolRequestContractStore();
  const registerTool = function registerTool(name, config, handler) {

    if (!shouldExposeTool(toolProfile, name)) {
      return;
    }

    if (!(mcpToolTierRegistrationPolicy.descriptorToolNames instanceof Set) ||
        !mcpToolTierRegistrationPolicy.descriptorToolNames.has(name)) {
      throw new Error(
        `agent_tool_descriptor_missing: role-visible MCP tool '${name}' has no canonical descriptor entry`
      );
    }
    if (!(mcpToolTierRegistrationPolicy.registrationEligibleToolNames instanceof Set) ||
        !mcpToolTierRegistrationPolicy.registrationEligibleToolNames.has(name)) {
      throw new Error(
        `agent_tool_conformance_missing: role-visible MCP tool '${name}' is neither conformant nor unchanged owner-bound debt`
      );
    }

    if (
      registeredTier !== "paid_cce" &&
      mcpToolTierRegistrationPolicy.descriptorLoaded === true &&
      !mcpToolTierRegistrationPolicy.freeLocalToolNames?.has(name)
    ) {
      return;
    }

    const {
      writeSemantics,
      advertisedInputSchema,
      inputContractSchemaSource = INPUT_CONTRACT_SCHEMA_SOURCES.AUTHORITATIVE,
      inputContractUnprojectedConstraints,
      inputContractAuthoringGuidance,
      inputContractRequestGuidanceLocations,
      inputValidationErrorProjector,
      ...declaredConfig
    } = config ?? {};
    const publishedConfig = writeSemantics === undefined
      ? declaredConfig
      : {
          ...declaredConfig,
          description: composeWriteSemanticsDescription(declaredConfig.description, writeSemantics, name)
        };
    const publishedDescription = publishedConfig?.description;
    const publishedLength = typeof publishedDescription === "string"
      ? publishedDescription.length
      : 0;
    if (typeof publishedDescription !== "string" || publishedDescription.trim().length === 0) {
      throw new Error(
        `agent_tool_description_missing: live description for '${name}' is empty; observed length ${publishedLength}`
      );
    }
    if (publishedLength > AGENT_TOOL_LIVE_DESCRIPTION_HARD_LIMIT_CHARACTERS) {
      throw new Error(
        `agent_tool_description_budget_debt_added: live description for '${name}' has observed length ${publishedLength}; hard limit is ${AGENT_TOOL_LIVE_DESCRIPTION_HARD_LIMIT_CHARACTERS}`
      );
    }
    const authoritativeInputSchema = publishedConfig?.inputSchema;
    if (advertisedInputSchema !== undefined &&
        typeof authoritativeInputSchema?.safeParseAsync !== "function") {
      throw new Error(
        `agent_tool_advertised_schema_without_authority: '${name}' advertises a compact input schema but declares no enforceable authoritative inputSchema`
      );
    }
    if (!Object.values(INPUT_CONTRACT_SCHEMA_SOURCES).includes(inputContractSchemaSource)) {
      throw new Error(
        `agent_tool_input_contract_schema_source_invalid: '${name}' declares inputContractSchemaSource ${JSON.stringify(inputContractSchemaSource)}; expected one of: ${Object.values(INPUT_CONTRACT_SCHEMA_SOURCES).join(", ")}`
      );
    }
    if (inputContractSchemaSource === INPUT_CONTRACT_SCHEMA_SOURCES.ADVERTISED &&
        advertisedInputSchema === undefined) {
      throw new Error(
        `agent_tool_input_contract_schema_source_without_advertised_schema: '${name}' selects its advertised input schema as the input contract source but declares no advertisedInputSchema`
      );
    }
    const schemaToPublish = advertisedInputSchema === undefined
      ? authoritativeInputSchema
      : declarationOnlySchemaView(
        unwrapEffectsInputSchemaToZodObject(advertisedInputSchema) ?? advertisedInputSchema
      );
    const innerObjectSchema = advertisedInputSchema === undefined
      ? unwrapEffectsInputSchemaToZodObject(schemaToPublish)
      : null;

    const publishedInputSchema = innerObjectSchema === null
      ? schemaToPublish
      : inputValidationErrorProjector === undefined
        ? innerObjectSchema
        : declarationOnlySchemaView(innerObjectSchema);
    const effectiveConfig = publishedInputSchema === authoritativeInputSchema
      ? publishedConfig
      : { ...publishedConfig, inputSchema: publishedInputSchema };

    const mustEnforceAuthoritativeSchema =
      advertisedInputSchema !== undefined || innerObjectSchema !== null;
    if (inputValidationErrorProjector !== undefined && !mustEnforceAuthoritativeSchema) {
      throw new Error(
        `agent_tool_input_failure_projector_without_boundary: '${name}' must declare an advertised schema or refined-object publication boundary`
      );
    }
    if (advertisedInputSchema !== undefined) {
      recordCompactToolDeclaration({
        toolName: name,
        authoritativeSchema: authoritativeInputSchema,
        advertisedSchema: advertisedInputSchema,
        inputContractSchemaSource,
        unprojectedConstraints: inputContractUnprojectedConstraints,
        authoringGuidance: inputContractAuthoringGuidance,
        requestGuidanceLocations: inputContractRequestGuidanceLocations
      });
    }
    const auditedHandler = toolUsageAuditBoundary.wrapHandler(name, handler);
    const registrationHandler = mustEnforceAuthoritativeSchema
      ? createEffectsEnforcingHandler(
          authoritativeInputSchema,
          auditedHandler,
          name,
          toolProfile,
          registeredTier,
          advertisedInputSchema !== undefined,
          inputValidationErrorProjector ?? null
        )
      : auditedHandler;
    const declaredRequestContract = { inputSchema: authoritativeInputSchema, advertisedInputSchema };
    requestContracts.assertRetainable(name, declaredRequestContract);
    server.registerTool(
      name,
      effectiveConfig,
      guardToolHandler(registrationHandler, {
        name,
        log: structuredLog,
        env: responseEnv,
        outputSchema: effectiveConfig?.outputSchema ?? null
      })
    );
    registeredToolNames.add(name);
    requestContracts.retain(name, {
      ...declaredRequestContract,
      publishedInputSchema: effectiveConfig?.inputSchema
    });
  };
  bindRegisteredToolRequestContracts(registerTool, requestContracts);
  return registerTool;
}
