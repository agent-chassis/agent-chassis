

import {
  persistWorkRecordGraphImpactByUnit,
  readWorkRecordById
} from "@agent-chassis/wiki-core";

import { generateAndPersistWorkRecordGraphImpactByUnit } from "@agent-chassis/wiki-core/src/operations/work-record-graph-impact-generate.mjs";
import { SLICE_ID_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import {
  applyServerBoundGraphImpactUnitAndDigest,
  areGraphImpactPathListsEqual,
  areGraphImpactUnitsEqual,
  hasDeclaredGraphImpactPathList,
  isFilesystemPathLikeGraphImpactArtifactRef,
  isGraphImpactSummaryShape,
  mergeCompactGraphImpactEvidence,
  normalizeGraphImpactPathList,
  normalizeGraphImpactSummaryRefInput,
  normalizeGraphImpactUnit
} from "./graph-impact-response-boundary.mjs";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getUniqueNonEmptyStrings(values) {
  const uniqueValues = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const normalized = isNonEmptyString(value) ? String(value).trim() : null;
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    uniqueValues.push(normalized);
  }

  return uniqueValues;
}

function parseWorkRecordUnitAddress(unitAddress) {
  const normalizedAddress = typeof unitAddress === "string" ? unitAddress.trim() : "";
  if (!normalizedAddress) {
    return null;
  }

  const pieces = normalizedAddress.split("#");
  if (pieces.length > 2 || !/^WK-[0-9]{4}$/.test(pieces[0])) {
    return null;
  }

  if (pieces.length === 1) {
    return {
      kind: "work_item",
      address: pieces[0],
      record_id: pieces[0],
      slice_id: null
    };
  }

  const sliceId = pieces[1];

  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return null;
  }

  return {
    kind: "slice",
    address: normalizedAddress,
    record_id: pieces[0],
    slice_id: sliceId
  };
}

