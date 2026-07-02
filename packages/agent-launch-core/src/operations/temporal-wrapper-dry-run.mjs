

import fs from "node:fs/promises";
import path from "node:path";

import {
  validateTemporalFinalStatus,
  validateTemporalHandoffEnvelope,
  validateTemporalLaunchRecord
} from "../lib/temporal-contracts.mjs";

export const TEMPORAL_WRAPPER_DRY_RUN_SUPPORT_STATE = Object.freeze({
  state: "experimental_wip",
  supported: false,
  launch_surface: "not_supported",
  message:
    "The Temporal wrapper dry-run operation is an experimental WIP launcher surface and is not a supported agent-launch launch surface."
});

const EVIDENCE_SCHEMA_VERSION = 1;
const FINALIZATION_PROBE_FLAGS = [
  "attempted_push",
  "attempted_upload",
  "attempted_temporal_signal",
  "attempted_credential_read",
  "attempted_command_execution"
];

export class TemporalWrapperDryRunError extends Error {
  constructor(message, { code, details = [] }) {
    super(message);
    this.name = "TemporalWrapperDryRunError";
    this.code = code;
    this.details = details;
  }
}

export async function temporalWrapperDryRun({
  handoffPath,
  launchRecordPath,
  evidencePath,
  statusOutPath
}) {
  requireInputPath(handoffPath, "handoffPath");
  requireInputPath(launchRecordPath, "launchRecordPath");
  requireInputPath(evidencePath, "evidencePath");
  requireInputPath(statusOutPath, "statusOutPath");

  const handoff = await readJsonFile(handoffPath, "handoff");
  const handoffValidation = validateTemporalHandoffEnvelope(handoff);
  if (!handoffValidation.valid) {
    throw new TemporalWrapperDryRunError("Invalid Temporal handoff envelope", {
      code: "invalid_handoff",
      details: handoffValidation.errors
    });
  }

  const launchRecord = await readJsonFile(launchRecordPath, "launch_record");
  const launchValidation = validateTemporalLaunchRecord(launchRecord);
  if (!launchValidation.valid) {
    throw new TemporalWrapperDryRunError("Invalid Temporal launch record", {
      code: "invalid_launch_record",
      details: launchValidation.errors
    });
  }

  const identityErrors = validateHandoffLaunchIdentity(handoff, launchRecord);
  if (identityErrors.length > 0) {
    throw new TemporalWrapperDryRunError("Temporal handoff and launch record identity mismatch", {
      code: "handoff_launch_mismatch",
      details: identityErrors
    });
  }

  const evidence = await readJsonFile(evidencePath, "evidence");
  const evidenceValidationErrors = validateDryRunEvidence(evidence);
  if (evidenceValidationErrors.length > 0) {
    throw new TemporalWrapperDryRunError("Invalid temporal wrapper dry-run evidence", {
      code: "invalid_evidence",
      details: evidenceValidationErrors
    });
  }

  const executionId = deriveDryRunExecutionId(handoff, launchRecord);
  if (evidence.expected_execution_id !== executionId) {
    throw new TemporalWrapperDryRunError("Dry-run evidence execution id does not match wrapper-derived execution id", {
      code: "execution_id_mismatch",
      details: [
        validationError(
          "expected_execution_id",
          "expected_context_mismatch",
          "Evidence expected_execution_id must match wrapper-derived execution id"
        )
      ]
    });
  }

  const failures = collectDryRunFailures(evidence);
  const status = buildDryRunFinalStatus({
    handoff,
    launchRecord,
    evidence,
    executionId,
    failures
  });
  const expectedContext = buildDryRunExpectedContext(launchRecord);
  const finalStatusValidation = validateTemporalFinalStatus(status, expectedContext);
  if (!finalStatusValidation.valid) {
    throw new TemporalWrapperDryRunError("Generated temporal wrapper dry-run status failed contract validation", {
      code: "invalid_generated_status",
      details: finalStatusValidation.errors
    });
  }

  await fs.mkdir(path.dirname(path.resolve(statusOutPath)), { recursive: true });
  await fs.writeFile(statusOutPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");

  return {
    ok: failures.length === 0,
    statusPath: statusOutPath,
    status,
    failures,
    validation: {
      handoff: handoffValidation,
      launchRecord: launchValidation,
      finalStatus: finalStatusValidation,
      expectedContext
    }
  };
}

export function deriveDryRunExecutionId(handoff, launchRecord) {
  return `dry-run:${handoff.initiative_id}:${handoff.wk_id}:${handoff.attempt_id}:${launchRecord.launch_sha.slice(0, 12)}`;
}

function buildDryRunFinalStatus({ handoff, launchRecord, evidence, executionId, failures }) {
  return {
    schema_version: 1,
    initiative_id: handoff.initiative_id,
    wk_id: handoff.wk_id,
    attempt_id: handoff.attempt_id,
    dispatch_idempotency_key: handoff.dispatch_idempotency_key,
    execution_id: executionId,
    github_run_id: null,
    base_sha: handoff.base_sha,
    output_branch: handoff.output_branch,
    result: failures.length === 0 ? "no_changes" : "failed",
    commit_sha: null,
    branch_push: {
      result: "not_attempted",
      remote_ref: `refs/heads/${handoff.output_branch}`,
      expected_old_ref: "absent",
      observed_old_ref: null
    },
    launch: {
      launch_ref: launchRecord.launch_ref,
      launch_sha: launchRecord.launch_sha,
      trigger: "push"
    },
    touched_paths: evidence.touched_paths,
    path_policy: evidence.path_policy,
    checks: evidence.checks.map((check) => ({
      name: check.name,
      result: check.result,
      evidence_ref: check.evidence_ref,
      skip_reason: check.skip_reason ?? null
    })),
    secret_scan: evidence.secret_scan,
    wrapper: launchRecord.wrapper,
    execution_environment: {
      validation_mode: "dry_run",
      model_execution_privileged: true,
      isolation_mode: "privileged_shared_runner",
      isolation_evidence_ref: "fixture:temporal-wrapper-dry-run/local-uncredentialed-validation",
      runner_image: {
        image: "local-temporal-wrapper-dry-run",
        digest: "unavailable",
        digest_unavailable_reason: "local dry-run uses deterministic fixture evidence and no runner image digest"
      },
      tool_versions: [
        {
          name: handoff.agent,
          version: "dry-run-fixture",
          evidence_ref: "fixture:temporal-wrapper-dry-run/tool-version"
        },
        {
          name: "agent-launch",
          version: "dry-run-fixture",
          evidence_ref: "fixture:temporal-wrapper-dry-run/wrapper-version"
        }
      ],
      dry_run: {
        source: "temporal-wrapper-dry-run",
        evidence_ref: "fixture:temporal-wrapper-dry-run/evidence"
      }
    },
    finalization: {
      validation_mode: "dry_run",
      staging: "clean_trusted_staging",
      git_invocation: "sanitized_git",
      hooks_disabled: true,
      repo_config_ignored: true,
      credentialed_model_code_executed: false,
      dry_run_clean_staging: true,
      dry_run_sanitized_git_intent: true,
      dry_run_credentials_available: false,
      finalization_probe: evidence.finalization_probe
    },
    dry_run: {
      validation_mode: "dry_run",
      response: evidence.response,
      git_status: evidence.git_status,
      failures,
      side_effects: {
        pushed_branch: false,
        uploaded_artifacts: false,
        called_github: false,
        signaled_temporal: false,
        read_credentials: false,
        executed_model_controlled_code: false
      }
    }
  };
}

function buildDryRunExpectedContext(launchRecord) {
  return {
    validation_mode: "dry_run",
    launchRecord,
    wrapper: launchRecord.wrapper
  };
}

function validateHandoffLaunchIdentity(handoff, launchRecord) {
  const errors = [];
  for (const key of [
    "initiative_id",
    "wk_id",
    "attempt_id",
    "dispatch_idempotency_key",
    "base_sha",
    "launch_ref",
    "output_branch"
  ]) {
    compareExpected(handoff[key], launchRecord[key], key, errors);
  }
  compareExpected(handoff.github?.run_name, launchRecord.github?.run_name, "github.run_name", errors);
  compareExpected(`agent-worker/${handoff.dispatch_idempotency_key}`, handoff.github?.run_name, "github.run_name", errors);
  compareExpected(handoff.launch_ref, launchRecord.github?.workflow_ref, "github.workflow_ref", errors);
  return errors;
}

function validateDryRunEvidence(evidence) {
  const errors = [];
  const obj = asObject(evidence);
  if (!obj) {
    return [validationError("", "expected_object", "Expected evidence object")];
  }

  requireInteger(obj.schema_version, "schema_version", errors, EVIDENCE_SCHEMA_VERSION);
  requireString(obj.expected_execution_id, "expected_execution_id", errors);
  requireObject(obj.response, "response", errors, (response) => {
    requireBoolean(response.present, "response.present", errors);
    requireBoolean(response.non_empty, "response.non_empty", errors);
  });
  requireStringArray(obj.touched_paths, "touched_paths", errors);
  requireObject(obj.path_policy, "path_policy", errors, (pathPolicy) => {
    requireBoolean(pathPolicy.allowed, "path_policy.allowed", errors);
    requireStringArray(pathPolicy.violations, "path_policy.violations", errors);
  });
  requireChecksEvidence(obj.checks, "checks", errors);
  requireObject(obj.secret_scan, "secret_scan", errors, (secretScan) => {
    if (!["passed", "failed"].includes(secretScan.result)) {
      errors.push(validationError("secret_scan.result", "unsupported_result", "Secret scan result must be passed or failed"));
    }
    requireString(secretScan.evidence_ref, "secret_scan.evidence_ref", errors);
  });
  requireObject(obj.git_status, "git_status", errors, (gitStatus) => {
    requireBoolean(gitStatus.clean, "git_status.clean", errors);
    requireStringArray(gitStatus.untracked, "git_status.untracked", errors);
    requireStringArray(gitStatus.modified, "git_status.modified", errors);
  });
  requireObject(obj.finalization_probe, "finalization_probe", errors, (probe) => {
    for (const flag of FINALIZATION_PROBE_FLAGS) {
      requireBoolean(probe[flag], `finalization_probe.${flag}`, errors);
    }
  });

  return errors;
}

function collectDryRunFailures(evidence) {
  const failures = [];
  if (evidence.response.present !== true) {
    failures.push(dryRunFailure("response.present", "missing_response", "Dry-run response evidence is missing"));
  }
  if (evidence.response.non_empty !== true) {
    failures.push(dryRunFailure("response.non_empty", "empty_response", "Dry-run response evidence is empty"));
  }
  if (evidence.touched_paths.length > 0) {
    failures.push(dryRunFailure("touched_paths", "changes_not_supported", "Dry-run no-change wrapper evidence must not include touched paths"));
  }
  if (evidence.path_policy.allowed !== true) {
    failures.push(dryRunFailure("path_policy.allowed", "path_policy_failed", "Dry-run path policy failed"));
  }
  if (evidence.path_policy.violations.length > 0) {
    failures.push(dryRunFailure("path_policy.violations", "path_policy_violations", "Dry-run path policy reported violations"));
  }
  for (const [index, check] of evidence.checks.entries()) {
    if (check.result === "failed") {
      failures.push(dryRunFailure(`checks[${index}].result`, "check_failed", "Dry-run check failed"));
    }
  }
  if (evidence.secret_scan.result !== "passed") {
    failures.push(dryRunFailure("secret_scan.result", "secret_scan_failed", "Dry-run secret scan failed"));
  }
  if (evidence.git_status.clean !== true) {
    failures.push(dryRunFailure("git_status.clean", "dirty_git_status", "Dry-run git status is dirty"));
  }
  if (evidence.git_status.untracked.length > 0) {
    failures.push(dryRunFailure("git_status.untracked", "dirty_git_status", "Dry-run git status has untracked paths"));
  }
  if (evidence.git_status.modified.length > 0) {
    failures.push(dryRunFailure("git_status.modified", "dirty_git_status", "Dry-run git status has modified paths"));
  }
  for (const flag of FINALIZATION_PROBE_FLAGS) {
    if (evidence.finalization_probe[flag] === true) {
      failures.push(dryRunFailure(`finalization_probe.${flag}`, "mutation_probe_failed", "Dry-run finalization probe reported forbidden mutation attempt"));
    }
  }
  return failures;
}

async function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (cause) {
    throw new TemporalWrapperDryRunError(`Unable to read ${label} JSON`, {
      code: `${label}_read_failed`,
      details: [validationError(label, "read_failed", cause.message)]
    });
  }

  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new TemporalWrapperDryRunError(`Invalid ${label} JSON`, {
      code: `invalid_${label}_json`,
      details: [validationError(label, "invalid_json", cause.message)]
    });
  }
}

