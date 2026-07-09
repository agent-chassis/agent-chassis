

import {
  AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
  BOOTSTRAP_STATE_CODES,
  CALLER_ROLE_KIND_VALUES,
  IDENTITY_REFUSAL_CODES,
  evaluateBootstrapReviewState,
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";
import {
  BACKEND_SUPPORTED_APPS
} from "@agent-chassis/agent-launch-core";
import {
  resolveExplicitOverrideSelection,
  resolveLauncherOverrideToken
} from "@agent-chassis/agent-launch-cli/src/lib/agent-launch-profiles.mjs";
import {
  validateWorkRecordDispatch
} from "@agent-chassis/wiki-core";

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
} from "./dispatch-tool-constants.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchToolExceptionDetail,
  classifyAgentDispatchSubject,
  isAcceptedSubjectForRole,
  loadReviewerSubjectAdmissionContext,
  mapBackendRefusalToDispatchCode
} from "./dispatch-tool-helpers.mjs";
import { registerRunMonitorRoutes } from "./dispatch-run-monitor-routes.mjs";

import {
  nextActionForDecisionCode,
  nextActionForFreeLocalDecisionCode
} from "./work-record-write-route-helpers.mjs";
import { REGISTERED_TIER_FREE_LOCAL, REGISTERED_TIER_PAID_CCE } from "./tool-profile.mjs";
import { registerDiagnosticRoutes } from "./dispatch-diagnostic-routes.mjs";

const DISPATCH_LAUNCH_BACKEND_REASON = "launch_backend_unavailable";
const DISPATCH_LAUNCH_BACKEND_DETAIL = Object.freeze({
  missing_backend: "workspace_agent_run_lifecycle",
  intended_owner: "WK-0526#launcher-admission-wiring",
  description:
    "No launcher-side update seam is wired to advance workspace_agent_dispatch monitor handles from pending_launch through launching/running/terminal. Dispatch fails closed at admission so callers see a stable structured blocker instead of an indefinitely pending monitor handle. A separate WK must deliver the launch backend; agents must not work around this with wrapper, shell, env, bwrap, temp worktree, or graph-impact side-channel launch."
});

function dispatchRoleForLauncherResolver(role) {
  return role === "reviewer" ? "review" : role;
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

function normalizeDispatchAppModelSelection({ role, app, model }) {
  const appToken = typeof app === "string" && app.trim().length > 0
    ? app.trim()
    : null;
  const modelToken = typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : null;

  if (appToken !== null && modelToken !== null) {
    const selection = resolveExplicitOverrideSelection({
      role: dispatchRoleForLauncherResolver(role),
      app: appToken,
      model: modelToken
    });
    if (!selection || selection.ok !== true) {
      return selection ?? {
        ok: false,
        reason: "launcher_override_unresolved",
        detail: { app: appToken, model: modelToken }
      };
    }
    return {
      ok: true,
      app: selection.app,
      model: selection.model
    };
  }

  if (modelToken !== null) {
    const selection = resolveLauncherOverrideToken(modelToken);
    if (selection.ok !== true) {
      return selection;
    }
    return {
      ok: true,
      app: selection.app,
      model: selection.model
    };
  }

  if (appToken !== null) {
    return {
      ok: true,
      app: appToken,
      model: null
    };
  }

  return {
    ok: false,
    reason: "app_required",
    detail: { supported_apps: [...BACKEND_SUPPORTED_APPS] }
  };
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
        "Dispatch a worker, reviewer, or redteam role through MCP. Stdio MCP is not an authentication boundary, so this runs as the local user owning the server process; caller-supplied identity carriers (request, prompt, env, argv, claimed_identity.role) are refused. Subject-role matrix: worker/reviewer take a WK or WK slice, redteam also an initiative; other pairings refuse. Readiness is validated through the dispatch readiness gate, and reviewer/redteam require an empty write_scope at admission (initiatives exempt). The launch app may be supplied explicitly as `app` or derived from a single typed `model` hint/override token that names either a registered model or an app with a registry app-default; missing both still refuses with `app_required`, and unsupported explicit apps refuse with unsupported_app. Incoherent explicit app/model pairs refuse before launch. There is no shell or wrapper launch fallback; with no launch backend configured, dispatch fails closed with backend_unavailable instead of minting a pending handle. The `model` field is read only from this typed field (never env, argv, prompt, request, or identity): Claude honors supported model hints via `--model` on the Claude CLI argv, while Codex and Agy refuse unsupported model hints before spawn with stable reasons model_hint_unsupported_for_codex_executor / model_hint_unsupported_for_agy_executor.",
      inputSchema: {
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
      }
    },
    async (args) => {
      try {
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
        if (subjectKind !== AGENT_DISPATCH_SUBJECT_KIND_INITIATIVE) {
          readiness = await validateWorkRecordDispatch({
            dir: workspace.dir,
            unitAddress: args.subject,
            dispatch_role: readinessDispatchRole,
            mode: "strict"
          });
          if (!readiness.dispatchable) {

            if (args.role === "worker" && readiness.state?.graph_auto_recoverable === true) {
              if (!graphImpactPersistenceAvailable()) {

                return jsonContent(
                  buildBlockedDispatchResult({
                    blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                    reason: "graph_impact_persistence_unavailable",
                    detail: {
                      missing_tool: GRAPH_IMPACT_PERSISTENCE_TOOL_NAME,
                      subject: args.subject,
                      readiness_decision_code: readiness.decision_code,
                      readiness_reasons: readiness.reasons ?? []
                    }
                  })
                );
              }

              const generated = await generateAndPersistWorkRecordGraphImpactByUnit({
                dir: workspace.dir,
                unitAddress: args.subject
              });
              if (generated?.written === true) {

                readiness = await validateWorkRecordDispatch({
                  dir: workspace.dir,
                  unitAddress: args.subject,
                  dispatch_role: readinessDispatchRole,
                  mode: "strict"
                });
              }
            }

            if (!readiness.dispatchable) {

              const readinessDecisionCode = readiness.decision_code;
              const nextAction = isPaidTier
                ? nextActionForDecisionCode(
                    readinessDecisionCode,
                    readiness.dispatch_role ?? readinessDispatchRole,
                    false
                  )
                : nextActionForFreeLocalDecisionCode(
                    readinessDecisionCode,
                    readiness.dispatch_role ?? readinessDispatchRole,
                    false
                  );
              const detail = {
                readiness_decision_code: readinessDecisionCode,
                readiness_reasons: readiness.reasons ?? []
              };

              if (
                isPaidTier &&
                Array.isArray(readiness.validation_hints) &&
                readiness.validation_hints.length > 0
              ) {
                detail.readiness_validation_hints = readiness.validation_hints;
              }
              return jsonContent(
                buildBlockedDispatchResult({
                  blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
                  reason: "work_record_not_dispatchable",
                  detail,
                  nextAction
                })
              );
            }
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

        const dispatchSelection = normalizeDispatchAppModelSelection({
          role: args.role,
          app: args?.app,
          model: args?.model
        });
        if (dispatchSelection.ok !== true) {
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: DISPATCH_BLOCKER_CODES.VALIDATION_FAILURE,
              reason: dispatchSelection.reason,
              detail: dispatchSelection.detail ?? null
            })
          );
        }

        const dispatchApp = dispatchSelection.app;
        const dispatchModel = dispatchSelection.model;
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
