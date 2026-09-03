import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES,
  assessIntegrationTestDesign
} from "../../packages/controlled-contract/current.mjs";
import {
  controlledContractContentDigest
} from "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
const {
  assessControlledContractIntegrationTestDesignOperation,
  consumeControlledContractIntegrationAssessmentSnapshot,
  INTEGRATION_TEST_DESIGN_ASSESSMENT_NON_AUTHORITY
} = await import(
  "../../packages/wiki-core/src/operations/controlled-contract/integration-test-design-assessment-operations.mjs"
);
import {
  projectControlledContractIntegrationAssessmentPage
} from "../../packages/wiki-core/src/operations/controlled-contract/assessment-semantic-projection.mjs";
import {
  collectIntegrationTestDesignCensuses,
  INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS
} from "../../packages/wiki-core/src/operations/controlled-contract/integration-test-design-census-providers.mjs";

const SHA = `sha256:${"1".repeat(64)}`;
const PROVIDER_AXES = new Set([
  "registered_routes", "role_tool_profiles", "result_schema_population", "declared_mutants"
]);

function axisApplicability(requiredAxes = PROVIDER_AXES) {
  return INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES.map((axis) => ({
    axis,
    status: requiredAxes.has(axis) ? "required" : "not_applicable",
    rationale: requiredAxes.has(axis)
      ? "the registered server provider owns this bounded population"
      : "this axis is not applicable to the declared design"
  }));
}

function canonicalFacts() {
  const criteria = Array.from({ length: 21 }, (_, index) => ({
    identity: `criterion-${String(index + 1).padStart(2, "0")}`,
    source_locator: `/acceptance/criteria/${index}`,
    criterion: `Criterion ${index + 1}`
  }));
  const rows = Array.from({ length: 63 }, (_, index) => ({
    obligation_id: `OBL-WK2415-${String(index + 1).padStart(3, "0")}`,
    source_locator: criteria[index % criteria.length].source_locator,
    controlled_contract_node_ids: [`claim-${(index % 5) + 1}`],
    mechanism: index === 0
      ? { kind: "tool_operation", selector:
        "workspace_controlled_contract_integration_test_design_assess" }
      : index === 1
        ? { kind: "schema", selector:
          "integration-test-design-assessment-result.experimental.v0.1.schema.json" }
        : { kind: "test", selector: `test-${index}` },
    proof: { kind: "pack_mapping" }
  }));
  const sourceDigest = `sha256:${"2".repeat(64)}`;
  const bindings = Object.freeze({
    selectedPackDigest: `sha256:${"3".repeat(64)}`,
    sourceDigest,
    mappingDigest: `sha256:${"4".repeat(64)}`
  });
  const obligation = Object.freeze({
    repoRoot: "/repo",
    wkId: "WK-2415",
    selectedUnit: null,
    canonicalSet: {
      repository: "agent-chassis/agent-chassis",
      generation: { id: "generation-2415" },
      manifest_content_digest: `sha256:${"5".repeat(64)}`
    },
    record: {
      id: "WK-2415",
      repo: "agent-chassis/agent-chassis",
      title: "Experimental proof-adequacy assessor"
    },
    contract: {
      content_digest: `sha256:${"6".repeat(64)}`,
      content: {
        test_proofs: Array.from({ length: 5 }, (_, index) => ({
          test_proof_id: `test-proof-${index + 1}`,
          verification_claim_id: `claim-${index + 1}`,
          falsifiers: [{ mutation: { mutation_id: `mutation-${index + 1}` } }]
        }))
      }
    },
    plan: { content_digest: `sha256:${"7".repeat(64)}` },
    bindings,
    source: { content_digest: sourceDigest },
    sourceCurrent: true,
    staleReasons: [],
    prospectiveIdentity: { source_kind: "obligation-coverage", content_digest: sourceDigest },
    criteria,
    rows
  });
  const carrierRows = criteria.map(({ identity }) => ({
    criterion_identity: identity,
    node_ids: ["claim-1"],
    axes: {}
  }));
  const acceptance = Object.freeze({
    bindings,
    carrier: {
      content_digest: `sha256:${"8".repeat(64)}`,
      content: {
        source_bindings: bindings,
        source_identity: { content_digest: sourceDigest },
        criterion_identities: {
          identities: criteria.map(({ identity }) => ({ identity }))
        },
        rows: carrierRows
      }
    },
    rows: carrierRows
  });
  return { obligation, acceptance };
}

