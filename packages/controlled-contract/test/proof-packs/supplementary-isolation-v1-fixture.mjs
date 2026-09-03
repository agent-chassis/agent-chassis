import { canonicalJsonBytes } from "../../lib/exact-binding-common.mjs";
import {
  INPUT_VERSIONS,
  deriveSupplementaryIsolationAttemptRecord
} from "../../lib/supplementary-isolation-attempt-projection.mjs";

const durable = (domain, value) => ({ kind: "durable_id", domain, value });
const role = (reference_id, type_term, domain = "supplementary-isolation") => ({
  reference_id, type_term, grounded_identity: durable(domain, reference_id)
});

function buildSupplementaryIsolationSources({
  branch = "present",
  coreMembers = ["ref-core-member-a", "ref-core-member-b"],
  finalCoreMembers = coreMembers,
  finalMembers = [...finalCoreMembers, ...(branch === "present" ? ["ref-supplementary-component"] : [])],
  supplementaryResults = [],
  settlementSequence = 10,
  failureSequence = 20,
  finalSequence = 30,
  settlements = 1,
  failures = 1,
  results = 1,
  attemptSuffix = "primary",
  declaredCoreMemberCount = coreMembers.length,
  declaredFinalCoreMemberCount = finalCoreMembers.length,
  declaredFinalMemberCount = finalMembers.length,
  declaredResultCount = supplementaryResults.length,
  coreValue = "ref-core-value",
  finalCoreValue = coreValue,
  validCoreValues = [coreValue],
  selectedReason = "ref-failure-reason-selected",
  reasons = [selectedReason, "ref-failure-reason-other"],
  disclosedReasons = [selectedReason]
} = {}) {
  const operation = role("ref-operation", "cc:operation");
  const attempt = role("ref-attempt", "cc:process", `supplementary-isolation:${attemptSuffix}`);
  const attemptStart = role("ref-attempt-start", "cc:event");
  const coreComputation = role("ref-core-computation", "cc:process");
  const supplementaryComputation = role("ref-supplementary-computation", "cc:process");
  const settlementEvent = role("ref-core-settlement", "cc:event");
  const failureEvent = role("ref-supplementary-failure", "cc:event");
  const finalEvent = role("ref-final-result-event", "cc:event");
  const component = role("ref-supplementary-component", "cc:artifact");
  const unavailable = role("ref-unavailable", "cc:state");
  const selectedReasonRole = role(selectedReason, "cc:state");
  const memberRole = (id) => role(id, "cc:entity");
  const reasonRole = (id) => role(id, "cc:state");
  const settlementEntry = (index) => ({
    event: index === 0 ? settlementEvent : role(`ref-core-settlement-${index + 1}`, "cc:event"),
    sequence: settlementSequence + index,
    observation: role(index === 0 ? "ref-settlement-observation" :
      `ref-settlement-observation-${index + 1}`, "cc:evidence"),
    result: role(index === 0 ? "ref-core-result" : `ref-core-result-${index + 1}`, "cc:artifact"),
    state: role(index === 0 ? "ref-core-settled-state" :
      `ref-core-settled-state-${index + 1}`, "cc:state"),
    value: role(coreValue, "cc:state"),
    members: coreMembers.map(memberRole),
    declared_member_count: declaredCoreMemberCount
  });
  const failureEntry = (index) => ({
    event: index === 0 ? failureEvent : role(`ref-supplementary-failure-${index + 1}`, "cc:event"),
    sequence: failureSequence + index,
    component, reason: selectedReasonRole, reasons: reasons.map(reasonRole),
    declared_reason_count: reasons.length,
    supplementary_results: supplementaryResults.map((id) => role(id, "cc:artifact")),
    declared_result_count: declaredResultCount
  });
  const finalEntry = (index) => ({
    event: index === 0 ? finalEvent : role(`ref-final-result-event-${index + 1}`, "cc:event"),
    sequence: finalSequence + index,
    result: role(index === 0 ? "ref-final-result" : `ref-final-result-${index + 1}`, "cc:artifact"),
    core_portion: role("ref-final-core-portion", "cc:artifact"),
    core_state: role("ref-final-core-state", "cc:state"),
    core_value: role(finalCoreValue, "cc:state"),
    observation: role("ref-final-observation", "cc:evidence"),
    core_members: finalCoreMembers.map(memberRole),
    declared_core_member_count: declaredFinalCoreMemberCount,
    final_members: finalMembers.map((id) => id === component.reference_id ? component : memberRole(id)),
    declared_final_member_count: declaredFinalMemberCount,
    present_components: ["present", "ambiguous"].includes(branch) ? [component] : [],
    disclosed_omissions: ["omitted", "ambiguous"].includes(branch) ? [component] : [],
    disclosed_reasons: disclosedReasons.map(reasonRole),
    declared_disclosed_reason_count: disclosedReasons.length,
    unavailable_state: unavailable
  });
  const occurrenceEntries = [
    ...Array.from({ length: settlements }, (_, index) => ({
      kind: "core_settlement", occurrence: settlementEntry(index).event
    })),
    ...Array.from({ length: failures }, (_, index) => ({
      kind: "supplementary_failure", occurrence: failureEntry(index).event
    })),
    ...Array.from({ length: results }, (_, index) => ({
      kind: "final_result", occurrence: finalEntry(index).event
    }))
  ];
  const attemptRecord = {
    schema_version: INPUT_VERSIONS.attempt, operation, attempt,
    attempt_start_event: attemptStart, core_computation: coreComputation,
    supplementary_computation: supplementaryComputation,
    core_valid_states: validCoreValues.map(reasonRole),
    declared_supplementary_components: [component],
    unavailable_states: [unavailable], occurrences: occurrenceEntries
  };
  const settlementRecord = {
    schema_version: INPUT_VERSIONS.settlement, operation, attempt,
    settlements: Array.from({ length: settlements }, (_, index) => settlementEntry(index))
  };
  const failureRecord = {
    schema_version: INPUT_VERSIONS.failure, operation, attempt,
    failures: Array.from({ length: failures }, (_, index) => failureEntry(index))
  };
  const finalRecord = {
    schema_version: INPUT_VERSIONS.final, operation, attempt,
    results: Array.from({ length: results }, (_, index) => finalEntry(index))
  };
  const sourceBytes = [attemptRecord, settlementRecord, failureRecord, finalRecord]
    .map((value) => canonicalJsonBytes(value, { file: true }));
  return {
    attemptRecord, settlementRecord, failureRecord, finalRecord, sourceBytes,
    projectionBytes: deriveSupplementaryIsolationAttemptRecord(sourceBytes)
  };
}

export { buildSupplementaryIsolationSources, durable, role };