function describeCompactGraphImpactBindingRefusal(graphImpact, graphImpactSummaryRef, requestedUnit, graphImpactSummaryRefInput) {
  if (!isGraphImpactSummaryShape(graphImpact)) {
    return null;
  }

  if (!isPlainObject(graphImpactSummaryRef) || !isGraphImpactSummaryShape(graphImpactSummaryRef.summary)) {
    if (!isPlainObject(graphImpactSummaryRefInput)) {
      return "missing graph_impact_summary_ref binding";
    }
    if (
      isFilesystemPathLikeGraphImpactArtifactRef(graphImpactSummaryRefInput.artifact_ref) ||
      isFilesystemPathLikeGraphImpactArtifactRef(graphImpactSummaryRefInput.ref) ||
      isFilesystemPathLikeGraphImpactArtifactRef(graphImpactSummaryRefInput.ref_id) ||
      isFilesystemPathLikeGraphImpactArtifactRef(graphImpactSummaryRefInput.digest)
    ) {
      return "graph_impact_summary_ref.artifact_ref must not be a filesystem path";
    }
    if (!isGraphImpactSummaryShape(graphImpactSummaryRefInput.summary)) {
      return "missing graph_impact_summary_ref.summary binding";
    }
    return "missing graph_impact_summary_ref raw-evidence provenance binding";
  }

  if (!isPlainObject(graphImpact.unit) || !isPlainObject(graphImpact.graph_state)) {
    return "missing unit or graph_state binding in graph_impact summary";
  }

  const normalizedRequestedUnit = normalizeGraphImpactUnit(requestedUnit);
  const normalizedGraphImpactUnit = normalizeGraphImpactUnit(graphImpact.unit);
  const normalizedSummaryUnit =
    normalizeGraphImpactUnit(graphImpactSummaryRef.summary.unit) ??
    normalizeGraphImpactUnit(graphImpactSummaryRef.unit);

  if (!areGraphImpactUnitsEqual(normalizedRequestedUnit, normalizedGraphImpactUnit)) {
    return "unit mismatch between the requested unit and the graph_impact summary";
  }
  if (!areGraphImpactUnitsEqual(normalizedRequestedUnit, normalizedSummaryUnit)) {
    return "unit mismatch between the requested unit and graph_impact_summary_ref.summary.unit";
  }

  const summaryQueryKind = isNonEmptyString(graphImpact.query_kind) ? String(graphImpact.query_kind).trim() : null;
  const summaryRefQueryKind = isNonEmptyString(graphImpactSummaryRef.summary.query_kind)
    ? String(graphImpactSummaryRef.summary.query_kind).trim()
    : null;
  if (!summaryQueryKind) {
    return "missing query_kind binding in the graph_impact summary";
  }
  if (!summaryRefQueryKind) {
    return "missing query_kind binding in graph_impact_summary_ref.summary";
  }
  if (summaryQueryKind !== summaryRefQueryKind) {
    return "query_kind mismatch between the graph_impact summary and graph_impact_summary_ref.summary";
  }

  const sourceRecordDigest = getUniqueNonEmptyStrings([
    graphImpact.source_record_digest,
    graphImpactSummaryRef.summary.source_record_digest,
    graphImpactSummaryRef.source_record_digest
  ]);
  if (sourceRecordDigest.length === 0) {
    return "missing source_record_digest binding";
  }
  if (sourceRecordDigest.length > 1) {
    return "source_record_digest mismatch between the graph_impact summary and graph_impact_summary_ref";
  }

  const rawEvidenceBindings = getUniqueNonEmptyStrings([
    graphImpactSummaryRef.binding_token,
    graphImpactSummaryRef.raw_evidence_digest,
    graphImpactSummaryRef.raw_evidence_ref,
    graphImpactSummaryRef.summary.binding_token,
    graphImpactSummaryRef.summary.raw_evidence_digest,
    graphImpactSummaryRef.summary.raw_evidence_ref
  ]);
  if (rawEvidenceBindings.length === 0) {
    return "missing raw_evidence_digest/raw_evidence_ref binding";
  }
  if (rawEvidenceBindings.length > 1) {
    return "raw_evidence_digest/raw_evidence_ref mismatch between the compact summary and summary_ref";
  }

  const artifactRef = isNonEmptyString(graphImpactSummaryRef.artifact_ref)
    ? graphImpactSummaryRef.artifact_ref.trim()
    : null;
  if (
    artifactRef &&
    !isFilesystemPathLikeGraphImpactArtifactRef(artifactRef) &&
    !(
      hasDeclaredGraphImpactPathList(graphImpactSummaryRef, "input_paths") ||
      hasDeclaredGraphImpactPathList(graphImpactSummaryRef.summary, "input_paths")
    )
  ) {
    return "graph_impact_summary_ref with artifact_ref requires input_paths binding";
  }
  if (
    artifactRef &&
    !isFilesystemPathLikeGraphImpactArtifactRef(artifactRef) &&
    !(
      hasDeclaredGraphImpactPathList(graphImpactSummaryRef, "validated_paths") ||
      hasDeclaredGraphImpactPathList(graphImpactSummaryRef.summary, "validated_paths")
    )
  ) {
    return "graph_impact_summary_ref with artifact_ref requires validated_paths binding";
  }

  const graphImpactInputPaths = Array.isArray(graphImpact.input_paths)
    ? normalizeGraphImpactPathList(graphImpact.input_paths)
    : null;
  const graphImpactValidatedPaths = Array.isArray(graphImpact.validated_paths)
    ? normalizeGraphImpactPathList(graphImpact.validated_paths)
    : null;
  const summaryRefTopLevelInputPaths = Array.isArray(graphImpactSummaryRef.input_paths)
    ? normalizeGraphImpactPathList(graphImpactSummaryRef.input_paths)
    : null;
  const summaryRefTopLevelValidatedPaths = Array.isArray(graphImpactSummaryRef.validated_paths)
    ? normalizeGraphImpactPathList(graphImpactSummaryRef.validated_paths)
    : null;
  const summaryRefSummaryInputPaths = Array.isArray(graphImpactSummaryRef.summary.input_paths)
    ? normalizeGraphImpactPathList(graphImpactSummaryRef.summary.input_paths)
    : null;
  const summaryRefSummaryValidatedPaths = Array.isArray(graphImpactSummaryRef.summary.validated_paths)
    ? normalizeGraphImpactPathList(graphImpactSummaryRef.summary.validated_paths)
    : null;

  if (
    graphImpactInputPaths &&
    summaryRefTopLevelInputPaths &&
    !areGraphImpactPathListsEqual(graphImpactInputPaths, summaryRefTopLevelInputPaths)
  ) {
    return "input_paths mismatch between the graph_impact summary and graph_impact_summary_ref";
  }
  if (
    graphImpactValidatedPaths &&
    summaryRefTopLevelValidatedPaths &&
    !areGraphImpactPathListsEqual(graphImpactValidatedPaths, summaryRefTopLevelValidatedPaths)
  ) {
    return "validated_paths mismatch between the graph_impact summary and graph_impact_summary_ref";
  }
  if (
    summaryRefTopLevelInputPaths &&
    summaryRefSummaryInputPaths &&
    !areGraphImpactPathListsEqual(summaryRefTopLevelInputPaths, summaryRefSummaryInputPaths)
  ) {
    return "input_paths mismatch between graph_impact_summary_ref and graph_impact_summary_ref.summary";
  }
  if (
    summaryRefTopLevelValidatedPaths &&
    summaryRefSummaryValidatedPaths &&
    !areGraphImpactPathListsEqual(summaryRefTopLevelValidatedPaths, summaryRefSummaryValidatedPaths)
  ) {
    return "validated_paths mismatch between graph_impact_summary_ref and graph_impact_summary_ref.summary";
  }

  return null;
}

