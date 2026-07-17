import {
  BACKEND_REFUSAL_CODES,
  normalizeDispatchModelHint
} from "./workspace-agent-dispatch-backend.mjs";
import { findRepoRoot } from "../commands/codex-role.mjs";
import { resolveFamilyRoleModelGate } from "./workspace-agent-family-policy.mjs";
import {
  CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS,
  CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS,
  buildCodexSourceSurfacePreparerThrewRefusal,
  classifyCodexRederivedSourceToolSurface,
  classifyCodexSuppliedSourceToolSurface
} from "./workspace-agent-codex-launch-policy.mjs";

export const SOURCE_SURFACE_FAIL_CLOSED_CODE = Object.freeze({
  [CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS.BACKEND_UNAVAILABLE]: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
  [CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS.LAUNCH_FAILED_BEFORE_START]: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START
});

export async function resolveCodexWorkerSourceSurfacePolicy({
  role,
  suppliedSourceToolSurface,
  preparer,
  preparerInput
}) {
  const supplied = classifyCodexSuppliedSourceToolSurface({ role, suppliedSourceToolSurface });
  if (
    supplied.disposition
    !== CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.REQUIRES_LAUNCHER_REDERIVATION
  ) {

    return supplied;
  }

  let rederivedSurface;
  try {
    rederivedSurface = await preparer(preparerInput);
  } catch (err) {
    return buildCodexSourceSurfacePreparerThrewRefusal(err);
  }
  return classifyCodexRederivedSourceToolSurface({ rederivedSurface });
}

async function resolveWorkspaceEnvDir(cwd) {
  try {
    return await findRepoRoot(cwd);
  } catch {
    return null;
  }
}

export async function evaluateDispatchRoleModelGate({ role, isWorker, resolvedProfile, modelHint, cwd }) {
  const resolvedProfileModel = typeof resolvedProfile?.model === "string" && resolvedProfile.model.length > 0
    ? resolvedProfile.model
    : null;
  if (resolvedProfileModel !== null) {
    const hint = normalizeDispatchModelHint(modelHint);
    if (hint !== null && hint !== resolvedProfileModel) {
      return {
        ok: false,
        reason: "model_hint_diverges_from_resolved_model",
        detail: { requested: hint, resolved: resolvedProfileModel }
      };
    }
    return {
      ok: true,
      resolvedProfile,
      model: resolvedProfileModel,
      modelHint: hint
    };
  }
  return resolveFamilyRoleModelGate({
    role,
    isWorker,
    resolvedProfile,
    modelHint,
    cwd,
    resolveWorkspaceEnvDir
  });
}
