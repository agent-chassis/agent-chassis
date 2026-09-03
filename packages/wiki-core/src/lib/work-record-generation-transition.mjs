

const TRANSITION_SCHEMA = "work_record_generation_transition.v1";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function selectedRecord(record, selectedUnit) {
  if (!isObject(record) || !isObject(selectedUnit)) return null;
  if (selectedUnit.kind === "slice") {
    return Array.isArray(record.slices)
      ? record.slices.find((slice) => slice?.id === selectedUnit.slice_id) ?? null
      : null;
  }
  return record;
}

function purposeForUnit(unit) {
  if (!unit) {
    return {
      existence: "absent",
      work_kind: null,
      dispatch_intent: null,
      review_purpose: null,
      write_posture: null
    };
  }

  const dispatch = isObject(unit.dispatch_intent) ? unit.dispatch_intent : {};
  return {
    existence: "present",
    work_kind: unit.work_kind ?? null,
    dispatch_intent: {
      intended_agent_role: dispatch.intended_agent_role ?? null,
      target_unit: dispatch.target_unit ?? null
    },
    review_purpose: unit.work_kind === "review" ? unit.review_purpose ?? null : null,
    write_posture:
      Array.isArray(unit.write_scope) && unit.write_scope.length === 0
        ? "findings_only"
        : "write_bearing"
  };
}

export function projectUnitPurpose(canonicalRecord, selectedUnit) {
  return purposeForUnit(selectedRecord(canonicalRecord, selectedUnit));
}

function completedBeforeMutation(beforeRecord, selectedUnit) {
  if (beforeRecord?.status === "done") return true;
  return selectedUnit?.kind === "slice" && selectedRecord(beforeRecord, selectedUnit)?.status === "done";
}

export function classifyWorkRecordGenerationTransition(selectedUnit, beforeRecord, afterRecord) {
  const beforeUnit = selectedRecord(beforeRecord, selectedUnit);
  const afterUnit = selectedRecord(afterRecord, selectedUnit);
  const beforePurpose = purposeForUnit(beforeUnit);
  const afterPurpose = purposeForUnit(afterUnit);
  const unitChanged = !equalJson(beforeUnit, afterUnit);
  const purposeChanged = !equalJson(beforePurpose, afterPurpose);

  let transition = "unchanged";
  if (unitChanged && completedBeforeMutation(beforeRecord, selectedUnit)) {
    transition = "completed_revision";
  } else if (purposeChanged) {
    transition = "new_generation";
  }

  return {
    schema_version: TRANSITION_SCHEMA,
    selected_unit: selectedUnit ?? null,
    before_purpose: beforePurpose,
    after_purpose: afterPurpose,
    transition,
    contract_dependent_artifacts_require_reassessment: transition === "new_generation",
    persisted: false,
    written: false,
    no_op: false
  };
}

export function projectWorkRecordGenerationTransition(
  classification,
  { persisted = false, written = false, noOp = false } = {}
) {
  return {
    ...classification,
    persisted: Boolean(persisted),
    written: Boolean(written),
    no_op: Boolean(noOp)
  };
}

export { TRANSITION_SCHEMA as WORK_RECORD_GENERATION_TRANSITION_SCHEMA };
