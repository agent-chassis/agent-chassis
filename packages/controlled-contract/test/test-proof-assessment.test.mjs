import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAX_TEST_PROOF_ASSESSMENT_INDEX_BYTES,
  TestProofRuntimeAssessmentError,
  assessTestProofContract,
  validateRuntimeTestProofAssessmentSchema,
  validateTestProofAssessmentSchema
} from "../lib/test-proof-assessment.mjs";
import {
  TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST
} from "../lib/test-proof-provider-registry.mjs";

const example = JSON.parse(await readFile(new URL(
  "../examples/minimal-controlled-acceptance-contract.v1.json", import.meta.url
)));

const experimental = Object.freeze({
  ...structuredClone(example),
  schema_version: "controlled-acceptance-contract.experimental.v0.2",
  vocabulary_version: "cv.experimental.0.34",
  profile_id: "acceptance-contract.standard.experimental.v0.2"
});

function proof(claimId = "claim-suite-covers-component", suffix = "component") {
  return {
    test_proof_id: `test-proof-${suffix}`,
    verification_claim_id: claimId,
    system_under_test_boundary: {
      boundary_id: `sut-boundary-${suffix}`,
      kind: "module",
      runtime_module_path: "packages/controlled-contract/lib/test-proof-contract-v1.mjs",
      subject_reference_ids: ["ref-component"]
    },
    observable_result: {
      observable_id: `observable-${suffix}`,
      kind: "return_value",
      proposition_id: "prop-suite-covers-component"
    },
    candidate_execution_provider: { provider_id: "launcher.node-test",
      provider_version: "1.0.0", capability: "candidate_execution" },
    falsifiers: [{
      falsifier_id: `falsifier-${suffix}`,
      strategy: "dependency_failure",
      proposition_id: "prop-component-absent",
      expected_outcome: "verification_fails",
      mutation: { mutation_id: `mutation-${suffix}`, mechanism: "module_substitution",
        target_kind: "module", module_path: "packages/controlled-contract/lib/test-proof-contract-v1.mjs" },
      execution_provider: { provider_id: "launcher.node-test-module-fault", provider_version: "2.0.0",
        capability: "falsifier_execution" }
    }],
    traversal_provider: { mode: "provider", provider_id: "launcher.node-test-v8-coverage",
      provider_version: "1.0.0", capability: "boundary_traversal", boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", evidence_artifact_type: "boundary_trace" },
    test_selector: { name: `${suffix} result is returned`, nesting: 0 },
    prohibited_shortcuts: ["source_text_inspection"]
  };
}

function migrated() {
  return { ...structuredClone(example), test_proofs: [proof()] };
}

function multiVerification() {
  const contract = migrated();
  contract.claims.push({
    claim_id: "claim-second-test", kind: "verification", modality: "MUST",
    proposition_id: "prop-suite-covers-component", verification_method: "test_execution",
    falsifying_proposition_id: "prop-component-absent"
  });
  contract.test_proofs.push(proof("claim-second-test", "second"));
  contract.relations.push({ relation_id: "rel-second-verifies-component", role: "verifies",
    source_claim_id: "claim-second-test", target_claim_id: "claim-component-exists" });
  contract.test_proofs.sort((left, right) =>
    left.verification_claim_id.localeCompare(right.verification_claim_id));
  return contract;
}

test("emits exactly one valid result per test_execution verification", () => {
  const contract = multiVerification();
  const assessment = assessTestProofContract(contract);
  assert.equal(assessment.result_count, 2);
  assert.deepEqual(assessment.results.map(({ verification_id: id }) => id),
    ["claim-second-test", "claim-suite-covers-component"]);
  assert.ok(assessment.results.every(({ status }) => status === "valid"),
    JSON.stringify(assessment.results));
  assert.equal(assessment.semantic_judgment, "not_performed_coordinator_owned");
  assert.equal(assessment.runtime_truth, "not_assessed");
  assert.equal(assessment.authority, "non_authoritative");
  assert.equal(validateTestProofAssessmentSchema(assessment), true);
});

test("reports stable field-addressed missing and invalid diagnostics", () => {
  const missing = migrated();
  missing.test_proofs = [];
  const missingResult = assessTestProofContract(missing).results[0];
  assert.equal(missingResult.status, "missing_binding");
  assert.deepEqual(missingResult.diagnostics, [{
    code: "test_proof_binding_missing",
    field: "/test_proofs",
    verification_id: "claim-suite-covers-component"
  }]);

  const invalid = migrated();
  invalid.test_proofs[0].prohibited_shortcuts = ["test_count_only"];
  const invalidResult = assessTestProofContract(invalid).results[0];
  assert.equal(invalidResult.status, "invalid");
  assert.ok(invalidResult.diagnostics.some(({ code, field }) =>
    code === "test_proof_source_text_shortcut_not_prohibited" &&
    field === "/test_proofs/0/prohibited_shortcuts"));
  assert.ok(invalidResult.diagnostics.some(({ field }) =>
    field.startsWith("/test_proofs/0")));
});

test("reports bounded complete-binding schema diagnostics at the affected fields", () => {
  const contract = migrated();
  delete contract.test_proofs[0].candidate_execution_provider.provider_version;
  delete contract.test_proofs[0].traversal_provider.observation_seam;

  const first = assessTestProofContract(contract).results[0];
  const second = assessTestProofContract(contract).results[0];
  assert.equal(first.status, "invalid");
  assert.deepEqual(second.diagnostics, first.diagnostics);
  assert.ok(first.diagnostics.some(({ code, field, package_diagnostic: diagnostic }) =>
    code === "test_proof_stable_test_proof_incomplete" &&
    field === "/test_proofs/0/candidate_execution_provider/provider_version" &&
    diagnostic.keyword === "required" &&
    diagnostic.property_kind === "missing"));
  assert.ok(first.diagnostics.some(({ code, field, package_diagnostic: diagnostic }) =>
    code === "test_proof_stable_test_proof_incomplete" &&
    field === "/test_proofs/0/traversal_provider/observation_seam" &&
    diagnostic.keyword === "required" &&
    diagnostic.property_kind === "missing"));
});

test("reports package-owned provider diagnostics at exact binding fields", () => {
  const contract = migrated();
  contract.test_proofs[0].candidate_execution_provider.provider_id = "launcher.unknown";
  const result = assessTestProofContract(contract).results[0];
  assert.equal(result.status, "invalid");
  assert.ok(result.diagnostics.some(({code, field}) =>
    code === "test_proof_stable_test_proof_provider_unknown" &&
    field === "/test_proofs/0/candidate_execution_provider/provider_id"));
  const diagnostic = result.diagnostics.find(({ code }) =>
    code === "test_proof_stable_test_proof_provider_unknown");
  assert.equal(diagnostic.package_diagnostic.reason_code,
    "stable_test_proof_provider_refused");
  assert.equal(diagnostic.package_diagnostic.field_pointer,
    "/candidate_execution_provider/provider_id");
  assert.equal(result.semantic_judgment, "not_performed_coordinator_owned");
});

test("reports strategy and boundary mismatches at package-owned fields", () => {
  const strategy = migrated();
  strategy.test_proofs[0].falsifiers[0].strategy = "result_inversion";
  assert.ok(assessTestProofContract(strategy).results[0].diagnostics.some(({code, field}) =>
    code === "test_proof_stable_test_proof_provider_strategy_mismatch" &&
    field.endsWith("/strategy")));

  const boundary = migrated();
  boundary.test_proofs[0].traversal_provider.boundary_kind = "process";
  assert.ok(assessTestProofContract(boundary).results[0].diagnostics.some(({code, field}) =>
    code === "test_proof_stable_test_proof_provider_boundary_mismatch" &&
    field.endsWith("/boundary_kind")));
});

test("compact output is bounded while the artifact remains lossless", () => {
  const contract = migrated();
  const assessment = assessTestProofContract(contract);
  assert.ok(assessment.compact_index.byte_length <=
    MAX_TEST_PROOF_ASSESSMENT_INDEX_BYTES);
  assert.equal(Buffer.byteLength(JSON.stringify(assessment.compact_index)),
    Buffer.byteLength(JSON.stringify(assessment.compact_index)));
  assert.equal(assessment.lossless_artifact.detail_count, assessment.results.length);
  assert.deepEqual(assessment.lossless_artifact.details, assessment.results);
  assert.equal(assessment.compact_index.artifact,
    assessment.lossless_artifact.content_reference);
});

test("experimental carriers remain readable only as refused assessment input", () => {
  const assessment = assessTestProofContract(structuredClone(experimental));
  assert.equal(assessment.result_count, 1);
  assert.equal(assessment.compact_index.status, "not_proven");
  assert.equal(assessment.results[0].status, "invalid");
  assert.equal(assessment.runtime_truth, "not_assessed");
  assert.equal(assessment.semantic_judgment, "not_performed_coordinator_owned");
});

const digest = (character) => `sha256:${character.repeat(64)}`;

const canonicalValue = (value) => Array.isArray(value) ? value.map(canonicalValue)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, canonicalValue(value[key])])) : value;

