

import {
  cloneJson,
  isGraphImpactEnvelope,
  isObject,
  normalizeNonEmptyString,
  normalizeStringList
} from "./work-records-shared.mjs";
import {
  SIDECAR_DIRTY_GRAPH_MODE_VALUES,
  SIDECAR_GRAPH_EDGE_SOURCE_VALUES,
  SIDECAR_GRAPH_SCHEMA_VERSION
} from "../lib/sidecar-graph-schema.mjs";
import { SIDECAR_DIRTY_STATE_VALUES, SIDECAR_STALENESS_VALUES } from "../lib/sidecar-schema.mjs";

export function createInvalidGraphImpactPersistResult({ recordId = null, diagnostics = [] } = {}) {
  return {
    record_id: recordId,
    source_path: null,
    source_path_relative: null,
    source_digest: null,
    record: null,
    diagnostics,
    graph_impact: null,
    derived_evidence: null,
    valid: false,
    written: false,
    canonical_record_path: null
  };
}

function normalizePersistedGraphImpactState(graphState) {
  if (!isObject(graphState)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.graph_state must be an object",
        path: "graph_impact.graph_state"
      },
      graph_state: null
    };
  }

  const graphAvailable = Boolean(graphState.graph_available);
  const edgeSource = normalizeNonEmptyString(graphState.edge_source) || "unavailable";
  const dirtyGraphMode = normalizeNonEmptyString(graphState.dirty_graph_mode) || "unavailable";
  const staleness = normalizeNonEmptyString(graphState.staleness) || "unknown";
  const graphSchemaVersion = normalizeNonEmptyString(graphState.graph_schema_version);
  const unavailablePaths = normalizeStringList(graphState.unavailable_paths);
  const dirtyState = normalizeNonEmptyString(graphState.dirty_state) || "unknown";

  if (!SIDECAR_DIRTY_STATE_VALUES.includes(dirtyState)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.graph_state.dirty_state is malformed",
        path: "graph_impact.graph_state.dirty_state"
      },
      graph_state: null
    };
  }
  if (!SIDECAR_STALENESS_VALUES.includes(staleness)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.graph_state.staleness is malformed",
        path: "graph_impact.graph_state.staleness"
      },
      graph_state: null
    };
  }
  if (!SIDECAR_GRAPH_EDGE_SOURCE_VALUES.includes(edgeSource)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.graph_state.edge_source is malformed",
        path: "graph_impact.graph_state.edge_source"
      },
      graph_state: null
    };
  }
  if (!SIDECAR_DIRTY_GRAPH_MODE_VALUES.includes(dirtyGraphMode)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.graph_state.dirty_graph_mode is malformed",
        path: "graph_impact.graph_state.dirty_graph_mode"
      },
      graph_state: null
    };
  }
  if (graphSchemaVersion !== SIDECAR_GRAPH_SCHEMA_VERSION) {
    return {
      issue: {
        code: "invalid_record",
        message: `graph_impact.graph_state.graph_schema_version must be ${SIDECAR_GRAPH_SCHEMA_VERSION}`,
        path: "graph_impact.graph_state.graph_schema_version"
      },
      graph_state: null
    };
  }

  if (
    graphAvailable &&
    (edgeSource === "unavailable" ||
      dirtyGraphMode === "unavailable" ||
      staleness === "unknown" ||
      (Object.prototype.hasOwnProperty.call(graphState, "unavailable_paths") &&
        !Array.isArray(graphState.unavailable_paths)))
  ) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.graph_state is malformed",
        path: "graph_impact.graph_state"
      },
      graph_state: null
    };
  }

  return {
    issue: null,
    graph_state: {
      dirty_state: dirtyState,
      staleness,
      graph_available: graphAvailable,
      edge_source: edgeSource,
      dirty_graph_mode: dirtyGraphMode,
      graph_schema_version: graphSchemaVersion,
      unavailable_paths: unavailablePaths
    }
  };
}

function mergeTrustEnvelopeIntoGraphState(graphImpact) {
  if (!isObject(graphImpact) || !isObject(graphImpact.graph_state)) {
    return graphImpact?.graph_state;
  }
  const merged = { ...graphImpact.graph_state };
  if (!Object.prototype.hasOwnProperty.call(merged, "dirty_state") && typeof graphImpact.dirty_state === "string") {
    merged.dirty_state = graphImpact.dirty_state;
  }
  if (!Object.prototype.hasOwnProperty.call(merged, "staleness") && typeof graphImpact.staleness === "string") {
    merged.staleness = graphImpact.staleness;
  }
  return merged;
}

export function normalizePersistedGraphImpact(graphImpact) {
  if (!isGraphImpactEnvelope(graphImpact)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact must be a graph-impact envelope",
        path: "graph_impact"
      },
      graph_impact: null
    };
  }

  const queryKind = normalizeNonEmptyString(graphImpact.query_kind);
  if (!queryKind) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.query_kind is required",
        path: "graph_impact.query_kind"
      },
      graph_impact: null
    };
  }

  if (Object.prototype.hasOwnProperty.call(graphImpact, "input_paths") && !Array.isArray(graphImpact.input_paths)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.input_paths must be an array",
        path: "graph_impact.input_paths"
      },
      graph_impact: null
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(graphImpact, "validated_paths") &&
    !Array.isArray(graphImpact.validated_paths)
  ) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.validated_paths must be an array",
        path: "graph_impact.validated_paths"
      },
      graph_impact: null
    };
  }
  if (Object.prototype.hasOwnProperty.call(graphImpact, "invalid_paths") && !Array.isArray(graphImpact.invalid_paths)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.invalid_paths must be an array",
        path: "graph_impact.invalid_paths"
      },
      graph_impact: null
    };
  }
  if (Object.prototype.hasOwnProperty.call(graphImpact, "summary") && graphImpact.summary !== null && !isObject(graphImpact.summary)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.summary must be an object or null",
        path: "graph_impact.summary"
      },
      graph_impact: null
    };
  }
  if (Object.prototype.hasOwnProperty.call(graphImpact, "unit") && graphImpact.unit !== null && !isObject(graphImpact.unit)) {
    return {
      issue: {
        code: "invalid_record",
        message: "graph_impact.unit must be an object or null",
        path: "graph_impact.unit"
      },
      graph_impact: null
    };
  }

  const state = normalizePersistedGraphImpactState(
    mergeTrustEnvelopeIntoGraphState(graphImpact)
  );
  if (state.issue) {
    return state;
  }

  const graphImpactRecordId = normalizeNonEmptyString(graphImpact.record_id);
  const graphImpactSliceId = normalizeNonEmptyString(graphImpact.slice_id);
  const graphImpactSourceDigest = normalizeNonEmptyString(graphImpact.source_record_digest);

  return {
    issue: null,
    graph_impact: {
      query_kind: queryKind,
      input_paths: normalizeStringList(graphImpact.input_paths),
      validated_paths: normalizeStringList(graphImpact.validated_paths),
      invalid_paths: normalizeStringList(graphImpact.invalid_paths),
      graph_state: state.graph_state,
      summary: graphImpact.summary === undefined ? null : cloneJson(graphImpact.summary),
      record_id: graphImpactRecordId,
      slice_id: graphImpactSliceId,
      unit: graphImpact.unit === undefined ? null : cloneJson(graphImpact.unit),
      source_record_digest: graphImpactSourceDigest
    }
  };
}
