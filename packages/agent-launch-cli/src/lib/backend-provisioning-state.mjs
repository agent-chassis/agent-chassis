

import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import {
  defaultRunGit,
  perWkBranchRef,
  sliceBranchRef
} from "./worktree-substrate.mjs";
import {
  EXACT_IMPLEMENTATION_SLICE_RE,
  MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
  REMOVED_MANAGED_PROVISIONING_ROOT_FIELDS
} from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import { readCanonicalWorkRecord } from "./backend-scope-authority.mjs";

export function resolveProvisioningInitiative({ readiness, mainRepo, subject }) {
  const readinessCandidates = [
    readiness?.initiative,
    readiness?.unit?.initiative,
    readiness?.record?.initiative,
    readiness?.work_record?.initiative
  ];
  for (const candidate of readinessCandidates) {
    if (typeof candidate === "string" && /^IN-\d{4}$/.test(candidate)) {
      return candidate;
    }
  }
  const record = readCanonicalWorkRecord(mainRepo, subject);
  return typeof record?.initiative === "string" && /^IN-\d{4}$/.test(record.initiative)
    ? record.initiative
    : null;
}

export function normalizeProvisioningConfig(config) {
  if (!config || config.enabled === false) return null;
  if (!isPlainObject(config)) return null;
  if (REMOVED_MANAGED_PROVISIONING_ROOT_FIELDS.some(
    (field) => Object.prototype.hasOwnProperty.call(config, field)
  )) return null;
  if (typeof config.mainRepo !== "string" || config.mainRepo.length === 0) return null;
  if (typeof config.worktreeRoot !== "string" || config.worktreeRoot.length === 0) return null;
  return config;
}

export const MANAGED_LIFECYCLE_REQUIRED = RUNTIME_BLOCKER_CODES.MANAGED_LIFECYCLE_REQUIRED;
export const MANAGED_PROVISIONING_UNAVAILABLE = RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE;
if (typeof MANAGED_LIFECYCLE_REQUIRED !== "string" || typeof MANAGED_PROVISIONING_UNAVAILABLE !== "string") {
  throw new Error("WK-1471 managed-lifecycle blocker interface is absent or incompatible");
}

export function managedRefusal(reason, detail = null) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason,
      detail
    }
  };
}

function resolveRefCommit(runGit, mainRepo, ref) {
  const result = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", `${ref}^{commit}`] });
  const sha = result?.ok === true ? String(result.stdout ?? "").trim() : "";
  return sha || null;
}

