

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { z } from "zod";

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";

import { errorContent, jsonContent, measureMcpInlineResultBytes } from
  "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { RUN_TEST_TOOL_NAME, RUN_TEST_VIEWS, applyRunTestRetry, parseRunTestRequest } from
  "../../packages/wiki-mcp/src/lib/run-test-input.mjs";
import { RUN_TEST_RESPONSE_MAX_BYTES } from "../../packages/wiki-mcp/src/lib/run-test-result.mjs";
import { registerRunTestTool } from "../../packages/wiki-mcp/src/lib/run-test-tool.mjs";
import stestr from
  "../../packages/agent-launch-cli/src/lib/test-execution/runner-integrations/stestr.mjs";
import { ADVISORY_REVIEW_SOURCE_BINDING_KIND } from
  "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const CURRENT_MAIN = Object.freeze({ kind: "current_main" });
const LIMIT_SENTENCE ="Responses are limited to 1 KiB (1,024 UTF-8 bytes) total. stdout and stderr share the " +
  "remaining response budget and may be truncated; returned output is not a complete log.";

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

test("the published description states the hard response limit verbatim", async (t) => {
  const { config } = await registration(t);
  assert.ok(config.description.includes(LIMIT_SENTENCE), config.description);

  assert.match(config.description, /or one glob \(for example tests\/\*\*\/\*\.test\.mjs\)/u);
  assert.match(config.description, /never a file list/u);
  assert.doesNotMatch(config.description, /\bcontinue\b|\boffset\b/u);
  assert.equal(RUN_TEST_RESPONSE_MAX_BYTES, 1024);
  assert.equal(typeof config.inputValidationErrorProjector, "function",
    "pre-handler validation failures are projected by the route itself");
});

