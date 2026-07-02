import { computeNormalizedInputDigest, isObject, isNonEmptyString, toNonNegativeInteger } from "./work-record-admission-shared.mjs";
import { normalizeStructuralTargetResolverEvidence } from "./work-record-target-resolver.mjs";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

const WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES = Object.freeze([
  "function",
  "method",
  "class",
  "module",
  "export",
  "test_case",
  "schema_field",
  "docs_section",
  "config_key",
  "other"
]);

const WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES = Object.freeze([
  "create",
  "modify",
  "delete",
  "inspect"
]);

const WORK_RECORD_TARGET_EVIDENCE_CANONICAL_SOURCE_KIND = "canonical_work_record";
const WORK_RECORD_TARGET_EVIDENCE_CANONICALITY = "canonical";
const WORK_RECORD_TARGET_EVIDENCE_BASIS = "normalized_target_projection";
const WORK_RECORD_TARGET_EVIDENCE_POLICY_BACKEND = "portfolio-local";
const WORK_RECORD_TARGET_EVIDENCE_POLICY_VERSION = "worker-admission-policy.v1";

function normalizeString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeRepoPath(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const repoPath = normalized.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    repoPath.startsWith("/") ||
    repoPath.startsWith("~") ||
    repoPath === ".." ||
    repoPath.startsWith("../") ||
    repoPath.includes("/../") ||
    repoPath.endsWith("/..") ||
    repoPath.includes("/./")
  ) {
    return null;
  }

  return repoPath;
}

function countUniqueStrings(values) {
  return new Set((Array.isArray(values) ? values : []).map(normalizeString).filter(Boolean)).size;
}

function targetKey(value) {
  if (!isObject(value)) {
    return null;
  }
  const path = normalizeRepoPath(value.path);
  const kind = normalizeString(value.kind)?.toLowerCase() ?? null;
  const name = normalizeString(value.name);
  const operation = normalizeString(value.operation)?.toLowerCase() ?? null;
  return path && kind && name && operation ? `${path}\0${kind}\0${name}\0${operation}` : null;
}

function normalizeSha256Digest(value) {
  const normalized = normalizeString(value);
  return normalized && SHA256_PATTERN.test(normalized) ? normalized : null;
}

function normalizeCompleteWorkUnitAddress(value) {
  const unit = normalizeWorkUnitAddress(value);
  if (!unit) {
    return null;
  }

  const kind = normalizeString(unit.kind)?.toLowerCase() ?? null;
  const recordId = normalizeString(unit.record_id);
  const sliceId = normalizeString(unit.slice_id);
  const address = normalizeString(unit.address);

  if (!kind || !recordId || !address) {
    return null;
  }

  if (kind === "slice" && !sliceId) {
    return null;
  }

  if (kind === "work_item" && sliceId) {
    return null;
  }

  return {
    ...unit,
    kind
  };
}

function normalizeWorkUnitAddressComparable(left, right) {
  if (!left || !right) {
    return false;
  }

  for (const field of ["kind", "address", "record_id", "slice_id", "repo"]) {
    if (left[field] !== null && right[field] !== null && left[field] !== right[field]) {
      return false;
    }
  }

  return true;
}

function normalizeWorkUnitAddress(value) {
  if (isNonEmptyString(value)) {
    const address = normalizeString(value);
    return address
      ? {
          kind: address.includes("#") ? "slice" : "work_item",
          address,
          record_id: null,
          slice_id: null,
          repo: null
        }
      : null;
  }

  if (!isObject(value)) {
    return null;
  }

  const recordId = normalizeString(value.record_id ?? value.recordId);
  const sliceId = normalizeString(value.slice_id ?? value.sliceId);
  const address =
    normalizeString(value.address ?? value.work_unit_address ?? value.workUnitAddress) ??
    (recordId ? (sliceId ? `${recordId}#${sliceId}` : recordId) : null);
  const kind = normalizeString(value.kind)?.toLowerCase() ?? (sliceId ? "slice" : recordId ? "work_item" : null);
  const repo = normalizeString(value.repo ?? value.repository);

  if (!recordId && !sliceId && !address && !repo) {
    return null;
  }

  return {
    kind,
    address,
    record_id: recordId,
    slice_id: sliceId,
    repo
  };
}

function normalizeTargetEvidenceProducer(value) {
  if (!isObject(value)) {
    return null;
  }

  const id = normalizeString(value.id ?? value.name ?? value.provider ?? value.source);
  const version = normalizeString(value.version ?? value.provider_version ?? value.revision);
  const mode = normalizeString(value.mode)?.toLowerCase();

  if (!id || !version || !mode) {
    return null;
  }

  return {
    id,
    version,
    mode
  };
}

function normalizeExpectedPayloadBoundInputDigest(value) {
  if (!isObject(value)) {
    return {
      value: null,
      status: "absent",
      alias_present: false
    };
  }

  const canonicalRawDigest = normalizeString(
    value.expected_payload_bound_input_digest ?? value.expectedPayloadBoundInputDigest
  );
  if (canonicalRawDigest) {
    const normalizedDigest = normalizeSha256Digest(canonicalRawDigest);
    return {
      value: normalizedDigest,
      status: normalizedDigest ? "valid" : "invalid",
      alias_present: false
    };
  }

  const aliasRawDigest = normalizeString(value.expected_payload_digest ?? value.expectedPayloadDigest);
  if (!aliasRawDigest) {
    return {
      value: null,
      status: "absent",
      alias_present: false
    };
  }

  return {
    value: null,
    status: "alias",
    alias_present: Boolean(normalizeSha256Digest(aliasRawDigest))
  };
}

