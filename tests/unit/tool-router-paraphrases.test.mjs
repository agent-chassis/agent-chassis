

import assert from "node:assert/strict";
import test from "node:test";

import { createToolRouterHarness } from "../helpers/tool-router-recommendation.mjs";

const { route, descriptorForRole } = await createToolRouterHarness();

const INITIATIVE = "IN-0042";
const UNIT = "WK-0042";
const SLICE_UNIT = "WK-0042#SLICE-003";
const STATUS = "workspace_initiative_status";
const VALIDATE = "workspace_validate_dispatch";
const DISPATCH = "workspace_agent_dispatch";
const DESCRIBE = "workspace_tools_describe";

const SAMPLING_TOOLS = Object.freeze([
  "workspace_get_record",
  "workspace_search_repo",
  "workspace_read_page",
  "workspace_work_record_summary",
  "workspace_work_record_entry_read"
]);

function recommendedCall(result) {
  const recommended = result.next_calls.filter((call) => call.recommended === true);
  assert.ok(recommended.length <= 1, `${JSON.stringify(result.next_calls)} recommends at most one call`);
  return recommended[0] ?? null;
}

const STATUS_PARAPHRASES = Object.freeze([
  `Check where initiative ${INITIATIVE} stands.`,
  `What is the status of initiative ${INITIATIVE}?`,
  `Where does ${INITIATIVE} stand?`,
  `Where do things stand on ${INITIATIVE}?`,
  `Where are we on ${INITIATIVE}?`,
  `What is the current status of ${INITIATIVE}?`,
  `What is the state of initiative ${INITIATIVE}?`,
  `How are we doing on ${INITIATIVE}?`
]);

const NEXT_ACTION_PARAPHRASES = Object.freeze([
  `What should we do next for ${INITIATIVE}?`,
  `What's next for ${INITIATIVE}?`,
  `What is the next step for ${INITIATIVE}?`,
  `What should happen next for ${INITIATIVE}?`,
  `What comes next for ${INITIATIVE}?`
]);

test("initiative status and next-action paraphrases select their own lens", async () => {
  for (const task of STATUS_PARAPHRASES) {
    const result = await route(task);
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, "initiative_status", task);
    assert.deepEqual(recommendedCall(result),
      { tool: STATUS, arguments: { initiative: INITIATIVE }, recommended: true }, task);
  }
  for (const task of NEXT_ACTION_PARAPHRASES) {
    const result = await route(task);
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, "initiative_next_action", task);
    assert.deepEqual(recommendedCall(result),
      { tool: STATUS, arguments: { initiative: INITIATIVE }, recommended: true }, task);
  }
});

test("a status question without an initiative or unit stays explicit guidance", async () => {
  const result = await route("Look through records and tell me what is blocked.");
  assert.equal(result.result_state, "matched");
  assert.equal(result.classified_intent, "initiative_status");
  assert.deepEqual(result.next_calls, [], "no call is proposed without a subject");
  assert.deepEqual(result.required_authored_fields, ["initiative_or_unit"]);
});

test("an unbounded read returns bounded clarification and no inferred retrieval", async () => {
  const broad = [
    `Read everything relevant to ${INITIATIVE}.`,
    `Show me everything about ${INITIATIVE}.`,
    `Tell me everything you can about ${INITIATIVE}.`,
    `Read all the records for ${INITIATIVE}.`,
    `Give me the full context for ${INITIATIVE}.`
  ];
  for (const task of broad) {
    const result = await route(task);
    assert.equal(result.result_state, "ambiguous", task);
    assert.equal(Object.hasOwn(result, "classified_intent"), false, task);
    assert.deepEqual(result.candidate_intents, ["initiative_status"], task);
    assert.equal(result.candidate_set_complete, true, task);
    assert.match(result.reason, /unbounded read/u, task);
    assert.deepEqual(result.clarification_choices, [{
      intent: "initiative_status",
      operation: STATUS,
      arguments: { initiative: INITIATIVE },
      required_authored_fields: []
    }], task);

    assert.deepEqual(result.next_calls,
      [{ tool: STATUS, arguments: { initiative: INITIATIVE } }], task);
    for (const call of result.next_calls) {
      assert.equal(SAMPLING_TOOLS.includes(call.tool), false, `${task}: ${call.tool}`);
    }
  }
});

test("an unbounded read that names no subject asks for one instead of reading", async () => {
  const result = await route("Read everything relevant.");
  assert.equal(result.result_state, "ambiguous");
  assert.deepEqual(result.candidate_intents, ["initiative_status"]);
  assert.deepEqual(result.clarification_choices,
    [{ intent: "initiative_status", operation: STATUS, arguments: {},
      required_authored_fields: ["initiative_or_unit"] }]);
  assert.deepEqual(result.next_calls, []);
});

test("ordinary status wording keeps routing and is not read as unbounded", async () => {
  for (const task of [`What is blocked in ${INITIATIVE}?`, `Frontier status for ${INITIATIVE}.`]) {
    const result = await route(task);
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, "initiative_status", task);
  }
});

