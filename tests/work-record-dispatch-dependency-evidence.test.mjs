

import test from "node:test";

import assert from "node:assert/strict";

import { tmpdir } from "node:os";

import path from "node:path";

import { fileURLToPath } from "node:url";

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import {
  WORK_RECORD_DISPATCH_DECISION_CODES,
  computeWorkRecordSourceDigest,
  evaluateWorkRecordPolicy,
  validateWorkRecordDispatch,
  validateWorkRecordDispatchReport
} from "../packages/wiki-core/src/index.mjs";

import {
  validateWorkRecordDispatchById as validateWorkRecordDispatchCore,
  validateWorkRecordDispatchReadOnlyById,
  NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE,
  isBashWrapperPath
} from "../packages/wiki-core/src/lib/work-record-dispatch.mjs";

import { joinSidecarPathsToCanonicalRecords } from "../packages/wiki-core/src/lib/sidecar-joins.mjs";

import { runValidateDispatch } from "../packages/wiki-cli/src/commands/validate-dispatch.mjs";

import { registerWorkRecordReadTools } from "../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";

import { createCompactValidateDispatchResponse } from "../packages/wiki-mcp/src/lib/work-record-write-route-helpers.mjs";

async function withTempRepo(fn) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "agent-chassis-dispatch-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
    initiative: "IN-0030",
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
    initiative: "IN-0030",
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
    initiative: "IN-0030",
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

test("slice depends_on entries are collected into dependency evidence", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(tempDir, "tracker-with-slice-deps.json");
    const result = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: `${record.id}#dependent-slice`,
      graph_state: freshGraphState()
    });

    assert.equal(result.decision_code, "dispatchable");
    const evidence = findDependencyEvidence(result);
    assert.ok(evidence, "dependency evidence must be emitted");
    assert.equal(evidence.pack_binding, "worker_admission_v1");
    assert.equal(evidence.operation_binding, "evaluate_work_unit_dispatch.v1");

    const addresses = evidence.dependencies.map((entry) => entry.address);
    assert.ok(addresses.includes(`${record.id}#prerequisite-slice`));
    const sliceDep = evidence.dependencies.find(
      (entry) => entry.address === `${record.id}#prerequisite-slice`
    );
    assert.equal(sliceDep.source, "slice");
    assert.equal(sliceDep.slice_id, "prerequisite-slice");
    assert.equal(sliceDep.selected_status, "done");
    assert.equal(sliceDep.provenance, "canonical_wk_json");
    assert.equal(sliceDep.marker, "resolved");
  });
});

test("dependency evidence covers the canonical work-record.v1 status enum and only done satisfies", async () => {
  const statuses = ["inbox", "todo", "active", "review", "done", "blocked", "parked", "cancelled"];
  for (const sliceStatus of statuses) {
    await withTempRepo(async (tempDir) => {
      const record = await installDependencyFixture(
        tempDir,
        "tracker-with-slice-deps.json",
        (mutable) => {
          const prerequisite = mutable.slices.find((entry) => entry.id === "prerequisite-slice");
          prerequisite.status = sliceStatus;
        }
      );

      const result = await validateWorkRecordDispatch({
        dir: tempDir,
        unitAddress: `${record.id}#dependent-slice`,
        graph_state: freshGraphState()
      });

      const evidence = findDependencyEvidence(result);
      const sliceDep = evidence.dependencies.find(
        (entry) => entry.address === `${record.id}#prerequisite-slice`
      );
      assert.equal(sliceDep.selected_status, sliceStatus, `selected_status for ${sliceStatus}`);
      assert.equal(sliceDep.provenance, "canonical_wk_json");
      assert.equal(sliceDep.marker, "resolved");

      if (sliceStatus === "done") {
        assert.equal(
          result.decision_code,
          "dispatchable",
          `${sliceStatus} must satisfy the dependency gate`
        );
      } else {
        assert.equal(
          result.decision_code,
          "blocked_dependency",
          `${sliceStatus} must refuse with blocked_dependency under WK-0572 readiness policy`
        );
        assert.equal(result.dispatchable, false);
        assert.ok(
          result.reasons.some((reason) => reason.includes(`${record.id}#prerequisite-slice`)),
          `reasons must cite the non-done dependency address for ${sliceStatus}`
        );
      }
    });
  }
});

test("intra-record slice dependencies missing from the canonical record fail closed", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(
      tempDir,
      "tracker-with-slice-deps.json",
      (mutable) => {
        const dependent = mutable.slices.find((entry) => entry.id === "dependent-slice");
        dependent.depends_on = [`${mutable.id}#does-not-exist`];
      }
    );

    const result = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: `${record.id}#dependent-slice`,
      graph_state: freshGraphState()
    });

    assert.equal(result.decision_code, "blocked_dependency");
    assert.equal(result.dispatchable, false);
    assert.ok(
      result.reasons.some((reason) => /does-not-exist/.test(reason)),
      "unresolved slice id must be named in reasons"
    );

    const evidence = findDependencyEvidence(result);
    const entry = evidence.dependencies.find(
      (item) => item.address === `${record.id}#does-not-exist`
    );
    assert.equal(entry.marker, "unresolved");
    assert.equal(entry.provenance, "none");
  });
});

