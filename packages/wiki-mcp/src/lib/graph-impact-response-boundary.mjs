import path from "node:path";

import { computeNormalizedInputDigest } from "@agent-chassis/wiki-core/src/lib/work-record-admission-shared.mjs";
import { createWorkRecordGraphImpactSummary } from "@agent-chassis/wiki-core/src/lib/work-record-graph-impact-summary.mjs";

const WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND = "work_record_graph_impact_summary";
const WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION = "work-record-graph-impact-summary.v1";
const GRAPH_IMPACT_RAW_PAYLOAD_FIELDS = new Set([
  "graph_nodes",
  "graph_edges",
  "canonical_refs",
  "structural_impacts",
  "feature_vector",
  "worker_admission_feature_vector",
  "normalized_request",
  "normalizedRequest",
  "work_unit_feature_vector",
  "workUnitFeatureVector"
]);
const GRAPH_IMPACT_RAW_EVIDENCE_TOKEN_FIELDS = [
  "raw_evidence_digest",
  "raw_evidence_ref",
  "binding_token",
  "ref",
  "ref_id",
  "digest",
  "artifact_ref"
];
const GRAPH_IMPACT_RESERVED_RAW_EVIDENCE_TOKENS = new Set([
  "stdin",
  "stdout",
  "stderr",
  "shell-stdin",
  "shell_stdout",
  "shell-stderr",
  "shell_stdout",
  "process-stdin",
  "process_stdout",
  "process-stderr",
  "process_stderr"
]);
const GRAPH_IMPACT_REF_TOKEN_PATTERN = /^[^\s\\/]+$/u;
const GRAPH_IMPACT_SOURCE_RECORD_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeGraphImpactString(value) {
  return isNonEmptyString(value) ? String(value).trim() : null;
}

function normalizeGraphImpactUnit(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const kind = isNonEmptyString(value.kind) ? String(value.kind).trim().toLowerCase() : null;
  const recordId = isNonEmptyString(value.record_id) ? String(value.record_id).trim() : null;
  const sliceId = isNonEmptyString(value.slice_id) ? String(value.slice_id).trim() : null;
  const address = isNonEmptyString(value.address) ? String(value.address).trim() : null;

  if (!kind || !recordId || !address) {
    return null;
  }
  if (kind === "slice" && !sliceId) {
    return null;
  }
  if (kind === "work_item" && sliceId) {
    return null;
  }

  const expectedAddress = kind === "slice" ? `${recordId}#${sliceId}` : recordId;
  if (address !== expectedAddress) {
    return null;
  }

  return {
    kind,
    address,
    record_id: recordId,
    ...(kind === "slice" ? { slice_id: sliceId } : { slice_id: null })
  };
}

function areGraphImpactUnitsEqual(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }

  return (
    left.kind === right.kind &&
    left.address === right.address &&
    left.record_id === right.record_id &&
    left.slice_id === right.slice_id
  );
}

function normalizeGraphImpactPathList(values) {
  const entries = [];
  const seen = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const entry = isNonEmptyString(value) ? String(value).trim() : null;
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    entries.push(entry);
  }

  return entries.sort((left, right) => left.localeCompare(right));
}

function areGraphImpactPathListsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

function isGraphImpactSummaryShape(value) {
  return (
    isPlainObject(value) &&
    (value.kind === WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND ||
      value.schema_version === WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION ||
      isPlainObject(value.graph_quality))
  );
}

function isFilesystemPathLikeGraphImpactArtifactRef(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const normalized = value.trim();
  return (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("file:") ||
    path.isAbsolute(normalized) ||
    normalized.includes("/") ||
    normalized.includes("\\")
  );
}

function isGraphImpactRawEvidenceDigest(value) {
  return isNonEmptyString(value) && /^sha256:[a-f0-9]{64}$/i.test(value.trim());
}

function normalizeGraphImpactSourceRecordDigest(value) {
  const normalized = normalizeGraphImpactString(value);
  return normalized && GRAPH_IMPACT_SOURCE_RECORD_DIGEST_PATTERN.test(normalized) ? normalized : null;
}

