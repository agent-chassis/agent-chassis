

import { createHash } from "node:crypto";
import path from "node:path";

import { assertStructuralManagedProvisioningResult } from
  "./managed-provisioning-result-assertion.mjs";
import {
  getRuntimeBlockerEntry,
  RUNTIME_BLOCKER_CODES
} from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { BACKEND_REFUSAL_CODES } from "./dispatch-runtime.mjs";
import {
  captureStructuredDiagnostic,
  isDiagnosticValue,
  isStructuredDiagnostic,
  projectDiagnostic
} from "@agent-chassis/wiki-core/src/lib/diagnostic-projection.mjs";

export const LAUNCHER_TRANSITION_PLAN_SCHEMA_VERSION =
  "launcher-transition-plan.v1";

export const LAUNCHER_TRANSITION_PHASES = Object.freeze([
  "prospective",
  "allocated"
]);

export const LAUNCHER_TRANSITION_FAILURES = Object.freeze({
  PROSPECTIVE_LIFECYCLE_UNAVAILABLE: Object.freeze({
    code: "launcher_transition.prospective_lifecycle_unavailable.v1",
    authority_limb: "mechanical_failure",
    next_action: "retry_workspace_agent_dispatch_after_lifecycle_preflight_succeeds"
  }),
  LIFECYCLE_ALLOCATION_FAILED: Object.freeze({
    code: "launcher_transition.lifecycle_allocation_failed.v1",
    authority_limb: "mechanical_failure",
    next_action: "retry_workspace_agent_dispatch_after_launcher_allocation_recovery"
  }),
  DEPENDENCY_IDENTITY_UNRESOLVED: Object.freeze({
    code: "launcher_transition.dependency_identity_unresolved.v1",
    authority_limb: "mechanical_failure",
    next_action: "publish_or_integrate_the_exact_dependency_then_retry_workspace_agent_dispatch"
  }),
  PUBLICATION_IDENTITY_UNRESOLVED: Object.freeze({
    code: "launcher_transition.publication_identity_unresolved.v1",
    authority_limb: "mechanical_failure",
    next_action: "obtain_the_wk_forge_merge_landed_publication_carrier_then_retry_workspace_agent_dispatch"
  }),
  CCE_POLICY_REFUSED: Object.freeze({
    code: "launcher_transition.cce_policy_refused.v1",
    authority_limb: "exact_returned_policy",
    next_action: "perform_the_exact_cce_returned_recovery_then_retry_workspace_agent_dispatch"
  }),
  FINDINGS_ROUTE_AUTHENTICATION_FAILED: Object.freeze({
    code: "launcher_transition.findings_route_authentication_failed.v1",
    authority_limb: "mechanical_failure",
    next_action: "dispatch_the_exact_canonical_findings_unit_through_workspace_agent_dispatch"
  }),
  RUNTIME_BACKEND_UNAVAILABLE: Object.freeze({
    code: "launcher_transition.runtime_backend_unavailable.v1",
    authority_limb: "mechanical_failure",
    next_action: "restore_the_registered_launcher_backend_then_retry_workspace_agent_dispatch"
  })
});

const FAILURE_BY_CODE = new Map(
  Object.values(LAUNCHER_TRANSITION_FAILURES).map((entry) => [entry.code, entry])
);
const PLAN_FIELDS = Object.freeze([
  "schema_version", "identity", "phase", "role_runtime", "lifecycle",
  "dependency", "publication", "cce", "reservation", "spawn", "failure"
]);
const INPUT_FIELDS = Object.freeze([
  "phase", "subject", "selection", "readiness", "findings_route_admission",
  "planned_base", "settlement", "dependency_evidence", "publication_identities",
  "reservation_state", "spawn_state", "failure", "previous_plan"
]);
const OWNER_SETTLEMENT_FIELDS = Object.freeze([
  "subject", "selection", "authenticated_wk_tip", "owner_settlement"
]);
const FRESH_SETTLEMENT_REQUIRED = "fresh_settlement_required";
const FRESH_SETTLEMENT_OBSERVED = "fresh_settlement_observed";
const FRESH_SETTLEMENT_REFUSED = "fresh_settlement_refused";
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function exactKeys(value, fields) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length &&
    actual.every((field, index) => field === expected[index]);
}

function assertInputFields(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("launcher transition plan input must be an object");
  }
  const additive = Object.keys(input).filter((field) => !INPUT_FIELDS.includes(field));
  if (additive.length > 0) {
    throw new TypeError(`launcher transition plan input has unsupported fields: ${additive.join(",")}`);
  }
}

function freezeProjection(value) {
  return Object.freeze(value);
}

function selectionProjection(selection, subject, { allowUnavailable = false } = {}) {
  const selected = selection?.selection ?? selection;
  if (selected?.ok !== true) {
    if (!allowUnavailable) {
      throw new TypeError("launcher transition plan requires the WK-2267 selection result");
    }
    return freezeProjection({
      owner: "WK-2267",
      role: selected?.target_role ?? selected?.detail?.target_role ?? selected?.detail?.role ?? null,
      subject,
      target: selected?.target ?? subject,
      route_kind: selected?.routeKind ?? null,
      app: selected?.app ?? selected?.detail?.app ?? null,
      model: selected?.model ?? null,
      backend: selected?.backend ?? null,
      backend_profile: selected?.backend_profile ?? null,
      findings_route: null
    });
  }
  const role = selected.target_role ?? null;
  const route = selection?.findings_route ?? null;
  return freezeProjection({
    owner: "WK-2267",
    role,
    subject,
    target: selected.target ?? subject,
    route_kind: selected.routeKind ?? null,
    app: selected.app ?? null,
    model: selected.model ?? selected.resolvedModel ?? null,
    backend: selected.backend ?? selected.resolvedBackend ?? null,
    backend_profile: selected.backend_profile ?? selected.resolvedBackendProfile ?? null,
    findings_route: route?.route ?? null
  });
}

function plannedBaseProjection(value) {
  if (value === null) return null;
  if (!exactKeys(value, ["base_ref", "base_sha"]) ||
      typeof value.base_ref !== "string" || !OID_RE.test(value.base_sha)) {
    throw new TypeError("launcher transition planned base must be an exact ref and object id");
  }
  return freezeProjection({ base_ref: value.base_ref, base_sha: value.base_sha });
}

