import path from "node:path";

import { createSidecarContextTrustProjection } from "./sidecar-context-projection.mjs";
import { provenance } from "./sidecar-graph-impact-shared.mjs";
import { readCompleteFiles } from "./sidecar-occurrence-source.mjs";
import { normalizeSidecarContextInput } from "./sidecar-query-input.mjs";
import {
  attributeAffectedFiles,
  committedEnvelopeFields,
  composeCommittedPaths,
  prepareCommittedQuery
} from "./sidecar-query-selection.mjs";
import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";

export async function getSidecarContextForPath(options = {}) {
  const input = normalizeSidecarContextInput(options);
  const targetDir = path.resolve(String(input.dir ?? "."));
  const includeSuppressed = input.includeSuppressed === true;
  const prepared = await prepareCommittedQuery({ dir: targetDir, cacheDir: input.cacheDir });
  const composed = await composeCommittedPaths({ prepared, cacheDir: input.cacheDir, targetDir,
    validPaths: [input.path], includeSuppressed });
  const descriptor = composed.selection.files.find((file) => file.path === input.path) ?? null;
  const files = await readCompleteFiles(prepared.repoRoot, [input.path],
    new Map(descriptor ? [[input.path, descriptor]] : []));
  const source = files.get(input.path).entry;
  const { status } = prepared;
  const affectedFiles = attributeAffectedFiles(composed);
  const relatedCodePaths = composed.related_code_paths_by_path[input.path];
  const likelyTests = composed.likely_tests_by_path[input.path];
  const loc = source.state === "available" ? source.line_count : null;
  return createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "path_match",
    ...committedEnvelopeFields(status),
    ...createSidecarContextTrustProjection({ dirty_state: status.dirty_state,
      dirty_details: status.dirty_details, overlay_state: composed.overlay.overlayState,
      overlay_source_count: composed.overlay.sourcePaths.length,
      derived_evidence: composed.derived_evidence }),
    canonical_refs: composed.canonical_refs,
    derived_evidence: [...composed.derived_evidence,
      { kind: "sidecar_context_query", query_kind: "context_for_path", path: input.path,
        include_suppressed: includeSuppressed, provenance: provenance({ evidenceBasis: "path_match" }) }],
    query_kind: "context_for_path",
    path: input.path,
    input_path: input.input_path,
    source,
    loc,
    source_entries: descriptor ? [{ kind: descriptor.mode === "120000" ? "symlink" : "file",
      path: descriptor.path, entry: structuredClone(descriptor) }] : [],
    related_code_paths: relatedCodePaths,
    likely_tests: likelyTests,
    affected_files: affectedFiles,
    structural_impacts: composed.impacts,
    missing_update_hints: composed.hints,
    graph_state: composed.graph_state,
    counts: {
      canonical_refs: composed.canonical_refs.length,
      related_code_paths: relatedCodePaths.length,
      likely_tests: likelyTests.length,
      affected_files: affectedFiles.length,
      structural_impacts: composed.impacts.length,
      missing_update_hints: composed.hints.length,
      source_lines: loc
    }
  });
}
