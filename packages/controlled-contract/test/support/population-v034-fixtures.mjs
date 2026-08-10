import { VOCABULARY_DIGESTS } from "../../vocabulary/cv.experimental.0.34.mjs";
import {
  EVALUATION_INPUT_VERSION_V034,
  PROFILE_SCHEMA_VERSION_V034
} from "../../lib/verification-profile-v034.mjs";

const unconditional = () => ({ mode: "unconditional", operand_reference_ids: [] });
const templateUnconditional = () => ({ mode: "unconditional", operand_roles: [] });

function reference(referenceId, typeTerm = "cc:resource") {
  return {
    reference_id: referenceId,
    type_term: typeTerm,
    identity: { kind: "profile_term", term: referenceId }
  };
}

function contractBuilder() {
  const contract = {
    schema_version: "controlled-acceptance-contract.experimental.v0.2",
    vocabulary_version: "cv.experimental.0.34",
    profile_id: "acceptance-contract.standard.experimental.v0.2",
    references: [],
    propositions: [],
    claims: [],
    relations: [],
    collections: [],
    residue: [],
    annotations: []
  };
  const referenceIds = new Set();
  const addReference = (referenceId, typeTerm) => {
    if (!referenceIds.has(referenceId)) contract.references.push(
      reference(referenceId, typeTerm)
    );
    referenceIds.add(referenceId);
  };
  const addEvidence = ({ id, subject, operator, operands, context = unconditional() }) => {
    const propositionId = `prop-${id}`;
    contract.propositions.push({
      proposition_id: propositionId,
      subject_reference_id: subject,
      operator,
      applicability_context: structuredClone(context),
      operands: structuredClone(operands)
    });
    contract.claims.push({
      claim_id: `claim-${id}`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: propositionId
    });
  };
  const addPopulation = ({ id, type = "cc:population", members, context = unconditional() }) => {
    addReference(id, type);
    for (const member of members) addReference(member, "cc:resource");
    addEvidence({
      id: `${id.slice(4)}-count`,
      subject: id,
      operator: "number:has_cardinality",
      context,
      operands: [{ kind: "number", value: members.length }]
    });
    if (members.length > 0) addEvidence({
      id: `${id.slice(4)}-members`,
      subject: id,
      operator: "reference:contains",
      context,
      operands: members.map((member) => ({ kind: "reference", reference_id: member }))
    });
  };
  return { contract, addReference, addEvidence, addPopulation };
}

function profileBase(profileId, referenceRoles) {
  return {
    schema_version: PROFILE_SCHEMA_VERSION_V034,
    profile_id: profileId,
    profile_version: "0.0.1",
    contract_schema_version: "controlled-acceptance-contract.experimental.v0.2",
    vocabulary_version: "cv.experimental.0.34",
    vocabulary_signature_digest: VOCABULARY_DIGESTS.signature,
    vocabulary_algebra_digest: VOCABULARY_DIGESTS.algebra,
    vocabulary_definitions_digest: VOCABULARY_DIGESTS.definitions,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    evaluation_stages: ["post_delivery"],
    reference_roles: referenceRoles,
    number_roles: [],
    distinct_reference_role_sets: [],
    reference_binding_patterns: [],
    reference_role_count_bindings: [],
    claim_patterns: [],
    relation_patterns: [],
    collection_patterns: [],
    resolver_fact_patterns: [],
    evidence_patterns: [],
    falsifier_condition_bindings: [{
      relation_pattern_id: "unused-falsifier-binding",
      applicability_context: templateUnconditional()
    }]
  };
}

