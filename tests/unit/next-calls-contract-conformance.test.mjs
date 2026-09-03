

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  runWorkRecordSummaryWithCompactGate,
  runWorkRecordReadWithCompactGate
} from "../../packages/wiki-mcp/src/lib/work-record-compact-read-gate.mjs";
import {
  buildBlockedDispatchResult,
  buildBlockedRunStatusResult,
  buildBlockedRunWaitResult
} from "../../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import { recommendToolRouteFromVocabulary } from "../../packages/wiki-core/src/operations/tool-router.mjs";
import {
  buildNextCall,
  buildContinuationCall,
  validateNextCalls,
  validateContinuationCalls,
  pickDoThisNext,
  projectNextActionScalar
} from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";
import {
  buildPublicMechanicalRefusal,
  validatePublicMechanicalRefusal
} from "../../packages/wiki-core/src/lib/refusal-payload.mjs";
import { registerWorkRecordReadTools } from "../../packages/wiki-mcp/src/lib/work-record-read-tools.mjs";
import { registerDiagnosticRoutes } from "../../packages/wiki-mcp/src/lib/dispatch-diagnostic-routes.mjs";
import { registerDispatchTools } from "../../packages/wiki-mcp/src/lib/dispatch-tools/register.mjs";
import { loadToolDiscoveryDescriptor } from "../../packages/wiki-core/src/lib/tool-discovery.mjs";
import {
  RUNTIME_BLOCKER_DESCRIPTOR,
  isRuntimeBlockerCode
} from "../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const toolDescriptor = await loadToolDiscoveryDescriptor();
const KNOWN_TOOLS = new Set(toolDescriptor.tools.map((entry) => entry.tool_name));

const vocabulary = JSON.parse(
  await readFile(new URL("../../packages/wiki-core/data/tool-routing-intents.v1.json", import.meta.url), "utf8")
);

const WORKSPACE_REPO = "agent-chassis/agent-chassis";
const WORKSPACE_DIR = "/repo";
const RECORD_ID = "WK-9000";

function captureRegisteredRequestSchemas() {
  const captured = new Map();
  const ctx = {
    registerTool: (name, definition) => captured.set(name, definition),
    registeredToolNames: new Set(),
    workspaceRepos: [{ repo: WORKSPACE_REPO, dir: WORKSPACE_DIR }],
    z,
    jsonContent: () => {},
    errorContent: () => {},
    resolveWorkspaceRepo: () => ({ repo: WORKSPACE_REPO, dir: WORKSPACE_DIR }),
    createCompactValidateDispatchResponse: () => {},
    graphImpactPersistenceAvailable: false,
    dispatchReviewerAvailable: false,
    dispatchBackend: null,
    dispatchSessionIdentity: null,
    isPaidTier: false
  };
  registerWorkRecordReadTools(ctx);
  registerDiagnosticRoutes(ctx);
  registerDispatchTools(ctx);

  const schemas = {};
  for (const [name, definition] of captured) {
    const declared = definition?.inputSchema;
    if (declared === undefined || declared === null) continue;

    const objectSchema = declared instanceof z.ZodType ? declared : z.object(declared);
    schemas[name] = zodToJsonSchema(objectSchema);
  }
  return Object.freeze(schemas);
}

const REQUEST_SCHEMAS = captureRegisteredRequestSchemas();
const VALIDATE_ROUTE = "workspace_work_record_validate";
const PREFLIGHT_ROUTE = "workspace_coordination_preflight";
const DISPATCH_ROUTE = "workspace_agent_dispatch";

function trackerSummaryFixture() {
  return {
    valid: true,
    record_id: RECORD_ID,
    source_digest: "sha256:compact",
    summary: {
      id: RECORD_ID,
      work_kind: "tracker",
      slice_count: 10,
      slice_detail_omissions: { count: 7, detail_available_via: ["selected_slice"] },
      slices: [
        { id: "SLICE-001", status: "todo", agent_notes_bytes: 312 },
        { id: "SLICE-002", status: "active", agent_notes_bytes: 428 }
      ]
    }
  };
}

