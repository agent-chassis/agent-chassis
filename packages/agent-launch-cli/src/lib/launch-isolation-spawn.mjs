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
  STDIO_MCP_TERMINAL_DRAIN_GRACE_MS,
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

function superviseConduitTerminalDrain(child, graceMs) {
  const stillRunning = () => child.exitCode === null && child.signalCode === null;

  if (!stillRunning()) return;
  const term = setTimeout(() => {
    if (!stillRunning()) return;
    try { child.kill("SIGTERM"); } catch {   }
    const kill = setTimeout(() => {
      if (!stillRunning()) return;
      try { child.kill("SIGKILL"); } catch {   }
    }, STDIO_MCP_TERMINAL_KILL_GRACE_MS);
    kill.unref?.();
    child.once("exit", () => clearTimeout(kill));
  }, graceMs);
  term.unref?.();
  child.once("exit", () => clearTimeout(term));
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
      void conduit.failureSettlement.then(() => {
        superviseConduitTerminalDrain(child, STDIO_MCP_ABNORMAL_DRAIN_GRACE_MS);
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
      superviseConduitTerminalDrain(
        child,
        exit?.expected === true
          ? STDIO_MCP_TERMINAL_DRAIN_GRACE_MS
          : STDIO_MCP_ABNORMAL_DRAIN_GRACE_MS
      );
    }, () => {
      superviseConduitTerminalDrain(child, STDIO_MCP_ABNORMAL_DRAIN_GRACE_MS);
    });
  }
  return child;
}
