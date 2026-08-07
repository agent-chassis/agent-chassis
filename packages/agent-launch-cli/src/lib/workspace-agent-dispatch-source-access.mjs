import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";

import {
  getFamilyNeutralAdapterRegistrySourceReadModeFacts,
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM
} from "./workspace-agent-launch-adapter-contract.mjs";
import {
  proveAssignedSourceReadable as defaultProveAssignedSourceReadable
} from "./assigned-source-readability.mjs";

export async function resolveWorkerSourceAccess({
  app,
  role,
  subject,
  workspace_dir = null,
  familyExecutorRegistryEntry,
  proveAssignedSourceReadable = null,

  scopeExistence = null
}) {
  if (role !== "worker") return { ok: true };

  const facts = getFamilyNeutralAdapterRegistrySourceReadModeFacts(
    familyExecutorRegistryEntry
  );
  if (!facts.sourceReadModeDeclared) {
    return {
      ok: false,
      refusal: {
        code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
        reason: "single_launcher_source_read_mode_undeclared",
        detail: { app, role, subject, cause: "undeclared_source_read_mode", path_class: null }
      }
    };
  }
  if (facts.sourceReadMode !== LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM ||
      !facts.nativeReadCapabilityDeclared) {
    return {
      ok: false,
      refusal: {
        code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
        reason: "single_launcher_native_read_capability_undeclared",
        detail: {
          app,
          role,
          subject,
          source_read_mode: facts.sourceReadMode,
          cause: "undeclared_native_read_capability",
          path_class: null
        }
      }
    };
  }

  const prove = typeof proveAssignedSourceReadable === "function"
    ? proveAssignedSourceReadable
    : defaultProveAssignedSourceReadable;
  let readability;
  try {
    readability = await prove({
      app,
      subject,
      workspace_dir,
      sourceReadMode: facts.sourceReadMode,
      nativeReadCapability: facts.nativeReadCapability,
      scopeExistence
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
          source_read_mode: facts.sourceReadMode,
          cause: readability?.cause ?? "assigned_source_not_readable",
          path_class: readability?.path_class ?? null,
          ...(readability?.detail ? { proof: readability.detail } : {})
        }
      }
    };
  }
  return { ok: true };
}
