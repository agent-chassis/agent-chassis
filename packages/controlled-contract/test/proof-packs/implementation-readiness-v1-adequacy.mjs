import { createHash } from "node:crypto";

import { evaluateStableProofPackFixtureV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";

const GUARANTEE = "One authored design unit names independently bound repository-grounded implementation and test loci; declares a complete nonempty requirement population, an exact four-field warning shape with exact code, severity, message-template, and payload-schema values, an authored complete validation population equal to the requirement population, and a complete placeholder population with exact count zero.";

const EXCLUSIONS = Object.freeze([
  "authored-population-truth",
  "grounded-identity-existence",
  "omitted-authored-requirement",
  "product-sufficiency",
  "runtime-and-repository-truth",
  "warning-runtime-execution"
]);

const POSITIVE_IDS = Object.freeze([
  "api-risk-warning-domain",
  "code-symbol-loci",
  "repository-path-loci",
  "schema-deprecation-warning-domain",
  "scope-policy-warning-domain"
]);

const MUTANT_IDS = Object.freeze([
  "implementation-locus-profile-term",
  "loci-aliased",
  "nonzero-placeholder-population",
  "test-locus-durable-id",
  "validation-member-and-equality-omitted",
  "validation-population-equality-omitted",
  "warning-code-value-swapped",
  "warning-field-added",
  "warning-field-omitted",
  "warning-payload-schema-substituted",
  "warning-shape-equality-omitted"
]);

const REJECTION_PATTERNS = Object.freeze([
  ["missing-design-loci", "design-names-grounded-loci"],
  ["missing-implementation-target", "implementation-locus-targets-requirements"],
  ["missing-test-implementation-coverage", "test-locus-targets-implementation"],
  ["missing-warning-shape", "warning-signal-contains-shape"],
  ["missing-warning-values", "warning-signal-carries-exact-values"],
  ["missing-warning-shape-equality", "warning-shape-exact"],
  ["missing-validation-equality", "validation-covers-all-requirements"],
  ["missing-validation-test-coverage", "test-locus-covers-validation"],
  ["missing-placeholder-zero", "placeholder-population-empty"],
  ["missing-warning-verification", "warning-shape-verification"]
]);

const roleReferenceIds = Object.freeze({
  design_unit: ["ref-design-unit"],
  requirement_population: ["ref-requirement-population"],
  requirements: ["ref-requirement-1", "ref-requirement-2"],
  implementation_locus: ["ref-implementation-locus"],
  test_locus: ["ref-test-locus"],
  warning_signal: ["ref-warning-signal"],
  warning_shape_population: ["ref-warning-shape-population"],
  warning_fields: ["ref-warning-code-field", "ref-warning-severity-field",
    "ref-warning-message-field", "ref-warning-payload-field"],
  required_warning_shape_population: ["ref-required-warning-shape-population"],
  required_warning_fields: ["ref-warning-code-field", "ref-warning-severity-field",
    "ref-warning-message-field", "ref-warning-payload-field"],
  warning_code_field: ["ref-warning-code-field"],
  warning_severity_field: ["ref-warning-severity-field"],
  warning_message_field: ["ref-warning-message-field"],
  warning_payload_field: ["ref-warning-payload-field"],
  warning_code_value: ["ref-warning-code-value"],
  warning_severity_value: ["ref-warning-severity-value"],
  warning_message_template: ["ref-warning-message-template"],
  warning_payload_schema: ["ref-warning-payload-schema"],
  validation_population: ["ref-validation-population"],
  validated_requirements: ["ref-requirement-1", "ref-requirement-2"],
  placeholder_population: ["ref-placeholder-population"],
  placeholders: [],
  warning_shape_mismatch_condition: ["ref-warning-shape-mismatch-condition"]
});

const numberDefaults = Object.freeze({
  requirement_count: 2,
  validation_count: 2,
  warning_field_count: 4,
  required_warning_field_count: 4,
  placeholder_count: 0
});

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function identity(kind, domain, value) {
  if (kind === "repository_path") return {
    kind, repository: `example/${domain}`, path: `fixtures/${domain}/${value}`
  };
  if (kind === "code_symbol") return {
    kind, repository: `example/${domain}`, path: `src/${domain}.mjs`, symbol: value
  };
  if (kind === "runtime_parameter") return { kind, name: `${domain}.${value}` };
  if (kind === "profile_term") return { kind, term: `${domain}:${value}` };
  return { kind: "durable_id", domain: `implementation-readiness-${domain}`, value };
}

function defaultRoleValues(requirementCount) {
  const values = structuredClone(roleReferenceIds);
  values.requirements = Array.from({ length: requirementCount }, (_, index) =>
    `ref-requirement-${index + 1}`);
  values.validated_requirements = [...values.requirements];
  return values;
}

function resolveTemplate(template, roleValues, numberValues) {
  return {
    subject_reference_id: roleValues[template.subject_role]?.length === 1
      ? roleValues[template.subject_role][0] : null,
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(
        (role) => roleValues[role] ?? []
      )
    },
    operands: template.operands.flatMap((operand) => operand.kind === "reference"
      ? (roleValues[operand.role] ?? []).map(ref)
      : operand.kind === "number" && operand.value_role
        ? [{ kind: "number", value: numberValues[operand.value_role] }]
        : [structuredClone(operand)])
  };
}

