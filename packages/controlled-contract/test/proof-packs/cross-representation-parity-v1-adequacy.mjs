import { createHash } from "node:crypto";

import { evaluateStableProofPackFixtureV1
} from "../support/stable-v1-proof-pack-runtime.mjs";
import { PROOF_PACK_ADEQUACY_RUN_VERSION
} from "../support/proof-pack-adequacy-constants.mjs";

const GUARANTEE = "For one declared logical source, two distinct result surfaces expose equal complete populations of typed member descriptors by mutual subset, bind one shared exact nonnegative member count, emit count signals equal to that count, and expose one explicitly selected canonical value pair that is exactly equal. One verification reads both full representations and each verified behavior has its controlled complement as a separate falsifier.";

const EXCLUSIONS = Object.freeze([
  "applicability-selection",
  "automatic-or-arbitrary-multi-value-pairing",
  "business-semantics-referential-integrity-and-cross-member-invariants",
  "caller-authored-population-truthfulness-and-completeness",
  "delivered-test-implementation-and-result-value-authenticity",
  "field-name-or-schema-mapping",
  "independent-schema-truthfulness-or-compatibility",
  "logical-source-provenance",
  "nested-recursive-value-parity",
  "ordering-transport-media-type-pagination-and-streaming-parity",
  "type-coercion-normalization-unit-conversion-rounding-or-timezone-conversion",
  "typed-member-descriptor-authoritative-construction-or-existence"
]);

const POSITIVE_IDS = Object.freeze([
  "cli-json-parity",
  "json-protobuf-parity",
  "sql-search-parity"
]);

const MUTANT_IDS = Object.freeze([
  "collapsed-result-surfaces",
  "count-only-proof",
  "left-member-missing",
  "one-sided-inspection",
  "permissive-independent-schemas",
  "right-member-extra",
  "same-count-different-population",
  "same-count-member-substitution",
  "selected-canonical-value-mismatch",
  "wrong-logical-source",
  "wrong-type-member"
]);

const REJECTION_PATTERNS = Object.freeze([
  ["missing-source-to-results-link", "source-emits-both-results"],
  ["missing-left-result-inputs", "left-result-exposes-parity-inputs"],
  ["missing-right-result-inputs", "right-result-exposes-parity-inputs"],
  ["missing-left-subset-right", "left-population-within-right"],
  ["missing-right-subset-left", "right-population-within-left"],
  ["missing-left-count", "left-count-exact"],
  ["missing-right-count", "right-count-exact"],
  ["missing-selected-value-equality", "selected-canonical-values-equal"],
  ["missing-read-spine", "verification-reads-both-representations"],
  ["missing-left-population-verification", "left-population-parity-verification"],
  ["missing-right-population-verification", "right-population-parity-verification"],
  ["missing-left-count-verification", "left-count-verification"],
  ["missing-right-count-verification", "right-count-verification"],
  ["missing-canonical-value-verification", "canonical-value-verification"]
]);

const roleReferenceIds = Object.freeze({
  logical_source: ["ref-logical-source"],
  left_result: ["ref-left-result"],
  right_result: ["ref-right-result"],
  left_population: ["ref-left-population"],
  left_members: ["ref-member-id-string", "ref-member-total-decimal"],
  right_population: ["ref-right-population"],
  right_members: ["ref-member-id-string", "ref-member-total-decimal"],
  left_count_signal: ["ref-left-count"],
  right_count_signal: ["ref-right-count"],
  left_selected_canonical_value: ["ref-left-value"],
  right_selected_canonical_value: ["ref-right-value"],
  verification: ["ref-verification"],
  left_population_not_subset_condition: ["ref-left-population-not-subset-condition"],
  right_population_not_subset_condition: ["ref-right-population-not-subset-condition"],
  left_count_mismatch_condition: ["ref-left-count-mismatch-condition"],
  right_count_mismatch_condition: ["ref-right-count-mismatch-condition"],
  canonical_value_mismatch_condition: ["ref-canonical-value-mismatch-condition"]
});

const ref = (referenceId) => ({ kind: "reference", reference_id: referenceId });

function identity(kind, domain, value) {
  if (kind === "repository_path") return {
    kind, repository: `example/${domain}`, path: `fixtures/${domain}/${value}`
  };
  if (kind === "code_symbol") return {
    kind, repository: `example/${domain}`, path: `src/${domain}.mjs`, symbol: value
  };
  if (kind === "runtime_parameter") return { kind, name: `${domain}.${value}` };
  if (kind === "profile_term") return { kind, term: `${domain}:${value}` };
  return { kind: "durable_id", domain: `cross-representation-${domain}`, value };
}

