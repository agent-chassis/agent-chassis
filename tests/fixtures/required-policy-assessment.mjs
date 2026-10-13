

import { VOCABULARY_DIGESTS } from "@agent-chassis/controlled-contract/vocabulary";
import { PROFILE_SCHEMA_VERSION_V1 } from
  "../../packages/controlled-contract/lib/verification-profile-schema-v1.mjs";
import { SCHEMA_VERSION_V1, VOCABULARY_VERSION_V1 } from
  "../../packages/controlled-contract/lib/native-contract-carrier-v1.mjs";

const identity = (type_term, term) => ({ type_term, identity: { kind: "profile_term", term } });
const declare = (referent) => ({ declare: structuredClone(referent) });

export const GAUGE_REFERENTS = Object.freeze({
  operation: identity("cc:operation", "gauge.set-level"),
  level: identity("cc:entity", "gauge.level-input"),
  inside_range: identity("cc:population", "gauge.level-inside-declared-range"),
  outside_range: identity("cc:population", "gauge.level-outside-declared-range"),
  accepted_effect: identity("cc:state", "gauge.stored-level"),
  refusal_result: identity("cc:artifact", "gauge.range-error"),
  accepted_check: identity("cc:test", "gauge.accepted-level-check"),
  refusal_check: identity("cc:test", "gauge.out-of-range-level-check"),
  range_check: identity("cc:test", "gauge.range-declaration-check")
});
const R = GAUGE_REFERENTS;

export const when = (relation, object, context) => ({ relation, objects: [{ referent: declare(object) }],
  applies: { mode: "when", context: [declare(context)] } });
const covers = (object) => ({ relation: "reference:covers", objects: [{ referent: declare(object) }] });
export const verification = (verifier, observed, fails_when) => ({ method: "analysis",
  verifier: declare(verifier), observes: covers(observed), fails_when });

export function constrainedInputRequirements(referents) {
  const I = referents;
  return {
    declaration: { nature: "behavior", modality: "MUST", subject: declare(I.level),
      behavior: { relation: "range:has_range", objects: [{ range: { minimum: 0, maximum: 100 } }] },
      verification: verification(I.range_check, I.level,
        { relation: "range:has_range", objects: [{ range: { minimum: 101 } }] }) },
    accepted: { nature: "behavior", modality: "MUST", subject: declare(I.operation),
      behavior: when("reference:writes", I.accepted_effect, I.inside_range),
      verification: verification(I.accepted_check, I.operation,
        when("reference:returns", I.refusal_result, I.inside_range)) },
    rejected: { nature: "behavior", modality: "MUST", subject: declare(I.operation),
      behavior: when("reference:returns", I.refusal_result, I.outside_range),
      verification: verification(I.refusal_check, I.operation,
        when("reference:writes", I.accepted_effect, I.outside_range)) }
  };
}
export const GAUGE_REQUIREMENTS = Object.freeze(constrainedInputRequirements(R));

export const differentRejectedVerification = (referents, verifierTerm) => verification(
  identity("cc:test", verifierTerm), referents.operation,
  { relation: "reference:rejects", objects: [{ referent: declare(referents.level) }] });
export const DIFFERENT_REJECTED_VERIFICATION = differentRejectedVerification(R, "gauge.unrelated-level-check");

const readOperation = identity("cc:operation", "gauge.read-level");
const SIBLING_CHECK = identity("cc:test", "gauge.read-level-check");
export const SIBLING_REQUIREMENT = Object.freeze({ nature: "behavior", modality: "MUST",
  subject: declare(readOperation),
  behavior: { relation: "reference:returns", objects: [{ referent: declare(R.accepted_effect) }] },
  verification: verification(SIBLING_CHECK, readOperation,
    { relation: "reference:returns", objects: [{ referent: declare(R.refusal_result) }] }) });

const termOf = (referent) => referent.identity.term;
const whenRow = (relation, object, context) => ({ relation, objects: [{ referent: termOf(object) }],
  applies: { mode: "when", context: [termOf(context)] } });
const rowVerification = (verifier, observed, fails_when) => ({ method: "analysis", verifier: termOf(verifier),
  observes: { relation: "reference:covers", objects: [{ referent: termOf(observed) }] }, fails_when });
