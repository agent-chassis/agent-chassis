import {
  canonicalJsonBytes,
  canonicalValue,
  compareCodeUnits,
  domainSeparatedDigest
} from "./proof-aware-digest.mjs";
import {
  MANDATORY_AUTHORITY_EXCLUSIONS,
  validateStateEffectTuple
} from "./proof-aware-planning-policy.mjs";

const CARRIER_VERSION =
  "controlled-contract-proof-aware-planning-carrier.experimental.v2";
const CARRIER_DOMAIN = "controlled-contract:proof-aware-resolved-carrier:v2";
const FACT_STATES = Object.freeze(["established", "proven", "satisfied",
  "inactive", "not_proven", "not_assessed", "not_applicable", "ambiguous",
  "excluded", "residue", "missing", "invalid"]);
const UNRESOLVED_STATES = Object.freeze(["not_proven", "not_assessed",
  "not_applicable", "ambiguous", "excluded", "residue", "missing", "invalid"]);
const FACETS = Object.freeze(["behavior_cohesion", "proof_atomicity",
  "exact_capture_atomicity", "implementation_ownership",
  "verification_ownership", "evidence_acquisition", "authority_boundary"]);
const EFFECTS = Object.freeze(["behavior_cohesion", "proof_atomicity",
  "capture_atomicity", "directed_cut", "merge_signal", "hard_contraction",
  "separation_signal", "overlay_only", "diagnostic_only", "never_group",
  "unresolved_constraint"]);
const EDGE_KINDS = Object.freeze(["depends_on", "precedes", "verified_by",
  "falsified_by", "satisfies_pattern", "bound_to_projected_node",
  "captured_with", "derived_by", "shares_resource", "must_preserve_identity",
  "must_co_locate", "may_separate", "must_not_infer_join", "alternative_to",
  "outside_guarantee"]);
const INCIDENCE_KINDS = Object.freeze(["proposition_structure",
  "applicability_scope", "relation_endpoints", "collection_membership",
  "logic_gate_branches", "iteration_association", "falsifier_occurrence",
  "exact_binding_source_result", "projected_selection_ownership",
  "resource_participation", "occurrence_participation", "non_join_boundary"]);

const NODE_SUBTYPES = Object.freeze({
  authored_behavior_component: Object.freeze(["behavior_claim", "structural_subject",
    "structural_operand"]),
  obligation: Object.freeze(["mandatory_behavior", "forbidden_behavior",
    "advisory_behavior", "verification", "evidence", "proposition"]),
  falsifier: Object.freeze(["falsifying_proposition"]),
  profile_pattern: Object.freeze(["binding_constraint", "reference_binding", "claim",
    "relation", "collection", "resolver_fact", "evidence"]),
  logic_gate: Object.freeze(["all_of", "any_of", "exactly_one"]),
  relation_instance: Object.freeze(["satisfies", "verifies", "derives_from",
    "refines", "traces", "replaces", "depends_on", "precedes"]),
  collection_instance: Object.freeze(["closed_set", "ordered_sequence"]),
  population: Object.freeze(["bound_population", "universal"]),
  iterated_occurrence: Object.freeze(["universal_member"]),
  proof_pack: Object.freeze(["assessed_pack"]),
  assessment_state: Object.freeze(["pack_result", "profile_result",
    "exact_binding_result"]),
  exact_binding_requirement: Object.freeze(["source", "result"]),
  capture_source_set: Object.freeze(["exact_source_set"]),
  deterministic_transform: Object.freeze(["projection"]),
  projected_selection: Object.freeze(["selected", "inactive_branch",
    "not_satisfied", "ambiguous", "not_applicable"]),
  planning_boundary: Object.freeze(["uncovered", "excluded", "non_join",
    "ambiguous", "residue", "missing", "invalid", "branch_scope"]),
  resource: Object.freeze(["implementation", "test", "evidence", "capture",
    "projection", "verification", "acquisition", "role_binding"])
});
const NODE_KINDS = Object.freeze(Object.keys(NODE_SUBTYPES));

const ATTRIBUTE_KEYS = Object.freeze(["access_mode", "join_kind", "cardinality",
  "endpoint_role", "branch_state", "operand_kind", "scope_role", "member_role",
  "associated_role", "proposition_position_kind", "participation_role",
  "occurrence_role", "association_status"]);
