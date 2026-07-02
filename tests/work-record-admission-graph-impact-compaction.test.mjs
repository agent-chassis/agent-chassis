

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_DIRECTORY,
  WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_KIND,
  WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_SCHEMA_VERSION,
  WORK_RECORD_GRAPH_INLINE_REF_KIND,
  buildCompactInlineGraphEvidenceRef,
  buildGraphEvidenceSidecarEntry,
  buildGraphEvidenceSidecarFromEntries,
  computeGraphEvidenceEntryDigest,
  computeGraphEvidenceSidecarDigest,
  createGraphEvidenceSidecar,
  detectGraphEvidenceSidecarSliceKeyCollisions,
  graphEvidenceSidecarPathForRecord,
  normalizeGraphEvidenceSidecar,
  projectGraphEvidenceSidecar,
  projectGraphEvidenceSidecarDefault,
  projectGraphEvidenceSidecarFull,
  projectGraphEvidenceSidecarSelectedRecord,
  projectGraphEvidenceSidecarSelectedSlice,
  resolveGraphEvidenceSidecarEntry,
  serializeGraphEvidenceSidecar,
  upsertGraphEvidenceSidecarEntry,
  validateGraphEvidenceSidecar,
  verifyGraphSidecarEntryForInlineRef
} from "../packages/wiki-core/src/lib/work-record-graph-evidence-sidecar.mjs";

const GENERATED_AT = "2026-05-31T00:00:00Z";

function fullGraphImpact(overrides = {}) {
  return {
    query_kind: "graph_impact_paths",
    source_record_digest: "sha256:source-digest",
    input_paths: ["packages/wiki-core/src/lib/a.mjs", "packages/wiki-core/src/lib/b.mjs"],
    validated_paths: ["packages/wiki-core/src/lib/a.mjs"],
    invalid_paths: ["packages/wiki-core/src/lib/missing.mjs"],
    graph_nodes: [{ id: "a" }, { id: "b" }],
    graph_edges: [{ from: "a", to: "b" }],
    canonical_refs: [{ ref: "WK-0001" }],
    structural_impacts: [{ path: "tests/a.test.mjs" }],
    missing_update_hints: [
      { kind: "missing_test", input_path: "packages/wiki-core/src/lib/a.mjs", missing_surface: "tests/a.test.mjs" }
    ],
    graph_state: {
      graph_available: true,
      dirty_state: "clean",
      staleness: "fresh",
      edge_source: "graph",
      dirty_graph_mode: "off",
      graph_schema_version: "code-index-graph.v1",
      unavailable_paths: []
    },
    ...overrides
  };
}

function sliceUnit(recordId, sliceId) {
  return { kind: "slice", record_id: recordId, slice_id: sliceId, address: `${recordId}#${sliceId}` };
}

test("createGraphEvidenceSidecar emits the v1 schema envelope", () => {
  const sidecar = createGraphEvidenceSidecar("WK-0764", { generatedAt: GENERATED_AT });
  assert.equal(sidecar.schema_version, WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_SCHEMA_VERSION);
  assert.equal(sidecar.kind, WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_KIND);
  assert.equal(sidecar.record_id, "WK-0764");
  assert.equal(sidecar.record, null);
  assert.deepEqual(sidecar.slices, {});
  assert.equal(sidecar.generated_at, GENERATED_AT);
  assert.ok(sidecar.generator.name);
  assert.equal(validateGraphEvidenceSidecar(sidecar).length, 0);
});

test("graphEvidenceSidecarPathForRecord is one file per WK under the evidence dir", () => {
  assert.equal(
    graphEvidenceSidecarPathForRecord("WK-0764"),
    `${WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_DIRECTORY}/WK-0764.graph.json`
  );
  assert.throws(() => graphEvidenceSidecarPathForRecord(""), /requires a non-empty record id/);
  assert.throws(() => graphEvidenceSidecarPathForRecord("../escape"), /unsafe record id/);
});