function completeCensus(axis, members, obligationIds = ["OBL-WK2415-001"]) {
  const population = {
    census_id: `server:${axis}`,
    axis,
    provider_id: INTEGRATION_TEST_DESIGN_CENSUS_PROVIDER_IDS[axis],
    owner_id: `owner:${axis}`,
    generation_id: "generation-1",
    source_kind: axis === "result_schema_population" ? "schema_derived"
      : axis === "declared_mutants" ? "canonical_closed_set"
        : "repository_registry_derived",
    members: members.map((member_id) => ({ member_id, obligation_ids: obligationIds })),
    member_count: members.length,
    completeness: "complete",
    omissions: [],
    currentness: "current"
  };
  return { ...population, content_digest: controlledContractContentDigest(population) };
}

function fourCensuses() {
  return [
    completeCensus("registered_routes", [
      "workspace_controlled_contract_integration_test_design_assess"
    ]),
    completeCensus("role_tool_profiles", [
      "operator:workspace_controlled_contract_integration_test_design_assess",
      "orchestrator:workspace_controlled_contract_integration_test_design_assess",
      "redteam:workspace_controlled_contract_integration_test_design_assess",
      "reviewer:workspace_controlled_contract_integration_test_design_assess"
    ]),
    completeCensus("result_schema_population", [
      "pass", "fail", "incomplete", "unevaluable", "review_only"
    ], ["OBL-WK2415-002"]),
    completeCensus("declared_mutants", [
      "mutation-1", "mutation-2", "mutation-3", "mutation-4", "mutation-5"
    ])
  ];
}

function operationInput() {
  return {
    repoRoot: "/repo",
    wkId: "WK-2415",
    focus: null,
    selectedUnit: null,
    axisApplicability: axisApplicability(),
    declaredIntegrationTests: [],
    integrationScenarios: [],
    interactionRequirements: [],
    reviewQuestions: []
  };
}

async function censusOwnerRepo(t, { descriptor, policy }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wk2415-census-owner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const owner = path.join(root, "packages/wiki-core/data/tool-discovery");
  await mkdir(owner, { recursive: true });
  if (descriptor !== undefined) {
    await writeFile(path.join(owner, "controlled-contract-tools.json"),
      typeof descriptor === "string" ? descriptor : JSON.stringify(descriptor));
  }
  await writeFile(path.join(owner, "session-role-tool-access.json"),
    JSON.stringify(policy));
  return root;
}

test("F-001 keeps unbound descriptor routes in the complete registered denominator", async () => {
  const { obligation } = canonicalFacts();
  const unboundRoute = "workspace_registered_but_not_obligation_bound";
  const descriptor = {
    schema_version: "tool-discovery.v1",
    tool_count: 2,
    tools: [
      { tool_name: "workspace_controlled_contract_integration_test_design_assess" },
      { tool_name: unboundRoute }
    ]
  };
  const rolePolicy = {
    schema_version: "session-role-tool-access.v1",
    policy_id: "session-role-tool-access",
    roles: ["orchestrator", "reviewer", "worker", "redteam", "operator"],
    access: {
      workspace_controlled_contract_integration_test_design_assess: [
        "orchestrator", "reviewer", "redteam", "operator"
      ],
      [unboundRoute]: ["orchestrator", "reviewer", "redteam", "operator"]
    }
  };
  const censuses = await collectIntegrationTestDesignCensuses({
    repoRoot: "/repo",
    resolvedFacts: obligation,
    axisApplicability: axisApplicability(),
    readJsonFile: async (file) => file.endsWith("controlled-contract-tools.json")
      ? descriptor : rolePolicy
  });
  assert.deepEqual(censuses.map(({ axis, member_count: count }) => [axis, count]), [
    ["declared_mutants", 5],
    ["registered_routes", 2],
    ["result_schema_population", 5],
    ["role_tool_profiles", 8]
  ]);
  const routes = censuses.find(({ axis }) => axis === "registered_routes");
  assert.deepEqual(routes.members.find(({ member_id: id }) => id === unboundRoute), {
    member_id: unboundRoute,
    obligation_ids: []
  });
  assert.ok(censuses.every(({ completeness, currentness, content_digest: digest }) =>
    completeness === "complete" && currentness === "current" && digest.startsWith("sha256:")
  ));
});