test("run_test closed public request", async (t) => {
  const { config } = await registration(t);
  const parse = (args) => config.inputSchema.safeParse(args);
  const execute = { file: "tests/unit/a.test.mjs", runner: "node-test" };
  assert.equal(parse(execute).success, true);
  assert.equal(parse({ ...execute, environment: "npm@.", selector: "only this", timeout: "short",
    compare_parent: true }).success, true);
  assert.equal(parse({ ...execute, timeout: { seconds: 2147483 } }).success, true);
  assert.equal(parse({ ...execute, source: { kind: "current_main" } }).success, true);
  assert.equal(parse({ ...execute, source: { kind: "exact_sha", value: "c".repeat(40) } }).success, true);

  for (const file of ["tests/unit/*.test.mjs", "tests/**/*.test.mjs", "tests/{unit,integration}/a?.test.[mc]js"]) {
    assert.equal(parse({ ...execute, file }).success, true, file);
  }
  for (const extra of [{ file: ["tests/a.test.mjs", "tests/b.test.mjs"] }, { files: ["tests/a.test.mjs"] },
    { glob: "tests/*.test.mjs" }, { pattern: "tests/*.test.mjs" }, { suite: "unit" }, { matched: ["a"] }]) {
    assert.equal(parse({ ...execute, ...extra }).success, false, JSON.stringify(extra));
  }

  for (const extra of [{ repo: "fixture" }, { repo: "foreign" }, { command: "sh" }, { args: ["-c", "true"] }, { argv: ["node"] }, { env: { A: "1" } },
    { environment_variables: { A: "1" } }, { cwd: "/" }, { checkout: "/tmp" }, { checkout_root: "/tmp" },
    { repository_root: "/tmp" }, { worktree_path: "/tmp" }, { role: "orchestrator" }, { unit: "WK-0001" },
    { launch_ref: "x" }, { run_id: "x" }, { base_sha: "a".repeat(40) }, { budget: 1 },
    { authority_identity: { role: "orchestrator" } }, { query_identity: { kind: "native_result" } }]) {
    assert.equal(parse({ ...execute, ...extra }).success, false, JSON.stringify(extra));
  }
  for (const source of [{ kind: "exact_sha", value: "abc123" }, { kind: "exact_sha", value: "C".repeat(40) },
    { kind: "worktree", value: "/tmp" }, { kind: "current_main", value: "x" }, { kind: "exact_sha" },
    { kind: "exact_sha", value: "c".repeat(40), checkout: true }, { kind: "branch" }, { kind: "branch", value: "" },
    { kind: "branch", value: "WK-0001", commit: "c".repeat(40) }, { kind: "branch", value: "x".repeat(129) }]) {
    assert.equal(parse({ ...execute, source }).success, false, JSON.stringify(source));
  }

  for (const value of ["WK-0001", "WK-0001#SLICE-001", "wk/IN-0001/WK-0001"]) {
    assert.equal(parse({ ...execute, source: { kind: "branch", value } }).success, true, value);
  }
  for (const timeout of [{ seconds: 0 }, { seconds: 2147484 }, { seconds: 1.5 }, "forever", 30,
    { seconds: 10, extra: 1 }, { milliseconds: 1000 }]) {
    assert.equal(parse({ ...execute, timeout }).success, false, JSON.stringify(timeout));
  }
  assert.equal(parse({ ...execute, compare_parent: "yes" }).success, false);
  assert.equal(parse({ file: "a.test.mjs" }).success, false, "an execution names its runner");
  assert.equal(parse({ runner: "node-test" }).success, false, "an execution names its file");
  assert.equal(parse({}).success, false, "no mode at all");

  const locator = { ref_id: "aB3_dE9x" };
  const read = { result: locator, view: "outcome" };
  const retry = { request: locator, changes: { selector: "other" }, clear: ["source"] };
  for (const view of RUN_TEST_VIEWS) assert.equal(parse({ read: { result: locator, view } }).success, true, view);

  assert.equal(parse({ read: { result: locator, view: "failure", failure: 2 } }).success, true);
  for (const failure of [0, -1, 1.5, "2", null]) {
    assert.equal(parse({ read: { result: locator, view: "failure", failure } }).success, false, String(failure));
  }
  assert.equal(parse({ read: { result: locator, view: "candidate_stdout", failure: 2 } }).success, false);
  assert.equal(parse({ repo: "fixture", read }).success, false);
  assert.equal(parse({ retry }).success, true);
  assert.equal(parse({ retry: { request: locator } }).success, true, "a retry may change nothing");

  assert.equal(parse({ detail: { source: locator, collection: "members" } }).success, false, "no detail alias");
  for (const gone of [{ continue: { source: locator, collection: "members", selector: { id: "candidate_stdout" },
    field_path: ["value"], offset: 0, length: 512 } }, { continue: { source: locator, collection: "members" } },
  { read: { ...read, offset: 0 } }, { read: { ...read, length: 512 } }, { read: { ...read, offset: 0, length: 512 } },
  { read: { ...read, field_path: ["value"] } }, { read: { ...read, cursor: "c" } }, { read: { ...read, unit: 2 } },
  { read: { ...read, snapshot_identity: "s".repeat(43) } }, { read: { result: locator, view: "matched" } },
  { read: { result: locator, view: "units" } }]) {
    assert.equal(parse(gone).success, false, JSON.stringify(gone));
  }
  for (const invalid of [{ read: { result: locator } }, { read: { result: locator, view: "members" } },
    { read: { result: locator, view: "request" } }, { read: { ...read, collection: "members" } },
    { read: { ...read, authority_identity: {} } }, { read: { result: { ...locator, sha256: "d".repeat(64) }, view: "outcome" } },
    { read: { result: { ref_id: "resp-1" }, view: "outcome" } }, { retry: { request: { ...locator, sha256: "d".repeat(64) } } },
    { retry: { changes: {} } }, { retry: { request: locator, old_tool: "workspace_run_test" } },
    { retry: { request: locator, args: execute } }, { retry: { request: locator, changes: { command: "sh" } } },
    { retry: { request: locator, changes: { role: "orchestrator" } } }]) {
    assert.equal(parse(invalid).success, false, JSON.stringify(invalid));
  }

  const modes = { read, retry };
  for (const [first, value] of Object.entries(modes)) {
    for (const mixed of [{ ...execute }, { file: execute.file }, { timeout: "short" }, { compare_parent: true },
      { source: { kind: "current_main" } }, { selector: "x" },
      ...Object.entries(modes).filter(([name]) => name !== first).map(([name, other]) => ({ [name]: other }))]) {
      assert.equal(parse({ [first]: value, ...mixed }).success, false,
        `${first} mixed with ${Object.keys(mixed)} is refused`);
    }
  }

  for (const changes of [{ source: null }, { selector: null }, { environment: null }, { timeout: null },
    { compare_parent: null }, { file: null }, { runner: null }]) {
    assert.equal(parse({ retry: { request: locator, changes } }).success, false, JSON.stringify(changes));
  }
  for (const clear of [[], ["file"], ["runner"], ["repo"], ["command"], ["source", "source"],
    ["selector", "environment", "selector"], "source", [null]]) {
    assert.equal(parse({ retry: { request: locator, clear } }).success, false, JSON.stringify(clear));
  }
  assert.equal(parse({ retry: { request: locator, clear: ["source"], changes: { source: { kind: "current_main" } } } })
    .success, false, "a field is cleared or changed, never both");
  assert.equal(parse({ retry: { request: locator, clear: ["environment", "selector", "timeout", "compare_parent",
    "source"] } }).success, true, "every optional field may be cleared");

  const seed = { file: "tests/a.test.mjs", runner: "node-test", environment: "npm@.", selector: "one",
    timeout: { seconds: 45 }, compare_parent: true, source: { kind: "current_main" } };
  const merged = applyRunTestRetry(seed, { changes: { selector: "two" }, clear: ["source", "timeout"] });
  assert.deepEqual(merged, { file: "tests/a.test.mjs", runner: "node-test", environment: "npm@.", selector: "two",
    compare_parent: true });
  assert.deepEqual(applyRunTestRetry(seed), seed, "an omitted clear and changes delete and replace nothing");
  assert.deepEqual(parse(merged).data, merged, "the merged request is validated by the same schema");
  assert.deepEqual(parseRunTestRequest({ retry }), { mode: "retry", seed: locator,
    changes: { selector: "other" }, clear: ["source"] });
});

