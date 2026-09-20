import assert from "node:assert/strict";
import test from "node:test";

import {
  STABLE_TEST_PROOF_AUTHORING_LIMITS,
  StableTestProofContractError,
  applyStableVerificationBundles,
  buildStableTestProofBindingTemplate,
  canonicalStableTestProofContractJson,
  describeStableTestProofAuthoring,
  projectStableTestProofSelector,
  queryStableTestProofBindings,
  replaceStableTestProofBindings,
  resolveStableTestProofBindingPopulation,
  resolveStableTestProofProviderBindings,
  validateStableTestProofContract
} from "../../lib/test-proof-contract-v1.mjs";
import {
  PROVIDER_REFUSAL_PRECEDENCE,
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
  resolveTestProofProviderCompatibility
} from "../../lib/test-proof-provider-registry.mjs";
import { validateAndResolveNativeContractV1 } from
  "../../lib/native-contract-carrier-v1.mjs";
import * as vocabularyExports from "../../lib/test-proof-contract-v1.mjs";

function binding() {
  return {
    test_proof_id: "test-proof-component",
    verification_claim_id: "claim-suite-covers-component",
    system_under_test_boundary: {
      boundary_id: "sut-boundary-component", kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/test-proof-contract-v1.mjs",
      subject_reference_ids: ["ref-component"]
    },
    observable_result: { observable_id: "observable-component", kind: "return_value",
      proposition_id: "prop-suite-covers-component" },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{ falsifier_id: "falsifier-component", strategy: "dependency_failure",
      proposition_id: "prop-component-absent", expected_outcome: "verification_fails",
      mutation: { mutation_id: "mutation-component", mechanism: "module_substitution",
        target_kind: "module",
        module_path: "packages/controlled-contract/lib/test-proof-contract-v1.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: "2.0.0", capability: "falsifier_execution" } }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal",
      boundary_kind: "module", observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    test_selector: { name: "component assertion", nesting: 0 },
    prohibited_shortcuts: ["source_text_inspection"]
  };
}

function contract() {
  return {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references: [
      { reference_id: "ref-component", type_term: "cc:runtime_component",
        identity: { kind: "profile_term", term: "example-component" } },
      { reference_id: "ref-suite", type_term: "cc:test",
        identity: { kind: "profile_term", term: "example-suite" } }
    ],
    propositions: [
      { proposition_id: "prop-component-exists", subject_reference_id: "ref-component",
        operator: "boolean:exists",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "boolean", value: true }] },
      { proposition_id: "prop-suite-covers-component", subject_reference_id: "ref-suite",
        operator: "reference:covers",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "reference", reference_id: "ref-component" }] },
      { proposition_id: "prop-component-absent", subject_reference_id: "ref-component",
        operator: "boolean:exists",
        applicability_context: { mode: "unconditional", operand_reference_ids: [] },
        operands: [{ kind: "boolean", value: false }] }
    ],
    claims: [
      { claim_id: "claim-component-exists", kind: "behavior", modality: "MUST",
        proposition_id: "prop-component-exists" },
      { claim_id: "claim-suite-covers-component", kind: "verification", modality: "MUST",
        proposition_id: "prop-suite-covers-component", verification_method: "test_execution",
        falsifying_proposition_id: "prop-component-absent" }
    ],
    relations: [{ relation_id: "rel-suite-verifies-component", role: "verifies",
      source_claim_id: "claim-suite-covers-component",
      target_claim_id: "claim-component-exists" }],
    collections: [], residue: [], annotations: [],
    test_proof_version: "controlled-contract-test-proof.v1",
    test_proofs: [binding()]
  };
}

function errorCode(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof StableTestProofContractError);
    errorCode.value = error.code;
    assert.ok(error.details.diagnostics.returned_count > 0);
    return true;
  });
  return errorCode.value;
}

function zeroTestContract() {
  const source = contract();
  source.claims[1].verification_method = "inspection";
  source.test_proofs = [];
  return source;
}

