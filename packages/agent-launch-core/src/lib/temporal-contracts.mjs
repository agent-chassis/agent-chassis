

export const TEMPORAL_CONTRACTS_SUPPORT_STATE = Object.freeze({
  state: "experimental_wip",
  supported: false,
  launch_surface: "not_supported",
  message:
    "Temporal contracts are an experimental WIP launcher surface and are not a supported agent-launch launch surface."
});

const SHA_PATTERN = /^[0-9a-f]{7,64}$/i;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/i;
const WK_PATTERN = /^WK-\d{4}$/;
const IN_PATTERN = /^IN-\d{4}$/;
const ATTEMPT_PATTERN = /^A\d{3,}$/;
const DISPATCH_KEY_PATTERN = /^IN-\d{4}\/WK-\d{4}\/A\d{3,}$/;
const OUTPUT_BRANCH_PATTERN = /^agent\/IN-\d{4}\/WK-\d{4}\/A\d{3,}$/;
const GITHUB_RUN_ID_PATTERN = /^\d+$/;
const LAUNCH_REF_PREFIX = "refs/heads/agent-launch/";
const REMOTE_REF_PREFIX = "refs/heads/";
const FORBIDDEN_TOUCHED_PATHS = new Set([".agent-runs", ".git", "agent-output"]);
const FORBIDDEN_TOUCHED_PATH_PREFIXES = [
  ".agent-runs/",
  ".git/",
  ".cache/repo-code-index/",
  "agent-output/"
];

const STATUS_RESULTS = new Set([
  "succeeded",
  "failed",
  "no_changes",
  "cancelled",
  "inconclusive",
  "dispatch_uncertain"
]);

const BRANCH_PUSH_RESULTS = new Set(["succeeded", "failed", "not_attempted"]);
const CHECK_RESULTS = new Set(["passed", "failed", "skipped"]);
const SECRET_SCAN_RESULTS = new Set(["passed", "failed"]);
const TRUSTED_FINALIZATION_STAGING = "clean_trusted_staging";
const TRUSTED_FINALIZATION_GIT_INVOCATION = "sanitized_git";
const DRY_RUN_VALIDATION_MODE = "dry_run";
const VALIDATION_MODES = new Set(["live", DRY_RUN_VALIDATION_MODE]);
const PRIVILEGED_ISOLATION_MODE = "privileged_shared_runner";
const UNPRIVILEGED_ISOLATION_MODES = new Set([
  "isolated_model_container",
  "separate_unprivileged_runner"
]);
const EXECUTION_ISOLATION_MODES = new Set([
  PRIVILEGED_ISOLATION_MODE,
  ...UNPRIVILEGED_ISOLATION_MODES
]);
const RUNNER_DIGEST_UNAVAILABLE = "unavailable";
const EXECUTION_BACKENDS = new Set(["github_actions", "kubernetes_job"]);
const KUBERNETES_RESULT_RESOURCE_VERSION_PLACEHOLDER = "kubernetes-metadata";

export function validateTemporalHandoffEnvelope(value) {
  const errors = [];
  const obj = asObject(value);

  if (!obj) {
    return invalid([error("", "expected_object", "Expected handoff envelope object")]);
  }

  requireInt(obj.schema_version, "schema_version", errors, { expected: 1 });
  requirePattern(obj.initiative_id, "initiative_id", IN_PATTERN, errors);
  requirePattern(obj.wk_id, "wk_id", WK_PATTERN, errors);
  requirePattern(obj.attempt_id, "attempt_id", ATTEMPT_PATTERN, errors);
  requireDispatchKey(obj.dispatch_idempotency_key, "dispatch_idempotency_key", errors);
  requireIdentityMatchesDispatch(obj, "", errors);
  requireSha(obj.base_sha, "base_sha", errors);
  requireString(obj.target_branch, "target_branch", errors);
  requireLaunchRef(obj.launch_ref, "launch_ref", errors, obj.dispatch_idempotency_key);
  requireOutputBranch(obj.output_branch, "output_branch", errors, obj.dispatch_idempotency_key);
  requireString(obj.agent, "agent", errors);

  const execution = requireExecution(obj.execution, "execution", errors, { required: false });
  const backend = execution?.backend ?? "github_actions";
  const github = backend === "github_actions" ? requireObject(obj.github, "github", errors) : asObject(obj.github);
  if (github) {
    requireGithubLaunchFields(github, "github", errors, {
      dispatchId: obj.dispatch_idempotency_key,
      launchRef: obj.launch_ref
    });
  }
  if (backend === "kubernetes_job") {
    requireKubernetesExecutionFields(execution, "execution", errors);
  }

  const handoff = requireObject(obj.handoff, "handoff", errors);
  if (handoff) {
    requireString(handoff.goal, "handoff.goal", errors);
    requireStringArray(handoff.read_first, "handoff.read_first", errors);
    requireStringArray(handoff.constraints, "handoff.constraints", errors);
    requireStringArray(handoff.allowed_paths, "handoff.allowed_paths", errors);
  }

  const output = requireObject(obj.output_contract, "output_contract", errors);
  if (output) {
    requireString(output.response_path, "output_contract.response_path", errors);
    requireString(output.agent_report_path, "output_contract.agent_report_path", errors);
    requireString(output.status_path, "output_contract.status_path", errors);
    if (typeof output.require_commit !== "boolean") {
      errors.push(error("output_contract.require_commit", "expected_boolean", "Expected boolean"));
    }
  }

  return result(errors);
}