test("the advertised request shape is the enforced schema's own", async (t) => {
  const { config } = await registration(t);
  assert.equal(Object.hasOwn(config, "advertisedInputSchema"), false, "no separate advertised schema");
  const inner = config.inputSchema.innerType();
  assert.deepEqual(Object.keys(inner.shape).sort(), ["compare_parent", "environment", "file", "read",
    "retry", "runner", "selector", "source", "timeout"]);

  const fileDescription = inner.shape.file.description;
  for (const stated of ["* ? [ ] { }", "tests/unit/*.test.mjs", "tests/**/*.test.mjs"]) {
    assert.ok(fileDescription.includes(stated), `${stated}: ${fileDescription}`);
  }
  assert.deepEqual(Object.keys(inner.shape.read.unwrap().shape).sort(), ["failure", "result", "view"]);
  for (const field of ["file", "runner"]) {
    assert.match(inner.shape[field].description, /^Required for an execution\./u, field);
  }
  for (const mode of ["read", "retry"]) {
    assert.match(inner.shape[mode].description, /exactly one mode/u, mode);
  }

  const described = inner.shape.selector.description;
  assert.match(described, /stestr.*Python regular expression.*after the file's dotted module prefix/u);
  for (const literal of ["\"unit/test_clamp.py\"", "\"unit.test_clamp.\"",
    "unit.test_clamp.ClampTests.test_preserves", "unit/test_clamp.py::ClampTests.test_preserves"]) {
    assert.ok(described.includes(literal), `${literal}: ${described}`);
  }
  const example = /selected by "([^"]+)"/u.exec(described)?.[1];
  assert.equal(example, "ClampTests\\.test_preserves", "the example is escaped as the caller types it");
  const composed = await stestr.ordinaryInvocation({ runtime: { scratchRoot: "/scratch",
    executables: { python: "python3" } }, projectDir: "/project", file: "unit/test_clamp.py", selector: example,
  metadata: async () => ({ stdout: "{\"valid\": true}" }) });
  const filter = new RegExp(composed.selection.test_id_filter, "u");
  assert.equal(filter.test("unit.test_clamp.ClampTests.test_preserves"), true);

  for (const other of ["unit\\.test_clamp\\.ClampTests\\.test_preserves",
    "unit/test_clamp\\.py::ClampTests\\.test_preserves"]) {
    const literal = await stestr.ordinaryInvocation({ runtime: { scratchRoot: "/scratch",
      executables: { python: "python3" } }, projectDir: "/project", file: "unit/test_clamp.py", selector: other,
    metadata: async () => ({ stdout: "{\"valid\": true}" }) });
    assert.equal(literal.selection.test_id_filter, `^unit\\.test_clamp\\.(?:${other})`);
    assert.equal(new RegExp(literal.selection.test_id_filter, "u").test(
      "unit.test_clamp.ClampTests.test_preserves"), false, other);
  }

  const locator = { ref_id: "aB3_dE9x" };
  for (const [mode, valid, invalid] of [
    ["read", { result: locator, view: "failure" }, { result: locator, view: "failure", extra: 1 }],
    ["retry", { request: locator, clear: ["selector"] }, { request: locator, clear: ["file"] }]]) {
    const published = inner.shape[mode];
    assert.equal(published.safeParse(valid).success, true, mode);
    assert.equal(config.inputSchema.safeParse({ [mode]: valid }).success, true, mode);
    assert.equal(published.safeParse(invalid).success, false, mode);
    assert.equal(config.inputSchema.safeParse({ [mode]: invalid }).success, false, mode);
  }
});

