import { readFile } from "node:fs/promises";
import { TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST, TEST_PROOF_PROVIDER_CATALOG,
  TEST_PROOF_PROVIDER_REGISTRY_VERSION } from "../../lib/test-proof-provider-registry.mjs";

function currentVersion(providerId) {
  const descriptor = TEST_PROOF_PROVIDER_CATALOG.providers.find(
    ({ provider_id: id }) => id === providerId);
  if (!descriptor) throw new Error(`current provider registry has no ${providerId} descriptor`);
  return descriptor.provider_version;
}
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const artifact = (digest) => ({
  artifact_id: `artifact-${digest.slice(7)}`,
  artifact_digest: digest,
  artifact_owner: "launcher",
  test_controlled_output_used: false
});

const example = JSON.parse(await readFile(new URL(
  "../../examples/minimal-controlled-acceptance-contract.v1.json", import.meta.url
)));
const SELECTED_TEST_ID = "test-package-result";
function binding() {
  return {
    test_proof_id: "test-proof-suite-covers-component",
    verification_claim_id: "claim-suite-covers-component",
    system_under_test_boundary: {
      boundary_id: "sut-boundary-package-api",
      kind: "module",
      runtime_module_path: "packages/example/src/index.mjs",
      subject_reference_ids: ["ref-component"]
    },
    observable_result: {
      observable_id: "observable-package-result",
      kind: "return_value",
      proposition_id: "prop-suite-covers-component"
    },
    candidate_execution_provider: {
      provider_id: "launcher.node-test", provider_version: currentVersion("launcher.node-test"),
      capability: "candidate_execution"
    },
    falsifiers: [{
      falsifier_id: "falsifier-wrong-result",
      strategy: "dependency_failure",
      proposition_id: "prop-component-absent",
      expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-component-dependency-failure",
        mechanism: "module_substitution", target_kind: "module",
        module_path: "packages/example/src/index.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: currentVersion("launcher.node-test-module-fault"), capability: "falsifier_execution" }
    }],
    traversal_provider: { mode: "provider",
      provider_id: "launcher.node-test-v8-coverage",
      provider_version: currentVersion("launcher.node-test-v8-coverage"),
      capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    test_selector: { name: "package result is returned", nesting: 0 },
    prohibited_shortcuts: ["source_text_inspection", "test_count_only"]
  };
}

function fixture() {
  return {
    contract: { ...structuredClone(example), test_proofs: [binding()] },
    evaluation_input: {
      input_version: "controlled-contract-test-validity-evaluation-input.v1",
      verification_id: "claim-suite-covers-component",
      test_proof_id: "test-proof-suite-covers-component",
      candidate_execution: {
        passed: true,
        observed_boundary_id: "sut-boundary-package-api",
        observed_observable_id: "observable-package-result",
        source_text_inspection_used: false,
        provider: { provider_id: "launcher.node-test", provider_version: currentVersion("launcher.node-test"),
          capability: "candidate_execution",
          capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST },
        observation: { mechanism: "node_test_structured_events", ...artifact(DIGEST_A) }
      },
      test_inventory: {
        declared_test_ids: [SELECTED_TEST_ID],
        observed_tests: [{test_id: SELECTED_TEST_ID, status: "passed"}]
      },
      falsifier_executions: [{
        falsifier_id: "falsifier-wrong-result",
        isolated: true,
        skipped: false,
        target_verification_failed: true,
        failure_proposition_id: "prop-component-absent",
        failure_reason_source: "launcher_structured_event",
        failure_reason_code: "test_proof_fault.dependency_failure.v1",
        mutation: { mutation_id: "mutation-component-dependency-failure",
          strategy: "dependency_failure", applied: true,
          target_verification_id: "claim-suite-covers-component" },
        observation: { mechanism: "node_test_structured_events", ...artifact(DIGEST_B) },
        provider: { provider_id: "launcher.node-test-module-fault",
          provider_version: currentVersion("launcher.node-test-module-fault"),
          capability: "falsifier_execution",
          capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
          strategy: "dependency_failure" }
      }],
      boundary_traversal: {
        provider_support: "supported",
        result: "proven",
        authenticated: true,
        instrumented: true,
        observation_seam: "node_test_structured_assertion",
        boundary_id: "sut-boundary-package-api",
        observable_id: "observable-package-result",
        observation: { mechanism: "node_test_v8_coverage", ...artifact(DIGEST_C) },
        provider: { provider_id: "launcher.node-test-v8-coverage",
          provider_version: currentVersion("launcher.node-test-v8-coverage"), capability: "boundary_traversal",
          capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
          boundary_kind: "module" }
      }
    }
  };
}

const mutations = {
  "missing-sut-boundary": (value) => {
    delete value.evaluation_input.candidate_execution.observed_boundary_id;
  },
  "wrong-sut-boundary": (value) => {
    value.evaluation_input.candidate_execution.observed_boundary_id = "boundary-wrong";
  },
  "missing-observable": (value) => {
    delete value.evaluation_input.candidate_execution.observed_observable_id;
  },
  "wrong-observable": (value) => {
    value.evaluation_input.candidate_execution.observed_observable_id = "observable-wrong";
  },
  "missing-falsifier": (value) => { value.evaluation_input.falsifier_executions = []; },
  "inert-falsifier": (value) => {
    value.evaluation_input.falsifier_executions[0].target_verification_failed = false;
  },
  "echoed-reason-without-mutation": (value) => {
    value.evaluation_input.falsifier_executions[0].mutation.applied = false;
    value.evaluation_input.falsifier_executions[0].test_reported_reason =
      "test_proof_fault.dependency_failure.v1";
  },
  "wrong-structured-reason": (value) => {
    value.evaluation_input.falsifier_executions[0].failure_reason_code =
      "test_proof_fault.different_failure.v1";
  },
  "printed-traversal-marker": (value) => {
    value.evaluation_input.boundary_traversal.instrumented = false;
  },
  "echoed-environment-values": (value) => {
    value.evaluation_input.candidate_execution.observation.test_controlled_output_used = true;
  },
  "inert-mutation": (value) => {
    value.evaluation_input.falsifier_executions[0].mutation.applied = false;
    value.evaluation_input.falsifier_executions[0].target_verification_failed = false;
  },
  "unrelated-verification-failure": (value) => {
    value.evaluation_input.falsifier_executions[0].mutation.target_verification_id =
      "claim-unrelated-verification";
  },
  "supported-traversal-without-instrumentation": (value) => {
    value.evaluation_input.boundary_traversal.instrumented = false;
  },
  "test-authored-artifact": (value) => {
    value.evaluation_input.candidate_execution.observation.artifact_owner = "test_target";
  },
  "forged-artifact-digest": (value) => {
    value.evaluation_input.candidate_execution.observation.artifact_id =
      `artifact-${"0".repeat(64)}`;
  },
  "provider-strategy-mismatch": (value) => {
    value.evaluation_input.falsifier_executions[0].provider.strategy = "exception_path";
  },
  "provider-boundary-mismatch": (value) => {
    value.evaluation_input.boundary_traversal.provider.boundary_kind = "process";
  },
  "provider-observation-seam-mismatch": (value) => {
    value.evaluation_input.boundary_traversal.observation_seam = "printed_marker";
  },
  "skipped-falsifier": (value) => {
    value.evaluation_input.falsifier_executions[0].skipped = true;
  },
  "wrong-target-falsifier": (value) => {
    value.evaluation_input.falsifier_executions[0].failure_proposition_id =
      "prop-suite-covers-component";
  },
  "selected-test-unobserved": (value) => {
    value.evaluation_input.test_inventory.observed_tests = [];
  },
  "selected-test-renamed": (value) => {
    value.evaluation_input.test_inventory.observed_tests[0].test_id = "test-renamed";
  },
  "selected-test-skipped": (value) => {
    value.evaluation_input.test_inventory.observed_tests[0].status = "skipped";
  },
  "selected-test-failed": (value) => {
    value.evaluation_input.test_inventory.observed_tests[0].status = "failed";
  },
  "multiple-declared-tests": (value) => {
    value.evaluation_input.test_inventory.declared_test_ids =
      [SELECTED_TEST_ID, "test-sibling"];
  },
  "duplicate-declared-test": (value) => {
    value.evaluation_input.test_inventory.declared_test_ids =
      [SELECTED_TEST_ID, SELECTED_TEST_ID];
  },
  "duplicate-observed-test": (value) => {
    value.evaluation_input.test_inventory.observed_tests.push(
      {test_id: SELECTED_TEST_ID, status: "passed"});
  },
  "source-text-inspection": (value) => {
    value.evaluation_input.candidate_execution.source_text_inspection_used = true;
  },
  "supported-traversal-missing": (value) => { delete value.evaluation_input.boundary_traversal; },
  "unsupported-traversal-overclaim": (value) => {
    value.evaluation_input.boundary_traversal.provider_support = "unsupported";
  },
  "missing-candidate-provider": (value) => {
    delete value.contract.test_proofs[0].candidate_execution_provider;
  },
  "missing-falsifier-provider": (value) => {
    delete value.contract.test_proofs[0].falsifiers[0].execution_provider;
  },
  "unknown-provider": (value) => {
    value.contract.test_proofs[0].candidate_execution_provider.provider_id = "launcher.unknown";
  },
  "wrong-provider-version": (value) => {
    value.contract.test_proofs[0].candidate_execution_provider.provider_version = "0.9.0";
  },
  "provider-capability-mismatch": (value) => {
    value.contract.test_proofs[0].candidate_execution_provider.capability =
      "falsifier_execution";
  },
  "incomplete-falsifier-provider-population": (value) => {
    value.contract.test_proofs[0].falsifiers.push({
      falsifier_id: "falsifier-z-missing-execution", strategy: "dependency_failure",
      proposition_id: "prop-component-absent", expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-z-dependency-failure",
        mechanism: "module_substitution", target_kind: "module",
        module_path: "packages/example/src/index.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: currentVersion("launcher.node-test-module-fault"), capability: "falsifier_execution" }
    });
  },
  "falsely-supported-traversal": (value) => {
    value.contract.test_proofs[0].traversal_provider = {
      mode: "registry_unsupported", registry_id: "launcher.test-proof-provider-registry",
      registry_version: TEST_PROOF_PROVIDER_REGISTRY_VERSION
    };
  },
  "caller-injected-executor": (value) => {
    value.contract.test_proofs[0].candidate_execution_provider.path = "/tmp/runner.mjs";
  },
  "wrong-provider-snapshot-digest": (value) => {
    value.evaluation_input.candidate_execution.provider.capability_snapshot_digest =
      `sha256:${"0".repeat(64)}`;
  }
};

const positives = {
  "complete-witness": () => {},
  "complete-witness-with-sibling-tests": (value) => {
    value.evaluation_input.test_inventory.observed_tests.push(
      {test_id: "test-sibling-passed", status: "passed"},
      {test_id: "test-sibling-skipped", status: "skipped"});
  }
};

export { fixture, mutations, positives };
