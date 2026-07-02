

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import {
  bootstrapRepo
} from "../packages/wiki-core/src/index.mjs";

import {
  INITIALIZE_PARAMS,
  cleanupInterfaceSmokeArtifacts,
  createMcpSession,
  withTempDir
} from "./interface-smoke-graph-impact-shared.mjs";

afterEach(cleanupInterfaceSmokeArtifacts);

test("WK-0754 MCP workspace_read_page reads per-WK graph-evidence sidecars: compact default, selected_slice, selected_record, verbose", async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wk0754-graph-sidecar-read-demo" });

    const recordId = "WK-0764";
    const graphSidecar = {
      schema_version: "work-record-graph-evidence-sidecar.v1",
      record_id: recordId,
      generated_at: "2026-05-31T00:00:00Z",
      updated_at: "2026-05-31T00:00:00Z",
      generator: { name: "agent-chassis", version: "0.2.0" },
      record: {
        unit: { kind: "work_item", address: recordId, record_id: recordId, slice_id: null },
        replay_detail_available: true,
        graph_entry_digest: `sha256:${"d".repeat(64)}`,
        graph_impact: {
          query_kind: "graph_impact_paths",
          input_paths: ["packages/wiki-core/src/x.mjs"],
          validated_paths: ["packages/wiki-core/src/x.mjs"],
          graph_nodes: ["node-1", "node-2"],
          graph_edges: ["edge-1"],
          canonical_refs: ["ref-1"]
        },
        graph_impact_summary: { kind: "graph_impact_agent_summary", query_kind: "graph_impact_paths" }
      },
      slices: {
        "slice-one": {
          unit: {
            kind: "slice",
            address: `${recordId}#slice-one`,
            record_id: recordId,
            slice_id: "slice-one"
          },
          replay_detail_available: true,
          graph_entry_digest: `sha256:${"e".repeat(64)}`,
          graph_impact: {
            query_kind: "graph_impact_paths",
            input_paths: ["packages/wiki-core/src/one.mjs"],
            validated_paths: ["packages/wiki-core/src/one.mjs"],
            graph_nodes: ["node-3"],
            graph_edges: ["edge-2"],
            canonical_refs: ["ref-2"]
          }
        },
        "slice-two": {
          unit: {
            kind: "slice",
            address: `${recordId}#slice-two`,
            record_id: recordId,
            slice_id: "slice-two"
          },
          replay_detail_available: false,
          graph_entry_digest: `sha256:${"f".repeat(64)}`,
          graph_impact_summary_ref: {
            raw_evidence_digest: `sha256:${"c".repeat(64)}`,
            input_paths: ["packages/wiki-core/src/two.mjs"],
            validated_paths: ["packages/wiki-core/src/two.mjs"]
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
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const tools = (await session.request(2, "tools/list")).tools;
      const readPageTool = tools.find((t) => t.name === "workspace_read_page");
      assert.ok(readPageTool, "workspace_read_page must be registered");
      assert.ok(
        JSON.stringify(readPageTool.inputSchema).includes("selected_record"),
        "workspace_read_page inputSchema must expose selected_record"
      );

      const compact = (
        await session.request(3, "tools/call", {
          name: "workspace_read_page",
          arguments: { path: sidecarRelPath }
        })
      ).structuredContent;
      assert.equal(compact.workspaceRepo, "demo");
      assert.equal(compact.format, "graph-evidence-sidecar");
      assert.equal(compact.schema_version, "work-record-graph-evidence-sidecar.v1");
      assert.equal(compact.record_id, recordId);
      assert.match(compact.graph_sidecar_digest, /^sha256:[0-9a-f]{64}$/);
      assert.equal(compact.record_entry.available, true);
      assert.equal(compact.slice_count, 2);
      assert.equal(
        JSON.stringify(compact).includes("graph_nodes"),
        false,
        "compact graph-sidecar read must not leak raw graph nodes"
      );

      const slice = (
        await session.request(4, "tools/call", {
          name: "workspace_read_page",
          arguments: { path: sidecarRelPath, selected_slice: "slice-one" }
        })
      ).structuredContent;
      assert.equal(slice.selected_slice_found, true);
      assert.equal(slice.selected_slice.unit.address, `${recordId}#slice-one`);
      assert.ok(slice.selected_slice.graph_impact);
      assert.equal(
        JSON.stringify(slice).includes("slice-two"),
        false,
        "selected_slice must not leak sibling entries"
      );

      const record = (
        await session.request(5, "tools/call", {
          name: "workspace_read_page",
          arguments: { path: sidecarRelPath, selected_record: true }
        })
      ).structuredContent;
      assert.equal(record.selected_record, true);
      assert.equal(record.record_entry_found, true);
      assert.equal(record.record_entry.unit.address, recordId);
      assert.equal(
        JSON.stringify(record).includes("slice-one"),
        false,
        "selected_record must not leak slice entries"
      );

      const verbose = (
        await session.request(6, "tools/call", {
          name: "workspace_read_page",
          arguments: { path: sidecarRelPath, verbose: true }
        })
      ).structuredContent;
      assert.ok(verbose.sidecar, "verbose must return the full sidecar");
      assert.deepEqual(Object.keys(verbose.sidecar.slices).sort(), ["slice-one", "slice-two"]);

      const mutex = await session.request(7, "tools/call", {
        name: "workspace_read_page",
        arguments: { path: sidecarRelPath, selected_slice: "slice-one", selected_record: true }
      });
      assert.equal(mutex.isError, true);
      assert.match(mutex.content[0].text, /mutually exclusive/);
    } finally {
      await session.close();
    }
  });
});

test("WK-0528 discovery descriptor labels workspace_record_graph_impact_evidence as write-capable agent-safe MCP route", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wk0528-discovery-demo" });

    const session = createMcpSession({
      env: {
        WIKI_MCP_REPOS: JSON.stringify({ demo: tempDir }),
        WIKI_MCP_DEFAULT_REPO: "demo"
      }
    });
    try {
      await session.request(1, "initialize", INITIALIZE_PARAMS);

      const graphEvidenceQuery = await session.request(2, "tools/call", {
        name: "workspace_tools_query",
        arguments: { tool_name: "workspace_record_graph_impact_evidence", verbose: true }
      });
      const graphEvidenceEntry = graphEvidenceQuery.structuredContent.results.find(
        (entry) => entry.tool_name === "workspace_record_graph_impact_evidence"
      );
      assert.ok(graphEvidenceEntry, "workspace_record_graph_impact_evidence must be discoverable");
      assert.equal(graphEvidenceEntry.recommended_route, "mcp");
      assert.equal(graphEvidenceEntry.runtime_posture, "supported");
      assert.equal(graphEvidenceEntry.kind, "mcp_tool");
      assert.ok(graphEvidenceEntry.side_effects.includes("workspace_write"));
      assert.ok(graphEvidenceEntry.side_effects.includes("record_write"));

      const lintQuery = await session.request(3, "tools/call", {
        name: "workspace_tools_query",
        arguments: { tool_name: "workspace_lint_repo", verbose: true }
      });
      const lintEntry = lintQuery.structuredContent.results.find(
        (entry) => entry.tool_name === "workspace_lint_repo"
      );
      assert.ok(lintEntry, "workspace_lint_repo must be discoverable");
      assert.deepEqual(lintEntry.side_effects, ["read_only"]);
      assert.equal(lintEntry.recommended_route, "mcp");
    } finally {
      await session.close();
    }
  });
});
