

import {
  EXACT_RETURNED_POLICY_AUTHORITY_LIMB,
  MECHANICAL_FAILURE_AUTHORITY_LIMB,
  classifyMechanicalRuntimeBlocker
} from "./runtime-blocker-classifier.mjs";
import {
  NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS,
  isExactPolicyPayloadIssue
} from "@agent-chassis/wiki-core/src/lib/node-engine-api-client.mjs";
import { isRuntimeBlockerCode } from
  "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

export const CCE_EXACT_RETURNED_POLICY_BLOCKER_CODE =
  "launcher_transition.cce_policy_refused.v1";

const CCE_DECISION_EFFECTS = new Set(["admit", "needs_review", "reject"]);

function isPositiveConfirmedNoCceAuthority(admissibility) {
  return (
    admissibility?.evaluated === true &&
    admissibility.authority === "local_only_config" &&
    admissibility.status === "local_only_fail_open" &&
    admissibility.effect === "local_only_fail_open" &&
    admissibility.admissible === true &&
    admissibility.authenticated_request_sent === false &&
    admissibility.pack_backed === false &&
    admissibility.node_engine_backed === false &&
    admissibility.ratified !== true &&
    admissibility.binding_status === null
  );
}

export function foldLauncherConfirmedNoCceAuthority(readiness) {
  return {
    ...readiness,
    structural_readiness: {
      dispatchable: readiness?.dispatchable === true,
      decision_code: readiness?.decision_code ?? null
    },
    admissibility: {
      evaluated: true,
      authority: "local_only_config",
      status: "local_only_fail_open",
      admissible: true,
      effect: "local_only_fail_open",
      pack_backed: false,
      node_engine_backed: false,
      binding_status: null,
      ratified: false,
      diagnostic_code: "launcher_confirmed_no_cce_authority",
      reasons: [],
      authenticated_request_sent: false
    }
  };
}

function authenticatedCceDecisionEffect(admissibility) {
  if (
    admissibility?.evaluated !== true ||
    admissibility.authority !== "node_engine" ||
    admissibility.pack_backed !== true ||
    admissibility.node_engine_backed !== true ||
    admissibility.ratified !== true ||
    admissibility.binding_status !== NODE_ENGINE_WORKER_ADMISSION_RATIFIED_BINDING_STATUS ||
    admissibility.exact_policy_payload_authenticated !== true ||
    admissibility.authority_binding_evidence?.worker_admission_authority_binding_present !== true ||
    admissibility.digest_evidence?.request_contract_digest_present !== true
  ) {
    return null;
  }
  const effect = admissibility.effect;
  if (!CCE_DECISION_EFFECTS.has(effect) || admissibility.status !== effect) return null;
  return effect;
}

const NODE_ENGINE_DIAGNOSTIC_FACTS = Object.freeze({
  node_engine_config_unavailable: ["operator_recovery", "launcher_declaration_missing"],
  node_engine_route_unratified: ["operator_recovery", "authority_binding_unratified"],
  node_engine_request_contract_unbound: ["operator_recovery", "authority_binding_unratified"],
  node_engine_admit_unratified: ["operator_recovery", "authority_binding_unratified"],
  node_engine_pack_input_missing: ["operator_recovery", "runtime_materialization_failed"],
  node_engine_pack_input_assembly_failed: ["operator_recovery", "runtime_materialization_failed"],
  node_engine_auth_rejected: ["operator_recovery", "decision_envelope_unauthenticated"],
  node_engine_entitlement_rejected: ["operator_recovery", "decision_envelope_unauthenticated"],
  node_engine_request_invalid: ["validation", "route_input_invalid"],
  node_engine_pack_input_required: ["validation", "route_input_invalid"],
  node_engine_pack_input_invalid: ["validation", "route_input_invalid"],
  node_engine_request_schema_digest_mismatch: ["validation", "route_input_invalid"],
  node_engine_non_object_data: ["validation", "route_input_invalid"],
  node_engine_precondition_graph_too_large: ["validation", "route_input_invalid"],
  node_engine_unrecognized_response: ["operator_recovery", "decision_envelope_malformed"],
  node_engine_decision_envelope_malformed: ["operator_recovery", "decision_envelope_malformed"],
  node_engine_unrecognized_effect: ["operator_recovery", "decision_envelope_unknown"],
  node_engine_admissibility_undetermined: ["operator_recovery", "decision_envelope_unknown"],
  node_engine_admit_not_backed: ["operator_recovery", "decision_envelope_contradictory"],
  node_engine_unavailable: ["backend", "service_unavailable"]
});

const UNAUTHENTICATED_DECISION_FACTS = Object.freeze([
  "operator_recovery",
  "decision_envelope_unauthenticated"
]);
const UNKNOWN_DECISION_FACTS = Object.freeze([
  "operator_recovery",
  "decision_envelope_unknown"
]);

function nodeEngineMechanicalFacts(admissibility) {
  const mapped = NODE_ENGINE_DIAGNOSTIC_FACTS[admissibility?.diagnostic_code];
  if (mapped) return mapped;
  if (CCE_DECISION_EFFECTS.has(admissibility?.effect)) {
    return UNAUTHENTICATED_DECISION_FACTS;
  }
  return UNKNOWN_DECISION_FACTS;
}

