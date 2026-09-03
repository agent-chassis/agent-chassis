
export const AGENT_RUN_PROVENANCE_ENVELOPE_SCHEMA_VERSION = "agent-run-provenance.v1";
export const AGENT_RUN_PROVENANCE_CONSTRUCTION_DIAGNOSTIC_CODE =
  "agent_run_provenance_construction_failed";

function constructionFailure(message, path = null) {
  return {
    ok: false,
    diagnostic: {
      type: "agent-run-provenance-construction-diagnostic.v1",
      code: AGENT_RUN_PROVENANCE_CONSTRUCTION_DIAGNOSTIC_CODE,
      message,
      path
    }
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

function rejectUnknownKeys(input, allowed, label) {
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  return unknown ? constructionFailure(`Unknown provenance field: ${label}.${unknown}`, label) : null;
}

function shapeAgentRunArtifact(input, label) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return constructionFailure(`Invalid artifact descriptor for ${label}`, label);
  }
  const unknown = rejectUnknownKeys(input, new Set(["path", "exists", "byte_count", "sha256", "media_kind", "sensitivity_class"]), label);
  if (unknown) return unknown;
  if (!nonEmpty(input.path) || typeof input.exists !== "boolean" ||
      !nonEmpty(input.media_kind) || !nonEmpty(input.sensitivity_class)) {
    return constructionFailure(`Incomplete artifact descriptor for ${label}`, label);
  }
  if (input.exists && (!Number.isInteger(input.byte_count) || input.byte_count < 0 || !nonEmpty(input.sha256))) {
    return constructionFailure(`Existing artifact descriptor lacks digest facts for ${label}`, label);
  }
  return {
    ok: true,
    value: {
      path: input.path,
      exists: input.exists,
      ...(input.exists ? { byte_count: input.byte_count, sha256: input.sha256 } : {}),
      media_kind: input.media_kind,
      sensitivity_class: input.sensitivity_class
    }
  };
}

function shapeDirectArtifact(input, label) {
  return shapeAgentRunArtifact(input, label);
}

function validateRedactedArgv(argv) {
  return Array.isArray(argv) && argv.every((value) => typeof value === "string" && value.length > 0);
}

function validateOptionalString(value, label) {
  return value === null || value === undefined || nonEmpty(value)
    ? null
    : constructionFailure(`Malformed provenance fact: ${label}`, label);
}

function validateEpochFacts(facts, unit = "milliseconds") {
  const started = Date.parse(facts.startedAt);
  const completed = Date.parse(facts.completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) {
    return constructionFailure("Provenance timestamps must be valid ISO timestamps", "runtime");
  }
  for (const [key, value] of [["startedAtEpoch", facts.startedAtEpoch], ["completedAtEpoch", facts.completedAtEpoch]]) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      return constructionFailure(`Malformed provenance fact: ${key}`, key);
    }
  }
  const divisor = unit === "seconds" ? 1000 : 1;
  const expectedStarted = unit === "seconds" ? Math.floor(started / divisor) : started;
  const expectedCompleted = unit === "seconds" ? Math.floor(completed / divisor) : completed;
  if (facts.startedAtEpoch !== undefined && facts.startedAtEpoch !== expectedStarted ||
      facts.completedAtEpoch !== undefined && facts.completedAtEpoch !== expectedCompleted) {
    return constructionFailure("Supplied provenance epochs contradict ISO timestamps", "runtime");
  }
  const startedEpoch = facts.startedAtEpoch ?? expectedStarted;
  const completedEpoch = facts.completedAtEpoch ?? expectedCompleted;
  if (!Number.isFinite(startedEpoch) || !Number.isFinite(completedEpoch) || completedEpoch < startedEpoch) {
    return constructionFailure("Provenance timestamps are missing or contradictory", "runtime");
  }
  return { ok: true, startedEpoch, completedEpoch };
}

function shapePromptFact(value, label) {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (!nonEmpty(value)) return constructionFailure(`Malformed provenance fact: ${label}`, label);
  return { ok: true, value };
}

