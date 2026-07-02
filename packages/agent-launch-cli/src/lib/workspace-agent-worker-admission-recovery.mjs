

import {
  extractReviewThresholdControlsFromRemoteAdmissionResult
} from "@agent-chassis/wiki-core/src/lib/review-attestation-pack-carry.mjs";

import {
  AGENT_ROLE_RESULT_REVIEWED_CONTROLS
} from "@agent-chassis/agent-launch-core/src/lib/agent-role-result.mjs";

export const WORKER_ADMISSION_REVIEW_THRESHOLD_TAXONOMY_CODE =
  "worker_admission_review_threshold_exceeded";

export const WORKER_ADMISSION_REJECT_THRESHOLD_TAXONOMY_CODE =
  "worker_admission_reject_threshold_exceeded";

const REJECT_THRESHOLD_REASON_CODES = Object.freeze(["reject_threshold_exceeded"]);

const PRECONDITION_REASON_CODES = Object.freeze([
  "precondition_graph_malformed",
  "unit_superseded",
  "dependency_cycle",
  "lifecycle_not_dispatchable",
  "unsatisfied_dependencies",
  "no_precondition_constraints"
]);

const PRECONDITION_REJECT_REASON_CODES = Object.freeze([
  "precondition_graph_malformed",
  "unit_superseded",
  "dependency_cycle",
  "lifecycle_not_dispatchable",
  "unsatisfied_dependencies"
]);

const WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION = "worker_admission.recovery.v1";
const WORKER_ADMISSION_RECOVERY_AUTHORITY = "advisory_recovery_only";
const WORKER_ADMISSION_RECOVERY_ACTION_SUMMARY_MAX = 16;
const WORKER_ADMISSION_RECOVERY_TOKEN_MAX = 24;
const WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX = 128;
const WORKER_ADMISSION_RECOVERY_NEXT_ACTION_MAX = 240;
const WORKER_ADMISSION_CURRENT_DECISION_RECOVERY_MODE = "bounded_current_decision_recovery";
const WORKER_ADMISSION_ROUTE_PROBLEM_RECOVERY_MODE = "route_problem_recovery";
const WORKER_ADMISSION_RECOVERY_ACTION_KINDS = new Set([
  "obtain_review_attestation",
  "obtain_accepted_authority",
  "split_or_reduce_scope",
  "fix_metrics",
  "fix_local_hard_refusal",
  "fix_precondition_graph",
  "wait_for_dependency",
  "fix_request_schema_digest",
  "fix_pack_input",
  "fix_non_object_data",
  "fix_precondition_graph_too_large",
  "fix_preparation_audit",
  "fix_evidence_trust",
  "fix_policy_profile",
  "provide_idempotency_key"
]);
const WORKER_ADMISSION_RECOVERY_TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "projection_mode",
  "authority",
  "requires_resubmission",
  "truncated",
  "actions"
]);
const WORKER_ADMISSION_RECOVERY_ACTION_FIELDS = new Set([
  "kind",
  "reason_codes",
  "problem_types",
  "fields",
  "controls",
  "next_action"
]);

