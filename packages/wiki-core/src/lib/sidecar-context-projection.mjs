import { SIDECAR_DIRTY_DETAIL_FIELDS } from "./sidecar-schema.mjs";

export const SIDECAR_CONTEXT_FRESHNESS_BASIS = "committed_artifact_head_anchor";
export const SIDECAR_CONTEXT_GRAPH_BASIS = "committed_head_only";
export const SIDECAR_CONTEXT_DIRTY_DETAILS_COUNTING =
  "overlapping_categories_not_unique_file_total";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function observedCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function observedDirtyDetail(field, value) {
  if (field === "detached_head") {
    return typeof value === "boolean" ? value : null;
  }
  return observedCount(value);
}

function contextDirtyDetails(envelope) {
  const stateWasObserved = envelope?.dirty_state === "clean" ||
    envelope?.dirty_state === "dirty_worktree";
  const details = stateWasObserved && isPlainObject(envelope?.dirty_details)
    ? envelope.dirty_details
    : null;
  return Object.fromEntries(
    SIDECAR_DIRTY_DETAIL_FIELDS.map((field) => [
      field,
      details && Object.prototype.hasOwnProperty.call(details, field)
        ? observedDirtyDetail(field, details[field])
        : null
    ])
  );
}

function contextOverlayEvidence(envelope) {
  return Array.isArray(envelope?.derived_evidence)
    ? envelope.derived_evidence.find(
        (entry) => entry?.kind === "sidecar_dirty_worktree_overlay"
      ) ?? null
    : null;
}

function contextOverlayQualification(overlayState) {
  if (overlayState === "included") {
    return "git_visible_source_population_for_path_context_only";
  }
  if (overlayState === "not_applicable") {
    return "not_applicable_clean_worktree";
  }
  if (overlayState === "unavailable") {
    return "unavailable";
  }
  return "unknown";
}

export function createSidecarContextTrustProjection(envelope) {
  const overlayState = typeof envelope?.overlay_state === "string"
    ? envelope.overlay_state
    : "unknown";
  const overlayEvidence = contextOverlayEvidence(envelope);
  const overlayIncluded = overlayState === "included";
  const sourcePopulationCount = overlayIncluded
    ? observedCount(envelope?.overlay_source_count)
    : null;

  return {
    dirty_details: contextDirtyDetails(envelope),
    freshness_basis: SIDECAR_CONTEXT_FRESHNESS_BASIS,
    graph_basis: SIDECAR_CONTEXT_GRAPH_BASIS,
    dirty_details_counting: SIDECAR_CONTEXT_DIRTY_DETAILS_COUNTING,
    overlay_state: overlayState,
    overlay_source_count: sourcePopulationCount,
    overlay_coverage: {
      qualification: contextOverlayQualification(overlayState),
      source_population_count: sourcePopulationCount,
      dirty_path_count: overlayIncluded
        ? observedCount(overlayEvidence?.dirty_path_count)
        : null,
      dirty_source_path_count: overlayIncluded
        ? observedCount(overlayEvidence?.dirty_source_path_count)
        : null,
      committed_semantic_graph_participation: "excluded"
    }
  };
}
