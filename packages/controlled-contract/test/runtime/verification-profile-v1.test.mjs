import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildIdempotencyV2Fixture } from
  "../proof-packs/idempotency-v2-test-fixture.mjs";
import { VOCABULARY_DIGESTS } from
  "../../vocabulary/controlled-contract-vocabulary.v1.mjs";
import { TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST } from
  "../../lib/test-proof-contract.mjs";
import {
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  VOCABULARY_VERSION_V1
} from "../../lib/native-contract-carrier-v1.mjs";
import {
  EVALUATION_INPUT_VERSION_V1,
  PROFILE_SCHEMA_VERSION_V1,
  RESULT_VERSION_V1,
  validateProfileSchemaV1
} from "../../lib/verification-profile-schema-v1.mjs";
import {
  StableVerificationError,
  evaluateVerificationProfileV1,
  validateProfileSemanticsV1
} from "../../lib/verification-profile-v1.mjs";
import {
  validateProfileSchemaV034,
  validateProfileSemanticsV034
} from "../../lib/verification-profile-v034.mjs";

const profileCatalog = JSON.parse(await readFile(new URL(
  "../../profiles/catalog.json",
  import.meta.url
)));

function stableProfileIdentity(source) {
  return {
    ...structuredClone(source),
    schema_version: PROFILE_SCHEMA_VERSION_V1,
    contract_schema_version: SCHEMA_VERSION_V1,
    vocabulary_version: VOCABULARY_VERSION_V1,
    vocabulary_signature_digest: VOCABULARY_DIGESTS.signature,
    vocabulary_algebra_digest: VOCABULARY_DIGESTS.algebra,
    vocabulary_definitions_digest: VOCABULARY_DIGESTS.definitions,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete
  };
}

async function readAdmittedProfile(pack) {
  return JSON.parse(await readFile(new URL(
    `../../${pack.path}/profile.json`,
    import.meta.url
  )));
}

