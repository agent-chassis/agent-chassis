

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  bootstrapRepo,
  createWikiRecord,
  digestWorkRecord
} from "../packages/wiki-core/src/index.mjs";
import {
  createWorkRecordGraphImpactSummary
} from "../packages/wiki-core/src/lib/work-record-graph-impact-summary.mjs";

import {
  INITIALIZE_PARAMS,
  cleanupInterfaceSmokeArtifacts,
  createGraphImpactBoundaryFixture,
  createMcpSession,
  withTempDir
} from "./interface-smoke-graph-impact-shared.mjs";

afterEach(cleanupInterfaceSmokeArtifacts);

test("WK-0528 MCP workspace_record_graph_impact_evidence persists graph-impact envelope without shell fallback", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wk0528-graph-impact-demo" });
    const issue = await createWikiRecord({
      dir: tempDir,
      type: "issue",
      title: "Persist graph impact through MCP"
    });

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const tools = (await session.request(2, "tools/list")).tools;
      const tool = tools.find((t) => t.name === "workspace_record_graph_impact_evidence");
      assert.ok(tool, "workspace_record_graph_impact_evidence must be registered");
      assert.equal(
        JSON.stringify(tool.inputSchema).includes("\"dir\""),
        false,
        "workspace_record_graph_impact_evidence must reject caller-supplied filesystem roots"
      );
      assert.equal(
        JSON.stringify(tool.inputSchema).includes("\"cacheDir\""),
        false,
        "workspace_record_graph_impact_evidence must not accept caller-supplied filesystem cache roots"
      );

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

      const persisted = await session.request(3, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: { unit: issue.id, graph_impact: graphImpact }
      });
      assert.equal(persisted.structuredContent.workspaceRepo, "demo");
      assert.equal(persisted.structuredContent.valid, true);
      assert.equal(persisted.structuredContent.written, true);
      assert.equal(persisted.structuredContent.record_id, issue.id);
      assert.equal(persisted.structuredContent.verbose, false, "compact-by-default: verbose must be false");
      assert.equal(
        Object.prototype.hasOwnProperty.call(persisted.structuredContent, "graph_impact"),
        false,
        "compact-by-default: graph_impact alias must be absent"
      );
      assert.ok(persisted.structuredContent.graph_impact_summary);
      assert.equal(
        Object.prototype.hasOwnProperty.call(persisted.structuredContent, "graph_nodes"),
        false,
        "worker-facing graph-impact output must not expose raw graph nodes"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(persisted.structuredContent, "graph_edges"),
        false,
        "worker-facing graph-impact output must not expose raw graph edges"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(persisted.structuredContent, "canonical_refs"),
        false,
        "worker-facing graph-impact output must not expose raw canonical refs"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(persisted.structuredContent.graph_impact_summary, "graph_nodes"),
        false,
        "bounded graph-impact summary must not expose raw graph nodes"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(persisted.structuredContent.graph_impact_summary, "graph_edges"),
        false,
        "bounded graph-impact summary must not expose raw graph edges"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          persisted.structuredContent.graph_impact_summary,
          "canonical_refs"
        ),
        false,
        "bounded graph-impact summary must not expose raw canonical refs"
      );

      const onDisk = JSON.parse(
        await readFile(path.join(tempDir, `wiki/work-records/${issue.id}.json`), "utf8")
      );
      assert.ok(
        Array.isArray(onDisk.derived_evidence) &&
          onDisk.derived_evidence.some(
            (entry) =>
              entry &&
              entry.graph_impact &&
              entry.graph_impact.query_kind === "graph_impact_paths"
          ),
        "graph-impact evidence should be persisted on the work record"
      );

      const rejectedString = await session.request(4, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: { unit: issue.id, graph_impact: JSON.stringify(graphImpact) }
      });
      assert.equal(rejectedString.structuredContent.valid, false);
      assert.ok(
        (rejectedString.structuredContent.diagnostics || []).some(
          (entry) => entry.code === "invalid_record"
        ),
        "stringified graph-impact payload (shell-style) must be rejected as invalid_record"
      );
    } finally {
      await session.close();
    }
  });
});

