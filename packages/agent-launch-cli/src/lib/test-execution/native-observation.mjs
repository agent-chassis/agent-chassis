

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { launcherArtifact } from "../workspace-agent-test-proof-node-observation.mjs";
import { nativeRuntimeTestId } from "../workspace-agent-test-proof-runtime-identity.mjs";

export const NATIVE_EVENTS_SCHEMA_VERSION = "launcher-test-proof-native-events.v1";
export const NATIVE_OBSERVATION_SCHEMA_VERSION = "launcher-native-test-observation.v1";

const KINDS = new Set(["session_start", "collected", "test_start", "window_start", "window_end",
  "test_result", "reach", "session_end", "runtime_error"]);
const OUTCOMES = new Set(["passed", "failed", "skipped"]);
const SOURCE_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/u;
const MAX_TEXT = 64 * 1024;
const MAX_RECORDS = 100000;
const PROBE_TOKEN_RE = /^[0-9a-f]{32}$/u;

export const NATIVE_OBSERVER_RUNTIME_CODES = Object.freeze([
  "test_proof_native_runner_unsupported",
  "test_proof_native_runner_unavailable",
  "test_proof_native_selection_unsupported"
]);

function refusal(code, detail = null) {
  return { valid: false, code, ...(detail === null ? {} : { detail }) };
}

const isStringArray = (value) => Array.isArray(value) && value.length > 0 &&
  value.length <= 64 && value.every((entry) => typeof entry === "string" && entry.length <= 4096);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sourceFileDigest(root, relative) {
  try {
    return `sha256:${sha256(readFileSync(path.join(root, relative)))}`;
  } catch {
    return null;
  }
}

function boundedText(value) {
  return typeof value === "string" ? value.slice(0, MAX_TEXT) : undefined;
}

function recordShapeValid(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record) ||
      record.v !== 1 || typeof record.src !== "string" || !SOURCE_RE.test(record.src) ||
      !Number.isSafeInteger(record.seq) || record.seq < 0 || !KINDS.has(record.kind)) return false;
  switch (record.kind) {
    case "collected":
    case "test_start":
    case "window_start":
    case "window_end":
      return isStringArray(record.test) && (record.file === undefined || typeof record.file === "string");
    case "test_result":
      return isStringArray(record.test) && OUTCOMES.has(record.outcome) &&
        typeof record.assertion_failure === "boolean" &&
        (record.file === undefined || typeof record.file === "string") &&
        (record.error === null || record.error === undefined ||
          (typeof record.error === "object" && !Array.isArray(record.error)));
    case "reach":
      return typeof record.token === "string" && PROBE_TOKEN_RE.test(record.token);
    case "runtime_error":
      return typeof record.code === "string";
    default:
      return true;
  }
}

export function authenticateNativeEvents({ channelBytes, expectation, channelOverflow = false }) {
  if (channelOverflow) return refusal("test_proof_structured_events_oversized");
  if (!Buffer.isBuffer(channelBytes)) return refusal("test_proof_structured_events_invalid");
  const text = channelBytes.toString("utf8");
  if (Buffer.byteLength(text, "utf8") !== channelBytes.length) {
    return refusal("test_proof_structured_events_invalid");
  }
  const lines = text.split("\n");
  if (lines.at(-1) !== "") return lines.length === 1 && lines[0] === ""
    ? { valid: true, records: [] } : refusal("test_proof_structured_events_invalid");
  lines.pop();
  if (lines.length > MAX_RECORDS) return refusal("test_proof_structured_events_oversized");
  const records = [];
  const nextSeq = new Map();
  for (const line of lines) {
    let record;
    try { record = JSON.parse(line); } catch { return refusal("test_proof_structured_events_invalid"); }
    if (!recordShapeValid(record)) return refusal("test_proof_structured_events_invalid");
    if (record.nonce !== expectation.attempt_nonce) {
      return refusal("test_proof_structured_events_cross_attempt");
    }
    const expected = nextSeq.get(record.src) ?? 0;
    if (record.seq !== expected) return refusal("test_proof_structured_events_lifecycle_invalid");
    nextSeq.set(record.src, expected + 1);
    records.push(record);
  }
  return { valid: true, records };
}

export function nativeNodeId(file, test, identityFormat) {
  const rest = identityFormat.kind === "json_title_path" ? JSON.stringify(test)
    : test.join(identityFormat.separator);
  return `${file}::${rest}`;
}

function nodeIdOf(record, expectation) {
  return nativeNodeId(record.file ?? expectation.target, record.test, expectation.identity_format);
}

function streamContext(expectation) {
  return { provider_id: expectation.provider_id ?? null,
    provider_version: expectation.provider_version ?? null,
    selected_node_id: expectation.node_id ?? null };
}

