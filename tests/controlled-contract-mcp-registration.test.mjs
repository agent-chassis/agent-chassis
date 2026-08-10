import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  CONTROLLED_CONTRACT_MCP_TOOL_NAMES,
  materializeControlledContractProjectionSpills,
  registerControlledContractTools
} from "../packages/wiki-mcp/src/lib/controlled-contract-tools.mjs";
import { registerAgentFaqTools } from
  "../packages/wiki-mcp/src/lib/agent-faq-tools.mjs";
import {
  errorContent,
  jsonContent,
  readSpilledMcpContentReference
} from "../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { shouldExposeTool } from "../packages/wiki-mcp/src/lib/tool-profile.mjs";
import { loadToolDiscoveryDescriptor, queryToolDiscoveryDescriptor } from
  "../packages/wiki-core/src/lib/tool-discovery.mjs";
import { recommendToolRoute } from "../packages/wiki-core/src/operations/tool-router.mjs";
import { compactProofPackDescription } from
  "../packages/wiki-core/src/lib/controlled-contract-authoring-projections.mjs";

const REPO = path.resolve(import.meta.dirname, "..");

function registrations({ production = false, repoRoot = REPO } = {}) {
  const found = new Map();
  registerControlledContractTools({
    registerTool: (name, config, handler) => found.set(name, { config, handler }),
    workspaceRepos: { currentAlias: "current" },
    z,
    jsonContent: production ? jsonContent : (value) => ({ structuredContent: value }),
    errorContent: (error) => ({ isError: true, structuredContent: error.envelope }),
    resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
  });
  return found;
}

function assertJsonCompatible(value, seen = new WeakSet()) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number") { assert.ok(Number.isFinite(value)); return; }
  assert.equal(typeof value, "object");
  assert.equal(value instanceof Map || value instanceof Set, false);
  if (seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    assert.equal(typeof key, "string", `non-JSON key ${String(key)}`);
    assertJsonCompatible(value[key], seen);
  }
}

function readReferenceBytes(reference, env) {
  const chunks = [];
  let offset = 0;
  do {
    const part = readSpilledMcpContentReference({ ref_id: reference.ref_id,
      offset, length: reference.range.max_length }, { env });
    chunks.push(Buffer.from(part.data_base64, "base64"));
    offset = part.next_offset;
  } while (offset !== null);
  return Buffer.concat(chunks);
}

test("carrier query bounds the real production structured-content serialization", async () => {
  const found = registrations({ production: true });
  const route = found.get("workspace_controlled_contract_carrier_query");
  const root = JSON.parse(await readFile(path.join(
    REPO, "wiki/contracts/WK-2012.controlled-acceptance.json"
  ), "utf8"));
  const index = await route.handler({ wk_id: "WK-2012", carrier_kind: "contract" });
  const indexBytes = Buffer.byteLength(JSON.stringify(index.structuredContent, null, 2), "utf8");
  assert.ok(indexBytes <= 4096, indexBytes);
  assert.equal(index.structuredContent.response_spilled, undefined);

  const selectors = [
    ...root.references.map(({ reference_id: id }) => id),
    ...root.propositions.map(({ proposition_id: id }) => id),
    ...root.claims.map(({ claim_id: id }) => id),
    "ref-does-not-exist"
  ].slice(0, 64);
  selectors[selectors.length - 1] = "ref-does-not-exist";
  const selected = await route.handler({
    wk_id: "WK-2012", carrier_kind: "contract", selectors
  });
  const selectedBytes = Buffer.byteLength(
    JSON.stringify(selected.structuredContent, null, 2), "utf8"
  );
  assert.ok(selectedBytes <= 16384, selectedBytes);
  assert.equal(selected.structuredContent.response_spilled, undefined);
  assert.equal(selected.structuredContent.requested_count, selectors.length);
  assert.equal(selected.structuredContent.requested_count,
    selected.structuredContent.matched_count + selected.structuredContent.missing_selector_count);
  assert.equal(selected.structuredContent.matched_count,
    selected.structuredContent.returned_count +
      selected.structuredContent.byte_omitted_matched_count);
  assert.deepEqual(selected.structuredContent.missing_selectors, ["ref-does-not-exist"]);
});

test("production authoring, proof-pack, and binding projections remain compact-first", async () => {
  const found = registrations({ production: true });
  const describe = await found.get("workspace_controlled_contract_authoring_describe").handler({
    carrier_kind: "contract"
  });
  const pack = await found.get("workspace_controlled_proof_pack_describe").handler({
    profile_id: "proof.result-shape.conformance", profile_version: "1.0.0",
    requested_intents: ["controlled-proof-intent.result-shape-conformance"]
  });
  const bindings = await found.get("workspace_controlled_proof_pack_bindings_inspect").handler({
    wk_id: "WK-2012", focus: "implementation-readiness",
    evaluation_focus: "implementation-readiness",
    profile_id: "proof.design.implementation-readiness", profile_version: "1.0.0",
    requested_intents: ["controlled-proof-intent.implementation-readiness"]
  });
  for (const [name, response] of [["authoring", describe], ["pack", pack], ["bindings", bindings]]) {
    const measured = Buffer.byteLength(JSON.stringify(response.structuredContent, null, 2));
    assert.ok(measured <= 4096, `${name}: ${measured}`);
  }
  assert.equal(bindings.structuredContent.status, "valid");
  assert.deepEqual(bindings.structuredContent.counts,
    { supplied: 28, missing: 0, ambiguous: 0, incompatible: 0 });
  assert.equal(JSON.stringify(bindings.structuredContent).includes("compatible_candidates"), false);
  const detail = await found.get("workspace_controlled_proof_pack_bindings_inspect").handler({
    wk_id: "WK-2012", focus: "implementation-readiness",
    profile_id: "proof.design.implementation-readiness", profile_version: "1.0.0",
    requested_intents: ["controlled-proof-intent.implementation-readiness"],
    roles: ["placeholders"]
  });
  assert.ok(Buffer.byteLength(JSON.stringify(detail.structuredContent, null, 2)) <= 16384);
  assert.ok(detail.structuredContent.returned_count > 0);
});

