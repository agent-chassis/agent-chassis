import Ajv2020 from "ajv/dist/2020.js";

import ARTIFACT_SET_PROVENANCE_SCHEMA from
  "../schema/controlled-contract-artifact-set-provenance.v1.schema.json" with { type: "json" };
import AUTHENTICATION_PROVENANCE_CAPTURE_SCHEMA from
  "../schema/controlled-contract-authentication-provenance-capture.v1.schema.json" with { type: "json" };
import { TYPE_TERMS } from "../vocabulary/controlled-contract-vocabulary.v1.mjs";
import {
  deriveAuthenticationProvenanceOccurrenceCapture
} from "./authentication-provenance-occurrence-projection.mjs";
import { projectBoundedDiagnostics } from "./bounded-diagnostic-projection.mjs";
import { scalarCompare } from "./deterministic-lexicographic-ordering.mjs";
import { deepFreeze, parseCanonicalDocument } from "./deterministic-projection-primitives.mjs";
import {
  buildCompletePopulation,
  compareCompletePopulations
} from "./population-semantics-v1.mjs";
import { domainSeparatedDigest } from "./proof-aware-digest.mjs";

const ARTIFACT_SET_PROVENANCE_SCHEMA_VERSION =
  "controlled-contract-artifact-set-provenance.v1";

const ARTIFACT_SET_IDENTITY_DOMAIN = "controlled-contract-artifact-set-provenance.v1";
const AUTHENTICATION_PROVENANCE_CAPTURE_VERSION =
  "controlled-contract.authentication-provenance-occurrence-capture.v1";
const COMPLETE_POPULATION_VERSION = "controlled-contract.complete-population.v1";
const PACKAGE_POPULATION_ID = "ref-artifact-set-package-population";
const PACKED_ARTIFACT_POPULATION_ID = "ref-artifact-set-packed-artifact-population";

const SHA256 = /^[0-9a-f]{64}$/u;

const CAPTURE_WITNESS_FIELDS = Object.freeze([
  "attemptBindingWitnessBytes",
  "authenticationWitnessBytes",
  "evidenceContentBytes",
  "sourceAuthenticationWitnessBytes",
  "sourceOfRecordAssignmentWitnessBytes",
  "targetResolutionWitnessBytes"
]);
const BUILD_INPUT_FIELDS = Object.freeze([
  "artifact_population",
  "authentication_provenance_witnesses",
  "binding_set_sha256",
  "package_population"
]);
const INPUT_POPULATION_FIELDS = Object.freeze([
  "complete_capture_source_set_sha256",
  "members"
]);
const PACKAGE_MEMBER_FIELDS = Object.freeze([
  "declared_content_sha256",
  "declared_version",
  "member_id",
  "type_term"
]);
const ARTIFACT_MEMBER_FIELDS = Object.freeze([
  "declared_content_sha256",
  "declared_version",
  "member_id",
  "package_member_id",
  "type_term"
]);
const VERIFY_EXPECTATION_FIELDS = Object.freeze([
  "artifact_set_sha256",
  "binding_set_sha256",
  "complete_capture_source_set_sha256"
]);

const ARTIFACT_SET_PROVENANCE_REFUSAL_CODES = Object.freeze([
  "artifact_set_input_unknown_field",
  "artifact_set_capture_ingress_required",
  "artifact_set_input_invalid",
  "artifact_set_capture_admission_failed",
  "artifact_set_binding_digest_malformed",
  "artifact_set_capture_population_mismatch",
  "artifact_set_member_invalid",
  "artifact_set_member_duplicate",
  "artifact_set_population_noncanonical",
  "artifact_set_member_missing",
  "artifact_set_member_unexpected",
  "artifact_set_content_version_disagreement",
  "artifact_set_carrier_schema_invalid",
  "artifact_set_identity_mismatch"
]);

const TYPE_TERM_SET = new Set(TYPE_TERMS.map(({ term }) => term));

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(AUTHENTICATION_PROVENANCE_CAPTURE_SCHEMA);
ajv.addSchema(ARTIFACT_SET_PROVENANCE_SCHEMA);
const validateCarrierSchema = ajv.getSchema(
  "controlled-contract-artifact-set-provenance.v1.schema.json"
);
const validateCaptureSchema = ajv.getSchema(
  "controlled-contract-authentication-provenance-capture.v1.schema.json"
);

