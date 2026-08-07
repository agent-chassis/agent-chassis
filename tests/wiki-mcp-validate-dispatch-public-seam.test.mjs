import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { z } from "zod";

import { jsonContent, errorContent } from "../packages/wiki-mcp/src/lib/mcp-response.mjs";
import { registerWorkRecordReadTools } from "../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";
import { createCompactValidateDispatchResponse } from "../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";
import { validateWorkRecord } from "../packages/wiki-core/src/lib/work-record-schema.mjs";

function buildHandler(workspaceDir) {
  const handlers = new Map();
  registerWorkRecordReadTools({
    registerTool: (name, _definition, handler) => {
      handlers.set(name, handler);
    },
    workspaceRepos: [{ repo: "test/fixture", dir: workspaceDir }],
    z,
    jsonContent,
    errorContent,
    resolveWorkspaceRepo: (repos) => repos[0],

    createCompactValidateDispatchResponse
  });
  const handler = handlers.get("workspace_validate_dispatch");
  assert.ok(handler, "workspace_validate_dispatch must be registered");
  return handler;
}

function assertFixtureSchemaValid(record, unitAddress) {
  const diagnostics = validateWorkRecord(record);
  assert.equal(
    diagnostics.length,
    0,
    `fixture for ${unitAddress} must satisfy work-record.v1, got ${diagnostics.length} `
      + `diagnostic(s): ${diagnostics.map((d) => `${d.path}: ${d.message}`).join("; ")}`
  );
}

function baseRecord(id, { work_kind, intended_agent_role, write_scope }) {
  return {
    schema_version: "work-record.v1",
    id,
    repo: "agent-chassis/agent-chassis",
    title: "Self-contained public-seam fixture",
    record_kind: "work_item",
    work_kind,
    status: "active",
    priority: "medium",
    owner: "unassigned",
    created: "2026-01-01",
    updated: "2026-01-01",
    resolution: "unresolved",
    read_scope: [],
    repo_paths: [],
    write_scope,
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role,
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["The fixture is structurally dispatchable."],
      validation: ["Run tests/wiki-mcp-validate-dispatch-public-seam.test.mjs."]
    },
    sections: {
      summary: "Self-contained public-seam fixture.",
      why_it_matters: "The fixture exercises the registered dispatch readiness seam.",
      scope: { items: [], out_of_scope: [] },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [],
    escalations: [],
    projections: [],
    migration: null
  };
}

function terminalReviewSliceRecord(id = "WK-1793", sliceId = "SLICE-005") {
  const record = baseRecord(id, {
    work_kind: "review",
    intended_agent_role: "reviewer",
    write_scope: []
  });
  record.dispatch_intent.target_unit = "slice";
  record.slices = [{
    id: sliceId,
    title: "Self-contained terminal whole-WK review slice",
    work_kind: "review",
    status: "done",
    priority: "medium",
    owner: "unassigned",
    depends_on: [],
    read_scope: [],
    repo_paths: [],
    write_scope: [],
    dispatch_intent: {
      intended_agent_role: "reviewer",
      target_unit: "slice",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["The review slice is dispatchable on the read_only axis."],
      validation: ["Run tests/wiki-mcp-validate-dispatch-public-seam.test.mjs."]
    },
    review_purpose: "terminal_whole_wk"
  }];
  return record;
}

function implementationRecord(id = "WK-9301") {
  return baseRecord(id, {
    work_kind: "implementation",
    intended_agent_role: "worker",
    write_scope: ["packages/wiki-core/src/lib/example.mjs"]
  });
}

function redteamImplementationRecord(id = "WK-1425") {
  return baseRecord(id, {
    work_kind: "implementation",
    intended_agent_role: "redteam",
    write_scope: []
  });
}

