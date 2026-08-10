import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalDigest,
  claimNestedSemanticDescriptors,
  guaranteeDigest,
  profileDigest,
  runProofPackAdequacy
} from "../support/proof-pack-adequacy.mjs";
import {
  evaluateFixture,
  profileRejectionFixtures,
  runProofPackAdequacyControls
} from "./lossless-projection-v1-adequacy.mjs";
import {
  LOSSLESS_PROJECTION_V1_PROFILE,
  buildLosslessProjectionFixture
} from "./lossless-projection-v1-fixture.mjs";
import {
  MUTATIONS,
  executeProjection,
  projectionGuaranteeSatisfied
} from "./lossless-projection-v1-harness.mjs";
import {
  evaluateVerificationProfileV034,
  validateProfileSchemaV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";
import {
  APPLICABILITY_MODES,
  OPERATORS
} from "../../lib/vocabulary-v034.mjs";

const controlledContractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), ".."
);
const repositoryRoot = path.resolve(controlledContractRoot, "../../..");
const packDirectory = path.join(
  controlledContractRoot,
  "certification/profiles/proof.completeness.lossless-projection/1.0.0"
);

async function readJson(name) {
  return JSON.parse(await readFile(path.join(packDirectory, name), "utf8"));
}

function setPointer(document, pointer, value) {
  const tokens = pointer.slice(1).split("/");
  let owner = document;
  for (const token of tokens.slice(0, -1)) owner = owner[Array.isArray(owner)
    ? Number(token) : token];
  const token = tokens.at(-1);
  owner[Array.isArray(owner) ? Number(token) : token] = structuredClone(value);
}

function applyPatches(document, patches) {
  const result = structuredClone(document);
  for (const { path: pointer, value } of patches) setPointer(result, pointer, value);
  return result;
}

function expandedCoverageFixture(fixture, surfaceId, weakeningClass) {
  if (fixture.variations === undefined) return {
    contract: structuredClone(fixture.contract),
    input: structuredClone(fixture.evaluation_input)
  };
  const variant = fixture.variations.find(({ covers }) => covers.some(
    ({ surface_id: id, weakening_class: candidateClass }) =>
      id === surfaceId && candidateClass === weakeningClass
  ));
  assert.ok(variant, `${surfaceId}: tagged variation`);
  return {
    contract: applyPatches(fixture.contract, variant.contract_patches),
    input: applyPatches(fixture.evaluation_input, variant.evaluation_input_patches),
    variant
  };
}

function pointerValue(document, pointer) {
  return pointer.slice(1).split("/").reduce((value, token) =>
    value[Array.isArray(value) ? Number(token) : token], document);
}

function nestedAlternatives(profile, descriptor) {
  const current = pointerValue(profile, descriptor.profile_json_pointer);
  if (descriptor.kind === "required_stage") return ["pre_dispatch", "post_delivery"];
  if (descriptor.kind === "claim_kind") return ["behavior", "evidence", "verification"];
  if (descriptor.kind === "modalities") return [
    "MUST", "MUST_NOT", "SHOULD", "SHOULD_NOT", "MAY"
  ].filter((value) => !current.includes(value)).map((value) => [...current, value]);
  if (descriptor.kind === "reference_role") return profile.reference_roles.map(
    ({ role }) => role
  );
  if (descriptor.kind === "operator") return OPERATORS.map(({ term }) => term);
  if (descriptor.kind === "applicability_mode") return APPLICABILITY_MODES.map(
    ({ term }) => term
  );
  if (descriptor.kind === "verification_methods") return [
    "inspection", "analysis", "demonstration", "test_execution", "audit", "proof"
  ].filter((value) => !current.includes(value)).map((value) => [...current, value]);
  if (descriptor.kind === "applicability_roles") {
    const roles = profile.reference_roles.map(({ role }) => role);
    const candidates = [];
    if (current.length === 0) candidates.push(...roles.map((role) => [role]));
    for (let index = 0; index < current.length; index += 1) {
      candidates.push(current.filter((_, candidateIndex) => candidateIndex !== index));
      for (const role of roles) if (role !== current[index]) {
        const replacement = [...current];
        replacement[index] = role;
        candidates.push(replacement);
      }
    }
    for (const role of roles) if (!current.includes(role)) {
      candidates.push([...current, role]);
    }
    return candidates;
  }
  if (descriptor.kind === "operand_value_role") return profile.number_roles.map(
    ({ role }) => role
  );
  if (["operand_minimum", "operand_maximum", "operand_value"].includes(
    descriptor.kind
  )) return [0, 1, 2, current - 1, current + 1].filter(
    (value) => Number.isSafeInteger(value) && value >= 0 && value !== current
  );
  return [];
}

