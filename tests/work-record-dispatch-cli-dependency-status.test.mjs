import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { runValidateDispatch } from "../packages/wiki-cli/src/commands/validate-dispatch.mjs";

async function withTempRepo(fn) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agent-chassis-dispatch-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function captureConsoleLog(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(" "));
  };
  return fn()
    .then(() => lines.join("\n"))
    .finally(() => {
      console.log = originalLog;
    });
}

function freshGraphState() {
  return {
    dirty_state: "clean",
    staleness: "fresh",
    graph_available: true,
    edge_source: "base_index",
    dirty_graph_mode: "base_index_only",
    graph_schema_version: "repo-code-graph.v1",
    unavailable_paths: []
  };
}

function makeDependencyTrackerFixture() {
  return {
    schema_version: "work-record.v1",
    id: "WK-9301",
    repo: "agent-chassis/agent-chassis",
    title: "Tracker with slice-level depends_on",
    record_kind: "work_item",
    work_kind: "tracker",
    status: "todo",
    priority: "high",
    owner: "codex",
    created: "2026-05-17",
    updated: "2026-05-17",
    docs: ["docs/work-record-schema.md"],
    repo_paths: [
      "packages/wiki-core/src/lib/work-record-dispatch.mjs",
      "tests/work-record-dispatch.test.mjs"
    ],
    write_scope: [
      "packages/wiki-core/src/lib/work-record-dispatch.mjs",
      "tests/work-record-dispatch.test.mjs"
    ],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "orchestrator",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Slice dependency evidence is collected for the dependent slice."],
      validation: ["npm test -- tests/work-record-dispatch.test.mjs"]
    },
    sections: {
      summary: "Tracker with intra-record slice dependencies.",
      why_it_matters: "Slice-local depends_on must reach dispatch evidence.",
      scope: {
        items: ["slice dependency evidence"],
        out_of_scope: ["wrapper launch"]
      },
      tasks: [],
      references: ["docs/work-record-schema.md"],
      agent_notes: "",
      closure: null
    },
    children: [],
    slices: [
      {
        id: "prerequisite-slice",
        title: "Prerequisite slice",
        work_kind: "implementation",
        status: "done",
        write_scope: [
          "packages/wiki-core/src/lib/work-record-dispatch.mjs",
          "tests/work-record-dispatch.test.mjs"
        ],
        repo_paths: [
          "packages/wiki-core/src/lib/work-record-dispatch.mjs",
          "tests/work-record-dispatch.test.mjs"
        ],
        docs: ["docs/work-record-schema.md"],
        acceptance: {
          criteria: ["Prerequisite ran first."],
          validation: ["npm test -- tests/work-record-dispatch.test.mjs"]
        },
        depends_on: [],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        }
      },
      {
        id: "dependent-slice",
        title: "Dependent slice",
        work_kind: "implementation",
        status: "todo",
        write_scope: [
          "packages/wiki-core/src/lib/work-record-dispatch.mjs",
          "tests/work-record-dispatch.test.mjs"
        ],
        repo_paths: [
          "packages/wiki-core/src/lib/work-record-dispatch.mjs",
          "tests/work-record-dispatch.test.mjs"
        ],
        docs: ["docs/work-record-schema.md"],
        acceptance: {
          criteria: ["Dependent slice runs after the prerequisite."],
          validation: ["npm test -- tests/work-record-dispatch.test.mjs"]
        },
        depends_on: ["WK-9301#prerequisite-slice"],
        dispatch_intent: {
          intended_agent_role: "worker",
          target_unit: "slice",
          requires_graph_impact: false,
          requires_escalation: false
        }
      }
    ],
    escalations: [],
    projections: [],
    migration: null
  };
}

