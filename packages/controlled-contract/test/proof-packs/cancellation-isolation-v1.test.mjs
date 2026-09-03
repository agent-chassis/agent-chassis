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
} from "./cancellation-isolation-v1-adequacy.mjs";
import {
  buildCancellationIsolationFixture
} from "./cancellation-isolation-v1-fixture.mjs";
import {
  executeScenario,
  implementationPassed
} from "./cancellation-isolation-v1-harness.mjs";
import {
  evaluateStableProofPackFixtureV1,
  validateProfileSemanticsV1
} from "../support/stable-v1-proof-pack-runtime.mjs";

const controlledContractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
const packDirectory = path.join(
  controlledContractRoot,
  "certification/profiles/proof.cancellation.isolation/2.0.0"
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
    ({ pattern_id }) => pattern_id !== patternId
  );
  removeSatisfactionPattern(profile, patternId);
  for (const collection of profile.collection_patterns) {
    collection.member_claim_pattern_ids = collection.member_claim_pattern_ids.filter(
      (candidateId) => candidateId !== patternId
    );
  }
  const relationIds = profile.relation_patterns.filter(
    ({ source_claim_pattern_id, target_claim_pattern_id }) =>
      source_claim_pattern_id === patternId || target_claim_pattern_id === patternId
  ).map(({ pattern_id }) => pattern_id);
  profile.relation_patterns = profile.relation_patterns.filter(
    ({ pattern_id }) => !relationIds.includes(pattern_id)
  );
  profile.falsifier_condition_bindings = profile.falsifier_condition_bindings.filter(
    ({ relation_pattern_id }) => !relationIds.includes(relation_pattern_id)
  );
  for (const relationId of relationIds) removeSatisfactionPattern(profile, relationId);
}

function fixtureRoleFor(input, referenceId) {
  return input.reference_bindings.find(
    ({ reference_ids: referenceIds }) => referenceIds.includes(referenceId)
  )?.role;
}

function fixtureClaim(document, patternId) {
  return document.contract.claims.find(
    ({ claim_id: claimId }) => claimId === `claim-${patternId}`
  );
}

function fixtureProposition(document, patternId, { falsifier = false } = {}) {
  return document.contract.propositions.find(({ proposition_id: propositionId }) =>
    propositionId === `prop-${falsifier ? "falsifier-" : ""}${patternId}`
  );
}

function makeAnyPatternSufficient(profile) {
  profile.satisfaction_expression = {
    any_of: structuredClone(profile.satisfaction_expression.all_of)
  };
}

function weakenAggregateProfileSurface(profile, pointer, document) {
  if (pointer === "/claim_patterns") {
    const present = new Set(document.contract.claims.map(
      ({ claim_id: claimId }) => claimId.slice("claim-".length)
    ));
    removeClaimPattern(profile, profile.claim_patterns.find(
      ({ pattern_id: patternId }) => !present.has(patternId)
    ).pattern_id);
    return true;
  }
  if (pointer === "/distinct_reference_role_sets") {
    profile.distinct_reference_role_sets = profile.distinct_reference_role_sets.filter(
      ({ roles }) => !(roles.includes("cancelled_generation") &&
        roles.includes("surviving_generation"))
    );
    return true;
  }
  if (pointer === "/relation_patterns") {
    [profile.relation_patterns[0].target_claim_pattern_id,
      profile.relation_patterns[1].target_claim_pattern_id] =
      [profile.relation_patterns[1].target_claim_pattern_id,
        profile.relation_patterns[0].target_claim_pattern_id];
    const first = profile.claim_patterns.find(
      ({ pattern_id: patternId }) => patternId === "cancellation-verification"
    );
    const second = profile.claim_patterns.find(
      ({ pattern_id: patternId }) => patternId === "state-isolation-verification"
    );
    [first.falsifying_proposition_template, second.falsifying_proposition_template] =
      [second.falsifying_proposition_template, first.falsifying_proposition_template];
    [profile.falsifier_condition_bindings[0].applicability_context,
      profile.falsifier_condition_bindings[1].applicability_context] =
      [profile.falsifier_condition_bindings[1].applicability_context,
        profile.falsifier_condition_bindings[0].applicability_context];
    return true;
  }
  if (pointer === "/falsifier_condition_bindings") {
    const pattern = profile.claim_patterns.find(
      ({ pattern_id: patternId }) => patternId === "cancellation-verification"
    );
    const falsifier = fixtureProposition(
      document, "cancellation-verification", { falsifier: true }
    );
    const roles = falsifier.applicability_context.operand_reference_ids.map(
      (referenceId) => fixtureRoleFor(document.evaluation_input, referenceId)
    );
    pattern.falsifying_proposition_template.applicability_context.operand_roles = roles;
    profile.falsifier_condition_bindings[0].applicability_context.operand_roles = roles;
    return true;
  }
  if (pointer === "/collection_patterns") {
    profile.collection_patterns = [];
    removeSatisfactionPattern(profile, "proof-population");
    return true;
  }
  if (pointer === "/satisfaction_expression") {
    makeAnyPatternSufficient(profile);
    return true;
  }
  return false;
}