function normalizeTargetEvidenceProvenance(value, context = {}) {
  const contextSelectedUnit = normalizeWorkUnitAddress(
    context.selected_unit ?? context.selectedUnit ?? context.unit ?? context.work_unit_address ?? context.workUnitAddress
  );
  const contextSelectedUnitBinding = normalizeCompleteWorkUnitAddress(contextSelectedUnit);
  const contextSourceRecordDigest = normalizeSha256Digest(
    context.source_record_digest ?? context.sourceRecordDigest
  );
  const contextPayloadBoundInputDigest = normalizeSha256Digest(
    context.payload_bound_input_digest ?? context.payloadBoundInputDigest
  );
  const contextExpectedPayloadBoundInputDigest = normalizeSha256Digest(
    context.expected_payload_bound_input_digest ?? context.expectedPayloadBoundInputDigest
  );
  const metricSourceProvenanceFallbackUsed = context.metric_source_provenance_fallback_used === true;
  const callerExpectedPayloadBoundInputDigest = normalizeExpectedPayloadBoundInputDigest(value);

  if (!isObject(value)) {
    const normalizedInputDigestValue = computeNormalizedInputDigest({
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_target_projection",
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
      source_record_digest: contextSourceRecordDigest,
      selected_unit: contextSelectedUnit,
      producer: null
    });

    return {
      source_kind: "canonical_work_record",
      canonicality: "canonical",
      evidence_basis: "normalized_target_projection",
      normalized_input_digest: normalizedInputDigestValue,
      policy_backend: "portfolio-local",
      policy_version: "worker-admission-policy.v1",
      source_record_digest: contextSourceRecordDigest,
      selected_unit: contextSelectedUnit,
      payload_bound_input_digest: contextPayloadBoundInputDigest,
      expected_payload_bound_input_digest: null,
      producer: null,
      binding_status: "absent",
      binding_reason: "no structural target provenance supplied"
    };
  }

  const sourceKind = normalizeString(value.source_kind ?? value.sourceKind) ?? WORK_RECORD_TARGET_EVIDENCE_CANONICAL_SOURCE_KIND;
  const canonicality = normalizeString(value.canonicality) ?? WORK_RECORD_TARGET_EVIDENCE_CANONICALITY;
  const evidenceBasis = normalizeString(value.evidence_basis ?? value.evidenceBasis) ?? WORK_RECORD_TARGET_EVIDENCE_BASIS;
  const policyBackend = normalizeString(value.policy_backend ?? value.policyBackend) ?? WORK_RECORD_TARGET_EVIDENCE_POLICY_BACKEND;
  const policyVersion = normalizeString(value.policy_version ?? value.policyVersion) ?? WORK_RECORD_TARGET_EVIDENCE_POLICY_VERSION;
  const normalizedInputDigestInput = normalizeString(value.normalized_input_digest ?? value.normalizedInputDigest);
  const normalizedInputDigest = normalizeSha256Digest(normalizedInputDigestInput);
  const sourceRecordDigest = normalizeSha256Digest(
    value.source_record_digest ?? value.sourceRecordDigest ?? value.record_digest ?? value.recordDigest
  );
  const selectedUnit = normalizeWorkUnitAddress(
    value.unit ?? value.selected_unit ?? value.selectedUnit ?? value.work_unit_address ?? value.workUnitAddress
  );
  const selectedUnitBinding = normalizeCompleteWorkUnitAddress(selectedUnit);
  const expectedSourceRecordDigest = normalizeSha256Digest(
    value.expected_source_record_digest ??
      value.expectedSourceRecordDigest ??
      value.source_record_digest_expected ??
      value.sourceRecordDigestExpected
  );
  const sourceUnit = normalizeWorkUnitAddress(value.source_unit ?? value.sourceUnit);
  const sourceUnitBinding = normalizeCompleteWorkUnitAddress(sourceUnit);
  const hasSourceUnitInput = isObject(value.source_unit ?? value.sourceUnit) || isNonEmptyString(value.source_unit ?? value.sourceUnit);
  const producer = normalizeTargetEvidenceProducer(value.producer ?? value.provider ?? value.generator);
  const contextSelectedUnitValid = Boolean(contextSelectedUnitBinding);
  const contextSourceRecordDigestValid = Boolean(contextSourceRecordDigest);

  let trustStatus = "absent";
  let trustReason = "no structural target provenance supplied";

  if (isObject(value)) {
    trustStatus = "unavailable";
    trustReason = "trusted producer metadata is required";

    if (!contextSelectedUnitValid) {
      trustStatus = "unavailable";
      trustReason = "selected unit context not supplied";
    } else if (!contextSourceRecordDigestValid) {
      trustStatus = "unavailable";
      trustReason = "source record digest context not supplied";
    } else if (sourceKind !== WORK_RECORD_TARGET_EVIDENCE_CANONICAL_SOURCE_KIND) {
      trustStatus = "unavailable";
      trustReason = "target provenance source_kind must be canonical_work_record";
    } else if (canonicality !== WORK_RECORD_TARGET_EVIDENCE_CANONICALITY) {
      trustStatus = "unavailable";
      trustReason = "target provenance canonicality must be canonical";
    } else if (evidenceBasis !== WORK_RECORD_TARGET_EVIDENCE_BASIS) {
      trustStatus = "unavailable";
      trustReason = "target provenance evidence_basis must be normalized_target_projection";
    } else if (policyBackend !== WORK_RECORD_TARGET_EVIDENCE_POLICY_BACKEND) {
      trustStatus = "unavailable";
      trustReason = "target provenance policy_backend must be portfolio-local";
    } else if (policyVersion !== WORK_RECORD_TARGET_EVIDENCE_POLICY_VERSION) {
      trustStatus = "unavailable";
      trustReason = "target provenance policy_version must be worker-admission-policy.v1";
    } else if (!producer) {
      trustStatus = "unavailable";
      trustReason = "trusted producer metadata is required";
    } else if (normalizedInputDigestInput && !normalizedInputDigest) {
      trustStatus = "unavailable";
      trustReason = "target provenance normalized_input_digest is invalid";
    } else if (!selectedUnitBinding) {
      trustStatus = "unavailable";
      trustReason = "target evidence is missing selected unit binding";
    } else if (hasSourceUnitInput && !sourceUnitBinding) {
      trustStatus = "unavailable";
      trustReason = "target evidence is missing source unit binding";
    } else if (!sourceRecordDigest) {
      trustStatus = "unavailable";
      trustReason = "target evidence is missing a source_record_digest binding";
    } else if (
      sourceRecordDigest &&
      expectedSourceRecordDigest &&
      sourceRecordDigest !== expectedSourceRecordDigest
    ) {
      trustStatus = "unavailable";
      trustReason = "source record digest mismatch";
    } else if (
      selectedUnitBinding &&
      sourceUnitBinding &&
      !normalizeWorkUnitAddressComparable(selectedUnitBinding, sourceUnitBinding)
    ) {
      trustStatus = "unavailable";
      trustReason = "selected unit mismatch";
    } else if (
      selectedUnitBinding &&
      contextSelectedUnitBinding &&
      !normalizeWorkUnitAddressComparable(selectedUnitBinding, contextSelectedUnitBinding)
    ) {
      trustStatus = "unavailable";
      trustReason = "selected unit mismatch";
    } else if (
      sourceRecordDigest &&
      contextSourceRecordDigest &&
      sourceRecordDigest !== contextSourceRecordDigest
    ) {
      trustStatus = "unavailable";
      trustReason = "source record digest mismatch";
    } else if (callerExpectedPayloadBoundInputDigest.status === "alias" && !callerExpectedPayloadBoundInputDigest.value) {
      trustStatus = "unavailable";
      trustReason = "expected payload-bound input digest alias is not authoritative";
    } else if (callerExpectedPayloadBoundInputDigest.status === "invalid") {
      trustStatus = "unavailable";
      trustReason = "payload-bound input digest is invalid";
    } else if (callerExpectedPayloadBoundInputDigest.value && !contextExpectedPayloadBoundInputDigest) {
      trustStatus = "unavailable";
      trustReason = "payload-bound input digest context not supplied";
    } else if (
      contextExpectedPayloadBoundInputDigest &&
      contextPayloadBoundInputDigest &&
      contextExpectedPayloadBoundInputDigest !== contextPayloadBoundInputDigest
    ) {
      trustStatus = "unavailable";
      trustReason = "structural target payload digest mismatch";
    } else if (
      !metricSourceProvenanceFallbackUsed &&
      normalizedInputDigest &&
      normalizedInputDigest !==
        computeNormalizedInputDigest({
          source_kind: sourceKind,
          canonicality,
          evidence_basis: evidenceBasis,
          policy_backend: policyBackend,
          policy_version: policyVersion,
          source_record_digest: sourceRecordDigest,
          selected_unit: selectedUnitBinding,
          producer
        })
    ) {
      trustStatus = "unavailable";
      trustReason = "normalized input digest mismatch";
    } else {
      trustStatus = "trusted";
      trustReason = "trusted structural target evidence";
    }
  }

  const normalizedInputDigestValue =
    normalizedInputDigest ??
    computeNormalizedInputDigest({
      source_kind: sourceKind,
      canonicality,
      evidence_basis: evidenceBasis,
      policy_backend: policyBackend,
      policy_version: policyVersion,
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnitBinding,
      producer
    });

  return {
    source_kind: sourceKind,
    canonicality,
    evidence_basis: evidenceBasis,
    normalized_input_digest: normalizedInputDigestValue,
    policy_backend: policyBackend,
    policy_version: policyVersion,
    source_record_digest: sourceRecordDigest,
    selected_unit: selectedUnit,
    payload_bound_input_digest: contextPayloadBoundInputDigest,
    expected_payload_bound_input_digest:
      callerExpectedPayloadBoundInputDigest.value ?? contextExpectedPayloadBoundInputDigest ?? null,
    producer,
    binding_status: trustStatus,
    binding_reason: trustReason
  };
}

