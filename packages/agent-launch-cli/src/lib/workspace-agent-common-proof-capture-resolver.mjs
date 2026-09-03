import {
  COMMON_PROOF_RECEIPT_REFUSAL_CODES,
  createCommonProofReceiptStore
} from "./workspace-agent-common-proof-receipt-store.mjs";

export const COMMON_PROOF_CAPTURE_LAUNCHER_RESOLVER_UNAVAILABLE =
  "common_proof_capture_launcher_resolver_unavailable";

function resolverError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createWorkspaceAgentCommonProofCaptureResolver({
  workspaceDir,
  repositoryAlias
}) {
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0 ||
      typeof repositoryAlias !== "string" || repositoryAlias.length === 0) {
    throw resolverError(
      COMMON_PROOF_RECEIPT_REFUSAL_CODES.AUTHORITY_REJECTED,
      "launcher common-proof resolver requires one launcher-resolved workspace binding"
    );
  }
  const store = createCommonProofReceiptStore({ workspaceDir, repositoryAlias });
  return Object.freeze(async function resolveLauncherCommonProofReceipt(identity) {
    const result = await store.selectIdentity(identity);
    if (result.ok === true) return result.projection;
    throw resolverError(result.code, result.message);
  });
}
