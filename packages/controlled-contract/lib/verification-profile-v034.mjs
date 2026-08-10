import { createHash } from "node:crypto";

import Ajv2020 from "ajv/dist/2020.js";

import {
  CONTROLLED_VOCABULARY,
  VOCABULARY_DIGESTS
} from "../vocabulary/cv.experimental.0.34.mjs";
import {
  NATIVE_CONTRACT_SCHEMA_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034,
  validateAndResolveNativeContractV034
} from "./native-contract-carrier-v034.mjs";
import {
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA,
  VERIFICATION_PROFILE_RESULT_SCHEMA,
  VERIFICATION_PROFILE_SCHEMA,
  evaluateVerificationProfileWithRuntime,
  validateProfileSemantics
} from "./verification-profile.mjs";
import {
  deriveVocabularySchemaProjection
} from "./vocabulary-v034.mjs";
import {
  evaluateCompletePopulationBinding,
  referencesEquivalent
} from "./population-semantics-v034.mjs";

const PROFILE_SCHEMA_VERSION_V034 =
  "controlled-contract-verification-profile.experimental.v0.2";
const EVALUATION_INPUT_VERSION_V034 =
  "controlled-contract-verification-profile-input.experimental.v0.2";
const RESULT_VERSION_V034 =
  "controlled-contract-verification-profile-result.experimental.v0.2";

const projection = deriveVocabularySchemaProjection();
const identityKinds = NATIVE_CONTRACT_SCHEMA_V034.$defs.reference.properties.identity.oneOf
  .flatMap((branch) => branch.properties.kind.enum);
const operatorByTerm = new Map(
  CONTROLLED_VOCABULARY.operators.map((operator) => [operator.term, operator])
);

function compareCodeUnits(left, right) {
  const leftString = String(left);
  const rightString = String(right);
  return leftString < rightString ? -1 : leftString > rightString ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function canonical(value) {
  return JSON.stringify(canonicalValue(value));
}

function arrayCardinalitySchema(cardinality) {
  return {
    minItems: cardinality.minimum,
    ...(cardinality.maximum === null ? {} : { maxItems: cardinality.maximum })
  };
}

function buildTemplateApplicabilitySchema() {
  return {
    oneOf: projection.applicability_mode_branches.map((branch) => ({
      type: "object",
      required: ["mode", "operand_roles"],
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: [branch.mode] },
        operand_roles: {
          type: "array",
          ...arrayCardinalitySchema(branch.context_reference_cardinality),
          items: { type: "string", pattern: "^[a-z][a-z0-9_]*$" }
        }
      }
    }))
  };
}

function buildPropositionTemplateSchema(baseTemplateSchema) {
  const schema = structuredClone(baseTemplateSchema);
  schema.properties.operator.enum = [...projection.operator_enum];
  schema.properties.applicability_context = buildTemplateApplicabilitySchema();
  schema.anyOf = projection.proposition_branches.map((branch) => ({
    properties: {
      operator: { type: "string", enum: [...branch.operator_terms] },
      applicability_context: {
        type: "object",
        properties: {
          mode: { type: "string", enum: [...branch.applicability_modes] }
        }
      },
      operands: {
        type: "array",
        ...arrayCardinalitySchema(branch.operand_cardinality),
        items: { $ref: `#/$defs/template_${branch.operand_kind}_operand` }
      }
    }
  }));
  return schema;
}

