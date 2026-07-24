

import {
  AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
  BOOTSTRAP_STATE_CODES,
  CALLER_ROLE_KIND_VALUES,
  IDENTITY_REFUSAL_CODES,
  evaluateBootstrapReviewState,
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  validateWorkRecordDispatch
} from "@agent-chassis/wiki-core";
import {
  revalidateWorkRecordDispatchPrivateHandoffById,
  validateWorkRecordDispatchLaunchIntentById
} from "@agent-chassis/wiki-core/src/lib/work-record-dispatch.mjs";
import {
  refreshWorkRecordAdmissionDerivedEvidenceById
} from "@agent-chassis/wiki-core/src/operations/work-records-admission-evidence.mjs";
import {
  evaluateGraphImpactBlocker,
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  generateAndPersistWorkRecordGraphImpactByUnit
} from "@agent-chassis/wiki-core/src/operations/work-record-graph-impact-generate.mjs";
import {
  AGENT_DISPATCH_ROLE_VALUES,
  AGENT_DISPATCH_SCHEMA_VERSION,
  AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE,
  AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD,
  AGENT_DISPATCH_SUBJECT_KIND_WORK_RECORD_SLICE,
  AGENT_DISPATCH_TOOL_NAME,
  DISPATCH_BLOCKER_CODES,
  GRAPH_IMPACT_PERSISTENCE_TOOL_NAME,
  WK_FORGE_HANDOFF_TOOL_NAME
} from "../dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchToolExceptionDetail,
  classifyAgentDispatchSubject,
  isAcceptedSubjectForRole,
  loadReviewerSubjectAdmissionContext,
  mapBackendRefusalToDispatchCode
} from "../dispatch-tool-helpers.mjs";
import { registerRunMonitorRoutes } from "../dispatch-run-monitor-routes.mjs";

import {
  nextActionForDecisionCode,
  nextActionForFreeLocalDecisionCode
} from "../work-record-write-route-helpers.mjs";
import { REGISTERED_TIER_FREE_LOCAL, REGISTERED_TIER_PAID_CCE } from "../tool-profile.mjs";
import { registerDiagnosticRoutes } from "../dispatch-diagnostic-routes.mjs";

const DISPATCH_LAUNCH_BACKEND_REASON = "launch_backend_unavailable";
const DISPATCH_LAUNCH_BACKEND_DETAIL = Object.freeze({
  missing_backend: "workspace_agent_run_lifecycle",
  intended_owner: "WK-0526#launcher-admission-wiring",
  description:
    "No launcher-side update seam is wired to advance workspace_agent_dispatch monitor handles from pending_launch through launching/running/terminal. Dispatch fails closed at admission so callers see a stable structured blocker instead of an indefinitely pending monitor handle. A separate WK must deliver the launch backend; agents must not work around this with wrapper, shell, env, bwrap, temp worktree, or graph-impact side-channel launch."
});

const DECISIONS_WRITE_SCOPE_FORBIDDEN_DECISION_CODE = "decisions_write_scope_forbidden";

const RECOVERABLE_DISPATCH_STATES = new Set([
  "recoverable_missing",
  "recoverable_stale",
  "recoverable_outdated"
]);

function isRecoverableGraphState(state) {
  return RECOVERABLE_DISPATCH_STATES.has(state);
}

function graphDerivationRequiredForDispatch(state) {
  return state === "fresh" || isRecoverableGraphState(state);
}

const CALLER_NODE_ENGINE_AUTHORITY_FIELDS = Object.freeze([
  "node_engine",
  "node_engine_admissibility",
  "node_engine_configuration",
  "node_engine_classification",
  "node_engine_disposition",
  "node_engine_posture",
  "local_only_fail_open"
]);

const CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS = Object.freeze([
  "ref", "sha", "slice_ref", "reviewed_sha", "diff_base_sha",
  "run_id", "monitor_handle", "launch_ref", "binding", "binding_pair",
  "managed_run_identity", "process_identity", "target", "receipt",
  "review_receipt", "liveness", "worker_liveness", "review_claim",
  "review_result", "acceptance", "acceptance_binding", "proof_a",
  "integration", "integration_claim", "integration_result"
]);
const CALLER_CCE_POLICY_AUTHORITY_FIELDS = Object.freeze([
  "policy", "policy_decision", "policy_verdict", "cce", "cce_decision",
  "cce_attestation", "attestation", "authorization", "authority"
]);
const COMMITTED_SLICE_INTEGRATION_TOOL_NAME = "workspace_integrate_committed_slice";