test("two slice entries land in one sidecar keyed by raw unit.slice_id", () => {
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const b = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-b"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({
    recordId: "WK-0764",
    sliceEntries: [a, b],
    generatedAt: GENERATED_AT
  });
  assert.deepEqual(Object.keys(sidecar.slices).sort(), ["slice-a", "slice-b"]);
  assert.equal(sidecar.slices["slice-a"].unit.address, "WK-0764#slice-a");
  assert.equal(sidecar.slices["slice-b"].unit.address, "WK-0764#slice-b");
});

test("upsert preserves unrelated slice entries and the record entry", () => {
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const recordEntry = buildGraphEvidenceSidecarEntry({
    unit: { kind: "work_item", record_id: "WK-0764", address: "WK-0764" },
    graph_impact: fullGraphImpact(),
    generated_at: GENERATED_AT
  });
  let sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", recordEntry, sliceEntries: [a], generatedAt: GENERATED_AT });

  const b = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-b"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  sidecar = upsertGraphEvidenceSidecarEntry(sidecar, b, { updatedAt: "2026-05-31T02:00:00Z" });

  assert.deepEqual(Object.keys(sidecar.slices).sort(), ["slice-a", "slice-b"]);
  assert.ok(sidecar.record, "record entry preserved");
  assert.equal(sidecar.updated_at, "2026-05-31T02:00:00Z");
});

test("record-level evidence uses the record slot and never the slices map", () => {
  const recordEntry = buildGraphEvidenceSidecarEntry({
    unit: { kind: "work_item", record_id: "WK-0764", address: "WK-0764" },
    graph_impact: fullGraphImpact(),
    generated_at: GENERATED_AT
  });
  assert.equal(recordEntry.unit.kind, "work_item");
  assert.equal(recordEntry.unit.slice_id, null);

  const sidecar = upsertGraphEvidenceSidecarEntry(createGraphEvidenceSidecar("WK-0764", { generatedAt: GENERATED_AT }), recordEntry);
  assert.ok(sidecar.record);
  assert.deepEqual(sidecar.slices, {});

  assert.throws(
    () =>
      buildGraphEvidenceSidecarFromEntries({
        recordId: "WK-0764",
        recordEntry: { unit: sliceUnit("WK-0764", "slice-a") }
      }),
    /record entry must not be a slice unit/
  );
});

test("missing, non-string, and empty slice ids fail closed at entry build", () => {
  for (const badUnit of [
    { kind: "slice", record_id: "WK-0764" },
    { kind: "slice", record_id: "WK-0764", slice_id: "" },
    { kind: "slice", record_id: "WK-0764", slice_id: 123 },
    { kind: "slice", record_id: "WK-0764", slice_id: "   " }
  ]) {
    assert.throws(
      () => buildGraphEvidenceSidecarEntry({ unit: badUnit, graph_impact: fullGraphImpact() }),
      /slice unit requires a non-empty/,
      `expected fail-closed for ${JSON.stringify(badUnit)}`
    );
  }
});

test("duplicate slice ids fail closed in the batch builder and the collision detector", () => {
  const a1 = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const a2 = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact({ query_kind: "graph_impact_diff" }), generated_at: GENERATED_AT });

  const collisions = detectGraphEvidenceSidecarSliceKeyCollisions([a1, a2]);
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].slice_id, "slice-a");
  assert.equal(collisions[0].count, 2);

  assert.throws(
    () => buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [a1, a2] }),
    /duplicate slice keys/
  );
});

test("upsert refuses a slice-key collision where the address disagrees", () => {
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  let sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [a], generatedAt: GENERATED_AT });

  const conflicting = buildGraphEvidenceSidecarEntry({
    unit: { kind: "slice", record_id: "WK-0764", slice_id: "slice-a", address: "WK-0764#other-address" },
    graph_impact: fullGraphImpact(),
    generated_at: GENERATED_AT
  });
  assert.throws(() => upsertGraphEvidenceSidecarEntry(sidecar, conflicting), /collision/);

  const updated = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact({ query_kind: "graph_impact_diff" }), generated_at: "2026-05-31T03:00:00Z" });
  sidecar = upsertGraphEvidenceSidecarEntry(sidecar, updated);
  assert.equal(sidecar.slices["slice-a"].query_kind, "graph_impact_diff");
});

