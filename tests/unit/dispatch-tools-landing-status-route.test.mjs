import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { registerLandingStatusRoute, CHECK_LANDING_INPUT_SCHEMA, createCheckLandingTask,
  buildCheckLandingRequest, projectCheckLandingInputFailure } from
  "../../packages/wiki-mcp/src/lib/dispatch-tools/landing-status-route.mjs";
import { validateWkPublicationSelection } from
  "../../packages/agent-launch-cli/src/lib/wk-forge-handoff.mjs";
import { projectToolInputValidationFailure } from "../../packages/wiki-mcp/src/lib/register-tool.mjs";
import { DISPATCH_FAILURE_ORIGINALS } from "../../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import { selectedResponseRequestSchema } from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";
import { requestContractErrors } from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";
import { projectCheckLandingCause } from "../../packages/wiki-mcp/src/lib/dispatch-tools/check-landing-response.mjs";

test("landing diagnosis collapses repeated wrappers and preserves distinct underlying failures", () => {
  const missing = { code: "ENOENT", message: "selected ref is absent", details: { ref: "refs/selected/one" } };
  const other = { code: "ENOENT", message: "selected ref is absent", details: { ref: "refs/selected/two" } };
  const denied = { code: "EACCES", message: "selected history cannot be read" };
  const diagnostic = { stage: "selected_publication", reason: "publication_unobservable",
    evidence: { cause_chain: [missing, other, denied] } };
  assert.deepEqual(projectCheckLandingCause({ stage: "handoff", category: "indeterminate", detail: {
    ...diagnostic, evidence: { cause_chain: [{ ...diagnostic, evidence: { cause_chain: [missing] } }, missing, other, denied] }
  } }), { stage: diagnostic.stage, reason: diagnostic.reason, failures: [
    { code: missing.code, message: missing.message, ref: missing.details.ref },
    { code: other.code, message: other.message, ref: other.details.ref }, denied
  ] });
});

