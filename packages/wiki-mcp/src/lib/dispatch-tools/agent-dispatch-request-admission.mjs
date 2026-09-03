

import {
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import { resolveDispatchSelection } from
  "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-dispatch-run-lifecycle-selection.mjs";
import {
  AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE,
  AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD,
  AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE,
  DISPATCH_BLOCKER_CODES
} from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  classifyAgentDispatchSubject,
  isAcceptedSubjectForRole
} from "../dispatch-tool-helpers.mjs";
import {
  callerSuppliedAuthorityRefusal,
  reviewerShaSubjectCorrection,
  reviewerShaSubjectRefusal,
  subjectRoleMatrixRefusal
} from "./agent-dispatch-refusal-projection.mjs";

export const CALLER_NODE_ENGINE_AUTHORITY_FIELDS = Object.freeze([
  "node_engine",
  "node_engine_admissibility",
  "node_engine_configuration",
  "node_engine_classification",
  "node_engine_disposition",
  "node_engine_posture",
  "local_only_fail_open"
]);

export const CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS = Object.freeze([
  "ref", "sha", "slice_ref",
  "run_id", "monitor_handle", "launch_ref", "binding", "binding_pair",
  "managed_run_identity", "process_identity", "target", "receipt",
  "review_receipt", "liveness", "worker_liveness", "review_claim",
  "review_result", "acceptance", "acceptance_binding", "proof_a",
  "integration", "integration_claim", "integration_result"
]);

export const CALLER_CCE_POLICY_AUTHORITY_FIELDS = Object.freeze([
  "policy", "policy_decision", "policy_verdict", "cce", "cce_decision",
  "cce_attestation", "attestation", "authorization", "authority"
]);

export const CALLER_TRANSITION_PLAN_AUTHORITY_FIELDS = Object.freeze([
  "launcher_transition_plan", "launcherTransitionPlan", "transition_plan_identity",
  "transitionPlanIdentity", "publication_identity", "publication_identities",
  "forge_confirmed_landed_publication_identity",
  "resolveForgeConfirmedLandedPublicationIdentity"
]);

function acceptedSubjectKindsForRole(role) {
  if (role === "worker" || role === "reviewer") {
    return Object.freeze([
      AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD,
      AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE
    ]);
  }
  if (role === "redteam") {
    return Object.freeze([
      AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD,
      AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE,
      AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE
    ]);
  }
  return Object.freeze([]);
}

function refusedAuthorityFields(args, fields) {
  return fields.filter((field) => Object.prototype.hasOwnProperty.call(args ?? {}, field));
}

function isCommitShaShapedSubject(value) {
  return typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value);
}

function authorityRefusalResult({ args, fields, reason, jsonContent }) {
  return jsonContent(buildBlockedDispatchResult({
    blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
    reason,
    detail: { refused_fields: fields },
    refusal: callerSuppliedAuthorityRefusal({
      role: args?.role,
      subject: args?.subject,
      refusedFields: fields
    })
  }));
}

export function admitAgentDispatchRequest({
  args,
  workspaceRepos,
  resolveWorkspaceRepo,
  dispatchBackend,
  jsonContent,
  requestSchemaAuthority = null
}) {
  for (const [authorityFields, reason] of [
    [CALLER_NODE_ENGINE_AUTHORITY_FIELDS, "caller_supplied_node_engine_authority"],
    [CALLER_CCE_POLICY_AUTHORITY_FIELDS, "caller_supplied_cce_policy_authority"],
    [CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS, "caller_supplied_committed_slice_authority"]
  ]) {
    const fields = refusedAuthorityFields(args, authorityFields);
    if (fields.length > 0) {
      return { response: authorityRefusalResult({ args, fields, reason, jsonContent }) };
    }
  }

  const shaLocatorFields = refusedAuthorityFields(args, ["reviewed_sha", "diff_base_sha"]);
  if (args?.role === "worker" && shaLocatorFields.length > 0) {
    return {
      response: authorityRefusalResult({
        args,
        fields: shaLocatorFields,
        reason: "caller_supplied_committed_slice_authority",
        jsonContent
      })
    };
  }

  const transitionFields = refusedAuthorityFields(args, CALLER_TRANSITION_PLAN_AUTHORITY_FIELDS);
  if (transitionFields.length > 0) {
    return {
      response: authorityRefusalResult({
        args,
        fields: transitionFields,
        reason: "caller_supplied_launcher_transition_authority",
        jsonContent
      })
    };
  }

  const identityRefusal = refuseCallerSuppliedIdentityFields(args);
  if (identityRefusal) {
    return {
      response: jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
        reason: "caller_supplied_identity_carrier",
        detail: identityRefusal,
        refusal: callerSuppliedAuthorityRefusal({
          role: args?.role,
          subject: args?.subject,
          refusedFields: Object.keys(identityRefusal ?? {})
        })
      }))
    };
  }

  const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);
  const subjectKind = classifyAgentDispatchSubject(args.subject);
  if (!isAcceptedSubjectForRole(args.role, subjectKind)) {
    if (args.role === "reviewer" && isCommitShaShapedSubject(args.subject)) {
      const correction = reviewerShaSubjectCorrection(args.subject);
      return {
        response: jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.ROLE_POLICY_VIOLATION,
          reason: "review_commit_sha_used_as_coordination_subject",
          detail: {
            role: args.role,
            subject_kind: subjectKind,
            accepted_subject_kinds: acceptedSubjectKindsForRole(args.role),
            correction
          },
          refusal: reviewerShaSubjectRefusal({
            subject: args.subject,
            requestSchemaAuthority
          })
        }))
      };
    }
    const advisoryRole = args.role === "reviewer" || args.role === "redteam";
    return {
      response: jsonContent(buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.ROLE_POLICY_VIOLATION,
        reason: advisoryRole ? "canonical_subject_malformed" : "subject_role_matrix_violation",
        detail: {
          role: args.role,
          subject_kind: subjectKind,
          subject: args.subject,
          accepted_subject_kinds: acceptedSubjectKindsForRole(args.role)
        },
        refusal: subjectRoleMatrixRefusal({
          role: args.role,
          subject: args.subject,
          subjectKind
        })
      }))
    };
  }

  const dispatchApp = args?.app;
  const dispatchModel = args?.model;
  let routingDecisionResolved = false;
  let routingDecision = null;
  const resolveTransitionSelection = () => {
    if (!routingDecisionResolved) {
      routingDecisionResolved = true;
      routingDecision = dispatchBackend?.resolveBackendRoutingDecision?.({
        role: args.role,
        subject: args.subject,
        target: args.subject,
        target_role: args.role,
        workspace_dir: workspace.dir,
        app: dispatchApp,
        model: dispatchModel
      }) ?? resolveDispatchSelection({
        role: args.role,
        subject: args.subject,
        target: args.subject,
        target_role: args.role,
        workspaceDir: workspace.dir,
        app: dispatchApp,
        model: dispatchModel
      });
      if (routingDecision?.ok !== true) {
        routingDecision = Object.freeze({
          ...(routingDecision ?? {}),
          ok: false,
          target: args.subject,
          target_role: args.role,
          routeKind: args.subject.includes("#")
            ? "slice"
            : args.subject.startsWith("WK-") ? "wk" : "initiative",
          app: routingDecision?.app ?? dispatchApp ?? null,
          model: routingDecision?.model ?? dispatchModel ?? null
        });
      }
    }
    return routingDecision;
  };

  return {
    response: null,
    workspace,
    subjectKind,
    dispatchApp,
    dispatchModel,
    resolveTransitionSelection
  };
}
