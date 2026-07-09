import path from "node:path";

import {
  createOrchestratorDispatchSidecarAdapter,
  startOrchestratorDispatchSidecar
} from "./orchestrator-dispatch-sidecar.mjs";
import {
  spawnIsolated
} from "./launch-isolation.mjs";
import {
  createHostWriteAuthorityBrokerClaudePlanLaunch
} from "./workspace-agent-dispatch-claude-executor.mjs";
import {
  createHostWriteAuthorityBrokerAgyPlanLaunch
} from "./workspace-agent-dispatch-agy-executor.mjs";
import {
  createHostWriteAuthorityBrokerPlanLaunch
} from "./workspace-agent-dispatch-codex-executor.mjs";
import {
  CODEX_WIKI_MCP_SERVER_NAME,
  WIKI_MCP_SERVER_PACKAGE_SUBPATH,
  WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR,
  WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR,
  WIKI_MCP_WORKSPACE_DIR_ENV_VAR,
  buildCodexWikiMcpEnvOverride,
  ensureWikiMcpResponseStateDir,
  resolveLauncherConfiguredWorkspaceAlias,
  resolveWikiMcpServerPath,
  selectWikiMcpServerEnv
} from "./codex-role-mcp-env.mjs";
import {
  buildCodexWikiMcpServerOverrides,
  collectCodexSynthesizedWikiMcpReadOnlyRoots,
  detectCodexWikiMcpServerPosture,
  rebuildCodexPlanIsolationWithReadOnlyRoot
} from "./codex-role-wiki-mcp-override.mjs";

export async function maybeStartOrchestratorDispatchSidecar(plan, io = {}) {
  const handle = await startOrchestratorDispatchSidecar({
    plan,
    io,
    adapter: createCodexOrchestratorDispatchSidecarAdapter()
  });
  if (!handle) return null;
  return {
    endpoint: handle.endpoint,
    mcpEnvOverride: handle.applyContext?.mcpEnvOverride ?? null,
    mcpResponseStateDir: handle.applyContext?.mcpResponseStateDir ?? null,
    stop: () => handle.stop()
  };
}

