import { routeOrchestratorLaunch } from "../lib/orchestrator-launch-dispatch.mjs";
import {
  runCodexOrchestratorList
} from "../lib/codex-role-orchestrator-history.mjs";
import {
  FAMILY_DEPRECATED_DIAGNOSTIC,
  resolveLauncherProfile
} from "../lib/agent-launch-profiles.mjs";
import {
  AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
  enforceOrchestratorOperatorOnly,
  refuseCallerSuppliedIdentityFields
} from "@agent-chassis/wiki-core/src/lib/agent-dispatch-identity.mjs";

const ORCHESTRATOR_IDENTITY_CARRIER_ENV_KEYS = Object.freeze([
  "AGENT_ROLE",
  "AGENT_WK",
  "AGENT_OPERATOR_WRITE_SCOPE"
]);

function snapshotOrchestratorIdentityProbe(env) {
  const probe = {};
  if (env && typeof env === "object") {
    const envCarriers = {};
    for (const key of ORCHESTRATOR_IDENTITY_CARRIER_ENV_KEYS) {
      if (Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined) {
        envCarriers[key] = env[key];
      }
    }
    if (Object.keys(envCarriers).length > 0) {
      probe.env = envCarriers;
    }
  }
  return probe;
}

function evaluateOrchestratorIdentity(env) {
  const callerRefusal = refuseCallerSuppliedIdentityFields(
    snapshotOrchestratorIdentityProbe(env)
  );
  if (callerRefusal) {
    return callerRefusal;
  }

  return enforceOrchestratorOperatorOnly({
    schema_version: AGENT_DISPATCH_IDENTITY_SCHEMA_VERSION,
    accepted: true,
    role_kind: "human_operator",
    trust_source: "launcher_minted",
    mint_evidence: null
  });
}

export { ORCHESTRATOR_AGY_UNSUPPORTED_REASON } from "../lib/orchestrator-launch-dispatch.mjs";

const HELP_TEXT = `agent-launch orchestrator <IN-####> [options] [focus...]
agent-launch orchestrator list [--json]

Canonical initiative-orchestrator dispatch. The canonical option grammar is
\`agent-launch orchestrator <IN-####> [--model <model>] [--effort <effort>]\`.
The model may also be supplied by ORCHESTRATOR_MODEL. The launcher derives the
app/family from the model registry; \`--app\` remains a compatibility override.

Codex orchestrator profiles route through codex-role's buildOrchestratorPlan,
which owns repo-disambiguated thread naming ("IN-#### orchestrator (<repo>)"),
runtime directory minting under $XDG_STATE_HOME/codex-orch/<repo_key>/<IN-####>,
meta.env emission, the narrow orchestrator permissions profile, and the
AGENT_ROLE=orchestrator / AGENT_IN env binding for the child Codex session.
The \`orchestrator_claude\` profile routes through the launcher-owned Claude
planner and host-server conduit.

Options:
  --profile <profile>    Canonical launcher profile (default: orchestrator;
                         orchestrator_xhigh for xhigh dispatch)
  --app codex|claude     Override the profile's default app binding
  --model <model>        Override the selected binding's default model
  --effort <effort>      Neutral effort flag; xhigh selects orchestrator_xhigh
  --dry-run-json         Emit the launch plan without spawning
  --headless             Run the orchestrator non-interactively to completion
                         and exit (Claude --print / Codex exec), instead of the
                         interactive TUI
  --log-file <path>      Operator override for the launcher-owned headless log
                         target (meaningful only with --headless)

Set CODEX_ORCH_THREAD_NAME=... to override the default repo-disambiguated
thread name.
`;

export async function runOrchestrator(argv, io = {}) {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") {
    writeLine(io.stdout, HELP_TEXT);
    if (argv.length === 0) {
      process.exitCode = 2;
    }
    return;
  }
  if (argv[0] === "list") {
    await runCodexOrchestratorList(argv.slice(1), io);
    return;
  }
  await dispatchOrchestrator({ argv, role: "orch" }, io);
}

