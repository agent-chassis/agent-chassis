

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

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

test("WK-0528 MCP workspace_record_graph_impact_evidence accepts compact summary/ref bindings and rejects unbound or shared-path handoff evidence", { skip: "WK-1377 pending CCE/no-CCE test-structure refactor" }, async () => {
  await withTempDir(async (tempDir) => {
    await bootstrapRepo({ dir: tempDir, repo: "agent-chassis/wk0528-compact-graph-impact-demo" });
    const issue = await createWikiRecord({
      dir: tempDir,
      type: "issue",
      title: "Persist compact graph impact through MCP"
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
    const compactSummaryRef = {
      raw_evidence_ref: `wk0537-compact-graph-impact-${issue.id}`,
      source_record_digest: sourceRecordDigest,
      summary: compactSummary
    };
    const cloneGraphImpact = (value) => JSON.parse(JSON.stringify(value));

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
          graph_impact_summary_ref: compactSummaryRef
        }
      });
      assert.equal(accepted.structuredContent.valid, true);
      assert.equal(accepted.structuredContent.written, true);
      assert.equal(
        accepted.structuredContent.graph_impact_summary_ref.raw_evidence_ref,
        compactSummaryRef.raw_evidence_ref
      );
      assert.equal(
        accepted.structuredContent.graph_impact_summary_ref.binding_token,
        compactSummaryRef.raw_evidence_ref
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(accepted.structuredContent, "graph_nodes"),
        false,
        "compact worker-facing graph-impact output must not expose raw graph nodes"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(accepted.structuredContent, "graph_edges"),
        false,
        "compact worker-facing graph-impact output must not expose raw graph edges"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(accepted.structuredContent, "canonical_refs"),
        false,
        "compact worker-facing graph-impact output must not expose raw canonical refs"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(accepted.structuredContent, "graph_impact"),
        false,
        "compact-by-default: graph_impact alias must be absent"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(accepted.structuredContent.graph_impact_summary, "graph_nodes"),
        false,
        "graph_impact_summary must stay bounded at the MCP boundary"
      );
      assert.equal(
        accepted.structuredContent.graph_impact_summary.source_record_digest,
        sourceRecordDigest
      );
      assert.equal(
        accepted.structuredContent.graph_impact_summary.graph_quality.degraded_state.kind,
        "dirty_overlay"
      );

      const lightweightAccepted = await session.request(20, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact_summary: compactSummary,
          graph_impact_summary_ref: {
            raw_evidence_ref: `wk0537-lightweight-compact-graph-impact-${issue.id}`,
            source_record_digest: sourceRecordDigest
          }
        }
      });
      assert.equal(lightweightAccepted.structuredContent.valid, true);
      assert.equal(lightweightAccepted.structuredContent.written, true);
      assert.equal(
        lightweightAccepted.structuredContent.graph_impact_summary_ref.summary.unit.address,
        issue.id,
        "persistence route must bind separate graph_impact_summary to lightweight refs"
      );

      const mismatchedUnitSummaryRef = cloneGraphImpact(compactSummaryRef);
      mismatchedUnitSummaryRef.summary.unit = {
        ...mismatchedUnitSummaryRef.summary.unit,
        address: `${issue.id}#other`,
        record_id: issue.id,
        slice_id: null
      };
      const unitMismatch = await session.request(3, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact_summary: compactSummary,
          graph_impact_summary_ref: mismatchedUnitSummaryRef
        }
      });
      assert.equal(unitMismatch.isError, true);
      assert.match(
        unitMismatch.content[0].text,
        /compact graph-impact summary unit must match the requested unit/
      );

      const mismatchedInputPathsSummaryRef = cloneGraphImpact(compactSummaryRef);
      mismatchedInputPathsSummaryRef.input_paths = compactSummaryRef.summary.input_paths;
      mismatchedInputPathsSummaryRef.summary = {
        ...cloneGraphImpact(rawGraphImpact),
        input_paths: [
          "packages/wiki-core/src/lib/work-record-dispatch.mjs",
          "tests/interface-smoke.test.mjs",
          "packages/wiki-core/src/lib/graph-impact-mismatch.mjs"
        ]
      };
      const inputPathsMismatch = await session.request(4, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact_summary: compactSummary,
          graph_impact_summary_ref: mismatchedInputPathsSummaryRef
        }
      });
      assert.equal(inputPathsMismatch.isError, true);
      assert.match(
        inputPathsMismatch.content[0].text,
        /compact graph-impact summaries require raw-evidence provenance binding/
      );

      const mismatchedValidatedPathsSummaryRef = cloneGraphImpact(compactSummaryRef);
      mismatchedValidatedPathsSummaryRef.validated_paths = compactSummaryRef.summary.validated_paths;
      mismatchedValidatedPathsSummaryRef.summary = {
        ...cloneGraphImpact(rawGraphImpact),
        validated_paths: [
          "packages/wiki-core/src/lib/work-record-feature-vector.mjs",
          "tests/interface-smoke.test.mjs",
          "packages/wiki-core/src/lib/graph-impact-mismatch.mjs"
        ]
      };
      const validatedPathsMismatch = await session.request(5, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact_summary: compactSummary,
          graph_impact_summary_ref: mismatchedValidatedPathsSummaryRef
        }
      });
      assert.equal(validatedPathsMismatch.isError, true);
      assert.match(
        validatedPathsMismatch.content[0].text,
        /compact graph-impact summaries require raw-evidence provenance binding/
      );

      const unbound = await session.request(6, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact_summary: compactSummary
        }
      });
      assert.equal(unbound.isError, true);
      assert.match(
        unbound.content[0].text,
        /compact graph-impact summaries require raw-evidence provenance binding/
      );

      const missingInputPathsSummaryRef = cloneGraphImpact(compactSummaryRef);
      missingInputPathsSummaryRef.ref = `wk0537-compact-graph-impact-input-only-${issue.id}`;
      missingInputPathsSummaryRef.artifact_ref = `wk0537-graph-impact-binding-${issue.id}`;
      missingInputPathsSummaryRef.validated_paths = rawGraphImpact.validated_paths;
      const missingInputPaths = await session.request(7, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact_summary: compactSummary,
          graph_impact_summary_ref: missingInputPathsSummaryRef
        }
      });
      assert.equal(missingInputPaths.isError, true);
      assert.match(
        missingInputPaths.content[0].text,
        /compact graph-impact summaries require raw-evidence provenance binding/
      );

      const missingValidatedPathsSummaryRef = cloneGraphImpact(compactSummaryRef);
      missingValidatedPathsSummaryRef.ref = `wk0537-compact-graph-impact-validated-only-${issue.id}`;
      missingValidatedPathsSummaryRef.artifact_ref = `wk0537-graph-impact-binding-${issue.id}`;
      missingValidatedPathsSummaryRef.input_paths = rawGraphImpact.input_paths;
      const missingValidatedPaths = await session.request(8, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact_summary: compactSummary,
          graph_impact_summary_ref: missingValidatedPathsSummaryRef
        }
      });
      assert.equal(missingValidatedPaths.isError, true);
      assert.match(
        missingValidatedPaths.content[0].text,
        /compact graph-impact summaries require raw-evidence provenance binding/
      );

      const pathLikeArtifactRefusal = await session.request(9, "tools/call", {
        name: "workspace_record_graph_impact_evidence",
        arguments: {
          unit: issue.id,
          graph_impact_summary: compactSummary,
          graph_impact_summary_ref: {
            summary: compactSummary,
            artifact_ref: path.join(tempDir, "graph-impact", "handoff.json")
          }
        }
      });
      assert.equal(pathLikeArtifactRefusal.isError, true);
      assert.match(
        pathLikeArtifactRefusal.content[0].text,
        /compact graph-impact summaries require raw-evidence provenance binding/
      );

      const onDisk = JSON.parse(
        await readFile(path.join(tempDir, `wiki/work-records/${issue.id}.json`), "utf8")
      );
      const persistedCompactEntry = (onDisk.derived_evidence || []).find(
        (entry) => entry && entry.graph_impact && entry.graph_impact.query_kind === "graph_impact_paths"
      );
      assert.ok(persistedCompactEntry, "accepted compact graph-impact evidence must remain persisted");
      assert.ok(
        accepted.structuredContent.graph_impact_summary,
        "compact persistence response must include a bounded graph_impact_summary"
      );
      assert.ok(
        accepted.structuredContent.graph_impact_summary_ref,
        "compact persistence response must include a graph_impact_summary_ref"
      );

      assert.equal(
        Object.prototype.hasOwnProperty.call(persistedCompactEntry, "graph_impact_summary"),
        false,
        "WK-0754: inline admission evidence must not retain the full graph_impact_summary"
      );
      assert.ok(
        persistedCompactEntry.graph_impact_summary_ref,
        "persisted admission evidence must retain the compact graph_impact_summary_ref"
      );
      assert.equal(
        persistedCompactEntry.graph_impact_summary_ref.kind,
        "work_record_graph_impact_inline_ref",
        "WK-0754: inline ref is the compact dispatch-readiness pointer"
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(persistedCompactEntry.graph_impact_summary_ref, "summary"),
        false,
        "WK-0754: the compact inline ref must not embed the full summary"
      );
      assert.equal(
        persistedCompactEntry.graph_impact_summary_ref.source_record_digest,
        sourceRecordDigest
      );
      assert.equal(
        persistedCompactEntry.graph_impact_summary_ref.unit.address,
        issue.id
      );
      assert.equal(
        persistedCompactEntry.graph_impact_summary_ref.degraded_state.kind,
        "dirty_overlay"
      );
      assert.match(
        persistedCompactEntry.graph_impact_summary_ref.sidecar_path,
        new RegExp(`wiki/work-records/evidence/${issue.id}\\.graph\\.json$`)
      );
      assert.match(
        persistedCompactEntry.graph_impact_summary_ref.graph_entry_digest,
        /^sha256:[0-9a-f]{64}$/
      );
      assert.deepEqual(persistedCompactEntry.graph_impact.input_paths, []);
      assert.deepEqual(persistedCompactEntry.graph_impact.validated_paths, []);

      const graphSidecar = JSON.parse(
        await readFile(
          path.join(tempDir, persistedCompactEntry.graph_impact_summary_ref.sidecar_path),
          "utf8"
        )
      );
      const graphSidecarEntry = graphSidecar.record;
      assert.ok(graphSidecarEntry, "graph sidecar must carry the record-level entry");
      assert.equal(graphSidecarEntry.replay_detail_available, true);
      assert.equal(
        graphSidecarEntry.graph_impact_summary.graph_quality.degraded_state.kind,
        "dirty_overlay"
      );
    } finally {
      await session.close();
    }
  });
});
