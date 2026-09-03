import { createHash } from "node:crypto";
import { stableRuntimeTestIdFromParts } from
  "./workspace-agent-test-proof-node-reporter.mjs";

export const NODE_TEST_PROOF_REPORTER_PATH =
  "packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-reporter.mjs";
export const NODE_TEST_PROOF_FAULT_LOADER_PATH =
  "packages/agent-launch-cli/src/lib/workspace-agent-test-proof-module-fault-loader.mjs";

const REPORT_SCHEMA_VERSION = "workspace-agent-test-proof-node-events.v1";
const MAX_OBSERVED_IDENTITY_CANDIDATES = 8;
const STABLE_ERROR_CODE_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u;
export const TEST_PROOF_STRUCTURED_EVENTS_OVERSIZED_CODE =
  "test_proof_structured_events_oversized";

function safeObservedIdentityCandidate(event) {
  if (typeof event?.test_id !== "string" || !/^test-[a-f0-9]{64}$/u.test(event.test_id) ||
      typeof event.file !== "string" || event.file.length === 0 || event.file.length > 4096 ||
      event.file.startsWith("/") || event.file.includes("\\") ||
      event.file.split("/").some((part) => part === "" || part === "." || part === ".." ||
        !/^[A-Za-z0-9_.-]+$/u.test(part)) ||
      typeof event.name !== "string" || event.name.length === 0 || event.name.length > 512 ||
      /[\u0000-\u001f\u007f]/u.test(event.name) || event.name.startsWith("/") ||
      event.name.startsWith("file:") || /^[A-Za-z]:[\\/]/u.test(event.name) ||
      !Number.isSafeInteger(event.nesting) || event.nesting < 0 ||
      event.nesting > 1_000_000) return null;
  return { test_id: event.test_id, file: event.file, name: event.name,
    nesting: event.nesting };
}

function selectedIdentityNotObserved(expectation, testEvents) {
  const target = expectation?.target;
  const candidates = testEvents.map(safeObservedIdentityCandidate)
    .filter((candidate) => candidate !== null)
    .sort((left, right) => Number(right.file === target) - Number(left.file === target) ||
      left.file.localeCompare(right.file) || left.nesting - right.nesting ||
      left.name.localeCompare(right.name) || left.test_id.localeCompare(right.test_id))
    .slice(0, MAX_OBSERVED_IDENTITY_CANDIDATES);
  const wrapper = testEvents.find((event) => {
    if (event.nesting !== 0 || event.file !== target || typeof event.name !== "string") {
      return false;
    }
    const name = event.name.replaceAll("\\", "/");
    return name === target || name.endsWith(`/${target}`);
  });
  const wrapperErrorCodes = [...new Set((wrapper?.error_codes ?? []).filter(
    (code) => typeof code === "string" && STABLE_ERROR_CODE_RE.test(code)
  ))].sort().slice(0, 8);
  return {
    valid: false,
    code: "test_proof_selected_identity_not_observed",
    detail: {
      expected_test_id: expectation.target_test_id,
      target,
      observed_count: testEvents.length,
      returned_count: candidates.length,
      omitted_count: testEvents.length - candidates.length,
      observed_identity_candidates: candidates,
      file_wrapper_status: wrapper?.status ?? null,
      file_wrapper_error_codes: wrapperErrorCodes
    }
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(
    (key) => [key, canonicalize(value[key])]
  ));
}

export function canonicalLauncherArtifactJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

export function launcherArtifactDigest(value) {
  return `sha256:${createHash("sha256").update(canonicalLauncherArtifactJson(value)).digest("hex")}`;
}

function reporterDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")}`;
}

export function launcherArtifact(kind, payload) {
  const digest = launcherArtifactDigest(payload);
  return Object.freeze({
    artifact_id: `artifact-${digest.slice("sha256:".length)}`,
    kind,
    digest,
    payload: Object.freeze(canonicalize(payload)),
    owner: "launcher"
  });
}

function parseEnvelope(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return { valid: false, code: "test_proof_structured_events_invalid" };
  }
  if (envelope?.schema_version !== REPORT_SCHEMA_VERSION ||
      !Array.isArray(envelope.events) ||
      typeof envelope.reporter_nonce !== "string" ||
      !/^[a-f0-9]{64}$/u.test(envelope.reporter_nonce)) {
    return { valid: false, code: "test_proof_structured_events_invalid" };
  }
  if (envelope.events.some((event) => ![
    "test:coverage", "test:fail", "test:pass", "test:summary"
  ].includes(event?.type))) {
    return { valid: false, code: "test_proof_structured_events_untrusted_type" };
  }
  const payload = { schema_version: envelope.schema_version, events: envelope.events };
  if (reporterDigest(payload) !== envelope.event_digest ||
      reporterDigest({ ...payload, reporter_nonce: envelope.reporter_nonce }) !==
        envelope.reporter_attestation) {
    return { valid: false, code: "test_proof_structured_events_digest_mismatch" };
  }
  return { valid: true, payload };
}

