const EVALUATOR_IMPLEMENTATION_ID =
  "proof.verification.test-validity.execution-evaluator";
const EVALUATOR_IMPLEMENTATION_VERSION = "9.0.0";
const MUTATION_OUTCOMES = new Set(["detected", "survived", "unavailable", "unevaluable"]);

function diagnostic(code, field) {
  return Object.freeze({ code, field });
}

function sameInventory(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((testId, index) => testId === right[index]);
}

function refuse(message) {
  throw Object.assign(new Error(message), { code: "proof_evaluator.semantic_facts_invalid.v1" });
}

function falsifierDiagnostics(facts) {
  const falsifiers = facts.falsifiers;
  const outcomes = falsifiers.observations.map(({ outcome }) => outcome);
  if (outcomes.some((outcome) => !MUTATION_OUTCOMES.has(outcome)) ||
      typeof falsifiers.declared_unsupported !== "boolean") {
    refuse("post-delivery test-validity requires classified falsifier observations");
  }
  if (facts.candidate.passed !== true) return [];
  if (falsifiers.complete !== true || outcomes.includes("unevaluable") ||
      (falsifiers.expected_ids.length === 0 && !falsifiers.declared_unsupported)) {
    refuse("unevaluable falsifier evidence is not executable and cannot be evaluated");
  }
  return outcomes.includes("survived") ? [diagnostic(
    "test_validity_execution_falsifier_inert", "/facts/falsifiers/observations")] : [];
}

function evaluateExecutionTestValidity({ semantic_facts: semanticFacts }) {
  if (semanticFacts?.schema_version !==
      "controlled-contract-test-proof-semantic-facts.v1" ||
      semanticFacts.status !== "facts") {
    refuse("post-delivery test-validity requires authenticated normalized semantic facts");
  }
  const facts = semanticFacts.facts;
  const diagnostics = [];
  if (facts.candidate.passed !== true) diagnostics.push(diagnostic(
    "test_validity_execution_candidate_failed", "/facts/candidate/status"));
  if (!sameInventory(facts.inventory.declared_test_ids,
    facts.inventory.discovered_test_ids)) diagnostics.push(diagnostic(
    "test_validity_execution_selected_test_not_discovered",
    "/facts/inventory/discovered_test_ids"));
  if (!sameInventory(facts.inventory.declared_test_ids,
    facts.inventory.executed_test_ids)) diagnostics.push(diagnostic(
    "test_validity_execution_selected_test_not_executed",
    "/facts/inventory/executed_test_ids"));
  if (facts.inventory.skipped_test_ids.length > 0) diagnostics.push(diagnostic(
    "test_validity_execution_selected_test_skipped",
    "/facts/inventory/skipped_test_ids"));
  diagnostics.push(...falsifierDiagnostics(facts));
  if (facts.traversal.complete !== true) diagnostics.push(diagnostic(
    "test_validity_execution_traversal_population_incomplete", "/facts/traversal"));
  if (facts.traversal.all_proven !== true) diagnostics.push(diagnostic(
    "test_validity_execution_traversal_unproven", "/facts/traversal/observations"));
  if (facts.prohibited_shortcuts.violated.length > 0) diagnostics.push(diagnostic(
    "test_validity_execution_prohibited_shortcut", "/facts/prohibited_shortcuts/violated"));
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
  evaluateExecutionTestValidity
};
