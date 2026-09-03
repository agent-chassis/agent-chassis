import {
  ExactBindingError,
  canonicalDigest,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  parseCanonicalDocument,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";
import { GRAPH_VERSION } from "./projected-contract-graph.mjs";

const TRANSFORMER_ID = "declared-boundary-record-consistency.v1";
const POLICY_VERSION = "controlled-contract.declared-bounded-policy.v1";
const OBSERVATION_VERSION = "controlled-contract.declared-boundary-observations.v1";
const SUBJECTS_VERSION = "controlled-contract.declared-boundary-subjects.v1";
const REPORT_VERSION = "controlled-contract.declared-boundary-record-consistency-report.v1";
const CONTRACT_VERSION = "controlled-acceptance-contract.experimental.v0.2";
const PROFILE_ID = "acceptance-contract.standard.experimental.v0.2";
const VOCABULARY_VERSION = "cv.experimental.0.34";

const UNIT_CLASSES = Object.freeze({
  unicode_scalar_count: "unicode_scalar_measurement",
  utf16_code_unit_count: "utf16_code_unit_measurement",
  utf8_byte_count: "utf8_byte_measurement"
});
const POSITIONS = Object.freeze(["above", "at", "below"]);
const FACT_KEYS = Object.freeze([
  "boundary-census-complete",
  "disposition-table-consistent",
  "measurement-recomputed",
  "policy-well-formed",
  "provenance-caller-asserted",
  "report-source-set-bound",
  "subject-population-complete"
]);
const POPULATION_REFERENCES = Object.freeze({
  "boundary-cases": "ref-bpr-boundary-case-population",
  "declared-limits": "ref-bpr-declared-limit-population",
  "measured-subjects": "ref-bpr-measured-subject-population",
  "measurement-units": "ref-bpr-measurement-unit-population"
});

const FIXED_REFERENCES = Object.freeze({
  subject: "ref-bpr-bounded-subject",
  policy: "ref-bpr-policy-artifact",
  observation: "ref-bpr-observation-artifact",
  subjects: "ref-bpr-subjects-artifact",
  report: "ref-bpr-conformance-report",
  verification: "ref-bpr-verification",
  condition: "ref-bpr-mismatch-condition"
});

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}

function exactKeys(value, required, optional = []) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function nfc(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      value !== value.normalize("NFC")) fail(
    "bounded_policy_identifier_invalid",
    "bounded-policy identifiers must be nonempty canonical NFC without NUL", { field }
  );
  return value;
}

function referenceId(prefix, value) {
  return `ref-${prefix}-${sha256(canonicalJsonBytes(value))}`;
}

function assertPolicy(value) {
  if (!exactKeys(value, ["limits", "schema_version"]) ||
      value.schema_version !== POLICY_VERSION || !Array.isArray(value.limits) ||
      value.limits.length === 0) fail(
    "declared_policy_invalid", "declared policy has an invalid closed outer shape"
  );
  const limits = value.limits.map((limit, index) => {
    if (!exactKeys(limit, [
      "bound_direction", "bound_inclusivity", "limit_key", "limit_value",
      "measurement_class", "normalization", "overflow_disposition", "unit"
    ])) fail("declared_policy_limit_invalid", "declared limit has an invalid closed shape", {
      index
    });
    const limitKey = nfc(limit.limit_key, `limits[${index}].limit_key`);
    if (!Number.isSafeInteger(limit.limit_value) || limit.limit_value < 0 ||
        (limit.limit_value === 0 && limit.bound_direction !== "maximum") ||
        !Object.hasOwn(UNIT_CLASSES, limit.unit) ||
        limit.measurement_class !== UNIT_CLASSES[limit.unit] ||
        !["maximum", "minimum"].includes(limit.bound_direction) ||
        !["inclusive", "exclusive"].includes(limit.bound_inclusivity) ||
        !["refuse", "truncate"].includes(limit.overflow_disposition) ||
        !["nfc", "nfd", "none"].includes(limit.normalization)) fail(
      "declared_policy_limit_invalid", "declared limit uses an invalid value or closed term", {
        limit_key: limitKey
      }
    );
    return structuredClone(limit);
  });
  if (new Set(limits.map(({ limit_key: key }) => key)).size !== limits.length) fail(
    "declared_policy_noncanonical", "declared limits must be unique by key"
  );
  return limits.sort((left, right) => compareCodeUnits(left.limit_key, right.limit_key));
}

