import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildIdempotencyV2Fixture } from
  "../proof-packs/idempotency-v2-test-fixture.mjs";
import { VOCABULARY_DIGESTS } from
  "../../vocabulary/controlled-contract-vocabulary.v1.mjs";
import { TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST } from
  "../../lib/test-proof-provider-registry.mjs";
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
        provider_version: "2.0.0", capability: "falsifier_execution" }
    }],
    traversal_provider: { mode: "provider",
      provider_id: "launcher.node-test-v8-coverage", provider_version: "1.0.0",
      capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion",
      evidence_artifact_type: "boundary_trace" },
    test_selector: { name: `${suffix} assertion`, nesting: 0 },
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

const SINGLE_AXIS_WEAKENINGS = Object.freeze([
  ["missing-sut-boundary", "test_validity_sut_boundary_mismatch"],
  ["wrong-sut-boundary", "test_validity_sut_boundary_mismatch"],
  ["missing-observable", "test_validity_observable_mismatch"],
  ["wrong-observable", "test_validity_observable_mismatch"],
  ["missing-falsifier", "test_validity_falsifier_missing"],
  ["inert-falsifier", "test_validity_falsifier_inert"],
  ["echoed-reason-without-mutation", "test_validity_falsifier_mutation_unobserved"],
  ["wrong-structured-reason", "test_validity_falsifier_reason_mismatch"],
  ["printed-traversal-marker", "test_validity_traversal_instrumentation_missing"],
  ["echoed-environment-values", "test_validity_test_controlled_output_forbidden"],
  ["inert-mutation", "test_validity_falsifier_mutation_unobserved"],
  ["unrelated-verification-failure", "test_validity_falsifier_wrong_verification"],
  ["supported-traversal-without-instrumentation", "test_validity_traversal_instrumentation_missing"],
  ["test-authored-artifact", "test_validity_launcher_artifact_forged"],
  ["forged-artifact-digest", "test_validity_launcher_artifact_forged"],
  ["provider-strategy-mismatch", "test_validity_provider_strategy_mismatch"],
  ["provider-boundary-mismatch", "test_validity_provider_boundary_mismatch"],
  ["provider-observation-seam-mismatch", "test_validity_traversal_observation_seam_mismatch"],
  ["skipped-falsifier", "test_validity_falsifier_skipped"],
  ["wrong-target-falsifier", "test_validity_falsifier_wrong_target"],
  ["selected-test-unobserved", "test_validity_selected_test_unobserved"],
  ["selected-test-renamed", "test_validity_selected_test_unobserved"],
  ["selected-test-skipped", "test_validity_selected_test_skipped"],
  ["selected-test-failed", "test_validity_observed_test_failed"],
  ["multiple-declared-tests", "test_validity_declared_selection_invalid"],
  ["duplicate-declared-test", "test_validity_declared_test_duplicate"],
  ["duplicate-observed-test", "test_validity_observed_test_duplicate"],
  ["source-text-inspection", "test_validity_prohibited_source_text_inspection"],
  ["supported-traversal-missing", "test_validity_traversal_evidence_missing"],
  ["unsupported-traversal-overclaim", "test_validity_unsupported_traversal_overclaimed"],
  ["missing-candidate-provider", "test_validity_candidate_provider_missing"],
  ["missing-falsifier-provider", "test_validity_falsifier_provider_missing"],
  ["unknown-provider", "test_validity_provider_unknown"],
  ["wrong-provider-version", "test_validity_provider_version_mismatch"],
  ["provider-capability-mismatch", "test_validity_provider_capability_mismatch"],
  ["incomplete-falsifier-provider-population", "test_validity_falsifier_provider_population_incomplete"],
  ["falsely-supported-traversal", "test_validity_unsupported_traversal_overclaimed"],
  ["caller-injected-executor", "test_validity_caller_executor_forbidden"],
  ["wrong-provider-snapshot-digest", "test_validity_provider_snapshot_digest_mismatch"]
].map(([case_id, expected_code]) => Object.freeze({ case_id, expected_code })));
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

  const testId = `test-${binding.test_proof_id.slice("test-proof-".length)}`;
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
      declared_test_ids: [testId],
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

