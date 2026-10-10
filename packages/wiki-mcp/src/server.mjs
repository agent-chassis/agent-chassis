#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createLauncherObservingTransport, createLauncherReadinessEventWriter,
  LAUNCHER_READINESS_PROTOCOL_GENERATION, LAUNCHER_READINESS_SCHEMA_VERSIONS } from "./lib/launcher-readiness-observer.mjs";
import { z } from "zod";
import { writeFileSync } from "node:fs";
import { readContractFile } from "../../wiki-core/src/index.mjs";
import { parseWorkspaceRepos, resolveWorkspaceRepo } from "./lib/workspace-repo-resolution.mjs";
import { jsonContent, errorContent, createDiagnosticSink, createStdioShutdownController,
  installProcessErrorGuards } from "./lib/mcp-response.mjs";
import { parseToolProfile, resolveRegisteredTier } from "./lib/tool-profile.mjs";
import { createRegisterTool } from "./lib/register-tool.mjs";
import { consumeLauncherNoCceAuthorityCapability } from "./lib/launcher-no-cce-authority.mjs";
import { isDirectModuleEntry } from "./lib/direct-entry.mjs";
import { loadMcpToolTierRegistrationPolicy, structuredLog } from "./lib/server-composition-helpers.mjs";
import { createCompactValidateDispatchResponse } from "./lib/work-record-write-route-helpers.mjs";
import { registerCodeIndexTools } from "./lib/code-index-tools.mjs";
import { registerStaticResources } from "./lib/static-resources.mjs";
import { registerWorkRecordReadTools } from "./lib/work-record-read-tools.mjs";
import { registerIntegrationPromoteCheckTools } from "./lib/integration-promote-check-tools.mjs";
import { createToolUsageAuditBoundaryRecorder } from "./lib/tool-usage-audit-mcp-tools.mjs";
import { createMetricsLogWriter } from "./lib/tool-usage-audit/metrics-log-writer.mjs";
import { resolveMcpMetricsConfig } from "../../agent-launch-cli/src/lib/mcp-metrics-config.mjs";
import { bindPackageDocsCarrier } from "./lib/tool-doc-read-tools.mjs";
import { registerRunTestTool } from "./lib/run-test-tool.mjs";
import { bindSpawnedPackageDocsCarrierFromLauncher } from "../../agent-launch-cli/src/lib/wiki-mcp-host-server.mjs";
import { registerWikiCoreTools } from "./lib/wiki-core-tools.mjs";
import { registerFrozenReviewContractTools } from "./lib/frozen-review-contract-tools.mjs";
import { buildDispatchRuntime } from "./lib/dispatch-launch-runtime.mjs";
import { registerAgentTaskTools } from "./lib/register-agent-task-tools.mjs";
import { proofExecutionTestCompositionDeps } from "./lib/proof-execution-test-composition.mjs";
import { bootstrapWikiMcpNodeEngineEnv } from "./lib/node-engine-env-bootstrap.mjs";

const SERVER_VERSION = "0.2.0";
const WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME = "workspace_work_record_set_status";

const diagnosticSink = createDiagnosticSink();
const shutdownController = createStdioShutdownController({
  disableDiagnostics: () => diagnosticSink.disable()
});

installProcessErrorGuards({
  log: structuredLog,
  diagnostics: diagnosticSink,
  requestShutdown: (code) => shutdownController.requestShutdown(code)
});

const emptySchema = z.object({});
const extensionNamespacesSchema = z.array(z.string()).optional();

async function registerTools(server, {
  packageDocsCarrier = null,
  launcherNoCceAuthorityCapability = null,
  dispatchRuntimeTestComposition = null,
  proofExecutionTestComposition = null,
  metricsWriter = null
} = {}) {
  const workspaceRepos = await parseWorkspaceRepos();
  const toolProfile = parseToolProfile();

  const boundPackageDocsCarrier = await bindPackageDocsCarrier(packageDocsCarrier);

  const registeredTier = resolveRegisteredTier(process.env);
  const mcpToolTierRegistrationPolicy = await loadMcpToolTierRegistrationPolicy();
  const registeredToolNames = new Set();

  const {
    dispatchBackend,
    dispatchSessionIdentity,
    wkForgeHandoffAdapter,
    wkLandingStatusAdapter
  } =
    buildDispatchRuntime(process.env, {
      testComposition: dispatchRuntimeTestComposition,
      registeredTier,
      workspace: resolveWorkspaceRepo(workspaceRepos)
    });

  const toolUsageAuditBoundary = createToolUsageAuditBoundaryRecorder({ writer: metricsWriter });

  const registerTool = createRegisterTool({
    server,
    toolProfile,
    registeredTier,
    mcpToolTierRegistrationPolicy,
    toolUsageAuditBoundary,
    registeredToolNames,
    structuredLog,

    responseEnv: process.env
  });

  registerAgentTaskTools({ registerTool, workspaceRepos, resolveWorkspaceRepo,
    jsonContent, errorContent, sessionRole: toolProfile, sessionEnv: process.env,
    responseEnv: process.env, registeredTier, dispatchBackend, dispatchSessionIdentity,
    wkForgeHandoffAdapter, wkLandingStatusAdapter, launcherNoCceAuthorityCapability,
    registeredToolNames, docsCarrier: boundPackageDocsCarrier,
    verifyProofDeps: proofExecutionTestCompositionDeps(proofExecutionTestComposition) });
  registerRunTestTool({ registerTool, z, jsonContent, errorContent, workspaceRepos,
    resolveWorkspaceRepo, env: process.env, responseEnv: process.env });
  registerCodeIndexTools({ registerTool, workspaceRepos, jsonContent, errorContent });

  registerWikiCoreTools({ registerTool, workspaceRepos, z, emptySchema,
    extensionNamespacesSchema, jsonContent, errorContent, resolveWorkspaceRepo,
    section: "operator" });
  registerFrozenReviewContractTools({ registerTool, z });
  registerIntegrationPromoteCheckTools({ registerTool, workspaceRepos, z,
    jsonContent, errorContent, resolveWorkspaceRepo });
  registerWorkRecordReadTools({ registerTool, workspaceRepos, z, jsonContent,
    errorContent, resolveWorkspaceRepo, createCompactValidateDispatchResponse,
    registeredTier });
  return Object.freeze({
    toolProfile,
    registeredTier,
    tools: Object.freeze([...registeredToolNames].sort())
  });
}