function weakenCollectionProfileSurface(profile, pointer) {
  if (!pointer.startsWith("/collection_patterns/0/")) return false;
  const leaf = pointer.split("/").at(-1);
  if (leaf === "collection_kind") {
    profile.collection_patterns[0].collection_kind = "ordered_sequence";
  } else if (leaf === "match_mode") {
    profile.collection_patterns[0].collection_kind = "ordered_sequence";
    profile.collection_patterns[0].match_mode = "subsequence";
  } else if (leaf === "candidate_quantifier") {
    profile.collection_patterns[0].candidate_quantifier = "any";
  } else if (leaf === "collection_purpose") {
    profile.collection_patterns[0].collection_purpose =
      "attack_cancellation_isolation_population";
  } else if (leaf === "member_claim_pattern_ids") {
    profile.collection_patterns[0].member_claim_pattern_ids =
      profile.collection_patterns[0].member_claim_pattern_ids.slice(0, -1);
  } else if (leaf === "required_by_stage") {
    profile.evaluation_stages.push("post_delivery");
    profile.collection_patterns[0].required_by_stage = "post_delivery";
    makeAnyPatternSufficient(profile);
  }
  return true;
}

function weakenRoleProfileSurface(profile, pointer, document) {
  const match = pointer.match(/^\/reference_roles\/(\d+)\/(.+)$/);
  if (!match) return false;
  const index = Number(match[1]);
  const leaf = match[2];
  const role = profile.reference_roles[index].role;
  const binding = document.evaluation_input.reference_bindings.find(
    ({ role: bindingRole }) => bindingRole === role
  );
  const reference = document.contract.references.find(
    ({ reference_id: referenceId }) => referenceId === binding.reference_ids[0]
  );
  if (leaf === "allowed_type_terms") {
    profile.reference_roles[index].allowed_type_terms.push(reference.type_term);
  } else if (leaf === "allowed_identity_kinds") {
    profile.reference_roles[index].allowed_identity_kinds.push(reference.identity.kind);
  } else if (leaf === "cardinality") {
    profile.reference_roles[index].cardinality = "one_or_more";
  }
  return true;
}

