

import {
  BACKEND_REFUSAL_CODES,
  normalizeDispatchModelHint
} from "@agent-chassis/agent-launch-core";
import {
  resolveDispatchedRoleModel
} from "./agent-launch-profiles.mjs";
import {
  LAUNCHER_COORDINATION_WRITE_ROOTS as CONTRACT_COORDINATION_WRITE_ROOTS,
  LAUNCHER_WRITE_POSTURES as CONTRACT_WRITE_POSTURES
} from "./workspace-agent-launch-adapter-contract.mjs";
import { evaluateFamilyModelDisposition } from "./workspace-agent-family-launch-policy.mjs";

export const FAMILY_MODEL_DISPOSITIONS = Object.freeze({
  ABSENT: "absent",
  HONOR: "honor",
  REFUSE: "refuse"
});

export const FAMILY_REFUSAL_TRANSPORTS = Object.freeze({
  IN_PROCESS: "in_process"
});

export const FAMILY_MODEL_GATE_REFUSAL_REASONS = Object.freeze({
  MODEL_HINT_DIVERGES_FROM_RESOLVED_MODEL: "model_hint_diverges_from_resolved_model"
});

export const LAUNCHER_WRITE_POSTURES = CONTRACT_WRITE_POSTURES;

export const LAUNCHER_WRITE_POSTURE_FAMILIES = Object.freeze({
  SCOPE_MOUNT: "scope_mount",
  PERMISSION_FLAG: "permission_flag"
});

export const LAUNCHER_SCOPE_MOUNT_SANDBOX_MODES = Object.freeze({
  WORKSPACE_WRITE: "workspace-write",
  READ_ONLY: "read-only"
});

export const LAUNCHER_ORCHESTRATOR_WRITABLE_PROJECT_ROOTS = Object.freeze([
  "docs",
  "wiki"
]);

export const LAUNCHER_COORDINATION_WRITE_ROOTS = Object.freeze([
  ...CONTRACT_COORDINATION_WRITE_ROOTS
]);

const MAX_DIAGNOSTIC_ITEMS = 6;

function truncateList(values, limit = MAX_DIAGNOSTIC_ITEMS) {
  if (!Array.isArray(values)) {
    return [];
  }
  if (values.length <= limit) {
    return values.slice();
  }
  const items = values.slice(0, limit);
  items.push(`...${values.length - limit} more`);
  return items;
}

function buildModelDiagnostics({ disposition, model, supported, details }) {
  return {
    disposition: typeof disposition === "string" ? disposition : null,
    model: typeof model === "string" && model.length > 0 ? model : null,
    supported: supported === true,
    details: truncateList(Array.isArray(details) ? details : details ? [details] : [])
  };
}

