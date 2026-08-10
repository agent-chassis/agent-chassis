import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { NATIVE_CONTRACT_SCHEMA } from "../../lib/native-contract-carrier.mjs";
import {
  NATIVE_CONTRACT_SCHEMA_V034,
  validateAndResolveNativeContractV034
} from "../../lib/native-contract-carrier-v034.mjs";
import {
  VERIFICATION_PROFILE_SCHEMA
} from "../../lib/verification-profile.mjs";
import {
  VERIFICATION_PROFILE_SCHEMA_V034,
  evaluateVerificationProfileV034,
  validateProfileSemanticsV034,
  validateProfileSchemaV034
} from "../../lib/verification-profile-v034.mjs";
import {
  evaluateCompletePopulationBinding,
  resolveClosedPopulation
} from "../../lib/population-semantics-v034.mjs";
import {
  contractBuilder,
  p8Fixture,
  p12Fixture,
  p13Fixture
} from "../support/population-v034-fixtures.mjs";
import {
  buildAdvisoryVocabularyView,
  describeVocabularyTerms
} from "../../lib/vocabulary-v034.mjs";

const evaluate = (fixture) => evaluateVerificationProfileV034(fixture);

for (const count of [1, 2, 3, 25]) {
  test(`P8 universal behavioral preservation accepts N=${count}`, () => {
    const result = evaluate(p8Fixture(count));
    assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
    const iteration = result.diagnostics.find(({ code }) => code === "for_each_evaluation");
    assert.equal(iteration.instance_results.length, count);
  });

  test(`P12 arbitrary projection coherence accepts N=${count}`, () => {
    const result = evaluate(p12Fixture(count));
    assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
    const iterations = result.diagnostics.filter(({ code }) => code === "for_each_evaluation");
    assert.deepEqual(iterations.map(({ instance_results: instances }) => instances.length), [count, count]);
  });
}

test("universal iteration refuses one missing member claim", () => {
  const p8 = evaluate(p8Fixture(3, { omitLastClaim: true }));
  const p12 = evaluate(p12Fixture(3, { omitLastIdentity: true }));
  assert.equal(p8.satisfaction, "unsatisfied");
  assert.equal(p12.satisfaction, "unsatisfied");
  assert.ok(p8.diagnostics.some(({ code }) => code === "for_each_instance_claim_missing"));
  assert.ok(p12.diagnostics.some(({ code }) => code === "for_each_instance_claim_missing"));
});

test("a one_or_more universal population refuses an explicit empty binding", () => {
  const fixture = p8Fixture(1);
  fixture.evaluation_input.reference_bindings.find(({ role }) => role === "observables")
    .reference_ids = [];
  const result = evaluate(fixture);
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(({ code }) => code === "reference_role_cardinality_invalid"));
});

test("for_each local member roles expand as exactly one in every template position", () => {
  const base = p8Fixture(1).profile;
  const patternOf = (profile) => profile.claim_patterns.find(({ for_each: each }) => each);
  const localOperand = structuredClone(base);
  patternOf(localOperand).proposition_template = {
    subject_role: "frozen_baseline",
    operator: "reference:equals",
    applicability_context: { mode: "frozen_base", operand_roles: ["observable"] },
    operands: [{ kind: "reference", role: "observable" }]
  };
  patternOf(localOperand).falsifying_proposition_template = structuredClone(
    patternOf(localOperand).proposition_template
  );
  assert.deepEqual(validateProfileSemanticsV034(localOperand).filter(
    ({ code }) => code === "profile_operator_position_cardinality_incompatible"
  ), []);

  for (const [position, mutate] of [
    ["operands", (template) => template.operands.push({
      kind: "reference", role: "frozen_baseline"
    })],
    ["applicability_context", (template) => {
      template.applicability_context = {
        mode: "frozen_base", operand_roles: ["observable", "frozen_baseline"]
      };
    }]
  ]) {
    const overArity = structuredClone(localOperand);
    mutate(patternOf(overArity).proposition_template);
    mutate(patternOf(overArity).falsifying_proposition_template);
    const diagnostics = validateProfileSemanticsV034(overArity).filter(
      ({ code, position: actualPosition }) =>
        code === "profile_operator_position_cardinality_incompatible" &&
        actualPosition === position
    );
    assert.deepEqual(diagnostics.map(({ template_kind: kind }) => kind).sort(), [
      "falsifier", "proposition"
    ]);
  }
});

