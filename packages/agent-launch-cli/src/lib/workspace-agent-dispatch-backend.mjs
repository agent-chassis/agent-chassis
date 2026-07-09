

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

import {
  defaultRunIdFactory,
  defaultMonitorHandleFactory
} from "./workspace-agent-dispatch-refusal.mjs";

import { createDispatchRunLifecycle } from "./workspace-agent-dispatch-run-lifecycle.mjs";
import {
  provisionWorktreeAtDispatch,
  WorktreeProvisioningDispatchError
} from "./worktree-provisioning-dispatch.mjs";

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
  return config;
}

function provisioningRefusal(error) {
  if (error instanceof WorktreeProvisioningDispatchError) {
    return {
      accepted: false,
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        reason: "worktree_provisioning_refused",
        detail: {
          code: error.code ?? null,
          message: error.message,
          detail: error.detail ?? null
        }
      }
    };
  }
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      reason: "worktree_provisioning_threw",
      detail: { message: error?.message ?? String(error) }
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

function maybeWrapExecutorWithWorktreeProvisioning(executor, provisioningConfig) {
  if (typeof executor !== "function" || provisioningConfig === null) return executor;
  return async function provisionedWorkspaceAgentExecutor(input = {}) {
    if (input.role !== "worker") {
      return executor(input);
    }

    let provisioning;
    try {
      const initiative = resolveProvisioningInitiative({
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
      provisioning = provisionWorktreeAtDispatch({
        mainRepo: provisioningConfig.mainRepo,
        initiative,
        subject: input.subject,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: attempt.state.retryId,
        worktreeRoot: provisioningConfig.worktreeRoot,
        priorIdentity: attempt.state.priorIdentity,
        livenessDeps: attempt.state.livenessDeps,
        expectedEnvelopeField: provisioningConfig.expectedEnvelopeField,
        deps: provisioningConfig.deps ?? {}
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

function maybeWrapRegistryEntryWithWorktreeProvisioning(entry, provisioningConfig) {
  if (!entry || typeof entry !== "object" || typeof entry.executor !== "function") {
    return entry;
  }
  return {
    ...entry,
    executor: maybeWrapExecutorWithWorktreeProvisioning(entry.executor, provisioningConfig)
  };
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

  const executors = {};
  const executorRegistryEntries = {};

  const familyAwareWiring = !!(launchExecutors && typeof launchExecutors === "object");
  if (familyAwareWiring) {
    for (const app of BACKEND_SUPPORTED_APPS) {
      const candidate = launchExecutors[app];
      if (typeof candidate === "function") {
        executors[app] = maybeWrapExecutorWithWorktreeProvisioning(candidate, worktreeProvisioningConfig);
        executorRegistryEntries[app] = executors[app];
      } else if (candidate && typeof candidate === "object" && typeof candidate.executor === "function") {
        const wrapped = maybeWrapRegistryEntryWithWorktreeProvisioning(candidate, worktreeProvisioningConfig);
        executors[app] = wrapped.executor;
        executorRegistryEntries[app] = wrapped;
      }
    }
  } else if (typeof launchExecutor === "function") {
    executors.codex = maybeWrapExecutorWithWorktreeProvisioning(launchExecutor, worktreeProvisioningConfig);
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

  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
    startLaunch: lifecycle.startLaunch,
    getRunStatus: lifecycle.getRunStatus,
    waitForRunStatus: lifecycle.waitForRunStatus,
    planLaunch: lifecycle.planLaunch,

    __snapshotRuns: lifecycle.snapshotRuns
  };
}
