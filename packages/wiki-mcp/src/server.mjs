#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createLauncherObservingTransport,
  createLauncherReadinessEventWriter
} from "./lib/launcher-readiness-observer.mjs";
import { z } from "zod";
import { writeFileSync } from "node:fs";
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
  guardToolHandler,
  installProcessErrorGuards,
  readSpilledMcpContentReference
} from "./lib/mcp-response.mjs";
import {
  parseToolProfile,
  shouldExposeTool,
  resolveRegisteredTier
} from "./lib/tool-profile.mjs";
import {
  loadToolDiscoveryDescriptor,
  resolveToolTierVisibility
} from "@agent-chassis/wiki-core/src/lib/tool-discovery.mjs";
import {
  workspaceToolRouterRecommend
} from "../../wiki-core/src/operations/tool-router.mjs";
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

import { registerReviewAttestationTools } from "./lib/review-attestation-tools.mjs";
import { registerReviewResultEvidenceTools } from "./lib/review-result-evidence-tools.mjs";

import { registerStaticResources } from "./lib/static-resources.mjs";

import { registerWorkRecordReadTools } from "./lib/work-record-read-tools.mjs";
import { registerIntegrationStatusTools } from "./lib/integration-status-tools.mjs";
import { registerIntegrationPromoteCheckTools } from "./lib/integration-promote-check-tools.mjs";

import { registerAgentFaqTools } from "./lib/agent-faq-tools.mjs";
import {
  createToolUsageAuditBoundaryRecorder,
  registerToolUsageAuditTools
} from "./lib/tool-usage-audit-mcp-tools.mjs";

import { registerToolDiscoveryTools } from "./lib/tool-discovery-tools.mjs";

import { registerWikiCoreTools } from "./lib/wiki-core-tools.mjs";

import { registerWorkRecordWriteTools } from "./lib/work-record-write-tools.mjs";
import { registerKindRecordWriteTools } from "./lib/kind-record-write-tools.mjs";
import { registerWorkspaceCommitTool } from "./lib/workspace-commit-tool.mjs";

import { registerDispatchTools } from "./lib/dispatch-tools.mjs";

import { buildDispatchRuntime } from "./lib/dispatch-launch-runtime.mjs";

import { bootstrapWikiMcpNodeEngineEnv } from "./lib/node-engine-env-bootstrap.mjs";

const SERVER_VERSION = "0.2.0";
const WORKSPACE_WORK_RECORD_SET_STATUS_TOOL_NAME = "workspace_work_record_set_status";
const WORKSPACE_WORK_RECORD_SET_TASK_TOOL_NAME = "workspace_work_record_set_task";
const WORKSPACE_INITIATIVE_STATUS_TOOL_NAME = "workspace_initiative_status";
const WORKSPACE_TOOL_ROUTER_RECOMMEND_TOOL_NAME = "workspace_tool_router_recommend";
const WORKSPACE_SUBMIT_FOR_REVIEW_TOOL_NAME = "workspace_submit_for_review";