function dependencyDescriptor(mainRepo, record, dependency) {
  const localSlice = typeof dependency === "string" ? dependency.match(/^SLICE-(\d{3})$/) : null;
  const qualified = typeof dependency === "string"
    ? dependency.match(/^(WK-\d{4})(?:#(SLICE-\d{3}))?$/)
    : null;
  const dependencyWkId = localSlice ? record.id : qualified?.[1] ?? null;
  const dependencySliceId = localSlice ? `SLICE-${localSlice[1]}` : qualified?.[2] ?? null;
  if (dependencyWkId === null) return null;
  const dependencyRecord = dependencyWkId === record.id
    ? record
    : readCanonicalWorkRecord(mainRepo, dependencyWkId);
  if (!dependencyRecord || !/^IN-\d{4}$/.test(dependencyRecord.initiative ?? "")) return null;
  const dependencySlice = dependencySliceId === null
    ? null
    : dependencyRecord.slices?.find((candidate) => candidate?.id === dependencySliceId) ?? null;
  return { dependencyRecord, dependencySlice, dependencyWkId, dependencySliceId };
}

export function resolveExactSliceDependencies(mainRepo, subject, deps = {}) {
  const match = typeof subject === "string" ? subject.match(/^(WK-\d{4})#(SLICE-\d{3})$/) : null;
  if (!match) return { ok: false, reason: "exact_slice_required" };
  const record = readCanonicalWorkRecord(mainRepo, subject);
  const slice = Array.isArray(record?.slices) ? record.slices.find((candidate) => candidate?.id === match[2]) : null;
  if (!record || !/^IN-\d{4}$/.test(record.initiative ?? "") || !slice || slice.work_kind !== "implementation") {
    return { ok: false, reason: "exact_implementation_slice_unresolved" };
  }
  const dependencies = Array.isArray(slice.depends_on) ? slice.depends_on : [];
  if (dependencies.length === 0) return { ok: true, record, slice };
  const runGit = deps.runGit ?? defaultRunGit;
  const wkRef = perWkBranchRef(record.initiative, record.id);
  const wkTip = resolveRefCommit(runGit, mainRepo, wkRef);
  const unmet = [];
  for (const dependency of dependencies) {
    const descriptor = dependencyDescriptor(mainRepo, record, dependency);
    if (!descriptor) {
      unmet.push({ dependency, reason: "dependency_identity_unresolved" });
      continue;
    }
    const { dependencyRecord, dependencySlice, dependencyWkId, dependencySliceId } = descriptor;
    const accepted = dependencySliceId === null
      ? dependencyRecord.status === "done"
      : dependencySlice?.status === "done";
    if (!accepted) {
      unmet.push({ dependency, reason: "wk_context_review_not_accepted" });
      continue;
    }
    const dependencyRef = dependencySliceId === null
      ? perWkBranchRef(dependencyRecord.initiative, dependencyWkId)
      : sliceBranchRef(dependencyRecord.initiative, dependencyWkId, dependencySliceId);
    const dependencyTip = resolveRefCommit(runGit, mainRepo, dependencyRef);
    if (wkTip === null || dependencyTip === null) {
      unmet.push({ dependency, reason: "dependency_not_present_on_wk_branch", wk_ref: wkRef, dependency_ref: dependencyRef });
      continue;
    }
    const present = runGit({ repo: mainRepo, args: ["merge-base", "--is-ancestor", dependencyTip, wkTip] });
    if (present?.ok !== true) {
      unmet.push({ dependency, reason: "dependency_not_present_on_wk_branch", wk_ref: wkRef, dependency_ref: dependencyRef });
    }
  }
  return unmet.length === 0 ? { ok: true, record, slice } : {
    ok: false,
    reason: "unit_dependencies_unmet",
    unmet: unmet.map((entry) => entry.dependency),
    dependency_diagnostics: unmet
  };
}

export function provisioningRefusal(error) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason: MANAGED_PROVISIONING_UNAVAILABLE,
      detail: {
        source_code: error?.code ?? null,
        message: error?.message ?? String(error),
        detail: error?.detail ?? null
      }
    }
  };
}

function invalidProvisioningStateRefusal(reason, detail = null) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      reason,
      detail
    }
  };
}

function normalizeProvisioningRetryId(value) {
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

export async function resolveProvisioningAttemptState({ attemptStateAuthority, input, initiative }) {
  let resolved;
  try {
    resolved = await attemptStateAuthority.resolve({
      role: input.role,
      subject: input.subject,
      initiative,
      launchRef: input.monitor_handle,
      runId: input.run_id
    });
  } catch (error) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_threw",
        { message: error?.message ?? String(error) }
      )
    };
  }

  if (resolved === null || resolved === undefined) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "launcher_owned_attempt_state_required" }
      )
    };
  }
  if (!isPlainObject(resolved)) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "resolver_must_return_plain_object" }
      )
    };
  }
  const retryId = normalizeProvisioningRetryId(resolved.retryId ?? resolved.retry_id);
  if (retryId === null) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "retry_id_must_be_non_negative_integer" }
      )
    };
  }
  const disposition = resolved.disposition;
  const priorIdentity = resolved.priorIdentity ?? resolved.prior_identity ?? null;
  const livenessDeps = resolved.livenessDeps ?? resolved.liveness_deps ?? null;
  if (resolved.schema_version !== MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION ||
      resolved.unit_address !== `${initiative}/${input.subject.replace("#", "/")}` ||
      (disposition !== "initial" && disposition !== "reissue") ||
      (disposition === "initial" && (retryId !== 0 || priorIdentity !== null)) ||
      (disposition === "reissue" && (retryId === 0 || !isPlainObject(priorIdentity) ||
        typeof livenessDeps?.confirmPriorWorkerTerminated !== "function"))) {
    return {
      ok: false,
      refusal: invalidProvisioningStateRefusal(
        "worktree_provisioning_attempt_state_invalid",
        { reason: "launcher_owned_attempt_state_identity_mismatch" }
      )
    };
  }
  return {
    ok: true,
    state: {
      schemaVersion: resolved.schema_version,
      disposition,
      retryId,
      priorIdentity,
      livenessDeps
    }
  };
}