function proofForClaim(contract, claim) {
  const suffix = claim.claim_id.replace(/^claim-/u, "");
  const proposition = contract.propositions.find(
    ({ proposition_id: propositionId }) => propositionId === claim.proposition_id
  );
  return {
    test_proof_id: `test-proof-${suffix}`,
    verification_claim_id: claim.claim_id,
    system_under_test_boundary: {
      boundary_id: `sut-boundary-${suffix}`, kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/verification-profile-v1.mjs",
      subject_reference_ids: [proposition.subject_reference_id]
    },
    observable_result: {
      observable_id: `observable-${suffix}`, kind: "return_value",
      proposition_id: claim.proposition_id
    },
    candidate_execution_provider: {
      provider_id: "launcher.node-test", provider_version: "1.0.0",
      capability: "candidate_execution"
    },
    falsifiers: [{
      falsifier_id: `falsifier-${suffix}`, strategy: "dependency_failure",
      proposition_id: claim.falsifying_proposition_id,
      expected_outcome: "verification_fails",
      mutation: { mutation_id: `mutation-${suffix}`, mechanism: "module_substitution",
        target_kind: "module",
        module_path: "packages/controlled-contract/lib/verification-profile-v1.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: "1.0.0", capability: "falsifier_execution" }
    }],
    traversal_provider: { mode: "provider",
      provider_id: "launcher.node-test-v8-coverage", provider_version: "1.0.0",
      capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    coverage_disposition: { baseline_id: `coverage-baseline-${suffix}`,
      baseline_state: "complete_executed_inventory",
      items: [{ test_id: `test-${suffix}`, disposition: "preserved" }] },
    prohibited_shortcuts: ["coverage_percentage_only", "source_text_inspection"]
  };
}

function stableFixture() {
  const fixture = buildIdempotencyV2Fixture();
  fixture.contract.schema_version = SCHEMA_VERSION_V1;
  fixture.contract.vocabulary_version = VOCABULARY_VERSION_V1;
  fixture.contract.profile_id = PROFILE_ID_V1;
  fixture.contract.test_proof_version = TEST_PROOF_VERSION_V1;
  fixture.contract.test_proofs = fixture.contract.claims.filter(
    ({ kind, verification_method: method }) => kind === "verification" &&
      method === "test_execution"
  ).map((claim) => proofForClaim(fixture.contract, claim)).sort(
    (left, right) => left.verification_claim_id < right.verification_claim_id ? -1 : 1
  );
  fixture.profile.schema_version = PROFILE_SCHEMA_VERSION_V1;
  fixture.profile.contract_schema_version = SCHEMA_VERSION_V1;
  fixture.profile.vocabulary_version = VOCABULARY_VERSION_V1;
  fixture.profile.vocabulary_signature_digest = VOCABULARY_DIGESTS.signature;
  fixture.profile.vocabulary_algebra_digest = VOCABULARY_DIGESTS.algebra;
  fixture.profile.vocabulary_definitions_digest = VOCABULARY_DIGESTS.definitions;
  fixture.profile.vocabulary_complete_digest = VOCABULARY_DIGESTS.complete;
  fixture.input.input_version = EVALUATION_INPUT_VERSION_V1;
  fixture.input.stable_evaluation = {};
  return { contract: fixture.contract, profile: fixture.profile,
    evaluation_input: fixture.input };
}

const certificationCorpus = JSON.parse(await readFile(new URL(
  "../certification/profiles/proof.verification.test-validity/1.0.0/corpus.json",
  import.meta.url
)));
const evidenceArtifact = (character) => ({
  artifact_digest: `sha256:${character.repeat(64)}`,
  artifact_id: `artifact-${character.repeat(64)}`,
  artifact_owner: "launcher",
  test_controlled_output_used: false
});

function enableStableEvaluation(fixture) {
  fixture.profile.stable_capabilities = {
    semantic_mechanisms: ["association", "partition", "relation_match", "inverse",
      "transitive", "irreflexive", "adjacency", "acyclic"],
    test_validity: "provider_bound_test_validity.v1"
  };
  fixture.evaluation_input.stable_evaluation = {};
  return fixture;
}

function nativeTestValidityWitness(binding, artifactOffset = 0) {
  const artifactCharacters = artifactOffset === 0 ? ["a", "b", "c"] : ["d", "e", "f"];
  const testId = binding.coverage_disposition.items[0].test_id;
  return {
    verification_id: binding.verification_claim_id,
    test_proof_id: binding.test_proof_id,
    candidate_execution: {
      passed: true,
      observed_boundary_id: binding.system_under_test_boundary.boundary_id,
      observed_observable_id: binding.observable_result.observable_id,
      source_text_inspection_used: false,
      provider: { ...binding.candidate_execution_provider,
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST },
      observation: { mechanism: "node_test_structured_events",
        ...evidenceArtifact(artifactCharacters[0]) }
    },
    test_inventory: {
      declared_test_ids: [testId], baseline_executed_test_ids: [testId],
      observed_tests: [{ test_id: testId, status: "passed" }]
    },
    falsifier_executions: binding.falsifiers.map((falsifier, index) => ({
      falsifier_id: falsifier.falsifier_id, isolated: true, skipped: false,
      target_verification_failed: true,
      failure_proposition_id: falsifier.proposition_id,
      failure_reason_source: "launcher_structured_event",
      failure_reason_code: `test_proof_fault.${falsifier.strategy}.v1`,
      mutation: { mutation_id: falsifier.mutation.mutation_id,
        strategy: falsifier.strategy, applied: true,
        target_verification_id: binding.verification_claim_id },
      observation: { mechanism: "node_test_structured_events",
        ...evidenceArtifact(artifactCharacters[1]) },
      provider: { ...falsifier.execution_provider,
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        strategy: falsifier.strategy }
    })),
    boundary_traversal: {
      provider_support: "supported", result: "proven", authenticated: true,
      instrumented: true, observation_seam: binding.traversal_provider.observation_seam,
      boundary_id: binding.system_under_test_boundary.boundary_id,
      observable_id: binding.observable_result.observable_id,
      observation: { mechanism: "node_test_v8_coverage",
        ...evidenceArtifact(artifactCharacters[2]) },
      provider: { provider_id: binding.traversal_provider.provider_id,
        provider_version: binding.traversal_provider.provider_version,
        capability: binding.traversal_provider.capability,
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        boundary_kind: binding.traversal_provider.boundary_kind }
    }
  };
}

function nativeTestValidityFixture() {
  const fixture = enableStableEvaluation(stableFixture());
  fixture.profile.stable_capabilities.semantic_mechanisms = [];
  fixture.evaluation_input.stable_evaluation.test_validity =
    fixture.contract.test_proofs.map((binding, index) =>
      nativeTestValidityWitness(binding, index));
  return fixture;
}

test("stable evaluator composes the stable carrier, profile, population, and result", () => {
  const fixture = stableFixture();
  const result = evaluateVerificationProfileV1(fixture);
  assert.equal(result.result_version, RESULT_VERSION_V1);
  assert.equal(result.contract.schema_version, SCHEMA_VERSION_V1);
  assert.equal(result.vocabulary.version, VOCABULARY_VERSION_V1);
  assert.equal(result.profile_valid, true);
  assert.equal(result.contract_valid, true, JSON.stringify(result.diagnostics));
  assert.equal(typeof result.input_valid, "boolean");
});

test("all 38 admitted profiles retain their applicable stable semantic validity", async () => {
  assert.equal(profileCatalog.packs.length, 38);
  let expandedProfileCount = 0;
  let nativeTestValidityCount = 0;
  for (const pack of profileCatalog.packs) {
    const source = await readAdmittedProfile(pack);
    if (source.schema_version === PROFILE_SCHEMA_VERSION_V1) {
      assert.equal(validateProfileSchemaV1(source), true,
        `${pack.profile_id}: ${JSON.stringify(validateProfileSchemaV1.errors)}`);
      assert.deepEqual(validateProfileSemanticsV1(source), [], pack.profile_id);
      if (pack.profile_id === "proof.verification.test-validity") {
        nativeTestValidityCount += 1;
      } else {
        expandedProfileCount += 1;
      }
      continue;
    }
    if (source.schema_version !==
        "controlled-contract-verification-profile.experimental.v0.2") {
      assert.equal(pack.profile_id, "proof.verification.test-validity");
      nativeTestValidityCount += 1;
      continue;
    }
    assert.equal(validateProfileSchemaV034(source), true, pack.profile_id);
    const sourceDiagnostics = validateProfileSemanticsV034(source);
    assert.deepEqual(sourceDiagnostics, [], pack.profile_id);
    const migrated = stableProfileIdentity(source);
    assert.equal(validateProfileSchemaV1(migrated), true,
      `${pack.profile_id}: ${JSON.stringify(validateProfileSchemaV1.errors)}`);
    assert.deepEqual(validateProfileSemanticsV1(migrated), sourceDiagnostics,
      pack.profile_id);
    expandedProfileCount += 1;
  }
  assert.equal(expandedProfileCount, 37);
  assert.equal(nativeTestValidityCount, 1);
});

test("stable authentication and provenance complements are native and discriminating",
  async () => {
    const pack = profileCatalog.packs.find(({ profile_id: profileId }) =>
      profileId === "proof.authentication.direct-source-provenance"
    );
    const profile = stableProfileIdentity(await readAdmittedProfile(pack));
    assert.deepEqual(validateProfileSemanticsV1(profile), []);
    const axes = [
      ["verification-targets-evidence-authenticates-target",
        "verify-evidence-authenticates-target"],
      ["verification-targets-evidence-originates-from-source",
        "verify-evidence-originates-from-source"],
      ["verification-targets-target-has-source-of-record",
        "verify-target-has-source-of-record"],
      ["verification-targets-evidence-observed-in-attempt",
        "verify-evidence-observed-in-attempt"]
    ];
    for (const [relationPatternId, verificationPatternId] of axes) {
      const weakened = structuredClone(profile);
      weakened.claim_patterns.find(({ pattern_id: patternId }) =>
        patternId === verificationPatternId
      ).falsifying_proposition_template.operator = "reference:reads";
      const diagnostic = validateProfileSemanticsV1(weakened).find(
        ({ code, pattern_id: patternId }) =>
          code === "profile_verification_falsifier_not_complementary" &&
          patternId === relationPatternId
      );
      assert.ok(diagnostic, relationPatternId);
      assert.ok(diagnostic.reasons.includes("proposition_is_not_controlled_complement"),
        relationPatternId);
    }
  });

test("stable profile semantics have no v0.34 production dependency", async () => {
  const [stableSource, sharedSource] = await Promise.all([
    readFile(new URL("../../lib/verification-profile-v1.mjs", import.meta.url), "utf8"),
    readFile(new URL(
      "../../lib/verification-profile-expanded-semantics.mjs",
      import.meta.url
    ), "utf8")
  ]);
  assert.doesNotMatch(stableSource,
    /verification-profile-v034|cv\.experimental|vocabulary-v034/u);
  assert.doesNotMatch(sharedSource,
    /verification-profile-v034|verification-profile-v1|cv\.experimental/u);
});

test("stable evaluator refuses family substitution before evaluation", () => {
  const fixture = stableFixture();
  fixture.profile.schema_version = "controlled-contract-verification-profile.experimental.v0.2";
  assert.throws(() => evaluateVerificationProfileV1(fixture),
    (error) => error instanceof StableVerificationError && error.code === "stable_family_refused" &&
      error.details.stage === "identity");
});

test("property order does not alter the stable result", () => {
  const first = stableFixture();
  const reordered = { evaluation_input: first.evaluation_input,
    profile: first.profile, contract: first.contract };
  assert.deepEqual(evaluateVerificationProfileV1(first),
    evaluateVerificationProfileV1(reordered));
});

test("stable evaluator invokes every frozen semantic primitive", () => {
  const fixture = nativeTestValidityFixture();
  fixture.profile.stable_capabilities.semantic_mechanisms = ["association", "partition",
    "relation_match", "inverse", "transitive", "irreflexive", "adjacency", "acyclic"];
  const population = (id, members, ordered = false) => ({ population_id: id,
    completeness: "exact", authenticated: true, ordered, members });
  const testValidity = fixture.evaluation_input.stable_evaluation.test_validity;
  fixture.evaluation_input.stable_evaluation = {
    test_validity: testValidity,
    associations: [{ graph_id: "graph-valid", role_populations: {
      left: population("left", ["occ-a", "occ-b"]),
      right: population("right", ["occ-x", "occ-y"])
    }, associations: [
      { association_id: "association-a", roles: { left: "occ-a", right: "occ-x" } },
      { association_id: "association-b", roles: { left: "occ-b", right: "occ-y" } }
    ] }],
    partitions: [{ source_population: population("partition-source", ["a", "b", "c"]),
      parts: [{ part_id: "first", members: ["a", "b"] },
        { part_id: "second", members: ["c"] }] }],
    relations: [
      { population_id: "order", member_population: population("members", ["a", "b", "c"]),
        edges: [{ source: "a", target: "b" }, { source: "b", target: "c" },
          { source: "a", target: "c" }], irreflexive: true,
        assertions: [
          { kind: "match", mode: "exact", expected_edges: [
            { source: "a", target: "b" }, { source: "b", target: "c" },
            { source: "a", target: "c" }] },
          { kind: "inverse", inverse_edges: [{ source: "b", target: "a" },
            { source: "c", target: "b" }, { source: "c", target: "a" }] },
          { kind: "transitive" }, { kind: "acyclic" }
        ] },
      { population_id: "adjacency",
        member_population: population("sequence", ["a", "b", "c"], true),
        edges: [{ source: "a", target: "b" }, { source: "b", target: "c" }],
        assertions: [{ kind: "adjacency", ordered_occurrence_ids: ["a", "b", "c"] }] }
    ]
  };
  const result = evaluateVerificationProfileV1(fixture);
  assert.equal(result.stable_evaluation.satisfaction, "satisfied",
    JSON.stringify(result.diagnostics));
  assert.equal(result.stable_evaluation.semantic_request_count, 4);

  const ambiguous = structuredClone(fixture);
  ambiguous.evaluation_input.stable_evaluation.associations[0].associations = [
    { association_id: "association-a-x", roles: { left: "occ-a", right: "occ-x" } },
    { association_id: "association-a-y", roles: { left: "occ-a", right: "occ-y" } },
    { association_id: "association-b-x", roles: { left: "occ-b", right: "occ-x" } },
    { association_id: "association-b-y", roles: { left: "occ-b", right: "occ-y" } }
  ];
  const refused = evaluateVerificationProfileV1(ambiguous);
  assert.equal(refused.satisfaction, "unsatisfied");
  assert.ok(refused.diagnostics.some(({ code }) => code === "stable_association_ambiguous"));
});

test("stable evaluator refuses each semantic weakening at its primitive owner", () => {
  const population = (id, members) => ({ population_id: id,
    completeness: "exact", authenticated: true, ordered: false, members });
  const members = () => population("members", ["a", "b", "c"]);
  const cases = [
    ["stable_partition_overlap", { partitions: [{ source_population: members(), parts: [
      { part_id: "first", members: ["a", "b"] },
      { part_id: "second", members: ["b", "c"] }
    ] }] }],
    ["stable_relation_match_unsatisfied", { relations: [{ population_id: "match",
      member_population: members(), edges: [{ source: "a", target: "b" }],
      assertions: [{ kind: "match", mode: "exact",
        expected_edges: [{ source: "a", target: "c" }] }] }] }],
    ["stable_relation_inverse_mismatch", { relations: [{ population_id: "inverse",
      member_population: members(), edges: [{ source: "a", target: "b" }],
      assertions: [{ kind: "inverse", inverse_edges: [] }] }] }],
    ["stable_relation_transitive_consequence_missing", { relations: [{
      population_id: "transitive", member_population: members(),
      edges: [{ source: "a", target: "b" }, { source: "b", target: "c" }],
      assertions: [{ kind: "transitive" }] }] }],
    ["stable_relation_irreflexive_violation", { relations: [{ population_id: "irreflexive",
      member_population: members(), edges: [{ source: "a", target: "a" }],
      irreflexive: true, assertions: [] }] }],
    ["stable_relation_adjacency_mismatch", { relations: [{ population_id: "adjacency",
      member_population: members(), edges: [{ source: "a", target: "b" }],
      assertions: [{ kind: "adjacency", ordered_occurrence_ids: ["a", "b", "c"] }] }] }],
    ["stable_relation_cycle", { relations: [{ population_id: "cycle",
      member_population: members(), edges: [{ source: "a", target: "b" },
        { source: "b", target: "a" }], assertions: [{ kind: "acyclic" }] }] }]
  ];
  for (const [code, stableEvaluation] of cases) {
    const fixture = nativeTestValidityFixture();
    stableEvaluation.test_validity =
      fixture.evaluation_input.stable_evaluation.test_validity;
    fixture.evaluation_input.stable_evaluation = stableEvaluation;
    const result = evaluateVerificationProfileV1(fixture);
    assert.equal(result.satisfaction, "unsatisfied", code);
    assert.ok(result.diagnostics.some((entry) => entry.code === code),
      `${code}:${JSON.stringify(result.diagnostics)}`);
  }
});

test("native stable test validity accepts the complete provider-bound witness", () => {
  const result = evaluateVerificationProfileV1(nativeTestValidityFixture());
  assert.equal(result.result_version, RESULT_VERSION_V1);
  assert.equal(result.stable_evaluation.test_validity_evaluated, true);
  assert.equal(result.stable_evaluation.satisfaction, "satisfied");
});

test("native stable test validity retains the complete multi-test population", () => {
  const fixture = nativeTestValidityFixture();
  const binding = fixture.contract.test_proofs[0];
  const witness = fixture.evaluation_input.stable_evaluation.test_validity.find(
    ({ verification_id: verificationId }) =>
      verificationId === binding.verification_claim_id
  );
  const first = binding.coverage_disposition.items[0].test_id;
  const nested = "test-nested-selected";
  binding.coverage_disposition.items.push({ test_id: nested, disposition: "preserved" });
  binding.runtime_test_identity = { test_id: nested };
  witness.test_inventory = {
    declared_test_ids: [first, nested],
    baseline_executed_test_ids: [first, nested],
    observed_tests: [
      { test_id: first, status: "passed" },
      { test_id: nested, status: "passed" }
    ]
  };
  const result = evaluateVerificationProfileV1(fixture);
  assert.equal(result.stable_evaluation.satisfaction, "satisfied");
});

test("stable applicability requires complete evidence from profile and carrier authority", () => {
  const omitted = nativeTestValidityFixture();
  delete omitted.evaluation_input.stable_evaluation;
  assert.throws(() => evaluateVerificationProfileV1(omitted),
    (error) => error.code === "stable_family_refused");

  const empty = nativeTestValidityFixture();
  empty.evaluation_input.stable_evaluation = {};
  const emptyResult = evaluateVerificationProfileV1(empty);
  assert.equal(emptyResult.satisfaction, "unsatisfied");
  assert.ok(emptyResult.diagnostics.some(
    ({ code }) => code === "test_validity_witness_population_incomplete"));

  const noInventory = nativeTestValidityFixture();
  delete noInventory.evaluation_input.stable_evaluation.test_validity[0].test_inventory;
  const noInventoryResult = evaluateVerificationProfileV1(noInventory);
  assert.equal(noInventoryResult.satisfaction, "unsatisfied");
  assert.ok(noInventoryResult.diagnostics.some(
    ({ code }) => code === "test_validity_inventory_missing"));

  for (const field of [
    "declared_test_ids", "baseline_executed_test_ids", "observed_tests"
  ]) {
    const subject = nativeTestValidityFixture();
    delete subject.evaluation_input.stable_evaluation.test_validity[0].test_inventory[field];
    assert.throws(() => evaluateVerificationProfileV1(subject),
      (error) => error.code === "stable_family_refused", field);
  }
  for (const field of [
    "declared_test_ids", "baseline_executed_test_ids", "observed_tests"
  ]) {
    const subject = nativeTestValidityFixture();
    subject.evaluation_input.stable_evaluation.test_validity[0].test_inventory[field] = [];
    const result = evaluateVerificationProfileV1(subject);
    assert.equal(result.satisfaction, "unsatisfied", field);
  }

  const unrelated = stableFixture();
  unrelated.evaluation_input.stable_evaluation = {};
  assert.notEqual(evaluateVerificationProfileV1(unrelated).satisfaction, "invalid");
});

test("stable evaluator refuses incomplete adjacency projections at the native entrypoint", () => {
  const population = (values, ordered = true) => ({ population_id: "members",
    completeness: "exact", authenticated: true, ordered, members: values });
  const cases = [
    { members: ["a", "b", "c", "d"], edges: [
      { source: "a", target: "b" }, { source: "b", target: "c" }
    ], projection: ["a", "b", "c"] },
    { members: ["a", "b", "c"], edges: [
      { source: "a", target: "b" }, { source: "b", target: "c" }
    ], projection: ["a", "b", "c", "d"] },
    { members: ["a", "b", "c"], edges: [
      { source: "a", target: "b" }, { source: "b", target: "c" }
    ], projection: ["a", "b", "b"] },
    { members: ["a", "b", "c"], edges: [
      { source: "a", target: "b" }, { source: "b", target: "c" }
    ], projection: ["a", "b", "x"] },
    { members: ["a", "b", "c"], edges: [
      { source: "a", target: "b" }, { source: "b", target: "c" }
    ], projection: ["a", "c", "b"] }
  ];
  for (const item of cases) {
    const subject = nativeTestValidityFixture();
    subject.profile.stable_capabilities.semantic_mechanisms = ["adjacency"];
    const testValidity = subject.evaluation_input.stable_evaluation.test_validity;
    subject.evaluation_input.stable_evaluation = { test_validity: testValidity,
      relations: [{ population_id: "adjacency",
        member_population: population(item.members), edges: item.edges,
        assertions: [{ kind: "adjacency",
          ordered_occurrence_ids: item.projection }] }] };
    const result = evaluateVerificationProfileV1(subject);
    assert.equal(result.satisfaction, "unsatisfied");
    assert.ok(result.diagnostics.some(
      ({ code }) => code === "stable_relation_ordered_projection_invalid"));
  }
});

test("stable evaluator never upgrades raw occurrence-shaped populations", () => {
  const subject = nativeTestValidityFixture();
  subject.profile.stable_capabilities.semantic_mechanisms = ["association"];
  const testValidity = subject.evaluation_input.stable_evaluation.test_validity;
  const raw = (id, occurrenceId) => ({ population_id: id, completeness: "exact",
    authenticated: true, ordered: true, members: [{ occurrence_id: occurrenceId }] });
  subject.evaluation_input.stable_evaluation = { test_validity: testValidity,
    associations: [{ graph_id: "raw-occurrence-forgery", role_populations: {
      left: raw("left", "occ-forged-left"), right: raw("right", "occ-forged-right")
    }, associations: [{ association_id: "forged", roles: {
      left: "occ-forged-left", right: "occ-forged-right"
    } }] }] };
  const result = evaluateVerificationProfileV1(subject);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "stable_occurrence_source_unauthenticated"));
});

