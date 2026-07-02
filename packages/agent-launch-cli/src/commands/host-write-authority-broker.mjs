import os from "node:os";
import path from "node:path";

import { parseArgs } from "../lib/cli.mjs";
import { spawnIsolated } from "../lib/launch-isolation.mjs";
import {
  HostWriteAuthorityBrokerError,
  createHostWriteAuthorityBroker,
  createHostWriteAuthorityBrokerServer
} from "../lib/host-write-authority-substrate.mjs";
import { evaluateWorkerAdmissionForBackend } from "../lib/codex-worker-plan.mjs";
import {
  isNonEmptyStringInternal,
  writeLine,
  writeStderr
} from "../lib/codex-role-io.mjs";
import {
  createHostWriteAuthorityBrokerPlanLaunch
} from "../lib/workspace-agent-dispatch-codex-executor.mjs";

import {
  createCodexOrchestratorDispatchSidecarAdapter
} from "./codex-role.mjs";

const HOST_WRITE_AUTHORITY_BROKER_HELP_TEXT =
  `agent-launch codex-role host-write-authority-broker --allow-legacy-socket [--socket <path>]\n\n`
  + `Start the LEGACY launcher-owned host-side broker over a Unix socket.\n\n`
  + `This is an operator/debug-only surface and is OFF by default. The\n`
  + `controlled-orchestrator dispatch transport is the launcher-owned\n`
  + `loopback-TCP dispatch sidecar (AGENT_LAUNCH_HOST_WRITE_AUTHORITY_TCP_ENDPOINT),\n`
  + `started automatically before the orchestrator child by executePlan; it is\n`
  + `not this command. This command refuses to bind unless --allow-legacy-socket\n`
  + `is passed, so the legacy Unix-socket transport can never be selected\n`
  + `silently from a normal launcher invocation.\n\n`
  + `When explicitly opted into, the broker serves\n`
  + `\`agent_launch.host_write_authority.v1\` start_launch / probe_run envelopes\n`
  + `over the Unix socket using the SAME per-app plan-launch map the controlled\n`
  + `sidecar uses (codex/claude/agy), so a non-Codex app routes to its own\n`
  + `family handler and an unknown app refuses with broker_family_not_configured\n`
  + `rather than silently falling through to the Codex planner.\n\n`
  + `Options:\n`
  + `  --allow-legacy-socket  Required. Explicit operator/debug opt-in to the\n`
  + `                      legacy Unix-socket transport. Without it the command\n`
  + `                      refuses before binding any socket.\n`
  + `  --socket <path>     Absolute path for the broker's Unix socket.\n`
  + `                      Defaults to env\n`
  + `                      AGENT_LAUNCH_HOST_WRITE_AUTHORITY_SOCKET, then\n`
  + `                      $XDG_RUNTIME_DIR/agent-launch/host-write-authority/broker.sock,\n`
  + `                      then $XDG_STATE_HOME/agent-launch/host-write-authority/broker.sock,\n`
  + `                      then ~/.local/state/agent-launch/host-write-authority/broker.sock.\n`;

export const HOST_WRITE_AUTHORITY_BROKER_SOCKET_ENV_VAR =
  "AGENT_LAUNCH_HOST_WRITE_AUTHORITY_SOCKET";

export const HOST_WRITE_AUTHORITY_BROKER_LEGACY_SOCKET_DISABLED_REASON =
  "host_write_authority_broker_legacy_socket_transport_disabled";

export function resolveHostWriteAuthorityBrokerSocketPath(env = process.env) {
  if (isNonEmptyStringInternal(env[HOST_WRITE_AUTHORITY_BROKER_SOCKET_ENV_VAR])) {
    return env[HOST_WRITE_AUTHORITY_BROKER_SOCKET_ENV_VAR];
  }
  const runtimeBase = isNonEmptyStringInternal(env.XDG_RUNTIME_DIR)
    ? env.XDG_RUNTIME_DIR
    : isNonEmptyStringInternal(env.XDG_STATE_HOME)
      ? env.XDG_STATE_HOME
      : path.join(os.homedir(), ".local", "state");
  return path.join(runtimeBase, "agent-launch", "host-write-authority", "broker.sock");
}

