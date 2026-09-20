

import { NATIVE_INSTRUMENTATION_REFUSAL_CODE, SCALAR_RETURN_REFUSAL_REASONS, canonicalJson,
  deepFreeze, falsifierTargetConstraint, isPositiveCount, literalRestGrammar } from "./shared.mjs";

function pythonSelectedCallTraversalWitness(payload, testId) {
  if (payload?.mechanism !== "python_call_trace" || payload.target_test_id !== testId ||
      payload.observed !== true || payload.target_pass_observed !== true ||
      typeof payload.module_path !== "string" || typeof payload.source_digest !== "string" ||
      !Array.isArray(payload.calls)) return false;
  return payload.calls.some((call) => call?.phase === "call" && call.test_id === testId &&
    call.code?.kind === "function" &&
    call.code?.filename === payload.module_path && call.source_digest === payload.source_digest &&
    isPositiveCount(call.entries));
}

function pythonScalarReturnWitness(payload, testId, mutation) {
  const phases = payload?.selected_phases;
  return payload?.mechanism === "python_scalar_return_substitution" &&
    payload.strategy === "result_inversion" && payload.target_test_id === testId &&
    payload.target_module_path === mutation.module_path && payload.observed === true &&
    phases?.setup === "passed" && phases.call === "failed" &&
    payload.call_assertion_failure === true && isPositiveCount(payload.mutated_returns_in_call) &&
    payload.mutated_code?.filename === payload.target_module_path &&
    payload.mutated_code?.name === payload.function_name &&
    typeof payload.original_type === "string" && typeof payload.replacement_type === "string" &&
    (payload.original_type !== payload.replacement_type ||
      canonicalJson(payload.original) !== canonicalJson(payload.replacement));
}

export const PYTHON_WITNESS_VALIDATORS = deepFreeze({
  falsifier_result: { python_scalar_return_substitution: pythonScalarReturnWitness },
  boundary_trace: { python_call_trace: pythonSelectedCallTraversalWitness }
});

export const PYTHON_FALSIFIER_TARGET_CONSTRAINTS = deepFreeze({
  python_scalar_return_substitution: falsifierTargetConstraint({
    target: "the one top-level function named function_name in module_path",
    shape: "a synchronous function whose body, apart from a leading docstring, is exactly one " +
      "return of one scalar literal (string, number, boolean or None); composite, computed, " +
      "escaped, triple-quoted or multi-statement returns are refused",
    replacement: "one JSON scalar different from the returned literal",
    refusalCodes: [NATIVE_INSTRUMENTATION_REFUSAL_CODE],
    refusalReasons: SCALAR_RETURN_REFUSAL_REASONS
  })
});

export default deepFreeze({
  family_id: "pytest",
  runtime: { name: "pytest", runner_id: "runner.pytest", runner: "pytest",
    languages: ["python"], toolchains: ["python"], dependency_ecosystem: "python" },
  selector: { kind: "pytest_node_id", qualified: true, grammar: literalRestGrammar([".py"]) },
  source_suffixes: [".py"],
  providers: [{
    provider_id: "launcher.pytest",
    provider_version: "1.0.0",
    selector_kind: "pytest_node_id",
    capabilities: ["candidate_execution"],
    observation_mechanisms: ["pytest_phase_events"],
    observation_seams: ["pytest_phase_report"],
    evidence_artifact_types: ["structured_test_result", "native_phase_observation"],
    falsifier_strategies: [],
    boundary_kinds: []
  }, {
    provider_id: "launcher.pytest-scalar-return",
    provider_version: "1.0.0",
    selector_kind: "pytest_node_id",
    capabilities: ["falsifier_execution"],
    observation_mechanisms: ["pytest_phase_events", "python_scalar_return_substitution"],
    observation_seams: ["pytest_selected_call_failure"],
    evidence_artifact_types: ["falsifier_result", "structured_test_result"],
    falsifier_strategies: ["result_inversion"],
    boundary_kinds: ["function"]
  }, {
    provider_id: "launcher.pytest-call-trace",
    provider_version: "1.0.0",
    selector_kind: "pytest_node_id",
    capabilities: ["boundary_traversal"],
    observation_mechanisms: ["python_call_trace"],
    observation_seams: ["pytest_selected_call"],
    evidence_artifact_types: ["boundary_trace", "structured_test_result"],
    falsifier_strategies: [],
    boundary_kinds: ["module"]
  }],
  witness_validators: PYTHON_WITNESS_VALIDATORS,
  falsifier_target_constraints: PYTHON_FALSIFIER_TARGET_CONSTRAINTS
});
