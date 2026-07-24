

import path from "node:path";
import { realpathSync } from "node:fs";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  buildBubblewrapLaunchPlan as defaultBuildBubblewrapLaunchPlan,
  spawnIsolated as defaultSpawnIsolated
} from "./launch-isolation.mjs";
import { buildValidationConfinementPlan as defaultBuildValidationConfinementPlan } from "./workspace-agent-family-bwrap-plan.mjs";
const AGENT_CHILD_STRUCTURED_VALIDATION_OPERATIONS = Object.freeze({
  node_check: Object.freeze({ operation: "node_check", node_flag: "--check", executes_target: false }),
  node_test: Object.freeze({ operation: "node_test", node_flag: "--test", executes_target: true })
});

export const WORKSPACE_AGENT_VALIDATION_RUN_RESULT_SCHEMA_VERSION =
  "workspace-agent-validation-run-result.v1";
export const WORKSPACE_AGENT_VALIDATION_RUN_REFUSAL_SCHEMA_VERSION =
  "workspace-agent-validation-run-refusal.v1";

export const DEFAULT_VALIDATION_TIMEOUT_MS = 30000;
export const DEFAULT_VALIDATION_OUTPUT_CAP_BYTES = 65536;

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

function createBoundedSink(capBytes) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  return {
    push(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      if (bytes >= capBytes) {
        truncated = true;
        return;
      }
      if (bytes + buf.length > capBytes) {
        chunks.push(buf.subarray(0, capBytes - bytes));
        bytes = capBytes;
        truncated = true;
        return;
      }
      chunks.push(buf);
      bytes += buf.length;
    },
    result() {
      return { text: Buffer.concat(chunks).toString("utf8"), truncated };
    }
  };
}

function spawnAndCapture(plan, { spawnIsolated, parentEnv, timeoutMs, outputCapBytes, clock }) {
  const child = spawnIsolated(plan, { stdio: ["ignore", "pipe", "pipe"], env: parentEnv });
  return new Promise((resolve) => {
    const stdoutSink = createBoundedSink(outputCapBytes);
    const stderrSink = createBoundedSink(outputCapBytes);
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
  const outputCapBytes =
    Number.isInteger(input.outputCapBytes) && input.outputCapBytes > 0
      ? input.outputCapBytes
      : DEFAULT_VALIDATION_OUTPUT_CAP_BYTES;

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
      outputCapBytes,
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
    stdout: capture.stdout.text,
    stderr: capture.stderr.text,
    started_at_ms: startedAtMs,
    ended_at_ms: capture.endedAtMs,
    duration_ms: capture.endedAtMs - startedAtMs
  });
}
