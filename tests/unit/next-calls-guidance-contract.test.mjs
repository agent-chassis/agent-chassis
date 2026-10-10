

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContinuationCall,
  buildGuidanceCall,
  buildNextCall,
  projectNextActionScalar,
  validateContinuationCalls,
  validateGuidanceCalls,
  validateNextCalls
} from "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs";
import {
  buildPublicMechanicalRefusal,
  validatePublicMechanicalRefusal
} from "../../packages/wiki-core/src/lib/refusal-payload.mjs";
import {
  canonicalToolSideEffects,
  isCanonicalReadOnlyTool
} from "../../packages/wiki-core/src/lib/next-calls-canonical-tools.mjs";

const READ = "workspace_read_wiki";
const SAVE = "save_record";
const START = "start_agent";
const CODE = "agent_launch.launch_failed_before_start.v1";

const READ_SCHEMA = Object.freeze({
  type: "object",
  properties: { subject: { type: "string" } },
  required: ["subject"],
  additionalProperties: false
});
const START_SCHEMA = Object.freeze({
  type: "object",
  properties: { role: { type: "string" }, subject: { type: "string" } },
  required: ["subject"],
  additionalProperties: false
});
const SAVE_SCHEMA = Object.freeze({
  type: "object",
  properties: { unit: { type: "string" }, revision: { type: "string" },
    changes: { type: "object", properties: { base_branch: { type: "string" } },
      required: ["base_branch"], additionalProperties: false } },
  required: ["unit", "revision", "changes"],
  additionalProperties: false
});
const SCHEMAS = new Map([[READ, READ_SCHEMA], [START, START_SCHEMA],
  [SAVE, SAVE_SCHEMA]]);
const REGISTERED = new Set([READ, START, SAVE]);

const ARGS = Object.freeze({ subject: "WK-0001" });
const SAVE_ARGS = Object.freeze({ unit: "WK-0001", revision: "fixture-revision",
  changes: Object.freeze({ base_branch: "main" }) });
const INFORMATION = "The selected authored unit, its revision and base_branch field selection.";

function guidanceEntry(overrides = {}) {
  return { kind: "guidance", tool: READ, arguments: ARGS, information: INFORMATION,
    ...overrides };
}

const FACTS = Object.freeze([
  { field: "dispatch.backend_accepted", value: false },
  { field: "work_record.base_branch", value: null }
]);
const OBSERVED = Object.freeze({
  "dispatch.backend_accepted": false,
  "work_record.base_branch": null
});

function recovery(overrides = {}) {
  return {
    state: "guidance",
    operation: READ,
    responsible_actor: "operator",
    prerequisite: "the root record selects no base_branch",
    information: INFORMATION,
    selected_from: ["work_record.base_branch"],
    blocker_unchanged: true,
    ...overrides
  };
}

function candidate(overrides = {}) {
  return {
    schema_version: "public-mechanical-refusal.v1",
    code: CODE,
    deciding_facts: FACTS,
    next_calls: [guidanceEntry()],
    recovery: recovery(),
    route: START,
    ...overrides
  };
}

function validate(value, options = {}) {
  return validatePublicMechanicalRefusal(value, {
    observedFacts: OBSERVED,
    requestSchemas: SCHEMAS,
    registeredTools: REGISTERED,
    ...options
  });
}

function assertRejected(value, pattern, options = {}) {
  const result = validate(value, options);
  assert.equal(result.valid, false, "expected rejection");
  assert.ok(result.errors.some((error) => pattern.test(error)), result.errors.join("\n"));
}

test("side effects come from the canonical discovery owner", () => {
  assert.deepEqual(canonicalToolSideEffects(READ), ["read_only"]);
  assert.equal(isCanonicalReadOnlyTool(READ), true);
  assert.equal(isCanonicalReadOnlyTool(SAVE), false);
  assert.equal(isCanonicalReadOnlyTool(START), false);
  assert.equal(canonicalToolSideEffects("not_a_tool"), null);
});