class ArtifactSetProvenanceError extends Error {
  constructor(code, message, diagnostics) {
    super(message);
    this.name = "ArtifactSetProvenanceError";
    this.code = code;

    this.diagnostics = projectBoundedDiagnostics(diagnostics);
  }
}

function refuse(diagnostics, message) {
  if (diagnostics.length === 0) return;
  const present = new Set(diagnostics.map(({ code }) => code));
  const code = ARTIFACT_SET_PROVENANCE_REFUSAL_CODES.find((entry) => present.has(entry)) ??
    "artifact_set_input_invalid";
  throw new ArtifactSetProvenanceError(code, message, diagnostics);
}

function diagnostic(code, pointer, message, extra = {}) {
  return { code, pointer, reason_code: code, message, ...extra };
}

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function unknownKeys(value, allowed) {
  const permitted = new Set(allowed);
  return Object.keys(value).filter((key) => !permitted.has(key)).sort(scalarCompare);
}

function exactText(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0") &&
    value.isWellFormed() && value === value.normalize("NFC");
}

function collectMemberDiagnostics(members, { pointer, fields, kind }) {
  const diagnostics = [];
  if (!Array.isArray(members)) {
    diagnostics.push(diagnostic("artifact_set_input_invalid", pointer,
      `${kind} population members must be an array`));
    return diagnostics;
  }
  for (const [index, member] of members.entries()) {
    const at = `${pointer}/${index}`;
    if (!isPlainObject(member)) {
      diagnostics.push(diagnostic("artifact_set_member_invalid", at,
        `${kind} population members must be objects`));
      continue;
    }
    for (const key of unknownKeys(member, fields)) diagnostics.push(diagnostic(
      "artifact_set_input_unknown_field", `${at}/${key}`,
      `${kind} population members carry no field named ${key}`
    ));
    for (const field of fields) {
      if (!Object.hasOwn(member, field)) diagnostics.push(diagnostic(
        "artifact_set_member_invalid", `${at}/${field}`,
        `${kind} population members require ${field}`
      ));
    }
    for (const field of ["member_id", "package_member_id", "declared_version"]) {
      if (fields.includes(field) && Object.hasOwn(member, field) &&
          !exactText(member[field])) diagnostics.push(diagnostic(
        "artifact_set_member_invalid", `${at}/${field}`,
        `${field} must be nonempty well-formed canonical NFC text without NUL`
      ));
    }
    if (Object.hasOwn(member, "type_term") && !TYPE_TERM_SET.has(member.type_term)) {
      diagnostics.push(diagnostic("artifact_set_member_invalid", `${at}/type_term`,
        "type_term must be a controlled-vocabulary type term",
        { actual_identity: String(member.type_term) }));
    }
    if (Object.hasOwn(member, "declared_content_sha256") &&
        !SHA256.test(member.declared_content_sha256 ?? "")) diagnostics.push(diagnostic(
      "artifact_set_member_invalid", `${at}/declared_content_sha256`,
      "declared_content_sha256 must be a lowercase sha256 hex digest"
    ));
  }
  return diagnostics;
}

const orderMembers = (members) => [...members].sort(
  (left, right) => scalarCompare(left.member_id, right.member_id)
);

const memberIdsCanonical = (members) => members.every((member, index) =>
  index === 0 || scalarCompare(members[index - 1].member_id, member.member_id) < 0
);

function completePopulation(populationId, members, captureDigest, pointer, diagnostics) {
  try {
    const population = buildCompletePopulation({
      population_id: populationId,
      completeness: "exact",
      authenticated: true,
      members,
      ordered: true,
      identity: ({ member_id: memberId }) => memberId
    });
    return {
      population_version: population.population_version,
      population_id: population.population_id,
      completeness: population.completeness,
      authenticated: population.authenticated,
      ordered: population.ordered,
      cardinality: population.cardinality,
      complete_capture_source_set_sha256: captureDigest,
      members: population.members
    };
  } catch (error) {
    diagnostics.push(diagnostic("artifact_set_member_duplicate", pointer,
      "the complete population owner refused this member sequence",
      {
        reason: error.code ?? "stable_population_invalid",
        actual_identity: error.details?.identity ?? null
      }));
    return null;
  }
}

const populationOnlyView = (population) => ({
  population_version: population.population_version,
  population_id: population.population_id,
  completeness: population.completeness,
  authenticated: population.authenticated,
  ordered: population.ordered,
  cardinality: population.cardinality,
  members: population.members
});