function artifact(kind, value) {
  const payload = canonicalValue(value);
  const content = `sha256:${createHash("sha256").update(
    `${JSON.stringify(payload)}\n`, "utf8"
  ).digest("hex")}`;
  return { artifact_id: `artifact-${content.slice(7)}`, kind, digest: content,
    owner: "launcher", payload };
}

function candidateResult(suffix) {
  return { mechanism: "node_test_structured_events", exit_code: 0,
    summary: { passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0, tests: 1 },
    pass_events: [{ type: "test:pass", test_id: `test-${"1".repeat(64)}`,
      name: suffix, file: `test/${suffix}.test.mjs`, nesting: 0,
      status: "passed" }],
    fail_events: [] };
}

function withCandidateResult(evidence, change) {
  const structured = structuredClone(evidence.execution_result.structured_result);
  change(structured);
  const previous = evidence.execution_result.evidence_artifact_ids[0];
  const candidate = artifact("structured_test_result", structured);
  evidence.execution_result.structured_result = structured;
  evidence.execution_result.evidence_artifact_ids = [candidate.artifact_id];
  evidence.artifacts = [...evidence.artifacts.filter(({ artifact_id: id }) => id !== previous),
    candidate].sort((left, right) => left.artifact_id < right.artifact_id ? -1 : 1);
  return evidence;
}

