

import { VOCABULARY_DIGESTS } from "@agent-chassis/controlled-contract/vocabulary";
import { PROFILE_SCHEMA_VERSION_V1 } from
  "../../packages/controlled-contract/lib/verification-profile-schema-v1.mjs";
import { SCHEMA_VERSION_V1, VOCABULARY_VERSION_V1 } from
  "../../packages/controlled-contract/lib/native-contract-carrier-v1.mjs";
import { compileGaugeRequirements as compileRequirements } from "./required-policy-assessment.mjs";

const term = (type_term, name) => ({ type_term, identity: { kind: "profile_term", term: name } });
const declare = (referent) => ({ declare: structuredClone(referent) });
const UNCONDITIONAL = Object.freeze({ mode: "unconditional", operand_roles: [] });

export function objectIdentities(name, fields = ["code", "family", "request_index", "phase", "cause"]) {
  return { body: term("cc:artifact", `${name}.error-body`), fields: term("cc:population", `${name}.error-body.fields`),
    check: term("cc:test", `${name}.error-body-check`),
    field: Object.fromEntries(fields.map((field) => [field, term("cc:entity", `${name}.error-body.field.${field}`)])) };
}
export const fieldIdentity = (name, field) => term("cc:entity", `${name}.error-body.field.${field}`);
export const FAILURE_STATE = term("cc:state", "population-fixture.failure");

export const POPULATION_PATTERN_IDS = Object.freeze(["exactly-the-expected-member-count", "field-population-is-complete",
  "object-has-field-population", "object-has-field-population-verification", "object-has-field-population-verifies",
  "population-declares-cardinality"]);

export function fieldPopulationBundle(count) {
  const reference = (role) => ({ kind: "reference", role });
  return {
    schema_version: PROFILE_SCHEMA_VERSION_V1,
    profile_id: `draft.experiment.closed-field-population-${count}`, profile_version: "0.0.1",
    reference_roles: [
      { role: "body", allowed_type_terms: ["cc:artifact"], cardinality: "exactly_one" },
      { role: "fields", allowed_type_terms: ["cc:population"], cardinality: "exactly_one" },
      { role: "check", allowed_type_terms: ["cc:test"], cardinality: "exactly_one" },
      { role: "field_member", allowed_type_terms: ["cc:entity"], cardinality: count === 0 ? "zero_or_more" : "one_or_more" }],
    reference_binding_patterns: [{ pattern_id: "field-population-is-complete", comparison: "complete_population",
      roles: ["fields", "field_member"], applicability_context: UNCONDITIONAL }],
    binding_constraint_patterns: [{ pattern_id: "exactly-the-expected-member-count", role_kind: "reference",
      role: "field_member", minimum: count, maximum: count }],
    claim_patterns: [
      { pattern_id: "object-has-field-population", claim_kind: "behavior", allowed_modalities: ["MUST"],
        proposition_template: { subject_role: "body", operator: "reference:has_property",
          applicability_context: UNCONDITIONAL, operands: [reference("fields")] } },
      { pattern_id: "object-has-field-population-verification", claim_kind: "verification", allowed_modalities: ["MUST"],
        verification_methods: ["analysis", "demonstration", "proof", "test_execution"],
        proposition_template: { subject_role: "check", operator: "reference:covers",
          applicability_context: UNCONDITIONAL, operands: [reference("body")] },
        falsifying_proposition_template: { subject_role: "body", operator: "reference:omits",
          applicability_context: UNCONDITIONAL, operands: [reference("fields")] } },
      { pattern_id: "population-declares-cardinality", claim_kind: "behavior", allowed_modalities: ["MUST"],
        proposition_template: { subject_role: "fields", operator: "number:has_cardinality",
          applicability_context: UNCONDITIONAL, operands: [{ kind: "number", value: count }] } }],
    relation_patterns: [{ pattern_id: "object-has-field-population-verifies", role: "verifies",
      source_claim_pattern_id: "object-has-field-population-verification",
      target_claim_pattern_id: "object-has-field-population" }],
    falsifier_condition_bindings: [{ relation_pattern_id: "object-has-field-population-verifies",
      applicability_context: UNCONDITIONAL }],
    collection_patterns: [], resolver_fact_patterns: [], evidence_patterns: [],
    satisfaction_expression: { all_of: POPULATION_PATTERN_IDS.map((pattern) => ({ pattern })) },
    contract_schema_version: SCHEMA_VERSION_V1, vocabulary_version: VOCABULARY_VERSION_V1,
    vocabulary_signature_digest: VOCABULARY_DIGESTS.signature, vocabulary_algebra_digest: VOCABULARY_DIGESTS.algebra,
    vocabulary_definitions_digest: VOCABULARY_DIGESTS.definitions,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete
  };
}

export const populationBindings = (identities, members = Object.values(identities.field)) =>
  ({ body: identities.body, fields: identities.fields, check: identities.check, field_member: members });

export function populationPolicy({ unit, focus = null, identities, members, count = 5, policyId = "draft.closed-field-population" }) {
  return { schema_version: "required-policy-patterns.experimental.v0", policy_id: policyId,
    status: "draft experimental input; not an accepted decision",
    provenance: { kind: "supplied_draft_fixture", note: "a closed field population stated with existing population patterns" },
    scope: { unit, focus }, profile: fieldPopulationBundle(count),
    bindings: populationBindings(identities, members), obligation_pattern_ids: [] };
}

const scoped = (state) => state === null ? {} : { applies: { mode: "when", context: [declare(state)] } };
const authored = (identities, subject, behavior, fails_when) => ({ nature: "behavior", modality: "MUST",
  subject: declare(subject), behavior,
  verification: { method: "analysis", verifier: declare(identities.check),
    observes: { relation: "reference:covers", objects: [{ referent: declare(identities.body) }] }, fails_when } });
const objects = (members) => members.map((member) => ({ referent: declare(member) }));
export const declarations = {
  association: (identities) => authored(identities, identities.body,
    { relation: "reference:has_property", objects: objects([identities.fields]) },
    { relation: "reference:omits", objects: objects([identities.fields]) }),
  contains: (identities, members, state = null) => authored(identities, identities.fields,
    { relation: "reference:contains", objects: objects(members), ...scoped(state) },
    { relation: "reference:omits", objects: objects(members), ...scoped(state) }),
  memberOf: (identities, member) => authored(identities, member,
    { relation: "reference:member_of", objects: objects([identities.fields]) },
    { relation: "reference:not_member_of", objects: objects([identities.fields]) }),
  cardinality: (identities, count, state = null) => authored(identities, identities.fields,
    { relation: "number:has_cardinality", objects: [{ number: count }], ...scoped(state) },
    { relation: "number:has_cardinality", objects: [{ number: count + 1 }], ...scoped(state) }),
  equal: (identities, left, right) => authored(identities, left,
    { relation: "reference:equals", objects: objects([right]) },
    { relation: "reference:not_equals", objects: objects([right]) })
};
export async function authorDeclarations(requirements, { wkId, focus = null, contract = null }) {
  let content = contract;
  for (const requirement of requirements) {
    content = structuredClone((await compileRequirements([requirement], { wkId, focus, contract: content })).content);
  }
  return content;
}
