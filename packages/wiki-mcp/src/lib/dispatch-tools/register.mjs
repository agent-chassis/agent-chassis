

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
  GRAPH_IMPACT_PERSISTENCE_TOOL_NAME
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

const RECOVERABLE_DISPATCH_STATES = new Set([
  "recoverable_missing",
  "recoverable_stale",
  "recoverable_outdated"
]);

const CALLER_NODE_ENGINE_AUTHORITY_FIELDS = Object.freeze([
  "node_engine",
  "node_engine_admissibility",
  "node_engine_configuration",
  "node_engine_classification",
  "node_engine_disposition",
  "node_engine_posture",
  "local_only_fail_open"
]);

function graphBlockerCodeForReadiness(readiness) {
  if (!new Set(["missing_graph_impact", "stale_write_scope"]).has(readiness?.decision_code)) {
    return null;
  }
  if (
    readiness?.recovery?.graph_impact === "not_required" ||
    readiness?.recovery?.graph_impact === "fresh"
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
        "Dispatch a worker, reviewer, or redteam role through MCP across the supported Codex, Claude, and Agy families. Explicit worker launch intent alone may derive typed recoverable graph/admission evidence; validate_dispatch and findings-only roles remain read-only, and fresh worker dispatch writes nothing. Recovery, canonical reloads, Node Engine or launcher-confirmed no-Node-Engine posture, and final private freshness/integrity revalidation all complete before provisioning or backend handoff. No standalone carrier-preparation API exists. The normal agent call supplies only `role` and `subject`; launcher-owned configuration selects Node Engine posture and the role model. Caller-supplied identity or Node Engine authority fields are rejected. There is no shell or wrapper fallback; with no launch backend configured, dispatch fails closed with backend_unavailable.",
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
          .optional()
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
            mode: "strict"
          });

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
              readiness.recovery?.graph_impact !== "recoverable_stale" &&
              !readiness.dispatchable
            ) {
              const graphCode = graphBlockerCodeForReadiness(readiness);
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: graphCode ?? DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                reason: graphCode ?? "work_record_not_dispatchable",
                detail: boundedRecoveryDetail(readiness, {
                  readiness_reasons: readiness.reasons ?? []
                })
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

            if (readiness.recovery?.graph_impact === "recoverable_stale") {
              if (!graphImpactPersistenceAvailable()) {
                return jsonContent(buildBlockedDispatchResult({
                  blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                  reason: "graph_impact_persistence_unavailable",
                  detail: boundedRecoveryDetail(readiness, { missing_tool: GRAPH_IMPACT_PERSISTENCE_TOOL_NAME })
                }));
              }
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
              if (generated?.written !== true) {
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
              mode: "strict"
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
              mode: "strict"
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
              node_engine_admissibility: true
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