function assertObservation(value) {
  if (!exactKeys(value, ["cases", "provenance", "schema_version"]) ||
      value.schema_version !== OBSERVATION_VERSION || !Array.isArray(value.cases) ||
      !["caller_asserted", "captured_execution_transcript"].includes(value.provenance)) fail(
    "boundary_observation_invalid", "boundary observation has an invalid closed outer shape"
  );
  if (value.provenance !== "caller_asserted") fail(
    "boundary_observation_provenance_unestablished",
    "version 1 accepts caller_asserted provenance only; capture provenance is not established"
  );
  const cases = value.cases.map((entry, index) => {
    if (!exactKeys(entry, [
      "boundary_position", "case_id", "limit_key", "observed_disposition", "subject_id"
    ], ["observed_truncated_measure"]) ||
        !POSITIONS.includes(entry.boundary_position) ||
        !["accepted", "refused", "truncated"].includes(entry.observed_disposition) ||
        (entry.observed_disposition === "truncated") !==
          Object.hasOwn(entry, "observed_truncated_measure") ||
        (Object.hasOwn(entry, "observed_truncated_measure") &&
          (!Number.isSafeInteger(entry.observed_truncated_measure) ||
            entry.observed_truncated_measure < 0))) fail(
      "boundary_observation_case_invalid", "boundary case has an invalid closed shape", { index }
    );
    nfc(entry.case_id, `cases[${index}].case_id`);
    nfc(entry.limit_key, `cases[${index}].limit_key`);
    nfc(entry.subject_id, `cases[${index}].subject_id`);
    return structuredClone(entry);
  });
  if (!sortedUnique(cases.map(({ case_id: id }) => id))) fail(
    "boundary_observation_noncanonical", "boundary cases must be sorted and unique by case id"
  );
  return { cases, provenance: value.provenance };
}

function assertSubjects(value) {
  if (!exactKeys(value, ["schema_version", "subjects"]) ||
      value.schema_version !== SUBJECTS_VERSION || !Array.isArray(value.subjects)) fail(
    "boundary_subjects_invalid", "boundary subjects have an invalid closed outer shape"
  );
  const subjects = value.subjects.map((subject, index) => {
    if (!exactKeys(subject, ["content_base64", "content_encoding", "subject_id"]) ||
        subject.content_encoding !== "utf8_base64" ||
        typeof subject.content_base64 !== "string") fail(
      "boundary_subject_invalid", "boundary subject has an invalid closed shape", { index }
    );
    nfc(subject.subject_id, `subjects[${index}].subject_id`);
    const bytes = Buffer.from(subject.content_base64, "base64");
    if (bytes.toString("base64") !== subject.content_base64 ||
        Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes) === false) fail(
      "boundary_subject_encoding_invalid", "subject content must be canonical well-formed UTF-8"
    );
    return { ...structuredClone(subject), bytes, text: bytes.toString("utf8") };
  });
  if (!sortedUnique(subjects.map(({ subject_id: id }) => id))) fail(
    "boundary_subjects_noncanonical", "subjects must be sorted and unique by subject id"
  );
  return subjects;
}

function normalized(text, normalization) {
  return normalization === "none" ? text : text.normalize(normalization.toUpperCase());
}

function measure(subject, limit) {
  const text = normalized(subject.text, limit.normalization);
  if (limit.unit === "unicode_scalar_count") return Array.from(text).length;
  if (limit.unit === "utf16_code_unit_count") return text.length;
  if (limit.unit === "utf8_byte_count") return Buffer.byteLength(text, "utf8");
  fail("declared_policy_unit_unknown", "declared policy unit is not measurable");
}

