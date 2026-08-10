import { readFile } from "node:fs/promises";

import {
  PROFILE_ID_V034,
  SCHEMA_VERSION_V034,
  VOCABULARY_VERSION_V034
} from "../../lib/native-contract-carrier-v034.mjs";
import { EVALUATION_INPUT_VERSION_V034 } from "../../lib/verification-profile-v034.mjs";

const IDEMPOTENCY_V2_PROFILE = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.idempotency.effect-nonduplication/2.0.0/profile.json",
  import.meta.url
), "utf8"));

function referenceIdForRole(role) {
  if (role === "second_input") return "ref-first-input";
  return `ref-${role.replaceAll("_", "-")}`;
}

function resolveTemplate(template) {
  return {
    subject_reference_id: referenceIdForRole(template.subject_role),
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.map(
        referenceIdForRole
      )
    },
    operands: template.operands.map((operand) => operand.kind === "reference"
      ? { kind: "reference", reference_id: referenceIdForRole(operand.role) }
      : structuredClone(operand))
  };
}

function buildIdempotencyV2Fixture({
  domain = "payment",
  profile: suppliedProfile = IDEMPOTENCY_V2_PROFILE,
  reference_type_overrides: referenceTypeOverrides = {},
  mutate_contract: mutateContract
} = {}) {
  const profile = structuredClone(suppliedProfile);
  const referenceById = new Map();
  for (const role of profile.reference_roles) {
    const referenceId = referenceIdForRole(role.role);
    if (!referenceById.has(referenceId)) referenceById.set(referenceId, {
      reference_id: referenceId,
      type_term: referenceTypeOverrides[role.role] ?? role.allowed_type_terms[0],
      identity: { kind: "profile_term", term: `${domain}:${referenceId.slice(4)}` }
    });
  }

  const propositions = [];
  const claims = [];
  for (const pattern of profile.claim_patterns) {
    const propositionId = `prop-${pattern.pattern_id}`;
    propositions.push({
      proposition_id: propositionId,
      ...resolveTemplate(pattern.proposition_template)
    });
    const claim = {
      claim_id: `claim-${pattern.pattern_id}`,
      kind: pattern.claim_kind,
      modality: "MUST",
      proposition_id: propositionId
    };
    if (pattern.claim_kind === "verification") {
      const falsifierId = `prop-falsifier-${pattern.pattern_id}`;
      propositions.push({
        proposition_id: falsifierId,
        ...resolveTemplate(pattern.falsifying_proposition_template)
      });
      claim.verification_method = "test_execution";
      claim.falsifying_proposition_id = falsifierId;
    }
    claims.push(claim);
  }

  const contract = {
    schema_version: SCHEMA_VERSION_V034,
    vocabulary_version: VOCABULARY_VERSION_V034,
    profile_id: PROFILE_ID_V034,
    references: [...referenceById.values()],
    propositions,
    claims,
    relations: profile.relation_patterns.map((pattern) => ({
      relation_id: `rel-${pattern.pattern_id}`,
      role: pattern.role,
      source_claim_id: `claim-${pattern.source_claim_pattern_id}`,
      target_claim_id: `claim-${pattern.target_claim_pattern_id}`
    })),
    collections: profile.collection_patterns.map((pattern) => ({
      collection_id: `set-${pattern.pattern_id}`,
      collection_kind: pattern.collection_kind,
      purpose: pattern.collection_purpose,
      member_claim_ids: pattern.member_claim_pattern_ids.map((id) => `claim-${id}`)
    })),
    residue: [],
    annotations: []
  };
  if (mutateContract) mutateContract(contract);

  const input = {
    input_version: EVALUATION_INPUT_VERSION_V034,
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role,
      reference_ids: [referenceIdForRole(role)]
    })),
    number_bindings: [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };
  return { contract, input, profile };
}

export {
  IDEMPOTENCY_V2_PROFILE,
  buildIdempotencyV2Fixture,
  referenceIdForRole
};
