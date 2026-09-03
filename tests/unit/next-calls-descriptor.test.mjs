

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNextCall,
  buildNextCalls,
  renderNextCall,
  validateNextCalls,
  pickDoThisNext,
  projectNextActionScalar,
  isCanonicalNextCallTool,
  CANONICAL_NEXT_CALL_TOOL_NAMES,
  SUCCESS_PREDICATE_OPERATORS,
  buildContinuationCall,
  evaluateSuccessPredicate,
  isMachineCheckableSuccessPredicate,
  isUnresolvedArgumentValue,
  isAuthoritativeRequestSchema,
  requestContractErrors,
  unresolvedArgumentNames,
  validateContinuationCalls
} from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";

const GET_RECORD = "workspace_get_record";
const VALIDATE = "workspace_work_record_validate";
const SEARCH = "workspace_search_repo";
const DISPATCH = "workspace_agent_dispatch";
const PREFLIGHT = "workspace_coordination_preflight";

test("buildNextCalls constructs one validated complete population", () => {
  assert.deepEqual(buildNextCalls([
    { tool: SEARCH, arguments: { query: "router" }, recommended: true }
  ], { knownTools: new Set([SEARCH]) }), [{
    tool: SEARCH,
    arguments: { query: "router" },
    recommended: true
  }]);
});

test("buildNextCalls rejects duplicate and disallowed constructed calls", () => {
  assert.throws(() => buildNextCalls([
    { tool: SEARCH },
    { tool: SEARCH, arguments: { query: "other" } }
  ]), /duplicates tool/u);
  assert.throws(() => buildNextCalls([
    { tool: SEARCH, recommended: true, disallowed: true }
  ]), /recommended/u);
  assert.throws(() => buildNextCalls([
    { tool: SEARCH }
  ], { knownTools: new Set([GET_RECORD]) }), /unregistered tool/u);
});

const VALIDATE_SCHEMA = Object.freeze({
  type: "object",
  properties: { repo: { type: "string" }, id: { type: "string" } },
  required: ["id"],
  additionalProperties: false
});
const PREFLIGHT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    repo: { type: "string" },
    role: { type: "string", enum: ["coordinator", "worker", "reviewer", "redteam"] },
    target_dispatch_role: {
      type: "string",
      enum: ["coordinator", "worker", "reviewer", "redteam"]
    },
    verbose: { type: "boolean" }
  },
  additionalProperties: false
});
const REQUEST_SCHEMAS = Object.freeze({
  [VALIDATE]: VALIDATE_SCHEMA,
  [PREFLIGHT]: PREFLIGHT_SCHEMA
});

test("buildNextCall normalizes tool, arguments, and flags", () => {
  const entry = buildNextCall({
    tool: GET_RECORD,
    arguments: { id: "WK-1510" },
    recommended: true
  });
  assert.equal(entry.tool, GET_RECORD);
  assert.deepEqual(entry.arguments, { id: "WK-1510" });
  assert.equal(entry.recommended, true);
  assert.equal(entry.disallowed, undefined);
});

test("buildNextCall clones arguments so the spec cannot be mutated through the entry", () => {
  const args = { id: "WK-1510" };
  const entry = buildNextCall({ tool: GET_RECORD, arguments: args });
  entry.arguments.id = "WK-9999";
  assert.equal(args.id, "WK-1510");
});

test("buildNextCall preserves negative-set payload on a disallowed entry", () => {
  const entry = buildNextCall({
    tool: DISPATCH,
    disallowed: true,
    reason: "not ready",
    use_instead: VALIDATE
  });
  assert.equal(entry.disallowed, true);
  assert.equal(entry.reason, "not ready");
  assert.equal(entry.use_instead, VALIDATE);
});

test("buildNextCall omits flags that are not set true (name-only allowed entry)", () => {
  const entry = buildNextCall({ tool: SEARCH });
  assert.deepEqual(entry, { tool: SEARCH });
});

test("buildNextCall rejects a non-object spec", () => {
  assert.throws(() => buildNextCall(null), TypeError);
  assert.throws(() => buildNextCall([]), TypeError);
});

