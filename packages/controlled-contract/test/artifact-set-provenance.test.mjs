import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
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
} from "../lib/artifact-set-provenance.mjs";
import * as publicSurface from "../current.mjs";
import {
  assertAuthenticationProvenanceOccurrenceCapture
} from "../lib/authentication-provenance-occurrence-projection.mjs";
import { canonicalJsonBytes } from "../lib/exact-binding-common.mjs";
import { domainSeparatedDigest } from "../lib/proof-aware-digest.mjs";
import { buildAuthenticationProvenanceSources } from
  "./proof-packs/authentication-provenance-v1-fixture.mjs";

const digest = (value) => String(value).padStart(64, "0");
const BINDING_SET_SHA256 = digest("b1");

const captureOf = (fixture) => JSON.parse(fixture.resultBytes);

function scenario({ suffix = "one", packageMembers, artifactMembers } = {}) {
  const fixture = buildAuthenticationProvenanceSources({ occurrenceSuffix: suffix });
  const capture = captureOf(fixture);
  return {
    fixture,
    capture,
    input: {
      authentication_provenance_witnesses: fixture.input,
      binding_set_sha256: BINDING_SET_SHA256,
      package_population: {
        complete_capture_source_set_sha256: capture.complete_capture_source_set_sha256,
        members: packageMembers ?? [
          {
            member_id: "pkg-alpha",
            type_term: "cc:artifact",
            declared_version: "0.1.0",
            declared_content_sha256: digest("a1")
          },
          {
            member_id: "pkg-beta",
            type_term: "cc:artifact",
            declared_version: "2.4.0",
            declared_content_sha256: digest("b2")
          }
        ]
      },
      artifact_population: {
        complete_capture_source_set_sha256: capture.complete_capture_source_set_sha256,
        members: artifactMembers ?? [
          {
            member_id: "packed-alpha",
            type_term: "cc:artifact",
            package_member_id: "pkg-alpha",
            declared_version: "0.1.0",
            declared_content_sha256: digest("a1")
          },
          {
            member_id: "packed-beta",
            type_term: "cc:artifact",
            package_member_id: "pkg-beta",
            declared_version: "2.4.0",
            declared_content_sha256: digest("b2")
          }
        ]
      }
    }
  };
}

function refusal(operation) {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof ArtifactSetProvenanceError,
      `expected a provider refusal, received ${error?.name}: ${error?.message}`);
    assert.ok(ARTIFACT_SET_PROVENANCE_REFUSAL_CODES.includes(error.code),
      `refusal code ${error.code} is not a provider-local stable code`);
    assert.equal(error.diagnostics.diagnostic_projection_version,
      "controlled-contract.bounded-diagnostic-projection.v1");
    return error;
  }
  assert.fail("the provider accepted an input it must refuse");
}

const identityPreimage = (carrier) => ({
  schema_version: carrier.schema_version,
  authentication_provenance_capture: carrier.authentication_provenance_capture,
  complete_capture_source_set_sha256: carrier.complete_capture_source_set_sha256,
  binding_set_sha256: carrier.binding_set_sha256,
  package_population: carrier.package_population,
  artifact_population: carrier.artifact_population
});

const identityOf = (carrier) =>
  domainSeparatedDigest(ARTIFACT_SET_IDENTITY_DOMAIN, identityPreimage(carrier));

const CAPTURE_MUTATIONS = Object.freeze([
  ["capture-authority grounded identity", (capture) => {
    capture.capture_authority_grounded_identity.value = digest("aa");
  }],
  ["capture-authority grounded identity digest", (capture) => {
    capture.capture_authority_grounded_identity_sha256 = digest("ab");
  }],
  ["target role grounded identity", (capture) => {
    capture.roles.target.grounded_identity_sha256 = digest("ac");
  }],
  ["source role type term", (capture) => {
    capture.roles.source.type_term = "cc:actor";
  }],
  ["observation-attempt raw reference id", (capture) => {
    capture.roles.observation_attempt.raw_reference_id = "ref-observation-attempt-two";
  }],
  ["normalized applicability operand identity", (capture) => {
    capture.exact_normalized_applicability.operand_grounded_identity_sha256[0] =
      digest("ad");
  }],
  ["normalized applicability raw operand reference id", (capture) => {
    capture.exact_normalized_applicability.raw_operand_reference_ids[0] =
      "ref-observation-attempt-two";
  }],
  ["evidence content digest", (capture) => {
    capture.evidence_content_sha256 = digest("ae");
  }],
  ["authentication witness digest", (capture) => {
    capture.authentication_witness_sha256 = digest("af");
  }],
  ["target-resolution witness digest", (capture) => {
    capture.target_resolution_witness_sha256 = digest("ba");
  }],
  ["attempt-binding proof digest", (capture) => {
    capture.attempt_binding_proof_sha256 = digest("bb");
  }],
  ["source-authentication proof digest", (capture) => {
    capture.source_authentication_proof_sha256 = digest("bc");
  }]
]);

