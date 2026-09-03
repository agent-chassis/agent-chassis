import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  evaluateVerificationProfileV034,
  profileDigestV034,
  validateProfileSemanticsV034,
  validateProfileSchemaV034
} from "../../lib/verification-profile-v034.mjs";
import {
  contractBuilder,
  evaluationInput,
  profileBase
} from "../support/population-v034-fixtures.mjs";
import {
  genericMechanismCoverageRequirements
} from "../support/proof-pack-adequacy.mjs";

const templateContext = (mode = "unconditional", operandRoles = []) => ({
  mode, operand_roles: operandRoles
});
const context = (mode = "unconditional", operandReferenceIds = []) => ({
  mode, operand_reference_ids: operandReferenceIds
});

function vacuousFixture(memberIds = []) {
  const builder = contractBuilder();
  builder.addPopulation({ id: "ref-members-population", members: memberIds });
  builder.addReference("ref-target", "cc:criterion");
  for (const memberId of memberIds) builder.addEvidence({
    id: `${memberId.slice(4)}-not-match`,
    subject: memberId,
    operator: "reference:matches",
    operands: [{ kind: "reference", reference_id: "ref-target" }]
  });
  for (const claim of builder.contract.claims.filter(({ claim_id: claimId }) =>
    claimId.endsWith("-not-match")
  )) claim.modality = "MUST_NOT";
  const profile = profileBase("prototype.generic-vacuous-universal", [
    {
      role: "member_population", allowed_type_terms: ["cc:population"],
      cardinality: "exactly_one"
    },
    {
      role: "members", allowed_type_terms: ["cc:resource"],
      cardinality: "zero_or_more"
    },
    {
      role: "target", allowed_type_terms: ["cc:criterion"],
      cardinality: "exactly_one"
    }
  ]);
  profile.reference_binding_patterns.push({
    pattern_id: "complete-members",
    required_by_stage: "post_delivery",
    comparison: "complete_population",
    roles: ["member_population", "members"],
    applicability_context: templateContext()
  });
  profile.claim_patterns.push({
    pattern_id: "each-member-does-not-match-target",
    required_by_stage: "post_delivery",
    claim_kind: "evidence",
    allowed_modalities: ["MUST_NOT"],
    for_each: {
      population_role: "members",
      member_role: "member",
      complete_population_pattern_id: "complete-members",
      quantifier: "universal",
      empty_behavior: "vacuously_satisfied"
    },
    proposition_template: {
      subject_role: "member",
      operator: "reference:matches",
      applicability_context: templateContext(),
      operands: [{ kind: "reference", role: "target" }]
    }
  });
  profile.satisfaction_expression = { all_of: [
    { pattern: "complete-members" },
    { pattern: "each-member-does-not-match-target" }
  ] };
  return {
    contract: builder.contract,
    profile,
    evaluation_input: evaluationInput([
      { role: "member_population", reference_ids: ["ref-members-population"] },
      { role: "members", reference_ids: memberIds },
      { role: "target", reference_ids: ["ref-target"] }
    ])
  };
}

function associationFixture() {
  const builder = contractBuilder();
  const occurrences = ["ref-occurrence-alpha", "ref-occurrence-beta"];
  const sources = ["ref-source-alpha", "ref-source-beta"];
  builder.addPopulation({ id: "ref-occurrence-population", members: occurrences });
  builder.addPopulation({ id: "ref-source-population", members: sources });
  for (const occurrence of occurrences) builder.contract.references.find(
    ({ reference_id: referenceId }) => referenceId === occurrence
  ).type_term = "cc:evidence_occurrence";
  builder.addReference("ref-attempt", "cc:process");
  for (const suffix of ["alpha", "beta"]) builder.addEvidence({
    id: `occurrence-${suffix}-origin`,
    subject: `ref-occurrence-${suffix}`,
    operator: "reference:originates_from",
    context: context("during", ["ref-attempt"]),
    operands: [{ kind: "reference", reference_id: `ref-source-${suffix}` }]
  });
  const profile = profileBase("prototype.generic-associated-universal", [
    {
      role: "occurrence_population", allowed_type_terms: ["cc:population"],
      cardinality: "exactly_one"
    },
    {
      role: "occurrences", allowed_type_terms: ["cc:evidence_occurrence"],
      cardinality: "zero_or_more"
    },
    {
      role: "source_population", allowed_type_terms: ["cc:population"],
      cardinality: "exactly_one"
    },
    {
      role: "sources", allowed_type_terms: ["cc:resource"],
      cardinality: "zero_or_more"
    },
    {
      role: "attempt", allowed_type_terms: ["cc:process"],
      cardinality: "exactly_one"
    }
  ]);
  profile.reference_binding_patterns.push(
    {
      pattern_id: "complete-occurrences", required_by_stage: "post_delivery",
      comparison: "complete_population",
      roles: ["occurrence_population", "occurrences"],
      applicability_context: templateContext()
    },
    {
      pattern_id: "complete-sources", required_by_stage: "post_delivery",
      comparison: "complete_population",
      roles: ["source_population", "sources"],
      applicability_context: templateContext()
    }
  );
  profile.claim_patterns.push({
    pattern_id: "each-occurrence-has-exact-origin",
    required_by_stage: "post_delivery",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    for_each: {
      population_role: "occurrences",
      member_role: "occurrence",
      complete_population_pattern_id: "complete-occurrences",
      quantifier: "universal",
      empty_behavior: "vacuously_satisfied",
      association_bindings: [{
        associated_role: "sources",
        operator: "reference:originates_from",
        member_position: "subject",
        associated_position: "reference_operand",
        applicability_context: templateContext("during", ["attempt"]),
        complete_population_pattern_id: "complete-sources"
      }]
    },
    proposition_template: {
      subject_role: "occurrence",
      operator: "reference:originates_from",
      applicability_context: templateContext("during", ["attempt"]),
      operands: [{ kind: "reference", role: "sources" }]
    }
  });
  profile.satisfaction_expression = { all_of: [
    { pattern: "complete-occurrences" },
    { pattern: "complete-sources" },
    { pattern: "each-occurrence-has-exact-origin" }
  ] };
  return {
    contract: builder.contract,
    profile,
    evaluation_input: evaluationInput([
      {
        role: "occurrence_population",
        reference_ids: ["ref-occurrence-population"]
      },
      { role: "occurrences", reference_ids: occurrences },
      { role: "source_population", reference_ids: ["ref-source-population"] },
      { role: "sources", reference_ids: sources },
      { role: "attempt", reference_ids: ["ref-attempt"] }
    ])
  };
}

test("association bindings select one exact opposite endpoint per universal member", () => {
  const fixture = associationFixture();
  assert.equal(validateProfileSchemaV034(fixture.profile), true,
    JSON.stringify(validateProfileSchemaV034.errors));
  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  const result = evaluateVerificationProfileV034(fixture);
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics.filter(({ code }) =>
    code === "for_each_association_evaluation"
  ).map(({ member_reference_id: memberReferenceId, matched_claim_ids: claimIds }) =>
    [memberReferenceId, claimIds]
  ), [
    ["ref-occurrence-alpha", ["claim-occurrence-alpha-origin"]],
    ["ref-occurrence-beta", ["claim-occurrence-beta-origin"]]
  ]);

  const reordered = associationFixture();
  reordered.contract.references.reverse();
  reordered.contract.propositions.reverse();
  reordered.contract.claims.reverse();
  reordered.evaluation_input.reference_bindings.reverse();
  for (const binding of reordered.evaluation_input.reference_bindings) {
    binding.reference_ids.reverse();
  }
  assert.deepEqual(evaluateVerificationProfileV034(reordered), result);

  const empty = associationFixture();
  empty.evaluation_input.reference_bindings.find(({ role }) =>
    role === "occurrences"
  ).reference_ids = [];
  empty.contract.propositions.find(({ proposition_id: propositionId }) =>
    propositionId === "prop-occurrence-population-count"
  ).operands[0].value = 0;
  empty.contract.claims = empty.contract.claims.filter(({ claim_id: claimId }) =>
    claimId !== "claim-occurrence-population-members"
  );
  empty.contract.propositions = empty.contract.propositions.filter(
    ({ proposition_id: propositionId }) =>
      propositionId !== "prop-occurrence-population-members"
  );
  const emptyResult = evaluateVerificationProfileV034(empty);
  assert.equal(emptyResult.satisfaction, "satisfied",
    JSON.stringify(emptyResult.diagnostics));
  assert.equal(emptyResult.diagnostics.find(({ code }) =>
    code === "for_each_evaluation"
  ).vacuously_satisfied, true);
});

test("association bindings reject missing, duplicate, and cross-member assignments", () => {
  const missing = associationFixture();
  missing.contract.claims = missing.contract.claims.filter(
    ({ claim_id: claimId }) => claimId !== "claim-occurrence-alpha-origin"
  );
  assert.equal(evaluateVerificationProfileV034(missing).satisfaction, "unsatisfied");

  const duplicate = associationFixture();
  duplicate.contract.propositions.push({
    proposition_id: "prop-occurrence-alpha-origin-duplicate",
    subject_reference_id: "ref-occurrence-alpha",
    operator: "reference:originates_from",
    applicability_context: context("during", ["ref-attempt"]),
    operands: [{ kind: "reference", reference_id: "ref-source-alpha" }]
  });
  duplicate.contract.claims.push({
    claim_id: "claim-occurrence-alpha-origin-duplicate",
    kind: "evidence", modality: "MUST",
    proposition_id: "prop-occurrence-alpha-origin-duplicate"
  });
  assert.equal(evaluateVerificationProfileV034(duplicate).satisfaction, "indeterminate");

  const crossMember = associationFixture();
  crossMember.contract.propositions.push({
    proposition_id: "prop-occurrence-alpha-cross-member-origin",
    subject_reference_id: "ref-occurrence-alpha",
    operator: "reference:originates_from",
    applicability_context: context("during", ["ref-attempt"]),
    operands: [{ kind: "reference", reference_id: "ref-source-beta" }]
  });
  crossMember.contract.claims.push({
    claim_id: "claim-occurrence-alpha-cross-member-origin",
    kind: "evidence", modality: "MUST",
    proposition_id: "prop-occurrence-alpha-cross-member-origin"
  });
  assert.notEqual(evaluateVerificationProfileV034(crossMember).satisfaction,
    "satisfied");
});

