import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  ProofPlanCompilerError,
  buildProofPlan,
  buildProofPlanFiles,
  canonicalProofPlanJson
} from "../lib/proof-plan-compiler.mjs";
import { inspectProofPackBindings } from
  "../lib/proof-pack-binding-assistance.mjs";
import { canonicalJson } from "../lib/contract-assessment.mjs";
import { validateProofPlan } from "../lib/multi-pack-assessment.mjs";
import { migrateControlledAcceptanceContractV02ToV1 } from
  "../lib/stable-v1-migration.mjs";
import { buildProofPlanFixture } from "./proof-plan-fixture.mjs";
import { buildRefusalBeforeEffectsFixture } from
  "./proof-packs/refusal-before-effects-fixture.mjs";
import { buildRetryConvergenceFixture } from
  "./proof-packs/retry-convergence-v1-fixture.mjs";
import { buildDormancyNonactivationFixture } from
  "./proof-packs/dormancy-nonactivation-v1-fixture.mjs";
import { buildStableTestProofPopulation } from
  "./support/stable-v1-proof-pack-runtime.mjs";

function stabilizeFixture(value) {
  const fixture = structuredClone(value);
  fixture.contract.test_proofs = buildStableTestProofPopulation(fixture.contract);
  fixture.input.input_version = "controlled-contract-verification-profile-input.v1";
  fixture.input.stable_evaluation = {};
  return fixture;
}

const execFileAsync = promisify(execFile);
const childEnvironment = () => {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
};
const V1 = {
  profile_id: "proof.authorization.refusal-before-effects",
  profile_version: "2.0.0"
};
const V1_INTENT = "controlled-proof-intent.refusal-before-effects";
const V2 = {
  profile_id: "proof.dormancy.nonactivation",
  profile_version: "2.0.0"
};
const V2_INTENT = "controlled-proof-intent.dormancy-nonactivation";

function request(intents, packs) {
  return {
    schema_version: "controlled-contract-proof-plan-request.v1",
    requested_intents: intents,
    selected_packs: packs
  };
}

async function testValidityFixture() {
  const [base, input] = await Promise.all([
    readFile(new URL("../examples/minimal-controlled-acceptance-contract-v034.json",
      import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL(
      "../profiles/proof.verification.test-validity/1.0.0/evaluation-input.template.json",
      import.meta.url), "utf8").then(JSON.parse)
  ]);
  input.verification_id = "claim-suite-covers-component";
  input.test_proof_id = "test-proof-suite-covers-component";
  input.evaluation_stage = "pre_dispatch";
  input.falsifier_executions[0].failure_proposition_id = "prop-component-absent";
  input.falsifier_executions[0].mutation.target_verification_id = input.verification_id;
  const modulePath = "packages/controlled-contract/lib/test-proof-contract.mjs";
  const provider = (provider_id, capability) => ({
    provider_id, provider_version: "1.0.0", capability
  });
  const { input_version: _inputVersion, evaluation_stage, ...testValidity } = input;
  return {
    contract: migrateControlledAcceptanceContractV02ToV1({
      contract: base,
      testProofs: [{
        test_proof_id: input.test_proof_id,
        verification_claim_id: input.verification_id,
        system_under_test_boundary: {
          boundary_id: input.candidate_execution.observed_boundary_id, kind: "module",
          runtime_module_path: modulePath, subject_reference_ids: ["ref-component"]
        },
        observable_result: {
          observable_id: input.candidate_execution.observed_observable_id,
          kind: "return_value", proposition_id: "prop-suite-covers-component"
        },
        candidate_execution_provider: provider("launcher.node-test", "candidate_execution"),
        falsifiers: [{
          falsifier_id: input.falsifier_executions[0].falsifier_id,
          strategy: "dependency_failure", proposition_id: "prop-component-absent",
          expected_outcome: "verification_fails",
          mutation: {
            mutation_id: input.falsifier_executions[0].mutation.mutation_id,
            mechanism: "module_substitution", target_kind: "module", module_path: modulePath
          },
          execution_provider: provider(
            "launcher.node-test-module-fault", "falsifier_execution")
        }],
        traversal_provider: {
          mode: "provider", ...provider(
            "launcher.node-test-v8-coverage", "boundary_traversal"),
          boundary_kind: "module", observation_mechanism: "node_test_v8_coverage",
          observation_seam: "node_test_structured_assertion",
          evidence_artifact_type: "boundary_trace"
        },
        coverage_disposition: {
          baseline_id: "coverage-baseline-package-suite",
          baseline_state: "complete_executed_inventory",
          items: input.test_inventory.declared_test_ids.map((test_id) => ({
            test_id, disposition: "preserved"
          }))
        },
        prohibited_shortcuts: ["source_text_inspection"]
      }]
    }),
    input: {
      input_version: "controlled-contract-verification-profile-input.v1",
      evaluation_stage,
      reference_bindings: [
        { role: "component", reference_ids: ["ref-component"] },
        { role: "suite", reference_ids: ["ref-suite"] }
      ],
      number_bindings: [], claim_pattern_bindings: [], resolver_facts: [],
      delivered_evidence: [], stable_evaluation: { test_validity: [testValidity] }
    }
  };
}

function namespaceFixture(fixture, prefix) {
  const contract = structuredClone(fixture.contract);
  const input = structuredClone(fixture.input);
  const replacements = new Map();
  for (const [field, key] of [
    ["references", "reference_id"], ["propositions", "proposition_id"],
    ["claims", "claim_id"], ["relations", "relation_id"],
    ["collections", "collection_id"], ["residue", "residue_id"]
  ]) for (const item of contract[field] ?? []) {
    const separator = item[key].indexOf("-");
    replacements.set(item[key], separator === -1 ? `${item[key]}-${prefix}` :
      `${item[key].slice(0, separator)}-${prefix}-${item[key].slice(separator + 1)}`);
  }
  const replace = (value) => {
    if (typeof value === "string") return replacements.get(value) ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (value !== null && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replace(child)])
    );
    return value;
  };
  return { contract: replace(contract), input: replace(input) };
}