export function constrainedInputRequirementRows(referents) {
  const I = referents;
  return {
    declaration: { nature: "behavior", modality: "MUST", subject: termOf(I.level),
      behavior: { relation: "range:has_range", objects: [{ range: { minimum: 0, maximum: 100 } }] },
      verification: rowVerification(I.range_check, I.level,
        { relation: "range:has_range", objects: [{ range: { minimum: 101 } }] }) },
    accepted: { nature: "behavior", modality: "MUST", subject: termOf(I.operation),
      behavior: whenRow("reference:writes", I.accepted_effect, I.inside_range),
      verification: rowVerification(I.accepted_check, I.operation,
        whenRow("reference:returns", I.refusal_result, I.inside_range)) },
    rejected: { nature: "behavior", modality: "MUST", subject: termOf(I.operation),
      behavior: whenRow("reference:returns", I.refusal_result, I.outside_range),
      verification: rowVerification(I.refusal_check, I.operation,
        whenRow("reference:writes", I.accepted_effect, I.outside_range)) }
  };
}
export const GAUGE_REQUIREMENT_ROWS = Object.freeze(constrainedInputRequirementRows(R));
export const SIBLING_REQUIREMENT_ROW = Object.freeze({ nature: "behavior", modality: "MUST", subject: termOf(readOperation),
  behavior: { relation: "reference:returns", objects: [{ referent: termOf(R.accepted_effect) }] },
  verification: rowVerification(SIBLING_CHECK, readOperation,
    { relation: "reference:returns", objects: [{ referent: termOf(R.refusal_result) }] }) });

const GAUGE_ENTITY_TYPES = Object.freeze(Object.fromEntries([...Object.values(R), readOperation, SIBLING_CHECK]
  .map((referent) => [termOf(referent), referent.type_term])));
const namedBy = (statement) => [...statement.objects.flatMap((object) => object.referent === undefined ? [] : [object.referent]),
  ...(statement.applies?.context ?? [])];
export const gaugeRequirementBatch = (rows) => ({
  entities: Object.fromEntries([...new Set(rows.flatMap((row) => [row.subject, ...namedBy(row.behavior), row.verification.verifier,
    ...namedBy(row.verification.observes), ...namedBy(row.verification.fails_when)]))].map((id) => [id, GAUGE_ENTITY_TYPES[id]])),
  requirements: rows });
const role = (name) => ({ role: name, allowed_type_terms: [R[name].type_term], cardinality: "exactly_one" });
const template = (subject_role, operator, operandRole, contextRole = null) => ({ subject_role, operator,
  applicability_context: contextRole === null ? { mode: "unconditional", operand_roles: [] }
    : { mode: "when", operand_roles: [contextRole] },
  operands: [{ kind: "reference", role: operandRole }] });
const range = (bounds) => ({ subject_role: "level", operator: "range:has_range",
  applicability_context: { mode: "unconditional", operand_roles: [] },
  operands: [{ kind: "range", ...bounds }] });
const METHODS = ["analysis", "demonstration", "proof", "test_execution"];
const behavior = (pattern_id, proposition_template) => ({ pattern_id, claim_kind: "behavior",
  allowed_modalities: ["MUST"], proposition_template });
const verifying = (pattern_id, proposition_template, falsifying_proposition_template) => ({ pattern_id,
  claim_kind: "verification", allowed_modalities: ["MUST"], verification_methods: METHODS,
  proposition_template, falsifying_proposition_template });
const relation = (role) => (pattern_id, source, target) => ({ pattern_id, role,
  source_claim_pattern_id: source, target_claim_pattern_id: target });
const verifies = relation("verifies");
const dependsOn = relation("depends_on");
const unconditional = { mode: "unconditional", operand_roles: [] };

export const GAUGE_PATTERN_IDS = Object.freeze({
  behaviors: ["accepted-behavior", "out-of-range-behavior", "range-declaration"],
  verifications: ["accepted-verification", "out-of-range-verification", "range-declaration-verification"],
  relationships: ["accepted-verifies", "out-of-range-verifies", "range-declaration-verifies"],

  dependencies: ["accepted-depends-on-declaration", "out-of-range-depends-on-declaration"]
});
export const GAUGE_EXPECTED_PATTERN_IDS = Object.freeze(Object.values(GAUGE_PATTERN_IDS).flat().sort());

