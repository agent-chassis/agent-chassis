import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalDigest,
  evaluateNegativeContractFixtures,
  profileDigest,
  validateGenericCoverageDeclaration,
  validateProofPackAdequacy
} from "./proof-pack-adequacy.mjs";
import {
  validateProfileSchemaV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

function removeExpressionPatterns(expression, removed) {
  if (expression.pattern) return removed.has(expression.pattern) ? null : expression;
  const key = expression.all_of ? "all_of" : "any_of";
  const children = expression[key]
    .map((child) => removeExpressionPatterns(child, removed))
    .filter(Boolean);
  if (children.length === 0) return null;
  return { [key]: children };
}

function removeProfilePatterns(profile, patternIds) {
  const removed = new Set(patternIds);
  const removedRelations = profile.relation_patterns.filter(
    ({ source_claim_pattern_id: source, target_claim_pattern_id: target }) =>
      removed.has(source) || removed.has(target)
  ).map(({ pattern_id: id }) => id);
  for (const id of removedRelations) removed.add(id);
  profile.claim_patterns = profile.claim_patterns.filter(
    ({ pattern_id: id }) => !removed.has(id)
  );
  profile.relation_patterns = profile.relation_patterns.filter(
    ({ pattern_id: id }) => !removed.has(id)
  );
  profile.falsifier_condition_bindings = profile.falsifier_condition_bindings.filter(
    ({ relation_pattern_id: id }) => !removed.has(id)
  );
  profile.reference_binding_patterns = profile.reference_binding_patterns.filter(
    ({ pattern_id: id }) => !removed.has(id)
  );
  profile.collection_patterns = profile.collection_patterns
    .map((collection) => ({
      ...collection,
      member_claim_pattern_ids: collection.member_claim_pattern_ids.filter(
        (id) => !removed.has(id)
      )
    }))
    .filter((collection) => {
      if (collection.member_claim_pattern_ids.length > 0) return true;
      removed.add(collection.pattern_id);
      return false;
    });
  profile.satisfaction_expression = removeExpressionPatterns(
    profile.satisfaction_expression, removed
  );
  return profile;
}

function pointerValue(document, pointer) {
  let value = document;
  for (const encoded of pointer.slice(1).split("/")) {
    const token = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(value)) value = value[Number(token)];
    else value = value?.[token];
  }
  return value;
}

function retargetCoverageDeclaration(originalProfile, candidateProfile, adequacy) {
  const declaration = structuredClone(adequacy);
  declaration.profile_digest = profileDigest(candidateProfile);
  const retargetClaimPointer = (pointer) => {
    const claimMatch = pointer.match(/^\/claim_patterns\/(\d+)(\/.*)$/u);
    if (!claimMatch) return pointer;
    const patternId = originalProfile.claim_patterns[Number(claimMatch[1])].pattern_id;
    const index = candidateProfile.claim_patterns.findIndex(
      ({ pattern_id: id }) => id === patternId
    );
    return index < 0 ? null : `/claim_patterns/${index}${claimMatch[2]}`;
  };
  declaration.guarantee_critical_profile_surfaces = declaration
    .guarantee_critical_profile_surfaces.flatMap((surface) => {
      let pointer = retargetClaimPointer(surface.profile_json_pointer);
      if (pointer === null) return [];
      const roleMatch = pointer.match(/^\/reference_roles\/(\d+)\/(.+)$/u);
      if (roleMatch) {
        const role = originalProfile.reference_roles[Number(roleMatch[1])].role;
        const index = candidateProfile.reference_roles.findIndex(
          ({ role: id }) => id === role
        );
        if (index < 0) return [];
        pointer = `/reference_roles/${index}/${roleMatch[2]}`;
      }
      const value = pointerValue(candidateProfile, pointer);
      if (value === undefined) return [];
      return [{
        ...surface,
        profile_json_pointer: pointer,
        surface_digest: canonicalDigest(value)
      }];
    });
  declaration.noncritical_profile_surfaces = declaration.noncritical_profile_surfaces.flatMap(
    (surface) => {
      const pointer = retargetClaimPointer(surface.profile_json_pointer);
      if (pointer === null) return [];
      const value = pointerValue(candidateProfile, pointer);
      if (value === undefined) return [];
      return [{
        ...surface,
        profile_json_pointer: pointer,
        surface_digest: canonicalDigest(value)
      }];
    }
  );
  const fixtureIds = new Set(declaration.guarantee_critical_profile_surfaces.flatMap(
    ({ coverage }) => coverage.flatMap(
      ({ negative_fixture_ids: ids }) => ids
    )
  ));
  declaration.negative_contract_fixtures = declaration.negative_contract_fixtures.filter(
    ({ fixture_id: id }) => fixtureIds.has(id)
  );
  const reboundFixtureId = declaration.negative_contract_fixtures[0].fixture_id;
  declaration.noncritical_profile_surfaces = declaration.noncritical_profile_surfaces.filter(
    (surface) => {
      if (!surface.reason.startsWith("redundant_with_")) return true;
      declaration.guarantee_critical_profile_surfaces.push({
        surface_id: surface.surface_id,
        profile_json_pointer: surface.profile_json_pointer,
        surface_digest: canonicalDigest(pointerValue(
          candidateProfile, surface.profile_json_pointer
        )),
        coverage: [{
          weakening_class: "binding_constraint_weakening",
          negative_fixture_ids: [reboundFixtureId]
        }]
      });
      return false;
    }
  );
  for (let index = 0; index < candidateProfile.reference_roles.length; index += 1) {
    if (candidateProfile.reference_roles[index].cardinality !== "exactly_one") continue;
    const mutant = structuredClone(candidateProfile);
    mutant.reference_roles[index].cardinality = "one_or_more";
    if (validateProfileSemanticsV034(mutant).length > 0) continue;
    const pointer = `/reference_roles/${index}/cardinality`;
    if (declaration.guarantee_critical_profile_surfaces.some(
      ({ profile_json_pointer: declared }) => declared === pointer
    )) continue;
    declaration.guarantee_critical_profile_surfaces.push({
      surface_id: `emergent-role-${candidateProfile.reference_roles[index].role.replaceAll("_", "-")}-cardinality`,
      profile_json_pointer: pointer,
      surface_digest: canonicalDigest(candidateProfile.reference_roles[index].cardinality),
      coverage: [{
        weakening_class: "cardinality_broadening",
        negative_fixture_ids: [reboundFixtureId]
      }]
    });
  }
  assert.equal(validateProofPackAdequacy(declaration), true,
    JSON.stringify(validateProofPackAdequacy.errors));
  validateGenericCoverageDeclaration(candidateProfile, declaration);
  return declaration;
}

