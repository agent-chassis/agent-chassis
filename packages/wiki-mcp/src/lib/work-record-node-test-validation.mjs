

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CLOSED_NODE_TEST_TARGET_STATEMENT,
  isClosedNodeTestTarget,
  projectWorkRecordTestProofValidation
} from "@agent-chassis/wiki-core/src/lib/work-record-test-proof-bindings.mjs";
import { describeTestProofProviderRegistry } from
  "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-test-proof-provider-registry.mjs";

import {
  authenticateLauncherNodeTestEvents,
  launcherNodeTestReporterUrl,
  NODE_TEST_PROOF_REPORTER_PATH,
  NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES,
  projectLauncherNodeTestInventory
} from "@agent-chassis/agent-launch-cli/src/lib/workspace-agent-test-proof-node-observation.mjs";
import { persistRunValidationInventoryReference } from "./mcp-response.mjs";
import { mcpContentReferenceFirstCall, mcpContentReferenceReassembly } from
  "./mcp-content-reference-tools.mjs";

const NODE_TEST_STEP_TIMEOUT_MS = 30000;
const NODE_TEST_OUTPUT_CAP_BYTES = 65536;

export const RUN_VALIDATION_TEST_INVENTORY_SCHEMA_VERSION =
  "workspace-run-validation-test-inventory.v1";
export const RUN_VALIDATION_INVENTORY_NOT_ESTABLISHED_CODES = Object.freeze({
  step_not_run: "node_test_step_not_run",
  spawn_failed: "node_test_spawn_failed",
  timed_out: "node_test_timed_out",
  output_overflow: "node_test_output_overflow"
});

export const RUN_VALIDATION_INVENTORY_INLINE_TEST_LIMIT = 64;

export const NODE_TEST_FORBIDDEN_CALLER_FIELDS = [
  "snapshot",
  "authoritySnapshot",
  "validation_authority",
  "authority",
  "runtime_policy",
  "runtimePolicy",
  "launcherRuntimePolicy",
  "policy",
  "env",
  "runtime_env",
  "runtimeDirs",
  "runtime_dirs",
  "node_binary",
  "nodeBinary",
  "workspace_identity",
  "source_digest",
  "timeout",
  "outputCap",
  "cwd",
  "workspaceRoot",
  "args"
];

const RUN_VALIDATION_REFUSAL_SCHEMA_VERSION = "workspace-run-validation-refusal.v1";
const RUN_VALIDATION_TARGET_NOT_AUTHORIZED_CODE =
  "workspace_run_validation.target_not_authorized.v1";
const RUN_VALIDATION_TARGET_INVALID_CODE = "workspace_run_validation.target_invalid.v1";
const RUN_VALIDATION_TARGET_INVALID_NEXT_ACTION =
  `Run a declared node_test target that is ${CLOSED_NODE_TEST_TARGET_STATEMENT}; ` +
  "declared targets come from the verification's test case authored through " +
  "workspace_controlled_contract_obligation_coverage_upsert.";
const RUN_VALIDATION_TARGET_NOT_AUTHORIZED_NEXT_ACTION =
  "Pick a target from authorized_targets, or have the coordinator author the verification's " +
  "test case through workspace_controlled_contract_obligation_coverage_upsert, then resubmit.";

export function describeNativeValidationSupport() {
  const registry = describeTestProofProviderRegistry();
  const selectorKinds = [...new Set(registry.providers.map(({ selector_kind: kind }) => kind))].sort();
  return {
    schema_version: "workspace-run-validation-native-support.v1",
    node_test: {
      operation: "node_test",
      target: CLOSED_NODE_TEST_TARGET_STATEMENT,
      declared_by: "the selected unit's acceptance.validation node_test entries",
      runner: "workspace_run_validation"
    },
    saved_proof: {
      registry_id: registry.registry_id,
      registry_version: registry.registry_version,
      authority: registry.authority,
      selector_kinds: selectorKinds.map((kind) => ({
        selector_kind: kind,
        provider_ids: registry.providers
          .filter(({ selector_kind: providerKind }) => providerKind === kind)
          .map(({ provider_id: id }) => id).sort()
      })),
      runtime_availability: "resolved when a saved proof is prepared for execution",
      runner: "workspace_verify_proof"
    },
    other_forms: "not executed: no node_test operation or installed provider runs any other target or command"
  };
}