function buildVerificationProfileSchemaV034() {
  const schema = structuredClone(VERIFICATION_PROFILE_SCHEMA);
  schema.title = PROFILE_SCHEMA_VERSION_V034;
  schema.description =
    "Free-tier, non-authoritative proof-profile schema derived from the intrinsic " +
    "cv.experimental.0.34 vocabulary. A falsifying proposition template is " +
    "counterfactual because of its verification role; counterfactual is not an " +
    "applicability mode.";
  schema.required.push(
    "contract_schema_version",
    "vocabulary_version",
    "vocabulary_signature_digest",
    "vocabulary_algebra_digest",
    "vocabulary_definitions_digest",
    "vocabulary_complete_digest",
    "falsifier_condition_bindings"
  );
  schema.properties.schema_version.enum = [PROFILE_SCHEMA_VERSION_V034];
  schema.properties.contract_schema_version = {
    type: "string",
    enum: [SCHEMA_VERSION_V034]
  };
  schema.properties.vocabulary_version = {
    type: "string",
    enum: [VOCABULARY_VERSION_V034]
  };
  schema.properties.vocabulary_signature_digest = {
    type: "string",
    enum: [VOCABULARY_DIGESTS.signature]
  };
  schema.properties.vocabulary_algebra_digest = {
    type: "string",
    enum: [VOCABULARY_DIGESTS.algebra]
  };
  schema.properties.vocabulary_definitions_digest = {
    type: "string",
    enum: [VOCABULARY_DIGESTS.definitions]
  };
  schema.properties.vocabulary_complete_digest = {
    type: "string",
    enum: [VOCABULARY_DIGESTS.complete]
  };
  schema.properties.falsifier_condition_bindings = {
    type: "array",
    minItems: 1,
    items: {
      type: "object",
      required: ["relation_pattern_id", "applicability_context"],
      additionalProperties: false,
      properties: {
        relation_pattern_id: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
        applicability_context: buildTemplateApplicabilitySchema()
      }
    }
  };
  schema.properties.reference_role_count_bindings = {
    type: "array",
    uniqueItems: true,
    items: {
      type: "object",
      required: ["reference_role", "number_role"],
      additionalProperties: false,
      properties: {
        reference_role: {
          type: "string",
          pattern: "^[a-z][a-z0-9_]*$"
        },
        number_role: {
          type: "string",
          pattern: "^[a-z][a-z0-9_]*$"
        }
      }
    }
  };
  schema.properties.reference_roles.items.properties.cardinality.enum.push("zero_or_more");
  const referenceBindingPattern = schema.properties.reference_binding_patterns.items;
  referenceBindingPattern.properties.comparison.enum.push("complete_population");
  referenceBindingPattern.properties.applicability_context = buildTemplateApplicabilitySchema();
  referenceBindingPattern.allOf = [{
    if: {
      required: ["comparison"],
      properties: { comparison: { const: "complete_population" } }
    },
    then: {
      required: ["applicability_context"],
      properties: { applicability_context: true }
    },
    else: { properties: { applicability_context: false } }
  }];
  schema.properties.reference_roles.items.properties.allowed_type_terms.items.enum =
    [...projection.type_term_enum];
  schema.properties.reference_roles.items.properties.allowed_identity_kinds = {
    description:
      "Optional closed identity-kind constraint for roles whose proof meaning requires " +
      "a repository, symbol, durable-domain, runtime, or abstract profile identity.",
    type: "array",
    minItems: 1,
    uniqueItems: true,
    items: { type: "string", enum: [...identityKinds] }
  };
  const claimPattern = schema.properties.claim_patterns.items;
  claimPattern.properties.for_each = {
    type: "object",
    required: ["population_role", "member_role"],
    additionalProperties: false,
    properties: {
      population_role: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
      member_role: { type: "string", pattern: "^[a-z][a-z0-9_]*$" }
    }
  };
  claimPattern.properties.proposition_template = buildPropositionTemplateSchema(
    claimPattern.properties.proposition_template
  );
  claimPattern.properties.falsifying_proposition_template =
    buildPropositionTemplateSchema(
      claimPattern.properties.falsifying_proposition_template
    );
  return schema;
}

function buildEvaluationInputSchemaV034() {
  const schema = structuredClone(VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA);
  schema.title = EVALUATION_INPUT_VERSION_V034;
  schema.properties.input_version.enum = [EVALUATION_INPUT_VERSION_V034];
  schema.properties.reference_bindings.items.properties.reference_ids.items =
    structuredClone(NATIVE_CONTRACT_SCHEMA_V034.$defs.reference_id);
  schema.properties.reference_bindings.items.properties.reference_ids.minItems = 0;
  schema.properties.claim_pattern_bindings.items.properties.claim_id =
    structuredClone(NATIVE_CONTRACT_SCHEMA_V034.$defs.claim_id);
  schema.properties.resolver_facts.items.properties.argument_reference_ids.items =
    structuredClone(NATIVE_CONTRACT_SCHEMA_V034.$defs.reference_id);
  schema.properties.delivered_evidence.items.properties.verification_claim_id =
    structuredClone(NATIVE_CONTRACT_SCHEMA_V034.$defs.claim_id);
  return schema;
}