function trackerReadFixture() {
  return {
    format: "json-work-record",
    valid: true,
    record_id: RECORD_ID,
    source_digest: "sha256:compact",
    work_kind: "tracker",
    slice_counts: { total: 10 },
    slice_detail_omissions: { suppressed_total: 8, current_slices_omitted_count: 8 },
    working_slices: [
      { id: "SLICE-001", status: "todo", agent_notes_bytes: 111 },
      { id: "SLICE-002", status: "active", agent_notes_bytes: 222 }
    ]
  };
}

function runSummaryGate(args) {
  return runWorkRecordSummaryWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    args,
    getWorkRecordSummary: async () => trackerSummaryFixture(),
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a" })
  });
}

function runReadGate(toolFamily, args) {
  return runWorkRecordReadWithCompactGate({
    workspaceRepo: WORKSPACE_REPO,
    workspaceDir: WORKSPACE_DIR,
    toolFamily,
    args,
    readCompact: async () => trackerReadFixture(),
    readExpensive: async () => {
      throw new Error("refusal path must not call the expensive reader");
    },
    readWorkRecordById: async () => ({ source_digest: "sha256:source-a" })
  });
}

const routeMatched = () => recommendToolRouteFromVocabulary(
  { task_description: "Is WK-1438#SLICE-012 dispatchable for a worker?" },
  vocabulary
);
const routeAmbiguous = () => recommendToolRouteFromVocabulary(
  { task_description: "Read WK-1438 and find docs for tool discovery" },
  vocabulary
);

function dispatchRemedyList() {
  return [
    buildNextCall({ tool: "workspace_validate_dispatch", arguments: { unit: "WK-0001" }, recommended: true }),
    buildNextCall({ tool: "workspace_agent_dispatch" })
  ];
}
const DISPATCH_BUILDERS = [buildBlockedDispatchResult, buildBlockedRunStatusResult, buildBlockedRunWaitResult];

function assertEntryConformance(list, label) {
  assert.ok(Array.isArray(list) && list.length > 0, `${label}: carries a non-empty next_calls list`);
  const validation = validateNextCalls(list, { knownTools: KNOWN_TOOLS });
  assert.equal(
    validation.valid,
    true,
    `${label}: entries conform + tools registered -- ${validation.errors.join("; ")}`
  );

  for (const entry of list.filter((candidate) => candidate.recommended === true)) {
    assert.ok(list.includes(entry), `${label}: recommended entry is a member of the one list`);
    assert.notEqual(entry.disallowed, true, `${label}: a recommended entry is never disallowed`);

    assert.equal(Object.prototype.hasOwnProperty.call(entry, "code"), false, `${label}: entries carry no code field`);
  }
}

test("(a) every list-bearing surface response conforms to the descriptor shape with registered tools", async () => {
  const summary = await runSummaryGate({ id: RECORD_ID });
  assertEntryConformance(summary.compact_read.next_calls, "summary continuation");

  const summaryRefusal = await runSummaryGate({ id: RECORD_ID, verbose: true });
  assert.equal(summaryRefusal.accepted, false);
  assertEntryConformance(summaryRefusal.next_calls, "summary refusal");

  const readRefusal = await runReadGate("workspace_get_record", { id: RECORD_ID, include_record: true });
  assert.equal(readRefusal.accepted, false);
  assertEntryConformance(readRefusal.next_calls, "read refusal");

  assertEntryConformance(routeMatched().next_calls, "router matched");
  assertEntryConformance(routeAmbiguous().next_calls, "router ambiguous");
});

test("(a) refusal-envelope reason_codes are registered separately (not via validateNextCalls)", async () => {
  const summaryRefusal = await runSummaryGate({ id: RECORD_ID, verbose: true });
  assert.equal(isRuntimeBlockerCode(summaryRefusal.reason_code), true);

  const readRefusal = await runReadGate("workspace_get_record", { id: RECORD_ID, include_record: true });
  assert.equal(isRuntimeBlockerCode(readRefusal.reason_code), true);

  const dispatchRefusal = buildBlockedDispatchResult({
    blockerCode: "role_policy_violation",
    reason: "blocked_for_test",
    nextCalls: dispatchRemedyList()
  });
  assert.equal(isRuntimeBlockerCode(dispatchRefusal.blocker.code), true);
});

