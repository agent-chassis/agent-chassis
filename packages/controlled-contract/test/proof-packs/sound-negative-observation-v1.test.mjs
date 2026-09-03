import assert from "node:assert/strict";
import test from "node:test";

import {
  POPULATION_IDS,
  assertSoundNegativeObservationCapture
} from "../../lib/sound-negative-observation-projection.mjs";
import {
  assertCanonicalProjectionResult,
  executeDeterministicProjection,
  prepareDeterministicProjection,
  validateDeterministicProjectionGraph,
  validateDeterministicProjectionPopulation,
  validateDeterministicProjectionReference,
  validateDeterministicProjectionRelation
} from "../../lib/deterministic-projection.mjs";
import {
  buildSoundNegativeObservationSources,
  resign
} from "./sound-negative-observation-v1-fixture.mjs";

function members(contract, name) {
  return contract.propositions.find(({ subject_reference_id: subject, operator }) =>
    subject === POPULATION_IDS[name] && operator === "reference:contains"
  )?.operands.map(({ reference_id: referenceId }) => referenceId) ?? [];
}

function conclusion(contract) {
  return ["absent", "present", "unavailable"].find((name) =>
    members(contract, `${name}-conclusion`).length === 1);
}

function projectEvidence(evidence, label) {
  return JSON.parse(resign(evidence, label).projectionBytes);
}

test("sound-negative transformer is registered with its published projection surface", () => {
  const fixture = buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 2, observationCount: 2,
    domain: "registered-sound-negative"
  });
  const resultBytes = executeDeterministicProjection(
    "sound-negative-observation-capture.v1",
    [fixture.evidenceBytes, fixture.captureProofBytes]
  );
  const result = assertCanonicalProjectionResult(
    "sound-negative-observation-capture.v1", resultBytes
  );
  assert.equal(conclusion(result), "absent");
  const prepared = prepareDeterministicProjection(
    "sound-negative-observation-capture.v1", resultBytes
  );
  assert.equal(prepared.population("valid-observations").length, 2);
  assert.equal(prepared.reference("target").reference_id, "ref-query-target");
  assert.deepEqual(prepared.graph("observation-contract"), {
    schema_version: "controlled-contract-projected-contract-graph.v1",
    references: result.references,
    propositions: result.propositions,
    claims: result.claims,
    relations: result.relations,
    collections: result.collections
  });
  assert.deepEqual(validateDeterministicProjectionRelation({
    relation_id: "derive-sound-negative-observation",
    transformer_id: "sound-negative-observation-capture.v1",
    source_requirement_ids: ["observation-evidence", "observation-capture-proof"]
  }), []);
  assert.deepEqual(validateDeterministicProjectionPopulation(
    "sound-negative-observation-capture.v1", "valid-observations"
  ), []);
  assert.deepEqual(validateDeterministicProjectionReference(
    "sound-negative-observation-capture.v1", "target"
  ), []);
  assert.deepEqual(validateDeterministicProjectionGraph(
    "sound-negative-observation-capture.v1", "observation-contract"
  ), []);
});

test("sound-negative transformer derives the three mutually exclusive conclusions", () => {
  for (const expected of ["absent", "present", "unavailable"]) {
    const contract = JSON.parse(buildSoundNegativeObservationSources({
      conclusion: expected,
      domain: `conclusion-${expected}`
    }).projectionBytes);
    assertSoundNegativeObservationCapture(contract);
    assert.equal(conclusion(contract), expected);
    assert.equal(["absent", "present", "unavailable"].reduce((sum, name) =>
      sum + members(contract, `${name}-conclusion`).length, 0), 1);
  }
});

test("stable complete empty and nonempty populations both derive absence", () => {
  for (const [sourceCount, observationCount] of [[0, 0], [2, 2], [3, 3]]) {
    const contract = JSON.parse(buildSoundNegativeObservationSources({
      conclusion: "absent", sourceCount, observationCount,
      domain: `absence-${sourceCount}-${observationCount}`
    }).projectionBytes);
    assert.equal(conclusion(contract), "absent");
    assert.equal(members(contract, "raw-observations").length, observationCount);
    assert.equal(members(contract, "valid-observations").length, observationCount);
  }
});

