

import {
  loadToolDiscoveryDescriptor,
  validateToolDiscoveryDescriptor,
  resolveToolTierVisibility
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";
import {
  evaluateAgentToolConformance,
  loadToolDiscoveryManifest,
  TOOL_DISCOVERY_MANIFEST_PATH
} from "@agent-chassis/wiki-core/src/lib/tool-discovery/descriptor.mjs";
import {
  createCompactWorkRecordEditResponse
} from "./work-record-write-route-helpers.mjs";

export const WORKSPACE_SUBMIT_FOR_REVIEW_TOOL_NAME = "workspace_submit_for_review";

export function structuredLog(data) {
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...data })}\n`
  );
}

export function augmentWorkspaceToolDiscoveryDescriptor(descriptor) {

  return descriptor;
}

export async function loadMcpToolTierRegistrationPolicy({
  manifestPath = TOOL_DISCOVERY_MANIFEST_PATH
} = {}) {
  try {
    const [descriptor, manifest] = await Promise.all([
      loadToolDiscoveryDescriptor(manifestPath),
      loadToolDiscoveryManifest(manifestPath)
    ]);
    const validation = validateToolDiscoveryDescriptor(descriptor);
    if (!validation.valid) {
      throw new Error(
        `assembled descriptor validation failed: ${validation.diagnostics
          .map((diagnostic) => diagnostic.paths[0] ?? diagnostic.code)
          .join(", ")}`
      );
    }
    const conformance = evaluateAgentToolConformance(descriptor, manifest);
    if (conformance.debt_added.length > 0) {
      throw new Error(
        `agent-tool conformance debt grew or a baseline debt entry changed: ${conformance.debt_added.join(", ")}`
      );
    }
    const freeLocalToolNames = new Set();
    const descriptorToolNames = new Set();
    for (const tool of Array.isArray(descriptor?.tools) ? descriptor.tools : []) {
      if (!tool || typeof tool.tool_name !== "string" || tool.kind !== "mcp_tool") {
        continue;
      }
      descriptorToolNames.add(tool.tool_name);
      const visibility = resolveToolTierVisibility(tool);
      if (visibility.includes("free_local")) {
        freeLocalToolNames.add(tool.tool_name);
      }
    }
    return {
      descriptorLoaded: true,
      descriptorToolNames,
      registrationEligibleToolNames: new Set(conformance.registration_eligible_tool_names),
      conformance,
      freeLocalToolNames
    };
  } catch (error) {
    structuredLog({
      level: "error",
      event: "tool_registration_conformance_failed",
      message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function createSubmitForReviewRefusal(decisionCode, reasons, extra = {}) {
  return {
    tool: WORKSPACE_SUBMIT_FOR_REVIEW_TOOL_NAME,
    submitted: false,
    valid: false,
    written: false,
    no_op: false,
    decision_code: decisionCode,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
    ...extra
  };
}

export function createSubmitForReviewResponse(workspaceRepo, assignedUnit, result) {
  const receipt = createCompactWorkRecordEditResponse(workspaceRepo, result);
  return {
    tool: WORKSPACE_SUBMIT_FOR_REVIEW_TOOL_NAME,
    submitted: receipt.written === null
      ? null
      : Boolean(result?.valid) && (receipt.written || Boolean(result?.no_op)),
    assigned_unit: assignedUnit,
    ...receipt
  };
}
