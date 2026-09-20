import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { z } from "zod";

import {
  TOOL_ROUTER_PRODUCER_ERROR_CODES
} from "../../packages/wiki-core/src/operations/tool-router.mjs";
import {
  evaluateAgentToolConformance,
  loadToolDiscoveryManifest
} from "../../packages/wiki-core/src/lib/tool-discovery/descriptor.mjs";
import {
  pickDoThisNext,
  validateNextCalls
} from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";
import { workspaceInitiativeStatus } from
  "../../packages/wiki-core/src/lib/initiative-status.mjs";
import { registerToolRouterTools } from
  "../../packages/wiki-mcp/src/lib/tool-router-tools.mjs";
import { registerToolDiscoveryTools } from
  "../../packages/wiki-mcp/src/lib/tool-discovery-tools.mjs";
import { resolveToolInputGuidancePath } from
  "../../packages/wiki-mcp/src/lib/tool-discovery-input-guidance-delivery.mjs";
import { CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE } from
  "../../packages/wiki-core/src/lib/controlled-contract-tools.mjs";
import { createToolRouterHarness } from "../helpers/tool-router-recommendation.mjs";

const {
  vocabulary,
  descriptor,
  rolePolicy,
  roleGrants,
  permissiveRequestContracts,
  descriptorForRole,
  recommend,
  route
} = await createToolRouterHarness();

const REGRESSION_CASES = Object.freeze([
  {
    name: "allocate WK under initiative",
    input: { task_description: "Allocate a WK under IN-0038 titled Improve matched routing" },
    intent: "work_record_mutation",
    tool: "workspace_create_record",
    arguments: { type: "wk", title: "Improve matched routing" },
    known_context: { initiative: "IN-0038" },
    known_argument_names: ["type", "title"]
  },
  {
    name: "edit acceptance",
    input: { task_description: "Edit acceptance for WK-2476" },
    intent: "work_record_mutation",
    tool: "workspace_work_record_edit",
    callable: false,
    arguments: { unit: "WK-2476", kind: "list" },
    required_authored_fields: ["field", "action", "value"],
    known_argument_names: ["unit"]
  },
  {
    name: "enter controlled authoring",
    input: { task_description: "Author controlled contract WK-2476" },
    intent: "controlled_contract_authoring",
    tool: "workspace_controlled_contract_obligation_coverage_query",
    arguments: { unit: "WK-2476" },
    known_argument_names: ["unit"]
  },
  {
    name: "query obligation coverage",
    input: { task_description: "Describe obligation inventory for WK-2476" },
    intent: "controlled_contract_obligation_coverage",
    tool: "workspace_controlled_contract_obligation_coverage_query",
    arguments: { unit: "WK-2476" },
    known_argument_names: ["unit"]
  },
  {
    name: "discover unknown proof intent",
    input: {
      task_description: "Discover controlled proof intent for lossless pagination",
      known_resources: { proof_query: "lossless pagination" }
    },
    intent: "controlled_contract_proof_selection",
    tool: "workspace_controlled_proof_intents_discover",
    arguments: { query: "lossless pagination" },
    known_argument_names: ["query"]
  },
  {
    name: "dispatch known review unit",
    input: { task_description: "Dispatch reviewer for WK-2476#SLICE-004" },
    intent: "dispatch_role_call",
    tool: "workspace_agent_dispatch",
    arguments: { role: "reviewer", subject: "WK-2476#SLICE-004" },
    known_argument_names: ["role", "subject"]
  },
  {
    name: "monitor known handle",
    input: { task_description: "Monitor handle wkmh_case for WK-2476" },
    intent: "run_monitoring",
    tool: "workspace_agent_run_status",
    arguments: { subject: "WK-2476" },
    known_argument_names: ["subject"]
  },
  {
    name: "documentation lookup",
    input: { task_description: "Find docs for matched tool routing" },
    intent: "docs_lookup",
    tool: "workspace_search_repo",
    arguments: { query: "Find docs for matched tool routing" },
    known_argument_names: ["query"]
  },
  {
    name: "role-invisible operation",
    input: { task_description: "Allocate a WK under IN-0038 titled Hidden route" },
    intent: "work_record_mutation",
    tool: null,
    role: "reviewer",
    known_argument_names: []
  }
]);

test("designated routing population selects one exact current first operation", async (context) => {
  const results = [];
  let classificationCorrect = 0;
  let firstOperationCorrect = 0;
  let recommendedCallCount = 0;
  let duplicateCount = 0;
  let populatedKnownArguments = 0;
  let knownArgumentTotal = 0;
  let callsBeforeOwningOperation = 0;

  for (const fixture of REGRESSION_CASES) {
    const result = await route(fixture.input, { role: fixture.role });
    results.push(result);
    if (result.classified_intent === fixture.intent) classificationCorrect += 1;
    const recommended = pickDoThisNext(result.next_calls);
    const partial = fixture.callable === false;
    const firstCorrect = fixture.tool === null
      ? result.result_state === "visibility_withheld" && recommended === null
      : partial
        ? result.result_state === "matched" && result.operation === fixture.tool && recommended === null
        : result.result_state === "matched" && recommended?.tool === fixture.tool;
    if (firstCorrect) firstOperationCorrect += 1;
    recommendedCallCount += result.next_calls.filter(({ recommended: value }) => value === true).length;
    duplicateCount += result.next_calls.length - new Set(result.next_calls.map(({ tool }) => tool)).size;

    if (fixture.tool !== null) {
      const proposed = partial ? result.suggested_arguments : recommended?.arguments ?? {};
      assert.deepEqual(proposed, fixture.arguments, fixture.name);
      assert.deepEqual(result.known_context, fixture.known_context ?? {}, fixture.name);
      for (const argumentName of fixture.known_argument_names) {
        knownArgumentTotal += 1;
        if (Object.hasOwn(proposed, argumentName)) populatedKnownArguments += 1;
      }
      assert.deepEqual(
        result.required_authored_fields,
        fixture.required_authored_fields ?? [],
        fixture.name
      );
      if (partial) {
        assert.deepEqual(result.next_calls, [], fixture.name);
      } else {
        const ownerIndex = result.next_calls.findIndex(({ tool }) => tool === fixture.tool);
        assert.equal(ownerIndex, 0, fixture.name);
        callsBeforeOwningOperation += ownerIndex;
        assert.equal(Object.hasOwn(result, "operation"), false, fixture.name);
      }
      const emitted = partial ? 0 : 1;
      assert.deepEqual(result.next_calls_completeness, {
        complete_total: emitted,
        returned_count: emitted,
        omitted_count: 0,
        is_complete: true,
        retrieval: null
      });
    } else {
      assert.equal(JSON.stringify(result).includes("workspace_create_record"), false);
      assert.deepEqual(result.visibility_withholding, {
        reason: "operation_not_visible_in_session_profile",
        identity_disclosed: false,
        recovery_available: false
      });
      assert.deepEqual(result.next_calls, []);
    }
    assert.deepEqual(validateNextCalls(result.next_calls), { valid: true, errors: [] });
    assert.equal(Object.hasOwn(result, "refusal"), false, fixture.name);
  }

  const deliveredResultBytes = results.reduce((total, result) =>
    total + Buffer.byteLength(JSON.stringify(result), "utf8"), 0);
  const metrics = {
    classification_accuracy: `${classificationCorrect}/${REGRESSION_CASES.length}`,
    first_operation_accuracy: `${firstOperationCorrect}/${REGRESSION_CASES.length}`,
    recommended_call_count: `${recommendedCallCount}/${REGRESSION_CASES.length}`,
    duplicate_count: `${duplicateCount}/${recommendedCallCount}`,
    populated_argument_rate: `${populatedKnownArguments}/${knownArgumentTotal}`,
    calls_before_owning_operation: `${callsBeforeOwningOperation}/${recommendedCallCount}`,
    delivered_result_bytes: deliveredResultBytes
  };
  context.diagnostic(`WK-2476 designated metric baseline ${JSON.stringify(metrics)}`);
  assert.deepEqual(metrics, {
    classification_accuracy: "9/9",
    first_operation_accuracy: "9/9",
    recommended_call_count: "7/9",
    duplicate_count: "0/7",
    populated_argument_rate: "10/10",
    calls_before_owning_operation: "0/7",
    delivered_result_bytes: deliveredResultBytes
  });
  assert.ok(deliveredResultBytes > 0, "bytes are measured evidence, not an acceptance ceiling");
});