test("check_landing rejects malformed or unauthorized input before observation", async () => {
  const subject = "WK-2739";
  const local = { kind: "publication", version: "a".repeat(64), head: "b".repeat(40),
    destination: { transport: "local" } };
  const git = { ...local, destination: { transport: "git", remote: "delivery" } };
  const hosted = { ...local, head: "b".repeat(64),
    destination: { transport: "hosted", remote: "origin" }, proposal: 42 };
  assert.deepEqual(Object.keys(CHECK_LANDING_INPUT_SCHEMA.shape), ["subject", "selection"]);
  const advertised = selectedResponseRequestSchema(CHECK_LANDING_INPUT_SCHEMA);
  for (const request of [{ subject }, ...[local, git, hosted].map((selection) => ({ subject, selection }))]) {
    assert.equal(CHECK_LANDING_INPUT_SCHEMA.safeParse(request).success, true);
    assert.deepEqual(requestContractErrors("workspace_check_landing", request, advertised), []);
    assert.deepEqual(buildCheckLandingRequest(request), { kind: "intended_tool_request",
      tool: "workspace_check_landing", arguments: request, callable: false });
  }
  let calls = 0;
  const adapter = async () => { calls++; assert.fail("malformed/forbidden call observed landing"); };
  const task = createCheckLandingTask({ env: { WIKI_MCP_TOOL_PROFILE: "orchestrator" },
    wkLandingStatusAdapter: adapter });
  const harmful = [null, {}, { subject: "WK-1" }, { subject: 2739 },
    ...["repo", "alias", "path", "branch", "base", "authority", "credentials", "assigned_unit", "unit",
      "candidate", "merge", "publish", "integrate", "tool", "args"].map((field) => ({ subject, [field]: "x" })),
    ...[null, { ...local, kind: "candidate" }, { ...local, version: "a" },
      { ...local, head: "0".repeat(40) }, { ...local, head: "B".repeat(40) },
      { ...local, head: "b".repeat(12) }, { ...local, token: "claimed authority" },
      { ...local, proposal: 1 }, { ...git, proposal: 1 }, { ...hosted, proposal: undefined },
      { ...hosted, proposal: 0 }, { ...hosted, proposal: 1.1 },
      { ...hosted, proposal: Number.MAX_SAFE_INTEGER + 1 },
      { ...local, destination: { transport: "local", remote: "origin" } },
      { ...git, destination: { transport: "git", remote: "" } },
      { ...hosted, destination: { transport: "hosted", remote: "origin", url: "https://foreign" } }
    ].map((selection) => ({ subject, selection }))];
  for (const request of harmful) {
    assert.equal(CHECK_LANDING_INPUT_SCHEMA.safeParse(request).success, false, JSON.stringify(request));
    assert.ok(requestContractErrors("workspace_check_landing", request, advertised).length > 0,
      `advertised schema refuses ${JSON.stringify(request)}`);
    await assert.rejects(() => task.handler(request), (error) => {
      assert.equal(error.envelope.diagnostic.tool, "workspace_check_landing");
      assert.ok(error.envelope.diagnostic.validator_diagnostics.length > 0);
      return true;
    });
    if (request?.selection !== undefined) assert.equal(validateWkPublicationSelection(request.selection).ok, false);
  }

  const requestContract = { acceptsArguments: async (value) => CHECK_LANDING_INPUT_SCHEMA.safeParse(value).success };
  const project = (args, registeredTools = new Set(["workspace_check_landing"])) =>
    projectCheckLandingInputFailure({ args, validationError: CHECK_LANDING_INPUT_SCHEMA.safeParse(args).error,
      requestContract, registeredTools });
  const pinned = { subject, selection: { ...local, version: "current" } };
  const sent = structuredClone(pinned);
  const guided = await project(pinned);
  assert.deepEqual(pinned, sent, "the rejected request is not rewritten");
  assert.deepEqual([guided.code, guided.accepted, guided.subject], ["tool_input_validation_failed", false, subject]);
  assert.deepEqual(guided.invalid_fields.map((field) => [field.path, field.code, field.validation]),
    [[["selection", "version"], "invalid_string", "regex"]]);
  assert.match(guided.invalid_fields[0].message, /exactly 64 lowercase hexadecimal characters identifying one publication version/u);
  assert.match(guided.correction, /COMPLETE selection the publication owner returned/u);
  assert.match(guided.correction, /worker or delivery commit or the literal "current"/u);
  assert.deepEqual(guided.next_calls, [], "a different question is not a correction continuation");
  assert.deepEqual(guided.current_observation_alternative.call,
    { tool: "workspace_check_landing", arguments: { subject } });
  assert.match(guided.current_observation_alternative.label, /^OPTIONAL ALTERNATIVE: observe CURRENT/u);
  assert.match(guided.current_observation_alternative.not_a_correction, /not the requested pinned read and repairs no failed publication/u);
  for (const unusable of [await project({ selection: pinned.selection }),
    await project({ subject: "WK-1", selection: pinned.selection }), await project(pinned, new Set())]) {
    assert.match(unusable.correction, /COMPLETE selection/u);
    assert.equal(unusable.current_observation_alternative, null);
    assert.deepEqual(unusable.next_calls, [], "no callable alternative without a valid, registered request");
  }
  for (const other of [{ subject, selection: { ...local, head: "b".repeat(12) } }, { subject, repo: "x" }]) {
    assert.deepEqual(await project(other), await projectToolInputValidationFailure({ tool: "workspace_check_landing",
      args: other, validationError: CHECK_LANDING_INPUT_SCHEMA.safeParse(other).error, requestContract }),
    "every other refusal keeps the shared projection unchanged");
  }
  for (const role of ["worker", "reviewer", "redteam"]) {
    const denied = await createCheckLandingTask({ env: { WIKI_MCP_TOOL_PROFILE: role },
      wkLandingStatusAdapter: adapter }).call({ subject, selection: local });
    assert.equal(denied.structuredContent.blocker.reason, "check_landing_role_forbidden");
    assert.equal(denied.structuredContent.blocker.detail.role, role);
    assert.deepEqual(denied.structuredContent.blocker.detail.required_roles, ["orchestrator", "operator"]);
    assert.equal(denied.structuredContent.subject.unit, subject);
    assert.equal(denied.structuredContent.recovery.responsible_actor, "launcher");
  }
  const absent = await task.call({ subject });
  assert.equal(absent.structuredContent.blocker.reason, "check_landing_session_repository_missing");
  assert.equal(absent.structuredContent.recovery.missing_component, "session_workspace");
  assert.equal(calls, 0);
});