function validateHeartbeatTimeline(timeline) {
  if (!Array.isArray(timeline)) return constructionFailure("Heartbeat timeline must be an array", "heartbeatTimeline");
  for (const entry of timeline) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        rejectUnknownKeys(entry, new Set(["at", "elapsed_seconds", "log_bytes", "note"]), "heartbeatTimeline") ||
        !nonEmpty(entry.at) || !Number.isInteger(entry.elapsed_seconds) || entry.elapsed_seconds < 0 ||
        !Number.isInteger(entry.log_bytes) || entry.log_bytes < 0 ||
        (entry.note !== undefined && typeof entry.note !== "string")) {
      return constructionFailure("Malformed heartbeat timeline", "heartbeatTimeline");
    }
  }
  return null;
}

function shapeHeartbeatTimeline(timeline) {
  const failure = validateHeartbeatTimeline(timeline);
  if (failure) return failure;
  return timeline.map((entry) => ({
    at: entry.at,
    elapsed_seconds: entry.elapsed_seconds,
    log_bytes: entry.log_bytes,
    ...(entry.note === undefined ? {} : { note: entry.note })
  }));
}

function buildDirectAgentRunProvenanceEnvelope(facts) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
    return constructionFailure("Provenance construction facts are required", "facts");
  }
  for (const key of ["runId", "wrapper", "role", "subject", "wkId", "inId", "entrypoint", "selectedAgent",
    "profile", "model", "runtimeCwd", "runDir", "startedAt", "completedAt", "status", "terminalStatus",
    "signal", "childPid", "heartbeatTimeline", "argvRedacted", "sourceContext", "authority", "artifacts"]) {
    if (facts[key] === undefined || (facts[key] === null &&
        !["wkId", "inId", "entrypoint", "profile", "model", "status", "signal", "childPid"].includes(key))) {
      return constructionFailure(`Missing required provenance fact: ${key}`, key);
    }
  }
  if (!nonEmpty(facts.runId) || !nonEmpty(facts.wrapper) || !nonEmpty(facts.role) ||
      !nonEmpty(facts.subject) || !nonEmpty(facts.selectedAgent) || !nonEmpty(facts.runtimeCwd) ||
      !nonEmpty(facts.runDir) || !validateRedactedArgv(facts.argvRedacted)) {
    return constructionFailure("Malformed direct provenance facts", "runtime");
  }
  for (const [key, value] of Object.entries({
    wkId: facts.wkId, inId: facts.inId, entrypoint: facts.entrypoint,
    profile: facts.profile, model: facts.model
  })) {
    const failure = validateOptionalString(value, key);
    if (failure) return failure;
  }
  if (facts.childPid !== null && (!Number.isInteger(facts.childPid) || facts.childPid < 0)) {
    return constructionFailure("Direct child pid must be null or a nonnegative integer", "childPid");
  }
  const heartbeatFailure = validateHeartbeatTimeline(facts.heartbeatTimeline);
  if (heartbeatFailure) return heartbeatFailure;
  const heartbeatTimeline = shapeHeartbeatTimeline(facts.heartbeatTimeline);
  const epochFacts = validateEpochFacts(facts, "seconds");
  if (!epochFacts.ok) return epochFacts;
  if (facts.status !== null && (typeof facts.status !== "number" || !Number.isInteger(facts.status))) {
    return constructionFailure("Direct exit status must be null or an integer", "runtime");
  }
  if (facts.terminalStatus !== "completed" && facts.terminalStatus !== "failed") {
    return constructionFailure("Direct terminal status must be completed or failed", "runtime");
  }
  if (facts.signal !== null && !nonEmpty(facts.signal)) {
    return constructionFailure("Direct terminal signal must be null or a non-empty name", "runtime");
  }
  const isCompleted = facts.terminalStatus === "completed";
  if (isCompleted !== (facts.status === 0 && facts.signal === null)) {
    return constructionFailure("Direct terminal status and exit facts contradict", "runtime");
  }
  if (!isCompleted && facts.status === 0 && facts.signal === null) {
    return constructionFailure("Failed direct terminal facts require a nonzero exit or signal", "runtime");
  }
  if (!facts.sourceContext || typeof facts.sourceContext !== "object" || Array.isArray(facts.sourceContext) ||
      !facts.authority || typeof facts.authority !== "object" || Array.isArray(facts.authority) ||
      !facts.artifacts || typeof facts.artifacts !== "object" || Array.isArray(facts.artifacts)) {
    return constructionFailure("Malformed direct provenance context", "source_context");
  }
  const directAuthority = shapeAuthority(facts.authority);
  if (!directAuthority.ok) return directAuthority;
  const artifacts = {};
  for (const [label, descriptor] of Object.entries(facts.artifacts)) {
    const result = shapeDirectArtifact(descriptor, label);
    if (!result.ok) return result;
    artifacts[label] = result.value;
  }
    const sourceContext = {};
  for (const [label, descriptor] of Object.entries(facts.sourceContext)) {
    if (label === "prompt_digest" || label === "prompt_source") {
      if (descriptor !== null && descriptor !== undefined && !nonEmpty(descriptor)) {
        return constructionFailure(`Malformed provenance fact: ${label}`, label);
      }
      sourceContext[label] = descriptor ?? null;
      continue;
    }
    const result = shapeDirectArtifact(descriptor, label);
    if (!result.ok) return result;
    sourceContext[label] = result.value;
  }
  return {
    ok: true,
    envelope: {
      schema_version: AGENT_RUN_PROVENANCE_ENVELOPE_SCHEMA_VERSION,
      run_id: facts.runId,
      wrapper: facts.wrapper,
      role: facts.role,
      subject: facts.subject,
      wk_id: facts.wkId ?? null,
      in_id: facts.inId ?? null,
      entrypoint: facts.entrypoint ?? null,
      selected_agent: facts.selectedAgent,
      profile: facts.profile ?? null,
      model: facts.model ?? null,
      argv_redacted: [...facts.argvRedacted],
      source_context: sourceContext,
      authority: directAuthority.value,
    runtime: {
        cwd: facts.runtimeCwd,
        started_at: facts.startedAt,
        completed_at: facts.completedAt,
        started_at_epoch: epochFacts.startedEpoch,
        completed_at_epoch: epochFacts.completedEpoch,
        status: facts.terminalStatus,
        exit_status: facts.status,
        ...(facts.signal === null ? {} : { signal: facts.signal }),
        child_pid: facts.childPid ?? null,
        heartbeat_timeline: heartbeatTimeline
      },
      artifacts,
      cleanup: { retained: true, run_dir: facts.runDir }
    }
  };
}

