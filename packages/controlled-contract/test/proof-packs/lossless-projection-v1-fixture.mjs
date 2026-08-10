import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034
} from "../../lib/native-contract-carrier-v034.mjs";
import { EVALUATION_INPUT_VERSION_V034 } from "../../lib/verification-profile-v034.mjs";

const LOSSLESS_PROJECTION_V1_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.completeness.lossless-projection/1.0.0/profile.json",
  import.meta.url
), "utf8"));

const DEFAULT_ROLE_IDS = Object.freeze({
  tool: ["ref-tool"],
  compact_mode: ["ref-compact-mode"],
  complete_mode: ["ref-complete-mode"],
  mode_population: ["ref-mode-population"],
  tool_modes: ["ref-compact-mode", "ref-complete-mode"],
  compact_result: ["ref-compact-result"],
  complete_result: ["ref-complete-result"],
  source_population: ["ref-source-population"],
  source_members: ["ref-light-member", "ref-heavy-member"],
  compact_population: ["ref-compact-population"],
  compact_members: ["ref-light-member"],
  omission_population: ["ref-omission-population"],
  omitted_members: ["ref-heavy-member"],
  complete_result_population: ["ref-complete-result-population"],
  complete_result_members: ["ref-light-member", "ref-heavy-member"],
  disclosed_population: ["ref-disclosed-population"],
  disclosed_members: ["ref-heavy-member"],
  accounted_population: ["ref-accounted-population"],
  accounted_members: ["ref-light-member", "ref-heavy-member"],
  reason_catalog: ["ref-reason-catalog"],
  allowed_reasons: ["ref-projection-reason", "ref-security-reason"],
  omission_reason: ["ref-projection-reason"],
  heavy_member_class: ["ref-heavy-member-class"],
  disclosure_signal: ["ref-disclosure-signal"],
  total_count_signal: ["ref-total-count-signal"],
  omission_count_signal: ["ref-omission-count-signal"],
  verification: ["ref-verification"],
  unrecoverable_loss_condition: ["ref-condition-unrecoverable-loss"],
  no_compact_omission_condition: ["ref-condition-no-compact-omission"],
  silent_omission_condition: ["ref-condition-silent-omission"],
  unaccounted_source_condition: ["ref-condition-unaccounted-source"],
  incomplete_total_condition: ["ref-condition-incomplete-total"],
  incomplete_omission_count_condition: ["ref-condition-incomplete-omission-count"]
});

const DEFAULT_NUMBER_VALUES = Object.freeze({
  mode_count: 2,
  source_count: 2,
  omission_count: 1
});

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function cloneRoleIds(overrides = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_ROLE_IDS).map(([role, ids]) => [
    role,
    [...(overrides[role] ?? ids)]
  ]));
}

function concreteIdentity(role, referenceId, domain) {
  if (["tool", "compact_mode", "complete_mode", "tool_modes", "verification"].includes(
    role
  )) return {
    kind: "code_symbol",
    repository: `fixture-${domain}`,
    path: `fixtures/${domain}.mjs`,
    symbol: referenceId.slice(4)
  };
  return {
    kind: "durable_id",
    domain: `proof-fixture:${domain}`,
    value: referenceId.slice(4)
  };
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
      if (operand.kind === "number") return [{
        kind: "number",
        value: operand.value_role === undefined
          ? operand.value
          : numberValues[operand.value_role]
      }];
      return [structuredClone(operand)];
    })
  };
}

function addPopulationClaims(contract, populationId, memberIds, suffix) {
  const containsId = `prop-population-${suffix}-contains`;
  const cardinalityId = `prop-population-${suffix}-cardinality`;
  if (memberIds.length > 0) {
    contract.propositions.push({
      proposition_id: containsId,
      subject_reference_id: populationId,
      operator: "reference:contains",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: memberIds.map(ref)
    });
    contract.claims.push({
      claim_id: `claim-population-${suffix}-contains`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: containsId
    });
  }
  contract.propositions.push({
    proposition_id: cardinalityId,
    subject_reference_id: populationId,
    operator: "number:has_cardinality",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "number", value: memberIds.length }]
  });
  contract.claims.push({
    claim_id: `claim-population-${suffix}-cardinality`,
    kind: "evidence",
    modality: "MUST",
    proposition_id: cardinalityId
  });
}

