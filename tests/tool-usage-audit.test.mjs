import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIDENCE_LEVELS,
  SOURCE_KINDS,
  TRANSPORT_KINDS,
  UNSUPPORTED_HISTORICAL_MCP_GAP_CODES,
  extractHistoricalToolUseBaseline
} from "../packages/wiki-mcp/src/lib/tool-usage-audit.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(REPO_ROOT, "packages/wiki-core/data/tool-use-policy.v1.json");

const REQUIRED_MISUSE_CODES = new Set([
  "search_used_for_status_aggregation",
  "full_read_without_selected_resource",
  "bulk_sampling_without_lens",
  "dispatch_without_readiness_validation",
  "ignored_required_next_action",
  "high_output_option_without_compact_first"
]);

const REQUIRED_REPLACEMENT_FAMILIES = new Map([
  ["search_used_for_status_aggregation", "initiative_status_or_action_lens"],
  ["full_read_without_selected_resource", "selected_resource_compact_read"],
  ["bulk_sampling_without_lens", "scoped_lens_or_filtered_summary"],
  ["dispatch_without_readiness_validation", "dispatch_readiness_validation"],
  ["ignored_required_next_action", "required_next_action"],
  ["high_output_option_without_compact_first", "compact_or_summarized_output_first"]
]);

const VALID_SEVERITIES = new Set(["info", "low", "medium", "high"]);
const VALID_RECOVERABILITY = new Set([
  "recoverable",
  "operator_review_recommended",
  "non_recoverable_from_audit"
]);

