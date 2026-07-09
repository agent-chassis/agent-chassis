import test from "node:test";
import assert from "node:assert/strict";
import {
  createLiveMcpToolEvent,
  createLiveMcpToolUsageRecorder
} from "../packages/wiki-mcp/src/lib/tool-usage-audit/live-recorder.mjs";
import { compactToolUsageAuditAggregate } from "../packages/wiki-mcp/src/lib/tool-usage-audit/aggregate.mjs";

test("live MCP event facts use the closed live source and redact args/results", () => {
  const fact = createLiveMcpToolEvent({
    observedAt: "2026-07-08T00:00:00.000Z",
    toolName: "workspace_read_page",
    origin: {
      caller_kind: "agent",
      session_kind: "worker",
      tool_profile: "launcher-managed",
      launcher_run_id: "run-secret-001"
    },
    selected: {
      workspace_repo: "agent-chassis/agent-chassis",
      selected_unit: "WK-1437#SLICE-016",
      path: "/home/user/agent-chassis/wiki/work-records/WK-1437.json"
    },
    args: {
      path: "/home/user/private/token.txt",
      prompt: "RAW_PROMPT_SHOULD_NOT_LEAK",
      authorization: "Bearer SHOULD_NOT_LEAK"
    },
    response: {
      byte_count: 8192,
      truncated: true,
      spilled: true,
      refused: false,
      spill_reference: "/tmp/response-spill/full-output.txt",
      result: {
        final: "CHILD_AGENT_FINAL_PROSE_SHOULD_NOT_LEAK",
        file: "/home/user/private/output.txt"
      }
    },
    misuse: [
      {
        code: "high_output_option_without_compact_first",
        replacement_family: "compact_or_summarized_output_first"
      }
    ]
  });

  assert.equal(fact.schema_version, "tool-usage-audit.v1");
  assert.equal(fact.source_kind, "live_mcp_tool_event");
  assert.equal(fact.transport_kind, "live_mcp_tool_event");
  assert.equal(fact.confidence, "high");
  assert.equal(fact.event.tool_name, "workspace_read_page");
  assert.equal(fact.event.origin.caller_kind, "agent");
  assert.equal(fact.event.origin.launcher_run_digest.startsWith("sha256:"), true);
  assert.equal(fact.event.origin.launcher_run_id, undefined);
  assert.equal(fact.event.args.contains_sensitive_key, true);
  assert.equal(fact.event.args.path_reference_count >= 1, true);
  assert.equal(fact.event.args.prompt, undefined);
  assert.equal(fact.event.response.byte_count, 8192);
  assert.equal(fact.event.response.size_class, "medium");
  assert.equal(fact.event.response.truncated, true);
  assert.equal(fact.event.response.spilled, true);
  assert.equal(fact.event.response.refused, false);
  assert.equal(fact.event.response.spill_reference.contains_path_like_text, true);
  assert.equal(fact.event.response.result.byte_count > 0, true);
  assert.equal(fact.event.response.result.final, undefined);
  assert.deepEqual(fact.event.selected.selected_unit.canonical_ids, ["WK-1437#SLICE-016"]);
  assert.deepEqual(fact.event.misuse_classifications, [
    {
      code: "high_output_option_without_compact_first",
      replacement_family: "compact_or_summarized_output_first"
    }
  ]);
});

test("unknown live MCP origin is low confidence and not classified as misuse by default", () => {
  const fact = createLiveMcpToolEvent({
    observedAt: "2026-07-08T00:00:00.000Z",
    toolName: "workspace_search",
    args: { q: "status" },
    result: { ok: true },
    evidence: {
      confidence: "high",
      evidence_basis: "caller_supplied_but_origin_unknown"
    }
  });

  assert.equal(fact.confidence, "low");
  assert.equal(fact.evidence_basis, "caller_supplied_but_origin_unknown");
  assert.equal(fact.unsupported_gap_code, undefined);
  assert.equal(fact.event.origin.caller_kind, "unknown");
  assert.equal(fact.event.origin.session_kind, "unknown");
  assert.deepEqual(fact.event.misuse_classifications, []);
  assert.equal(fact.event.response.truncated, "unavailable");
  assert.equal(fact.event.response.spilled, "unavailable");
  assert.equal(fact.event.response.refused, "unavailable");

  const absentResult = createLiveMcpToolEvent({
    observedAt: "2026-07-08T00:00:00.000Z",
    toolName: "workspace_read_page"
  });
  assert.equal(absentResult.event.response.byte_count, 0);
  assert.equal(absentResult.event.response.size_class, "empty");
});