function verificationBundle() {
  return {
    schema_version: "controlled-contract-verification-bundle.v1",
    verification_id: "claim-suite-exec",
    references: [],
    propositions: [{ proposition_id: "prop-suite-exec",
      subject_reference_id: "ref-suite", operator: "boolean:exists",
      applicability_context: { mode: "unconditional", operand_reference_ids: [] },
      operands: [{ kind: "boolean", value: true }] }],
    claims: [{ ...contract().claims.find(({ kind }) => kind === "verification"),
      claim_id: "claim-suite-exec", proposition_id: "prop-suite-exec" }],
    relations: [{ relation_id: "rel-suite-exec-verifies-component", role: "verifies",
      source_claim_id: "claim-suite-exec", target_claim_id: "claim-component-exists" }],
    collections: [],
    residue: [],
    annotations: [],
    test_proof: { ...binding(), verification_claim_id: "claim-suite-exec",
      test_proof_id: "test-proof-suite-exec",
      observable_result: { ...binding().observable_result,
        proposition_id: "prop-suite-exec" } }
  };
}

function populatedContract(bindingCount) {
  const source = contract();
  const longModulePath = `packages/${"population-segment/".repeat(20)}module.mjs`;
  source.test_proofs[0].system_under_test_boundary.runtime_module_path = longModulePath;
  source.test_proofs[0].falsifiers[0].mutation.module_path = longModulePath;
  const operations = [];
  for (let index = 1; index < bindingCount; index += 1) {
    const suffix = `population-${String(index).padStart(2, "0")}`;
    const bundle = verificationBundle();
    bundle.verification_id = `claim-${suffix}`;
    bundle.propositions[0].proposition_id = `prop-${suffix}`;
    bundle.claims[0].claim_id = bundle.verification_id;
    bundle.claims[0].proposition_id = bundle.propositions[0].proposition_id;
    bundle.relations[0].relation_id = `rel-${suffix}-verifies-component`;
    bundle.relations[0].source_claim_id = bundle.verification_id;
    bundle.test_proof.test_proof_id = `test-proof-${suffix}`;
    bundle.test_proof.verification_claim_id = bundle.verification_id;
    bundle.test_proof.system_under_test_boundary.boundary_id = `sut-boundary-${suffix}`;
    bundle.test_proof.system_under_test_boundary.runtime_module_path = longModulePath;
    bundle.test_proof.observable_result.observable_id = `observable-${suffix}`;
    bundle.test_proof.observable_result.proposition_id = bundle.propositions[0].proposition_id;
    bundle.test_proof.falsifiers[0].falsifier_id = `falsifier-${suffix}`;
    bundle.test_proof.falsifiers[0].mutation.mutation_id = `mutation-${suffix}`;
    bundle.test_proof.falsifiers[0].mutation.module_path = longModulePath;
    bundle.test_proof.test_selector = { name: `assertion ${suffix}`, nesting: 0 };
    operations.push({ op: "upsert", verification_id: bundle.verification_id, bundle });
  }
  return applyStableVerificationBundles({ contract: source, operations }).contract;
}

function inspectionReplacementBundle() {
  const source = zeroTestContract();
  const verification = source.claims.find(({ kind }) => kind === "verification");
  const propositionIds = new Set([
    verification.proposition_id, verification.falsifying_proposition_id
  ]);
  return {
    schema_version: "controlled-contract-verification-bundle.v1",
    verification_id: verification.claim_id,
    references: [],
    propositions: source.propositions.filter(({ proposition_id: identity }) =>
      propositionIds.has(identity)),
    claims: [{ ...verification, verification_method: "test_execution" }],
    relations: source.relations.filter(({ source_claim_id: sourceId,
      target_claim_id: targetId }) =>
      sourceId === verification.claim_id || targetId === verification.claim_id),
    collections: [],
    residue: [],
    annotations: [],
    test_proof: binding()
  };
}

function mutuallyReferencingBundle(identity, suffix, otherIdentity) {
  const bundle = verificationBundle();
  bundle.verification_id = identity;
  bundle.propositions[0].proposition_id = `prop-${suffix}`;
  bundle.claims[0].claim_id = identity;
  bundle.claims[0].proposition_id = `prop-${suffix}`;
  bundle.relations[0].relation_id = `rel-${suffix}-verifies-component`;
  bundle.relations[0].source_claim_id = identity;
  bundle.collections = [{ collection_id: `set-${suffix}`,
    collection_kind: "closed_set", member_claim_ids: [identity, otherIdentity] }];
  bundle.test_proof = {
    ...bundle.test_proof,
    test_proof_id: `test-proof-${suffix}`,
    verification_claim_id: identity,
    system_under_test_boundary: {
      ...bundle.test_proof.system_under_test_boundary,
      boundary_id: `sut-boundary-${suffix}`
    },
    observable_result: {
      ...bundle.test_proof.observable_result,
      observable_id: `observable-${suffix}`,
      proposition_id: `prop-${suffix}`
    },
    falsifiers: bundle.test_proof.falsifiers.map((falsifier) => ({
      ...falsifier,
      falsifier_id: `falsifier-${suffix}`,
      mutation: { ...falsifier.mutation, mutation_id: `mutation-${suffix}` }
    })),
    test_selector: { name: `assertion ${suffix}`, nesting: 0 }
  };
  return bundle;
}

