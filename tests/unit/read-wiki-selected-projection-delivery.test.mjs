

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { errorContent, guardToolHandler, jsonContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  readSelectedResponseFull, readSelectedResponseProjection, retainSelectedResponseSource
} from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";
import { assertStructuredCarrier, deliveredAdmissionBytes } from "../helpers/mcp-journey-accounting.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";
import { z } from "zod";
import { bindInputSchemaExposure } from "../../packages/wiki-mcp/src/lib/input-schema-exposure.mjs";
import { createSaveRecordInputExposure } from "../../packages/wiki-mcp/src/lib/save-record-input-exposure.mjs";
import { workItemRequirementBatchSchema } from "../../packages/wiki-core/src/lib/record-authoring-schema.mjs";
import { createSaveRecordInputContract, saveRecordUnitVariant } from
  "../../packages/wiki-mcp/src/lib/task-save-record-tools.mjs";

const LIMIT = 8192;
const ROUTE = "workspace_selected_projection_fixture";
const PRIVATE = "PRIVATE_DIAGNOSIS_INVENTORY_MARKER";
const AUTHORITY_A = Object.freeze({ role: "orchestrator", source: { kind: "canonical_workspace", repository: "fixture-repo" } });
const AUTHORITY_B = Object.freeze({ role: "reviewer", run: { run_id: "run-b" } });

const DIAGNOSIS = `selected diagnosis é 🚀 "quoted" \\ back\ttab\r\n${"語λ".repeat(30000)} end`;
const CARRIER = Object.freeze({
  assessment: { verdict: "refused", selected_diagnosis: DIAGNOSIS, case_ids: ["case-1", "case-2"] },
  diagnosis_inventory: Array.from({ length: 40 }, (_, index) => ({ id: `diag-${index}`, text: `${PRIVATE} ${index}` })),
  correction_routes: [{ tool: "private_route", arguments: { secret: PRIVATE } }]
});
const binding = (authority = AUTHORITY_A, fields = {}) => ({ route: ROUTE, repository: "fixture-repo",
  unit: "WK-0001#SLICE-001", ...(authority === null ? {} : { authority_identity: authority }), ...fields });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(t) {
  const scope = createTestResourceScope();
  t.after(() => scope.dispose());
  const dir = mkdtempSync(path.join(os.tmpdir(), "selected-projection-"));
  scope.add("response state", () => rmSync(dir, { recursive: true, force: true }));
  const env = { WIKI_MCP_RESPONSE_STATE_DIR: dir, WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT: String(LIMIT) };

  const producer = { calls: 0 };
  const produce = () => { producer.calls += 1; return structuredClone(CARRIER); };
  const source = retainSelectedResponseSource({ binding: binding(), carrier: produce() }, { env });

  const state = () => Object.fromEntries(readdirSync(dir).sort().map((name) => [name, sha256(readFileSync(path.join(dir, name)))]));
  return { scope, dir, env, source, producer, state };
}

const projector = (calls, present) => ({ binding: retainedBinding, carrier }) => {
  calls.push(retainedBinding.unit);
  return { assessment: carrier.assessment, currentness: present.currentness,
    next_calls: [{ tool: ROUTE, arguments: { cursor: present.cursor } }] };
};
const read = (env, source, project, expected = binding()) =>
  readSelectedResponseProjection(source, { env, expected, project });
const guarded = (env, result) => guardToolHandler(async () => result, { name: "fixture", env })({});
const refused = (reason, code = "selected_response_query_invalid") => (error) => {
  assert.equal(error?.envelope?.code, code, String(error?.stack ?? error));
  const disclosed = `${error.message}${JSON.stringify(error.envelope)}`;
  assert.ok(disclosed.includes(`"${reason}"`), `${reason}: ${disclosed}`);
  assert.equal(disclosed.includes(PRIVATE) || disclosed.includes("selected diagnosis"), false,
    "a refusal discloses no retained content");
  return true;
};
const UNREADABLE = "mcp_response.content_reference_ranged_read_unavailable.v1";

function complete(result, expected) {
  const value = assertStructuredCarrier(result);
  assert.notEqual(result.isError, true);
  assert.equal(value.response_spilled, undefined);
  if (expected !== undefined) assert.deepEqual(value, expected);
  assert.equal(JSON.stringify(value).includes(PRIVATE), false);
  return value;
}

