import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReferenceEqualityNormalizer,
  normalizeStableSet
} from "../../lib/equality-normalization-v1.mjs";
import {
  buildCompletePopulation,
  buildStableOccurrencePopulation,
  validateStableOccurrenceCapture
} from "../../lib/population-semantics-v1.mjs";
import { completeTraversalOccurrenceId } from
  "../../lib/stable-occurrence-identity.mjs";
import { completeTraversalTraceFixture } from
  "../proof-packs/complete-pagination-traversal-v1-fixture.mjs";

const defaultTrace = completeTraversalTraceFixture({
  member_ids: ["source-alpha", "source-beta"], page_sizes: [1, 1]
});
const source = defaultTrace.population.source_grounded_identity_sha256;

test("stable occurrence identity is source/id based and independent of content and position", () => {
  const alpha = completeTraversalOccurrenceId(source, "source-alpha");
  assert.equal(completeTraversalOccurrenceId(source, "source-alpha"), alpha);
  assert.notEqual(alpha, completeTraversalOccurrenceId(source, "source-beta"));
  assert.notEqual(alpha, completeTraversalOccurrenceId("b".repeat(64), "source-alpha"));
  assert.notEqual(alpha, completeTraversalOccurrenceId(source, "source-renamed"));
  const reordered = completeTraversalTraceFixture({
    member_ids: ["source-beta", "source-alpha"], page_sizes: [2]
  });
  assert.equal(reordered.population.source_grounded_identity_sha256, source);
});

test("occurrence captures without a registered acquisition artifact are refused", () => {
  for (const artifact of [undefined, null, {}, { satisfaction: "satisfied",
    provenance: { capture_verified: true }, bindings: [], relation_results: [] }]) {
    assert.throws(() => validateStableOccurrenceCapture(defaultTrace.population, artifact),
      (error) => error.code === "stable_occurrence_source_unauthenticated");
  }
  assert.throws(() => buildStableOccurrencePopulation({ population_id: "population-a",
    source_grounded_identity_sha256: source, authenticated: true,
    occurrences: [{ source_occurrence_id: "caller-chosen",
      content_sha256: "2".repeat(64) }] }),
  (error) => error.code === "stable_occurrence_source_unauthenticated");
  assert.throws(() => validateStableOccurrenceCapture({ ...defaultTrace.population,
    source_grounded_identity_sha256: "b".repeat(64) }, null),
  (error) => error.code === "stable_occurrence_source_unauthenticated");
});

test("set normalization is order invariant while complete empty requires authority", () => {
  assert.deepEqual(normalizeStableSet(["beta", "alpha"]),
    normalizeStableSet(["alpha", "beta"]));
  const equality = buildReferenceEqualityNormalizer([["ref-z", "ref-a"]]);
  assert.equal(equality.equivalent("ref-z", "ref-a"), true);
  const empty = buildCompletePopulation({ population_id: "empty", completeness: "exact",
    authenticated: true, members: [] });
  assert.equal(empty.cardinality, 0);
  assert.throws(() => buildCompletePopulation({ population_id: "empty",
    completeness: "unknown", authenticated: true, members: [] }),
  (error) => error.code === "stable_population_authority_required");
});

test("occurrence and equality identities ignore locale and timezone state", () => {
  const priorTimezone = process.env.TZ;
  const priorLanguage = process.env.LANG;
  const baseline = completeTraversalOccurrenceId(source, "source-alpha");
  try {
    process.env.TZ = "Pacific/Kiritimati";
    process.env.LANG = "tr_TR.UTF-8";
    assert.equal(completeTraversalOccurrenceId(source, "source-alpha"), baseline);
    assert.deepEqual(normalizeStableSet(["z", "I", "i"]), ["I", "i", "z"]);
  } finally {
    if (priorTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = priorTimezone;
    if (priorLanguage === undefined) delete process.env.LANG;
    else process.env.LANG = priorLanguage;
  }
});
