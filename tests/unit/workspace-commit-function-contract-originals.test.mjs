

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { measureMcpInlineResultBytes } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { selectedResponseDeliveryBound } from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";
import { createDeliveryOriginals } from "../../packages/wiki-mcp/src/lib/task-deliver-work-result.mjs";
import {
  ASSIGNED_UNIT,
  BASE_SHA,
  COMMIT_SHA,
  TREE_SHA,
  WORKSPACE_DIR,
  WORKSPACE_REPO,
  exactSliceBinding,
  installIdentityStoreEnv,
  installState,
  publishedExactSliceAdvance,
  registerCommitTool
} from "../helpers/workspace-commit-function-contract-harness.mjs";

const SLICE_REF = "refs/heads/slice/IN-0011/WK-1429/SLICE-004";
const EXISTING_DELIVERY = "d".repeat(40);
const CONCURRENT_TIP = "e".repeat(40);
const PERSISTENCE_FAILED = "mcp_response.spill_persistence_failed.v1";
const BEFORE_PUBLICATION = ["resolve_binding", "materialize", "verify_measure"];
const PUBLISHED = [...BEFORE_PUBLICATION, "commit_slice_ref"];
const TRANSITIONED = [...PUBLISHED, "transition"];
const COMPENSATED = [...TRANSITIONED, "compensate_slice_ref"];
const NOT_ATTEMPTED = { state: "not_attempted" };

const assignedUnit = () => ({
  kind: "slice", address: ASSIGNED_UNIT, record_id: "WK-1429", slice_id: "SLICE-004", repo: WORKSPACE_REPO
});
const transitionResult = (overrides = {}) => ({
  valid: true, written: true, no_op: false, record_id: "WK-1429", selected_unit: assignedUnit(), status: "review",
  source_digest: `sha256:${"1".repeat(64)}`, generation_transition: { transition: "same_generation" },
  changed_fields: ["slices[0].status"], diagnostics: [{ code: "writer.note", detail: { nested: [null, 0, ""] } }],
  unfamiliar_writer_field: { kept: true }, ...overrides
});
const advance = (overrides = {}) => publishedExactSliceAdvance({
  owner_observation: { reread: [BASE_SHA, COMMIT_SHA], unfamiliar: { deep: [1, { two: null }] } }, ...overrides
});
const thrown = (message, fields = {}, nested = null) => Object.assign(
  nested === null ? new Error(message) : new Error(message, { cause: nested }), fields);

