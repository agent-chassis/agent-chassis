

import path from "node:path";
import {
  BACKEND_ACCEPTED_ROLES,
  BACKEND_REFUSAL_CODES,
  BACKEND_FINAL_RESULT_KINDS,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  normalizeFinalResult,
  validateLauncherFamilyRole
} from "./workspace-agent-dispatch-backend.mjs";

import {
  DEFAULT_BWRAP_ENV_SECRET_DENY_NAMES,
  DEFAULT_BWRAP_ENV_SECRET_DENY_NAME_PATTERNS
} from "./launch-isolation.mjs";

import {
  IDENTITY_REFUSAL_CODES,
  CALLER_SUPPLIED_IDENTITY_CARRIERS
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";

export const WORKSPACE_AGENT_LAUNCH_SEAM_SCHEMA_VERSION =
  "workspace-agent-launch-seam.v1";

export {
  BACKEND_FINAL_RESULT_KINDS,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  normalizeFinalResult
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

const TRUSTED_CORRECTIVE_FINDINGS_FIELDS = Object.freeze([
  "schema_version", "authority", "unit_address", "source_worker_run_id",
  "source_worker_monitor_handle", "review_run_id", "review_monitor_handle",
  "reviewed_sha", "diff_base_sha", "findings", "finding_counts",
  "trusted_evidence_digest"
]);
const TRUSTED_CORRECTIVE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const TRUSTED_CORRECTIVE_OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const TRUSTED_CORRECTIVE_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const TRUSTED_CORRECTIVE_SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
const TRUSTED_CORRECTIVE_COUNT_FIELDS = Object.freeze([
  "total", "blocking", "critical", "high", "medium", "low", "info"
]);

function isTrustedCorrectiveFinding(value) {
  const keys = isPlainObject(value) ? Object.keys(value).sort() : [];
  const required = ["affected_paths", "blocking", "id", "severity", "title"];
  const allowed = new Set([...required, "control_id"]);
  return required.every((field) => Object.prototype.hasOwnProperty.call(value ?? {}, field)) &&
    keys.every((field) => allowed.has(field)) &&
    isNonEmptyString(value.id) && isNonEmptyString(value.title) &&
    TRUSTED_CORRECTIVE_SEVERITIES.has(value.severity) &&
    typeof value.blocking === "boolean" && Array.isArray(value.affected_paths) &&
    value.affected_paths.every((entry) => isPlainObject(entry) &&
      Object.keys(entry).sort().join("|") === "line|path" &&
      isNonEmptyString(entry.path) && !path.posix.isAbsolute(entry.path) &&
      path.posix.normalize(entry.path) === entry.path &&
      (entry.line === null || (Number.isInteger(entry.line) && entry.line > 0)));
}

function hasExactTrustedCorrectiveCounts(counts, findings) {
  if (!isPlainObject(counts) ||
      Object.keys(counts).sort().join("|") !== [...TRUSTED_CORRECTIVE_COUNT_FIELDS].sort().join("|") ||
      TRUSTED_CORRECTIVE_COUNT_FIELDS.some((field) => !Number.isInteger(counts[field]) || counts[field] < 0)) {
    return false;
  }
  const expected = Object.fromEntries(TRUSTED_CORRECTIVE_COUNT_FIELDS.map((field) => [field, 0]));
  expected.total = findings.length;
  for (const finding of findings) {
    expected[finding.severity] += 1;
    if (finding.blocking) expected.blocking += 1;
  }
  return TRUSTED_CORRECTIVE_COUNT_FIELDS.every((field) => counts[field] === expected[field]);
}

export function validateTrustedCorrectiveFindingsContext(value, { subject } = {}) {
  const keys = isPlainObject(value) ? Object.keys(value).sort() : [];
  const expected = [...TRUSTED_CORRECTIVE_FINDINGS_FIELDS].sort();
  const exact = keys.length === expected.length &&
    keys.every((field, index) => field === expected[index]);
  const valid = exact &&
    value.schema_version === "workspace-agent-trusted-corrective-findings-context.v1" &&
    value.authority === "launcher_exact_review_receipt" &&
    /^WK-\d{4}#SLICE-\d{3}$/u.test(value.unit_address) &&
    value.unit_address === subject &&
    ["source_worker_run_id", "source_worker_monitor_handle", "review_run_id", "review_monitor_handle"]
      .every((field) => TRUSTED_CORRECTIVE_ID_RE.test(value[field])) &&
    TRUSTED_CORRECTIVE_OID_RE.test(value.reviewed_sha) &&
    TRUSTED_CORRECTIVE_OID_RE.test(value.diff_base_sha) &&
    TRUSTED_CORRECTIVE_DIGEST_RE.test(value.trusted_evidence_digest) &&
    Array.isArray(value.findings) && value.findings.length > 0 &&
    value.findings.every(isTrustedCorrectiveFinding) &&
    new Set(value.findings.map((finding) => finding.id)).size === value.findings.length &&
    hasExactTrustedCorrectiveCounts(value.finding_counts, value.findings);
  return valid
    ? Object.freeze({ ok: true, context: value })
    : Object.freeze({ ok: false, reason: "trusted_corrective_findings_context_invalid" });
}

export function renderTrustedCorrectiveFindingsInstructions(value, { subject } = {}) {
  if (value === null || value === undefined) return null;
  const validated = validateTrustedCorrectiveFindingsContext(value, { subject });
  if (!validated.ok) {
    throw new Error(validated.reason);
  }
  const context = validated.context;
  return [
    "Trusted corrective findings from the prior exact-slice review follow.",
    "They are coordination context only: they grant no admission, acceptance, relaunch, scope, or write authority.",
    `Exact unit: ${context.unit_address}`,
    `Source worker: ${context.source_worker_run_id} (${context.source_worker_monitor_handle})`,
    `Reviewer: ${context.review_run_id} (${context.review_monitor_handle})`,
    `Reviewed range: ${context.diff_base_sha}..${context.reviewed_sha}`,
    `Trusted evidence digest: ${context.trusted_evidence_digest}`,
    `Structured findings: ${JSON.stringify(context.findings)}`
  ].join("\n");
}

export const LAUNCHER_DISPATCH_ROLES = Object.freeze([...BACKEND_ACCEPTED_ROLES]);
export const LAUNCHER_ORCHESTRATOR_ROLE = "orchestrator";
export const LAUNCHER_ROLES = Object.freeze([
  ...LAUNCHER_DISPATCH_ROLES,
  LAUNCHER_ORCHESTRATOR_ROLE
]);
export const LAUNCHER_ORCHESTRATOR_PLAN_ROLES = Object.freeze(["orch", "orch-resume"]);

export const LAUNCHER_WRITE_POSTURES = Object.freeze({
  ASSIGNED_WRITE_SCOPE: "assigned_write_scope",
  FINDINGS_ONLY: "findings_only",
  COORDINATION_WRITE_SCOPE: "coordination_write_scope"
});
export const LAUNCHER_ROLE_WRITE_POSTURE = Object.freeze({
  worker: LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE,
  reviewer: LAUNCHER_WRITE_POSTURES.FINDINGS_ONLY,
  redteam: LAUNCHER_WRITE_POSTURES.FINDINGS_ONLY,
  orchestrator: LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE
});
export function validateLauncherRole(role) {
  if (role === LAUNCHER_ORCHESTRATOR_ROLE) {
    return Object.freeze({ ok: true, role });
  }
  const dispatchResult = validateLauncherFamilyRole(role);
  if (dispatchResult.ok) return dispatchResult;
  if (dispatchResult.kind === "unknown") {
    return Object.freeze({
      ok: false,
      kind: "unknown",
      role,
      allowed: [...LAUNCHER_ROLES]
    });
  }
  return dispatchResult;
}
export function launcherRoleWritePosture(role) {
  return LAUNCHER_ROLE_WRITE_POSTURE[role] ?? null;
}
export function launcherRoleMayWrite(role) {
  const posture = launcherRoleWritePosture(role);
  return (
    posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE ||
    posture === LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE
  );
}

export const LAUNCHER_ISOLATION_SUPPORTED_ROLES = Object.freeze([
  "orch",
  "orch-resume",
  "worker",
  "review",
  "redteam"
]);

export const LAUNCHER_ISOLATION_WRITER_ROLES = Object.freeze([
  "orch",
  "orch-resume",
  "worker"
]);

export const LAUNCHER_ISOLATION_READER_ROLES = Object.freeze([
  "review",
  "redteam"
]);
export function isLauncherIsolationRole(role) {
  return typeof role === "string"
    && LAUNCHER_ISOLATION_SUPPORTED_ROLES.includes(role);
}
export function deriveWorkerWritableRoots({ repo, writableProjectRoots = [] } = {}) {
  if (!isNonEmptyString(repo)) return [];
  const out = [];
  const seen = new Set();
  for (const root of Array.isArray(writableProjectRoots) ? writableProjectRoots : []) {
    if (typeof root !== "string" || root.length === 0) continue;
    const abs = path.isAbsolute(root) ? root : path.resolve(repo, root);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}
export function deriveWorkerWritableFiles({ repo, writableFiles = [] } = {}) {
  if (!isNonEmptyString(repo)) return [];
  const out = [];
  const seen = new Set();
  for (const file of Array.isArray(writableFiles) ? writableFiles : []) {
    if (typeof file !== "string" || file.length === 0) continue;
    const abs = path.isAbsolute(file) ? file : path.resolve(repo, file);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

export function deriveOrchestratorWritableRoots({ repo } = {}) {
  if (!isNonEmptyString(repo)) return [];
  const out = [];
  const seen = new Set();
  for (const sub of ["docs", "wiki"]) {
    const abs = path.resolve(repo, sub);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

export function deriveOrchestratorRuntimeRoots({
  runtimeDir = null,
  extraRuntimeRoots = []
} = {}) {
  const out = [];
  const seen = new Set();
  if (isNonEmptyString(runtimeDir)) {
    seen.add(runtimeDir);
    out.push(runtimeDir);
  }
  for (const extra of Array.isArray(extraRuntimeRoots) ? extraRuntimeRoots : []) {
    if (!isNonEmptyString(extra)) continue;
    if (seen.has(extra)) continue;
    seen.add(extra);
    out.push(extra);
  }
  return out;
}
export function deriveWorkerRuntimeRoots({
  runtimeDir = null,
  extraRuntimeRoots = []
} = {}) {
  return deriveOrchestratorRuntimeRoots({ runtimeDir, extraRuntimeRoots });
}

export function deriveReviewWritableRoots() {
  return [];
}
export function deriveReviewWritableFiles() {
  return [];
}
export function deriveReviewRuntimeRoots({
  runtimeDir = null,
  extraRuntimeRoots = []
} = {}) {
  return deriveOrchestratorRuntimeRoots({ runtimeDir, extraRuntimeRoots });
}

export function deriveRoleHomePolicyReads({ role, sourceHome }) {
  if (!isNonEmptyString(sourceHome)) return [];
  if (role === "worker" || role === "review" || role === "redteam") {
    return [sourceHome];
  }
  return [];
}

export function assertSourceHomeIsNotWritable({ role, isolation, sourceHome } = {}) {
  if (!isolation || typeof isolation !== "object") {
    throw new Error("assertSourceHomeIsNotWritable: isolation inputs are required");
  }
  if (!isNonEmptyString(sourceHome)) {
    throw new Error("assertSourceHomeIsNotWritable: sourceHome must be a non-empty string");
  }
  const roleLabel = isNonEmptyString(role) ? role : "role";
  for (const list of ["writable_roots", "runtime_roots"]) {
    const entries = Array.isArray(isolation[list]) ? isolation[list] : [];
    for (const entry of entries) {
      if (entry === sourceHome) {
        throw new Error(
          `codex-${roleLabel}: source Codex home must not be a writable ${list === "writable_roots" ? "root" : "runtime root"}: ${sourceHome}`
        );
      }
    }
  }
  return true;
}

export const LAUNCHER_ADAPTER_FACT_HOOKS = Object.freeze([
  "discoverBinary",
  "probeRuntime",
  "buildArgv",
  "modelSupport",
  "runtimeFacts",
  "permissionFlags",
  "resultSource",
  "parseFinalResult"
]);

export const LAUNCHER_FORBIDDEN_ADAPTER_HOOKS = Object.freeze([
  "validateRole",
  "validateLauncherRole",
  "evaluateReadiness",
  "evaluateAdmission",
  "evaluateWorkerAdmission",
  "refuseCallerSuppliedWorkerIdentity",
  "refuseCallerSuppliedIdentityFields",
  "resolveCallerIdentity",
  "enforceOrchestratorOperatorOnly",
  "gateReviewerWriteScope",
  "gateWriteScope",
  "buildBwrapPlan",
  "buildBubblewrapLaunchPlan",
  "assembleWritableRoots",
  "assembleReadOnlyRoots",
  "applyEnvPolicy",
  "redactTransportSecrets",
  "deriveTerminalStatus",
  "normalizeFinalResult",
  "buildRefusal",
  "buildRefusalEnvelope",
  "buildRefusalTaxonomy",
  "superviseChildLaunch",
  "handleSignal",
  "deriveRuntimeState"
]);

export const LAUNCHER_OWNED_POLICY_SURFACES = Object.freeze([
  "role_policy",
  "readiness_admission_handoff",
  "reviewer_redteam_write_scope_gating",
  "caller_supplied_identity_refusal",
  "graph_impact_bridge_handoff",
  "launcher_env_runtime_context",
  "bwrap_isolation_input",
  "final_result_normalization",
  "transport_secret_redaction",
  "refusal_envelope",
  "runtime_state_lifecycle",
  "terminal_state_derivation",
  "signal_exit_handling",
  "coordination_write_scope_authority"
]);
export function sanitizeFamilyAdapter(adapter) {
  if (!isPlainObject(adapter)) return Object.freeze({});
  const sanitized = {};
  for (const hook of LAUNCHER_ADAPTER_FACT_HOOKS) {
    if (Object.prototype.hasOwnProperty.call(adapter, hook)) {
      sanitized[hook] = adapter[hook];
    }
  }
  return Object.freeze(sanitized);
}

export function validateFamilyAdapter(adapter) {
  if (!isPlainObject(adapter)) {
    return Object.freeze({
      ok: false,
      refusal: buildLauncherRefusal({
        reason: LAUNCHER_REFUSAL_REASONS.ADAPTER_NOT_OBJECT,
        detail: { received_type: adapter === null ? "null" : typeof adapter }
      })
    });
  }
  const forbidden = [];
  const unknown = [];
  for (const key of Object.keys(adapter)) {
    if (LAUNCHER_ADAPTER_FACT_HOOKS.includes(key)) continue;
    if (LAUNCHER_FORBIDDEN_ADAPTER_HOOKS.includes(key)) {
      forbidden.push(key);
    } else {
      unknown.push(key);
    }
  }
  if (forbidden.length > 0) {
    return Object.freeze({
      ok: false,
      refusal: buildLauncherRefusal({
        reason: LAUNCHER_REFUSAL_REASONS.ADAPTER_OWNS_POLICY,
        detail: { forbidden_hooks: forbidden }
      })
    });
  }
  if (unknown.length > 0) {
    return Object.freeze({
      ok: false,
      refusal: buildLauncherRefusal({
        reason: LAUNCHER_REFUSAL_REASONS.ADAPTER_UNKNOWN_HOOK,
        detail: { unknown_hooks: unknown }
      })
    });
  }
  return Object.freeze({ ok: true, adapter: sanitizeFamilyAdapter(adapter) });
}

export const LAUNCHER_REFUSAL_REASONS = Object.freeze({
  ROLE_MISSING: "launcher_role_missing",
  ROLE_UNSUPPORTED: "launcher_role_unsupported",
  ADAPTER_NOT_OBJECT: "launcher_adapter_not_object",
  ADAPTER_OWNS_POLICY: "launcher_adapter_owns_policy",
  ADAPTER_UNKNOWN_HOOK: "launcher_adapter_unknown_hook",
  REVIEWER_WRITE_SCOPE_NONEMPTY: "launcher_reviewer_write_scope_nonempty",
  REDTEAM_WRITE_SCOPE_NONEMPTY: "launcher_redteam_write_scope_nonempty",
  ORCHESTRATOR_WRITE_SCOPE_NONCOORDINATION:
    "launcher_orchestrator_write_scope_noncoordination",
  WORKER_WRITE_SCOPE_EMPTY: "launcher_worker_write_scope_empty",
  READINESS_HANDOFF_INVALID: "launcher_readiness_handoff_invalid",
  ADMISSION_HANDOFF_INVALID: "launcher_admission_handoff_invalid",
  IDENTITY_CALLER_SUPPLIED: "launcher_identity_caller_supplied",
  IDENTITY_REFUSAL_HANDOFF_INVALID: "launcher_identity_refusal_handoff_invalid",
  BWRAP_INPUT_INVALID: "launcher_bwrap_input_invalid"
});

const LAUNCHER_REASON_TO_BACKEND_CODE = Object.freeze({
  [LAUNCHER_REFUSAL_REASONS.ROLE_MISSING]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.ROLE_UNSUPPORTED]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.ADAPTER_NOT_OBJECT]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.ADAPTER_OWNS_POLICY]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.ADAPTER_UNKNOWN_HOOK]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.REVIEWER_WRITE_SCOPE_NONEMPTY]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.REDTEAM_WRITE_SCOPE_NONEMPTY]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.ORCHESTRATOR_WRITE_SCOPE_NONCOORDINATION]:
    BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.WORKER_WRITE_SCOPE_EMPTY]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.READINESS_HANDOFF_INVALID]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.ADMISSION_HANDOFF_INVALID]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.IDENTITY_CALLER_SUPPLIED]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.IDENTITY_REFUSAL_HANDOFF_INVALID]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  [LAUNCHER_REFUSAL_REASONS.BWRAP_INPUT_INVALID]: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED
});
export function launcherRefusalBackendCode(reason) {
  return LAUNCHER_REASON_TO_BACKEND_CODE[reason] ?? BACKEND_REFUSAL_CODES.LAUNCH_REFUSED;
}

