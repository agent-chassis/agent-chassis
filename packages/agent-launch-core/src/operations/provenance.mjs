import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export const AGENT_RUN_PROVENANCE_SCHEMA_VERSION = "agent-run-provenance-inspection.v1";

export const AGENT_RUN_PROVENANCE_DIAGNOSTIC_CODES = Object.freeze([
  "invalid_provenance_input",
  "provenance_run_dir_missing",
  "provenance_run_dir_not_directory",
  "provenance_artifact_missing",
  "provenance_artifact_unreadable",
  "provenance_invalid_json",
  "provenance_unsupported_schema",
  "provenance_missing_required_field",
  "provenance_invalid_status",
  "provenance_non_terminal",
  "provenance_stale"
]);

const DEFAULT_HEARTBEAT_STALE_AFTER_MS = 10 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "rejected", "cancelled", "timed_out"]);
const NON_TERMINAL_STATUSES = new Set(["launching", "running", "in_progress"]);

function failure(code, message, extra = {}) {
  return {
    ok: false,
    diagnostics: [{ code, message, ...extra }]
  };
}

function success(value) {
  return {
    ok: true,
    value,
    diagnostics: []
  };
}

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isArtifactLike(value) {
  return isObject(value) && (
    "path" in value ||
    "exists" in value ||
    "byte_count" in value ||
    "sha256" in value ||
    "media_kind" in value ||
    "sensitivity_class" in value
  );
}

function guessMediaKind(filePath) {
  if (typeof filePath !== "string") {
    return "text/plain";
  }
  if (filePath.endsWith(".json")) {
    return "application/json";
  }
  if (filePath.endsWith(".md")) {
    return "text/markdown";
  }
  return "text/plain";
}

function guessSensitivityClass(filePath) {
  if (typeof filePath !== "string") {
    return "routine";
  }
  if (filePath.endsWith("stderr.log") || filePath.endsWith("stdout.log")) {
    return "sensitive";
  }
  return "routine";
}

function normalizeDigest(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  return String(value).startsWith("sha256:") ? String(value).slice("sha256:".length) : String(value);
}

function parseTimestamp(value) {
  if (!isNonEmptyString(value)) {
    return { ok: false, value: null };
  }
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) {
    return { ok: false, value: null };
  }
  return { ok: true, value: { at: value, epoch } };
}

async function inspectFileDescriptor(descriptor, {
  baseDir,
  label,
  required = false,
  mediaKind = null,
  sensitivityClass = null
}) {
  if (!isArtifactLike(descriptor)) {
    if (required) {
      return failure(
        "provenance_missing_required_field",
        `Missing required artifact descriptor for ${label}`,
        { path: label }
      );
    }
    return { ok: true, value: cloneJson(descriptor) };
  }

  const rawPath = descriptor.path;
  if (!isNonEmptyString(rawPath)) {
    if (required) {
      return failure(
        "provenance_missing_required_field",
        `Missing required artifact path for ${label}`,
        { path: label }
      );
    }
    return { ok: true, value: cloneJson(descriptor) };
  }

  const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(baseDir, rawPath);
  const normalized = {
    path: resolvedPath,
    exists: false,
    media_kind: descriptor.media_kind ?? mediaKind ?? guessMediaKind(resolvedPath),
    sensitivity_class: descriptor.sensitivity_class ?? sensitivityClass ?? guessSensitivityClass(resolvedPath)
  };

  try {
    const stats = await stat(resolvedPath);
    if (!stats.isFile()) {
      if (required) {
        return failure(
          "provenance_artifact_missing",
          `Expected file artifact for ${label}`,
          { path: resolvedPath, artifact: label }
        );
      }
      return { ok: true, value: normalized };
    }
    const bytes = await readFile(resolvedPath);
    normalized.exists = true;
    normalized.byte_count = stats.size;
    normalized.sha256 = createHash("sha256").update(bytes).digest("hex");
    return { ok: true, value: normalized };
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (required) {
        return failure(
          "provenance_artifact_missing",
          `Missing required artifact for ${label}`,
          { path: resolvedPath, artifact: label }
        );
      }
      return { ok: true, value: normalized };
    }
    return failure(
      "provenance_artifact_unreadable",
      `Unable to read artifact for ${label}`,
      { path: resolvedPath, artifact: label, cause: error?.message ?? String(error) }
    );
  }
}

