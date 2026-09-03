

import { classifyMechanicalRuntimeBlocker } from "./runtime-blocker-classifier.mjs";
import {
  buildBlockedDispatchResult,
  buildDispatchMechanicalRefusal,
  NO_SUPPORTED_ROUTE_RECOVERY
} from "../dispatch-tool-helpers.mjs";

function blockedGraphAdmission({ condition, reason, detail }) {
  const classification = classifyMechanicalRuntimeBlocker({
    producer: "graph",
    condition,
    detail: { graph_condition: condition }
  });
  const observedFacts = {
    "graph_impact.condition": condition,
    "graph_impact.trusted_baseline_available": false
  };
  const refusal = buildDispatchMechanicalRefusal({
    code: classification.code,
    decidingFacts: [
      { field: "graph_impact.trusted_baseline_available", value: false },
      { field: "graph_impact.condition", value: condition }
    ],
    observedFacts,
    noSupportedRoute: true,
    recovery: NO_SUPPORTED_ROUTE_RECOVERY,
    route: "workspace_agent_dispatch",
    carried: { mechanical_classification: classification }
  });
  return buildBlockedDispatchResult({
    refusal,
    reason,
    detail: {
      ...detail,
      authority_limb: classification.authority_limb,
      cause: classification.cause,
      actor_recovery: classification.actor_recovery
    }
  });
}

export async function prepareCommittedHeadGraphAdmission({
  readiness,
  dir,
  unitAddress,
  readinessDispatchRole,
  graphDerivationRequiredForDispatch,
  generateGraphImpactEvidence,
  validateDispatch,
  boundedRecoveryDetail
}) {
  let recoveredGraphImpact = null;
  if (graphDerivationRequiredForDispatch(readiness.recovery?.graph_impact)) {
    let generated;
    try {
      generated = await generateGraphImpactEvidence({ dir, unitAddress });
    } catch {

      return { readiness, recoveredGraphImpact, refusal: blockedGraphAdmission({
        condition: "query_error",
        reason: "graph_impact_query_error",
        detail: boundedRecoveryDetail(readiness, { issue: "graph_generation_failed" })
      }) };
    }
    if (generated?.graph_available !== true) {

      return { readiness, recoveredGraphImpact, refusal: blockedGraphAdmission({
        condition: "query_error",
        reason: "graph_head_unbuildable",
        detail: boundedRecoveryDetail(readiness, { outcome: generated?.outcome ?? "graph_unavailable" })
      }) };
    }
    recoveredGraphImpact = generated.graph_impact_envelope ?? null;
    if (!recoveredGraphImpact) {

      return { readiness, recoveredGraphImpact, refusal: blockedGraphAdmission({
        condition: "persistence_unavailable",
        reason: "graph_impact_recovery_failed",
        detail: boundedRecoveryDetail(readiness, { outcome: generated?.outcome ?? "not_persisted" })
      }) };
    }
  }
  readiness = await validateDispatch({
    dir, unitAddress, dispatch_role: readinessDispatchRole, mode: "strict", graph_impact: recoveredGraphImpact
  });
  return { readiness, recoveredGraphImpact, refusal: null };
}
