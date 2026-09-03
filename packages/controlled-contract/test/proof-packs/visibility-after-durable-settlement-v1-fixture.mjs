import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../../lib/native-contract-carrier-v1.mjs";
import { EVALUATION_INPUT_VERSION_V1 } from "../support/stable-v1-proof-pack-runtime.mjs";

const VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.ordering.visibility-after-durable-settlement/2.0.0/profile.json",
  import.meta.url
), "utf8"));

const DEFAULT_ROLE_IDS = Object.freeze({
  durable_effect_population: ["ref-durable-population"],
  durable_effects: ["ref-effect-a", "ref-effect-b"],
  settled_effect_population: ["ref-settled-population"],
  settled_effects: ["ref-effect-a", "ref-effect-b"],
  allowed_settled_state_population: ["ref-allowed-state-population"],
  allowed_settled_states: ["ref-settled-state"],
  selected_settled_state: ["ref-settled-state"],
  settlement_event: ["ref-settlement-event"],
  visibility_event: ["ref-visibility-event"],
  post_visibility_observation: ["ref-post-observation"],
  expected_durable_state: ["ref-expected-state"],
  observed_durable_state: ["ref-observed-state"],
  failure_event: ["ref-failure-event"],
  failure_visibility_population: ["ref-failure-visibility-population"],
  failure_visibility_events: [],
  failure_visibility_count_signal: ["ref-failure-visibility-count"],
  verification: ["ref-verification"],
  durable_not_settled_condition: ["ref-durable-not-settled-condition"],
  settled_not_durable_condition: ["ref-settled-not-durable-condition"],
  disallowed_settled_state_condition: ["ref-disallowed-settled-state-condition"],
  premature_visibility_condition: ["ref-premature-visibility-condition"],
  premature_observation_condition: ["ref-premature-observation-condition"],
  stale_observation_condition: ["ref-stale-observation-condition"],
  failure_visibility_condition: ["ref-failure-visibility-condition"]
});

const DEFAULT_NUMBER_VALUES = Object.freeze({ effect_count: 2, zero_visibility_count: 0 });
const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function identityFor(role, referenceId, domain) {
  if (role === "verification") return {
    kind: "code_symbol", repository: `fixture-${domain}`,
    path: "tests/visibility-after-settlement.test.mjs", symbol: "visibilityAfterSettlement"
  };
  if (role.endsWith("_condition")) return {
    kind: "profile_term", term: `visibility-after-settlement:${referenceId.slice(4)}`
  };
  return { kind: "durable_id", domain: `visibility-after-settlement:${domain}`,
    value: referenceId.slice(4) };
}

function resolveTemplate(template, roleIds, numberValues, local = {}) {
  const idsForRole = (role) => local[role] ? [local[role]] : roleIds[role];
  return {
    subject_reference_id: idsForRole(template.subject_role)[0],
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(idsForRole)
    },
    operands: template.operands.flatMap((operand) => {
      if (operand.kind === "reference") return idsForRole(operand.role).map(ref);
      if (operand.kind === "number") return [{ kind: "number", value:
        operand.value_role === undefined ? operand.value : numberValues[operand.value_role] }];
      return [structuredClone(operand)];
    })
  };
}

function addPopulationClaims(contract, populationId, memberIds, suffix) {
  if (memberIds.length > 0) {
    contract.propositions.push({ proposition_id: `prop-population-${suffix}-contains`,
      subject_reference_id: populationId, operator: "reference:contains",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: memberIds.map(ref) });
    contract.claims.push({ claim_id: `claim-population-${suffix}-contains`, kind: "evidence",
      modality: "MUST", proposition_id: `prop-population-${suffix}-contains` });
  }
  contract.propositions.push({ proposition_id: `prop-population-${suffix}-cardinality`,
    subject_reference_id: populationId, operator: "number:has_cardinality",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "number", value: memberIds.length }] });
  contract.claims.push({ claim_id: `claim-population-${suffix}-cardinality`, kind: "evidence",
    modality: "MUST", proposition_id: `prop-population-${suffix}-cardinality` });
}