async function normalizeSectionArtifacts(section, baseDir, keys) {
  if (!isObject(section)) {
    return { ok: true, value: section ?? null };
  }

  const normalized = {};
  for (const [key, value] of Object.entries(section)) {
    if (keys.has(key) && isArtifactLike(value)) {
      const inspected = await inspectFileDescriptor(value, {
        baseDir,
        label: key,
        required: false
      });
      if (!inspected.ok) {
        return inspected;
      }
      normalized[key] = inspected.value;
      continue;
    }
    normalized[key] = cloneJson(value);
  }

  return { ok: true, value: normalized };
}

function normalizeValidationSummaries(provenance) {
  const candidates = [
    provenance.validation_summaries,
    provenance.validation_summary,
    provenance.validation
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return cloneJson(candidate);
    }
    if (isObject(candidate)) {
      return [cloneJson(candidate)];
    }
  }

  return null;
}

async function deriveHeartbeatFreshness(provenance, normalizedArtifacts, nowMs, staleAfterMs) {
  const runtime = isObject(provenance.runtime) ? provenance.runtime : {};
  const candidates = [];

  if (Array.isArray(runtime.heartbeat_timeline) && runtime.heartbeat_timeline.length > 0) {
    const lastEntry = runtime.heartbeat_timeline[runtime.heartbeat_timeline.length - 1];
    if (isObject(lastEntry) && isNonEmptyString(lastEntry.at)) {
      candidates.push({ source: "runtime.heartbeat_timeline", at: lastEntry.at });
    }
  }

  if (isNonEmptyString(runtime.heartbeat_at)) {
    candidates.push({ source: "runtime.heartbeat_at", at: runtime.heartbeat_at });
  }

  const stateArtifact = normalizedArtifacts?.state_json;
  if (isObject(stateArtifact) && stateArtifact.exists && isNonEmptyString(stateArtifact.path)) {
    candidates.push({ source: "artifacts.state_json", artifactPath: stateArtifact.path });
  }

  for (const candidate of candidates) {
    if (candidate.at) {
      const parsed = parseTimestamp(candidate.at);
      if (!parsed.ok) {
        continue;
      }
      const ageMs = nowMs - parsed.value.epoch;
      return {
        available: true,
        source: candidate.source,
        observed_at: parsed.value.at,
        observed_at_epoch: parsed.value.epoch,
        age_ms: ageMs,
        threshold_ms: staleAfterMs,
        fresh: ageMs <= staleAfterMs,
        stale: ageMs > staleAfterMs
      };
    }

    if (candidate.artifactPath) {
      try {
        const text = await readFile(candidate.artifactPath, "utf8");
        const parsedJson = JSON.parse(text);
        if (isNonEmptyString(parsedJson.heartbeat_at)) {
          const parsed = parseTimestamp(parsedJson.heartbeat_at);
          if (!parsed.ok) {
            continue;
          }
          const ageMs = nowMs - parsed.value.epoch;
          return {
            available: true,
            source: candidate.source,
            observed_at: parsed.value.at,
            observed_at_epoch: parsed.value.epoch,
            age_ms: ageMs,
            threshold_ms: staleAfterMs,
            fresh: ageMs <= staleAfterMs,
            stale: ageMs > staleAfterMs
          };
        }
      } catch {
        continue;
      }
    }
  }

  return {
    available: false,
    source: null,
    observed_at: null,
    observed_at_epoch: null,
    age_ms: null,
    threshold_ms: staleAfterMs,
    fresh: null,
    stale: null
  };
}

