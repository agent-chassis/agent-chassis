import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST
} from "../../lib/test-proof-contract.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../../lib/stable-v1-migration.mjs";
import {
  canonicalDigest,
  evaluateTestValidity
} from "../../profiles/proof.verification.test-validity/2.0.0/evaluator.mjs";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const artifact = (digest) => ({
  artifact_id: `artifact-${digest.slice(7)}`,
  artifact_digest: digest,
  artifact_owner: "launcher",
  test_controlled_output_used: false
});

const baseContract = JSON.parse(await readFile(new URL(
  "../../examples/minimal-controlled-acceptance-contract-v034.json", import.meta.url
)));
const certificationRoot = new URL(
  "../certification/profiles/proof.verification.test-validity/2.0.0/",
  import.meta.url
);
const corpus = JSON.parse(await readFile(new URL("corpus.json", certificationRoot)));
const certifiedResult = JSON.parse(await readFile(
  new URL("result.json", certificationRoot)
));

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
      provider_id: "launcher.node-test", provider_version: "1.0.0",
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
        provider_version: "1.0.0", capability: "falsifier_execution" }
    }],
    traversal_provider: { mode: "provider",
      provider_id: "launcher.node-test-v8-coverage", provider_version: "1.0.0",
      capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    coverage_disposition: {
      baseline_id: "coverage-baseline-package-suite",
      baseline_state: "complete_executed_inventory",
      items: [{test_id: "test-package-result", disposition: "preserved"}]
    },
    prohibited_shortcuts: ["source_text_inspection", "test_count_only"]
  };
}

function fixture() {
  return {
    contract: migrateControlledAcceptanceContractV02ToV1({
      contract: structuredClone(baseContract), testProofs: [binding()]
    }),
    evaluation_input: {
      input_version: "controlled-contract-test-validity-evaluation-input.v1",
      verification_id: "claim-suite-covers-component",
      test_proof_id: "test-proof-suite-covers-component",
      candidate_execution: {
        passed: true,
        observed_boundary_id: "sut-boundary-package-api",
        observed_observable_id: "observable-package-result",
        source_text_inspection_used: false,
        provider: { provider_id: "launcher.node-test", provider_version: "1.0.0",
          capability: "candidate_execution",
          capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST },
        observation: { mechanism: "node_test_structured_events", ...artifact(DIGEST_A) }
      },
      test_inventory: {
        declared_test_ids: ["test-package-result"],
        baseline_executed_test_ids: ["test-package-result"],
        observed_tests: [{test_id: "test-package-result", status: "passed"}]
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
        provider: { provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
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
          provider_version: "1.0.0", capability: "boundary_traversal",
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
  "removed-test": (value) => { value.evaluation_input.test_inventory.observed_tests = []; },
  "renamed-test": (value) => {
    value.evaluation_input.test_inventory.observed_tests[0].test_id = "test-renamed";
  },
  "newly-skipped-test": (value) => {
    value.evaluation_input.test_inventory.observed_tests[0].status = "skipped";
  },
  "failed-observed-test": (value) => {
    value.evaluation_input.test_inventory.observed_tests[0].status = "failed";
  },
  "undispositioned-coverage": (value) => {
    value.evaluation_input.test_inventory.baseline_executed_test_ids.push("test-legacy");
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
        provider_version: "1.0.0", capability: "falsifier_execution" }
    });
  },
  "falsely-supported-traversal": (value) => {
    value.contract.test_proofs[0].traversal_provider = {
      mode: "registry_unsupported", registry_id: "launcher.test-proof-provider-registry",
      registry_version: "1.0.0"
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

test("complete test-validity witness satisfies every axis without semantic overclaim", () => {
  const subject = fixture();
  const before = canonicalDigest(subject);
  const result = evaluateTestValidity(subject);
  assert.equal(result.satisfaction, "satisfied");
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.semantic_judgment, "not_performed_coordinator_owned");
  assert.equal(canonicalDigest(subject), before);
});

test("single-axis certification corpus rejects every weakening for its reason", () => {
  const passed = [];
  for (const control of corpus.single_axis_weakenings) {
    const subject = fixture();
    mutations[control.case_id](subject);
    const result = evaluateTestValidity(subject);
    assert.equal(result.satisfaction, "unsatisfied", control.case_id);
    assert.ok(result.diagnostics.length > 0,
      `${control.case_id}:${JSON.stringify(result.diagnostics)}`);
    passed.push(control.case_id);
  }
  assert.deepEqual(passed, certifiedResult.passed_single_axis_weakenings);
  assert.deepEqual(corpus.positive_cases, certifiedResult.passed_positive_cases);
});

test("unsupported traversal is retained as review_only", () => {
  const subject = fixture();
  subject.evaluation_input.boundary_traversal = {
    provider_support: "unsupported",
    result: "review_only",
    authenticated: true,
    boundary_id: "sut-boundary-package-api",
    observable_id: "observable-package-result",
    provider: { registry_id: "launcher.test-proof-provider-registry",
      registry_version: "1.0.0", capability: "traversal_unsupported",
      capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST }
  };
  subject.contract.test_proofs[0].traversal_provider = {
    mode: "registry_unsupported", registry_id: "launcher.test-proof-provider-registry",
    registry_version: "1.0.0"
  };
  assert.equal(evaluateTestValidity(subject).satisfaction, "satisfied");
});

test("current package catalogs expose the exact stable test-validity pack", async () => {
  const [intents, profiles, admission] = await Promise.all([
    readFile(new URL("../../proof-intents/catalog.json", import.meta.url), "utf8")
      .then(JSON.parse),
    readFile(new URL("../../profiles/catalog.json", import.meta.url), "utf8")
      .then(JSON.parse),
    readFile(new URL("../../profiles/proof.verification.test-validity/2.0.0/admission.json",
      import.meta.url), "utf8").then(JSON.parse)
  ]);
  assert.ok(intents.intents.some(({ intent_id: intentId, capable_packs: packs }) =>
    intentId === "controlled-proof-intent.test-verification-validity" &&
    packs.some(({ profile_version: version }) => version === "2.0.0")));
  const pack = profiles.packs.find(({ profile_id: id }) =>
    id === "proof.verification.test-validity");
  assert.equal(pack.profile_version, "2.0.0");
  assert.equal(admission.profile_version, "2.0.0");
  assert.equal(certifiedResult.profile_version, "2.0.0");
  assert.equal((await readFile(new URL("profile.json", certificationRoot), "utf8")
    .then(JSON.parse)).contract_schema_version,
    "controlled-acceptance-contract.v1");
  assert.equal(admission.certification.executable_control_count, 38);
});