export function validateTemporalLaunchRecord(value) {
  const errors = [];
  const obj = asObject(value);

  if (!obj) {
    return invalid([error("", "expected_object", "Expected launch record object")]);
  }

  requireInt(obj.schema_version, "schema_version", errors, { expected: 1 });
  requireDispatchKey(obj.dispatch_idempotency_key, "dispatch_idempotency_key", errors);
  requireLaunchRef(obj.launch_ref, "launch_ref", errors, obj.dispatch_idempotency_key);
  requireSha(obj.launch_sha, "launch_sha", errors);
  requireSha(obj.base_sha, "base_sha", errors);
  requireOutputBranch(obj.output_branch, "output_branch", errors, obj.dispatch_idempotency_key);
  requireWrapper(obj.wrapper, "wrapper", errors);

  const execution = requireExecution(obj.execution, "execution", errors, { required: false });
  const backend = execution?.backend ?? "github_actions";
  const github = backend === "github_actions" ? requireObject(obj.github, "github", errors) : asObject(obj.github);
  if (github) {
    requireGithubLaunchFields(github, "github", errors, {
      dispatchId: obj.dispatch_idempotency_key,
      launchRef: obj.launch_ref
    });
  }
  if (backend === "kubernetes_job") {
    requireKubernetesExecutionFields(execution, "execution", errors);
  }

  if (obj.handoff !== undefined) {
    const nested = validateTemporalHandoffEnvelope(obj.handoff);
    for (const nestedError of nested.errors) {
      errors.push(prefixError("handoff", nestedError));
    }
    requireLaunchRecordMatchesHandoff(obj, obj.handoff, errors);
  }

  return result(errors);
}

