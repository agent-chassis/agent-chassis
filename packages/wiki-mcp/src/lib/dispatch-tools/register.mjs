

import { validateWorkRecordDispatch } from "@agent-chassis/wiki-core";
import {
  revalidateWorkRecordDispatchPrivateHandoffById,
  validateWorkRecordDispatchLaunchIntentById
} from "@agent-chassis/wiki-core/src/lib/work-record-dispatch.mjs";
import {
  refreshWorkRecordAdmissionDerivedEvidenceById
} from "@agent-chassis/wiki-core/src/operations/work-records-admission-evidence.mjs";
import {
  generateAndPersistWorkRecordGraphImpactByUnit
} from "@agent-chassis/wiki-core/src/operations/work-record-graph-impact-generate.mjs";
import { isAuthenticatedLauncherNoCceAuthorityCapability } from
  "../launcher-no-cce-authority.mjs";
import {
  AGENT_DISPATCH_TOOL_NAME,
  GRAPH_IMPACT_PERSISTENCE_TOOL_NAME
} from "../dispatch-tool-constants.mjs";
import { registerRunMonitorRoutes } from "../dispatch-run-monitor-routes.mjs";
import { registerDiagnosticRoutes } from "../dispatch-diagnostic-routes.mjs";
import { REGISTERED_TIER_FREE_LOCAL, REGISTERED_TIER_PAID_CCE } from
  "../tool-profile.mjs";
import { withRecordedRequestSchemas } from "../dispatch-tool-helpers.mjs";
import { registerCommittedSliceIntegrationRoute } from
  "./committed-slice-integration-route.mjs";
import { registerForgeHandoffRoute } from "./forge-handoff-route.mjs";
import {
  CALLER_CCE_POLICY_AUTHORITY_FIELDS,
  CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS,
  CALLER_NODE_ENGINE_AUTHORITY_FIELDS
} from "./agent-dispatch-request-admission.mjs";
import { registerAgentDispatchIdentityRoute } from
  "./agent-dispatch-identity-route.mjs";
import { registerAgentDispatchRoute } from "./agent-dispatch-route.mjs";

const COMMITTED_SLICE_INTEGRATION_TOOL_NAME = "workspace_integrate_committed_slice";

export function registerDispatchTools({
  registerTool,
  registeredToolNames,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  dispatchBackend,
  dispatchSessionIdentity,
  launcherNoCceAuthorityCapability = null,
  wkForgeHandoffAdapter = null,
  validateDispatch = validateWorkRecordDispatch,
  validateLaunchIntent = validateWorkRecordDispatchLaunchIntentById,
  revalidatePrivateHandoff = revalidateWorkRecordDispatchPrivateHandoffById,
  generateGraphImpactEvidence = generateAndPersistWorkRecordGraphImpactByUnit,
  refreshAdmissionEvidence = refreshWorkRecordAdmissionDerivedEvidenceById,
  registeredTier = REGISTERED_TIER_FREE_LOCAL,
  runStatusCallBudgetMs = undefined
}) {
  registerTool = withRecordedRequestSchemas(registerTool);
  const isPaidTier = registeredTier === REGISTERED_TIER_PAID_CCE;
  const launcherConfirmedNoCceAuthority =
    isAuthenticatedLauncherNoCceAuthorityCapability(launcherNoCceAuthorityCapability);
  const graphImpactPersistenceAvailable = () =>
    registeredToolNames.has(GRAPH_IMPACT_PERSISTENCE_TOOL_NAME);
  const dispatchReviewerAvailable = () => registeredToolNames.has(AGENT_DISPATCH_TOOL_NAME);

  registerAgentDispatchIdentityRoute({
    registerTool,
    z,
    jsonContent,
    isPaidTier,
    graphImpactPersistenceAvailable,
    dispatchReviewerAvailable
  });
  registerAgentDispatchRoute({
    registerTool,
    registeredToolNames,
    workspaceRepos,
    z,
    jsonContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity,
    launcherConfirmedNoCceAuthority,
    validateDispatch,
    validateLaunchIntent,
    revalidatePrivateHandoff,
    generateGraphImpactEvidence,
    refreshAdmissionEvidence,
    isPaidTier
  });

  registerCommittedSliceIntegrationRoute({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    committedSliceIntegrationToolName: COMMITTED_SLICE_INTEGRATION_TOOL_NAME,
    callerNodeEngineAuthorityFields: CALLER_NODE_ENGINE_AUTHORITY_FIELDS,
    callerCommittedSliceAuthorityFields: CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS,
    callerCcePolicyAuthorityFields: CALLER_CCE_POLICY_AUTHORITY_FIELDS
  });
  registerForgeHandoffRoute({
    registerTool,
    workspaceRepos,
    z,
    jsonContent,
    resolveWorkspaceRepo,
    invokeWkForgeHandoffAdapter: typeof wkForgeHandoffAdapter === "function"
      ? async (assignedUnit) => await wkForgeHandoffAdapter({ assigned_unit: assignedUnit })
      : null
  });

  const ctx = {
    registerTool,
    registeredToolNames,
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo,
    dispatchBackend,
    dispatchSessionIdentity,
    graphImpactPersistenceAvailable,
    dispatchReviewerAvailable,
    isPaidTier,
    ...(runStatusCallBudgetMs === undefined ? {} : { runStatusCallBudgetMs })
  };
  registerRunMonitorRoutes(ctx);
  registerDiagnosticRoutes(ctx);
}