test("(b) guidance-required surfaces carry a recommended entry; terminal/content-less carry none", async () => {

  const summaryRefusal = await runSummaryGate({ id: RECORD_ID, verbose: true });
  assert.notEqual(pickDoThisNext(summaryRefusal.next_calls), null, "summary refusal recommends a remedy");

  const readRefusal = await runReadGate("workspace_get_record", { id: RECORD_ID, include_record: true });
  assert.notEqual(pickDoThisNext(readRefusal.next_calls), null, "read refusal recommends a remedy");

  for (const build of DISPATCH_BUILDERS) {
    const remedy = build({ blockerCode: "role_policy_violation", reason: "x", nextCalls: dispatchRemedyList() });
    assert.ok(remedy.next_action, "a remedy-forwarding dispatch refusal carries a non-null next_action");
  }

  for (const build of DISPATCH_BUILDERS) {
    const contentless = build({ blockerCode: "role_policy_violation", reason: "x" });
    assert.equal(contentless.accepted, false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(contentless, "next_action"),
      false,
      "a content-less dispatch refusal is not forced to recommend"
    );
  }

  const ambiguous = routeAmbiguous();
  assert.equal(ambiguous.result_state, "ambiguous");
  assert.equal(pickDoThisNext(ambiguous.next_calls), null, "an ambiguous route recommends nothing");
});

test("(c) dispatch scalar next_action is a pure projection of the supplied list", () => {
  const list = dispatchRemedyList();
  const expected = projectNextActionScalar(list);
  assert.equal(expected, 'workspace_validate_dispatch({unit:"WK-0001"})');
  for (const build of DISPATCH_BUILDERS) {
    const result = build({ blockerCode: "role_policy_violation", reason: "x", nextCalls: list });
    assert.equal(result.next_action, expected);
  }
});

const CONVERGENCE_FACTS = Object.freeze({
  "wk.acceptance.criteria": "absent",
  "dispatch.role_capability": false
});

const CONVERGENT = Object.freeze({
  fact: "wk.acceptance.criteria",
  operator: "equals",
  value: "present"
});

function refusalWith(nextCalls, recoveryOverrides = {}, overrides = {}) {
  return {
    code: "work_record_readiness_failure",
    deciding_facts: [{ field: "wk.acceptance.criteria", value: "absent" }],
    next_calls: nextCalls,
    recovery: {
      state: "callable",
      prerequisite: "the authored contract declares no acceptance criteria",
      operation: "workspace_work_record_validate",
      success_condition: "workspace_work_record_validate reports zero readiness defects",
      success_predicate: CONVERGENT,
      selected_from: ["wk.acceptance.criteria"],
      ...recoveryOverrides
    },
    observed_facts: CONVERGENCE_FACTS,
    request_schemas: REQUEST_SCHEMAS,
    ...overrides
  };
}

const CONVERGENCE_MATRIX = [
  {
    name: "converges: a currently-false predicate over an observed deciding fact",
    nextCalls: [{
      tool: "workspace_work_record_validate",
      arguments: { id: "WK-9000" },
      recommended: true,
      prerequisite_predicate: CONVERGENT,
      success_predicate: CONVERGENT
    }],
    expect: null
  },
  {
    name: "loops: the published outcome is already true (AUDIT-REFUSAL-009)",
    nextCalls: [{
      tool: "workspace_work_record_validate",
      arguments: { id: "WK-9000" },
      recommended: true,
      success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "absent" }
    }],
    expect: /already satisfied by the observed fact/
  },
  {
    name: "unverifiable: the outcome names a fact the refusal never observed",
    nextCalls: [{
      tool: "workspace_work_record_validate",
      arguments: { id: "WK-9000" },
      recommended: true,
      success_predicate: { fact: "some.unobserved.fact", operator: "is_true" }
    }],
    expect: /does not carry as an observed fact/
  },
  {
    name: "uncallable: the argument was never resolved",
    nextCalls: [{
      tool: "workspace_work_record_validate",
      arguments: { id: "$known_WK_unit" },
      recommended: true,
      success_predicate: CONVERGENT
    }],
    expect: /leaves id unresolved/
  },
  {
    name: "uncallable: a private launcher action token is not a route",
    nextCalls: [{
      tool: "retry_workspace_agent_dispatch_after_lifecycle_preflight_succeeds",
      recommended: true,
      success_predicate: CONVERGENT
    }],
    expect: /canonical tool-discovery corpus/
  },
  {
    name: "silent: the continuation states no checkable outcome at all",
    nextCalls: [{
      tool: "workspace_work_record_validate",
      arguments: { id: "WK-9000" },
      recommended: true
    }],
    expect: /declares no success_predicate/
  }
];