test("F-002 projects real provider parse and execution failures onto the affected axis",
  async (t) => {
    const route = "workspace_controlled_contract_integration_test_design_assess";
    const policy = {
      schema_version: "session-role-tool-access.v1",
      policy_id: "session-role-tool-access",
      roles: ["operator"],
      access: { [route]: ["operator"] }
    };
    for (const failure of ["read", "parse", "execution"]) await t.test(failure, async (st) => {
      const descriptor = {
        schema_version: "tool-discovery.v1", tool_count: 1,
        tools: [{ tool_name: route }]
      };
      const root = await censusOwnerRepo(st, {
        descriptor: failure === "read" ? undefined
          : failure === "parse" ? "{not-json" : descriptor,
        policy: failure === "execution" ? { ...policy, access: { [route]: null } } : policy
      });
      const { obligation } = canonicalFacts();
      const requiredAxes = new Set(failure !== "execution"
        ? ["registered_routes"] : ["registered_routes", "role_tool_profiles"]);
      const censuses = await collectIntegrationTestDesignCensuses({
        repoRoot: root,
        resolvedFacts: obligation,
        axisApplicability: axisApplicability(requiredAxes)
      });
      const axis = failure === "execution" ? "role_tool_profiles" : "registered_routes";
      const census = censuses.find((item) => item.axis === axis);
      assert.equal(census.member_count, 0);
      assert.equal(census.completeness, "partial");
      assert.equal(census.currentness, "non_current");
      assert.match(census.omissions[0], {
        read: /ENOENT/u, parse: /SyntaxError/u, execution: /TypeError/u
      }[failure]);
      if (failure === "execution") {
        const routes = censuses.find((item) => item.axis === "registered_routes");
        assert.equal(routes.member_count, 1);
        assert.equal(routes.completeness, "complete");
        assert.equal(routes.currentness, "current");
      }
    });
  });

test("server resolves subject and composes the current 63-row, 21-mapping census", async () => {
  const { obligation, acceptance } = canonicalFacts();
  let obligationCalls = 0;
  let acceptanceCalls = 0;
  const result = await assessControlledContractIntegrationTestDesignOperation(operationInput(), {
    resolveObligations: async (input, options) => {
      obligationCalls += 1;
      assert.deepEqual(input, {
        repoRoot: "/repo", wkId: "WK-2415", focus: null, selectedUnit: null
      });
      assert.deepEqual(options, { requireSource: true });
      return obligation;
    },
    resolveAcceptance: async (_input, options) => {
      acceptanceCalls += 1;
      assert.deepEqual(options, { requireCarrier: true });
      return acceptance;
    },
    collectCensuses: async () => fourCensuses()
  });
  assert.equal(obligationCalls, 1);
  assert.equal(acceptanceCalls, 1);
  assert.equal(result.source.obligation_source.row_count, 63);
  assert.equal(result.source.obligation_source.criterion_count, 21);
  assert.equal(result.source.acceptance_coverage.mapping_count, 21);
  assert.equal(result.source.acceptance_coverage.current, true);
  assert.deepEqual(result.denominators, {
    requirements: 21,
    obligations: 63,
    integration_required_obligations: 63,
    applicable_complete_census_members: 15,
    declared_integration_tests: 0,
    integration_scenarios: 0,
    interaction_requirements: 0,
    review_questions: 0,
    adequacy_axes: 10
  });
  assert.deepEqual(result.authority, INTEGRATION_TEST_DESIGN_ASSESSMENT_NON_AUTHORITY);
  for (const key of [
    "proof_authority", "requirement_authority", "admission_authority",
    "dispatch_authority", "review_authority", "integration_authority",
    "publication_authority", "completion_authority"
  ]) assert.equal(result.authority[key], false, key);
});

