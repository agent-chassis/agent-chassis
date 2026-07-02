import { createSidecarResultEnvelope } from "./sidecar-schema.mjs";
import { createSidecarGraphState } from "./sidecar-graph-schema.mjs";
import {
  SidecarPathValidationError,
  parseSidecarPatch,
  validateParsedSidecarDiffRecords
} from "./sidecar-paths.mjs";
import { runSidecarGit } from "./sidecar-status.mjs";
import {
  SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS,
  cloneJson,
  uniqueStrings
} from "./sidecar-graph-impact-shared.mjs";
import { createCompactGraphImpactSummary } from "./sidecar-graph-impact-summary.mjs";

const GRAPH_IMPACT_DIFF_CHANGE_KINDS = new Set([
  "added",
  "deleted",
  "modified",
  "renamed",
  "copied"
]);

function diffSourceProvenance(source) {
  if (source === "live_git_diff") {
    return {
      source_kind: "git_history",
      canonicality: "derived",
      evidence_basis: "git_tree",
      provenance_label: source
    };
  }
  return {
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "explicit_metadata",
    provenance_label: source
  };
}

function normalizeRawPatchText(patchText, source) {
  const text = String(patchText ?? "").replace(/\r\n?/g, "\n");
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS.max_bytes) {
    return {
      ok: false,
      text: "",
      invalid: invalidDiffRecord({
        source,
        recordIndex: null,
        record: null,
        code: "raw_patch_too_large",
        reason: `raw patch exceeds ${SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS.max_bytes} bytes`
      })
    };
  }
  const lineCount = text ? text.split("\n").length : 0;
  if (lineCount > SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS.max_lines) {
    return {
      ok: false,
      text: "",
      invalid: invalidDiffRecord({
        source,
        recordIndex: null,
        record: null,
        code: "raw_patch_too_many_lines",
        reason: `raw patch exceeds ${SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS.max_lines} lines`
      })
    };
  }
  return { ok: true, text, invalid: null };
}

function parsedRecordWithSource({ record, source, recordIndex }) {
  return {
    record_index: recordIndex,
    source,
    changeKind: record?.changeKind ?? null,
    oldPath: record?.oldPath ?? null,
    newPath: record?.newPath ?? null,
    provenance: diffSourceProvenance(source)
  };
}

function invalidDiffRecord({ source, recordIndex, record, code, reason }) {
  return {
    record_index: recordIndex,
    source,
    input_record: record ?? null,
    code,
    reason,
    provenance: diffSourceProvenance(source)
  };
}

function diffValidationHint({ validRecord = null, invalidRecord = null }) {
  if (invalidRecord) {
    return {
      kind: "sidecar_diff_record_validation",
      record_index: invalidRecord.record_index,
      source: invalidRecord.source,
      valid: false,
      code: invalidRecord.code,
      reason: invalidRecord.reason,
      provenance: invalidRecord.provenance
    };
  }
  return {
    kind: "sidecar_diff_record_validation",
    record_index: validRecord.record_index,
    source: validRecord.source,
    valid: true,
    change_kind: validRecord.changeKind,
    old_path: validRecord.oldPath,
    new_path: validRecord.newPath,
    supported: validRecord.supported,
    provenance: validRecord.provenance
  };
}

function validateDiffSemantics(record) {
  const kind = record.changeKind;
  if (!GRAPH_IMPACT_DIFF_CHANGE_KINDS.has(kind)) {
    return null;
  }
  if (kind === "added" && (record.oldPath != null || record.newPath == null)) {
    return "added records require absent oldPath and present newPath";
  }
  if (kind === "deleted" && (record.oldPath == null || record.newPath != null)) {
    return "deleted records require present oldPath and absent newPath";
  }
  if ((kind === "modified" || kind === "renamed" || kind === "copied") && (record.oldPath == null || record.newPath == null)) {
    return `${kind} records require both oldPath and newPath`;
  }
  return null;
}

