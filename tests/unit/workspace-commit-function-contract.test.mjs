

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES,
  CommitToolExposureGuardError,
  WORKER_COMMIT_TOOL_NAME
} from "../../packages/agent-launch-cli/src/lib/commit-tool-exposure-guard.mjs";
import {
  WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES,
  WorktreeSubstrateError
} from "../../packages/agent-launch-cli/src/lib/worktree-substrate.mjs";
import { bindingFilePath } from "../../packages/agent-launch-cli/src/lib/worktree-substrate-identity.mjs";
import { registerMcpContentReferenceTools } from "../../packages/wiki-mcp/src/lib/mcp-content-reference-tools.mjs";
import { errorContent, jsonContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  registerWorkspaceCommitTool,
  WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION
} from "../../packages/wiki-mcp/src/lib/workspace-commit-tool.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";
import { assertStructuredCarrier } from "../helpers/mcp-journey-accounting.mjs";
import {
  ASSIGNED_UNIT,
  BASE_SHA,
  COMMIT_SHA,
  TREE_SHA,
  WORKSPACE_DIR,
  exactSliceBinding,
  installIdentityStoreEnv,
  installState,
  registerCommitTool,
  saveCommitEnv
} from "../helpers/workspace-commit-function-contract-harness.mjs";

test("WK-1537#SLICE-009 closed-input commit composition signal is bounded and immutable", () => {
  assert.equal(Object.isFrozen(WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION), true);
  assert.deepEqual(WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION, {
    schema_version: "workspace-closed-input-commit-composition.v1",
    installed: true,
    tool_name: WORKER_COMMIT_TOOL_NAME,
    input_contract: "closed",
    binding_authority: "server_resolved"
  });
  assert.equal(Object.prototype.hasOwnProperty.call(
    WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION,
    "ref"
  ), false);
  assert.equal(Object.prototype.hasOwnProperty.call(
    WORKSPACE_CLOSED_INPUT_COMMIT_COMPOSITION,
    "setAvailable"
  ), false);
});

test("WK-1537#SLICE-010 registered description pins exact-slice tuple-resolved delivery", async (t) => {
  const tool = await registerCommitTool(t);
  const description = tool.config.description;

  assert.match(description, /Commit only the launcher-bound worker delta/);
  assert.match(description, /move its unit to review/);
  assert.match(description, /Exact-slice commit submits for review/);
  assert.match(description, /advances no WK ref or integration authority/);
  assert.match(description, /Closed input: identity, scope, refs and commit settings are launcher-owned/);
});

test("commit tool is closed-input and accepts no worker-supplied authority fields", async (t) => {
  const binding = exactSliceBinding();
  installIdentityStoreEnv(t, binding);
  const state = installState({ binding });
  const tool = await registerCommitTool(t);

  assert.deepEqual(Object.keys(tool.config.inputSchema?.shape ?? {}), [], "commit input schema must be empty");

  const result = await tool.handler({ branch: "main", write_scope: ["packages/**"], subject: "WK-0001" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /worker-asserted binding component is refused/);
  assert.deepEqual(state.calls, [], "closed input refusal must happen before server binding resolution");
});

test("identity-store exact-slice binding projects subject only after complete identity agreement", async (t) => {
  const binding = exactSliceBinding({
    output_branch: "refs/heads/slice/IN-0011/WK-1429/SLICE-004"
  });
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      idempotent: false
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, true);
  assert.equal(result.structuredContent.submitted_for_review, true);
  assert.equal(result.structuredContent.assigned_unit, ASSIGNED_UNIT);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding",
    "materialize",
    "verify_measure",
    "commit_slice_ref",
    "transition"
  ]);
  assert.deepEqual(state.calls[0].args, {
    mainRepo: WORKSPACE_DIR,
    launchRef: binding.launch_ref,
    runId: binding.run_id,
    retryId: binding.retry_id
  });
  assert.equal(
    state.calls.find((call) => call.op === "materialize").args.message,
    `agent-launch worker delivery: ${ASSIGNED_UNIT} (base ${BASE_SHA.slice(0, 12)})\n\nWk-Slice: ${ASSIGNED_UNIT}`
  );
  assert.equal(Object.prototype.hasOwnProperty.call(binding, "subject"), false, "stored binding remains unchanged");
});

