

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
  resolveNeedsReviewEnumerableRecovery
} from "@agent-chassis/wiki-core/src/lib/work-record-dispatch-node-engine-admissibility-recovery-projection.mjs";

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
import { prepareCommittedHeadGraphAdmission } from "./graph-admission.mjs";
import { registerCommittedSliceIntegrationRoute } from "./committed-slice-integration-route.mjs";
import { registerForgeHandoffRoute } from "./forge-handoff-route.mjs";

const DISPATCH_LAUNCH_BACKEND_REASON = "launch_backend_unavailable";
const DISPATCH_LAUNCH_BACKEND_DETAIL = Object.freeze({
  missing_backend: "workspace_agent_run_lifecycle",
  intended_owner: "WK-0526#launcher-admission-wiring",
  description:
    "No launcher-side update seam is wired to advance workspace_agent_dispatch monitor handles from pending_launch through launching/running/terminal. Dispatch fails closed at admission so callers see a stable structured blocker instead of an indefinitely pending monitor handle. A separate WK must deliver the launch backend; agents must not work around this with wrapper, shell, env, bwrap, temp worktree, or graph-impact side-channel launch."
});

const DECISIONS_WRITE_SCOPE_FORBIDDEN_DECISION_CODE = "decisions_write_scope_forbidden";

const WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION = "worker_admission.recovery.v1";
const WORKER_ADMISSION_RECOVERY_ACTION_MAX = 16;
const WORKER_ADMISSION_RECOVERY_TOKEN_MAX = 24;
const WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX = 128;
const WORKER_ADMISSION_REASON_FACT_MAX = 24;

const WORKER_ADMISSION_REASON_OBSERVED_STRING_MAX = 257;
const REVIEW_THRESHOLD_REASON_CODES = new Set([
  "review_threshold_exceeded",
  "worker_admission.work_unit_atomicity.review_threshold_exceeded.v1"
]);
const KNOWN_NEEDS_REVIEW_REASON_CODES = new Set([
  ...REVIEW_THRESHOLD_REASON_CODES,
  "request_schema_unrecognized"
]);
const KNOWN_NEEDS_REVIEW_REASON_PREFIXES = Object.freeze([
  "accepted_authority_",
  "review_attestation_"
]);

const MANAGED_CORRECTIVE_CONTINUATION_CODE =
  "agent_launch.managed_run.corrective_integrated_state_unresolved.v1";
const CANONICAL_INTEGRATED_STATE_IMPOSSIBLE_CODE =
  "agent_launch.canonical_integrated_lifecycle_state.impossible.v1";
const MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND =
  "agent_launch.managed_run.corrective_status_reconciliation.v1";
const CANONICAL_STATUS_VALUES = Object.freeze([
  "todo", "active", "blocked", "review", "done"
]);

function projectManagedCorrectiveStatusRecovery(refusal, subject) {
  if (refusal?.reason !== "managed_run_identity_check_threw") return null;
  const source = refusal?.detail;
  const observed = source?.observed_canonical_status;
  const recovery = source?.recovery;
  if (source?.code !== MANAGED_CORRECTIVE_CONTINUATION_CODE ||
      source?.cause_code !== CANONICAL_INTEGRATED_STATE_IMPOSSIBLE_CODE ||
      !observed || typeof observed !== "object" || Array.isArray(observed) ||
      !recovery || typeof recovery !== "object" || Array.isArray(recovery) ||
      recovery.recovery_kind !== MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND ||
      recovery.responsible_actor !== "coordinator" ||
      recovery.next_action !== "reissue_subject_dispatch_after_canonical_status_reconciliation" ||
      recovery.slice_unit !== subject ||
      recovery.unit !== observed.record_id ||
      !CANONICAL_STATUS_VALUES.includes(observed.parent_status) ||
      !CANONICAL_STATUS_VALUES.includes(observed.slice_status) ||
      observed.parent_status !== recovery.observed?.parent_status ||
      observed.slice_status !== recovery.observed?.slice_status ||
      recovery.expected?.parent_status !== "active" ||
      recovery.expected?.slice_status !== "todo") {
    return null;
  }

  const unit = recovery.unit;
  return {
    blockerCode: RUNTIME_BLOCKER_CODES.MANAGED_CORRECTIVE_STATUS_RECONCILIATION_REQUIRED,
    reason: "corrective_status_reconciliation_required",
    detail: {
      observed: {
        parent_status: observed.parent_status,
        slice_status: observed.slice_status
      },
      expected: {
        parent_status: "active",
        slice_status: "todo"
      },
      recovery_kind: MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND,
      unit,
      slice_unit: subject,
      next_call: {
        route: "workspace_agent_dispatch",
        arguments: { role: "worker", subject }
      }
    },
    nextAction: `workspace_work_record_set_status(unit=${unit}, status=active)`
  };
}

