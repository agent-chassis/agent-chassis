

import {
  ControlledContractToolError,
  readControlledContractCarrierFile,
  resolveCanonicalControlledContractCarrierSet
} from "../../lib/controlled-contract-tools.mjs";
import { loadWorkRecordById } from "../../lib/work-record-store.mjs";
import {
  inspectControlledContractDesignWorkbenchOperation
} from "./design-workbench-operations.mjs";
import { assessControlledContractOperation } from "./assessment-operations.mjs";
import {
  classifyControlledContractTerminalGaps
} from "./terminal-gap-classification.mjs";

export const CONTROLLED_CONTRACT_POST_SETTLEMENT_SCHEMA =
  "controlled-contract-post-settlement-recomputation.v1";

export const CONTROLLED_CONTRACT_RECOMPUTATION_STATES = Object.freeze([
  "recomputed", "stale_source", "internal_invariant"
]);

function generationIdentity(canonicalSet) {
  return typeof canonicalSet.generation === "string"
    ? canonicalSet.generation : canonicalSet.generation?.id ?? null;
}

function outcome(state, fields) {
  return Object.freeze({
    schema_version: CONTROLLED_CONTRACT_POST_SETTLEMENT_SCHEMA,
    state,
    ...fields
  });
}

function invariant(fields, reason, details = {}) {
  return outcome("internal_invariant", {
    ...fields,
    reason_code: reason,

    recoverable_from: Object.freeze({
      transaction_identity: fields.transaction_identity,
      receipt_identity: fields.receipt_identity,
      resulting_generation: fields.expected_generation
    }),
    details: Object.freeze(details)
  });
}

export async function recomputeControlledContractSettledState({
  repoRoot, wkId, focus = null, expectedRecordSourceDigest,
  transactionIdentity, receiptIdentity, expectedGeneration
}, {
  resolveCanonicalSet = resolveCanonicalControlledContractCarrierSet,
  readCarrier = readControlledContractCarrierFile,
  loadRecord = loadWorkRecordById,
  inspectWorkbench = inspectControlledContractDesignWorkbenchOperation,

  evaluate = async (request) => Object.freeze({
    workbench: await inspectWorkbench(request), classification: null }),
  assess = assessControlledContractOperation
} = {}) {
  const identity = Object.freeze({
    wk_id: wkId, focus: focus ?? null,
    transaction_identity: transactionIdentity ?? null,
    receipt_identity: receiptIdentity ?? null,
    expected_generation: expectedGeneration ?? null
  });

  let canonicalSet;
  try {
    canonicalSet = await resolveCanonicalSet({ repoRoot, wkId, focus });
  } catch (error) {
    return invariant(identity, "settled_generation_unloadable",
      { cause_code: error?.code ?? null });
  }
  const currentGeneration = generationIdentity(canonicalSet);
  if (expectedGeneration !== null && expectedGeneration !== undefined &&
      currentGeneration !== expectedGeneration) {
    return invariant(identity, "settled_generation_pointer_mismatch",
      { current_generation: currentGeneration });
  }

  let contract;
  let proofPlan = null;
  try {
    contract = await readCarrier({ repoRoot, wkId, focus,
      carrierKind: "contract", canonicalSet });
    try {
      proofPlan = await readCarrier({ repoRoot, wkId, focus,
        carrierKind: "proof_plan", canonicalSet });
    } catch (error) {
      if (error?.code !== "controlled_contract_carrier_not_found") throw error;
    }
  } catch (error) {
    return invariant({ ...identity, current_generation: currentGeneration },
      "settled_carrier_unloadable", { cause_code: error?.code ?? null });
  }

  const loaded = await loadRecord({ dir: repoRoot, id: wkId }).catch(() => null);
  const recordSourceDigest = loaded?.source_digest ?? null;
  const sourceMoved = typeof expectedRecordSourceDigest === "string" &&
    expectedRecordSourceDigest.length > 0 &&
    recordSourceDigest !== expectedRecordSourceDigest;

  let evaluated;
  try {
    evaluated = await evaluate({ repoRoot, wkId, focus });
  } catch (error) {
    return invariant({ ...identity, current_generation: currentGeneration },
      "workbench_recomputation_failed", { cause_code: error?.code ?? null });
  }
  const workbench = evaluated.workbench;
  if (workbench.subject.generation_id !== currentGeneration) {
    return invariant({ ...identity, current_generation: currentGeneration },
      "workbench_generation_disagreement",
      { workbench_generation: workbench.subject.generation_id ?? null });
  }

  let assessment = null;
  let assessmentFailure = null;
  try {
    assessment = await assess({ repoRoot, wkId, focus });
  } catch (error) {
    assessmentFailure = error?.code ?? "controlled_contract_assessment_failed";
  }

  const gaps = classifyControlledContractTerminalGaps({ workbench });
  const projected = {
    ...identity,
    current_generation: currentGeneration,
    manifest_content_digest: canonicalSet.manifest_content_digest ?? null,
    contract_content_digest: contract.content_digest,
    proof_plan_content_digest: proofPlan?.content_digest ?? null,
    record_source_digest: recordSourceDigest,
    workbench,

    evaluated,
    assessment,
    assessment_failure: assessmentFailure,
    terminal_gaps: gaps
  };
  if (sourceMoved) {

    return outcome("stale_source", { ...projected,
      reason_code: "record_source_moved_after_settlement",
      expected_record_source_digest: expectedRecordSourceDigest });
  }
  return outcome("recomputed", projected);
}

