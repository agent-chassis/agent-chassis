import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aggregateToolUsageAudit,
  compactToolUsageAuditAggregate
} from "../packages/wiki-mcp/src/lib/tool-usage-audit/aggregate.mjs";
import {
  confidenceEnvelope,
  normalizeAuditFact
} from "../packages/wiki-mcp/src/lib/tool-usage-audit/core.mjs";
import { sha256Text } from "../packages/wiki-mcp/src/lib/tool-usage-audit/redaction.mjs";
import { createLiveMcpToolEvent } from "../packages/wiki-mcp/src/lib/tool-usage-audit/live-recorder.mjs";

const POLICY = JSON.parse(readFileSync(new URL("../packages/wiki-core/data/tool-use-policy.v1.json", import.meta.url), "utf8"));

const SOURCE_ARTIFACT = Object.freeze({
  path_category: "agent_runs_artifact",
  path_digest: sha256Text(".agent-runs/run-aggregate/session.jsonl"),
  digest: sha256Text("aggregate-test-artifact")
});

function historicalFact({ sourceKind = "historical_deepswe_session_jsonl", confidence = "high", gap, event }) {
  return normalizeAuditFact(
    {
      fact_kind: "historical_tool_event",
      source_kind: sourceKind,
      transport_kind: gap ? "unsupported_gap" : sourceKind,
      observed_at: "2026-07-08T00:00:00.000Z",
      run: {
        role: "worker",
        subject: { canonical_ids: ["WK-1437#SLICE-030"] }
      },
      event
    },
    confidenceEnvelope({
      confidence,
      evidence_basis: gap ? "historical_mcp_policy_gap" : "structured_historical_tool_event",
      unsupported_gap_code: gap,
      sourceArtifact: SOURCE_ARTIFACT
    })
  );
}

function liveAggregateFact(event) {
  return normalizeAuditFact(
    {
      fact_kind: "live_mcp_tool_event",
      source_kind: "live_mcp_tool_event",
      transport_kind: "live_mcp_tool_event",
      observed_at: "2026-07-08T00:02:00.000Z",
      event
    },
    confidenceEnvelope({
      confidence: "high",
      evidence_basis: "live_mcp_handler_boundary_with_origin",
      sourceArtifact: {
        path_category: "live_mcp_handler_boundary",
        path_digest: sha256Text("live-aggregate-origin"),
        digest: sha256Text("live-aggregate-fact")
      }
    })
  );
}

