import { createHash } from "node:crypto";

import { evaluateVerificationProfileV034
} from "../../lib/verification-profile-v034.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";

const GUARANTEE = "For one declared authority and revocation event, one complete declared enforcement-consumer population applies the same revoked state during a finite declared propagation interval after revocation and before every member of one complete declared post-revocation attempt population; every such attempt uses that authority, targets that consumer population, is a member of an equal complete refused-attempt population, and neither writes nor mutates any member of one complete declared protected-effect population.";

const EXCLUSIONS = Object.freeze([
  "consumers-attempts-resources-and-effects-outside-declared-complete-populations",
  "delivered-evidence-authenticity-or-plan-implementation",
  "dishonest-authority-event-state-population-identity-and-role-grounding",
  "eventual-delivery-propagation-liveness-or-wall-clock-bound",
  "runtime-truth-or-authenticity-of-authored-claims",
  "concurrency-outside-the-declared-revocation-propagation-attempt-order"
]);

const POSITIVE_IDS = Object.freeze([
  "api-gateway-credential",
  "distributed-signing-key",
  "edge-cache-session"
]);

const MUTANT_IDS = Object.freeze([
  "accepted-post-revocation-attempt",
  "post-revocation-protected-mutation",
  "post-revocation-protected-write",
  "stale-consumer"
]);

const REJECTION_PATTERNS = Object.freeze([
  ["missing-revocation-authority-link", "revocation-invalidates-authority"],
  ["missing-revoked-state-record", "revocation-records-revoked-state"],
  ["missing-revocation-propagation-order", "revocation-precedes-propagation-interval"],
  ["missing-consumer-authority-read", "each-consumer-observes-authority-during-propagation"],
  ["missing-consumer-state-application", "each-consumer-applies-revoked-state-during-propagation"],
  ["missing-applied-state-equivalence", "applied-state-equals-revoked-state"],
  ["missing-propagation-attempt-order", "propagation-interval-precedes-each-attempt"],
  ["missing-attempt-authority-use", "each-attempt-uses-revoked-authority"],
  ["missing-attempt-consumer-target", "each-attempt-targets-consumer-population"],
  ["missing-attempt-refusal", "each-attempt-is-refused"],
  ["missing-pointwise-write-prohibition", "each-attempt-does-not-write-protected-effects"],
  ["missing-pointwise-mutation-prohibition", "each-attempt-does-not-mutate-protected-effects"],
  ["missing-refused-population-equivalence", "all-post-revocation-attempts-refused"],
  ["missing-aggregate-write-prohibition", "no-post-revocation-attempt-writes-protected-effects"],
  ["missing-aggregate-mutation-prohibition", "no-post-revocation-attempt-mutates-protected-effects"],
  ["missing-verifier-revocation-spine", "verification-reads-shared-revocation-graph"],
  ["missing-consumer-state-verification", "verify-consumer-applied-state"],
  ["missing-refusal-verification", "verify-all-attempts-refused"],
  ["missing-write-verification", "verify-no-protected-write"],
  ["missing-mutation-verification", "verify-no-protected-mutation"]
]);

const baseRoleValues = Object.freeze({
  authority: ["ref-authority"],
  revocation_event: ["ref-revocation"],
  propagation_interval: ["ref-propagation-interval"],
  revoked_state: ["ref-revoked-state"],
  refused_state: ["ref-refused-state"],
  consumer_population: ["ref-consumer-population"],
  consumers: ["ref-consumer-1", "ref-consumer-2"],
  attempt_population: ["ref-attempt-population"],
  attempts: ["ref-attempt-1", "ref-attempt-2"],
  refused_attempt_population: ["ref-refused-attempt-population"],
  refused_attempts: ["ref-attempt-1", "ref-attempt-2"],
  protected_effect_population: ["ref-effect-population"],
  protected_effects: ["ref-effect-1"],
  revoked_state_population: ["ref-revoked-state-population"],
  revoked_states: ["ref-revoked-state"],
  applied_state_population: ["ref-applied-state-population"],
  applied_states: ["ref-revoked-state"],
  verification: ["ref-verification"],
  stale_consumer_condition: ["ref-stale-consumer-condition"],
  accepted_attempt_condition: ["ref-accepted-attempt-condition"],
  post_revocation_write_condition: ["ref-post-revocation-write-condition"],
  post_revocation_mutation_condition: ["ref-post-revocation-mutation-condition"]
});

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function identity(kind, domain, value) {
  if (kind === "repository_path") return { kind, repository: `example/${domain}`,
    path: `fixtures/${domain}/${value}` };
  if (kind === "code_symbol") return { kind, repository: `example/${domain}`,
    path: `src/${domain}.mjs`, symbol: value };
  if (kind === "runtime_parameter") return { kind, name: `${domain}.${value}` };
  return { kind: "durable_id", domain: `revocation-propagation-${domain}`, value };
}