function samePlannedBase(left, right) {
  return left?.base_ref === right?.base_ref && left?.base_sha === right?.base_sha;
}

function authenticatedSettlementWkTip(settlement, plannedBase) {
  if (settlement === null || plannedBase === null) return null;
  const binding = settlement?.wk_binding;
  const sliceBinding = settlement?.slice_binding ?? null;
  const plannedBaseMatches = sliceBinding === null
    ? binding?.output_branch === plannedBase.base_ref && binding?.wk_tip_sha === plannedBase.base_sha
    : sliceBinding.base_ref === plannedBase.base_ref && sliceBinding.base_sha === plannedBase.base_sha;
  if (!plannedBaseMatches || binding?.output_branch !== plannedBase.base_ref ||
      !OID_RE.test(binding?.wk_tip_sha ?? "")) return null;
  return plannedBaseProjection({
    base_ref: binding.output_branch,
    base_sha: binding.wk_tip_sha
  });
}

const MANAGED_WK_LIFECYCLE_SETTLEMENT_FIELDS = Object.freeze([
  "schema_version", "complete", "main_repo", "initiative", "record_id",
  "subject", "launch_ref", "run_id", "retry_id", "worktree_root",
  "wk_binding", "controlled_contract_generation", "wk_snapshot"
]);

function authenticManagedWkLifecycleSettlement(settlement, subject, authenticatedWkTip) {
  const wkId = subject.split("#", 1)[0];
  const binding = settlement?.wk_binding;
  const snapshot = settlement?.wk_snapshot;
  const generation = settlement?.controlled_contract_generation;
  return exactKeys(settlement, MANAGED_WK_LIFECYCLE_SETTLEMENT_FIELDS) &&
    settlement.schema_version === "managed-wk-lifecycle-allocation.v1" &&
    settlement.complete === true && Object.isFrozen(settlement) &&
    settlement.record_id === wkId && settlement.subject === subject &&
    typeof settlement.initiative === "string" && /^IN-\d{4}$/u.test(settlement.initiative) &&
    typeof settlement.launch_ref === "string" && settlement.launch_ref.length > 0 &&
    typeof settlement.run_id === "string" && settlement.run_id.length > 0 &&
    Number.isSafeInteger(settlement.retry_id) && settlement.retry_id >= 0 &&
    binding !== null && typeof binding === "object" && Object.isFrozen(binding) &&
    binding.record_id === wkId && binding.slice_id === null &&
    binding.launch_ref === settlement.launch_ref &&
    binding.run_id === `${settlement.run_id}.wk` &&
    binding.retry_id === settlement.retry_id &&
    binding.output_branch === authenticatedWkTip.base_ref &&
    binding.wk_tip_sha === authenticatedWkTip.base_sha &&
    snapshot !== null && typeof snapshot === "object" && Object.isFrozen(snapshot) &&
    snapshot.ref === `refs/heads/${authenticatedWkTip.base_ref}` &&
    snapshot.tip === authenticatedWkTip.base_sha && OID_RE.test(snapshot.tree ?? "") &&
    (generation === null || (
      typeof generation === "object" && Object.isFrozen(generation) &&
      generation.schema_version === "controlled-contract-resolved-generation.v1" &&
      generation.record_id === wkId && Number.isSafeInteger(generation.count) &&
      generation.count > 0 && /^sha256:[0-9a-f]{64}$/u.test(generation.generation_digest ?? "")
    ));
}

function authenticOwnerSettlement(settlement, subject, authenticatedWkTip) {
  if (authenticManagedWkLifecycleSettlement(settlement, subject, authenticatedWkTip)) {
    return true;
  }
  try {
    const wkRunId = settlement?.wk_binding?.run_id;
    if (typeof wkRunId !== "string" || !wkRunId.endsWith(".wk")) return false;
    const runId = wkRunId.slice(0, -3);
    if (settlement.slice_binding?.run_id !== `${runId}.slice`) return false;
    const admitted = assertStructuralManagedProvisioningResult({
      provisioning: settlement,
      mainRepo: settlement.main_repo,
      initiative: settlement.initiative,
      subject,
      launchRef: settlement.wk_binding.launch_ref,
      runId,
      retryId: settlement.retry_id,
      worktreeRoot: path.dirname(settlement.wk_binding.worktree_path)
    });
    return admitted === settlement &&
      samePlannedBase(admitted.slice_binding, authenticatedWkTip) &&
      admitted.wk_binding.output_branch === authenticatedWkTip.base_ref &&
      admitted.wk_binding.wk_tip_sha === authenticatedWkTip.base_sha;
  } catch {
    return false;
  }
}

function ownerSettlementProjection(plan, {
  state,
  authenticatedWkTip,
  settlement = null,
  settlementRequest = null,
  spawnState,
  failure = null
}) {
  const settledPlannedBase = state === FRESH_SETTLEMENT_OBSERVED && settlement?.slice_binding
    ? plannedBaseProjection({
        base_ref: settlement.slice_binding.base_ref,
        base_sha: settlement.slice_binding.base_sha
      })
    : state === FRESH_SETTLEMENT_OBSERVED ? authenticatedWkTip : null;
  return Object.freeze({
    ...plan,
    phase: "prospective",
    lifecycle: freezeProjection({
      owner: "WK-2261",
      state,
      planned_base: settledPlannedBase,
      settlement,
      authenticated_wk_tip: authenticatedWkTip,
      settlement_request: settlementRequest
    }),
    dependency: freezeProjection({ ...plan.dependency, state: "prospective", evidence: null }),
    publication: freezeProjection({
      ...plan.publication,
      state: "prospective",
      identities: Object.freeze([])
    }),
    spawn: freezeProjection({ ...plan.spawn, state: spawnState }),
    failure
  });
}

