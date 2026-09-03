import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  MAX_BINDING_ASSISTANCE_BYTES,
  ProofPackBindingAssistanceError,
  canonicalProofPackBindingAssistanceJson,
  inspectProofPackBindings,
  inspectProofPackBindingsPage,
  validateSuppliedProofPackBindings,
  validateProofPackBindingAssistance
} from "../lib/proof-pack-binding-assistance.mjs";
import {
  migrateControlledAcceptanceContractV02ToV1
} from "../lib/stable-v1-migration.mjs";
import { buildResultShapeConformanceFixture } from
  "./proof-packs/result-shape-conformance-v1-fixture.mjs";
import { parseArgs } from "../bin/inspect-proof-pack-bindings.mjs";
import { buildStableTestProofPopulation } from
  "./support/stable-v1-proof-pack-runtime.mjs";

const execFileAsync = promisify(execFile);
const childEnvironment = () => {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
};
const packageRoot = new URL("../", import.meta.url);
const profileId = "proof.state.bounded-interval-nonmutation";
const profileVersion = "2.0.0";
const intentId = "controlled-proof-intent.bounded-interval-nonmutation";

function reference(referenceId, typeTerm, kind = "durable_id") {
  const identity = kind === "runtime_parameter"
    ? { kind, name: referenceId }
    : { kind, domain: "binding-test", value: referenceId };
  return { reference_id: referenceId, type_term: typeTerm, identity };
}

async function contractFixture() {
  const contract = JSON.parse(await readFile(new URL(
    "examples/minimal-controlled-acceptance-contract-v034.json", packageRoot
  ), "utf8"));
  contract.references.push(
    reference("ref-actor-alpha", "cc:actor"),
    reference("ref-actor-beta", "cc:process"),
    reference("ref-actor-misleading-name", "cc:state"),
    reference("ref-interval", "cc:scope"),
    reference("ref-start", "cc:event"),
    reference("ref-end", "cc:event"),
    reference("ref-population", "cc:population"),
    reference("ref-resource", "cc:resource")
  );
  contract.propositions.push(
    {
      proposition_id: "prop-count-one",
      subject_reference_id: "ref-population",
      operator: "number:has_cardinality",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "number", value: 1 }]
    },
    {
      proposition_id: "prop-count-two",
      subject_reference_id: "ref-population",
      operator: "number:has_cardinality",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "number", value: 2 }]
    }
  );
  return migrateControlledAcceptanceContractV02ToV1({
    contract,
    testProofs: buildStableTestProofPopulation(contract)
  });
}

function evaluationInput(referenceBindings = [], numberBindings = []) {
  return {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: referenceBindings,
    number_bindings: numberBindings,
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [],
    stable_evaluation: {}
  };
}

