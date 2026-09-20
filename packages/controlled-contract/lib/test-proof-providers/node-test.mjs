

import { deepFreeze, falsifierTargetConstraint } from "./shared.mjs";

function nodeModuleSubstitutionWitness(payload, testId, mutation) {
  return payload?.mechanism === "module_substitution" &&
    payload.strategy === mutation.strategy && payload.mutation_id === mutation.mutation_id &&
    payload.target_module_path === mutation.module_path && payload.target_test_id === testId &&
    typeof payload.witness_identity === "string" && payload.witness_identity.length > 0 &&
    payload.observation?.selected_test_only === true && payload.observation?.observed === true;
}

function nodeCoverageTraversalWitness(payload, testId, row) {
  return payload?.mechanism === "node_test_v8_coverage" && payload.target_test_id === testId &&
    payload.observed === true && payload.target_pass_observed === true &&
    payload.observable_seam === row.observation_seam &&
    typeof payload.module_path === "string" &&
    Array.isArray(payload.covered_module_paths) &&
    payload.covered_module_paths.includes(payload.module_path);
}

export default deepFreeze({
  family_id: "node-test",
  runtime: { name: "node-test", runner_id: "runner.node-test", runner: "node:test",
    languages: ["javascript"], toolchains: ["node"], dependency_ecosystem: "npm" },
  selector: { kind: "node_test_name", qualified: false, grammar: null },
  source_suffixes: [".js", ".cjs", ".mjs"],
  providers: [{
    provider_id: "launcher.node-test",
    provider_version: "1.0.0",
    selector_kind: "node_test_name",
    capabilities: ["candidate_execution"],
    observation_mechanisms: ["node_test_structured_events"],
    observation_seams: ["node_test_event"],
    evidence_artifact_types: ["structured_test_result"],
    falsifier_strategies: [],
    boundary_kinds: []
  }, {
    provider_id: "launcher.node-test-module-fault",
    provider_version: "2.0.0",
    selector_kind: "node_test_name",
    capabilities: ["falsifier_execution"],
    observation_mechanisms: ["node_test_structured_events", "module_substitution"],
    observation_seams: ["node_test_failure_event"],
    evidence_artifact_types: ["falsifier_result", "structured_test_result"],
    falsifier_strategies: ["dependency_failure", "forced_invocation"],
    boundary_kinds: ["module"]
  }, {
    provider_id: "launcher.node-test-v8-coverage",
    provider_version: "1.0.0",
    selector_kind: "node_test_name",
    capabilities: ["boundary_traversal"],
    observation_mechanisms: ["node_test_v8_coverage"],
    observation_seams: ["node_test_structured_assertion"],
    evidence_artifact_types: ["boundary_trace", "structured_test_result"],
    falsifier_strategies: [],
    boundary_kinds: ["module"]
  }],
  witness_validators: {
    falsifier_result: { module_substitution: nodeModuleSubstitutionWitness },
    boundary_trace: { node_test_v8_coverage: nodeCoverageTraversalWitness }
  },
  falsifier_target_constraints: {
    module_substitution: falsifierTargetConstraint({
      target: "the JavaScript module module_path loaded by the selected test",
      shape: "dependency_failure makes the substituted module fail; forced_invocation also " +
        "names entry_export and an operation {module_path, export_name} in a different " +
        "JavaScript module; a missing, non-callable, misnamed or unreadable export is refused",
      refusalCodes: ["test_proof_forced_invocation_export_identity_mismatch"]
    })
  }
});
