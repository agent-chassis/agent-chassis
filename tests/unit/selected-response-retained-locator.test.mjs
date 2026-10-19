

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { z } from "zod";

import {
  allocateRetainedArtifact,
  getResponseSpillConfig,
  jsonContent,
  RETAINED_ALLOCATION_EXHAUSTED_CODE
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  createMcpContentReferenceReadInputSchema,
  MCP_CONTENT_REFERENCE_READ_TOOL,
  registerMcpContentReferenceTools
} from "../../packages/wiki-mcp/src/lib/mcp-content-reference-tools.mjs";
import {
  findSelectedResponseSources,
  readSelectedResponseEvidence,
  readSelectedResponseSource,
  retainSelectedResponseEvidence,
  retainSelectedResponseSource,
  selectedResponseDetailSchema,
  SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION
} from "../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs";
import { createTestResourceScope } from "../helpers/test-resource-scope.mjs";

async function spillEnv(scope, label) {
  const dir = await scope.acquire(label,
    () => mkdtempSync(path.join(os.tmpdir(), "wk2691-locator-")),
    (created) => rmSync(created, { recursive: true, force: true }));
  return { dir, env: { ...process.env, WIKI_MCP_RESPONSE_STATE_DIR: dir } };
}

const BINDING = Object.freeze({
  route: "workspace_agent_run_status",
  repository: "fixture-repo",
  unit: "WK-0001#SLICE-001"
});

test("WK-2691: a retained locator published without a session keeps its exact key set and binding", async () => {
  const scope = createTestResourceScope();
  try {
    const { dir, env } = await spillEnv(scope, "locator");
    const carrier = { document: "ünïcode ✓ ".repeat(4096) };
    const locator = retainSelectedResponseSource({ binding: BINDING, carrier }, { env });

    assert.deepEqual(Object.keys(locator), ["ref_id"]);
    assert.match(locator.ref_id, /^[A-Za-z0-9_-]{8}$/u);
    assert.equal(selectedResponseDetailSchema(z).shape.source.safeParse(locator).success, true);

    const bytes = readFileSync(path.join(dir, `${locator.ref_id}.json`));
    const metadata = JSON.parse(
      readFileSync(path.join(dir, `${locator.ref_id}.json.meta.json`), "utf8"));
    assert.equal(metadata.byte_count, bytes.byteLength);
    assert.equal(metadata.ref_id, locator.ref_id);
    assert.equal(readSelectedResponseEvidence(locator,
      { env, expected: { route: BINDING.route, repository: BINDING.repository } }).evidence.sha256, metadata.sha256);
    assert.ok(getResponseSpillConfig(env).maxReferenceReadBytes > 0);

    const envelope = readSelectedResponseSource(locator,
      { env, expected: { route: BINDING.route, repository: BINDING.repository } });
    assert.equal(envelope.schema_version, SELECTED_RESPONSE_SOURCE_SCHEMA_VERSION);
    assert.deepEqual(envelope.carrier, carrier);
    assert.throws(() => readSelectedResponseSource(locator,
      { env, expected: { route: BINDING.route, repository: "other-repo" } }),
    (error) => error?.envelope?.code === "selected_response_query_invalid");
  } finally {
    await scope.dispose();
  }
});

test("WK-2691: the content-reference reader registers the one declared request shape", async () => {
  const scope = createTestResourceScope();
  try {
    const { env } = await spillEnv(scope, "schema");
    const registrations = new Map();
    registerMcpContentReferenceTools({
      registerTool: (name, config, handler) => registrations.set(name, { config, handler }),
      z,
      jsonContent,
      errorContent: () => { throw new Error("unexpected error content"); },
      env
    });
    const registered = registrations.get(MCP_CONTENT_REFERENCE_READ_TOOL);
    assert.ok(registered, "the reader registers under its exported name");

    const declared = createMcpContentReferenceReadInputSchema(z);
    assert.deepEqual(Object.keys(registered.config.inputSchema).sort(), Object.keys(declared).sort());
    assert.deepEqual(z.object(registered.config.inputSchema).strict()
      .safeParse({ ref_id: "resp-1", offset: 0, length: 16 }).success, true);
    assert.deepEqual(z.object(registered.config.inputSchema).strict()
      .safeParse({ offset: 0 }).success, false);
  } finally {
    await scope.dispose();
  }
});

