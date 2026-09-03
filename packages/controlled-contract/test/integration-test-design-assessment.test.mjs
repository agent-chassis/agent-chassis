import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const {
  assessIntegrationTestDesign: assessDirect
} = await import("../lib/integration-test-design-assessment.mjs");
const {
  INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES,
  INTEGRATION_TEST_DESIGN_ASSESSMENT_STATES,
  assessIntegrationTestDesign
} = await import("../current.mjs");

const PACKAGE_ROOT = new URL("../", import.meta.url);
const INPUT_SCHEMA = JSON.parse(await readFile(new URL(
  "schema/integration-test-design-assessment-input.experimental.v0.1.schema.json",
  PACKAGE_ROOT
), "utf8"));
const RESULT_SCHEMA = JSON.parse(await readFile(new URL(
  "schema/integration-test-design-assessment-result.experimental.v0.1.schema.json",
  PACKAGE_ROOT
), "utf8"));
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validateInput = ajv.compile(INPUT_SCHEMA);
const validateResult = ajv.compile(RESULT_SCHEMA);
const DIGEST = `sha256:${"a".repeat(64)}`;

function evidence(axis, memberId) {
  if (axis === "registered_routes") {
    return { action_id: "invoke", boundary_id: memberId };
  }
  if (axis === "role_tool_profiles") {
    return {
      registered_set_id: "registered", returned_set_id: "returned",
      invoked_set_id: "invoked", completed_set_id: "completed"
    };
  }
  if (axis === "result_schema_population") {
    return { expected_result_id: "result" };
  }
  return {
    mutant_case_id: "case", ordinary_discovery_binding_id: "node-test",
    kill_oracle_id: "semantic-failure"
  };
}

function completeInput() {
  const requiredAxes = [
    "registered_routes", "role_tool_profiles",
    "result_schema_population", "declared_mutants"
  ];
  const censuses = requiredAxes.map((axis) => ({
    census_id: `census:${axis}`,
    axis,
    source_kind: axis === "result_schema_population"
      ? "schema_derived" : axis === "declared_mutants"
        ? "canonical_closed_set" : "repository_registry_derived",
    provider_id: `provider:${axis}`,
    owner_id: `owner:${axis}`,
    generation_id: `generation:${axis}`,
    content_digest: DIGEST,
    member_count: 1,
    completeness: "complete",
    omissions: [],
    currentness: "current",
    members: [{ member_id: `member:${axis}` }]
  }));
  const requiredPopulationMembers = censuses.map(({ census_id: censusId, members }) => ({
    census_id: censusId,
    member_id: members[0].member_id
  }));
  return {
    schema_version: "integration-test-design-assessment-input.experimental.v0.1",
    subject: {
      repository_id: "agent-chassis/agent-chassis",
      wk_id: "WK-2415",
      selected_unit_address: "WK-2415",
      work_record_digest: DIGEST,
      contract_generation_id: "generation",
      contract_manifest_digest: DIGEST,
      contract_digest: DIGEST,
      proof_plan_generation_id: "generation",
      proof_plan_digest: DIGEST,
      selected_pack_digest: DIGEST,
      obligation_source_digest: DIGEST,
      obligation_source_current: true,
      acceptance_coverage_digest: DIGEST,
      acceptance_coverage_current: true
    },
    declaration_completeness: {
      requirement_obligation_bindings: "complete",
      integration_scenario_bindings: "complete",
      axis_applicability: "complete"
    },
    axis_applicability: INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES.map((axis) =>
      requiredAxes.includes(axis) ? {
        axis, status: "required", census_id: `census:${axis}`,
        rationale: "The server has a complete registered provider."
      } : {
        axis, status: "not_applicable",
        rationale: "The authored design states this axis is not applicable."
      }),
    requirements: [{
      requirement_id: "requirement:one",
      source_pointer: "/acceptance/criteria/0",
      text_digest: DIGEST
    }],
    population_censuses: censuses,
    obligations: [{
      obligation_id: "obligation:one",
      source_requirement_ids: ["requirement:one"],
      verification_claim_ids: ["claim:one"],
      proof_rigor: "standard",
      integration_required: true,
      required_population_members: requiredPopulationMembers
    }],
    declared_integration_tests: [{
      test_id: "test:one",
      repository_path: "tests/integration/example.test.mjs",
      classification_source: "docs/test-suite-classification.md"
    }],
    integration_scenarios: [{
      scenario_id: "scenario:one",
      test_id: "test:one",
      candidate_test_reference_ids: [],
      obligation_ids: ["obligation:one"],
      inputs: [{ input_id: "input" }],
      actions: [{ action_id: "invoke", boundary_id: "member:registered_routes" }],
      expected_results: [{ result_id: "result", kind: "success" }],
      coverage: censuses.map(({ census_id: censusId, axis, members }) => ({
        census_id: censusId,
        member_id: members[0].member_id,
        evidence_design: evidence(axis, members[0].member_id)
      })),
      fixture_effects: [],
      seams: []
    }],
    interaction_requirements: [],
    review_questions: []
  };
}