test("P13 accepts equality, strict subset, and the empty observed population", () => {
  for (const fixture of [
    p13Fixture({ observedMembers: ["ref-a"], authorizedMembers: ["ref-a"] }),
    p13Fixture({ observedMembers: ["ref-a"], authorizedMembers: ["ref-a", "ref-b"] }),
    p13Fixture({ observedMembers: [], authorizedMembers: [] })
  ]) {
    const result = evaluate(fixture);
    assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
  }
});

test("P13 rejects partial overlap and a nonempty population against an empty scope", () => {
  for (const fixture of [
    p13Fixture({ observedMembers: ["ref-a", "ref-c"], authorizedMembers: ["ref-a", "ref-b"] }),
    p13Fixture({ observedMembers: ["ref-a"], authorizedMembers: [] })
  ]) {
    const result = evaluate(fixture);
    assert.equal(result.satisfaction, "invalid");
    const carrierDiagnostic = result.diagnostics.find(
      ({ code }) => code === "controlled_contract_invalid"
    );
    assert.ok(carrierDiagnostic.diagnostics.some(
      ({ code }) => code === "population_relation_false"
    ));
  }
});

test("not_subset_of is the exact complement, including empty populations", () => {
  const trueFixture = p13Fixture({
    observedMembers: ["ref-a", "ref-c"],
    authorizedMembers: ["ref-a", "ref-b"],
    operator: "reference:not_subset_of"
  });
  const falseFixture = p13Fixture({
    observedMembers: [],
    authorizedMembers: ["ref-a"],
    operator: "reference:not_subset_of"
  });
  assert.equal(validateAndResolveNativeContractV034(trueFixture.contract).diagnostics.length, 0);
  assert.ok(validateAndResolveNativeContractV034(falseFixture.contract).diagnostics.some(
    ({ code }) => code === "population_relation_false"
  ));
});

test("MUST_NOT uses the controlled population complement pointwise", () => {
  const forbiddenSubset = p13Fixture({
    observedMembers: ["ref-a"],
    authorizedMembers: ["ref-a", "ref-b"]
  });
  forbiddenSubset.contract.claims.find(
    ({ claim_id: claimId }) => claimId === "claim-observed-within-authorized"
  ).modality = "MUST_NOT";
  assert.ok(validateAndResolveNativeContractV034(forbiddenSubset.contract).diagnostics.some(
    ({ code }) => code === "population_relation_false"
  ));

  const forbiddenNonSubset = p13Fixture({
    observedMembers: ["ref-a"],
    authorizedMembers: ["ref-a", "ref-b"],
    operator: "reference:not_subset_of"
  });
  forbiddenNonSubset.contract.claims.find(
    ({ claim_id: claimId }) => claimId === "claim-observed-within-authorized"
  ).modality = "MUST_NOT";
  assert.deepEqual(validateAndResolveNativeContractV034(
    forbiddenNonSubset.contract
  ).diagnostics, []);
});

test("opposed subset operators contradict deterministically", () => {
  const fixture = p13Fixture({ observedMembers: ["ref-a"], authorizedMembers: ["ref-a"] });
  fixture.contract.propositions.push({
    proposition_id: "prop-observed-not-within-authorized",
    subject_reference_id: "ref-observed-population",
    operator: "reference:not_subset_of",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "reference", reference_id: "ref-authorized-population" }]
  });
  fixture.contract.claims.push({
    claim_id: "claim-observed-not-within-authorized",
    kind: "evidence",
    modality: "MUST",
    proposition_id: "prop-observed-not-within-authorized"
  });
  const diagnostics = validateAndResolveNativeContractV034(fixture.contract).diagnostics;
  assert.ok(diagnostics.some(({ code, reason }) =>
    code === "direct_proposition_contradiction" && reason === "opposed_operator"
  ));
  assert.ok(diagnostics.some(({ code }) => code === "population_relation_false"));
});

