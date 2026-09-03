

import {
  loadToolDiscoveryDescriptor,
  validateToolDiscoveryDescriptor,
  resolveToolTierVisibility
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";
import {
  evaluateAgentToolConformance,
  loadToolDiscoveryManifest
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

const DESCRIPTOR_LOAD_FAILURE_FREE_LOCAL_MCP_TOOL_NAMES = new Set([
  "workspace_tools_list",
  "workspace_tools_describe",
  "workspace_tools_query",
  "workspace_controlled_contract_carrier_create",
  "workspace_controlled_contract_carrier_query",
  "workspace_controlled_contract_carrier_patch",
  "workspace_controlled_contract_authoring_describe",
  "workspace_controlled_vocabulary_query",
  "workspace_controlled_proof_intents_discover",
  "workspace_controlled_proof_packs_select",
  "workspace_controlled_proof_pack_describe",
  "workspace_controlled_proof_pack_bindings_inspect",
  "workspace_controlled_proof_plan_build",
  "workspace_controlled_contract_assess",
  "workspace_controlled_contract_assessment_query",
  "workspace_controlled_contract_integration_test_design_assess",
  "workspace_controlled_contract_integration_test_design_query",
  "workspace_controlled_contract_private_scope_census",
  "workspace_read_mcp_content_reference",
  "get_contract_manifest",
  "workspace_agent_dispatch_identity_contract",
  "workspace_search_repo",
  "workspace_build_search_index",
  "workspace_read_page",
  "workspace_get_record",
  "workspace_validate_dispatch",
  "workspace_generate_and_lint",
  "workspace_lint_repo",
  "workspace_autofix_docs_backlinks",
  "workspace_docs_policy_validate",
  "workspace_agent_faq",
  "workspace_run_validation",
  "workspace_create_record",
  "workspace_work_record_validate",
  "workspace_work_record_set_status",
  "workspace_work_record_set_task",
  "workspace_work_record_set_closure",
  "workspace_work_record_summary",
  "workspace_tool_router_recommend",
  "workspace_work_record_upsert_slice",
  "workspace_work_record_delete_slice",
  "workspace_work_record_set_list_field",
  "workspace_work_record_set_acceptance",
  "workspace_work_record_shape_review_unit",
  "workspace_agent_dispatch",
  "workspace_agent_run_status",
  "workspace_agent_run_wait",
  "workspace_integrate_committed_slice",
  "workspace_runtime_blocker_taxonomy",
  "workspace_coordination_preflight",

  "commit",
  "workspace_submit_for_review",

  "workspace_worker_run_declared_test"
]);

export async function loadMcpToolTierRegistrationPolicy() {
  try {
    const [descriptor, manifest] = await Promise.all([
      loadToolDiscoveryDescriptor(),
      loadToolDiscoveryManifest()
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
      freeLocalToolNames,
      freeLocalFallbackToolNames: null
    };
  } catch (error) {

    if (error?.code !== "ENOENT") {
      structuredLog({
        level: "error",
        event: "tool_registration_conformance_failed",
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    structuredLog({
      level: "warning",
      event: "tool_tier_registration_descriptor_load_failed",
      message:
        "Tool discovery descriptor tier metadata could not be loaded; free/local MCP registration is limited to the safe free/local fallback set.",
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      descriptorLoaded: false,
      descriptorToolNames: DESCRIPTOR_LOAD_FAILURE_FREE_LOCAL_MCP_TOOL_NAMES,
      registrationEligibleToolNames: DESCRIPTOR_LOAD_FAILURE_FREE_LOCAL_MCP_TOOL_NAMES,
      freeLocalToolNames: null,
      freeLocalFallbackToolNames: DESCRIPTOR_LOAD_FAILURE_FREE_LOCAL_MCP_TOOL_NAMES
    };
  }
}

export function trimmed(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function auditToolProfileBucket(toolProfile) {
  if (toolProfile === "agent-safe") return "agent_safe";
  if (toolProfile === "worker") return "worker";
  return "full_profile";
}

function auditCallerKind(toolProfile) {
  return toolProfile === "full" ? "operator" : "agent";
}

function auditSessionKind(toolProfile) {
  return toolProfile === "full" ? "mcp_client" : "role_session";
}

export function createProductionToolUsageAuditOrigin({ toolProfile, dispatchSessionIdentity }) {
  return {
    caller_kind: auditCallerKind(toolProfile),
    session_kind: auditSessionKind(toolProfile),
    tool_profile: auditToolProfileBucket(toolProfile),
    client_origin: dispatchSessionIdentity
  };
}

export function createProductionToolUsageAuditSelectedContext({ workspaceRepos, assignedUnit }) {
  const selected = {};
  if (workspaceRepos?.currentAlias) {
    selected.workspace_repo = workspaceRepos.currentAlias;
  }
  if (assignedUnit) {
    selected.selected_unit = assignedUnit;
  }
  return selected;
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
  return {
    tool: WORKSPACE_SUBMIT_FOR_REVIEW_TOOL_NAME,
    submitted: Boolean(result?.valid) && (Boolean(result?.written) || Boolean(result?.no_op)),
    assigned_unit: assignedUnit,
    ...createCompactWorkRecordEditResponse(workspaceRepo, result)
  };
}
