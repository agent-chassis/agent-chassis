import {
  canonicalValue,
  commitment,
  domainSeparatedDigest
} from "./proof-aware-digest.mjs";
import { POLICY_RESOURCE_LIMITS, RESOURCE_LIMITS } from "./resource-policy.mjs";

const POLICY_VERSION =
  "controlled-contract-planning-state-effect-policy.experimental.v1";
const POLICY_DOMAIN = "controlled-contract:planning-state-effect-policy:v1";
const IMPLEMENTATION_DOMAIN =
  "controlled-contract:proof-aware-planning-implementation:v1";

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

const MANDATORY_AUTHORITY_EXCLUSIONS = Object.freeze({
  proof_applicability: false,
  optimality: false,
  correct_ownership: false,
  runtime_truth: false,
  evidence_authority: false,
  cce_consequences: false,
  readiness: false,
  status_transition_authority: false,
  dispatch_authority: false,
  mutation_or_publication_permission: false
});

const RULES = deepFreeze({
  structural_behavior_cohesion: Object.freeze({
    source_classes: ["authored_behavior_relation"], states: ["established"],
    effects: ["behavior_cohesion"], facets: ["behavior_cohesion"]
  }),
  structural_directed_cut: Object.freeze({
    source_classes: ["authored_dependency", "authored_precedence"],
    states: ["established"], effects: ["directed_cut"],
    facets: ["implementation_ownership"]
  }),
  structural_overlay: Object.freeze({
    source_classes: ["authored_proposition", "authored_relation_instance",
      "authored_collection_instance", "authored_applicability"],
    states: ["established"], effects: ["overlay_only"],
    facets: ["behavior_cohesion", "implementation_ownership"]
  }),
  verification_overlay: Object.freeze({
    source_classes: ["verification_relation"],
    states: ["established", "proven", "satisfied", "inactive", "not_proven",
      "not_assessed", "not_applicable", "ambiguous", "excluded", "residue",
      "missing"], effects: ["overlay_only"], facets: ["verification_ownership"]
  }),
  proof_pattern_overlay: Object.freeze({
    source_classes: ["profile_pattern", "falsifier_relation",
      "projected_selection"],
    states: ["proven", "satisfied", "inactive", "not_proven", "not_assessed",
      "not_applicable", "ambiguous", "excluded", "residue", "missing"],
    effects: ["overlay_only"],
    facets: ["proof_atomicity", "verification_ownership"]
  }),
  proven_proof_atomicity: Object.freeze({
    source_classes: ["same_occurrence_profile_requirement"],
    states: ["proven", "satisfied"],
    effects: ["proof_atomicity", "hard_contraction"],
    facets: ["proof_atomicity"]
  }),
  proven_capture_atomicity: Object.freeze({
    source_classes: ["same_cycle_exact_binding"], states: ["proven"],
    effects: ["capture_atomicity", "hard_contraction"],
    facets: ["exact_capture_atomicity"]
  }),
  explicit_separation: Object.freeze({
    source_classes: ["authored_separation", "policy_separation"],
    states: ["established", "proven"], effects: ["separation_signal"],
    facets: ["implementation_ownership", "verification_ownership",
      "evidence_acquisition"]
  }),
  explicit_non_join: Object.freeze({
    source_classes: ["independent_pack_context", "explicit_identity_exclusion",
      "authority_boundary"], states: ["established", "proven", "excluded"],
    effects: ["never_group"], facets: ["authority_boundary"]
  }),
  declared_alternative: Object.freeze({
    source_classes: ["exclusive_logic_gate_branch"],
    states: ["established", "proven", "satisfied", "inactive"],
    effects: ["separation_signal"], facets: ["proof_atomicity"]
  }),
  inclusive_alternative_overlay: Object.freeze({
    source_classes: ["inclusive_logic_gate_branch"],
    states: ["established", "proven", "satisfied", "inactive"],
    effects: ["overlay_only"], facets: ["proof_atomicity"]
  }),
  exclusion_diagnostic: Object.freeze({
    source_classes: ["pack_exclusion"], states: ["excluded"],
    effects: ["diagnostic_only"], facets: ["authority_boundary"]
  }),
  unresolved_diagnostic: Object.freeze({
    source_classes: ["unresolved_assessment", "ambiguous_selection", "residue",
      "missing_lossless_fact"],
    states: ["not_proven", "not_assessed", "not_applicable", "ambiguous",
      "residue", "missing", "invalid"],
    effects: ["diagnostic_only", "unresolved_constraint"],
    facets: ["authority_boundary"]
  }),
  resource_affinity: Object.freeze({
    source_classes: ["policy_authorized_write_incidence"],
    states: ["established", "proven"], effects: ["merge_signal"],
    facets: ["implementation_ownership", "verification_ownership",
      "evidence_acquisition"]
  })
});