const ATTRIBUTE_VALUES = Object.freeze({
  access_mode: ["read", "write", "read_write", "execute", "observe"],
  join_kind: ["same_value", "same_occurrence", "same_attempt", "association"],
  cardinality: ["exactly_one", "zero_or_one", "one_or_more", "zero_or_more"],
  endpoint_role: ["source", "target", "qualifier", "member", "owner"],
  branch_state: ["active", "inactive", "unresolved"],
  operand_kind: ["literal", "reference", "claim", "collection", "relation"],
  scope_role: ["subject", "operand", "endpoint", "member", "branch", "source",
    "result"],
  member_role: ["subject", "reference_operand", "applicability_operand"],
  associated_role: ["subject", "reference_operand", "relation_endpoint",
    "collection_member"],
  proposition_position_kind: ["subject", "operand", "applicability_operand"],
  participation_role: ["implementation", "test", "evidence", "capture_source",
    "capture_result", "transform_input", "transform_output", "occurrence"],
  occurrence_role: ["behavior_target", "verification", "falsifier", "capture",
    "transform", "projection", "selected_result", "universal_member"],
  association_status: ["satisfied", "unsatisfied", "indeterminate"]
});

const ROLE_MATRIX = Object.freeze({
  proposition_structure: Object.freeze({ proposition: {}, subject: {},
    operand: { operand_kind: true } }),
  applicability_scope: Object.freeze({ applicability_owner: {},
    applicability_operand: { scope_role: true } }),
  relation_endpoints: Object.freeze({ relation: {}, endpoint: { endpoint_role: true } }),
  collection_membership: Object.freeze({ collection: {}, member: {} }),
  logic_gate_branches: Object.freeze({ logic_gate: {},
    branch_scope: { branch_state: true }, branch_member: { branch_state: true } }),
  iteration_association: Object.freeze({ pattern: {}, population: {},
    iteration_member: { member_role: true }, association: {
      member_role: true, associated_role: true, cardinality: true,
      association_status: true
    }, iteration_member_role: {}, association_member_role: {
      member_role: true, cardinality: true, association_status: true
    }, association_associated_role: {
      associated_role: true, cardinality: true, association_status: true
    } }),
  falsifier_occurrence: Object.freeze({ target: {}, verification: {}, falsifier: {},
    occurrence_participant: { join_kind: true,
      proposition_position_kind: true, occurrence_role: true } }),
  exact_binding_source_result: Object.freeze({
    source_requirement: {}, captured_source: {}, source_set: {}, transform: {},
    result_requirement: {}, result_projection: {}
  }),
  projected_selection_ownership: Object.freeze({ pack_scope: {}, pattern: {},
    selection: {}, projected_graph: {}, selected_node: {} }),
  resource_participation: Object.freeze({ resource: {}, resource_participant: {
    access_mode: true, participation_role: true
  } }),
  occurrence_participation: Object.freeze({ occurrence: {},
    occurrence_participant: { occurrence_role: true } }),
  non_join_boundary: Object.freeze({ boundary: {}, left_side: {}, right_side: {} })
});

const CARDINALITY = Object.freeze({
  proposition_structure: { proposition: [1, 1], subject: [1, 1], operand: [1, Infinity] },
  applicability_scope: { applicability_owner: [1, 1], applicability_operand: [0, Infinity] },
  relation_endpoints: { relation: [1, 1], endpoint: [2, Infinity] },
  collection_membership: { collection: [1, 1], member: [1, Infinity] },
  logic_gate_branches: { logic_gate: [1, 1], branch_scope: [1, Infinity],
    branch_member: [1, Infinity] },
  iteration_association: { pattern: [1, 1], population: [1, 1],
    iteration_member: [0, Infinity], association: [0, Infinity],
    iteration_member_role: [0, Infinity], association_member_role: [0, Infinity],
    association_associated_role: [0, Infinity] },
  falsifier_occurrence: { target: [1, 1], verification: [1, 1], falsifier: [1, 1],
    occurrence_participant: [0, Infinity] },
  exact_binding_source_result: { source_requirement: [1, Infinity],
    captured_source: [1, Infinity], source_set: [1, 1], transform: [1, 1],
    result_requirement: [1, 1], result_projection: [1, 1] },
  projected_selection_ownership: { pack_scope: [1, 1], pattern: [1, 1],
    selection: [1, 1], projected_graph: [1, 1], selected_node: [0, Infinity] },
  resource_participation: { resource: [1, 1], resource_participant: [1, Infinity] },
  occurrence_participation: { occurrence: [1, 1], occurrence_participant: [1, Infinity] },
  non_join_boundary: { boundary: [1, 1], left_side: [1, Infinity],
    right_side: [1, Infinity] }
});

const TYPED_ATTRIBUTE_RULES = Object.freeze({
  proposition_structure: Object.freeze({}),
  applicability_scope: Object.freeze({ scope: Object.freeze(["unconditional", "if",
    "unless", "when", "while", "where", "before", "after", "during", "until",
    "frozen_base", "counterfactual"]) }),
  relation_endpoints: Object.freeze({}),
  collection_membership: Object.freeze({ ordered: "boolean" }),
  logic_gate_branches: Object.freeze({ operator: Object.freeze(["all_of", "any_of",
    "exactly_one"]) }),
  iteration_association: Object.freeze({ quantifier: Object.freeze([
    "bound_population", "universal"]), vacuous: "boolean" }),
  falsifier_occurrence: Object.freeze({}),
  exact_binding_source_result: Object.freeze({}),
  projected_selection_ownership: Object.freeze({}),
  resource_participation: Object.freeze({}),
  occurrence_participation: Object.freeze({}),
  non_join_boundary: Object.freeze({ reason: Object.freeze([
    "independent_pack_context", "explicit_identity_exclusion",
    "authority_boundary"]) })
});