function graphBlockerCodeForReadiness(readiness) {
  if (!new Set(["missing_graph_impact", "stale_write_scope"]).has(readiness?.decision_code)) {
    return null;
  }
  if (
    readiness?.recovery?.graph_impact === "not_required" ||
    readiness?.recovery?.graph_impact === "fresh" ||

    readiness?.recovery?.graph_impact === "nonrecoverable_missing_paths"
  ) {
    return null;
  }
  const state = readiness?.state?.graph_state ?? {};
  const evaluated = evaluateGraphImpactBlocker({
    graph_state: state.graph_state ?? null,
    staleness: state.staleness ?? null,
    dirty_state: state.dirty_state ?? null,
    overlay_state: state.overlay_state ?? null
  });
  return evaluated?.blocking === true ? evaluated.code : null;
}

function hasValidPrivateHandoff(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join("|") !== "authored_source_digest|full_persistence_snapshot_digest|reviewed_unit_digest") {
    return false;
  }
  return keys.every((key) => typeof value[key] === "string" && value[key].length > 0);
}

function strictAdmissionComponentIssue(readiness) {
  const admissionState = readiness?.recovery?.admission_metrics;
  if (admissionState !== "fresh") return admissionState ?? "admission_metrics_missing";
  const targetState = readiness?.recovery?.target_resolution;
  if (targetState !== "fresh" && targetState !== "not_required") {
    return targetState ?? "target_resolution_missing";
  }
  return null;
}

function boundedRecoveryDetail(readiness, extra = {}) {
  return {
    readiness_decision_code: readiness?.decision_code ?? null,
    recovery: readiness?.recovery ?? null,
    ...extra
  };
}