function validPublicationIdentity(value) {
  return value?.schema_version === "forge-confirmed-landed-publication-identity.v1" &&
    Object.isFrozen(value) && /^WK-\d{4}$/u.test(value.wk ?? "") &&
    typeof value.base_branch === "string" && value.base_branch.length > 0 &&
    OID_RE.test(value.merge_commit_sha ?? "") &&
    value.exact_head_landing?.relation === "exact-head-ancestor" &&
    value.exact_head_landing?.head_sha === value.pull_request?.head_sha &&
    value.exact_head_landing?.merge_commit_sha === value.merge_commit_sha;
}

export function isForgeConfirmedLandedPublicationIdentity(value) {
  return validPublicationIdentity(value);
}

function publicationProjection(identities, phase) {
  if (!Array.isArray(identities) || identities.some((identity) => !validPublicationIdentity(identity))) {
    throw new TypeError("launcher transition publication identities must be exact WK-2313 carriers");
  }
  return freezeProjection({
    owner: "WK-2313",
    state: phase,
    identities: Object.freeze([...identities])
  });
}

function failureProjection(failure) {
  if (failure === null) return null;
  const canonical = typeof failure === "string" ? FAILURE_BY_CODE.get(failure) : failure;
  if (!canonical || FAILURE_BY_CODE.get(canonical.code) !== canonical) {
    throw new TypeError("launcher transition failure is outside the closed taxonomy");
  }
  return canonical;
}

function stableIdentity({ subject, roleRuntime, readiness, previousPlan }) {
  if (previousPlan !== null) return previousPlan.identity;
  const source = JSON.stringify({
    subject,
    role: roleRuntime.role,
    target: roleRuntime.target,
    route_kind: roleRuntime.route_kind,
    app: roleRuntime.app,
    model: roleRuntime.model,
    backend: roleRuntime.backend,
    record_id: readiness?.record_id ?? null,
    unit: readiness?.unit ?? null,
    decision_code: readiness?.decision_code ?? null
  });
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

export function isLauncherTransitionPlan(value) {
  return exactKeys(value, PLAN_FIELDS) &&
    value.schema_version === LAUNCHER_TRANSITION_PLAN_SCHEMA_VERSION &&
    typeof value.identity === "string" && /^sha256:[0-9a-f]{64}$/u.test(value.identity) &&
    LAUNCHER_TRANSITION_PHASES.includes(value.phase) &&
    PLAN_FIELDS.every((field) => field === "failure" || field === "identity" ||
      field === "schema_version" || field === "phase" || Object.isFrozen(value[field])) &&
    Object.isFrozen(value) &&
    (value.failure === null || FAILURE_BY_CODE.get(value.failure.code) === value.failure);
}

export function createLauncherTransitionPlan(input = {}) {
  assertInputFields(input);
  const {
    phase = "prospective",
    subject = null,
    selection = null,
    readiness = null,
    findings_route_admission: findingsRouteAdmission = null,
    planned_base: plannedBase = null,
    settlement = null,
    dependency_evidence: dependencyEvidence = null,
    publication_identities: publicationIdentities = [],
    reservation_state: reservationState = "prospective",
    spawn_state: spawnState = "prospective",
    failure = null,
    previous_plan: previousPlan = null
  } = input;
  if (!LAUNCHER_TRANSITION_PHASES.includes(phase) || typeof subject !== "string" || subject.length === 0) {
    throw new TypeError("launcher transition plan requires a finite phase and subject");
  }
  if (previousPlan !== null && (!isLauncherTransitionPlan(previousPlan) ||
      previousPlan.role_runtime.subject !== subject)) {
    throw new TypeError("launcher transition continuation requires the exact frozen prior plan");
  }
  if (settlement !== null && (!Object.isFrozen(settlement) || settlement.complete !== true)) {
    throw new TypeError("launcher transition settlement must be WK-2261's frozen complete result");
  }
  const projectedFailure = failureProjection(failure);
  const roleRuntime = selectionProjection(selection, subject, {
    allowUnavailable: projectedFailure !== null
  });
  if (previousPlan !== null) {
    const prior = previousPlan.role_runtime;
    for (const field of ["role", "subject", "target", "route_kind", "app", "model", "backend"]) {
      if (prior[field] !== roleRuntime[field]) {
        throw new TypeError(`launcher transition role/runtime identity changed at ${field}`);
      }
    }
  }
  const base = plannedBaseProjection(plannedBase);
  const settlementWkTip = authenticatedSettlementWkTip(settlement, base);
  const inheritedWkTip = previousPlan?.lifecycle?.authenticated_wk_tip ?? null;
  if (settlementWkTip !== null && inheritedWkTip !== null &&
      !samePlannedBase(settlementWkTip, inheritedWkTip)) {
    throw new TypeError("launcher transition authenticated WK tip changed across allocation");
  }
  const authenticatedWkTip = settlementWkTip ?? inheritedWkTip;
  const publications = publicationProjection(publicationIdentities, phase);
  const cceDecision = readiness?.admissibility ?? previousPlan?.cce?.decision ?? null;
  const cceRecovery = readiness?.recovery ?? previousPlan?.cce?.recovery ?? null;
  const plan = {
    schema_version: LAUNCHER_TRANSITION_PLAN_SCHEMA_VERSION,
    identity: stableIdentity({ subject, roleRuntime, readiness, previousPlan }),
    phase,
    role_runtime: freezeProjection({
      ...roleRuntime,
      findings_route_admission: findingsRouteAdmission
    }),
    lifecycle: freezeProjection({
      owner: "WK-2261",
      state: phase,
      planned_base: base,
      settlement,
      ...(authenticatedWkTip === null ? {} : { authenticated_wk_tip: authenticatedWkTip })
    }),
    dependency: freezeProjection({
      owner: "workspace-agent-dispatch dependency resolver",
      state: phase,
      evidence: dependencyEvidence
    }),
    publication: publications,
    cce: freezeProjection({ owner: "CCE", decision: cceDecision, recovery: cceRecovery }),
    reservation: freezeProjection({ owner: "launcher subject reservation", state: reservationState }),
    spawn: freezeProjection({ owner: "launcher family executor", state: spawnState }),
    failure: projectedFailure
  };
  return Object.freeze(plan);
}

export function revalidateLauncherTransitionPlan(plan, {
  subject,
  selection,
  phase = null,
  authenticated_wk_tip: authenticatedWkTip = null
} = {}) {
  if (!isLauncherTransitionPlan(plan) || plan.role_runtime.subject !== subject ||
      (phase !== null && plan.phase !== phase)) return false;
  try {
    const projected = selectionProjection(selection, subject);
    const identityMatches = ["role", "subject", "target", "route_kind", "app", "model", "backend"].every(
      (field) => projected[field] === plan.role_runtime[field]
    );
    if (!identityMatches || authenticatedWkTip === null) return identityMatches;
    const authenticated = plannedBaseProjection(authenticatedWkTip);
    const projectedTip = plan.lifecycle.authenticated_wk_tip ?? plan.lifecycle.planned_base;
    return projectedTip !== null && samePlannedBase(projectedTip, authenticated) &&
      plan.lifecycle.state !== FRESH_SETTLEMENT_REQUIRED &&
      plan.lifecycle.state !== FRESH_SETTLEMENT_REFUSED;
  } catch {
    return false;
  }
}

export function projectLauncherTransitionOwnerSettlement(plan, input = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("launcher transition owner settlement input must be an object");
  }
  const additive = Object.keys(input).filter((field) => !OWNER_SETTLEMENT_FIELDS.includes(field));
  if (additive.length > 0) {
    throw new TypeError(`launcher transition owner settlement input has unsupported fields: ${additive.join(",")}`);
  }
  const {
    subject,
    selection,
    authenticated_wk_tip: authenticatedWkTip,
    owner_settlement: ownerSettlement = null
  } = input;
  if (!revalidateLauncherTransitionPlan(plan, { subject, selection })) {
    throw new TypeError("launcher transition owner settlement requires the exact prior projection");
  }
  const authenticated = plannedBaseProjection(authenticatedWkTip);
  if (authenticated === null) {
    throw new TypeError("launcher transition owner settlement requires the authenticated WK tip");
  }
  const request = plan.lifecycle.settlement_request ?? null;
  const pending = plan.lifecycle.state === FRESH_SETTLEMENT_REQUIRED;
  if (!pending && revalidateLauncherTransitionPlan(plan, {
    subject,
    selection,
    authenticated_wk_tip: authenticated
  })) {
    return ownerSettlement === null ? plan : ownerSettlementProjection(plan, {
      state: FRESH_SETTLEMENT_REFUSED,
      authenticatedWkTip: authenticated,
      spawnState: "refused",
      failure: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED
    });
  }
  if (!pending) {
    if (ownerSettlement !== null) {
      return ownerSettlementProjection(plan, {
        state: FRESH_SETTLEMENT_REFUSED,
        authenticatedWkTip: authenticated,
        spawnState: "refused",
        failure: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED
      });
    }
    return ownerSettlementProjection(plan, {
      state: FRESH_SETTLEMENT_REQUIRED,
      authenticatedWkTip: authenticated,
      settlementRequest: freezeProjection({
        owner: "WK-2261",
        operation: "allocate_or_adopt_authenticated_wk_tip",
        attempt_limit: 1,
        plan_identity: plan.identity,
        subject,
        authenticated_wk_tip: authenticated
      }),
      spawnState: "blocked"
    });
  }
  const requestMatches = request?.owner === "WK-2261" && request.attempt_limit === 1 &&
    request.plan_identity === plan.identity && request.subject === subject &&
    samePlannedBase(request.authenticated_wk_tip, authenticated);
  if (ownerSettlement === null && requestMatches) return plan;
  if (!requestMatches || !authenticOwnerSettlement(ownerSettlement, subject, authenticated)) {
    return ownerSettlementProjection(plan, {
      state: FRESH_SETTLEMENT_REFUSED,
      authenticatedWkTip: authenticated,
      spawnState: "refused",
      failure: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED
    });
  }
  return ownerSettlementProjection(plan, {
    state: FRESH_SETTLEMENT_OBSERVED,
    authenticatedWkTip: authenticated,
    settlement: ownerSettlement,
    spawnState: "blocked"
  });
}

