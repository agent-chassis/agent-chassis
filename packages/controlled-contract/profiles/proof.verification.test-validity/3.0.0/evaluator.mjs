const EVALUATOR_IMPLEMENTATION_ID =
  "proof.verification.test-validity.post-delivery-evaluator";
const EVALUATOR_IMPLEMENTATION_VERSION = "3.0.0";

function diagnostic(code, field) {
  return Object.freeze({ code, field });
}

function evaluatePostDeliveryTestValidity({ semantic_facts: semanticFacts }) {
  if (semanticFacts?.schema_version !==
      "controlled-contract-test-proof-semantic-facts.v1" ||
      semanticFacts.status !== "facts") {
    throw Object.assign(new Error(
      "post-delivery test-validity requires authenticated normalized semantic facts"
    ), { code: "proof_evaluator.semantic_facts_invalid.v1" });
  }
  const facts = semanticFacts.facts;
  const diagnostics = [];
  if (facts.candidate.passed !== true) diagnostics.push(diagnostic(
    "test_validity_post_delivery_candidate_failed", "/facts/candidate/status"));
  if (facts.inventory.newly_skipped_test_ids.length > 0) diagnostics.push(diagnostic(
    "test_validity_post_delivery_newly_skipped", "/facts/inventory/newly_skipped_test_ids"));
  if (facts.inventory.unexpected_test_ids.length > 0) diagnostics.push(diagnostic(
    "test_validity_post_delivery_unexpected_test", "/facts/inventory/unexpected_test_ids"));
  if (facts.falsifiers.complete !== true) diagnostics.push(diagnostic(
    "test_validity_post_delivery_falsifier_population_incomplete", "/facts/falsifiers"));
  if (facts.falsifiers.all_detected !== true) diagnostics.push(diagnostic(
    "test_validity_post_delivery_falsifier_inert", "/facts/falsifiers/observations"));
  if (facts.traversal.complete !== true) diagnostics.push(diagnostic(
    "test_validity_post_delivery_traversal_population_incomplete", "/facts/traversal"));
  if (facts.traversal.all_proven !== true) diagnostics.push(diagnostic(
    "test_validity_post_delivery_traversal_unproven", "/facts/traversal/observations"));
  if (facts.prohibited_shortcuts.violated.length > 0) diagnostics.push(diagnostic(
    "test_validity_post_delivery_prohibited_shortcut", "/facts/prohibited_shortcuts/violated"));
  return Object.freeze({
    satisfaction: diagnostics.length === 0 ? "satisfied" : "unsatisfied",
    diagnostics: Object.freeze(diagnostics),
    semantic_judgment: "exact_pack_evaluator",
    authority: "non_authoritative"
  });
}

export {
  EVALUATOR_IMPLEMENTATION_ID,
  EVALUATOR_IMPLEMENTATION_VERSION,
  evaluatePostDeliveryTestValidity
};