function validateDiffRecord({ record, source, recordIndex }) {
  try {
    const [validated] = validateParsedSidecarDiffRecords([record]);
    const semanticError = validateDiffSemantics(validated);
    if (semanticError) {
      const invalid = invalidDiffRecord({
        source,
        recordIndex,
        record,
        code: "invalid_diff_semantics",
        reason: semanticError
      });
      return { valid: null, invalid, hint: diffValidationHint({ invalidRecord: invalid }) };
    }
    const supported = GRAPH_IMPACT_DIFF_CHANGE_KINDS.has(validated.changeKind);
    const valid = {
      record_index: recordIndex,
      source,
      changeKind: validated.changeKind,
      oldPath: validated.oldPath,
      newPath: validated.newPath,
      supported,
      provenance: diffSourceProvenance(source)
    };
    return { valid, invalid: null, hint: diffValidationHint({ validRecord: valid }) };
  } catch (error) {
    if (!(error instanceof SidecarPathValidationError)) {
      throw error;
    }
    const invalid = invalidDiffRecord({
      source,
      recordIndex,
      record,
      code: error.code || "invalid_diff_record",
      reason: error.reason || error.message
    });
    return { valid: null, invalid, hint: diffValidationHint({ invalidRecord: invalid }) };
  }
}

function appendDiffRecords({ records, source, parsed, valid, invalid, hints, nextIndex }) {
  let recordIndex = nextIndex;
  for (const record of records) {
    if (recordIndex >= SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS.max_records) {
      const invalidRecord = invalidDiffRecord({
        source,
        recordIndex,
        record,
        code: "too_many_diff_records",
        reason: `graph_impact_diff accepts at most ${SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS.max_records} records`
      });
      invalid.push(invalidRecord);
      hints.push(diffValidationHint({ invalidRecord }));
      recordIndex += 1;
      continue;
    }
    parsed.push(parsedRecordWithSource({ record, source, recordIndex }));
    const result = validateDiffRecord({ record, source, recordIndex });
    if (result.valid) {
      valid.push(result.valid);
    }
    if (result.invalid) {
      invalid.push(result.invalid);
    }
    hints.push(result.hint);
    recordIndex += 1;
  }
  return recordIndex;
}

async function collectLiveGitDiffRecords(repoRoot) {
  let patchText = "";
  try {
    patchText = await runSidecarGit(
      repoRoot,
      [
        "diff",
        "--no-ext-diff",
        "--find-renames",
        "--find-copies",
        "HEAD",
        "--"
      ],
      { maxBuffer: SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS.max_bytes + 1 }
    );
  } catch (error) {
    if (error?.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw error;
    }
    patchText = "x".repeat(SIDECAR_GRAPH_IMPACT_DIFF_RAW_PATCH_LIMITS.max_bytes + 1);
  }
  return {
    patchText,
    records: parseSidecarPatch(patchText)
  };
}

export async function normalizeGraphImpactDiffInput({
  repoRoot,
  patchText = null,
  diffRecords = null,
  liveGit = false
}) {
  const inputSources = [];
  const parsed = [];
  const valid = [];
  const invalid = [];
  const hints = [];
  let nextIndex = 0;

  if (diffRecords != null) {
    const source = "caller_supplied_diff_records";
    inputSources.push({ source, format: "diff_records", provenance: diffSourceProvenance(source) });
    if (!Array.isArray(diffRecords)) {
      const invalidRecord = invalidDiffRecord({
        source,
        recordIndex: null,
        record: diffRecords,
        code: "invalid_diff_records",
        reason: "diff_records must be an array"
      });
      invalid.push(invalidRecord);
      hints.push(diffValidationHint({ invalidRecord }));
    } else {
      nextIndex = appendDiffRecords({
        records: diffRecords,
        source,
        parsed,
        valid,
        invalid,
        hints,
        nextIndex
      });
    }
  }

  if (patchText != null) {
    const source = "caller_supplied_raw_patch";
    const normalized = normalizeRawPatchText(patchText, source);
    inputSources.push({
      source,
      format: "raw_patch",
      byte_count: Buffer.byteLength(String(patchText ?? ""), "utf8"),
      provenance: diffSourceProvenance(source)
    });
    if (!normalized.ok) {
      invalid.push(normalized.invalid);
      hints.push(diffValidationHint({ invalidRecord: normalized.invalid }));
    } else {
      nextIndex = appendDiffRecords({
        records: parseSidecarPatch(normalized.text),
        source,
        parsed,
        valid,
        invalid,
        hints,
        nextIndex
      });
    }
  }

  if (liveGit) {
    const source = "live_git_diff";
    const live = await collectLiveGitDiffRecords(repoRoot);
    const normalized = normalizeRawPatchText(live.patchText, source);
    inputSources.push({
      source,
      format: "raw_patch",
      byte_count: Buffer.byteLength(live.patchText, "utf8"),
      provenance: diffSourceProvenance(source)
    });
    if (!normalized.ok) {
      invalid.push(normalized.invalid);
      hints.push(diffValidationHint({ invalidRecord: normalized.invalid }));
    } else {
      nextIndex = appendDiffRecords({
        records: parseSidecarPatch(normalized.text),
        source,
        parsed,
        valid,
        invalid,
        hints,
        nextIndex
      });
    }
  }

  if (inputSources.length === 0) {
    throw new Error("graph_impact_diff requires diffRecords, patchText, or liveGit");
  }

  return {
    inputSources,
    parsedDiffRecords: parsed,
    validatedDiffRecords: valid,
    invalidDiffRecords: invalid,
    validationHints: hints
  };
}

