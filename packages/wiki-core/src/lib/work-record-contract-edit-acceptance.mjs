

import { canonicalizeWorkRecordReadScope } from "./work-record-schema.mjs";
import {
  cloneJson,
  collectJsonDiffPaths,
  createDiagnostic,
  diagnosticPathIsWithin,
  findSliceIndexes,
  isObject
} from "./work-record-contract-edit-shared.mjs";

const PERSISTED_DIFF_DIAGNOSTIC_PATH_LIMIT = 5;
const PERSISTED_DIFF_DIAGNOSTIC_PATH_LENGTH_LIMIT = 96;

export const WORK_RECORD_ACCEPTANCE_REPAIR_MANAGED_PATHS = Object.freeze(["updated"]);

export function assessAcceptanceRepairEligibility(
  record,
  { sliceId = null, diagnostics = [] } = {}
) {
  if (!isObject(record)) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "acceptance_repair_unparseable_base",
        "set_acceptance repair requires a structurally parsed work-record object",
        { path: null }
      )
    };
  }

  let acceptancePath = "acceptance";
  let sliceIndex = null;
  if (sliceId !== null && sliceId !== undefined) {
    const indexes = findSliceIndexes(record, sliceId);
    if (indexes.length === 0) {
      return {
        ok: false,
        diagnostic: createDiagnostic("slice_not_found", `Slice '${sliceId}' does not exist on ${record.id}`, {
          path: "unit"
        })
      };
    }
    if (indexes.length !== 1) {
      return {
        ok: false,
        diagnostic: createDiagnostic(
          "acceptance_repair_ambiguous_slice",
          `set_acceptance repair requires exactly one slice '${sliceId}', found ${indexes.length}`,
          { path: "unit" }
        )
      };
    }
    sliceIndex = indexes[0];
    acceptancePath = `slices[${sliceIndex}].acceptance`;
  }

  const enumerableRecord = cloneJson(record);
  const canonicalRecord = canonicalizeWorkRecordReadScope(enumerableRecord);
  const normalizationDiff = collectJsonDiffPaths(enumerableRecord, canonicalRecord);
  if (normalizationDiff.length > 0) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "acceptance_repair_non_canonical_record",
        `set_acceptance repair refuses a base record that persistence would normalize outside the selected acceptance subtree: ${normalizationDiff.join(", ")}`,
        { path: normalizationDiff[0] }
      )
    };
  }

  const baseErrors = diagnostics.filter((entry) => entry?.severity === "error");
  const outsideError = baseErrors.find(
    (entry) => !diagnosticPathIsWithin(entry?.path, acceptancePath)
  );
  if (outsideError) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "acceptance_repair_invalidity_outside_target",
        `set_acceptance repair refuses base error '${outsideError.code}' outside ${acceptancePath}`,
        { path: outsideError.path ?? null }
      )
    };
  }

  if (baseErrors.length === 0) {
    return {
      ok: false,
      diagnostic: createDiagnostic(
        "acceptance_repair_valid_base_not_required",
        "the invalid-base repair path requires at least one base error diagnostic",
        { path: acceptancePath }
      )
    };
  }

  return { ok: true, acceptancePath, sliceIndex };
}

export function guardAcceptanceRepairPersistedDiff(
  baseRecord,
  candidateRecord,
  {
    sliceIndex = null,
    hasCriteria = false,
    hasValidation = false,
    managedPaths = WORK_RECORD_ACCEPTANCE_REPAIR_MANAGED_PATHS
  } = {}
) {
  const normalizedBase = canonicalizeWorkRecordReadScope(cloneJson(baseRecord));
  const normalizedCandidate = canonicalizeWorkRecordReadScope(cloneJson(candidateRecord));
  const acceptancePath = sliceIndex === null ? "acceptance" : `slices[${sliceIndex}].acceptance`;
  const allowedPaths = new Set(managedPaths);
  if (hasCriteria) {
    allowedPaths.add(`${acceptancePath}.criteria`);
  }
  if (hasValidation) {
    allowedPaths.add(`${acceptancePath}.validation`);
  }

  const diffPaths = collectJsonDiffPaths(normalizedBase, normalizedCandidate);
  const disallowedPath = diffPaths.find(
    (entry) =>
      !Array.from(allowedPaths).some(
        (allowedPath) => entry === allowedPath || entry.startsWith(`${allowedPath}[`)
      )
  );
  if (disallowedPath) {
    return {
      ok: false,
      normalizedCandidate: null,
      diffPaths,
      diagnostic: createDiagnostic(
        "acceptance_repair_diff_guard_failed",
        `set_acceptance repair would persist an unauthorized change at ${disallowedPath}`,
        { path: disallowedPath }
      )
    };
  }

  return { ok: true, normalizedCandidate, diffPaths, diagnostic: null };
}

function boundPersistedDiffPaths(diffPaths) {
  return diffPaths
    .slice(0, PERSISTED_DIFF_DIAGNOSTIC_PATH_LIMIT)
    .map((entry) =>
      entry.length <= PERSISTED_DIFF_DIAGNOSTIC_PATH_LENGTH_LIMIT
        ? entry
        : `${entry.slice(0, PERSISTED_DIFF_DIAGNOSTIC_PATH_LENGTH_LIMIT - 3)}...`
    );
}

export function guardInitiativeAssignmentPersistedDiff(baseRecord, candidateRecord) {
  const persistedBase = cloneJson(baseRecord);
  const normalizedCandidate = canonicalizeWorkRecordReadScope(cloneJson(candidateRecord));
  const diffPaths = collectJsonDiffPaths(persistedBase, normalizedCandidate);
  if (diffPaths.length === 1 && diffPaths[0] === "initiative") {
    return { ok: true, normalizedCandidate, diffPaths, diagnostic: null };
  }

  const changedPaths = boundPersistedDiffPaths(diffPaths);
  const firstDisallowedPath = diffPaths.find((entry) => entry !== "initiative") ?? diffPaths[0];
  const firstPath = firstDisallowedPath
    ? boundPersistedDiffPaths([firstDisallowedPath])[0]
    : null;
  const diagnostic = {
    ...createDiagnostic(
      "initiative_assignment_persisted_diff_guard_failed",
      firstPath
        ? `initiative assignment would persist changes outside its one-scalar contract: ${changedPaths.join(", ")}`
        : "initiative assignment did not produce the required one-scalar persisted change",
      { path: firstPath }
    ),
    changed_paths: changedPaths,
    changed_paths_truncated: diffPaths.length > changedPaths.length
  };

  return {
    ok: false,
    normalizedCandidate: null,
    diffPaths,
    diagnostic
  };
}
