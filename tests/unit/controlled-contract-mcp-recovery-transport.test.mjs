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

import { CONTROLLED_CONTRACT_MCP_TOOL_NAMES, registerControlledContractTools } from
  "../../packages/wiki-mcp/src/lib/controlled-contract-tools.mjs";
import { errorContent, jsonContent } from
  "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { stabilizeHistoricalCarrier, writeCanonicalWorkRecord } from
  "../helpers/historical-controlled-contract-fixtures.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CONTRACTS = path.join(REPO, "wiki", "contracts");
const FOCUS = "caller-substrate-refusal";

async function fixtureRepo(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2031-recovery-transport-"));
  const contracts = path.join(root, "wiki", "contracts");
  await mkdir(contracts, { recursive: true });
  await Promise.all([
    ...files.map(async (file) => {
      const content = await stabilizeHistoricalCarrier(file,
        JSON.parse(await readFile(path.join(CONTRACTS, file), "utf8")));
      await writeFile(path.join(contracts, file), `${JSON.stringify(content, null, 2)}\n`);
    }),

    writeCanonicalWorkRecord(root, "WK-2012")
  ]);
  return root;
}

const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
const contentDigest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function resealGeneration(root, focus, replace) {
  const contracts = path.join(root, "wiki", "contracts");
  const manifestPath = path.join(contracts, `${stem(focus)}.carrier-set-manifest.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const priorDirectory = path.join(contracts, manifest.generation.path);
  const entries = await Promise.all(manifest.carrier_census.map(async (member) => {
    const stored = JSON.parse(await readFile(path.join(priorDirectory, member.filename), "utf8"));
    return { member_kind: member.member_kind, carrier_kind: member.carrier_kind,
      filename: member.filename, bytes: canonicalBytes(replace(member, stored)) };
  }));
  const generation = createHash("sha256").update(canonicalBytes({
    repository: manifest.repository, wk_id: manifest.wk_id, focus: manifest.focus,
    profile: manifest.profile,
    carriers: entries.map(({ member_kind, carrier_kind, filename, bytes }) => ({
      member_kind, carrier_kind, filename, byte_length: bytes.byteLength,
      bytes_base64: bytes.toString("base64") }))
  })).digest("hex");
  const generationPath = path.posix.join(".carrier-generations", generation);
  const census = entries.map(({ member_kind, carrier_kind, filename, bytes }) => ({
    member_kind, carrier_kind, filename, path: path.posix.join(generationPath, filename),
    content_digest: contentDigest(bytes), byte_length: bytes.byteLength }));
  const body = { schema_version: manifest.schema_version, repository: manifest.repository,
    wk_id: manifest.wk_id, focus: manifest.focus, profile: manifest.profile,
    generation: { id: generation, path: generationPath }, carriers: census,
    carrier_census: census };
  const bytes = canonicalBytes({ ...body,
    manifest_digest: contentDigest(canonicalBytes(body)) });
  const directory = path.join(contracts, generationPath);
  await mkdir(directory, { recursive: true });
  await Promise.all([...entries.map((entry) =>
    writeFile(path.join(directory, entry.filename), entry.bytes)),
  writeFile(path.join(directory, "manifest.json"), bytes)]);
  await rm(priorDirectory, { recursive: true, force: true });
  await writeFile(manifestPath, bytes);
  return Object.fromEntries(census.map((member) => [member.carrier_kind, member]));
}

function stem(focus = null) { return focus === null ? "WK-2012" : `WK-2012-${focus}`; }
function identity(focus, content_digest) {
  return { carrier_kind: "contract", wk_id: "WK-2012", focus, content_digest };
}

function recoveryCall(tool, arguments_, recommended = true) {
  return { tool, arguments: arguments_, recommended };
}

function renderedNextCall({ tool, arguments: arguments_ }) {
  const parts = Object.entries(arguments_).map(([key, value]) =>
    `${key}:${typeof value === "string" ? `\"${value}\"` : JSON.stringify(value)}`);
  return `${tool}({${parts.join(", ")}})`;
}

function expectedNext(focus, kind, digest = null) {
  if (kind === "request") return recoveryCall(
    "workspace_controlled_contract_authoring_describe", { carrier_kind: "proof_plan_request" });
  if (kind === "evaluation") return recoveryCall(
    "workspace_controlled_contract_authoring_describe", { carrier_kind: "evaluation_input" });
  return recoveryCall("workspace_controlled_proof_plan_build", {
    wk_id: "WK-2012", ...(focus === null ? {} : { focus }), expected_content_digest: digest
  });
}

async function connectRecoveryServer(repoRoot) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "wk2031-recovery", version: "1.0.0" });
  const client = new Client({ name: "wk2031-recovery-client", version: "1.0.0" }, { capabilities: {} });
  registerControlledContractTools({
    registerTool: server.registerTool.bind(server), workspaceRepos: { currentAlias: "current" }, z,
    jsonContent, errorContent, resolveWorkspaceRepo: () => ({ repo: "current", dir: repoRoot })
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

async function call(client, name, arguments_) {
  const response = await client.callTool({ name, arguments: arguments_ });
  assert.notEqual(response.isError, true, `${name} unexpectedly returned an MCP error`);
  return response.structuredContent;
}

function assertDecision(actual, { reason, focus, contractDigest, next, extra = {} }) {
  assert.deepEqual(actual, {
    workspaceRepo: "current",
    status: "recoverable-incomplete",
    reason_code: reason,
    contract_identity: identity(focus, contractDigest),
    next_calls: [next],
    next_action: renderedNextCall(next),
    ...extra
  });
  assert.equal(actual.next_calls.filter(({ recommended }) => recommended === true).length, 1);
  assert.equal(Object.hasOwn(actual, "schema_version"), false);
  assert.equal(Object.hasOwn(actual, "calls"), false);
  assert.equal(Object.hasOwn(actual, "operation"), false);
}

test("real MCP transport returns exact root and focused recovery projections", async (t) => {
  const cases = [
    { focus: null, files: ["WK-2012.controlled-acceptance.json"], kind: "request",
      reason: "controlled_contract_proof_plan_request_missing" },
    { focus: FOCUS, files: [`WK-2012-${FOCUS}.controlled-acceptance.json`,
      `WK-2012-${FOCUS}.proof-plan-request.json`], kind: "evaluation",
      reason: "controlled_contract_evaluation_input_missing" },
    { focus: null, files: ["WK-2012.controlled-acceptance.json", "WK-2012.proof-plan-request.json"],
      kind: "plan", reason: "controlled_contract_proof_plan_missing" },
    { focus: FOCUS, files: [`WK-2012-${FOCUS}.controlled-acceptance.json`,
      `WK-2012-${FOCUS}.evaluation-input.json`, `WK-2012-${FOCUS}.proof-plan-request.json`],
      kind: "plan", reason: "controlled_contract_proof_plan_missing" }
  ];
  const roots = await Promise.all(cases.map(({ files }) => fixtureRepo(files)));
  t.after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));
  for (const [index, current] of cases.entries()) {
    const root = roots[index];
    const { client, server } = await connectRecoveryServer(root);
    try {
      const args = { wk_id: "WK-2012", ...(current.focus === null ? {} : { focus: current.focus }) };
      const next = expectedNext(current.focus, current.kind);
      const decision = await call(client, "workspace_controlled_contract_assess", args);
      assertDecision(decision, { reason: current.reason, focus: current.focus,
        contractDigest: decision.contract_identity.content_digest, next,
        extra: current.kind === "request" ? { missing_carrier: "proof_plan_request" } :
          current.kind === "evaluation" ? { missing_carrier: "evaluation_input" } :
            { missing_carrier: "proof_plan", expected_content_digest: null } });
      const recovery = await call(client, next.tool, next.arguments);
      assert.ok(recovery);
      assert.equal(Object.hasOwn(recovery, "operation"), false);
    } finally { await client.close(); await server.close(); }
  }
  await assertMalformedSources();
});

test("real MCP transport preserves stale-plan digest and generation invalidation", async (t) => {
  const root = await fixtureRepo([
    `WK-2012-${FOCUS}.controlled-acceptance.json`,
    `WK-2012-${FOCUS}.evaluation-input.json`, `WK-2012-${FOCUS}.proof-plan-request.json`
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const { client, server } = await connectRecoveryServer(root);
  try {
    const args = { wk_id: "WK-2012", focus: FOCUS };
    const missing = await call(client, "workspace_controlled_contract_assess", args);
    const built = await call(client, "workspace_controlled_proof_plan_build", missing.next_calls[0].arguments);
    assert.equal(built.carrier.written, true);
    const current = await call(client, "workspace_controlled_contract_assess", args);
    assert.equal(current.family, "proof");
    assert.equal(current.authority.authoritative, false);

    const superseded = await resealGeneration(root, FOCUS, (member, content) =>
      member.carrier_kind === "proof_plan"
        ? { ...content, digests: { ...content.digests, catalog: "0".repeat(64) } }
        : content);
    const stale = await call(client, "workspace_controlled_contract_assess", args);
    const planDigest = stale.expected_content_digest;
    assert.equal(planDigest, superseded.proof_plan.content_digest);
    assert.notEqual(planDigest, built.carrier.content_digest);
    const next = expectedNext(FOCUS, "plan", planDigest);
    assertDecision(stale, { reason: "controlled_contract_proof_plan_stale", focus: FOCUS,
      contractDigest: stale.contract_identity.content_digest, next,
      extra: { stale_carrier: "proof_plan", expected_content_digest: planDigest } });

    const repaired = await call(client, next.tool, next.arguments);
    assert.equal(repaired.carrier.previous_content_digest, planDigest);
    assert.equal(repaired.carrier.content_digest, built.carrier.content_digest);
    const reassessed = await call(client, "workspace_controlled_contract_assess", args);
    assert.equal(reassessed.family, "proof");
    assert.equal(reassessed.authority.authoritative, false);

    const patched = await call(client, "workspace_controlled_contract_carrier_patch", {
      ...args, carrier_kind: "contract",
      expected_content_digest: current.source.controlled_contract_digest,
      operations: [{ op: "upsert", target: "annotations",
        value: { annotation_id: "ann-stale", kind: "provenance", text: "stale" } }]
    });
    assert.equal(patched.written, true);
    assert.deepEqual(patched.invalidation, { proof_plan: "stale", assessment: "stale" });
    const dropped = await call(client, "workspace_controlled_contract_assess", args);
    assertDecision(dropped, { reason: "controlled_contract_proof_plan_missing", focus: FOCUS,
      contractDigest: patched.content_digest, next: expectedNext(FOCUS, "plan"),
      extra: { missing_carrier: "proof_plan", expected_content_digest: null } });
  } finally { await client.close(); await server.close(); }
});

async function assertMalformedSources() {
  const root = await fixtureRepo([
    "WK-2012.controlled-acceptance.json", "WK-2012.proof-plan-request.json"
  ]);
  const { client, server } = await connectRecoveryServer(root);
  try {
    const args = { wk_id: "WK-2012" };
    const requestPath = path.join(root, "wiki", "contracts", "WK-2012.proof-plan-request.json");
    const request = await readFile(requestPath, "utf8");
    await writeFile(requestPath, "{}\n");
    const malformedWithoutPlan = await client.callTool({
      name: "workspace_controlled_contract_assess", arguments: args
    });
    assert.equal(malformedWithoutPlan.isError, true);
    assert.equal(malformedWithoutPlan.structuredContent.warning.payload.reason_code,
      "controlled_contract_proof_plan_request_invalid");
    await writeFile(requestPath, request);

    const missing = await call(client, "workspace_controlled_contract_assess", args);
    const built = await call(client, "workspace_controlled_proof_plan_build", missing.next_calls[0].arguments);
    assert.equal(built.carrier.written, true);

    await writeFile(requestPath, "{}\n");
    const malformedWithPlan = await call(client, "workspace_controlled_contract_assess", args);
    assert.equal(malformedWithPlan.family, "proof");
    assert.equal(malformedWithPlan.authority.authoritative, false);
    await writeFile(requestPath, request);
  } finally {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("real MCP descriptors and inventory remain exact, and missing contract stays distinct", async (t) => {
  const root = await fixtureRepo([
    "WK-2012.controlled-acceptance.json", "WK-2012.proof-plan-request.json",
    "WK-2012.proof-plan.json"
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const { client, server } = await connectRecoveryServer(root);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), [...CONTROLLED_CONTRACT_MCP_TOOL_NAMES]);
    const build = listed.tools.find(({ name }) => name === "workspace_controlled_proof_plan_build");
    const assess = listed.tools.find(({ name }) => name === "workspace_controlled_contract_assess");
    assert.deepEqual(build.inputSchema.required, ["wk_id", "expected_content_digest"]);
    assert.deepEqual(assess.inputSchema.required, ["wk_id"]);
    assert.ok(build.inputSchema.properties.focus);
    assert.ok(build.inputSchema.properties.expected_content_digest);
    const missing = await client.callTool({ name: "workspace_controlled_contract_assess",
      arguments: { wk_id: "WK-2999" } });
    assert.equal(missing.isError, true);
    assert.equal(missing.structuredContent.warning.payload.reason_code,
      "controlled_contract_carrier_not_found");
  } finally { await client.close(); await server.close(); }
});