function crossPopulationDiagnostics(packagePopulation, artifactPopulation) {
  const diagnostics = [];
  const coverage = artifactPopulation.members.map((member) => ({
    member_id: member.package_member_id
  }));
  let coveragePopulation;
  try {
    coveragePopulation = buildCompletePopulation({
      population_id: PACKAGE_POPULATION_ID,
      completeness: "exact",
      authenticated: true,
      members: orderMembers(coverage),
      ordered: true,
      identity: ({ member_id: memberId }) => memberId
    });
  } catch (error) {
    for (const member of artifactPopulation.members) diagnostics.push(diagnostic(
      "artifact_set_member_unexpected",
      `/artifact_population/members/${member.member_id}/package_member_id`,
      "two packed artifacts claim the same package member",
      { reason: error.code ?? "stable_population_member_duplicate" }
    ));
    return diagnostics;
  }

  const comparison = compareCompletePopulations(
    populationOnlyView(packagePopulation), coveragePopulation,
    ({ member_id: memberId }) => memberId
  );
  if (!comparison.exact) {
    const declaredIds = packagePopulation.members.map(({ member_id: id }) => id);
    const coveredIds = coveragePopulation.members.map(({ member_id: id }) => id);
    const covered = new Set(coveredIds);
    const declared = new Set(declaredIds);
    for (const id of declaredIds.filter((entry) => !covered.has(entry))
      .sort(scalarCompare)) diagnostics.push(diagnostic(
      "artifact_set_member_missing", "/artifact_population/members",
      "a declared package member has no packed artifact",
      { expected_identity: id }
    ));
    for (const id of coveredIds.filter((entry) => !declared.has(entry))
      .sort(scalarCompare)) diagnostics.push(diagnostic(
      "artifact_set_member_unexpected", "/artifact_population/members",
      "a packed artifact claims a package member outside the complete package population",
      { actual_identity: id }
    ));
  }
  const packageByMemberId = new Map(
    packagePopulation.members.map((member) => [member.member_id, member])
  );
  for (const member of artifactPopulation.members) {
    const declaredMember = packageByMemberId.get(member.package_member_id);
    if (!declaredMember) continue;
    if (declaredMember.declared_version !== member.declared_version) diagnostics.push(
      diagnostic("artifact_set_content_version_disagreement",
        `/artifact_population/members/${member.member_id}/declared_version`,
        "the packed artifact and its package member declare different versions",
        {
          expected_identity: declaredMember.declared_version,
          actual_identity: member.declared_version
        })
    );
    if (declaredMember.declared_content_sha256 !== member.declared_content_sha256) {
      diagnostics.push(diagnostic("artifact_set_content_version_disagreement",
        `/artifact_population/members/${member.member_id}/declared_content_sha256`,
        "the packed artifact and its package member declare different content",
        {
          expected_identity: declaredMember.declared_content_sha256,
          actual_identity: member.declared_content_sha256
        }));
    }
  }
  return diagnostics;
}

function artifactSetIdentity(carrier) {
  return domainSeparatedDigest(ARTIFACT_SET_IDENTITY_DOMAIN, {
    schema_version: carrier.schema_version,
    authentication_provenance_capture: carrier.authentication_provenance_capture,
    complete_capture_source_set_sha256: carrier.complete_capture_source_set_sha256,
    binding_set_sha256: carrier.binding_set_sha256,
    package_population: carrier.package_population,
    artifact_population: carrier.artifact_population
  });
}

function schemaDiagnostics(errors, code, message) {
  return (errors ?? []).map((error) => diagnostic(
    code, error.instancePath || "/", message,
    { keyword: error.keyword, reason: error.message ?? code }
  ));
}