function receipt(claimId = "claim-suite-covers-component", suffix = "component") {
  const structuredResult = candidateResult(suffix);
  const candidate = artifact("structured_test_result", structuredResult);

  const modulePath = "packages/controlled-contract/lib/test-proof-contract-v1.mjs";
  const boundary = artifact("boundary_trace", { mechanism: "node_test_v8_coverage",
    boundary_kind: "module", module_path: modulePath,
    observable_seam: "node_test_structured_assertion", target_test_id: `test-${suffix}`,
    target_pass_observed: true, observed: true, covered_module_paths: [modulePath],
    structured_event_digest: candidate.digest });
  const falsifier = artifact("falsifier_result", { mechanism: "module_substitution",
    strategy: "dependency_failure", mutation_id: `mutation-${suffix}`,
    target_module_path: modulePath, target_test_id: `test-${suffix}`,
    witness_identity: "f".repeat(64), structured_event_digest: candidate.digest,
    observation: { dependency_invocation_count: 1, reached_assertion: true,
      selected_test_only: true, observed: true } });
  return {
    schema_version: "controlled-contract-test-proof-runtime-evidence.v2",
    test_proof_version: "controlled-contract-test-proof.v1",
    authority: "advisory_execution_facts",
    evidence_identity: { evidence_id: `test-proof-evidence-integrated-run-${suffix}`,
      run_id: "run-integrated", wk_id: "WK-2160", selected_unit: "WK-2160#SLICE-003",
      controlled_contract_generation: digest("b"),
      verification_id: claimId,
      source_snapshot_digest: digest("a"), command_id: "command-node-test",
      command_target: `test/${suffix}.test.mjs`, test_id: `test-${suffix}`,
      attempt: 1 },
    contract_binding: { contract_digest: digest("c"),
      contract_schema_version: "controlled-acceptance-contract.v1",
      verification_claim_id: claimId,
      test_proof_id: `test-proof-${suffix}` },
    execution_result: { status: "passed", exit_code: 0,
      attempt_id: `attempt-${"a".repeat(64)}`,
      structured_result: structuredClone(structuredResult),
      evidence_artifact_ids: [candidate.artifact_id],
      provider: { provider_id: "launcher.node-test", provider_version: "1.0.0",
        capability: "candidate_execution",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_structured_events",
        evidence_artifact_types: ["structured_test_result"] } },
    test_inventory: { selected_test_id: `test-${suffix}`,
      declared_test_ids: [`test-${suffix}`], discovered_test_ids: [`test-${suffix}`],
      executed_test_ids: [`test-${suffix}`], skipped_test_ids: [] },
    boundary_traversals: [{ boundary_id: `sut-boundary-${suffix}`,
      observable_id: `observable-${suffix}`, provider_support: "supported",
      provider: { provider_id: "launcher.node-test-v8-coverage",
        provider_version: "1.0.0", capability: "boundary_traversal",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_v8_coverage",
        evidence_artifact_types: ["boundary_trace", "structured_test_result"] },
      authenticated: true, boundary_kind: "module",
      observation_mechanism: "node_test_v8_coverage",
      observation_seam: "node_test_structured_assertion", status: "proven", limitation: null,
      evidence_artifact_ids: [boundary.artifact_id] }],
    falsifier_executions: [{ falsifier_id: `falsifier-${suffix}`,
      attempt_id: `attempt-${"f".repeat(64)}`,
      target_verification_id: claimId,
      provider: { provider_id: "launcher.node-test-module-fault",
        provider_version: "2.0.0", capability: "falsifier_execution",
        capability_snapshot_digest: TEST_PROOF_PROVIDER_CAPABILITY_SNAPSHOT_DIGEST,
        observation_mechanism: "node_test_structured_events",
        evidence_artifact_types: ["falsifier_result", "structured_test_result"] },
      provider_support: "supported",
      isolated: true, candidate_status: "passed", falsified_status: "failed",
      failure_reason_code: "test_proof_fault.dependency_failure.v1",
      mutation: { mutation_id: `mutation-${suffix}`, strategy: "dependency_failure",
        mechanism: "module_substitution", target_kind: "module",
        module_path: "packages/controlled-contract/lib/test-proof-contract-v1.mjs",
        observed: true }, status: "detected", limitation: null,
      evidence_artifact_ids: [falsifier.artifact_id] }],
    capability_limitations: [],
    observed_shortcuts: [],
    artifacts: [candidate, boundary, falsifier].sort(
      (left, right) => left.artifact_id < right.artifact_id ? -1 : 1
    )
  };
}