export async function runHostWriteAuthorityBroker(argv = [], io = {}, context = {}) {
  const { positionals, options } = parseArgs(argv);
  if (options.help || options.h || positionals[0] === "help") {
    writeLine(io.stdout, HOST_WRITE_AUTHORITY_BROKER_HELP_TEXT);
    return;
  }

  const allowLegacySocket = options["allow-legacy-socket"] === true
    || context.allowLegacySocketTransport === true;
  if (!allowLegacySocket) {
    writeStderr(
      io.stderr,
      `host-write-authority-broker: ${HOST_WRITE_AUTHORITY_BROKER_LEGACY_SOCKET_DISABLED_REASON}: `
        + `the legacy Unix-socket broker transport is disabled by default. The `
        + `controlled-orchestrator transport is the launcher-owned loopback-TCP `
        + `dispatch sidecar (AGENT_LAUNCH_HOST_WRITE_AUTHORITY_TCP_ENDPOINT), `
        + `started automatically before the orchestrator child. Re-run with `
        + `--allow-legacy-socket only for explicit operator/debug use of the `
        + `legacy Unix-socket path.\n`
    );
    process.exitCode = 1;
    return {
      refused: true,
      reason: HOST_WRITE_AUTHORITY_BROKER_LEGACY_SOCKET_DISABLED_REASON
    };
  }

  const env = context.env ?? process.env;
  const socketOption = typeof options.socket === "string" && options.socket.length > 0
    ? options.socket
    : null;
  const socketPath = socketOption ?? resolveHostWriteAuthorityBrokerSocketPath(env);

  const planLaunch = context.planLaunch ?? createHostWriteAuthorityBrokerPlanLaunch({
    env,
    cwd: context.cwd ?? process.cwd(),
    promptArgs: context.promptArgs ?? [],
    resolvedProfile: context.resolvedProfile ?? null
  });
  const spawnLaunch = context.spawnLaunch ?? ((bwrapPlan, opts) => spawnIsolated(bwrapPlan, opts));

  const appPlanLaunchMap = context.appPlanLaunchMap
    ?? createCodexOrchestratorDispatchSidecarAdapter().buildAppPlanLaunchMap({
      env,
      cwd: context.cwd ?? process.cwd()
    });

  const broker = createHostWriteAuthorityBroker({
    planLaunch,
    appPlanLaunchMap,
    spawnLaunch,
    evaluateWorkerAdmission: evaluateWorkerAdmissionForBackend,

    captureFinalResult: context.captureFinalResult ?? null
  });
  const server = createHostWriteAuthorityBrokerServer({
    broker,
    socketPath,
    logger: context.logger ?? {
      info: (msg, detail) => writeLine(io.stdout, formatBrokerLog("info", msg, detail)),
      warn: (msg, detail) => writeLine(io.stderr ?? io.stdout, formatBrokerLog("warn", msg, detail)),
      error: (msg, detail) => writeStderr(io.stderr, `${formatBrokerLog("error", msg, detail)}\n`)
    }
  });

  try {
    await server.start();
  } catch (err) {
    if (err instanceof HostWriteAuthorityBrokerError) {
      writeStderr(
        io.stderr,
        `host-write-authority-broker: ${err.code}: ${err.message}\n`
      );
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (context.skipSignalWait === true) {
    return { server, socketPath };
  }

  await new Promise((resolve) => {
    const handle = (signal) => {
      writeLine(io.stdout, formatBrokerLog("info", "received signal", { signal }));
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      resolve();
    };
    const onSigint = () => handle("SIGINT");
    const onSigterm = () => handle("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  });

  await server.stop();
}

function formatBrokerLog(level, message, detail) {
  const detailString = detail && typeof detail === "object"
    ? ` ${JSON.stringify(detail)}`
    : "";
  return `[host-write-authority-broker] ${level}: ${message}${detailString}`;
}
