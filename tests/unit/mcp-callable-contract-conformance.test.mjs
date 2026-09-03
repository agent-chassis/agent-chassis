import assert from "node:assert/strict";
import test from "node:test";

import {
  MCP_CALLABLE_CONFORMANCE_CLAIM_IDS,
  MCP_CALLABLE_REPRESENTATION_IDS,
  evaluateMcpCallableContractConformance
} from "../../packages/wiki-core/src/lib/mcp-callable-contract-conformance.mjs";

const READ_MEMBER = "worker:free_local:workspace_read_page";
const QUERY_MEMBER = "worker:free_local:workspace_tools_query";
const correctedCall = {
  tool_name: "workspace_read_page",
  arguments: { path: "wiki/work-records/WK-2410.json" }
};
const queryCall = {
  tool_name: "workspace_tools_query",
  arguments: { task_id: "controlled-contract-authoring" }
};

function fact(factId, factKind, value, requiredRepresentations, claimIds,
  ownerId = "WK-2029", memberId = READ_MEMBER) {
  return {
    fact_id: factId,
    member_id: memberId,
    owner_id: ownerId,
    fact_kind: factKind,
    value: structuredClone(value),
    required_representations: requiredRepresentations,
    claim_ids: claimIds
  };
}

function fixture() {
  const ownerFacts = [
    fact("selected-record-argument", "argument", { type: "boolean" },
      ["published_schema", "discovery", "route_validation", "handler_acceptance"],
      ["claim-representations"]),
    fact("selected-record-applicability", "constraint", { path_kind: "canonical_graph_evidence" },
      ["published_schema", "discovery", "route_validation", "handler_acceptance"],
      ["claim-representations", "claim-seed"]),
    fact("selected-record-corrected-call", "corrected_call", correctedCall,
      ["public_result"], ["claim-recovery", "claim-seed"], "WK-1509"),
    fact("refusal-owner-fact", "recovery_fact",
      { code: "selector_path_unsupported", owner_id: "WK-2029" },
      ["public_result"], ["claim-ownership", "claim-recovery"], "WK-2386"),
    fact("refusal-recovery-actor", "recovery_actor", "caller",
      ["public_result"], ["claim-recovery"], "WK-1842#item-1"),
    fact("refusal-classification", "failure_classification", "internal_failure",
      ["public_result"], ["claim-integrity"], "WK-2388"),
    fact("bounded-result", "bounded_retrieval", { complete_count: 157, next_call: queryCall },
      ["discovery", "public_result"], ["claim-retrieval"], "DEC-0118"),
    fact("public-next-call", "next_call", correctedCall,
      ["public_result"], ["claim-recovery"], "WK-1509"),
    fact("identical-retry", "recovery_fact", { retry: "identical", condition: "facts_changed" },
      ["public_result"], ["claim-recovery"], "WK-1948"),
    fact("durable-prose-call", "prose_call", queryCall,
      ["discovery"], ["claim-representations"]),
    fact("owner-integrity", "owner_fact", { typed: true, owner_id: "WK-2361" },
      MCP_CALLABLE_REPRESENTATION_IDS, ["claim-integrity", "claim-ownership"], "WK-2361")
  ];
  const population = [
    { member_id: READ_MEMBER, tool_name: "workspace_read_page", role: "worker",
      tier: "free_local", visibility: "included" },
    { member_id: QUERY_MEMBER, tool_name: "workspace_tools_query", role: "worker",
      tier: "free_local", visibility: "included" },
    { member_id: "reviewer:free_local:workspace_agent_dispatch", tool_name: "workspace_agent_dispatch",
      role: "reviewer", tier: "free_local", visibility: "excluded",
      omission: { kind: "role", owner_id: "register-tool", reason_code: "role_not_visible" } },
    { member_id: "worker:operator_only:workspace_wk_forge_handoff", tool_name: "workspace_wk_forge_handoff",
      role: "worker", tier: "operator_only", visibility: "excluded",
      omission: { kind: "tier", owner_id: "register-tool", reason_code: "tier_not_visible" } },
    { member_id: "worker:paid_cce:workspace_agent_redteam", tool_name: "workspace_agent_redteam",
      role: "worker", tier: "paid_cce", visibility: "excluded",
      omission: { kind: "unsupported_runtime", owner_id: "register-tool",
        reason_code: "runtime_not_supported" } }
  ];
  const representations = Object.fromEntries(MCP_CALLABLE_REPRESENTATION_IDS.map(
    (representationId) => [representationId, [READ_MEMBER, QUERY_MEMBER].map((memberId) => ({
      member_id: memberId,
      facts: ownerFacts.filter((entry) => entry.member_id === memberId &&
        entry.required_representations.includes(representationId)).map((entry) => ({
        fact_id: entry.fact_id,
        owner_id: entry.owner_id,
        fact_kind: entry.fact_kind,
        value: structuredClone(entry.value)
      }))
    }))]
  ));
  return {
    schema_version: "mcp-callable-contract-conformance-input.v1",
    inventory: {
      registered_member_ids: population.map((entry) => entry.member_id),
      owner_fact_ids: ownerFacts.map((entry) => entry.fact_id)
    },
    population,
    owner_facts: ownerFacts,
    supported_calls: [correctedCall, queryCall],
    representations
  };
}

