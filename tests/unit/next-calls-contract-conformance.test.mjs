

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildBlockedDispatchResult, buildBlockedRunStatusResult, registryRecoveryContinuation,
  registryRecoveryInspection, REGISTRY_RECOVERY_INSPECTION_KINDS } from '../../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs';
import { buildNextCall, buildContinuationCall, buildGuidanceCall, validateNextCalls, validateContinuationCalls,
  pickDoThisNext, projectNextActionScalar, requestContractErrors } from '../../packages/wiki-core/src/lib/next-calls-descriptor.mjs';
import { buildPublicMechanicalRefusal, validatePublicMechanicalRefusal } from '../../packages/wiki-core/src/lib/refusal-payload.mjs';
import { createRegisterTool } from '../../packages/wiki-mcp/src/lib/register-tool.mjs';
import { registerAgentTaskTools } from '../../packages/wiki-mcp/src/lib/register-agent-task-tools.mjs';
import { registeredToolRequestContracts } from '../../packages/wiki-mcp/src/lib/registered-tool-request-contracts.mjs';
import { loadMcpToolTierRegistrationPolicy } from '../../packages/wiki-mcp/src/lib/server-composition-helpers.mjs';
import { loadToolDiscoveryDescriptor } from '../../packages/wiki-core/src/lib/tool-discovery.mjs';
import { RUNTIME_BLOCKER_DESCRIPTOR, isRuntimeBlockerCode } from '../../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs';
import { createInitiativeGuidanceProjector } from '../../packages/wiki-mcp/src/lib/task-read-wiki-guidance.mjs';
import { createReadWikiTask } from '../../packages/wiki-mcp/src/lib/task-read-wiki.mjs';
import { SESSION_ROLE_TOOL_ACCESS_POLICY_PATH } from '../../packages/wiki-core/src/lib/tool-discovery/gating.mjs';
import { jsonContent, errorContent } from '../../packages/wiki-mcp/src/lib/mcp-response.mjs';
import { createTestResourceScope } from '../helpers/test-resource-scope.mjs';

const descriptor = await loadToolDiscoveryDescriptor();
const KNOWN_TOOLS = new Set(descriptor.tools.map(row => row.tool_name));
const policy = JSON.parse(await readFile(SESSION_ROLE_TOOL_ACCESS_POLICY_PATH, 'utf8'));
const RECORD_ID = 'WK-9000';
const workspace = { repo: 'agent-chassis/agent-chassis', dir: '/repo' };
const SAVE_ARGUMENTS = { unit: RECORD_ID, revision: `sha256:${'a'.repeat(64)}`,
  changes: { criteria: [{ key: 'criterion', text: 'The explicitly authored criterion is preserved.' }] } };
const VALIDATE_ROUTE = 'save_record';
const DISPATCH_ROUTE = 'start_agent';
const registeredToolNames = new Set();
const server = new McpServer({ name: 'next-calls-current-registration', version: '1' });
const registerTool = createRegisterTool({ server, toolProfile: 'orchestrator', registeredTier: 'free_local',
  mcpToolTierRegistrationPolicy: await loadMcpToolTierRegistrationPolicy(), registeredToolNames,
  toolUsageAuditBoundary: { wrapHandler: name => () => { throw new Error(`conformance must not run ${name}`); } }, structuredLog() {} });
registerAgentTaskTools({ registerTool, registeredToolNames, workspaceRepos: [], resolveWorkspaceRepo: () => workspace,
  jsonContent, errorContent, sessionRole: 'orchestrator', sessionEnv: { WIKI_MCP_TOOL_PROFILE: 'orchestrator' },
  responseEnv: {}, registeredTier: 'free_local', dispatchBackend: null, dispatchSessionIdentity: null });
const requestContracts = registeredToolRequestContracts(registerTool);
const REQUEST_SCHEMAS = Object.fromEntries([...registeredToolNames].map(name => [name, requestContracts.contractFor(name).publishedRequestSchema()]));
const REGISTERED = { requestContracts };
const project = createInitiativeGuidanceProjector(requestContracts);
let stateDir;
const resources = createTestResourceScope();
test.before(async () => {
  stateDir = await resources.acquire('continuation response state', () => mkdtemp(path.join(os.tmpdir(), 'next-calls-current-')), dir => rm(dir, { recursive: true, force: true }));
});
test.after(async () => { await resources.dispose(); await server.close(); });