const runtime = (receipts) => ({ runtime: { receipts } });

function refusalCodes(contract, receipts) {
  try {
    assessTestProofContract(contract, runtime(receipts));
  } catch (error) {
    assert.ok(error instanceof TestProofRuntimeAssessmentError, String(error));
    assert.equal(error.assessment_scope, "runtime");
    assert.equal(error.authority, "non_authoritative");
    assert.ok(error.diagnostics.every(({ code }) => code.startsWith("test_proof_")),
      JSON.stringify(error.diagnostics));
    return error.diagnostics.map(({ code }) => code);
  }
  return assert.fail("runtime assessment did not refuse");
}

test("a complete authenticated receipt population proves runtime truth", () => {
  const assessment = assessTestProofContract(migrated(), runtime([receipt()]));
  assert.equal(assessment.schema_version, "controlled-contract-assessment.v3");
  assert.equal(assessment.assessment_scope, "runtime");
  assert.equal(assessment.authority, "non_authoritative");
  assert.equal(assessment.assessment_status, "proven");
  assert.equal(assessment.runtime_truth, "proven");
  assert.equal(assessment.profile_discrimination, "proven");
  assert.deepEqual(assessment.population,
    { candidate_count: 1, falsifier_count: 1, falsifier_unavailable_count: 0, traversal_count: 1,
      complete: true });
  assert.deepEqual(assessment.receipts.map(({ kind }) => kind),
    ["candidate", "falsifier", "traversal"]);
  assert.deepEqual(assessment.receipts.map(({ status }) => status),
    ["passed", "detected", "proven"]);
  assert.deepEqual(assessment.receipts.map(({ provider }) => provider.capability),
    ["candidate_execution", "falsifier_execution", "boundary_traversal"]);
  assert.equal(assessment.diagnostics.length, 0);
  assert.equal(validateRuntimeTestProofAssessmentSchema(assessment), true);
});