const EDGE_SEMANTICS = Object.freeze({
  depends_on: [["structural_directed_cut", "authored_dependency", "directed_cut",
    "implementation_ownership"]],
  precedes: [["structural_directed_cut", "authored_precedence", "directed_cut",
    "implementation_ownership"]],
  verified_by: [["verification_overlay", "verification_relation", "overlay_only",
    "verification_ownership"]],
  falsified_by: [["proof_pattern_overlay", "falsifier_relation", "overlay_only",
    "verification_ownership"]],
  satisfies_pattern: [
    ["proof_pattern_overlay", "profile_pattern", "overlay_only", "proof_atomicity"],
    ["proof_pattern_overlay", "projected_selection", "overlay_only", "proof_atomicity"]
  ],
  bound_to_projected_node: [["proof_pattern_overlay", "projected_selection",
    "overlay_only", "proof_atomicity"]],
  captured_with: [["proven_capture_atomicity", "same_cycle_exact_binding",
    "capture_atomicity", "exact_capture_atomicity"]],
  derived_by: [["proven_capture_atomicity", "same_cycle_exact_binding",
    "capture_atomicity", "exact_capture_atomicity"]],
  shares_resource: [["resource_affinity", "policy_authorized_write_incidence",
    "merge_signal", "implementation_ownership"]],
  must_preserve_identity: [
    ["proven_proof_atomicity", "same_occurrence_profile_requirement",
      "proof_atomicity", "proof_atomicity"],
    ["proven_proof_atomicity", "same_occurrence_profile_requirement",
      "hard_contraction", "proof_atomicity"],
    ["proven_capture_atomicity", "same_cycle_exact_binding", "capture_atomicity",
      "exact_capture_atomicity"],
    ["proven_capture_atomicity", "same_cycle_exact_binding", "hard_contraction",
      "exact_capture_atomicity"]
  ],
  must_co_locate: [["structural_behavior_cohesion", "authored_behavior_relation",
    "behavior_cohesion", "behavior_cohesion"]],
  may_separate: [["explicit_separation", "authored_separation", "separation_signal",
    "implementation_ownership"], ["explicit_separation", "policy_separation",
    "separation_signal", "implementation_ownership"]],
  must_not_infer_join: [["explicit_non_join", "independent_pack_context",
    "never_group", "authority_boundary"], ["explicit_non_join",
    "explicit_identity_exclusion", "never_group", "authority_boundary"]],
  alternative_to: [["declared_alternative", "exclusive_logic_gate_branch",
    "separation_signal", "proof_atomicity"], ["inclusive_alternative_overlay",
    "inclusive_logic_gate_branch", "overlay_only", "proof_atomicity"]],
  outside_guarantee: [["exclusion_diagnostic", "pack_exclusion", "diagnostic_only",
    "authority_boundary"]]
});

const INCIDENCE_SEMANTICS = Object.freeze({
  proposition_structure: [["structural_overlay", "authored_proposition"]],
  applicability_scope: [["structural_overlay", "authored_applicability"]],
  relation_endpoints: [["structural_overlay", "authored_relation_instance"]],
  collection_membership: [["structural_overlay", "authored_collection_instance"]],
  logic_gate_branches: [["proof_pattern_overlay", "profile_pattern"],
    ["declared_alternative", "exclusive_logic_gate_branch"],
    ["inclusive_alternative_overlay", "inclusive_logic_gate_branch"]],
  iteration_association: [["proof_pattern_overlay", "profile_pattern"]],
  falsifier_occurrence: [["proof_pattern_overlay", "falsifier_relation"]],
  exact_binding_source_result: [["proven_capture_atomicity",
    "same_cycle_exact_binding"]],
  projected_selection_ownership: [["proof_pattern_overlay", "projected_selection"]],
  resource_participation: [["proven_capture_atomicity", "same_cycle_exact_binding"],
    ["resource_affinity", "policy_authorized_write_incidence"]],
  occurrence_participation: [["proven_proof_atomicity",
    "same_occurrence_profile_requirement"]],
  non_join_boundary: [["explicit_non_join", "independent_pack_context"],
    ["explicit_non_join", "explicit_identity_exclusion"],
    ["explicit_non_join", "authority_boundary"]]
});