test("identity-store full-checkout binding commits without a sparse projection", async (t) => {
  const binding = exactSliceBinding();
  installIdentityStoreEnv(t, binding);
  const state = installState({
    binding,
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      idempotent: false
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, true);
  assert.equal(result.structuredContent.submitted_for_review, true);
  assert.deepEqual(state.calls.map((call) => call.op), [
    "resolve_binding",
    "materialize",
    "verify_measure",
    "commit_slice_ref",
    "transition"
  ]);
  const materialize = state.calls.find((call) => call.op === "materialize").args;
  assert.equal(Object.hasOwn(materialize, "sparseBinding"), false, "a full-checkout binding supplies no sparse projection");
});

test("identity-store full binding carrying sparse markers fails closed", async (t) => {
  const mixed = exactSliceBinding({ cone_dirs: ["tests"], index_sparse: false });
  installIdentityStoreEnv(t, mixed);
  const state = installState({ binding: mixed });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /credential->binding resolver threw/);
  assert.deepEqual(
    state.calls.map((call) => call.op),
    ["resolve_binding"],
    "a mixed v1/v2 marker binding fails closed before materialization"
  );
});

test("identity-store checkout discriminator fails closed on every non-full shape", async (t) => {
  const cases = [
    ["schema-less", (binding) => { delete binding.schema_version; }],
    ["unknown schema_version", (binding) => { binding.schema_version = "worktree-identity-binding.v3"; }],
    ["non-string schema_version", (binding) => { binding.schema_version = 2; }],
    ["v1 sparse binding", (binding) => {
      delete binding.checkout_mode;
      Object.assign(binding, { schema_version: "worktree-identity-binding.v1", cone_dirs: ["tests"], index_sparse: false });
    }],
    ["missing checkout_mode", (binding) => { delete binding.checkout_mode; }],
    ["checkout_mode not exactly \"full\"", (binding) => { binding.checkout_mode = "sparse"; }],
    ["lone cone_dirs pin", (binding) => { binding.cone_dirs = ["tests"]; }],
    ["lone index_sparse pin", (binding) => { binding.index_sparse = false; }]
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async (t) => {
      const binding = exactSliceBinding();
      mutate(binding);
      installIdentityStoreEnv(t, binding);
      const state = installState({ binding });
      const tool = await registerCommitTool(t);

      const result = await tool.handler({});
      assert.equal(result.isError, true, `${name} must fail closed`);
      assert.match(result.content[0].text, /credential->binding resolver threw/);
      assert.deepEqual(
        state.calls.map((call) => call.op),
        ["resolve_binding"],
        "the checkout-shape refusal must precede materialization and ref mutation"
      );
    });
  }
});

test("WK-1622#SLICE-009 identity-store discriminator fails closed on extended and incomplete key sets (RV-002)", async (t) => {
  const cases = [
    ["an arbitrary extra field", () => exactSliceBinding({ smuggled_field: "attacker" })],

    ["serialized-binding-only fields", () => exactSliceBinding({
      worktreePath: "/worktrees/WK-1429-SLICE-004",
      gitDir: "/git/worktrees/WK-1429-SLICE-004"
    })],
    ["a caller-supplied expected envelope", () => exactSliceBinding({
      expected: { schema_version: "expected-envelope.v1", declared_metrics: { changed_line_count: 150 } }
    })],
    ["a missing required identity field", () => {
      const binding = exactSliceBinding();
      delete binding.source_digest;
      return binding;
    }],

    ["the removed run_authority stamp", () => exactSliceBinding({
      retry_id: 1, run_authority: "b9f1c0de-0000-4000-8000-000000000001"
    })]
  ];

  for (const [name, build] of cases) {
    await t.test(name, async (t) => {
      const binding = build();
      installIdentityStoreEnv(t, binding);
      const state = installState({ binding });
      const tool = await registerCommitTool(t);

      const result = await tool.handler({});
      assert.equal(result.isError, true, `${name} must fail closed`);
      assert.match(result.content[0].text, /credential->binding resolver threw/);
      assert.deepEqual(
        state.calls.map((call) => call.op),
        ["resolve_binding"],
        "the exact-key-set refusal must precede materialization and ref mutation"
      );
    });
  }
});