function buildResultSchemaV034() {
  const schema = structuredClone(VERIFICATION_PROFILE_RESULT_SCHEMA);
  schema.title = RESULT_VERSION_V034;
  schema.required.push("contract", "vocabulary", "admission");
  schema.properties.result_version.enum = [RESULT_VERSION_V034];
  schema.properties.contract = {
    type: "object",
    required: ["schema_version"],
    additionalProperties: false,
    properties: {
      schema_version: { type: "string", enum: [SCHEMA_VERSION_V034] }
    }
  };
  schema.properties.vocabulary = {
    type: "object",
    required: [
      "version", "signature_digest", "algebra_digest", "definitions_digest",
      "complete_digest"
    ],
    additionalProperties: false,
    properties: {
      version: { type: "string", enum: [VOCABULARY_VERSION_V034] },
      signature_digest: { type: "string", enum: [VOCABULARY_DIGESTS.signature] },
      algebra_digest: { type: "string", enum: [VOCABULARY_DIGESTS.algebra] },
      definitions_digest: { type: "string", enum: [VOCABULARY_DIGESTS.definitions] },
      complete_digest: { type: "string", enum: [VOCABULARY_DIGESTS.complete] }
    }
  };
  schema.properties.admission = {
    type: "object",
    required: ["kind", "profile_digest", "adequacy_attested"],
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["unadmitted_direct"] },
      profile_digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      adequacy_attested: { type: "boolean", enum: [false] }
    }
  };
  return schema;
}

const VERIFICATION_PROFILE_SCHEMA_V034 = buildVerificationProfileSchemaV034();
const VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034 =
  buildEvaluationInputSchemaV034();
const VERIFICATION_PROFILE_RESULT_SCHEMA_V034 = buildResultSchemaV034();

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateProfileSchemaV034 = ajv.compile(VERIFICATION_PROFILE_SCHEMA_V034);
const validateEvaluationInputSchemaV034 = ajv.compile(
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034
);
const validateResultSchemaV034 = ajv.compile(VERIFICATION_PROFILE_RESULT_SCHEMA_V034);

function templatesHaveComplementaryOperands(targetTemplate, falsifierTemplate, complement) {
  if (complement.kind === "operator") {
    return falsifierTemplate.operator === complement.term &&
      canonical(falsifierTemplate.operands) === canonical(targetTemplate.operands);
  }
  if (complement.kind !== "operand_transform" ||
      complement.transform !== "boolean_negation" ||
      targetTemplate.operator !== falsifierTemplate.operator ||
      targetTemplate.operands.length !== 1 || falsifierTemplate.operands.length !== 1) {
    return false;
  }
  const targetOperand = targetTemplate.operands[0];
  const falsifierOperand = falsifierTemplate.operands[0];
  return targetOperand.kind === "boolean" && falsifierOperand.kind === "boolean" &&
    targetOperand.value === !falsifierOperand.value;
}

const negativeModalities = new Set(["MUST_NOT", "SHOULD_NOT"]);

function falsifierModeForTarget(targetPattern) {
  const polarities = new Set(targetPattern.allowed_modalities.map((modality) =>
    negativeModalities.has(modality) ? "negative" : "positive"
  ));
  if (polarities.size !== 1) return "mixed";
  return polarities.has("negative") ? "positive_proposition" : "controlled_complement";
}

function templatesMatchPositiveProposition(targetTemplate, falsifierTemplate) {
  return targetTemplate.operator === falsifierTemplate.operator &&
    canonical(targetTemplate.operands) === canonical(falsifierTemplate.operands);
}

