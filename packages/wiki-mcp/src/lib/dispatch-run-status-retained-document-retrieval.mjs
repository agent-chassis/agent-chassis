

import { createHash } from "node:crypto";

import {
  buildDispatchContinuation,
  recordRegisteredRequestSchema
} from "./dispatch-tool-helpers.mjs";
import {
  createMcpContentReferenceReadInputSchema,
  MCP_CONTENT_REFERENCE_READ_TOOL,
  mcpContentReferenceReconstruction
} from "./mcp-content-reference-tools.mjs";
import { SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION } from "./selected-response-snapshot.mjs";
import { z as zodOwner } from "zod";

recordRegisteredRequestSchema(
  MCP_CONTENT_REFERENCE_READ_TOOL,
  createMcpContentReferenceReadInputSchema(zodOwner)
);

export const RUN_STATUS_RETAINED_DOCUMENT_ROUTE = "workspace_agent_run_status";

export function authoredDocumentDigest(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function isObjectRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function serializeRetainedObject(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

export function objectCarrierStep(carrierMember, obtains) {
  return `JSON.parse the verified bytes as UTF-8, then JSON.parse ` +
    `carrier.${carrierMember} to obtain ${obtains}`;
}

function retainedSourceRead(locator) {
  try {
    return buildDispatchContinuation({
      tool: MCP_CONTENT_REFERENCE_READ_TOOL,
      arguments: { ref_id: locator.ref_id, offset: 0 },
      successPredicate: { fact: "content_reference.retained_source_read", operator: "is_true" }
    });
  } catch {
    return null;
  }
}

export function buildRetainedDocumentRetrieval(retention, { carrierStep }) {
  if (retention === null || retention === undefined) {
    return {
      state: "unavailable",
      code: "authored_contract_source_not_retained",
      meaning: "this response retained no source, so the omitted bytes are not retrievable from it"
    };
  }
  if (retention.state !== "retained") {
    return {
      state: "unavailable",
      code: typeof retention.code === "string" ? retention.code : "authored_contract_source_not_retained",
      meaning: "retention failed for this observation; no current read substitutes for the omitted bytes"
    };
  }
  const read = retainedSourceRead(retention.locator);
  if (read === null) {
    return {
      state: "unavailable",
      code: "content_reference_read_route_unavailable",
      meaning: "the retained source exists but this registration publishes no checkable read for it"
    };
  }
  return {
    state: "retained",

    source_schema_version: SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION,
    ref_id: retention.locator.ref_id,
    sha256: retention.locator.sha256,

    binding: {
      route: RUN_STATUS_RETAINED_DOCUMENT_ROUTE,
      repository: retention.repository,
      unit: retention.unit,
      observation_identity: retention.observation_identity
    },
    carrier_members: retention.members,
    reconstruction: mcpContentReferenceReconstruction(carrierStep),
    retained_source_read: read
  };
}