test("complete bindings reject omissions and decoy members", () => {
  const omitted = p13Fixture({
    observedMembers: ["ref-a"],
    authorizedMembers: ["ref-a", "ref-b"]
  });
  omitted.evaluation_input.reference_bindings.find(
    ({ role }) => role === "authorized_members"
  ).reference_ids = ["ref-a"];
  const omittedResult = evaluate(omitted);
  assert.equal(omittedResult.satisfaction, "unsatisfied");
  assert.ok(omittedResult.diagnostics.some(({ code }) =>
    code === "population_binding_not_complete"
  ));

  const decoy = p13Fixture({
    observedMembers: ["ref-a"],
    authorizedMembers: ["ref-a", "ref-b"]
  });
  decoy.contract.references.push({
    reference_id: "ref-decoy-member",
    type_term: "cc:resource",
    identity: { kind: "profile_term", term: "ref-decoy-member" }
  });
  decoy.evaluation_input.reference_bindings.find(
    ({ role }) => role === "authorized_members"
  ).reference_ids = ["ref-a", "ref-decoy-member"];
  const decoyResult = evaluate(decoy);
  assert.equal(decoyResult.satisfaction, "unsatisfied");
  assert.ok(decoyResult.diagnostics.some(({ code }) =>
    code === "population_binding_not_complete"
  ));
});

test("equality aliases cannot inflate membership or satisfy distinct population roles", () => {
  const fixture = p13Fixture({
    observedMembers: ["ref-a"],
    authorizedMembers: ["ref-a"]
  });
  fixture.contract.references.push({
    reference_id: "ref-a-alias",
    type_term: "cc:resource",
    identity: { kind: "profile_term", term: "ref-a-alias" }
  });
  fixture.contract.propositions.push({
    proposition_id: "prop-a-alias",
    subject_reference_id: "ref-a",
    operator: "reference:equals",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "reference", reference_id: "ref-a-alias" }]
  });
  fixture.contract.claims.push({
    claim_id: "claim-a-alias",
    kind: "evidence",
    modality: "MUST",
    proposition_id: "prop-a-alias"
  });
  fixture.evaluation_input.reference_bindings.find(
    ({ role }) => role === "authorized_members"
  ).reference_ids = ["ref-a", "ref-a-alias"];
  const aliasMembers = evaluate(fixture);
  assert.equal(aliasMembers.satisfaction, "unsatisfied");
  assert.ok(aliasMembers.diagnostics.some(({ code }) =>
    code === "population_binding_alias_or_duplicate_member"
  ));

  const selfSubset = p13Fixture({
    observedMembers: ["ref-a"],
    authorizedMembers: ["ref-a"]
  });
  selfSubset.contract.propositions.push({
    proposition_id: "prop-populations-alias",
    subject_reference_id: "ref-observed-population",
    operator: "reference:equals",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "reference", reference_id: "ref-authorized-population" }]
  });
  selfSubset.contract.claims.push({
    claim_id: "claim-populations-alias",
    kind: "evidence",
    modality: "MUST",
    proposition_id: "prop-populations-alias"
  });
  const selfResult = evaluate(selfSubset);
  assert.equal(selfResult.satisfaction, "invalid");
  assert.ok(selfResult.diagnostics.some(({ code }) =>
    code === "distinct_reference_roles_collapsed"
  ));
});

test("scoped equality aliases collapse distinct complete-population roles", () => {
  const fixture = p13Fixture({
    observedMembers: ["ref-a"],
    authorizedMembers: ["ref-a"]
  });
  const context = { mode: "where", operand_reference_ids: ["ref-context"] };
  const templateContext = { mode: "where", operand_roles: ["context"] };
  fixture.contract.references.push({
    reference_id: "ref-context",
    type_term: "cc:event",
    identity: { kind: "profile_term", term: "ref-context" }
  });
  for (const proposition of fixture.contract.propositions) {
    proposition.applicability_context = structuredClone(context);
  }
  fixture.contract.propositions.push({
    proposition_id: "prop-population-alias",
    subject_reference_id: "ref-observed-population",
    operator: "reference:equals",
    applicability_context: structuredClone(context),
    operands: [{ kind: "reference", reference_id: "ref-authorized-population" }]
  });
  fixture.contract.claims.push({
    claim_id: "claim-population-alias",
    kind: "evidence",
    modality: "MUST",
    proposition_id: "prop-population-alias"
  });
  fixture.profile.reference_roles.push({
    role: "context",
    allowed_type_terms: ["cc:event"],
    cardinality: "exactly_one"
  });
  for (const pattern of fixture.profile.reference_binding_patterns) {
    pattern.applicability_context = structuredClone(templateContext);
  }
  fixture.profile.claim_patterns[0].proposition_template.applicability_context =
    structuredClone(templateContext);
  fixture.evaluation_input.reference_bindings.push({
    role: "context",
    reference_ids: ["ref-context"]
  });

  const result = evaluate(fixture);
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(({ code, applicability_context: applicability }) =>
    code === "distinct_reference_roles_collapsed" &&
    applicability?.mode === "where" &&
    applicability.operand_reference_ids.includes("ref-context")
  ));
});