function isGraphImpactOpaqueReferenceToken(value) {
  return isNonEmptyString(value) && GRAPH_IMPACT_REF_TOKEN_PATTERN.test(value.trim());
}

function isGraphImpactReservedRawEvidenceToken(value) {
  const token = normalizeGraphImpactString(value)?.toLowerCase() ?? null;
  return Boolean(token && GRAPH_IMPACT_RESERVED_RAW_EVIDENCE_TOKENS.has(token));
}

function hasGraphImpactRawEvidenceProvenanceCandidate(value) {
  if (!isPlainObject(value)) {
    return false;
  }

  return GRAPH_IMPACT_RAW_EVIDENCE_TOKEN_FIELDS.some((field) => isNonEmptyString(value[field]));
}

function normalizeGraphImpactRawEvidenceProvenance(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const explicitBindingToken = normalizeGraphImpactString(value.binding_token);
  if (explicitBindingToken) {
    if (isGraphImpactReservedRawEvidenceToken(explicitBindingToken)) {
      return null;
    }
    if (isFilesystemPathLikeGraphImpactArtifactRef(explicitBindingToken)) {
      return null;
    }
  }

  for (const field of ["raw_evidence_digest", "digest"]) {
    const candidateToken = normalizeGraphImpactString(value[field]);
    if (!candidateToken) {
      continue;
    }
    if (isGraphImpactReservedRawEvidenceToken(candidateToken)) {
      continue;
    }
    if (isFilesystemPathLikeGraphImpactArtifactRef(candidateToken)) {
      continue;
    }
    if (!isGraphImpactRawEvidenceDigest(candidateToken)) {
      continue;
    }
    return {
      binding_token: explicitBindingToken ?? candidateToken,
      raw_evidence_digest: candidateToken
    };
  }

  for (const field of ["raw_evidence_ref", "ref", "ref_id", "artifact_ref", "binding_token"]) {
    const candidateToken = normalizeGraphImpactString(value[field]);
    if (!candidateToken) {
      continue;
    }
    if (isGraphImpactReservedRawEvidenceToken(candidateToken)) {
      continue;
    }
    if (isFilesystemPathLikeGraphImpactArtifactRef(candidateToken)) {
      continue;
    }
    if (!isGraphImpactOpaqueReferenceToken(candidateToken)) {
      continue;
    }
    return {
      binding_token: explicitBindingToken ?? candidateToken,
      raw_evidence_ref: candidateToken
    };
  }

  return null;
}

function createGraphImpactRawEvidenceDigest(summary, rawEvidenceProvenance = null) {
  const digestableSummary = isGraphImpactSummaryShape(summary) ? pruneGraphImpactPayloadFields(cloneJson(summary)) : null;
  if (!digestableSummary) {
    return null;
  }

  delete digestableSummary.source_record_digest;

  const rawEvidenceDigest = normalizeGraphImpactString(rawEvidenceProvenance?.raw_evidence_digest);
  if (isGraphImpactRawEvidenceDigest(rawEvidenceDigest)) {
    return rawEvidenceDigest;
  }

  const digestBasis = {
    kind: WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND,
    schema_version: WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION,
    summary: digestableSummary
  };

  const rawEvidenceToken =
    normalizeGraphImpactString(rawEvidenceProvenance?.binding_token) ??
    normalizeGraphImpactString(rawEvidenceProvenance?.raw_evidence_ref);
  if (rawEvidenceToken) {
    digestBasis.raw_evidence_token = rawEvidenceToken;
  }

  return computeNormalizedInputDigest(digestBasis);
}

function hasDeclaredGraphImpactPathList(value, field) {
  return isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, field) && Array.isArray(value[field]);
}

function pruneGraphImpactPayloadFields(value, seen = new WeakSet()) {
  if (!isPlainObject(value) || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const field of GRAPH_IMPACT_RAW_PAYLOAD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      delete value[field];
    }
  }

  return value;
}