function expectedDisposition(limit, position) {
  const within = limit.bound_direction === "maximum"
    ? (position === "below" || (position === "at" && limit.bound_inclusivity === "inclusive"))
    : (position === "above" || (position === "at" && limit.bound_inclusivity === "inclusive"));
  return within ? "accepted" : limit.overflow_disposition === "truncate"
    ? "truncated" : "refused";
}

function sourceSetDigest(sourceContentSha256) {
  return sha256(canonicalJsonBytes({
    source_content_sha256: sourceContentSha256,
    transformer_id: TRANSFORMER_ID
  }));
}

function deriveReport(policy, observation, subjects, digests) {
  const limitByKey = new Map(policy.map((limit) => [limit.limit_key, limit]));
  const subjectById = new Map(subjects.map((subject) => [subject.subject_id, subject]));
  const seenSubjects = new Set();
  const seenPairs = new Set();
  const derivedCases = [];
  for (const entry of observation.cases) {
    const limit = limitByKey.get(entry.limit_key);
    const subject = subjectById.get(entry.subject_id);
    if (!limit || !subject) fail(
      "boundary_population_reference_unknown",
      "every boundary case must name one declared limit and one captured subject",
      { case_id: entry.case_id }
    );
    const pair = `${entry.limit_key}\0${entry.boundary_position}`;
    if (seenPairs.has(pair)) fail(
      "boundary_case_duplicate", "each limit may have exactly one case per boundary position",
      { limit_key: entry.limit_key, boundary_position: entry.boundary_position }
    );
    seenPairs.add(pair);
    seenSubjects.add(entry.subject_id);
    const measured = measure(subject, limit);
    const offset = entry.boundary_position === "below" ? -1 :
      entry.boundary_position === "above" ? 1 : 0;
    if (measured !== limit.limit_value + offset) fail(
      "boundary_measurement_mismatch",
      "captured subject measurement does not equal the declared boundary position",
      { case_id: entry.case_id, expected: limit.limit_value + offset, actual: measured }
    );
    const expected = expectedDisposition(limit, entry.boundary_position);
    if (entry.observed_disposition !== expected ||
        (expected === "truncated" && entry.observed_truncated_measure !== limit.limit_value)) fail(
      "boundary_disposition_mismatch",
      "recorded disposition is inconsistent with the declared policy table",
      { case_id: entry.case_id, expected, actual: entry.observed_disposition }
    );
    derivedCases.push({
      boundary_position: entry.boundary_position,
      case_id: entry.case_id,
      case_reference_id: referenceId("bpr-case", entry.case_id),
      limit_key: entry.limit_key,
      limit_reference_id: referenceId("bpr-limit", entry.limit_key),
      measured_value: measured,
      observed_disposition: entry.observed_disposition,
      subject_id: entry.subject_id,
      subject_reference_id: referenceId("bpr-subject", entry.subject_id)
    });
  }
  for (const limit of policy) {
    const required = limit.limit_value === 0 ? ["at", "above"] : ["below", "at", "above"];
    const actual = observation.cases.filter(({ limit_key: key }) => key === limit.limit_key)
      .map(({ boundary_position: position }) => position).sort(compareCodeUnits);
    if (JSON.stringify(actual) !== JSON.stringify(required.sort(compareCodeUnits))) fail(
      "boundary_census_incomplete", "each declared limit requires its exact boundary census",
      { limit_key: limit.limit_key, required, actual }
    );
  }
  if (seenSubjects.size !== subjects.length) fail(
    "boundary_subject_population_incomplete",
    "every captured subject must be referenced by at least one boundary case"
  );
  const source_content_sha256 = {
    boundary_observations: digests.boundaryObservations,
    declared_policy: digests.declaredPolicy,
    measured_subjects: digests.measuredSubjects
  };
  const source_set_sha256 = sourceSetDigest(source_content_sha256);
  const limits = policy.map((limit) => ({
    ...structuredClone(limit),
    limit_reference_id: referenceId("bpr-limit", limit.limit_key),
    unit_reference_id: referenceId("bpr-unit", {
      measurement_class: limit.measurement_class, unit: limit.unit
    })
  }));
  const populations = {
    "boundary-cases": derivedCases.map(({ case_reference_id: id }) => id).sort(compareCodeUnits),
    "declared-limits": limits.map(({ limit_reference_id: id }) => id).sort(compareCodeUnits),
    "measured-subjects": subjects.map(({ subject_id: id }) =>
      referenceId("bpr-subject", id)).sort(compareCodeUnits),
    "measurement-units": [...new Set(limits.map(({ unit_reference_id: id }) => id))]
      .sort(compareCodeUnits)
  };
  return {
    schema_version: REPORT_VERSION,
    transformer_id: TRANSFORMER_ID,
    source_set_sha256,
    source_content_sha256,
    provenance: observation.provenance,
    facts: FACT_KEYS.map((fact_key) => ({ fact_key, satisfied: true, source_set_sha256 })),
    limits,
    cases: derivedCases,
    populations,
    counts: Object.fromEntries(Object.entries(populations).map(([key, members]) => [key, members.length]))
  };
}