export function validateTemporalFinalStatus(value, expected = {}) {
  const errors = [];
  const obj = asObject(value);

  if (!obj) {
    return invalid([error("", "expected_object", "Expected final status object")]);
  }

  requireInt(obj.schema_version, "schema_version", errors, { expected: 1 });
  requirePattern(obj.initiative_id, "initiative_id", IN_PATTERN, errors);
  requirePattern(obj.wk_id, "wk_id", WK_PATTERN, errors);
  requirePattern(obj.attempt_id, "attempt_id", ATTEMPT_PATTERN, errors);
  requireDispatchKey(obj.dispatch_idempotency_key, "dispatch_idempotency_key", errors);
  requireIdentityMatchesDispatch(obj, "", errors);
  requireString(obj.execution_id, "execution_id", errors);
  const expectedBackend = expectedExecutionBackend(expected);
  if (expectedBackend === "kubernetes_job") {
    if (obj.github_run_id !== null) {
      errors.push(error("github_run_id", "expected_null_for_kubernetes_job", "Kubernetes Job status requires github_run_id null"));
    }
    requireKubernetesJobStatus(obj.kubernetes_job, "kubernetes_job", errors);
  } else {
    requireGithubRunId(obj.github_run_id, "github_run_id", errors);
  }
  requireSha(obj.base_sha, "base_sha", errors);
  requireOutputBranch(obj.output_branch, "output_branch", errors, obj.dispatch_idempotency_key);

  if (!STATUS_RESULTS.has(obj.result)) {
    errors.push(error("result", "unsupported_result", "Unsupported status result"));
  }

  if (obj.commit_sha !== null) {
    requireSha(obj.commit_sha, "commit_sha", errors);
  }

  const branchPush = requireObject(obj.branch_push, "branch_push", errors);
  if (branchPush) {
    if (!BRANCH_PUSH_RESULTS.has(branchPush.result)) {
      errors.push(error("branch_push.result", "unsupported_result", "Unsupported branch push result"));
    }
    requireRemoteRef(branchPush.remote_ref, "branch_push.remote_ref", errors, obj.output_branch);
    requireRefValue(branchPush.expected_old_ref, "branch_push.expected_old_ref", errors);
    if (branchPush.observed_old_ref !== null) {
      requireRefValue(branchPush.observed_old_ref, "branch_push.observed_old_ref", errors);
    }
  }

  const launch = requireObject(obj.launch, "launch", errors);
  if (launch) {
    requireLaunchRef(launch.launch_ref, "launch.launch_ref", errors, obj.dispatch_idempotency_key);
    requireSha(launch.launch_sha, "launch.launch_sha", errors);
    if (launch.trigger !== "push") {
      errors.push(error("launch.trigger", "unsupported_trigger", "Launch trigger must be push"));
    }
  }

  requireTouchedPaths(obj.touched_paths, "touched_paths", errors);

  const pathPolicy = requireObject(obj.path_policy, "path_policy", errors);
  if (pathPolicy) {
    if (typeof pathPolicy.allowed !== "boolean") {
      errors.push(error("path_policy.allowed", "expected_boolean", "Expected boolean"));
    }
    requireStringArray(pathPolicy.violations, "path_policy.violations", errors);
  }

  requireChecks(obj.checks, "checks", errors);

  const secretScan = requireObject(obj.secret_scan, "secret_scan", errors);
  if (secretScan) {
    if (!SECRET_SCAN_RESULTS.has(secretScan.result)) {
      errors.push(error("secret_scan.result", "unsupported_result", "Unsupported secret scan result"));
    }
    requireString(secretScan.evidence_ref, "secret_scan.evidence_ref", errors);
  }

  requireWrapper(obj.wrapper, "wrapper", errors);
  requireExecutionEnvironment(obj.execution_environment, "execution_environment", errors);
  requireFinalization(obj.finalization, "finalization", errors);

  const dryRunNoChangesValidation =
    obj.result === "no_changes" && isDryRunExpectedContext(expected);
  const acceptedAttemptResult =
    obj.result === "succeeded" || (obj.result === "no_changes" && !dryRunNoChangesValidation);

  if (acceptedAttemptResult) {
    const gateCode = obj.result === "succeeded" ? "required_for_success" : "required_for_no_changes";
    const gateLabel = obj.result === "succeeded" ? "Successful status" : "Live no-change status";

    if (expectedBackend === "github_actions" && !obj.github_run_id) {
      errors.push(error("github_run_id", gateCode, `${gateLabel} requires github_run_id`));
    }
    if (expectedBackend === "kubernetes_job" && !asObject(obj.kubernetes_job)) {
      errors.push(error("kubernetes_job", gateCode, `${gateLabel} requires Kubernetes Job evidence`));
    }
    if (obj.result === "succeeded" && !obj.commit_sha) {
      errors.push(error("commit_sha", "required_for_success", "Successful status requires commit_sha"));
    }
    if (branchPush?.result !== "succeeded") {
      errors.push(error("branch_push.result", gateCode, `${gateLabel} requires pushed branch`));
    }
    if (pathPolicy?.allowed !== true) {
      errors.push(error("path_policy.allowed", gateCode, `${gateLabel} requires allowed path policy`));
    }
    if (!Array.isArray(pathPolicy?.violations) || pathPolicy.violations.length !== 0) {
      errors.push(error("path_policy.violations", gateCode, `${gateLabel} requires no path policy violations`));
    }
    if (secretScan?.result !== "passed") {
      errors.push(error("secret_scan.result", gateCode, `${gateLabel} requires passed secret scan`));
    }
    if (!Array.isArray(obj.checks) || obj.checks.some((check) => check?.result === "failed")) {
      errors.push(error("checks", gateCode, `${gateLabel} requires no failed checks`));
    }
    if (obj.finalization?.credentialed_model_code_executed !== false) {
      errors.push(
        error(
          "finalization.credentialed_model_code_executed",
          gateCode,
          `${gateLabel} requires no model-controlled code in credentialed finalization`
        )
      );
    }
    if (obj.finalization?.hooks_disabled !== true) {
      errors.push(error("finalization.hooks_disabled", gateCode, `${gateLabel} requires disabled git hooks`));
    }
    if (obj.finalization?.repo_config_ignored !== true) {
      errors.push(error("finalization.repo_config_ignored", gateCode, `${gateLabel} requires ignored repository-local git config`));
    }
    if (obj.finalization?.staging !== TRUSTED_FINALIZATION_STAGING) {
      errors.push(error("finalization.staging", gateCode, `${gateLabel} requires clean trusted staging`));
    }
    if (obj.finalization?.git_invocation !== TRUSTED_FINALIZATION_GIT_INVOCATION) {
      errors.push(error("finalization.git_invocation", gateCode, `${gateLabel} requires sanitized git invocation`));
    }
  }

  if (obj.result === "no_changes") {
    if (dryRunNoChangesValidation) {
      requireDryRunNoChangesExpectedContext(expected, errors);
      if (obj.github_run_id !== null) {
        errors.push(error("github_run_id", "required_for_dry_run", "Dry-run no-change status requires github_run_id null"));
      }
      if (obj.commit_sha !== null) {
        errors.push(error("commit_sha", "required_for_dry_run", "Dry-run no-change status requires commit_sha null"));
      }
      if (branchPush?.result !== "not_attempted") {
        errors.push(error("branch_push.result", "required_for_dry_run", "Dry-run no-change status must not push an output branch"));
      }
    }
  }

  requireExpectedContext(obj, expected, errors);

  return result(errors);
}

