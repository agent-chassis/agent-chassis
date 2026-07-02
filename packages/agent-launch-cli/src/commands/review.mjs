import { randomBytes } from "node:crypto";
import { reviewHandoff } from "@agent-chassis/agent-launch-core";
import { parseArgs } from "../lib/cli.mjs";
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
  CODEX_FAMILY_SOURCE_READ_MODE
} from "../lib/workspace-agent-dispatch-codex-executor.mjs";
import {
  createClaudeWorkspaceAgentLaunchExecutor,
  CLAUDE_FAMILY_SOURCE_READ_MODE,
  CLAUDE_FAMILY_NATIVE_READ_CAPABILITY
} from "../lib/workspace-agent-dispatch-claude-executor.mjs";
import {
  createAgyWorkspaceAgentLaunchExecutor,
  AGY_FAMILY_SOURCE_READ_MODE,
  AGY_FAMILY_NATIVE_READ_CAPABILITY
} from "../lib/workspace-agent-dispatch-agy-executor.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "../lib/agent-backend.mjs";

import {
  buildFamilyExecutorRegistryEntry
} from "../lib/workspace-agent-launch-adapter-contract.mjs";

const HELP_TEXT = `agent-launch review <unit-address> [options]

Canonical findings-only review dispatch. The canonical option grammar is
\`agent-launch review <unit> [--profile <profile>] [--app <app>] [--model <model>]\`.

Options:
  --profile <profile>            Canonical launcher profile (default: review)
  --app codex|claude             Override the profile's default app binding
  --app agy                      Roadmap/WIP; planning or experimental only
  --model <model>                Override the selected binding's default model
  --family codex|claude|agy      Deprecated alias for --app
  --operator-config <path>       Launcher registry path override (claude/agy)
  --backend-key <key>            Override filesystem_mcp_backend_default
                                 (claude/agy)
  --dry-run-json                 Emit canonical plan JSON without spawning

Supported review apps are codex and claude. AGY remains roadmap/WIP in the
public enforcement model; do not present it as hardened review support.

The deactivated reviewed-blackboard review path remains reachable via an
instruction_path positional; it fails closed via reviewHandoff and creates no
artifacts.
`;

const AGY_REVIEW_LIVE_REFUSAL_REASON = "agy_review_live_dispatch_planning_only";
const AGY_REVIEW_LIVE_REFUSAL_MESSAGE =
  "app agy is roadmap/WIP for this release; use --dry-run-json for planning only. " +
  "Live review dispatch is supported for codex and claude.";