function mergeContracts(fixtures) {
  const [first, ...rest] = fixtures;
  const result = structuredClone(first.contract);
  for (const fixture of rest) for (const field of [
    "references", "propositions", "claims", "relations", "collections",
    "residue", "annotations", "test_proofs"
  ]) result[field].push(...structuredClone(fixture.contract[field]));
  result.test_proofs.sort((left, right) => left.verification_claim_id.localeCompare(
    right.verification_claim_id));
  return result;
}

function dormancySources(fixture, artifactPrefix = "") {
  const role = (name) => fixture.input.reference_bindings.find(
    ({ role: candidate }) => candidate === name
  ).reference_ids;
  const activeComponent = role("graph_nodes").find((id) =>
    id.endsWith("active-component")
  );
  return {
    "activation-observation-artifact": {
      kind: "artifact_file",
      relative_path: `${artifactPrefix}activation-observation.json`
    },
    "default-configuration-artifact": {
      kind: "artifact_file",
      relative_path: `${artifactPrefix}default-configuration.json`
    },
    "production-reachability-snapshot": {
      kind: "complete_reachability_snapshot",
      snapshot: {
        complete: true,
        subject_reference_id: role("production_graph")[0],
        nodes: role("graph_nodes").map((reference_id) => ({ reference_id })),
        edges: role("production_entrypoints").map((from_reference_id) => ({
          from_reference_id, to_reference_id: activeComponent
        }))
      }
    }
  };
}

function expectCode(code) {
  return (error) => error instanceof ProofPlanCompilerError && error.code === code;
}

