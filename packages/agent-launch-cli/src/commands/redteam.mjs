import { randomBytes } from "node:crypto";
import {
  FAMILY_DEPRECATED_DIAGNOSTIC,
  resolveLauncherProfile
} from "../lib/agent-launch-profiles.mjs";
import {
  createCodexWorkspaceAgentLaunchExecutor,
  CODEX_FAMILY_NATIVE_READ_CAPABILITY,
  CODEX_FAMILY_SOURCE_READ_MODE
} from "../lib/workspace-agent-dispatch-codex-executor.mjs";
import {
  createClaudeWorkspaceAgentLaunchExecutor,
  CLAUDE_FAMILY_SOURCE_READ_MODE,
  CLAUDE_FAMILY_NATIVE_READ_CAPABILITY
} from "../lib/workspace-agent-dispatch-claude-executor.mjs";
import {
  createWorkspaceAgentDispatchBackend,
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION
} from "../lib/workspace-agent-dispatch-backend.mjs";

import {
  buildFamilyExecutorRegistryEntry
} from "../lib/workspace-agent-launch-adapter-contract.mjs";

const HELP_TEXT = `agent-launch redteam <subject> [options]

Canonical findings-only redteam dispatch. The subject may be a WK unit
address (WK-####[#slice-id]) or an initiative id (IN-####). The canonical
option grammar is
\`agent-launch redteam <subject> [--profile <profile>] [--app <app>] [--model <model>]\`.

Options:
  --profile <profile>            Canonical launcher profile (default: redteam)
  --app codex|claude             Override the profile's default app binding
                                 AGY is roadmap/WIP; use --app agy only for
                                 planning or experimental validation
  --model <model>                Override the selected binding's default model
  --family codex|claude          Deprecated alias for --app
                                 AGY is roadmap/WIP here as with --app
  --operator-config <path>       Launcher registry path override (claude/agy)
                                 (claude/agy)
  --dry-run-json                 Emit canonical plan JSON without spawning
`;

const AGY_REDTEAM_LIVE_REFUSAL_REASON = "agy_redteam_live_dispatch_planning_only";
const AGY_REDTEAM_LIVE_REFUSAL_MESSAGE =
  "app agy is roadmap/WIP for this release; use --dry-run-json for planning only. " +
  "Live redteam dispatch is supported for codex and claude.";

const INITIATIVE_PATTERN = /^IN-[0-9]+$/;

