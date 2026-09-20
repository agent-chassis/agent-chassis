

import {
  DECLARED_BOUNDARY_RECORD_CONSISTENCY_TRANSFORMER,
  OBSERVATION_VERSION,
  POLICY_VERSION,
  SUBJECTS_VERSION,
  TRANSFORMER_ID,
  UNIT_CLASSES
} from "./declared-boundary-record-consistency.mjs";
import {
  ExactBindingError,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  parseCanonicalDocument,
  sha256
} from "./deterministic-projection-primitives.mjs";

const DECLARED_BOUNDARY_VERIFICATION_SCHEMA_VERSION =
  "controlled-contract-declared-boundary-verification.v1";

const DECLARED_BOUNDARY_PROFILE_ID = "proof.policy.declared-boundary-record-consistency";
const DECLARED_BOUNDARY_PROFILE_VERSION = "4.0.0";

const DECLARED_BOUNDARY_OBSERVATION_PROVENANCE = "caller_asserted";

const DECLARED_BOUNDARY_NOT_ESTABLISHED = Object.freeze([
  "execution-provenance",
  "policy-to-production-correspondence",
  "production-truth",
  "runtime-enforcement"
]);

const INPUT_FIELDS = Object.freeze(["policy", "observation", "subjects"]);

const DOCUMENT_SLOTS = Object.freeze([
  Object.freeze({ slot: "policy", schemaVersion: POLICY_VERSION, label: "declared policy" }),
  Object.freeze({
    slot: "observation", schemaVersion: OBSERVATION_VERSION,
    label: "boundary observation record"
  }),
  Object.freeze({ slot: "subjects", schemaVersion: SUBJECTS_VERSION, label: "measured subjects" })
]);

const DECLARED_BOUNDARY_VERIFICATION_REFUSAL_CODES = Object.freeze({
  MISSING_REQUIRED_INPUT:
    "controlled_contract.declared_boundary_verification.missing_required_input.v1",
  MALFORMED_INPUT:
    "controlled_contract.declared_boundary_verification.malformed_input.v1",
  POLICY_DOCUMENT_UNRESOLVED:
    "controlled_contract.declared_boundary_verification.policy_document_unresolved.v1",
  SUBJECTS_DOCUMENT_UNRESOLVED:
    "controlled_contract.declared_boundary_verification.subjects_document_unresolved.v1",
  OBSERVATION_DOCUMENT_UNRESOLVED:
    "controlled_contract.declared_boundary_verification.observation_document_unresolved.v1",
  POLICY_NOT_CLOSED:
    "controlled_contract.declared_boundary_verification.policy_not_closed.v1",
  POLICY_AMBIGUOUS:
    "controlled_contract.declared_boundary_verification.policy_ambiguous.v1",
  MEASUREMENT_UNIT_UNSUPPORTED:
    "controlled_contract.declared_boundary_verification.measurement_unit_unsupported.v1",
  SUBJECT_IDENTITY_DUPLICATE:
    "controlled_contract.declared_boundary_verification.subject_identity_duplicate.v1",
  SUBJECT_POPULATION_MALFORMED:
    "controlled_contract.declared_boundary_verification.subject_population_malformed.v1",
  SUBJECT_POPULATION_INCOMPLETE:
    "controlled_contract.declared_boundary_verification.subject_population_incomplete.v1",
  OBSERVATION_RECORD_MALFORMED:
    "controlled_contract.declared_boundary_verification.observation_record_malformed.v1",
  OBSERVATION_PROVENANCE_UNSUPPORTED:
    "controlled_contract.declared_boundary_verification.observation_provenance_unsupported.v1",
  BOUNDARY_CENSUS_INCOMPLETE:
    "controlled_contract.declared_boundary_verification.boundary_census_incomplete.v1",
  BOUNDARY_CENSUS_DUPLICATE:
    "controlled_contract.declared_boundary_verification.boundary_census_duplicate.v1",
  BOUNDARY_CENSUS_REFERENCE_UNKNOWN:
    "controlled_contract.declared_boundary_verification.boundary_census_reference_unknown.v1",
  BOUNDARY_ARITHMETIC_MISMATCH:
    "controlled_contract.declared_boundary_verification.boundary_arithmetic_mismatch.v1",
  BOUNDARY_DISPOSITION_MISMATCH:
    "controlled_contract.declared_boundary_verification.boundary_disposition_mismatch.v1",
  DERIVATION_REFUSED:
    "controlled_contract.declared_boundary_verification.derivation_refused.v1",
  REPORT_INVALID:
    "controlled_contract.declared_boundary_verification.report_invalid.v1"
});