function buildLosslessProjectionFixture({
  profile: suppliedProfile = LOSSLESS_PROJECTION_V1_PROFILE,
  domain = "record-read",
  role_id_overrides: roleIdOverrides = {},
  role_type_overrides: roleTypeOverrides = {},
  identity_overrides: identityOverrides = {},
  number_value_overrides: numberValueOverrides = {},
  verification_method: verificationMethod = "test_execution",
  drop_pattern_ids: dropPatternIds = [],
  proposition_overrides: propositionOverrides = {},
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const roleIds = cloneRoleIds(roleIdOverrides);
  const numberValues = { ...DEFAULT_NUMBER_VALUES, ...numberValueOverrides };
  const referenceById = new Map();
  for (const declaredRole of profile.reference_roles) {
    for (const referenceId of roleIds[declaredRole.role]) {
      if (referenceById.has(referenceId)) continue;
      referenceById.set(referenceId, {
        reference_id: referenceId,
        type_term: roleTypeOverrides[declaredRole.role] ?? declaredRole.allowed_type_terms[0],
        identity: structuredClone(identityOverrides[declaredRole.role] ??
          concreteIdentity(declaredRole.role, referenceId, domain))
      });
    }
  }

  const contract = {
    schema_version: SCHEMA_VERSION_V034,
    vocabulary_version: VOCABULARY_VERSION_V034,
    profile_id: PROFILE_ID_V034,
    references: [...referenceById.values()],
    propositions: [],
    claims: [],
    relations: [],
    collections: [],
    residue: [],
    annotations: []
  };
  const populationSuffixes = new Map([
    ["mode_population", "modes"],
    ["source_population", "source"],
    ["compact_population", "compact"],
    ["omission_population", "omissions"],
    ["complete_result_population", "complete-result"],
    ["disclosed_population", "disclosed"],
    ["accounted_population", "accounted"],
    ["reason_catalog", "reasons"]
  ]);
  for (const pattern of profile.reference_binding_patterns) {
    if (pattern.comparison !== "complete_population") continue;
    const [populationRole, memberRole] = pattern.roles;
    addPopulationClaims(
      contract,
      roleIds[populationRole][0],
      roleIds[memberRole],
      populationSuffixes.get(populationRole) ?? populationRole.replaceAll("_", "-")
    );
  }

  const dropped = new Set(dropPatternIds);
  const overrides = new Map(Object.entries(propositionOverrides));
  const claimIdsByPattern = new Map();
  for (const pattern of profile.claim_patterns) {
    if (dropped.has(pattern.pattern_id)) continue;
    const instances = pattern.for_each
      ? roleIds[pattern.for_each.population_role].map((memberId) => ({
          suffix: `-${memberId.slice(4)}`,
          local: { [pattern.for_each.member_role]: memberId }
        }))
      : [{ suffix: "", local: {} }];
    for (const { suffix, local } of instances) {
      const propositionId = `prop-${pattern.pattern_id}${suffix}`;
      const resolved = resolveTemplate(
        pattern.proposition_template, roleIds, numberValues, local
      );
      contract.propositions.push({
        proposition_id: propositionId,
        ...resolved,
        ...(overrides.get(pattern.pattern_id) ?? {})
      });
      const claimId = `claim-${pattern.pattern_id}${suffix}`;
      const claim = {
        claim_id: claimId,
        kind: pattern.claim_kind,
        modality: pattern.allowed_modalities[0],
        proposition_id: propositionId
      };
      if (pattern.claim_kind === "verification") {
        const falsifierId = `prop-falsifier-${pattern.pattern_id}${suffix}`;
        contract.propositions.push({
          proposition_id: falsifierId,
          ...resolveTemplate(
            pattern.falsifying_proposition_template, roleIds, numberValues, local
          )
        });
        claim.verification_method = verificationMethod;
        claim.falsifying_proposition_id = falsifierId;
      }
      contract.claims.push(claim);
      if (!pattern.for_each) claimIdsByPattern.set(pattern.pattern_id, claimId);
    }
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
    input_version: EVALUATION_INPUT_VERSION_V034,
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role,
      reference_ids: [...roleIds[role]]
    })),
    number_bindings: profile.number_roles.map(({ role }) => ({
      role,
      value: numberValues[role]
    })),
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };

  if (mutateContract) mutateContract(contract, { claimIdsByPattern, roleIds, numberValues });
  if (mutateInput) mutateInput(input, { roleIds, numberValues });
  return { contract, input, profile, roleIds, numberValues };
}

function findClaim(contract, patternId, suffix = "") {
  return contract.claims.find(
    ({ claim_id: claimId }) => claimId === `claim-${patternId}${suffix}`
  );
}

function findProposition(contract, patternId, { falsifier = false, suffix = "" } = {}) {
  const prefix = falsifier ? "prop-falsifier-" : "prop-";
  return contract.propositions.find(
    ({ proposition_id: propositionId }) =>
      propositionId === `${prefix}${patternId}${suffix}`
  );
}

function removePatternClaims(contract, patternIds) {
  const removedIds = new Set(patternIds.flatMap((patternId) => contract.claims
    .filter(({ claim_id: claimId }) => claimId === `claim-${patternId}` ||
      claimId.startsWith(`claim-${patternId}-`))
    .map(({ claim_id: claimId }) => claimId)));
  const removedPropositions = new Set(contract.claims
    .filter(({ claim_id: claimId }) => removedIds.has(claimId))
    .flatMap((claim) => [claim.proposition_id, claim.falsifying_proposition_id]
      .filter(Boolean)));
  contract.claims = contract.claims.filter(({ claim_id: claimId }) => !removedIds.has(claimId));
  contract.propositions = contract.propositions.filter(
    ({ proposition_id: propositionId }) => !removedPropositions.has(propositionId)
  );
  contract.relations = contract.relations.filter(
    ({ source_claim_id: source, target_claim_id: target }) =>
      !removedIds.has(source) && !removedIds.has(target)
  );
}

export {
  DEFAULT_NUMBER_VALUES,
  DEFAULT_ROLE_IDS,
  LOSSLESS_PROJECTION_V1_PROFILE,
  buildLosslessProjectionFixture,
  findClaim,
  findProposition,
  ref,
  removePatternClaims
};
