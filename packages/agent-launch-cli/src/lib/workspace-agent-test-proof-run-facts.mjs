

import {
  isLauncherTestFailureDiagnostic,
  projectSelectedTestFailureDiagnostic
} from "./workspace-agent-test-proof-error-diagnostic.mjs";
import {
  TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE,
  projectTestProofForcedInvocationIdentityFailure
} from "./workspace-agent-test-proof-module-fault-contract.mjs";
import { nativeExecutionFailureDiagnostic } from './test-execution/ordinary-test-diagnosis.mjs';

const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;
const SIGNAL_RE = /^SIG[A-Z0-9]{1,32}$/u;
const DISPOSITIONS = Object.freeze(["passed", "failed", "not_run", "unconfirmed"]);
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const NATIVE_INSTRUMENTATION_UNSUPPORTED_CODE = "test_proof_native_instrumentation_unsupported";
const ADAPTER_REASON_RE = /^[a-z][a-z0-9_]{0,63}$/u;

const REJECTED_RECORD_TEXT_KEYS = Object.freeze(["provider_id", "provider_version",
  "selected_node_id", "observed_node_id", "record_kind", "observed_outcome", "selected_outcome",
  "writer", "missing", "completion_requirement"]);
const REJECTED_RECORD_COUNT_KEYS = Object.freeze(["sequence", "record_index", "record_count",
  "exit_code", "discovered_count"]);

const REJECTED_RECORD_FLAG_KEYS = Object.freeze(["session_end_observed", "selected_collected",
  "selected_started", "selected_result_observed"]);

const OVERSIZED_OBSERVATION_CODE = "test_proof_structured_events_oversized";
const LIMIT_TERM_RE = /^[a-z][a-z0-9_]{0,63}$/u;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const boundedText = (value) => typeof value === "string" && value.length > 0 &&
  value.length <= 4096 && !CONTROL_RE.test(value);

export function rejectedRecordContext(detail) {
  if (!isObject(detail) || typeof detail.selected_node_id !== "string") return null;
  const context = {};
  for (const key of REJECTED_RECORD_TEXT_KEYS) {
    if (typeof detail[key] === "string" && detail[key].length <= 4096 &&
        !CONTROL_RE.test(detail[key])) context[key] = detail[key];
  }
  for (const key of REJECTED_RECORD_COUNT_KEYS) {
    if (Number.isSafeInteger(detail[key])) context[key] = detail[key];
  }
  for (const key of REJECTED_RECORD_FLAG_KEYS) {
    if (typeof detail[key] === "boolean") context[key] = detail[key];
  }
  return context;
}

function limitContext(detail) {
  if (!isObject(detail) || detail.limit === undefined) return null;
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  if (typeof detail.limit !== "string" || !LIMIT_TERM_RE.test(detail.limit) ||
      typeof detail.unit !== "string" || !LIMIT_TERM_RE.test(detail.unit) ||
      !count(detail.measured) || !count(detail.threshold) ||
      typeof detail.measured_is_lower_bound !== "boolean" ||
      (detail.record_index !== undefined && !count(detail.record_index))) return undefined;
  return { limit: detail.limit, measured: detail.measured, threshold: detail.threshold, unit: detail.unit,
    measured_is_lower_bound: detail.measured_is_lower_bound,
    ...(detail.record_index === undefined ? {} : { record_index: detail.record_index }) };
}

function instrumentationContext(detail) {
  if (!isObject(detail) || typeof detail.reason !== "string" ||
      !ADAPTER_REASON_RE.test(detail.reason)) return null;
  return { reason: detail.reason, ...(boundedText(detail.test) ? { test: detail.test } : {}) };
}

const OBSERVATION_TRANSPORT_FAILED_CODE = "test_proof_observation_transport_failed";
const TRANSPORT_TEXT_KEYS = Object.freeze(["channel_kind", "failure", "errno", "interruption"]);
const TRANSPORT_COUNT_KEYS = Object.freeze(["expected_bytes", "observed_bytes", "consumed_bytes"]);
const TRANSPORT_DIGEST_KEYS = Object.freeze(["expected_sha256", "observed_sha256"]);
const TRANSPORT_TEXT_RE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

