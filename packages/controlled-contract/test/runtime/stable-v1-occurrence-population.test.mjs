import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
import {
  INTERNAL_CAPTURE_AUTHORITY,
  evaluateCapturedExactBindingsV1
} from "../../lib/exact-binding.mjs";
import { canonicalJsonBytes, sha256 } from "../../lib/exact-binding-common.mjs";
import {
  executeDeterministicProjection,
  projectDeterministicPopulation,
  projectDeterministicReference
} from "../../lib/deterministic-projection.mjs";
import {
  buildCompletePaginationProfileFixture,
  completeTraversalTraceFixture
} from "../proof-packs/complete-pagination-traversal-v1-fixture.mjs";

const profile = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.pagination.complete-traversal/1.0.0/profile.json",
  import.meta.url
)));
const declaration = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.pagination.complete-traversal/1.0.0/exact-binding.json",
  import.meta.url
)));
const digest = (character) => character.repeat(64);
const exactContext = {
  contract_digest: digest("1"), profile_digest: declaration.profile_digest,
  evaluation_input_digest: digest("3"), vocabulary_version: "0.34.0",
  vocabulary_complete_digest: profile.vocabulary_complete_digest,
  admission_digest: digest("5"),
  exact_binding_declaration_digest: sha256(canonicalJsonBytes(declaration, { file: true })),
  exact_binding_certification_digest: digest("7")
};

function acquiredArtifact(traceFixture) {
  const built = buildCompletePaginationProfileFixture({ profile,
    trace_options: {
      member_ids: traceFixture.population.occurrences.map(
        ({ source_occurrence_id: id }) => id),
      page_sizes: traceFixture.trace.pages.map(({ member_occurrences: members }) => members.length)
    } });
  const input = built.input;
  const auth = traceFixture.authentication.input;
  const projectionBytes = executeDeterministicProjection(
    "mutation-pagination-trace.v1", traceFixture.sources
  );
  const bytesById = new Map([
    ["a-authoritative-population", traceFixture.sources[1]],
    ["b-attempt-binding-witness", auth.attemptBindingWitnessBytes],
    ["c-authentication-witness", auth.authenticationWitnessBytes],
    ["d-source-authentication-witness", auth.sourceAuthenticationWitnessBytes],
    ["e-source-of-record-witness", auth.sourceOfRecordAssignmentWitnessBytes],
    ["f-target-resolution-witness", auth.targetResolutionWitnessBytes],
    ["g-authentication-capture", traceFixture.authentication.resultBytes],
    ["h-equality-policy", traceFixture.sources[3]],
    ["i-mutation-trace", traceFixture.sources[0]],
    ["j-resource-policy", traceFixture.sources[4]],
    ["k-traversal-projection", projectionBytes]
  ]);
  const references = new Map(input.reference_bindings.map(
    ({ role, reference_ids: ids }) => [role, ids]
  ));
  const bindings = declaration.requirements.map((requirement, index) => {
    const bytes = bytesById.get(requirement.requirement_id);
    return {
      binding_id: `binding-${requirement.requirement_id}`,
      requirement_id: requirement.requirement_id,
      capture_id: `capture-${requirement.requirement_id}`,
      binding_kind: requirement.binding_kind,
      media_type: "application/json",
      content_sha256: sha256(bytes),
      source_descriptor_sha256: String((index % 9) + 1).repeat(64),
      byte_length: bytes.byteLength,
      role_coverage: requirement.role_coverage.map((coverage) => ({
        ...coverage,
        reference_ids: coverage.projection === "projection_result_population"
          ? projectDeterministicPopulation(
            "mutation-pagination-trace.v1", bytes, coverage.population_id
          ) : coverage.projection === "projection_result_reference"
            ? [projectDeterministicReference(
              "authentication-provenance-occurrence-capture.v1",
              bytes, coverage.projection_id
            ).reference_id] : [...references.get(coverage.role)]
      }))
    };
  });
  return evaluateCapturedExactBindingsV1({
    declaration, evaluationInput: input, context: exactContext,
    expectedContext: exactContext, bindings, capturedBytesByRequirement: bytesById
  }, INTERNAL_CAPTURE_AUTHORITY);
}