function profileWithReplacement(profile, pointer, value) {
  const candidate = structuredClone(profile);
  setPointer(candidate, pointer, value);
  return candidate;
}

function evaluatesSatisfied(fixture, profile) {
  return evaluateVerificationProfileV034({ contract: fixture.contract, profile,
    evaluation_input: fixture.input }).satisfaction === "satisfied";
}

function coupledOperatorCandidate(profile, descriptor, expanded) {
  if (descriptor.template !== "proposition" || descriptor.kind !== "operator") return null;
  const pattern = profile.claim_patterns[descriptor.claim_index];
  const relation = profile.relation_patterns.find(
    ({ target_claim_pattern_id: target }) => target === pattern.pattern_id
  );
  if (!relation) return null;
  const sourceIndex = profile.claim_patterns.findIndex(
    ({ pattern_id: id }) => id === relation.source_claim_pattern_id
  );
  const targetClaim = expanded.contract.claims.find(
    ({ claim_id: id }) => id === `claim-${pattern.pattern_id}`
  );
  const targetProposition = expanded.contract.propositions.find(
    ({ proposition_id: id }) => id === targetClaim?.proposition_id
  );
  const sourceClaim = expanded.contract.claims.find(
    ({ claim_id: id }) => id === `claim-${relation.source_claim_pattern_id}`
  );
  const sourceFalsifier = expanded.contract.propositions.find(
    ({ proposition_id: id }) => id === sourceClaim?.falsifying_proposition_id
  );
  if (!targetProposition || !sourceFalsifier) return null;
  const candidate = profileWithReplacement(
    profile, descriptor.profile_json_pointer, targetProposition.operator
  );
  candidate.claim_patterns[sourceIndex].falsifying_proposition_template.operator =
    sourceFalsifier.operator;
  return candidate;
}

function aggregateCandidate(profile, fixtureId) {
  const candidate = structuredClone(profile);
  if (fixtureId === "reject-three-mode-count") {
    candidate.number_roles.find(({ role }) => role === "mode_count").maximum = 3;
  } else if (fixtureId === "reject-collapsed-mode-identities") {
    candidate.distinct_reference_role_sets = candidate.distinct_reference_role_sets.filter(
      ({ roles }) => !(roles.includes("compact_mode") && roles.includes("complete_mode"))
    );
    const count = candidate.number_roles.find(({ role }) => role === "mode_count");
    count.minimum = 1;
    count.maximum = 1;
  } else if (fixtureId === "reject-missing-disclosed-population-binding") {
    candidate.reference_binding_patterns = candidate.reference_binding_patterns.filter(
      ({ pattern_id: id }) => id !== "complete-disclosed-population"
    );
    candidate.reference_role_count_bindings = candidate.reference_role_count_bindings.filter(
      ({ reference_role: role }) => role !== "disclosed_members"
    );
    candidate.satisfaction_expression.all_of = candidate.satisfaction_expression.all_of.filter(
      ({ pattern: id }) => id !== "complete-disclosed-population"
    );
  } else if (fixtureId === "reject-tool-mode-count-mismatch") {
    candidate.reference_role_count_bindings = candidate.reference_role_count_bindings.filter(
      ({ reference_role: role }) => role !== "tool_modes"
    );
  } else if (["reject-deleted-recovery-path-claim",
    "reject-removed-satisfaction-branch"].includes(fixtureId)) {
    candidate.claim_patterns = candidate.claim_patterns.filter(
      ({ pattern_id: id }) => id !== "compact-result-names-complete-path"
    );
    candidate.satisfaction_expression.all_of = candidate.satisfaction_expression.all_of.filter(
      ({ pattern: id }) => id !== "compact-result-names-complete-path"
    );
  } else if (fixtureId === "reject-deleted-verification-relation") {
    const removed = new Set(["projection-actually-omits", "projection-omission-verification"]);
    candidate.claim_patterns = candidate.claim_patterns.filter(
      ({ pattern_id: id }) => !removed.has(id)
    );
    candidate.relation_patterns = candidate.relation_patterns.filter(
      ({ pattern_id: id }) => id !== "verification-target-projection-omission"
    );
    candidate.falsifier_condition_bindings = candidate.falsifier_condition_bindings.filter(
      ({ relation_pattern_id: id }) => id !== "verification-target-projection-omission"
    );
    candidate.satisfaction_expression.all_of = candidate.satisfaction_expression.all_of.filter(
      ({ pattern: id }) => !removed.has(id) &&
        id !== "verification-target-projection-omission"
    );
  } else if (fixtureId === "reject-retargeted-lossless-condition") {
    candidate.falsifier_condition_bindings.find(
      ({ relation_pattern_id: id }) => id === "verification-target-lossless-recovery"
    ).applicability_context.operand_roles = ["silent_omission_condition"];
    candidate.claim_patterns.find(
      ({ pattern_id: id }) => id === "lossless-recovery-verification"
    ).falsifying_proposition_template.applicability_context.operand_roles = [
      "silent_omission_condition"
    ];
  } else return null;
  return candidate;
}

