import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CONFIDENCE_LEVELS,
  SOURCE_KINDS,
  TOOL_USAGE_AUDIT_SCHEMA_VERSION,
  TRANSPORT_KINDS,
  UNSUPPORTED_GAP_CODES,
  confidenceEnvelope,
  normalizeAuditFact,
  validateEvidenceEnvelope
} from "../packages/wiki-mcp/src/lib/tool-usage-audit/core.mjs";
import {
  artifactDescriptor,
  redactPath,
  redactPayload,
  redactText,
  sha256Text
} from "../packages/wiki-mcp/src/lib/tool-usage-audit/redaction.mjs";
import {
  CONFIDENCE_LEVELS as FACADE_CONFIDENCE_LEVELS,
  SOURCE_KINDS as FACADE_SOURCE_KINDS,
  TRANSPORT_KINDS as FACADE_TRANSPORT_KINDS,
  createUnsupportedHistoricalMcpGapFacts,
  extractHistoricalToolUseBaseline,
  sha256Buffer as facadeSha256Buffer
} from "../packages/wiki-mcp/src/lib/tool-usage-audit.mjs";

const SOURCE_ARTIFACT = Object.freeze({
  path_category: "agent_runs_artifact",
  path_digest: sha256Text(".agent-runs/run-001/meta.json"),
  digest: sha256Text("artifact")
});

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("core module exposes closed audit schema vocabularies", () => {
  assert.deepEqual(CONFIDENCE_LEVELS, ["high", "medium", "low", "none"]);
  assert.ok(SOURCE_KINDS.includes("live_mcp_tool_event"));
  assert.ok(SOURCE_KINDS.includes("agent_raw_shell_command"));
  assert.ok(TRANSPORT_KINDS.includes("unsupported_gap"));
  assert.ok(UNSUPPORTED_GAP_CODES.includes("historical_gap_mcp_specific_misuse_without_structured_mcp_transcript"));
  assert.ok(UNSUPPORTED_GAP_CODES.includes("historical_gap_review_context_semantic_inclusion_reason"));
  assert.deepEqual(FACADE_CONFIDENCE_LEVELS, CONFIDENCE_LEVELS);
  assert.deepEqual(FACADE_SOURCE_KINDS, SOURCE_KINDS);
  assert.deepEqual(FACADE_TRANSPORT_KINDS, TRANSPORT_KINDS);
  assert.equal(facadeSha256Buffer(Buffer.from("facade parity")), sha256Text("facade parity"));
});

test("evidence envelope validation keeps low-confidence inference distinct from no-evidence gaps", () => {
  const low = confidenceEnvelope({
    confidence: "low",
    evidence_basis: "ambiguous_structured_tool_event_provenance",
    unsupported_gap_code: "historical_gap_mcp_specific_misuse_without_structured_mcp_transcript",
    sourceArtifact: SOURCE_ARTIFACT
  });
  assert.equal(low.confidence, "low");
  assert.equal(validateEvidenceEnvelope(low), true);

  const none = confidenceEnvelope({
    confidence: "none",
    evidence_basis: "no_structured_mcp_transcript",
    unsupported_gap_code: "historical_gap_mcp_specific_misuse_without_structured_mcp_transcript",
    sourceArtifact: SOURCE_ARTIFACT
  });
  assert.equal(none.confidence, "none");
  assert.notEqual(none.evidence_basis, low.evidence_basis);

  assert.throws(
    () =>
      confidenceEnvelope({
        confidence: "none",
        evidence_basis: "missing gap code",
        sourceArtifact: SOURCE_ARTIFACT
      }),
    /none confidence requires unsupported_gap_code/
  );
  assert.throws(
    () =>
      confidenceEnvelope({
        confidence: "certain",
        evidence_basis: "invalid",
        sourceArtifact: SOURCE_ARTIFACT
      }),
    /invalid tool-usage confidence/
  );
  assert.throws(
    () =>
      confidenceEnvelope({
        confidence: "low",
        evidence_basis: "invalid gap",
        unsupported_gap_code: "not_a_gap",
        sourceArtifact: SOURCE_ARTIFACT
      }),
    /invalid tool-usage unsupported_gap_code/
  );
});

test("normalized audit facts validate source and transport vocabularies", () => {
  const event = normalizeAuditFact(
    {
      fact_kind: "event",
      source_kind: "historical_deepswe_session_jsonl",
      transport_kind: "historical_deepswe_session_jsonl",
      event: {
        event_type: "tool_call",
        tool_name: "workspace_read_page"
      }
    },
    confidenceEnvelope({
      confidence: "high",
      evidence_basis: "structured_deepswe_or_codex_tool_event",
      sourceArtifact: SOURCE_ARTIFACT
    })
  );
  assert.equal(event.schema_version, TOOL_USAGE_AUDIT_SCHEMA_VERSION);
  assert.equal(event.confidence, "high");
  assert.equal(event.event.tool_name, "workspace_read_page");

  assert.throws(
    () =>
      normalizeAuditFact(
        { fact_kind: "event", source_kind: "made_up_source", transport_kind: "unsupported_gap" },
        confidenceEnvelope({
          confidence: "none",
          evidence_basis: "no evidence",
          unsupported_gap_code: "historical_gap_mcp_specific_misuse_without_structured_mcp_transcript",
          sourceArtifact: SOURCE_ARTIFACT
        })
      ),
    /invalid tool-usage source_kind/
  );
});