function transportContext(detail) {
  if (!isObject(detail) || typeof detail.failure !== "string" || !TRANSPORT_TEXT_RE.test(detail.failure)) {
    return null;
  }
  const context = {};
  for (const key of TRANSPORT_TEXT_KEYS) {
    if (typeof detail[key] === "string" && TRANSPORT_TEXT_RE.test(detail[key])) context[key] = detail[key];
  }
  for (const key of TRANSPORT_COUNT_KEYS) {
    if (Number.isSafeInteger(detail[key]) && detail[key] >= 0) context[key] = detail[key];
  }
  for (const key of TRANSPORT_DIGEST_KEYS) {
    if (typeof detail[key] === "string" && SHA256_RE.test(detail[key])) context[key] = detail[key];
  }
  return context;
}

function observationDetail(code, detail) {
  if (code === OBSERVATION_TRANSPORT_FAILED_CODE) return transportContext(detail);
  if (code === TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.code) {
    const identity = projectTestProofForcedInvocationIdentityFailure(detail);
    return identity === null ? undefined : { reason: identity.reason,
      module_path: identity.module_path, export_name: identity.export_name };
  }
  if (code === NATIVE_INSTRUMENTATION_UNSUPPORTED_CODE) return instrumentationContext(detail);
  if (code === OVERSIZED_OBSERVATION_CODE) return limitContext(detail);

  if (isObject(detail) && typeof detail.selected_node_id !== "string" &&
      Object.keys(detail).every((key) => key === "reason" || key === "test")) {
    return instrumentationContext(detail);
  }
  return rejectedRecordContext(detail);
}

function unconfirmedCompletion(run) {
  const { completion, completion_recovery: recovery } = run;
  const stated = completion?.publication_error ?? null;
  if (!isObject(completion) || !isObject(recovery) || completion.confirmed !== false ||
      completion.runner_outcome !== "unknown" || completion.tests_may_have_executed !== true ||
      typeof completion.frame_error !== "string" || !STABLE_CODE_RE.test(completion.frame_error) ||
      (completion.frame_bytes_received !== null && !(Number.isSafeInteger(completion.frame_bytes_received) &&
        completion.frame_bytes_received >= 0)) ||
      (completion.driver_exit_code !== null && !Number.isSafeInteger(completion.driver_exit_code)) ||
      (completion.driver_signal !== null && !(typeof completion.driver_signal === "string" &&
        SIGNAL_RE.test(completion.driver_signal))) ||
      (stated !== null && !(isObject(stated) && boundedText(stated.error) &&
        Number.isSafeInteger(stated.written_bytes) && Number.isSafeInteger(stated.frame_bytes))) ||
      typeof recovery.action !== "string" || !STABLE_CODE_RE.test(recovery.action) ||
      recovery.repair_call !== "none" || recovery.automatic_rerun !== false ||
      !boundedText(recovery.actor) || !boundedText(recovery.next_action)) return undefined;
  return {
    completion: { confirmed: false, runner_outcome: "unknown", tests_may_have_executed: true,
      frame_error: completion.frame_error, frame_bytes_received: completion.frame_bytes_received,
      driver_exit_code: completion.driver_exit_code, driver_signal: completion.driver_signal,
      publication_error: stated === null ? null : { error: stated.error, written_bytes: stated.written_bytes,
        frame_bytes: stated.frame_bytes } },
    completion_recovery: { actor: recovery.actor, action: recovery.action, repair_call: "none",
      automatic_rerun: false, next_action: recovery.next_action }
  };
}

function runCause(run) {
  const candidates = [run.failure_diagnostic, run.test_proof_observation?.detail?.failure_diagnostic,
    run.detail?.failure_diagnostic];
  return candidates.find((candidate) => candidate !== undefined) ?? null;
}