export function buildLauncherRefusal({ reason, code = null, detail = null } = {}) {
  const resolvedCode = isNonEmptyString(code) ? code : launcherRefusalBackendCode(reason);
  return Object.freeze({
    schema_version: WORKSPACE_AGENT_LAUNCH_SEAM_SCHEMA_VERSION,
    accepted: false,
    refusal: Object.freeze({
      code: resolvedCode,
      reason: reason ?? null,
      detail: detail === null || detail === undefined
        ? null
        : redactTransportSecrets(detail)
    })
  });
}

export const LAUNCHER_READINESS_HANDOFF_FIELDS = Object.freeze([
  "dispatchable",
  "decision_code",
  "unit_address",
  "expected_unit_address",
  "diagnostics"
]);
export const LAUNCHER_ADMISSION_HANDOFF_FIELDS = Object.freeze([
  "allowed",
  "reason",
  "detail"
]);
export function normalizeReadinessHandoff(readiness) {
  if (!isPlainObject(readiness) || typeof readiness.dispatchable !== "boolean") {
    return buildLauncherRefusal({
      reason: LAUNCHER_REFUSAL_REASONS.READINESS_HANDOFF_INVALID,
      detail: { issue: "missing_dispatchable_decision" }
    });
  }
  return Object.freeze({
    ok: true,
    readiness: Object.freeze({
      dispatchable: readiness.dispatchable,
      decision_code: isNonEmptyString(readiness.decision_code)
        ? readiness.decision_code
        : null,
      unit_address: isNonEmptyString(readiness.unit_address)
        ? readiness.unit_address
        : null,
      expected_unit_address: isNonEmptyString(readiness.expected_unit_address)
        ? readiness.expected_unit_address
        : null,
      diagnostics: Array.isArray(readiness.diagnostics) ? readiness.diagnostics : []
    })
  });
}
export function normalizeAdmissionHandoff(admission) {
  if (!isPlainObject(admission) || typeof admission.allowed !== "boolean") {
    return buildLauncherRefusal({
      reason: LAUNCHER_REFUSAL_REASONS.ADMISSION_HANDOFF_INVALID,
      detail: { issue: "missing_allowed_decision" }
    });
  }
  return Object.freeze({
    ok: true,
    admission: Object.freeze({
      allowed: admission.allowed,
      reason: isNonEmptyString(admission.reason) ? admission.reason : null,
      detail: isPlainObject(admission.detail) ? admission.detail : null
    })
  });
}

