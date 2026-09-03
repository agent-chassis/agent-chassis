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
import path from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  readContractFile,
  setWorkRecordStatusByUnit,
  WORK_RECORD_STATUS_VALUES
} from "../../wiki-core/src/index.mjs";
import {
  WORK_RECORD_CONTRACT_LIST_FIELDS
} from "../../wiki-core/src/lib/work-record-contract-edit.mjs";
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
import {
  consumeLauncherCommonProofResolverCapability,
  createLauncherCommonProofResolverFromCapability
} from "./lib/launcher-common-proof-resolver-capability.mjs";

import {
  augmentWorkspaceToolDiscoveryDescriptor,
  createProductionToolUsageAuditOrigin,
  createProductionToolUsageAuditSelectedContext,
  loadMcpToolTierRegistrationPolicy,
  structuredLog,
  trimmed
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
  runWorkspaceWorkRecordCleanupDerivedEvidenceRoute,
  WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME,
  WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME,
  WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME
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

import { registerAgentFaqTools } from "./lib/agent-faq-tools.mjs";

import { registerAuthoringErgonomicsTools } from "./lib/authoring-ergonomics-tools.mjs";
import {
  createToolUsageAuditBoundaryRecorder,
  registerToolUsageAuditTools
} from "./lib/tool-usage-audit-mcp-tools.mjs";

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

import { registerWikiCoreTools } from "./lib/wiki-core-tools.mjs";

import { registerWorkRecordWriteTools } from "./lib/work-record-write-tools.mjs";
import { registerKindRecordWriteTools } from "./lib/kind-record-write-tools.mjs";
import { registerWorkspaceCommitTool } from "./lib/workspace-commit-tool.mjs";

import { registerWorkerDeclaredTestTool } from "./lib/worker-declared-test-tool.mjs";

import { registerFrozenReviewContractTools } from "./lib/frozen-review-contract-tools.mjs";

import { registerDispatchTools } from "./lib/dispatch-tools.mjs";

import { buildDispatchRuntime } from "./lib/dispatch-launch-runtime.mjs";

import { bootstrapWikiMcpNodeEngineEnv } from "./lib/node-engine-env-bootstrap.mjs";

const SERVER_VERSION = "0.2.0";
const WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME = "workspace_work_record_set_status";
const WORKSPACE_WORK_RECORD_SET_TASK_TOOL_NAME = "workspace_work_record_set_task";

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
  resolveLauncherReceipt = null
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
    runTerminalCandidateValidationForUnit
  } =
    buildDispatchRuntime(process.env, {
      registeredTier,
      workspaceRepos,
      resolveWorkspaceRepo
    });
  const toolUsageAuditBoundary = createToolUsageAuditBoundaryRecorder({
    origin: () => createProductionToolUsageAuditOrigin({ toolProfile, dispatchSessionIdentity }),
    selected: () => createProductionToolUsageAuditSelectedContext({
      workspaceRepos,
      assignedUnit: trimmed(process.env.WIKI_MCP_ASSIGNED_UNIT)
    }),
    onRecorderError: (error) => {
      structuredLog({
        level: "warning",
        event: "tool_usage_audit_recorder_error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

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
    persistControlledContractGeneration,
    resolveLauncherReceipt
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
    runTerminalCandidateValidationForUnit,
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

  registerAgentFaqTools({ registerTool, z, jsonContent, errorContent, registeredTier });

  registerAuthoringErgonomicsTools({
    registerTool,
    z,
    jsonContent,
    errorContent,
    workspaceRepos,
    resolveWorkspaceRepo
  });

  registerToolUsageAuditTools({
    registerTool,
    z,
    jsonContent,
    errorContent,
    recorder: toolUsageAuditBoundary.recorder
  });

  registerWorkspaceCommitTool({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    createCompactWorkRecordEditResponse,
    setWorkRecordStatusByUnit
  });

  registerWorkerDeclaredTestTool({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo
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
    runWorkspaceWorkRecordCleanupDerivedEvidenceRoute,
    constants: {
      WORK_RECORD_STATUS_VALUES,
      WORK_RECORD_CONTRACT_LIST_FIELDS,
      WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME,
      WORKSPACE_WORK_RECORD_SET_TASK_TOOL_NAME,
      WORKSPACE_WORK_RECORD_REFRESH_ADMISSION_METRICS_TOOL_NAME,
      WORKSPACE_WORK_RECORD_REFRESH_TARGET_RESOLUTION_EVIDENCE_TOOL_NAME,
      WORKSPACE_WORK_RECORD_CLEANUP_DERIVED_EVIDENCE_TOOL_NAME
    }
  });

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
  resolveLauncherReceipt = null
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

  const server = new McpServer({
    name: "@agent-chassis/wiki-mcp",
    version: SERVER_VERSION
  });

  const registration = await registerTools(server, {
    packageDocsCarrier: effectivePackageDocsCarrier,
    launcherNoCceAuthorityCapability,
    resolveLauncherReceipt
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

  shutdownController.setServerCloseHook(() => server.close());

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const launcherNoCceAuthorityCapability = consumeLauncherNoCceAuthorityCapability();
  let resolveLauncherReceipt = null;
  try {
    const capability = consumeLauncherCommonProofResolverCapability();
    resolveLauncherReceipt = capability === null
      ? null
      : createLauncherCommonProofResolverFromCapability(capability);
  } catch (capabilityError) {
    resolveLauncherReceipt = async () => { throw capabilityError; };
  }
  startWikiMcpServer({ launcherNoCceAuthorityCapability, resolveLauncherReceipt }).catch((error) => {
    structuredLog({
      level: "error",
      message: error instanceof Error ? error.message : String(error)
    });
    process.exitCode = 1;
  });
}