test("buildNextCall rejects a missing or empty tool", () => {
  assert.throws(() => buildNextCall({}), TypeError);
  assert.throws(() => buildNextCall({ tool: "" }), TypeError);
  assert.throws(() => buildNextCall({ tool: "   " }), TypeError);
});

test("buildNextCall rejects non-boolean flags", () => {
  assert.throws(() => buildNextCall({ tool: GET_RECORD, recommended: "yes" }), TypeError);
  assert.throws(() => buildNextCall({ tool: GET_RECORD, disallowed: 1 }), TypeError);
});

test("buildNextCall rejects an entry that is both recommended and disallowed", () => {
  assert.throws(
    () => buildNextCall({ tool: GET_RECORD, recommended: true, disallowed: true }),
    TypeError
  );
});

test("buildNextCall rejects non-object arguments", () => {
  assert.throws(() => buildNextCall({ tool: GET_RECORD, arguments: "id=1" }), TypeError);
  assert.throws(() => buildNextCall({ tool: GET_RECORD, arguments: ["id"] }), TypeError);
});

test("renderNextCall renders an argument-bearing call string and a bare name", () => {
  assert.equal(
    renderNextCall({ tool: GET_RECORD, arguments: { id: "WK-1510" } }),
    `${GET_RECORD}({id:"WK-1510"})`
  );
  assert.equal(renderNextCall({ tool: SEARCH }), SEARCH);
  assert.equal(renderNextCall({ tool: GET_RECORD, arguments: {} }), GET_RECORD);
});

test("validateNextCalls accepts a well-formed list", () => {
  const list = [
    buildNextCall({ tool: GET_RECORD, recommended: true }),
    buildNextCall({ tool: SEARCH }),
    buildNextCall({ tool: DISPATCH, disallowed: true })
  ];
  const result = validateNextCalls(list);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateNextCalls rejects a non-array list", () => {
  const result = validateNextCalls(null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validateNextCalls rejects a recommended entry that is not an allowed subset member", () => {

  const list = [{ tool: GET_RECORD, recommended: true, disallowed: true }];
  const result = validateNextCalls(list);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /recommended/.test(e) && /disallowed/.test(e)));
});

test("validateNextCalls rejects invalid flag types", () => {
  const result = validateNextCalls([
    { tool: GET_RECORD, recommended: "true" },
    { tool: SEARCH, disallowed: 0 }
  ]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /recommended must be a boolean/.test(e)));
  assert.ok(result.errors.some((e) => /disallowed must be a boolean/.test(e)));
});

test("validateNextCalls rejects a malformed entry and a missing tool", () => {
  const result = validateNextCalls([null, { tool: "" }, "nope"]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 3);
});

test("validateNextCalls rejects non-object arguments", () => {
  const result = validateNextCalls([{ tool: GET_RECORD, arguments: ["x"] }]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /arguments must be a plain object/.test(e)));
});

test("validateNextCalls rejects a canonical tool that knownTools narrows away", () => {
  const known = [GET_RECORD, SEARCH];
  const ok = validateNextCalls([{ tool: GET_RECORD }, { tool: SEARCH }], { knownTools: known });
  assert.equal(ok.valid, true);

  const bad = validateNextCalls([{ tool: GET_RECORD }, { tool: DISPATCH }], { knownTools: known });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => new RegExp(`unregistered tool "${DISPATCH}"`).test(e)));
});

test("validateNextCalls accepts knownTools as a Set or predicate", () => {
  const set = validateNextCalls([{ tool: GET_RECORD }], { knownTools: new Set([GET_RECORD]) });
  assert.equal(set.valid, true);
  const pred = validateNextCalls([{ tool: GET_RECORD }], { knownTools: (t) => t === GET_RECORD });
  assert.equal(pred.valid, true);
});

test("WK-2359: omitting knownTools still checks canonical registration", () => {

  const result = validateNextCalls([{ tool: "some-unregistered-tool" }]);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => /not in the canonical tool-discovery corpus/.test(e)),
    "an unregistered tool must be reported against the canonical corpus"
  );
});

test("WK-2359: knownTools cannot widen the canonical corpus", () => {

  const result = validateNextCalls([{ tool: "invented_route" }], {
    knownTools: ["invented_route"]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /not in the canonical tool-discovery corpus/.test(e)));
});