function parseSources(sourceBytes) {
  if (sourceBytes.length !== 3) fail(
    "boundary_source_set_invalid",
    "boundary projection requires exactly one policy, observation, and subject source"
  );
  const observationBytes = Buffer.from(sourceBytes[0]);
  const policyBytes = Buffer.from(sourceBytes[1]);
  const subjectsBytes = Buffer.from(sourceBytes[2]);
  const observation = parseCanonicalDocument(observationBytes, "boundary observations source");
  const policy = parseCanonicalDocument(policyBytes, "declared policy source");
  const subjects = parseCanonicalDocument(subjectsBytes, "measured subjects source");
  if (observation?.schema_version !== OBSERVATION_VERSION ||
      policy?.schema_version !== POLICY_VERSION ||
      subjects?.schema_version !== SUBJECTS_VERSION) fail(
    "boundary_source_role_mismatch",
    "each boundary projection source slot must contain the document declared for that role"
  );
  return [
    { kind: "observation", ...assertObservation(observation), digest: sha256(observationBytes) },
    { kind: "policy", limits: assertPolicy(policy), digest: sha256(policyBytes) },
    { kind: "subjects", subjects: assertSubjects(subjects), digest: sha256(subjectsBytes) }
  ];
}

function transform(sourceValues) {
  const policy = sourceValues.find(({ kind }) => kind === "policy");
  const observation = sourceValues.find(({ kind }) => kind === "observation");
  const subjects = sourceValues.find(({ kind }) => kind === "subjects");
  return deriveReport(policy.limits, observation, subjects.subjects, {
    declaredPolicy: policy.digest,
    boundaryObservations: observation.digest,
    measuredSubjects: subjects.digest
  });
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string") ||
      !sortedUnique(value)) fail("boundary_report_invalid", `${field} must be sorted and unique`);
}

function assertResult(value) {
  if (!exactKeys(value, [
    "cases", "counts", "facts", "limits", "populations", "provenance", "schema_version",
    "source_content_sha256", "source_set_sha256", "transformer_id"
  ]) || value.schema_version !== REPORT_VERSION || value.transformer_id !== TRANSFORMER_ID ||
      value.provenance !== "caller_asserted" || !/^[0-9a-f]{64}$/u.test(value.source_set_sha256) ||
      !exactKeys(value.source_content_sha256,
        ["boundary_observations", "declared_policy", "measured_subjects"]) ||
      sourceSetDigest(value.source_content_sha256) !== value.source_set_sha256 ||
      !Array.isArray(value.facts) || JSON.stringify(value.facts) !== JSON.stringify(
        FACT_KEYS.map((fact_key) => ({ fact_key, satisfied: true, source_set_sha256: value.source_set_sha256 }))
      ) || !Array.isArray(value.limits) || !Array.isArray(value.cases) ||
      !exactKeys(value.populations, Object.keys(POPULATION_REFERENCES)) ||
      !exactKeys(value.counts, Object.keys(POPULATION_REFERENCES))) fail(
    "boundary_report_invalid", "boundary projection result has an invalid closed shape"
  );
  for (const [name, members] of Object.entries(value.populations)) {
    assertStringArray(members, `populations.${name}`);
    if (value.counts[name] !== members.length) fail(
      "boundary_report_count_mismatch", "report count does not match its complete population",
      { population: name }
    );
  }
  return deepFreeze(value);
}