const KNOWN_IDENTITY_REFUSAL_CODES = new Set(Object.values(IDENTITY_REFUSAL_CODES));
export const LAUNCHER_IDENTITY_REFUSAL_HANDOFF_FIELDS = Object.freeze([
  "identity_refusal_code",
  "carrier"
]);

export function normalizeIdentityRefusalHandoff(refusal) {
  if (refusal === null || refusal === undefined) {
    return Object.freeze({ ok: true, identity_refusal: null });
  }
  if (
    !isPlainObject(refusal) ||
    refusal.accepted !== false ||
    !isNonEmptyString(refusal.refusal_code)
  ) {
    return Object.freeze({
      ok: false,
      refusal: buildLauncherRefusal({
        reason: LAUNCHER_REFUSAL_REASONS.IDENTITY_REFUSAL_HANDOFF_INVALID,
        detail: { issue: "malformed_identity_refusal" }
      })
    });
  }
  const carrier =
    isPlainObject(refusal.detail) && isNonEmptyString(refusal.detail.carrier)
      ? refusal.detail.carrier
      : null;
  return Object.freeze({
    ok: false,
    refusal: buildLauncherRefusal({
      reason: LAUNCHER_REFUSAL_REASONS.IDENTITY_CALLER_SUPPLIED,
      detail: {
        identity_refusal_code: refusal.refusal_code,
        identity_refusal_code_known: KNOWN_IDENTITY_REFUSAL_CODES.has(refusal.refusal_code),
        carrier,
        carrier_known:
          carrier === null ? null : CALLER_SUPPLIED_IDENTITY_CARRIERS.has(carrier)
      }
    })
  });
}

