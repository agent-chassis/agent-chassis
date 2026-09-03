import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import {
  COMMON_PROOF_CAPTURE_MCP_FAMILY_IDS,
  COMMON_PROOF_CAPTURE_TOOL_NAME,
  registerCommonProofCaptureTools
} from "../../packages/wiki-mcp/src/lib/common-proof-capture-tools.mjs";
import { jsonContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

function harness(operation = async (request) => ({
  schema_version: "wiki-core-common-proof-capture.v1",
  ...request,
  canonical_store_root: "/private/root"
}), jsonContentImpl = (value) => ({ structuredContent: value })) {
  const calls = { operation: [], workspace: [], jsonOptions: [] };
  let tool;
  registerCommonProofCaptureTools({
    registerTool: (name, config, handler) => { tool = { name, config, handler }; },
    workspaceRepos: [{ repo: "demo", dir: "/private/root" }],
    z,
    jsonContent: (value, options) => {
      calls.jsonOptions.push(options ?? {});
      return jsonContentImpl(value, options);
    },
    errorContent: (error) => ({ error }),
    resolveWorkspaceRepo: (repos, alias) => {
      calls.workspace.push([repos, alias]);
      return { repo: alias ?? "demo", dir: "/private/root" };
    },
    operation: async (request) => {
      calls.operation.push(request);
      return operation(request);
    },
    focusSchema: z.string().regex(/^controlled-contract(?:\.[a-z0-9-]+)*$/u).optional()
  });
  return { calls, tool, invoke: (input) => tool.handler(tool.config.inputSchema.parse(input)) };
}

const BASE = {
  repo: "demo",
  wk_id: "WK-2108",
  unit: "WK-2108#SLICE-001",
  focus: "controlled-contract.example",
  family: "test_verification_validity",
  profile_id: "proof.verification.test-validity",
  profile_version: "1.0.0",
  verification_id: "verification-1"
};

test("common proof capture MCP adapter registers one closed four-family route", async (t) => {
  assert.deepEqual(COMMON_PROOF_CAPTURE_MCP_FAMILY_IDS, [
    "behavioral_preservation",
    "declared_boundary_consistency",
    "test_verification_validity",
    "write_confinement"
  ]);

  await t.test("forwards only canonical selectors and strips private root", async () => {
    const h = harness();
    const result = await h.invoke(BASE);
    assert.equal(h.tool.name, COMMON_PROOF_CAPTURE_TOOL_NAME);
    assert.deepEqual(h.calls.operation, [{
      repository: "demo", wkId: "WK-2108", unit: "WK-2108#SLICE-001",
      focus: "controlled-contract.example", family: "test_verification_validity",
      profileId: "proof.verification.test-validity", profileVersion: "1.0.0",
      verificationId: "verification-1"
    }]);
    assert.equal(result.structuredContent.canonical_store_root, undefined);
    assert.equal(result.structuredContent.workspaceRepo, "demo");
  });

  await t.test("rejects unknown and authority-shaped fields before operation", async () => {
    const h = harness();
    assert.throws(() => h.tool.config.inputSchema.parse({ ...BASE, root: "/tmp" }));
    assert.throws(() => h.tool.config.inputSchema.parse({ ...BASE, receipt: {} }));
    assert.deepEqual(h.calls.operation, []);
  });

  await t.test("rejects malformed WK and unit identities before operation", async () => {
    const h = harness();
    for (const malformed of [
      { ...BASE, wk_id: "wk-2108" },
      { ...BASE, wk_id: "WK-208" },
      { ...BASE, unit: "WK-2108#slice-001" },
      { ...BASE, unit: "WK-2108#SLICE-01" }
    ]) assert.throws(() => h.tool.config.inputSchema.parse(malformed));
    assert.deepEqual(h.calls.operation, []);
  });

  await t.test("forwards omitted focus and verification identity as null", async () => {
    const h = harness();
    const { focus: _focus, verification_id: _verificationId, ...withoutOptionals } = BASE;
    await h.invoke(withoutOptionals);
    assert.equal(h.calls.operation[0].focus, null);
    assert.equal(h.calls.operation[0].verificationId, null);
  });

  await t.test("rejects integration-prefix family at the schema boundary", async () => {
    const h = harness();
    assert.throws(() => h.tool.config.inputSchema.parse({
      ...BASE, family: "integration_prefix_safety"
    }));
    assert.deepEqual(h.calls.operation, []);
  });

  await t.test("preserves typed operation refusals through errorContent", async () => {
    const refusal = new Error("typed refusal");
    const h = harness(async () => { throw refusal; });
    const result = await h.invoke(BASE);
    assert.equal(result.error, refusal);
  });
});

test("common proof capture MCP adapter requires its operation and focus schema", () => {
  const base = {
    registerTool: () => {}, workspaceRepos: [], z,
    jsonContent: (value) => ({ structuredContent: value }),
    errorContent: (error) => ({ error }), resolveWorkspaceRepo: () => ({ repo: "demo" }),
    operation: async () => ({}), focusSchema: z.string().optional()
  };
  assert.throws(() => registerCommonProofCaptureTools({ ...base, operation: undefined }),
    /requires one preconstructed operation/u);
  assert.throws(() => registerCommonProofCaptureTools({ ...base, focusSchema: undefined }),
    /requires the controlled-contract focus schema/u);
});

test("common proof capture MCP adapter uses one shared spill owner for oversized results",
  async (t) => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "common-proof-capture-mcp-"));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
  const payload = { payload: "x".repeat(20_000) };
  const h = harness(() => payload,
    (value, options) => jsonContent(value, { env, ...options }));
  const result = await h.invoke(BASE);
  assert.deepEqual(h.calls.jsonOptions, [{ forceSpill: true }]);
  const reference = result.structuredContent.content_reference;
  assert.ok(reference);
  assert.equal(reference.kind, "wiki_mcp_response_content_reference");
  assert.equal(reference.media_type, "application/json");
  const bytes = Buffer.from(JSON.stringify({ workspaceRepo: "demo", ...payload }, null, 2));
  assert.equal(reference.byte_count, bytes.byteLength);
  assert.equal(reference.sha256, createHash("sha256").update(bytes).digest("hex"));
});
