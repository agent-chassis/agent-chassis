import { createHash } from "node:crypto";

import {
  refuseMalformedControlledContractObligationCoverageRequest
} from "@agent-chassis/wiki-core/src/operations/controlled-contract/acceptance-coverage-operations.mjs";

import {
  parseProofSourceUnitAddress
} from "@agent-chassis/wiki-core/src/operations/controlled-contract/saved-proof-source.mjs";

import { proofAuthoringFocusInputSchema } from "./proof-authoring-input-schema.mjs";
import { registerProofAuthoringTools } from "./proof-authoring-tools.mjs";
import { proofAuthoringValidationTestCompositionDeps } from
  "./proof-authoring-validation-test-composition.mjs";
import { registerProofDiscoveryTool } from "./proof-discovery-tools.mjs";
import { registerVerifyProofTool } from "./verify-proof-tool.mjs";
import { VERIFY_PROOF_TOOL_NAME } from "./verify-proof-public-result.mjs";
import {
  assertNoControlledContractRawResponse,
  persistVerifyProofEvidenceReference
} from "./mcp-response.mjs";

const CONTROLLED_CONTRACT_ROUTE_METADATA = Object.freeze([
  ["workspace_controlled_proof_intents_discover", "sha256:d47d4f56248f499ba17b503a1a5b49415143c108f66c515217b727fcdbdfb917"],
  ["workspace_verify_proof", "sha256:6c86be2ab88442345a9d7bcb8d6de201d87d50b70120c455ecb5f17484f3664a"],
  ["workspace_controlled_contract_obligation_coverage_upsert", "sha256:23c9913bde7a8f7f85a626d4a49c9481891209b509302340d06e7f8cff033564"],
  ["workspace_controlled_contract_obligation_coverage_remove", "sha256:0738fab5bb5549392b9113c2fff30162a14be8ef97353ae5c568cb08907671a4"],
  ["workspace_controlled_contract_obligation_coverage_query", "sha256:430e4e6cd50d6e7dd87b93f842d83123b48e2c40a8377f8c41d8c6af21ad7d13"],
  ["workspace_validate_proof", "sha256:7e26d26777d665bda2ddd1cd5db0255b3656917655dd28cc8e1491a4399c520f"]
].map(([name, discoveryMetadataSha256]) => Object.freeze({
  name,
  discoveryMetadataSha256
})));

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
  return value;
}

function metadataDigest(value) {
  return `sha256:${createHash("sha256").update(
    JSON.stringify(canonicalize(value))
  ).digest("hex")}`;
}

export function assertControlledContractDiscoveryRegistryParity(discoveryFragment) {
  const rows = Array.isArray(discoveryFragment?.tools) ? discoveryFragment.tools : [];
  if (discoveryFragment?.tool_count !== CONTROLLED_CONTRACT_ROUTE_METADATA.length ||
      rows.length !== CONTROLLED_CONTRACT_ROUTE_METADATA.length) {
    throw new Error("controlled-contract discovery population does not match the authoritative registry");
  }
  for (let index = 0; index < CONTROLLED_CONTRACT_ROUTE_METADATA.length; index += 1) {
    const owner = CONTROLLED_CONTRACT_ROUTE_METADATA[index];
    const row = rows[index];
    if (row?.tool_name !== owner.name) {
      throw new Error(`controlled-contract discovery route order drift at index ${index}: ${owner.name}`);
    }
    if (owner.discoveryMetadataSha256 !== "sha256:pending" &&
        metadataDigest(row) !== owner.discoveryMetadataSha256) {
      throw new Error(`controlled-contract discovery exact field parity drift: ${owner.name}`);
    }
  }
  return true;
}

export const CONTROLLED_CONTRACT_TOOL_REGISTRY = Object.freeze({
  schema_version: "controlled-contract-route-registry.v1",
  routeMetadata: CONTROLLED_CONTRACT_ROUTE_METADATA,
  materialize: createControlledContractToolRegistry
});

export const CONTROLLED_CONTRACT_MCP_TOOL_NAMES = Object.freeze(
  CONTROLLED_CONTRACT_ROUTE_METADATA.map(({ name }) => name)
);

const RUNTIME_HANDLER_OWNER = Symbol("controlled-contract-runtime-handler-owner");

export function controlledContractRuntimeHandlerOwner(handler) {
  return handler?.[RUNTIME_HANDLER_OWNER] ?? null;
}

