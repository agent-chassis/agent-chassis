import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../../lib/native-contract-carrier-v1.mjs";
import { EVALUATION_INPUT_VERSION_V1 } from "../support/stable-v1-proof-pack-runtime.mjs";

const RESULT_SHAPE_CONFORMANCE_V1_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.result-shape.conformance/2.0.0/profile.json",
  import.meta.url
), "utf8"));

const REQUIRED_MEMBERS = Object.freeze([
  "ref-member-id-string",
  "ref-member-total-number"
]);
const OPTIONAL_MEMBERS = Object.freeze(["ref-member-note-string"]);
const FORBIDDEN_MEMBERS = Object.freeze([
  "ref-member-password-string",
  "ref-member-total-string"
]);

const DEFAULT_ROLE_IDS = Object.freeze({
  operation: ["ref-operation"],
  result: ["ref-result"],
  schema: ["ref-schema"],
  result_population: ["ref-result-population"],
  result_members: [...REQUIRED_MEMBERS, ...OPTIONAL_MEMBERS],
  required_population: ["ref-required-population"],
  required_members: [...REQUIRED_MEMBERS],
  optional_population: ["ref-optional-population"],
  optional_members: [...OPTIONAL_MEMBERS],
  allowed_population: ["ref-allowed-population"],
  allowed_members: [...REQUIRED_MEMBERS, ...OPTIONAL_MEMBERS],
  forbidden_member_population: ["ref-forbidden-member-population"],
  forbidden_members: [...FORBIDDEN_MEMBERS],
  allowed_shape_population: ["ref-allowed-shape-population"],
  allowed_shapes: ["ref-shape-object"],
  forbidden_shape_population: ["ref-forbidden-shape-population"],
  forbidden_shapes: ["ref-shape-array", "ref-shape-scalar"],
  result_shape: ["ref-shape-object"],
  result_count_signal: ["ref-result-count-signal"],
  verification: ["ref-verification"],
  missing_required_condition: ["ref-condition-missing-required"],
  unexpected_member_condition: ["ref-condition-unexpected-member"],
  disallowed_shape_condition: ["ref-condition-disallowed-shape"],
  forbidden_shape_condition: ["ref-condition-forbidden-shape"],
  incorrect_count_condition: ["ref-condition-incorrect-count"]
});

const DEFAULT_NUMBER_VALUES = Object.freeze({
  result_count: 3,
  required_count: 2,
  optional_count: 1,
  allowed_count: 3,
  forbidden_member_count: 2,
  allowed_shape_count: 1,
  forbidden_shape_count: 2
});

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function cloneRoleIds(overrides = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_ROLE_IDS).map(([role, ids]) => [
    role,
    [...(overrides[role] ?? ids)]
  ]));
}

function concreteIdentity(role, referenceId, domain) {
  if (["operation", "result", "schema", "verification"].includes(role)) return {
    kind: "code_symbol",
    repository: `fixture-${domain}`,
    path: `fixtures/${domain}.mjs`,
    symbol: referenceId.slice(4)
  };
  if (role.endsWith("_condition")) return {
    kind: "profile_term",
    term: `result-shape:${referenceId.slice(4)}`
  };
  return {
    kind: "durable_id",
    domain: `result-shape-fixture:${domain}`,
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
      operand_reference_ids:
        template.applicability_context.operand_roles.flatMap(idsForRole)
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
  if (memberIds.length > 0) {
    contract.propositions.push({
      proposition_id: `prop-population-${suffix}-contains`,
      subject_reference_id: populationId,
      operator: "reference:contains",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: memberIds.map(ref)
    });
    contract.claims.push({
      claim_id: `claim-population-${suffix}-contains`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: `prop-population-${suffix}-contains`
    });
  }
  contract.propositions.push({
    proposition_id: `prop-population-${suffix}-cardinality`,
    subject_reference_id: populationId,
    operator: "number:has_cardinality",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "number", value: memberIds.length }]
  });
  contract.claims.push({
    claim_id: `claim-population-${suffix}-cardinality`,
    kind: "evidence",
    modality: "MUST",
    proposition_id: `prop-population-${suffix}-cardinality`
  });
}

function buildResultShapeConformanceFixture({
  profile: suppliedProfile = RESULT_SHAPE_CONFORMANCE_V1_PROFILE,
  domain = "record",
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
        type_term:
          roleTypeOverrides[declaredRole.role] ?? declaredRole.allowed_type_terms[0],
        identity: structuredClone(identityOverrides[declaredRole.role] ??
          concreteIdentity(declaredRole.role, referenceId, domain))
      });
    }
  }

  const contract = {
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    references: [...referenceById.values()],
    propositions: [],
    claims: [],
    relations: [],
    collections: [],
    residue: [],
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
      contract.propositions.push({
        proposition_id: propositionId,
        ...resolveTemplate(pattern.proposition_template, roleIds, numberValues, local),
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
            pattern.falsifying_proposition_template,
            roleIds,
            numberValues,
            local
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
    input_version: EVALUATION_INPUT_VERSION_V1,
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
    delivered_evidence: [], stable_evaluation: {}
  };
  if (mutateContract) {
    mutateContract(contract, { claimIdsByPattern, roleIds, numberValues });
  }
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
    .flatMap((item) => [
      item.proposition_id,
      item.falsifying_proposition_id
    ].filter(Boolean)));
  contract.claims = contract.claims.filter(
    ({ claim_id: claimId }) => !removedIds.has(claimId)
  );
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
  RESULT_SHAPE_CONFORMANCE_V1_PROFILE,
  buildResultShapeConformanceFixture,
  findClaim,
  findProposition,
  ref,
  removePatternClaims
};
