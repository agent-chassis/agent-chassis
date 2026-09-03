

import { createContextualizedStructuralTargetMetrics } from "../lib/work-record-admission-derived-evidence-target-resolution.mjs";
import { createReadinessEnvelope } from "../lib/work-record-dispatch-readiness-shape.mjs";
import { SLICE_ID_PATTERN } from "../lib/work-record-schema-constants.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createRecordLevelDispatchReadiness(recordId) {
  return createReadinessEnvelope({
    recordId,
    unit: {
      kind: "work_item",
      address: recordId,
      record_id: recordId,
      slice_id: null
    },
    policy: { clusters: [], blast_radius: { level: "low", reasons: [], accepted_escalation_id: null } },
    state: { graph_available: false, dirty_state: "clean", staleness: "fresh" },
    reasons: [],
    decisionCode: "dispatchable",
    dispatchable: true,
    acceptedEscalations: [],
    canonicalRefs: [],
    derivedEvidence: [],
    validationHints: [],
    recovery: {
      graph_impact: "not_required",
      admission_metrics: "not_required",
      target_resolution: "not_required"
    }
  });
}

function parseDispatchUnitAddress(unitAddress) {
  const normalizedAddress = typeof unitAddress === "string" ? unitAddress.trim() : "";
  if (!normalizedAddress) {
    return {
      ok: false,
      error: {
        code: "invalid_record",
        message: "dispatch unit address is required",
        path: "unit"
      }
    };
  }

  const pieces = normalizedAddress.split("#");
  if (pieces.length > 2 || !/^WK-[0-9]{4}$/.test(pieces[0])) {
    return {
      ok: false,
      error: {
        code: "invalid_record",
        message: `Invalid dispatch unit address: ${normalizedAddress}`,
        path: "unit"
      }
    };
  }

  if (pieces.length === 1) {
    return {
      ok: true,
      recordId: pieces[0],
      unit: {
        kind: "work_item",
        address: pieces[0],
        record_id: pieces[0],
        slice_id: null
      }
    };
  }

  const sliceId = pieces[1];

  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return {
      ok: false,
      error: {
        code: "invalid_record",
        message: `Invalid dispatch unit slice id: ${sliceId}`,
        path: "unit"
      }
    };
  }

  return {
    ok: true,
    recordId: pieces[0],
    unit: {
      kind: "slice",
      address: normalizedAddress,
      record_id: pieces[0],
      slice_id: sliceId
    }
  };
}

function createDispatchReadinessForUnit(recordId, unit) {
  return createReadinessEnvelope({
    recordId,
    unit,
    policy: { clusters: [], blast_radius: { level: "low", reasons: [], accepted_escalation_id: null } },
    state: { graph_available: false, dirty_state: "clean", staleness: "fresh" },
    reasons: [],
    decisionCode: "dispatchable",
    dispatchable: true,
    acceptedEscalations: [],
    canonicalRefs: [],
    derivedEvidence: [],
    validationHints: [],
    recovery: {
      graph_impact: "not_required",
      admission_metrics: "not_required",
      target_resolution: "not_required"
    }
  });
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringList(values) {
  const normalized = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const entry = normalizeNonEmptyString(value);
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function isGraphImpactEnvelope(value) {
  return (
    isObject(value) &&
    (value.query_kind === "graph_impact_paths" ||
      value.query_kind === "graph_impact_diff" ||
      Object.prototype.hasOwnProperty.call(value, "graph_nodes") ||
      Object.prototype.hasOwnProperty.call(value, "graph_edges") ||
      Object.prototype.hasOwnProperty.call(value, "structural_impacts") ||
      Object.prototype.hasOwnProperty.call(value, "missing_update_hints") ||
      Object.prototype.hasOwnProperty.call(value, "summary") ||
      Object.prototype.hasOwnProperty.call(value, "validated_paths") ||
      Object.prototype.hasOwnProperty.call(value, "invalid_paths"))
  );
}

export {
  cloneJson,
  createContextualizedStructuralTargetMetrics,
  createDispatchReadinessForUnit,
  createRecordLevelDispatchReadiness,
  isGraphImpactEnvelope,
  isObject,
  normalizeNonEmptyString,
  normalizeStringList,
  parseDispatchUnitAddress
};
