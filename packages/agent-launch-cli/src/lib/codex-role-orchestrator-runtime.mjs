

import { spawn } from "node:child_process";

import {
  BubblewrapIsolationError,
  spawnIsolated
} from "./launch-isolation.mjs";
import {
  OPERATOR_DIRECT_MODE_WARNING,
  ORCHESTRATOR_ISOLATION_MODES,
  probeOrchestratorBwrapAvailability
} from "./orchestrator-launch-isolation.mjs";
import {
  spawnOrchestratorAndWait,
  openHeadlessStdio,
  HeadlessDirectModeError
} from "./orchestrator-launch-runtime.mjs";
import { writeStderr } from "./codex-role-io.mjs";
import {
  buildCodexOrchestratorIsolationSummary,
  buildCodexOrchestratorResumeIsolationSummary,
  buildCodexOrchestratorResumeLateBwrapSpawnFailureSummary,
  formatBubblewrapIsolationRefusal,
  formatOrchestratorResumeFailOpenRefusal,
  formatOrchestratorResumePlainSpawnProvenance
} from "./codex-role-sandbox-fail-open.mjs";

export function spawnIsolatedAndWait(bwrapPlan, options) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnIsolated(bwrapPlan, options);
    } catch (err) {
      reject(err);
      return;
    }
    child.on("error", reject);
    child.on("close", resolve);
  });
}

const CODEX_ORCHESTRATOR_RUNTIME_STATE_SCHEMA_VERSION =
  "codex-orchestrator-runtime-state.v1";

export function codexOrchestratorSessionDescriptor(plan) {
  return {
    schema_version: CODEX_ORCHESTRATOR_RUNTIME_STATE_SCHEMA_VERSION,
    mode: plan.mode,
    role: plan.role,
    subject: plan.subject,
    repo: plan.repo,
    runtime_dir: plan.runtimeDir,
    thread_name: plan.env?.CODEX_ORCH_THREAD_NAME ?? null,
    command: plan.command,
    args: plan.args
  };
}

export function spawnDirectAndWait(command, args, options) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, Array.isArray(args) ? [...args] : [], options);
    } catch (err) {
      reject(err);
      return;
    }
    child.on("error", reject);
    child.on("close", resolve);
  });
}

export function isOperatorOrchestratorInteractivePlan(plan) {
  return Boolean(plan)
    && plan.mode === "interactive"
    && (plan.role === "orch" || plan.role === "orch-resume");
}

export async function runInteractiveOrchestratorChild({
  plan,
  io,
  bwrapPlan,
  spawnOrchestrator = spawnOrchestratorAndWait,
  spawnLaunch = spawnIsolated,
  spawnDirect = spawnDirectAndWait,
  openStdio = openHeadlessStdio
} = {}) {
  const isHeadless =
    plan?.headless === true || plan?.mode === "orchestrator-headless";
  let headlessStdio = null;
  if (isHeadless) {
    if (!bwrapPlan || typeof bwrapPlan !== "object") {
      throw new HeadlessDirectModeError();
    }
    if (typeof openStdio !== "function") {
      throw new HeadlessDirectModeError(
        "headless orchestrator launch requires the launcher-owned SLICE-014 " +
        "stdio seam; openHeadlessStdio is unavailable"
      );
    }
    headlessStdio = openStdio(plan.headlessLogTarget);
  }

  let outcome;
  try {
    outcome = await spawnOrchestrator({
      runtimeDir: plan.runtimeDir,
      descriptor: codexOrchestratorSessionDescriptor(plan),
      bwrapPlan,
      spawnLaunch,
      spawnOptions: { env: plan.env },
      ...(headlessStdio ? { stdio: headlessStdio.stdio } : {})
    });
  } catch (err) {
    if (!(err instanceof BubblewrapIsolationError) || plan.role !== "orch-resume") {
      throw err;
    }
    plan.operatorIsolation =
      buildCodexOrchestratorResumeLateBwrapSpawnFailureSummary(plan, err);
    await dispatchOrchestratorResumeLateBwrapFallback(plan, io, err, { spawnDirect });
    return;
  } finally {
    headlessStdio?.close();
  }

  process.exitCode = outcome.status === "failed" || outcome.status === "cancelled"
    ? Number.isInteger(outcome.exitCode) && outcome.exitCode !== 0
      ? outcome.exitCode
      : 1
    : outcome.exitCode;
}

export async function dispatchOrchestratorResumeLateBwrapFallback(
  plan,
  io,
  error,
  { spawnDirect = spawnDirectAndWait } = {}
) {
  if (
    plan.operatorIsolation?.mode === ORCHESTRATOR_ISOLATION_MODES.DIRECT
    && plan.operatorIsolation?.failOpenWarning
  ) {
    writeStderr(io.stderr, `${OPERATOR_DIRECT_MODE_WARNING}\n`);
    writeStderr(
      io.stderr,
      `${formatOrchestratorResumePlainSpawnProvenance(plan)}\n`
    );
    const status = await spawnDirect(plan.command, plan.args, {
      cwd: plan.repo,
      env: plan.env,
      stdio: "inherit"
    });
    process.exitCode = status ?? 0;
    return;
  }
  if (plan.operatorIsolation?.refusal) {
    writeStderr(
      io.stderr,
      `${formatOrchestratorResumeFailOpenRefusal(plan)}\n`
    );
    process.exitCode = 1;
    return;
  }
  writeStderr(
    io.stderr,
    `${formatBubblewrapIsolationRefusal(plan.role, error)}\n`
  );
  process.exitCode = 1;
}

export function attachOperatorOrchestratorIsolation(plan, {
  probeBwrapAvailability = probeOrchestratorBwrapAvailability
} = {}) {
  if (!isOperatorOrchestratorInteractivePlan(plan)) {
    return plan;
  }
  const probe = (probeBwrapAvailability ?? probeOrchestratorBwrapAvailability)({
    env: plan.env
  });
  plan.operatorIsolation = plan.role === "orch-resume"
    ? buildCodexOrchestratorResumeIsolationSummary(plan, probe)
    : buildCodexOrchestratorIsolationSummary(probe);
  return plan;
}
