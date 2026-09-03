export {
  VERIFY_PROOF_EXECUTION_FAILURE_CODES,
  VERIFY_PROOF_EXECUTION_SCHEMA_VERSION,
  VerifyProofExecutionError,
  executeVerifyProofReceiptPopulation
} from "../../../agent-launch-core/src/lib/workspace-agent-verify-proof-capability.mjs";
import { executeVerifyProofReceiptPopulation } from
  "../../../agent-launch-core/src/lib/workspace-agent-verify-proof-capability.mjs";

const ELIGIBLE_VERIFY_PROOF_ROLES = Object.freeze(["orchestrator", "reviewer", "worker"]);

function assertLauncherVerifyProofRoleContext(context) {
  const allowed = ["candidate_identity", "managed", "role"];
  const orchestratorCandidate = context?.role === "orchestrator" &&
    context?.managed === false && context?.candidate_identity !== null &&
    typeof context?.candidate_identity === "object" &&
    Object.isFrozen(context.candidate_identity) &&
    context.candidate_identity.schema_version ===
      "workspace-agent-orchestrator-proof-candidate-identity.v1";
  const managedCandidate = context?.managed === true &&
    ["reviewer", "worker"].includes(context?.role) &&
    typeof context?.candidate_identity === "string" &&
    context.candidate_identity.length > 0;
  if (!context || typeof context !== "object" || Array.isArray(context) ||
      Object.keys(context).some((key) => !allowed.includes(key)) ||
      !ELIGIBLE_VERIFY_PROOF_ROLES.includes(context.role) ||
      (!orchestratorCandidate && !managedCandidate)) {
    throw Object.assign(new Error(
      "verify_proof requires a launcher-bound managed candidate or authenticated orchestrator candidate"
    ), { code: "agent_launch.verify_proof.role_context_ineligible.v1" });
  }
  return Object.freeze({
    role: context.role,
    managed: context.managed,
    candidate_identity: context.candidate_identity,
    independent_execution: ["orchestrator", "reviewer"].includes(context.role)
  });
}

function proofAuthorityCandidateIdentity(authority) {
  return authority?.candidate_identity ?? authority?.terminal_candidate ??
    authority?.integrated_wk_tip ?? authority?.source_snapshot_digest ??
    authority?.run_id ?? null;
}

async function executeLauncherVerifyProofReceiptPopulation({ roleContext, ...execution } = {}) {
  const trustedRole = assertLauncherVerifyProofRoleContext(roleContext);
  const actualCandidate = proofAuthorityCandidateIdentity(execution.proofAuthority);
  if (actualCandidate !== trustedRole.candidate_identity) {
    throw Object.assign(new Error(
      "verify_proof role context is bound to a different exact candidate"
    ), { code: "agent_launch.verify_proof.candidate_binding_mismatch.v1" });
  }
  const result = await executeVerifyProofReceiptPopulation(execution);
  return Object.freeze({
    ...result,
    role: trustedRole.role,
    candidate_identity: trustedRole.candidate_identity,
    independent_execution: trustedRole.independent_execution
  });
}

export {
  ELIGIBLE_VERIFY_PROOF_ROLES,
  assertLauncherVerifyProofRoleContext,
  executeLauncherVerifyProofReceiptPopulation
};
