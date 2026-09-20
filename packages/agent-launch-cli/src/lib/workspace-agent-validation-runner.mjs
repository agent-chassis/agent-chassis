

import path from "node:path";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, accessSync, constants } from "node:fs";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  buildBubblewrapLaunchPlan as defaultBuildBubblewrapLaunchPlan,
  spawnIsolated as defaultSpawnIsolated
} from "./launch-isolation.mjs";
import { buildValidationConfinementPlan as defaultBuildValidationConfinementPlan } from "./workspace-agent-family-bwrap-plan.mjs";

import {
  assertSelectedDependencyMountIntegrity,
  selectOptionalReviewerDependencyProjection
} from "./terminal-wk-candidate-validation.mjs";
import {
  assertTrustedManagedWorkerTestRunAuthority
} from "./managed-worker-test-run-authority.mjs";
import { executeTestProofAttempt } from "./workspace-agent-test-proof-evidence.mjs";
import { buildBehavioralPreservationEvidencePair } from
  "./workspace-agent-behavioral-preservation-evidence.mjs";
import { extractPairedBehavioralPreservationEvidenceReceipt } from
  "./workspace-agent-dispatch-run-receipt.mjs";
import { assertLauncherTestProofProviderExecution } from
  "./workspace-agent-test-proof-provider-registry.mjs";
import { observeLauncherNodeTestRun } from "./workspace-agent-test-proof-node-observation.mjs";
import {
  DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
  DEFAULT_VALIDATION_TIMEOUT_MS,
  TEST_PROOF_LIVE_CLEANUP_ALLOWANCE_MS,
  assertTestProofExecutionBudget,
  resolveValidationOutputBounds,
  spawnAndCapture
} from "./test-execution/confined-capture.mjs";

export {
  DEFAULT_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES,
  DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
  DEFAULT_VALIDATION_OUTPUT_CAP_BYTES,
  DEFAULT_VALIDATION_TIMEOUT_MS,
  TEST_PROOF_LIVE_CLEANUP_ALLOWANCE_MS,
  assertTestProofExecutionBudget,
  mintTestProofExecutionBudget,
  resolveValidationOutputBounds
} from "./test-execution/confined-capture.mjs";
import { assertLauncherTestProofRuntimeAuthority } from
  "./workspace-agent-test-proof-runtime-identity.mjs";
import { runConfinedInvocation } from "./test-execution/confined-invocation.mjs";

const AGENT_CHILD_STRUCTURED_VALIDATION_OPERATIONS = Object.freeze({
  node_check: Object.freeze({
    operation: "node_check",
    node_flag: "--check",
    executes_target: false,
    execution_context: "parse_only_zero_ace"
  }),
  node_test: Object.freeze({
    operation: "node_test",
    node_flag: "--test",
    executes_target: true,
    execution_context: "confined_target_execution"
  })
});

export const WORKSPACE_AGENT_VALIDATION_RUN_RESULT_SCHEMA_VERSION =
  "workspace-agent-validation-run-result.v1";
export const WORKSPACE_AGENT_VALIDATION_RUN_REFUSAL_SCHEMA_VERSION =
  "workspace-agent-validation-run-refusal.v1";

export async function runWorkspaceAgentTestProofAttempt(input) {
  return executeTestProofAttempt(input);
}

export function runWorkspaceAgentBehavioralPreservationPair(...sides) {
  return extractPairedBehavioralPreservationEvidenceReceipt(
    buildBehavioralPreservationEvidencePair(...sides)
  );
}

export const WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES = Object.freeze({
  INVALID_INPUT: "workspace_agent_validation_runner.invalid_input.v1",
  UNSUPPORTED_OPERATION: "workspace_agent_validation_runner.unsupported_operation.v1",
  RAW_EXEC_FORBIDDEN: "workspace_agent_validation_runner.raw_exec_forbidden.v1",
  WORKSPACE_INVALID: "workspace_agent_validation_runner.workspace_invalid.v1",
  TARGET_FILE_ABSENT: "workspace_agent_validation_runner.target_file_absent.v1",
  TARGET_NOT_REGULAR: "workspace_agent_validation_runner.target_not_regular.v1",
  TARGET_FILESYSTEM_FAILURE: "workspace_agent_validation_runner.target_filesystem_failure.v1",
  TARGET_INVALID: "workspace_agent_validation_runner.target_invalid.v1",
  TARGET_PATH_ESCAPE: "workspace_agent_validation_runner.target_path_escape.v1",
  TARGET_NOT_AUTHORIZED: "workspace_agent_validation_runner.target_not_authorized.v1"
});

export const WORKSPACE_AGENT_VALIDATION_DISPOSITIONS = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  NOT_RUN: "not_run"
});

