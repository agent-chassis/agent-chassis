import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  executeDeterministicProjection,
  prepareDeterministicProjection,
  validateDeterministicProjectionGraph,
  validateDeterministicProjectionPopulation,
  validateDeterministicProjectionReference,
  validateDeterministicProjectionRelation
} from "../../lib/deterministic-projection.mjs";
import {
  POPULATION_IDS,
  POLICY_VERSION,
  PROHIBITED_FAMILIES,
  TRANSFORMER_ID,
  deriveCallerInputAuthorityConfinementCapture
} from "../../lib/caller-input-authority-confinement-projection.mjs";
import { sha256 } from "../../lib/exact-binding-common.mjs";
import {
  buildCallerInputAuthorityConfinementSources,
  objectKey,
  path,
  role
} from "./caller-input-authority-confinement-v1-fixture.mjs";
import { durableIdentity } from "./authentication-provenance-v1-fixture.mjs";

function captureError(options) {
  assert.throws(() => buildCallerInputAuthorityConfinementSources(options), (error) =>
    typeof error?.code === "string" && error.code.length > 0);
}

function insertOccurrence(records, subject, family, { wrongAttempt = false } = {}) {
  const operation = subject.policy.operations[0].reference;
  const effectId = subject.policy.operations[0].effect_reference_ids[0];
  const effect = subject.policy.effects.find(({ reference_id: referenceId }) =>
    referenceId === effectId);
  records.splice(-1, 0, {
    kind: "occurrence",
    position: 0,
    request: structuredClone(subject.roles.forbiddenRequest),
    attempt: structuredClone(wrongAttempt
      ? subject.roles.acceptedAttempt : subject.roles.forbiddenAttempt),
    request_sha256: records.find(({ request }) =>
      request.reference_id === subject.roles.forbiddenRequest.reference_id).request_sha256,
    family,
    operation: structuredClone(operation),
    effect: structuredClone(effect)
  });
  records.forEach((record, index) => { record.position = index + 1; });
}

test("combined transformer is the sole five-source projection and publishes one graph", () => {
  const fixture = buildCallerInputAuthorityConfinementSources();
  const resultBytes = executeDeterministicProjection(TRANSFORMER_ID, fixture.sourceBytes);
  assert.deepEqual(resultBytes, fixture.projectionBytes);
  const prepared = prepareDeterministicProjection(TRANSFORMER_ID, resultBytes);
  assert.equal(prepared.population("declared-members").length, 9);
  assert.equal(prepared.population("allowed-members").length, 7);
  assert.equal(prepared.population("forbidden-members").length, 2);
  assert.equal(prepared.population("selected-forbidden-members").length, 1);
  assert.equal(prepared.population("pre-refusal-occurrences").length, 0);
  assert.equal(prepared.population("mandatory-sources").length, PROHIBITED_FAMILIES.length);
  assert.equal(prepared.reference("accepted-request").reference_id, "ref-cia-accepted-request");
  assert.equal(prepared.reference("forbidden-request").reference_id, "ref-cia-forbidden-request");
  assert.equal(prepared.graph("caller-input-authority-contract").schema_version,
    "controlled-contract-projected-contract-graph.v1");
  assert.deepEqual(validateDeterministicProjectionRelation({
    relation_id: "derive-caller-input-authority-confinement",
    transformer_id: TRANSFORMER_ID,
    source_requirement_ids: ["policy", "accepted", "forbidden", "evidence", "proof"]
  }), []);
  assert.deepEqual(validateDeterministicProjectionPopulation(
    TRANSFORMER_ID, "selected-forbidden-members"
  ), []);
  assert.deepEqual(validateDeterministicProjectionReference(
    TRANSFORMER_ID, "observation-cut"
  ), []);
  assert.deepEqual(validateDeterministicProjectionGraph(
    TRANSFORMER_ID, "caller-input-authority-contract"
  ), []);
});

