

import path from "node:path";

import { resolveLauncherOwnedWorkspaceDurableStateRoot } from
  "../../../agent-launch-core/src/lib/durable-runtime-state.mjs";
import { captureDiagnosticEvidence } from
  "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { readVerifyProofCachedRecord } from "./mcp-response.mjs";

export const VERIFY_PROOF_RUN_CACHE_NAMESPACE = "verify-proof-evidence";

export function verifyProofRunCacheDirectory(root) {
  return path.join(root, VERIFY_PROOF_RUN_CACHE_NAMESPACE);
}

function directoryResolutionFailure(resolved) {
  const error = new Error("launcher durable proof-evidence directory could not be resolved", {
    cause: resolved
  });
  error.code = typeof resolved?.code === "string"
    ? resolved.code : "verify_proof.run_cache_directory_unavailable.v1";
  error.details = {
    authority_limb: "mechanical_failure",
    operation: "read_verify_proof_run_record",
    stage: "durable_state_directory_resolution",
    cause_code: typeof resolved?.code === "string" ? resolved.code : null,
    cause_diagnostic: captureDiagnosticEvidence(resolved)
  };
  return error;
}

export function resolveVerifyProofRunCacheDir(workspaceDir) {
  const resolved = resolveLauncherOwnedWorkspaceDurableStateRoot({ workspaceDir });
  if (resolved.ok !== true) throw directoryResolutionFailure(resolved);
  return verifyProofRunCacheDirectory(resolved.root);
}

export function readVerifyProofRunRecord({ workspaceDir, verification }) {
  const evidence = verification?.evidence;
  if (evidence?.store !== "launcher_durable_state" ||
      evidence.namespace !== VERIFY_PROOF_RUN_CACHE_NAMESPACE) {
    throw Object.assign(new Error("recorded verification names no launcher durable evidence"),
      { code: "verify_proof_cache.record_corrupt.v1" });
  }
  const stateDir = resolveVerifyProofRunCacheDir(workspaceDir);
  return { kind: evidence.kind, record: readVerifyProofCachedRecord(evidence, { stateDir }) };
}