export function createProspectiveLauncherTransitionPlan({
  subject,
  selection,
  readiness = null,
  findingsRouteAdmission = null
}) {
  return createLauncherTransitionPlan({
    phase: "prospective", subject, selection, readiness,
    findings_route_admission: findingsRouteAdmission,
    planned_base: null, settlement: null, dependency_evidence: null,
    publication_identities: [], reservation_state: "prospective",
    spawn_state: "prospective", failure: null, previous_plan: null
  });
}

export function createFailedLauncherTransitionPlan({
  previousPlan = null,
  subject,
  selection,
  readiness = null,
  findingsRouteAdmission = null,
  failure
}) {
  return createLauncherTransitionPlan({
    phase: previousPlan?.phase ?? "prospective",
    subject,
    selection,
    readiness,
    findings_route_admission: previousPlan?.role_runtime?.findings_route_admission ??
      findingsRouteAdmission,
    planned_base: previousPlan?.lifecycle?.planned_base ?? null,
    settlement: previousPlan?.lifecycle?.settlement ?? null,
    dependency_evidence: previousPlan?.dependency?.evidence ?? null,
    publication_identities: previousPlan?.publication?.identities ?? [],
    reservation_state: previousPlan?.reservation?.state ?? "prospective",
    spawn_state: "refused",
    failure,
    previous_plan: previousPlan
  });
}