function normalizeTargetSpan(value) {
  if (!isObject(value)) {
    return null;
  }

  const startLine = toNonNegativeInteger(value.start_line);
  const endLine = toNonNegativeInteger(value.end_line);
  const lineCount = toNonNegativeInteger(value.line_count);
  const derivedLineCount =
    lineCount ??
    (startLine !== null && endLine !== null && endLine >= startLine ? endLine - startLine + 1 : null);

  if (startLine === null && endLine === null && derivedLineCount === null) {
    return null;
  }

  return {
    start_line: startLine,
    end_line: endLine,
    line_count: derivedLineCount
  };
}

function normalizeTargetFanout(value) {
  if (!isObject(value)) {
    return null;
  }

  const directReferenceCount = toNonNegativeInteger(value.direct_reference_count);
  const affectedSymbolCount = toNonNegativeInteger(value.affected_symbol_count);
  if (directReferenceCount === null && affectedSymbolCount === null) {
    return null;
  }

  return {
    direct_reference_count: directReferenceCount,
    affected_symbol_count: affectedSymbolCount
  };
}

function isResolverEvidenceEntry(value) {
  return isObject(value) &&
    (isObject(value.target) ||
      isNonEmptyString(value.resolution_status) ||
      isNonEmptyString(value.target_resolution_status) ||
      isObject(value.span) ||
      isObject(value.fanout) ||
      Array.isArray(value.candidates));
}

