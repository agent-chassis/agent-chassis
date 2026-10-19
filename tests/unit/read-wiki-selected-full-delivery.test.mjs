

import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  errorContent, guardToolHandler, jsonContent, measureMcpInlineResultBytes, measureMcpSerializedResultBytes,
  selectedFullContent
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  createSelectedResponseSession, readSelectedResponseFull, readSelectedResponseSource,
  retainSelectedResponseSource, selectedResponseDetailSchema, selectedResponseRequestSchema
} from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";
import { assertStructuredCarrier, deliveredAdmissionBytes } from "../helpers/mcp-journey-accounting.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

const LIMIT = 8192;
const ROUTE = "workspace_selected_full_fixture";
const MARKER = "protected-carrier-marker";
const AUTHORITY_A = Object.freeze({ role: "reviewer", run: { run_id: "run-a", retry_id: 0 } });
const AUTHORITY_B = Object.freeze({ role: "reviewer", run: { run_id: "run-b", retry_id: 0 } });
const row = (index) => ({ index, text: `${MARKER} 行 ${index} "quoted" \\ back\ttab\né 🚀 ${"λ".repeat(40)}`,
  nested: { tags: [`tag-${index}`, "ω"], depth: { leaf: index * 3, empty: [] } } });
const ROWS = 800;
const CARRIER = Object.freeze({ title: "complete é", rows: Array.from({ length: ROWS }, (_, index) => row(index)),
  groups: { alpha: [[1, 2], [3, { deep: "深" }]], omega: { last: "  final \"value\"" } }, tail: null });
const binding = (authority, fields = {}) => ({ route: ROUTE, repository: "fixture-repo", unit: "WK-0001#SLICE-001",
  ...(authority === undefined ? {} : { authority_identity: authority }), ...fields });
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

function stateEnv(t) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const dir = mkdtempSync(path.join(os.tmpdir(), "selected-full-"));
  scope.add("response state", () => rmSync(dir, { recursive: true, force: true }));
  return { scope, dir, env: { WIKI_MCP_RESPONSE_STATE_DIR: dir, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: String(LIMIT) } };
}
const retain = (env, authority, carrier = CARRIER, fields = {}) =>
  retainSelectedResponseSource({ binding: binding(authority, fields), carrier }, { env });
const full = (env, source, authority = AUTHORITY_A) =>
  readSelectedResponseFull(source, { env, expected: binding(authority) });
const guarded = (env, result, options = {}) => guardToolHandler(async () => result, { name: "fixture", env, ...options })({});

const refused = (reason, code = "selected_response_query_invalid") => (error) => {
  assert.equal(error?.envelope?.code, code, String(error?.stack ?? error));
  const disclosed = `${error.message}${JSON.stringify(error.envelope)}`;
  assert.ok(disclosed.includes(`"${reason}"`), `${reason}: ${disclosed}`);
  assert.equal(disclosed.includes(MARKER), false, "a refusal discloses no protected payload");
  return true;
};
const UNREADABLE = "mcp_response.content_reference_ranged_read_unavailable.v1";

function complete(result, expected = CARRIER, options) {
  const value = assertStructuredCarrier(result, options);
  assert.deepEqual(value, expected);
  assert.notEqual(result.isError, true);
  assert.equal(value.response_spilled, undefined);
  return value;
}