const PLANNING_POLICY = Object.freeze({
  policy_version: POLICY_VERSION,
  digest_domain: POLICY_DOMAIN,
  state_effect_rules: Object.freeze(Object.fromEntries(Object.entries(RULES).map(
    ([ruleId, rule]) => [ruleId, Object.freeze({
      rule_id: ruleId,
      source_classes: Object.freeze([...rule.source_classes]),
      permitted_states: Object.freeze([...rule.states]),
      permitted_effects: Object.freeze([...rule.effects]),
      permitted_facets: Object.freeze([...rule.facets]),
      cross_pack_identity_join: false
    })]
  ))),
  resource_limits: POLICY_RESOURCE_LIMITS,
  mandatory_authority_exclusions: MANDATORY_AUTHORITY_EXCLUSIONS
});

const IMPLEMENTATION_DESCRIPTOR = Object.freeze({
  implementation_version:
    "controlled-contract-proof-aware-planning-constructor.experimental.v2-unit2",
  unit: 2,
  capabilities: Object.freeze([
    "complete_unit1_cycle_validation", "resolved_carrier_construction",
    "state_effect_validation", "identifier_invariant_anonymization",
    "unit3_orbit_input"
  ]),
  excludes: Object.freeze([
    "constraint_normalization", "partitioning", "proposal_comparison",
    "publication", "readiness", "dispatch", "mutation"
  ]),
  mandatory_authority_exclusions: MANDATORY_AUTHORITY_EXCLUSIONS
});

const PLANNING_POLICY_IDENTITY = Object.freeze(commitment(
  POLICY_DOMAIN, PLANNING_POLICY
));
const IMPLEMENTATION_IDENTITY = Object.freeze(commitment(
  IMPLEMENTATION_DOMAIN, IMPLEMENTATION_DESCRIPTOR
));

function sameCanonical(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function validatePackagePolicy(policy, identity) {
  return sameCanonical(policy, PLANNING_POLICY) &&
    sameCanonical(identity, PLANNING_POLICY_IDENTITY) &&
    identity?.digest === domainSeparatedDigest(POLICY_DOMAIN, policy);
}

function validateImplementationIdentity(descriptor, identity) {
  return sameCanonical(descriptor, IMPLEMENTATION_DESCRIPTOR) &&
    sameCanonical(identity, IMPLEMENTATION_IDENTITY) &&
    identity?.digest === domainSeparatedDigest(IMPLEMENTATION_DOMAIN, descriptor);
}

function validateStateEffectTuple({ rule_id: ruleId, source_class: sourceClass,
  state, effect, facet, source_pack_instance_id: sourcePack = null,
  target_pack_instance_id: targetPack = null }) {
  const rule = RULES[ruleId];
  if (!rule || !rule.source_classes.includes(sourceClass) ||
      !rule.states.includes(state) || !rule.effects.includes(effect) ||
      !rule.facets.includes(facet)) return false;
  return sourcePack === null || targetPack === null || sourcePack === targetPack ||
    !["behavior_cohesion", "proof_atomicity", "capture_atomicity",
      "hard_contraction", "merge_signal"].includes(effect);
}

function resolveUnit2Limits(injected = {}) {
  const allowed = new Set(Object.keys(RESOURCE_LIMITS));
  if (Object.keys(injected).some((key) => !allowed.has(key))) {
    throw new TypeError("unknown Unit 2 resource limit override");
  }
  return Object.freeze(Object.fromEntries(Object.entries(RESOURCE_LIMITS).map(
    ([key, policy]) => {
      const candidate = injected[key] ?? policy.limit;
      if (!Number.isSafeInteger(candidate) || candidate < 1 ||
          candidate > policy.limit) throw new TypeError(
        `invalid bounded Unit 2 limit override: ${key}`
      );
      return [key, Object.freeze({ ...policy, limit: candidate })];
    }
  )));
}

export {
  IMPLEMENTATION_DESCRIPTOR,
  IMPLEMENTATION_DOMAIN,
  IMPLEMENTATION_IDENTITY,
  MANDATORY_AUTHORITY_EXCLUSIONS,
  PLANNING_POLICY,
  PLANNING_POLICY_IDENTITY,
  POLICY_DOMAIN,
  POLICY_VERSION,
  POLICY_RESOURCE_LIMITS,
  RESOURCE_LIMITS,
  RULES,
  resolveUnit2Limits,
  validateImplementationIdentity,
  validatePackagePolicy,
  validateStateEffectTuple
};