function validateControlledComplementPolicy(profile) {
  if (profile.verification_falsifier_policy !== "controlled_complement_per_target") {
    return [];
  }
  const diagnostics = [];
  const claimPatternById = new Map(
    profile.claim_patterns.map((pattern) => [pattern.pattern_id, pattern])
  );
  const verifiesPatterns = profile.relation_patterns.filter(({ role }) => role === "verifies");
  const conditionBindings = new Map();
  for (const binding of profile.falsifier_condition_bindings ?? []) {
    if (conditionBindings.has(binding.relation_pattern_id)) diagnostics.push({
      code: "profile_falsifier_condition_binding_duplicate",
      relation_pattern_id: binding.relation_pattern_id
    });
    conditionBindings.set(binding.relation_pattern_id, binding.applicability_context);
  }
  const targetedBehaviorPatternIds = new Set();
  const targetingVerificationPatternIds = new Set();
  for (const relation of verifiesPatterns) {
    const source = claimPatternById.get(relation.source_claim_pattern_id);
    const target = claimPatternById.get(relation.target_claim_pattern_id);
    if (!source || !target) continue;
    targetingVerificationPatternIds.add(source.pattern_id);
    targetedBehaviorPatternIds.add(target.pattern_id);
    const falsifier = source.falsifying_proposition_template;
    const targetTemplate = target.proposition_template;
    const complement = operatorByTerm.get(targetTemplate.operator)?.controlled_complement ?? {
      kind: "none"
    };
    const falsifierMode = falsifierModeForTarget(target);
    const reasons = [];
    const conditionBinding = conditionBindings.get(relation.pattern_id);
    if (source.claim_kind !== "verification") reasons.push("source_is_not_verification");
    if (target.claim_kind !== "behavior") reasons.push("target_is_not_behavior");
    if (!falsifier) reasons.push("source_has_no_falsifier");
    if (falsifierMode === "mixed") reasons.push(
      "target_modalities_mix_positive_and_negative"
    );
    if (falsifierMode === "controlled_complement") {
      if (complement.kind === "none") reasons.push("target_has_no_controlled_complement");
      if (falsifier && complement.kind !== "none" &&
          !templatesHaveComplementaryOperands(targetTemplate, falsifier, complement)) {
        reasons.push("proposition_is_not_controlled_complement");
      }
    }
    if (falsifierMode === "positive_proposition" && falsifier &&
        !templatesMatchPositiveProposition(targetTemplate, falsifier)) {
      reasons.push("proposition_is_not_positive_form_of_negative_behavior");
    }
    if (falsifier && falsifier.subject_role !== targetTemplate.subject_role) {
      reasons.push("subject_role_differs");
    }
    if (!conditionBinding) reasons.push("falsifier_condition_binding_missing");
    else if (falsifier && canonical(falsifier.applicability_context) !==
        canonical(conditionBinding)) reasons.push("falsifier_condition_differs");
    if (reasons.length > 0) diagnostics.push({
      code: "profile_verification_falsifier_not_complementary",
      pattern_id: relation.pattern_id,
      source_claim_pattern_id: relation.source_claim_pattern_id,
      target_claim_pattern_id: relation.target_claim_pattern_id,
      reasons
    });
  }
  for (const relationPatternId of conditionBindings.keys()) {
    if (!verifiesPatterns.some(({ pattern_id: patternId }) =>
      patternId === relationPatternId
    )) diagnostics.push({
      code: "profile_falsifier_condition_binding_dangling",
      relation_pattern_id: relationPatternId
    });
  }
  for (const pattern of profile.claim_patterns) {
    if (pattern.claim_kind === "verification" &&
        !targetingVerificationPatternIds.has(pattern.pattern_id)) diagnostics.push({
      code: "profile_verification_pattern_without_target",
      pattern_id: pattern.pattern_id
    });
    if (pattern.claim_kind === "behavior" &&
        !targetedBehaviorPatternIds.has(pattern.pattern_id)) diagnostics.push({
      code: "profile_behavior_pattern_without_verification",
      pattern_id: pattern.pattern_id
    });
  }
  return diagnostics;
}

const roleCardinalityIntervals = Object.freeze({
  exactly_one: { minimum: 1, maximum: 1 },
  one_or_more: { minimum: 1, maximum: null },
  zero_or_one: { minimum: 0, maximum: 1 },
  zero_or_more: { minimum: 0, maximum: null }
});