test("check_landing projects task causes and authenticates retained originals without observation", async (t) => {

  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "check-landing-delivery-"));
  scope.add("landing response state", () => rmSync(stateDir, { recursive: true, force: true }));
  const subject = "WK-2739";
  const selection = { kind: "publication", version: "a".repeat(64), head: "b".repeat(40), destination: { transport: "local" } };
  const semantic = { stage: "handoff", reason: "fixture_authentication_unavailable",
    message: "The exact publication ancestry lookup failed.", token: "SERVER-ONLY-TOKEN".repeat(2000),
    nested: Array.from({ length: 80 }, (_, id) => ({ id, facts: { message: `fact ${id}`, token: `token ${id}` } })) };
  let calls = 0;
  const env = { ...process.env, WIKI_MCP_TOOL_PROFILE: "orchestrator",
    WIKI_MCP_RESPONSE_STATE_DIR: stateDir, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192" };
  const workspace = { repo: "fixture", dir: stateDir };
  const adapter = async () => {
    calls++;
    return { accepted: true, landing: { state: "unavailable", selection_authenticated: false,
      transport: null, landing_authority: null, observed_base: null, landed_publication: null,
      effects: { object_cache_fetch: "uncertain" },
      cause: { ...semantic, stdout: "RAW-STDOUT", stderr: "RAW-STDERR", stack: "RAW-STACK" } } };
  };
  const task = createCheckLandingTask({ workspace, env, wkLandingStatusAdapter: adapter });
  const delivered = await task.respond({ subject, selection });
  const result = delivered.result;
  assert.equal(result.structuredContent.response_spilled, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.ok(Buffer.byteLength(result.content[0].text) < 2048);
  assert.deepEqual(result.structuredContent.cause, { stage: semantic.stage, reason: semantic.reason, message: semantic.message });
  for (const internal of ["SERVER-ONLY-TOKEN", "RAW-STDOUT", "RAW-STDERR", "RAW-STACK", "retained_evidence", "authority_identity"]) {
    assert.equal(result.content[0].text.includes(internal), false, internal);
  }
  assert.deepEqual(result.structuredContent.effects, { object_cache_fetch: "uncertain" });
  assert.deepEqual(result.structuredContent.selection, selection, "an incomplete observation keeps the caller's exact selection");
  assert.equal(result.structuredContent.delivery, undefined);
  assert.equal(result.structuredContent.next_calls, undefined, "the complete answer needs no reread");
  assert.equal(delivered.source, null);
  assert.equal(delivered.originalRequest, null);
  assert.deepEqual(readdirSync(stateDir), [], "a complete unavailable answer needs no retained server carrier");
  const pending = await createCheckLandingTask({ workspace, env,
    ownerCall: source => ({ tool: "workspace_read_wiki", arguments: { reference: source } }),
    ownerRequestSchema: selectedResponseRequestSchema(z.object({ reference: z.object({ ref_id: z.string() }).strict() }).strict()),
    wkLandingStatusAdapter: async () => { calls++; return { accepted: true, landing: {
      state: "awaiting_human_landing", selection, selection_authenticated: true,
      transport: "local", landing_authority: "human_git_actor",
      handoff: { commit: selection.head, base_branch: "main", handoff_ref: "refs/fixture/handoff" }
    } }; }
  }).respond({ subject, selection });
  const bytes = () => Object.fromEntries(readdirSync(stateDir, { recursive: true }).map(String)
    .filter((name) => statSync(path.join(stateDir, name)).isFile())
    .map((name) => [name, readFileSync(path.join(stateDir, name))]));
  const retained = bytes();
  const cold = createCheckLandingTask({ workspace, env,
    wkLandingStatusAdapter: () => assert.fail("original read observed the live publication") });
  const original = await cold.readOriginal(pending.originalRequest);
  assert.equal(original.structuredContent.state, "awaiting_human_landing");
  assert.equal(original.structuredContent.landing_action.head, selection.head);
  assert.equal(original.structuredContent.next_calls, undefined);
  for (const request of [{ ...pending.originalRequest, subject: "WK-9999" },
    { ...pending.originalRequest, source: { ...pending.source, sha256: "0".repeat(64) } }]) {
    const refused = await cold.readOriginal(request);
    assert.equal(refused.isError, true);
    assert.equal(JSON.stringify(refused).includes(selection.head), false);
  }
  const differentAuthority = createCheckLandingTask({ workspace,
    env: { ...env, WIKI_MCP_TOOL_PROFILE: "operator" } });
  assert.equal((await differentAuthority.readOriginal(pending.originalRequest)).isError, true);
  for (const [name, options, reason, stage] of [
    ["forbidden role", { workspace, env: { ...env, WIKI_MCP_TOOL_PROFILE: "worker" } },
      "check_landing_role_forbidden", "entitlement"],
    ["missing profile", { workspace, env: { ...env, WIKI_MCP_TOOL_PROFILE: undefined } },
      "check_landing_session_profile_unavailable", "session"],
    ["missing workspace", { workspace: null, env },
      "check_landing_session_repository_missing", "session"]
  ]) {
    await t.test(`original read refuses ${name} before retrieving content`, async () => {
      const refused = await createCheckLandingTask({ ...options, responseEnv: env,
        wkLandingStatusAdapter: () => { calls++; assert.fail("original read invoked the observer"); }
      }).readOriginal(pending.originalRequest);
      assert.equal(refused.structuredContent.blocker?.reason, reason, JSON.stringify(refused.structuredContent));
      assert.equal(refused.structuredContent.blocker.detail.stage, stage);
      assert.equal(refused.structuredContent.subject.unit, subject);
      assert.equal(JSON.stringify(refused).includes(selection.head), false);
      assert.deepEqual(bytes(), retained);
      assert.equal(calls, 2);
    });
  }
  assert.deepEqual(bytes(), retained);
  assert.equal(calls, 2);
});