test("production evaluator publishes one bounded diagnostic projection", () => {
  const subject = nativeTestValidityFixture();
  subject.profile.stable_capabilities.semantic_mechanisms = ["partition"];
  const testValidity = subject.evaluation_input.stable_evaluation.test_validity;
  const sourcePopulation = { population_id: "source", completeness: "exact",
    authenticated: true, ordered: false, members: ["a"] };
  subject.evaluation_input.stable_evaluation = { test_validity: testValidity,
    partitions: Array.from({ length: 1000 }, () => ({
      source_population: sourcePopulation, parts: []
    })) };
  const result = evaluateVerificationProfileV1(subject);
  assert.equal(result.satisfaction, "unsatisfied");
  assert.equal(result.total_count, 1000);
  assert.equal(result.returned_count, 64);
  assert.equal(result.omitted_count, 936);
  assert.equal(result.truncated, true);
  assert.equal(result.diagnostics.length, result.returned_count);
  assert.ok(Buffer.byteLength(JSON.stringify(result.diagnostics), "utf8") <= 65536);
});

function weakenTestValidity(subject, caseId) {
  const input = subject.evaluation_input.stable_evaluation.test_validity[0];
  const binding = subject.contract.test_proofs[0];
  const falsifier = input.falsifier_executions[0];
  const traversal = input.boundary_traversal;
  const observed = input.test_inventory.observed_tests;
  switch (caseId) {
    case "missing-sut-boundary": delete input.candidate_execution.observed_boundary_id; break;
    case "wrong-sut-boundary":
      input.candidate_execution.observed_boundary_id = "boundary-wrong"; break;
    case "missing-observable": delete input.candidate_execution.observed_observable_id; break;
    case "wrong-observable":
      input.candidate_execution.observed_observable_id = "observable-wrong"; break;
    case "missing-falsifier": input.falsifier_executions = []; break;
    case "inert-falsifier": falsifier.target_verification_failed = false; break;
    case "echoed-reason-without-mutation":
      falsifier.mutation.applied = false;
      falsifier.test_reported_reason = falsifier.failure_reason_code;
      break;
    case "wrong-structured-reason":
      falsifier.failure_reason_code = "test_proof_fault.different_failure.v1"; break;
    case "printed-traversal-marker": traversal.instrumented = false; break;
    case "echoed-environment-values":
      input.candidate_execution.observation.test_controlled_output_used = true; break;
    case "inert-mutation":
      falsifier.mutation.applied = false;
      falsifier.target_verification_failed = false;
      break;
    case "unrelated-verification-failure":
      falsifier.mutation.target_verification_id = "claim-unrelated-verification"; break;
    case "supported-traversal-without-instrumentation": traversal.instrumented = false; break;
    case "test-authored-artifact":
      input.candidate_execution.observation.artifact_owner = "test_target"; break;
    case "forged-artifact-digest":
      input.candidate_execution.observation.artifact_id = `artifact-${"0".repeat(64)}`; break;
    case "provider-strategy-mismatch": falsifier.provider.strategy = "exception_path"; break;
    case "provider-boundary-mismatch": traversal.provider.boundary_kind = "process"; break;
    case "provider-observation-seam-mismatch":
      traversal.observation_seam = "printed_marker"; break;
    case "skipped-falsifier": falsifier.skipped = true; break;
    case "wrong-target-falsifier":
      falsifier.failure_proposition_id = binding.verification_claim_id; break;
    case "removed-test": input.test_inventory.observed_tests = []; break;
    case "renamed-test": observed[0].test_id = "test-renamed"; break;
    case "newly-skipped-test": observed[0].status = "skipped"; break;
    case "failed-observed-test": observed[0].status = "failed"; break;
    case "undispositioned-coverage":
      input.test_inventory.baseline_executed_test_ids.push("test-legacy"); break;
    case "source-text-inspection":
      input.candidate_execution.source_text_inspection_used = true; break;
    case "supported-traversal-missing": delete input.boundary_traversal; break;
    case "unsupported-traversal-overclaim": traversal.provider_support = "unsupported"; break;
    case "missing-candidate-provider": delete input.candidate_execution.provider; break;
    case "missing-falsifier-provider": delete falsifier.provider; break;
    case "unknown-provider":
      input.candidate_execution.provider.provider_id = "launcher.unknown"; break;
    case "wrong-provider-version":
      input.candidate_execution.provider.provider_version = "0.9.0"; break;
    case "provider-capability-mismatch":
      input.candidate_execution.provider.capability = "falsifier_execution"; break;
    case "incomplete-falsifier-provider-population":
      binding.falsifiers.push({ ...structuredClone(binding.falsifiers[0]),
        falsifier_id: "falsifier-second", mutation: {
          ...structuredClone(binding.falsifiers[0].mutation), mutation_id: "mutation-second"
        } });
      break;
    case "falsely-supported-traversal":
      binding.traversal_provider = { mode: "registry_unsupported",
        registry_id: "launcher.test-proof-provider-registry", registry_version: "1.0.0" };
      break;
    case "caller-injected-executor": input.candidate_execution.provider.path = "/tmp/run"; break;
    case "wrong-provider-snapshot-digest":
      input.candidate_execution.provider.capability_snapshot_digest =
        `sha256:${"0".repeat(64)}`;
      break;
    default: throw new Error(`unhandled weakening ${caseId}`);
  }
}