function canonicalLauncherRole(role) {
  if (typeof role !== "string") {
    return null;
  }
  const trimmed = role.trim();
  if (trimmed === "review") {
    return "reviewer";
  }
  if (trimmed === "orch" || trimmed === "orch-resume" || trimmed === "resume") {
    return "orchestrator";
  }
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveRoleModelDirectory({ dir, cwd, resolveWorkspaceEnvDir }) {
  if (typeof dir === "string" && dir.length > 0) {
    return dir;
  }
  if (typeof resolveWorkspaceEnvDir === "function") {
    return await resolveWorkspaceEnvDir(cwd);
  }
  return typeof cwd === "string" && cwd.length > 0 ? cwd : null;
}

export function resolveFamilyModelDisposition({ model, isModelSupported } = {}) {
  const classified = evaluateFamilyModelDisposition({
    model,
    normalizeModelHint: normalizeDispatchModelHint,
    isModelSupported
  });
  const disposition = classified.disposition;
  const supported = disposition === FAMILY_MODEL_DISPOSITIONS.HONOR;
  return {
    disposition,
    model: classified.model,
    supported,
    diagnostics: buildModelDiagnostics({
      disposition,
      model: classified.model,
      supported,
      details: [`disposition:${disposition}`]
    })
  };
}

export async function resolveFamilyRoleModelGate({
  role,
  isWorker = false,
  resolvedProfile = null,
  modelHint,
  dir = null,
  cwd = null,
  resolveWorkspaceEnvDir = null,
  resolveRoleModel = resolveDispatchedRoleModel
} = {}) {
  const hint = normalizeDispatchModelHint(modelHint);
  if (isWorker === true && hint === null) {
    return {
      ok: true,
      resolvedProfile,
      model: null,
      modelHint: null,
      disposition: FAMILY_MODEL_DISPOSITIONS.ABSENT
    };
  }

  const modelDir = await resolveRoleModelDirectory({ dir, cwd, resolveWorkspaceEnvDir });
  const resolved = resolveRoleModel({ role, resolvedProfile, dir: modelDir });
  if (!resolved || resolved.ok !== true) {
    return {
      ok: false,
      reason: resolved?.reason ?? "role_model_resolution_failed",
      detail: resolved?.detail ?? { role: typeof role === "string" ? role : null }
    };
  }
  if (hint !== null && hint !== resolved.model) {
    return {
      ok: false,
      reason: FAMILY_MODEL_GATE_REFUSAL_REASONS.MODEL_HINT_DIVERGES_FROM_RESOLVED_MODEL,
      detail: { requested: hint, resolved: resolved.model }
    };
  }

  return {
    ok: true,
    resolvedProfile: isWorker === true ? resolvedProfile : resolved.resolvedProfile,
    model: resolved.model,
    model_source: resolved.model_source ?? null,
    env_key: resolved.env_key ?? null,
    modelHint: hint,
    disposition: FAMILY_MODEL_DISPOSITIONS.HONOR
  };
}

export function buildFamilyModelFlagArgs({ disposition, model, flag } = {}) {
  if (disposition !== FAMILY_MODEL_DISPOSITIONS.HONOR) {
    return [];
  }
  if (typeof flag !== "string" || flag.length === 0) {
    return [];
  }
  if (typeof model !== "string" || model.length === 0) {
    return [];
  }
  return [flag, model];
}

function isValidTransport(transport) {
  return transport === FAMILY_REFUSAL_TRANSPORTS.IN_PROCESS;
}

export function buildFamilyModelRefusal({
  transport = FAMILY_REFUSAL_TRANSPORTS.IN_PROCESS,
  code = BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
  reason,
  detail = null
} = {}) {
  if (!isValidTransport(transport)) {
    return {
      ok: false,
      error: {
        code: "invalid_refusal_transport",
        message: "The in_process refusal transport is required.",
        diagnostics: buildModelDiagnostics({
          disposition: FAMILY_MODEL_DISPOSITIONS.REFUSE,
          details: [`transport:${typeof transport === "string" ? transport : typeof transport}`]
        })
      }
    };
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "missing_refusal_reason",
        message: "A non-empty family refusal reason string is required.",
        diagnostics: buildModelDiagnostics({
          disposition: FAMILY_MODEL_DISPOSITIONS.REFUSE,
          details: ["reason_missing_or_blank"]
        })
      }
    };
  }

  return {
    accepted: false,
    refusal: {
      code: code ?? null,
      reason,
      detail: detail ?? null
    }
  };
}

export function launcherRoleWritePosture(role) {
  const canonicalRole = canonicalLauncherRole(role);
  if (canonicalRole === "worker") {
    return LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE;
  }
  if (canonicalRole === "reviewer" || canonicalRole === "redteam") {
    return LAUNCHER_WRITE_POSTURES.FINDINGS_ONLY;
  }
  if (canonicalRole === "orchestrator") {
    return LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE;
  }
  return null;
}