function diagnostics(input) {
  return evaluateMcpCallableContractConformance(input, {
    collection: "diagnostics", offset: 0, limit: 100
  }).page.items;
}

function assertDiagnostic(input, code) {
  const diagnostic = diagnostics(input).find((entry) => entry.code === code);
  assert.ok(diagnostic, `missing ${code}`);
  assert.ok(diagnostic.claim_ids.includes("claim-integrity"), `${code} is not integrity-typed`);
}

function actualFact(input, representationId, factId) {
  return input.representations[representationId][0].facts.find((entry) => entry.fact_id === factId);
}

test("all nine controlled claims execute with complete denominators and bounded reconstruction", (t) => {
  assert.equal(typeof evaluateMcpCallableContractConformance, "function");
  const input = fixture();
  const result = evaluateMcpCallableContractConformance(input, {
    collection: "population", offset: 0, limit: 2
  });
  assert.equal(result.status, "conformant");
  assert.deepEqual(result.summary.registered, { expected_count: 5, observed_count: 5 });
  assert.equal(result.summary.included_count, 2);
  assert.equal(result.summary.excluded_count, 3);
  assert.deepEqual(result.summary.excluded_by_kind, { role: 1, tier: 1, unsupported_runtime: 1 });
  assert.deepEqual(result.claim_status.map((entry) => entry.claim_id),
    MCP_CALLABLE_CONFORMANCE_CLAIM_IDS);
  assert.ok(result.claim_status.every((entry) => entry.status === "satisfied"));
  assert.deepEqual(new Set(input.owner_facts.map((entry) => entry.owner_id)), new Set([
    "WK-2029", "WK-2361", "WK-2386", "WK-2388", "WK-1842#item-1",
    "WK-1509", "WK-1948", "DEC-0118"
  ]));
  const reconstructed = [];
  let page = result.page;
  while (page !== null) {
    reconstructed.push(...page.items);
    page = page.next_page === null ? null
      : evaluateMcpCallableContractConformance(input, page.next_page).page;
  }
  assert.deepEqual(reconstructed.map((entry) => entry.member_id).sort(),
    input.inventory.registered_member_ids.toSorted());
  t.diagnostic(`registered=5 included=2 excluded=3 representations=5 owner_facts=11 claims=${MCP_CALLABLE_CONFORMANCE_CLAIM_IDS.join(",")}`);
});

test("every supplied population member and representation member is required", async (t) => {
  const baseline = fixture();
  for (const member of baseline.population) {
    await t.test(`population mutant ${member.member_id}`, () => {
      const input = fixture();
      input.population = input.population.filter((entry) => entry.member_id !== member.member_id);
      assertDiagnostic(input, "mcp_callable_contract.population_member_missing.v1");
    });
  }
  const alteredPopulation = fixture();
  alteredPopulation.population[0].role = "reviewer";
  assertDiagnostic(alteredPopulation, "mcp_callable_contract.population_member_contradictory.v1");
  for (const representationId of MCP_CALLABLE_REPRESENTATION_IDS) {
    await t.test(`representation mutant ${representationId}`, () => {
      const input = fixture();
      input.representations[representationId].shift();
      assertDiagnostic(input, "mcp_callable_contract.representation_member_missing.v1");
    });
  }
});