const ROLE_NODE_KINDS = Object.freeze({
  proposition_structure: { proposition: ["obligation"],
    subject: ["resource", "authored_behavior_component"],
    operand: ["resource", "authored_behavior_component", "obligation",
      "collection_instance", "relation_instance"] },
  applicability_scope: { applicability_owner: ["obligation"],
    applicability_operand: ["resource", "authored_behavior_component", "obligation"] },
  relation_endpoints: { relation: ["relation_instance"],
    endpoint: ["authored_behavior_component", "obligation"] },
  collection_membership: { collection: ["collection_instance"],
    member: ["authored_behavior_component", "obligation"] },
  logic_gate_branches: { logic_gate: ["logic_gate"],
    branch_scope: ["planning_boundary"], branch_member: ["profile_pattern",
      "obligation", "projected_selection"] },
  iteration_association: { pattern: ["profile_pattern"], population: ["population"],
    iteration_member: ["resource", "iterated_occurrence"],
    association: ["resource", "authored_behavior_component", "obligation",
      "projected_selection"], iteration_member_role: ["resource"],
    association_member_role: ["resource"],
    association_associated_role: ["resource"] },
  falsifier_occurrence: { target: ["obligation", "authored_behavior_component"],
    verification: ["obligation"], falsifier: ["falsifier"],
    occurrence_participant: ["obligation", "resource", "iterated_occurrence"] },
  exact_binding_source_result: { source_requirement: ["exact_binding_requirement"],
    captured_source: ["resource"], source_set: ["capture_source_set"],
    transform: ["deterministic_transform"],
    result_requirement: ["exact_binding_requirement"],
    result_projection: ["resource", "projected_selection"] },
  projected_selection_ownership: { pack_scope: ["proof_pack"],
    pattern: ["profile_pattern"], selection: ["projected_selection"],
    projected_graph: ["assessment_state", "resource"],
    selected_node: NODE_KINDS },
  resource_participation: { resource: ["resource"],
    resource_participant: NODE_KINDS },
  occurrence_participation: { occurrence: ["iterated_occurrence"],
    occurrence_participant: ["authored_behavior_component", "obligation", "falsifier",
      "capture_source_set", "deterministic_transform", "projected_selection", "resource"] },
  non_join_boundary: { boundary: ["planning_boundary"],
    left_side: NODE_KINDS, right_side: NODE_KINDS }
});

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function frozenClone(value) {
  return deepFreeze(structuredClone(value));
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function validId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !value.includes("\0");
}