test("the parsed request sizes the timeout through the shared execution-timeout language", () => {
  assert.equal(parseRunTestRequest({ file: "a.test.mjs", runner: "node-test" }).timeout.milliseconds, 300000);
  assert.equal(parseRunTestRequest({ file: "a.test.mjs", runner: "node-test", timeout: "short" })
    .timeout.milliseconds, 30000);
  assert.equal(parseRunTestRequest({ file: "a.test.mjs", runner: "node-test", timeout: { seconds: 7 } })
    .timeout.milliseconds, 7000);
  assert.equal(parseRunTestRequest({ file: "a.test.mjs", runner: "node-test" }).compareParent, false);
  assert.throws(() => parseRunTestRequest({ file: "a.test.mjs", runner: "node-test",
    timeout: { seconds: 2147484 } }), (error) => typeof error?.envelope?.code === "string");
});

test("malformed and oversized input refusals are projected within 1,024 bytes", async (t) => {
  const { config } = await registration(t);
  const huge = "ü\"\\\u0001".repeat(20000);
  for (const args of [{ file: huge, runner: huge, command: huge }, { [huge.slice(0, 300)]: huge },
    { file: "a.test.mjs", runner: "node-test", timeout: { seconds: huge } },
    { file: "a.test.mjs", runner: "node-test", read: { result: huge } }, { retry: { request: huge, clear: [huge] } },
    { detail: { source: huge } }, { env: { [huge]: huge } }]) {
    const parsed = config.inputSchema.safeParse(args);
    assert.equal(parsed.success, false);
    const projected = await config.inputValidationErrorProjector({ args, validationError: parsed.error,
      tool: RUN_TEST_TOOL_NAME, role: "orchestrator", tier: "free_local" });
    const result = projected.terminal_result;
    assert.equal(result.isError, true);
    assert.ok(measured(result) <= RUN_TEST_RESPONSE_MAX_BYTES, `${measured(result)} bytes`);
    assert.equal(result.structuredContent.code, "run_test.request_invalid.v1");
    assert.equal(result.structuredContent.authority_limb, "mechanical_failure");
    assert.deepEqual(result.structuredContent.next_calls, [], "an invalid request gets no seed and no selection");
  }
});

