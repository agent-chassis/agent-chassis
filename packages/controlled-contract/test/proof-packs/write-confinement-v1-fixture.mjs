import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../../lib/native-contract-carrier-v1.mjs";
import { EVALUATION_INPUT_VERSION_V1 } from "../support/stable-v1-proof-pack-runtime.mjs";

const WRITE_CONFINEMENT_V1_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.scope.write-confinement/2.0.0/profile.json",
  import.meta.url
), "utf8"));

const DEFAULT_ROLE_IDS = Object.freeze({
  execution: Object.freeze(["ref-execution"]),
  observed_population: Object.freeze(["ref-observed-population"]),
  observed_mutations: Object.freeze(["ref-target-a"]),
  authorized_scope: Object.freeze(["ref-authorized-scope"]),
  authorized_targets: Object.freeze(["ref-target-a", "ref-target-b"]),
  verification: Object.freeze(["ref-verification"]),
  unauthorized_mutation_condition: Object.freeze(["ref-unauthorized-mutation-condition"])
});

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function identityFor(role, referenceId, domain) {
  if (role === "verification") return {
    kind: "code_symbol",
    repository: `fixture-${domain}`,
    path: "tests/write-confinement.test.mjs",
    symbol: "writeConfinement"
  };
  if (role === "unauthorized_mutation_condition") return {
    kind: "profile_term",
    term: "unauthorized-mutation-observed"
  };
  return {
    kind: "durable_id",
    domain: `write-confinement:${domain}`,
    value: referenceId.slice(4)
  };
}

function resolveTemplate(template, roleIds) {
  return {
    subject_reference_id: roleIds[template.subject_role][0],
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(
        (role) => roleIds[role]
      )
    },
    operands: template.operands.flatMap((operand) => operand.kind === "reference"
      ? roleIds[operand.role].map(ref)
      : [structuredClone(operand)])
  };
}

function addPopulationClaims(contract, populationId, members, suffix, count) {
  contract.propositions.push({
    proposition_id: `prop-${suffix}-count`,
    subject_reference_id: populationId,
    operator: "number:has_cardinality",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "number", value: count }]
  });
  contract.claims.push({
    claim_id: `claim-${suffix}-count`,
    kind: "evidence",
    modality: "MUST",
    proposition_id: `prop-${suffix}-count`
  });
  if (members.length === 0) return;
  contract.propositions.push({
    proposition_id: `prop-${suffix}-members`,
    subject_reference_id: populationId,
    operator: "reference:contains",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: members.map(ref)
  });
  contract.claims.push({
    claim_id: `claim-${suffix}-members`,
    kind: "evidence",
    modality: "MUST",
    proposition_id: `prop-${suffix}-members`
  });
}

function buildWriteConfinementFixture({
  profile: suppliedProfile = WRITE_CONFINEMENT_V1_PROFILE,
  domain = "filesystem",
  observed = DEFAULT_ROLE_IDS.observed_mutations,
  authorized = DEFAULT_ROLE_IDS.authorized_targets,
  observed_count: observedCount = observed.length,
  authorized_count: authorizedCount = authorized.length,
  role_id_overrides: roleIdOverrides = {},
  role_type_overrides: roleTypeOverrides = {},
  identity_overrides: identityOverrides = {},
  proposition_overrides: propositionOverrides = {},
  modality_overrides: modalityOverrides = {},
  verification_method: verificationMethod = "test_execution",
  evaluation_stage: evaluationStage = "pre_dispatch",
  drop_pattern_ids: dropPatternIds = [],
  mutate_contract: mutateContract,
  mutate_input: mutateInput
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const roleIds = Object.fromEntries(Object.entries(DEFAULT_ROLE_IDS).map(([role, ids]) => [
    role,
    [...(roleIdOverrides[role] ?? (role === "observed_mutations"
      ? observed
      : role === "authorized_targets" ? authorized : ids))]
  ]));
  const referenceById = new Map();
  for (const declaredRole of profile.reference_roles) {
    for (const referenceId of roleIds[declaredRole.role]) {
      if (referenceById.has(referenceId)) continue;
      referenceById.set(referenceId, {
        reference_id: referenceId,
        type_term: roleTypeOverrides[declaredRole.role] ?? declaredRole.allowed_type_terms[0],
        identity: structuredClone(
          typeof identityOverrides[declaredRole.role] === "function"
            ? identityOverrides[declaredRole.role](referenceId)
            : identityOverrides[declaredRole.role] ??
              identityFor(declaredRole.role, referenceId, domain)
        )
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
  addPopulationClaims(
    contract,
    roleIds.observed_population[0],
    roleIds.observed_mutations,
    "observed-population",
    observedCount
  );
  addPopulationClaims(
    contract,
    roleIds.authorized_scope[0],
    roleIds.authorized_targets,
    "authorized-scope",
    authorizedCount
  );

  const dropped = new Set(dropPatternIds);
  const claimIds = new Map();
  for (const pattern of profile.claim_patterns) {
    if (dropped.has(pattern.pattern_id)) continue;
    const propositionId = `prop-${pattern.pattern_id}`;
    contract.propositions.push({
      proposition_id: propositionId,
      ...resolveTemplate(pattern.proposition_template, roleIds),
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
        ...resolveTemplate(pattern.falsifying_proposition_template, roleIds),
        ...(propositionOverrides[`falsifier:${pattern.pattern_id}`] ?? {})
      });
      claim.verification_method = verificationMethod;
      claim.falsifying_proposition_id = falsifierId;
    }
    contract.claims.push(claim);
    claimIds.set(pattern.pattern_id, claimId);
  }
  for (const pattern of profile.relation_patterns) {
    const source = claimIds.get(pattern.source_claim_pattern_id);
    const target = claimIds.get(pattern.target_claim_pattern_id);
    if (!source || !target) continue;
    contract.relations.push({
      relation_id: `rel-${pattern.pattern_id}`,
      role: pattern.role,
      source_claim_id: source,
      target_claim_id: target
    });
  }
  const input = {
    input_version: EVALUATION_INPUT_VERSION_V1,
    evaluation_stage: evaluationStage,
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role,
      reference_ids: [...roleIds[role]]
    })),
    number_bindings: [],
    claim_pattern_bindings: [...claimIds].map(([patternId, claimId]) => ({
      pattern_id: patternId,
      claim_id: claimId
    })),
    resolver_facts: [],
    delivered_evidence: [], stable_evaluation: {}
  };
  mutateContract?.(contract);
  mutateInput?.(input);
  return { contract, input, evaluation_input: input, profile, roleIds };
}

function findClaim(contract, patternId) {
  return contract.claims.find(({ claim_id: claimId }) => claimId === `claim-${patternId}`);
}

function findProposition(contract, patternId, { falsifier = false } = {}) {
  const claim = findClaim(contract, patternId);
  const propositionId = falsifier ? claim?.falsifying_proposition_id : claim?.proposition_id;
  return contract.propositions.find(({ proposition_id: id }) => id === propositionId);
}

export {
  WRITE_CONFINEMENT_V1_PROFILE,
  buildWriteConfinementFixture,
  findClaim,
  findProposition,
  ref
};