test("stable authoring validates, canonicalizes, queries, and replaces atomically", () => {
  const source = contract();
  assert.equal(validateStableTestProofContract(source).valid, true);
  assert.equal(canonicalStableTestProofContractJson(source).endsWith("\n"), true);
  const selected = queryStableTestProofBindings({ contract: source,
    verificationIds: ["claim-suite-covers-component"] });
  assert.equal(selected.matched_count, 1);
  assert.deepEqual(selected.bindings, [binding()]);
  const replacement = binding();
  replacement.test_selector = { name: "replacement assertion", nesting: 2 };
  const result = replaceStableTestProofBindings({ contract: source, replacements: [{
    op: "replace", verification_id: "claim-suite-covers-component", binding: replacement
  }] });
  assert.deepEqual(result.contract.test_proofs[0].test_selector,
    { name: "replacement assertion", nesting: 2 });
  assert.deepEqual(source.test_proofs[0].test_selector,
    { name: "component assertion", nesting: 0 });
  assert.ok(result.contract_digest.startsWith("sha256:"));
});

test("runtime population resolution is independent of the public query byte budget", () => {
  const source = populatedContract(9);
  const verificationIds = source.test_proofs.map(
    ({ verification_claim_id: verificationId }) => verificationId
  );
  assert.equal(verificationIds.length, 9);
  assert.equal(errorCode(() => queryStableTestProofBindings({
    contract: source, verificationIds
  })), "stable_test_proof_query_too_large");
  const resolved = resolveStableTestProofBindingPopulation({
    contract: source, verificationIds
  });
  assert.equal(resolved.schema_version,
    "controlled-contract-test-proof-runtime-binding-population.v1");
  assert.equal(resolved.status, "complete");
  assert.equal(resolved.requested_count, 9);
  assert.equal(resolved.matched_count, 9);
  assert.equal(resolved.bindings.length, 9);
  assert.ok(Buffer.byteLength(JSON.stringify(resolved), "utf8") >
    STABLE_TEST_PROOF_AUTHORING_LIMITS.query_result_bytes);
});

test("the declarative selector is projected exactly and never carries execution state", () => {
  const selector = projectStableTestProofSelector(binding());
  assert.deepEqual(selector, { name: "component assertion", nesting: 0 });
  assert.equal(Object.isFrozen(selector), true);

  const unwritten = binding();
  unwritten.test_selector = { name: "a test nobody has written", nesting: 3 };
  assert.equal(validateStableTestProofContract({
    ...contract(), test_proofs: [unwritten]
  }).valid, true);
  assert.deepEqual(projectStableTestProofSelector(unwritten),
    { name: "a test nobody has written", nesting: 3 });
  const serialized = JSON.stringify(describeStableTestProofAuthoring());
  for (const retired of ["coverage_disposition", "runtime_test_identity", "readiness",
    "test_inventory", "baseline"]) {
    assert.equal(serialized.includes(retired), false, retired);
  }
});

test("a malformed declarative selector is refused by the projector and the carrier alike", () => {
  const cases = [
    ["absent", (value) => { delete value.test_selector; }],
    ["null", (value) => { value.test_selector = null; }],
    ["empty name", (value) => { value.test_selector = { name: "", nesting: 0 }; }],
    ["negative nesting", (value) => { value.test_selector = { name: "x", nesting: -1 }; }],
    ["fractional nesting", (value) => { value.test_selector = { name: "x", nesting: 1.5 }; }],
    ["unsupported member", (value) => {
      value.test_selector = { name: "x", nesting: 0, test_id: "test-observed" };
    }],
    ["oversized name", (value) => {
      value.test_selector = { name: "n".repeat(513), nesting: 0 };
    }]
  ];
  for (const [label, mutate] of cases) {
    const malformed = binding();
    mutate(malformed);
    assert.throws(() => projectStableTestProofSelector(malformed), (error) =>
      error instanceof StableTestProofContractError &&
      error.code === "stable_test_proof_selector_invalid", label);
    const validated = validateStableTestProofContract({
      ...contract(), test_proofs: [malformed]
    });
    assert.equal(validated.valid, false, label);

    assert.ok(validated.diagnostics.diagnostics.some(({ pointer }) =>
      pointer.startsWith("/test_proofs/0")), label);
  }
});

