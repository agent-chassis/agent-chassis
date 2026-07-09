import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  CONFIDENCE_LEVELS,
  HISTORICAL_BASELINE_SCHEMA_VERSION,
  MAX_FACTS_DEFAULT,
  MAX_FILE_BYTES_DEFAULT,
  MAX_FILES_DEFAULT,
  MAX_JSONL_LINES,
  MAX_KEYS,
  MAX_TEXT_LINES,
  SOURCE_KINDS,
  TOOL_USAGE_AUDIT_SCHEMA_VERSION,
  TRANSPORT_KINDS,
  UNSUPPORTED_HISTORICAL_MCP_GAP_CODES,
  confidenceEnvelope,
  hasOwn,
  isPlainObject,
  normalizeAuditFact,
  normalizeString,
  normalizeToolName,
  summarizeFacts
} from "./tool-usage-audit/core.mjs";
import {
  artifactDescriptor,
  redactPath,
  redactPayload,
  redactSubject,
  redactText,
  sha256Buffer,
  sha256Text
} from "./tool-usage-audit/redaction.mjs";

export {
  CONFIDENCE_LEVELS,
  HISTORICAL_BASELINE_SCHEMA_VERSION,
  SOURCE_KINDS,
  TOOL_USAGE_AUDIT_SCHEMA_VERSION,
  TRANSPORT_KINDS,
  UNSUPPORTED_HISTORICAL_MCP_GAP_CODES,
  confidenceEnvelope,
  normalizeAuditFact,
  redactPath,
  sha256Buffer,
  sha256Text
};

const fact = normalizeAuditFact;

function pickFirstString(object, keys) {
  if (!isPlainObject(object)) return null;
  for (const key of keys) {
    const value = normalizeString(object[key]);
    if (value) return value;
  }
  return null;
}

function runIdentityFromObject(object) {
  const runId = pickFirstString(object, ["run_id", "runId", "id"]);
  const subject = pickFirstString(object, ["subject"]);
  const role = pickFirstString(object, ["role", "mode"]);
  const agent = pickFirstString(object, ["agent", "selected_agent"]);
  return {
    ...(runId ? { run_id_digest: sha256Text(runId) } : {}),
    ...(subject ? { subject: redactSubject(subject) } : {}),
    ...(role ? { role: role.slice(0, 64) } : {}),
    ...(agent ? { agent: agent.slice(0, 64) } : {})
  };
}