async function loadToolUsePolicy() {
  return JSON.parse(await readFile(POLICY_PATH, "utf8"));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function findFact(facts, predicate, label) {
  const found = facts.find(predicate);
  assert.ok(found, `missing fact: ${label}`);
  return found;
}

async function withSyntheticAgentRunsFixture(callback) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "tool-usage-audit-"));
  const runDir = path.join(rootDir, ".agent-runs", "run-001");
  try {
    await writeJson(path.join(runDir, "meta.json"), {
      schema_version: "agent-run-provenance.v1",
      id: "run-001",
      subject: "WK-1437#SLICE-007",
      role: "worker",
      agent: "codex",
      status: "completed",
      started_at: "2026-07-07T04:00:00Z",
      completed_at: "2026-07-07T04:05:00Z",
      artifacts: {
        stderr: ".agent-runs/run-001/stderr.txt",
        response_spill: "/workspace/response-spill/full-output.txt"
      },
      command: {
        allowlisted_route: "workspace_work_record_validate"
      },
      tool_events: [
        {
          type: "tool_call",
          tool_name: "workspace_read",
          args: {
            path: "docs/mcp-integration.md",
            workRecordPath: "wiki/work-records/WK-1437.json",
            homePath: "/home/user/.ssh/id_rsa",
            tmpPath: "/tmp/session.env",
            authPath: "/var/auth/token.env",
            responsePath: "/workspace/response-spill/full-output.txt",
            agentRunsPath: ".agent-runs/run-001/trajectory.jsonl",
            prompt: "RAW_PROMPT_SHOULD_NOT_LEAK",
            token: "SECRET_VALUE_SHOULD_NOT_LEAK"
          },
          result: {
            output: "FULL_OUTPUT_SHOULD_NOT_LEAK /home/user/private/output.txt",
            authorization: "Bearer SHOULD_NOT_LEAK"
          }
        }
      ]
    });

    await writeJson(path.join(runDir, "operator", "state.json"), {
      schema_version: "agent-run-provenance.v1",
      id: "operator-001",
      status: "completed",
      command: {
        source: "cli",
        operatorCommand: "workspace-wrapper run --token=SHOULD_NOT_LEAK /home/user/.config/auth.json"
      }
    });

    await writeJson(path.join(runDir, "input-manifest.json"), {
      schema_version: "review-context-manifest.v1",
      id: "review-001",
      subject: "WK-1437#SLICE-007",
      role: "reviewer",
      context_files: [
        { source_path: "docs/mcp-integration.md", bytes: 100 },
        { source_path: "wiki/work-records/WK-1437.json", bytes: 200 },
        { source_path: "packages/wiki-mcp/src/server.mjs", snapshot_path: "run-001/context/server.mjs" },
        { source_path: "the project documentation" }
      ]
    });
    await writeText(path.join(runDir, "context", "server.mjs"), "export const size = 1;\n");

    await writeJson(path.join(runDir, "trajectory.json"), {
      schema_version: "deepswe.trajectory.v1",
      id: "trajectory-001",
      subject: "WK-1437#SLICE-007",
      tool_events: [
        {
          type: "tool_call",
          tool_name: "workspace_search",
          args: {
            query: "RAW_TRAJECTORY_QUERY_SHOULD_NOT_LEAK",
            file: "/var/lib/project/source.js",
            cookie: "SECRET_COOKIE_SHOULD_NOT_LEAK"
          },
          result: {
            output: "RAW_TRAJECTORY_RESULT_SHOULD_NOT_LEAK"
          }
        }
      ]
    });

    await writeText(
      path.join(runDir, "session.jsonl"),
      [
        JSON.stringify({
          schema_version: "codex-session.v1",
          id: "session-001",
          subject: "WK-1437#SLICE-007",
          type: "tool_call",
          tool_call: {
            name: "functions.exec_command",
            arguments: {
              cmd: "cat /home/user/.env",
              env: { token: "SECRET_ENV_SHOULD_NOT_LEAK" }
            }
          },
          output: "RAW_SESSION_OUTPUT_SHOULD_NOT_LEAK"
        }),
        JSON.stringify({
          type: "tool_call",
          tool_name: "workspace_search",
          args: { query: "AMBIGUOUS_LOW_CONFIDENCE_SHOULD_NOT_LEAK" },
          result: { output: "AMBIGUOUS_RESULT_SHOULD_NOT_LEAK" }
        })
      ].join("\n")
    );

    await writeText(
      path.join(runDir, "stderr.txt"),
      [
        "exec",
        "bash -lc 'cat /home/user/.ssh/id_rsa && echo token=SHOULD_NOT_LEAK > /tmp/session.env'",
        "*** Begin Patch",
        "*** Update File: docs/tool-discovery.md"
      ].join("\n")
    );

    return await callback({ rootDir, runDir });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("tool-use policy vocabulary is schema-backed and audit-only", async () => {
  const policy = await loadToolUsePolicy();

  assert.equal(policy.schema_version, "tool-use-policy.v1");
  assert.equal(policy.policy_id, "agent_tool_use_policy");

  assert.deepEqual(policy.policy_posture, {
    mode: "audit_only",
    data_only: true,
    enforces_tool_calls: false,
    authorizes_tool_calls: false,
    routes_tool_calls: false,
    refuses_tool_calls: false,
    description: policy.policy_posture.description
  });
  assert.match(policy.policy_posture.description, /audit and telemetry only/i);

  assert.equal(policy.routing_intent_contract.owned_by, "WK-1438");
  assert.equal(policy.routing_intent_contract.vocabulary, "tool-routing-intents.v1");
  assert.equal(policy.routing_intent_contract.references_available, false);
  assert.equal(policy.routing_intent_contract.guidance, "routing_guidance_unavailable");
  assert.match(policy.routing_intent_contract.reason, /does not define routing-intent identifiers/);

  assert.deepEqual(
    new Set(policy.severity_levels.map((level) => level.id)),
    VALID_SEVERITIES
  );
  assert.deepEqual(
    new Set(policy.recoverability_levels.map((level) => level.id)),
    VALID_RECOVERABILITY
  );
  assert.ok(policy.replacement_families.length >= REQUIRED_MISUSE_CODES.size);
  assert.ok(policy.misuse_codes.length >= REQUIRED_MISUSE_CODES.size);
});

test("misuse vocabulary carries required codes and replacement-call family metadata", async () => {
  const policy = await loadToolUsePolicy();
  const replacementFamilyIds = new Set(policy.replacement_families.map((family) => family.id));
  const misuseByCode = new Map(policy.misuse_codes.map((misuse) => [misuse.code, misuse]));
  const seenCodes = new Set();

  for (const family of policy.replacement_families) {
    assert.equal(typeof family.id, "string");
    assert.ok(family.id.length > 0);
    assert.equal(typeof family.description, "string");
    assert.ok(family.description.length > 0);
    assert.equal(typeof family.exact_call_authority, "string");
    assert.match(family.exact_call_authority, /WK-1438|previous tool response|dispatch readiness tooling/);
  }

  for (const misuse of policy.misuse_codes) {
    assert.equal(seenCodes.has(misuse.code), false, `duplicate misuse code ${misuse.code}`);
    seenCodes.add(misuse.code);
    assert.equal(typeof misuse.title, "string");
    assert.equal(typeof misuse.summary, "string");
    assert.ok(VALID_SEVERITIES.has(misuse.severity), `unexpected severity for ${misuse.code}`);
    assert.ok(
      VALID_RECOVERABILITY.has(misuse.recoverability),
      `unexpected recoverability for ${misuse.code}`
    );
    assert.ok(
      replacementFamilyIds.has(misuse.replacement_family),
      `replacement_family must exist for ${misuse.code}`
    );
    assert.equal(misuse.routing_intent_ref, null);
    assert.equal(misuse.route_guidance, "routing_guidance_unavailable");
    assert.equal(misuse.audit_only, true);
  }

  assert.deepEqual(new Set([...seenCodes].filter((code) => REQUIRED_MISUSE_CODES.has(code))), REQUIRED_MISUSE_CODES);

  for (const [code, replacementFamily] of REQUIRED_REPLACEMENT_FAMILIES) {
    assert.equal(
      misuseByCode.get(code)?.replacement_family,
      replacementFamily,
      `unexpected replacement family for ${code}`
    );
  }
});

test("historical agent-runs baseline extracts source_kind, confidence, unsupported_gap, review_context, path redaction, and structured tool facts", async () => {
  await withSyntheticAgentRunsFixture(async ({ rootDir }) => {
    const baseline = await extractHistoricalToolUseBaseline({ rootDir, agentRunsDir: ".agent-runs" });

    assert.equal(baseline.schema_version, "tool-usage-historical-baseline.v1");
    assert.equal(baseline.extraction.read_only, true);
    assert.equal(baseline.extraction.treats_agent_runs_as_canonical, false);
    assert.deepEqual(baseline.closed_taxonomy.source_kinds, [...SOURCE_KINDS]);
    assert.deepEqual(baseline.closed_taxonomy.transport_kinds, [...TRANSPORT_KINDS]);
    assert.deepEqual(baseline.closed_taxonomy.confidence_levels, [...CONFIDENCE_LEVELS]);
    assert.equal(baseline.source_root.path, undefined);
    assert.equal(typeof baseline.source_root.path_digest, "string");

    assert.ok(baseline.facts.length > 0);
    for (const fact of baseline.facts) {
      assert.equal(fact.schema_version, "tool-usage-audit.v1");
      assert.ok(SOURCE_KINDS.includes(fact.source_kind), `unexpected source_kind ${fact.source_kind}`);
      assert.ok(TRANSPORT_KINDS.includes(fact.transport_kind), `unexpected transport_kind ${fact.transport_kind}`);
      assert.ok(CONFIDENCE_LEVELS.includes(fact.confidence), `unexpected confidence ${fact.confidence}`);
      assert.equal(typeof fact.evidence_basis, "string");
      assert.ok(fact.evidence_basis.length > 0);
      assert.equal(typeof fact.source_artifact?.path_digest, "string");
      assert.equal(typeof fact.source_artifact?.digest, "string");
      assert.equal(fact.source_artifact.path, undefined);
    }

    const launcherRun = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "run" &&
        fact.source_kind === "historical_launcher_metadata" &&
        fact.launcher_metadata?.schema_version === "agent-run-provenance.v1",
      "launcher run metadata"
    );
    assert.equal(launcherRun.confidence, "medium");
    assert.equal(launcherRun.evidence_basis, "historical_launcher_metadata");
    assert.deepEqual(launcherRun.run.subject.canonical_ids, ["WK-1437#SLICE-007"]);

    const launcherCommand = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "event" &&
        fact.source_kind === "launcher_owned_command" &&
        fact.transport_kind === "launcher_owned_command",
      "launcher-owned command event"
    );
    assert.equal(launcherCommand.confidence, "medium");
    assert.equal(launcherCommand.evidence_basis, "structured_launcher_provenance");
    assert.equal(launcherCommand.event.command_name, "workspace_work_record_validate");

    const operatorCommand = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "event" &&
        fact.source_kind === "operator_shell_command" &&
        fact.transport_kind === "operator_shell_command",
      "operator shell command event"
    );
    assert.equal(operatorCommand.confidence, "medium");
    assert.equal(operatorCommand.evidence_basis, "operator_authored_artifact_or_entrypoint");
    assert.equal(operatorCommand.event.command_text.contains_secret_like_text, true);

    const agentShell = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "event" &&
        fact.source_kind === "historical_codex_stderr_shell" &&
        fact.transport_kind === "agent_raw_shell_command",
      "stderr-derived agent raw shell event"
    );
    assert.equal(agentShell.confidence, "medium");
    assert.equal(agentShell.evidence_basis, "agent_transcript_or_stderr_shell_event");
    assert.equal(agentShell.event.command_name, "bash");
    assert.equal(agentShell.event.command_text.contains_secret_like_text, true);

    const applyPatch = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "event" &&
        fact.source_kind === "historical_apply_patch_text" &&
        fact.transport_kind === "historical_apply_patch_text",
      "stderr-derived apply_patch text event"
    );
    assert.equal(applyPatch.confidence, "medium");
    assert.equal(applyPatch.evidence_basis, "agent_transcript_or_stderr_apply_patch_text");
    assert.equal(applyPatch.event.event_type, "apply_patch");

    const reviewContext = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "baseline" &&
        fact.source_kind === "historical_review_context_bundle" &&
        fact.transport_kind === "historical_review_context_bundle",
      "review context bundle baseline"
    );
    assert.equal(reviewContext.confidence, "high");
    assert.equal(reviewContext.evidence_basis, "review_bundle_manifest_or_context_stat");
    assert.equal(reviewContext.review_context_bundle.file_count, 4);
    assert.equal(reviewContext.review_context_bundle.byte_count, 323);
    assert.equal(reviewContext.review_context_bundle.byte_count_file_count, 3);
    assert.deepEqual(reviewContext.review_context_bundle.path_categories, {
      docs: 1,
      internal: 1,
      package_source: 1,
      work_record: 1
    });

    const semanticContextGap = findFact(
      baseline.facts,
      (fact) =>
        fact.source_kind === "historical_review_context_bundle" &&
        fact.transport_kind === "unsupported_gap" &&
        fact.unsupported_gap_code === "historical_gap_review_context_semantic_inclusion_reason",
      "semantic review context unsupported gap"
    );
    assert.equal(semanticContextGap.confidence, "none");
    assert.equal(semanticContextGap.evidence_basis, "no_structured_context_inclusion_provenance");

    const trajectoryTool = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "event" &&
        fact.source_kind === "historical_deepswe_trajectory" &&
        fact.event?.tool_name === "workspace_search",
      "DeepSWE trajectory structured tool event"
    );
    assert.equal(trajectoryTool.confidence, "high");
    assert.equal(trajectoryTool.evidence_basis, "structured_deepswe_or_codex_tool_event");
    assert.equal(trajectoryTool.event.args.category, "object");
    assert.equal(trajectoryTool.event.args.contains_sensitive_key, true);
    assert.equal(trajectoryTool.event.result.category, "object");

    const codexSessionTool = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "event" &&
        fact.source_kind === "historical_deepswe_session_jsonl" &&
        fact.transport_kind === "historical_deepswe_session_jsonl" &&
        fact.event?.tool_name === "functions.exec_command",
      "Codex session JSONL structured tool event"
    );
    assert.equal(codexSessionTool.confidence, "high");
    assert.equal(codexSessionTool.evidence_basis, "structured_deepswe_or_codex_tool_event");
    assert.equal(codexSessionTool.event.args.contains_sensitive_key, true);
    assert.equal(codexSessionTool.event.args.path_reference_count, 1);

    const lowConfidenceStructuredEvent = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "event" &&
        fact.source_kind === "historical_launcher_metadata" &&
        fact.transport_kind === "unsupported_gap" &&
        fact.confidence === "low" &&
        fact.unsupported_gap_code === "historical_gap_mcp_specific_misuse_without_structured_mcp_transcript",
      "ambiguous structured tool event"
    );
    assert.equal(lowConfidenceStructuredEvent.evidence_basis, "ambiguous_structured_tool_event_provenance");

    for (const gapCode of UNSUPPORTED_HISTORICAL_MCP_GAP_CODES) {
      const gap = findFact(
        baseline.facts,
        (fact) =>
          fact.fact_kind === "unsupported_gap" &&
          fact.transport_kind === "unsupported_gap" &&
          fact.confidence === "none" &&
          fact.unsupported_gap_code === gapCode,
        `historical unsupported MCP gap ${gapCode}`
      );
      assert.ok(
        [
          "no_structured_mcp_transcript",
          "historical_jsonl_without_structured_mcp_transcript",
          "historical_stderr_without_structured_mcp_transcript"
        ].includes(gap.evidence_basis),
        `unexpected evidence basis for ${gapCode}: ${gap.evidence_basis}`
      );
    }

    assert.equal(
      baseline.facts.some((fact) => fact.source_kind === "live_mcp_tool_event"),
      false,
      "historical fixtures must not emit live MCP facts"
    );
    assert.equal(
      baseline.facts.some(
        (fact) =>
          ["historical_codex_stderr_shell", "historical_apply_patch_text"].includes(fact.source_kind) &&
          fact.transport_kind === "live_mcp_tool_event"
      ),
      false,
      "stderr/apply_patch evidence must not be counted as live MCP transport"
    );
    for (const shellMcpGap of baseline.facts.filter(
      (fact) =>
        ["historical_codex_stderr_shell", "historical_apply_patch_text"].includes(fact.source_kind) &&
        fact.unsupported_gap_code === "historical_gap_mcp_specific_misuse_without_structured_mcp_transcript"
    )) {
      assert.equal(shellMcpGap.fact_kind, "unsupported_gap");
      assert.equal(shellMcpGap.transport_kind, "unsupported_gap");
      assert.equal(shellMcpGap.confidence, "none");
      assert.equal(shellMcpGap.event, undefined);
    }

    const serialized = JSON.stringify(baseline);
    for (const forbidden of [
      "RAW_PROMPT_SHOULD_NOT_LEAK",
      "SECRET_VALUE_SHOULD_NOT_LEAK",
      "FULL_OUTPUT_SHOULD_NOT_LEAK",
      "RAW_TRAJECTORY_QUERY_SHOULD_NOT_LEAK",
      "RAW_TRAJECTORY_RESULT_SHOULD_NOT_LEAK",
      "SECRET_COOKIE_SHOULD_NOT_LEAK",
      "SECRET_ENV_SHOULD_NOT_LEAK",
      "RAW_SESSION_OUTPUT_SHOULD_NOT_LEAK",
      "AMBIGUOUS_LOW_CONFIDENCE_SHOULD_NOT_LEAK",
      "AMBIGUOUS_RESULT_SHOULD_NOT_LEAK",
      "SHOULD_NOT_LEAK",
      "Bearer ",
      "/home/user",
      "/tmp/session.env",
      "/var/auth/token.env",
      "/workspace/response-spill/full-output.txt",
      ".agent-runs/run-001"
    ]) {
      assert.equal(serialized.includes(forbidden), false, `baseline leaked ${forbidden}`);
    }

    for (const category of [
      "absolute_path",
      "home_path",
      "tmp_path",
      "auth_or_secret_path",
      "response_or_log_artifact",
      "agent_runs_artifact",
      "safe_repo_relative_canonical"
    ]) {
      assert.match(serialized, new RegExp(`"path_category":"${category}"`), `missing redacted ${category}`);
    }
    assert.match(serialized, /"path":"docs\/mcp-integration\.md"/);
    assert.match(serialized, /"path":"wiki\/work-records\/WK-1437\.json"/);

    assert.equal(baseline.summary.by_source_kind.historical_deepswe_trajectory, 1);
    assert.equal(baseline.summary.by_source_kind.historical_deepswe_session_jsonl >= 1, true);
    assert.equal(baseline.summary.by_source_kind.historical_codex_stderr_shell >= 1, true);
    assert.equal(baseline.summary.by_source_kind.historical_apply_patch_text >= 1, true);
    assert.equal(baseline.summary.by_source_kind.historical_review_context_bundle, 2);
    assert.equal(baseline.summary.by_source_kind.live_mcp_tool_event, undefined);
    assert.equal(baseline.summary.by_confidence.low >= 1, true);
    assert.equal(baseline.summary.by_confidence.none >= UNSUPPORTED_HISTORICAL_MCP_GAP_CODES.length, true);
    assert.equal(baseline.summary.tool_counts.workspace_search >= 2, true);
  });
});

