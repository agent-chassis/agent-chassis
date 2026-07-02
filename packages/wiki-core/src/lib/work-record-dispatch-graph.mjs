

import { getForbiddenSidecarPathMatch } from "./sidecar-paths.mjs";
import {
  SIDECAR_DIRTY_GRAPH_MODE_VALUES,
  SIDECAR_GRAPH_EDGE_SOURCE_VALUES,
  SIDECAR_GRAPH_SCHEMA_VERSION
} from "./sidecar-graph-schema.mjs";
import { WORK_RECORD_GRAPH_INLINE_REF_KIND } from "./work-record-graph-evidence-sidecar.mjs";
import { SIDECAR_STALENESS_VALUES } from "./sidecar-schema.mjs";
import {
  clone,
  hasOwn,
  isBashWrapperPath,
  isNonEmptyString,
  isObject,
  stringifyPathList
} from "./work-record-dispatch-shared.mjs";

const CANONICAL_REF_SOURCE_KINDS = new Set([
  "canonical_docs",
  "canonical_wiki",
  "issue",
  "decision",
  "area"
]);

const NON_CANONICAL_PROVENANCE_CANONICALITIES = new Set([
  "derived",
  "generated",
  "external",
  "unknown"
]);

const CANONICAL_AUTHORITY_PROVENANCE_EVIDENCE_BASIS = new Set([
  "explicit_metadata",
  "path_match",
  "docs_backlink"
]);

const GENERATED_WIKI_VIEW_FORBIDDEN_REASON = "generated wiki view";

export function isCanonicalGraphImpactRef(entry) {
  if (!isObject(entry)) {
    return false;
  }
  if (isGeneratedWikiViewGraphImpactRef(entry)) {
    return false;
  }
  if (hasOwn(entry, "canonicality") && entry.canonicality !== "canonical") {
    return false;
  }
  if (!isNonEmptyString(entry.source_kind)) {
    return false;
  }
  if (!CANONICAL_REF_SOURCE_KINDS.has(entry.source_kind)) {
    return false;
  }
  if (!isObject(entry.provenance)) {
    return false;
  }
  const provenance = entry.provenance;
  if (NON_CANONICAL_PROVENANCE_CANONICALITIES.has(provenance.canonicality)) {
    return false;
  }
  if (provenance.canonicality !== "canonical") {
    return false;
  }
  if (!isNonEmptyString(provenance.source_kind)) {
    return false;
  }
  if (!CANONICAL_REF_SOURCE_KINDS.has(provenance.source_kind)) {
    return false;
  }
  if (provenance.source_kind !== entry.source_kind) {
    return false;
  }
  if (!isNonEmptyString(provenance.evidence_basis)) {
    return false;
  }
  if (!CANONICAL_AUTHORITY_PROVENANCE_EVIDENCE_BASIS.has(provenance.evidence_basis)) {
    return false;
  }
  return true;
}

export function isGeneratedWikiViewGraphImpactRef(entry) {
  const candidatePath = isNonEmptyString(entry.path)
    ? entry.path
    : isNonEmptyString(entry.provenance?.path)
      ? entry.provenance.path
      : null;
  if (!candidatePath) {
    return false;
  }

  return (
    getForbiddenSidecarPathMatch(candidatePath)?.reason === GENERATED_WIKI_VIEW_FORBIDDEN_REASON
  );
}