test("prospective questions stay readiness and never launch", async () => {
  const prospective = [
    [`Can we send a worker on ${UNIT}?`, { unit: UNIT, dispatch_role: "implementation" }],
    [`Could we send a worker on ${UNIT}?`, { unit: UNIT, dispatch_role: "implementation" }],
    [`Can we start ${UNIT}?`, { unit: UNIT }],
    [`Should we dispatch ${UNIT}?`, { unit: UNIT }],
    [`Is ${UNIT} ready to start?`, { unit: UNIT }],
    [`Are we ready to dispatch ${UNIT}?`, { unit: UNIT }],
    [`Check dispatch readiness for ${UNIT}.`, { unit: UNIT }],
    [`Can this slice start for ${SLICE_UNIT}?`, { unit: SLICE_UNIT }]
  ];
  for (const [task, expected] of prospective) {
    const result = await route(task);
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, "dispatch_readiness", task);
    assert.deepEqual(recommendedCall(result),
      { tool: VALIDATE, arguments: expected, recommended: true }, task);
    assert.equal(result.next_calls.some((call) => call.tool === DISPATCH), false,
      `${task} proposes no launch`);
  }
});

test("reviewer and redteam readiness stay with the dispatch owner's own assessment", async () => {
  for (const task of [`Can we send a reviewer on ${UNIT}?`, `Is ${UNIT} ready for redteam?`]) {
    const result = await route(task);
    assert.equal(result.classified_intent, "dispatch_readiness", task);
    assert.deepEqual(recommendedCall(result),
      { tool: DESCRIBE, arguments: { tool_name: DISPATCH }, recommended: true }, task);
  }
});

test("an explicit start selects dispatch and preserves the canonical subject", async () => {
  const starts = [
    [`Start ${UNIT}.`, { subject: UNIT }],
    [`Start ${SLICE_UNIT}.`, { subject: SLICE_UNIT }],
    [`Kick off ${UNIT}.`, { subject: UNIT }],
    [`Begin work on ${SLICE_UNIT}.`, { subject: SLICE_UNIT }],
    [`Start a worker on ${UNIT}.`, { role: "worker", subject: UNIT }],
    [`Dispatch reviewer for ${UNIT}.`, { role: "reviewer", subject: UNIT }]
  ];
  for (const [task, expected] of starts) {
    const result = await route(task);
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, "dispatch_role_call", task);
    assert.deepEqual(recommendedCall(result),
      { tool: DISPATCH, arguments: expected, recommended: true }, task);
  }
});

test("a polite imperative start is a start, not a readiness question", async () => {
  const result = await route(`Can you start ${UNIT}?`);
  assert.equal(result.classified_intent, "dispatch_role_call");
  assert.deepEqual(recommendedCall(result),
    { tool: DISPATCH, arguments: { subject: UNIT }, recommended: true });
});

test("neighbouring record, mutation and docs intents keep their current owners", async () => {
  const neighbours = [
    [`Read ${UNIT}.`, "selected_work_record_context", "workspace_work_record_summary"],
    [`Show me the write scope of ${UNIT}.`, "selected_work_record_context", "workspace_work_record_summary"],
    [`Read entry 2 of ${UNIT}.`, "selected_work_record_context", "workspace_work_record_entry_read"],
    [`Slice detail for ${SLICE_UNIT}.`, "selected_slice_detail", null],
    ["Find docs for the enforcement model.", "docs_lookup", "workspace_search_repo"]
  ];
  for (const [task, intent, tool] of neighbours) {
    const result = await route(task);
    assert.equal(result.result_state, "matched", task);
    assert.equal(result.classified_intent, intent, task);
    if (tool !== null) assert.equal(recommendedCall(result)?.tool, tool, task);
  }
});

test("an unsupported task stays unknown with no inferred route", async () => {
  for (const task of [`Reticulate the splines for ${UNIT}.`, "Book a meeting room for Thursday."]) {
    const result = await route(task);
    assert.equal(result.result_state, "unknown", task);
    assert.equal(Object.hasOwn(result, "classified_intent"), false, task);
    assert.deepEqual(result.next_calls, [], task);
    assert.equal(result.no_supported_route, true, task);
    assert.equal(result.recovery.state, "no_supported_route", task);
  }
});

test("a role-hidden start withholds the operation without disclosing a route", async () => {
  const role = "reviewer";
  assert.equal(descriptorForRole(role).tools.some(({ tool_name: name }) => name === DISPATCH), false,
    `${role} cannot see ${DISPATCH}`);
  const result = await route(`Start ${UNIT}.`, { role });
  assert.equal(result.result_state, "visibility_withheld");
  assert.equal(result.classified_intent, "dispatch_role_call");
  assert.deepEqual(result.next_calls, []);
  assert.equal(result.visibility_withholding.identity_disclosed, false);
  assert.equal(JSON.stringify(result).includes(DISPATCH), false,
    "a withheld result names neither the hidden operation nor its arguments");
});