test("the runtime assessment identity binds the authenticated receipt identity", () => {
  const evidence = receipt();
  const assessment = assessTestProofContract(migrated(), runtime([evidence]));
  assert.deepEqual(assessment.assessment_identity, {
    run_id: "run-integrated", wk_id: "WK-2160", selected_unit: "WK-2160#SLICE-003",
    attempt: 1, verifications: [{ verification_id: "claim-suite-covers-component",
      test_id: "test-component" }], contract_digest: digest("c"),
    source_snapshot_digest: digest("a"), generation_digest: digest("b")
  });
  assert.ok(assessment.receipts.every(({ authenticated_identity: identity }) =>
    identity.run_id === "run-integrated" &&
      identity.source_snapshot_digest === digest("a")));
  assert.equal(new Set(assessment.receipts.map(({ receipt_id: id }) => id)).size, 3);

  assert.deepEqual(assessTestProofContract(migrated(), runtime([receipt()])), assessment);
});

test("the planning assessment is unchanged without runtime evidence", () => {
  const planning = assessTestProofContract(migrated());
  assert.deepEqual(assessTestProofContract(migrated(), {}), planning);
  assert.equal(planning.schema_version, "controlled-contract-assessment.v2");
  assert.equal(planning.runtime_truth, "not_assessed");
});

test("an empty expected verification population refuses", () => {
  const empty = migrated();
  for (const claim of empty.claims) if (claim.verification_method === "test_execution") {
    claim.verification_method = "inspection";
  }
  empty.test_proofs = [];
  assert.deepEqual(refusalCodes(empty, [receipt()]),
    ["test_proof_runtime_expected_population_empty"]);

  assert.deepEqual(refusalCodes(multiVerification(), [receipt()]),
    ["test_proof_runtime_receipt_missing"]);
});

const second = () => receipt("claim-second-test", "second");
const population = () => [receipt(), second()];