function admitCapture(witnesses) {
  const diagnostics = [];
  if (!isPlainObject(witnesses)) {
    diagnostics.push(diagnostic("artifact_set_input_invalid",
      "/authentication_provenance_witnesses",
      "the six exact authentication-provenance witness byte sources are required"));
    refuse(diagnostics, "artifact-set provenance input is not admissible");
  }
  for (const key of unknownKeys(witnesses, CAPTURE_WITNESS_FIELDS)) diagnostics.push(
    diagnostic("artifact_set_input_unknown_field",
      `/authentication_provenance_witnesses/${key}`,
      `the authentication-provenance witness set carries no field named ${key}`)
  );
  for (const field of CAPTURE_WITNESS_FIELDS) {
    if (!Buffer.isBuffer(witnesses[field])) diagnostics.push(diagnostic(
      "artifact_set_input_invalid", `/authentication_provenance_witnesses/${field}`,
      `${field} must be an exact Buffer source`
    ));
  }
  refuse(diagnostics, "artifact-set provenance input is not admissible");

  let captureBytes;
  try {
    captureBytes = deriveAuthenticationProvenanceOccurrenceCapture({
      evidenceContentBytes: witnesses.evidenceContentBytes,
      targetResolutionWitnessBytes: witnesses.targetResolutionWitnessBytes,
      sourceAuthenticationWitnessBytes: witnesses.sourceAuthenticationWitnessBytes,
      sourceOfRecordAssignmentWitnessBytes: witnesses.sourceOfRecordAssignmentWitnessBytes,
      attemptBindingWitnessBytes: witnesses.attemptBindingWitnessBytes,
      authenticationWitnessBytes: witnesses.authenticationWitnessBytes
    });
  } catch (error) {
    refuse([diagnostic("artifact_set_capture_admission_failed",
      "/authentication_provenance_witnesses",
      "the authentication-provenance owner refused this witness set",
      { reason: error.code ?? "occurrence_capture_result_invalid" })],
    "authentication provenance was not admitted");
  }
  return parseCanonicalDocument(captureBytes, "authentication provenance capture");
}

function assertCarrierCapture(capture, diagnostics) {
  if (!validateCaptureSchema(capture)) diagnostics.push(...schemaDiagnostics(
    validateCaptureSchema.errors, "artifact_set_carrier_schema_invalid",
    "the composed capture does not satisfy its owning capture schema"
  ));
  else if (capture.schema_version !== AUTHENTICATION_PROVENANCE_CAPTURE_VERSION) {
    diagnostics.push(diagnostic("artifact_set_carrier_schema_invalid",
      "/authentication_provenance_capture/schema_version",
      "the composed capture is not the package-produced provenance capture"));
  }
}

function buildArtifactSetProvenance(input) {
  const shape = [];
  if (!isPlainObject(input)) {
    shape.push(diagnostic("artifact_set_input_invalid", "/",
      "artifact-set provenance input must be an object"));
    refuse(shape, "artifact-set provenance input is not admissible");
  }
  for (const key of unknownKeys(input, BUILD_INPUT_FIELDS)) shape.push(diagnostic(
    key === "authentication_provenance_capture"
      ? "artifact_set_capture_ingress_required"
      : "artifact_set_input_unknown_field",
    `/${key}`,
    key === "authentication_provenance_capture"
      ? "authentication provenance is admitted only from its six exact witness byte sources"
      : `artifact-set provenance input carries no field named ${key}`
  ));
  for (const field of BUILD_INPUT_FIELDS) {
    if (!Object.hasOwn(input, field)) shape.push(diagnostic(
      "artifact_set_input_invalid", `/${field}`,
      `artifact-set provenance input requires ${field}`
    ));
  }
  refuse(shape, "artifact-set provenance input is not admissible");

  const capture = admitCapture(input.authentication_provenance_witnesses);
  const captureDigest = capture.complete_capture_source_set_sha256;

  const bound = [];
  if (!SHA256.test(input.binding_set_sha256 ?? "")) bound.push(diagnostic(
    "artifact_set_binding_digest_malformed", "/binding_set_sha256",
    "binding_set_sha256 must be the exact-binding owner's lowercase sha256 hex digest"
  ));
  for (const [field, pointer] of [
    ["package_population", "/package_population"],
    ["artifact_population", "/artifact_population"]
  ]) {
    const population = input[field];
    if (!isPlainObject(population)) {
      bound.push(diagnostic("artifact_set_input_invalid", pointer,
        `${field} must be an object`));
      continue;
    }
    for (const key of unknownKeys(population, INPUT_POPULATION_FIELDS)) bound.push(
      diagnostic("artifact_set_input_unknown_field", `${pointer}/${key}`,
        `${field} carries no field named ${key}`)
    );
    if (!SHA256.test(population.complete_capture_source_set_sha256 ?? "")) bound.push(
      diagnostic("artifact_set_input_invalid",
        `${pointer}/complete_capture_source_set_sha256`,
        "each population declares the capture source set it is bound to")
    );
    else if (population.complete_capture_source_set_sha256 !== captureDigest) bound.push(
      diagnostic("artifact_set_capture_population_mismatch",
        `${pointer}/complete_capture_source_set_sha256`,
        "the population is bound to a different capture than the admitted provenance",
        {
          expected_identity: captureDigest,
          actual_identity: population.complete_capture_source_set_sha256
        })
    );
  }
  refuse(bound, "artifact-set provenance input is not admissible");

  const members = [
    ...collectMemberDiagnostics(input.package_population.members, {
      pointer: "/package_population/members",
      fields: PACKAGE_MEMBER_FIELDS,
      kind: "package"
    }),
    ...collectMemberDiagnostics(input.artifact_population.members, {
      pointer: "/artifact_population/members",
      fields: ARTIFACT_MEMBER_FIELDS,
      kind: "packed-artifact"
    })
  ];
  refuse(members, "artifact-set provenance members are not admissible");

  const populations = [];
  const packagePopulation = completePopulation(
    PACKAGE_POPULATION_ID, orderMembers(input.package_population.members),
    captureDigest, "/package_population/members", populations
  );
  const artifactPopulation = completePopulation(
    PACKED_ARTIFACT_POPULATION_ID, orderMembers(input.artifact_population.members),
    captureDigest, "/artifact_population/members", populations
  );
  refuse(populations, "artifact-set provenance populations are not complete");

  refuse(
    crossPopulationDiagnostics(packagePopulation, artifactPopulation),
    "artifact-set provenance populations do not agree"
  );

  const composed = {
    schema_version: ARTIFACT_SET_PROVENANCE_SCHEMA_VERSION,
    authentication_provenance_capture: capture,
    complete_capture_source_set_sha256: captureDigest,
    binding_set_sha256: input.binding_set_sha256,
    package_population: packagePopulation,
    artifact_population: artifactPopulation
  };
  return validateArtifactSetProvenance({
    ...composed,
    artifact_set_sha256: artifactSetIdentity(composed)
  }).carrier;
}