test("every owner fact is required and integrity failures stay typed", async (t) => {
  for (const ownerFact of fixture().owner_facts) {
    await t.test(`owner fact mutant ${ownerFact.fact_id}`, () => {
      const input = fixture();
      input.owner_facts = input.owner_facts.filter((entry) => entry.fact_id !== ownerFact.fact_id);
      assertDiagnostic(input, "mcp_callable_contract.owner_fact_missing.v1");
    });
    await t.test(`altered owner fact ${ownerFact.fact_id}`, () => {
      const input = fixture();
      input.owner_facts.find((entry) => entry.fact_id === ownerFact.fact_id).owner_id = "altered-owner";
      const diagnostic = diagnostics(input).find((entry) => entry.fact_id === ownerFact.fact_id);
      assert.ok(diagnostic, `altered ${ownerFact.fact_id} was not detected`);
      assert.ok(diagnostic.claim_ids.includes("claim-integrity"));
    });
  }
  const contradictory = fixture();
  contradictory.owner_facts.push(structuredClone(contradictory.owner_facts[0]));
  assertDiagnostic(contradictory, "mcp_callable_contract.owner_fact_contradictory.v1");
  const unparsable = fixture();
  unparsable.owner_facts[0].value = () => true;
  assertDiagnostic(unparsable, "mcp_callable_contract.owner_fact_unparsable.v1");
  const unprojectable = fixture();
  unprojectable.owner_facts[0].member_id = "worker:free_local:missing_tool";
  assertDiagnostic(unprojectable, "mcp_callable_contract.owner_fact_unprojectable.v1");
});

test("falsifying representation, recovery, classification, and call mutants emit exact identities", async (t) => {
  const mutants = [
    ["advertised argument rejected", "mcp_callable_contract.advertised_argument_rejected.v1", (input) => {
      actualFact(input, "handler_acceptance", "selected-record-argument").value = { type: "never" };
    }],
    ["accepted constraint undiscoverable", "mcp_callable_contract.accepted_constraint_undiscoverable.v1", (input) => {
      input.representations.discovery[0].facts = input.representations.discovery[0].facts
        .filter((entry) => entry.fact_id !== "selected-record-applicability");
    }],
    ["corrected call hidden", "mcp_callable_contract.supported_corrected_call_hidden.v1", (input) => {
      input.representations.public_result[0].facts = input.representations.public_result[0].facts
        .filter((entry) => entry.fact_id !== "selected-record-corrected-call");
    }],
    ["owner recovery altered", "mcp_callable_contract.owner_recovery_fact_altered.v1", (input) => {
      actualFact(input, "public_result", "refusal-owner-fact").value.code = "discarded";
    }],
    ["caller failure flattened", "mcp_callable_contract.caller_failure_flattened_to_operator_recovery.v1", (input) => {
      actualFact(input, "public_result", "refusal-recovery-actor").value = "operator";
    }],
    ["internal failure confused", "mcp_callable_contract.internal_failure_confused_with_invalid_public_input.v1", (input) => {
      actualFact(input, "public_result", "refusal-classification").value = "invalid_public_input";
    }],
    ["unsupported next call", "mcp_callable_contract.unsupported_next_call.v1", (input) => {
      actualFact(input, "public_result", "public-next-call").value.tool_name = "unsupported_tool";
    }],
    ["unsupported prose call", "mcp_callable_contract.unsupported_prose_call.v1", (input) => {
      actualFact(input, "discovery", "durable-prose-call").value.tool_name = "unsupported_tool";
    }]
  ];
  for (const [name, code, mutate] of mutants) {
    await t.test(name, () => {
      const input = fixture();
      mutate(input);
      assertDiagnostic(input, code);
    });
  }
});