function buildVisibilityAfterDurableSettlementFixture({
  profile: suppliedProfile = VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE,
  domain = "database-commit", role_id_overrides: roleIdOverrides = {},
  role_type_overrides: roleTypeOverrides = {}, identity_overrides: identityOverrides = {},
  number_value_overrides: numberValueOverrides = {}, verification_method: verificationMethod = "test_execution",
  verification_method_overrides: verificationMethodOverrides = {},
  modality_overrides: modalityOverrides = {}, evaluation_stage: evaluationStage = "pre_dispatch",
  drop_pattern_ids: dropPatternIds = [], proposition_overrides: propositionOverrides = {},
  mutate_contract: mutateContract, mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const roleIds = Object.fromEntries(Object.entries(DEFAULT_ROLE_IDS).map(([role, ids]) =>
    [role, [...(roleIdOverrides[role] ?? ids)]]));
  const numberValues = { ...DEFAULT_NUMBER_VALUES, ...numberValueOverrides };
  if (!Object.hasOwn(numberValueOverrides, "effect_count")) {
    numberValues.effect_count = roleIds.durable_effects.length;
  }
  const referenceById = new Map();
  for (const declaredRole of profile.reference_roles) for (const referenceId of roleIds[declaredRole.role]) {
    if (referenceById.has(referenceId)) continue;
    referenceById.set(referenceId, { reference_id: referenceId,
      type_term: roleTypeOverrides[declaredRole.role] ?? declaredRole.allowed_type_terms[0],
      identity: structuredClone(typeof identityOverrides[declaredRole.role] === "function"
        ? identityOverrides[declaredRole.role](referenceId)
        : identityOverrides[declaredRole.role] ?? identityFor(declaredRole.role, referenceId, domain)) });
  }
  const contract = { schema_version: SCHEMA_VERSION_V1, vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1, references: [...referenceById.values()], propositions: [], claims: [],
    relations: [], collections: [], residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: [] };
  for (const pattern of profile.reference_binding_patterns) {
    if (pattern.comparison !== "complete_population") continue;
    const [populationRole, memberRole] = pattern.roles;
    addPopulationClaims(contract, roleIds[populationRole][0], roleIds[memberRole],
      populationRole.replaceAll("_", "-"));
  }
  const dropped = new Set(dropPatternIds);
  const claimIdsByPattern = new Map();
  for (const pattern of profile.claim_patterns) {
    if (dropped.has(pattern.pattern_id)) continue;
    const instances = pattern.for_each
      ? roleIds[pattern.for_each.population_role].map((memberId) => ({
          suffix: `-${memberId.slice(4)}`, local: { [pattern.for_each.member_role]: memberId }
        })) : [{ suffix: "", local: {} }];
    for (const { suffix, local } of instances) {
      const propositionId = `prop-${pattern.pattern_id}${suffix}`;
      contract.propositions.push({ proposition_id: propositionId,
        ...resolveTemplate(pattern.proposition_template, roleIds, numberValues, local),
        ...(propositionOverrides[pattern.pattern_id] ?? {}) });
      const claimId = `claim-${pattern.pattern_id}${suffix}`;
      const claim = { claim_id: claimId, kind: pattern.claim_kind,
        modality: modalityOverrides[pattern.pattern_id] ?? pattern.allowed_modalities[0],
        proposition_id: propositionId };
      if (pattern.claim_kind === "verification") {
        const falsifierId = `prop-falsifier-${pattern.pattern_id}${suffix}`;
        contract.propositions.push({ proposition_id: falsifierId,
          ...resolveTemplate(pattern.falsifying_proposition_template, roleIds, numberValues, local),
          ...(propositionOverrides[`falsifier:${pattern.pattern_id}`] ?? {}) });
        claim.verification_method = verificationMethodOverrides[pattern.pattern_id] ?? verificationMethod;
        claim.falsifying_proposition_id = falsifierId;
      }
      contract.claims.push(claim);
      if (!pattern.for_each) claimIdsByPattern.set(pattern.pattern_id, claimId);
    }
  }
  contract.relations = profile.relation_patterns.flatMap((pattern) => {
    const source_claim_id = claimIdsByPattern.get(pattern.source_claim_pattern_id);
    const target_claim_id = claimIdsByPattern.get(pattern.target_claim_pattern_id);
    return source_claim_id && target_claim_id ? [{ relation_id: `rel-${pattern.pattern_id}`,
      role: pattern.role, source_claim_id, target_claim_id }] : [];
  });
  const input = { input_version: EVALUATION_INPUT_VERSION_V1, evaluation_stage: evaluationStage,
    reference_bindings: profile.reference_roles.map(({ role }) => ({ role, reference_ids: [...roleIds[role]] })),
    number_bindings: profile.number_roles.map(({ role }) => ({ role, value: numberValues[role] })),
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [], stable_evaluation: {} };
  mutateContract?.(contract, { claimIdsByPattern, roleIds, numberValues });
  mutateInput?.(input, { roleIds, numberValues });
  return { contract, input, evaluation_input: input, profile, roleIds, numberValues };
}

const findClaim = (contract, patternId, suffix = "") => contract.claims.find(
  ({ claim_id: id }) => id === `claim-${patternId}${suffix}`);
const findProposition = (contract, patternId, { falsifier = false, suffix = "" } = {}) =>
  contract.propositions.find(({ proposition_id: id }) => id ===
    `${falsifier ? "prop-falsifier-" : "prop-"}${patternId}${suffix}`);

export { VISIBILITY_AFTER_DURABLE_SETTLEMENT_V1_PROFILE,
  buildVisibilityAfterDurableSettlementFixture, findClaim, findProposition, ref };
