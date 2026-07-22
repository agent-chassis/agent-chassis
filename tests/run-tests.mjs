#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const TEST_TEMP_PARENT = "/tmp";

const DEFAULT_TEST_TIMEOUT_MS = 30000;

export const INTEGRATION_MARKERS = [
  /claude-worker/,
  /codex-worker/,
  /gemini-worker/,
  /bin\/agent-launch/,
  /WORKER_BIN/,
  /\bbwrap\b/,
  /fixtures\/agent-launch\/harness/,
  /runClaudeWorker|runCodexWorker/,
  /\bspawnSync\b/,
  /family-runtime/,
  /host-write-authority-substrate/,
  /\.local\/share\/claude/,
  /probeClaudeRuntime/,

  /\b(?:validateTemporal\w*|TemporalWorkflow\w*|temporalWrapperDryRun|deriveDryRunExecutionId|createTemporalWorkflowState|runTemporalWorkflowAttempt|recordTemporalWorkflowOperatorDecision|applyTemporalWorkflowRunnerEvent)\b/,
  /from\s+["'](?:\.\.\/packages\/agent-launch-core\/src\/(?:lib\/temporal-|operations\/temporal-wrapper-dry-run)|\.\.\/packages\/agent-launch-temporal-worker\/|\.\.\/deploy\/agent-launch-temporal-worker\/|\.\/temporal-)/
];

export function classifyTestSource(sourceText) {
  const source = typeof sourceText === "string" ? sourceText : "";
  return INTEGRATION_MARKERS.some((re) => re.test(source))
    ? "integration"
    : "unit";
}

const INTEGRATION_FILE_PREFIXES = ["interface-smoke"];
const INTEGRATION_FILE_NAMES = new Set([

  "publish-smoke.test.mjs",
  "work-record-write-cas-process.test.mjs",
  "mcp-startup-regression.test.mjs",
  "filesystem-mcp-backend-spawn-stdout.test.mjs",
  "wiki-mcp-tool-discovery-workspace-resolution.test.mjs",
  "wiki-mcp-tool-discovery-descriptor-parity.test.mjs",
  "work-record-admission-mcp-compact.test.mjs",

  "agent-launch-initiative.test.mjs",
  "agent-launch-isolation-home-writable-files.test.mjs",
  "agent-launch-isolation-input-validation.test.mjs",
  "core-package-artifact-smoke.test.mjs",
  "roadmap-eligibility-audit.test.mjs",
  "wiki-adoption-verify.test.mjs",
  "wiki-bootstrap-adoption-cache.test.mjs",
  "wiki-cli-entrypoint.test.mjs",
  "work-record-write-lock-recovery.test.mjs",

  "code-index-context-ergonomics.test.mjs",
  "code-index-context-mcp-ergonomics.test.mjs",
  "dispatch-tools-ergonomics.test.mjs",
  "work-record-dispatch-node-engine-operation-mcp-forwarding.test.mjs",
  "work-record-graph-impact-dirty-safe.test.mjs",
  "work-record-graph-impact-generate.test.mjs",
  "wiki-core-sidecar-build.test.mjs",
  "wiki-core-sidecar-diff-context.test.mjs",
  "wiki-core-sidecar-impact.test.mjs",
  "wiki-core-sidecar-impact-extractors.test.mjs",
  "wiki-core-sidecar-impact-path-state.test.mjs",
  "wiki-core-sidecar-impact-rebuild.test.mjs",
  "wiki-core-sidecar-impact-selection.test.mjs",
  "wiki-core-sidecar-impact-summary.test.mjs",
  "wiki-core-sidecar-scip.test.mjs",
  "wiki-core-sidecar-status-paths.test.mjs",
  "wiki-core-sidecar-validation.test.mjs",

  "in0012-deepswe-agent-chassis-execute.test.mjs",
  "in0012-sweatlas-refactor-smoke-known-easy.test.mjs",
  "in0012-sweatlas-refactor-smoke-review-fix3.test.mjs",
  "in0012-sweatlas-refactor-smoke-review-fix4.test.mjs",
  "in0012-sweatlas-refactor-smoke-run-one.test.mjs",
  "in0012-swebench-pro-smoke-review-fixes.test.mjs",
  "in0012-swebench-pro-smoke-run-one.test.mjs",
  "in0012-swebench-smoke-container.test.mjs",
  "in0012-swebench-smoke-failure-classification.test.mjs",
  "in0012-swebench-smoke-harness-snapshot.test.mjs",
  "in0012-swebench-smoke-packaging.test.mjs",
  "in0012-swebench-smoke-plan-orchestrator.test.mjs",
  "in0012-swebench-smoke-score-resolver.test.mjs",
  "in0012-swebench-smoke-scoring.test.mjs",
]);

export function isDeclaredIntegration(name) {
  return INTEGRATION_FILE_PREFIXES.some((p) => name.startsWith(p))
    || INTEGRATION_FILE_NAMES.has(name);
}

const CREDENTIAL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY"
];