for (const inlineLimit of [undefined, 8192, 262144]) test(`RW-J01 SDK inline=${inlineLimit ?? "default"}`, async (t) => {
  const { scope, env: base, source, producer, state } = fixture(t);
  const env = { ...base };
  if (inlineLimit === undefined) delete env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT;
  else env.WIKI_MCP_RESPONSE_INLINE_BYTE_LIMIT = String(inlineLimit);
  const before = state();
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const server = new McpServer({ name: "projection", version: "1.0.0" });
  const client = new Client({ name: "projection", version: "1.0.0" });
  scope.add("SDK", async () => { await client.close(); await server.close(); });
  const small = { verdict: "refused", cases: CARRIER.assessment.case_ids, note: "é 🚀 \"quoted\" \\ back\n" };
  const calls = [];
  server.registerTool("projection", { inputSchema: { large: z.boolean() } }, guardToolHandler(async ({ large }) =>
    read(env, source, large ? projector(calls, { currentness: { state: "current" }, cursor: "c" }) : () => small), { env }));
  server.registerTool("foreign_projection", {}, guardToolHandler(() => read(env, source,
    projector(calls, { currentness: { state: "unavailable" }, cursor: "denied" }), binding(AUTHORITY_B)), { env }));
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right); await client.connect(left);
  const exact = await client.callTool({ name: "projection", arguments: { large: false } });
  assert.deepEqual(assertStructuredCarrier(exact), small);
  const oversized = await client.callTool({ name: "projection", arguments: { large: true } });
  complete(oversized, { assessment: CARRIER.assessment, currentness: { state: "current" },
    next_calls: [{ tool: ROUTE, arguments: { cursor: "c" } }] });
  assert.ok(deliveredAdmissionBytes(oversized) > 128 * 1024);
  const denied = await client.callTool({ name: "foreign_projection", arguments: {} });
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /source_binding_mismatch/u);
  assert.ok(deliveredAdmissionBytes(denied) <= LIMIT);
  assert.equal(JSON.stringify(denied).includes(PRIVATE), false);
  assert.deepEqual(calls, ["WK-0001#SLICE-001"]);
  assert.deepEqual(readSelectedResponseFull(source, { env, expected: binding() }).structuredContent, CARRIER);
  const mutating = await read(env, source, ({ carrier }) => { carrier.assessment.verdict = "mutated"; return { ok: true }; });
  assert.deepEqual(assertStructuredCarrier(await guarded(env, mutating)), { ok: true });
  assert.equal(readSelectedResponseFull(source, { env, expected: binding() }).structuredContent.assessment.verdict, "refused");
  assert.deepEqual(state(), before, "reads rewrite and retain nothing");
  assert.equal(producer.calls, 1);
  t.diagnostic(JSON.stringify({ inline: inlineLimit ?? "default", small: deliveredAdmissionBytes(exact),
    oversized: deliveredAdmissionBytes(oversized), requested: Buffer.byteLength(JSON.stringify(oversized.structuredContent)),
    physical: Buffer.byteLength(JSON.stringify(oversized)) }));
});

test("RW-J02", async (t) => {
  const { dir, env, source, producer, state } = fixture(t);
  const calls = [];
  const project = projector(calls, { currentness: { state: "current" }, cursor: "c" });
  const never = (expected, route) => readSelectedResponseProjection(source, { env, expected, route, project });

  await assert.rejects(never(binding(AUTHORITY_B)), refused("source_binding_mismatch"));
  await assert.rejects(never(binding(null)), refused("authority_identity_missing"));
  await assert.rejects(never(binding(AUTHORITY_A, { authority_identity: null })), refused("authority_identity_missing"));
  for (const [field, other] of [["repository", "other-repo"], ["unit", "WK-0002"], ["route", "workspace_other"]]) {
    await assert.rejects(never(binding(AUTHORITY_A, { [field]: other }), ROUTE), refused("source_binding_mismatch"), field);
    const { [field]: omitted, ...partial } = binding();
    await assert.rejects(never(partial, ROUTE), refused("source_binding_mismatch"), `omitted ${field}`);
  }

  const foreign = retainSelectedResponseSource({ binding: binding(AUTHORITY_A, { route: "workspace_other_producer" }),
    carrier: CARRIER }, { env });
  await assert.rejects(read(env, foreign, project), refused("source_binding_mismatch"));

  const spill = jsonContent({ generic: PRIVATE }, { env, forceSpill: true }).structuredContent.content_reference;
  await assert.rejects(read(env, { ref_id: spill.ref_id, sha256: spill.sha256 }, project),
    refused("source_not_selected_response"));
  await assert.rejects(read(env, { ref_id: source.ref_id, sha256: "0".repeat(64) }, project),
    refused("content_reference_recorded_digest_mismatch", UNREADABLE));
  await assert.rejects(read(env, { ref_id: "../escape", sha256: source.sha256 }, project), refused("source_locator_invalid"));
  assert.deepEqual(calls, [], "no refused read reached the projector");

  const beforeFailures = state();

  const failure = Object.assign(new Error("currentness owner unavailable"), { code: "route_currentness_unavailable" });
  await assert.rejects(read(env, source, () => { throw failure; }), (error) => error === failure);
  await assert.rejects(read(env, source, async () => { throw failure; }), (error) => error === failure);
  for (const invalid of [null, "text", ["array"], 7, undefined]) {
    await assert.rejects(read(env, source, () => invalid), TypeError, `projection ${JSON.stringify(invalid)}`);
  }
  await assert.rejects(readSelectedResponseProjection(source, { env, expected: binding() }), TypeError);
  await assert.rejects(readSelectedResponseProjection(source, { env, expected: binding(), project: "carrier" }), TypeError);
  assert.deepEqual(state(), beforeFailures, "failed reads added or changed no retained file");
  assert.equal(producer.calls, 1);

  const retainedPath = path.join(dir, `${source.ref_id}.json`);
  writeFileSync(retainedPath, `${JSON.stringify({ tampered: PRIVATE })}\n`);
  await assert.rejects(read(env, source, project), refused("content_reference_digest_mismatch", UNREADABLE));
  rmSync(retainedPath);
  await assert.rejects(read(env, source, project), refused("content_reference_not_found", UNREADABLE));
  assert.deepEqual(calls, []);
});