test("WK-1651 identity-store discriminator admits an exact-shape reissued binding with no enumerated exception", async (t) => {
  const binding = exactSliceBinding({ retry_id: 1 });
  installIdentityStoreEnv(t, binding);
  installState({
    binding,
    advanced: {
      base_sha: BASE_SHA,
      commit: COMMIT_SHA,
      tree: TREE_SHA,
      ref: "refs/heads/slice/IN-0011/WK-1429/SLICE-004",
      idempotent: false
    }
  });
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, true, "a full reissue must still commit");
});

test("identity-store exact-slice projection fails closed for every identity mismatch class", async (t) => {
  const cases = [
    ["missing unit_address", (binding) => { delete binding.unit_address; }, ASSIGNED_UNIT],
    ["malformed unit_address", (binding) => { binding.unit_address = "IN-0011/WK-1429/slice-004"; }, ASSIGNED_UNIT],
    ["WK-only unit_address", (binding) => { binding.unit_address = "IN-0011/WK-1429"; }, ASSIGNED_UNIT],
    ["initiative mismatch", (binding) => { binding.initiative = "IN-0012"; }, ASSIGNED_UNIT],
    ["missing initiative", (binding) => { delete binding.initiative; }, ASSIGNED_UNIT],
    ["record_id mismatch", (binding) => { binding.record_id = "WK-1430"; }, ASSIGNED_UNIT],
    ["missing record_id", (binding) => { delete binding.record_id; }, ASSIGNED_UNIT],
    ["slice_id mismatch", (binding) => { binding.slice_id = "SLICE-005"; }, ASSIGNED_UNIT],
    ["missing slice_id", (binding) => { delete binding.slice_id; }, ASSIGNED_UNIT],
    ["selected_unit mismatch", (binding) => { binding.selected_unit.address = "WK-1429#SLICE-005"; }, ASSIGNED_UNIT],
    ["selected_unit omission", (binding) => { delete binding.selected_unit; }, ASSIGNED_UNIT],
    ["partial selected_unit", (binding) => { delete binding.selected_unit.repo; }, ASSIGNED_UNIT],
    ["assigned-unit mismatch", () => {}, "WK-1429#SLICE-005"],
    ["malformed assigned unit", () => {}, "WK-1429"],
    ["non-canonical assigned unit", () => {}, ` ${ASSIGNED_UNIT} `],
    ["output-branch mismatch", (binding) => { binding.output_branch = "slice/IN-0012/WK-1429/SLICE-004"; }, ASSIGNED_UNIT],
    ["missing output branch", (binding) => { delete binding.output_branch; }, ASSIGNED_UNIT],
    ["conflicting explicit subject", (binding) => { binding.subject = "WK-1429#SLICE-005"; }, ASSIGNED_UNIT]
  ];

  for (const [name, mutate, assignedUnit] of cases) {
    await t.test(name, async (t) => {
      const binding = exactSliceBinding();
      mutate(binding);
      installIdentityStoreEnv(t, binding, assignedUnit);
      const state = installState({ binding });
      const tool = await registerCommitTool(t);

      const result = await tool.handler({});
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /credential->binding resolver threw/);
      assert.deepEqual(
        state.calls.map((call) => call.op),
        ["resolve_binding"],
        "identity refusal must precede commit materialization and ref mutation"
      );
    });
  }
});

