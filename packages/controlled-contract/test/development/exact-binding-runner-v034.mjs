import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

import {
  BINDING_RESULT_VERSION,
  BINDING_SET_VERSION,
  bindingSetDigest,
  canonicalBindingSet,
  canonicalBytes,
  canonicalJsonClone,
  canonicalRoleCoverage,
  evaluateExactBindingsV034,
  freezeDeep,
  sha256,
  validateBindingSet,
  validateEvaluationInputReferenceBindings,
  validateRequirements
} from "./exact-binding-v034.mjs";

const RUNNER_RESULT_VERSION =
  "controlled-contract-exact-binding-runner-result.experimental.v0.1";
const ARTIFACT_MEDIA_TYPE = "application/octet-stream";
const REACHABILITY_MEDIA_TYPE =
  "application/vnd.controlled-contract.complete-reachability-snapshot+json";
const MUTATION_MEDIA_TYPE =
  "application/vnd.controlled-contract.observed-execution-mutations+json";
const SHA256 = /^[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9-]*$/u;

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function diagnosticKey(value) {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? `bigint:${item}` : item
  );
}

function stableStat(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    mode: stat.mode.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString()
  };
}

function equalStableStat(left, right) {
  return left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.size === right.size &&
    left.mtimeNs === right.mtimeNs;
}

function isWithinRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function assertOnlyKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_invalid`);
  }
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) throw new Error(
    `${label}_unknown_fields:${unexpected.sort(compareCodeUnits).join(",")}`
  );
}

function checkExpectedDigest(actual, expected, label) {
  if (expected === undefined) return;
  if (!SHA256.test(expected)) throw new Error(`${label}_expected_sha256_invalid`);
  if (actual !== expected) throw new Error(
    `${label}_stale_expected_digest:expected=${expected}:actual=${actual}`
  );
}

function immutableCapture({ bytes, kind, mediaType, sourceObservation }) {
  const capturedBytes = Buffer.from(bytes);
  const digest = sha256(capturedBytes);
  return freezeDeep({
    kind,
    media_type: mediaType,
    content_sha256: digest,
    byte_length: capturedBytes.byteLength,
    source_observation: sourceObservation,
    copy_bytes: () => Buffer.from(capturedBytes)
  });
}

async function captureArtifactBytes({
  source_path: sourcePath,
  capture_root: captureRoot,
  expected_sha256: expectedSha256
}, { after_open: afterOpen } = {}) {
  if (typeof sourcePath !== "string" || typeof captureRoot !== "string") {
    throw new Error("artifact_capture_path_and_root_required");
  }
  const root = await realpath(captureRoot);
  const requested = path.resolve(sourcePath);
  let handle;
  try {
    handle = await open(requested, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (["ELOOP", "EMLINK"].includes(error.code)) {
      throw new Error("artifact_capture_final_symlink_refused");
    }
    throw error;
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new Error("artifact_capture_not_regular_file");
    let openedPath;
    try {
      openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
    } catch (error) {
      throw new Error(`artifact_capture_open_fd_identity_unavailable:${error.code ?? "unknown"}`);
    }
    if (!isWithinRoot(openedPath, root)) throw new Error(
      "artifact_capture_opened_object_outside_root"
    );
    if (afterOpen) await afterOpen({ opened_path: openedPath });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!equalStableStat(before, after) || BigInt(bytes.byteLength) !== after.size) {
      throw new Error("artifact_capture_inode_changed_during_read");
    }
    const capture = immutableCapture({
      bytes,
      kind: "artifact_bytes",
      mediaType: ARTIFACT_MEDIA_TYPE,
      sourceObservation: {
        requested_path: requested,
        opened_path: openedPath,
        opened_file_identity: stableStat(after)
      }
    });
    checkExpectedDigest(capture.content_sha256, expectedSha256, "artifact_capture");
    return capture;
  } finally {
    await handle.close();
  }
}

function normalizeString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label}_invalid`);
  const normalized = value.normalize("NFC");
  if (normalized.includes("\u0000")) throw new Error(`${label}_nul_refused`);
  return normalized;
}

