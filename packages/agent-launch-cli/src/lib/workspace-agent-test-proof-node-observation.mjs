import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE,
  parseTestProofModuleFaultWitnessName,
  verifyTestProofModuleFaultExpectation
} from "./workspace-agent-test-proof-module-fault-contract.mjs";
import { isLauncherTestFailureDiagnostic } from
  "./workspace-agent-test-proof-error-diagnostic.mjs";
import { stableRuntimeTestIdFromParts } from
  "./workspace-agent-test-proof-node-reporter.mjs";

export const NODE_TEST_PROOF_REPORTER_PATH =
  "packages/agent-launch-cli/src/lib/workspace-agent-test-proof-node-reporter.mjs";
const NODE_TEST_PROOF_FAULT_LOADER_URL = new URL(
  "./workspace-agent-test-proof-module-fault-loader.mjs", import.meta.url);

export const NODE_TEST_PROOF_LAUNCHER_ASSETS = Object.freeze([
  "./workspace-agent-test-proof-node-reporter.mjs",
  "./workspace-agent-test-proof-error-diagnostic.mjs",
  "./workspace-agent-test-proof-diagnostic-graph.cjs",
  "./workspace-agent-test-proof-module-fault-loader.mjs",
  "./workspace-agent-test-proof-module-fault-contract.mjs"
].map((relative) => fileURLToPath(new URL(relative, import.meta.url))));

const REPORT_SCHEMA_VERSION = "workspace-agent-test-proof-node-events.v1";
export const TEST_PROOF_STRUCTURED_EVENTS_OVERSIZED_CODE =
  "test_proof_structured_events_oversized";
export const TEST_PROOF_SELECTED_TEST_SKIPPED_CODE = "test_proof_selected_test_skipped";

export const NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES = 2 * 1024 * 1024;
export const LAUNCHER_NODE_TEST_INVENTORY_SCHEMA_VERSION =
  "launcher-node-test-observed-inventory.v1";
export const LAUNCHER_NODE_TEST_STABLE_IDENTITY = "launcher-stable-v1";

export function launcherNodeTestReporterUrl() {
  const url = new URL("./workspace-agent-test-proof-node-reporter.mjs", import.meta.url);
  url.searchParams.set("launcher_protocol_fd", "3");
  return url.href;
}

export function launcherNodeTestFaultLoaderUrl(configuration) {
  const url = new URL(NODE_TEST_PROOF_FAULT_LOADER_URL);
  url.searchParams.set("configuration", Buffer.from(JSON.stringify(configuration))
    .toString("base64url"));
  return url.href;
}

function projectedTestName(name, file) {
  if (typeof name !== "string" || typeof file !== "string" || file.length === 0) {
    return name;
  }
  const normalized = name.replaceAll("\\", "/");
  return normalized === file || normalized.endsWith(`/${file}`) ? file : name;
}

export function projectObservedTestFact(event) {
  return { test_id: event.test_id, file: event.file,
    name: projectedTestName(event.name, event.file),
    nesting: event.nesting, status: event.status,
    error_codes: [...(event.error_codes ?? [])],
    ...(event.failure_diagnostic === undefined ? {} : {
      failure_diagnostic: structuredClone(event.failure_diagnostic)
    }) };
}