function projectManagedParentReviewRecovery(refusal, subject) {
  if (refusal?.reason !== "managed_parent_wk_review_blocks_worker_dispatch") return null;
  const source = refusal?.detail;
  if (!source || typeof source !== "object" || Array.isArray(source) ||
      source.parent_status !== "review") {
    return null;
  }

  const unit = typeof source.record_id === "string"
    ? source.record_id
    : String(subject).split("#", 1)[0];
  return {
    blockerCode: RUNTIME_BLOCKER_CODES.MANAGED_PARENT_WK_REVIEW_BLOCKS_WORKER_DISPATCH,
    reason: "managed_parent_wk_review_blocks_worker_dispatch",
    detail: {
      ...source,
      actor_recovery: "coordinator",
      recovery_route: "reconcile_parent_wk_review_state",
      next_action: "workspace_agent_dispatch",
      next_action_args: { role: "worker", subject },
      next_action_call: `workspace_agent_dispatch(role=worker, subject=${subject})`
    },
    nextAction: `workspace_work_record_set_status(unit=${unit}, status=active)`
  };
}

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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedRecoveryToken(value) {
  if (typeof value !== "string") return null;
  if (value.length === 0 || value.length > WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX) {
    return null;
  }
  return value;
}

function boundedOpaqueControlId(value) {
  return boundedRecoveryToken(value);
}

function projectRecoveryTokens(value) {
  if (value === undefined) return { valid: true, value: undefined };
  if (!Array.isArray(value) || value.length > WORKER_ADMISSION_RECOVERY_TOKEN_MAX) {
    return { valid: false };
  }
  const tokens = [];
  for (const item of value) {
    const token = boundedRecoveryToken(item);
    if (!token) return { valid: false };
    tokens.push(token);
  }
  return { valid: true, value: tokens };
}

function projectCompactRecoveryAction(action) {
  if (!isRecord(action)) return null;
  const projected = { kind: action.kind };
  for (const key of ["reason_codes", "problem_types", "fields", "controls"]) {
    const tokens = projectRecoveryTokens(action[key]);
    if (!tokens.valid) return null;
    if (tokens.value !== undefined) projected[key] = tokens.value;
  }
  if (action.remedy_guidance !== undefined) {
    projected.remedy_guidance = action.remedy_guidance;
  }
  return projected;
}

function projectCompactRecoveryV1(candidate) {
  const recovery = resolveNeedsReviewEnumerableRecovery({ recovery: candidate, reasons: [] });
  if (!recovery || recovery.schema_version !== WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION) {
    return null;
  }
  if (
    !Array.isArray(recovery.actions) ||
    recovery.actions.length === 0 ||
    recovery.actions.length > WORKER_ADMISSION_RECOVERY_ACTION_MAX
  ) {
    return null;
  }
  const actions = recovery.actions.map(projectCompactRecoveryAction);
  if (actions.some((action) => action === null)) return null;
  return {
    schema_version: recovery.schema_version,
    projection_mode: recovery.projection_mode,
    authority: recovery.authority,
    requires_resubmission: recovery.requires_resubmission,
    truncated: recovery.truncated,
    actions
  };
}

