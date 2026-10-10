import {
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_REFUSAL_CODES
} from "@agent-chassis/agent-launch-core";

import {
  CALLER_MANAGED_LIFECYCLE_CARRIERS,
  CALLER_SCOPE_CARRIERS,
  CONFIG_ATTEMPT_STATE_CARRIERS,
  EXACT_IMPLEMENTATION_SLICE_RE,
  WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER
} from "./backend-constants.mjs";
import {
  firstOwnField,
  readCanonicalWorkRecord,
  scopeAuthorityRefusal
} from "./backend-scope-authority.mjs";
import { dispatchRefusal } from "./workspace-agent-dispatch-refusal.mjs";
import { readWorkerScopePathRefusal, scopeInvalid } from "./backend-worker-scope-authority.mjs";
import { scopeResolutionFailureDetail } from "./workspace-agent-dispatch-backend-scope.mjs";

import { deriveCanonicalUnitScope } from "./canonical-unit-scope.mjs";

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

function unsupportedScopeSelectorRefusal(selected, recordPath, { role, subject }) {
  for (const field of ["read_scope", "repo_paths", "write_scope"]) {
    try {
      deriveCanonicalUnitScope(selected?.[field], field, recordPath, {
        required: false,
        invalid: (message, facts = null) => {
          if (facts?.kind === "unsupported_selector") scopeInvalid(message, facts);
          throw new Error(message);
        }
      });
    } catch (error) {
      if (readWorkerScopePathRefusal(error) === null) continue;
      const { refusal } = scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason: "canonical_scope_resolution_failed",
        ...scopeResolutionFailureDetail(error, { role, subject })
      });
      return dispatchRefusal(refusal.code, refusal.reason, refusal.detail);
    }
  }
  return null;
}

export function createBackendWorkerRouting(ctx) {
  const { lifecycle, worktreeProvisioningConfig } = ctx;

  function resolveWorkerTargetRefusal(input = {}) {
    if (input.role !== "worker" || ctx.requireManagedProvisioning !== true ||
        EXACT_IMPLEMENTATION_SLICE_RE.test(input.subject ?? "")) return null;
    return dispatchRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      "managed_worker_exact_slice_required", {
        subject: input.subject ?? null, role: input.role, actor_recovery: "coordinator",
        next_action: "select_or_author_exact_implementation_slice_then_start",
        recovery: { state: "choice_required", responsible_actor: "coordinator",
          required_inputs: ["exact implementation slice selection or authored slice contract"] },
        explanation: "Managed worker implementation requires an exact slice. Select an existing " +
          "implementation slice through workspace_read_wiki, or author changes.ready_slices through " +
          "save_record on the root with its current revision and caller-supplied scope, acceptance " +
          "and proof meaning. Then start_agent on the exact saved slice address. No executable " +
          "start or save call exists until those inputs are supplied; retrying the bare WK repeats " +
          "this refusal. Structural readiness does not establish launch admission."
      });
  }

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
    const targetRefusal = resolveWorkerTargetRefusal(input);
    if (targetRefusal !== null) return targetRefusal;
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

    const recordPath = `wiki/work-records/${String(input.subject).split("#", 1)[0]}.json`;
    const selectorRefusal = unsupportedScopeSelectorRefusal(selected, recordPath, input);
    if (selectorRefusal !== null) return selectorRefusal;
    let effectiveWriteScope = null;
    try {
      effectiveWriteScope = deriveCanonicalUnitScope(
        selected?.write_scope, "write_scope", recordPath,
        { invalid: (message) => { throw new Error(message); } }
      );
    } catch {
      effectiveWriteScope = null;
    }
    if (effectiveWriteScope === null || effectiveWriteScope.length === 0) {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "launcher_effective_write_scope_invalid",
        { subject: input.subject ?? null }
      );
    }
    return lifecycle.startLaunch({
      ...input,
      canonical_unit_write_scope: effectiveWriteScope
    });
  }

  return Object.freeze({ resolveBackendRoutingDecision, resolveWorkerTargetRefusal, startLaunch });
}