test("serialized commit binding environment cannot replace the launcher identity tuple", async (t) => {
  saveCommitEnv(t);
  process.env.WIKI_MCP_ASSIGNED_UNIT = ASSIGNED_UNIT;
  process.env.WIKI_MCP_COMMIT_BINDING = JSON.stringify({
    subject: ASSIGNED_UNIT,
    output_branch: "refs/heads/attacker-selected"
  });
  delete process.env.WIKI_MCP_COMMIT_LAUNCH_REF;
  delete process.env.WIKI_MCP_COMMIT_RUN_ID;
  delete process.env.WIKI_MCP_COMMIT_RETRY_ID;
  process.env.WIKI_MCP_TOOL_PROFILE = "operator";
  const state = installState();
  const tool = await registerCommitTool(t);

  const result = await tool.handler({});
  assert.equal(result.structuredContent.committed, false);
  assert.equal(result.structuredContent.decision_code, "commit.missing_launcher_binding.v1");
  assert.match(result.structuredContent.reasons[0], /serialized environment bindings/);
  assert.deepEqual(state.calls, []);
});

const BINDING_INCOMPLETE = COMMIT_TOOL_EXPOSURE_GUARD_DIAGNOSTIC_CODES.BINDING_INCOMPLETE;
const BINDING_NOT_FOUND = WORKTREE_SUBSTRATE_DIAGNOSTIC_CODES.BINDING_NOT_FOUND;
const RESOLVER_THREW_MESSAGE = "agent-launch commit-tool-exposure-guard: the injected credential->binding " +
  "resolver threw; failing closed rather than exposing an unresolved identity";
const FIXTURE_LAUNCH_REF = "launch-WK-2607-SLICE-005";
const FIXTURE_RUN_ID = "wkdb_WK2607_SLICE005";
const RESPONSE_ENV_KEYS = Object.freeze([
  "WIKI_MCP_RESPONSE_STATE_DIR",
  "WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT",
  "WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT",
  "WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT"
]);

async function openDiagnosticFixture(t, { repoSegments = [], resolveWorkspaceRepo = null } = {}) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const root = await scope.acquire(
    "commit diagnostic fixture",
    () => mkdtemp(path.join(os.tmpdir(), "wk2607-commit-diagnostics-")),
    (dir) => rm(dir, { recursive: true, force: true })
  );
  const previous = Object.fromEntries(RESPONSE_ENV_KEYS.map((key) => [key, process.env[key]]));
  scope.add("response spill environment", () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, {
    WIKI_MCP_RESPONSE_STATE_DIR: path.join(root, "response-spill"),
    WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192",
    WIKI_MCP_RESPONSE_PREVIEW_BYTE_LIMIT: "64",
    WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT: "512"
  });
  const mainRepo = path.join(root, "repository", ...repoSegments);
  await mkdir(mainRepo, { recursive: true });

  const tools = new Map();
  const registerTool = (name, config, handler) => tools.set(name, { config, handler });
  const transitions = [];
  registerWorkspaceCommitTool({
    registerTool,
    workspaceRepos: [{ repo: "agent-chassis/agent-chassis", dir: mainRepo }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: resolveWorkspaceRepo ?? ((repos) => repos[0]),
    createCompactWorkRecordEditResponse: (_workspaceRepo, result) => result,
    async setWorkRecordStatusByUnit(args) {
      transitions.push(args);
      throw new Error("a failed commit must not transition review state");
    },
    env: {
      WIKI_MCP_ASSIGNED_UNIT: "WK-2607#SLICE-005",
      WIKI_MCP_COMMIT_LAUNCH_REF: FIXTURE_LAUNCH_REF,
      WIKI_MCP_COMMIT_RUN_ID: FIXTURE_RUN_ID,
      WIKI_MCP_COMMIT_RETRY_ID: "0"
    }
  });
  registerMcpContentReferenceTools({ registerTool, z, jsonContent, errorContent });
  return {
    mainRepo,
    transitions,
    commit: tools.get(WORKER_COMMIT_TOOL_NAME),
    readReference: tools.get("workspace_read_mcp_content_reference").handler
  };
}

