

import { projectZodRequestContract } from "./zod-request-contract-projection.mjs";
import {
  assertToolInputGuidanceRegistration,
  assertToolInputGuidanceRequestLocations,
  projectToolInputGuidanceReferences,
  toolInputGuidanceLocator
} from "./tool-discovery-input-guidance-delivery.mjs";

const compactDeclarations = new Map();

export const INPUT_CONTRACT_SCHEMA_SOURCES = Object.freeze({
  AUTHORITATIVE: "authoritative",
  ADVERTISED: "advertised",

  SERVED_DECLARATION: "served_declaration"
});

export const INPUT_CONTRACT_ENFORCEMENT = Object.freeze({
  REQUEST_BOUNDARY: "server_side_on_every_call",
  DECLARED_OWNER: "canonical_owner_on_every_call"
});

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function recordCompactToolDeclaration({
  toolName,
  authoritativeSchema,
  advertisedSchema,
  inputContractSchemaSource = INPUT_CONTRACT_SCHEMA_SOURCES.AUTHORITATIVE,
  unprojectedConstraints = [],
  authoringGuidance = null,
  requestGuidanceLocations = []
}) {
  if (typeof toolName !== "string" || toolName.length === 0) return;
  if (authoringGuidance !== null) assertToolInputGuidanceRegistration(toolName, authoringGuidance);
  if (!Array.isArray(requestGuidanceLocations) || requestGuidanceLocations.length > 0) {
    assertToolInputGuidanceRequestLocations(toolName, authoringGuidance, requestGuidanceLocations);
  }
  compactDeclarations.set(toolName, {
    authoritativeSchema,
    advertisedSchema,
    inputContractSchemaSource,
    unprojectedConstraints: structuredClone(unprojectedConstraints),
    authoringGuidance: authoringGuidance === null
      ? null
      : deepFreeze(structuredClone(authoringGuidance)),
    requestGuidanceLocations: deepFreeze(structuredClone(requestGuidanceLocations)),
    projected: null
  });
}

export const COMPACT_TOOL_CONTRACT_COMPLETENESS = Object.freeze({
  EXACT: "exact",
  PARTIAL: "partial"
});

const COMPLETENESS_STATEMENTS = Object.freeze({
  [COMPACT_TOOL_CONTRACT_COMPLETENESS.EXACT]:
    "Every constraint this route enforces is stated here.",
  [COMPACT_TOOL_CONTRACT_COMPLETENESS.PARTIAL]:
    "Structural shape and declared constraints are stated here; `unprojected` " +
    "names every further constraint the server enforces, by request path, with " +
    "a call selecting the owning guidance where one is registered. A request " +
    "satisfying only the stated shape can still be refused by one of them."
});

export function recordServedToolInputContract({
  toolName,
  contractSchema,
  enforcedBy,
  unprojectedConstraints = [],
  authoringGuidance = null,
  requestGuidanceLocations = []
}) {
  if (typeof toolName !== "string" || toolName.length === 0) return;
  if (typeof enforcedBy !== "string" || enforcedBy.length === 0) {
    throw new TypeError(
      `served_tool_input_contract_without_enforcement_owner: '${toolName}' must name the owner that decides the declared contract`
    );
  }
  if (authoringGuidance !== null) assertToolInputGuidanceRegistration(toolName, authoringGuidance);
  if (!Array.isArray(requestGuidanceLocations) || requestGuidanceLocations.length > 0) {
    assertToolInputGuidanceRequestLocations(toolName, authoringGuidance, requestGuidanceLocations);
  }
  compactDeclarations.set(toolName, {
    authoritativeSchema: contractSchema,
    advertisedSchema: contractSchema,
    inputContractSchemaSource: INPUT_CONTRACT_SCHEMA_SOURCES.SERVED_DECLARATION,
    enforcedBy,
    unprojectedConstraints: structuredClone(unprojectedConstraints),
    authoringGuidance: authoringGuidance === null
      ? null
      : deepFreeze(structuredClone(authoringGuidance)),
    requestGuidanceLocations: deepFreeze(structuredClone(requestGuidanceLocations)),
    projected: null
  });
}

export function completeToolInputContract(toolName) {
  const entry = compactDeclarations.get(toolName);
  if (entry === undefined) return null;
  if (entry.projected === null) {
    const served =
      entry.inputContractSchemaSource === INPUT_CONTRACT_SCHEMA_SOURCES.SERVED_DECLARATION;

    const projected = projectZodRequestContract(
      entry.inputContractSchemaSource === INPUT_CONTRACT_SCHEMA_SOURCES.ADVERTISED
        ? entry.advertisedSchema
        : entry.authoritativeSchema,
      { shareIdenticalProjections: true }
    );
    if (projected === null) return null;
    const omissions = [
      ...(projected.unprojected ?? []),
      ...entry.unprojectedConstraints
    ];
    const completeness = omissions.length === 0
      ? COMPACT_TOOL_CONTRACT_COMPLETENESS.EXACT
      : COMPACT_TOOL_CONTRACT_COMPLETENESS.PARTIAL;

    entry.projected = Object.freeze({
      ...projected,
      ...(entry.authoringGuidance === null
        ? {}
        : { authoring_guidance_locator: toolInputGuidanceLocator(toolName, entry.authoringGuidance) }),
      ...(omissions.length > 0
        ? { unprojected: projectToolInputGuidanceReferences(toolName, entry.authoringGuidance, omissions) }
        : {}),
      advertised_declaration: served ? "permissive_request_boundary" : "compact",
      enforcement: served
        ? INPUT_CONTRACT_ENFORCEMENT.DECLARED_OWNER
        : INPUT_CONTRACT_ENFORCEMENT.REQUEST_BOUNDARY,

      ...(served ? { enforced_by: entry.enforcedBy } : {}),
      completeness,
      completeness_statement: COMPLETENESS_STATEMENTS[completeness]
    });
  }
  return entry.projected;
}

export function registeredToolInputGuidance(toolName) {
  return compactDeclarations.get(toolName)?.authoringGuidance ?? null;
}

export function registeredToolInputGuidanceRequestLocations(toolName) {
  return compactDeclarations.get(toolName)?.requestGuidanceLocations ?? [];
}

export function compactToolInputContractSchema(toolName) {
  const entry = compactDeclarations.get(toolName);
  if (entry === undefined) return null;
  return entry.inputContractSchemaSource === INPUT_CONTRACT_SCHEMA_SOURCES.ADVERTISED
    ? entry.advertisedSchema
    : entry.authoritativeSchema;
}

export function hasCompactToolDeclaration(toolName) {
  return compactDeclarations.has(toolName);
}

export function compactToolDeclarationNames() {
  return [...compactDeclarations.keys()];
}