function clone(value) {
  return structuredClone(value);
}

test("package surface executes the pure evaluator and publishes exactly five states", () => {
  assert.equal(assessIntegrationTestDesign, assessDirect);
  assert.deepEqual(INTEGRATION_TEST_DESIGN_ASSESSMENT_STATES,
    ["pass", "fail", "incomplete", "unevaluable", "review_only"]);
  const input = completeInput();
  assert.equal(validateInput(input), true, JSON.stringify(validateInput.errors));
  const result = assessIntegrationTestDesign(input);
  assert.equal(result.state, "pass");
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));
  assert.deepEqual(result.denominators, {
    requirements: 1,
    obligations: 1,
    integration_required_obligations: 1,
    applicable_complete_census_members: 4,
    declared_integration_tests: 1,
    integration_scenarios: 1,
    interaction_requirements: 0,
    review_questions: 0,
    adequacy_axes: 10
  });
  assert.equal(result.coverage.applicable_complete_census_members_with_scenarios, 4);
});

test("real review-question denominators validate losslessly and reject malformed identities", () => {
  const input = completeInput();
  input.review_questions = [
    {
      question_id: "question:zulu",
      question: "Does the final boundary require operator judgment?",
      resolution_owner: "operator",
      related_ids: []
    },
    {
      question_id: "question:alpha",
      question: "Is the selector partition semantically complete?",
      axis: "selector_partitions",
      resolution_owner: "operator",
      related_ids: ["requirement:one"]
    }
  ];
  assert.equal(validateInput(input), true, JSON.stringify(validateInput.errors));

  const result = assessIntegrationTestDesign(input);
  assert.equal(validateResult(result), true, JSON.stringify(validateResult.errors));
  assert.equal(result.denominators.review_questions, 2);
  assert.deepEqual(result.lossless_denominators.review_question_ids, [
    "question:alpha", "question:zulu"
  ]);

  for (const mutate of [
    (value) => { delete value.lossless_denominators.review_question_ids; },
    (value) => { value.lossless_denominators.review_question_ids = "question:alpha"; },
    (value) => { value.lossless_denominators.review_question_ids = [""]; },
    (value) => { value.lossless_denominators.review_question_ids = [null]; }
  ]) {
    const mutant = clone(result);
    mutate(mutant);
    assert.equal(validateResult(mutant), false,
      "malformed review-question denominator must fail the package result schema");
  }

  const invalidInput = completeInput();
  invalidInput.review_questions = [{ question_id: "", question: "invalid identity" }];
  assert.equal(validateInput(invalidInput), false,
    "the existing typed input schema must reject an empty review-question identity");
});

test("the five states remain distinct with fail-first deterministic precedence", () => {
  const pass = assessDirect(completeInput());
  const failed = clone(completeInput());
  failed.integration_scenarios[0].coverage.pop();
  const incomplete = clone(completeInput());
  incomplete.population_censuses[0].completeness = "partial";
  incomplete.population_censuses[0].omissions = ["one omitted registry member"];
  const unevaluable = clone(completeInput());
  unevaluable.axis_applicability.find(
    ({ axis }) => axis === "selector_partitions"
  ).status = "unevaluable";
  const reviewOnly = clone(completeInput());
  reviewOnly.review_questions.push({
    question_id: "question:one",
    question: "Does the semantic equivalence need operator judgment?",
    resolution_owner: "operator",
    related_ids: []
  });
  assert.deepEqual([
    pass.state,
    assessDirect(failed).state,
    assessDirect(incomplete).state,
    assessDirect(unevaluable).state,
    assessDirect(reviewOnly).state
  ], ["pass", "fail", "incomplete", "unevaluable", "review_only"]);

  failed.review_questions.push(reviewOnly.review_questions[0]);
  assert.equal(assessDirect(failed).state, "fail");
});