test("single-sided and joint endpoint drift derive unavailable without contradictory graph", () => {
  for (const endpointVariant of ["state", "version", "both"]) {
    const contract = JSON.parse(buildSoundNegativeObservationSources({
      conclusion: "absent", sourceCount: 1, observationCount: 1,
      endpointVariant, domain: `endpoint-${endpointVariant}`
    }).projectionBytes);
    assert.equal(conclusion(contract), "unavailable", endpointVariant);
    assert.equal(members(contract, "invalidating-conditions").length, 1, endpointVariant);
  }
});

test("missing, duplicated, mixed-source endpoints and reversed intervals derive unavailable", () => {
  const base = buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 2, observationCount: 2, domain: "endpoint-shapes"
  });
  const cases = {
    missing: (evidence) => { evidence.source_outcomes[0].endpoints.pop(); },
    duplicated: (evidence) => {
      evidence.source_outcomes[0].endpoints.push(structuredClone(
        evidence.source_outcomes[0].endpoints[1]
      ));
    },
    mixed: (evidence) => {
      evidence.source_outcomes[0].endpoints[1].source = structuredClone(
        evidence.source_outcomes[1].source
      );
    },
    reversed: (evidence) => {
      [evidence.interval.start_sequence, evidence.interval.end_sequence] =
        [evidence.interval.end_sequence + 1, evidence.interval.start_sequence];
    }
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const evidence = structuredClone(base.evidence);
    mutate(evidence);
    const contract = projectEvidence(evidence, `endpoint-shape-${label}`);
    assert.equal(conclusion(contract), "unavailable", label);
    assert.ok(members(contract, "invalidating-conditions").length > 0, label);
  }
});

test("observations outside either interval endpoint remain raw and derive unavailable", () => {
  const base = buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 1, observationCount: 1, domain: "outside-interval"
  });
  for (const [label, sequence] of [["before", 9], ["after", 11]]) {
    const evidence = structuredClone(base.evidence);
    evidence.source_outcomes[0].observations[0].sequence = sequence;
    const contract = projectEvidence(evidence, `outside-${label}`);
    assert.equal(conclusion(contract), "unavailable", label);
    assert.equal(members(contract, "raw-observations").length, 1, label);
    assert.equal(members(contract, "valid-observations").length, 0, label);
  }
});

test("malformed, unauthenticated, stale, duplicate, and spliced observations cannot launder", () => {
  const base = buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 2, observationCount: 2, domain: "invalid-observation"
  });
  const cases = {
    malformed: (evidence) => {
      evidence.source_outcomes[0].observations[0] = {
        kind: "malformed", raw_base64: Buffer.from("bad").toString("base64")
      };
    },
    unauthenticated: (evidence) => {
      evidence.source_outcomes[0].observations[0].witnesses.authentication =
        Buffer.from("{}\n").toString("base64");
    },
    stale: (evidence) => {
      evidence.source_outcomes[0].observations[0].observed_version = structuredClone(
        evidence.source_outcomes[1].endpoints[1].version
      );
    },
    duplicate: (evidence) => {
      evidence.source_outcomes[0].observations.push(structuredClone(
        evidence.source_outcomes[0].observations[0]
      ));
      evidence.declared_observation_total += 1;
    },
    wrongAttempt: (evidence) => {
      evidence.source_outcomes[0].observations[0].observation_attempt = structuredClone(
        evidence.interval.start
      );
    },
    wrongSource: (evidence) => {
      evidence.source_outcomes[0].observations[0].assigned_source = structuredClone(
        evidence.source_outcomes[1].source
      );
    }
  };
  for (const [label, mutate] of Object.entries(cases)) {
    const evidence = structuredClone(base.evidence);
    mutate(evidence);
    const contract = projectEvidence(evidence, `invalid-${label}`);
    assert.equal(conclusion(contract), "unavailable", label);
    assert.equal(members(contract, "raw-observations").length,
      evidence.declared_observation_total, label);
    assert.ok(members(contract, "invalidating-conditions").length > 0, label);
  }
});

test("caller-authored conclusion labels are not capture evidence", () => {
  const source = buildSoundNegativeObservationSources({
    conclusion: "absent", sourceCount: 1, observationCount: 1, domain: "labels"
  });
  const evidence = structuredClone(source.evidence);
  evidence.source_outcomes[0].observations[0].reported_conclusion = "unavailable";
  const contract = projectEvidence(evidence, "open-caller-label");
  assert.equal(conclusion(contract), "unavailable");
  assert.equal(members(contract, "raw-observations").length, 1);
  assert.equal(members(contract, "valid-observations").length, 0);
});