function validSha(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validWeight(weight) {
  return exactKeys(weight, ["behavior", "verification", "capture", "serialization"]) &&
    Object.values(weight).every((value) => Number.isSafeInteger(value) &&
      value >= 0 && value <= 0xffffffff);
}

function validAuthority(authority) {
  return exactKeys(authority, ["kind", "authoritative", "mandatory_exclusions",
    "informational_limitations"]) &&
    authority.kind === "non_authoritative_planning_input" &&
    authority.authoritative === false &&
    JSON.stringify(canonicalValue(authority.mandatory_exclusions)) ===
      JSON.stringify(canonicalValue(MANDATORY_AUTHORITY_EXCLUSIONS)) &&
    Array.isArray(authority.informational_limitations) &&
    authority.informational_limitations.every(validId);
}

function validDerivation(value) {
  return exactKeys(value, ["rule_id", "source_class", "source_digest",
    "state_precondition"]) && validId(value.rule_id) && validId(value.source_class) &&
    validSha(value.source_digest) && FACT_STATES.includes(value.state_precondition);
}

function validateNode(node) {
  const keys = ["node_id", "node_kind", "subtype", "state", "facets",
    "pack_instance_id", "branch_scope_id", "provenance", "weight"];
  if (!exactKeys(node, keys) || !validId(node.node_id) ||
      !NODE_KINDS.includes(node.node_kind) ||
      !NODE_SUBTYPES[node.node_kind].includes(node.subtype) ||
      !FACT_STATES.includes(node.state) || !Array.isArray(node.facets) ||
      node.facets.length === 0 || new Set(node.facets).size !== node.facets.length ||
      node.facets.some((facet) => !FACETS.includes(facet)) ||
      !(node.pack_instance_id === null || validId(node.pack_instance_id)) ||
      !(node.branch_scope_id === null || validId(node.branch_scope_id)) ||
      !validWeight(node.weight)) return false;
  return exactKeys(node.provenance, ["source_class", "source_digest",
    "source_ordinal"]) && validId(node.provenance.source_class) &&
    validSha(node.provenance.source_digest) &&
    Number.isSafeInteger(node.provenance.source_ordinal) &&
    node.provenance.source_ordinal >= 0;
}

function edgeMeaningMatches(edge) {
  return EDGE_SEMANTICS[edge.edge_kind].some(([ruleId, sourceClass, effect,
    facet]) => edge.derivation.rule_id === ruleId &&
    edge.derivation.source_class === sourceClass && edge.effect === effect &&
    edge.facet === facet);
}

function validateEdge(edge, nodes) {
  const keys = ["edge_id", "edge_kind", "source_node_id", "target_node_id",
    "state", "derivation", "effect", "facet"];
  if (!exactKeys(edge, keys) || !validId(edge.edge_id) ||
      !EDGE_KINDS.includes(edge.edge_kind) ||
      !nodes.has(edge.source_node_id) || !nodes.has(edge.target_node_id) ||
      edge.source_node_id === edge.target_node_id || !FACT_STATES.includes(edge.state) ||
      !EFFECTS.includes(edge.effect) || !FACETS.includes(edge.facet) ||
      !validDerivation(edge.derivation) ||
      edge.derivation.state_precondition !== edge.state) return false;
  const source = nodes.get(edge.source_node_id);
  const target = nodes.get(edge.target_node_id);
  if (!validateStateEffectTuple({ ...edge.derivation, state: edge.state,
    effect: edge.effect, facet: edge.facet,
    source_pack_instance_id: source.pack_instance_id,
    target_pack_instance_id: target.pack_instance_id })) return false;
  if (!edgeMeaningMatches(edge)) return false;
  if (edge.edge_kind === "verified_by" && edge.facet !== "verification_ownership") {
    return false;
  }
  const endpointKinds = {
    depends_on: [["authored_behavior_component", "obligation"],
      ["authored_behavior_component", "obligation"]],
    precedes: [["authored_behavior_component", "obligation"],
      ["authored_behavior_component", "obligation"]],
    verified_by: [["authored_behavior_component", "obligation"],
      ["obligation", "resource"]],
    falsified_by: [["obligation", "authored_behavior_component"], ["falsifier"]],
    satisfies_pattern: [NODE_KINDS, ["profile_pattern", "assessment_state"]],
    bound_to_projected_node: [["exact_binding_requirement", "projected_selection",
      "profile_pattern"], ["resource", "projected_selection", "obligation"]],
    captured_with: [["exact_binding_requirement", "resource"],
      ["capture_source_set", "resource"]],
    derived_by: [["resource", "projected_selection"], ["deterministic_transform"]],
    shares_resource: [NODE_KINDS, NODE_KINDS],
    must_preserve_identity: [NODE_KINDS, NODE_KINDS],
    must_co_locate: [NODE_KINDS, NODE_KINDS],
    may_separate: [NODE_KINDS, NODE_KINDS],
    must_not_infer_join: [NODE_KINDS, NODE_KINDS],
    alternative_to: [["planning_boundary", "profile_pattern"],
      ["planning_boundary", "profile_pattern"]],
    outside_guarantee: [NODE_KINDS, ["planning_boundary", "proof_pack"]]
  }[edge.edge_kind];
  if (!endpointKinds[0].includes(source.node_kind) ||
      !endpointKinds[1].includes(target.node_kind)) return false;
  if (edge.edge_kind === "shares_resource" &&
      source.node_kind !== "resource" && target.node_kind !== "resource") return false;
  if (edge.edge_kind === "outside_guarantee" &&
      !(edge.state === "excluded" && edge.effect === "diagnostic_only")) return false;
  if (["must_preserve_identity", "must_co_locate"].includes(edge.edge_kind) &&
      edge.effect === "hard_contraction" && source.pack_instance_id !== null &&
      target.pack_instance_id !== null &&
      source.pack_instance_id !== target.pack_instance_id) return false;
  return true;
}

function validParticipantAttributes(participant, kind) {
  if (!exactKeys(participant.attributes, ATTRIBUTE_KEYS)) return false;
  const roleRule = ROLE_MATRIX[kind]?.[participant.role];
  if (roleRule === undefined) return false;
  for (const key of ATTRIBUTE_KEYS) {
    const value = participant.attributes[key];
    if (roleRule[key] === true) {
      if (!ATTRIBUTE_VALUES[key].includes(value)) return false;
    } else if (value !== null) return false;
  }
  return true;
}

function validTypedAttributes(kind, attributes) {
  const rule = TYPED_ATTRIBUTE_RULES[kind];
  if (rule === undefined || !exactKeys(attributes, Object.keys(rule))) return false;
  return Object.entries(rule).every(([key, allowed]) => allowed === "boolean"
    ? typeof attributes[key] === "boolean" : allowed.includes(attributes[key]));
}

function incidenceMeaningMatches(incidence) {
  return INCIDENCE_SEMANTICS[incidence.incidence_kind].some(
    ([ruleId, sourceClass]) => incidence.derivation.rule_id === ruleId &&
      incidence.derivation.source_class === sourceClass
  );
}

function validateIncidence(incidence, nodes) {
  const keys = ["incidence_id", "incidence_kind", "state", "derivation", "effect",
    "facet", "pack_instance_id", "branch_scope_id", "typed_attributes",
    "participants"];
  if (!exactKeys(incidence, keys) || !validId(incidence.incidence_id) ||
      !INCIDENCE_KINDS.includes(incidence.incidence_kind) ||
      !FACT_STATES.includes(incidence.state) || !validDerivation(incidence.derivation) ||
      incidence.derivation.state_precondition !== incidence.state ||
      !EFFECTS.includes(incidence.effect) || !FACETS.includes(incidence.facet) ||
      !(incidence.pack_instance_id === null || validId(incidence.pack_instance_id)) ||
      !(incidence.branch_scope_id === null || validId(incidence.branch_scope_id)) ||
      !validTypedAttributes(incidence.incidence_kind,
        incidence.typed_attributes) ||
      !Array.isArray(incidence.participants)) return false;
  if (!validateStateEffectTuple({ ...incidence.derivation, state: incidence.state,
    effect: incidence.effect, facet: incidence.facet })) return false;
  if (!incidenceMeaningMatches(incidence)) return false;
  const counts = new Map();
  for (const participant of incidence.participants) {
    if (!exactKeys(participant, ["role", "node_id", "position_path", "multiplicity",
      "attributes"]) || !validId(participant.role) || !nodes.has(participant.node_id) ||
      !Array.isArray(participant.position_path) || participant.position_path.length < 1 ||
      participant.position_path.length > 4 || participant.position_path.some(
        (value) => !Number.isSafeInteger(value) || value < 0
      ) || !Number.isSafeInteger(participant.multiplicity) ||
      participant.multiplicity < 1 ||
      !validParticipantAttributes(participant, incidence.incidence_kind) ||
      !ROLE_NODE_KINDS[incidence.incidence_kind][participant.role]
        .includes(nodes.get(participant.node_id).node_kind)) return false;
    counts.set(participant.role, (counts.get(participant.role) ?? 0) + 1);
  }
  for (const [role, [minimum, maximum]] of Object.entries(
    CARDINALITY[incidence.incidence_kind]
  )) {
    const count = counts.get(role) ?? 0;
    if (count < minimum || count > maximum) return false;
    const positions = incidence.participants.filter((entry) => entry.role === role)
      .map((entry) => entry.position_path[0]);
    if (positions.some((position, index) => position !== index)) return false;
  }
  if ([...counts.keys()].some((role) =>
    !Object.hasOwn(CARDINALITY[incidence.incidence_kind], role))) return false;
  if (incidence.incidence_kind === "logic_gate_branches") {
    const operator = incidence.typed_attributes.operator;
    if (!["all_of", "any_of", "exactly_one"].includes(operator)) return false;
    const scopes = incidence.participants.filter(({ role }) => role === "branch_scope");
    if (scopes.some(({ node_id: id }) => nodes.get(id)?.subtype !== "branch_scope")) {
      return false;
    }
  }
  if (incidence.incidence_kind === "iteration_association") {
    const roleParticipants = incidence.participants.filter(({ role }) =>
      ["iteration_member_role", "association_member_role",
        "association_associated_role"].includes(role));
    if (roleParticipants.some(({ node_id: nodeId }) =>
      nodes.get(nodeId)?.subtype !== "role_binding")) return false;
    const memberOccurrences = new Set(incidence.participants.filter(({ role }) =>
      role === "iteration_member").map(({ position_path: path }) => path[1]));
    const memberRoleOccurrences = new Set(incidence.participants.filter(({ role }) =>
      role === "iteration_member_role").map(({ position_path: path }) => path[1]));
    if (memberOccurrences.size !== memberRoleOccurrences.size ||
        [...memberOccurrences].some((position) =>
          !memberRoleOccurrences.has(position))) return false;
    const associationKeys = new Set(incidence.participants.filter(({ role }) =>
      role === "association").map(({ position_path: path }) => `${path[1]}:${path[2]}`));
    const memberRoleKeys = new Set(incidence.participants.filter(({ role }) =>
      role === "association_member_role").map(({ position_path: path }) =>
      `${path[1]}:${path[2]}`));
    const associatedRoleKeys = new Set(incidence.participants.filter(({ role }) =>
      role === "association_associated_role").map(({ position_path: path }) =>
      `${path[1]}:${path[2]}`));
    if (memberRoleKeys.size !== associatedRoleKeys.size ||
        [...memberRoleKeys].some((key) => !associatedRoleKeys.has(key)) ||
        [...associationKeys].some((key) => !memberRoleKeys.has(key))) return false;
  }
  if (incidence.incidence_kind === "exact_binding_source_result") {
    const requirements = incidence.participants.filter(({ role }) =>
      role === "source_requirement");
    const sources = incidence.participants.filter(({ role }) =>
      role === "captured_source");
    const requirementPositions = requirements.map(({ position_path: path }) => path[0]);
    const sourcePositions = sources.map(({ position_path: path }) => path[0]);
    if (requirementPositions.length !== sourcePositions.length ||
        requirementPositions.some((position, index) =>
          position !== sourcePositions[index]) ||
        requirements.some(({ multiplicity }) => multiplicity !== 1) ||
        sources.some(({ multiplicity }) => multiplicity !== 1) ||
        new Set(requirements.map(({ node_id: id }) => id)).size !==
          requirements.length ||
        new Set(sources.map(({ node_id: id }) => id)).size !== sources.length) {
      return false;
    }
  }
  if (incidence.incidence_kind === "non_join_boundary") {
    if (!incidence.participants.some(({ role }) => role === "left_side") ||
        !incidence.participants.some(({ role }) => role === "right_side")) return false;
  }
  if (incidence.branch_scope_id !== null && !nodes.has(incidence.branch_scope_id)) {
    return false;
  }
  if (incidence.pack_instance_id !== null && incidence.participants.some(
    ({ node_id: id }) => nodes.get(id).pack_instance_id !== null &&
      nodes.get(id).pack_instance_id !== incidence.pack_instance_id &&
      incidence.incidence_kind !== "non_join_boundary"
  )) return false;
  return true;
}

function validateConstraint(constraint, incidences) {
  const keys = ["constraint_id", "constraint_kind", "facet", "state", "derivation",
    "incidence_ids", "normalized_effect"];
  const kinds = ["must_co_locate", "must_preserve_identity", "must_not_infer_join",
    "ordered_sequence", "alternative_group", "universal_association",
    "exact_capture_occurrence", "deterministic_projection_source_set"];
  return exactKeys(constraint, keys) && validId(constraint.constraint_id) &&
    kinds.includes(constraint.constraint_kind) && FACETS.includes(constraint.facet) &&
    FACT_STATES.includes(constraint.state) && validDerivation(constraint.derivation) &&
    constraint.derivation.state_precondition === constraint.state &&
    Array.isArray(constraint.incidence_ids) && constraint.incidence_ids.length > 0 &&
    new Set(constraint.incidence_ids).size === constraint.incidence_ids.length &&
    constraint.incidence_ids.every((id) => incidences.has(id)) &&
    EFFECTS.includes(constraint.normalized_effect) &&
    validateStateEffectTuple({ ...constraint.derivation, state: constraint.state,
      effect: constraint.normalized_effect, facet: constraint.facet });
}

function validateUnresolvedFact(fact, nodes) {
  const keys = ["fact_id", "state", "classification", "source_class",
    "source_digest", "subject_node_ids", "blocks", "only_permitted_effects"];
  return exactKeys(fact, keys) && validId(fact.fact_id) &&
    UNRESOLVED_STATES.includes(fact.state) &&
    ["unresolved_constraint", "hard_invalidity", "review_required_boundary",
      "diagnostic_boundary"].includes(fact.classification) &&
    validId(fact.source_class) && validSha(fact.source_digest) &&
    Array.isArray(fact.subject_node_ids) &&
    new Set(fact.subject_node_ids).size === fact.subject_node_ids.length &&
    fact.subject_node_ids.every((id) => nodes.has(id)) &&
    Array.isArray(fact.blocks) && fact.blocks.length > 0 &&
    fact.blocks.every((value) => ["resolved_graph", "anonymization",
      "candidate_generation", "comparison", "affected_comparison_field"].includes(value)) &&
    JSON.stringify(fact.only_permitted_effects) ===
      '["diagnostic_only","unresolved_constraint"]';
}

function validateResolvedCarrier(value) {
  const diagnostics = [];
  const topKeys = ["carrier_version", "digest_algorithm", "canonical_order",
    "authority", "input_authority", "nodes", "binary_edges", "typed_incidences",
    "constraints", "unresolved_facts", "resource_accounting"];
  if (!exactKeys(value, topKeys) || value.carrier_version !== CARRIER_VERSION ||
      value.digest_algorithm !== "sha256-domain-separated-canonical-json-v1" ||
      value.canonical_order !== "utf16-code-unit-by-declared-composite-key-v1" ||
      !validAuthority(value.authority) || !Array.isArray(value.nodes) ||
      !Array.isArray(value.binary_edges) || !Array.isArray(value.typed_incidences) ||
      !Array.isArray(value.constraints) || !Array.isArray(value.unresolved_facts)) {
    return frozenClone({ valid: false, diagnostics: [{ code: "PA_INVALID_CARRIER_SHAPE" }] });
  }
  const nodes = new Map();
  for (const node of value.nodes) {
    if (!validateNode(node) || nodes.has(node.node_id)) diagnostics.push({
      code: "PA_INVALID_NODE", subject: node?.node_id ?? null
    });
    else nodes.set(node.node_id, node);
  }
  const edgeIds = new Set();
  for (const edge of value.binary_edges) {
    if (!validateEdge(edge, nodes) || edgeIds.has(edge.edge_id)) diagnostics.push({
      code: "PA_INVALID_STATE_EFFECT", subject: edge?.edge_id ?? null
    });
    edgeIds.add(edge?.edge_id);
  }
  const incidences = new Set();
  for (const incidence of value.typed_incidences) {
    if (!validateIncidence(incidence, nodes) || incidences.has(incidence.incidence_id)) {
      diagnostics.push({ code: "PA_INVALID_INCIDENCE", subject:
        incidence?.incidence_id ?? null });
    }
    incidences.add(incidence?.incidence_id);
  }
  const constraintIds = new Set();
  for (const constraint of value.constraints) {
    if (!validateConstraint(constraint, incidences) ||
        constraintIds.has(constraint.constraint_id)) diagnostics.push({
      code: "PA_INVALID_CONSTRAINT", subject: constraint?.constraint_id ?? null
    });
    constraintIds.add(constraint?.constraint_id);
  }
  for (const fact of value.unresolved_facts) if (!validateUnresolvedFact(fact, nodes)) {
    diagnostics.push({ code: "PA_INVALID_UNRESOLVED_FACT", subject: fact?.fact_id ?? null });
  }
  const participantCount = value.typed_incidences.reduce((sum, incidence) =>
    sum + incidence.participants.length, 0);
  const accounting = value.resource_accounting;
  if (!exactKeys(accounting, ["verified_input_bytes", "node_count",
    "binary_edge_count", "typed_incidence_participant_count",
    "universal_occurrence_count", "selected_pack_count"]) ||
    accounting.node_count !== value.nodes.length ||
    accounting.binary_edge_count !== value.binary_edges.length ||
    accounting.typed_incidence_participant_count !== participantCount) diagnostics.push({
    code: "PA_RESOURCE_ACCOUNTING_MISMATCH"
  });
  return frozenClone({ valid: diagnostics.length === 0, diagnostics });
}

function sortCarrierCollections(value) {
  value.nodes.sort((left, right) => compareCodeUnits(left.node_id, right.node_id));
  value.binary_edges.sort((left, right) => compareCodeUnits(left.edge_id, right.edge_id));
  value.typed_incidences.sort((left, right) =>
    compareCodeUnits(left.incidence_id, right.incidence_id));
  value.constraints.sort((left, right) =>
    compareCodeUnits(left.constraint_id, right.constraint_id));
  value.unresolved_facts.sort((left, right) =>
    compareCodeUnits(left.fact_id, right.fact_id));
  return value;
}

function createResolvedCarrier(fields) {
  const value = sortCarrierCollections(structuredClone({
    carrier_version: CARRIER_VERSION,
    digest_algorithm: "sha256-domain-separated-canonical-json-v1",
    canonical_order: "utf16-code-unit-by-declared-composite-key-v1",
    authority: {
      kind: "non_authoritative_planning_input", authoritative: false,
      mandatory_exclusions: MANDATORY_AUTHORITY_EXCLUSIONS,
      informational_limitations: [
        "Unit 3 owns constraint normalization and partition selection.",
        "Planning topology carries no proof, runtime, readiness, or mutation authority."
      ]
    },
    ...fields
  }));
  const validation = validateResolvedCarrier(value);
  if (!validation.valid) {
    const error = new TypeError("resolved proof-aware carrier is semantically invalid");
    error.diagnostics = validation.diagnostics;
    throw error;
  }
  return frozenClone(value);
}

function resolvedCarrierDigest(value) {
  const validation = validateResolvedCarrier(value);
  if (!validation.valid) throw new TypeError("cannot digest invalid resolved carrier");
  return domainSeparatedDigest(CARRIER_DOMAIN, value);
}

function checkedWeightAdd(left, right) {
  const result = {};
  for (const key of ["behavior", "verification", "capture", "serialization"]) {
    const value = left[key] + right[key];
    if (!Number.isSafeInteger(value) || value > 0xffffffffffffffff) {
      throw new RangeError("PA_WEIGHT_OVERFLOW");
    }
    result[key] = value;
  }
  return result;
}

export {
  ATTRIBUTE_KEYS,
  CARRIER_DOMAIN,
  CARRIER_VERSION,
  EDGE_KINDS,
  EFFECTS,
  FACETS,
  FACT_STATES,
  INCIDENCE_KINDS,
  NODE_KINDS,
  NODE_SUBTYPES,
  ROLE_MATRIX,
  UNRESOLVED_STATES,
  canonicalJsonBytes,
  checkedWeightAdd,
  createResolvedCarrier,
  resolvedCarrierDigest,
  validateResolvedCarrier
};