test("a complete guidance refusal validates, builds deterministically and projects no scalar", () => {
  assert.deepEqual(validate(candidate()), { valid: true, errors: [] });
  const build = () => buildPublicMechanicalRefusal({
    code: CODE,
    deciding_facts: FACTS,
    next_calls: [guidanceEntry()],
    recovery: recovery(),
    route: START,
    observed_facts: OBSERVED,
    request_schemas: SCHEMAS,
    registered_tools: REGISTERED
  });
  const first = build();
  assert.deepEqual(first, build());
  assert.equal(first.recovery.blocker_unchanged, true);
  assert.equal(first.next_calls[0].kind, "guidance");
  assert.equal(projectNextActionScalar(first.next_calls), null);
  assert.equal(projectNextActionScalar([{ ...guidanceEntry(), recommended: true }]), null);
});

test("guidance must be a canonical read: write, process and unknown tools refuse", () => {
  assertRejected(candidate({ next_calls: [guidanceEntry({ tool: SAVE, arguments: SAVE_ARGS })],
    recovery: recovery({ operation: SAVE }) }), /not exactly read_only/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ tool: START,
    arguments: { subject: "WK-0001#SLICE-001" } })], recovery: recovery({ operation: START }) }),
  /not exactly read_only/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ tool: "invented_reader" })] }),
    /canonical tool-discovery corpus/u);
  assert.throws(() => buildNextCall(guidanceEntry({ tool: SAVE, arguments: SAVE_ARGS })),
    /read_only/u);
});

test("registrar authority is required: missing, foreign or unregistered schemas refuse", () => {
  assertRejected(candidate(), /registrar-scoped request schema/u, { requestSchemas: null });
  assertRejected(candidate(), /no authoritative request schema/u,
    { requestSchemas: new Map([[START, START_SCHEMA]]) });
  assertRejected(candidate(), /does not accept/u,
    { requestSchemas: new Map([[READ, SAVE_SCHEMA]]) });
  assertRejected(candidate(), /registered tool set/u, { registeredTools: null });
  assertRejected(candidate(), /does not register/u, { registeredTools: new Set([START]) });
  assert.throws(() => buildGuidanceCall(guidanceEntry(), { requestSchema: READ_SCHEMA }),
    /registered tool set/u);
  assert.throws(() => buildGuidanceCall(guidanceEntry(), { registeredTools: REGISTERED }),
    /no authoritative request schema/u);
  assert.deepEqual(buildGuidanceCall(guidanceEntry(), {
    requestSchema: READ_SCHEMA, registeredTools: REGISTERED
  }), guidanceEntry());
});

test("arguments must be complete and schema-valid, information present and bounded", () => {
  assertRejected(candidate({ next_calls: [guidanceEntry({ arguments: { subject: "<unit>" } })] }),
    /unresolved/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ arguments: { subject: "WK-0001", depth: 3 } })] }),
    /does not accept/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ arguments: {} })] }), /omits subject/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ arguments: undefined })] }),
    /complete argument object/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ information: "" })] }), /information/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ information: "x".repeat(513) })] }),
    /information/u);
});

test("kinds are disjoint: unknown kinds, predicates and mixed limbs refuse", () => {
  assertRejected(candidate({ next_calls: [guidanceEntry({ kind: "hint" })] }), /unknown/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ success_predicate:
    { fact: "work_record.base_branch", operator: "is_present" } })] }), /states no predicate/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ prerequisite_predicate:
    { fact: "work_record.base_branch", operator: "is_present" } })] }), /states no predicate/u);
  const corrective = { tool: START, arguments: { subject: "WK-0001#SLICE-001" },
    success_predicate: { fact: "dispatch.backend_accepted", operator: "is_true" } };
  assertRejected(candidate({ next_calls: [guidanceEntry(), corrective] }), /cannot mix/u);
  assertRejected(candidate({ recovery: {
    state: "callable", prerequisite: "p", operation: READ, success_condition: "s",
    success_predicate: { fact: "dispatch.backend_accepted", operator: "is_true" }
  } }), /not a corrective continuation/u);
  assertRejected(candidate({ next_calls: undefined, no_supported_route: true }),
    /contradicts a guidance recovery/u);
  assertRejected(candidate({ no_supported_route: true }), /cannot both offer/u);
  assert.throws(() => buildNextCall(guidanceEntry({ kind: "hint" })), /unknown/u);
});