function harness(adapter, responseEnv = undefined) {
  const calls = { adapter: [], workspace: [] };
  let tool;
  registerLandingStatusRoute({
    registerTool: (name, config, handler) => { tool = { name, config, handler }; },
    ...(responseEnv === undefined ? {} : { responseEnv }),
    workspaceRepos: [], z, jsonContent: (value) => value,
    resolveWorkspaceRepo: (...args) => { calls.workspace.push(args); return {}; },
    invokeWkLandingStatusAdapter: adapter && (async (unit) => {
      calls.adapter.push(unit);
      return adapter(unit);
    })
  });
  return { calls, tool };
}

test("complete answers need no storage recovery and preserve native observation failures", async t => {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const root = mkdtempSync(path.join(os.tmpdir(), "landing-storage-failure-"));
  scope.add("response storage fixture", () => rmSync(root, { recursive: true, force: true }));
  const blocked = path.join(root, "not-a-directory");
  writeFileSync(blocked, "file");
  const task = createCheckLandingTask({ workspace: { repo: "fixture", dir: root },
    env: { ...process.env, WIKI_MCP_TOOL_PROFILE: "orchestrator", WIKI_MCP_RESPONSE_STATE_DIR: blocked },
    wkLandingStatusAdapter: async () => ({ accepted: true, landing: { state: "landed",
      effects: { object_cache_fetch: "not_attempted" } } }) });
  const answer = (await task.call({ subject: "WK-2739" })).structuredContent;
  assert.equal(answer.state, "landed");
  assert.equal(answer.next_calls, undefined);
  assert.equal(answer.saved_observation_unavailable, undefined);
  assert.deepEqual(answer, { accepted: true, subject: { repo: "fixture", unit: "WK-2739" },
    request_mode: "current", state: "landed" });
  for (const thrown of [null, "native observation failure"]) {
    const failing = createCheckLandingTask({ workspace: { repo: "fixture", dir: root },
      env: { ...process.env, WIKI_MCP_TOOL_PROFILE: "orchestrator", WIKI_MCP_RESPONSE_STATE_DIR: path.join(root, "responses") },
      wkLandingStatusAdapter: async () => { throw thrown; } });
    const failure = (await failing.call({ subject: "WK-2739" })).structuredContent;
    assert.equal(failure.accepted, false);
    assert.equal(failure.effects, null, JSON.stringify(failure));
    assert.deepEqual(failure.blocker.detail.failures, [{ value: thrown }]);
  }
});

