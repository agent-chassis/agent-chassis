

import {
  CAPTURE_ROLE_DEFECTS,
  assembleCaptureEvaluationInput,
  canonicalCaptureEvaluationInputJson,
  capturePackIdentityMismatch,
  captureEvaluationInputDiagnostics,
  createCaptureResultFactory,
  diagnosticScalar,
  isPlainObject,
  planCaptureRoleBindings,
  resolveCapturePackSnapshot,
  resolveExactlyOneEvaluationStage
} from "./capture-mapping.mjs";
import {
  DECLARED_BOUNDARY_RECORD_CONSISTENCY_TRANSFORMER,
  FIXED_REFERENCES,
  OBSERVATION_VERSION,
  POLICY_VERSION,
  POPULATION_REFERENCES,
  SUBJECTS_VERSION,
  TRANSFORMER_ID,
  UNIT_CLASSES,
  boundaryGraph
} from "./declared-boundary-record-consistency.mjs";
import {
  ExactBindingError,
  canonicalJsonBytes,
  compareCodeUnits,
  parseCanonicalDocument,
  sha256
} from "./deterministic-projection-primitives.mjs";

const DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION =
  "controlled-contract-declared-boundary-capture.v1";

const DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION =
  "controlled-contract-declared-boundary-capture-input.v1";

const DECLARED_BOUNDARY_PROFILE_ID = "proof.policy.declared-boundary-record-consistency";
const DECLARED_BOUNDARY_PROFILE_VERSION = "2.0.0";

const DECLARED_BOUNDARY_OBSERVATION_PROVENANCE = "caller_asserted";

const DECLARED_BOUNDARY_NOT_ESTABLISHED = Object.freeze([
  "execution-provenance",
  "policy-to-production-correspondence",
  "production-truth",
  "runtime-enforcement"
]);

const CAPTURE_FIELDS = Object.freeze([
  "schema_version", "policy", "observation", "subjects", "report"
]);
const ARTIFACT_SOURCE_FIELDS = Object.freeze(["kind", "relative_path"]);
const ARTIFACT_FILE_KIND = "artifact_file";

const BYTE_SLOTS = Object.freeze([
  Object.freeze({
    slot: "policy", schemaVersion: POLICY_VERSION, label: "declared policy",
    extraFields: Object.freeze([])
  }),
  Object.freeze({
    slot: "observation", schemaVersion: OBSERVATION_VERSION,
    label: "boundary observation record", extraFields: Object.freeze(["record_id"])
  }),
  Object.freeze({
    slot: "subjects", schemaVersion: SUBJECTS_VERSION, label: "measured subjects",
    extraFields: Object.freeze([])
  })
]);

const SOURCE_REQUIREMENT_ROLES = Object.freeze({
  policy: "policy_artifact",
  observation: "observation_artifact",
  subjects: "subjects_artifact"
});

const ROLE_POPULATIONS = Object.freeze({
  declared_limits: "declared-limits",
  measurement_units: "measurement-units",
  boundary_cases: "boundary-cases",
  measured_subjects: "measured-subjects"
});

const DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES = Object.freeze({
  MISSING_REQUIRED_INPUT:
    "controlled_contract.declared_boundary_capture.missing_required_input.v1",
  MALFORMED_CAPTURE:
    "controlled_contract.declared_boundary_capture.malformed_capture.v1",
  CAPTURE_SCHEMA_VERSION_UNSUPPORTED:
    "controlled_contract.declared_boundary_capture.capture_schema_version_unsupported.v1",
  POLICY_BYTES_UNRESOLVED:
    "controlled_contract.declared_boundary_capture.policy_bytes_unresolved.v1",
  SUBJECT_BYTES_UNRESOLVED:
    "controlled_contract.declared_boundary_capture.subject_bytes_unresolved.v1",
  OBSERVATION_RECORD_UNRESOLVED:
    "controlled_contract.declared_boundary_capture.observation_record_unresolved.v1",
  POLICY_NOT_CLOSED:
    "controlled_contract.declared_boundary_capture.policy_not_closed.v1",
  POLICY_AMBIGUOUS:
    "controlled_contract.declared_boundary_capture.policy_ambiguous.v1",
  MEASUREMENT_UNIT_UNSUPPORTED:
    "controlled_contract.declared_boundary_capture.measurement_unit_unsupported.v1",
  SUBJECT_IDENTITY_DUPLICATE:
    "controlled_contract.declared_boundary_capture.subject_identity_duplicate.v1",
  SUBJECT_POPULATION_MALFORMED:
    "controlled_contract.declared_boundary_capture.subject_population_malformed.v1",
  SUBJECT_POPULATION_INCOMPLETE:
    "controlled_contract.declared_boundary_capture.subject_population_incomplete.v1",
  OBSERVATION_RECORD_MALFORMED:
    "controlled_contract.declared_boundary_capture.observation_record_malformed.v1",
  OBSERVATION_PROVENANCE_UNSUPPORTED:
    "controlled_contract.declared_boundary_capture.observation_provenance_unsupported.v1",
  BOUNDARY_CENSUS_INCOMPLETE:
    "controlled_contract.declared_boundary_capture.boundary_census_incomplete.v1",
  BOUNDARY_CENSUS_DUPLICATE:
    "controlled_contract.declared_boundary_capture.boundary_census_duplicate.v1",
  BOUNDARY_CENSUS_REFERENCE_UNKNOWN:
    "controlled_contract.declared_boundary_capture.boundary_census_reference_unknown.v1",
  BOUNDARY_ARITHMETIC_MISMATCH:
    "controlled_contract.declared_boundary_capture.boundary_arithmetic_mismatch.v1",
  BOUNDARY_DISPOSITION_MISMATCH:
    "controlled_contract.declared_boundary_capture.boundary_disposition_mismatch.v1",
  DERIVATION_REFUSED:
    "controlled_contract.declared_boundary_capture.derivation_refused.v1",
  REPORT_INVALID:
    "controlled_contract.declared_boundary_capture.report_invalid.v1",
  CONTRACT_GRAPH_INCOMPLETE:
    "controlled_contract.declared_boundary_capture.contract_graph_incomplete.v1",
  PACK_SNAPSHOT_UNRECOGNIZED:
    "controlled_contract.declared_boundary_capture.pack_snapshot_unrecognized.v1",
  PROFILE_IDENTITY_MISMATCH:
    "controlled_contract.declared_boundary_capture.profile_identity_mismatch.v1",
  PACK_STAGE_UNSUPPORTED:
    "controlled_contract.declared_boundary_capture.pack_stage_unsupported.v1",
  PACK_ROLE_INCOMPATIBLE:
    "controlled_contract.declared_boundary_capture.pack_role_incompatible.v1",
  EXACT_BINDING_DECLARATION_INCOMPATIBLE:
    "controlled_contract.declared_boundary_capture.exact_binding_declaration_incompatible.v1",
  EVALUATION_INPUT_INVALID:
    "controlled_contract.declared_boundary_capture.evaluation_input_invalid.v1"
});

const RESULTS = createCaptureResultFactory({
  schemaVersion: DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION,
  identity: {
    profile_id: DECLARED_BOUNDARY_PROFILE_ID,
    profile_version: DECLARED_BOUNDARY_PROFILE_VERSION,
    capture_input_schema_version: DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION,
    transformer_id: TRANSFORMER_ID
  },
  nullFields: ["exact_binding_sources", "report", "census"]
});

const refuse = (code, reason, detail = null) => RESULTS.refuse(code, reason, detail);

const CODES = DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES;