const FORBIDDEN_RAW_EXEC_INPUT_KEYS = Object.freeze([
  "command",
  "argv",
  "args",
  "shell",
  "exec",
  "exec_command",
  "env_policy",
  "envPolicy",
  "raw_exec",
  "raw_exec_enabled",
  "raw_argv",
  "extra_args"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function buildRefusal(code, message, detail = null) {
  const refusal = {
    schema_version: WORKSPACE_AGENT_VALIDATION_RUN_REFUSAL_SCHEMA_VERSION,
    accepted: false,
    refusal_code: code,
    refusal_message: message
  };
  if (detail !== null) {
    refusal.detail = detail;
  }
  return Object.freeze(refusal);
}

export function isWorkspaceAgentValidationRunRefusal(value) {
  return (
    isPlainObject(value) &&
    value.schema_version === WORKSPACE_AGENT_VALIDATION_RUN_REFUSAL_SCHEMA_VERSION &&
    value.accepted === false &&
    typeof value.refusal_code === "string"
  );
}

const NODE_VALIDATION_TARGET_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs"]);

function normalizeRelativeTargetString(target, allowedExtensions = NODE_VALIDATION_TARGET_EXTENSIONS) {
  if (!isNonEmptyString(target)) {
    return { ok: false, message: "target must be a non-empty string" };
  }
  const trimmed = target.trim();
  if (path.isAbsolute(trimmed)) {
    return { ok: false, message: `target must be repo-relative, not absolute: ${trimmed}`, escape: true };
  }

  const posix = trimmed.split(path.sep).join("/");
  const segments = posix.split("/").filter((seg) => seg !== "" && seg !== ".");
  if (segments.some((seg) => seg === "..")) {
    return { ok: false, message: `target must not contain a traversal segment: ${trimmed}`, escape: true };
  }
  if (segments.length === 0) {
    return { ok: false, message: `target resolves to an empty path: ${trimmed}` };
  }
  const normalized = segments.join("/");
  const ext = path.extname(normalized).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return { ok: false, message: `target must be a ${allowedExtensions.join("/")} file: ${normalized}` };
  }
  return { ok: true, posixRelative: normalized };
}

export function authorizeValidationTarget({ workspaceDir, target, authorizedTargets,
  allowedExtensions = NODE_VALIDATION_TARGET_EXTENSIONS } = {}) {
  if (!isNonEmptyString(workspaceDir)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.WORKSPACE_INVALID,
      "workspaceDir must be a non-empty string"
    );
  }
  let repoReal;
  try {
    repoReal = realpathSync(workspaceDir);
  } catch (err) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.WORKSPACE_INVALID,
      `workspaceDir does not resolve to a real path: ${workspaceDir}`,
      { errno: err?.code ?? null }
    );
  }

  const normalized = normalizeRelativeTargetString(target, allowedExtensions);
  if (!normalized.ok) {
    return buildRefusal(
      normalized.escape
        ? WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_PATH_ESCAPE
        : WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_INVALID,
      normalized.message
    );
  }

  if (!Array.isArray(authorizedTargets) || authorizedTargets.length === 0) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_NOT_AUTHORIZED,
      "no declared-validation targets are authorized for this unit",
      { requested_target: normalized.posixRelative }
    );
  }
  const authorizedSet = new Set();
  for (const entry of authorizedTargets) {
    const entryNormalized = normalizeRelativeTargetString(entry, allowedExtensions);
    if (entryNormalized.ok) {
      authorizedSet.add(entryNormalized.posixRelative);
    }
  }
  if (!authorizedSet.has(normalized.posixRelative)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_NOT_AUTHORIZED,
      `target is not among the unit's declared validation targets: ${normalized.posixRelative}`,
      { requested_target: normalized.posixRelative, authorized_targets: [...authorizedSet].sort() }
    );
  }

  let absolute;
  try {
    absolute = realpathSync(path.resolve(repoReal, normalized.posixRelative));
    const relativeBack = path.relative(repoReal, absolute);
    if (relativeBack === ".." || relativeBack.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeBack)) {
      return buildRefusal(
        WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_PATH_ESCAPE,
        "declared validation target resolves outside the candidate",
        { requested_target: normalized.posixRelative }
      );
    }
    if (!statSync(absolute).isFile()) return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_NOT_REGULAR,
      "declared validation target is not a regular file",
      { requested_target: normalized.posixRelative }
    );
    accessSync(absolute, constants.R_OK);
  } catch (error) {
    return buildRefusal(
      error.code === "ENOENT"
        ? WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_FILE_ABSENT
        : WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_FILESYSTEM_FAILURE,
      "declared validation target filesystem check failed",
      { requested_target: normalized.posixRelative, errno: error.code ?? null }
    );
  }

  return { ok: true, repoReal, posixRelative: normalized.posixRelative, absolute };
}