function reader() {
  let version = 'a';
  const env = { WIKI_MCP_RESPONSE_STATE_DIR: stateDir };
  const task = createReadWikiTask({ workspaceRepos: [], z, sessionRole: 'orchestrator', policy,
    resolveWorkspaceRepo: () => workspace, resolveWorkspaceReadRepo: () => workspace,
    jsonContent: body => jsonContent(body, { env }), errorContent: error => errorContent(error, { env }), env,
    deps: {
      readWorkRecordById: async () => ({ valid: true, source_digest: `sha256:${version.repeat(64)}`,
        record: { id: RECORD_ID, title: 'Independent current context', status: 'active', work_kind: 'tracker',
          sections: { agent_notes: 'Independent saved notes.' }, slices: [{ id: 'SLICE-001', status: 'active', title: 'Selected slice' }] } }),
      readSourceBoundAuthoringRevision: async ({ readSource }) => ({ ok: true, source: await readSource(), revision: `sha256:${version.repeat(64)}` }),
      resolveObligationCoverageQueryContext: async () => ({ identity: { role: 'orchestrator', source: { kind: 'canonical_workspace', repository: workspace.repo }, population: { kind: 'repository' } } })
    } });
  return { call: async args => (await task.handler(await task.config.inputSchema.parseAsync(args))).structuredContent,
    move: () => { version = 'b'; } };
}
async function runSummaryGate() { return reader().call({ subject: RECORD_ID }); }
async function runReadGate() {
  const fx = reader(), context = await fx.call({ subject: RECORD_ID });
  return fx.call(context.next_calls.find(row => row.arguments.select?.inventory === 'slices').arguments);
}
async function runStaleEnumeration() {
  const fx = reader(), context = await fx.call({ subject: RECORD_ID });
  const call = context.next_calls.find(row => row.arguments.select?.inventory === 'slices');
  fx.move();return fx.call(call.arguments);
}
const routeMatched = () => project({ recommendations: [{ kind: 'validate_record', id: 'WK-1438#SLICE-012' }] });
const routeAmbiguous = () => project({ recommendations: [{ kind: 'inspect', id: 'WK-1438' }, { kind: 'allocate_work_record', id: 'IN-0001' }] });
const routeIncomplete = () => project({ recommendations: [{ kind: 'dispatch_review', id: RECORD_ID }] });
const dispatchRemedyList = () => [buildNextCall({ tool: 'workspace_assess_contract', arguments: { unit: 'WK-0001' }, recommended: true }), buildNextCall({ tool: 'start_agent' })];
const DISPATCH_BUILDERS = [buildBlockedDispatchResult, buildBlockedRunStatusResult];
function assertEntryConformance(list, label) {
  assert.ok(Array.isArray(list) && list.length > 0, label);
  const validation = validateNextCalls(list, { knownTools: KNOWN_TOOLS });
  assert.equal(validation.valid, true, validation.errors.join('; '));
  for (const call of list.filter(row => row.recommended === true)) {
    assert.ok(list.includes(call));assert.notEqual(call.disallowed, true);assert.equal(Object.hasOwn(call, 'code'), false);
  }
}
async function assertCallsRegistered(list) {
  for (const call of list) {
    assert.deepEqual(requestContractErrors(call.tool, call.arguments, REQUEST_SCHEMAS[call.tool]), []);
    assert.equal(await requestContracts.contractFor(call.tool).acceptsArguments(call.arguments), true);
  }
}

