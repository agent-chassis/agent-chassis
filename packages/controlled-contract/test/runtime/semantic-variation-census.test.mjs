import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateNegativeContractFixtures
} from "../support/proof-pack-adequacy.mjs";
import {
  validateProfileSchemaV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";

const packs = [
  ["p1", "proof.idempotency.effect-nonduplication/2.0.0", ["base"]],
  ["p2", "proof.authorization.refusal-before-effects/1.0.0", ["base"]],
  ["p3", "proof.atomicity.failure-boundary/1.0.0", ["none", "committed"]],
  ["p4", "proof.authorization.failed-attempt-nonconsumption/1.0.0", ["base"]]
];

function candidateForVariant(profile, fixture, variant) {
  const candidate = structuredClone(profile);
  assert.equal(variant.covers.length, 1);
  const surfaceId = variant.covers[0].surface_id;
  const patternMatches = candidate.claim_patterns
    .map(({ pattern_id: id }, index) => ({ id, index }))
    .filter(({ id }) => surfaceId.startsWith(`claim-${id}-`))
    .sort((left, right) => right.id.length - left.id.length);
  assert.ok(patternMatches.length > 0, surfaceId);
  const patternIndex = patternMatches[0].index;
  assert.notEqual(patternIndex, -1, surfaceId);
  const pattern = candidate.claim_patterns[patternIndex];
  const suffix = surfaceId.slice(`claim-${pattern.pattern_id}-`.length);
  const claim = fixture.contract.claims.find(
    ({ claim_id: id }) => id === `claim-${pattern.pattern_id}`
  );
  const claimIndex = fixture.contract.claims.indexOf(claim);
  const propositionIndex = fixture.contract.propositions.findIndex(
    ({ proposition_id: id }) => id === claim.proposition_id
  );
  const falsifierIndex = claim.falsifying_proposition_id === undefined ? -1
    : fixture.contract.propositions.findIndex(
      ({ proposition_id: id }) => id === claim.falsifying_proposition_id
    );
  const patchValue = (path) => {
    const patch = variant.contract_patches.find((entry) => entry.path === path);
    assert.ok(patch, `${variant.variant_id}: ${path}`);
    return structuredClone(patch.value);
  };
  const roleForReference = (referenceId) => {
    const bindings = new Map(fixture.evaluation_input.reference_bindings.map(
      ({ role, reference_ids: ids }) => [role, ids]
    ));
    const match = candidate.reference_roles.find(({ role }) => {
      const ids = bindings.get(role);
      return ids?.length === 1 && ids[0] === referenceId;
    });
    assert.ok(match, `${variant.variant_id}: ${referenceId}`);
    return match.role;
  };
  const rolesForReferences = (referenceIds) => referenceIds.map(roleForReference);

  if (suffix === "claim-kind") {
    pattern.claim_kind = patchValue(`/claims/${claimIndex}/kind`);
  } else if (suffix === "verification-methods") {
    pattern.verification_methods.push(
      patchValue(`/claims/${claimIndex}/verification_method`)
    );
  } else if (suffix === "proposition-operator") {
    pattern.proposition_template.operator = patchValue(
      `/propositions/${propositionIndex}/operator`
    );
    for (const relation of candidate.relation_patterns.filter(
      ({ target_claim_pattern_id: id }) => id === pattern.pattern_id
    )) {
      const verifier = candidate.claim_patterns.find(
        ({ pattern_id: id }) => id === relation.source_claim_pattern_id
      );
      if (!verifier?.falsifying_proposition_template) continue;
      const coupledFalsifierIndex = fixture.contract.propositions.findIndex(
        ({ proposition_id: id }) => id === `prop-falsifier-${verifier.pattern_id}`
      );
      const falsifierPatch = variant.contract_patches.find(
        ({ path }) => path === `/propositions/${coupledFalsifierIndex}/operator`
      );
      if (falsifierPatch) {
        verifier.falsifying_proposition_template.operator = falsifierPatch.value;
      }
    }
  } else if (suffix === "proposition-subject") {
    pattern.proposition_template.subject_role = roleForReference(patchValue(
      `/propositions/${propositionIndex}/subject_reference_id`
    ));
  } else if (suffix === "proposition-applicability-mode") {
    pattern.proposition_template.applicability_context.mode = patchValue(
      `/propositions/${propositionIndex}/applicability_context/mode`
    );
  } else if (suffix === "proposition-applicability-operands") {
    pattern.proposition_template.applicability_context.operand_roles = rolesForReferences(
      patchValue(`/propositions/${propositionIndex}/applicability_context/operand_reference_ids`)
    );
  } else if (/^proposition-operand-\d+-role$/.test(suffix)) {
    const operandIndex = Number(suffix.match(/^proposition-operand-(\d+)-role$/)[1]);
    const leafPatch = variant.contract_patches.find(({ path }) =>
      path === `/propositions/${propositionIndex}/operands/${operandIndex}/reference_id`
    );
    if (leafPatch) {
      pattern.proposition_template.operands[operandIndex].role = roleForReference(
        leafPatch.value
      );
    } else {
      const operands = patchValue(`/propositions/${propositionIndex}/operands`);
      const bindings = new Map(fixture.evaluation_input.reference_bindings.map(
        ({ role, reference_ids: ids }) => [role, ids]
      ));
      const matchingRoles = candidate.reference_roles.map(({ role }) => role).filter((role) => {
        const trial = structuredClone(pattern.proposition_template.operands);
        trial[operandIndex].role = role;
        const expanded = trial.flatMap((operand) => operand.kind === "reference"
          ? (bindings.get(operand.role) ?? []).map((referenceId) => ({
            kind: "reference", reference_id: referenceId
          }))
          : [structuredClone(operand)]);
        return JSON.stringify(expanded) === JSON.stringify(operands);
      });
      assert.equal(matchingRoles.length, 1, variant.variant_id);
      pattern.proposition_template.operands[operandIndex].role = matchingRoles[0];
    }
  } else if (/^proposition-operand-\d+-(?:minimum|maximum|value|value-role)$/.test(suffix)) {
    const match = suffix.match(
      /^proposition-operand-(\d+)-(minimum|maximum|value|value-role)$/
    );
    const operandIndex = Number(match[1]);
    const leaf = match[2] === "value-role" ? "value_role" : match[2];
    pattern.proposition_template.operands[operandIndex][leaf] = patchValue(
      `/propositions/${propositionIndex}/operands/${operandIndex}/${leaf}`
    );
  } else if (suffix === "falsifier-subject") {
    pattern.falsifying_proposition_template.subject_role = roleForReference(patchValue(
      `/propositions/${falsifierIndex}/subject_reference_id`
    ));
  } else if (suffix === "falsifier-applicability-mode") {
    const mode = patchValue(`/propositions/${falsifierIndex}/applicability_context/mode`);
    pattern.falsifying_proposition_template.applicability_context.mode = mode;
    const relationIds = new Set(candidate.relation_patterns.filter(
      ({ source_claim_pattern_id: id }) => id === pattern.pattern_id
    ).map(({ pattern_id: id }) => id));
    for (const binding of candidate.falsifier_condition_bindings) {
      if (relationIds.has(binding.relation_pattern_id)) {
        binding.applicability_context.mode = mode;
      }
    }
  } else if (suffix === "falsifier-applicability-operands") {
    const roles = rolesForReferences(patchValue(
      `/propositions/${falsifierIndex}/applicability_context/operand_reference_ids`
    ));
    pattern.falsifying_proposition_template.applicability_context.operand_roles = roles;
    const relationIds = new Set(candidate.relation_patterns.filter(
      ({ source_claim_pattern_id: id }) => id === pattern.pattern_id
    ).map(({ pattern_id: id }) => id));
    for (const binding of candidate.falsifier_condition_bindings) {
      if (relationIds.has(binding.relation_pattern_id)) {
        binding.applicability_context.operand_roles = structuredClone(roles);
      }
    }
  } else if (/^falsifier-operand-\d+-role$/.test(suffix)) {
    const operandIndex = Number(suffix.match(/^falsifier-operand-(\d+)-role$/)[1]);
    pattern.falsifying_proposition_template.operands[operandIndex].role = roleForReference(
      patchValue(`/propositions/${falsifierIndex}/operands/${operandIndex}/reference_id`)
    );
  } else {
    assert.fail(`${variant.variant_id}: unsupported surface ${surfaceId}`);
  }
  assert.equal(validateProfileSchemaV034(candidate), true, variant.variant_id);
  assert.deepEqual(validateProfileSemanticsV034(candidate), [], variant.variant_id);
  return candidate;
}

for (const [packKey, directory, corpusNames] of packs) {
  test(`${packKey} semantic variation census has indexed/full parity and zero survivors`,
    async () => {
      const baseDirectory = new URL(
        `../certification/profiles/${directory}/`, import.meta.url
      );
      const profile = JSON.parse(await readFile(
        new URL("profile.json", baseDirectory), "utf8"
      ));
      let variationCount = 0;
      for (const [family, corpusName] of corpusNames.flatMap((name) => [
        ["operator", name], ["claim", name]
      ])) {
        const fixture = JSON.parse(await readFile(
          new URL(
            `negative-fixtures/semantic-${family}-variations-${corpusName}.json`,
            baseDirectory
          ),
          "utf8"
        ));
        variationCount += fixture.variations.length;
        const indexedCanonical = evaluateNegativeContractFixtures(profile, [fixture], {
          variation_mode: "indexed"
        });
        const fullCanonical = evaluateNegativeContractFixtures(profile, [fixture], {
          variation_mode: "full_census"
        });
        assert.equal(indexedCanonical.results[0].outcome, "rejected");
        assert.equal(fullCanonical.results[0].outcome, "rejected");
        assert.deepEqual(indexedCanonical.diagnostics, []);
        assert.deepEqual(fullCanonical.diagnostics, []);
        assert.equal(
          indexedCanonical.results[0].variation_assessment.total_expanded_variants,
          fixture.variations.length
        );
        assert.equal(
          fullCanonical.results[0].variation_assessment.evaluated_count,
          fixture.variations.length
        );

        for (const variant of fixture.variations) {
          const candidate = candidateForVariant(profile, fixture, variant);
          const isolated = {
            ...structuredClone(fixture),
            covers: structuredClone(variant.covers),
            variations: [structuredClone(variant)]
          };
          const rebound = evaluateNegativeContractFixtures(candidate, [isolated], {
            variation_mode: "full_census"
          });
          assert.equal(rebound.results[0].outcome, "survived", variant.variant_id);
        }

        const representative = fixture.variations.find(
          ({ variant_id: id }) => id.endsWith("-operator-reference-reads")
        ) ?? fixture.variations[0];
        const representativeProfile = candidateForVariant(profile, fixture, representative);
        const indexedMutant = evaluateNegativeContractFixtures(
          representativeProfile, [fixture], { variation_mode: "indexed" }
        );
        const fullMutant = evaluateNegativeContractFixtures(
          representativeProfile, [fixture], { variation_mode: "full_census" }
        );
        assert.equal(indexedMutant.results[0].outcome, "survived");
        assert.equal(fullMutant.results[0].outcome, "survived");
      }
      assert.ok(variationCount > 0);
    });
}
