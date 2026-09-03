

import { isObject, normalizeStringEntry } from "./work-record-admission-shared.mjs";

const RELATIONSHIP_FIELDS = Object.freeze(["depends_on", "related", "blocks"]);

export function unitReferenceCandidates(unit) {

  if (unit.kind === "slice") {
    return new Set([unit.address, `${unit.record_id}#${unit.slice_id}`]);
  }
  return new Set([unit.address, unit.record_id]);
}

export function unitRecordReferencesUnit(unitRecord, targetUnit) {
  if (!isObject(unitRecord) || !isObject(targetUnit)) {
    return false;
  }
  const targetRefs = unitReferenceCandidates(targetUnit);
  for (const fieldName of RELATIONSHIP_FIELDS) {
    const values = Array.isArray(unitRecord[fieldName]) ? unitRecord[fieldName] : [];
    for (const value of values) {
      const ref = normalizeStringEntry(value);
      if (ref && targetRefs.has(ref)) {
        return true;
      }
    }
  }
  return false;
}

export function unitsHaveDurableRelationship(leftRecord, leftUnit, rightRecord, rightUnit) {
  return unitRecordReferencesUnit(leftRecord, rightUnit) ||
    unitRecordReferencesUnit(rightRecord, leftUnit);
}

export function describeUnitBindingShape(targetUnit, options = {}) {
  const address = isObject(targetUnit) ? normalizeStringEntry(targetUnit.address) : null;
  const named = address ? `exactly \`${address}\`` : "the selected unit's exact address";
  void options;
  return `a depends_on, related, or blocks entry naming ${named}, on either unit and in either direction`;
}