export function projectControlledContractFinalAssessment({
  recomputation, repair = null
}) {
  const workbench = recomputation.workbench ?? null;
  const assessment = recomputation.assessment ?? null;
  const gaps = recomputation.terminal_gaps ?? null;
  return Object.freeze({
    schema_version: "controlled-contract-final-assessment.v1",
    wk_id: recomputation.wk_id,
    focus: recomputation.focus,
    record_source_digest: recomputation.record_source_digest ?? null,
    starting_generation: repair?.starting_generation ?? null,
    current_generation: recomputation.current_generation ?? null,
    manifest_content_digest: recomputation.manifest_content_digest ?? null,
    contract_content_digest: recomputation.contract_content_digest ?? null,
    proof_plan_content_digest: recomputation.proof_plan_content_digest ?? null,
    transaction_identity: recomputation.transaction_identity,
    receipt_identity: recomputation.receipt_identity,
    recomputation_state: recomputation.state,
    recomputation_reason_code: recomputation.reason_code ?? null,
    repair_state: repair?.repair_state ?? "not_considered",
    counts: Object.freeze({
      candidates: repair?.candidates ?? 0,
      preparations: repair?.preparations ?? 0,
      validations: repair?.validations ?? 0,
      commits: repair?.commits ?? 0,
      compensations: repair?.compensations ?? 0,
      generation_transitions: repair?.generation_transitions ?? 0,
      workbench_recomputations: recomputation.state === "internal_invariant" ? 0 : 1,
      assessment_recomputations:
        recomputation.state === "internal_invariant" ||
        recomputation.assessment_failure !== null ? 0 : 1
    }),

    mechanically_complete: recomputation.state === "recomputed" &&
      workbench?.mechanically_complete === true,
    dimension_count: workbench?.dimension_count ?? 0,
    dimension_counts: Object.freeze((workbench?.dimensions ?? []).map(
      ({ dimension_id: id, status, counts }) => Object.freeze({
        dimension_id: id, status, total: counts.total,
        complete: counts.complete, missing: counts.missing,
        stale: counts.stale, conflicting: counts.conflicting,
        not_applicable: counts.not_applicable }))),
    incomplete_row_count: workbench?.incomplete_row_count ?? 0,
    actionable_row_count: workbench?.actionable_row_count ?? 0,
    non_actionable_row_count: workbench?.non_actionable_row_count ?? 0,
    assessment_identity: assessment?.assessment_identity ??
      assessment?.identity ?? null,
    assessment_state: assessment?.state ?? null,
    assessment_failure: recomputation.assessment_failure ?? null,
    cross_carrier_integrity_state: (workbench?.dimensions ?? []).find(
      ({ dimension_id: id }) => id === "cross_owner_consistency")?.status ?? null,
    terminal_gap_counts: gaps?.gap_class_counts ?? null,
    terminal_gap_total: gaps?.total_gap_count ?? 0,

    retained_detail: Object.freeze({
      resource_kind: "receipt",
      resource_identity: recomputation.receipt_identity,
      omitted_row_count: (workbench?.incomplete_row_count ?? 0)
    }),
    authority: Object.freeze({
      dispatch: false, proof: false, lifecycle: false, review: false,
      cce_exclusive: true, integration: false, publication: false,
      completion: false
    })
  });
}

export { ControlledContractToolError };
