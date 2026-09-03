import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../../lib/native-contract-carrier-v1.mjs";
import { EVALUATION_INPUT_VERSION_V1 } from "../support/stable-v1-proof-pack-runtime.mjs";

const SINGLE_WINNER_EFFECT_V1_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.concurrency.single-winner-effect/2.0.0/profile.json",
  import.meta.url
), "utf8"));

const DEFAULT_ROLE_IDS = Object.freeze({
  operation: ["ref-operation"],
  scoped_key: ["ref-scoped-key"],
  attempt_population: ["ref-attempt-population"],
  attempts: ["ref-winner-attempt", "ref-loser-attempt"],
  winner_attempt: ["ref-winner-attempt"],
  loser_attempt: ["ref-loser-attempt"],
  winner_start: ["ref-winner-start"],
  loser_start: ["ref-loser-start"],
  winner_terminal: ["ref-winner-terminal"],
  loser_terminal: ["ref-loser-terminal"],
  effect_resource: ["ref-effect-resource"],
  effect_population: ["ref-effect-population"],
  effect_occurrences: ["ref-effect-occurrence"],
  effect_occurrence: ["ref-effect-occurrence"],
  effect_count_signal: ["ref-effect-count-signal"],
  winner_post_state: ["ref-winner-post-state"],
  loser_post_state: ["ref-loser-post-state"],
  winner_post_observation: ["ref-winner-post-observation"],
  loser_post_observation: ["ref-loser-post-observation"],
  verification: ["ref-verification"],
  winner_rejected_condition: ["ref-winner-rejected-condition"],
  loser_accepted_condition: ["ref-loser-accepted-condition"],
  non_single_effect_condition: ["ref-non-single-effect-condition"],
  loser_effect_condition: ["ref-loser-effect-condition"],
  loser_state_diverged_condition: ["ref-loser-state-diverged-condition"]
});

const DEFAULT_NUMBER_VALUES = Object.freeze({ attempt_count: 2, effect_count: 1 });
const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function identityFor(role, referenceId, domain) {
  if (role === "verification") return {
    kind: "code_symbol",
    repository: `fixture-${domain}`,
    path: "tests/single-winner-effect.test.mjs",
    symbol: "singleWinnerEffect"
  };
  if (role.endsWith("_condition")) return {
    kind: "profile_term", term: `single-winner-effect:${referenceId.slice(4)}`
  };
  return {
    kind: "durable_id", domain: `single-winner-effect:${domain}`,
    value: referenceId.slice(4)
  };
}

function resolveTemplate(template, roleIds, numberValues) {
  const idsForRole = (role) => roleIds[role] ?? [];
  return {
    subject_reference_id: idsForRole(template.subject_role)[0],
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(idsForRole)
    },
    operands: template.operands.flatMap((operand) => {
      if (operand.kind === "reference") return idsForRole(operand.role).map(ref);
      if (operand.kind === "number") return [{
        kind: "number",
        value: operand.value_role === undefined
          ? operand.value : numberValues[operand.value_role]
      }];
      return [structuredClone(operand)];
    })
  };
}

function addPopulationClaims(contract, populationId, memberIds, suffix) {
  contract.propositions.push({
    proposition_id: `prop-population-${suffix}-contains`,
    subject_reference_id: populationId,
    operator: "reference:contains",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: memberIds.map(ref)
  });
  contract.claims.push({
    claim_id: `claim-population-${suffix}-contains`, kind: "evidence",
    modality: "MUST", proposition_id: `prop-population-${suffix}-contains`
  });
  contract.propositions.push({
    proposition_id: `prop-population-${suffix}-cardinality`,
    subject_reference_id: populationId,
    operator: "number:has_cardinality",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "number", value: memberIds.length }]
  });
  contract.claims.push({
    claim_id: `claim-population-${suffix}-cardinality`, kind: "evidence",
    modality: "MUST", proposition_id: `prop-population-${suffix}-cardinality`
  });
}

