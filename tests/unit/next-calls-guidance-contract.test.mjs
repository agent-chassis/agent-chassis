

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

const DESCRIBE = "workspace_tools_describe";
const EDITOR = "workspace_work_record_edit";
const DISPATCH = "workspace_agent_dispatch";
const CODE = "agent_launch.launch_failed_before_start.v1";

const DESCRIBE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    tool_name: { type: "string" },
    verbose: { type: "boolean" },
    input_contract: {}
  },
  additionalProperties: false
});
const DISPATCH_SCHEMA = Object.freeze({
  type: "object",
  properties: { role: { type: "string" }, subject: { type: "string" } },
  required: ["subject"],
  additionalProperties: false
});
const EDITOR_SCHEMA = Object.freeze({
  type: "object",
  properties: { unit: { type: "string" } },
  additionalProperties: false
});
const SCHEMAS = new Map([[DESCRIBE, DESCRIBE_SCHEMA], [DISPATCH, DISPATCH_SCHEMA],
  [EDITOR, EDITOR_SCHEMA]]);
const REGISTERED = new Set([DESCRIBE, DISPATCH, EDITOR]);

const ARGS = Object.freeze({
  tool_name: EDITOR,
  input_contract: { kind: "field", field: "base_branch", scope: "record" }
});
const INFORMATION = "The ordinary editor's record-level base_branch field contract.";

function guidanceEntry(overrides = {}) {
  return { kind: "guidance", tool: DESCRIBE, arguments: ARGS, information: INFORMATION,
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
    operation: DESCRIBE,
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
    route: DISPATCH,
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
  assert.deepEqual(canonicalToolSideEffects(DESCRIBE), ["read_only"]);
  assert.equal(isCanonicalReadOnlyTool(DESCRIBE), true);
  assert.equal(isCanonicalReadOnlyTool(EDITOR), false);
  assert.equal(isCanonicalReadOnlyTool(DISPATCH), false);
  assert.equal(canonicalToolSideEffects("not_a_tool"), null);
});

test("a complete guidance refusal validates, builds deterministically and projects no scalar", () => {
  assert.deepEqual(validate(candidate()), { valid: true, errors: [] });
  const build = () => buildPublicMechanicalRefusal({
    code: CODE,
    deciding_facts: FACTS,
    next_calls: [guidanceEntry()],
    recovery: recovery(),
    route: DISPATCH,
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
  assertRejected(candidate({ next_calls: [guidanceEntry({ tool: EDITOR, arguments: { unit: "WK-0001" } })],
    recovery: recovery({ operation: EDITOR }) }), /not exactly read_only/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ tool: DISPATCH,
    arguments: { subject: "WK-0001#SLICE-001" } })], recovery: recovery({ operation: DISPATCH }) }),
  /not exactly read_only/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ tool: "invented_reader" })] }),
    /canonical tool-discovery corpus/u);
  assert.throws(() => buildNextCall(guidanceEntry({ tool: EDITOR, arguments: { unit: "WK-0001" } })),
    /read_only/u);
});

test("registrar authority is required: missing, foreign or unregistered schemas refuse", () => {
  assertRejected(candidate(), /registrar-scoped request schema/u, { requestSchemas: null });
  assertRejected(candidate(), /no authoritative request schema/u,
    { requestSchemas: new Map([[DISPATCH, DISPATCH_SCHEMA]]) });
  assertRejected(candidate(), /does not accept/u,
    { requestSchemas: new Map([[DESCRIBE, EDITOR_SCHEMA]]) });
  assertRejected(candidate(), /registered tool set/u, { registeredTools: null });
  assertRejected(candidate(), /does not register/u, { registeredTools: new Set([DISPATCH]) });
  assert.throws(() => buildGuidanceCall(guidanceEntry(), { requestSchema: DESCRIBE_SCHEMA }),
    /registered tool set/u);
  assert.throws(() => buildGuidanceCall(guidanceEntry(), { registeredTools: REGISTERED }),
    /no authoritative request schema/u);
  assert.deepEqual(buildGuidanceCall(guidanceEntry(), {
    requestSchema: DESCRIBE_SCHEMA, registeredTools: REGISTERED
  }), guidanceEntry());
});