test("real package review questions preserve exact projected counts, identities, and selectors", async () => {
  const { obligation, acceptance } = canonicalFacts();
  const questions = Array.from({ length: 65 }, (_, index) => ({
    question_id: `question:${String(65 - index).padStart(3, "0")}`,
    question: `Operator decision ${index + 1}`,
    axis: index % 2 === 0 ? "selector_partitions" : "registered_routes",
    resolution_owner: "operator",
    related_ids: []
  }));
  const input = { ...operationInput(), reviewQuestions: questions };
  const summary = await assessControlledContractIntegrationTestDesignOperation(input, {
    resolveObligations: async () => obligation,
    resolveAcceptance: async () => acceptance,
    collectCensuses: async () => fourCensuses()
  });
  const snapshot = consumeControlledContractIntegrationAssessmentSnapshot(summary);
  assert.ok(snapshot);
  assert.equal(snapshot.assessment.denominators.review_questions, 65);
  assert.equal(summary.counts.review_question_results, 65);

  const gaps = projectControlledContractIntegrationAssessmentPage({
    assessment: snapshot.assessment,
    collection: "gaps"
  });
  const identifiedGap = gaps.items.find(({ subject_id: subjectId }) =>
    typeof subjectId === "string");
  assert.ok(identifiedGap, "real package output must expose a diagnostic with a subject identity");
  const descriptorIdentityMatch = projectControlledContractIntegrationAssessmentPage({
    assessment: snapshot.assessment,
    collection: "gaps",
    selector: { id: identifiedGap.diagnostic_id }
  });
  assert.equal(descriptorIdentityMatch.matched_count, 1);
  assert.equal(descriptorIdentityMatch.items[0].diagnostic_id, identifiedGap.diagnostic_id);
  const foreignIdentityMismatch = projectControlledContractIntegrationAssessmentPage({
    assessment: snapshot.assessment,
    collection: "gaps",
    selector: { id: identifiedGap.subject_id }
  });
  assert.equal(foreignIdentityMismatch.matched_count, 0);
  assert.equal(foreignIdentityMismatch.returned_count, 0);

  const first = projectControlledContractIntegrationAssessmentPage({
    assessment: snapshot.assessment,
    collection: "review_question_results"
  });
  assert.equal(first.matched_count, 65);
  assert.equal(first.returned_count + first.omitted_count, 65);
  assert.equal(first.has_more, true);
  assert.equal(first.next_ordinal, first.returned_count);
  assert.ok(first.items.length > 0 && first.items.length <= 64);
  assert.deepEqual(first.items.map(({ question_id: id }) => id),
    [...first.items.map(({ question_id: id }) => id)].sort());
  assert.equal(new Set(first.items.map(({ question_id: id }) => id)).size,
    first.returned_count);

  const selected = projectControlledContractIntegrationAssessmentPage({
    assessment: snapshot.assessment,
    collection: "review_question_results",
    selector: { id: "question:032", axis: "registered_routes", state: "review_only" }
  });
  assert.equal(selected.matched_count, 1);
  assert.equal(selected.returned_count, 1);
  assert.equal(selected.omitted_count, 0);
  assert.equal(selected.items[0].question_id, "question:032");

  const unmatched = projectControlledContractIntegrationAssessmentPage({
    assessment: snapshot.assessment,
    collection: "review_question_results",
    selector: { id: "question:032", axis: "selector_partitions" }
  });
  assert.equal(unmatched.matched_count, 0);
  assert.equal(unmatched.returned_count, 0);
  assert.equal(unmatched.omitted_count, 0);

  const second = projectControlledContractIntegrationAssessmentPage({
    assessment: snapshot.assessment,
    collection: "review_question_results",
    ordinal: first.next_ordinal
  });
  assert.equal(first.returned_count + second.returned_count, 65);
  assert.equal(second.omitted_count, 0);
  assert.equal(second.has_more, false);
  assert.equal(second.next_ordinal, null);
});