test("all controlled-contract routes register through one registrar with strict typed schemas", async () => {
  const found = registrations();
  assert.deepEqual([...found.keys()], [...CONTROLLED_CONTRACT_MCP_TOOL_NAMES]);
  for (const [name, { config }] of found) {
    assert.equal(typeof config.description, "string", name);
    assert.ok(config.description.length > 20, name);
    assert.equal(config.inputSchema.safeParse({ root: "/tmp" }).success, false, name);
  }
  const readSchema = found.get("workspace_controlled_contract_carrier_read").config.inputSchema;
  assert.equal(readSchema.safeParse({ wk_id: "WK-2012", carrier_kind: "contract" }).success, true);
  for (const wk_id of ["wk-2012", "WK-12", "../WK-2012", "/WK-2012"]) {
    assert.equal(readSchema.safeParse({ wk_id, carrier_kind: "contract" }).success, false);
  }
  const bindingSchema = zodToJsonSchema(
    found.get("workspace_controlled_proof_pack_bindings_inspect").config.inputSchema
  );
  assert.deepEqual(bindingSchema.properties.evaluation_focus.anyOf.map(({ type }) => type),
    ["string", "null"]);
  assert.equal(bindingSchema.properties.evaluation_focus.anyOf[0].pattern,
    "^[a-z0-9]+(?:-[a-z0-9]+)*$");
  const listedShape = JSON.stringify([...found.values()].map(({ config }) => ({
    description: config.description, inputSchema: zodToJsonSchema(config.inputSchema)
  })));
  assert.equal(listedShape.includes("proof_obligations"), false);
  assert.equal(listedShape.includes("schema_fragment"), false);
});

test("binding-size FAQ recovery is available through the free/local MCP route", async () => {
  const found = new Map();
  registerAgentFaqTools({ registerTool: (name, config, handler) =>
    found.set(name, { config, handler }), z,
  jsonContent: (value) => ({ structuredContent: value }),
  errorContent: (error) => ({ isError: true, structuredContent: error.envelope }),
  registeredTier: "free_local" });
  const response = await found.get("workspace_agent_faq").handler({
    related_code: "proof_pack_binding_result_too_large"
  });
  assert.equal(response.structuredContent.entry_count, 1);
  assert.equal(response.structuredContent.entries[0].id,
    "proof-pack-binding-result-too-large");
});

test("central role policy grants the exact intended controlled-contract surface", async () => {
  const broad = new Set([
    "workspace_controlled_contract_artifact_read",
    "workspace_controlled_contract_assess",
    "workspace_controlled_contract_carrier_query",
    "workspace_controlled_contract_authoring_describe",
    "workspace_controlled_proof_pack_bindings_inspect",
    "workspace_controlled_proof_pack_describe",
    "workspace_controlled_proof_intents_discover",
    "workspace_controlled_proof_packs_select",
    "workspace_controlled_vocabulary_query"
  ]);
  const authoring = new Set([
    "workspace_controlled_contract_carrier_create",
    "workspace_controlled_contract_carrier_patch",
    "workspace_controlled_proof_plan_build"
  ]);
  const recovery = new Set([
    "workspace_controlled_contract_carrier_read",
    "workspace_controlled_contract_carrier_write"
  ]);
  for (const tool of CONTROLLED_CONTRACT_MCP_TOOL_NAMES) {
    assert.equal(shouldExposeTool("orchestrator", tool), !recovery.has(tool), tool);
    assert.equal(shouldExposeTool("operator", tool), true, tool);
    assert.equal(shouldExposeTool("worker", tool), false, tool);
    assert.equal(shouldExposeTool("reviewer", tool), broad.has(tool), tool);
    assert.equal(shouldExposeTool("redteam", tool), broad.has(tool), tool);
    assert.equal(authoring.has(tool) || recovery.has(tool), !broad.has(tool), tool);
  }

  const policy = JSON.parse(await readFile(path.join(
    REPO,
    "packages/wiki-core/data/tool-discovery/session-role-tool-access.json"
  ), "utf8"));
  assert.deepEqual(policy.roles, ["orchestrator", "reviewer", "worker", "redteam", "operator"]);
  for (const tool of CONTROLLED_CONTRACT_MCP_TOOL_NAMES) {
    assert.ok(Object.hasOwn(policy.access, tool), tool);
  }
});

test("discovery manifest installs and supports every route without dangling grants", async () => {
  const manifest = JSON.parse(await readFile(path.join(
    REPO, "packages/wiki-core/data/tool-discovery/manifest.json"
  ), "utf8"));
  const fragmentRow = manifest.fragments.find(({ file }) =>
    file === "controlled-contract-tools.json");
  assert.equal(fragmentRow.tool_count, CONTROLLED_CONTRACT_MCP_TOOL_NAMES.length);
  const fragment = JSON.parse(await readFile(path.join(
    REPO, "packages/wiki-core/data/tool-discovery/controlled-contract-tools.json"
  ), "utf8"));
  assert.equal(fragment.tool_count, CONTROLLED_CONTRACT_MCP_TOOL_NAMES.length);
  assert.deepEqual(fragment.tools.map(({ tool_name }) => tool_name),
    [...CONTROLLED_CONTRACT_MCP_TOOL_NAMES]);
  const rootContract = JSON.parse(await readFile(path.join(
    REPO, "wiki/contracts/WK-2012.controlled-acceptance.json"
  ), "utf8"));
  const referenceById = new Map(rootContract.references.map((reference) => [
    reference.reference_id, reference
  ]));
  const population = rootContract.propositions.find(({ proposition_id }) =>
    proposition_id === "prop-required-operation-population-members").operands
    .map(({ reference_id }) => referenceById.get(reference_id).identity.value);
  assert.deepEqual([...CONTROLLED_CONTRACT_MCP_TOOL_NAMES], population);
  for (const entry of fragment.tools) {
    assert.equal(entry.install_state, "installed");
    assert.equal(entry.runtime_posture, "supported");
    assert.deepEqual(entry.tier_visibility, ["free_local"]);
    assert.ok(entry.side_effects.length > 0);
    assert.ok(entry.authority.length > 0);
    assert.ok(entry.docs_refs.length > 0);
  }
});