function normalizeGraphImpactSummaryRefInput(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const summary = isGraphImpactSummaryShape(value.summary) ? cloneJson(value.summary) : null;
  if (!summary) {
    return null;
  }

  const summaryUnit = normalizeGraphImpactUnit(summary.unit);
  const providedUnit = normalizeGraphImpactUnit(value.unit);
  if (!summaryUnit && providedUnit) {
    summary.unit = providedUnit;
  }

  if (!isNonEmptyString(summary.source_record_digest) && isNonEmptyString(value.source_record_digest)) {
    summary.source_record_digest = String(value.source_record_digest).trim();
  }

  pruneGraphImpactPayloadFields(summary);

  const artifactRef = isNonEmptyString(value.artifact_ref) ? String(value.artifact_ref).trim() : null;
  if (artifactRef && isFilesystemPathLikeGraphImpactArtifactRef(artifactRef)) {
    return null;
  }

  const canonicalSourceRecordDigestCandidates = [
    summary.source_record_digest,
    value.source_record_digest,
    value.summary?.source_record_digest
  ];
  const sourceRecordDigest = canonicalSourceRecordDigestCandidates
    .map(normalizeGraphImpactSourceRecordDigest)
    .find(Boolean) ?? null;
  if (
    canonicalSourceRecordDigestCandidates.some((candidate) => isNonEmptyString(candidate)) &&
    !sourceRecordDigest
  ) {
    return null;
  }

  const rawEvidenceProvenance = normalizeGraphImpactRawEvidenceProvenance(value);
  if (hasGraphImpactRawEvidenceProvenanceCandidate(value) && !rawEvidenceProvenance) {
    return null;
  }

  if (!sourceRecordDigest && !rawEvidenceProvenance) {
    return null;
  }
  if (sourceRecordDigest) {
    summary.source_record_digest = sourceRecordDigest;
  } else {
    delete summary.source_record_digest;
  }

  const compactRawEvidenceProvenance =
    rawEvidenceProvenance ??
    (() => {
      const rawEvidenceDigest = createGraphImpactRawEvidenceDigest(summary);
      if (!rawEvidenceDigest) {
        return null;
      }
      return {
        binding_token: rawEvidenceDigest,
        raw_evidence_digest: rawEvidenceDigest
      };
    })();

  const normalized = pruneGraphImpactPayloadFields({
    ...cloneJson(value),
    summary,
    ...(sourceRecordDigest ? { source_record_digest: sourceRecordDigest } : {}),
    ...(compactRawEvidenceProvenance ?? {})
  });

  return normalized;
}

function createGraphImpactSummary(graphImpact) {
  const boundedSummary =
    isPreBoundGraphImpactSummary(graphImpact) && isGraphImpactSummaryShape(graphImpact)
      ? pruneGraphImpactPayloadFields(cloneJson(graphImpact))
      : pruneGraphImpactPayloadFields(createWorkRecordGraphImpactSummary(graphImpact || {}));

  const sourceRecordDigest =
    [boundedSummary.source_record_digest, graphImpact?.source_record_digest]
      .map(normalizeGraphImpactSourceRecordDigest)
      .find(Boolean) ?? null;

  const summary = {
    ...boundedSummary,
    ...(isPlainObject(boundedSummary.unit)
      ? { unit: boundedSummary.unit }
      : normalizeGraphImpactUnit(graphImpact?.unit)
        ? { unit: normalizeGraphImpactUnit(graphImpact.unit) }
        : {}),
    ...(isNonEmptyString(boundedSummary.query_kind)
      ? { query_kind: boundedSummary.query_kind.trim() }
      : isNonEmptyString(graphImpact?.query_kind)
        ? { query_kind: String(graphImpact.query_kind).trim() }
        : {}),
    ...(isNonEmptyString(boundedSummary.record_id)
      ? { record_id: boundedSummary.record_id.trim() }
      : isNonEmptyString(graphImpact?.record_id)
        ? { record_id: String(graphImpact.record_id).trim() }
        : {}),
    ...(isNonEmptyString(boundedSummary.slice_id)
      ? { slice_id: boundedSummary.slice_id.trim() }
      : isNonEmptyString(graphImpact?.slice_id)
        ? { slice_id: String(graphImpact.slice_id).trim() }
        : {})
  };

  if (sourceRecordDigest) {
    summary.source_record_digest = sourceRecordDigest;
  } else {
    delete summary.source_record_digest;
  }

  return summary;
}

