

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