function buildSingleWinnerEffectFixture({
  profile: suppliedProfile = SINGLE_WINNER_EFFECT_V1_PROFILE,
  domain = "database-unique-insert",
  role_id_overrides: roleIdOverrides = {},
  role_type_overrides: roleTypeOverrides = {},
  identity_overrides: identityOverrides = {},
  number_value_overrides: numberValueOverrides = {},
  modality_overrides: modalityOverrides = {},
  verification_method: verificationMethod = "test_execution",
  verification_method_overrides: verificationMethodOverrides = {},
  drop_pattern_ids: dropPatternIds = [],
  proposition_overrides: propositionOverrides = {},
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const roleIds = Object.fromEntries(Object.entries(DEFAULT_ROLE_IDS).map(
    ([role, ids]) => [role, [...(roleIdOverrides[role] ?? ids)]]
  ));
  const numberValues = { ...DEFAULT_NUMBER_VALUES, ...numberValueOverrides };
  const referenceById = new Map();
  for (const declaredRole of profile.reference_roles) {
    for (const referenceId of roleIds[declaredRole.role] ?? []) {
      if (referenceById.has(referenceId)) continue;
      const identity = typeof identityOverrides[declaredRole.role] === "function"
        ? identityOverrides[declaredRole.role](referenceId)
        : identityOverrides[declaredRole.role] ??
          identityFor(declaredRole.role, referenceId, domain);
      referenceById.set(referenceId, {
        reference_id: referenceId,
        type_term: roleTypeOverrides[declaredRole.role] ??
          declaredRole.allowed_type_terms[0],
        identity: structuredClone(identity)
      });
    }
  }
  const contract = {
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    references: [...referenceById.values()],
    propositions: [], claims: [], relations: [], collections: [], residue: [],
    annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  for (const pattern of profile.reference_binding_patterns) {
    if (pattern.comparison !== "complete_population") continue;
    const [populationRole, memberRole] = pattern.roles;
    addPopulationClaims(
      contract,
      roleIds[populationRole][0],
      roleIds[memberRole],
      populationRole.replaceAll("_", "-")
    );
  }
  const dropped = new Set(dropPatternIds);
  const claimIdsByPattern = new Map();
  for (const pattern of profile.claim_patterns) {
    if (dropped.has(pattern.pattern_id)) continue;
    const propositionId = `prop-${pattern.pattern_id}`;
    contract.propositions.push({
      proposition_id: propositionId,
      ...resolveTemplate(pattern.proposition_template, roleIds, numberValues),
      ...(propositionOverrides[pattern.pattern_id] ?? {})
    });
    const claimId = `claim-${pattern.pattern_id}`;
    const claim = {
      claim_id: claimId,
      kind: pattern.claim_kind,
      modality: modalityOverrides[pattern.pattern_id] ?? pattern.allowed_modalities[0],
      proposition_id: propositionId
    };
    if (pattern.claim_kind === "verification") {
      const falsifierId = `prop-falsifier-${pattern.pattern_id}`;
      contract.propositions.push({
        proposition_id: falsifierId,
        ...resolveTemplate(
          pattern.falsifying_proposition_template, roleIds, numberValues
        ),
        ...(propositionOverrides[`falsifier:${pattern.pattern_id}`] ?? {})
      });
      claim.verification_method = verificationMethodOverrides[pattern.pattern_id] ??
        verificationMethod;
      claim.falsifying_proposition_id = falsifierId;
    }
    contract.claims.push(claim);
    claimIdsByPattern.set(pattern.pattern_id, claimId);
  }
  contract.relations = profile.relation_patterns.flatMap((pattern) => {
    const sourceClaimId = claimIdsByPattern.get(pattern.source_claim_pattern_id);
    const targetClaimId = claimIdsByPattern.get(pattern.target_claim_pattern_id);
    return sourceClaimId && targetClaimId ? [{
      relation_id: `rel-${pattern.pattern_id}`,
      role: pattern.role,
      source_claim_id: sourceClaimId,
      target_claim_id: targetClaimId
    }] : [];
  });
  const input = {
    input_version: EVALUATION_INPUT_VERSION_V1,
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role, reference_ids: [...(roleIds[role] ?? [])]
    })),
    number_bindings: profile.number_roles.map(({ role }) => ({
      role, value: numberValues[role]
    })),
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [], stable_evaluation: {}
  };
  mutateContract?.(contract, { claimIdsByPattern, roleIds, numberValues });
  mutateInput?.(input, { roleIds, numberValues });
  return { contract, input, evaluation_input: input, profile, roleIds, numberValues };
}

const findClaim = (contract, patternId) => contract.claims.find(
  ({ claim_id: id }) => id === `claim-${patternId}`
);
const findProposition = (contract, patternId, { falsifier = false } = {}) =>
  contract.propositions.find(({ proposition_id: id }) => id ===
    `${falsifier ? "prop-falsifier-" : "prop-"}${patternId}`);

export {
  SINGLE_WINNER_EFFECT_V1_PROFILE,
  buildSingleWinnerEffectFixture,
  findClaim,
  findProposition,
  ref
};