function lightweightGraphImpactBindingPaths(graphImpact) {
  const inputPaths = normalizeGraphImpactPathList(graphImpact?.input_paths);
  const validatedPaths = normalizeGraphImpactPathList(graphImpact?.validated_paths);
  const invalidPaths = normalizeGraphImpactPathList(graphImpact?.invalid_paths);
  return {
    ...(inputPaths.length > 0 ? { input_paths: inputPaths } : {}),
    ...(validatedPaths.length > 0 ? { validated_paths: validatedPaths } : {}),
    ...(invalidPaths.length > 0 ? { invalid_paths: invalidPaths } : {})
  };
}

function omitGraphImpactSummaryRefSummary(ref) {
  if (!isPlainObject(ref)) {
    return ref;
  }
  const lightweight = { ...ref };
  delete lightweight.summary;
  return lightweight;
}

const COMPACT_GRAPH_IMPACT_AFFECTED_SURFACE_PATH_LIMIT = 5;
const GRAPH_IMPACT_AFFECTED_SURFACE_KINDS = ["test", "docs", "cli", "mcp"];

function compactGraphImpactSummaryAffectedSurfaces(summary) {
  if (!isPlainObject(summary) || !isPlainObject(summary.derived_evidence)) {
    return summary;
  }

  const derivedEvidence = summary.derived_evidence;
  const affectedSurfaces = isPlainObject(derivedEvidence.affected_surfaces)
    ? derivedEvidence.affected_surfaces
    : null;
  if (!affectedSurfaces) {
    return summary;
  }

  const counts = {};
  const topPaths = [];
  const seenPaths = new Set();
  let total = 0;
  for (const kind of GRAPH_IMPACT_AFFECTED_SURFACE_KINDS) {
    const entries = Array.isArray(affectedSurfaces[kind]) ? affectedSurfaces[kind] : [];
    counts[kind] = entries.length;
    total += entries.length;
    for (const entry of entries) {
      if (topPaths.length >= COMPACT_GRAPH_IMPACT_AFFECTED_SURFACE_PATH_LIMIT) {
        break;
      }
      const surfacePath = isPlainObject(entry) ? normalizeGraphImpactString(entry.path) : null;
      if (!surfacePath || seenPaths.has(surfacePath)) {
        continue;
      }
      seenPaths.add(surfacePath);
      topPaths.push(surfacePath);
    }
  }
  counts.total = total;

  return {
    ...summary,
    derived_evidence: {
      ...derivedEvidence,
      affected_surfaces: {
        counts,
        ...(topPaths.length > 0 ? { top_paths: topPaths } : {})
      }
    }
  };
}