function requireGithubLaunchFields(github, path, errors, { dispatchId, launchRef }) {
  if (github.trigger !== "push") {
    errors.push(error(`${path}.trigger`, "unsupported_trigger", "GitHub trigger must be push"));
  }
  requireString(github.workflow_file, `${path}.workflow_file`, errors);
  requireLaunchRef(github.workflow_ref, `${path}.workflow_ref`, errors, dispatchId);
  requireCanonicalRunName(github.run_name, `${path}.run_name`, errors, dispatchId);
  if (
    typeof launchRef === "string" &&
    typeof github.workflow_ref === "string" &&
    github.workflow_ref !== launchRef
  ) {
    errors.push(error(`${path}.workflow_ref`, "launch_ref_mismatch", "Workflow ref must match launch_ref"));
  }
}

function requireExecution(value, path, errors, { required }) {
  if (value === undefined && !required) return null;
  const execution = requireObject(value, path, errors);
  if (!execution) return null;
  if (!EXECUTION_BACKENDS.has(execution.backend)) {
    errors.push(error(`${path}.backend`, "unsupported_execution_backend", "Unsupported execution backend"));
  }
  return execution;
}

function requireKubernetesExecutionFields(execution, path, errors) {
  if (!execution) {
    errors.push(error(path, "required_for_kubernetes_job", "Kubernetes Job execution requires execution context"));
    return;
  }
  requireKubernetesName(execution.job_name, `${path}.job_name`, errors);
  requireKubernetesName(execution.namespace, `${path}.namespace`, errors);
}

function requireKubernetesJobStatus(value, path, errors) {
  const job = requireObject(value, path, errors);
  if (!job) return;
  requireKubernetesName(job.job_name, `${path}.job_name`, errors);
  requireKubernetesName(job.namespace, `${path}.namespace`, errors);
  requireString(job.uid, `${path}.uid`, errors);
  requireKubernetesName(job.result_config_map_name, `${path}.result_config_map_name`, errors);
  requireString(job.result_resource_version, `${path}.result_resource_version`, errors);
  if (job.result_resource_version === KUBERNETES_RESULT_RESOURCE_VERSION_PLACEHOLDER) {
    errors.push(error(`${path}.result_resource_version`, "unresolved_kubernetes_metadata", "Kubernetes result resource version must be observed metadata, not the wrapper placeholder"));
  }
}

function requireCanonicalRunName(value, path, errors, dispatchId) {
  requireString(value, path, errors);
  if (typeof value !== "string") return;
  if (typeof dispatchId === "string" && DISPATCH_KEY_PATTERN.test(dispatchId)) {
    const expected = `agent-worker/${dispatchId}`;
    if (value !== expected) {
      errors.push(error(path, "run_name_mismatch", "GitHub run name must be agent-worker/<dispatch_idempotency_key>"));
    }
  }
}

function requireExecutionEnvironment(value, path, errors) {
  const executionEnvironment = requireObject(value, path, errors);
  if (!executionEnvironment) return;

  if (typeof executionEnvironment.model_execution_privileged !== "boolean") {
    errors.push(error(`${path}.model_execution_privileged`, "expected_boolean", "Expected boolean"));
  }

  requireString(executionEnvironment.isolation_mode, `${path}.isolation_mode`, errors);
  if (
    typeof executionEnvironment.isolation_mode === "string" &&
    !EXECUTION_ISOLATION_MODES.has(executionEnvironment.isolation_mode)
  ) {
    errors.push(error(`${path}.isolation_mode`, "unsupported_isolation_mode", "Unsupported model execution isolation mode"));
  }
  requireString(executionEnvironment.isolation_evidence_ref, `${path}.isolation_evidence_ref`, errors);

  if (executionEnvironment.model_execution_privileged === true) {
    if (executionEnvironment.isolation_mode !== PRIVILEGED_ISOLATION_MODE) {
      errors.push(
        error(
          `${path}.isolation_mode`,
          "privileged_claims_credential_separation",
          "Privileged model execution must not claim credential separation"
        )
      );
    }
  } else if (executionEnvironment.model_execution_privileged === false) {
    if (!UNPRIVILEGED_ISOLATION_MODES.has(executionEnvironment.isolation_mode)) {
      errors.push(
        error(
          `${path}.isolation_mode`,
          "required_for_unprivileged_model",
          "Unprivileged model execution requires a supported isolation mode"
        )
      );
    }
  }

  requireRunnerImage(executionEnvironment.runner_image, `${path}.runner_image`, errors);
  requireToolVersions(executionEnvironment.tool_versions, `${path}.tool_versions`, errors);
}