test("a multi-verification population proves across its whole population", () => {
  const assessment = assessTestProofContract(multiVerification(), runtime(population()));
  assert.equal(assessment.schema_version, "controlled-contract-assessment.v3");
  assert.equal(assessment.assessment_status, "proven");
  assert.equal(assessment.runtime_truth, "proven");
  assert.equal(assessment.profile_discrimination, "proven");

  assert.deepEqual(assessment.population,
    { candidate_count: 2, falsifier_count: 2, falsifier_unavailable_count: 0, traversal_count: 2,
      complete: true });
  assert.deepEqual(assessment.assessment_identity.verifications, [
    { verification_id: "claim-second-test", test_id: "test-second" },
    { verification_id: "claim-suite-covers-component", test_id: "test-component" }
  ]);

  assert.deepEqual(assessment.receipts.map(
    ({ verification_id: id, kind, status }) => `${id}:${kind}:${status}`), [
    "claim-second-test:candidate:passed",
    "claim-second-test:falsifier:detected",
    "claim-second-test:traversal:proven",
    "claim-suite-covers-component:candidate:passed",
    "claim-suite-covers-component:falsifier:detected",
    "claim-suite-covers-component:traversal:proven"
  ]);
  assert.equal(new Set(assessment.receipts.map(({ receipt_id: id }) => id)).size, 6);
  assert.equal(assessment.diagnostics.length, 0);
  assert.equal(validateRuntimeTestProofAssessmentSchema(assessment), true);

  assert.deepEqual(
    assessTestProofContract(multiVerification(), runtime([second(), receipt()])),
    assessment);
});

test("one failed candidate anywhere in a multi-verification population refuses", () => {
  const failed = second();
  failed.execution_result.status = "failed";
  failed.execution_result.exit_code = 1;
  withCandidateResult(failed, (result) => { result.exit_code = 1; });
  assert.deepEqual(refusalCodes(multiVerification(), [receipt(), failed]),
    ["test_proof_runtime_candidate_failed"]);
});

test("one inert falsifier anywhere in a multi-verification population refuses", () => {
  const inert = second();
  inert.falsifier_executions[0].status = "not_detected";
  inert.falsifier_executions[0].falsified_status = "passed";
  assert.deepEqual(refusalCodes(multiVerification(), [receipt(), inert]),
    ["test_proof_runtime_falsifier_inert"]);
});

test("one unproven traversal anywhere in a multi-verification population refuses", () => {
  const unproven = second();
  unproven.boundary_traversals[0].status = "not_proven";
  assert.deepEqual(refusalCodes(multiVerification(), [receipt(), unproven]),
    ["test_proof_runtime_traversal_unproven"]);
});

test("a divergent shared identity across the population refuses", () => {
  const other = second();
  other.evidence_identity.run_id = "run-other";
  assert.deepEqual(refusalCodes(multiVerification(), [receipt(), other]),
    ["test_proof_runtime_receipt_identity_mismatch"]);
  const generation = second();
  generation.evidence_identity.controlled_contract_generation = digest("d");
  assert.deepEqual(refusalCodes(multiVerification(), [receipt(), generation]),
    ["test_proof_runtime_receipt_identity_mismatch"]);
});

test("runtime diagnostics address the receipt that produced them", () => {
  const failed = second();
  failed.execution_result.status = "failed";
  failed.execution_result.exit_code = 1;
  withCandidateResult(failed, (result) => { result.exit_code = 1; });
  try {
    assessTestProofContract(multiVerification(), runtime([receipt(), failed]));
  } catch (error) {
    assert.deepEqual(error.diagnostics.map(({ field }) => field),
      ["/runtime/receipts/1/execution_result/status"]);
    return;
  }
  assert.fail("runtime assessment did not refuse");
});

test("missing, duplicate, unexpected, and invalid receipts refuse", () => {
  assert.deepEqual(refusalCodes(migrated(), []),
    ["test_proof_runtime_receipt_population_missing"]);
  assert.deepEqual(refusalCodes(migrated(), [receipt(), receipt()]),
    ["test_proof_runtime_receipt_duplicate"]);
  const unexpected = receipt();
  unexpected.evidence_identity.verification_id = "claim-other-verification";
  unexpected.contract_binding.verification_claim_id = "claim-other-verification";
  unexpected.falsifier_executions[0].target_verification_id = "claim-other-verification";
  assert.deepEqual(refusalCodes(migrated(), [unexpected]).sort(),
    ["test_proof_runtime_receipt_missing", "test_proof_runtime_receipt_unexpected"]);
  const invalid = receipt();
  invalid.artifacts.find(({ kind }) => kind === "falsifier_result").payload.fixture = "tampered";
  assert.deepEqual(refusalCodes(migrated(), [invalid]),
    ["test_proof_runtime_receipt_invalid"]);
  const malformed = receipt();
  delete malformed.artifacts;
  assert.deepEqual(refusalCodes(migrated(), [malformed]),
    ["test_proof_runtime_receipt_invalid"]);
});