function addMaximum(left, right) {
  return left === null || right === null ? null : left + right;
}

function expansionInterval(referenceRoles, numberRoles, roleById, numberRoleById,
  literalCount = 0, localReferenceRole = null) {
  let minimum = literalCount;
  let maximum = literalCount;
  for (const role of referenceRoles) {
    const interval = role === localReferenceRole
      ? roleCardinalityIntervals.exactly_one
      : roleCardinalityIntervals[roleById.get(role)?.cardinality];
    if (!interval) continue;
    minimum += interval.minimum;
    maximum = addMaximum(maximum, interval.maximum);
  }
  for (const role of numberRoles) {
    const interval = roleCardinalityIntervals[numberRoleById.get(role)?.cardinality];
    if (!interval) continue;
    minimum += interval.minimum;
    maximum = addMaximum(maximum, interval.maximum);
  }
  return { minimum, maximum };
}

function intervalFits(actual, required) {
  return actual.minimum >= required.minimum &&
    (required.maximum === null ||
      (actual.maximum !== null && actual.maximum <= required.maximum));
}

function validateRoleExpansionCardinality(profile) {
  const diagnostics = [];
  const roleById = new Map(profile.reference_roles.map((role) => [role.role, role]));
  const numberRoleById = new Map(
    (profile.number_roles ?? []).map((role) => [role.role, role])
  );
  const applicabilityByMode = new Map(
    projection.applicability_mode_branches.map((branch) => [branch.mode, branch])
  );
  for (const pattern of profile.claim_patterns) {
    for (const [templateKind, template] of [
      ["proposition", pattern.proposition_template],
      ["falsifier", pattern.falsifying_proposition_template]
    ]) {
      if (!template) continue;
      const applicabilityRequired = applicabilityByMode.get(
        template.applicability_context.mode
      )?.context_reference_cardinality;
      if (applicabilityRequired) {
        const actual = expansionInterval(
          template.applicability_context.operand_roles,
          [], roleById, numberRoleById, 0, pattern.for_each?.member_role ?? null
        );
        if (!intervalFits(actual, applicabilityRequired)) diagnostics.push({
          code: "profile_operator_position_cardinality_incompatible",
          pattern_id: pattern.pattern_id,
          template_kind: templateKind,
          position: "applicability_context",
          operator: template.operator,
          applicability_mode: template.applicability_context.mode,
          roles: [...template.applicability_context.operand_roles],
          expansion_cardinality: actual,
          required_cardinality: applicabilityRequired
        });
      }
      const signature = projection.operator_signatures[template.operator];
      if (!signature) continue;
      const referenceRoles = template.operands
        .filter(({ kind }) => kind === "reference")
        .map(({ role }) => role);
      const numberRoles = template.operands
        .filter(({ kind, value_role: valueRole }) => kind === "number" && valueRole)
        .map(({ value_role: valueRole }) => valueRole);
      const literalCount = template.operands.filter(({ kind, value_role: valueRole }) =>
        kind !== "reference" && !(kind === "number" && valueRole)
      ).length;
      const actual = expansionInterval(
        referenceRoles, numberRoles, roleById, numberRoleById, literalCount,
        pattern.for_each?.member_role ?? null
      );
      if (!intervalFits(actual, signature.operand_cardinality)) diagnostics.push({
        code: "profile_operator_position_cardinality_incompatible",
        pattern_id: pattern.pattern_id,
        template_kind: templateKind,
        position: "operands",
        operator: template.operator,
        reference_roles: referenceRoles,
        number_roles: numberRoles,
        literal_operand_count: literalCount,
        expansion_cardinality: actual,
        required_cardinality: signature.operand_cardinality
      });
    }
  }
  return diagnostics;
}