export async function runRedteam(argv, io = {}, { backend: injectedBackend } = {}) {
  const parsed = parseCanonicalArgs(argv);

  if (parsed.help || parsed.unitAddress === null) {
    writeLine(io.stdout, HELP_TEXT);
    if (parsed.unitAddress === null && !parsed.help) {
      process.exitCode = 2;
    }
    return;
  }

  if (parsed.familyDeprecated) {
    writeRaw(io.stderr, `${FAMILY_DEPRECATED_DIAGNOSTIC}\n`);
  }

  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      writeRaw(io.stderr, `agent-launch redteam: ${error}\n`);
    }
    process.exitCode = 2;
    return;
  }

  if (parsed.app === "agy" && !parsed.dryRunJson) {
    refuseAgyLiveRedteam(io);
    return;
  }

  let resolution = resolveLauncherProfile({
    role: "redteam",
    profileName: parsed.profileName,
    app: parsed.app,
    model: parsed.model,
    env: process.env
  });
  if (!resolution.ok && shouldResolveRedteamLiveAppWithoutModelHint({ parsed, resolution })) {
    resolution = resolveLauncherProfile({
      role: "redteam",
      profileName: parsed.profileName,
      app: parsed.app,
      model: null,
      env: process.env
    });
  }
  if (!resolution.ok) {

    writeStderr(io.stderr, `${resolution.error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const resolved = resolution.value;

  const subject = parsed.unitAddress;

  if (parsed.dryRunJson) {
    if (parsed.agentBackendOptions.length > 0) {
      const refusal = buildRedteamDryRunConfigRefusal({
        app: resolved.app,
        model: resolved.model,
        subject,
        unsupportedOptions: parsed.agentBackendOptions
      });
      writeLine(io.stdout, JSON.stringify(refusal, null, 2));
      return;
    }
    const planBackend = createCliDispatchBackend();
    const plan = planBackend.planLaunch({
      role: "redteam",
      subject,
      workspace_dir: process.cwd(),
      app: resolved.app,
      model: resolved.model
    });
    writeLine(io.stdout, JSON.stringify(plan, null, 2));
    return;
  }

  if (resolved.app === "agy") {
    refuseAgyLiveRedteam(io);
    return;
  }

  await dispatchRedteamSharedPipeline({ resolved, parsed, subject }, io, { backend: injectedBackend });
}

function shouldResolveRedteamLiveAppWithoutModelHint({ parsed, resolution }) {
  return parsed.dryRunJson !== true
    && typeof parsed.app === "string"
    && parsed.app.length > 0
    && typeof parsed.model === "string"
    && parsed.model.length > 0
    && resolution?.error?.path === "model";
}

function refuseAgyLiveRedteam(io) {
  writeStderr(
    io.stderr,
    `agent-launch redteam: ${AGY_REDTEAM_LIVE_REFUSAL_REASON}: ${AGY_REDTEAM_LIVE_REFUSAL_MESSAGE}\n`
  );
  process.exitCode = 1;
}

export async function dispatchRedteamSharedPipeline({ resolved, parsed, subject }, io, { backend: injectedBackend } = {}) {

  const liveBackend = injectedBackend ?? createCliDispatchBackend({ resolvedProfile: resolved });
  const launch = await liveBackend.startLaunch({
    caller_session_id: generateCliSessionId(),
    role: "redteam",
    subject: typeof subject === "string" ? subject : (typeof parsed.unitAddress === "string" ? parsed.unitAddress : ""),
    workspace_dir: process.cwd(),
    app: resolved.app,
    model: parsed.model ?? null
  });
  if (!launch.accepted) {
    writeRaw(io.stderr, `agent-launch redteam: dispatch refused: ${launch.refusal?.reason ?? "unknown"}\n`);
    process.exitCode = 1;
    return;
  }
  const waitResult = await liveBackend.waitForRunStatus({
    caller_session_id: launch.caller_session_id,
    monitor_handle: launch.monitor_handle,
    timeout_ms: CLI_LAUNCH_TIMEOUT_MS,
    poll_interval_ms: CLI_POLL_INTERVAL_MS
  });
  if (!waitResult || waitResult.accepted === false) {
    writeRaw(io.stderr, "agent-launch redteam: run status unavailable\n");
    process.exitCode = 1;
    return;
  }
  if (waitResult.timed_out) {
    writeRaw(io.stderr, "agent-launch redteam: launch timed out waiting for completion\n");
    process.exitCode = 1;
    return;
  }
  const exitCode = waitResult.exit?.code;
  if (typeof exitCode === "number" && exitCode !== 0) {
    process.exitCode = exitCode;
  } else if (waitResult.status === "failed" || waitResult.status === "cancelled") {
    process.exitCode = 1;
  }
}

export function buildCliDispatchLaunchExecutors({ resolvedProfile = null } = {}) {
  return {

    codex: buildFamilyExecutorRegistryEntry({
      executor: createCodexWorkspaceAgentLaunchExecutor({ resolvedProfile }),
      sourceReadMode: CODEX_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: CODEX_FAMILY_NATIVE_READ_CAPABILITY
    }),
    claude: buildFamilyExecutorRegistryEntry({
      executor: createClaudeWorkspaceAgentLaunchExecutor(),
      sourceReadMode: CLAUDE_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: CLAUDE_FAMILY_NATIVE_READ_CAPABILITY
    })
  };
}

function createCliDispatchBackend({ resolvedProfile = null } = {}) {
  return createWorkspaceAgentDispatchBackend({
    launchExecutors: buildCliDispatchLaunchExecutors({ resolvedProfile })
  });
}

function buildRedteamDryRunConfigRefusal({ app, model, subject, unsupportedOptions }) {
  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
    dry_run: true,
    accepted: false,
    role: "redteam",
    app: typeof app === "string" ? app : null,
    subject: typeof subject === "string" ? subject : null,
    model: null,
    workspace_dir: process.cwd(),
    executor_available: false,
    refusal: {
      reason: "redteam_dry_run_backend_config_unsupported",
      detail: {
        supported_path: "agent-launch redteam --dry-run-json now uses the shared backend planLaunch contract",
        unsupported_options: unsupportedOptions.map(([flag, value]) => ({
          flag,
          value
        })),
        requested_model: typeof model === "string" && model.length > 0 ? model : null
      }
    }
  };
}

function generateCliSessionId() {
  return `operator-cli.${randomBytes(8).toString("hex")}`;
}

const CLI_LAUNCH_TIMEOUT_MS = 86400000;
const CLI_POLL_INTERVAL_MS = 1000;

function parseCanonicalArgs(argv) {
  const result = {
    help: false,
    profileName: null,
    app: null,
    model: null,
    familyDeprecated: false,
    unitAddress: null,
    promptArgs: [],
    agentBackendOptions: [],
    dryRunJson: false,
    errors: []
  };

  let positionalIndex = 0;
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      for (const remaining of argv.slice(index + 1)) {
        pushPositional(result, remaining, positionalIndex);
        positionalIndex += 1;
      }
      break;
    }
    if (token === "-h" || token === "--help" || token === "help") {
      result.help = true;
      index += 1;
      continue;
    }
    const profileOpt = consumeOption(argv, index, "profile");
    if (profileOpt) {
      if (profileOpt.missing) {
        result.errors.push("--profile requires a value");
      } else {
        result.profileName = profileOpt.value;
      }
      index += profileOpt.consumed;
      continue;
    }
    const appOpt = consumeOption(argv, index, "app");
    if (appOpt) {
      if (appOpt.missing) {
        result.errors.push("--app requires a value (codex|claude|agy)");
      } else {
        assignApp(result, appOpt.value, "--app");
      }
      index += appOpt.consumed;
      continue;
    }
    const familyOpt = consumeOption(argv, index, "family");
    if (familyOpt) {
      if (familyOpt.missing) {
        result.errors.push("--family requires a value (codex|claude|agy)");
      } else {
        result.familyDeprecated = true;
        assignApp(result, familyOpt.value, "--family");
      }
      index += familyOpt.consumed;
      continue;
    }
    const modelOpt = consumeOption(argv, index, "model");
    if (modelOpt) {
      if (modelOpt.missing) {
        result.errors.push("--model requires a value");
      } else {
        result.model = modelOpt.value;
      }
      index += modelOpt.consumed;
      continue;
    }
    const operatorConfigOpt = consumeOption(argv, index, "operator-config");
    if (operatorConfigOpt) {
      if (operatorConfigOpt.missing) {
        result.errors.push("--operator-config requires a value");
      } else {
        result.agentBackendOptions.push(["--operator-config", operatorConfigOpt.value]);
      }
      index += operatorConfigOpt.consumed;
      continue;
    }
    const backendKeyOpt = consumeOption(argv, index, "backend-key");
    if (backendKeyOpt) {
      result.errors.push("--backend-key is retired and forbidden");
      index += backendKeyOpt.consumed;
      continue;
    }
    if (token === "--dry-run-json") {
      result.dryRunJson = true;
      index += 1;
      continue;
    }
    pushPositional(result, token, positionalIndex);
    positionalIndex += 1;
    index += 1;
  }
  return result;
}

function pushPositional(result, value, positionalIndex) {
  if (positionalIndex === 0) {
    result.unitAddress = value;
  } else {
    result.promptArgs.push(value);
  }
}

function assignApp(result, value, source) {
  if (result.app !== null && result.app !== value) {
    result.errors.push(`app already set to ${result.app}; ${source} would override to ${value}`);
    return;
  }
  result.app = value;
}

function consumeOption(argv, index, name) {
  const token = argv[index];
  if (token === `--${name}`) {
    const next = argv[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      return { value: next, consumed: 2, missing: false };
    }
    return { value: null, consumed: 1, missing: true };
  }
  if (token.startsWith(`--${name}=`)) {
    const equals = token.slice(`--${name}=`.length);
    if (equals === "") {
      return { value: null, consumed: 1, missing: true };
    }
    return { value: equals, consumed: 1, missing: false };
  }
  return null;
}

function writeLine(stream, value) {
  writeRaw(stream, `${value}\n`);
}

function writeRaw(stream, value) {
  if (stream?.write) {
    stream.write(value);
  } else {
    process.stdout.write(value);
  }
}

function writeStderr(stream, value) {
  if (stream?.write) {
    stream.write(value);
  } else {
    process.stderr.write(value);
  }
}
