

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { isLauncherTestFailureDiagnostic } from "../workspace-agent-test-proof-error-diagnostic.mjs";
import { NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES, launcherArtifact } from
  "../workspace-agent-test-proof-node-observation.mjs";
import { nativeRuntimeTestId } from "../workspace-agent-test-proof-runtime-identity.mjs";

export const NATIVE_EVENTS_SCHEMA_VERSION = "launcher-test-proof-native-events.v1";
export const NATIVE_OBSERVATION_SCHEMA_VERSION = "launcher-native-test-observation.v1";

const KINDS = new Set(["session_start", "collected", "test_start", "window_start", "window_end",
  "test_result", "reach", "session_end", "runtime_error"]);
const OUTCOMES = new Set(["passed", "failed", "skipped"]);
const SOURCE_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/u;
const MAX_TEXT = 64 * 1024;

const MAX_CONTROL_RECORDS = 100000;
const MAX_WRITERS = 100000;
const MAX_RECORD_BYTES = NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES;
const PROBE_TOKEN_RE = /^[0-9a-f]{32}$/u;

const MAX_RUNNER_ERRORS = 8;

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
        !Object.hasOwn(record, "error") && (record.outcome === "failed"
        ? isLauncherTestFailureDiagnostic(record.failure_diagnostic)
        : !Object.hasOwn(record, "failure_diagnostic"));
    case "reach":
      return typeof record.token === "string" && PROBE_TOKEN_RE.test(record.token);
    case "runtime_error":
      return typeof record.code === "string" && (!Object.hasOwn(record, "failure_diagnostic") ||
        isLauncherTestFailureDiagnostic(record.failure_diagnostic));
    case "session_end":
      return (!Object.hasOwn(record, "runner_errors") && !Object.hasOwn(record, "runner_error_count")) ||
        (Array.isArray(record.runner_errors) && record.runner_errors.length > 0 &&
          record.runner_errors.length <= MAX_RUNNER_ERRORS &&
          record.runner_errors.every(isLauncherTestFailureDiagnostic) &&
          Number.isSafeInteger(record.runner_error_count) &&
          record.runner_error_count >= record.runner_errors.length);
    default:
      return true;
  }
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

function refusedRecord(code, expectation, record, index) {
  return { code, detail: { ...streamContext(expectation), record_kind: record.kind,
    ...(Array.isArray(record.test) ? { observed_node_id: nodeIdOf(record, expectation) } : {}),
    ...(record.kind === "test_result" ? { observed_outcome: record.outcome } : {}),
    writer: record.src, sequence: record.seq, record_index: index } };
}

function candidateFacts(nodeId, expectation) {
  const separator = nodeId.indexOf("::");
  return { test_id: nativeRuntimeTestId({ provider_id: expectation.provider_id,
    provider_version: expectation.provider_version, path: nodeId.slice(0, separator),
    node_id: nodeId }), file: nodeId.slice(0, separator), name: nodeId, nesting: null };
}

