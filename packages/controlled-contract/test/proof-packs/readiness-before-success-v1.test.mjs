import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalDigest,
  evaluateNegativeContractFixtures,
  guaranteeDigest,
  profileDigest,
  runProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";
import {
  fixtureForExecution,
  runProofPackAdequacyControls
} from "./readiness-before-success-v1-adequacy.mjs";
import {
  buildReadinessBeforeSuccessFixture
} from "./readiness-before-success-v1-fixture.mjs";
import {
  executeScenario,
  implementationPassed
} from "./readiness-before-success-v1-harness.mjs";
import {
  evaluateStableProofPackFixtureV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";

const controlledContractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
const packDirectory = path.join(
  controlledContractRoot,
  "certification/profiles/proof.readiness.before-success/2.0.0"
);

async function readJson(name) {
  return JSON.parse(await readFile(path.join(packDirectory, name), "utf8"));
}

function evaluateFixture(fixture) {
  return evaluateStableProofPackFixtureV1({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
}

function adequacySubstancePasses(controls) {
  return controls.every((control) => {
    if (control.category === "positive") return
      control.implementation_outcome === "passed" &&
      control.profile_satisfaction === "satisfied";
    if (control.category === "mutant") return
      control.implementation_outcome === "killed" &&
      control.profile_satisfaction !== "satisfied";
    if (control.category === "profile_rejection") return
      control.implementation_outcome === "not_applicable" &&
      control.profile_satisfaction !== "satisfied";
    return control.implementation_outcome === "boundary_demonstrated";
  });
}

function removeSatisfactionPattern(profile, patternId) {
  profile.satisfaction_expression.all_of =
    profile.satisfaction_expression.all_of.filter(
      ({ pattern }) => pattern !== patternId
    );
}

function removeClaimPattern(profile, patternId) {
  profile.claim_patterns = profile.claim_patterns.filter(
    ({ pattern_id: candidateId }) => candidateId !== patternId
  );
  removeSatisfactionPattern(profile, patternId);
  for (const collection of profile.collection_patterns) {
    collection.member_claim_pattern_ids = collection.member_claim_pattern_ids.filter(
      (candidateId) => candidateId !== patternId
    );
  }
  const relationIds = profile.relation_patterns.filter(
    ({ source_claim_pattern_id: source, target_claim_pattern_id: target }) =>
      source === patternId || target === patternId
  ).map(({ pattern_id: relationId }) => relationId);
  profile.relation_patterns = profile.relation_patterns.filter(
    ({ pattern_id: relationId }) => !relationIds.includes(relationId)
  );
  profile.falsifier_condition_bindings = profile.falsifier_condition_bindings.filter(
    ({ relation_pattern_id: relationId }) => !relationIds.includes(relationId)
  );
  for (const relationId of relationIds) removeSatisfactionPattern(profile, relationId);
}

test("readiness-before-success pack passes every executable and fixed control", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"), readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 123);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 87);

  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, { variationMode });
    assert.equal(result.passed, true);
    assert.equal(result.control_count, 58);
    assert.equal(result.negative_fixture_count, 123);
    assert.equal(result.coverage_witness_count, 123);
    assert.equal(result.negative_fixture_results.every(
      ({ outcome }) => outcome === "rejected"
    ), true);
    assert.equal(result.coverage_witness_results.every(
      ({ outcome }) => outcome === "survived"
    ), true);
    assert.deepEqual(result.diagnostics, []);
  }
});

test("readiness is satisfied before and at completion across unrelated domains", () => {
  for (const domain of ["message_broker", "database_pool", "inference_worker"]) {
    for (const timing of ["before", "at"]) {
      const result = evaluateFixture(buildReadinessBeforeSuccessFixture({
        domain, timing
      }));
      assert.equal(result.satisfaction, "satisfied", `${domain}:${timing}`);
      assert.deepEqual(result.diagnostics, [], `${domain}:${timing}`);
    }
  }
});

test("executed mutants distinguish readiness from a success status", () => {
  const expected = new Map([
    ["ready_before_report", true],
    ["ready_at_report", true],
    ["success_status_only", false],
    ["premature_completion", false],
    ["probe_fails", false],
    ["wrong_capability", false],
    ["missing_completion", false],
    ["regress_before_completion", true]
  ]);
  for (const [strategy, passed] of expected) assert.equal(
    implementationPassed(executeScenario({ strategy })), passed, strategy
  );
});

test("the status-only observed contract is unsatisfied", async () => {
  const profile = await readJson("profile.json");
  const execution = executeScenario({ strategy: "success_status_only" });
  const fixture = fixtureForExecution(profile, execution);
  assert.equal(evaluateFixture(fixture).satisfaction, "unsatisfied");
});

test("guarantee-critical roles reject abstract profile-term grounding", () => {
  for (const role of [
    "initialization_operation", "readiness_operation", "capability"
  ]) {
    const fixture = buildReadinessBeforeSuccessFixture({
      role_identity_overrides: {
        [role]: { kind: "profile_term", term: `ungrounded:${role}` }
      }
    });
    const result = evaluateFixture(fixture);
    assert.equal(result.satisfaction, "invalid", role);
    assert.ok(result.diagnostics.some(({ code }) =>
      code === "reference_role_binding_identity_kind_mismatch"
    ), role);
  }
});

test("fixed fixture evaluation is pure and detects a rebound modality weakening", async () => {
  const profile = await readJson("profile.json");
  const fixture = await readJson(
    "negative-fixtures/reject-claim-readiness-probe-targets-capability-modalities.json"
  );
  const inputDigest = canonicalDigest({ profile, fixture });
  const canonical = evaluateNegativeContractFixtures(profile, [fixture]);
  assert.deepEqual(canonical.diagnostics, []);
  assert.equal(canonical.results[0].outcome, "rejected");
  assert.equal(canonicalDigest({ profile, fixture }), inputDigest);

  const weakened = structuredClone(profile);
  weakened.claim_patterns.find(({ pattern_id: patternId }) =>
    patternId === "readiness-probe-targets-capability"
  ).allowed_modalities.push("SHOULD");
  assert.equal(
    evaluateNegativeContractFixtures(weakened, [fixture]).results[0].outcome,
    "survived"
  );
});

test("every aggregate mechanism has executable discrimination", async () => {
  const original = await readJson("profile.json");
  const mutations = [
    (profile) => removeClaimPattern(profile, "readiness-result-matches-expected-state"),
    (profile) => removeClaimPattern(profile, "completion-does-not-precede-readiness-result"),
    (profile) => {
      profile.collection_patterns = [];
      removeSatisfactionPattern(profile, "proof-population");
    },
    (profile) => {
      profile.reference_roles.find(({ role }) => role === "capability")
        .allowed_identity_kinds.push("profile_term");
    },
    ...original.distinct_reference_role_sets.map((_, index) => (profile) => {
      profile.distinct_reference_role_sets.splice(index, 1);
    })
  ];
  for (const mutate of mutations) {
    const profile = structuredClone(original);
    mutate(profile);
    assert.deepEqual(validateProfileSemanticsV1(profile).filter(
      ({ code }) => code === "profile_pattern_stage_unreachable"
    ), []);
    const observations = await runProofPackAdequacyControls({ profile });
    assert.equal(adequacySubstancePasses(observations.controls), false);
  }
});

test("adequacy controls are deterministic", async () => {
  const profile = await readJson("profile.json");
  const first = await runProofPackAdequacyControls({ profile });
  const second = await runProofPackAdequacyControls({ profile });
  assert.deepEqual(first, second);
});