function buildRunValidationTargetInvalidError(message, requestedTarget) {
  const error = new Error(message);
  error.envelope = {
    schema_version: RUN_VALIDATION_REFUSAL_SCHEMA_VERSION,
    tool: "workspace_run_validation",
    accepted: false,
    refusal_code: RUN_VALIDATION_TARGET_INVALID_CODE,
    refusal_message: message,
    requested_target: typeof requestedTarget === "string" ? requestedTarget : null,
    accepted_target: CLOSED_NODE_TEST_TARGET_STATEMENT,
    executed: false,
    native_validation: describeNativeValidationSupport(),
    next_action: RUN_VALIDATION_TARGET_INVALID_NEXT_ACTION
  };
  return error;
}

export function buildRunValidationTargetNotAuthorizedError({ address, requestedTarget, authorizedTargets }) {
  const message =
    `workspace_run_validation target is not authorized by the work contract for ${address}: ` +
    `${requestedTarget} is not a node_test entry in acceptance.validation[].`;
  const error = new Error(message);
  error.envelope = {
    schema_version: RUN_VALIDATION_REFUSAL_SCHEMA_VERSION,
    tool: "workspace_run_validation",
    accepted: false,
    refusal_code: RUN_VALIDATION_TARGET_NOT_AUTHORIZED_CODE,
    refusal_message: message,
    unit: address,
    requested_target: requestedTarget,
    authorized_targets: [...authorizedTargets].sort(),
    accepted_target: CLOSED_NODE_TEST_TARGET_STATEMENT,
    executed: false,
    native_validation: describeNativeValidationSupport(),
    next_action: RUN_VALIDATION_TARGET_NOT_AUTHORIZED_NEXT_ACTION
  };
  return error;
}

export function toPosixRelative(value) {

  return String(value).split(path.sep).join("/").split("\\").join("/");
}

export function parseNodeTestUnitAddress(unitInput) {
  const raw = typeof unitInput === "string" ? unitInput.trim() : "";
  if (!raw) {
    throw new Error("workspace_run_validation requires a non-empty unit address");
  }
  const hashIndex = raw.indexOf("#");
  if (hashIndex < 0) {
    return { address: raw, recordId: raw, sliceId: null };
  }
  const recordId = raw.slice(0, hashIndex).trim();
  const sliceId = raw.slice(hashIndex + 1).trim();
  if (!recordId || !sliceId) {
    throw new Error(`workspace_run_validation could not parse unit address: ${raw}`);
  }
  return { address: `${recordId}#${sliceId}`, recordId, sliceId };
}

export function resolveNodeTestUnitSections(record, sliceId) {
  if (!sliceId) {
    return record && typeof record === "object" ? record : null;
  }
  const slices = Array.isArray(record && record.slices) ? record.slices : [];
  const slice = slices.find(
    (entry) =>
      entry &&
      typeof entry.id === "string" &&
      entry.id.toUpperCase() === sliceId.toUpperCase()
  );
  if (!slice) {
    return null;
  }
  return slice;
}

export function collectAuthorizedNodeTestTargets(selectedUnit) {
  const projection = projectWorkRecordTestProofValidation({ selectedUnit });
  return new Set(projection.status === "valid" ? projection.targets : []);
}

export function collectDeclaredVerificationIds(selectedUnit, target) {
  const projection = projectWorkRecordTestProofValidation({ selectedUnit });
  if (projection.status !== "valid") return [];
  return [...new Set(projection.executable_declarations
    .filter((declaration) => declaration.target === target)
    .flatMap((declaration) => declaration.verification_ids))].sort();
}