test("native stable evaluator rejects all 37 isolated test-validity weakenings", () => {
  const stableProviderCodes = new Map([
    ["provider-strategy-mismatch", "stable_test_proof_provider_strategy_mismatch"],
    ["provider-boundary-mismatch", "stable_test_proof_provider_boundary_mismatch"],
    ["provider-observation-seam-mismatch",
      "stable_test_proof_provider_observation_seam_mismatch"],
    ["missing-candidate-provider", "stable_test_proof_provider_missing"],
    ["missing-falsifier-provider", "stable_test_proof_provider_missing"],
    ["unknown-provider", "stable_test_proof_provider_unknown"],
    ["wrong-provider-version", "stable_test_proof_provider_version_mismatch"],
    ["provider-capability-mismatch",
      "stable_test_proof_provider_capability_mismatch"],
    ["falsely-supported-traversal", "stable_test_proof_provider_partial"],
    ["wrong-provider-snapshot-digest", "stable_test_proof_provider_snapshot_mismatch"]
  ]);
  const passed = [];
  for (const control of certificationCorpus.single_axis_weakenings) {
    const subject = nativeTestValidityFixture();
    weakenTestValidity(subject, control.case_id);
    const result = evaluateVerificationProfileV1(subject);
    assert.equal(result.satisfaction, "unsatisfied", control.case_id);
    const expectedCode = stableProviderCodes.get(control.case_id) ?? control.expected_code;
    assert.ok(result.diagnostics.some(({ code }) => code === expectedCode),
      `${control.case_id}:${JSON.stringify(result.diagnostics)}`);
    passed.push(control.case_id);
  }
  assert.equal(passed.length, 37);
});