const ref = (reference_id) => ({ kind: "reference", reference_id });
const num = (value) => ({ kind: "number", value });
const bool = (value) => ({ kind: "boolean", value });
const context = { mode: "unconditional", operand_reference_ids: [] };
function durable(reference_id, type_term, domain, value) {
  return { reference_id, type_term, identity: { kind: "durable_id", domain, value } };
}
function addClaim(state, id, subject, operator, operands, kind = "evidence", extras = {}) {
  const proposition_id = `prop-${id}`;
  state.propositions.push({
    proposition_id, subject_reference_id: subject, operator,
    applicability_context: structuredClone(context), operands: structuredClone(operands)
  });
  const claim_id = `claim-${id}`;
  state.claims.push({ claim_id, kind, modality: "MUST", proposition_id, ...extras });
  return claim_id;
}
function addPopulation(state, name, members, domain) {
  const population = POPULATION_REFERENCES[name];
  state.references.push(durable(population, "cc:population", domain, name));
  if (members.length > 0) addClaim(state, `${name}-members`, population,
    "reference:contains", members.map(ref));
  addClaim(state, `${name}-cardinality`, population, "number:has_cardinality", [num(members.length)]);
}

function boundaryGraph(report) {
  const state = { references: [], propositions: [], claims: [], relations: [], collections: [] };
  const fixed = FIXED_REFERENCES;
  state.references.push(
    durable(fixed.subject, "cc:process", "controlled-contract:bounded-subject:v1", TRANSFORMER_ID),
    durable(fixed.policy, "cc:artifact", "controlled-contract:bounded-policy-source:v1",
      report.source_content_sha256.declared_policy),
    durable(fixed.observation, "cc:evidence", "controlled-contract:boundary-observation-source:v1",
      report.source_content_sha256.boundary_observations),
    durable(fixed.subjects, "cc:artifact", "controlled-contract:boundary-subject-source:v1",
      report.source_content_sha256.measured_subjects),
    durable(fixed.report, "cc:evidence", "controlled-contract:boundary-report:v1",
      report.source_set_sha256),
    durable(fixed.verification, "cc:test", "controlled-contract:boundary-verifier:v1", TRANSFORMER_ID),
    durable(fixed.condition, "cc:state", "controlled-contract:boundary-condition:v1", "mismatch")
  );
  for (const limit of report.limits) {
    state.references.push(durable(limit.limit_reference_id, "cc:criterion",
      "controlled-contract:declared-limit:v1", limit.limit_key));
    if (!state.references.some(({ reference_id: id }) => id === limit.unit_reference_id)) {
      state.references.push(durable(limit.unit_reference_id, "cc:configuration",
        "controlled-contract:measurement-unit:v1", `${limit.unit}:${limit.measurement_class}`));
    }
    addClaim(state, `limit-unit-${limit.limit_reference_id.slice(4)}`,
      limit.limit_reference_id, "reference:resolves_to", [ref(limit.unit_reference_id)]);
  }
  for (const entry of report.cases) {
    state.references.push(durable(entry.case_reference_id, "cc:test",
      "controlled-contract:boundary-case:v1", entry.case_id));
    addClaim(state, `case-limit-${entry.case_reference_id.slice(4)}`,
      entry.case_reference_id, "reference:targets", [ref(entry.limit_reference_id)]);
  }
  for (const subjectId of report.populations["measured-subjects"]) state.references.push(
    durable(subjectId, "cc:artifact", "controlled-contract:measured-subject:v1", subjectId)
  );
  for (const [name, members] of Object.entries(report.populations)) addPopulation(
    state, name, members, "controlled-contract:boundary-population:v1"
  );
  addClaim(state, "policy-contains-limits", fixed.policy, "reference:contains",
    [ref(POPULATION_REFERENCES["declared-limits"])]);
  addClaim(state, "policy-contains-units", fixed.policy, "reference:contains",
    [ref(POPULATION_REFERENCES["measurement-units"])]);
  addClaim(state, "observation-contains-cases", fixed.observation, "reference:contains",
    [ref(POPULATION_REFERENCES["boundary-cases"])]);
  addClaim(state, "subjects-contains-population", fixed.subjects, "reference:contains",
    [ref(POPULATION_REFERENCES["measured-subjects"])]);
  addClaim(state, "subject-uses-policy", fixed.subject, "reference:uses", [ref(fixed.policy)]);
  addClaim(state, "subject-deterministic", fixed.subject, "boolean:deterministic", [bool(true)]);
  const target = addClaim(state, "report-is-conformant", fixed.report, "boolean:exists",
    [bool(true)], "behavior");
  const verification = addClaim(state, "verify-report-is-conformant", fixed.verification,
    "reference:reads", [
      fixed.policy, fixed.observation, fixed.subjects, fixed.report
    ].map(ref),
    "verification", {
      verification_method: "test_execution",
      falsifying_proposition_id: "prop-report-not-conformant"
    });
  state.propositions.push({
    proposition_id: "prop-report-not-conformant", subject_reference_id: fixed.report,
    operator: "boolean:exists", applicability_context: structuredClone(context),
    operands: [bool(false)]
  });
  state.relations.push({
    relation_id: "rel-verifies-report-conformance", role: "verifies",
    source_claim_id: verification, target_claim_id: target
  });
  state.references.sort((a, b) => compareCodeUnits(a.reference_id, b.reference_id));
  state.propositions.sort((a, b) => compareCodeUnits(a.proposition_id, b.proposition_id));
  state.claims.sort((a, b) => compareCodeUnits(a.claim_id, b.claim_id));
  return { schema_version: GRAPH_VERSION, ...state };
}

