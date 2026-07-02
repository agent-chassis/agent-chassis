function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeString(value) {
  return isNonEmptyString(value) ? value.trim() : null;
}

function normalizeRepoPath(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replaceAll("\\", "/").replace(/^\.\//u, "") : null;
}

function toNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  return Math.trunc(numeric);
}

function hasAnyDiffFootprintEvidence(source) {
  if (!isObject(source)) {
    return false;
  }

  return [
    "changed_file_count",
    "changed_line_count",
    "added_line_count",
    "deleted_line_count",
    "hunk_count",
    "per_file_diff_footprint"
  ].some((field) => hasOwn(source, field));
}

function normalizeDiffFootprintCountField(source, fieldNames) {
  for (const fieldName of fieldNames) {
    if (!hasOwn(source, fieldName)) {
      continue;
    }

    const rawValue = source[fieldName];
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return {
        value: null,
        status: "missing"
      };
    }

    const normalizedValue = toNonNegativeInteger(rawValue);
    if (normalizedValue === null) {
      return {
        value: null,
        status: "invalid",
        raw_value: rawValue
      };
    }

    return {
      value: normalizedValue,
      status: "valid"
    };
  }

  return {
    value: null,
    status: "missing"
  };
}

function normalizePerFileDiffFootprintEntry(entry, index) {
  if (!isObject(entry)) {
    return {
      index,
      status: "invalid",
      evidence: {
        issue: "per_file_diff_footprint.entry",
        status: "invalid",
        reason: "per_file_diff_footprint entries must be objects"
      }
    };
  }

  const path = normalizeRepoPath(entry.path ?? entry.file ?? entry.target ?? entry.name);
  const changedLineCount = normalizeDiffFootprintCountField(entry, [
    "changed_line_count",
    "changed_lines",
    "line_count"
  ]);
  const addedLineCount = normalizeDiffFootprintCountField(entry, [
    "added_line_count",
    "added_lines",
    "insertions"
  ]);
  const deletedLineCount = normalizeDiffFootprintCountField(entry, [
    "deleted_line_count",
    "deleted_lines",
    "deletions"
  ]);
  const hunkCount = normalizeDiffFootprintCountField(entry, ["hunk_count", "hunks"]);

  const hasInvalidCount =
    changedLineCount.status === "invalid" ||
    addedLineCount.status === "invalid" ||
    deletedLineCount.status === "invalid" ||
    hunkCount.status === "invalid";

  if (path === null) {
    return {
      index,
      status: "invalid",
      evidence: {
        issue: "per_file_diff_footprint.entry",
        status: "invalid",
        reason: "per_file_diff_footprint entry is missing a path"
      }
    };
  }

  if (hasInvalidCount) {
    return {
      index,
      path,
      status: "invalid",
      changed_line_count: changedLineCount.value,
      added_line_count: addedLineCount.value,
      deleted_line_count: deletedLineCount.value,
      hunk_count: hunkCount.value,
      evidence: {
        issue: "per_file_diff_footprint.entry",
        status: "invalid",
        reason: "per_file_diff_footprint entry contains invalid count evidence"
      }
    };
  }

  const derivedChangedLineCount =
    changedLineCount.status === "valid"
      ? changedLineCount.value
      : addedLineCount.value !== null && deletedLineCount.value !== null
        ? addedLineCount.value + deletedLineCount.value
        : null;
  const hasCompleteCountSet =
    derivedChangedLineCount !== null &&
    addedLineCount.value !== null &&
    deletedLineCount.value !== null &&
    hunkCount.value !== null;
  const hasAnyCountEvidence =
    changedLineCount.status !== "missing" ||
    addedLineCount.status !== "missing" ||
    deletedLineCount.status !== "missing" ||
    hunkCount.status !== "missing";

  return {
    index,
    path,
    changed_line_count: derivedChangedLineCount,
    changed_line_count_source:
      changedLineCount.status === "valid" ? "supplied" : derivedChangedLineCount !== null ? "derived" : "missing",
    added_line_count: addedLineCount.value,
    deleted_line_count: deletedLineCount.value,
    hunk_count: hunkCount.value,
    status: hasCompleteCountSet ? "present" : hasAnyCountEvidence ? "partial" : "partial",
    evidence: {
      issue: "per_file_diff_footprint.entry",
      status: hasCompleteCountSet ? "present" : "partial",
      reason: hasCompleteCountSet
        ? "per-file diff footprint supplied"
        : "per-file diff footprint is missing changed-line or hunk evidence"
    }
  };
}

