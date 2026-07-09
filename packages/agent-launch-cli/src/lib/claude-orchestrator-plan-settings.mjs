import path from "node:path";

import { getLauncherProfile } from "./agent-launch-profiles.mjs";
import { loadRepoProfileLocalConfig } from "./agent-launch-repo-profile-config.mjs";
import {
  WIKI_MCP_TOOL_PROFILE_ENV_VAR,
  buildWikiMcpServerNodeCommand,
  selectWikiMcpServerEnv
} from "./codex-role-mcp-env.mjs";
import { HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR } from "./host-write-authority-substrate.mjs";
import { buildOrchestratorSettings } from "./orchestrator-launch-settings.mjs";

export const CLAUDE_ORCHESTRATOR_MCP_CONFIG_SCHEMA_VERSION =
  "claude-orchestrator-mcp-config.v1";

export const CLAUDE_ORCHESTRATOR_HEADLESS_MODE = "orchestrator-headless";

const CLAUDE_ORCHESTRATOR_WIKI_MCP_ALLOW_TOOL_NAMES = Object.freeze([
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

export const CLAUDE_ORCHESTRATOR_HEADLESS_COORDINATION_EDIT_ALLOW = Object.freeze([
  "Edit(docs/**)",
  "Edit(wiki/**)"
]);

export const CLAUDE_ORCHESTRATOR_HEADLESS_DENY_TOOLS = Object.freeze([
  "Bash",
  "WebFetch",
  "WebSearch",
  "Task",
  "Agent",
  "Workflow",
  "Skill",
  "Monitor"
]);

const CLAUDE_ORCHESTRATOR_WORKSPACE_ALIAS_PATTERN =
  /^[A-Za-z0-9._-]+$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function isValidClaudeOrchestratorWorkspaceAlias(value) {
  return isNonEmptyString(value) && CLAUDE_ORCHESTRATOR_WORKSPACE_ALIAS_PATTERN.test(value);
}

export function buildClaudeOrchestratorHeadlessPermissionSettings() {
  const allow = [
    ...CLAUDE_ORCHESTRATOR_WIKI_MCP_ALLOW_TOOL_NAMES.map((name) => `mcp__wiki__${name}`),
    ...CLAUDE_ORCHESTRATOR_HEADLESS_COORDINATION_EDIT_ALLOW
  ];
  return {
    permissions: {
      allow,
      deny: [...CLAUDE_ORCHESTRATOR_HEADLESS_DENY_TOOLS],
      disableBypassPermissionsMode: "disable"
    }
  };
}

export function resolveClaudeOrchestratorLocalSettings({
  repo,
  initiative,
  resolvedProfile,
  localConfigRefusalReason,
  stateDirName
}) {
  const localConfig = loadRepoProfileLocalConfig(repo);
  if (localConfig.refused) {
    return {
      refusal: {
        code: localConfigRefusalReason,
        message: "repo-local Claude orchestrator config refused",
        detail: {
          refusal_reason: localConfig.refusal_reason,
          diagnostics: localConfig.diagnostics
        }
      }
    };
  }

  const launcherProfile = isNonEmptyString(resolvedProfile?.profile_name)
    ? getLauncherProfile(resolvedProfile.profile_name)
    : null;
  const profileModel = isNonEmptyString(resolvedProfile?.model)
    ? resolvedProfile.model
    : isNonEmptyString(resolvedProfile?.default_model)
      ? resolvedProfile.default_model
      : null;
  const profileEffort = isNonEmptyString(launcherProfile?.planner_default_effort)
    ? launcherProfile.planner_default_effort
    : isNonEmptyString(resolvedProfile?.default_effort)
      ? resolvedProfile.default_effort
      : "default";

  const sharedSettings = buildOrchestratorSettings({
    appLabel: "Claude",
    env: {
      ORCHESTRATOR_EFFORT: localConfig.values.ORCHESTRATOR_EFFORT
    },
    localEffortKey: "ORCHESTRATOR_EFFORT",
    profile: {
      model: profileModel,
      effort: profileEffort
    },
    profileEffortKey: "effort",
    profileModelKey: "model",
    repoName: path.basename(repo),
    roleLabel: "orchestrator",
    stateDirName,
    subject: initiative
  });

  return {
    localConfig,
    settings: {
      model: sharedSettings.model ?? null,
      model_source: isNonEmptyString(resolvedProfile?.model_source)
        ? resolvedProfile.model_source
        : "profile_default",
      effort: sharedSettings.effort ?? profileEffort,
      effort_source: sharedSettings.effortSource === "local"
        ? "repo_local_config"
        : isNonEmptyString(launcherProfile?.planner_default_effort_source)
          ? launcherProfile.planner_default_effort_source
          : "profile_default",
      threadName: sharedSettings.threadName,
      thread_suffix: localConfig.normalized_thread_suffix
    }
  };
}

export function buildClaudeOrchestratorMcpConfig({
  repo,
  mcpServerPath,
  workspaceAlias,
  workspaceDir,
  dispatchWorktreeRoot = null,
  responseStateDir,
  endpointValue = null,
  initiative,
  threadName,
  model,
  effort
} = {}) {
  const wikiServerCommand = buildWikiMcpServerNodeCommand({ repo, serverPath: mcpServerPath });
  const env = selectWikiMcpServerEnv({
    workspaceAlias: isValidClaudeOrchestratorWorkspaceAlias(workspaceAlias)
      ? workspaceAlias
      : null,
    workspaceDir,
    dispatchWorktreeRoot,
    responseStateDir,
    endpointEnvVar: HOST_WRITE_AUTHORITY_SIDECAR_ENDPOINT_ENV_VAR,
    endpointValue
  });
  env[WIKI_MCP_TOOL_PROFILE_ENV_VAR] = "agent-safe";

  return {
    schema_version: CLAUDE_ORCHESTRATOR_MCP_CONFIG_SCHEMA_VERSION,
    orchestrator: {
      app: "claude",
      initiative,
      thread_name: threadName,
      repo,
      model,
      effort
    },
    mcpServers: {
      wiki: {
        command: wikiServerCommand.command,
        args: wikiServerCommand.args,
        env
      }
    }
  };
}
