import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { recommendToolRouteFromVocabulary } from "../packages/wiki-core/src/operations/tool-router.mjs";

const vocabulary = JSON.parse(
  await readFile(new URL("../packages/wiki-core/data/tool-routing-intents.v1.json", import.meta.url), "utf8"),
);

const intentByName = new Map(vocabulary.intents.map((intent) => [intent.intent, intent]));
const requiredIntentSet = new Set(vocabulary.required_initial_intents);

function requiredIntent(name) {
  const intent = intentByName.get(name);
  assert.ok(intent, `missing intent ${name}`);
  return intent;
}

function forbiddenTools(intentName) {
  return new Map(requiredIntent(intentName).forbidden_first_tools.map((entry) => [entry.tool, entry]));
}

function replacementPairs(intentName) {
  return requiredIntent(intentName).replacement_guidance.map((entry) => `${entry.replace}->${entry.with}`);
}

function hasRequiredPrerequisite(intentName, prerequisiteName) {
  return requiredIntent(intentName).prerequisite_state.some(
    (state) => state.name === prerequisiteName && state.required === true,
  );
}

function route(input) {
  return recommendToolRouteFromVocabulary(
    typeof input === "string"
      ? {
          task_description: input,
        }
      : input,
    vocabulary,
  );
}

function assertMatchedRoute(input, expected) {
  const result = route(input);
  assert.equal(result.result_state, "matched");
  assert.equal(result.classified_intent, expected.intent);
  assert.equal(result.recommended_first_tool, expected.tool);
  assert.deepEqual(result.suggested_arguments, expected.args ?? {});
  assert.ok(result.do_not_start_with.length > 0);
  assert.ok(result.allowed_next_calls.length > 0);
  assert.equal("candidate_intents" in result, false);
  assert.match(result.reason, expected.reason ?? /./);
  return result;
}

test("routing intent vocabulary declares the required initial intent and result-state contract", () => {
  assert.equal(vocabulary.schema_version, "tool-routing-intents.v1");
  assert.deepEqual([...requiredIntentSet].sort(), [
    "dispatch_readiness",
    "dispatch_role_call",
    "docs_lookup",
    "initiative_next_action",
    "initiative_status",
    "lint_repair",
    "run_monitoring",
    "selected_slice_detail",
    "selected_work_record_context",
    "work_record_mutation",
  ]);

  for (const intentName of requiredIntentSet) {
    const intent = requiredIntent(intentName);

    assert.ok(intent.use_when.length > 0, `${intentName} needs use_when guidance`);
    assert.ok(intent.match_phrases.length > 0, `${intentName} needs match phrases`);
    assert.ok(intent.recommended_first_tool.name, `${intentName} needs a first tool`);
    assert.ok(intent.forbidden_first_tools.length > 0, `${intentName} needs forbidden first tools`);
    assert.ok(intent.allowed_next_call_families.length > 0, `${intentName} needs next-call families`);
    assert.ok(intent.prerequisite_state.length > 0, `${intentName} needs prerequisite state`);
    assert.ok(intent.replacement_guidance.length > 0, `${intentName} needs replacement guidance`);
  }

  assert.deepEqual(Object.keys(vocabulary.router_result_states).sort(), ["ambiguous", "matched", "unknown"]);
  assert.deepEqual(vocabulary.router_result_states.matched.must_not_include, ["candidate_intents"]);
  assert.ok(vocabulary.router_result_states.ambiguous.required_output.includes("missing_disambiguating_state"));
  assert.ok(vocabulary.router_result_states.unknown.required_output.includes("unsupported_intent_guidance"));
  assert.match(vocabulary.router_result_states.unknown.deterministic_no_match_behavior, /without guessing/);
});

