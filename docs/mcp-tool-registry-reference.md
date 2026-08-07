
# MCP Tool Registry Reference

Agent-facing MCP tool and resource reference for
[MCP Integration](mcp-integration.md).

## Available MCP Tools

The `full` profile list follows the registered MCP tool set. The `agent-safe`
profile list is the registered set filtered through the `agent-safe` profile
source in `packages/wiki-mcp/src/lib/tool-profile.mjs`.

The default `full` profile exposes:

- `workspace_read_mcp_content_reference`
- `workspace_tools_list`
- `workspace_tools_describe`
- `workspace_tools_query`
- `workspace_agent_dispatch_identity_contract`
- `workspace_agent_dispatch`
- `workspace_agent_run_status`
- `workspace_agent_run_wait`
- `workspace_runtime_blocker_taxonomy`
- `workspace_node_engine_admission_runtime_diagnostic`
- `workspace_coordination_preflight`
- `get_contract_manifest`
- `bootstrap_repo`
- `sync_contract`
- `allocate_id`
- `create_record`
- `read_page`
- `workspace_read_page`
- `get_record`
- `workspace_get_record`
- `workspace_create_record`
- `lint_repo`
- `generate_views`
- `generate_and_lint`
- `build_search_index`
- `search_repo`
- `workspace_search_repo`
- `workspace_build_search_index`
- `sidecar_build`
- `workspace_sidecar_build`
- `workspace_code_index_build`
- `sidecar_rebuild`
- `workspace_sidecar_rebuild`
- `workspace_code_index_rebuild`
- `sidecar_status`
- `workspace_sidecar_status`
- `workspace_code_index_status`
- `sidecar_impact_paths`
- `workspace_sidecar_impact_paths`
- `workspace_code_index_impact_paths`
- `workspace_code_index_graph_impact_paths`
- `workspace_code_index_graph_impact_diff`
- `workspace_code_index_find_references`
- `workspace_code_index_definition`
- `sidecar_context_for_path`
- `workspace_sidecar_context_for_path`
- `workspace_code_index_context_for_path`
- `workspace_docs_policy_validate`
- `workspace_work_record_summary`
- `workspace_work_record_validate`
- `workspace_preflight_dispatch`
- `workspace_validate_dispatch`
- `workspace_run_validation`
- `workspace_initiative_status`
- `workspace_agent_faq`
- `workspace_submit_for_review`
- `workspace_work_record_set_status`
- `workspace_work_record_set_task`
- `workspace_work_record_set_closure`
- `workspace_work_record_upsert_slice`
- `workspace_work_record_delete_slice`
- `workspace_work_record_set_list_field`
- `workspace_work_record_set_acceptance`
- `workspace_work_record_shape_review_unit`
- `workspace_work_record_refresh_admission_metrics`
- `workspace_work_record_refresh_target_resolution_evidence`
- `workspace_work_record_cleanup_derived_evidence`
- `workspace_record_graph_impact_evidence`
- `workspace_record_review_attestation`
- `workspace_record_review_result_evidence`
- `workspace_generate_and_lint`
- `workspace_lint_repo`
- `workspace_autofix_docs_backlinks`

**Operator/setup authority.** `bootstrap_repo` (new-repo enrollment) is an operator setup action, not routine agent workflow. Agent clients use the `agent-safe` profile, which excludes it.

The `agent-safe` profile exposes only:

- `workspace_read_mcp_content_reference`
- `workspace_tools_list`
- `workspace_tools_describe`
- `workspace_tools_query`
- `workspace_agent_dispatch_identity_contract`
- `workspace_agent_dispatch`
- `workspace_agent_run_status`
- `workspace_agent_run_wait`
- `workspace_runtime_blocker_taxonomy`
- `workspace_node_engine_admission_runtime_diagnostic`
- `workspace_coordination_preflight`
- `get_contract_manifest`
- `workspace_read_page`
- `workspace_get_record`
- `workspace_create_record`
- `workspace_search_repo`
- `workspace_build_search_index`
- `workspace_code_index_build`
- `workspace_code_index_rebuild`
- `workspace_code_index_status`
- `workspace_code_index_impact_paths`
- `workspace_code_index_graph_impact_paths`
- `workspace_code_index_graph_impact_diff`
- `workspace_code_index_context_for_path`
- `workspace_docs_policy_validate`
- `workspace_work_record_summary`
- `workspace_work_record_validate`
- `workspace_preflight_dispatch`
- `workspace_validate_dispatch`
- `workspace_run_validation`
- `workspace_agent_faq`
- `workspace_work_record_set_status`
- `workspace_work_record_set_task`
- `workspace_work_record_set_closure`
- `workspace_work_record_upsert_slice`
- `workspace_work_record_delete_slice`
- `workspace_work_record_set_list_field`
- `workspace_work_record_set_acceptance`
- `workspace_work_record_shape_review_unit`
- `workspace_work_record_refresh_admission_metrics`
- `workspace_work_record_refresh_target_resolution_evidence`
- `workspace_work_record_cleanup_derived_evidence`
- `workspace_record_graph_impact_evidence`
- `workspace_record_review_attestation`
- `workspace_record_review_result_evidence`
- `workspace_generate_and_lint`
- `workspace_lint_repo`
- `workspace_autofix_docs_backlinks`

## Available MCP Resources

- `contract://manifest`
- `contract://schema`
- `contract://conventions`
- `contract://taxonomy`
- `contract://query`
- `contract://lint`
- `contract://templates/issue`
- `contract://templates/initiative`
- `contract://templates/decision`
- `contract://templates/source`
- `contract://templates/area`

Resources are useful for agents that want to inspect the shared contract before mutating a repo.

Important ownership rule:

- `sync_contract` must not clobber consumer-owned `wiki/schema.md`, `wiki/conventions.md`, or `wiki/index.md`
- those files are locally owned once present
- the shared tooling only bootstraps them when missing