export function buildAgentRunProvenanceEnvelope(facts) {
  if (facts?.captureMode === "direct") return buildDirectAgentRunProvenanceEnvelope(facts);
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
    return constructionFailure("Provenance construction facts are required", "facts");
  }
  const required = ["runId", "reviewId", "handoffId", "selectedAgent", "role", "effectiveRole",
    "subject", "startedAt", "completedAt", "terminalStatus", "runtimeCwd", "runDir", "argvRedacted",
    "authority", "artifacts"];
  for (const key of required) {
    if (facts[key] === undefined || facts[key] === null || (typeof facts[key] === "string" && !nonEmpty(facts[key]))) {
      return constructionFailure(`Missing required provenance fact: ${key}`, key);
    }
  }
  for (const key of ["runId", "reviewId", "handoffId", "selectedAgent", "role", "effectiveRole", "subject",
    "runtimeCwd", "runDir"]) {
    if (!nonEmpty(facts[key])) return constructionFailure(`Malformed provenance fact: ${key}`, key);
  }
  const epochFacts = validateEpochFacts(facts, "milliseconds");
  if (!epochFacts.ok) return epochFacts;
  if (!validateRedactedArgv(facts.argvRedacted)) {
    return constructionFailure("Malformed redacted argv", "argvRedacted");
  }
  if (facts.terminalStatus !== "completed" && facts.terminalStatus !== "failed") {
    return constructionFailure("Invalid terminal status", "runtime");
  }
  if (facts.exitStatus !== null && facts.exitStatus !== undefined &&
      (typeof facts.exitStatus !== "number" || !Number.isInteger(facts.exitStatus))) {
    return constructionFailure("Malformed exit status", "runtime");
  }
  if (facts.signal !== null && facts.signal !== undefined && !nonEmpty(facts.signal)) {
    return constructionFailure("Malformed terminal signal", "runtime");
  }
  if (facts.childPid !== null && facts.childPid !== undefined &&
      (!Number.isInteger(facts.childPid) || facts.childPid < 0)) {
    return constructionFailure("Child pid must be null or a nonnegative integer", "childPid");
  }
  let heartbeatTimeline = [];
  if (facts.heartbeatTimeline !== undefined) {
    const heartbeatFailure = validateHeartbeatTimeline(facts.heartbeatTimeline);
    if (heartbeatFailure) return heartbeatFailure;
    heartbeatTimeline = shapeHeartbeatTimeline(facts.heartbeatTimeline);
  }
  if (facts.terminalStatus === "completed" &&
      (facts.exitStatus !== 0 || facts.signal !== null && facts.signal !== undefined)) {
    return constructionFailure("Completed terminal status contradicts exit or signal facts", "runtime");
  }
  if (facts.terminalStatus === "failed" && (facts.exitStatus ?? null) === 0 &&
      (facts.signal ?? null) === null) {
    return constructionFailure("Failed terminal status contradicts exit or signal facts", "runtime");
  }
  for (const [key, value] of [["responseDigest", facts.responseDigest],
    ["graphCheckpointDisposition", facts.graphCheckpointDisposition]]) {
    if (key === "responseDigest" && value !== null && value !== undefined && !nonEmpty(value)) {
      return constructionFailure(`Malformed provenance fact: ${key}`, key);
    }
    if (key === "graphCheckpointDisposition") {
      const result = shapeGraphCheckpoint(value, key);
      if (!result.ok) return result;
    }
  }
  const authority = shapeAuthority(facts.authority);
  if (!authority.ok) return authority;
  if (!facts.artifacts || typeof facts.artifacts !== "object" || Array.isArray(facts.artifacts) ||
      (facts.sourceContext !== undefined &&
       (!facts.sourceContext || typeof facts.sourceContext !== "object" || Array.isArray(facts.sourceContext)))) {
    return constructionFailure("Provenance artifact facts are required", "artifacts");
  }
  const artifacts = {};
  for (const [label, descriptor] of Object.entries(facts.artifacts)) {
    const result = shapeAgentRunArtifact(descriptor, label);
    if (!result.ok) return result;
    artifacts[label] = result.value;
  }
  const sourceContext = {};
  for (const [label, descriptor] of Object.entries(facts.sourceContext ?? {})) {
    if (label === "prompt_digest" || label === "prompt_source") {
      const result = shapePromptFact(descriptor, label);
      if (!result.ok) return result;
      sourceContext[label] = result.value;
      continue;
    }
    if (label === "graph_impact_checkpoint") {
      const result = shapeGraphCheckpoint(descriptor, label);
      if (!result.ok) return result;
      sourceContext[label] = result.value;
      continue;
    }
    const result = shapeAgentRunArtifact(descriptor, label);
    if (!result.ok) return result;
    sourceContext[label] = result.value;
  }
  return {
    ok: true,
    envelope: {
      schema_version: AGENT_RUN_PROVENANCE_ENVELOPE_SCHEMA_VERSION,
      run_id: facts.runId,
      wrapper: "agent-launch",
      role: facts.role,
      effective_role: facts.effectiveRole,
      review_id: facts.reviewId,
      handoff_id: facts.handoffId,
      subject: facts.subject,
      selected_agent: facts.selectedAgent,
      argv_redacted: [...(facts.argvRedacted ?? [])],
      source_context: sourceContext,
      authority: authority.value,
      runtime: {
        cwd: facts.runtimeCwd,
        started_at: facts.startedAt,
        completed_at: facts.completedAt,
        started_at_epoch: epochFacts.startedEpoch,
        completed_at_epoch: epochFacts.completedEpoch,
        status: facts.terminalStatus,
        exit_status: facts.exitStatus ?? null,
        ...(facts.signal === null || facts.signal === undefined ? {} : { signal: facts.signal }),
        child_pid: facts.childPid ?? null,
        heartbeat_timeline: heartbeatTimeline
      },
      artifacts,
      response_digest: facts.responseDigest ?? null,
      terminal_status: facts.terminalStatus,
      graph_checkpoint_disposition: facts.graphCheckpointDisposition ?? null,
      cleanup: { retained: true, run_dir: facts.runDir }
    }
  };
}