function nodeEngineRefusal(readiness) {
  const admissibility = readiness?.admissibility;
  if (!admissibility) {
    return {
      code: RUNTIME_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
      reason: "remote_enforcement_absent"
    };
  }
  if (readiness?.dispatchable === true) {
    return admissibility.status === "admit" || admissibility.status === "local_only_fail_open"
      ? null
      : {
          code: RUNTIME_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
          reason: admissibility.diagnostic_code ?? "node_engine_unknown_result"
        };
  }
  if (admissibility.status === "needs_review") {
    return {
      code: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_REVIEW_THRESHOLD_EXCEEDED,
      reason: "node_engine_needs_review"
    };
  }
  if (admissibility.status === "unavailable" && admissibility.authority === "node_engine") {
    return {
      code: RUNTIME_BLOCKER_CODES.BACKEND_UNAVAILABLE,
      reason: "node_engine_backend_unavailable"
    };
  }
  return {
    code: RUNTIME_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
    reason: admissibility.diagnostic_code ?? "node_engine_non_admit"
  };
}

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

  wkForgeHandoffAdapter = null,
  validateDispatch = validateWorkRecordDispatch,
  validateLaunchIntent = validateWorkRecordDispatchLaunchIntentById,
  revalidatePrivateHandoff = revalidateWorkRecordDispatchPrivateHandoffById,
  generateGraphImpactEvidence = generateAndPersistWorkRecordGraphImpactByUnit,
  refreshAdmissionEvidence = refreshWorkRecordAdmissionDerivedEvidenceById,

  registeredTier = REGISTERED_TIER_FREE_LOCAL
}) {
  const isPaidTier = registeredTier === REGISTERED_TIER_PAID_CCE;

  function graphImpactPersistenceAvailable() {
    return registeredToolNames.has(GRAPH_IMPACT_PERSISTENCE_TOOL_NAME);
  }

  function dispatchReviewerAvailable() {
    return registeredToolNames.has(AGENT_DISPATCH_TOOL_NAME);
  }

  registerTool(
    "workspace_agent_dispatch_identity_contract",
    {
      description: isPaidTier
        ? "Read the caller/session identity and bootstrap-review contract that workspace_agent_dispatch consumers must enforce. Identity authority must be launcher- or transport-minted; caller-supplied role identity (via request, prompt, env, argv, or claimed_identity.role) is rejected with a refusal envelope. Default output is compact (reviewer/graph-impact availability, bootstrap_review, refusal, next_action); pass verbose:true for the static caller_role_kinds/bootstrap_state_codes/identity_refusal_codes vocabularies. Caveat: graph_impact_required and review_evidence_recorded are caller-asserted introspection knobs that shape only this call's bootstrap evaluation — they are not proof that WK review or graph-impact evidence exists; durable proof lives in the owning WK closure."
        : "Read the caller/session identity and bootstrap-review contract that workspace_agent_dispatch consumers must enforce. Identity authority must be launcher- or transport-minted; caller-supplied role identity (via request, prompt, env, argv, or claimed_identity.role) is rejected with a refusal envelope. Default output is compact (dispatch reviewer availability, bootstrap_review, refusal, next_action); pass verbose:true for the static caller_role_kinds/bootstrap_state_codes/identity_refusal_codes vocabularies. Caveat: review_evidence_recorded is a caller-asserted introspection knob that shapes only this call's bootstrap evaluation — it is not proof that WK review exists; durable proof lives in the owning WK closure.",
      inputSchema: {
        verbose: z.boolean().optional(),
        graph_impact_required: z.boolean().optional(),
        review_evidence_recorded: z.boolean().optional(),
        claimed_identity: z
          .object({
            role: z.string().optional()
          })
          .optional(),

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
          refusal: refusal,
          next_action: nextAction
        };
        if (args?.verbose === true) {

          contract.caller_role_kinds = CALLER_ROLE_KIND_VALUES;
          contract.bootstrap_state_codes = BOOTSTRAP_STATE_CODES;
          contract.identity_refusal_codes = IDENTITY_REFUSAL_CODES;
        }
        return jsonContent(contract);
      } catch (error) {
        return jsonContent(
          buildBlockedDispatchResult({
            blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
            reason: "dispatch_tool_exception",
            detail: buildDispatchToolExceptionDetail(AGENT_DISPATCH_TOOL_NAME, error)
          })
        );
      }
    }
  );

  registerTool(
    AGENT_DISPATCH_TOOL_NAME,
    {
      description:
        "Dispatch a worker, reviewer, or redteam through the structured Codex/Claude backend. Reviewer and redteam admission requires empty write_scope; the exact-slice exception remains read-only. Exact-target review is plural: active or historical reviews never block another review, each run keeps independent append-only evidence, and reviewer/redteam results are advisory only. Clean output grants no admission authority and findings grant no veto authority. CCE owns configured organization policy; paid-tier presence alone implies no policy decision. Integration is the separate workspace_integrate_committed_slice coordinator operation. Worker/reviewer concurrency uses attempt isolation and exact ref/status CAS, not singleton lifecycle consumption. Stdio MCP is not an authentication boundary. The normal call supplies `role` and `subject`; launcher configuration selects the app/model, and caller-supplied selection or identity authority is rejected. There is no shell or wrapper fallback; a missing backend fails closed with backend_unavailable.",
      inputSchema: z.object({
        repo: z.string().optional(),
        app: z.string().optional(),
        model: z.string().optional(),
        role: z.enum(AGENT_DISPATCH_ROLE_VALUES),
        subject: z.string(),

        env: z.record(z.unknown()).optional(),
        request: z.record(z.unknown()).optional(),
        prompt: z.record(z.unknown()).optional(),
        argv: z.record(z.unknown()).optional(),
        claimed_identity: z
          .object({
            role: z.string().optional()
          })
          .optional(),
        ...Object.fromEntries(
          [...CALLER_NODE_ENGINE_AUTHORITY_FIELDS, ...CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS]
            .map((field) => [field, z.unknown().optional()])
        )
      }).strict()
    },
    async (args) => {
      try {
        const callerAuthorityFields = CALLER_NODE_ENGINE_AUTHORITY_FIELDS.filter((field) =>
          Object.prototype.hasOwnProperty.call(args ?? {}, field)
        );
        if (callerAuthorityFields.length > 0) {
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
              reason: "caller_supplied_node_engine_authority",
              detail: { refused_fields: callerAuthorityFields }
            })
          );
        }
        const committedTargetAuthorityFields = CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS.filter((field) =>
          Object.prototype.hasOwnProperty.call(args ?? {}, field)
        );
        if (committedTargetAuthorityFields.length > 0) {
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
              reason: "caller_supplied_committed_slice_authority",
              detail: { refused_fields: committedTargetAuthorityFields }
            })
          );
        }
        const identityRefusal = refuseCallerSuppliedIdentityFields(args);
        if (identityRefusal) {
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
              reason: "caller_supplied_identity_carrier",
              detail: identityRefusal
            })
          );
        }

        const workspace = resolveWorkspaceRepo(workspaceRepos, args?.repo);

        void workspace;

        const subjectKind = classifyAgentDispatchSubject(args.subject);
        if (!isAcceptedSubjectForRole(args.role, subjectKind)) {
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: DISPATCH_BLOCKER_CODES.ROLE_POLICY_VIOLATION,
              reason: "subject_role_matrix_violation",
              detail: {
                role: args.role,
                subject_kind: subjectKind,
                subject: args.subject,
                accepted_subject_kinds: acceptedSubjectKindsForRole(args.role)
              }
            })
          );
        }

        const readinessDispatchRole = args.role === "worker" ? "implementation" : "read_only";
        let readiness = null;
        let privateHandoff = null;
        if (subjectKind !== AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE) {
          readiness = await validateDispatch({
            dir: workspace.dir,
            unitAddress: args.subject,
            dispatch_role: readinessDispatchRole,
            mode: "strict",

            suppress_live_graph_resolution: args.role === "worker"
          });

          if (readiness?.decision_code === DECISIONS_WRITE_SCOPE_FORBIDDEN_DECISION_CODE) {
            return jsonContent(buildBlockedDispatchResult({
              blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
              reason: DECISIONS_WRITE_SCOPE_FORBIDDEN_DECISION_CODE,
              detail: boundedRecoveryDetail(readiness, {
                readiness_reasons: readiness.reasons ?? []
              })
            }));
          }

          if (args.role === "worker") {
            const recoveryValues = Object.values(readiness.recovery ?? {});
            if (recoveryValues.includes("nonrecoverable_integrity_failure")) {
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
                reason: "canonical_carrier_revalidation_failed",
                detail: boundedRecoveryDetail(readiness, { issue: "admission_sidecar_integrity_failure" })
              }));
            }

            if (
              !graphDerivationRequiredForDispatch(readiness.recovery?.graph_impact) &&
              !readiness.dispatchable
            ) {
              const graphCode = graphBlockerCodeForReadiness(readiness);

              const readinessDecisionCode = readiness.decision_code;
              const nextAction = isPaidTier
                ? nextActionForDecisionCode(readinessDecisionCode, readiness.dispatch_role ?? readinessDispatchRole, false)
                : nextActionForFreeLocalDecisionCode(readinessDecisionCode, readiness.dispatch_role ?? readinessDispatchRole, false);
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: graphCode ?? DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                reason: graphCode ?? "work_record_not_dispatchable",
                detail: boundedRecoveryDetail(readiness, {
                  readiness_reasons: readiness.reasons ?? [],
                  ...(isPaidTier && Array.isArray(readiness.validation_hints) && readiness.validation_hints.length > 0
                    ? { readiness_validation_hints: readiness.validation_hints }
                    : {})
                }),
                nextAction
              }));
            }

            const initialNonrecoverableAdmissionState = [
              readiness.recovery?.admission_metrics,
              readiness.recovery?.target_resolution
            ].find((state) => typeof state === "string" && state.startsWith("nonrecoverable_"));
            if (initialNonrecoverableAdmissionState) {
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                reason: "admission_evidence_nonrecoverable",
                detail: boundedRecoveryDetail(readiness, { issue: initialNonrecoverableAdmissionState })
              }));
            }

            let recoveredGraphImpact = null;
            if (graphDerivationRequiredForDispatch(readiness.recovery?.graph_impact)) {
              let generated;
              try {
                generated = await generateGraphImpactEvidence({
                  dir: workspace.dir,
                  unitAddress: args.subject
                });
              } catch {

                return jsonContent(buildBlockedDispatchResult({
                  blockerCode: RUNTIME_BLOCKER_CODES.GRAPH_IMPACT_QUERY_ERROR,
                  reason: "graph_impact_query_error",
                  detail: boundedRecoveryDetail(readiness, { issue: "graph_generation_failed" })
                }));
              }
              if (generated?.graph_available !== true) {

                return jsonContent(buildBlockedDispatchResult({
                  blockerCode: RUNTIME_BLOCKER_CODES.GRAPH_IMPACT_QUERY_ERROR,
                  reason: "graph_head_unbuildable",
                  detail: boundedRecoveryDetail(readiness, { outcome: generated?.outcome ?? "graph_unavailable" })
                }));
              }

              recoveredGraphImpact = generated.graph_impact_envelope ?? null;
              if (!recoveredGraphImpact) {
                return jsonContent(buildBlockedDispatchResult({
                  blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                  reason: "graph_impact_recovery_failed",
                  detail: boundedRecoveryDetail(readiness, { outcome: generated?.outcome ?? "not_persisted" })
                }));
              }
            }

            readiness = await validateDispatch({
              dir: workspace.dir,
              unitAddress: args.subject,
              dispatch_role: readinessDispatchRole,
              mode: "strict",
              graph_impact: recoveredGraphImpact
            });

            if (Object.values(readiness.recovery ?? {}).includes("nonrecoverable_integrity_failure")) {
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
                reason: "canonical_carrier_revalidation_failed",
                detail: boundedRecoveryDetail(readiness, { issue: "admission_sidecar_integrity_failure" })
              }));
            }
            if (!readiness.dispatchable) {
              const graphCode = graphBlockerCodeForReadiness(readiness);
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: graphCode ?? DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                reason: graphCode ?? "work_record_not_dispatchable",
                detail: boundedRecoveryDetail(readiness, {
                  readiness_reasons: readiness.reasons ?? []
                })
              }));
            }

            const admissionStates = [
              readiness.recovery?.admission_metrics,
              readiness.recovery?.target_resolution
            ];
            const nonrecoverableAdmissionState = admissionStates.find((state) =>
              typeof state === "string" && state.startsWith("nonrecoverable_")
            );
            if (nonrecoverableAdmissionState) {
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: nonrecoverableAdmissionState === "nonrecoverable_integrity_failure"
                  ? RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID
                  : DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                reason: nonrecoverableAdmissionState === "nonrecoverable_integrity_failure"
                  ? "canonical_carrier_revalidation_failed"
                  : "admission_evidence_nonrecoverable",
                detail: boundedRecoveryDetail(readiness, { issue: nonrecoverableAdmissionState })
              }));
            }

            const admissionRecoverable =
              RECOVERABLE_DISPATCH_STATES.has(readiness.recovery?.admission_metrics) ||
              RECOVERABLE_DISPATCH_STATES.has(readiness.recovery?.target_resolution);
            if (admissionRecoverable) {
              let refreshed;
              try {
                refreshed = await refreshAdmissionEvidence({
                  dir: workspace.dir,
                  id: args.subject,
                  unitAddress: args.subject
                });
              } catch (error) {
                const integrityFailure = typeof error?.code === "string" && error.code.startsWith("sidecar_");
                return jsonContent(buildBlockedDispatchResult({
                  blockerCode: integrityFailure
                    ? RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID
                    : DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                  reason: integrityFailure
                    ? "canonical_carrier_revalidation_failed"
                    : "admission_evidence_recovery_failed",
                  detail: boundedRecoveryDetail(readiness, {
                    issue: error?.code ?? "admission_refresh_failed"
                  })
                }));
              }
              if (refreshed?.written !== true) {
                return jsonContent(buildBlockedDispatchResult({
                  blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                  reason: "admission_evidence_recovery_failed",
                  detail: boundedRecoveryDetail(readiness, {
                    issue: refreshed?.diagnostics?.[0]?.code ?? "admission_refresh_not_written"
                  })
                }));
              }
            }

            const launchIntent = await validateLaunchIntent({
              dir: workspace.dir,
              unitAddress: args.subject,
              dispatch_role: readinessDispatchRole,
              mode: "strict",
              graph_impact: recoveredGraphImpact
            });
            readiness = launchIntent.readiness;
            privateHandoff = launchIntent.private_handoff;
            const preNodeEngineAdmissionIssue = strictAdmissionComponentIssue(readiness);
            if (preNodeEngineAdmissionIssue === "nonrecoverable_integrity_failure") {
              privateHandoff = null;
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
                reason: "canonical_carrier_revalidation_failed",
                detail: boundedRecoveryDetail(readiness, { issue: preNodeEngineAdmissionIssue })
              }));
            }
            if (!readiness.dispatchable) {
              const graphCode = graphBlockerCodeForReadiness(readiness);
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: graphCode ?? DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                reason: graphCode ?? "work_record_not_dispatchable",
                detail: boundedRecoveryDetail(readiness)
              }));
            }
            if (!hasValidPrivateHandoff(privateHandoff)) {
              privateHandoff = null;
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
                reason: "canonical_carrier_revalidation_failed",
                detail: { issue: "private_handoff_invalid" }
              }));
            }
            if (preNodeEngineAdmissionIssue) {
              const stillRecoverable = RECOVERABLE_DISPATCH_STATES.has(preNodeEngineAdmissionIssue);
              privateHandoff = null;
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                reason: stillRecoverable
                  ? "admission_evidence_recovery_failed"
                  : "admission_evidence_nonrecoverable",
                detail: boundedRecoveryDetail(readiness, { issue: preNodeEngineAdmissionIssue })
              }));
            }

            readiness = await validateDispatch({
              dir: workspace.dir,
              unitAddress: args.subject,
              dispatch_role: readinessDispatchRole,
              mode: "strict",
              node_engine_admissibility: true,
              graph_impact: recoveredGraphImpact
            });
            const neRefusal = nodeEngineRefusal(readiness);
            if (neRefusal) {
              privateHandoff = null;
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: neRefusal.code,
                reason: neRefusal.reason,
                detail: boundedRecoveryDetail(readiness, {
                  admissibility_status: readiness.admissibility?.status ?? null,
                  diagnostic_code: readiness.admissibility?.diagnostic_code ?? null
                })
              }));
            }

            const finalRevalidation = await revalidatePrivateHandoff({
              dir: workspace.dir,
              unitAddress: args.subject,
              private_handoff: privateHandoff
            });
            privateHandoff = null;
            if (!finalRevalidation.valid) {
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: RUNTIME_BLOCKER_CODES.WORKER_ADMISSION_CARRIER_INVALID,
                reason: finalRevalidation.reason,
                detail: { issue: finalRevalidation.issue }
              }));
            }
          }

          if (!readiness.dispatchable) {
            const graphCode = graphBlockerCodeForReadiness(readiness);
            const readinessDecisionCode = readiness.decision_code;
            const nextAction = isPaidTier
              ? nextActionForDecisionCode(readinessDecisionCode, readiness.dispatch_role ?? readinessDispatchRole, false)
              : nextActionForFreeLocalDecisionCode(readinessDecisionCode, readiness.dispatch_role ?? readinessDispatchRole, false);
            return jsonContent(buildBlockedDispatchResult({
              blockerCode: graphCode ?? DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
              reason: graphCode ?? "work_record_not_dispatchable",
              detail: boundedRecoveryDetail(readiness, {
                readiness_reasons: readiness.reasons ?? [],
                ...(isPaidTier && Array.isArray(readiness.validation_hints) && readiness.validation_hints.length > 0
                  ? { readiness_validation_hints: readiness.validation_hints }
                  : {})
              }),
              nextAction
            }));
          }
        }

        if (
          (args.role === "reviewer" || args.role === "redteam") &&
          subjectKind !== AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE
        ) {
          const findingsOnlySubject = await loadReviewerSubjectAdmissionContext({
            dir: workspace.dir,
            unitAddress: args.subject
          });
          if (findingsOnlySubject == null) {
            return jsonContent(
              buildBlockedDispatchResult({
                blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                reason: args.role === "reviewer"
                  ? "reviewer_subject_unreadable"
                  : "redteam_subject_unreadable",
                detail: { subject: args.subject }
              })
            );
          }
          if (findingsOnlySubject.write_scope.length > 0) {
            let committedSliceAdmission = null;
            if ((args.role === "reviewer" || args.role === "redteam") &&
                typeof dispatchBackend?.prepareCanonicalCommittedSliceReviewAdmission === "function") {
              committedSliceAdmission = await dispatchBackend.prepareCanonicalCommittedSliceReviewAdmission({
                subject: args.subject,
                workspace_dir: workspace.dir
              });
            }
            const launcherOwnedExactSliceReview = (args.role === "reviewer" || args.role === "redteam") &&
              (committedSliceAdmission?.ok === true ||
                dispatchBackend?.isLauncherOwnedExactSliceReviewAdmission?.({
                  subject: args.subject,
                  workspace_dir: workspace.dir
                }) === true);
            if (launcherOwnedExactSliceReview) {

            } else if (committedSliceAdmission !== null) {
              return jsonContent(
                buildBlockedDispatchResult({
                  blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                  reason: committedSliceAdmission.reason ?? "canonical_committed_slice_review_refused",
                  detail: {
                    subject: args.subject,
                    code: committedSliceAdmission.code ?? null
                  }
                })
              );
            } else {
              return jsonContent(
                buildBlockedDispatchResult({
                  blockerCode: DISPATCH_BLOCKER_CODES.ROLE_POLICY_VIOLATION,
                  reason: args.role === "reviewer"
                    ? "reviewer_write_scope_nonempty"
                    : "redteam_write_scope_nonempty",
                  detail: {
                    subject: args.subject,
                    role: args.role,
                    subject_kind: subjectKind,
                    subject_title: findingsOnlySubject.title,
                    record_id: findingsOnlySubject.record_id,
                    slice_id: findingsOnlySubject.slice_id,
                    observed_write_scope_size: findingsOnlySubject.write_scope.length,
                    required_write_scope: [],
                    cause_classification: "coordination_wk_shape_issue",
                    remediation: {
                      action: args.role === "reviewer"
                        ? "create_or_select_separate_findings_only_review_unit"
                        : "create_or_select_separate_findings_only_redteam_unit",
                      suggested_unit_id_examples: args.role === "reviewer"
                        ? ["WK-#####review", "WK-#####implementation-review"]
                        : ["WK-#####redteam", "WK-#####implementation-redteam"],
                      work_kind: args.role === "reviewer" ? "review" : args.role,
                      write_scope: [],
                      repo_paths: findingsOnlySubject.repo_paths,
                      depends_on: [args.subject],
                      acceptance: args.role === "reviewer"
                        ? [
                            "Findings-only review.",
                            "Do not modify files.",
                            "Report findings against the inspected files."
                          ]
                        : [
                            "Findings-only redteam.",
                            "Do not modify files.",
                            "Report adversarial findings against the inspected implementation."
                          ]
                    }
                  }
                })
              );
            }
          }
        }

        const admissionDetail = {
          role: args.role,
          subject: args.subject,
          subject_kind: subjectKind,
          readiness: readiness
            ? {
                decision_code: readiness.decision_code,
                dispatchable: readiness.dispatchable,
                record_id: readiness.record_id ?? null,
                unit: readiness.unit ?? null
              }
            : null
        };

        if (!dispatchBackend) {
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
              reason: DISPATCH_LAUNCH_BACKEND_REASON,
              detail: {
                ...DISPATCH_LAUNCH_BACKEND_DETAIL,
                admission: admissionDetail
              }
            })
          );
        }

        const dispatchApp = args?.app;
        const dispatchModel = args?.model;
        const launch = await dispatchBackend.startLaunch({
          caller_session_id: dispatchSessionIdentity,
          role: args.role,
          subject: args.subject,
          workspace_alias: workspace.repo,
          workspace_dir: workspace.dir,
          readiness: admissionDetail.readiness,
          app: dispatchApp,
          model: dispatchModel
        });
        if (!launch || launch.accepted !== true) {
          const refusal = launch?.refusal ?? {};
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: mapBackendRefusalToDispatchCode(refusal.code),
              reason: refusal.reason ?? "launch_backend_refused",
              detail: {
                app: dispatchApp,
                backend_refusal: refusal.detail ?? null,
                admission: admissionDetail
              }
            })
          );
        }
        return jsonContent({
          schema_version: AGENT_DISPATCH_SCHEMA_VERSION,
          accepted: true,
          transport: "mcp",
          run_id: launch.run_id,
          monitor_handle: launch.monitor_handle,
          app: launch.app ?? dispatchApp,
          model: launch.model ?? dispatchModel ?? null,
          backend: launch.backend ?? null,
          role: launch.role,
          subject: launch.subject,
          subject_kind: subjectKind,
          status: launch.status,
          terminal: launch.terminal,
          started_at: launch.started_at,
          updated_at: launch.updated_at,
          ...(launch.review_result ? { review_result: launch.review_result } : {}),
          readiness: admissionDetail.readiness,
          final_result: launch.final_result ?? null,
          blocker: null
        });
      } catch (error) {
        return jsonContent(
          buildBlockedDispatchResult({
            blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
            reason: "dispatch_tool_exception",
            detail: buildDispatchToolExceptionDetail(AGENT_DISPATCH_TOOL_NAME, error)
          })
        );
      }
    }
  );

  registerTool(
    COMMITTED_SLICE_INTEGRATION_TOOL_NAME,
    {
      description:
        "Request exact committed-slice integration as an orchestrator continuation. A slice with no remaining tree delta succeeds idempotently with empty_delivery:true and leaves the WK ref unchanged even when its tip is a proper ancestor, its worktree is absent, or lifecycle/review evidence is absent or ambiguous. Findings-only reviewer and redteam results are append-only advisory evidence with no admission or veto authority; clean output cannot authorize and findings cannot prohibit this operation. The orchestrator may accept, reject, or defer individual retained findings, but those dispositions are request facts, not authorization. CCE alone owns any configured organization-policy decision. Paid-tier presence by itself configures no gate and implies no decision. With no configured gate the server proceeds on DEC-0133 free substrate and reports a non-audit posture; with a configured gate, a missing, unavailable, malformed, unratified, denied, or target-mismatched CCE decision fails closed. Input is closed to repo alias, canonical slice subject, and advisory dispositions; refs, SHAs, receipts, review results, policy verdicts, CCE attestations, liveness, and other authority carriers are rejected. The server re-derives the exact target and performs CAS-safe idempotent integration exactly once.",
      inputSchema: z.object({
        repo: z.string().optional(),
        subject: z.string(),
        dispositions: z.array(z.object({
          review_run_id: z.string(),
          finding_id: z.string(),
          disposition: z.enum(["accept", "reject", "defer"])
        }).strict()).optional(),
        ...Object.fromEntries(
          [
            ...CALLER_NODE_ENGINE_AUTHORITY_FIELDS,
            ...CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS,
            ...CALLER_CCE_POLICY_AUTHORITY_FIELDS
          ].map((field) => [field, z.unknown().optional()])
        )
      }).strict()
    },
    async (args) => {
      try {
        const refusedFields = [
          ...CALLER_NODE_ENGINE_AUTHORITY_FIELDS,
          ...CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS,
          ...CALLER_CCE_POLICY_AUTHORITY_FIELDS
        ].filter((field) => Object.prototype.hasOwnProperty.call(args ?? {}, field));
        if (refusedFields.length > 0) {
          return jsonContent(buildBlockedDispatchResult({
            blockerCode: DISPATCH_BLOCKER_CODES.CALLER_SUPPLIED_IDENTITY,
            reason: "caller_supplied_integration_authority",
            detail: { refused_fields: refusedFields }
          }));
        }
        if (typeof args?.subject !== "string" || !/^WK-\d{4}#SLICE-\d{3}$/u.test(args.subject)) {
          return jsonContent(buildBlockedDispatchResult({
            blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
            reason: "committed_slice_integration_subject_invalid",
            detail: { subject: typeof args?.subject === "string" ? args.subject : null }
          }));
        }
        resolveWorkspaceRepo(workspaceRepos, args?.repo);
        if (typeof dispatchBackend?.requestCommittedSliceIntegration !== "function") {
          return jsonContent(buildBlockedDispatchResult({
            blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
            reason: "committed_slice_integration_backend_unavailable",
            detail: { missing_backend: "requestCommittedSliceIntegration" }
          }));
        }
        const result = await dispatchBackend.requestCommittedSliceIntegration({
          subject: args.subject,
          dispositions: args.dispositions
        });
        if (result?.integrated === true) {
          return jsonContent({
            schema_version: "workspace-integrate-committed-slice.v1",
            accepted: true,
            subject: args.subject,
            integration: result,
            blocker: null
          });
        }
        const refusal = result?.refusal ?? null;
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: refusal?.code?.includes("unavailable") || refusal?.code?.includes("missing")
            ? DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE
            : DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
          reason: refusal?.reason ?? result?.reason ?? "committed_slice_integration_refused",
          detail: refusal === null
            ? (typeof result?.code === "string" ? { code: result.code } : null)
            : { cce_policy_refusal: refusal }
        }));
      } catch (error) {
        return jsonContent(buildBlockedDispatchResult({
          blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
          reason: "dispatch_tool_exception",
          detail: buildDispatchToolExceptionDetail(COMMITTED_SLICE_INTEGRATION_TOOL_NAME, error)
        }));
      }
    }
  );

  registerTool(
    WK_FORGE_HANDOFF_TOOL_NAME,
    {
      description:
        "Request publication of the exact terminal candidate through the host forge executor. Reviewer and redteam results are advisory evidence: clean output cannot authorize and findings cannot veto. CCE alone decides a configured organization-policy gate; paid tier alone configures no policy. Configured missing, unavailable, malformed, unratified, denied, or target-mismatched evidence fails closed; no configured gate follows DEC-0133 free substrate and reports non-audit. Orchestrator/operator only. Input is closed to a workspace alias and canonical record-level assigned_unit. The server derives L/W/B/C, candidate-bound record, materialization, remote, branch, and PR. After restart it reads only the fixed current-candidate ref: a present target is mechanically recovered, while an absent ref triggers deterministic first-cycle construction and absent-ref expected-old CAS before exact validation. Monitor memory, historical bindings, and legacy candidate refs are irrelevant. Per DEC-0169, later landing-ref movement does not invalidate review or block publication of unchanged C; merge readiness belongs to the configured merge actor and CCE policy. Missing, ambiguous, moved, or inconsistent required Git/object/record/remote facts other than normal current-ref absence refuse. Exact branch and PR state recovers without duplication. Credentials and raw process output never enter requests or results.",
      inputSchema: z.object({
        repo: z.string().optional(),
        assigned_unit: z.string()
      }).strict()
    },
    async (args) => {
      try {
        const assignedUnit = args?.assigned_unit;
        if (typeof assignedUnit !== "string" || !/^WK-\d{4}$/u.test(assignedUnit)) {
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: "wk_forge_handoff_subject_invalid",
              detail: { assigned_unit: typeof assignedUnit === "string" ? assignedUnit : null }
            })
          );
        }

        resolveWorkspaceRepo(workspaceRepos, args?.repo);
        if (typeof wkForgeHandoffAdapter !== "function") {
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: DISPATCH_BLOCKER_CODES.BACKEND_UNAVAILABLE,
              reason: "wk_forge_handoff_executor_unavailable",
              detail: { missing_backend: "wk_forge_handoff_adapter" }
            })
          );
        }
        const outcome = await wkForgeHandoffAdapter({ assigned_unit: assignedUnit });
        if (outcome && outcome.accepted === true) {
          return jsonContent({
            schema_version: "workspace-wk-forge-handoff.v1",
            assigned_unit: assignedUnit,
            forge_handoff: outcome.forge_handoff,
            blocker: null
          });
        }
        const refusal = (outcome && typeof outcome.refusal === "object" && outcome.refusal !== null)
          ? outcome.refusal
          : {};
        const blockerCode =
          mapBackendRefusalToDispatchCode(refusal.code) ??
          DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED;
        return jsonContent(
          buildBlockedDispatchResult({
            blockerCode,
            reason: typeof refusal.reason === "string" ? refusal.reason : "wk_forge_handoff_refused",
            detail: refusal.detail ?? (typeof refusal.category === "string"
              ? { category: refusal.category }
              : null)
          })
        );
      } catch (error) {
        return jsonContent(
          buildBlockedDispatchResult({
            blockerCode: DISPATCH_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
            reason: "dispatch_tool_exception",
            detail: buildDispatchToolExceptionDetail(WK_FORGE_HANDOFF_TOOL_NAME, error)
          })
        );
      }
    }
  );

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
    isPaidTier
  };

  registerRunMonitorRoutes(ctx);
  registerDiagnosticRoutes(ctx);
}