function buildImplementationReadinessFixture({
  profile,
  domain = "scope-policy",
  requirementCount = 2,
  roleTypeOverrides = {},
  roleIdentityOverrides = {},
  roleCountOverrides = {},
  detachRoles = [],
  numberOverrides = {},
  aliasRoles = {},
  omitPatternIds = [],
  selectLastModalityPattern = null,
  selectLastVerificationPattern = null,
  mutateContract = null,
  mutateInput = null
} = {}) {
  const roleValues = defaultRoleValues(requirementCount);
  for (const role of detachRoles) roleValues[role] = roleValues[role].map(
    (_, index) => `ref-detached-${role.replaceAll("_", "-")}-${index + 1}`);
  for (const [role, count] of Object.entries(roleCountOverrides)) {
    const existing = roleValues[role] ?? [];
    roleValues[role] = Array.from({ length: count }, (_, index) =>
      existing[index] ?? `ref-${role.replaceAll("_", "-")}-${index + 1}`);
  }
  for (const [role, sourceRole] of Object.entries(aliasRoles)) {
    roleValues[role] = [...roleValues[sourceRole]];
  }
  const numberValues = { ...numberDefaults, requirement_count: requirementCount,
    validation_count: requirementCount, ...numberOverrides };
  const roleById = new Map(profile.reference_roles.map((role) => [role.role, role]));
  const referenceRoles = new Map();
  for (const [role, ids] of Object.entries(roleValues)) for (const id of ids) {
    if (!referenceRoles.has(id)) referenceRoles.set(id, []);
    referenceRoles.get(id).push(role);
  }
  const references = [...referenceRoles].map(([referenceId, roles]) => {
    const role = roles.find((candidate) => roleTypeOverrides[candidate]) ?? roles[0];
    const definition = roleById.get(role);
    const kind = roleIdentityOverrides[role]?.kind ??
      definition.allowed_identity_kinds?.[0] ?? "profile_term";
    return {
      reference_id: referenceId,
      type_term: roleTypeOverrides[role] ?? definition.allowed_type_terms[0],
      identity: structuredClone(roleIdentityOverrides[role] ??
        identity(kind, domain, referenceId.slice(4)))
    };
  });
  const contract = {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references, propositions: [], claims: [], relations: [], collections: [],
    residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const addClaim = (id, proposition, kind = "evidence", modality = "MUST",
    verificationMethod = null, falsifierId = null) => {
    contract.propositions.push({ proposition_id: `prop-${id}`, ...proposition });
    contract.claims.push({ claim_id: `claim-${id}`, proposition_id: `prop-${id}`,
      kind, modality,
      ...(verificationMethod ? { verification_method: verificationMethod } : {}),
      ...(falsifierId ? { falsifying_proposition_id: `prop-${falsifierId}` } : {}) });
  };
  for (const pattern of profile.reference_binding_patterns) {
    const [populationRole, memberRole] = pattern.roles;
    const members = roleValues[memberRole];
    const countRole = profile.reference_role_count_bindings.find(
      ({ reference_role: candidate }) => candidate === memberRole)?.number_role;
    const countProposition = {
      subject_reference_id: roleValues[populationRole][0],
      operator: "number:has_cardinality",
      applicability_context: { mode: pattern.applicability_context.mode,
        operand_reference_ids: pattern.applicability_context.operand_roles.flatMap(
          (role) => roleValues[role] ?? []) },
      operands: [{ kind: "number", value: countRole
        ? numberValues[countRole] : members.length }]
    };
    const countAlsoClaimed = profile.claim_patterns.some(({ proposition_template: template }) =>
      JSON.stringify(resolveTemplate(template, roleValues, numberValues)) ===
        JSON.stringify(countProposition));
    if (!countAlsoClaimed) addClaim(`${pattern.pattern_id}-count`, countProposition);
    if (members.length > 0) addClaim(`${pattern.pattern_id}-members`, {
      subject_reference_id: roleValues[populationRole][0],
      operator: "reference:contains",
      applicability_context: { mode: pattern.applicability_context.mode,
        operand_reference_ids: pattern.applicability_context.operand_roles.flatMap(
          (role) => roleValues[role] ?? []) },
      operands: members.map(ref)
    });
  }
  const omitted = new Set(omitPatternIds);
  for (const pattern of profile.claim_patterns) {
    if (omitted.has(pattern.pattern_id)) continue;
    let falsifierId = null;
    if (pattern.falsifying_proposition_template) {
      falsifierId = `falsifier-${pattern.pattern_id}`;
      contract.propositions.push({ proposition_id: `prop-${falsifierId}`,
        ...resolveTemplate(pattern.falsifying_proposition_template, roleValues, numberValues) });
    }
    addClaim(pattern.pattern_id,
      resolveTemplate(pattern.proposition_template, roleValues, numberValues),
      pattern.claim_kind,
      pattern.pattern_id === selectLastModalityPattern
        ? pattern.allowed_modalities.at(-1) : pattern.allowed_modalities[0],
      pattern.claim_kind === "verification"
        ? pattern.pattern_id === selectLastVerificationPattern
          ? pattern.verification_methods.at(-1)
          : pattern.verification_methods[0]
        : null,
      falsifierId);
  }
  for (const relation of profile.relation_patterns) if (
    !omitted.has(relation.source_claim_pattern_id) &&
    !omitted.has(relation.target_claim_pattern_id)) contract.relations.push({
    relation_id: `rel-${relation.pattern_id}`,
    role: relation.role,
    source_claim_id: `claim-${relation.source_claim_pattern_id}`,
    target_claim_id: `claim-${relation.target_claim_pattern_id}`
  });
  const input = {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role, reference_ids: [...(roleValues[role] ?? [])]
    })),
    number_bindings: profile.number_roles.map(({ role }) => ({
      role, value: numberValues[role]
    })),
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [], stable_evaluation: {}
  };
  mutateContract?.(contract, input, roleValues);
  mutateInput?.(input, contract, roleValues);
  return { contract, input, profile };
}

