import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { registerWorkRecordReadTools } from "../../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";

function registerPreflightTool({ preflightDispatch = async () => ({}) } = {}) {
  const tools = new Map();
  registerWorkRecordReadTools({
    registerTool: (name, descriptor, handler) => tools.set(name, { descriptor, handler }),
    workspaceRepos: {},
    z,
    jsonContent: (value) => ({ content: [], structuredContent: value, value }),
    errorContent: (error) => ({ isError: true, error }),
    resolveWorkspaceRepo: () => ({ repo: "workspace-repo", dir: "/workspace/project" }),
    createCompactValidateDispatchResponse: (value) => value,
    preflightDispatch
  });
  return tools.get("workspace_preflight_dispatch");
}

test("registers workspace_preflight_dispatch under the exact route name", () => {
  assert.ok(registerPreflightTool());
});

test("forwards proposed_record and resolved workspace dir and returns the result under workspaceRepo", async () => {
  const proposedRecord = { id: "WK-1729", title: "prospective" };
  const operationResult = { decision_code: "dispatchable", preflight: { body_unpersisted: true } };
  let received;
  const tool = registerPreflightTool({
    preflightDispatch: async (args) => {
      received = args;
      return operationResult;
    }
  });

  const result = await tool.handler({ proposed_record: proposedRecord });

  assert.deepEqual(received, {
    dir: "/workspace/project",
    proposed_record: proposedRecord,
    unit_address: undefined,
    dispatch_role: undefined,
    node_engine_admissibility: undefined
  });
  assert.deepEqual(result.value, { workspaceRepo: "workspace-repo", ...operationResult });
});

test("routes a thrown operation error through errorContent", async () => {
  const operationError = new Error("preflight failed");
  const tool = registerPreflightTool({
    preflightDispatch: async () => { throw operationError; }
  });

  const result = await tool.handler({ proposed_record: { id: "WK-1729" } });

  assert.equal(result.isError, true);
  assert.equal(result.error, operationError);
});

test("input schema rejects a call with no proposed_record", () => {
  const tool = registerPreflightTool();

  const inputSchema = z.object(tool.descriptor.inputSchema);

  assert.equal(inputSchema.safeParse({}).success, false);
  assert.equal(inputSchema.safeParse({ proposed_record: { id: "WK-1729" } }).success, true);
});
