import {
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_REFUSAL_CODES
} from "@agent-chassis/agent-launch-core";

import {
  CALLER_MANAGED_LIFECYCLE_CARRIERS,
  CALLER_SCOPE_CARRIERS,
  CONFIG_ATTEMPT_STATE_CARRIERS,
  WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER
} from "./backend-constants.mjs";
import {
  firstOwnField,
  readCanonicalWorkRecord,
  scopeAuthorityRefusal
} from "./backend-scope-authority.mjs";
import { dispatchRefusal } from "./workspace-agent-dispatch-refusal.mjs";

function selectedCanonicalUnit(mainRepo, subject) {
  const match = typeof subject === "string"
    ? subject.match(/^(WK-\d{4})(?:#(SLICE-\d{3}))?$/u)
    : null;
  if (match === null) return null;
  const record = readCanonicalWorkRecord(mainRepo, match[1]);
  return match[2] === undefined
    ? record
    : record?.slices?.find((slice) => slice?.id === match[2]) ?? null;
}

export function createBackendWorkerRouting(ctx) {
  const { lifecycle, worktreeProvisioningConfig } = ctx;

  function resolveBackendRoutingDecision(input = {}) {
    const selection = ctx.resolveDispatchSelection(input);
    if (selection?.ok !== true) return selection;
    const executor = ctx.executors?.[selection.app] ?? null;
    const executorAvailable = typeof executor === "function";
    const executorRegistered = Object.prototype.hasOwnProperty.call(
      ctx.executorRegistryEntries ?? {}, selection.app
    );
    return Object.freeze({
      ...selection,
      executor_available: executorAvailable,
      executor_registered: executorRegistered,
      findings_route: null,
      refusal: executorAvailable ? null : Object.freeze({
        code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
        reason: BACKEND_FAMILY_UNAVAILABLE_REASONS[selection.app],
        detail: Object.freeze({
          app: selection.app,
          missing_backend: ctx.familyAwareWiring
            ? `workspace_agent_dispatch_backend.launch_executors.${selection.app}`
            : "workspace_agent_dispatch_backend.launch_executor",
          authority_limb: "mechanical_failure"
        })
      })
    });
  }

  async function startLaunch(input = {}) {
    if (input.role !== "worker") {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "advisory_review_pipeline_required",
        { subject: input.subject ?? null, role: input.role ?? null }
      );
    }
    const callerCarrier = firstOwnField(input, CALLER_SCOPE_CARRIERS);
    const lifecycleCarrier = firstOwnField(input, CALLER_MANAGED_LIFECYCLE_CARRIERS);
    const configCarrier = firstOwnField(worktreeProvisioningConfig, CALLER_SCOPE_CARRIERS);
    const configAttemptCarrier = firstOwnField(
      worktreeProvisioningConfig,
      CONFIG_ATTEMPT_STATE_CARRIERS
    );
    if (callerCarrier !== null || lifecycleCarrier !== null || configCarrier !== null ||
        configAttemptCarrier !== null) {
      return scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason: lifecycleCarrier !== null || configAttemptCarrier !== null
          ? "caller_carried_managed_lifecycle_forbidden"
          : "caller_carried_scope_forbidden",
        field: callerCarrier ?? lifecycleCarrier ?? configCarrier ?? configAttemptCarrier,
        carrier: callerCarrier !== null || lifecycleCarrier !== null
          ? "dispatch_input"
          : "provisioning_config"
      });
    }
    let selected;
    try {
      const mainRepo = worktreeProvisioningConfig?.mainRepo ?? input.workspace_dir;
      selected = selectedCanonicalUnit(mainRepo, input.subject);
    } catch (error) {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "launcher_effective_write_scope_unreadable",
        { subject: input.subject ?? null, cause_code: error?.code ?? null }
      );
    }
    if (!Array.isArray(selected?.write_scope) || selected.write_scope.length === 0 ||
        selected.write_scope.some((entry) => typeof entry !== "string" || entry.length === 0)) {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "launcher_effective_write_scope_invalid",
        { subject: input.subject ?? null }
      );
    }
    return lifecycle.startLaunch({
      ...input,
      canonical_unit_write_scope: Object.freeze([...selected.write_scope])
    });
  }

  return Object.freeze({ resolveBackendRoutingDecision, startLaunch });
}