test("raw duplicate population bindings are schema-invalid rather than normalized away", () => {
  const fixture = p13Fixture({
    observedMembers: ["ref-a"],
    authorizedMembers: ["ref-a", "ref-b"]
  });
  fixture.evaluation_input.reference_bindings.find(
    ({ role }) => role === "authorized_members"
  ).reference_ids = ["ref-a", "ref-a"];
  const result = evaluate(fixture);
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "verification_profile_input_schema_invalid"
  ));
});

test("population closure is scope-specific and does not leak another applicability population", () => {
  const builder = contractBuilder();
  builder.addReference("ref-condition-one", "cc:state");
  builder.addReference("ref-condition-two", "cc:state");
  const scopeOne = { mode: "when", operand_reference_ids: ["ref-condition-one"] };
  const scopeTwo = { mode: "when", operand_reference_ids: ["ref-condition-two"] };
  builder.addPopulation({ id: "ref-left", members: ["ref-a"], context: scopeOne });
  builder.addPopulation({ id: "ref-right", members: ["ref-a"], context: scopeOne });
  builder.addEvidence({
    id: "left-second-scope-count",
    subject: "ref-left",
    operator: "number:has_cardinality",
    context: scopeTwo,
    operands: [{ kind: "number", value: 1 }]
  });
  builder.addReference("ref-x", "cc:resource");
  builder.addEvidence({
    id: "left-second-scope-member",
    subject: "ref-left",
    operator: "reference:contains",
    context: scopeTwo,
    operands: [{ kind: "reference", reference_id: "ref-x" }]
  });
  builder.addEvidence({
    id: "scoped-subset",
    subject: "ref-left",
    operator: "reference:subset_of",
    context: scopeOne,
    operands: [{ kind: "reference", reference_id: "ref-right" }]
  });
  const result = validateAndResolveNativeContractV034(builder.contract);
  assert.equal(result.schema_valid, true);
  assert.deepEqual(result.diagnostics, []);
});

test("complete-population roles reject non-population types and accept population or scope", () => {
  for (const fixture of [
    p8Fixture(1),
    p13Fixture({ observedMembers: ["ref-a"], authorizedMembers: ["ref-a"] })
  ]) {
    assert.equal(evaluate(fixture).satisfaction, "satisfied");
    assert.ok(!validateProfileSemanticsV034(fixture.profile).some(({ code }) =>
      code === "profile_population_binding_role_type_invalid"
    ));
  }

  const artifact = p8Fixture(1);
  artifact.contract.references.find(({ reference_id: referenceId }) =>
    referenceId === "ref-observable-population"
  ).type_term = "cc:artifact";
  artifact.profile.reference_roles.find(({ role }) =>
    role === "observable_population"
  ).allowed_type_terms = ["cc:artifact"];
  const result = evaluate(artifact);
  assert.equal(result.satisfaction, "invalid");
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "profile_population_binding_role_type_invalid"
  ));

  const direct = evaluateCompletePopulationBinding({
    contract: artifact.contract,
    population_reference_id: "ref-observable-population",
    member_reference_ids: ["ref-observable-1"],
    applicability_context: { mode: "unconditional", operand_reference_ids: [] }
  });
  assert.equal(direct.satisfied, false);
  assert.ok(direct.diagnostics.some(({ code, actual_type_term: actualTypeTerm }) =>
    code === "population_binding_reference_type_invalid" && actualTypeTerm === "cc:artifact"
  ));
});