test("full-detail entry preserves graph_impact, summary, embedded ref summary", () => {
  const entry = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  assert.equal(entry.replay_detail_available, true);
  assert.ok(entry.graph_impact, "full raw graph_impact preserved");
  assert.deepEqual(entry.graph_impact.graph_nodes, [{ id: "a" }, { id: "b" }]);
  assert.ok(entry.graph_impact_summary, "bounded summary preserved");
  assert.ok(entry.graph_impact_summary_ref.summary, "ref embeds full summary");

  assert.deepEqual(entry.input_paths, ["packages/wiki-core/src/lib/a.mjs", "packages/wiki-core/src/lib/b.mjs"]);
  assert.deepEqual(entry.validated_paths, ["packages/wiki-core/src/lib/a.mjs"]);
  assert.equal(entry.invalid_path_count, 1);
  assert.equal(entry.graph_state.graph_available, true);
  assert.equal(entry.graph_state.edge_source, "graph");
});

test("compact-only entry sets replay_detail_available:false and fabricates no full replay", () => {
  const entry = buildGraphEvidenceSidecarEntry({
    unit: sliceUnit("WK-0764", "slice-c"),
    graph_impact_summary_ref: {
      kind: "graph_impact_reference",
      source_record_digest: "sha256:source-digest",
      raw_evidence_digest: "sha256:raw-evidence",
      binding_token: "sha256:raw-evidence",
      input_paths: ["packages/wiki-core/src/lib/c.mjs"],
      validated_paths: ["packages/wiki-core/src/lib/c.mjs"]
    },
    generated_at: GENERATED_AT
  });
  assert.equal(entry.replay_detail_available, false);
  assert.equal(entry.graph_impact, undefined, "no fabricated full graph_impact");
  assert.equal(entry.graph_impact_summary_ref.summary, undefined, "no embedded full summary");
  assert.equal(entry.raw_evidence_digest, "sha256:raw-evidence");
  assert.equal(entry.binding_token, "sha256:raw-evidence");
  assert.deepEqual(entry.input_paths, ["packages/wiki-core/src/lib/c.mjs"]);
  assert.deepEqual(entry.graph_impact_summary_ref.input_paths, ["packages/wiki-core/src/lib/c.mjs"]);
});

test("an explicit replay_detail_available:false override is honored even with a raw envelope", () => {
  const entry = buildGraphEvidenceSidecarEntry({
    unit: sliceUnit("WK-0764", "slice-d"),
    graph_impact: fullGraphImpact(),
    replay_detail_available: false,
    generated_at: GENERATED_AT
  });
  assert.equal(entry.replay_detail_available, false);
  assert.equal(entry.graph_impact, undefined);
});

test("an entry requires at least one graph evidence input", () => {
  assert.throws(
    () => buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a") }),
    /requires graph_impact, graph_impact_summary, or graph_impact_summary_ref/
  );
});

test("computeGraphEvidenceEntryDigest is stable, key-order independent, and excludes itself", () => {
  const entry = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const stored = entry.graph_entry_digest;
  assert.match(stored, /^sha256:/);

  assert.equal(computeGraphEvidenceEntryDigest(entry), stored);

  const reordered = {};
  for (const key of Object.keys(entry).reverse()) {
    reordered[key] = entry[key];
  }
  assert.equal(computeGraphEvidenceEntryDigest(reordered), stored);
});

test("a sibling slice update does not change an unrelated entry digest", () => {
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  let sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [a], generatedAt: GENERATED_AT });
  const before = sidecar.slices["slice-a"].graph_entry_digest;
  const fileDigestBefore = computeGraphEvidenceSidecarDigest(sidecar);

  const b = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-b"), graph_impact: fullGraphImpact(), generated_at: "2026-05-31T05:00:00Z" });
  sidecar = upsertGraphEvidenceSidecarEntry(sidecar, b, { updatedAt: "2026-05-31T05:00:00Z" });

  assert.equal(sidecar.slices["slice-a"].graph_entry_digest, before, "entry digest stable");
  assert.notEqual(computeGraphEvidenceSidecarDigest(sidecar), fileDigestBefore, "whole-file digest changes");
});