function uniqueBy(values, keyFor, label) {
  const seen = new Set();
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) throw new Error(`${label}_duplicate:${key}`);
    seen.add(key);
  }
}

function encodeCompleteReachabilitySnapshot(snapshot) {
  assertOnlyKeys(snapshot, new Set([
    "snapshot_id", "snapshot_reference_id", "complete", "nodes", "edges"
  ]), "reachability_snapshot");
  if (snapshot.complete !== true) throw new Error("reachability_snapshot_not_complete");
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) {
    throw new Error("reachability_snapshot_populations_required");
  }
  const nodes = snapshot.nodes.map((node) => {
    assertOnlyKeys(node, new Set([
      "node_id", "node_reference_id", "kind"
    ]), "reachability_node");
    return {
      node_id: normalizeString(node.node_id, "reachability_node_id"),
      node_reference_id: normalizeString(
        node.node_reference_id, "reachability_node_reference_id"
      ),
      kind: normalizeString(node.kind, "reachability_node_kind")
    };
  }).sort((left, right) => compareCodeUnits(left.node_id, right.node_id));
  uniqueBy(nodes, ({ node_id: id }) => id, "reachability_node_id");
  uniqueBy(nodes, ({ node_reference_id: id }) => id,
    "reachability_node_reference_id");
  const nodeIds = new Set(nodes.map(({ node_id: id }) => id));
  const edges = snapshot.edges.map((edge) => {
    assertOnlyKeys(edge, new Set(["from", "to", "kind"]), "reachability_edge");
    const normalized = {
      from: normalizeString(edge.from, "reachability_edge_from"),
      to: normalizeString(edge.to, "reachability_edge_to"),
      kind: normalizeString(edge.kind, "reachability_edge_kind")
    };
    if (!nodeIds.has(normalized.from) || !nodeIds.has(normalized.to)) {
      throw new Error("reachability_edge_endpoint_missing");
    }
    return normalized;
  }).sort((left, right) => compareCodeUnits(
    `${left.from}\u0000${left.to}\u0000${left.kind}`,
    `${right.from}\u0000${right.to}\u0000${right.kind}`
  ));
  uniqueBy(edges, (edge) => `${edge.from}\u0000${edge.to}\u0000${edge.kind}`,
    "reachability_edge");
  return canonicalBytes({
    snapshot_format: "complete-reachability.experimental.v0.1",
    snapshot_id: normalizeString(snapshot.snapshot_id, "reachability_snapshot_id"),
    snapshot_reference_id: normalizeString(
      snapshot.snapshot_reference_id, "reachability_snapshot_reference_id"
    ),
    complete: true,
    nodes,
    edges
  });
}