export function allocateLauncherTransitionPlan(previousPlan, input = {}) {
  const {
    subject,
    selection,
    readiness = null,
    findingsRouteAdmission = null,
    plannedBase = null,
    settlement = null,
    dependencyEvidence = null,
    publicationIdentities = [],
    reservationState = "not_required"
  } = input;
  if (previousPlan?.lifecycle?.state === FRESH_SETTLEMENT_REQUIRED ||
      previousPlan?.lifecycle?.state === FRESH_SETTLEMENT_REFUSED) {
    throw new TypeError(
      "fresh owner settlement must be observed before transition allocation"
    );
  }
  if (previousPlan?.lifecycle?.state === FRESH_SETTLEMENT_OBSERVED && (
    settlement !== previousPlan.lifecycle.settlement ||
    !samePlannedBase(plannedBase, previousPlan.lifecycle.planned_base) ||
    !Object.prototype.hasOwnProperty.call(input, "dependencyEvidence") ||
    dependencyEvidence === null ||
    !Object.prototype.hasOwnProperty.call(input, "publicationIdentities")
  )) {
    throw new TypeError(
      "fresh owner settlement requires recomputed dependency and publication projections"
    );
  }
  return createLauncherTransitionPlan({
    phase: "allocated", subject, selection, readiness,
    findings_route_admission: findingsRouteAdmission,
    planned_base: plannedBase, settlement, dependency_evidence: dependencyEvidence,
    publication_identities: publicationIdentities, reservation_state: reservationState,
    spawn_state: "authorized", failure: null, previous_plan: previousPlan
  });
}

export const LAUNCHER_TRANSITION_BACKEND_REFUSAL_CLASSIFICATION_SCHEMA_VERSION =
  "launcher-transition-backend-refusal-classification.v1";

export const LAUNCHER_TRANSITION_UNCLASSIFIED_CODE =
  "launcher_transition.authenticated_backend_refusal_unclassified.v1";

export const LAUNCHER_TRANSITION_CLASSIFICATION_STATES = Object.freeze({
  KNOWN: "known",
  ACTUAL_BACKEND_UNAVAILABLE: "actual_backend_unavailable",
  AUTHENTICATED_UNCLASSIFIED: "authenticated_unclassified"
});

export const LAUNCHER_TRANSITION_REDACTION_REASONS = Object.freeze({
  SECRET_MATERIAL: "secret_material",
  LAUNCHER_PRIVATE_STATE: "launcher_private_state",
  INTERNAL_IDENTIFIER: "internal_identifier",
  PERSONAL_DATA: "personal_data"
});

export const LAUNCHER_TRANSITION_BACKEND_CAUSE_CODE_RE = /^[a-z][a-z0-9_.-]{0,159}$/u;

export const LAUNCHER_TRANSITION_ABSENT_BACKEND_CAUSES = Object.freeze([
  "launch_backend_unavailable",
  "backend_unavailable"
]);

export const LAUNCHER_TRANSITION_PUBLIC_SAFE_DETAIL_PATHS = Object.freeze([
  "refusal.code",
  "refusal.reason",
  "detail.cause.type",
  "detail.cause.code",
  "detail.cause_code",
  "detail.recovery.state",
  "detail.recovery.route",
  "detail.recovery.args",
  "detail.next_action",
  "detail.actor_recovery",
  "detail.next_action_args.role",
  "detail.next_action_args.subject",
  "detail.mismatch_field",
  "detail.expected",
  "detail.actual",
  "detail.subject",
  "detail.role",
  "detail.message",
  "detail.detail",
  "detail.error",
  "detail.stderr",
  "detail.stdout",
  "detail.stack",
  "detail.explanation",
  "detail.reason_detail",
  "detail.diagnostic",
  "detail.output"
]);

export class LauncherTransitionRefusalSchemaError extends TypeError {

  constructor(message, { field = null, observed_length: observedLength = null } = {}) {
    super(message);
    this.name = "LauncherTransitionRefusalSchemaError";
    this.code = "launcher_transition_refusal_schema_invalid";
    this.field = field;
    this.observed_length = observedLength;
  }
}

const CLASSIFICATION_STATES = LAUNCHER_TRANSITION_CLASSIFICATION_STATES;
const REDACTION_REASONS = LAUNCHER_TRANSITION_REDACTION_REASONS;

const DIAGNOSTIC_DETAIL_KEYS = new Set([
  "message", "detail", "error", "stderr", "stdout", "stack", "explanation",
  "reason_detail", "diagnostic", "output"
]);

const STDIO_MCP_SENSITIVE_DETAIL_REASONS = Object.freeze({
  secret: "secret_material",
  token: "secret_material",
  credential: "secret_material",
  authorization: "secret_material",
  api_key: "secret_material",
  private_root: "internal_identifier",
  internal_path: "internal_identifier",
  internal_url: "internal_identifier",
  internal_digest: "internal_identifier",
  fifo_path: "internal_identifier",
  request_fifo_path: "internal_identifier",
  response_fifo_path: "internal_identifier",
  personal_data: "personal_data",
  capability_scope: "launcher_private_state"
});
const STDIO_MCP_SECRET_DETAIL_CONTAINERS = new Set(["env", "environment"]);

const LAUNCHER_PRIVATE_STATE_DETAIL_KEYS = new Set([
  "observed_canonical_status", "authority_limb", "capability", "reason",
  "contract_side", "mismatch_class", "parent_status", "slice_status",
  "remediation", "cce_recovery", "remote_needs_review_recovery",
  "monitor_handle", "notification"
]);