function structuredLog(data) {
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...data })}\n`
  );
}

installProcessErrorGuards({ log: structuredLog });

const emptySchema = z.object({});
const extensionNamespacesSchema = z.array(z.string()).optional();

function augmentWorkspaceToolDiscoveryDescriptor(descriptor) {

  return descriptor;
}

const DESCRIPTOR_LOAD_FAILURE_FREE_LOCAL_MCP_TOOL_NAMES = new Set([
  "workspace_tools_list",
  "workspace_tools_describe",
  "workspace_tools_query",
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
  "workspace_submit_for_review"
]);

async function loadMcpToolTierRegistrationPolicy() {
  try {
    const descriptor = await loadToolDiscoveryDescriptor();
    const freeLocalToolNames = new Set();
    for (const tool of Array.isArray(descriptor?.tools) ? descriptor.tools : []) {
      if (!tool || typeof tool.tool_name !== "string" || tool.kind !== "mcp_tool") {
        continue;
      }
      const visibility = resolveToolTierVisibility(tool);
      if (visibility.includes("free_local")) {
        freeLocalToolNames.add(tool.tool_name);
      }
    }
    return {
      descriptorLoaded: true,
      freeLocalToolNames,
      freeLocalFallbackToolNames: null
    };
  } catch (error) {
    structuredLog({
      level: "warning",
      event: "tool_tier_registration_descriptor_load_failed",
      message:
        "Tool discovery descriptor tier metadata could not be loaded; free/local MCP registration is limited to the safe free/local fallback set.",
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      descriptorLoaded: false,
      freeLocalToolNames: null,
      freeLocalFallbackToolNames: DESCRIPTOR_LOAD_FAILURE_FREE_LOCAL_MCP_TOOL_NAMES
    };
  }
}

function trimmed(value) {
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

function createProductionToolUsageAuditOrigin({ toolProfile, dispatchSessionIdentity }) {
  return {
    caller_kind: auditCallerKind(toolProfile),
    session_kind: auditSessionKind(toolProfile),
    tool_profile: auditToolProfileBucket(toolProfile),
    client_origin: dispatchSessionIdentity
  };
}

function createProductionToolUsageAuditSelectedContext({ workspaceRepos, assignedUnit }) {
  const selected = {};
  if (workspaceRepos?.currentAlias) {
    selected.workspace_repo = workspaceRepos.currentAlias;
  }
  if (assignedUnit) {
    selected.selected_unit = assignedUnit;
  }
  return selected;
}

function createSubmitForReviewRefusal(decisionCode, reasons, extra = {}) {
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

function createSubmitForReviewResponse(workspaceRepo, assignedUnit, result) {
  return {
    tool: WORKSPACE_SUBMIT_FOR_REVIEW_TOOL_NAME,
    submitted: Boolean(result?.valid) && (Boolean(result?.written) || Boolean(result?.no_op)),
    assigned_unit: assignedUnit,
    ...createCompactWorkRecordEditResponse(workspaceRepo, result)
  };
}

async function registerTools(server) {
  const workspaceRepos = await parseWorkspaceRepos();
  const toolProfile = parseToolProfile();

  const registeredTier = resolveRegisteredTier(process.env);
  const mcpToolTierRegistrationPolicy = await loadMcpToolTierRegistrationPolicy();
  const registeredToolNames = new Set();

  const {
    dispatchBackend,
    dispatchSessionIdentity,
    wkForgeHandoffAdapter,
    runTerminalCandidateValidationForUnit
  } =
    buildDispatchRuntime(process.env, { registeredTier });
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

  function registerTool(name, config, handler) {

    if (!shouldExposeTool(toolProfile, name)) {
      return;
    }

    if (
      registeredTier !== "paid_cce" &&
      mcpToolTierRegistrationPolicy.descriptorLoaded === true &&
      !mcpToolTierRegistrationPolicy.freeLocalToolNames?.has(name)
    ) {
      return;
    }
    if (
      registeredTier !== "paid_cce" &&
      mcpToolTierRegistrationPolicy.freeLocalFallbackToolNames instanceof Set &&
      !mcpToolTierRegistrationPolicy.freeLocalFallbackToolNames.has(name)
    ) {
      return;
    }

    const auditedHandler = toolUsageAuditBoundary.wrapHandler(name, handler);
    server.registerTool(name, config, guardToolHandler(auditedHandler, { name, log: structuredLog }));
    registeredToolNames.add(name);
  }

  registerTool(
    "workspace_read_mcp_content_reference",
    {
      description:
        "Read a byte range from a server-side MCP response content reference created when an oversized lossless tool response is spilled instead of inlined. Use offset and length to reassemble the complete payload; length must not exceed the returned max_length.",
      inputSchema: {
        ref_id: z.string(),
        offset: z.number().optional(),
        length: z.number().optional()
      }
    },
    async (args) => {
      try {
        return jsonContent(
          readSpilledMcpContentReference({
            ref_id: args.ref_id,
            offset: args.offset ?? 0,
            length: args.length ?? null
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerToolDiscoveryTools({
    registerTool,
    jsonContent,
    errorContent,
    augmentDescriptor: augmentWorkspaceToolDiscoveryDescriptor,

    registeredTier
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

  registerTool(
    WORKSPACE_TOOL_ROUTER_RECOMMEND_TOOL_NAME,
    {
      description:
        "Compact read-only guidance for which repo tool to call first for a task. Returns matched, ambiguous, or unknown router output with recommended first tool, suggested arguments when derivable, do-not-start-with guidance, allowed next calls, and a short reason.",
      inputSchema: z
        .object({
          task_description: z.string().optional(),
          task: z.string().optional(),
          initiative: z.string().optional(),
          unit: z.string().optional(),
          slice_unit: z.string().optional(),
          slice_id: z.string().optional(),
          role: z.string().optional(),
          monitor_handle: z.string().optional(),
          known_resources: z.record(z.union([z.string(), z.array(z.string())])).optional()
        })
        .strict()
        .refine(
          (value) =>
            Boolean(
              trimmed(value.task_description) ||
                trimmed(value.task) ||
                trimmed(value.initiative) ||
                trimmed(value.unit) ||
                trimmed(value.slice_unit) ||
                trimmed(value.monitor_handle)
            ),
          {
            message:
              "workspace_tool_router_recommend requires a task_description, task, or known identifier"
          }
        )
    },
    async (args) => {
      try {
        return jsonContent(await workspaceToolRouterRecommend(args));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  const initiativeStatusModule = await import("../../wiki-core/src/operations/initiative-status.mjs");
  const initiativeStatusHandler =
    initiativeStatusModule.workspace_initiative_status ??
    initiativeStatusModule.workspaceInitiativeStatus ??
    initiativeStatusModule.initiativeStatus ??
    initiativeStatusModule.summarizeInitiativeStatus ??
    initiativeStatusModule.default;

  if (typeof initiativeStatusHandler !== "function") {
    throw new Error("workspace_initiative_status operation is unavailable");
  }

  registerTool(
    WORKSPACE_INITIATIVE_STATUS_TOOL_NAME,
    {
      description:
        "Compact read-only initiative status and next-action surface. Requires initiative or unit. Use selected_action_id to pin a candidate action, top_action_limit to bound the ranked action list, and verbose for the fuller evidence view.",
      inputSchema: z
        .object({
          repo: z.string().optional(),
          initiative: z.string().optional(),
          unit: z.string().optional(),
          selected_action_id: z.string().optional(),
          top_action_limit: z.number().int().positive().max(20).optional(),
          verbose: z.boolean().optional()
        })
        .strict()
        .refine((value) => Boolean(value.initiative || value.unit), {
          message: "workspace_initiative_status requires initiative or unit"
        })
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const result = await initiativeStatusHandler({
          repoRoot: workspace.dir,
          initiative: args.initiative ?? null,
          unit: args.unit ?? null,
          selected_action_id: args.selected_action_id ?? null,
          top_action_limit: args.top_action_limit ?? null,
          verbose: Boolean(args.verbose)
        });
        return jsonContent({ workspaceRepo: workspace.repo, ...result });
      } catch (error) {
        return errorContent(error);
      }
    }
  );

  registerAgentFaqTools({ registerTool, z, jsonContent, errorContent, registeredTier });

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

  registerTool(
    WORKSPACE_SUBMIT_FOR_REVIEW_TOOL_NAME,
    {
      description:
        "Worker-only affordance: submit the launcher-assigned WK or slice for findings-only review by setting the WIKI_MCP_ASSIGNED_UNIT-minted unit status to review. The tool accepts no caller-supplied unit, status, or other fields.",
      inputSchema: z.object({}).strict()
    },
    async () => {
      try {
        const assignedUnit = trimmed(process.env.WIKI_MCP_ASSIGNED_UNIT);
        if (!assignedUnit) {
          return jsonContent(
            createSubmitForReviewRefusal("submit_for_review.missing_assigned_unit.v1", [
              "WIKI_MCP_ASSIGNED_UNIT is not set; workspace_submit_for_review is only available for launcher-assigned worker-profile sessions"
            ])
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos);
        const result = await setWorkRecordStatusByUnit({
          dir: workspace.dir,
          unitAddress: assignedUnit,
          status: "review"
        });
        return jsonContent(createSubmitForReviewResponse(workspace.repo, assignedUnit, result));
      } catch (error) {
        return errorContent(error);
      }
    }
  );

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

  registerReviewAttestationTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity
  });

  registerReviewResultEvidenceTools({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity
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

async function main() {

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

  const registration = await registerTools(server);
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
      await server.close();
      process.exitCode = 1;
    },
    onCleanupTimeout: () => { process.exit(1); }
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

  process.stdin.once("end", () => {
    void server.close().finally(() => {
      process.exitCode = 0;
    });
  });

  writeLauncherEvent({
    schema_version: "wiki-mcp-launcher-readiness.v1",
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

main().catch((error) => {
  structuredLog({
    level: "error",
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