test("controlled-contract discovery and natural-language routing stay on the focused surface", async () => {
  const descriptor = await loadToolDiscoveryDescriptor();
  const registered = registrations();
  for (const taskId of ["controlled-contract-authoring", "controlled-contract-proof-selection",
    "controlled-contract-proof-plan", "controlled-contract-assessment"]) {
    const results = queryToolDiscoveryDescriptor(descriptor, { task_id: taskId });
    assert.ok(results.length > 0, taskId);
    assert.ok(results.every(({ tool_name: name }) => name.startsWith("workspace_controlled_")),
      `${taskId}: ${results.map(({ tool_name }) => tool_name)}`);
  }
  for (const [task_description, intent, first, args] of [
    ["Author controlled contract WK-2012", "controlled_contract_authoring",
      "workspace_controlled_contract_authoring_describe"],
    ["Select controlled proof pack for WK-2012", "controlled_contract_proof_selection",
      "workspace_controlled_proof_intents_discover"],
    ["Rebuild controlled proof plan for WK-2012", "controlled_contract_proof_plan",
      "workspace_controlled_contract_carrier_query",
      { wk_id: "WK-2012", carrier_kind: "proof_plan" }],
    ["Assess controlled contract WK-2012", "controlled_contract_assessment",
      "workspace_controlled_contract_assess", { wk_id: "WK-2012" }]
  ]) {
    const routed = await recommendToolRoute({ task_description });
    assert.equal(routed.result_state, "matched", task_description);
    assert.equal(routed.classified_intent, intent);
    assert.equal(routed.next_calls.find(({ recommended }) => recommended)?.tool, first);
    if (args) assert.deepEqual(routed.suggested_arguments, args);
    assert.equal(registered.get(first).config.inputSchema.safeParse(
      routed.suggested_arguments).success, true, task_description);
    assert.ok(routed.next_calls.filter(({ disallowed }) => !disallowed)
      .every(({ tool }) => tool.startsWith("workspace_controlled_")));
    assert.ok(routed.next_calls.every(({ tool }) => !tool.startsWith("workspace_work_record_") &&
      tool !== "workspace_create_record"));
  }
  for (const [task_description, intent] of [
    ["author a controlled acceptance contract for WK-2012", "controlled_contract_authoring"],
    ["inspect controlled contract proof pack bindings", "controlled_contract_proof_selection"],
    ["rebuild the current controlled contract proof plan", "controlled_contract_proof_plan"],
    ["assess the controlled contract and read proof details", "controlled_contract_assessment"],
    ["query a controlled contract carrier", "controlled_contract_authoring"]
  ]) {
    const routed = await recommendToolRoute({ task_description });
    assert.notEqual(routed.result_state, "unknown", task_description);
    assert.equal(routed.classified_intent ?? routed.candidate_intents?.[0], intent,
      task_description);
    assert.notEqual(routed.classified_intent, "selected_work_record_context");
    for (const { tool } of routed.next_calls) if (tool.startsWith("workspace_controlled_"))
      assert.ok(registered.has(tool), `${task_description}: ${tool}`);
  }
});