function makeDependencyConsumerFixture() {
  return {
    schema_version: "work-record.v1",
    id: "WK-9302",
    repo: "agent-chassis/agent-chassis",
    title: "Implementation with inter-record depends_on",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "active",
    priority: "high",
    owner: "codex",
    created: "2026-05-17",
    updated: "2026-05-17",
    docs: ["docs/work-record-schema.md"],
    repo_paths: ["packages/wiki-core/src/lib/work-record-dispatch.mjs"],
    write_scope: ["packages/wiki-core/src/lib/work-record-dispatch.mjs"],
    depends_on: ["WK-9870"],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Inter-record dependency evidence is captured."],
      validation: ["npm test -- tests/work-record-dispatch.test.mjs"]
    },
    sections: {
      summary: "Implementation record with one inter-record dependency.",
      why_it_matters: "Inter-record evidence must round-trip through canonical JSON.",
      scope: {
        items: ["inter-record dependency evidence"],
        out_of_scope: ["wrapper launch"]
      },
      tasks: [],
      references: ["docs/work-record-schema.md"],
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

function makeDependencyTargetFixture() {
  return {
    schema_version: "work-record.v1",
    id: "WK-9303",
    repo: "agent-chassis/agent-chassis",
    title: "Implementation target referenced by inter-record consumer",
    record_kind: "work_item",
    work_kind: "implementation",
    status: "done",
    priority: "high",
    owner: "codex",
    created: "2026-05-17",
    updated: "2026-05-17",
    docs: ["docs/work-record-schema.md"],
    repo_paths: ["packages/wiki-core/src/lib/work-record-dispatch.mjs"],
    write_scope: ["packages/wiki-core/src/lib/work-record-dispatch.mjs"],
    depends_on: [],
    blocks: [],
    related: [],
    dispatch_intent: {
      intended_agent_role: "worker",
      target_unit: "record",
      requires_graph_impact: false,
      requires_escalation: false
    },
    acceptance: {
      criteria: ["Local resolution finds this record's status."],
      validation: ["npm test -- tests/work-record-dispatch.test.mjs"]
    },
    sections: {
      summary: "Target implementation record for inter-record resolution.",
      why_it_matters: "Provides canonical_wk_json provenance evidence in dependency resolution.",
      scope: {
        items: ["inter-record resolution"],
        out_of_scope: ["wrapper launch"]
      },
      tasks: [],
      references: ["docs/work-record-schema.md"],
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

const DEPENDENCY_FIXTURE_FACTORIES = {
  "tracker-with-slice-deps.json": makeDependencyTrackerFixture,
  "implementation-with-record-dep.json": makeDependencyConsumerFixture,
  "implementation-target.json": makeDependencyTargetFixture
};

async function installDependencyFixture(tempDir, relativePath, mutate = null) {
  const factory = DEPENDENCY_FIXTURE_FACTORIES[relativePath];
  if (!factory) {
    throw new Error(`Unknown dependency fixture: ${relativePath}`);
  }
  const record = factory();
  if (mutate) {
    mutate(record);
  }
  const targetPath = path.join(tempDir, "wiki", "work-records", `${record.id}.json`);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

function findDependencyEvidence(readiness) {
  return readiness.derived_evidence.find(
    (entry) => entry.kind === "dispatch_readiness_dependencies"
  );
}

test("validate-dispatch CLI strict mode consumes inline --dependency-status-json for record-address dispatch", async () => {
  await withTempRepo(async (tempDir) => {
    const target = await installDependencyFixture(tempDir, "implementation-target.json");
    const consumer = await installDependencyFixture(
      tempDir,
      "implementation-with-record-dep.json",
      (mutable) => {
        mutable.depends_on = [target.id];
      }
    );

    const output = await captureConsoleLog(() =>
      runValidateDispatch([
        "strict",
        "--unit",
        consumer.id,
        "--dir",
        tempDir,
        "--json",
        "--graph-state-json",
        JSON.stringify(freshGraphState()),
        "--dependency-status-json",
        JSON.stringify({
          [target.id]: { status: "blocked", reason: "operator override via CLI" }
        })
      ])
    );
    const result = JSON.parse(output);

    assert.equal(result.decision_code, "blocked_dependency");
    assert.equal(result.dispatchable, false);
    const evidence = findDependencyEvidence(result);
    const entry = evidence.dependencies.find((item) => item.address === target.id);
    assert.equal(entry.provenance, "supplied");
    assert.equal(entry.selected_status, "blocked");
    assert.equal(entry.reason, "operator override via CLI");
  });
});

test("validate-dispatch CLI strict mode consumes --dependency-status-json-file for slice-address dispatch", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(tempDir, "tracker-with-slice-deps.json");
    const statusPath = path.join(tempDir, "dependency-status.json");
    const sliceDepAddress = `${record.id}#prerequisite-slice`;
    await writeFile(
      statusPath,
      `${JSON.stringify({
        [sliceDepAddress]: { status: "blocked", reason: "prerequisite paused" }
      })}\n`,
      "utf8"
    );

    const output = await captureConsoleLog(() =>
      runValidateDispatch([
        "strict",
        "--unit",
        `${record.id}#dependent-slice`,
        "--dir",
        tempDir,
        "--json",
        "--graph-state-json",
        JSON.stringify(freshGraphState()),
        "--dependency-status-json-file",
        statusPath
      ])
    );
    const result = JSON.parse(output);

    assert.equal(result.decision_code, "blocked_dependency");
    const entry = findDependencyEvidence(result).dependencies.find(
      (item) => item.address === sliceDepAddress
    );
    assert.equal(entry.provenance, "supplied");
    assert.equal(entry.selected_status, "blocked");
    assert.equal(entry.source, "slice");
  });
});

test("validate-dispatch CLI report mode routes --dependency-status-json through the same library path", async () => {
  await withTempRepo(async (tempDir) => {
    const target = await installDependencyFixture(tempDir, "implementation-target.json");
    const consumer = await installDependencyFixture(
      tempDir,
      "implementation-with-record-dep.json",
      (mutable) => {
        mutable.depends_on = [target.id];
      }
    );

    const output = await captureConsoleLog(() =>
      runValidateDispatch([
        "report",
        "--unit",
        consumer.id,
        "--dir",
        tempDir,
        "--json",
        "--graph-state-json",
        JSON.stringify(freshGraphState()),
        "--dependency-status-json",
        JSON.stringify({ [target.id]: { status: "blocked", reason: "ack" } })
      ])
    );
    const result = JSON.parse(output);

    assert.equal(result.report_mode, true);
    assert.equal(result.readiness.decision_code, "blocked_dependency");
    const entry = findDependencyEvidence(result.readiness).dependencies.find(
      (item) => item.address === target.id
    );
    assert.equal(entry.provenance, "supplied");
    assert.equal(entry.selected_status, "blocked");
  });
});

test("validate-dispatch CLI accepts non-done supplied status for external dep and records supplied provenance", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(
      tempDir,
      "implementation-with-record-dep.json",
      (mutable) => {
        mutable.depends_on = ["node-engine:WK-0299"];
      }
    );

    const output = await captureConsoleLog(() =>
      runValidateDispatch([
        "strict",
        "--unit",
        record.id,
        "--dir",
        tempDir,
        "--json",
        "--graph-state-json",
        JSON.stringify(freshGraphState()),
        "--dependency-status-json",
        JSON.stringify({ "node-engine:WK-0299": { status: "active" } })
      ])
    );
    const result = JSON.parse(output);

    assert.equal(result.decision_code, "dispatchable");
    const entry = findDependencyEvidence(result).dependencies.find(
      (item) => item.address === "node-engine:WK-0299"
    );
    assert.equal(entry.marker, "external_supplied");
    assert.equal(entry.provenance, "supplied");
    assert.equal(entry.selected_status, "active");
    assert.equal(entry.external_repo, "node-engine");
  });
});