test("compiler reproduces a manually derived v1 proof plan exactly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-plan-compiler-v1-"));
  try {
    const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
    const contractPath = path.join(root, "contract.json");
    const evaluationPath = path.join(root, "evaluation.json");
    await Promise.all([
      writeFile(contractPath, canonicalJson(fixture.contract)),
      writeFile(evaluationPath, canonicalJson(fixture.input))
    ]);
    const expected = await buildProofPlanFixture({
      contractPath,
      packs: [{
        profileId: V1.profile_id,
        requestedIntents: [V1_INTENT],
        evaluationInputPath: evaluationPath
      }]
    });
    const actual = await buildProofPlan({
      contract: fixture.contract,
      request: request([V1_INTENT], [{
        ...V1, evaluation_input_path: evaluationPath
      }]),
      evaluationInputs: { [evaluationPath]: fixture.input }
    });
    assert.deepEqual(actual, expected);
    assert.equal(validateProofPlan(actual), true);
    assert.deepEqual(JSON.parse(canonicalProofPlanJson(actual)), expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compiler builds a stable pre-dispatch test-validity plan without runtime selection",
  async () => {
    const fixture = await testValidityFixture();
    const evaluationPath = "test-validity.json";
    const plan = await buildProofPlan({
      contract: fixture.contract,
      request: request(["controlled-proof-intent.test-verification-validity"], [{
        profile_id: "proof.verification.test-validity",
        profile_version: "2.0.0",
        evaluation_input_path: evaluationPath
      }]),
      evaluationInputs: { [evaluationPath]: fixture.input }
    });
    assert.equal(plan.packs[0].profile_id, "proof.verification.test-validity");
    assert.equal(validateProofPlan(plan), true);
    assert.equal(fixture.input.evaluation_stage, "pre_dispatch");
    assert.equal(Object.hasOwn(
      fixture.contract.test_proofs[0], "runtime_test_selection"), false);
    await assert.rejects(() => buildProofPlan({
      contract: fixture.contract,
      request: request([V1_INTENT], [{
        ...V1,
        evaluation_input_path: "legacy-v0.2-only.json"
      }]),
      evaluationInputs: { "legacy-v0.2-only.json": fixture.input }
    }), (error) => error.code === "proof_plan_request_evaluation_input_invalid");
    const partial = structuredClone(fixture.contract);
    delete partial.test_proof_version;
    await assert.rejects(() => buildProofPlan({
      contract: partial,
      request: request(["controlled-proof-intent.test-verification-validity"], [{
        profile_id: "proof.verification.test-validity",
        profile_version: "2.0.0",
        evaluation_input_path: evaluationPath
      }]),
      evaluationInputs: { [evaluationPath]: fixture.input }
    }), (error) => error.code === "proof_plan_compiler_contract_invalid" &&
      error.details.diagnostics.diagnostics.length > 0);
  });

test("compiler reproduces exact-binding digests and paths without placeholders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-plan-compiler-v2-"));
  try {
    const fixture = stabilizeFixture(
      buildDormancyNonactivationFixture({ domain: "compiler" }));
    const sources = dormancySources(fixture);
    const contractPath = path.join(root, "contract.json");
    const evaluationPath = path.join(root, "evaluation.json");
    await Promise.all([
      writeFile(contractPath, canonicalJson(fixture.contract)),
      writeFile(evaluationPath, canonicalJson(fixture.input))
    ]);
    const expected = await buildProofPlanFixture({
      contractPath,
      packs: [{
        profileId: V2.profile_id,
        requestedIntents: [V2_INTENT],
        evaluationInputPath: evaluationPath,
        captureRoot: root,
        exactBindingSources: sources
      }]
    });
    const actual = await buildProofPlan({
      contract: fixture.contract,
      request: request([V2_INTENT], [{
        ...V2,
        evaluation_input_path: evaluationPath,
        exact_capture: {
          capture_root: root,
          contract_path: "contract.json",
          evaluation_input_path: "evaluation.json",
          sources
        }
      }]),
      evaluationInputs: { [evaluationPath]: fixture.input }
    });
    assert.deepEqual(actual, expected);
    assert.match(actual.packs[0].source_digests.exact_binding_sources,
      /^[0-9a-f]{64}$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("property, intent, pack, and binding-map order cannot change output bytes", async () => {
  const refusal = namespaceFixture(stabilizeFixture(buildRefusalBeforeEffectsFixture()), "refusal");
  const retry = namespaceFixture(stabilizeFixture(buildRetryConvergenceFixture()), "retry");
  const contract = mergeContracts([refusal, retry]);
  const refusalPath = "/capture/refusal.json";
  const retryPath = "/capture/retry.json";
  const baseline = await buildProofPlan({
    contract,
    request: request([
      V1_INTENT, "controlled-proof-intent.retry-convergence"
    ], [{ ...V1, evaluation_input_path: refusalPath }, {
      profile_id: "proof.failure.retry-convergence",
      profile_version: "2.0.0",
      evaluation_input_path: retryPath
    }]),
    evaluationInputs: {
      [refusalPath]: refusal.input,
      [retryPath]: retry.input
    }
  });
  const reordered = await buildProofPlan({
    evaluationInputs: {
      [retryPath]: structuredClone(retry.input),
      [refusalPath]: structuredClone(refusal.input)
    },
    request: {
      selected_packs: [{
        evaluation_input_path: retryPath,
        profile_version: "2.0.0",
        profile_id: "proof.failure.retry-convergence"
      }, { evaluation_input_path: refusalPath, ...V1 }],
      requested_intents: [
        "controlled-proof-intent.retry-convergence", V1_INTENT
      ],
      schema_version: "controlled-contract-proof-plan-request.v1"
    },
    contract: JSON.parse(canonicalJson(contract))
  });
  assert.equal(canonicalProofPlanJson(reordered), canonicalProofPlanJson(baseline));
});

test("request rejects digest substitution, duplicates, stale and unadmitted packs", async () => {
  const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  const inputPath = "evaluation.json";
  const compile = (selected, extra = {}) => buildProofPlan({
    contract: fixture.contract,
    request: { ...request([V1_INTENT], selected), ...extra },
    evaluationInputs: { [inputPath]: fixture.input }
  });
  await assert.rejects(() => compile([{ ...V1, evaluation_input_path: inputPath }], {
    digests: { contract: "0".repeat(64) }
  }), expectCode("proof_plan_request_schema_invalid"));
  await assert.rejects(() => compile([
    { ...V1, evaluation_input_path: inputPath },
    { ...V1, evaluation_input_path: "other.json" }
  ]), expectCode("proof_plan_request_duplicate_pack"));
  await assert.rejects(() => compile([{
    ...V1, profile_version: "9.9.9", evaluation_input_path: inputPath
  }]), expectCode("proof_plan_request_pack_version_stale"));
  await assert.rejects(() => compile([{
    profile_id: "proof.unadmitted.near-match",
    profile_version: "2.0.0",
    evaluation_input_path: inputPath
  }]), expectCode("proof_plan_request_pack_unadmitted"));
});

test("omitted, uncovered, mismatched, and ambiguous intent assignments fail closed", async () => {
  const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  const inputPath = "evaluation.json";
  const compilerInput = (requestedIntents, selectedPacks) => ({
    contract: fixture.contract,
    request: request(requestedIntents, selectedPacks),
    evaluationInputs: { [inputPath]: fixture.input }
  });
  await assert.rejects(() => buildProofPlan({
    contract: fixture.contract,
    request: {
      schema_version: "controlled-contract-proof-plan-request.v1",
      selected_packs: [{ ...V1, evaluation_input_path: inputPath }]
    },
    evaluationInputs: { [inputPath]: fixture.input }
  }), expectCode("proof_plan_request_schema_invalid"));
  await assert.rejects(() => buildProofPlan(compilerInput([V1_INTENT], [{
    profile_id: "proof.failure.retry-convergence",
    profile_version: "2.0.0",
    evaluation_input_path: inputPath
  }])), expectCode("proof_plan_request_selection_incomplete"));
  await assert.rejects(() => buildProofPlan(compilerInput([
    "controlled-proof-intent.protected-effect-nonmutation"
  ], [{ ...V1, evaluation_input_path: inputPath }, {
    profile_id: "proof.state.bounded-interval-nonmutation",
    profile_version: "2.0.0",
    evaluation_input_path: "bounded.json"
  }])), (error) => expectCode("proof_plan_request_selection_incomplete")(error) &&
    error.details.diagnostics[0].code === "proof_plan_request_intent_ambiguous");
});

test("swapped or invalid evaluation inputs fail before a plan is emitted", async () => {
  const refusal = namespaceFixture(stabilizeFixture(buildRefusalBeforeEffectsFixture()), "refusal");
  const retry = namespaceFixture(stabilizeFixture(buildRetryConvergenceFixture()), "retry");
  const contract = mergeContracts([refusal, retry]);
  const refusalPath = "refusal.json";
  const retryPath = "retry.json";
  const selected = [{ ...V1, evaluation_input_path: refusalPath }, {
    profile_id: "proof.failure.retry-convergence",
    profile_version: "2.0.0",
    evaluation_input_path: retryPath
  }];
  await assert.rejects(() => buildProofPlan({
    contract,
    request: request([V1_INTENT,
      "controlled-proof-intent.retry-convergence"], selected),
    evaluationInputs: {
      [refusalPath]: retry.input,
      [retryPath]: refusal.input
    }
  }), (error) => [
    "proof_plan_request_evaluation_input_invalid",
    "proof_pack_binding_evaluation_input_invalid"
  ].includes(error.code));
});

test("missing exact caller inputs are all reported with stable typed diagnostics", async () => {
  const fixture = stabilizeFixture(
    buildDormancyNonactivationFixture({ domain: "missing" }));
  await assert.rejects(() => buildProofPlan({
    contract: fixture.contract,
    request: request([V2_INTENT], [{ ...V2, exact_capture: {} }])
  }), (error) => expectCode("proof_plan_request_missing_inputs")(error) &&
    assert.deepEqual(error.details.diagnostics.map(({ code }) => code), [
      "proof_plan_request_evaluation_input_path_missing",
      "proof_plan_request_exact_capture_root_missing",
      "proof_plan_request_exact_contract_path_missing",
      "proof_plan_request_exact_evaluation_input_path_missing",
      "proof_plan_request_exact_sources_missing"
    ]) === undefined);
  await assert.rejects(() => buildProofPlan({
    contract: fixture.contract,
    request: request([V2_INTENT], [{ ...V2 }])
  }), (error) => expectCode("proof_plan_request_missing_inputs")(error) &&
    error.details.diagnostics.some(({ code }) =>
      code === "proof_plan_request_exact_sources_missing"));
});

test("exact path escape and exact-source swaps are mechanically visible", async () => {
  const fixture = stabilizeFixture(
    buildDormancyNonactivationFixture({ domain: "exact-swap" }));
  const evaluationPath = "/capture/evaluation.json";
  const sources = dormancySources(fixture);
  const build = (exactCapture) => buildProofPlan({
    contract: fixture.contract,
    request: request([V2_INTENT], [{
      ...V2, evaluation_input_path: evaluationPath, exact_capture: exactCapture
    }]),
    evaluationInputs: { [evaluationPath]: fixture.input }
  });
  await assert.rejects(() => build({
    capture_root: "/capture",
    contract_path: "../contract.json",
    evaluation_input_path: "evaluation.json",
    sources
  }), expectCode("proof_plan_request_exact_path_invalid"));
  const first = await build({
    capture_root: "/capture",
    contract_path: "contract.json",
    evaluation_input_path: "evaluation.json",
    sources
  });
  const swapped = structuredClone(sources);
  [swapped["activation-observation-artifact"].relative_path,
    swapped["default-configuration-artifact"].relative_path] = [
    swapped["default-configuration-artifact"].relative_path,
    swapped["activation-observation-artifact"].relative_path
  ];
  const second = await build({
    capture_root: "/capture",
    contract_path: "contract.json",
    evaluation_input_path: "evaluation.json",
    sources: swapped
  });
  assert.notEqual(first.packs[0].source_digests.exact_binding_sources,
    second.packs[0].source_digests.exact_binding_sources);
});

test("file compiler binds relative request paths and CLI emits the same canonical plan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-plan-compiler-cli-"));
  try {
    const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
    const contractPath = path.join(root, "contract.json");
    const evaluationPath = path.join(root, "evaluation.json");
    const requestPath = path.join(root, "request.json");
    const value = request([V1_INTENT], [{
      ...V1, evaluation_input_path: "evaluation.json"
    }]);
    await Promise.all([
      writeFile(contractPath, canonicalJson(fixture.contract)),
      writeFile(evaluationPath, canonicalJson(fixture.input)),
      writeFile(requestPath, canonicalJson(value))
    ]);
    const expected = await buildProofPlanFiles({ inputPath: contractPath, requestPath });
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      new URL("../bin/build-proof-plan.mjs", import.meta.url).pathname,
      "--input", contractPath, "--request", requestPath
    ], { env: childEnvironment() });
    assert.equal(stderr, "");
    assert.equal(stdout, canonicalProofPlanJson(expected));
    const emitted = JSON.parse(stdout);
    assert.equal(emitted.packs[0].evaluation_input.path, evaluationPath);
    assert.equal(validateProofPlan(emitted), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI help exposes only genuine caller choices and explicit non-selection", async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    new URL("../bin/build-proof-plan.mjs", import.meta.url).pathname,
    "--help"
  ], { env: childEnvironment() });
  assert.equal(stderr, "");
  assert.match(stdout, /--input <contract\.json>/u);
  assert.match(stdout, /--request <proof-plan-request\.json>/u);
  assert.match(stdout, /never infers an intent, selects a pack, binds a role/u);
  assert.doesNotMatch(stdout, /--catalog|--profile-path|--output/u);
});

