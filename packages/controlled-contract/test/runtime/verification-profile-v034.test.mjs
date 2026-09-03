import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034,
  validateAndResolveNativeContractV034
} from "../../lib/native-contract-carrier-v034.mjs";
import {
  EVALUATION_INPUT_VERSION_V034,
  RESULT_VERSION_V034,
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034,
  VERIFICATION_PROFILE_RESULT_SCHEMA_V034,
  VERIFICATION_PROFILE_SCHEMA_V034,
  evaluateVerificationProfileV034,
  profileDigestV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";
import { VOCABULARY_DIGESTS } from "../../vocabulary/cv.experimental.0.34.mjs";

const profileUrl = new URL(
  "../../profiles/proof.idempotency.effect-nonduplication/2.0.0/profile.json",
  import.meta.url
);
const profile = JSON.parse(await readFile(profileUrl, "utf8"));

const branchPatternIds = Object.freeze({
  equality: new Set(["idempotent-effect", "idempotency-equivalence-verification"]),
  cardinality: new Set()
});

function referenceIdForRole(role) {
  if (role === "second_input") return "ref-first-input";
  return `ref-${role.replaceAll("_", "-")}`;
}

function resolveTemplate(template, cardinality) {
  return {
    subject_reference_id: referenceIdForRole(template.subject_role),
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.map(
        referenceIdForRole
      )
    },
    operands: template.operands.map((operand) => {
      if (operand.kind === "reference") return {
        kind: "reference",
        reference_id: referenceIdForRole(operand.role)
      };
      if (operand.kind === "number" && operand.value_role) return {
        kind: "number",
        value: cardinality
      };
      return structuredClone(operand);
    })
  };
}

function selectedClaimPatterns(historicalProfile, branch) {
  const otherBranch = branch === "equality" ? branchPatternIds.cardinality :
    branchPatternIds.equality;
  return historicalProfile.claim_patterns.filter(({ pattern_id: patternId }) =>
    !otherBranch.has(patternId)
  );
}

function proofContract(domain, branch = "equality", cardinality = 1,
  historicalProfile = profile) {
  assert.ok(["payment", "queue", "database"].includes(domain));
  assert.ok(branchPatternIds[branch]);
  const referenceById = new Map();
  for (const role of historicalProfile.reference_roles) {
    const referenceId = referenceIdForRole(role.role);
    if (!referenceById.has(referenceId)) referenceById.set(referenceId, {
      reference_id: referenceId,
      type_term: role.allowed_type_terms[0],
      identity: {
        kind: "profile_term",
        term: `${domain}:${referenceId.slice(4)}`
      }
    });
  }
  const propositions = [];
  const claims = [];
  const selectedPatterns = selectedClaimPatterns(historicalProfile, branch);
  for (const pattern of selectedPatterns) {
    const propositionId = `prop-${pattern.pattern_id}`;
    propositions.push({
      proposition_id: propositionId,
      ...resolveTemplate(pattern.proposition_template, cardinality)
    });
    const claim = {
      claim_id: `claim-${pattern.pattern_id}`,
      kind: pattern.claim_kind,
      modality: "MUST",
      proposition_id: propositionId
    };
    if (pattern.claim_kind === "verification") {
      const falsifierId = `prop-falsifier-${pattern.pattern_id}`;
      propositions.push({
        proposition_id: falsifierId,
        ...resolveTemplate(pattern.falsifying_proposition_template, cardinality)
      });
      claim.verification_method = "test_execution";
      claim.falsifying_proposition_id = falsifierId;
    }
    claims.push(claim);
  }
  const selectedIds = new Set(selectedPatterns.map(({ pattern_id: id }) => id));
  const relations = historicalProfile.relation_patterns
    .filter(({ source_claim_pattern_id: source, target_claim_pattern_id: target }) =>
      selectedIds.has(source) && selectedIds.has(target)
    )
    .map((pattern) => ({
      relation_id: `rel-${pattern.pattern_id}`,
      role: pattern.role,
      source_claim_id: `claim-${pattern.source_claim_pattern_id}`,
      target_claim_id: `claim-${pattern.target_claim_pattern_id}`
    }));
  const collections = historicalProfile.collection_patterns.map((pattern) => ({
    collection_id: `set-${pattern.pattern_id}`,
    collection_kind: pattern.collection_kind,
    purpose: pattern.collection_purpose,
    member_claim_ids: pattern.member_claim_pattern_ids.map((id) => `claim-${id}`)
  }));
  return {
    schema_version: SCHEMA_VERSION_V034,
    vocabulary_version: VOCABULARY_VERSION_V034,
    profile_id: PROFILE_ID_V034,
    references: [...referenceById.values()],
    propositions,
    claims,
    relations,
    collections,
    residue: [],
    annotations: []
  };
}