export async function runWorkspaceAgentValidation(input = {}) {
  if (!isPlainObject(input)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.INVALID_INPUT,
      "runWorkspaceAgentValidation requires an object input"
    );
  }

  for (const key of FORBIDDEN_RAW_EXEC_INPUT_KEYS) {
    if (Object.hasOwn(input, key)) {
      return buildRefusal(
        WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
        `structured validation forbids caller-supplied execution authority: ${key}`,
        { forbidden_key: key }
      );
    }
  }
  let executionBudget = null;
  if (Object.hasOwn(input, "executionBudget")) {
    try {
      executionBudget = assertTestProofExecutionBudget(input.executionBudget);
    } catch (error) {
      return buildRefusal(
        WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
        "test-proof execution budget must be launcher-minted",
        { error_code: error?.code ?? null }
      );
    }
  }
  let testProofProviderExecution = null;
  if (Object.hasOwn(input, "testProofProviderExecution")) {
    try {
      testProofProviderExecution = assertLauncherTestProofProviderExecution(
        input.testProofProviderExecution
      );
    } catch (error) {
      return buildRefusal(
        WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
        "test-proof provider execution authority must be launcher-minted",
        { error_code: error?.code ?? null }
      );
    }
  }

  const operation = isNonEmptyString(input.operation) ? input.operation.trim() : null;
  const operationSpec = operation ? AGENT_CHILD_STRUCTURED_VALIDATION_OPERATIONS[operation] : null;
  if (!operationSpec || !Object.hasOwn(AGENT_CHILD_STRUCTURED_VALIDATION_OPERATIONS, operation)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.UNSUPPORTED_OPERATION,
      "operation must be one of node_check, node_test",
      { operation: operation ?? null }
    );
  }

  const authorized = authorizeValidationTarget({
    workspaceDir: input.workspaceDir,
    target: input.target,
    authorizedTargets: input.authorizedTargets
  });
  if (isWorkspaceAgentValidationRunRefusal(authorized)) {
    return authorized;
  }

  const buildPlan =
    typeof input.buildValidationConfinementPlan === "function"
      ? input.buildValidationConfinementPlan
      : defaultBuildValidationConfinementPlan;
  const buildBwrap =
    typeof input.buildBubblewrapLaunchPlan === "function"
      ? input.buildBubblewrapLaunchPlan
      : defaultBuildBubblewrapLaunchPlan;
  const spawnIsolated =
    typeof input.spawnIsolated === "function" ? input.spawnIsolated : defaultSpawnIsolated;
  const clock = typeof input.clock === "function" ? input.clock : () => Date.now();
  const requestedTimeoutMs =
    Number.isInteger(input.timeoutMs) && input.timeoutMs > 0
      ? input.timeoutMs
      : DEFAULT_VALIDATION_TIMEOUT_MS;
  const timeoutMs = executionBudget === null ? requestedTimeoutMs
    : Math.max(1, Math.min(requestedTimeoutMs, executionBudget.remainingMs()));
  const outputBounds = resolveValidationOutputBounds({
    outputCapBytes: input.outputCapBytes ?? null,
    outputHeadCapBytes: input.outputHeadCapBytes ?? null,
    outputTailCapBytes: input.outputTailCapBytes ?? null
  });

  const flag = operationSpec.node_flag;
  const nodeBinary = process.execPath;

  const envSource = isPlainObject(input.env) ? input.env : process.env;
  const planEnv = {};
  if (typeof envSource.PATH === "string") planEnv.PATH = envSource.PATH;
  if (typeof envSource.HOME === "string") planEnv.HOME = envSource.HOME;

  const providerNodeArguments = testProofProviderExecution?.node_arguments ?? [];
  const normalizedArgv = ["node", flag,
    ...(testProofProviderExecution ? ["[launcher-test-proof-options]"] : []),
    authorized.posixRelative];
  const enforcementPosture = Object.freeze({
    confined: true,
    execution_context: operationSpec.execution_context,
    executes_target: operationSpec.executes_target,
    repo_mount: "read_only",
    secrets_masked: true,
    network: "denied",
    env: "launcher_minted_clean",
    spawn_site: "worker_confined_runner"
  });

  const baseEvidence = {
    schema_version: WORKSPACE_AGENT_VALIDATION_RUN_RESULT_SCHEMA_VERSION,
    operation,
    command: "node",
    normalized_argv: Object.freeze(normalizedArgv),
    target: authorized.posixRelative,
    raw_exec_enabled: false,
    enforcement_posture: enforcementPosture
  };

  const startedAtMs = clock();
  const pendingInterruption = executionBudget?.interruption() ?? null;
  if (pendingInterruption !== null) {
    return interruptedBeforeSpawn(baseEvidence, pendingInterruption, startedAtMs, clock());
  }
  let plan;
  try {
    plan = buildPlan({
      workspaceDir: authorized.repoReal,
      command: nodeBinary,
      args: [flag, ...providerNodeArguments, authorized.absolute],
      env: planEnv,

      dependencyReadOnlyBinds: Array.isArray(input.dependencyReadOnlyBinds)
        ? input.dependencyReadOnlyBinds
        : [],

      useSystemTmp: testProofProviderExecution !== null,

      ...(input.maskAgentLaunchDirWhenPresent === true
        ? { agentLaunchDirExists: existsSync }
        : {}),
      buildBubblewrapLaunchPlan: buildBwrap
    });
  } catch (err) {

    const endedAtMs = clock();
    return Object.freeze({
      ...baseEvidence,
      ran: false,
      skipped: false,
      disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN,
      ok: false,
      blocker_code: err instanceof BubblewrapIsolationError ? err.code : "validation_plan_build_failed",
      blocker_message: err?.message ?? String(err),
      started_at_ms: startedAtMs,
      ended_at_ms: endedAtMs,
      duration_ms: endedAtMs - startedAtMs
    });
  }

  let capture;
  try {
    capture = await spawnAndCapture(plan, {
      spawnIsolated,
      parentEnv: envSource,
      timeoutMs,
      outputBounds,
      reporterProtocol: testProofProviderExecution !== null,
      clock,
      ...(executionBudget === null ? {} : {
        signal: executionBudget.signal,
        cleanupAllowanceMs: TEST_PROOF_LIVE_CLEANUP_ALLOWANCE_MS
      })
    });
  } catch (err) {

    const endedAtMs = clock();
    return Object.freeze({
      ...baseEvidence,
      ran: false,
      skipped: false,
      disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN,
      ok: false,
      blocker_code:
        err instanceof BubblewrapIsolationError
          ? err.code
          : BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED,
      blocker_message: err?.message ?? String(err),
      started_at_ms: startedAtMs,
      ended_at_ms: endedAtMs,
      duration_ms: endedAtMs - startedAtMs
    });
  }

  return settleConfinedCapture({
    baseEvidence,
    capture,
    startedAtMs,
    outputBounds,
    executionBudget,
    proofObservation: testProofProviderExecution === null ? null
      : ({ protocolText, exitCode, reporterProtocolOverflow }) => observeLauncherNodeTestRun({
        stdout: protocolText, exitCode,
        expectation: testProofProviderExecution.observation_expectation,
        reporterProtocolOverflow })
  });
}