test('(a) every list-bearing surface response conforms to the descriptor shape with registered tools', async () => {
  const context = await runSummaryGate();
  assert.equal(context.subject, RECORD_ID);assertEntryConformance(context.next_calls, 'context');await assertCallsRegistered(context.next_calls);
  const inventory = await runReadGate();
  assert.deepEqual(inventory.members.map(row => row.id), ['SLICE-001']);
  assert.deepEqual(inventory.next_calls, [], 'the full inventory carries a selection template, with no further exact call required');
  const stale = await runStaleEnumeration();assertEntryConformance(stale.next_calls, 'stale source');await assertCallsRegistered(stale.next_calls);
  const matched = (await routeMatched()).recommendations[0];
  assert.deepEqual(matched.next_calls.map(row => [row.tool, row.arguments]), [['workspace_assess_contract', { unit: 'WK-1438#SLICE-012' }]]);
  assertEntryConformance(matched.next_calls, 'named action');await assertCallsRegistered(matched.next_calls);
  const [inspection, allocation] = (await routeAmbiguous()).recommendations;
  assertEntryConformance(inspection.next_calls, 'caller-selected inspection');
  await assertCallsRegistered(inspection.next_calls);
  assert.equal(allocation.kind, 'allocate_work_record');
  assert.deepEqual(allocation.next_calls, [], 'an absent authored title cannot be an executable creation call');
  assert.equal(allocation.guidance.state, 'missing_inputs');
  assert.deepEqual(allocation.guidance.missing_inputs, ['title']);
  assert.deepEqual(allocation.guidance.known_arguments, { kind: 'work_item', initial: { initiative: 'IN-0001' } });
});

test('(a) refusal-envelope reason_codes are registered separately (not via validateNextCalls)', async () => {
  const stale = await runStaleEnumeration();
  assert.equal(stale.code, 'selected_response_query_invalid');
  assertEntryConformance(stale.next_calls, 'read recovery');
  const refusal = buildBlockedDispatchResult({ blockerCode: 'role_policy_violation', reason: 'blocked_for_test', nextCalls: dispatchRemedyList() });
  assert.equal(isRuntimeBlockerCode(refusal.blocker.code), true);
  for (const call of stale.next_calls) assert.equal(Object.hasOwn(call, 'code'), false);
});

test('(b) guidance-required surfaces carry a recommended entry; terminal/content-less carry none', async () => {
  assert.notEqual(pickDoThisNext((await runStaleEnumeration()).next_calls), null);
  assert.notEqual(pickDoThisNext((await runSummaryGate()).next_calls), null);
  for (const build of DISPATCH_BUILDERS) {
    assert.ok(build({ blockerCode: 'role_policy_violation', reason: 'x', nextCalls: dispatchRemedyList() }).next_action);
    assert.equal(Object.hasOwn(build({ blockerCode: 'role_policy_violation', reason: 'x' }), 'next_action'), false);
  }
  const terminal = (await project({ next_action: { kind: 'no_action', id: RECORD_ID } })).next_action;
  assert.deepEqual(terminal.next_calls, []);
  assert.equal(pickDoThisNext(terminal.next_calls), null);
  const incomplete = (await routeIncomplete()).recommendations[0];
  assert.equal(incomplete.guidance.state, 'missing_inputs');assert.deepEqual(incomplete.guidance.missing_inputs, ['role']);
  assert.equal(incomplete.next_calls.some(row => row.tool === 'start_agent'), false);
  await assertCallsRegistered(incomplete.next_calls);
});

test('(c) dispatch scalar next_action is a pure projection of the supplied list', () => {
  const list = dispatchRemedyList();
  const expected = 'workspace_assess_contract({unit:"WK-0001"})';
  assert.equal(projectNextActionScalar(list), expected);
  for (const build of DISPATCH_BUILDERS) assert.equal(build({ blockerCode: 'role_policy_violation', reason: 'x', nextCalls: list }).next_action, expected);
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
      operation: "save_record",
      success_condition: "save_record reports zero readiness defects",
      success_predicate: CONVERGENT,
      selected_from: ["wk.acceptance.criteria"],
      ...recoveryOverrides
    },
    observed_facts: CONVERGENCE_FACTS,
    request_schemas: REQUEST_SCHEMAS,
    ...overrides
  };
}

function sameCallRefusalWith(nextCalls, recoveryOverrides = {}, overrides = {}) {
  return refusalWith(nextCalls, recoveryOverrides, { route: VALIDATE_ROUTE, ...overrides });
}