test("a protected selected source refuses public bytes with its exact owner call", async () => {
  const scope = createTestResourceScope();
  try {
    const { dir, env } = await spillEnv(scope, "protected");
    const ownerSchema = { type: "object", additionalProperties: false, required: ["subject", "result"],
      properties: { subject: { type: "string" }, repo: { type: "string" },
        result: { type: "object", additionalProperties: false, required: ["ref_id"],
          properties: { ref_id: { type: "string" } } } } };
    const carrier = { outcome: "failed", trace: "Error: token=kept\n    at selected.test.mjs:3:9" };
    const locator = retainSelectedResponseSource({ binding: { ...BINDING, route: "workspace_verify_proof" },

      carrier, ownerCall: (retained) => ({ tool: "get_run_result",
        arguments: { repo: "fixture-repo", subject: "WK-0001", result: retained } }),
      ownerRequestSchema: ownerSchema }, { env });

    const handlers = new Map();
    registerMcpContentReferenceTools({
      registerTool: (name, _config, handler) => handlers.set(name, handler),
      z, jsonContent: (value) => jsonContent(value, { env }),
      errorContent: (error) => ({ isError: true, error }), env
    });
    const refused = await handlers.get(MCP_CONTENT_REFERENCE_READ_TOOL)({ ref_id: locator.ref_id });
    assert.equal(refused.isError, true);
    const envelope = refused.error.envelope;
    assert.equal(envelope.code, "mcp_response.content_reference_ranged_read_unavailable.v1");
    assert.equal(envelope.limb, "selected_access");
    assert.equal(envelope.recoverable, true);
    assert.equal(envelope.refusal.recovery.state, "callable");
    assert.deepEqual(envelope.refusal.next_calls.map(({ tool, arguments: args }) => ({ tool, args })), [{
      tool: "get_run_result",
      args: { repo: "fixture-repo", subject: "WK-0001", result: { ref_id: locator.ref_id } }
    }]);
    assert.equal(JSON.stringify(refused).includes("selected.test.mjs"), false,
      "no retained byte crosses the refusal");

    const read = readSelectedResponseSource(locator, { env,
      expected: { route: "workspace_verify_proof", repository: BINDING.repository } });
    assert.deepEqual(read.carrier, carrier);

    const metadataPath = path.join(dir, `${locator.ref_id}.json.meta.json`);
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    assert.deepEqual(metadata.selected_access.owner_call.arguments.result, { ref_id: locator.ref_id });
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, selected_access: { operator_only: true } }));
    const unowned = await handlers.get(MCP_CONTENT_REFERENCE_READ_TOOL)({ ref_id: locator.ref_id });
    assert.equal(unowned.error.envelope.refusal.no_supported_route, true);
    assert.equal(Object.hasOwn(unowned.error.envelope.refusal, "next_calls"), false);

    const open = retainSelectedResponseSource({ binding: BINDING, carrier }, { env });
    const served = await handlers.get(MCP_CONTENT_REFERENCE_READ_TOOL)({ ref_id: open.ref_id });
    assert.equal(served.isError, undefined);
    assert.equal(served.structuredContent.sha256,
      JSON.parse(readFileSync(path.join(dir, `${open.ref_id}.json.meta.json`), "utf8")).sha256);
  } finally {
    await scope.dispose();
  }
});

