

import {
  assertCodexCallableSourceToolSurface,
  assertLauncherOwnedSourceToolSurface,
  isScopedChildToolSurfaceRefusal,
  isSourceToolSurfaceNotConfigured
} from "./agent-child-tool-surface.mjs";
import {
  createWorkspaceAgentRunEnforcement
} from "./workspace-agent-run-enforcement.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS = Object.freeze({

  NO_SOURCE_SURFACE: "no_source_surface",

  REQUIRES_LAUNCHER_REDERIVATION: "requires_launcher_rederivation",

  FALL_THROUGH_NOT_CONFIGURED: "fall_through_not_configured",

  CALLABLE_SURFACE: "callable_surface",

  REFUSAL: "refusal"
});

export const CODEX_LAUNCH_POLICY_SOURCE_SURFACE_REASONS = Object.freeze({

  THREW: "single_launcher_source_tool_surface_threw",

  REFUSED: "single_launcher_source_tool_surface_refused",

  MARKER_UNVERIFIED: "single_launcher_source_tool_surface_marker_unverified_for_codex_worker",

  REQUIRED: "single_launcher_source_tool_surface_required_for_codex_worker",

  NOT_CALLABLE: "single_launcher_source_tool_surface_not_callable_for_codex_worker"
});

export const CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS = Object.freeze({
  BACKEND_UNAVAILABLE: "backend_unavailable",
  LAUNCH_FAILED_BEFORE_START: "launch_failed_before_start"
});

export const CODEX_LAUNCH_POLICY_ENACTMENT = Object.freeze({

  DELEGATE_HOST_WRITE_AUTHORITY: "delegate_host_write_authority",

  IN_PROCESS_BWRAP: "in_process_bwrap"
});

const REQUIRED_BACKEND_KIND = "filesystem_mcp";

function buildSourceSurfaceRefusal(reason, failClosedClass, extraDetail = {}) {
  return Object.freeze({
    disposition: CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.REFUSAL,
    reason,
    fail_closed_class: failClosedClass,
    forwardedSourceToolSurface: null,

    detail: Object.freeze({
      required_backend_kind: REQUIRED_BACKEND_KIND,
      ...extraDetail
    })
  });
}

export function classifyCodexSuppliedSourceToolSurface({
  role,
  suppliedSourceToolSurface = null,
  isNotConfigured = isSourceToolSurfaceNotConfigured,
  assertLauncherOwned = assertLauncherOwnedSourceToolSurface,
  assertCallable = assertCodexCallableSourceToolSurface,
  isRefusal = isScopedChildToolSurfaceRefusal
} = {}) {
  if (role !== "worker") {
    return Object.freeze({
      disposition: CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.NO_SOURCE_SURFACE,
      forwardedSourceToolSurface: null
    });
  }

  if (isNotConfigured(suppliedSourceToolSurface)) {

    return Object.freeze({
      disposition:
        CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.REQUIRES_LAUNCHER_REDERIVATION,
      forwardedSourceToolSurface: null
    });
  }

  const accepted = assertLauncherOwned(suppliedSourceToolSurface);
  if (isRefusal(accepted)) {
    return buildSourceSurfaceRefusal(
      CODEX_LAUNCH_POLICY_SOURCE_SURFACE_REASONS.REQUIRED,
      CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS.BACKEND_UNAVAILABLE,
      {
        required_surface: "launcher_owned_scoped_source_read_write",
        refusal: accepted
      }
    );
  }

  const callable = assertCallable(accepted);
  if (isRefusal(callable)) {
    return buildSourceSurfaceRefusal(
      CODEX_LAUNCH_POLICY_SOURCE_SURFACE_REASONS.NOT_CALLABLE,
      CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS.BACKEND_UNAVAILABLE,
      {
        required_surface: "launcher_owned_scoped_source_read_write",
        refusal: callable
      }
    );
  }

  return Object.freeze({
    disposition: CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.CALLABLE_SURFACE,
    forwardedSourceToolSurface: callable
  });
}

export function classifyCodexRederivedSourceToolSurface({
  rederivedSurface = null,
  isNotConfigured = isSourceToolSurfaceNotConfigured,
  isRefusal = isScopedChildToolSurfaceRefusal
} = {}) {
  if (isNotConfigured(rederivedSurface)) {
    return Object.freeze({
      disposition:
        CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.FALL_THROUGH_NOT_CONFIGURED,

      forwardedSourceToolSurface: rederivedSurface
    });
  }

  if (isRefusal(rederivedSurface)) {
    return buildSourceSurfaceRefusal(
      CODEX_LAUNCH_POLICY_SOURCE_SURFACE_REASONS.REFUSED,
      CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS.BACKEND_UNAVAILABLE,
      {
        required_surface: "launcher_owned_scoped_source_read_write",
        reason_code:
          typeof rederivedSurface?.refusal_code === "string"
            ? rederivedSurface.refusal_code
            : null,
        refusal: rederivedSurface
      }
    );
  }

  return buildSourceSurfaceRefusal(
    CODEX_LAUNCH_POLICY_SOURCE_SURFACE_REASONS.MARKER_UNVERIFIED,
    CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS.BACKEND_UNAVAILABLE,
    {
      required_surface: "launcher_derived_not_configured_marker",
      received_marker: true
    }
  );
}

export function buildCodexSourceSurfacePreparerThrewRefusal(error) {
  return buildSourceSurfaceRefusal(
    CODEX_LAUNCH_POLICY_SOURCE_SURFACE_REASONS.THREW,
    CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS.LAUNCH_FAILED_BEFORE_START,
    { message: error?.message ?? String(error) }
  );
}

export function consumeReservedEnforcementChannel(brokerEnforcement) {
  const source = isPlainObject(brokerEnforcement) ? brokerEnforcement : null;
  return createWorkspaceAgentRunEnforcement(source ?? undefined);
}

export function classifyCodexLaunchEnactment({
  hostWriteAuthorityConfigured = false,
  brokerEnforcement = createWorkspaceAgentRunEnforcement()
} = {}) {
  const enforcement = consumeReservedEnforcementChannel(brokerEnforcement);
  return Object.freeze({
    enactment:
      hostWriteAuthorityConfigured === true
        ? CODEX_LAUNCH_POLICY_ENACTMENT.DELEGATE_HOST_WRITE_AUTHORITY
        : CODEX_LAUNCH_POLICY_ENACTMENT.IN_PROCESS_BWRAP,
    enforcement
  });
}

export default {
  CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS,
  CODEX_LAUNCH_POLICY_SOURCE_SURFACE_REASONS,
  CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS,
  CODEX_LAUNCH_POLICY_ENACTMENT,
  classifyCodexSuppliedSourceToolSurface,
  classifyCodexRederivedSourceToolSurface,
  buildCodexSourceSurfacePreparerThrewRefusal,
  consumeReservedEnforcementChannel,
  classifyCodexLaunchEnactment
};