test("build, validate, and verify compose one deterministic canonical carrier", () => {
  const { input, capture } = scenario();
  const carrier = buildArtifactSetProvenance(input);

  assert.equal(carrier.schema_version, ARTIFACT_SET_PROVENANCE_SCHEMA_VERSION);
  assert.equal(carrier.complete_capture_source_set_sha256,
    capture.complete_capture_source_set_sha256);
  assert.equal(carrier.binding_set_sha256, BINDING_SET_SHA256);
  assert.deepEqual(carrier.authentication_provenance_capture, capture);
  assert.equal(carrier.package_population.population_id, PACKAGE_POPULATION_ID);
  assert.equal(carrier.artifact_population.population_id, PACKED_ARTIFACT_POPULATION_ID);
  assert.equal(carrier.package_population.cardinality, 2);
  assert.equal(carrier.artifact_population.cardinality, 2);
  for (const population of [carrier.package_population, carrier.artifact_population]) {
    assert.equal(population.population_version, "controlled-contract.complete-population.v1");
    assert.equal(population.completeness, "exact");
    assert.equal(population.authenticated, true);
    assert.equal(population.ordered, true);
    assert.equal(population.complete_capture_source_set_sha256,
      capture.complete_capture_source_set_sha256);
  }

  assert.equal(carrier.artifact_set_sha256, domainSeparatedDigest(
    "controlled-contract-artifact-set-provenance.v1",
    {
      schema_version: carrier.schema_version,
      authentication_provenance_capture: carrier.authentication_provenance_capture,
      complete_capture_source_set_sha256: carrier.complete_capture_source_set_sha256,
      binding_set_sha256: carrier.binding_set_sha256,
      package_population: carrier.package_population,
      artifact_population: carrier.artifact_population
    }
  ));
  assert.equal(ARTIFACT_SET_IDENTITY_DOMAIN,
    "controlled-contract-artifact-set-provenance.v1");

  const validated = validateArtifactSetProvenance(carrier);
  assert.equal(validated.artifact_set_sha256, carrier.artifact_set_sha256);
  assert.deepEqual(validated.carrier, carrier);

  const verified = verifyArtifactSetProvenance(carrier, {
    artifact_set_sha256: carrier.artifact_set_sha256,
    binding_set_sha256: BINDING_SET_SHA256,
    complete_capture_source_set_sha256: capture.complete_capture_source_set_sha256
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.package_cardinality, 2);
  assert.equal(verified.artifact_cardinality, 2);
  assert.deepEqual(verifyArtifactSetProvenance(carrier).artifact_set_sha256,
    carrier.artifact_set_sha256);

  const repeated = buildArtifactSetProvenance(scenario().input);
  assert.deepEqual(canonicalJsonBytes(repeated), canonicalJsonBytes(carrier));
});

test("equivalent inputs yield exactly one canonical identity", () => {
  const base = scenario();
  const permuted = scenario();
  permuted.input.package_population.members.reverse();
  permuted.input.artifact_population.members.reverse();
  permuted.input.artifact_population.members = permuted.input.artifact_population.members
    .map((member) => ({
      declared_content_sha256: member.declared_content_sha256,
      package_member_id: member.package_member_id,
      type_term: member.type_term,
      member_id: member.member_id,
      declared_version: member.declared_version
    }));

  const left = buildArtifactSetProvenance(base.input);
  const right = buildArtifactSetProvenance(permuted.input);
  assert.equal(left.artifact_set_sha256, right.artifact_set_sha256);
  assert.deepEqual(canonicalJsonBytes(left), canonicalJsonBytes(right));
  assert.deepEqual(
    right.package_population.members.map(({ member_id: id }) => id),
    ["pkg-alpha", "pkg-beta"]
  );
});

test("identity changes with the capture source set, either population, or the binding set", () => {
  const baseline = buildArtifactSetProvenance(scenario().input);

  const otherCapture = scenario({ suffix: "two" });
  assert.notEqual(otherCapture.capture.complete_capture_source_set_sha256,
    baseline.complete_capture_source_set_sha256);
  const rebound = buildArtifactSetProvenance(otherCapture.input);
  assert.notEqual(rebound.artifact_set_sha256, baseline.artifact_set_sha256);

  const changedPackage = scenario();
  changedPackage.input.package_population.members[0].declared_version = "0.1.1";
  changedPackage.input.artifact_population.members[0].declared_version = "0.1.1";
  assert.notEqual(
    buildArtifactSetProvenance(changedPackage.input).artifact_set_sha256,
    baseline.artifact_set_sha256
  );

  const changedArtifact = scenario();
  changedArtifact.input.artifact_population.members[0].member_id = "packed-alpha-2";
  assert.notEqual(
    buildArtifactSetProvenance(changedArtifact.input).artifact_set_sha256,
    baseline.artifact_set_sha256
  );

  const changedBinding = scenario();
  changedBinding.input.binding_set_sha256 = digest("b9");
  assert.notEqual(
    buildArtifactSetProvenance(changedBinding.input).artifact_set_sha256,
    baseline.artifact_set_sha256
  );
});

test("the exact-binding digest is an input field, never the identity producer", () => {
  const { input } = scenario();
  const carrier = buildArtifactSetProvenance(input);
  assert.notEqual(carrier.artifact_set_sha256, carrier.binding_set_sha256);

  assert.notEqual(carrier.artifact_set_sha256, domainSeparatedDigest(
    ARTIFACT_SET_IDENTITY_DOMAIN,
    {
      schema_version: carrier.schema_version,
      authentication_provenance_capture: carrier.authentication_provenance_capture,
      complete_capture_source_set_sha256: carrier.complete_capture_source_set_sha256,
      package_population: carrier.package_population,
      artifact_population: carrier.artifact_population
    }
  ));
});

test("the identity preimage is exactly the six carried fields", () => {
  const carrier = buildArtifactSetProvenance(scenario().input);
  const preimage = identityPreimage(carrier);

  assert.deepEqual([...Object.keys(preimage)].sort(), [
    "artifact_population",
    "authentication_provenance_capture",
    "binding_set_sha256",
    "complete_capture_source_set_sha256",
    "package_population",
    "schema_version"
  ]);
  assert.equal(carrier.artifact_set_sha256,
    domainSeparatedDigest(ARTIFACT_SET_IDENTITY_DOMAIN, preimage));

  for (const field of Object.keys(preimage)) {
    const reduced = { ...preimage };
    delete reduced[field];
    assert.notEqual(
      domainSeparatedDigest(ARTIFACT_SET_IDENTITY_DOMAIN, reduced),
      carrier.artifact_set_sha256,
      `${field} must participate in the artifact-set identity preimage`
    );
  }
});

test("every part of the composed capture is bound directly into the identity", () => {
  const carrier = buildArtifactSetProvenance(scenario().input);
  const constantFields = [
    "schema_version",
    "complete_capture_source_set_sha256",
    "binding_set_sha256",
    "package_population",
    "artifact_population"
  ];
  const identities = new Map([[carrier.artifact_set_sha256, "the unmutated capture"]]);

  for (const [label, mutate] of CAPTURE_MUTATIONS) {
    const spliced = structuredClone(carrier);
    mutate(spliced.authentication_provenance_capture);
    assert.notDeepEqual(spliced.authentication_provenance_capture,
      carrier.authentication_provenance_capture,
      `the ${label} mutation must actually change the capture`);
    for (const field of constantFields) {
      assert.deepEqual(spliced[field], carrier[field],
        `${label} must hold ${field} constant`);
    }

    const identity = identityOf(spliced);
    assert.notEqual(identity, carrier.artifact_set_sha256,
      `${label} must change the artifact-set identity`);
    assert.ok(!identities.has(identity),
      `${label} collides with ${identities.get(identity)}`);
    identities.set(identity, label);

    assert.equal(refusal(() => validateArtifactSetProvenance(spliced)).code,
      "artifact_set_identity_mismatch");
    assert.equal(refusal(() => verifyArtifactSetProvenance(spliced, {
      artifact_set_sha256: carrier.artifact_set_sha256
    })).code, "artifact_set_identity_mismatch");
  }
});

test("populations mixed across captures are refused", () => {
  const mixed = scenario();
  const other = scenario({ suffix: "two" });
  mixed.input.artifact_population.complete_capture_source_set_sha256 =
    other.capture.complete_capture_source_set_sha256;
  const error = refusal(() => buildArtifactSetProvenance(mixed.input));
  assert.equal(error.code, "artifact_set_capture_population_mismatch");

  const carrier = buildArtifactSetProvenance(scenario().input);
  const spliced = structuredClone(carrier);
  spliced.package_population.complete_capture_source_set_sha256 =
    other.capture.complete_capture_source_set_sha256;
  assert.equal(
    refusal(() => validateArtifactSetProvenance(spliced)).code,
    "artifact_set_capture_population_mismatch"
  );
});

test("only the derive operation admits authentication provenance", () => {
  const { input, fixture, capture } = scenario();

  const asserted = assertAuthenticationProvenanceOccurrenceCapture(structuredClone(capture));
  assert.equal(asserted.schema_version, capture.schema_version);
  assert.equal(refusal(() => buildArtifactSetProvenance({
    ...input,
    authentication_provenance_capture: asserted
  })).code, "artifact_set_capture_ingress_required");

  assert.equal(refusal(() => buildArtifactSetProvenance({
    ...input,
    authentication_provenance_witnesses: structuredClone(capture)
  })).code, "artifact_set_input_unknown_field");

  assert.equal(refusal(() => buildArtifactSetProvenance({
    ...input,
    authentication_provenance_witnesses: {
      ...fixture.input,
      evidenceContentBytes: fixture.input.evidenceContentBytes.toString("utf8")
    }
  })).code, "artifact_set_input_invalid");

  const tampered = {
    ...fixture.input,
    attemptBindingWitnessBytes: Buffer.from(
      `${fixture.input.attemptBindingWitnessBytes.toString("utf8").trimEnd()} \n`, "utf8"
    )
  };
  const refused = refusal(() => buildArtifactSetProvenance({
    ...input,
    authentication_provenance_witnesses: tampered
  }));
  assert.equal(refused.code, "artifact_set_capture_admission_failed");
  assert.equal(refused.diagnostics.diagnostics[0].reason, "projection_input_noncanonical");
});

test("member ordering follows scalarCompare over Unicode scalar values", () => {
  const packageMembers = [
    {
      member_id: "pkg-\u{1F600}",
      type_term: "cc:artifact",
      declared_version: "1.0.0",
      declared_content_sha256: digest("e1")
    },
    {
      member_id: "pkg-\uFFFD",
      type_term: "cc:artifact",
      declared_version: "1.0.0",
      declared_content_sha256: digest("e2")
    }
  ];
  const artifactMembers = packageMembers.map((member) => ({
    member_id: `packed-${member.member_id}`,
    type_term: "cc:artifact",
    package_member_id: member.member_id,
    declared_version: member.declared_version,
    declared_content_sha256: member.declared_content_sha256
  }));
  const carrier = buildArtifactSetProvenance(
    scenario({ packageMembers, artifactMembers }).input
  );

  assert.deepEqual(
    carrier.package_population.members.map(({ member_id: id }) => id),
    ["pkg-\uFFFD", "pkg-\u{1F600}"]
  );
  assert.ok("pkg-\u{1F600}" < "pkg-\uFFFD",
    "the UTF-16 code-unit order of these identities is the opposite order");
  assert.deepEqual(
    carrier.artifact_population.members.map(({ member_id: id }) => id),
    ["packed-pkg-\uFFFD", "packed-pkg-\u{1F600}"]
  );
});

test("duplicate, missing, unexpected, and contradictory populations are refused", () => {
  const duplicated = scenario();
  duplicated.input.package_population.members[1].member_id = "pkg-alpha";
  duplicated.input.artifact_population.members[1].package_member_id = "pkg-alpha";
  assert.equal(refusal(() => buildArtifactSetProvenance(duplicated.input)).code,
    "artifact_set_member_duplicate");

  const missing = scenario();
  missing.input.artifact_population.members.pop();
  const missingError = refusal(() => buildArtifactSetProvenance(missing.input));
  assert.equal(missingError.code, "artifact_set_member_missing");
  assert.equal(missingError.diagnostics.diagnostics[0].expected_identity, "pkg-beta");

  const unexpected = scenario();
  unexpected.input.artifact_population.members[1].package_member_id = "pkg-gamma";
  const unexpectedError = refusal(() => buildArtifactSetProvenance(unexpected.input));
  assert.equal(unexpectedError.code, "artifact_set_member_missing");
  assert.ok(unexpectedError.diagnostics.diagnostics.some(
    ({ code }) => code === "artifact_set_member_unexpected"
  ));

  const doubleCovered = scenario();
  doubleCovered.input.artifact_population.members[1].package_member_id = "pkg-alpha";
  assert.equal(refusal(() => buildArtifactSetProvenance(doubleCovered.input)).code,
    "artifact_set_member_unexpected");

  const contradictoryVersion = scenario();
  contradictoryVersion.input.artifact_population.members[0].declared_version = "9.9.9";
  assert.equal(refusal(() => buildArtifactSetProvenance(contradictoryVersion.input)).code,
    "artifact_set_content_version_disagreement");

  const contradictoryContent = scenario();
  contradictoryContent.input.artifact_population.members[0].declared_content_sha256 =
    digest("ff");
  assert.equal(refusal(() => buildArtifactSetProvenance(contradictoryContent.input)).code,
    "artifact_set_content_version_disagreement");
});

test("malformed, unknown-field, and out-of-vocabulary inputs are refused", () => {
  const malformedBinding = scenario();
  malformedBinding.input.binding_set_sha256 = "not-a-digest";
  assert.equal(refusal(() => buildArtifactSetProvenance(malformedBinding.input)).code,
    "artifact_set_binding_digest_malformed");

  const malformedMember = scenario();
  malformedMember.input.package_population.members[0].declared_content_sha256 = "AB";
  assert.equal(refusal(() => buildArtifactSetProvenance(malformedMember.input)).code,
    "artifact_set_member_invalid");

  const unknownTopLevel = scenario();
  assert.equal(refusal(() => buildArtifactSetProvenance({
    ...unknownTopLevel.input,
    release_channel: "stable"
  })).code, "artifact_set_input_unknown_field");

  const unknownMemberField = scenario();
  unknownMemberField.input.package_population.members[0].tarball_path = "/private/root";
  assert.equal(refusal(() => buildArtifactSetProvenance(unknownMemberField.input)).code,
    "artifact_set_input_unknown_field");

  const unknownPopulationField = scenario();
  unknownPopulationField.input.artifact_population.population_id = "ref-caller-chosen";
  assert.equal(refusal(() => buildArtifactSetProvenance(unknownPopulationField.input)).code,
    "artifact_set_input_unknown_field");

  const missingField = scenario();
  delete missingField.input.binding_set_sha256;
  assert.equal(refusal(() => buildArtifactSetProvenance(missingField.input)).code,
    "artifact_set_input_invalid");

  const foreignTypeTerm = scenario();
  foreignTypeTerm.input.package_population.members[0].type_term = "cc:tarball";
  assert.equal(refusal(() => buildArtifactSetProvenance(foreignTypeTerm.input)).code,
    "artifact_set_member_invalid");

  const noncanonicalText = scenario();
  noncanonicalText.input.package_population.members[0].member_id = "pkg-é";
  assert.equal(refusal(() => buildArtifactSetProvenance(noncanonicalText.input)).code,
    "artifact_set_member_invalid");
});

test("carrier schema, canonical ordering, and digest mismatches are refused", () => {
  const carrier = buildArtifactSetProvenance(scenario().input);

  assert.equal(refusal(() => validateArtifactSetProvenance({
    ...structuredClone(carrier),
    published_at: "2026-08-18"
  })).code, "artifact_set_carrier_schema_invalid");

  const unordered = structuredClone(carrier);
  unordered.package_population.members.reverse();
  assert.equal(refusal(() => validateArtifactSetProvenance(unordered)).code,
    "artifact_set_population_noncanonical");

  const miscounted = structuredClone(carrier);
  miscounted.package_population.cardinality = 5;
  assert.equal(refusal(() => validateArtifactSetProvenance(miscounted)).code,
    "artifact_set_population_noncanonical");

  const tamperedIdentity = structuredClone(carrier);
  tamperedIdentity.artifact_set_sha256 = digest("0");
  assert.equal(refusal(() => validateArtifactSetProvenance(tamperedIdentity)).code,
    "artifact_set_identity_mismatch");

  const tamperedPreimage = structuredClone(carrier);
  tamperedPreimage.binding_set_sha256 = digest("cc");
  assert.equal(refusal(() => validateArtifactSetProvenance(tamperedPreimage)).code,
    "artifact_set_identity_mismatch");

  const respliced = structuredClone(carrier);
  respliced.authentication_provenance_capture.complete_capture_source_set_sha256 =
    digest("ee");
  assert.equal(refusal(() => validateArtifactSetProvenance(respliced)).code,
    "artifact_set_capture_population_mismatch");

  const forgedCapture = structuredClone(carrier);
  forgedCapture.authentication_provenance_capture.acquisition_kind = "derived";
  assert.equal(refusal(() => validateArtifactSetProvenance(forgedCapture)).code,
    "artifact_set_carrier_schema_invalid");
  delete forgedCapture.authentication_provenance_capture.roles;
  assert.equal(refusal(() => validateArtifactSetProvenance(forgedCapture)).code,
    "artifact_set_carrier_schema_invalid");

  assert.equal(refusal(() => verifyArtifactSetProvenance(carrier, {
    artifact_set_sha256: digest("1")
  })).code, "artifact_set_identity_mismatch");
  assert.equal(refusal(() => verifyArtifactSetProvenance(carrier, {
    expected_release: "1.0.0"
  })).code, "artifact_set_input_unknown_field");
  assert.equal(refusal(() => validateArtifactSetProvenance("carrier")).code,
    "artifact_set_carrier_schema_invalid");
});

test("provider-local diagnostics stay bounded and expose no caller payload", () => {
  const packageMembers = Array.from({ length: 80 }, (unused, index) => ({
    member_id: `pkg-${String(index).padStart(3, "0")}`,
    type_term: "cc:not-a-controlled-term",
    declared_version: "1.0.0",
    declared_content_sha256: digest(index)
  }));
  const error = refusal(() => buildArtifactSetProvenance(
    scenario({ packageMembers, artifactMembers: [] }).input
  ));
  assert.equal(error.code, "artifact_set_member_invalid");
  assert.equal(error.diagnostics.total_count, 80);
  assert.ok(error.diagnostics.returned_count <= 64);
  assert.equal(error.diagnostics.truncated, true);
  assert.equal(error.diagnostics.omitted_count,
    error.diagnostics.total_count - error.diagnostics.returned_count);

  const oversized = scenario();
  oversized.input.package_population.members[0].member_id = "x".repeat(200000);
  const bounded = refusal(() => buildArtifactSetProvenance(oversized.input));
  const projected = JSON.stringify(bounded.diagnostics);
  assert.ok(projected.length <= 65536,
    "the diagnostic projection must stay inside its owner's byte bound");
  assert.ok(!projected.includes("x".repeat(5000)),
    "the projection must not echo an unbounded caller payload");
});

test("the provider adds no runtime, storage, or policy authority", async () => {
  const source = await readFile(
    new URL("../lib/artifact-set-provenance.mjs", import.meta.url), "utf8"
  );
  for (const forbidden of [
    "node:fs", "node:child_process", "node:process", "node:os", "node:http",
    "node:https", "node:net", "node:worker_threads", "node:vm", "node:module",
    "process.env", "require(", "import(", "execFile", "spawn", "readFile",
    "writeFile", "createRequire", "globalThis", "compiled-validator-cache"
  ]) {
    assert.ok(!source.includes(forbidden),
      `the provider must not reference ${forbidden}`);
  }
  for (const name of [
    "ARTIFACT_SET_IDENTITY_DOMAIN",
    "ARTIFACT_SET_PACKAGE_POPULATION_ID",
    "ARTIFACT_SET_PACKED_ARTIFACT_POPULATION_ID",
    "ARTIFACT_SET_PROVENANCE_REFUSAL_CODES",
    "ARTIFACT_SET_PROVENANCE_SCHEMA",
    "ARTIFACT_SET_PROVENANCE_SCHEMA_VERSION",
    "ArtifactSetProvenanceError",
    "buildArtifactSetProvenance",
    "validateArtifactSetProvenance",
    "verifyArtifactSetProvenance"
  ]) assert.ok(Object.hasOwn(publicSurface, name),
    `${name} must be reachable from the supported package surface`);
  assert.equal(publicSurface.ARTIFACT_SET_PACKAGE_POPULATION_ID, PACKAGE_POPULATION_ID);
  assert.equal(publicSurface.ARTIFACT_SET_PACKED_ARTIFACT_POPULATION_ID,
    PACKED_ARTIFACT_POPULATION_ID);
  assert.equal(publicSurface.buildArtifactSetProvenance, buildArtifactSetProvenance);
  assert.equal(publicSurface.validateArtifactSetProvenance, validateArtifactSetProvenance);
  assert.equal(publicSurface.verifyArtifactSetProvenance, verifyArtifactSetProvenance);
});

test("runtime, declaration, and schema surfaces enter the publish closure", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../package.json", import.meta.url), "utf8"
  ));
  const runtime = "lib/artifact-set-provenance.mjs";
  const declaration = "lib/artifact-set-provenance.d.mts";
  const schema = "schema/controlled-contract-artifact-set-provenance.v1.schema.json";
  for (const entry of [runtime, declaration, schema]) {
    assert.ok(manifest.files.includes(entry), `${entry} must be published`);
  }
  assert.ok(!manifest.files.includes("test/artifact-set-provenance.test.mjs"),
    "repository tests validate publication and are not published");
  assert.ok(manifest.files.every((entry) => !entry.startsWith("test/")));
  assert.deepEqual(manifest.exports["./artifact-set-provenance"], {
    types: `./${declaration}`,
    default: `./${runtime}`
  });
  assert.equal(manifest.exports[`./${schema}`], `./${schema}`);

  const declared = await readFile(new URL(`../${declaration}`, import.meta.url), "utf8");
  for (const signature of [
    "export function buildArtifactSetProvenance(",
    "export function validateArtifactSetProvenance(",
    "export function verifyArtifactSetProvenance(",
    "export class ArtifactSetProvenanceError extends Error"
  ]) assert.ok(declared.includes(signature), `${declaration} must declare ${signature}`);

  const rootDeclaration = await readFile(
    new URL("../current.d.mts", import.meta.url), "utf8"
  );
  assert.ok(rootDeclaration.includes("./lib/artifact-set-provenance.mjs"));

  const published = JSON.parse(await readFile(
    new URL(`../${schema}`, import.meta.url), "utf8"
  ));
  assert.deepEqual(published, ARTIFACT_SET_PROVENANCE_SCHEMA);
  assert.equal(published.$id, "controlled-contract-artifact-set-provenance.v1.schema.json");
  assert.equal(published.properties.schema_version.const,
    ARTIFACT_SET_PROVENANCE_SCHEMA_VERSION);
  assert.equal(published.properties.artifact_set_sha256.$comment,
    "domainSeparatedDigest('controlled-contract-artifact-set-provenance.v1', " +
    "{schema_version, authentication_provenance_capture, " +
    "complete_capture_source_set_sha256, binding_set_sha256, package_population, " +
    "artifact_population}).");
});
