import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { registerKindRecordWriteTools } from "../../packages/wiki-mcp/src/lib/kind-record-write-tools.mjs";
import { errorContent, guardToolHandler, jsonContent } from "../../packages/wiki-mcp/src/lib/mcp-response.mjs";

const REQUESTED_REPO = "workspace-alias";
const CANONICAL_REPO = "agent-chassis";
const STALE_DIGEST = `sha256:${"0".repeat(64)}`;

async function withRegisteredServer(fn) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer({ name: "assignment-authority-test", version: "1.0.0" });
  const client = new Client(
    { name: "assignment-authority-client", version: "1.0.0" },
    { capabilities: {} }
  );
  const resolutionCalls = [];
  let assignmentAuthorityCalls = 0;
  const workspaceRepos = [{ repo: CANONICAL_REPO, dir: "/unused" }];

  registerKindRecordWriteTools({
    registerTool(name, config, handler) {
      server.registerTool(name, config, guardToolHandler(handler, { name }));
    },
    workspaceRepos,
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo(repos, repo) {
      resolutionCalls.push({ repos, repo });
      if (repo !== REQUESTED_REPO) {
        throw new Error(`Unknown workspace repo: ${repo}`);
      }
      return repos[0];
    },
    async assignWorkRecordToInitiative() {
      assignmentAuthorityCalls += 1;
      throw new Error("pre-core refusal must not reach assignment authority");
    }
  });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await fn({
      call: (arguments_) =>
        client.callTool({ name: "assign_work_record_to_initiative", arguments: arguments_ }),
      resolutionCalls,
      workspaceRepos,
      getAssignmentAuthorityCalls: () => assignmentAuthorityCalls
    });
  } finally {
    await client.close();
    await server.close();
  }
}

function assertMechanicalRefusal(result, code) {
  assert.equal(result.isError, true);
  assert.deepEqual(
    {
      workspaceRepo: result.structuredContent.workspaceRepo,
      operation: result.structuredContent.operation,
      ok: result.structuredContent.ok,
      valid: result.structuredContent.valid,
      written: result.structuredContent.written,
      no_op: result.structuredContent.no_op,
      mechanical_failure: result.structuredContent.mechanical_failure
    },
    {
      workspaceRepo: CANONICAL_REPO,
      operation: "assign_work_record_to_initiative",
      ok: false,
      valid: false,
      written: false,
      no_op: false,
      mechanical_failure: true
    }
  );
  assert.equal(Object.hasOwn(result.structuredContent, "policy_decision"), false);
  assert.deepEqual(
    result.structuredContent.diagnostics.map(({ code: diagnosticCode }) => diagnosticCode),
    [code]
  );
}

test("registered assignment refusals expose mechanical authority without reaching mutation", async () => {
  await withRegisteredServer(async ({
    call,
    resolutionCalls,
    workspaceRepos,
    getAssignmentAuthorityCalls
  }) => {
    const missing = await call({
      repo: REQUESTED_REPO,
      initiative: "IN-0014"
    });
    assertMechanicalRefusal(missing, "missing_semantic_identity");
    assert.deepEqual(missing.structuredContent.required_one_of, [
      ["unit", "work_record_id"],
      ["initiative", "initiative_id"]
    ]);
    assert.deepEqual(missing.structuredContent.missing_semantic_identities, [
      ["unit", "work_record_id"]
    ]);
    assert.deepEqual(resolutionCalls, [{ repos: workspaceRepos, repo: REQUESTED_REPO }]);
    assert.equal(getAssignmentAuthorityCalls(), 0);

    const conflicting = await call({
      repo: REQUESTED_REPO,
      unit: "WK-1570",
      work_record_id: "WK-1571",
      initiative: "IN-0011",
      initiative_id: "IN-0014",
      expected_source_digest: STALE_DIGEST
    });
    assertMechanicalRefusal(conflicting, "conflicting_identity_alias");
    assert.deepEqual(conflicting.structuredContent.conflicts, [
      {
        canonical_field: "unit",
        alias_field: "work_record_id",
        canonical_value: "WK-1570",
        alias_value: "WK-1571"
      },
      {
        canonical_field: "initiative",
        alias_field: "initiative_id",
        canonical_value: "IN-0011",
        alias_value: "IN-0014"
      }
    ]);
    assert.deepEqual(conflicting.structuredContent.retry_options, [
      { unit: "WK-1570", initiative: "IN-0011", repo: REQUESTED_REPO, expected_source_digest: STALE_DIGEST },
      { unit: "WK-1570", initiative: "IN-0014", repo: REQUESTED_REPO, expected_source_digest: STALE_DIGEST },
      { unit: "WK-1571", initiative: "IN-0011", repo: REQUESTED_REPO, expected_source_digest: STALE_DIGEST },
      { unit: "WK-1571", initiative: "IN-0014", repo: REQUESTED_REPO, expected_source_digest: STALE_DIGEST }
    ]);
    assert.deepEqual(resolutionCalls, [
      { repos: workspaceRepos, repo: REQUESTED_REPO },
      { repos: workspaceRepos, repo: REQUESTED_REPO }
    ]);
    assert.equal(getAssignmentAuthorityCalls(), 0);

    for (const arguments_ of [
      { repo: "unknown", initiative: "IN-0014" },
      {
        repo: "unknown",
        unit: "WK-1570",
        work_record_id: "WK-1571",
        initiative: "IN-0014"
      }
    ]) {
      const repositoryRefusal = await call(arguments_);
      assert.equal(repositoryRefusal.isError, true);
      assert.match(JSON.stringify(repositoryRefusal), /Unknown workspace repo: unknown/);
      assert.doesNotMatch(
        JSON.stringify(repositoryRefusal),
        /missing_semantic_identity|conflicting_identity_alias/
      );
      assert.equal(getAssignmentAuthorityCalls(), 0);
    }
  });
});