const CONVERGENCE_MATRIX = [
  {
    name: "converges: a currently-false predicate over an observed deciding fact",
    nextCalls: [{
      tool: "save_record",
      arguments: SAVE_ARGUMENTS,
      recommended: true,
      prerequisite_predicate: CONVERGENT,
      success_predicate: CONVERGENT
    }],
    expect: null
  },
  {
    name: "loops: the published outcome is already true (AUDIT-REFUSAL-009)",
    nextCalls: [{
      tool: "save_record",
      arguments: SAVE_ARGUMENTS,
      recommended: true,
      success_predicate: { fact: "wk.acceptance.criteria", operator: "equals", value: "absent" }
    }],
    expect: /already satisfied by the observed fact/
  },
  {
    name: "unverifiable: the outcome names a fact the refusal never observed",
    nextCalls: [{
      tool: "save_record",
      arguments: SAVE_ARGUMENTS,
      recommended: true,
      success_predicate: { fact: "some.unobserved.fact", operator: "is_true" }
    }],
    expect: /does not carry as an observed fact/
  },
  {
    name: "uncallable: the argument was never resolved",
    nextCalls: [{
      tool: "save_record",
      arguments: { ...SAVE_ARGUMENTS, unit: "$known_WK_unit" },
      recommended: true,
      success_predicate: CONVERGENT
    }],
    expect: /leaves unit unresolved/
  },
  {
    name: "uncallable: a private launcher action token is not a route",
    nextCalls: [{
      tool: "retry_start_agent_after_lifecycle_preflight_succeeds",
      recommended: true,
      success_predicate: CONVERGENT
    }],
    expect: /canonical tool-discovery corpus/
  },
  {
    name: "silent: the continuation states no checkable outcome at all",
    nextCalls: [{
      tool: "save_record",
      arguments: SAVE_ARGUMENTS,
      recommended: true
    }],
    expect: /declares no success_predicate/
  }
];

