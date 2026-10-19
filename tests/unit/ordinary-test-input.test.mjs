

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { z } from "zod";

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";

import { errorContent, jsonContent, measureMcpInlineResultBytes } from
  "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { RUN_TEST_TOOL_NAME, RUN_TEST_VIEWS, runTestInputSchema, applyRunTestRetry, parseRunTestRequest, runTestRequestSeed } from
  "../../packages/wiki-mcp/src/lib/run-test-input.mjs";
import { AGENT_TOOL_LIVE_DESCRIPTION_HARD_LIMIT_CHARACTERS } from
  "../../packages/wiki-core/src/lib/tool-discovery/descriptor.mjs";
import { RUN_TEST_RESPONSE_MAX_BYTES } from "../../packages/wiki-mcp/src/lib/run-test-result.mjs";
import { registerRunTestTool } from "../../packages/wiki-mcp/src/lib/run-test-tool.mjs";
import stestr from
  "../../packages/agent-launch-cli/src/lib/test-execution/runner-integrations/stestr.mjs";
import { ADVISORY_REVIEW_SOURCE_BINDING_KIND } from
  "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const CURRENT_MAIN = Object.freeze({ kind: "current_main" });
const LIMIT_SENTENCE = "Responses are limited to 1 KiB (1,024 UTF-8 bytes) total.";

function measured(result) {
  return measureMcpInlineResultBytes(result.structuredContent, { isError: result.isError === true });
}

async function registration(t, { state = { role: "orchestrator", sessionContract: { id: "s" } },
  resolveSource = null, runFile = null } = {}) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const stateDir = await scope.acquire("response state",
    () => mkdtempSync(path.join(os.tmpdir(), "run-test-input-")),
    (created) => rmSync(created, { recursive: true, force: true }));
  const checkout = await scope.acquire("checkout",
    () => realpathSync(mkdtempSync(path.join(os.tmpdir(), "run-test-checkout-"))),
    (created) => rmSync(created, { recursive: true, force: true }));
  const responseEnv = { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
  const registered = new Map();
  const calls = { source: 0, run: 0 };
  registerRunTestTool({
    registerTool: (name, config, handler) => registered.set(name, { config, handler }),
    z,
    jsonContent: (value, options = {}) => jsonContent(value, { ...options, env: responseEnv }),
    errorContent: (error, options = {}) => errorContent(error, { ...options, env: responseEnv }),
    workspaceRepos: { currentAlias: "fixture", repos: new Map([["fixture", checkout]]) },
    resolveWorkspaceRepo: () => ({ repo: "fixture", dir: checkout }),
    env: {},
    responseEnv,
    deps: {
      resolveLauncherRunState: () => state,
      resolveSource: resolveSource ?? (async () => {
        calls.source += 1;
        return { kind: "current_main", role: state.role, repositoryRoot: checkout, checkoutRoot: checkout,
          commit: "a".repeat(40), tree: "b".repeat(40), dirty: false,
          authorityIdentity: { role: state.role, session: "s" },
          current: () => ({ current: true }),
          baseline: () => ({ status: "unavailable", reason: "fixture_has_no_baseline" }) };
      }),
      ...(runFile === null ? {} : { runFile: async (request) => { calls.run += 1; return runFile(request); } })
    }
  });
  const route = registered.get(RUN_TEST_TOOL_NAME);
  assert.ok(route, "workspace_run_test registers under its exported name");
  return { ...route, checkout, calls };
}

test("current public request accepts role modes and rejects every retired execution seed", async t => {
  const { config, handler, calls } = await registration(t);
  const schema = config.inputSchema;
  assert.ok(config.description.includes(LIMIT_SENTENCE));
  assert.ok(config.description.includes('Captured stdout/stderr share that ceiling and may be clipped.'));
  assert.ok(config.description.length <= AGENT_TOOL_LIVE_DESCRIPTION_HARD_LIMIT_CHARACTERS);
  const harness = { harness: { cwd: ".", argv: ["npm", "test", "--", "é \" --name $(data)", ""] } };
  for (const request of [harness, { entrypoint: "tests" }, { entrypoint: "tests", selection: "focus", timeout: { seconds: 17 } },
    { ...harness, source: CURRENT_MAIN }, { ...harness, environment: "npm@." }]) {
    assert.equal(schema.safeParse(request).success, true, JSON.stringify(request));
  }
  for (const request of [{ file: "a.test.mjs", runner: "node-test" }, { ...harness, selector: "x" },
    { entrypoint: "tests", harness: harness.harness }, { entrypoint: "tests", environment: "npm@." },
    { entrypoint: "tests", source: CURRENT_MAIN }, { entrypoint: "tests", argv: ["--inspect"] },
    { ...harness, role: "orchestrator" }, { ...harness, env: {} }, { ...harness, cwd: "/" }, {}]) {
    assert.equal(schema.safeParse(request).success, false, JSON.stringify(request));
    const result = await handler(request, {});
    assert.equal(result.structuredContent.code, "run_test.request_invalid.v1");
    assert.ok(measured(result) <= 1024);
  }
  const locator = { ref_id: "aB3_dE9x" };
  for (const view of RUN_TEST_VIEWS) assert.equal(schema.safeParse({ read: { result: locator, view } }).success, true);
  assert.equal(RUN_TEST_VIEWS.length, 8);
  for (const retry of [{ request: locator }, { request: locator, changes: { selection: "focused" }, clear: ["timeout"] }]) {
    assert.equal(schema.safeParse({ retry }).success, true);
  }
  for (const retry of [{ request: locator, changes: { file: "a.test.mjs" } },
    { request: locator, changes: { runner: "node-test" } }, { request: locator, clear: ["selector"] },
    { request: locator, clear: ["timeout", "timeout"] }, { request: locator, clear: ["selection"], changes: { selection: "x" } }]) {
    assert.equal(schema.safeParse({ retry }).success, false);
  }
  assert.equal(schema.safeParse(applyRunTestRetry({ file: "old.test.mjs", runner: "node-test" },
    { changes: { harness: harness.harness } })).success, false, "a removed seed is never translated");
  assert.deepEqual([calls.source, calls.run], [0, 0]);
});