function evaluationInput(branch = "equality", cardinality = 1,
  historicalProfile = profile) {
  return {
    input_version: EVALUATION_INPUT_VERSION_V034,
    evaluation_stage: "pre_dispatch",
    reference_bindings: historicalProfile.reference_roles.map(({ role }) => ({
      role,
      reference_ids: [referenceIdForRole(role)]
    })),
    number_bindings: branch === "cardinality" ? [{
      role: "expected_effect_cardinality",
      value: cardinality
    }] : [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };
}

function historicalIdempotencyFixture({
  domain = "payment",
  branch = "equality",
  cardinality = 1,
  historicalProfile = profile
} = {}) {
  const frozenProfile = structuredClone(historicalProfile);
  return {
    contract: proofContract(domain, branch, cardinality, frozenProfile),
    profile: frozenProfile,
    input: evaluationInput(branch, cardinality, frozenProfile)
  };
}

function evaluate(domain, branch = "equality", cardinality = 1) {
  return evaluateVerificationProfileV034({
    contract: proofContract(domain, branch, cardinality),
    profile,
    evaluation_input: evaluationInput(branch, cardinality)
  });
}

test("v0.34 proof profiles bind the contract and vocabulary algebra", () => {
  assert.equal(profile.schema_version,
    "controlled-contract-verification-profile.experimental.v0.2");
  assert.equal(profile.contract_schema_version, SCHEMA_VERSION_V034);
  assert.equal(profile.vocabulary_version, VOCABULARY_VERSION_V034);
  assert.equal(profile.vocabulary_signature_digest, VOCABULARY_DIGESTS.signature);
  assert.equal(profile.vocabulary_algebra_digest, VOCABULARY_DIGESTS.algebra);
  assert.equal(profile.vocabulary_definitions_digest, VOCABULARY_DIGESTS.definitions);
  assert.equal(profile.vocabulary_complete_digest, VOCABULARY_DIGESTS.complete);
  assert.deepEqual(validateProfileSemanticsV034(profile), []);
  assert.doesNotMatch(JSON.stringify(profile), /counterfactual/);
});

test("tracked v0.34 profile schemas equal their executable projections", async () => {
  for (const [filename, expected] of [
    ["controlled-contract-verification-profile.experimental.v0.2.schema.json",
      VERIFICATION_PROFILE_SCHEMA_V034],
    ["controlled-contract-verification-profile-input.experimental.v0.2.schema.json",
      VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034],
    ["controlled-contract-verification-profile-result.experimental.v0.2.schema.json",
      VERIFICATION_PROFILE_RESULT_SCHEMA_V034]
  ]) {
    const tracked = JSON.parse(await readFile(new URL(`../../schema/${filename}`, import.meta.url)));
    assert.deepEqual(tracked, expected);
  }
});

test("v0.34 profile schema derives active terms and excludes withheld applicability", () => {
  const falsifier = profile.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotency-equivalence-verification"
  ).falsifying_proposition_template;
  assert.equal(falsifier.applicability_context.mode, "when");
  const invalid = structuredClone(profile);
  invalid.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotency-equivalence-verification"
  ).falsifying_proposition_template.applicability_context.mode = "counterfactual";
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    VERIFICATION_PROFILE_SCHEMA_V034
  );
  assert.equal(validate(profile), true, JSON.stringify(validate.errors));
  assert.equal(validate(invalid), false);
});