function isTerminalRunStatus(status) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export function createLauncherOwnedManagedAttemptStateAuthority() {
  const attempts = new Map();

  async function refreshPriorLiveness(prior) {
    if (prior.terminated === true) return true;
    if (typeof prior.probe !== "function") return false;
    try {
      const outcome = await prior.probe();
      if (isTerminalRunStatus(outcome?.status)) {
        prior.terminated = true;
      }
    } catch {
      return false;
    }
    return prior.terminated === true;
  }

  return Object.freeze({
    async resolve({ role, subject, initiative, launchRef, runId }) {
      if (role !== "worker" || !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "") ||
          typeof launchRef !== "string" || launchRef.length === 0 ||
          typeof runId !== "string" || runId.length === 0) {
        return null;
      }
      const unitAddress = `${initiative}/${subject.replace("#", "/")}`;
      const prior = attempts.get(unitAddress) ?? null;
      if (prior === null) {
        return Object.freeze({
          schema_version: MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
          disposition: "initial",
          unit_address: unitAddress,
          retryId: 0,
          priorIdentity: null,
          livenessDeps: null
        });
      }
      const terminated = await refreshPriorLiveness(prior);
      const priorIdentity = Object.freeze({
        launchRef: prior.launchRef,
        runId: prior.runId,
        retryId: prior.retryId
      });
      const livenessDeps = Object.freeze({
        confirmPriorWorkerTerminated(candidate) {
          const identity = candidate?.priorIdentity;
          return terminated === true && candidate?.unitAddress === unitAddress &&
            candidate?.launchRef === launchRef && candidate?.runId === runId &&
            candidate?.retryId === prior.retryId + 1 &&
            identity?.launchRef === prior.launchRef && identity?.runId === prior.runId &&
            identity?.retryId === prior.retryId;
        }
      });
      return Object.freeze({
        schema_version: MANAGED_WORKER_ATTEMPT_STATE_SCHEMA_VERSION,
        disposition: "reissue",
        unit_address: unitAddress,
        retryId: prior.retryId + 1,
        priorIdentity,
        livenessDeps
      });
    },
    recordProvisioned({ unitAddress, launchRef, runId, retryId }) {
      attempts.set(unitAddress, {
        unitAddress,
        launchRef,
        runId,
        retryId,
        provisioning: null,
        terminated: false,
        probe: null
      });
    },
    recordProvisioningBinding({ unitAddress, launchRef, runId, retryId, provisioning }) {
      const current = attempts.get(unitAddress);
      if (!current || current.launchRef !== launchRef || current.runId !== runId ||
          current.retryId !== retryId || !isPlainObject(provisioning)) {
        throw new Error("launcher-owned managed attempt identity changed before provisioning binding recording");
      }
      current.provisioning = provisioning;
    },
    resolveProvisioningBinding(status) {
      for (const current of attempts.values()) {
        if (current.runId === status?.run_id && current.launchRef === status?.monitor_handle &&
            current.provisioning && current.provisioning.record_id &&
            status?.subject === `${current.provisioning.record_id}#${current.provisioning.slice_id}`) {
          return current.provisioning;
        }
      }
      throw new Error("terminal worker run has no exact launcher-owned provisioning binding");
    },
    recordExecutorResult({ unitAddress, launchRef, runId, retryId, result, threw = false }) {
      const current = attempts.get(unitAddress);
      if (!current || current.launchRef !== launchRef || current.runId !== runId || current.retryId !== retryId) {
        throw new Error("launcher-owned managed attempt identity changed before executor result recording");
      }
      current.probe = typeof result?.probe === "function" ? result.probe : null;
      current.terminated = threw === true || result?.accepted === false || isTerminalRunStatus(result?.status);
    }
  });
}
