

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError,
  buildBubblewrapLaunchPlan as defaultBuildBubblewrapLaunchPlan,
  spawnIsolated as defaultSpawnIsolated
} from "../launch-isolation.mjs";
import { buildValidationConfinementPlan } from "../workspace-agent-family-bwrap-plan.mjs";
import {
  DEFAULT_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES,
  TEST_PROOF_LIVE_CLEANUP_ALLOWANCE_MS,
  WORKSPACE_AGENT_VALIDATION_DISPOSITIONS,
  createNativeReportObserver,
  interruptedBeforeSpawn,
  resolveValidationOutputBounds,
  settleConfinedCapture,
  spawnAndCapture
} from "./confined-capture.mjs";
import { ATTEMPT_HOME, NATIVE_COMPILER_CACHE_RELATIVE_PATH, isUnderSystemRoot } from "./runtime-inputs.mjs";
import { ATTEMPT_SCRATCH_ROOT } from "../test-runtime-setup/ecosystems.mjs";

export const ATTEMPT_DRIVER_PATH = fileURLToPath(new URL("./attempt-driver.mjs", import.meta.url));

const SOURCE_COPY_PATH = fileURLToPath(new URL("./source-copy.mjs", import.meta.url));
export const ATTEMPT_PLAN_SCHEMA_VERSION = "workspace-agent-runner-attempt-plan.v2";
const STATUS_SCHEMA_VERSION = "workspace-agent-runner-attempt-status.v2";

const STATUS_ALLOWANCE_BYTES = 4096;
export const ATTEMPT_CHANNEL_CAP_BYTES = DEFAULT_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES -
  STATUS_ALLOWANCE_BYTES;

export function parseAttemptDriverFrame(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.alloc(0);
  const newline = buffer.indexOf(0x0a);
  if (newline < 0) return { status: null, channel: null, frame_error: "status_missing" };
  let status;
  try {
    status = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
  } catch {
    return { status: null, channel: null, frame_error: "status_invalid" };
  }
  if (status?.schema_version !== STATUS_SCHEMA_VERSION) {
    return { status: null, channel: null, frame_error: "status_invalid" };
  }
  const body = buffer.subarray(newline + 1);
  const declared = status.channel;
  if (declared === null || declared === undefined) {
    return body.length === 0 ? { status, channel: null, frame_error: null }
      : { status: null, channel: null, frame_error: "channel_unexpected" };
  }
  if (declared.overflow === true || typeof declared.error === "string") {
    return body.length === 0 ? { status, channel: { ...declared, bytes: null }, frame_error: null }
      : { status: null, channel: null, frame_error: "channel_unexpected" };
  }
  if (declared.bytes !== body.length ||
      declared.sha256 !== createHash("sha256").update(body).digest("hex")) {
    return { status: null, channel: null, frame_error: "channel_digest_mismatch" };
  }
  return { status, channel: { ...declared, bytes: Buffer.from(body) }, frame_error: null };
}

function planFile(file) {
  return { path: file.path, mode: file.mode ?? 0o600,
    content_base64: Buffer.from(file.content).toString("base64") };
}

export const EXECUTION_ROOT_PREFIX = "/tmp/agent-chassis-execution-";
const EXECUTION_ROOTS = new WeakSet();

export function createExecutionRoot() {
  const root = mkdtempSync(EXECUTION_ROOT_PREFIX);
  const tmp = path.join(root, "tmp");
  const scratch = path.join(root, "scratch");
  mkdirSync(tmp, { mode: 0o700 });
  mkdirSync(scratch, { mode: 0o700 });
  let settled = true;
  let cleanup = null;
  const executionRoot = Object.freeze({
    root,
    tmp,
    scratch,
    markUnsettled() { settled = false; },
    get cleanup() { return cleanup; },
    release() {
      if (cleanup !== null) return cleanup;
      if (!settled) {
        cleanup = Object.freeze({ status: "retained_unsettled", root,
          reason: "descendant_settlement_unconfirmed" });
        return cleanup;
      }
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
        cleanup = Object.freeze({ status: existsSync(root) ? "failed" : "removed", root });
      } catch (error) {
        cleanup = Object.freeze({ status: "failed", root, errno: error?.code ?? null });
      }
      return cleanup;
    }
  });
  EXECUTION_ROOTS.add(executionRoot);
  return executionRoot;
}

