

import path from "node:path";
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, accessSync, constants } from "node:fs";

import { executeTestProofAttempt } from "./workspace-agent-test-proof-evidence.mjs";
import { buildBehavioralPreservationEvidencePair } from
  "./workspace-agent-behavioral-preservation-evidence.mjs";
import { extractPairedBehavioralPreservationEvidenceReceipt } from
  "./workspace-agent-dispatch-run-receipt.mjs";
import { assertLauncherTestProofProviderExecution } from
  "./workspace-agent-test-proof-provider-registry.mjs";
import {
  WORKSPACE_AGENT_VALIDATION_DISPOSITIONS,
  assertTestProofExecutionBudget
} from "./test-execution/confined-capture.mjs";

export {
  DEFAULT_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES,
  DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
  DEFAULT_VALIDATION_OUTPUT_CAP_BYTES,
  DEFAULT_VALIDATION_TIMEOUT_MS,
  TEST_PROOF_LIVE_CLEANUP_ALLOWANCE_MS,
  WORKSPACE_AGENT_VALIDATION_DISPOSITIONS,
  assertTestProofExecutionBudget,
  mintTestProofExecutionBudget,
  resolveValidationOutputBounds
} from "./test-execution/confined-capture.mjs";
import { assertLauncherTestProofRuntimeAuthority } from
  "./workspace-agent-test-proof-runtime-identity.mjs";
import { mintProofStage, runOrdinaryTestFile, runProofStageTestFile } from
  "./test-execution/ordinary-test-runner.mjs";
import { inspectDependencyMountpoint } from "./dependency-mountpoint-occupant.mjs";
import { compiledValidatorCacheRoot } from "@agent-chassis/controlled-contract/validator-cache";
export const WORKSPACE_AGENT_VALIDATION_RUN_RESULT_SCHEMA_VERSION =
  "workspace-agent-validation-run-result.v1";
export const WORKSPACE_AGENT_VALIDATION_RUN_REFUSAL_SCHEMA_VERSION =
  "workspace-agent-validation-run-refusal.v1";

export async function runWorkspaceAgentTestProofAttempt(input) {
  return executeTestProofAttempt(input);
}

export function runWorkspaceAgentBehavioralPreservationPair(...sides) {
  return extractPairedBehavioralPreservationEvidenceReceipt(
    buildBehavioralPreservationEvidencePair(...sides)
  );
}