function canonicalInventoryDigest(value) {
  return digestBytes(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

export function projectRunValidationInventoryResponse({ inventory, wkId, verificationIds,
  persist = persistRunValidationInventoryReference }) {
  const proofEffect = {
    test_selected: false,
    proof_binding_published: false,
    proof_execution_readiness: "not_evaluated",
    proof_satisfaction: "not_claimed"
  };
  if (inventory.status !== "complete") {
    return {
      ...inventory,
      tests_total: 0, tests_returned: 0, tests_omitted: 0,
      proof_effect: proofEffect
    };
  }
  const tests = inventory.tests;
  const inline = tests.slice(0, RUN_VALIDATION_INVENTORY_INLINE_TEST_LIMIT);
  const complete = { ...inventory, tests_total: tests.length };
  const inventoryDigest = canonicalInventoryDigest(complete);
  const proofAuthoring = {
    verification_ids: verificationIds,
    selection: "explicit_author_selection_required",

    selectable_fields: ["name", "nesting", "test_id"],
    semantic_owner: "workspace_controlled_contract_obligation_coverage_upsert",
    route_arguments_known: false,
    missing_argument: "obligation_id"
  };
  if (inline.length === tests.length) {
    return { ...complete, inventory_digest: inventoryDigest, tests_returned: tests.length,
      tests_omitted: 0, proof_effect: proofEffect, proof_authoring: proofAuthoring };
  }
  const persisted = persist({
    inventory: { ...complete, inventory_digest: inventoryDigest },
    inventoryIdentity: inventoryDigest
  });
  const retrieval = persisted.status === "persisted"
    ? {
      complete_retrieval: {
        first_call: mcpContentReferenceFirstCall(persisted.reference.content_reference),
        reassembly: mcpContentReferenceReassembly("decode the verified bytes as UTF-8 and parse JSON"),
        expected: {
          byte_count: persisted.reference.content_reference.byte_count,
          sha256: persisted.reference.content_reference.sha256,
          schema_version: RUN_VALIDATION_TEST_INVENTORY_SCHEMA_VERSION,
          inventory_digest: inventoryDigest
        }
      }
    }
    : { complete_retrieval: null, retrieval_refusal: persisted.refusal };
  return { ...complete, inventory_digest: inventoryDigest, tests: inline,
    tests_returned: inline.length, tests_omitted: tests.length - inline.length,
    ...retrieval, proof_effect: proofEffect, proof_authoring: proofAuthoring };
}

export function resolveNodeTestTarget(workspaceDir, targetInput) {
  if (typeof targetInput !== "string" || targetInput.length === 0) {
    throw new Error("workspace_run_validation requires a non-empty target");
  }
  if (targetInput.includes("\0") || /[\r\n]/.test(targetInput)) {
    throw new Error("workspace_run_validation target contains invalid characters");
  }
  if (path.isAbsolute(targetInput)) {
    throw new Error("workspace_run_validation target must be repo-relative");
  }
  const absolute = path.resolve(workspaceDir, targetInput);
  const relative = path.relative(workspaceDir, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("workspace_run_validation target escapes the workspace repo");
  }
  if (path.extname(absolute) !== ".mjs") {
    throw buildRunValidationTargetInvalidError(
      "workspace_run_validation target must be a canonical .mjs file", targetInput);
  }
  if (!isClosedNodeTestTarget(targetInput)) {
    throw buildRunValidationTargetInvalidError(
      `workspace_run_validation target must be ${CLOSED_NODE_TEST_TARGET_STATEMENT}`, targetInput);
  }
  let realTarget;
  try {
    realTarget = fs.realpathSync(absolute);
  } catch {
    throw new Error(`workspace_run_validation target does not exist: ${toPosixRelative(relative)}`);
  }
  const realRoot = fs.realpathSync(workspaceDir);
  const realRelative = path.relative(realRoot, realTarget);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("workspace_run_validation target resolves outside the workspace repo");
  }
  if (!fs.statSync(realTarget).isFile()) {
    throw new Error("workspace_run_validation target is not a regular file");
  }
  return { absolute, posixRelative: toPosixRelative(relative) };
}

function buildNodeTestChildEnv() {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_OPTIONS;
  for (const key of Object.keys(childEnv)) {
    if (
      key.startsWith("WIKI_MCP_") ||
      key.startsWith("AGENT_LAUNCH_") ||
      key.startsWith("NODE_ENGINE_")
    ) {
      delete childEnv[key];
    }
  }
  return childEnv;
}

function boundNodeTestOutput(value) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  if (Buffer.byteLength(text, "utf8") <= NODE_TEST_OUTPUT_CAP_BYTES) {
    return { text, truncated: false };
  }
  return {
    text: Buffer.from(text, "utf8").subarray(0, NODE_TEST_OUTPUT_CAP_BYTES).toString("utf8"),
    truncated: true
  };
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const NODE_TEST_REPORTER_ARGUMENTS = Object.freeze([
  "--test-isolation=none",
  "--test-reporter=spec", "--test-reporter-destination=stdout"
]);
const NODE_TEST_REPORTER_ARGV_PROJECTION = `${NODE_TEST_PROOF_REPORTER_PATH}?launcher_protocol_fd=3`;

function inventoryNotEstablished(reasonCode, detail = {}) {
  return {
    schema_version: RUN_VALIDATION_TEST_INVENTORY_SCHEMA_VERSION,
    status: "not_established",
    reason_code: reasonCode,
    ...(Object.keys(detail).length === 0 ? {} : { detail }),
    complete: false,
    tests: [],
    counts: null
  };
}

function captureNodeTestInventory({ reporterText, reporterOverflow, outputOverflow,
  timedOut, spawnError, exitCode, posixRelative, targetDigest }) {
  const source = {
    kind: "coordinator_workspace_target",
    target: posixRelative,
    target_content_digest: targetDigest,
    authenticated_source_snapshot: false
  };
  const run = { exit_code: exitCode, timed_out: timedOut, spawn_error: spawnError };
  if (spawnError !== null) return { ...inventoryNotEstablished(
    RUN_VALIDATION_INVENTORY_NOT_ESTABLISHED_CODES.spawn_failed), source, run };
  if (timedOut) return { ...inventoryNotEstablished(
    RUN_VALIDATION_INVENTORY_NOT_ESTABLISHED_CODES.timed_out), source, run };
  if (outputOverflow && !reporterOverflow) return { ...inventoryNotEstablished(
    RUN_VALIDATION_INVENTORY_NOT_ESTABLISHED_CODES.output_overflow), source, run };
  const authenticated = authenticateLauncherNodeTestEvents({
    stdout: reporterText, reporterProtocolOverflow: reporterOverflow
  });
  if (!authenticated.valid) return { ...inventoryNotEstablished(
    authenticated.code, authenticated.detail ?? {}), source, run };
  const { event_digest: eventDigest, reporter_attestation: reporterAttestation,
    schema_version: observationSchemaVersion,
    ...projected } = projectLauncherNodeTestInventory(authenticated);
  return {
    schema_version: RUN_VALIDATION_TEST_INVENTORY_SCHEMA_VERSION,
    status: "complete",
    reason_code: null,

    observation_schema_version: observationSchemaVersion,
    ...projected,
    source,
    run: { ...run, event_digest: eventDigest, reporter_attestation: reporterAttestation }
  };
}

export function runNodeTestStep({ workspaceDir, flag, absoluteTarget, posixRelative }) {
  const testStep = flag === "--test";
  const targetDigest = testStep ? digestBytes(fs.readFileSync(absoluteTarget)) : null;
  const nodeArguments = testStep
    ? [flag, ...NODE_TEST_REPORTER_ARGUMENTS,
      `--test-reporter=${launcherNodeTestReporterUrl()}`, "--test-reporter-destination=stdout",
      absoluteTarget]
    : [flag, absoluteTarget];
  const result = spawnSync(process.execPath, nodeArguments, {
    cwd: workspaceDir,
    shell: false,
    encoding: "utf8",
    env: buildNodeTestChildEnv(),
    timeout: NODE_TEST_STEP_TIMEOUT_MS,
    stdio: testStep ? ["ignore", "pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],

    maxBuffer: testStep ? NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES : NODE_TEST_OUTPUT_CAP_BYTES
  });
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
  const outputOverflow = Boolean(result.error && result.error.code === "ENOBUFS");
  const spawnError = result.error && !timedOut && !outputOverflow
    ? String(result.error.code || result.error.message || result.error)
    : null;
  const exitCode = typeof result.status === "number" ? result.status : null;
  const stdout = boundNodeTestOutput(result.stdout);
  const stderr = boundNodeTestOutput(result.stderr);
  const reporterText = testStep ? String(result.output?.[3] ?? "") : "";
  const reporterOverflow = testStep && outputOverflow &&
    Buffer.byteLength(reporterText, "utf8") >= NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES;
  return {
    step: `node ${flag}`,
    operation: "node_test",
    argv: testStep
      ? ["node", flag, ...NODE_TEST_REPORTER_ARGUMENTS,
        `--test-reporter=${NODE_TEST_REPORTER_ARGV_PROJECTION}`, "--test-reporter-destination=stdout",
        posixRelative]
      : ["node", flag, posixRelative],
    target: posixRelative,
    ran: true,
    skipped: false,
    exit_code: exitCode,
    signal: result.signal ?? null,
    timed_out: timedOut,
    output_truncated: stdout.truncated || stderr.truncated || outputOverflow,
    spawn_error: spawnError,
    stdout: stdout.text,
    stderr: stderr.text,
    ok: !result.error && exitCode === 0,
    ...(testStep ? {
      reporter: {
        module: NODE_TEST_PROOF_REPORTER_PATH,
        protocol_fd: 3,
        argv_projection: "package_relative_module_path",
        protocol_cap_bytes: NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES
      },
      test_inventory: captureNodeTestInventory({ reporterText, reporterOverflow,
        outputOverflow, timedOut, spawnError, exitCode, posixRelative, targetDigest })
    } : {})
  };
}