test("computeGraphEvidenceSidecarDigest matches the serialized file bytes", () => {
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [a], generatedAt: GENERATED_AT });
  const text = serializeGraphEvidenceSidecar(sidecar);
  const expected = `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
  assert.equal(computeGraphEvidenceSidecarDigest(sidecar), expected);

  assert.equal(computeGraphEvidenceSidecarDigest(JSON.parse(text)), expected);
});

test("default projection is compact: ids/counts/digests only, no replay payloads", () => {
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const b = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-b"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const recordEntry = buildGraphEvidenceSidecarEntry({ unit: { kind: "work_item", record_id: "WK-0764", address: "WK-0764" }, graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", recordEntry, sliceEntries: [a, b], generatedAt: GENERATED_AT });

  const projection = projectGraphEvidenceSidecarDefault(sidecar);
  assert.equal(projection.projection, "default");
  assert.equal(projection.record_id, "WK-0764");
  assert.match(projection.graph_sidecar_digest, /^sha256:/);
  assert.equal(projection.slice_count, 2);
  assert.deepEqual(projection.slice_ids, ["slice-a", "slice-b"]);
  assert.equal(projection.record_entry.available, true);
  assert.match(projection.record_entry.graph_entry_digest, /^sha256:/);

  const serialized = JSON.stringify(projection);
  assert.ok(!serialized.includes("graph_nodes"), "default omits graph_nodes");
  assert.ok(!serialized.includes("graph_impact_summary_ref"), "default omits the ref");
  assert.equal(projection.slices["slice-a"].graph_impact, undefined);
});

test("selected_slice returns one entry without sibling entries", () => {
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const b = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-b"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [a, b], generatedAt: GENERATED_AT });

  const projection = projectGraphEvidenceSidecarSelectedSlice(sidecar, "slice-a");
  assert.equal(projection.projection, "selected_slice");
  assert.equal(projection.found, true);
  assert.equal(projection.slice.unit.address, "WK-0764#slice-a");
  assert.ok(projection.slice.graph_impact, "selected slice includes its replay detail");
  assert.ok(!("slices" in projection), "no sibling slices map");
  const serialized = JSON.stringify(projection);
  assert.ok(!serialized.includes("slice-b"), "no sibling slice content");

  const missing = projectGraphEvidenceSidecarSelectedSlice(sidecar, "nope");
  assert.equal(missing.found, false);
  assert.equal(missing.slice, null);
  assert.equal(missing.diagnostics[0].code, "graph_sidecar_slice_not_found");
});

test("selected_record returns only the record entry", () => {
  const recordEntry = buildGraphEvidenceSidecarEntry({ unit: { kind: "work_item", record_id: "WK-0764", address: "WK-0764" }, graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", recordEntry, sliceEntries: [a], generatedAt: GENERATED_AT });

  const projection = projectGraphEvidenceSidecarSelectedRecord(sidecar);
  assert.equal(projection.projection, "selected_record");
  assert.equal(projection.found, true);
  assert.equal(projection.record.unit.kind, "work_item");
  assert.ok(!("slices" in projection), "no slices map in selected_record");

  const empty = projectGraphEvidenceSidecarSelectedRecord(createGraphEvidenceSidecar("WK-0764", { generatedAt: GENERATED_AT }));
  assert.equal(empty.found, false);
  assert.equal(empty.record, null);
  assert.equal(empty.diagnostics[0].code, "graph_sidecar_record_entry_absent");
});

test("full projection returns the entire sidecar", () => {
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [a], generatedAt: GENERATED_AT });
  assert.deepEqual(projectGraphEvidenceSidecarFull(sidecar), sidecar);
});

test("projectGraphEvidenceSidecar dispatches by option and enforces mutual exclusion", () => {
  const a = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const recordEntry = buildGraphEvidenceSidecarEntry({ unit: { kind: "work_item", record_id: "WK-0764", address: "WK-0764" }, graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", recordEntry, sliceEntries: [a], generatedAt: GENERATED_AT });

  assert.equal(projectGraphEvidenceSidecar(sidecar).projection, "default");
  assert.equal(projectGraphEvidenceSidecar(sidecar, { selected_slice: "slice-a" }).projection, "selected_slice");
  assert.equal(projectGraphEvidenceSidecar(sidecar, { selected_record: true }).projection, "selected_record");
  assert.deepEqual(projectGraphEvidenceSidecar(sidecar, { verbose: true }), sidecar);
  assert.deepEqual(projectGraphEvidenceSidecar(sidecar, { include_record: true }), sidecar);
  assert.throws(
    () => projectGraphEvidenceSidecar(sidecar, { selected_slice: "slice-a", selected_record: true }),
    /mutually exclusive/
  );
});

test("buildCompactInlineGraphEvidenceRef carries readiness signal and binds the entry digest", () => {
  const entry = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [entry], generatedAt: GENERATED_AT });
  const sidecarPath = graphEvidenceSidecarPathForRecord("WK-0764");
  const sidecarDigest = computeGraphEvidenceSidecarDigest(sidecar);

  const ref = buildCompactInlineGraphEvidenceRef(sidecar.slices["slice-a"], { sidecarPath, sidecarDigest });
  assert.equal(ref.kind, WORK_RECORD_GRAPH_INLINE_REF_KIND);
  assert.equal(ref.replay_detail_available, true);
  assert.equal(ref.slice_id, "slice-a");
  assert.equal(ref.sidecar_path, sidecarPath);
  assert.equal(ref.graph_sidecar_digest, sidecarDigest, "whole-file digest recorded for diagnostics");
  assert.equal(ref.graph_entry_digest, entry.graph_entry_digest, "routine binding uses the entry digest");

  assert.deepEqual(ref.input_paths, entry.input_paths);
  assert.deepEqual(ref.validated_paths, entry.validated_paths);
  assert.equal(ref.invalid_path_count, 1);
  assert.equal(ref.graph_state.graph_available, true);

  assert.equal(ref.graph_impact, undefined, "inline ref omits the raw graph_impact envelope");
  assert.equal(ref.graph_impact_summary, undefined, "inline ref omits the bounded summary");
  assert.equal(ref.graph_impact_summary_ref, undefined, "inline ref omits the embedded ref");
  assert.ok(Array.isArray(ref.graph_impact?.graph_nodes) === false, "no graph_nodes payload array");
  assert.equal(typeof ref.counts.graph_nodes, "number", "counts carry a node count only");

  const recordRef = buildCompactInlineGraphEvidenceRef(
    buildGraphEvidenceSidecarEntry({ unit: { kind: "work_item", record_id: "WK-0764", address: "WK-0764" }, graph_impact: fullGraphImpact(), generated_at: GENERATED_AT }),
    { sidecarPath, sidecarDigest }
  );
  assert.equal(recordRef.record_entry, true);
  assert.equal(recordRef.slice_id, undefined);
});

test("verifyGraphSidecarEntryForInlineRef confirms a matching entry", () => {
  const entry = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [entry], generatedAt: GENERATED_AT });
  const ref = buildCompactInlineGraphEvidenceRef(sidecar.slices["slice-a"], {
    sidecarPath: graphEvidenceSidecarPathForRecord("WK-0764"),
    sidecarDigest: computeGraphEvidenceSidecarDigest(sidecar)
  });
  const result = verifyGraphSidecarEntryForInlineRef(sidecar, ref);
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
});

test("verifyGraphSidecarEntryForInlineRef fails closed on missing entry, digest mismatch, and absent replay", () => {
  const entry = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [entry], generatedAt: GENERATED_AT });
  const baseRef = buildCompactInlineGraphEvidenceRef(sidecar.slices["slice-a"], {
    sidecarPath: graphEvidenceSidecarPathForRecord("WK-0764"),
    sidecarDigest: computeGraphEvidenceSidecarDigest(sidecar)
  });

  const missing = verifyGraphSidecarEntryForInlineRef(sidecar, { ...baseRef, unit: sliceUnit("WK-0764", "ghost"), slice_id: "ghost" });
  assert.equal(missing.ok, false);
  assert.equal(missing.diagnostics[0].code, "graph_sidecar_entry_missing");

  const mismatch = verifyGraphSidecarEntryForInlineRef(sidecar, { ...baseRef, graph_entry_digest: "sha256:stale" });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.diagnostics.some((d) => d.code === "graph_entry_digest_mismatch"));

  const compactEntry = buildGraphEvidenceSidecarEntry({
    unit: sliceUnit("WK-0764", "slice-a"),
    graph_impact_summary_ref: { kind: "graph_impact_reference", raw_evidence_digest: "sha256:raw" },
    generated_at: GENERATED_AT
  });
  const compactSidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [compactEntry], generatedAt: GENERATED_AT });
  const claimReplay = verifyGraphSidecarEntryForInlineRef(compactSidecar, {
    ...buildCompactInlineGraphEvidenceRef(compactSidecar.slices["slice-a"], {}),
    replay_detail_available: true
  });
  assert.equal(claimReplay.ok, false);
  assert.ok(claimReplay.diagnostics.some((d) => d.code === "graph_sidecar_replay_detail_absent"));
});

test("a hand-edited sidecar entry is rejected by the recompute guard", () => {
  const entry = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", sliceEntries: [entry], generatedAt: GENERATED_AT });
  const ref = buildCompactInlineGraphEvidenceRef(sidecar.slices["slice-a"], {});

  sidecar.slices["slice-a"].query_kind = "tampered";
  const result = verifyGraphSidecarEntryForInlineRef(sidecar, ref);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === "graph_entry_digest_stale"));
});

test("normalizeGraphEvidenceSidecar fails closed on structurally invalid input", () => {
  assert.throws(() => normalizeGraphEvidenceSidecar(null), /invalid graph sidecar/);
  assert.throws(() => normalizeGraphEvidenceSidecar({ schema_version: "wrong", record_id: "WK-0764" }), /invalid graph sidecar/);
  assert.throws(
    () => normalizeGraphEvidenceSidecar({ ...createGraphEvidenceSidecar("WK-0764"), slices: [] }),
    /invalid graph sidecar/
  );

  const sidecar = createGraphEvidenceSidecar("WK-0764", { generatedAt: GENERATED_AT });
  assert.throws(() => normalizeGraphEvidenceSidecar(sidecar, { recordId: "WK-9999" }), /invalid graph sidecar/);
});

test("validateGraphEvidenceSidecar flags slice-key/address disagreement and record-as-slice", () => {
  const sidecar = createGraphEvidenceSidecar("WK-0764", { generatedAt: GENERATED_AT });
  sidecar.slices["slice-a"] = { unit: { kind: "slice", record_id: "WK-0764", slice_id: "different", address: "WK-0764#different" } };
  const diagnostics = validateGraphEvidenceSidecar(sidecar);
  assert.ok(diagnostics.some((d) => d.code === "graph_sidecar_slice_key_address_mismatch"));

  const recordAsSlice = createGraphEvidenceSidecar("WK-0764", { generatedAt: GENERATED_AT });
  recordAsSlice.record = { unit: { kind: "slice", record_id: "WK-0764", slice_id: "x", address: "WK-0764#x" } };
  assert.ok(validateGraphEvidenceSidecar(recordAsSlice).some((d) => d.code === "graph_sidecar_record_entry_is_slice"));
});

test("resolveGraphEvidenceSidecarEntry resolves record-level and slice-level units", () => {
  const recordEntry = buildGraphEvidenceSidecarEntry({ unit: { kind: "work_item", record_id: "WK-0764", address: "WK-0764" }, graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sliceEntry = buildGraphEvidenceSidecarEntry({ unit: sliceUnit("WK-0764", "slice-a"), graph_impact: fullGraphImpact(), generated_at: GENERATED_AT });
  const sidecar = buildGraphEvidenceSidecarFromEntries({ recordId: "WK-0764", recordEntry, sliceEntries: [sliceEntry], generatedAt: GENERATED_AT });

  assert.equal(resolveGraphEvidenceSidecarEntry(sidecar, { kind: "work_item", record_id: "WK-0764" }).unit.kind, "work_item");
  assert.equal(resolveGraphEvidenceSidecarEntry(sidecar, sliceUnit("WK-0764", "slice-a")).unit.address, "WK-0764#slice-a");
  assert.equal(resolveGraphEvidenceSidecarEntry(sidecar, sliceUnit("WK-0764", "ghost")), null);
});