test("a session retention with an owner call refuses public bytes and keeps the owner read", async () => {
  const scope = createTestResourceScope();
  try {
    const { env } = await spillEnv(scope, "session-protected");
    const { createSelectedResponseSession, selectedResponseDetailSchema, selectedResponseRequestSchema } =
      await import("../../packages/wiki-mcp/src/lib/selected-response-snapshot.mjs");
    const route = "workspace_run_test";
    const requestSchema = selectedResponseRequestSchema(z.object({ detail: selectedResponseDetailSchema(z) })
      .strict());
    const session = createSelectedResponseSession({ route, requestSchema,
      buildDetailArguments: (_binding, selection) => ({ detail: selection }), requireAuthorityIdentity: true, env });
    const authority = { role: "worker", run: "r1" };
    const carrier = { stdout: "native output token=kept at native.test.mjs:9:3", status: "failed" };
    const { source } = session.retain({ binding: { route, repository: "fixture-repo", unit: null,
      authority_identity: authority }, carrier,
    ownerCall: (retained) => ({ tool: route, arguments: { detail: { source: retained, collection: "members" } } }),
    ownerRequestSchema: requestSchema });
    const handlers = new Map();
    registerMcpContentReferenceTools({
      registerTool: (name, _config, handler) => handlers.set(name, handler),
      z, jsonContent: (value) => jsonContent(value, { env }),
      errorContent: (error) => ({ isError: true, error }), env
    });
    const refused = await handlers.get(MCP_CONTENT_REFERENCE_READ_TOOL)({ ref_id: source.ref_id });
    assert.equal(refused.isError, true);
    assert.equal(refused.error.envelope.limb, "selected_access");
    assert.deepEqual(refused.error.envelope.refusal.next_calls.map(({ tool, arguments: args }) => ({ tool, args })),
      [{ tool: route, args: { detail: { source: { ref_id: source.ref_id }, collection: "members" } } }]);
    assert.deepEqual(Object.keys(source), ["ref_id"]);
    assert.equal(JSON.stringify(refused).includes("native.test.mjs"), false, "no retained byte crosses");
    const owned = await session.detail({ expected: { route, repository: "fixture-repo", unit: null,
      authority_identity: authority }, detail: { source, collection: "members" } });
    assert.equal(owned.page.items.length > 0, true);

    const open = session.retain({ binding: { route, repository: "fixture-repo", unit: null,
      authority_identity: authority }, carrier });
    const served = await handlers.get(MCP_CONTENT_REFERENCE_READ_TOOL)({ ref_id: open.source.ref_id });
    assert.equal(served.isError, undefined);
  } finally {
    await scope.dispose();
  }
});

