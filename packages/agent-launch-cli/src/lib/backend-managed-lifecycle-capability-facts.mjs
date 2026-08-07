

import { hasManagedConfinementActivation } from "./backend-review-identity.mjs";
import { managedLifecycleCapabilityFact } from "./backend-worktree-binding.mjs";
import {
  STDIO_MCP_CONDUIT_COMPOSITION_FACT_SOURCE
} from "./stdio-mcp-conduit-composition-compatibility.mjs";

export function createManagedLifecycleCapabilityAuthorityFacts({
  resolveManagedStdioMcpComposition,
  executors,
  worktreeProvisioningConfig,
  requireManagedProvisioning,
  closedInputCommitCompositionInstalled,
  postWorkerSliceLifecycle
}) {
  return async () => Object.freeze({
    structured_dispatch: (() => {
      const projection = resolveManagedStdioMcpComposition();
      return Object.freeze({
        available: projection.available === true,
        source: STDIO_MCP_CONDUIT_COMPOSITION_FACT_SOURCE,
        freshness: Object.freeze({ state: "fresh", basis: "current_backend_generation" }),
        composition_compatibility: projection.fact,
        gate_outcome: projection.gate_outcome,
        blocker: projection.blocker
      });
    })(),
    native_edit: managedLifecycleCapabilityFact(
      Object.keys(executors).length > 0,
      "agent_launch.dispatch_backend.executor_registry"
    ),
    repository_read_boundary: managedLifecycleCapabilityFact(
      hasManagedConfinementActivation(worktreeProvisioningConfig),
      "agent_launch.dispatch_backend.repository_read_boundary"
    ),
    commit: managedLifecycleCapabilityFact(
      closedInputCommitCompositionInstalled,
      "agent_launch.dispatch_backend.closed_input_commit_composition"
    ),
    managed_worktree_provisioning: managedLifecycleCapabilityFact(
      worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.worktree_provisioning"
    ),
    slice_to_wk_integration: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.terminal_slice_integration"
    ),
    wk_context_review: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.frozen_wk_review_context"
    ),

    slice_context_review: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.frozen_slice_review_context"
    ),
    automatic_main_promotion: managedLifecycleCapabilityFact(
      false,
      "agent_launch.dispatch_backend.main_promotion_unwired"
    )
  });
}
