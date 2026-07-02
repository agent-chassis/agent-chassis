import {
  isNonEmptyString,
  isObject,
  normalizeStringEntry,
  sortStrings,
  toNonNegativeInteger
} from "./work-record-admission-shared.mjs";

export const LARGE_FILE_DEC_AUTHORITY_DIAGNOSTIC_CODES = Object.freeze({
  missing_or_expired: "worker_admission.work_unit_atomicity.large_file_dec_authority_missing_or_expired.v1",
  expired: "worker_admission.work_unit_atomicity.large_file_dec_authority_expired.v1",
  scope_mismatch: "worker_admission.work_unit_atomicity.large_file_dec_authority_scope_mismatch.v1",
  accepted: "worker_admission.work_unit_atomicity.large_file_dec_authority_accepted.v1"
});

export function normalizeLargeFileAuthorityRepoPath(value) {
  const normalized = normalizeStringEntry(value);
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

export function normalizeLargeFileAuthorityUnit(value) {
  if (isNonEmptyString(value)) {
    const address = normalizeStringEntry(value);
    if (!address) {
      return null;
    }
    const parts = address.split("#");
    return {
      kind: parts.length > 1 ? "slice" : "work_item",
      address,
      record_id: parts[0] || null,
      slice_id: parts.length > 1 ? parts.slice(1).join("#") : null
    };
  }

  if (!isObject(value)) {
    return null;
  }

  const recordId = normalizeStringEntry(value.record_id ?? value.recordId);
  const sliceId = normalizeStringEntry(value.slice_id ?? value.sliceId);
  const address =
    normalizeStringEntry(value.address ?? value.work_unit_address ?? value.workUnitAddress) ??
    (recordId ? (sliceId ? `${recordId}#${sliceId}` : recordId) : null);
  const kind = normalizeStringEntry(value.kind)?.toLowerCase() ?? (sliceId ? "slice" : recordId ? "work_item" : null);

  if (!recordId && !sliceId && !address) {
    return null;
  }

  return {
    kind,
    address,
    record_id: recordId,
    slice_id: sliceId
  };
}

export function normalizeLargeFileAuthorityPathList(value) {
  const rawPaths = Array.isArray(value)
    ? value
    : isNonEmptyString(value)
      ? [value]
      : [];
  return sortStrings(rawPaths.map(normalizeLargeFileAuthorityRepoPath).filter(Boolean));
}

export function normalizeLargeFileAuthorityEntry(value) {
  if (!isObject(value)) {
    return null;
  }

  const scope = isObject(value.scope) ? value.scope : {};
  const unit =
    normalizeLargeFileAuthorityUnit(
      value.unit ?? value.selected_unit ?? value.selectedUnit ?? scope.unit ?? scope.selected_unit ?? scope.selectedUnit
    ) ??
    normalizeLargeFileAuthorityUnit(
      isNonEmptyString(value.record_id ?? value.recordId) || isNonEmptyString(value.slice_id ?? value.sliceId)
        ? value
        : null
    );
  const filePaths = normalizeLargeFileAuthorityPathList([
    value.file_path,
    value.filePath,
    value.path,
    value.target_path,
    value.targetPath,
    value.selected_path,
    value.selectedPath,
    ...(Array.isArray(value.file_paths) ? value.file_paths : []),
    ...(Array.isArray(value.paths) ? value.paths : []),
    scope.file_path,
    scope.filePath,
    scope.path,
    scope.target_path,
    scope.targetPath,
    ...(Array.isArray(scope.file_paths) ? scope.file_paths : []),
    ...(Array.isArray(scope.paths) ? scope.paths : []),
    ...(Array.isArray(scope.write_scope) ? scope.write_scope : [])
  ]);
  const status = normalizeStringEntry(value.status ?? value.decision_status ?? value.state)?.toLowerCase() ?? null;
  const authorityRef =
    normalizeStringEntry(value.authority_ref ?? value.authorityRef ?? value.dec_ref ?? value.decRef ?? value.id) ?? null;
  const expiresAt =
    normalizeStringEntry(value.expires_at ?? value.expiresAt ?? scope.expires_at ?? scope.expiresAt) ?? null;
  const maxWriteFileLoc = toNonNegativeInteger(
    value.max_write_file_loc ?? value.maxWriteFileLoc ?? scope.max_write_file_loc ?? scope.maxWriteFileLoc
  );
  const largeFileThreshold = toNonNegativeInteger(
    value.large_file_threshold ?? value.largeFileThreshold ?? value.threshold ?? scope.large_file_threshold ?? scope.threshold
  );
  const permittedOperationShape =
    normalizeStringEntry(
      value.permitted_operation_shape ??
        value.operation_shape ??
        value.operation ??
        scope.permitted_operation_shape ??
        scope.operation_shape ??
        scope.operation
    ) ?? null;

  if (
    !unit &&
    filePaths.length === 0 &&
    !status &&
    !authorityRef &&
    !expiresAt &&
    maxWriteFileLoc === null &&
    largeFileThreshold === null &&
    !permittedOperationShape
  ) {
    return null;
  }

  return {
    status,
    authority_ref: authorityRef,
    expires_at: expiresAt,
    unit,
    file_paths: filePaths,
    max_write_file_loc: maxWriteFileLoc,
    large_file_threshold: largeFileThreshold,
    permitted_operation_shape: permittedOperationShape
  };
}

export function normalizeLargeFileAuthorityEntries(value) {
  const rawEntries = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.authorities)
      ? value.authorities
      : isObject(value)
        ? [value]
        : [];
  return rawEntries.map((entry) => normalizeLargeFileAuthorityEntry(entry)).filter(Boolean);
}