test("lossless projection 1.0 binds and admits its complete proof corpus", async () => {
  const [profile, adequacy] = await Promise.all([
    readJson("profile.json"),
    readJson("adequacy.json")
  ]);
  assert.equal(adequacy.profile_digest, profileDigest(profile));
  assert.equal(adequacy.guarantee_digest, guaranteeDigest(adequacy.guarantee));
  assert.equal(adequacy.guarantee_critical_profile_surfaces.length, 179);
  assert.equal(adequacy.noncritical_profile_surfaces.length, 195);

  for (const variationMode of ["indexed", "full_census"]) {
    const result = await runProofPackAdequacy(packDirectory, { variationMode });
    assert.equal(result.passed, true, variationMode);
    assert.equal(result.control_count, 35);
    assert.equal(result.negative_fixture_count, 10);
    assert.equal(result.negative_fixture_results.every(
      ({ outcome }) => outcome === "rejected"
    ), true);
    assert.deepEqual(result.diagnostics, []);
  }
});

test("every claimed coverage binding rejects canonical and rebounds under its weakening",
  async () => {
    const [profile, adequacy] = await Promise.all([
      readJson("profile.json"), readJson("adequacy.json")
    ]);
    const fixtures = new Map(await Promise.all(
      adequacy.negative_contract_fixtures.map(async ({ fixture_id: fixtureId, path: declared }) =>
        [fixtureId, JSON.parse(await readFile(path.join(repositoryRoot, declared), "utf8"))]
      )
    ));
    const descriptorByPointer = new Map(claimNestedSemanticDescriptors(profile).map(
      (descriptor) => [descriptor.profile_json_pointer, descriptor]
    ));
    let checked = 0;
    for (const surface of adequacy.guarantee_critical_profile_surfaces) {
      for (const coverage of surface.coverage) {
        for (const fixtureId of coverage.negative_fixture_ids) {
          const expanded = expandedCoverageFixture(
            fixtures.get(fixtureId), surface.surface_id, coverage.weakening_class
          );
          assert.equal(evaluatesSatisfied(expanded, profile), false,
            `${surface.surface_id}: canonical rejection`);
          let candidate = aggregateCandidate(profile, fixtureId);
          const descriptor = descriptorByPointer.get(surface.profile_json_pointer);
          if (descriptor) {
            candidate = nestedAlternatives(profile, descriptor).map((alternative) =>
              profileWithReplacement(profile, descriptor.profile_json_pointer, alternative)
            ).find((possible) => validateProfileSchemaV034(possible) &&
              validateProfileSemanticsV034(possible).length === 0 &&
              evaluatesSatisfied(expanded, possible));
            candidate ??= coupledOperatorCandidate(profile, descriptor, expanded);
          } else if (fixtureId === "reference-role-variations-base") {
            candidate = structuredClone(profile);
            if (surface.surface_id.endsWith("-cardinality")) {
              const role = surface.surface_id.slice("role-".length,
                -"-cardinality".length).replaceAll("-", "_");
              candidate.reference_roles.find(
                ({ role: id }) => id === role
              ).cardinality = "one_or_more";
            } else {
              const changed = expanded.contract.references.find((reference, index) =>
                reference.type_term !== fixtures.get(fixtureId).contract.references[index]
                  ?.type_term
              );
              assert.ok(changed, `${surface.surface_id}: changed reference`);
              const boundRoles = expanded.input.reference_bindings.filter(
                ({ reference_ids: ids }) => ids.includes(changed.reference_id)
              ).map(({ role }) => role);
              for (const role of boundRoles) {
                const declaration = candidate.reference_roles.find(
                  ({ role: id }) => id === role
                );
                if (!declaration.allowed_type_terms.includes(changed.type_term)) {
                  declaration.allowed_type_terms.push(changed.type_term);
                }
              }
            }
          }
          assert.ok(candidate, `${surface.surface_id}: profile weakening`);
          assert.equal(validateProfileSchemaV034(candidate), true, surface.surface_id);
          assert.deepEqual(validateProfileSemanticsV034(candidate), [], surface.surface_id);
          assert.equal(evaluatesSatisfied(expanded, candidate), true,
            `${surface.surface_id}: rebound satisfaction`);
          checked += 1;
        }
      }
    }
    assert.equal(checked, 179);

    const semantic = fixtures.get("semantic-claim-variations-base");
    const reviewerExample = expandedCoverageFixture(semantic,
      "claim-tool-declares-modes-proposition-operator", "proposition_weakening");
    const claim = reviewerExample.contract.claims.find(
      ({ claim_id: id }) => id === "claim-tool-declares-modes"
    );
    assert.equal(reviewerExample.contract.propositions.find(
      ({ proposition_id: id }) => id === claim.proposition_id
    ).operator, "reference:uses");
  });