test("role-specific schemas expose only their actual execution mode", () => {
  const worker = runTestInputSchema(z, { role: "worker" });
  const reviewer = runTestInputSchema(z, { role: "reviewer" });
  const orchestrator = runTestInputSchema(z, { role: "orchestrator" });
  assert.equal(worker.safeParse({ entrypoint: "tests", selection: "suite" }).success, true);
  assert.equal(worker.safeParse({ harness: { cwd: ".", argv: ["npm", "test"] } }).success, false);
  assert.equal(reviewer.safeParse({ harness: { cwd: ".", argv: ["npm", "test"] } }).success, true);
  assert.equal(reviewer.safeParse({ harness: { cwd: ".", argv: ["npm", "test"] }, source: CURRENT_MAIN }).success, false);
  assert.equal(orchestrator.safeParse({ entrypoint: "tests" }).success, false);
});

test("harness is one closed execution form and retry preserves its literal request", async (t) => {
  const { config, handler, calls } = await registration(t, { runFile: () => assert.fail("unsourced harness never runs") });
  const request = { harness: { cwd: "packages/palette-editor", argv: ["npm", "run", "test:unit", "--", "--run", "a * ; $x", ""] },
    environment: "npm@." };
  assert.deepEqual(config.inputSchema.parse(request), request);
  assert.equal(config.inputSchema.safeParse({ harness: { cwd: ".", argv: ["./test-wrapper"] } }).success, true);
  for (const extra of [{ file: "test.ts" }, { runner: "vitest" }, { selector: "test" }]) {
    assert.equal(config.inputSchema.safeParse({ ...request, ...extra }).success, false);
  }
  for (const harness of [null, {}, { cwd: ".", argv: [] }, { cwd: ".", argv: [""] },
    { cwd: ".", argv: ["node", "nul\0"] }, { cwd: ".", argv: ["node"], env: {} }]) {
    assert.equal(config.inputSchema.safeParse({ harness }).success, false, JSON.stringify(harness));
  }
  const refused = await handler(request, {});
  assert.equal(refused.structuredContent.code, "run_test.source_required.v1");
  const retry = refused.structuredContent.next_calls[0].arguments;
  assert.equal(config.inputSchema.safeParse(retry).success, true, "nested retry schema projects for retention");
  assert.deepEqual(runTestRequestSeed(request), request);
  const merged = applyRunTestRetry(request, { changes: { harness: { cwd: ".", argv: ["./wrapper", ""] } } });
  assert.deepEqual(config.inputSchema.parse(merged), merged);
  assert.deepEqual(parseRunTestRequest(request).harness, request.harness);
  assert.deepEqual([calls.source, calls.run], [0, 0]);
});

test("large harness requests retain bounded outcome and diagnostic reads without executing again", async (t) => {
  const { handler, calls } = await registration(t, { runFile: (request) => ({ status: "executed", ok: false,
    proof_credit: false, identity: { command_harness: request.harness }, resolution: [],
    run: { ran: true, ok: false, exit_code: 7, signal: null, timed_out: false, cancelled: false,
      cleanup_failed: false, output_truncated: false, stdout: "", stderr: "Error: wrapper rejected literal argv\n" }
  }) });
  const args = { harness: { cwd: ".", argv: ["./wrapper", ...Array(100).fill("中😀".repeat(1000))] }, source: CURRENT_MAIN };
  const result = await handler(args, {});
  assert.deepEqual([result.structuredContent.status, result.structuredContent.run.exit_code], ["executed", 7]);
  assert.ok(measured(result) <= 1024);
  const outcomeCall = result.structuredContent.next_calls.find(call => call.arguments.read.view === 'outcome');
  const outcome = await handler(outcomeCall.arguments, {});
  const callsToRead = [outcomeCall, ...outcome.structuredContent.next_calls.filter(call =>
    ['failure', 'candidate_stderr'].includes(call.arguments.read.view))];
  for (const call of callsToRead) {
    const view = call.arguments.read.view;
    const read = await handler(call.arguments, {});
    assert.ok(measured(read) <= 1024, view);
    assert.equal(read.structuredContent.executed, false);
    assert.equal(read.structuredContent.read.view, view);
    if (view === "outcome") {
      assert.equal(read.structuredContent.read.exit_code, 7);
      assert.equal(read.structuredContent.read.request, undefined, 'large literal argv stays with the execution owner');
    }
  }
  assert.equal(calls.run, 1);
});