export function normalizeGraphState(graphState = null) {
  const emptyState = {
    dirty_state: "unknown",
    staleness: "unknown",
    graph_available: false,
    edge_source: "unavailable",
    dirty_graph_mode: "unavailable",
    graph_schema_version: null,
    unavailable_paths: []
  };

  if (isObject(graphState)) {
    const source = isGraphImpactEnvelope(graphState) && isObject(graphState.graph_state)
      ? { ...graphState, ...graphState.graph_state }
      : graphState;
    const graphAvailable = Boolean(source.graph_available);
    const edgeSource = isNonEmptyString(source.edge_source) &&
      SIDECAR_GRAPH_EDGE_SOURCE_VALUES.includes(source.edge_source)
      ? source.edge_source
      : "unavailable";
    const dirtyGraphMode = isNonEmptyString(source.dirty_graph_mode) &&
      SIDECAR_DIRTY_GRAPH_MODE_VALUES.includes(source.dirty_graph_mode)
      ? source.dirty_graph_mode
      : "unavailable";
    const staleness = isNonEmptyString(source.staleness) &&
      SIDECAR_STALENESS_VALUES.includes(source.staleness)
      ? source.staleness
      : "unknown";
    const graphSchemaVersion = isNonEmptyString(source.graph_schema_version)
      ? source.graph_schema_version
      : null;
    const unavailablePaths = stringifyPathList(source.unavailable_paths);

    if (
      graphAvailable &&
      (edgeSource === "unavailable" ||
        dirtyGraphMode === "unavailable" ||
        staleness === "unknown" ||
        graphSchemaVersion !== SIDECAR_GRAPH_SCHEMA_VERSION ||
        (hasOwn(source, "unavailable_paths") && !Array.isArray(source.unavailable_paths)))
    ) {
      return emptyState;
    }

    return {
      dirty_state: source.dirty_state ?? "unknown",
      staleness,
      graph_available: graphAvailable,
      edge_source: edgeSource,
      dirty_graph_mode: dirtyGraphMode,
      graph_schema_version: graphSchemaVersion,
      unavailable_paths: unavailablePaths
    };
  }

  return emptyState;
}

export function isGraphImpactEnvelope(value) {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.query_kind === "graph_impact_paths" ||
    value.query_kind === "graph_impact_diff" ||
    hasOwn(value, "graph_nodes") ||
    hasOwn(value, "graph_edges") ||
    hasOwn(value, "structural_impacts") ||
    hasOwn(value, "missing_update_hints") ||
    hasOwn(value, "summary") ||
    hasOwn(value, "validated_paths") ||
    hasOwn(value, "invalid_paths")
  );
}

export function normalizeGraphImpactEvidence(graphImpact = null) {
  if (!isGraphImpactEnvelope(graphImpact)) {
    return null;
  }

  return {
    query_kind: isNonEmptyString(graphImpact.query_kind) ? graphImpact.query_kind : null,
    input_paths: stringifyPathList(graphImpact.input_paths),
    validated_paths: stringifyPathList(graphImpact.validated_paths),
    invalid_paths: stringifyPathList(graphImpact.invalid_paths),
    graph_state: normalizeGraphState(graphImpact),
    summary: isObject(graphImpact.summary) ? clone(graphImpact.summary) : null,
    record_id: isNonEmptyString(graphImpact.record_id) ? graphImpact.record_id : null,
    slice_id: isNonEmptyString(graphImpact.slice_id) ? graphImpact.slice_id : null,
    unit: isObject(graphImpact.unit) ? clone(graphImpact.unit) : null
  };
}

function compactInlineGraphRefCandidate(ref, entry) {
  if (!isObject(ref) || ref.kind !== WORK_RECORD_GRAPH_INLINE_REF_KIND) {
    return null;
  }

  const graphState = isObject(ref.graph_state) ? ref.graph_state : null;
  if (!graphState || graphState.graph_available !== true) {
    return null;
  }

  const unavailableCount = Number(graphState.unavailable_path_count);
  if (Number.isFinite(unavailableCount) && unavailableCount > 0) {
    return null;
  }

  const refDigest = isNonEmptyString(ref.source_record_digest)
    ? ref.source_record_digest
    : null;
  const entryDigest = isNonEmptyString(entry?.source_record_digest)
    ? entry.source_record_digest
    : null;
  if (refDigest && entryDigest && refDigest !== entryDigest) {
    return null;
  }

  return {
    query_kind: isNonEmptyString(ref.query_kind) ? ref.query_kind : "graph_impact_paths",
    input_paths: Array.isArray(ref.input_paths) ? clone(ref.input_paths) : [],
    validated_paths: Array.isArray(ref.validated_paths) ? clone(ref.validated_paths) : [],
    invalid_paths: [],
    graph_state: { ...graphState },
    summary: null,
    record_id: isNonEmptyString(ref.record_id) ? ref.record_id : null,
    slice_id: isNonEmptyString(ref.slice_id) ? ref.slice_id : null,
    unit: isObject(ref.unit) ? clone(ref.unit) : null,
    source_record_digest: refDigest ?? entryDigest ?? null
  };
}