test("verification bundles add and remove a complete test graph atomically", () => {
  const source = zeroTestContract();
  const bundle = verificationBundle();
  assert.equal(validateStableTestProofContract(source).valid, true);
  const added = applyStableVerificationBundles({ contract: source, operations: [{
    op: "upsert", verification_id: bundle.verification_id, bundle
  }] });
  assert.equal(added.contract.claims.at(-1).verification_method, "test_execution");
  assert.deepEqual(added.contract.test_proofs, [bundle.test_proof]);
  assert.deepEqual(source.test_proofs, []);

  const idempotent = applyStableVerificationBundles({ contract: added.contract,
    operations: [{ op: "upsert", verification_id: bundle.verification_id, bundle }] });
  assert.deepEqual(idempotent.changed_verification_ids, []);
  assert.equal(idempotent.contract_digest, added.contract_digest);

  const removed = applyStableVerificationBundles({ contract: added.contract,
    operations: [{ op: "remove", verification_id: bundle.verification_id, bundle }] });
  assert.deepEqual(removed.contract, source);
  assert.deepEqual(removed.changed_verification_ids, [bundle.verification_id]);
});

test("verification bundle upsert replaces an exclusive inspection or analysis graph", () => {
  for (const method of ["inspection", "analysis"]) {
    const source = zeroTestContract();
    source.claims.find(({ kind }) => kind === "verification").verification_method = method;
    const bundle = inspectionReplacementBundle();
    const replaced = applyStableVerificationBundles({ contract: source, operations: [{
      op: "upsert", verification_id: bundle.verification_id, bundle
    }] });
    assert.equal(validateStableTestProofContract(replaced.contract).valid, true);
    assert.equal(replaced.contract.claims.find(
      ({ claim_id: identity }) => identity === bundle.verification_id
    ).verification_method, "test_execution");
    assert.deepEqual(replaced.contract.test_proofs.filter(
      ({ verification_claim_id: identity }) => identity === bundle.verification_id
    ), [bundle.test_proof]);
  }

  const external = zeroTestContract();
  const bundle = inspectionReplacementBundle();
  external.claims.push({ claim_id: "claim-external-evidence", kind: "evidence",
    modality: "MUST", proposition_id: bundle.claims[0].proposition_id });
  const before = JSON.stringify(external);
  assert.equal(errorCode(() => applyStableVerificationBundles({
    contract: external,
    operations: [{ op: "upsert", verification_id: bundle.verification_id, bundle }]
  })), "stable_verification_bundle_removal_external_reference");
  assert.equal(JSON.stringify(external), before);

  const existingTestExecution = contract();
  const mismatch = inspectionReplacementBundle();
  mismatch.test_proof.test_selector = { name: "different", nesting: 0 };
  assert.equal(errorCode(() => applyStableVerificationBundles({
    contract: existingTestExecution,
    operations: [{ op: "upsert", verification_id: mismatch.verification_id,
      bundle: mismatch }]
  })), "stable_verification_bundle_proof_replacement_forbidden");
});

test("verification bundle removals evaluate references against the final batch", () => {
  const source = zeroTestContract();
  const first = mutuallyReferencingBundle("claim-first-exec", "first",
    "claim-second-exec");
  const second = mutuallyReferencingBundle("claim-second-exec", "second",
    "claim-first-exec");
  const added = applyStableVerificationBundles({ contract: source, operations: [
    { op: "upsert", verification_id: first.verification_id, bundle: first },
    { op: "upsert", verification_id: second.verification_id, bundle: second }
  ] }).contract;
  const removed = applyStableVerificationBundles({ contract: added, operations: [
    { op: "remove", verification_id: first.verification_id, bundle: first },
    { op: "remove", verification_id: second.verification_id, bundle: second }
  ] });
  assert.deepEqual(removed.contract, source);

  const before = JSON.stringify(added);
  assert.equal(errorCode(() => applyStableVerificationBundles({
    contract: added,
    operations: [{ op: "remove", verification_id: first.verification_id, bundle: first }]
  })), "stable_verification_bundle_removal_external_reference");
  assert.equal(JSON.stringify(added), before);
});