test("one-or-more association cardinality closes reverse participation without ambiguity", () => {
  const fixture = associationFixture();
  fixture.profile.claim_patterns[0].for_each.association_bindings[0]
    .associated_cardinality = "one_or_more";
  fixture.profile.claim_patterns[0].for_each.association_bindings[0].operator =
    "reference:depends_on";
  fixture.profile.claim_patterns[0].for_each.association_bindings[0].member_position =
    "reference_operand";
  fixture.profile.claim_patterns[0].for_each.association_bindings[0].associated_position =
    "subject";
  fixture.profile.claim_patterns[0].proposition_template.operator = "reference:depends_on";
  for (const proposition of fixture.contract.propositions.filter((entry) =>
    entry.operator === "reference:originates_from")) {
    proposition.operator = "reference:depends_on";
    const occurrence = proposition.subject_reference_id;
    proposition.subject_reference_id = proposition.operands[0].reference_id;
    proposition.operands[0].reference_id = occurrence;
  }
  fixture.profile.claim_patterns[0].proposition_template.subject_role = "sources";
  fixture.profile.claim_patterns[0].proposition_template.operands[0].role = "occurrence";
  fixture.contract.propositions.push({
    proposition_id: "prop-occurrence-alpha-second-origin",
    subject_reference_id: "ref-source-beta",
    operator: "reference:depends_on",
    applicability_context: context("during", ["ref-attempt"]),
    operands: [{ kind: "reference", reference_id: "ref-occurrence-alpha" }]
  });
  fixture.contract.claims.push({
    claim_id: "claim-occurrence-alpha-second-origin", kind: "evidence", modality: "MUST",
    proposition_id: "prop-occurrence-alpha-second-origin"
  });
  assert.equal(validateProfileSchemaV034(fixture.profile), true,
    JSON.stringify(validateProfileSchemaV034.errors));
  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  const result = evaluateVerificationProfileV034(fixture);
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  const alpha = result.diagnostics.find((diagnostic) =>
    diagnostic.code === "for_each_association_evaluation" &&
    diagnostic.member_reference_id === "ref-occurrence-alpha");
  assert.equal(alpha.associated_cardinality, "one_or_more");
  assert.deepEqual(alpha.matched_claim_ids, [
    "claim-occurrence-alpha-origin", "claim-occurrence-alpha-second-origin"
  ]);
  const requirements = new Set(genericMechanismCoverageRequirements(
    fixture.profile
  ).map(({ profile_json_pointer: pointer, weakening_class: weakeningClass }) =>
    `${pointer}\0${weakeningClass}`
  ));
  assert.ok(requirements.has(
    "/claim_patterns/0/for_each/association_bindings/0/associated_cardinality\0" +
    "binding_constraint_weakening"
  ));

  const invalid = structuredClone(fixture);
  invalid.profile.claim_patterns[0].for_each.association_bindings[0]
    .associated_cardinality = "zero_or_more";
  assert.equal(validateProfileSchemaV034(invalid.profile), false);
});

test("association bindings reject out-of-population, applicability, and alias substitution", () => {
  const outOfPopulation = associationFixture();
  outOfPopulation.contract.references.push({
    reference_id: "ref-source-outside", type_term: "cc:resource",
    identity: { kind: "profile_term", term: "source-outside" }
  });
  outOfPopulation.contract.propositions.find(({ proposition_id: propositionId }) =>
    propositionId === "prop-occurrence-alpha-origin"
  ).operands[0].reference_id = "ref-source-outside";
  assert.equal(evaluateVerificationProfileV034(outOfPopulation).satisfaction,
    "unsatisfied");

  const wrongApplicability = associationFixture();
  wrongApplicability.contract.references.push({
    reference_id: "ref-other-attempt", type_term: "cc:process",
    identity: { kind: "profile_term", term: "other-attempt" }
  });
  wrongApplicability.contract.propositions.find(({ proposition_id: propositionId }) =>
    propositionId === "prop-occurrence-alpha-origin"
  ).applicability_context.operand_reference_ids = ["ref-other-attempt"];
  assert.equal(evaluateVerificationProfileV034(wrongApplicability).satisfaction,
    "unsatisfied");

  const alias = associationFixture();
  alias.contract.references.push({
    reference_id: "ref-source-alpha-alias", type_term: "cc:resource",
    identity: { kind: "profile_term", term: "source-alpha-alias" }
  });
  alias.contract.propositions.push({
    proposition_id: "prop-source-alpha-alias",
    subject_reference_id: "ref-source-alpha",
    operator: "reference:equals",
    applicability_context: context("during", ["ref-attempt"]),
    operands: [{ kind: "reference", reference_id: "ref-source-alpha-alias" }]
  });
  alias.contract.claims.push({
    claim_id: "claim-source-alpha-alias", kind: "evidence", modality: "MUST",
    proposition_id: "prop-source-alpha-alias"
  });
  alias.contract.propositions.find(({ proposition_id: propositionId }) =>
    propositionId === "prop-occurrence-alpha-origin"
  ).operands[0].reference_id = "ref-source-alpha-alias";
  const aliasResult = evaluateVerificationProfileV034(alias);
  assert.equal(aliasResult.satisfaction, "unsatisfied");
  assert.ok(aliasResult.diagnostics.some((diagnostic) =>
    diagnostic.code === "for_each_association_evaluation" &&
    diagnostic.invalid_claims.some(({ alias_population_reference_ids: ids }) =>
      ids.includes("ref-source-alpha")
    )
  ));
});

test("association profile semantics reject weakened position, population, and scope", () => {
  const reversed = associationFixture();
  reversed.profile.claim_patterns[0].for_each.association_bindings[0]
    .associated_position = "subject";
  assert.equal(validateProfileSchemaV034(reversed.profile), false);

  const undominated = associationFixture();
  undominated.profile.satisfaction_expression = { any_of: [
    { pattern: "complete-sources" },
    { pattern: "each-occurrence-has-exact-origin" }
  ], branch_cardinality: "exactly_one" };
  assert.ok(validateProfileSemanticsV034(undominated.profile).some(({ code }) =>
    code === "profile_for_each_association_population_not_dominating"
  ));

  const associatedInScope = associationFixture();
  associatedInScope.profile.claim_patterns[0].for_each.association_bindings[0]
    .applicability_context.operand_roles = ["sources"];
  assert.ok(validateProfileSemanticsV034(associatedInScope.profile).some(({ code }) =>
    code === "profile_for_each_association_role_in_applicability"
  ));
});

test("adequacy fingerprints every association binding field and population", () => {
  const requirements = new Set(genericMechanismCoverageRequirements(
    associationFixture().profile
  ).map(({ profile_json_pointer: pointer, weakening_class: weakeningClass }) =>
    `${pointer}\0${weakeningClass}`
  ));
  const base = "/claim_patterns/0/for_each/association_bindings/0";
  for (const [field, weakeningClass] of [
    ["", "binding_constraint_weakening"],
    ["/associated_role", "binding_constraint_weakening"],
    ["/operator", "proposition_weakening"],
    ["/member_position", "binding_constraint_weakening"],
    ["/associated_position", "binding_constraint_weakening"],
    ["/applicability_context", "binding_constraint_weakening"],
    ["/applicability_context/mode", "binding_constraint_weakening"],
    ["/applicability_context/operand_roles", "binding_constraint_weakening"],
    ["/complete_population_pattern_id", "binding_constraint_weakening"]
  ]) assert.ok(requirements.has(`${base}${field}\0${weakeningClass}`), field);
  for (const pointer of [
    "/reference_binding_patterns/1",
    "/reference_binding_patterns/1/comparison",
    "/reference_binding_patterns/1/roles",
    "/reference_binding_patterns/1/roles/1"
  ]) assert.ok(requirements.has(`${pointer}\0binding_constraint_weakening`), pointer);
});

function associatedOccurrenceJoinFixture() {
  const fixture = associationFixture();
  const association = structuredClone(
    fixture.profile.claim_patterns[0].for_each.association_bindings
  );
  const iteration = {
    population_role: "occurrences",
    member_role: "occurrence",
    complete_population_pattern_id: "complete-occurrences",
    quantifier: "universal",
    empty_behavior: "vacuously_satisfied",
    association_bindings: association
  };
  const originTemplate = (operator) => ({
    subject_role: "occurrence",
    operator,
    applicability_context: templateContext("during", ["attempt"]),
    operands: [{ kind: "reference", role: "sources" }]
  });
  fixture.profile.verification_falsifier_policy =
    "controlled_complement_per_target";
  fixture.profile.claim_patterns = [
    {
      pattern_id: "each-origin-behavior", required_by_stage: "post_delivery",
      claim_kind: "behavior", allowed_modalities: ["MUST"],
      for_each: structuredClone(iteration),
      proposition_template: originTemplate("reference:originates_from")
    },
    {
      pattern_id: "each-origin-verification", required_by_stage: "post_delivery",
      claim_kind: "verification", allowed_modalities: ["MUST"],
      for_each: structuredClone(iteration),
      proposition_template: originTemplate("reference:originates_from"),
      verification_methods: ["test_execution"],
      falsifying_proposition_template:
        originTemplate("reference:does_not_originate_from")
    }
  ];
  fixture.profile.relation_patterns = [{
    pattern_id: "each-origin-verifies-behavior",
    required_by_stage: "post_delivery",
    role: "verifies",
    source_claim_pattern_id: "each-origin-verification",
    target_claim_pattern_id: "each-origin-behavior"
  }];
  fixture.profile.falsifier_condition_bindings = [{
    relation_pattern_id: "each-origin-verifies-behavior",
    applicability_context: templateContext("during", ["attempt"])
  }];
  const join = (role, position) => ({
    role,
    target_positions: [position],
    verification_positions: [position],
    falsifier_positions: [position]
  });
  fixture.profile.falsifier_occurrence_bindings = [{
    relation_pattern_id: "each-origin-verifies-behavior",
    reference_role_joins: [
      join("occurrence", "subject"),
      join("sources", "reference_operand"),
      join("attempt", "applicability_operand")
    ],
    number_role_joins: [],
    applicability_join: "exact_scope"
  }];
  fixture.profile.satisfaction_expression = { all_of: [
    { pattern: "complete-occurrences" },
    { pattern: "complete-sources" },
    { pattern: "each-origin-behavior" },
    { pattern: "each-origin-verification" },
    { pattern: "each-origin-verifies-behavior" }
  ] };
  for (const suffix of ["alpha", "beta"]) {
    const subject = `ref-occurrence-${suffix}`;
    const source = `ref-source-${suffix}`;
    fixture.contract.propositions.push(
      {
        proposition_id: `prop-${suffix}-origin-verification`,
        subject_reference_id: subject,
        operator: "reference:originates_from",
        applicability_context: context("during", ["ref-attempt"]),
        operands: [{ kind: "reference", reference_id: source }]
      },
      {
        proposition_id: `prop-${suffix}-origin-falsifier`,
        subject_reference_id: subject,
        operator: "reference:does_not_originate_from",
        applicability_context: context("during", ["ref-attempt"]),
        operands: [{ kind: "reference", reference_id: source }]
      }
    );
    fixture.contract.claims.push(
      {
        claim_id: `claim-${suffix}-origin-behavior`,
        kind: "behavior", modality: "MUST",
        proposition_id: `prop-occurrence-${suffix}-origin`
      },
      {
        claim_id: `claim-${suffix}-origin-verification`,
        kind: "verification", modality: "MUST",
        proposition_id: `prop-${suffix}-origin-verification`,
        verification_method: "test_execution",
        falsifying_proposition_id: `prop-${suffix}-origin-falsifier`
      }
    );
    fixture.contract.relations.push({
      relation_id: `rel-${suffix}-origin-verifies-behavior`,
      role: "verifies",
      source_claim_id: `claim-${suffix}-origin-verification`,
      target_claim_id: `claim-${suffix}-origin-behavior`
    });
  }
  return fixture;
}