export function collectStoredGraphImpactCandidates(entry) {
  if (!isObject(entry)) {
    return [];
  }

  const candidates = [];
  if (isGraphImpactEnvelope(entry)) {
    candidates.push(entry);
  }

  for (const candidate of [
    entry.graph_impact,
    entry.graphImpact,
    entry.graph_evidence,
    entry.feature_vector?.graph_evidence,
    entry.normalized_request?.evidence?.feature_vector?.graph_evidence,
    entry.normalized_request?.feature_vector?.graph_evidence
  ]) {
    if (isObject(candidate)) {
      candidates.push(candidate);
    }
  }

  for (const refSource of [entry, entry.graph_impact_summary_ref, entry.graphImpactSummaryRef]) {
    const synthesized = compactInlineGraphRefCandidate(refSource, entry);
    if (synthesized) {
      candidates.push(synthesized);
    }
  }

  return candidates;
}

export function matchesDispatchUnit(candidateUnit, unit) {
  if (!isObject(candidateUnit) || !isObject(unit) || !isNonEmptyString(unit.record_id)) {
    return false;
  }

  if (candidateUnit.record_id !== unit.record_id) {
    return false;
  }

  if (unit.kind === "slice") {
    return candidateUnit.kind === "slice" && candidateUnit.slice_id === unit.slice_id;
  }

  return candidateUnit.kind === "work_item" && !isNonEmptyString(candidateUnit.slice_id);
}

export function matchesDispatchUnitAddress(candidateUnit, unit) {
  return isObject(candidateUnit) && isObject(unit) && candidateUnit.address === unit.address;
}

export function resolveStoredGraphImpactEvidence(record, subject, unit, currentSourceDigest = null) {
  let candidatePresent = false;

  for (const entry of Array.isArray(record?.derived_evidence) ? record.derived_evidence : []) {
    const derivedEvidenceUnit = isObject(entry?.unit) ? entry.unit : null;
    if (
      derivedEvidenceUnit &&
      (!matchesDispatchUnit(derivedEvidenceUnit, unit) ||
        !matchesDispatchUnitAddress(derivedEvidenceUnit, unit))
    ) {
      continue;
    }

    const entryDigest = isNonEmptyString(entry?.source_record_digest)
      ? entry.source_record_digest
      : null;
    const digestMatches =
      isNonEmptyString(currentSourceDigest) && entryDigest === currentSourceDigest;

    for (const candidate of collectStoredGraphImpactCandidates(entry)) {
      candidatePresent = true;
      if (!digestMatches) {
        continue;
      }
      const normalized = normalizeGraphImpactEvidence(candidate);
      if (normalized && graphImpactMatchesSubject(normalized, subject, unit, derivedEvidenceUnit)) {
        return {
          graphImpact: normalized,
          present: true
        };
      }
    }
  }

  return {
    graphImpact: null,
    present: candidatePresent
  };
}

export function evidencePathMatchesSubjectPath(subjectPath, evidencePath) {
  if (subjectPath === evidencePath) {
    return true;
  }
  if (typeof subjectPath !== "string" || !subjectPath.endsWith("/")) {
    return false;
  }
  if (typeof evidencePath !== "string") {
    return false;
  }
  return evidencePath.startsWith(subjectPath);
}

export function subjectPathBlocksUnavailablePath(subjectPath, unavailablePath) {
  if (!isNonEmptyString(subjectPath) || !isNonEmptyString(unavailablePath)) {
    return false;
  }

  if (subjectPath === unavailablePath) {
    return true;
  }

  if (!subjectPath.endsWith("/")) {
    return false;
  }

  return evidencePathMatchesSubjectPath(subjectPath, unavailablePath);
}

export function graphImpactHasUnavailableSubjectPath(graphImpact, subjectPaths) {
  const unavailablePaths = stringifyPathList(graphImpact?.graph_state?.unavailable_paths);
  if (unavailablePaths.length === 0 || !Array.isArray(subjectPaths) || subjectPaths.length === 0) {
    return false;
  }

  return subjectPaths.some((subjectPath) =>
    unavailablePaths.some((unavailablePath) => subjectPathBlocksUnavailablePath(subjectPath, unavailablePath))
  );
}