export const LAUNCHER_PRE_SPAWN_GATE_PRIMITIVES = Object.freeze([
  "readiness_admission_handoff",
  "reviewer_redteam_write_scope_gating",
  "caller_supplied_identity_refusal",
  "graph_impact_bridge_handoff"
]);

export const LAUNCHER_COORDINATION_WRITE_ROOTS = Object.freeze(["wiki/", "docs/"]);
export function isCoordinationWritePath(p) {
  if (!isNonEmptyString(p)) return false;
  const normalized = p.replace(/^\.\/+/, "");
  return LAUNCHER_COORDINATION_WRITE_ROOTS.some(
    (root) => normalized === root.replace(/\/$/, "") || normalized.startsWith(root)
  );
}

export function gateRoleWriteScope({
  role,
  write_scope = [],
  launcher_owned_exact_slice_review = false
} = {}) {
  const scope = Array.isArray(write_scope)
    ? write_scope.filter(isNonEmptyString)
    : [];
  if (role === "reviewer") {
    if (scope.length > 0) {
      if (launcher_owned_exact_slice_review === true) {
        return Object.freeze({ ok: true, write_scope: Object.freeze([]) });
      }
      return Object.freeze({
        ok: false,
        refusal: buildLauncherRefusal({
          reason: LAUNCHER_REFUSAL_REASONS.REVIEWER_WRITE_SCOPE_NONEMPTY,
          detail: { write_scope: scope }
        })
      });
    }
    return Object.freeze({ ok: true, write_scope: Object.freeze([]) });
  }
  if (role === "redteam") {
    if (scope.length > 0) {
      return Object.freeze({
        ok: false,
        refusal: buildLauncherRefusal({
          reason: LAUNCHER_REFUSAL_REASONS.REDTEAM_WRITE_SCOPE_NONEMPTY,
          detail: { write_scope: scope }
        })
      });
    }
    return Object.freeze({ ok: true, write_scope: Object.freeze([]) });
  }
  if (role === LAUNCHER_ORCHESTRATOR_ROLE) {
    const offending = scope.filter((p) => !isCoordinationWritePath(p));
    if (offending.length > 0) {
      return Object.freeze({
        ok: false,
        refusal: buildLauncherRefusal({
          reason: LAUNCHER_REFUSAL_REASONS.ORCHESTRATOR_WRITE_SCOPE_NONCOORDINATION,
          detail: {
            offending_paths: offending,
            coordination_roots: [...LAUNCHER_COORDINATION_WRITE_ROOTS]
          }
        })
      });
    }
    return Object.freeze({ ok: true, write_scope: Object.freeze([...scope]) });
  }
  if (scope.length === 0) {
    return Object.freeze({
      ok: false,
      refusal: buildLauncherRefusal({
        reason: LAUNCHER_REFUSAL_REASONS.WORKER_WRITE_SCOPE_EMPTY,
        detail: null
      })
    });
  }
  return Object.freeze({ ok: true, write_scope: Object.freeze([...scope]) });
}