test("universal verification templates resolve their falsifiers member-by-member", () => {
  const fixture = p8Fixture(2);
  const pattern = fixture.profile.claim_patterns[0];
  pattern.claim_kind = "verification";
  pattern.verification_methods = ["inspection"];
  pattern.proposition_template.operator = "reference:covers";
  pattern.proposition_template.applicability_context = {
    mode: "unconditional",
    operand_roles: []
  };
  pattern.falsifying_proposition_template = {
    subject_role: "observable",
    operator: "reference:not_equals",
    applicability_context: templateUnconditional(),
    operands: [{ kind: "reference", role: "frozen_baseline" }]
  };
  fixture.contract.claims = fixture.contract.claims.filter(
    ({ claim_id: claimId }) => !claimId.includes("preserved")
  );
  fixture.contract.propositions = fixture.contract.propositions.filter(
    ({ proposition_id: propositionId }) => !propositionId.includes("preserved")
  );
  for (const index of [1, 2]) {
    const subject = `ref-observable-${index}`;
    fixture.contract.propositions.push(
      {
        proposition_id: `prop-check-${index}`,
        subject_reference_id: subject,
        operator: "reference:covers",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: "ref-frozen-baseline" }]
      },
      {
        proposition_id: `prop-falsifier-${index}`,
        subject_reference_id: subject,
        operator: "reference:not_equals",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: "ref-frozen-baseline" }]
      },
      {
        proposition_id: `prop-behavior-${index}`,
        subject_reference_id: subject,
        operator: "boolean:exists",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "boolean", value: true }]
      }
    );
    fixture.contract.claims.push({
      claim_id: `claim-check-${index}`,
      kind: "verification",
      modality: "MUST",
      proposition_id: `prop-check-${index}`,
      verification_method: "inspection",
      falsifying_proposition_id: `prop-falsifier-${index}`
    }, {
      claim_id: `claim-behavior-${index}`,
      kind: "behavior",
      modality: "MUST",
      proposition_id: `prop-behavior-${index}`
    });
    fixture.contract.relations.push({
      relation_id: `rel-check-${index}`,
      role: "verifies",
      source_claim_id: `claim-check-${index}`,
      target_claim_id: `claim-behavior-${index}`
    });
  }
  const result = evaluate(fixture);
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
});

test("collections cannot silently treat an iterated claim pattern as one claim", () => {
  const fixture = p8Fixture(2);
  fixture.profile.collection_patterns.push({
    pattern_id: "invalid-universal-collection",
    required_by_stage: "post_delivery",
    collection_kind: "closed_set",
    match_mode: "exact",
    member_claim_pattern_ids: ["each-observable-preserved"]
  });
  fixture.profile.satisfaction_expression.all_of.push({
    pattern: "invalid-universal-collection"
  });
  assert.equal(validateProfileSchemaV034(fixture.profile), true);
  assert.ok(validateProfileSemanticsV034(fixture.profile).some(({ code }) =>
    code === "profile_collection_member_iterated_claim_invalid"
  ));
});

function authoredPopulation({ members = null, cardinality = null }) {
  const builder = contractBuilder();
  builder.addReference("ref-population", "cc:population");
  for (const member of members ?? []) builder.addReference(member, "cc:resource");
  if (members !== null && members.length > 0) builder.addEvidence({
    id: "population-members",
    subject: "ref-population",
    operator: "reference:contains",
    operands: members.map((referenceId) => ({
      kind: "reference", reference_id: referenceId
    }))
  });
  if (cardinality !== null) builder.addEvidence({
    id: "population-cardinality",
    subject: "ref-population",
    operator: "number:has_cardinality",
    operands: [{ kind: "number", value: cardinality }]
  });
  return builder.contract;
}

function resolveAuthoredPopulation(contract) {
  return resolveClosedPopulation(contract, "ref-population", {
    mode: "unconditional", operand_reference_ids: []
  });
}

test("population with members but no cardinality reports cardinality missing", () => {
  const population = resolveAuthoredPopulation(authoredPopulation({
    members: ["ref-member-a", "ref-member-b"]
  }));
  assert.deepEqual(population.diagnostics, [{
    code: "population_exact_cardinality_missing",
    population_reference_id: "ref-population",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    claim_ids: ["claim-population-members"]
  }]);
});