function encodeObservedExecutionMutationSnapshot(snapshot) {
  assertOnlyKeys(snapshot, new Set([
    "execution_id", "execution_reference_id", "complete", "mutations"
  ]), "mutation_snapshot");
  if (snapshot.complete !== true) throw new Error("mutation_snapshot_not_complete");
  if (!Array.isArray(snapshot.mutations)) throw new Error(
    "mutation_snapshot_population_required"
  );
  const mutations = snapshot.mutations.map((mutation) => {
    assertOnlyKeys(mutation, new Set([
      "mutation_reference_id", "target_id", "operation", "before_sha256",
      "after_sha256"
    ]), "mutation_entry");
    if (!["create", "update", "delete"].includes(mutation.operation)) {
      throw new Error("mutation_operation_invalid");
    }
    for (const field of ["before_sha256", "after_sha256"]) {
      if (mutation[field] !== null && !SHA256.test(mutation[field] ?? "")) {
        throw new Error(`mutation_${field}_invalid`);
      }
    }
    if (mutation.operation === "create" &&
        (mutation.before_sha256 !== null || mutation.after_sha256 === null)) {
      throw new Error("mutation_create_digest_shape_invalid");
    }
    if (mutation.operation === "delete" &&
        (mutation.before_sha256 === null || mutation.after_sha256 !== null)) {
      throw new Error("mutation_delete_digest_shape_invalid");
    }
    if (mutation.operation === "update" &&
        (mutation.before_sha256 === null || mutation.after_sha256 === null ||
         mutation.before_sha256 === mutation.after_sha256)) {
      throw new Error("mutation_update_digest_shape_invalid");
    }
    return {
      mutation_reference_id: normalizeString(
        mutation.mutation_reference_id, "mutation_reference_id"
      ),
      target_id: normalizeString(mutation.target_id, "mutation_target_id"),
      operation: mutation.operation,
      before_sha256: mutation.before_sha256,
      after_sha256: mutation.after_sha256
    };
  }).sort((left, right) => compareCodeUnits(
    left.mutation_reference_id, right.mutation_reference_id
  ));
  uniqueBy(mutations, ({ mutation_reference_id: id }) => id,
    "mutation_reference_id");
  return canonicalBytes({
    snapshot_format: "observed-execution-mutations.experimental.v0.1",
    execution_id: normalizeString(snapshot.execution_id, "mutation_execution_id"),
    execution_reference_id: normalizeString(
      snapshot.execution_reference_id, "mutation_execution_reference_id"
    ),
    complete: true,
    mutations
  });
}

function captureCanonicalSnapshot({ binding_kind: bindingKind, snapshot,
  expected_sha256: expectedSha256 }) {
  let bytes;
  let mediaType;
  if (bindingKind === "complete_reachability_snapshot") {
    bytes = encodeCompleteReachabilitySnapshot(snapshot);
    mediaType = REACHABILITY_MEDIA_TYPE;
  } else if (bindingKind === "observed_execution_mutation_snapshot") {
    bytes = encodeObservedExecutionMutationSnapshot(snapshot);
    mediaType = MUTATION_MEDIA_TYPE;
  } else throw new Error("canonical_snapshot_binding_kind_invalid");
  const capture = immutableCapture({
    bytes,
    kind: bindingKind,
    mediaType,
    sourceObservation: { canonical_snapshot: true }
  });
  checkExpectedDigest(capture.content_sha256, expectedSha256, "snapshot_capture");
  return capture;
}

function captureIdFor(request, capture) {
  return `cap-${sha256(canonicalBytes({
    requirement_id: request.requirement_id,
    binding_kind: request.binding_kind,
    content_sha256: capture.content_sha256,
    byte_length: capture.byte_length,
    role_coverage: canonicalRoleCoverage(request.role_coverage)
  })).slice(0, 24)}`;
}

function bindingFromCapture(request, capture) {
  if (capture.kind !== request.binding_kind) throw new Error(
    `capture_kind_mismatch:${request.requirement_id}`
  );
  return {
    binding_id: `bind-${request.requirement_id}`,
    requirement_id: request.requirement_id,
    capture_id: captureIdFor(request, capture),
    binding_kind: capture.kind,
    media_type: capture.media_type,
    content_sha256: capture.content_sha256,
    byte_length: capture.byte_length,
    role_coverage: canonicalRoleCoverage(request.role_coverage)
  };
}

