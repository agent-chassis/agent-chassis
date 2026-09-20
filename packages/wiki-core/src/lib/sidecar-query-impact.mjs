import path from "node:path";

import {
  diffPathStates,
  normalizeGraphImpactDiffInput,
  pathsForDiffImpact
} from "./sidecar-graph-impact-diff.mjs";
import { provenance, uniqueStrings, validateImpactPath } from "./sidecar-graph-impact-shared.mjs";
import { createCompactGraphImpactSummary } from "./sidecar-graph-impact-summary.mjs";
import {
  SIDECAR_IMPACT_BOUND_CODES,
  invalidQueryInput,
  normalizeSidecarImpactInput
} from "./sidecar-query-input.mjs";
import {
  attributeAffectedFiles,
  committedEnvelopeFields,
  composeCommittedPaths,
  prepareCommittedQuery
} from "./sidecar-query-selection.mjs";
import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import { getSidecarSymbolDefinition } from "./sidecar-symbol-query.mjs";

const byText = (left, right) => left.localeCompare(right);

async function normalizedDiff(subject, targetDir) {
  if (subject.kind === "paths") return null;
  const diff = await normalizeGraphImpactDiffInput({
    repoRoot: targetDir,
    patchText: subject.kind === "patch_text" ? subject.patch_text : null,
    diffRecords: subject.kind === "diff_records" ? subject.diff_records : null,
    liveGit: subject.kind === "live_git"
  });
  const overBound = diff.invalidDiffRecords.filter(({ code }) => SIDECAR_IMPACT_BOUND_CODES.has(code));
  if (overBound.length > 0) {
    throw invalidQueryInput(`exceeds the diff bounds: ${[...new Set(overBound.map(({ code }) => code))].join(", ")}`,
      { bound_diagnostics: overBound.map(({ code, reason, source, record_index: index }) =>
        ({ code, reason, source, record_index: index })) });
  }
  return diff;
}

function endpoints(records) {
  const oldPaths = uniqueStrings(records.map((record) => record.oldPath)).sort(byText);
  const newPaths = uniqueStrings(records.map((record) => record.newPath)).sort(byText);
  return { old_paths: oldPaths, new_paths: newPaths, affected_paths: pathsForDiffImpact(records) };
}

async function narrowSubjectPaths({ narrowing, validPaths, targetDir, cacheDir }) {
  if (!narrowing) return null;
  const named = new Set();
  const sources = [];
  if (narrowing.path !== undefined) {
    const validation = validateImpactPath(narrowing.path);
    if (!validation.ok) {
      throw invalidQueryInput(`path does not narrow the subject: ${validation.hint?.reason ?? "invalid path"}`,
        { narrowing_path: narrowing.path });
    }
    named.add(validation.relative_path);
    sources.push({ kind: "path", selector: narrowing.path, paths: [validation.relative_path] });
  }
  if (narrowing.symbol !== undefined) {
    const definition = await getSidecarSymbolDefinition({ dir: targetDir, cacheDir,
      symbol: narrowing.symbol });
    const paths = uniqueStrings((Array.isArray(definition?.definitions) ? definition.definitions : [])
      .map((entry) => entry?.path).filter((value) => typeof value === "string")).sort(byText);
    for (const value of paths) named.add(value);
    sources.push({ kind: "symbol", selector: narrowing.symbol, paths,
      resolution_state: definition?.symbol_resolution?.state ?? "unresolved" });
  }
  const selected = [...named].sort(byText);
  return { selected, sources, paths: validPaths.filter((value) => named.has(value)) };
}

function impactState({ requested, validPaths, invalidPaths, graphState, diff, narrowed }) {
  const invalidRecords = diff?.invalidDiffRecords.length ?? 0;
  const unsupported = diff?.validatedDiffRecords.filter((record) => !record.supported).length ?? 0;
  const excludedByNarrowing = narrowed === null ? 0 : narrowed.excluded;
  const reasons = [
    ...(invalidPaths.length > 0 ? ["invalid_paths"] : []),
    ...(invalidRecords > 0 ? ["invalid_diff_records"] : []),
    ...(unsupported > 0 ? ["unsupported_change_kinds"] : []),
    ...(excludedByNarrowing > 0 ? ["narrowed_subject"] : []),
    ...(graphState.unavailable_paths.length > 0 ? ["graph_unavailable_paths"] : [])
  ];
  let state = "evaluated";
  if (requested.length === 0) {
    state = invalidRecords > 0 ? "invalid_input" : unsupported > 0 ? "unsupported_input" : "no_change";
  } else if (validPaths.length === 0) {

    state = excludedByNarrowing > 0 ? "no_change" : "invalid_input";
  } else if (reasons.length > 0) {
    state = "partial";
  }
  return {
    state,
    reasons: graphState.dirty_state === "clean" ? reasons : [...reasons, "dirty_worktree_excluded"],
    denominators: {
      requested_paths: requested.length,
      accepted_paths: validPaths.length,
      invalid_paths: invalidPaths.length,
      graph_unavailable_paths: graphState.unavailable_paths.length,
      ...(narrowed === null ? {} : { subject_paths_before_narrowing: narrowed.accepted_before,
        narrowing_excluded_paths: excludedByNarrowing }),
      ...(diff ? { parsed_diff_records: diff.parsedDiffRecords.length,
        valid_diff_records: diff.validatedDiffRecords.length, invalid_diff_records: invalidRecords,
        unsupported_diff_records: unsupported } : {})
    }
  };
}