function shapeAuthority(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return constructionFailure("Malformed provenance authority", "authority");
  }
  const unknown = rejectUnknownKeys(value, new Set(["trusted_binding", "agent_role", "repo_root", "runtime_home", "runtime_base", "workspace_root"]), "authority");
  if (unknown) return unknown;
  if (value.trusted_binding !== undefined && value.trusted_binding !== null) {
    const binding = value.trusted_binding;
    if (!binding || typeof binding !== "object" || Array.isArray(binding) ||
        rejectUnknownKeys(binding, new Set(["kind", "id"]), "authority.trusted_binding") ||
        !nonEmpty(binding.kind) || !nonEmpty(binding.id)) {
      return constructionFailure("Malformed provenance trusted binding", "authority.trusted_binding");
    }
  }
  for (const key of ["agent_role", "repo_root", "runtime_home", "runtime_base", "workspace_root"]) {
    if (value[key] !== undefined && value[key] !== null && !nonEmpty(value[key])) {
      return constructionFailure(`Malformed provenance authority: ${key}`, `authority.${key}`);
    }
  }
  return { ok: true, value: { ...value, ...(value.trusted_binding ? { trusted_binding: { ...value.trusted_binding } } : {}) } };
}

function shapeGraphCheckpoint(value, label) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return constructionFailure(`Malformed provenance fact: ${label}`, label);
  }
  const keys = new Set(["state", "required", "valid", "failure_reason", "implementation_scoped_signals", "required_section",
    "section_present", "accepted_markers", "path_impact_present", "diff_impact_present", "impact_kinds_present",
    "path_impact_markers", "diff_impact_markers", "not_applicable_with_reason", "override"]);
  const unknown = rejectUnknownKeys(value, keys, label);
  if (unknown) return unknown;
  if (!nonEmpty(value.state)) return constructionFailure(`Malformed provenance fact: ${label}.state`, label);
  for (const key of ["required", "valid", "section_present", "path_impact_present", "diff_impact_present", "not_applicable_with_reason"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return constructionFailure(`Malformed provenance fact: ${label}.${key}`, label);
  }
  for (const key of ["failure_reason", "required_section"]) {
    if (value[key] !== undefined && value[key] !== null && !nonEmpty(value[key])) return constructionFailure(`Malformed provenance fact: ${label}.${key}`, label);
  }
  if (value.state !== undefined && !nonEmpty(value.state)) return constructionFailure(`Malformed provenance fact: ${label}.state`, label);
  for (const key of ["implementation_scoped_signals", "accepted_markers", "impact_kinds_present", "path_impact_markers", "diff_impact_markers"]) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || !value[key].every(nonEmpty))) return constructionFailure(`Malformed provenance fact: ${label}.${key}`, label);
  }
  if (value.override !== undefined) {
    if (!value.override || typeof value.override !== "object" || Array.isArray(value.override) ||
        rejectUnknownKeys(value.override, new Set(["allow_missing_graph_impact_checkpoint", "applied"]), `${label}.override`) ||
        typeof value.override.allow_missing_graph_impact_checkpoint !== "boolean" || typeof value.override.applied !== "boolean") {
      return constructionFailure(`Malformed provenance fact: ${label}.override`, label);
    }
  }
  return { ok: true, value: JSON.parse(JSON.stringify(value)) };
}

export { shapeAgentRunArtifact };
export { buildDirectAgentRunProvenanceEnvelope };
