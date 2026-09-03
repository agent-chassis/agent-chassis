

import {
  BACKEND_REFUSAL_CODES,
  normalizeDispatchModelHint,

  validateLauncherFamilyRole
} from "./workspace-agent-dispatch-backend.mjs";
import { loadWorkRecordById } from "@agent-chassis/wiki-core";

import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";

import { resolveFamilyExecutorRole } from "./workspace-agent-family-launch-policy.mjs";
import {
  assertBubblewrapAvailable,
  spawnIsolated
} from "./launch-isolation.mjs";
import { createStdioMcpConduit } from "./stdio-mcp-conduit.mjs";

export const CODEX_WORKSPACE_AGENT_MCP_CONDUIT_CONSTRUCTOR = createStdioMcpConduit;
import {
  buildCodexRolePlan,
  buildCodexRoleBubblewrapPlan
} from "../commands/codex-role.mjs";
import { ensureNewWorkerWriteRoots } from "./codex-worker-plan.mjs";

import { defaultCaptureCodexFinalResult } from "./workspace-agent-codex-final-result.mjs";
import { consumeAdvisoryReviewInput } from "./workspace-agent-advisory-review-contract.mjs";
import {
  CODEX_EXECUTOR_ROLE_MAP,
  makeRefusal,
  resolveCodexTerminalStructuredRoleResultMode
} from "./workspace-agent-dispatch-codex-launch-support.mjs";
import { evaluateDispatchRoleModelGate } from "./workspace-agent-dispatch-codex-executor-policy.mjs";
import {
  launchCodexWorkspaceAgentInProcess,
  spawnPlainChildProcess
} from "./workspace-agent-dispatch-codex-in-process-runtime.mjs";
import {
  attachLauncherObservedTerminalResultModeFacts
} from "./workspace-agent-dispatch-result-mode.mjs";

import { resolveLauncherSchemaConstrainedTierIsPaid } from
  "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import { selectWorkerLifecycleFromEffectiveWriteScope } from
  "./workspace-agent-worker-lifecycle.mjs";

const CODEX_LAUNCH_TRANSPORT_SEAMS = Object.freeze([
  "buildPlan", "buildBwrapPlan", "spawn", "plainSpawn"
]);