const CODES = DECLARED_BOUNDARY_VERIFICATION_REFUSAL_CODES;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnosticScalar(value) {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean": return value;
    case "function": return "[function]";
    case "symbol": return "[symbol]";
    case "bigint": return "[bigint]";
    default: return "[object]";
  }
}

function refuse(code, reason, detail = null) {
  return deepFreeze({
    schema_version: DECLARED_BOUNDARY_VERIFICATION_SCHEMA_VERSION,
    verified: false,
    profile_id: DECLARED_BOUNDARY_PROFILE_ID,
    profile_version: DECLARED_BOUNDARY_PROFILE_VERSION,
    transformer_id: TRANSFORMER_ID,
    source: null,
    report: null,
    census: null,
    refusal: { code, reason, detail: detail === null ? null : structuredClone(detail) }
  });
}

function unresolvedCodeFor(slot) {
  if (slot === "policy") return CODES.POLICY_DOCUMENT_UNRESOLVED;
  if (slot === "subjects") return CODES.SUBJECTS_DOCUMENT_UNRESOLVED;
  return CODES.OBSERVATION_DOCUMENT_UNRESOLVED;
}

function admitInput(input) {
  if (input === undefined || input === null) {
    return refuse(CODES.MISSING_REQUIRED_INPUT,
      "policy, observation, and subjects are required to verify a declared boundary record",
      { input: "input" });
  }
  if (!isPlainObject(input)) {
    return refuse(CODES.MALFORMED_INPUT,
      "verification accepts one plain object carrying policy, observation, and subjects",
      { input: "input" });
  }
  const keys = Object.keys(input);
  const unexpected = keys.filter((key) => !INPUT_FIELDS.includes(key)).sort(compareCodeUnits);
  const missing = INPUT_FIELDS.filter((field) => !Object.hasOwn(input, field));
  if (unexpected.length > 0 || missing.length > 0) {
    return refuse(CODES.MALFORMED_INPUT,
      "verification accepts exactly the policy, observation, and subjects documents",
      { missing_field: missing[0] ?? null, unexpected_field: unexpected[0] ?? null });
  }
  return null;
}

function resolveDocument(input, { slot, schemaVersion, label }) {
  const code = unresolvedCodeFor(slot);
  const value = input[slot];
  let bytes;
  if (value instanceof Uint8Array) {
    if (value.byteLength === 0) {
      return { document: null, bytes: null, refusal: refuse(code,
        `${slot} must be the non-empty canonical ${label} document bytes`,
        { slot, defect: "bytes_unresolved" }) };
    }
    bytes = Buffer.from(value);
  } else if (isPlainObject(value)) {
    try {
      bytes = canonicalJsonBytes(value, { file: true });
    } catch (error) {
      return { document: null, bytes: null, refusal: refuse(code,
        `${slot} is not a canonicalizable ${label} document`,
        { slot, defect: "not_canonical_document", cause: error?.message ?? null }) };
    }
  } else {
    return { document: null, bytes: null, refusal: refuse(code,
      `${slot} must be the ${label} document object or its canonical bytes`,
      { slot, defect: "slot_shape", supplied: diagnosticScalar(value) }) };
  }
  let document;
  try {
    document = parseCanonicalDocument(bytes, `${label} source`);
  } catch (error) {
    return { document: null, bytes: null, refusal: refuse(code,
      `${slot} does not resolve to one canonical ${label} document`,
      { slot, defect: "not_canonical_document", projection_code: error.code ?? null }) };
  }
  if (!isPlainObject(document) || document.schema_version !== schemaVersion) {
    return { document: null, bytes: null, refusal: refuse(code,
      `${slot} must carry the ${label} document for this slot`, {
        slot,
        defect: "role_mismatch",
        expected: schemaVersion,
        supplied: isPlainObject(document) && typeof document.schema_version === "string"
          ? document.schema_version : null
      }) };
  }
  return { document, bytes, refusal: null };
}

