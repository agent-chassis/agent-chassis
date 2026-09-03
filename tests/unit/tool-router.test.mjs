import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { z } from "zod";

import {
  recommendToolRouteFromVocabulary
} from "../../packages/wiki-core/src/operations/tool-router.mjs";
import {
  loadToolDiscoveryDescriptor,
  resolveRoleToolGrantsFromPolicy
} from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
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

const vocabulary = JSON.parse(await readFile(new URL(
  "../../packages/wiki-core/data/tool-routing-intents.v1.json", import.meta.url), "utf8"));
const descriptor = await loadToolDiscoveryDescriptor();
const rolePolicy = JSON.parse(await readFile(new URL(
  "../../packages/wiki-core/data/tool-discovery/session-role-tool-access.json", import.meta.url), "utf8"));
const roleGrants = resolveRoleToolGrantsFromPolicy(rolePolicy);

function descriptorForRole(role) {
  const allowed = roleGrants.get(role) ?? new Set();
  return {
    ...descriptor,
    tools: descriptor.tools.filter(({ tool_name: toolName }) => allowed.has(toolName))
  };
}

function route(input, { role = "orchestrator" } = {}) {
  return recommendToolRouteFromVocabulary(
    typeof input === "string" ? { task_description: input } : input,
    vocabulary,
    { descriptor: descriptorForRole(role), completeDescriptor: descriptor }
  );
}

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
    tool: "workspace_work_record_set_acceptance",
    arguments: { unit: "WK-2476" },
    required_authored_fields: ["criteria_or_validation"],
    known_argument_names: ["unit"]
  },
  {
    name: "enter controlled authoring",
    input: { task_description: "Author controlled contract WK-2476" },
    intent: "controlled_contract_authoring",
    tool: "workspace_controlled_contract_authoring_state",
    arguments: { wk_id: "WK-2476" },
    known_argument_names: ["wk_id"]
  },
  {
    name: "describe obligation coverage",
    input: { task_description: "Describe obligation inventory for WK-2476" },
    intent: "controlled_contract_obligation_coverage",
    tool: "workspace_controlled_contract_obligation_coverage_describe",
    arguments: { unit: "WK-2476" },
    known_argument_names: ["unit"]
  },
  {
    name: "describe acceptance coverage",
    input: { task_description: "Describe acceptance map for WK-2476" },
    intent: "controlled_contract_acceptance_coverage",
    tool: "workspace_controlled_contract_acceptance_coverage_describe",
    arguments: { unit: "WK-2476" },
    known_argument_names: ["unit"]
  },
  {
    name: "select explicit proof intents for one slice",
    input: {
      task_description: "Select controlled proof pack for WK-2476#SLICE-004",
      known_resources: {
        focus: "router",
        requested_intents: ["controlled-proof-intent.lossless-projection"]
      }
    },
    intent: "controlled_contract_proof_selection",
    tool: "workspace_controlled_proof_packs_select",
    arguments: {
      wk_id: "WK-2476",
      focus: "router",
      requested_intents: ["controlled-proof-intent.lossless-projection"]
    },
    known_argument_names: ["wk_id", "focus", "requested_intents"]
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
    tool: "workspace_validate_dispatch",
    arguments: { unit: "WK-2476#SLICE-004", dispatch_role: "reviewer" },
    known_argument_names: ["unit", "dispatch_role"]
  },
  {
    name: "monitor known handle",
    input: { task_description: "Monitor handle wkmh_case for WK-2476" },
    intent: "run_monitoring",
    tool: "workspace_agent_run_status",
    arguments: { monitor_handle: "wkmh_case", subject: "WK-2476" },
    known_argument_names: ["monitor_handle", "subject"]
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

test("designated WK-2476 eleven-case metric population selects one exact first operation", (context) => {
  const results = [];
  let classificationCorrect = 0;
  let firstOperationCorrect = 0;
  let recommendedCallCount = 0;
  let duplicateCount = 0;
  let populatedKnownArguments = 0;
  let knownArgumentTotal = 0;
  let callsBeforeOwningOperation = 0;

  for (const fixture of REGRESSION_CASES) {
    const result = route(fixture.input, { role: fixture.role });
    results.push(result);
    if (result.classified_intent === fixture.intent) classificationCorrect += 1;
    const recommended = pickDoThisNext(result.next_calls);
    const firstCorrect = fixture.tool === null
      ? result.result_state === "visibility_withheld" && recommended === null
      : result.result_state === "matched" && recommended?.tool === fixture.tool;
    if (firstCorrect) firstOperationCorrect += 1;
    recommendedCallCount += result.next_calls.filter(({ recommended: value }) => value === true).length;
    duplicateCount += result.next_calls.length - new Set(result.next_calls.map(({ tool }) => tool)).size;

    if (fixture.tool !== null) {
      assert.deepEqual(recommended?.arguments ?? {}, fixture.arguments, fixture.name);
      assert.deepEqual(result.known_context, fixture.known_context ?? {}, fixture.name);
      const ownerIndex = result.next_calls.findIndex(({ tool }) => tool === fixture.tool);
      assert.equal(ownerIndex, 0, fixture.name);
      callsBeforeOwningOperation += ownerIndex;
      for (const argumentName of fixture.known_argument_names) {
        knownArgumentTotal += 1;
        if (Object.hasOwn(recommended.arguments ?? {}, argumentName)) populatedKnownArguments += 1;
      }
      assert.deepEqual(
        result.required_authored_fields,
        fixture.required_authored_fields ?? [],
        fixture.name
      );
      assert.deepEqual(result.next_calls_completeness, {
        complete_total: 1,
        returned_count: 1,
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
    classification_accuracy: "11/11",
    first_operation_accuracy: "11/11",
    recommended_call_count: "10/11",
    duplicate_count: "0/10",
    populated_argument_rate: "15/15",
    calls_before_owning_operation: "0/10",
    delivered_result_bytes: deliveredResultBytes
  });
  assert.ok(deliveredResultBytes > 0, "bytes are measured evidence, not an acceptance ceiling");
});

test("missing caller-authored title stays matched and explicit", () => {
  const result = route("Allocate a WK under IN-0038");
  assert.equal(result.result_state, "matched");
  assert.equal(pickDoThisNext(result.next_calls).tool, "workspace_create_record");
  assert.deepEqual(pickDoThisNext(result.next_calls).arguments, { type: "wk" });
  assert.deepEqual(result.required_authored_fields, ["title"]);
});

test("declared create-work-record identity and normalized ordinary wording route exactly", () => {
  for (const task of ["create-work-record", "create work record"]) {
    const result = route({
      task,
      task_description: "Allocate a canonical implementation unit for the active initiative"
    });
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, "work_record_mutation", task);
    assert.deepEqual(pickDoThisNext(result.next_calls), {
      tool: "workspace_create_record",
      arguments: { type: "wk" },
      recommended: true
    }, task);
    assert.deepEqual(result.required_authored_fields, ["title"], task);
  }
});

test("unrelated task identity retains no_supported_route", () => {
  const result = route({
    task: "archive-work-record",
    task_description: "Perform an unrelated unsupported operation"
  });
  assert.equal(result.result_state, "unknown");
  assert.equal(result.no_supported_route, true);
  assert.deepEqual(result.recovery, { state: "no_supported_route" });
  assert.deepEqual(result.next_calls, []);
});

test("ambiguity is a complete semantic set with an operative complete retrieval", () => {
  const input = {
    task_description: "Read WK-1438 and find docs, then monitor handle wkmh_case"
  };
  const bounded = route(input);
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

  const fourWay = route({
    task_description:
      "Read WK-1438 and find docs, assess controlled contract, then monitor handle wkmh_case"
  });
  assert.equal(fourWay.result_state, "ambiguous");
  assert.equal(fourWay.candidate_set_complete, false);
  assert.equal(fourWay.candidate_count_total, 4);
  assert.equal(fourWay.complete_candidate_set_next_call.tool, "workspace_tool_router_recommend");
  assert.deepEqual(fourWay.next_calls_completeness, {
    complete_total: 4,
    returned_count: 4,
    omitted_count: 0,
    is_complete: true,
    retrieval: null
  });
  assert.ok(fourWay.next_calls.some((call) =>
    call.tool === fourWay.complete_candidate_set_next_call.tool &&
      call.arguments?.candidate_view === "complete"));
  const complete = route(fourWay.complete_candidate_set_next_call.arguments);
  assert.equal(complete.candidate_view, "complete");
  assert.equal(complete.candidate_set_complete, true);
  assert.equal(complete.candidate_count_displayed, 4);
  assert.deepEqual(complete.next_calls_completeness, {
    complete_total: 4,
    returned_count: 4,
    omitted_count: 0,
    is_complete: true,
    retrieval: null
  });

  const missingOperationChoice = route("Mutate work record");
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
});

test("targeted known-placeholder cases retain executable server-known arguments", () => {
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
    },
    {
      task: "Assess controlled contract WK-2476",
      tool: "workspace_controlled_contract_assess",
      arguments: { wk_id: "WK-2476" }
    },
    {
      task: "Plan controlled contract refactor for WK-2476",
      tool: "workspace_controlled_contract_refactor_plan",
      arguments: { wk_id: "WK-2476" },
      required: ["generation", "rename_or_replace_mode"]
    }
  ];
  for (const fixture of cases) {
    const result = route(fixture.task);
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
  const routed = route("What is the next action for IN-0038?");
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

test("unknown intent recovery is bounded and exact", () => {
  const result = route({
    task_description: "Summarize this spreadsheet",
    known_resources: { task_id: "inspect-provenance" }
  });
  assert.equal(result.result_state, "unknown");
  assert.deepEqual(pickDoThisNext(result.next_calls), {
    tool: "workspace_tools_query",
    arguments: { task_id: "inspect-provenance", limit: 3 },
    recommended: true
  });
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
      if (configuredRoute.operation) {
        assert.equal(entry.recommended_first_call.operation, configuredRoute.operation,
          configuredRoute.name);
      }
      for (const taskId of configuredRoute.match_task_ids ?? []) {
        assert.ok(entry.task_ids.includes(taskId), `${configuredRoute.name}:${taskId}`);
      }
    }
  }
  assert.equal(routeCount, 32);
});

test("F1 descriptor completion retires owner-bound debt without rebasing it", async () => {
  const manifest = await loadToolDiscoveryManifest();
  const conformance = evaluateAgentToolConformance(descriptor, manifest);
  const completedNames = [
    "workspace_controlled_contract_authoring_continue",
    "workspace_controlled_contract_carrier_query",
    "workspace_controlled_contract_runtime_prove",
    "workspace_lint_repo"
  ];
  assert.deepEqual(conformance.debt_added, []);
  for (const toolName of completedNames) {
    assert.ok(conformance.debt_retired.includes(toolName), toolName);
  }
});

test("incomplete descriptor metadata never throws or leaks a role-hidden operation", () => {
  const withoutLintMetadata = {
    ...descriptor,
    tools: descriptor.tools.map((entry) => entry.tool_name === "workspace_lint_repo"
      ? { ...entry, recommended_first_call: undefined }
      : entry)
  };
  const visible = recommendToolRouteFromVocabulary(
    { task_description: "Lint the repository" },
    vocabulary,
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
  const hidden = recommendToolRouteFromVocabulary(
    { task_description: "Lint the repository" },
    vocabulary,
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
});