function selectedIdentityNotObserved(expectation, discovered, lifecycle, sessionEnded) {
  const candidates = [...discovered].sort().map((nodeId) => {
    const result = lifecycle.get(nodeId)?.result;
    return { ...candidateFacts(nodeId, expectation), ...(result === undefined || result === null ? {} : {
      status: result.outcome, error_codes: [] }) };
  });
  return refusal("test_proof_selected_identity_not_observed", {
    expected_test_id: expectation.target_test_id,
    selected_node_id: expectation.node_id,
    provider: { provider_id: expectation.provider_id, provider_version: expectation.provider_version },
    selection_status: discovered.has(expectation.node_id) ? "collected_not_observed"
      : sessionEnded ? "not_collected" : "unknown",
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

function reportedSelectedDiagnostic(observed, report) {
  const diagnosis = selectedReportDiagnosis(observed, report);
  return report?.unreadable !== true ? diagnosis : { ...diagnosis, issues: [...diagnosis.issues,
    { path: "/native_report", reason: "native_report_unreadable" }] };
}

function selectedReportDiagnosis(observed, report) {
  const reported = report?.selected_failure;
  if (reported === undefined || reported === null) return observed;
  if (!isLauncherTestFailureDiagnostic(reported)) {
    return { ...observed, issues: [...observed.issues,
      { path: "/native_report/selected_failure", reason: "native_report_unreadable" }] };
  }
  if (observed.status === "captured") return observed;
  if (reported.status === "captured") {
    return observed.origin === undefined || reported.origin !== undefined ? reported
      : { ...reported, origin: observed.origin };
  }
  return { ...observed, issues: [...observed.issues, ...reported.issues] };
}

function reportedBuildFailure(recordCount, report) {
  const build = report?.build_failure;
  if (!isLauncherTestFailureDiagnostic(build) || recordCount > 0) return null;
  return report.unreadable !== true ? build : { ...build, issues: [...build.issues,
    { path: "/native_report", reason: "native_report_unreadable" }] };
}

const RUN_CAUSE_CODES = new Set(["test_proof_structured_test_inventory_incomplete",
  "test_proof_selected_identity_not_observed", "test_proof_structured_events_exit_status_mismatch"]);

function withRunCause(result, { build = null, runnerErrors = null }) {
  if (result.valid || !RUN_CAUSE_CODES.has(result.code) || (build === null && runnerErrors === null)) {
    return result;
  }
  const detail = { ...(result.detail ?? {}) };
  if (detail.failure_diagnostic === undefined) {
    detail.failure_diagnostic = build ?? runnerErrors.errors[0];
  }
  if (runnerErrors !== null) detail.runner_error_count = runnerErrors.count;
  return { ...result, detail };
}

function limitRefusal(limit, measured, threshold, unit, recordIndex, exact) {
  return refusal("test_proof_structured_events_oversized", { limit, measured, threshold, unit,
    measured_is_lower_bound: !exact, record_index: recordIndex });
}

export function openNativeObservation({ expectation }) {
  const digest = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

  let pending = [];
  let pendingBytes = 0;
  let oversize = null;
  let notBytes = false;
  let malformed = false;
  let limit = null;
  let failure = null;
  let recordCount = 0;
  let controlRecords = 0;
  const nextSeq = new Map();

  const selected = expectation.node_id;
  const discovered = new Set(expectation.declared_node_ids ?? []);
  const collectedOnce = new Set();
  const lifecycle = new Map();

  let windowOpen = false;
  let sessionEnded = false;
  let sessionEnd = null;
  let runner;
  let runtimeError = null;
  let lifecycleRefusal = null;

  const instrumentation = expectation.capability === "candidate_execution" ? null
    : expectation.instrumentation ?? null;
  const probes = new Map((instrumentation?.probes ?? []).map((probe) => [probe.token, probe]));
  const reachCounts = new Map();
  let reachUnauthenticated = false;

  function applyLifecycle(record, index) {
    const refuse = (code) => { lifecycleRefusal = refusedRecord(code, expectation, record, index); };
    if (sessionEnded) return refuse("test_proof_structured_events_lifecycle_invalid");
    if (record.kind === "session_end") {
      sessionEnded = true;
      sessionEnd = record;
      return undefined;
    }
    if (record.kind === "reach") {
      if (instrumentation === null) return undefined;
      const probe = probes.get(record.token);
      if (probe === undefined) {
        reachUnauthenticated = true;
        return undefined;
      }
      const window = windowOpen ? "selected" : "outside";
      const key = `${window}\0${record.token}`;
      const entry = reachCounts.get(key) ?? { window, module_path: instrumentation.module_path,
        source_digest: instrumentation.source_digest, function_name: probe.function_name, line: probe.line,
        mutated: probe.mutated, entries: 0 };
      entry.entries += 1;
      reachCounts.set(key, entry);
      return undefined;
    }
    if (record.kind === "session_start" && runner === undefined) runner = record.runner ?? null;
    if (!["collected", "test_start", "window_start", "window_end", "test_result"]
      .includes(record.kind)) return undefined;
    const nodeId = nodeIdOf(record, expectation);
    if (record.kind === "collected") {
      if (collectedOnce.has(nodeId)) return refuse("test_proof_structured_test_identity_duplicate");
      collectedOnce.add(nodeId);
      discovered.add(nodeId);
      return undefined;
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
    return undefined;
  }

  function acceptRecord(bytes) {
    const index = recordCount;
    recordCount += 1;
    let text;
    try {
      text = decoder.decode(bytes);
    } catch {
      malformed = true;
      return;
    }
    if (failure !== null || limit !== null) return;
    let record;
    try {
      record = JSON.parse(text);
    } catch {
      failure = refusal("test_proof_structured_events_invalid");
      return;
    }
    if (!recordShapeValid(record)) {
      failure = refusal("test_proof_structured_events_invalid");
      return;
    }
    if (record.nonce !== expectation.attempt_nonce) {
      failure = refusal("test_proof_structured_events_cross_attempt");
      return;
    }
    if (!nextSeq.has(record.src) && nextSeq.size >= MAX_WRITERS) {
      limit = limitRefusal("writers", nextSeq.size + 1, MAX_WRITERS, "writers", index, false);
      return;
    }
    const expected = nextSeq.get(record.src) ?? 0;
    if (record.seq !== expected) {
      failure = refusal("test_proof_structured_events_lifecycle_invalid");
      return;
    }
    nextSeq.set(record.src, expected + 1);
    if (record.kind !== "reach") {
      controlRecords += 1;
      if (controlRecords > MAX_CONTROL_RECORDS) {
        limit = limitRefusal("control_records", controlRecords, MAX_CONTROL_RECORDS, "records", index, false);
        return;
      }
    }
    if (record.kind === "runtime_error" && runtimeError === null) runtimeError = record;
    if (lifecycleRefusal === null) applyLifecycle(record, index);
  }

  function write(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      notBytes = true;
      return;
    }
    digest.update(chunk);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(start, end);
      if (oversize !== null) {
        oversize.bytes += part.length;
      } else if (pendingBytes + part.length > MAX_RECORD_BYTES) {
        oversize = { bytes: pendingBytes + part.length, index: recordCount };
        pending = [];
        pendingBytes = 0;
      } else if (newline < 0) {
        pending.push(part);
        pendingBytes += part.length;
      }
      if (newline < 0) return;
      if (oversize !== null) {
        if (limit === null) {
          limit = limitRefusal("record_bytes", oversize.bytes, MAX_RECORD_BYTES, "bytes", oversize.index, true);
        }
        recordCount += 1;
        oversize = null;
      } else {
        acceptRecord(pending.length === 0 ? part : Buffer.concat([...pending, part], pendingBytes + part.length));
        pending = [];
        pendingBytes = 0;
      }
      start = newline + 1;
    }
  }

  function authentication({ channelOverflow = false } = {}) {
    if (channelOverflow) return refusal("test_proof_structured_events_oversized");
    if (notBytes || malformed || oversize !== null || pendingBytes > 0) {
      return refusal("test_proof_structured_events_invalid");
    }
    return limit ?? failure ?? { valid: true, record_count: recordCount };
  }

  function inventoryIncomplete(missing) {
    const state = lifecycle.get(selected);
    return refusal("test_proof_structured_test_inventory_incomplete", { ...streamContext(expectation),
      missing, completion_requirement: expectation.completion === "session_end" ? "session_end" : "selected_result",
      session_end_observed: sessionEnded, selected_collected: discovered.has(selected),
      selected_started: state?.started === true, selected_result_observed: (state?.result ?? null) !== null,
      discovered_count: discovered.size, record_count: recordCount });
  }

  function selectedObservation(exitCode) {
    if (lifecycleRefusal !== null) {
      return refusal(lifecycleRefusal.code, { ...lifecycleRefusal.detail, record_count: recordCount });
    }
    if (expectation.completion === "session_end" && !sessionEnded) return inventoryIncomplete("session_end");
    const selectedState = lifecycle.get(selected);
    if (selectedState === undefined || (!selectedState.started && selectedState.result === null)) {
      if (!discovered.has(selected) || exitCode === 0 || expectation.completion === "session_end") {
        return selectedIdentityNotObserved(expectation, discovered, lifecycle, sessionEnded);
      }
      return inventoryIncomplete("selected_test_start");
    }
    if (selectedState.result === null) return inventoryIncomplete("selected_test_result");
    const result = selectedState.result;
    if ((exitCode === 0) !== (result.outcome !== "failed")) {
      return refusal("test_proof_structured_events_exit_status_mismatch", { ...streamContext(expectation),
        selected_outcome: result.outcome, exit_code: exitCode, record_count: recordCount });
    }
    return {
      valid: true,
      records_digest: `sha256:${digest.copy().digest("hex")}`,
      selected: {
        node_id: selected,
        outcome: result.outcome,
        started: selectedState.started,
        assertion_failure: result.outcome === "failed" && result.assertion_failure === true,
        ...(result.outcome === "failed" ? { failure_diagnostic: result.failure_diagnostic } : {})
      },
      discovered_node_ids: [...discovered].sort(),
      executed_node_ids: result.outcome === "skipped" ? [] : [selected],
      skipped_node_ids: result.outcome === "skipped" ? [selected] : [],

      reaches: reachUnauthenticated ? null : [...reachCounts.values()].sort((left, right) =>
        `${left.window}\0${left.function_name}\0${left.line}`.localeCompare(
          `${right.window}\0${right.function_name}\0${right.line}`)),
      runner: runner ?? null
    };
  }

  function observation({ exitCode, nativeReport = null, channelOverflow = false }) {
    const authenticated = authentication({ channelOverflow });
    if (!authenticated.valid) return authenticated;
    if (runtimeError !== null) {
      return NATIVE_OBSERVER_RUNTIME_CODES.includes(runtimeError.code)
        ? refusal(runtimeError.code, { message: boundedText(runtimeError.message) ?? null,
          ...(runtimeError.failure_diagnostic === undefined ? {}
            : { failure_diagnostic: runtimeError.failure_diagnostic }) })
        : refusal("test_proof_structured_events_invalid");
    }
    const causes = {
      build: reportedBuildFailure(recordCount, nativeReport),
      runnerErrors: sessionEnd?.runner_errors === undefined ? null
        : { errors: sessionEnd.runner_errors, count: sessionEnd.runner_error_count }
    };
    const observed = selectedObservation(exitCode);
    if (!observed.valid) return withRunCause(observed, causes);
    const { selected: test } = observed;
    return test.outcome !== "failed" ? observed : { ...observed, selected: { ...test,
      failure_diagnostic: reportedSelectedDiagnostic(test.failure_diagnostic, nativeReport) } };
  }

  return { write, authentication, observation,
    finish: ({ exitCode, nativeReport = null, channelOverflow = false }) => projectObservation(
      observation({ exitCode, nativeReport, channelOverflow }), expectation, exitCode) };
}

function opened({ channelBytes, expectation }) {
  const reader = openNativeObservation({ expectation });
  reader.write(channelBytes);
  return reader;
}

export function authenticateNativeEvents({ channelBytes, expectation, channelOverflow = false }) {
  return opened({ channelBytes, expectation }).authentication({ channelOverflow });
}

export function readNativeObservation({ channelBytes, channelOverflow = false, exitCode,
  expectation, nativeReport = null }) {
  return opened({ channelBytes, expectation }).observation({ exitCode, nativeReport, channelOverflow });
}

function nativeTestId(expectation, nodeId) {
  return candidateFacts(nodeId, expectation).test_id;
}

function rootErrorCodes(diagnostic) {
  const root = diagnostic?.errors?.find(({ id }) => id === diagnostic.root_error);
  return [root?.name, root?.code].filter((value) => typeof value === "string" && value.length > 0)
    .map((value) => value.slice(0, 256));
}

function structuredResult(observation, expectation, exitCode) {
  const { outcome, failure_diagnostic: diagnostic, assertion_failure: assertion } = observation.selected;
  const event = {
    type: outcome === "passed" ? "test:pass" : "test:fail",
    test_id: expectation.target_test_id,
    name: expectation.node_id,
    file: expectation.target,
    nesting: null,
    status: outcome === "passed" ? "passed" : "failed",
    error_codes: outcome === "failed" ? [...new Set([`${expectation.family_id}.test_failure`,
      ...(assertion ? ["assertion_failure"] : []),
      ...rootErrorCodes(diagnostic)])] : [],
    ...(outcome === "failed" ? { failure_diagnostic: diagnostic } : {})
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

export function projectNativeObservation({ channelBytes, channelOverflow = false, exitCode,
  expectation, nativeReport = null }) {
  return opened({ channelBytes, expectation }).finish({ exitCode, nativeReport, channelOverflow });
}

function projectObservation(observation, expectation, exitCode) {
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
  const { reaches } = observation;
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