function validateArtifactSetProvenance(carrier) {
  const structural = [];
  if (!isPlainObject(carrier)) {
    structural.push(diagnostic("artifact_set_carrier_schema_invalid", "/",
      "an artifact-set provenance carrier must be an object"));
    refuse(structural, "artifact-set provenance carrier is invalid");
  }
  if (!validateCarrierSchema(carrier)) structural.push(...schemaDiagnostics(
    validateCarrierSchema.errors, "artifact_set_carrier_schema_invalid",
    "the carrier does not satisfy controlled-contract-artifact-set-provenance.v1"
  ));
  refuse(structural, "artifact-set provenance carrier is invalid");

  const semantic = [];
  assertCarrierCapture(carrier.authentication_provenance_capture, semantic);
  refuse(semantic, "artifact-set provenance carrier is invalid");

  const captureDigest = carrier.authentication_provenance_capture
    .complete_capture_source_set_sha256;
  if (carrier.complete_capture_source_set_sha256 !== captureDigest) semantic.push(
    diagnostic("artifact_set_capture_population_mismatch",
      "/complete_capture_source_set_sha256",
      "the carrier digest is not the admitted capture's complete source set",
      {
        expected_identity: captureDigest,
        actual_identity: carrier.complete_capture_source_set_sha256
      })
  );
  for (const field of ["package_population", "artifact_population"]) {
    if (carrier[field].complete_capture_source_set_sha256 !== captureDigest) semantic.push(
      diagnostic("artifact_set_capture_population_mismatch",
        `/${field}/complete_capture_source_set_sha256`,
        "the population is bound to a different capture than the composed provenance",
        {
          expected_identity: captureDigest,
          actual_identity: carrier[field].complete_capture_source_set_sha256
        })
    );
  }
  for (const [field, expectedId] of [
    ["package_population", PACKAGE_POPULATION_ID],
    ["artifact_population", PACKED_ARTIFACT_POPULATION_ID]
  ]) {
    const population = carrier[field];
    if (population.population_version !== COMPLETE_POPULATION_VERSION ||
        population.population_id !== expectedId) semantic.push(diagnostic(
      "artifact_set_carrier_schema_invalid", `/${field}/population_id`,
      "each population must be the package-owned complete population it declares"
    ));
    if (population.cardinality !== population.members.length) semantic.push(diagnostic(
      "artifact_set_population_noncanonical", `/${field}/cardinality`,
      "the declared cardinality is not the complete member count",
      {
        expected_identity: String(population.members.length),
        actual_identity: String(population.cardinality)
      }
    ));
    if (!memberIdsCanonical(population.members)) semantic.push(diagnostic(
      "artifact_set_population_noncanonical", `/${field}/members`,
      "members must be scalarCompare-ordered and free of repeated identities"
    ));
  }
  semantic.push(...collectMemberDiagnostics(carrier.package_population.members, {
    pointer: "/package_population/members",
    fields: PACKAGE_MEMBER_FIELDS,
    kind: "package"
  }));
  semantic.push(...collectMemberDiagnostics(carrier.artifact_population.members, {
    pointer: "/artifact_population/members",
    fields: ARTIFACT_MEMBER_FIELDS,
    kind: "packed-artifact"
  }));
  refuse(semantic, "artifact-set provenance carrier is invalid");

  const populations = [];
  const packagePopulation = completePopulation(
    PACKAGE_POPULATION_ID, carrier.package_population.members, captureDigest,
    "/package_population/members", populations
  );
  const artifactPopulation = completePopulation(
    PACKED_ARTIFACT_POPULATION_ID, carrier.artifact_population.members, captureDigest,
    "/artifact_population/members", populations
  );
  refuse(populations, "artifact-set provenance populations are not complete");

  refuse(
    crossPopulationDiagnostics(packagePopulation, artifactPopulation),
    "artifact-set provenance populations do not agree"
  );

  const identity = artifactSetIdentity(carrier);
  if (identity !== carrier.artifact_set_sha256) refuse([diagnostic(
    "artifact_set_identity_mismatch", "/artifact_set_sha256",
    "the carried artifact-set identity is not the domain-separated digest of its preimage",
    { expected_identity: identity, actual_identity: carrier.artifact_set_sha256 }
  )], "artifact-set provenance identity does not match its carrier");

  return deepFreeze({
    carrier: structuredClone(carrier),
    artifact_set_sha256: identity
  });
}

