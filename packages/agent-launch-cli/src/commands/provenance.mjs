import { createHash } from "node:crypto";

import { inspectAgentRunProvenance } from "@agent-chassis/agent-launch-core";
import { canonicalizeJson } from "@agent-chassis/agent-launch-core/src/lib/role-guard.mjs";
import { parseArgs } from "../lib/cli.mjs";

export const IDENTITY_MINT_EVIDENCE_REQUIRED_FIELDS = Object.freeze([
  "handshake_nonce",
  "workspace_alias",
  "minted_at_monotonic_ms",
  "expires_at_monotonic_ms",
  "key_id"
]);

export const IDENTITY_MINT_EVIDENCE_DIGEST_REFUSAL_REASON =
  "identity mint_evidence is required and must be a non-null object containing handshake_nonce, workspace_alias, minted_at_monotonic_ms, expires_at_monotonic_ms, and key_id";

export function computeIdentityMintEvidenceDigest(mintEvidence) {
  if (
    mintEvidence === null
    || mintEvidence === undefined
    || typeof mintEvidence !== "object"
    || Array.isArray(mintEvidence)
  ) {
    return { ok: false, reason: IDENTITY_MINT_EVIDENCE_DIGEST_REFUSAL_REASON };
  }
  for (const field of IDENTITY_MINT_EVIDENCE_REQUIRED_FIELDS) {
    if (
      !Object.prototype.hasOwnProperty.call(mintEvidence, field)
      || mintEvidence[field] === null
      || mintEvidence[field] === undefined
      || mintEvidence[field] === ""
    ) {
      return {
        ok: false,
        reason: `${IDENTITY_MINT_EVIDENCE_DIGEST_REFUSAL_REASON} (missing field: ${field})`
      };
    }
  }
  const canonical = canonicalizeJson(mintEvidence);
  const hex = createHash("sha256").update(canonical).digest("hex");
  return { ok: true, digest: `sha256:${hex}` };
}

const HELP_TEXT = `agent-launch provenance <run_dir|provenance_path> [--json] [--tail-lines <N>]

Inspect a direct-wrapper or reviewed-launcher provenance artifact.

Options:
  --json    Emit machine-readable output
  --tail-lines <N>
            Include bounded response/stdout/stderr tail snapshots from runtime evidence only.

Tail snapshots are runtime evidence only and must not be copied wholesale into canonical WK records.
`;

