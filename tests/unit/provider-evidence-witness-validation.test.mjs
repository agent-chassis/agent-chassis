

import assert from "node:assert/strict";
import test from "node:test";

import { testProofWitnessValidator } from
  "../../packages/controlled-contract/lib/test-proof-provider-registry.mjs";

const TEST_ID = `test-${"a".repeat(64)}`;
const mutation = { mutation_id: "mutation-sample", strategy: "dependency_failure",
  mechanism: "module_substitution", target_kind: "module", module_path: "lib/sample.mjs", observed: true };
const nodeFalsifier = () => ({ mechanism: "module_substitution", strategy: "dependency_failure",
  mutation_id: "mutation-sample", target_module_path: "lib/sample.mjs", target_test_id: TEST_ID,
  witness_identity: "w".repeat(64),
  observation: { dependency_invocation_count: 1, reached_assertion: true, selected_test_only: true,
    observed: true } });
const nodeTraversal = () => ({ mechanism: "node_test_v8_coverage", boundary_kind: "module",
  module_path: "lib/sample.mjs", observable_seam: "node_test_structured_assertion",
  target_test_id: TEST_ID, target_pass_observed: true, observed: true,
  covered_module_paths: ["lib/sample.mjs"] });
const pythonTraversal = () => ({ mechanism: "python_call_trace", target_test_id: TEST_ID,
  observed: true, target_pass_observed: true, module_path: "pkg/mod.py", source_digest: "sha256:x",
  calls: [{ phase: "call", test_id: TEST_ID, code: { kind: "function", filename: "pkg/mod.py" },
    source_digest: "sha256:x", entries: 1 }] });
const pythonFalsifier = () => ({ mechanism: "python_scalar_return_substitution",
  strategy: "result_inversion", target_test_id: TEST_ID, target_module_path: "pkg/mod.py",
  observed: true, selected_phases: { setup: "passed", call: "failed" }, call_assertion_failure: true,
  mutated_returns_in_call: 1, mutated_code: { filename: "pkg/mod.py", name: "value" },
  function_name: "value", original_type: "int", replacement_type: "int", original: 1, replacement: 2 });

function assertRequired(validator, valid, context, mutations) {
  assert.equal(validator(valid(), TEST_ID, context), true);
  assert.equal(validator(valid(), `test-${"b".repeat(64)}`, context), false, "cross-test witness");
  for (const [label, mutate] of Object.entries(mutations)) {
    const payload = valid();
    mutate(payload);
    assert.equal(validator(payload, TEST_ID, context), false, label);
  }
  assert.equal(validator(null, TEST_ID, context), false);
  assert.equal(validator({ fixture: "placeholder" }, TEST_ID, context), false);
}

test("every credit-bearing provider mechanism requires its witness validator", () => {
  assert.equal(testProofWitnessValidator("falsifier_result", "unknown_mechanism"), null);
  assert.equal(testProofWitnessValidator("boundary_trace", "module_substitution"), null);
  assert.equal(testProofWitnessValidator("falsifier_result", "node_test_v8_coverage"), null);
  assert.equal(testProofWitnessValidator("structured_test_result", "node_test_structured_events"), null);
  assert.equal(testProofWitnessValidator("falsifier_result", "toString"), null);

  assertRequired(testProofWitnessValidator("falsifier_result", "module_substitution"), nodeFalsifier,
    mutation, {
      unreached: (p) => { p.observation.observed = false; },
      sibling: (p) => { p.observation.selected_test_only = false; },
      "other mutation": (p) => { p.mutation_id = "mutation-other"; },
      "other module": (p) => { p.target_module_path = "lib/other.mjs"; },
      "other strategy": (p) => { p.strategy = "forced_invocation"; },
      "no witness": (p) => { delete p.witness_identity; },
      "other mechanism": (p) => { p.mechanism = "python_scalar_return_substitution"; }
    });
  assertRequired(testProofWitnessValidator("boundary_trace", "node_test_v8_coverage"), nodeTraversal,
    { observation_seam: "node_test_structured_assertion" }, {
      "import only": (p) => { p.observed = false; },
      "selected failed": (p) => { p.target_pass_observed = false; },
      "module not covered": (p) => { p.covered_module_paths = ["lib/other.mjs"]; },
      "other seam": (p) => { p.observable_seam = "node_test_event"; }
    });
  assertRequired(testProofWitnessValidator("boundary_trace", "python_call_trace"), pythonTraversal, {}, {
    "setup phase": (p) => { p.calls[0].phase = "setup"; },
    "sibling call": (p) => { p.calls[0].test_id = `test-${"c".repeat(64)}`; },
    "foreign source": (p) => { p.calls[0].source_digest = "sha256:y"; },
    "no entries": (p) => { p.calls[0].entries = 0; }
  });
  assertRequired(testProofWitnessValidator("falsifier_result", "python_scalar_return_substitution"),
    pythonFalsifier, { module_path: "pkg/mod.py" }, {
      inert: (p) => { p.replacement = 1; },
      "setup failed": (p) => { p.selected_phases.setup = "failed"; },
      "no assertion": (p) => { p.call_assertion_failure = false; },
      "never returned": (p) => { p.mutated_returns_in_call = 0; }
    });
});