test("a worker or reviewer cannot override its implicit source", async (t) => {
  for (const role of ["worker", "reviewer"]) {

    const { handler, calls, config } = await registration(t, { state: { role, assignedUnit: "WK-0001#SLICE-001",
      ...(role === "reviewer" ? { sessionContract: { minting_provenance: { trusted_source_bindings: [
        { kind: ADVISORY_REVIEW_SOURCE_BINDING_KIND, id: "wkdb_review", digest: `sha256:${"b".repeat(64)}` }] } } }
        : { credential: { kind: "identity_store_tuple", launchRef: "l", runId: "r.slice", retryId: 0 } }) },
    runFile: () => assert.fail("a refused override executes nothing") });

    const long = { file: `tests/${"deep/".repeat(700)}a.test.mjs`, runner: "node-test", selector: "s".repeat(1000) };
    for (const args of [{ file: "tests/a.test.mjs", runner: "node-test", environment: "npm@.",
      selector: "only this", timeout: { seconds: 45 }, compare_parent: true, source: { kind: "current_main" } },
    { ...long, source: { kind: "exact_sha", value: "c".repeat(40) } }]) {
      const result = await handler(args, {});
      assert.equal(result.isError, true, role);
      assert.equal(result.structuredContent.code, "run_test.source_not_permitted.v1");
      assert.equal(result.structuredContent.authority_limb, "mechanical_failure");
      assert.ok(measured(result) <= RUN_TEST_RESPONSE_MAX_BYTES, `${measured(result)} bytes`);

      assert.equal(result.structuredContent.next_calls.length, 1, JSON.stringify(result.structuredContent));
      const [replacement] = result.structuredContent.next_calls;
      assert.equal(replacement.tool, RUN_TEST_TOOL_NAME);
      assert.deepEqual(Object.keys(replacement.arguments), ["retry"]);
      assert.deepEqual(Object.keys(replacement.arguments.retry), ["request", "clear"]);
      assert.deepEqual(replacement.arguments.retry.clear, ["source"]);
      assert.equal(config.inputSchema.safeParse(replacement.arguments).success, true,
        "the replacement passes the public schema");

      const kept = await handler({ retry: { request: replacement.arguments.retry.request,
        changes: { selector: "another" } } }, {});
      assert.equal(kept.structuredContent.code, "run_test.source_not_permitted.v1");
    }
    assert.equal(calls.source, 0, `${role}: no source was resolved for an override`);
    assert.equal(calls.run, 0, `${role}: nothing executed`);
  }

  for (const role of ["redteam", "operator", null]) {
    const { handler, calls } = await registration(t, { state: { role } });
    const result = await handler({ file: "a.test.mjs", runner: "node-test" }, {});
    assert.equal(result.structuredContent.code, "run_test.role_ineligible.v1", String(role));
    assert.equal(calls.source, 0);
  }
});

test("an orchestrator names its source explicitly; an omitted source refuses before any work", async (t) => {
  const { handler, calls } = await registration(t, { runFile: () => assert.fail("nothing runs") });
  const result = await handler({ file: "tests/a.test.mjs", runner: "node-test", compare_parent: true }, {});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "run_test.source_required.v1");
  assert.equal(result.structuredContent.executed, false);
  assert.equal(result.structuredContent.missing_fields, "source");
  assert.equal(result.structuredContent.source_kinds, "current_main, exact_sha, branch");
  assert.ok(measured(result) <= RUN_TEST_RESPONSE_MAX_BYTES);
  assert.deepEqual([calls.source, calls.run], [0, 0], "no source resolution and no execution");

  const read = await handler({ read: { result: { ref_id: "unknownR" },
    view: "outcome" } }, {});
  assert.notEqual(read.structuredContent.code, "run_test.source_required.v1");
  assert.equal(calls.source, 0);
});

