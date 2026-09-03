import { createHash } from "node:crypto";

import { evaluateStableProofPackFixtureV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";

const GUARANTEE = "For one declared resource and fence, complete declared predecessor attempt and effect populations precede the fence under one predecessor authority and epoch; successor activation and complete declared successor attempt and effect populations follow the fence under one distinct successor authority and epoch; every complete declared post-fence predecessor attempt is refused and writes or mutates no declared protected resource; the complete post-fence predecessor protected-effect and dual-active observation populations are empty; and distinct observations ordered around the fence record the corresponding predecessor and successor authority, epoch, and resource.";

const EXCLUSIONS = Object.freeze([
  "delivered-evidence-authenticity-or-plan-implementation",
  "dishonest-authority-epoch-resource-fence-attempt-effect-and-observation-grounding",
  "distributed-clock-agreement-or-a-total-order-beyond-the-declared-graph",
  "liveness-eventual-takeover-or-bounded-handoff-duration",
  "repeated-nested-or-unbounded-ownership-histories",
  "runtime-events-actors-resources-and-effects-outside-declared-populations",
  "wall-clock-or-real-time-truth"
]);

const POSITIVE_IDS = Object.freeze([
  "database-primary-lease",
  "deployment-controller-ownership",
  "object-store-writer-token"
]);

const MUTANT_IDS = Object.freeze([
  "dual-active-observation",
  "post-fence-predecessor-effect",
  "predecessor-effect-after-fence",
  "successor-effect-before-fence"
]);

const REJECTION_PATTERNS = Object.freeze([
  ["missing-predecessor-epoch", "predecessor-authority-epoch"],
  ["missing-successor-epoch", "successor-authority-epoch"],
  ["missing-predecessor-attempt-order", "each-predecessor-pre-fence-attempt-before-fence"],
  ["missing-post-fence-refusal", "each-predecessor-post-fence-attempt-refused"],
  ["missing-post-fence-no-write", "each-predecessor-post-fence-attempt-no-write"],
  ["missing-post-fence-no-mutation", "each-predecessor-post-fence-attempt-no-mutation"],
  ["missing-successor-activation", "fence-precedes-successor-activation"],
  ["missing-predecessor-effect-order", "predecessor-effects-before-fence"],
  ["missing-successor-effect-order", "successor-activation-and-effects-after-fence"],
  ["missing-post-fence-zero", "post-fence-predecessor-protected-effects-zero"],
  ["missing-dual-active-zero", "dual-active-observations-zero"],
  ["missing-dual-active-verification", "dual-active-verification"]
]);

const roleReferenceIds = Object.freeze({
  resource: ["ref-resource"],
  predecessor_authority: ["ref-predecessor-authority"],
  successor_authority: ["ref-successor-authority"],
  predecessor_epoch: ["ref-predecessor-epoch"],
  successor_epoch: ["ref-successor-epoch"],
  fence_event: ["ref-fence-event"],
  successor_activation_event: ["ref-successor-activation-event"],
  predecessor_pre_fence_attempt_population: ["ref-predecessor-pre-attempt-population"],
  predecessor_pre_fence_attempts: ["ref-predecessor-pre-attempt-1", "ref-predecessor-pre-attempt-2"],
  predecessor_post_fence_attempt_population: ["ref-predecessor-post-attempt-population"],
  predecessor_post_fence_attempts: ["ref-predecessor-post-attempt-1", "ref-predecessor-post-attempt-2"],
  successor_post_fence_attempt_population: ["ref-successor-post-attempt-population"],
  successor_post_fence_attempts: ["ref-successor-post-attempt-1", "ref-successor-post-attempt-2"],
  predecessor_effect_population: ["ref-predecessor-effect-population"],
  predecessor_effects: ["ref-predecessor-effect-1", "ref-predecessor-effect-2"],
  successor_effect_population: ["ref-successor-effect-population"],
  successor_effects: ["ref-successor-effect-1", "ref-successor-effect-2"],
  post_fence_predecessor_protected_effect_population: ["ref-post-fence-predecessor-effect-population"],
  post_fence_predecessor_protected_effects: [],
  active_authority_observation_population: ["ref-active-observation-population"],
  active_authority_observations: ["ref-pre-fence-observation", "ref-post-fence-observation", "ref-extra-observation"],
  dual_active_observation_population: ["ref-dual-active-observation-population"],
  dual_active_observations: [],
  pre_fence_observation: ["ref-pre-fence-observation"],
  post_fence_observation: ["ref-post-fence-observation"],
  refused_state: ["ref-refused-state"],
  predecessor_effect_window_state: ["ref-predecessor-effect-window-state"],
  before_fence_state: ["ref-before-fence-state"],
  successor_effect_window_state: ["ref-successor-effect-window-state"],
  after_fence_state: ["ref-after-fence-state"],
  predecessor_order_verification: ["ref-predecessor-order-verification"],
  successor_order_verification: ["ref-successor-order-verification"],
  post_fence_refusal_verification: ["ref-post-fence-refusal-verification"],
  dual_active_verification: ["ref-dual-active-verification"]
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
  return { kind: "durable_id", domain: `fenced-handoff-${domain}`, value };
}

function defaultRoleValues() {
  return structuredClone(roleReferenceIds);
}

function resolveTemplate(template, roleValues, numberValues, localRoleValues = {}) {
  const values = (role) => localRoleValues[role] ?? roleValues[role] ?? [];
  return {
    subject_reference_id: values(template.subject_role).length === 1
      ? values(template.subject_role)[0] : null,
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(
        (role) => values(role)
      )
    },
    operands: template.operands.flatMap((operand) => operand.kind === "reference"
      ? values(operand.role).map(ref)
      : operand.kind === "number" && operand.value_role
        ? [{ kind: "number", value: numberValues[operand.value_role] }]
        : [structuredClone(operand)])
  };
}

function buildFencedHandoffFixture({
  profile,
  domain = "database-primary-lease",
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
  const numberValues = {
    predecessor_pre_fence_attempt_count: roleValues.predecessor_pre_fence_attempts.length,
    predecessor_post_fence_attempt_count: roleValues.predecessor_post_fence_attempts.length,
    successor_post_fence_attempt_count: roleValues.successor_post_fence_attempts.length,
    predecessor_effect_count: roleValues.predecessor_effects.length,
    successor_effect_count: roleValues.successor_effects.length,
    post_fence_predecessor_protected_effect_count:
      roleValues.post_fence_predecessor_protected_effects.length,
    active_authority_observation_count: roleValues.active_authority_observations.length,
    dual_active_observation_count: roleValues.dual_active_observations.length,
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
    if (pattern.for_each) {
      const members = roleValues[pattern.for_each.population_role] ?? [];
      for (const [index, member] of members.entries()) addClaim(
        `${pattern.pattern_id}-${index + 1}`,
        resolveTemplate(pattern.proposition_template, roleValues, numberValues, {
          [pattern.for_each.member_role]: [member]
        }), pattern.claim_kind,
        pattern.pattern_id === selectLastModalityPattern
          ? pattern.allowed_modalities.at(-1) : pattern.allowed_modalities[0]
      );
      continue;
    }
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
  if (id === "predecessor-effect-after-fence") {
    return buildFencedHandoffFixture({ profile, domain: id,
      mutateContract(contract) {
        const claim = contract.claims.find(({ claim_id }) =>
          claim_id === "claim-each-predecessor-effect-before-fence-1");
        const target = contract.propositions.find(
          ({ proposition_id }) => proposition_id === claim.proposition_id);
        target.subject_reference_id = "ref-fence-event";
        target.operands = [ref("ref-predecessor-effect-1")];
      } });
  }
  if (id === "successor-effect-before-fence") {
    return buildFencedHandoffFixture({ profile, domain: id,
      mutateContract(contract) {
        const claim = contract.claims.find(({ claim_id }) =>
          claim_id === "claim-each-successor-effect-after-fence-1");
        const target = contract.propositions.find(
          ({ proposition_id }) => proposition_id === claim.proposition_id);
        target.subject_reference_id = "ref-successor-effect-1";
        target.operands = [ref("ref-fence-event")];
      } });
  }
  if (id === "post-fence-predecessor-effect") return buildFencedHandoffFixture({
    profile, domain: id,
    roleCountOverrides: { post_fence_predecessor_protected_effects: 1 },
    numberOverrides: { post_fence_predecessor_protected_effect_count: 1 }
  });
  if (id === "dual-active-observation") return buildFencedHandoffFixture({
    profile, domain: id,
    roleCountOverrides: { dual_active_observations: 1 },
    numberOverrides: { dual_active_observation_count: 1 }
  });
  throw new Error(`unknown mutant ${id}`);
}

async function runProofPackAdequacyControls({ profile, profile_digest: profileDigest }) {
  const controls = [];
  const positive = (controlId, fixture) => controls.push({ control_id: controlId,
    category: "positive", implementation_outcome: "passed",
    profile_satisfaction: satisfaction(fixture) });
  for (const [controlId, count] of [
    ["database-primary-lease", 2],
    ["object-store-writer-token", 3],
    ["deployment-controller-ownership", 5]
  ]) positive(controlId, buildFencedHandoffFixture({ profile, domain: controlId,
    roleCountOverrides: {
      predecessor_pre_fence_attempts: count,
      predecessor_post_fence_attempts: Math.max(2, count - 1),
      successor_post_fence_attempts: count,
      predecessor_effects: count,
      successor_effects: Math.max(2, count - 1),
      active_authority_observations: Math.max(3, count)
    }
  }));
  for (const controlId of MUTANT_IDS) controls.push({ control_id: controlId,
    category: "mutant", implementation_outcome: "killed",
    profile_satisfaction: satisfaction(mutantFixture(profile, controlId)) });
  for (const [controlId, patternId] of REJECTION_PATTERNS) controls.push({
    control_id: controlId, category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildFencedHandoffFixture({
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
  buildFencedHandoffFixture,
  runProofPackAdequacyControls
};