function exactKeys(value, fields) {
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function missingField(value, fields) {
  return fields.find((field) => !Object.hasOwn(value, field)) ?? null;
}

function unexpectedField(value, fields) {
  const allowed = new Set(fields);
  return Object.keys(value).filter((key) => !allowed.has(key))
    .sort(compareCodeUnits)[0] ?? null;
}

function isByteSequence(value) {
  return (value instanceof Uint8Array) && value.byteLength > 0;
}

function isOpaqueIdentity(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function sourceDescriptorDefect(source) {
  if (!isPlainObject(source)) return "must be an artifact_file source descriptor";
  if (!exactKeys(source, ARTIFACT_SOURCE_FIELDS)) {
    return "must carry exactly a kind and a relative_path";
  }
  if (source.kind !== ARTIFACT_FILE_KIND) return `must declare kind ${ARTIFACT_FILE_KIND}`;
  if (!isOpaqueIdentity(source.relative_path)) {
    return "must carry a non-empty NUL-free relative_path";
  }
  return null;
}

function admitCapture(capture) {
  if (capture === undefined || capture === null) {
    return refuse(
      CODES.MISSING_REQUIRED_INPUT,
      "capture is required to map a declared-boundary capture",
      { input: "capture" }
    );
  }
  if (!isPlainObject(capture)) {
    return refuse(
      CODES.MALFORMED_CAPTURE,
      "capture must be the bounded declared-boundary capture object",
      { input: "capture" }
    );
  }
  if (capture.schema_version !== DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION) {
    return refuse(
      CODES.CAPTURE_SCHEMA_VERSION_UNSUPPORTED,
      `capture must carry schema_version ${DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION}`,
      {
        supplied: typeof capture.schema_version === "string" ? capture.schema_version : null,
        expected: DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION
      }
    );
  }
  if (!exactKeys(capture, CAPTURE_FIELDS)) {
    return refuse(
      CODES.MALFORMED_CAPTURE,
      "capture must carry the exact accepted field set",
      {
        missing_field: missingField(capture, CAPTURE_FIELDS),
        unexpected_field: unexpectedField(capture, CAPTURE_FIELDS)
      }
    );
  }
  return null;
}

function unresolvedCodeFor(slot) {
  if (slot === "policy") return CODES.POLICY_BYTES_UNRESOLVED;
  if (slot === "subjects") return CODES.SUBJECT_BYTES_UNRESOLVED;
  return CODES.OBSERVATION_RECORD_UNRESOLVED;
}

function admitByteSlot(capture, { slot, schemaVersion, label, extraFields }) {
  const code = unresolvedCodeFor(slot);
  const value = capture[slot];
  const fields = ["bytes", "source", ...extraFields];
  if (!isPlainObject(value) || !exactKeys(value, fields)) {
    return {
      document: null,
      refusal: refuse(code, `capture.${slot} must carry the exact ${label} slot fields`, {
        slot,
        defect: "slot_shape",
        missing_field: isPlainObject(value) ? missingField(value, fields) : null,
        unexpected_field: isPlainObject(value) ? unexpectedField(value, fields) : null
      })
    };
  }
  for (const field of extraFields) {
    if (!isOpaqueIdentity(value[field])) {
      return {
        document: null,
        refusal: refuse(code, `capture.${slot}.${field} must be a resolved non-empty identity`, {
          slot, defect: "identity_unresolved", field,
          supplied: diagnosticScalar(value[field])
        })
      };
    }
  }
  const descriptorDefect = sourceDescriptorDefect(value.source);
  if (descriptorDefect !== null) {
    return {
      document: null,
      refusal: refuse(code, `capture.${slot}.source ${descriptorDefect}`, {
        slot, defect: "source_descriptor"
      })
    };
  }
  if (!isByteSequence(value.bytes)) {
    return {
      document: null,
      refusal: refuse(code, `capture.${slot}.bytes must be the exact resolved ${label} bytes`, {
        slot, defect: "bytes_unresolved"
      })
    };
  }
  let document;
  try {
    document = parseCanonicalDocument(Buffer.from(value.bytes), `${label} source`);
  } catch (error) {
    return {
      document: null,
      refusal: refuse(code, `capture.${slot}.bytes do not resolve to one canonical ${label} document`, {
        slot, defect: "not_canonical_document", projection_code: error.code ?? null
      })
    };
  }
  if (!isPlainObject(document) || document.schema_version !== schemaVersion) {
    return {
      document: null,
      refusal: refuse(code, `capture.${slot}.bytes must carry the ${label} document for this slot`, {
        slot,
        defect: "role_mismatch",
        expected: schemaVersion,
        supplied: isPlainObject(document) && typeof document.schema_version === "string"
          ? document.schema_version : null
      })
    };
  }
  return { document, refusal: null };
}

function admitMeasurementUnits(document) {
  if (!Array.isArray(document.limits)) return null;
  for (const [index, limit] of document.limits.entries()) {
    if (!isPlainObject(limit)) continue;
    if (!Object.hasOwn(UNIT_CLASSES, limit.unit)) {
      return refuse(
        CODES.MEASUREMENT_UNIT_UNSUPPORTED,
        "the declared policy names a measurement unit outside the closed declared lexicon",
        {
          index,
          limit_key: diagnosticScalar(limit.limit_key),
          supplied: diagnosticScalar(limit.unit),
          supported: Object.keys(UNIT_CLASSES).sort(compareCodeUnits)
        }
      );
    }
    if (limit.measurement_class !== UNIT_CLASSES[limit.unit]) {
      return refuse(
        CODES.MEASUREMENT_UNIT_UNSUPPORTED,
        "the declared measurement class is not the class the closed lexicon assigns to that unit",
        {
          index,
          limit_key: diagnosticScalar(limit.limit_key),
          unit: limit.unit,
          expected: UNIT_CLASSES[limit.unit],
          supplied: diagnosticScalar(limit.measurement_class)
        }
      );
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
      return refuse(
        CODES.SUBJECT_IDENTITY_DUPLICATE,
        "the captured subject population carries two subjects under one subject identity",
        { index, subject_id: subject.subject_id }
      );
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
      "the captured subject population carries a non-canonical subject identifier", { field });
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
      `only a ${DECLARED_BOUNDARY_OBSERVATION_PROVENANCE} observation record can be mapped; ` +
      "no mechanism here establishes capture provenance"),
  boundary_subjects_invalid: () => refuse(CODES.SUBJECT_POPULATION_MALFORMED,
    "the captured subjects are not one closed subject population document"),
  boundary_subject_invalid: (details) => refuse(CODES.SUBJECT_POPULATION_MALFORMED,
    "a captured subject is not closed under the subject vocabulary", details),
  boundary_subject_encoding_invalid: () => refuse(CODES.SUBJECT_POPULATION_MALFORMED,
    "a captured subject is not canonical well-formed UTF-8"),
  boundary_subjects_noncanonical: () => refuse(CODES.SUBJECT_POPULATION_MALFORMED,
    "the captured subjects are not sorted and unique by subject id"),
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
    "the captured subject population is not covered exactly by the derived census"),
  boundary_report_invalid: () => refuse(CODES.REPORT_INVALID,
    "the derived report does not satisfy its own closed result shape"),
  boundary_report_count_mismatch: (details) => refuse(CODES.REPORT_INVALID,
    "a derived report count does not match its complete population", details)
});

