import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { evaluateStableProofPackFixtureV1 } from
  "../support/stable-v1-proof-pack-runtime.mjs";
import { runProofPackAdequacy } from "../support/proof-pack-adequacy.mjs";
import {
  buildVersionedCursorPaginationFixture
} from "./mutation-pagination-profiles-v1-fixture.mjs";

const packageRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const certificationDirectory = path.join(packageRoot,
  "test/certification/profiles/proof.pagination.versioned-cursor-refusal/2.0.0");
const runtimeDirectory = path.join(packageRoot,
  "profiles/proof.pagination.versioned-cursor-refusal/2.0.0");

async function json(directory, name) {
  return JSON.parse(await readFile(path.join(directory, name), "utf8"));
}

test("versioned cursor profile refuses the exact stale occurrence", async () => {
  const profile = await json(certificationDirectory, "profile.json");
  const fixture = buildVersionedCursorPaginationFixture({ profile });
  assert.equal(evaluateStableProofPackFixtureV1({
    contract: fixture.contract, profile, evaluation_input: fixture.input
  }).satisfaction, "satisfied");

  const prohibitions = profile.claim_patterns.filter(
    ({ pattern_id: id }) => id.startsWith("no-")
  );
  assert.equal(prohibitions.length, 6);
  for (const prohibition of prohibitions) {
    assert.deepEqual(prohibition.allowed_modalities, ["MUST_NOT"]);
    const verification = profile.claim_patterns.find(
      ({ pattern_id: id }) => id === `verify-${prohibition.pattern_id}`
    );
    assert.ok(verification?.falsifying_proposition_template);
    assert.deepEqual(
      verification.falsifying_proposition_template,
      prohibition.proposition_template
    );
  }
});

test("versioned cursor exact declaration binds derived selections and content", async () => {
  const declaration = await json(certificationDirectory, "exact-binding.json");
  assert.deepEqual(declaration.relations.map(
    ({ relation_id: id, operator }) => [id, operator]
  ), [
    ["control-captured-content", "same_content_sha256"],
    ["derive-mutation-pagination-projection", "deterministic_projection"],
    ["primary-captured-content", "distinct_content_sha256"]
  ]);
  const projectedRoles = declaration.requirements.find(
    ({ requirement_id: id }) => id === "f-projection"
  ).role_coverage.map(({ role }) => role);
  for (const role of [
    "traversal", "stale_attempt", "stale_cursor", "relevant_mutation",
    "traversal_source_version", "current_source_version", "refusal",
    "page_result_artifact", "page_return_event", "cursor_advance_event",
    "effect_occurrences", "protected_effects", "control_attempt",
    "unrelated_mutation"
  ]) assert.ok(projectedRoles.includes(role));
});

test("versioned cursor pack passes executable adequacy and admission", async () => {
  const result = await runProofPackAdequacy(certificationDirectory, {
    variationMode: "full_census"
  });
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 33);
  assert.equal(result.negative_fixture_count, 232);
  assert.equal(result.coverage_witness_count, 232);
  const admission = await json(runtimeDirectory, "admission.json");
  assert.ok(admission.explicit_exclusions.includes(
    "standalone-traversal-completeness"
  ));
  assert.equal(admission.exact_binding.relation_operators.includes(
    "distinct_content_sha256"
  ), true);
});
