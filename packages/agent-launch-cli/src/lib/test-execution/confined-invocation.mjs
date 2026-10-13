

import { createHash } from "node:crypto";
import { spawn as spawnHostProcess } from "node:child_process";
import { constants as fsConstants, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { open as openFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
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
import { NATIVE_COMPILER_CACHE_RELATIVE_PATH, isUnderSystemRoot } from "./runtime-inputs.mjs";
import { ATTEMPT_SCRATCH_ROOT } from "../test-runtime-setup/ecosystems.mjs";

export const ATTEMPT_DRIVER_PATH = fileURLToPath(new URL("./attempt-driver.mjs", import.meta.url));

const SOURCE_COPY_PATH = fileURLToPath(new URL("./source-copy.mjs", import.meta.url));
export const ATTEMPT_PLAN_SCHEMA_VERSION = "workspace-agent-runner-attempt-plan.v2";
const STATUS_SCHEMA_VERSION = "workspace-agent-runner-attempt-status.v3";

const STATUS_ALLOWANCE_BYTES = 4096;
export const ATTEMPT_CHANNEL_CAP_BYTES = DEFAULT_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES -
  STATUS_ALLOWANCE_BYTES;

function buildAttemptPlan(invocation, scratchRoot) {
  return {
    schema_version: ATTEMPT_PLAN_SCHEMA_VERSION,
    scratch_root: scratchRoot,
    directories: [path.join(scratchRoot, "home"), ...(invocation.directories ?? [])],
    copies: invocation.copies ?? [],
    links: invocation.links ?? [],
    writes: (invocation.writes ?? []).map(planFile),
    exec: { command: invocation.command, args: invocation.args ?? [], cwd: invocation.cwd },
    channel: invocation.channel ?? null,
    channel_cap_bytes: ATTEMPT_CHANNEL_CAP_BYTES
  };
}

const SHA256_RE = /^[0-9a-f]{64}$/u;
const CHANNEL_ERROR_MAX_BYTES = 128;

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
  const unexpected = { status: null, channel: null, frame_error: "channel_unexpected" };
  if (declared === null || declared === undefined) {
    return body.length === 0 ? { status, channel: null, frame_error: null } : unexpected;
  }
  if (declared.kind === "file") {
    if (body.length !== 0) return unexpected;
    if (typeof declared.error === "string" && declared.error.length > 0 &&
        Buffer.byteLength(declared.error, "utf8") <= CHANNEL_ERROR_MAX_BYTES) {
      return { status, channel: { kind: "file", bytes: null, size: null, sha256: null, error: declared.error },
        frame_error: null };
    }
    if (!Number.isSafeInteger(declared.bytes) || declared.bytes < 0 || typeof declared.sha256 !== "string" ||
        !SHA256_RE.test(declared.sha256) || Object.hasOwn(declared, "error")) {
      return { status: null, channel: null, frame_error: "channel_invalid" };
    }
    return { status, channel: { kind: "file", bytes: null, size: declared.bytes, sha256: declared.sha256,
      error: null }, frame_error: null };
  }
  if (declared.kind !== "fd") return { status: null, channel: null, frame_error: "channel_invalid" };
  if (declared.overflow === true) {
    return body.length === 0 ? { status, channel: { ...declared, bytes: null }, frame_error: null } : unexpected;
  }
  if (declared.bytes !== body.length ||
      declared.sha256 !== createHash("sha256").update(body).digest("hex")) {
    return { status: null, channel: null, frame_error: "channel_digest_mismatch" };
  }
  return { status, channel: { ...declared, bytes: Buffer.from(body) }, frame_error: null };
}

const COMPLETION_UNPUBLISHED_MARKER = "[attempt-driver] completion frame not published:";
const PUBLICATION_ERROR_MAX_BYTES = 128;

export function parseCompletionPublicationFailure(stderrText) {
  if (typeof stderrText !== "string") return null;
  const lines = stderrText.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith(COMPLETION_UNPUBLISHED_MARKER)) continue;
    let stated;
    try {
      stated = JSON.parse(lines[index].slice(COMPLETION_UNPUBLISHED_MARKER.length));
    } catch {
      continue;
    }
    if (typeof stated?.error !== "string" || stated.error.length === 0 ||
        Buffer.byteLength(stated.error, "utf8") > PUBLICATION_ERROR_MAX_BYTES ||
        !Number.isSafeInteger(stated.written_bytes) || !Number.isSafeInteger(stated.frame_bytes) ||
        stated.written_bytes < 0 || stated.written_bytes > stated.frame_bytes) continue;
    return Object.freeze({ error: stated.error, written_bytes: stated.written_bytes,
      frame_bytes: stated.frame_bytes });
  }
  return null;
}