test("RW-J03", async (t) => {
  const { env, source, state } = fixture(t);
  const project = projector([], { currentness: { state: "current" }, cursor: "c" });
  const spilledOnly = (result) => {
    const value = assertStructuredCarrier(result);
    assert.equal(value.response_spilled, true, JSON.stringify(result).slice(0, 300));
    assert.ok(deliveredAdmissionBytes(result) <= LIMIT);
    assert.equal(JSON.stringify(result).includes("語λ end"), false, "the complete value is not delivered");
  };

  spilledOnly(await guarded(env, jsonContent({ assessment: CARRIER.assessment }, { env })));
  const refusal = await guarded(env, errorContent({ envelope: { code: "example_refusal", detail: CARRIER.assessment } }, { env }));
  assert.equal(refusal.isError, true);
  spilledOnly(refusal);

  const delivered = await guarded(env, await read(env, source, project));
  assert.equal(await guarded(env, delivered), delivered, "normalization is idempotent for the delivered result");
  const mutated = async (mutate) => { const result = await read(env, source, project); mutate(result); return guarded(env, result); };
  spilledOnly(await guarded(env, { ...(await read(env, source, project)) }));
  spilledOnly(await mutated((result) => { result.structuredContent.diagnosis_inventory = CARRIER.diagnosis_inventory; }));
  spilledOnly(await mutated((result) => { result.structuredContent.currentness = { state: "forged" }; }));
  complete(await mutated((result) => { result._meta = { selected_projection: true }; }));
  const flagged = await mutated((result) => { result.isError = true; });
  assert.equal(flagged.isError, true);
  assert.deepEqual(assertStructuredCarrier(flagged).assessment, CARRIER.assessment);
  const remirrored = await mutated((result) => { result.content = [{ type: "text", text: "stale" }]; });
  assert.equal(remirrored.content[0].text, JSON.stringify(remirrored.structuredContent));
  complete(remirrored);

  const before = state();
  assert.deepEqual(Object.keys(source), ["ref_id"]);
  const locator = JSON.parse(JSON.stringify({ ref_id: source.ref_id }));
  const cold = await guarded(env, await readSelectedResponseProjection(locator, { env, expected: binding(),
    project: ({ carrier }) => ({ assessment: carrier.assessment, restarted: true }) }));
  complete(cold, { assessment: CARRIER.assessment, restarted: true });
  assert.equal(cold.content[0].text, JSON.stringify(cold.structuredContent));
  assert.deepEqual(state(), before, "a cold read retains nothing");
});