test("directory, escaping, symlink-escaping and unmatched targets are the runner's own refusals", async (t) => {
  const { handler, checkout } = await registration(t);
  mkdirSync(path.join(checkout, "tests"), { recursive: true });
  writeFileSync(path.join(checkout, "tests/a.test.mjs"), "export {};\n");
  symlinkSync("/etc/hostname", path.join(checkout, "tests/escape.test.mjs"));
  for (const [file, code] of [

    ["tests/*.spec.mjs", "ordinary_test_target_no_match"],
    ["tests/escape.test.[mc]js", "ordinary_test_target_no_match"],
    ["../*.test.mjs", "ordinary_test_target_invalid"],
    ["tests/./*.test.mjs", "ordinary_test_target_invalid"],
    ["tests/*.test.mjs", "test_runtime_runner_not_prepared"],
    ["tests/a.test.[mc]js", "test_runtime_runner_not_prepared"],
    ["tests/a.test.mjs", "test_runtime_runner_not_prepared"],
    ["../outside.test.mjs", "ordinary_test_target_invalid"],
    ["/etc/hostname", "ordinary_test_target_invalid"],
    ["tests/./a.test.mjs", "ordinary_test_target_invalid"],
    ["tests", "ordinary_test_target_not_file"],
    ["tests/missing.test.mjs", "ordinary_test_target_missing"],
    ["tests/escape.test.mjs", "ordinary_test_target_escapes_checkout"]]) {
    const result = await handler({ file, runner: "node-test", source: CURRENT_MAIN }, {});
    assert.equal(result.isError, true, file);
    assert.equal(result.structuredContent.code, code, `${file}: ${JSON.stringify(result.structuredContent)}`);
    assert.equal(result.structuredContent.executed, false, file);
    assert.ok(measured(result) <= RUN_TEST_RESPONSE_MAX_BYTES, `${file}: ${measured(result)}`);
  }
  const unknown = await handler({ file: "tests/a.test.mjs", runner: "tap", source: CURRENT_MAIN }, {});
  assert.equal(unknown.structuredContent.code, "ordinary_test_runner_unknown");

  const refused = unknown.structuredContent;
  assert.ok(measured(unknown) <= RUN_TEST_RESPONSE_MAX_BYTES, `${measured(unknown)} bytes`);
  assert.deepEqual([refused.message, refused.message_omitted_bytes, refused.executed, refused.output_complete],
    ["\"tap\" is not a runtime runner", undefined, false, true]);
  assert.deepEqual(Object.keys(refused.correction), ["retry_request", "changeable", "set", "rejected", "choices"]);
  assert.deepEqual([refused.correction.set, refused.correction.rejected, refused.correction.choices],
    ["retry.changes.runner", "tap", TEST_RUNTIME_RUNNER_CATALOG.runners.map(({ name }) => name).join(", ")]);
  assert.deepEqual(refused.next_calls.map(({ arguments: next }) => Object.keys(next)), [["read"]],
    "the only call is the read of the retained cause; no retry is built with a runner nobody chose");
  assert.equal(refused.next_calls[0].arguments.read.view, "failure");
  const selector = await handler({ file: "tests/a.test.mjs", runner: "node-test", selector: "--inspect",
    source: CURRENT_MAIN }, {});
  assert.equal(selector.structuredContent.code, "ordinary_test_selector_invalid");
});

