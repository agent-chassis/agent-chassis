

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
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
  resolveValidationOutputBounds,
  spawnAndCapture
} from "./confined-capture.mjs";
import { ATTEMPT_HOME, isUnderSystemRoot } from "./runtime-inputs.mjs";
import { ATTEMPT_SCRATCH_ROOT } from "../test-runtime-setup/ecosystems.mjs";

export const ATTEMPT_DRIVER_PATH = fileURLToPath(new URL("./attempt-driver.mjs", import.meta.url));
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

export async function runConfinedInvocation({
  checkout,
  runtime,
  invocation,
  timeoutMs,
  budget = null,
  signal = null,
  buildBubblewrapLaunchPlan = defaultBuildBubblewrapLaunchPlan,
  spawnIsolated = defaultSpawnIsolated
}) {
  const plan = {
    schema_version: ATTEMPT_PLAN_SCHEMA_VERSION,
    scratch_root: invocation.scratchRoot ?? ATTEMPT_SCRATCH_ROOT,
    directories: [invocation.scratchRoot === undefined
      ? ATTEMPT_HOME : `${invocation.scratchRoot}/home`, ...(invocation.directories ?? [])],
    copies: invocation.copies ?? [],
    links: invocation.links ?? [],
    writes: (invocation.writes ?? []).map(planFile),
    exec: { command: invocation.command, args: invocation.args, cwd: invocation.cwd },
    channel: invocation.channel ?? null,
    channel_cap_bytes: ATTEMPT_CHANNEL_CAP_BYTES
  };
  const launcherNode = process.execPath;
  const driverBinds = [{ src: ATTEMPT_DRIVER_PATH, dst: ATTEMPT_DRIVER_PATH },
    ...(isUnderSystemRoot(launcherNode) ? [] : [{ src: launcherNode, dst: launcherNode }])];
  const env = { ...runtime.env, ...(invocation.env ?? {}) };

  const createdMountpoints = [];
  try {
    for (const mountpoint of runtime.mountpoints ?? []) {
      if (!existsSync(mountpoint)) {
        mkdirSync(mountpoint, { mode: 0o700 });
        createdMountpoints.push(mountpoint);
      }
    }
    let confinement;
    try {
      confinement = buildValidationConfinementPlan({
        workspaceDir: checkout,
        command: launcherNode,
        args: [ATTEMPT_DRIVER_PATH],
        env,
        envAllowlist: Object.keys(env),
        useSystemTmp: invocation.scratchRoot !== undefined,
        dependencyReadOnlyBinds: [...runtime.binds, ...(invocation.readOnlyBinds ?? []),
          ...driverBinds],
        agentLaunchDirExists: existsSync,
        buildBubblewrapLaunchPlan
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
        stdinPayload: Buffer.from(JSON.stringify(plan), "utf8")
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
  } finally {
    for (const mountpoint of createdMountpoints) rmSync(mountpoint, { recursive: true, force: true });
  }
}
