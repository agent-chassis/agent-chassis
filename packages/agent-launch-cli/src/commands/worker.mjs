import { randomBytes } from "node:crypto";
import {
  FAMILY_DEPRECATED_DIAGNOSTIC,
  resolveLauncherProfile
} from "../lib/agent-launch-profiles.mjs";
import {
  WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
  createWorkspaceAgentDispatchBackend
} from "../lib/workspace-agent-dispatch-backend.mjs";
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
  buildFamilyExecutorRegistryEntry
} from "../lib/workspace-agent-launch-adapter-contract.mjs";

const HELP_TEXT = `agent-launch worker <unit-address> [options] [--] [prompt...]

Canonical implementation-worker dispatch. The canonical option grammar is
\`agent-launch worker <unit> [--profile <profile>] [--app <app>] [--model <model>]\`:
\`worker\` is authority role only; \`--profile\` selects a canonical launcher
profile (default: worker); \`--app\` overrides the selected profile's default
app binding. Supported worker apps are codex and claude; agy is roadmap/WIP
and should be used only with --dry-run-json for planning or experimental
validation. \`--model\` overrides only the selected app binding's default model.
\`worker_spark\` is a profile, not a role.

Options:
  --profile <profile>            Canonical launcher profile (worker, worker_spark)
  --app codex|claude             Override the profile's default app binding
  --app agy                      Unsupported; fails closed
  --model <model>                Override the selected binding's default model
  --opus                         Alias for --model opus (Claude model shorthand)
  --sonnet                       Alias for --model sonnet (Claude model shorthand)
  --spark                        Shorthand for --profile worker_spark
  --family codex|claude|agy      Deprecated alias for --app
  --dry-run-json                 Emit canonical plan JSON without spawning

--fast, --worker-fast, --worker_fast, positional worker-fast / worker_fast,
\`--profile worker_fast\`, and CODEX_WORKER_PROFILE=worker_fast / worker-fast
refuse via the resolver-owned FAST_PROFILE_REFUSAL_DIAGNOSTIC.
`;

const AGY_WORKER_LIVE_REFUSAL_REASON = "agy_worker_live_dispatch_planning_only";
const AGY_WORKER_LIVE_REFUSAL_MESSAGE =
  "app agy is roadmap/WIP for this release; use --dry-run-json for planning only. " +
  "Live worker dispatch is supported for codex and claude.";