test("typoed dependency addresses fail closed and are recorded as evidence", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(
      tempDir,
      "tracker-with-slice-deps.json",
      (mutable) => {
        const dependent = mutable.slices.find((entry) => entry.id === "dependent-slice");
        dependent.depends_on = ["not-a-valid-address"];
      }
    );

    const result = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: `${record.id}#dependent-slice`,
      graph_state: freshGraphState()
    });

    assert.equal(result.decision_code, "blocked_dependency");
    const evidence = findDependencyEvidence(result);
    const entry = evidence.dependencies.find(
      (item) => item.address === "not-a-valid-address"
    );
    assert.equal(entry.marker, "unresolved");
  });
});

test("inter-record dependencies missing from the local repo are recorded but do not auto-block", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(tempDir, "implementation-with-record-dep.json");

    const result = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: record.id,
      graph_state: freshGraphState()
    });

    assert.equal(result.decision_code, "dispatchable");
    const evidence = findDependencyEvidence(result);
    const entry = evidence.dependencies.find((item) => item.address === "WK-9870");
    assert.equal(entry.source, "record");
    assert.equal(entry.marker, "missing");
    assert.equal(entry.provenance, "none");
    assert.equal(entry.record_id, "WK-9870");
  });
});

test("inter-record dependencies resolve against canonical WK JSON when present", async () => {
  await withTempRepo(async (tempDir) => {
    const target = await installDependencyFixture(tempDir, "implementation-target.json");
    const consumer = await installDependencyFixture(
      tempDir,
      "implementation-with-record-dep.json",
      (mutable) => {
        mutable.depends_on = [target.id];
      }
    );

    const result = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: consumer.id,
      graph_state: freshGraphState()
    });

    assert.equal(result.decision_code, "dispatchable");
    const evidence = findDependencyEvidence(result);
    const entry = evidence.dependencies.find((item) => item.address === target.id);
    assert.equal(entry.marker, "resolved");
    assert.equal(entry.provenance, "canonical_wk_json");
    assert.equal(entry.selected_status, target.status);
  });
});

test("external repo-qualified dependencies are marked external_without_supplied_status absent transport", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(
      tempDir,
      "implementation-with-record-dep.json",
      (mutable) => {
        mutable.depends_on = ["node-engine:WK-0299"];
      }
    );

    const result = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: record.id,
      graph_state: freshGraphState()
    });

    assert.equal(result.decision_code, "dispatchable");
    const evidence = findDependencyEvidence(result);
    const entry = evidence.dependencies.find((item) => item.address === "node-engine:WK-0299");
    assert.equal(entry.marker, "external_without_supplied_status");
    assert.equal(entry.external_repo, "node-engine");
    assert.equal(entry.provenance, "none");
  });
});

test("supplied dependency_statuses transport overrides local resolution and records supplied provenance", async () => {
  await withTempRepo(async (tempDir) => {
    const target = await installDependencyFixture(tempDir, "implementation-target.json");
    const consumer = await installDependencyFixture(
      tempDir,
      "implementation-with-record-dep.json",
      (mutable) => {
        mutable.depends_on = [target.id];
      }
    );

    const result = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: consumer.id,
      graph_state: freshGraphState(),
      dependency_statuses: {
        [target.id]: {
          status: "blocked",
          reason: "operator override: upstream is paused"
        }
      }
    });

    assert.equal(result.decision_code, "blocked_dependency");
    const evidence = findDependencyEvidence(result);
    const entry = evidence.dependencies.find((item) => item.address === target.id);
    assert.equal(entry.provenance, "supplied");
    assert.equal(entry.selected_status, "blocked");
    assert.equal(entry.reason, "operator override: upstream is paused");
  });
});

test("record and slice depends_on contribute to the same dependency evidence vector", async () => {
  await withTempRepo(async (tempDir) => {
    const record = await installDependencyFixture(
      tempDir,
      "tracker-with-slice-deps.json",
      (mutable) => {
        mutable.depends_on = ["WK-9870"];
      }
    );

    const result = await validateWorkRecordDispatch({
      dir: tempDir,
      unitAddress: `${record.id}#dependent-slice`,
      graph_state: freshGraphState()
    });

    const evidence = findDependencyEvidence(result);
    const sources = evidence.dependencies
      .filter((entry) => entry.address === `${record.id}#prerequisite-slice` || entry.address === "WK-9870")
      .map((entry) => entry.source)
      .sort();
    assert.deepEqual(sources, ["record", "slice"]);
  });
});