test("association-local roles are exact-one across subjects and occurrence joins", () => {
  const fixture = associatedOccurrenceJoinFixture();
  assert.equal(validateProfileSchemaV034(fixture.profile), true,
    JSON.stringify(validateProfileSchemaV034.errors));
  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  const result = evaluateVerificationProfileV034(fixture);
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
});

test("an iteration member used only by its association is semantically used", () => {
  const fixture = associationFixture();
  fixture.profile.claim_patterns[0].proposition_template = {
    subject_role: "sources",
    operator: "reference:depends_on",
    applicability_context: templateContext(),
    operands: [{ kind: "reference", role: "attempt" }]
  };
  const diagnostics = validateProfileSemanticsV034(fixture.profile);
  assert.ok(!diagnostics.some(({ code }) =>
    code === "profile_for_each_member_role_unused"
  ), JSON.stringify(diagnostics));
  assert.ok(!diagnostics.some(({ code }) =>
    code === "profile_subject_role_cardinality_invalid"
  ), JSON.stringify(diagnostics));
});

test("iterated occurrence joins still reject differing association bindings", () => {
  const fixture = associatedOccurrenceJoinFixture();
  fixture.profile.claim_patterns[1].for_each.association_bindings[0].operator =
    "reference:observed_in";
  const diagnostics = validateProfileSemanticsV034(fixture.profile);
  assert.ok(diagnostics.some(({ code }) =>
    code === "profile_falsifier_occurrence_binding_iterated_endpoint_invalid"
  ));
  assert.ok(diagnostics.some(({ code }) =>
    code === "profile_relation_iteration_binding_mismatch"
  ));
});

test("closed empty universal is explicitly vacuous while nonempty remains universal", () => {
  const empty = vacuousFixture();
  const emptyResult = evaluateVerificationProfileV034(empty);
  assert.equal(emptyResult.satisfaction, "satisfied", JSON.stringify(emptyResult.diagnostics));
  assert.deepEqual(emptyResult.diagnostics.find(({ code }) =>
    code === "for_each_evaluation"
  ).instance_results, []);
  assert.equal(emptyResult.diagnostics.find(({ code }) =>
    code === "for_each_evaluation"
  ).vacuously_satisfied, true);

  const nonempty = vacuousFixture(["ref-alpha", "ref-beta"]);
  nonempty.contract.references.find(({ reference_id: id }) => id === "ref-alpha")
    .identity.term = "member-α";
  nonempty.contract.references.find(({ reference_id: id }) => id === "ref-beta")
    .identity.term = "member-β";
  const nonemptyResult = evaluateVerificationProfileV034(nonempty);
  assert.equal(nonemptyResult.satisfaction, "satisfied");
  assert.equal(nonemptyResult.diagnostics.find(({ code }) =>
    code === "for_each_evaluation"
  ).vacuously_satisfied, false);
});

test("vacuity refuses violation, incomplete closure, missing closure, and incompatible cardinality", () => {
  const violation = vacuousFixture(["ref-one", "ref-two"]);
  violation.contract.claims.find(({ claim_id: claimId }) =>
    claimId === "claim-one-not-match"
  ).modality = "MUST";
  assert.equal(evaluateVerificationProfileV034(violation).satisfaction, "unsatisfied");

  const incomplete = vacuousFixture(["ref-one"]);
  incomplete.evaluation_input.reference_bindings.find(
    ({ role }) => role === "members"
  ).reference_ids = [];
  const incompleteResult = evaluateVerificationProfileV034(incomplete);
  assert.notEqual(incompleteResult.satisfaction, "satisfied");
  assert.ok(incompleteResult.diagnostics.some(({ code }) =>
    ["population_definition_missing", "for_each_empty_population_not_vacuously_closed"]
      .includes(code)
  ));

  const missingClosure = vacuousFixture();
  missingClosure.profile.reference_binding_patterns = [];
  assert.equal(evaluateVerificationProfileV034(missingClosure).satisfaction, "invalid");

  const wrongCardinality = vacuousFixture();
  wrongCardinality.profile.reference_roles.find(({ role }) => role === "members")
    .cardinality = "one_or_more";
  assert.equal(evaluateVerificationProfileV034(wrongCardinality).satisfaction, "invalid");
});

test("vacuity cannot be disguised or borrowed and weakening is digest-visible", () => {
  const fixture = vacuousFixture();
  const existential = structuredClone(fixture.profile);
  existential.claim_patterns[0].for_each.quantifier = "existential";
  assert.equal(validateProfileSchemaV034(existential), false);

  const borrowed = structuredClone(fixture.profile);
  borrowed.satisfaction_expression = { any_of: [
    { pattern: "complete-members" },
    { pattern: "each-member-does-not-match-target" }
  ] };
  assert.ok(validateProfileSemanticsV034(borrowed).some(({ code }) =>
    code === "profile_for_each_population_binding_not_dominating"
  ));

  const weakened = structuredClone(fixture.profile);
  delete weakened.claim_patterns[0].for_each.empty_behavior;
  assert.equal(validateProfileSchemaV034(weakened), false);
  assert.notEqual(profileDigestV034(fixture.profile), profileDigestV034(weakened));
});

test("empty iteration does not erase noniterated, evidence, relation, or collection obligations", () => {
  const missingGlobal = vacuousFixture();
  missingGlobal.profile.reference_roles.push({
    role: "required_resource", allowed_type_terms: ["cc:resource"],
    cardinality: "exactly_one"
  });
  assert.notEqual(evaluateVerificationProfileV034(missingGlobal).satisfaction, "satisfied");

  const evidence = vacuousFixture();
  evidence.profile.evidence_patterns.push({
    pattern_id: "delivered-member-proof",
    required_by_stage: "post_delivery",
    evidence_kind: "member-proof",
    verification_claim_pattern_id: "each-member-does-not-match-target"
  });
  evidence.profile.satisfaction_expression.all_of.push({
    pattern: "delivered-member-proof"
  });
  assert.ok(validateProfileSemanticsV034(evidence.profile).some(({ code }) =>
    code === "profile_for_each_vacuous_witness_dependency_invalid"
  ));

  const relation = vacuousFixture();
  relation.profile.claim_patterns.push({
    pattern_id: "global-evidence",
    required_by_stage: "post_delivery",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "target", operator: "boolean:exists",
      applicability_context: templateContext(),
      operands: [{ kind: "boolean", value: true }]
    }
  });
  relation.profile.relation_patterns.push({
    pattern_id: "global-supports-each-member",
    required_by_stage: "post_delivery",
    role: "depends_on",
    source_claim_pattern_id: "global-evidence",
    target_claim_pattern_id: "each-member-does-not-match-target"
  });
  relation.profile.satisfaction_expression.all_of.push(
    { pattern: "global-evidence" },
    { pattern: "global-supports-each-member" }
  );
  relation.contract.propositions.push({
    proposition_id: "prop-global-evidence", subject_reference_id: "ref-target",
    operator: "boolean:exists", applicability_context: context(),
    operands: [{ kind: "boolean", value: true }]
  });
  relation.contract.claims.push({
    claim_id: "claim-global-evidence", kind: "evidence", modality: "MUST",
    proposition_id: "prop-global-evidence"
  });
  const relationResult = evaluateVerificationProfileV034(relation);
  assert.notEqual(relationResult.satisfaction, "satisfied");
  assert.ok(relationResult.diagnostics.some(({ code }) =>
    code === "for_each_relation_mixed_vacuity_invalid"
  ), JSON.stringify(relationResult.diagnostics));

  const collection = vacuousFixture();
  collection.profile.claim_patterns.push(relation.profile.claim_patterns[1]);
  collection.profile.collection_patterns.push({
    pattern_id: "mixed-proof-collection",
    required_by_stage: "post_delivery",
    collection_kind: "closed_set",
    member_claim_pattern_ids: [
      "each-member-does-not-match-target", "global-evidence"
    ]
  });
  collection.profile.satisfaction_expression.all_of.push(
    { pattern: "global-evidence" },
    { pattern: "mixed-proof-collection" }
  );
  collection.contract.propositions.push({
    proposition_id: "prop-global-evidence", subject_reference_id: "ref-target",
    operator: "boolean:exists", applicability_context: context(),
    operands: [{ kind: "boolean", value: true }]
  });
  collection.contract.claims.push({
    claim_id: "claim-global-evidence", kind: "evidence", modality: "MUST",
    proposition_id: "prop-global-evidence"
  });
  collection.contract.collections.push({
    collection_id: "set-global-only", collection_kind: "closed_set",
    member_claim_ids: ["claim-global-evidence"]
  });
  const collectionResult = evaluateVerificationProfileV034(collection);
  assert.notEqual(collectionResult.satisfaction, "satisfied");
  assert.ok(collectionResult.diagnostics.some(({ code }) =>
    code === "for_each_collection_mixed_vacuity_invalid"
  ), JSON.stringify(collectionResult.diagnostics));
});

function iteratedRelationFixture() {
  const fixture = vacuousFixture(["ref-alpha", "ref-beta"]);
  for (const member of ["alpha", "beta"]) {
    fixture.contract.propositions.push({
      proposition_id: `prop-${member}-exists`,
      subject_reference_id: `ref-${member}`,
      operator: "boolean:exists",
      applicability_context: context(),
      operands: [{ kind: "boolean", value: true }]
    });
    fixture.contract.claims.push({
      claim_id: `claim-${member}-exists`, kind: "evidence", modality: "MUST",
      proposition_id: `prop-${member}-exists`
    });
    fixture.contract.relations.push({
      relation_id: `rel-${member}-proof-depends-on-existence`, role: "depends_on",
      source_claim_id: `claim-${member}-not-match`,
      target_claim_id: `claim-${member}-exists`
    });
  }
  fixture.profile.claim_patterns.push({
    pattern_id: "each-member-exists", required_by_stage: "post_delivery",
    claim_kind: "evidence", allowed_modalities: ["MUST"],
    for_each: {
      population_role: "members", member_role: "member",
      complete_population_pattern_id: "complete-members",
      quantifier: "universal", empty_behavior: "vacuously_satisfied"
    },
    proposition_template: {
      subject_role: "member", operator: "boolean:exists",
      applicability_context: templateContext(),
      operands: [{ kind: "boolean", value: true }]
    }
  });
  fixture.profile.relation_patterns.push({
    pattern_id: "member-proof-depends-on-existence",
    required_by_stage: "post_delivery", role: "depends_on",
    source_claim_pattern_id: "each-member-does-not-match-target",
    target_claim_pattern_id: "each-member-exists"
  });
  fixture.profile.satisfaction_expression.all_of.push(
    { pattern: "each-member-exists" },
    { pattern: "member-proof-depends-on-existence" }
  );
  return fixture;
}

