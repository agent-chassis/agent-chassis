import { spawn } from "node:child_process";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION,
  fail
} from "./launch-isolation-errors.mjs";
import { assertBubblewrapAvailable } from "./launch-isolation-bwrap.mjs";
import {
  assertReadOnlyProjectionMountpointsUnchanged,
  assertRequiredReadOnlyFilesUnchanged
} from "./launch-isolation-required-read-only-files.mjs";
import { assertFindingsRoleGitMetadataUnchanged } from "./launch-isolation-findings-git-metadata.mjs";

import {
  STDIO_MCP_ABNORMAL_DRAIN_GRACE_MS,
  STDIO_MCP_TERMINAL_KILL_GRACE_MS,
  assertTrustedStdioMcpConduitBinding,
  recordLauncherObservedStdioMcpClientTerminal,
  resolveConduitChildStdio,
  settleStdioMcpConduitCleanup
} from "./stdio-mcp-conduit-contract.mjs";

const TERMINAL_REVIEW_SPAWN_BARRIER_REFUSAL_BRAND = Symbol(
  "terminalReviewSpawnBarrierRefusal"
);

export const TERMINAL_REVIEW_SPAWN_BARRIER_DEFAULT_REASON =
  "terminal_review_attempt_contract_recheck_failed";

export const TERMINAL_REVIEW_SPAWN_BARRIER_INVALID_REASON =
  "terminal_review_spawn_barrier_invalid";

export class TerminalReviewSpawnBarrierRefusal extends Error {
  constructor(verdict) {
    super("agent-launch isolation: terminal-review pre-spawn barrier refused the launch");
    this.name = "TerminalReviewSpawnBarrierRefusal";
    Object.defineProperty(this, TERMINAL_REVIEW_SPAWN_BARRIER_REFUSAL_BRAND, {
      value: true,
      enumerable: false
    });
    const reason = typeof verdict?.reason === "string" && verdict.reason.length > 0
      ? verdict.reason
      : TERMINAL_REVIEW_SPAWN_BARRIER_DEFAULT_REASON;
    const detail = verdict?.detail !== null && typeof verdict?.detail === "object" &&
      !Array.isArray(verdict.detail)
      ? verdict.detail
      : null;

    this.verdict = Object.freeze({ ok: false, reason, detail });
  }
}

export function isTerminalReviewSpawnBarrierRefusal(value) {
  return (value !== null && typeof value === "object") &&
    value[TERMINAL_REVIEW_SPAWN_BARRIER_REFUSAL_BRAND] === true;
}

export const LAUNCHER_TERMINATION_EVIDENCE_SCHEMA_VERSION =
  "launcher-stdio-mcp-termination-evidence.v1";

export const LAUNCHER_TERMINATION_ISSUER = "launcher_terminal_supervisor";

export const LAUNCHER_TERMINATION_INITIATING_FACTS = Object.freeze({
  CONDUIT_FAILURE_SETTLEMENT: "conduit_failure_settlement",
  SERVER_EXIT_EXPECTED_DRAIN: "server_exit_expected_drain",
  SERVER_EXIT_ABNORMAL: "server_exit_abnormal",
  SERVER_EXIT_OBSERVATION_FAILED: "server_exit_observation_failed"
});

const LAUNCHER_TERMINATION_INITIATING_FACT_SET = new Set(
  Object.values(LAUNCHER_TERMINATION_INITIATING_FACTS));

const LAUNCHER_TERMINATION_OUTCOME_SLOTS = Object.freeze(["sigterm", "sigkill"]);

const LAUNCHER_TERMINATION_RECORDS = new WeakMap();

function boundedLauncherToken(value, max = 64) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:#-]+$/u.test(value)
    ? value.slice(0, max)
    : null;
}

function launcherTerminalSupervisionBasis(conduit, initiatingFact, settledCause = null) {
  if (conduit === null || typeof conduit !== "object" ||
      !LAUNCHER_TERMINATION_INITIATING_FACT_SET.has(initiatingFact)) {
    return null;
  }
  return Object.freeze({ conduit, initiatingFact, settledCause });
}