async function captureRequest(request, hooks = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("capture_request_invalid");
  }
  assertOnlyKeys(request, new Set([
    "requirement_id", "binding_kind", "role_coverage", "role_projections", "source_path",
    "capture_root", "snapshot", "expected_sha256"
  ]), `capture_request_${request.requirement_id ?? "unknown"}`);
  const capture = request.binding_kind === "artifact_bytes"
    ? await captureArtifactBytes({
      source_path: request.source_path,
      capture_root: request.capture_root,
      expected_sha256: request.expected_sha256
    }, { after_open: hooks.after_open?.[request.requirement_id] })
    : captureCanonicalSnapshot(request);
  if (request.binding_kind === "artifact_bytes") {
    if (!Array.isArray(request.role_coverage) || request.role_projections !== undefined) {
      throw new Error("artifact_capture_role_coverage_required");
    }
    const roles = new Set();
    const roleCoverage = request.role_coverage.map((coverage, index) => {
      assertOnlyKeys(coverage, new Set([
        "role", "projection", "reference_ids"
      ]), `artifact_capture_role_coverage_${index}`);
      if (typeof coverage.role !== "string" || roles.has(coverage.role)) {
        throw new Error(`artifact_capture_role_invalid:${coverage.role ?? "unknown"}`);
      }
      roles.add(coverage.role);
      if (coverage.projection !== "artifact_subject" ||
          !Array.isArray(coverage.reference_ids) || coverage.reference_ids.length !== 1 ||
          coverage.reference_ids.some((id) => typeof id !== "string") ||
          new Set(coverage.reference_ids).size !== coverage.reference_ids.length) {
        throw new Error(`artifact_capture_role_coverage_invalid:${coverage.role}`);
      }
      return coverage;
    });
    return { request: { ...request, role_coverage: canonicalRoleCoverage(roleCoverage) }, capture };
  }
  if (request.role_coverage !== undefined || !Array.isArray(request.role_projections)) {
    throw new Error("snapshot_capture_role_projections_required");
  }
  const canonicalSnapshot = JSON.parse(capture.copy_bytes().toString("utf8"));
  const subjectReferenceId = request.binding_kind === "complete_reachability_snapshot"
    ? canonicalSnapshot.snapshot_reference_id
    : canonicalSnapshot.execution_reference_id;
  const populationReferenceIds = request.binding_kind === "complete_reachability_snapshot"
    ? canonicalSnapshot.nodes.map(({ node_reference_id: id }) => id)
    : canonicalSnapshot.mutations.map(({ mutation_reference_id: id }) => id);
  const roles = new Set();
  const roleCoverage = request.role_projections.map((roleProjection, index) => {
    assertOnlyKeys(
      roleProjection, new Set(["role", "projection"]),
      `snapshot_capture_role_projection_${index}`
    );
    const { role, projection } = roleProjection;
    if (typeof role !== "string") throw new Error("snapshot_capture_role_invalid");
    if (roles.has(role)) throw new Error(`snapshot_capture_role_duplicate:${role}`);
    roles.add(role);
    if (!["snapshot_subject", "snapshot_population"].includes(projection)) {
      throw new Error(`snapshot_capture_projection_invalid:${projection}`);
    }
    return {
      role,
      projection,
      reference_ids: projection === "snapshot_subject"
        ? [subjectReferenceId]
        : populationReferenceIds
    };
  });
  return {
    request: { ...request, role_coverage: roleCoverage },
    capture
  };
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw new Error(`${label}_invalid_json:${error.message}`);
  }
}

function validateCapturedByteCheck(check, index) {
  const label = `captured_byte_checks[${index}]`;
  if (!check || typeof check !== "object" || Array.isArray(check)) {
    throw new Error(`${label}_invalid`);
  }
  assertOnlyKeys(check, new Set([
    "check_id", "requirement_ids", "mode", "expected_result", "run"
  ]), label);
  if (!ID.test(check.check_id ?? "")) throw new Error(`${label}_check_id_invalid`);
  if (!Array.isArray(check.requirement_ids) || check.requirement_ids.length === 0 ||
      check.requirement_ids.some((id) => !ID.test(id ?? "")) ||
      new Set(check.requirement_ids).size !== check.requirement_ids.length) {
    throw new Error(`${label}_requirement_ids_invalid`);
  }
  if (typeof check.run !== "function") throw new Error(`${label}_run_invalid`);
  const hasExpected = Object.hasOwn(check, "expected_result");
  const mode = check.mode ?? "required";
  if (!new Set(["required", "informational"]).has(mode)) {
    throw new Error(`${label}_mode_invalid`);
  }
  if (mode === "required" && !hasExpected) {
    throw new Error(`${label}_expected_result_required`);
  }
  if (mode === "informational" && hasExpected) {
    throw new Error(`${label}_informational_expected_result_forbidden`);
  }
  return { mode };
}