const UNIT_ADDRESS_PATTERN = /^WK-[0-9]+(#[a-z0-9][a-z0-9-]*)?$/;

export async function runReview(argv, io = {}, { backend: injectedBackend } = {}) {
  if (argv.includes("-h") || argv.includes("--help")) {
    writeLine(io.stdout, HELP_TEXT);
    return;
  }

  const firstPositional = findFirstPositional(argv);

  if (firstPositional === "help") {
    writeLine(io.stdout, HELP_TEXT);
    return;
  }

  if (argv.length === 0 || firstPositional === undefined) {
    writeLine(io.stdout, HELP_TEXT);
    process.exitCode = 2;
    return;
  }

  if (typeof firstPositional === "string" && UNIT_ADDRESS_PATTERN.test(firstPositional)) {
    await dispatchRoleReview(argv, io, { backend: injectedBackend });
    return;
  }

  const { positionals, options } = parseArgs(argv);
  const [instructionPath] = positionals;
  const agent = options.agent ? String(options.agent) : null;
  const result = await reviewHandoff({
    instructionPath,
    agent,
    reviewedAndAcceptRisks: booleanFlag(options, "reviewed-and-accept-risks"),
    allowLegacyImplementationModeHandoffReview: booleanFlag(
      options,
      "allow-legacy-implementation-mode-handoff-review"
    ),
    allowMissingGraphImpactCheckpoint: booleanFlag(
      options,
      "allow-missing-graph-impact-checkpoint"
    )
  });
  console.log(`Created review ${result.reviewId}`);
  console.log(`Token: ${result.tokenPath}`);
}

async function dispatchRoleReview(argv, io, { backend: injectedBackend } = {}) {
  const parsed = parseCanonicalArgs(argv);

  if (parsed.familyDeprecated) {
    writeRaw(io.stderr, `${FAMILY_DEPRECATED_DIAGNOSTIC}\n`);
  }

  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      writeRaw(io.stderr, `agent-launch review: ${error}\n`);
    }
    process.exitCode = 2;
    return;
  }

  if (parsed.app === "agy" && !parsed.dryRunJson) {
    refuseAgyLiveReview(io);
    return;
  }

  if (
    parsed.app === "agy"
    && parsed.dryRunJson
    && parsed.model === null
    && parsed.profileName === null
  ) {
    emitReviewDryRunPlan({
      io,
      parsed,
      resolved: { app: "agy", model: null }
    });
    return;
  }

  let resolution = resolveLauncherProfile({
    role: "review",
    profileName: parsed.profileName,
    app: parsed.app,
    model: parsed.model,
    env: process.env
  });
  if (!resolution.ok && shouldResolveReviewLiveAppWithoutModelHint({ parsed, resolution })) {
    resolution = resolveLauncherProfile({
      role: "review",
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
    emitReviewDryRunPlan({ io, parsed, resolved });
    return;
  }

  if (resolved.app === "agy") {
    refuseAgyLiveReview(io);
    return;
  }

  await dispatchReviewSharedPipeline({ resolved, parsed }, io, { backend: injectedBackend });
}

function shouldResolveReviewLiveAppWithoutModelHint({ parsed, resolution }) {
  return parsed.dryRunJson !== true
    && typeof parsed.app === "string"
    && parsed.app.length > 0
    && typeof parsed.model === "string"
    && parsed.model.length > 0
    && resolution?.error?.path === "model";
}

function emitReviewDryRunPlan({ io, parsed, resolved }) {
  if (parsed.agentBackendOptions.length > 0) {
    const refusal = buildReviewDryRunConfigRefusal({
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
    role: "reviewer",
    subject: typeof parsed.unitAddress === "string" ? parsed.unitAddress : "",
    workspace_dir: process.cwd(),
    app: resolved.app,
    model: resolved.model
  });
  writeLine(io.stdout, JSON.stringify(plan, null, 2));
}

function refuseAgyLiveReview(io) {
  writeStderr(
    io.stderr,
    `agent-launch review: ${AGY_REVIEW_LIVE_REFUSAL_REASON}: ${AGY_REVIEW_LIVE_REFUSAL_MESSAGE}\n`
  );
  process.exitCode = 1;
}

export async function dispatchReviewSharedPipeline({ resolved, parsed }, io, { backend: injectedBackend } = {}) {

  const liveBackend = injectedBackend ?? createCliDispatchBackend({ resolvedProfile: resolved });
  const launch = await liveBackend.startLaunch({
    caller_session_id: generateCliSessionId(),
    role: "reviewer",
    subject: typeof parsed.unitAddress === "string" ? parsed.unitAddress : "",
    workspace_dir: process.cwd(),
    app: resolved.app,
    model: parsed.model ?? null
  });
  if (!launch.accepted) {
    writeRaw(io.stderr, `agent-launch review: dispatch refused: ${launch.refusal?.reason ?? "unknown"}\n`);
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
    writeRaw(io.stderr, "agent-launch review: run status unavailable\n");
    process.exitCode = 1;
    return;
  }
  if (waitResult.timed_out) {
    writeRaw(io.stderr, "agent-launch review: launch timed out waiting for completion\n");
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
      sourceReadMode: CODEX_FAMILY_SOURCE_READ_MODE
    }),
    claude: buildFamilyExecutorRegistryEntry({
      executor: createClaudeWorkspaceAgentLaunchExecutor(),
      sourceReadMode: CLAUDE_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: CLAUDE_FAMILY_NATIVE_READ_CAPABILITY
    }),
    agy: buildFamilyExecutorRegistryEntry({
      executor: createAgyWorkspaceAgentLaunchExecutor(),
      sourceReadMode: AGY_FAMILY_SOURCE_READ_MODE,
      nativeReadCapability: AGY_FAMILY_NATIVE_READ_CAPABILITY
    })
  };
}

function createCliDispatchBackend({ resolvedProfile = null } = {}) {
  return createWorkspaceAgentDispatchBackend({
    launchExecutors: buildCliDispatchLaunchExecutors({ resolvedProfile }),
    prepareSourceToolSurface: createLauncherOwnedSourceToolSurfacePreparer()
  });
}

function generateCliSessionId() {
  return `operator-cli.${randomBytes(8).toString("hex")}`;
}

const CLI_LAUNCH_TIMEOUT_MS = 86400000;
const CLI_POLL_INTERVAL_MS = 1000;

function findFirstPositional(argv) {
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      return argv[index + 1];
    }
    if (!token.startsWith("--")) {
      return token;
    }
    if (
      token === "--family"
      || token === "--profile"
      || token === "--app"
      || token === "--model"
      || token === "--operator-config"
      || token === "--backend-key"
      || token === "--agent"
    ) {
      const next = argv[index + 1];
      if (typeof next === "string" && !next.startsWith("--")) {
        index += 2;
        continue;
      }
    }
    index += 1;
  }
  return undefined;
}

function parseCanonicalArgs(argv) {
  const result = {
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
      if (backendKeyOpt.missing) {
        result.errors.push("--backend-key requires a value");
      } else {
        result.agentBackendOptions.push(["--backend-key", backendKeyOpt.value]);
      }
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

function booleanFlag(options, name) {
  const value = options[name];
  if (value === undefined) {
    return false;
  }
  if (value === true) {
    return true;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return true;
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

function buildReviewDryRunConfigRefusal({ app, model, subject, unsupportedOptions }) {
  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_PLAN_SCHEMA_VERSION,
    dry_run: true,
    accepted: false,
    role: "reviewer",
    app: typeof app === "string" ? app : null,
    subject: typeof subject === "string" ? subject : null,
    model: null,
    workspace_dir: process.cwd(),
    executor_available: false,
    refusal: {
      reason: "review_dry_run_backend_config_unsupported",
      detail: {
        supported_path: "agent-launch review --dry-run-json now uses the shared backend planLaunch contract",
        unsupported_options: unsupportedOptions.map(([flag, value]) => ({
          flag,
          value
        })),
        requested_model: typeof model === "string" && model.length > 0 ? model : null
      }
    }
  };
}

function writeStderr(stream, value) {
  if (stream?.write) {
    stream.write(value);
  } else {
    process.stderr.write(value);
  }
}