export function launcherRoleWritableRootPolicy({ role } = {}) {
  const canonicalRole = canonicalLauncherRole(role);
  const posture = launcherRoleWritePosture(canonicalRole);
  if (posture === null) {
    return {
      ok: false,
      role: canonicalRole,
      reason: "launcher_role_unsupported_for_write_posture",
      writableProjectRoots: [],
      coordinationWriteRoots: []
    };
  }
  if (posture === LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE) {
    return {
      ok: true,
      role: canonicalRole,
      posture,
      writableProjectRoots: [...LAUNCHER_ORCHESTRATOR_WRITABLE_PROJECT_ROOTS],
      coordinationWriteRoots: [...LAUNCHER_COORDINATION_WRITE_ROOTS]
    };
  }
  return {
    ok: true,
    role: canonicalRole,
    posture,
    writableProjectRoots: [],
    coordinationWriteRoots: []
  };
}

export function resolveLauncherRoleWritePosture({
  role,
  family = LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT,
  permissionFlag = null
} = {}) {
  const canonicalRole = canonicalLauncherRole(role);
  const posture = launcherRoleWritePosture(canonicalRole);
  if (posture === null) {
    return {
      ok: false,
      role: canonicalRole,
      reason: "launcher_role_unsupported_for_write_posture"
    };
  }
  if (
    family !== LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT &&
    family !== LAUNCHER_WRITE_POSTURE_FAMILIES.PERMISSION_FLAG
  ) {
    return {
      ok: false,
      role: canonicalRole,
      reason: "launcher_write_posture_family_unsupported",
      detail: { family: typeof family === "string" ? family : null }
    };
  }

  const mayWrite =
    posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE ||
    posture === LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE;
  const writableRootPolicy = launcherRoleWritableRootPolicy({ role: canonicalRole });
  const scopeMount = family === LAUNCHER_WRITE_POSTURE_FAMILIES.SCOPE_MOUNT
    ? {
        sandboxMode: mayWrite
          ? LAUNCHER_SCOPE_MOUNT_SANDBOX_MODES.WORKSPACE_WRITE
          : LAUNCHER_SCOPE_MOUNT_SANDBOX_MODES.READ_ONLY,
        requiresAssignedWriteScope: posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE,
        writableProjectRoots: writableRootPolicy.writableProjectRoots
      }
    : null;
  const permissionFlags = family === LAUNCHER_WRITE_POSTURE_FAMILIES.PERMISSION_FLAG
    ? {
        emitWritePermissionFlag: posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE,
        flag: typeof permissionFlag === "string" && permissionFlag.length > 0 ? permissionFlag : null,
        args:
          posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE &&
          typeof permissionFlag === "string" &&
          permissionFlag.length > 0
            ? [permissionFlag]
            : []
      }
    : null;

  return {
    ok: true,
    role: canonicalRole,
    posture,
    family,
    mayWrite,
    findingsOnly: posture === LAUNCHER_WRITE_POSTURES.FINDINGS_ONLY,
    coordinationWrite: posture === LAUNCHER_WRITE_POSTURES.COORDINATION_WRITE_SCOPE,
    scopeMount,
    permissionFlags
  };
}

export default {
  FAMILY_MODEL_DISPOSITIONS,
  FAMILY_REFUSAL_TRANSPORTS,
  FAMILY_MODEL_GATE_REFUSAL_REASONS,
  LAUNCHER_WRITE_POSTURES,
  LAUNCHER_WRITE_POSTURE_FAMILIES,
  LAUNCHER_SCOPE_MOUNT_SANDBOX_MODES,
  LAUNCHER_ORCHESTRATOR_WRITABLE_PROJECT_ROOTS,
  LAUNCHER_COORDINATION_WRITE_ROOTS,
  resolveFamilyModelDisposition,
  resolveFamilyRoleModelGate,
  buildFamilyModelFlagArgs,
  buildFamilyModelRefusal,
  launcherRoleWritePosture,
  launcherRoleWritableRootPolicy,
  resolveLauncherRoleWritePosture
};