test("iterated relations require the exact same-member relation population", () => {
  const accepted = iteratedRelationFixture();
  assert.deepEqual(validateProfileSemanticsV034(accepted.profile), []);
  assert.equal(evaluateVerificationProfileV034(accepted).satisfaction, "satisfied");

  const crossMember = iteratedRelationFixture();
  crossMember.contract.relations.push({
    relation_id: "rel-alpha-proof-depends-on-beta-existence", role: "depends_on",
    source_claim_id: "claim-alpha-not-match",
    target_claim_id: "claim-beta-exists"
  });
  const crossResult = evaluateVerificationProfileV034(crossMember);
  assert.equal(crossResult.satisfaction, "unsatisfied");
  assert.ok(crossResult.diagnostics.some((diagnostic) =>
    diagnostic.code === "for_each_relation_evaluation" &&
    diagnostic.exact_relation_population === false &&
    diagnostic.unexpected_or_duplicate_relation_ids.includes(
      "rel-alpha-proof-depends-on-beta-existence"
    )
  ));

  const duplicate = iteratedRelationFixture();
  duplicate.contract.relations.push({
    relation_id: "rel-alpha-proof-depends-on-existence-duplicate",
    role: "depends_on", source_claim_id: "claim-alpha-not-match",
    target_claim_id: "claim-alpha-exists"
  });
  const duplicateResult = evaluateVerificationProfileV034(duplicate);
  assert.equal(duplicateResult.satisfaction, "unsatisfied");
  assert.ok(duplicateResult.diagnostics.some((diagnostic) =>
    diagnostic.code === "for_each_relation_evaluation" &&
    diagnostic.exact_relation_population === false &&
    diagnostic.unexpected_or_duplicate_relation_ids.length === 2
  ));
});

function branchFixture(selected = "present") {
  const builder = contractBuilder();
  builder.addReference("ref-common", "cc:resource");
  for (const branch of ["present", "absent", "unavailable"]) {
    builder.addReference(`ref-${branch}`, "cc:state");
    builder.addEvidence({
      id: `${branch}-branch`, subject: `ref-${branch}`,
      operator: "reference:depends_on",
      operands: [{ kind: "reference", reference_id: "ref-common" }]
    });
  }
  const profile = profileBase("prototype.generic-branch-bindings", [
    { role: "common", allowed_type_terms: ["cc:resource"], cardinality: "exactly_one" },
    ...["present", "absent", "unavailable"].map((role) => ({
      role, allowed_type_terms: ["cc:state"], cardinality: "zero_or_one"
    }))
  ]);
  profile.binding_constraint_patterns = [];
  const branchExpressions = [];
  for (const branch of ["present", "absent", "unavailable"]) {
    const patterns = [];
    for (const role of ["present", "absent", "unavailable"]) {
      const patternId = `${branch}-${role}-${branch === role ? "required" : "forbidden"}`;
      profile.binding_constraint_patterns.push({
        pattern_id: patternId,
        required_by_stage: "post_delivery",
        role_kind: "reference",
        role,
        minimum: branch === role ? 1 : 0,
        maximum: branch === role ? 1 : 0
      });
      patterns.push({ pattern: patternId });
    }
    profile.claim_patterns.push({
      pattern_id: `${branch}-claim`, required_by_stage: "post_delivery",
      claim_kind: "evidence", allowed_modalities: ["MUST"],
      proposition_template: {
        subject_role: branch, operator: "reference:depends_on",
        applicability_context: templateContext(),
        operands: [{ kind: "reference", role: "common" }]
      }
    });
    patterns.push({ pattern: `${branch}-claim` });
    branchExpressions.push({ all_of: patterns });
  }
  profile.satisfaction_expression = {
    any_of: branchExpressions,
    branch_cardinality: "exactly_one"
  };
  const bindings = [{ role: "common", reference_ids: ["ref-common"] }];
  if (selected) bindings.push({ role: selected, reference_ids: [`ref-${selected}`] });
  return {
    contract: builder.contract,
    profile,
    evaluation_input: evaluationInput(bindings)
  };
}

test("each exact-one branch independently requires only common plus local input", () => {
  for (const branch of ["present", "absent", "unavailable"]) {
    const result = evaluateVerificationProfileV034(branchFixture(branch));
    assert.equal(result.satisfaction, "satisfied", `${branch}: ${JSON.stringify(result.diagnostics)}`);
  }
});

test("branch omission, substitution, and simultaneous matches are typed non-passes", () => {
  assert.notEqual(evaluateVerificationProfileV034(branchFixture(null)).satisfaction,
    "satisfied");
  const substituted = branchFixture("present");
  substituted.evaluation_input.reference_bindings.push({
    role: "unavailable", reference_ids: ["ref-unavailable"]
  });
  const ambiguous = evaluateVerificationProfileV034(substituted);
  assert.equal(ambiguous.satisfaction, "unsatisfied");
  assert.ok(ambiguous.diagnostics.some(({ code }) =>
    code === "satisfaction_branch_ambiguous"
  ));
});

test("a constraint-only optional role cannot become a caller-supplied branch label", () => {
  const fixture = branchFixture("present");
  fixture.profile.reference_roles.push({
    role: "branch_label", allowed_type_terms: ["cc:state"],
    cardinality: "zero_or_one"
  });
  fixture.profile.satisfaction_expression.any_of.forEach((branch, index) => {
    const patternId = `branch-${index + 1}-label-${index === 0
      ? "required"
      : "forbidden"}`;
    fixture.profile.binding_constraint_patterns.push({
      pattern_id: patternId, required_by_stage: "post_delivery",
      role_kind: "reference", role: "branch_label",
      minimum: index === 0 ? 1 : 0, maximum: index === 0 ? 1 : 0
    });
    branch.all_of.push({ pattern: patternId });
  });
  assert.ok(validateProfileSemanticsV034(fixture.profile).some(({ code }) =>
    code === "profile_branch_binding_constraint_selector_only"
  ));
});

test("nested and reordered exact-one expressions are deterministic and detached", () => {
  const fixture = branchFixture("unavailable");
  const before = structuredClone(fixture);
  const first = evaluateVerificationProfileV034(fixture);
  const reordered = structuredClone(fixture);
  reordered.profile.satisfaction_expression.any_of.reverse();
  reordered.profile.binding_constraint_patterns.reverse();
  reordered.profile.claim_patterns.reverse();
  reordered.evaluation_input.reference_bindings.reverse();
  reordered.contract.references.reverse();
  reordered.contract.claims.reverse();
  reordered.contract.propositions.reverse();
  const second = evaluateVerificationProfileV034(reordered);
  delete first.admission.profile_digest;
  delete second.admission.profile_digest;
  assert.deepEqual(first, second);
  assert.deepEqual(fixture, before);
  first.diagnostics.push({ code: "caller-mutation" });
  assert.notDeepEqual(first, evaluateVerificationProfileV034(fixture));
});

test("removing branch guards is invalid or digest-visible", () => {
  const fixture = branchFixture("present");
  const dangling = structuredClone(fixture.profile);
  dangling.binding_constraint_patterns.shift();
  assert.ok(validateProfileSemanticsV034(dangling).length > 0);
  const weakened = structuredClone(fixture.profile);
  const removed = weakened.binding_constraint_patterns.shift();
  const removeLeaf = (expression) => {
    if (expression.all_of) expression.all_of = expression.all_of.filter(
      ({ pattern }) => pattern !== removed.pattern_id
    );
  };
  weakened.satisfaction_expression.any_of.forEach(removeLeaf);
  assert.notEqual(profileDigestV034(fixture.profile), profileDigestV034(weakened));
  assert.ok(validateProfileSemanticsV034(weakened).length > 0);
});

test("iterated members cannot manufacture ordered collection semantics from IDs", () => {
  const fixture = vacuousFixture(["ref-zeta", "ref-able"]);
  fixture.profile.collection_patterns.push({
    pattern_id: "ordered-member-proofs", required_by_stage: "post_delivery",
    collection_kind: "ordered_sequence", match_mode: "exact",
    member_claim_pattern_ids: ["each-member-does-not-match-target"]
  });
  fixture.profile.satisfaction_expression.all_of.push({
    pattern: "ordered-member-proofs"
  });
  assert.ok(validateProfileSemanticsV034(fixture.profile).some(({ code }) =>
    code === "profile_ordered_collection_iterated_member_invalid"
  ));
});

function branchInputKindsFixture(selected = "left") {
  const builder = contractBuilder();
  for (const branch of ["left", "right"]) {
    builder.addReference(`ref-${branch}`, "cc:state");
    builder.contract.propositions.push(
      {
        proposition_id: `prop-${branch}-value`,
        subject_reference_id: `ref-${branch}`,
        operator: "number:equals",
        applicability_context: context(),
        operands: [{ kind: "number", value: branch === "left" ? 7 : 9 }]
      },
      {
        proposition_id: `prop-${branch}-verification`,
        subject_reference_id: `ref-${branch}`,
        operator: "boolean:exists",
        applicability_context: context(),
        operands: [{ kind: "boolean", value: true }]
      },
      {
        proposition_id: `prop-${branch}-falsifier`,
        subject_reference_id: `ref-${branch}`,
        operator: "boolean:exists",
        applicability_context: context(),
        operands: [{ kind: "boolean", value: false }]
      }
    );
    builder.contract.claims.push(
      {
        claim_id: `claim-${branch}-value`, kind: "behavior", modality: "MUST",
        proposition_id: `prop-${branch}-value`
      },
      {
        claim_id: `claim-${branch}-verification`, kind: "verification",
        modality: "MUST", proposition_id: `prop-${branch}-verification`,
        verification_method: "test_execution",
        falsifying_proposition_id: `prop-${branch}-falsifier`
      }
    );
    builder.contract.relations.push({
      relation_id: `rel-${branch}-verifies`, role: "verifies",
      source_claim_id: `claim-${branch}-verification`,
      target_claim_id: `claim-${branch}-value`
    });
  }
  const profile = profileBase("prototype.generic-branch-input-kinds", [
    ...["left", "right"].flatMap((branch) => [
      { role: branch, allowed_type_terms: ["cc:state"], cardinality: "zero_or_one" },
      { role: `${branch}_alias`, allowed_type_terms: ["cc:state"], cardinality: "zero_or_one" }
    ])
  ]);
  profile.number_roles = ["left", "right"].map((branch) => ({
    role: `${branch}_value`, cardinality: "zero_or_one", number_type: "integer"
  }));
  profile.binding_constraint_patterns = [];
  const branches = [];
  for (const branch of ["left", "right"]) {
    const sibling = branch === "left" ? "right" : "left";
    const localRoles = [branch, `${branch}_alias`, `${branch}_value`];
    const siblingRoles = [sibling, `${sibling}_alias`, `${sibling}_value`];
    const leaves = [];
    for (const role of localRoles) {
      const roleKind = role.endsWith("_value") ? "number" : "reference";
      const patternId = `${branch}-${role.replaceAll("_", "-")}-required`;
      profile.binding_constraint_patterns.push({
        pattern_id: patternId, required_by_stage: "post_delivery", role_kind: roleKind,
        role, minimum: 1, maximum: 1
      });
      leaves.push({ pattern: patternId });
    }
    for (const role of siblingRoles) {
      const roleKind = role.endsWith("_value") ? "number" : "reference";
      const patternId = `${branch}-${role.replaceAll("_", "-")}-forbidden`;
      profile.binding_constraint_patterns.push({
        pattern_id: patternId, required_by_stage: "post_delivery", role_kind: roleKind,
        role, minimum: 0, maximum: 0
      });
      leaves.push({ pattern: patternId });
    }
    profile.reference_binding_patterns.push({
      pattern_id: `${branch}-identity-binding`, required_by_stage: "post_delivery",
      comparison: "same_reference", roles: [branch, `${branch}_alias`]
    });
    profile.claim_patterns.push(
      {
        pattern_id: `${branch}-value-claim`, required_by_stage: "post_delivery",
        claim_kind: "behavior", allowed_modalities: ["MUST"],
        proposition_template: {
          subject_role: branch, operator: "number:equals",
          applicability_context: templateContext(),
          operands: [{ kind: "number", value_role: `${branch}_value` }]
        }
      },
      {
        pattern_id: `${branch}-verification-claim`, required_by_stage: "post_delivery",
        claim_kind: "verification", allowed_modalities: ["MUST"],
        proposition_template: {
          subject_role: `${branch}_alias`, operator: "boolean:exists",
          applicability_context: templateContext(),
          operands: [{ kind: "boolean", value: true }]
        },
        verification_methods: ["test_execution"],
        falsifying_proposition_template: {
          subject_role: `${branch}_alias`, operator: "boolean:exists",
          applicability_context: templateContext(),
          operands: [{ kind: "boolean", value: false }]
        }
      }
    );
    profile.relation_patterns.push({
      pattern_id: `${branch}-verification-relation`, required_by_stage: "post_delivery",
      role: "verifies", source_claim_pattern_id: `${branch}-verification-claim`,
      target_claim_pattern_id: `${branch}-value-claim`
    });
    profile.evidence_patterns.push({
      pattern_id: `${branch}-delivered-evidence`, required_by_stage: "post_delivery",
      evidence_kind: `${branch}-result`,
      verification_claim_pattern_id: `${branch}-verification-claim`
    });
    leaves.push(
      { pattern: `${branch}-identity-binding` },
      { pattern: `${branch}-value-claim` },
      { pattern: `${branch}-verification-claim` },
      { pattern: `${branch}-verification-relation` },
      { pattern: `${branch}-delivered-evidence` }
    );
    branches.push({ all_of: [{ all_of: leaves }] });
  }
  profile.satisfaction_expression = {
    any_of: branches, branch_cardinality: "exactly_one"
  };
  const value = selected === "left" ? 7 : 9;
  return {
    contract: builder.contract,
    profile,
    evaluation_input: {
      ...evaluationInput([
        { role: selected, reference_ids: [`ref-${selected}`] },
        { role: `${selected}_alias`, reference_ids: [`ref-${selected}`] }
      ]),
      number_bindings: [{ role: `${selected}_value`, value }],
      delivered_evidence: [{
        evidence_kind: `${selected}-result`,
        verification_claim_id: `claim-${selected}-verification`,
        satisfied: true
      }]
    }
  };
}

