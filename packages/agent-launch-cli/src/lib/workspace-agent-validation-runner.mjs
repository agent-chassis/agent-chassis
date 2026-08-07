

import path from "node:path";
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";

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

export const DEFAULT_VALIDATION_TIMEOUT_MS = 30000;

export const DEFAULT_VALIDATION_OUTPUT_CAP_BYTES = 262144;

export const LEGACY_VALIDATION_OUTPUT_CAP_BYTES = 65536;

const OUTPUT_HEAD_CAP_FRACTION = 4;
const OUTPUT_ELISION_MARKER_RESERVE_BYTES = 160;

export const WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES = Object.freeze({
  INVALID_INPUT: "workspace_agent_validation_runner.invalid_input.v1",
  UNSUPPORTED_OPERATION: "workspace_agent_validation_runner.unsupported_operation.v1",
  RAW_EXEC_FORBIDDEN: "workspace_agent_validation_runner.raw_exec_forbidden.v1",
  WORKSPACE_INVALID: "workspace_agent_validation_runner.workspace_invalid.v1",
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

function normalizeRelativeTargetString(target) {
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
  if (ext !== ".js" && ext !== ".mjs" && ext !== ".cjs") {
    return { ok: false, message: `target must be a .js/.mjs/.cjs file: ${normalized}` };
  }
  return { ok: true, posixRelative: normalized };
}

export function authorizeValidationTarget({ workspaceDir, target, authorizedTargets } = {}) {
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

  const normalized = normalizeRelativeTargetString(target);
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
    const entryNormalized = normalizeRelativeTargetString(entry);
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

  const absolute = path.resolve(repoReal, normalized.posixRelative);
  const relativeBack = path.relative(repoReal, absolute);
  if (relativeBack.startsWith("..") || path.isAbsolute(relativeBack)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_PATH_ESCAPE,
      `target resolves outside the workspace repo: ${normalized.posixRelative}`
    );
  }

  return { ok: true, repoReal, posixRelative: normalized.posixRelative, absolute };
}

export function resolveValidationOutputBounds({
  outputCapBytes = null,
  outputHeadCapBytes = null,
  outputTailCapBytes = null
} = {}) {
  const positive = (value) => (Number.isInteger(value) && value > 0 ? value : null);
  const head = positive(outputHeadCapBytes);
  const tail = positive(outputTailCapBytes);
  if (head !== null || tail !== null) {
    return {
      headCapBytes: head ?? 0,
      tailCapBytes: tail ?? 0,
      totalCapBytes: (head ?? 0) + (tail ?? 0) + OUTPUT_ELISION_MARKER_RESERVE_BYTES
    };
  }
  const total = positive(outputCapBytes) ?? DEFAULT_VALIDATION_OUTPUT_CAP_BYTES;
  const headCapBytes = Math.max(1, Math.floor(total / OUTPUT_HEAD_CAP_FRACTION));
  const tailCapBytes = Math.max(
    0,
    total - headCapBytes - OUTPUT_ELISION_MARKER_RESERVE_BYTES
  );
  return { headCapBytes, tailCapBytes, totalCapBytes: total };
}

function elisionMarker(elidedBytes, headCapBytes, tailCapBytes) {
  return (
    `\n[launcher output bound: ${elidedBytes} byte(s) elided from the middle; ` +
    `first ${headCapBytes} and last ${tailCapBytes} byte(s) retained]\n`
  );
}

function createBoundedSink({ headCapBytes, tailCapBytes }) {
  const headChunks = [];
  let headBytes = 0;

  let tailChunks = [];
  let tailBytes = 0;
  let elidedBytes = 0;

  function pushTail(buf) {
    if (tailCapBytes === 0) {
      elidedBytes += buf.length;
      return;
    }
    tailChunks.push(buf);
    tailBytes += buf.length;
    while (tailBytes > tailCapBytes) {
      const overflow = tailBytes - tailCapBytes;
      const front = tailChunks[0];
      if (front.length <= overflow) {
        tailChunks.shift();
        tailBytes -= front.length;
        elidedBytes += front.length;
      } else {
        tailChunks[0] = front.subarray(overflow);
        tailBytes -= overflow;
        elidedBytes += overflow;
      }
    }
  }

  return {
    push(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      if (buf.length === 0) return;
      if (headBytes < headCapBytes) {
        const room = headCapBytes - headBytes;
        if (buf.length <= room) {
          headChunks.push(buf);
          headBytes += buf.length;
          return;
        }
        headChunks.push(buf.subarray(0, room));
        headBytes = headCapBytes;
        pushTail(buf.subarray(room));
        return;
      }
      pushTail(buf);
    },
    result() {
      const head = Buffer.concat(headChunks);
      const tail = Buffer.concat(tailChunks);
      if (elidedBytes === 0) {
        return {
          text: Buffer.concat([head, tail]).toString("utf8"),
          truncated: false,
          elided_bytes: 0
        };
      }
      const marker = Buffer.from(
        elisionMarker(elidedBytes, headCapBytes, tailCapBytes),
        "utf8"
      );
      return {
        text: Buffer.concat([head, marker, tail]).toString("utf8"),
        truncated: true,
        elided_bytes: elidedBytes
      };
    }
  };
}

function spawnAndCapture(plan, { spawnIsolated, parentEnv, timeoutMs, outputBounds, clock }) {
  const child = spawnIsolated(plan, { stdio: ["ignore", "pipe", "pipe"], env: parentEnv });
  return new Promise((resolve) => {
    const stdoutSink = createBoundedSink(outputBounds);
    const stderrSink = createBoundedSink(outputBounds);
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {

      }
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...payload,
        timedOut,
        endedAtMs: clock(),
        stdout: stdoutSink.result(),
        stderr: stderrSink.result()
      });
    };

    if (child.stdout) child.stdout.on("data", (chunk) => stdoutSink.push(chunk));
    if (child.stderr) child.stderr.on("data", (chunk) => stderrSink.push(chunk));
    child.on("error", (err) => finish({ spawnError: err?.code ?? err?.message ?? String(err), code: null, signal: null }));
    child.on("close", (code, signal) => finish({ spawnError: null, code, signal }));
  });
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
  const timeoutMs =
    Number.isInteger(input.timeoutMs) && input.timeoutMs > 0
      ? input.timeoutMs
      : DEFAULT_VALIDATION_TIMEOUT_MS;
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

  const normalizedArgv = ["node", flag, authorized.posixRelative];
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
  let plan;
  try {
    plan = buildPlan({
      workspaceDir: authorized.repoReal,
      command: nodeBinary,
      args: [flag, authorized.absolute],
      env: planEnv,

      dependencyReadOnlyBinds: Array.isArray(input.dependencyReadOnlyBinds)
        ? input.dependencyReadOnlyBinds
        : [],

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
      clock
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

  const exitCode = typeof capture.code === "number" ? capture.code : null;

  const ran = capture.spawnError === null;
  const ok = ran && !capture.timedOut && exitCode === 0;
  let disposition;
  if (!ran) {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN;
  } else if (ok) {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.PASSED;
  } else {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.FAILED;
  }

  return Object.freeze({
    ...baseEvidence,
    ran,
    skipped: false,
    disposition,
    ok,
    exit_code: exitCode,
    signal: capture.signal ?? null,
    timed_out: capture.timedOut,
    spawn_error: capture.spawnError,
    output_truncated: capture.stdout.truncated || capture.stderr.truncated,
    output_elided_bytes: capture.stdout.elided_bytes + capture.stderr.elided_bytes,
    output_bounds: Object.freeze({
      head_cap_bytes: outputBounds.headCapBytes,
      tail_cap_bytes: outputBounds.tailCapBytes,
      retains: "head_and_tail"
    }),
    stdout: capture.stdout.text,
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
        ? await runWorkspaceAgentValidation({ ...stepInput, operation: "node_test" })
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

    advisory: true,
    admission_effect: "none",
    review_effect: "none",
    closure_effect: "none"
  });
}