test("missing caller-authored title stays matched and explicit guidance", async () => {
  const result = await route("Allocate a WK under IN-0038");
  assert.equal(result.result_state, "matched");
  assert.equal(result.operation, "workspace_create_record");
  assert.deepEqual(result.suggested_arguments, { type: "wk" });
  assert.deepEqual(result.required_authored_fields, ["title"]);
  assert.deepEqual(result.next_calls, []);
});

test("declared create-work-record identity and normalized ordinary wording route exactly", async () => {
  for (const task of ["create-work-record", "create work record"]) {
    const result = await route({
      task,
      task_description: "Allocate a canonical implementation unit for the active initiative"
    });
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, "work_record_mutation", task);
    assert.equal(result.operation, "workspace_create_record", task);
    assert.deepEqual(result.suggested_arguments, { type: "wk" }, task);
    assert.deepEqual(result.required_authored_fields, ["title"], task);
    assert.deepEqual(result.next_calls, [], task);
  }
});

test("operation route state predicates apply to exact task identities and role equality", async () => {
  const fixture = {
    intents: [{
      intent: "fixture_routes",
      match_phrases: ["fixture routes"],
      recommended_first_tool: {
        operation_routes: [
          { name: "workspace_validate_dispatch", match_task_ids: ["validate-dispatch"],
            when_state_present: ["unit"], arguments: { unit: "$unit_if_known" } },
          { name: "workspace_validate_dispatch", when_state_equals: { role: "read_only" },
            arguments: { unit: "$unit_if_known", dispatch_role: "read_only" } }
        ]
      }
    }]
  };
  const identity = await recommend({ task: "validate-dispatch", unit: "WK-2476" }, { vocabulary: fixture });
  assert.deepEqual(identity.next_calls[0].arguments, { unit: "WK-2476" });
  const identityWithoutUnit = await recommend({ task: "validate-dispatch", role: "worker" }, { vocabulary: fixture });
  assert.equal(identityWithoutUnit.result_state, "ambiguous", "an exact task identity still needs its declared state");
  const readOnly = await recommend({ task_description: "fixture routes", role: "read_only" }, { vocabulary: fixture });
  assert.deepEqual(readOnly.next_calls[0].arguments, { dispatch_role: "read_only" });
  const otherRole = await recommend({ task_description: "fixture routes", role: "reviewer" }, { vocabulary: fixture });
  assert.equal(otherRole.result_state, "ambiguous");
  assert.deepEqual(otherRole.next_calls, []);
});

test("producer contract failures fail visibly without schema content", async () => {
  const task = { task_description: "Find docs for matched tool routing" };
  await assert.rejects(recommend(task, { requestContracts: null }), {
    code: TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_SCHEMA_UNAVAILABLE,
    message: `${TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_SCHEMA_UNAVAILABLE}: workspace_search_repo (registration)`
  });
  const unprojectable = {
    contractFor: () => ({
      publishedRequestSchema() { throw new Error("{\"type\":\"object\",\"properties\":{}}"); },
      acceptsArguments: async () => true
    })
  };
  await assert.rejects(recommend(task, { requestContracts: unprojectable }), {
    code: TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_SCHEMA_UNAVAILABLE,
    message: `${TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_SCHEMA_UNAVAILABLE}: workspace_search_repo (projection)`
  });
  const fullRefusal = {
    contractFor: () => ({
      publishedRequestSchema: () => ({ type: "object", properties: {}, additionalProperties: true }),
      acceptsArguments: async () => false
    })
  };
  await assert.rejects(recommend(task, { requestContracts: fullRefusal }), {
    code: TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_CONTRACT_INVALID,
    message: `${TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_CONTRACT_INVALID}: workspace_search_repo (full_input_schema)`
  });

  const looked = [];
  const hidden = await recommend({ task_description: "Allocate a WK under IN-0038 titled Hidden route" }, {
    descriptor: descriptorForRole("reviewer"),
    requestContracts: { contractFor: (name) => { looked.push(name); return null; } }
  });
  assert.equal(hidden.result_state, "visibility_withheld");
  assert.deepEqual(looked, [], "a hidden operation is never looked up");
});

test("unrelated task identity retains no_supported_route", async () => {
  const result = await route({
    task: "archive-work-record",
    task_description: "Perform an unrelated unsupported operation"
  });
  assert.equal(result.result_state, "unknown");
  assert.equal(result.no_supported_route, true);
  assert.deepEqual(result.recovery, { state: "no_supported_route" });
  assert.deepEqual(result.next_calls, []);
});