for (const inlineLimit of [undefined, 8192, 262144]) test(`RW-D01 SDK inline=${inlineLimit ?? "default"}`, async (t) => {
  const { scope, env: base, dir } = stateEnv(t);
  const env = { ...base };
  if (inlineLimit === undefined) delete env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT;
  else env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT = String(inlineLimit);
  const small = { title: "exact é 🚀 \"quoted\" \\ back\ttab\n", rows: [row(0)] };
  const sources = { small: retain(env, AUTHORITY_A, small), large: retain(env, AUTHORITY_A) };
  const before = readdirSync(dir);
  let calls = 0;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "selected-full-test", version: "1.0.0" });
  const client = new Client({ name: "selected-full-client", version: "1.0.0" }, { capabilities: {} });
  scope.add("sdk pair", async () => { await client.close(); await server.close(); });
  server.registerTool("selected_full", { inputSchema: { size: z.enum(["small", "large", "wrong_authority", "mutated", "remirrored", "metadata", "copied", "deleted"]) } },
    guardToolHandler(async ({ size }) => {
      calls += 1;
      if (size === "wrong_authority") return full(env, sources.small, AUTHORITY_B);
      const result = full(env, sources[size === "small" || size === "metadata" ? "small" : "large"]);
      if (size === "mutated") result.structuredContent.rows.push(row(ROWS));
      if (size === "remirrored") result.content = [{ type: "text", text: "stale" }];
      if (size === "metadata") result._meta = { extra: "é".repeat(LIMIT) };
      if (size === "copied") return { ...result };
      if (size === "deleted") delete result.structuredContent;
      return result;
    }, { name: "selected_full", env }));
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const exact = await client.callTool({ name: "selected_full", arguments: { size: "small" } });
  assert.deepEqual(assertStructuredCarrier(exact), small);
  assert.deepEqual(exact.content, [{ type: "text", text: JSON.stringify(small) }]);
  const delivered = await client.callTool({ name: "selected_full", arguments: { size: "large" } });
  complete(delivered);
  assert.ok(deliveredAdmissionBytes(delivered) > 128 * 1024);
  complete(await client.callTool({ name: "selected_full", arguments: { size: "remirrored" } }));
  const metadata = await client.callTool({ name: "selected_full", arguments: { size: "metadata" } });
  complete(metadata, small);
  assert.deepEqual(metadata._meta, { extra: "é".repeat(LIMIT) });
  const deleted = await client.callTool({ name: "selected_full", arguments: { size: "deleted" } });
  assert.equal(deleted.isError, true);
  assert.match(JSON.stringify(deleted), /lost structuredContent/u);
  const denied = await client.callTool({ name: "selected_full", arguments: { size: "wrong_authority" } });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /source_binding_mismatch/u);
  assert.ok(deliveredAdmissionBytes(denied) <= LIMIT);
  assert.equal(JSON.stringify(denied).includes(MARKER), false);
  assert.deepEqual(readdirSync(dir), before, "authenticated reads create no spill or replacement original");
  const copied = await client.callTool({ name: "selected_full", arguments: { size: "copied" } });
  if (inlineLimit === 262144) complete(copied);
  else {
    assert.equal(assertStructuredCarrier(copied).response_spilled, true, 'copied result loses selected-full authentication');
    assert.ok(deliveredAdmissionBytes(copied) <= LIMIT);
  }
  const mutated = await client.callTool({ name: "selected_full", arguments: { size: "mutated" } });
  if (inlineLimit === 262144) {
    assert.deepEqual(assertStructuredCarrier(mutated), { ...CARRIER, rows: [...CARRIER.rows, row(ROWS)] });
  } else assert.equal(assertStructuredCarrier(mutated).response_spilled, true);
  assert.equal(calls, 8);
  assert.deepEqual(full(env, sources.large).structuredContent, CARRIER, "every retained row stays exact");
  t.diagnostic(JSON.stringify({ inline: inlineLimit ?? "default", small: deliveredAdmissionBytes(exact),
    oversized: deliveredAdmissionBytes(delivered), requested: bytes(CARRIER), physical: bytes(delivered) }));
});

test("selected members cross the old compact boundary with exact escaping", async t => {
  const { env } = stateEnv(t);
  const make = length => ({ text: "é🚀\"\\\t\n" + "x".repeat(length) });
  const overhead = measureMcpInlineResultBytes(make(0));
  const atLimit = make(LIMIT - overhead);
  const overLimit = make(LIMIT - overhead + 1);
  assert.equal(measureMcpInlineResultBytes(atLimit), LIMIT);
  assert.deepEqual(assertStructuredCarrier(await guarded(env, full(env, retain(env, AUTHORITY_A, atLimit)))), atLimit);
  const delivered = await guarded(env, full(env, retain(env, AUTHORITY_A, overLimit)));
  complete(delivered, overLimit);
  assert.equal(deliveredAdmissionBytes(delivered), LIMIT + 1);
});

