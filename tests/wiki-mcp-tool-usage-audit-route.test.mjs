import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  WORKSPACE_TOOL_USAGE_AUDIT_TOOL_NAME,
  createToolUsageAuditBoundaryRecorder,
  registerToolUsageAuditTools
} from "../packages/wiki-mcp/src/lib/tool-usage-audit-mcp-tools.mjs";
import { createLiveMcpToolUsageRecorder } from "../packages/wiki-mcp/src/lib/tool-usage-audit/live-recorder.mjs";

const POLICY = {
  misuse_codes: [
    {
      code: "high_output_option_without_compact_first",
      replacement_family: "compact_or_summarized_output_first"
    }
  ]
};

function captureRegisteredAuditTool(recorder) {
  const registered = [];
  registerToolUsageAuditTools({
    registerTool: (name, metadata, handler) => {
      registered.push({ name, metadata, handler });
    },
    z,
    jsonContent: (payload) => ({
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload
    }),
    errorContent: (error) => ({
      isError: true,
      structuredContent: { message: String(error?.message ?? error) }
    }),
    recorder,
    policy: POLICY
  });
  assert.equal(registered.length, 1);
  return registered[0];
}

function assertNoRawAuditMaterial(value) {
  const text = JSON.stringify(value);
  for (const forbidden of [
    "RAW_PROMPT_SHOULD_NOT_LEAK",
    "RAW_FULL_ARGS_SHOULD_NOT_LEAK",
    "CHILD_FINAL_PROSE_SHOULD_NOT_LEAK",
    "SECRET_TOKEN_SHOULD_NOT_LEAK",
    "/home/user",
    "agent-chassis"
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
}

test("workspace_tool_usage_audit route registers as read-only compact operator/coordinator telemetry", async () => {
  const recorder = createLiveMcpToolUsageRecorder({
    now: () => "2026-07-08T02:44:10.000Z"
  });
  const tool = captureRegisteredAuditTool(recorder);

  assert.equal(tool.name, WORKSPACE_TOOL_USAGE_AUDIT_TOOL_NAME);
  assert.match(tool.metadata.description, /Read-only compact aggregate telemetry/);
  assert.match(tool.metadata.description, /does not dispatch, mutate work records, run lint\/generate/i);

  recorder.recordEvent({
    toolName: "workspace_read_page",
    origin: {
      caller_kind: "coordinator",
      session_kind: "role_session",
      tool_profile: "agent_safe",
      launcher_run_id: "launcher-run-secret"
    },
    selected: {
      workspace_repo: "agent-chassis/agent-chassis",
      selected_unit: "WK-1437#SLICE-010",
      path: "/home/user/agent-chassis/wiki/work-records/WK-1437.json"
    },
    args: {
      prompt: "RAW_PROMPT_SHOULD_NOT_LEAK",
      full_args: "RAW_FULL_ARGS_SHOULD_NOT_LEAK",
      path: "/home/user/agent-chassis/wiki/work-records/WK-1437.json",
      token: "SECRET_TOKEN_SHOULD_NOT_LEAK"
    },
    response: {
      byte_count: 700_000,
      result: {
        final: "CHILD_FINAL_PROSE_SHOULD_NOT_LEAK",
        file: "/home/user/agent-chassis/.agent-runs/run/final.txt"
      }
    },
    misuse: [
      {
        code: "high_output_option_without_compact_first",
        replacement_family: "compact_or_summarized_output_first"
      }
    ]
  });

  const result = await tool.handler({});
  const payload = result.structuredContent;

  assert.equal(payload.tool, WORKSPACE_TOOL_USAGE_AUDIT_TOOL_NAME);
  assert.equal(payload.mode, "read_only_observational");
  assert.deepEqual(payload.effects, {
    dispatches_agents: false,
    mutates_work_records: false,
    runs_lint_or_generate: false,
    blocks_tool_calls: false,
    authorizes_tool_calls: false,
    reinterprets_domain_results: false
  });
  assert.equal(payload.aggregate.aggregate_mode, "compact");
  assert.equal(payload.aggregate.bounded.raw_events_included, false);
  assert.equal(payload.aggregate.bounded.max_facts, 1000);
  assert.equal(payload.aggregate.bounded.max_buckets, 50);
  assert.equal(payload.aggregate.bounded.max_top_calls, 20);
  assert.equal(payload.aggregate.bounded.max_guidance, 20);
  assert.equal(payload.aggregate.input.total_fact_count, 1);
  assert.equal(payload.aggregate.counts.by_tool.workspace_read_page, 1);
  assert.equal(payload.aggregate.counts.by_misuse_code.high_output_option_without_compact_first, 1);
  assert.equal(payload.aggregate.counts.by_source_kind.live_mcp_tool_event, 1);
  assert.equal(payload.aggregate.counts.by_confidence.high, 1);
  assert.equal(payload.aggregate.counts.by_source_group.live_mcp_runtime, 1);
  assert.equal(payload.aggregate.guidance.high_output_option_without_compact_first.guidance_kind, "coarse_replacement_family");
  assert.equal(payload.recorder_diagnostics.dropped_event_count, 0);
  assertNoRawAuditMaterial(result);
});

test("handler-boundary recorder preserves domain result while recording bounded origin facts", async () => {
  const recorder = createLiveMcpToolUsageRecorder({
    now: () => "2026-07-08T02:45:00.000Z"
  });
  const boundary = createToolUsageAuditBoundaryRecorder({
    recorder,
    origin: {
      caller_kind: "agent",
      session_kind: "worker",
      tool_profile: "agent_safe",
      client_origin: "mcp-client-secret"
    },
    selected: {
      workspace_repo: "agent-chassis/agent-chassis",
      selected_unit: "WK-1437#SLICE-010",
      path: "/home/user/agent-chassis/packages/wiki-mcp/src/server.mjs"
    },
    classifyMisuse: () => ["high_output_option_without_compact_first"]
  });
  const domainResult = {
    ok: true,
    final: "CHILD_FINAL_PROSE_SHOULD_NOT_LEAK",
    output_path: "/home/user/agent-chassis/.agent-runs/run/final.txt"
  };

  const returned = await boundary.observeToolCall({
    toolName: "workspace_context_for_path",
    args: {
      path: "/home/user/agent-chassis/packages/wiki-mcp/src/server.mjs",
      prompt: "RAW_PROMPT_SHOULD_NOT_LEAK",
      full_args: "RAW_FULL_ARGS_SHOULD_NOT_LEAK"
    },
    handler: async (args) => {
      assert.equal(args.full_args, "RAW_FULL_ARGS_SHOULD_NOT_LEAK");
      return domainResult;
    }
  });

  assert.equal(returned, domainResult);
  const [fact] = boundary.getEvents();
  assert.equal(fact.source_kind, "live_mcp_tool_event");
  assert.equal(fact.transport_kind, "live_mcp_tool_event");
  assert.equal(fact.confidence, "high");
  assert.equal(fact.evidence_basis, "live_mcp_handler_boundary_with_origin");
  assert.equal(fact.event.tool_name, "workspace_context_for_path");
  assert.equal(fact.event.origin.caller_kind, "agent");
  assert.equal(fact.event.origin.session_kind, "worker");
  assert.equal(fact.event.origin.tool_profile, "agent_safe");
  assert.equal(fact.event.origin.client_origin_digest.startsWith("sha256:"), true);
  assert.equal(fact.event.origin.client_origin, undefined);
  assert.equal(fact.event.selected.workspace_repo_digest.startsWith("sha256:"), true);
  assert.deepEqual(fact.event.selected.selected_unit.canonical_ids, ["WK-1437#SLICE-010"]);
  assert.deepEqual(fact.event.misuse_classifications, [{ code: "high_output_option_without_compact_first" }]);
  assert.equal(fact.event.response.outcome, "returned");
  assert.equal(fact.event.response.result.contains_path_like_text, true);
  assertNoRawAuditMaterial(fact);

  const tool = captureRegisteredAuditTool(recorder);
  const routeResult = await tool.handler({ max_facts: 1, max_buckets: 5, max_top_calls: 5, max_guidance: 5 });
  const aggregate = routeResult.structuredContent.aggregate;
  assert.equal(aggregate.bounded.max_facts, 1);
  assert.equal(aggregate.counts.by_tool.workspace_context_for_path, 1);
  assert.equal(aggregate.counts.by_confidence.high, 1);
  assert.equal(Object.values(aggregate.provenance.buckets).some((bucket) => bucket.caller_kind === "agent"), true);
  assertNoRawAuditMaterial(routeResult);
});

test("handler-boundary recorder rethrows handler errors while recording bounded thrown facts", async () => {
  const recorder = createLiveMcpToolUsageRecorder({
    now: () => "2026-07-08T02:55:00.000Z"
  });
  const boundary = createToolUsageAuditBoundaryRecorder({
    recorder,
    origin: {
      caller_kind: "agent",
      session_kind: "worker",
      tool_profile: "agent_safe",
      client_origin: "mcp-client-secret"
    },
    selected: {
      workspace_repo: "agent-chassis/agent-chassis",
      selected_unit: "WK-1437#SLICE-010",
      path: "/home/user/agent-chassis/wiki/work-records/WK-1437.json"
    },
    classifyMisuse: () => ["ignored_required_next_action"]
  });
  const thrown = new Error("RAW_PROMPT_SHOULD_NOT_LEAK");
  const wrapped = boundary.wrapHandler("workspace_read_page", async (args) => {
    assert.equal(args.full_args, "RAW_FULL_ARGS_SHOULD_NOT_LEAK");
    throw thrown;
  });

  await assert.rejects(
    wrapped({
      full_args: "RAW_FULL_ARGS_SHOULD_NOT_LEAK",
      path: "/home/user/agent-chassis/wiki/work-records/WK-1437.json"
    }),
    (error) => error === thrown
  );

  const [fact] = boundary.getEvents();
  assert.equal(fact.source_kind, "live_mcp_tool_event");
  assert.equal(fact.transport_kind, "live_mcp_tool_event");
  assert.equal(fact.confidence, "high");
  assert.equal(fact.evidence_basis, "live_mcp_handler_boundary_with_origin");
  assert.equal(fact.event.tool_name, "workspace_read_page");
  assert.equal(fact.event.response.outcome, "threw");
  assert.equal(fact.event.response.error.category, "object");
  assert.equal(fact.event.response.error.digest.startsWith("sha256:"), true);
  assert.equal(fact.event.response.error.message, undefined);
  assert.deepEqual(fact.event.misuse_classifications, [{ code: "ignored_required_next_action" }]);
  assertNoRawAuditMaterial(fact);

  const tool = captureRegisteredAuditTool(recorder);
  const routeResult = await tool.handler({ max_facts: 5, max_buckets: 5, max_top_calls: 5, max_guidance: 5 });
  const aggregate = routeResult.structuredContent.aggregate;
  assert.equal(aggregate.counts.by_tool.workspace_read_page, 1);
  assert.equal(aggregate.counts.by_misuse_code.ignored_required_next_action, 1);
  assert.equal(aggregate.counts.by_confidence.high, 1);
  assertNoRawAuditMaterial(routeResult);
});