export const WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES = Object.freeze({
  RAW_EXEC_FORBIDDEN: "workspace_agent_validation_runner.raw_exec_forbidden.v1",
  WORKSPACE_INVALID: "workspace_agent_validation_runner.workspace_invalid.v1",
  TARGET_FILE_ABSENT: "workspace_agent_validation_runner.target_file_absent.v1",
  TARGET_NOT_REGULAR: "workspace_agent_validation_runner.target_not_regular.v1",
  TARGET_FILESYSTEM_FAILURE: "workspace_agent_validation_runner.target_filesystem_failure.v1",
  TARGET_INVALID: "workspace_agent_validation_runner.target_invalid.v1",
  TARGET_PATH_ESCAPE: "workspace_agent_validation_runner.target_path_escape.v1",
  TARGET_NOT_AUTHORIZED: "workspace_agent_validation_runner.target_not_authorized.v1"
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function buildRefusal(code, message, detail = null) {
  const refusal = {
    schema_version: WORKSPACE_AGENT_VALIDATION_RUN_REFUSAL_SCHEMA_VERSION,
    accepted: false,
    refusal_code: code,
    refusal_message: message
  };
  if (detail !== null) {
    refusal.detail = detail;
  }
  return Object.freeze(refusal);
}

export function isWorkspaceAgentValidationRunRefusal(value) {
  return (
    isPlainObject(value) &&
    value.schema_version === WORKSPACE_AGENT_VALIDATION_RUN_REFUSAL_SCHEMA_VERSION &&
    value.accepted === false &&
    typeof value.refusal_code === "string"
  );
}

const NODE_VALIDATION_TARGET_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs"]);

function normalizeRelativeTargetString(target, allowedExtensions = NODE_VALIDATION_TARGET_EXTENSIONS) {
  if (!isNonEmptyString(target)) {
    return { ok: false, message: "target must be a non-empty string" };
  }
  const trimmed = target.trim();
  if (path.isAbsolute(trimmed)) {
    return { ok: false, message: `target must be repo-relative, not absolute: ${trimmed}`, escape: true };
  }

  const posix = trimmed.split(path.sep).join("/");
  const segments = posix.split("/").filter((seg) => seg !== "" && seg !== ".");
  if (segments.some((seg) => seg === "..")) {
    return { ok: false, message: `target must not contain a traversal segment: ${trimmed}`, escape: true };
  }
  if (segments.length === 0) {
    return { ok: false, message: `target resolves to an empty path: ${trimmed}` };
  }
  const normalized = segments.join("/");
  const ext = path.extname(normalized).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    return { ok: false, message: `target must be a ${allowedExtensions.join("/")} file: ${normalized}` };
  }
  return { ok: true, posixRelative: normalized };
}

export function authorizeValidationTarget({ workspaceDir, target, authorizedTargets,
  allowedExtensions = NODE_VALIDATION_TARGET_EXTENSIONS } = {}) {
  if (!isNonEmptyString(workspaceDir)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.WORKSPACE_INVALID,
      "workspaceDir must be a non-empty string"
    );
  }
  let repoReal;
  try {
    repoReal = realpathSync(workspaceDir);
  } catch (err) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.WORKSPACE_INVALID,
      `workspaceDir does not resolve to a real path: ${workspaceDir}`,
      { errno: err?.code ?? null }
    );
  }

  const normalized = normalizeRelativeTargetString(target, allowedExtensions);
  if (!normalized.ok) {
    return buildRefusal(
      normalized.escape
        ? WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_PATH_ESCAPE
        : WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_INVALID,
      normalized.message
    );
  }

  if (!Array.isArray(authorizedTargets) || authorizedTargets.length === 0) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_NOT_AUTHORIZED,
      "no declared-validation targets are authorized for this unit",
      { requested_target: normalized.posixRelative }
    );
  }
  const authorizedSet = new Set();
  for (const entry of authorizedTargets) {
    const entryNormalized = normalizeRelativeTargetString(entry, allowedExtensions);
    if (entryNormalized.ok) {
      authorizedSet.add(entryNormalized.posixRelative);
    }
  }
  if (!authorizedSet.has(normalized.posixRelative)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_NOT_AUTHORIZED,
      `target is not among the unit's declared validation targets: ${normalized.posixRelative}`,
      { requested_target: normalized.posixRelative, authorized_targets: [...authorizedSet].sort() }
    );
  }

  let absolute;
  try {
    absolute = realpathSync(path.resolve(repoReal, normalized.posixRelative));
    const relativeBack = path.relative(repoReal, absolute);
    if (relativeBack === ".." || relativeBack.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeBack)) {
      return buildRefusal(
        WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_PATH_ESCAPE,
        "declared validation target resolves outside the candidate",
        { requested_target: normalized.posixRelative }
      );
    }
    if (!statSync(absolute).isFile()) return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_NOT_REGULAR,
      "declared validation target is not a regular file",
      { requested_target: normalized.posixRelative }
    );
    accessSync(absolute, constants.R_OK);
  } catch (error) {
    return buildRefusal(
      error.code === "ENOENT"
        ? WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_FILE_ABSENT
        : WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.TARGET_FILESYSTEM_FAILURE,
      "declared validation target filesystem check failed",
      { requested_target: normalized.posixRelative, errno: error.code ?? null }
    );
  }

  return { ok: true, repoReal, posixRelative: normalized.posixRelative, absolute };
}