export async function runWorker(argv, io = {}, { backend: injectedBackend } = {}) {
  const parsed = parseWorkerArgs(argv);

  if (parsed.help) {
    writeLine(io.stdout, HELP_TEXT);
    return;
  }

  if (parsed.familyDeprecated) {
    writeRaw(io.stderr, `${FAMILY_DEPRECATED_DIAGNOSTIC}\n`);
  }

  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      writeRaw(io.stderr, `agent-launch worker: ${error}\n`);
    }
    process.exitCode = 2;
    return;
  }

  if (parsed.app === "agy" && !parsed.dryRunJson) {
    refuseAgyLiveWorker(io);
    return;
  }

  if (
    parsed.app === "agy"
    && parsed.dryRunJson
    && parsed.model === null
    && parsed.profileName === null
  ) {
    emitWorkerDryRunPlan({
      io,
      parsed,
      resolved: { app: "agy", model: null }
    });
    return;
  }

  let resolution = resolveLauncherProfile({
    role: "worker",
    profileName: parsed.profileName,
    app: parsed.app,
    model: parsed.model,
    env: process.env
  });
  if (!resolution.ok && shouldResolveWorkerLiveAppWithoutModelHint({ parsed, resolution })) {

    resolution = resolveLauncherProfile({
      role: "worker",
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

  if (parsed.dryRunJson) {
    emitWorkerDryRunPlan({ io, parsed, resolved });
    return;
  }

  if (resolved.app === "agy") {
    refuseAgyLiveWorker(io);
    return;
  }

  await dispatchWorkerSharedPipeline({ resolved, parsed }, io, { backend: injectedBackend });
}

function shouldResolveWorkerLiveAppWithoutModelHint({ parsed, resolution }) {
  return parsed.dryRunJson !== true
    && typeof parsed.app === "string"
    && parsed.app.length > 0
    && typeof parsed.model === "string"
    && parsed.model.length > 0
    && resolution?.error?.path === "model";
}

function emitWorkerDryRunPlan({ io, parsed, resolved }) {
  if (parsed.agentBackendOptions.length > 0) {
    const refusal = buildWorkerDryRunConfigRefusal({
      app: resolved.app,
      model: resolved.model,
      subject: parsed.unitAddress,
      unsupportedOptions: parsed.agentBackendOptions
    });
    writeLine(io.stdout, JSON.stringify(refusal, null, 2));
    return;
  }
  const planBackend = createCliDispatchBackend();
  const plan = planBackend.planLaunch({
    role: "worker",
    subject: typeof parsed.unitAddress === "string" ? parsed.unitAddress : "",
    workspace_dir: process.cwd(),
    app: resolved.app,
    model: resolved.model
  });
  writeLine(io.stdout, JSON.stringify(plan, null, 2));
}

function refuseAgyLiveWorker(io) {
  writeStderr(
    io.stderr,
    `agent-launch worker: ${AGY_WORKER_LIVE_REFUSAL_REASON}: ${AGY_WORKER_LIVE_REFUSAL_MESSAGE}\n`
  );
  process.exitCode = 1;
}

export async function dispatchWorkerSharedPipeline({ resolved, parsed }, io, { backend: injectedBackend } = {}) {

  const liveBackend = injectedBackend ?? createCliDispatchBackend({ resolvedProfile: resolved });
  const launch = await liveBackend.startLaunch({
    caller_session_id: generateCliSessionId(),
    role: "worker",
    subject: typeof parsed.unitAddress === "string" ? parsed.unitAddress : "",
    workspace_dir: process.cwd(),
    app: resolved.app,
    model: parsed.model ?? null
  });
  if (!launch.accepted) {
    writeStderr(io.stderr, `agent-launch worker: dispatch refused: ${launch.refusal?.reason ?? "unknown"}\n`);
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
    writeStderr(io.stderr, "agent-launch worker: run status unavailable\n");
    process.exitCode = 1;
    return;
  }
  if (waitResult.timed_out) {
    writeStderr(io.stderr, "agent-launch worker: launch timed out waiting for completion\n");
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

function buildWorkerDryRunConfigRefusal({ app, model, subject, unsupportedOptions }) {
  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
    dry_run: true,
    accepted: false,
    role: "worker",
    app: typeof app === "string" ? app : null,
    subject: typeof subject === "string" ? subject : null,
    model: null,
    workspace_dir: process.cwd(),
    executor_available: false,
    refusal: {
      reason: "worker_dry_run_backend_config_unsupported",
      detail: {
        supported_path: "agent-launch worker --dry-run-json now uses the shared backend planLaunch contract",
        unsupported_options: unsupportedOptions.map(([flag, value]) => ({
          flag,
          value
        })),
        requested_model: typeof model === "string" && model.length > 0 ? model : null
      }
    }
  };
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

function generateCliSessionId() {
  return `operator-cli.${randomBytes(8).toString("hex")}`;
}

const CLI_LAUNCH_TIMEOUT_MS = 86400000;
const CLI_POLL_INTERVAL_MS = 1000;

export function parseWorkerArgs(argv) {
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
    if (
      token === "--fast"
      || token === "--worker-fast"
      || token === "--worker_fast"
    ) {

      assignProfile(result, "worker_fast", "fast flag");
      index += 1;
      continue;
    }
    if (token === "--spark") {
      assignProfile(result, "worker_spark", "--spark");
      index += 1;
      continue;
    }

    if (token === "--opus") {
      assignModel(result, "opus", "--opus");
      index += 1;
      continue;
    }
    if (token === "--sonnet") {
      assignModel(result, "sonnet", "--sonnet");
      index += 1;
      continue;
    }
    const profileOpt = consumeOption(argv, index, "profile");
    if (profileOpt) {
      if (profileOpt.missing) {
        result.errors.push("--profile requires a value");
      } else {
        assignProfile(result, profileOpt.value, "--profile");
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
        assignModel(result, modelOpt.value, "--model");
      }
      index += modelOpt.consumed;
      continue;
    }
    const operatorConfigOpt = consumeOption(argv, index, "operator-config");
    if (operatorConfigOpt) {
      result.errors.push("--operator-config is retired and forbidden");
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
  if (value === "worker-fast" || value === "worker_fast") {

    assignProfile(result, "worker_fast", "positional fast alias");
    return;
  }
  if (positionalIndex === 0) {
    result.unitAddress = value;
  } else {
    result.promptArgs.push(value);
  }
}

function assignProfile(result, value, source) {
  if (
    result.profileName !== null
    && result.profileName !== value
    && !result.errors.find((entry) => entry.startsWith("profile already set"))
  ) {
    result.errors.push(
      `profile already set to ${result.profileName}; ${source} would override to ${value}`
    );
    return;
  }
  result.profileName = value;
}

function assignApp(result, value, source) {
  if (result.app !== null && result.app !== value) {
    result.errors.push(`app already set to ${result.app}; ${source} would override to ${value}`);
    return;
  }
  result.app = value;
}

function assignModel(result, value, source) {
  if (
    result.model !== null
    && result.model !== value
    && !result.errors.find((e) => e.startsWith("model already set"))
  ) {
    result.errors.push(
      `model already set to ${result.model}; ${source} would override to ${value}`
    );
    return;
  }
  result.model = value;
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