function expectedNotFoundMessage(mainRepo) {
  return "agent-launch worktree-substrate: no identity binding for (launch_ref,run_id,retry_id)=" +
    `(${FIXTURE_LAUNCH_REF},${FIXTURE_RUN_ID},0) at ` +
    bindingFilePath(mainRepo, FIXTURE_LAUNCH_REF, FIXTURE_RUN_ID, 0);
}

function assertCompleteResolverDiagnostic(envelope, mainRepo) {
  const innerMessage = expectedNotFoundMessage(mainRepo);
  assert.equal(envelope.code, BINDING_INCOMPLETE);
  assert.equal(envelope.name, "CommitToolExposureGuardError");
  assert.equal(envelope.message, RESOLVER_THREW_MESSAGE);
  assert.deepEqual(envelope.detail, { message: innerMessage, cause_code: BINDING_NOT_FOUND });
  assert.ok(envelope.stack.includes(RESOLVER_THREW_MESSAGE));
  assert.equal(envelope.stage, "binding_resolution");
  assert.deepEqual(envelope.diagnostic_serialization, { state: "complete" });
  assert.deepEqual(Object.keys(envelope.cause).sort(), ["code", "detail", "message", "name", "stack"]);
  assert.equal(envelope.cause.name, "WorktreeSubstrateError");
  assert.equal(envelope.cause.code, BINDING_NOT_FOUND);
  assert.equal(envelope.cause.message, innerMessage);
  assert.deepEqual(envelope.cause.detail, { errno: "ENOENT" });
  assert.ok(envelope.cause.stack.includes(innerMessage));
}

async function snapshotRepository(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const rows = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(entry.parentPath, entry.name);
    return [path.relative(dir, fullPath), entry.isFile() ? await readFile(fullPath, "utf8") : null];
  }));
  return rows.sort(([left], [right]) => left.localeCompare(right));
}

async function readHandlerResponse(fixture, result) {
  assert.equal(result.isError, true);
  assertStructuredCarrier(result);
  const spilled = result.structuredContent;
  if (spilled.response_spilled !== true) {
    return { envelope: spilled, spilled: false, reads: 0 };
  }
  const reference = spilled.content_reference;
  assert.equal(reference.read_tool, "workspace_read_mcp_content_reference");

  const chunks = [];
  let offset = 0;
  for (;;) {
    const page = await fixture.readReference({
      ref_id: reference.ref_id,
      offset,
      length: reference.range.max_length
    });
    assert.notEqual(page.isError, true);
    chunks.push(Buffer.from(page.structuredContent.data_base64, "base64"));
    if (page.structuredContent.eof) break;
    offset = page.structuredContent.next_offset;
  }
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.byteLength, spilled.total_bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), reference.sha256);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const envelope = JSON.parse(text);
  assert.equal(text, JSON.stringify(envelope, null, 2));
  return { envelope, spilled: true, reads: chunks.length };
}