export function boundedRunFacts(run) {
  if (!isObject(run)) return null;
  const facts = {};
  if (Object.hasOwn(run, "ran")) {
    if (typeof run.ran !== "boolean") return null;
    facts.ran = run.ran;
  }
  if (Object.hasOwn(run, "disposition")) {
    if (!DISPOSITIONS.includes(run.disposition)) return null;
    facts.disposition = run.disposition;
  }
  if (Object.hasOwn(run, "exit_code")) {
    if (run.exit_code !== null && (!Number.isSafeInteger(run.exit_code) ||
        Math.abs(run.exit_code) > 2_147_483_647)) return null;
    facts.exit_code = run.exit_code;
  }
  if (Object.hasOwn(run, "signal")) {
    if (run.signal !== null && (typeof run.signal !== "string" || !SIGNAL_RE.test(run.signal))) {
      return null;
    }
    facts.signal = run.signal;
  }
  if (Object.hasOwn(run, "timed_out")) {
    if (typeof run.timed_out !== "boolean") return null;
    facts.timed_out = run.timed_out;
  }
  if (Object.hasOwn(run, "blocker_code")) {
    if (typeof run.blocker_code !== "string" || !STABLE_CODE_RE.test(run.blocker_code)) return null;
    facts.blocker_code = run.blocker_code;
  }
  if (Object.hasOwn(run, "output_truncated")) {
    if (typeof run.output_truncated !== "boolean") return null;
    facts.output_truncated = run.output_truncated;
  }
  if (Object.hasOwn(run, "output_elided_bytes")) {
    if (!Number.isSafeInteger(run.output_elided_bytes) || run.output_elided_bytes < 0) return null;
    facts.output_elided_bytes = run.output_elided_bytes;
  }
  if (typeof run.refusal_code === "string" && STABLE_CODE_RE.test(run.refusal_code)) {
    facts.refusal_code = run.refusal_code;
    if (typeof run.detail?.errno === "string" && STABLE_CODE_RE.test(run.detail.errno.toLowerCase())) {
      facts.detail = { errno: run.detail.errno };
    }
  }

  const spawnError = run.spawn_error_code ?? run.spawn_error;
  if (typeof spawnError === "string" && STABLE_CODE_RE.test(spawnError.toLowerCase())) {
    facts.spawn_error_code = spawnError;
  }
  const observation = run.test_proof_observation;
  if (observation?.code !== undefined) {
    if (typeof observation.code !== "string" || !STABLE_CODE_RE.test(observation.code)) return null;
    const detail = observationDetail(observation.code, observation.detail);
    if (detail === undefined) return null;
    facts.test_proof_observation = { code: observation.code, ...(detail === null ? {} : { detail }) };
  }
  if (Object.hasOwn(run, "completion") || Object.hasOwn(run, "completion_recovery")) {
    const unconfirmed = unconfirmedCompletion(run);
    if (unconfirmed === undefined) return null;
    Object.assign(facts, unconfirmed);
  }
  const cause = runCause(run) ?? nativeExecutionFailureDiagnostic(run);
  if (cause !== null) {
    if (!isLauncherTestFailureDiagnostic(cause)) return null;
    facts.failure_diagnostic = structuredClone(cause);
  }
  return facts;
}

export function publicRunFacts(run, { attributionCodes = new Set() } = {}) {
  const bounded = boundedRunFacts(run);
  if (bounded === null) return null;
  const { refusal_code: refusal, detail, failure_diagnostic: cause,
    test_proof_observation: observation, ...facts } = bounded;
  if (cause !== undefined) facts.failure_diagnostic = projectSelectedTestFailureDiagnostic(cause);

  if (facts.completion !== undefined) facts.ran = "unknown";
  if (refusal !== undefined) {
    facts.blocker_code = refusal;
    facts.ran = false;
    facts.disposition = "not_run";
    if (detail?.errno !== undefined) facts.filesystem_error_code = detail.errno;
  }
  if (observation !== undefined) {
    facts.structured_observation_code = observation.code;
    if (observation.code === TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.code) {
      const identity = projectTestProofForcedInvocationIdentityFailure(observation.detail);
      if (identity === null) return null;
      facts.forced_invocation_identity_failure = identity;
    } else if (observation.detail !== undefined &&
        (observation.code === NATIVE_INSTRUMENTATION_UNSUPPORTED_CODE ||
          attributionCodes.has(observation.code))) {
      facts.structured_observation_detail = observation.detail;
    }
  }
  return facts;
}