export async function runLauncherTestProofDeclaredTest(input = {}) {
  const allowedKeys = new Set([
    "authority", "target", "authorizedTargets", "testProofProviderExecution", "executionBudget"
  ]);
  if (!isPlainObject(input) || Object.keys(input).some((key) => !allowedKeys.has(key))) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "launcher test-proof execution refuses caller-selected runtime authority"
    );
  }
  let authority;
  try {
    authority = assertLauncherTestProofRuntimeAuthority(input.authority);
  } catch (error) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.WORKSPACE_INVALID,
      error?.message ?? String(error),
      { error_code: error?.code ?? null }
    );
  }
  if (!["managed_worker", "managed_reviewer", "terminal_candidate",
    "integrated_slice", "orchestrator_git_commit",
    "orchestrator_worktree_snapshot"].includes(authority.kind)) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.WORKSPACE_INVALID,
      "launcher test-proof runtime authority kind is unsupported"
    );
  }
  let executionBudget = null;
  let execution = null;
  try {
    if (Object.hasOwn(input, "executionBudget")) {
      executionBudget = assertTestProofExecutionBudget(input.executionBudget);
    }
    if (Object.hasOwn(input, "testProofProviderExecution")) {
      execution = assertLauncherTestProofProviderExecution(input.testProofProviderExecution);
    }
  } catch (error) {
    return buildRefusal(
      WORKSPACE_AGENT_VALIDATION_RUNNER_REFUSAL_CODES.RAW_EXEC_FORBIDDEN,
      "test-proof execution authority and budget must be launcher-minted",
      { error_code: error?.code ?? null }
    );
  }
  const authorized = authorizeValidationTarget({
    workspaceDir: authority.worktree_path,
    target: input.target,
    authorizedTargets: input.authorizedTargets,
    ...(execution?.target_extensions ? { allowedExtensions: execution.target_extensions } : {})
  });
  if (isWorkspaceAgentValidationRunRefusal(authorized)) return authorized;

  const consumesValidatorCache = execution === null || execution.consumer_dependencies === true;
  const authorityBinds = consumesValidatorCache ? [...(authority.validator_cache_read_only_binds ?? [])] : [];

  const request = {
    repositoryRoot: authority.main_repo,
    checkoutRoot: authorized.repoReal,
    target: authorized.posixRelative,
    runner: execution?.runner ?? "node-test",
    ...(execution === null || execution.environment === null ? {} : { environment: execution.environment }),
    ...(executionBudget === null ? {} : { timeoutMs: executionBudget.timeout_ms, budget: executionBudget })
  };
  const envelope = {
    unit: authority.selected_unit,
    advisory: true,
    admission_effect: "none",
    review_effect: "none",
    closure_effect: "none"
  };

  if (execution === null) {
    return Object.freeze({ ...await runOrdinaryTestFile(request), ...envelope });
  }

  const stage = authorityBinds.length === 0 ? execution.stage : mintProofStage({
    compilerCache: execution.stage.compilerCache,
    compose: async (facts) => {
      const expectedCacheRoot = compiledValidatorCacheRoot();
      const expectedCacheDestination = path.join(authority.worktree_path,
        ".cache", "controlled-contract", "validators");
      for (const bind of authorityBinds) {
        if (bind.src === bind.dst) continue;
        if (bind.src === expectedCacheRoot && bind.dst === expectedCacheDestination) {
          projectVerifiedValidatorCache(bind);
          continue;
        }
        throw proofStageInputProjectionError(bind,
          Object.assign(new Error("authenticated differing input mapping has no host projection owner"), {
            code: "unsupported_authenticated_mapping"
          }));
      }
      const composed = await execution.stage.compose(facts);
      const mounted = new Set(facts.runtime.binds.map(({ dst }) => dst));
      return { ...composed, additions: { ...(composed.additions ?? {}),
        readOnlyBinds: [...authorityBinds.filter(({ dst }) => !mounted.has(dst)),
          ...(composed.additions?.readOnlyBinds ?? [])] } };
    }
  });
  const result = await runProofStageTestFile(request, stage);
  return proofStageRun({ result, authorized, execution, executionBudget, envelope });
}

function proofStageInputProjectionError({ src, dst }, cause) {
  return Object.assign(new Error(
    `authenticated proof input could not be projected from ${src} to ${dst}: ${cause?.message ?? String(cause)}`
  ), {
    code: "proof_stage_input_projection_failed.v1",
    details: Object.freeze({ source: src, destination: dst,
      cause_code: cause?.code ?? null, cause_details: cause?.details ?? cause?.detail ?? null })
  });
}

