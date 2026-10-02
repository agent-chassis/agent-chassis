

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { z } from "zod";

import {
  getResponseSpillConfig,
  jsonContent
} from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  createMcpContentReferenceReadInputSchema,
  MCP_CONTENT_REFERENCE_READ_TOOL,
  registerMcpContentReferenceTools
} from "../../packages/wiki-mcp/src/lib/mcp-content-reference-tools.mjs";
import {
  readSelectedResponseSource,
  retainSelectedResponseSource,
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

    assert.deepEqual(Object.keys(locator).sort(), ["ref_id", "sha256"]);
    assert.match(locator.ref_id, /^resp-/u);
    assert.match(locator.sha256, /^[0-9a-f]{64}$/u);

    const bytes = readFileSync(path.join(dir, `${locator.ref_id}.json`));
    const metadata = JSON.parse(
      readFileSync(path.join(dir, `${locator.ref_id}.json.meta.json`), "utf8"));
    assert.equal(metadata.byte_count, bytes.byteLength);
    assert.equal(locator.sha256, metadata.sha256);
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
        result: { type: "object", additionalProperties: false, required: ["ref_id", "sha256"],
          properties: { ref_id: { type: "string" }, sha256: { type: "string" } } } } };
    const carrier = { outcome: "failed", trace: "Error: token=kept\n    at selected.test.mjs:3:9" };
    const locator = retainSelectedResponseSource({ binding: { ...BINDING, route: "workspace_verify_proof" },
      carrier, ownerCall: (retained) => ({ tool: "workspace_verify_proof",
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
      tool: "workspace_verify_proof",
      args: { repo: "fixture-repo", subject: "WK-0001", result: { ref_id: locator.ref_id, sha256: locator.sha256 } }
    }]);
    assert.equal(JSON.stringify(refused).includes("selected.test.mjs"), false,
      "no retained byte crosses the refusal");

    const read = readSelectedResponseSource(locator, { env,
      expected: { route: "workspace_verify_proof", repository: BINDING.repository } });
    assert.deepEqual(read.carrier, carrier);

    const metadataPath = path.join(dir, `${locator.ref_id}.json.meta.json`);
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    assert.deepEqual(metadata.selected_access.owner_call.arguments.result,
      { ref_id: locator.ref_id, sha256: locator.sha256 });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(metadataPath, JSON.stringify({ ...metadata, selected_access: { operator_only: true } }));
    const unowned = await handlers.get(MCP_CONTENT_REFERENCE_READ_TOOL)({ ref_id: locator.ref_id });
    assert.equal(unowned.error.envelope.refusal.no_supported_route, true);
    assert.equal(Object.hasOwn(unowned.error.envelope.refusal, "next_calls"), false);

    const open = retainSelectedResponseSource({ binding: BINDING, carrier }, { env });
    const served = await handlers.get(MCP_CONTENT_REFERENCE_READ_TOOL)({ ref_id: open.ref_id });
    assert.equal(served.isError, undefined);
    assert.equal(served.structuredContent.sha256, open.sha256);
  } finally {
    await scope.dispose();
  }
});

test("a retained code answer refuses public bytes with its semantic detail call", async () => {
  const scope = createTestResourceScope();
  try {
    const { env } = await spillEnv(scope, "code-answer");
    const { createCodeIndexSelection, CODE_INDEX_IMPACT_ROUTE } = await import(
      "../../packages/wiki-mcp/src/lib/code-index-query-tools.mjs");
    const { createSelectedCodeIndexResponse } = await import(
      "../../packages/wiki-mcp/src/lib/code-index-query-response.mjs");
    const result = { query_kind: "impact", index_head: "e".repeat(40),
      input_diff_sources: [{ kind: "patch_text", text: `+${"é".repeat(9000)}` }],
      affected_files: [{ path: "src/ü.mjs", relationships: [{ basis: "graph", kind: "reverse_import",
        input_path: "src/core.mjs" }] }] };
    const session = createCodeIndexSelection({ route: CODE_INDEX_IMPACT_ROUTE,
      workspaceRepos: { currentAlias: "demo", repos: new Map([["demo", os.tmpdir()]]) }, env });
    const answer = createSelectedCodeIndexResponse({ workspaceRepo: "demo", result, session,
      queryIdentity: { paths: ["src/core.mjs"] }, collections: ["affected_files"],
      projectSummary: (value) => ({ query_kind: value.query_kind, index_head: value.index_head }) });

    const expectedCall = { repo: "demo", detail: { source: answer.selected_detail.source,
      collection: "affected_files", path: "src/ü.mjs" } };
    assert.deepEqual(answer.next_calls.map(({ tool, arguments: args }) => ({ tool, args })),
      [{ tool: CODE_INDEX_IMPACT_ROUTE, args: expectedCall }]);
    assert.deepEqual(Object.keys(answer.selected_detail).sort(), ["collections", "schema_version", "source"]);
    assert.deepEqual(answer.selected_detail.collections, { affected_files: 1 },
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
      [{ tool: CODE_INDEX_IMPACT_ROUTE, args: expectedCall }]);
    assert.equal(JSON.stringify(refused).includes("é".repeat(64)), false, "no retained byte crosses the refusal");

    const original = readSelectedResponseSource(answer.selected_detail.source,
      { env, expected: { route: CODE_INDEX_IMPACT_ROUTE, repository: "demo" } });
    assert.deepEqual(original.carrier, { workspaceRepo: "demo", ...result });
    assert.equal(original.binding.observation_identity, result.index_head);
  } finally {
    await scope.dispose();
  }
});
