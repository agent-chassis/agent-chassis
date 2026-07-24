import { normalizeDispatchModelHint } from "./workspace-agent-dispatch-backend.mjs";
import { findRepoRoot } from "../commands/codex-role.mjs";
import { resolveFamilyRoleModelGate } from "./workspace-agent-family-policy.mjs";

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
