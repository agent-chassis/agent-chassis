import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../../lib/native-contract-carrier-v1.mjs";

const PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.operation.forbidden-noninvocation/2.0.0/profile.json",
  import.meta.url
), "utf8"));
const INPUT_TEMPLATE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.operation.forbidden-noninvocation/2.0.0/evaluation-input.template.json",
  import.meta.url
), "utf8"));
const DEFAULT_ROLE_IDS = Object.freeze(Object.fromEntries(INPUT_TEMPLATE.reference_bindings.map(
  ({ role, reference_ids: referenceIds }) => [role, Object.freeze([...referenceIds])]
)));
const DEFAULT_NUMBER_VALUES = Object.freeze(Object.fromEntries(INPUT_TEMPLATE.number_bindings.map(
  ({ role, value }) => [role, value]
)));
const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function identityFor(role, referenceId, domain) {
  if (role === "execution_context") return {
    kind: "profile_term", term: `forbidden-operation-context:${domain}:${referenceId.slice(4)}`
  };
  if (role === "verification") return {
    kind: "repository_path", repository: `fixture-${domain}`,
    path: "tests/forbidden-operation-noninvocation.test.mjs"
  };
  if (["subject_operation", "forbidden_operations"].includes(role)) return {
    kind: "code_symbol", repository: `fixture-${domain}`,
    path: `src/${domain}.mjs`, symbol: referenceId.slice(4).replaceAll("-", "_")
  };
  return {
    kind: "durable_id", domain: `forbidden-operation-noninvocation:${domain}`,
    value: referenceId.slice(4)
  };
}

function resolveTemplate(template, roleIds, numberValues) {
  const idsForRole = (role) => roleIds[role];
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
        value: operand.value_role === undefined ? operand.value : numberValues[operand.value_role]
      }];
      return [structuredClone(operand)];
    })
  };
}

function addCompletePopulation(contract, populationId, memberIds, contextId) {
  contract.propositions.push({
    proposition_id: "prop-forbidden-population-contains",
    subject_reference_id: populationId,
    operator: "reference:contains",
    applicability_context: { mode: "when", operand_reference_ids: [contextId] },
    operands: memberIds.map(ref)
  }, {
    proposition_id: "prop-forbidden-population-cardinality",
    subject_reference_id: populationId,
    operator: "number:has_cardinality",
    applicability_context: { mode: "when", operand_reference_ids: [contextId] },
    operands: [{ kind: "number", value: memberIds.length }]
  });
  contract.claims.push({
    claim_id: "claim-forbidden-population-contains", kind: "evidence", modality: "MUST",
    proposition_id: "prop-forbidden-population-contains"
  }, {
    claim_id: "claim-forbidden-population-cardinality", kind: "evidence", modality: "MUST",
    proposition_id: "prop-forbidden-population-cardinality"
  });
}

function buildForbiddenOperationNoninvocationFixture({
  profile: suppliedProfile = PROFILE,
  domain = "slice-review",
  role_id_overrides: roleIdOverrides = {},
  role_type_overrides: roleTypeOverrides = {},
  identity_overrides: identityOverrides = {},
  number_value_overrides: numberValueOverrides = {},
  verification_method: verificationMethod = "test_execution",
  modality_overrides: modalityOverrides = {},
  proposition_overrides: propositionOverrides = {},
  drop_pattern_ids: dropPatternIds = [],
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const roleIds = Object.fromEntries(Object.entries(DEFAULT_ROLE_IDS).map(([role, ids]) => [
    role, [...(roleIdOverrides[role] ?? ids)]
  ]));
  const numberValues = { ...DEFAULT_NUMBER_VALUES, ...numberValueOverrides };
  const referenceById = new Map();
  for (const declaredRole of profile.reference_roles) {
    for (const referenceId of roleIds[declaredRole.role]) {
      if (referenceById.has(referenceId)) continue;
      const override = identityOverrides[declaredRole.role];
      referenceById.set(referenceId, {
        reference_id: referenceId,
        type_term: roleTypeOverrides[declaredRole.role] ?? declaredRole.allowed_type_terms[0],
        identity: structuredClone(typeof override === "function"
          ? override(referenceId)
          : override ?? identityFor(declaredRole.role, referenceId, domain))
      });
    }
  }
  const contract = {
    schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    profile_id: PROFILE_ID_V1,
    references: [...referenceById.values()],
    propositions: [], claims: [], relations: [], collections: [], residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  addCompletePopulation(
    contract,
    roleIds.forbidden_operation_population[0],
    roleIds.forbidden_operations,
    roleIds.execution_context[0]
  );
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
        ...resolveTemplate(pattern.falsifying_proposition_template, roleIds, numberValues),
        ...(propositionOverrides[`falsifier:${pattern.pattern_id}`] ?? {})
      });
      claim.verification_method = verificationMethod;
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
    input_version: INPUT_TEMPLATE.input_version,
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role, reference_ids: [...roleIds[role]]
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
  ({ claim_id: claimId }) => claimId === `claim-${patternId}`
);
const findProposition = (contract, patternId, { falsifier = false } = {}) =>
  contract.propositions.find(({ proposition_id: propositionId }) => propositionId ===
    `${falsifier ? "prop-falsifier-" : "prop-"}${patternId}`);

export {
  PROFILE as FORBIDDEN_OPERATION_NONINVOCATION_V1_PROFILE,
  buildForbiddenOperationNoninvocationFixture,
  findClaim,
  findProposition,
  ref
};
