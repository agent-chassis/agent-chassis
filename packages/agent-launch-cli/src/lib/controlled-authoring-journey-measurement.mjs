import { createHash } from "node:crypto";

export const CONTROLLED_AUTHORING_MEASUREMENT_SCHEMA_VERSION =
  "controlled-authoring-journey-measurement.v2";

const DISCOVERY_TOOLS = new Set([
  "workspace_tools_list", "workspace_tools_describe"
]);
const RESPONSIBILITIES = new Set(["caller", "tool", "runtime", "unknown"]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
  );
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(
    JSON.stringify(canonicalValue(value))).digest("hex")}`;
}

function messages(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes ?? "");
  const parsed = [];
  const invalid = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim() === "") continue;
    try {
      parsed.push(JSON.parse(line));
    } catch (error) {
      invalid.push(Object.freeze({ line: index + 1,
        reason: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { parsed, invalid };
}

function idKey(id) {
  return id === undefined ? null : `${typeof id}:${String(id)}`;
}

function indexById(frames) {
  const indexed = new Map();
  for (const frame of frames) {
    const key = idKey(frame?.id);
    if (key === null) continue;
    const entries = indexed.get(key) ?? [];
    entries.push(frame);
    indexed.set(key, entries);
  }
  return indexed;
}

function classifyRequest(message) {
  const tool = message.method === "tools/list"
    ? "mcp:tools/list" : message.params.name;
  const args = message.params?.arguments ?? {};
  const semantic = args.response !== undefined && args.response?.kind !== "advance_authoring";
  const mechanical = args.response?.kind === "advance_authoring";
  const retrieval = args.snapshot_identity !== undefined || args.cursor !== undefined ||
    args.collection !== undefined || args.field_path !== undefined;
  const discovery = message.method === "tools/list" || DISCOVERY_TOOLS.has(tool);
  if (semantic) return { cost_class: "semantic_authoring",
    rule: "request.arguments.response.kind is present and is not advance_authoring" };
  if (mechanical) return { cost_class: "mechanical_continuation",
    rule: "request.arguments.response.kind equals advance_authoring" };
  if (retrieval) return { cost_class: "retrieval",
    rule: "request carries a snapshot, cursor, collection, or field-path selector" };
  if (discovery) return { cost_class: "discovery",
    rule: message.method === "tools/list"
      ? "request is the MCP tools/list discovery operation"
      : "operation is owned by the workspace_tools discovery family" };
  return { cost_class: "preparation",
    rule: "observed tool call has no semantic, mechanical, retrieval, or discovery marker" };
}

function effectFromResult(result) {
  const changed = result?.structuredContent?.warning?.payload?.details?.changed ??
    result?.structuredContent?.details?.changed ?? null;
  const effect = changed === false ? "reported_no_effect"
    : changed === true ? "reported_effect" : "indeterminate";
  return { outcome: result?.isError === true ? "refused" : "succeeded", effect };
}

function outcomeFromResponse(response) {
  if (response === null) return { outcome: "unmatched", effect: "unknown" };
  if (response.error !== undefined) return { outcome: "failed", effect: "unknown" };
  return effectFromResult(response.result);
}

function normalizeAttribution(observation) {
  const authored = observation?.attribution;
  if (!authored || !RESPONSIBILITIES.has(authored.responsibility) ||
      typeof authored.evidence !== "string" || authored.evidence.trim() === "") {
    return Object.freeze({ responsibility: "unknown", basis: "not_authored" });
  }
  return Object.freeze({ responsibility: authored.responsibility,
    basis: "separately_authored", evidence: authored.evidence });
}

function tokenMeasurement(observation) {
  const valid = observation && typeof observation === "object" &&
    observation.source === "observed_client_projection" &&
    typeof observation.client === "string" && observation.client.length > 0 &&
    typeof observation.model === "string" && observation.model.length > 0 &&
    typeof observation.tokenizer === "string" && observation.tokenizer.length > 0 &&
    typeof observation.projection === "string" && observation.projection.length > 0 &&
    Number.isSafeInteger(observation.input_tokens) && observation.input_tokens >= 0 &&
    Number.isSafeInteger(observation.output_tokens) && observation.output_tokens >= 0;
  if (!valid) return Object.freeze({
    state: "unavailable",
    reason: "observed_client_model_tokenizer_and_projection_not_available",
    input_tokens: null,
    output_tokens: null,
    client: null,
    model: null,
    tokenizer: null,
    projection: null,
    bytes_are_not_tokens: true
  });
  return Object.freeze({ state: "measured", reason: null,
    input_tokens: observation.input_tokens, output_tokens: observation.output_tokens,
    client: observation.client, model: observation.model,
    tokenizer: observation.tokenizer, projection: observation.projection,
    source: observation.source, bytes_are_not_tokens: true });
}

function identityMeasurement(identity, observations) {
  const required = ["run_id", "side", "journey", "task_identity"];
  const missing = required.filter((field) =>
    typeof identity?.[field] !== "string" || identity[field].length === 0);
  for (const [name, value] of [["source", identity?.source],
    ["runtime", identity?.runtime], ["configuration", identity?.configuration]]) {
    if (!value || typeof value !== "object" || typeof value.identity !== "string" ||
        value.identity.length === 0) missing.push(`${name}.identity`);
  }
  if (typeof identity?.source?.content_digest !== "string" ||
      identity.source.content_digest.length === 0) missing.push("source.content_digest");
  const mixed = observations.some((item) => item?.run_id !== identity?.run_id ||
    item?.source_identity !== identity?.source?.identity);
  return Object.freeze({ state: missing.length === 0 && !mixed ? "complete" : "incomplete",
    missing: Object.freeze(missing), mixed_observation_identity: mixed,
    value: identity == null ? null : Object.freeze(structuredClone(identity)) });
}

function phaseCoverage(expectedPhases, observations) {
  const observed = new Map();
  for (const item of observations) {
    if (typeof item?.phase !== "string") continue;
    observed.set(item.phase, (observed.get(item.phase) ?? 0) + 1);
  }
  const expected = Array.isArray(expectedPhases) ? expectedPhases : [];
  return expected.map((entry) => {
    const phase = typeof entry === "string" ? entry : entry.phase;
    const minimum = typeof entry === "string" ? 1 : entry.minimum_calls ?? 1;
    const count = observed.get(phase) ?? 0;
    return Object.freeze({ phase, minimum_calls: minimum,
      observed_calls: count, observed: count >= minimum });
  });
}

export function measureControlledAuthoringJourney({ requestBytes,
  responseBytes = Buffer.alloc(0), observations = [], expectedPhases = [],
  evidenceIdentity = null, modelTokenObservation = null } = {}) {
  const requests = messages(requestBytes);
  const responses = messages(responseBytes);
  const protocolRequests = requests.parsed.filter((message) =>
    typeof message?.method === "string" && idKey(message.id) !== null);
  const calls = requests.parsed.filter((message) =>
    message?.method === "tools/list" ||
    message?.method === "tools/call" && typeof message?.params?.name === "string");
  const responseById = indexById(responses.parsed.filter((message) =>
    message && (message.result !== undefined || message.error !== undefined)));
  const observationById = indexById(observations.map((item) =>
    ({ ...item, id: item.request_id })));
  const requestIdCounts = indexById(protocolRequests);
  const repeatedSemantic = new Map();
  const repeatedRequests = new Map();
  const entries = [];
  const matchedResponseKeys = new Set();
  for (const message of protocolRequests) {
    const key = idKey(message.id);
    const candidates = responseById.get(key) ?? [];
    const response = candidates.length === 1 ? candidates[0] : null;
    if (response !== null) matchedResponseKeys.add(key);
  }
  for (const message of calls) {
    const key = idKey(message.id);
    const candidates = responseById.get(key) ?? [];
    const response = candidates.length === 1 ? candidates[0] : null;
    const observationsForCall = observationById.get(key) ?? [];
    const observation = observationsForCall.length === 1 ? observationsForCall[0] : null;
    const classification = classifyRequest(message);
    const args = message.params?.arguments ?? {};
    const operation = message.method === "tools/list"
      ? "mcp:tools/list" : message.params.name;
    const requestFingerprint = digest({ operation, arguments: args });
    const requestOccurrence = (repeatedRequests.get(requestFingerprint) ?? 0) + 1;
    repeatedRequests.set(requestFingerprint, requestOccurrence);
    if (classification.cost_class === "semantic_authoring") {
      const semantic = digest(args.response);
      repeatedSemantic.set(semantic, (repeatedSemantic.get(semantic) ?? 0) + 1);
    }
    const result = outcomeFromResponse(response);
    const elapsed = Number.isFinite(observation?.elapsed_ms) && observation.elapsed_ms >= 0
      ? observation.elapsed_ms : null;
    const retryOf = observation?.retry_of_request_id;
    const retryObserved = retryOf !== undefined && requestIdCounts.has(idKey(retryOf));
    entries.push(Object.freeze({ request_id: message.id,
      operation, phase: observation?.phase ?? null,
      observed: Object.freeze({ result_frame_present: response !== null,
        elapsed_ms: elapsed, response_kind: typeof args.response?.kind === "string"
          ? args.response.kind : null }),
      classification: Object.freeze(classification),
      attribution: normalizeAttribution(observation),
      retry: Object.freeze({ state: retryObserved ? "observed" : "not_observed",
        request_id: retryObserved ? retryOf : null }),
      outcome: result.outcome, effect: result.effect,
      repeated_identical_request: requestOccurrence > 1 }));
  }
  const unmatchedResponseIds = [...responseById.keys()].filter((key) =>
    !matchedResponseKeys.has(key));
  const unmatchedObservationIds = [...observationById.keys()].filter((key) =>
    !requestIdCounts.has(key));
  const duplicateRequestIds = [...requestIdCounts.entries()]
    .filter(([, values]) => values.length > 1).map(([key]) => key);
  const duplicateResponseIds = [...responseById.entries()]
    .filter(([, values]) => values.length > 1).map(([key]) => key);
  const duplicateObservationIds = [...observationById.entries()]
    .filter(([, values]) => values.length > 1).map(([key]) => key);
  const unmatchedProtocolRequests = protocolRequests.filter((message) => {
    const candidates = responseById.get(idKey(message.id)) ?? [];
    return candidates.length !== 1;
  }).map(({ id }) => id);
  const phases = phaseCoverage(expectedPhases, observations);
  const unobservedPhases = phases.filter(({ observed }) => !observed)
    .map(({ phase }) => phase);
  const identity = identityMeasurement(evidenceIdentity, observations);
  const complete = requests.invalid.length === 0 && responses.invalid.length === 0 &&
    unmatchedProtocolRequests.length === 0 && unmatchedResponseIds.length === 0 &&
    duplicateRequestIds.length === 0 && duplicateResponseIds.length === 0 &&
    duplicateObservationIds.length === 0 && unobservedPhases.length === 0 &&
    unmatchedObservationIds.length === 0 &&
    identity.state === "complete";
  const count = (value) => entries.filter(({ classification }) =>
    classification.cost_class === value).length;
  const outcomeCount = (value) => entries.filter(({ outcome }) => outcome === value).length;
  const elapsedValues = entries.map(({ observed }) => observed.elapsed_ms)
    .filter((value) => value !== null);
  return Object.freeze({
    schema_version: CONTROLLED_AUTHORING_MEASUREMENT_SCHEMA_VERSION,
    evidence_boundary: "launcher_local_work_evidence", admission_authority: "none",
    evidence_identity: identity,
    capture: Object.freeze({ state: complete ? "complete" : "incomplete",
      request_frame_count: requests.parsed.length,
      response_frame_count: responses.parsed.length,
      invalid_request_frames: Object.freeze(requests.invalid),
      invalid_response_frames: Object.freeze(responses.invalid),
      unmatched_request_ids: Object.freeze(unmatchedProtocolRequests),
      unmatched_response_ids: Object.freeze(unmatchedResponseIds),
      unmatched_observation_ids: Object.freeze(unmatchedObservationIds),
      duplicate_request_ids: Object.freeze(duplicateRequestIds),
      duplicate_response_ids: Object.freeze(duplicateResponseIds),
      duplicate_observation_ids: Object.freeze(duplicateObservationIds),
      phase_coverage: Object.freeze(phases),
      unobserved_phases: Object.freeze(unobservedPhases) }),
    protocol: Object.freeze({
      request_count: protocolRequests.length,
      response_count: [...matchedResponseKeys].length,
      handshake_count: protocolRequests.filter(({ method }) => method === "initialize").length,
      handshake_elapsed_ms: observations.filter((item) => {
        const request = protocolRequests.find(({ id }) => idKey(id) === idKey(item?.request_id));
        return request?.method === "initialize" && Number.isFinite(item?.elapsed_ms) &&
          item.elapsed_ms >= 0;
      }).reduce((total, item) => total + item.elapsed_ms, 0),
      tool_operation_count: entries.length
    }),
    calls: Object.freeze({ total: entries.length,
      succeeded: outcomeCount("succeeded"), refused: outcomeCount("refused"),
      failed: outcomeCount("failed"), unmatched: outcomeCount("unmatched"),
      semantic: count("semantic_authoring"), mechanical: count("mechanical_continuation"),
      retrieval: count("retrieval"), discovery: count("discovery"),
      preparation: count("preparation"),
      observed_retries: entries.filter(({ retry }) => retry.state === "observed").length,
      repeated_semantic_input: [...repeatedSemantic.values()].reduce(
        (total, occurrences) => total + Math.max(0, occurrences - 1), 0),
      repeated_identical_request: [...repeatedRequests.values()].reduce(
        (total, occurrences) => total + Math.max(0, occurrences - 1), 0) }),
    elapsed: Object.freeze({ state: entries.length === 0 || elapsedValues.length === 0
      ? "unavailable" : elapsedValues.length === entries.length ? "complete" : "partial",
    observed_call_count: elapsedValues.length,
    total_ms: elapsedValues.length === 0 ? null
      : elapsedValues.reduce((total, value) => total + value, 0) }),
    entries: Object.freeze(entries),
    transport: Object.freeze({ request_bytes: Buffer.byteLength(requestBytes ?? ""),
      response_bytes: Buffer.byteLength(responseBytes ?? ""), bytes_are_not_tokens: true }),
    tokens: tokenMeasurement(modelTokenObservation),
    transcript_payload_values_emitted: false
  });
}

export function assertComparableControlledAuthoringMeasurements(baseline, candidate) {
  for (const [side, measurement] of [["baseline", baseline], ["candidate", candidate]]) {
    if (measurement?.schema_version !== CONTROLLED_AUTHORING_MEASUREMENT_SCHEMA_VERSION ||
        measurement?.capture?.state !== "complete" ||
        measurement?.evidence_identity?.state !== "complete") {
      throw new Error(`${side} controlled-authoring capture is incomplete`);
    }
  }
  const left = baseline.evidence_identity.value;
  const right = candidate.evidence_identity.value;
  for (const field of ["journey", "task_identity"]) {
    if (left[field] !== right[field]) throw new Error(
      `controlled-authoring comparison mixes incompatible ${field} identities`);
  }
  for (const field of ["runtime", "configuration"]) {
    if (left[field].identity !== right[field].identity) throw new Error(
      `controlled-authoring comparison mixes incompatible ${field} identities`);
  }
  if (left.run_id === right.run_id) {
    throw new Error("controlled-authoring comparison requires distinct run identities");
  }
  for (const source of [left.source, right.source]) {
    if (typeof source.content_digest !== "string" || source.content_digest.length === 0) {
      throw new Error("controlled-authoring comparison requires content-aware source identities");
    }
  }
  return true;
}

const REQUIRED_BENCHMARK_CHECKS = Object.freeze({
  add: Object.freeze(["contract_absent_before", "contract_present_after",
    "authored_requirement_present", "next_semantic_question_present",
    "final_handoff_succeeded"]),
  edit: Object.freeze(["unrelated_meaning_preserved", "selected_proof_changed",
    "selected_observable_changed", "durable_outcome_present",
    "final_handoff_succeeded"]),
  recover: Object.freeze(["refusal_reported_no_effect", "refusal_published_nothing",
    "correction_published_exactly_once", "corrected_requirement_present",
    "next_semantic_question_present", "final_handoff_succeeded"]),
  population: Object.freeze(["complete_definition_population",
    "extension_after_first_four", "final_handoff_succeeded"])
});

export function validateControlledAuthoringBenchmarkArtifact(artifact) {
  if (artifact?.schema_version !== "controlled-authoring-paired-benchmark.v2" ||
      artifact?.evidence_kind !== "actual_production_registered_mcp_execution" ||
      artifact?.execution_mode !== "isolated_production_registered_mcp_transport") {
    throw new Error("controlled-authoring benchmark is not production-registered MCP transport evidence");
  }
  if (!["improvement", "control"].includes(artifact?.baseline?.intent)) {
    throw new Error("controlled-authoring benchmark requires explicit baseline intent");
  }
  if (artifact?.validity?.state !== "valid") {
    throw new Error(`controlled-authoring benchmark is invalid: ${artifact?.validity?.first_cause?.code ?? "unknown"}`);
  }
  const baselineContent = artifact?.sides?.baseline?.source?.content_digest;
  const candidateContent = artifact?.sides?.candidate?.source?.content_digest;
  if (typeof baselineContent !== "string" || typeof candidateContent !== "string") {
    throw new Error("controlled-authoring benchmark lacks content-aware source comparison");
  }
  const equalSource = baselineContent === candidateContent;
  if (artifact.source_comparison?.classification !==
      (equalSource ? "equal_source_control" : "different_source_candidate")) {
    throw new Error("controlled-authoring benchmark source classification is inconsistent");
  }
  if (equalSource && artifact.baseline.intent !== "control") {
    throw new Error("equal-source benchmark must be labeled as a control");
  }
  if (!equalSource && artifact.baseline.intent !== "improvement") {
    throw new Error("different-source benchmark cannot be labeled as a control");
  }
  if (equalSource && artifact.improvement_claim?.eligible !== false) {
    throw new Error("equal-source control cannot produce an improvement claim");
  }
  if (artifact?.tokens?.state !== "measured" &&
      artifact?.improvement_claim?.eligible !== false) {
    throw new Error("token-unobserved benchmark cannot produce an improvement claim");
  }
  for (const journey of Object.keys(REQUIRED_BENCHMARK_CHECKS)) {
    const baseline = artifact?.sides?.baseline?.runs?.[journey];
    const candidate = artifact?.sides?.candidate?.runs?.[journey];
    assertComparableControlledAuthoringMeasurements(
      baseline?.measurement, candidate?.measurement);
    for (const [side, run] of [["baseline", baseline], ["candidate", candidate]]) {
      if (run?.measurement?.evidence_identity?.value?.journey !== journey) {
        throw new Error(`${side} ${journey} benchmark carries another journey identity`);
      }
      if (run?.measurement?.evidence_identity?.value?.source?.content_digest !==
          artifact.sides[side].source.content_digest) {
        throw new Error(`${side} ${journey} benchmark source content identity is inconsistent`);
      }
      if (run?.outcome_checks?.all_passed !== true) {
        throw new Error(`${side} ${journey} benchmark outcome is not equivalent`);
      }
      for (const check of REQUIRED_BENCHMARK_CHECKS[journey]) {
        if (run.outcome_checks.checks?.[check] !== true) throw new Error(
          `${side} ${journey} benchmark failed required check ${check}`);
      }
      if (run?.raw_capture?.boundary !== "local_work_evidence_only" ||
          typeof run.raw_capture.request !== "string" ||
          typeof run.raw_capture.response !== "string" ||
          typeof run.raw_capture.evidence_directory !== "string") {
        throw new Error(`${side} ${journey} benchmark lacks raw execution capture references`);
      }
    }
    if (!baseline?.outcome_checks?.durable_effect ||
        !candidate?.outcome_checks?.durable_effect ||
        digest(baseline.outcome_checks.durable_effect) !==
          digest(candidate.outcome_checks.durable_effect)) {
      throw new Error(`${journey} benchmark durable outcomes are not equivalent`);
    }
  }
  return true;
}