function knownNeedsReviewReasonCode(value) {
  const code = boundedRecoveryToken(value);
  if (!code) return null;
  if (KNOWN_NEEDS_REVIEW_REASON_CODES.has(code)) return code;
  return KNOWN_NEEDS_REVIEW_REASON_PREFIXES.some((prefix) => code.startsWith(prefix))
    ? code
    : null;
}

function projectReasonFact(value, { allowBoundedStringObserved = false } = {}) {
  if (!isRecord(value)) return { state: "ignored" };
  const allowedKeys = new Set([
    "reason_code", "code", "reason_family", "control", "field", "observed", "threshold",
    "evidence_keys"
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return { state: "ignored" };
  const reasonCode = knownNeedsReviewReasonCode(value.reason_code ?? value.code);
  if (!reasonCode) return { state: "ignored" };
  const fact = { reason_code: reasonCode };
  const reasonFamily = boundedRecoveryToken(value.reason_family);
  if (value.reason_family !== undefined && !reasonFamily) return { state: "mismatch" };
  if (reasonFamily) fact.reason_family = reasonFamily;
  const control = boundedOpaqueControlId(value.control);
  if (value.control !== undefined && !control) return { state: "mismatch" };
  if (control) fact.control = control;
  const field = boundedOpaqueControlId(value.field);
  if (value.field !== undefined && !field) return { state: "mismatch" };
  if (field) fact.field = field;
  if (
    value.observed === null ||
    typeof value.observed === "boolean" ||
    (typeof value.observed === "number" && Number.isFinite(value.observed))
  ) {
    fact.observed = value.observed;
  } else if (
    allowBoundedStringObserved &&
    typeof value.observed === "string" &&
    value.observed.length <= WORKER_ADMISSION_REASON_OBSERVED_STRING_MAX
  ) {
    fact.observed = value.observed;
  } else if (value.observed !== undefined) {
    return { state: "mismatch" };
  }
  if (typeof value.threshold === "number" && Number.isFinite(value.threshold)) {
    fact.threshold = value.threshold;
  } else if (value.threshold !== undefined) {
    return { state: "mismatch" };
  }
  return { state: "projected", fact };
}

function projectReasonFacts(sources) {
  const projected = [];
  const seen = new Set();
  let mismatch = false;
  for (const { values, allowBoundedStringObserved = false } of sources) {
    if (!Array.isArray(values)) continue;
    for (const value of values.slice(0, WORKER_ADMISSION_REASON_FACT_MAX)) {
      const result = projectReasonFact(value, { allowBoundedStringObserved });
      if (result.state === "mismatch") {
        mismatch = true;
        continue;
      }
      if (result.state !== "projected") continue;
      const { fact } = result;
      const signature = JSON.stringify(fact);
      if (seen.has(signature)) continue;
      seen.add(signature);
      projected.push(fact);
      if (projected.length === WORKER_ADMISSION_REASON_FACT_MAX) {
        return { facts: projected, mismatch };
      }
    }
  }
  return { facts: projected, mismatch };
}

function selectedUnitForNeedsReview(subject, recovery) {
  const match = /^(WK-\d{4})(?:#([^\s]+))?$/u.exec(subject ?? "");
  if (!match) return null;
  const selectedAddress = recovery?.selected_unit_address;
  if (selectedAddress !== undefined && selectedAddress !== null && selectedAddress !== subject) {
    return null;
  }
  return {
    kind: match[2] ? "slice" : "work_item",
    address: subject,
    record_id: match[1],
    slice_id: match[2] ?? null
  };
}

function recoveryNextAction(recoveryState, recovery) {
  if (recoveryState === "projection_mismatch") {
    return "Preserve the needs_review refusal; ask the operator or CCE owner to repair worker_admission.recovery.v1, then revalidate.";
  }
  if (recoveryState === "legacy_reason_facts") {
    return "Use the returned bounded reason facts for structured scope repair or the established operator route, then revalidate without inferring controls.";
  }
  const kinds = [...new Set(recovery.actions.map((action) => action.kind))];
  if (kinds.length === 1 && kinds[0] === "obtain_review_attestation") {
    return "Run workspace_work_record_shape_review_unit, workspace_agent_dispatch, workspace_agent_run_status, workspace_record_review_attestation, then workspace_validate_dispatch.";
  }
  if (kinds.length === 1 && kinds[0] === "split_or_reduce_scope") {
    return "Use workspace_work_record_contract_edit to split or reduce the selected unit, then run workspace_validate_dispatch.";
  }
  return "Follow the bounded CCE recovery action group without substitution or local reordering, then run workspace_validate_dispatch.";
}

function projectNeedsReviewRefusal({ readiness, refusal, subject }) {
  const admissibility = readiness?.admissibility;
  const backendRecovery = refusal?.detail?.remote_needs_review_recovery;
  const readinessRecoveryState = admissibility?.recovery_projection_state;
  const rawCandidates = [];
  let recoveryFieldPresent = false;
  let explicitMismatch = backendRecovery?.recovery_source === "cce_recovery_v1_projection_mismatch";

  if (readinessRecoveryState === "valid") {
    recoveryFieldPresent = true;
  } else if (readinessRecoveryState === "projection_mismatch") {
    recoveryFieldPresent = true;
    explicitMismatch = true;
  } else if (readinessRecoveryState !== undefined && readinessRecoveryState !== "absent") {
    explicitMismatch = true;
  }

  if (admissibility && Object.hasOwn(admissibility, "recovery")) {
    recoveryFieldPresent = true;
    rawCandidates.push(admissibility.recovery);
  }
  if (admissibility?.needs_review_recovery?.schema_version === WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION) {
    recoveryFieldPresent = true;
    rawCandidates.push(admissibility.needs_review_recovery);
  }
  if (backendRecovery?.cce_recovery !== undefined) {
    recoveryFieldPresent = true;
    rawCandidates.push(backendRecovery.cce_recovery);
  } else if (backendRecovery?.classification === "cce_recovery_v1") {
    recoveryFieldPresent = true;
    explicitMismatch = true;
  }

  const recoveries = rawCandidates.map(projectCompactRecoveryV1);
  const missingValidReadinessRecovery = readinessRecoveryState === "valid" &&
    !(admissibility && Object.hasOwn(admissibility, "recovery"));
  const invalidRecovery = explicitMismatch || missingValidReadinessRecovery ||
    recoveries.some((recovery) => recovery === null);
  const distinctRecoveries = new Set(
    recoveries.filter(Boolean).map((recovery) => JSON.stringify(recovery))
  );
  const recoveryMismatch = invalidRecovery || distinctRecoveries.size > 1;
  const validRecovery = recoveryMismatch ? null : recoveries.find(Boolean) ?? null;
  const reasonProjection = projectReasonFacts([
    { values: backendRecovery?.reason_facts },
    {
      values: admissibility?.needs_review_recovery?.reason_facts,
      allowBoundedStringObserved: true
    },
    { values: admissibility?.reasons, allowBoundedStringObserved: true }
  ]);
  const reasonFacts = reasonProjection.facts;
  const selectedUnit = selectedUnitForNeedsReview(subject, backendRecovery);
  const unitMismatch = selectedUnit === null;
  const projectionMismatch = recoveryMismatch || reasonProjection.mismatch || unitMismatch;
  const effectiveRecovery = projectionMismatch ? null : validRecovery;
  const state = projectionMismatch
    ? "projection_mismatch"
    : effectiveRecovery
      ? "valid_recovery_v1"
      : "legacy_reason_facts";
  const detail = {
    refusal_kind: "worker_admission_remote_needs_review",
    admissibility_status: "needs_review",
    launch_authoritative: false,
    recovery_contract: state,
    ...(selectedUnit ? { selected_unit: selectedUnit } : {}),
    ...(reasonFacts.length > 0 ? { reason_facts: reasonFacts } : {}),
    ...(effectiveRecovery ? { worker_admission_recovery: effectiveRecovery } : {})
  };
  if (state === "projection_mismatch") {
    detail.recovery_mismatch = {
      code: "worker_admission_recovery_contract_mismatch",
      expected_schema_version: WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION,
      recovery_field_present: recoveryFieldPresent
    };
  }
  return { detail, nextAction: recoveryNextAction(state, effectiveRecovery) };
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

            const prepared = await prepareCommittedHeadGraphAdmission({
              readiness,
              dir: workspace.dir,
              unitAddress: args.subject,
              readinessDispatchRole,
              graphDerivationRequiredForDispatch,
              generateGraphImpactEvidence,
              validateDispatch,
              boundedRecoveryDetail
            });
            readiness = prepared.readiness;
            if (prepared.refusal) return jsonContent(prepared.refusal);
            const recoveredGraphImpact = prepared.recoveredGraphImpact;

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
              const needsReviewProjection = readiness.admissibility?.status === "needs_review"
                ? projectNeedsReviewRefusal({ readiness, subject: args.subject })
                : null;
              return jsonContent(buildBlockedDispatchResult({
                blockerCode: neRefusal.code,
                reason: neRefusal.reason,
                detail: needsReviewProjection?.detail ?? boundedRecoveryDetail(readiness, {
                  admissibility_status: readiness.admissibility?.status ?? null,
                  diagnostic_code: readiness.admissibility?.diagnostic_code ?? null
                }),
                nextAction: needsReviewProjection?.nextAction ?? null
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
          const correctiveRecovery = projectManagedCorrectiveStatusRecovery(refusal, args.subject);
          const parentReviewRecovery = projectManagedParentReviewRecovery(refusal, args.subject);
          const needsReviewRecovery = refusal.reason === "worker_admission_remote_needs_review"
            ? projectNeedsReviewRefusal({ readiness, refusal, subject: args.subject })
            : null;
          return jsonContent(
            buildBlockedDispatchResult({
              blockerCode: correctiveRecovery?.blockerCode ?? parentReviewRecovery?.blockerCode ?? mapBackendRefusalToDispatchCode(refusal.code),
              reason: correctiveRecovery?.reason ?? parentReviewRecovery?.reason ?? refusal.reason ?? "launch_backend_refused",
              detail: correctiveRecovery?.detail ?? parentReviewRecovery?.detail ?? needsReviewRecovery?.detail ?? {
                app: dispatchApp,
                backend_refusal: refusal.detail ?? null,
                admission: admissionDetail
              },
              nextAction: correctiveRecovery?.nextAction ?? parentReviewRecovery?.nextAction ?? needsReviewRecovery?.nextAction ?? null
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

  registerCommittedSliceIntegrationRoute({
    registerTool, workspaceRepos, z, jsonContent, resolveWorkspaceRepo, dispatchBackend,
    committedSliceIntegrationToolName: COMMITTED_SLICE_INTEGRATION_TOOL_NAME,
    callerNodeEngineAuthorityFields: CALLER_NODE_ENGINE_AUTHORITY_FIELDS,
    callerCommittedSliceAuthorityFields: CALLER_COMMITTED_SLICE_AUTHORITY_FIELDS,
    callerCcePolicyAuthorityFields: CALLER_CCE_POLICY_AUTHORITY_FIELDS
  });

  registerForgeHandoffRoute({
    registerTool, workspaceRepos, z, jsonContent, resolveWorkspaceRepo,
    invokeWkForgeHandoffAdapter: typeof wkForgeHandoffAdapter === "function" ? async (assignedUnit) =>
      await wkForgeHandoffAdapter({ assigned_unit: assignedUnit }) : null
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
    isPaidTier
  };

  registerRunMonitorRoutes(ctx);
  registerDiagnosticRoutes(ctx);
}
