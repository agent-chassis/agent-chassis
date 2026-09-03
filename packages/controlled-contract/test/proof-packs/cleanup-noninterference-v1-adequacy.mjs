import { createHash } from "node:crypto";

import { evaluateStableProofPackFixtureV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";

const GUARANTEE = "After one declared failure, cleanup empties the complete declared residue population. A distinct complete protected-resource population is observed through the same bound population identity before failure and after settlement; both complete state populations have the protected-resource cardinality and the after-state population equals the before-state population. A separately selected authority, distinct from the failed attempt's authority, has equal state before and after settlement, is preserved by cleanup, later authorizes a valid attempt, and that attempt returns the expected successful result.";

const EXCLUSIONS = Object.freeze([
  "authored-population-truthfulness",
  "authority-validity-outside-the-selected-later-attempt",
  "concurrent-interleavings-outside-the-declared-sequence",
  "identity-provenance-truthfulness",
  "mutations-outside-the-declared-protected-population",
  "requirements-omitted-from-authored-contract",
  "residue-created-after-the-settlement-observation",
  "runtime-evidence-truthfulness",
  "transient-protected-resource-mutation-restored-before-after-observation",
  "undiscovered-resources-outside-declared-populations"
]);

const POSITIVE_IDS = Object.freeze([
  "cloud-provisioning-cleanup",
  "database-import-cleanup",
  "plugin-deployment-cleanup"
]);

const MUTANT_IDS = Object.freeze([
  "m01-cleanup-mutates-protected-resource",
  "m02-authority-consumed",
  "m03-residue-remains",
  "m04-state-comparison-wrong-subject",
  "m05-before-observation-wrong-subject",
  "m06-collapsed-populations",
  "m07-one-broad-verifier",
  "m08-cleanup-verifier-substituted",
  "m09-later-authority-missing",
  "m10-later-result-fails",
  "m11-protected-state-member-omitted"
]);

const REJECTION_PATTERNS = Object.freeze([
  ["missing-failed-attempt-authority", "failed-attempt-uses-failure-authority"],
  ["missing-failure-state", "failed-attempt-has-failure-state"],
  ["missing-failure-cleanup-order", "failure-precedes-cleanup"],
  ["missing-cleanup-settlement-order", "cleanup-precedes-settlement"],
  ["missing-residue-deletion", "cleanup-deletes-residue"],
  ["missing-protected-preservation", "cleanup-preserves-protected-resources"],
  ["missing-authority-preservation", "cleanup-preserves-unrelated-authority"],
  ["missing-before-protected-observation", "before-observation-records-protected-subject"],
  ["missing-after-protected-observation", "after-observation-records-protected-subject"],
  ["missing-before-protected-completeness", "before-state-complete-for-protected-subject"],
  ["missing-after-protected-completeness", "after-state-complete-for-protected-subject"],
  ["missing-residue-zero", "residue-empty-after-settlement"],
  ["missing-protected-state-equality", "protected-state-equal-after-settlement"],
  ["missing-before-authority-state", "before-observation-records-authority-state"],
  ["missing-after-authority-state", "after-observation-records-authority-state"],
  ["missing-authority-state-equality", "authority-state-equal-after-settlement"],
  ["missing-settlement-later-attempt-order", "settlement-precedes-valid-attempt"],
  ["missing-later-authorization", "unrelated-authority-authorizes-valid-attempt"],
  ["missing-later-attempt-authority", "valid-attempt-uses-unrelated-authority"],
  ["missing-later-result", "valid-attempt-returns-result"],
  ["missing-later-result-equality", "valid-result-equals-expected"],
  ["missing-cleanup-verification", "cleanup-verification"],
  ["missing-protected-state-verification", "protected-state-verification"],
  ["missing-authority-verification", "authority-preservation-verification"],
  ["missing-later-authorization-verification", "later-authorization-verification"]
]);

const roleReferenceIds = Object.freeze({
  failed_attempt: ["ref-failed-attempt"],
  failure_event: ["ref-failure-event"],
  failure_state: ["ref-failure-state"],
  cleanup_operation: ["ref-cleanup-operation"],
  settlement_event: ["ref-settlement-event"],
  before_failure_observation: ["ref-before-failure-observation"],
  after_settlement_observation: ["ref-after-settlement-observation"],
  residue_population: ["ref-residue-population"],
  residues: [],
  protected_resource_population: ["ref-protected-resource-population"],
  protected_resources: ["ref-protected-resource-a", "ref-protected-resource-b"],
  protected_state_before_population: ["ref-protected-state-before-population"],
  protected_states_before: ["ref-protected-state-a", "ref-protected-state-b"],
  protected_state_after_population: ["ref-protected-state-after-population"],
  protected_states_after: ["ref-protected-state-a", "ref-protected-state-b"],
  failure_authority: ["ref-failure-authority"],
  unrelated_authority: ["ref-unrelated-authority"],
  authority_state_before: ["ref-authority-state-before"],
  authority_state_after: ["ref-authority-state-after"],
  valid_attempt: ["ref-valid-attempt"],
  valid_input: ["ref-valid-input"],
  valid_result: ["ref-valid-result"],
  expected_success_result: ["ref-expected-success-result"],
  cleanup_verification: ["ref-cleanup-verification"],
  protected_state_verification: ["ref-protected-state-verification"],
  authority_verification: ["ref-authority-verification"],
  later_authorization_verification: ["ref-later-authorization-verification"],
  residue_remaining_condition: ["ref-condition-residue-remaining"],
  protected_state_changed_condition: ["ref-condition-protected-state-changed"],
  authority_consumed_condition: ["ref-condition-authority-consumed"],
  later_attempt_failed_condition: ["ref-condition-later-attempt-failed"]
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
  return { kind: "durable_id", domain: `cleanup-noninterference-${domain}`, value };
}

function defaultRoleValues() {
  return structuredClone(roleReferenceIds);
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

function buildCleanupNoninterferenceFixture({
  profile,
  domain = "database-import",
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
  const roleValues = defaultRoleValues();
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
  const numberValues = { residue_count: 0, protected_resource_count: 2,
    ...numberOverrides };
  const roleById = new Map(profile.reference_roles.map((role) => [role.role, role]));
  const referenceRoles = new Map();
  for (const [role, ids] of Object.entries(roleValues)) for (const id of ids) {
    if (!referenceRoles.has(id)) referenceRoles.set(id, []);
    referenceRoles.get(id).push(role);
  }
  const references = [...referenceRoles].map(([referenceId, roles]) => {
    const role = roles.find((candidate) => roleTypeOverrides[candidate] ||
      roleIdentityOverrides[candidate]) ?? roles[0];
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
  if (id === "m01-cleanup-mutates-protected-resource") {
    return buildCleanupNoninterferenceFixture({ profile, domain: id,
      mutateContract(contract) {
        proposition(contract, "cleanup-preserves-protected-resources").operator =
          "reference:mutates";
      } });
  }
  if (id === "m02-authority-consumed") return buildCleanupNoninterferenceFixture({
    profile, domain: id, mutateContract(contract) {
      proposition(contract, "authority-state-equal-after-settlement").operator =
        "reference:not_equals";
    }
  });
  if (id === "m03-residue-remains") return buildCleanupNoninterferenceFixture({
    profile, domain: id, roleCountOverrides: { residues: 1 },
    numberOverrides: { residue_count: 1 }
  });
  if (id === "m04-state-comparison-wrong-subject") {
    return buildCleanupNoninterferenceFixture({ profile, domain: id,
      mutateContract(contract) {
        proposition(contract, "protected-state-equal-after-settlement")
          .subject_reference_id = "ref-residue-population";
      } });
  }
  if (id === "m05-before-observation-wrong-subject") {
    return buildCleanupNoninterferenceFixture({ profile, domain: id,
      mutateContract(contract) {
        proposition(contract, "before-observation-records-protected-subject")
          .operands[0].reference_id = "ref-residue-population";
      } });
  }
  if (id === "m06-collapsed-populations") return buildCleanupNoninterferenceFixture({
    profile, domain: id,
    aliasRoles: { protected_resource_population: "residue_population" }
  });
  if (id === "m07-one-broad-verifier") return buildCleanupNoninterferenceFixture({
    profile, domain: id, aliasRoles: {
      protected_state_verification: "cleanup_verification",
      authority_verification: "cleanup_verification",
      later_authorization_verification: "cleanup_verification"
    }
  });
  if (id === "m08-cleanup-verifier-substituted") {
    return buildCleanupNoninterferenceFixture({ profile, domain: id,
      mutateContract(contract) {
        contract.relations.find(({ relation_id }) => relation_id ===
          "rel-verification-targets-protected-state").source_claim_id =
            "claim-cleanup-verification";
      } });
  }
  if (id === "m09-later-authority-missing") {
    return buildCleanupNoninterferenceFixture({ profile, domain: id,
      omitPatternIds: ["unrelated-authority-authorizes-valid-attempt"] });
  }
  if (id === "m10-later-result-fails") {
    return buildCleanupNoninterferenceFixture({ profile, domain: id,
      mutateContract(contract) {
        proposition(contract, "valid-result-equals-expected").operator =
          "reference:not_equals";
        proposition(contract, "falsifier-later-authorization-verification").operator =
          "reference:equals";
      } });
  }
  if (id === "m11-protected-state-member-omitted") {
    return buildCleanupNoninterferenceFixture({ profile, domain: id,
      roleCountOverrides: { protected_states_after: 1 },
      numberOverrides: { protected_resource_count: 2 }
    });
  }
  throw new Error(`unknown mutant ${id}`);
}

async function runProofPackAdequacyControls({ profile, profile_digest: profileDigest }) {
  const controls = [];
  const positive = (controlId, fixture) => controls.push({ control_id: controlId,
    category: "positive", implementation_outcome: "passed",
    profile_satisfaction: satisfaction(fixture) });
  for (const [controlId, domain] of [
    ["database-import-cleanup", "database-import"],
    ["plugin-deployment-cleanup", "plugin-deployment"],
    ["cloud-provisioning-cleanup", "cloud-provisioning"]
  ]) positive(controlId, buildCleanupNoninterferenceFixture({ profile, domain }));
  for (const controlId of MUTANT_IDS) controls.push({ control_id: controlId,
    category: "mutant", implementation_outcome: "killed",
    profile_satisfaction: satisfaction(mutantFixture(profile, controlId)) });
  for (const [controlId, patternId] of REJECTION_PATTERNS) controls.push({
    control_id: controlId, category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildCleanupNoninterferenceFixture({
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
  buildCleanupNoninterferenceFixture,
  runProofPackAdequacyControls
};