async function deliver(t, overrides = {}, args = {}) {
  const binding = overrides.binding ?? exactSliceBinding({ output_branch: SLICE_REF });
  installIdentityStoreEnv(t, binding);
  const state = installState({ binding, advanced: advance(), transitionResult: transitionResult(), ...overrides });
  const tool = await registerCommitTool(t);
  const stateDir = process.env.WIKI_MCP_RESPONSE_STATE_DIR;
  const invoke = async () => {
    const result = await tool.handler(args);
    return { result, payload: result.structuredContent };
  };

  const read = (locator) => createDeliveryOriginals({
    workspace: { repo: WORKSPACE_REPO, dir: WORKSPACE_DIR },
    binding,
    credential: { launchRef: binding.launch_ref, runId: binding.run_id, retryId: binding.retry_id },
    assignedUnit: ASSIGNED_UNIT,
    responseEnv: { WIKI_MCP_RESPONSE_STATE_DIR: stateDir }
  }).read({ result: locator });

  const retained = () => !existsSync(stateDir) ? []
    : readdirSync(stateDir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
      .map((entry) => readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
      .filter((text) => text.includes('"selected-response-source.v1"'))
      .map((text) => JSON.parse(text)).filter((envelope) => envelope.binding?.route === "workspace_deliver_work");
  const ops = () => state.calls.map((call) => call.op);
  return { ...(await invoke()), invoke, state, binding, read, retained, ops, stateDir };
}

function assertRetained(payload) {
  assert.deepEqual(Object.keys(payload.original).sort(), ["available", "locator", "operator_only"]);
  assert.equal(payload.original.available, true);
  assert.equal(payload.original.operator_only, true);
  assert.deepEqual(Object.keys(payload.original.locator).sort(), ["ref_id", "sha256"]);
  return payload.original.locator;
}

function assertIdentity(original, binding) {
  assert.deepEqual(original.identity, {
    repository: WORKSPACE_REPO, unit: ASSIGNED_UNIT, launch_ref: binding.launch_ref, run_id: binding.run_id,
    retry_id: binding.retry_id, binding
  });

  assert.equal(Object.hasOwn(original.identity.binding, "subject"), false);
}

function assertOutcome(original, payload, isError) {
  const { original: _status, ...response } = payload;
  assert.deepEqual(original.outcome, { is_error: isError, response: JSON.parse(JSON.stringify(response)) });
}

test("an admitted delivery retains one complete original of the raw owner observations", async (t) => {
  const delivery = await deliver(t);
  const { payload, state, binding } = delivery;
  assert.equal(payload.committed, true);
  const original = delivery.read(assertRetained(payload));

  assertIdentity(original, binding);
  assert.deepEqual(original.materialization, { state: "returned", result: state.materialized });
  assert.deepEqual(original.scope_verification, { state: "returned", result: state.scope });
  assert.deepEqual(original.publication, { state: "returned", result: advance() });
  assert.deepEqual(original.canonical_review.result, transitionResult());
  assert.equal(original.canonical_review.state, "returned");
  assert.equal(original.canonical_review.validation.ok, true);
  assert.deepEqual(original.compensation, NOT_ATTEMPTED);
  assertOutcome(original, payload, false);

  assert.equal(JSON.stringify(payload).includes("owner_observation"), false);
  assert.equal(JSON.stringify(payload.transaction).includes("unfamiliar_writer_field"), false);
  assert.deepEqual(original.publication.result.owner_observation.unfamiliar, { deep: [1, { two: null }] });
  assert.deepEqual(original.canonical_review.result.unfamiliar_writer_field, { kept: true });
  assert.equal(original.scope_verification.result.refusal, null);

  assert.equal(JSON.stringify(original).includes("contract_generation"), false);

  assert.deepEqual(delivery.ops(), TRANSITIONED);
  assert.equal(delivery.retained().length, 1, "one original for one admitted invocation");
});

test("a replay is its own original and leaves the earlier one unchanged", async (t) => {
  const delivery = await deliver(t);
  const first = assertRetained(delivery.payload);
  const firstOriginal = delivery.read(first);

  delivery.state.advanced = advance({ commit: EXISTING_DELIVERY, idempotent: true, ref_advanced: false });
  delivery.state.transitionResult = transitionResult({ written: false, no_op: true });
  const replay = await delivery.invoke();
  const second = assertRetained(replay.payload);
  assert.notDeepEqual(second, first);
  const replayOriginal = delivery.read(second);

  assert.equal(replayOriginal.materialization.result.commit, COMMIT_SHA);
  assert.equal(replayOriginal.publication.result.commit, EXISTING_DELIVERY);
  assert.equal(replayOriginal.publication.result.idempotent, true);
  assert.deepEqual(replayOriginal.canonical_review.result, transitionResult({ written: false, no_op: true }));
  assert.equal(replayOriginal.outcome.response.delivery_ref, "unchanged");
  assert.deepEqual(replayOriginal.compensation, NOT_ATTEMPTED);

  assert.deepEqual(delivery.read(first), firstOriginal, "reading and replaying never rewrite an earlier original");
  assert.equal(delivery.retained().length, 2);
  assert.deepEqual(delivery.ops(), [...TRANSITIONED, ...TRANSITIONED]);
});

test("refusals and thrown phases retain the owner's own result or cause, with later phases not attempted", async (t) => {
  await t.test("scope refusal", async (t) => {
    const scope = { contained: false, changed_paths: ["packages/elsewhere.mjs"], metrics: { measured: false },
      baseline: { measured: false }, attestation: { state: "not_attested" },
      expected_envelope_invariant: { checked: true, ok: true, blocking: false },
      refusal: { code: "OUT_OF_SCOPE", out_of_scope: ["packages/elsewhere.mjs"], owner_detail: { depth: [1, 2] } } };
    const delivery = await deliver(t, { scope });
    assert.equal(delivery.payload.decision_code, "commit.write_scope_refused.v1");
    const original = delivery.read(assertRetained(delivery.payload));
    assert.deepEqual(original.scope_verification, { state: "returned", result: scope });
    assert.deepEqual([original.publication, original.canonical_review, original.compensation],
      [NOT_ATTEMPTED, NOT_ATTEMPTED, NOT_ATTEMPTED]);
    assertOutcome(original, delivery.payload, false);
    assert.deepEqual(delivery.ops(), BEFORE_PUBLICATION);
    assert.equal(delivery.retained().length, 1);
  });

  for (const [stage, injection, ops, attempted] of [
    ["materialization", "materializationError", ["resolve_binding", "materialize"], []],
    ["scope_verification", "scopeError", BEFORE_PUBLICATION, ["materialization"]],
    ["publication", "publicationError", PUBLISHED, ["materialization", "scope_verification"]]
  ]) {
    await t.test(`${stage} exception`, async (t) => {
      const delivery = await deliver(t, { [injection]: thrown(`${stage} cause marker`,
        { code: `E_${stage.toUpperCase()}`, detail: { ref: SLICE_REF, observed_tip: CONCURRENT_TIP, owner: [stage] } },
        thrown(`nested ${stage} cause marker`)) });
      assert.equal(delivery.result.isError, true);
      assert.equal(delivery.payload.stage, stage);
      const original = delivery.read(assertRetained(delivery.payload));
      assert.equal(original[stage].state, "threw");
      assert.equal(original[stage].cause.message, `${stage} cause marker`);
      assert.equal(original[stage].cause.code, `E_${stage.toUpperCase()}`);
      assert.deepEqual(original[stage].cause.detail, { ref: SLICE_REF, observed_tip: CONCURRENT_TIP, owner: [stage] });
      assert.equal(original[stage].cause.cause.message, `nested ${stage} cause marker`);
      for (const phase of ["materialization", "scope_verification", "publication", "canonical_review",
        "compensation"]) {
        if (phase === stage) continue;
        assert.equal(original[phase].state, attempted.includes(phase) ? "returned" : "not_attempted", phase);
      }
      assertOutcome(original, delivery.payload, true);
      assert.deepEqual(delivery.ops(), ops);
      assert.equal(delivery.retained().length, 1);
    });
  }

  await t.test("transition refusal with compensation return", async (t) => {
    const refusedWrite = transitionResult({ valid: false, written: null, status: null,
      publication_state: "unknown", current_source_digest: `sha256:${"2".repeat(64)}` });
    const compensationResult = { compensated: true, ref: SLICE_REF, published_commit: COMMIT_SHA,
      restored_tip: BASE_SHA, owner_reread: { before: COMMIT_SHA, after: BASE_SHA } };
    const delivery = await deliver(t, { transitionResult: refusedWrite, compensationResult });
    assert.equal(delivery.payload.decision_code, "commit.review_transition_failed_compensated.v1");
    assert.equal(delivery.payload.submitted_for_review, null);
    const original = delivery.read(assertRetained(delivery.payload));

    assert.deepEqual(original.canonical_review.result, refusedWrite);
    assert.equal(original.canonical_review.validation.ok, false);
    assert.equal(original.canonical_review.validation.reason, "write_not_confirmed");
    assert.deepEqual(original.compensation, { state: "returned", result: compensationResult });
    assert.equal(JSON.stringify(delivery.payload).includes("owner_reread"), false);
    assert.equal(JSON.stringify(delivery.payload).includes("current_source_digest"), false);
    assert.equal(original.outcome.response.submitted_for_review, null);
    assert.deepEqual(delivery.ops(), COMPENSATED);
    assert.equal(delivery.retained().length, 1);
  });

  await t.test("transition throw with compensation throw", async (t) => {
    const delivery = await deliver(t, {
      transitionError: thrown("transition cause marker", { code: "work_record.write_failed.v1" },
        thrown("nested transition cause marker", { detail: { errno: -5 } })),
      compensationError: thrown("compensation cause marker", {
        code: "agent_launch.slice_integration.slice_commit_compensation_cas_lost.v1",
        detail: { observed_tip: CONCURRENT_TIP, owner_status: 128 } }, thrown("nested compensation cause marker"))
    });
    assert.equal(delivery.payload.decision_code, "commit.exact_slice_transaction_partial.v1");
    const original = delivery.read(assertRetained(delivery.payload));
    assert.equal(original.canonical_review.state, "threw");
    assert.equal(original.canonical_review.cause.message, "transition cause marker");
    assert.deepEqual(original.canonical_review.cause.cause.detail, { errno: -5 });
    assert.equal(original.compensation.state, "threw");
    assert.equal(original.compensation.cause.message, "compensation cause marker");
    assert.deepEqual(original.compensation.cause.detail, { observed_tip: CONCURRENT_TIP, owner_status: 128 });
    assert.equal(original.compensation.cause.cause.message, "nested compensation cause marker");
    assert.deepEqual(original.publication, { state: "returned", result: advance() });
    assert.equal(original.outcome.response.delivery_ref, "unknown");
    assert.deepEqual(delivery.ops(), COMPENSATED);
    assert.equal(delivery.retained().length, 1);
  });
});

test("a rejected binding or input retains nothing and claims no original", async (t) => {
  for (const [label, overrides, args] of [
    ["WK output branch", { binding: exactSliceBinding({ output_branch: "wk/IN-0011/WK-1429" }) }, {}],
    ["sibling selected unit", { binding: exactSliceBinding({ selected_unit: { ...assignedUnit(), kind: "wk" } }) }, {}],
    ["message argument", {}, { message: "worker text" }],
    ["null argument", {}, null]
  ]) {
    await t.test(label, async (t) => {
      const delivery = await deliver(t, overrides, args);
      assert.equal(delivery.result.isError, true);
      assert.equal(JSON.stringify(delivery.result).includes('"original"'), false);
      assert.deepEqual(delivery.retained(), []);
      assert.equal(delivery.ops().some((op) => op !== "resolve_binding"), false);
    });
  }
});

function assertOutputFailure(delivery, { stage, causeCode, settled }) {
  const { result, payload } = delivery;
  assert.equal(result.isError, true);
  assert.deepEqual(payload.output, {
    state: "failed", failed_output: "complete_original", stage, unit: ASSIGNED_UNIT,
    response_state_owner: "wiki-mcp response state (WIKI_MCP_RESPONSE_STATE_DIR)", recoverable: false
  });
  assert.equal(payload.original.available, false);
  assert.equal(payload.original.locator, null);
  assert.equal(payload.original.retention_failure.retained, false);
  assert.equal(payload.original.retention_failure.failed_operation, "retain_delivery_original");
  if (causeCode !== undefined) assert.equal(payload.original.retention_failure.cause_code, causeCode);
  for (const [fact, value] of Object.entries(settled)) assert.deepEqual(payload[fact], value, fact);
  assert.ok(measureMcpInlineResultBytes(payload, { isError: true }) <= selectedResponseDeliveryBound(process.env),
    "the output failure stays within the response bound");
  assert.deepEqual(delivery.retained(), [], "nothing was retained in part");
}

test("an original that cannot be kept reports output failure without changing the transaction", async (t) => {
  await t.test("unsupported owner data fails serialization after a settled success", async (t) => {
    const delivery = await deliver(t, { transitionResult: transitionResult({ opaque: new Map([["k", 1]]) }) });
    assertOutputFailure(delivery, { stage: "original_serialization", settled: {
      committed: true, commit_object: "created", delivery_ref: "advanced", submitted_for_review: true,
      commit: COMMIT_SHA, ref: SLICE_REF } });
    assert.match(JSON.stringify(delivery.payload.original.retention_failure),
      /workspace_deliver_work\.original\.canonical_review\.result\.opaque must be a plain object/u);
    assert.equal(delivery.payload.transaction.delivery_commit, COMMIT_SHA);

    assert.deepEqual(delivery.ops(), TRANSITIONED);
  });

  const obstruct = (delivery) => {
    const obstruction = path.join(path.dirname(delivery.stateDir), "not-a-directory");
    writeFileSync(obstruction, "");
    process.env.WIKI_MCP_RESPONSE_STATE_DIR = path.join(obstruction, "state");
    return obstruction;
  };

  await t.test("persistence failure after a settled success", async (t) => {
    const delivery = await deliver(t);
    const kept = delivery.retained();
    assert.equal(kept.length, 1);
    const obstruction = obstruct(delivery);
    const failed = await delivery.invoke();
    assertOutputFailure({ ...failed, retained: () => [] }, { stage: "original_retention",
      causeCode: PERSISTENCE_FAILED, settled: { committed: true, commit_object: "created",
        delivery_ref: "advanced", submitted_for_review: true, commit: COMMIT_SHA } });
    assert.equal(readFileSync(obstruction, "utf8"), "");

    assert.deepEqual(delivery.ops(), [...TRANSITIONED, ...TRANSITIONED]);
    process.env.WIKI_MCP_RESPONSE_STATE_DIR = delivery.stateDir;
    assert.deepEqual(delivery.retained(), kept, "the earlier original is untouched");
    assert.equal(delivery.read(delivery.payload.original.locator).outcome.response.committed, true);
  });

  await t.test("persistence failure keeps a partial transaction's own failure", async (t) => {
    const delivery = await deliver(t, {
      transitionError: thrown("transition cause marker", { code: "work_record.write_failed.v1" }),
      compensationError: thrown("compensation cause marker", {
        code: "agent_launch.slice_integration.slice_commit_compensation_cas_lost.v1",
        detail: { observed_tip: CONCURRENT_TIP } })
    });
    obstruct(delivery);
    delivery.state.calls.length = 0;
    const failed = await delivery.invoke();
    assertOutputFailure({ ...failed, retained: () => [] }, { stage: "original_retention",
      causeCode: PERSISTENCE_FAILED, settled: { committed: false, commit_object: "created",
        delivery_ref: "unknown", submitted_for_review: null,
        decision_code: "commit.exact_slice_transaction_partial.v1" } });
    const { transaction } = failed.payload;
    assert.equal(transaction.published_commit, COMMIT_SHA);
    assert.equal(transaction.observed_tip, CONCURRENT_TIP);
    assert.equal(transaction.canonical_review.state, "threw");
    assert.equal(transaction.canonical_review.decision_code, "work_record.write_failed.v1");
    assert.equal(transaction.compensation.state, "failed");
    assert.deepEqual(delivery.ops(), COMPENSATED);
  });

  await t.test("a cause too large for the bound is named as omitted", async (t) => {
    const delivery = await deliver(t, { publicationError: thrown("publication cause marker") });
    obstruct(delivery);
    delivery.state.calls.length = 0;
    delivery.state.publicationError = thrown(`large publication cause ${"原因🧪".repeat(40000)}`, {
      code: "agent_launch.slice_integration.slice_commit_conflict.v1",
      detail: { ref: SLICE_REF, base_sha: BASE_SHA, tree: TREE_SHA, observed_tip: CONCURRENT_TIP } });
    const failed = await delivery.invoke();
    assertOutputFailure({ ...failed, retained: () => [] }, { stage: "original_retention", settled: {
      committed: false, commit_object: "created", delivery_ref: "unchanged", submitted_for_review: false,
      stage: "publication", code: "agent_launch.slice_integration.slice_commit_conflict.v1" } });

    assert.equal(failed.payload.transaction.observed_tip, CONCURRENT_TIP);
    assert.equal(failed.payload.transaction.candidate_commit, COMMIT_SHA);
    assert.ok(failed.payload.omitted_facts.includes("message"));
    assert.ok(failed.payload.omitted_facts.includes("cause"));
    assert.equal(JSON.stringify(failed.payload).includes("原因🧪"), false);
    assert.deepEqual(delivery.ops(), PUBLISHED);
  });
});

import { createDeliverWorkSurface } from "../../packages/wiki-mcp/src/lib/task-deliver-work.mjs";
import { loadCommitExecutionDependencies } from "../helpers/workspace-commit-function-contract-harness.mjs";
import { canonicalSerializeLauncherAgentSessionContract, mintTrustedStdioMcpConduitAuthority,
  resolveLauncherAgentSessionContract } from "../../packages/agent-launch-cli/src/lib/stdio-mcp-conduit-authority.mjs";

async function composed(t, overrides = {}, { obstructStore = false, role = "worker", corruptSession = false } = {}) {
  const binding = exactSliceBinding({ output_branch: SLICE_REF });
  installIdentityStoreEnv(t, binding);
  const state = installState({ binding, advanced: advance(), transitionResult: transitionResult(), ...overrides });
  const dependencies = await loadCommitExecutionDependencies(t);
  const unit = role === "orchestrator" ? "IN-0011" : ASSIGNED_UNIT;
  const contract = resolveLauncherAgentSessionContract(mintTrustedStdioMcpConduitAuthority({
    family: "codex", role, assignedUnit: unit, workspaceDir: WORKSPACE_DIR,
    ...(role === "worker" ? { canonicalWriteScope: binding.write_scope } : {}) }));
  const bytes = canonicalSerializeLauncherAgentSessionContract(contract).toString("utf8");
  const env = { ...process.env, WIKI_MCP_TOOL_PROFILE: role, WIKI_MCP_ASSIGNED_UNIT: unit,
    WIKI_MCP_AGENT_SESSION_CONTRACT: bytes, WIKI_MCP_AGENT_SESSION_EXPECTED_CONTRACT: bytes };
  if (corruptSession) env.WIKI_MCP_ASSIGNED_UNIT = "WK-9999#SLICE-001";
  if (obstructStore) {
    const file = path.join(path.dirname(env.WIKI_MCP_RESPONSE_STATE_DIR), "obstructed");
    writeFileSync(file, "obstruction");
    env.WIKI_MCP_RESPONSE_STATE_DIR = path.join(file, "state");
  }

  const surface = createDeliverWorkSurface({ workspace: { repo: WORKSPACE_REPO, dir: WORKSPACE_DIR },
    sessionEnv: env, responseEnv: env, ...dependencies,
    finalizeCheckout: async () => ({ state: "complete", code: null, facts: { state: "complete", code: null } }) });
  const frame = await surface.prepare();
  assert.equal(frame.delivery.measured_bytes, measureMcpInlineResultBytes(frame, { isError: frame.isError }));
  assert.ok(frame.delivery.measured_bytes <= 8192);
  const original = frame.body.original.locator === null ? null : createDeliveryOriginals({
    workspace: { repo: WORKSPACE_REPO, dir: WORKSPACE_DIR }, binding,
    credential: { launchRef: binding.launch_ref, runId: binding.run_id, retryId: binding.retry_id },
    assignedUnit: ASSIGNED_UNIT, responseEnv: env
  }).read({ result: frame.body.original.locator });
  return { state, frame, original };
}

for (const [label, faults, outcome, ops, codes] of [
  ["returned transition with restored publication", { transitionResult: transitionResult({ written: false }) },
    "refused", COMPENSATED, []],
  ["thrown transition with restored publication", { transitionError: thrown("transition marker", { code: "TRANSITION" }) },
    "uncertain", COMPENSATED, ["TRANSITION"]],
  ["returned transition and lost compensation", { transitionResult: transitionResult({ written: false }),
    compensationError: thrown("compensation marker", { code: "COMPENSATION", detail: { observed_tip: CONCURRENT_TIP } }) },
    "uncertain", COMPENSATED, ["COMPENSATION"]],
  ["thrown transition and independently failed compensation", {
    transitionError: thrown("transition marker", { code: "TRANSITION", detail: { huge: "原因🧪".repeat(40000) } }),
    compensationError: thrown("compensation marker", { code: "COMPENSATION", detail: { observed_tip: CONCURRENT_TIP } }) },
    "uncertain", COMPENSATED, ["TRANSITION", "COMPENSATION"]]
]) test(`private composition: ${label}`, async t => {
  const { state, frame, original } = await composed(t, faults);
  assert.equal(frame.body.outcome, outcome);
  assert.deepEqual(state.calls.map(call => call.op), ops);
  for (const code of codes) assert.ok(frame.body.diagnostics.some(diagnostic => diagnostic.code === code));
  assert.equal(original.identity.unit, ASSIGNED_UNIT);
  assert.equal(original.canonical_review.state, faults.transitionError ? "threw" : "returned");
  assert.equal(original.compensation.state, faults.compensationError ? "threw" : "returned");
  if (faults.transitionError) assert.equal(original.canonical_review.cause.message, "transition marker");
  if (faults.compensationError) assert.equal(original.compensation.cause.message, "compensation marker");
});

for (const serializer of [true, false]) test(`private composition: ${serializer ? "serialization" : "store"} failure after success`, async t => {
  const { state, frame, original } = await composed(t,
    serializer ? { transitionResult: transitionResult({ opaque: new Map([["x", 1]]) }) } : {},
    { obstructStore: !serializer });
  assert.equal(frame.body.outcome, "delivered");
  assert.equal(frame.isError, true);
  assert.equal(frame.body.output.state, "failed");
  assert.equal(frame.body.stage, serializer ? "original_serialization" : "original_retention");
  assert.deepEqual(frame.body.selected_delivery, { commit: COMMIT_SHA, base: BASE_SHA });
  assert.equal(frame.body.next_action.action, "repair_response_state");
  assert.equal(original, null);
  assert.deepEqual(state.calls.map(call => call.op), TRANSITIONED);
});

for (const role of ["reviewer", "redteam", "orchestrator"]) test(`private composition refuses authentic ${role} before effects`, async t => {
  const { state, frame } = await composed(t, {}, { role });
  assert.equal(frame.isError, true);
  assert.equal(frame.body.subject, null);
  assert.equal(frame.body.original.availability, "not_captured");
  assert.equal(frame.body.diagnostics[0].code, "session_contract_fact_mismatch");
  assert.deepEqual(state.calls, []);
});

test("private composition refuses stale authenticated session before binding/Git/retention", async t => {
  const { state, frame } = await composed(t, {}, { corruptSession: true });
  assert.equal(frame.body.outcome, "refused");
  assert.equal(frame.isError, true);
  assert.equal(frame.body.diagnostics[0].code, "session_contract_fact_mismatch");
  assert.deepEqual(state.calls, []);
});

for (const stage of ["materialization", "scope_verification", "publication"]) test(`private composition retains thrown ${stage} original and precise failure`, async t => {
  const key = { materialization: "materializationError", scope_verification: "scopeError", publication: "publicationError" }[stage];
  const { state, frame, original } = await composed(t, { [key]: thrown(`${stage} root cause`, { code: `TEST_${stage}` }) });
  assert.equal(frame.isError, true);
  assert.equal(frame.body.stage, stage);
  assert.equal(frame.body.selected_delivery, null);
  assert.equal(frame.body.effects.submitted_for_review, false);
  assert.equal(frame.body.changed_path_count, stage === "publication" ? 1 : null);
  assert.equal(frame.body.outcome, stage === "scope_verification" ? "refused" : "uncertain");
  assert.equal(original[stage].cause.message, `${stage} root cause`);
  assert.equal(original.canonical_review.state, "not_attempted");
  assert.ok(!state.calls.some(call => call.op === "transition"));
});

test("private composition keeps scope containment refusal and its full measured original", async t => {
  const scope = { contained: false, changed_paths: ["outside/file"], refusal: {
    code: "agent_launch.commit_scope_envelope.out_of_scope.v1", out_of_scope: ["outside/file"],
    detail: "large scope marker 🧪".repeat(30000) } };
  const { state, frame, original } = await composed(t, { scope });
  assert.equal(frame.body.outcome, "refused");
  assert.equal(frame.body.selected_delivery, null);
  assert.equal(frame.body.changed_path_count, 1);
  assert.equal(frame.body.next_action.action, "repair_containment");
  assert.equal(frame.body.diagnostics[1].code, scope.refusal.code);
  assert.deepEqual(original.scope_verification.result, scope);
  assert.deepEqual(state.calls.map(call => call.op), BEFORE_PUBLICATION);
});