function gaugeProfile() {
  return {
    schema_version: PROFILE_SCHEMA_VERSION_V1,
    profile_id: "draft.experiment.gauge-set-level-input-contract",
    profile_version: "0.0.1",
    reference_roles: Object.keys(R).map(role),
    claim_patterns: [
      behavior("range-declaration", range({ minimum: 0, maximum: 100 })),
      behavior("accepted-behavior", template("operation", "reference:writes", "accepted_effect", "inside_range")),
      behavior("out-of-range-behavior",
        template("operation", "reference:returns", "refusal_result", "outside_range")),
      verifying("range-declaration-verification", template("range_check", "reference:covers", "level"),
        range({ minimum: 101 })),
      verifying("accepted-verification", template("accepted_check", "reference:covers", "operation"),
        template("operation", "reference:returns", "refusal_result", "inside_range")),
      verifying("out-of-range-verification", template("refusal_check", "reference:covers", "operation"),
        template("operation", "reference:writes", "accepted_effect", "outside_range"))],
    relation_patterns: [
      verifies("range-declaration-verifies", "range-declaration-verification", "range-declaration"),
      verifies("accepted-verifies", "accepted-verification", "accepted-behavior"),
      verifies("out-of-range-verifies", "out-of-range-verification", "out-of-range-behavior"),
      dependsOn("accepted-depends-on-declaration", "accepted-behavior", "range-declaration"),
      dependsOn("out-of-range-depends-on-declaration", "out-of-range-behavior", "range-declaration")],
    falsifier_condition_bindings: [
      { relation_pattern_id: "range-declaration-verifies", applicability_context: unconditional },
      { relation_pattern_id: "accepted-verifies",
        applicability_context: { mode: "when", operand_roles: ["inside_range"] } },
      { relation_pattern_id: "out-of-range-verifies",
        applicability_context: { mode: "when", operand_roles: ["outside_range"] } }],
    collection_patterns: [], resolver_fact_patterns: [], evidence_patterns: [],
    satisfaction_expression: { all_of: GAUGE_EXPECTED_PATTERN_IDS.map((pattern) => ({ pattern })) },
    contract_schema_version: SCHEMA_VERSION_V1, vocabulary_version: VOCABULARY_VERSION_V1,
    vocabulary_signature_digest: VOCABULARY_DIGESTS.signature,
    vocabulary_algebra_digest: VOCABULARY_DIGESTS.algebra,
    vocabulary_definitions_digest: VOCABULARY_DIGESTS.definitions,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete
  };
}

export function gaugeDraftPolicy({ unit, focus = null }) {
  return {
    schema_version: "required-policy-patterns.experimental.v0",
    policy_id: "draft.gauge-set-level-input-contract",
    status: "draft experimental input; not an accepted decision",
    provenance: { kind: "supplied_draft_fixture", motivating_decision: "DEC-0194",
      motivating_decision_status: "proposed", motivating_clauses: ["2.b", "2.e", "5"],
      note: "DEC-0194 states broad criteria; this concrete gauge policy is not in it" },
    scope: { unit, focus },
    profile: gaugeProfile(),
    bindings: structuredClone(GAUGE_REFERENTS),

    obligation_pattern_ids: [...GAUGE_PATTERN_IDS.behaviors]
  };
}

export function gaugeDependencyRelations({ declaration, accepted, rejected, prefix = "gauge" }) {
  return [["accepted", accepted], ["out-of-range", rejected]].map(([name, source]) => ({
    relation_id: `rel-${prefix}-${name}-depends-on-range-declaration`, role: "depends_on",
    source_claim_id: source, target_claim_id: declaration }));
}

export const INPUT_BEHAVIOR_SET_PATTERN = Object.freeze({ pattern_id: "input-behavior-set",
  collection_kind: "closed_set", match_mode: "exact", candidate_quantifier: "any",
  collection_purpose: "input_behaviors",
  member_claim_pattern_ids: ["accepted-behavior", "out-of-range-behavior"] });

export async function compileGaugeRequirements(requirements, { wkId, focus = null, contract = null }) {
  const pkg = await import("@agent-chassis/controlled-contract");
  const { compileControlledContractRequirements } = await import(
    "../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-authoring.mjs");
  const { deriveControlledContractAuthoringVocabulary } = await import(
    "../../packages/wiki-core/src/operations/controlled-contract/contract-requirement-vocabulary.mjs");
  return compileControlledContractRequirements({ wkId, focus, answer: { requirements }, contract,
    vocabulary: deriveControlledContractAuthoringVocabulary(pkg.NATIVE_CONTRACT_SCHEMA_V1),
    schemaIdentity: { schema_version: pkg.SCHEMA_VERSION_V1, vocabulary_version: pkg.VOCABULARY_VERSION_V1,
      profile_id: pkg.PROFILE_ID_V1, test_proof_version: pkg.TEST_PROOF_VERSION_V1 },
    buildTestProofTemplate: pkg.buildStableTestProofBindingTemplate });
}