function inferFixtureMutation(profile, fixture, relationMutation) {
  const weakeningClass = fixture.covers[0].weakening_class;
  const candidate = structuredClone(profile);
  if (fixture.fixture_id.startsWith("reject-any-")) {
    const patternId = fixture.fixture_id.slice("reject-any-".length);
    const collection = candidate.collection_patterns.find(
      ({ pattern_id: id }) => id === patternId
    );
    if (collection) {
      collection.candidate_quantifier = "any";
      return candidate;
    }
  }
  if (fixture.fixture_id.startsWith("reject-unscoped-falsifier-")) {
    const patternId = fixture.fixture_id.slice("reject-unscoped-falsifier-".length);
    const claim = candidate.claim_patterns.find(({ pattern_id: id }) => id === patternId);
    assert.ok(claim?.falsifying_proposition_template, fixture.fixture_id);
    const relationIds = new Set(candidate.relation_patterns.filter(
      ({ source_claim_pattern_id: id }) => id === patternId
    ).map(({ pattern_id: id }) => id));
    const context = { mode: "unconditional", operand_roles: [] };
    claim.falsifying_proposition_template.applicability_context = structuredClone(context);
    for (const binding of candidate.falsifier_condition_bindings) {
      if (relationIds.has(binding.relation_pattern_id)) {
        binding.applicability_context = structuredClone(context);
      }
    }
    return candidate;
  }
  if (fixture.fixture_id === "reject-unbound-reference-count") {
    candidate.reference_role_count_bindings = [];
    return candidate;
  }
  if (fixture.fixture_id === "reject-collapsed-distinct-reference-roles") {
    candidate.distinct_reference_role_sets = [];
    return candidate;
  }
  if (fixture.fixture_id === "reject-distinct-replay-input") {
    const removed = new Set(candidate.reference_binding_patterns.map(
      ({ pattern_id: id }) => id
    ));
    candidate.reference_binding_patterns = [];
    candidate.satisfaction_expression = removeExpressionPatterns(
      candidate.satisfaction_expression, removed
    );
    return candidate;
  }
  if (weakeningClass === "deletion") {
    const pattern = profile.claim_patterns.find(({ pattern_id: id }) =>
      fixture.fixture_id === `reject-deleted-claim-${id}`
    );
    assert.ok(pattern, fixture.fixture_id);
    return removeProfilePatterns(candidate, [pattern.pattern_id]);
  }
  if (weakeningClass === "modality_broadening") {
    for (const coverage of fixture.covers) {
      const surface = coverage.surface_id;
      const pattern = candidate.claim_patterns.find(({ pattern_id: id }) =>
        surface === `claim-${id}-modalities`
      );
      assert.ok(pattern, surface);
      const claim = fixture.contract.claims.find(
        ({ claim_id: id }) => id === `claim-${pattern.pattern_id}`
      );
      assert.ok(claim, surface);
      if (!pattern.allowed_modalities.includes(claim.modality)) {
        pattern.allowed_modalities.push(claim.modality);
      }
    }
    return candidate;
  }
  if (weakeningClass === "type_broadening") {
    for (const coverage of fixture.covers) {
      const role = candidate.reference_roles.find(({ role: id }) =>
        coverage.surface_id === `role-${id.replaceAll("_", "-")}-types`
      );
      assert.ok(role, coverage.surface_id);
      const binding = fixture.evaluation_input.reference_bindings.find(
        ({ role: id }) => id === role.role
      );
      for (const referenceId of binding.reference_ids) {
        const type = fixture.contract.references.find(
          ({ reference_id: id }) => id === referenceId
        )?.type_term;
        if (type && !role.allowed_type_terms.includes(type)) role.allowed_type_terms.push(type);
      }
    }
    return candidate;
  }
  if (weakeningClass === "relation_weakening") {
    return relationMutation(candidate, fixture, removeProfilePatterns);
  }
  if (weakeningClass === "collection_weakening") {
    const removed = new Set(candidate.collection_patterns.map(({ pattern_id: id }) => id));
    candidate.collection_patterns = [];
    candidate.satisfaction_expression = removeExpressionPatterns(
      candidate.satisfaction_expression, removed
    );
    return candidate;
  }
  if (weakeningClass === "satisfaction_branch_broadening") {
    candidate.satisfaction_expression = {
      any_of: structuredClone(candidate.satisfaction_expression.all_of)
    };
    return candidate;
  }
  assert.fail(`unsupported weakening ${weakeningClass}`);
}