export function createCodexWorkspaceAgentLaunchExecutor(options = {}) {
  const injectedTransportSeams = CODEX_LAUNCH_TRANSPORT_SEAMS
    .filter((key) => Object.prototype.hasOwnProperty.call(options, key));
  if (injectedTransportSeams.length > 0 &&
      !Object.prototype.hasOwnProperty.call(options, "createMcpConduit")) {
    throw new Error(
      "Codex launch executor: a composition that overrides "
      + `${injectedTransportSeams.join(", ")} must declare its createMcpConduit `
      + "constructor explicitly; required wiki-MCP is never implicitly disabled "
      + "(DEC-0167)"
    );
  }
  const {
    buildPlan = buildCodexRolePlan,
    buildBwrapPlan = buildCodexRoleBubblewrapPlan,
    ensureWriteRoots = ensureNewWorkerWriteRoots,
    assertBwrap = assertBubblewrapAvailable,
    spawn = spawnIsolated,
    plainSpawn = spawnPlainChildProcess,
    env = process.env,
    cwd: defaultCwd = process.cwd(),
    promptArgs = [],
    resolvedProfile = null,
    captureFinalResult = defaultCaptureCodexFinalResult,

    killTimeoutMs = null,

    resolveUnsandboxedOptIn = undefined,
    classifyIsolationBackendAvailability = undefined,
    probeCanonicalBwrapAvailability = undefined,

    resolveSchemaConstrainedTier = resolveLauncherSchemaConstrainedTierIsPaid,
    loadWorkRecord = loadWorkRecordById,
    createMcpConduit = createStdioMcpConduit
  } = options;

  return async function codexLaunchExecutor(input) {
    const role = input?.role ?? null;
    const subject = input?.subject ?? null;
    const workspaceAlias = typeof input?.workspace_alias === "string" && input.workspace_alias.length > 0
      ? input.workspace_alias
      : null;
    const workspaceDir = typeof input?.workspace_dir === "string" && input.workspace_dir.length > 0
      ? input.workspace_dir
      : null;

    const roleResolution = resolveFamilyExecutorRole({
      role,
      validateRole: validateLauncherFamilyRole,
      roleMap: CODEX_EXECUTOR_ROLE_MAP
    });
    if (!roleResolution.ok) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "unsupported_role_for_codex_executor",
        { role }
      );
    }
    const codexRole = roleResolution.familyRole;
    if (typeof subject !== "string" || subject.length === 0) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "subject_required_for_codex_executor",
        null
      );
    }
    let advisoryReviewInput = null;
    if (input?.advisory_review_input !== undefined) {
      try {
        advisoryReviewInput = consumeAdvisoryReviewInput(input.advisory_review_input, {
          role, subject
        });
      } catch {
        return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "advisory_review_input_invalid", { role, subject });
      }
    }
    let lifecycleKind = "advisory";
    if (advisoryReviewInput === null) {
      if (role !== "worker") {
        return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "advisory_review_input_required", { role, subject });
      }
      try {
        lifecycleKind = selectWorkerLifecycleFromEffectiveWriteScope(
          input?.canonical_unit_write_scope
        );
      } catch (error) {
        return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          error?.code ?? "launcher_effective_write_scope_invalid",
          { subject, authority_limb: "mechanical_failure" });
      }
      if (lifecycleKind !== "implementation") {
        return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "worker_implementation_lifecycle_required", { role, subject });
      }
    }
    if (Object.prototype.hasOwnProperty.call(input ?? {}, "workerScopeAuthority")) {
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, "worker_scope_authority_invalid", {
        message: "caller-controlled workerScopeAuthority alias is forbidden"
      });
    }
    const serverProvisionedWorktreeGitBinding = input?.provisionedWorktreeGitBinding
      ?? input?.provisioned_worktree_git_binding
      ?? null;
    const managedWorkerAuthorityRequired = codexRole === "worker" && (
      serverProvisionedWorktreeGitBinding !== null ||
      input?.worktree_provisioning != null ||
      input?.worker_scope_authority != null
    );
    try {
      assertFrozenWorkerScopeAuthority(input?.worker_scope_authority ?? null, {
        role: codexRole,
        subject,
        worktreeProvisioning: input?.worktree_provisioning ?? null,
        provisionedWorktreeGitBinding: serverProvisionedWorktreeGitBinding,
        required: managedWorkerAuthorityRequired
      });
    } catch (error) {
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, "worker_scope_authority_invalid", {
        message: error?.message ?? String(error)
      });
    }

    const launcherSelectedModel = normalizeDispatchModelHint(input?.model);
    if (managedWorkerAuthorityRequired && launcherSelectedModel === null) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "worker_model_unset",
        {
          role: "worker",
          env_key: "WORKER_MODEL",
          message: "worker_model_unset: no launcher-selected managed-worker model was provided"
        }
      );
    }
    const existingResolvedProfileModel = normalizeDispatchModelHint(resolvedProfile?.model);
    const modelGateResolvedProfile = launcherSelectedModel !== null && existingResolvedProfileModel === null
      ? Object.freeze({
          ...(resolvedProfile ?? {}),
          model: launcherSelectedModel
        })
      : resolvedProfile;
    const inProcessModelGate = await evaluateDispatchRoleModelGate({
      role,
      isWorker: role === "worker",
      resolvedProfile: modelGateResolvedProfile,
      modelHint: input?.model,
      cwd: workspaceDir ?? defaultCwd
    });
    if (!inProcessModelGate.ok) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        inProcessModelGate.reason,
        inProcessModelGate.detail
      );
    }
    const effectiveResolvedProfile = inProcessModelGate.resolvedProfile;

    const forwardedSourceToolSurface = null;

    const planCwd = workspaceDir ?? defaultCwd;

    const schemaConstrainedTierIsPaid = advisoryReviewInput !== null
      ? advisoryReviewInput.formal_result_contract?.mode === "schema_constrained"
      : workspaceDir
        ? resolveSchemaConstrainedTier({ workspaceDir }) === true
        : false;
    const terminalStructuredRoleResultMode = resolveCodexTerminalStructuredRoleResultMode({
      schemaConstrainedTierIsPaid,
      codexRole
    });

    const launchResult = await launchCodexWorkspaceAgentInProcess({
      input,
      role,
      subject,
      codexRole,
      promptArgs,
      env,
      planCwd,
      effectiveResolvedProfile,
      workspaceAlias,
      workspaceDir,
      forwardedSourceToolSurface,
      terminalStructuredRoleResultMode,
      buildPlan,
      buildBwrapPlan,
      ensureWriteRoots,
      assertBwrap,
      spawn,
      plainSpawn,
      captureFinalResult,
      killTimeoutMs,
      resolveUnsandboxedOptIn,
      classifyIsolationBackendAvailability,
      probeCanonicalBwrapAvailability,

      createMcpConduit
    });
    return launchResult?.accepted === true
      ? attachLauncherObservedTerminalResultModeFacts(
          launchResult,
          { selectedContract: terminalStructuredRoleResultMode }
        )
      : launchResult;
  };
}