test("commit resolver diagnostics preserve nested causes and exact stage", async (t) => {
  const fixture = await openDiagnosticFixture(t);
  const { envelope } = await readHandlerResponse(fixture, await fixture.commit.handler({}));
  assertCompleteResolverDiagnostic(envelope, fixture.mainRepo);
  assert.deepEqual(fixture.transitions, []);

  const outsideResolver = await openDiagnosticFixture(t, {
    resolveWorkspaceRepo() {
      throw new CommitToolExposureGuardError("workspace selection failed", {
        code: BINDING_INCOMPLETE,
        detail: { stage_hint: "workspace" },
        cause: new Error("workspace selection cause")
      });
    }
  });
  const { envelope: untyped } = await readHandlerResponse(
    outsideResolver,
    await outsideResolver.commit.handler({})
  );
  assert.equal(untyped.schema_version, "mcp-response-refusal.v1");
  assert.equal(untyped.diagnostic, "workspace selection failed");
  assert.equal(JSON.stringify(untyped).includes("binding_resolution"), false);

  const unsupported = await openDiagnosticFixture(t);
  const originalPrepareStackTrace = Error.prepareStackTrace;
  let failed;
  Error.prepareStackTrace = (error, callSites) => error instanceof WorktreeSubstrateError
    ? callSites
    : `${error.name}: ${error.message}\n    at ${callSites.join("\n    at ")}`;
  try {
    failed = await unsupported.commit.handler({});
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }
  const { envelope: failure } = await readHandlerResponse(unsupported, failed);
  assert.deepEqual(Object.keys(failure).sort(), ["code", "diagnostic_serialization", "message", "stage"]);
  assert.equal(failure.code, BINDING_INCOMPLETE);
  assert.equal(failure.message, RESOLVER_THREW_MESSAGE);
  assert.equal(failure.stage, "binding_resolution");
  assert.equal(failure.diagnostic_serialization.state, "failed");
  assert.equal(failure.diagnostic_serialization.cause.name, "TypeError");
  assert.equal(
    failure.diagnostic_serialization.cause.message,
    "workspace_commit.binding_resolution.cause.stack[0] must be a plain object, array, Error, or structured diagnostic"
  );
  assert.equal(typeof failure.diagnostic_serialization.cause.stack, "string");
  assert.deepEqual(unsupported.transitions, []);
});

test("commit diagnostic spill preserves complete multibyte causes", async (t) => {
  const segment = "诊断数据😀é".repeat(14);
  const fixture = await openDiagnosticFixture(t, { repoSegments: Array(8).fill(segment) });
  const { envelope, spilled, reads } = await readHandlerResponse(
    fixture,
    await fixture.commit.handler({})
  );
  assert.equal(spilled, true, "the multibyte diagnostic must exceed the inline limit");
  assert.ok(reads > 1, "the diagnostic must require continuation reads");
  assert.ok(envelope.cause.message.includes(Array(8).fill(segment).join(path.sep)));
  assertCompleteResolverDiagnostic(envelope, fixture.mainRepo);
  assert.deepEqual(fixture.transitions, []);
});

test("commit diagnostic failures preserve closed input and zero write effects", async (t) => {
  const fixture = await openDiagnosticFixture(t);
  await writeFile(path.join(fixture.mainRepo, "README.md"), "fixture\n", "utf8");
  const before = await snapshotRepository(fixture.mainRepo);
  const schema = fixture.commit.config.inputSchema;
  assert.equal(schema.safeParse({}).success, true);
  assert.equal(schema.safeParse({ branch: "main" }).success, false);

  for (const [args, reason] of [
    [{ branch: "main", write_scope: ["packages/**"], subject: "WK-0001" }, /worker-asserted binding component is refused/],
    [{ message: "forged" }, /commit message is SERVER-GENERATED/],
    [{ unexpected: true }, /accepts NO argument \(closed input schema\)/],
    ["forged", /accepts NO argument/]
  ]) {
    const { envelope: refused } = await readHandlerResponse(fixture, await fixture.commit.handler(args));
    assert.equal(refused.accepted, false);
    assert.match(refused.diagnostic, reason);
    assert.equal(Object.hasOwn(refused, "stage"), false);
  }

  const { envelope: unbound } = await readHandlerResponse(fixture, await fixture.commit.handler({}));
  assertCompleteResolverDiagnostic(unbound, fixture.mainRepo);
  assert.deepEqual(await snapshotRepository(fixture.mainRepo), before);
  assert.deepEqual(fixture.transitions, []);
});
