import test from "node:test";
import assert from "node:assert/strict";

import {
  loadToolDiscoveryDescriptor,
  queryToolDiscoveryDescriptor,
  validateToolDiscoveryDescriptor
} from "../packages/wiki-core/src/lib/tool-discovery.mjs";

const TOOL_NAME = "workspace_tool_usage_audit";

function textFields(tool) {
  return [
    tool.display_name,
    tool.summary,
    tool.notes,
    ...(tool.docs_refs || []),
    ...(tool.source_files || []),
    ...(tool.task_ids || []),
    ...(tool.audience || []),
    ...(tool.side_effects || []),
    ...(tool.authority || [])
  ]
    .filter(Boolean)
    .join("\n");
}

async function loadAuditTool() {
  const descriptor = await loadToolDiscoveryDescriptor();
  const validation = validateToolDiscoveryDescriptor(descriptor);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics, null, 2));

  const tool = descriptor.tools.find((entry) => entry.tool_name === TOOL_NAME);
  assert.ok(tool, `${TOOL_NAME} must be present in assembled tool-discovery metadata`);
  return { descriptor, tool };
}

test("workspace_tool_usage_audit discovery is read-only operator observability", async () => {
  const { descriptor, tool } = await loadAuditTool();

  assert.equal(tool.kind, "mcp_tool");
  assert.equal(tool.entrypoint, TOOL_NAME);
  assert.equal(tool.recommended_route, "mcp");
  assert.deepEqual(tool.audience, ["operator"]);
  assert.deepEqual(tool.tier_visibility, ["operator_only"]);
  assert.deepEqual(tool.side_effects, ["read_only"]);
  assert.equal(tool.runtime_posture, "supported");
  assert.deepEqual(tool.task_ids, ["inspect-provenance"]);

  assert.ok(
    tool.summary.match(/\bread-only\b/i) && tool.summary.match(/\bobservability\b/i),
    "summary must present the audit route as read-only observability"
  );
  assert.match(tool.notes, /operator\/coordinator observability surface/i);
  assert.match(tool.notes, /compact, redacted, NEUTRAL tool-use catalog/i);
  assert.match(tool.notes, /renders NO misuse or adherence verdict/i);

  const inspectProvenanceResults = queryToolDiscoveryDescriptor(descriptor, {
    task_id: "inspect-provenance"
  });
  assert.ok(
    inspectProvenanceResults.some((entry) => entry.tool_name === TOOL_NAME),
    `${TOOL_NAME} must be discoverable through inspect-provenance`
  );
});

test("workspace_tool_usage_audit discovery points to owners without inline vocabulary copies", async () => {
  const { tool } = await loadAuditTool();
  const fields = textFields(tool);

  assert.deepEqual(tool.docs_refs, ["docs/tool-discovery.md", "docs/mcp-integration.md"]);
  assert.ok(
    tool.source_files.includes("packages/wiki-mcp/src/lib/tool-usage-audit-mcp-tools.mjs"),
    "source_files must reference the route registration module"
  );
  assert.ok(
    tool.source_files.includes("packages/wiki-core/data/tool-use-policy.v1.json"),
    "source_files must reference the offline vocabulary instead of copying it inline"
  );

  assert.equal(
    tool.source_files.includes("packages/wiki-core/data/tool-routing-intents.v1.json"),
    false,
    "neutral catalog must not reference the retired routing-intent data boundary"
  );
  assert.ok(
    tool.source_files.includes("wiki/work-records/WK-1438.json"),
    "source_files must still reference WK-1438 ownership"
  );
  assert.match(fields, /The offline vocabulary lives in packages\/wiki-core\/data\/tool-use-policy\.v1\.json/i);

  const inlineMisuseCodes = fields.match(
    /\b(search_used_for_status_aggregation|full_read_without_selected_resource|bulk_sampling_without_lens|dispatch_without_readiness_validation|ignored_required_next_action|high_output_option_without_compact_first)\b/g
  );
  assert.equal(
    inlineMisuseCodes,
    null,
    "discovery metadata must reference the policy vocabulary rather than duplicating misuse codes inline"
  );
});

test("workspace_tool_usage_audit discovery does not advertise fallback authority or mutation routes", async () => {
  const { tool } = await loadAuditTool();
  const fields = textFields(tool);

  assert.doesNotMatch(fields, /\b(?:use|run|invoke|fall back to|fallback to)\b[^.]*\bshell\b/i);
  assert.doesNotMatch(fields, /\b(?:edit|write|patch|mutate)\b[^.]*\braw JSON\b/i);
  assert.doesNotMatch(fields, /\bfallback\b/i);
  assert.doesNotMatch(fields, /\broute-refusal authority\b/i);
  assert.doesNotMatch(fields, /\brefusal authority\b/i);

  for (const forbiddenTaskId of [
    "dispatch-worker",
    "dispatch-reviewer",
    "dispatch-redteam",
    "create-work-record",
    "contract-edit",
    "set-closure",
    "generate-and-lint",
    "lint-repo",
    "run-validation"
  ]) {
    assert.ok(
      !tool.task_ids.includes(forbiddenTaskId),
      `${TOOL_NAME} must not advertise ${forbiddenTaskId} task routing`
    );
  }

  for (const forbiddenSideEffect of [
    "workspace_write",
    "record_write",
    "process_spawn",
    "cleanup_runtime_state",
    "destructive"
  ]) {
    assert.ok(
      !tool.side_effects.includes(forbiddenSideEffect),
      `${TOOL_NAME} must not advertise ${forbiddenSideEffect} side effects`
    );
  }

  assert.match(tool.notes, /does not dispatch agents, mutate records, run lint\/generate/i);
  assert.match(tool.notes, /block or authorize calls, route agents, scrape broad logs/i);
});