function requireRunnerImage(value, path, errors) {
  const runnerImage = requireObject(value, path, errors);
  if (!runnerImage) return;

  requireString(runnerImage.image, `${path}.image`, errors);
  requireString(runnerImage.digest, `${path}.digest`, errors);

  if (typeof runnerImage.digest !== "string") return;

  if (runnerImage.digest === RUNNER_DIGEST_UNAVAILABLE) {
    requireString(runnerImage.digest_unavailable_reason, `${path}.digest_unavailable_reason`, errors);
    return;
  }

  if (!SHA256_PATTERN.test(runnerImage.digest)) {
    errors.push(error(`${path}.digest`, "invalid_runner_image_digest", "Expected sha256 digest or explicit unavailable marker"));
    return;
  }

  if (runnerImage.digest_unavailable_reason !== null) {
    errors.push(error(`${path}.digest_unavailable_reason`, "expected_null", "Runner image digest reason must be null when digest is present"));
  }
}

function requireToolVersions(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(error(path, "expected_array", "Expected array"));
    return;
  }

  if (value.length === 0) {
    errors.push(error(path, "expected_non_empty_array", "Expected at least one tool version"));
  }

  for (const [index, toolVersion] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const item = requireObject(toolVersion, itemPath, errors);
    if (!item) continue;
    requireString(item.name, `${itemPath}.name`, errors);
    requireString(item.version, `${itemPath}.version`, errors);
    requireString(item.evidence_ref, `${itemPath}.evidence_ref`, errors);
  }
}

function requireWrapper(value, path, errors) {
  const wrapper = requireObject(value, path, errors);
  if (!wrapper) return;

  requireString(wrapper.name, `${path}.name`, errors);
  requireString(wrapper.version, `${path}.version`, errors);
  requireString(wrapper.source, `${path}.source`, errors);
  requirePattern(wrapper.digest, `${path}.digest`, SHA256_PATTERN, errors);

  if (typeof wrapper.source === "string" && !isImmutableWrapperSource(wrapper.source)) {
    errors.push(error(`${path}.source`, "mutable_wrapper_source", "Wrapper source must be pinned and external to the model-writable checkout"));
  }
}

function requireFinalization(value, path, errors) {
  const finalization = requireObject(value, path, errors);
  if (!finalization) return;

  requireString(finalization.staging, `${path}.staging`, errors);
  requireString(finalization.git_invocation, `${path}.git_invocation`, errors);

  for (const key of [
    "hooks_disabled",
    "repo_config_ignored",
    "credentialed_model_code_executed"
  ]) {
    if (typeof finalization[key] !== "boolean") {
      errors.push(error(`${path}.${key}`, "expected_boolean", "Expected boolean"));
    }
  }
}

function requireChecks(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(error(path, "expected_array", "Expected array"));
    return;
  }

  for (const [index, check] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const item = requireObject(check, itemPath, errors);
    if (!item) continue;
    requireString(item.name, `${itemPath}.name`, errors);
    if (!CHECK_RESULTS.has(item.result)) {
      errors.push(error(`${itemPath}.result`, "unsupported_result", "Unsupported check result"));
    }
    requireString(item.evidence_ref, `${itemPath}.evidence_ref`, errors);
    if (item.result === "skipped" && !item.skip_reason) {
      errors.push(error(`${itemPath}.skip_reason`, "required_for_skip", "Skipped checks require skip_reason"));
    }
  }
}

function requireObject(value, path, errors) {
  const obj = asObject(value);
  if (!obj) {
    errors.push(error(path, "expected_object", "Expected object"));
    return null;
  }
  return obj;
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(error(path, "expected_string", "Expected non-empty string"));
  }
}

function requireKubernetesName(value, path, errors) {
  requireString(value, path, errors);
  if (typeof value !== "string") return;
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value) || value.length > 63) {
    errors.push(error(path, "invalid_kubernetes_name", "Expected a DNS-label Kubernetes name"));
  }
}

function requireStringArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(error(path, "expected_array", "Expected array"));
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(error(`${path}[${index}]`, "expected_string", "Expected non-empty string"));
    }
  }
}

function requireTouchedPaths(value, path, errors) {
  requireStringArray(value, path, errors);
  if (!Array.isArray(value)) return;
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string") continue;
    if (
      item.startsWith("/") ||
      item === "." ||
      item === ".." ||
      item.includes("..") ||
      FORBIDDEN_TOUCHED_PATHS.has(item) ||
      FORBIDDEN_TOUCHED_PATH_PREFIXES.some((prefix) => item.startsWith(prefix))
    ) {
      errors.push(error(`${path}[${index}]`, "forbidden_runtime_path", "Touched paths must not include runtime, git, cache, or unsafe paths"));
    }
  }
}

function requirePattern(value, path, pattern, errors) {
  requireString(value, path, errors);
  if (typeof value === "string" && !pattern.test(value)) {
    errors.push(error(path, "invalid_format", "Invalid format"));
  }
}

function requireSha(value, path, errors) {
  requirePattern(value, path, SHA_PATTERN, errors);
}

function requireDispatchKey(value, path, errors) {
  requirePattern(value, path, DISPATCH_KEY_PATTERN, errors);
}

function requireGithubRunId(value, path, errors) {
  if (value === null) return;
  requirePattern(value, path, GITHUB_RUN_ID_PATTERN, errors);
}

function requireIdentityMatchesDispatch(obj, prefix, errors) {
  if (typeof obj.dispatch_idempotency_key !== "string" || !DISPATCH_KEY_PATTERN.test(obj.dispatch_idempotency_key)) {
    return;
  }
  const [initiativeId, wkId, attemptId] = obj.dispatch_idempotency_key.split("/");
  compareField(obj.initiative_id, initiativeId, `${prefix}initiative_id`, "dispatch_identity_mismatch", errors);
  compareField(obj.wk_id, wkId, `${prefix}wk_id`, "dispatch_identity_mismatch", errors);
  compareField(obj.attempt_id, attemptId, `${prefix}attempt_id`, "dispatch_identity_mismatch", errors);
}

function requireInt(value, path, errors, { expected, optional = false } = {}) {
  if (value === undefined && optional) return;
  if (!Number.isInteger(value)) {
    errors.push(error(path, "expected_integer", "Expected integer"));
    return;
  }
  if (expected !== undefined && value !== expected) {
    errors.push(error(path, "unsupported_version", `Expected ${expected}`));
  }
}

function requireLaunchRef(value, path, errors, dispatchId) {
  requireString(value, path, errors);
  if (typeof value !== "string") return;
  if (!value.startsWith(LAUNCH_REF_PREFIX)) {
    errors.push(error(path, "invalid_launch_ref", `Expected ${LAUNCH_REF_PREFIX}...`));
  }
  if (typeof dispatchId === "string" && DISPATCH_KEY_PATTERN.test(dispatchId) && value !== `${LAUNCH_REF_PREFIX}${dispatchId}`) {
    errors.push(error(path, "idempotency_key_mismatch", "Launch ref must end with dispatch_idempotency_key"));
  }
}

function requireOutputBranch(value, path, errors, dispatchId) {
  requireString(value, path, errors);
  if (typeof value !== "string") return;
  if (!OUTPUT_BRANCH_PATTERN.test(value)) {
    errors.push(error(path, "unsafe_branch", "Output branch must be agent/<initiative>/<wk>/<attempt>"));
    return;
  }
  if (typeof dispatchId === "string" && DISPATCH_KEY_PATTERN.test(dispatchId) && value !== `agent/${dispatchId}`) {
    errors.push(error(path, "idempotency_key_mismatch", "Output branch must match dispatch_idempotency_key"));
  }
}

function requireRemoteRef(value, path, errors, outputBranch) {
  requireString(value, path, errors);
  if (typeof value !== "string") return;
  const expected = typeof outputBranch === "string" ? `${REMOTE_REF_PREFIX}${outputBranch}` : null;
  if (!value.startsWith(REMOTE_REF_PREFIX) || (expected && value !== expected)) {
    errors.push(error(path, "remote_ref_mismatch", "Remote ref must point at output_branch"));
  }
}

function requireRefValue(value, path, errors) {
  requireString(value, path, errors);
  if (typeof value !== "string") return;
  if (value !== "absent" && !SHA_PATTERN.test(value)) {
    errors.push(error(path, "invalid_ref_value", "Expected absent or commit SHA"));
  }
}