export function pathsForDiffImpact(records) {
  const paths = [];
  for (const record of records) {
    if (!record.supported) {
      continue;
    }
    if (record.changeKind === "added") {
      paths.push(record.newPath);
    } else if (record.changeKind === "deleted") {
      paths.push(record.oldPath);
    } else {
      paths.push(record.oldPath, record.newPath);
    }
  }
  return uniqueStrings(paths).sort((left, right) => left.localeCompare(right));
}

function endpointReasonMap(graphResult) {
  const map = new Map();
  for (const entry of graphResult.derived_evidence || []) {
    if (entry.kind === "sidecar_graph_path_state" && entry.input_path) {
      map.set(entry.input_path, entry.reason || "unavailable");
    }
  }
  return map;
}

function endpointState({ endpointPath, record, graphResult, reasonMap }) {
  if (endpointPath == null) {
    return { available: false, state: "absent" };
  }
  if (!record.supported) {
    return { available: false, state: "unsupported_change_kind" };
  }
  const unavailable = new Set(graphResult.graph_state?.unavailable_paths || []);
  const reason = reasonMap.get(endpointPath);
  if (unavailable.has(endpointPath) || reason) {
    if (reason === "deleted") {
      return { available: false, state: "deleted" };
    }
    if (reason === "unsupported") {
      return { available: false, state: "unsupported" };
    }
    if (reason && reason.includes("stale")) {
      return { available: false, state: "stale" };
    }
    if (graphResult.dirty_state === "dirty_worktree") {
      return { available: false, state: "dirty" };
    }
    return { available: false, state: "unavailable" };
  }
  if (!graphResult.graph_state?.graph_available) {
    return {
      available: false,
      state: graphResult.staleness === "fresh" ? "unavailable" : "stale"
    };
  }
  return { available: true, state: "available" };
}

export function diffPathStates({ records, graphResult }) {
  const reasonMap = endpointReasonMap(graphResult);
  return records.map((record) => {
    const oldState = endpointState({
      endpointPath: record.oldPath,
      record,
      graphResult,
      reasonMap
    });
    const newState = endpointState({
      endpointPath: record.newPath,
      record,
      graphResult,
      reasonMap
    });
    return {
      record_index: record.record_index,
      source: record.source,
      change_kind: record.changeKind,
      old_path: record.oldPath,
      new_path: record.newPath,
      old_graph_available: oldState.available,
      new_graph_available: newState.available,
      old_state: oldState.state,
      new_state: newState.state,
      edge_source: graphResult.graph_state?.edge_source || "unavailable",
      dirty_graph_mode: graphResult.graph_state?.dirty_graph_mode || "unavailable",
      provenance: record.provenance
    };
  });
}

export function emptyGraphImpactResult({ status, inputPaths }) {
  const result = createSidecarResultEnvelope({
    source_kind: "code_index",
    canonicality: "derived",
    evidence_basis: "path_match",
    index_head: status.index_head,
    index_tree: status.index_tree,
    dirty_state: status.dirty_state,
    dirty_details: status.dirty_details,
    staleness: status.staleness,
    canonical_refs: [],
    derived_evidence: status.derived_evidence.map(cloneJson),
    cache_path: status.cache_path,
    artifact_path: status.artifact_path,
    artifact_exists: status.artifact_exists,
    artifact_schema_version: status.artifact_schema_version,
    expected_artifact_schema_version: status.expected_artifact_schema_version,
    status_reason: status.status_reason,
    query_kind: "graph_impact_paths",
    input_paths: inputPaths,
    validated_paths: [],
    invalid_paths: [],
    validation_hints: [],
    graph_state: status.graph_state || createSidecarGraphState(),
    graph_nodes: [],
    graph_edges: [],
    structural_impacts: [],
    missing_update_hints: []
  });
  return {
    ...result,
    summary: createCompactGraphImpactSummary(result)
  };
}