test("live recorder keeps bounded in-memory events and exposes drop diagnostics", () => {
  const recorder = createLiveMcpToolUsageRecorder({
    maxEvents: 2,
    now: () => "2026-07-08T00:00:00.000Z"
  });

  recorder.recordEvent({ toolName: "tool_one", result: "one" });
  recorder.recordEvent({ toolName: "tool_two", result: "two" });
  recorder.recordEvent({ toolName: "tool_three", result: "three" });

  const events = recorder.getEvents();
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => event.event.tool_name),
    ["tool_two", "tool_three"]
  );
  assert.equal(recorder.getDiagnostics().dropped_event_count, 1);

  events[0].event.tool_name = "mutated";
  assert.equal(recorder.getEvents()[0].event.tool_name, "tool_two");
});

test("live recorder preserves WK-1438 exact guidance into compact aggregate guidance", () => {
  const recorder = createLiveMcpToolUsageRecorder({
    now: () => "2026-07-08T00:00:00.000Z"
  });

  const fact = recorder.recordEvent({
    toolName: "workspace_read_page",
    origin: {
      caller_kind: "agent",
      session_kind: "worker",
      tool_profile: "agent_safe"
    },
    response: {
      byte_count: 4096,
      result: { ok: true }
    },
    misuse: [
      {
        code: "high_output_option_without_compact_first",
        replacement_family: "compact_or_summarized_output_first",
        routing_intent_ref: "selected_work_record_context",
        exact_recommended_call: {
          tool_name: "workspace_read_page",
          arguments: {
            path: "wiki/work-records/WK-1437.json",
            mode: "compact"
          }
        },
        exact_recommended_call_provenance: {
          source_kind: "wk1438_router_output",
          tool_name: "workspace_tool_router_recommend",
          router_output: true
        }
      }
    ]
  });

  const [recordedFact] = recorder.getEvents();
  assert.deepEqual(recordedFact, fact);
  assert.equal(
    recordedFact.event.misuse_classifications[0].exact_recommended_call_provenance.source_kind,
    "wk1438_router_output"
  );
  assert.equal(
    recordedFact.event.misuse_classifications[0].exact_recommended_call_provenance.router_output,
    true
  );
  assert.equal(recordedFact.event.misuse_classifications[0].exact_recommended_call.category, "object");

  const aggregate = compactToolUsageAuditAggregate({ facts: recorder.getEvents() });
  const guidance = aggregate.guidance.high_output_option_without_compact_first;
  assert.equal(guidance.guidance_kind, "wk1438_router_exact");
  assert.equal(guidance.replacement_family, "compact_or_summarized_output_first");
  assert.equal(guidance.routing_intent_ref, "selected_work_record_context");
  assert.equal(guidance.exact_recommended_call.category, "object");
});

test("observeToolCall preserves handler return values while recording bounded facts", async () => {
  const recorder = createLiveMcpToolUsageRecorder({
    now: () => "2026-07-08T00:00:00.000Z"
  });
  const domainResult = { value: 42, output: "/home/user/private/result.txt" };

  const result = await recorder.observeToolCall(
    {
      toolName: "workspace_context_for_path",
      args: {
        path: "packages/wiki-mcp/src/server.mjs",
        secret: "SHOULD_NOT_LEAK"
      },
      origin: {
        caller_kind: "agent",
        session_kind: "worker",
        client_origin: "mcp-client-001"
      }
    },
    async () => domainResult
  );

  assert.equal(result, domainResult);
  const [fact] = recorder.getEvents();
  assert.equal(fact.event.tool_name, "workspace_context_for_path");
  assert.equal(fact.event.response.outcome, "returned");
  assert.equal(fact.event.response.result.contains_path_like_text, true);
  assert.equal(fact.event.args.contains_sensitive_key, true);
});

test("observeToolCall rethrows domain errors and records only redacted error facts", async () => {
  const recorder = createLiveMcpToolUsageRecorder({
    now: () => "2026-07-08T00:00:00.000Z"
  });
  const domainError = new Error("failure containing /home/user/private/secret.txt");

  await assert.rejects(
    recorder.observeToolCall({ toolName: "workspace_dispatch_worker" }, async () => {
      throw domainError;
    }),
    domainError
  );

  const [fact] = recorder.getEvents();
  assert.equal(fact.event.response.outcome, "threw");
  assert.equal(fact.event.response.error.category, "object");
  assert.equal(fact.event.response.error.message, undefined);
  assert.equal(recorder.getDiagnostics().record_error_count, 0);
});