function createGraphImpactSummaryRef(graphImpact, boundedSummary = null, { lightweight = false } = {}) {
  const summary = isGraphImpactSummaryShape(boundedSummary)
    ? pruneGraphImpactPayloadFields(cloneJson(boundedSummary))
    : pruneGraphImpactPayloadFields(createGraphImpactSummary(graphImpact || {}));

  const summaryRefInput = graphImpact?.graph_impact_summary_ref ??
    graphImpact?.graphImpactSummaryRef ??
    graphImpact?.summary_ref ??
    graphImpact?.summaryRef ??
    null;

  if (hasGraphImpactRawEvidenceProvenanceCandidate(graphImpact) && !normalizeGraphImpactRawEvidenceProvenance(graphImpact || {})) {
    return null;
  }
  if (hasGraphImpactRawEvidenceProvenanceCandidate(summaryRefInput) && !normalizeGraphImpactRawEvidenceProvenance(summaryRefInput)) {
    return null;
  }

  const summarySourceRecordDigest = [
    summary.source_record_digest,
    summaryRefInput?.source_record_digest,
    graphImpact?.source_record_digest,
    summaryRefInput?.summary?.source_record_digest
  ]
    .map(normalizeGraphImpactSourceRecordDigest)
    .find(Boolean) ?? null;
  if (
    [
      summary.source_record_digest,
      summaryRefInput?.source_record_digest,
      graphImpact?.source_record_digest,
      summaryRefInput?.summary?.source_record_digest
    ].some((candidate) => isNonEmptyString(candidate)) &&
    !summarySourceRecordDigest
  ) {
    return null;
  }

  const rawEvidenceSource = summaryRefInput ?? graphImpact ?? {};
  const rawEvidenceProvenance =
    normalizeGraphImpactRawEvidenceProvenance(rawEvidenceSource) ?? normalizeGraphImpactRawEvidenceProvenance(graphImpact || {});

  const compactRawEvidenceProvenance =
    rawEvidenceProvenance ??
    (() => {
      const rawEvidenceDigest = createGraphImpactRawEvidenceDigest(summary);
      if (!rawEvidenceDigest) {
        return null;
      }
      return {
        binding_token: rawEvidenceDigest,
        raw_evidence_digest: rawEvidenceDigest
      };
    })();

  if (!summarySourceRecordDigest && !compactRawEvidenceProvenance) {
    return null;
  }

  return pruneGraphImpactPayloadFields({
    kind: "graph_impact_reference",
    ...(summarySourceRecordDigest ? { source_record_digest: summarySourceRecordDigest } : {}),
    ...(normalizeGraphImpactUnit(summary.unit) ? { unit: normalizeGraphImpactUnit(summary.unit) } : {}),
    ...(isNonEmptyString(summary.query_kind) ? { query_kind: String(summary.query_kind).trim() } : {}),
    ...(compactRawEvidenceProvenance ?? {}),
    ...lightweightGraphImpactBindingPaths(graphImpact),
    ...(lightweight ? {} : { summary })
  });
}

function isPreBoundGraphImpactSummary(value) {
  return (
    isGraphImpactSummaryShape(value) &&
    isPlainObject(value.graph_quality) &&
    !isPlainObject(value.graph_state) &&
    !isPlainObject(value.warning_counts)
  );
}

function isSidecarGraphImpactResultEnvelope(value) {
  return isPlainObject(value) && isNonEmptyString(value.schema_version);
}

function createBoundedGraphImpactResponse(
  graphImpact,
  { graphImpactSummaryRef = null, lightweightRef = null } = {}
) {
  const boundedSummary = createGraphImpactSummary(graphImpact);
  const normalizedSummaryRef = graphImpactSummaryRef ? normalizeGraphImpactSummaryRefInput(graphImpactSummaryRef) : null;
  const lightweightSummaryRef =
    lightweightRef === null ? isSidecarGraphImpactResultEnvelope(graphImpact) : Boolean(lightweightRef);

  const summaryRef = normalizedSummaryRef
    ? lightweightSummaryRef
      ? omitGraphImpactSummaryRefSummary(normalizedSummaryRef)
      : pruneGraphImpactPayloadFields({
          ...normalizedSummaryRef,
          summary: boundedSummary
        })
    : createGraphImpactSummaryRef(graphImpact, boundedSummary, { lightweight: lightweightSummaryRef });

  return {
    graph_impact: boundedSummary,
    graph_impact_summary: boundedSummary,
    graph_impact_summary_ref: summaryRef
  };
}

