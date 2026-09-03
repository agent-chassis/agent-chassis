

import { isNonEmptyString, isObject } from "./work-record-dispatch-shared.mjs";
import { isExactPolicyPayloadIssue } from "./node-engine-api-client.mjs";
import {
  NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE,
  NODE_ENGINE_NON_PACK_ADMISSIBILITY_MAP,
  buildNodeEngineAdmissibilityOutcome,
  clampNodeEngineBindingStatus,
  packResultIsRatified
} from "./work-record-dispatch-node-engine-admissibility.mjs";
import { projectBoundedPublicReasons } from "./work-record-dispatch-node-engine-admissibility-reason-projection.mjs";
import {
  attachNeedsReviewRecoveryProjection,
  attachPrimaryRecoveryProjection,
  resolveNeedsReviewEnumerableRecovery,
  validRatifiedCurrentDecisionRecovery
} from "./work-record-dispatch-node-engine-admissibility-recovery-projection.mjs";

const DECISION_IDENTITY_TOKEN_MAX = 128;

function boundedIdentityToken(value) {
  return isNonEmptyString(value) && value.length <= DECISION_IDENTITY_TOKEN_MAX ? value : null;
}

function boundedResponseProvenance(value) {
  const fields = ["schema_version", "pack", "operation"];
  if (!isObject(value) || Object.keys(value).length !== fields.length) return null;
  const provenance = Object.fromEntries(fields.map((field) => [
    field,
    boundedIdentityToken(value[field])
  ]));
  return fields.every((field) => provenance[field] !== null)
    ? Object.freeze(provenance)
    : null;
}

function boundedDigestEvidence(packResult) {
  if (!isObject(packResult)) return null;
  if (
    !Object.hasOwn(packResult, "request_contract_digest_present") &&
    !Object.hasOwn(packResult, "request_contract_digest_source")
  ) {
    return null;
  }
  return Object.freeze({
    request_contract_digest_present: packResult.request_contract_digest_present === true,
    request_contract_digest_source: boundedIdentityToken(packResult.request_contract_digest_source)
  });
}

function boundedAuthorityBindingEvidence(packResult) {
  if (!isObject(packResult)) return null;
  if (
    !Object.hasOwn(packResult, "worker_admission_authority_binding_present") &&
    !Object.hasOwn(packResult, "worker_admission_authority_binding_source")
  ) {
    return null;
  }
  return Object.freeze({
    worker_admission_authority_binding_present:
      packResult.worker_admission_authority_binding_present === true,
    worker_admission_authority_binding_source: boundedIdentityToken(
      packResult.worker_admission_authority_binding_source
    )
  });
}