export async function dispatchOrchestrator({ argv, role }, io) {
  const parsed = parseCanonicalArgs(argv);

  if (parsed.familyDeprecated) {
    writeRaw(io.stderr, `${FAMILY_DEPRECATED_DIAGNOSTIC}\n`);
  }

  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      writeRaw(io.stderr, `agent-launch orchestrator: ${error}\n`);
    }
    process.exitCode = 2;
    return;
  }

  const orchestratorIdentityRefusal = evaluateOrchestratorIdentity(process.env);
  if (orchestratorIdentityRefusal) {
    writeRaw(
      io.stderr,
      `agent-launch orchestrator: ${orchestratorIdentityRefusal.refusal_message ?? "orchestrator launch is human/operator-only"} (${orchestratorIdentityRefusal.refusal_code})\n`
    );
    process.exitCode = 2;
    return;
  }

  const resolution = resolveOrchestratorCommandProfile({
    parsed,
    role,
    env: process.env,
    cwd: process.cwd()
  });
  if (!resolution.ok) {
    writeRaw(io.stderr, `${resolution.error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const resolved = resolution.value;

  await routeOrchestratorLaunch({
    role,
    resolved,
    initiative: parsed.initiative,
    focusArgs: parsed.focusArgs,
    dryRunJson: parsed.dryRunJson,
    headless: parsed.headless,
    logFile: parsed.logFile,
    env: process.env,
    cwd: process.cwd(),
    io
  });
}

export function resolveOrchestratorCommandProfile({ parsed, role, env = process.env, cwd = process.cwd() }) {
  const launcherRole = role === "orch-resume" ? "resume" : "orchestrator";
  const envModel = readOrchestratorModelEnv(env);
  return resolveLauncherProfile({
    role: launcherRole,
    profileName: parsed.profileName,
    app: parsed.app,
    model: parsed.model ?? envModel,
    env,
    dir: cwd
  });
}

function readOrchestratorModelEnv(env) {
  if (!env || typeof env !== "object") {
    return null;
  }
  const value = env.ORCHESTRATOR_MODEL;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseCanonicalArgs(argv) {
  const result = {
    profileName: null,
    app: null,
    model: null,
    effort: null,
    familyDeprecated: false,
    initiative: null,
    focusArgs: [],
    dryRunJson: false,
    headless: false,
    logFile: null,
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
        result.errors.push("--app requires a value (codex|claude)");
      } else {
        assignApp(result, appOpt.value, "--app");
      }
      index += appOpt.consumed;
      continue;
    }
    const familyOpt = consumeOption(argv, index, "family");
    if (familyOpt) {
      if (familyOpt.missing) {
        result.errors.push("--family requires a value (codex|claude)");
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
    const effortOpt = consumeOption(argv, index, "effort");
    if (effortOpt) {
      if (effortOpt.missing) {
        result.errors.push("--effort requires a value (low|medium|high|xhigh|max)");
      } else {
        assignEffort(result, effortOpt.value);
      }
      index += effortOpt.consumed;
      continue;
    }
    if (token === "--dry-run-json") {
      result.dryRunJson = true;
      index += 1;
      continue;
    }
    if (token === "--headless") {
      result.headless = true;
      index += 1;
      continue;
    }
    const logFileOpt = consumeOption(argv, index, "log-file");
    if (logFileOpt) {
      if (logFileOpt.missing) {
        result.errors.push("--log-file requires a value");
      } else {
        result.logFile = logFileOpt.value;
      }
      index += logFileOpt.consumed;
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
    result.initiative = value;
  } else {
    result.focusArgs.push(value);
  }
}

function assignApp(result, value, source) {
  if (result.app !== null && result.app !== value) {
    result.errors.push(`app already set to ${result.app}; ${source} would override to ${value}`);
    return;
  }
  result.app = value;
}

function assignEffort(result, value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!["low", "medium", "high", "xhigh", "max"].includes(normalized)) {
    result.errors.push(`unknown effort ${JSON.stringify(value)}; expected low|medium|high|xhigh|max`);
    return;
  }
  result.effort = normalized;
  if (normalized === "xhigh") {
    result.profileName = "orchestrator_xhigh";
  }
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
