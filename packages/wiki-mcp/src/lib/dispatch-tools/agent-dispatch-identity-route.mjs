

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
  buildDispatchToolExceptionDetail
} from "../dispatch-tool-helpers.mjs";
import { routeExceptionRefusal } from "./agent-dispatch-refusal-projection.mjs";

export const AGENT_DISPATCH_IDENTITY_CONTRACT_TOOL_NAME =
  "workspace_agent_dispatch_identity_contract";

export function registerAgentDispatchIdentityRoute({
  registerTool,
  z,
  jsonContent,
  isPaidTier,
  graphImpactPersistenceAvailable,
  dispatchReviewerAvailable
}) {
  registerTool(
    AGENT_DISPATCH_IDENTITY_CONTRACT_TOOL_NAME,
    {
      description: isPaidTier
        ? "Read the caller/session identity and bootstrap-review contract that workspace_agent_dispatch consumers must enforce. Identity authority must be launcher- or transport-minted; caller-supplied role identity (via request, prompt, env, argv, or claimed_identity.role) is rejected with a refusal envelope. Default output is compact (reviewer/graph-impact availability, bootstrap_review, refusal, next_action); pass verbose:true for the static caller_role_kinds/bootstrap_state_codes/identity_refusal_codes vocabularies. Caveat: graph_impact_required and review_evidence_recorded are caller-asserted introspection knobs that shape only this call's bootstrap evaluation — they are not proof that WK review or graph-impact evidence exists; durable proof lives in the owning WK closure."
        : "Read the caller/session identity and bootstrap-review contract that workspace_agent_dispatch consumers must enforce. Identity authority must be launcher- or transport-minted; caller-supplied role identity (via request, prompt, env, argv, or claimed_identity.role) is rejected with a refusal envelope. Default output is compact (dispatch reviewer availability, bootstrap_review, refusal, next_action); pass verbose:true for the static caller_role_kinds/bootstrap_state_codes/identity_refusal_codes vocabularies. Caveat: review_evidence_recorded is a caller-asserted introspection knob that shapes only this call's bootstrap evaluation — it is not proof that WK review exists; durable proof lives in the owning WK closure.",
      inputSchema: {
        verbose: z.boolean().optional(),
        graph_impact_required: z.boolean().optional(),
        review_evidence_recorded: z.boolean().optional(),
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
        return jsonContent(contract);
      } catch (error) {
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
          reason: "dispatch_tool_exception",
          detail: buildDispatchToolExceptionDetail(AGENT_DISPATCH_TOOL_NAME, error),
          refusal: routeExceptionRefusal(AGENT_DISPATCH_IDENTITY_CONTRACT_TOOL_NAME)
        }));
      }
    }
  );
}