function normalizePerFileDiffFootprint(values) {
  const entries = [];
  let hasInvalidEntry = false;
  let hasPartialEntry = false;

  for (const value of Array.isArray(values) ? values : []) {
    const entry = normalizePerFileDiffFootprintEntry(value, entries.length);
    entries.push(entry);
    if (entry.status === "invalid") {
      hasInvalidEntry = true;
    } else if (entry.status === "partial") {
      hasPartialEntry = true;
    }
  }

  return {
    entries,
    has_invalid_entry: hasInvalidEntry,
    has_partial_entry: hasPartialEntry
  };
}

function deriveAggregateCounts(perFileEntries) {
  const validEntries = (Array.isArray(perFileEntries) ? perFileEntries : []).filter(
    (entry) => isObject(entry) && entry.status !== "invalid" && isNonEmptyString(entry.path)
  );

  const allHaveChangedLineCount = validEntries.every((entry) => entry.changed_line_count !== null);
  const allHaveAddedLineCount = validEntries.every((entry) => entry.added_line_count !== null);
  const allHaveDeletedLineCount = validEntries.every((entry) => entry.deleted_line_count !== null);
  const allHaveHunkCount = validEntries.every((entry) => entry.hunk_count !== null);

  return {
    changed_file_count: validEntries.length,
    changed_line_count: allHaveChangedLineCount
      ? validEntries.reduce((sum, entry) => sum + entry.changed_line_count, 0)
      : null,
    added_line_count: allHaveAddedLineCount ? validEntries.reduce((sum, entry) => sum + entry.added_line_count, 0) : null,
    deleted_line_count: allHaveDeletedLineCount
      ? validEntries.reduce((sum, entry) => sum + entry.deleted_line_count, 0)
      : null,
    hunk_count: allHaveHunkCount ? validEntries.reduce((sum, entry) => sum + entry.hunk_count, 0) : null
  };
}

export function compareChangedLineBudget(actualChangedLineCount, expectedChangedLineBudget) {
  const actual = toNonNegativeInteger(actualChangedLineCount);
  const expected = toNonNegativeInteger(expectedChangedLineBudget);

  if (actual === null || expected === null) {
    return {
      actual_changed_line_count: actual,
      expected_changed_line_budget: expected,
      changed_line_budget_status: "not_comparable",
      changed_line_budget_delta: null,
      changed_line_budget_exceeded: null
    };
  }

  const delta = actual - expected;
  return {
    actual_changed_line_count: actual,
    expected_changed_line_budget: expected,
    changed_line_budget_status: delta > 0 ? "exceeds_budget" : "within_budget",
    changed_line_budget_delta: delta,
    changed_line_budget_exceeded: delta > 0
  };
}