test("file compiler rejects exact capture identities that do not bind its files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cc-plan-path-conflict-"));
  try {
    const fixture = stabilizeFixture(
      buildDormancyNonactivationFixture({ domain: "path-conflict" }));
    const contractPath = path.join(root, "contract.json");
    const evaluationPath = path.join(root, "evaluation.json");
    const requestPath = path.join(root, "request.json");
    await Promise.all([
      writeFile(contractPath, canonicalJson(fixture.contract)),
      writeFile(evaluationPath, canonicalJson(fixture.input)),
      writeFile(requestPath, canonicalJson(request([V2_INTENT], [{
        ...V2,
        evaluation_input_path: "evaluation.json",
        exact_capture: {
          capture_root: ".",
          contract_path: "other-contract.json",
          evaluation_input_path: "evaluation.json",
          sources: dormancySources(fixture)
        }
      }])))
    ]);
    await assert.rejects(() => buildProofPlanFiles({
      inputPath: contractPath, requestPath
    }), expectCode("proof_plan_request_exact_contract_path_conflict"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compiler rejects caller substrate overrides and bounds malformed requests", async () => {
  const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  await assert.rejects(() => buildProofPlan({
    contract: fixture.contract,
    request: request([], []),
    catalog: { packs: [] }
  }), expectCode("proof_plan_compiler_option_unsupported"));
  const excessive = Array.from({ length: 257 }, (_, index) =>
    `controlled-proof-intent.attack-${index}`);
  await assert.rejects(() => buildProofPlan({
    contract: fixture.contract,
    request: request(excessive, [])
  }), expectCode("proof_plan_request_schema_invalid"));
});

test("schema-valid exact-source expansion fails the canonical plan byte bound", async () => {
  const fixture = stabilizeFixture(
    buildDormancyNonactivationFixture({ domain: "size-bound" }));
  const evaluationPath = "/capture/evaluation.json";
  const sources = dormancySources(fixture);
  sources["extra-artifact"] = {
    kind: "artifact_file",
    relative_path: `extra/${"x".repeat(140_000)}.json`
  };
  await assert.rejects(() => buildProofPlan({
    contract: fixture.contract,
    request: request([V2_INTENT], [{
      ...V2,
      evaluation_input_path: evaluationPath,
      exact_capture: {
        capture_root: "/capture",
        contract_path: "contract.json",
        evaluation_input_path: "evaluation.json",
        sources
      }
    }]),
    evaluationInputs: { [evaluationPath]: fixture.input }
  }), expectCode("compiled_proof_plan_too_large"));
});

test("compiler validates large contracts without materializing binding assistance", async () => {
  const fixture = stabilizeFixture(buildRefusalBeforeEffectsFixture());
  fixture.contract.references.push(...Array.from({ length: 900 }, (_, index) => {
    const suffix = String(index).padStart(4, "0");
    return {
      reference_id: `ref-scale-${suffix}`,
      type_term: "cc:resource",
      identity: {
        kind: "durable_id",
        domain: "proof-plan-scaling-regression",
        value: `resource-${suffix}`
      }
    };
  }));
  await assert.rejects(() => inspectProofPackBindings({
    contract: fixture.contract,
    profileId: V1.profile_id,
    profileVersion: V1.profile_version,
    requestedIntents: [V1_INTENT],
    evaluationInput: fixture.input
  }), (error) => error.code === "proof_pack_binding_result_too_large");

  const evaluationPath = "large-evaluation.json";
  const plan = await buildProofPlan({
    contract: fixture.contract,
    request: request([V1_INTENT], [{
      ...V1, evaluation_input_path: evaluationPath
    }]),
    evaluationInputs: { [evaluationPath]: fixture.input }
  });
  assert.equal(validateProofPlan(plan), true);
  assert.equal(plan.packs[0].profile_id, V1.profile_id);
});