test("failed optional action navigation delivers the complete inline action without repeating observation", async t => {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const root = mkdtempSync(path.join(os.tmpdir(), "landing-reader-failure-"));
  scope.add("reader failure fixture", () => rmSync(root, { recursive: true, force: true }));
  let observations = 0;
  const task = createCheckLandingTask({ workspace: { repo: "fixture", dir: root },
    env: { ...process.env, WIKI_MCP_TOOL_PROFILE: "orchestrator", WIKI_MCP_RESPONSE_STATE_DIR: root },
    ownerCall: () => { throw new Error("could not construct landing action reader"); },
    ownerRequestSchema: selectedResponseRequestSchema(z.object({ reference: z.object({ ref_id: z.string() }).strict() }).strict()),
    wkLandingStatusAdapter: async () => { observations++; return { accepted: true, landing: {
      state: "awaiting_human_landing", transport: "local", landing_authority: "human_git_actor",
      handoff: { commit: "b".repeat(40), base_branch: "main", handoff_ref: "refs/fixture/handoff" }
    } }; } });
  const result = await task.call({ subject: "WK-2739" });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.state, "awaiting_human_landing");
  assert.deepEqual(result.structuredContent.landing_action, { actor: "human_git_actor", action: "land_exact_handoff_head",
    head: "b".repeat(40), base_branch: "main", ref: "refs/fixture/handoff" });
  assert.equal(result.structuredContent.next_calls, undefined);
  assert.equal(result.structuredContent.saved_observation_unavailable, undefined);
  assert.equal(observations, 1);
});

test("the landing-status route is registered read-only with a closed input", () => {
  const { tool } = harness(null);
  assert.equal(tool.name, "workspace_wk_landing_status");
  assert.match(tool.config.description, /Read-only/u);
  assert.equal(tool.config.inputSchema.safeParse({ assigned_unit: "WK-2672", candidate: "x" }).success, false,
    "caller input cannot name candidate, ref or landing facts");
});

test("every landing observation state is a successful read carried unchanged", async () => {
  for (const state of ["awaiting_human_landing", "landed", "contradictory", "unavailable"]) {
    const landing = Object.freeze({ state, cause: state === "unavailable" ? { reason: "r" } : null });
    const h = harness(async () => ({ accepted: true, landing }));
    const result = await h.tool.handler({ assigned_unit: "WK-2672", repo: "demo" });
    assert.deepEqual(result, {
      schema_version: "workspace-wk-landing-status.v1",
      assigned_unit: "WK-2672",
      landing,
      blocker: null
    }, state);
    assert.deepEqual(h.calls.adapter, ["WK-2672"]);
  }
});

test("a malformed subject, an absent observer and an observer refusal refuse with no continuation", async () => {
  const invalid = harness(async () => assert.fail("adapter called"));
  const malformed = await invalid.tool.handler({ assigned_unit: "WK-1" });
  assert.equal(malformed.blocker.reason, "wk_landing_status_subject_invalid");
  assert.equal(malformed.refusal.no_supported_route, true);
  assert.deepEqual(invalid.calls, { adapter: [], workspace: [] });

  const absent = await harness(null).tool.handler({ assigned_unit: "WK-2672" });
  assert.equal(absent.blocker.code, "backend_unavailable");
  assert.equal(absent.blocker.reason, "wk_landing_status_observer_unavailable");

  const refusal = { ok: false, category: "request_invalid", detail: { reason: "invalid_request" } };
  const refused = await harness(async () => ({ accepted: false, refusal })).tool.handler({ assigned_unit: "WK-2672" });
  assert.equal(refused.blocker.reason, "wk_landing_status_refused");

  const { detail: observerDetail, ...observerIdentity } = refusal;
  assert.deepEqual(refused.refusal.carried.landing_observer_refusal, observerIdentity);
  assert.deepEqual(refused.blocker.detail.refusal, { ...observerIdentity, detail: observerDetail });

  const thrown = await harness(async () => { throw new Error("observer exploded"); })
    .tool.handler({ assigned_unit: "WK-2672" });
  assert.deepEqual([thrown.blocker.code, thrown.blocker.reason],
    ["mcp_response.handler_exception.v1", "dispatch_tool_exception"]);
});

