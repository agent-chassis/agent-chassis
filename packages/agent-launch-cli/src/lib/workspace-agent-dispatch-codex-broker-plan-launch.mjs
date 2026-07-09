import { loadWorkRecordById } from "@agent-chassis/wiki-core";
import { resolveLauncherSchemaConstrainedTierIsPaid } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import {
  adaptFamilyBrokerRefusal
} from "./workspace-agent-family-launch-policy.mjs";
import {
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS
} from "./host-write-authority-substrate.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "./agent-backend.mjs";
import {
  CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS
} from "./workspace-agent-codex-launch-policy.mjs";
import {
  buildCodexLaunchArtifacts,
  mapCodexArtifactsFailureToBrokerRefusal,
  resolveCodexTerminalStructuredRoleResultMode
} from "./workspace-agent-dispatch-codex-launch-support.mjs";
import {
  buildCodexDispatchWorkerPlanArgs
} from "./workspace-agent-dispatch-codex-plan-args.mjs";
import {
  captureCodexFinalResultFromPlan
} from "./workspace-agent-dispatch-codex-provenance.mjs";
import { resolveFindingsOnlyAcceptanceContract } from "./workspace-agent-findings-role-context.mjs";

export function createHostWriteAuthorityBrokerPlanLaunchImpl({
  options = {},
  deps
} = {}) {
  const {
    buildPlan = deps.buildPlan,
    buildBwrapPlan = deps.buildBwrapPlan,
    ensureWriteRoots = deps.ensureWriteRoots,
    env = process.env,
    cwd: defaultCwd = process.cwd(),
    promptArgs = [],
    resolvedProfile = null,
    prepareSourceToolSurface = null,
    captureFinalResult = deps.captureFinalResult,

    resolveSchemaConstrainedTier = resolveLauncherSchemaConstrainedTierIsPaid,
    loadWorkRecord = loadWorkRecordById
  } = options;
  const brokerSourceSurfacePreparer = typeof prepareSourceToolSurface === "function"
    ? prepareSourceToolSurface
    : createLauncherOwnedSourceToolSurfacePreparer({ env, cwd: defaultCwd });
  return async function brokerPlanLaunch(launchInput) {
    const codexRole = typeof launchInput?.codex_role === "string"
      ? launchInput.codex_role
      : null;
    const subject = typeof launchInput?.subject === "string"
      ? launchInput.subject
      : null;
    const workspaceAlias = typeof launchInput?.workspace_alias === "string" && launchInput.workspace_alias.length > 0
      ? launchInput.workspace_alias
      : null;
    const workspaceDir = typeof launchInput?.workspace_dir === "string"
      && launchInput.workspace_dir.length > 0
      ? launchInput.workspace_dir
      : null;

    if (!codexRole) {
      return adaptFamilyBrokerRefusal({
        reason: "broker_codex_role_missing",
        detail: { received: launchInput?.codex_role ?? null }
      });
    }
    if (!subject) {
      return adaptFamilyBrokerRefusal({
        reason: "broker_subject_missing",
        detail: { received: launchInput?.subject ?? null }
      });
    }

    const brokerSourceSurfacePolicy = await deps.resolveCodexWorkerSourceSurfacePolicy({
      role: codexRole,
      suppliedSourceToolSurface: launchInput?.source_tool_surface ?? null,
      preparer: brokerSourceSurfacePreparer,
      preparerInput: {
        app: "codex",
        role: "worker",
        subject,
        workspace_alias: workspaceAlias,
        workspace_dir: workspaceDir,
        readiness: launchInput?.readiness ?? null,
        run_id: typeof launchInput?.run_id === "string" ? launchInput.run_id : null,
        model: launchInput?.model ?? null
      }
    });
    if (
      brokerSourceSurfacePolicy.disposition
      === CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.REFUSAL
    ) {
      return adaptFamilyBrokerRefusal({
        reason: brokerSourceSurfacePolicy.reason,
        detail: brokerSourceSurfacePolicy.detail
      });
    }
    const sourceToolSurface = brokerSourceSurfacePolicy.forwardedSourceToolSurface;

    const brokerModelGate = await deps.evaluateDispatchRoleModelGate({
      role: codexRole,
      isWorker: codexRole === "worker",
      resolvedProfile,
      modelHint: launchInput?.model,
      cwd: workspaceDir ?? defaultCwd
    });
    if (!brokerModelGate.ok) {
      return adaptFamilyBrokerRefusal({
        reason: brokerModelGate.reason,
        detail: brokerModelGate.detail
      });
    }
    const effectiveResolvedProfile = brokerModelGate.resolvedProfile;

    let findingsOnlyAcceptance;
    try {
      findingsOnlyAcceptance = await resolveFindingsOnlyAcceptanceContract({
        role: codexRole,
        subject,
        workspaceDir: workspaceDir ?? defaultCwd,
        loadWorkRecord
      });
    } catch (err) {
      return adaptFamilyBrokerRefusal({
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_THREW,
        detail: {
          stage: "findings_only_acceptance_contract",
          message: err?.message ?? String(err),
          code: err?.code ?? null,
          detail: err?.detail ?? null
        }
      });
    }

    const brokerSchemaConstrainedTierIsPaid = workspaceDir
      ? resolveSchemaConstrainedTier({ workspaceDir }) === true
      : false;
    const terminalStructuredRoleResultMode = resolveCodexTerminalStructuredRoleResultMode({
      schemaConstrainedTierIsPaid: brokerSchemaConstrainedTierIsPaid,
      codexRole
    });

    const artifacts = await buildCodexLaunchArtifacts({
      planArgs: buildCodexDispatchWorkerPlanArgs({
        role: codexRole,
        subject,
        promptArgs,
        env,
        cwd: workspaceDir ?? defaultCwd,

        resolvedProfile: effectiveResolvedProfile,
        workspaceAlias,
        workspaceDir,
        acceptanceCriteria: findingsOnlyAcceptance?.acceptanceCriteria ?? [],
        acceptanceValidation: findingsOnlyAcceptance?.acceptanceValidation ?? [],
        sourceToolSurface,

        terminalStructuredRoleResultMode,
        dispatchWorktreeRoot: launchInput?.dispatchWorktreeRoot ?? null,
        provisionedWorktreeGitBinding: launchInput?.provisionedWorktreeGitBinding ?? null,
        provisioned_worktree_git_binding: launchInput?.provisioned_worktree_git_binding ?? null
      }),
      buildPlan,
      buildBwrapPlan,
      ensureWriteRoots,

      assertBwrap: () => undefined
    });
    if (!artifacts.ok) {
      return mapCodexArtifactsFailureToBrokerRefusal(artifacts);
    }
    return {
      ok: true,
      plan: artifacts.plan,
      bwrapPlan: artifacts.bwrapPlan,
      parseFinalResult: captureCodexFinalResultFromPlan(captureFinalResult)
    };
  };
}