test("WK-2359: an always-true knownTools predicate cannot switch the check off", () => {
  const result = validateNextCalls([{ tool: "invented_route" }], { knownTools: () => true });
  assert.equal(result.valid, false);
});

test("WK-2359: a private launcher action token never validates as a tool name", () => {

  for (const token of [
    "restore_wk_lifecycle",
    "retry_launch",
    "operator_intervention_required",
    "reconcile_slice_tip"
  ]) {
    assert.equal(isCanonicalNextCallTool(token), false, `${token} must not be canonical`);
    assert.equal(validateNextCalls([{ tool: token }]).valid, false);
    assert.throws(() => buildNextCall({ tool: token }), TypeError);
  }
});

test("WK-2359: a CLI command is not an agent-callable next call", () => {

  assert.equal(isCanonicalNextCallTool("wiki"), false);
  assert.equal(isCanonicalNextCallTool("agent-launch"), false);
});

test("WK-2359: the canonical corpus is non-empty and holds registered MCP routes", () => {
  assert.ok(CANONICAL_NEXT_CALL_TOOL_NAMES.size > 0);
  assert.equal(CANONICAL_NEXT_CALL_TOOL_NAMES.has(DISPATCH), true);
  assert.equal(CANONICAL_NEXT_CALL_TOOL_NAMES.has(PREFLIGHT), true);
});

test("WK-2359: buildNextCall refuses an unregistered tool at construction time", () => {
  assert.throws(
    () => buildNextCall({ tool: "not_a_registered_route" }),
    /must name a canonical MCP route/
  );
});

test("pickDoThisNext returns the FIRST recommended entry by array order", () => {
  const first = buildNextCall({ tool: GET_RECORD, recommended: true });
  const second = buildNextCall({ tool: VALIDATE, recommended: true });
  const list = [buildNextCall({ tool: SEARCH }), first, second];
  assert.equal(pickDoThisNext(list), first);
});

test("pickDoThisNext returns null when nothing is recommended", () => {
  assert.equal(
    pickDoThisNext([buildNextCall({ tool: GET_RECORD }), buildNextCall({ tool: SEARCH })]),
    null
  );
  assert.equal(pickDoThisNext([]), null);
  assert.equal(pickDoThisNext(null), null);
});

function sampleList() {
  return [
    buildNextCall({ tool: GET_RECORD, arguments: { id: "WK-1510" }, recommended: true }),
    buildNextCall({ tool: VALIDATE, arguments: { id: "WK-1510" }, recommended: true }),
    buildNextCall({ tool: SEARCH }),
    buildNextCall({
      tool: DISPATCH,
      disallowed: true,
      reason: "not ready",
      use_instead: VALIDATE
    })
  ];
}

test("projectNextActionScalar is the do-this-next remedy string", () => {
  assert.equal(projectNextActionScalar(sampleList()), `${GET_RECORD}({id:"WK-1510"})`);
  assert.equal(projectNextActionScalar([buildNextCall({ tool: GET_RECORD })]), null);
});

test("projectNextActionScalar does not mutate the canonical list or its entries", () => {
  const list = sampleList();
  const snapshot = JSON.parse(JSON.stringify(list));

  projectNextActionScalar(list);

  assert.deepEqual(list, snapshot);
});

test("projectNextActionScalar tolerates a non-array input", () => {
  assert.equal(projectNextActionScalar(null), null);
});

const OBSERVED = Object.freeze({
  "wk.acceptance.criteria": "absent",
  "dispatch.role_capability": false,
  "route.selected_unit": null
});

test("an unresolved argument value is recognised in every shape a producer leaves it", () => {
  for (const unresolved of [
    "<exact-slice-subject-from-refusal>",
    "$known_WK_unit",
    "TODO: fill in the subject",
    "   ",
    null,
    undefined,
    ["WK-2386", "$subject_path"],
    { nested: { deep: "<placeholder>" } }
  ]) {
    assert.equal(isUnresolvedArgumentValue(unresolved), true, JSON.stringify(unresolved) ?? "undefined");
  }

  for (const resolved of ["WK-2386#SLICE-003", 0, false, [], {}, { role: "reviewer" }]) {
    assert.equal(isUnresolvedArgumentValue(resolved), false, JSON.stringify(resolved));
  }
});

