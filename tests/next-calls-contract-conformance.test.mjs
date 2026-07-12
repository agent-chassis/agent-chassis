

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  runWorkRecordSummaryWithCompactGate,
  runWorkRecordReadWithCompactGate
} from "../packages/wiki-mcp/src/lib/work-record-compact-read-gate.mjs";
import {
  buildBlockedDispatchResult,
  buildBlockedRunStatusResult,
  buildBlockedRunWaitResult
} from "../packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs";
import { recommendToolRouteFromVocabulary } from "../packages/wiki-core/src/operations/tool-router.mjs";
import {
  buildNextCall,
  validateNextCalls,
  pickDoThisNext,
  projectNextActionScalar
} from "../packages/wiki-core/src/lib/next-calls-descriptor.mjs";
import { loadToolDiscoveryDescriptor } from "../packages/wiki-core/src/lib/tool-discovery.mjs";
import { isRuntimeBlockerCode } from "../packages/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

const toolDescriptor = await loadToolDiscoveryDescriptor();
const KNOWN_TOOLS = new Set(toolDescriptor.tools.map((entry) => entry.tool_name));

const vocabulary = JSON.parse(
  await readFile(new URL("../packages/wiki-core/data/tool-routing-intents.v1.json", import.meta.url), "utf8")
);

const WORKSPACE_REPO = "agent-chassis/agent-chassis";
const WORKSPACE_DIR = "/repo";
const RECORD_ID = "WK-9000";

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