test("recommended first tool mappings cover the required routing intent set", () => {
  assert.equal(requiredIntent("initiative_status").recommended_first_tool.name, "workspace_initiative_status");
  assert.equal(requiredIntent("initiative_next_action").recommended_first_tool.name, "workspace_initiative_status");
  assert.equal(requiredIntent("selected_work_record_context").recommended_first_tool.name, "workspace_work_record_summary");
  assert.equal(requiredIntent("selected_slice_detail").recommended_first_tool.name, "workspace_work_record_summary");
  assert.equal(requiredIntent("dispatch_readiness").recommended_first_tool.name, "workspace_validate_dispatch");
  assert.equal(requiredIntent("dispatch_role_call").recommended_first_tool.name, "workspace_validate_dispatch");
  assert.equal(requiredIntent("run_monitoring").recommended_first_tool.name, "workspace_agent_run_status");
  assert.equal(requiredIntent("docs_lookup").recommended_first_tool.name, "workspace_search_repo");
  assert.equal(requiredIntent("lint_repair").recommended_first_tool.name, "workspace_lint_repo");
  assert.equal(requiredIntent("work_record_mutation").recommended_first_tool.name, "$validated_work_record_mutation_tool");
  assert.equal(
    requiredIntent("work_record_mutation").recommended_first_tool.operation_tool_map.closure,
    "workspace_work_record_set_closure",
  );
});

test("forbidden first tool and replacement guidance redirects known bad starts", () => {
  assert.equal(
    forbiddenTools("initiative_next_action").get("workspace_search_repo").use_instead,
    "workspace_initiative_status",
  );
  assert.equal(
    forbiddenTools("dispatch_role_call").get("workspace_agent_dispatch").use_instead,
    "workspace_validate_dispatch",
  );
  assert.equal(
    forbiddenTools("selected_slice_detail").get("workspace_get_record").use_instead,
    "workspace_work_record_summary",
  );
  assert.equal(forbiddenTools("work_record_mutation").get("manual JSON edit").use_instead, "workspace_work_record_set_status");

  assert.ok(replacementPairs("initiative_status").includes("workspace_search_repo->workspace_initiative_status"));
  assert.ok(replacementPairs("dispatch_readiness").includes("workspace_agent_dispatch->workspace_validate_dispatch"));
  assert.ok(replacementPairs("work_record_mutation").includes("manual JSON edit->validated work-record setter route"));
});

test("routing intent prerequisite state and allowed next call families reference declared families", () => {
  assert.ok(hasRequiredPrerequisite("initiative_status", "initiative_or_unit"));
  assert.ok(hasRequiredPrerequisite("selected_work_record_context", "unit"));
  assert.ok(hasRequiredPrerequisite("selected_slice_detail", "slice_unit"));
  assert.ok(hasRequiredPrerequisite("dispatch_readiness", "unit"));
  assert.ok(hasRequiredPrerequisite("dispatch_role_call", "unit"));
  assert.ok(hasRequiredPrerequisite("dispatch_role_call", "role"));
  assert.ok(hasRequiredPrerequisite("run_monitoring", "monitor_handle"));
  assert.ok(hasRequiredPrerequisite("docs_lookup", "query_or_path"));
  assert.ok(hasRequiredPrerequisite("work_record_mutation", "mutation_target"));
  assert.ok(hasRequiredPrerequisite("work_record_mutation", "mutation_operation"));

  for (const intentName of requiredIntentSet) {
    for (const familyName of requiredIntent(intentName).allowed_next_call_families) {
      assert.ok(vocabulary.call_families[familyName], `${intentName} references missing call family ${familyName}`);
    }
  }
});

test("core router recommends initiative status and next-action first tools", () => {
  const statusResult = assertMatchedRoute("What is the current state for IN-0016?", {
    intent: "initiative_status",
    tool: "workspace_initiative_status",
    args: {
      initiative: "IN-0016",
    },
  });
  assert.equal(
    statusResult.do_not_start_with.find((entry) => entry.tool === "workspace_search_repo")?.use_instead,
    "workspace_initiative_status",
  );

  assertMatchedRoute("What is the current state and next action for IN-0016?", {
    intent: "initiative_next_action",
    tool: "workspace_initiative_status",
    args: {
      initiative: "IN-0016",
      view: "next_action",
    },
    reason: /next-action questions/,
  });
});

test("core router recommends dispatch readiness before launch-capable tools", () => {
  const result = assertMatchedRoute("Is WK-1438#SLICE-012 dispatchable for a worker?", {
    intent: "dispatch_readiness",
    tool: "workspace_validate_dispatch",
    args: {
      unit: "WK-1438#SLICE-012",
      dispatch_role: "worker",
    },
  });

  assert.equal(
    result.do_not_start_with.find((entry) => entry.tool === "workspace_agent_dispatch")?.use_instead,
    "workspace_validate_dispatch",
  );
  assert.ok(result.allowed_next_calls.includes("workspace_agent_dispatch"));
});

