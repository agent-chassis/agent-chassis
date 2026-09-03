import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../../lib/exact-binding-common.mjs";
import {
  canonicalDigest
} from "../support/proof-pack-adequacy.mjs";
import { evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { buildCompletePaginationProfileFixture } from
  "./complete-pagination-traversal-v1-fixture.mjs";

const packageRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const runtimeDirectory = path.join(packageRoot,
  "profiles/proof.pagination.complete-traversal/2.0.0");
const certificationDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.pagination.complete-traversal/2.0.0");

async function json(directory, name) {
  return JSON.parse(await readFile(path.join(directory, name), "utf8"));
}

test("complete traversal profile evaluates the authenticated exact positive contract", async () => {
  const profile = await json(runtimeDirectory, "profile.json");
  const fixture = buildCompletePaginationProfileFixture({ profile });
  assert.equal(evaluateStableProofPackFixtureV1({
    contract: fixture.contract, profile, evaluation_input: fixture.input
  }).satisfaction, "satisfied");
  assert.deepEqual(fixture.projection.ordered_occurrences.authoritative_occurrence_ids,
    fixture.projection.ordered_occurrences.returned_occurrence_ids);
});

test("empty and singleton traversals satisfy with their truthful zero transitions", async () => {
  const profile = await json(runtimeDirectory, "profile.json");
  for (const options of [
    { member_ids: [], page_sizes: [0] },
    { member_ids: ["member-alpha"], page_sizes: [1] }
  ]) {
    const fixture = buildCompletePaginationProfileFixture({ profile, trace_options: options });
    assert.equal(fixture.traceFixture.trace.transitions.length, 0);
    const transitionBinding = fixture.input.reference_bindings.find(
      ({ role }) => role === "cursor_transitions"
    );
    assert.deepEqual(transitionBinding.reference_ids, []);
    assert.equal(evaluateStableProofPackFixtureV1({
      contract: fixture.contract, profile, evaluation_input: fixture.input
    }).satisfaction, "satisfied");
  }
});

test("empty binding permission does not weaken required bindings", async () => {
  const profile = await json(runtimeDirectory, "profile.json");
  for (const mutation of [
    (input) => {
      input.reference_bindings = input.reference_bindings.filter(
        ({ role }) => role !== "returned_pages"
      );
    },
    (input) => {
      input.reference_bindings.find(
        ({ role }) => role === "returned_pages"
      ).reference_ids = [];
    }
  ]) {
    const fixture = buildCompletePaginationProfileFixture({
      profile,
      trace_options: { member_ids: [], page_sizes: [0] },
      mutate_input(input) {
        mutation(input);
      }
    });
    const result = evaluateStableProofPackFixtureV1({
      contract: fixture.contract, profile, evaluation_input: fixture.input
    });
    assert.notEqual(result.satisfaction, "satisfied");
  }
});

test("complete traversal freezes the full positive, mutant, and weakening census", async () => {
  const result = await json(certificationDirectory, "certification-result.full-census.json");
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 49);
  assert.equal(result.observations.controls.filter(
    ({ category }) => category === "positive"
  ).length, 8);
  assert.equal(result.observations.controls.filter(
    ({ category, profile_satisfaction: satisfaction }) =>
      category === "positive" && satisfaction === "satisfied"
  ).length, 8);
  assert.equal(result.observations.controls.filter(
    ({ category }) => category === "mutant"
  ).length, 24);
  assert.equal(result.observations.controls.filter(
    ({ category }) => category === "profile_rejection"
  ).length, 9);
  assert.equal(result.observations.controls.filter(
    ({ category }) => category === "exclusion"
  ).length, 8);
  assert.equal(result.observations.controls.some(({ implementation_outcome: outcome }) =>
    outcome === "survived" || outcome === "failed"), false);
});

test("complete traversal admission binds adequacy and exact certification bytes", async () => {
  const admission = await json(runtimeDirectory, "admission.json");
  const adequacyBytes = await readFile(path.join(certificationDirectory, "adequacy.json"));
  const adequacy = JSON.parse(adequacyBytes);
  const result = await json(certificationDirectory,
    "certification-result.full-census.json");
  const corpusBytes = await readFile(path.join(
    certificationDirectory, "exact-binding-corpus.json"
  ));
  assert.equal(admission.certification.adequacy_declaration_digest,
    canonicalDigest(adequacy));
  assert.equal(admission.certification.adequacy_result_digest,
    canonicalDigest(result));
  assert.equal(admission.certification.executable_control_count, 49);
  assert.equal(result.negative_fixture_count, 0);
  assert.deepEqual(result.negative_fixture_results, []);
  assert.equal(adequacy.execution_control_witnesses.length, 33);
  assert.equal(result.observations.controls.filter(({ category }) =>
    category === "mutant" || category === "profile_rejection").length, 33);
  assert.equal(admission.certification.negative_fixture_count, 0);
  assert.equal(admission.certification.coverage_witness_count, 33);
  assert.equal(admission.exact_binding.corpus_digest, sha256(corpusBytes));
  assert.equal(admission.exact_binding.executable_control_count, 12);
});

test("complete traversal is one member of the complete stable catalog", async () => {
  const [runtimeCatalog, certificationCatalog, intentCatalog] = await Promise.all([
    json(path.join(packageRoot, "profiles"), "catalog.json"),
    json(path.join(packageRoot, "test/certification/profiles"), "catalog.json"),
    json(path.join(packageRoot, "proof-intents"), "catalog.json")
  ]);
  assert.deepEqual(certificationCatalog, runtimeCatalog);
  assert.equal(runtimeCatalog.packs.length, 38);
  assert.equal(runtimeCatalog.packs.filter(({ profile_id: id, profile_version: version }) =>
    id === "proof.pagination.complete-traversal" && version === "2.0.0"
  ).length, 1);
  assert.equal(intentCatalog.intents.length, 38);
  assert.equal(intentCatalog.intents.reduce(
    (sum, intent) => sum + intent.capable_packs.length, 0), 40);
});

test("current pagination runtime carriers equal their certification copies", async () => {
  for (const id of [
    "proof.pagination.complete-traversal",
    "proof.pagination.snapshot-consistency",
    "proof.pagination.versioned-cursor-refusal"
  ]) {
    for (const file of ["profile.json", "admission.json"]) {
      const [runtimeBytes, certificationBytes] = await Promise.all([
        readFile(path.join(packageRoot, "profiles", id, "2.0.0", file)),
        readFile(path.join(packageRoot, "test/certification/profiles", id, "2.0.0", file))
      ]);
      assert.deepEqual(runtimeBytes, certificationBytes, `${id}/${file}`);
    }
  }
});
