import { createHash } from "node:crypto";

import { evaluateStableProofPackFixtureV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";

const GUARANTEE = "For one declared lifecycle entity, terminal event, terminal state, and explicit bounded horizon, one complete nonempty horizon-scoped observation population records the terminal state for every observation after the terminal event and before the horizon; complete singleton observed-state and terminal-state populations are equal; and one complete in-horizon reactivation-event population has exact cardinality zero.";

const EXCLUSIONS = Object.freeze([
  "delivered-evidence-authenticity-or-plan-implementation",
  "dishonest-identity-population-state-event-observation-and-horizon-grounding",
  "forever-after-stability",
  "observations-events-actors-and-resources-outside-declared-populations",
  "post-horizon-behavior",
  "real-time-truth-or-clock-accuracy",
  "transient-state-changes-between-elected-observations"
]);

const POSITIVE_IDS = Object.freeze([
  "credential-revocation",
  "upload-abort",
  "workflow-completion"
]);

const MUTANT_IDS = Object.freeze([
  "bounded-state-regression",
  "in-horizon-reactivation",
  "observation-outside-bounded-order"
]);

const REJECTION_PATTERNS = Object.freeze([
  ["missing-terminal-entity-link", "terminal-event-completes-entity"],
  ["missing-terminal-state-link", "terminal-event-has-state"],
  ["missing-terminal-state-membership", "terminal-state-in-terminal-population"],
  ["missing-terminal-before-observations", "terminal-before-each-observation"],
  ["missing-observations-before-horizon", "each-observation-before-horizon"],
  ["missing-observation-reads", "each-observation-reads-entity"],
  ["missing-observation-recording", "each-observation-records-terminal-state"],
  ["missing-observed-state-equality", "observed-states-equal-terminal-state"],
  ["missing-zero-reactivation", "reactivation-count-zero"],
  ["missing-bounded-read-spine", "verification-reads-bounded-window"],
  ["missing-state-verification", "verify-bounded-state-stability"],
  ["missing-reactivation-verification", "verify-zero-reactivation"]
]);

const roleReferenceIds = Object.freeze({
  lifecycle_entity: ["ref-lifecycle-entity"],
  terminal_event: ["ref-terminal-event"],
  terminal_state: ["ref-terminal-state"],
  bounded_horizon: ["ref-bounded-horizon"],
  observation_population: ["ref-observation-population"],
  observations: ["ref-observation-1", "ref-observation-2"],
  terminal_state_population: ["ref-terminal-state-population"],
  terminal_states: ["ref-terminal-state"],
  observed_state_population: ["ref-observed-state-population"],
  observed_states: ["ref-terminal-state"],
  reactivation_population: ["ref-reactivation-population"],
  reactivation_events: [],
  reactivation_count_signal: ["ref-reactivation-count-signal"],
  verification: ["ref-verification"],
  state_regression_condition: ["ref-state-regression-condition"],
  reactivation_condition: ["ref-reactivation-condition"]
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
  return { kind: "durable_id", domain: `bounded-terminal-stability-${domain}`, value };
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

function buildBoundedTerminalStabilityFixture({
  profile,
  domain = "workflow-completion",
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
  const numberValues = { observation_count: roleValues.observations.length,
    state_count: 1, reactivation_count: 0,
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
  if (id === "bounded-state-regression") {
    return buildBoundedTerminalStabilityFixture({ profile, domain: id,
      mutateContract(contract) {
        proposition(contract, "each-observation-records-terminal-state-2").operands = [
          ref("ref-state-regression-condition")
        ];
      } });
  }
  if (id === "in-horizon-reactivation") return buildBoundedTerminalStabilityFixture({
    profile, domain: id, roleCountOverrides: { reactivation_events: 1 },
    numberOverrides: { reactivation_count: 1 }
  });
  if (id === "observation-outside-bounded-order") {
    return buildBoundedTerminalStabilityFixture({ profile, domain: id,
      mutateContract(contract) {
        proposition(contract, "each-observation-before-horizon-2").operator =
          "reference:follows";
      } });
  }
  throw new Error(`unknown mutant ${id}`);
}

async function runProofPackAdequacyControls({ profile, profile_digest: profileDigest }) {
  const controls = [];
  const positive = (controlId, fixture) => controls.push({ control_id: controlId,
    category: "positive", implementation_outcome: "passed",
    profile_satisfaction: satisfaction(fixture) });
  for (const [controlId, observationCount] of [
    ["workflow-completion", 1],
    ["credential-revocation", 3],
    ["upload-abort", 5]
  ]) positive(controlId, buildBoundedTerminalStabilityFixture({
    profile, domain: controlId,
    roleCountOverrides: { observations: observationCount },
    numberOverrides: { observation_count: observationCount }
  }));
  for (const controlId of MUTANT_IDS) controls.push({ control_id: controlId,
    category: "mutant", implementation_outcome: "killed",
    profile_satisfaction: satisfaction(mutantFixture(profile, controlId)) });
  for (const [controlId, patternId] of REJECTION_PATTERNS) controls.push({
    control_id: controlId, category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildBoundedTerminalStabilityFixture({
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
  buildBoundedTerminalStabilityFixture,
  runProofPackAdequacyControls
};