async function readFixedCorpus(packDirectory) {
  const [profile, adequacy] = await Promise.all([
    readFile(path.join(packDirectory, "profile.json"), "utf8").then(JSON.parse),
    readFile(path.join(packDirectory, "adequacy.json"), "utf8").then(JSON.parse)
  ]);
  const fixtures = await Promise.all(adequacy.negative_contract_fixtures.map(
    ({ path: fixturePath }) => readFile(
      path.resolve(repositoryRoot, fixturePath), "utf8"
    ).then(JSON.parse)
  ));
  return { profile, adequacy, fixtures };
}

async function assertFixedNegativeCorpus({
  packDirectory,
  expectedFixtureCount,
  expectedSurfaceCount,
  relationMutation
}) {
  const { profile, adequacy, fixtures } = await readFixedCorpus(packDirectory);
  assert.equal(fixtures.length, expectedFixtureCount);
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, expectedSurfaceCount);
  assert.equal(fixtures.every((fixture) => !Object.hasOwn(fixture, "profile")), true);
  const canonicalInputDigest = canonicalDigest({ profile, fixtures });
  const canonical = evaluateNegativeContractFixtures(profile, fixtures);
  assert.deepEqual(canonical.diagnostics, []);
  assert.equal(canonical.results.every(({ outcome }) => outcome === "rejected"), true);
  const reordered = evaluateNegativeContractFixtures(profile, [...fixtures].reverse());
  assert.deepEqual(
    reordered.results.sort((left, right) =>
      left.fixture_id < right.fixture_id ? -1 : left.fixture_id > right.fixture_id ? 1 : 0
    ),
    structuredClone(canonical.results).sort(
      (left, right) =>
        left.fixture_id < right.fixture_id ? -1 : left.fixture_id > right.fixture_id ? 1 : 0
    )
  );
  assert.equal(canonicalDigest({ profile, fixtures }), canonicalInputDigest);

  let materialSurvivors = 0;
  let mutationCount = 0;
  for (const fixture of fixtures) {
    if (fixture.variations !== undefined) continue;
    mutationCount += 1;
    const candidate = inferFixtureMutation(profile, fixture, relationMutation);
    assert.equal(validateProfileSchemaV034(candidate), true,
      `${fixture.fixture_id}: ${JSON.stringify(validateProfileSchemaV034.errors)}`);
    assert.deepEqual(validateProfileSemanticsV034(candidate), [], fixture.fixture_id);
    if (mutationCount === 1) retargetCoverageDeclaration(profile, candidate, adequacy);
    const assessment = evaluateNegativeContractFixtures(candidate, [fixture]);
    if (assessment.results[0]?.outcome !== "survived") materialSurvivors += 1;
  }
  assert.equal(materialSurvivors, 0);
  return { fixture_count: fixtures.length, mutation_count: mutationCount };
}

function removeFirstMissingRelationBranch(profile, fixture, removePatterns) {
  const missing = profile.claim_patterns.filter(({ pattern_id: id }) =>
    !fixture.contract.claims.some(({ claim_id }) => claim_id === `claim-${id}`)
  ).map(({ pattern_id: id }) => id);
  assert.ok(missing.length >= 2, fixture.fixture_id);
  return removePatterns(profile, missing);
}

export {
  assertFixedNegativeCorpus,
  removeFirstMissingRelationBranch
};