function canonicalEqual(left, right) {
  return canonicalBytes(left).equals(canonicalBytes(right));
}

function diagnostic(code, fields = {}) {
  return { code, ...fields };
}

function validateExactBindingRunnerEnvelopeV034(envelope) {
  const diagnostics = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return [
    diagnostic("runner_envelope_invalid")
  ];
  const expectedEnvelopeKeys = new Set([
    "result_version", "authority", "admission", "satisfaction", "inputs",
    "binding_set_sha256", "bindings", "captured_byte_checks", "evaluation"
  ]);
  const unknownEnvelopeKeys = Object.keys(envelope).filter(
    (key) => !expectedEnvelopeKeys.has(key)
  ).sort(compareCodeUnits);
  if (unknownEnvelopeKeys.length > 0) diagnostics.push(diagnostic(
    "runner_envelope_unknown_fields", { fields: unknownEnvelopeKeys }
  ));
  if (envelope.result_version !== RUNNER_RESULT_VERSION) diagnostics.push(diagnostic(
    "runner_result_version_invalid"
  ));
  const expectedAuthority = { kind: "free_tier_local", authoritative: false };
  const expectedAdmission = {
    kind: "local_exact_byte_capture",
    capture_verified: true,
    filesystem_paths_authoritative: false,
    caller_reported_digests_authoritative: false
  };
  try {
    if (!canonicalEqual(envelope.authority, expectedAuthority)) diagnostics.push(diagnostic(
      "runner_authority_invalid"
    ));
    if (!canonicalEqual(envelope.admission, expectedAdmission)) diagnostics.push(diagnostic(
      "runner_admission_invalid"
    ));
  } catch {
    diagnostics.push(diagnostic("runner_authority_or_admission_invalid"));
  }
  const bindingSet = {
    binding_set_version: BINDING_SET_VERSION,
    context: envelope.inputs,
    bindings: envelope.bindings
  };
  const bindingDiagnostics = validateBindingSet(bindingSet);
  diagnostics.push(...bindingDiagnostics.map((entry) => diagnostic(
    "runner_binding_set_invalid", { detail: entry }
  )));
  let computedDigest = null;
  if (bindingDiagnostics.length === 0) computedDigest = bindingSetDigest(bindingSet);
  if (!SHA256.test(envelope.binding_set_sha256 ?? "") ||
      computedDigest !== envelope.binding_set_sha256) diagnostics.push(diagnostic(
    "runner_binding_set_digest_mismatch",
    { expected: computedDigest, actual: envelope.binding_set_sha256 ?? null }
  ));
  const evaluation = envelope.evaluation;
  if (!evaluation || typeof evaluation !== "object" || Array.isArray(evaluation)) {
    diagnostics.push(diagnostic("runner_evaluation_invalid"));
  } else {
    if (evaluation.result_version !== BINDING_RESULT_VERSION) diagnostics.push(diagnostic(
      "runner_evaluation_result_version_invalid"
    ));
    try {
      if (!canonicalEqual(evaluation.authority, expectedAuthority)) diagnostics.push(diagnostic(
        "runner_evaluation_authority_invalid"
      ));
      if (!canonicalEqual(evaluation.admission, {
        kind: "unadmitted_direct", capture_verified: false
      })) diagnostics.push(diagnostic("runner_evaluation_admission_invalid"));
      if (!canonicalEqual(envelope.bindings, evaluation.bindings)) diagnostics.push(diagnostic(
        "runner_evaluation_bindings_mismatch"
      ));
    } catch {
      diagnostics.push(diagnostic("runner_evaluation_repeated_fields_invalid"));
    }
    if (evaluation.binding_set_sha256 !== envelope.binding_set_sha256) {
      diagnostics.push(diagnostic("runner_evaluation_binding_set_digest_mismatch"));
    }
  }
  let checksShapeValid = true;
  let requiredChecksPassed = true;
  if (!Array.isArray(envelope.captured_byte_checks)) {
    diagnostics.push(diagnostic("runner_captured_byte_checks_invalid"));
    checksShapeValid = false;
  } else {
    const checkIds = new Set();
    for (const [index, check] of envelope.captured_byte_checks.entries()) {
      const location = `captured_byte_checks[${index}]`;
      if (!check || typeof check !== "object" || Array.isArray(check)) {
        diagnostics.push(diagnostic("runner_captured_byte_check_invalid", { location }));
        checksShapeValid = false;
        continue;
      }
      const allowed = new Set([
        "check_id", "requirement_ids", "mode", "result", "expected_result", "passed"
      ]);
      const unknown = Object.keys(check).filter((key) => !allowed.has(key));
      if (!ID.test(check.check_id ?? "") || checkIds.has(check.check_id) ||
          !Array.isArray(check.requirement_ids) || check.requirement_ids.length === 0 ||
          check.requirement_ids.some((id) => !ID.test(id ?? "")) ||
          new Set(check.requirement_ids).size !== check.requirement_ids.length ||
          unknown.length > 0 || !["required", "informational"].includes(check.mode)) {
        diagnostics.push(diagnostic("runner_captured_byte_check_invalid", { location }));
        checksShapeValid = false;
      }
      checkIds.add(check.check_id);
      try {
        canonicalBytes(check.result);
      } catch {
        diagnostics.push(diagnostic("runner_captured_byte_check_result_invalid", { location }));
        checksShapeValid = false;
      }
      if (check.mode === "required") {
        if (!Object.hasOwn(check, "expected_result") || typeof check.passed !== "boolean") {
          diagnostics.push(diagnostic("runner_required_check_shape_invalid", { location }));
          checksShapeValid = false;
        } else {
          let actualPassed = false;
          try {
            actualPassed = canonicalEqual(check.result, check.expected_result);
          } catch {
            diagnostics.push(diagnostic(
              "runner_required_check_expected_result_invalid", { location }
            ));
            checksShapeValid = false;
          }
          if (check.passed !== actualPassed) diagnostics.push(diagnostic(
            "runner_required_check_pass_state_mismatch", { location }
          ));
          requiredChecksPassed &&= actualPassed;
        }
      } else if (Object.hasOwn(check, "expected_result") || check.passed !== null) {
        diagnostics.push(diagnostic("runner_informational_check_shape_invalid", { location }));
        checksShapeValid = false;
      }
    }
  }
  if (evaluation && typeof evaluation === "object" && checksShapeValid) {
    const expectedSatisfaction = evaluation.satisfaction === "satisfied" &&
      !requiredChecksPassed
      ? "unsatisfied"
      : evaluation.satisfaction;
    if (envelope.satisfaction !== expectedSatisfaction) diagnostics.push(diagnostic(
      "runner_satisfaction_mismatch",
      { expected: expectedSatisfaction, actual: envelope.satisfaction ?? null }
    ));
  }
  return diagnostics.sort((left, right) =>
    compareCodeUnits(diagnosticKey(left), diagnosticKey(right))
  );
}

