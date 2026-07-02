import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ROLE_GUARD_LAUNCHER_AUTHORITY,
  ROLE_GUARD_SCHEMA_VERSION,
  RoleGuardError,
  buildLauncherContextActionBinding,
  computeActionPayloadHash,
  createLauncherContextNonceStore,
  deriveExpectedReviewedMetadataFromContext,
  evaluateRoleGuardAction,
  formatRoleGuardDecision,
  loadLauncherRoleGuardSecret,
  loadRoleGuardConfig,
  validateTargetPayload,
  verifyLauncherContext
} from "@agent-chassis/agent-launch-core";

const SUBCOMMANDS = new Set(["check-write", "check-diff", "check-command", "explain"]);
const GLOBAL_OPTIONS = new Set([
  "repo-root",
  "config",
  "json",
  "provenance-json",
  "launcher-context",
  "allow-test-fixture",
  "launcher-context-secret-path",
  "launcher-context-nonce-dir"
]);
const SUBCOMMAND_OPTIONS = {
  "check-write": new Set(["path"]),
  "check-diff": new Set(["targets-json"]),
  "check-command": new Set(["targets-json", "execution-proof-json"]),
  explain: new Set()
};

class RoleGuardCliError extends Error {
  constructor(message, code = "cli_error") {
    super(message);
    this.name = "RoleGuardCliError";
    this.code = code;
  }
}

function usage() {
  return [
    "agent-launch role-guard <check-write|check-diff|check-command|explain> [options]",
    "",
    "Checks:",
    "  check-write --path <path> [--path <path> ...] (--provenance-json <path> | --launcher-context <path>)",
    "  check-diff --targets-json <path> (--provenance-json <path> | --launcher-context <path>)",
    "  check-command --execution-proof-json <path> [--targets-json <path>] (--provenance-json <path> | --launcher-context <path>) -- <argv...>",
    "  explain [--json]",
    "",
    "Common options:",
    "  --repo-root <path>       Repository root, defaults to the current directory",
    "  --config <path>          Repo-relative role guard config path",
    "  --json                   Emit stable JSON output",
    "  --launcher-context <path> Verified launcher-authored authority context"
  ].join("\n");
}

function fail(message, code) {
  throw new RoleGuardCliError(message, code);
}

function parseRoleGuardArgs(argv) {
  const dashDashIndex = argv.indexOf("--");
  const optionTokens = dashDashIndex === -1 ? argv : argv.slice(0, dashDashIndex);
  const commandArgv = dashDashIndex === -1 ? [] : argv.slice(dashDashIndex + 1);
  const [subcommand, ...tokens] = optionTokens;

  if (!SUBCOMMANDS.has(subcommand)) {
    fail(`Unknown or missing role-guard subcommand: ${subcommand ?? "<missing>"}`, "subcommand_invalid");
  }

  const options = new Map();
  const allowedOptions = new Set([...GLOBAL_OPTIONS, ...SUBCOMMAND_OPTIONS[subcommand]]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      fail(`Unexpected positional argument: ${token}`, "unexpected_positional");
    }
    const [rawName, inlineValue] = token.slice(2).split("=", 2);
    if (!allowedOptions.has(rawName)) {
      fail(`Unknown option for role-guard ${subcommand}: --${rawName}`, "option_unknown");
    }
    if (rawName === "json" || rawName === "allow-test-fixture") {
      if (inlineValue !== undefined) {
        fail(`--${rawName} does not take a value`, "option_value_invalid");
      }
      addOption(options, rawName, true);
      continue;
    }
    const value = inlineValue ?? tokens[index + 1];
    if (value === undefined || value.startsWith("--")) {
      fail(`--${rawName} requires a value`, "option_value_missing");
    }
    if (inlineValue === undefined) {
      index += 1;
    }
    addOption(options, rawName, value);
  }

  if (dashDashIndex !== -1 && subcommand !== "check-command") {
    fail("-- argv separator is valid only for check-command", "argv_separator_invalid");
  }
  if (subcommand === "check-command" && dashDashIndex === -1) {
    fail("check-command requires -- followed by argv tokens", "command_argv_missing");
  }

  return { subcommand, options, commandArgv };
}