function weakenClaimProfileSurface(profile, pointer, document) {
  const match = pointer.match(/^\/claim_patterns\/(\d+)\/(.+)$/);
  if (!match) return false;
  const index = Number(match[1]);
  const tail = match[2];
  const pattern = profile.claim_patterns[index];
  const claim = fixtureClaim(document, pattern.pattern_id);
  const proposition = fixtureProposition(document, pattern.pattern_id);
  const falsifier = fixtureProposition(
    document, pattern.pattern_id, { falsifier: true }
  );
  if (tail === "allowed_modalities") {
    pattern.allowed_modalities.push(claim.modality);
    if (pattern.claim_kind === "verification") {
      for (const relation of profile.relation_patterns) {
        if (relation.role !== "verifies" ||
            relation.source_claim_pattern_id !== pattern.pattern_id) continue;
        const target = profile.claim_patterns.find(
          ({ pattern_id: patternId }) =>
            patternId === relation.target_claim_pattern_id
        );
        target.allowed_modalities.push(claim.modality);
      }
    }
    return true;
  }
  if (tail === "verification_methods") {
    pattern.verification_methods.push(claim.verification_method);
    return true;
  }
  const falsifying = tail.startsWith("falsifying_proposition_template/");
  const prefix = falsifying
    ? "falsifying_proposition_template/" : "proposition_template/";
  const template = falsifying
    ? pattern.falsifying_proposition_template : pattern.proposition_template;
  const actual = falsifying ? falsifier : proposition;
  const relative = tail.slice(prefix.length);
  if (relative === "operator") {
    template.operator = actual.operator;
    if (!falsifying && pattern.claim_kind === "behavior") {
      const relation = profile.relation_patterns.find(
        ({ target_claim_pattern_id: targetId }) => targetId === pattern.pattern_id
      );
      const verifierPattern = profile.claim_patterns.find(
        ({ pattern_id: patternId }) => patternId === relation.source_claim_pattern_id
      );
      const verifierClaim = fixtureClaim(document, relation.source_claim_pattern_id);
      const actualFalsifier = document.contract.propositions.find(
        ({ proposition_id: propositionId }) =>
          propositionId === verifierClaim.falsifying_proposition_id
      );
      verifierPattern.falsifying_proposition_template.operator = actualFalsifier.operator;
    }
  } else if (relative === "subject_role") {
    template.subject_role = fixtureRoleFor(
      document.evaluation_input, actual.subject_reference_id
    );
  } else if ([
    "applicability_context/mode", "applicability_context/operand_roles"
  ].includes(relative)) {
    template.applicability_context.mode = actual.applicability_context.mode;
    template.applicability_context.operand_roles =
      actual.applicability_context.operand_reference_ids.map(
        (referenceId) => fixtureRoleFor(document.evaluation_input, referenceId)
      );
  } else {
    const operandMatch = relative.match(/^operands\/(\d+)\/role$/);
    const operandIndex = Number(operandMatch[1]);
    template.operands[operandIndex].role = fixtureRoleFor(
      document.evaluation_input,
      actual.operands[operandIndex].reference_id
    );
  }
  return true;
}

function weakenProfileForFixture(original, surface, document) {
  const profile = structuredClone(original);
  const pointer = surface.profile_json_pointer;
  const handled = weakenAggregateProfileSurface(profile, pointer, document) ||
    weakenCollectionProfileSurface(profile, pointer) ||
    weakenRoleProfileSurface(profile, pointer, document) ||
    weakenClaimProfileSurface(profile, pointer, document);
  assert.equal(handled, true, `unhandled surface ${surface.surface_id}`);
  return profile;
}

test("cancellation-isolation pack passes executable and fixed controls", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"), readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  const result = await runProofPackAdequacy(packDirectory);
  assert.equal(result.passed, true);
  assert.equal(result.control_count, 95);
  assert.equal(result.negative_fixture_count, 261);
  assert.equal(result.coverage_witness_count, 261);
  assert.equal(result.negative_fixture_results.every(
    ({ outcome }) => outcome === "rejected"
  ), true);
  assert.equal(result.coverage_witness_results.every(
    ({ outcome }) => outcome === "survived"
  ), true);
  assert.deepEqual(result.diagnostics, []);
});

test("isolated cancellation succeeds in three unrelated domains", () => {
  for (const domain of [
    "search_session", "media_transcode", "deployment_rollout"
  ]) {
    const execution = executeScenario({ domain });
    assert.equal(implementationPassed(execution), true, domain);
    const result = evaluateFixture(fixtureForExecution(
      buildCancellationIsolationFixture().profile, execution
    ));
    assert.equal(result.satisfaction, "satisfied", domain);
    assert.deepEqual(result.diagnostics, [], domain);
  }
});

test("executed mutants expose cross-generation interference", () => {
  const strategies = [
    "status_only",
    "wrong_generation_target",
    "cancelled_attempt_continues",
    "shared_state_corruption",
    "shared_authority_revocation",
    "survivor_fails",
    "survivor_result_missing"
  ];
  for (const strategy of strategies) assert.equal(
    implementationPassed(executeScenario({ strategy })), false, strategy
  );
});

test("the status-only contract is valid but profile-unsatisfied", async () => {
  const profile = await readJson("profile.json");
  const fixture = fixtureForExecution(profile, executeScenario({
    strategy: "status_only"
  }));
  const result = evaluateFixture(fixture);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.deepEqual(result.diagnostics, []);
});