export function observeLauncherNodeTestRun({
  stdout,
  exitCode,
  expectation,
  reporterProtocolOverflow = false
} = {}) {
  if (reporterProtocolOverflow === true) return {
    valid: false,
    code: TEST_PROOF_STRUCTURED_EVENTS_OVERSIZED_CODE
  };
  const parsed = parseEnvelope(stdout);
  if (!parsed.valid) return parsed;
  const events = parsed.payload.events;
  const summary = events.findLast(({ type }) => type === "test:summary")?.counts ?? null;
  if (summary === null) return { valid: false, code: "test_proof_structured_summary_missing" };
  const passEvents = events.filter(({ type }) => type === "test:pass");
  const failEvents = events.filter(({ type }) => type === "test:fail");
  const testEvents = [...passEvents, ...failEvents];
  if (testEvents.some((event) => event.test_id !== stableRuntimeTestIdFromParts({
    file: event.file,
    name: event.name,
    nesting: event.nesting
  }))) return {
    valid: false, code: "test_proof_structured_test_identity_invalid"
  };
  const testIds = testEvents.map(({ test_id: testId }) => testId);
  if (new Set(testIds).size !== testIds.length) return {
    valid: false, code: "test_proof_structured_test_identity_duplicate"
  };
  if (summary.tests !== testEvents.length) return {
    valid: false, code: "test_proof_structured_test_inventory_incomplete"
  };
  const coverageFiles = events.filter(({ type }) => type === "test:coverage")
    .flatMap(({ files }) => files ?? []).filter(({ covered_line_count: count }) => count > 0);
  const observedFailureReasonCodes = [...new Set(failEvents.flatMap(
    ({ error_codes: codes }) => codes ?? []
  ))].sort();
  const basePayload = {
    mechanism: "node_test_structured_events",
    exit_code: exitCode,
    summary,
    pass_events: passEvents,
    fail_events: failEvents
  };
  const structuredArtifact = launcherArtifact("structured_test_result", basePayload);
  const targetPassObserved = passEvents.some(
    ({ test_id: testId, status }) => testId === expectation?.target_test_id && status === "passed"
  );
  const targetFailureEvents = failEvents.filter(
    ({ test_id: testId, status }) => testId === expectation?.target_test_id && status === "failed"
  );
  const targetFailureObserved = targetFailureEvents.length > 0;
  if (!targetPassObserved && !targetFailureObserved) {
    return selectedIdentityNotObserved(expectation, testEvents);
  }
  if (expectation?.capability === "candidate_execution") return {
    valid: true,
    status: exitCode === 0 && summary.failed === 0 && summary.cancelled === 0
      ? "passed" : "failed",
    selected_status: targetPassObserved ? "passed" : "failed",
    structured_result: basePayload,
    test_inventory: {
      observed_test_ids: [...new Set(testEvents.map(({ test_id: id }) => id))].sort(),
      executed_test_ids: [...new Set(testEvents.filter(
        ({ status }) => status === "passed" || status === "failed"
      ).map(({ test_id: id }) => id))].sort(),
      skipped_test_ids: [...new Set(testEvents.filter(
        ({ status }) => status === "skipped" || status === "todo"
      ).map(({ test_id: id }) => id))].sort()
    },
    artifacts: [structuredArtifact]
  };
  if (expectation?.capability === "falsifier_execution") {
    const reason = expectation.failure_reason_code;
    const declaredFailureReasonObserved = typeof reason === "string" &&
      observedFailureReasonCodes.includes(reason);
    const targetDeclaredFailureReasonObserved = declaredFailureReasonObserved &&
      targetFailureEvents.some(({ error_codes: codes }) => codes?.includes(reason));
    const mutationAttestationObserved = targetFailureEvents.some(
      ({ error_codes: codes }) => codes?.includes(expectation.mutation_attestation_code)
    );
    const mutationObserved = targetFailureObserved && targetDeclaredFailureReasonObserved &&
      mutationAttestationObserved;
    const mutationPayload = {
      mechanism: "module_substitution",
      mutation_id: expectation.mutation_id,
      strategy: expectation.strategy,
      target_module_path: expectation.module_path,
      fault_module_identity: expectation.fault_module_identity,
      loader_module_path: expectation.loader_module_path,
      loader_function_name: expectation.loader_function_name,
      failure_reason_code: mutationObserved ? reason : null,
      structured_failure_event_count: failEvents.length,
      target_test_id: expectation.target_test_id,
      target_failure_observed: targetFailureObserved,
      structured_failure_error_codes: observedFailureReasonCodes,
      structured_event_digest: structuredArtifact.digest
    };
    return {
      valid: true,
      status: targetPassObserved ? "passed" : "failed",
      mutation_observed: mutationObserved,
      failure_reason_code: mutationObserved ? reason : null,
      mutation: mutationPayload,
      structured_result: basePayload,
      artifacts: [structuredArtifact, launcherArtifact("falsifier_result", mutationPayload)]
    };
  }
  if (expectation?.capability === "boundary_traversal") {
    const observed = coverageFiles.some(({ path }) => path === expectation.module_path);
    const boundaryPayload = {
      mechanism: "node_test_v8_coverage",
      boundary_kind: "module",
      module_path: expectation.module_path,
      observable_seam: expectation.observation_seam,
      target_test_id: expectation.target_test_id,
      target_pass_observed: targetPassObserved,
      observed,
      covered_module_paths: coverageFiles.map(({ path }) => path).sort(),
      structured_event_digest: structuredArtifact.digest
    };
    return {
      valid: true,
      status: targetPassObserved ? "passed" : "failed",
      traversal_observed: observed && targetPassObserved,
      boundary_observation: boundaryPayload,
      structured_result: basePayload,
      artifacts: [structuredArtifact, launcherArtifact("boundary_trace", boundaryPayload)]
    };
  }
  return { valid: false, code: "test_proof_observation_capability_invalid" };
}