test("RW-D02", async (t) => {
  const { dir, env } = stateEnv(t);
  const sourceA = retain(env, AUTHORITY_A);
  const sourceB = retain(env, AUTHORITY_B);
  assert.deepEqual(full(env, sourceA).structuredContent, CARRIER);
  assert.deepEqual(full(env, sourceB, AUTHORITY_B).structuredContent, CARRIER);
  assert.deepEqual(readSelectedResponseSource(sourceA, { env, expected: { route: ROUTE } }).carrier,
    readSelectedResponseSource(sourceB, { env, expected: { route: ROUTE } }).carrier, "equal content, different bindings");

  assert.throws(() => full(env, sourceA, AUTHORITY_B), refused("source_binding_mismatch"));
  assert.throws(() => full(env, sourceB, AUTHORITY_A), refused("source_binding_mismatch"));
  for (const [field, other] of [["repository", "other-repo"], ["unit", "WK-0002"], ["route", "workspace_other"]]) {
    assert.throws(() => readSelectedResponseFull(sourceA, { env, route: ROUTE,
      expected: binding(AUTHORITY_A, { [field]: other }) }), refused("source_binding_mismatch"), field);
  }

  assert.throws(() => full(env, retain(env, undefined)), refused("source_binding_mismatch"));

  for (const field of ["route", "repository", "unit"]) {
    const { [field]: omitted, ...partial } = binding(AUTHORITY_A);
    assert.throws(() => readSelectedResponseFull(sourceA, { env, route: ROUTE, expected: partial }),
      refused("source_binding_mismatch"), `omitted ${field}`);
  }
  for (const authority of [undefined, null]) {
    assert.throws(() => readSelectedResponseFull(sourceA, { env, expected: binding(undefined,
      authority === null ? { authority_identity: null } : {}) }), refused("authority_identity_missing"));
  }
  assert.throws(() => readSelectedResponseFull(sourceA, { env, route: ROUTE }), refused("source_binding_mismatch"));
  assert.throws(() => readSelectedResponseFull(sourceA, { env, expected: {} }), TypeError);

  const spilled = jsonContent(CARRIER, { env }).structuredContent.content_reference;
  assert.throws(() => full(env, { ref_id: spilled.ref_id, sha256: spilled.sha256 }),
    refused("source_not_selected_response"));
  assert.throws(() => full(env, { ref_id: sourceA.ref_id, sha256: "0".repeat(64) }),
    refused("content_reference_recorded_digest_mismatch", UNREADABLE));
  assert.throws(() => full(env, { ref_id: "../escape", sha256: sourceA.sha256 }), refused("source_locator_invalid"));
  assert.throws(() => selectedFullContent({ source: sourceA, member: "carrier",
    retained: { ...readSelectedResponseSource(sourceA, { env, expected: { route: ROUTE } }), carrier: { forged: true } } }),
  TypeError, "the constructor delivers only a value that is the locator's retained bytes");

  let produced = 0;
  let current = { ...CARRIER, generation: 1 };
  const session = () => createSelectedResponseSession({ route: ROUTE, env, requireAuthorityIdentity: true,
    requestSchema: selectedResponseRequestSchema(z.object({ detail: selectedResponseDetailSchema(z) }).strict()),
    buildDetailArguments: (_binding, selection) => ({ detail: selection }) });
  const produce = () => { produced += 1; return structuredClone(current); };
  const { source: sessionSource } = session().retain({ binding: binding(AUTHORITY_A), carrier: produce() });
  current = { generation: 2 };
  session();
  assert.deepEqual(full(env, sessionSource).structuredContent, { ...CARRIER, generation: 1 });
  assert.equal(produced, 1, "a cold read reruns no producer and reads no current source");

  const retainedPath = path.join(dir, `${sourceA.ref_id}.json`);
  writeFileSync(retainedPath, `${JSON.stringify({ tampered: MARKER })}\n`);
  assert.throws(() => full(env, sourceA), refused("content_reference_digest_mismatch", UNREADABLE));
  rmSync(retainedPath);
  assert.throws(() => full(env, sourceA), refused("content_reference_not_found", UNREADABLE));
});