test("bounded retrieval and visibility disclosures fail loudly when altered", () => {
  const retrieval = fixture();
  retrieval.owner_facts.find((entry) => entry.fact_id === "bounded-result")
    .value.next_call.arguments.task_id = "unsupported-task";
  assertDiagnostic(retrieval, "mcp_callable_contract.bounded_retrieval_route_unsupported.v1");

  const visibility = fixture();
  delete visibility.population.find((entry) => entry.visibility === "excluded").omission;
  assertDiagnostic(visibility, "mcp_callable_contract.visibility_disclosure_invalid.v1");
  const alteredVisibility = fixture();
  alteredVisibility.population.find((entry) => entry.visibility === "excluded").omission.kind = "sampled";
  assertDiagnostic(alteredVisibility, "mcp_callable_contract.visibility_disclosure_invalid.v1");

  const invalidWindow = evaluateMcpCallableContractConformance(fixture(), { limit: 101 });
  assert.ok(invalidWindow.page.items.some((entry) =>
    entry.code === "mcp_callable_contract.result_window_invalid.v1"));
  const nullWindow = evaluateMcpCallableContractConformance(fixture(), null);
  assert.ok(nullWindow.page.items.some((entry) =>
    entry.code === "mcp_callable_contract.result_window_invalid.v1"));
});

test("prohibited shortcut evidence cannot replace executed owner and boundary facts", () => {
  const input = fixture();
  input.owner_facts = [];
  input.evidence = {
    source_text_inspection: true,
    test_count: 999,
    coverage_percentage: 100,
    mock_only_boundary_substitution: true,
    assertions_executed: false
  };
  assertDiagnostic(input, "mcp_callable_contract.owner_fact_missing.v1");
});

test("distinct NUL-bearing owner-fact tuples cannot alias", () => {
  const input = fixture();
  const firstMember = "worker:free_local:collision";
  const secondMember = "worker:free_local:collision\u0000left";
  const firstFact = "left\u0000right";
  const secondFact = "right";
  assert.notDeepEqual([firstMember, firstFact], [secondMember, secondFact]);
  assert.equal(`${firstMember}\u0000${firstFact}`, `${secondMember}\u0000${secondFact}`);

  const members = [
    { member_id: firstMember, tool_name: "collision", role: "worker",
      tier: "free_local", visibility: "included" },
    { member_id: secondMember, tool_name: "collision\u0000left", role: "worker",
      tier: "free_local", visibility: "included" }
  ];
  input.population.push(...members);
  input.inventory.registered_member_ids.push(...members.map((entry) => entry.member_id));
  const ownerFacts = [
    fact(firstFact, "argument", { type: "string" }, ["published_schema"],
      ["claim-representations"], "WK-2029", firstMember),
    fact(secondFact, "argument", { type: "string" }, ["published_schema"],
      ["claim-representations"], "WK-2029", secondMember)
  ];
  input.owner_facts.push(...ownerFacts);
  input.inventory.owner_fact_ids.push(...ownerFacts.map((entry) => entry.fact_id));
  for (const representationId of MCP_CALLABLE_REPRESENTATION_IDS) {
    input.representations[representationId].push(
      { member_id: firstMember, facts: [] },
      { member_id: secondMember, facts: representationId === "published_schema"
        ? [{ fact_id: secondFact, owner_id: "WK-2029", fact_kind: "argument",
            value: { type: "string" } }]
        : [] }
    );
  }

  const result = evaluateMcpCallableContractConformance(input, {
    collection: "diagnostics", offset: 0, limit: 100
  });
  assert.equal(result.status, "nonconformant");
  assert.deepEqual(result.summary.registered, { expected_count: 7, observed_count: 7 });
  assert.equal(result.page.total_count, 1);
  assert.equal(result.page.items[0].code,
    "mcp_callable_contract.representation_fact_missing.v1");
  assert.equal(result.page.items[0].member_id, firstMember);
  assert.equal(result.page.items[0].fact_id, firstFact);
});