for (const cell of CONVERGENCE_MATRIX) {
  test(`(d) convergence matrix -- ${cell.name}`, () => {
    if (cell.expect === null) {
      const envelope = buildPublicMechanicalRefusal(sameCallRefusalWith(cell.nextCalls));
      assert.equal(envelope.route, VALIDATE_ROUTE);
      assert.equal(envelope.next_calls.length, 1);
      assert.notEqual(pickDoThisNext(envelope.next_calls), null);

      assert.throws(() => buildPublicMechanicalRefusal(refusalWith(cell.nextCalls)),
        /prerequisite_predicate cannot be validated without the originating tool identity/);
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

const RECOVERY_TEMPLATES = RUNTIME_BLOCKER_DESCRIPTOR.codes.filter(
  (entry) => entry.recovery && typeof entry.recovery === "object" && entry.recovery.route
);

const OBSERVED_IDENTITIES = Object.freeze({
  slice_subject: `${RECORD_ID}#SLICE-001`,
  corrective_status_slice_unit: `${RECORD_ID}#SLICE-001`
});
function boundValueCases(recovery, schema) {
  let cases = [{}];
  for (const [argument, fact] of Object.entries(recovery.argument_bindings ?? {})) {
    const declared = schema.properties?.[argument];
    const values = Array.isArray(declared?.enum) ? declared.enum : [OBSERVED_IDENTITIES[fact] ?? "resolved"];
    cases = cases.flatMap((facts) => values.map((value) => ({ ...facts, [fact]: value })));
  }
  return cases;
}

test("(d) every registered structured recovery projects into a callable continuation", async (t) => {
  assert.ok(RECOVERY_TEMPLATES.length > 0);
  for (const entry of RECOVERY_TEMPLATES) await t.test(entry.code, async () => {
    const { recovery } = entry;
    const schema = REQUEST_SCHEMAS[recovery.route];
    assert.ok(schema, `${entry.code}: recovery route ${recovery.route} publishes no request schema`);
    assert.equal(isRuntimeBlockerCode(entry.code), true);
    const bindings = Object.entries(recovery.argument_bindings ?? {});
    const settled = { [`${recovery.route}.prerequisite_satisfied`]: false };
    for (const facts of boundValueCases(recovery, schema)) {

      const callArguments = { ...(recovery.arguments ?? {}),
        ...Object.fromEntries(bindings.map(([argument, fact]) => [argument, facts[fact]])) };
      if (REGISTRY_RECOVERY_INSPECTION_KINDS.includes(recovery.kind)) {

        assert.equal(registryRecoveryContinuation(entry.code, { ...facts, ...settled }), null,
          `${entry.code}: an inspection must not be projected as a correction`);
        const inspection = registryRecoveryInspection(entry.code, facts);
        assert.deepEqual([inspection.tool, inspection.arguments], [recovery.route, callArguments]);
        const guidance = buildGuidanceCall({ tool: inspection.tool, arguments: inspection.arguments,
          information: inspection.information }, { requestSchema: schema, registeredTools: registeredToolNames });
        assert.equal(guidance.kind, "guidance");
        await assertCallsRegistered([guidance]);
        assert.equal(validateContinuationCalls([guidance],
          { observedFacts: { ...facts, ...settled }, requestSchemas: REQUEST_SCHEMAS }).valid, false);

        assert.throws(() => buildGuidanceCall({ tool: inspection.tool, arguments: inspection.arguments,
          information: inspection.information }, { requestSchema: schema, registeredTools: new Set() }));
        continue;
      }
      const observedFacts = { "recovery.completed": false, ...facts };
      const call = buildContinuationCall({
        tool: recovery.route,
        arguments: callArguments,
        recommended: true,
        success_predicate: { fact: "recovery.completed", operator: "is_true" }
      }, { requestSchema: schema });
      const result = validateContinuationCalls([call], { observedFacts, requestSchemas: REQUEST_SCHEMAS });
      assert.deepEqual(result, { valid: true, errors: [] }, `${entry.code}: ${result.errors.join("; ")}`);
      await assertCallsRegistered([call]);
    }
    if (!REGISTRY_RECOVERY_INSPECTION_KINDS.includes(recovery.kind)) {

      if (bindings.length > 0) assert.equal(registryRecoveryContinuation(entry.code, settled), null, `${entry.code}: missing facts`);
      assert.equal(KNOWN_TOOLS.has(recovery.route) && registeredToolNames.has(recovery.route), true);
      for (const [argument, fact] of bindings) if (Object.hasOwn(OBSERVED_IDENTITIES, fact)) {
        assert.equal(await requestContracts.contractFor(recovery.route).acceptsArguments(
          { ...(recovery.arguments ?? {}), [argument]: "WK-9000#foreign" }), false);
      }
      return;
    }
    for (const [argument, fact] of bindings) {

      assert.equal(registryRecoveryInspection(entry.code, {}), null, `${entry.code}: missing ${fact}`);
      assert.equal(registryRecoveryInspection(entry.code, { [`other_${fact}`]: "worker" }), null);

      const foreign = registryRecoveryInspection(entry.code, { [fact]: "not-a-registered-value" });
      assert.equal(foreign.arguments[argument], "not-a-registered-value");
      if (Array.isArray(schema.properties?.[argument]?.enum) || Object.hasOwn(OBSERVED_IDENTITIES, fact)) {
        assert.equal(await requestContracts.contractFor(foreign.tool).acceptsArguments(foreign.arguments), false);
      }
    }
  });
});

test("(d) the merely-allowed router surfaces are unaffected by the continuation contract", async () => {

  const ambiguous = await routeAmbiguous();
  const nextCalls = ambiguous.recommendations.flatMap(row => row.next_calls);
  assert.equal(validateNextCalls(nextCalls, { knownTools: KNOWN_TOOLS }).valid, true);
  const strict = validateContinuationCalls(nextCalls, {
    observedFacts: CONVERGENCE_FACTS,
    requestSchemas: REQUEST_SCHEMAS
  });
  assert.equal(strict.valid, false, "the strict contract is not what a permission set claims");
});

test("(d) the pre-remediation dispatch refusal shape no longer validates anywhere", () => {

  const list = [buildNextCall({
    tool: "workspace_assess_contract",
    arguments: { unit: "WK-9000" },
    recommended: true
  })];
  assert.equal(projectNextActionScalar(list), 'workspace_assess_contract({unit:"WK-9000"})');
  const result = validatePublicMechanicalRefusal({
    code: "work_record_readiness_failure",
    deciding_facts: [{ field: "wk.acceptance.criteria", value: "absent" }],
    next_calls: list,
    recovery: {
      state: "callable",
      prerequisite: "the authored contract declares no acceptance criteria",
      operation: "workspace_assess_contract",
      success_condition: "workspace_assess_contract reports the unit dispatchable"
    }
  }, { observedFacts: CONVERGENCE_FACTS, requestSchemas: REQUEST_SCHEMAS });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /declares no success_predicate/.test(error)));

  assert.equal(pickDoThisNext(list)?.tool, "workspace_assess_contract");
});

test("(e) the published continuation satisfies the request contract its route declares", async () => {
  const validateSchema = REQUEST_SCHEMAS[VALIDATE_ROUTE];
  assert.ok(validateSchema, 'the save owner publishes its current request contract');
  const envelope = buildPublicMechanicalRefusal(sameCallRefusalWith([{
    tool: VALIDATE_ROUTE, arguments: SAVE_ARGUMENTS, recommended: true,
    prerequisite_predicate: CONVERGENT, success_predicate: CONVERGENT
  }]));
  assert.deepEqual(envelope.next_calls[0].arguments, SAVE_ARGUMENTS);
  assert.equal(await REGISTERED.requestContracts.contractFor(VALIDATE_ROUTE).acceptsArguments(SAVE_ARGUMENTS), true);
  assert.throws(() => buildPublicMechanicalRefusal(refusalWith([{
    tool: VALIDATE_ROUTE, arguments: { ...SAVE_ARGUMENTS, obsolete_argument: RECORD_ID },
    recommended: true, success_predicate: CONVERGENT
  }])), /declares obsolete_argument.*does not accept/u);
  assert.throws(() => buildPublicMechanicalRefusal(refusalWith([{
    tool: DISPATCH_ROUTE, arguments: { role: 'coordinator', subject: 'WK-9000#SLICE-001' },
    recommended: true, success_predicate: CONVERGENT
  }], { operation: DISPATCH_ROUTE })), /allowed values/u);
  assert.throws(() => buildPublicMechanicalRefusal(refusalWith([{
    tool: VALIDATE_ROUTE, arguments: SAVE_ARGUMENTS, recommended: true, success_predicate: CONVERGENT
  }], {}, { request_schemas: null })), /requires each named tool's authoritative request schema/u);
});

test("(e) one contract runs on every path, and the carrier revalidates deterministically", () => {
  const envelope = buildPublicMechanicalRefusal(sameCallRefusalWith([{
    tool: VALIDATE_ROUTE,
    arguments: SAVE_ARGUMENTS,
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

test("(e) selected result reads emitted by verifier and code answers satisfy their registered schemas", async () => {
  const { requestContractErrors } = await import(
    "../../packages/wiki-core/src/lib/next-calls-descriptor.mjs");
  const { deriveRequestSchema } = await import("../../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs");
  const { createCodeIndexSelection } = await import("../../packages/wiki-mcp/src/lib/code-index-query-tools.mjs");
  const { registerCodeIndexTools } = await import("../../packages/wiki-mcp/src/lib/code-index-tools.mjs");
  const schemas = new Map();
  const capture = (name, config) => schemas.set(name, deriveRequestSchema(config.inputSchema));
  schemas.set("get_run_result", REQUEST_SCHEMAS.get_run_result);
  registerCodeIndexTools({ registerTool: capture, workspaceRepos: [], jsonContent: (v) => v,
    errorContent: (e) => e });

  const locator = { ref_id: "aB3_dE9x" };
  const verifyRead = buildNextCall({ tool: "get_run_result", recommended: true,
    arguments: { result: locator, detail: { member: "final_result" } } });
  assert.deepEqual(requestContractErrors("get_run_result", verifyRead.arguments,
    schemas.get("get_run_result")), []);

  assert.notDeepEqual(requestContractErrors("get_run_result",
    { subject: "WK-1", evidence: locator }, schemas.get("get_run_result")), []);

  const route = "query_code_index";
  const session = createCodeIndexSelection({ workspaceRepos: [] });
  const call = session.detailCall({ repository: "demo", unit: null },
    { source: locator, collection: "affected_files" });
  assert.equal(call.tool, route);
  assert.deepEqual(Object.keys(call.arguments), ["detail"]);
  assert.deepEqual(requestContractErrors(route, call.arguments, schemas.get(route)), [], route);
  for (const refused of [{ verbose: true }, { repo: "demo", ...call.arguments }, { status: false }]) {
    assert.notDeepEqual(requestContractErrors(route, refused, schemas.get(route)), [],
      `${route} does not accept ${Object.keys(refused)[0]}`);
  }
  assert.deepEqual(requestContractErrors(route, { status: true }, schemas.get(route)), []);
  assert.equal(validateNextCalls([verifyRead]).valid, true);
});
