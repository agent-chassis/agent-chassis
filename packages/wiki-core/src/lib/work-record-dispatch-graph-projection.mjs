import { isBashWrapperPath } from "./work-record-dispatch-shared.mjs";
import { validateImpactPath } from "./sidecar-graph-impact-shared.mjs";

export const SELECTED_UNIT_GRAPH_PROJECTION_SCHEMA_VERSION =
  "selected-unit-graph-projection.v1";

function normalizedPaths(values) {
  const paths = [];
  for (const value of Array.isArray(values) ? values : []) {
    const validation = validateImpactPath(value);
    if (validation.ok) paths.push(validation.relative_path);
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function isCandidateGraphPath(relativePath) {
  return (
    !relativePath.startsWith("docs/") &&
    !relativePath.startsWith("wiki/") &&
    !isBashWrapperPath(relativePath)
  );
}

export function projectSelectedUnitGraphBearingPaths({
  selectedUnit,
  subject,
  committedSourcePaths = []
} = {}) {
  const subjectPaths = normalizedPaths([
    ...(Array.isArray(subject?.write_scope) ? subject.write_scope : []),
    ...(Array.isArray(subject?.repo_paths) ? subject.repo_paths : [])
  ]);
  const committed = new Set(normalizedPaths(committedSourcePaths));
  const graphBearingPaths = [];
  const excludedPaths = [];

  for (const relativePath of subjectPaths) {
    if (!isCandidateGraphPath(relativePath)) {
      excludedPaths.push({ path: relativePath, reason: "non_graph_bearing" });
    } else if (!committed.has(relativePath)) {
      excludedPaths.push({ path: relativePath, reason: "absent_from_committed_artifact" });
    } else {
      graphBearingPaths.push(relativePath);
    }
  }

  return {
    schema_version: SELECTED_UNIT_GRAPH_PROJECTION_SCHEMA_VERSION,
    selected_unit: selectedUnit ?? null,
    subject_paths: subjectPaths,
    graph_bearing_paths: graphBearingPaths,
    excluded_paths: excludedPaths
  };
}
