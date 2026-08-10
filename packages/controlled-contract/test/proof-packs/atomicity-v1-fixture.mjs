import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034
} from "../../lib/native-contract-carrier-v034.mjs";
import {
  EVALUATION_INPUT_VERSION_V034
} from "../../lib/verification-profile-v034.mjs";

const ATOMICITY_V1_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.atomicity.failure-boundary/1.0.0/profile.json",
  import.meta.url
), "utf8"));

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function referenceIdForRole(role) {
  return `ref-${role.replaceAll("_", "-")}`;
}

function resolveTemplate(
  template,
  referenceForRole = referenceIdForRole,
  referenceIdsForRole = (role) => [referenceForRole(role)]
) {
  return {
    subject_reference_id: referenceForRole(template.subject_role),
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(
        referenceIdsForRole
      )
    },
    operands: template.operands.flatMap((operand) => operand.kind === "reference"
      ? referenceIdsForRole(operand.role).map(ref)
      : operand.kind === "number" && operand.value_role !== undefined
        ? [{ kind: "number", value: template.__number_values[operand.value_role] }]
        : [structuredClone(operand)])
  };
}

function settlementOutcome(states) {
  if (states.some((state) => state !== "committed" && state !== "absent")) {
    return "unknown_settled_state";
  }
  if (states.every((state) => state === "committed")) return "all_committed";
  if (states.every((state) => state === "absent")) return "none_committed";
  return "partial_commit";
}

const DEFAULT_RUN = Object.freeze({
  effect_count: 2,
  boundary_position: "between",
  failure_injected: true,
  settlement_follows_failure: true,
  settlement_committed: [false, false],
  observation_committed: null,
  settlement_states: null,
  observation_states: null
});

function statesFromCommitted(committed) {
  return committed.map((value) => (value ? "committed" : "absent"));
}

function normalizeRun(run = {}) {
  const merged = { ...DEFAULT_RUN, ...run };
  const settlementStates = merged.settlement_states ??
    statesFromCommitted(merged.settlement_committed);
  const observationStates = merged.observation_states ??
    (merged.observation_committed
      ? statesFromCommitted(merged.observation_committed)
      : settlementStates);
  return {
    ...merged,
    effect_count: settlementStates.length,
    settlement_states: [...settlementStates],
    observation_states: [...observationStates],
    outcome: settlementOutcome(settlementStates)
  };
}