test("RW-D03", async (t) => {
  const { env } = stateEnv(t);
  const source = retain(env, AUTHORITY_A);
  const spilledOnly = (result, options) => {
    const value = assertStructuredCarrier(result, options);
    assert.equal(value.response_spilled, true, JSON.stringify(result).slice(0, 300));
    assert.ok(deliveredAdmissionBytes(result) <= LIMIT, "bounded by the unchanged inline limit");
    assert.equal(JSON.stringify(result).includes(row(ROWS - 1).text), false, "the complete value is not delivered");
    return value;
  };

  const small = { ok: true, note: "é ordinary" };
  const inline = await guarded(env, jsonContent(small, { env }));
  assert.deepEqual(assertStructuredCarrier(inline), small);
  assert.deepEqual([measureMcpInlineResultBytes(small), measureMcpSerializedResultBytes(small)],
    [deliveredAdmissionBytes(inline), bytes(inline)], "admission and physical bytes are separate metrics");
  assert.ok(bytes(inline) > deliveredAdmissionBytes(inline));
  spilledOnly(await guarded(env, jsonContent(CARRIER, { env })));
  spilledOnly(await guarded(env, { structuredContent: { context: CARRIER } }));
  const refusal = await guarded(env, errorContent({ envelope: { code: "example_refusal", detail: CARRIER } }, { env }));
  assert.equal(refusal.isError, true);
  spilledOnly(refusal);

  const delivered = await guarded(env, full(env, source));
  complete(delivered);
  assert.equal(await guarded(env, delivered), delivered, "normalization is idempotent for the delivered result");

  const forgedHandler = guardToolHandler(async (args) => ({ structuredContent: { ...CARRIER, complete: args.complete, selected_full: args.selected_full },
    _meta: { selected_full: true, delivery_class: "selected_full" }, selectedFull: true }), { name: "forged", env });
  spilledOnly(await forgedHandler({ selected_full: true, full: true, complete: true }));
  spilledOnly(await guarded(env, { ...full(env, source) }));
  spilledOnly(await guarded(env, { structuredContent: full(env, source).structuredContent }));
  spilledOnly(await guarded(env, { structuredContent: { ...full(env, source).structuredContent } }));

  const mutated = (mutate) => { const result = full(env, source); mutate(result); return guarded(env, result); };
  spilledOnly(await mutated((result) => { result.structuredContent = { replaced: "r".repeat(LIMIT * 3) }; }));
  spilledOnly(await mutated((result) => { result.structuredContent.unrelated = "appended material"; }));
  spilledOnly(await mutated((result) => { result.structuredContent.rows.push(row(ROWS)); }));
  const metadata = await mutated((result) => { result._meta = { note: "protocol metadata" }; });
  complete(metadata);
  assert.deepEqual(metadata._meta, { note: "protocol metadata" });
  const withResource = await mutated((result) => {
    result.content.push({ type: "resource", resource: { uri: "file:///unrelated", text: "unrelated" } });
  });
  complete(withResource, CARRIER, { permitNonTextBlocks: true });
  assert.equal(withResource.content[1].resource.text, "unrelated");
  const flagged = await mutated((result) => { result.isError = true; });
  assert.equal(flagged.isError, true);
  assert.deepEqual(assertStructuredCarrier(flagged), CARRIER);

  const remirrored = await mutated((result) => {
    result.content = [{ type: "text", text: "stale" }, { type: "text", text: "additional" }];
  });
  complete(remirrored);
  assert.equal(remirrored.content[0].text, JSON.stringify(remirrored.structuredContent));

  const invalid = await guarded(env, full(env, source), { outputSchema: { absent_member: z.string() } });
  assert.equal(invalid.isError, true);
  assert.equal(assertStructuredCarrier(invalid).broken_invariant, "structuredContent must satisfy outputSchema");
});

test("native journal selected-full delivery conserves verified source and transport class", async (t) => {
  const { dir, env } = stateEnv(t);
  const serializedBytes = Buffer.from('{"event":"行 🚀","sequence":0}\n{"event":"tail","sequence":1}\n');
  const source = { sha256: createHash("sha256").update(serializedBytes).digest("hex") };
  const projection = { member: "proof_verifications", value: CARRIER.rows, nested: CARRIER.groups };
  const before = readdirSync(dir);
  const exact = selectedFullContent({ source, serializedBytes, projection });
  complete(await guarded(env, exact), projection);
  assert.deepEqual(assertStructuredCarrier(exact), projection, "the internal original is exact");
  assert.deepEqual(readdirSync(dir), before, "native selection retains no response snapshot");
  const jsonSource = retain(env, AUTHORITY_A);
  complete(await guarded(env, full(env, jsonSource)));
});

test("native journal selected-full delivery rejects invalid sources and forged admission", async (t) => {
  const { env } = stateEnv(t);
  const serializedBytes = Buffer.from('{"sequence":0}\n');
  const source = { sha256: createHash("sha256").update(serializedBytes).digest("hex") };
  const projection = { member: "proof_verifications", value: CARRIER.rows };
  const options = { source, serializedBytes, projection };
  for (const change of [{ source: { sha256: "0".repeat(64) } }, { serializedBytes: Buffer.from("changed") },
    { serializedBytes: serializedBytes.toString() }, { serializedBytes: Buffer.alloc(0) },
    { projection: undefined }, { retained: {} }, { member: "value" }, { source: undefined }]) {
    assert.throws(() => selectedFullContent({ ...options, ...change }), TypeError);
  }
  const spill = async result => assert.equal(assertStructuredCarrier(await guarded(env, result)).response_spilled, true);
  const make = () => selectedFullContent(options);
  await spill({ ...make() });
  const mutation = make(); mutation.structuredContent.value.push(row(ROWS)); await spill(mutation);
  const metadata = make(); metadata._meta = { selected_full: true }; complete(await guarded(env, metadata), projection);
  await spill({ structuredContent: { ...projection, selected_full: true }, selectedFull: true });
  await spill(jsonContent(projection, { env }));
});

test("selected complete serialization failures remain errors", async t => {
  const { env } = stateEnv(t);
  for (const mutate of [result => { result.structuredContent.cycle = result.structuredContent; },
    result => { result._meta = { invalid: 1n }; }, result => { result.extension = result; }]) {
    const result = full(env, retain(env, AUTHORITY_A));
    mutate(result);
    const failed = await guarded(env, result);
    assert.equal(failed.isError, true);
    assert.match(JSON.stringify(failed), /JSON-serializable|BigInt|circular/u);
    assert.equal(failed.structuredContent?.response_spilled, undefined);
  }
});
