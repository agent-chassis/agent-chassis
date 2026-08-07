import assert from "node:assert/strict";
import test from "node:test";

import { registerWorkRecordReadTools } from "../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";

class TestSchema {
  constructor(validate = () => null) {
    this.validate = validate;
  }

  optional() {
    return new TestSchema((value) => value === undefined ? null : this.validate(value));
  }

  refine() {
    return this;
  }

  strict() {
    return this;
  }

  passthrough() {
    return this;
  }

  superRefine() {
    return this;
  }

  safeParse(value) {
    const issue = this.validate(value);
    return issue === null
      ? { success: true, data: value }
      : { success: false, error: { issues: [issue] } };
  }
}

function makeTestZ() {
  const schema = (validate) => new TestSchema(validate);
  return {
    ZodIssueCode: { custom: "custom" },
    string: () => schema((value) => typeof value === "string" ? null : { code: "invalid_type" }),
    boolean: () => schema((value) => typeof value === "boolean" ? null : { code: "invalid_type" }),
    literal: (expected) => schema((value) => value === expected ? null : { code: "invalid_literal" }),
    enum: (values) => schema((value) => values.includes(value) ? null : { code: "invalid_enum_value" }),
    array: () => schema((value) => Array.isArray(value) ? null : { code: "invalid_type" }),
    object: (shape) => schema((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return { code: "invalid_type" };
      }
      for (const [key, field] of Object.entries(shape)) {
        const issue = field.validate(value[key]);
        if (issue !== null && value[key] !== undefined) return { ...issue, path: [key] };
        if (issue !== null && !field.optionalField) return { ...issue, path: [key] };
      }
      return null;
    })
  };
}

function registerPreflightTool({ preflightDispatch = async () => ({}) } = {}) {
  const tools = new Map();
  registerWorkRecordReadTools({
    registerTool: (name, descriptor, handler) => tools.set(name, { descriptor, handler }),
    workspaceRepos: {},
    z: makeTestZ(),
    jsonContent: (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }], value }),
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

  const inputSchema = makeTestZ().object(tool.descriptor.inputSchema);

  assert.equal(inputSchema.safeParse({}).success, false);
  assert.equal(inputSchema.safeParse({ proposed_record: { id: "WK-1729" } }).success, true);
});