export async function withExecutionRoot(callback) {
  const executionRoot = createExecutionRoot();
  try {
    return await callback(executionRoot);
  } finally {
    executionRoot.release();
  }
}

function assertExecutionRoot(executionRoot) {
  if (!EXECUTION_ROOTS.has(executionRoot) || executionRoot.cleanup !== null ||
      !lstatSync(executionRoot.tmp).isDirectory() || realpathSync(executionRoot.tmp) !== executionRoot.tmp ||
      !lstatSync(executionRoot.scratch).isDirectory() ||
      realpathSync(executionRoot.scratch) !== executionRoot.scratch) {
    throw Object.assign(new Error("invalid execution root"), { code: "validation_plan_build_failed" });
  }
  return executionRoot;
}

function writableCacheRoot(invocation) {
  if (invocation.writableCache === undefined) return [];
  const cache = invocation.writableCache;
  if (typeof cache !== "string" || path.resolve(cache) !== cache ||
      !path.dirname(cache).endsWith(`/${NATIVE_COMPILER_CACHE_RELATIVE_PATH}`) ||
      !lstatSync(cache).isDirectory() || realpathSync(cache) !== cache) {
    throw Object.assign(new Error(`invalid native compiler cache ${JSON.stringify(cache)}`),
      { code: "validation_plan_build_failed" });
  }
  return [cache];
}

export async function runConfinedInvocation({
  checkout,
  runtime,
  invocation,
  timeoutMs,
  budget = null,
  signal = null,
  nativeReport = null,
  buildBubblewrapLaunchPlan = defaultBuildBubblewrapLaunchPlan,
  spawnIsolated = defaultSpawnIsolated
}) {
  const plan = {
    schema_version: ATTEMPT_PLAN_SCHEMA_VERSION,
    scratch_root: ATTEMPT_SCRATCH_ROOT,
    directories: [ATTEMPT_HOME, ...(invocation.directories ?? [])],
    copies: invocation.copies ?? [],
    links: invocation.links ?? [],
    writes: (invocation.writes ?? []).map(planFile),
    exec: { command: invocation.command, args: invocation.args, cwd: invocation.cwd },
    channel: invocation.channel ?? null,
    channel_cap_bytes: ATTEMPT_CHANNEL_CAP_BYTES
  };
  const launcherNode = process.execPath;
  const driverBinds = [{ src: ATTEMPT_DRIVER_PATH, dst: ATTEMPT_DRIVER_PATH },
    { src: SOURCE_COPY_PATH, dst: SOURCE_COPY_PATH },
    ...(isUnderSystemRoot(launcherNode) ? [] : [{ src: launcherNode, dst: launcherNode }])];
  const env = { ...runtime.env, ...(invocation.env ?? {}) };
  let confinement;
  let executionRoot = null;
  try {
    executionRoot = invocation.executionRoot === undefined ? null : assertExecutionRoot(invocation.executionRoot);
    const cacheRoots = writableCacheRoot(invocation);

    confinement = buildValidationConfinementPlan({
      workspaceDir: checkout,
      command: launcherNode,
      args: [ATTEMPT_DRIVER_PATH],
      env,
      envAllowlist: Object.keys(env),
      executionTmpSource: executionRoot?.tmp ?? null,
      executionScratchSource: executionRoot?.scratch ?? null,
      namespaceOnlyMountpoints: true,
      dependencyReadOnlyBinds: [...runtime.binds, ...(invocation.readOnlyBinds ?? []),
        ...driverBinds],
      agentLaunchDirExists: existsSync,
      buildBubblewrapLaunchPlan: cacheRoots.length === 0 ? buildBubblewrapLaunchPlan
        : (options) => buildBubblewrapLaunchPlan({ ...options,
          runtimeRoots: [...(options.runtimeRoots ?? []), ...cacheRoots] })
    });
  } catch (error) {
    return { status: "plan_failed", error,
      code: error instanceof BubblewrapIsolationError ? error.code : "validation_plan_build_failed" };
  }
  const pending = budget?.interruption() ?? null;
  if (pending !== null || signal?.aborted) {
    return { status: "interrupted_before_start", interruption: pending ?? "cancelled" };
  }
  const outputBounds = resolveValidationOutputBounds({});
  try {
    const capture = await spawnAndCapture(confinement, {
      spawnIsolated,
      parentEnv: process.env,
      timeoutMs: budget === null ? timeoutMs : Math.max(1, Math.min(timeoutMs, budget.remainingMs())),
      outputBounds,
      reporterProtocol: true,
      clock: () => Date.now(),
      signal: budget?.signal ?? signal ?? null,
      cleanupAllowanceMs: TEST_PROOF_LIVE_CLEANUP_ALLOWANCE_MS,
      stdinPayload: Buffer.from(JSON.stringify(plan), "utf8"),
      nativeReport: nativeReport === null ? null : createNativeReportObserver(nativeReport())
    });
    const frame = capture.reporter?.protocol_overflow === true
      ? { status: null, channel: null, frame_error: "protocol_overflow" }
      : parseAttemptDriverFrame(capture.reporter?.bytes);

    if (capture.cleanupFailed === true) executionRoot?.markUnsettled();
    return { status: "completed", capture, driver: frame.status, channel: frame.channel,
      frame_error: frame.frame_error, outputBounds };
  } catch (error) {
    return { status: "spawn_failed", error,
      code: error instanceof BubblewrapIsolationError ? error.code : null };
  }
}