export function normalizeSelectedRequestUnit(request) {
  const unit = isObject(request?.subject?.unit)
    ? request.subject.unit
    : isObject(request?.unit)
      ? request.unit
      : null;
  if (!isObject(unit)) {
    return null;
  }
  const recordId = normalizeStringEntry(unit.record_id ?? unit.recordId);
  const sliceId = normalizeStringEntry(unit.slice_id ?? unit.sliceId);
  const address =
    normalizeStringEntry(unit.address ?? unit.work_unit_address ?? unit.workUnitAddress) ??
    (recordId ? (sliceId ? `${recordId}#${sliceId}` : recordId) : null);
  const kind = normalizeStringEntry(unit.kind)?.toLowerCase() ?? (sliceId ? "slice" : recordId ? "work_item" : null);

  if (!recordId && !sliceId && !address) {
    return null;
  }

  return {
    kind,
    record_id: recordId,
    slice_id: sliceId,
    address
  };
}

export function workUnitAddressesMatch(left, right) {
  if (!left || !right) {
    return false;
  }
  for (const key of ["kind", "record_id", "slice_id", "address"]) {
    if (left[key] !== null && right[key] !== null && left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

export function normalizeLargeFileAuthorityMatchSet(authorities, requestUnit, triggeringPaths, fileLocByPath, now) {
  if (!requestUnit || triggeringPaths.length === 0) {
    return {
      validMatches: [],
      expiredMatches: [],
      scopeMismatchMatches: [],
      missingThresholdMatches: []
    };
  }

  const validMatches = [];
  const expiredMatches = [];
  const scopeMismatchMatches = [];
  const missingThresholdMatches = [];
  const triggeringPathSet = new Set(triggeringPaths);

  for (const authority of authorities) {
    if (authority.status !== "accepted") {
      continue;
    }

    const authorityUnit = authority.unit;
    const unitMatches = workUnitAddressesMatch(authorityUnit, requestUnit);
    const pathMatches = triggeringPaths.filter((path) => authority.file_paths.includes(path));
    const pathsMatchExactly =
      authority.file_paths.length === triggeringPaths.length &&
      authority.file_paths.every((path) => triggeringPathSet.has(path));
    const threshold = authority.max_write_file_loc ?? authority.large_file_threshold;
    const thresholdIsExplicit = threshold !== null;
    const fileLocsMatch =
      pathsMatchExactly &&
      thresholdIsExplicit &&
      pathMatches.every((path) => {
        const fileLoc = fileLocByPath.get(path);
        return fileLoc !== null && fileLoc <= threshold;
      });
    const expiresAt = isNonEmptyString(authority.expires_at) ? Date.parse(authority.expires_at) : Number.NaN;
    const current = Date.parse(now);
    const isExpired = Number.isNaN(expiresAt) || Number.isNaN(current) || expiresAt <= current;

    if (unitMatches && pathsMatchExactly && thresholdIsExplicit && fileLocsMatch && !isExpired) {
      validMatches.push(authority);
      continue;
    }

    if (unitMatches && pathsMatchExactly && thresholdIsExplicit && fileLocsMatch && isExpired) {
      expiredMatches.push(authority);
      continue;
    }

    if (unitMatches && pathsMatchExactly && !thresholdIsExplicit) {
      missingThresholdMatches.push(authority);
      continue;
    }

    if (unitMatches || pathMatches.length > 0 || authority.file_paths.length > 0) {
      scopeMismatchMatches.push(authority);
    }
  }

  return {
    validMatches,
    expiredMatches,
    scopeMismatchMatches,
    missingThresholdMatches
  };
}

export function collectLargeFileAuthorityDiagnostic({ authorities, authorityMatches, triggeringPaths }) {
  const pathList = triggeringPaths.length > 0 ? triggeringPaths.join(", ") : "the selected large file";
  if (authorityMatches.validMatches.length > 0) {
    const authority = authorityMatches.validMatches[0];
    return {
      matched_rule: "accepted_unexpired_large_file_dec_authority",
      reason:
        `accepted scoped large-file authority ${authority.authority_ref || "unknown"} exactly matches the selected unit and large file path${triggeringPaths.length > 1 ? "s" : ""} ${pathList}`,
      reason_code: LARGE_FILE_DEC_AUTHORITY_DIAGNOSTIC_CODES.accepted
    };
  }

  if (authorityMatches.expiredMatches.length > 0) {
    const authorityIds = authorityMatches.expiredMatches
      .map((entry) => entry.authority_ref || "expired_authority")
      .filter(Boolean);
    return {
      matched_rule: "large_file_dec_authority_expired",
      reason:
        `accepted scoped large-file authority ${authorityIds.join(", ")} is expired or missing a valid expiration timestamp for large file path${triggeringPaths.length > 1 ? "s" : ""} ${pathList}`,
      reason_code: LARGE_FILE_DEC_AUTHORITY_DIAGNOSTIC_CODES.expired
    };
  }

  if (authorityMatches.missingThresholdMatches.length > 0) {
    const authorityIds = authorityMatches.missingThresholdMatches
      .map((entry) => entry.authority_ref || "missing_threshold_authority")
      .filter(Boolean);
    return {
      matched_rule: "large_file_dec_authority_missing_or_expired",
      reason:
        `accepted scoped large-file authority ${authorityIds.join(", ")} is missing an explicit max_write_file_loc or large_file_threshold basis for large file path${triggeringPaths.length > 1 ? "s" : ""} ${pathList}`,
      reason_code: LARGE_FILE_DEC_AUTHORITY_DIAGNOSTIC_CODES.missing_or_expired
    };
  }

  if (authorityMatches.scopeMismatchMatches.length > 0) {
    const authorityIds = authorityMatches.scopeMismatchMatches
      .map((entry) => entry.authority_ref || "scope_mismatch_authority")
      .filter(Boolean);
    return {
      matched_rule: "large_file_dec_authority_scope_mismatch",
      reason:
        `accepted scoped large-file authority ${authorityIds.join(", ")} does not exactly match the selected unit and large file path${triggeringPaths.length > 1 ? "s" : ""} ${pathList}`,
      reason_code: LARGE_FILE_DEC_AUTHORITY_DIAGNOSTIC_CODES.scope_mismatch
    };
  }

  if (authorities.length > 0) {
    return {
      matched_rule: "large_file_dec_authority_missing_or_expired",
      reason:
        `no accepted, unexpired scoped large-file authority exactly matches the selected unit and large file path${triggeringPaths.length > 1 ? "s" : ""} ${pathList}`,
      reason_code: LARGE_FILE_DEC_AUTHORITY_DIAGNOSTIC_CODES.missing_or_expired
    };
  }

  return {
    matched_rule: "large_file_dec_authority_missing_or_expired",
    reason:
      `accepted, unexpired scoped large-file authority is required for large file path${triggeringPaths.length > 1 ? "s" : ""} ${pathList}`,
    reason_code: LARGE_FILE_DEC_AUTHORITY_DIAGNOSTIC_CODES.missing_or_expired
  };
}

export function collectLargeFileRemediationTriggeringPaths({ request, reviewThreshold }) {
  const fileStats = Array.isArray(request?.evidence?.source_inputs?.file_stats)
    ? request.evidence.source_inputs.file_stats
    : [];
  const triggeringPaths = [];

  for (const entry of fileStats) {
    if (!isObject(entry)) {
      continue;
    }
    if (normalizeStringEntry(entry.threshold_effect) === "coordination_only") {
      continue;
    }
    const loc = toNonNegativeInteger(entry.loc);
    const path = normalizeStringEntry(entry.path);
    if (loc === null || !path || reviewThreshold === null || loc <= reviewThreshold) {
      continue;
    }
    triggeringPaths.push(path);
  }

  return sortStrings(triggeringPaths);
}

export function hasSingleFileLargeFileDecAuthority(metrics, authorityMatches) {
  const writeScopeCount = toNonNegativeInteger(metrics?.write_scope_count);
  const existingFileCount = toNonNegativeInteger(metrics?.write_scope_existing_file_count);
  return writeScopeCount === 1 && existingFileCount === 1 && authorityMatches.validMatches.length > 0;
}