test("redaction preserves canonical identifiers and digests path-like or sensitive values", () => {
  const safeDocs = redactPath("docs/mcp-integration.md");
  assert.equal(safeDocs.path_category, "safe_repo_relative_canonical");
  assert.equal(safeDocs.path, "docs/mcp-integration.md");
  assert.equal(typeof safeDocs.path_digest, "string");

  for (const [rawPath, category] of [
    ["/home/user/.ssh/id_rsa", "home_path"],
    ["/tmp/session.env", "tmp_path"],
    ["/var/auth/token.env", "auth_or_secret_path"],
    ["/workspace/response-spill/full-output.txt", "response_or_log_artifact"],
    [".agent-runs/run-001/session.jsonl", "agent_runs_artifact"],
    ["packages/wiki-mcp/src/server.mjs", "repo_relative_noncanonical"]
  ]) {
    const redacted = redactPath(rawPath);
    assert.equal(redacted.path_category, category);
    assert.equal(redacted.path, undefined);
    assert.equal(typeof redacted.path_digest, "string");
  }

  const text = redactText("Use WK-1437#SLICE-002 with /home/user/.config/auth.json token=SHOULD_NOT_LEAK");
  assert.deepEqual(text.canonical_ids, ["WK-1437#SLICE-002"]);
  assert.equal(text.contains_secret_like_text, true);
  assert.equal(text.path_references[0].path, undefined);

  const payload = redactPayload({
    tool_name: "workspace_read_page",
    path: "wiki/work-records/WK-1437.json",
    prompt: "RAW_PROMPT_SHOULD_NOT_LEAK",
    token: "SECRET_VALUE_SHOULD_NOT_LEAK",
    output: "/home/user/private/output.txt"
  });
  assert.equal(payload.category, "object");
  assert.equal(payload.contains_sensitive_key, true);
  assert.equal(payload.path_reference_count >= 2, true);

  const descriptor = artifactDescriptor("/home/user/project/.agent-runs/run-001/meta.json", Buffer.from("artifact"));
  assert.equal(descriptor.path_category, "agent_runs_artifact");
  assert.equal(descriptor.path, undefined);
  assert.equal(descriptor.digest, sha256Text("artifact"));
});

test("facade keeps historical unsupported-gap API and baseline behavior after module split", async () => {
  const gapFacts = createUnsupportedHistoricalMcpGapFacts({ sourceArtifact: SOURCE_ARTIFACT });
  assert.equal(gapFacts.length > 0, true);
  assert.equal(gapFacts.every((fact) => fact.schema_version === TOOL_USAGE_AUDIT_SCHEMA_VERSION), true);
  assert.equal(gapFacts.every((fact) => fact.confidence === "none"), true);

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "tool-usage-audit-core-"));
  try {
    await writeJson(path.join(rootDir, ".agent-runs", "run-001", "meta.json"), {
      schema_version: "agent-run-provenance.v1",
      id: "run-001",
      subject: "WK-1437#SLICE-002",
      role: "worker",
      agent: "codex",
      status: "completed",
      command: {
        allowlisted_route: "workspace_work_record_validate"
      },
      tool_events: [
        {
          type: "tool_call",
          tool_name: "workspace_read_page",
          args: {
            path: "docs/mcp-integration.md",
            secret: "SHOULD_NOT_LEAK"
          },
          result: {
            output: "RAW_OUTPUT_SHOULD_NOT_LEAK"
          }
        }
      ]
    });

    const baseline = await extractHistoricalToolUseBaseline({ rootDir, agentRunsDir: ".agent-runs" });
    assert.equal(baseline.schema_version, "tool-usage-historical-baseline.v1");
    assert.deepEqual(baseline.closed_taxonomy.confidence_levels, CONFIDENCE_LEVELS);
    assert.equal(baseline.summary.by_source_kind.historical_launcher_metadata >= 1, true);
    assert.equal(baseline.summary.by_confidence.medium >= 1, true);
    assert.equal(baseline.facts.some((fact) => fact.event?.command_name === "workspace_work_record_validate"), true);
    const serialized = JSON.stringify(baseline);
    assert.equal(serialized.includes("SHOULD_NOT_LEAK"), false);
    assert.equal(serialized.includes("RAW_OUTPUT_SHOULD_NOT_LEAK"), false);
    assert.match(serialized, /"path":"docs\/mcp-integration\.md"/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