function addOption(options, name, value) {
  const current = options.get(name);
  if (current === undefined) {
    options.set(name, name === "path" ? [value] : value);
    return;
  }
  if (name === "path") {
    current.push(value);
    return;
  }
  fail(`Option may be supplied only once: --${name}`, "option_duplicate");
}

function option(options, name, fallback = undefined) {
  return options.has(name) ? options.get(name) : fallback;
}

function argvRequestsJson(argv) {
  const separatorIndex = argv.indexOf("--");
  const optionTokens = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  return optionTokens.some((token) => token === "--json" || token.startsWith("--json="));
}

async function readJsonPayload(filePath, name) {
  if (!filePath) {
    fail(`${name} is required`, "json_payload_missing");
  }
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail(`${name} file not found: ${filePath}`, "json_payload_missing");
    }
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      fail(`${name} must contain valid JSON`, "json_payload_malformed");
    }
    throw error;
  }
}

function validateCommandArgv(commandArgv) {
  if (!Array.isArray(commandArgv) || commandArgv.length === 0) {
    fail("check-command requires at least one argv token", "command_argv_missing");
  }
  for (const token of commandArgv) {
    if (typeof token !== "string" || token.length === 0) {
      fail("command argv tokens must be non-empty strings", "command_argv_invalid");
    }
    if (/\s/.test(token)) {
      fail("shell-string command payloads are ambiguous; pass argv tokens after --", "command_shell_string_rejected");
    }
  }
}

function assertNoSerializableLauncherAuthority(provenance) {
  assertNoSerializableLauncherAuthorityKeys(provenance, "provenance");
  if (provenance?.caller === "agent_launch") {
    fail("caller agent_launch requires verified launcher context", "launcher_authority_unverified");
  }
  for (const field of ["role", "wk", "operator_write_scope", "session_name"]) {
    const source = provenance?.[field]?.source;
    if (source === "launcher_metadata" || source === "launcher_env") {
      fail(`${field} source ${source} requires verified launcher context`, "launcher_authority_unverified");
    }
  }
}

function assertNoSerializableLauncherAuthorityKeys(value, name) {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoSerializableLauncherAuthorityKeys(entry, `${name}[${index}]`);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "launcher_context_verified" || key === "launcher_capability") {
      fail(`${name}.${key} cannot assert launcher authority through JSON`, "launcher_authority_unverified");
    }
    assertNoSerializableLauncherAuthorityKeys(entry, `${name}.${key}`);
  }
}

function errorEnvelope(error) {
  return {
    schema_version: ROLE_GUARD_SCHEMA_VERSION,
    allowed: false,
    decision_code: error?.code ?? "cli_error",
    category: "denied",
    role: "unknown",
    role_source: "absent",
    action: null,
    config_source: null,
    targets: [],
    reason: error instanceof Error ? error.message : String(error)
  };
}

function explainEnvelope() {
  return {
    schema_version: ROLE_GUARD_SCHEMA_VERSION,
    command: "role-guard",
    launcher_context_supported: true,
    guarded_launcher_operations: [
      "agent-launch review/launch redteam read-only registry enforcement",
      "agent-launch review/launch code_review read-only registry enforcement",
      "agent-launch launch implement subject-to-worker binding",
      "external CLI hooks presenting --launcher-context after launcher-owned verification"
    ],
    hook_only_or_unguarded_surfaces: [
      "Codex hooks until a consuming repo installs a supported adapter",
      "Claude hooks until a consuming repo installs a supported adapter",
      "generic shell commands outside a role-guard wrapper",
      "post-launch model tool calls not observed by a supported hook or adapter"
    ],
    subcommands: ["check-write", "check-diff", "check-command", "explain"],
    input_contract: {
      provenance: "--provenance-json",
      launcher_context: "--launcher-context",
      diff_targets: "--targets-json",
      command_argv: "tokens after --",
      command_execution_proof: "--execution-proof-json"
    }
  };
}