export const LAUNCHER_GRAPH_IMPACT_HANDOFF_FIELDS = Object.freeze([
  "input_paths",
  "validated_paths",
  "graph_impact_summary_ref",
  "dirty_state",
  "staleness",
  "edge_source"
]);

export function normalizeGraphImpactHandoff(handoff) {
  if (!isPlainObject(handoff)) return null;
  const inputPaths = Array.isArray(handoff.input_paths)
    ? handoff.input_paths.filter(isNonEmptyString)
    : [];
  const validatedPaths = Array.isArray(handoff.validated_paths)
    ? handoff.validated_paths.filter(isNonEmptyString)
    : [];
  const ref = isPlainObject(handoff.graph_impact_summary_ref)
    ? handoff.graph_impact_summary_ref
    : null;
  if (inputPaths.length === 0 && validatedPaths.length === 0 && ref === null) {
    return null;
  }
  return Object.freeze({
    input_paths: Object.freeze(inputPaths),
    validated_paths: Object.freeze(validatedPaths),
    graph_impact_summary_ref: ref,
    dirty_state: isNonEmptyString(handoff.dirty_state) ? handoff.dirty_state : null,
    staleness: isNonEmptyString(handoff.staleness) ? handoff.staleness : null,
    edge_source: isNonEmptyString(handoff.edge_source) ? handoff.edge_source : null
  });
}