export const WORK_RECORD_STATUS_TO_PRECONDITION_LIFECYCLE_STATE = Object.freeze({
  inbox: "inbox",
  todo: "todo",
  active: "active",
  review: "review",
  done: "done",
  blocked: "blocked",
  parked: "parked",
  cancelled: "cancelled"
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function hasOnlyAllowedFields(object, allowedFields) {
  return Object.keys(object).every((key) => allowedFields.has(key));
}

const ALLOWED_REASON_CODES = new Set([
  "review_threshold_exceeded",
  "reject_threshold_exceeded",
  "worker_admission.work_unit_atomicity.review_threshold_exceeded.v1",
  ...PRECONDITION_REASON_CODES
]);

const ALLOWED_CONTROL_IDS = new Set(AGENT_ROLE_RESULT_REVIEWED_CONTROLS);

function allowlistReasonCode(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_REASON_CODES.has(trimmed) ? trimmed : null;
}

function allowlistControlId(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  const trimmed = value.trim();
  return ALLOWED_CONTROL_IDS.has(trimmed) ? trimmed : null;
}

function normalizeObservedScalar(value) {
  if (value === null || typeof value === "boolean") {
    return { present: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { present: true, value } : { present: false };
  }
  return { present: false };
}

function extractPreconditionReason(decision) {
  if (!isObject(decision)) {
    return null;
  }
  const candidates = [];
  if (isObject(decision.reason)) {
    candidates.push(decision.reason);
  }
  if (Array.isArray(decision.reasons)) {
    candidates.push(...decision.reasons.filter((reason) => isObject(reason)));
  }
  if (Array.isArray(decision.pack_result_reasons)) {
    candidates.push(...decision.pack_result_reasons.filter((reason) => isObject(reason)));
  }
  for (const reason of candidates) {
    const code = allowlistReasonCode(reason.code);
    if (code && PRECONDITION_REASON_CODES.includes(code)) {
      return {
        code,
        evidence: isObject(reason.evidence) ? reason.evidence : Object.freeze({})
      };
    }
  }
  return null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => isNonEmptyString(entry)).map((entry) => entry.trim());
}

function projectRecoveryTokenList(value) {
  if (value === undefined) {
    return { valid: true, value: undefined };
  }
  if (!Array.isArray(value) || value.length > WORKER_ADMISSION_RECOVERY_TOKEN_MAX) {
    return { valid: false };
  }
  const tokens = [];
  for (const item of value) {
    if (
      !isNonEmptyString(item) ||
      item.length > WORKER_ADMISSION_RECOVERY_TOKEN_LENGTH_MAX
    ) {
      return { valid: false };
    }
    tokens.push(item.trim());
  }
  return { valid: true, value: tokens };
}

function projectRecoveryAction(action) {
  if (!isObject(action) || !hasOnlyAllowedFields(action, WORKER_ADMISSION_RECOVERY_ACTION_FIELDS)) {
    return null;
  }
  if (
    !isNonEmptyString(action.kind) ||
    !WORKER_ADMISSION_RECOVERY_ACTION_KINDS.has(action.kind)
  ) {
    return null;
  }
  const projected = { kind: action.kind.trim() };
  for (const key of ["reason_codes", "problem_types", "fields", "controls"]) {
    const tokens = projectRecoveryTokenList(action[key]);
    if (!tokens.valid) {
      return null;
    }
    if (tokens.value !== undefined) {
      projected[key] = tokens.value;
    }
  }
  if (action.next_action !== undefined) {
    if (
      !isNonEmptyString(action.next_action) ||
      action.next_action.length > WORKER_ADMISSION_RECOVERY_NEXT_ACTION_MAX
    ) {
      return null;
    }
    projected.next_action = action.next_action.trim();
  }
  return Object.freeze(projected);
}

function projectRecoverySummaryForMode(recovery, projectionMode) {
  if (
    !isObject(recovery) ||
    !hasOnlyAllowedFields(recovery, WORKER_ADMISSION_RECOVERY_TOP_LEVEL_FIELDS)
  ) {
    return null;
  }
  if (recovery.schema_version !== WORKER_ADMISSION_RECOVERY_SCHEMA_VERSION) {
    return null;
  }
  if (recovery.projection_mode !== projectionMode) {
    return null;
  }
  if (recovery.authority !== WORKER_ADMISSION_RECOVERY_AUTHORITY) {
    return null;
  }
  if (recovery.requires_resubmission !== true || typeof recovery.truncated !== "boolean") {
    return null;
  }
  if (
    !Array.isArray(recovery.actions) ||
    recovery.actions.length === 0 ||
    recovery.actions.length > WORKER_ADMISSION_RECOVERY_ACTION_SUMMARY_MAX
  ) {
    return null;
  }
  const actions = recovery.actions.map((action) => projectRecoveryAction(action));
  if (actions.some((action) => action === null)) {
    return null;
  }
  return Object.freeze({
    schema_version: recovery.schema_version,
    projection_mode: recovery.projection_mode,
    authority: recovery.authority,
    requires_resubmission: recovery.requires_resubmission,
    truncated: recovery.truncated,
    actions: Object.freeze(actions)
  });
}

function recoveryProjectionForMode(remote, projectionMode) {
  if (!isObject(remote) || !hasOwn(remote, "recovery")) {
    return { state: "absent", recovery: null };
  }
  const recovery = projectRecoverySummaryForMode(remote.recovery, projectionMode);
  return recovery
    ? { state: "valid", recovery }
    : { state: "projection_mismatch", recovery: null };
}

function uniqueActionTokens(actions, key) {
  return [
    ...new Set(
      actions
        .flatMap((action) => (Array.isArray(action[key]) ? action[key] : []))
        .filter((token) => isNonEmptyString(token))
    )
  ];
}

function selectedUnitRecoveryFacts(unit) {
  return {
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null
  };
}

function buildRecoveryProjectionMismatchDetail({ unit, isDenyOrReject, projectionLabel }) {
  const expectedProjection = isNonEmptyString(projectionLabel)
    ? projectionLabel
    : "current-decision";
  return Object.freeze({
    classification: "cce_recovery_projection_mismatch",
    recovery_source: "cce_recovery_v1_projection_mismatch",
    is_deny_or_reject: isDenyOrReject,
    ...selectedUnitRecoveryFacts(unit),
    authority_note:
      "CCE supplied a recovery field that this launcher could not validate as bounded " +
      `worker_admission.recovery.v1 ${expectedProjection} guidance. The launcher will not infer ` +
      "local recovery policy from malformed or out-of-scope recovery data.",
    next_actions: [
      "Ask the operator or CCE owner to fix the recovery.v1 projection contract, then resubmit and obtain a fresh CCE worker-admission decision."
    ]
  });
}

function buildCceRecoveryV1Detail({
  unit,
  remote,
  isDenyOrReject,
  projectionMode = WORKER_ADMISSION_CURRENT_DECISION_RECOVERY_MODE,
  projectionLabel = "current-decision"
}) {
  const projection = recoveryProjectionForMode(remote, projectionMode);
  if (projection.state === "absent") {
    return null;
  }
  if (projection.state === "projection_mismatch") {
    return buildRecoveryProjectionMismatchDetail({ unit, isDenyOrReject, projectionLabel });
  }
  const recovery = projection.recovery;
  const actionNextActions = recovery.actions
    .map((action) => action.next_action)
    .filter((nextAction) => isNonEmptyString(nextAction));
  return Object.freeze({
    classification: "cce_recovery_v1",
    recovery_source: "cce_recovery_v1",
    is_deny_or_reject: isDenyOrReject,
    ...selectedUnitRecoveryFacts(unit),
    cce_recovery: recovery,
    recovery_actions: recovery.actions,
    recovery_action_kinds: Object.freeze(recovery.actions.map((action) => action.kind)),
    reason_codes: Object.freeze(uniqueActionTokens(recovery.actions, "reason_codes")),
    problem_types: Object.freeze(uniqueActionTokens(recovery.actions, "problem_types")),
    fields: Object.freeze(uniqueActionTokens(recovery.actions, "fields")),
    controls: Object.freeze(uniqueActionTokens(recovery.actions, "controls")),
    authority_note:
      "CCE recovery.v1 actions are advisory resubmission guidance only. They are not " +
      "review evidence, accepted authority, admission, or launch authority; the worker " +
      "must resubmit and obtain a fresh CCE worker-admission decision.",
    next_actions: Object.freeze(
      actionNextActions.length > 0
        ? [
            ...actionNextActions,
            "After completing the advisory recovery action(s), resubmit and obtain a fresh CCE worker-admission decision before any launch."
          ]
        : [
            "Apply only the bounded CCE recovery.v1 action kind(s) and projected tokens, then resubmit and obtain a fresh CCE worker-admission decision before any launch."
          ]
    )
  });
}

export function buildRouteProblemRecoveryDetail({ unit, remote }) {
  return buildCceRecoveryV1Detail({
    unit,
    remote,
    isDenyOrReject: true,
    projectionMode: WORKER_ADMISSION_ROUTE_PROBLEM_RECOVERY_MODE,
    projectionLabel: "route-problem"
  });
}

function projectPreconditionEvidence(reasonCode, evidence) {
  if (!isObject(evidence)) {
    return Object.freeze({});
  }
  if (reasonCode === "unsatisfied_dependencies") {
    return Object.freeze({
      unsatisfied_count: Number.isInteger(evidence.unsatisfied_count) ? evidence.unsatisfied_count : null,
      incomplete_upstream_ids: normalizeStringArray(evidence.incomplete_upstream_ids)
    });
  }
  if (reasonCode === "dependency_cycle") {
    const cycles = Array.isArray(evidence.cycles)
      ? evidence.cycles
        .filter((cycle) => Array.isArray(cycle))
        .map((cycle) => normalizeStringArray(cycle))
        .filter((cycle) => cycle.length > 0)
      : [];
    return Object.freeze({
      cycles,
      cycle_ids: normalizeStringArray(evidence.cycle_ids)
    });
  }
  if (reasonCode === "lifecycle_not_dispatchable") {
    const lifecycleState = isNonEmptyString(evidence.lifecycle_state)
      ? evidence.lifecycle_state.trim()
      : null;
    const currentStatus = isNonEmptyString(evidence.current_status)
      ? evidence.current_status.trim()
      : null;
    return Object.freeze({
      lifecycle_state: lifecycleState,
      current_status: currentStatus
    });
  }
  if (reasonCode === "unit_superseded") {
    const supersededId = isNonEmptyString(evidence.superseded_id)
      ? evidence.superseded_id.trim()
      : null;
    const replacementUnit = isNonEmptyString(evidence.replacement_unit)
      ? evidence.replacement_unit.trim()
      : null;
    return Object.freeze({
      superseded_id: supersededId,
      replacement_unit: replacementUnit
    });
  }
  if (reasonCode === "precondition_graph_malformed") {
    return Object.freeze({
      malformed_field: isNonEmptyString(evidence.malformed_field) ? evidence.malformed_field.trim() : null
    });
  }
  return Object.freeze({});
}

export function buildPreconditionRecoveryDetail({ unit, reasonCode, evidence }) {
  const projectedEvidence = projectPreconditionEvidence(reasonCode, evidence);
  const recovery = {
    classification: reasonCode,
    is_deny_or_reject: PRECONDITION_REJECT_REASON_CODES.includes(reasonCode),
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null,
    reason_facts: [
      Object.freeze({
        reason_code: reasonCode,
        evidence: projectedEvidence
      })
    ],
    reason_evidence: projectedEvidence
  };

  if (reasonCode === "no_precondition_constraints") {
    recovery.authority_note =
      "no_precondition_constraints is an admit reason for a well-formed dispatchable target " +
      "with no dependency edges; it is not a denial and needs no recovery action.";
    recovery.next_actions = [
      "Treat no_precondition_constraints as an admit reason, not as a remediation blocker."
    ];
    return Object.freeze(recovery);
  }

  recovery.precondition_non_waivable = true;
  recovery.authority_note =
    "Precondition rejects are non-waivable structural dispatch preconditions. " +
    "Do not use accepted_authorities, scoped authority, escalation, or review attestation " +
    "to clear this result; satisfy the precondition and resubmit.";

  if (reasonCode === "unsatisfied_dependencies") {
    recovery.next_actions = [
      "Complete the upstream dependency unit(s) named in reason.evidence.incomplete_upstream_ids, then re-run dispatch."
    ];
  } else if (reasonCode === "dependency_cycle") {
    recovery.next_actions = [
      "Fix the depends_on edges that form the dependency cycle named in reason.evidence.cycles, then re-run dispatch."
    ];
  } else if (reasonCode === "lifecycle_not_dispatchable") {
    recovery.next_actions = [
      "Change status for the target unit to a dispatchable lifecycle state, then re-run dispatch."
    ];
  } else if (reasonCode === "unit_superseded") {
    recovery.next_actions = [
      "Re-point the dependency edge to the replacement unit for the superseded node, then re-run dispatch."
    ];
  } else if (reasonCode === "precondition_graph_malformed") {
    recovery.next_actions = [
      "Treat the malformed precondition graph as a producer defect; fix the portfolio graph producer and resubmit."
    ];
  } else {
    recovery.next_actions = [
      "Satisfy the non-waivable precondition reported in reason.evidence, then re-run dispatch."
    ];
  }
  return Object.freeze(recovery);
}

export function projectPackResultReasonFacts(remote) {
  if (!isObject(remote) || !Array.isArray(remote.pack_result_reasons)) {
    return [];
  }
  const facts = [];
  for (const reason of remote.pack_result_reasons) {
    if (!isObject(reason)) {
      continue;
    }

    const reasonCode = allowlistReasonCode(reason.code);
    if (!reasonCode) {
      continue;
    }
    const fact = { reason_code: reasonCode };
    const control = allowlistControlId(reason.field);
    if (control) {
      fact.control = control;
    }
    const observed = normalizeObservedScalar(reason.observed);
    if (observed.present) {
      fact.observed = observed.value;
    }
    if (typeof reason.threshold === "number" && Number.isFinite(reason.threshold)) {
      fact.threshold = reason.threshold;
    }
    facts.push(Object.freeze(fact));
  }
  return facts;
}

function countPackResultReasons(remote) {
  if (!isObject(remote) || !Array.isArray(remote.pack_result_reasons)) {
    return 0;
  }
  return remote.pack_result_reasons.length;
}

function classifyNeedsReviewReasonShape({ packReasonCount, recognizedReasonCount, isReviewThreshold }) {
  if (isReviewThreshold) {
    return "review_threshold_exceeded";
  }
  if (packReasonCount === 0) {
    return "needs_review_no_pack_reasons";
  }
  if (recognizedReasonCount === 0) {
    return "needs_review_unrecognized_reasons";
  }
  return "needs_review_unprojectable_control";
}

export function buildNeedsReviewRecoveryDetail({ unit, remote }) {
  const cceRecovery = buildCceRecoveryV1Detail({ unit, remote, isDenyOrReject: false });
  if (cceRecovery) {
    return cceRecovery;
  }

  const reasonFacts = projectPackResultReasonFacts(remote);
  const packReasonCount = countPackResultReasons(remote);
  const recognizedReasonCount = reasonFacts.length;
  const unrecognizedReasonCount = Math.max(0, packReasonCount - recognizedReasonCount);

  const reviewThresholdControls = extractReviewThresholdControlsFromRemoteAdmissionResult(remote)
    .map((control) => allowlistControlId(control))
    .filter((control) => control !== null);
  const isReviewThreshold = reviewThresholdControls.length > 0;
  const classification = classifyNeedsReviewReasonShape({
    packReasonCount,
    recognizedReasonCount,
    isReviewThreshold
  });
  const recovery = {

    classification,
    recovery_source: "legacy_reason_fact_recovery_compatibility_fallback",
    is_deny_or_reject: false,
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null,

    review_threshold_controls: reviewThresholdControls,
    reason_facts: reasonFacts,
    pack_reason_count: packReasonCount,
    recognized_reason_count: recognizedReasonCount,
    unrecognized_reason_count: unrecognizedReasonCount,
    dropped_reason_count: unrecognizedReasonCount,

    bounded_by_returned_reason_facts: true,
    controls_note:
      "This remediation packet lists only the review-threshold control(s) Chassis Control Engine " +
      "returned in the pack reason facts above; it infers no hidden or additional controls. " +
      "Remediate exactly the listed control(s); any further controls surface on a subsequent " +
      "pack request.",

    authority_note:
      "needs_review is structurally dispatchable but requires review-threshold evidence; " +
      "Chassis Control Engine remains the only authority that can return a ratified pack-backed admit " +
      "after attestations are carried. Recording review-attestation evidence locally is not " +
      "launch authority and does not convert needs_review to admit."
  };
  if (isReviewThreshold) {
    recovery.taxonomy_code = WORKER_ADMISSION_REVIEW_THRESHOLD_TAXONOMY_CODE;

    recovery.reduce_split_narrow_actions = [
      "Prefer reducing, splitting, or narrowing first: narrow or split the selected unit and its " +
        "write_scope, and reduce or consolidate validation commands, so the named review-threshold " +
        "control(s) clear without needing review evidence."
    ];
    recovery.review_attestation_actions = [
      "Only if reducing/splitting/narrowing is not viable, record accepted review-attestation " +
        "evidence for the selected unit and the named control(s) so the next pack request can carry it.",
      "Or use an operator-approved escalated implementation path if chosen policy allows it."
    ];
    recovery.next_actions = [
      ...recovery.reduce_split_narrow_actions,
      ...recovery.review_attestation_actions
    ];

    recovery.dec_esc_note =
      "DEC/ESC/accepted_authorities are separate operator policy or escalation authorities; " +
      "they are NOT proof that review was performed for review_threshold_exceeded and must not " +
      "be presented as the normal review-threshold fix.";
  } else {
    if (classification === "needs_review_no_pack_reasons") {
      recovery.reduce_split_narrow_actions = [
        "Chassis Control Engine returned needs_review without pack reason entries; do not infer a review-threshold control locally."
      ];
      recovery.review_attestation_actions = [
        "Ask the operator or Chassis Control Engine owner to inspect the upstream admission response and restore bounded reason emission, then re-run dispatch."
      ];
    } else if (classification === "needs_review_unrecognized_reasons") {
      recovery.reduce_split_narrow_actions = [
        "Chassis Control Engine returned needs_review reason entries that this launcher cannot project through its closed vocabulary; do not echo or act on the raw unknown reason values."
      ];
      recovery.review_attestation_actions = [
        "Ask the operator or Chassis Control Engine owner to reconcile the reason vocabulary or update the bounded projection contract, then re-run dispatch."
      ];
    } else {
      recovery.reduce_split_narrow_actions = [
        "Chassis Control Engine returned a recognized needs_review reason, but no allowlisted review-threshold control was projectable; do not infer a control locally."
      ];
      recovery.review_attestation_actions = [
        "Ask the operator or Chassis Control Engine owner to inspect the bounded reason facts and provide a projectable control or corrected reason contract, then re-run dispatch."
      ];
    }
    recovery.next_actions = [
      ...recovery.reduce_split_narrow_actions,
      ...recovery.review_attestation_actions
    ];
  }
  return Object.freeze(recovery);
}

export function buildRejectRecoveryDetail({ unit, remote }) {
  const cceRecovery = buildCceRecoveryV1Detail({ unit, remote, isDenyOrReject: true });
  if (cceRecovery) {
    return cceRecovery;
  }

  const reasonFacts = projectPackResultReasonFacts(remote);
  const isRejectThreshold = reasonFacts.some(
    (fact) => isNonEmptyString(fact.reason_code) && REJECT_THRESHOLD_REASON_CODES.includes(fact.reason_code)
  );
  const recovery = {

    classification: isRejectThreshold ? "reject_threshold_exceeded" : "reject_other",
    recovery_source: "legacy_reason_fact_recovery_compatibility_fallback",
    is_deny_or_reject: true,
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null,
    reason_facts: reasonFacts,

    authority_note:
      "reject fails closed; Chassis Control Engine remains the only authority that can return a ratified " +
      "pack-backed admit. No local action converts a reject to admit, and recording " +
      "review-attestation evidence does not clear a reject-threshold deny."
  };
  if (isRejectThreshold) {
    recovery.taxonomy_code = WORKER_ADMISSION_REJECT_THRESHOLD_TAXONOMY_CODE;
    recovery.next_actions = [
      "Primary remediation: refactor, split, or extract a smaller module from the large file(s) in write_scope, or narrow write_scope, so the selected unit clears the reject threshold, then re-run dispatch.",
      "Only if refactoring, splitting, extracting, or narrowing is genuinely not viable, obtain an accepted, unexpired scoped large-file authority (or operator-approved escalation) for the exact unit and file(s) as a fallback.",
      "Do not treat a scoped DEC or operator escalation as the first-line fix; it is the fallback after refactoring is shown to be impractical."
    ];

    recovery.dec_esc_note =
      "For a Chassis Control Engine reject-threshold deny, bounded expected_changed_line_budget, target " +
      "plan, graph-impact evidence, or local DEC/ESC/accepted_authorities are review context " +
      "only and do not convert the reject/deny to admit. Chassis Control Engine/admissibility remains " +
      "the authority; any fallback authority must be accepted, unexpired, operator-owned, " +
      "and scoped to the exact unit and file(s).";
  } else {
    recovery.next_actions = [
      "Inspect the bounded reason facts to identify the control(s) Chassis Control Engine rejected.",
      "Primary remediation: refactor, split, extract, or narrow write_scope so the selected unit clears the rejected control, then re-run dispatch.",
      "Only if refactoring/splitting/extraction is genuinely not viable, obtain accepted scoped large-file authority or operator-approved escalation for the exact unit as a fallback."
    ];
  }
  return Object.freeze(recovery);
}

export const REMOTE_GATE_REFUSAL_RECOVERY_CODES = Object.freeze([
  "remote_admit_unratified",
  "remote_enforcement_unavailable",
  "remote_enforcement_absent"
]);

const REMOTE_GATE_REFUSAL_RECOVERY_NEXT_ACTIONS = Object.freeze({
  remote_admit_unratified:
    "Ratify/enable the Chassis Control Engine worker-admission authority binding, then retry (non-launchable until ratified)",
  remote_enforcement_unavailable:
    "The paid Chassis Control Engine backend transport/auth/entitlement failed (degrades closed); check service reachability, API key/auth, and entitlement, then retry",
  remote_enforcement_absent:
    "Configure the missing NODE_ENGINE_* (service url / key / route / request-contract digest), or confirm the intended free/local-only path"
});

export function buildRemoteGateRefusalRecoveryDetail({ unit, remoteGateCode } = {}) {
  if (!isNonEmptyString(remoteGateCode)) {
    return null;
  }
  const nextAction = REMOTE_GATE_REFUSAL_RECOVERY_NEXT_ACTIONS[remoteGateCode];
  if (!nextAction) {
    return null;
  }
  return Object.freeze({

    classification: remoteGateCode,

    is_deny_or_reject: false,
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null,
    authority_note:
      "This is a fail-closed Chassis Control Engine worker-admission refusal; Chassis Control Engine remains the only " +
      "authority that can return a ratified pack-backed admit. The next step is an operator/coordinator " +
      "action to clear the fail-closed condition, after which dispatch must be re-run; performing it does " +
      "not itself authorize a launch and does not convert the refusal to admit.",
    next_actions: [nextAction]
  });
}

export function projectWorkerAdmissionRecovery(decision) {
  const unit = isObject(decision?.unit) ? decision.unit : null;
  const preconditionReason = extractPreconditionReason(decision);
  if (preconditionReason) {
    return buildPreconditionRecoveryDetail({
      unit,
      reasonCode: preconditionReason.code,
      evidence: preconditionReason.evidence
    });
  }

  if (decision?.aggregate_decision === "needs_review" || decision?.aggregate_decision === "review_required") {
    return buildNeedsReviewRecoveryDetail({ unit, remote: decision });
  }

  if (decision?.aggregate_decision === "reject" || decision?.pack_result?.effect === "reject") {
    return buildRejectRecoveryDetail({ unit, remote: decision });
  }

  return Object.freeze({
    classification: "worker_admission_recovery_unclassified",
    is_deny_or_reject: false,
    selected_unit_address: unit?.address ?? null,
    selected_record_id: unit?.record_id ?? null,
    selected_slice_id: unit?.slice_id ?? null,
    next_actions: [
      "Inspect the worker-admission decision and retry with a recognized needs_review or reject result."
    ]
  });
}

export default projectWorkerAdmissionRecovery;