function recordRefusal(code, expectation, record, index, recordCount) {
  return refusal(code, { ...streamContext(expectation), record_kind: record.kind,
    ...(Array.isArray(record.test) ? { observed_node_id: nodeIdOf(record, expectation) } : {}),
    ...(record.kind === "test_result" ? { observed_outcome: record.outcome } : {}),
    writer: record.src, sequence: record.seq, record_index: index, record_count: recordCount });
}

function candidateFacts(nodeId, expectation) {
  const separator = nodeId.indexOf("::");
  return { test_id: nativeRuntimeTestId({ provider_id: expectation.provider_id,
    provider_version: expectation.provider_version, path: nodeId.slice(0, separator),
    node_id: nodeId }), file: nodeId.slice(0, separator), name: nodeId, nesting: null,
  status: "skipped", error_codes: [] };
}

function selectedIdentityNotObserved(expectation, discovered) {
  const candidates = [...discovered].sort().map((nodeId) => candidateFacts(nodeId, expectation));
  return refusal("test_proof_selected_identity_not_observed", {
    expected_test_id: expectation.target_test_id,
    target: expectation.target,
    observed_count: candidates.length,
    returned_count: candidates.length,
    omitted_count: 0,
    observed_identity_candidates: candidates,
    file_wrapper_status: null,
    file_wrapper_error_codes: [],
    observed_failures: [],
    observed_failure_count: 0
  });
}

export function readNativeObservation({ channelBytes, channelOverflow = false, exitCode,
  expectation }) {
  const authenticated = authenticateNativeEvents({ channelBytes, expectation, channelOverflow });
  if (!authenticated.valid) return authenticated;
  const { records } = authenticated;
  const runtimeError = records.find(({ kind }) => kind === "runtime_error");
  if (runtimeError !== undefined) {
    return NATIVE_OBSERVER_RUNTIME_CODES.includes(runtimeError.code)
      ? refusal(runtimeError.code, { message: boundedText(runtimeError.message) ?? null })
      : refusal("test_proof_structured_events_invalid");
  }
  const selected = expectation.node_id;
  const discovered = new Set(expectation.declared_node_ids ?? []);
  const collectedOnce = new Set();
  const started = [];
  const lifecycle = new Map();

  let windowOpen = false;
  const reaches = [];
  let sessionEnded = false;
  for (const [index, record] of records.entries()) {
    const refuse = (code) => recordRefusal(code, expectation, record, index, records.length);
    if (sessionEnded) return refuse("test_proof_structured_events_lifecycle_invalid");
    if (record.kind === "session_end") {
      sessionEnded = true;
      continue;
    }
    if (record.kind === "reach") {
      reaches.push({ ...record, window: windowOpen ? "selected" : "outside" });
      continue;
    }
    if (!["collected", "test_start", "window_start", "window_end", "test_result"]
      .includes(record.kind)) continue;
    const nodeId = nodeIdOf(record, expectation);
    if (record.kind === "collected") {
      if (collectedOnce.has(nodeId)) return refuse("test_proof_structured_test_identity_duplicate");
      collectedOnce.add(nodeId);
      discovered.add(nodeId);
      continue;
    }
    const state = lifecycle.get(nodeId) ??
      { started: false, window_start: false, window_end: false, result: null };
    lifecycle.set(nodeId, state);
    discovered.add(nodeId);
    if (record.kind === "test_start") {
      if (state.started || state.result !== null) {
        return refuse("test_proof_structured_test_identity_duplicate");
      }
      if (nodeId !== selected) return refuse("test_proof_structured_events_unselected_execution");
      state.started = true;
      started.push(nodeId);
      windowOpen = expectation.window_start !== "explicit";
    } else if (record.kind === "window_start") {
      if (expectation.window_start !== "explicit" || !state.started || state.window_start ||
          state.window_end || state.result !== null) {
        return refuse("test_proof_structured_events_lifecycle_invalid");
      }
      state.window_start = true;
      windowOpen = true;
    } else if (record.kind === "window_end") {
      if (!state.started || state.window_end || state.result !== null ||
          (expectation.window_start === "explicit" && !state.window_start)) {
        return refuse("test_proof_structured_events_lifecycle_invalid");
      }
      state.window_end = true;
      windowOpen = false;
    } else {
      if (state.result !== null) return refuse("test_proof_structured_test_identity_duplicate");
      if (nodeId !== selected && record.outcome !== "skipped") {
        return refuse("test_proof_structured_events_unselected_execution");
      }
      if (record.outcome !== "skipped" && !state.started) {
        return refuse("test_proof_structured_events_lifecycle_invalid");
      }
      state.result = record;
      windowOpen = false;
    }
  }
  if (expectation.completion === "session_end" && !sessionEnded) {
    return refusal("test_proof_structured_test_inventory_incomplete");
  }
  const selectedState = lifecycle.get(selected);
  if (selectedState === undefined || (!selectedState.started && selectedState.result === null)) {
    if (!discovered.has(selected) || exitCode === 0 || expectation.completion === "session_end") {
      return selectedIdentityNotObserved(expectation, discovered);
    }
    return refusal("test_proof_structured_test_inventory_incomplete");
  }
  if (selectedState.result === null) return refusal("test_proof_structured_test_inventory_incomplete");
  const result = selectedState.result;
  if ((exitCode === 0) !== (result.outcome !== "failed")) {
    return refusal("test_proof_structured_events_exit_status_mismatch", { ...streamContext(expectation),
      selected_outcome: result.outcome, exit_code: exitCode, record_count: records.length });
  }
  return {
    valid: true,
    records_digest: `sha256:${sha256(channelBytes)}`,
    selected: {
      node_id: selected,
      outcome: result.outcome,
      started: selectedState.started,
      assertion_failure: result.outcome === "failed" && result.assertion_failure === true,
      error: result.error ?? null
    },
    discovered_node_ids: [...discovered].sort(),
    executed_node_ids: result.outcome === "skipped" ? [] : [selected],
    skipped_node_ids: result.outcome === "skipped" ? [selected] : [],
    reaches,
    runner: records.find(({ kind }) => kind === "session_start")?.runner ?? null
  };
}

