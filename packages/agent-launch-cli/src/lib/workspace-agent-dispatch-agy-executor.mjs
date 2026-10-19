import { BACKEND_REFUSAL_CODES, validateLauncherFamilyRole } from "@agent-chassis/agent-launch-core";
import { buildFamilyModelRefusal } from "./workspace-agent-family-policy.mjs";
import { consumeAdvisoryReviewInput } from "./workspace-agent-advisory-review-contract.mjs";
import { assertManagedWorkerAssignment, workerAssignmentRefusal } from "./worker-assignment-authority.mjs";
import { resolveTerminalStructuredRoleResultMode } from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import { createAttemptPrecreatedResourceOwner } from "./pre-spawn-cleanup-binding.mjs";
import { agyResultModePreflight, prepareAgyLaunch } from "./workspace-agent-agy-launch-preflight.mjs";
import { resolveManagedAssignmentDelivery } from "./managed-assignment-read-artifact.mjs";
import { renderFamilyNeutralAdvisoryReviewInput } from "./workspace-agent-advisory-review-contract.mjs";
import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";
import { assertCodexWorkerCommitCredentialBinding } from "./codex-role-mcp-env.mjs";
import { mintTrustedStdioMcpConduitAuthority, resolveLauncherAgentSessionContract,
  resolveLauncherAgentSessionContractFacts } from "./stdio-mcp-conduit-authority.mjs";
import { authenticateStdioMcpCompletionCredential, createStdioMcpConduit } from "./stdio-mcp-conduit.mjs";
import { cleanupConduitForRefusal, withSecondaryCleanupFailure } from "./launch-failure-cause.mjs";
import { buildAgyRuntime } from "./workspace-agent-agy-launch-runtime.mjs";
import { launchAgy } from "./workspace-agent-agy-launch-outcome.mjs";
import { attachLauncherObservedTerminalResultModeFacts } from "./workspace-agent-dispatch-result-mode.mjs";
import { selectWorkerLifecycleFromEffectiveWriteScope } from "./workspace-agent-worker-lifecycle.mjs";
import { composeWorkerTestRuntime } from "./test-execution/worker-runtime.mjs";
import { LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
  LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO } from "./workspace-agent-launch-adapter-contract.mjs";

export const AGY_FAMILY_SOURCE_READ_MODE = LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM;
export const AGY_FAMILY_NATIVE_READ_CAPABILITY = LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO;

export function createAgyWorkspaceAgentLaunchExecutor(options = {}) {
  const { env = process.env, createMcpConduit = createStdioMcpConduit } = options;
  return async function agyLaunchExecutor(input) {
    const { role, subject } = input ?? {};
    const refuse = (code, reason, detail) => buildFamilyModelRefusal({ code, reason, detail });
    const roleCheck = validateLauncherFamilyRole(role);
    if (!roleCheck.ok || typeof subject !== "string" || subject.length === 0) {
      return refuse(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, "agy_launch_input_invalid", { role, subject });
    }
    let assignment = null;
    let advisory = null;
    try {
      if (input.advisory_review_input !== undefined) {
        advisory = consumeAdvisoryReviewInput(input.advisory_review_input, { role, subject });
      } else {
        assignment = assertManagedWorkerAssignment(input.worker_assignment, { role, subject,
          runId: input.run_id, monitorHandle: input.monitor_handle,
          worktreePath: input.worktree_provisioning?.worktree_path });
      }
    } catch (error) {
      if (input.advisory_review_input === undefined) return workerAssignmentRefusal(refuse, error, { role, subject });
      return refuse(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, error.code ?? "advisory_review_input_invalid",
        { message: error.message, role, subject });
    }

    const resultMode = assignment !== null ? assignment.terminal_result_mode : resolveTerminalStructuredRoleResultMode({
      role, schemaConstrained: advisory?.formal_result_contract?.mode === "schema_constrained" });
    const resources = createAttemptPrecreatedResourceOwner({ role, subject, runId: input.run_id });
    let schemaRefusal;
    try { schemaRefusal = agyResultModePreflight(resultMode); }
    catch (error) { return resources.settle(refuse(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "agy_result_mode_invalid", { selected_contract: resultMode, message: error.message })); }
    if (schemaRefusal !== null) return resources.settle(refuse(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, schemaRefusal.reason, schemaRefusal.detail));
    let conduit = null;
    try {
      const provisioning = input.worktree_provisioning ?? null;
      if (input.workspace_dir !== (advisory?.private_checkout_root ?? provisioning?.worktree_path)) {
        throw Object.assign(new Error("Launch checkout does not match the authenticated assignment"),
          { code: "agy_checkout_invalid" });
      }
      if (assignment !== null && selectWorkerLifecycleFromEffectiveWriteScope(input.canonical_unit_write_scope) !== "implementation") {
        throw Object.assign(new Error("An implementation assignment requires effective write scope"),
          { code: "worker_implementation_lifecycle_required" });
      }
      const gitBinding = input.provisionedWorktreeGitBinding ?? input.provisioned_worktree_git_binding ?? null;
      const scope = assertFrozenWorkerScopeAuthority(input.worker_scope_authority ?? null, {
        role, subject, worktreeProvisioning: provisioning, provisionedWorktreeGitBinding: gitBinding,
        required: assignment !== null });
      const commitTuple = assignment === null ? null : assertCodexWorkerCommitCredentialBinding({
        assignedUnit: subject, managedWorker: true, worktreeProvisioning: provisioning,
        sliceBinding: provisioning?.slice_binding });
      const delivery = resolveManagedAssignmentDelivery({ advisoryReviewInput: advisory, workerAssignment: assignment,
        renderAdvisoryReviewStartup: renderFamilyNeutralAdvisoryReviewInput });
      const workspaceDir = advisory?.repository ?? provisioning?.main_repo;
      const authority = mintTrustedStdioMcpConduitAuthority({ family: "agy", role, assignedUnit: subject,
        workspaceDir, workerScopeAuthority: scope, provisioning, commitTuple,
        workerAssignment: delivery.conduitWorkerAssignment, advisoryReviewInput: advisory });
      const sessionContract = authenticateStdioMcpCompletionCredential({
        credential: input.completion_credential ?? resolveLauncherAgentSessionContract(authority),
        expectedFacts: resolveLauncherAgentSessionContractFacts(authority) });

      const prepared = await prepareAgyLaunch({ input, configurationWorkspaceDir: workspaceDir,
        resultMode, prompt: delivery.prompt, env, options });
      conduit = await createMcpConduit({ family: "agy", role, assignedUnit: subject,
        workspaceDir, commitTuple, authority, sessionContract });
      const runtime = await buildAgyRuntime({ prepared, conduit, env });
      const workerTestRuntime = scope === null ? null : await composeWorkerTestRuntime({
        mainRepo: provisioning.main_repo, checkout: input.workspace_dir, workerScopeAuthority: scope });
      const launched = await launchAgy({ input, prepared, runtime, conduit, scope, gitBinding,
        advisory, workerTestRuntime, resources, options });
      return launched.accepted === true ? attachLauncherObservedTerminalResultModeFacts(launched,
        { selectedContract: resultMode }) : launched;
    } catch (error) {
      const failure = refuse(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        error.code ?? "agy_launch_preparation_failed", { message: error.message, detail: error.detail ?? null });
      const cleanup = conduit === null ? null : await cleanupConduitForRefusal(conduit);
      return resources.settle(cleanup === null ? failure : withSecondaryCleanupFailure(failure,
        "conduit_cleanup_failures", cleanup.detail ?? { message: cleanup.message }));
    }
  };
}