const CAUSE_TYPES = new Set(["managed_wk_bootstrap_failure", "launcher_refusal"]);
const RECOVERY_STATES = new Set(["callable", "no_supported_route"]);
const ACTOR_RECOVERY_VALUES = new Set(["operator", "coordinator", "caller_retry", "launcher"]);
const RECOVERY_ROLE_VALUES = new Set(["worker", "reviewer", "redteam"]);
const RECOVERY_ROUTE_RE = /^[a-z][a-z0-9_]{0,63}$/u;
const RECOVERY_SUBJECT_RE = /^(?:WK-\d{4})(?:#SLICE-\d{3})?$/u;
const BOUNDED_TOKEN_RE = /^[a-z][a-z0-9_.-]{0,159}$/u;

const MISMATCH_VALUE_MAX_LENGTH = 512;

const BLOCKER_CODE_BY_REFUSAL_CODE = Object.freeze({
  [BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE]: RUNTIME_BLOCKER_CODES.BACKEND_UNAVAILABLE,
  [BACKEND_REFUSAL_CODES.LAUNCH_REFUSED]: RUNTIME_BLOCKER_CODES.VALIDATION_FAILURE,
  [BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START]:
    RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED,
  [BACKEND_REFUSAL_CODES.MONITOR_HANDLE_UNKNOWN]: RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_UNKNOWN,
  [BACKEND_REFUSAL_CODES.MONITOR_HANDLE_CALLER_MISMATCH]:
    RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_CALLER_MISMATCH,
  [BACKEND_REFUSAL_CODES.MONITOR_HANDLE_SUBJECT_MISMATCH]:
    RUNTIME_BLOCKER_CODES.MONITOR_HANDLE_SUBJECT_MISMATCH
});

const CARRIERLESS_POLICY_MECHANICAL_FAILURE =
  LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED;

const TRANSITION_FAILURE_BY_CAUSE_CATEGORY = Object.freeze({
  role_policy: CARRIERLESS_POLICY_MECHANICAL_FAILURE,
  caller_identity: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
  work_record_readiness: LAUNCHER_TRANSITION_FAILURES.PROSPECTIVE_LIFECYCLE_UNAVAILABLE,
  transport: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
  backend: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
  filesystem: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
  sandbox: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
  validation: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
  route: LAUNCHER_TRANSITION_FAILURES.FINDINGS_ROUTE_AUTHENTICATION_FAILED,
  discovery: LAUNCHER_TRANSITION_FAILURES.PROSPECTIVE_LIFECYCLE_UNAVAILABLE,
  review_transport: LAUNCHER_TRANSITION_FAILURES.FINDINGS_ROUTE_AUTHENTICATION_FAILED,
  monitor_handle: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
  bootstrap: LAUNCHER_TRANSITION_FAILURES.PROSPECTIVE_LIFECYCLE_UNAVAILABLE,
  graph_impact: LAUNCHER_TRANSITION_FAILURES.PROSPECTIVE_LIFECYCLE_UNAVAILABLE,
  graph_impact_persistence: LAUNCHER_TRANSITION_FAILURES.PROSPECTIVE_LIFECYCLE_UNAVAILABLE,
  taxonomy: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
  operator_recovery: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
  read_disclosure: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED
});

function carrierlessAdmissibleTransition(failure) {
  return failure.authority_limb !== "exact_returned_policy";
}

const ECHOED_TRANSITION_FAILURE_BY_CODE = new Map(
  [...FAILURE_BY_CODE].filter(([, failure]) => carrierlessAdmissibleTransition(failure))
);

const SPECIFIC_MECHANICAL_TRANSITION_BY_PRIVATE_CAUSE = Object.freeze([
  Object.freeze({
    cause_code: "managed_lifecycle_required",
    reason: "frozen_standalone_findings_contract_invalid",
    contract_side: "selected_unit",
    mismatch_class: "findings_shape_mismatch",
    failure: LAUNCHER_TRANSITION_FAILURES.FINDINGS_ROUTE_AUTHENTICATION_FAILED
  })
]);

function selectSpecificMechanicalTransition(causeCode, detail) {
  const recognized = SPECIFIC_MECHANICAL_TRANSITION_BY_PRIVATE_CAUSE.find((entry) =>
    entry.cause_code === causeCode && detail.reason === entry.reason &&
    detail.contract_side === entry.contract_side &&
    detail.mismatch_class === entry.mismatch_class) ?? null;
  return recognized === null ? null : recognized.failure;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectSensitiveStringLeaves(value, field, reason, declarations, seen) {
  if (typeof value === "string" && value.length > 0) {
    declarations.push({ field, value, reason });
    return;
  }
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry])
    : isPlainObject(value)
      ? Object.entries(value)
      : [];
  for (const [key, entry] of entries) {
    collectSensitiveStringLeaves(entry, `${field}.${key}`, reason, declarations, seen);
  }
  seen.delete(value);
}

function collectStdioMcpSensitiveValues(value, field, declarations, seen) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [String(index), entry])
    : isPlainObject(value)
      ? Object.entries(value)
      : [];
  for (const [key, entry] of entries) {
    const entryField = field.length > 0 ? `${field}.${key}` : key;
    const reason = STDIO_MCP_SENSITIVE_DETAIL_REASONS[key];
    if (reason !== undefined && typeof entry === "string" && entry.length > 0) {
      declarations.push({ field: entryField, value: entry, reason });
    } else if (STDIO_MCP_SECRET_DETAIL_CONTAINERS.has(key)) {
      collectSensitiveStringLeaves(entry, entryField, "secret_material", declarations, seen);
    } else {
      collectStdioMcpSensitiveValues(entry, entryField, declarations, seen);
    }
  }
  seen.delete(value);
}

function stdioMcpSensitiveValues(causeCode, detail) {
  if (!causeCode.startsWith("stdio_mcp_") || !isPlainObject(detail.detail) ||
      isStructuredDiagnostic(detail.detail)) {
    return Object.freeze([]);
  }
  const declarations = [];
  collectStdioMcpSensitiveValues(detail.detail, "", declarations, new Set());
  return Object.freeze(declarations.map((entry) => Object.freeze(entry)));
}

function redactionReasonForDetailKey(key) {
  if (LAUNCHER_PRIVATE_STATE_DETAIL_KEYS.has(key)) return REDACTION_REASONS.LAUNCHER_PRIVATE_STATE;
  return null;
}

function readDeclaredCauseCode(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new LauncherTransitionRefusalSchemaError(
      `launcher transition backend refusal ${field} must be a bounded cause code string`,
      { field }
    );
  }
  if (!LAUNCHER_TRANSITION_BACKEND_CAUSE_CODE_RE.test(value)) {
    throw new LauncherTransitionRefusalSchemaError(
      `launcher transition backend refusal ${field} is not an exact bounded cause code`,
      { field, observed_length: value.length }
    );
  }
  return value;
}