test("population with neither members nor cardinality reports definition missing", () => {
  const population = resolveAuthoredPopulation(authoredPopulation({}));
  assert.deepEqual(population.diagnostics, [{
    code: "population_definition_missing",
    population_reference_id: "ref-population",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    claim_ids: [],
    remediation_code: "declare_complete_population_definition",
    remediation: "Declare the complete membership and exact cardinality, or explicitly declare cardinality zero if the intended population is empty."
  }]);
});

test("explicit empty population with cardinality zero is complete", () => {
  const population = resolveAuthoredPopulation(authoredPopulation({
    members: [], cardinality: 0
  }));
  assert.equal(population.complete, true);
  assert.deepEqual(population.member_reference_ids, []);
  assert.deepEqual(population.diagnostics, []);
});

test("members and matching cardinality form a complete population", () => {
  const population = resolveAuthoredPopulation(authoredPopulation({
    members: ["ref-member-a", "ref-member-b"], cardinality: 2
  }));
  assert.equal(population.complete, true);
  assert.deepEqual(population.diagnostics, []);
});

test("members and mismatched cardinality report incomplete membership", () => {
  const population = resolveAuthoredPopulation(authoredPopulation({
    members: ["ref-member-a"], cardinality: 2
  }));
  assert.deepEqual(population.diagnostics, [{
    code: "population_membership_incomplete",
    population_reference_id: "ref-population",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    exact_cardinality: 2,
    declared_distinct_member_count: 1,
    declared_member_reference_ids: ["ref-member-a"],
    claim_ids: ["claim-population-cardinality", "claim-population-members"]
  }]);
});

test("population diagnostics are deterministic under claim and reference ordering", () => {
  const contract = authoredPopulation({
    members: ["ref-member-b", "ref-member-a"]
  });
  const forward = resolveAuthoredPopulation(contract);
  const reversed = structuredClone(contract);
  reversed.references.reverse();
  reversed.propositions.reverse();
  reversed.claims.reverse();
  const reordered = resolveAuthoredPopulation(reversed);
  assert.deepEqual({
    exact_cardinality: reordered.exact_cardinality,
    member_reference_ids: reordered.member_reference_ids,
    diagnostics: reordered.diagnostics
  }, {
    exact_cardinality: forward.exact_cardinality,
    member_reference_ids: forward.member_reference_ids,
    diagnostics: forward.diagnostics
  });
});

test("population relations in falsifier templates require complete bindings", () => {
  const { profile } = p8Fixture(1);
  profile.reference_roles.push(
    {
      role: "left_population",
      allowed_type_terms: ["cc:population"],
      cardinality: "exactly_one"
    },
    {
      role: "right_population",
      allowed_type_terms: ["cc:population"],
      cardinality: "exactly_one"
    }
  );
  profile.claim_patterns.push({
    pattern_id: "population-verifier",
    required_by_stage: "post_delivery",
    claim_kind: "verification",
    allowed_modalities: ["MUST"],
    verification_methods: ["proof"],
    proposition_template: {
      subject_role: "left_population",
      operator: "reference:equals",
      applicability_context: templateUnconditional(),
      operands: [{ kind: "reference", role: "right_population" }]
    },
    falsifying_proposition_template: {
      subject_role: "left_population",
      operator: "reference:not_subset_of",
      applicability_context: templateUnconditional(),
      operands: [{ kind: "reference", role: "right_population" }]
    }
  });
  profile.satisfaction_expression.all_of.push({ pattern: "population-verifier" });

  assert.equal(validateProfileSchemaV034(profile), true);
  const diagnostics = validateProfileSemanticsV034(profile);
  for (const role of ["left_population", "right_population"]) {
    assert.ok(diagnostics.some((diagnostic) =>
      diagnostic.code === "profile_population_relation_role_not_complete_bound" &&
      diagnostic.template_field === "falsifying_proposition_template" &&
      diagnostic.role === role
    ));
  }
});

