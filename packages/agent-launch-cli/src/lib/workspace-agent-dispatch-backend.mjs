

import {
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  BACKEND_ACCEPTED_ROLES,
  validateLauncherFamilyRole,
  normalizeDispatchModelHint,
  BACKEND_SUPPORTED_APPS,
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_RUN_STATUSES,
  BACKEND_REFUSAL_CODES,
  BACKEND_MISSING_RESULT_CODES,
  BACKEND_FINAL_RESULT_KINDS,
  BACKEND_WRITEBACK_KINDS,
  normalizeFinalResult
} from "@agent-chassis/agent-launch-core";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export {
  WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_STATUS_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_RUN_WAIT_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
  WORKSPACE_AGENT_DISPATCH_FINAL_RESULT_SCHEMA_VERSION,
  BACKEND_ACCEPTED_ROLES,
  validateLauncherFamilyRole,
  normalizeDispatchModelHint,
  BACKEND_SUPPORTED_APPS,
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_RUN_STATUSES,
  BACKEND_REFUSAL_CODES,
  BACKEND_MISSING_RESULT_CODES,
  BACKEND_FINAL_RESULT_KINDS,
  BACKEND_WRITEBACK_KINDS,
  normalizeFinalResult
};

export {
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON
} from "./host-write-authority-substrate.mjs";

import { HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS } from "./host-write-authority-substrate.mjs";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  defaultRunIdFactory,
  defaultMonitorHandleFactory
} from "./workspace-agent-dispatch-refusal.mjs";

import { createDispatchRunLifecycle } from "./workspace-agent-dispatch-run-lifecycle.mjs";
import {
  assertCompleteManagedProvisioningResult,
  provisionManagedWorktreesAtDispatch
} from "./worktree-provisioning-dispatch.mjs";
import {
  defaultRunGit,
  perWkBranchRef,
  sliceBranchRef
} from "./worktree-substrate.mjs";

export const BACKEND_FORBIDDEN_ENVELOPE_TOKENS = HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS;

const WK_SUBJECT_RE = /^(WK-\d{4})(?:#[A-Za-z0-9._-]+)?$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readCanonicalWorkRecord(mainRepo, subject) {
  const match = typeof subject === "string" ? subject.match(WK_SUBJECT_RE) : null;
  if (!match) return null;
  const recordPath = path.join(mainRepo, "wiki", "work-records", `${match[1]}.json`);
  if (!existsSync(recordPath)) return null;
  return JSON.parse(readFileSync(recordPath, "utf8"));
}