function interruptedBeforeSpawn(baseEvidence, interruption, startedAtMs, endedAtMs) {
  return Object.freeze({
    ...baseEvidence,
    ran: false,
    skipped: false,
    disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN,
    ok: false,
    exit_code: null,
    signal: null,
    timed_out: interruption === "timed_out",
    cancelled: interruption === "cancelled",
    cleanup_failed: false,
    blocker_code: interruption === "timed_out"
      ? "test_proof_execution_timed_out" : "test_proof_execution_cancelled",
    started_at_ms: startedAtMs,
    ended_at_ms: endedAtMs,
    duration_ms: endedAtMs - startedAtMs
  });
}

function settleConfinedCapture({ baseEvidence, capture, startedAtMs, outputBounds,
  executionBudget = null, proofObservation = null }) {
  const exitCode = typeof capture.code === "number" ? capture.code : null;

  const ran = capture.spawnError === null;
  const budgetInterruption = capture.cancelled || (capture.timedOut && executionBudget !== null)
    ? executionBudget?.interruption() ?? null : null;
  const cancelled = capture.cancelled && budgetInterruption === "cancelled";
  const timedOut = capture.timedOut || (capture.cancelled && budgetInterruption !== "cancelled");
  const interrupted = timedOut || cancelled;
  const reporterProtocolOverflow = capture.reporter?.protocol_overflow === true;
  const testProofObservation = proofObservation !== null && ran &&
      (reporterProtocolOverflow || !interrupted)
    ? proofObservation({ protocolText: capture.reporter.text, exitCode, reporterProtocolOverflow })
    : null;
  const observationValid = proofObservation === null || testProofObservation?.valid === true;
  const ok = ran && !interrupted && exitCode === 0 && observationValid;
  let disposition;
  if (!ran) {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN;
  } else if (!observationValid) {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN;
  } else if (ok) {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.PASSED;
  } else {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.FAILED;
  }
  const budgetBlocker = executionBudget === null ? null
    : capture.cleanupFailed ? "test_proof_execution_cleanup_failed"
      : cancelled ? "test_proof_execution_cancelled"
        : timedOut ? "test_proof_execution_timed_out" : null;
  const blockerCode = budgetBlocker ?? (observationValid ? null
    : testProofObservation?.code ?? "test_proof_structured_observation_invalid");

  return Object.freeze({
    ...baseEvidence,
    ran,
    skipped: false,
    disposition,
    ok,
    exit_code: exitCode,
    signal: capture.signal ?? null,
    timed_out: timedOut,
    ...(executionBudget === null ? {} : {
      cancelled,
      cleanup_failed: capture.cleanupFailed === true
    }),
    spawn_error: capture.spawnError,
    ...(proofObservation !== null ? {
      test_proof_observation: testProofObservation,
      ...(blockerCode === null ? {} : { blocker_code: blockerCode })
    } : {}),
    output_truncated: capture.stdout.truncated || capture.stderr.truncated ||
      capture.reporter?.truncated === true,
    output_elided_bytes: capture.stdout.elided_bytes + capture.stderr.elided_bytes +
      (capture.reporter?.elided_bytes ?? 0),
    output_bounds: Object.freeze({
      head_cap_bytes: outputBounds.headCapBytes,
      tail_cap_bytes: outputBounds.tailCapBytes,
      retains: "head_and_tail"
    }),

    stdout: proofObservation !== null ? "" : capture.stdout.text,
    stderr: capture.stderr.text,
    started_at_ms: startedAtMs,
    ended_at_ms: capture.endedAtMs,
    duration_ms: capture.endedAtMs - startedAtMs
  });
}