function nodeEngineMechanicalDetail(admissibility) {
  return {
    admissibility_status: admissibility?.status ?? null,
    diagnostic_code: admissibility?.diagnostic_code ?? null,
    authority: admissibility?.authority ?? null,
    pack_backed: admissibility?.pack_backed === true,
    node_engine_backed: admissibility?.node_engine_backed === true,
    ratified: admissibility?.ratified === true,
    binding_status: admissibility?.binding_status ?? null,
    authenticated_request_sent: typeof admissibility?.authenticated_request_sent === "boolean"
      ? admissibility.authenticated_request_sent
      : null,
    request_contract_digest_present:
      admissibility?.digest_evidence?.request_contract_digest_present === true,
    worker_admission_authority_binding_present:
      admissibility?.authority_binding_evidence?.worker_admission_authority_binding_present === true,
    ...(admissibility?.diagnostic_code === "node_engine_decision_envelope_malformed" &&
    isExactPolicyPayloadIssue(admissibility?.exact_policy_payload_issue)
      ? { exact_policy_payload_issue: admissibility.exact_policy_payload_issue }
      : {})
  };
}

export function projectBoundedExactPolicyPayloadIssueReadiness(readiness) {
  const admissibility = readiness?.admissibility;
  if (!admissibility || !Object.hasOwn(admissibility, "exact_policy_payload_issue")) {
    return readiness;
  }
  if (
    admissibility.diagnostic_code === "node_engine_decision_envelope_malformed" &&
    isExactPolicyPayloadIssue(admissibility.exact_policy_payload_issue)
  ) {
    return readiness;
  }
  const projectedAdmissibility = { ...admissibility };
  delete projectedAdmissibility.exact_policy_payload_issue;
  return { ...readiness, admissibility: projectedAdmissibility };
}

function exactReturnedPolicyResult(admissibility, effect) {
  return {
    authority_limb: EXACT_RETURNED_POLICY_AUTHORITY_LIMB,
    authority: admissibility.authority,
    effect,
    verdict: admissibility.status,
    diagnostic_code: admissibility.diagnostic_code ?? null,
    response_provenance: admissibility.response_provenance,
    reasons: admissibility.complete_reasons ?? admissibility.reasons ?? [],
    ...(admissibility.recovery === undefined
      ? {}
      : { remediation: admissibility.recovery }),
    ratified: admissibility.ratified === true,
    binding_status: admissibility.binding_status ?? null,
    digest_evidence: admissibility.digest_evidence ?? null,
    authority_binding_evidence: admissibility.authority_binding_evidence ?? null,
    ...(admissibility.recovery_projection_state
      ? { recovery_projection_state: admissibility.recovery_projection_state }
      : {})
  };
}

export function nodeEngineRefusal(readiness) {
  const admissibility = readiness?.admissibility;
  if (!admissibility) {
    return {
      limb: MECHANICAL_FAILURE_AUTHORITY_LIMB,
      classification: classifyMechanicalRuntimeBlocker({
        producer: "operator_recovery",
        condition: "launcher_declaration_missing",
        detail: { issue: "remote_enforcement_absent" }
      }),
      reason: "remote_enforcement_absent"
    };
  }
  if (isPositiveConfirmedNoCceAuthority(admissibility)) return null;

  const effect = authenticatedCceDecisionEffect(admissibility);
  if (effect === "admit") {
    if (readiness?.dispatchable === true) return null;
    return {
      limb: MECHANICAL_FAILURE_AUTHORITY_LIMB,
      classification: classifyMechanicalRuntimeBlocker({
        producer: "operator_recovery",
        condition: "decision_envelope_contradictory",
        detail: nodeEngineMechanicalDetail(admissibility)
      }),
      reason: "node_engine_admit_not_dispatchable"
    };
  }
  if (effect === "needs_review" || effect === "reject") {
    return {
      limb: EXACT_RETURNED_POLICY_AUTHORITY_LIMB,
      code: CCE_EXACT_RETURNED_POLICY_BLOCKER_CODE,
      reason: admissibility.diagnostic_code ?? `node_engine_${effect}`,
      policyResult: exactReturnedPolicyResult(admissibility, effect)
    };
  }

  const [producer, condition] = nodeEngineMechanicalFacts(admissibility);
  return {
    limb: MECHANICAL_FAILURE_AUTHORITY_LIMB,
    classification: classifyMechanicalRuntimeBlocker({
      producer,
      condition,
      detail: nodeEngineMechanicalDetail(admissibility)
    }),
    reason: admissibility.diagnostic_code ?? "node_engine_no_valid_decision"
  };
}

if (!isRuntimeBlockerCode(CCE_EXACT_RETURNED_POLICY_BLOCKER_CODE)) {
  throw new Error(
    `dispatch registration requires the registered exact-returned-policy identity ${CCE_EXACT_RETURNED_POLICY_BLOCKER_CODE}`
  );
}