function projectionRefusal(error) {
  const build = PROJECTION_REFUSALS[error.code];
  if (build !== undefined) return build(error.details ?? {});
  return refuse(CODES.DERIVATION_REFUSED,
    "the owning declared-boundary transformer refused this capture",
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

function resolveExactBindingRequirements(pack) {
  const declaration = pack.declaration;
  if (!isPlainObject(declaration) || !Array.isArray(declaration.requirements) ||
      !Array.isArray(declaration.relations)) return null;
  const projection = declaration.relations.find((relation) =>
    isPlainObject(relation) && relation.operator === "deterministic_projection" &&
    relation.transformer_id === TRANSFORMER_ID);
  if (!isPlainObject(projection) || !Array.isArray(projection.source_requirement_ids)) return null;
  const artifactRequirements = declaration.requirements.filter((requirement) =>
    isPlainObject(requirement) && requirement.binding_kind === "artifact_bytes");
  const byRole = new Map();
  for (const requirement of artifactRequirements) {
    const coverage = requirement.role_coverage ?? [];
    if (coverage.length !== 1) continue;
    byRole.set(coverage[0].role, requirement.requirement_id);
  }
  const resolved = { report: projection.result_requirement_id };
  for (const [slot, role] of Object.entries(SOURCE_REQUIREMENT_ROLES)) {
    resolved[slot] = byRole.get(role);
  }
  const ids = Object.values(resolved);
  if (ids.some((id) => typeof id !== "string" || id.length === 0)) return null;
  if (new Set(ids).size !== ids.length) return null;

  const declaredSources = [...projection.source_requirement_ids].sort(compareCodeUnits);
  const boundSources = Object.keys(SOURCE_REQUIREMENT_ROLES)
    .map((slot) => resolved[slot]).sort(compareCodeUnits);
  if (declaredSources.length !== boundSources.length ||
      declaredSources.some((id, index) => id !== boundSources[index])) return null;
  if (!artifactRequirements.some(({ requirement_id: id }) => id === resolved.report)) return null;
  return resolved;
}

const fixedRole = (role, typeTerms, referenceId) => Object.freeze({
  role,
  typeTerms: Object.freeze(typeTerms),
  identityKinds: Object.freeze(["durable_id"]),
  referenceIds: () => [referenceId]
});

const populationRole = (role, typeTerms, population) => Object.freeze({
  role,
  typeTerms: Object.freeze(typeTerms),
  identityKinds: Object.freeze(["durable_id"]),
  referenceIds: (report) => [...report.populations[population]]
});

const ROLE_PLAN = Object.freeze([

  fixedRole("bounded_subject", ["cc:process", "cc:runtime_component"],
    FIXED_REFERENCES.subject),

  fixedRole("observation_artifact", ["cc:evidence"], FIXED_REFERENCES.observation),
  fixedRole("policy_artifact", ["cc:artifact"], FIXED_REFERENCES.policy),
  fixedRole("subjects_artifact", ["cc:artifact"], FIXED_REFERENCES.subjects),

  fixedRole("conformance_report", ["cc:evidence"], FIXED_REFERENCES.report),
  fixedRole("verification", ["cc:test", "cc:process"], FIXED_REFERENCES.verification),

  fixedRole("mismatch_condition", ["cc:state", "cc:configuration"],
    FIXED_REFERENCES.condition),

  fixedRole("limit_population", ["cc:population"], POPULATION_REFERENCES["declared-limits"]),
  populationRole("declared_limits", ["cc:criterion"], "declared-limits"),
  fixedRole("unit_population", ["cc:population"], POPULATION_REFERENCES["measurement-units"]),
  populationRole("measurement_units", ["cc:configuration"], "measurement-units"),
  fixedRole("case_population", ["cc:population"], POPULATION_REFERENCES["boundary-cases"]),
  populationRole("boundary_cases", ["cc:test"], "boundary-cases"),
  fixedRole("subject_population", ["cc:population"],
    POPULATION_REFERENCES["measured-subjects"]),
  populationRole("measured_subjects", ["cc:artifact"], "measured-subjects")
]);

const ROLE_DEFECT_REASONS = Object.freeze({
  [CAPTURE_ROLE_DEFECTS.ROLE_UNFILLABLE]: () =>
    "the admitted pack declares a reference role this mapping cannot fill",
  [CAPTURE_ROLE_DEFECTS.TYPE_TERM_UNSUPPORTED]: ({ role }) =>
    `the admitted pack allows no type term this mapping can supply for ${role}`,
  [CAPTURE_ROLE_DEFECTS.IDENTITY_KIND_UNSUPPORTED]: ({ role }) =>
    `the admitted pack allows no identity kind this mapping can supply for ${role}`,
  [CAPTURE_ROLE_DEFECTS.CARDINALITY_INVALID]: ({ role }) =>
    `the derived census fills ${role} with a member count the pack forbids`,
  [CAPTURE_ROLE_DEFECTS.REFERENCE_IDENTITY_CONFLICT]: ({ role }) =>
    `this mapping emitted two conflicting definitions of one reference for ${role}`
});

function buildNumberBindings(profile, report) {
  const bindings = [];
  for (const binding of profile.reference_role_count_bindings ?? []) {
    const population = ROLE_POPULATIONS[binding.reference_role];
    if (population === undefined) return null;
    bindings.push({ role: binding.number_role, value: report.counts[population] });
  }
  const declared = (profile.number_roles ?? []).map(({ role }) => role).sort(compareCodeUnits);
  const filled = bindings.map(({ role }) => role).sort(compareCodeUnits);
  if (declared.length !== filled.length ||
      declared.some((role, index) => role !== filled[index])) return null;
  return bindings;
}

async function mapDeclaredBoundaryCapture({ capture, pack = null } = {}) {
  const captureRefusal = admitCapture(capture);
  if (captureRefusal !== null) return captureRefusal;

  const documents = {};
  const bytes = {};
  for (const definition of BYTE_SLOTS) {
    const { document, refusal } = admitByteSlot(capture, definition);
    if (refusal !== null) return refusal;
    documents[definition.slot] = document;
    bytes[definition.slot] = capture[definition.slot].bytes;
  }

  if (!isPlainObject(capture.report) || !exactKeys(capture.report, ["source"])) {
    return refuse(CODES.MALFORMED_CAPTURE,
      "capture.report must carry exactly the derived report's source descriptor",
      { input: "capture.report" });
  }
  const reportDescriptorDefect = sourceDescriptorDefect(capture.report.source);
  if (reportDescriptorDefect !== null) {
    return refuse(CODES.MALFORMED_CAPTURE,
      `capture.report.source ${reportDescriptorDefect}`, { input: "capture.report.source" });
  }

  const unitRefusal = admitMeasurementUnits(documents.policy);
  if (unitRefusal !== null) return unitRefusal;
  const subjectIdentityRefusal = admitSubjectIdentities(documents.subjects);
  if (subjectIdentityRefusal !== null) return subjectIdentityRefusal;

  const { report, refusal: derivationRefusal } = deriveReport(bytes);
  if (derivationRefusal !== null) return derivationRefusal;

  const { admitted, unrecognized } = await resolveCapturePackSnapshot({
    pack, profileId: DECLARED_BOUNDARY_PROFILE_ID
  });
  if (unrecognized) {
    return refuse(
      CODES.PACK_SNAPSHOT_UNRECOGNIZED,
      "a supplied pack must be the exact snapshot returned by the admitted-pack loader",
      { input: "pack" }
    );
  }

  const identityMismatch = capturePackIdentityMismatch(admitted.profile, {
    profileId: DECLARED_BOUNDARY_PROFILE_ID,
    profileVersion: DECLARED_BOUNDARY_PROFILE_VERSION
  });
  if (identityMismatch !== null) {
    return refuse(
      CODES.PROFILE_IDENTITY_MISMATCH,
      "this mapping is written against one exact admitted pack identity",
      identityMismatch
    );
  }

  const { stage, declaredStageCount } = resolveExactlyOneEvaluationStage(admitted.profile);
  if (stage === null) {
    return refuse(
      CODES.PACK_STAGE_UNSUPPORTED,
      "this mapping fills one evaluation stage and the pack does not declare exactly one",
      { declared_stage_count: declaredStageCount }
    );
  }

  const requirements = resolveExactBindingRequirements(admitted);
  if (requirements === null) {
    return refuse(
      CODES.EXACT_BINDING_DECLARATION_INCOMPATIBLE,
      "the admitted pack does not declare one distinct artifact_bytes requirement " +
      "per exact source and derived result",
      { source_roles: { ...SOURCE_REQUIREMENT_ROLES }, transformer_id: TRANSFORMER_ID }
    );
  }

  const identities = new Map(boundaryGraph(report).references.map(
    ({ reference_id: referenceId, identity }) => [referenceId, identity]
  ));
  const planned = ROLE_PLAN.map((entry) => ({
    ...entry, members: entry.referenceIds(report)
  }));
  const ungrounded = planned.flatMap(({ members }) => members)
    .filter((referenceId) => !identities.has(referenceId)).sort(compareCodeUnits);
  if (ungrounded.length > 0) {
    return refuse(
      CODES.CONTRACT_GRAPH_INCOMPLETE,
      "the derived contract graph does not ground every reference this mapping binds",
      { ungrounded_reference_ids: ungrounded.slice(0, 8) }
    );
  }

  const { bindings, references, defect } = planCaptureRoleBindings(
    admitted.profile,
    planned.map(({ role, typeTerms, identityKinds, members }) => ({
      role,
      typeTerms,
      identityKinds,
      build: () => members.map((referenceId) => ({
        reference_id: referenceId, identity: identities.get(referenceId)
      }))
    }))
  );
  if (defect !== null) {
    return refuse(CODES.PACK_ROLE_INCOMPATIBLE,
      ROLE_DEFECT_REASONS[defect.kind](defect.detail), defect.detail);
  }

  const numberBindings = buildNumberBindings(admitted.profile, report);
  if (numberBindings === null) {
    return refuse(
      CODES.PACK_ROLE_INCOMPATIBLE,
      "the admitted pack binds a count to a population this mapping does not derive",
      { number_roles: (admitted.profile.number_roles ?? []).map(({ role }) => role) }
    );
  }

  const evaluationInput = assembleCaptureEvaluationInput({
    stage, referenceBindings: bindings, numberBindings
  });
  const diagnostics = captureEvaluationInputDiagnostics(evaluationInput);
  if (diagnostics !== null) {
    return refuse(
      CODES.EVALUATION_INPUT_INVALID,
      "the mapped evaluation input does not satisfy the owning evaluation-input schema",
      { diagnostics }
    );
  }

  const reportBytes = canonicalJsonBytes(report, { file: true });
  return RESULTS.accept({
    source: {
      observation_record_id: capture.observation.record_id,

      observation_provenance: report.provenance,
      source_set_sha256: report.source_set_sha256,
      source_content_sha256: { ...report.source_content_sha256 },
      report_bytes_sha256: sha256(reportBytes),
      declared_limit_count: report.counts["declared-limits"],
      measurement_unit_count: report.counts["measurement-units"],
      boundary_case_count: report.counts["boundary-cases"],
      measured_subject_count: report.counts["measured-subjects"],
      exact_binding_requirement_ids: { ...requirements }
    },
    references,
    evaluationInput,
    additional: {
      exact_binding_sources: {
        [requirements.policy]: { ...capture.policy.source },
        [requirements.observation]: { ...capture.observation.source },
        [requirements.subjects]: { ...capture.subjects.source },
        [requirements.report]: { ...capture.report.source }
      },
      report,
      census: projectCensus(report)
    }
  });
}

function canonicalDeclaredBoundaryEvaluationInputJson(result) {
  return canonicalCaptureEvaluationInputJson(result, "declared-boundary capture");
}

function canonicalDeclaredBoundaryReportJson(result) {
  if (!isPlainObject(result) || result.mapped !== true || result.report === null) {
    throw new TypeError(
      "canonical report bytes require a mapped declared-boundary capture result"
    );
  }
  return canonicalJsonBytes(result.report, { file: true });
}

export {
  DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION,
  DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES,
  DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION,
  DECLARED_BOUNDARY_NOT_ESTABLISHED,
  DECLARED_BOUNDARY_OBSERVATION_PROVENANCE,
  DECLARED_BOUNDARY_PROFILE_ID,
  DECLARED_BOUNDARY_PROFILE_VERSION,
  canonicalDeclaredBoundaryEvaluationInputJson,
  canonicalDeclaredBoundaryReportJson,
  mapDeclaredBoundaryCapture
};