test("a mismatched contract binding refuses", () => {
  const mismatched = receipt();
  mismatched.contract_binding.test_proof_id = "test-proof-other";
  assert.deepEqual(refusalCodes(migrated(), [mismatched]),
    ["test_proof_runtime_binding_mismatch"]);
});

test("a failed candidate or an unselected, skipped, or unexecuted selection refuses", () => {
  const failed = receipt();
  failed.execution_result.status = "failed";
  failed.execution_result.exit_code = 1;
  withCandidateResult(failed, (result) => { result.exit_code = 1; });
  assert.deepEqual(refusalCodes(migrated(), [failed]),
    ["test_proof_runtime_candidate_failed"]);
  const skipped = receipt();
  skipped.test_inventory.skipped_test_ids = ["test-component"];
  assert.deepEqual(refusalCodes(migrated(), [skipped]),
    ["test_proof_runtime_selected_test_skipped"]);
  const notExecuted = receipt();
  notExecuted.test_inventory.discovered_test_ids = ["test-component", "test-sibling"];
  notExecuted.test_inventory.executed_test_ids = ["test-sibling"];
  assert.deepEqual(refusalCodes(migrated(), [notExecuted]),
    ["test_proof_runtime_selected_test_not_executed"]);

  const mismatch = receipt();
  mismatch.test_inventory.selected_test_id = "test-sibling";
  mismatch.test_inventory.declared_test_ids = ["test-sibling"];
  assert.deepEqual(refusalCodes(migrated(), [mismatch]),
    ["test_proof_runtime_receipt_invalid"]);
});

test("sibling tests observed in the same run neither earn nor withhold credit", () => {
  const withSiblings = receipt();
  withSiblings.test_inventory.discovered_test_ids =
    ["test-component", "test-sibling", "test-sibling-skipped"];
  withSiblings.test_inventory.executed_test_ids = ["test-component", "test-sibling"];
  withSiblings.test_inventory.skipped_test_ids = ["test-sibling-skipped"];
  const assessment = assessTestProofContract(migrated(), runtime([withSiblings]));
  assert.equal(assessment.assessment_status, "proven");
  assert.equal(assessment.runtime_truth, "proven");
  assert.equal(assessment.diagnostics.length, 0);
});

function unavailableFalsifier(value) {
  const limitation = { reason_code: "test_proof_native_instrumentation_unsupported",
    detail: { reason: "body_not_single_scalar_return" } };
  const [row] = value.falsifier_executions;
  Object.assign(row, { provider_support: "unsupported", isolated: false,
    falsified_status: "not_run", failure_reason_code: null, status: "review_only",
    limitation: structuredClone(limitation), evidence_artifact_ids: [] });
  row.mutation.observed = false;
  value.capability_limitations = [{ check_kind: "falsifier", check_id: row.falsifier_id,
    ...limitation }];
  value.artifacts = value.artifacts.filter(({ kind }) => kind !== "falsifier_result");
  return value;
}

test("an unavailable falsifier is a counted limitation, not missing credit", () => {
  const assessment = assessTestProofContract(migrated(), runtime([unavailableFalsifier(receipt())]));
  assert.equal(assessment.assessment_status, "proven");
  assert.equal(assessment.runtime_truth, "proven");
  assert.equal(assessment.profile_discrimination, "proven");
  assert.deepEqual(assessment.population, { candidate_count: 1, falsifier_count: 1,
    falsifier_unavailable_count: 1, traversal_count: 1, complete: true });

  assert.deepEqual(assessment.receipts.map(({ kind, status }) => `${kind}:${status}`),
    ["candidate:passed", "traversal:proven"]);
  assert.equal(validateRuntimeTestProofAssessmentSchema(assessment), true);
});