async function runExactBindingEvaluationV034({
  contract_bytes: contractBytes,
  profile_bytes: profileBytes,
  evaluation_input_bytes: evaluationInputBytes,
  capture_requests: captureRequests,
  captured_byte_checks: capturedByteChecks = [],
  hooks = {}
}) {
  const inputDigests = freezeDeep({
    contract_sha256: sha256(contractBytes),
    profile_sha256: sha256(profileBytes),
    evaluation_input_sha256: sha256(evaluationInputBytes)
  });
  const contract = parseJsonBytes(contractBytes, "contract");
  const profile = parseJsonBytes(profileBytes, "profile");
  const evaluationInput = parseJsonBytes(evaluationInputBytes, "evaluation_input");
  const extensionDiagnostics = [
    ...validateRequirements(profile),
    ...validateEvaluationInputReferenceBindings(evaluationInput)
  ];
  if (!Array.isArray(captureRequests)) throw new Error("capture_requests_required");
  const captured = await Promise.all(captureRequests.map(
    (request) => captureRequest(request, hooks)
  ));
  const capturedByRequirement = new Map(captured.map(
    ({ request, capture }) => [request.requirement_id, capture]
  ));
  if (capturedByRequirement.size !== captured.length) throw new Error(
    "capture_request_requirement_duplicate"
  );
  const checkResults = [];
  if (!Array.isArray(capturedByteChecks)) throw new Error("captured_byte_checks_invalid");
  const checkIds = new Set();
  for (const [index, check] of capturedByteChecks.entries()) {
    const { mode } = validateCapturedByteCheck(check, index);
    if (checkIds.has(check.check_id)) throw new Error(
      `captured_byte_check_id_duplicate:${check.check_id}`
    );
    checkIds.add(check.check_id);
    const expectedResult = mode === "required"
      ? canonicalJsonClone(check.expected_result)
      : undefined;
    const selected = check.requirement_ids.map((id) => {
      const capture = capturedByRequirement.get(id);
      if (!capture) throw new Error(`captured_byte_check_binding_missing:${id}`);
      return capture.copy_bytes();
    });
    const result = canonicalJsonClone(await check.run(...selected));
    const passed = mode === "required"
      ? canonicalEqual(result, expectedResult)
      : null;
    checkResults.push(freezeDeep({
      check_id: check.check_id,
      requirement_ids: [...check.requirement_ids],
      mode,
      result,
      ...(mode === "required" ? { expected_result: expectedResult } : {}),
      passed
    }));
  }
  const bindingSet = canonicalBindingSet({
    binding_set_version: BINDING_SET_VERSION,
    context: inputDigests,
    bindings: captured.map(({ request, capture }) =>
      bindingFromCapture(request, capture)
    )
  });
  const directEvaluation = evaluateExactBindingsV034({
    profile,
    evaluation_input: evaluationInput,
    contract_reference_ids: (contract.references ?? []).map(
      ({ reference_id: referenceId }) => referenceId
    ),
    input_digests: inputDigests,
    binding_set: bindingSet
  });
  if (extensionDiagnostics.length > 0 && directEvaluation.satisfaction !== "invalid") {
    throw new Error("runner_extension_validation_not_reflected_by_evaluation");
  }
  const checksPassed = checkResults.every(({ mode, passed }) =>
    mode === "informational" || passed
  );
  const envelope = freezeDeep({
    result_version: RUNNER_RESULT_VERSION,
    authority: { kind: "free_tier_local", authoritative: false },
    admission: {
      kind: "local_exact_byte_capture",
      capture_verified: true,
      filesystem_paths_authoritative: false,
      caller_reported_digests_authoritative: false
    },
    satisfaction: directEvaluation.satisfaction === "satisfied" && !checksPassed
      ? "unsatisfied"
      : directEvaluation.satisfaction,
    inputs: inputDigests,
    binding_set_sha256: bindingSetDigest(bindingSet),
    bindings: bindingSet.bindings,
    captured_byte_checks: checkResults,
    evaluation: directEvaluation
  });
  const envelopeDiagnostics = validateExactBindingRunnerEnvelopeV034(envelope);
  if (envelopeDiagnostics.length > 0) throw new Error(
    `runner_envelope_internal_invalid:${JSON.stringify(envelopeDiagnostics)}`
  );
  return envelope;
}

export {
  ARTIFACT_MEDIA_TYPE,
  MUTATION_MEDIA_TYPE,
  REACHABILITY_MEDIA_TYPE,
  RUNNER_RESULT_VERSION,
  bindingFromCapture,
  captureArtifactBytes,
  captureCanonicalSnapshot,
  encodeCompleteReachabilitySnapshot,
  encodeObservedExecutionMutationSnapshot,
  runExactBindingEvaluationV034,
  validateExactBindingRunnerEnvelopeV034
};