test("nested branches localize reference/number bindings, relations, and evidence", () => {
  for (const branch of ["left", "right"]) {
    const fixture = branchInputKindsFixture(branch);
    assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
    const result = evaluateVerificationProfileV034(fixture);
    assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  }
  const missingEvidence = branchInputKindsFixture("left");
  missingEvidence.evaluation_input.delivered_evidence = [];
  assert.notEqual(evaluateVerificationProfileV034(missingEvidence).satisfaction,
    "satisfied");
  const wrongBranchEvidence = branchInputKindsFixture("left");
  wrongBranchEvidence.evaluation_input.delivered_evidence = [{
    evidence_kind: "right-result",
    verification_claim_id: "claim-right-verification",
    satisfied: true
  }];
  assert.notEqual(evaluateVerificationProfileV034(wrongBranchEvidence).satisfaction,
    "satisfied");
});

function optionalReferenceCountFixture({ boundCount, requireCount = false } = {}) {
  const builder = contractBuilder();
  builder.addReference("ref-counted-alpha", "cc:resource");
  builder.addReference("ref-counted-beta", "cc:resource");
  builder.addReference("ref-count-capture", "cc:evidence");
  builder.addEvidence({
    id: "counted-items-captured", subject: "ref-count-capture",
    operator: "boolean:exists", operands: [{ kind: "boolean", value: true }]
  });
  const profile = profileBase("prototype.generic-optional-reference-count", [
    { role: "counted_items", allowed_type_terms: ["cc:resource"],
      cardinality: "zero_or_more" },
    { role: "count_capture", allowed_type_terms: ["cc:evidence"],
      cardinality: "exactly_one" }
  ]);
  profile.number_roles = [{
    role: "counted_item_total", cardinality: "zero_or_one", number_type: "integer",
    minimum: 0
  }];
  profile.reference_role_count_bindings = [{
    reference_role: "counted_items", number_role: "counted_item_total"
  }];
  profile.claim_patterns.push({
    pattern_id: "counted-items-captured", required_by_stage: "post_delivery",
    claim_kind: "evidence", allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "count_capture", operator: "boolean:exists",
      applicability_context: templateContext(), operands: [{ kind: "boolean", value: true }]
    }
  });
  profile.binding_constraint_patterns = requireCount ? [{
    pattern_id: "selected-count-required", required_by_stage: "post_delivery",
    role_kind: "number", role: "counted_item_total", minimum: 1, maximum: 1
  }] : [];
  profile.satisfaction_expression = { all_of: [
    { pattern: "counted-items-captured" },
    ...(requireCount ? [{ pattern: "selected-count-required" }] : [])
  ] };
  const input = evaluationInput([{
    role: "counted_items", reference_ids: ["ref-counted-alpha", "ref-counted-beta"]
  }, { role: "count_capture", reference_ids: ["ref-count-capture"] }]);
  if (boundCount !== undefined) input.number_bindings = [{
    role: "counted_item_total", value: boundCount
  }];
  return { contract: builder.contract, profile, evaluation_input: input };
}

test("optional integer reference counts validate bound matches and mismatches", () => {
  const matching = optionalReferenceCountFixture({ boundCount: 2 });
  assert.deepEqual(validateProfileSemanticsV034(matching.profile), []);
  assert.equal(evaluateVerificationProfileV034(matching).satisfaction, "satisfied");

  const mismatching = optionalReferenceCountFixture({ boundCount: 1 });
  const result = evaluateVerificationProfileV034(mismatching);
  assert.notEqual(result.satisfaction, "satisfied");
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "reference_role_count_binding_mismatch"));
});

test("optional integer reference counts are missing only when a selected branch requires them", () => {
  const optional = optionalReferenceCountFixture();
  assert.deepEqual(validateProfileSemanticsV034(optional.profile), []);
  const optionalResult = evaluateVerificationProfileV034(optional);
  assert.equal(optionalResult.satisfaction, "satisfied", JSON.stringify(optionalResult.diagnostics));
  assert.equal(optionalResult.diagnostics.some(({ code }) =>
    code === "required_number_role_unbound"), false);

  const required = optionalReferenceCountFixture({ requireCount: true });
  assert.deepEqual(validateProfileSemanticsV034(required.profile), []);
  const requiredResult = evaluateVerificationProfileV034(required);
  assert.equal(requiredResult.satisfaction, "unsatisfied");
  assert.ok(requiredResult.diagnostics.some(({ code }) =>
    code === "binding_constraint_unsatisfied"));
});

function emptyBindingPresenceFixture({
  bindingPresence = "required", includeBinding = true, ambiguous = false
} = {}) {
  const builder = contractBuilder();
  builder.addPopulation({ id: "ref-empty-population", members: [] });
  const profile = profileBase("prototype.generic-empty-binding-presence", [
    { role: "empty_population", allowed_type_terms: ["cc:population"],
      cardinality: "exactly_one" },
    { role: "empty_members", allowed_type_terms: ["cc:resource"],
      cardinality: "zero_or_more" }
  ]);
  profile.reference_binding_patterns.push({
    pattern_id: "complete-empty-members", required_by_stage: "post_delivery",
    comparison: "complete_population", roles: ["empty_population", "empty_members"],
    applicability_context: templateContext()
  });
  const presenceConstraint = (patternId) => ({
    pattern_id: patternId, required_by_stage: "post_delivery", role_kind: "reference",
    role: "empty_members", minimum: 0,
    ...(bindingPresence === "forbidden" ? { maximum: 0 } : {}),
    binding_presence: bindingPresence
  });
  profile.binding_constraint_patterns = [presenceConstraint("empty-binding-presence")];
  if (ambiguous) profile.binding_constraint_patterns.push(
    presenceConstraint("same-empty-binding-presence")
  );
  profile.satisfaction_expression = ambiguous ? {
    any_of: profile.binding_constraint_patterns.map(({ pattern_id: patternId }) => ({
      all_of: [{ pattern: "complete-empty-members" }, { pattern: patternId }]
    })),
    branch_cardinality: "exactly_one"
  } : { all_of: [
    { pattern: "complete-empty-members" }, { pattern: "empty-binding-presence" }
  ] };
  const bindings = [
    { role: "empty_population", reference_ids: ["ref-empty-population"] },
    ...(includeBinding ? [{ role: "empty_members", reference_ids: [] }] : [])
  ];
  return { contract: builder.contract, profile, evaluation_input: evaluationInput(bindings) };
}

test("required binding presence distinguishes explicit empty from omission", () => {
  const explicit = emptyBindingPresenceFixture();
  assert.equal(validateProfileSchemaV034(explicit.profile), true,
    JSON.stringify(validateProfileSchemaV034.errors));
  assert.deepEqual(validateProfileSemanticsV034(explicit.profile), []);
  assert.equal(evaluateVerificationProfileV034(explicit).satisfaction, "satisfied");

  const omitted = emptyBindingPresenceFixture({ includeBinding: false });
  const result = evaluateVerificationProfileV034(omitted);
  assert.notEqual(result.satisfaction, "satisfied");
  assert.ok(result.diagnostics.some(({ code, required_binding_presence: presence }) =>
    code === "binding_constraint_unsatisfied" && presence === "required"));
});

test("forbidden binding presence rejects an explicitly supplied empty binding", () => {
  const fixture = emptyBindingPresenceFixture({ bindingPresence: "forbidden" });
  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  const result = evaluateVerificationProfileV034(fixture);
  assert.notEqual(result.satisfaction, "satisfied");
  assert.ok(result.diagnostics.some(({ code, required_binding_presence: presence }) =>
    code === "binding_constraint_unsatisfied" && presence === "forbidden"));

  const invalid = emptyBindingPresenceFixture({ bindingPresence: "forbidden" });
  delete invalid.profile.binding_constraint_patterns[0].maximum;
  assert.ok(validateProfileSemanticsV034(invalid.profile).some(({ code }) =>
    code === "profile_binding_constraint_presence_invalid"));
});

test("two required empty-binding branches produce typed exactly-one ambiguity", () => {
  const fixture = emptyBindingPresenceFixture({ ambiguous: true });
  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  const result = evaluateVerificationProfileV034(fixture);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "satisfaction_branch_ambiguous"));
});