function writeJson(value) {
  console.log(`${JSON.stringify(value, null, 2)}`);
}

function testFixtureFlagEnabled(options) {
  if (!Boolean(option(options, "allow-test-fixture", false))) {
    return false;
  }
  return process.env.NODE_ENV === "test" || process.env.AGENT_ROLE_GUARD_ALLOW_TEST_FIXTURE === "1";
}

function writeTextDecision(decision) {
  const prefix = decision.allowed ? "allowed" : "denied";
  const detail = decision.reason ? `: ${decision.reason}` : "";
  console.log(`${prefix} ${decision.action ?? "role-guard"} ${decision.decision_code}${detail}`);
}

async function buildAction({ subcommand, options, commandArgv }) {
  if (subcommand === "check-write") {
    const paths = option(options, "path", []);
    if (!Array.isArray(paths) || paths.length === 0) {
      fail("check-write requires at least one --path", "targets_missing");
    }
    return { type: "check-write", paths };
  }
  if (subcommand === "check-diff") {
    return {
      type: "check-diff",
      target_payload: await readJsonPayload(option(options, "targets-json"), "--targets-json")
    };
  }
  if (subcommand === "check-command") {
    validateCommandArgv(commandArgv);
    const action = {
      type: "check-command",
      argv: commandArgv,
      execution_proof: await readJsonPayload(option(options, "execution-proof-json"), "--execution-proof-json")
    };
    if (options.has("targets-json")) {
      action.target_payload = await readJsonPayload(option(options, "targets-json"), "--targets-json");
    }
    return action;
  }
  fail(`Unsupported role-guard action: ${subcommand}`, "subcommand_invalid");
}

function normalizeRepoRelativePath(input, name = "path") {
  if (typeof input !== "string" || input.length === 0) {
    fail(`${name} must be a non-empty string`, "path_invalid");
  }
  const slashPath = input.replaceAll("\\", "/");
  if (path.posix.isAbsolute(slashPath)) {
    fail(`${name} must be repo-relative`, "path_absolute_rejected");
  }
  const normalized = path.posix.normalize(slashPath);
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    fail(`${name} must remain inside repo`, "path_outside_repo");
  }
  return normalized;
}

function buildExpectedActionBinding({ action, repoRoot, configPath, role, wk }) {
  if (action.type === "check-write") {
    const normalizedPaths = action.paths.map((entry) => normalizeRepoRelativePath(entry, "check-write path")).sort();
    return buildLauncherContextActionBinding({
      actionType: "check-write",
      repoRoot,
      configPath,
      role,
      wk,
      targetHash: computeActionPayloadHash(normalizedPaths)
    });
  }
  if (action.type === "check-diff") {
    const validated = validateTargetPayload(action.target_payload, { allowTestFixture: true });
    return buildLauncherContextActionBinding({
      actionType: "check-diff",
      repoRoot,
      configPath,
      role,
      wk,
      targetSource: validated.target_source,
      targetHash: computeActionPayloadHash({ target_source: validated.target_source, targets: validated.targets })
    });
  }
  if (action.type === "check-command") {
    const binding = buildLauncherContextActionBinding({
      actionType: "check-command",
      repoRoot,
      configPath,
      role,
      wk,
      rawArgv: action.argv
    });
    if (action.target_payload !== undefined) {
      const validated = validateTargetPayload(action.target_payload, { allowTestFixture: true });
      binding.target_source = validated.target_source;
      binding.target_hash = computeActionPayloadHash({ target_source: validated.target_source, targets: validated.targets });
    }
    return binding;
  }
  fail(`Unsupported launcher-context action type: ${action.type}`, "subcommand_invalid");
}