function validateProfileSemanticsV034(profile) {
  const profileWithoutLegacyComplementPolicy = structuredClone(profile);
  delete profileWithoutLegacyComplementPolicy.verification_falsifier_policy;
  const diagnostics = [
    ...validateProfileSemantics(profileWithoutLegacyComplementPolicy),
    ...validateControlledComplementPolicy(profile),
    ...validateRoleExpansionCardinality(profile)
  ];
  const completePopulationPatterns = (profile.reference_binding_patterns ?? [])
    .filter(({ comparison }) => comparison === "complete_population");
  for (const pattern of profile.claim_patterns ?? []) {
    const iterationPopulationBindingCount = pattern.for_each
      ? completePopulationPatterns.filter(({ roles }) =>
        roles[1] === pattern.for_each.population_role
      ).length
      : 0;
    if (pattern.for_each && iterationPopulationBindingCount !== 1) diagnostics.push({
      code: "profile_for_each_population_not_complete_bound",
      pattern_id: pattern.pattern_id,
      population_role: pattern.for_each.population_role,
      complete_binding_count: iterationPopulationBindingCount
    });
    for (const [templateField, template] of [
      ["proposition_template", pattern.proposition_template],
      ["falsifying_proposition_template", pattern.falsifying_proposition_template]
    ]) {
      if (!template || !["reference:subset_of", "reference:not_subset_of"].includes(
        template.operator
      )) continue;
      const populationRoles = [
        template.subject_role,
        ...template.operands
          .filter(({ kind }) => kind === "reference")
          .map(({ role }) => role)
      ];
      for (const role of populationRoles) {
        const completeBindingCount = completePopulationPatterns.filter(
          ({ roles }) => roles[0] === role
        ).length;
        if (completeBindingCount !== 1) diagnostics.push({
          code: "profile_population_relation_role_not_complete_bound",
          pattern_id: pattern.pattern_id,
          template_field: templateField,
          role,
          complete_binding_count: completeBindingCount
        });
      }
    }
  }
  return diagnostics.sort((left, right) =>
    compareCodeUnits(canonical(left), canonical(right))
  );
}

function profileDigestV034(profile) {
  return createHash("sha256").update(canonical(profile)).digest("hex");
}

function enrichResultV034(result, profile) {
  const enriched = {
    ...result,
    result_version: RESULT_VERSION_V034,
    contract: { schema_version: SCHEMA_VERSION_V034 },
    admission: {
      kind: "unadmitted_direct",
      profile_digest: profileDigestV034(profile),
      adequacy_attested: false
    },
    vocabulary: {
      version: VOCABULARY_VERSION_V034,
      signature_digest: VOCABULARY_DIGESTS.signature,
      algebra_digest: VOCABULARY_DIGESTS.algebra,
      definitions_digest: VOCABULARY_DIGESTS.definitions,
      complete_digest: VOCABULARY_DIGESTS.complete
    }
  };
  if (!validateResultSchemaV034(enriched)) throw new Error(
    `v0.34 verification profile evaluator emitted an invalid result: ${JSON.stringify(validateResultSchemaV034.errors)}`
  );
  return enriched;
}

function evaluateVerificationProfileV034(payload) {
  const result = evaluateVerificationProfileWithRuntime(payload, {
    validateProfile: validateProfileSchemaV034,
    validateProfileSemanticsForRuntime: validateProfileSemanticsV034,
    validateEvaluationInput: validateEvaluationInputSchemaV034,
    validateContract: validateAndResolveNativeContractV034,
    purposeMatchedCollectionsAreCandidates: true,
    completePopulationBindingEvaluator: evaluateCompletePopulationBinding,
    referencesEquivalent: (contract, left, right, applicabilityContext) =>
      referencesEquivalent(contract, left, right, applicabilityContext)
  });
  return enrichResultV034(result, payload.profile);
}

export {
  EVALUATION_INPUT_VERSION_V034,
  PROFILE_SCHEMA_VERSION_V034,
  RESULT_VERSION_V034,
  VERIFICATION_PROFILE_EVALUATION_INPUT_SCHEMA_V034,
  VERIFICATION_PROFILE_RESULT_SCHEMA_V034,
  VERIFICATION_PROFILE_SCHEMA_V034,
  buildEvaluationInputSchemaV034,
  buildResultSchemaV034,
  buildVerificationProfileSchemaV034,
  evaluateVerificationProfileV034,
  profileDigestV034,
  validateProfileSchemaV034,
  validateProfileSemanticsV034
};