test("ambiguity is a complete semantic set with an operative complete retrieval", async () => {
  const input = {
    task_description: "Read WK-1438 and find docs, then monitor handle wkmh_case"
  };
  const bounded = await route(input);
  assert.equal(bounded.result_state, "ambiguous");
  assert.equal(bounded.candidate_count_total, 3);
  assert.equal(bounded.candidate_set_complete, true);
  assert.equal(bounded.complete_candidate_set_next_call, undefined);
  assert.deepEqual(bounded.next_calls_completeness, {
    complete_total: 3,
    returned_count: 3,
    omitted_count: 0,
    is_complete: true,
    retrieval: null
  });
  assert.equal(pickDoThisNext(bounded.next_calls), null);
  assert.deepEqual(validateNextCalls(bounded.next_calls), { valid: true, errors: [] });

  const fourWay = await route({
    task_description:
      "Read WK-1438 and find docs, verify proof, then monitor handle wkmh_case"
  });
  assert.equal(fourWay.result_state, "ambiguous");
  assert.equal(fourWay.candidate_set_complete, true);
  assert.equal(fourWay.candidate_count_total, 3);
  assert.equal(fourWay.complete_candidate_set_next_call, undefined);
  assert.deepEqual(fourWay.next_calls_completeness, {
    complete_total: 3,
    returned_count: 3,
    omitted_count: 0,
    is_complete: true,
    retrieval: null
  });
  const missingOperationChoice = await route("Mutate work record");
  assert.equal(missingOperationChoice.result_state, "ambiguous");
  assert.equal(missingOperationChoice.candidate_count_total, 1);
  assert.deepEqual(missingOperationChoice.next_calls, []);
  assert.deepEqual(missingOperationChoice.next_calls_completeness, {
    complete_total: 0,
    returned_count: 0,
    omitted_count: 0,
    is_complete: true,
    retrieval: null
  });

  const withPartialChoice = await route("Edit acceptance for WK-2476, then monitor handle wkmh_case");
  assert.equal(withPartialChoice.result_state, "ambiguous");
  assert.equal(withPartialChoice.candidate_count_total, 2);
  assert.deepEqual(withPartialChoice.clarification_choices.find(({ intent }) => intent === "work_record_mutation"), {
    intent: "work_record_mutation",
    operation: "workspace_work_record_edit",
    arguments: { unit: "WK-2476", kind: "list" },
    required_authored_fields: ["field", "action", "value"]
  });
  assert.deepEqual(withPartialChoice.next_calls, [
    { tool: "workspace_agent_run_status", arguments: { subject: "WK-2476" } }
  ]);
  assert.equal(withPartialChoice.next_calls_completeness.complete_total, 1);
});

test("targeted known-placeholder cases retain executable server-known arguments", async () => {
  const cases = [
    {
      task: "Initiative status for IN-0038",
      tool: "workspace_initiative_status",
      arguments: { initiative: "IN-0038" }
    },
    {
      task: "What is the next action for IN-0038?",
      tool: "workspace_initiative_status",
      arguments: { initiative: "IN-0038" }
    }
  ];
  for (const fixture of cases) {
    const result = await route(fixture.task);
    assert.equal(result.result_state, "matched", fixture.task);
    assert.deepEqual(pickDoThisNext(result.next_calls), {
      tool: fixture.tool,
      arguments: fixture.arguments,
      recommended: true
    }, fixture.task);
    assert.deepEqual(result.required_authored_fields, fixture.required ?? [], fixture.task);
  }
});

test("next-action recommendation invokes the normal initiative lens projection", async () => {
  const routed = await route("What is the next action for IN-0038?");
  const recommended = pickDoThisNext(routed.next_calls);
  assert.deepEqual(recommended, {
    tool: "workspace_initiative_status",
    arguments: { initiative: "IN-0038" },
    recommended: true
  });
  const result = await workspaceInitiativeStatus({
    ...recommended.arguments,
    records: [{
      id: "WK-2476",
      initiative: "IN-0038",
      status: "todo",
      priority: "high",
      blockers: [],
      slices: []
    }]
  });
  assert.ok(Object.hasOwn(result, "next_action"));
});

test("unknown intent recovery is bounded and exact", async () => {
  const result = await route({
    task_description: "Summarize this spreadsheet",
    known_resources: { task_id: "inspect-provenance" }
  });
  assert.equal(result.result_state, "unknown");
  assert.deepEqual(pickDoThisNext(result.next_calls), {
    tool: "workspace_tools_list",
    arguments: { task_id: "inspect-provenance" },
    recommended: true
  });
  const docs = await route({
    task_description: "Summarize this spreadsheet",
    known_resources: { path: "wiki/areas/tooling.md" }
  });
  assert.deepEqual(docs.recovery.next_call, {
    tool: "workspace_search_repo",
    arguments: { query: "wiki/areas/tooling.md" },
    recommended: true
  });
});

test("completion intent proposes explicit completion and a notes request does not", async () => {
  const CLOSURE = "workspace_work_record_set_closure";

  for (const task of [
    "Close WK-2653",
    "Close out WK-2653",
    "Complete WK-2653",
    "Mark WK-2653 done"
  ]) {
    const result = await route({ task_description: task });
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, "work_record_mutation", task);
    assert.equal(result.operation, CLOSURE, task);
    assert.equal(result.suggested_arguments.status, "done",
      `${task} proposes the explicit completion argument`);
    assert.equal(result.suggested_arguments.unit, "WK-2653", task);

    assert.deepEqual(result.required_authored_fields, ["closure"], task);
    assert.equal(Object.hasOwn(result.suggested_arguments, "closure"), false,
      `${task} never takes closure content from the task text`);
  }

  for (const task of [
    "Add closure to WK-2653",
    "Record closure for WK-2653",
    "Update closure on WK-2653"
  ]) {
    const result = await route({ task_description: task });
    assert.equal(result.operation, CLOSURE, task);
    assert.equal(Object.hasOwn(result.suggested_arguments, "status"), false,
      `${task} must not become a completion request`);
    assert.deepEqual(result.required_authored_fields, ["closure"], task);
  }

  const statusOnly = await route({ task_description: "Set status of WK-2653 to active" });
  assert.equal(statusOnly.operation === CLOSURE, false,
    "an ordinary transition is not routed to the closure composition");
  assert.equal(statusOnly.suggested_arguments?.status ?? null, null,
    "no completion argument is proposed for an ordinary transition");

  const read = await route({ task_description: "Show me the closure for WK-2653" });
  assert.equal(read.operation === CLOSURE, false,
    "reading closure is not a closure mutation");
  assert.equal(read.suggested_arguments?.status ?? null, null);
});

test("registry and router have no parallel routing owners", async () => {
  const source = await readFile(new URL(
    "../../packages/wiki-core/src/operations/tool-router.mjs", import.meta.url), "utf8");
  assert.equal(Object.hasOwn(vocabulary, "call_families"), false);
  assert.equal(source.includes("MUTATION_TOOL_BY_KEYWORD"), false);
  assert.equal(source.includes("controlledContractCoverageIntentForTask"), false);
  const descriptorByName = new Map(descriptor.tools.map((entry) => [entry.tool_name, entry]));
  let routeCount = 0;
  for (const intent of vocabulary.intents) {
    const routes = intent.recommended_first_tool.operation_routes ??
      [intent.recommended_first_tool];
    for (const configuredRoute of routes) {
      routeCount += 1;
      assert.equal(Object.hasOwn(configuredRoute, "argument_template"), false,
        `${intent.intent}:${configuredRoute.name}`);
      const entry = descriptorByName.get(configuredRoute.name);
      assert.ok(entry, `${intent.intent}:${configuredRoute.name}`);
      assert.equal(entry.kind, "mcp_tool", configuredRoute.name);
      assert.equal(entry.runtime_posture, "supported", configuredRoute.name);
      assert.ok(entry.recommended_first_call, configuredRoute.name);
      assert.ok(entry.recommended_first_call.routing_intents?.includes(intent.intent),
        `${intent.intent}:${configuredRoute.name}`);
      if (configuredRoute.operation && !configuredRoute.arguments) {
        assert.equal(entry.recommended_first_call.operation, configuredRoute.operation,
          configuredRoute.name);
      }
      for (const taskId of configuredRoute.match_task_ids ?? []) {
        assert.ok(entry.task_ids.includes(taskId), `${configuredRoute.name}:${taskId}`);
      }
    }
  }
  assert.equal(routeCount, 44);
});