export function createCodexOrchestratorDispatchSidecarAdapter() {
  return createOrchestratorDispatchSidecarAdapter({

    createBrokerPlanLaunch: ({ env, cwd }) =>
      createHostWriteAuthorityBrokerPlanLaunch({ env, cwd }),
    appPlanLaunchBuilders: {
      codex: ({ env, cwd }) => createHostWriteAuthorityBrokerPlanLaunch({ env, cwd }),
      claude: ({ env }) => createHostWriteAuthorityBrokerClaudePlanLaunch({ env }),
      agy: ({ env }) => createHostWriteAuthorityBrokerAgyPlanLaunch({ env })
    },
    spawnLaunch: (bwrapPlan, opts) => spawnIsolated(bwrapPlan, opts),

    applyEndpointToPlan: ({ plan, descriptor, endpointValue, envVar }) => {
      const mcpServerName = typeof descriptor.mcpServerName === "string" && descriptor.mcpServerName.length > 0
        ? descriptor.mcpServerName
        : CODEX_WIKI_MCP_SERVER_NAME;

      const posture = detectCodexWikiMcpServerPosture({
        env: plan.env,
        mcpServerName
      });

      if (posture === "url") {
        return {
          mcpServerPosture: posture,
          mcpEnvOverride: null,
          mcpEnvOverrides: [],
          mcpEnvOverrideSpan: null,
          mcpWorkspaceAliasOverride: null,
          mcpWorkspaceDirOverride: null,
          synthesizedWikiMcpServerPath: null,
          originalIsolation: null
        };
      }

      const workspaceAlias = resolveLauncherConfiguredWorkspaceAlias({
        env: plan.env,
        repo: plan.repo,
        mcpServerName
      });

      const workspaceDir = typeof plan.repo === "string" && plan.repo.length > 0 && path.isAbsolute(plan.repo)
        ? plan.repo
        : null;
      const responseStateDir = ensureWikiMcpResponseStateDir({
        runtimeDir: plan.runtimeDir,
        workspaceDir: plan.repo
      });
      const mcpEnvOverrides = [];

      let synthesizedWikiMcpServerPath = null;
      let originalIsolation = null;
      if (posture === "absent") {
        synthesizedWikiMcpServerPath = resolveWikiMcpServerPath();
        if (!synthesizedWikiMcpServerPath) {
          throw new Error(
            "codex orchestrator wiki MCP override cannot resolve " +
            `${WIKI_MCP_SERVER_PACKAGE_SUBPATH}; @agent-chassis/wiki-mcp must be ` +
            "installed in the launcher package context"
          );
        }
        for (const serverOverride of buildCodexWikiMcpServerOverrides({
          mcpServerName,
          serverPath: synthesizedWikiMcpServerPath,
          repo: plan.repo
        })) {
          mcpEnvOverrides.push(serverOverride);
        }

        originalIsolation = rebuildCodexPlanIsolationWithReadOnlyRoot(
          plan,
          collectCodexSynthesizedWikiMcpReadOnlyRoots(synthesizedWikiMcpServerPath)
        );
      }

      const wikiServerEnv = selectWikiMcpServerEnv({
        workspaceAlias,
        workspaceDir,
        dispatchWorktreeRoot: plan.dispatchWorktreeRoot,
        responseStateDir,
        endpointEnvVar: envVar,
        endpointValue
      });
      let mcpWorkspaceAliasOverride = null;
      let mcpWorkspaceDirOverride = null;
      let mcpResponseStateDirOverride = null;
      let mcpEnvOverride = null;
      for (const [envKey, envValue] of Object.entries(wikiServerEnv)) {
        const override = buildCodexWikiMcpEnvOverride({
          mcpServerName,
          envVar: envKey,
          value: envValue
        });
        if (envKey === WIKI_MCP_WORKSPACE_ALIAS_ENV_VAR) {
          mcpWorkspaceAliasOverride = override;
        } else if (envKey === WIKI_MCP_WORKSPACE_DIR_ENV_VAR) {
          mcpWorkspaceDirOverride = override;
        } else if (envKey === WIKI_MCP_RESPONSE_STATE_DIR_ENV_VAR) {
          mcpResponseStateDirOverride = override;
        } else if (envKey === envVar) {
          mcpEnvOverride = override;
        }
        mcpEnvOverrides.push(override);
      }

      const insertionIndex = Array.isArray(plan.args)
        ? (plan.args.length > 0 ? plan.args.length - 1 : 0)
        : 0;
      if (Array.isArray(plan.args)) {
        for (const override of [...mcpEnvOverrides].reverse()) {
          plan.args.splice(insertionIndex, 0, "-c", override);
        }
      }
      return {
        mcpServerPosture: posture,
        mcpEnvOverride,
        mcpEnvOverrides,
        mcpEnvOverrideSpan: Array.isArray(plan.args)
          ? { start: insertionIndex, length: mcpEnvOverrides.length * 2 }
          : null,
        mcpWorkspaceAliasOverride,
        mcpWorkspaceDirOverride,
        mcpResponseStateDirOverride,
        mcpResponseStateDir: responseStateDir,
        synthesizedWikiMcpServerPath,
        originalIsolation
      };
    },
    removeEndpointFromPlan: ({ plan, applyContext }) => {

      if (applyContext?.originalIsolation && plan && typeof plan === "object") {
        plan.isolation = applyContext.originalIsolation;
      }
      if (!Array.isArray(plan.args)) return;
      const span = applyContext?.mcpEnvOverrideSpan;
      if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.length) || span.length <= 0) {
        return;
      }
      if (span.start < 0 || span.start + span.length > plan.args.length) return;
      plan.args.splice(span.start, span.length);
    }
  });
}