test("WK-0751 MCP workspace_record_graph_impact_evidence accepts compact graph-impact tool default output (lightweight ref without verbose:true)", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wk0751-compact-graph-impact-demo" });
    const issue = await createWikiRecord({
      dir: tempDir,
      type: "issue",
      title: "WK-0751 compact graph-impact persistence via MCP"
    });
    const sourceRecord = JSON.parse(
      await readFile(path.join(tempDir, `wiki/work-records/${issue.id}.json`), "utf8")
    );
    const sourceRecordDigest = digestWorkRecord(sourceRecord);
    const rawGraphImpact = createGraphImpactBoundaryFixture({
      recordId: issue.id,
      sourceRecordDigest
    });

    const compactSummary = createWorkRecordGraphImpactSummary({
      graph_impact: rawGraphImpact
    });

    const lightweightRef = {
      raw_evidence_digest: `sha256:${"b".repeat(64)}`,
      input_paths: rawGraphImpact.input_paths,
      validated_paths: rawGraphImpact.validated_paths
    };

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const accepted = await session.request(2, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact_summary: compactSummary,
          graph_impact_summary_ref: lightweightRef
        }
      });
      assert.equal(
        accepted.structuredContent.valid,
        true,
        "WK-0751: compact lightweight-ref path must be accepted"
      );
      assert.equal(
        accepted.structuredContent.written,
        true,
        "WK-0751: compact lightweight-ref path must be written"
      );
      assert.ok(
        accepted.structuredContent.graph_impact_summary,
        "WK-0751: persistence response must include a bounded graph_impact_summary"
      );
      assert.ok(
        accepted.structuredContent.graph_impact_summary_ref,
        "WK-0751: persistence response must include a graph_impact_summary_ref"
      );
      assert.equal(
        accepted.structuredContent.graph_impact_summary_ref.raw_evidence_digest,
        lightweightRef.raw_evidence_digest,
        "WK-0751: persisted summary_ref must carry the original raw_evidence_digest"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(accepted.structuredContent, "graph_impact"),
        false,
        "WK-0751: compact-by-default response must not expose the verbose graph_impact alias"
      );

      const onDisk = JSON.parse(
        await readFile(path.join(tempDir, `wiki/work-records/${issue.id}.json`), "utf8")
      );
      const persistedEntry = (onDisk.derived_evidence || []).find(
        (entry) => entry && entry.graph_impact && entry.graph_impact.query_kind === "graph_impact_paths"
      );
      assert.ok(
        persistedEntry,
        "WK-0751: compact lightweight-ref graph-impact must be persisted on the work record"
      );

      assert.equal(
        Object.prototype.hasOwnProperty.call(persistedEntry, "graph_impact_summary"),
        false,
        "WK-0754: inline entry must not retain the full graph_impact_summary"
      );
      assert.ok(
        persistedEntry.graph_impact_summary_ref,
        "WK-0751: persisted entry must retain the compact graph_impact_summary_ref"
      );
      assert.equal(
        persistedEntry.graph_impact_summary_ref.kind,
        "work_record_graph_impact_inline_ref",
        "WK-0754: inline ref is the compact dispatch-readiness pointer"
      );
      assert.equal(
        persistedEntry.graph_impact_summary_ref.raw_evidence_digest,
        lightweightRef.raw_evidence_digest,
        "WK-0751: stored summary_ref must carry raw_evidence_digest"
      );
      assert.equal(
        persistedEntry.graph_impact_summary_ref.unit.address,
        issue.id,
        "WK-0751: stored compact ref must carry server-bound unit address"
      );
      assert.equal(
        persistedEntry.graph_impact_summary_ref.source_record_digest,
        sourceRecordDigest,
        "WK-0751: stored compact ref must carry the record source digest"
      );
    } finally {
      await session.close();
    }
  });
});