function resolveTemplate(template, roles, numbers, local = {}) {
  const values = (role) => local[role] ?? roles[role] ?? [];
  return {
    subject_reference_id: values(template.subject_role)[0],
    operator: template.operator,
    applicability_context: { mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(values) },
    operands: template.operands.flatMap((operand) => operand.kind === "reference"
      ? values(operand.role).map(ref)
      : operand.kind === "number" && operand.value_role
        ? [{ kind: "number", value: numbers[operand.value_role] }]
        : [structuredClone(operand)])
  };
}

function buildRevocationPropagationFixture({
  profile,
  domain = "api-gateway-credential",
  consumerCount = 2,
  attemptCount = 2,
  effectCount = 1,
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
  const roles = structuredClone(baseRoleValues);
  roles.consumers = Array.from({ length: consumerCount }, (_, index) =>
    `ref-consumer-${index + 1}`);
  roles.attempts = Array.from({ length: attemptCount }, (_, index) =>
    `ref-attempt-${index + 1}`);
  roles.refused_attempts = [...roles.attempts];
  roles.protected_effects = Array.from({ length: effectCount }, (_, index) =>
    `ref-effect-${index + 1}`);
  for (const role of detachRoles) roles[role] = roles[role].map(
    (_, index) => `ref-detached-${role.replaceAll("_", "-")}-${index + 1}`);
  for (const [role, count] of Object.entries(roleCountOverrides)) {
    const existing = roles[role] ?? [];
    roles[role] = Array.from({ length: count }, (_, index) =>
      existing[index] ?? `ref-${role.replaceAll("_", "-")}-${index + 1}`);
  }
  for (const [role, source] of Object.entries(aliasRoles)) roles[role] = [...roles[source]];
  const numbers = { consumer_count: roles.consumers.length,
    attempt_count: roles.attempts.length, effect_count: roles.protected_effects.length,
    state_count: 1, ...numberOverrides };
  const roleById = new Map(profile.reference_roles.map((role) => [role.role, role]));
  const referenceRoles = new Map();
  for (const [role, ids] of Object.entries(roles)) for (const id of ids) {
    if (!referenceRoles.has(id)) referenceRoles.set(id, []);
    referenceRoles.get(id).push(role);
  }
  const references = [...referenceRoles].map(([referenceId, assignedRoles]) => {
    const role = assignedRoles.find((candidate) => roleTypeOverrides[candidate] ||
      roleIdentityOverrides[candidate]) ?? assignedRoles[0];
    const definition = roleById.get(role);
    const selected = roleIdentityOverrides[role];
    const kind = selected?.kind ?? definition.allowed_identity_kinds?.[0] ?? "durable_id";
    return { reference_id: referenceId,
      type_term: roleTypeOverrides[role] ?? definition.allowed_type_terms[0],
      identity: structuredClone(selected ?? identity(kind, domain, referenceId.slice(4))) };
  });
  const contract = { schema_version: "controlled-acceptance-contract.experimental.v0.2",
    vocabulary_version: "cv.experimental.0.34",
    profile_id: "acceptance-contract.standard.experimental.v0.2",
    references, propositions: [], claims: [], relations: [], collections: [],
    residue: [], annotations: [] };
  const addClaim = (id, proposition, kind = "evidence", modality = "MUST",
    verificationMethod = null, falsifierId = null) => {
    contract.propositions.push({ proposition_id: `prop-${id}`, ...proposition });
    contract.claims.push({ claim_id: `claim-${id}`, proposition_id: `prop-${id}`,
      kind, modality,
      ...(verificationMethod ? { verification_method: verificationMethod } : {}),
      ...(falsifierId ? { falsifying_proposition_id: `prop-${falsifierId}` } : {}) });
  };
  for (const binding of profile.reference_binding_patterns) {
    const [populationRole, memberRole] = binding.roles;
    const members = roles[memberRole];
    const countBinding = profile.reference_role_count_bindings.find(
      ({ reference_role: candidate }) => candidate === memberRole);
    addClaim(`${binding.pattern_id}-count`, resolveTemplate({
      subject_role: populationRole, operator: "number:has_cardinality",
      applicability_context: binding.applicability_context,
      operands: [{ kind: "number", value: countBinding
        ? numbers[countBinding.number_role] : members.length }]
    }, roles, numbers));
    if (members.length > 0) addClaim(`${binding.pattern_id}-members`, resolveTemplate({
      subject_role: populationRole, operator: "reference:contains",
      applicability_context: binding.applicability_context,
      operands: [{ kind: "reference", role: memberRole }]
    }, roles, numbers));
  }
  const omitted = new Set(omitPatternIds);
  for (const pattern of profile.claim_patterns) {
    if (omitted.has(pattern.pattern_id)) continue;
    if (pattern.for_each) {
      for (const [index, member] of roles[pattern.for_each.population_role].entries()) {
        addClaim(`${pattern.pattern_id}-${index + 1}`,
          resolveTemplate(pattern.proposition_template, roles, numbers,
            { [pattern.for_each.member_role]: [member] }),
          pattern.claim_kind,
          pattern.pattern_id === selectLastModalityPattern
            ? pattern.allowed_modalities.at(-1) : pattern.allowed_modalities[0]);
      }
      continue;
    }
    let falsifierId = null;
    if (pattern.falsifying_proposition_template) {
      falsifierId = `falsifier-${pattern.pattern_id}`;
      contract.propositions.push({ proposition_id: `prop-${falsifierId}`,
        ...resolveTemplate(pattern.falsifying_proposition_template, roles, numbers) });
    }
    addClaim(pattern.pattern_id,
      resolveTemplate(pattern.proposition_template, roles, numbers), pattern.claim_kind,
      pattern.pattern_id === selectLastModalityPattern
        ? pattern.allowed_modalities.at(-1) : pattern.allowed_modalities[0],
      pattern.claim_kind === "verification"
        ? pattern.pattern_id === selectLastVerificationPattern
          ? pattern.verification_methods.at(-1) : pattern.verification_methods[0]
        : null,
      falsifierId);
  }
  for (const relation of profile.relation_patterns) if (
    !omitted.has(relation.source_claim_pattern_id) &&
    !omitted.has(relation.target_claim_pattern_id)) contract.relations.push({
      relation_id: `rel-${relation.pattern_id}`, role: relation.role,
      source_claim_id: `claim-${relation.source_claim_pattern_id}`,
      target_claim_id: `claim-${relation.target_claim_pattern_id}`
    });
  const input = {
    input_version: "controlled-contract-verification-profile-input.experimental.v0.2",
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role, reference_ids: [...(roles[role] ?? [])]
    })),
    number_bindings: profile.number_roles.map(({ role }) => ({ role, value: numbers[role] })),
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: []
  };
  mutateContract?.(contract, input, roles);
  mutateInput?.(input, contract, roles);
  return { contract, input, profile };
}