test("an unevaluable supported falsifier refuses distinctly from a survivor", () => {
  const unreached = receipt();
  Object.assign(unreached.falsifier_executions[0], { status: "not_detected",
    falsified_status: "passed", failure_reason_code: null });
  unreached.falsifier_executions[0].mutation.observed = false;
  assert.deepEqual(refusalCodes(migrated(), [unreached]),
    ["test_proof_runtime_falsifier_unevaluable"]);
});

test("an inert falsifier or an unproven traversal refuses", () => {
  const inert = receipt();
  inert.falsifier_executions[0].status = "not_detected";
  inert.falsifier_executions[0].falsified_status = "passed";
  assert.deepEqual(refusalCodes(migrated(), [inert]),
    ["test_proof_runtime_falsifier_inert"]);
  const unproven = receipt();
  unproven.boundary_traversals[0].status = "not_proven";
  assert.deepEqual(refusalCodes(migrated(), [unproven]),
    ["test_proof_runtime_traversal_unproven"]);
  const shortcut = receipt();
  shortcut.observed_shortcuts = ["source_text_inspection"];
  assert.deepEqual(refusalCodes(migrated(), [shortcut]),
    ["test_proof_runtime_prohibited_shortcut_observed"]);
});

test("a mismatched falsifier or traversal population refuses", () => {
  const contract = migrated();
  contract.test_proofs[0].falsifiers.push({
    ...structuredClone(contract.test_proofs[0].falsifiers[0]),
    falsifier_id: "falsifier-component-second",
    mutation: { ...structuredClone(contract.test_proofs[0].falsifiers[0].mutation),
      mutation_id: "mutation-component-second" }
  });
  assert.deepEqual(refusalCodes(contract, [receipt()]),
    ["test_proof_runtime_falsifier_missing"]);
  const strayFalsifier = receipt();
  strayFalsifier.falsifier_executions[0].falsifier_id = "falsifier-unknown";
  assert.deepEqual(refusalCodes(migrated(), [strayFalsifier]).sort(),
    ["test_proof_runtime_falsifier_missing", "test_proof_runtime_falsifier_unexpected"]);
  const strayTraversal = receipt();
  strayTraversal.boundary_traversals[0].observable_id = "observable-unknown";
  assert.deepEqual(refusalCodes(migrated(), [strayTraversal]).sort(),
    ["test_proof_runtime_traversal_missing", "test_proof_runtime_traversal_unexpected"]);
});

test("a runtime failure never falls back to a planning assessment", () => {
  const failed = receipt();
  failed.execution_result.status = "error";
  failed.execution_result.exit_code = null;
  withCandidateResult(failed, (result) => { result.exit_code = null; });
  assert.throws(() => assessTestProofContract(migrated(), runtime([failed])),
    (error) => error instanceof TestProofRuntimeAssessmentError &&
      error.code === "test_proof_runtime_candidate_failed" &&
      !Object.hasOwn(error, "compact_index"));
  assert.throws(() => assessTestProofContract(migrated(), { runtime: null }),
    (error) => error.code === "test_proof_runtime_input_invalid");
  assert.throws(() => assessTestProofContract(migrated(), { runtime: {}, extra: 1 }),
    (error) => error.code === "test_proof_runtime_input_invalid");
  assert.throws(() =>
    assessTestProofContract(migrated(), { runtime: { receipts: [], extra: 1 } }),
  (error) => error.code === "test_proof_runtime_input_invalid");
  assert.throws(() => assessTestProofContract(structuredClone(experimental),
    runtime([receipt()])),
  (error) => error.code === "test_proof_runtime_contract_invalid");
});