test("aliased population closure diagnostics are deterministic under claim reordering", () => {
  const builder = contractBuilder();
  builder.addReference("ref-a", "cc:population");
  builder.addReference("ref-b", "cc:population");
  builder.addEvidence({
    id: "alias",
    subject: "ref-a",
    operator: "reference:equals",
    operands: [{ kind: "reference", reference_id: "ref-b" }]
  });
  builder.addEvidence({
    id: "a-subset-b",
    subject: "ref-a",
    operator: "reference:subset_of",
    operands: [{ kind: "reference", reference_id: "ref-b" }]
  });
  builder.addEvidence({
    id: "b-subset-a",
    subject: "ref-b",
    operator: "reference:subset_of",
    operands: [{ kind: "reference", reference_id: "ref-a" }]
  });
  const forward = validateAndResolveNativeContractV034(builder.contract).diagnostics;
  const reversedContract = structuredClone(builder.contract);
  reversedContract.claims.reverse();
  const reversed = validateAndResolveNativeContractV034(reversedContract).diagnostics;

  assert.deepEqual(reversed, forward);
  assert.deepEqual(forward, [{
    code: "population_definition_missing",
    population_reference_id: "ref-a",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    claim_ids: [],
    remediation_code: "declare_complete_population_definition",
    remediation: "Declare the complete membership and exact cardinality, or explicitly declare cardinality zero if the intended population is empty."
  }]);
});

test("population evaluation is deterministic under input and contract array reordering", () => {
  const fixture = p12Fixture(25);
  const first = evaluate(structuredClone(fixture));
  const reordered = structuredClone(fixture);
  reordered.contract.references.reverse();
  reordered.contract.propositions.reverse();
  reordered.contract.claims.reverse();
  reordered.evaluation_input.reference_bindings.reverse();
  for (const binding of reordered.evaluation_input.reference_bindings) {
    binding.reference_ids.reverse();
  }
  const second = evaluate(reordered);
  assert.deepEqual(second, first);
});

test("v0.34 query exposure carries population definitions and explicit omissions", () => {
  const descriptions = describeVocabularyTerms([
    "cc:population", "reference:subset_of", "reference:not_subset_of"
  ]);
  assert.ok(descriptions.every(({ found, active }) => found && active));
  assert.equal(
    descriptions.find(({ requested_term: term }) => term === "reference:subset_of")
      .entry.population_semantics.relation,
    "subset"
  );
  const view = buildAdvisoryVocabularyView({
    operator_terms: ["reference:subset_of", "reference:not_subset_of"],
    type_terms: ["cc:population"]
  });
  assert.equal(view.authoritative, false);
  assert.equal(view.selected.operators.length, 2);
  assert.ok(view.explicit_omissions.operator_count > 0);
});

test("the frozen v0.33 contract and v0.1 profile schemas remain byte-compatible", async () => {
  const schemaDirectory = new URL("../../schema/", import.meta.url);
  const frozenDigests = {
    "controlled-acceptance-contract.experimental.v0.1.schema.json":
      "096efe7f2b498e7cc1a75b0f3b8ee2764136b2ba4d19734c8a4e13c382f61b83",
    "controlled-contract-verification-profile.experimental.v0.1.schema.json":
      "70261d5f0ad2ebe20d9e5c770c7544daf0a468955b88f0957352af40bd425670",
    "controlled-contract-verification-profile-input.experimental.v0.1.schema.json":
      "72e857453106cb1c80e7995aeaef6446dfa3931a0595d6df9272105dc88d5ad3",
    "controlled-contract-verification-profile-result.experimental.v0.1.schema.json":
      "45040c4b14e3ecc72a9100f32100c8df7deea641b312e335c69d8f82e8b14af4"
  };
  for (const [filename, expectedDigest] of Object.entries(frozenDigests)) {
    const bytes = await readFile(new URL(filename, schemaDirectory));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expectedDigest
    );
  }
  assert.equal(NATIVE_CONTRACT_SCHEMA.title, "controlled-acceptance-contract.experimental.v0.1");
  assert.equal(VERIFICATION_PROFILE_SCHEMA.title,
    "controlled-contract-verification-profile.experimental.v0.1");
  assert.notDeepEqual(NATIVE_CONTRACT_SCHEMA_V034, NATIVE_CONTRACT_SCHEMA);
  assert.notDeepEqual(VERIFICATION_PROFILE_SCHEMA_V034, VERIFICATION_PROFILE_SCHEMA);
});

function templateUnconditional() {
  return { mode: "unconditional", operand_roles: [] };
}
