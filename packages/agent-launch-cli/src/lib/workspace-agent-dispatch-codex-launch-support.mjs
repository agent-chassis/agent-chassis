

import {
  BACKEND_REFUSAL_CODES
} from "./workspace-agent-dispatch-backend.mjs";

import {
  LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO,
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM
} from "./workspace-agent-launch-adapter-contract.mjs";

import {
  resolveTerminalStructuredRoleResultMode
} from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import {
  buildLauncherRefusal
} from "./workspace-agent-launch-core.mjs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError
} from "./launch-isolation.mjs";

export const CODEX_FAMILY_SOURCE_READ_MODE = LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM;
export const CODEX_FAMILY_NATIVE_READ_CAPABILITY =
  LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO;

export const CODEX_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION =
  "codex-workspace-agent-launch-executor.v1";

export const CODEX_EXECUTOR_ROLE_MAP = Object.freeze({
  worker: "worker",
  reviewer: "review",
  redteam: "redteam"
});

export const CODEX_ROLE_TO_DISPATCH_ROLE = Object.freeze({
  worker: "worker",
  review: "reviewer",
  redteam: "redteam"
});

export const CODEX_SCHEMA_CONSTRAINED_TERMINAL_RESULT_ROLES = Object.freeze(
  new Set(["worker", "reviewer", "redteam"])
);

function buildWorkerGateRefusalDetail(refusal) {
  if (typeof refusal !== "object" || refusal === null || Array.isArray(refusal)) return null;
  return {
    kind: "worker_gate_refusal.v1",
    wrapper_gate_code: typeof refusal.wrapper_gate_code === "string" ? refusal.wrapper_gate_code : null,
    unit_address: typeof refusal.unit_address === "string" ? refusal.unit_address : null,
    expected_unit_address: typeof refusal.expected_unit_address === "string"
      ? refusal.expected_unit_address
      : null,
    decision_code: typeof refusal.decision_code === "string" ? refusal.decision_code : null,
    diagnostics: Array.isArray(refusal.diagnostics) ? refusal.diagnostics : []
  };
}

export function resolveCodexTerminalStructuredRoleResultMode({
  schemaConstrainedTierIsPaid,
  codexRole
} = {}) {
  const dispatchRole = CODEX_ROLE_TO_DISPATCH_ROLE[codexRole] ?? codexRole;
  const schemaConstrained =
    schemaConstrainedTierIsPaid === true &&
    CODEX_SCHEMA_CONSTRAINED_TERMINAL_RESULT_ROLES.has(dispatchRole);

  return resolveTerminalStructuredRoleResultMode({ schemaConstrained, role: dispatchRole });
}

export function makeRefusal(code, reason, detail) {
  const { schema_version: _schemaVersion, ...envelope } = buildLauncherRefusal({
    code,
    reason,
    detail: detail ?? null
  });
  return envelope;
}

export async function buildCodexLaunchArtifacts({
  planArgs,
  buildPlan,
  buildBwrapPlan,
  ensureWriteRoots,
  assertBwrap
}) {
  let plan;
  try {
    plan = await buildPlan(planArgs);
  } catch (err) {
    return { ok: false, stage: "plan_build_threw", error: err };
  }
  if (!plan || typeof plan !== "object") {
    return { ok: false, stage: "plan_missing" };
  }
  if (plan.mode === "refusal") {
    return { ok: false, stage: "plan_refused", refusal: plan.refusal };
  }
  if (Array.isArray(plan.preparedNewWriteRoots) && plan.preparedNewWriteRoots.length > 0) {
    try {
      await ensureWriteRoots(plan.repo, plan.preparedNewWriteRoots, plan.role);
    } catch (err) {
      return { ok: false, stage: "ensure_write_roots_threw", error: err };
    }
  }
  let bwrapPlan;
  try {
    bwrapPlan = buildBwrapPlan(plan);
  } catch (err) {
    if (err instanceof BubblewrapIsolationError) {
      return { ok: false, stage: "build_bwrap_plan_isolation", error: err };
    }
    return { ok: false, stage: "build_bwrap_plan_threw", error: err };
  }
  try {
    assertBwrap({ env: plan.env, bwrapPath: bwrapPlan.bwrapPath });
  } catch (err) {
    if (err instanceof BubblewrapIsolationError) {
      return { ok: false, stage: "assert_bwrap_isolation", error: err, plan, bwrapPlan };
    }
    return { ok: false, stage: "assert_bwrap_threw", error: err, plan, bwrapPlan };
  }
  return { ok: true, plan, bwrapPlan };
}

export function mapCodexArtifactsFailureToInProcessRefusal(failure) {
  const err = failure.error;
  const message = err?.message ?? (err ? String(err) : null);
  switch (failure.stage) {
    case "plan_build_threw":
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "codex_role_plan_build_threw", {
        message,
        code: err?.code ?? null,
        detail: err?.detail ?? null
      });
    case "plan_missing":
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "codex_role_plan_missing", null);
    case "plan_refused":
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, "codex_role_plan_refused", buildWorkerGateRefusalDetail(failure.refusal));
    case "ensure_write_roots_threw":
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "ensure_new_worker_write_roots_failed", { message });
    case "build_bwrap_plan_isolation":
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, "bubblewrap_plan_refused", { code: err.code, message: err.message });
    case "build_bwrap_plan_threw":
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "build_bwrap_plan_threw", { message });
    case "assert_bwrap_isolation":
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, "bubblewrap_unavailable", { code: err.code, message: err.message });
    case "assert_bwrap_threw":
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "assert_bubblewrap_threw", { message });
    default:
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "codex_launch_artifacts_unknown_failure", { stage: failure.stage ?? null });
  }
}

export function buildCodexFailOpenClosedRefusal(failOpenPlan) {
  const refusal = failOpenPlan?.refusal ?? {};
  return makeRefusal(
    BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
    "codex_isolation_fail_open_refused",
    {
      fail_open_reason: refusal.reason ?? null,
      ...(
        refusal.detail && typeof refusal.detail === "object"
          ? refusal.detail
          : { detail: refusal.detail ?? null }
      )
    }
  );
}

export function bwrapAvailabilityFromCodexIsolationError(err) {
  return Object.freeze({
    available: false,
    diagnostic: Object.freeze({
      code: err?.code ?? null,
      message: err?.message ?? "Codex isolation backend failed before spawn",
      detail: err?.detail ?? null
    })
  });
}

export const CODEX_SANDBOX_DECISION_BWRAP_DIAGNOSTIC_CODES = Object.freeze(new Set([
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_NOT_EXECUTABLE,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_PROBE_FAILED,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED
]));
