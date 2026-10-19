import { planningFields, planningCounts } from "./sidecar-planning-query.mjs";
import path from "node:path";

import { createSidecarContextTrustProjection } from "./sidecar-context-projection.mjs";
import { provenance } from "./sidecar-graph-impact-shared.mjs";
import { readCompleteFiles } from "./sidecar-occurrence-source.mjs";
import { normalizeSidecarContextInput } from "./sidecar-query-input.mjs";
import {
  attributeAffectedFiles,
  committedEnvelopeFields,
  composeCommittedPaths,
  prepareCommittedQuery,
  runSnapshotQuery
} from "./sidecar-query-selection.mjs";
import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";

export async function getSidecarContextForPath(options = {}, context = null) {
  const input = normalizeSidecarContextInput(options);
  return runSnapshotQuery(context, () => evaluateContextForPath(input, context));
}

async function evaluateContextForPath(input, context) {
  const targetDir = path.resolve(String(input.dir ?? "."));
  const includeSuppressed = input.includeSuppressed === true;
  const prepared = await prepareCommittedQuery({ dir: targetDir, cacheDir: input.cacheDir }, context);
  const composed = await composeCommittedPaths({ prepared, cacheDir: input.cacheDir, targetDir,
    validPaths: [input.path], includeSuppressed, includeOutgoing: true });
  const descriptor = composed.selection.files.find((file) => file.path === input.path) ?? null;
  const retainedSource = composed.complete_files.find(file => file.path === input.path);
  const source = retainedSource ?? (await readCompleteFiles(prepared.repoRoot, [input.path],
    new Map(descriptor ? [[input.path, descriptor]] : []))).get(input.path).entry;
  const { status } = prepared;
  const affectedFiles = attributeAffectedFiles(composed);
  const relatedCodePaths = affectedFiles.filter(file => file.relationships.some(row =>
    row.basis === "scip" || row.kind === "reverse_import")).map(file => file.path);
  const loc = source.state === "available" ? source.line_count : null;
  return createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "path_match",
    ...committedEnvelopeFields(prepared),
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
    ...planningFields(composed),
    affected_files: affectedFiles,
    structural_impacts: composed.impacts,
    graph_state: composed.graph_state,
    counts: {
      ...planningCounts(composed),
      canonical_refs: composed.canonical_refs.length,
      related_code_paths: relatedCodePaths.length,
      affected_files: affectedFiles.length,
      structural_impacts: composed.impacts.length,
      source_lines: loc
    }
  });
}