export function graphStateHasUnavailableSubjectPath(graphState, subjectPaths) {
  return graphImpactHasUnavailableSubjectPath({ graph_state: graphState }, subjectPaths);
}

export function isDirtyOverlayCompatibleGraphState(graphState) {
  return Boolean(
    isObject(graphState) &&
      graphState.dirty_state === "dirty_worktree" &&
      graphState.graph_available === true &&
      graphState.edge_source === "dirty_overlay" &&
      graphState.dirty_graph_mode === "overlay_parsed"
  );
}

export function graphImpactMatchesSubject(graphImpact, subject, unit, scopeUnit = null) {
  if (!isObject(graphImpact) || !graphImpact.graph_state?.graph_available) {
    return false;
  }

  if (isObject(scopeUnit) && !matchesDispatchUnit(scopeUnit, unit)) {
    return false;
  }

  const subjectPaths = collectGraphImpactSubjectPaths(subject);

  const graphBearingSubjectPaths = subjectPaths.filter(
    (subjectPath) => !isBashWrapperPath(subjectPath)
  );
  const evidencePaths = stringifyPathList([
    ...(Array.isArray(graphImpact.validated_paths) ? graphImpact.validated_paths : []),
    ...(Array.isArray(graphImpact.input_paths) ? graphImpact.input_paths : [])
  ]);

  if (evidencePaths.length === 0) {
    return false;
  }

  if (
    graphBearingSubjectPaths.length > 0 &&
    graphImpactHasUnavailableSubjectPath(graphImpact, graphBearingSubjectPaths)
  ) {
    return false;
  }

  const subjectRecordId =
    isObject(unit) && isNonEmptyString(unit.record_id) ? unit.record_id : subject?.id;

  if (isNonEmptyString(graphImpact.record_id) && graphImpact.record_id !== subjectRecordId) {
    return false;
  }

  if (isObject(graphImpact.unit)) {
    if (isNonEmptyString(graphImpact.unit.record_id) && graphImpact.unit.record_id !== subjectRecordId) {
      return false;
    }
  }

  if (graphBearingSubjectPaths.length === 0) {
    return true;
  }

  const everySubjectCovered = graphBearingSubjectPaths.every((subjectPath) =>
    evidencePaths.some((evidencePath) => evidencePathMatchesSubjectPath(subjectPath, evidencePath))
  );
  if (!everySubjectCovered) {
    return false;
  }

  if (!isObject(scopeUnit)) {
    const nestedSliceId = isObject(graphImpact.unit) && isNonEmptyString(graphImpact.unit.slice_id)
      ? graphImpact.unit.slice_id
      : null;
    const topLevelSliceId = isNonEmptyString(graphImpact.slice_id) ? graphImpact.slice_id : null;
    const evidenceSliceId = nestedSliceId ?? topLevelSliceId;

    if (evidenceSliceId !== null) {
      if (unit?.kind === "slice") {
        return evidenceSliceId === unit.slice_id;
      }
      if (unit?.kind === "work_item") {
        return false;
      }
    }
  }

  return true;
}

function collectGraphImpactPathsFromInputs(inputPaths) {
  const collectedPaths = [];
  for (const inputPath of Array.isArray(inputPaths) ? inputPaths : []) {
    if (!isNonEmptyString(inputPath)) {
      continue;
    }

    const pathKind = inputPath.startsWith("docs/")
      ? "docs_contract"
      : inputPath.startsWith("wiki/")
        ? "wiki_record"
        : inputPath.startsWith("tests/") || inputPath.includes(".test.")
          ? "test_path"
          : "implementation_path";

    if (pathKind === "implementation_path" || pathKind === "test_path") {
      collectedPaths.push(inputPath);
    }
  }

  return stringifyPathList(collectedPaths);
}

export function collectGraphImpactSubjectPaths(subject) {
  const writeScopePaths = Array.isArray(subject?.write_scope) ? subject.write_scope : [];

  if (writeScopePaths.length > 0) {
    return collectGraphImpactPathsFromInputs(writeScopePaths);
  }

  return collectGraphImpactPathsFromInputs(
    Array.isArray(subject?.repo_paths) ? subject.repo_paths : []
  );
}