export async function getSidecarQueryImpact(options = {}) {
  const input = normalizeSidecarImpactInput(options);
  const targetDir = path.resolve(String(input.dir ?? "."));
  const diff = await normalizedDiff(input.subject, targetDir);
  const requested = input.subject.kind === "paths"
    ? input.subject.paths : pathsForDiffImpact(diff.validatedDiffRecords);
  const validations = requested.map(validateImpactPath);
  const acceptedPaths = uniqueStrings(validations.filter(({ ok }) => ok)
    .map(({ relative_path: value }) => value));
  const invalidPaths = validations.filter(({ ok }) => !ok).map(({ input_path: value }) => value);
  const includeSuppressed = input.includeSuppressed === true;
  const narrowing = await narrowSubjectPaths({ narrowing: input.narrowing, validPaths: acceptedPaths,
    targetDir, cacheDir: input.cacheDir });
  const validPaths = narrowing === null ? acceptedPaths : narrowing.paths;
  const narrowed = narrowing === null ? null : { accepted_before: acceptedPaths.length,
    excluded: acceptedPaths.length - narrowing.paths.length };
  const prepared = await prepareCommittedQuery({ dir: targetDir, cacheDir: input.cacheDir });
  const composed = await composeCommittedPaths({ prepared, cacheDir: input.cacheDir, targetDir,
    validPaths, includeSuppressed });
  const { status } = prepared;
  const graphState = diff ? { ...composed.graph_state, diff_path_states: diffPathStates({
    records: diff.validatedDiffRecords, graphResult: { derived_evidence: composed.path_states,
      graph_state: composed.graph_state, dirty_state: status.dirty_state, staleness: status.staleness } }) }
    : composed.graph_state;
  const flatten = (byPath) => uniqueStrings(Object.values(byPath).flat()).sort(byText);
  const validationHints = [...(diff?.validationHints ?? []), ...validations.map(({ hint }) => hint)];
  const affectedFiles = attributeAffectedFiles(composed);
  const result = createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "path_match",
    ...committedEnvelopeFields(status),
    canonical_refs: composed.canonical_refs,
    derived_evidence: [...composed.derived_evidence,
      { kind: "sidecar_impact_query", query_kind: "impact", subject: input.subject.kind,
        input_paths: validPaths, include_suppressed: includeSuppressed,
        ...(narrowing === null ? {} : { narrowing_sources: narrowing.sources }),
        provenance: provenance({ evidenceBasis: "explicit_metadata" }) },
      ...validationHints.map((hint) => structuredClone(hint))],
    query_kind: "impact",
    input: { subject: input.subject.kind, include_suppressed: includeSuppressed,
      ...(input.narrowing ? { narrowing: structuredClone(input.narrowing) } : {}) },
    ...(narrowing === null ? {} : { narrowed_subject_paths: narrowing.selected,
      narrowing_sources: narrowing.sources }),
    ...(diff ? { input_diff_sources: diff.inputSources, parsed_diff_records: diff.parsedDiffRecords,
      validated_diff_records: diff.validatedDiffRecords, invalid_diff_records: diff.invalidDiffRecords,
      ...endpoints(diff.validatedDiffRecords) } : {}),
    input_paths: requested,
    validated_paths: validPaths,
    invalid_paths: invalidPaths,
    validation_hints: validationHints,
    affected_files: affectedFiles,
    related_code_paths: flatten(composed.related_code_paths_by_path),
    related_code_paths_by_path: composed.related_code_paths_by_path,
    likely_tests: flatten(composed.likely_tests_by_path),
    likely_tests_by_path: composed.likely_tests_by_path,
    structural_impacts: composed.impacts,
    missing_update_hints: composed.hints,
    graph_state: graphState,
    impact_state: impactState({ requested, validPaths, invalidPaths, graphState, diff, narrowed })
  });
  return {
    ...result,
    counts: {
      requested_paths: requested.length,
      validated_paths: validPaths.length,
      ...(narrowed === null ? {} : { subject_paths_before_narrowing: narrowed.accepted_before,
        narrowing_excluded_paths: narrowed.excluded }),
      invalid_paths: invalidPaths.length,
      affected_files: affectedFiles.length,
      canonical_refs: result.canonical_refs.length,
      structural_impacts: result.structural_impacts.length,
      missing_update_hints: result.missing_update_hints.length,
      likely_tests: result.likely_tests.length,
      related_code_paths: result.related_code_paths.length,
      graph_unavailable_paths: graphState.unavailable_paths.length,
      ...(diff ? { parsed_diff_records: diff.parsedDiffRecords.length,
        invalid_diff_records: diff.invalidDiffRecords.length } : {})
    },
    summary: createCompactGraphImpactSummary({ ...result, graph_nodes: composed.graph_nodes,
      graph_edges: composed.graph_edges })
  };
}