function resolveProvisioningInitiative({ readiness, mainRepo, subject }) {
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

function normalizeProvisioningConfig(config) {
  if (!config || config.enabled === false) return null;
  if (!isPlainObject(config)) return null;
  if (typeof config.mainRepo !== "string" || config.mainRepo.length === 0) return null;
  if (typeof config.worktreeRoot !== "string" || config.worktreeRoot.length === 0) return null;
  if (typeof config.sharedDependencyRoot !== "string" || config.sharedDependencyRoot.length === 0) return null;
  if (typeof config.cacheRoot !== "string" || config.cacheRoot.length === 0) return null;
  return config;
}

const MANAGED_LIFECYCLE_REQUIRED = RUNTIME_BLOCKER_CODES.MANAGED_LIFECYCLE_REQUIRED;
const MANAGED_PROVISIONING_UNAVAILABLE = RUNTIME_BLOCKER_CODES.MANAGED_WORKTREE_PROVISIONING_UNAVAILABLE;
if (typeof MANAGED_LIFECYCLE_REQUIRED !== "string" || typeof MANAGED_PROVISIONING_UNAVAILABLE !== "string") {
  throw new Error("WK-1471 managed-lifecycle blocker interface is absent or incompatible");
}

function managedRefusal(reason, detail = null) {
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

function resolveExactSliceDependencies(mainRepo, subject, deps = {}) {
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

function provisioningRefusal(error) {
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
  if (value === null || value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

async function resolveProvisioningAttemptState({ provisioningConfig, input, initiative }) {
  const resolver = provisioningConfig.resolveAttemptState
    ?? provisioningConfig.resolveProvisioningAttemptState
    ?? provisioningConfig.getAttemptState
    ?? provisioningConfig.getProvisioningAttemptState
    ?? null;
  if (typeof resolver !== "function") {
    return { ok: true, state: { retryId: 0, priorIdentity: null, livenessDeps: null } };
  }

  let resolved;
  try {
    resolved = await resolver({
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
    return { ok: true, state: { retryId: 0, priorIdentity: null, livenessDeps: null } };
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
  return {
    ok: true,
    state: {
      retryId,
      priorIdentity: resolved.priorIdentity ?? resolved.prior_identity ?? null,
      livenessDeps: resolved.livenessDeps ?? resolved.liveness_deps ?? null
    }
  };
}

function firstStringField(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function deriveProvisionedWorktreeGitBinding(provisioning) {
  if (!isPlainObject(provisioning)) return null;
  const direct = provisioning.provisionedWorktreeGitBinding
    ?? provisioning.provisioned_worktree_git_binding
    ?? provisioning.provisionedWorktreeGitIdentity
    ?? provisioning.provisioned_worktree_git_identity
    ?? provisioning.git_binding
    ?? provisioning.git_identity
    ?? null;
  if (isPlainObject(direct)) {
    return Object.freeze({ ...direct });
  }

  const worktreePath = firstStringField(provisioning, ["worktree_path", "worktreePath"]);
  const gitDir = firstStringField(provisioning, [
    "git_dir",
    "gitDir",
    "worktree_git_dir",
    "worktreeGitDir"
  ]);
  const mainGitDir = firstStringField(provisioning, [
    "main_git_dir",
    "mainGitDir",
    "shared_git_dir",
    "sharedGitDir"
  ]);
  if (worktreePath === null || gitDir === null || mainGitDir === null) {
    return null;
  }

  const gitPointerFile = firstStringField(provisioning, [
    "git_pointer_file",
    "gitPointerFile",
    "worktree_git_pointer_file",
    "worktreeGitPointerFile"
  ]) ?? path.join(worktreePath, ".git");

  return Object.freeze({
    worktreePath,
    gitDir,
    mainGitDir,
    gitPointerFile
  });
}

function maybeWrapExecutorWithWorktreeProvisioning(executor, provisioningConfig, requireManagedProvisioning) {
  if (typeof executor !== "function") return executor;
  if (provisioningConfig === null && requireManagedProvisioning !== true) return executor;
  return async function provisionedWorkspaceAgentExecutor(input = {}) {
    if (input.role !== "worker") {
      return executor(input);
    }

    if (provisioningConfig === null) {
      return managedRefusal(MANAGED_PROVISIONING_UNAVAILABLE, { capability: "managed_worktree_provisioning" });
    }
    const dependencies = resolveExactSliceDependencies(
      provisioningConfig.mainRepo,
      input.subject,
      provisioningConfig.deps ?? {}
    );
    if (!dependencies.ok) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, dependencies);
    }
    if (provisioningConfig.confinementAvailable !== true) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "repository_read_boundary",
        dependency: "WK-1455",
        message: "managed worker spawn remains disabled until repository read confinement is available"
      });
    }

    let provisioning;
    let initiative;
    let provisioningRetryId;
    try {
      initiative = resolveProvisioningInitiative({
        readiness: input.readiness ?? null,
        mainRepo: provisioningConfig.mainRepo,
        subject: input.subject
      });
      if (initiative === null) {
        return {
          accepted: false,
          refusal: {
            code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
            reason: "worktree_provisioning_initiative_unresolved",
            detail: { subject: input.subject ?? null }
          }
        };
      }
      const attempt = await resolveProvisioningAttemptState({
        provisioningConfig,
        input,
        initiative
      });
      if (!attempt.ok) {
        return attempt.refusal;
      }
      provisioningRetryId = attempt.state.retryId;
      provisioning = provisionManagedWorktreesAtDispatch({
        mainRepo: provisioningConfig.mainRepo,
        initiative,
        subject: input.subject,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: provisioningRetryId,
        worktreeRoot: provisioningConfig.worktreeRoot,
        sharedDependencyRoot: provisioningConfig.sharedDependencyRoot,
        cacheRoot: provisioningConfig.cacheRoot,
        priorIdentity: attempt.state.priorIdentity,
        deps: {
          ...(provisioningConfig.deps ?? {}),
          ...(attempt.state.livenessDeps ?? {})
        }
      });
    } catch (error) {
      return provisioningRefusal(error);
    }

    try {
      assertCompleteManagedProvisioningResult({
        provisioning,
        mainRepo: provisioningConfig.mainRepo,
        initiative,
        subject: input.subject,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: provisioningRetryId,
        worktreeRoot: provisioningConfig.worktreeRoot,
        sharedDependencyRoot: provisioningConfig.sharedDependencyRoot,
        cacheRoot: provisioningConfig.cacheRoot
      });
    } catch (error) {
      return provisioningRefusal(error);
    }
    const provisionedWorktreeGitBinding = deriveProvisionedWorktreeGitBinding(provisioning);
    return executor({
      ...input,
      workspace_dir: provisioning.worktree_path,
      worktree_provisioning: provisioning,
      ...(provisionedWorktreeGitBinding
        ? {
            provisionedWorktreeGitBinding,
            provisioned_worktree_git_binding: provisionedWorktreeGitBinding
          }
        : {})
    });
  };
}

function maybeWrapRegistryEntryWithWorktreeProvisioning(entry, provisioningConfig, requireManagedProvisioning) {
  if (!entry || typeof entry !== "object" || typeof entry.executor !== "function") {
    return entry;
  }
  return {
    ...entry,
    executor: maybeWrapExecutorWithWorktreeProvisioning(entry.executor, provisioningConfig, requireManagedProvisioning)
  };
}

function managedLifecycleCapabilityFact(available, source) {
  return Object.freeze({
    available: available === true,
    source,
    freshness: Object.freeze({ state: "fresh", basis: "current_backend_instance" })
  });
}

export function createWorkspaceAgentDispatchBackend(options = {}) {
  const {
    launchExecutor = null,
    launchExecutors = null,
    clock = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

    monotonicNow = () => performance.now(),
    runIdFactory = defaultRunIdFactory,
    monitorHandleFactory = defaultMonitorHandleFactory,

    evaluateWorkerAdmission = null,
    prepareSourceToolSurface = null,

    proveAssignedSourceReadable = null
  } = options;
  const worktreeProvisioningConfig = normalizeProvisioningConfig(options.worktreeProvisioning);

  const requireManagedProvisioning = options.requireManagedProvisioning === true;

  const executors = {};
  const executorRegistryEntries = {};

  const familyAwareWiring = !!(launchExecutors && typeof launchExecutors === "object");
  if (familyAwareWiring) {
    for (const app of BACKEND_SUPPORTED_APPS) {
      const candidate = launchExecutors[app];
      if (typeof candidate === "function") {
        executors[app] = maybeWrapExecutorWithWorktreeProvisioning(candidate, worktreeProvisioningConfig, requireManagedProvisioning);
        executorRegistryEntries[app] = executors[app];
      } else if (candidate && typeof candidate === "object" && typeof candidate.executor === "function") {
        const wrapped = maybeWrapRegistryEntryWithWorktreeProvisioning(candidate, worktreeProvisioningConfig, requireManagedProvisioning);
        executors[app] = wrapped.executor;
        executorRegistryEntries[app] = wrapped;
      }
    }
  } else if (typeof launchExecutor === "function") {
    executors.codex = maybeWrapExecutorWithWorktreeProvisioning(launchExecutor, worktreeProvisioningConfig, requireManagedProvisioning);
    executorRegistryEntries.codex = executors.codex;
  }

  const runs = new Map();

  const lifecycle = createDispatchRunLifecycle({
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
    sleep,
    monotonicNow,
    runIdFactory,
    monitorHandleFactory,
    evaluateWorkerAdmission,
    prepareSourceToolSurface,
    proveAssignedSourceReadable
  });

  const getManagedLifecycleCapabilityAuthorityFacts = async () => Object.freeze({
    native_edit: managedLifecycleCapabilityFact(
      Object.keys(executors).length > 0,
      "agent_launch.dispatch_backend.executor_registry"
    ),
    repository_read_boundary: managedLifecycleCapabilityFact(
      worktreeProvisioningConfig?.confinementAvailable === true,
      "agent_launch.dispatch_backend.repository_read_boundary"
    ),
    commit: managedLifecycleCapabilityFact(
      false,
      "agent_launch.dispatch_backend.commit_authority_unwired"
    ),
    managed_worktree_provisioning: managedLifecycleCapabilityFact(
      worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.worktree_provisioning"
    ),
    slice_to_wk_integration: managedLifecycleCapabilityFact(
      false,
      "agent_launch.dispatch_backend.slice_integration_unwired"
    ),
    wk_context_review: managedLifecycleCapabilityFact(
      false,
      "agent_launch.dispatch_backend.wk_context_review_unwired"
    ),
    automatic_main_promotion: managedLifecycleCapabilityFact(
      false,
      "agent_launch.dispatch_backend.main_promotion_unwired"
    )
  });

  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
    startLaunch: lifecycle.startLaunch,
    getRunStatus: lifecycle.getRunStatus,
    waitForRunStatus: lifecycle.waitForRunStatus,
    planLaunch: lifecycle.planLaunch,
    getManagedLifecycleCapabilityAuthorityFacts,

    __snapshotRuns: lifecycle.snapshotRuns
  };
}