export const LAUNCHER_TRANSPORT_SECRET_DENY_NAMES = DEFAULT_BWRAP_ENV_SECRET_DENY_NAMES;
export const LAUNCHER_TRANSPORT_SECRET_DENY_NAME_PATTERNS =
  DEFAULT_BWRAP_ENV_SECRET_DENY_NAME_PATTERNS;
export const LAUNCHER_REDACTED_VALUE = "[redacted]";
export function isTransportSecretKey(key) {
  if (typeof key !== "string") return false;
  if (LAUNCHER_TRANSPORT_SECRET_DENY_NAMES.includes(key)) return true;
  for (const pattern of LAUNCHER_TRANSPORT_SECRET_DENY_NAME_PATTERNS) {
    if (pattern.test(key)) return true;
  }
  return false;
}

export function redactTransportSecrets(value, _seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (_seen.has(value)) return "[circular]";
    _seen.add(value);
    return value.map((entry) => redactTransportSecrets(entry, _seen));
  }
  if (isPlainObject(value)) {
    if (_seen.has(value)) return "[circular]";
    _seen.add(value);
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = isTransportSecretKey(key)
        ? LAUNCHER_REDACTED_VALUE
        : redactTransportSecrets(entry, _seen);
    }
    return out;
  }
  return value;
}