test("public five-buffer derivation is registry-equivalent and positionally fail-closed", () => {
  const fixture = buildCallerInputAuthorityConfinementSources();
  const derived = deriveCallerInputAuthorityConfinementCapture({
    policyBytes: fixture.policyBytes,
    acceptedRequestBytes: fixture.acceptedRequestBytes,
    forbiddenRequestBytes: fixture.forbiddenRequestBytes,
    observationEvidenceBytes: fixture.evidenceBytes,
    observationCaptureProofBytes: fixture.captureProofBytes
  });
  assert.deepEqual(derived, fixture.projectionBytes);
  assert.throws(() => deriveCallerInputAuthorityConfinementCapture({
    policyBytes: fixture.acceptedRequestBytes,
    acceptedRequestBytes: fixture.policyBytes,
    forbiddenRequestBytes: fixture.forbiddenRequestBytes,
    observationEvidenceBytes: fixture.evidenceBytes,
    observationCaptureProofBytes: fixture.captureProofBytes
  }), { code: "projection_source_set_invalid" });
  assert.throws(() => deriveCallerInputAuthorityConfinementCapture({
    policyBytes: fixture.policyBytes,
    acceptedRequestBytes: "not-bytes",
    forbiddenRequestBytes: fixture.forbiddenRequestBytes,
    observationEvidenceBytes: fixture.evidenceBytes,
    observationCaptureProofBytes: fixture.captureProofBytes
  }), { code: "projection_source_set_incomplete" });
});

test("nested arrays, alias chains, Unicode, percent decoding, and set reordering remain valid", () => {
  const aliasChain = buildCallerInputAuthorityConfinementSources({
    mutatePolicy(policy) {
      policy.aliases.push({
        alias: path(objectKey("options"), objectKey("legacyMode")),
        canonical: path(objectKey("options"), objectKey("displayMode"))
      });
    },
    mutateForbiddenRequest(request) {
      request.options.legacyMode = request.options.displayMode;
      delete request.options.displayMode;
    }
  });
  assert.equal(aliasChain.projection.populations["selected-forbidden-members"].length, 1);

  const unicode = buildCallerInputAuthorityConfinementSources({
    mutatePolicy(policy) {
      policy.declarations.push({
        path: path(objectKey("café")), classification: "allowed",
        resolution_coordinate_reference_ids: []
      });
    },
    mutateAcceptedRequest(request) { request["café"] = "東京"; }
  });
  assert.equal(unicode.projection.populations["accepted-supplied-members"].length, 8);

  const decoded = buildCallerInputAuthorityConfinementSources({
    decoding: "percent_utf8_once",
    mutateAcceptedRequest(request) {
      request["qu%65ry"] = request.query;
      delete request.query;
    }
  });
  assert.equal(decoded.projection.populations["accepted-supplied-members"].length, 7);

  const reordered = buildCallerInputAuthorityConfinementSources({
    mutatePolicy(policy) {
      policy.declarations.reverse();
      policy.effects.reverse();
      policy.operations.reverse();
      policy.resolution_coordinates.reverse();
      policy.boundary_sources.reverse();
    }
  });
  assert.equal(reordered.projection.populations["mandatory-sources"].length, 9);

  const reservedDiscriminator = buildCallerInputAuthorityConfinementSources({
    mutatePolicy(policy) {
      policy.declarations.push({
        path: path(objectKey("schema_version")), classification: "allowed",
        resolution_coordinate_reference_ids: []
      });
    },
    mutateAcceptedRequest(request) { request.schema_version = POLICY_VERSION; }
  });
  assert.equal(reservedDiscriminator.projection.populations["accepted-supplied-members"].length, 8);
});