test("the advertised describe default is compact and keeps readiness ownership", async () => {
  const describe = descriptor.tools.find(({ tool_name: name }) => name === "workspace_tools_describe");
  assert.deepEqual(describe.recommended_first_call.arguments, { tool_name: "$known_tool_name" });
  assert.equal(Object.hasOwn(describe.recommended_first_call.arguments, "verbose"), false,
    "the default recipe does not request verbose detail");
  assert.deepEqual(describe.recommended_first_call.routing_intents,
    ["controlled_contract_input_guidance", "dispatch_readiness"]);
  for (const role of ["reviewer", "redteam"]) {
    const result = await route({ task_description: "Dispatch readiness for WK-2476", role });
    assert.deepEqual(result.next_calls, [{
      tool: "workspace_tools_describe",
      arguments: { tool_name: "workspace_agent_dispatch" },
      recommended: true
    }], role);
  }
});

test("canonical starts route to dispatch and prospective readiness stays a separate optional question", async () => {
  const workerStart = await route({ task_description: "Dispatch worker for WK-2476#SLICE-004" });
  assert.deepEqual(workerStart.next_calls, [{
    tool: "workspace_agent_dispatch",
    arguments: { role: "worker", subject: "WK-2476#SLICE-004" },
    recommended: true
  }]);

  const rolelessStart = await route({ task_description: "Start this unit", unit: "WK-2476#SLICE-004" });
  assert.deepEqual(rolelessStart.next_calls, [{
    tool: "workspace_agent_dispatch",
    arguments: { subject: "WK-2476#SLICE-004" },
    recommended: true
  }]);

  for (const start of [workerStart, rolelessStart]) {
    assert.equal(start.classified_intent, "dispatch_role_call");

    assert.deepEqual(start.next_calls.map(({ tool }) => tool), ["workspace_agent_dispatch"]);
    assert.notEqual(start.operation, "workspace_validate_dispatch");
  }

  const prospective = await route({ task_description: "Can this unit start?", unit: "WK-2476" });
  assert.equal(prospective.classified_intent, "dispatch_readiness");
  assert.deepEqual(prospective.next_calls, [{
    tool: "workspace_validate_dispatch", arguments: { unit: "WK-2476" }, recommended: true
  }]);
  assert.notEqual(prospective.operation, "workspace_agent_dispatch");

  for (const [role, expected] of [["worker", { unit: "WK-2476", dispatch_role: "implementation" }],
    ["read_only", { unit: "WK-2476", dispatch_role: "read_only" }], [undefined, { unit: "WK-2476" }]]) {
    const readiness = await route({ task_description: "Dispatch readiness for WK-2476", ...(role ? { role } : {}) });
    assert.deepEqual(readiness.next_calls, [{
      tool: "workspace_validate_dispatch", arguments: expected, recommended: true
    }], String(role));
  }

  const missingUnit = await route({ task_description: "Start this unit" });
  assert.equal(missingUnit.result_state, "matched");
  assert.equal(missingUnit.operation, "workspace_agent_dispatch");
  assert.deepEqual(missingUnit.required_authored_fields, ["unit"]);
  assert.deepEqual(missingUnit.next_calls, []);
  for (const task of ["Dispatch worker for WK-2476", "Start this unit for WK-2476"]) {
    const unsupported = await route({ task_description: task, role: "operator" });
    assert.notEqual(unsupported.result_state, "matched", task);
    assert.deepEqual(unsupported.next_calls, [], task);
  }

  const roleCall = vocabulary.intents.find(({ intent }) => intent === "dispatch_role_call");
  assert.equal(JSON.stringify(roleCall.prerequisite_state).includes("dispatchable"), false);
  assert.equal(roleCall.prerequisite_state.find(({ name }) => name === "role").required, false);
  assert.equal(roleCall.recommended_first_tool.operation_routes
    .some(({ name }) => name === "workspace_validate_dispatch"), false,
  "no dispatch_role_call route sends a start to the readiness assessment");
});

const DESCRIBE = "workspace_tools_describe";
const UPSERT = "workspace_controlled_contract_obligation_coverage_upsert";
const GUIDANCE_HELP_CASES = Object.freeze([
  ["Explain obligation coverage authoring", ["overview"]],
  ["obligation coverage authoring guidance", ["overview"]],
  ["Explain how to author a behavioral requirement", ["behavioral_example"]],
  ["behavioral requirement example", ["behavioral_example"]],
  ["Explain runtime test authoring", ["runtime_test_authoring"]],
  ["runtime test authoring guidance", ["runtime_test_authoring"]],
  ["Explain requirement rebinding guidance", ["required_object_shapes", "requirement_rebinding"]],
  ["how to retain cases when replacing a requirement", ["required_object_shapes", "requirement_rebinding"]],
  ["Explain the requirement relation vocabulary", ["vocabulary", "relation_details"]],
  ["requirement relation signatures", ["vocabulary", "relation_details"]]
]);

function registeredDescribeSchema() {
  let schema;
  registerToolDiscoveryTools({
    registerTool(name, definition) { if (name === DESCRIBE) schema = definition.inputSchema; },
    jsonContent: (data) => data,
    errorContent: (error) => { throw error; },
    augmentDescriptor: (loaded) => loaded,
    registeredTier: "paid_cce",
    sessionRole: "orchestrator"
  });
  return schema;
}

test("explicit authoring-help requests route to one complete registered guidance selection", async () => {
  const describeSchema = registeredDescribeSchema();
  const knownTools = new Set(descriptorForRole("orchestrator").tools.map(({ tool_name: name }) => name));
  const configured = vocabulary.intents.find(({ intent }) => intent === "controlled_contract_input_guidance")
    .recommended_first_tool.operation_routes;
  assert.deepEqual(new Set(configured.map((entry) => JSON.stringify(entry.arguments.input_contract.path))),
    new Set(GUIDANCE_HELP_CASES.map(([, path]) => JSON.stringify(path))),
    "every configured help route is exercised");
  for (const [task, path] of GUIDANCE_HELP_CASES) {

    for (const input of [{ task_description: task },
      { task_description: task, known_resources: { tool_name: UPSERT } }]) {
      const result = await route(input);
      assert.equal(result.result_state, "matched", task);
      assert.equal(result.classified_intent, "controlled_contract_input_guidance", task);
      assert.deepEqual(result.next_calls, [{
        tool: DESCRIBE,
        arguments: { tool_name: UPSERT, input_contract: { kind: "guidance", path } },
        recommended: true
      }], task);
      assert.deepEqual(result.required_authored_fields, [], task);
      assert.deepEqual(validateNextCalls(result.next_calls, { knownTools }), { valid: true, errors: [] });
      const parsed = describeSchema.safeParse(result.next_calls[0].arguments);
      assert.equal(parsed.success, true, `${task}: ${parsed.error?.message}`);
      const selected = resolveToolInputGuidancePath(CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE, path);
      assert.equal(selected.ok, true, `${task}: ${JSON.stringify(path)} resolves in the guidance owner`);
      assert.ok(JSON.stringify(selected.value).length > 0);
    }
  }
});

