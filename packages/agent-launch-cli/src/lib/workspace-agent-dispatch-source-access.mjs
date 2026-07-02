

import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";

import {
  AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES,
  assertLauncherOwnedSourceToolSurface,
  assertCodexCallableSourceToolSurface,
  isScopedChildToolSurfaceRefusal,
  isSourceToolSurfaceNotConfigured
} from "./agent-child-tool-surface.mjs";
import {
  getFamilyNeutralAdapterRegistrySourceReadModeFacts,
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
  LAUNCHER_SOURCE_READ_MODE_LAUNCHER_TOOL_SURFACE
} from "./workspace-agent-launch-adapter-contract.mjs";

import {
  proveAssignedSourceReadable as defaultProveAssignedSourceReadable
} from "./agent-backend-source-surface.mjs";

export async function resolveWorkerSourceToolSurface({
  app,
  role,
  subject,
  workspace_alias = null,
  workspace_dir = null,
  readiness = null,
  dispatchModel = null,
  familyExecutorRegistryEntry,
  prepareSourceToolSurface = null,

  proveAssignedSourceReadable = null
}) {

  let sourceToolSurface = null;
  if (role === "worker") {

    const sourceReadModeFacts =
      getFamilyNeutralAdapterRegistrySourceReadModeFacts(familyExecutorRegistryEntry);
    if (!sourceReadModeFacts.sourceReadModeDeclared) {
      return {
        ok: false,
        refusal: {
          code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
          reason: "single_launcher_source_read_mode_undeclared",
          detail: {
            app,
            role,
            subject,
            cause: "undeclared_source_read_mode",
            path_class: null
          }
        }
      };
    }
    const sourceReadMode = sourceReadModeFacts.sourceReadMode;
    const requiresLauncherSourceSurface =
      sourceReadMode !== LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM;
    if (
      sourceReadMode === LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM &&
      !sourceReadModeFacts.nativeReadCapabilityDeclared
    ) {
      return {
        ok: false,
        refusal: {
          code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
          reason: "single_launcher_native_read_capability_undeclared",
          detail: {
            app,
            role,
            subject,
            source_read_mode: sourceReadMode,
            cause: "undeclared_native_read_capability",
            path_class: null
          }
        }
      };
    }
    if (typeof prepareSourceToolSurface === "function") {
      let surfaceResult;
      try {
        surfaceResult = await prepareSourceToolSurface({
          app,
          role,
          subject,
          workspace_alias: workspace_alias ?? null,
          workspace_dir: workspace_dir ?? null,
          readiness: readiness ?? null,
          model: dispatchModel
        });
      } catch (error) {
        return {
          ok: false,
          refusal: {
            code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
            reason: "single_launcher_source_tool_surface_threw",
            detail: { message: error?.message ?? String(error) }
          }
        };
      }

      if (isSourceToolSurfaceNotConfigured(surfaceResult)) {
        sourceToolSurface = surfaceResult;
      } else if (isScopedChildToolSurfaceRefusal(surfaceResult)) {

        return {
          ok: false,
          refusal: {
            code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
            reason: "single_launcher_source_tool_surface_refused",
            detail: {
              app,
              role,
              subject,
              reason_code: surfaceResult.refusal_code ?? AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
              refusal: surfaceResult
            }
          }
        };
      } else {
        const acceptedSurface = assertLauncherOwnedSourceToolSurface(surfaceResult);
        if (isScopedChildToolSurfaceRefusal(acceptedSurface)) {
          return {
            ok: false,
            refusal: {
              code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
              reason: "single_launcher_source_tool_surface_refused",
              detail: {
                app,
                role,
                subject,
                reason_code: acceptedSurface.refusal_code ?? AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.SOURCE_SURFACE_NOT_PROVEN,
                refusal: acceptedSurface
              }
            }
          };
        }
        if (requiresLauncherSourceSurface) {

          const callableSurface = assertCodexCallableSourceToolSurface(acceptedSurface);
          if (isScopedChildToolSurfaceRefusal(callableSurface)) {
            return {
              ok: false,
              refusal: {
                code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
                reason: "single_launcher_source_tool_surface_not_callable",
                detail: {
                  app,
                  role,
                  subject,
                  reason_code: callableSurface.refusal_code ?? AGENT_CHILD_TOOL_SURFACE_REFUSAL_CODES.CODEX_CALLABLE_SURFACE_UNAVAILABLE,
                  refusal: callableSurface
                }
              }
            };
          }
          sourceToolSurface = callableSurface;
        } else {

          sourceToolSurface = acceptedSurface;
        }
      }
    } else if (requiresLauncherSourceSurface) {

      return {
        ok: false,
        refusal: {
          code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
          reason: "single_launcher_source_tool_surface_unavailable",
          detail: {
            app,
            role,
            subject,
            required_backend_kind: "filesystem_mcp",
            required_surface: "launcher_owned_scoped_source_read_write",
            reason_code: "agent_backend.filesystem_mcp.unavailable.v1"
          }
        }
      };
    }

    const prove =
      typeof proveAssignedSourceReadable === "function"
        ? proveAssignedSourceReadable
        : defaultProveAssignedSourceReadable;
    let readability;
    try {
      readability = await prove({
        app,
        subject,
        workspace_dir,
        sourceReadMode,
        nativeReadCapability: sourceReadModeFacts.nativeReadCapability,
        sourceToolSurface
      });
    } catch (error) {
      return {
        ok: false,
        refusal: {
          code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          reason: "single_launcher_assigned_source_readability_threw",
          detail: { app, role, subject, message: error?.message ?? String(error) }
        }
      };
    }
    if (!readability || readability.ok !== true) {
      return {
        ok: false,
        refusal: {
          code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
          reason: "single_launcher_assigned_source_not_readable",
          detail: {
            app,
            role,
            subject,
            source_read_mode: sourceReadMode,
            cause: readability?.cause ?? "assigned_source_not_readable",
            path_class: readability?.path_class ?? null,
            ...(readability?.detail ? { proof: readability.detail } : {})
          }
        }
      };
    }
  }
  return { ok: true, sourceToolSurface };
}