export async function runProvenance(argv) {
  if (argv.some((token) => token === "--help" || token === "-h")) {
    console.log(HELP_TEXT);
    return;
  }

  const { positionals, options } = parseArgs(argv);
  const targetPath = positionals[0];
  const requestedTailLines = normalizeTailLineCount(options["tail-lines"]);

  const result = await inspectAgentRunProvenance(
    targetPath
      ? { runDir: targetPath, tailLines: requestedTailLines }
      : { tailLines: requestedTailLines }
  );
  const output = buildOutput(result, targetPath ?? null);

  if (booleanFlag(options, "json")) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    writeTextOutput(output, requestedTailLines);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

function booleanFlag(options, name) {
  const value = options[name];
  if (value === undefined) {
    return false;
  }
  if (value === true) {
    return true;
  }
  const normalized = String(value).trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(normalized);
}

function buildOutput(result, inputPath) {
  return {
    ok: result.ok,
    input_path: inputPath,
    diagnostics: result.diagnostics,
    provenance: result.ok ? result.value : null
  };
}

function writeTextOutput(output, requestedTailLines) {
  if (!output.ok) {
    console.log(`Provenance inspection failed${output.input_path ? `: ${output.input_path}` : ""}`);
    for (const diagnostic of output.diagnostics ?? []) {
      const details = [];
      for (const [key, value] of Object.entries(diagnostic)) {
        if (key === "code" || key === "message") {
          continue;
        }
        details.push(`${key}=${formatValue(value)}`);
      }
      const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
      console.log(`- ${diagnostic.code}: ${diagnostic.message}${suffix}`);
    }
    return;
  }

  const provenance = output.provenance;
  console.log(`Provenance: ${provenance.provenance_path}`);
  console.log(`Run: ${provenance.run_id}`);
  console.log(`Status: ${provenance.terminal_status}`);
  console.log(`Role: ${provenance.role}`);
  console.log(`Subject: ${formatValue(provenance.subject)}`);
  console.log(`Started: ${provenance.started_at}`);
  console.log(`Completed: ${provenance.completed_at}`);
  console.log(`Run dir: ${provenance.run_dir}`);
  console.log(`Response digest: ${provenance.response_digest}`);
  console.log(`Response artifact: ${formatArtifactLine(provenance.artifacts?.[provenance.response_artifact_key])}`);
  console.log(`Heartbeat: ${formatHeartbeatFreshness(provenance.heartbeat_freshness)}`);
  console.log(`Validation summaries: ${formatValidationSummaries(provenance.validation_summaries)}`);
  console.log("Artifacts:");
  for (const [name, artifact] of Object.entries(provenance.artifacts ?? {})) {
    console.log(`- ${name}: ${formatArtifactLine(artifact)}`);
  }

  if (requestedTailLines > 0) {
    console.log(`Tail lines requested: ${requestedTailLines}`);
    for (const [name, snapshot] of Object.entries(provenance.artifact_tails ?? {})) {
      writeArtifactTailSection(name, snapshot);
    }
  }
}

function formatHeartbeatFreshness(heartbeat) {
  if (!heartbeat || typeof heartbeat !== "object") {
    return "unavailable";
  }
  if (!heartbeat.available) {
    return "unavailable";
  }
  const freshness = heartbeat.stale ? "stale" : heartbeat.fresh ? "fresh" : "unknown";
  return [
    freshness,
    `source=${formatValue(heartbeat.source)}`,
    `observed_at=${formatValue(heartbeat.observed_at)}`,
    `age_ms=${formatValue(heartbeat.age_ms)}`,
    `threshold_ms=${formatValue(heartbeat.threshold_ms)}`
  ].join(" ");
}

function formatArtifactLine(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return "unavailable";
  }

  const parts = [];
  parts.push(formatValue(artifact.path));
  parts.push(artifact.exists ? "exists=true" : "exists=false");

  if (artifact.byte_count !== undefined) {
    parts.push(`bytes=${formatValue(artifact.byte_count)}`);
  }
  if (artifact.sha256) {
    parts.push(`sha256=${formatValue(artifact.sha256)}`);
  }
  if (artifact.media_kind) {
    parts.push(`media=${formatValue(artifact.media_kind)}`);
  }
  if (artifact.sensitivity_class) {
    parts.push(`sensitivity=${formatValue(artifact.sensitivity_class)}`);
  }

  return parts.join(" ");
}

function formatValidationSummaries(validationSummaries) {
  if (!Array.isArray(validationSummaries) || validationSummaries.length === 0) {
    return "none";
  }
  return validationSummaries
    .map((summary) => (typeof summary === "string" ? summary : JSON.stringify(summary)))
    .join("; ");
}

function formatValue(value) {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function normalizeTailLineCount(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

function writeArtifactTailSection(name, snapshot) {
  const title = `${name.charAt(0).toUpperCase()}${name.slice(1)} tail`;
  console.log(`${title}:`);
  console.log(`  artifact: ${formatValue(snapshot?.artifact_key)}`);
  console.log(`  path: ${formatValue(snapshot?.path)}`);
  console.log(`  exists: ${snapshot?.exists === true}`);
  console.log(`  bytes: ${formatValue(snapshot?.byte_count)}`);
  console.log(`  requested_lines: ${formatValue(snapshot?.requested_line_count)}`);
  console.log(`  tail_lines: ${formatValue(snapshot?.tail_line_count)}`);
  console.log(`  truncated: ${snapshot?.truncated === true}`);
  console.log(`  media: ${formatValue(snapshot?.media_kind)}`);
  console.log(`  sensitivity: ${formatValue(snapshot?.sensitivity_class)}`);
  if (snapshot?.read_error) {
    console.log(`  read_error: ${formatValue(snapshot.read_error)}`);
  }
  const contentTail = Array.isArray(snapshot?.content_tail) ? snapshot.content_tail : [];
  if (contentTail.length === 0) {
    console.log("  content: (none)");
    return;
  }
  console.log("  content:");
  for (const [index, line] of contentTail.entries()) {
    console.log(`    ${index + 1}: ${line}`);
  }
}