export const MANAGED_WORKER_DECLARED_TEST_RESULT_SCHEMA_VERSION =
  "managed-worker-declared-test-result.v1";

export const MANAGED_WORKER_DECLARED_TEST_DEPENDENCY_DIR_NAME =
  ".worker-declared-test-dependency";

export const MANAGED_WORKER_DECLARED_TEST_DEPENDENCY_REASONS = Object.freeze({
  PROJECTION_ROOT_UNAVAILABLE:
    "managed_worker_declared_test.dependency_projection_root_unavailable.v1",
  SELECTION_FAILED: "managed_worker_declared_test.dependency_selection_failed.v1",
  MOUNTPOINT_UNAVAILABLE:
    "managed_worker_declared_test.dependency_mountpoint_unavailable.v1",

  MOUNT_IDENTITY_CHANGED:
    "managed_worker_declared_test.dependency_mount_identity_changed.v1"
});

export function deriveManagedWorkerDependencyProjectionRoot(authority) {
  const worktreeRoot = path.dirname(authority.worktree_path);
  return path.join(
    worktreeRoot,
    MANAGED_WORKER_DECLARED_TEST_DEPENDENCY_DIR_NAME,
    path.basename(authority.worktree_path)
  );
}

function isWithinPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function selectDeclaredTestDependencyMount(authority) {
  const projectionRoot = deriveManagedWorkerDependencyProjectionRoot(authority);
  if (!path.isAbsolute(projectionRoot) ||
      isWithinPath(authority.main_repo, projectionRoot) ||
      isWithinPath(authority.worktree_path, projectionRoot)) {
    return Object.freeze({
      selected: false,
      reason_code: MANAGED_WORKER_DECLARED_TEST_DEPENDENCY_REASONS.PROJECTION_ROOT_UNAVAILABLE,
      detail: { projection_root: projectionRoot },
      projection: null
    });
  }
  try {
    const selection = selectOptionalReviewerDependencyProjection({
      mainRepo: authority.main_repo,
      checkoutPath: authority.worktree_path,
      projectionRoot
    });
    return Object.freeze({
      selected: selection.selected === true,
      reason_code: selection.reason_code,
      detail: null,
      projection: selection.projection
    });
  } catch (error) {

    return Object.freeze({
      selected: false,
      reason_code: MANAGED_WORKER_DECLARED_TEST_DEPENDENCY_REASONS.SELECTION_FAILED,
      detail: {
        error_code: typeof error?.code === "string" ? error.code : null,
        error_message: error?.message ?? String(error)
      },
      projection: null
    });
  }
}

function dependencyMountProof(selection) {
  const projection = selection.projection;
  return Object.freeze({
    projection_selected: selection.selected === true,
    projection_root: projection?.projection_root ?? null,
    projection_identity: projection?.projection_identity ?? null,
    dependency_installation_digest: projection?.installation_digest ?? null,
    reviewer_read_only_bind: projection?.read_only_bind ?? null,
    reviewer_read_only_binds: projection?.read_only_binds ?? Object.freeze([])
  });
}

