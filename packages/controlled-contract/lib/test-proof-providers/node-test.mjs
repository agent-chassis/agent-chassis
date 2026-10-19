

import { deepFreeze, falsifierTargetConstraint } from "./shared.mjs";

export const CLOSED_NODE_TEST_TARGET_SCHEMA = Object.freeze({
  type: "string",
  maxLength: 4096,
  pattern: "^(?!-)(?!\\.{1,2}/)[A-Za-z0-9_.-]+(?:/(?!\\.{1,2}/)[A-Za-z0-9_.-]+)*\\.mjs$"
});
export const CLOSED_NODE_TEST_TARGET_STATEMENT =
  "one canonical repository-relative .mjs node:test module path";
const closedNodeTestTargetPattern = new RegExp(CLOSED_NODE_TEST_TARGET_SCHEMA.pattern, "u");
export function isClosedNodeTestTarget(value) {
  return typeof value === CLOSED_NODE_TEST_TARGET_SCHEMA.type &&
    value.length <= CLOSED_NODE_TEST_TARGET_SCHEMA.maxLength && closedNodeTestTargetPattern.test(value);
}

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
      refusalCodes: ["test_proof_forced_invocation_export_identity_mismatch"],
      examples: [
        {
          strategy: "dependency_failure",
          language: "javascript",
          supported: {
            code: "export function dependency() { return 42; }\n",
            falsification: {
              strategy: "dependency_failure",
              module_path: "src/dependency.mjs"
            },
            why: "The selected test invokes this callable dependency; substitution makes that call throw the launcher failure."
          },
          rejected: {
            code: "export const dependency = 42;\n",
            falsification: {
              strategy: "dependency_failure",
              module_path: "src/dependency.mjs"
            },
            reason: "no_callable_dependency_invocation",
            why: "Reading this non-callable value cannot witness an invocation of the throwing replacement. Substitution preserves non-callable exports; this is insufficient detection evidence, not a source-shape refusal."
          }
        },
        {
          strategy: "forced_invocation",
          language: "javascript",
          supported: {
            code: "export function run() { return 42; }\n",
            operation_code: "export function forbidden() { return 0; }\n",
            falsification: {
              strategy: "forced_invocation",
              module_path: "src/entry.mjs",
              entry_export: "run",
              operation: {
                module_path: "src/operation.mjs",
                export_name: "forbidden"
              }
            },
            why: "The named entry and operation are callable functions with matching names in distinct modules. The launcher invokes the operation after the first original entry return, without arguments."
          },
          rejected: {
            code: "export function run() { return 42; }\n",
            operation_code: "export const forbidden = 0;\n",
            falsification: {
              strategy: "forced_invocation",
              module_path: "src/entry.mjs",
              entry_export: "run",
              operation: {
                module_path: "src/operation.mjs",
                export_name: "forbidden"
              }
            },
            reason: "not_function",
            why: "The named operation export is not callable; the launcher reports test_proof_forced_invocation_export_identity_mismatch for that export, not an unavailable runner family."
          }
        }
      ]
    })
  }
});
