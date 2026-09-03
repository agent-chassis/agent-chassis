import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
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
} from "../lib/declared-boundary-capture.mjs";
import { loadAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import { canonicalJsonBytes } from "../lib/deterministic-projection-primitives.mjs";
import { evaluateVerificationProfileV1 } from "../current.mjs";
import {
  baseLimits,
  buildBoundaryFixture
} from "./proof-packs/bounded-policy-v1-fixture.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const CODES = DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES;
const pack = await loadAdmittedProofPack(DECLARED_BOUNDARY_PROFILE_ID);

// ---------------------------------------------------------------------------
// Fixtures. `buildBoundaryFixture` is the package's established owner of a
// complete, consistent boundary corpus for this pack, so the positive captures
// come from it rather than from a second hand-written corpus. Every negative
// capture is that corpus with exactly ONE document mutated and re-serialized, so
// each refusal is attributable to one defect.
// ---------------------------------------------------------------------------

const PATHS = Object.freeze({
  policy: "evidence/declared-policy.json",
  observation: "evidence/boundary-observations.json",
  subjects: "evidence/measured-subjects.json",
  report: "evidence/boundary-report.json"
});
const RECORD_ID = "WK-0000/boundary-observation-record";

const bytesOf = (document) => canonicalJsonBytes(document, { file: true });
const artifact = (relativePath) => ({ kind: "artifact_file", relative_path: relativePath });

const base = buildBoundaryFixture();

function captureFor({
  policy = base.policyBytes,
  observation = base.observationBytes,
  subjects = base.subjectsBytes,
  recordId = RECORD_ID,
  overrides = {}
} = {}) {
  return {
    schema_version: DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION,
    policy: { bytes: policy, source: artifact(PATHS.policy) },
    observation: {
      record_id: recordId, bytes: observation, source: artifact(PATHS.observation)
    },
    subjects: { bytes: subjects, source: artifact(PATHS.subjects) },
    report: { source: artifact(PATHS.report) },
    ...overrides
  };
}

// One document mutated in place, then re-serialized to canonical bytes.
function withPolicy(mutate) {
  const document = structuredClone(base.policy);
  mutate(document);
  return bytesOf(document);
}
function withObservation(mutate) {
  const document = structuredClone(base.observation);
  mutate(document);
  return bytesOf(document);
}
function withSubjects(mutate) {
  const document = structuredClone(base.subjects);
  mutate(document);
  return bytesOf(document);
}

const limitOf = (document, key) =>
  document.limits.find(({ limit_key: candidate }) => candidate === key);
const caseOf = (document, id) =>
  document.cases.find(({ case_id: candidate }) => candidate === id);
const subjectOf = (document, id) =>
  document.subjects.find(({ subject_id: candidate }) => candidate === id);
const base64 = (text) => Buffer.from(text, "utf8").toString("base64");

async function mapOrThrow(capture, options = {}) {
  const result = await mapDeclaredBoundaryCapture({ capture, ...options });
  assert.equal(result.mapped, true, JSON.stringify(result.refusal));
  return result;
}

// Failure is atomic: a refusal nulls every output carrier at once, so no caller
// can read one as a degraded or partial mapping.
async function refusalFor(capture, options = {}) {
  const result = await mapDeclaredBoundaryCapture({ capture, ...options });
  assert.equal(result.mapped, false, "expected a refusal");
  for (const field of [
    "source", "references", "evaluation_input", "exact_binding_sources", "report", "census"
  ]) assert.equal(result[field], null, field);
  assert.equal(result.schema_version, DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION);
  assert.equal(result.profile_id, DECLARED_BOUNDARY_PROFILE_ID);
  assert.equal(result.profile_version, DECLARED_BOUNDARY_PROFILE_VERSION);
  assert.equal(Object.isFrozen(result), true);
  return result.refusal;
}

const bindingFor = (result, role) =>
  result.evaluation_input.reference_bindings.find((entry) => entry.role === role);
const numberFor = (result, role) =>
  result.evaluation_input.number_bindings.find((entry) => entry.role === role);
const referenceFor = (result, referenceId) =>
  result.references.find((entry) => entry.reference_id === referenceId);
const censusFor = (result, key) =>
  result.census.limits.find((entry) => entry.limit_key === key);

// Exactly the diagnostics the pack's own runtime raises when a role binding is not
// admissible. Their ABSENCE is the compatibility proof.
const BINDING_DIAGNOSTIC_CODES = Object.freeze([
  "unknown_reference_role_binding",
  "reference_role_cardinality_invalid",
  "reference_role_binding_dangling",
  "reference_role_binding_type_mismatch",
  "reference_role_binding_identity_kind_mismatch",
  "unknown_number_role_binding",
  "number_role_binding_invalid"
]);

// The transformer's own contract graph, with the verification claim moved onto
// `analysis` -- a method this profile equally admits. The graph declares
// `test_execution`, which the stable family completes only against a delivered
// test proof, and a delivered test proof is not what these assertions are about:
// they are about whether the emitted BINDINGS are admissible.
function packContract() {
  const contract = structuredClone(base.contract);
  contract.claims.find(({ claim_id: id }) => id === "claim-verify-report-is-conformant")
    .verification_method = "analysis";
  return contract;
}

function bindingDiagnostics(contract, evaluationInput) {
  const result = evaluateVerificationProfileV1({
    contract,
    profile: pack.profile,
    evaluation_input: structuredClone(evaluationInput)
  });
  return result.diagnostics
    .filter(({ code }) => BINDING_DIAGNOSTIC_CODES.includes(code))
    .map(({ code }) => code);
}

// ---------------------------------------------------------------------------
// The complete derived census
// ---------------------------------------------------------------------------

test("one bounded capture fills the complete pack-owned role shape", async () => {
  const result = await mapOrThrow(captureFor());

  assert.equal(result.schema_version, DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION);
  assert.equal(result.profile_id, DECLARED_BOUNDARY_PROFILE_ID);
  assert.equal(result.profile_version, DECLARED_BOUNDARY_PROFILE_VERSION);
  assert.equal(result.capture_input_schema_version,
    DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION);
  assert.equal(result.transformer_id, "declared-boundary-record-consistency.v1");
  assert.equal(result.refusal, null);
  assert.equal(Object.isFrozen(result), true);

  // Roles, and their order, come from the pack rather than from this mapping.
  assert.deepEqual(
    result.evaluation_input.reference_bindings.map(({ role }) => role),
    pack.profile.reference_roles.map(({ role }) => role)
  );
  assert.equal(result.evaluation_input.evaluation_stage, pack.profile.evaluation_stages[0]);

  // The three exact source artifacts and the derived report are each bound once,
  // by the transformer's own grounded identities.
  for (const [role, referenceId, value] of [
    ["policy_artifact", "ref-bpr-policy-artifact",
      result.source.source_content_sha256.declared_policy],
    ["observation_artifact", "ref-bpr-observation-artifact",
      result.source.source_content_sha256.boundary_observations],
    ["subjects_artifact", "ref-bpr-subjects-artifact",
      result.source.source_content_sha256.measured_subjects],
    ["conformance_report", "ref-bpr-conformance-report", result.source.source_set_sha256]
  ]) {
    assert.deepEqual(bindingFor(result, role).reference_ids, [referenceId], role);
    assert.equal(referenceFor(result, referenceId).identity.value, value, role);
    assert.equal(referenceFor(result, referenceId).identity.kind, "durable_id", role);
  }
  assert.deepEqual(bindingFor(result, "bounded_subject").reference_ids,
    ["ref-bpr-bounded-subject"]);
  assert.deepEqual(bindingFor(result, "mismatch_condition").reference_ids,
    ["ref-bpr-mismatch-condition"]);

  // The exact source declarations are keyed by the PACK's own requirement ids,
  // including the derived projection result.
  assert.deepEqual(result.exact_binding_sources, {
    "declared-policy": artifact(PATHS.policy),
    "boundary-observations": artifact(PATHS.observation),
    "measured-subjects": artifact(PATHS.subjects),
    "boundary-report": artifact(PATHS.report)
  });
  assert.deepEqual(result.source.exact_binding_requirement_ids, {
    policy: "declared-policy",
    observation: "boundary-observations",
    subjects: "measured-subjects",
    report: "boundary-report"
  });
  assert.equal(result.source.observation_record_id, RECORD_ID);
});

test("every nonzero declared maximum carries its complete N-1/N/N+1 census", async () => {
  const result = await mapOrThrow(captureFor());

  // `bytes` is an inclusive maximum of 4 utf8 bytes with a refusing overflow.
  const bytes = censusFor(result, "bytes");
  assert.equal(bytes.zero_maximum, false);
  assert.equal(bytes.limit_value, 4);
  assert.deepEqual(bytes.boundary_positions, ["above", "at", "below"]);
  assert.deepEqual(bytes.cases.map(({ boundary_position: position, measured_value: measured,
    observed_disposition: disposition }) => [position, measured, disposition]), [
    ["above", 5, "refused"],
    ["at", 4, "accepted"],
    ["below", 3, "accepted"]
  ]);

  // `scalar` is an EXCLUSIVE maximum of 2 scalars with a truncating overflow, so
  // the same census shape resolves to a different declared disposition table.
  const scalar = censusFor(result, "scalar");
  assert.equal(scalar.zero_maximum, false);
  assert.deepEqual(scalar.cases.map(({ boundary_position: position, measured_value: measured,
    observed_disposition: disposition }) => [position, measured, disposition]), [
    ["above", 3, "truncated"],
    ["at", 2, "truncated"],
    ["below", 1, "accepted"]
  ]);

  // A minimum bound gets the same three-position census, mirrored.
  const utf16 = censusFor(result, "utf16");
  assert.equal(utf16.bound_direction, "minimum");
  assert.deepEqual(utf16.cases.map(({ boundary_position: position, measured_value: measured,
    observed_disposition: disposition }) => [position, measured, disposition]), [
    ["above", 3, "accepted"],
    ["at", 2, "accepted"],
    ["below", 1, "refused"]
  ]);
});

test("a zero maximum carries exactly N and N+1 and no invented N-1", async () => {
  const result = await mapOrThrow(captureFor());
  const empty = censusFor(result, "empty");

  assert.equal(empty.limit_value, 0);
  assert.equal(empty.zero_maximum, true);
  assert.deepEqual(empty.boundary_positions, ["above", "at"]);
  assert.deepEqual(empty.cases.map(({ boundary_position: position, measured_value: measured }) =>
    [position, measured]), [["above", 1], ["at", 0]]);
  // Nothing below a zero maximum exists to be measured, so nothing was invented.
  assert.equal(empty.cases.some(({ measured_value: measured }) => measured < 0), false);
  assert.equal(empty.boundary_positions.includes("below"), false);
});

test("the complete census is measured under the exact declared unit lexicon", async () => {
  const result = await mapOrThrow(captureFor());

  // Three distinct declared units, each with the measurement class the closed
  // lexicon assigns to it, and no unit collapsed onto another.
  assert.deepEqual(result.census.limits.map(({ limit_key: key, unit, measurement_class: cls }) =>
    [key, unit, cls]), [
    ["bytes", "utf8_byte_count", "utf8_byte_measurement"],
    ["empty", "unicode_scalar_count", "unicode_scalar_measurement"],
    ["scalar", "unicode_scalar_count", "unicode_scalar_measurement"],
    ["utf16", "utf16_code_unit_count", "utf16_code_unit_measurement"]
  ]);
  assert.equal(numberFor(result, "measurement_units_count").value, 3);

  // The `scalar` subjects are repeated "é": two utf8 bytes and one utf16 code unit
  // each. Measuring 1/2/3 there rather than 2/4/6 or 1/2/3-of-something-else is
  // what shows the DECLARED unit was applied and not a byte length.
  const scalarSubject = subjectOf(base.subjects, "subject-scalar-at");
  assert.equal(Buffer.from(scalarSubject.content_base64, "base64").byteLength, 4);
  assert.equal(censusFor(result, "scalar").cases
    .find(({ boundary_position: position }) => position === "at").measured_value, 2);

  // The `utf16` subjects at the boundary are one astral scalar: two utf16 code
  // units, four utf8 bytes, one scalar.
  const utf16Subject = subjectOf(base.subjects, "subject-utf16-at");
  assert.equal(Buffer.from(utf16Subject.content_base64, "base64").byteLength, 4);
  assert.equal(censusFor(result, "utf16").cases
    .find(({ boundary_position: position }) => position === "at").measured_value, 2);
});

test("the complete subject population is measured with no cap or sampling", async () => {
  // Twelve declared limits over one unit: thirty-six census rows and thirty-six
  // captured subjects, well past any plausible page or preview bound.
  const limits = Array.from({ length: 12 }, (unused, index) => ({
    bound_direction: "maximum",
    bound_inclusivity: "inclusive",
    limit_key: `wide-${String(index).padStart(2, "0")}`,
    limit_value: index + 1,
    measurement_class: "utf8_byte_measurement",
    normalization: "none",
    overflow_disposition: "refuse",
    unit: "utf8_byte_count"
  }));
  const wide = buildBoundaryFixture({ limits });
  const result = await mapOrThrow(captureFor({
    policy: wide.policyBytes,
    observation: wide.observationBytes,
    subjects: wide.subjectsBytes
  }));

  assert.equal(wide.subjects.subjects.length, 36);
  assert.equal(result.census.limits.length, 12);
  assert.equal(result.census.boundary_case_count, 36);
  assert.equal(result.census.measured_subject_count, 36);
  assert.equal(result.source.measured_subject_count, 36);
  assert.equal(bindingFor(result, "measured_subjects").reference_ids.length, 36);
  assert.equal(bindingFor(result, "boundary_cases").reference_ids.length, 36);
  assert.equal(numberFor(result, "measured_subjects_count").value, 36);
  assert.equal(numberFor(result, "boundary_cases_count").value, 36);
  // Every declared limit contributes its complete three-position census.
  for (const limit of result.census.limits) {
    assert.deepEqual(limit.boundary_positions, ["above", "at", "below"], limit.limit_key);
  }
});

test("counts equal their complete populations for every derived population", async () => {
  const result = await mapOrThrow(captureFor());
  for (const [referenceRole, numberRole] of [
    ["declared_limits", "declared_limits_count"],
    ["measurement_units", "measurement_units_count"],
    ["boundary_cases", "boundary_cases_count"],
    ["measured_subjects", "measured_subjects_count"]
  ]) {
    assert.equal(numberFor(result, numberRole).value,
      bindingFor(result, referenceRole).reference_ids.length, numberRole);
  }
  assert.deepEqual(result.evaluation_input.number_bindings.map(({ role }) => role),
    pack.profile.reference_role_count_bindings.map(({ number_role: role }) => role));
  assert.deepEqual(result.evaluation_input.number_bindings,
    [
      { role: "declared_limits_count", value: 4 },
      { role: "measurement_units_count", value: 3 },
      { role: "boundary_cases_count", value: 11 },
      { role: "measured_subjects_count", value: 11 }
    ]);
});

// ---------------------------------------------------------------------------
// Determinism, ordering, and the derived report
// ---------------------------------------------------------------------------

test("two mappings of one capture are byte-identical and deterministically ordered",
  async () => {
    const [first, second] = await Promise.all([
      mapOrThrow(captureFor()), mapOrThrow(captureFor())
    ]);
    assert.ok(canonicalDeclaredBoundaryEvaluationInputJson(first)
      .equals(canonicalDeclaredBoundaryEvaluationInputJson(second)));
    assert.ok(canonicalJsonBytes(first.census).equals(canonicalJsonBytes(second.census)));
    assert.ok(canonicalJsonBytes(first.references).equals(canonicalJsonBytes(second.references)));
    assert.ok(canonicalDeclaredBoundaryReportJson(first)
      .equals(canonicalDeclaredBoundaryReportJson(second)));

    // Populations are emitted in code-unit order; the census is ordered by limit
    // key and then by boundary position.
    for (const role of ["declared_limits", "measurement_units", "boundary_cases",
      "measured_subjects"]) {
      const members = bindingFor(first, role).reference_ids;
      assert.deepEqual(members, [...members].sort(), role);
    }
    assert.deepEqual(first.census.limits.map(({ limit_key: key }) => key),
      [...baseLimits].map(({ limit_key: key }) => key).sort());
    for (const limit of first.census.limits) {
      assert.deepEqual(limit.boundary_positions, [...limit.boundary_positions].sort(),
        limit.limit_key);
    }
  });

test("the carried report is the owning transformer's exact canonical report", async () => {
  const result = await mapOrThrow(captureFor());
  assert.ok(canonicalDeclaredBoundaryReportJson(result).equals(base.reportBytes));
  assert.equal(result.source.report_bytes_sha256,
    (await import("node:crypto")).createHash("sha256").update(base.reportBytes).digest("hex"));
  assert.equal(result.report.transformer_id, "declared-boundary-record-consistency.v1");
  assert.equal(result.report.source_set_sha256, result.source.source_set_sha256);
  assert.equal(Object.isFrozen(result.report), true);
  assert.equal(result.report.facts.every(({ satisfied }) => satisfied === true), true);
});

test("canonical report bytes are refused for a result that carries no report", async () => {
  const refused = await mapDeclaredBoundaryCapture({ capture: null });
  assert.throws(() => canonicalDeclaredBoundaryReportJson(refused), TypeError);
  assert.throws(() => canonicalDeclaredBoundaryEvaluationInputJson(refused), TypeError);
});

// ---------------------------------------------------------------------------
// The selected observation record, validated against the complete census
// ---------------------------------------------------------------------------

test("the selected observation record validates against the complete derived census",
  async () => {
    const result = await mapOrThrow(captureFor());

    // Every derived case names one declared limit and one captured subject, and
    // each recorded case appears exactly once.
    const cases = result.census.limits.flatMap(({ limit_key: key, cases: rows }) =>
      rows.map(({ boundary_position: position }) => `${key} ${position}`));
    assert.equal(new Set(cases).size, cases.length);
    assert.equal(cases.length, base.observation.cases.length);

    const subjects = result.census.limits.flatMap(({ cases: rows }) =>
      rows.map(({ subject_id: id }) => id));
    assert.equal(new Set(subjects).size, base.subjects.subjects.length);
    assert.deepEqual([...new Set(subjects)].sort(),
      base.subjects.subjects.map(({ subject_id: id }) => id).sort());
  });

test("the emitted bindings are admissible against the pack's own binding analysis",
  async () => {
    const result = await mapOrThrow(captureFor());
    assert.deepEqual(bindingDiagnostics(packContract(), result.evaluation_input), []);

    // Mutating an emitted binding makes the pack runtime reject it, so the empty
    // result above is a property of the mapping and not of a permissive analysis.
    const unknownRole = structuredClone(result.evaluation_input);
    unknownRole.reference_bindings[0].role = "bounded_subjects";
    assert.ok(bindingDiagnostics(packContract(), unknownRole)
      .includes("unknown_reference_role_binding"));

    // A cc:population reference bound to a role that admits only cc:criterion.
    const wrongTypeTerm = structuredClone(result.evaluation_input);
    wrongTypeTerm.reference_bindings.find(({ role }) => role === "declared_limits")
      .reference_ids = ["ref-bpr-declared-limit-population"];
    assert.ok(bindingDiagnostics(packContract(), wrongTypeTerm)
      .includes("reference_role_binding_type_mismatch"));

    // Two members on an exactly_one role.
    const wrongCardinality = structuredClone(result.evaluation_input);
    wrongCardinality.reference_bindings.find(({ role }) => role === "policy_artifact")
      .reference_ids = ["ref-bpr-policy-artifact", "ref-bpr-subjects-artifact"];
    assert.ok(bindingDiagnostics(packContract(), wrongCardinality)
      .includes("reference_role_cardinality_invalid"));
  });

test("the mapped evaluation input matches the pack's own template bindings", async () => {
  const result = await mapOrThrow(captureFor());
  const asMap = (input) => ({
    input_version: input.input_version,
    evaluation_stage: input.evaluation_stage,
    number_bindings: [...input.number_bindings]
      .sort((left, right) => left.role < right.role ? -1 : 1),
    bindings: Object.fromEntries(input.reference_bindings.map(
      ({ role, reference_ids: ids }) => [role, ids]
    ))
  });
  // The fixture's evaluation input is built independently of this mapping, from
  // the same derived report.
  assert.deepEqual(asMap(result.evaluation_input), asMap(base.evaluationInput));
  assert.deepEqual(result.evaluation_input.claim_pattern_bindings, []);
  assert.deepEqual(result.evaluation_input.resolver_facts, []);
  assert.deepEqual(result.evaluation_input.delivered_evidence, []);
  assert.deepEqual(result.evaluation_input.stable_evaluation, {});
});

// ---------------------------------------------------------------------------
// Authority. A mapped result stays a caller declaration.
// ---------------------------------------------------------------------------

test("the observation stays caller-asserted and the result stays non-authoritative",
  async () => {
    const result = await mapOrThrow(captureFor());
    assert.equal(DECLARED_BOUNDARY_OBSERVATION_PROVENANCE, "caller_asserted");
    assert.equal(result.source.observation_provenance, "caller_asserted");
    assert.equal(result.report.provenance, "caller_asserted");
    assert.equal(result.census.provenance, "caller_asserted");
    assert.equal(result.census.authority, "caller_declaration_only");
    assert.deepEqual(result.census.not_established, [
      "execution-provenance",
      "policy-to-production-correspondence",
      "production-truth",
      "runtime-enforcement"
    ]);
    assert.deepEqual([...DECLARED_BOUNDARY_NOT_ESTABLISHED], result.census.not_established);

    // The mapping asserts nothing a pack would credit beyond the caller
    // declaration: no resolver facts, no delivered evidence, no stable evaluation.
    assert.equal(result.evaluation_input.resolver_facts.length, 0);
    assert.equal(result.evaluation_input.delivered_evidence.length, 0);
    assert.equal(Object.keys(result.evaluation_input.stable_evaluation).length, 0);

    // No output field claims execution, enforcement, or production truth. The
    // census `not_established` list is exactly where those words are allowed, and
    // it is a disclaimer rather than a claim.
    const emitted = JSON.stringify({
      source: result.source,
      exact_binding_sources: result.exact_binding_sources,
      census: { ...result.census, not_established: [] }
    });
    for (const claim of ["executed", "enforced", "production", "runtime", "observed_at"]) {
      assert.equal(emitted.includes(claim), false, claim);
    }
  });

test("an observation that claims capture provenance is refused, not upgraded", async () => {
  const refusal = await refusalFor(captureFor({
    observation: withObservation((document) => {
      document.provenance = "captured_execution_transcript";
    })
  }));
  assert.equal(refusal.code, CODES.OBSERVATION_PROVENANCE_UNSUPPORTED);
});

// ---------------------------------------------------------------------------
// Refusals, each independently discriminating
// ---------------------------------------------------------------------------

const REFUSAL_CASES = Object.freeze([
  // --- Open policy -------------------------------------------------------
  Object.freeze({
    name: "an open policy carrying a field outside its closed shape",
    code: CODES.POLICY_NOT_CLOSED,
    capture: () => captureFor({
      policy: withPolicy((document) => { document.extensions = []; })
    })
  }),
  Object.freeze({
    name: "an open policy whose limit carries an undeclared field",
    code: CODES.POLICY_NOT_CLOSED,
    capture: () => captureFor({
      policy: withPolicy((document) => { limitOf(document, "bytes").notes = "extra"; })
    })
  }),
  Object.freeze({
    name: "an open policy whose limit uses a term outside the closed lexicon",
    code: CODES.POLICY_NOT_CLOSED,
    capture: () => captureFor({
      policy: withPolicy((document) => {
        limitOf(document, "bytes").overflow_disposition = "clamp";
      })
    })
  }),
  // --- Ambiguous policy --------------------------------------------------
  Object.freeze({
    name: "an ambiguous policy declaring two limits under one key",
    code: CODES.POLICY_AMBIGUOUS,
    capture: () => captureFor({
      policy: withPolicy((document) => {
        document.limits.push({ ...structuredClone(limitOf(document, "bytes")), limit_value: 9 });
      })
    })
  }),
  // --- Unsupported measurement unit --------------------------------------
  Object.freeze({
    name: "a declared unit outside the closed measurement lexicon",
    code: CODES.MEASUREMENT_UNIT_UNSUPPORTED,
    capture: () => captureFor({
      policy: withPolicy((document) => {
        const limit = limitOf(document, "bytes");
        limit.unit = "grapheme_cluster_count";
        limit.measurement_class = "grapheme_cluster_measurement";
      })
    })
  }),
  Object.freeze({
    name: "a measurement class the lexicon does not assign to the declared unit",
    code: CODES.MEASUREMENT_UNIT_UNSUPPORTED,
    capture: () => captureFor({
      policy: withPolicy((document) => {
        limitOf(document, "bytes").measurement_class = "unicode_scalar_measurement";
      })
    })
  }),
  // --- Incomplete subject population -------------------------------------
  Object.freeze({
    name: "a captured subject the derived census does not cover",
    code: CODES.SUBJECT_POPULATION_INCOMPLETE,
    capture: () => captureFor({
      subjects: withSubjects((document) => {
        document.subjects.push({
          content_base64: base64("a"), content_encoding: "utf8_base64",
          subject_id: "zz-unreferenced-subject"
        });
      })
    })
  }),
  // --- Duplicate subject identity ----------------------------------------
  Object.freeze({
    name: "two captured subjects under one subject identity",
    code: CODES.SUBJECT_IDENTITY_DUPLICATE,
    capture: () => captureFor({
      subjects: withSubjects((document) => {
        const index = document.subjects.findIndex(
          ({ subject_id: id }) => id === "subject-bytes-at"
        );
        document.subjects.splice(index + 1, 0, {
          content_base64: base64("bbbb"), content_encoding: "utf8_base64",
          subject_id: "subject-bytes-at"
        });
      })
    })
  }),
  // --- Unresolved policy bytes -------------------------------------------
  Object.freeze({
    name: "policy bytes that were never resolved",
    code: CODES.POLICY_BYTES_UNRESOLVED,
    capture: () => captureFor({ policy: null })
  }),
  Object.freeze({
    name: "empty policy bytes",
    code: CODES.POLICY_BYTES_UNRESOLVED,
    capture: () => captureFor({ policy: Buffer.alloc(0) })
  }),
  Object.freeze({
    name: "policy bytes that are not one canonical document",
    code: CODES.POLICY_BYTES_UNRESOLVED,
    capture: () => captureFor({ policy: Buffer.from("{not json", "utf8") })
  }),
  Object.freeze({
    name: "policy bytes carrying another role's document",
    code: CODES.POLICY_BYTES_UNRESOLVED,
    capture: () => captureFor({ policy: base.subjectsBytes })
  }),
  // --- Unresolved subject bytes ------------------------------------------
  Object.freeze({
    name: "subject bytes that were never resolved",
    code: CODES.SUBJECT_BYTES_UNRESOLVED,
    capture: () => captureFor({
      overrides: { subjects: { bytes: null, source: artifact(PATHS.subjects) } }
    })
  }),
  Object.freeze({
    name: "subject bytes that are not a byte sequence",
    code: CODES.SUBJECT_BYTES_UNRESOLVED,
    capture: () => captureFor({ subjects: base.subjectsBytes.toString("utf8") })
  }),
  Object.freeze({
    name: "subject bytes carrying another role's document",
    code: CODES.SUBJECT_BYTES_UNRESOLVED,
    capture: () => captureFor({ subjects: base.policyBytes })
  }),
  // --- Unresolved observation-record bytes or identity --------------------
  Object.freeze({
    name: "observation bytes that were never resolved",
    code: CODES.OBSERVATION_RECORD_UNRESOLVED,
    capture: () => captureFor({ observation: null })
  }),
  Object.freeze({
    name: "an observation record with no resolved record identity",
    code: CODES.OBSERVATION_RECORD_UNRESOLVED,
    capture: () => captureFor({ recordId: "" })
  }),
  Object.freeze({
    name: "an observation record whose identity is not a string",
    code: CODES.OBSERVATION_RECORD_UNRESOLVED,
    capture: () => captureFor({ recordId: 17 })
  }),
  Object.freeze({
    name: "observation bytes carrying another role's document",
    code: CODES.OBSERVATION_RECORD_UNRESOLVED,
    capture: () => captureFor({ observation: base.policyBytes })
  }),
  // --- Arithmetic mismatch ------------------------------------------------
  Object.freeze({
    name: "a measured subject that is not at the boundary position it is recorded at",
    code: CODES.BOUNDARY_ARITHMETIC_MISMATCH,
    capture: () => captureFor({
      subjects: withSubjects((document) => {
        subjectOf(document, "subject-bytes-at").content_base64 = base64("aaa");
      })
    })
  }),
  Object.freeze({
    name: "a zero-maximum subject measured above its recorded position",
    code: CODES.BOUNDARY_ARITHMETIC_MISMATCH,
    capture: () => captureFor({
      subjects: withSubjects((document) => {
        subjectOf(document, "subject-empty-at").content_base64 = base64("x");
      })
    })
  }),
  // --- Disposition mismatch ----------------------------------------------
  Object.freeze({
    name: "a recorded disposition the declared table does not produce",
    code: CODES.BOUNDARY_DISPOSITION_MISMATCH,
    capture: () => captureFor({
      observation: withObservation((document) => {
        caseOf(document, "bytes-above").observed_disposition = "accepted";
      })
    })
  }),
  Object.freeze({
    name: "an inclusive-boundary acceptance recorded as a refusal",
    code: CODES.BOUNDARY_DISPOSITION_MISMATCH,
    capture: () => captureFor({
      observation: withObservation((document) => {
        caseOf(document, "utf16-at").observed_disposition = "refused";
      })
    })
  }),
  Object.freeze({
    name: "a truncated disposition recorded against the wrong truncated measure",
    code: CODES.BOUNDARY_DISPOSITION_MISMATCH,
    capture: () => captureFor({
      observation: withObservation((document) => {
        caseOf(document, "scalar-above").observed_truncated_measure = 1;
      })
    })
  }),
  // --- Census completeness ------------------------------------------------
  Object.freeze({
    name: "an observation record missing one derived boundary case",
    code: CODES.BOUNDARY_CENSUS_INCOMPLETE,
    capture: () => captureFor({
      observation: withObservation((document) => {
        document.cases = document.cases.filter(({ case_id: id }) => id !== "bytes-below");
      }),
      subjects: withSubjects((document) => {
        document.subjects = document.subjects.filter(
          ({ subject_id: id }) => id !== "subject-bytes-below"
        );
      })
    })
  }),
  // A zero maximum has no N-1 to measure: no captured subject can be one unit
  // shorter than the empty subject, so an invented N-1 case is refused on the
  // arithmetic rather than admitted into the census.
  Object.freeze({
    name: "an observation record inventing an N-1 case for a zero maximum",
    code: CODES.BOUNDARY_ARITHMETIC_MISMATCH,
    capture: () => captureFor({
      observation: withObservation((document) => {
        document.cases.push({
          boundary_position: "below", case_id: "empty-below", limit_key: "empty",
          observed_disposition: "accepted", subject_id: "subject-empty-at"
        });
        document.cases.sort((left, right) => left.case_id < right.case_id ? -1 : 1);
      })
    })
  }),
  Object.freeze({
    name: "one derived boundary case recorded more than once",
    code: CODES.BOUNDARY_CENSUS_DUPLICATE,
    capture: () => captureFor({
      observation: withObservation((document) => {
        document.cases.push({
          boundary_position: "at", case_id: "bytes-at-again", limit_key: "bytes",
          observed_disposition: "accepted", subject_id: "subject-bytes-at"
        });
        document.cases.sort((left, right) => left.case_id < right.case_id ? -1 : 1);
      })
    })
  }),
  Object.freeze({
    name: "a boundary case naming a limit the declared policy does not carry",
    code: CODES.BOUNDARY_CENSUS_REFERENCE_UNKNOWN,
    capture: () => captureFor({
      observation: withObservation((document) => {
        document.cases.push({
          boundary_position: "at", case_id: "zz-unknown-limit", limit_key: "undeclared",
          observed_disposition: "accepted", subject_id: "subject-bytes-at"
        });
      })
    })
  }),
  // --- Document-level defects that are not slot resolution ----------------
  Object.freeze({
    name: "an observation record whose case is not closed",
    code: CODES.OBSERVATION_RECORD_MALFORMED,
    capture: () => captureFor({
      observation: withObservation((document) => {
        caseOf(document, "bytes-at").note = "extra";
      })
    })
  }),
  Object.freeze({
    name: "a captured subject that is not closed",
    code: CODES.SUBJECT_POPULATION_MALFORMED,
    capture: () => captureFor({
      subjects: withSubjects((document) => {
        subjectOf(document, "subject-bytes-at").content_encoding = "utf8";
      })
    })
  }),
  // --- Capture envelope ---------------------------------------------------
  Object.freeze({
    name: "no capture at all",
    code: CODES.MISSING_REQUIRED_INPUT,
    capture: () => null
  }),
  Object.freeze({
    name: "a capture that is not the bounded capture object",
    code: CODES.MALFORMED_CAPTURE,
    capture: () => "capture"
  }),
  Object.freeze({
    name: "a capture carrying a field outside its accepted set",
    code: CODES.MALFORMED_CAPTURE,
    capture: () => captureFor({ overrides: { extra: true } })
  }),
  Object.freeze({
    name: "a capture under an unsupported input schema version",
    code: CODES.CAPTURE_SCHEMA_VERSION_UNSUPPORTED,
    capture: () => captureFor({
      overrides: { schema_version: "controlled-contract-declared-boundary-capture-input.v2" }
    })
  }),
  Object.freeze({
    name: "a report descriptor that is not an artifact_file descriptor",
    code: CODES.MALFORMED_CAPTURE,
    capture: () => captureFor({ overrides: { report: { source: { kind: "inline" } } } })
  }),
  Object.freeze({
    name: "a policy slot with no source descriptor",
    code: CODES.POLICY_BYTES_UNRESOLVED,
    capture: () => captureFor({
      overrides: { policy: { bytes: base.policyBytes, source: { kind: "artifact_file" } } }
    })
  })
]);

test("each refusal condition is independently discriminating", async () => {
  const seen = new Map();
  for (const entry of REFUSAL_CASES) {
    const refusal = await refusalFor(entry.capture());
    assert.equal(refusal.code, entry.code, entry.name);
    assert.equal(typeof refusal.reason, "string", entry.name);
    assert.ok(refusal.reason.length > 0, entry.name);
    seen.set(entry.code, (seen.get(entry.code) ?? 0) + 1);
  }
  // The eleven independent conditions the mapping must discriminate are all
  // reached by this corpus.
  for (const code of [
    CODES.POLICY_NOT_CLOSED,
    CODES.POLICY_AMBIGUOUS,
    CODES.SUBJECT_POPULATION_INCOMPLETE,
    CODES.POLICY_BYTES_UNRESOLVED,
    CODES.SUBJECT_BYTES_UNRESOLVED,
    CODES.OBSERVATION_RECORD_UNRESOLVED,
    CODES.BOUNDARY_ARITHMETIC_MISMATCH,
    CODES.BOUNDARY_DISPOSITION_MISMATCH,
    CODES.SUBJECT_IDENTITY_DUPLICATE,
    CODES.MEASUREMENT_UNIT_UNSUPPORTED
  ]) assert.ok(seen.has(code), code);
});

test("an incompatible profile identity is refused rather than mapped", async () => {
  const other = await loadAdmittedProofPack("proof.policy.declared-limit-propagation");
  const refusal = await refusalFor(captureFor(), { pack: other });
  assert.equal(refusal.code, CODES.PROFILE_IDENTITY_MISMATCH);
  assert.equal(refusal.detail.expected.profile_id, DECLARED_BOUNDARY_PROFILE_ID);
  assert.equal(refusal.detail.expected.profile_version, DECLARED_BOUNDARY_PROFILE_VERSION);
  assert.notEqual(refusal.detail.supplied.profile_id, DECLARED_BOUNDARY_PROFILE_ID);
});

test("a hand-built pack is refused rather than trusted", async () => {
  for (const pretender of [
    {},
    { profile: structuredClone(pack.profile), admission: structuredClone(pack.admission) }
  ]) {
    const refusal = await refusalFor(captureFor(), { pack: pretender });
    assert.equal(refusal.code, CODES.PACK_SNAPSHOT_UNRECOGNIZED);
  }
});

test("no refusal ever emits partial success material", async () => {
  const requests = [
    ...REFUSAL_CASES.map((entry) => ({ capture: entry.capture() })),
    { capture: captureFor(), pack: {} },
    {
      capture: captureFor(),
      pack: await loadAdmittedProofPack("proof.policy.declared-limit-propagation")
    },
    {}
  ];
  for (const request of requests) {
    const result = await mapDeclaredBoundaryCapture(request);
    assert.equal(result.mapped, false);
    for (const field of [
      "source", "references", "evaluation_input", "exact_binding_sources", "report", "census"
    ]) assert.equal(result[field], null, field);
    assert.notEqual(result.refusal, null);
    assert.equal(Object.isFrozen(result), true);
    assert.throws(() => canonicalDeclaredBoundaryEvaluationInputJson(result), TypeError);
    assert.throws(() => canonicalDeclaredBoundaryReportJson(result), TypeError);
  }
  assert.equal(requests.length, REFUSAL_CASES.length + 3);
});

test("the supplied capture is never mutated", async () => {
  const capture = captureFor();
  const before = canonicalJsonBytes({
    policy: capture.policy.bytes.toString("base64"),
    observation: capture.observation.bytes.toString("base64"),
    subjects: capture.subjects.bytes.toString("base64"),
    sources: [capture.policy.source, capture.observation.source, capture.subjects.source,
      capture.report.source]
  });
  await mapOrThrow(capture);
  const after = canonicalJsonBytes({
    policy: capture.policy.bytes.toString("base64"),
    observation: capture.observation.bytes.toString("base64"),
    subjects: capture.subjects.bytes.toString("base64"),
    sources: [capture.policy.source, capture.observation.source, capture.subjects.source,
      capture.report.source]
  });
  assert.ok(before.equals(after));
});

// ---------------------------------------------------------------------------
// The public package surface
// ---------------------------------------------------------------------------

test("the public current surface exposes the declared-boundary capture mapping", async () => {
  const current = await import("../current.mjs");
  assert.equal(typeof current.mapDeclaredBoundaryCapture, "function");
  assert.equal(typeof current.canonicalDeclaredBoundaryEvaluationInputJson, "function");
  assert.equal(typeof current.canonicalDeclaredBoundaryReportJson, "function");
  assert.equal(current.DECLARED_BOUNDARY_PROFILE_ID, DECLARED_BOUNDARY_PROFILE_ID);
  assert.equal(current.DECLARED_BOUNDARY_PROFILE_VERSION, DECLARED_BOUNDARY_PROFILE_VERSION);
  assert.equal(current.DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION,
    DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION);
  assert.equal(current.DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION,
    DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION);
  assert.equal(current.DECLARED_BOUNDARY_OBSERVATION_PROVENANCE, "caller_asserted");
  assert.deepEqual(current.DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES,
    DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES);
  assert.equal(Object.isFrozen(current.DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES), true);
  assert.equal(Object.isFrozen(current.DECLARED_BOUNDARY_NOT_ESTABLISHED), true);

  // The public entrypoint maps the same capture to the same bytes as the module.
  const viaRoot = await current.mapDeclaredBoundaryCapture({ capture: captureFor() });
  assert.equal(viaRoot.mapped, true);
  assert.ok(current.canonicalDeclaredBoundaryEvaluationInputJson(viaRoot)
    .equals(canonicalDeclaredBoundaryEvaluationInputJson(await mapOrThrow(captureFor()))));
});

test("the public current declaration exposes the capture types and values", async () => {
  const declaration = await readFile(path.join(packageRoot, "current.d.mts"), "utf8");
  for (const name of [
    "DECLARED_BOUNDARY_CAPTURE_INPUT_SCHEMA_VERSION",
    "DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES",
    "DECLARED_BOUNDARY_CAPTURE_SCHEMA_VERSION",
    "DECLARED_BOUNDARY_NOT_ESTABLISHED",
    "DECLARED_BOUNDARY_OBSERVATION_PROVENANCE",
    "DECLARED_BOUNDARY_PROFILE_ID",
    "DECLARED_BOUNDARY_PROFILE_VERSION",
    "DeclaredBoundaryCaptureInput",
    "DeclaredBoundaryCaptureMapped",
    "DeclaredBoundaryCaptureRefusal",
    "DeclaredBoundaryCaptureRefusalCode",
    "DeclaredBoundaryCaptureRefused",
    "DeclaredBoundaryCaptureResult",
    "DeclaredBoundaryCensus",
    "DeclaredBoundaryCaptureSource",
    "canonicalDeclaredBoundaryEvaluationInputJson",
    "canonicalDeclaredBoundaryReportJson",
    "mapDeclaredBoundaryCapture"
  ]) assert.match(declaration, new RegExp(`\\b${name}\\b`, "u"), name);

  // Every stable refusal code is declared, so a caller can branch exhaustively.
  for (const code of Object.values(DECLARED_BOUNDARY_CAPTURE_REFUSAL_CODES)) {
    assert.ok(declaration.includes(`"${code}"`), code);
  }
});
