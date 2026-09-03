

import { hasManagedConfinementActivation } from "./backend-review-identity.mjs";
import { managedLifecycleCapabilityFact } from "./backend-worktree-binding.mjs";
import {
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_REFUSAL_CODES
} from "@agent-chassis/agent-launch-core";
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

export function createSelectedBackendCapabilityFacts({
  resolveDispatchSelection,
  resolveBackendRoutingDecision = null,
  executors,
  executorRegistryEntries,
  familyAwareWiring = false
}) {
  if (typeof resolveDispatchSelection !== "function") {
    throw new TypeError("resolveDispatchSelection is required");
  }

  return (input = {}) => {
    const selection = typeof resolveBackendRoutingDecision === "function"
      ? resolveBackendRoutingDecision(input)
      : resolveDispatchSelection(input);
    if (selection?.ok !== true) {
      return Object.freeze({
        available: false,
        selection: null,
        refusal: selection ?? { ok: false, reason: "launcher_selection_unresolved" }
      });
    }

    const executor = executors?.[selection.app] ?? null;
    const executorAvailable = typeof executor === "function";
    const executorRegistered = Object.prototype.hasOwnProperty.call(
      executorRegistryEntries ?? {}, selection.app
    );
    const refusal = selection.refusal ?? (executorAvailable
      ? null
      : Object.freeze({
          code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
          reason: BACKEND_FAMILY_UNAVAILABLE_REASONS[selection.app],
          detail: Object.freeze({
            app: selection.app,
            missing_backend: familyAwareWiring
              ? `workspace_agent_dispatch_backend.launch_executors.${selection.app}`
              : "workspace_agent_dispatch_backend.launch_executor",
            authority_limb: "mechanical_failure"
          })
        }));
    return Object.freeze({
      available: executorAvailable,
      executor_available: executorAvailable,
      refusal,
      selection: Object.freeze({
        target: selection.target,
        target_role: selection.target_role,
        routeKind: selection.routeKind,
        applicable: selection.applicable,
        model: selection.model,
        app: selection.app,
        backend: selection.backend,
        backend_profile: selection.backend_profile,
        default_effort: selection.default_effort
      }),
      executor_registered: executorRegistered
    });
  };
}
