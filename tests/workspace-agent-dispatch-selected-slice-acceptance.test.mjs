

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { registerDispatchTools } from "../packages/wiki-mcp/src/lib/dispatch-tools.mjs";
import { jsonContent, errorContent } from "../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { AGENT_DISPATCH_TOOL_NAME } from "../packages/wiki-mcp/src/lib/dispatch-tool-constants.mjs";

const REGISTERED_TOOL_NAMES = Object.freeze([
  "workspace_agent_dispatch",
  "workspace_record_graph_impact_evidence",
  "workspace_validate_dispatch"
]);

const RECORD_ID = "WK-9716";
const SLICE_ID = "SLICE-001";
const SUBJECT = `${RECORD_ID}#${SLICE_ID}`;

function implementationSlice(acceptance) {
  return {
    id: SLICE_ID,
    title: "Implementation",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "codex",
    depends_on: [],
    read_scope: ["AGENTS.md"],
    repo_paths: ["docs/mcp-dispatch-runtime-contract.md"],
    write_scope: ["docs/mcp-dispatch-runtime-contract.md"],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance,
    sections: { agent_notes: "" }
  };
}

function recordWithSliceAcceptance(sliceAcceptance) {
  return {
    schema_version: "work-record.v1",
    id: RECORD_ID,
    repo: "agent-chassis/agent-chassis",
    title: "Selected-slice acceptance fixture",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "codex",
    created: "2026-07-23",
    updated: "2026-07-23",
    initiative: "IN-0030",
    read_scope: ["AGENTS.md"],
    repo_paths: ["docs/mcp-dispatch-runtime-contract.md"],
    write_scope: ["docs/mcp-dispatch-runtime-contract.md"],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["The parent contract is complete before slice dispatch."],
      validation: ["node --test tests/workspace-agent-dispatch-selected-slice-acceptance.test.mjs"]
    },
    sections: {
      summary: "Selected-slice acceptance fixture.",
      why_it_matters: "Pins the registered selected-slice acceptance refusal.",
      scope: { items: ["dispatch"], out_of_scope: ["organization policy"] },
      tasks: [],
      references: ["AGENTS.md"],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [implementationSlice(sliceAcceptance)],
    escalations: [],
    projections: [],
    migration: null,
    derived_evidence: []
  };
}

async function writeRecordFixture(t, record) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wk1716-slice3-acceptance-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "wiki", "work-records"), { recursive: true });
  await writeFile(
    path.join(dir, "wiki", "work-records", `${record.id}.json`),
    JSON.stringify(record),
    "utf8"
  );
  return dir;
}

function registerFixtureDispatchTools(dir) {
  const tools = new Map();
  const registerTool = (name, config, handler) => {
    tools.set(name, { config, handler });
  };
  const backendCalls = [];
  const dispatchBackend = new Proxy(
    {},
    {
      get(_target, prop) {
        return (...backendArgs) => {
          backendCalls.push({ method: String(prop), args: backendArgs });
          throw new Error(`unexpected backend invocation: ${String(prop)}`);
        };
      }
    }
  );

  registerDispatchTools({
    registerTool,
    registeredToolNames: new Set(REGISTERED_TOOL_NAMES),
    workspaceRepos: [{ repo: "agent-chassis", dir }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: () => ({ repo: "agent-chassis", dir }),
    dispatchBackend,
    dispatchSessionIdentity: "session-slice3-acceptance"
  });

  return {
    dispatch: tools.get(AGENT_DISPATCH_TOOL_NAME),
    backendCalls
  };
}

function parseStructuredTextResponse(result) {
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.equal(typeof result.content[0].text, "string");
  const structured = JSON.parse(result.content[0].text);
  assert.deepEqual(result.structuredContent, structured);
  return structured;
}

const VALID_CRITERIA = ["Implement the requested dispatch guard."];
const VALID_VALIDATION = [
  "node --test tests/workspace-agent-dispatch-selected-slice-acceptance.test.mjs"
];

const SELECTED_SLICE_ACCEPTANCE_VARIANTS = [
  {
    name: "empty selected-slice acceptance (criteria and validation both empty)",
    acceptance: { criteria: [], validation: [] }
  },
  {
    name: "empty selected-slice acceptance.criteria (validation present)",
    acceptance: { criteria: [], validation: VALID_VALIDATION }
  },
  {
    name: "empty selected-slice acceptance.validation (criteria present)",
    acceptance: { criteria: VALID_CRITERIA, validation: [] }
  }
];

for (const variant of SELECTED_SLICE_ACCEPTANCE_VARIANTS) {
  test(
    `registered dispatch refuses ${variant.name} with missing_validation before backend invocation`,
    async (t) => {
      const dir = await writeRecordFixture(t, recordWithSliceAcceptance(variant.acceptance));
      const { dispatch, backendCalls } = registerFixtureDispatchTools(dir);
      assert.ok(dispatch, "the production registration must expose workspace_agent_dispatch");

      const result = await dispatch.handler({ role: "worker", subject: SUBJECT });
      const parsed = parseStructuredTextResponse(result);

      assert.equal(parsed.accepted, false, JSON.stringify(parsed));
      assert.equal(parsed.run_id, null);
      assert.equal(parsed.monitor_handle, null);

      assert.equal(
        parsed.blocker?.detail?.readiness_decision_code,
        "missing_validation",
        JSON.stringify(parsed)
      );
      assert.notEqual(
        parsed.blocker?.detail?.readiness_decision_code,
        "missing_initiative_ref_namespace",
        JSON.stringify(parsed)
      );

      assert.deepEqual(backendCalls, [], JSON.stringify(backendCalls));
    }
  );
}