async function testValidityFixture() {
  const [base, input] = await Promise.all([
    readFile(new URL("examples/minimal-controlled-acceptance-contract-v034.json", packageRoot),
      "utf8").then(JSON.parse),
    readFile(new URL(
      "profiles/proof.verification.test-validity/1.0.0/evaluation-input.template.json",
      packageRoot), "utf8").then(JSON.parse)
  ]);
  input.verification_id = "claim-suite-covers-component";
  input.test_proof_id = "test-proof-suite-covers-component";
  input.evaluation_stage = "pre_dispatch";
  input.falsifier_executions[0].failure_proposition_id = "prop-component-absent";
  input.falsifier_executions[0].mutation.target_verification_id =
    "claim-suite-covers-component";
  const proof = {
    test_proof_id: input.test_proof_id,
    verification_claim_id: input.verification_id,
    system_under_test_boundary: {
      boundary_id: input.candidate_execution.observed_boundary_id, kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/test-proof-contract.mjs",
      subject_reference_ids: ["ref-component"]
    },
    observable_result: {
      observable_id: input.candidate_execution.observed_observable_id, kind: "return_value",
      proposition_id: "prop-suite-covers-component"
    },
    candidate_execution_provider: {
      provider_id: "launcher.node-test", provider_version: "1.0.0",
      capability: "candidate_execution"
    },
    falsifiers: [{
      falsifier_id: input.falsifier_executions[0].falsifier_id,
      strategy: "dependency_failure", proposition_id: "prop-component-absent",
      expected_outcome: "verification_fails",
      mutation: {
        mutation_id: input.falsifier_executions[0].mutation.mutation_id,
        mechanism: "module_substitution", target_kind: "module",
        module_path: "packages/controlled-contract/lib/test-proof-contract.mjs"
      },
      execution_provider: {
        provider_id: "launcher.node-test-module-fault", provider_version: "1.0.0",
        capability: "falsifier_execution"
      }
    }],
    traversal_provider: {
      mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal",
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
  };
  const { input_version: _inputVersion, evaluation_stage, ...testValidity } = input;
  return {
    contract: migrateControlledAcceptanceContractV02ToV1({
      contract: base, testProofs: [proof]
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

test("reports every compatible candidate without choosing or inferring meaning", async () => {
  const result = await inspectProofPackBindings({
    contract: await contractFixture(), profileId, profileVersion,
    requestedIntents: [intentId]
  });
  assert.equal(validateProofPackBindingAssistance(result), true);
  assert.equal(result.binding_selected, false);
  assert.equal(result.binding_written, false);
  assert.equal(result.semantic_truth_inferred, false);
  assert.equal(result.authority, "non_authoritative");
  assert.equal(Object.hasOwn(result, "next_call"), false);
  assert.equal(Object.hasOwn(result, "next_calls"), false);
  const actor = result.reference_roles.find(({ role }) => role === "actor");
  assert.equal(actor.status, "ambiguous");
  assert.deepEqual(actor.compatible_candidates.map(({ reference_id: id }) => id), [
    "ref-actor-alpha", "ref-actor-beta"
  ]);
  assert.equal(actor.compatible_candidates.some(({ reference_id: id }) =>
    id === "ref-actor-misleading-name"), false);
  assert(actor.compatible_candidates.every(({ compatibility }) =>
    compatibility.type_compatible && compatibility.identity_kind_compatible));
  assert.ok(actor.profile_usage.patterns.length > 0);
  assert.ok(Array.isArray(
    actor.profile_usage.constraints.falsifier_occurrence_bindings
  ));
  assert.equal(result.summary.status, "not_supplied");
  const tampered = structuredClone(result);
  tampered.summary.reference_role_count += 1;
  assert.throws(() => canonicalProofPackBindingAssistanceJson(tampered),
    (error) => error.code === "proof_pack_binding_result_digest_mismatch");
});

test("one candidate remains an explicit suggestion status, never a binding", async () => {
  const contract = structuredClone(await contractFixture());
  contract.references = contract.references.filter(({ reference_id: id }) =>
    id !== "ref-actor-beta");
  const result = await inspectProofPackBindings({
    contract, profileId, profileVersion
  });
  const actor = result.reference_roles.find(({ role }) => role === "actor");
  assert.equal(actor.status, "one_compatible_candidate");
  assert.equal(actor.supplied_binding, null);
  assert.equal(result.binding_selected, false);
});

test("valid and stale supplied bindings receive typed per-role status", async () => {
  const contract = await contractFixture();
  const supplied = evaluationInput([
    { role: "actor", reference_ids: ["ref-actor-alpha"] },
    { role: "interval", reference_ids: ["ref-missing"] }
  ], [{ role: "protected_resource_count", value: 2 }]);
  const result = await inspectProofPackBindings({
    contract, profileId, profileVersion, evaluationInput: supplied
  });
  assert.equal(result.reference_roles.find(({ role }) => role === "actor").status,
    "validly_bound");
  const interval = result.reference_roles.find(({ role }) => role === "interval");
  assert.equal(interval.status, "incompatible");
  assert(interval.diagnostics.some(({ code }) =>
    code === "reference_role_binding_dangling"));
  assert.equal(result.number_roles[0].status, "validly_bound");
  assert.equal(result.summary.status, "invalid");
});

test("number candidates preserve ambiguity and exact occurrence facts", async () => {
  const result = await inspectProofPackBindings({
    contract: await contractFixture(), profileId, profileVersion
  });
  const number = result.number_roles.find(
    ({ role }) => role === "protected_resource_count"
  );
  assert.equal(number.status, "ambiguous");
  assert.deepEqual(number.compatible_candidates.map(({ value }) => value), [1, 2]);
  assert.deepEqual(number.compatible_candidates[0].proposition_ids,
    ["prop-count-one"]);
});

test("property, contract-array, intent, and evaluation order preserve bytes", async () => {
  const contract = await contractFixture();
  const input = evaluationInput([
    { role: "interval", reference_ids: ["ref-interval"] },
    { role: "actor", reference_ids: ["ref-actor-alpha"] }
  ], [{ role: "protected_resource_count", value: 1 }]);
  const baseline = await inspectProofPackBindings({
    contract, profileId, profileVersion, requestedIntents: [intentId],
    evaluationInput: input
  });
  const reordered = await inspectProofPackBindings({
    evaluationInput: {
      ...input,
      reference_bindings: [...input.reference_bindings].reverse()
    },
    requestedIntents: [intentId],
    profileVersion,
    profileId,
    contract: {
      ...contract,
      references: [...contract.references].reverse(),
      propositions: [...contract.propositions].reverse()
    }
  });
  assert.equal(canonicalProofPackBindingAssistanceJson(reordered),
    canonicalProofPackBindingAssistanceJson(baseline));
});

test("stale identity, incompatible intent, malformed contract, and overrides fail closed", async () => {
  const contract = await contractFixture();
  await assert.rejects(inspectProofPackBindings({
    contract, profileId, profileVersion: "0.0.0"
  }));
  await assert.rejects(inspectProofPackBindings({
    contract, profileId, profileVersion,
    requestedIntents: ["controlled-proof-intent.lossless-projection"]
  }));
  await assert.rejects(inspectProofPackBindings({
    contract: {}, profileId, profileVersion
  }), (error) => error.code === "proof_pack_binding_contract_invalid");
  for (const key of [
    "catalog", "profilePath", "root", "module", "executable", "environment"
  ]) await assert.rejects(inspectProofPackBindings({
    contract, profileId, profileVersion, [key]: "forged"
  }), (error) => error.code === "proof_pack_binding_request_option_unsupported");
  for (const flag of [
    "--catalog", "--profile-path", "--root", "--module", "--executable",
    "--environment"
  ]) assert.throws(() => parseArgs([flag, "forged"]), /unknown argument/u);
});

test("supplied binding validation rejects requested intents as an unsupported option", async () => {
  const contract = await contractFixture();
  await assert.rejects(validateSuppliedProofPackBindings({
    contract, profileId, profileVersion,
    requestedIntents: [intentId]
  }), (error) => error.code === "proof_pack_binding_request_option_unsupported" &&
    error.details.unsupported_options.length === 1 &&
    error.details.unsupported_options[0] === "requestedIntents");
});

test("stable test-validity bindings pass while invalid and mixed families fail closed",
  async () => {
    const fixture = await testValidityFixture();
    const result = await inspectProofPackBindings({
      contract: fixture.contract,
      profileId: "proof.verification.test-validity",
      profileVersion: "2.0.0",
      requestedIntents: ["controlled-proof-intent.test-verification-validity"],
      evaluationInput: fixture.input
    });
    assert.equal(result.summary.status, "valid");
    assert.deepEqual(result.evaluation_input_diagnostics, []);
    assert.equal(fixture.input.evaluation_stage, "pre_dispatch");
    const crossPack = await inspectProofPackBindings({
      contract: fixture.contract, profileId, profileVersion
    });
    assert.equal(crossPack.profile_id, profileId);
    for (const { mutate } of [{
      mutate: (value) => { delete value.test_proof_version; }
    }, {
      mutate: (value) => { delete value.test_proofs[0].candidate_execution_provider; }
    }, {
      mutate: (value) => { value.test_proofs[0].candidate_execution_provider.provider_id =
        "launcher.unknown"; }
    }, {
      mutate: (value) => {
        value.schema_version = "controlled-acceptance-contract.unknown";
        value.profile_id = "acceptance-contract.standard.experimental.unknown";
        delete value.test_proof_version;
        delete value.test_proofs;
      }
    }, {
      mutate: (value) => {
        value.profile_id = "acceptance-contract.standard.experimental.v0.2";
      }
    }]) {
      const contract = structuredClone(fixture.contract);
      mutate(contract);
      await assert.rejects(inspectProofPackBindings({
        contract,
        profileId: "proof.verification.test-validity",
        profileVersion: "2.0.0"
      }), (error) => error.code === "proof_pack_binding_contract_invalid" &&
        error.details.diagnostics.diagnostics.length > 0 &&
        error.details.diagnostics.diagnostics.every((diagnostic) =>
          typeof diagnostic.code === "string" || typeof diagnostic.keyword === "string"));
    }
  });

const TEST_VALIDITY_PACK = Object.freeze({
  profileId: "proof.verification.test-validity",
  profileVersion: "2.0.0"
});

test("the WK-2392-shaped two-role population is valid once component and suite are bound",
  async () => {
    const fixture = await testValidityFixture();
    const validate = (evaluationInput) => validateSuppliedProofPackBindings({
      contract: fixture.contract, ...TEST_VALIDITY_PACK, evaluationInput
    });

    const valid = await validate(fixture.input);
    assert.deepEqual(valid.summary, {
      reference_role_count: 2,
      number_role_count: 0,
      incompatible_binding_count: 0,
      status: "valid"
    });
    assert.deepEqual(valid.evaluation_input_diagnostics, []);
    assert.deepEqual(valid.reference_roles.map(({ role, status }) => [role, status]),
      [["component", "validly_bound"], ["suite", "validly_bound"]]);
    assert.deepEqual(valid.number_roles, []);

    for (const role of ["component", "suite"]) {
      const input = structuredClone(fixture.input);
      input.reference_bindings = input.reference_bindings.filter((binding) =>
        binding.role !== role);
      const result = await validate(input);
      assert.equal(result.summary.status, "invalid");
      assert.equal(result.summary.incompatible_binding_count, 1);
      assert.deepEqual(result.evaluation_input_diagnostics, [{
        cardinality: "exactly_one",
        code: "required_role_binding_absent",
        role,
        role_kind: "reference"
      }]);
      assert.equal(result.reference_roles.find((entry) => entry.role === role).status,
        "unbound");
    }

    const substituted = structuredClone(fixture.input);
    substituted.reference_bindings.find(({ role }) => role === "suite")
      .reference_ids = ["ref-component"];
    const incompatible = await validate(substituted);
    assert.equal(incompatible.summary.status, "invalid");
    assert.equal(incompatible.summary.incompatible_binding_count, 1);
    const suite = incompatible.reference_roles.find(({ role }) => role === "suite");
    assert.equal(suite.status, "incompatible");
    assert.ok(suite.diagnostics.some(({ code, reference_id: referenceId }) =>
      code === "reference_role_binding_type_mismatch" &&
      referenceId === "ref-component"));
  });

test("an invalid summary always names a failing role or diagnostic", async () => {
  const fixture = await testValidityFixture();
  const contract = await contractFixture();
  const cases = [
    ["no bindings at all", { contract: fixture.contract, ...TEST_VALIDITY_PACK,
      evaluationInput: { ...structuredClone(fixture.input), reference_bindings: [] } }],
    ["a superseded evaluation-input version", { contract: fixture.contract,
      ...TEST_VALIDITY_PACK, evaluationInput: {
        ...structuredClone(fixture.input),
        input_version: "controlled-contract-test-validity-evaluation-input.v1"
      } }],
    ["a dangling reference", { contract, profileId, profileVersion,
      evaluationInput: evaluationInput([
        { role: "actor", reference_ids: ["ref-actor-alpha"] },
        { role: "interval", reference_ids: ["ref-missing"] }
      ], [{ role: "protected_resource_count", value: 2 }]) }],
    ["an unknown supplied role", { contract, profileId, profileVersion,
      evaluationInput: evaluationInput([
        { role: "unknown_role", reference_ids: ["ref-actor-alpha"] }
      ]) }]
  ];
  for (const [label, request] of cases) {
    const result = await validateSuppliedProofPackBindings(request);
    assert.equal(result.summary.status, "invalid", label);
    assert.ok(result.summary.incompatible_binding_count > 0, label);
    const named = [
      ...result.evaluation_input_diagnostics,
      ...result.reference_roles.flatMap(({ diagnostics }) => diagnostics),
      ...result.number_roles.flatMap(({ diagnostics }) => diagnostics)
    ];
    assert.ok(named.length > 0, label);
    assert.ok(named.every(({ code }) => typeof code === "string" && code.length > 0),
      label);
  }
});

test("an unsupplied optional role is satisfied by absence, not reported invalid",
  async () => {
    const fixture = buildResultShapeConformanceFixture({
      role_id_overrides: { optional_members: ["ref-member-note-string"] },
      mutate_input(input) {
        input.reference_bindings = input.reference_bindings.filter(({ role }) =>
          role !== "optional_members");
      }
    });
    fixture.contract.test_proofs = buildStableTestProofPopulation(fixture.contract);
    fixture.input.input_version =
      "controlled-contract-verification-profile-input.v1";
    fixture.input.stable_evaluation = {};
    const request = {
      contract: fixture.contract,
      profileId: "proof.result-shape.conformance",
      profileVersion: "2.0.0"
    };
    const result = await validateSuppliedProofPackBindings({
      ...request, evaluationInput: fixture.input
    });
    const optional = result.reference_roles.find(({ role }) =>
      role === "optional_members");
    assert.equal(optional.status, "unbound");
    assert.deepEqual(result.evaluation_input_diagnostics, []);
    assert.equal(result.summary.incompatible_binding_count, 0);
    assert.equal(result.summary.status, "valid");

    const incompatibleInput = structuredClone(fixture.input);
    incompatibleInput.reference_bindings.push({
      role: "optional_members", reference_ids: ["ref-missing-optional-member"]
    });
    const incompatible = await validateSuppliedProofPackBindings({
      ...request, evaluationInput: incompatibleInput
    });
    assert.equal(incompatible.summary.status, "invalid");
    assert.ok(incompatible.summary.incompatible_binding_count > 0);
    assert.equal(incompatible.reference_roles.find(({ role }) =>
      role === "optional_members").status, "incompatible");
  });

test("the page, the assistance result, and binding validation agree on one summary",
  async () => {
    const fixture = await testValidityFixture();
    const input = structuredClone(fixture.input);
    input.reference_bindings = input.reference_bindings.filter(({ role }) =>
      role !== "suite");
    const request = {
      contract: fixture.contract,
      profileId: TEST_VALIDITY_PACK.profileId,
      profileVersion: TEST_VALIDITY_PACK.profileVersion,
      evaluationInput: input
    };
    const [assistance, page, validation] = await Promise.all([
      inspectProofPackBindings(request),
      inspectProofPackBindingsPage({ ...request, maximumItems: 0 }),
      validateSuppliedProofPackBindings(request)
    ]);
    assert.deepEqual(assistance.summary, validation.summary);
    assert.deepEqual(page.summary, validation.summary);
    assert.deepEqual(assistance.evaluation_input_diagnostics,
      validation.evaluation_input_diagnostics);
    assert.deepEqual(page.evaluation_input_diagnostics,
      validation.evaluation_input_diagnostics);
  });

test("many compatible candidates fail the output bound instead of truncating", async () => {
  const contract = await contractFixture();
  contract.references.push(...Array.from({ length: 900 }, (_, index) =>
    reference(`ref-extra-${String(index).padStart(4, "0")}`, "cc:process")
  ));
  let legacyBytes;
  await assert.rejects(inspectProofPackBindings({
    contract, profileId, profileVersion
  }), (error) => error instanceof ProofPackBindingAssistanceError &&
    error.code === "proof_pack_binding_result_too_large" &&
    (legacyBytes = error.details.byte_length) > MAX_BINDING_ASSISTANCE_BYTES);
  const first = await inspectProofPackBindingsPage({ contract, profileId,
    profileVersion, roles: ["actor"], maximumItems: 7 });
  assert.equal(first.population.returned_count, 7);
  assert.ok(first.population.total_count > first.population.returned_count);
  assert.equal(first.proof_pack_authoring.status, "recoverable");
  assert.equal(Object.hasOwn(first, "next_call"), false);
  assert.equal(Object.hasOwn(first, "next_action"), false);
  assert.equal(JSON.stringify(first.proof_pack_authoring).includes("compatible_values"), false);
  const second = await inspectProofPackBindingsPage({ contract, profileId,
    profileVersion, roles: ["actor"], offset: 7, maximumItems: 7 });
  assert.equal(second.items[0].candidate.reference_id,
    first.items.at(-1).candidate.reference_id.replace(/(\d+)$/u,
      (value) => String(Number(value) + 1).padStart(value.length, "0")));
  assert.equal(first.digests.result, second.digests.result);
});

test("the recoverable authoring payload never appears on the proof-authoring route",
  async () => {
    const fixture = await testValidityFixture();
    const request = {
      contract: fixture.contract,
      profileId: TEST_VALIDITY_PACK.profileId,
      profileVersion: TEST_VALIDITY_PACK.profileVersion,
      maximumItems: 0
    };

    const withoutInput = await inspectProofPackBindingsPage(request);
    assert.equal(withoutInput.proof_pack_authoring.status, "recoverable");

    const authoring = await inspectProofPackBindingsPage({
      ...request, evaluationInput: fixture.input
    });
    assert.equal(Object.hasOwn(authoring, "proof_pack_authoring"), false);
    assert.equal(authoring.summary.status, "valid");
    const { maximumItems: _page, ...assistanceRequest } = request;
    const assistance = await inspectProofPackBindings({
      ...assistanceRequest, evaluationInput: fixture.input
    });
    assert.equal(Object.hasOwn(assistance, "proof_pack_authoring"), false);
  });

test("the published type declarations and the runtime exports are the same surface",
  async () => {
    const declared = [...(await readFile(new URL(
      "lib/proof-pack-binding-assistance.d.mts", packageRoot
    ), "utf8")).matchAll(
      /^export (?:declare )?(?:const|function|class) ([A-Za-z0-9_]+)/gmu
    )].map(([, name]) => name).sort();
    const runtime = Object.keys(await import(
      "../lib/proof-pack-binding-assistance.mjs"
    )).sort();
    assert.deepEqual(declared, runtime);
  });

test("the bounded CLI emits canonical output and rejects invalid supplied bindings", async () => {
  const cli = new URL("bin/inspect-proof-pack-bindings.mjs", packageRoot);
  const root = await mkdtemp(path.join(os.tmpdir(), "binding-cli-"));
  try {
    const contractPath = path.join(root, "contract.json");
    await writeFile(contractPath, `${JSON.stringify(await contractFixture(), null, 2)}\n`);
    const args = [
      cli.pathname, "--input", contractPath,
      "--profile-id", "proof.scope.write-confinement",
      "--profile-version", "2.0.0"
    ];
    const { stdout } = await execFileAsync(process.execPath, args, {
      env: childEnvironment(), maxBuffer: MAX_BINDING_ASSISTANCE_BYTES + 1024
    });
    assert.equal(validateProofPackBindingAssistance(JSON.parse(stdout)), true);
    assert.ok(Buffer.byteLength(stdout, "utf8") <= MAX_BINDING_ASSISTANCE_BYTES);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