function classifyKnownCause(causeCode) {
  if (LAUNCHER_TRANSITION_ABSENT_BACKEND_CAUSES.includes(causeCode)) {
    return {
      state: CLASSIFICATION_STATES.ACTUAL_BACKEND_UNAVAILABLE,
      failure: LAUNCHER_TRANSITION_FAILURES.RUNTIME_BACKEND_UNAVAILABLE,
      actorRecovery: "operator"
    };
  }
  const closedTransitionFailure = ECHOED_TRANSITION_FAILURE_BY_CODE.get(causeCode) ?? null;
  if (closedTransitionFailure !== null) {
    return {
      state: closedTransitionFailure === LAUNCHER_TRANSITION_FAILURES.RUNTIME_BACKEND_UNAVAILABLE
        ? CLASSIFICATION_STATES.ACTUAL_BACKEND_UNAVAILABLE
        : CLASSIFICATION_STATES.KNOWN,
      failure: closedTransitionFailure,
      actorRecovery: null
    };
  }
  const entry = getRuntimeBlockerEntry(causeCode);
  if (!entry) return null;
  const failure = TRANSITION_FAILURE_BY_CAUSE_CATEGORY[entry.category] ?? null;
  if (failure === null) return null;
  return {
    state: CLASSIFICATION_STATES.KNOWN,
    failure,
    actorRecovery: ACTOR_RECOVERY_VALUES.has(entry.actor_recovery) ? entry.actor_recovery : null
  };
}

function projectNestedAllowlist(value, path, allowed, { redactions, schemaRejected }) {
  if (value === undefined) return null;
  if (!isPlainObject(value)) {
    schemaRejected.push(path);
    return null;
  }
  const projected = {};
  for (const key of Object.keys(value)) {
    const field = `${path}.${key}`;
    const validate = allowed[key];
    if (validate === undefined) {
      const reason = redactionReasonForDetailKey(key);
      if (reason === null) schemaRejected.push(field);
      else redactions.push({ field, reason });
      continue;
    }
    const outcome = validate(value[key]);
    if (outcome.ok) projected[key] = outcome.value;
    else schemaRejected.push(field);
  }
  return projected;
}

const accept = (value) => ({ ok: true, value });
const reject = { ok: false, value: null };

function validateCauseType(value) {
  return typeof value === "string" && CAUSE_TYPES.has(value) ? accept(value) : reject;
}

function validateCauseCodeField(value) {
  if (value === null) return accept(null);
  return typeof value === "string" && LAUNCHER_TRANSITION_BACKEND_CAUSE_CODE_RE.test(value)
    ? accept(value)
    : reject;
}

function validateRecoveryState(value) {
  return typeof value === "string" && RECOVERY_STATES.has(value) ? accept(value) : reject;
}

function validateRecoveryRoute(value) {
  if (value === null) return accept(null);
  return typeof value === "string" && RECOVERY_ROUTE_RE.test(value) ? accept(value) : reject;
}

function validateRecoveryArgs(value) {
  if (value === null || value === undefined) return accept(null);
  if (!isPlainObject(value)) return reject;
  const projected = {};
  for (const key of Object.keys(value)) {
    if (key === "role") {
      if (value.role === null) { projected.role = null; continue; }
      if (typeof value.role !== "string" || !RECOVERY_ROLE_VALUES.has(value.role)) return reject;
      projected.role = value.role;
      continue;
    }
    if (key === "subject") {
      if (typeof value.subject !== "string" || !RECOVERY_SUBJECT_RE.test(value.subject)) return reject;
      projected.subject = value.subject;
      continue;
    }
    return reject;
  }
  return accept(Object.freeze(projected));
}

function validateActorRecovery(value) {
  return typeof value === "string" && ACTOR_RECOVERY_VALUES.has(value) ? accept(value) : reject;
}

function validateNextAction(value) {
  return typeof value === "string" && BOUNDED_TOKEN_RE.test(value) ? accept(value) : reject;
}

function validateMismatchField(value) {
  if (value === null) return accept(null);
  return typeof value === "string" && BOUNDED_TOKEN_RE.test(value) ? accept(value) : reject;
}

function validateMismatchValue(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return accept(value);
  }
  return typeof value === "string" && value.length <= MISMATCH_VALUE_MAX_LENGTH
    ? accept(value)
    : reject;
}

function validateSubjectField(value) {
  return typeof value === "string" && RECOVERY_SUBJECT_RE.test(value) ? accept(value) : reject;
}

function validateRoleField(value) {
  return typeof value === "string" && RECOVERY_ROLE_VALUES.has(value) ? accept(value) : reject;
}

const NEXT_ACTION_ARGS_ALLOWLIST = Object.freeze({
  role: (value) => (value === null ? accept(null) : validateRoleField(value)),
  subject: validateSubjectField
});

const CAUSE_ALLOWLIST = Object.freeze({
  type: validateCauseType,
  code: validateCauseCodeField
});

const RECOVERY_ALLOWLIST = Object.freeze({
  state: validateRecoveryState,
  route: validateRecoveryRoute,
  args: validateRecoveryArgs
});

const SCALAR_DETAIL_ALLOWLIST = Object.freeze({
  cause_code: validateCauseCodeField,
  next_action: validateNextAction,
  actor_recovery: validateActorRecovery,
  mismatch_field: validateMismatchField,
  expected: validateMismatchValue,
  actual: validateMismatchValue,
  subject: validateSubjectField,
  role: validateRoleField
});

const NESTED_DETAIL_ALLOWLIST = Object.freeze({
  cause: CAUSE_ALLOWLIST,
  recovery: RECOVERY_ALLOWLIST,
  next_action_args: NEXT_ACTION_ARGS_ALLOWLIST
});

function assertAuthenticatedRefusalEnvelope(envelope) {
  if (!isPlainObject(envelope) || typeof envelope.schema_version !== "string" ||
      envelope.schema_version.length === 0 || envelope.accepted !== false ||
      !isPlainObject(envelope.refusal)) {
    throw new LauncherTransitionRefusalSchemaError(
      "launcher transition backend refusal classification requires an authenticated refusal envelope with schema_version, accepted:false, and refusal.{code,reason,detail}",
      { field: "envelope" }
    );
  }
  const { refusal } = envelope;
  if (!("code" in refusal) || !("reason" in refusal) || !("detail" in refusal)) {
    throw new LauncherTransitionRefusalSchemaError(
      "authenticated refusal must declare refusal.code, refusal.reason, and refusal.detail",
      { field: "refusal" }
    );
  }
  if (refusal.detail !== null && !isPlainObject(refusal.detail)) {
    throw new LauncherTransitionRefusalSchemaError(
      "authenticated refusal detail must be an object or null",
      { field: "refusal.detail" }
    );
  }
  return refusal;
}