function relationBoundOccurrenceFixture() {
  const builder = contractBuilder();
  const occurrences = ["ref-relation-occurrence-alpha", "ref-relation-occurrence-beta"];
  const targets = ["ref-relation-target-alpha", "ref-relation-target-beta"];
  builder.addPopulation({ id: "ref-relation-occurrence-population", members: occurrences });
  builder.addPopulation({ id: "ref-relation-target-population", members: targets });
  for (const occurrence of occurrences) builder.contract.references.find(
    ({ reference_id: referenceId }) => referenceId === occurrence
  ).type_term = "cc:evidence_occurrence";
  for (const target of targets) builder.contract.references.find(
    ({ reference_id: referenceId }) => referenceId === target
  ).type_term = "cc:state";
  builder.addReference("ref-relation-source", "cc:resource");
  builder.addReference("ref-relation-attempt", "cc:event");
  builder.addReference("ref-relation-verifier", "cc:test");
  for (const suffix of ["alpha", "beta"]) {
    builder.addEvidence({
      id: `relation-occurrence-${suffix}-target`,
      subject: `ref-relation-occurrence-${suffix}`,
      operator: "reference:authenticates",
      context: context("during", ["ref-relation-attempt"]),
      operands: [{ kind: "reference", reference_id: `ref-relation-target-${suffix}` }]
    });
    const targetPropositionId = `prop-relation-target-${suffix}`;
    const verificationPropositionId = `prop-relation-verification-${suffix}`;
    const falsifierPropositionId = `prop-relation-falsifier-${suffix}`;
    builder.contract.propositions.push(
      {
        proposition_id: targetPropositionId,
        subject_reference_id: `ref-relation-target-${suffix}`,
        operator: "reference:has_source_of_record",
        applicability_context: context("during", ["ref-relation-attempt"]),
        operands: [{ kind: "reference", reference_id: "ref-relation-source" }]
      },
      {
        proposition_id: verificationPropositionId,
        subject_reference_id: "ref-relation-verifier",
        operator: "reference:reads",
        applicability_context: context("during", ["ref-relation-attempt"]),
        operands: [
          { kind: "reference", reference_id: `ref-relation-occurrence-${suffix}` },
          { kind: "reference", reference_id: `ref-relation-target-${suffix}` },
          { kind: "reference", reference_id: "ref-relation-source" }
        ]
      },
      {
        proposition_id: falsifierPropositionId,
        subject_reference_id: `ref-relation-target-${suffix}`,
        operator: "reference:does_not_have_source_of_record",
        applicability_context: context("during", ["ref-relation-attempt"]),
        operands: [{ kind: "reference", reference_id: "ref-relation-source" }]
      }
    );
    builder.contract.claims.push(
      { claim_id: `claim-relation-target-${suffix}`, kind: "behavior", modality: "MUST",
        proposition_id: targetPropositionId },
      { claim_id: `claim-relation-verification-${suffix}`, kind: "verification",
        modality: "MUST", proposition_id: verificationPropositionId,
        verification_method: "test_execution",
        falsifying_proposition_id: falsifierPropositionId }
    );
    builder.contract.relations.push({
      relation_id: `rel-relation-verifies-${suffix}`, role: "verifies",
      source_claim_id: `claim-relation-verification-${suffix}`,
      target_claim_id: `claim-relation-target-${suffix}`
    });
  }
  const profile = profileBase("prototype.generic-relation-bound-occurrence", [
    { role: "occurrence_population", allowed_type_terms: ["cc:population"],
      cardinality: "exactly_one" },
    { role: "occurrences", allowed_type_terms: ["cc:evidence_occurrence"],
      cardinality: "zero_or_more" },
    { role: "target_population", allowed_type_terms: ["cc:population"],
      cardinality: "exactly_one" },
    { role: "targets", allowed_type_terms: ["cc:state"], cardinality: "zero_or_more" },
    { role: "source", allowed_type_terms: ["cc:resource"], cardinality: "exactly_one" },
    { role: "attempt", allowed_type_terms: ["cc:event"], cardinality: "exactly_one" },
    { role: "verifier", allowed_type_terms: ["cc:test"], cardinality: "exactly_one" }
  ]);
  profile.verification_falsifier_policy = "controlled_complement_per_target";
  profile.reference_binding_patterns.push(
    { pattern_id: "complete-relation-occurrences", required_by_stage: "post_delivery",
      comparison: "complete_population", roles: ["occurrence_population", "occurrences"],
      applicability_context: templateContext("during", ["attempt"]) },
    { pattern_id: "complete-relation-targets", required_by_stage: "post_delivery",
      comparison: "complete_population", roles: ["target_population", "targets"],
      applicability_context: templateContext("during", ["attempt"]) }
  );
  const each = {
    population_role: "occurrences", member_role: "occurrence",
    complete_population_pattern_id: "complete-relation-occurrences",
    quantifier: "universal", empty_behavior: "vacuously_satisfied",
    association_bindings: [{
      associated_role: "targets", operator: "reference:authenticates",
      member_position: "subject", associated_position: "reference_operand",
      applicability_context: templateContext("during", ["attempt"]),
      complete_population_pattern_id: "complete-relation-targets"
    }]
  };
  profile.claim_patterns.push(
    {
      pattern_id: "each-relation-target", required_by_stage: "post_delivery",
      claim_kind: "behavior", allowed_modalities: ["MUST"], for_each: structuredClone(each),
      proposition_template: {
        subject_role: "targets", operator: "reference:has_source_of_record",
        applicability_context: templateContext("during", ["attempt"]),
        operands: [{ kind: "reference", role: "source" }]
      }
    },
    {
      pattern_id: "verify-each-relation-target", required_by_stage: "post_delivery",
      claim_kind: "verification", allowed_modalities: ["MUST"],
      for_each: structuredClone(each),
      proposition_template: {
        subject_role: "verifier", operator: "reference:reads",
        applicability_context: templateContext("during", ["attempt"]),
        operands: [
          { kind: "reference", role: "occurrence" },
          { kind: "reference", role: "targets" },
          { kind: "reference", role: "source" }
        ]
      },
      verification_methods: ["test_execution"],
      falsifying_proposition_template: {
        subject_role: "targets", operator: "reference:does_not_have_source_of_record",
        applicability_context: templateContext("during", ["attempt"]),
        operands: [{ kind: "reference", role: "source" }]
      }
    }
  );
  profile.relation_patterns.push({
    pattern_id: "relation-verifies-each-target", required_by_stage: "post_delivery",
    role: "verifies", source_claim_pattern_id: "verify-each-relation-target",
    target_claim_pattern_id: "each-relation-target"
  });
  profile.falsifier_condition_bindings = [{
    relation_pattern_id: "relation-verifies-each-target",
    applicability_context: templateContext("during", ["attempt"])
  }];
  const join = (role, targetPositions, verificationPositions, falsifierPositions) => ({
    role, target_positions: targetPositions, verification_positions: verificationPositions,
    falsifier_positions: falsifierPositions
  });
  profile.falsifier_occurrence_bindings = [{
    relation_pattern_id: "relation-verifies-each-target",
    reference_role_joins: [
      join("occurrence", [], ["reference_operand"], []),
      join("targets", ["subject"], ["reference_operand"], ["subject"]),
      join("source", ["reference_operand"], ["reference_operand"], ["reference_operand"]),
      join("attempt", ["applicability_operand"], ["applicability_operand"],
        ["applicability_operand"])
    ],
    number_role_joins: [], applicability_join: "exact_scope"
  }];
  profile.satisfaction_expression = { all_of: [
    { pattern: "complete-relation-occurrences" }, { pattern: "complete-relation-targets" },
    { pattern: "each-relation-target" }, { pattern: "verify-each-relation-target" },
    { pattern: "relation-verifies-each-target" }
  ] };
  return {
    contract: builder.contract, profile,
    evaluation_input: evaluationInput([
      { role: "occurrence_population", reference_ids: ["ref-relation-occurrence-population"] },
      { role: "occurrences", reference_ids: occurrences },
      { role: "target_population", reference_ids: ["ref-relation-target-population"] },
      { role: "targets", reference_ids: targets },
      { role: "source", reference_ids: ["ref-relation-source"] },
      { role: "attempt", reference_ids: ["ref-relation-attempt"] },
      { role: "verifier", reference_ids: ["ref-relation-verifier"] }
    ])
  };
}

test("identical relation iteration binds a member omitted from target and falsifier", () => {
  const fixture = relationBoundOccurrenceFixture();
  assert.equal(validateProfileSchemaV034(fixture.profile), true,
    JSON.stringify(validateProfileSchemaV034.errors));
  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  assert.equal(evaluateVerificationProfileV034(fixture).satisfaction, "satisfied");

  const nonMember = structuredClone(fixture.profile);
  const join = nonMember.falsifier_occurrence_bindings[0].reference_role_joins.find(
    ({ role }) => role === "source"
  );
  join.target_positions = [];
  join.falsifier_positions = [];
  assert.ok(validateProfileSemanticsV034(nonMember).some(({ code }) =>
    code === "profile_falsifier_occurrence_empty_position_invalid"));

  const incompatible = structuredClone(fixture.profile);
  incompatible.claim_patterns.find(({ pattern_id: id }) =>
    id === "verify-each-relation-target").for_each.member_role = "other_occurrence";
  assert.ok(validateProfileSemanticsV034(incompatible).some(({ code }) =>
    code === "profile_falsifier_occurrence_empty_position_invalid"));
});

test("relation-bound occurrence identity rejects cross-occurrence verification substitution", () => {
  const fixture = relationBoundOccurrenceFixture();
  const relations = fixture.contract.relations.filter(({ relation_id: id }) =>
    id.startsWith("rel-relation-verifies-"));
  const targets = relations.map(({ target_claim_id: targetClaimId }) => targetClaimId).reverse();
  relations.forEach((relation, index) => { relation.target_claim_id = targets[index]; });
  const result = evaluateVerificationProfileV034(fixture);
  assert.notEqual(result.satisfaction, "satisfied");
  assert.ok(result.diagnostics.some(({ code }) => code === "for_each_relation_evaluation"));
});