const DRIVER_BLOCKERS = Object.freeze({
  working_copy_failed: "test_proof_native_working_copy_failed",
  spawn_failed: "test_proof_native_runner_launch_failed",
  plan_invalid: "test_proof_native_driver_status_missing"
});

export async function executeConfinedInvocation({ checkout, runtime, invocation, timeoutMs, budget = null,
  signal = null, nativeReport = null, baseEvidence, observe = null }) {
  const startedAtMs = Date.now();
  const notRun = (blockerCode, message, extra = {}) => {
    const endedAtMs = Date.now();
    return Object.freeze({ ...baseEvidence, ran: false, skipped: false,
      disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN, ok: false, exit_code: null,
      signal: null, timed_out: false, cancelled: false, cleanup_failed: false,
      blocker_code: blockerCode, blocker_message: message,
      started_at_ms: startedAtMs, ended_at_ms: endedAtMs, duration_ms: endedAtMs - startedAtMs,
      ...extra });
  };
  const invoke = (owned) => runConfinedInvocation({ checkout, runtime, invocation: owned, timeoutMs, budget,
    signal, nativeReport });
  const invoked = invocation.executionRoot === undefined
    ? await withExecutionRoot((executionRoot) => invoke({ ...invocation, executionRoot }))
    : await invoke(invocation);
  if (invoked.status === "plan_failed") {
    return notRun(invoked.code, invoked.error?.message ?? String(invoked.error));
  }
  if (invoked.status === "interrupted_before_start") {
    return interruptedBeforeSpawn(baseEvidence, invoked.interruption, startedAtMs, Date.now());
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
      : DRIVER_BLOCKERS[driver.phase] ?? "test_proof_native_driver_status_missing";
    return notRun(blocker, driver?.error ?? invoked.frame_error ?? "the attempt driver did not report",
      { stdout: capture.stdout.text, stderr: capture.stderr.text,
        output_truncated: capture.stdout.truncated || capture.stderr.truncated,
        output_elided_bytes: capture.stdout.elided_bytes + capture.stderr.elided_bytes });
  }
  return settleConfinedCapture({
    baseEvidence,
    capture: driverCapture,
    startedAtMs,
    outputBounds,
    executionBudget: budget,
    proofObservation: observe === null ? null : ({ exitCode, reporterProtocolOverflow }) => observe({
      channelBytes: driverCapture.reporter.bytes, channelText: driverCapture.reporter.text,
      exitCode, channelOverflow: reporterProtocolOverflow, nativeReport: capture.native_report ?? null })
  });
}