function hasCompactGraphImpactBinding(graphImpact, graphImpactSummaryRef, requestedUnit) {
  if (!isGraphImpactSummaryShape(graphImpact)) {
    return true;
  }

  if (!isPlainObject(graphImpact.unit) || !isPlainObject(graphImpact.graph_state)) {
    return false;
  }

  if (!isPlainObject(graphImpactSummaryRef) || !isGraphImpactSummaryShape(graphImpactSummaryRef.summary)) {
    return false;
  }

  const normalizedRequestedUnit = normalizeGraphImpactUnit(requestedUnit);
  const normalizedGraphImpactUnit = normalizeGraphImpactUnit(graphImpact.unit);
  const normalizedSummaryUnit =
    normalizeGraphImpactUnit(graphImpactSummaryRef.summary.unit) ??
    normalizeGraphImpactUnit(graphImpactSummaryRef.unit);

  if (
    !areGraphImpactUnitsEqual(normalizedRequestedUnit, normalizedGraphImpactUnit) ||
    !areGraphImpactUnitsEqual(normalizedRequestedUnit, normalizedSummaryUnit)
  ) {
    return false;
  }

  const summaryQueryKind = isNonEmptyString(graphImpact.query_kind) ? String(graphImpact.query_kind).trim() : null;
  const summaryRefQueryKind = isNonEmptyString(graphImpactSummaryRef.summary.query_kind)
    ? String(graphImpactSummaryRef.summary.query_kind).trim()
    : null;
  if (!summaryQueryKind || !summaryRefQueryKind || summaryQueryKind !== summaryRefQueryKind) {
    return false;
  }

  const artifactRef = isNonEmptyString(graphImpactSummaryRef.artifact_ref)
    ? graphImpactSummaryRef.artifact_ref.trim()
    : null;
  if (
    artifactRef &&
    (!(
      hasDeclaredGraphImpactPathList(graphImpactSummaryRef, "input_paths") ||
      hasDeclaredGraphImpactPathList(graphImpactSummaryRef.summary, "input_paths")
    ) ||
      !(
        hasDeclaredGraphImpactPathList(graphImpactSummaryRef, "validated_paths") ||
        hasDeclaredGraphImpactPathList(graphImpactSummaryRef.summary, "validated_paths")
      ))
  ) {
    return false;
  }

  const summaryInputPaths = normalizeGraphImpactPathList(graphImpact.input_paths);
  const summaryValidatedPaths = normalizeGraphImpactPathList(graphImpact.validated_paths);
  const refInputPaths = normalizeGraphImpactPathList(
    graphImpactSummaryRef.input_paths ?? graphImpactSummaryRef.summary.input_paths
  );
  const refValidatedPaths = normalizeGraphImpactPathList(
    graphImpactSummaryRef.validated_paths ?? graphImpactSummaryRef.summary.validated_paths
  );

  if (
    hasDeclaredGraphImpactPathList(graphImpact, "input_paths") &&
    !areGraphImpactPathListsEqual(summaryInputPaths, refInputPaths)
  ) {
    return false;
  }
  if (
    hasDeclaredGraphImpactPathList(graphImpact, "validated_paths") &&
    !areGraphImpactPathListsEqual(summaryValidatedPaths, refValidatedPaths)
  ) {
    return false;
  }

  const sourceRecordDigest =
    [
      graphImpact.source_record_digest,
      graphImpactSummaryRef.summary.source_record_digest,
      graphImpactSummaryRef.source_record_digest
    ]
      .map(normalizeGraphImpactSourceRecordDigest)
      .find(Boolean) ?? null;
  if (
    [
      graphImpact.source_record_digest,
      graphImpactSummaryRef.summary.source_record_digest,
      graphImpactSummaryRef.source_record_digest
    ].some((candidate) => isNonEmptyString(candidate)) &&
    !sourceRecordDigest
  ) {
    return false;
  }
  if (!sourceRecordDigest) {
    return false;
  }

  return (
    isNonEmptyString(graphImpactSummaryRef.binding_token) ||
    isNonEmptyString(graphImpactSummaryRef.raw_evidence_digest) ||
    isNonEmptyString(graphImpactSummaryRef.raw_evidence_ref) ||
    isNonEmptyString(graphImpactSummaryRef.ref) ||
    isNonEmptyString(graphImpactSummaryRef.ref_id) ||
    isNonEmptyString(graphImpactSummaryRef.digest) ||
    isNonEmptyString(graphImpactSummaryRef.artifact_ref)
  );
}