export async function runManagedWorkerDeclaredTest(input = {}) {
  if (!isPlainObject(input)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.INVALID_INPUT,
      "runManagedWorkerDeclaredTest requires an object input"
    );
  }

  const forbiddenKeys = [
    ...FORBIDDEN_RAW_EXEC_INPUT_KEYS,
    "dependencyReadOnlyBinds",
    "dependency_read_only_binds",
    "maskAgentLaunchDirWhenPresent",
    "workspaceDir",
    "workspace_dir"
  ];
  for (const key of forbiddenKeys) {
    if (Object.hasOwn(input, key)) {
      return buildRefusal(
        WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
        `the declared-test capability forbids caller-supplied execution authority: ${key}`,
        { forbidden_key: key }
      );
    }
  }

  let authority;
  try {
    authority = assertTrustedManagedWorkerTestRunAuthority(input.authority);
  } catch (error) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.WORKSPACE_INVALID,
      error?.message ?? String(error),
      { error_code: typeof error?.code === "string" ? error.code : null }
    );
  }

  const authorized = authorizeValidationTarget({
    workspaceDir: authority.worktree_path,
    target: input.target,
    authorizedTargets: input.authorizedTargets
  });
  if (isWorkspaceAgentValidationRunRefusal(authorized)) {
    return authorized;
  }

  const selection = selectDeclaredTestDependencyMount(authority);
  let mountProof = dependencyMountProof(selection);
  let dependencyBinds = mountProof.projection_selected
    ? [...mountProof.reviewer_read_only_binds]
    : [];
  let dependencyReason = selection.reason_code;
  let dependencyDetail = selection.detail;

  const mountpoint = path.join(authority.worktree_path, "node_modules");
  let createdMountpoint = false;
  if (mountProof.projection_selected && !existsSync(mountpoint)) {
    try {
      mkdirSync(mountpoint, { mode: 0o700 });
      createdMountpoint = true;
    } catch (error) {

      dependencyBinds = [];
      dependencyReason = MANAGED_WORKER_DECLARED_TEST_DEPENDENCY_REASONS.MOUNTPOINT_UNAVAILABLE;
      dependencyDetail = {
        mountpoint,
        error_code: typeof error?.code === "string" ? error.code : null
      };
      mountProof = dependencyMountProof({ selected: false, projection: null });
    }
  }

  if (mountProof.projection_selected) {

    try {
      assertSelectedDependencyMountIntegrity(mountProof);
    } catch (error) {
      dependencyBinds = [];
      dependencyReason = MANAGED_WORKER_DECLARED_TEST_DEPENDENCY_REASONS.SELECTION_FAILED;
      dependencyDetail = {
        error_code: typeof error?.code === "string" ? error.code : null,
        error_message: error?.message ?? String(error)
      };
      mountProof = dependencyMountProof({ selected: false, projection: null });
    }
  }

  const stepInput = {
    workspaceDir: authority.worktree_path,
    target: authorized.posixRelative,
    authorizedTargets: input.authorizedTargets,
    env: input.env ?? undefined,
    timeoutMs: input.timeoutMs,
    outputCapBytes: input.outputCapBytes,
    outputHeadCapBytes: input.outputHeadCapBytes,
    outputTailCapBytes: input.outputTailCapBytes,
    dependencyReadOnlyBinds: dependencyBinds,
    maskAgentLaunchDirWhenPresent: true,
    buildValidationConfinementPlan: input.buildValidationConfinementPlan,
    buildBubblewrapLaunchPlan: input.buildBubblewrapLaunchPlan,
    spawnIsolated: input.spawnIsolated,
    clock: input.clock
  };

  let mountIdentityChanged = null;
  const assertMountStillValid = () => {
    if (!mountProof.projection_selected) return true;
    try {
      assertSelectedDependencyMountIntegrity(mountProof);
      return true;
    } catch (error) {
      mountIdentityChanged = {
        error_code: typeof error?.code === "string" ? error.code : null,
        error_message: error?.message ?? String(error)
      };
      return false;
    }
  };

  const mountChangedStep = (operation, flag) => Object.freeze({
    schema_version: WORKSPACE_AGENT_VALIDATION_RUN_RESULT_SCHEMA_VERSION,
    operation,
    command: "node",
    normalized_argv: Object.freeze(["node", flag, authorized.posixRelative]),
    target: authorized.posixRelative,
    raw_exec_enabled: false,
    ran: false,
    skipped: false,
    disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN,
    ok: false,
    blocker_code: MANAGED_WORKER_DECLARED_TEST_DEPENDENCY_REASONS.MOUNT_IDENTITY_CHANGED,
    blocker_message: mountIdentityChanged?.error_message ?? "dependency mount identity changed"
  });

  let check;
  let testStep;
  try {
    check = assertMountStillValid()
      ? await runWorkspaceAgentValidation({ ...stepInput, operation: "node_check" })
      : mountChangedStep("node_check", "--check");
    if (check.ok !== true) {
      testStep = Object.freeze({
        schema_version: WORKSPACE_AGENT_VALIDATION_RUN_RESULT_SCHEMA_VERSION,
        operation: "node_test",
        command: "node",
        normalized_argv: Object.freeze(["node", "--test", authorized.posixRelative]),
        target: authorized.posixRelative,
        raw_exec_enabled: false,
        ran: false,
        skipped: true,
        skipped_reason: "node --check did not pass; node --test not run",
        disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN,
        ok: false
      });
    } else {
      testStep = assertMountStillValid()
        ? await runWorkspaceAgentValidation({ ...stepInput, operation: "node_test",
          ...(input.testProofProviderExecution
            ? { testProofProviderExecution: input.testProofProviderExecution }
            : {}) })
        : mountChangedStep("node_test", "--test");
    }
  } finally {
    if (createdMountpoint) {
      rmSync(mountpoint, { recursive: true, force: true });
    }
  }

  const ranStep = testStep.ran === true ? testStep : check;
  return Object.freeze({
    schema_version: MANAGED_WORKER_DECLARED_TEST_RESULT_SCHEMA_VERSION,
    unit: authority.unit_address,
    target: authorized.posixRelative,

    dependency: Object.freeze({
      mount_selected: mountProof.projection_selected,
      unavailable_reason: mountProof.projection_selected ? null : (dependencyReason ?? null),
      detail: mountProof.projection_selected ? null : (dependencyDetail ?? null),
      projection_identity: mountProof.projection_identity,
      installation_digest: mountProof.dependency_installation_digest,

      mount_identity_changed: mountIdentityChanged,
      advisory: true
    }),
    steps: Object.freeze([check, testStep]),
    disposition: ranStep.disposition,
    ok: check.ok === true && testStep.ok === true,
    exit_code: ranStep.exit_code ?? null,
    timed_out: check.timed_out === true || testStep.timed_out === true,
    output_truncated: check.output_truncated === true || testStep.output_truncated === true,
    stdout: ranStep.stdout ?? "",
    stderr: ranStep.stderr ?? "",
    ...(testStep.test_proof_observation
      ? { test_proof_observation: testStep.test_proof_observation }
      : {}),

    advisory: true,
    admission_effect: "none",
    review_effect: "none",
    closure_effect: "none"
  });
}

