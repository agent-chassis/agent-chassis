

import {
  AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
  BOOTSTRAP_STATE_CODES,
  CALLER_ROLE_KIND_VALUES,
  IDENTITY_REFUSAL_CODES,
  evaluateBootstrapReviewState,
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  AGENT_DISPATCH_TOOL_NAME,
  DISPATCH_BLOCKER_CODES
} from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchToolExceptionDetail,
  classifyAgentDispatchSubject,
  dispatchRepoResolutionRefusal,
  isAcceptedSubjectForRole
} from "../dispatch-tool-helpers.mjs";
import { routeExceptionRefusal } from "./agent-dispatch-refusal-projection.mjs";
import { acceptedSubjectKindsForRole } from "./agent-dispatch-request-admission.mjs";
import {
  agentDispatchRoutingInput,
  agentDispatchSelectionShape
} from "./agent-dispatch-selection-contract.mjs";

export const AGENT_DISPATCH_IDENTITY_CONTRACT_TOOL_NAME =
  "workspace_agent_dispatch_identity_contract";
export const AGENT_DISPATCH_SELECTION_READ_SCHEMA_VERSION = "agent-dispatch-selection-read.v1";

const SELECTION_REFUSAL_DETAIL_FIELDS = Object.freeze([
  "role", "target", "target_role", "app", "app_token", "derived_app", "supported_apps",
  "model", "model_source", "known_models", "config_file", "source_code", "authority_limb"
]);

const SELECTION_PROVENANCE = Object.freeze({
  owner: "launcher dispatch selection",
  source: "the bound workspace's agent-launch.toml role configuration and the launcher model registry",
  authorizes_dispatch: false,
  cce_evaluated: false
});

const SELECTION_READ_SENTENCE =
  "dispatch_selection reads the launcher's current app and model for a proposed repo, role and subject without dispatching.";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unavailableSelection(reason, operatorAction) {
  return {
    schema_version: AGENT_DISPATCH_SELECTION_READ_SCHEMA_VERSION,
    status: "unavailable",
    reason,
    operator_action: operatorAction
  };
}

function projectSelectionDetail(detail) {
  if (!isPlainObject(detail)) return null;
  return Object.fromEntries(SELECTION_REFUSAL_DETAIL_FIELDS
    .filter((field) => Object.hasOwn(detail, field))
    .map((field) => [field, structuredClone(detail[field])]));
}

export function readAgentDispatchSelection({
  selection,
  registeredToolNames,
  dispatchSessionIdentity,
  dispatchBackend,
  workspaceRepos,
  resolveWorkspaceRepo
}) {
  if (!(registeredToolNames instanceof Set) || !registeredToolNames.has(AGENT_DISPATCH_TOOL_NAME)) {
    return unavailableSelection("dispatch_not_registered_for_session",
      "Read the dispatch selection from a session whose launcher-bound role profile registers workspace_agent_dispatch.");
  }
  if (typeof dispatchSessionIdentity !== "string" || dispatchSessionIdentity.length === 0) {
    return unavailableSelection("dispatch_session_identity_unavailable",
      "Restart wiki-mcp through its launcher so the server mints a dispatch session identity.");
  }
  if (typeof dispatchBackend?.resolveBackendRoutingDecision !== "function") {
    return unavailableSelection("dispatch_selection_backend_unavailable",
      "Configure the launcher dispatch backend for this server; no local selection resolver is substituted.");
  }
  let workspace;
  try {
    workspace = resolveWorkspaceRepo(workspaceRepos, selection.repo);
  } catch (error) {
    if (!isPlainObject(error?.envelope)) throw error;
    return {
      schema_version: AGENT_DISPATCH_SELECTION_READ_SCHEMA_VERSION,
      status: "refused",
      ok: false,
      role: selection.role,
      subject: selection.subject,
      reason: "workspace_repo_resolution_refused",
      repo_refusal: structuredClone(error.envelope)
    };
  }
  const requested = { repo: workspace.repo, role: selection.role, subject: selection.subject };
  const subjectKind = classifyAgentDispatchSubject(selection.subject);
  if (!isAcceptedSubjectForRole(selection.role, subjectKind)) {
    return {
      schema_version: AGENT_DISPATCH_SELECTION_READ_SCHEMA_VERSION,
      status: "refused",
      ok: false,
      ...requested,
      reason: "subject_role_matrix_violation",
      detail: {
        subject_kind: subjectKind,
        accepted_subject_kinds: [...acceptedSubjectKindsForRole(selection.role)]
      }
    };
  }
  const routing = dispatchBackend.resolveBackendRoutingDecision(
    agentDispatchRoutingInput(selection, workspace)
  );
  if (routing?.ok !== true) {
    const reason = typeof routing?.reason === "string" ? routing.reason : null;
    return {
      schema_version: AGENT_DISPATCH_SELECTION_READ_SCHEMA_VERSION,
      status: "refused",
      ok: false,
      ...requested,
      reason,
      ...(reason === null ? { authority_gap: "launcher_selection_declared_no_reason" } : {}),
      detail: projectSelectionDetail(routing?.detail),
      provenance: SELECTION_PROVENANCE
    };
  }
  return {
    schema_version: AGENT_DISPATCH_SELECTION_READ_SCHEMA_VERSION,
    status: "resolved",
    ok: true,
    ...requested,
    app: routing.app,
    model: routing.model,
    route_kind: routing.routeKind ?? null,
    executor_available: typeof routing.executor_available === "boolean"
      ? routing.executor_available : null,
    ...(isPlainObject(routing.refusal) ? { backend_refusal: structuredClone(routing.refusal) } : {}),
    provenance: SELECTION_PROVENANCE
  };
}