function applyServerBoundGraphImpactUnitAndDigest(value, { unit = null, sourceRecordDigest = null } = {}) {

  if (!isPlainObject(value)) {
    return value;
  }

  const normalizedUnit = normalizeGraphImpactUnit(unit);
  const normalizedDigest = normalizeGraphImpactSourceRecordDigest(sourceRecordDigest);
  if (!normalizedUnit && !normalizedDigest) {
    return cloneJson(value);
  }

  const next = cloneJson(value);
  const stampBinding = (target) => {
    if (!isPlainObject(target)) {
      return;
    }

    if (normalizedUnit && target.unit == null) {
      target.unit = { ...normalizedUnit };
    }

    const existingDigestIsValid = Boolean(
      normalizeGraphImpactSourceRecordDigest(target.source_record_digest)
    );
    if (!existingDigestIsValid && isNonEmptyString(target.source_record_digest)) {
      delete target.source_record_digest;
    }
    if (normalizedDigest && !existingDigestIsValid) {
      target.source_record_digest = normalizedDigest;
    }
  };

  stampBinding(next);
  if (isPlainObject(next.summary)) {
    stampBinding(next.summary);
  }

  return next;
}

function mergeCompactGraphImpactEvidence(graphImpact, graphImpactSummaryRef) {
  if (!isGraphImpactSummaryShape(graphImpact) || !isPlainObject(graphImpactSummaryRef)) {
    return graphImpact;
  }

  const merged = cloneJson(graphImpact);
  for (const field of ["input_paths", "validated_paths", "invalid_paths"]) {
    const refValue = Array.isArray(graphImpactSummaryRef[field])
      ? graphImpactSummaryRef[field]
      : Array.isArray(graphImpactSummaryRef.summary?.[field])
        ? graphImpactSummaryRef.summary[field]
        : null;
    if (!refValue) {
      continue;
    }

    if (!Array.isArray(merged[field])) {
      merged[field] = cloneJson(refValue);
      continue;
    }

    const normalizedExisting = normalizeGraphImpactPathList(merged[field]);
    const normalizedRef = normalizeGraphImpactPathList(refValue);
    if (!areGraphImpactPathListsEqual(normalizedExisting, normalizedRef)) {
      return null;
    }
  }

  return pruneGraphImpactPayloadFields(merged);
}

export {
  WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND,
  WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION,
  applyServerBoundGraphImpactUnitAndDigest,
  areGraphImpactPathListsEqual,
  areGraphImpactUnitsEqual,
  compactGraphImpactSummaryAffectedSurfaces,
  createBoundedGraphImpactResponse,
  createGraphImpactSummary,
  createGraphImpactSummaryRef,
  hasCompactGraphImpactBinding,
  hasDeclaredGraphImpactPathList,
  isFilesystemPathLikeGraphImpactArtifactRef,
  isGraphImpactRawEvidenceDigest,
  isGraphImpactOpaqueReferenceToken,
  isGraphImpactSummaryShape,
  isPreBoundGraphImpactSummary,
  mergeCompactGraphImpactEvidence,
  normalizeGraphImpactPathList,
  normalizeGraphImpactRawEvidenceProvenance,
  normalizeGraphImpactSummaryRefInput,
  normalizeGraphImpactUnit,
  omitGraphImpactSummaryRefSummary
};

export default {
  WORK_RECORD_GRAPH_IMPACT_SUMMARY_KIND,
  WORK_RECORD_GRAPH_IMPACT_SUMMARY_SCHEMA_VERSION,
  applyServerBoundGraphImpactUnitAndDigest,
  areGraphImpactPathListsEqual,
  areGraphImpactUnitsEqual,
  compactGraphImpactSummaryAffectedSurfaces,
  createBoundedGraphImpactResponse,
  createGraphImpactSummary,
  createGraphImpactSummaryRef,
  hasCompactGraphImpactBinding,
  hasDeclaredGraphImpactPathList,
  isFilesystemPathLikeGraphImpactArtifactRef,
  isGraphImpactRawEvidenceDigest,
  isGraphImpactOpaqueReferenceToken,
  isGraphImpactSummaryShape,
  isPreBoundGraphImpactSummary,
  mergeCompactGraphImpactEvidence,
  normalizeGraphImpactPathList,
  normalizeGraphImpactRawEvidenceProvenance,
  normalizeGraphImpactSummaryRefInput,
  normalizeGraphImpactUnit,
  omitGraphImpactSummaryRefSummary
};