function normalizeResolverEvidenceEntries(value, hasExpectedEditTargets) {
  const rawEntries = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.targets)
      ? value.targets
      : isObject(value) && Array.isArray(value.resolutions)
        ? value.resolutions
        : isResolverEvidenceEntry(value)
          ? [value]
          : [];

  return rawEntries.map((entry) =>
    normalizeStructuralTargetResolverEvidence(entry, { hasExpectedEditTargets })
  );
}

function normalizeResolverEvidenceBinding(value, context = {}) {
  const contextSelectedUnit = normalizeCompleteWorkUnitAddress(
    context.selected_unit ?? context.selectedUnit ?? context.unit ?? context.work_unit_address ?? context.workUnitAddress
  );
  const contextSourceRecordDigest = normalizeSha256Digest(
    context.source_record_digest ?? context.sourceRecordDigest
  );
  const sourceRecordDigest = normalizeSha256Digest(
    value?.source_record_digest ?? value?.sourceRecordDigest ?? value?.record_digest ?? value?.recordDigest
  );
  const selectedUnit = normalizeCompleteWorkUnitAddress(
    normalizeWorkUnitAddress(
      value?.selected_unit ?? value?.selectedUnit ?? value?.unit ?? value?.work_unit_address ?? value?.workUnitAddress
    )
  );
  const producer = normalizeTargetEvidenceProducer(value?.producer ?? value?.provider ?? value?.generator);
  const hasBindingInputs = Boolean(sourceRecordDigest || selectedUnit);

  if (!isObject(value) || !hasBindingInputs) {
    return {
      binding_status: "absent",
      binding_reason: "no structural target provenance supplied",
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      producer
    };
  }

  if (!contextSelectedUnit || !contextSourceRecordDigest) {
    return {
      binding_status: "unavailable",
      binding_reason: !contextSelectedUnit
        ? "selected unit context not supplied"
        : "source record digest context not supplied",
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      producer
    };
  }

  if (!producer) {
    return {
      binding_status: "unavailable",
      binding_reason: "trusted producer metadata is required",
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      producer
    };
  }

  if (!sourceRecordDigest) {
    return {
      binding_status: "unavailable",
      binding_reason: "target evidence is missing a source_record_digest binding",
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      producer
    };
  }

  if (!selectedUnit) {
    return {
      binding_status: "unavailable",
      binding_reason: "target evidence is missing selected unit binding",
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      producer
    };
  }

  if (sourceRecordDigest !== contextSourceRecordDigest) {
    return {
      binding_status: "unavailable",
      binding_reason: "stale target resolution evidence: source record digest mismatch",
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      producer
    };
  }

  if (!normalizeWorkUnitAddressComparable(selectedUnit, contextSelectedUnit)) {
    return {
      binding_status: "unavailable",
      binding_reason: "stale target resolution evidence: selected unit mismatch",
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      producer
    };
  }

  return {
    binding_status: "trusted",
    binding_reason: "trusted structural target evidence",
    source_record_digest: sourceRecordDigest,
    selected_unit: selectedUnit,
    producer
  };
}

function findResolverEvidenceForTarget(target, resolverEvidenceEntries) {
  const key = targetKey(target);
  if (!key) {
    return null;
  }
  return resolverEvidenceEntries.find((entry) => targetKey(entry.target_resolution_target) === key) ?? null;
}

function normalizeFileStatsLike(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (!isObject(entry)) {
        return null;
      }
      const path = normalizeRepoPath(entry.path);
      const loc = toNonNegativeInteger(entry.loc ?? entry.line_count ?? entry.lines);
      return path && loc !== null ? { path, loc } : null;
    })
    .filter(Boolean);
}