function structuredProvenanceText(object) {
  if (!isPlainObject(object)) return "";
  const fields = [
    object.schema_version,
    object.schemaVersion,
    object.source,
    object.source_kind,
    object.sourceKind,
    object.provider,
    object.runtime,
    object.runner,
    object.session_kind,
    object.sessionKind,
    object.trajectory_kind,
    object.trajectoryKind,
    object.format,
    object.type,
    object.kind,
    object.event
  ];
  const nested = object.metadata ?? object.meta ?? object.provenance ?? object.run ?? object.session ?? object.trajectory;
  if (isPlainObject(nested)) {
    fields.push(
      nested.schema_version,
      nested.schemaVersion,
      nested.source,
      nested.source_kind,
      nested.sourceKind,
      nested.provider,
      nested.runtime,
      nested.runner,
      nested.session_kind,
      nested.sessionKind,
      nested.trajectory_kind,
      nested.trajectoryKind,
      nested.format
    );
  }
  const payload = object.payload;
  if (isPlainObject(payload)) {
    fields.push(
      payload.schema_version,
      payload.schemaVersion,
      payload.source,
      payload.source_kind,
      payload.sourceKind,
      payload.provider,
      payload.runtime,
      payload.runner,
      payload.session_kind,
      payload.sessionKind,
      payload.trajectory_kind,
      payload.trajectoryKind,
      payload.format,
      payload.type,
      payload.kind,
      payload.event
    );
  }
  return fields
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function structuredEvidenceForPath(_filePath, parsed) {
  const schema = String(parsed?.schema_version ?? parsed?.schemaVersion ?? "").toLowerCase();
  const provenance = structuredProvenanceText(parsed);
  if (
    (/\b(?:deepswe|codex)\b/.test(schema) && schema.includes("trajectory")) ||
    /\b(?:deepswe|codex)[-_ ]?trajectory\b/.test(provenance)
  ) {
    return {
      source_kind: "historical_deepswe_trajectory",
      transport_kind: "historical_deepswe_trajectory",
      confidence: "high",
      evidence_basis: "structured_deepswe_or_codex_tool_event"
    };
  }
  if (schema.includes("deepswe") || schema.includes("codex") || /(?:deepswe|codex)-?session/.test(schema)) {
    return {
      source_kind: "historical_deepswe_session_jsonl",
      transport_kind: "historical_deepswe_session_jsonl",
      confidence: "high",
      evidence_basis: "structured_deepswe_or_codex_tool_event"
    };
  }
  if (/\b(?:deepswe|codex)\b/.test(provenance) && /\b(?:session|jsonl|tool|event|trajectory)\b/.test(provenance)) {
    return {
      source_kind: provenance.includes("trajectory")
        ? "historical_deepswe_trajectory"
        : "historical_deepswe_session_jsonl",
      transport_kind: provenance.includes("trajectory")
        ? "historical_deepswe_trajectory"
        : "historical_deepswe_session_jsonl",
      confidence: "high",
      evidence_basis: "structured_deepswe_or_codex_tool_event"
    };
  }
  if (schema === "agent-run-provenance.v1") {
    return {
      source_kind: "historical_launcher_metadata",
      transport_kind: "historical_launcher_metadata",
      confidence: "medium",
      evidence_basis: "historical_structured_tool_event_payload"
    };
  }
  return {
    source_kind: "historical_launcher_metadata",
    transport_kind: "unsupported_gap",
    confidence: "low",
    evidence_basis: "ambiguous_structured_tool_event_provenance",
    unsupported_gap_code: "historical_gap_mcp_specific_misuse_without_structured_mcp_transcript"
  };
}

function structuredEventPayloadCandidates(event) {
  if (!isPlainObject(event)) return [];
  const candidates = [event];
  for (const key of ["payload", "data"]) {
    const nested = event[key];
    if (isPlainObject(nested)) candidates.push(nested);
  }
  return candidates;
}

function nestedToolCallObject(event) {
  if (!isPlainObject(event)) return null;
  const nested = event.tool_call ?? event.toolCall ?? event.call ?? event.action;
  return isPlainObject(nested) ? nested : null;
}

function extractToolNameFromStructuredEvent(event) {
  for (const candidate of structuredEventPayloadCandidates(event)) {
    const direct = pickFirstString(candidate, ["tool_name", "toolName", "tool", "name", "function"]);
    if (direct) return normalizeToolName(direct);
    const nested = nestedToolCallObject(candidate);
    if (nested) {
      const nestedName = normalizeToolName(
        pickFirstString(nested, ["tool_name", "toolName", "tool", "name", "function"])
      );
      if (nestedName) return nestedName;
    }
  }
  return null;
}

function normalizedStructuredToolEvent(event) {
  for (const candidate of structuredEventPayloadCandidates(event)) {
    const direct = pickFirstString(candidate, ["tool_name", "toolName", "tool", "name", "function"]);
    if (direct) return candidate;
    const nested = nestedToolCallObject(candidate);
    if (nested && pickFirstString(nested, ["tool_name", "toolName", "tool", "name", "function"])) {
      return candidate;
    }
    const type = pickFirstString(candidate, ["type", "event", "kind"]);
    if (type && /tool|function_call|action/.test(type)) return candidate;
  }
  return isPlainObject(event) ? event : null;
}

function extractArgsFromStructuredEvent(event) {
  const normalized = normalizedStructuredToolEvent(event);
  if (!normalized) return undefined;
  if (hasOwn(normalized, "args")) return normalized.args;
  if (hasOwn(normalized, "arguments")) return normalized.arguments;
  if (hasOwn(normalized, "input")) return normalized.input;
  const nested = nestedToolCallObject(normalized);
  if (isPlainObject(nested)) return nested.args ?? nested.arguments ?? nested.input;
  return undefined;
}

function extractResultFromStructuredEvent(event) {
  const normalized = normalizedStructuredToolEvent(event);
  if (!normalized) return undefined;
  if (hasOwn(normalized, "result")) return normalized.result;
  if (hasOwn(normalized, "output")) return normalized.output;
  if (hasOwn(normalized, "response")) return normalized.response;
  const nested = normalized.tool_result ?? normalized.toolResult ?? normalized.observation;
  return nested;
}

function isStructuredToolEvent(event) {
  if (!isPlainObject(event)) return false;
  if (extractToolNameFromStructuredEvent(event)) return true;
  const normalized = normalizedStructuredToolEvent(event);
  const type = pickFirstString(normalized, ["type", "event", "kind"]);
  return Boolean(type && /tool|function_call|action/.test(type));
}

function classifyCommandProvenance({ launcherOwned = false, operatorAuthored = false, agentTranscript = false }) {
  if (launcherOwned) {
    return {
      transport_kind: "launcher_owned_command",
      confidence: "medium",
      evidence_basis: "structured_launcher_provenance"
    };
  }
  if (operatorAuthored) {
    return {
      transport_kind: "operator_shell_command",
      confidence: "medium",
      evidence_basis: "operator_authored_artifact_or_entrypoint"
    };
  }
  if (agentTranscript) {
    return {
      transport_kind: "agent_raw_shell_command",
      confidence: "medium",
      evidence_basis: "agent_transcript_or_stderr_shell_event"
    };
  }
  return {
    transport_kind: "agent_raw_shell_command",
    confidence: "low",
    evidence_basis: "ambiguous_shell_evidence",
    unsupported_gap_code: "historical_gap_ambiguous_shell_provenance"
  };
}

function classifyLauncherCommandFromObject(object) {
  const command = isPlainObject(object.command) ? object.command : isPlainObject(object.commandMetadata) ? object.commandMetadata : null;
  if (!command) return null;
  const allowlistedRoute = pickFirstString(command, ["allowlisted_route", "allowlistedRoute", "launcherRoute", "route"]);
  if (allowlistedRoute) {
    return { ...classifyCommandProvenance({ launcherOwned: true }), command_name: normalizeToolName(allowlistedRoute) };
  }
  if (normalizeString(command.operatorCommand) || command.source === "cli") {
    return {
      ...classifyCommandProvenance({ operatorAuthored: true }),
      command_name: normalizeToolName(pickFirstString(object, ["tool"]) ?? "operator_shell_command"),
      command_text: redactText(command.operatorCommand ?? command.display ?? command.containerDisplay ?? "")
    };
  }
  return null;
}

function parseJsonLines(text) {
  const events = [];
  const lines = text.split(/\r?\n/).slice(0, MAX_JSONL_LINES);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push({ line: index + 1, value: JSON.parse(trimmed) });
    } catch {
      events.push({ line: index + 1, parse_error: true, digest: sha256Text(trimmed) });
    }
  }
  return events;
}