function launcherProvenanceFromContext({ context, configPath }) {
  const role = context.role_context?.role;
  const wk = context.role_context?.wk ?? null;
  if (typeof role !== "string" || role.length === 0) {
    fail("launcher context role_context.role is required", "launcher_context_invalid");
  }
  return {
    caller: "agent_launch",
    [ROLE_GUARD_LAUNCHER_AUTHORITY]: true,
    role: { value: role, source: "launcher_metadata" },
    wk: wk ? { value: wk, source: "launcher_metadata" } : { value: null, source: "absent" },
    operator_write_scope: { value: null, source: "absent" },
    config: { path: configPath, source: "repo_config" },
    session_name: { value: null, source: "absent", trusted: false }
  };
}

async function loadVerifiedLauncherContext({ options, action, repoRoot, configPath, allowTestFixture }) {
  const contextPath = option(options, "launcher-context");
  const context = await readJsonPayload(contextPath, "--launcher-context");
  const role = context?.role_context?.role;
  const wk = context?.role_context?.wk ?? null;
  if (typeof role !== "string" || role.length === 0) {
    fail("launcher context role_context.role is required", "launcher_context_invalid");
  }
  const expectedActionBinding = buildExpectedActionBinding({
    action,
    repoRoot,
    configPath,
    role,
    wk
  });
  const expectedReviewedMetadata = deriveExpectedReviewedMetadataFromContext(context);
  const secretPathOverride = option(options, "launcher-context-secret-path");
  const nonceDirOverride = option(options, "launcher-context-nonce-dir");
  if ((secretPathOverride !== undefined || nonceDirOverride !== undefined) && !allowTestFixture) {
    fail("launcher context overrides are test-only", "test_fixture_rejected");
  }
  let secret;
  if (secretPathOverride !== undefined) {
    try {
      secret = (await readFile(secretPathOverride, "utf8")).trim();
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new RoleGuardError(
          `launcher role-guard secret missing at ${secretPathOverride}`,
          "launcher_context_secret_missing"
        );
      }
      throw error;
    }
    if (secret.length === 0) {
      throw new RoleGuardError(
        `launcher role-guard secret at ${secretPathOverride} is empty`,
        "launcher_context_secret_missing"
      );
    }
  } else {
    secret = await loadLauncherRoleGuardSecret();
  }
  const nonceStore = await createLauncherContextNonceStore(
    nonceDirOverride !== undefined ? { dir: nonceDirOverride } : {}
  );
  await verifyLauncherContext({
    context,
    secret,
    expectedReviewedMetadata,
    expectedActionBinding,
    nonceStore
  });
  return context;
}

export async function runRoleGuard(argv) {
  const wantsJson = argvRequestsJson(argv);
  try {
    const { subcommand, options, commandArgv } = parseRoleGuardArgs(argv);
    if (subcommand === "explain") {
      if (wantsJson) {
        writeJson(explainEnvelope());
      } else {
        console.log(usage());
      }
      return;
    }

    const repoRoot = option(options, "repo-root", process.cwd());
    const configPath = option(options, "config", ".agent-role-guard.json");
    const allowTestFixture = testFixtureFlagEnabled(options);
    const config = await loadRoleGuardConfig({ repoRoot, configPath });
    const action = await buildAction({ subcommand, options, commandArgv });

    let provenance;
    if (options.has("launcher-context")) {
      if (options.has("provenance-json")) {
        fail("--launcher-context and --provenance-json are mutually exclusive", "option_conflict");
      }
      const verifiedContext = await loadVerifiedLauncherContext({
        options,
        action,
        repoRoot,
        configPath,
        allowTestFixture
      });
      provenance = launcherProvenanceFromContext({ context: verifiedContext, configPath });
    } else {
      provenance = await readJsonPayload(option(options, "provenance-json"), "--provenance-json");
      assertNoSerializableLauncherAuthority(provenance);
    }

    const decision = await evaluateRoleGuardAction({
      repoRoot,
      config,
      provenance,
      action,
      allowTestFixture
    });
    const formatted = formatRoleGuardDecision({
      ...decision,
      config_source: configPath
    });

    if (wantsJson) {
      writeJson(formatted);
    } else {
      writeTextDecision(formatted);
    }
    if (!formatted.allowed) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (wantsJson) {
      writeJson(errorEnvelope(error));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