function admitMeasurementUnits(document) {
  if (!Array.isArray(document.limits)) return null;
  for (const [index, limit] of document.limits.entries()) {
    if (!isPlainObject(limit)) continue;
    if (!Object.hasOwn(UNIT_CLASSES, limit.unit)) {
      return refuse(CODES.MEASUREMENT_UNIT_UNSUPPORTED,
        "the declared policy names a measurement unit outside the closed declared lexicon", {
          index,
          limit_key: diagnosticScalar(limit.limit_key),
          supplied: diagnosticScalar(limit.unit),
          supported: Object.keys(UNIT_CLASSES).sort(compareCodeUnits)
        });
    }
    if (limit.measurement_class !== UNIT_CLASSES[limit.unit]) {
      return refuse(CODES.MEASUREMENT_UNIT_UNSUPPORTED,
        "the declared measurement class is not the class the closed lexicon assigns to that unit", {
          index,
          limit_key: diagnosticScalar(limit.limit_key),
          unit: limit.unit,
          expected: UNIT_CLASSES[limit.unit],
          supplied: diagnosticScalar(limit.measurement_class)
        });
    }
  }
  return null;
}

function admitSubjectIdentities(document) {
  if (!Array.isArray(document.subjects)) return null;
  const seen = new Set();
  for (const [index, subject] of document.subjects.entries()) {
    if (!isPlainObject(subject) || typeof subject.subject_id !== "string") continue;
    if (seen.has(subject.subject_id)) {
      return refuse(CODES.SUBJECT_IDENTITY_DUPLICATE,
        "the subject population carries two subjects under one subject identity",
        { index, subject_id: subject.subject_id });
    }
    seen.add(subject.subject_id);
  }
  return null;
}

function identifierRefusal(details) {
  const field = typeof details?.field === "string" ? details.field : "";
  if (field.startsWith("limits[")) {
    return refuse(CODES.POLICY_NOT_CLOSED,
      "the declared policy carries a non-canonical limit identifier", { field });
  }
  if (field.startsWith("subjects[")) {
    return refuse(CODES.SUBJECT_POPULATION_MALFORMED,
      "the subject population carries a non-canonical subject identifier", { field });
  }
  return refuse(CODES.OBSERVATION_RECORD_MALFORMED,
    "the observation record carries a non-canonical identifier", { field });
}