function extractShellEventsFromStderr(text) {
  const facts = [];
  const lines = text.split(/\r?\n/).slice(0, MAX_TEXT_LINES);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^exec$/i.test(line.trim())) {
      const next = normalizeString(lines[index + 1]);
      if (next) {
        facts.push({
          line: index + 2,
          source_kind: "historical_codex_stderr_shell",
          command_name: normalizeToolName(next.split(/\s+/)[0] ?? "shell"),
          command_text: redactText(next),
          ...classifyCommandProvenance({ agentTranscript: true })
        });
      }
    }
    if (/apply_patch|^\*\*\* Begin Patch/.test(line)) {
      facts.push({
        line: index + 1,
        source_kind: "historical_apply_patch_text",
        transport_kind: "historical_apply_patch_text",
        command_name: "apply_patch",
        command_text: redactText(line),
        confidence: "medium",
        evidence_basis: "agent_transcript_or_stderr_apply_patch_text"
      });
    }
  }
  return facts;
}

function reviewContextCategory(sourcePath) {
  const value = String(sourcePath);
  if (/^docs\//.test(value)) return "docs";
  if (/^wiki\/work-records\//.test(value)) return "work_record";
  if (/^wiki\/decisions\//.test(value)) return "decision";
  if (/^wiki\/initiatives\//.test(value)) return "initiative";
  if (/^wiki\//.test(value)) return "wiki";
  if (/^packages\//.test(value)) return "package_source";
  if (/^tests\//.test(value)) return "tests";
  if (/^internal\//.test(value)) return "internal";
  if (/^[A-Za-z0-9 _-]+$/.test(value)) return "internal";
  return "other";
}

async function statMaybe(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function readFileBounded(filePath, maxBytes) {
  const stats = await statMaybe(filePath);
  if (!stats?.isFile()) return null;
  if (stats.size > maxBytes) {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
      return { buffer: buffer.subarray(0, bytesRead), bytes: stats.size, truncated: true };
    } finally {
      await handle.close();
    }
  }
  const buffer = await readFile(filePath);
  return { buffer, bytes: stats.size, truncated: false };
}

async function walkFiles(rootDir, { maxFiles = MAX_FILES_DEFAULT } = {}) {
  const files = [];
  async function visit(dir) {
    if (files.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile()) {
        files.push(child);
      }
    }
  }
  await visit(rootDir);
  return files;
}

async function extractReviewContextFacts({ manifest, manifestPath, sourceArtifact, facts }) {
  const contextFiles = Array.isArray(manifest.context_files) ? manifest.context_files : [];
  if (contextFiles.length === 0) return;
  const runRoot = path.dirname(path.dirname(manifestPath));
  const categories = new Map();
  let byteCount = 0;
  let statCount = 0;
  for (const entry of contextFiles) {
    const category = reviewContextCategory(entry?.source_path ?? "");
    categories.set(category, (categories.get(category) ?? 0) + 1);
    const declaredBytes = Number.isFinite(entry?.bytes) ? entry.bytes : null;
    if (declaredBytes !== null) {
      byteCount += declaredBytes;
      statCount += 1;
      continue;
    }
    const snapshotPath = normalizeString(entry?.snapshot_path);
    if (snapshotPath) {
      const snapshotStats = await statMaybe(path.join(runRoot, snapshotPath));
      if (snapshotStats?.isFile()) {
        byteCount += snapshotStats.size;
        statCount += 1;
      }
    }
  }
  facts.push(
    fact(
      {
        fact_kind: "baseline",
        source_kind: "historical_review_context_bundle",
        transport_kind: "historical_review_context_bundle",
        run: runIdentityFromObject(manifest),
        review_context_bundle: {
          file_count: contextFiles.length,
          byte_count: byteCount,
          byte_count_file_count: statCount,
          path_categories: Object.fromEntries([...categories.entries()].sort(([a], [b]) => a.localeCompare(b)))
        }
      },
      confidenceEnvelope({
        confidence: "high",
        evidence_basis: "review_bundle_manifest_or_context_stat",
        sourceArtifact
      })
    )
  );
  facts.push(
    fact(
      {
        fact_kind: "unsupported_gap",
        source_kind: "historical_review_context_bundle",
        transport_kind: "unsupported_gap",
        run: runIdentityFromObject(manifest),
        question: "semantic_reason_context_was_included"
      },
      confidenceEnvelope({
        confidence: "none",
        evidence_basis: "no_structured_context_inclusion_provenance",
        unsupported_gap_code: "historical_gap_review_context_semantic_inclusion_reason",
        sourceArtifact
      })
    )
  );
}

function appendUnsupportedMcpGapFacts({
  facts,
  sourceArtifact,
  run = {},
  source_kind = "historical_launcher_metadata",
  evidence_basis = "no_structured_mcp_transcript"
}) {
  for (const gapCode of UNSUPPORTED_HISTORICAL_MCP_GAP_CODES) {
    facts.push(
      fact(
        {
          fact_kind: "unsupported_gap",
          source_kind,
          transport_kind: "unsupported_gap",
          run,
          question: gapCode
        },
        confidenceEnvelope({
          confidence: "none",
          evidence_basis,
          unsupported_gap_code: gapCode,
          sourceArtifact
        })
      )
    );
  }
}

async function extractJsonArtifactFacts({ filePath, text, sourceArtifact, facts }) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return;
  }
  const schema = normalizeString(parsed.schema_version ?? parsed.schemaVersion);
  const basename = path.basename(filePath);
  if (basename === "input-manifest.json") {
    await extractReviewContextFacts({ manifest: parsed, manifestPath: filePath, sourceArtifact, facts });
  }
  if (
    basename === "meta.json" ||
    basename === "state.json" ||
    basename === "run.json" ||
    schema === "agent-run-provenance.v1" ||
    schema === "deepswe.container-runner.run.v1"
  ) {
    const run = runIdentityFromObject(parsed);
    facts.push(
      fact(
        {
          fact_kind: "run",
          source_kind: "historical_launcher_metadata",
          transport_kind: "historical_launcher_metadata",
          run,
          launcher_metadata: {
            schema_version: schema ?? null,
            status: pickFirstString(parsed, ["status"]) ?? pickFirstString(parsed.result, ["kind"]) ?? null,
            started_at_present: Boolean(parsed.started_at ?? parsed.startedAt),
            completed_at_present: Boolean(parsed.completed_at ?? parsed.completedAt ?? parsed.endedAt),
            artifact_keys: isPlainObject(parsed.artifacts) ? Object.keys(parsed.artifacts).sort().slice(0, MAX_KEYS) : []
          }
        },
        confidenceEnvelope({
          confidence: "medium",
          evidence_basis: "historical_launcher_metadata",
          sourceArtifact
        })
      )
    );
    appendUnsupportedMcpGapFacts({ facts, sourceArtifact, run });
    const commandClassification = classifyLauncherCommandFromObject(parsed);
    if (commandClassification) {
      facts.push(
        fact(
          {
            fact_kind: "event",
            source_kind: commandClassification.transport_kind,
            transport_kind: commandClassification.transport_kind,
            run,
            event: {
              event_type: "command",
              command_name: commandClassification.command_name ?? null,
              command_text: commandClassification.command_text ?? null
            }
          },
          confidenceEnvelope({
            confidence: commandClassification.confidence,
            evidence_basis: commandClassification.evidence_basis,
            unsupported_gap_code: commandClassification.unsupported_gap_code,
            sourceArtifact
          })
        )
      );
    }
  }
  const structuredEvents = Array.isArray(parsed.tool_events) ? parsed.tool_events : [];
  for (const [index, event] of structuredEvents.entries()) {
    const evidence = structuredEvidenceForPath(filePath, parsed);
    appendStructuredToolEventFact({
      facts,
      sourceArtifact,
      source_kind: evidence.source_kind,
      transport_kind: evidence.transport_kind,
      confidence: evidence.confidence,
      evidence_basis: evidence.evidence_basis,
      unsupported_gap_code: evidence.unsupported_gap_code,
      event,
      line: index + 1,
      run: runIdentityFromObject(parsed)
    });
  }
}

function appendStructuredToolEventFact({
  facts,
  sourceArtifact,
  source_kind,
  transport_kind = source_kind,
  confidence = "high",
  evidence_basis = "structured_deepswe_or_codex_tool_event",
  unsupported_gap_code = undefined,
  event,
  line,
  run = {}
}) {
  if (!isStructuredToolEvent(event)) return;
  const toolName = extractToolNameFromStructuredEvent(event) ?? "unknown_tool";
  facts.push(
    fact(
      {
        fact_kind: "event",
        source_kind,
        transport_kind,
        run,
        event: {
          event_type: "tool_call",
          line,
          tool_name: toolName,
          args: redactPayload(extractArgsFromStructuredEvent(event)),
          result: redactPayload(extractResultFromStructuredEvent(event))
        }
      },
      confidenceEnvelope({
        confidence,
        evidence_basis,
        unsupported_gap_code,
        sourceArtifact
      })
    )
  );
}

async function extractJsonlArtifactFacts({ filePath, text, sourceArtifact, facts }) {
  let gapSourceKind = null;
  let gapRun = {};
  let sawParsedEvent = false;
  for (const event of parseJsonLines(text)) {
    if (event.parse_error) continue;
    sawParsedEvent = true;
    const evidence = structuredEvidenceForPath(filePath, event.value);
    gapSourceKind ??= evidence.source_kind;
    if (Object.keys(gapRun).length === 0) gapRun = runIdentityFromObject(event.value);
    appendStructuredToolEventFact({
      facts,
      sourceArtifact,
      source_kind: evidence.source_kind,
      transport_kind: evidence.transport_kind,
      confidence: evidence.confidence,
      evidence_basis: evidence.evidence_basis,
      unsupported_gap_code: evidence.unsupported_gap_code,
      event: event.value,
      line: event.line,
      run: runIdentityFromObject(event.value)
    });
  }
  if (sawParsedEvent) {
    appendUnsupportedMcpGapFacts({
      facts,
      sourceArtifact,
      run: gapRun,
      source_kind: gapSourceKind ?? "historical_deepswe_session_jsonl",
      evidence_basis: "historical_jsonl_without_structured_mcp_transcript"
    });
  }
}

function extractStderrArtifactFacts({ text, sourceArtifact, facts }) {
  let sawShellEvidence = false;
  for (const shellEvent of extractShellEventsFromStderr(text)) {
    sawShellEvidence = true;
    facts.push(
      fact(
        {
          fact_kind: "event",
          source_kind: shellEvent.source_kind,
          transport_kind: shellEvent.transport_kind,
          event: {
            event_type: shellEvent.command_name === "apply_patch" ? "apply_patch" : "command",
            line: shellEvent.line,
            command_name: shellEvent.command_name,
            command_text: shellEvent.command_text
          }
        },
        confidenceEnvelope({
          confidence: shellEvent.confidence,
          evidence_basis: shellEvent.evidence_basis,
          unsupported_gap_code: shellEvent.unsupported_gap_code,
          sourceArtifact
        })
      )
    );
  }
  if (sawShellEvidence) {
    appendUnsupportedMcpGapFacts({
      facts,
      sourceArtifact,
      source_kind: "historical_codex_stderr_shell",
      evidence_basis: "historical_stderr_without_structured_mcp_transcript"
    });
  }
}

export async function extractHistoricalToolUseBaseline(options = {}) {
  const {
    agentRunsDir = ".agent-runs",
    rootDir = process.cwd(),
    maxFiles = MAX_FILES_DEFAULT,
    maxFileBytes = MAX_FILE_BYTES_DEFAULT,
    maxFacts = MAX_FACTS_DEFAULT
  } = options;
  const resolvedAgentRunsDir = path.resolve(rootDir, agentRunsDir);
  const files = await walkFiles(resolvedAgentRunsDir, { maxFiles });
  const facts = [];
  for (const filePath of files) {
    if (facts.length >= maxFacts) break;
    const basename = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();
    const relevant =
      ext === ".jsonl" ||
      basename === "meta.json" ||
      basename === "state.json" ||
      basename === "run.json" ||
      basename === "input-manifest.json" ||
      basename === "provenance.json" ||
      basename.includes("stderr") ||
      basename.includes("trajectory") ||
      basename.includes("session");
    if (!relevant) continue;
    const read = await readFileBounded(filePath, maxFileBytes);
    if (!read) continue;
    const sourceArtifact = {
      ...artifactDescriptor(filePath, read.buffer),
      byte_count: read.bytes,
      truncated: read.truncated
    };
    const text = read.buffer.toString("utf8");
    if (ext === ".jsonl") {
      await extractJsonlArtifactFacts({ filePath, text, sourceArtifact, facts });
    } else if (ext === ".json") {
      await extractJsonArtifactFacts({ filePath, text, sourceArtifact, facts });
    } else if (basename.includes("stderr")) {
      extractStderrArtifactFacts({ text, sourceArtifact, facts });
    }
  }
  const boundedFacts = facts.slice(0, maxFacts);
  return {
    schema_version: HISTORICAL_BASELINE_SCHEMA_VERSION,
    source_root: redactPath(resolvedAgentRunsDir),
    extraction: {
      read_only: true,
      treats_agent_runs_as_canonical: false,
      max_files: maxFiles,
      max_file_bytes: maxFileBytes,
      max_facts: maxFacts,
      files_considered: files.length,
      facts_truncated: facts.length > boundedFacts.length
    },
    closed_taxonomy: {
      source_kinds: [...SOURCE_KINDS],
      transport_kinds: [...TRANSPORT_KINDS],
      confidence_levels: [...CONFIDENCE_LEVELS]
    },
    summary: summarizeFacts(boundedFacts),
    facts: boundedFacts
  };
}

export function createUnsupportedHistoricalMcpGapFacts({ sourceArtifact = null, run = {} } = {}) {
  const facts = [];
  appendUnsupportedMcpGapFacts({
    facts,
    sourceArtifact: sourceArtifact ?? {
      path_category: "unsupported_gap_no_artifact",
      path_digest: sha256Text("unsupported_gap_no_artifact"),
      digest: sha256Text("unsupported_gap_no_artifact")
    },
    run
  });
  return facts;
}