function defaultRoleValues(leftMembers, rightMembers) {
  return { ...structuredClone(roleReferenceIds),
    left_members: [...leftMembers], right_members: [...rightMembers] };
}

function resolveTemplate(template, roleValues, numberValues) {
  return {
    subject_reference_id: roleValues[template.subject_role]?.length === 1
      ? roleValues[template.subject_role][0] : null,
    operator: template.operator,
    applicability_context: {
      mode: template.applicability_context.mode,
      operand_reference_ids: template.applicability_context.operand_roles.flatMap(
        (role) => roleValues[role] ?? []
      )
    },
    operands: template.operands.flatMap((operand) => operand.kind === "reference"
      ? (roleValues[operand.role] ?? []).map(ref)
      : operand.kind === "number" && operand.value_role
        ? [{ kind: "number", value: numberValues[operand.value_role] }]
        : [structuredClone(operand)])
  };
}

function buildCrossRepresentationParityFixture({
  profile,
  domain = "json-protobuf",
  leftMembers = roleReferenceIds.left_members,
  rightMembers = roleReferenceIds.right_members,
  roleTypeOverrides = {},
  roleIdentityOverrides = {},
  roleCountOverrides = {},
  detachRoles = [],
  numberOverrides = {},
  aliasRoles = {},
  omitPatternIds = [],
  selectLastModalityPattern = null,
  selectLastVerificationPattern = null,
  mutateContract = null,
  mutateInput = null
} = {}) {
  const roleValues = defaultRoleValues(leftMembers, rightMembers);
  for (const role of detachRoles) roleValues[role] = roleValues[role].map(
    (_, index) => `ref-detached-${role.replaceAll("_", "-")}-${index + 1}`);
  for (const [role, count] of Object.entries(roleCountOverrides)) {
    const existing = roleValues[role] ?? [];
    roleValues[role] = Array.from({ length: count }, (_, index) =>
      existing[index] ?? `ref-${role.replaceAll("_", "-")}-${index + 1}`);
  }
  for (const [role, sourceRole] of Object.entries(aliasRoles)) {
    roleValues[role] = [...roleValues[sourceRole]];
  }
  const numberValues = { member_count: leftMembers.length, ...numberOverrides };
  const roleById = new Map(profile.reference_roles.map((role) => [role.role, role]));
  const referenceRoles = new Map();
  for (const [role, ids] of Object.entries(roleValues)) for (const id of ids) {
    if (!referenceRoles.has(id)) referenceRoles.set(id, []);
    referenceRoles.get(id).push(role);
  }
  const references = [...referenceRoles].map(([referenceId, roles]) => {
    const role = roles.find((candidate) => roleTypeOverrides[candidate] ||
      roleIdentityOverrides[candidate]) ?? roles[0];
    const definition = roleById.get(role);
    const kind = roleIdentityOverrides[role]?.kind ??
      definition.allowed_identity_kinds?.[0] ?? "profile_term";
    return {
      reference_id: referenceId,
      type_term: roleTypeOverrides[role] ?? definition.allowed_type_terms[0],
      identity: structuredClone(roleIdentityOverrides[role] ??
        identity(kind, domain, referenceId.slice(4)))
    };
  });
  const contract = {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references, propositions: [], claims: [], relations: [], collections: [],
    residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const addClaim = (id, proposition, kind = "evidence", modality = "MUST",
    verificationMethod = null, falsifierId = null) => {
    contract.propositions.push({ proposition_id: `prop-${id}`, ...proposition });
    contract.claims.push({ claim_id: `claim-${id}`, proposition_id: `prop-${id}`,
      kind, modality,
      ...(verificationMethod ? { verification_method: verificationMethod } : {}),
      ...(falsifierId ? { falsifying_proposition_id: `prop-${falsifierId}` } : {}) });
  };
  for (const pattern of profile.reference_binding_patterns) {
    const [populationRole, memberRole] = pattern.roles;
    const members = roleValues[memberRole];
    const countRole = profile.reference_role_count_bindings.find(
      ({ reference_role: candidate }) => candidate === memberRole)?.number_role;
    const countProposition = {
      subject_reference_id: roleValues[populationRole][0],
      operator: "number:has_cardinality",
      applicability_context: { mode: pattern.applicability_context.mode,
        operand_reference_ids: pattern.applicability_context.operand_roles.flatMap(
          (role) => roleValues[role] ?? []) },
      operands: [{ kind: "number", value: countRole
        ? numberValues[countRole] : members.length }]
    };
    const countAlsoClaimed = profile.claim_patterns.some(({ proposition_template: template }) =>
      JSON.stringify(resolveTemplate(template, roleValues, numberValues)) ===
        JSON.stringify(countProposition));
    if (!countAlsoClaimed) addClaim(`${pattern.pattern_id}-count`, countProposition);
    if (members.length > 0) addClaim(`${pattern.pattern_id}-members`, {
      subject_reference_id: roleValues[populationRole][0],
      operator: "reference:contains",
      applicability_context: { mode: pattern.applicability_context.mode,
        operand_reference_ids: pattern.applicability_context.operand_roles.flatMap(
          (role) => roleValues[role] ?? []) },
      operands: members.map(ref)
    });
  }
  const omitted = new Set(omitPatternIds);
  for (const pattern of profile.claim_patterns) {
    if (omitted.has(pattern.pattern_id)) continue;
    let falsifierId = null;
    if (pattern.falsifying_proposition_template) {
      falsifierId = `falsifier-${pattern.pattern_id}`;
      contract.propositions.push({ proposition_id: `prop-${falsifierId}`,
        ...resolveTemplate(pattern.falsifying_proposition_template, roleValues, numberValues) });
    }
    addClaim(pattern.pattern_id,
      resolveTemplate(pattern.proposition_template, roleValues, numberValues),
      pattern.claim_kind,
      pattern.pattern_id === selectLastModalityPattern
        ? pattern.allowed_modalities.at(-1) : pattern.allowed_modalities[0],
      pattern.claim_kind === "verification"
        ? pattern.pattern_id === selectLastVerificationPattern
          ? pattern.verification_methods.at(-1)
          : pattern.verification_methods[0]
        : null,
      falsifierId);
  }
  for (const relation of profile.relation_patterns) if (
    !omitted.has(relation.source_claim_pattern_id) &&
    !omitted.has(relation.target_claim_pattern_id)) contract.relations.push({
    relation_id: `rel-${relation.pattern_id}`,
    role: relation.role,
    source_claim_id: `claim-${relation.source_claim_pattern_id}`,
    target_claim_id: `claim-${relation.target_claim_pattern_id}`
  });
  const input = {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: profile.reference_roles.map(({ role }) => ({
      role, reference_ids: [...(roleValues[role] ?? [])]
    })),
    number_bindings: profile.number_roles.map(({ role }) => ({
      role, value: numberValues[role]
    })),
    claim_pattern_bindings: [], resolver_facts: [], delivered_evidence: [], stable_evaluation: {}
  };
  mutateContract?.(contract, input, roleValues);
  mutateInput?.(input, contract, roleValues);
  return { contract, input, profile };
}

function satisfaction(fixture) {
  return evaluateStableProofPackFixtureV1({ contract: fixture.contract,
    profile: fixture.profile, evaluation_input: fixture.input }).satisfaction;
}

function proposition(contract, patternId) {
  return contract.propositions.find(({ proposition_id: id }) => id === `prop-${patternId}`);
}

const baseMembers = ["ref-member-id-string", "ref-member-total-decimal"];
const subsetPatterns = ["left-population-within-right", "right-population-within-left",
  "left-population-parity-verification", "right-population-parity-verification"];

function mutantFixture(profile, id) {
  if (id === "left-member-missing") return buildCrossRepresentationParityFixture({
    profile, domain: id, leftMembers: [baseMembers[0]], rightMembers: baseMembers,
    numberOverrides: { member_count: 2 }
  });
  if (id === "right-member-extra") return buildCrossRepresentationParityFixture({
    profile, domain: id, leftMembers: baseMembers,
    rightMembers: [...baseMembers, "ref-member-note-string"]
  });
  if (id === "same-count-member-substitution") return buildCrossRepresentationParityFixture({
    profile, domain: id, leftMembers: baseMembers,
    rightMembers: [baseMembers[0], "ref-member-note-string"]
  });
  if (id === "wrong-type-member") return buildCrossRepresentationParityFixture({
    profile, domain: id, leftMembers: baseMembers,
    rightMembers: [baseMembers[0], "ref-member-total-string"]
  });
  if (id === "same-count-different-population") {
    return buildCrossRepresentationParityFixture({ profile, domain: id,
      leftMembers: baseMembers,
      rightMembers: ["ref-member-status-enum", "ref-member-note-string"] });
  }
  if (id === "wrong-logical-source") return buildCrossRepresentationParityFixture({
    profile, domain: id, mutateContract(contract) {
      contract.references.push({ reference_id: "ref-other-source", type_term: "cc:entity",
        identity: identity("durable_id", id, "other-source") });
      proposition(contract, "source-emits-both-results").subject_reference_id =
        "ref-other-source";
    }
  });
  if (id === "collapsed-result-surfaces") return buildCrossRepresentationParityFixture({
    profile, domain: id, aliasRoles: { right_result: "left_result" }
  });
  if (id === "count-only-proof") return buildCrossRepresentationParityFixture({
    profile, domain: id, omitPatternIds: subsetPatterns
  });
  if (id === "one-sided-inspection") return buildCrossRepresentationParityFixture({
    profile, domain: id, mutateContract(contract) {
      proposition(contract, "verification-reads-both-representations").operands =
        proposition(contract, "verification-reads-both-representations").operands.filter(
          ({ reference_id }) => !["ref-right-result", "ref-right-population",
            "ref-right-count", "ref-right-value"].includes(reference_id));
    }
  });
  if (id === "permissive-independent-schemas") return buildCrossRepresentationParityFixture({
    profile, domain: id, omitPatternIds: subsetPatterns, mutateContract(contract) {
      for (const side of ["left", "right"]) {
        contract.references.push({ reference_id: `ref-${side}-schema`,
          type_term: "cc:configuration",
          identity: identity("durable_id", id, `${side}-schema`) });
        const propositionId = `prop-${side}-independent-schema`;
        contract.propositions.push({ proposition_id: propositionId,
          subject_reference_id: `ref-${side}-result`, operator: "reference:conforms_to",
          applicability_context: { mode: "unconditional", operand_reference_ids: [] },
          operands: [ref(`ref-${side}-schema`)] });
        contract.claims.push({ claim_id: `claim-${side}-independent-schema`,
          proposition_id: propositionId, kind: "evidence", modality: "MUST" });
      }
    }
  });
  if (id === "selected-canonical-value-mismatch") {
    return buildCrossRepresentationParityFixture({ profile, domain: id,
      mutateContract(contract) {
        proposition(contract, "selected-canonical-values-equal").operator =
          "reference:not_equals";
        proposition(contract, "falsifier-canonical-value-verification").operator =
          "reference:equals";
      } });
  }
  throw new Error(`unknown mutant ${id}`);
}

async function runProofPackAdequacyControls({ profile, profile_digest: profileDigest }) {
  const controls = [];
  const positive = (controlId, fixture) => controls.push({ control_id: controlId,
    category: "positive", implementation_outcome: "passed",
    profile_satisfaction: satisfaction(fixture) });
  positive("json-protobuf-parity", buildCrossRepresentationParityFixture({
    profile, domain: "json-protobuf",
    leftMembers: ["ref-member-id-string", "ref-member-total-decimal",
      "ref-member-status-enum"],
    rightMembers: ["ref-member-id-string", "ref-member-total-decimal",
      "ref-member-status-enum"]
  }));
  positive("sql-search-parity", buildCrossRepresentationParityFixture({
    profile, domain: "sql-search",
    leftMembers: ["ref-member-key-uuid", "ref-member-title-string",
      "ref-member-updated-timestamp"],
    rightMembers: ["ref-member-key-uuid", "ref-member-title-string",
      "ref-member-updated-timestamp"]
  }));
  positive("cli-json-parity", buildCrossRepresentationParityFixture({
    profile, domain: "cli-json",
    leftMembers: ["ref-member-name-string", "ref-member-state-enum"],
    rightMembers: ["ref-member-name-string", "ref-member-state-enum"]
  }));
  for (const controlId of MUTANT_IDS) controls.push({ control_id: controlId,
    category: "mutant", implementation_outcome: "killed",
    profile_satisfaction: satisfaction(mutantFixture(profile, controlId)) });
  for (const [controlId, patternId] of REJECTION_PATTERNS) controls.push({
    control_id: controlId, category: "profile_rejection",
    implementation_outcome: "not_applicable",
    profile_satisfaction: satisfaction(buildCrossRepresentationParityFixture({
      profile, omitPatternIds: [patternId]
    }))
  });
  for (const controlId of EXCLUSIONS) controls.push({ control_id: controlId,
    category: "exclusion", implementation_outcome: "boundary_demonstrated",
    profile_satisfaction: "not_evaluated" });
  controls.sort((left, right) => left.control_id < right.control_id ? -1 : 1);
  return {
    schema_version: PROOF_PACK_ADEQUACY_RUN_VERSION,
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_digest: profileDigest,
    guarantee_digest: createHash("sha256").update(GUARANTEE).digest("hex"),
    controls
  };
}

export {
  EXCLUSIONS,
  GUARANTEE,
  MUTANT_IDS,
  POSITIVE_IDS,
  REJECTION_PATTERNS,
  buildCrossRepresentationParityFixture,
  runProofPackAdequacyControls
};