test("closed policy partition, typed paths, aliases, and associations fail closed", () => {
  const attacks = [
    {
      name: "duplicate-declaration",
      mutatePolicy(policy) { policy.declarations.push(structuredClone(policy.declarations[0])); }
    },
    {
      name: "unclassified-declaration",
      mutatePolicy(policy) { policy.declarations[0].classification = "caller-label"; }
    },
    {
      name: "allowed-coordinate-overlap",
      mutatePolicy(policy) {
        policy.declarations[0].resolution_coordinate_reference_ids = [
          policy.resolution_coordinates[0].reference.reference_id
        ];
      }
    },
    {
      name: "forbidden-without-coordinate",
      mutatePolicy(policy) {
        policy.declarations.find(({ classification }) =>
          classification === "authority_bearing_forbidden")
          .resolution_coordinate_reference_ids = [];
      }
    },
    {
      name: "alias-cycle",
      mutatePolicy(policy) {
        policy.aliases.push(
          { alias: path(objectKey("cycleA")), canonical: path(objectKey("cycleB")) },
          { alias: path(objectKey("cycleB")), canonical: path(objectKey("cycleA")) }
        );
      }
    },
    {
      name: "alias-canonical-collision",
      mutatePolicy(policy) {
        policy.aliases.push({
          alias: structuredClone(policy.declarations[0].path),
          canonical: structuredClone(policy.declarations[1].path)
        });
      }
    },
    {
      name: "coordinate-association-omission",
      mutatePolicy(policy) { policy.resolution_coordinates[0].operation_reference_ids = []; }
    },
    {
      name: "operation-association-omission",
      mutatePolicy(policy) { policy.operations[0].effect_reference_ids = []; }
    },
    {
      name: "operation-substitution",
      mutatePolicy(policy) {
        policy.resolution_coordinates[0].operation_reference_ids = ["ref-unknown-operation"];
      }
    },
    {
      name: "effect-substitution",
      mutatePolicy(policy) { policy.operations[0].effect_reference_ids = ["ref-unknown-effect"]; }
    },
    {
      name: "server-coordinate-attributed-to-caller",
      mutatePolicy(policy) {
        policy.declarations.find(({ classification }) =>
          classification === "authority_bearing_forbidden")
          .resolution_coordinate_reference_ids.push(
            policy.server_selected_coordinate_reference_ids[0]
          );
      }
    },
    {
      name: "missing-source-family",
      mutatePolicy(policy) { policy.boundary_sources.pop(); }
    },
    {
      name: "duplicate-source-family",
      mutatePolicy(policy) { policy.boundary_sources[1].family = policy.boundary_sources[0].family; }
    }
  ];
  for (const attack of attacks) captureError({ mutatePolicy: attack.mutatePolicy });
  assert.equal(attacks.length, 13);
});

test("unknown, parser-ignored, alias-colliding, and incomplete request members fail closed", () => {
  const attacks = [
    { mutateAcceptedRequest(request) { request.unknown = "ignored"; } },
    { mutateAcceptedRequest(request) { request.nested = { unknown: true }; } },
    { mutateAcceptedRequest(request) { request.items.push({ label: "surplus" }); } },
    { mutateForbiddenRequest(request) { request.unknown = "ignored"; } },
    {
      mutateForbiddenRequest(request) {
        request.options.mode = "canonical-too";
      }
    },
    {
      mutateForbiddenRequest(request) {
        delete request.options.displayMode;
      }
    },
    {
      mutateAcceptedRequest(request) {
        request.classification = "allowed";
      }
    }
  ];
  for (const attack of attacks) captureError(attack);
  assert.equal(attacks.length, 7);
});

test("request, attempt, disposition, refusal, and cut substitution or crossing fails closed", () => {
  const attacks = [
    (records) => { records[1].request_sha256 = "0".repeat(64); },
    (records, subject) => { records[5].attempt = structuredClone(subject.roles.acceptedAttempt); },
    (records, subject) => { records[6].request = structuredClone(subject.roles.acceptedRequest); },
    (records) => { records[6].disposition = "accepted"; },
    (records, subject) => {
      records[7].refusal = role("ref-cia-refusal-substitute", "cc:event",
        durableIdentity("caller-input:disposition", "substitute"));
    },
    (records) => {
      records[8].refusal = role("ref-cia-refusal-substitute", "cc:event",
        durableIdentity("caller-input:disposition", "substitute"));
    },
    (records) => { records[8].cut = structuredClone(records[7].refusal); },
    (records) => { records[3].kind = "refusal"; records[3].refusal = records[3].acceptance;
      delete records[3].acceptance; },
    (records) => { records[7].position = records[6].position; },
    (records) => { records[7].position = records[6].position - 1; }
  ];
  for (const mutateTraceRecords of attacks) captureError({ mutateTraceRecords });
  assert.equal(attacks.length, 10);
});

test("parser acceptance of forbidden-but-ignored input never proves refusal", () => {
  captureError({
    mutateTraceRecords(records, subject) {
      records.find(({ kind, request }) => kind === "parser_disposition" &&
        request.reference_id === subject.roles.forbiddenRequest.reference_id)
        .disposition = "accepted";
    }
  });
});