function satisfaction(fixture) {
  return evaluateStableProofPackFixtureV1({ contract: fixture.contract,
    profile: fixture.profile, evaluation_input: fixture.input }).satisfaction;
}

function proposition(contract, patternId) {
  return contract.propositions.find(({ proposition_id: id }) => id === `prop-${patternId}`);
}

function mutantFixture(profile, id) {
  if (id === "implementation-locus-profile-term") return buildImplementationReadinessFixture({
    profile, roleIdentityOverrides: { implementation_locus: {
      kind: "profile_term", term: "ungrounded:implementation"
    } }
  });
  if (id === "test-locus-durable-id") return buildImplementationReadinessFixture({
    profile, roleIdentityOverrides: { test_locus: {
      kind: "durable_id", domain: "ungrounded", value: "test"
    } }
  });
  if (id === "loci-aliased") return buildImplementationReadinessFixture({
    profile, aliasRoles: { test_locus: "implementation_locus" }
  });
  if (id === "warning-field-omitted") return buildImplementationReadinessFixture({
    profile, roleCountOverrides: { warning_fields: 3 },
    numberOverrides: { warning_field_count: 3 }
  });
  if (id === "warning-field-added") return buildImplementationReadinessFixture({
    profile, roleCountOverrides: { warning_fields: 5 },
    numberOverrides: { warning_field_count: 5 }
  });
  if (id === "nonzero-placeholder-population") return buildImplementationReadinessFixture({
    profile, roleCountOverrides: { placeholders: 1 },
    numberOverrides: { placeholder_count: 1 }
  });
  if (id === "warning-code-value-swapped") return buildImplementationReadinessFixture({
    profile, mutateContract(contract) {
      proposition(contract, "warning-code-value-exact").operands = [
        ref("ref-warning-severity-value")
      ];
    }
  });
  if (id === "warning-payload-schema-substituted") return buildImplementationReadinessFixture({
    profile, mutateContract(contract) {
      contract.references.push({ reference_id: "ref-other-payload-schema",
        type_term: "cc:artifact", identity: {
          kind: "repository_path", repository: "example/other",
          path: "fixtures/other-payload.schema.json"
        } });
      proposition(contract, "warning-payload-schema-exact").operands = [
        ref("ref-other-payload-schema")
      ];
    }
  });
  if (id === "warning-shape-equality-omitted") return buildImplementationReadinessFixture({
    profile, omitPatternIds: ["warning-shape-exact"]
  });
  if (id === "validation-population-equality-omitted") {
    return buildImplementationReadinessFixture({
      profile, omitPatternIds: ["validation-covers-all-requirements"]
    });
  }
  if (id === "validation-member-and-equality-omitted") {
    return buildImplementationReadinessFixture({ profile, requirementCount: 3,
      roleCountOverrides: { validated_requirements: 2 },
      numberOverrides: { validation_count: 2 },
      omitPatternIds: ["validation-covers-all-requirements"] });
  }
  throw new Error(`unknown mutant ${id}`);
}