test("compact aggregate counts historical/live evidence and bounded telemetry dimensions", () => {
  const facts = [
    historicalFact({
      event: {
        event_type: "tool_call",
        tool_name: "workspace_search",
        origin: {
          caller_kind: "agent",
          session_kind: "worker",
          tool_profile: "agent_safe"
        },
        response: { byte_count: 2048, size_class: "small" },
        next_action: "workspace_initiative_status",
        next_action_followed: false,
        misuse_classifications: [
          {
            code: "search_used_for_status_aggregation",
            replacement_family: "initiative_status_or_action_lens"
          },
          {
            code: "ignored_required_next_action",
            replacement_family: "required_next_action"
          }
        ]
      }
    }),
    historicalFact({
      sourceKind: "historical_launcher_metadata",
      confidence: "none",
      gap: "historical_gap_mcp_specific_misuse_without_structured_mcp_transcript",
      event: {
        event_type: "unsupported_gap",
        command_name: "workspace_read_page",
        origin: {
          caller_kind: "agent",
          session_kind: "worker",
          tool_profile: "agent_safe"
        },
        response: { size_class: "unavailable" }
      }
    }),
    createLiveMcpToolEvent({
      observedAt: "2026-07-08T00:01:00.000Z",
      toolName: "workspace_dispatch_worker",
      origin: {
        caller_kind: "coordinator",
        session_kind: "role_session",
        tool_profile: "launcher_managed",
        launcher_run_id: "launcher-run-aggregate-secret"
      },
      args: {
        path: "/home/user/agent-chassis/wiki/work-records/WK-1437.json",
        prompt: "RAW_PROMPT_SHOULD_NOT_LEAK",
        authorization: "Bearer SECRET_SHOULD_NOT_LEAK"
      },
      response: {
        byte_count: 900_000,
        result: {
          final: "CHILD_AGENT_FINAL_PROSE_SHOULD_NOT_LEAK",
          output: "/home/user/private/full-result.txt"
        }
      },
      misuse_classifications: [
        {
          code: "dispatch_without_readiness_validation",
          replacement_family: "dispatch_readiness_validation"
        }
      ]
    }),
    createLiveMcpToolEvent({
      observedAt: "2026-07-08T00:02:00.000Z",
      toolName: "workspace_read_page",
      origin: {
        caller_kind: "operator",
        session_kind: "mcp_client",
        tool_profile: "full_profile"
      },
      response: {
        byte_count: 300_000,
        result: "bounded response summary"
      },
      misuse: [{ code: "high_output_option_without_compact_first" }]
    }),
    liveAggregateFact({
      event_type: "mcp_tool_call",
      tool_name: "workspace_read_page",
      origin: {
        caller_kind: "operator",
        session_kind: "mcp_client",
        tool_profile: "full_profile"
      },
      response: {
        byte_count: 4096,
        size_class: "small"
      },
      misuse_classifications: [
        {
          code: "high_output_option_without_compact_first",
          exact_recommended_call: {
            tool_name: "workspace_read_page",
            arguments: { mode: "compact", path: "wiki/work-records/WK-1437.json" }
          },
          exact_recommended_call_provenance: {
            source: "WK-1438",
            tool_name: "workspace_tool_router_recommend",
            router_output: true
          }
        }
      ]
    })
  ];

  const aggregate = compactToolUsageAuditAggregate({
    facts,
    policy: POLICY,
    maxTopCalls: 10
  });

  assert.equal(aggregate.schema_version, "tool-usage-audit-aggregate.v1");
  assert.equal(aggregate.aggregate_mode, "compact");
  assert.equal(aggregate.bounded.raw_events_included, false);
  assert.equal(aggregate.input.total_fact_count, 5);
  assert.equal(aggregate.input.considered_fact_count, 5);
  assert.deepEqual(aggregate.counts.by_source_group, {
    historical_backfill: 2,
    live_mcp_runtime: 3
  });
  assert.equal(aggregate.counts.by_tool.workspace_search, 1);
  assert.equal(aggregate.counts.by_tool.workspace_dispatch_worker, 1);
  assert.equal(aggregate.counts.by_tool.workspace_read_page, 3);
  assert.equal(aggregate.counts.by_misuse_code.search_used_for_status_aggregation, 1);
  assert.equal(aggregate.counts.by_misuse_code.ignored_required_next_action, 1);
  assert.equal(aggregate.counts.by_misuse_code.dispatch_without_readiness_validation, 1);
  assert.equal(aggregate.counts.by_misuse_code.high_output_option_without_compact_first, 2);
  assert.equal(aggregate.counts.by_source_kind.historical_deepswe_session_jsonl, 1);
  assert.equal(aggregate.counts.by_source_kind.historical_launcher_metadata, 1);
  assert.equal(aggregate.counts.by_source_kind.live_mcp_tool_event, 3);
  assert.equal(aggregate.counts.by_confidence.high, 4);
  assert.equal(aggregate.counts.by_confidence.none, 1);
  assert.equal(
    aggregate.historical_unsupported_gap_counts.historical_gap_mcp_specific_misuse_without_structured_mcp_transcript,
    1
  );
  assert.equal(aggregate.next_action.derivable_event_count, 1);
  assert.equal(aggregate.next_action.ignored_count, 1);
  assert.equal(aggregate.next_action.ignored_required_next_action_misuse_count, 1);
  assert.equal(aggregate.first_tool.derivable_bucket_count, 3);
  assert.equal(Object.keys(aggregate.provenance.buckets).length, 3);
  assert.equal(Object.values(aggregate.provenance.buckets).some((bucket) => bucket.caller_kind === "coordinator"), true);
  assert.equal(Object.values(aggregate.provenance.buckets).some((bucket) => bucket.tool_profile === "full_profile"), true);
  assert.equal(aggregate.top_calls[0].tool_name, "workspace_dispatch_worker");
  assert.equal(aggregate.top_calls[0].misuse_codes.includes("dispatch_without_readiness_validation"), true);
  assert.equal(aggregate.top_calls.some((call) => call.response_size_class === "large"), true);
  assert.equal(aggregate.guidance.search_used_for_status_aggregation.guidance_kind, "coarse_replacement_family");
  assert.equal(aggregate.guidance.search_used_for_status_aggregation.replacement_family, "initiative_status_or_action_lens");
  assert.equal(aggregate.guidance.high_output_option_without_compact_first.guidance_kind, "wk1438_router_exact");
  assert.equal(aggregate.guidance.high_output_option_without_compact_first.exact_recommended_call.category, "object");
});