test("validate-dispatch CLI omits dependency-status JSON and routes through canonical resolution unchanged", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(tempDir, "tracker-with-slice-deps.json");

    const output = await captureConsoleLog(() =>
      runValidateDispatch([
        "strict",
        "--unit",
        `${record.id}#dependent-slice`,
        "--dir",
        tempDir,
        "--json",
        "--graph-state-json",
        JSON.stringify(freshGraphState())
      ])
    );
    const result = JSON.parse(output);

    assert.equal(result.decision_code, "dispatchable");
    const entry = findDependencyEvidence(result).dependencies.find(
      (item) => item.address === `${record.id}#prerequisite-slice`
    );
    assert.equal(entry.provenance, "canonical_wk_json");
    assert.equal(entry.selected_status, "done");
    assert.equal(entry.marker, "resolved");
  });
});

test("validate-dispatch CLI rejects simultaneous --dependency-status-json and --dependency-status-json-file", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(tempDir, "tracker-with-slice-deps.json");
    const statusPath = path.join(tempDir, "dependency-status.json");
    await writeFile(statusPath, "{}\n", "utf8");

    await assert.rejects(
      () =>
        runValidateDispatch([
          "strict",
          "--unit",
          `${record.id}#dependent-slice`,
          "--dir",
          tempDir,
          "--json",
          "--dependency-status-json",
          "{}",
          "--dependency-status-json-file",
          statusPath
        ]),
      /Use only one of --dependency-status-json or --dependency-status-json-file/
    );
  });
});

test("validate-dispatch CLI rejects malformed --dependency-status-json", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(tempDir, "tracker-with-slice-deps.json");

    await assert.rejects(
      () =>
        runValidateDispatch([
          "strict",
          "--unit",
          `${record.id}#dependent-slice`,
          "--dir",
          tempDir,
          "--json",
          "--dependency-status-json",
          "{not valid json"
        ]),
      /JSON/i
    );
  });
});
