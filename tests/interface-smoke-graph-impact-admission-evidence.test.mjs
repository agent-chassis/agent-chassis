

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

import {
  bootstrapRepo,
  createWikiRecord,
  digestWorkRecord,
  refreshWorkRecordAdmissionDerivedEvidenceById
} from "../packages/wiki-core/src/index.mjs";

import {
  INITIALIZE_PARAMS,
  cleanupInterfaceSmokeArtifacts,
  createMcpSession,
  withTempDir
} from "./interface-smoke-graph-impact-shared.mjs";

afterEach(cleanupInterfaceSmokeArtifacts);

test("WK-0528 review-fixup: graph-impact persistence after refresh-admission-metrics preserves full worker-admission evidence", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wk0528-refix-evidence-demo" });
    const issue = await createWikiRecord({
      dir: tempDir,
      type: "issue",
      title: "Preserve admission evidence on graph-impact persist"
    });

    const refreshed = await refreshWorkRecordAdmissionDerivedEvidenceById({
      dir: tempDir,
      id: issue.id
    });
    assert.equal(refreshed.valid, true);
    assert.equal(refreshed.written, true);

    const beforePersist = JSON.parse(
      await readFile(path.join(tempDir, `wiki/work-records/${issue.id}.json`), "utf8")
    );
    const adminEntryBefore = beforePersist.derived_evidence.find(
      (entry) =>
        entry &&
        entry.decision_kind === "work_unit_atomicity" &&
        entry.unit &&
        entry.unit.kind === "work_item"
    );
    assert.ok(adminEntryBefore, "refresh should record a record-level admission entry");

    assert.ok(
      adminEntryBefore.metric_summary,
      "refreshed admission evidence must carry a metric_summary"
    );

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const graphImpact = {
        query_kind: "graph_impact_paths",
        input_paths: ["packages/app/src/service.mjs"],
        validated_paths: ["packages/app/src/service.mjs"],
        invalid_paths: [],
        dirty_state: "clean",
        staleness: "fresh",
        graph_state: {
          dirty_state: "clean",
          staleness: "fresh",
          graph_available: true,
          edge_source: "base_index",
          dirty_graph_mode: "base_index_only",
          graph_schema_version: "repo-code-graph.v1",
          unavailable_paths: []
        },
        summary: { kind: "graph_impact_agent_summary", query_kind: "graph_impact_paths" }
      };

      const persisted = await session.request(2, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: { unit: issue.id, graph_impact: graphImpact }
      });
      assert.equal(persisted.structuredContent.valid, true);
      assert.equal(persisted.structuredContent.written, true);

      const afterPersist = JSON.parse(
        await readFile(path.join(tempDir, `wiki/work-records/${issue.id}.json`), "utf8")
      );
      const adminEntryAfter = afterPersist.derived_evidence.find(
        (entry) =>
          entry &&
          entry.decision_kind === "work_unit_atomicity" &&
          entry.unit &&
          entry.unit.kind === "work_item"
      );
      assert.ok(adminEntryAfter, "persist must keep a record-level admission entry");

      assert.ok(
        adminEntryAfter.metric_summary,
        "persisted admission entry must retain metric_summary after graph-impact attach"
      );
      assert.ok(
        adminEntryAfter.graph_impact &&
          adminEntryAfter.graph_impact.query_kind === "graph_impact_paths",
        "graph-impact envelope must be attached to the admission entry"
      );
    } finally {
      await session.close();
    }
  });
});

test("WK-0528 review-fixup: workspace_record_graph_impact_evidence honors expected_source_digest mismatch", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wk0528-refix-digest-demo" });
    const issue = await createWikiRecord({
      dir: tempDir,
      type: "issue",
      title: "Optimistic concurrency on graph-impact persistence"
    });

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const graphImpact = {
        query_kind: "graph_impact_paths",
        input_paths: ["packages/app/src/service.mjs"],
        validated_paths: ["packages/app/src/service.mjs"],
        invalid_paths: [],
        dirty_state: "clean",
        staleness: "fresh",
        graph_state: {
          dirty_state: "clean",
          staleness: "fresh",
          graph_available: true,
          edge_source: "base_index",
          dirty_graph_mode: "base_index_only",
          graph_schema_version: "repo-code-graph.v1",
          unavailable_paths: []
        },
        summary: { kind: "graph_impact_agent_summary", query_kind: "graph_impact_paths" }
      };

      const stale = await session.request(2, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact: graphImpact,
          expected_source_digest: "sha256:deadbeef"
        }
      });
      assert.equal(stale.structuredContent.valid, false);
      assert.equal(stale.structuredContent.written, false);
      assert.ok(
        (stale.structuredContent.diagnostics || []).some(
          (entry) => entry.code === "stale_source_digest"
        ),
        "stale expected_source_digest must surface stale_source_digest diagnostic"
      );

      const currentRecord = JSON.parse(
        await readFile(path.join(tempDir, `wiki/work-records/${issue.id}.json`), "utf8")
      );
      const currentDigest = digestWorkRecord(currentRecord);

      const persisted = await session.request(3, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact: graphImpact,
          expected_source_digest: currentDigest
        }
      });
      assert.equal(persisted.structuredContent.valid, true);
      assert.equal(persisted.structuredContent.written, true);
    } finally {
      await session.close();
    }
  });
});