test("arguments must be complete and schema-valid, information present and bounded", () => {
  assertRejected(candidate({ next_calls: [guidanceEntry({ arguments: { tool_name: "<editor>" } })] }),
    /unresolved/u);
  assertRejected(candidate({ next_calls: [guidanceEntry({ arguments: { tool_name: EDITOR, depth: 3 } })] }),
    /does not accept/u);
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
  const corrective = { tool: DISPATCH, arguments: { subject: "WK-0001#SLICE-001" },
    success_predicate: { fact: "dispatch.backend_accepted", operator: "is_true" } };
  assertRejected(candidate({ next_calls: [guidanceEntry(), corrective] }), /cannot mix/u);
  assertRejected(candidate({ recovery: {
    state: "callable", prerequisite: "p", operation: DESCRIBE, success_condition: "s",
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
  assertRejected(candidate({ recovery: recovery({ operation: "workspace_tools_list" }) }),
    /no offered guidance entry/u);
});

test("selection facts: published, observed-consistent and never caller knowledge", () => {
  assertRejected(candidate({ recovery: recovery({ selected_from: undefined }) }), /non-empty array/u);
  assertRejected(candidate({ recovery: recovery({ selected_from: ["unknown.fact"] }) }),
    /unknown deciding fact/u);
  assertRejected(candidate({ deciding_facts: [FACTS[0], { field: "work_record.base_branch",
    redacted: true, redaction_reason: "internal_identifier" }] }), /redacted data/u);
  assertRejected(candidate({ deciding_facts: [FACTS[0], { field: "work_record.base_branch",
    omitted: true, retrieval: { kind: "complete", route: "workspace_get_record" } }] }),
  /unpublished value/u);
  assertRejected(candidate(), /contradicts/u,
    { observedFacts: { ...OBSERVED, "work_record.base_branch": "main" } });
  const knowledge = { field: "dispatch.workspace_agent_dispatch_description_loaded", value: false };
  assertRejected(candidate({ deciding_facts: [...FACTS, knowledge] }), /caller knowledge/u);
  assertRejected(candidate(), /caller knowledge/u,
    { observedFacts: { ...OBSERVED, [`${DESCRIBE}.result_seen`]: false } });
});

test("corrective predicate and convergence strictness is unchanged", () => {
  const predicate = { fact: "dispatch.backend_accepted", operator: "is_true" };
  const corrective = buildContinuationCall({ tool: DISPATCH,
    arguments: { subject: "WK-0001#SLICE-001" }, success_predicate: predicate },
  { requestSchema: DISPATCH_SCHEMA });
  const continuation = (list, facts = OBSERVED) => validateContinuationCalls(list, {
    observedFacts: facts, requestSchemas: SCHEMAS });
  assert.equal(continuation([corrective]).valid, true);
  assert.equal(continuation([corrective], { ...OBSERVED, "dispatch.backend_accepted": true }).valid,
    false, "an already-satisfied predicate still refuses");
  assert.equal(continuation([{ ...corrective, success_predicate: undefined }]).valid, false);
  const asGuidance = continuation([guidanceEntry()]);
  assert.equal(asGuidance.valid, false);
  assert.ok(asGuidance.errors.some((error) => /not a corrective continuation/u.test(error)));

  assert.equal(validateNextCalls([{ tool: DESCRIBE }]).valid, true);
  assert.equal(validateGuidanceCalls([{ tool: DESCRIBE }], {
    requestSchemas: SCHEMAS, registeredTools: REGISTERED }).valid, false);
  assert.equal(validate({
    schema_version: "public-mechanical-refusal.v1",
    code: CODE,
    deciding_facts: [FACTS[0]],
    next_calls: [corrective],
    recovery: { state: "callable", prerequisite: "p", operation: DISPATCH,
      success_condition: "accepted", success_predicate: predicate },
    route: "workspace_validate_dispatch"
  }).valid, true);
});