export function registerAgentDispatchIdentityRoute({
  registerTool,
  z,
  jsonContent,
  isPaidTier,
  graphImpactPersistenceAvailable,
  dispatchReviewerAvailable,
  registeredToolNames,
  workspaceRepos,
  resolveWorkspaceRepo,
  dispatchBackend,
  dispatchSessionIdentity,

  responseEnv = process.env
}) {
  registerTool(
    AGENT_DISPATCH_IDENTITY_CONTRACT_TOOL_NAME,
    {
      description: isPaidTier
        ? `Inspect launcher/session identity and bootstrap-review requirements. Caller identity claims refuse. verbose:true adds vocabularies. Introspection flags are caller assertions, not durable review or graph-impact evidence. ${SELECTION_READ_SENTENCE}`
        : `Read the caller/session identity and bootstrap-review contract that workspace_agent_dispatch consumers must enforce. Identity authority must be launcher- or transport-minted; caller-supplied role identity (via request, prompt, env, argv, or claimed_identity.role) is rejected with a refusal envelope. Default output is compact (dispatch reviewer availability, bootstrap_review, refusal, next_action); pass verbose:true for the static caller_role_kinds/bootstrap_state_codes/identity_refusal_codes vocabularies. Caveat: review_evidence_recorded is a caller-asserted introspection knob that shapes only this call's bootstrap evaluation — it is not proof that WK review exists; durable proof lives in the owning WK closure. ${SELECTION_READ_SENTENCE}`,
      inputSchema: {
        verbose: z.boolean().optional(),
        graph_impact_required: z.boolean().optional(),
        review_evidence_recorded: z.boolean().optional(),
        dispatch_selection: z.object(agentDispatchSelectionShape(z)).strict().optional(),
        claimed_identity: z.object({ role: z.string().optional() }).optional(),

        env: z.record(z.unknown()).optional(),
        request: z.record(z.unknown()).optional(),
        prompt: z.record(z.unknown()).optional(),
        argv: z.record(z.unknown()).optional()
      }
    },
    async (args) => {
      try {
        const refusal = refuseCallerSuppliedIdentityFields(args);
        const graphImpactPersistence = graphImpactPersistenceAvailable();
        const reviewerAvailable = dispatchReviewerAvailable();
        const bootstrapReview = evaluateBootstrapReviewState({
          mcp_dispatch_reviewer_available: reviewerAvailable,
          graph_impact_persistence_available: graphImpactPersistence,
          graph_impact_required: Boolean(args?.graph_impact_required),
          review_evidence_recorded: Boolean(args?.review_evidence_recorded)
        });
        const nextAction = refusal
          ? "resolve_caller_supplied_identity"
          : bootstrapReview?.blocking
            ? "resolve_bootstrap_review"
            : "proceed";
        const contract = {
          schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
          verbose: args?.verbose === true,
          mcp_dispatch_reviewer_available: reviewerAvailable,
          graph_impact_persistence_available: graphImpactPersistence,
          bootstrap_review: bootstrapReview,
          refusal,
          next_action: nextAction
        };
        if (args?.verbose === true) {
          contract.caller_role_kinds = CALLER_ROLE_KIND_VALUES;
          contract.bootstrap_state_codes = BOOTSTRAP_STATE_CODES;
          contract.identity_refusal_codes = IDENTITY_REFUSAL_CODES;
        }
        if (args?.dispatch_selection !== undefined) {
          contract.dispatch_selection = refusal
            ? {
                schema_version: AGENT_DISPATCH_SELECTION_READ_SCHEMA_VERSION,
                status: "not_evaluated",
                reason: "caller_supplied_identity"
              }
            : readAgentDispatchSelection({
                selection: args.dispatch_selection,
                registeredToolNames,
                dispatchSessionIdentity,
                dispatchBackend,
                workspaceRepos,
                resolveWorkspaceRepo
              });
        }
        return jsonContent(contract);
      } catch (error) {
        const repoRefusal = dispatchRepoResolutionRefusal(
          AGENT_DISPATCH_IDENTITY_CONTRACT_TOOL_NAME, error);
        if (repoRefusal !== null) return jsonContent(buildBlockedDispatchResult(repoRefusal));
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.HANDLER_EXCEPTION,
          reason: "dispatch_tool_exception",
          detail: buildDispatchToolExceptionDetail(AGENT_DISPATCH_TOOL_NAME, error,
            { env: responseEnv }),
          refusal: routeExceptionRefusal(AGENT_DISPATCH_IDENTITY_CONTRACT_TOOL_NAME)
        }));
      }
    }
  );
}
