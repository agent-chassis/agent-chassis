import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { validateWorkRecordDispatchById } from "../packages/wiki-core/src/lib/work-record-dispatch.mjs";
import { validateWorkRecordDispatch } from "../packages/wiki-core/src/operations/validate-dispatch.mjs";
import { createProspectiveWorkRecordStore } from "../packages/wiki-core/src/lib/work-record-prospective-preflight-store.mjs";
import { validateWorkRecord } from "../packages/wiki-core/src/lib/work-record-schema.mjs";

const graphState = {
  dirty_state: "clean",
  staleness: "fresh",
  graph_available: true,
  edge_source: "base_index",
  dirty_graph_mode: "base_index_only",
  graph_schema_version: "repo-code-graph.v1",
  unavailable_paths: []
};

function makeRecord() {
  return {
    schema_version: "work-record.v1",
    id: "WK-9001",
    repo: "agent-chassis/agent-chassis",
    title: "live worktree capability test",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "todo",
    priority: "medium",
    owner: "unassigned",
    created: "2026-05-12",
    updated: "2026-05-12",
    initiative: "IN-0001",
    read_scope: [],
    repo_paths: [
      "packages/wiki-core/src/lib/work-record-dispatch.mjs",
      "tests/work-record-dispatch-live-worktree-capability.test.mjs"
    ],
    write_scope: [
      "packages/wiki-core/src/lib/work-record-dispatch.mjs",
      "tests/work-record-dispatch-live-worktree-capability.test.mjs"
    ],
    depends_on: [],
    blocks: [],
    related: [],

    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "slice",
      requires_graph_impact: true,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["the capability contract is covered"],
      validation: ["node --test"]
    },
    sections: {
      summary: "Live-worktree capability fixture.",
      why_it_matters: "Covers the live_worktree store-capability branch.",
      scope: {
        items: ["live worktree capability check"],
        out_of_scope: ["wrapper launch"]
      },
      tasks: [],
      references: [],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [],
    escalations: [],
    projections: []
  };
}