test("verification bundle mutation is closed, exact, bounded, and removal-safe", () => {
  const source = zeroTestContract();
  const bundle = verificationBundle();
  const omitted = structuredClone(bundle);
  delete omitted.annotations;
  assert.equal(errorCode(() => applyStableVerificationBundles({ contract: source,
    operations: [{ op: "upsert", verification_id: bundle.verification_id,
      bundle: omitted }] })), "stable_verification_bundle_input_invalid");
  assert.equal(errorCode(() => applyStableVerificationBundles({ contract: source,
    operations: [{ op: "upsert", verification_id: bundle.verification_id,
      bundle: { ...bundle, invented: true } }] })),
  "stable_verification_bundle_input_invalid");
  assert.equal(errorCode(() => applyStableVerificationBundles({ contract: source,
    operations: Array.from({ length: 65 }, () => ({ op: "upsert",
      verification_id: bundle.verification_id, bundle })) })),
  "stable_verification_bundle_operations_invalid");

  const added = applyStableVerificationBundles({ contract: source, operations: [{
    op: "upsert", verification_id: bundle.verification_id, bundle
  }] }).contract;
  const mismatch = structuredClone(bundle);
  mismatch.test_proof.test_selector = { name: "different", nesting: 0 };
  assert.equal(errorCode(() => applyStableVerificationBundles({ contract: added,
    operations: [{ op: "remove", verification_id: bundle.verification_id,
      bundle: mismatch }] })), "stable_verification_bundle_content_mismatch");

  const externallyReferenced = structuredClone(added);
  externallyReferenced.collections.push({ collection_id: "set-verifications",
    collection_kind: "closed_set", member_claim_ids: [bundle.verification_id] });
  const removalBundle = structuredClone(bundle);
  assert.equal(validateStableTestProofContract(externallyReferenced).valid, true);
  assert.equal(errorCode(() => applyStableVerificationBundles({
    contract: externallyReferenced,
    operations: [{ op: "remove", verification_id: bundle.verification_id,
      bundle: removalBundle }]
  })), "stable_verification_bundle_removal_external_reference");
});

test("stable authoring refuses caller authority, family substitution, and invalid operations", () => {
  assert.equal(errorCode(() => queryStableTestProofBindings({ contract: contract(),
    verificationIds: ["claim-suite-covers-component"], registry: {} })),
  "stable_test_proof_input_invalid");
  for (const [mutate, code] of [
    [(value) => { value.schema_version = "controlled-acceptance-contract.experimental.v0.2"; },
      "stable_family_experimental_substitution"],
    [(value) => { delete value.test_proof_version; }, "stable_family_partial_state"],
    [(value) => { value.schema_version = "controlled-acceptance-contract.unknown"; },
      "stable_family_identity_unknown"]
  ]) {
    const source = contract();
    mutate(source);
    assert.equal(errorCode(() => queryStableTestProofBindings({ contract: source,
      verificationIds: ["claim-suite-covers-component"] })), code);
  }
  assert.equal(errorCode(() => queryStableTestProofBindings({ contract: contract(),
    verificationIds: ["claim-unknown"] })), "stable_test_proof_verification_unknown");
  assert.equal(errorCode(() => replaceStableTestProofBindings({ contract: contract(),
    replacements: [{ op: "remove", verification_id: "claim-suite-covers-component" }] })),
  "stable_test_proof_replacements_invalid");
});