test("selected carrier queries cross the MCP tools/call boundary as bounded JSON", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2012-selected-roundtrip-repo-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "wk2012-selected-roundtrip-state-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true })]));
  await mkdir(path.join(root, "wiki/contracts"), { recursive: true });
  const base = JSON.parse(await readFile(path.join(
    REPO, "wiki/contracts/WK-2012.controlled-acceptance.json"
  ), "utf8"));
  const claim = base.claims[0].claim_id; const residue = base.residue[0].residue_id;
  await writeFile(path.join(root, "wiki/contracts/WK-2992.controlled-acceptance.json"),
    `${JSON.stringify(base, null, 2)}\n`);

  const boundary = structuredClone(base);
  boundary.residue.push({ residue_id: "res-inline-boundary", reason: "review_only", text: "" });
  const boundaryPath = path.join(root, "wiki/contracts/WK-2993.controlled-acceptance.json");
  await writeFile(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`);
  const calibration = registrations({ production: true, repoRoot: root })
    .get("workspace_controlled_contract_carrier_query");
  const seed = await calibration.handler({ wk_id: "WK-2993", carrier_kind: "contract",
    selectors: ["res-inline-boundary"] });
  const padding = 16384 - Buffer.byteLength(JSON.stringify(seed.structuredContent, null, 2));
  assert.ok(padding > 0);
  boundary.residue.at(-1).text = "x".repeat(padding);
  await writeFile(boundaryPath, `${JSON.stringify(boundary, null, 2)}\n`);
  const over = structuredClone(boundary); over.residue.at(-1).text += "x";
  await writeFile(path.join(root, "wiki/contracts/WK-2994.controlled-acceptance.json"),
    `${JSON.stringify(over, null, 2)}\n`);

  const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir,
    WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT: "65536" };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "controlled-contract-query-test", version: "1.0.0" });
  const client = new Client({ name: "controlled-contract-query-client", version: "1.0.0" },
    { capabilities: {} });
  registerControlledContractTools({ registerTool: server.registerTool.bind(server),
    workspaceRepos: { currentAlias: "current" }, z,
    jsonContent: (value, options = {}) => jsonContent(value, { env, ...options }),
    errorContent, resolveWorkspaceRepo: () => ({ repo: "current", dir: root }) });
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const call = (wk_id, selectors) => client.callTool({
      name: "workspace_controlled_contract_carrier_query",
      arguments: { wk_id, carrier_kind: "contract", selectors }
    });
    const responses = [await call("WK-2992", [claim]), await call("WK-2992", [residue]),
      await call("WK-2992", [claim, residue, "ref-does-not-exist"]),
      await call("WK-2993", ["res-inline-boundary"]),
      await call("WK-2994", ["res-inline-boundary"])];
    for (const response of responses) {
      assert.notEqual(response.isError, true);
      assertJsonCompatible(response.structuredContent);
      assert.ok(Buffer.byteLength(JSON.stringify(response.structuredContent, null, 2)) <= 16384);
      assert.equal(response.structuredContent.response_spilled, undefined);
      assert.equal(Object.hasOwn(response.structuredContent, "content"), false);
    }
    assert.equal(responses[0].structuredContent.items[0].target, "claims");
    assert.equal(responses[1].structuredContent.items[0].target, "residue");
    assert.deepEqual({ requested: responses[2].structuredContent.requested_count,
      matched: responses[2].structuredContent.matched_count,
      returned: responses[2].structuredContent.returned_count,
      byte_omitted: responses[2].structuredContent.byte_omitted_matched_count,
      missing: responses[2].structuredContent.missing_selector_count,
      missing_returned: responses[2].structuredContent.missing_selector_returned_count,
      missing_omitted: responses[2].structuredContent.missing_selector_omitted_count },
    { requested: 3, matched: 2, returned: 2, byte_omitted: 0, missing: 1,
      missing_returned: 1, missing_omitted: 0 });
    assert.deepEqual(responses[2].structuredContent.missing_selectors,
      ["ref-does-not-exist"]);
    assert.equal(Buffer.byteLength(JSON.stringify(responses[3].structuredContent, null, 2)),
      16384);
    assert.ok(Object.hasOwn(responses[3].structuredContent.items[0], "value"));
    const hypotheticalOver = structuredClone(responses[3].structuredContent);
    hypotheticalOver.items[0].value.text += "x";
    assert.equal(Buffer.byteLength(JSON.stringify(hypotheticalOver, null, 2)), 16385);
    const spilled = responses[4].structuredContent.items[0];
    assert.equal(spilled.value_spilled, true); assert.equal(Object.hasOwn(spilled, "value"), false);
    const reference = spilled.content_reference; assert.ok(reference);
    const nodeBytes = readReferenceBytes(reference, env);
    const node = JSON.parse(nodeBytes.toString("utf8"));
    assert.equal(node.residue_id, "res-inline-boundary");
    assert.equal(Object.hasOwn(node, "references"), false);
    assert.equal(spilled.node_byte_count, nodeBytes.byteLength);
    assert.equal(spilled.node_sha256,
      createHash("sha256").update(nodeBytes).digest("hex"));
    assert.equal(spilled.node_byte_count, reference.byte_count);
    assert.equal(spilled.node_sha256, reference.sha256);
    t.diagnostic(`selected-query bytes ${JSON.stringify({ claim: Buffer.byteLength(JSON.stringify(responses[0].structuredContent, null, 2)), residue: Buffer.byteLength(JSON.stringify(responses[1].structuredContent, null, 2)), mixed_missing: Buffer.byteLength(JSON.stringify(responses[2].structuredContent, null, 2)), exact_inline: Buffer.byteLength(JSON.stringify(responses[3].structuredContent, null, 2)), one_over_node_spill: Buffer.byteLength(JSON.stringify(responses[4].structuredContent, null, 2)) })}`);
  } finally { await client.close(); await server.close(); }
});

test("path-free selected packs create, patch, and build through real MCP tools/call", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2012-binding-roundtrip-repo-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "wk2012-binding-roundtrip-state-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true })]));
  const contracts = path.join(root, "wiki/contracts");
  await mkdir(contracts, { recursive: true });
  const sourceFocus = "caller-substrate-refusal";
  const contract = JSON.parse(await readFile(path.join(REPO,
    `wiki/contracts/WK-2012-${sourceFocus}.controlled-acceptance.json`), "utf8"));
  const evaluation = JSON.parse(await readFile(path.join(REPO,
    `wiki/contracts/WK-2012-${sourceFocus}.evaluation-input.json`), "utf8"));
  const request = JSON.parse(await readFile(path.join(REPO,
    `wiki/contracts/WK-2012-${sourceFocus}.proof-plan-request.json`), "utf8"));
  delete request.selected_packs[0].evaluation_input_path;
  const intent = request.requested_intents[0];
  const selectedPack = request.selected_packs[0];
  const scale = structuredClone(contract); const scalePadding = [242, 74, 74, 74, 36];
  scale.references.push(...Array.from({ length: 900 }, (_, index) => ({
    reference_id: `ref-scale-${String(index).padStart(4, "0")}${"a".repeat(scalePadding[index] ?? 0)}`,
    type_term: "cc:operation", identity: { kind: "durable_id", domain: "binding-scale", value: `v-${index}` }
  })));
  const scaleEvaluation = structuredClone(evaluation); scaleEvaluation.reference_bindings.find(({ role }) => role === "operation").reference_ids = scale.references
    .filter(({ type_term }) => ["cc:operation", "cc:capability", "cc:command"].includes(type_term)).map(({ reference_id }) => reference_id);
  await writeFile(path.join(contracts, "WK-2995.controlled-acceptance.json"), `${JSON.stringify(scale, null, 2)}\n`);
  await writeFile(path.join(contracts, "WK-2995.evaluation-input.json"), `${JSON.stringify(scaleEvaluation, null, 2)}\n`);
  await writeFile(path.join(contracts, "WK-2995-scale.evaluation-input.json"), `${JSON.stringify(scaleEvaluation, null, 2)}\n`);
  await writeFile(path.join(contracts, "WK-2996.controlled-acceptance.json"), `${JSON.stringify(scale, null, 2)}\n`);
  const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "controlled-contract-binding-test", version: "1.0.0" });
  const client = new Client({ name: "controlled-contract-binding-client", version: "1.0.0" },
    { capabilities: {} });
  registerControlledContractTools({ registerTool: server.registerTool.bind(server),
    workspaceRepos: { currentAlias: "current" }, z,
    jsonContent: (value, options = {}) => jsonContent(value, { env, ...options }),
    errorContent, resolveWorkspaceRepo: () => ({ repo: "current", dir: root }) });
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const bindingArgs = { wk_id: "WK-2995", profile_id: "proof.authorization.refusal-before-effects", profile_version: "1.0.0",
      requested_intents: ["controlled-proof-intent.refusal-before-effects"] };
    const noInput = await client.callTool({ name: "workspace_controlled_proof_pack_bindings_inspect", arguments: bindingArgs });
    const rootInput = await client.callTool({ name: "workspace_controlled_proof_pack_bindings_inspect", arguments: { ...bindingArgs, evaluation_focus: null } });
    const focusedInput = await client.callTool({ name: "workspace_controlled_proof_pack_bindings_inspect", arguments: { ...bindingArgs, evaluation_focus: "scale" } });
    assert.equal(noInput.structuredContent.digests.evaluation_input, null);
    assert.notEqual(rootInput.structuredContent.digests.evaluation_input, null);
    assert.equal(rootInput.structuredContent.digests.evaluation_input, focusedInput.structuredContent.digests.evaluation_input);
    assert.ok(Buffer.byteLength(JSON.stringify(noInput.structuredContent, null, 2)) <= 4096);
    let page = await client.callTool({ name: "workspace_controlled_proof_pack_bindings_inspect",
      arguments: { ...bindingArgs, evaluation_focus: null, roles: ["operation"] } });
    const ids = []; const bindingBytes = []; let spillBytes = 0; let prior = -1; const firstCursor = page.structuredContent.continuation;
    while (true) {
      const body = page.structuredContent;
      bindingBytes.push(Buffer.byteLength(JSON.stringify(body, null, 2)));
      assert.ok(bindingBytes.at(-1) <= 16384); assert.equal(body.total_count, body.matched_count); assert.equal(body.total_count, body.returned_count + body.omitted_count); assert.equal(body.remaining_count, body.total_count - body.position - body.returned_count);
      ids.push(...body.entries.filter(({ kind, item_spilled }) => kind === "reference_candidate" && !item_spilled)
        .map(({ candidate }) => candidate.reference_id));
      for (const entry of body.entries.filter(({ item_spilled }) => item_spilled)) {
        const recovered = JSON.parse(readReferenceBytes(entry.content_reference, env));
        if (recovered.candidate) ids.push(recovered.candidate.reference_id); else spillBytes = entry.item_byte_count;
      }
      if (!body.continuation) break;
      const position = JSON.parse(Buffer.from(body.continuation, "base64url")).offset;
      assert.ok(position > prior); prior = position;
      page = await client.callTool({ name: "workspace_controlled_proof_pack_bindings_inspect",
        arguments: { ...bindingArgs, evaluation_focus: null, roles: ["operation"], cursor: body.continuation } });
    }
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 901);
    assert.ok(spillBytes > 16384);
    t.diagnostic(`binding bytes ${JSON.stringify({ default: Buffer.byteLength(JSON.stringify(noInput.structuredContent, null, 2)), oversized_item: spillBytes, pages: bindingBytes })}`);
    assert.ok(bindingBytes.includes(16384));
    for (const arguments_ of [
      { ...bindingArgs, wk_id: "WK-2996", roles: ["operation"], cursor: firstCursor },
      { ...bindingArgs, evaluation_focus: "scale", roles: ["operation"], cursor: firstCursor },
      { ...bindingArgs, requested_intents: ["controlled-proof-intent.write-confinement"], evaluation_focus: null, roles: ["operation"], cursor: firstCursor },
      { ...bindingArgs, profile_id: "proof.scope.write-confinement", requested_intents: ["controlled-proof-intent.write-confinement"], roles: ["operation"], cursor: firstCursor },
      { ...bindingArgs, evaluation_focus: null, roles: ["attempt"], cursor: firstCursor },
      { ...bindingArgs, evaluation_focus: null, roles: ["operation"], statuses: ["ambiguous"], cursor: firstCursor },
      { ...bindingArgs, evaluation_focus: null, roles: ["operation"], cursor: Buffer.from(JSON.stringify(
        { ...JSON.parse(Buffer.from(firstCursor, "base64url")), result: "stale" })).toString("base64url") }
    ]) assert.equal((await client.callTool({ name: "workspace_controlled_proof_pack_bindings_inspect", arguments: arguments_ })).isError, true);
    for (const evaluation_focus of ["", "missing", "/tmp/x", "../x", "WK-2014-x"])
      assert.equal((await client.callTool({ name: "workspace_controlled_proof_pack_bindings_inspect",
        arguments: { ...bindingArgs, evaluation_focus } })).isError, true);
    assert.equal((await client.callTool({ name: "workspace_controlled_proof_pack_bindings_inspect",
      arguments: { ...bindingArgs, unknown: true } })).isError, true);
    for (const { wkId, focus, mode } of [
      { wkId: "WK-1995", focus: null, mode: "create" },
      { wkId: "WK-2012", focus: "agent-authoring-ergonomics", mode: "patch" }
    ]) {
      const stem = focus === null ? wkId : `${wkId}-${focus}`;
      await writeFile(path.join(contracts, `${stem}.controlled-acceptance.json`),
        `${JSON.stringify(contract, null, 2)}\n`);
      await writeFile(path.join(contracts, `${stem}.evaluation-input.json`),
        `${JSON.stringify(evaluation, null, 2)}\n`);
      const identityArgs = { wk_id: wkId, ...(focus === null ? {} : { focus }) };
      if (mode === "create") {
        const created = await client.callTool({
          name: "workspace_controlled_contract_carrier_create",
          arguments: { ...identityArgs, carrier_kind: "proof_plan_request",
            expected_content_digest: null, content: request }
        });
        assert.notEqual(created.isError, true);
      } else {
        const empty = await client.callTool({
          name: "workspace_controlled_contract_carrier_create",
          arguments: { ...identityArgs, carrier_kind: "proof_plan_request",
            expected_content_digest: null,
            content: { schema_version: request.schema_version,
              requested_intents: [], selected_packs: [] } }
        });
        assert.notEqual(empty.isError, true);
        const patched = await client.callTool({
          name: "workspace_controlled_contract_carrier_patch",
          arguments: { ...identityArgs, carrier_kind: "proof_plan_request",
            expected_content_digest: empty.structuredContent.content_digest,
            operations: [
              { op: "upsert", target: "requested_intents", id: intent, value: intent },
              { op: "upsert", target: "selected_packs",
                id: `${selectedPack.profile_id}@${selectedPack.profile_version}`,
                value: selectedPack }
            ] }
        });
        assert.notEqual(patched.isError, true);
      }
      const selected = await client.callTool({
        name: "workspace_controlled_contract_carrier_query",
        arguments: { ...identityArgs, carrier_kind: "proof_plan_request",
          selectors: [`${selectedPack.profile_id}@${selectedPack.profile_version}`] }
      });
      assert.equal(selected.structuredContent.items[0].value.evaluation_input_path,
        `${stem}.evaluation-input.json`);
      const built = await client.callTool({
        name: "workspace_controlled_proof_plan_build",
        arguments: { ...identityArgs, expected_content_digest: null }
      });
      assert.notEqual(built.isError, true);
      assert.deepEqual(built.structuredContent.plan.requested_intents, [intent]);
      assert.deepEqual(built.structuredContent.plan.packs.map(({ profile_id, profile_version }) =>
        `${profile_id}@${profile_version}`),
      [`${selectedPack.profile_id}@${selectedPack.profile_version}`]);
    }
  } finally { await client.close(); await server.close(); }
});

test("multi-spill responses and oversized pagers stay bounded across a real MCP boundary", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2012-oversized-roundtrip-repo-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "wk2012-oversized-roundtrip-state-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true })]));
  const contracts = path.join(root, "wiki/contracts");
  await mkdir(contracts, { recursive: true });
  const selectedNodes = Array.from({ length: 36 }, (_, index) => ({
    residue_id: `res-multi-spill-${String(index).padStart(2, "0")}`,
    reason: "review_only",
    text: "x".repeat(18000)
  }));
  await writeFile(path.join(contracts, "WK-2960.controlled-acceptance.json"),
    `${JSON.stringify({ residue: selectedNodes }, null, 2)}\n`);

  const positions = {
    first: ["res-a-oversized-", "res-z"],
    middle: ["res-a", "res-m-oversized-", "res-z"],
    final: ["res-a", "res-z-oversized-"]
  };
  const indexCases = new Map();
  let wkNumber = 2961;
  for (const [position, prefixes] of Object.entries(positions)) {
    const wkId = `WK-${wkNumber}`;
    wkNumber += 1;
    const selectors = prefixes.map((prefix) => prefix.includes("oversized")
      ? `${prefix}${"x".repeat(5000)}` : prefix).sort();
    indexCases.set(position, { wkId, selectors });
    await writeFile(path.join(contracts, `${wkId}.controlled-acceptance.json`),
      `${JSON.stringify({ residue: selectors.map((residue_id) =>
        ({ residue_id, reason: "review_only", text: "x" })) }, null, 2)}\n`);
    await writeFile(path.join(contracts, `${wkId}.proof-plan-request.json`),
      `${JSON.stringify({ schema_version: "controlled-contract-proof-plan-request.v1",
        requested_intents: [], selected_packs: [] }, null, 2)}\n`);
  }

  const proofDetails = Object.fromEntries(Object.entries(positions).map(([position, prefixes]) => [
    position,
    prefixes.map((prefix) => ({ pattern_id: prefix.includes("oversized")
      ? `${prefix}${"x".repeat(18000)}` : prefix, text: "x" }))
  ]));
  const makeDescription = (proof_obligations) => ({
    profile_id: "proof.pagination.repro", profile_version: "1.0.0",
    requested_intents: [], intent_definitions: [], intent_distinctions: [], guarantee: {},
    explicit_exclusions: [], evaluation_input_skeleton: { allowed_evaluation_stages: [] },
    counts: {}, source_digests: {}, projection_digest: `sha256:${"a".repeat(64)}`,
    authority: "non_authoritative", compatibility: [], role_constraints: [], proof_obligations
  });
  const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
  const productionJson = (value, options = {}) => jsonContent(value, { env, ...options });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "controlled-contract-oversized-test", version: "1.0.0" });
  const client = new Client({ name: "controlled-contract-oversized-client", version: "1.0.0" },
    { capabilities: {} });
  registerControlledContractTools({ registerTool: server.registerTool.bind(server),
    workspaceRepos: { currentAlias: "current" }, z, jsonContent: productionJson,
    errorContent, resolveWorkspaceRepo: () => ({ repo: "current", dir: root }) });
  server.registerTool("test_oversized_proof_detail", { inputSchema: z.object({
    position: z.enum(["first", "middle", "final"]),
    cursor: z.string().optional()
  }).strict() }, ({ position, cursor }) => {
    const result = compactProofPackDescription(makeDescription(proofDetails[position]), {
      sections: ["proof_obligations"], cursor: cursor ?? null
    });
    return productionJson(materializeControlledContractProjectionSpills({
      result, jsonContent: productionJson, limit: 16384
    }));
  });
  try {
    await server.connect(serverTransport); await client.connect(clientTransport);
    const selected = await client.callTool({
      name: "workspace_controlled_contract_carrier_query",
      arguments: { wk_id: "WK-2960", carrier_kind: "contract",
        selectors: selectedNodes.map(({ residue_id }) => residue_id) }
    });
    const selectedBytes = Buffer.byteLength(JSON.stringify(selected.structuredContent, null, 2));
    assert.ok(selectedBytes <= 16384, selectedBytes);
    assert.equal(selected.structuredContent.response_spilled, undefined);
    assert.equal(selected.structuredContent.matched_count, 36);
    assert.equal(selected.structuredContent.returned_count +
      selected.structuredContent.byte_omitted_matched_count, 36);
    assert.ok(selected.structuredContent.returned_count > 0);
    assert.ok(selected.structuredContent.byte_omitted_matched_count > 0);
    for (const item of selected.structuredContent.items) {
      assert.equal(item.value_spilled, true);
      assert.equal(item.node_byte_count, item.content_reference.byte_count);
      assert.equal(item.node_sha256, item.content_reference.sha256);
    }
    const selectedArtifact = readReferenceBytes(
      selected.structuredContent.items[0].content_reference, env);
    assert.equal(selected.structuredContent.items[0].node_byte_count,
      selectedArtifact.byteLength);
    assert.equal(selected.structuredContent.items[0].node_sha256,
      createHash("sha256").update(selectedArtifact).digest("hex"));

    const cursorTraces = {};
    let crossCursor = null;
    for (const [position, { wkId, selectors: expected }] of indexCases) {
      const recovered = []; const trace = []; let cursor = null;
      do {
        const supplied = cursor;
        const page = await client.callTool({
          name: "workspace_controlled_contract_carrier_query",
          arguments: { wk_id: wkId, carrier_kind: "contract", target: "residue",
            ...(cursor === null ? {} : { cursor }) }
        });
        assert.notEqual(page.isError, true);
        const payload = page.structuredContent;
        const pageBytes = Buffer.byteLength(JSON.stringify(payload, null, 2));
        assert.ok(pageBytes <= 4096, pageBytes);
        assert.ok(payload.returned_count > 0);
        cursor = payload.continuation;
        crossCursor ??= cursor;
        if (cursor !== null) assert.notEqual(cursor, supplied);
        for (const item of payload.items) {
          if (item.item_spilled === true) {
            const itemBytes = readReferenceBytes(item.content_reference, env);
            assert.equal(item.item_byte_count, itemBytes.byteLength);
            assert.equal(item.item_sha256,
              createHash("sha256").update(itemBytes).digest("hex"));
            const recoveredItem = JSON.parse(itemBytes.toString("utf8"));
            assert.deepEqual(Object.keys(recoveredItem).sort(), ["id", "selector", "target"]);
            recovered.push(recoveredItem.selector);
          } else recovered.push(item.selector);
        }
        trace.push({ returned: payload.returned_count, remaining: payload.remaining_count,
          next: cursor === null ? null
            : JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")).offset,
          spilled: payload.items.some(({ item_spilled }) => item_spilled === true),
          bytes: pageBytes });
      } while (cursor !== null);
      assert.deepEqual(recovered, expected);
      assert.equal(new Set(recovered).size, expected.length);
      cursorTraces[position] = trace;
    }
    const firstCase = indexCases.get("first");
    for (const arguments_ of [
      { wk_id: firstCase.wkId, carrier_kind: "contract", target: "annotations",
        cursor: crossCursor },
      { wk_id: indexCases.get("middle").wkId, carrier_kind: "contract", target: "residue",
        cursor: crossCursor },
      { wk_id: firstCase.wkId, carrier_kind: "proof_plan_request", cursor: crossCursor }
    ]) {
      const refused = await client.callTool({
        name: "workspace_controlled_contract_carrier_query", arguments: arguments_
      });
      assert.equal(refused.isError, true);
      assert.equal(refused.structuredContent.warning.payload.reason_code,
        "controlled_contract_query_cursor_mismatch");
    }

    const detailTraces = {};
    for (const position of Object.keys(proofDetails)) {
      const expected = proofDetails[position].map(({ pattern_id }) => pattern_id);
      const recovered = []; const trace = []; let cursor = null;
      do {
        const supplied = cursor;
        const page = await client.callTool({ name: "test_oversized_proof_detail",
          arguments: { position, ...(cursor === null ? {} : { cursor }) } });
        assert.notEqual(page.isError, true);
        const payload = page.structuredContent;
        const pageBytes = Buffer.byteLength(JSON.stringify(payload, null, 2));
        assert.ok(pageBytes <= 16384, pageBytes);
        assert.ok(payload.returned_count > 0);
        cursor = payload.continuation;
        if (cursor !== null) assert.notEqual(cursor, supplied);
        for (const entry of payload.entries) {
          if (entry.entry_spilled === true) {
            const entryBytes = readReferenceBytes(entry.content_reference, env);
            assert.equal(entry.entry_byte_count, entryBytes.byteLength);
            assert.equal(entry.entry_sha256,
              createHash("sha256").update(entryBytes).digest("hex"));
            recovered.push(JSON.parse(entryBytes.toString("utf8")).selector);
          } else recovered.push(entry.selector);
        }
        trace.push({ returned: payload.returned_count, remaining: payload.remaining_count,
          next: cursor === null ? null
            : JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")).offset,
          spilled: payload.entries.some(({ entry_spilled }) => entry_spilled === true),
          bytes: pageBytes });
      } while (cursor !== null);
      assert.deepEqual(recovered, expected);
      assert.equal(new Set(recovered).size, expected.length);
      detailTraces[position] = trace;
    }
    t.diagnostic(`multi-spill final bytes ${selectedBytes}; returned ${selected.structuredContent.returned_count}; omitted ${selected.structuredContent.byte_omitted_matched_count}`);
    t.diagnostic(`oversized index cursor traces ${JSON.stringify(cursorTraces)}`);
    t.diagnostic(`oversized proof-detail cursor traces ${JSON.stringify(detailTraces)}`);
    t.diagnostic(`selected spill integrity ${JSON.stringify({ bytes: selectedArtifact.byteLength,
      sha256: createHash("sha256").update(selectedArtifact).digest("hex") })}`);
  } finally { await client.close(); await server.close(); }
});

test("large controlled-contract responses use the existing spill reference and reassemble losslessly", async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "wk2012-spill-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const env = {
    WIKI_MCP_RESPONSE_STATE_DIR: stateDir,
    WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: "8192",
    WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT: "1024"
  };
  const found = new Map();
  registerControlledContractTools({
    registerTool: (name, config, handler) => found.set(name, { config, handler }),
    workspaceRepos: { currentAlias: "current" },
    z,
    jsonContent: (value) => jsonContent(value, { env }),
    errorContent: (error) => ({ isError: true, structuredContent: error.envelope }),
    resolveWorkspaceRepo: () => ({ repo: "current", dir: REPO })
  });
  const response = await found.get("workspace_controlled_contract_carrier_read").handler({
    wk_id: "WK-2012",
    carrier_kind: "contract"
  });
  assert.equal(response.structuredContent.response_spilled, true);
  const bounded = await found.get("workspace_controlled_contract_carrier_query").handler({
    wk_id: "WK-2012", carrier_kind: "contract"
  });
  assert.equal(bounded.structuredContent.response_spilled, undefined);
  assert.equal(Object.hasOwn(bounded.structuredContent, "content"), false);
  assert.equal(Object.hasOwn(bounded.structuredContent, "workspaceRepo"), false);
  const reference = response.structuredContent.content_reference;
  const chunks = [];
  let offset = 0;
  do {
    const part = readSpilledMcpContentReference({
      ref_id: reference.ref_id,
      offset,
      length: reference.range.max_length
    }, { env });
    chunks.push(Buffer.from(part.data_base64, "base64"));
    offset = part.next_offset;
  } while (offset !== null);
  const reconstructed = Buffer.concat(chunks);
  assert.equal(reconstructed.length, reference.byte_count);
  assert.deepEqual(JSON.parse(reconstructed.toString("utf8")), {
    workspaceRepo: "current",
    schema_version: "controlled-contract-canonical-carrier.v1",
    wk_id: "WK-2012",
    focus: null,
    carrier_kind: "contract",
    filename: "WK-2012.controlled-acceptance.json",
    content_digest: JSON.parse(reconstructed.toString("utf8")).content_digest,
    content: JSON.parse(await readFile(path.join(
      REPO, "wiki/contracts/WK-2012.controlled-acceptance.json"
    ), "utf8"))
  });
});

test("an oversized selected node spills only that node and keeps the query response bounded", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2012-node-spill-repo-"));
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "wk2012-node-spill-state-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }),
    rm(stateDir, { recursive: true, force: true })]));
  await mkdir(path.join(root, "wiki/contracts"), { recursive: true });
  const carrier = JSON.parse(await readFile(path.join(
    REPO, "wiki/contracts/WK-2012.controlled-acceptance.json"
  ), "utf8"));
  carrier.residue.push({ residue_id: "res-selected-spill", reason: "review_only",
    text: "x".repeat(20000) });
  await writeFile(path.join(root, "wiki/contracts/WK-2995.controlled-acceptance.json"),
    `${JSON.stringify(carrier, null, 2)}\n`);
  const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir,
    WIKI_MCP_RESPONSE_REFERENCE_READ_BYTE_LIMIT: "65536" };
  const found = new Map();
  registerControlledContractTools({
    registerTool: (name, config, handler) => found.set(name, { config, handler }),
    workspaceRepos: { currentAlias: "current" }, z,
    jsonContent: (value, options = {}) => jsonContent(value, { env, ...options }),
    errorContent: (error) => ({ isError: true, structuredContent: error.envelope }),
    resolveWorkspaceRepo: () => ({ repo: "current", dir: root })
  });
  const response = await found.get("workspace_controlled_contract_carrier_query").handler({
    wk_id: "WK-2995", carrier_kind: "contract", selectors: ["res-selected-spill"]
  });
  assert.ok(Buffer.byteLength(JSON.stringify(response.structuredContent, null, 2)) <= 16384);
  assert.equal(response.structuredContent.response_spilled, undefined);
  assert.equal(response.structuredContent.items[0].value_spilled, true);
  const reference = response.structuredContent.items[0].content_reference;
  assert.ok(reference);
  const nodeBytes = readReferenceBytes(reference, env);
  const node = JSON.parse(nodeBytes.toString("utf8"));
  assert.equal(node.residue_id, "res-selected-spill");
  assert.equal(Object.hasOwn(node, "references"), false);
  assert.equal(response.structuredContent.items[0].node_byte_count, nodeBytes.byteLength);
  assert.equal(response.structuredContent.items[0].node_sha256,
    createHash("sha256").update(nodeBytes).digest("hex"));
});