test("lossless populations, joins, counts, codes, and ordering are reconstructible", () => {
  const input = completeInput();
  const result = assessDirect(input);
  for (const axis of result.axis_results) {
    for (const [population, rows] of Object.entries(axis.populations)) {
      assert.equal(axis.counts[population], rows.length);
    }
  }
  assert.equal(result.lossless_joins.requirement_to_obligations.length, 1);
  assert.equal(result.lossless_joins.population_member_to_obligations.length, 4);
  assert.equal(result.lossless_joins.population_member_to_sufficient_scenarios.length, 4);
  assert.deepEqual(result.lossless_joins.interaction_to_scenarios, []);

  const permuted = clone(input);
  permuted.axis_applicability.reverse();
  permuted.population_censuses.reverse();
  permuted.integration_scenarios[0].coverage.reverse();
  permuted.obligations[0].required_population_members.reverse();
  assert.deepEqual(assessDirect(permuted), result);
});

test("missing, extra, contradictory, and unsupported populations remain exact", () => {
  const input = completeInput();
  input.integration_scenarios[0].coverage.pop();
  input.integration_scenarios[0].coverage.push({
    census_id: "census:missing",
    member_id: "extra",
    evidence_design: { action_id: "extra", boundary_id: "extra" }
  });
  input.population_censuses[0].currentness = "stale";
  input.population_censuses[0].omissions = ["registry generation changed"];
  const result = assessDirect(input);
  assert.equal(result.state, "fail");
  const registered = result.axis_results.find(({ axis }) => axis === "registered_routes");
  assert.deepEqual(registered.populations.unsupported, ["census:census:registered_routes"]);
  assert.ok(result.diagnostics.every(({ code, message, supported_next_action }) =>
    code.startsWith("PAA-") && message.length <= 2048 &&
    supported_next_action.length <= 2048
  ));
});

test("critical semantics, interactions, fixtures, seams, and all ten axis checks are executable", () => {
  const critical = completeInput();
  critical.obligations[0].proof_rigor = "critical_semantic";
  assert.ok(assessDirect(critical).diagnostics.some(
    ({ code }) => code === "PAA-CRITICAL-PROOF-SPECIFICATION-INCOMPLETE.v1"
  ));

  const interaction = completeInput();
  interaction.interaction_requirements.push({
    interaction_id: "interaction:one",
    coverage_mode: "single_scenario",
    required_population_members: [
      { census_id: "census:registered_routes", member_id: "member:registered_routes" },
      { census_id: "census:declared_mutants", member_id: "member:declared_mutants" }
    ]
  });
  interaction.integration_scenarios[0].coverage.pop();
  assert.ok(assessDirect(interaction).diagnostics.some(
    ({ code }) => code === "PAA-INTERACTION-FRAGMENTED-ACROSS-SCENARIOS.v1"
  ));
});

test("both schemas compile, recursively close objects, and reject authority or shortcut fields", () => {
  const visit = (node, seen = new Set()) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (node.type === "object") assert.equal(
      node.additionalProperties, false,
      `open object schema at ${JSON.stringify(node)}`
    );
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach((item) => visit(item, seen));
      else visit(value, seen);
    }
  };
  visit(INPUT_SCHEMA);
  visit(RESULT_SCHEMA);

  for (const field of [
    "contract_digest", "requirements", "outcome", "assessment_state",
    "provider_identity", "provider_currentness", "census_count"
  ]) {
    const value = completeInput();
    value[field] = "caller-authority";
    assert.equal(validateInput(value), false, field);
  }
  for (const field of [
    "coverage_percentage", "mock_only_boundary_substitution",
    "snapshot_only_assertion", "source_text_inspection",
    "test_count_only", "unexecuted_assertion"
  ]) {
    const value = completeInput();
    value.integration_scenarios[0].coverage[0].evidence_design[field] = "shortcut";
    assert.equal(validateInput(value), false, field);
  }
});

test("structural input refusal is deterministic and occurs before evaluation", () => {
  assert.throws(
    () => assessDirect({ schema_version: "wrong", subject_digest: DIGEST }),
    (error) => error instanceof TypeError &&
      error.code === "CONTROLLED_CONTRACT_INTEGRATION_TEST_DESIGN_INPUT_INVALID" &&
      error.issue_count > 0 && error.issues.length <= 32
  );
});