test("authoring, non-help and unresolved tasks keep their current router behavior", async () => {
  for (const [task, intent, tool] of [
    ["Author controlled contract WK-2476", "controlled_contract_authoring",
      "workspace_controlled_contract_obligation_coverage_query"],
    ["Author obligation coverage for WK-2476", "controlled_contract_proof_authoring", UPSERT],
    ["Describe obligation inventory for WK-2476", "controlled_contract_obligation_coverage",
      "workspace_controlled_contract_obligation_coverage_query"]
  ]) {
    const result = await route(task);
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, intent, task);
    assert.equal(pickDoThisNext(result.next_calls)?.tool ?? result.operation, tool, task);
    assert.equal(JSON.stringify(result).includes("\"guidance\""), false, task);
  }

  const ambiguous = await route("Explain runtime test authoring, then monitor handle wkmh_case");
  assert.equal(ambiguous.result_state, "ambiguous");
  assert.ok(ambiguous.candidate_intents.includes("controlled_contract_input_guidance"));
  assert.ok(ambiguous.candidate_intents.includes("run_monitoring"));
  assert.equal(pickDoThisNext(ambiguous.next_calls), null, "no topic is picked for an unresolved task");
  assert.deepEqual(validateNextCalls(ambiguous.next_calls), { valid: true, errors: [] });

  const unknown = await route("Explain the office seating chart");
  assert.equal(unknown.result_state, "unknown");
  assert.deepEqual(unknown.next_calls, []);
});

test("explanatory help keeps contextual units while write requests keep their own routes", async () => {
  const guidanceIntent = vocabulary.intents.find(({ intent }) => intent === "controlled_contract_input_guidance");
  assert.deepEqual(guidanceIntent.when_state_absent, ["write_request"]);

  for (const [input, path] of [
    [{ task_description: "explain obligation coverage authoring", unit: "WK-2640" }, ["overview"]],
    [{ task_description: "Explain obligation coverage authoring for WK-2640" }, ["overview"]],
    [{ task_description: "Explain how to author a behavioral requirement for WK-2476#SLICE-004" },
      ["behavioral_example"]],
    [{ task_description: "Explain runtime test authoring", unit: "WK-2476" }, ["runtime_test_authoring"]]
  ]) {
    const result = await route(input);
    assert.equal(result.result_state, "matched", JSON.stringify(input));
    assert.equal(result.classified_intent, "controlled_contract_input_guidance", JSON.stringify(input));
    assert.deepEqual(result.next_calls, [{
      tool: DESCRIBE,
      arguments: { tool_name: UPSERT, input_contract: { kind: "guidance", path } },
      recommended: true
    }], JSON.stringify(input));
    assert.deepEqual(result.required_authored_fields, [], JSON.stringify(input));
  }

  for (const [task, intent, tool, required] of [
    ["Author obligation coverage authoring guidance for WK-2476", "controlled_contract_proof_authoring",
      UPSERT, ["obligations"]],
    ["Author controlled contract WK-2476 following obligation coverage authoring guidance",
      "controlled_contract_authoring", "workspace_controlled_contract_obligation_coverage_query", []]
  ]) {
    const result = await route(task);
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, intent, task);
    assert.deepEqual(result.next_calls, required.length === 0
      ? [{ tool, arguments: { unit: "WK-2476" }, recommended: true }]
      : [], task);
    if (required.length > 0) assert.equal(result.operation, tool, task);
    assert.deepEqual(result.suggested_arguments, { unit: "WK-2476" }, task);
    assert.deepEqual(result.required_authored_fields, required, task);
  }

  for (const task of [
    "Add a behavioral requirement example to WK-2476",
    "Rebind requirement cases for WK-2476 using requirement rebinding guidance",
    "Update requirement relation signatures for WK-2476",
    "Save runtime test authoring guidance into WK-2476"
  ]) {
    const result = await route(task);
    assert.equal(result.result_state, "unknown", task);
    assert.deepEqual(result.next_calls, [], task);
    assert.equal(JSON.stringify(result).includes("\"guidance\""), false, task);
  }

  const mixed = await route("Explain obligation coverage authoring, then author obligation coverage for WK-2640");
  assert.equal(mixed.result_state, "ambiguous");
  assert.deepEqual(mixed.candidate_intents,
    ["controlled_contract_input_guidance", "controlled_contract_proof_authoring"]);
  assert.equal(pickDoThisNext(mixed.next_calls), null);
  assert.deepEqual(mixed.clarification_choices[1], {
    intent: "controlled_contract_proof_authoring",
    operation: UPSERT,
    arguments: { unit: "WK-2640" },
    required_authored_fields: ["obligations"]
  });
  assert.deepEqual(mixed.next_calls.map(({ tool }) => tool), [DESCRIBE]);
});

const ENTRY_READ = "workspace_work_record_entry_read";
const COVERAGE_QUERY = "workspace_controlled_contract_obligation_coverage_query";
const EDITOR = "workspace_work_record_edit";
const RUN_STATUS = "workspace_agent_run_status";
const ENTRY_40 = { unit: "WK-2633", entry_id: 40, include_body: true };
const SUMMARY_REPLACEMENT = { unit: "WK-2633", kind: "scalar", field: "sections.summary", action: "replace" };

test("ordinary entry, requirement and monitoring requests select their current read owners", async () => {
  for (const [input, intent, tool, args] of [
    [{ task_description: "Read entry 40 of WK-2633" }, "selected_work_record_context", ENTRY_READ, ENTRY_40],
    [{ task_description: "Show me WK-2633 entry #40" }, "selected_work_record_context", ENTRY_READ, ENTRY_40],
    [{ task_description: "What does entry 40 say?", unit: "WK-2633" }, "selected_work_record_context",
      ENTRY_READ, ENTRY_40],
    [{ task_description: "Open the entry", unit: "WK-2633", known_resources: { entry_id: "40" } },
      "selected_work_record_context", ENTRY_READ, ENTRY_40],
    [{ task_description: "List entries of WK-2633" }, "selected_work_record_context", ENTRY_READ,
      { unit: "WK-2633" }],
    [{ task_description: "Find the requirements and claims for WK-2640" }, "controlled_contract_obligation_coverage",
      COVERAGE_QUERY, { unit: "WK-2640" }],
    [{ task_description: "List the contract requirements of WK-2640" }, "controlled_contract_obligation_coverage",
      COVERAGE_QUERY, { unit: "WK-2640" }],
    [{ task_description: "Show WK-2640 requirements" }, "controlled_contract_obligation_coverage",
      COVERAGE_QUERY, { unit: "WK-2640" }],
    [{ task_description: "Monitor the reviewer run", unit: "WK-2649#SLICE-001",
      monitor_handle: "wkdb_98db4b3855ecf16e" }, "run_monitoring", RUN_STATUS, { subject: "WK-2649#SLICE-001" }],
    [{ task_description: "Check the worker run", unit: "WK-2649#SLICE-001" }, "run_monitoring", RUN_STATUS,
      { subject: "WK-2649#SLICE-001" }],
    [{ task_description: "Watch the run", known_resources: { subject: "IN-0016" } }, "run_monitoring", RUN_STATUS,
      { subject: "IN-0016" }]
  ]) {
    const result = await route(input);
    assert.equal(result.result_state, "matched", JSON.stringify(input));
    assert.equal(result.classified_intent, intent, JSON.stringify(input));
    assert.deepEqual(result.next_calls, [{ tool, arguments: args, recommended: true }], JSON.stringify(input));
    assert.deepEqual(result.required_authored_fields, [], JSON.stringify(input));
  }

  const acceptance = await route({ task_description: "Read acceptance criteria for WK-2645", unit: "WK-2645" });
  assert.deepEqual(acceptance.next_calls, [{ tool: "workspace_work_record_summary",
    arguments: { unit: "WK-2645" }, recommended: true }]);
});