function attachExactDecisionEvidence(outcome, packResult, recoveryValidation) {
  const provenance = boundedResponseProvenance(packResult?.response_provenance);
  const digest = boundedDigestEvidence(packResult);
  const authorityBinding = boundedAuthorityBindingEvidence(packResult);
  if (provenance) outcome.response_provenance = provenance;
  if (digest) outcome.digest_evidence = digest;
  if (authorityBinding) outcome.authority_binding_evidence = authorityBinding;
  if (Array.isArray(packResult?.pack_result_reasons)) {
    Object.defineProperty(outcome, "ordinary_reason_projection_input", {
      value: packResult.pack_result_reasons,
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
  if (recoveryValidation) {
    Object.defineProperty(outcome, "recovery_validation", {
      value: recoveryValidation,
      enumerable: false,
      configurable: false,
      writable: false
    });
    outcome.recovery_diagnostic = recoveryValidation.diagnostic;
  }
  if (packResult?.exact_policy_payload_authenticated === true) {
    outcome.exact_policy_payload_authenticated = true;
  }
  if (
    outcome.diagnostic_code === "node_engine_decision_envelope_malformed" &&
    isExactPolicyPayloadIssue(packResult?.exact_policy_payload_issue)
  ) {
    outcome.exact_policy_payload_issue = packResult.exact_policy_payload_issue;
  }
  return outcome;
}

export function interpretNodeEngineAdmissibility(packResult) {
  if (!isObject(packResult)) {
    return buildNodeEngineAdmissibilityOutcome(
      "undetermined",
      false,
      "node_engine_admissibility_undetermined"
    );
  }

  const outcome = isNonEmptyString(packResult.outcome) ? packResult.outcome : null;
  const effect = isNonEmptyString(packResult.effect) ? packResult.effect : null;
  const packBacked = packResult.pack_backed === true;
  const nodeEngineBacked = packResult.node_engine_backed_success === true;
  const authenticatedRequestSent =
    typeof packResult.authenticated_request_sent === "boolean"
      ? packResult.authenticated_request_sent
      : null;

  const bindingStatus = clampNodeEngineBindingStatus(packResult.node_engine_binding_status);
  const ratified = packResultIsRatified(packResult);

  const reasons = Array.isArray(packResult.reasons) ? packResult.reasons : [];
  const recoveryValidation = isObject(packResult.recovery_validation)
    ? packResult.recovery_validation
    : null;
  const recovery = isObject(packResult.recovery) ? packResult.recovery : null;

  if (outcome === "pack_backed_result" && packBacked) {
    if (effect === "admit") {

      if (!nodeEngineBacked) {
        return attachExactDecisionEvidence(
          buildNodeEngineAdmissibilityOutcome(
            "undetermined",
            false,
            "node_engine_admit_not_backed",
            {
              effect,
              pack_backed: packBacked,
              node_engine_backed: nodeEngineBacked,
              binding_status: bindingStatus,
              ratified,
              reasons,
              recovery
            }
          ),
          packResult,
          recoveryValidation
        );
      }

      if (
        ratified &&
        packResult.exact_policy_payload_authenticated !== true
      ) {
        return attachExactDecisionEvidence(
          buildNodeEngineAdmissibilityOutcome(
            "undetermined",
            false,
            "node_engine_decision_envelope_malformed",
            {
              effect,
              pack_backed: packBacked,
              node_engine_backed: nodeEngineBacked,
              binding_status: bindingStatus,
              ratified,
              reasons,
              recovery
            }
          ),
          packResult,
          recoveryValidation
        );
      }
      if (ratified) {
        return attachExactDecisionEvidence(
          buildNodeEngineAdmissibilityOutcome("admit", true, "node_engine_admit", {
            effect,
            pack_backed: packBacked,
            node_engine_backed: nodeEngineBacked,
            binding_status: bindingStatus,
            ratified,
            reasons,
            recovery
          }),
          packResult,
          recoveryValidation
        );
      }
      return attachExactDecisionEvidence(
        buildNodeEngineAdmissibilityOutcome("unratified", false, "node_engine_admit_unratified", {
          effect,
          pack_backed: packBacked,
          node_engine_backed: nodeEngineBacked,
          binding_status: bindingStatus,
          ratified,
          reasons,
          recovery
        }),
        packResult,
        recoveryValidation
      );
    }
    if (effect === "needs_review") {
      if (packResult.exact_policy_payload_authenticated !== true) {
        const interpreted = attachExactDecisionEvidence(
          buildNodeEngineAdmissibilityOutcome(
            "undetermined",
            false,
            "node_engine_decision_envelope_malformed",
            {
              effect,
              pack_backed: packBacked,
              node_engine_backed: nodeEngineBacked,
              binding_status: bindingStatus,
              ratified,
              reasons,
              recovery
            }
          ),
          packResult,
          recoveryValidation
        );
        interpreted.recovery_projection_state = packResult.recovery_projection_state ?? "invalid";
        return interpreted;
      }
      const interpreted = attachExactDecisionEvidence(
        buildNodeEngineAdmissibilityOutcome("needs_review", false, "node_engine_needs_review", {
          effect,
          pack_backed: packBacked,
          node_engine_backed: nodeEngineBacked,
          binding_status: bindingStatus,
          ratified,
          reasons,
          recovery
        }),
        packResult,
        recoveryValidation
      );
      interpreted.recovery_projection_state = packResult.recovery_projection_state ?? "absent";
      return interpreted;
    }
    if (effect === "reject") {
      if (packResult.exact_policy_payload_authenticated !== true) {
        return attachExactDecisionEvidence(
          buildNodeEngineAdmissibilityOutcome(
            "undetermined",
            false,
            "node_engine_decision_envelope_malformed",
            {
              effect,
              pack_backed: packBacked,
              node_engine_backed: nodeEngineBacked,
              binding_status: bindingStatus,
              ratified,
              reasons,
              recovery
            }
          ),
          packResult,
          recoveryValidation
        );
      }
      return attachExactDecisionEvidence(
        buildNodeEngineAdmissibilityOutcome("reject", false, "node_engine_reject", {
          effect,
          pack_backed: packBacked,
          node_engine_backed: nodeEngineBacked,
          binding_status: bindingStatus,
          ratified,
          reasons,
          recovery
        }),
        packResult,
        recoveryValidation
      );
    }
    return buildNodeEngineAdmissibilityOutcome(
      "undetermined",
      false,
      "node_engine_unrecognized_effect",
      { binding_status: bindingStatus, ratified }
    );
  }

  const mapped = NODE_ENGINE_NON_PACK_ADMISSIBILITY_MAP[outcome] ?? [
    "undetermined",
    "node_engine_admissibility_undetermined"
  ];
  return buildNodeEngineAdmissibilityOutcome(mapped[0], false, mapped[1], {
    effect,
    pack_backed: packBacked,
    node_engine_backed: nodeEngineBacked,
    binding_status: bindingStatus,
    ratified,
    ...(authenticatedRequestSent !== null
      ? { authenticated_request_sent: authenticatedRequestSent }
      : {})
  });
}

function admissibilityReasonText(outcome) {
  if (outcome.status === "reject") {
    return `Node Engine admissibility denied (${outcome.diagnostic_code})`;
  }
  if (outcome.status === "needs_review") {
    return `Node Engine admissibility requires review (${outcome.diagnostic_code})`;
  }
  if (outcome.status === "unratified") {
    return `Node Engine admissibility admit is not ratified launch authority (${outcome.diagnostic_code})`;
  }
  if (outcome.status === "unavailable") {
    return `Node Engine admissibility unavailable (${outcome.diagnostic_code})`;
  }
  return `Node Engine admissibility could not be determined (${outcome.diagnostic_code})`;
}

function admissibilityOverlayDecisionCode(outcome) {
  if (outcome.status === "reject") {
    return NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE;
  }
  if (outcome.status === "needs_review") {
    return NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE;
  }
  if (outcome.status === "unratified") {
    return NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE;
  }
  if (outcome.status === "unavailable") {
    return NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE;
  }
  return NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE;
}

export function foldNodeEngineAdmissibilityIntoReadiness(readiness, outcome) {
  const structuralDispatchable = readiness.dispatchable === true;
  const exactPolicyPayloadAuthenticated = outcome.exact_policy_payload_authenticated === true;
  const boundedReasons = projectBoundedPublicReasons(
    outcome.ordinary_reason_projection_input ?? outcome.reasons
  );
  const isNeedsReview = outcome.status === "needs_review";
  const recoveryProjectionState = outcome.recovery_projection_state ?? null;

  const needsReviewRecovery = isNeedsReview
    ? exactPolicyPayloadAuthenticated
      ? recoveryProjectionState === "valid" && isObject(outcome.recovery)
        ? outcome.recovery
        : null
      : resolveNeedsReviewEnumerableRecovery(outcome)
    : null;
  const primaryRecovery = isNeedsReview
    ? needsReviewRecovery
    : exactPolicyPayloadAuthenticated && isObject(outcome.recovery)
      ? outcome.recovery
      : validRatifiedCurrentDecisionRecovery(outcome);
  const attachNeedsReviewRecovery = isNeedsReview && (
    exactPolicyPayloadAuthenticated
      ? primaryRecovery !== null
      : recoveryProjectionState !== "valid" || primaryRecovery !== null
  );
  const admissibility = {
    evaluated: outcome.evaluated,
    authority: outcome.authority,
    status: outcome.status,
    admissible: outcome.admissible,
    effect: outcome.effect,
    pack_backed: outcome.pack_backed,
    node_engine_backed: outcome.node_engine_backed,

    binding_status: outcome.binding_status,
    ratified: outcome.ratified,
    diagnostic_code: outcome.diagnostic_code,
    reasons: boundedReasons,
    ...(outcome.response_provenance
      ? { response_provenance: outcome.response_provenance }
      : {}),
    ...(outcome.digest_evidence ? { digest_evidence: outcome.digest_evidence } : {}),
    ...(outcome.authority_binding_evidence
      ? { authority_binding_evidence: outcome.authority_binding_evidence }
      : {}),
    ...(outcome.exact_policy_payload_authenticated === true
      ? { exact_policy_payload_authenticated: true }
      : {}),
    ...(outcome.diagnostic_code === "node_engine_decision_envelope_malformed" &&
    isExactPolicyPayloadIssue(outcome.exact_policy_payload_issue)
      ? { exact_policy_payload_issue: outcome.exact_policy_payload_issue }
      : {}),
    ...(recoveryProjectionState
      ? { recovery_projection_state: recoveryProjectionState }
      : {}),
    ...(outcome.recovery_diagnostic
      ? { recovery_diagnostic: outcome.recovery_diagnostic }
      : {}),
    ...(typeof outcome.authenticated_request_sent === "boolean"
      ? { authenticated_request_sent: outcome.authenticated_request_sent }
      : {})
  };
  if (outcome.recovery_validation) {
    Object.defineProperty(admissibility, "recovery_validation", {
      value: outcome.recovery_validation,
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
  if (Array.isArray(outcome.reasons)) {
    Object.defineProperty(admissibility, "complete_reasons", {
      value: outcome.reasons,
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
  if (primaryRecovery) {
    attachPrimaryRecoveryProjection(admissibility, primaryRecovery);
  }
  if (attachNeedsReviewRecovery) {
    attachNeedsReviewRecoveryProjection(admissibility, primaryRecovery);
  }
  const enriched = {
    ...readiness,
    structural_readiness: {
      dispatchable: structuralDispatchable,
      decision_code: readiness.decision_code
    },
    admissibility
  };

  if (structuralDispatchable && outcome.admissible !== true) {
    enriched.dispatchable = false;
    enriched.decision_code = admissibilityOverlayDecisionCode(outcome);
    enriched.reasons = [...new Set([admissibilityReasonText(outcome), ...readiness.reasons])];
  }

  return enriched;
}