test("unresolvedArgumentNames reports every incomplete argument, sorted", () => {
  assert.deepEqual(
    unresolvedArgumentNames({ unit: "WK-1", subject: "<fill me>", role: "$role", write_scope: [] }),
    ["role", "subject"]
  );
});

test("an incomplete argument is refused at construction and at validation", () => {
  assert.throws(
    () => buildNextCall({ tool: DISPATCH, arguments: { subject: "<exact-slice-subject-from-refusal>" } }),
    /must be complete; subject is unresolved/
  );
  const result = validateNextCalls([{ tool: DISPATCH, arguments: { subject: "$subject", role: "reviewer" } }]);
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /leaves subject unresolved/);
});

test("the success-predicate grammar is closed", () => {
  assert.deepEqual(SUCCESS_PREDICATE_OPERATORS, [
    "equals",
    "not_equals",
    "is_true",
    "is_false",
    "is_present",
    "is_absent"
  ]);
  assert.equal(
    isMachineCheckableSuccessPredicate({ fact: "wk.acceptance.criteria", operator: "equals", value: "present" }),
    true
  );
  assert.equal(isMachineCheckableSuccessPredicate({ fact: "dispatch.role_capability", operator: "is_true" }), true);
  for (const malformed of [
    null,
    "the criteria are present",
    { fact: "wk.acceptance.criteria", operator: "matches", value: "x" },
    { fact: "WK.Acceptance", operator: "is_true" },

    { fact: "wk.acceptance.criteria", operator: "equals" },
    { fact: "wk.acceptance.criteria", operator: "is_true", value: true },
    { fact: "wk.acceptance.criteria", operator: "equals", value: "<fill me>" },
    { fact: "wk.acceptance.criteria", operator: "equals", value: "x", extra: 1 }
  ]) {
    assert.equal(isMachineCheckableSuccessPredicate(malformed), false, JSON.stringify(malformed));
  }
});

test("a predicate evaluates to true, false, or unobserved -- never a guess", () => {
  const evaluate = (predicate) => evaluateSuccessPredicate(predicate, OBSERVED);
  assert.equal(evaluate({ fact: "wk.acceptance.criteria", operator: "equals", value: "absent" }), true);
  assert.equal(evaluate({ fact: "wk.acceptance.criteria", operator: "equals", value: "present" }), false);
  assert.equal(evaluate({ fact: "dispatch.role_capability", operator: "is_true" }), false);
  assert.equal(evaluate({ fact: "dispatch.role_capability", operator: "is_false" }), true);
  assert.equal(evaluate({ fact: "route.selected_unit", operator: "is_absent" }), true);
  assert.equal(evaluate({ fact: "route.selected_unit", operator: "is_present" }), false);

  assert.equal(evaluate({ fact: "nobody.looked", operator: "is_true" }), "unobserved");
  assert.equal(evaluateSuccessPredicate({ fact: "a.b", operator: "is_true" }, null), "unobserved");
  assert.throws(() => evaluateSuccessPredicate({ fact: "a.b" }, OBSERVED), TypeError);
});

test("a continuation whose success predicate is already satisfied is refused", () => {

  const result = validateContinuationCalls(
    [{
      tool: VALIDATE,
      arguments: { id: "WK-2386" },
      recommended: true,
      success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "absent" }
    }],
    { observedFacts: OBSERVED, requestSchemas: REQUEST_SCHEMAS }
  );
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /already satisfied by the observed fact wk\.acceptance\.criteria/);
  assert.match(result.errors[0], /cannot converge/);
});

test("a continuation naming an unobserved fact cannot claim convergence", () => {
  const result = validateContinuationCalls(
    [{
      tool: VALIDATE,
      arguments: { id: "WK-2386" },
      success_predicate: { fact: "nobody.looked", operator: "is_true" }
    }],
    { observedFacts: OBSERVED, requestSchemas: REQUEST_SCHEMAS }
  );
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /does not carry as an observed fact/);
});