test("selected schema delivery preserves oversized schemas without changing their definitions", async (t) => {
  const { env, source, producer, state } = fixture(t);
  const before = state();
  const registeredTier = "paid_cce";
  const { changeSchemas } = createSaveRecordInputContract(z, registeredTier);
  const owner = JSON.parse(JSON.stringify(changeSchemas.work_item_slice));
  const declaration = createSaveRecordInputExposure({ changeSchemas, registeredTier,
    variants: ["WK-0001", "WK-0001#SLICE-001", "IN-0001", "DEC-0001"].map(unit => saveRecordUnitVariant(unit)) });
  const exposure = bindInputSchemaExposure(declaration);
  const members = ["criteria", "requirements", "obligations", "controlled_acceptance", "slices", "ready_slices"];
  const selected = exposure.source("work_item_slice").select({ groups: ["acceptance", "slice_shaping"] });
  const deliver = async (contract) => guarded(env, await read(env, source, () => ({ input_contract: contract })));

  const contract = { tool: "save_record", unit: "WK-0001#SLICE-001", variant: selected.source,
    members: selected.members, owner_schema_digest: selected.digest, schema: selected.schema };
  const result = await deliver(contract);
  complete(result, { input_contract: contract });
  const delivered = result.structuredContent.input_contract;
  assert.deepEqual(delivered.members, members);

  const referencesOf = (value, found = []) => {
    if (Array.isArray(value)) value.forEach(item => referencesOf(item, found));
    else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref" && typeof child === "string") found.push(child);
        else referencesOf(child, found);
      }
    }
    return found;
  };
  const reached = new Set(), pending = referencesOf(members.map(member => owner.properties[member]));
  while (pending.length > 0) {
    const name = pending.pop().slice("#/$defs/".length);
    if (!reached.has(name)) { reached.add(name); pending.push(...referencesOf(owner.$defs[name])); }
  }
  const definitions = Object.keys(owner.$defs).filter(name => reached.has(name));
  assert.deepEqual(definitions, [...Object.keys(workItemRequirementBatchSchema().$defs),
    "obligation_case", "obligation_statement", "obligation_criteria", "obligation_claims", "obligation_proof",
    "case_component", "case_target", "case_falsification", "ready_slice_edit_targets", "content_carrier", "edit_target_provenance"],
  "the current batch owner's definitions and the definitions the selected rows share, and no other");
  assert.ok(Object.keys(owner.$defs).length > definitions.length, "the owner declares definitions this selection does not reach");
  assert.deepEqual(delivered.schema, { type: "object", additionalProperties: false, minProperties: 1,
    $defs: Object.fromEntries(definitions.map(name => [name, owner.$defs[name]])),
    properties: Object.fromEntries(members.map(member => [member, owner.properties[member]])) },
  "every selected member, constraint and reached definition, exactly the owner's source");
  assert.deepEqual(Object.keys(delivered.schema.$defs), definitions, "in the owner's order");
  for (const reference of referencesOf(delivered.schema)) {
    assert.ok(Object.hasOwn(delivered.schema.$defs, reference.slice("#/$defs/".length)), `${reference} resolves inside the delivered answer`);
  }
  assert.equal(delivered.owner_schema_digest,
    exposure.source("work_item_slice").digest, "the selected schema retains its owner source identity");
  assert.deepEqual(result.content, [{ type: "text", text: JSON.stringify(result.structuredContent) }]);
  assert.deepEqual(Object.keys(result).sort(), ["content", "structuredContent"]);

  assert.ok(deliveredAdmissionBytes(result) > LIMIT);

  const large = { type: "object", additionalProperties: false,
    $defs: { code: { type: "string", enum: Array.from({ length: 2400 }, (_, index) => `code-${index}-é`) },
      row: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { $ref: "#/$defs/code" } } },
      unreached: { type: "integer" } },
    properties: { rows: { type: "array", minItems: 1, items: { $ref: "#/$defs/row" } }, other: { type: "string" } } };
  const withDefinitions = bindInputSchemaExposure({ digest: () => "sha256:fixture",
    sources: { large: { schema: large, groups: [{ name: "all", members: ["rows", "other"] }] } } })
    .source("large").select({ members: ["rows"] });
  const second = await deliver({ members: withDefinitions.members, schema: withDefinitions.schema });
  assert.deepEqual(withDefinitions.schema, { type: "object", additionalProperties: false,
    $defs: { code: large.$defs.code, row: large.$defs.row }, properties: { rows: large.properties.rows } });
  complete(second, { input_contract: { members: withDefinitions.members, schema: withDefinitions.schema } });
  assert.ok(deliveredAdmissionBytes(second) > LIMIT * 4);

  for (const frame of [result, second]) {
    for (const key of ["response_spilled", "content_reference"]) {
      assert.equal(Object.hasOwn(frame.structuredContent, key), false, key);
    }
  }

  assert.deepEqual(state(), before, "no content reference or page was written by delivery");
  assert.equal(producer.calls, 1);
});

test("credential-free selected schema omits paid requirements", () => {
  const { changeSchemas } = createSaveRecordInputContract(z);
  const exposure = bindInputSchemaExposure(createSaveRecordInputExposure({ changeSchemas,
    variants: [saveRecordUnitVariant("WK-0001#SLICE-001")] }));
  const selected = exposure.source("work_item_slice").select({ groups: ["acceptance", "slice_shaping"] });
  assert.deepEqual(selected.members, ["criteria", "obligations", "controlled_acceptance", "slices", "ready_slices"]);
  assert.equal(Object.hasOwn(selected.schema.properties, "requirements"), false);
});
