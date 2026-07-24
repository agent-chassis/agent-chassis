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
  resolveConduitChildStdio,
  settleStdioMcpConduitCleanup
} from "./stdio-mcp-conduit-contract.mjs";

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

    let conduitFinalized = false;
    const finalizeConduitLifecycle = () => {
      if (conduitFinalized) return;
      conduitFinalized = true;
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