function failureDiagnostic(error) {
  if (error === null || typeof error !== "object") {
    return { schema_version: "launcher-test-failure-diagnostic.v1", status: "unavailable",
      root_error: null, errors: [], values: [],
      issues: [{ path: "root_error", reason: "error_not_supplied" }] };
  }
  const entry = { id: "error-0" };
  for (const field of ["name", "message", "stack", "code"]) {
    const text = boundedText(error[field]);
    if (text !== undefined) entry[field] = text;
  }
  if (error.assertion === true) entry.operator = "assert";
  return { schema_version: "launcher-test-failure-diagnostic.v1", status: "captured",
    root_error: "error-0", errors: [entry], values: [], issues: [] };
}

function nativeTestId(expectation, nodeId) {
  return candidateFacts(nodeId, expectation).test_id;
}

function structuredResult(observation, expectation, exitCode) {
  const { outcome, error, assertion_failure: assertion } = observation.selected;
  const event = {
    type: outcome === "passed" ? "test:pass" : "test:fail",
    test_id: expectation.target_test_id,
    name: expectation.node_id,
    file: expectation.target,
    nesting: null,
    status: outcome === "passed" ? "passed" : "failed",
    error_codes: outcome === "failed" ? [...new Set([`${expectation.family_id}.test_failure`,
      ...(assertion ? ["assertion_failure"] : []),
      ...(typeof error?.name === "string" ? [error.name.slice(0, 256)] : []),
      ...(typeof error?.code === "string" ? [error.code.slice(0, 256)] : [])])] : [],
    ...(outcome === "failed" ? { failure_diagnostic: failureDiagnostic(error) } : {})
  };
  return {
    mechanism: expectation.candidate_mechanism,
    exit_code: exitCode,
    summary: { passed: outcome === "passed" ? 1 : 0, failed: outcome === "failed" ? 1 : 0,
      skipped: outcome === "skipped" ? 1 : 0, cancelled: 0, todo: 0, tests: 1 },
    pass_events: outcome === "passed" ? [event] : [],
    fail_events: outcome === "failed" ? [event] : []
  };
}

