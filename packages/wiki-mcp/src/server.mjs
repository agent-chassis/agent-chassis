#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createLauncherObservingTransport,
  createLauncherReadinessEventWriter,
  LAUNCHER_READINESS_PROTOCOL_GENERATION,
  LAUNCHER_READINESS_SCHEMA_VERSIONS
} from "./lib/launcher-readiness-observer.mjs";
import { z } from "zod";
import { writeFileSync } from "node:fs";
import {
  readContractFile,
  setWorkRecordStatusByUnit,
  WORK_RECORD_STATUS_VALUES
} from "../../wiki-core/src/index.mjs";
import {
  parseWorkspaceRepos,
  resolveWorkspaceRepo
} from "./lib/workspace-repo-resolution.mjs";

import {
  jsonContent,
  errorContent,
  createDiagnosticSink,
  createStdioShutdownController,
  installProcessErrorGuards
} from "./lib/mcp-response.mjs";
import {
  parseToolProfile,
  resolveRegisteredTier
} from "./lib/tool-profile.mjs";

import { createRegisterTool } from "./lib/register-tool.mjs";
import {
  consumeLauncherNoCceAuthorityCapability
} from "./lib/launcher-no-cce-authority.mjs";

import { isDirectModuleEntry } from "./lib/direct-entry.mjs";

import {
  augmentWorkspaceToolDiscoveryDescriptor,
  loadMcpToolTierRegistrationPolicy,
  structuredLog
} from "./lib/server-composition-helpers.mjs";

import { registerMcpContentReferenceTools } from "./lib/mcp-content-reference-tools.mjs";
import { registerToolRouterTools } from "./lib/tool-router-tools.mjs";
import { registerInitiativeStatusTools } from "./lib/initiative-status-tools.mjs";
import { registerSubmitForReviewTools } from "./lib/submit-for-review-tools.mjs";
import {
  shapeWriteResponse,
  createCompactWorkRecordEditResponse,
  createCompactContractEditResponse,
  createCompactValidateDispatchResponse,
  validateOptionalExpectedSourceDigest,
  runWorkspaceWorkRecordAdmissionRefreshRoute,
  WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME,
  WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME
} from "./lib/work-record-write-route-helpers.mjs";

import {
  createGraphImpactToolResponse,
  registerCodeIndexTools
} from "./lib/code-index-tools.mjs";

import { registerGraphImpactPersistenceTools } from "./lib/graph-impact-persistence-tools.mjs";

import { registerStaticResources } from "./lib/static-resources.mjs";

import { registerWorkRecordReadTools } from "./lib/work-record-read-tools.mjs";
import { registerIntegrationStatusTools } from "./lib/integration-status-tools.mjs";
import { registerIntegrationPromoteCheckTools } from "./lib/integration-promote-check-tools.mjs";

import { registerAuthoringErgonomicsTools } from "./lib/authoring-ergonomics-tools.mjs";

import { createToolUsageAuditBoundaryRecorder } from "./lib/tool-usage-audit-mcp-tools.mjs";
import { createMetricsLogWriter } from "./lib/tool-usage-audit/metrics-log-writer.mjs";
import { resolveMcpMetricsConfig } from "../../agent-launch-cli/src/lib/mcp-metrics-config.mjs";

import { registerToolDiscoveryTools } from "./lib/tool-discovery-tools.mjs";

import {
  bindPackageDocsCarrier,
  registerToolDocReadTools,
  toDocumentationProjectionCarrier
} from "./lib/tool-doc-read-tools.mjs";

import { registerControlledContractTools } from "./lib/controlled-contract-tools.mjs";
import {
  persistControlledContractGeneration,
  resolveControlledContractGenerationBinding
} from "../../agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs";
import {
  bindSpawnedPackageDocsCarrierFromLauncher
} from "../../agent-launch-cli/src/lib/wiki-mcp-host-server.mjs";

import { createWorkspaceReadRepoResolver, registerWikiCoreTools } from "./lib/wiki-core-tools.mjs";

import { registerWorkRecordWriteTools } from "./lib/work-record-write-tools.mjs";
import { registerWorkRecordEntryTools } from "./lib/work-record-entry-tools.mjs";
import { registerKindRecordWriteTools } from "./lib/kind-record-write-tools.mjs";
import { registerWorkspaceCommitTool } from "./lib/workspace-commit-tool.mjs";

import { registerFrozenReviewContractTools } from "./lib/frozen-review-contract-tools.mjs";