function verifyArtifactSetProvenance(carrier, expected = {}) {
  const shape = [];
  if (!isPlainObject(expected)) {
    shape.push(diagnostic("artifact_set_input_invalid", "/expected",
      "verification expectations must be an object"));
    refuse(shape, "artifact-set provenance verification input is not admissible");
  }
  for (const key of unknownKeys(expected, VERIFY_EXPECTATION_FIELDS)) shape.push(
    diagnostic("artifact_set_input_unknown_field", `/expected/${key}`,
      `verification expectations carry no field named ${key}`)
  );
  for (const field of VERIFY_EXPECTATION_FIELDS) {
    if (Object.hasOwn(expected, field) && !SHA256.test(expected[field] ?? "")) shape.push(
      diagnostic("artifact_set_input_invalid", `/expected/${field}`,
        `${field} must be a lowercase sha256 hex digest`)
    );
  }
  refuse(shape, "artifact-set provenance verification input is not admissible");

  const validated = validateArtifactSetProvenance(carrier);
  const mismatches = [];
  for (const field of VERIFY_EXPECTATION_FIELDS) {
    if (!Object.hasOwn(expected, field)) continue;
    const actual = field === "artifact_set_sha256"
      ? validated.artifact_set_sha256
      : validated.carrier[field];
    if (expected[field] !== actual) mismatches.push(diagnostic(
      "artifact_set_identity_mismatch", `/${field}`,
      "the carrier does not carry the expected identity",
      { expected_identity: expected[field], actual_identity: actual }
    ));
  }
  refuse(mismatches, "artifact-set provenance does not match the expected identity");

  return deepFreeze({
    verified: true,
    schema_version: validated.carrier.schema_version,
    artifact_set_sha256: validated.artifact_set_sha256,
    complete_capture_source_set_sha256: validated.carrier.complete_capture_source_set_sha256,
    binding_set_sha256: validated.carrier.binding_set_sha256,
    package_cardinality: validated.carrier.package_population.cardinality,
    artifact_cardinality: validated.carrier.artifact_population.cardinality
  });
}

export {
  ARTIFACT_SET_IDENTITY_DOMAIN,
  ARTIFACT_SET_PROVENANCE_REFUSAL_CODES,
  ARTIFACT_SET_PROVENANCE_SCHEMA,
  ARTIFACT_SET_PROVENANCE_SCHEMA_VERSION,
  ArtifactSetProvenanceError,
  PACKAGE_POPULATION_ID,
  PACKED_ARTIFACT_POPULATION_ID,
  buildArtifactSetProvenance,
  validateArtifactSetProvenance,
  verifyArtifactSetProvenance
};