test("executable controls span distinct projections and kill every implementation mutant",
  async () => {
    for (const domain of ["record", "graph", "artifact", "archive"]) {
      assert.equal(projectionGuaranteeSatisfied(executeProjection({ domain })), true);
    }
    for (const mutant of Object.keys(MUTATIONS)) {
      assert.equal(
        projectionGuaranteeSatisfied(executeProjection({ domain: "record", mutant })),
        false,
        mutant
      );
    }

    const observations = await runProofPackAdequacyControls({
      profile: LOSSLESS_PROJECTION_V1_PROFILE
    });
    const categories = observations.controls.reduce((counts, { category }) => ({
      ...counts,
      [category]: (counts[category] ?? 0) + 1
    }), {});
    assert.deepEqual(categories, {
      positive: 4,
      mutant: 8,
      profile_rejection: 14,
      exclusion: 9
    });
  });

test("status-only and covers-symbol smoke proofs cannot satisfy the guarantee", () => {
  const rejections = profileRejectionFixtures(LOSSLESS_PROJECTION_V1_PROFILE);
  for (const controlId of [
    "status-only-verification",
    "suite-covers-symbol-negation-only"
  ]) {
    assert.notEqual(
      evaluateFixture(rejections[controlId]()),
      "satisfied",
      controlId
    );
  }
});

test("concrete identity roles reject caller-invented profile terms", () => {
  const fixture = buildLosslessProjectionFixture({
    profile: LOSSLESS_PROJECTION_V1_PROFILE,
    identity_overrides: {
      tool: { kind: "profile_term", term: "invented-tool" }
    }
  });
  const result = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: LOSSLESS_PROJECTION_V1_PROFILE,
    evaluation_input: fixture.input
  });
  assert.equal(result.contract_valid, true);
  assert.equal(result.input_valid, true);
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "reference_role_binding_identity_kind_mismatch"
  ));
});

test("evaluation is pure and invariant to declaration order", () => {
  const fixture = buildLosslessProjectionFixture({
    profile: LOSSLESS_PROJECTION_V1_PROFILE
  });
  const before = canonicalDigest(fixture);
  const canonical = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
  assert.equal(canonical.satisfaction, "satisfied");
  assert.equal(canonicalDigest(fixture), before);

  const reordered = structuredClone(fixture);
  for (const key of ["references", "propositions", "claims", "relations"]) {
    reordered.contract[key].reverse();
  }
  for (const key of [
    "reference_bindings",
    "number_bindings",
    "claim_pattern_bindings",
    "resolver_facts",
    "delivered_evidence"
  ]) reordered.input[key].reverse();
  const reorderedResult = evaluateVerificationProfileV034({
    contract: reordered.contract,
    profile: reordered.profile,
    evaluation_input: reordered.input
  });
  assert.equal(reorderedResult.satisfaction, "satisfied");
});

test("adequacy executable closure is repository-relative and digest-declared",
  async () => {
    const adequacy = await readJson("adequacy.json");
    const declaredPaths = [
      adequacy.executable_module,
      ...adequacy.executable_dependency_digests.map(({ path: dependencyPath }) =>
        dependencyPath
      )
    ];
    for (const requiredPath of [
      "packages/controlled-contract/test/proof-packs/lossless-projection-v1-adequacy.mjs",
      "packages/controlled-contract/test/proof-packs/lossless-projection-v1-fixture.mjs",
      "packages/controlled-contract/test/proof-packs/lossless-projection-v1-harness.mjs"
    ]) assert.ok(declaredPaths.includes(requiredPath));
    assert.deepEqual(
      adequacy.executable_dependency_digests.map(({ path: dependencyPath }) =>
        dependencyPath
      ),
      adequacy.executable_dependency_digests.map(({ path: dependencyPath }) =>
        dependencyPath
      ).sort()
    );
    for (const { path: declaredPath, sha256 } of
      adequacy.executable_dependency_digests) {
      assert.match(sha256, /^[a-f0-9]{64}$/u);
      const source = await readFile(path.join(repositoryRoot, declaredPath), "utf8");
      assert.doesNotMatch(source, /(?:\/home\/|\/tmp\/)/u);
    }
  });
