

import {
  WK_FORGE_HANDOFF_FAILURE_CATEGORIES,
  WK_FORGE_HANDOFF_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_CCE_POLICY_REQUEST_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION,
  WK_FORGE_HANDOFF_POLICY_POSTURES
} from "./trusted-operation-contracts.mjs";
import {
  authenticateCurrentControlledContractGenerationStateAtW,
  CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES,
  ControlledContractGenerationPersistenceError
} from "./controlled-carrier-attachment-primitive.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import { HANDOFF_TRANSPORTS } from "./wk-handoff-destination.mjs";
import {
  canonicalJson,
  hasExactKeys,
  isPlainObject,
  projectHandoffDestination,
  refuse
} from "./wk-forge-handoff-refusal.mjs";

function buildForgeHandoffPolicyTarget({ binding, initiative, destination, repository, landing, branch }) {
  return Object.freeze({
    operation: "wk_forge_handoff",
    assigned_unit: binding.canonical_wk_id,
    initiative,
    candidate_sha: binding.candidate,
    candidate_tree: binding.candidate_tree,
    candidate_ref: binding.candidate_ref,
    base_ref: binding.base_ref,
    base_sha: binding.base,
    wk_ref: binding.wk_ref,
    wk_sha: binding.wk_tip,
    canonical_wk_digest: binding.canonical_wk_digest,
    destination: projectHandoffDestination(destination),
    repository: repository === null ? null : Object.freeze({
      host: repository.host,
      owner: repository.owner,
      name: repository.name
    }),
    base_branch: landing,
    handoff_branch: destination.transport === HANDOFF_TRANSPORTS.LOCAL ? null : branch
  });
}

export async function resolveWkForgeHandoffBoundaryAuthorization({
  policy = null,
  binding,
  initiative,
  destination,
  repository,
  landing,
  branch
} = {}) {
  const target = buildForgeHandoffPolicyTarget({
    binding, initiative, destination, repository, landing, branch
  });
  if (policy === null || (isPlainObject(policy) && policy.configured === false)) {
    return {
      ok: true,
      authorization: Object.freeze({
        schema_version: WK_FORGE_HANDOFF_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
        policy_posture: WK_FORGE_HANDOFF_POLICY_POSTURES.FREE_SUBSTRATE,
        authority: "none",
        configured_gate: false,
        decision: "not_gated",
        ratified: false,
        attestation_valid: false,
        audit_grade: false,
        target
      })
    };
  }
  if (!isPlainObject(policy) || policy.configured !== true) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_configuration_malformed"
    });
  }
  if (typeof policy.authorize !== "function") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_missing"
    });
  }
  const request = Object.freeze({
    schema_version: WK_FORGE_HANDOFF_CCE_POLICY_REQUEST_SCHEMA_VERSION,
    target
  });
  let decision;
  try {
    decision = await policy.authorize(request);
  } catch (error) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_unavailable", failed_operation: "authorize_publication",
      subject: binding.canonical_wk_id, effects: { publication: "not_attempted" },
      evidence: captureDiagnosticEvidence(error)
    });
  }
  if (decision === null || decision === undefined) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_missing"
    });
  }
  if (!hasExactKeys(decision, [
    "schema_version", "decision_id", "decision", "ratified", "attestation_valid", "target"
  ]) || decision.schema_version !== WK_FORGE_HANDOFF_CCE_POLICY_DECISION_SCHEMA_VERSION ||
      typeof decision.decision_id !== "string" || decision.decision_id.length === 0 ||
      decision.decision_id.length > 256 || !new Set(["allow", "deny"]).has(decision.decision) ||
      typeof decision.ratified !== "boolean" || typeof decision.attestation_valid !== "boolean") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_malformed"
    });
  }
  if (canonicalJson(decision.target) !== canonicalJson(target)) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_target_mismatch"
    });
  }
  if (decision.ratified !== true) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_unratified"
    });
  }
  if (decision.attestation_valid !== true) {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_attestation_invalid"
    });
  }
  if (decision.decision !== "allow") {
    return refuse(WK_FORGE_HANDOFF_FAILURE_CATEGORIES.CCE_POLICY, {
      reason: "cce_policy_decision_denied",
      decision_id: decision.decision_id
    });
  }
  return {
    ok: true,
    authorization: Object.freeze({
      schema_version: WK_FORGE_HANDOFF_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
      policy_posture: WK_FORGE_HANDOFF_POLICY_POSTURES.CCE_POLICY,
      authority: "cce",
      configured_gate: true,
      decision: "allow",
      decision_id: decision.decision_id,
      ratified: true,
      attestation_valid: true,
      audit_grade: true,
      target
    })
  };
}

export async function authenticateForgeGenerationAuthority({ mainRepo, wk, candidateState }) {
  const candidateBinding = candidateState?.binding;
  let authority;
  try {
    authority = await authenticateCurrentControlledContractGenerationStateAtW({
      repoRoot: mainRepo,
      wkId: wk,
      expectedWkTipSha: candidateBinding?.wk_tip,
      expectedGeneration: candidateBinding?.controlled_generation,
      deps: {}
    });
  } catch (error) {

    if (error instanceof ControlledContractGenerationPersistenceError &&
        error.code === CONTROLLED_CONTRACT_GENERATION_PERSISTENCE_CODES.W_AUTHENTICATION_FAILED &&
        typeof error.details?.expected_tip === "string" &&
        typeof error.details?.actual_tip === "string") {
      return Object.freeze({ ok: false, detail: Object.freeze({
        stage: "generation_authentication",
        reason: "terminal_candidate_binding_moved",
        subject: { assigned_unit: wk, candidate: candidateBinding?.candidate ?? null },
        observed: { code: error.code, expected_tip: error.details.expected_tip,
          actual_tip: error.details.actual_tip },
        evidence: captureDiagnosticEvidence(error)
      }) });
    }
    throw error;
  }
  return Object.freeze({ ok: true, generationBinding: authority.binding,
    authenticated: authority.authenticated });
}
