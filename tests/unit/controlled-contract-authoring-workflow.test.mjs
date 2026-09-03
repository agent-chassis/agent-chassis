import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { registerControlledContractTools } from
  "../../packages/wiki-mcp/src/lib/controlled-contract-tools.mjs";
import { errorContent, jsonContent } from
  "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

import {
  buildProofAuthoringSkeletonOperation,
  buildProofPlanOperation,
  continueControlledContractAuthoringOperation,
  continueControlledContractProofGraphOperation,
  controlledContractAuthoringStateOperation,
  discoverControlledProofIntentsOperation
} from "../../packages/wiki-core/src/operations/controlled-contract.mjs";
import {
  clearControlledContractAuthoringContinuationsForTest,
  controlledContractCarrierFilename,
  controlledContractContentDigest,
  controlledContractPackCarrierFilename,
  getControlledContractAuthoringContinuation,
  readControlledContractCarrierFile,
  resolveCanonicalControlledContractCarrierSet
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";

import {
  authenticatedSelectedPackEvaluationBasename,
  resolveManifestControlledContractCarrierFilename
} from "../../packages/wiki-core/src/lib/controlled-contract-carrier-set-evaluation.mjs";
import {
  assertOneControlledContractSemanticOwner,
  updateControlledContractAuthoringProofGraphContinuation
} from "../../packages/wiki-core/src/lib/controlled-contract-authoring-continuations.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WK_ID = "WK-2092";
const INTENTS = ["controlled-proof-intent.atomic-failure-boundary"];

test("authoring discovery honors an explicit list-mode limit", async () => {
  const result = await discoverControlledProofIntentsOperation({ limit: 28 });
  assert.equal(result.mode, "list");
  assert.equal(result.returned_count, 28);
  assert.equal(result.result_limit, 28);
  assert.ok(result.total_match_count >= result.returned_count);
  assert.equal(result.omitted_count, result.total_match_count - result.returned_count);
  assert.equal(result.truncated, result.omitted_count > 0);
});

test("authoring discovery preserves package-owned oversized-query recovery", async () => {
  await assert.rejects(
    discoverControlledProofIntentsOperation({ query: "é".repeat(513), limit: 2 }),
    (error) => {
      const payload = error?.envelope?.warning?.payload;
      assert.equal(payload?.reason_code, "proof_intent_discovery_query_too_large");
      assert.equal(payload.details.maximum_bytes, 1024);
      assert.equal(payload.details.byte_length, 1026);
      assert.equal(payload.details.replacement_call.tool,
        "workspace_controlled_proof_intents_discover");
      assert.equal(payload.details.replacement_call.arguments.limit, 2);
      assert.ok(Buffer.byteLength(
        payload.details.replacement_call.arguments.query, "utf8"
      ) <= 1024);
      return true;
    }
  );
});

async function fixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2099-workflow-"));
  await mkdir(path.join(repoRoot, "wiki", "contracts"), { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  for (const relative of [
    "wiki/work-records/WK-2092.json",
    "wiki/contracts/WK-2092.controlled-acceptance.json",
    "wiki/contracts/WK-2092.proof-plan-request.json",
    "wiki/contracts/WK-2092.evaluation-input.json"
  ]) await copyFile(path.join(ROOT, relative), path.join(repoRoot, relative));
  const recordPath = path.join(repoRoot, "wiki/work-records/WK-2092.json");
  const record = JSON.parse(await readFile(recordPath, "utf8"));
  record.acceptance.validation = [];
  record.slices = [];
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  const requestPath = path.join(repoRoot,
    "wiki/contracts/WK-2092.proof-plan-request.json");
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  request.selected_packs = request.selected_packs.slice(0, 1);
  request.requested_intents = INTENTS;
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  return repoRoot;
}

async function issuedProposal(repoRoot) {
  const request = JSON.parse(await readFile(path.join(
    repoRoot, "wiki/contracts/WK-2092.proof-plan-request.json"), "utf8"));
  const evaluationInput = JSON.parse(await readFile(path.join(
    repoRoot, "wiki/contracts/WK-2092.evaluation-input.json"), "utf8"));
  const selectedPack = request.selected_packs[0];
  const skeletonInput = {
    repoRoot,
    wkId: WK_ID,
    selectedPack: {
      profile_id: selectedPack.profile_id,
      profile_version: selectedPack.profile_version
    },
    requestedIntents: INTENTS,
    evaluationInput
  };
  const inspection = await buildProofAuthoringSkeletonOperation(skeletonInput);
  assert.equal(Object.hasOwn(inspection, "continuation"), false);
  const sources = {};
  for (const carrierKind of ["contract", "evaluation_input", "proof_plan_request"]) {
    sources[carrierKind] = await readControlledContractCarrierFile({
      repoRoot,
      wkId: WK_ID,
      carrierKind,
      pack: carrierKind === "evaluation_input" ? {
        profileId: selectedPack.profile_id,
        profileVersion: selectedPack.profile_version
      } : null
    });
  }

  const proposalDraft = { carrier_operations: [] };
  const issued = await buildProofAuthoringSkeletonOperation({
    ...skeletonInput, proposalDraft
  });
  await assert.rejects(readFile(path.join(repoRoot,
    "wiki/contracts/WK-2092.carrier-set-manifest.json")), { code: "ENOENT" });
  const continuationRecord = await getControlledContractAuthoringContinuation({
    repoRoot, identity: issued.continuation
  });
  return { continuation: issued.continuation,
    proposal: continuationRecord.proof_graph.proposal, inspection, proposalDraft,
    skeletonInput, sources, continuationRecord };
}

test("the bind stage derives the source declaration instead of accepting one",
  async (t) => {
    clearControlledContractAuthoringContinuationsForTest();
    const repoRoot = await fixture(t);
    const complete = await issuedProposal(repoRoot);

    assert.deepEqual(complete.continuationRecord.proof_graph.expected_sources,
      ["contract", "evaluation_input", "proof_plan_request"].map((carrierKind) => ({
        carrier_kind: carrierKind,
        presence: "present",
        expected_content_digest: complete.sources[carrierKind].content_digest
      })));

    assert.equal(Object.hasOwn(complete.proposal, "expected_sources"), false);
    assert.equal(complete.inspection.next_action.author_semantics[0]
      .required_fields.includes("expected_sources"), false);

    clearControlledContractAuthoringContinuationsForTest();
    await assert.rejects(buildProofAuthoringSkeletonOperation({
      ...complete.skeletonInput,
      proposalDraft: {
        carrier_operations: [],
        expected_sources: complete.continuationRecord.proof_graph.expected_sources
      }
    }), (error) => {
      assert.equal(error.code, "controlled_contract_request_field_forbidden");
      assert.deepEqual(error.details.fields, ["expected_sources"]);
      return true;
    });

    const reissued = await buildProofAuthoringSkeletonOperation({
      ...complete.skeletonInput,
      proposalDraft: { carrier_operations: [] }
    });
    assert.equal(reissued.continuation, complete.continuation);
    const published = await continueControlledContractProofGraphOperation({
      repoRoot, wkId: WK_ID, continuation: reissued.continuation
    });
    assert.equal(published.publication.written, true);
  });

test("bound proof-graph continuation is caller-closed and identity/source fenced",
  async (t) => {
    clearControlledContractAuthoringContinuationsForTest();
    const repoRoot = await fixture(t);
    const issued = await issuedProposal(repoRoot);
    const state = await controlledContractAuthoringStateOperation({
      repoRoot, wkId: WK_ID, continuation: issued.continuation
    });
    assert.equal(state.stage, "proof_graph_required");
    assert.deepEqual(state.next_calls, [{
      tool: "workspace_controlled_contract_proof_graph_continue",
      arguments: { wk_id: WK_ID, continuation: issued.continuation }
    }]);

    await assert.rejects(continueControlledContractProofGraphOperation({
      repoRoot, wkId: WK_ID, continuation: issued.continuation,
      proposal: issued.proposal
    }), { code: "controlled_contract_request_field_forbidden" });
    await assert.rejects(readFile(path.join(repoRoot,
      "wiki/contracts/WK-2092.carrier-set-manifest.json")), { code: "ENOENT" });
    await assert.rejects(continueControlledContractProofGraphOperation({
      repoRoot, wkId: "WK-9999", continuation: issued.continuation
    }), { code: "controlled_contract_authoring_continuation_cross_wk" });
    await assert.rejects(continueControlledContractProofGraphOperation({
      repoRoot, wkId: WK_ID, focus: "other", continuation: issued.continuation
    }), { code: "controlled_contract_authoring_continuation_cross_focus" });
    const changed = `${issued.continuation.slice(0, -1)}${
      issued.continuation.endsWith("0") ? "1" : "0"}`;
    await assert.rejects(continueControlledContractProofGraphOperation({
      repoRoot, wkId: WK_ID, continuation: changed
    }), { code: "controlled_contract_authoring_continuation_unknown" });

    const evaluationPath = path.join(repoRoot,
      "wiki/contracts/WK-2092.evaluation-input.json");
    const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
    await writeFile(evaluationPath, JSON.stringify(evaluation));
    await assert.rejects(continueControlledContractProofGraphOperation({
      repoRoot, wkId: WK_ID, continuation: issued.continuation
    }), (error) => error.code ===
      "controlled_contract_authoring_continuation_carrier_conflict" &&
      error.details.carrier_kind === "evaluation_input");
    await assert.rejects(readFile(path.join(repoRoot,
      "wiki/contracts/WK-2092.carrier-set-manifest.json")), { code: "ENOENT" });
  });

test("canonical proof-graph continuation publishes, replays, and completes through manifest reads", async (t) => {
  clearControlledContractAuthoringContinuationsForTest();
  const repoRoot = await fixture(t);
  const issued = await issuedProposal(repoRoot);
  const first = await continueControlledContractProofGraphOperation({
    repoRoot,
    wkId: WK_ID,
    continuation: issued.continuation
  });
  assert.equal(first.publication.written, true);
  assert.equal(first.publication.no_op, false);
  assert.equal(Object.hasOwn(first, "carriers"), false);
  assert.deepEqual(first.next_call, {
    tool: "workspace_controlled_contract_authoring_state",
    arguments: {
      wk_id: WK_ID,
      continuation: first.next_call.arguments.continuation
    }
  });
  assert.notEqual(first.next_call.arguments.continuation, issued.continuation);

  const replay = await continueControlledContractProofGraphOperation({
    repoRoot,
    wkId: WK_ID,
    continuation: first.next_call.arguments.continuation
  });
  assert.equal(replay.publication.written, false);
  assert.equal(replay.publication.no_op, true);
  assert.equal(replay.publication.generation, first.publication.generation);

  const selected = await resolveCanonicalControlledContractCarrierSet({
    repoRoot, wkId: WK_ID
  });
  assert.equal(selected.source, "manifest");
  const rootRequestPath = path.join(repoRoot,
    "wiki/contracts/WK-2092.proof-plan-request.json");
  const legacyRequest = JSON.parse(await readFile(rootRequestPath, "utf8"));
  assert.equal(legacyRequest.selected_packs.length, 1);
  const canonicalRequest = await readControlledContractCarrierFile({
    repoRoot, wkId: WK_ID, carrierKind: "proof_plan_request"
  });
  assert.equal(canonicalRequest.content.selected_packs.length, 1);

  const ready = await controlledContractAuthoringStateOperation({
    repoRoot, wkId: WK_ID, continuation: first.next_call.arguments.continuation
  });
  assert.equal(ready.stage, "proof_plan_ready");
  await buildProofPlanOperation({
    repoRoot, wkId: WK_ID, expectedContentDigest: null
  });
  const complete = await controlledContractAuthoringStateOperation({
    repoRoot, wkId: WK_ID
  });
  assert.equal(complete.stage, "complete");
  assert.equal(complete.stop_condition, "controlled_contract_authoring_complete");
});

test("a proof-graph continuation never enters the authoring carrier write branch",
  async (t) => {
    clearControlledContractAuthoringContinuationsForTest();
    const repoRoot = await fixture(t);
    const issued = await issuedProposal(repoRoot);
    const before = {};
    for (const basename of ["WK-2092.controlled-acceptance.json",
      "WK-2092.evaluation-input.json", "WK-2092.proof-plan-request.json"]) {
      before[basename] = await readFile(
        path.join(repoRoot, "wiki/contracts", basename), "utf8");
    }

    const bound = await continueControlledContractAuthoringOperation({
      repoRoot, wkId: WK_ID, continuation: issued.continuation
    });
    assert.equal(bound.stage, "proof_graph_required");
    assert.equal(bound.continuation, issued.continuation);
    assert.deepEqual(bound.next_calls, [{
      tool: "workspace_controlled_contract_proof_graph_continue",
      arguments: { wk_id: WK_ID, continuation: issued.continuation }
    }]);

    for (const expectedStage of ["evaluation_input_ready", "proof_plan_request_ready"]) {
      await assert.rejects(continueControlledContractAuthoringOperation({
        repoRoot, wkId: WK_ID, continuation: issued.continuation, expectedStage
      }), (error) => {
        assert.equal(error.code, "controlled_contract_authoring_continuation_stale");
        assert.equal(error.details.expected_stage, expectedStage);
        assert.equal(error.details.actual_stage, null);
        assert.equal(error.details.replacement_call.tool,
          "workspace_controlled_contract_authoring_state");
        return true;
      });
    }

    for (const [basename, bytes] of Object.entries(before)) {
      assert.equal(await readFile(
        path.join(repoRoot, "wiki/contracts", basename), "utf8"), bytes, basename);
    }
    await assert.rejects(readFile(path.join(repoRoot,
      "wiki/contracts/WK-2092.carrier-set-manifest.json")), { code: "ENOENT" });

    const published = await continueControlledContractProofGraphOperation({
      repoRoot, wkId: WK_ID, continuation: issued.continuation
    });
    assert.equal(published.publication.written, true);
    const replayed = await continueControlledContractAuthoringOperation({
      repoRoot, wkId: WK_ID,
      continuation: published.next_call.arguments.continuation
    });
    assert.equal(Object.hasOwn(replayed, "stop_condition") ||
      replayed.next_calls.length === 1, true);
    assert.notEqual(replayed.stage, "evaluation_input_ready");
    assert.notEqual(replayed.stage, "proof_plan_request_ready");
  });

test("a server-completed proposal preserves its content-addressed continuation",
  async (t) => {
    clearControlledContractAuthoringContinuationsForTest();
    const repoRoot = await fixture(t);
    const issued = await issuedProposal(repoRoot);
    const evaluationPath = path.join(repoRoot,
      "wiki/contracts/WK-2092.evaluation-input.json");
    const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
    await unlink(evaluationPath);
    const draft = structuredClone(issued.proposalDraft);
    draft.carrier_operations = [{
      kind: "carrier_patch",
      carrier_kind: "evaluation_input",
      op: "upsert",
      target: "reference_bindings",
      value: evaluation.reference_bindings[0]
    }];

    const request = JSON.parse(await readFile(path.join(
      repoRoot, "wiki/contracts/WK-2092.proof-plan-request.json"), "utf8"));
    const selectedPack = request.selected_packs[0];
    const bound = await buildProofAuthoringSkeletonOperation({
      repoRoot, wkId: WK_ID,
      selectedPack: { profile_id: selectedPack.profile_id,
        profile_version: selectedPack.profile_version },
      requestedIntents: INTENTS,
      evaluationInput: evaluation,
      proposalDraft: draft
    });

    const initial = await getControlledContractAuthoringContinuation({
      repoRoot, identity: bound.continuation
    });
    assert.equal(initial.proof_graph.status, "bound");

    const declared = draft.carrier_operations[0];
    const evaluationPatch = (target, value) => ({ kind: "carrier_patch",
      carrier_kind: "evaluation_input", op: "upsert", target, value });
    const requestPatch = (target, value) => ({ kind: "carrier_patch",
      carrier_kind: "proof_plan_request", op: "upsert", target, value });
    assert.deepEqual(initial.proof_graph.proposal.carrier_operations, [
      declared,
      ...evaluation.reference_bindings.slice(1).map(
        (value) => evaluationPatch("reference_bindings", value)),
      ...(evaluation.number_bindings ?? []).map(
        (value) => evaluationPatch("number_bindings", value)),
      evaluationPatch("evaluation_stage", evaluation.evaluation_stage),
      ...INTENTS.map((value) => requestPatch("requested_intents", value)),
      requestPatch("selected_packs", {
        profile_id: selectedPack.profile_id,
        profile_version: selectedPack.profile_version,
        evaluation_input_path: selectedPack.evaluation_input_path
      })
    ]);

    const declaredRole = declared.value.role;
    assert.equal(initial.proof_graph.proposal.carrier_operations.filter(
      (operation) => operation.target === "reference_bindings" &&
        operation.value?.role === declaredRole).length, 1,
      "a declared server-known binding is preserved once, not restated");
    const authenticated = structuredClone(initial);
    delete authenticated.identity;
    assert.equal(controlledContractContentDigest(authenticated), initial.identity);
    const changedFence = structuredClone(authenticated);
    changedFence.proof_graph.expected_sources[0].expected_content_digest =
      `sha256:${"f".repeat(64)}`;
    assert.notEqual(controlledContractContentDigest(changedFence), initial.identity);

    const published = await continueControlledContractProofGraphOperation({
      repoRoot,
      wkId: WK_ID,
      continuation: bound.continuation
    });
    assert.equal(published.publication.written, true);
    assert.equal(published.publication.no_op, false);
    assert.equal(published.publication.proposal_digest,
      initial.proof_graph.proposal_digest);

    const advanced = published.next_call.arguments.continuation;
    assert.equal((await getControlledContractAuthoringContinuation({
      repoRoot, identity: advanced
    }))
      .proof_graph.status, "published");
    assert.equal((await getControlledContractAuthoringContinuation({
      repoRoot, identity: bound.continuation
    }))
      .proof_graph.status, "bound");
    assert.notEqual(advanced, bound.continuation);
    const recovered = await controlledContractAuthoringStateOperation({
      repoRoot,
      wkId: WK_ID,
      continuation: published.next_call.arguments.continuation
    });
    assert.notEqual(recovered.stage, "proof_authoring_required");
    assert.equal(JSON.stringify(await readFile(path.join(repoRoot,
      "wiki/contracts/WK-2092.carrier-set-manifest.json"), "utf8")).length > 0, true);
  });

async function freshSessionFixture(t) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2134-fresh-"));
  await mkdir(path.join(repoRoot, "wiki", "contracts"), { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  await copyFile(path.join(ROOT, "wiki/contracts/WK-2092.controlled-acceptance.json"),
    path.join(repoRoot, "wiki/contracts/WK-2092.controlled-acceptance.json"));
  const record = JSON.parse(await readFile(
    path.join(ROOT, "wiki/work-records/WK-2092.json"), "utf8"));
  record.acceptance.validation = [];
  record.slices = [];
  await writeFile(path.join(repoRoot, "wiki/work-records/WK-2092.json"),
    `${JSON.stringify(record, null, 2)}\n`);
  const evaluationInput = JSON.parse(await readFile(
    path.join(ROOT, "wiki/contracts/WK-2092.evaluation-input.json"), "utf8"));
  const request = JSON.parse(await readFile(
    path.join(ROOT, "wiki/contracts/WK-2092.proof-plan-request.json"), "utf8"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  return { repoRoot, evaluationInput, selectedPack: {
    profile_id: request.selected_packs[0].profile_id,
    profile_version: request.selected_packs[0].profile_version
  } };
}

const GENERIC_CARRIER_PATCH_ROUTE = "workspace_controlled_contract_carrier_patch";
const FULL_CARRIER_READ_ROUTE = "workspace_controlled_contract_carrier_read";
const SCHEMA_DISCOVERY_ROUTES = new Set([
  "workspace_controlled_contract_authoring_describe",
  "workspace_controlled_test_proof_authoring_describe"
]);

function freshSessionTraceCounts(trace, operationReadyAt) {
  return {
    attempted_actions: trace.attempts.length,
    tool_calls: trace.calls.length,
    distinct_routes: new Set(trace.calls).size,
    authoring_state_reads: trace.stages.length,
    refusals: trace.refusals.length,
    registered_route_attempts: trace.attempts.filter(
      ({ registered: known }) => known).length,
    unregistered_route_attempts: trace.attempts.filter(
      ({ registered: known }) => !known).length,
    hidden_full_carrier_reads: trace.calls.filter(
      (name) => name === FULL_CARRIER_READ_ROUTE).length,
    generic_carrier_patches: trace.calls.filter(
      (name) => name === GENERIC_CARRIER_PATCH_ROUTE).length,
    schema_discovery_retries_after_operation_ready: trace.calls
      .slice(operationReadyAt).filter((name) => SCHEMA_DISCOVERY_ROUTES.has(name)).length,
    repeated_same_invariant_refusals:
      trace.refusals.length - new Set(trace.refusals).size
  };
}

test("a fresh session reaches the stop condition on measured emitted actions",
  async (t) => {
    clearControlledContractAuthoringContinuationsForTest();
    const { repoRoot, evaluationInput, selectedPack } = await freshSessionFixture(t);
    const server = new McpServer({ name: "wk-2134-fresh", version: "1.0.0" });
    const registered = new Map();
    registerControlledContractTools({
      registerTool: (name, config, handler) => {
        registered.set(name, config);
        return server.registerTool(name, config, handler);
      },
      workspaceRepos: { currentAlias: "current" },
      z, jsonContent, errorContent,
      resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "wk-2134-fresh-client", version: "1.0.0" },
      { capabilities: {} });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    t.after(async () => { await client.close(); await server.close(); });

    const trace = { attempts: [], calls: [], refusals: [], stages: [] };
    const call = async (name, args) => {
      trace.attempts.push({ tool: name, registered: registered.has(name) });
      const result = await client.callTool({ name, arguments: args });
      trace.calls.push(name);
      if (result.isError === true) {
        trace.refusals.push(
          result.structuredContent?.warning?.payload?.reason_code ?? "unknown");
      }
      return result;
    };
    const readState = async (args) => {
      const state = await call("workspace_controlled_contract_authoring_state", args);
      assert.notEqual(state.isError, true, JSON.stringify(state.structuredContent));
      trace.stages.push(state.structuredContent.stage);
      return state.structuredContent;
    };

    const initial = await readState({ wk_id: WK_ID });
    assert.equal(initial.stage, "proof_authoring_required");
    const discovery = initial.next_calls[0];
    assert.notEqual((await call(discovery.tool, discovery.arguments)).isError, true);
    const operationReadyAt = trace.calls.length;

    const inspection = await call("workspace_controlled_proof_authoring_skeleton", {
      wk_id: WK_ID, selected_pack: selectedPack, requested_intents: INTENTS,
      evaluation_input: evaluationInput
    });
    assert.notEqual(inspection.isError, true,
      JSON.stringify(inspection.structuredContent));
    assert.equal(inspection.structuredContent.continuation_issued, false);

    const created = {};
    for (const carrierKind of ["evaluation_input", "proof_plan_request"]) {
      const receipt = await call("workspace_controlled_contract_carrier_create", {
        wk_id: WK_ID, carrier_kind: carrierKind, expected_content_digest: null,
        content: carrierKind === "evaluation_input"
          ? inspection.structuredContent.evaluation_input
          : inspection.structuredContent.proof_plan_request
      });
      assert.notEqual(receipt.isError, true, JSON.stringify(receipt.structuredContent));
      created[carrierKind] = receipt.structuredContent.content_digest;
    }

    const reissue = inspection.structuredContent.next_action;
    const contractDigest = (await readState({ wk_id: WK_ID }))
      .selected_resources.contract.content_digest;
    const issued = await call(reissue.tool, {
      ...reissue.arguments,
      proposal_draft: { carrier_operations: [] }
    });
    assert.notEqual(issued.isError, true, JSON.stringify(issued.structuredContent));
    assert.equal(issued.structuredContent.continuation_issued, true);

    let state = await readState({ wk_id: WK_ID,
      continuation: issued.structuredContent.continuation });
    while (!Object.hasOwn(state, "stop_condition")) {
      assert.equal(state.next_calls.length, 1, state.stage);
      const [next] = state.next_calls;
      const executed = await call(next.tool, next.arguments);
      assert.notEqual(executed.isError, true,
        `${next.tool}: ${JSON.stringify(executed.structuredContent)}`);
      state = await readState({ wk_id: WK_ID });
    }
    assert.equal(state.stage, "complete");
    assert.equal(state.stop_condition, "controlled_contract_authoring_complete");

    const repeated = await readState({ wk_id: WK_ID });
    assert.deepEqual(repeated, state);

    const counts = freshSessionTraceCounts(trace, operationReadyAt);
    assert.ok(counts.tool_calls > 0);
    assert.equal(counts.attempted_actions, counts.tool_calls);
    assert.equal(counts.registered_route_attempts, counts.attempted_actions,
      JSON.stringify(trace.attempts.filter(({ registered: known }) => !known)));
    assert.equal(counts.unregistered_route_attempts, 0);
    assert.equal(counts.hidden_full_carrier_reads, 0);
    assert.equal(counts.generic_carrier_patches, 0);
    assert.equal(counts.schema_discovery_retries_after_operation_ready, 0);
    assert.equal(counts.repeated_same_invariant_refusals, 0);
    assert.equal(counts.refusals, 0);
    console.log(`WK-2134 fresh-session trace: ${JSON.stringify(counts)}`);
    console.log(`WK-2134 fresh-session stages: ${trace.stages.join(" -> ")}`);
  });

test("the fresh-session trace projection reports an unregistered route attempt", () => {
  const clean = freshSessionTraceCounts({
    attempts: [{ tool: "workspace_controlled_contract_authoring_state", registered: true }],
    calls: ["workspace_controlled_contract_authoring_state"],
    refusals: [],
    stages: ["complete"]
  }, 0);
  assert.equal(clean.attempted_actions, 1);
  assert.equal(clean.registered_route_attempts, 1);
  assert.equal(clean.unregistered_route_attempts, 0);

  const contaminated = freshSessionTraceCounts({
    attempts: [
      { tool: "workspace_controlled_contract_authoring_state", registered: true },
      { tool: "workspace_controlled_contract_carrier_read", registered: false }
    ],
    calls: ["workspace_controlled_contract_authoring_state",
      "workspace_controlled_contract_carrier_read"],
    refusals: [],
    stages: ["complete"]
  }, 0);
  assert.equal(contaminated.attempted_actions, 2);
  assert.equal(contaminated.registered_route_attempts, 1);
  assert.equal(contaminated.unregistered_route_attempts, 1);
  assert.notEqual(contaminated.registered_route_attempts,
    contaminated.attempted_actions);
  assert.equal(contaminated.hidden_full_carrier_reads, 1);
});

const PROOF_WK = "WK-2392";
const PROOF_PACK = Object.freeze({
  profile_id: "proof.verification.test-validity", profile_version: "2.0.0"
});
const PROOF_INTENTS = Object.freeze([
  "controlled-proof-intent.test-verification-validity"
]);

const PROOF_BINDINGS = Object.freeze({
  reference_bindings: [
    { role: "component", reference_ids: ["ref-component"] },
    { role: "suite", reference_ids: ["ref-tests"] }
  ],
  number_bindings: []
});
const PROOF_ROLES = Object.freeze(["component", "suite"]);

async function proofFixture(t, { focus = null } = {}) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "wk-2398-slice008-"));
  const contracts = path.join(repoRoot, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  await mkdir(path.join(repoRoot, "wiki", "work-records"), { recursive: true });
  const bytes = await readFile(path.join(ROOT,
    `tests/fixtures/controlled-contract-proof-authoring-liveness/${PROOF_WK}.controlled-acceptance.json`));
  await writeFile(path.join(contracts, `${PROOF_WK}.controlled-acceptance.json`), bytes);
  if (focus !== null) {
    await writeFile(path.join(contracts,
      `${PROOF_WK}-${focus}.controlled-acceptance.json`), bytes);
  }
  const record = JSON.parse(await readFile(
    path.join(ROOT, `wiki/work-records/${PROOF_WK}.json`), "utf8"));
  record.acceptance.validation = [];
  record.slices = [];
  await writeFile(path.join(repoRoot, `wiki/work-records/${PROOF_WK}.json`),
    `${JSON.stringify(record, null, 2)}\n`);
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  clearControlledContractAuthoringContinuationsForTest();
  return repoRoot;
}

function proofDraft(carrierOperations = []) {
  return { carrier_operations: carrierOperations };
}

function bindingIdentities(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) bindingIdentities(item, found);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  for (const [key, member] of Object.entries(value)) {
    if ((key === "reference_bindings" || key === "referenceBindings") &&
        Array.isArray(member)) {
      for (const binding of member) {
        if (PROOF_ROLES.includes(binding?.role) &&
            Array.isArray(binding.reference_ids ?? binding.referenceIds)) {
          found.push(`${binding.role}=>${
            [...(binding.reference_ids ?? binding.referenceIds)].sort().join(",")}`);
        }
      }
      continue;
    }
    bindingIdentities(member, found);
  }
  return found;
}

for (const row of [
  { id: "root", focus: null },
  { id: "focused", focus: "scale" }
]) {
  test(`${row.id} proof authoring advances past the binding brick to publication`,
    async (t) => {
      const repoRoot = await proofFixture(t, { focus: row.focus });
      const focusArguments = row.focus === null ? {} : { focus: row.focus };

      const opening = await controlledContractAuthoringStateOperation({
        repoRoot, wkId: PROOF_WK, focus: row.focus
      });
      assert.equal(opening.stage, "proof_authoring_required");

      const issued = await buildProofAuthoringSkeletonOperation({
        repoRoot, wkId: PROOF_WK, focus: row.focus,
        selectedPack: { ...PROOF_PACK },
        requestedIntents: [...PROOF_INTENTS],
        bindings: structuredClone(PROOF_BINDINGS),
        proposalDraft: proofDraft()
      });
      assert.deepEqual(issued.unresolved_required_roles, [],
        "component and suite leave zero unresolved author choices");
      assert.equal(issued.continuation_issued, true);
      assert.equal(issued.evaluation_input.evaluation_stage, "pre_dispatch");

      assert.deepEqual(issued.next_action, {
        tool: "workspace_controlled_contract_authoring_state",
        arguments: { wk_id: PROOF_WK, ...focusArguments,
          continuation: issued.continuation }
      });
      const bound = await controlledContractAuthoringStateOperation({
        repoRoot, wkId: PROOF_WK, focus: row.focus,
        continuation: issued.next_action.arguments.continuation
      });
      assert.equal(bound.stage, "proof_graph_required");
      assert.equal(bound.continuation, issued.continuation);
      assert.deepEqual(bound.next_calls, [{
        tool: "workspace_controlled_contract_proof_graph_continue",
        arguments: { wk_id: PROOF_WK, ...focusArguments,
          continuation: issued.continuation }
      }]);

      const published = await continueControlledContractProofGraphOperation({
        repoRoot, wkId: PROOF_WK, focus: row.focus,
        continuation: bound.next_calls[0].arguments.continuation
      });
      assert.equal(published.publication.written, true);
      assert.equal(published.publication.no_op, false);
      assert.equal(published.publication.focus, row.focus);
      assert.equal(published.publication.profile, "canonical_authoring");

      const canonicalSet = await resolveCanonicalControlledContractCarrierSet({
        repoRoot, wkId: PROOF_WK, focus: row.focus
      });
      const evaluationName = controlledContractCarrierFilename({
        wkId: PROOF_WK, focus: row.focus, carrierKind: "evaluation_input"
      });
      const evaluation = canonicalSet.members_by_basename[evaluationName];
      assert.ok(evaluation, `${evaluationName} is the published evaluation input`);

      assert.deepEqual(
        evaluation.content.reference_bindings.map(({ role }) => role).sort(),
        [...PROOF_ROLES]);
      assert.equal(evaluation.content.evaluation_stage, "pre_dispatch");
      const requestName = controlledContractCarrierFilename({
        wkId: PROOF_WK, focus: row.focus, carrierKind: "proof_plan_request"
      });
      const request = canonicalSet.members_by_basename[requestName];
      assert.deepEqual(request.content.requested_intents, [...PROOF_INTENTS]);
      assert.deepEqual(request.content.selected_packs.map(
        ({ profile_id: id }) => id), [PROOF_PACK.profile_id]);

      for (const [label, value] of [["state", opening], ["skeleton next_action",
        issued.next_action], ["bound state", bound], ["receipt", published]]) {
        assert.deepEqual(bindingIdentities(value), [],
          `${label} must not restate the author's binding population`);
      }

      for (const [label, value] of [["opening", opening], ["issued", issued],
        ["bound", bound], ["published", published]]) {
        assert.equal(JSON.stringify(value).includes("proof_pack_authoring"), false,
          `${label} must not carry proof_pack_authoring`);
      }

      assert.equal(opening.next_calls[0].tool,
        "workspace_controlled_proof_intents_discover");
      assert.equal(JSON.stringify([issued, bound, published])
        .includes("workspace_controlled_proof_intents_discover"), false,
        "no response after issuance recovers to intent discovery");
      assert.equal(JSON.stringify([issued, bound, published])
        .includes("workspace_controlled_contract_carrier_patch"), false,
        "no generic carrier mutation route becomes reachable");
    });
}

test("each server-known proposal value is load-bearing and fails closed when contradicted",
  async (t) => {
    const contradictions = [
      { carrier_kind: "evaluation_input", target: "reference_bindings",
        id: "component" },
      { carrier_kind: "evaluation_input", target: "evaluation_stage" },
      { carrier_kind: "proof_plan_request", target: "requested_intents",
        id: PROOF_INTENTS[0] },
      { carrier_kind: "proof_plan_request", target: "selected_packs",
        id: `${PROOF_PACK.profile_id}@${PROOF_PACK.profile_version}` }
    ];
    for (const contradiction of contradictions) {
      const repoRoot = await proofFixture(t);
      const { id, ...operation } = contradiction;
      await assert.rejects(buildProofAuthoringSkeletonOperation({
        repoRoot, wkId: PROOF_WK, focus: null,
        selectedPack: { ...PROOF_PACK },
        requestedIntents: [...PROOF_INTENTS],
        bindings: structuredClone(PROOF_BINDINGS),
        proposalDraft: proofDraft([{
          kind: "carrier_patch", op: "remove", ...operation,
          ...(id === undefined ? {} : { id })
        }])
      }), (error) => {
        assert.equal(error.code,
          "controlled_contract_authoring_continuation_carrier_conflict",
          `${operation.target} must fail closed`);
        assert.equal(error.details.target, operation.target);
        assert.equal(error.details.carrier_kind, operation.carrier_kind);
        assert.equal(error.details.pointer,
          "/proposal_draft/carrier_operations/0");

        assert.deepEqual(bindingIdentities(error.details.replacement_call ?? null),
          [], "a bind-stage refusal must not repeat component or suite");
        return true;
      });

      await assert.rejects(readFile(path.join(repoRoot,
        `wiki/contracts/${PROOF_WK}.carrier-set-manifest.json`)), { code: "ENOENT" });
    }
  });

test("a compatible declared server-known value is preserved and reaches publication",
  async (t) => {
    const repoRoot = await proofFixture(t);
    const declared = {
      kind: "carrier_patch", carrier_kind: "evaluation_input", op: "upsert",
      target: "reference_bindings",
      value: structuredClone(PROOF_BINDINGS.reference_bindings[0])
    };
    const issued = await buildProofAuthoringSkeletonOperation({
      repoRoot, wkId: PROOF_WK, focus: null,
      selectedPack: { ...PROOF_PACK },
      requestedIntents: [...PROOF_INTENTS],
      bindings: structuredClone(PROOF_BINDINGS),
      proposalDraft: proofDraft([declared])
    });
    const operations = (await getControlledContractAuthoringContinuation({
      repoRoot, identity: issued.continuation
    })).proof_graph.proposal.carrier_operations;
    assert.deepEqual(operations[0], declared,
      "the caller's compatible operation is preserved verbatim, at its position");
    assert.equal(operations.filter(({ target, value }) =>
      target === "reference_bindings" && value?.role === "component").length, 1,
      "a preserved value is never also filled a second time");

    assert.deepEqual([...new Set(operations.map(
      ({ carrier_kind: kind, target }) => `${kind}/${target}`))].sort(), [
      "evaluation_input/evaluation_stage",
      "evaluation_input/reference_bindings",
      "proof_plan_request/requested_intents",
      "proof_plan_request/selected_packs"
    ]);
    const published = await continueControlledContractProofGraphOperation({
      repoRoot, wkId: PROOF_WK, focus: null, continuation: issued.continuation
    });
    assert.equal(published.publication.written, true);
  });

const READINESS_PACK = Object.freeze({
  profile_id: "proof.design.implementation-readiness", profile_version: "2.1.0"
});
const READINESS_INTENTS = Object.freeze([
  "controlled-proof-intent.implementation-readiness"
]);
const ATOMICITY_PACK = Object.freeze({
  profile_id: "proof.atomicity.failure-boundary", profile_version: "2.0.0"
});

async function readinessEvaluationInput() {
  const canonical = JSON.parse(await readFile(path.join(ROOT,
    "wiki/contracts/WK-2092.proof-plan-request.json"), "utf8"));
  const entry = canonical.selected_packs.find(({ profile_id: id }) =>
    id === READINESS_PACK.profile_id);
  assert.ok(entry, "the canonical request still carries the second pack");
  return JSON.parse(await readFile(path.join(ROOT, "wiki/contracts",
    entry.evaluation_input_path), "utf8"));
}

test("existing-request multi-pack authoring is independent of lexical insertion order",
  async (t) => {
    const summaries = [];
    for (const ordering of [
      { name: "favorable order selects the lexically later readiness pack",
        existingPack: ATOMICITY_PACK, selectedPack: READINESS_PACK,
        existingIntents: INTENTS, selectedIntents: READINESS_INTENTS,
        selectedInput: await readinessEvaluationInput() },
      { name: "reverse order selects the lexically earlier atomicity pack",
        existingPack: READINESS_PACK, selectedPack: ATOMICITY_PACK,
        existingIntents: READINESS_INTENTS, selectedIntents: INTENTS,
        selectedInput: JSON.parse(await readFile(path.join(ROOT,
          "wiki/contracts/WK-2092.evaluation-input.json"), "utf8")),
        existingInput: await readinessEvaluationInput() }
    ]) await t.test(ordering.name, async (t) => {
      clearControlledContractAuthoringContinuationsForTest();
      const repoRoot = await fixture(t);
      const legacyName = controlledContractCarrierFilename({
        wkId: WK_ID, focus: null, carrierKind: "evaluation_input"
      });
      if (ordering.existingInput !== undefined) {
        const requestPath = path.join(repoRoot,
          "wiki/contracts/WK-2092.proof-plan-request.json");
        const request = JSON.parse(await readFile(requestPath, "utf8"));
        request.selected_packs = [{ ...ordering.existingPack,
          evaluation_input_path: legacyName }];
        request.requested_intents = [...ordering.existingIntents];
        await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
        await writeFile(path.join(repoRoot,
          "wiki/contracts/WK-2092.evaluation-input.json"),
        `${JSON.stringify(ordering.existingInput, null, 2)}\n`);
      }
      const mintedName = controlledContractPackCarrierFilename({
        wkId: WK_ID, focus: null, profileId: ordering.selectedPack.profile_id,
        profileVersion: ordering.selectedPack.profile_version
      });

    const before = await resolveCanonicalControlledContractCarrierSet({
      repoRoot, wkId: WK_ID, focus: null
    });
    const persisted = before.members_by_basename[controlledContractCarrierFilename({
      wkId: WK_ID, focus: null, carrierKind: "proof_plan_request"
    })].content;
    assert.deepEqual(persisted.selected_packs.map(
      ({ evaluation_input_path: value }) => value), [legacyName],
    "the existing request binds exactly the legacy basename, to the other pack");
    assert.throws(() => resolveManifestControlledContractCarrierFilename({
      canonicalSet: before, wkId: WK_ID, focus: null,
      carrierKind: "evaluation_input",
      pack: { profileId: ordering.selectedPack.profile_id,
        profileVersion: ordering.selectedPack.profile_version }
    }), (error) => {
      assert.equal(error.code, "controlled_contract_proof_input_path_forbidden");
      return true;
    }, "unbound legacy fallback must still refuse for a genuinely unbound pack");

    const issued = await buildProofAuthoringSkeletonOperation({
      repoRoot, wkId: WK_ID, focus: null,
      selectedPack: { ...ordering.selectedPack },
      requestedIntents: [...ordering.selectedIntents],
      evaluationInput: ordering.selectedInput,
      proposalDraft: { carrier_operations: [] }
    });
    assert.deepEqual(issued.unresolved_required_roles, []);
    assert.equal(issued.continuation_issued, true);

    assert.deepEqual({ profile_id: issued.selected_pack.profile_id,
      profile_version: issued.selected_pack.profile_version },
    ordering.selectedPack);
    assert.equal(issued.selected_pack.evaluation_input_path, mintedName);
    assert.deepEqual(issued.proof_plan_request.selected_packs.find(
      ({ profile_id: id, profile_version: version }) =>
        id === ordering.existingPack.profile_id &&
        version === ordering.existingPack.profile_version),
    { ...ordering.existingPack, evaluation_input_path: legacyName });
    assert.deepEqual(issued.proof_plan_request.requested_intents.slice().sort(),
      [...INTENTS, ...READINESS_INTENTS].sort(),
      "the requested-intent union preserves the existing request's own intents");

    assert.deepEqual(issued.next_action, {
      tool: "workspace_controlled_contract_authoring_state",
      arguments: { wk_id: WK_ID, continuation: issued.continuation }
    });
    const bound = await controlledContractAuthoringStateOperation({
      repoRoot, wkId: WK_ID,
      continuation: issued.next_action.arguments.continuation
    });
    assert.equal(bound.stage, "proof_graph_required");
    assert.equal(bound.continuation, issued.continuation);
    assert.deepEqual(bound.next_calls, [{
      tool: "workspace_controlled_contract_proof_graph_continue",
      arguments: { wk_id: WK_ID, continuation: issued.continuation }
    }]);

    const published = await continueControlledContractProofGraphOperation({
      repoRoot, wkId: WK_ID,
      continuation: bound.next_calls[0].arguments.continuation
    });
    assert.equal(published.publication.written, true);
    assert.equal(published.publication.no_op, false);
    assert.equal(published.publication.focus, null);

    const after = await resolveCanonicalControlledContractCarrierSet({
      repoRoot, wkId: WK_ID, focus: null
    });
    const publishedRequest = after.members_by_basename[
      controlledContractCarrierFilename({ wkId: WK_ID, focus: null,
        carrierKind: "proof_plan_request" })].content;
    assert.deepEqual(publishedRequest.selected_packs.find(
      ({ profile_id: id, profile_version: version }) =>
        id === ordering.existingPack.profile_id &&
        version === ordering.existingPack.profile_version),
    { ...ordering.existingPack, evaluation_input_path: legacyName });
    assert.deepEqual(publishedRequest.requested_intents.slice().sort(),
      [...INTENTS, ...READINESS_INTENTS].sort());
    for (const basename of [legacyName, mintedName]) {
      assert.ok(after.members_by_basename[basename],
        `${basename} is a member of the published generation`);
    }
    const ready = await controlledContractAuthoringStateOperation({
      repoRoot, wkId: WK_ID, focus: null
    });
    assert.equal(ready.stage, "proof_plan_ready");

    assert.equal(JSON.stringify([issued, bound, published, ready])
      .includes("proof_plan_request_missing_inputs"), false);
    assert.equal(JSON.stringify([issued, bound, published, ready])
      .includes("workspace_controlled_contract_carrier_patch"), false);
    summaries.push({
      packs: publishedRequest.selected_packs.map(({ profile_id: id,
        profile_version: version }) => `${id}@${version}`).sort(),
      intents: publishedRequest.requested_intents.slice().sort(),
      stage: ready.stage
    });
    });
    assert.deepEqual(summaries[0], summaries[1],
      "both lexical orders compose to the same semantic pack/intent/state result");
  });

test("an authenticated evaluation-input basename is admitted only for its exact pack",
  async () => {
    const legacyName = controlledContractCarrierFilename({
      wkId: WK_ID, focus: null, carrierKind: "evaluation_input"
    });
    const mintedName = controlledContractPackCarrierFilename({
      wkId: WK_ID, focus: null,
      profileId: READINESS_PACK.profile_id,
      profileVersion: READINESS_PACK.profile_version
    });
    const otherName = controlledContractPackCarrierFilename({
      wkId: WK_ID, focus: null,
      profileId: "proof.atomicity.failure-boundary", profileVersion: "2.0.0"
    });

    assert.equal(authenticatedSelectedPackEvaluationBasename({
      wkId: WK_ID, focus: null,
      selectedPack: { ...READINESS_PACK, evaluation_input_path: mintedName }
    }), mintedName);

    const refuses = (label, selectedPack, options = {}) => assert.throws(
      () => authenticatedSelectedPackEvaluationBasename({
        wkId: WK_ID, focus: null, selectedPack, ...options
      }), (error) => {
        assert.equal(error.code, "controlled_contract_proof_input_path_forbidden", label);
        return true;
      }, label);

    refuses("another pack's basename",
      { ...READINESS_PACK, evaluation_input_path: otherName });

    const flipped = mintedName.replace(/(pack-sha256-)([0-9a-f])/u,
      (_all, prefix, digit) => `${prefix}${digit === "0" ? "1" : "0"}`);
    assert.notEqual(flipped, mintedName);
    refuses("one changed content-address character",
      { ...READINESS_PACK, evaluation_input_path: flipped });

    refuses("arbitrary pack-sha256 name", { ...READINESS_PACK,
      evaluation_input_path: `WK-2092.pack-sha256-${"a".repeat(64)}.evaluation-input.json` });

    for (const value of ["../WK-2092.evaluation-input.json",
      "wiki/contracts/WK-2092.evaluation-input.json",
      "WK-9999.evaluation-input.json", "WK-2092.proof-plan-request.json", ""]) {
      refuses(`noncanonical ${value || "(empty)"}`,
        { ...READINESS_PACK, evaluation_input_path: value });
    }

    refuses("cross-focus basename", { ...READINESS_PACK,
      evaluation_input_path: controlledContractPackCarrierFilename({
        wkId: WK_ID, focus: "scale",
        profileId: READINESS_PACK.profile_id,
        profileVersion: READINESS_PACK.profile_version }) });

    assert.equal(authenticatedSelectedPackEvaluationBasename({
      wkId: WK_ID, focus: null,
      selectedPack: { ...READINESS_PACK, evaluation_input_path: legacyName },
      request: null
    }), legacyName);
    refuses("legacy basename owned by another pack",
      { ...READINESS_PACK, evaluation_input_path: legacyName },
      { request: { selected_packs: [{ profile_id: "proof.atomicity.failure-boundary",
        profile_version: "2.0.0", evaluation_input_path: legacyName }] } });
  });

test("the continuation record has one semantic owner and rejects independent drift",
  async (t) => {
    clearControlledContractAuthoringContinuationsForTest();
    const repoRoot = await fixture(t);
    const issued = await issuedProposal(repoRoot);
    const record = await getControlledContractAuthoringContinuation({
      repoRoot, identity: issued.continuation
    });

    assert.deepEqual(Object.keys(record).slice().sort(), [
      "contract_content_digest", "focus", "identity", "package_continuation",
      "package_generation", "proof_graph", "schema_version", "semantic_bindings",
      "skeleton", "skeleton_digest", "wk_id"
    ]);
    assert.equal(Object.hasOwn(record, "coordinator_semantic_bindings"), false,
      "the caller-supplied semantic copy is gone");

    assert.equal(record.skeleton_digest,
      controlledContractContentDigest(record.skeleton));

    assert.deepEqual(record.semantic_bindings, record.skeleton.evaluation_input);

    assert.deepEqual(record, assertOneControlledContractSemanticOwner(record));

    const mutate = (change) => {
      const copy = structuredClone(record);
      change(copy);
      return copy;
    };
    const rejects = (label, copy, field) => assert.throws(
      () => assertOneControlledContractSemanticOwner(copy), (error) => {
        assert.equal(error.code,
          "controlled_contract_authoring_continuation_tampered", label);
        assert.equal(error.details.field, field, label);
        return true;
      }, label);

    rejects("independently changed projection", mutate((copy) => {
      copy.semantic_bindings = { ...copy.semantic_bindings, reference_bindings: [] };
    }), "semantic_bindings");

    rejects("skeleton and digest diverge", mutate((copy) => {
      copy.skeleton.evaluation_input = {
        ...copy.skeleton.evaluation_input, evaluation_stage: "post_dispatch" };
    }), "skeleton_digest");

    rejects("package continuation changed independently", mutate((copy) => {
      copy.package_continuation.identity = {
        ...copy.package_continuation.identity, chosen_bindings: {} };
    }), "package_continuation");
    rejects("package generation drift", mutate((copy) => {
      copy.package_generation = `${copy.package_generation}-drift`;
    }), "package_continuation");
  });

test("durable continuation updates converge equivalently and choose one conflicting outcome",
  async (t) => {
  const changes = (pointer) => ({
    status: "incomplete",
    unresolved_pointers: [pointer],
    missing_graph_identities: ["evaluation_input"]
  });
  await t.test("equivalent", async (t) => {
    const repoRoot = await fixture(t);
    const issued = await issuedProposal(repoRoot);
    const input = {
      repoRoot, wkId: WK_ID, identity: issued.continuation,
      changes: changes("/evaluation_input/reference_bindings")
    };
    const results = await Promise.all([
      updateControlledContractAuthoringProofGraphContinuation(input),
      updateControlledContractAuthoringProofGraphContinuation(input)
    ]);
    assert.deepEqual(results[1], results[0]);
    assert.equal(results[0].proof_graph.status, "incomplete");
  });
  await t.test("conflicting", async (t) => {
    const repoRoot = await fixture(t);
    const issued = await issuedProposal(repoRoot);
    const results = await Promise.allSettled([
      updateControlledContractAuthoringProofGraphContinuation({
        repoRoot, wkId: WK_ID, identity: issued.continuation,
        changes: changes("/evaluation_input/reference_bindings")
      }),
      updateControlledContractAuthoringProofGraphContinuation({
        repoRoot, wkId: WK_ID, identity: issued.continuation,
        changes: changes("/proof_plan_request/selected_packs")
      })
    ]);
    assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = results.find(({ status }) => status === "rejected");
    assert.equal(rejected.reason.code,
      "controlled_contract_authoring_continuation_stale");
    const runtime = path.join(repoRoot, ".agent-runs",
      "controlled-contract-authoring-continuations", "v1");
    const entries = await readdir(runtime);
    assert.equal(entries.filter((name) => name.endsWith(".transition.json")).length, 1);
    assert.equal(entries.some((name) => name.endsWith(".lock") ||
      name.startsWith(".continuation-tmp-")), false);
  });
});

test("package and source lease drift are distinct and effect-free before publication",
  async (t) => {
    clearControlledContractAuthoringContinuationsForTest();
    const repoRoot = await fixture(t);
    const issued = await issuedProposal(repoRoot);

    const contractPath = path.join(repoRoot,
      "wiki/contracts/WK-2092.controlled-acceptance.json");
    const original = await readFile(contractPath, "utf8");
    const drifted = JSON.parse(original);
    drifted.annotations = [...(drifted.annotations ?? []),
      { annotation_id: "wk2398-slice008-drift", text: "drift" }];
    await writeFile(contractPath, `${JSON.stringify(drifted, null, 2)}\n`);
    await assert.rejects(continueControlledContractProofGraphOperation({
      repoRoot, wkId: WK_ID, continuation: issued.continuation
    }), (error) => {
      assert.equal(error.code, "controlled_contract_authoring_continuation_stale");

      assert.notEqual(error.details.field, "semantic_bindings");
      return true;
    });
    await assert.rejects(readFile(path.join(repoRoot,
      "wiki/contracts/WK-2092.carrier-set-manifest.json")), { code: "ENOENT" });
    await writeFile(contractPath, original);
  });