function requireExpectedContext(obj, expected, errors) {
  const context = asObject(expected);
  if (!context) return;
  const backend = expectedExecutionBackend(context);

  if (context.validation_mode !== undefined && !VALIDATION_MODES.has(context.validation_mode)) {
    errors.push(error("validation_mode", "unsupported_validation_mode", "Expected validation_mode live or dry_run when provided"));
  }

  const launchRecord = asObject(context.launchRecord ?? context.launch_record);
  if (launchRecord) {
    if (backend === "github_actions") {
      requireExpectedLaunchRecordRunName(launchRecord, obj.dispatch_idempotency_key, errors);
    }
    compareField(obj.dispatch_idempotency_key, launchRecord.dispatch_idempotency_key, "dispatch_idempotency_key", "expected_context_mismatch", errors);
    compareField(obj.initiative_id, launchRecord.initiative_id, "initiative_id", "expected_context_mismatch", errors);
    compareField(obj.wk_id, launchRecord.wk_id, "wk_id", "expected_context_mismatch", errors);
    compareField(obj.attempt_id, launchRecord.attempt_id, "attempt_id", "expected_context_mismatch", errors);
    compareField(obj.base_sha, launchRecord.base_sha, "base_sha", "expected_context_mismatch", errors);
    compareField(obj.output_branch, launchRecord.output_branch, "output_branch", "expected_context_mismatch", errors);
    compareField(obj.launch?.launch_ref, launchRecord.launch_ref, "launch.launch_ref", "expected_context_mismatch", errors);
    compareField(obj.launch?.launch_sha, launchRecord.launch_sha, "launch.launch_sha", "expected_context_mismatch", errors);
    compareWrapper(obj.wrapper, launchRecord.wrapper, "wrapper", errors);
    if (backend === "kubernetes_job") {
      compareField(obj.kubernetes_job?.job_name, launchRecord.execution?.job_name, "kubernetes_job.job_name", "expected_context_mismatch", errors);
      compareField(obj.kubernetes_job?.namespace, launchRecord.execution?.namespace, "kubernetes_job.namespace", "expected_context_mismatch", errors);
    }
  }

  if (backend === "github_actions" && context.github_run_id !== undefined) {
    compareField(obj.github_run_id, context.github_run_id, "github_run_id", "expected_context_mismatch", errors);
  }
  if (backend === "kubernetes_job" && context.kubernetes_job !== undefined) {
    const expectedJob = asObject(context.kubernetes_job);
    compareField(obj.kubernetes_job?.job_name, expectedJob?.job_name, "kubernetes_job.job_name", "expected_context_mismatch", errors);
    compareField(obj.kubernetes_job?.namespace, expectedJob?.namespace, "kubernetes_job.namespace", "expected_context_mismatch", errors);
    compareField(obj.kubernetes_job?.uid, expectedJob?.uid, "kubernetes_job.uid", "expected_context_mismatch", errors);
    compareField(obj.kubernetes_job?.result_config_map_name, expectedJob?.result_config_map_name, "kubernetes_job.result_config_map_name", "expected_context_mismatch", errors);
    compareField(obj.kubernetes_job?.result_resource_version, expectedJob?.result_resource_version, "kubernetes_job.result_resource_version", "expected_context_mismatch", errors);
  }
  if (context.wrapper !== undefined) {
    compareWrapper(obj.wrapper, context.wrapper, "wrapper", errors);
  }
}

function expectedExecutionBackend(expected) {
  const context = asObject(expected);
  const launchRecord = asObject(context?.launchRecord ?? context?.launch_record);
  const backend = context?.execution_backend ?? launchRecord?.execution?.backend ?? "github_actions";
  return backend === "kubernetes_job" ? "kubernetes_job" : "github_actions";
}

function isDryRunExpectedContext(expected) {
  return asObject(expected)?.validation_mode === DRY_RUN_VALIDATION_MODE;
}

function requireDryRunNoChangesExpectedContext(expected, errors) {
  const context = asObject(expected);
  const launchRecord = asObject(context?.launchRecord ?? context?.launch_record);
  if (!launchRecord) {
    errors.push(error("launchRecord", "required_for_dry_run", "Dry-run no-change validation requires expected launch record context"));
  } else {
    requireCompleteDryRunLaunchRecord(launchRecord, errors);
  }

  if (!hasExpectedWrapperSourceAndDigest(context?.wrapper) && !hasExpectedWrapperSourceAndDigest(launchRecord?.wrapper)) {
    errors.push(error("wrapper", "required_for_dry_run", "Dry-run no-change validation requires expected wrapper context"));
  }
}

