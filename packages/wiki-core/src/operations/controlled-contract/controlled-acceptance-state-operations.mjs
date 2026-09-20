import {
  deriveControlledAcceptanceStateProjection,
  inspectWorkRecordProofPosture
} from "../../lib/work-record-proof-posture.mjs";
import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";
import { loadWorkRecordById } from "../../lib/work-record-store.mjs";
import { computeWorkRecordSourceDigest } from "../../lib/work-record-schema.mjs";
import { inspectControlledContractDesignWorkbenchOperation } from
  "./design-workbench-operations.mjs";
import {
  bindControlledAcceptanceEvaluatedSnapshot
} from "./controlled-acceptance-evaluated-snapshot.mjs";

export const CONTROLLED_ACCEPTANCE_DECISION_CODES = Object.freeze({
  absent: "controlled_acceptance_disposition_missing",
  incomplete: "controlled_acceptance_incomplete",
  invalid: "controlled_acceptance_proof_posture_invalid"
});

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, { changed: false, ...details });
}

export async function classifyControlledAcceptanceStateOperation({
  repoRoot, wkId, selectedUnit = null, record = null
} = {}, {
  loadRecord = loadWorkRecordById,
  inspectWorkbench = inspectControlledContractDesignWorkbenchOperation
} = {}) {
  const loaded = record === null ? await loadRecord({ dir: repoRoot, id: wkId }) : null;
  const canonicalRecord = record ?? loaded?.record ?? null;
  if (canonicalRecord?.id !== wkId) fail(CONTROLLED_ACCEPTANCE_DECISION_CODES.invalid,
    "the exact canonical work record is unavailable");

  if (selectedUnit !== null && !(canonicalRecord.slices ?? [])
    .some(({ id }) => id === selectedUnit)) {
    fail(CONTROLLED_ACCEPTANCE_DECISION_CODES.invalid,
      "the exact selected slice is absent from the canonical work record",
      { selected_unit: selectedUnit });
  }
  const posture = inspectWorkRecordProofPosture(canonicalRecord, { expectedRecordId: wkId });
  if (!posture.valid) fail(CONTROLLED_ACCEPTANCE_DECISION_CODES.invalid, posture.reason);
  const evaluated = await inspectWorkbench({ repoRoot, wkId, focus: null, selectedUnit });

  const workbench = evaluated?.evaluated_snapshot === undefined ? evaluated
    : Object.freeze({ ...evaluated,
      evaluated_snapshot: bindControlledAcceptanceEvaluatedSnapshot(
        evaluated.evaluated_snapshot, {
          expectedRecordSourceDigest:
            computeWorkRecordSourceDigest(canonicalRecord)
        }) });
  try {
    return deriveControlledAcceptanceStateProjection({ wkId, selectedUnit, posture,
      workbench });
  } catch (error) {
    fail(CONTROLLED_ACCEPTANCE_DECISION_CODES.invalid, error.message, {
      source_code: error.code ?? null
    });
  }
}
