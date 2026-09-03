

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { projectWorkRecordTestProofValidation } from
  "@agent-chassis/wiki-core/src/lib/work-record-test-proof-bindings.mjs";

const NODE_TEST_STEP_TIMEOUT_MS = 30000;
const NODE_TEST_OUTPUT_CAP_BYTES = 65536;

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
const RUN_VALIDATION_TARGET_NOT_AUTHORIZED_NEXT_ACTION =
  "Pick a target from authorized_targets, or add this target to the unit's " +
  "acceptance.validation[] with operation node_test, then resubmit.";

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
    throw new Error("workspace_run_validation target must be a canonical .mjs file");
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

export function runNodeTestStep({ workspaceDir, flag, absoluteTarget, posixRelative }) {
  const result = spawnSync(process.execPath, [flag, absoluteTarget], {
    cwd: workspaceDir,
    shell: false,
    encoding: "utf8",
    env: buildNodeTestChildEnv(),
    timeout: NODE_TEST_STEP_TIMEOUT_MS,
    maxBuffer: NODE_TEST_OUTPUT_CAP_BYTES
  });
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
  const outputOverflow = Boolean(result.error && result.error.code === "ENOBUFS");
  const spawnError = result.error && !timedOut && !outputOverflow
    ? String(result.error.code || result.error.message || result.error)
    : null;
  const exitCode = typeof result.status === "number" ? result.status : null;
  const stdout = boundNodeTestOutput(result.stdout);
  const stderr = boundNodeTestOutput(result.stderr);
  return {
    step: `node ${flag}`,
    operation: "node_test",
    argv: ["node", flag, posixRelative],
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
    ok: !result.error && exitCode === 0
  };
}