const COMPLETION_RECOVERY = Object.freeze({ actor: "caller",
  action: "check_effects_then_decide_on_a_new_run", repair_call: "none", automatic_rerun: false,
  next_action: "No repair or confirmation call exists and nothing reruns this test. Check the checkout for " +
    "the unconfirmed run's effects, then decide whether to start a new run; report the driver facts to the " +
    "launcher owner." });

function unconfirmedCompletion({ capture, frame_error: frameError }) {
  const publication = parseCompletionPublicationFailure(capture.stderr.text);
  const completion = Object.freeze({ confirmed: false, runner_outcome: "unknown", tests_may_have_executed: true,
    frame_error: frameError,
    frame_bytes_received: capture.reporter?.protocol_overflow === true ? null : capture.reporter?.bytes?.length ?? 0,
    driver_exit_code: typeof capture.code === "number" ? capture.code : null,
    driver_signal: capture.signal ?? null, publication_error: publication });
  const received = completion.frame_bytes_received === null ? "more than the protocol ceiling"
    : `${completion.frame_bytes_received} bytes`;
  const ended = completion.driver_signal !== null ? `driver signal ${completion.driver_signal}`
    : `driver exit ${completion.driver_exit_code ?? "unknown"}`;
  const cause = publication === null
    ? `completion frame unavailable: ${frameError}, received ${received}; ${ended}; no publish error stated`
    : `completion frame not published: ${publication.error} at ${publication.written_bytes}/` +
      `${publication.frame_bytes} bytes; received ${received} (${frameError}); ${ended}`;
  return { completion, completion_recovery: COMPLETION_RECOVERY,
    message: `${cause}; tests may have executed` };
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
  let removalError = null;
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
        removalError = error;
        cleanup = Object.freeze({ status: "failed", root, errno: error?.code ?? null });
      }
      return cleanup;
    },

    get removalError() { return removalError; }
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
    if (executionRoot.removalError !== null) throw executionRoot.removalError;
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
  spawnIsolated = defaultSpawnIsolated,
  spawnHost = spawnHostProcess,
  processGroupOperations = null
}) {

  if (invocation.executionRoot !== undefined) {
    return runHostTestInvocation({ checkout, runtime, invocation, timeoutMs, budget,
      nativeReport, spawnHost, processGroupOperations });
  }
  const plan = buildAttemptPlan(invocation, ATTEMPT_SCRATCH_ROOT);
  const launcherNode = process.execPath;
  const driverBinds = [{ src: ATTEMPT_DRIVER_PATH, dst: ATTEMPT_DRIVER_PATH },
    { src: SOURCE_COPY_PATH, dst: SOURCE_COPY_PATH },
    ...(isUnderSystemRoot(launcherNode) ? [] : [{ src: launcherNode, dst: launcherNode }])];
  const env = { ...runtime.env, ...(invocation.env ?? {}) };
  let confinement;
  try {
    const cacheRoots = writableCacheRoot(invocation);

    confinement = buildValidationConfinementPlan({
      workspaceDir: checkout,
      command: launcherNode,
      args: [ATTEMPT_DRIVER_PATH],
      env,
      envAllowlist: Object.keys(env),
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

    return { status: "completed", capture, driver: frame.status, channel: frame.channel,
      frame_error: frame.frame_error, outputBounds };
  } catch (error) {
    return { status: "spawn_failed", error,
      code: error instanceof BubblewrapIsolationError ? error.code : null };
  }
}

async function runHostTestInvocation({ checkout, runtime, invocation, timeoutMs, budget,
  nativeReport, spawnHost, processGroupOperations }) {
  let executionRoot;
  let plan;
  let env;
  try {
    executionRoot = assertExecutionRoot(invocation.executionRoot);
    plan = buildAttemptPlan(invocation, executionRoot.scratch);
    env = { ...runtime.env, ...(invocation.env ?? {}),
      HOME: path.join(executionRoot.scratch, "home"), TMPDIR: executionRoot.tmp,
      TMP: executionRoot.tmp, TEMP: executionRoot.tmp };
  } catch (error) {
    return { status: "plan_failed", error, code: error.code ?? "validation_plan_build_failed",
      executionRoot: invocation.executionRoot };
  }
  const pending = budget?.interruption() ?? null;
  if (pending !== null) return { status: "interrupted_before_start", interruption: pending, executionRoot };
  const outputBounds = resolveValidationOutputBounds({});
  let processGroupId = null;
  let driverAcquired = false;
  try {
    const capture = await spawnAndCapture({ command: process.execPath, args: [ATTEMPT_DRIVER_PATH], cwd: checkout }, {
      spawnIsolated: (command, options) => {
        const child = spawnHost(command.command, command.args, { cwd: command.cwd, env: options.env,
          stdio: options.stdio, detached: options.detached, shell: false });
        driverAcquired = true;
        processGroupId = child.pid ?? null;
        return child;
      },
      parentEnv: env,
      timeoutMs: budget === null ? timeoutMs : Math.max(1, Math.min(timeoutMs, budget.remainingMs())),
      outputBounds,
      reporterProtocol: true,
      clock: () => Date.now(),
      signal: budget?.signal ?? null,
      cleanupAllowanceMs: TEST_PROOF_LIVE_CLEANUP_ALLOWANCE_MS,
      stdinPayload: Buffer.from(JSON.stringify(plan), "utf8"),
      nativeReport: nativeReport === null ? null : createNativeReportObserver(nativeReport()),
      ownedProcessGroup: true,
      processGroupOperations
    });
    if (capture.cleanupFailed === true) executionRoot.markUnsettled();
    const frame = capture.reporter?.protocol_overflow === true
      ? { status: null, channel: null, frame_error: "protocol_overflow" }
      : parseAttemptDriverFrame(capture.reporter?.bytes);
    return { status: "completed", capture, driver: frame.status, channel: frame.channel,
      frame_error: frame.frame_error, outputBounds, processGroupId, driverAcquired, executionRoot };
  } catch (error) {
    return { status: "spawn_failed", error, code: "test_proof_native_runner_launch_failed",
      processGroupId, driverAcquired, executionRoot };
  }
}

export const OBSERVATION_TRANSPORT_FAILED_CODE = "test_proof_observation_transport_failed";
const CHANNEL_READ_CHUNK_BYTES = 64 * 1024;

function transportFailure(failure, facts = {}) {
  return Object.freeze({ valid: false, code: OBSERVATION_TRANSPORT_FAILED_CODE,
    detail: Object.freeze({ channel_kind: "file", failure, ...facts }) });
}

function underRoot(target, root) {
  return typeof target === "string" && path.resolve(target) === target && target.startsWith(`${root}/`);
}

async function readChannelFile({ channelPath, executionRoot, declared, sink, interruption }) {
  const expected = { expected_bytes: declared.size, expected_sha256: declared.sha256 };
  if (!underRoot(channelPath, executionRoot.scratch)) {
    return transportFailure("channel_outside_execution_root", expected);
  }
  let handle;
  try {
    handle = await openFile(channelPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    return transportFailure("channel_open_failed", { ...expected, errno: error?.code ?? null });
  }
  try {
    if (!(await handle.stat()).isFile()) return transportFailure("channel_not_regular_file", expected);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(CHANNEL_READ_CHUNK_BYTES);
    let consumed = 0;
    for (;;) {
      const interrupted = interruption();
      if (interrupted !== null) {
        return transportFailure("read_interrupted", { ...expected, interruption: interrupted,
          consumed_bytes: consumed });
      }
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      consumed += bytesRead;
      if (consumed > declared.size) {
        return transportFailure("channel_length_mismatch", { ...expected,
          observed_bytes: (await handle.stat()).size });
      }

      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      hash.update(chunk);
      sink.write(chunk);
    }
    if (consumed !== declared.size) {
      return transportFailure("channel_length_mismatch", { ...expected, observed_bytes: consumed });
    }
    const observed = hash.digest("hex");
    return observed === declared.sha256 ? null
      : transportFailure("channel_digest_mismatch", { ...expected, observed_bytes: consumed,
        observed_sha256: observed });
  } catch (error) {
    return transportFailure("channel_read_failed", { ...expected, errno: error?.code ?? null });
  } finally {
    await handle.close().catch(() => {});
  }
}

function collectingSink() {
  const chunks = [];
  let retained = 0;
  let overflow = false;
  return {
    write(chunk) {
      if (overflow) return;
      if (retained + chunk.length > ATTEMPT_CHANNEL_CAP_BYTES) {
        overflow = true;
        chunks.length = 0;
        retained = 0;
        return;
      }
      chunks.push(chunk);
      retained += chunk.length;
    },
    result: () => ({ bytes: Buffer.concat(chunks, retained), overflow })
  };
}

async function observeChannelFile({ observe, invocation, executionRoot, declared, exitCode, nativeReport,
  interruption }) {
  if (declared.error !== null) {
    return { observation: transportFailure("driver_channel_read_failed", { errno: declared.error }),
      overflow: false };
  }
  const incremental = typeof observe === "function" ? null : observe.open();
  const collected = incremental === null ? collectingSink() : null;
  const failure = await readChannelFile({ channelPath: invocation.channel.path, executionRoot, declared,
    sink: incremental ?? collected, interruption });
  if (failure !== null) return { observation: failure, overflow: false };
  if (incremental !== null) return { observation: incremental.finish({ exitCode, nativeReport }), overflow: false };
  const { bytes, overflow } = collected.result();
  return { observation: observe({ channelBytes: bytes, channelText: bytes.toString("utf8"), exitCode,
    channelOverflow: overflow, nativeReport }), overflow };
}

const DRIVER_BLOCKERS = Object.freeze({
  working_copy_failed: "test_proof_native_working_copy_failed",
  spawn_failed: "test_proof_native_runner_launch_failed",
  plan_invalid: "test_proof_native_driver_status_missing"
});

export async function executeConfinedInvocation({ checkout, runtime, invocation, timeoutMs, budget = null,
  nativeReport = null, baseEvidence, observe = null, spawnHost = spawnHostProcess,
  processGroupOperations = null, buildBubblewrapLaunchPlan = defaultBuildBubblewrapLaunchPlan }) {
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
  let ownedRoot = invocation.executionRoot ?? null;
  const invoke = (owned) => {
    ownedRoot = owned.executionRoot ?? null;
    return runConfinedInvocation({ checkout, runtime, invocation: owned, timeoutMs, budget, nativeReport,
      spawnHost, processGroupOperations, buildBubblewrapLaunchPlan });
  };

  const interruption = () => budget !== null ? budget.interruption()
    : Number.isFinite(timeoutMs) && Date.now() - startedAtMs >= timeoutMs ? "timed_out" : null;
  let invoked;

  let fileObservation = null;
  const invokeAndObserve = async (owned) => {
    invoked = await invoke(owned);
    const { capture, driver, channel } = invoked;
    if (observe === null || invoked.status !== "completed" || driver?.phase !== "exited" ||
        channel?.kind !== "file" || capture.spawnError !== null || capture.timedOut || capture.cancelled) return;
    fileObservation = await observeChannelFile({ observe, invocation: owned,
      executionRoot: invoked.executionRoot, declared: channel, exitCode: driver.exit_code,
      nativeReport: capture.native_report ?? null, interruption });
  };
  if (invocation.executionRoot === undefined) {
    ownedRoot = createExecutionRoot();
    try {
      await invokeAndObserve({ ...invocation, executionRoot: ownedRoot });
    } finally {
      ownedRoot.release();
    }
  } else {
    await invokeAndObserve(invocation);
  }
  const withCleanupRecovery = (result, capture = null) => {
    const rootCleanup = ownedRoot?.cleanup ?? invoked.executionRoot?.cleanup ?? null;
    const rootCleanupFailed = rootCleanup?.status === "failed";
    if (capture?.cleanupFailed !== true && !rootCleanupFailed) return result;
    const cleanupRecovery = Object.freeze({
      scope: capture?.cleanupFailed === true ? "owned_process_group" : "owned_execution_root",
      process_group_id: invoked.processGroupId ?? null,
      execution_root: ownedRoot?.root ?? invoked.executionRoot?.root ?? null,
      original_cause: Object.freeze({ exit_code: result.exit_code ?? null, signal: result.signal ?? null,
        timed_out: result.timed_out === true, cancelled: result.cancelled === true,
        driver_phase: invoked.driver?.phase ?? invoked.frame_error ?? null,
        spawn_error: result.spawn_error ?? capture?.spawnError ?? invoked.error?.code ?? null }),
      known_effects: Object.freeze(invoked.driverAcquired !== true
        ? [] : ["host attempt driver was acquired", "test-side effects may have reached the checkout"]),
      uncertainty: capture?.cleanupFailed === true
        ? "members of the named owned process group may still be using the execution root; detached descendants may remain outside that group"
        : "execution-root removal was not confirmed",
      next_action: capture?.cleanupFailed === true
        ? `The host operator must confirm or terminate owned process group ${invoked.processGroupId ?? "(unknown)"} before removing execution root ${ownedRoot?.root ?? invoked.executionRoot?.root ?? "(unknown)"}`
        : `The host operator must inspect execution root ${ownedRoot?.root ?? invoked.executionRoot?.root ?? "(unknown)"} and remove it after confirming no owned process can use it`,
      actor: "host operator"
    });
    return Object.freeze({ ...result, cleanup_failed: true,
      cleanup_scope: cleanupRecovery.scope,
      cleanup_error: capture?.cleanupError ?? (rootCleanupFailed
        ? `execution_root_removal_${rootCleanup.errno ?? "failed"}` : null),
      cleanup_recovery: cleanupRecovery,
      ...(rootCleanup === null ? {} : { execution_root_cleanup: rootCleanup }) });
  };
  if (invoked.status === "plan_failed") {
    return withCleanupRecovery(notRun(invoked.code, invoked.error?.message ?? String(invoked.error)));
  }
  if (invoked.status === "interrupted_before_start") {
    return withCleanupRecovery(interruptedBeforeSpawn(baseEvidence, invoked.interruption, startedAtMs, Date.now()));
  }
  if (invoked.status === "spawn_failed") {
    return withCleanupRecovery(notRun(invoked.code ?? "test_proof_native_runner_launch_failed",
      invoked.error?.message ?? String(invoked.error), { spawn_error: invoked.error?.code ?? null }));
  }
  const { capture, driver, channel, outputBounds } = invoked;
  const driverExited = driver?.phase === "exited";

  const driverCapture = {
    ...capture,
    code: driverExited ? driver.exit_code : null,
    signal: driverExited ? driver.signal : null,

    runnerOutcome: driverExited ? "confirmed" : "unknown",
    reporter: { text: channel?.bytes === null || channel?.bytes === undefined ? ""
      : channel.bytes.toString("utf8"), bytes: channel?.bytes ?? Buffer.alloc(0),
    protocol_overflow: channel?.overflow === true,
    truncated: channel?.overflow === true || fileObservation?.overflow === true,
    elided_bytes: 0 }
  };
  const interrupted = capture.timedOut || capture.cancelled;
  if (!driverExited && !interrupted) {
    const blocker = driver === null
      ? (capture.spawnError !== null ? "test_proof_native_runner_launch_failed"
        : invoked.frame_error === "protocol_overflow" ? "test_proof_structured_events_oversized"
          : "test_proof_native_driver_status_missing")
      : DRIVER_BLOCKERS[driver.phase] ?? "test_proof_native_driver_status_missing";
    const unconfirmed = driver === null && capture.spawnError === null ? unconfirmedCompletion(invoked) : null;
    return withCleanupRecovery(notRun(blocker, unconfirmed?.message ?? driver?.error ?? capture.spawnError ??
      invoked.frame_error ?? "the attempt driver did not report",
      { ...(unconfirmed === null ? {} : { disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.UNCONFIRMED,
        completion: unconfirmed.completion, completion_recovery: unconfirmed.completion_recovery }),
        stdout: capture.stdout.text, stderr: capture.stderr.text,
        output_truncated: capture.stdout.truncated || capture.stderr.truncated,
        output_elided_bytes: capture.stdout.elided_bytes + capture.stderr.elided_bytes,
        spawn_error: capture.spawnError, cleanup_failed: capture.cleanupFailed,
        cleanup_scope: capture.cleanupScope ?? null, cleanup_error: capture.cleanupError ?? null,
        ...(capture.ownedProcessGroupSettled == null ? {} : {
          owned_process_group_settled: capture.ownedProcessGroupSettled
        }) }), capture);
  }
  const settled = settleConfinedCapture({
    baseEvidence,
    capture: driverCapture,
    startedAtMs,
    outputBounds,
    executionBudget: budget,
    proofObservation: observe === null ? null : ({ exitCode, reporterProtocolOverflow }) => {
      if (channel?.kind === "file") return fileObservation.observation;
      const input = { exitCode, nativeReport: capture.native_report ?? null };
      if (typeof observe === "function") {
        return observe({ ...input, channelBytes: driverCapture.reporter.bytes,
          channelText: driverCapture.reporter.text, channelOverflow: reporterProtocolOverflow });
      }

      const opened = observe.open();
      if (reporterProtocolOverflow) return opened.finish({ ...input, channelOverflow: true });
      opened.write(driverCapture.reporter.bytes);
      return opened.finish(input);
    }
  });
  return withCleanupRecovery(settled, capture);
}
