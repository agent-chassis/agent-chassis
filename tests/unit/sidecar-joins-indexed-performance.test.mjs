import assert from "node:assert/strict";
import test from "node:test";

import { joinSidecarPathsToCanonicalRecords } from
  "../../packages/wiki-core/src/lib/sidecar-joins.mjs";

function issue(id, frontmatter = {}) {
  return {
    id,
    title: id,
    relativePath: `wiki/issues/${id}.md`,
    pageKind: "issues",
    frontmatter: { id, title: id, status: "todo", updated: "2026-08-16", ...frontmatter }
  };
}

test("indexed canonical joins avoid corpus products and deduplicate record-wide evidence", () => {
  const paths = Array.from({ length: 299 }, (_, index) =>
    `packages/impact-${String(index).padStart(3, "0")}/src/file.mjs`
  );
  const knownExistingPaths = [
    ...paths.slice(0, 298),
    ...Array.from({ length: 9_102 }, (_, index) => `packages/source-${index}/src/file.mjs`)
  ];
  const canonicalRecords = Array.from({ length: 500 }, (_, index) => issue(`WK-${index}`, {
    write_scope: [
      index < 220 ? `packages/scope-${index}/` : `packages/record-${index}/src/file.mjs`
    ],
    repo_paths: index < paths.length ? [paths[index]] : []
  }));
  canonicalRecords.push(
    issue("WK-INVALID", { repo_paths: ["../escape.mjs"] }),
    issue("WK-STALE", { write_scope: [paths.at(-1)] }),
    issue("WK-SUPPRESSED", {
      retrieval_visibility: "suppressed",
      repo_paths: [paths[0]]
    }),
    {
      id: null,
      title: "Generated catalog",
      relativePath: "wiki/catalog.md",
      pageKind: "wiki",
      frontmatter: {}
    }
  );

  let operations;
  const result = joinSidecarPathsToCanonicalRecords({
    paths,
    canonicalRecords,
    knownExistingPaths,
    operationObserver: (observed) => {
      operations = observed;
    }
  });

  assert.equal(operations.canonical_records_normalized, canonicalRecords.length);
  assert.equal(operations.known_paths_normalized, knownExistingPaths.length);
  assert.equal(operations.canonical_record_path_pair_scans, 0);
  assert.equal(operations.directory_scope_source_path_scans, 0);
  assert.ok(
    operations.indexed_candidate_visits < paths.length * 4,
    JSON.stringify(operations)
  );
  assert.ok(
    operations.directory_prefix_index_lookups < paths.length * 5,
    JSON.stringify(operations)
  );
  const facts = result.derived_evidence.filter((entry) =>
    [
      "sidecar_canonical_join_suppression",
      "sidecar_invalid_join_path",
      "sidecar_stale_write_scope"
    ].includes(entry.kind)
  );
  assert.equal(facts.filter((entry) => entry.record?.id === "WK-INVALID").length, 1);
  assert.equal(facts.filter((entry) => entry.record?.id === "WK-STALE").length, 1);
  assert.equal(facts.filter((entry) => entry.record?.id === "WK-SUPPRESSED").length, 1);
  assert.equal(facts.filter((entry) => entry.reason === "generated_view").length, 1);
});

test("related/depends_on/blocks cycle preserves the captured one-hop result", () => {
  const records = [
    issue("WK-A", { repo_paths: ["packages/app/src/a.mjs"], related: ["WK-B"] }),
    issue("WK-B", { depends_on: ["WK-C"], related: ["WK-D"] }),
    issue("WK-C", { blocks: ["WK-A"] }),
    issue("WK-D", { related: ["WK-B"] })
  ];
  const request = {
    paths: ["packages/app/src/a.mjs"],
    canonicalRecords: records,
    knownExistingPaths: ["packages/app/src/a.mjs"]
  };
  const first = joinSidecarPathsToCanonicalRecords(request);
  const second = joinSidecarPathsToCanonicalRecords(request);
  assert.equal(JSON.stringify(second), JSON.stringify(first));

  assert.deepEqual(first.canonical_refs.map((reference) => reference.id), ["WK-A", "WK-B", "WK-C"]);
  assert.equal(first.canonical_refs.some((reference) => reference.id === "WK-D"), false);
  const captured = first.canonical_refs.map((reference) => ({
    id: reference.id,
    score: reference.score,
    rank: reference.rank,
    provenance: reference.provenance,
    matches: reference.match_explanations.map((match) => ({
      match_type: match.match_type,
      related_id: match.related_id ?? null,
      record_field: match.record_field
    }))
  }));
  assert.deepEqual(captured, [
    {
      id: "WK-A",
      score: 625,
      rank: 1,
      provenance: { source_kind: "issue", canonicality: "canonical", evidence_basis: "path_match" },
      matches: [{ match_type: "exact_path", related_id: null, record_field: "repo_paths" }]
    },
    {
      id: "WK-B",
      score: 275,
      rank: 2,
      provenance: {
        source_kind: "issue",
        canonicality: "canonical",
        evidence_basis: "explicit_metadata"
      },
      matches: [{ match_type: "related_id", related_id: "WK-A", record_field: "related" }]
    },
    {
      id: "WK-C",
      score: 275,
      rank: 3,
      provenance: {
        source_kind: "issue",
        canonicality: "canonical",
        evidence_basis: "explicit_metadata"
      },
      matches: [{ match_type: "related_id", related_id: "WK-A", record_field: "related" }]
    }
  ]);
  assert.equal(new Set(first.canonical_refs.map((reference) => reference.id)).size, 3);
  assert.equal(
    first.canonical_refs.flatMap((reference) => reference.match_explanations)
      .filter((match) => match.match_type === "related_id").length,
    2
  );
});
