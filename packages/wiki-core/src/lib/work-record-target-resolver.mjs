import {
  resolveBoundedJavaScriptFunctionTargetFromSourceText,
  resolveBoundedJavaScriptTestCaseTargetFromSourceText
} from "./work-record-target-function-resolver.mjs";
import { isSupportedRepositoryTestFilePath } from "./work-record-target-test-case-resolver.mjs";

const WORK_RECORD_TARGET_RESOLUTION_PROVIDER_MODE_VALUES = Object.freeze([
  "local",
  "code_index",
  "node_engine",
  "unavailable"
]);

const WORK_RECORD_TARGET_RESOLUTION_STATUS_VALUES = Object.freeze([
  "resolved",
  "unresolved",
  "ambiguous",
  "unsupported_kind",
  "missing_path",
  "not_applicable",
  "provider_unavailable"
]);

const WORK_RECORD_TARGET_RESOLUTION_EVIDENCE_STATUS_VALUES = Object.freeze([
  "present",
  "partial",
  "degraded",
  "absent"
]);

const SUPPORTED_TEST_CASE_TARGET_OPERATIONS = new Set(["create", "modify", "delete", "inspect"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeRepoPath(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replaceAll("\\", "/").replace(/^\.\//u, "") : null;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.trunc(numeric);
}

function normalizeControlledValue(value, allowedValues) {
  const normalized = normalizeString(value)?.toLowerCase().replaceAll("-", "_") ?? null;
  return normalized && allowedValues.has(normalized) ? normalized : null;
}

function normalizeTargetResolutionEvidenceStatus(value) {
  return normalizeControlledValue(value, new Set(WORK_RECORD_TARGET_RESOLUTION_EVIDENCE_STATUS_VALUES));
}

function normalizeTargetResolutionStatus(value) {
  return normalizeControlledValue(value, new Set(WORK_RECORD_TARGET_RESOLUTION_STATUS_VALUES));
}

function normalizeProviderMode(value) {
  return normalizeControlledValue(value, new Set(WORK_RECORD_TARGET_RESOLUTION_PROVIDER_MODE_VALUES));
}

function normalizeCandidateSpan(value) {
  if (!isObject(value)) {
    return null;
  }

  const startLine = normalizeInteger(value.start_line);
  const endLine = normalizeInteger(value.end_line);
  const lineCount = normalizeInteger(value.line_count);
  if (startLine === null && endLine === null && lineCount === null) {
    return null;
  }

  return {
    start_line: startLine,
    end_line: endLine,
    line_count: lineCount
  };
}

function normalizeTargetResolutionProvider(value) {
  if (!isObject(value)) {
    return null;
  }

  const id = normalizeString(value.id);
  const version = normalizeString(value.version ?? value.provider_version);
  const mode = normalizeProviderMode(value.mode);
  if (!id && !version && !mode) {
    return null;
  }

  return {
    id,
    version,
    mode: mode ?? "unavailable"
  };
}

function normalizeTargetResolutionTarget(value) {
  if (!isObject(value)) {
    return {
      path: null,
      kind: null,
      name: null,
      operation: null,
      optional: false
    };
  }

  return {
    path: normalizeRepoPath(value.path),
    kind: normalizeString(value.kind),
    name: normalizeString(value.name),
    operation: normalizeString(value.operation)?.toLowerCase() ?? null,
    optional: value.optional === true
  };
}

function normalizeTargetResolutionCandidate(value) {
  if (!isObject(value)) {
    return null;
  }

  const span = normalizeCandidateSpan(value.span);
  const candidate = {
    path: normalizeRepoPath(value.path),
    kind: normalizeString(value.kind),
    name: normalizeString(value.name),
    span
  };

  if (candidate.path === null && candidate.kind === null && candidate.name === null && candidate.span === null) {
    return null;
  }

  return candidate;
}

function createProviderUnavailableTargetResolutionEvidence(target, reason) {
  return {
    target_resolution_evidence_status: "degraded",
    target_resolution_provider: {
      id: null,
      version: null,
      mode: "unavailable"
    },
    target_resolution_target: target,
    target_resolution_status: "provider_unavailable",
    target_resolution_status_reason: reason,
    target_resolution_span: null,
    target_resolution_fanout: null,
    target_resolution_candidates: []
  };
}

function normalizeResolutionReason(targetResolutionStatus, target) {
  if (target?.operation === "create") {
    return "create target; no pre-existing symbol expected";
  }

  switch (targetResolutionStatus) {
    case "resolved":
      return "exactly one target span or structural target was identified";
    case "unresolved":
      return "no supported target matched the declared target";
    case "ambiguous":
      return "multiple candidates matched and no deterministic winner was selected";
    case "unsupported_kind":
      return "provider does not support the declared target kind";
    case "missing_path":
      return "declared target path was unavailable to the provider";
    case "provider_unavailable":
      return "no structural resolver configured";
    case "not_applicable":
      return "create target; no pre-existing symbol expected";
    default:
      return "resolver evidence supplied";
  }
}

function normalizeTargetResolutionFanout(value) {
  if (!isObject(value)) {
    return null;
  }

  const directReferenceCount = normalizeInteger(value.direct_reference_count);
  const affectedSymbolCount = normalizeInteger(value.affected_symbol_count);
  if (directReferenceCount === null && affectedSymbolCount === null) {
    return null;
  }

  return {
    direct_reference_count: directReferenceCount,
    affected_symbol_count: affectedSymbolCount
  };
}

function isBoundedJavaScriptFunctionTarget(value) {
  return normalizeString(value?.kind)?.toLowerCase() === "function";
}

function normalizeTargetResolverProviderForBoundedSource(value) {
  const normalizedProvider = normalizeTargetResolutionProvider(value);
  if (normalizedProvider) {
    return normalizedProvider;
  }

  return {
    id: "portfolio-local.target-function-resolver",
    version: "0.1.0",
    mode: "local"
  };
}

export function resolveStructuralTargetResolverEvidenceFromExpectedEditTarget(value = {}, options = {}) {
  const rawTarget = value.target ?? value;
  const rawTargetPath = isObject(rawTarget) ? rawTarget.path : undefined;
  const target = normalizeTargetResolutionTarget(rawTarget);
  const hasExpectedEditTargets = options.hasExpectedEditTargets === true;
  const sourceText = normalizeString(value.source_text ?? value.sourceText);
  const targetKind = normalizeString(target.kind)?.toLowerCase() ?? null;

  if (targetKind === "test_case") {
    if (!SUPPORTED_TEST_CASE_TARGET_OPERATIONS.has(target.operation)) {
      return createProviderUnavailableTargetResolutionEvidence(
        { ...target, operation: null },
        "declared target operation was missing or unsupported"
      );
    }
    if (!target.name) {
      return createProviderUnavailableTargetResolutionEvidence(
        target,
        "declared target name was missing or unsupported"
      );
    }

    if (target.operation === "create" && !isSupportedRepositoryTestFilePath(rawTargetPath)) {
      return createProviderUnavailableTargetResolutionEvidence(
        target,
        "target path is not a supported repository JavaScript test file"
      );
    }
  }

  if (target.operation === "create") {
    return normalizeStructuralTargetResolverEvidence(
      {
        ...value,
        target,
        target_resolution_status: "not_applicable",
        target_resolution_evidence_status: value.target_resolution_evidence_status ?? "present"
      },
      options
    );
  }

  if (targetKind === "test_case") {
    const resolved = resolveBoundedJavaScriptTestCaseTargetFromSourceText({

      target: rawTarget,
      source_text: value.source_text ?? value.sourceText,
      source_record_digest: value.source_record_digest ?? value.sourceRecordDigest,
      selected_unit: value.selected_unit ?? value.selectedUnit ?? value.unit,
      normalized_input_digest: value.normalized_input_digest ?? value.normalizedInputDigest,
      payload_bound_input_digest:
        value.payload_bound_input_digest ?? value.payloadBoundInputDigest ?? value.expected_payload_bound_input_digest
    });
    const normalized = normalizeStructuralTargetResolverEvidence(resolved, options);
    normalized.target_resolution_status_reason = resolved.target_resolution_status_reason;
    for (const field of ["source_record_digest", "selected_unit", "payload_bound_input_digest"]) {
      if (Object.prototype.hasOwnProperty.call(resolved, field)) {
        normalized[field] = resolved[field];
      }
    }
    const normalizedInputDigest = normalizeString(
      resolved.normalized_input_digest ?? value.normalized_input_digest ?? value.normalizedInputDigest
    );
    if (normalizedInputDigest) normalized.normalized_input_digest = normalizedInputDigest;
    return normalized;
  }

  if (isBoundedJavaScriptFunctionTarget(target) && sourceText) {
    const resolved = resolveBoundedJavaScriptFunctionTargetFromSourceText({
      target,
      source_text: sourceText,
      provider: normalizeTargetResolverProviderForBoundedSource(value.provider),
      source_record_digest: value.source_record_digest ?? value.sourceRecordDigest,
      selected_unit: value.selected_unit ?? value.selectedUnit ?? value.unit,
      payload_bound_input_digest:
        value.payload_bound_input_digest ?? value.payloadBoundInputDigest ?? value.expected_payload_bound_input_digest
    });

    return normalizeStructuralTargetResolverEvidence(resolved, options);
  }

  if (!sourceText && hasExpectedEditTargets && isBoundedJavaScriptFunctionTarget(target)) {
    return createProviderUnavailableTargetResolutionEvidence(
      target,
      "no bounded source text supplied for expected_edit_targets entry"
    );
  }

  if (targetKind !== null && targetKind !== "function" && targetKind !== "test_case") {
    return normalizeStructuralTargetResolverEvidence(
      { target, target_resolution_status: "unsupported_kind" },
      options
    );
  }

  return normalizeStructuralTargetResolverEvidence(value, options);
}

export function normalizeStructuralTargetResolverEvidence(value = {}, options = {}) {
  const target = normalizeTargetResolutionTarget(value.target ?? value.target_resolution_target ?? value);
  const targetOperation = target.operation;
  const hasExpectedEditTargets = options.hasExpectedEditTargets === true;
  const suppliedProvider = normalizeTargetResolutionProvider(
    value.provider ?? value.target_resolution_provider
  );
  const suppliedStatus = normalizeTargetResolutionStatus(
    value.resolution_status ?? value.status ?? value.target_resolution_status
  );
  const suppliedEvidenceStatus = normalizeTargetResolutionEvidenceStatus(
    value.target_resolution_evidence_status ?? value.evidence_status ?? value.status
  );

  if (targetOperation === "create") {
    return {
      target_resolution_evidence_status: "present",
      target_resolution_provider: null,
      target_resolution_target: target,
      target_resolution_status: "not_applicable",
      target_resolution_status_reason: "create target; no pre-existing symbol expected",
      target_resolution_span: null,
      target_resolution_fanout: null,
      target_resolution_candidates: []
    };
  }

  if (!isObject(value)) {
    return createProviderUnavailableTargetResolutionEvidence(
      target,
      hasExpectedEditTargets ? "no structural resolver configured" : "no expected_edit_targets field supplied"
    );
  }

  const targetResolutionStatus = suppliedStatus ?? "provider_unavailable";
  const evidenceStatus =
    suppliedEvidenceStatus ??
    (targetResolutionStatus === "resolved" ? "present" : targetResolutionStatus === "ambiguous" ? "partial" : "degraded");
  const normalizedProvider =
    suppliedProvider ?? (targetResolutionStatus === "provider_unavailable" ? { id: null, version: null, mode: "unavailable" } : null);
  const span = normalizeCandidateSpan(value.span ?? value.target_resolution_span);
  const fanout = normalizeTargetResolutionFanout(value.fanout ?? value.target_resolution_fanout);
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.map((entry) => normalizeTargetResolutionCandidate(entry)).filter(Boolean)
    : Array.isArray(value.target_resolution_candidates)
      ? value.target_resolution_candidates.map((entry) => normalizeTargetResolutionCandidate(entry)).filter(Boolean)
    : [];

  if (targetResolutionStatus === "provider_unavailable") {
    return {
      target_resolution_evidence_status: evidenceStatus === "absent" ? "degraded" : evidenceStatus,
      target_resolution_provider: normalizedProvider ?? {
        id: null,
        version: null,
        mode: "unavailable"
      },
      target_resolution_target: target,
      target_resolution_status: "provider_unavailable",
      target_resolution_status_reason: normalizeResolutionReason("provider_unavailable", target),
      target_resolution_span: null,
      target_resolution_fanout: null,
      target_resolution_candidates: []
    };
  }

  return {
    target_resolution_evidence_status:
      targetResolutionStatus === "resolved"
        ? evidenceStatus === "degraded"
          ? "present"
          : evidenceStatus
        : evidenceStatus,
    target_resolution_provider: normalizedProvider,
    target_resolution_target: target,
    target_resolution_status:
      targetResolutionStatus === "provider_unavailable" ? "provider_unavailable" : targetResolutionStatus,
    target_resolution_status_reason: normalizeResolutionReason(targetResolutionStatus, target),
    target_resolution_span:
      targetResolutionStatus === "resolved" || targetResolutionStatus === "ambiguous" ? span : null,
    target_resolution_fanout:
      targetResolutionStatus === "resolved" || targetResolutionStatus === "ambiguous" ? fanout : null,
    target_resolution_candidates:
      targetResolutionStatus === "ambiguous" || targetResolutionStatus === "unresolved" ? candidates : []
  };
}

export {
  WORK_RECORD_TARGET_RESOLUTION_EVIDENCE_STATUS_VALUES,
  WORK_RECORD_TARGET_RESOLUTION_PROVIDER_MODE_VALUES,
  WORK_RECORD_TARGET_RESOLUTION_STATUS_VALUES,
  createProviderUnavailableTargetResolutionEvidence,
  normalizeTargetResolutionCandidate,
  normalizeTargetResolutionEvidenceStatus,
  normalizeTargetResolutionFanout,
  normalizeTargetResolutionProvider,
  normalizeTargetResolutionStatus,
  normalizeTargetResolutionTarget
};