test("v0.34 reference roles can require a concrete identity kind", () => {
  const fixture = historicalIdempotencyFixture();
  fixture.profile.reference_roles.find(({ role }) => role === "operation")
    .allowed_identity_kinds = ["code_symbol"];
  const operationReferenceId = fixture.input.reference_bindings.find(
    ({ role }) => role === "operation"
  ).reference_ids[0];
  const operationReference = fixture.contract.references.find(
    ({ reference_id: referenceId }) => referenceId === operationReferenceId
  );

  const abstractResult = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
  assert.equal(abstractResult.satisfaction, "invalid");
  assert.ok(abstractResult.diagnostics.some(({
    code,
    role,
    actual_identity_kind: actualIdentityKind,
    allowed_identity_kinds: allowedIdentityKinds
  }) =>
    code === "reference_role_binding_identity_kind_mismatch" &&
    role === "operation" &&
    actualIdentityKind === "profile_term" &&
    allowedIdentityKinds.length === 1 &&
    allowedIdentityKinds[0] === "code_symbol"
  ));

  operationReference.identity = {
    kind: "code_symbol",
    repository: "example/service",
    path: "src/capture.mjs",
    symbol: "capturePayment"
  };
  const groundedResult = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
  assert.equal(groundedResult.satisfaction, "satisfied");

  const invalidProfile = structuredClone(fixture.profile);
  invalidProfile.reference_roles.find(({ role }) => role === "operation")
    .allowed_identity_kinds = ["repository_symbol"];
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(
    VERIFICATION_PROFILE_SCHEMA_V034
  );
  assert.equal(validate(invalidProfile), false);
});

test("v0.34 binds a reference-role population to an exact integer role count", () => {
  const fixture = historicalIdempotencyFixture();
  const countedReferences = fixture.contract.references.slice(0, 2);
  fixture.profile.reference_roles.push({
    role: "counted_references",
    allowed_type_terms: [...new Set(countedReferences.map(
      ({ type_term: typeTerm }) => typeTerm
    ))],
    cardinality: "one_or_more"
  });
  fixture.profile.number_roles = [
    ...(fixture.profile.number_roles ?? []),
    {
      role: "counted_reference_count",
      cardinality: "exactly_one",
      number_type: "integer",
      minimum: 2
    }
  ];
  fixture.profile.reference_role_count_bindings = [{
    reference_role: "counted_references",
    number_role: "counted_reference_count"
  }];
  fixture.input.reference_bindings.push({
    role: "counted_references",
    reference_ids: countedReferences.map(({ reference_id: referenceId }) => referenceId)
  });
  fixture.input.number_bindings.push({
    role: "counted_reference_count",
    value: 2
  });

  assert.deepEqual(validateProfileSemanticsV034(fixture.profile), []);
  assert.equal(evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  }).satisfaction, "satisfied");

  fixture.input.number_bindings.find(
    ({ role }) => role === "counted_reference_count"
  ).value = 3;
  const mismatch = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
  assert.equal(mismatch.satisfaction, "invalid");
  assert.deepEqual(mismatch.diagnostics, [{
    code: "reference_role_count_binding_mismatch",
    reference_role: "counted_references",
    number_role: "counted_reference_count",
    reference_count: 2,
    bound_number: 3
  }]);
});