test("a retained code answer refuses public bytes with its semantic detail call", async () => {
  const scope = createTestResourceScope();
  try {
    const { env } = await spillEnv(scope, "code-answer");
    const { createCodeIndexSelection, CODE_INDEX_QUERY_ROUTE } = await import(
      "../../packages/wiki-mcp/src/lib/code-index-query-tools.mjs");
    const { createSelectedCodeIndexResponse } = await import(
      "../../packages/wiki-mcp/src/lib/code-index-query-response.mjs");
    const checkoutIdentity = "a".repeat(64);
    const storeIncarnation = "4bc53193-333b-4f4c-a462-fbe45503e182";
    const graphSnapshot = { schema_version: "graph-snapshot.v1",
      store_incarnation: storeIncarnation, publication_sequence: 7,
      repository_commit: "e".repeat(40), repository_tree: "f".repeat(40),
      base_coverage: { checkout_identity: checkoutIdentity } };
    const result = { query_kind: "impact", index_head: "e".repeat(40), graph_snapshot: graphSnapshot,
      input_diff_sources: [{ kind: "patch_text", text: `+${"é".repeat(9000)}` }],
      affected_files: [{ path: "src/ü.mjs", relationships: [{ basis: "graph", kind: "reverse_import",
        input_path: "src/core.mjs" }] }] };
    const session = createCodeIndexSelection({
      workspaceRepos: { currentAlias: "demo", repos: new Map([["demo", os.tmpdir()]]) }, env });
    const answer = createSelectedCodeIndexResponse({ workspaceRepo: "demo", result, session,
      queryIdentity: { paths: ["src/core.mjs"] }, collections: ["affected_files"],
      projectSummary: (value) => ({ query_kind: value.query_kind, index_head: value.index_head }) });

    const expectedCall = { detail: { source: answer.selected_detail.source,
      collection: "affected_files" } };
    assert.equal(CODE_INDEX_QUERY_ROUTE, "query_code_index");
    assert.deepEqual(answer.next_calls.map(({ tool, arguments: args }) => ({ tool, args })),
      [{ tool: CODE_INDEX_QUERY_ROUTE, args: expectedCall }]);
    assert.equal(answer.read_mode, undefined);
    assert.deepEqual(Object.keys(answer.selected_detail).sort(), ["source", "totals"]);
    assert.deepEqual(answer.selected_detail.totals, { affected_files: 1 },
      "the caller's retained patch is not a selectable collection");

    const handlers = new Map();
    registerMcpContentReferenceTools({
      registerTool: (name, _config, handler) => handlers.set(name, handler),
      z, jsonContent: (value) => jsonContent(value, { env }),
      errorContent: (error) => ({ isError: true, error }), env
    });
    const refused = await handlers.get(MCP_CONTENT_REFERENCE_READ_TOOL)({ ref_id: answer.selected_detail.source.ref_id });
    assert.equal(refused.error.envelope.limb, "selected_access");
    assert.deepEqual(refused.error.envelope.refusal.next_calls.map(({ tool, arguments: args }) => ({ tool, args })),
      [{ tool: CODE_INDEX_QUERY_ROUTE,
        args: { detail: { source: answer.selected_detail.source, collection: "affected_files" } } }]);
    assert.equal(JSON.stringify(refused).includes("é".repeat(64)), false, "no retained byte crosses the refusal");

    const original = readSelectedResponseSource(answer.selected_detail.source,
      { env, expected: { route: CODE_INDEX_QUERY_ROUTE, repository: "demo" } });
    assert.deepEqual(original.carrier, { workspaceRepo: "demo", ...result });
    assert.deepEqual(JSON.parse(original.binding.observation_identity),
      [checkoutIdentity, storeIncarnation, 7, false]);

    const retainedIdentity = (value) => {
      const retained = createSelectedCodeIndexResponse({ workspaceRepo: "demo", result: value, session,
        queryIdentity: { paths: ["src/core.mjs"] }, collections: ["affected_files"],
        projectSummary: (row) => ({ query_kind: row.query_kind, index_head: row.index_head }) });
      return readSelectedResponseSource(retained.selected_detail.source,
        { env, expected: { route: CODE_INDEX_QUERY_ROUTE, repository: "demo" } }).binding.observation_identity;
    };

    for (const [snapshot, expected] of [
      [{ ...graphSnapshot, base_coverage: { checkout_identity: "b".repeat(64) } },
        ["b".repeat(64), storeIncarnation, 7, false]],
      [{ ...graphSnapshot, store_incarnation: "f2fdebac-c90e-4b0c-aeec-f6568d9db809" },
        [checkoutIdentity, "f2fdebac-c90e-4b0c-aeec-f6568d9db809", 7, false]],
      [{ ...graphSnapshot, publication_sequence: 8 }, [checkoutIdentity, storeIncarnation, 8, false]]
    ]) {
      const identity = retainedIdentity({ ...result, graph_snapshot: snapshot });
      assert.notEqual(identity, original.binding.observation_identity);
      assert.deepEqual(JSON.parse(identity), expected);
    }
    const { graph_snapshot: _snapshot, ...withoutSnapshot } = result;
    assert.equal(retainedIdentity(withoutSnapshot), null,
      "an index_head without a graph snapshot grants no observation identity");
  } finally {
    await scope.dispose();
  }
});

const invalidReason = (error) => error?.envelope?.deciding_facts
  ?.find(({ field }) => field === "selected_response.invalid_reason")?.value;
const failedStep = (error) => error?.envelope?.deciding_facts
  ?.find(({ field }) => field === "content_reference.failed_step")?.value ??
  error?.envelope?.refusal?.deciding_facts?.find(({ field }) => field === "content_reference.failed_step")?.value;
const storeSnapshot = (dir) => Object.fromEntries(readdirSync(dir).sort()
  .map((file) => [file, readFileSync(path.join(dir, file), "base64")]));