export function createControlledContractToolRegistry({
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  verifyProofDeps = {},
  proofAuthoringValidationTestComposition = null,
  persistVerifyProofEvidence = persistVerifyProofEvidenceReference,
  responseEnv = process.env
}) {
  const entries = [];
  const names = new Set();
  const defineTool = (name, config, handler, { losslessDelivery = false } = {}) => {
    if (names.has(name)) throw new Error(
      `controlled-contract registry declares a route more than once: ${name}`);
    names.add(name);
    entries.push({ name, config: Object.freeze(config), handler,
      losslessDelivery: losslessDelivery === true });
  };

  const focus = proofAuthoringFocusInputSchema(z).optional();
  const malformedObligationCoverageInput = Symbol(
    "controlled-contract-obligation-coverage-malformed-input"
  );
  const obligationCoverageInputSchema = (schema) => {
    const strictSafeParseAsync = schema.safeParseAsync.bind(schema);
    Object.defineProperty(schema, "safeParseAsync", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: async (input, options) => {
        const parsed = await strictSafeParseAsync(input, options);
        if (parsed.success) return parsed;
        return { success: true, data: { [malformedObligationCoverageInput]: {
          issueCount: parsed.error.issues.length,
          issues: parsed.error.issues.slice(0, 32).map((issue) => ({
            code: issue.code,
            path: issue.path.map((part) =>
              typeof part === "number" ? part : String(part)),
            ...(Array.isArray(issue.keys)
              ? { keys: issue.keys.map((key) => String(key)) } : {})
          }))
        } } };
      }
    });
    return schema;
  };
  const respond = async (operation, args, callback) => {
    try {
      const malformed = args?.[malformedObligationCoverageInput];
      if (malformed) await refuseMalformedControlledContractObligationCoverageRequest({
        operation,
        issueCount: malformed.issueCount,
        issues: malformed.issues
      });
      const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
      return jsonContent(await callback(workspace));
    } catch (error) {
      return errorContent(error);
    }
  };

  registerProofDiscoveryTool({ defineTool, z, jsonContent, errorContent });
  registerVerifyProofTool({
    registerTool: (name, config, handler) =>
      defineTool(name, config, handler, { losslessDelivery: true }),
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    responseEnv,
    persistEvidence: persistVerifyProofEvidence,
    deps: verifyProofDeps
  });
  registerProofAuthoringTools({
    defineTool,
    z,
    focus,
    respond,
    identity: parseProofSourceUnitAddress,
    inputBoundary: obligationCoverageInputSchema,
    validationDeps: proofAuthoringValidationTestCompositionDeps(
      proofAuthoringValidationTestComposition)
  });

  const materializedNames = entries.map(({ name }) => name);
  if (materializedNames.length !== CONTROLLED_CONTRACT_ROUTE_METADATA.length ||
      materializedNames.some((name, index) =>
        name !== CONTROLLED_CONTRACT_ROUTE_METADATA[index].name)) {
    throw new Error("controlled-contract materialized registry does not match its authoritative route order");
  }
  return Object.freeze(entries.map((entry, index) => Object.freeze({
    ...entry,
    discoveryMetadataSha256:
      CONTROLLED_CONTRACT_ROUTE_METADATA[index].discoveryMetadataSha256
  })));
}

export function assertControlledContractRuntimeRegistryParity(registry, registrations) {
  if (!Array.isArray(registrations) || registrations.length !== registry.length) {
    throw new Error("controlled-contract runtime population does not match the authoritative registry");
  }
  for (let index = 0; index < registry.length; index += 1) {
    const owner = registry[index];
    const registered = registrations[index];
    if (registered?.name !== owner.name || registered?.config !== owner.config ||
        controlledContractRuntimeHandlerOwner(registered?.handler) !== owner.handler) {
      throw new Error(`controlled-contract runtime metadata drift: ${owner.name}`);
    }
  }
  return true;
}

export function registerControlledContractTools(options) {
  const registry = CONTROLLED_CONTRACT_TOOL_REGISTRY.materialize(options);
  const registrations = registry.map((entry) => {
    const guard = Object.freeze({ toolName: entry.name,
      losslessDelivery: entry.losslessDelivery });

    const handler = async (args, extra) => {
      try {
        return assertNoControlledContractRawResponse(await entry.handler(args, extra), guard);
      } catch (error) {
        return assertNoControlledContractRawResponse(options.errorContent(error), guard);
      }
    };
    Object.defineProperty(handler, RUNTIME_HANDLER_OWNER, { value: entry.handler });
    return Object.freeze({ name: entry.name, config: entry.config, handler });
  });
  assertControlledContractRuntimeRegistryParity(registry, registrations);
  for (const registration of registrations) {
    options.registerTool(registration.name, registration.config, registration.handler);
  }
  return registry;
}