function bindCompactSummaryRefInput(summaryRefInput, graphImpactInput) {
  if (!isPlainObject(summaryRefInput)) {
    return summaryRefInput;
  }
  if (isGraphImpactSummaryShape(summaryRefInput.summary)) {
    return summaryRefInput;
  }

  if (Object.prototype.hasOwnProperty.call(summaryRefInput, "summary")) {
    return summaryRefInput;
  }
  if (!isGraphImpactSummaryShape(graphImpactInput)) {
    return summaryRefInput;
  }
  return {
    ...summaryRefInput,
    summary: graphImpactInput
  };
}

function buildUnitGenerateResponse({ workspaceRepo, generateResult, verbose }) {
  const response = {
    repo: workspaceRepo,
    mode: "unit_generate",
    outcome: generateResult.outcome ?? null,
    record_id: generateResult.record_id ?? null,
    selected_unit: generateResult.selected_unit ?? generateResult.unit ?? null,
    paths_source: generateResult.paths_source ?? null,
    subject_paths: Array.isArray(generateResult.subject_paths) ? generateResult.subject_paths : [],
    graph_bearing_paths: Array.isArray(generateResult.graph_bearing_paths)
      ? generateResult.graph_bearing_paths
      : [],
    written: Boolean(generateResult.written),
    valid: Boolean(generateResult.valid),
    graph_available: Boolean(generateResult.graph_available),
    staleness: generateResult.staleness ?? null,
    dirty_state: generateResult.dirty_state ?? null,
    source_digest: generateResult.source_digest ?? null,
    diagnostics: Array.isArray(generateResult.diagnostics) ? generateResult.diagnostics : []
  };
  if (generateResult.outcome === "graph_unavailable") {
    response.remediation =
      "graph unavailable — run code_index_build to build/refresh the index, then retry";
  }
  if (verbose) {
    response.graph_state = generateResult.graph_state ?? null;
  }
  return response;
}