test("aggregate redacts labels and never exposes raw prompts, args, results, roots, or final prose", () => {
  const aggregate = aggregateToolUsageAudit([
    historicalFact({
      sourceKind: "historical_deepswe_trajectory",
      event: {
        event_type: "tool_call",
        tool_name: "/home/user/agent-chassis/SECRET_TOOL_NAME",
        origin: {
          caller_kind: "/home/user/.config/auth-token",
          session_kind: "worker",
          tool_profile: "agent_safe"
        },
        response: { byte_count: 640_000, size_class: "very_large" },
        misuse_classifications: [
          {
            code: "/tmp/secret-misuse-token",
            replacement_family: "/home/user/secret-family",
            routing_intent_ref: "token=SECRET_SHOULD_NOT_LEAK"
          }
        ]
      }
    }),
    createLiveMcpToolEvent({
      toolName: "workspace_read_page",
      origin: {
        caller_kind: "agent",
        session_kind: "worker",
        tool_profile: "agent_safe"
      },
      args: {
        prompt: "RAW_PROMPT_SHOULD_NOT_LEAK",
        path: "/home/user/private/root/file.txt",
        token: "SECRET_SHOULD_NOT_LEAK"
      },
      response: {
        byte_count: 12,
        result: {
          final: "CHILD_AGENT_FINAL_PROSE_SHOULD_NOT_LEAK",
          raw: "RAW_RESULT_SHOULD_NOT_LEAK"
        }
      }
    })
  ]);

  const text = JSON.stringify(aggregate);
  for (const forbidden of [
    "RAW_PROMPT_SHOULD_NOT_LEAK",
    "SECRET_SHOULD_NOT_LEAK",
    "RAW_RESULT_SHOULD_NOT_LEAK",
    "CHILD_AGENT_FINAL_PROSE_SHOULD_NOT_LEAK",
    "/home/user",
    "agent-chassis",
    "SECRET_TOOL_NAME",
    "secret-misuse-token",
    "secret-family"
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }

  assert.equal(Object.keys(aggregate.counts.by_tool)[0].startsWith("other_tool:"), true);
  assert.equal(Object.keys(aggregate.counts.by_misuse_code)[0].startsWith("unknown_misuse_code:"), true);
  assert.equal(Object.values(aggregate.provenance.buckets).some((bucket) => bucket.caller_kind === "other"), true);
});

test("exact guidance requires explicit WK-1438 router-output provenance", () => {
  const facts = [
    createLiveMcpToolEvent({
      toolName: "workspace_read_page",
      origin: { caller_kind: "agent", session_kind: "worker", tool_profile: "agent_safe" },
      misuse: [{ code: "full_read_without_selected_resource", replacement_family: "selected_resource_compact_read" }]
    }),
    liveAggregateFact({
      event_type: "mcp_tool_call",
      tool_name: "workspace_read_page",
      origin: { caller_kind: "agent", session_kind: "worker", tool_profile: "agent_safe" },
      misuse_classifications: [
        {
          code: "full_read_without_selected_resource",
          replacement_family: "selected_resource_compact_read",
          exact_recommended_call: { tool_name: "workspace_read_page", arguments: { mode: "compact" } },
          exact_recommended_call_provenance: "router_output"
        }
      ]
    }),
    liveAggregateFact({
      event_type: "mcp_tool_call",
      tool_name: "workspace_read_page",
      origin: { caller_kind: "agent", session_kind: "worker", tool_profile: "agent_safe" },
      misuse_classifications: [
        {
          code: "bulk_sampling_without_lens",
          replacement_family: "scoped_lens_or_filtered_summary",
          exact_recommended_call: { tool_name: "workspace_initiative_status", arguments: { initiative: "IN-0016" } },
          exact_recommended_call_source: "wk1438_router_output"
        }
      ]
    })
  ];

  const aggregate = compactToolUsageAuditAggregate({ facts, policy: POLICY });

  assert.equal(aggregate.guidance.full_read_without_selected_resource.guidance_kind, "coarse_replacement_family");
  assert.equal(aggregate.guidance.full_read_without_selected_resource.exact_recommended_call, null);
  assert.equal(aggregate.guidance.bulk_sampling_without_lens.guidance_kind, "wk1438_router_exact");
  assert.equal(aggregate.guidance.bulk_sampling_without_lens.exact_recommended_call.category, "object");
});