function selectedIdentityNotObserved(expectation, testEvents) {
  const target = expectation?.target;
  const candidates = testEvents.map(projectObservedTestFact)
    .sort((left, right) => Number(right.file === target) - Number(left.file === target) ||
      (left.file ?? "").localeCompare(right.file ?? "") || left.nesting - right.nesting ||
      (left.name ?? "").localeCompare(right.name ?? "") || left.test_id.localeCompare(right.test_id));
  const wrapper = testEvents.find((event) => {
    if (event.nesting !== 0 || event.file !== target || typeof event.name !== "string") {
      return false;
    }
    const name = event.name.replaceAll("\\", "/");
    return name === target || name.endsWith(`/${target}`);
  });
  const wrapperErrorCodes = [...new Set(wrapper?.error_codes ?? [])].sort();
  const failures = testEvents.filter((event) => event.type === "test:fail")
    .map(projectObservedTestFact);
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
      file_wrapper_error_codes: wrapperErrorCodes,
      observed_failures: failures,
      observed_failure_count: failures.length
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

function validAncestorTestIds(value) {
  return value === null || (Array.isArray(value) &&
    value.every((id) => typeof id === "string" && /^test-[a-f0-9]{64}$/u.test(id)) &&
    new Set(value).size === value.length);
}

function structuredTestEvent({ ancestor_test_ids: _ancestorTestIds, ...event }) {
  return event;
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
  if (envelope.events.some((event) => event?.type === "test:fail" &&
      !isLauncherTestFailureDiagnostic(event.failure_diagnostic))) {
    return { valid: false, code: "test_proof_structured_events_invalid" };
  }
  if (envelope.events.some((event) => (event.type === "test:pass" || event.type === "test:fail") &&
      !validAncestorTestIds(event.ancestor_test_ids))) {
    return { valid: false, code: "test_proof_structured_events_invalid" };
  }
  const payload = { schema_version: envelope.schema_version, events: envelope.events };
  if (reporterDigest(payload) !== envelope.event_digest ||
      reporterDigest({ ...payload, reporter_nonce: envelope.reporter_nonce }) !==
        envelope.reporter_attestation) {
    return { valid: false, code: "test_proof_structured_events_digest_mismatch" };
  }
  return { valid: true, payload, event_digest: envelope.event_digest,
    reporter_attestation: envelope.reporter_attestation };
}

export function authenticateLauncherNodeTestEvents({
  stdout,
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
    valid: false, code: "test_proof_structured_test_identity_duplicate",
    detail: { duplicate_test_ids: [...new Set(testIds.filter(
      (id, index) => testIds.indexOf(id) !== index))].sort() }
  };
  if (summary.tests !== testEvents.length) return {
    valid: false, code: "test_proof_structured_test_inventory_incomplete",
    detail: { summary_tests: summary.tests, observed_tests: testEvents.length }
  };
  return { valid: true, events, summary, passEvents, failEvents, testEvents,
    event_digest: parsed.event_digest, reporter_attestation: parsed.reporter_attestation };
}

export function projectLauncherNodeTestInventory(authenticated) {
  if (authenticated?.valid !== true) throw new TypeError(
    "inventory projection requires an authenticated structured-event population"
  );
  const tests = authenticated.testEvents.map(projectObservedTestFact).sort((left, right) =>
    (left.file ?? "").localeCompare(right.file ?? "") || left.nesting - right.nesting ||
    (left.name ?? "").localeCompare(right.name ?? "") || left.test_id.localeCompare(right.test_id));
  const count = (status) => tests.filter((fact) => fact.status === status).length;
  return {
    schema_version: LAUNCHER_NODE_TEST_INVENTORY_SCHEMA_VERSION,
    mechanism: "node_test_structured_events",
    stable_identity: LAUNCHER_NODE_TEST_STABLE_IDENTITY,
    complete: true,
    event_digest: authenticated.event_digest,
    reporter_attestation: authenticated.reporter_attestation,
    counts: {
      observed: tests.length,
      executed: count("passed") + count("failed"),
      passed: count("passed"),
      failed: count("failed"),
      skipped: count("skipped"),
      todo: count("todo"),
      summary: { ...authenticated.summary }
    },
    tests
  };
}

export const TEST_PROOF_MODULE_FAULT_OBSERVATION_CODES = Object.freeze({
  EXPECTATION_INVALID: "test_proof_module_fault_expectation_invalid",
  WITNESS_IDENTITY_MISMATCH: "test_proof_module_fault_witness_identity_mismatch",
  INSTRUMENTATION_UNAVAILABLE: "test_proof_module_fault_instrumentation_unavailable",
  SELECTION_UNATTRIBUTABLE: "test_proof_module_fault_selection_unattributable"
});

function moduleFaultUnavailable(code, detail) {
  return { valid: false, code, ...(detail === undefined ? {} : { detail }) };
}

function declaredCoverageFunctions(events, modulePath) {
  const rows = events.filter(({ type }) => type === "test:coverage")
    .flatMap(({ files }) => files ?? []).filter(({ path }) => path === modulePath);
  return rows.length === 0 ? null : rows.flatMap(({ functions }) =>
    Array.isArray(functions) ? functions : [null]);
}

function moduleFaultWitnessPopulation(events, attempt) {
  const functions = declaredCoverageFunctions(events, attempt.witness_module_path) ?? [];
  const counts = Object.fromEntries(Object.keys(attempt.witness_names).map(name => [name, null]));
  let mismatched = 0;
  let malformed = false;
  for (const fn of functions) {
    const parsed = parseTestProofModuleFaultWitnessName(fn?.name);
    if (parsed === null) continue;
    if (parsed.identity !== attempt.witness_identity || !Object.hasOwn(counts, parsed.base)) {
      mismatched += 1;
    } else if (!Number.isSafeInteger(fn.count) || fn.count < 0) malformed = true;
    else counts[parsed.base] = (counts[parsed.base] ?? 0) + fn.count;
  }
  if (mismatched > 0) return moduleFaultUnavailable(
    TEST_PROOF_MODULE_FAULT_OBSERVATION_CODES.WITNESS_IDENTITY_MISMATCH,
    { witness_module_path: attempt.witness_module_path, mismatched_witness_count: mismatched });
  const missing = Object.keys(counts).filter(name => counts[name] === null).sort();
  if (malformed || missing.length > 0) return moduleFaultUnavailable(
    TEST_PROOF_MODULE_FAULT_OBSERVATION_CODES.INSTRUMENTATION_UNAVAILABLE,
    { witness_module_path: attempt.witness_module_path, missing_witnesses: missing,
      malformed_witness_count: malformed });
  return { valid: true, counts };
}

function declaredFunctionCount(events, modulePath, name) {
  const functions = declaredCoverageFunctions(events, modulePath);
  if (functions === null) return null;
  let total = 0;
  for (const fn of functions) {
    if (fn?.name !== name) continue;
    if (!Number.isSafeInteger(fn.count) || fn.count < 0) return null;
    total += fn.count;
  }
  return total;
}

function forcedInvocationFacts(events, attempt, counts) {
  const { configuration } = attempt;

  const identityReasons = Object.entries(TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.reasons)
    .filter(([, descriptor]) => counts[descriptor.witness] > 0).map(([reason]) => reason);
  if (identityReasons.length > 1) {
    return { valid: false, code: "test_proof_forced_invocation_identity_reason_inconsistent" };
  }
  if (identityReasons.length === 1) return {
    valid: false, code: TEST_PROOF_FORCED_INVOCATION_IDENTITY_FAILURE.code,
    detail: { reason: identityReasons[0], module_path: configuration.operation.module_path,
      export_name: configuration.operation.export_name }
  };
  const entry = declaredFunctionCount(events, configuration.module_path, configuration.entry_export);
  const operation = declaredFunctionCount(events, configuration.operation.module_path,
    configuration.operation.export_name);
  if (entry === null || operation === null) return moduleFaultUnavailable(
    TEST_PROOF_MODULE_FAULT_OBSERVATION_CODES.INSTRUMENTATION_UNAVAILABLE,
    { missing_module_paths: [...(entry === null ? [configuration.module_path] : []),
      ...(operation === null ? [configuration.operation.module_path] : [])] });
  const observation = { original_entry_count: entry, operation_entry_count: operation,
    inspector_original_entry_count: counts.launcherObservedOriginalEntry,
    inspector_ordered_operation_count: counts.launcherObservedOrderedOperationEntry,
    invalid_order_count: counts.launcherObservedInvalidOrder,
    inspection_failure_count: counts.launcherObservedInspectionFailure };
  return { valid: true, observation,
    selection: { entry_export: configuration.entry_export, operation: configuration.operation,
      invocation: configuration.invocation },
    reached: entry > 0 && operation > 0 && observation.inspector_original_entry_count > 0 &&
      observation.inspector_ordered_operation_count > 0 && observation.invalid_order_count === 0 &&
      observation.inspection_failure_count === 0 };
}

function dependencyFailureFacts(_events, _attempt, counts) {
  const invocations = counts.launcherObservedDependencyInvocation;
  return { valid: true, selection: {}, reached: invocations > 0,
    observation: { dependency_invocation_count: invocations } };
}

const MODULE_FAULT_STRATEGY_FACTS = Object.freeze({
  dependency_failure: dependencyFailureFacts,
  forced_invocation: forcedInvocationFacts
});

function observeModuleFaultRun({ attempt, expectation, events, testEvents, inSelectedTree,
  basePayload, structuredArtifact, targetPassObserved, targetFailureObserved }) {
  const unattributed = [...new Set(testEvents.filter(event =>
    (event.status === "passed" || event.status === "failed") && !inSelectedTree(event))
    .map(({ test_id: id }) => id))].sort();
  if (unattributed.length > 0) return moduleFaultUnavailable(
    TEST_PROOF_MODULE_FAULT_OBSERVATION_CODES.SELECTION_UNATTRIBUTABLE,
    { expected_test_id: expectation.target_test_id, unattributed_test_ids: unattributed });
  const population = moduleFaultWitnessPopulation(events, attempt);
  if (!population.valid) return population;
  const facts = MODULE_FAULT_STRATEGY_FACTS[attempt.strategy](events, attempt, population.counts);
  if (!facts.valid) return facts;
  const { configuration } = attempt;
  const mutation = {
    mechanism: configuration.mechanism, strategy: configuration.strategy,
    mutation_id: configuration.mutation_id, target_module_path: configuration.module_path,
    ...facts.selection,
    attempt_nonce: configuration.attempt_nonce,
    fault_module_identity: expectation.fault_module_identity,
    observer_module_path: attempt.witness_module_path,
    witness_identity: attempt.witness_identity, target_test_id: expectation.target_test_id,
    structured_event_digest: structuredArtifact.digest,
    observation: { ...facts.observation, reached_assertion: targetFailureObserved,
      selected_test_only: true, observed: facts.reached }
  };
  return { valid: true, status: targetPassObserved ? "passed" : "failed",
    mutation_observed: facts.reached,
    failure_reason_code: facts.reached ? attempt.failure_reason_code : null,
    mutation, structured_result: basePayload,
    artifacts: [structuredArtifact, launcherArtifact("falsifier_result", mutation)] };
}

export function observeLauncherNodeTestRun({
  stdout,
  exitCode,
  expectation,
  reporterProtocolOverflow = false
} = {}) {
  const authenticated = authenticateLauncherNodeTestEvents({ stdout, reporterProtocolOverflow });
  if (!authenticated.valid) return { valid: false, code: authenticated.code };
  let moduleFaultAttempt = null;
  if (expectation?.capability === "falsifier_execution") {
    try {
      moduleFaultAttempt = verifyTestProofModuleFaultExpectation(expectation);
    } catch (error) {
      return moduleFaultUnavailable(TEST_PROOF_MODULE_FAULT_OBSERVATION_CODES.EXPECTATION_INVALID,
        { message: error.message });
    }
  }
  const { events, summary, passEvents, failEvents, testEvents } = authenticated;
  const coverageFiles = events.filter(({ type }) => type === "test:coverage")
    .flatMap(({ files }) => files ?? []).filter(({ covered_line_count: count }) => count > 0);
  const basePayload = {
    mechanism: "node_test_structured_events",
    exit_code: exitCode,
    summary,
    pass_events: passEvents.map(structuredTestEvent),
    fail_events: failEvents.map(structuredTestEvent)
  };

  const inSelectedTree = ({ test_id: testId, ancestor_test_ids: ancestors }) =>
    testId === expectation?.target_test_id ||
    (Array.isArray(ancestors) && ancestors.includes(expectation?.target_test_id));
  const structuredArtifact = launcherArtifact("structured_test_result", basePayload);
  const targetPassObserved = passEvents.some(
    ({ test_id: testId, status }) => testId === expectation?.target_test_id && status === "passed"
  );
  const targetFailureEvents = failEvents.filter(
    ({ test_id: testId, status }) => testId === expectation?.target_test_id && status === "failed"
  );
  const targetFailureObserved = targetFailureEvents.length > 0;
  if (!targetPassObserved && !targetFailureObserved) {
    const notObserved = selectedIdentityNotObserved(expectation, testEvents);

    const selectedSkip = expectation?.capability === "candidate_execution"
      ? testEvents.find(({ test_id: testId, status }) =>
        testId === expectation.target_test_id && status === "skipped")
      : undefined;
    return selectedSkip === undefined ? notObserved : {
      ...notObserved,
      code: TEST_PROOF_SELECTED_TEST_SKIPPED_CODE,
      detail: { ...notObserved.detail, selected_event: projectObservedTestFact(selectedSkip) }
    };
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
  if (moduleFaultAttempt !== null) return observeModuleFaultRun({ attempt: moduleFaultAttempt,
    expectation, events, testEvents, inSelectedTree, basePayload, structuredArtifact,
    targetPassObserved, targetFailureObserved });
  if (expectation?.capability === "boundary_traversal") {

    const observed = coverageFiles.some(({ path, functions }) =>
      path === expectation.module_path && (functions ?? []).some(
        ({ count }) => Number.isSafeInteger(count) && count > 0));
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