function projectVerifiedValidatorCache({ src, dst }) {
  try {
    const sourceStat = lstatSync(src);
    const sourceReal = realpathSync(src);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink() || sourceReal !== src) {
      throw Object.assign(new Error("verified validator cache source is no longer a real directory"), {
        code: "validator_cache_source_changed"
      });
    }
    const checkoutRoot = path.resolve(dst, "..", "..", "..", "..");
    const relative = path.relative(checkoutRoot, path.dirname(dst));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw Object.assign(new Error("validator cache destination escaped its authenticated checkout"), {
        code: "validator_cache_destination_invalid"
      });
    }
    let parent = checkoutRoot;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      parent = path.join(parent, segment);
      try {
        lstatSync(parent);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        mkdirSync(parent, { mode: 0o700 });
      }
      const parentStat = lstatSync(parent);
      if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent) !== parent) {
        throw Object.assign(new Error(`validator cache destination parent is redirected: ${parent}`), {
          code: "validator_cache_destination_parent_invalid"
        });
      }
    }
    let occupant = inspectDependencyMountpoint(dst);
    if (occupant.state === "absent") {
      try {
        symlinkSync(src, dst, "dir");
        return;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;

        occupant = inspectDependencyMountpoint(dst);
      }
    }
    if (occupant.state !== "occupied" || occupant.kind !== "symlink") {
      const kind = occupant.kind ?? occupant.state;
      throw Object.assign(new Error(
        `validator cache destination ${dst} is occupied by ${kind}; remove or relocate that conflicting entry before retrying`
      ), {
        code: "validator_cache_destination_conflict",
        details: Object.freeze({ occupant_state: occupant.state, occupant_kind: kind })
      });
    }
    const linkTarget = readlinkSync(dst);
    const occupantReal = realpathSync(dst);
    if (occupantReal !== sourceReal) {
      throw Object.assign(new Error(
        `validator cache destination ${dst} is a symlink to ${linkTarget} (resolved as ${occupantReal}), not ${sourceReal}; remove or relocate that conflicting link before retrying`
      ), {
        code: "validator_cache_destination_conflict",
        details: Object.freeze({ occupant_state: occupant.state, occupant_kind: occupant.kind,
          occupant_target: linkTarget, occupant_realpath: occupantReal })
      });
    }
  } catch (error) {
    throw proofStageInputProjectionError({ src, dst }, error);
  }
}

function proofStageRun({ result, authorized, execution, executionBudget, envelope }) {
  const node = execution.runner === "node-test";
  const command = node ? "node" : path.basename(result.identity?.invocation?.command ?? execution.runner);
  const labels = {
    schema_version: WORKSPACE_AGENT_VALIDATION_RUN_RESULT_SCHEMA_VERSION,
    operation: node ? "node_test" : "native_test_proof",
    command,
    normalized_argv: Object.freeze(node
      ? ["node", "--test", "[launcher-test-proof-options]", authorized.posixRelative]
      : [command, "[launcher-test-proof-provider]", authorized.posixRelative]),
    target: authorized.posixRelative,
    raw_exec_enabled: false,
    enforcement_posture: Object.freeze({
      confined: false,
      execution_context: "host_test_execution",
      executes_target: true,
      filesystem: "host_permissions",
      network: "host_permissions",
      repo_mount: "host_checkout",
      secrets_masked: false,
      env: "curated_test_environment",
      spawn_site: "launcher_shared_test_runner"
    })
  };

  const runnerExecution = Object.freeze({
    status: result.status,
    ...(result.identity === undefined ? {} : { project: result.identity.project,
      environment: result.identity.environment, harness: result.identity.harness,
      selection: result.identity.selection, invocation: result.identity.invocation }),
    resolution: Object.freeze((result.resolution ?? []).map(({ invocation, run }) => Object.freeze({ invocation,
      disposition: run.disposition, exit_code: run.exit_code ?? null, timed_out: run.timed_out === true })))
  });
  if (result.status === "executed" || result.status === "not_run" || result.status === "unconfirmed") {
    return Object.freeze({ ...result.run, ...labels, runner_execution: runnerExecution, ...envelope });
  }
  const interruption = executionBudget?.interruption() ?? null;
  const code = interruption === "timed_out" ? "test_proof_execution_timed_out"
    : interruption === "cancelled" ? "test_proof_execution_cancelled" : result.code;
  return Object.freeze({
    ...labels,
    ran: false,
    skipped: false,
    disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN,
    ok: false,
    exit_code: null,
    signal: null,
    timed_out: interruption === "timed_out",
    cancelled: interruption === "cancelled",
    cleanup_failed: false,
    blocker_code: code,
    blocker_message: result.message,
    output_truncated: false,
    output_elided_bytes: 0,

    test_proof_observation: Object.freeze({ valid: false, code,
      detail: Object.freeze({ runner_status: result.status, ...(result.detail ?? {}),
        ...(result.recovery === undefined || result.recovery === null ? {} : { recovery: result.recovery }) }) }),
    runner_execution: runnerExecution,
    ...envelope
  });
}