const PROJECTION_REFUSALS = Object.freeze({
  declared_policy_invalid: () => refuse(CODES.POLICY_NOT_CLOSED,
    "the declared policy is not one closed policy document"),
  declared_policy_limit_invalid: (details) => refuse(CODES.POLICY_NOT_CLOSED,
    "a declared limit is not closed under the policy vocabulary", details),
  declared_policy_noncanonical: () => refuse(CODES.POLICY_AMBIGUOUS,
    "the declared policy declares more than one limit under one limit key"),
  declared_policy_unit_unknown: () => refuse(CODES.MEASUREMENT_UNIT_UNSUPPORTED,
    "the declared policy names a measurement unit that is not measurable"),
  boundary_observation_invalid: () => refuse(CODES.OBSERVATION_RECORD_MALFORMED,
    "the observation record is not one closed boundary observation document"),
  boundary_observation_case_invalid: (details) => refuse(CODES.OBSERVATION_RECORD_MALFORMED,
    "a recorded boundary case is not closed under the observation vocabulary", details),
  boundary_observation_noncanonical: () => refuse(CODES.OBSERVATION_RECORD_MALFORMED,
    "the recorded boundary cases are not sorted and unique by case id"),
  boundary_observation_provenance_unestablished: () =>
    refuse(CODES.OBSERVATION_PROVENANCE_UNSUPPORTED,
      `only a ${DECLARED_BOUNDARY_OBSERVATION_PROVENANCE} observation record can be verified; ` +
      "no mechanism here establishes execution provenance"),
  boundary_subjects_invalid: () => refuse(CODES.SUBJECT_POPULATION_MALFORMED,
    "the subjects are not one closed subject population document"),
  boundary_subject_invalid: (details) => refuse(CODES.SUBJECT_POPULATION_MALFORMED,
    "a subject is not closed under the subject vocabulary", details),
  boundary_subject_encoding_invalid: () => refuse(CODES.SUBJECT_POPULATION_MALFORMED,
    "a subject is not canonical well-formed UTF-8"),
  boundary_subjects_noncanonical: () => refuse(CODES.SUBJECT_POPULATION_MALFORMED,
    "the subjects are not sorted and unique by subject id"),
  bounded_policy_identifier_invalid: identifierRefusal,
  boundary_population_reference_unknown: (details) =>
    refuse(CODES.BOUNDARY_CENSUS_REFERENCE_UNKNOWN,
      "a recorded boundary case names a limit or subject outside the derived census", details),
  boundary_case_duplicate: (details) => refuse(CODES.BOUNDARY_CENSUS_DUPLICATE,
    "a boundary case appears more than once for one limit and boundary position", details),
  boundary_measurement_mismatch: (details) => refuse(CODES.BOUNDARY_ARITHMETIC_MISMATCH,
    "a measured subject does not equal the declared boundary position it is recorded at",
    details),
  boundary_disposition_mismatch: (details) => refuse(CODES.BOUNDARY_DISPOSITION_MISMATCH,
    "a recorded disposition disagrees with the declared disposition table", details),
  boundary_census_incomplete: (details) => refuse(CODES.BOUNDARY_CENSUS_INCOMPLETE,
    "the observation record does not cover the complete derived boundary census", details),
  boundary_subject_population_incomplete: () => refuse(CODES.SUBJECT_POPULATION_INCOMPLETE,
    "the subject population is not covered exactly by the derived census"),
  boundary_report_invalid: () => refuse(CODES.REPORT_INVALID,
    "the derived report does not satisfy its own closed result shape"),
  boundary_report_count_mismatch: (details) => refuse(CODES.REPORT_INVALID,
    "a derived report count does not match its complete population", details)
});

function projectionRefusal(error) {
  const build = PROJECTION_REFUSALS[error.code];
  if (build !== undefined) return build(error.details ?? {});
  return refuse(CODES.DERIVATION_REFUSED,
    "the owning declared-boundary transformer refused this record",
    { projection_code: typeof error.code === "string" ? error.code : null });
}

function deriveReport(bytes) {
  try {
    const values = DECLARED_BOUNDARY_RECORD_CONSISTENCY_TRANSFORMER.parse_sources([
      Buffer.from(bytes.observation),
      Buffer.from(bytes.policy),
      Buffer.from(bytes.subjects)
    ]);
    const report = DECLARED_BOUNDARY_RECORD_CONSISTENCY_TRANSFORMER.validate_result(
      DECLARED_BOUNDARY_RECORD_CONSISTENCY_TRANSFORMER.transform(values)
    );
    return { report, refusal: null };
  } catch (error) {
    if (error instanceof ExactBindingError) return { report: null, refusal: projectionRefusal(error) };
    throw error;
  }
}

