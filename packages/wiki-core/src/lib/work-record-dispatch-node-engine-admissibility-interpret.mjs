

import { isNonEmptyString, isObject } from "./work-record-dispatch-shared.mjs";
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
  buildNeedsReviewRecoveryProjection,
  resolveNeedsReviewEnumerableRecovery,
  validRatifiedCurrentDecisionRecovery
} from "./work-record-dispatch-node-engine-admissibility-recovery-projection.mjs";

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

  const reasons = Array.isArray(packResult.pack_result_reasons) ? packResult.pack_result_reasons : [];
  const recovery = isObject(packResult.recovery) ? packResult.recovery : null;

  if (outcome === "pack_backed_result" && packBacked) {
    if (effect === "admit") {

      if (!nodeEngineBacked) {
        return buildNodeEngineAdmissibilityOutcome(
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
        );
      }

      if (ratified) {
        return buildNodeEngineAdmissibilityOutcome("admit", true, "node_engine_admit", {
          effect,
          pack_backed: packBacked,
          node_engine_backed: nodeEngineBacked,
          binding_status: bindingStatus,
          ratified,
          reasons,
          recovery
        });
      }
      return buildNodeEngineAdmissibilityOutcome("unratified", false, "node_engine_admit_unratified", {
        effect,
        pack_backed: packBacked,
        node_engine_backed: nodeEngineBacked,
        binding_status: bindingStatus,
        ratified,
        reasons,
        recovery
      });
    }
    if (effect === "needs_review") {
      return buildNodeEngineAdmissibilityOutcome("needs_review", false, "node_engine_needs_review", {
        effect,
        pack_backed: packBacked,
        node_engine_backed: nodeEngineBacked,
        binding_status: bindingStatus,
        ratified,
        reasons,
        recovery
      });
    }
    if (effect === "reject") {
      return buildNodeEngineAdmissibilityOutcome("reject", false, "node_engine_reject", {
        effect,
        pack_backed: packBacked,
        node_engine_backed: nodeEngineBacked,
        binding_status: bindingStatus,
        ratified,
        reasons,
        recovery
      });
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
  const boundedReasons = outcome.status === "needs_review"
    ? projectBoundedPublicReasons(outcome.reasons)
    : outcome.reasons;
  const isNeedsReview = outcome.status === "needs_review";

  const needsReviewRecovery = isNeedsReview ? resolveNeedsReviewEnumerableRecovery(outcome) : null;
  const primaryRecovery = isNeedsReview
    ? needsReviewRecovery
    : validRatifiedCurrentDecisionRecovery(outcome);
  const attachNeedsReviewRecovery = isNeedsReview;
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
    ...(typeof outcome.authenticated_request_sent === "boolean"
      ? { authenticated_request_sent: outcome.authenticated_request_sent }
      : {})
  };
  if (primaryRecovery) {
    attachPrimaryRecoveryProjection(admissibility, primaryRecovery);
  }
  if (attachNeedsReviewRecovery) {
    attachNeedsReviewRecoveryProjection(
      admissibility,
      primaryRecovery ?? buildNeedsReviewRecoveryProjection({ readiness, reasons: outcome.reasons })
    );
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