function aggregateReaches(reaches, instrumentation) {
  const probes = new Map((instrumentation.probes ?? []).map((probe) => [probe.token, probe]));
  const byKey = new Map();
  for (const reach of reaches) {
    const probe = probes.get(reach.token);
    if (probe === undefined) return null;
    const key = `${reach.window}\0${reach.token}`;
    const entry = byKey.get(key) ?? { window: reach.window, module_path: instrumentation.module_path,
      source_digest: instrumentation.source_digest, function_name: probe.function_name, line: probe.line,
      mutated: probe.mutated, entries: 0 };
    entry.entries += 1;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.window}\0${left.function_name}\0${left.line}`.localeCompare(
      `${right.window}\0${right.function_name}\0${right.line}`));
}

export function projectNativeObservation({ channelBytes, channelOverflow = false, exitCode,
  expectation }) {
  const observation = readNativeObservation({ channelBytes, channelOverflow, exitCode, expectation });
  if (!observation.valid) return observation;
  const result = structuredResult(observation, expectation, exitCode);
  const structuredArtifact = launcherArtifact("structured_test_result", result);
  const outcome = observation.selected.outcome;
  if (expectation.capability === "candidate_execution") {
    const inventory = {
      schema_version: NATIVE_OBSERVATION_SCHEMA_VERSION,
      mechanism: expectation.candidate_mechanism,
      provider_id: expectation.provider_id,
      node_id: expectation.node_id,
      target: expectation.target,
      target_test_id: expectation.target_test_id,
      discovered_node_ids: observation.discovered_node_ids,
      executed_node_ids: observation.executed_node_ids,
      skipped_node_ids: observation.skipped_node_ids,
      runner: observation.runner,
      runtime_inputs_digest: expectation.runtime_inputs_digest,
      attempt_nonce: expectation.attempt_nonce,
      events_digest: observation.records_digest,
      structured_event_digest: structuredArtifact.digest
    };
    return {
      valid: true,
      status: exitCode === 0 ? "passed" : "failed",
      selected_status: outcome,
      structured_result: result,
      test_inventory: {
        observed_test_ids: [...new Set(observation.discovered_node_ids.map((nodeId) =>
          nativeTestId(expectation, nodeId)))].sort(),
        executed_test_ids: outcome === "skipped" ? [] : [expectation.target_test_id],
        skipped_test_ids: outcome === "skipped" ? [expectation.target_test_id] : []
      },
      artifacts: [structuredArtifact, launcherArtifact("native_test_observation", inventory)]
    };
  }
  const instrumentation = expectation.instrumentation;
  if (sourceFileDigest(expectation.worktree, instrumentation.module_path) !==
      instrumentation.source_digest) {
    return refusal("test_proof_structured_events_source_mismatch");
  }
  const reaches = aggregateReaches(observation.reaches, instrumentation);
  if (reaches === null) return refusal("test_proof_structured_events_reach_unauthenticated");
  const status = outcome === "skipped" ? "skipped" : outcome;
  if (expectation.capability === "falsifier_execution") {
    const mutatedEntries = reaches.filter(({ window, mutated, function_name: name }) =>
      window === "selected" && mutated && name === instrumentation.function_name)
      .reduce((sum, { entries }) => sum + entries, 0);
    const observed = mutatedEntries > 0 && outcome === "failed" &&
      observation.selected.assertion_failure;
    const mutation = {
      mechanism: "scalar_return_substitution",
      strategy: "result_inversion",
      mutation_id: expectation.mutation_id,
      target_test_id: expectation.target_test_id,
      target_node_id: expectation.node_id,
      target_module_path: instrumentation.module_path,
      function_name: instrumentation.function_name,
      source_digest: instrumentation.source_digest,
      original: instrumentation.original,
      original_kind: instrumentation.original_kind,
      replacement: instrumentation.replacement,
      replacement_kind: instrumentation.replacement_kind,
      observation_seam: expectation.observation_seam,
      selected_outcome: outcome,
      assertion_failure: observation.selected.assertion_failure,
      mutated_entries_in_window: mutatedEntries,
      reaches,
      observed,
      failure_reason_code: observed ? expectation.failure_reason_code : null,
      attempt_nonce: expectation.attempt_nonce,
      structured_event_digest: structuredArtifact.digest
    };
    return {
      valid: true,
      status,
      mutation_observed: observed,
      failure_reason_code: observed ? expectation.failure_reason_code : null,
      mutation,
      structured_result: result,
      artifacts: [structuredArtifact, launcherArtifact("falsifier_result", mutation)]
    };
  }
  if (expectation.capability === "boundary_traversal") {
    const targetPassObserved = outcome === "passed";
    const observed = reaches.some(({ window, entries }) => window === "selected" && entries > 0);
    const boundary = {
      mechanism: "function_entry_probe",
      boundary_kind: "module",
      module_path: instrumentation.module_path,
      source_digest: instrumentation.source_digest,
      observable_seam: expectation.observation_seam,
      instrumented_functions: instrumentation.functions,
      target_test_id: expectation.target_test_id,
      target_node_id: expectation.node_id,
      target_pass_observed: targetPassObserved,
      observed,
      reaches,
      attempt_nonce: expectation.attempt_nonce,
      structured_event_digest: structuredArtifact.digest
    };
    return {
      valid: true,
      status,
      traversal_observed: observed && targetPassObserved,
      boundary_observation: boundary,
      structured_result: result,
      artifacts: [structuredArtifact, launcherArtifact("boundary_trace", boundary)]
    };
  }
  return refusal("test_proof_observation_capability_invalid");
}