function normalizeTerminalStatus(value) {
  if (!isNonEmptyString(value)) {
    return null;
  }
  return value;
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

function splitContentTail(text, requestedLineCount) {
  if (!isNonEmptyString(text) || requestedLineCount <= 0) {
    return [];
  }
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.slice(-requestedLineCount);
}

async function inspectArtifactTailSnapshot(artifact, {
  baseDir,
  label,
  requestedLineCount
}) {
  const artifactObject = isObject(artifact) ? artifact : null;
  const resolvedPath = isNonEmptyString(artifactObject?.path)
    ? (path.isAbsolute(artifactObject.path) ? artifactObject.path : path.resolve(baseDir, artifactObject.path))
    : null;

  const snapshot = {
    artifact_key: label,
    path: resolvedPath,
    exists: artifactObject?.exists === true,
    byte_count: artifactObject?.byte_count ?? null,
    requested_line_count: requestedLineCount,
    tail_line_count: 0,
    truncated: false,
    content_tail: [],
    media_kind: artifactObject?.media_kind ?? guessMediaKind(resolvedPath),
    sensitivity_class: artifactObject?.sensitivity_class ?? guessSensitivityClass(resolvedPath)
  };

  if (!resolvedPath || !snapshot.exists) {
    return { ok: true, value: snapshot };
  }

  try {
    const stats = await stat(resolvedPath);
    if (!stats.isFile()) {
      snapshot.exists = false;
      snapshot.byte_count = null;
      return { ok: true, value: snapshot };
    }

    const text = await readFile(resolvedPath, "utf8");
    const allLines = splitContentTail(text, Number.MAX_SAFE_INTEGER);
    const lines = allLines.slice(-requestedLineCount);

    snapshot.byte_count = stats.size;
    snapshot.tail_line_count = lines.length;
    snapshot.truncated = allLines.length > requestedLineCount;
    snapshot.content_tail = lines;
    return { ok: true, value: snapshot };
  } catch (error) {
    if (error?.code === "ENOENT") {
      snapshot.exists = false;
      snapshot.byte_count = null;
      return { ok: true, value: snapshot };
    }

    snapshot.read_error = {
      code: error?.code ?? null,
      message: error?.message ?? String(error)
    };
    return { ok: true, value: snapshot };
  }
}

export async function inspectAgentRunProvenance({
  runDir,
  provenancePath,
  heartbeatStaleAfterMs = DEFAULT_HEARTBEAT_STALE_AFTER_MS,
  tailLines = null
} = {}) {
  if (!isNonEmptyString(runDir) && !isNonEmptyString(provenancePath)) {
    return failure("invalid_provenance_input", "inspectAgentRunProvenance requires runDir or provenancePath");
  }

  const resolvedRunDir = isNonEmptyString(runDir) ? path.resolve(runDir) : null;
  const resolvedProvenancePath = isNonEmptyString(provenancePath) ? path.resolve(provenancePath) : null;

  let effectiveRunDir = resolvedRunDir;
  let effectiveProvenancePath = resolvedProvenancePath;

  if (!effectiveProvenancePath && effectiveRunDir) {
    try {
      const runStats = await stat(effectiveRunDir);
      if (!runStats.isDirectory()) {
        if (!runStats.isFile()) {
          return failure(
            "provenance_run_dir_not_directory",
            "inspectAgentRunProvenance requires a run directory",
            { path: effectiveRunDir }
          );
        }
        effectiveProvenancePath = effectiveRunDir;
        effectiveRunDir = path.dirname(path.dirname(effectiveRunDir));
      } else {
        effectiveProvenancePath = path.join(effectiveRunDir, "metadata", "provenance.json");
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        return failure(
          "provenance_run_dir_missing",
          "Run directory does not exist",
          { path: effectiveRunDir }
        );
      }
      return failure(
        "provenance_artifact_unreadable",
        "Unable to inspect run directory",
        { path: effectiveRunDir, cause: error?.message ?? String(error) }
      );
    }
  }

  if (!effectiveRunDir && effectiveProvenancePath) {
    effectiveRunDir = path.dirname(path.dirname(effectiveProvenancePath));
  }

  if (!isNonEmptyString(effectiveProvenancePath)) {
    return failure("invalid_provenance_input", "Unable to resolve provenance path");
  }

  let provenanceRaw;
  try {
    provenanceRaw = await readFile(effectiveProvenancePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return failure(
        "provenance_artifact_missing",
        "Provenance artifact does not exist",
        { path: effectiveProvenancePath }
      );
    }
    return failure(
      "provenance_artifact_unreadable",
      "Unable to read provenance artifact",
      { path: effectiveProvenancePath, cause: error?.message ?? String(error) }
    );
  }

  let provenance;
  try {
    provenance = JSON.parse(provenanceRaw);
  } catch (error) {
    return failure(
      "provenance_invalid_json",
      "Provenance artifact is not valid JSON",
      { path: effectiveProvenancePath, cause: error?.message ?? String(error) }
    );
  }

  if (!isObject(provenance)) {
    return failure(
      "provenance_invalid_json",
      "Provenance artifact must be a JSON object",
      { path: effectiveProvenancePath }
    );
  }

  if (provenance.schema_version !== "agent-run-provenance.v1") {
    return failure(
      "provenance_unsupported_schema",
      "Unsupported provenance schema version",
      { path: effectiveProvenancePath, schema_version: provenance.schema_version ?? null }
    );
  }

  const runId = normalizeTerminalStatus(provenance.run_id);
  const role = normalizeTerminalStatus(provenance.role);
  const terminalStatus = normalizeTerminalStatus(provenance.terminal_status ?? provenance.runtime?.status);
  const subject = provenance.subject ?? null;

  if (!runId) {
    return failure(
      "provenance_missing_required_field",
      "Provenance artifact is missing run_id",
      { path: "run_id" }
    );
  }
  if (!role) {
    return failure(
      "provenance_missing_required_field",
      "Provenance artifact is missing role",
      { path: "role" }
    );
  }
  if (!terminalStatus) {
    return failure(
      "provenance_missing_required_field",
      "Provenance artifact is missing terminal status",
      { path: "terminal_status" }
    );
  }

  if (!isObject(provenance.runtime)) {
    return failure(
      "provenance_missing_required_field",
      "Provenance artifact is missing runtime metadata",
      { path: "runtime" }
    );
  }

  const startedAt = normalizeTerminalStatus(provenance.runtime.started_at);
  const completedAt = normalizeTerminalStatus(provenance.runtime.completed_at);
  const startedAtParsed = parseTimestamp(startedAt);

  if (!startedAtParsed.ok) {
    return failure(
      "provenance_missing_required_field",
      "Provenance artifact is missing a valid started_at timestamp",
      { path: "runtime.started_at" }
    );
  }

  if (!isObject(provenance.artifacts)) {
    return failure(
      "provenance_missing_required_field",
      "Provenance artifact is missing artifact metadata",
      { path: "artifacts" }
    );
  }

  const artifactKeys = new Set([
    "final_response",
    "response_md",
    "stdout_log",
    "stderr_log",
    "heartbeat_log",
    "launch_json",
    "state_json",
    "meta_json",
    "review_json",
    "input_manifest_json"
  ]);
  const sourceContextKeys = new Set([
    "subject",
    "review_json",
    "input_manifest_json"
  ]);

  const normalizedArtifactsResult = await normalizeSectionArtifacts(
    provenance.artifacts,
    effectiveRunDir,
    artifactKeys
  );
  if (!normalizedArtifactsResult.ok) {
    return normalizedArtifactsResult;
  }

  const sourceContextBaseDir = isNonEmptyString(provenance.authority?.workspace_root)
    ? provenance.authority.workspace_root
    : isNonEmptyString(provenance.runtime?.cwd)
      ? provenance.runtime.cwd
      : effectiveRunDir;
  const normalizedSourceContextResult = await normalizeSectionArtifacts(
    provenance.source_context,
    sourceContextBaseDir,
    sourceContextKeys
  );
  if (!normalizedSourceContextResult.ok) {
    return normalizedSourceContextResult;
  }

  const requestedTailLineCount = normalizeTailLineCount(tailLines);
  const tailSnapshotsRequested = requestedTailLineCount > 0;

  if (!TERMINAL_STATUSES.has(terminalStatus)) {
    if (!NON_TERMINAL_STATUSES.has(terminalStatus)) {
      return failure(
        "provenance_invalid_status",
        "Provenance artifact uses an unsupported terminal status",
        { path: "terminal_status", status: terminalStatus }
      );
    }
    if (!tailSnapshotsRequested) {
      const heartbeatPreview = await deriveHeartbeatFreshness(
        provenance,
        normalizedArtifactsResult.value,
        Date.now(),
        Number.isFinite(heartbeatStaleAfterMs) && heartbeatStaleAfterMs > 0
          ? heartbeatStaleAfterMs
          : DEFAULT_HEARTBEAT_STALE_AFTER_MS
      );
      if (heartbeatPreview.available && heartbeatPreview.stale) {
        return failure(
          "provenance_stale",
          "Provenance heartbeat is stale for a non-terminal run",
          {
            path: heartbeatPreview.source,
            observed_at: heartbeatPreview.observed_at,
            age_ms: heartbeatPreview.age_ms,
            threshold_ms: heartbeatPreview.threshold_ms
          }
        );
      }
      return failure(
        "provenance_non_terminal",
        "Provenance artifact does not describe a terminal run",
        { path: "terminal_status", status: terminalStatus }
      );
    }
  }

  const completedAtParsed = parseTimestamp(completedAt);
  if (TERMINAL_STATUSES.has(terminalStatus) && !completedAtParsed.ok) {
    return failure(
      "provenance_missing_required_field",
      "Provenance artifact is missing a valid completed_at timestamp",
      { path: "runtime.completed_at" }
    );
  }

  const responseArtifactKey = Object.prototype.hasOwnProperty.call(normalizedArtifactsResult.value, "response_md")
    ? "response_md"
    : Object.prototype.hasOwnProperty.call(normalizedArtifactsResult.value, "final_response")
      ? "final_response"
      : null;
  const responseArtifact = responseArtifactKey ? normalizedArtifactsResult.value[responseArtifactKey] : null;

  if (!tailSnapshotsRequested && (!isObject(responseArtifact) || !responseArtifact.exists || !isNonEmptyString(responseArtifact.sha256))) {
    return failure(
      "provenance_artifact_missing",
      "Provenance artifact does not include a readable response artifact",
      { path: responseArtifact?.path ?? null, artifact: responseArtifactKey ?? "response" }
    );
  }

  const heartbeatFreshness = await deriveHeartbeatFreshness(
    provenance,
    normalizedArtifactsResult.value,
    Date.now(),
    Number.isFinite(heartbeatStaleAfterMs) && heartbeatStaleAfterMs > 0
      ? heartbeatStaleAfterMs
      : DEFAULT_HEARTBEAT_STALE_AFTER_MS
  );

  const validationSummaries = normalizeValidationSummaries(provenance);
  const responseDigest = normalizeDigest(responseArtifact?.sha256 ?? null);

  if (tailSnapshotsRequested) {
    const responseTailSnapshotResult = await inspectArtifactTailSnapshot(responseArtifact, {
      baseDir: effectiveRunDir,
      label: responseArtifactKey ?? "response",
      requestedLineCount: requestedTailLineCount
    });
    if (!responseTailSnapshotResult.ok) {
      return responseTailSnapshotResult;
    }

    const stdoutTailSnapshotResult = await inspectArtifactTailSnapshot(normalizedArtifactsResult.value.stdout_log ?? null, {
      baseDir: effectiveRunDir,
      label: "stdout_log",
      requestedLineCount: requestedTailLineCount
    });
    if (!stdoutTailSnapshotResult.ok) {
      return stdoutTailSnapshotResult;
    }

    const stderrTailSnapshotResult = await inspectArtifactTailSnapshot(normalizedArtifactsResult.value.stderr_log ?? null, {
      baseDir: effectiveRunDir,
      label: "stderr_log",
      requestedLineCount: requestedTailLineCount
    });
    if (!stderrTailSnapshotResult.ok) {
      return stderrTailSnapshotResult;
    }

    return success({
      schema_version: AGENT_RUN_PROVENANCE_SCHEMA_VERSION,
      source_schema_version: provenance.schema_version,
      run_dir: effectiveRunDir,
      provenance_path: effectiveProvenancePath,
      run_id: runId,
      subject,
      role,
      terminal_status: terminalStatus,
      started_at: startedAtParsed.value.at,
      completed_at: completedAtParsed.ok ? completedAtParsed.value.at : null,
      started_at_epoch: startedAtParsed.value.epoch,
      completed_at_epoch: completedAtParsed.ok ? completedAtParsed.value.epoch : null,
      heartbeat_freshness: heartbeatFreshness,
      response_artifact_key: responseArtifactKey,
      response_digest: responseDigest,
      wrapper: provenance.wrapper ?? null,
      selected_agent: provenance.selected_agent ?? null,
      profile: provenance.profile ?? null,
      model: provenance.model ?? null,
      wk_id: provenance.wk_id ?? null,
      in_id: provenance.in_id ?? null,
      review_id: provenance.review_id ?? null,
      handoff_id: provenance.handoff_id ?? null,
      entrypoint: provenance.entrypoint ?? null,
      artifacts: normalizedArtifactsResult.value,
      artifact_tails: {
        response: responseTailSnapshotResult.value,
        stdout: stdoutTailSnapshotResult.value,
        stderr: stderrTailSnapshotResult.value
      },
      source_context: normalizedSourceContextResult.value,
      authority: isObject(provenance.authority) ? cloneJson(provenance.authority) : null,
      runtime: isObject(provenance.runtime) ? cloneJson(provenance.runtime) : null,
      validation_summaries: validationSummaries,
      cleanup: isObject(provenance.cleanup) ? cloneJson(provenance.cleanup) : null
    });
  }

  const completedAtValue = completedAtParsed.value.at;
  const completedAtEpoch = completedAtParsed.value.epoch;

  return success({
    schema_version: AGENT_RUN_PROVENANCE_SCHEMA_VERSION,
    source_schema_version: provenance.schema_version,
    run_dir: effectiveRunDir,
    provenance_path: effectiveProvenancePath,
    run_id: runId,
    subject,
    role,
    terminal_status: terminalStatus,
    started_at: startedAtParsed.value.at,
    completed_at: completedAtValue,
    started_at_epoch: startedAtParsed.value.epoch,
    completed_at_epoch: completedAtEpoch,
    heartbeat_freshness: heartbeatFreshness,
    response_artifact_key: responseArtifactKey,
    response_digest: responseDigest,
    wrapper: provenance.wrapper ?? null,
    selected_agent: provenance.selected_agent ?? null,
    profile: provenance.profile ?? null,
    model: provenance.model ?? null,
    wk_id: provenance.wk_id ?? null,
    in_id: provenance.in_id ?? null,
    review_id: provenance.review_id ?? null,
    handoff_id: provenance.handoff_id ?? null,
    entrypoint: provenance.entrypoint ?? null,
    artifacts: normalizedArtifactsResult.value,
    source_context: normalizedSourceContextResult.value,
    authority: isObject(provenance.authority) ? cloneJson(provenance.authority) : null,
    runtime: isObject(provenance.runtime) ? cloneJson(provenance.runtime) : null,
    validation_summaries: validationSummaries,
    cleanup: isObject(provenance.cleanup) ? cloneJson(provenance.cleanup) : null
  });
}