test("a failed stestr selection shows the integration's composed filter and keeps the selector literal",
  async (t) => {
    const identity = (selector, selection) => ({ runner: "stestr", target: "unit/test_clamp.py", selector,
      project: ".", selection });
    const executed = (exitCode, selector, selection) => ({ schema_version: "ordinary-test-file-run.v1",
      status: "executed", ok: exitCode === 0, proof_credit: false, resolution: [],
      identity: identity(selector, selection),
      run: { schema_version: "ordinary-test-run.v1", operation: "ordinary_test", phase: "run", ran: true,
        skipped: false, disposition: exitCode === 0 ? "passed" : "failed", ok: exitCode === 0, exit_code: exitCode,
        signal: null, timed_out: false, cancelled: false, cleanup_failed: false, spawn_error: null,
        output_truncated: false, output_elided_bytes: 0, stdout: "", stderr: "", started_at_ms: 1, ended_at_ms: 2,
        duration_ms: 1 } });
    const requests = [];
    const results = [];
    const { handler } = await registration(t, { runFile: (request) => {
      requests.push(request);
      return results.shift();
    } });
    const call = async (selector) => handler({ file: "unit/test_clamp.py", runner: "stestr",
      ...(selector === undefined ? {} : { selector }), source: CURRENT_MAIN }, {});

    const full = "unit\\.test_clamp\\.ClampTests\\.test_preserves";
    const composed = `^unit\\.test_clamp\\.(?:${full})`;
    results.push(executed(1, full, { test_id_filter: composed }));
    const failed = await call(full);
    const answer = failed.structuredContent;
    assert.equal(requests[0].selector, full, "the selector is not normalized");
    assert.deepEqual([failed.isError, answer.status, answer.ok, answer.run.exit_code, answer.code, answer.correction],
      [undefined, "executed", false, 1, undefined, undefined], "an executed native failure, not a refusal");
    assert.deepEqual(answer.selection, { test_id_filter: composed });
    assert.equal(answer.output_complete, true);
    assert.deepEqual(answer.next_calls.map(({ arguments: next }) => Object.keys(next)), [["read"]],
      "no retry and no invented selection");
    assert.ok(measured(failed) <= RUN_TEST_RESPONSE_MAX_BYTES, `${measured(failed)} bytes`);

    const long = "s".repeat(1024);
    results.push(executed(1, long, { test_id_filter: `^unit\\.test_clamp\\.(?:${long})` }));
    const clipped = await call(long);
    assert.ok(measured(clipped) <= RUN_TEST_RESPONSE_MAX_BYTES, `${measured(clipped)} bytes`);
    const shown = clipped.structuredContent.selection;
    assert.ok(shown.test_id_filter.startsWith("^unit\\.test_clamp\\.(?:sss"), JSON.stringify(shown));
    assert.equal(Buffer.byteLength(shown.test_id_filter) + shown.omitted_bytes,
      "^unit\\.test_clamp\\.(?:)".length + 1024);
    assert.deepEqual([clipped.structuredContent.output_complete,
      clipped.structuredContent.next_calls[0].arguments.read.view], [false, "outcome"]);

    results.push(executed(0, "ClampTests", { test_id_filter: "^unit\\.test_clamp\\.(?:ClampTests)" }),
      executed(1, null, { test_id_filter: "^unit\\.test_clamp\\." }), executed(1, "ClampTests", {}));
    assert.equal((await call("ClampTests")).structuredContent.selection, undefined);
    assert.equal((await call()).structuredContent.selection, undefined);
    assert.equal((await call("ClampTests")).structuredContent.selection, undefined);
  });

test("a request cancelled before it starts executes nothing and says so within the limit", async (t) => {
  const { handler, calls } = await registration(t, { runFile: () => assert.fail("nothing runs") });
  const controller = new AbortController();
  controller.abort();
  const result = await handler({ file: "a.test.mjs", runner: "node-test", source: CURRENT_MAIN },
    { signal: controller.signal });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "run_test.cancelled_before_start.v1");
  assert.equal(calls.source, 0);
  assert.equal(calls.run, 0);
  assert.ok(measured(result) <= RUN_TEST_RESPONSE_MAX_BYTES);
});