test("all 37 admitted profiles retain their applicable stable semantic validity", async () => {
  assert.equal(profileCatalog.packs.length, 37);
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
    assert.fail(`${pack.profile_id}: every admitted profile is stable-v1 (${source.schema_version})`);
  }
  assert.equal(expandedProfileCount, 36);
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

test("native stable test validity requires exactly the one declared selected test", () => {
  const fixture = nativeTestValidityFixture();
  const binding = fixture.contract.test_proofs[0];
  const witness = fixture.evaluation_input.stable_evaluation.test_validity.find(
    ({ verification_id: verificationId }) =>
      verificationId === binding.verification_claim_id
  );
  const [first] = witness.test_inventory.declared_test_ids;

  witness.test_inventory.observed_tests.push({ test_id: "test-sibling", status: "passed" },
    { test_id: "test-sibling-skipped", status: "skipped" });
  assert.equal(evaluateVerificationProfileV1(fixture).stable_evaluation.satisfaction,
    "satisfied");

  witness.test_inventory.declared_test_ids = [first, "test-sibling"];
  const result = evaluateVerificationProfileV1(fixture);
  assert.equal(result.stable_evaluation.satisfaction, "unsatisfied");
  assert.ok(result.diagnostics.some(
    ({ code }) => code === "test_validity_declared_selection_invalid"));
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

  for (const field of ["declared_test_ids", "observed_tests"]) {
    const subject = nativeTestValidityFixture();
    delete subject.evaluation_input.stable_evaluation.test_validity[0].test_inventory[field];
    assert.throws(() => evaluateVerificationProfileV1(subject),
      (error) => error.code === "stable_family_refused", field);
  }
  for (const field of ["declared_test_ids", "observed_tests"]) {
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
    case "selected-test-unobserved": input.test_inventory.observed_tests = []; break;
    case "selected-test-renamed": observed[0].test_id = "test-renamed"; break;
    case "selected-test-skipped": observed[0].status = "skipped"; break;
    case "selected-test-failed": observed[0].status = "failed"; break;
    case "multiple-declared-tests":
      input.test_inventory.declared_test_ids.push("test-second");
      observed.push({ test_id: "test-second", status: "passed" });
      break;
    case "duplicate-declared-test":
      input.test_inventory.declared_test_ids.push(input.test_inventory.declared_test_ids[0]);
      break;
    case "duplicate-observed-test": observed.push({ ...observed[0] }); break;
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
        registry_id: "launcher.test-proof-provider-registry", registry_version: "1.3.0" };
      break;
    case "caller-injected-executor": input.candidate_execution.provider.path = "/tmp/run"; break;
    case "wrong-provider-snapshot-digest":
      input.candidate_execution.provider.capability_snapshot_digest =
        `sha256:${"0".repeat(64)}`;
      break;
    default: throw new Error(`unhandled weakening ${caseId}`);
  }
}

test("native stable evaluator rejects all 39 isolated test-validity weakenings", () => {
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
  for (const control of SINGLE_AXIS_WEAKENINGS) {
    const subject = nativeTestValidityFixture();
    weakenTestValidity(subject, control.case_id);
    const result = evaluateVerificationProfileV1(subject);
    assert.equal(result.satisfaction, "unsatisfied", control.case_id);
    const expectedCode = stableProviderCodes.get(control.case_id) ?? control.expected_code;
    assert.ok(result.diagnostics.some(({ code }) => code === expectedCode),
      `${control.case_id}:${JSON.stringify(result.diagnostics)}`);
    passed.push(control.case_id);
  }
  assert.equal(passed.length, 39);
});

test("the current definition and input reject removed proof classifications", () => {
  for (const stage of ["pre_dispatch", "post_delivery"]) {
    for (const member of ["evaluation_stages", "required_by_stage"]) {
      const fixture = stableFixture();
      if (member === "evaluation_stages") fixture.profile[member] = [stage];
      else fixture.profile.claim_patterns[0][member] = stage;
      assert.equal(validateProfileSchemaV1(fixture.profile), false);
    }
    const fixture = stableFixture();
    fixture.evaluation_input.evaluation_stage = stage;
    assert.throws(() => evaluateVerificationProfileV1({ contract: fixture.contract,
      profile: fixture.profile, evaluation_input: fixture.evaluation_input }), StableVerificationError);
  }
});

test("every satisfaction leaf remains required without a classification", () => {
  const fixture = nativeTestValidityFixture();
  const evaluate = (value) => evaluateVerificationProfileV1({ contract: value.contract,
    profile: value.profile, evaluation_input: value.evaluation_input });
  const positive = evaluate(fixture);
  assert.equal(positive.satisfaction, "satisfied");
  assert.equal(Object.hasOwn(positive, "evaluation_stage"), false);
  assert.equal(positive.pattern_results.some(({ status }) => status === "inactive"), false);

  for (const pattern of fixture.profile.claim_patterns) {
    const subject = structuredClone(fixture);
    const result = positive.pattern_results.find(({ pattern_id }) =>
      pattern_id === pattern.pattern_id);
    assert.ok(result, pattern.pattern_id);
    subject.contract.claims = subject.contract.claims.filter((claim) =>
      !result.matched_ids.includes(claim.claim_id));
    assert.ok(subject.contract.claims.length < fixture.contract.claims.length, pattern.pattern_id);
    try { assert.notEqual(evaluate(subject).satisfaction, "satisfied", pattern.pattern_id); }
    catch (error) { if (!(error instanceof StableVerificationError)) throw error; }
  }
});