function projectCensus(report) {
  const casesByLimit = new Map(report.limits.map(({ limit_key: key }) => [key, []]));
  for (const entry of report.cases) casesByLimit.get(entry.limit_key).push(entry);
  return {
    provenance: report.provenance,
    authority: "caller_declaration_only",
    not_established: [...DECLARED_BOUNDARY_NOT_ESTABLISHED],
    boundary_case_count: report.counts["boundary-cases"],
    measured_subject_count: report.counts["measured-subjects"],
    limits: report.limits.map((limit) => {
      const cases = [...casesByLimit.get(limit.limit_key)].sort((left, right) =>
        compareCodeUnits(left.boundary_position, right.boundary_position));
      return {
        limit_key: limit.limit_key,
        limit_value: limit.limit_value,
        bound_direction: limit.bound_direction,
        bound_inclusivity: limit.bound_inclusivity,
        overflow_disposition: limit.overflow_disposition,
        normalization: limit.normalization,
        unit: limit.unit,
        measurement_class: limit.measurement_class,
        zero_maximum: limit.limit_value === 0,
        boundary_positions: cases.map(({ boundary_position: position }) => position),
        cases: cases.map((entry) => ({
          boundary_position: entry.boundary_position,
          case_id: entry.case_id,
          subject_id: entry.subject_id,
          measured_value: entry.measured_value,
          observed_disposition: entry.observed_disposition
        }))
      };
    })
  };
}

function verifyDeclaredBoundaryRecordConsistency(input) {
  const inputRefusal = admitInput(input);
  if (inputRefusal !== null) return inputRefusal;

  const documents = {};
  const bytes = {};
  for (const definition of DOCUMENT_SLOTS) {
    const { document, bytes: resolved, refusal } = resolveDocument(input, definition);
    if (refusal !== null) return refusal;
    documents[definition.slot] = document;
    bytes[definition.slot] = resolved;
  }

  const unitRefusal = admitMeasurementUnits(documents.policy);
  if (unitRefusal !== null) return unitRefusal;
  const subjectIdentityRefusal = admitSubjectIdentities(documents.subjects);
  if (subjectIdentityRefusal !== null) return subjectIdentityRefusal;

  const { report, refusal: derivationRefusal } = deriveReport(bytes);
  if (derivationRefusal !== null) return derivationRefusal;

  const reportBytes = canonicalJsonBytes(report, { file: true });
  return deepFreeze({
    schema_version: DECLARED_BOUNDARY_VERIFICATION_SCHEMA_VERSION,
    verified: true,
    profile_id: DECLARED_BOUNDARY_PROFILE_ID,
    profile_version: DECLARED_BOUNDARY_PROFILE_VERSION,
    transformer_id: TRANSFORMER_ID,
    source: {
      observation_provenance: report.provenance,
      source_set_sha256: report.source_set_sha256,
      source_content_sha256: { ...report.source_content_sha256 },
      report_bytes_sha256: sha256(reportBytes),
      declared_limit_count: report.counts["declared-limits"],
      measurement_unit_count: report.counts["measurement-units"],
      boundary_case_count: report.counts["boundary-cases"],
      measured_subject_count: report.counts["measured-subjects"]
    },
    report,
    census: projectCensus(report),
    refusal: null
  });
}

function canonicalDeclaredBoundaryReportJson(result) {
  if (!isPlainObject(result) || result.verified !== true || result.report === null) {
    throw new TypeError(
      "canonical report bytes require a verified declared-boundary result"
    );
  }
  return canonicalJsonBytes(result.report, { file: true });
}

export {
  DECLARED_BOUNDARY_NOT_ESTABLISHED,
  DECLARED_BOUNDARY_OBSERVATION_PROVENANCE,
  DECLARED_BOUNDARY_PROFILE_ID,
  DECLARED_BOUNDARY_PROFILE_VERSION,
  DECLARED_BOUNDARY_VERIFICATION_REFUSAL_CODES,
  DECLARED_BOUNDARY_VERIFICATION_SCHEMA_VERSION,
  canonicalDeclaredBoundaryReportJson,
  verifyDeclaredBoundaryRecordConsistency
};