function resolveLauncherInitiationCause(basis) {
  let projection = null;
  try {
    projection = basis.conduit.launcherCause ?? null;
  } catch {
    projection = null;
  }
  const settledCode = boundedLauncherToken(basis.settledCause?.code);
  const projectedCode = boundedLauncherToken(projection?.cause_code);
  const available = projection === null
    ? settledCode !== null
    : projection.cause_available === true;
  return {
    available,

    code: available ? (settledCode ?? projectedCode) : null,
    boundary: boundedLauncherToken(projection?.boundary) ??
      (available ? "conduit_lifecycle" : "unavailable")
  };
}

function beginLauncherTermination(basis, child, plannedSignal) {
  if (basis === null) return null;
  const existing = LAUNCHER_TERMINATION_RECORDS.get(basis.conduit);
  if (existing !== undefined) return existing;
  const cause = resolveLauncherInitiationCause(basis);
  const state = {

    child,
    initiation: Object.freeze({
      schema_version: LAUNCHER_TERMINATION_EVIDENCE_SCHEMA_VERSION,
      initiated_by: LAUNCHER_TERMINATION_ISSUER,
      initiating_fact: basis.initiatingFact,
      planned_signal: plannedSignal,
      cause_available: cause.available,
      cause_code: cause.code,
      cause_boundary: cause.boundary
    }),
    sigterm: null,
    sigkill: null
  };
  LAUNCHER_TERMINATION_RECORDS.set(basis.conduit, state);
  return state;
}

function recordLauncherTerminationOutcome(state, slot, outcome) {
  if (state === null || state === undefined) return;
  if (!LAUNCHER_TERMINATION_OUTCOME_SLOTS.includes(slot)) return;

  if (state[slot] !== null) return;
  state[slot] = Object.freeze({
    signal: outcome.signal,
    attempted: true,
    delivered: outcome.delivered === true,
    error_code: boundedLauncherToken(outcome.errorCode)
  });
}

export function readLauncherConduitTerminationEvidence(conduit) {
  if (conduit === null || typeof conduit !== "object") return null;
  const state = LAUNCHER_TERMINATION_RECORDS.get(conduit);
  if (state === undefined) return null;
  return Object.freeze({
    ...state.initiation,
    sigterm: state.sigterm,
    sigkill: state.sigkill
  });
}

function superviseConduitTerminalDrain(child, graceMs, basis = null,
  escalationGraceMs = STDIO_MCP_TERMINAL_KILL_GRACE_MS) {
  const stillRunning = () => child.exitCode === null && child.signalCode === null;

  if (!stillRunning()) return;
  const term = setTimeout(() => {
    if (!stillRunning()) return;

    const record = beginLauncherTermination(basis, child, "SIGTERM");
    let deliveryError = null;
    try { child.kill("SIGTERM"); } catch (error) { deliveryError = error;   }
    recordLauncherTerminationOutcome(record, "sigterm", {
      signal: "SIGTERM",
      delivered: deliveryError === null,
      errorCode: deliveryError?.code
    });
    const kill = setTimeout(() => {
      if (!stillRunning()) return;
      let escalationError = null;
      try { child.kill("SIGKILL"); } catch (error) { escalationError = error;   }
      recordLauncherTerminationOutcome(record, "sigkill", {
        signal: "SIGKILL",
        delivered: escalationError === null,
        errorCode: escalationError?.code
      });
    }, escalationGraceMs);
    kill.unref?.();
    child.once("exit", () => clearTimeout(kill));
  }, graceMs);
  term.unref?.();
  child.once("exit", () => clearTimeout(term));
}

function resolveServerExitTerminalSupervision(exit) {
  if (exit?.expected === true) return null;
  return Object.freeze({
    graceMs: STDIO_MCP_ABNORMAL_DRAIN_GRACE_MS,
    initiatingFact: LAUNCHER_TERMINATION_INITIATING_FACTS.SERVER_EXIT_ABNORMAL
  });
}