function reportReference(report) {
  const graph = boundaryGraph(report);
  const reference = graph.references.find(({ reference_id: id }) => id === "ref-bpr-conformance-report");
  return {
    grounded_identity_sha256: canonicalDigest(reference.identity),
    reference_id: reference.reference_id,
    type_term: reference.type_term
  };
}

const DECLARED_BOUNDARY_RECORD_CONSISTENCY_TRANSFORMER = Object.freeze({
  transformer_id: TRANSFORMER_ID,
  source_count: 3,
  parse_sources: parseSources,
  transform,
  validate_result: assertResult,
  projections: Object.freeze({
    ...Object.fromEntries(Object.keys(POPULATION_REFERENCES).map((name) => [name, Object.freeze({
      cardinality: "set", project: (report) => report.populations[name]
    })])),
    "report-reference": Object.freeze({
      cardinality: "singleton_reference", project: reportReference
    })
  }),
  graph_projections: Object.freeze({
    "boundary-consistency-contract": Object.freeze({ project: boundaryGraph })
  })
});

function deriveDeclaredBoundaryRecordConsistency({ policyBytes, observationBytes, subjectsBytes }) {
  const values = parseSources([observationBytes, policyBytes, subjectsBytes]);
  return canonicalJsonBytes(assertResult(transform(values)), { file: true });
}

export {
  DECLARED_BOUNDARY_RECORD_CONSISTENCY_TRANSFORMER,
  FACT_KEYS,
  FIXED_REFERENCES,
  OBSERVATION_VERSION,
  POLICY_VERSION,
  POPULATION_REFERENCES,
  REPORT_VERSION,
  SUBJECTS_VERSION,
  TRANSFORMER_ID,
  UNIT_CLASSES,
  assertPolicy,
  boundaryGraph,
  deriveDeclaredBoundaryRecordConsistency
};