export async function runLauncherTestProofDeclaredTest(input = {}) {
  const allowedKeys = new Set([
    "authority", "target", "authorizedTargets", "testProofProviderExecution", "executionBudget"
  ]);
  if (!isPlainObject(input) || Object.keys(input).some((key) => !allowedKeys.has(key))) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "launcher test-proof execution refuses caller-selected runtime authority"
    );
  }
  let authority;
  try {
    authority = assertLauncherTestProofRuntimeAuthority(input.authority);
  } catch (error) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.WORKSPACE_INVALID,
      error?.message ?? String(error),
      { error_code: error?.code ?? null }
    );
  }
  if (!["managed_worker", "managed_reviewer", "terminal_candidate",
    "integrated_slice", "orchestrator_git_commit",
    "orchestrator_worktree_snapshot"].includes(authority.kind)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.WORKSPACE_INVALID,
      "launcher test-proof runtime authority kind is unsupported"
    );
  }
  let executionBudget = null;
  let nativeExecution = null;
  try {
    if (Object.hasOwn(input, "executionBudget")) {
      executionBudget = assertTestProofExecutionBudget(input.executionBudget);
    }
    if (Object.hasOwn(input, "testProofProviderExecution")) {
      nativeExecution = assertLauncherTestProofProviderExecution(
        input.testProofProviderExecution).native ?? null;
    }
  } catch (error) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "test-proof execution authority and budget must be launcher-minted",
      { error_code: error?.code ?? null }
    );
  }
  const authorized = authorizeValidationTarget({
    workspaceDir: authority.worktree_path,
    target: input.target,
    authorizedTargets: input.authorizedTargets,
    ...(nativeExecution === null ? {} : { allowedExtensions: nativeExecution.target_extensions })
  });
  if (isWorkspaceAgentValidationRunRefusal(authorized)) return authorized;
  if (nativeExecution !== null) {
    return runConfinedNativeTestProof({ authority, authorized, execution: nativeExecution,
      executionBudget });
  }
  const dependencyProof = authority.dependency_proof;
  const dependencyBinds = dependencyProof?.projection_selected === true
    ? [...dependencyProof.reviewer_read_only_binds]
    : [];
  if (dependencyProof?.projection_selected === true) {
    assertSelectedDependencyMountIntegrity(dependencyProof);
  }
  const mountpoint = path.join(authority.worktree_path, "node_modules");
  const createdMountpoint = dependencyBinds.length > 0 && !existsSync(mountpoint);
  if (createdMountpoint) mkdirSync(mountpoint, { mode: 0o700 });
  try {
    const result = await runWorkspaceAgentValidation({
      operation: "node_test",
      workspaceDir: authority.worktree_path,
      target: authorized.posixRelative,
      authorizedTargets: input.authorizedTargets,
      timeoutMs: DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
      dependencyReadOnlyBinds: dependencyBinds,
      maskAgentLaunchDirWhenPresent: true,
      testProofProviderExecution: input.testProofProviderExecution,
      ...(executionBudget === null ? {} : { executionBudget })
    });
    return Object.freeze({
      ...result,
      unit: authority.selected_unit,
      dependency: Object.freeze({
        mount_selected: dependencyProof?.projection_selected === true,
        projection_identity: dependencyProof?.projection_identity ?? null,
        installation_digest: dependencyProof?.dependency_installation_digest ?? null,
        advisory: true
      }),
      advisory: true,
      admission_effect: "none",
      review_effect: "none",
      closure_effect: "none"
    });
  } finally {
    if (createdMountpoint) rmSync(mountpoint, { recursive: true, force: true });
  }
}