export function classifyLauncherTransitionBackendRefusal(envelope) {
  const refusal = assertAuthenticatedRefusalEnvelope(envelope);
  const detail = refusal.detail ?? {};
  const redactions = [];
  const schemaRejected = [];

  const refusalCode = readDeclaredCauseCode(refusal.code, "refusal.code");
  const refusalReason = readDeclaredCauseCode(refusal.reason, "refusal.reason");

  const bootstrapCauseCode = isPlainObject(detail.cause)
    ? readDeclaredCauseCode(detail.cause.code, "detail.cause.code")
    : null;
  const tipCauseCode = readDeclaredCauseCode(detail.cause_code, "detail.cause_code");
  const causeSource = bootstrapCauseCode !== null
    ? "detail.cause.code"
    : tipCauseCode !== null
      ? "detail.cause_code"
      : refusalReason !== null ? "refusal.reason" : null;
  const causeCode = bootstrapCauseCode ?? tipCauseCode ?? refusalReason;
  if (causeCode === null) {
    throw new LauncherTransitionRefusalSchemaError(
      "authenticated refusal carries no bounded cause code on any declared producer path",
      { field: "detail.cause.code|detail.cause_code|refusal.reason" }
    );
  }

  const diagnostics = {};
  const conduitSensitiveValues = stdioMcpSensitiveValues(causeCode, detail);
  for (const key of Object.keys(detail)) {
    if (DIAGNOSTIC_DETAIL_KEYS.has(key)) {
      if (!isDiagnosticValue(detail[key])) {
        schemaRejected.push(`detail.${key}`);
        continue;
      }
      const diagnostic = conduitSensitiveValues.length > 0
        ? captureStructuredDiagnostic(detail[key], { sensitiveValues: conduitSensitiveValues })
        : detail[key];
      const projected = projectDiagnostic(diagnostic, { fieldPrefix: `detail.${key}` });
      diagnostics[key] = projected.value;
      redactions.push(...projected.redactions);
      continue;
    }
    const scalarValidate = SCALAR_DETAIL_ALLOWLIST[key];
    if (scalarValidate !== undefined) {
      const outcome = scalarValidate(detail[key]);
      if (outcome.ok) diagnostics[key] = outcome.value;
      else schemaRejected.push(`detail.${key}`);
      continue;
    }
    if (NESTED_DETAIL_ALLOWLIST[key] !== undefined) continue;
    const reason = redactionReasonForDetailKey(key);
    if (reason === null) schemaRejected.push(`detail.${key}`);
    else redactions.push({ field: `detail.${key}`, reason });
  }
  for (const [key, allowlist] of Object.entries(NESTED_DETAIL_ALLOWLIST)) {
    const projected = projectNestedAllowlist(
      detail[key], `detail.${key}`, allowlist, { redactions, schemaRejected }
    );

    if (projected !== null && Object.keys(projected).length > 0) {
      diagnostics[key] = Object.freeze(projected);
    }
  }

  const baseKnown = classifyKnownCause(causeCode);
  const specificFailure = selectSpecificMechanicalTransition(causeCode, detail);
  const known = specificFailure === null
    ? baseKnown
    : {
        state: CLASSIFICATION_STATES.KNOWN,
        failure: specificFailure,
        actorRecovery: baseKnown?.actorRecovery ?? null
      };
  const state = known?.state ?? CLASSIFICATION_STATES.AUTHENTICATED_UNCLASSIFIED;
  const transitionFailure = known?.failure ??
    LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED;

  const declaredRecovery = diagnostics.recovery ?? null;
  const declaredCallableArgs = diagnostics.next_action === "workspace_agent_dispatch" &&
      diagnostics.actor_recovery === "coordinator" &&
      typeof diagnostics.next_action_args?.subject === "string"
    ? diagnostics.next_action_args
    : null;

  const recovery = typeof declaredRecovery?.state === "string"
    ? (declaredRecovery.state === "callable" && typeof declaredRecovery.route === "string"
        ? Object.freeze({
            state: "callable",
            route: declaredRecovery.route,
            args: declaredRecovery.args ?? null
          })
        : Object.freeze({ state: "no_supported_route", route: null }))
    : declaredCallableArgs !== null
      ? Object.freeze({
          state: "callable",
          route: "workspace_agent_dispatch",
          args: Object.freeze({
            role: declaredCallableArgs.role ?? null,
            subject: declaredCallableArgs.subject
          })
        })
      : Object.freeze({ state: "no_supported_route", route: null });

  const causeType = diagnostics.cause?.type ?? "launcher_refusal";

  const blockerCode = state === CLASSIFICATION_STATES.ACTUAL_BACKEND_UNAVAILABLE
    ? RUNTIME_BLOCKER_CODES.BACKEND_UNAVAILABLE
    : BLOCKER_CODE_BY_REFUSAL_CODE[refusalCode] ?? RUNTIME_BLOCKER_CODES.OPERATOR_RECOVERY_NEEDED;

  return Object.freeze({
    schema_version: LAUNCHER_TRANSITION_BACKEND_REFUSAL_CLASSIFICATION_SCHEMA_VERSION,
    state,
    cause: Object.freeze({
      type: causeType,
      code: causeCode,
      source: causeSource,
      classification_code: state === CLASSIFICATION_STATES.AUTHENTICATED_UNCLASSIFIED
        ? LAUNCHER_TRANSITION_UNCLASSIFIED_CODE
        : null
    }),
    refusal_code: refusalCode,
    refusal_reason: refusalReason,
    transition_failure: transitionFailure,
    blocker_code: blockerCode,
    authority_limb: transitionFailure.authority_limb,
    actor_recovery: diagnostics.actor_recovery ?? known?.actorRecovery ?? null,

    next_action: recovery.state === "callable" ? recovery.route : null,
    recovery,
    diagnostics: Object.freeze(diagnostics),
    redactions: Object.freeze(redactions.map((signal) => Object.freeze({ ...signal }))),
    schema_rejected: Object.freeze([...schemaRejected])
  });
}