export const LAUNCHER_RUNTIME_CONTEXT_FIELDS = Object.freeze([
  "role",
  "subject",
  "app",
  "workspace_dir",
  "write_scope",
  "env",
  "runtime_roots",
  "graph_impact"
]);

export function buildLauncherRuntimeContext({
  role = null,
  subject = null,
  app = null,
  workspace_dir = null,
  write_scope = [],
  env = null,
  runtime_roots = [],
  graph_impact = null
} = {}) {
  return Object.freeze({
    role: isNonEmptyString(role) ? role : null,
    subject: isNonEmptyString(subject) ? subject : null,
    app: isNonEmptyString(app) ? app : null,
    workspace_dir: isNonEmptyString(workspace_dir) ? workspace_dir : null,
    write_scope: Object.freeze(
      Array.isArray(write_scope) ? write_scope.filter(isNonEmptyString) : []
    ),
    env: isPlainObject(env) ? Object.freeze(redactTransportSecrets(env)) : null,
    runtime_roots: Object.freeze(
      Array.isArray(runtime_roots) ? runtime_roots.filter(isNonEmptyString) : []
    ),
    graph_impact: normalizeGraphImpactHandoff(graph_impact)
  });
}

export const LAUNCHER_BWRAP_INPUT_FIELDS = Object.freeze([
  "repo",
  "command",
  "args",
  "cwd",
  "env",
  "readOnlyRoots",
  "writableRoots",
  "writableFiles",
  "runtimeRoots",
  "homePolicy",
  "familyRuntimeReadOnlyRoots",
  "envPolicy",
  "commandResolution",
  "shareNet"
]);

export function validateBwrapInputShape(input) {
  if (!isPlainObject(input)) {
    return Object.freeze({
      ok: false,
      refusal: buildLauncherRefusal({
        reason: LAUNCHER_REFUSAL_REASONS.BWRAP_INPUT_INVALID,
        detail: { issue: "input_not_object" }
      })
    });
  }
  if (!isNonEmptyString(input.repo)) {
    return Object.freeze({
      ok: false,
      refusal: buildLauncherRefusal({
        reason: LAUNCHER_REFUSAL_REASONS.BWRAP_INPUT_INVALID,
        detail: { issue: "repo_required" }
      })
    });
  }
  if (!isNonEmptyString(input.command)) {
    return Object.freeze({
      ok: false,
      refusal: buildLauncherRefusal({
        reason: LAUNCHER_REFUSAL_REASONS.BWRAP_INPUT_INVALID,
        detail: { issue: "command_required" }
      })
    });
  }
  if (input.args !== undefined && !Array.isArray(input.args)) {
    return Object.freeze({
      ok: false,
      refusal: buildLauncherRefusal({
        reason: LAUNCHER_REFUSAL_REASONS.BWRAP_INPUT_INVALID,
        detail: { issue: "args_not_array" }
      })
    });
  }
  return Object.freeze({ ok: true });
}