export function registerGraphImpactPersistenceTools({
  registerTool,
  workspaceRepos,
  z,
  jsonContent,
  errorContent,
  resolveWorkspaceRepo,
  createGraphImpactToolResponse
}) {
  registerTool(
    "workspace_record_graph_impact_evidence",
    {
      description:
        "Write-capable: persist structured graph-impact evidence to a WK or slice in a configured workspace repository. Unit-only mode (RECOMMENDED for agents): pass only unit (and optionally explicit paths) with NO graph_impact / graph_impact_summary / graph_impact_summary_ref — the server itself derives the unit's subject paths, runs the trusted internal graph-impact query, and persists the sidecar by reference. Nothing crosses the wire, so there is no envelope size limit and no caller anti-fabrication binding is required; paths default to the unit's write_scope (or repo_paths when empty). Courier mode (back-compat): pass a raw graph-impact envelope or a provenance-bound compact summary/ref — caller-supplied filesystem roots and shell command output are rejected as authority. Either way the persisted entry is validated against the canonical work-record schema before writing. Output is compact by default (outcome, written, selected_unit, source_digest, valid, graph_available/staleness/dirty_state, bounded diagnostics); pass verbose: true only for debugging to include the raw graph_state. verbose never returns the raw graph_impact envelope and never relaxes the trusted-evidence binding the courier path requires.",
      inputSchema: {
        repo: z.string().optional(),
        unit: z.string(),
        paths: z.array(z.string()).optional(),
        graph_impact: z.unknown().optional(),
        graph_impact_summary: z.unknown().optional(),
        graph_impact_summary_ref: z.unknown().optional(),
        verbose: z.boolean().optional(),
        expected_source_digest: z.string().optional()
      }
    },
    async (args) => {
      try {
        const workspace = resolveWorkspaceRepo(workspaceRepos, args.repo);
        const requestedUnit = parseWorkRecordUnitAddress(args.unit);
        if (!requestedUnit) {
          return errorContent(
            new Error("workspace_record_graph_impact_evidence requires a valid work-record unit address")
          );
        }

        const hasCallerSuppliedEvidence =
          (args.graph_impact !== undefined && args.graph_impact !== null) ||
          (args.graph_impact_summary !== undefined && args.graph_impact_summary !== null) ||
          (args.graph_impact_summary_ref !== undefined && args.graph_impact_summary_ref !== null);
        if (!hasCallerSuppliedEvidence) {
          const generateResult = await generateAndPersistWorkRecordGraphImpactByUnit({
            dir: workspace.dir,
            unitAddress: args.unit,
            paths: Array.isArray(args.paths) ? args.paths : null
          });
          return jsonContent(
            buildUnitGenerateResponse({
              workspaceRepo: workspace.repo,
              generateResult,
              verbose: Boolean(args.verbose)
            })
          );
        }

        let compactSummaryRefInput = args.graph_impact_summary_ref;
        const explicitCompactSummaryInput =
          args.graph_impact_summary !== undefined && args.graph_impact_summary !== null
            ? args.graph_impact_summary
            : isGraphImpactSummaryShape(args.graph_impact)
              ? args.graph_impact
              : null;
        if (explicitCompactSummaryInput !== null) {
          compactSummaryRefInput = bindCompactSummaryRefInput(
            compactSummaryRefInput,
            explicitCompactSummaryInput
          );
        }
        let compactSummaryRef = normalizeGraphImpactSummaryRefInput(compactSummaryRefInput);
        let graphImpactInput =
          args.graph_impact !== undefined && args.graph_impact !== null
            ? args.graph_impact
            : compactSummaryRef?.summary ?? args.graph_impact_summary ?? null;

        if (graphImpactInput === null || graphImpactInput === undefined) {
          return errorContent(
            new Error("workspace_record_graph_impact_evidence requires graph_impact or graph_impact_summary_ref")
          );
        }

        const compactSummaryInput = isGraphImpactSummaryShape(graphImpactInput);

        if (compactSummaryInput) {
          const loadedForBinding = await readWorkRecordById({
            dir: workspace.dir,
            id: requestedUnit.record_id
          });
          const currentSourceDigest = isNonEmptyString(loadedForBinding?.source_digest)
            ? loadedForBinding.source_digest
            : null;
          graphImpactInput = applyServerBoundGraphImpactUnitAndDigest(graphImpactInput, {
            unit: requestedUnit,
            sourceRecordDigest: currentSourceDigest
          });
          if (compactSummaryRef) {
            compactSummaryRef = applyServerBoundGraphImpactUnitAndDigest(compactSummaryRef, {
              unit: requestedUnit,
              sourceRecordDigest: currentSourceDigest
            });
          }
        }

        if (
          compactSummaryInput &&
          !areGraphImpactUnitsEqual(normalizeGraphImpactUnit(graphImpactInput.unit), requestedUnit)
        ) {
          return errorContent(
            new Error(
              "workspace_record_graph_impact_evidence compact graph-impact summary unit must match the requested unit"
            )
          );
        }

        if (
          compactSummaryRef &&
          compactSummaryRef.summary &&
          !areGraphImpactUnitsEqual(
            normalizeGraphImpactUnit(compactSummaryRef.summary.unit) ??
              normalizeGraphImpactUnit(compactSummaryRef.unit),
            requestedUnit
          )
        ) {
          return errorContent(
            new Error(
              "workspace_record_graph_impact_evidence compact graph-impact summary_ref unit must match the requested unit"
            )
          );
        }

        const compactBindingFailure = describeCompactGraphImpactBindingRefusal(
          graphImpactInput,
          compactSummaryRef,
          requestedUnit,
          compactSummaryRefInput
        );
        if (compactBindingFailure) {
          return errorContent(
            new Error(
              `workspace_record_graph_impact_evidence compact graph-impact summaries require raw-evidence provenance binding: ${compactBindingFailure}`
            )
          );
        }

        if (compactSummaryInput && compactSummaryRef) {
          const mergedCompactEvidence = mergeCompactGraphImpactEvidence(graphImpactInput, compactSummaryRef);
          if (!mergedCompactEvidence) {
            return errorContent(
              new Error(
                "workspace_record_graph_impact_evidence compact graph-impact input_paths and validated_paths must match the supplied compact graph-impact summary_ref"
              )
            );
          }
          graphImpactInput = mergedCompactEvidence;
        }

        if (
          compactSummaryRef &&
          compactSummaryRef.summary &&
          isNonEmptyString(compactSummaryRef.summary.query_kind) &&
          isNonEmptyString(graphImpactInput?.query_kind) &&
          compactSummaryRef.summary.query_kind !== graphImpactInput.query_kind
        ) {
          return errorContent(
            new Error(
              "workspace_record_graph_impact_evidence graph_impact_summary_ref.summary must match the supplied compact graph-impact summary"
            )
          );
        }

        const result = await persistWorkRecordGraphImpactByUnit({
          dir: workspace.dir,
          unitAddress: args.unit,
          graph_impact: graphImpactInput,
          ...(compactSummaryRef ? { graph_impact_summary_ref: compactSummaryRef } : {}),
          expectedSourceDigest: args.expected_source_digest ?? null
        });

        return jsonContent(
          createGraphImpactToolResponse({
            workspaceRepo: workspace.repo,
            result,
            graphImpact: result.graph_impact,
            verbose: Boolean(args.verbose),
            graphImpactSummaryRef: compactSummaryRef,
            compactFields: {
              record_id: result.record_id ?? null,
              selected_unit: result.selected_unit ?? null,
              canonical_record_path: result.canonical_record_path ?? null,
              source_digest: result.source_digest ?? null,
              valid: Boolean(result.valid),
              written: Boolean(result.written),
              dirty_state: result.graph_impact?.dirty_state ?? result.graph_impact?.graph_state?.dirty_state ?? null,
              staleness: result.graph_impact?.staleness ?? result.graph_impact?.graph_state?.staleness ?? null,
              diagnostics: result.diagnostics ?? []
            },
            verboseFields: {
              graph_state: result.graph_impact?.graph_state ?? null
            },
            includeDerivedEvidence: true,
            rawGraphImpact: result.graph_impact
          })
        );
      } catch (error) {
        return errorContent(error);
      }
    }
  );
}
