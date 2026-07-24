

import { isObject, normalizeStringEntry } from "./work-record-admission-shared.mjs";

export const ADMISSION_EVIDENCE_MALFORMED_ISSUE_CODE =
  "malformed_worker_admission_derived_evidence";
export const ADMISSION_EVIDENCE_OUTDATED_ISSUE_CODE =
  "outdated_worker_admission_derived_evidence";
export const ADMISSION_EVIDENCE_STALE_ISSUE_CODE =
  "stale_worker_admission_derived_evidence";
export const ADMISSION_EVIDENCE_CONCURRENT_CHANGE_ISSUE_CODE =
  "concurrently_modified_work_record";
export const ADMISSION_EVIDENCE_UNRESOLVED_UNIT_DIGEST_ISSUE_CODE =
  "unresolvable_reviewed_unit_digest";

export function resolvedReviewedUnitDigestIssue(sourceDigest, unitAddress = null) {
  if (normalizeStringEntry(sourceDigest)) {
    return null;
  }
  return {
    code: ADMISSION_EVIDENCE_UNRESOLVED_UNIT_DIGEST_ISSUE_CODE,
    message: `Could not resolve reviewed-unit digest for ${unitAddress || "the selected unit"}`,
    details: unitAddress ? { unit_address: unitAddress } : {}
  };
}

export function evaluateAdmissionEvidenceEntryFreshness(
  entry,
  index,
  { expectedSchemaVersion, expectedGeneratorVersion, expectedSourceDigest } = {}
) {
  if (!isObject(entry)) {
    return {
      code: ADMISSION_EVIDENCE_MALFORMED_ISSUE_CODE,
      message: "worker-admission derived evidence entry is not an object",
      details: { derived_evidence_index: index }
    };
  }

  const schemaVersion = normalizeStringEntry(entry.schema_version);
  if (!schemaVersion) {
    return {
      code: ADMISSION_EVIDENCE_MALFORMED_ISSUE_CODE,
      message: "worker-admission derived evidence is missing its schema version",
      details: { derived_evidence_index: index, missing_provenance_field: "schema_version" }
    };
  }
  if (schemaVersion !== expectedSchemaVersion) {
    return {
      code: ADMISSION_EVIDENCE_OUTDATED_ISSUE_CODE,
      message: "worker-admission derived evidence schema version is outdated",
      details: {
        derived_evidence_index: index,
        derived_evidence_schema_version: schemaVersion
      }
    };
  }

  if (!isObject(entry.generator)) {
    return {
      code: ADMISSION_EVIDENCE_MALFORMED_ISSUE_CODE,
      message: "worker-admission derived evidence is missing its generator provenance",
      details: { derived_evidence_index: index, missing_provenance_field: "generator" }
    };
  }
  const generatorVersion = normalizeStringEntry(entry.generator.version);
  if (!generatorVersion) {
    return {
      code: ADMISSION_EVIDENCE_MALFORMED_ISSUE_CODE,
      message: "worker-admission derived evidence is missing its generator version",
      details: { derived_evidence_index: index, missing_provenance_field: "generator.version" }
    };
  }
  if (generatorVersion !== expectedGeneratorVersion) {
    return {
      code: ADMISSION_EVIDENCE_OUTDATED_ISSUE_CODE,
      message: "worker-admission derived evidence generator version is outdated",
      details: {
        derived_evidence_index: index,
        derived_evidence_generator_version: generatorVersion
      }
    };
  }

  const entrySourceDigest = normalizeStringEntry(entry.source_record_digest);
  if (!entrySourceDigest) {
    return {
      code: ADMISSION_EVIDENCE_MALFORMED_ISSUE_CODE,
      message: "worker-admission derived evidence is missing its source record digest",
      details: {
        derived_evidence_index: index,
        missing_provenance_field: "source_record_digest",
        current_source_digest: normalizeStringEntry(expectedSourceDigest) ?? null
      }
    };
  }
  if (entrySourceDigest !== expectedSourceDigest) {
    return {
      code: ADMISSION_EVIDENCE_STALE_ISSUE_CODE,
      message: "worker-admission derived evidence is stale",
      details: {
        derived_evidence_index: index,
        source_digest: entrySourceDigest,
        current_source_digest: expectedSourceDigest
      }
    };
  }

  return null;
}

export function detectConcurrentCanonicalRecordChange({
  observedSourceDigest,
  currentSourceDigest,
  observedUnitDigest,
  currentUnitDigest,
  unitAddress = null
} = {}) {
  const observedSource = normalizeStringEntry(observedSourceDigest);
  const currentSource = normalizeStringEntry(currentSourceDigest);
  const observedUnit = normalizeStringEntry(observedUnitDigest);
  const currentUnit = normalizeStringEntry(currentUnitDigest);

  const sourceChanged = observedSource !== currentSource;
  const unitChanged = observedUnit !== currentUnit;
  if (!sourceChanged && !unitChanged) {
    return null;
  }

  return {
    code: ADMISSION_EVIDENCE_CONCURRENT_CHANGE_ISSUE_CODE,
    message: "canonical work record changed during admission evaluation",
    details: {
      ...(unitAddress ? { unit_address: unitAddress } : {}),
      observed_source_digest: observedSource ?? null,
      current_source_digest: currentSource ?? null,
      observed_unit_digest: observedUnit ?? null,
      current_unit_digest: currentUnit ?? null,
      changed_bindings: [
        ...(sourceChanged ? ["source_record_digest"] : []),
        ...(unitChanged ? ["reviewed_unit_digest"] : [])
      ]
    }
  };
}
