

import {
  acceptanceValidationDriftProposal,
  ACCEPTANCE_VALIDATION_FIELD
} from "@agent-chassis/agent-launch-cli/src/lib/wk-forge-closeout-chain.mjs";
import { ownedNoRouteRecovery } from "../dispatch-tool-helpers.mjs";
import { buildDispatchGuidanceRefusal } from "../dispatch-guidance-contract.mjs";

export const FORGE_HANDOFF_DRIFT_FIELDS_FACT = "forge_handoff.closeout_drift_fields";

export function closeoutDriftFields(refusal, detail) {
  const fields = detail?.projection?.fields;
  return refusal?.category === "eligibility" && detail?.stage === "closeout" &&
    detail.reason === "local_WK_not_authenticated_against_candidate" &&
    detail.projection?.reason === "unrelated_record_drift" &&
    Array.isArray(fields) && fields.every((field) => typeof field === "string")
    ? [...fields] : null;
}

function isExactDriftProposal(detail, assignedUnit) {
  const drift = detail?.acceptance_validation_drift;
  return JSON.stringify(detail?.recovery) === JSON.stringify(acceptanceValidationDriftProposal(assignedUnit)) &&
    drift?.unit === assignedUnit && drift.field === ACCEPTANCE_VALIDATION_FIELD;
}

export function acceptanceValidationDriftGuidance({
  refusal, detail, assignedUnit, code, decidingFacts, observedFacts, carried, requestSchemaAuthority
}) {
  const fields = closeoutDriftFields(refusal, detail);
  if (fields === null || fields.length !== 1 || fields[0] !== ACCEPTANCE_VALIDATION_FIELD ||
      !isExactDriftProposal(detail, assignedUnit)) return null;
  const proposal = detail.recovery;
  const built = buildDispatchGuidanceRefusal({
    code,
    decidingFacts: [...decidingFacts, { field: FORGE_HANDOFF_DRIFT_FIELDS_FACT, value: fields }],
    observedFacts: { ...observedFacts, [FORGE_HANDOFF_DRIFT_FIELDS_FACT]: fields },
    guidance: { tool: "workspace_read_wiki", arguments: { subject: assignedUnit },
      information: "Read the current authored WK and its authoring selections before saving corrected acceptance or an evidence entry." },
    recovery: {
      responsible_actor: proposal.responsible_actor,
      prerequisite: proposal.prerequisite,
      selected_from: [FORGE_HANDOFF_DRIFT_FIELDS_FACT],
      retry_condition: proposal.retry_condition,
      explanation: proposal.explanation
    },
    route: "workspace_publish_work",
    carried,
    requestSchemaAuthority
  });
  if (built.refusal) return built;
  return {
    unavailable: built.unavailable,
    recovery: ownedNoRouteRecovery({
      responsibleActor: proposal.responsible_actor,
      prerequisite: proposal.prerequisite,
      retryCondition: proposal.retry_condition,
      explanation: `${proposal.explanation} The field guidance read cannot be offered by this ` +
        `server: missing ${built.unavailable.missing.join(", ")} (${built.unavailable.owner}).`
    })
  };
}
