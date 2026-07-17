

import { normalizeStructuralTargetMetrics } from "../lib/work-record-target-metrics.mjs";
import { resolveStructuralTargetResolverEvidenceFromExpectedEditTarget } from "../lib/work-record-target-resolver.mjs";
import { SLICE_ID_PATTERN } from "../lib/work-record-schema-constants.mjs";

const WORK_RECORD_LOCAL_TARGET_FUNCTION_RESOLVER_PROVIDER = Object.freeze({
  id: "portfolio-local.target-function-resolver",
  version: "0.1.0",
  mode: "local"
});

const WORK_RECORD_LOCAL_AGGREGATE_TARGET_RESOLVER_PRODUCER = Object.freeze({
  id: "portfolio-local.target-resolver",
  version: "0.1.0",
  mode: "local"
});

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRepoPathKey(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().replaceAll("\\", "/").replace(/^\.\//u, "")
    : null;
}

function buildLocalTargetResolutionEvidence({
  expectedEditTargets,
  sourceTexts,
  selectedUnit,
  sourceRecordDigest
}) {
  const targetSourceTexts = isObject(sourceTexts) ? sourceTexts : {};
  const entries = expectedEditTargets.map((target) => {
    const repoPath = isObject(target) ? normalizeRepoPathKey(target.path) : null;
    const sourceText =
      repoPath && typeof targetSourceTexts[repoPath] === "string" ? targetSourceTexts[repoPath] : null;
    return resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(
      {
        target,
        source_text: sourceText,
        source_record_digest: sourceRecordDigest,
        selected_unit: selectedUnit,
        provider: WORK_RECORD_LOCAL_TARGET_FUNCTION_RESOLVER_PROVIDER
      },
      { hasExpectedEditTargets: true }
    );
  });

  const allTargetsEvaluated =
    entries.length > 0 &&
    entries.every((entry) => entry.target_resolution_status !== "provider_unavailable");

  return {
    status: allTargetsEvaluated ? "present" : "degraded",
    source_record_digest: sourceRecordDigest,
    selected_unit: selectedUnit,

    ...(allTargetsEvaluated ? { producer: WORK_RECORD_LOCAL_AGGREGATE_TARGET_RESOLVER_PRODUCER } : {}),
    targets: entries
  };
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createRecordLevelDispatchReadiness(recordId) {
  return {
    schema_version: "dispatch-readiness.v1",
    record_id: recordId,
    unit: {
      kind: "work_item",
      address: recordId,
      record_id: recordId,
      slice_id: null
    },
    decision_code: "dispatchable",
    dispatchable: true,
    clusters: [],
    state: {
      graph_available: false,
      dirty_state: "clean",
      staleness: "fresh",
      graph_state: {
        graph_available: false,
        edge_source: "unavailable",
        dirty_graph_mode: "unavailable",
        unavailable_paths: []
      }
    },
    reasons: [],
    accepted_escalations: [],
    blast_radius: {
      level: "low",
      reasons: [],
      accepted_escalation_id: null
    }
  };
}

function createContextualizedStructuralTargetMetrics(subject, localInputs, selectedUnit, sourceRecordDigest) {

  const expectedEditTargets =
    Array.isArray(subject?.expected_edit_targets) && subject.expected_edit_targets.length > 0
      ? subject.expected_edit_targets
      : Array.isArray(localInputs?.effective_expected_edit_targets)
        ? localInputs.effective_expected_edit_targets
        : [];
  const hasExpectedEditTargets = expectedEditTargets.length > 0;

  const bindingSourceRecordDigest =
    isObject(localInputs) &&
    typeof localInputs.source_record_digest === "string" &&
    localInputs.source_record_digest.trim().length > 0
      ? localInputs.source_record_digest
      : sourceRecordDigest;

  const localTargetResolutionEvidence = hasExpectedEditTargets
    ? buildLocalTargetResolutionEvidence({
        expectedEditTargets,
        sourceTexts: localInputs?.expected_edit_target_source_texts,
        selectedUnit,
        sourceRecordDigest: bindingSourceRecordDigest
      })
    : undefined;

  return normalizeStructuralTargetMetrics({
    expected_edit_targets: hasExpectedEditTargets ? expectedEditTargets : undefined,
    target_resolution_evidence: localTargetResolutionEvidence,
    write_scope: Array.isArray(subject?.write_scope) ? subject.write_scope : [],
    file_stats: Array.isArray(localInputs?.file_stats) ? localInputs.file_stats : [],
    metric_source_provenance: isObject(localInputs?.metric_source_provenance)
      ? localInputs.metric_source_provenance
      : undefined,
    unit: selectedUnit,
    source_record_digest: bindingSourceRecordDigest
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
  return {
    schema_version: "dispatch-readiness.v1",
    record_id: recordId,
    unit,
    decision_code: "dispatchable",
    dispatchable: true,
    clusters: [],
    state: {
      graph_available: false,
      dirty_state: "clean",
      staleness: "fresh",
      graph_state: {
        graph_available: false,
        edge_source: "unavailable",
        dirty_graph_mode: "unavailable",
        unavailable_paths: []
      }
    },
    reasons: [],
    accepted_escalations: [],
    blast_radius: {
      level: "low",
      reasons: [],
      accepted_escalation_id: null
    }
  };
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