test("every prohibited occurrence family and wrong-attempt occurrence fails before refusal", () => {
  for (const family of PROHIBITED_FAMILIES) captureError({
    mutateTraceRecords(records, subject) { insertOccurrence(records, subject, family); }
  });
  captureError({
    mutateTraceRecords(records, subject) {
      insertOccurrence(records, subject, "resolver", { wrongAttempt: true });
    }
  });
  assert.equal(PROHIBITED_FAMILIES.length + 1, 10);
});

test("post-cut records and unknown trace kinds fail closed", () => {
  captureError({
    mutateTraceRecords(records, subject) {
      insertOccurrence(records, subject, "resolver");
      const occurrence = records.splice(-2, 1)[0];
      records.push(occurrence);
      records.forEach((record, index) => { record.position = index + 1; });
    }
  });
  captureError({
    mutateTraceRecords(records) { records[0].kind = "caller_conclusion"; }
  });
});

test("missing, duplicate, unstable, mixed, drifted, unavailable observation evidence fails", () => {
  const attacks = [
    (evidence) => { evidence.source_outcomes.pop(); evidence.declared_observation_total -= 1; },
    (evidence) => {
      evidence.source_outcomes.push(structuredClone(evidence.source_outcomes[0]));
      evidence.declared_observation_total += 1;
    },
    (evidence) => {
      evidence.source_outcomes[0].endpoints[1].state = role(
        "ref-cia-drifted-state", "cc:state", durableIdentity("caller-input:drift", "state")
      );
    },
    (evidence) => {
      evidence.source_outcomes[0].endpoints[1].source = structuredClone(
        evidence.source_outcomes[1].source
      );
    },
    (evidence) => {
      evidence.source_outcomes[0].observations[0].observed_version = structuredClone(
        evidence.source_outcomes[1].endpoints[1].version
      );
    },
    (evidence) => {
      evidence.source_outcomes[0].kind = "store_failure";
      evidence.source_outcomes[0].observations = [];
      evidence.declared_observation_total -= 1;
    },
    (evidence) => {
      evidence.source_outcomes[0].kind = "unknown";
    },
    (evidence) => {
      evidence.source_outcomes[0].observations.push(structuredClone(
        evidence.source_outcomes[0].observations[0]
      ));
      evidence.declared_observation_total += 1;
    },
    (evidence) => { evidence.interval.end_sequence = evidence.interval.start_sequence - 1; }
  ];
  for (const mutateEvidence of attacks) captureError({ mutateEvidence });
  assert.equal(attacks.length, 9);
});

test("projection is deterministic across repeated processes, locale, and timezone", () => {
  const script = [
    "import {buildCallerInputAuthorityConfinementSources as b} from",
    "'./packages/controlled-contract/test/proof-packs/caller-input-authority-confinement-v1-fixture.mjs';",
    "import {createHash} from 'node:crypto';",
    "process.stdout.write(createHash('sha256').update(b().projectionBytes).digest('hex'));"
  ].join(" ");
  const digests = [
    { LANG: "C", TZ: "UTC" },
    { LANG: "en_US.UTF-8", TZ: "Pacific/Honolulu" }
  ].map((environment) => spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    encoding: "utf8"
  }));
  for (const result of digests) assert.equal(result.status, 0, result.stderr);
  assert.equal(digests[0].stdout, digests[1].stdout);
  assert.match(digests[0].stdout, /^[0-9a-f]{64}$/u);
  assert.equal(digests[0].stdout, sha256(buildCallerInputAuthorityConfinementSources()
    .projectionBytes));
});

test("published population identities are typed token-vector digests, never dotted paths", () => {
  const fixture = buildCallerInputAuthorityConfinementSources();
  const references = new Map(fixture.projection.contract.references.map((reference) =>
    [reference.reference_id, reference]));
  for (const memberId of fixture.projection.populations["declared-members"]) {
    const member = references.get(memberId);
    assert.equal(member.type_term, "cc:configuration");
    assert.equal(member.identity.domain, "controlled-contract:caller-member-token-vector:v1");
    assert.doesNotMatch(member.identity.value, /\bitems\.0\.label\b/u);
    const tokens = JSON.parse(member.identity.value);
    assert.ok(tokens.every(({ kind }) => [
      "object_key", "array_carrier", "array_index"
    ].includes(kind)));
  }
  assert.equal(POPULATION_IDS["declared-members"], "ref-cia-declared-member-population");
});