test("provider owner returns every frozen incompatibility code in precedence order", () => {
  const valid = { provider_id: "launcher.node-test-v8-coverage",
    provider_version: "1.0.0", capability: "boundary_traversal",
    capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
    observation_mechanism: "node_test_v8_coverage",
    evidence_artifact_types: ["boundary_trace"] };
  const cases = [
    [null, {}, PROVIDER_REFUSAL_PRECEDENCE[0]],
    [{ provider_id: "launcher.node-test-v8-coverage" }, {}, PROVIDER_REFUSAL_PRECEDENCE[1]],
    [{ ...valid, provider_id: "launcher.unknown" }, {}, PROVIDER_REFUSAL_PRECEDENCE[2]],
    [{ ...valid, provider_version: "0.0.0" }, {}, PROVIDER_REFUSAL_PRECEDENCE[3]],
    [{ ...valid, capability: "candidate_execution" }, {}, PROVIDER_REFUSAL_PRECEDENCE[4]],
    [{ ...valid, capability_snapshot_digest: `sha256:${"0".repeat(64)}` }, {},
      PROVIDER_REFUSAL_PRECEDENCE[5]],
    [{ ...valid, observation_mechanism: "printed_marker" }, {},
      PROVIDER_REFUSAL_PRECEDENCE[6]],
    [valid, { observation_seam: "printed_marker" }, PROVIDER_REFUSAL_PRECEDENCE[7]],
    [{ ...valid, evidence_artifact_types: ["stdout"] }, {},
      PROVIDER_REFUSAL_PRECEDENCE[8]],
    [valid, { strategy: "dependency_failure" }, PROVIDER_REFUSAL_PRECEDENCE[9]],
    [valid, { boundary_kind: "process" }, PROVIDER_REFUSAL_PRECEDENCE[10]]
  ];
  for (const [provider, extra, code] of cases) {
    const result = resolveTestProofProviderCompatibility({ provider,
      capability: "boundary_traversal", pointer: "/provider", require_snapshot: true,
      ...extra });
    assert.equal(result.code, code);
  }
  assert.deepEqual(PROVIDER_REFUSAL_PRECEDENCE, cases.map((entry) => entry[2]));
  assert.equal(resolveStableTestProofProviderBindings(binding()).valid, true);
});

test("stable provider resolution distinguishes schema validity from boundary mismatch", () => {
  const mismatch = contract();
  mismatch.test_proofs[0].system_under_test_boundary.kind = "process";
  delete mismatch.test_proofs[0].system_under_test_boundary.runtime_module_path;
  assert.equal(validateAndResolveNativeContractV1(mismatch).schema_valid, true);
  const validation = validateStableTestProofContract(mismatch);
  assert.equal(validation.valid, false);
  assert.equal(validation.diagnostics.diagnostics[0].code,
    "stable_test_proof_provider_boundary_mismatch");
  assert.equal(errorCode(() => resolveStableTestProofProviderBindings(
    mismatch.test_proofs[0]
  )), "stable_test_proof_provider_boundary_mismatch");

  const malformed = contract();
  malformed.test_proofs[0].system_under_test_boundary.kind = "process";
  assert.equal(validateAndResolveNativeContractV1(malformed).schema_valid, false);
  const malformedValidation = validateStableTestProofContract(malformed);
  assert.equal(malformedValidation.valid, false);
  assert.equal(malformedValidation.diagnostics.diagnostics[0].code,
    "stable_contract_schema_invalid");
  assert.notEqual(malformedValidation.diagnostics.diagnostics[0].code,
    "stable_test_proof_provider_boundary_mismatch");
});

test("description freezes the stable identities, limits, and registry snapshot", () => {
  const description = describeStableTestProofAuthoring();
  assert.equal(description.contract_schema_version, "controlled-acceptance-contract.v1");
  assert.equal(description.provider_registry.capability_snapshot_digest,
    TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST);
  assert.deepEqual(description.limits, STABLE_TEST_PROOF_AUTHORING_LIMITS);
  assert.equal(JSON.stringify(description).includes("migration_required"), false);
});

function setPointer(root, pointer, value) {
  const parts = pointer.split("/").slice(1);
  let node = root;
  for (const part of parts.slice(0, -1)) {
    node = node[/^[0-9]+$/u.test(part) ? Number(part) : part];
  }
  const last = parts.at(-1);
  node[/^[0-9]+$/u.test(last) ? Number(last) : last] = value;
}

function fillAuthorSemantics(bundle, authorSemantics) {

  let propositionCursor = 0;
  for (const hole of authorSemantics) {
    const [first] = hole.compatible_values ?? [];
    if (hole.target_type === "repo_module_path") {
      setPointer(bundle, hole.pointer, "packages/controlled-contract/current.mjs");
      continue;
    }
    if (hole.target_type === "test_name") {
      setPointer(bundle, hole.pointer, "authored assertion");
      continue;
    }
    if (hole.target_type === "test_nesting") {
      setPointer(bundle, hole.pointer, 0);
      continue;
    }
    assert.ok(first !== undefined, `no candidate for ${hole.pointer}`);
    if (hole.target_type === "proposition_id") {
      const candidates = hole.compatible_values;
      setPointer(bundle, hole.pointer,
        candidates[propositionCursor % candidates.length]);
      propositionCursor += 1;
      continue;
    }
    setPointer(bundle, hole.pointer,
      hole.cardinality === "one_or_more" ? [first] : first);
  }
}