for (const cell of CONVERGENCE_MATRIX) {
  test(`(d) convergence matrix -- ${cell.name}`, () => {
    if (cell.expect === null) {
      const envelope = buildPublicMechanicalRefusal(refusalWith(cell.nextCalls));
      assert.equal(envelope.next_calls.length, 1);
      assert.notEqual(pickDoThisNext(envelope.next_calls), null);
      return;
    }
    assert.throws(() => buildPublicMechanicalRefusal(refusalWith(cell.nextCalls)), cell.expect);
  });
}

test("(d) the no_supported_route limb needs no continuation and admits none", () => {
  const envelope = buildPublicMechanicalRefusal({
    code: "operator_recovery_needed",
    deciding_facts: [{ field: "operator.action_required", value: true }],
    no_supported_route: true,
    recovery: { state: "no_supported_route" },
    profile: "actionable",
    observed_facts: { "operator.action_required": true }
  });
  assert.equal(envelope.no_supported_route, true);
  assert.equal(Object.hasOwn(envelope, "next_calls"), false);
});

test("(d) every registered structured recovery projects into a callable continuation", () => {

  const templates = RUNTIME_BLOCKER_DESCRIPTOR.codes.filter(
    (entry) => entry.recovery && typeof entry.recovery === "object" && entry.recovery.route
  );
  assert.ok(templates.length > 0);

  for (const entry of templates) {
    const schema = REQUEST_SCHEMAS[entry.recovery.route];
    assert.ok(schema, `${entry.code}: recovery route ${entry.recovery.route} publishes no request schema`);
    const bindings = entry.recovery.argument_bindings ?? {};

    const observedFacts = { "recovery.completed": false };
    const callArguments = { ...(entry.recovery.arguments ?? {}) };
    for (const [argument, fact] of Object.entries(bindings)) {
      const declared = schema.properties?.[argument];
      const resolved = Array.isArray(declared?.enum) ? declared.enum[0] : "resolved";
      observedFacts[fact] = resolved;
      callArguments[argument] = resolved;
    }
    const call = buildContinuationCall({
      tool: entry.recovery.route,
      arguments: callArguments,
      recommended: true,
      success_predicate: { fact: "recovery.completed", operator: "is_true" }
    }, { requestSchema: schema });
    const result = validateContinuationCalls([call], {
      observedFacts,
      requestSchemas: REQUEST_SCHEMAS
    });
    assert.deepEqual(result, { valid: true, errors: [] }, `${entry.code}: ${result.errors.join("; ")}`);
    assert.equal(isRuntimeBlockerCode(entry.code), true);
  }
});

test("(d) the merely-allowed router surfaces are unaffected by the continuation contract", () => {

  const ambiguous = routeAmbiguous();
  assert.equal(validateNextCalls(ambiguous.next_calls, { knownTools: KNOWN_TOOLS }).valid, true);
  const strict = validateContinuationCalls(ambiguous.next_calls, {
    observedFacts: CONVERGENCE_FACTS,
    requestSchemas: REQUEST_SCHEMAS
  });
  assert.equal(strict.valid, false, "the strict contract is not what a permission set claims");
});