test("core router treats role launch requests as dispatch role calls", () => {
  const result = assertMatchedRoute("Start a worker for WK-1438#SLICE-012", {
    intent: "dispatch_role_call",
    tool: "workspace_validate_dispatch",
    args: {
      unit: "WK-1438#SLICE-012",
      dispatch_role: "worker",
    },
  });

  assert.equal(
    result.do_not_start_with.find((entry) => entry.tool === "workspace_agent_dispatch")?.use_instead,
    "workspace_validate_dispatch",
  );
  assert.ok(result.allowed_next_calls.includes("workspace_agent_dispatch"));
});

test("core router recommends docs lookup through search with bounded docs filters", () => {
  const result = assertMatchedRoute("Find docs for tool discovery routing guidance", {
    intent: "docs_lookup",
    tool: "workspace_search_repo",
    args: {
      query: "Find docs for tool discovery routing guidance",
      filters: {
        paths: ["docs/", "wiki/"],
      },
    },
  });

  assert.equal(
    result.do_not_start_with.find((entry) => entry.tool === "workspace_get_record")?.use_instead,
    "workspace_search_repo",
  );
});

test("core router distinguishes selected record context from selected slice detail", () => {
  assertMatchedRoute("Load the work record context for WK-1438", {
    intent: "selected_work_record_context",
    tool: "workspace_work_record_summary",
    args: {
      unit: "WK-1438",
    },
  });

  const sliceResult = assertMatchedRoute("Read WK-1438#SLICE-012 work record context and slice detail", {
    intent: "selected_slice_detail",
    tool: "workspace_work_record_summary",
    args: {
      unit: "WK-1438#SLICE-012",
    },
  });
  assert.equal(
    sliceResult.do_not_start_with.find((entry) => entry.tool === "workspace_get_record")?.use_instead,
    "workspace_work_record_summary",
  );
});

test("core router returns bounded ambiguous and unsupported prompt guidance", () => {
  const ambiguousResult = route("Read WK-1438 and find docs for tool discovery");
  assert.equal(ambiguousResult.result_state, "ambiguous");
  assert.deepEqual(ambiguousResult.candidate_intents, ["selected_work_record_context", "docs_lookup"]);
  assert.equal(
    ambiguousResult.missing_disambiguating_state,
    "the smallest missing identifier, state marker, or user choice needed to distinguish the candidate intents",
  );
  assert.ok(ambiguousResult.do_not_start_with.length > 0);
  assert.ok(ambiguousResult.allowed_next_calls.includes("workspace_search_repo"));
  assert.equal("classified_intent" in ambiguousResult, false);
  assert.equal("recommended_first_tool" in ambiguousResult, false);
  assert.equal("suggested_arguments" in ambiguousResult, false);

  const unknownResult = route("Summarize this spreadsheet and send it to finance");
  assert.equal(unknownResult.result_state, "unknown");
  assert.equal("classified_intent" in unknownResult, false);
  assert.equal("recommended_first_tool" in unknownResult, false);
  assert.equal("candidate_intents" in unknownResult, false);
  assert.ok(unknownResult.unsupported_intent_guidance.length <= 3);
  assert.ok(unknownResult.unsupported_intent_guidance.some((item) => item.includes("Ask the user")));
});

test("core router derives validated work-record mutation routes", () => {
  const result = assertMatchedRoute("Add closure for WK-1438#SLICE-012", {
    intent: "work_record_mutation",
    tool: "workspace_work_record_set_closure",
    args: {
      unit: "WK-1438",
      slice_id: "SLICE-012",
    },
  });

  assert.equal(
    result.do_not_start_with.find((entry) => entry.tool === "manual JSON edit")?.use_instead,
    "workspace_work_record_set_status",
  );
  assert.ok(result.allowed_next_calls.includes("workspace_work_record_set_closure"));

  const missingOperation = route("Update WK-1438");
  assert.equal(missingOperation.result_state, "ambiguous");
  assert.deepEqual(missingOperation.candidate_intents, ["work_record_mutation"]);
  assert.equal(missingOperation.missing_disambiguating_state, "ask which work-record operation is intended");
  assert.equal("suggested_arguments" in missingOperation, false);
});
