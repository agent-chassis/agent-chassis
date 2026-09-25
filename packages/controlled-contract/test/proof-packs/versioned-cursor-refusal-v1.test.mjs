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
import { certificationDirectory as certificationDirectoryOf, readDefinitionDocument } from "../support/certification-artifact.mjs";

const packageRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const identity = { profile_id: "proof.pagination.versioned-cursor-refusal", profile_version: "4.0.0" };
const certificationDirectory = certificationDirectoryOf(identity);
const runtimeDirectory = path.join(packageRoot,
  "profiles/proof.pagination.versioned-cursor-refusal/4.0.0");

async function json(directory, name) {
  return JSON.parse(await readFile(path.join(directory, name), "utf8"));
}

test("versioned cursor profile refuses the exact stale occurrence", async () => {
  const profile = await json(runtimeDirectory, "profile.json");
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
});