import { registerDispatchTools } from "./lib/dispatch-tools.mjs";

import { buildDispatchRuntime } from "./lib/dispatch-launch-runtime.mjs";

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
    wkForgeHandoffAdapter
  } =
    buildDispatchRuntime(process.env, {
      testComposition: dispatchRuntimeTestComposition,
      registeredTier,
      workspaceRepos,
      resolveWorkspaceRepo
    });

  const toolUsageAuditBoundary = createToolUsageAuditBoundaryRecorder({ writer: metricsWriter });

  const registerTool = createRegisterTool({
    server,
    toolProfile,
    registeredTier,
    mcpToolTierRegistrationPolicy,
    toolUsageAuditBoundary,
    registeredToolNames,
    structuredLog
  });

  registerMcpContentReferenceTools({ registerTool, z, jsonContent, errorContent });

  registerToolDiscoveryTools({
    registerTool,
    jsonContent,
    errorContent,
    augmentDescriptor: augmentWorkspaceToolDiscoveryDescriptor,

    registeredTier,

    docsCarrier: toDocumentationProjectionCarrier(boundPackageDocsCarrier)
  });

  registerToolDocReadTools({
    registerTool,
    z,
    jsonContent,
    errorContent,
    docsCarrier: boundPackageDocsCarrier,
    sessionRole: toolProfile,
    registeredTier,
    augmentDescriptor: augmentWorkspaceToolDiscoveryDescriptor
  });

  registerControlledContractTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    resolveControlledContractGenerationBinding,
    persistControlledContractGeneration
  });

  registerDispatchTools({
    registerTool,
    registeredToolNames,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity,
    launcherNoCceAuthorityCapability,

    wkForgeHandoffAdapter,

    registeredTier
  });

  registerWikiCoreTools({
    registerTool,
    workspaceRepos,
    z,
    emptySchema,
    extensionNamespacesSchema,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    section: "primary"
  });

  registerCodeIndexTools({ registerTool, workspaceRepos, jsonContent, errorContent });

  registerWorkRecordReadTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    createCompactValidateDispatchResponse,
    registeredTier
  });

  registerIntegrationStatusTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo
  });

  registerIntegrationPromoteCheckTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo
  });

  registerToolRouterTools({ registerTool, z, jsonContent, errorContent });

  await registerInitiativeStatusTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo
  });

  registerAuthoringErgonomicsTools({
    registerTool,
    z,
    jsonContent,
    errorContent,
    workspaceRepos,
    resolveWorkspaceRepo
  });

  registerWorkspaceCommitTool({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    setWorkRecordStatusByUnit
  });

  registerFrozenReviewContractTools({
    registerTool,
    z
  });

  registerSubmitForReviewTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    setWorkRecordStatusByUnit
  });

  registerWorkRecordWriteTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    shapeWriteResponse,
    createCompactWorkRecordEditResponse,
    createCompactContractEditResponse,
    validateOptionalExpectedSourceDigest,
    runWorkspaceWorkRecordAdmissionRefreshRoute,
    constants: {
      WORK_RECORD_STATUS_VALUES,
      WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME,
      WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME,
      WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME
    }
  });
  registerWorkRecordEntryTools({ registerTool, workspaceRepos, z, jsonContent, errorContent,
    resolveWorkspaceRepo,
    resolveWorkspaceReadRepo: createWorkspaceReadRepoResolver({ workspaceRepos, resolveWorkspaceRepo }),
    resolveRetainedFindingsSource: dispatchBackend?.resolveRetainedFindingsSource,
    dispatchSessionIdentity });

  registerKindRecordWriteTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo
  });

  registerGraphImpactPersistenceTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    createGraphImpactToolResponse
  });

  registerWikiCoreTools({
    registerTool,
    workspaceRepos,
    z,
    emptySchema,
    extensionNamespacesSchema,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    section: "write-lint"
  });
  return Object.freeze({
    toolProfile,
    registeredTier,
    tools: Object.freeze([...registeredToolNames].sort())
  });
}

export async function startWikiMcpServer({
  packageDocsCarrier = null,
  launcherNoCceAuthorityCapability = null,
  dispatchRuntimeTestComposition = null
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
  });

  const registration = await registerTools(server, {
    packageDocsCarrier: effectivePackageDocsCarrier,
    launcherNoCceAuthorityCapability,
    dispatchRuntimeTestComposition,
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