function validateControlledValue(value, allowedValues, issueName) {
  const normalized = normalizeString(value)?.toLowerCase() ?? null;
  if (!normalized || !allowedValues.has(normalized)) {
    return {
      value: null,
      status: "invalid",
      evidence: {
        issue: issueName,
        status: "invalid",
        reason: `unsupported ${issueName}`
      }
    };
  }
  return {
    value: normalized,
    status: "valid"
  };
}

export function validateExpectedEditTargetKind(value) {
  return validateControlledValue(
    value,
    new Set(WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES),
    "expected_edit_targets.kind"
  );
}

export function validateExpectedEditTargetOperation(value) {
  return validateControlledValue(
    value,
    new Set(WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES),
    "expected_edit_targets.operation"
  );
}

function normalizeExpectedEditTarget(
  value,
  index,
  targetResolutionEvidenceStatus,
  targetResolutionStatusReason,
  resolverEvidenceEntries,
  forceProviderUnavailableReason = null
) {
  if (!isObject(value)) {
    return {
      index,
      status: "invalid",
      evidence: {
        issue: "expected_edit_targets.entry",
        status: "invalid",
        reason: "expected_edit_targets entries must be objects"
      }
    };
  }

  const path = normalizeRepoPath(value.path);
  const kindResult = validateExpectedEditTargetKind(value.kind);
  const operationResult = validateExpectedEditTargetOperation(value.operation);
  const name = normalizeString(value.name);
  const optional = typeof value.optional === "boolean" ? value.optional : false;
  const targetForResolution = {
    path,
    kind: kindResult.value,
    name,
    operation: operationResult.value
  };
  const matchedResolverEvidence = findResolverEvidenceForTarget(targetForResolution, resolverEvidenceEntries);
  const resolutionStatus = kindResult.value === null || operationResult.value === null
    ? "not_applicable"
    : operationResult.value === "create"
      ? "not_applicable"
      : forceProviderUnavailableReason
        ? "provider_unavailable"
      : matchedResolverEvidence?.target_resolution_status ?? "provider_unavailable";

  const target = {
    path,
    kind: kindResult.value,
    name,
    operation: operationResult.value,
    optional,
    resolution_status: resolutionStatus,
    resolution_reason:
      operationResult.value === "create"
        ? "create target; no pre-existing symbol expected"
        : forceProviderUnavailableReason ?? matchedResolverEvidence?.target_resolution_status_reason ?? targetResolutionStatusReason,
    provider:
      forceProviderUnavailableReason
        ? null
        : matchedResolverEvidence?.target_resolution_provider?.id ?? null,
    span:
      forceProviderUnavailableReason
        ? null
        : matchedResolverEvidence?.target_resolution_span ?? null
  };

  if (kindResult.status === "invalid" || operationResult.status === "invalid" || path === null || name === null) {
    return {
      index,
      ...target,
      status: "invalid",
      evidence: {
        issue: "expected_edit_targets.entry",
        status: "invalid",
        reason: "expected_edit_targets entry is missing required path, kind, name, or operation evidence"
      }
    };
  }

  return {
    index,
    ...target,
    status: "valid",
    evidence: {
      issue: "expected_edit_targets.entry",
      status: matchedResolverEvidence?.target_resolution_evidence_status ?? targetResolutionEvidenceStatus
    }
  };
}

function normalizeResolverEvidence(value, hasExpectedEditTargets, context = {}) {
  if (!isObject(value)) {
    return {
      target_resolution_evidence_status: hasExpectedEditTargets ? "degraded" : "absent",
      target_resolution_provider: null,
      target_resolution_provider_version: null,
      target_resolution_status_reason: hasExpectedEditTargets
        ? "no structural resolver configured"
        : "no expected_edit_targets field supplied",
      binding_status: "absent",
      binding_reason: "no structural target provenance supplied"
    };
  }

  const contextMetricSourceProvenance = isObject(context.metric_source_provenance_input)
    ? context.metric_source_provenance_input
    : isObject(context.metricSourceProvenanceInput)
      ? context.metricSourceProvenanceInput
      : null;
  const fallbackProducer =
    !contextMetricSourceProvenance && isObject(value.metric_source_provenance)
      ? value.metric_source_provenance.producer
      : null;
  const providerInput =
    value.provider ??
    value.provider_metadata ??
    value.producer ??
    value.generator ??
    fallbackProducer;
  const status = normalizeString(value.status)?.toLowerCase();
  const provider = isObject(providerInput)
    ? normalizeString(providerInput.id ?? providerInput.name ?? providerInput.provider ?? providerInput.source)
    : normalizeString(providerInput);
  const providerVersion = isObject(providerInput)
    ? normalizeString(providerInput.version ?? providerInput.provider_version)
    : normalizeString(value.provider_version);
  const reason = normalizeString(value.reason);
  const binding = normalizeResolverEvidenceBinding(value, context);

  return {
    target_resolution_evidence_status:
      status && ["present", "absent", "partial", "degraded"].includes(status)
        ? status
        : hasExpectedEditTargets
          ? "degraded"
          : "absent",
    target_resolution_provider: provider,
    target_resolution_provider_version: providerVersion,
    target_resolution_status_reason:
      reason ??
      (provider
        ? "structural resolver evidence supplied"
        : hasExpectedEditTargets
          ? "no structural resolver configured"
          : "no expected_edit_targets field supplied"),
    binding_status: binding.binding_status,
    binding_reason: binding.binding_reason
  };
}