function buildAtomicityFixture({
  profile: suppliedProfile = ATOMICITY_V1_PROFILE,
  domain = "ledger",
  run: suppliedRun,
  reference_type_overrides: referenceTypeOverrides = {},
  reference_id_overrides: referenceIdOverrides = {},
  ordered_sequence_extra_claim_ids: orderedSequenceExtras = [],
  verification_method: verificationMethod = "test_execution",
  number_binding_override: numberBindingOverride = null,
  extra_drop_pattern_ids: extraDropPatternIds = [],
  extra_proposition_overrides: extraPropositionOverrides = {},
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const run = normalizeRun(suppliedRun);
  const settledResultReferenceId = run.outcome === "all_committed"
    ? referenceIdForRole("fully_committed_state")
    : run.outcome === "none_committed"
      ? referenceIdForRole("fully_uncommitted_state")
      : referenceIdForRole("settled_result");
  const referenceForRole = (role) => referenceIdOverrides[role] ??
    (role === "settled_result" ? settledResultReferenceId : referenceIdForRole(role));
  const declaredRoles = new Set(profile.reference_roles.map(({ role }) => role));

  const stateTerm = {
    all_committed: "fully-committed",
    none_committed: "fully-uncommitted",
    partial_commit: "partial-commit",
    unknown_settled_state: "unknown-settled-state"
  }[run.outcome];

  const identityTermForRole = {
    earlier_effect_settled_state: `effect-1-settled-${run.settlement_states[0]}`,
    later_effect_settled_state: `effect-2-settled-${run.settlement_states[1]}`,
    settled_result: `population-settled-${stateTerm}`
  };

  const referenceById = new Map();
  for (const role of profile.reference_roles) {
    if (role.role === "constituent_effects") continue;
    const referenceId = referenceForRole(role.role);
    if (referenceById.has(referenceId)) continue;
    referenceById.set(referenceId, {
      reference_id: referenceId,
      type_term: referenceTypeOverrides[role.role] ?? role.allowed_type_terms[0],
      identity: {
        kind: "profile_term",
        term: `${domain}:${identityTermForRole[role.role] ?? referenceId.slice(4)}`
      }
    });
  }

  const extraEffectIndexes = [];
  for (let index = 2; index < run.effect_count; index += 1) {
    extraEffectIndexes.push(index);
    referenceById.set(`ref-constituent-effect-${index + 1}`, {
      reference_id: `ref-constituent-effect-${index + 1}`,
      type_term: referenceTypeOverrides.earlier_constituent_effect ?? "cc:artifact",
      identity: { kind: "profile_term", term: `${domain}:constituent-effect-${index + 1}` }
    });
    referenceById.set(`ref-constituent-effect-${index + 1}-settled-state`, {
      reference_id: `ref-constituent-effect-${index + 1}-settled-state`,
      type_term: "cc:state",
      identity: {
        kind: "profile_term",
        term: `${domain}:effect-${index + 1}-settled-${run.settlement_states[index]}`
      }
    });
  }
  const allEffectIds = [
    referenceForRole("earlier_constituent_effect"),
    referenceForRole("later_constituent_effect"),
    ...extraEffectIndexes.map((index) => `ref-constituent-effect-${index + 1}`)
  ];
  const referenceIdsForRole = (role) => role === "constituent_effects"
    ? allEffectIds
    : [referenceForRole(role)];

  const observedStateReferenceId = ["earlier", "later"].map((position, index) => {
    if (run.observation_states[index] === run.settlement_states[index]) return null;
    const referenceId = `ref-${position}-effect-observed-state`;
    referenceById.set(referenceId, {
      reference_id: referenceId,
      type_term: "cc:state",
      identity: {
        kind: "profile_term",
        term: `${domain}:effect-${index + 1}-observed-${run.observation_states[index]}`
      }
    });
    return referenceId;
  });

  const droppedPatternIds = new Set(extraDropPatternIds);
  const propositionOverrides = new Map(Object.entries(extraPropositionOverrides));

  if (run.outcome === "all_committed") {
    droppedPatternIds.add("settled-outcome-is-fully-uncommitted");
  } else if (run.outcome === "none_committed") {
    droppedPatternIds.add("settled-outcome-is-fully-committed");
  } else {
    droppedPatternIds.add("settled-outcome-is-fully-committed");
    droppedPatternIds.add("settled-outcome-is-fully-uncommitted");

    propositionOverrides.set("settled-outcome-within-allowed-states", {
      operator: "reference:not_member_of"
    });
  }
  if (run.boundary_position === "before_earlier") {
    propositionOverrides.set("failure-boundary-follows-earlier-effect", {
      operator: "reference:precedes"
    });
  }
  if (run.boundary_position === "after_later") {
    propositionOverrides.set("failure-boundary-precedes-later-effect", {
      operator: "reference:follows"
    });
  }
  if (!run.failure_injected) {
    droppedPatternIds.add("failure-injected-at-boundary");
    droppedPatternIds.add("settlement-follows-injected-failure");
  } else if (!run.settlement_follows_failure) {
    propositionOverrides.set("settlement-follows-injected-failure", {
      operator: "reference:precedes"
    });
  }
  for (const [index, position] of ["earlier", "later"].entries()) {
    if (observedStateReferenceId[index] === null) continue;
    propositionOverrides.set(`${position}-effect-observation-record`, {
      operands: [ref(observedStateReferenceId[index])]
    });
  }

  const numberValues = {
    constituent_effect_count: numberBindingOverride ?? run.effect_count
  };

  const propositions = [];
  const claims = [];
  const claimIdByPattern = new Map();
  for (const pattern of profile.claim_patterns) {
    if (droppedPatternIds.has(pattern.pattern_id)) continue;
    const propositionId = `prop-${pattern.pattern_id}`;
    const template = { ...pattern.proposition_template, __number_values: numberValues };
    propositions.push({
      proposition_id: propositionId,
      ...resolveTemplate(template, referenceForRole, referenceIdsForRole),
      ...(propositionOverrides.get(pattern.pattern_id) ?? {})
    });
    const claim = {
      claim_id: `claim-${pattern.pattern_id}`,
      kind: pattern.claim_kind,
      modality: pattern.allowed_modalities[0],
      proposition_id: propositionId
    };
    if (pattern.claim_kind === "verification") {
      const falsifierId = `prop-falsifier-${pattern.pattern_id}`;
      propositions.push({
        proposition_id: falsifierId,
        ...resolveTemplate(
          { ...pattern.falsifying_proposition_template, __number_values: numberValues },
          referenceForRole,
          referenceIdsForRole
        )
      });
      claim.verification_method = verificationMethod;
      claim.falsifying_proposition_id = falsifierId;
    }
    claims.push(claim);
    claimIdByPattern.set(pattern.pattern_id, claim.claim_id);
  }

  if (run.outcome === "partial_commit" && declaredRoles.has("forbidden_partial_state")) {
    propositions.push({
      proposition_id: "prop-settled-outcome-is-partial",
      subject_reference_id: referenceForRole("settled_result"),
      operator: "reference:equals",
      applicability_context: {
        mode: "after",
        operand_reference_ids: [referenceForRole("settlement_event")]
      },
      operands: [ref(referenceForRole("forbidden_partial_state"))]
    });
    claims.push({
      claim_id: "claim-settled-outcome-is-partial",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-settled-outcome-is-partial"
    });
  }

  if (extraEffectIndexes.length > 0) {
    const allStateIds = [
      referenceForRole("earlier_effect_settled_state"),
      referenceForRole("later_effect_settled_state"),
      ...extraEffectIndexes.map((index) => `ref-constituent-effect-${index + 1}-settled-state`)
    ];
    propositions.push({
      proposition_id: "prop-settled-result-full-composition",
      subject_reference_id: referenceForRole("settled_result"),
      operator: "reference:contains",
      applicability_context: {
        mode: "when",
        operand_reference_ids: [referenceForRole("settlement_event")]
      },
      operands: allStateIds.map(ref)
    });
    claims.push({
      claim_id: "claim-settled-result-full-composition",
      kind: "evidence",
      modality: "MUST",
      proposition_id: "prop-settled-result-full-composition"
    });
    for (const index of extraEffectIndexes) {
      const effectId = `ref-constituent-effect-${index + 1}`;
      propositions.push({
        proposition_id: `prop-constituent-effect-${index + 1}-membership`,
        subject_reference_id: effectId,
        operator: "reference:member_of",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [ref(referenceForRole("constituent_effect_population"))]
      });
      claims.push({
        claim_id: `claim-constituent-effect-${index + 1}-membership`,
        kind: "evidence",
        modality: "MUST",
        proposition_id: `prop-constituent-effect-${index + 1}-membership`
      });
      propositions.push({
        proposition_id: `prop-constituent-effect-${index + 1}-settled-state`,
        subject_reference_id: effectId,
        operator: "reference:has_state",
        applicability_context: {
          mode: "when",
          operand_reference_ids: [referenceForRole("settlement_event")]
        },
        operands: [ref(`ref-constituent-effect-${index + 1}-settled-state`)]
      });
      claims.push({
        claim_id: `claim-constituent-effect-${index + 1}-settled-state`,
        kind: "evidence",
        modality: "MUST",
        proposition_id: `prop-constituent-effect-${index + 1}-settled-state`
      });
    }
  }

  const relations = profile.relation_patterns
    .filter(({ source_claim_pattern_id: source, target_claim_pattern_id: target }) =>
      claimIdByPattern.has(source) && claimIdByPattern.has(target)
    )
    .map((pattern) => ({
      relation_id: `rel-${pattern.pattern_id}`,
      role: pattern.role,
      source_claim_id: claimIdByPattern.get(pattern.source_claim_pattern_id),
      target_claim_id: claimIdByPattern.get(pattern.target_claim_pattern_id)
    }));

  const collections = profile.collection_patterns.map((pattern) => {
    const memberClaimIds = pattern.member_claim_pattern_ids
      .filter((patternId) => claimIdByPattern.has(patternId))
      .map((patternId) => claimIdByPattern.get(patternId));
    if (pattern.collection_kind === "ordered_sequence") {
      memberClaimIds.push(...orderedSequenceExtras);
    }
    return {
      collection_id: `set-${pattern.pattern_id}`,
      collection_kind: pattern.collection_kind,
      purpose: pattern.collection_purpose,
      member_claim_ids: memberClaimIds
    };
  }).filter(({ member_claim_ids: members }) => members.length > 0);

  const contract = {
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
  if (mutateContract) mutateContract(contract, { claimIdByPattern, referenceForRole, run });

  const input = {
    input_version: EVALUATION_INPUT_VERSION_V034,
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role,
      reference_ids: referenceIdsForRole(role)
    })),
    number_bindings: [
      {
        role: "constituent_effect_count",
        value: numberBindingOverride ?? run.effect_count
      }
    ],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };
  if (mutateInput) mutateInput(input, { referenceForRole, run });

  return { contract, input, profile, run };
}

export {
  ATOMICITY_V1_PROFILE,
  buildAtomicityFixture,
  ref,
  referenceIdForRole,
  settlementOutcome
};