test("a currently-false predicate over an observed fact converges", () => {
  const result = validateContinuationCalls(
    [{
      tool: VALIDATE,
      arguments: { id: "WK-2386" },
      recommended: true,
      success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
    }],
    { observedFacts: OBSERVED, requestSchemas: REQUEST_SCHEMAS }
  );
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("the continuation contract cannot be satisfied by withholding the observed facts", () => {
  const list = [{
    tool: VALIDATE,
    arguments: { id: "WK-2386" },
    success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
  }];
  const result = validateContinuationCalls(list, { requestSchemas: REQUEST_SCHEMAS });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /requires the authenticated facts the refusal observed/.test(error)));
});

test("a continuation with no success predicate is refused under the contract", () => {
  const result = validateContinuationCalls(
    [{ tool: VALIDATE, arguments: { id: "WK-2386" }, recommended: true }],
    { observedFacts: OBSERVED, requestSchemas: REQUEST_SCHEMAS }
  );
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /declares no success_predicate/);
});

test("a disallowed entry is a permission fact, not a continuation", () => {

  const result = validateContinuationCalls(
    [
      {
        tool: VALIDATE,
        arguments: { id: "WK-2386" },
        recommended: true,
        success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
      },
      { tool: SEARCH, disallowed: true, reason: "wrong surface" }
    ],
    { observedFacts: OBSERVED, requestSchemas: REQUEST_SCHEMAS }
  );
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("a disallowed-only list states no executable next step", () => {

  for (const list of [
    [{ tool: SEARCH, disallowed: true, reason: "wrong surface" }],
    [
      { tool: SEARCH, disallowed: true, reason: "wrong surface" },
      { tool: GET_RECORD, disallowed: true, use_instead: VALIDATE }
    ],
    []
  ]) {
    const result = validateContinuationCalls(list, {
      observedFacts: OBSERVED,
      requestSchemas: REQUEST_SCHEMAS
    });
    assert.equal(result.valid, false, JSON.stringify(list));
    assert.ok(
      result.errors.some((error) => /at least one non-disallowed callable entry/.test(error)),
      result.errors.join("; ")
    );
  }
});

test("the actionable contract fails closed without authoritative request schemas", () => {
  const list = [{
    tool: VALIDATE,
    arguments: { id: "WK-2386" },
    recommended: true,
    success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
  }];

  const unsupplied = validateContinuationCalls(list, { observedFacts: OBSERVED });
  assert.equal(unsupplied.valid, false);
  assert.ok(
    unsupplied.errors.some((error) => /requires each named tool's authoritative request schema/.test(error))
  );

  const wrongTool = validateContinuationCalls(list, {
    observedFacts: OBSERVED,
    requestSchemas: { [PREFLIGHT]: PREFLIGHT_SCHEMA }
  });
  assert.equal(wrongTool.valid, false);
  assert.ok(
    wrongTool.errors.some((error) => /no authoritative request schema is available for/.test(error))
  );

  for (const notASchema of [true, "see the docs", { type: "object" }, { type: "string" }, { type: "object", properties: {}, required: [1] }]) {
    assert.equal(isAuthoritativeRequestSchema(notASchema), false, JSON.stringify(notASchema));
    const result = validateContinuationCalls(list, {
      observedFacts: OBSERVED,
      requestSchemas: { [VALIDATE]: notASchema }
    });
    assert.equal(result.valid, false, JSON.stringify(notASchema));
    assert.ok(result.errors.some((error) => /an unvalidatable call is not a validated call/.test(error)));
  }
});

test("actionable arguments are checked against the supplied request contract", () => {
  const continuation = (callArguments) => [{
    tool: VALIDATE,
    arguments: callArguments,
    recommended: true,
    success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
  }];
  const check = (callArguments) =>
    validateContinuationCalls(continuation(callArguments), {
      observedFacts: OBSERVED,
      requestSchemas: REQUEST_SCHEMAS
    });

  const invented = check({ unit: "WK-2386" });
  assert.equal(invented.valid, false);
  assert.ok(invented.errors.some((error) => /omits id, which the request schema for/.test(error)));
  assert.ok(invented.errors.some((error) => /declares unit, which the request schema for/.test(error)));

  const wrongShape = check({ id: ["WK-2386"] });
  assert.equal(wrongShape.valid, false);
  assert.ok(wrongShape.errors.some((error) => /must be string/.test(error)));

  const outsideEnum = validateContinuationCalls(
    [{
      tool: PREFLIGHT,
      arguments: { role: "coordinator", target_dispatch_role: "supervisor" },
      recommended: true,
      success_predicate: { fact: "dispatch.role_capability", operator: "is_true" }
    }],
    { observedFacts: OBSERVED, requestSchemas: REQUEST_SCHEMAS }
  );
  assert.equal(outsideEnum.valid, false);
  assert.ok(outsideEnum.errors.some((error) => /allowed values/.test(error)), outsideEnum.errors.join("; "));

  assert.deepEqual(check({ id: "WK-2386" }), { valid: true, errors: [] });
  assert.deepEqual(check({ repo: "agent-chassis/agent-chassis", id: "WK-2386" }), {
    valid: true,
    errors: []
  });
});

test("requestContractErrors reports one defect per producer mistake", () => {
  assert.deepEqual(requestContractErrors(VALIDATE, { id: "WK-2386" }, VALIDATE_SCHEMA), []);
  assert.deepEqual(
    requestContractErrors(VALIDATE, {}, VALIDATE_SCHEMA),
    ["omits id, which the request schema for workspace_work_record_validate requires"]
  );
  assert.equal(requestContractErrors(VALIDATE, { id: "x" }, null).length, 1);

  assert.equal(requestContractErrors(VALIDATE, undefined, VALIDATE_SCHEMA).length, 1);
});

test("the schema contract binds the actionable limb only, not a router permission set", () => {

  const permissionSet = [
    { tool: GET_RECORD },
    { tool: SEARCH, disallowed: true, reason: "wrong surface" }
  ];
  assert.deepEqual(validateNextCalls(permissionSet), { valid: true, errors: [] });
  assert.deepEqual(
    validateNextCalls([{ tool: VALIDATE, arguments: { unit: "WK-2386" }, recommended: true }]),
    { valid: true, errors: [] }
  );
});

test("buildContinuationCall demands the full contract", () => {
  const entry = buildContinuationCall({
    tool: PREFLIGHT,
    arguments: { role: "coordinator", target_dispatch_role: "redteam" },
    recommended: true,
    success_predicate: { fact: "dispatch.role_capability", operator: "is_true" }
  }, { requestSchema: PREFLIGHT_SCHEMA });
  assert.equal(entry.tool, PREFLIGHT);
  assert.deepEqual(entry.arguments, { role: "coordinator", target_dispatch_role: "redteam" });
  assert.equal(entry.recommended, true);

  assert.throws(() => buildContinuationCall({ tool: PREFLIGHT }), /requires a machine-checkable/);
  assert.throws(
    () => buildContinuationCall({ tool: PREFLIGHT, success_predicate: { fact: "a.b", operator: "matches" } }),
    /must name one fact, a closed operator/
  );
  assert.throws(
    () => buildContinuationCall({
      tool: PREFLIGHT,
      disallowed: true,
      success_predicate: { fact: "a.b", operator: "is_true" }
    }),
    /not a continuation/
  );
  assert.throws(() => buildContinuationCall({ tool: "restore_wk_lifecycle" }), /canonical MCP route/);
});

test("buildContinuationCall cannot construct a call it has no authority to check", () => {
  const spec = {
    tool: VALIDATE,
    arguments: { id: "WK-2386" },
    recommended: true,
    success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "present" }
  };
  assert.throws(
    () => buildContinuationCall(spec),
    /no authoritative request schema is available for "workspace_work_record_validate"/
  );
  assert.throws(
    () => buildContinuationCall({ ...spec, arguments: { unit: "WK-2386" } }, { requestSchema: VALIDATE_SCHEMA }),
    /must satisfy the request contract of workspace_work_record_validate/
  );
  assert.deepEqual(
    buildContinuationCall(spec, { requestSchema: VALIDATE_SCHEMA }).arguments,
    { id: "WK-2386" }
  );
});
