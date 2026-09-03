import path from "node:path";

import { resolveModelRuntime } from "./agent-launch-model-registry.mjs";
import { loadRepoProfileLocalConfig } from "./agent-launch-repo-profile-config.mjs";
import { buildOrchestratorSettings } from "./orchestrator-launch-settings.mjs";
import { buildClaudeMcpPermissionEntries } from "./workspace-agent-claude-launch-support.mjs";

export const CLAUDE_ORCHESTRATOR_MCP_CONFIG_SCHEMA_VERSION =
  "claude-orchestrator-mcp-config.v1";

export const CLAUDE_ORCHESTRATOR_HEADLESS_MODE = "orchestrator-headless";

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

export function buildClaudeOrchestratorHeadlessPermissionSettings({
  mcpToolNames = []
} = {}) {
  const allow = [
    ...buildClaudeMcpPermissionEntries(mcpToolNames),
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

  const profileModel = isNonEmptyString(resolvedProfile?.model)
    ? resolvedProfile.model
    : null;
  if (profileModel === null) {
    return {
      refusal: {
        code: "orchestrator_model_unset",
        message: "orchestrator_model_unset: Claude orchestrator launch settings require an explicitly selected model",
        detail: {
          role: "orchestrator",
          model: null
        }
      }
    };
  }

  const modelRuntime = resolveModelRuntime(profileModel);
  if (!modelRuntime) {
    return {
      refusal: {
        code: "orchestrator_model_unknown",
        message: `orchestrator_model_unknown: model ${JSON.stringify(profileModel)} is not registered`,
        detail: {
          role: "orchestrator",
          model: profileModel
        }
      }
    };
  }
  if (modelRuntime.app !== "claude") {
    return {
      refusal: {
        code: "profile_app_model_mismatch",
        message: `Claude orchestrator settings cannot use model ${JSON.stringify(profileModel)} from app ${modelRuntime.app}`,
        detail: {
          role: "orchestrator",
          app: modelRuntime.app,
          model: profileModel
        }
      }
    };
  }

  const profileEffort = isNonEmptyString(resolvedProfile?.effort)
    ? resolvedProfile.effort
    : isNonEmptyString(resolvedProfile?.default_effort)
      ? resolvedProfile.default_effort
      : modelRuntime.default_effort;

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
        : "resolved_profile",
      effort: sharedSettings.effort ?? profileEffort,
      effort_source: sharedSettings.effortSource === "local"
        ? "repo_local_config"
        : isNonEmptyString(resolvedProfile?.effort_source)
          ? resolvedProfile.effort_source
          : isNonEmptyString(resolvedProfile?.default_effort_source)
            ? resolvedProfile.default_effort_source
            : "model_registry_default",
      threadName: sharedSettings.threadName,
      thread_suffix: localConfig.normalized_thread_suffix
    }
  };
}

export function buildClaudeOrchestratorMcpConfig({
  repo,
  relayRegistration = null,
  workspaceAlias,
  workspaceDir,
  dispatchWorktreeRoot = null,
  responseStateDir,
  initiative,
  threadName,
  model,
  effort
} = {}) {
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
    mcpServers: relayRegistration === null ? {} : {
      wiki: {
        command: relayRegistration.command,
        args: [...relayRegistration.args],
        env: {}
      }
    }
  };
}