async function runProofPackAdequacyControls({ profile, profile_digest: profileDigest }) {
  const controls = [];
  const positive = (controlId, fixture) => controls.push({ control_id: controlId,
    category: "positive", implementation_outcome: "passed",
    profile_satisfaction: satisfaction(fixture) });
  positive("scope-policy-warning-domain", buildImplementationReadinessFixture({
    profile, domain: "scope-policy", requirementCount: 2
  }));
  positive("schema-deprecation-warning-domain", buildImplementationReadinessFixture({
    profile, domain: "schema-deprecation", requirementCount: 3
  }));
  positive("api-risk-warning-domain", buildImplementationReadinessFixture({
    profile, domain: "api-risk", requirementCount: 4
  }));
  positive("repository-path-loci", buildImplementationReadinessFixture({
    profile, domain: "repository-path"
  }));
  positive("code-symbol-loci", buildImplementationReadinessFixture({
    profile, domain: "code-symbol", roleIdentityOverrides: {
      implementation_locus: { kind: "code_symbol", repository: "example/code-symbol",
        path: "src/impl.mjs", symbol: "implement" },
      test_locus: { kind: "code_symbol", repository: "example/code-symbol",
        path: "test/impl.test.mjs", symbol: "verify" }
    }
  }));
  for (const controlId of MUTANT_IDS) controls.push({ control_id: controlId,
    category: "mutant", implementation_outcome: "killed",
    profile_satisfaction: satisfaction(mutantFixture(profile, controlId)) });
  for (const [controlId, patternId] of REJECTION_PATTERNS) controls.push({
    control_id: controlId, category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildImplementationReadinessFixture({
      profile, omitPatternIds: [patternId]
    }))
  });
  for (const controlId of EXCLUSIONS) controls.push({ control_id: controlId,
    category: "exclusion", implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: "not_evaluated" });
  controls.sort((left, right) => left.control_id < right.control_id ? -1 : 1);
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest,
    guarantee_digest: createHash("sha256").update(GUARANTEE).digest("hex"),
    controls
  };
}

export {
  EXCLUSIONS,
  GUARANTEE,
  MUTANT_IDS,
  POSITIVE_IDS,
  REJECTION_PATTERNS,
  buildImplementationReadinessFixture,
  runProofPackAdequacyControls
};