for (const domain of ["payment", "queue", "database"]) {
  for (const branch of ["equality"]) {
    test(`idempotency 2.0 accepts the ${domain} complete-state proof`, () => {
      const contract = proofContract(domain, branch);
      const carrier = validateAndResolveNativeContractV034(contract);
      assert.equal(carrier.schema_valid, true, JSON.stringify(carrier.schema_errors));
      assert.deepEqual(carrier.diagnostics, []);
      const result = evaluate(domain, branch);
      assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
      assert.equal(result.result_version, RESULT_VERSION_V034);
      assert.equal(result.admission.kind, "unadmitted_direct");
      assert.equal(result.admission.adequacy_attested, false);
      assert.equal(result.admission.profile_digest.length, 64);
      assert.deepEqual(result.contract, { schema_version: SCHEMA_VERSION_V034 });
      assert.deepEqual(result.vocabulary, {
        version: VOCABULARY_VERSION_V034,
        signature_digest: VOCABULARY_DIGESTS.signature,
        algebra_digest: VOCABULARY_DIGESTS.algebra,
        definitions_digest: VOCABULARY_DIGESTS.definitions,
        complete_digest: VOCABULARY_DIGESTS.complete
      });
    });
  }
}

test("v0.34 validates operator and operand-transform complements from vocabulary data", () => {
  const wrongOperator = structuredClone(profile);
  wrongOperator.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotency-equivalence-verification"
  ).falsifying_proposition_template.operator = "reference:matches";
  assert.ok(validateProfileSemanticsV034(wrongOperator).some(
    ({ code }) => code === "profile_verification_falsifier_not_complementary"
  ));

  const booleanProfile = structuredClone(profile);
  const behavior = booleanProfile.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotent-effect"
  );
  behavior.proposition_template.operator = "boolean:immutable";
  behavior.proposition_template.operands = [{ kind: "boolean", value: true }];
  const verification = booleanProfile.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotency-equivalence-verification"
  );
  verification.falsifying_proposition_template.operator = "boolean:immutable";
  verification.falsifying_proposition_template.operands = [
    { kind: "boolean", value: false }
  ];
  assert.deepEqual(validateProfileSemanticsV034(booleanProfile), []);
});

test("v0.34 treats a positive proposition as the falsifier for a negative behavior", () => {
  const negativeProfile = structuredClone(profile);
  const behavior = negativeProfile.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotent-effect"
  );
  const verification = negativeProfile.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotency-equivalence-verification"
  );
  behavior.allowed_modalities = ["MUST_NOT"];
  behavior.proposition_template.operator = "reference:writes";
  behavior.proposition_template.applicability_context = structuredClone(
    verification.falsifying_proposition_template.applicability_context
  );
  verification.falsifying_proposition_template.operator = "reference:writes";

  assert.deepEqual(validateProfileSemanticsV034(negativeProfile), []);

  const { contract, input } = historicalIdempotencyFixture({
    historicalProfile: negativeProfile
  });
  contract.claims.find(
    ({ claim_id: claimId }) => claimId === "claim-idempotent-effect"
  ).modality = "MUST_NOT";
  const result = evaluateVerificationProfileV034({
    contract,
    profile: negativeProfile,
    evaluation_input: input
  });
  assert.equal(result.satisfaction, "satisfied", JSON.stringify(result.diagnostics));
});

test("v0.34 negative-behavior falsifiers fail closed on semantic mismatch", () => {
  const negativeProfile = structuredClone(profile);
  const behavior = negativeProfile.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotent-effect"
  );
  const verification = negativeProfile.claim_patterns.find(
    ({ pattern_id: id }) => id === "idempotency-equivalence-verification"
  );
  behavior.allowed_modalities = ["MUST_NOT"];
  behavior.proposition_template.operator = "reference:writes";
  behavior.proposition_template.applicability_context = structuredClone(
    verification.falsifying_proposition_template.applicability_context
  );
  verification.falsifying_proposition_template.operator = "reference:mutates";

  assert.ok(validateProfileSemanticsV034(negativeProfile).some((diagnostic) =>
    diagnostic.code === "profile_verification_falsifier_not_complementary" &&
    diagnostic.reasons.includes("proposition_is_not_positive_form_of_negative_behavior")
  ));

  verification.falsifying_proposition_template.operator = "reference:writes";
  behavior.allowed_modalities = ["MUST", "MUST_NOT"];
  assert.ok(validateProfileSemanticsV034(negativeProfile).some((diagnostic) =>
    diagnostic.code === "profile_verification_falsifier_not_complementary" &&
    diagnostic.reasons.includes("target_modalities_mix_positive_and_negative")
  ));

  behavior.allowed_modalities = ["MUST"];
  assert.ok(validateProfileSemanticsV034(negativeProfile).some((diagnostic) =>
    diagnostic.code === "profile_verification_falsifier_not_complementary" &&
    diagnostic.reasons.includes("target_has_no_controlled_complement")
  ));
});