async function withTempRecord(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-chassis-live-worktree-"));
  try {
    const record = makeRecord();
    await mkdir(path.join(dir, "wiki", "work-records"), { recursive: true });
    await writeFile(
      path.join(dir, "wiki", "work-records", `${record.id}.json`),
      `${JSON.stringify(record)}\n`,
      "utf8"
    );
    await fn(dir, record);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createStore(capabilities) {
  return {
    capabilities,
    readText: (filePath) => readFile(filePath, "utf8"),
    pathExists: async (filePath) => {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    listJsonPaths: async () => []
  };
}

function liveResolver() {
  return async () => ({
    graphSelection: {
      graphState,
      graph: { nodes: [], edges: [] }
    },
    status: graphState
  });
}

test("declared live_worktree reaches live graph resolution and node-engine disposition", async () => {
  await withTempRecord(async (dir, record) => {
    const diagnostics = validateWorkRecord(record);
    assert.equal(
      diagnostics.filter(({ severity }) => severity === "error").length,
      0,
      `makeRecord() must produce a schema-valid fixture; diagnostics: ${diagnostics
        .map(({ path: fieldPath, message }) => `${fieldPath}: ${message}`)
        .join("; ")}`
    );
    let resolverCalls = 0;
    const result = await validateWorkRecordDispatchById({
      dir,
      unitAddress: record.id,
      recordStore: createStore({ live_worktree: true }),
      graph_resolver: async (...args) => {
        resolverCalls += 1;
        return liveResolver()(...args);
      },
      node_engine_admissibility: {}
    });

    assert.equal(resolverCalls, 1);
    assert.equal(result.state.graph_available, true);
    assert.equal(result.admissibility.evaluated, true);
    assert.equal(result.admissibility.authority, "local_only_config");
    assert.equal(result.admissibility.status, "local_only_fail_open");
  });
});

const exec = promisify(execFile);
const dep = (version) => ({ version, integrity: `sha512-${"R".repeat(86)}==` });

const lockfile = { name: "fixture", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", version: "1.0.0" }, "node_modules/@agent-chassis/wiki-core": dep("1.0.0"), "node_modules/@vscode/tree-sitter-wasm": dep("0.3.1"), "node_modules/protobufjs": dep("7.6.4"), "node_modules/web-tree-sitter": dep("0.26.9") } };
const committedPaths = ["src/a.mjs", "src/b.mjs"];

async function withCommittedFixture(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-chassis-live-carrier-"));
  try {
    const record = Object.assign(makeRecord(), { id: "WK-9101", repo_paths: committedPaths, write_scope: committedPaths });
    record.dispatch_intent.target_unit = "record";
    assert.deepEqual(validateWorkRecord(record), []);
    await mkdir(path.join(dir, "wiki/work-records"), { recursive: true });
    await mkdir(path.join(dir, "src"));
    await writeFile(path.join(dir, ".gitignore"), ".cache/\n");
    await writeFile(path.join(dir, "package.json"), `${JSON.stringify({ name: "fixture", version: "1.0.0", private: true })}\n`);
    await writeFile(path.join(dir, "package-lock.json"), `${JSON.stringify(lockfile)}\n`);
    await writeFile(path.join(dir, "src/a.mjs"), "import './b.mjs';\nexport const a = 1;\n");
    await writeFile(path.join(dir, "src/b.mjs"), "export const b = 2;\n");
    await writeFile(path.join(dir, `wiki/work-records/${record.id}.json`), `${JSON.stringify(record)}\n`);
    await exec("git", ["init", "-q"], { cwd: dir });
    await exec("git", ["add", "."], { cwd: dir });
    await exec("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture"], { cwd: dir });
    await fn(dir, record);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const resolverRan = async (dir) => { try { await access(path.join(dir, ".cache/repo-code-index/index.json")); return true; } catch { return false; } };
const fsStore = (dir, extra, onRead = () => {}) => Object.assign(extra, { readText: (p) => { onRead(); return readFile(path.resolve(dir, p), "utf8"); }, pathExists: async (p) => { try { await access(path.resolve(dir, p)); return true; } catch { return false; } } });

test("snapshotting preserves the default and prospective trusted-live carriers", async () => {
  for (const carrier of ["default", "prospective"]) {
    await withCommittedFixture(async (dir, record) => {
      const result = await validateWorkRecordDispatch({ dir, unitAddress: record.id, recordStore: carrier === "default" ? undefined : createProspectiveWorkRecordStore({ dir, proposedRecord: record }) });

      assert.equal(result.decision_code, "dispatchable", carrier);
      assert.equal(result.state.graph_available, true, carrier);
      assert.equal(await resolverRan(dir), true, carrier);
    });
  }
});

test("a supplied store is live only through its own capabilities.live_worktree === true", async () => {
  const nonLive = {
    omitted: {}, explicit_false: { capabilities: { live_worktree: false } },
    malformed_value: { capabilities: { live_worktree: "true" } },
    malformed_capabilities: { capabilities: "live" }, null_capabilities: { capabilities: null },
    inherited_capabilities: Object.create({ capabilities: { live_worktree: true } }),
    inherited_flag: { capabilities: Object.create({ live_worktree: true }) }
  };
  for (const [label, shape] of Object.entries(nonLive)) {
    await withCommittedFixture(async (dir, record) => {
      const result = await validateWorkRecordDispatch({ dir, unitAddress: record.id, recordStore: fsStore(dir, shape) });
      assert.equal(result.decision_code, "missing_graph_impact", label);
      assert.equal(result.dispatchable, false, label);

      assert.equal(result.graph_impact_failure ?? null, null, label);
      assert.equal(await resolverRan(dir), false, label);
    });
  }
});

test("an own live capability survives snapshotting and reads canonical bytes once", async () => {
  await withCommittedFixture(async (dir, record) => {
    let reads = 0;
    const result = await validateWorkRecordDispatch({ dir, unitAddress: record.id, recordStore: fsStore(dir, { capabilities: { live_worktree: true } }, () => { reads += 1; }) });
    assert.equal(result.decision_code, "dispatchable");
    assert.equal(await resolverRan(dir), true);

    assert.equal(reads, 1);
  });
});

test("an undeclared live_worktree capability remains graph-impact unbuildable", async () => {
  await withTempRecord(async (dir, record) => {
    const diagnostics = validateWorkRecord(record);
    assert.equal(
      diagnostics.filter(({ severity }) => severity === "error").length,
      0,
      `makeRecord() must produce a schema-valid fixture; diagnostics: ${diagnostics
        .map(({ path: fieldPath, message }) => `${fieldPath}: ${message}`)
        .join("; ")}`
    );
    let resolverCalls = 0;
    const result = await validateWorkRecordDispatchById({
      dir,
      unitAddress: record.id,
      recordStore: createStore({}),
      graph_resolver: async () => {
        resolverCalls += 1;
        return liveResolver()();
      },
      node_engine_admissibility: {}
    });

    assert.equal(resolverCalls, 0);
    assert.equal(result.decision_code, "missing_graph_impact");
    assert.equal(result.dispatchable, false);
    assert.equal(result.admissibility, undefined);
  });
});