export const WIKI_MCP_SERVER_INSTRUCTIONS = [
  "This server provides repository coordination: wiki records, decisions, docs, proof contracts, and agent dispatch.",
  "Call a known registered operation directly.",
  "Use the task operations exposed by tools/list. Read compact context with workspace_read_wiki, then follow returned semantic selections.",
  "Follow the exact returned next_calls through their registered task operations.",
  "Load a full input schema only for the operation you will call, and use the tool names this session actually exposes.",
  "App or plugin catalogs and MCP resource lists are not repository tool discovery.",
  "An entrypoint missing from this session is a session-access limitation; this notice does not establish registration or override role restrictions."
].join(" ");

export async function startWikiMcpServer({
  packageDocsCarrier = null,
  launcherNoCceAuthorityCapability = null,
  dispatchRuntimeTestComposition = null,
  proofExecutionTestComposition = null
} = {}) {

  const effectivePackageDocsCarrier = bindSpawnedPackageDocsCarrierFromLauncher({
    packageDocsCarrier
  });

  const nodeEngineEnvBootstrap = bootstrapWikiMcpNodeEngineEnv({ env: process.env });
  structuredLog({
    level: "info",
    message: "wiki-mcp node engine env bootstrap",
    ...nodeEngineEnvBootstrap
  });

  const metricsConfig = resolveMcpMetricsConfig(process.env);
  if (metricsConfig.state === "unavailable") {
    structuredLog({
      level: "warning",
      event: "anonymous_mcp_metrics",
      reason: "invalid_config",
      config_reason: metricsConfig.reason
    });
  }
  const metricsWriter = metricsConfig.state === "enabled"
    ? createMetricsLogWriter({
        root: metricsConfig.root,
        emitDiagnostic: (entry) => structuredLog({ level: "warning", ...entry })
      })
    : null;

  const server = new McpServer({
    name: "@agent-chassis/wiki-mcp",
    version: SERVER_VERSION
  }, { instructions: WIKI_MCP_SERVER_INSTRUCTIONS });

  const registration = await registerTools(server, {
    packageDocsCarrier: effectivePackageDocsCarrier,
    launcherNoCceAuthorityCapability,
    dispatchRuntimeTestComposition,
    proofExecutionTestComposition,
    metricsWriter
  });
  registerStaticResources(server, { readContractFile, jsonContent, errorContent });

  const launcherReadyFd = Number.parseInt(
    String(process.env.WIKI_MCP_LAUNCHER_READY_FD ?? ""),
    10
  );

  const launcherEventWriter = createLauncherReadinessEventWriter({
    write: (event) => {
      if (Number.isInteger(launcherReadyFd) && launcherReadyFd >= 3) {
        writeFileSync(launcherReadyFd, `${JSON.stringify(event)}\n`);
      }
    },
    onFailure: async (failure) => {
      structuredLog({
        level: "error",
        message: "wiki-mcp launcher readiness channel failed",
        code: failure.code,
        ...failure.detail
      });

      shutdownController.requestShutdown(1);
    },

    onCleanupTimeout: () => { shutdownController.requestShutdown(1); }
  });
  const writeLauncherEvent = (event) => { launcherEventWriter.emit(event); };

  const transport = createLauncherObservingTransport(
    new StdioServerTransport(process.stdin, process.stdout),
    { emit: writeLauncherEvent }
  );

  structuredLog({
    level: "info",
    message: "Portfolio wiki MCP server starting",
    version: SERVER_VERSION
  });

  await server.connect(transport);
  transport.assertObservationInstalled();

  shutdownController.setServerCloseHook(async () => {
    try {
      await server.close();
    } finally {
      if (metricsWriter !== null) await metricsWriter.close();
    }
  });

  writeLauncherEvent({
    schema_version: LAUNCHER_READINESS_SCHEMA_VERSIONS.SERVER_READY,
    lifecycle_protocol_generation: LAUNCHER_READINESS_PROTOCOL_GENERATION,
    ready: true,
    tool_profile: registration.toolProfile,
    registered_tier: registration.registeredTier,
    tools: registration.tools
  });

  structuredLog({
    level: "info",
    message: "Portfolio wiki MCP server connected via stdio"
  });
}

if (isDirectModuleEntry(import.meta.url)) {
  const launcherNoCceAuthorityCapability = consumeLauncherNoCceAuthorityCapability();
  startWikiMcpServer({ launcherNoCceAuthorityCapability }).catch((error) => {
    structuredLog({
      level: "error",
      message: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  });
}