function spillInventory(stateDir) {
  try {
    return readdirSync(stateDir, { recursive: true }).map(String).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

test("an observed landing cause is published as its specific cause; repeated reads withhold raw output and write nothing", async (t) => {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "landing-status-state-"));
  scope.add("response-state-dir", () => rmSync(stateDir, { recursive: true, force: true }));
  const carrier = Object.freeze({ schema_version: "landed-publication.v1", commit: "a".repeat(40) });
  const landing = { state: "unavailable", landed_publication: carrier, cause: {
    code: "agent_launch.wk_landing.observation_failed.v1", stage: "remote_query",
    native: { argv: ["git", "ls-remote"], stdout: "y".repeat(2048) },
    evidence: { schema_version: "agent_launch.diagnostic_evidence.v1", value: {
      $type: "Error", name: "Error", message: "remote query failed", stack: "Error: remote query failed\n    at /opt/y.mjs:2:2",
      properties: { code: "agent_launch.wk_landing.observation_failed.v1" } }, segments: [], capture_failures: [] } } };
  const refusal = { ok: false, category: "observation_failed",
    detail: { reason: "remote_query_failed", stderr: "RAW-LANDING-STDERR" } };
  const h = harness(async (unit) => (unit === "WK-2672"
    ? { accepted: true, landing } : { accepted: false, refusal }), { WIKI_MCP_RESPONSE_STATE_DIR: stateDir });
  const reads = [];
  for (let index = 0; index < 3; index += 1) {
    reads.push(await h.tool.handler({ assigned_unit: "WK-2672" }));
    reads.push(await h.tool.handler({ assigned_unit: "WK-2673" }));
  }
  const [observed, refused] = reads;
  assert.equal(observed.blocker, null);
  assert.equal(observed.landing.state, "unavailable");
  assert.deepEqual(observed.landing.landed_publication, carrier, "the landed carrier crosses unchanged");
  assert.equal(observed.landing.cause.code, "agent_launch.wk_landing.observation_failed.v1");
  assert.equal(observed.landing.cause.stage, "remote_query");
  assert.deepEqual(observed.landing.cause.native, { argv: ["git", "ls-remote"] },
    "the native invocation facts stay; only its captured output is withheld");
  assert.deepEqual(observed.landing.cause.evidence.cause_chain, [{ name: "Error",
    code: "agent_launch.wk_landing.observation_failed.v1", message: "remote query failed" }]);
  assert.deepEqual(observed.landing.cause.retained_evidence, {
    ...DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION, audience: "operator",
    fields: ["detail.native.stdout", "detail.evidence"]
  });
  assert.equal(refused.blocker.reason, "wk_landing_status_refused");
  assert.equal(refused.blocker.detail.refusal.detail.reason, "remote_query_failed");
  assert.deepEqual(refused.blocker.detail.refusal.detail.retained_evidence.fields, ["detail.stderr"]);
  for (const [index, read] of reads.entries()) {
    assert.deepEqual(read, reads[index % 2], "every read of the same observation answers identically");
    const serialized = JSON.stringify(read);
    for (const raw of ["y".repeat(2048), "/opt/y.mjs", "RAW-LANDING-STDERR", "ref_id"]) {
      assert.equal(serialized.includes(raw), false, `read ${index} published ${raw}`);
    }
  }
  assert.deepEqual(spillInventory(stateDir), [], "no landing read, successful or refused, retains an artifact");
  assert.deepEqual(h.calls.adapter, ["WK-2672", "WK-2673", "WK-2672", "WK-2673", "WK-2672", "WK-2673"]);
});