test("guidance claims no repair, outcome or authority and keeps the blocker", () => {
  assertRejected(candidate({ recovery: recovery({ success_predicate:
    { fact: "work_record.base_branch", operator: "is_present" } }) }), /no corrective outcome/u);
  assertRejected(candidate({ recovery: recovery({ success_condition: "the branch is set" }) }),
    /no corrective outcome/u);
  assertRejected(candidate({ recovery: recovery({ repaired: true }) }), /neither repairs/u);
  assertRejected(candidate({ recovery: recovery({ launch_authorized: true }) }), /grants authority/u);
  assertRejected(candidate({ recovery: recovery({ blocker_unchanged: false }) }),
    /blocker_unchanged:true/u);
  assertRejected(candidate({ recovery: recovery({ responsible_actor: "anyone" }) }),
    /responsible_actor/u);
  assertRejected(candidate({ recovery: recovery({ prerequisite: "" }) }), /still-failed/u);
  assertRejected(candidate({ recovery: recovery({ operation: "get_run_result" }) }),
    /no offered guidance entry/u);
});

test("selection facts: published, observed-consistent and never caller knowledge", () => {
  assertRejected(candidate({ recovery: recovery({ selected_from: undefined }) }), /non-empty array/u);
  assertRejected(candidate({ recovery: recovery({ selected_from: ["unknown.fact"] }) }),
    /unknown deciding fact/u);
  assertRejected(candidate({ deciding_facts: [FACTS[0], { field: "work_record.base_branch",
    redacted: true, redaction_reason: "internal_identifier" }] }), /redacted data/u);
  assertRejected(candidate({ deciding_facts: [FACTS[0], { field: "work_record.base_branch",
    omitted: true, retrieval: { kind: "complete", route: "workspace_read_wiki" } }] }),
  /unpublished value/u);
  assertRejected(candidate(), /contradicts/u,
    { observedFacts: { ...OBSERVED, "work_record.base_branch": "main" } });
  const knowledge = { field: "dispatch.start_agent_description_loaded", value: false };
  assertRejected(candidate({ deciding_facts: [...FACTS, knowledge] }), /caller knowledge/u);
  assertRejected(candidate(), /caller knowledge/u,
    { observedFacts: { ...OBSERVED, [`${READ}.result_seen`]: false } });
});

test("corrective predicate and convergence strictness is unchanged", () => {
  const predicate = { fact: "dispatch.backend_accepted", operator: "is_true" };
  const corrective = buildContinuationCall({ tool: START,
    arguments: { subject: "WK-0001#SLICE-001" }, success_predicate: predicate },
  { requestSchema: START_SCHEMA });
  const continuation = (list, facts = OBSERVED) => validateContinuationCalls(list, {
    observedFacts: facts, requestSchemas: SCHEMAS });
  assert.equal(continuation([corrective]).valid, true);
  assert.equal(continuation([corrective], { ...OBSERVED, "dispatch.backend_accepted": true }).valid,
    false, "an already-satisfied predicate still refuses");
  assert.equal(continuation([{ ...corrective, success_predicate: undefined }]).valid, false);
  const asGuidance = continuation([guidanceEntry()]);
  assert.equal(asGuidance.valid, false);
  assert.ok(asGuidance.errors.some((error) => /not a corrective continuation/u.test(error)));

  assert.equal(validateNextCalls([{ tool: READ }]).valid, true);
  assert.equal(validateGuidanceCalls([{ tool: READ }], {
    requestSchemas: SCHEMAS, registeredTools: REGISTERED }).valid, false);
  assertRejected(candidate({ next_calls: [corrective], recovery: {
    state: "callable", prerequisite: "p", operation: START,
    success_condition: "accepted", success_predicate: predicate } }), /prerequisite_predicate/u);
  assert.equal(validate({
    schema_version: "public-mechanical-refusal.v1",
    code: CODE,
    deciding_facts: [FACTS[0]],
    next_calls: [corrective],
    recovery: { state: "callable", prerequisite: "p", operation: START,
      success_condition: "accepted", success_predicate: predicate },
    route: "workspace_assess_contract"
  }).valid, true);
});
