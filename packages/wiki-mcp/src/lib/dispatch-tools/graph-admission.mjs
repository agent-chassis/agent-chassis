import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { DISPATCH_BLOCKER_CODES } from "../dispatch-tool-constants.mjs";
import { buildBlockedDispatchResult } from "../dispatch-tool-helpers.mjs";

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
      return { readiness, recoveredGraphImpact, refusal: buildBlockedDispatchResult({
        blockerCode: RUNTIME_BLOCKER_CODES.GRAPH_IMPACT_QUERY_ERROR,
        reason: "graph_impact_query_error",
        detail: boundedRecoveryDetail(readiness, { issue: "graph_generation_failed" })
      }) };
    }
    if (generated?.graph_available !== true) {
      return { readiness, recoveredGraphImpact, refusal: buildBlockedDispatchResult({
        blockerCode: RUNTIME_BLOCKER_CODES.GRAPH_IMPACT_QUERY_ERROR,
        reason: "graph_head_unbuildable",
        detail: boundedRecoveryDetail(readiness, { outcome: generated?.outcome ?? "graph_unavailable" })
      }) };
    }
    recoveredGraphImpact = generated.graph_impact_envelope ?? null;
    if (!recoveredGraphImpact) {
      return { readiness, recoveredGraphImpact, refusal: buildBlockedDispatchResult({
        blockerCode: DISPATCH_BLOCKER_CODES.WORK_RECORD_READINESS_FAILURE,
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
