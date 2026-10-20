

import {
  acceptanceValidationDriftProposal,
  ACCEPTANCE_VALIDATION_FIELD
} from "@agent-chassis/agent-launch-cli/src/lib/wk-forge-closeout-chain.mjs";
import { ownedNoRouteRecovery } from "../dispatch-tool-helpers.mjs";
import { buildDispatchGuidanceRefusal } from "../dispatch-guidance-contract.mjs";
import { WORK_ITEM_ORDINARY_MEMBERS } from '@agent-chassis/wiki-core/src/lib/record-authoring-schema.mjs';

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

function authoredWkReadGuidance({
  fields, information, recovery, assignedUnit, readUnit = assignedUnit, code, decidingFacts, observedFacts,
  carried, requestSchemaAuthority
}) {
  const built = buildDispatchGuidanceRefusal({
    code,
    decidingFacts: [...decidingFacts, { field: FORGE_HANDOFF_DRIFT_FIELDS_FACT, value: fields }],
    observedFacts: { ...observedFacts, [FORGE_HANDOFF_DRIFT_FIELDS_FACT]: fields },
    guidance: { tool: "workspace_read_wiki", arguments: { reads: [{ subject: readUnit,
      for_changes: [...new Set(fields.flatMap(field => field === 'sections.tasks' ? ['tasks']
        : WORK_ITEM_ORDINARY_MEMBERS.filter(row => row.field === field || field.startsWith(row.field + '.')).map(row => row.member)))] }] }, information },
    recovery: {
      responsible_actor: recovery.responsible_actor,
      prerequisite: recovery.prerequisite,
      selected_from: [FORGE_HANDOFF_DRIFT_FIELDS_FACT],
      retry_condition: recovery.retry_condition,
      explanation: recovery.explanation
    },
    route: "workspace_publish_work",
    carried,
    requestSchemaAuthority
  });
  if (built.refusal) return built;
  return {
    unavailable: built.unavailable,
    recovery: ownedNoRouteRecovery({
      responsibleActor: recovery.responsible_actor,
      prerequisite: recovery.prerequisite,
      retryCondition: recovery.retry_condition,
      explanation: `${recovery.explanation} The field guidance read cannot be offered by this ` +
        `server: missing ${built.unavailable.missing.join(", ")} (${built.unavailable.owner}).`
    })
  };
}

export function acceptanceValidationDriftGuidance({
  refusal, detail, assignedUnit, code, decidingFacts, observedFacts, carried, requestSchemaAuthority
}) {
  const fields = closeoutDriftFields(refusal, detail);
  if (fields === null || fields.length !== 1 || fields[0] !== ACCEPTANCE_VALIDATION_FIELD ||
      !isExactDriftProposal(detail, assignedUnit)) return null;
  return authoredWkReadGuidance({
    fields, recovery: detail.recovery, assignedUnit, code, decidingFacts, observedFacts, carried,
    requestSchemaAuthority,
    information: "Read the current authored WK and its authoring selections before saving corrected acceptance or an evidence entry."
  });
}

const comparedDriftRecovery = ({ scope, member }) => Object.freeze({
  responsible_actor: "coordinator",
  prerequisite: `${scope} holds the terminal candidate's values at every path ` +
    "named in forge_handoff.closeout_drift_fields; a task marked done needs no change",
  retry_condition: "re-issue workspace_publish_work for the same subject after each named path holds its " +
    `${member}.differences candidate_value`,
  explanation: "Publication carries a task marked done through save_record by itself. The named paths are " +
    `other changes it cannot carry; ${member}.differences lists each with the value the candidate ` +
    "holds and the value observed, and marks a compared task completion as task_completion. To publish " +
    "this candidate, save each named path back to its candidate value through save_record with the " +
    "revision workspace_read_wiki returns; a stale revision refuses, so an intervening edit is never " +
    "overwritten. A change save_record's authoring selections do not offer has no correction " +
    "established here. Publication restored nothing into the live record. The mismatch is between the " +
    "live record and the candidate's own record, so inspecting or advancing the candidate does not " +
    "resolve it. Reading this guidance changes nothing."
});

const namedPaths = (fields) => Array.isArray(fields) && fields.length > 0 &&
  fields.every((field) => typeof field === "string") ? [...fields] : null;
const isCloseoutProjectionRefusal = (refusal, detail) => refusal?.category === "eligibility" &&
  detail?.stage === "closeout" && detail.reason === "local_WK_not_authenticated_against_candidate";

export function closeoutSectionsDriftFields(refusal, detail, assignedUnit) {
  return isCloseoutProjectionRefusal(refusal, detail) &&
    detail.projection?.reason === "unrelated_sections_drift" && detail.projection.unit === assignedUnit
    ? namedPaths(detail.projection.fields) : null;
}

export function closeoutSliceDriftFields(refusal, detail) {
  const projection = detail?.projection;
  const fields = isCloseoutProjectionRefusal(refusal, detail) && projection?.reason === "unrelated_slice_drift" &&
    projection.cause === "unsupported_change" && /^SLICE-\d{3}$/u.test(projection.slice_id ?? "")
    ? namedPaths(projection.fields) : null;
  return fields === null ? null : { slice_id: projection.slice_id, fields };
}

export function sectionsDriftGuidance({
  refusal, detail, assignedUnit, code, decidingFacts, observedFacts, carried, requestSchemaAuthority
}) {
  const route = { assignedUnit, code, decidingFacts, observedFacts, carried, requestSchemaAuthority };
  const fields = closeoutSectionsDriftFields(refusal, detail, assignedUnit);
  if (fields !== null) {
    return authoredWkReadGuidance({
      ...route, fields,
      recovery: comparedDriftRecovery({ scope: "the live WK record's parent sections", member: "sections_drift" }),
      information: "Read the current authored WK and its authoring selections before correcting the named sections."
    });
  }
  const slice = closeoutSliceDriftFields(refusal, detail);
  if (slice === null) return null;
  const readUnit = `${assignedUnit}#${slice.slice_id}`;
  return authoredWkReadGuidance({
    ...route, fields: slice.fields, readUnit,
    recovery: comparedDriftRecovery({ scope: `slice ${readUnit} of the live WK record`, member: "slice_drift" }),
    information: "Read the current authored slice and its authoring selections before correcting the named paths."
  });
}