export function normalizeStructuralTargetMetrics(value = {}) {
  const expectedEditTargets = Array.isArray(value.expected_edit_targets) ? value.expected_edit_targets : null;
  const hasExpectedEditTargets = Array.isArray(expectedEditTargets);
  const selectedUnitContext = normalizeWorkUnitAddress(
    value.unit ?? value.selected_unit ?? value.selectedUnit ?? value.work_unit_address ?? value.workUnitAddress
  );
  const sourceRecordDigestContext = normalizeSha256Digest(value.source_record_digest ?? value.sourceRecordDigest);
  const targetResolutionEvidenceInput = isObject(value.target_resolution_evidence)
    ? value.target_resolution_evidence
    : isObject(value.targetResolutionEvidence)
      ? value.targetResolutionEvidence
      : null;
  const metricSourceProvenanceInput =
    value.metric_source_provenance ?? value.metricSourceProvenance ?? value.provenance ?? value.target_evidence_provenance;
  const nestedMetricSourceProvenanceInput =
    isObject(targetResolutionEvidenceInput?.metric_source_provenance)
      ? targetResolutionEvidenceInput.metric_source_provenance
      : isObject(targetResolutionEvidenceInput?.metricSourceProvenance)
        ? targetResolutionEvidenceInput.metricSourceProvenance
        : null;
  const hasMetricSourceProvenanceInput =
    (isObject(metricSourceProvenanceInput) && Object.keys(metricSourceProvenanceInput).length > 0) ||
    Boolean(nestedMetricSourceProvenanceInput);
  const resolverEvidence = normalizeResolverEvidence(value.target_resolution_evidence, hasExpectedEditTargets, {
    selected_unit: selectedUnitContext,
    source_record_digest: sourceRecordDigestContext,
    metric_source_provenance_input: metricSourceProvenanceInput
  });
  const resolverEvidenceEntries = normalizeResolverEvidenceEntries(
    resolverEvidence.binding_status === "unavailable" ? null : value.target_resolution_evidence,
    hasExpectedEditTargets
  );
  const provisionalTargets = hasExpectedEditTargets
    ? expectedEditTargets.map((entry, index) =>
        normalizeExpectedEditTarget(
          entry,
          index,
          resolverEvidence.target_resolution_evidence_status,
          resolverEvidence.target_resolution_status_reason,
          resolverEvidenceEntries
        )
      )
    : [];
  const payloadBoundInputDigest = computeNormalizedInputDigest({
    source_record_digest: sourceRecordDigestContext,
    selected_unit: selectedUnitContext,
    expected_edit_targets: provisionalTargets,
    target_resolution_evidence: resolverEvidenceEntries
  });
  const metricSourceProvenance = normalizeTargetEvidenceProvenance(
    metricSourceProvenanceInput ?? nestedMetricSourceProvenanceInput,
    {
      selected_unit: selectedUnitContext,
      source_record_digest: sourceRecordDigestContext,
      payload_bound_input_digest: payloadBoundInputDigest,
      metric_source_provenance_fallback_used: !metricSourceProvenanceInput && Boolean(nestedMetricSourceProvenanceInput),
      expected_payload_bound_input_digest:
        normalizeSha256Digest(
          value.metric_source_provenance?.expected_payload_bound_input_digest ??
            value.metricSourceProvenance?.expected_payload_bound_input_digest ??
            value.metric_source_provenance?.expectedPayloadBoundInputDigest ??
            value.metricSourceProvenance?.expectedPayloadBoundInputDigest
        )
    }
  );
  const sourceRecordDigest = metricSourceProvenance?.source_record_digest ?? sourceRecordDigestContext;
  const selectedUnit = metricSourceProvenance?.selected_unit ?? selectedUnitContext;
  const forceProviderUnavailableReason =
    metricSourceProvenance &&
    metricSourceProvenance.binding_status !== "trusted"
      ? metricSourceProvenance.binding_reason
      : null;
  const normalizedTargets = hasExpectedEditTargets
    ? expectedEditTargets.map((entry, index) =>
        normalizeExpectedEditTarget(
          entry,
          index,
          forceProviderUnavailableReason ? "degraded" : resolverEvidence.target_resolution_evidence_status,
          forceProviderUnavailableReason ?? resolverEvidence.target_resolution_status_reason,
          resolverEvidenceEntries,
          forceProviderUnavailableReason
        )
      )
    : [];
  const validTargets = normalizedTargets.filter((entry) => entry.status === "valid");
  const plannedCreateTargetCount = validTargets.filter((entry) => entry.operation === "create").length;
  const plannedModifyTargetCount = validTargets.filter((entry) => entry.operation === "modify").length;
  const plannedDeleteTargetCount = validTargets.filter((entry) => entry.operation === "delete").length;
  const plannedInspectTargetCount = validTargets.filter((entry) => entry.operation === "inspect").length;
  const targetKindCount = countUniqueStrings(validTargets.map((entry) => entry.kind));
  const writeScope = Array.isArray(value.write_scope) ? value.write_scope : [];
  const uniqueWriteScopeCount = countUniqueStrings(writeScope);
  const resolvedTargets = validTargets.filter((entry) => entry.resolution_status === "resolved");
  const resolvedWriteScopePaths = new Set(resolvedTargets.map((entry) => entry.path).filter(Boolean));
  const unresolvedTargetCount = validTargets.filter((entry) =>
    ["provider_unavailable", "unresolved", "unsupported_kind", "missing_path"].includes(entry.resolution_status)
  ).length;
  const ambiguousTargetCount = validTargets.filter((entry) => entry.resolution_status === "ambiguous").length;
  const resolvedSpanLineCounts = resolvedTargets
    .map((entry) => normalizeTargetSpan(entry.span)?.line_count ?? null)
    .filter((entry) => entry !== null);
  const targetSpanLineCount = resolvedSpanLineCounts.length > 0
    ? resolvedSpanLineCounts.reduce((sum, entry) => sum + entry, 0)
    : null;
  const maxTargetSpanLineCount = resolvedSpanLineCounts.length > 0
    ? resolvedSpanLineCounts.reduce((max, entry) => Math.max(max, entry), 0)
    : null;
  const fileStatsByPath = new Map(normalizeFileStatsLike(value.file_stats).map((entry) => [entry.path, entry.loc]));
  const resolvedSpanRatios = resolvedTargets
    .map((entry) => {
      const span = normalizeTargetSpan(entry.span);
      const fileLoc = fileStatsByPath.get(entry.path) ?? null;
      return span && fileLoc && fileLoc > 0 ? span.line_count / fileLoc : null;
    })
    .filter((entry) => entry !== null);
  const targetSpanToFileRatio = resolvedSpanRatios.length > 0 ? Math.max(...resolvedSpanRatios) : null;
  const resolvedFanoutCounts = resolvedTargets
    .map((entry) => {
      const matchedResolverEvidence = findResolverEvidenceForTarget(entry, resolverEvidenceEntries);
      const fanout = normalizeTargetFanout(matchedResolverEvidence?.target_resolution_fanout);
      return fanout?.direct_reference_count ?? fanout?.affected_symbol_count ?? null;
    })
    .filter((entry) => entry !== null);
  const targetDependencyFanoutCount = resolvedFanoutCounts.length > 0 ? Math.max(...resolvedFanoutCounts) : null;
  const trustedTargetDependencyFanoutCeiling = 3;
  const targetDependencyFanoutReason =
    metricSourceProvenance?.binding_status === "trusted" &&
    targetDependencyFanoutCount !== null &&
    targetDependencyFanoutCount > trustedTargetDependencyFanoutCeiling
      ? "expected payload-bound input digest is required"
      : null;
  const normalizedInputDigest = computeNormalizedInputDigest({
    source_record_digest: sourceRecordDigest,
    selected_unit: selectedUnit,
    expected_edit_targets: normalizedTargets,
    target_resolution_evidence_status: forceProviderUnavailableReason ? "degraded" : resolverEvidence.target_resolution_evidence_status,
    target_resolution_provider: forceProviderUnavailableReason ? null : resolverEvidence.target_resolution_provider,
    target_resolution_provider_version: forceProviderUnavailableReason ? null : resolverEvidence.target_resolution_provider_version,
    target_resolution_status_reason: forceProviderUnavailableReason ?? resolverEvidence.target_resolution_status_reason,
    write_scope: Array.isArray(value.write_scope) ? value.write_scope : [],
    file_stats: normalizeFileStatsLike(value.file_stats)
  });
  const bindingStatus =
    targetDependencyFanoutReason
      ? "unavailable"
      : metricSourceProvenance?.binding_status === "unavailable"
        ? "unavailable"
        : resolverEvidence.binding_status === "unavailable"
          ? "unavailable"
          : metricSourceProvenance?.binding_status ?? (sourceRecordDigest || selectedUnit ? "degraded" : "absent");
  const metricSourceBindingReason =
    metricSourceProvenance?.binding_status === "unavailable" ? metricSourceProvenance.binding_reason : null;
  const resolverBindingReason =
    resolverEvidence.binding_status === "unavailable" ? resolverEvidence.binding_reason : null;
  const bindingReason =
    targetDependencyFanoutReason ??
    metricSourceBindingReason ??
    resolverBindingReason ??
    (hasMetricSourceProvenanceInput ? "target provenance was not supplied" : "no structural target provenance supplied");
  const finalBindingReason =
    bindingStatus === "trusted" ? "trusted structural target evidence" : bindingReason;
  const finalProviderUnavailableReason = bindingStatus !== "trusted" ? bindingReason : null;
  const targetResolutionEvidenceStatus = finalProviderUnavailableReason ? "degraded" : resolverEvidence.target_resolution_evidence_status;
  const targetResolutionProvider = finalProviderUnavailableReason ? null : resolverEvidence.target_resolution_provider;
  const targetResolutionProviderVersion = finalProviderUnavailableReason ? null : resolverEvidence.target_resolution_provider_version;
  const targetResolutionStatusReason = finalProviderUnavailableReason ?? resolverEvidence.target_resolution_status_reason;
  const finalTargets = finalProviderUnavailableReason
    ? normalizedTargets.map((entry) => ({
        ...entry,
        ...(entry.status === "valid" && entry.operation !== "create"
          ? {
              resolution_status: "provider_unavailable",
              resolution_reason: finalProviderUnavailableReason,
              provider: null,
              span: null
            }
          : {})
      }))
    : normalizedTargets;
  const finalResolvedTargets = finalProviderUnavailableReason ? [] : resolvedTargets;
  const finalUnresolvedTargetCount = finalProviderUnavailableReason
    ? validTargets.filter((entry) =>
        ["provider_unavailable", "unresolved", "unsupported_kind", "missing_path"].includes(entry.resolution_status)
      ).length
    : unresolvedTargetCount;
  const finalAmbiguousTargetCount = finalProviderUnavailableReason
    ? validTargets.filter((entry) => entry.resolution_status === "ambiguous").length
    : ambiguousTargetCount;
  const finalResolvedSpanLineCounts = finalResolvedTargets
    .map((entry) => normalizeTargetSpan(entry.span)?.line_count ?? null)
    .filter((entry) => entry !== null);
  const finalTargetSpanLineCount = finalResolvedSpanLineCounts.length > 0
    ? finalResolvedSpanLineCounts.reduce((sum, entry) => sum + entry, 0)
    : null;
  const finalMaxTargetSpanLineCount = finalResolvedSpanLineCounts.length > 0
    ? finalResolvedSpanLineCounts.reduce((max, entry) => Math.max(max, entry), 0)
    : null;
  const finalResolvedSpanRatios = finalResolvedTargets
    .map((entry) => {
      const span = normalizeTargetSpan(entry.span);
      const fileLoc = fileStatsByPath.get(entry.path) ?? null;
      return span && fileLoc && fileLoc > 0 ? span.line_count / fileLoc : null;
    })
    .filter((entry) => entry !== null);
  const finalTargetSpanToFileRatio = finalResolvedSpanRatios.length > 0 ? Math.max(...finalResolvedSpanRatios) : null;
  const finalResolvedFanoutCounts = finalResolvedTargets
    .map((entry) => {
      const matchedResolverEvidence = findResolverEvidenceForTarget(entry, resolverEvidenceEntries);
      const fanout = normalizeTargetFanout(matchedResolverEvidence?.target_resolution_fanout);
      return fanout?.direct_reference_count ?? fanout?.affected_symbol_count ?? null;
    })
    .filter((entry) => entry !== null);
  const finalTargetDependencyFanoutCount = finalResolvedFanoutCounts.length > 0 ? Math.max(...finalResolvedFanoutCounts) : null;

  return {
    expected_edit_target_count: hasExpectedEditTargets ? expectedEditTargets.length : 0,
    planned_create_target_count: plannedCreateTargetCount,
    planned_modify_target_count: plannedModifyTargetCount,
    planned_delete_target_count: plannedDeleteTargetCount,
    planned_inspect_target_count: plannedInspectTargetCount,
    target_kind_count: targetKindCount,
    target_resolution_evidence_status: targetResolutionEvidenceStatus,
    target_resolution_provider: targetResolutionProvider,
    target_resolution_provider_version: targetResolutionProviderVersion,
    target_resolution_status_reason: targetResolutionStatusReason,
    resolved_edit_target_count: finalProviderUnavailableReason ? 0 : resolvedTargets.length,
    unresolved_edit_target_count: finalUnresolvedTargetCount,
    ambiguous_edit_target_count: finalAmbiguousTargetCount,
    target_span_line_count: finalTargetSpanLineCount,
    max_target_span_line_count: finalMaxTargetSpanLineCount,
    target_span_to_file_ratio: finalTargetSpanToFileRatio,
    target_dependency_fanout_count: finalTargetDependencyFanoutCount,
    write_scope_without_resolved_targets: Math.max(0, uniqueWriteScopeCount - resolvedWriteScopePaths.size),
    targets: finalTargets,
    source_record_digest: sourceRecordDigest,
    selected_unit: selectedUnit,
    metric_source_provenance: {
      source_kind: metricSourceProvenance?.source_kind ?? "canonical_work_record",
      canonicality: metricSourceProvenance?.canonicality ?? "canonical",
      evidence_basis: metricSourceProvenance?.evidence_basis ?? "normalized_target_projection",
      normalized_input_digest: normalizedInputDigest,
      policy_backend: metricSourceProvenance?.policy_backend ?? "portfolio-local",
      policy_version: metricSourceProvenance?.policy_version ?? "worker-admission-policy.v1",
      source_record_digest: sourceRecordDigest,
      selected_unit: selectedUnit,
      payload_bound_input_digest: finalProviderUnavailableReason ? null : metricSourceProvenance?.payload_bound_input_digest ?? null,
      expected_payload_bound_input_digest: metricSourceProvenance?.expected_payload_bound_input_digest ?? null,
      producer: metricSourceProvenance?.producer ?? null,
      binding_status: bindingStatus,
      binding_reason: finalBindingReason
    }
  };
}