function satisfaction(fixture) {
  return evaluateVerificationProfileV034({ contract: fixture.contract,
    profile: fixture.profile, evaluation_input: fixture.input }).satisfaction;
}

function proposition(contract, id) {
  return contract.propositions.find(({ proposition_id }) => proposition_id === `prop-${id}`);
}

function claim(contract, id) {
  return contract.claims.find(({ claim_id }) => claim_id === `claim-${id}`);
}

function mutantFixture(profile, id) {
  if (id === "stale-consumer") return buildRevocationPropagationFixture({ profile,
    domain: id, mutateContract(contract) {
      proposition(contract, "each-consumer-applies-revoked-state-during-propagation-2")
        .operands = [ref("ref-refused-state")];
    } });
  if (id === "accepted-post-revocation-attempt") {
    return buildRevocationPropagationFixture({ profile, domain: id,
      mutateContract(contract) {
        proposition(contract, "each-attempt-is-refused-1").operands = [ref("ref-revoked-state")];
      } });
  }
  if (id === "post-revocation-protected-write") {
    return buildRevocationPropagationFixture({ profile, domain: id,
      mutateContract(contract) {
        claim(contract, "each-attempt-does-not-write-protected-effects-1").modality = "MUST";
      } });
  }
  if (id === "post-revocation-protected-mutation") {
    return buildRevocationPropagationFixture({ profile, domain: id,
      mutateContract(contract) {
        claim(contract, "each-attempt-does-not-mutate-protected-effects-1").modality = "MUST";
      } });
  }
  throw new Error(`unknown mutant ${id}`);
}

async function runProofPackAdequacyControls({ profile, profile_digest: profileDigest }) {
  const controls = [];
  for (const [controlId, consumers, attempts, effects] of [
    ["api-gateway-credential", 2, 3, 2],
    ["distributed-signing-key", 4, 5, 3],
    ["edge-cache-session", 1, 1, 1]
  ]) controls.push({ control_id: controlId, category: "positive",
    implementation_outcome: "passed", profile_satisfaction: satisfaction(
      buildRevocationPropagationFixture({ profile, domain: controlId,
        consumerCount: consumers, attemptCount: attempts, effectCount: effects })) });
  for (const controlId of MUTANT_IDS) controls.push({ control_id: controlId,
    category: "mutant", implementation_outcome: "killed",
    profile_satisfaction: satisfaction(mutantFixture(profile, controlId)) });
  for (const [controlId, patternId] of REJECTION_PATTERNS) controls.push({
    control_id: controlId, category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildRevocationPropagationFixture({ profile,
      omitPatternIds: [patternId] }))
  });
  for (const controlId of EXCLUSIONS) controls.push({ control_id: controlId,
    category: "exclusion", implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: "not_evaluated" });
  controls.sort((left, right) => left.control_id < right.control_id ? -1 : 1);
  return { schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id, profile_version: profile.profile_version,
    profile_digest: profileDigest,
    guarantee_digest: createHash("sha256").update(GUARANTEE).digest("hex"), controls };
}

export { EXCLUSIONS, GUARANTEE, MUTANT_IDS, POSITIVE_IDS, REJECTION_PATTERNS,
  buildRevocationPropagationFixture, runProofPackAdequacyControls };