const defaultTrace = completeTraversalTraceFixture({
  member_ids: ["source-alpha", "source-beta"], page_sizes: [1, 1]
});
const source = defaultTrace.population.source_grounded_identity_sha256;
const occurrences = () => [{ source_occurrence_id: "source-alpha", equality_key: "equal-alpha",
  content_sha256: "1".repeat(64) },
{ source_occurrence_id: "source-beta", equality_key: "equal-beta",
  content_sha256: "1".repeat(64) }];
const capture = (trace = defaultTrace) => validateStableOccurrenceCapture(
  trace.population, acquiredArtifact(trace)
);

test("stable occurrence identity is source/id based and independent of content and position", () => {
  const first = buildStableOccurrencePopulation({ population_id: "population-a",
    capture: capture() });
  const reorderedTrace = completeTraversalTraceFixture({
    member_ids: ["source-beta", "source-alpha"], page_sizes: [2]
  });
  const reordered = buildStableOccurrencePopulation({ population_id: "population-b",
    capture: capture(reorderedTrace) });
  assert.deepEqual(first.members.map(({ occurrence_id: id }) => id).sort(),
    reordered.members.map(({ occurrence_id: id }) => id).sort());
  assert.notEqual(first.members[0].occurrence_id, first.members[1].occurrence_id);
  assert.equal(completeTraversalOccurrenceId(source, "source-alpha"),
    first.members[0].occurrence_id);
  const insertedTrace = completeTraversalTraceFixture({
    member_ids: ["source-inserted", "source-alpha", "source-beta"], page_sizes: [3]
  });
  const inserted = buildStableOccurrencePopulation({ population_id: "population-d",
    capture: capture(insertedTrace) });
  assert.equal(inserted.members.find(({ source_occurrence_id: id }) => id === "source-alpha")
    .occurrence_id, first.members[0].occurrence_id);
  assert.notEqual(completeTraversalOccurrenceId(source, "source-alpha"),
    completeTraversalOccurrenceId("b".repeat(64), "source-alpha"));
  assert.notEqual(completeTraversalOccurrenceId(source, "source-alpha"),
    completeTraversalOccurrenceId(source, "source-renamed"));
});

test("occurrence populations refuse duplicate IDs before content and unauthenticated callers", () => {
  const duplicate = occurrences();
  duplicate[1].source_occurrence_id = duplicate[0].source_occurrence_id;
  assert.throws(() => buildStableOccurrencePopulation({ population_id: "population-a",
    capture: validateStableOccurrenceCapture({ ...defaultTrace.population,
      occurrences: duplicate }, acquiredArtifact(defaultTrace)) }),
  (error) => error.code === "stable_occurrence_source_unauthenticated");
  assert.throws(() => buildStableOccurrencePopulation({ population_id: "population-a",
    source_grounded_identity_sha256: source, authenticated: true,
    occurrences: [{ source_occurrence_id: "caller-chosen",
      content_sha256: "2".repeat(64) }] }),
  (error) => error.code === "stable_occurrence_source_unauthenticated");
  assert.throws(() => validateStableOccurrenceCapture(defaultTrace.population,
    structuredClone(acquiredArtifact(defaultTrace))),
  (error) => error.code === "stable_occurrence_source_unauthenticated");

  const fabricatedCaptures = [
    { ...structuredClone(defaultTrace.population),
      source_grounded_identity_sha256: "b".repeat(64) },
    { ...structuredClone(defaultTrace.population), occurrences: [
      { ...defaultTrace.population.occurrences[0], source_occurrence_id: "fabricated" },
      defaultTrace.population.occurrences[1]
    ] },
    { ...structuredClone(defaultTrace.population), occurrences: [
      { ...defaultTrace.population.occurrences[0], content_sha256: "c".repeat(64) },
      defaultTrace.population.occurrences[1]
    ] }
  ];
  for (const fabricated of fabricatedCaptures) assert.throws(
    () => validateStableOccurrenceCapture(fabricated, acquiredArtifact(defaultTrace)),
    (error) => error.code === "stable_occurrence_source_unauthenticated"
  );
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