test("WK-2665: an occupied handle is never overwritten or reassigned", async () => {
  const scope = createTestResourceScope();
  try {
    const { dir } = await spillEnv(scope, "collision");
    const metadataFor = (refId) => ({ ref_id: refId });
    const minted = (...ids) => { const queue = [...ids]; return () => queue.shift(); };
    const first = allocateRetainedArtifact({ stateDir: dir, bytes: Buffer.from("first"), metadataFor,
      mintRefId: minted("aaaaaaaa") });
    assert.equal(first, "aaaaaaaa");
    const before = storeSnapshot(dir);

    writeFileSync(path.join(dir, "bbbbbbbb.json"), "partial");
    const second = allocateRetainedArtifact({ stateDir: dir, bytes: Buffer.from("second"), metadataFor,
      mintRefId: minted("aaaaaaaa", "bbbbbbbb", "cccccccc") });
    assert.equal(second, "cccccccc", "the collided and the unfinished handle are both passed over");
    const after = storeSnapshot(dir);
    for (const [file, bytes] of Object.entries(before)) assert.equal(after[file], bytes, `${file} is unchanged`);
    assert.equal(readFileSync(path.join(dir, "bbbbbbbb.json"), "utf8"), "partial");
    assert.equal(readFileSync(path.join(dir, "cccccccc.json"), "utf8"), "second");
    assert.deepEqual(readdirSync(dir).filter((file) => file.endsWith(".pending")), []);

    assert.throws(() => allocateRetainedArtifact({ stateDir: dir, bytes: Buffer.from("third"), metadataFor,
      mintRefId: () => "aaaaaaaa" }), (error) => error.code === RETAINED_ALLOCATION_EXHAUSTED_CODE);
    assert.deepEqual(storeSnapshot(dir), after, "an exhausted allocation writes nothing");
    assert.throws(() => allocateRetainedArtifact({ stateDir: dir, bytes: Buffer.from("x"), metadataFor,
      mintRefId: () => "resp-not-a-handle" }), TypeError);
  } finally {
    await scope.dispose();
  }
});

test("WK-2665: each retained-read fault keeps its own cause and changes nothing", async () => {
  const scope = createTestResourceScope();
  try {
    const { dir, env } = await spillEnv(scope, "faults");
    const expected = { route: BINDING.route, repository: BINDING.repository };
    const carrier = { marker: "retained-marker-λ" };
    const retainOne = () => retainSelectedResponseEvidence({ binding: BINDING, carrier }, { env });
    const refusalOf = (source, mutate) => {
      mutate?.();
      const before = storeSnapshot(dir);
      let refusal;
      assert.throws(() => readSelectedResponseSource(source, { env, expected }), (error) => {
        refusal = error;
        return error?.envelope !== undefined;
      });
      assert.equal(JSON.stringify(refusal.envelope).includes(carrier.marker), false, "no carrier content crosses");
      assert.equal(Object.hasOwn(refusal.envelope, "next_calls") ||
        Object.hasOwn(refusal.envelope.refusal ?? {}, "next_calls"), false, "no continuation is emitted");
      assert.deepEqual(storeSnapshot(dir), before, "the refused read repairs and rewrites nothing");
      return refusal;
    };
    const file = (pair, suffix = "") => path.join(dir, `${pair.ref_id}.json${suffix}`);

    const unknown = refusalOf({ ref_id: "zzzzzzzz" });
    assert.equal(failedStep(unknown), "content_reference_not_found");
    assert.equal(invalidReason(refusalOf({ ref_id: "../etc/x" })), "source_locator_invalid");

    const noMetadata = retainOne();
    assert.equal(failedStep(refusalOf(noMetadata, () => unlinkSync(file(noMetadata, ".meta.json")))),
      "content_reference_metadata_not_found");

    const badMetadata = retainOne();
    assert.equal(failedStep(refusalOf(badMetadata, () => writeFileSync(file(badMetadata, ".meta.json"), "{"))),
      "content_reference_metadata_invalid");
    const foreignMetadata = retainOne();
    const other = retainOne();
    assert.equal(failedStep(refusalOf(foreignMetadata, () => writeFileSync(file(foreignMetadata, ".meta.json"),
      readFileSync(file(other, ".meta.json"))))), "content_reference_metadata_invalid",
    "metadata that names another handle is not this handle's metadata");

    const noPayload = retainOne();
    assert.equal(failedStep(refusalOf(noPayload, () => unlinkSync(file(noPayload)))), "content_reference_not_found");

    const changed = retainOne();
    assert.equal(failedStep(refusalOf(changed, () => writeFileSync(file(changed),
      readFileSync(file(changed), "utf8").replace("retained-marker", "replaced-marker")))),
    "content_reference_digest_mismatch");
    carrier.marker = "replaced-marker-λ";

    const recorded = retainOne();
    assert.deepEqual(readSelectedResponseSource(recorded, { env, expected }).carrier, carrier);
    assert.equal(failedStep(refusalOf({ ref_id: recorded.ref_id, sha256: "0".repeat(64) })),
      "content_reference_recorded_digest_mismatch");

    const bound = refusalOf(recorded, () => { expected.repository = "other-repo"; });
    assert.equal(invalidReason(bound), "source_binding_mismatch");
  } finally {
    await scope.dispose();
  }
});