test("summary replacement and missing context stay guidance without invented values", async () => {
  for (const [input, intent, tool, suggested, required] of [
    [{ task_description: "Replace the summary of WK-2633 with updated triage" }, "work_record_mutation", EDITOR,
      SUMMARY_REPLACEMENT, ["value"]],
    [{ task_description: "Update WK-2633 summary" }, "work_record_mutation", EDITOR, SUMMARY_REPLACEMENT, ["value"]],
    [{ task_description: "Rewrite the summary" }, "work_record_mutation", EDITOR,
      { kind: "scalar", field: "sections.summary", action: "replace" }, ["unit", "value"]],
    [{ task_description: "Read entry 40" }, "selected_work_record_context", ENTRY_READ,
      { entry_id: 40, include_body: true }, ["unit"]],
    [{ task_description: "Monitor the reviewer run", monitor_handle: "wkdb_98db4b3855ecf16e" }, "run_monitoring",
      RUN_STATUS, {}, ["subject"]]
  ]) {
    const result = await route(input);
    assert.equal(result.result_state, "matched", JSON.stringify(input));
    assert.equal(result.classified_intent, intent, JSON.stringify(input));
    assert.equal(result.operation, tool, JSON.stringify(input));
    assert.deepEqual(result.suggested_arguments, suggested, JSON.stringify(input));
    assert.deepEqual(result.required_authored_fields, required, JSON.stringify(input));
    assert.deepEqual(result.next_calls, [], JSON.stringify(input));
    assert.equal(JSON.stringify(result).includes("updated triage"), false, "task prose is never replacement content");
  }

  for (const task of ["Monitor the office temperature", "Summarize this spreadsheet"]) {
    const result = await route(task);
    assert.equal(result.result_state, "unknown", task);
    assert.deepEqual(result.next_calls, [], task);
  }

  const hidden = await route("Replace the summary of WK-2633 with updated triage", { role: "reviewer" });
  assert.equal(hidden.result_state, "visibility_withheld");
  assert.equal(JSON.stringify(hidden).includes(EDITOR), false);
});

const ENTRY_UPSERT = "workspace_work_record_entry_upsert";

test("ordinary entry writes select the entry operation by role and stay guidance until authored", async () => {

  for (const [task, suggested, required] of [
    ["Append a new entry to WK-2653", { unit: "WK-2653" }, ["kind", "title", "content"]],
    ["Add an entry to WK-2633", { unit: "WK-2633" }, ["kind", "title", "content"]],
    ["Create an entry for WK-2633 titled Triage notes", { unit: "WK-2633", title: "Triage notes" },
      ["kind", "content"]],
    ["Add a new entry", {}, ["unit", "kind", "title", "content"]],
    ["Update WK-2653 entry 35", { unit: "WK-2653", entry_id: 35 }, ["content"]],
    ["Update entry 40 of WK-2633 with the corrected triage", { unit: "WK-2633", entry_id: 40 }, ["content"]],
    ["Append a version to entry 3 of WK-2633", { unit: "WK-2633", entry_id: 3 }, ["content"]],
    ["Edit entry 4", { entry_id: 4 }, ["unit", "content"]]
  ]) {
    for (const role of ["orchestrator", "operator"]) {
      const result = await route(task, { role });
      assert.equal(result.result_state, "matched", `${role}: ${task}`);
      assert.equal(result.classified_intent, "work_record_mutation", `${role}: ${task}`);
      assert.equal(result.operation, ENTRY_UPSERT, `${role}: ${task}`);
      assert.deepEqual(result.suggested_arguments, suggested, `${role}: ${task}`);
      assert.deepEqual(result.required_authored_fields, required, `${role}: ${task}`);
      assert.equal(result.next_calls.some(({ tool }) => tool === ENTRY_UPSERT), false, `${role}: ${task}`);
      assert.equal(JSON.stringify(result).includes("corrected triage"), false, "task prose is never entry content");
      assert.deepEqual(validateNextCalls(result.next_calls), { valid: true, errors: [] });
    }

    for (const role of ["reviewer", "redteam"]) {
      const hidden = await route(task, { role });
      assert.equal(hidden.result_state, "visibility_withheld", `${role}: ${task}`);
      assert.equal(hidden.visibility_withholding.identity_disclosed, false);
      assert.deepEqual(hidden.next_calls, []);
      assert.equal(JSON.stringify(hidden).includes(ENTRY_UPSERT), false, `${role}: ${task}`);
      assert.equal(JSON.stringify(hidden).includes(ENTRY_READ), false, `${role}: ${task}`);
    }
  }

  for (const role of ["orchestrator", "reviewer"]) {
    const read = await route("Read entry 40 of WK-2633", { role });
    assert.deepEqual(read.next_calls, [{ tool: ENTRY_READ, arguments: ENTRY_40, recommended: true }], role);
    const inventory = await route("List entries of WK-2633", { role });
    assert.deepEqual(inventory.next_calls, [{ tool: ENTRY_READ, arguments: { unit: "WK-2633" }, recommended: true }]);
  }
  const summary = await route("Update WK-2633 summary");
  assert.equal(summary.operation, EDITOR);
  assert.deepEqual(summary.suggested_arguments, SUMMARY_REPLACEMENT);
  for (const task of ["Update WK-2653", "How to append an entry to WK-2633", "Acceptance criteria for WK-2645 entry 3"]) {
    const unresolved = await route(task);
    assert.equal(unresolved.result_state, "ambiguous", task);
    assert.equal(JSON.stringify(unresolved).includes(ENTRY_UPSERT), false, task);
  }
});

const REMOVE = "workspace_controlled_contract_obligation_coverage_remove";