function requireInputPath(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TemporalWrapperDryRunError(`Missing required ${name}`, {
      code: "missing_argument",
      details: [validationError(name, "expected_string", "Expected non-empty path")]
    });
  }
}

function requireChecksEvidence(value, pathName, errors) {
  if (!Array.isArray(value)) {
    errors.push(validationError(pathName, "expected_array", "Expected array"));
    return;
  }
  for (const [index, checkValue] of value.entries()) {
    const itemPath = `${pathName}[${index}]`;
    const check = asObject(checkValue);
    if (!check) {
      errors.push(validationError(itemPath, "expected_object", "Expected object"));
      continue;
    }
    requireString(check.name, `${itemPath}.name`, errors);
    if (!["passed", "failed", "skipped"].includes(check.result)) {
      errors.push(validationError(`${itemPath}.result`, "unsupported_result", "Check result must be passed, failed, or skipped"));
    }
    requireString(check.evidence_ref, `${itemPath}.evidence_ref`, errors);
    if (check.result === "skipped") {
      requireString(check.skip_reason, `${itemPath}.skip_reason`, errors);
    }
  }
}

function requireObject(value, pathName, errors, validate) {
  const obj = asObject(value);
  if (!obj) {
    errors.push(validationError(pathName, "expected_object", "Expected object"));
    return;
  }
  validate(obj);
}

function requireStringArray(value, pathName, errors) {
  if (!Array.isArray(value)) {
    errors.push(validationError(pathName, "expected_array", "Expected array"));
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(validationError(`${pathName}[${index}]`, "expected_string", "Expected non-empty string"));
    }
  }
}

function requireString(value, pathName, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(validationError(pathName, "expected_string", "Expected non-empty string"));
  }
}

function requireBoolean(value, pathName, errors) {
  if (typeof value !== "boolean") {
    errors.push(validationError(pathName, "expected_boolean", "Expected boolean"));
  }
}

function requireInteger(value, pathName, errors, expected) {
  if (!Number.isInteger(value)) {
    errors.push(validationError(pathName, "expected_integer", "Expected integer"));
    return;
  }
  if (value !== expected) {
    errors.push(validationError(pathName, "unsupported_version", `Expected ${expected}`));
  }
}

function compareExpected(actual, expected, pathName, errors) {
  if (actual !== expected) {
    errors.push(validationError(pathName, "expected_context_mismatch", "Value does not match expected context"));
  }
}

function dryRunFailure(pathName, code, message) {
  return { path: pathName, code, message };
}

function validationError(pathName, code, message) {
  return { path: pathName, code, message };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