export function spawnIsolated(plan, stdioOptions = {}) {

  const terminalReviewSpawnBarrier = stdioOptions?.terminalReviewSpawnBarrier ?? null;
  if (terminalReviewSpawnBarrier !== null && typeof terminalReviewSpawnBarrier !== "function") {
    throw new TerminalReviewSpawnBarrierRefusal({
      reason: TERMINAL_REVIEW_SPAWN_BARRIER_INVALID_REASON,
      detail: { barrier_type: typeof terminalReviewSpawnBarrier }
    });
  }
  if (!plan || typeof plan !== "object" || plan.schemaVersion !== BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.PLAN_INVALID,
      `spawnIsolated requires a plan from buildBubblewrapLaunchPlan (schema ${BUBBLEWRAP_LAUNCH_PLAN_SCHEMA_VERSION})`
    );
  }

  assertRequiredReadOnlyFilesUnchanged(plan.requiredReadOnlyFiles ?? []);
  assertReadOnlyProjectionMountpointsUnchanged(plan.readOnlyProjectionMountpoints ?? []);
  assertFindingsRoleGitMetadataUnchanged(plan.findingsRoleGitMetadata ?? null);
  const parentEnv = stdioOptions.env && typeof stdioOptions.env === "object" ? stdioOptions.env : process.env;
  const resolved = assertBubblewrapAvailable({
    env: parentEnv,
    bwrapPath: plan.bwrapPath
  });
  const conduit = plan.stdioMcpConduit === null || plan.stdioMcpConduit === undefined
    ? null
    : assertTrustedStdioMcpConduitBinding(plan.stdioMcpConduit);

  const childStdio = conduit === null
    ? stdioOptions.stdio ?? "inherit"
    : resolveConduitChildStdio(conduit, stdioOptions.stdio);

  assertRequiredReadOnlyFilesUnchanged(plan.requiredReadOnlyFiles ?? []);
  assertReadOnlyProjectionMountpointsUnchanged(plan.readOnlyProjectionMountpoints ?? []);
  assertFindingsRoleGitMetadataUnchanged(plan.findingsRoleGitMetadata ?? null);

  if (terminalReviewSpawnBarrier !== null) {
    const verdict = terminalReviewSpawnBarrier();
    if (verdict?.ok !== true) {
      throw new TerminalReviewSpawnBarrierRefusal(verdict);
    }
  }

  if (conduit !== null) {
    const retainedConduitFailure = conduit.failure ?? conduit.readinessFailure ?? null;
    if (retainedConduitFailure !== null) throw retainedConduitFailure;
  }
  let child;
  try {
    child = spawn(resolved, plan.bwrapArgs, {
      stdio: childStdio,
      env: parentEnv,
      detached: stdioOptions.detached === true,
      signal: stdioOptions.signal ?? undefined
    });
  } catch (err) {
    fail(
      BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED,
      `bwrap child failed to spawn: ${resolved}`,
      { errno: err?.code ?? null, message: err?.message ?? null }
    );
  }
  if (conduit !== null) {

    conduit.beginClientReadiness();
    conduit.clientReady.then(() => {

      try {
        conduit.markNamespaceReady();
      } catch {
        if (child.exitCode === null && child.signalCode === null) {
          try { child.kill("SIGKILL"); } catch {   }
        }
      }
    }, () => {

      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill("SIGKILL"); } catch {   }
      }
    });

    if (conduit.failureSettlement instanceof Promise) {
      void conduit.failureSettlement.then((cause) => {
        superviseConduitTerminalDrain(child, STDIO_MCP_ABNORMAL_DRAIN_GRACE_MS,
          launcherTerminalSupervisionBasis(conduit,
            LAUNCHER_TERMINATION_INITIATING_FACTS.CONDUIT_FAILURE_SETTLEMENT, cause));
        void settleStdioMcpConduitCleanup(conduit);
      });
    }

    let conduitFinalized = false;
    const finalizeConduitLifecycle = () => {
      if (conduitFinalized) return;
      conduitFinalized = true;

      recordLauncherObservedStdioMcpClientTerminal(conduit);
      void settleStdioMcpConduitCleanup(conduit);
    };
    child.once("exit", finalizeConduitLifecycle);
    child.once("close", finalizeConduitLifecycle);
    child.once("error", finalizeConduitLifecycle);

    void conduit.serverExit.then((exit) => {
      const supervision = resolveServerExitTerminalSupervision(exit);
      if (supervision === null) return;
      superviseConduitTerminalDrain(child, supervision.graceMs,
        launcherTerminalSupervisionBasis(conduit, supervision.initiatingFact));
    }, () => {
      superviseConduitTerminalDrain(child, STDIO_MCP_ABNORMAL_DRAIN_GRACE_MS,
        launcherTerminalSupervisionBasis(conduit,
          LAUNCHER_TERMINATION_INITIATING_FACTS.SERVER_EXIT_OBSERVATION_FAILED));
    });
  }
  return child;
}

export const __testing = Object.freeze({
  launcherTerminalSupervisionBasis,
  resolveServerExitTerminalSupervision,
  superviseConduitTerminalDrain
});
