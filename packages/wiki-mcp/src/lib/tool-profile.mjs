

import { resolveClientConfig } from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";

const TOOL_PROFILE_FULL = "full";
const TOOL_PROFILE_AGENT_SAFE = "agent-safe";
const TOOL_PROFILE_WORKER = "worker";

export const REGISTERED_TIER_FREE_LOCAL = "free_local";
export const REGISTERED_TIER_PAID_CCE = "paid_cce";

const AGENT_SAFE_TOOL_NAMES = new Set([
  "workspace_record_review_result_evidence",
  "get_contract_manifest",
  "workspace_build_search_index",
  "workspace_search_repo",
  "workspace_read_page",
  "workspace_get_record",
  "workspace_create_record",
  "workspace_code_index_status",
  "workspace_code_index_build",
  "workspace_code_index_rebuild",
  "workspace_code_index_impact_paths",
  "workspace_code_index_graph_impact_diff",
  "workspace_code_index_graph_impact_paths",
  "workspace_code_index_context_for_path",
  "workspace_tools_list",
  "workspace_tools_describe",
  "workspace_tools_query",
  "workspace_read_mcp_content_reference",
  "workspace_agent_dispatch_identity_contract",
  "workspace_agent_dispatch",
  "workspace_agent_run_status",
  "workspace_agent_run_wait",
  "workspace_node_engine_admission_runtime_diagnostic",
  "workspace_coordination_preflight",
  "workspace_runtime_blocker_taxonomy",
  "workspace_work_record_validate",
  "workspace_validate_dispatch",
  "workspace_run_validation",
  "workspace_work_record_set_status",
  "workspace_work_record_set_task",
  "workspace_work_record_set_closure",
  "workspace_work_record_upsert_slice",
  "workspace_work_record_delete_slice",
  "workspace_work_record_set_list_field",
  "workspace_work_record_set_acceptance",
  "workspace_work_record_shape_review_unit",
  "workspace_work_record_refresh_admission_metrics",
  "workspace_work_record_refresh_target_resolution_evidence",
  "workspace_work_record_cleanup_derived_evidence",
  "workspace_record_graph_impact_evidence",
  "workspace_record_review_attestation",
  "workspace_generate_and_lint",
  "workspace_lint_repo",
  "workspace_autofix_docs_backlinks",
  "workspace_docs_policy_validate",
  "workspace_work_record_summary",
  "workspace_agent_faq"
]);

const WORKER_TOOL_NAMES = new Set([
  "get_contract_manifest",
  "workspace_search_repo",
  "workspace_read_page",
  "workspace_get_record",
  "workspace_code_index_status",
  "workspace_code_index_impact_paths",
  "workspace_code_index_graph_impact_diff",
  "workspace_code_index_graph_impact_paths",
  "workspace_code_index_context_for_path",
  "workspace_tools_list",
  "workspace_tools_describe",
  "workspace_tools_query",
  "workspace_read_mcp_content_reference",
  "workspace_agent_dispatch_identity_contract",
  "workspace_node_engine_admission_runtime_diagnostic",
  "workspace_runtime_blocker_taxonomy",
  "workspace_docs_policy_validate",
  "workspace_work_record_validate",
  "workspace_validate_dispatch",
  "workspace_work_record_summary",
  "workspace_agent_faq",
  "workspace_submit_for_review"
]);

export function parseToolProfile(env = process.env) {
  const profile = String(env.WIKI_MCP_TOOL_PROFILE || TOOL_PROFILE_FULL).trim();
  if (!profile || profile === TOOL_PROFILE_FULL) {
    return TOOL_PROFILE_FULL;
  }
  if (profile === TOOL_PROFILE_AGENT_SAFE) {
    return TOOL_PROFILE_AGENT_SAFE;
  }
  if (profile === TOOL_PROFILE_WORKER) {
    return TOOL_PROFILE_WORKER;
  }
  throw new Error(
    `Unsupported WIKI_MCP_TOOL_PROFILE: ${profile}. Expected ${TOOL_PROFILE_FULL}, ${TOOL_PROFILE_AGENT_SAFE}, or ${TOOL_PROFILE_WORKER}.`
  );
}

export function shouldExposeTool(toolProfile, name) {
  if (toolProfile === TOOL_PROFILE_FULL) {
    return true;
  }
  if (toolProfile === TOOL_PROFILE_AGENT_SAFE) {
    return AGENT_SAFE_TOOL_NAMES.has(name);
  }
  if (toolProfile === TOOL_PROFILE_WORKER) {
    return WORKER_TOOL_NAMES.has(name);
  }
  return false;
}

export function resolveRegisteredTier(env = process.env) {
  try {
    const config = resolveClientConfig(env);
    return config && config.apiKey ? REGISTERED_TIER_PAID_CCE : REGISTERED_TIER_FREE_LOCAL;
  } catch {
    return REGISTERED_TIER_FREE_LOCAL;
  }
}

export function isToolTierRegistrable(registeredTier, name, paidOnlyToolNames) {
  if (registeredTier === REGISTERED_TIER_PAID_CCE) {
    return true;
  }
  return !(paidOnlyToolNames instanceof Set && paidOnlyToolNames.has(name));
}