const AGENT_IDENTITY_ENV_KEYS = [
  "AGENT_ROLE",
  "AGENT_WK",
  "AGENT_OPERATOR_WRITE_SCOPE",
  "AGENT_IN",
  "AGENT_SUBJECT"
];

function classify() {
  const files = readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  const unit = [];
  const integration = [];
  for (const name of files) {
    const source = readFileSync(path.join(TESTS_DIR, name), "utf8");
    const category =
      isDeclaredIntegration(name) || classifyTestSource(source) === "integration"
        ? "integration"
        : "unit";
    (category === "integration" ? integration : unit).push(
      path.join("tests", name)
    );
  }
  return { unit, integration };
}

function buildClampedEnv(scratchHome, scratchTemp) {
  const env = { ...process.env };

  env.HOME = scratchHome;
  env.XDG_CONFIG_HOME = path.join(scratchHome, ".config");
  env.XDG_STATE_HOME = path.join(scratchHome, ".local", "state");
  env.XDG_DATA_HOME = path.join(scratchHome, ".local", "share");
  env.XDG_CACHE_HOME = path.join(scratchHome, ".cache");
  env.TMPDIR = scratchTemp;
  env.TMP = scratchTemp;
  env.TEMP = scratchTemp;
  for (const dir of [
    env.XDG_CONFIG_HOME,
    env.XDG_STATE_HOME,
    env.XDG_DATA_HOME,
    env.XDG_CACHE_HOME
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const key of [...CREDENTIAL_ENV_KEYS, ...AGENT_IDENTITY_ENV_KEYS]) {
    delete env[key];
  }

  env.PORTFOLIO_WIKI_TOOLS_HERMETIC_TESTS = "1";
  return env;
}

function main() {

  process.stdout.on("error", (err) => {
    if (err && err.code === "EPIPE") process.exit(0);
  });

  const argv = process.argv.slice(2);
  const mode = argv[0] && !argv[0].startsWith("-") && !argv[0].includes(path.sep)
    ? argv[0]
    : "unit";
  const passthrough = mode === argv[0] ? argv.slice(1) : argv;

  const { unit, integration } = classify();

  if (mode === "list") {
    process.stdout.write(`unit (${unit.length}):\n`);
    for (const f of unit) process.stdout.write(`  ${f}\n`);
    process.stdout.write(`\nintegration (${integration.length}):\n`);
    for (const f of integration) process.stdout.write(`  ${f}\n`);
    return;
  }

  let files;
  if (mode === "unit") files = unit;
  else if (mode === "integration") files = integration;
  else if (mode === "all") files = [...unit, ...integration].sort();
  else {
    process.stderr.write(
      `unknown mode "${mode}"; expected unit | integration | all | list\n`
    );
    process.exit(2);
  }

  const explicitFiles = passthrough.filter(
    (a) => !a.startsWith("-") && a.endsWith(".test.mjs")
  );
  const flags = passthrough.filter((a) => a.startsWith("-"));
  const targetFiles = explicitFiles.length > 0 ? explicitFiles : files;

  const scratchHome = mkdtempSync(
    path.join(TEST_TEMP_PARENT, "agent-chassis-hermetic-home-")
  );
  const scratchTemp = mkdtempSync(
    path.join(TEST_TEMP_PARENT, "agent-chassis-test-tmp-")
  );
  const cleanup = () => {
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {

    }
    try {
      rmSync(scratchHome, { recursive: true, force: true });
    } catch {

    }
  };

  const hasTimeoutFlag = flags.some((f) => f.startsWith("--test-timeout"));
  const nodeArgs = [
    "--test",
    ...(hasTimeoutFlag ? [] : [`--test-timeout=${DEFAULT_TEST_TIMEOUT_MS}`]),
    ...flags,
    ...targetFiles
  ];

  process.stderr.write(
    `[run-tests] mode=${mode} files=${targetFiles.length} ` +
      `HOME=${scratchHome} TMPDIR=${scratchTemp} ` +
      `timeout=${DEFAULT_TEST_TIMEOUT_MS}ms\n`
  );

  const child = spawn(process.execPath, nodeArgs, {
    cwd: REPO_ROOT,
    env: buildClampedEnv(scratchHome, scratchTemp),
    stdio: "inherit"
  });

  const forward = (sig) => {
    try {
      child.kill(sig);
    } catch {

    }
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  child.on("exit", (code, signal) => {
    cleanup();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
  child.on("error", (err) => {
    cleanup();
    process.stderr.write(`[run-tests] failed to spawn node --test: ${err.message}\n`);
    process.exit(1);
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isDirectRun = invokedPath === fileURLToPath(import.meta.url);
if (isDirectRun) main();