test("the verification-bundle vocabulary is derived, closed, and provider-bound", () => {
  const {
    VERIFICATION_BUNDLE_VOCABULARY, VERIFICATION_BUNDLE_FIELDS,
    VERIFICATION_BUNDLE_SCHEMA_VERSION
  } = vocabularyExports;
  assert.equal(VERIFICATION_BUNDLE_VOCABULARY.schema_version,
    VERIFICATION_BUNDLE_SCHEMA_VERSION);
  assert.deepEqual([...VERIFICATION_BUNDLE_VOCABULARY.required_fields],
    [...VERIFICATION_BUNDLE_FIELDS]);
  assert.equal(describeStableTestProofAuthoring().verification_bundle.schema_version,
    VERIFICATION_BUNDLE_SCHEMA_VERSION);

  for (const capability of ["candidate_execution", "falsifier_execution",
    "boundary_traversal"]) {
    const requirement = VERIFICATION_BUNDLE_VOCABULARY.providers[capability];
    assert.equal(requirement.resolved, true, capability);
    assert.match(requirement.provider_version, /^[0-9]+\.[0-9]+\.[0-9]+$/u);
  }
  assert.deepEqual(
    VERIFICATION_BUNDLE_VOCABULARY.target_types.required_prohibited_shortcuts,
    ["source_text_inspection"]);
});

test("the operation-ready bundle template is constructible from its author semantics", () => {
  const { buildVerificationBundleTemplate } = vocabularyExports;

  let source = contract();
  for (const [label, verificationId] of [
    ["one-verification", "claim-authored-verification"],
    ["two-verification", "claim-second-authored-verification"]
  ]) {
    const template = buildVerificationBundleTemplate({ contract: source, verificationId });

    assert.equal(JSON.stringify(template.bundle).includes("null"), false, label);
    assert.equal(JSON.stringify(template).includes("executable"), false, label);
    assert.equal(template.bundle.test_proof.candidate_execution_provider.provider_id,
      "launcher.node-test", label);
    assert.equal(template.bundle.test_proof.traversal_provider.boundary_kind,
      template.bundle.test_proof.system_under_test_boundary.kind, label);
    const bundle = structuredClone(template.bundle);
    fillAuthorSemantics(bundle, template.author_semantics);
    const applied = applyStableVerificationBundles({
      contract: source,
      operations: [{ op: "upsert", verification_id: verificationId, bundle }]
    });
    assert.deepEqual(applied.changed_verification_ids, [verificationId], label);
    assert.equal(validateStableTestProofContract(applied.contract).valid, true, label);
    assert.equal(applied.contract.claims.find(
      ({ claim_id: identity }) => identity === verificationId
    ).verification_method, "test_execution", label);
    source = applied.contract;
  }
  assert.equal(source.claims.filter(({ kind }) => kind === "verification").length, 3);
  assert.equal(source.test_proofs.length, 3);
});

function contractWithEvidenceClaim() {
  const source = contract();
  source.propositions.push({
    proposition_id: "prop-coverage-report-recorded",
    subject_reference_id: "ref-suite", operator: "boolean:exists",
    applicability_context: { mode: "unconditional", operand_reference_ids: [] },
    operands: [{ kind: "boolean", value: true }]
  });
  source.claims.push({
    claim_id: "claim-coverage-report-recorded", kind: "evidence", modality: "MUST",
    proposition_id: "prop-coverage-report-recorded"
  });
  return source;
}

test("every advertised verifies target is a behavior claim the DAG accepts", () => {
  const { buildVerificationBundleTemplate } = vocabularyExports;
  const source = contractWithEvidenceClaim();
  const evidenceIds = source.claims.filter(({ kind }) => kind === "evidence")
    .map(({ claim_id: identity }) => identity);
  const behaviorIds = source.claims.filter(({ kind }) => kind === "behavior")
    .map(({ claim_id: identity }) => identity);
  assert.ok(evidenceIds.length > 0);
  assert.ok(behaviorIds.length > 0);

  const verificationId = "claim-authored-verification";
  const template = buildVerificationBundleTemplate({ contract: source, verificationId });
  const targets = template.author_semantics.find(
    ({ pointer }) => pointer === "/relations/0/target_claim_id");
  assert.equal(targets.target_type, "behavior_claim_id");

  assert.deepEqual([...targets.compatible_values].sort(), [...behaviorIds].sort());
  for (const identity of evidenceIds) {
    assert.equal(targets.compatible_values.includes(identity), false, identity);
  }

  for (const candidate of targets.compatible_values) {
    const bundle = structuredClone(template.bundle);
    fillAuthorSemantics(bundle, template.author_semantics);
    setPointer(bundle, "/relations/0/target_claim_id", candidate);
    const applied = applyStableVerificationBundles({
      contract: source,
      operations: [{ op: "upsert", verification_id: verificationId, bundle }]
    });
    assert.deepEqual(applied.changed_verification_ids, [verificationId], candidate);
    assert.equal(validateStableTestProofContract(applied.contract).valid, true, candidate);
  }

  for (const identity of evidenceIds) {
    const bundle = structuredClone(template.bundle);
    fillAuthorSemantics(bundle, template.author_semantics);
    setPointer(bundle, "/relations/0/target_claim_id", identity);
    assert.throws(() => applyStableVerificationBundles({
      contract: source,
      operations: [{ op: "upsert", verification_id: verificationId, bundle }]
    }), (error) => {
      assert.ok(error.details.diagnostics.diagnostics.some(
        ({ code }) => code === "verifies_target_type_mismatch"), identity);
      return true;
    });
  }
});