function joinFixture() {
  const builder = contractBuilder();
  const roles = {
    evidence_occurrence: ["ref-occurrence", "cc:evidence_occurrence"],
    target: ["ref-target", "cc:state"],
    source: ["ref-source", "cc:resource"],
    observation_attempt: ["ref-attempt", "cc:event"],
    observed_population: ["ref-observed-population", "cc:resource"],
    endpoint_version: ["ref-version", "cc:state"],
    conclusion: ["ref-conclusion", "cc:state"],
    invalidating_condition: ["ref-condition", "cc:state"],
    verifier: ["ref-verifier", "cc:process"]
  };
  for (const [, [referenceId, typeTerm]] of Object.entries(roles)) {
    builder.addReference(referenceId, typeTerm);
  }
  builder.contract.references.find(({ reference_id: id }) => id === "ref-target")
    .identity.term = "target-λ";
  const joinedOperandRoles = [
    "target", "source", "observed_population",
    "endpoint_version", "conclusion", "invalidating_condition"
  ];
  const joinedOperandIds = joinedOperandRoles.map((role) => ({
    kind: "reference", reference_id: roles[role][0]
  }));
  builder.contract.propositions.push(
    {
      proposition_id: "prop-target-behavior",
      subject_reference_id: roles.evidence_occurrence[0],
      operator: "reference:authenticates",
      applicability_context: context("during", [roles.observation_attempt[0]]),
      operands: structuredClone(joinedOperandIds)
    },
    {
      proposition_id: "prop-verification",
      subject_reference_id: roles.verifier[0],
      operator: "reference:reads",
      applicability_context: context("during", [roles.observation_attempt[0]]),
      operands: [
        { kind: "reference", reference_id: roles.evidence_occurrence[0] },
        ...structuredClone(joinedOperandIds)
      ]
    },
    {
      proposition_id: "prop-falsifier",
      subject_reference_id: roles.evidence_occurrence[0],
      operator: "reference:does_not_authenticate",
      applicability_context: context("during", [roles.observation_attempt[0]]),
      operands: structuredClone(joinedOperandIds)
    }
  );
  builder.contract.claims.push(
    {
      claim_id: "claim-target-behavior", kind: "behavior", modality: "MUST",
      proposition_id: "prop-target-behavior"
    },
    {
      claim_id: "claim-verification", kind: "verification", modality: "MUST",
      proposition_id: "prop-verification", verification_method: "test_execution",
      falsifying_proposition_id: "prop-falsifier"
    }
  );
  builder.contract.relations.push({
    relation_id: "rel-verifies", role: "verifies",
    source_claim_id: "claim-verification", target_claim_id: "claim-target-behavior"
  });
  const profile = profileBase("prototype.generic-occurrence-join",
    Object.entries(roles).map(([role, [, typeTerm]]) => ({
      role, allowed_type_terms: role === "target" ? ["cc:resource", "cc:state"] : [typeTerm],
      cardinality: "exactly_one"
    })));
  profile.verification_falsifier_policy = "controlled_complement_per_target";
  const operandTemplates = joinedOperandRoles.map((role) => ({
    kind: "reference", role
  }));
  profile.claim_patterns.push(
    {
      pattern_id: "target-behavior", required_by_stage: "post_delivery",
      claim_kind: "behavior", allowed_modalities: ["MUST"],
      proposition_template: {
        subject_role: "evidence_occurrence", operator: "reference:authenticates",
        applicability_context: templateContext("during", ["observation_attempt"]),
        operands: structuredClone(operandTemplates)
      }
    },
    {
      pattern_id: "verification", required_by_stage: "post_delivery",
      claim_kind: "verification", allowed_modalities: ["MUST"],
      proposition_template: {
        subject_role: "verifier", operator: "reference:reads",
        applicability_context: templateContext("during", ["observation_attempt"]),
        operands: [
          { kind: "reference", role: "evidence_occurrence" },
          ...structuredClone(operandTemplates)
        ]
      },
      verification_methods: ["test_execution"],
      falsifying_proposition_template: {
        subject_role: "evidence_occurrence", operator: "reference:does_not_authenticate",
        applicability_context: templateContext("during", ["observation_attempt"]),
        operands: structuredClone(operandTemplates)
      }
    }
  );
  profile.relation_patterns.push({
    pattern_id: "verification-targets-behavior", required_by_stage: "post_delivery",
    role: "verifies", source_claim_pattern_id: "verification",
    target_claim_pattern_id: "target-behavior"
  });
  profile.falsifier_condition_bindings = [{
    relation_pattern_id: "verification-targets-behavior",
    applicability_context: templateContext("during", ["observation_attempt"])
  }];
  const roleJoin = (role, targetPosition = "reference_operand") => ({
    role,
    target_positions: [targetPosition],
    verification_positions: ["reference_operand"],
    falsifier_positions: [targetPosition]
  });
  profile.falsifier_occurrence_bindings = [{
    relation_pattern_id: "verification-targets-behavior",
    reference_role_joins: [
      roleJoin("evidence_occurrence", "subject"),
      ...joinedOperandRoles.map((role) => roleJoin(role)),
      {
        role: "observation_attempt",
        target_positions: ["applicability_operand"],
        verification_positions: ["applicability_operand"],
        falsifier_positions: ["applicability_operand"]
      }
    ],
    number_role_joins: [],
    applicability_join: "exact_scope"
  }];
  profile.satisfaction_expression = { all_of: [
    { pattern: "target-behavior" },
    { pattern: "verification" },
    { pattern: "verification-targets-behavior" }
  ] };
  return {
    contract: builder.contract,
    profile,
    evaluation_input: evaluationInput(Object.entries(roles).map(
      ([role, [referenceId]]) => ({ role, reference_ids: [referenceId] })
    ))
  };
}

test("exact occurrence joins accept the same raw occurrence and Unicode/type alternatives", () => {
  const fixture = joinFixture();
  assert.equal(validateProfileSchemaV034(fixture.profile), true,
    JSON.stringify(validateProfileSchemaV034.errors));
  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  const result = evaluateVerificationProfileV034(fixture);
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "falsifier_occurrence_join_evaluation"
  ));
});

test("shared-operand joins permit mode differences but reject unjoined scope operands", () => {
  const accepted = joinFixture();
  accepted.profile.falsifier_occurrence_bindings[0].applicability_join =
    "shared_operands";
  const verificationTemplate = accepted.profile.claim_patterns.find(
    ({ pattern_id: id }) => id === "verification"
  ).proposition_template;
  verificationTemplate.applicability_context.mode = "before";
  accepted.contract.propositions.find(({ proposition_id: id }) =>
    id === "prop-verification"
  ).applicability_context.mode = "before";
  assert.deepEqual(validateProfileSemanticsV034(accepted.profile), []);
  assert.equal(evaluateVerificationProfileV034(accepted).satisfaction, "satisfied");

  const extra = structuredClone(accepted);
  extra.profile.reference_roles.push({
    role: "verification_scope", allowed_type_terms: ["cc:state"],
    cardinality: "exactly_one"
  });
  extra.contract.references.push({
    reference_id: "ref-verification-scope", type_term: "cc:state",
    identity: { kind: "profile_term", term: "verification-scope" }
  });
  extra.evaluation_input.reference_bindings.push({
    role: "verification_scope", reference_ids: ["ref-verification-scope"]
  });
  extra.profile.claim_patterns.find(({ pattern_id: id }) => id === "verification")
    .proposition_template.applicability_context.operand_roles.push(
      "verification_scope"
    );
  extra.contract.propositions.find(({ proposition_id: id }) =>
    id === "prop-verification"
  ).applicability_context.operand_reference_ids.push("ref-verification-scope");
  assert.ok(validateProfileSemanticsV034(extra.profile).some(({ code }) =>
    code === "profile_falsifier_occurrence_applicability_not_completely_joined"
  ));
});

test("adequacy enumerates every new guarantee-bearing field", () => {
  const fixture = joinFixture();
  const branch = branchFixture("present");
  fixture.profile.binding_constraint_patterns =
    structuredClone(branch.profile.binding_constraint_patterns);
  fixture.profile.reference_roles.push(...branch.profile.reference_roles.filter(
    ({ role }) => !fixture.profile.reference_roles.some(
      ({ role: candidate }) => candidate === role
    )
  ));
  fixture.profile.satisfaction_expression =
    structuredClone(branch.profile.satisfaction_expression);
  const vacuous = vacuousFixture();
  fixture.profile.claim_patterns.push(vacuous.profile.claim_patterns[0]);
  fixture.profile.reference_binding_patterns.push(
    vacuous.profile.reference_binding_patterns[0]
  );
  const requirements = new Set(genericMechanismCoverageRequirements(
    fixture.profile
  ).map(({ profile_json_pointer: pointer, weakening_class: weakeningClass }) =>
    `${pointer}\0${weakeningClass}`
  ));
  for (const expected of [
    "/claim_patterns/2/for_each/complete_population_pattern_id\0population_membership_weakening",
    "/claim_patterns/2/for_each/empty_behavior\0population_membership_weakening",
    "/reference_binding_patterns/0/comparison\0binding_constraint_weakening",
    "/binding_constraint_patterns/0/minimum\0binding_constraint_weakening",
    "/binding_constraint_patterns/0/maximum\0binding_constraint_weakening",
    "/satisfaction_expression/branch_cardinality\0satisfaction_branch_broadening",
    "/falsifier_occurrence_bindings/0/reference_role_joins/0/role\0falsifier_weakening",
    "/falsifier_occurrence_bindings/0/reference_role_joins/0/target_positions/0\0falsifier_weakening",
    "/falsifier_occurrence_bindings/0/number_role_joins\0falsifier_weakening",
    "/falsifier_occurrence_bindings/0/applicability_join\0falsifier_weakening"
  ]) assert.ok(requirements.has(expected), expected);
});

test("occurrence joins compose with a branch that omits all success-only roles", () => {
  const fixture = joinFixture();
  fixture.profile.reference_roles.forEach((role) => {
    role.cardinality = "zero_or_one";
  });
  fixture.profile.reference_roles.push({
    role: "unavailable", allowed_type_terms: ["cc:state"],
    cardinality: "zero_or_one"
  });
  fixture.contract.references.push({
    reference_id: "ref-unavailable", type_term: "cc:state",
    identity: { kind: "profile_term", term: "unavailable" }
  });
  fixture.contract.propositions.push({
    proposition_id: "prop-unavailable", subject_reference_id: "ref-unavailable",
    operator: "boolean:exists", applicability_context: context(),
    operands: [{ kind: "boolean", value: true }]
  });
  fixture.contract.claims.push({
    claim_id: "claim-unavailable", kind: "evidence", modality: "MUST",
    proposition_id: "prop-unavailable"
  });
  fixture.profile.claim_patterns.push({
    pattern_id: "unavailable-claim", required_by_stage: "post_delivery",
    claim_kind: "evidence", allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "unavailable", operator: "boolean:exists",
      applicability_context: templateContext(),
      operands: [{ kind: "boolean", value: true }]
    }
  });
  fixture.profile.binding_constraint_patterns = [];
  const successLeaves = [];
  const unavailableLeaves = [];
  for (const { role } of fixture.profile.reference_roles) {
    for (const [branch, positive] of [
      ["success", role !== "unavailable"],
      ["unavailable", role === "unavailable"]
    ]) {
      const patternId = `${branch}-${role.replaceAll("_", "-")}-${positive
        ? "required"
        : "forbidden"}`;
      fixture.profile.binding_constraint_patterns.push({
        pattern_id: patternId, required_by_stage: "post_delivery",
        role_kind: "reference", role,
        minimum: positive ? 1 : 0, maximum: positive ? 1 : 0
      });
      (branch === "success" ? successLeaves : unavailableLeaves).push({
        pattern: patternId
      });
    }
  }
  successLeaves.push(...fixture.profile.satisfaction_expression.all_of);
  unavailableLeaves.push({ pattern: "unavailable-claim" });
  fixture.profile.satisfaction_expression = {
    any_of: [
      { all_of: successLeaves },
      { all_of: unavailableLeaves }
    ],
    branch_cardinality: "exactly_one"
  };
  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  assert.equal(evaluateVerificationProfileV034(fixture).satisfaction, "satisfied");

  fixture.evaluation_input.reference_bindings = [{
    role: "unavailable", reference_ids: ["ref-unavailable"]
  }];
  assert.equal(evaluateVerificationProfileV034(fixture).satisfaction, "satisfied");
});