test("guarantee-critical identities reject abstract profile terms", () => {
  for (const role of [
    "operation", "cancellation_operation", "cancelled_generation",
    "surviving_generation", "cancelled_attempt", "surviving_attempt",
    "protected_resource", "surviving_authority"
  ]) {
    const fixture = buildCancellationIsolationFixture({
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

test("ordering and falsifiers are independently bound", async () => {
  const profile = await readJson("profile.json");
  const fixture = buildCancellationIsolationFixture({ profile });
  const order = [
    ["cancelled-attempt-precedes-cancellation", "ref-cancelled-attempt", "ref-cancellation-request"],
    ["surviving-attempt-precedes-cancellation", "ref-surviving-attempt", "ref-cancellation-request"],
    ["cancellation-request-precedes-result", "ref-cancellation-request", "ref-cancellation-result"],
    ["cancellation-result-precedes-surviving-result", "ref-cancellation-result", "ref-surviving-result"]
  ];
  for (const [patternId, subject, operand] of order) {
    const proposition = fixture.contract.propositions.find(
      ({ proposition_id }) => proposition_id === `prop-${patternId}`
    );
    assert.equal(proposition.subject_reference_id, subject);
    assert.equal(proposition.operator, "reference:precedes");
    assert.deepEqual(proposition.operands, [{
      kind: "reference", reference_id: operand
    }]);
  }
  assert.equal(new Set(profile.falsifier_condition_bindings.map(
    ({ applicability_context }) => applicability_context.operand_roles[0]
  )).size, 4);
});

test("fixed fixture evaluation is pure and detects role-type broadening", async () => {
  const profile = await readJson("profile.json");
  const fixture = await readJson(
    "negative-fixtures/reject-role-operation-types.json"
  );
  const inputDigest = canonicalDigest({ profile, fixture });
  const canonical = evaluateNegativeContractFixtures(profile, [fixture]);
  assert.deepEqual(canonical.diagnostics, []);
  assert.equal(canonical.results[0].outcome, "rejected");
  assert.equal(canonicalDigest({ profile, fixture }), inputDigest);

  const weakened = structuredClone(profile);
  weakened.reference_roles.find(({ role }) => role === "operation")
    .allowed_type_terms.push("cc:actor");
  assert.equal(
    evaluateNegativeContractFixtures(weakened, [fixture]).results[0].outcome,
    "survived"
  );
});

test("every fixed negative rejects canonically and satisfies its weakened candidate", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"), readJson("adequacy.json")
  ]);
  const repositoryRoot = path.resolve(controlledContractRoot, "../../..");
  const documents = await Promise.all(adequacy.negative_contract_fixtures.map(
    async ({ path: fixturePath }) => JSON.parse(await readFile(
      path.join(repositoryRoot, fixturePath), "utf8"
    ))
  ));
  const byId = new Map(documents.map((document) => [document.fixture_id, document]));
  const canonical = evaluateNegativeContractFixtures(profile, documents, {
    variation_mode: "full_census"
  });
  assert.deepEqual(canonical.diagnostics, []);
  assert.equal(canonical.results.every(({ outcome }) => outcome === "rejected"), true);

  for (const surface of adequacy.guarantee_critical_profile_surfaces) {
    for (const coverage of surface.coverage) {
      for (const fixtureId of coverage.negative_fixture_ids) {
        const document = byId.get(fixtureId);
        assert.ok(document, fixtureId);
        const weakened = weakenProfileForFixture(profile, surface, document);
        assert.deepEqual(
          validateProfileSemanticsV1(weakened), [], fixtureId
        );
        const result = evaluateStableProofPackFixtureV1({
          contract: document.contract,
          profile: weakened,
          evaluation_input: document.evaluation_input
        });
        assert.equal(result.satisfaction, "satisfied", fixtureId);
        assert.deepEqual(result.diagnostics, [], fixtureId);
      }
    }
  }
});

test("every aggregate mechanism has executable discrimination", async () => {
  const original = await readJson("profile.json");
  const mutations = [
    (profile) => removeClaimPattern(
      profile, "cancelled-generation-reaches-cancelled-state"
    ),
    (profile) => removeClaimPattern(profile, "surviving-state-preserved"),
    (profile) => removeClaimPattern(
      profile, "surviving-authority-not-invalidated"
    ),
    (profile) => removeClaimPattern(
      profile, "surviving-result-matches-success-state"
    ),
    (profile) => {
      profile.collection_patterns = [];
      removeSatisfactionPattern(profile, "proof-population");
    },
    (profile) => {
      profile.reference_roles.find(({ role }) => role === "operation")
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
