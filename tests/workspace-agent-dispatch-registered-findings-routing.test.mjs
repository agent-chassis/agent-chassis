

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";

import { z } from "zod";

import { registerDispatchTools } from "../packages/wiki-mcp/src/lib/dispatch-tools.mjs";
import { jsonContent, errorContent } from "../packages/wiki-mcp/src/lib/mcp-response.mjs";
import {
  assertNoForbiddenTokens,
  createTestDispatchBackend
} from "./workspace-agent-dispatch-backend-shared.mjs";

const CANONICAL_ACCEPTANCE = Object.freeze({
  criteria: ["Report findings against the inspected files; modify nothing."],
  validation: ["node --test tests/workspace-agent-dispatch-registered-findings-routing.test.mjs"]
});

function findingsSlice({ id, workKind, reviewPurpose = null, writeScope = [] }) {
  const slice = {
    id,
    title: `Standalone findings-only ${workKind}`,
    work_kind: workKind,
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    depends_on: [],
    read_scope: [],
    repo_paths: [],
    write_scope: writeScope,
    dispatch_intent: {
      intended_agent_role: workKind === "review" ? "reviewer" : "redteam",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: CANONICAL_ACCEPTANCE,
    sections: { agent_notes: "" }
  };
  if (reviewPurpose) slice.review_purpose = reviewPurpose;
  return slice;
}

function implementationSlice({ id }) {
  return {
    id,
    title: "implementation",
    work_kind: "implementation",
    status: "review",
    priority: "medium",
    owner: "unassigned",
    depends_on: [],
    read_scope: [],
    repo_paths: ["feature.txt"],
    write_scope: ["feature.txt"],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: CANONICAL_ACCEPTANCE,
    sections: { agent_notes: "" }
  };
}

function canonicalRecord({ id, status = "review", slices }) {
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: `Registered findings-routing fixture ${id}`,
    record_kind: "work_item",
    work_kind: "implementation",
    status,
    priority: "medium",
    owner: "unassigned",
    created: "2026-07-24",
    updated: "2026-07-24",
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: null,
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: CANONICAL_ACCEPTANCE,
    sections: {
      summary: "",
      why_it_matters: "",
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices,
    escalations: [],
    projections: [],
    migration: null,
    initiative: "IN-0030"
  };
}

function standaloneAlongsideTerminalRecord({ id, standaloneWorkKind }) {
  return canonicalRecord({
    id,
    slices: [
      findingsSlice({ id: "SLICE-001", workKind: standaloneWorkKind }),
      implementationSlice({ id: "SLICE-050" }),
      findingsSlice({ id: "SLICE-099", workKind: "review", reviewPurpose: "terminal_whole_wk" })
    ]
  });
}

function createRegisteredFindingsHarness(t, record) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "wk1725s2-repo-"));
  const worktrees = mkdtempSync(path.join(os.tmpdir(), "wk1725s2-wt-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  t.after(() => rmSync(worktrees, { recursive: true, force: true }));

  mkdirSync(path.join(repo, "wiki", "work-records"), { recursive: true });
  writeFileSync(
    path.join(repo, "wiki", "work-records", `${record.id}.json`),
    JSON.stringify(record, null, 2)
  );

  const executorInputs = [];
  let recoveryCalls = 0;
  const backend = createTestDispatchBackend({
    launchExecutor: async (input) => {
      executorInputs.push({
        role: input.role,
        subject: input.subject,
        workspace_dir: input.workspace_dir
      });
      return { accepted: true, status: "launching" };
    },
    worktreeProvisioning: { mainRepo: repo, worktreeRoot: worktrees },

    recoverTerminalCandidate: async () => {
      recoveryCalls += 1;
      return null;
    }
  });

  const tools = new Map();
  registerDispatchTools({
    registerTool: (name, config, handler) => tools.set(name, { config, handler }),

    registeredToolNames: new Set(["workspace_agent_dispatch"]),
    workspaceRepos: [{ repo: "fixture", dir: repo }],
    z,
    jsonContent,
    errorContent,

    resolveWorkspaceRepo: () => ({ repo: "fixture", dir: repo }),
    dispatchBackend: backend,
    dispatchSessionIdentity: "session-wk1725s2"

  });

  const dispatch = async ({ role, subject }) => {
    const response = await tools.get("workspace_agent_dispatch").handler({
      role,
      subject,

      app: "codex"
    });
    assert.equal(response.isError, undefined, "handler must not return an MCP error envelope");
    assert.equal(response.content[0].type, "text");
    const structured = JSON.parse(response.content[0].text);
    assert.deepEqual(response.structuredContent, structured);
    return structured;
  };

  return {
    repo,
    dispatch,
    executorInputs,
    executorCalls: () => executorInputs.length,
    recoveryCalls: () => recoveryCalls
  };
}

test("WK-1725#SLICE-002 registered route matrix: standalone reviewer and redteam route generically with zero terminal recovery", async (t) => {
  const cases = [
    { role: "reviewer", workKind: "review", id: "WK-9820" },
    { role: "redteam", workKind: "redteam", id: "WK-9821" }
  ];
  for (const { role, workKind, id } of cases) {
    const record = canonicalRecord({ id, slices: [findingsSlice({ id: "SLICE-001", workKind })] });
    const harness = createRegisteredFindingsHarness(t, record);
    const subject = `${id}#SLICE-001`;

    const result = await harness.dispatch({ role, subject });

    assert.equal(result.accepted, true, `${role}: ${JSON.stringify(result)}`);
    assert.equal(result.role, role);
    assert.equal(result.subject, subject);

    assert.equal(harness.executorCalls(), 1, `${role} must reach the family executor exactly once`);
    assert.equal(harness.executorInputs[0].role, role);
    assert.equal(harness.executorInputs[0].subject, subject);
    assert.equal(harness.executorInputs[0].workspace_dir, harness.repo);

    assert.equal(harness.recoveryCalls(), 0, `${role} standalone unit must take zero terminal recovery`);
    assertNoForbiddenTokens(result, `wk1725s2-${role}`);
  }
});

test("WK-1725#SLICE-002 a standalone findings unit is not rerouted by a separate terminal unit in the same record (kills the record-wide override)", async (t) => {
  for (const standaloneWorkKind of ["review", "redteam"]) {
    const role = standaloneWorkKind === "review" ? "reviewer" : "redteam";
    const id = standaloneWorkKind === "review" ? "WK-9830" : "WK-9831";
    const record = standaloneAlongsideTerminalRecord({ id, standaloneWorkKind });
    const harness = createRegisteredFindingsHarness(t, record);

    const result = await harness.dispatch({ role, subject: `${id}#SLICE-001` });

    assert.equal(result.accepted, true, `${role}: ${JSON.stringify(result)}`);
    assert.equal(harness.executorCalls(), 1, `${role} standalone unit reaches the generic executor`);
    assert.equal(harness.executorInputs[0].workspace_dir, harness.repo);
    assert.equal(
      harness.recoveryCalls(),
      0,
      `${role} standalone unit must take zero terminal recovery despite a terminal unit elsewhere`
    );
  }
});

test("WK-1725#SLICE-002 the selected unit alone controls routing: selecting the terminal unit enters exact candidate recovery", async (t) => {
  for (const role of ["reviewer", "redteam"]) {
    const id = role === "reviewer" ? "WK-9840" : "WK-9841";
    const record = standaloneAlongsideTerminalRecord({ id, standaloneWorkKind: "redteam" });
    const harness = createRegisteredFindingsHarness(t, record);

    const result = await harness.dispatch({ role, subject: `${id}#SLICE-099` });

    assert.equal(
      harness.recoveryCalls(),
      1,
      `${role} selected terminal unit must enter candidate recovery exactly once`
    );
    assert.equal(harness.executorCalls(), 0, `${role} terminal recovery must not reach the generic executor`);
    assert.equal(result.accepted, false, `${role}: the stubbed null candidate cannot satisfy recovery`);
  }
});

test("WK-1725#SLICE-002 parent status does not change standalone findings routing", async (t) => {
  for (const status of ["todo", "active", "review", "done"]) {
    const record = canonicalRecord({
      id: "WK-9850",
      status,
      slices: [findingsSlice({ id: "SLICE-001", workKind: "redteam" })]
    });
    const harness = createRegisteredFindingsHarness(t, record);

    const result = await harness.dispatch({ role: "redteam", subject: "WK-9850#SLICE-001" });

    assert.equal(result.accepted, true, `parent status ${status}: ${JSON.stringify(result)}`);
    assert.equal(harness.executorCalls(), 1, `parent status ${status} reaches the generic executor`);
    assert.equal(harness.recoveryCalls(), 0, `parent status ${status} must not route to terminal recovery`);
  }
});

test("WK-1725#SLICE-002 repeated standalone findings attempts remain plural and are never singleton-blocked", async (t) => {
  const record = canonicalRecord({
    id: "WK-9860",
    slices: [findingsSlice({ id: "SLICE-001", workKind: "redteam" })]
  });
  const harness = createRegisteredFindingsHarness(t, record);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await harness.dispatch({ role: "redteam", subject: "WK-9860#SLICE-001" });
    assert.equal(result.accepted, true, `attempt ${attempt}: ${JSON.stringify(result)}`);
  }
  assert.equal(harness.executorCalls(), 3, "every standalone findings attempt reaches the executor");
  assert.equal(harness.recoveryCalls(), 0, "repeated standalone attempts never enter terminal recovery");
});