test("(d) the pre-remediation dispatch refusal shape no longer validates anywhere", () => {

  const list = [buildNextCall({
    tool: "workspace_validate_dispatch",
    arguments: { unit: "WK-9000" },
    recommended: true
  })];
  assert.equal(projectNextActionScalar(list), 'workspace_validate_dispatch({unit:"WK-9000"})');
  const result = validatePublicMechanicalRefusal({
    code: "work_record_readiness_failure",
    deciding_facts: [{ field: "wk.acceptance.criteria", value: "absent" }],
    next_calls: list,
    recovery: {
      state: "callable",
      prerequisite: "the authored contract declares no acceptance criteria",
      operation: "workspace_validate_dispatch",
      success_condition: "workspace_validate_dispatch reports the unit dispatchable"
    }
  }, { observedFacts: CONVERGENCE_FACTS, requestSchemas: REQUEST_SCHEMAS });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /declares no success_predicate/.test(error)));

  assert.equal(pickDoThisNext(list)?.tool, "workspace_validate_dispatch");
});

test("(e) the published continuation satisfies the request contract its route declares", () => {

  const validateSchema = REQUEST_SCHEMAS[VALIDATE_ROUTE];
  assert.ok(validateSchema, "the validate route publishes a request schema");
  assert.deepEqual(validateSchema.required, ["id"]);

  const envelope = buildPublicMechanicalRefusal(refusalWith([{
    tool: VALIDATE_ROUTE,
    arguments: { id: RECORD_ID },
    recommended: true,
    prerequisite_predicate: CONVERGENT,
    success_predicate: CONVERGENT
  }]));
  assert.equal(envelope.next_calls[0].arguments.id, RECORD_ID);

  assert.throws(
    () => buildPublicMechanicalRefusal(refusalWith([{
      tool: VALIDATE_ROUTE,
      arguments: { unit: RECORD_ID },
      recommended: true,
      success_predicate: CONVERGENT
    }])),
    /declares unit, which the request schema for workspace_work_record_validate does not accept/
  );

  const dispatchSchema = REQUEST_SCHEMAS[DISPATCH_ROUTE];
  assert.ok(Array.isArray(dispatchSchema.properties.role.enum));
  assert.throws(
    () => buildPublicMechanicalRefusal(refusalWith([{
      tool: DISPATCH_ROUTE,
      arguments: { role: "coordinator", subject: "WK-9000#SLICE-001" },
      recommended: true,
      success_predicate: CONVERGENT
    }], { operation: DISPATCH_ROUTE })),
    /allowed values/
  );

  assert.throws(
    () => buildPublicMechanicalRefusal(refusalWith([{
      tool: VALIDATE_ROUTE,
      arguments: { id: RECORD_ID },
      recommended: true,
      success_predicate: CONVERGENT
    }], {}, { request_schemas: null })),
    /requires each named tool's authoritative request schema/
  );
});

test("(e) one contract runs on every path, and the carrier revalidates deterministically", () => {
  const envelope = buildPublicMechanicalRefusal(refusalWith([{
    tool: VALIDATE_ROUTE,
    arguments: { id: RECORD_ID },
    recommended: true,
    prerequisite_predicate: CONVERGENT,
    success_predicate: CONVERGENT
  }]));

  assert.equal(Object.hasOwn(envelope, "validation_profile"), false);

  assert.deepEqual(
    validatePublicMechanicalRefusal(envelope, { requestSchemas: REQUEST_SCHEMAS }),
    { valid: true, errors: [] }
  );
});

test("(e) an actionable limb offers a call the agent is allowed to make", () => {
  const forbidden = { tool: VALIDATE_ROUTE, disallowed: true, reason: "already run for this candidate" };
  assert.throws(
    () => buildPublicMechanicalRefusal(refusalWith([forbidden])),
    /at least one non-disallowed callable entry/
  );

  const mismatched = validatePublicMechanicalRefusal({
    ...refusalWith([
      {
        tool: DISPATCH_ROUTE,
        arguments: { role: "worker", subject: "WK-9000#SLICE-001" },
        recommended: true,
        success_predicate: CONVERGENT
      },
      forbidden
    ])
  }, { observedFacts: CONVERGENCE_FACTS, requestSchemas: REQUEST_SCHEMAS });
  assert.equal(mismatched.valid, false);
  assert.ok(
    mismatched.errors.some((error) => /no offered, non-disallowed next call invokes/.test(error)),
    mismatched.errors.join("; ")
  );
});