async function withWorkspace(record, callback) {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-mcp-public-seam-"));
  try {
    await mkdir(path.join(dir, "wiki", "work-records"), { recursive: true });
    await writeFile(
      path.join(dir, "wiki", "work-records", `${record.id}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8"
    );
    return await callback(buildHandler(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

async function readiness(handler, args) {
  const compact = parseToolResult(await handler(args));
  const verbose = parseToolResult(await handler({ ...args, verbose: true })).readiness;
  return { compact, verbose };
}

function axisView({ compact, verbose }) {
  return {
    compact_dispatch_role: compact.dispatch_role,
    compact_dispatchable: compact.dispatchable,
    compact_decision_code: compact.decision_code,
    compact_reasons: compact.reasons,
    verbose_dispatch_role: verbose.dispatch_role,
    verbose_dispatchable: verbose.dispatchable,
    verbose_decision_code: verbose.decision_code,
    verbose_reasons: verbose.reasons
  };
}

test("omitted dispatch_role derives the read_only axis for a terminal review slice", async () => {
  const record = terminalReviewSliceRecord();
  assertFixtureSchemaValid(record, "WK-1793#SLICE-005");

  await withWorkspace(record, async (handler) => {
    const { compact, verbose } = await readiness(handler, { unit: "WK-1793#SLICE-005" });

    assert.equal(compact.dispatch_role, "read_only");
    assert.equal(compact.dispatchable, true);
    assert.equal(compact.decision_code, "dispatchable");

    assert.equal(verbose.dispatch_role, "read_only");
    assert.equal(verbose.dispatchable, true);
    assert.equal(verbose.decision_code, "dispatchable");

    assert.notEqual(verbose.decision_code, "missing_write_scope");
  });
});

test("an explicit read_only axis is unchanged and agrees with the derived one", async () => {
  const record = terminalReviewSliceRecord();
  assertFixtureSchemaValid(record, "WK-1793#SLICE-005");

  await withWorkspace(record, async (handler) => {
    const explicit = await readiness(handler, {
      unit: "WK-1793#SLICE-005",
      dispatch_role: "read_only"
    });
    assert.equal(explicit.compact.dispatch_role, "read_only");
    assert.equal(explicit.compact.dispatchable, true);
    assert.equal(explicit.compact.decision_code, "dispatchable");
    assert.equal(explicit.verbose.dispatch_role, "read_only");
    assert.equal(explicit.verbose.dispatchable, true);

    const derived = await readiness(handler, { unit: "WK-1793#SLICE-005" });
    assert.deepEqual(axisView(derived), axisView(explicit));
  });
});

test("an explicit implementation axis is unchanged for an implementation unit", async () => {
  const record = implementationRecord();
  assertFixtureSchemaValid(record, "WK-9301");

  await withWorkspace(record, async (handler) => {
    const explicit = await readiness(handler, {
      unit: "WK-9301",
      dispatch_role: "implementation"
    });
    assert.equal(explicit.compact.dispatch_role, "implementation");
    assert.equal(explicit.compact.dispatchable, true);
    assert.equal(explicit.compact.decision_code, "dispatchable");
    assert.equal(explicit.verbose.dispatch_role, "implementation");
    assert.equal(explicit.verbose.dispatchable, true);

    const derived = await readiness(handler, { unit: "WK-9301" });
    assert.deepEqual(axisView(derived), axisView(explicit));
  });
});

test("an implementation unit with a redteam role and empty write_scope refuses when the role is omitted", async () => {
  const record = redteamImplementationRecord();
  assertFixtureSchemaValid(record, "WK-1425");

  await withWorkspace(record, async (handler) => {
    const { compact, verbose } = await readiness(handler, { unit: "WK-1425" });

    assert.equal(compact.dispatchable, false);
    assert.equal(verbose.dispatchable, false);
    assert.equal(verbose.decision_code, "dispatch_readiness_axis_ambiguous");
    assert.equal(verbose.dispatch_role, null);

    assert.equal(compact.dispatch_role, null);
    assert.equal(compact.decision_code, "dispatch_readiness_axis_ambiguous");
    assert.deepEqual(compact.reasons, [
      "a derived read_only axis is contradictory for an implementation unit; "
        + "supply an explicit dispatch_role."
    ]);

    assert.deepEqual(compact.reasons, verbose.reasons);

    assert.equal(verbose.axis_refusal.reason, "derived_read_only_implementation_guard");
    assert.equal(verbose.axis_refusal.observed_field, "dispatch_intent.intended_agent_role");
    assert.equal(verbose.axis_refusal.observed_value, "redteam");
    assert.equal(verbose.axis_refusal.remediation.argument, "dispatch_role");
    assert.deepEqual(
      verbose.axis_refusal.remediation.accepted_values,
      ["implementation", "read_only"]
    );

    const explicit = await readiness(handler, {
      unit: "WK-1425",
      dispatch_role: "implementation"
    });
    assert.equal(explicit.verbose.dispatch_role, "implementation");
    assert.equal(explicit.verbose.dispatchable, false);
    assert.equal(explicit.verbose.decision_code, "missing_write_scope");
  });
});

const exec = promisify(execFile);
const graphPaths = ["src/a.mjs", "src/b.mjs"];
const dep = (version) => ({ version, integrity: `sha512-${"R".repeat(86)}==` });
const lockfile = { name: "fixture", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", version: "1.0.0" }, "node_modules/@agent-chassis/wiki-core": dep("1.0.0"), "node_modules/@vscode/tree-sitter-wasm": dep("0.3.1"), "node_modules/protobufjs": dep("7.6.4"), "node_modules/web-tree-sitter": dep("0.26.9") } };

function graphImpactRecord(id = "WK-9302") {
  const record = baseRecord(id, { work_kind: "implementation", intended_agent_role: "worker", write_scope: graphPaths });
  record.repo_paths = graphPaths;
  record.dispatch_intent.requires_graph_impact = true;
  return record;
}

async function withCommittedWorkspace(record, callback) {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-mcp-committed-seam-"));
  try {
    await mkdir(path.join(dir, "wiki", "work-records"), { recursive: true });
    await mkdir(path.join(dir, "src"));
    await writeFile(path.join(dir, ".gitignore"), ".cache/\n");
    await writeFile(path.join(dir, "package.json"), `${JSON.stringify({ name: "fixture", version: "1.0.0", private: true })}\n`);
    await writeFile(path.join(dir, "package-lock.json"), `${JSON.stringify(lockfile)}\n`);
    await writeFile(path.join(dir, "src/a.mjs"), "import './b.mjs';\nexport const a = 1;\n");
    await writeFile(path.join(dir, "src/b.mjs"), "export const b = 2;\n");
    await writeFile(path.join(dir, "wiki", "work-records", `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    await exec("git", ["init", "-q"], { cwd: dir });
    await exec("git", ["add", "."], { cwd: dir });
    await exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture"], { cwd: dir });
    return await callback(buildHandler(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the registered route reaches committed-HEAD graph readiness and compact agrees with verbose", async () => {
  const record = graphImpactRecord();
  assertFixtureSchemaValid(record, record.id);

  await withCommittedWorkspace(record, async (handler) => {
    const { compact, verbose } = await readiness(handler, { unit: record.id });

    assert.notEqual(verbose.decision_code, "missing_graph_impact");
    assert.equal(verbose.decision_code, "dispatchable");
    assert.equal(verbose.dispatchable, true);
    assert.equal(verbose.state.graph_available, true);

    assert.equal(compact.decision_code, verbose.decision_code);
    assert.equal(compact.dispatchable, verbose.dispatchable);
    assert.equal(compact.dispatch_role, verbose.dispatch_role);
    assert.deepEqual(compact.reasons, verbose.reasons);
  });
});