function requireCompleteDryRunLaunchRecord(launchRecord, errors) {
  requireExpectedString(launchRecord.initiative_id, "launchRecord.initiative_id", "Dry-run no-change validation requires expected initiative_id", errors);
  requireExpectedString(launchRecord.wk_id, "launchRecord.wk_id", "Dry-run no-change validation requires expected wk_id", errors);
  requireExpectedString(launchRecord.attempt_id, "launchRecord.attempt_id", "Dry-run no-change validation requires expected attempt_id", errors);
  requireExpectedString(
    launchRecord.dispatch_idempotency_key,
    "launchRecord.dispatch_idempotency_key",
    "Dry-run no-change validation requires expected dispatch_idempotency_key",
    errors
  );
  requireExpectedString(launchRecord.launch_ref, "launchRecord.launch_ref", "Dry-run no-change validation requires expected launch_ref", errors);
  requireExpectedString(launchRecord.launch_sha, "launchRecord.launch_sha", "Dry-run no-change validation requires expected launch_sha", errors);
  requireExpectedString(launchRecord.base_sha, "launchRecord.base_sha", "Dry-run no-change validation requires expected base_sha", errors);
  requireExpectedString(launchRecord.output_branch, "launchRecord.output_branch", "Dry-run no-change validation requires expected output_branch", errors);

  const github = asObject(launchRecord.github);
  if (!github) {
    errors.push(error("launchRecord.github", "required_for_dry_run", "Dry-run no-change validation requires expected GitHub context"));
  } else {
    requireExpectedString(github.run_name, "launchRecord.github.run_name", "Dry-run no-change validation requires expected GitHub run name", errors);
    requireExpectedLaunchRecordRunName(launchRecord, launchRecord.dispatch_idempotency_key, errors);
  }
}

function requireExpectedString(value, path, message, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(error(path, "required_for_dry_run", message));
  }
}

function requireExpectedLaunchRecordRunName(launchRecord, fallbackDispatchId, errors) {
  const github = asObject(launchRecord.github);
  if (!github || github.run_name === undefined) return;
  requireCanonicalRunName(
    github.run_name,
    "launchRecord.github.run_name",
    errors,
    launchRecord.dispatch_idempotency_key ?? fallbackDispatchId
  );
}

function hasExpectedWrapperSourceAndDigest(value) {
  const wrapper = asObject(value);
  return typeof wrapper?.source === "string" && wrapper.source.trim() !== "" &&
    typeof wrapper.digest === "string" && SHA256_PATTERN.test(wrapper.digest);
}

function requireLaunchRecordMatchesHandoff(launchRecord, handoff, errors) {
  if (!asObject(handoff)) return;

  for (const key of [
    "dispatch_idempotency_key",
    "base_sha",
    "launch_ref",
    "output_branch"
  ]) {
    compareField(handoff[key], launchRecord[key], `handoff.${key}`, "launch_record_mismatch", errors);
  }
  compareField(handoff.execution?.backend, launchRecord.execution?.backend, "handoff.execution.backend", "launch_record_mismatch", errors);
  compareField(handoff.execution?.job_name, launchRecord.execution?.job_name, "handoff.execution.job_name", "launch_record_mismatch", errors);
  compareField(handoff.execution?.namespace, launchRecord.execution?.namespace, "handoff.execution.namespace", "launch_record_mismatch", errors);
}

function compareWrapper(actual, expected, path, errors) {
  if (!asObject(actual) || !asObject(expected)) return;
  for (const key of ["name", "version", "source", "digest"]) {
    compareField(actual[key], expected[key], `${path}.${key}`, "expected_context_mismatch", errors);
  }
}

function compareField(actual, expected, path, code, errors) {
  if (expected !== undefined && actual !== undefined && actual !== expected) {
    errors.push(error(path, code, "Value does not match expected context"));
  }
}

function isImmutableWrapperSource(value) {
  if (value.trim() !== value || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  if (/^(?:local|repo)(?:[:/@]|$)/i.test(value)) return false;
  if (/^(?:\.{1,2}\/|\/)/.test(value)) return false;
  if (value.includes("..")) return false;
  if (/@sha256:[0-9a-f]{64}$/i.test(value)) return true;

  const atIndex = value.lastIndexOf("@");
  if (atIndex <= 0) return false;
  const ref = value.slice(atIndex + 1);
  return FULL_SHA_PATTERN.test(ref);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function error(path, code, message) {
  return { path, code, message };
}

function prefixError(prefix, item) {
  return {
    ...item,
    path: item.path ? `${prefix}.${item.path}` : prefix
  };
}

function result(errors) {
  return {
    valid: errors.length === 0,
    errors
  };
}

function invalid(errors) {
  return { valid: false, errors };
}
