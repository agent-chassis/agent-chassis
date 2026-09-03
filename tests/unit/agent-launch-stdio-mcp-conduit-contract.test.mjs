

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
  STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS,
  STDIO_MCP_CLIENT_READINESS_TIMEOUT_SEC,
  STDIO_MCP_CLEANUP_BLOCKER_REASON,
  STDIO_MCP_CLIENT_TO_SERVER_PATH,
  STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
  STDIO_MCP_CONDUIT_ERROR_CODES,
  STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON,
  STDIO_MCP_CONDUIT_TERMINAL_PROBE_SCHEMA_VERSION,
  readStdioMcpConduitTerminalFailure,
  STDIO_MCP_RELAY_ARGS,
  STDIO_MCP_RELAY_COMMAND,
  STDIO_MCP_SERVER_STARTUP_TIMEOUT_MS,
  STDIO_MCP_SERVER_TO_CLIENT_PATH,
  assertTrustedStdioMcpConduitBinding,
  attachStdioMcpConduitLaunchOutcome,
  describeStdioMcpConduitLaunchFailure,
  resolveConduitChildStdio
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs";
import {
  createStdioMcpConduitLocalBacking,
  createStdioMcpConduitLocalChannel
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-channel.mjs";
import {
  STDIO_MCP_CONDUIT_AUTHORITY_MODES,
  STDIO_MCP_FROZEN_REVIEW_CONTRACT_PATH_CLASS,
  assertTrustedStdioMcpConduitAuthority,
  isTrustedStdioMcpConduitAuthority,
  mintTrustedStdioMcpConduitAuthority
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import { createTrustedFrozenReviewContract } from
  "../../packages/agent-launch-cli/src/lib/backend-review-identity.mjs";
import {
  createFrozenReviewContractSnapshot
} from "../../packages/agent-launch-cli/src/lib/frozen-review-contract-snapshot.mjs";
import {
  buildClaudeStdioMcpRegistrationArgs,
  createStdioMcpRelayRegistration
} from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit.mjs";
import { buildCodexStdioMcpRegistrationOverrides } from
  "../../packages/agent-launch-cli/src/lib/codex-conduit-binding.mjs";
import { __testing } from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-core.mjs";
import {
  CLAUDE_COMMAND_LINE_CONTRACT_SCHEMA_VERSION,
  CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON,
  composeClaudeArgv,
  defaultBuildClaudeCommandLine,
  verifyClaudeArgvPromptContract
} from "../../packages/agent-launch-cli/src/lib/workspace-agent-claude-launch-support.mjs";
import { resolveLauncherRoleToolNames } from
  "../../packages/agent-launch-cli/src/lib/launcher-role-tool-profile.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function forgedBinding(overrides = {}) {
  return Object.freeze({
    schemaVersion: STDIO_MCP_CONDUIT_BINDING_SCHEMA_VERSION,
    runId: "forged", family: "codex", role: "reviewer", fifoCount: 2,
    pathFds: Object.freeze([0, 1]),
    bindTargets: Object.freeze([STDIO_MCP_CLIENT_TO_SERVER_PATH, STDIO_MCP_SERVER_TO_CLIENT_PATH]),
    relay: Object.freeze({ command: STDIO_MCP_RELAY_COMMAND, args: STDIO_MCP_RELAY_ARGS }),
    ...overrides
  });
}

function producedBinding(bindingState = {}) {
  return createStdioMcpConduitLocalChannel({
    identifier: "produced",
    family: "codex",
    role: "reviewer",
    backing: createStdioMcpConduitLocalBacking("/tmp/stdio-mcp-contract"),
    lifecycleCapability: {
      bindingState,
      markClientProcessTerminal() {}
    }
  });
}

test("WK-1678: the relay is one frozen path-based copy-only invocation", () => {
  const registration = createStdioMcpRelayRegistration();
  assert.equal(registration.command, STDIO_MCP_RELAY_COMMAND);
  assert.deepEqual(registration.args, STDIO_MCP_RELAY_ARGS);
  assert.match(registration.args[1], /client-to-server/);
  assert.match(registration.args[1], /server-to-client/);

  assert.doesNotMatch(registration.args[1], /(?:fd3|fd4|127\.0\.0\.1|localhost|socket|tcp|udp|http|ws:|nc\b)/i);
  assert.equal(Object.isFrozen(registration), true);
  assert.equal(Object.isFrozen(registration.args), true);
});

test("WK-1678: the two lifecycle budgets are separate launcher-owned constants", () => {

  assert.equal(Number.isInteger(STDIO_MCP_SERVER_STARTUP_TIMEOUT_MS), true);
  assert.equal(Number.isInteger(STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS), true);
  assert.notEqual(STDIO_MCP_SERVER_STARTUP_TIMEOUT_MS, STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS);

  assert.ok(STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS > STDIO_MCP_SERVER_STARTUP_TIMEOUT_MS);
  assert.equal(STDIO_MCP_CLIENT_READINESS_TIMEOUT_SEC, 180);
  assert.equal(
    STDIO_MCP_CLIENT_READINESS_TIMEOUT_SEC,
    STDIO_MCP_CLIENT_READINESS_TIMEOUT_MS / 1_000
  );
});

test("WK-1678: a forged or consumed binding is refused by the plan contract", () => {
  assert.throws(() => assertTrustedStdioMcpConduitBinding(forgedBinding()),
    (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID);
  assert.throws(() => assertTrustedStdioMcpConduitBinding(null),
    (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID);
  assert.throws(() => assertTrustedStdioMcpConduitBinding({ ...forgedBinding() }),
    (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID);

  const consumed = producedBinding({ namespaceReady: true });
  assert.throws(() => assertTrustedStdioMcpConduitBinding(consumed),
    (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.BINDING_CONSUMED);
  const cleaned = producedBinding({ cleaned: true });
  assert.throws(() => assertTrustedStdioMcpConduitBinding(cleaned),
    (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.BINDING_CONSUMED);

  for (const override of [
    { relay: Object.freeze({ command: "/bin/nc", args: STDIO_MCP_RELAY_ARGS }) },
    { relay: Object.freeze({ command: STDIO_MCP_RELAY_COMMAND, args: Object.freeze(["-c", "cat"]) }) },
    { bindTargets: Object.freeze(["/tmp/a", "/tmp/b"]) },
    { fifoCount: 3 },
    { family: "agy" }
  ]) {
    const tampered = forgedBinding(override);
    assert.throws(() => assertTrustedStdioMcpConduitBinding(tampered),
      (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID);
  }
});

test("WK-1678: registration builders refuse a cross-family or untrusted binding", () => {
  assert.throws(() => buildCodexStdioMcpRegistrationOverrides(forgedBinding()),
    (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID);
  assert.throws(() => buildClaudeStdioMcpRegistrationArgs(forgedBinding(), []),
    (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID);
});

test("WK-1678: conduit stdio preserves supported shapes exactly", () => {
  const binding = { pathFds: [11, 12] };
  assert.deepEqual(resolveConduitChildStdio(binding, undefined),
    ["inherit", "inherit", "inherit", 11, 12]);
  assert.deepEqual(resolveConduitChildStdio(binding, null),
    ["inherit", "inherit", "inherit", 11, 12]);
  for (const shorthand of ["ignore", "inherit", "pipe", "overlapped"]) {
    assert.deepEqual(resolveConduitChildStdio(binding, shorthand),
      [shorthand, shorthand, shorthand, 11, 12],
      `shorthand ${shorthand} must be preserved, not rewritten`);
  }
  assert.deepEqual(resolveConduitChildStdio(binding, ["ignore", "pipe", "pipe"]),
    ["ignore", "pipe", "pipe", 11, 12]);
  assert.deepEqual(resolveConduitChildStdio(binding, ["pipe", "pipe", "pipe", "ignore"]),
    ["pipe", "pipe", "pipe", 11, 12]);

  assert.deepEqual(resolveConduitChildStdio(binding, [0, 1, 2]), [0, 1, 2, 11, 12]);
});

test("WK-1678: conduit stdio refuses unsupported shapes instead of substituting inherit", () => {
  const binding = { pathFds: [11, 12] };
  const unsupported = [
    "pipes", "PIPE", "", "inherit-all", 7, true, {}, () => {},
    ["pipe", "pipe"], [], ["pipe"],
    ["pipe", "pipe", "pipe", "pipe"],
    ["pipe", "pipe", "pipe", "ignore", "pipe"],
    ["pipe", "pipe", "pipe", "ignore", "ignore", "ignore"],
    [null, "pipe", "pipe"],
    ["bogus", "pipe", "pipe"]
  ];
  for (const requested of unsupported) {
    assert.throws(() => resolveConduitChildStdio(binding, requested),
      (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.STDIO_SHAPE_UNSUPPORTED,
      `expected typed refusal for ${JSON.stringify(requested) ?? String(requested)}`);
  }
});

test("WK-1678: tool-surface comparison catches missing, extra, and duplicate names", () => {
  const { compareToolSurfaces } = __testing;
  assert.equal(compareToolSurfaces(["commit"], ["commit"]), null);
  assert.equal(compareToolSurfaces(["a", "b"], ["b", "a"]), null, "order is not significant");
  assert.deepEqual(compareToolSurfaces(["a", "b"], ["a"]).missing, ["b"]);
  assert.deepEqual(compareToolSurfaces(["a"], ["a", "b"]).unexpected, ["b"]);
  assert.deepEqual(compareToolSurfaces(["a"], ["a", "a"]).duplicates, ["a"]);
  assert.deepEqual(compareToolSurfaces(["a"], []).missing, ["a"]);
  assert.notEqual(compareToolSurfaces(["commit"], ["workspace_read_page"]), null);
});

test("WK-1678: the resource scope disposes LIFO, once, and survives failing disposers", async () => {
  const { ConduitResourceScope } = __testing;
  const order = [];
  const scope = new ConduitResourceScope();
  scope.acquire("first", () => "a", (value) => order.push(`dispose:${value}`));
  scope.acquire("second", () => "b", (value) => order.push(`dispose:${value}`));
  scope.acquire("third", () => "c", (value) => order.push(`dispose:${value}`));
  assert.deepEqual(await scope.dispose(), []);
  assert.deepEqual(order, ["dispose:c", "dispose:b", "dispose:a"], "LIFO");

  assert.deepEqual(await scope.dispose(), []);
  assert.deepEqual(order, ["dispose:c", "dispose:b", "dispose:a"]);
  assert.equal(scope.disposed, true);
});

test("WK-1678: a failing disposer never blocks the remaining resources", async () => {
  const { ConduitResourceScope } = __testing;
  const released = [];
  const scope = new ConduitResourceScope();
  scope.acquire("outer", () => 1, () => released.push("outer"));
  scope.acquire("broken", () => 2, () => { throw new Error("boom"); });
  scope.acquire("inner", () => 3, () => released.push("inner"));
  const failures = await scope.dispose();
  assert.deepEqual(released, ["inner", "outer"], "both healthy resources still released");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].resource, "broken");
  assert.equal(failures[0].message, "boom");
});

test("WK-1678: an acquisition that throws registers nothing", async () => {
  const { ConduitResourceScope } = __testing;
  const scope = new ConduitResourceScope();
  let disposed = 0;
  assert.throws(() => scope.acquire("never", () => { throw new Error("acquire failed"); },
    () => { disposed += 1; }));
  assert.deepEqual(await scope.dispose(), []);
  assert.equal(disposed, 0, "a resource that was never acquired is never disposed");
});

test("WK-1678: release hands off one resource without double-disposing it", async () => {
  const { ConduitResourceScope } = __testing;
  const disposals = [];
  const scope = new ConduitResourceScope();
  scope.acquire("kept", () => "k", (value) => disposals.push(value));
  scope.acquire("handed-off", () => "h", (value) => disposals.push(value));
  scope.release("handed-off");
  assert.deepEqual(disposals, ["h"]);
  await scope.dispose();
  assert.deepEqual(disposals, ["h", "k"], "the released resource is not disposed twice");
  scope.release("handed-off");
  assert.deepEqual(disposals, ["h", "k"], "releasing an unknown label is a no-op");
});

test("WK-1678: a retained readiness failure becomes a stable dispatch blocker", async () => {
  const readinessFailure = Object.assign(new Error("client never initialized"), {
    code: STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT,
    detail: { timeout_ms: 180_000 }
  });
  const conduit = { runId: "run-1", readinessFailure, cleanupFailure: null };
  const described = describeStdioMcpConduitLaunchFailure(conduit);
  assert.equal(described.reason, STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON);
  assert.equal(described.detail.conduit_error_code,
    STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT);
  assert.equal(described.detail.unenforced_fallback_permitted, false);
  assert.equal(described.detail.run_id, "run-1");

  const supervised = { probe: async () => ({ status: "killed", exit: { signal: "SIGKILL" } }) };
  const wrapped = attachStdioMcpConduitLaunchOutcome(supervised, conduit,
    () => ({ refusal: "must-not-happen" }));
  const projected = await wrapped.probe();
  assert.equal(projected.schema_version, STDIO_MCP_CONDUIT_TERMINAL_PROBE_SCHEMA_VERSION);
  assert.equal(projected.status, "failed");
  assert.equal(projected.terminal, true);
  assert.equal(projected.refusal, undefined, "a lifecycle probe never carries an admission refusal");
  assert.equal(projected.accepted, undefined);
  assert.deepEqual(projected.exit, { signal: "SIGKILL" });
  assert.equal(readStdioMcpConduitTerminalFailure(projected).reason,
    STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON);
  assert.equal(readStdioMcpConduitTerminalFailure(projected).detail.conduit_error_code,
    STDIO_MCP_CONDUIT_ERROR_CODES.CLIENT_READINESS_TIMEOUT);
  assert.equal(readStdioMcpConduitTerminalFailure({ status: "failed" }), null,
    "an ordinary probe is not misread as a conduit failure");

  assert.equal(
    describeStdioMcpConduitLaunchFailure({ readinessFailure: null, cleanupFailure: null }), null);
  assert.equal(describeStdioMcpConduitLaunchFailure(
    { readinessFailure: null, cleanupFailure: Object.assign(new Error("x"), { code: "c" }) }).reason,
  STDIO_MCP_CLEANUP_BLOCKER_REASON);
  const healthy = attachStdioMcpConduitLaunchOutcome(
    { probe: async () => ({ status: "ok" }) },
    { readinessFailure: null, cleanupFailure: null },
    () => ({ refusal: "must-not-happen" }));
  assert.deepEqual(await healthy.probe(), { status: "ok" });
});

test("WK-1689#SLICE-002: a failed conduit terminalizes even when the inner probe is still non-terminal", async () => {
  const conduit = {
    runId: "r",
    readinessFailure: Object.assign(new Error("late"), { code: "x" }),
    cleanupFailure: null
  };
  const wrapped = attachStdioMcpConduitLaunchOutcome({ probe: async () => null }, conduit);
  const projected = await wrapped.probe();
  assert.equal(projected.status, "failed");
  assert.equal(projected.terminal, true);
  assert.equal(projected.final_result, null);
  assert.equal(readStdioMcpConduitTerminalFailure(projected).reason,
    STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON);

  const healthy = attachStdioMcpConduitLaunchOutcome(
    { probe: async () => null }, { readinessFailure: null, cleanupFailure: null });
  assert.equal(await healthy.probe(), null, "a healthy conduit still passes a non-terminal probe through");
});

test("WK-1689#SLICE-002: the terminal projection awaits one cleanup settlement and preserves child evidence", async () => {
  let settlements = 0;
  const conduit = {
    runId: "run-2",
    readinessFailure: Object.assign(new Error("gone"), { code: "y" }),
    cleanupFailure: null,
    settleCleanup: async () => { settlements += 1; return null; }
  };
  const wrapped = attachStdioMcpConduitLaunchOutcome(
    { probe: async () => ({ status: "failed", exit: { code: 1, signal: null }, final_result: { kind: "x" } }) },
    conduit
  );
  const [first, second] = await Promise.all([wrapped.probe(), wrapped.probe()]);

  assert.equal(settlements, 1, "concurrent probes coalesce on one terminal publication");
  for (const projected of [first, second]) {
    assert.equal(projected.status, "failed");
    assert.deepEqual(projected.exit, { code: 1, signal: null });
    assert.deepEqual(projected.final_result, { kind: "x" }, "child final-result evidence is preserved");
  }
});

test("WK-1689#SLICE-002: a cleanup-only failure discovered during settlement is published terminally", async () => {
  const conduit = {
    runId: "run-3",
    readinessFailure: null,
    cleanupFailure: null,
    settleCleanup: async () => {
      conduit.cleanupFailure = Object.assign(new Error("rmdir failed"), { code: "c" });
      return conduit.cleanupFailure;
    }
  };

  conduit.cleanupFailure = Object.assign(new Error("pre"), { code: "pre" });
  const wrapped = attachStdioMcpConduitLaunchOutcome(
    { probe: async () => ({ status: "succeeded", exit: { code: 0, signal: null } }) }, conduit);
  const projected = await wrapped.probe();
  assert.equal(projected.status, "failed");
  assert.equal(readStdioMcpConduitTerminalFailure(projected).reason, STDIO_MCP_CLEANUP_BLOCKER_REASON);
  assert.equal(readStdioMcpConduitTerminalFailure(projected).detail.conduit_error_code, "c");
});

test("WK-1678: the Claude command line reports its prompt structurally", () => {
  for (const role of ["worker", "reviewer", "redteam"]) {
    const line = defaultBuildClaudeCommandLine({
      claudePath: "/nonexistent/claude",
      role,
      subject: "WK-1678",
      prompt: "do the thing",
      workspaceDir: REPO_ROOT
    });
    assert.equal(line.prompt, "do the thing");
    assert.equal(Number.isInteger(line.promptIndex), true);
    assert.equal(line.args[line.promptIndex], line.prompt);
    assert.equal(line.promptIndex, line.args.length - 1,
      "the prompt is the final positional argument");
    assert.equal(line.args.filter((value) => value === line.prompt).length, 1);
    assert.equal(line.commandLineContract, CLAUDE_COMMAND_LINE_CONTRACT_SCHEMA_VERSION);
  }
});

test("WK-1678: registration args precede the prompt and pin strict config", () => {

  const line = defaultBuildClaudeCommandLine({
    claudePath: "/nonexistent/claude",
    role: "reviewer",
    subject: "WK-1678",
    prompt: "review it",
    workspaceDir: REPO_ROOT
  });
  const registration = ["--mcp-config", "{}", "--strict-mcp-config",
    "--allowedTools", "mcp__wiki__workspace_read_page"];
  const argv = composeClaudeArgv({
    optionArgs: [...line.optionArgs, ...registration],
    prompt: line.prompt
  });
  assert.equal(verifyClaudeArgvPromptContract({ argv, prompt: line.prompt }).ok, true);
  assert.equal(argv[argv.length - 1], "review it", "the prompt stays last");
  const configIndex = argv.indexOf("--mcp-config");
  const strictIndex = argv.indexOf("--strict-mcp-config");
  assert.ok(configIndex >= 0 && strictIndex === configIndex + 2);
  assert.ok(strictIndex < argv.length - 1, "strict config precedes the prompt");

  assert.deepEqual(argv.slice(0, line.optionArgs.length), [...line.optionArgs]);
  assert.equal(CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON,
    "claude_command_line_prompt_contract_invalid");

  const rejected = verifyClaudeArgvPromptContract({
    argv: [...line.optionArgs, ...registration, line.prompt], prompt: line.prompt
  });
  assert.equal(rejected.ok, false);
});

test("WK-1678: an unusual prompt does not break the structural contract", () => {

  for (const prompt of ["--print", "--output-format", "text", "--model", "  ", "a\nb"]) {
    const line = defaultBuildClaudeCommandLine({
      claudePath: "/nonexistent/claude",
      role: "reviewer",
      subject: "WK-1678",
      prompt,
      workspaceDir: REPO_ROOT
    });
    assert.equal(line.args[line.promptIndex], prompt);
    assert.equal(line.promptIndex, line.args.length - 1);
  }
});

test("WK-1678: only the composition root imports the injectable conduit core", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {

      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      if (!full.endsWith(".mjs") && !full.endsWith(".js")) continue;
      if (full.endsWith("stdio-mcp-conduit.mjs")) continue;
      if (readFileSync(full, "utf8").includes("stdio-mcp-conduit-core.mjs")) {
        offenders.push(path.relative(REPO_ROOT, full));
      }
    }
  };
  const packagesRoot = path.join(REPO_ROOT, "packages");
  for (const pkg of readdirSync(packagesRoot)) {
    const src = path.join(packagesRoot, pkg, "src");
    try {
      if (statSync(src).isDirectory()) walk(src);
    } catch {   }
  }
  assert.deepEqual(offenders, [],
    "the dependency-injectable conduit core must be reachable only from its composition root");
});

test("WK-1678: the launch-isolation barrel does not re-export the conduit constructor", async () => {
  const barrel = await import("../../packages/agent-launch-cli/src/lib/launch-isolation.mjs");
  assert.equal("createStdioMcpConduit" in barrel, false);
  assert.equal("createStdioMcpRelayRegistration" in barrel, false);
  assert.equal("buildClaudeStdioMcpRegistrationArgs" in barrel, false);
  assert.equal("buildCodexStdioMcpRegistrationOverrides" in barrel, false);

  assert.equal(typeof barrel.STDIO_MCP_CONDUIT_ERROR_CODES, "object");
  assert.equal(typeof barrel.StdioMcpConduitError, "function");
});

test("WK-1678: the launcher plan module has no cyclic conduit dependency", async () => {

  const planModule = await import(
    "../../packages/agent-launch-cli/src/lib/launch-isolation-plan.mjs");
  assert.equal(typeof planModule.buildBubblewrapLaunchPlan, "function");
  const contractSource = readFileSync(path.join(REPO_ROOT,
    "packages/agent-launch-cli/src/lib/stdio-mcp-conduit-contract.mjs"), "utf8");
  const imports = [...contractSource.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gmu)]
    .map((match) => match[1]);

  assert.deepEqual([...imports].sort(), [
    "./stdio-mcp-conduit-channel.mjs",
    "./stdio-mcp-conduit-errors.mjs"
  ], "the contract may import only the error and channel leaves beneath it");
});

test("WK-1678: exact role profiles keep worker delivery-only and findings roles read-only", () => {

  assert.deepEqual(resolveLauncherRoleToolNames("worker"),
    ["commit", "workspace_worker_run_declared_test"]);
  for (const role of ["reviewer", "redteam"]) {
    const tools = resolveLauncherRoleToolNames(role);
    assert.equal(tools.includes("commit"), false);
    assert.equal(tools.includes("workspace_work_record_set_status"), false);
    assert.equal(tools.includes("workspace_wk_forge_handoff"), false);
    assert.equal(tools.includes("workspace_read_page"), true);
  }
  assert.equal(resolveLauncherRoleToolNames("review").join(","),
    resolveLauncherRoleToolNames("reviewer").join(","));
  assert.throws(() => resolveLauncherRoleToolNames("agy"));
});

const AUTH_UNIT = "WK-1678#SLICE-009";
const AUTH_REPO = "/srv/repos/agent-chassis";

function scopeCarrier(overrides = {}) {
  return {
    selected_unit: { address: AUTH_UNIT },
    unit_address: "IN-0031/WK-1678/SLICE-009",
    source_digest: `sha256:${"a".repeat(64)}`,
    read_scope: ["docs"],
    repo_paths: ["tests"],
    write_scope: ["packages/agent-launch-cli/src/lib"],
    ...overrides
  };
}

function provisioningCarrier(overrides = {}) {
  return {
    main_repo: AUTH_REPO,
    unit_address: "IN-0031/WK-1678/SLICE-009",
    write_scope: ["packages/agent-launch-cli/src/lib"],
    slice_binding: {
      schema_version: "worktree-identity-binding.v2",
      checkout_mode: "full",
      launch_ref: "refs/agent-launch/WK-1678",
      run_id: "run-1",
      retry_id: "0"
    },
    ...overrides
  };
}

function mintWorker(overrides = {}) {
  return mintTrustedStdioMcpConduitAuthority({
    family: "codex",
    role: "worker",
    assignedUnit: AUTH_UNIT,
    workspaceDir: AUTH_REPO,
    workerScopeAuthority: scopeCarrier(),
    provisioning: provisioningCarrier(),
    ...overrides
  });
}

function frozenReviewBinding(overrides = {}) {
  const contract = createTrustedFrozenReviewContract({
    subject: AUTH_UNIT,
    canonical_parent_wk_contract: "parent-contract",
    review_unit_contract: "review-contract"
  });
  const snapshot = createFrozenReviewContractSnapshot(contract);
  return {
    snapshot,
    subject: AUTH_UNIT,
    role: "reviewer",
    schema_version: snapshot.schema_version,
    digest: snapshot.digest,
    path_class: STDIO_MCP_FROZEN_REVIEW_CONTRACT_PATH_CLASS,
    credential: Object.freeze({ launch_ref: "refs/agent-launch/WK-1678", run_id: "run-1", retry_id: "0" }),
    ...overrides
  };
}

test("WK-2203#SLICE-044: managed reviewer authority binds the exact frozen snapshot identity", () => {
  const authority = mintTrustedStdioMcpConduitAuthority({
    family: "codex", role: "reviewer", assignedUnit: AUTH_UNIT, workspaceDir: AUTH_REPO,
    provisioning: provisioningCarrier(),
    frozenReviewContractBinding: frozenReviewBinding(),
    commitTuple: { launchRef: "refs/agent-launch/WK-1678", runId: "run-1", retryId: 0 }
  });
  assert.deepEqual(authority.frozenReviewContract, {
    subject: AUTH_UNIT, role: "reviewer",
    schemaVersion: "frozen-review-contract-snapshot.v1",
    digest: frozenReviewBinding().snapshot.digest,
    pathClass: STDIO_MCP_FROZEN_REVIEW_CONTRACT_PATH_CLASS,
    credential: { launch_ref: "refs/agent-launch/WK-1678", run_id: "run-1", retry_id: "0" }
  });
  assertTrustedStdioMcpConduitAuthority(authority, {
    frozenReviewContractBinding: frozenReviewBinding()
  });
});

test("WK-2203#SLICE-044: managed reviewer snapshot substitutions refuse closed", () => {
  const cases = [
    ["subject", frozenReviewBinding({ subject: "WK-9999#SLICE-001" })],
    ["role", frozenReviewBinding({ role: "redteam" })],
    ["schema", frozenReviewBinding({ schema_version: "other.v1" })],
    ["digest", frozenReviewBinding({ digest: `sha256:${"c".repeat(64)}` })],
    ["path class", frozenReviewBinding({ path_class: "caller-selected" })],
    ["credential", frozenReviewBinding({ credential: "caller-credential" })]
  ];
  for (const [label, binding] of cases) {
    assert.throws(() => mintTrustedStdioMcpConduitAuthority({
      family: "claude", role: "reviewer", assignedUnit: AUTH_UNIT, workspaceDir: AUTH_REPO,
      provisioning: provisioningCarrier(),
      commitTuple: { launchRef: "refs/agent-launch/WK-1678", runId: "run-1", retryId: 0 },
      frozenReviewContractBinding: binding
    }), (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
    `${label} must refuse`);
  }
});

test("WK-2203#SLICE-053: an absent reviewer binding preserves unmanaged null behavior", () => {
  const authority = mintTrustedStdioMcpConduitAuthority({
    family: "codex", role: "reviewer", assignedUnit: AUTH_UNIT, workspaceDir: AUTH_REPO,
    provisioning: provisioningCarrier()
  });
  assert.equal(authority.frozenReviewContract, null);
});

test("WK-2203#SLICE-053: contract provenance, serialization, and identity tuple are all mandatory", () => {
  const genuine = frozenReviewBinding();
  const commitTuple = { launchRef: "refs/agent-launch/WK-1678", runId: "run-1", retryId: 0 };
  const accepted = mintTrustedStdioMcpConduitAuthority({
    family: "codex", role: "reviewer", assignedUnit: AUTH_UNIT, workspaceDir: AUTH_REPO,
    provisioning: provisioningCarrier(), commitTuple, frozenReviewContractBinding: genuine
  });
  assert.equal(accepted.frozenReviewContract.role, "reviewer");
  for (const binding of [
    { ...genuine, snapshot: Object.freeze({ ...genuine.snapshot, trusted_frozen_review_contract: Object.freeze({ ...genuine.snapshot.trusted_frozen_review_contract }) }) },
    { ...genuine, snapshot: Object.freeze({ ...genuine.snapshot, bytes: new Uint8Array(genuine.snapshot.bytes).fill(0) }) },
    { ...genuine, credential: Object.freeze({ launch_ref: "other", run_id: "run-1", retry_id: "0" }) },
    { ...genuine, credential: Object.freeze({ launch_ref: "refs/agent-launch/WK-1678", run_id: "run-1" }) },
    { ...genuine, credential: Object.freeze({ launch_ref: "refs/agent-launch/WK-1678", run_id: "run-1", retry_id: "0", extra: "x" }) }
  ]) {
    assert.throws(() => mintTrustedStdioMcpConduitAuthority({
      family: "codex", role: "reviewer", assignedUnit: AUTH_UNIT, workspaceDir: AUTH_REPO,
      provisioning: provisioningCarrier(), commitTuple, frozenReviewContractBinding: binding
    }), (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID);
  }
});

test("WK-1678: the launcher derives the mode and scopes from the role, not from a caller", () => {
  const worker = mintWorker();
  assert.equal(worker.mode, STDIO_MCP_CONDUIT_AUTHORITY_MODES.ASSIGNED);
  assert.equal(worker.source, "launcher-frozen-scope-authority");
  assert.deepEqual(worker.writeScope, ["packages/agent-launch-cli/src/lib"]);
  assert.deepEqual(worker.readScope, ["docs", "tests"]);
  assert.equal(worker.sourceDigest, `sha256:${"a".repeat(64)}`);
  assert.equal(Object.isFrozen(worker), true);
  assert.equal(Object.isFrozen(worker.worktreeIdentity), true);

  for (const role of ["reviewer", "review", "redteam"]) {
    const findings = mintTrustedStdioMcpConduitAuthority({
      family: "claude", role, assignedUnit: AUTH_UNIT, workspaceDir: AUTH_REPO
    });
    assert.equal(findings.mode, STDIO_MCP_CONDUIT_AUTHORITY_MODES.READ_ONLY);
    assert.equal(findings.source, "launcher-role-policy");
    assert.deepEqual(findings.writeScope, []);
    assert.deepEqual(findings.readScope, []);
    assert.equal(findings.role, role === "review" ? "reviewer" : role,
      "the legacy `review` alias normalizes to the canonical role");
  }

  const orchestrator = mintTrustedStdioMcpConduitAuthority({
    family: "claude", role: "orchestrator", assignedUnit: "IN-0031", workspaceDir: AUTH_REPO
  });
  assert.equal(orchestrator.mode, STDIO_MCP_CONDUIT_AUTHORITY_MODES.COORDINATION);
  assert.equal(orchestrator.source, "launcher-orchestrator-profile");
  assert.deepEqual(orchestrator.writeScope, ["docs", "wiki"]);
  assert.deepEqual(orchestrator.readScope, ["."]);
});

test("WK-1678: a forged authority is refused however perfectly it is shaped", () => {
  const real = mintWorker();
  assert.equal(isTrustedStdioMcpConduitAuthority(real), true);
  for (const forged of [
    null, undefined, {}, "authority", { ...real }, Object.freeze({ ...real })
  ]) {
    assert.equal(isTrustedStdioMcpConduitAuthority(forged), false);
    assert.throws(() => assertTrustedStdioMcpConduitAuthority(forged),
      (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID,
      "a structurally complete copy is still not a launcher-minted authority");
  }

  assert.equal(assertTrustedStdioMcpConduitAuthority(real, {
    family: "codex", role: "worker", assignedUnit: AUTH_UNIT, workspaceDir: AUTH_REPO
  }), real);
});

test("WK-1678: a real authority minted for another launch is refused", () => {
  const real = mintWorker();
  for (const [field, expected] of [
    ["family", { family: "claude" }],
    ["role", { role: "reviewer" }],
    ["assignedUnit", { assignedUnit: "WK-9999#SLICE-001" }],
    ["workspaceDir", { workspaceDir: "/srv/repos/other" }]
  ]) {
    assert.throws(() => assertTrustedStdioMcpConduitAuthority(real, expected),
      (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID &&
        error.detail?.field === field,
      `a mismatched ${field} must be refused`);
  }
});

test("WK-1678: the authority validates its unit, carriers, scopes, and cross-run identity", () => {
  const cases = [
    ["unsupported family", { family: "agy" }],
    ["unsupported role", { role: "operator" }],
    ["empty assigned unit", { assignedUnit: "" }],
    ["relative workspace", { workspaceDir: "relative/repo" }],

    ["provisioned unit mismatch",
      { provisioning: provisioningCarrier({ unit_address: "IN-0031/WK-9999/SLICE-001" }) }],
    ["selected unit mismatch",
      { workerScopeAuthority: scopeCarrier({ selected_unit: { address: "WK-9999#SLICE-001" } }) }],
    ["main repo mismatch", { provisioning: provisioningCarrier({ main_repo: "/srv/repos/other" }) }],

    ["worker without a scope carrier", { workerScopeAuthority: null }],

    ["carriers disagree on write scope", { provisioning: provisioningCarrier({ write_scope: ["docs"] }) }],

    ["absolute write scope", {
      workerScopeAuthority: scopeCarrier({ write_scope: ["/etc"] }),
      provisioning: provisioningCarrier({ write_scope: ["/etc"] })
    }],
    ["escaping read scope", { workerScopeAuthority: scopeCarrier({ read_scope: ["../../etc"] }) }],
    ["non-string scope entry", { workerScopeAuthority: scopeCarrier({ write_scope: [42] }) }],

    ["worktree identity with a function", {
      provisioning: provisioningCarrier({ slice_binding: { widen() { return true; } } })
    }],
    ["worktree identity with an invalid key", {
      provisioning: provisioningCarrier({ slice_binding: { "run; rm -rf": "1" } })
    }],
    ["worktree identity with an exotic prototype", {
      provisioning: provisioningCarrier({ slice_binding: new Map([["run_id", "run-1"]]) })
    }],
    ["worktree identity bound to another unit", {
      provisioning: provisioningCarrier({
        slice_binding: { unit_address: "IN-0031/WK-9999/SLICE-001", run_id: "run-1" }
      })
    }],

    ["commit tuple naming another run",
      { commitTuple: { launchRef: "refs/agent-launch/WK-1678", runId: "run-2", retryId: 0 } }],

    ["findings role carrying a scope authority", { role: "reviewer" }],
    ["findings role carrying a write-scope carrier",
      { role: "redteam", workerScopeAuthority: null, canonicalWriteScope: ["docs"] }],

    ["managed worker substituting a canonical write scope",
      { workerScopeAuthority: null, canonicalWriteScope: ["docs"] }],

    ["worker with no carrier at all",
      { workerScopeAuthority: null, provisioning: null }]
  ];
  for (const [label, overrides] of cases) {
    assert.throws(() => mintWorker(overrides),
      (error) => typeof error?.code === "string" &&
        (error.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID ||
          error.code === STDIO_MCP_CONDUIT_ERROR_CODES.FAMILY_UNSUPPORTED),
      `${label} must fail closed`);
  }
});

test("WK-1678: an unmanaged worker's write scope is attributed to its real source", () => {

  const authority = mintWorker({
    workerScopeAuthority: null,
    provisioning: null,
    canonicalWriteScope: ["packages/agent-launch-cli/src/lib", "docs"]
  });
  assert.equal(authority.mode, STDIO_MCP_CONDUIT_AUTHORITY_MODES.ASSIGNED);
  assert.equal(authority.source, "launcher-canonical-write-scope");
  assert.notEqual(authority.source, "launcher-frozen-scope-authority");
  assert.deepEqual(authority.writeScope, ["docs", "packages/agent-launch-cli/src/lib"]);
  assert.equal(authority.sourceDigest, null, "there is no digest-bound carrier to cite");

  assert.throws(() => mintWorker({
    workerScopeAuthority: null, provisioning: null, canonicalWriteScope: ["/etc"]
  }), (error) => error?.code === STDIO_MCP_CONDUIT_ERROR_CODES.INPUT_INVALID);
});

test("WK-1678: an unmanaged launch still gets a launcher-derived worktree identity", () => {
  const authority = mintWorker({ provisioning: null });
  assert.deepEqual({ ...authority.worktreeIdentity }, {
    kind: "launcher-workspace",
    workspace_dir: AUTH_REPO
  });
  assert.equal(authority.crossRunIdentity, null);

  assert.equal(mintWorker().crossRunIdentity.run_id, "run-1");
});

test("WK-1678: the conduit-requires-bubblewrap blocker is a registered taxonomy code", () => {
  const taxonomy = JSON.parse(readFileSync(
    path.join(REPO_ROOT, "packages/wiki-core/data/runtime-blocker-codes.v1.json"), "utf8"));
  const codes = new Set((taxonomy.codes ?? taxonomy.blockers ?? []).map((entry) => entry.code));
  for (const reason of [
    STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON,
    STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
    STDIO_MCP_CLEANUP_BLOCKER_REASON
  ]) {
    assert.equal(codes.has(reason), true, `${reason} must be a registered blocker code`);
  }
});
