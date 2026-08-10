import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  positiveControls,
  profileRejectionControls,
  runProofPackAdequacyControls,
  truthfulMutantFixture
} from "./refusal-before-effects-adequacy.mjs";
import {
  REFUSAL_BEFORE_EFFECTS_PROFILE,
  buildRefusalBeforeEffectsFixture
} from "./refusal-before-effects-fixture.mjs";
import {
  EXECUTED_MUTANTS,
  POSITIVE_DOMAINS,
  executeMutant,
  executePositiveDomain
} from "./refusal-before-effects-harness.mjs";
import {
  assertFixedNegativeCorpus,
  removeFirstMissingRelationBranch
} from "../support/fixed-negative-corpus-test-helpers.mjs";
import {
  assessAdequacyRun,
  guaranteeDigest,
  loadProofPack,
  profileDigest,
  runProofPackAdequacy,
  validateProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";
import {
  evaluateVerificationProfileV034,
  validateProfileSchemaV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";

const packDirectory = new URL(
  "../certification/profiles/proof.authorization.refusal-before-effects/1.0.0/",
  import.meta.url
);
const packDirectoryPath = fileURLToPath(packDirectory);
const adequacy = JSON.parse(await readFile(new URL("adequacy.json", packDirectory), "utf8"));

function evaluateFixture(fixture) {
  return evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
}

test("refusal-before-effects profile and adequacy declarations are bound and valid", async () => {
  assert.equal(validateProfileSchemaV034(REFUSAL_BEFORE_EFFECTS_PROFILE), true,
    JSON.stringify(validateProfileSchemaV034.errors));
  assert.deepEqual(validateProfileSemanticsV034(REFUSAL_BEFORE_EFFECTS_PROFILE), []);
  assert.equal(validateProofPackAdequacy(adequacy), true,
    JSON.stringify(validateProofPackAdequacy.errors));
  assert.equal(adequacy.profile_digest, profileDigest(REFUSAL_BEFORE_EFFECTS_PROFILE));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  const pack = await loadProofPack(packDirectoryPath);
  assert.equal(pack.profile_digest, adequacy.profile_digest);
  assert.equal(
    pack.executable_dependency_paths.length,
    adequacy.executable_dependency_digests.length
  );
});

test("refusal fixed negatives kill every fully rebound critical weakening", async () => {
  const result = await runProofPackAdequacy(packDirectoryPath);
  assert.equal(result.passed, true);
  assert.equal(result.negative_fixture_count, 35);
  assert.equal(result.coverage_witness_count, 79);
  const matrix = await assertFixedNegativeCorpus({
    packDirectory: packDirectoryPath,
    expectedFixtureCount: 35,
    expectedSurfaceCount: 78,
    relationMutation: removeFirstMissingRelationBranch
  });
  assert.deepEqual(matrix, { fixture_count: 35, mutation_count: 28 });
});

test("the controlled graph binds occurrence, refusal, temporal interval, population, and falsifiers", () => {
  const profile = REFUSAL_BEFORE_EFFECTS_PROFILE;
  const claimById = new Map(profile.claim_patterns.map((pattern) => [
    pattern.pattern_id, pattern
  ]));
  const write = claimById.get("no-protected-write-before-refusal");
  const mutation = claimById.get("no-protected-mutation-before-refusal");
  assert.equal(claimById.get("attempt-performs-operation")
    .proposition_template.subject_role, "attempt");
  assert.equal(claimById.get("attempt-performs-operation")
    .proposition_template.operands[0].role, "operation");
  assert.equal(claimById.get("refusal-rejects-attempt")
    .proposition_template.operands[0].role, "attempt");
  for (const [pattern, operator] of [
    [write, "reference:writes"],
    [mutation, "reference:mutates"]
  ]) {
    assert.deepEqual(pattern.allowed_modalities, ["MUST_NOT"]);
    assert.equal(pattern.proposition_template.subject_role, "attempt");
    assert.equal(pattern.proposition_template.operator, operator);
    assert.deepEqual(pattern.proposition_template.applicability_context, {
      mode: "before", operand_roles: ["refusal"]
    });
    assert.equal(pattern.proposition_template.operands[0].role, "protected_effects");
  }
  for (const verificationId of [
    "write-prohibition-verification", "mutation-prohibition-verification"
  ]) {
    const verification = claimById.get(verificationId);
    const target = verificationId.startsWith("write") ? write : mutation;
    assert.equal(verification.falsifying_proposition_template.subject_role, "attempt");
    assert.equal(verification.falsifying_proposition_template.operator,
      target.proposition_template.operator);
    assert.deepEqual(verification.falsifying_proposition_template.operands,
      target.proposition_template.operands);
    assert.deepEqual(verification.falsifying_proposition_template.applicability_context,
      target.proposition_template.applicability_context);
  }
  assert.deepEqual(profile.reference_role_count_bindings, [{
    reference_role: "protected_effects", number_role: "protected_effect_count"
  }]);
  assert.deepEqual(profile.collection_patterns.map(({ collection_kind: kind }) => kind), [
    "closed_set"
  ]);
  assert.deepEqual([
    claimById.get("attempt-precedes-protected-interval").proposition_template,
    claimById.get("protected-interval-precedes-refusal").proposition_template
  ].map(({ subject_role: subject, operands }) => [subject, operands[0].role]), [
    ["attempt", "protected_interval"],
    ["protected_interval", "refusal"]
  ]);
});

test("baseline and every legitimate variant satisfy the profile", () => {
  assert.equal(evaluateFixture(buildRefusalBeforeEffectsFixture()).satisfaction, "satisfied");
  const controls = positiveControls(REFUSAL_BEFORE_EFFECTS_PROFILE);
  assert.equal(controls.length, 14);
  for (const control of controls) assert.deepEqual(
    [control.implementation_outcome, control.profile_satisfaction],
    ["passed", "satisfied"],
    control.control_id
  );
});

test("all implementation mutants are killed even when state is rolled back", () => {
  assert.deepEqual(Object.keys(POSITIVE_DOMAINS), [
    "unauthorized-capability-channel-configuration",
    "cross-tenant-record-store-secondary-index",
    "unauthenticated-queue-deduplication"
  ]);
  for (const domainId of Object.keys(POSITIVE_DOMAINS)) {
    assert.equal(executePositiveDomain(domainId).oracle.passed, true, domainId);
  }
  for (const mutantId of Object.keys(EXECUTED_MUTANTS)) {
    const result = executeMutant(mutantId);
    assert.equal(result.oracle.passed, false, mutantId);
    assert.ok(result.oracle.forbidden_effect_count > 0, mutantId);
  }
  const rollback = executeMutant("mutation-followed-by-rollback");
  assert.equal(rollback.execution.state.get(
    rollback.execution.declared.protected_effects[0]
  ), "unchanged");
  assert.equal(rollback.oracle.passed, false);
});

test("one truthful protected-member effect falsifies the population prohibition", () => {
  for (const mutantId of [
    "protected-write-before-refusal", "protected-mutation-before-refusal"
  ]) {
    const result = evaluateFixture(truthfulMutantFixture(
      REFUSAL_BEFORE_EFFECTS_PROFILE, mutantId
    ));
    assert.equal(result.satisfaction, "invalid", mutantId);
    assert.ok(result.diagnostics.some(({ code, diagnostics = [] }) =>
      code === "controlled_contract_invalid" && diagnostics.some(
        ({ code: nestedCode }) => nestedCode === "direct_proposition_contradiction"
      )
    ), mutantId);
  }
});

test("every independently authored attack plan remains non-satisfied", () => {
  const controls = profileRejectionControls(REFUSAL_BEFORE_EFFECTS_PROFILE);
  assert.deepEqual(controls.map(({ control_id: controlId }) => controlId),
    adequacy.required_profile_rejections);
  assert.equal(controls.length, 35);
  for (const control of controls) assert.notEqual(
    control.profile_satisfaction, "satisfied", control.control_id
  );
});

test("the executable adequacy gate reports exact control totals", async () => {
  const result = await runProofPackAdequacy(packDirectoryPath);
  assert.equal(result.passed, true, JSON.stringify(result.diagnostics));
  assert.equal(result.control_count, 59);
  const totals = Object.create(null);
  for (const control of result.observations.controls) {
    totals[control.category] = (totals[control.category] ?? 0) + 1;
  }
  assert.deepEqual({ ...totals }, {
    positive: 14,
    mutant: 4,
    profile_rejection: 35,
    exclusion: 6
  });
});

function removePatterns(profile, patternIds) {
  const removed = new Set(patternIds);
  profile.claim_patterns = profile.claim_patterns.filter(
    ({ pattern_id: patternId }) => !removed.has(patternId)
  );
  profile.relation_patterns = profile.relation_patterns.filter(
    ({ pattern_id: patternId, source_claim_pattern_id: source, target_claim_pattern_id: target }) =>
      !removed.has(patternId) && !removed.has(source) && !removed.has(target)
  );
  profile.falsifier_condition_bindings = profile.falsifier_condition_bindings.filter(
    ({ relation_pattern_id: patternId }) => !removed.has(patternId)
  );
  for (const collection of profile.collection_patterns) {
    collection.member_claim_pattern_ids = collection.member_claim_pattern_ids.filter(
      (patternId) => !removed.has(patternId)
    );
  }
  profile.satisfaction_expression.all_of = profile.satisfaction_expression.all_of.filter(
    ({ pattern: patternId }) => !removed.has(patternId)
  );
  return profile;
}

function removeBehaviorBranch(profile, branch) {
  const ids = branch === "write" ? [
    "no-protected-write-before-refusal",
    "write-prohibition-verification",
    "write-verification-target"
  ] : [
    "no-protected-mutation-before-refusal",
    "mutation-prohibition-verification",
    "mutation-verification-target"
  ];
  return removePatterns(profile, ids);
}

async function semanticAdequacyDiagnostics(profile) {
  const digest = profileDigest(profile);
  const observations = await runProofPackAdequacyControls({ profile });
  observations.profile_digest = digest;
  return assessAdequacyRun({
    profile,
    profile_digest: digest,
    adequacy: { ...structuredClone(adequacy), profile_digest: digest }
  }, observations);
}

test("fully re-digested guarantee-critical weakenings fail the semantic adequacy gate", async () => {
  const simpleRequiredPatterns = [
    "attempt-performs-operation",
    "attempt-uses-subject",
    "subject-unauthorized-for-operation",
    "refusal-rejects-attempt",
    "attempt-precedes-protected-interval",
    "protected-interval-precedes-refusal",
    "protected-effect-population-membership",
    "protected-effect-population-cardinality",
    "verification-observes-exact-proof-subjects"
  ];
  const weakenings = Object.fromEntries(simpleRequiredPatterns.map((patternId) => [
    `remove-${patternId}`,
    (profile) => removePatterns(profile, [patternId])
  ]));
  Object.assign(weakenings, {
    "remove-write-prohibition-branch": (profile) => removeBehaviorBranch(profile, "write"),
    "remove-mutation-prohibition-branch": (profile) =>
      removeBehaviorBranch(profile, "mutation"),
    "remove-complement-policy-selector": (profile) => {
      delete profile.verification_falsifier_policy;
      return profile;
    },
    "remove-role-count-binding": (profile) => {
      profile.reference_role_count_bindings = [];
      return profile;
    },
    "open-proof-population": (profile) => {
      profile.collection_patterns[0].candidate_quantifier = "any";
      return profile;
    },
    "remove-proof-population": (profile) => {
      profile.collection_patterns = [];
      profile.satisfaction_expression.all_of = profile.satisfaction_expression.all_of.filter(
        ({ pattern: patternId }) => patternId !== "proof-population"
      );
      return profile;
    },
    "omit-operation-from-observation": (profile) => {
      const observation = profile.claim_patterns.find(
        ({ pattern_id: patternId }) =>
          patternId === "verification-observes-exact-proof-subjects"
      );
      observation.proposition_template.operands = observation.proposition_template.operands.filter(
        ({ role }) => role !== "operation"
      );
      return profile;
    },
    "omit-attempt-from-observation": (profile) => {
      const observation = profile.claim_patterns.find(
        ({ pattern_id: patternId }) =>
          patternId === "verification-observes-exact-proof-subjects"
      );
      observation.proposition_template.operands = observation.proposition_template.operands.filter(
        ({ role }) => role !== "attempt"
      );
      return profile;
    },
    "omit-refusal-from-observation": (profile) => {
      const observation = profile.claim_patterns.find(
        ({ pattern_id: patternId }) =>
          patternId === "verification-observes-exact-proof-subjects"
      );
      observation.proposition_template.operands = observation.proposition_template.operands.filter(
        ({ role }) => role !== "refusal"
      );
      return profile;
    },
    "omit-protected-effects-from-observation": (profile) => {
      const observation = profile.claim_patterns.find(
        ({ pattern_id: patternId }) =>
          patternId === "verification-observes-exact-proof-subjects"
      );
      observation.proposition_template.operands = observation.proposition_template.operands.filter(
        ({ role }) => role !== "protected_effects"
      );
      return profile;
    }
  });

  for (const [name, mutate] of Object.entries(weakenings)) {
    const weakened = mutate(structuredClone(REFUSAL_BEFORE_EFFECTS_PROFILE));
    assert.equal(validateProfileSchemaV034(weakened), true,
      `${name}: ${JSON.stringify(validateProfileSchemaV034.errors)}`);
    assert.deepEqual(validateProfileSemanticsV034(weakened), [], name);
    const diagnostics = await semanticAdequacyDiagnostics(weakened);
    assert.ok(diagnostics.length > 0, name);
    assert.equal(diagnostics.some(({ code }) => code === "adequacy_run_binding_mismatch"),
      false, name);
  }
});