function numberJoinFixture() {
  const builder = contractBuilder();
  builder.addReference("ref-occurrence", "cc:evidence_occurrence");
  builder.contract.propositions.push(
    {
      proposition_id: "prop-number-target",
      subject_reference_id: "ref-occurrence", operator: "number:equals",
      applicability_context: context(), operands: [{ kind: "number", value: 42 }]
    },
    {
      proposition_id: "prop-number-verification",
      subject_reference_id: "ref-occurrence", operator: "number:matches",
      applicability_context: context(), operands: [{ kind: "number", value: 42 }]
    },
    {
      proposition_id: "prop-number-falsifier",
      subject_reference_id: "ref-occurrence", operator: "number:not_equals",
      applicability_context: context(), operands: [{ kind: "number", value: 42 }]
    }
  );
  builder.contract.claims.push(
    {
      claim_id: "claim-number-target", kind: "behavior", modality: "MUST",
      proposition_id: "prop-number-target"
    },
    {
      claim_id: "claim-number-verification", kind: "verification", modality: "MUST",
      proposition_id: "prop-number-verification", verification_method: "test_execution",
      falsifying_proposition_id: "prop-number-falsifier"
    }
  );
  builder.contract.relations.push({
    relation_id: "rel-number-verifies", role: "verifies",
    source_claim_id: "claim-number-verification",
    target_claim_id: "claim-number-target"
  });
  const profile = profileBase("prototype.generic-number-occurrence-join", [{
    role: "occurrence", allowed_type_terms: ["cc:evidence_occurrence"],
    cardinality: "exactly_one"
  }]);
  profile.number_roles = [{
    role: "temporal_value", cardinality: "exactly_one", number_type: "integer"
  }];
  profile.verification_falsifier_policy = "controlled_complement_per_target";
  profile.claim_patterns.push(
    {
      pattern_id: "number-target", required_by_stage: "post_delivery",
      claim_kind: "behavior", allowed_modalities: ["MUST"],
      proposition_template: {
        subject_role: "occurrence", operator: "number:equals",
        applicability_context: templateContext(),
        operands: [{ kind: "number", value_role: "temporal_value" }]
      }
    },
    {
      pattern_id: "number-verification", required_by_stage: "post_delivery",
      claim_kind: "verification", allowed_modalities: ["MUST"],
      proposition_template: {
        subject_role: "occurrence", operator: "number:matches",
        applicability_context: templateContext(),
        operands: [{ kind: "number", value_role: "temporal_value" }]
      },
      verification_methods: ["test_execution"],
      falsifying_proposition_template: {
        subject_role: "occurrence", operator: "number:not_equals",
        applicability_context: templateContext(),
        operands: [{ kind: "number", value_role: "temporal_value" }]
      }
    }
  );
  profile.relation_patterns.push({
    pattern_id: "number-verifies", required_by_stage: "post_delivery",
    role: "verifies", source_claim_pattern_id: "number-verification",
    target_claim_pattern_id: "number-target"
  });
  profile.falsifier_condition_bindings = [{
    relation_pattern_id: "number-verifies", applicability_context: templateContext()
  }];
  profile.falsifier_occurrence_bindings = [{
    relation_pattern_id: "number-verifies",
    reference_role_joins: [{
      role: "occurrence", target_positions: ["subject"],
      verification_positions: ["subject"], falsifier_positions: ["subject"]
    }],
    number_role_joins: [{ role: "temporal_value" }],
    applicability_join: "exact_scope"
  }];
  profile.satisfaction_expression = { all_of: [
    { pattern: "number-target" }, { pattern: "number-verification" },
    { pattern: "number-verifies" }
  ] };
  return {
    contract: builder.contract,
    profile,
    evaluation_input: {
      ...evaluationInput([{ role: "occurrence", reference_ids: ["ref-occurrence"] }]),
      number_bindings: [{ role: "temporal_value", value: 42 }]
    }
  };
}

test("number-role occurrence joins require the exact temporal operand", () => {
  const fixture = numberJoinFixture();
  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  assert.equal(evaluateVerificationProfileV034(fixture).satisfaction, "satisfied");
  const wrong = numberJoinFixture();
  wrong.contract.propositions.find(({ proposition_id: id }) =>
    id === "prop-number-falsifier"
  ).operands[0].value = 43;
  assert.notEqual(evaluateVerificationProfileV034(wrong).satisfaction, "satisfied");
  const missing = numberJoinFixture();
  missing.evaluation_input.number_bindings = [];
  assert.notEqual(evaluateVerificationProfileV034(missing).satisfaction, "satisfied");
});

for (const role of [
  "evidence_occurrence", "target", "source", "observation_attempt",
  "observed_population", "endpoint_version", "conclusion",
  "invalidating_condition"
]) test(`occurrence join rejects wrong ${role}`, () => {
  const fixture = joinFixture();
  const binding = fixture.evaluation_input.reference_bindings.find(
    ({ role: candidate }) => candidate === role
  );
  fixture.contract.references.push({
    reference_id: `ref-wrong-${role}`,
    type_term: fixture.contract.references.find(
      ({ reference_id: id }) => id === binding.reference_ids[0]
    ).type_term,
    identity: { kind: "profile_term", term: `wrong-${role}` }
  });
  const falsifier = fixture.contract.propositions.find(
    ({ proposition_id: id }) => id === "prop-falsifier"
  );
  if (role === "evidence_occurrence") {
    falsifier.subject_reference_id = `ref-wrong-${role}`;
  } else if (role === "observation_attempt") {
    falsifier.applicability_context.operand_reference_ids = [`ref-wrong-${role}`];
  } else {
    const index = [
      "target", "source", "observed_population", "endpoint_version",
      "conclusion", "invalidating_condition"
    ].indexOf(role);
    falsifier.operands[index].reference_id = `ref-wrong-${role}`;
  }
  assert.notEqual(evaluateVerificationProfileV034(fixture).satisfaction, "satisfied");
});

test("join rejects missing fields, alias-concealed substitution, and unrelated verifier", () => {
  const missing = joinFixture();
  missing.profile.falsifier_occurrence_bindings[0].reference_role_joins =
    missing.profile.falsifier_occurrence_bindings[0].reference_role_joins.filter(
      ({ role }) => role !== "source"
    );
  assert.notEqual(profileDigestV034(joinFixture().profile), profileDigestV034(missing.profile));

  const omittedPosition = joinFixture();
  omittedPosition.profile.claim_patterns.find(({ pattern_id: id }) =>
    id === "verification"
  ).proposition_template.operands = omittedPosition.profile.claim_patterns.find(
    ({ pattern_id: id }) => id === "verification"
  ).proposition_template.operands.filter(({ role }) => role !== "source");
  assert.ok(validateProfileSemanticsV034(omittedPosition.profile).some(({ code }) =>
    code === "profile_falsifier_occurrence_role_position_mismatch"
  ));

  const alias = joinFixture();
  alias.contract.references.push({
    reference_id: "ref-target-alias", type_term: "cc:state",
    identity: { kind: "profile_term", term: "target-alias" }
  });
  alias.contract.propositions.push({
    proposition_id: "prop-target-alias", subject_reference_id: "ref-target",
    operator: "reference:equals", applicability_context: context(),
    operands: [{ kind: "reference", reference_id: "ref-target-alias" }]
  });
  alias.contract.claims.push({
    claim_id: "claim-target-alias", kind: "evidence", modality: "MUST",
    proposition_id: "prop-target-alias"
  });
  alias.contract.propositions.find(({ proposition_id: id }) => id === "prop-falsifier")
    .operands[0].reference_id = "ref-target-alias";
  assert.notEqual(evaluateVerificationProfileV034(alias).satisfaction, "satisfied");

  const unrelated = joinFixture();
  unrelated.contract.references.push({
    reference_id: "ref-unrelated-verifier", type_term: "cc:process",
    identity: { kind: "profile_term", term: "unrelated-verifier" }
  });
  unrelated.contract.propositions.find(({ proposition_id: id }) => id === "prop-verification")
    .subject_reference_id = "ref-unrelated-verifier";
  assert.notEqual(evaluateVerificationProfileV034(unrelated).satisfaction, "satisfied");
});

test("consistent carrier identifier renaming preserves mechanism verdicts", () => {
  const renamed = joinFixture();
  const referenceRenames = new Map([...renamed.contract.references]
    .sort(({ reference_id: left }, { reference_id: right }) => left < right ? -1 : 1)
    .map(({ reference_id: id }, index) => [id, `ref-renamed-${index + 1}`]));
  const renameReference = (id) => referenceRenames.get(id) ?? id;
  for (const reference of renamed.contract.references) {
    reference.reference_id = renameReference(reference.reference_id);
  }
  for (const proposition of renamed.contract.propositions) {
    proposition.subject_reference_id = renameReference(proposition.subject_reference_id);
    proposition.applicability_context.operand_reference_ids =
      proposition.applicability_context.operand_reference_ids.map(renameReference);
    for (const operand of proposition.operands) if (operand.kind === "reference") {
      operand.reference_id = renameReference(operand.reference_id);
    }
  }
  for (const binding of renamed.evaluation_input.reference_bindings) {
    binding.reference_ids = binding.reference_ids.map(renameReference);
  }
  const original = evaluateVerificationProfileV034(joinFixture());
  const result = evaluateVerificationProfileV034(renamed);
  assert.equal(result.satisfaction, original.satisfaction);
  assert.deepEqual(
    result.pattern_results.map(({ pattern_id: id, status }) => [id, status]),
    original.pattern_results.map(({ pattern_id: id, status }) => [id, status])
  );
});

test("new mechanism results are stable across processes, locales, and timezones", () => {
  const payloads = [
    vacuousFixture(), branchFixture("unavailable"), joinFixture(), numberJoinFixture()
  ];
  const evaluatorUrl = new URL("../../lib/verification-profile-v034.mjs", import.meta.url)
    .href;
  const source = [
    "import { readFileSync } from 'node:fs';",
    `import { evaluateVerificationProfileV034 as evaluate } from ${JSON.stringify(evaluatorUrl)};`,
    "const payloads = JSON.parse(readFileSync(0, 'utf8'));",
    "process.stdout.write(JSON.stringify(payloads.map(evaluate)));"
  ].join("\n");
  const run = (env) => {
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      input: JSON.stringify(payloads), encoding: "utf8",
      env: { ...process.env, ...env }
    });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout;
  };
  const baseline = run({ LANG: "C", LC_ALL: "C", TZ: "UTC" });
  assert.equal(run({ LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8", TZ: "Pacific/Apia" }),
    baseline);
  assert.equal(run({ LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "Asia/Tokyo" }),
    baseline);
});