test("historical shell provenance keeps ambiguous shell evidence out of confirmed MCP and operator buckets", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "tool-usage-audit-ambiguous-shell-"));
  const runDir = path.join(rootDir, ".agent-runs", "run-ambiguous-shell");
  try {
    await writeJson(path.join(runDir, "state.json"), {
      schema_version: "agent-run-provenance.v1",
      id: "run-ambiguous-shell",
      subject: "WK-1437#SLICE-007",
      role: "worker",
      status: "completed",
      command: {
        display: "bash -lc 'workspace_work_record_validate WK-1437 --token=SHOULD_NOT_LEAK'"
      }
    });
    await writeText(
      path.join(runDir, "stderr-ambiguous.txt"),
      [
        "bash -lc 'workspace_work_record_validate WK-1437'",
        "workspace_tool_usage_audit --full",
        "shell-like evidence without an exec marker or operator-authored entrypoint"
      ].join("\n")
    );

    const baseline = await extractHistoricalToolUseBaseline({ rootDir, agentRunsDir: ".agent-runs" });

    assert.equal(
      baseline.facts.some((fact) => fact.source_kind === "live_mcp_tool_event"),
      false,
      "ambiguous local shell text must not be counted as live MCP evidence"
    );
    assert.equal(
      baseline.facts.some(
        (fact) =>
          fact.fact_kind === "event" &&
          ["operator_shell_command", "launcher_owned_command"].includes(fact.source_kind)
      ),
      false,
      "shell-like metadata without provenance must not become confirmed operator or launcher evidence"
    );
    assert.equal(
      baseline.facts.some(
        (fact) => fact.fact_kind === "event" && fact.transport_kind === "agent_raw_shell_command"
      ),
      false,
      "stderr shell-like text without agent transcript markers must not become confirmed agent raw shell evidence"
    );

    const unsupportedMcpGap = findFact(
      baseline.facts,
      (fact) =>
        fact.fact_kind === "unsupported_gap" &&
        fact.transport_kind === "unsupported_gap" &&
        fact.confidence === "none" &&
        fact.unsupported_gap_code === "historical_gap_mcp_specific_misuse_without_structured_mcp_transcript",
      "ambiguous shell unsupported MCP gap"
    );
    assert.equal(unsupportedMcpGap.evidence_basis, "no_structured_mcp_transcript");

    const serialized = JSON.stringify(baseline);
    assert.equal(serialized.includes("SHOULD_NOT_LEAK"), false);
    assert.equal(serialized.includes("workspace_work_record_validate WK-1437 --token"), false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