test("falsifier counterfactual meaning comes from claim role, not applicability", () => {
  const contract = proofContract("payment");
  const verification = contract.claims.find(
    ({ claim_id: id }) => id === "claim-idempotency-equivalence-verification"
  );
  const falsifier = contract.propositions.find(
    ({ proposition_id: id }) => id === verification.falsifying_proposition_id
  );
  assert.equal(falsifier.applicability_context.mode, "when");
  assert.equal(validateAndResolveNativeContractV034(contract).schema_valid, true);
  assert.equal(evaluateVerificationProfileV034({
    contract,
    profile,
    evaluation_input: evaluationInput()
  }).satisfaction, "satisfied");
});

test("an incomplete one-invocation plan cannot satisfy idempotency 2.0", () => {
  const contract = proofContract("queue");
  const secondInvocationId = referenceIdForRole("second_invocation");
  contract.references = contract.references.filter(
    ({ reference_id: id }) => id !== secondInvocationId
  );
  contract.propositions = contract.propositions.filter((proposition) =>
    proposition.subject_reference_id !== secondInvocationId &&
    !proposition.applicability_context.operand_reference_ids.includes(secondInvocationId) &&
    !proposition.operands.some((operand) =>
      operand.kind === "reference" && operand.reference_id === secondInvocationId
    )
  );
  const remainingPropositionIds = new Set(
    contract.propositions.map(({ proposition_id: id }) => id)
  );
  contract.claims = contract.claims.filter(({ proposition_id: id }) =>
    remainingPropositionIds.has(id)
  );
  const remainingClaimIds = new Set(contract.claims.map(({ claim_id: id }) => id));
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      remainingClaimIds.has(source) && remainingClaimIds.has(target)
  );
  contract.collections = contract.collections.map((collection) => ({
    ...collection,
    member_claim_ids: collection.member_claim_ids.filter((id) => remainingClaimIds.has(id))
  }));
  const input = evaluationInput();
  input.reference_bindings = input.reference_bindings.filter(
    ({ role }) => role !== "second_invocation"
  );
  const result = evaluateVerificationProfileV034({ contract, profile, evaluation_input: input });
  assert.notEqual(result.satisfaction, "satisfied");
});

test("the frozen v0.34 evaluator reproduces its historical admission binding", async () => {
  const historicalAdmission = JSON.parse(await readFile(new URL(
    "../../profiles/proof.idempotency.effect-nonduplication/2.0.0/admission.json",
    import.meta.url
  ), "utf8"));
  const fixture = historicalIdempotencyFixture();
  const first = evaluateVerificationProfileV034({
    contract: fixture.contract,
    profile: fixture.profile,
    evaluation_input: fixture.input
  });
  const second = evaluateVerificationProfileV034({
    contract: structuredClone(fixture.contract),
    profile: structuredClone(fixture.profile),
    evaluation_input: structuredClone(fixture.input)
  });
  assert.deepEqual(second, first);
  assert.equal(first.satisfaction, "satisfied");
  assert.equal(first.vocabulary.algebra_digest, VOCABULARY_DIGESTS.algebra);
  assert.equal(first.admission.profile_digest, profileDigestV034(profile));
  assert.equal(first.admission.profile_digest, historicalAdmission.profile_digest);
  assert.equal(first.admission.kind, "unadmitted_direct");
  assert.equal(first.admission.adequacy_attested, false);
});