const NATIVE_DRIVER_BLOCKERS = Object.freeze({
  working_copy_failed: "test_proof_native_working_copy_failed",
  spawn_failed: "test_proof_native_runner_launch_failed",
  plan_invalid: "test_proof_native_driver_status_missing"
});

async function runConfinedNativeTestProof({ authority, authorized, execution, executionBudget }) {
  const command = path.basename(execution.invocation.command);
  const baseEvidence = {
    schema_version: WORKSPACE_AGENT_VALIDATION_RUN_RESULT_SCHEMA_VERSION,
    operation: "native_test_proof",
    command,
    normalized_argv: Object.freeze([command, "[launcher-test-proof-provider]", authorized.posixRelative]),
    target: authorized.posixRelative,
    raw_exec_enabled: false,
    enforcement_posture: Object.freeze({
      confined: true,
      execution_context: "confined_target_execution",
      executes_target: true,
      repo_mount: "read_only",
      secrets_masked: true,
      network: "denied",
      env: "launcher_minted_clean",
      spawn_site: "launcher_confined_proof_runner"
    })
  };
  const envelope = (result) => Object.freeze({
    ...result,
    unit: authority.selected_unit,
    dependency: Object.freeze({
      mount_selected: false,
      projection_identity: null,
      installation_digest: null,
      consumer_dependency_projection: "not_consumed",
      advisory: true
    }),
    advisory: true,
    admission_effect: "none",
    review_effect: "none",
    closure_effect: "none"
  });
  const startedAtMs = Date.now();
  const notRun = (blockerCode, message, extra = {}) => {
    const endedAtMs = Date.now();
    return envelope({ ...baseEvidence, ran: false, skipped: false,
      disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN, ok: false, exit_code: null,
      signal: null, timed_out: false, cancelled: false, cleanup_failed: false,
      blocker_code: blockerCode, blocker_message: message,
      started_at_ms: startedAtMs, ended_at_ms: endedAtMs, duration_ms: endedAtMs - startedAtMs,
      ...extra });
  };
  const ownsScratch = execution.invocation.scratchRoot === undefined;
  const scratchRoot = ownsScratch
    ? mkdtempSync("/tmp/agent-chassis-proof-")
    : execution.invocation.scratchRoot;
  let invoked;
  try {
    invoked = await runConfinedInvocation({
      checkout: authorized.repoReal,
      runtime: execution.runtime,
      invocation: { ...execution.invocation, scratchRoot },
      timeoutMs: execution.timeout_ms ?? DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
      budget: executionBudget
    });
  } finally {
    if (ownsScratch) rmSync(scratchRoot, { recursive: true, force: true });
  }
  if (invoked.status === "plan_failed") {
    return notRun(invoked.code, invoked.error?.message ?? String(invoked.error));
  }
  if (invoked.status === "interrupted_before_start") {
    return envelope(interruptedBeforeSpawn(baseEvidence, invoked.interruption, startedAtMs, Date.now()));
  }
  if (invoked.status === "spawn_failed") {
    return notRun(invoked.code ?? BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED,
      invoked.error?.message ?? String(invoked.error));
  }
  const { capture, driver, channel, outputBounds } = invoked;
  const driverExited = driver?.phase === "exited";

  const driverCapture = {
    ...capture,
    code: driverExited ? driver.exit_code : capture.code,
    signal: driverExited ? driver.signal : capture.signal,
    reporter: { text: channel?.bytes === null || channel?.bytes === undefined ? ""
      : channel.bytes.toString("utf8"), bytes: channel?.bytes ?? Buffer.alloc(0),
    protocol_overflow: channel?.overflow === true, truncated: channel?.overflow === true,
    elided_bytes: 0 }
  };
  const interrupted = capture.timedOut || capture.cancelled;
  if (!driverExited && !interrupted && !capture.cleanupFailed) {
    const blocker = driver === null
      ? (invoked.frame_error === "protocol_overflow" ? "test_proof_structured_events_oversized"
        : "test_proof_native_driver_status_missing")
      : NATIVE_DRIVER_BLOCKERS[driver.phase] ?? "test_proof_native_driver_status_missing";
    return notRun(blocker, driver?.error ?? invoked.frame_error ?? "the attempt driver did not report",
      { stdout: capture.stdout.text, stderr: capture.stderr.text,
        output_truncated: capture.stdout.truncated || capture.stderr.truncated,
        output_elided_bytes: capture.stdout.elided_bytes + capture.stderr.elided_bytes });
  }
  return envelope(settleConfinedCapture({
    baseEvidence,
    capture: driverCapture,
    startedAtMs,
    outputBounds,
    executionBudget,
    proofObservation: ({ exitCode, reporterProtocolOverflow }) => execution.observe({
      channelBytes: driverCapture.reporter.bytes, channelText: driverCapture.reporter.text,
      exitCode, channelOverflow: reporterProtocolOverflow })
  }));
}