test("missing, stale, incomplete, and unsupported providers can never pass", () => {
  const base = {
    schema_version: "integration-test-design-assessment-input.experimental.v0.1",
    subject: {
      repository_id: "repo", wk_id: "WK-2415", selected_unit_address: "WK-2415",
      work_record_digest: SHA, contract_generation_id: "g", contract_manifest_digest: SHA,
      contract_digest: SHA, proof_plan_generation_id: "g", proof_plan_digest: SHA,
      selected_pack_digest: SHA, obligation_source_digest: SHA,
      obligation_source_current: true, acceptance_coverage_digest: SHA,
      acceptance_coverage_current: true
    },
    declaration_completeness: {
      requirement_obligation_bindings: "complete",
      integration_scenario_bindings: "complete",
      axis_applicability: "complete"
    },
    axis_applicability: INTEGRATION_TEST_DESIGN_ASSESSMENT_AXES.map((axis) => ({
      axis, status: axis === "registered_routes" ? "required" : "not_applicable",
      rationale: "declared rationale"
    })),
    requirements: [{ requirement_id: "r", source_pointer: "/r", text_digest: SHA }],
    obligations: [{
      obligation_id: "o", source_requirement_ids: ["r"], verification_claim_ids: ["c"],
      proof_rigor: "standard", integration_required: false,
      required_population_members: []
    }],
    population_censuses: [], declared_integration_tests: [], integration_scenarios: [],
    interaction_requirements: [], review_questions: []
  };
  const missing = assessIntegrationTestDesign(base);
  assert.equal(missing.state, "incomplete");
  assert.ok(missing.diagnostics.some(({ code }) =>
    code === "PAA-REQUIRED-AXIS-CENSUS-ABSENT.v1"));
  for (const [completeness, currentness] of [
    ["complete", "stale"], ["partial", "current"], ["unsupported", "unsupported"]
  ]) {
    const population = {
      census_id: "routes", axis: "registered_routes",
      source_kind: "repository_registry_derived", provider_id: "provider", owner_id: "owner",
      generation_id: "g", member_count: 0, completeness, omissions: ["gap"],
      currentness, members: []
    };
    const result = assessIntegrationTestDesign({
      ...base,
      axis_applicability: base.axis_applicability.map((item) => item.axis ===
        "registered_routes" ? { ...item, census_id: "routes" } : item),
      population_censuses: [{
        ...population, content_digest: controlledContractContentDigest(population)
      }]
    });
    assert.notEqual(result.state, "pass", `${completeness}/${currentness}`);
    assert.ok(result.diagnostics.some(({ code }) =>
      code === "PAA-CENSUS-COMPLETENESS-UNSUPPORTED.v1"));
  }
});

test("obligation-source absence and stale canonical carriers refuse or remain non-pass", async () => {
  const { obligation, acceptance } = canonicalFacts();
  await assert.rejects(
    assessControlledContractIntegrationTestDesignOperation(operationInput(), {
      resolveObligations: async () => {
        const error = new Error("canonical obligation source is absent");
        error.code = "obligation_coverage_source_not_found";
        error.details = { changed: false };
        throw error;
      }
    }),
    (error) => error.envelope.warning.payload.details.authority.proof_authority === false
  );
  const stale = await assessControlledContractIntegrationTestDesignOperation(operationInput(), {
    resolveObligations: async () => ({
      ...obligation, sourceCurrent: false, staleReasons: ["criterion_population_incomplete"]
    }),
    resolveAcceptance: async () => acceptance,
    collectCensuses: async () => []
  });
  assert.notEqual(stale.state, "pass");
  assert.equal(stale.source.obligation_source.current, false);
  assert.equal(stale.counts.gaps > 0, true);
});

test("assessment is pure and preserves caller declarations while granting no persistence authority", async () => {
  const { obligation, acceptance } = canonicalFacts();
  const input = operationInput();
  const before = structuredClone(input);
  const result = await assessControlledContractIntegrationTestDesignOperation(input, {
    resolveObligations: async () => obligation,
    resolveAcceptance: async () => acceptance,
    collectCensuses: async () => fourCensuses()
  });
  assert.deepEqual(input, before);
  assert.equal(result.authority.read_only, true);
  assert.equal(result.authority.lifecycle_transition, false);
  assert.deepEqual(result.authority.grants, []);
});