test("an empty verification identity refuses before any template is built", () => {
  const { buildVerificationBundleTemplate } = vocabularyExports;
  assert.throws(() => buildVerificationBundleTemplate({ verificationId: "" }),
    (error) => error.code === "stable_verification_bundle_input_invalid");
});

test("forced invocation admits explicit closed selections and keeps dependency failure separate", () => {
  const source = contract();
  const falsifier = source.test_proofs[0].falsifiers[0];
  falsifier.strategy = "forced_invocation";
  Object.assign(falsifier.mutation, { entry_export: "runNativePermissionProbeProcess",
    operation: { module_path: "packages/agent-launch-cli/src/lib/workspace-agent-launch-core.mjs",
      export_name: "superviseChildLaunch" }, invocation: "first_original_return_no_arguments" });
  assert.equal(validateStableTestProofContract(source).valid, true);
  for (const mutate of [
    value => { delete value.mutation.entry_export; },
    value => { delete value.mutation.operation; },
    value => { delete value.mutation.invocation; }
  ]) {
    const changed = structuredClone(source);
    mutate(changed.test_proofs[0].falsifiers[0]);
    assert.equal(validateAndResolveNativeContractV1(changed).schema_valid, true);
    const execution = validateStableTestProofContract(changed);
    assert.equal(execution.valid, false);
    assert.ok(execution.diagnostics.diagnostics.some(
      diagnostic => diagnostic.code === "stable_test_proof_incomplete"));
  }
  for (const mutate of [
    value => { value.mutation.operation.command = "arbitrary"; },
    value => { value.mutation.operation.export_name = "call()"; },
    value => { value.mutation.operation.module_path = "../escape.mjs"; },
    value => { value.mutation.invocation = "before_entry"; },
    value => { value.mutation.source = "arbitrary execution"; },
    value => { value.strategy = "dependency_failure"; }
  ]) {
    const changed = structuredClone(source);
    mutate(changed.test_proofs[0].falsifiers[0]);
    assert.equal(validateAndResolveNativeContractV1(changed).schema_valid, false);
    assert.equal(validateStableTestProofContract(changed).valid, false);
  }
  const mismatched = structuredClone(source);
  mismatched.test_proofs[0].falsifiers[0].execution_provider = {
    provider_id: "launcher.node-test", provider_version: "1.0.0", capability: "falsifier_execution"
  };
  assert.equal(validateStableTestProofContract(mismatched).valid, false);
  assert.equal(validateStableTestProofContract(contract()).valid, true);
});

test("forced-invocation template binds the strategy and closed recipe explicitly", () => {
  const template = buildStableTestProofBindingTemplate({ verificationId: "claim-verify-forbidden",
    strategy: "forced_invocation" });
  const falsifier = template.binding.falsifiers[0];
  assert.equal(falsifier.strategy, "forced_invocation");
  assert.equal(falsifier.mutation.invocation, "first_original_return_no_arguments");
  assert.equal(falsifier.execution_provider.provider_id, "launcher.node-test-module-fault");
  for (const suffix of ["entry_export", "operation/module_path", "operation/export_name"]) {
    assert.ok(template.author_semantics.some(hole => hole.pointer === `/falsifiers/0/mutation/${suffix}`));
  }
  assert.throws(() => buildStableTestProofBindingTemplate({ verificationId: "claim-verify-forbidden",
    strategy: "unknown" }));
});