test("WK-1380 MCP workspace_read_page reads graph sidecars with default-alias-only omitted repo", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wk1380-graph-sidecar-default-alias-demo" });

    const recordId = "WK-1380";
    const graphSidecar = {
      schema_version: "work-record-graph-evidence-sidecar.v1",
      record_id: recordId,
      generated_at: "2026-07-02T00:00:00Z",
      updated_at: "2026-07-02T00:00:00Z",
      generator: { name: "agent-chassis", version: "0.2.0" },
      record: {
        unit: { kind: "work_item", address: recordId, record_id: recordId, slice_id: null },
        replay_detail_available: true,
        graph_entry_digest: `sha256:${"d".repeat(64)}`,
        graph_impact: {
          query_kind: "graph_impact_paths",
          input_paths: ["packages/wiki-mcp/src/lib/workspace-repo-resolution.mjs"],
          validated_paths: ["packages/wiki-mcp/src/lib/workspace-repo-resolution.mjs"],
          graph_nodes: ["resolver-node"],
          graph_edges: ["resolver-edge"],
          canonical_refs: ["WK-1380"]
        },
        graph_impact_summary: { kind: "graph_impact_agent_summary", query_kind: "graph_impact_paths" }
      },
      slices: {
        "SLICE-005": {
          unit: {
            kind: "slice",
            address: `${recordId}#SLICE-005`,
            record_id: recordId,
            slice_id: "SLICE-005"
          },
          replay_detail_available: true,
          graph_entry_digest: `sha256:${"e".repeat(64)}`,
          graph_impact: {
            query_kind: "graph_impact_paths",
            input_paths: ["tests/interface-smoke-graph-impact-persistence.test.mjs"],
            validated_paths: ["tests/interface-smoke-graph-impact-persistence.test.mjs"],
            graph_nodes: ["smoke-node"],
            graph_edges: ["smoke-edge"],
            canonical_refs: ["WK-1380#SLICE-005"]
          }
        },
        "SLICE-006": {
          unit: {
            kind: "slice",
            address: `${recordId}#SLICE-006`,
            record_id: recordId,
            slice_id: "SLICE-006"
          },
          replay_detail_available: false,
          graph_entry_digest: `sha256:${"f".repeat(64)}`,
          graph_impact_summary_ref: {
            raw_evidence_digest: `sha256:${"c".repeat(64)}`,
            input_paths: ["tests/interface-smoke-work-record-write.test.mjs"],
            validated_paths: ["tests/interface-smoke-work-record-write.test.mjs"]
          }
        }
      }
    };

    const sidecarRelPath = `wiki/work-records/evidence/${recordId}.graph.json`;
    const sidecarAbsPath = path.join(tempDir, sidecarRelPath);
    await mkdir(path.dirname(sidecarAbsPath), { recursive: true });
    await writeFile(sidecarAbsPath, `${JSON.stringify(graphSidecar, null, 2)}\n`, "utf8");

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo",
        WIKI_MCP_WORKSPACE_ALIAS: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const compact = (
        await session.request(2, "tools/call", {
          name: "workspace_read_page",
          arguments: { path: sidecarRelPath }
        })
      ).structuredContent;
      assert.equal(compact.workspaceRepo, "demo");
      assert.equal(compact.format, "graph-evidence-sidecar");
      assert.equal(compact.record_id, recordId);
      assert.match(compact.graph_sidecar_digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(compact.record_entry.available, true);
      assert.equal(compact.record_entry.graph_entry_digest, `sha256:${"d".repeat(64)}`);
      assert.equal(compact.slice_count, 2);
      assert.equal(
        Object.prototype.hasOwnProperty.call(compact, "sidecar"),
        false,
        "compact graph-sidecar read must not expose the full replay sidecar"
      );
      assert.equal(
        JSON.stringify(compact).includes("graph_nodes"),
        false,
        "compact graph-sidecar read must not leak raw graph replay payloads"
      );

      const selectedSlice = (
        await session.request(3, "tools/call", {
          name: "workspace_read_page",
          arguments: { path: sidecarRelPath, selected_slice: "SLICE-005" }
        })
      ).structuredContent;
      assert.equal(selectedSlice.workspaceRepo, "demo");
      assert.equal(selectedSlice.selected_slice_found, true);
      assert.equal(selectedSlice.selected_slice.unit.address, `${recordId}#SLICE-005`);
      assert.ok(
        selectedSlice.selected_slice.graph_impact,
        "selected_slice remains replay/debug detail for the requested sidecar entry"
      );
      assert.equal(
        JSON.stringify(selectedSlice).includes("SLICE-006"),
        false,
        "selected_slice must not leak sibling graph sidecar entries"
      );
    } finally {
      await session.close();
    }
  });
});