test("status lens, slice-addressed monitoring, entry reads and mixed writes keep their owners", async () => {

  const lens = await route("Run the status lens for IN-0016");
  assert.equal(lens.classified_intent, "initiative_status");
  assert.deepEqual(lens.next_calls, [{
    tool: "workspace_initiative_status", arguments: { initiative: "IN-0016" }, recommended: true
  }]);
  const ordinaryMonitoring = await route({ task_description: "run status", unit: "WK-2649#SLICE-001" });
  assert.equal(ordinaryMonitoring.classified_intent, "run_monitoring");

  const monitored = await route("Monitor the reviewer run for WK-2649#SLICE-001");
  assert.equal(monitored.classified_intent, "run_monitoring");
  assert.deepEqual(monitored.next_calls, [{
    tool: RUN_STATUS, arguments: { subject: "WK-2649#SLICE-001" }, recommended: true
  }]);
  const structured = await route({ task_description: "Monitor the reviewer run", unit: "WK-2649#SLICE-001" });
  assert.deepEqual(monitored.next_calls, structured.next_calls, "text and structured subjects agree");
  const twoRequests = await route("Monitor the reviewer run and read acceptance criteria for WK-2649#SLICE-001");
  assert.equal(twoRequests.result_state, "ambiguous", "a genuinely additional request is not suppressed");
  assert.ok(twoRequests.candidate_intents.includes("run_monitoring"));
  assert.equal(pickDoThisNext(twoRequests.next_calls), null);

  const entry = await route("Read entry 5 of WK-2651 about write_scope");
  assert.equal(entry.classified_intent, "selected_work_record_context");
  assert.deepEqual(entry.next_calls, [{
    tool: ENTRY_READ, arguments: { unit: "WK-2651", entry_id: 5, include_body: true }, recommended: true
  }]);

  const guarded = await route("Acceptance criteria for WK-2645 entry 3");
  assert.equal(guarded.result_state, "ambiguous");
  assert.deepEqual(guarded.next_calls, []);
  assert.equal(JSON.stringify(guarded).includes("workspace_work_record_summary"), false);

  const mixedSave = await route("Explain obligation coverage authoring and save it for WK-2640");
  assert.equal(mixedSave.result_state, "ambiguous");
  assert.deepEqual(mixedSave.candidate_intents, ["controlled_contract_input_guidance"]);
  assert.match(mixedSave.reason, /also asks to write/u);
  assert.equal(pickDoThisNext(mixedSave.next_calls), null);
  assert.deepEqual(mixedSave.next_calls.map(({ tool }) => tool), [DESCRIBE]);
  assert.equal(mixedSave.next_calls.some(({ tool }) => tool === UPSERT), false, "no save is synthesized");

  for (const input of [{ task_description: "Explain obligation coverage authoring" },
    { task_description: "Explain obligation coverage authoring", unit: "WK-2640" }]) {
    const pure = await route(input);
    assert.equal(pure.result_state, "matched", JSON.stringify(input));
    assert.deepEqual(pure.next_calls[0].arguments.input_contract, { kind: "guidance", path: ["overview"] });
  }
});

test("an explicitly supplied focus is preserved and an unsupported one is dropped", async () => {
  for (const [task, operation, required] of [
    ["author proof obligation", UPSERT, ["obligations"]],
    ["delete proof selection", REMOVE, ["obligation_id", "removal_scope"]]
  ]) {
    const result = await route({
      task_description: task, unit: "WK-2640", known_resources: { focus: "dep-authoring" }
    });
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.operation, operation, task);
    assert.deepEqual(result.suggested_arguments, { unit: "WK-2640", focus: "dep-authoring" }, task);
    assert.deepEqual(result.required_authored_fields, required, task);
  }

  const dropped = await route({
    task_description: "author proof obligation", unit: "WK-2640", known_resources: { focus: "Not A Slug" }
  });
  assert.deepEqual(dropped.suggested_arguments, { unit: "WK-2640" });
  assert.equal(JSON.stringify(dropped).includes("Not A Slug"), false);
});

test("phrase words match in order across filler but not across other words", async () => {
  const vocabularyWith = (phrase) => ({
    intents: [{ intent: "fixture_filler", match_phrases: [phrase],
      recommended_first_tool: { name: "workspace_lint_repo" } }]
  });
  for (const [phrase, task, matched] of [
    ["replace summary", "Replace the summary of WK-2633", true],
    ["replace summary", "replace WK-2633#SLICE-001 summary", true],
    ["monitor run", "Monitor the reviewer run", true],
    ["monitor run", "monitor the failed run", false],
    ["read entry", "read the draft entry", false],
    ["monitor handle", "monitor handle wkmh_case", true]
  ]) {
    const result = await recommend({ task_description: task }, { vocabulary: vocabularyWith(phrase) });
    assert.equal(result.result_state, matched ? "matched" : "unknown", `${phrase} / ${task}`);
  }
});

test("a guidance recipe is withheld unless both describe and the described tool are visible", async () => {
  const reviewer = descriptorForRole("reviewer");
  assert.ok(reviewer.tools.some(({ tool_name: name }) => name === DESCRIBE), "describe itself is visible");
  assert.equal(reviewer.tools.some(({ tool_name: name }) => name === UPSERT), false);
  const withoutDescribe = {
    ...descriptor,
    tools: descriptor.tools.filter(({ tool_name: name }) => name !== DESCRIBE)
  };
  for (const visibleDescriptor of [reviewer, withoutDescribe]) {
    const withheld = await recommend(
      { task_description: "Explain requirement rebinding guidance" },
      { descriptor: visibleDescriptor }
    );
    assert.equal(withheld.result_state, "visibility_withheld");
    assert.deepEqual(withheld.next_calls, []);
    assert.equal(Object.hasOwn(withheld, "recovery"), false);
    const text = JSON.stringify(withheld);
    for (const disclosed of [UPSERT, "input_contract", "requirement_rebinding", "suggested_arguments"]) {
      assert.equal(text.includes(disclosed), false, disclosed);
    }
  }

  const ambiguous = await route("Explain runtime test authoring, then monitor handle wkmh_case", { role: "reviewer" });
  assert.equal(ambiguous.result_state, "ambiguous");
  assert.deepEqual(ambiguous.clarification_choices.find(({ intent }) =>
    intent === "controlled_contract_input_guidance"), {
    intent: "controlled_contract_input_guidance",
    visibility_withholding_reason: "operation_not_visible_in_session_profile"
  });
  assert.equal(JSON.stringify(ambiguous).includes(UPSERT), false);

  const unsupported = {
    ...descriptor,
    tools: descriptor.tools.filter(({ tool_name: name }) => name !== UPSERT)
  };
  await assert.rejects(recommend(
    { task_description: "Explain runtime test authoring" },
    { descriptor: unsupported, completeDescriptor: unsupported }
  ), /describes workspace_controlled_contract_obligation_coverage_upsert without a supported descriptor/u);
});

test("verify-proof routing preserves one canonical subject and selects no recovery owner", async () => {
  const result = await route("Verify proof obligation OBL-WK2462-01");
  assert.equal(result.result_state, "matched");
  assert.equal(result.classified_intent, "controlled_contract_verify_proof");
  assert.deepEqual(pickDoThisNext(result.next_calls), {
    tool: "workspace_verify_proof",
    arguments: { subject: "OBL-WK2462-01" },
    recommended: true
  });
  assert.deepEqual(result.required_authored_fields, []);
});