function evaluationInput(referenceBindings) {
  return {
    input_version: EVALUATION_INPUT_VERSION_V034,
    evaluation_stage: "post_delivery",
    reference_bindings: referenceBindings,
    number_bindings: [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: []
  };
}

function p8Fixture(memberCount, { omitLastClaim = false } = {}) {
  const builder = contractBuilder();
  const members = Array.from({ length: memberCount }, (_, index) => `ref-observable-${index + 1}`);
  builder.addPopulation({ id: "ref-observable-population", members });
  builder.addReference("ref-frozen-baseline", "cc:artifact");
  for (const [index, member] of members.entries()) {
    if (omitLastClaim && index === members.length - 1) continue;
    builder.addEvidence({
      id: `observable-${index + 1}-preserved`,
      subject: member,
      operator: "reference:unchanged_from_frozen_base",
      context: {
        mode: "frozen_base",
        operand_reference_ids: ["ref-frozen-baseline"]
      },
      operands: [{ kind: "reference", reference_id: "ref-frozen-baseline" }]
    });
  }
  const profile = profileBase("prototype.p8.general-behavioral-preservation", [
    { role: "observable_population", allowed_type_terms: ["cc:population"], cardinality: "exactly_one" },
    { role: "observables", allowed_type_terms: ["cc:resource"], cardinality: "one_or_more" },
    { role: "frozen_baseline", allowed_type_terms: ["cc:artifact"], cardinality: "exactly_one" }
  ]);
  profile.reference_binding_patterns.push({
    pattern_id: "complete-observable-population",
    required_by_stage: "post_delivery",
    comparison: "complete_population",
    roles: ["observable_population", "observables"],
    applicability_context: templateUnconditional()
  });
  profile.claim_patterns.push({
    pattern_id: "each-observable-preserved",
    required_by_stage: "post_delivery",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    for_each: { population_role: "observables", member_role: "observable" },
    proposition_template: {
      subject_role: "observable",
      operator: "reference:unchanged_from_frozen_base",
      applicability_context: { mode: "frozen_base", operand_roles: ["frozen_baseline"] },
      operands: [{ kind: "reference", role: "frozen_baseline" }]
    }
  });
  profile.satisfaction_expression = { all_of: [
    { pattern: "complete-observable-population" },
    { pattern: "each-observable-preserved" }
  ] };
  const input = evaluationInput([
    { role: "observable_population", reference_ids: ["ref-observable-population"] },
    { role: "observables", reference_ids: members },
    { role: "frozen_baseline", reference_ids: ["ref-frozen-baseline"] }
  ]);
  return { contract: builder.contract, profile, evaluation_input: input };
}

function p12Fixture(memberCount, { omitLastIdentity = false } = {}) {
  const builder = contractBuilder();
  const members = Array.from({ length: memberCount }, (_, index) => `ref-projection-${index + 1}`);
  builder.addPopulation({ id: "ref-projection-population", members });
  builder.addReference("ref-source-identity", "cc:entity");
  for (const [index, member] of members.entries()) {
    if (!(omitLastIdentity && index === members.length - 1)) builder.addEvidence({
      id: `projection-${index + 1}-identity`,
      subject: member,
      operator: "reference:has_identity",
      operands: [{ kind: "reference", reference_id: "ref-source-identity" }]
    });
    builder.addEvidence({
      id: `projection-${index + 1}-usable`,
      subject: member,
      operator: "boolean:exists",
      operands: [{ kind: "boolean", value: true }]
    });
  }
  const profile = profileBase("prototype.p12.arbitrary-projection-coherence", [
    { role: "projection_population", allowed_type_terms: ["cc:population"], cardinality: "exactly_one" },
    { role: "projections", allowed_type_terms: ["cc:resource"], cardinality: "one_or_more" },
    { role: "source_identity", allowed_type_terms: ["cc:entity"], cardinality: "exactly_one" }
  ]);
  profile.reference_binding_patterns.push({
    pattern_id: "complete-projection-population",
    required_by_stage: "post_delivery",
    comparison: "complete_population",
    roles: ["projection_population", "projections"],
    applicability_context: templateUnconditional()
  });
  profile.claim_patterns.push(
    {
      pattern_id: "each-projection-shares-source",
      required_by_stage: "post_delivery",
      claim_kind: "evidence",
      allowed_modalities: ["MUST"],
      for_each: { population_role: "projections", member_role: "projection" },
      proposition_template: {
        subject_role: "projection",
        operator: "reference:has_identity",
        applicability_context: templateUnconditional(),
        operands: [{ kind: "reference", role: "source_identity" }]
      }
    },
    {
      pattern_id: "each-projection-usable",
      required_by_stage: "post_delivery",
      claim_kind: "evidence",
      allowed_modalities: ["MUST"],
      for_each: { population_role: "projections", member_role: "projection" },
      proposition_template: {
        subject_role: "projection",
        operator: "boolean:exists",
        applicability_context: templateUnconditional(),
        operands: [{ kind: "boolean", value: true }]
      }
    }
  );
  profile.satisfaction_expression = { all_of: [
    { pattern: "complete-projection-population" },
    { pattern: "each-projection-shares-source" },
    { pattern: "each-projection-usable" }
  ] };
  return {
    contract: builder.contract,
    profile,
    evaluation_input: evaluationInput([
      { role: "projection_population", reference_ids: ["ref-projection-population"] },
      { role: "projections", reference_ids: members },
      { role: "source_identity", reference_ids: ["ref-source-identity"] }
    ])
  };
}

function p13Fixture({ observedMembers, authorizedMembers, operator = "reference:subset_of" }) {
  const builder = contractBuilder();
  builder.addPopulation({ id: "ref-observed-population", members: observedMembers });
  builder.addPopulation({ id: "ref-authorized-population", type: "cc:scope", members: authorizedMembers });
  builder.addEvidence({
    id: "observed-within-authorized",
    subject: "ref-observed-population",
    operator,
    operands: [{ kind: "reference", reference_id: "ref-authorized-population" }]
  });
  const profile = profileBase("prototype.p13.write-scope-confinement", [
    { role: "observed_population", allowed_type_terms: ["cc:population"], cardinality: "exactly_one" },
    { role: "observed_members", allowed_type_terms: ["cc:resource"], cardinality: "zero_or_more" },
    { role: "authorized_population", allowed_type_terms: ["cc:scope"], cardinality: "exactly_one" },
    { role: "authorized_members", allowed_type_terms: ["cc:resource"], cardinality: "zero_or_more" }
  ]);
  profile.distinct_reference_role_sets.push({ roles: [
    "observed_population", "authorized_population"
  ] });
  profile.reference_binding_patterns.push(
    {
      pattern_id: "complete-observed-population",
      required_by_stage: "post_delivery",
      comparison: "complete_population",
      roles: ["observed_population", "observed_members"],
      applicability_context: templateUnconditional()
    },
    {
      pattern_id: "complete-authorized-population",
      required_by_stage: "post_delivery",
      comparison: "complete_population",
      roles: ["authorized_population", "authorized_members"],
      applicability_context: templateUnconditional()
    }
  );
  profile.claim_patterns.push({
    pattern_id: "observed-subset-authorized",
    required_by_stage: "post_delivery",
    claim_kind: "evidence",
    allowed_modalities: ["MUST"],
    proposition_template: {
      subject_role: "observed_population",
      operator: "reference:subset_of",
      applicability_context: templateUnconditional(),
      operands: [{ kind: "reference", role: "authorized_population" }]
    }
  });
  profile.satisfaction_expression = { all_of: [
    { pattern: "complete-observed-population" },
    { pattern: "complete-authorized-population" },
    { pattern: "observed-subset-authorized" }
  ] };
  return {
    contract: builder.contract,
    profile,
    evaluation_input: evaluationInput([
      { role: "observed_population", reference_ids: ["ref-observed-population"] },
      { role: "observed_members", reference_ids: observedMembers },
      { role: "authorized_population", reference_ids: ["ref-authorized-population"] },
      { role: "authorized_members", reference_ids: authorizedMembers }
    ])
  };
}

export { contractBuilder, evaluationInput, p8Fixture, p12Fixture, p13Fixture, profileBase };