export function normalizeDiffFootprintMetrics(value = {}) {
  if (!isObject(value)) {
    return {
      changed_file_count: null,
      changed_line_count: null,
      added_line_count: null,
      deleted_line_count: null,
      hunk_count: null,
      expected_changed_line_budget: null,
      changed_line_budget_status: "not_comparable",
      changed_line_budget_delta: null,
      changed_line_budget_exceeded: null,
      diff_footprint_evidence_status: "degraded",
      diff_footprint_status_reason: "diff_footprint_metrics must be an object",
      per_file_diff_footprint: []
    };
  }

  const hasWrappedMetrics = hasOwn(value, "diff_footprint_metrics");
  const source = hasWrappedMetrics ? value.diff_footprint_metrics : value;
  const sourceObject = isObject(source) ? source : null;

  if (hasWrappedMetrics && sourceObject === null) {
    return {
      changed_file_count: null,
      changed_line_count: null,
      added_line_count: null,
      deleted_line_count: null,
      hunk_count: null,
      expected_changed_line_budget: null,
      changed_line_budget_status: "not_comparable",
      changed_line_budget_delta: null,
      changed_line_budget_exceeded: null,
      diff_footprint_evidence_status: "degraded",
      diff_footprint_status_reason: "diff_footprint_metrics must be an object",
      per_file_diff_footprint: []
    };
  }

  const hasDirectEvidence = hasAnyDiffFootprintEvidence(sourceObject);
  const hasEvidence = hasWrappedMetrics || hasDirectEvidence;
  if (!hasEvidence) {
    return {
      changed_file_count: null,
      changed_line_count: null,
      added_line_count: null,
      deleted_line_count: null,
      hunk_count: null,
      expected_changed_line_budget: null,
      changed_line_budget_status: "not_comparable",
      changed_line_budget_delta: null,
      changed_line_budget_exceeded: null,
      diff_footprint_evidence_status: "absent",
      diff_footprint_status_reason: "no diff_footprint_metrics field supplied",
      per_file_diff_footprint: []
    };
  }

  const changedFileCount = normalizeDiffFootprintCountField(sourceObject, ["changed_file_count"]);
  const changedLineCount = normalizeDiffFootprintCountField(sourceObject, ["changed_line_count"]);
  const addedLineCount = normalizeDiffFootprintCountField(sourceObject, ["added_line_count"]);
  const deletedLineCount = normalizeDiffFootprintCountField(sourceObject, ["deleted_line_count"]);
  const hunkCount = normalizeDiffFootprintCountField(sourceObject, ["hunk_count"]);
  const expectedChangedLineBudget = normalizeDiffFootprintCountField(sourceObject, ["expected_changed_line_budget"]);

  const normalizedPerFile = normalizePerFileDiffFootprint(sourceObject.per_file_diff_footprint);
  const derivedAggregateCounts = deriveAggregateCounts(normalizedPerFile.entries);

  const normalizedChangedFileCount =
    changedFileCount.status === "valid" ? changedFileCount.value : derivedAggregateCounts.changed_file_count;
  const normalizedChangedLineCount =
    changedLineCount.status === "valid" ? changedLineCount.value : derivedAggregateCounts.changed_line_count;
  const normalizedAddedLineCount =
    addedLineCount.status === "valid" ? addedLineCount.value : derivedAggregateCounts.added_line_count;
  const normalizedDeletedLineCount =
    deletedLineCount.status === "valid" ? deletedLineCount.value : derivedAggregateCounts.deleted_line_count;
  const normalizedHunkCount = hunkCount.status === "valid" ? hunkCount.value : derivedAggregateCounts.hunk_count;

  const comparison = compareChangedLineBudget(
    normalizedChangedLineCount,
    expectedChangedLineBudget.status === "valid" ? expectedChangedLineBudget.value : null
  );

  const hasInvalidEvidence =
    changedFileCount.status === "invalid" ||
    changedLineCount.status === "invalid" ||
    addedLineCount.status === "invalid" ||
    deletedLineCount.status === "invalid" ||
    hunkCount.status === "invalid" ||
    expectedChangedLineBudget.status === "invalid" ||
    normalizedPerFile.has_invalid_entry;

  const suppliedCounts = {
    changed_file_count: changedFileCount.status === "valid" ? changedFileCount.value : null,
    changed_line_count: changedLineCount.status === "valid" ? changedLineCount.value : null,
    added_line_count: addedLineCount.status === "valid" ? addedLineCount.value : null,
    deleted_line_count: deletedLineCount.status === "valid" ? deletedLineCount.value : null,
    hunk_count: hunkCount.status === "valid" ? hunkCount.value : null
  };
  const derivedCounts = derivedAggregateCounts;
  const hasContradiction =
    (suppliedCounts.changed_file_count !== null &&
      derivedCounts.changed_file_count !== null &&
      suppliedCounts.changed_file_count !== derivedCounts.changed_file_count) ||
    (suppliedCounts.changed_line_count !== null &&
      derivedCounts.changed_line_count !== null &&
      suppliedCounts.changed_line_count !== derivedCounts.changed_line_count) ||
    (suppliedCounts.added_line_count !== null &&
      derivedCounts.added_line_count !== null &&
      suppliedCounts.added_line_count !== derivedCounts.added_line_count) ||
    (suppliedCounts.deleted_line_count !== null &&
      derivedCounts.deleted_line_count !== null &&
      suppliedCounts.deleted_line_count !== derivedCounts.deleted_line_count) ||
    (suppliedCounts.hunk_count !== null &&
      derivedCounts.hunk_count !== null &&
      suppliedCounts.hunk_count !== derivedCounts.hunk_count);

  const hasCompleteAggregateCounts =
    normalizedChangedFileCount !== null &&
    normalizedChangedLineCount !== null &&
    normalizedAddedLineCount !== null &&
    normalizedDeletedLineCount !== null &&
    normalizedHunkCount !== null;
  const hasPerFileBreakdown = normalizedPerFile.entries.length > 0;
  const hasZeroDiffClaim =
    normalizedChangedFileCount === 0 &&
    normalizedChangedLineCount === 0 &&
    normalizedAddedLineCount === 0 &&
    normalizedDeletedLineCount === 0 &&
    normalizedHunkCount === 0;

  let diffFootprintEvidenceStatus = "partial";
  let diffFootprintStatusReason = "diff footprint evidence is incomplete";

  if (hasContradiction || hasInvalidEvidence) {
    diffFootprintEvidenceStatus = "degraded";
    diffFootprintStatusReason = hasContradiction
      ? "supplied diff-footprint counts contradict per-file summaries"
      : "diff-footprint evidence contains invalid counts or malformed entries";
  } else if (!hasPerFileBreakdown) {
    if (hasCompleteAggregateCounts && hasZeroDiffClaim) {
      diffFootprintEvidenceStatus = "present";
      diffFootprintStatusReason = "explicit zero-diff evidence supplied";
    } else {
      diffFootprintEvidenceStatus = "partial";
      diffFootprintStatusReason = "per-file diff-footprint summaries are missing";
    }
  } else if (normalizedPerFile.has_partial_entry) {
    diffFootprintEvidenceStatus = "partial";
    diffFootprintStatusReason = "per-file diff-footprint summaries are incomplete";
  } else if (!hasCompleteAggregateCounts) {
    diffFootprintEvidenceStatus = "partial";
    diffFootprintStatusReason = "aggregate diff-footprint counts are incomplete";
  } else {
    diffFootprintEvidenceStatus = "present";
    diffFootprintStatusReason = "diff-footprint evidence supplied";
  }

  if (!hasWrappedMetrics && !hasDirectEvidence) {
    diffFootprintEvidenceStatus = "absent";
    diffFootprintStatusReason = "no diff_footprint_metrics field supplied";
  } else if (hasWrappedMetrics && !hasDirectEvidence && !hasPerFileBreakdown && !hasCompleteAggregateCounts) {
    diffFootprintEvidenceStatus = "degraded";
    diffFootprintStatusReason = "diff_footprint_metrics is empty";
  }

  return {
    changed_file_count: normalizedChangedFileCount,
    changed_line_count: normalizedChangedLineCount,
    added_line_count: normalizedAddedLineCount,
    deleted_line_count: normalizedDeletedLineCount,
    hunk_count: normalizedHunkCount,
    expected_changed_line_budget: comparison.expected_changed_line_budget,
    changed_line_budget_status: comparison.changed_line_budget_status,
    changed_line_budget_delta: comparison.changed_line_budget_delta,
    changed_line_budget_exceeded: comparison.changed_line_budget_exceeded,
    diff_footprint_evidence_status: diffFootprintEvidenceStatus,
    diff_footprint_status_reason: diffFootprintStatusReason,
    per_file_diff_footprint: normalizedPerFile.entries
  };
}