test("WK-2665: a pre-handle original refuses specifically and discovery still finds complete originals", async () => {
  const scope = createTestResourceScope();
  try {
    const { dir, env } = await spillEnv(scope, "cutover");
    const expected = { route: BINDING.route, repository: BINDING.repository, unit: BINDING.unit,
      query_identity: null, authority_identity: { role: "worker" } };
    const binding = { ...BINDING, authority_identity: expected.authority_identity };
    const current = retainSelectedResponseEvidence({ binding, carrier: { generation: "current" } }, { env });
    const template = retainSelectedResponseEvidence({ binding, carrier: { generation: "old" } }, { env });

    const oldId = "resp-1700000000000-4242-0f8fad5b-d9cb-469f-a165-70867728950e";
    const oldMetadata = { ...JSON.parse(readFileSync(path.join(dir, `${template.ref_id}.json.meta.json`), "utf8")),
      ref_id: oldId };
    writeFileSync(path.join(dir, `${oldId}.json`), readFileSync(path.join(dir, `${template.ref_id}.json`)));
    writeFileSync(path.join(dir, `${oldId}.json.meta.json`), JSON.stringify(oldMetadata));
    unlinkSync(path.join(dir, `${template.ref_id}.json`));
    unlinkSync(path.join(dir, `${template.ref_id}.json.meta.json`));

    writeFileSync(path.join(dir, "unfinish.json"), "{\"schema_version\":");
    const before = storeSnapshot(dir);

    const oldPair = { ref_id: oldId, sha256: oldMetadata.sha256 };
    const publicSource = selectedResponseDetailSchema(z).shape.source;
    assert.equal(publicSource.safeParse(oldPair).success, false, "the old pair is not a request");
    assert.equal(publicSource.safeParse({ ref_id: oldId }).success, false);
    assert.equal(publicSource.safeParse({ ...current }).success, false, "no caller digest is accepted");
    assert.equal(publicSource.safeParse({ ref_id: current.ref_id }).success, true);

    let refusal;
    assert.throws(() => readSelectedResponseSource(oldPair, { env, expected }),
      (error) => { refusal = error; return invalidReason(error) === "source_locator_not_current"; });
    assert.equal(refusal.envelope.recovery.state, "no_supported_route");
    assert.equal(Object.hasOwn(refusal.envelope, "next_calls"), false);

    const found = findSelectedResponseSources({ env, expected });
    assert.deepEqual(found.map(({ result, current: isCurrent, carrier }) => ({ result, isCurrent, carrier }))
      .sort((left, right) => left.carrier.generation.localeCompare(right.carrier.generation)), [
      { result: { ref_id: current.ref_id }, isCurrent: true, carrier: { generation: "current" } },
      { result: { ref_id: oldId }, isCurrent: false, carrier: { generation: "old" } }
    ]);
    assert.deepEqual(readSelectedResponseSource(found.find(({ current: isCurrent }) => isCurrent).result,
      { env, expected }).carrier, { generation: "current" });
    assert.equal(failedStep((() => { try { readSelectedResponseSource({ ref_id: "unfinish" }, { env, expected }); }
      catch (error) { return error; } })()), "content_reference_metadata_not_found");
    assert.deepEqual(storeSnapshot(dir), before, "old bytes, the unfinished allocation and metadata are all kept");

    writeFileSync(path.join(dir, `${current.ref_id}.json`), "{");
    assert.throws(() => findSelectedResponseSources({ env, expected }), SyntaxError);
  } finally {
    await scope.dispose();
  }
});