test("F1 descriptor completion retires owner-bound debt without rebasing it", async () => {
  const manifest = await loadToolDiscoveryManifest();
  const conformance = evaluateAgentToolConformance(descriptor, manifest);
  const completedNames = ["workspace_lint_repo"];
  assert.deepEqual(conformance.debt_added, []);
  for (const toolName of completedNames) {
    assert.ok(conformance.debt_retired.includes(toolName), toolName);
  }
});

test("incomplete descriptor metadata never throws or leaks a role-hidden operation", async () => {
  const withoutLintMetadata = {
    ...descriptor,
    tools: descriptor.tools.map((entry) => entry.tool_name === "workspace_lint_repo"
      ? { ...entry, recommended_first_call: undefined }
      : entry)
  };
  const visible = await recommend(
    { task_description: "Lint the repository" },
    { descriptor: withoutLintMetadata, completeDescriptor: withoutLintMetadata }
  );
  assert.equal(visible.result_state, "matched");
  assert.deepEqual(pickDoThisNext(visible.next_calls), {
    tool: "workspace_lint_repo",
    recommended: true
  });

  const hiddenDescriptor = {
    ...withoutLintMetadata,
    tools: withoutLintMetadata.tools.filter(({ tool_name: name }) =>
      name !== "workspace_lint_repo")
  };
  const hidden = await recommend(
    { task_description: "Lint the repository" },
    { descriptor: hiddenDescriptor, completeDescriptor: withoutLintMetadata }
  );
  assert.equal(hidden.result_state, "visibility_withheld");
  assert.deepEqual(hidden.next_calls, []);
  assert.equal(JSON.stringify(hidden).includes("workspace_lint_repo"), false);
  assert.equal(Object.hasOwn(hidden, "recovery"), false);
});

test("MCP adaptation uses server-minted role scope and rejects caller profile authority", async () => {
  let registration;
  registerToolRouterTools({
    registerTool(name, config, handler) {
      if (name === "workspace_tool_router_recommend") registration = { config, handler };
    },
    z,
    jsonContent: (value) => value,
    errorContent: (error) => { throw error; },
    sessionRole: "reviewer",
    registeredTier: "free_local",
    loadDescriptor: async () => descriptor
  });
  assert.ok(registration);
  for (const field of ["session_role", "tier", "profile", "prompt", "argv", "environment"]) {
    assert.equal(registration.config.inputSchema.safeParse({
      task_description: "Allocate a WK titled Hidden route",
      [field]: "operator"
    }).success, false, field);
  }
  const result = await registration.handler({
    task_description: "Allocate a WK titled Hidden route",
    role: "operator"
  });
  assert.equal(result.result_state, "visibility_withheld");
  assert.equal(JSON.stringify(result).includes("workspace_create_record"), false);
  assert.equal(result.visibility_withholding.reason,
    "operation_not_visible_in_session_profile");
  assert.equal(Object.hasOwn(result, "recovery"), false);

  let invalidProfileHandler;
  registerToolRouterTools({
    registerTool(name, _config, handler) {
      if (name === "workspace_tool_router_recommend") invalidProfileHandler = handler;
    },
    z,
    jsonContent: (value) => value,
    errorContent: (error) => { throw error; },
    sessionRole: "caller-claimed-role",
    registeredTier: "free_local",
    loadDescriptor: async () => descriptor
  });
  await assert.rejects(
    invalidProfileHandler({ task_description: "Find docs for routing" }),
    /Unsupported WIKI_MCP_TOOL_PROFILE/u
  );

  let unboundHandler;
  registerToolRouterTools({
    registerTool(name, _config, handler) {
      if (name === "workspace_tool_router_recommend") unboundHandler = handler;
    },
    z,
    jsonContent: (value) => value,
    errorContent: (error) => ({ isError: true, message: error.message }),
    sessionRole: "orchestrator",
    registeredTier: "free_local",
    loadDescriptor: async () => descriptor
  });
  assert.deepEqual(await unboundHandler({ task_description: "Find docs for routing" }), {
    isError: true,
    message: `${TOOL_ROUTER_PRODUCER_ERROR_CODES.REQUEST_SCHEMA_UNAVAILABLE}: workspace_search_repo (registration)`
  });
});

test("WK-2603 router discovery recovery remains complete and advisory", async () => {
  const authored = vocabulary.router_result_states.unknown.bounded_unsupported_intent_guidance;
  assert.equal(authored.guidance.length, authored.max_guidance_items,
    "every authored guidance item fits the declared bound");
  assert.match(authored.guidance[0], /workspace_tools_list/u);
  assert.match(authored.guidance[0], /workspace_tools_describe/u);
  const registeredSchemas = new Map();
  registerToolDiscoveryTools({
    registerTool(name, definition) { registeredSchemas.set(name, definition.inputSchema); },
    jsonContent: (data) => data,
    errorContent: (error) => { throw error; },
    augmentDescriptor: (loaded) => loaded,
    registeredTier: "paid_cce",
    sessionRole: "orchestrator"
  });
  const knownTools = new Set(descriptorForRole("orchestrator").tools.map(({ tool_name: name }) => name));
  const operativeKeys = new Set(["result_state", "unsupported_intent_guidance", "recovery",
    "no_supported_route", "stop_condition", "next_calls", "next_calls_completeness", "authority", "reason"]);
  const task = "Summarize this spreadsheet";
  const taskRecovery = await route({ task_description: task, known_resources: { task_id: "inspect-provenance" } });
  const nameRecovery = await route({ task_description: task, known_resources: { tool_name: "workspace_agent_dispatch" } });
  const noRecovery = await route({ task_description: task });

  for (const result of [taskRecovery, nameRecovery, noRecovery]) {
    assert.equal(result.result_state, "unknown");
    assert.deepEqual(result.unsupported_intent_guidance, authored.guidance, "no authored item is clipped");
    assert.equal(result.authority, "advisory_only");
    assert.ok(Object.keys(result).every((key) => operativeKeys.has(key)), JSON.stringify(Object.keys(result)));
    assert.equal(JSON.stringify(result).includes("workspace_tools_query"), false);
    assert.equal(validateNextCalls(result.next_calls, { knownTools }).valid, true);
  }
  assert.deepEqual(taskRecovery.recovery, {
    state: "callable",
    next_call: { tool: "workspace_tools_list", arguments: { task_id: "inspect-provenance" }, recommended: true }
  });
  assert.deepEqual(nameRecovery.recovery.next_call, {
    tool: "workspace_tools_describe",
    arguments: { tool_name: "workspace_agent_dispatch", limit: 1 },
    recommended: true
  });
  for (const result of [taskRecovery, nameRecovery]) {
    assert.deepEqual(result.next_calls, [result.recovery.next_call]);
    const { tool, arguments: args } = result.recovery.next_call;
    const parsed = registeredSchemas.get(tool).strict().safeParse(args);
    assert.equal(parsed.success, true, `${tool}: ${parsed.error?.message}`);
  }
  assert.deepEqual(noRecovery.recovery, { state: "no_supported_route" });
  assert.equal(noRecovery.no_supported_route, true);
  assert.deepEqual(noRecovery.next_calls, []);
});