export const LAUNCHER_RUNTIME_STATES = Object.freeze([
  "launching",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);
export const LAUNCHER_TERMINAL_STATES = Object.freeze([
  "succeeded",
  "failed",
  "cancelled"
]);
const TERMINAL_STATE_SET = new Set(LAUNCHER_TERMINAL_STATES);
export function isTerminalRuntimeState(state) {
  return TERMINAL_STATE_SET.has(state);
}

export const LAUNCHER_DEFAULT_TERMINATION_SIGNAL = "SIGTERM";

export function deriveTerminalStatus({ code = null, signal = null, error = null } = {}) {
  if (error !== null && error !== undefined) return "failed";
  return code === 0 && !signal ? "succeeded" : "failed";
}

export function normalizeExitEnvelope({ code = null, signal = null, error = null } = {}) {
  return Object.freeze({
    code: code ?? null,
    signal: signal ?? null,
    error: error ?? null
  });
}

export function isOrchestratorPlanRole(planRole) {
  return LAUNCHER_ORCHESTRATOR_PLAN_ROLES.includes(planRole);
}

export const LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM = "native_filesystem";
export const LAUNCHER_SOURCE_READ_MODE_LAUNCHER_TOOL_SURFACE = "launcher_tool_surface";
export const LAUNCHER_SOURCE_READ_MODES = Object.freeze([
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
  LAUNCHER_SOURCE_READ_MODE_LAUNCHER_TOOL_SURFACE
]);

export const LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO = Object.freeze({
  mechanism: "bwrap_read_only_repo_filesystem"
});

export function buildFamilyExecutorRegistryEntry({
  executor,
  sourceReadMode,
  nativeReadCapability = null
} = {}) {
  if (typeof executor !== "function") {
    throw new Error("buildFamilyExecutorRegistryEntry requires an executor function");
  }
  if (!LAUNCHER_SOURCE_READ_MODES.includes(sourceReadMode)) {
    throw new Error(
      `buildFamilyExecutorRegistryEntry requires a known sourceReadMode; got ${String(sourceReadMode)}`
    );
  }
  if (sourceReadMode === LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM) {
    if (nativeReadCapability == null) {
      throw new Error(
        "buildFamilyExecutorRegistryEntry: native_filesystem sourceReadMode requires an explicit nativeReadCapability fact"
      );
    }
  } else if (nativeReadCapability != null) {
    throw new Error(
      "buildFamilyExecutorRegistryEntry: launcher_tool_surface sourceReadMode must not declare a nativeReadCapability fact"
    );
  }
  return Object.freeze({
    executor,
    sourceReadMode,
    nativeReadCapability: nativeReadCapability ?? null
  });
}

export function getFamilyNeutralAdapterRegistrySourceReadModeFacts(adapterRegistryEntry) {
  if (adapterRegistryEntry == null || typeof adapterRegistryEntry !== 'object') {
    return Object.freeze({
      sourceReadMode: null,
      sourceReadModeDeclared: false,
      sourceReadModeSource: null,
      nativeReadCapability: null,
      nativeReadCapabilityDeclared: false,
    });
  }

  const sourceReadMode =
    Object.prototype.hasOwnProperty.call(adapterRegistryEntry, 'sourceReadMode')
      ? adapterRegistryEntry.sourceReadMode
      : null;

  const nativeReadCapability =
    Object.prototype.hasOwnProperty.call(adapterRegistryEntry, 'nativeReadCapability')
      ? adapterRegistryEntry.nativeReadCapability
      : null;

  return Object.freeze({
    sourceReadMode,
    sourceReadModeDeclared: sourceReadMode !== null && sourceReadMode !== undefined,
    sourceReadModeSource: 'adapter_registry_harness',
    nativeReadCapability,
    nativeReadCapabilityDeclared: nativeReadCapability !== null && nativeReadCapability !== undefined,
  });
}
