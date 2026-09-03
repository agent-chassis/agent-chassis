import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { canonicalJsonBytes, sha256 } from "../../lib/exact-binding-common.mjs";
import { loadExactBindingAdmissionV1 } from
  "../../lib/exact-binding-admission.mjs";
import {
  INTERNAL_CAPTURE_AUTHORITY,
  evaluateCapturedExactBindingsV1
} from "../../lib/exact-binding.mjs";
import {
  executeDeterministicProjection,
  projectDeterministicPopulation,
  projectDeterministicReference
} from "../../lib/deterministic-projection.mjs";
import {
  snapshotTraceFixture,
  versionedCursorTraceFixture
} from "./mutation-pagination-trace-v1-fixture.mjs";
import {
  buildCompletePaginationProfileFixture,
  completeTraversalTraceFixture
} from
  "./complete-pagination-traversal-v1-fixture.mjs";
import {
  executeMutant,
  oracle,
  recapture,
  rederiveVersioned,
  sources
} from "./mutation-pagination-v1-harness.mjs";

const packageRoot = path.resolve(new URL("../../", import.meta.url).pathname);
const d = (character) => character.repeat(64);
const EXPECTED_EXACT_CONTROLS = Object.freeze({
  "proof.pagination.snapshot-consistency": Object.freeze([
    "caller-selected-attempt-refused",
    "capture-order-swap-refused",
    "duplicate-occurrence-positive",
    "empty-page-positive",
    "frozen-snapshot-positive",
    "live-version-content-reuse-refused",
    "member-occurrence-omission-refused",
    "member-occurrence-reorder-refused",
    "missing-trace-refused",
    "projection-result-splice-refused",
    "snapshot-identity-splice-refused",
    "snapshot-state-content-change-refused"
  ]),
  "proof.pagination.versioned-cursor-refusal": Object.freeze([
    "advance-before-refusal-refused",
    "caller-selected-refusal-refused",
    "empty-control-page-positive",
    "identical-version-content-refused",
    "missing-trace-refused",
    "multiple-protected-effects-positive",
    "projection-result-splice-refused",
    "return-before-error-refused",
    "stale-continuation-refused",
    "stale-refusal-zero-effect-positive",
    "unrelated-mutation-control-positive",
    "wrong-cursor-refusal-refused"
  ]),
  "proof.pagination.complete-traversal": Object.freeze([
    "authenticated-population-substitution-refused",
    "authentication-result-splice-refused",
    "caller-selected-projection-refused",
    "capture-swapping-refused",
    "certification-mismatch-refused",
    "empty-traversal-positive",
    "equality-policy-substitution-refused",
    "profile-admission-mismatch-refused",
    "projection-result-splice-refused",
    "resource-policy-substitution-refused",
    "trace-splicing-refused",
    "valid-complete-traversal-positive"
  ])
});
const COMPLETE_EXACT_CONTROL_SCENARIOS = Object.freeze({
  "authenticated-population-substitution-refused": Object.freeze({
    mutation_target: "a-authoritative-population",
    satisfaction: "invalid",
    diagnostic: "target_resolution_evidence_mismatch"
  }),
  "authentication-result-splice-refused": Object.freeze({
    mutation_target: "g-authentication-capture",
    satisfaction: "invalid",
    diagnostic: "binding_role_coverage_mismatch",
    relation: Object.freeze({ id: "derive-authentication-provenance", status: "unsatisfied" })
  }),
  "caller-selected-projection-refused": Object.freeze({
    mutation_target: "role:terminal_page",
    satisfaction: "unsatisfied",
    diagnostic: "binding_role_coverage_mismatch"
  }),
  "capture-swapping-refused": Object.freeze({
    mutation_target: "b-attempt-binding-witness<->f-target-resolution-witness",
    satisfaction: "invalid",
    diagnostic: "target_resolution_witness_invalid"
  }),
  "certification-mismatch-refused": Object.freeze({
    mutation_target: "exact-binding-certification.corpus.corpus_digest",
    satisfaction: "refused",
    diagnostic: "exact_binding_admission_binding_mismatch"
  }),
  "empty-traversal-positive": Object.freeze({
    mutation_target: "complete-traversal-empty-fixture",
    satisfaction: "satisfied"
  }),
  "equality-policy-substitution-refused": Object.freeze({
    mutation_target: "h-equality-policy",
    satisfaction: "invalid",
    diagnostic: "complete_traversal_equality_policy_invalid"
  }),
  "profile-admission-mismatch-refused": Object.freeze({
    mutation_target: "admission.profile_digest",
    satisfaction: "refused",
    diagnostic: "exact_binding_admission_binding_mismatch"
  }),
  "projection-result-splice-refused": Object.freeze({
    mutation_target: "k-traversal-projection",
    satisfaction: "unsatisfied",
    diagnostic: "binding_role_coverage_mismatch",
    relation: Object.freeze({ id: "derive-complete-traversal", status: "unsatisfied" })
  }),
  "resource-policy-substitution-refused": Object.freeze({
    mutation_target: "j-resource-policy",
    satisfaction: "invalid",
    diagnostic: "complete_traversal_resource_policy_invalid"
  }),
  "trace-splicing-refused": Object.freeze({
    mutation_target: "i-mutation-trace",
    satisfaction: "invalid",
    diagnostic: "complete_traversal_source_binding_mismatch"
  }),
  "valid-complete-traversal-positive": Object.freeze({
    mutation_target: "complete-traversal-default-fixture",
    satisfaction: "satisfied"
  })
});

function context(profile, declaration) {
  return {
    contract_digest: d("1"), profile_digest: declaration.profile_digest,
    evaluation_input_digest: d("3"), vocabulary_version: "0.34.0",
    vocabulary_complete_digest: profile.vocabulary_complete_digest,
    admission_digest: d("5"),
    exact_binding_declaration_digest: sha256(canonicalJsonBytes(declaration, { file: true })),
    exact_binding_certification_digest: d("7")
  };
}

async function pack(profileId) {
  const directory = path.join(
    packageRoot, "test/certification/profiles", profileId, "1.0.0"
  );
  return {
    profile: JSON.parse(await readFile(path.join(directory, "profile.json"))),
    declaration: JSON.parse(await readFile(path.join(directory, "exact-binding.json"))),
    input: JSON.parse(await readFile(path.join(directory, "evaluation-input.template.json"))),
    corpus: JSON.parse(await readFile(path.join(directory, "exact-binding-corpus.json"))),
    admission: JSON.parse(await readFile(path.join(directory, "admission.json"))),
    certification: JSON.parse(await readFile(
      path.join(directory, "exact-binding-certification.json")
    ))
  };
}

function evaluate(packValue, traceFixture, {
  input = packValue.input,
  sourceBytes = traceFixture.sources,
  resultBytes = executeDeterministicProjection(
    "mutation-pagination-trace.v1", sourceBytes
  ),
  omitRequirement,
  contentOverride
} = {}) {
  const bytesById = new Map([
    ["a-trace", sourceBytes[0]], ["b-primary-before", sourceBytes[1]],
    ["c-primary-after", sourceBytes[2]], ["d-control-before", sourceBytes[3]],
    ["e-control-after", sourceBytes[4]], ["f-projection", resultBytes]
  ]);
  const references = new Map(input.reference_bindings.map(
    ({ role, reference_ids: ids }) => [role, ids]
  ));
  const bindings = packValue.declaration.requirements.filter(
    ({ requirement_id: id }) => id !== omitRequirement
  ).map((requirement, index) => {
    const bytes = bytesById.get(requirement.requirement_id);
    return {
      binding_id: `binding-${requirement.requirement_id}`,
      requirement_id: requirement.requirement_id,
      capture_id: `capture-${requirement.requirement_id}`,
      binding_kind: requirement.binding_kind,
      media_type: "application/json",
      content_sha256: contentOverride?.[requirement.requirement_id] ?? sha256(bytes),
      source_descriptor_sha256: String(index + 1).repeat(64),
      byte_length: bytes.byteLength,
      role_coverage: requirement.role_coverage.map((coverage) => ({
        ...coverage,
        reference_ids: coverage.projection === "projection_result_population"
          ? projectDeterministicPopulation(
            "mutation-pagination-trace.v1", resultBytes, coverage.population_id
          )
          : [...references.get(coverage.role)]
      }))
    };
  });
  const exactContext = context(packValue.profile, packValue.declaration);
  return evaluateCapturedExactBindingsV1({
    declaration: packValue.declaration, evaluationInput: input,
    context: exactContext, expectedContext: exactContext, bindings,
    capturedBytesByRequirement: bytesById
  }, INTERNAL_CAPTURE_AUTHORITY);
}

function projectedInput(packValue, resultBytes) {
  const input = structuredClone(packValue.input);
  const projectedRoles = new Set(packValue.declaration.requirements.find(
    ({ requirement_id: id }) => id === "f-projection"
  ).role_coverage.filter(
    ({ projection }) => projection === "projection_result_population"
  ).map(({ role }) => role));
  for (const binding of input.reference_bindings) if (projectedRoles.has(binding.role)) {
    binding.reference_ids = projectDeterministicPopulation(
      "mutation-pagination-trace.v1", resultBytes, binding.role
    );
  }
  return input;
}

function evaluateComplete(packValue, completeFixture, {
  input = buildCompletePaginationProfileFixture({
    profile: packValue.profile,
    trace_options: {
      member_ids: completeFixture.population.occurrences.map(
        ({ source_occurrence_id: id }) => id
      ),
      page_sizes: completeFixture.trace.pages.map(
        ({ member_occurrences: members }) => members.length
      )
    }
  }).input,
  bytesOverride = {},
  omitRequirement
} = {}) {
  const auth = completeFixture.authentication.input;
  const projectionBytes = executeDeterministicProjection(
    "mutation-pagination-trace.v1", completeFixture.sources
  );
  const bytesById = new Map([
    ["a-authoritative-population", completeFixture.sources[1]],
    ["b-attempt-binding-witness", auth.attemptBindingWitnessBytes],
    ["c-authentication-witness", auth.authenticationWitnessBytes],
    ["d-source-authentication-witness", auth.sourceAuthenticationWitnessBytes],
    ["e-source-of-record-witness", auth.sourceOfRecordAssignmentWitnessBytes],
    ["f-target-resolution-witness", auth.targetResolutionWitnessBytes],
    ["g-authentication-capture", completeFixture.authentication.resultBytes],
    ["h-equality-policy", completeFixture.sources[3]],
    ["i-mutation-trace", completeFixture.sources[0]],
    ["j-resource-policy", completeFixture.sources[4]],
    ["k-traversal-projection", projectionBytes],
    ...Object.entries(bytesOverride)
  ]);
  const references = new Map(input.reference_bindings.map(
    ({ role, reference_ids: ids }) => [role, ids]
  ));
  const bindings = packValue.declaration.requirements.filter(
    ({ requirement_id: id }) => id !== omitRequirement
  ).map((requirement, index) => {
    const bytes = bytesById.get(requirement.requirement_id);
    return {
      binding_id: `binding-${requirement.requirement_id}`,
      requirement_id: requirement.requirement_id,
      capture_id: `capture-${requirement.requirement_id}`,
      binding_kind: requirement.binding_kind,
      media_type: "application/json",
      content_sha256: sha256(bytes),
      source_descriptor_sha256: String((index % 9) + 1).repeat(64),
      byte_length: bytes.byteLength,
      role_coverage: requirement.role_coverage.map((coverage) => ({
        ...coverage,
        reference_ids: coverage.projection === "projection_result_population"
          ? projectDeterministicPopulation(
            "mutation-pagination-trace.v1", bytes, coverage.population_id
          )
          : coverage.projection === "projection_result_reference"
            ? [projectDeterministicReference(
              "authentication-provenance-occurrence-capture.v1",
              bytes, coverage.projection_id
            ).reference_id]
            : [...references.get(coverage.role)]
      }))
    };
  });
  const exactContext = context(packValue.profile, packValue.declaration);
  return evaluateCapturedExactBindingsV1({
    declaration: packValue.declaration, evaluationInput: input,
    context: exactContext, expectedContext: exactContext, bindings,
    capturedBytesByRequirement: bytesById
  }, INTERNAL_CAPTURE_AUTHORITY);
}

function snapshotExactControl(controlId, value) {
  const fixture = snapshotTraceFixture();
  if (controlId === "frozen-snapshot-positive" ||
      controlId === "duplicate-occurrence-positive") {
    return evaluate(value, fixture).satisfaction === "satisfied";
  }
  if (controlId === "empty-page-positive") {
    const empty = snapshotTraceFixture({
      stable_members: ["member-alpha"],
      interleaved_pages: [[], ["member-alpha"]]
    });
    const resultBytes = executeDeterministicProjection(
      "mutation-pagination-trace.v1", empty.sources
    );
    return evaluate(value, empty, {
      resultBytes, input: projectedInput(value, resultBytes)
    }).satisfaction === "satisfied";
  }
  if (controlId === "missing-trace-refused") return evaluate(value, fixture, {
    omitRequirement: "a-trace"
  }).satisfaction !== "satisfied";
  if (controlId === "capture-order-swap-refused") {
    const swapped = [...fixture.sources];
    [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
    return evaluate(value, fixture, {
      sourceBytes: swapped,
      resultBytes: executeDeterministicProjection(
        "mutation-pagination-trace.v1", fixture.sources
      )
    }).satisfaction !== "satisfied";
  }
  if (controlId === "projection-result-splice-refused" ||
      controlId === "snapshot-identity-splice-refused") {
    const alternate = snapshotTraceFixture({ snapshot_id: "snapshot-other" });
    return evaluate(value, fixture, {
      resultBytes: executeDeterministicProjection(
        "mutation-pagination-trace.v1", alternate.sources
      )
    }).satisfaction !== "satisfied";
  }
  if (controlId === "caller-selected-attempt-refused") {
    fixture.trace.selected.later_page_attempt_id =
      fixture.trace.selected.first_page_attempt_id;
    fixture.sources = sources(fixture);
    return !oracle(fixture).passed;
  }
  if (controlId === "live-version-content-reuse-refused") {
    recapture(fixture, 3, structuredClone(fixture.captures[2]));
    return !oracle(fixture).passed;
  }
  const mutant = {
    "member-occurrence-omission-refused": "omission-hidden-by-final-count",
    "member-occurrence-reorder-refused": "reordered-occurrences",
    "snapshot-state-content-change-refused":
      "constant-label-changed-captured-population"
  }[controlId];
  return mutant ? !executeMutant("snapshot", mutant).passed : false;
}

function versionedExactControl(controlId, value) {
  const fixture = versionedCursorTraceFixture();
  if ([
    "empty-control-page-positive", "multiple-protected-effects-positive",
    "stale-refusal-zero-effect-positive", "unrelated-mutation-control-positive"
  ].includes(controlId)) return evaluate(value, fixture).satisfaction === "satisfied";
  if (controlId === "missing-trace-refused") return evaluate(value, fixture, {
    omitRequirement: "a-trace"
  }).satisfaction !== "satisfied";
  if (controlId === "projection-result-splice-refused") {
    const alternate = versionedCursorTraceFixture();
    alternate.trace.unrelated_source_id = "unrelated-source-alternate";
    alternate.trace.mutations.find(({ occurrence_id: id }) =>
      id === alternate.trace.selected.unrelated_mutation_id).target_source_id =
      alternate.trace.unrelated_source_id;
    rederiveVersioned(alternate.trace);
    alternate.sources = sources(alternate);
    return evaluate(value, fixture, {
      resultBytes: executeDeterministicProjection(
        "mutation-pagination-trace.v1", alternate.sources
      )
    }).satisfaction !== "satisfied";
  }
  const mutant = {
    "advance-before-refusal-refused": "cursor-advances-before-refusal",
    "caller-selected-refusal-refused": "caller-selected-refusal-or-attempt",
    "identical-version-content-refused": "identical-content-version-substitution",
    "return-before-error-refused": "page-returned-before-error",
    "stale-continuation-refused": "stale-continuation-succeeds",
    "wrong-cursor-refusal-refused": "wrong-traversal-or-cursor-refused"
  }[controlId];
  return mutant ? !executeMutant("versioned", mutant).passed : false;
}

async function completeLoaderRefusal(controlId) {
  const directory = path.join(
    packageRoot, "profiles/proof.pagination.complete-traversal/2.0.0"
  );
  const names = [
    "profile.json", "admission.json", "exact-binding.json",
    "exact-binding-certification.json"
  ];
  const raw = await Promise.all(names.map((name) => readFile(path.join(directory, name))));
  if (controlId === "profile-admission-mismatch-refused") {
    const badAdmission = JSON.parse(raw[1]);
    badAdmission.profile_digest = "8".repeat(64);
    raw[1] = canonicalJsonBytes(badAdmission, { file: true });
  } else if (controlId === "certification-mismatch-refused") {
    const badCertification = JSON.parse(raw[3]);
    badCertification.corpus.corpus_digest = "9".repeat(64);
    raw[3] = canonicalJsonBytes(badCertification, { file: true });
  } else return null;
  const mutationTarget = controlId === "profile-admission-mismatch-refused"
    ? "admission.profile_digest"
    : "exact-binding-certification.corpus.corpus_digest";
  try {
    await loadExactBindingAdmissionV1(
      directory, "proof.pagination.complete-traversal", { rawFiles: raw }
    );
    return Object.freeze({ mutation_target: mutationTarget, satisfaction: "satisfied" });
  } catch (error) {
    return Object.freeze({
      mutation_target: mutationTarget,
      satisfaction: "refused",
      diagnostic_codes: Object.freeze([error?.code ?? "unknown"]),
      relation_results: Object.freeze([])
    });
  }
}

function completeResultObservation(mutationTarget, result) {
  return Object.freeze({
    mutation_target: mutationTarget,
    satisfaction: result.satisfaction,
    diagnostic_codes: Object.freeze(result.diagnostics.map(({ code }) => code)),
    relation_results: Object.freeze(result.relation_results.map(
      ({ relation_id: id, status }) => Object.freeze({ id, status })
    ))
  });
}

function assertCompleteControlScenario(controlId, observation) {
  const expected = COMPLETE_EXACT_CONTROL_SCENARIOS[controlId];
  assert.ok(expected, `unregistered complete-traversal control: ${controlId}`);
  assert.ok(observation, `unimplemented complete-traversal control: ${controlId}`);
  assert.equal(observation.mutation_target, expected.mutation_target, controlId);
  assert.equal(observation.satisfaction, expected.satisfaction, controlId);
  if (expected.diagnostic) assert.ok(
    observation.diagnostic_codes.includes(expected.diagnostic),
    `${controlId}: missing ${expected.diagnostic}`
  );
  if (expected.relation) assert.deepEqual(
    observation.relation_results.find(({ id }) => id === expected.relation.id),
    expected.relation,
    controlId
  );
  return true;
}

async function observeCompleteExactControl(controlId, value) {
  if ([
    "profile-admission-mismatch-refused", "certification-mismatch-refused"
  ].includes(controlId)) return completeLoaderRefusal(controlId);

  const fixture = completeTraversalTraceFixture();
  if (controlId === "valid-complete-traversal-positive") {
    return completeResultObservation(
      "complete-traversal-default-fixture", evaluateComplete(value, fixture)
    );
  }
  if (controlId === "empty-traversal-positive") {
    const empty = completeTraversalTraceFixture({ member_ids: [], page_sizes: [0] });
    const input = buildCompletePaginationProfileFixture({
      profile: value.profile, trace_options: { member_ids: [], page_sizes: [0] }
    }).input;
    return completeResultObservation(
      "complete-traversal-empty-fixture", evaluateComplete(value, empty, { input })
    );
  }
  if (controlId === "caller-selected-projection-refused") {
    const input = buildCompletePaginationProfileFixture({ profile: value.profile }).input;
    input.reference_bindings.find(({ role }) => role === "terminal_page")
      .reference_ids = ["ref-page-substituted"];
    return completeResultObservation(
      "role:terminal_page", evaluateComplete(value, fixture, { input })
    );
  }

  const alternate = completeTraversalTraceFixture({
    member_ids: ["member-zeta", "member-eta", "member-theta", "member-iota",
      "member-kappa"],
    snapshot_id: "snapshot-alternate", reference_prefix: "ref-alternate"
  });
  const mutation = {
    "authenticated-population-substitution-refused": {
      mutation_target: "a-authoritative-population",
      bytes: { "a-authoritative-population": alternate.sources[1] }
    },
    "capture-swapping-refused": {
      mutation_target: "b-attempt-binding-witness<->f-target-resolution-witness",
      bytes: {
        "b-attempt-binding-witness": fixture.authentication.input.targetResolutionWitnessBytes,
        "f-target-resolution-witness": fixture.authentication.input.attemptBindingWitnessBytes
      }
    },
    "authentication-result-splice-refused": {
      mutation_target: "g-authentication-capture",
      bytes: { "g-authentication-capture": alternate.authentication.resultBytes }
    },
    "equality-policy-substitution-refused": {
      mutation_target: "h-equality-policy",
      bytes: {
        "h-equality-policy": canonicalJsonBytes({
          schema_version: "controlled-contract.pagination-equality-policy.v1",
          normalization_owner: "equality-normalization-v034.mjs",
          equivalence: "substituted"
        }, { file: true })
      }
    },
    "trace-splicing-refused": {
      mutation_target: "i-mutation-trace",
      bytes: { "i-mutation-trace": alternate.sources[0] }
    },
    "resource-policy-substitution-refused": {
      mutation_target: "j-resource-policy",
      bytes: {
        "j-resource-policy": canonicalJsonBytes({
          schema_version: "controlled-contract.pagination-resource-policy.v1",
          accounting_owner: "substituted.mjs",
          aggregate_input_bytes_limit: 67108864,
          canonical_result_bytes_limit: 67108864,
          work_formula: "authoritative_occurrences+returned_occurrences+pages+transitions",
          work_units_limit: 1000000
        }, { file: true })
      }
    },
    "projection-result-splice-refused": {
      mutation_target: "k-traversal-projection",
      bytes: {
        "k-traversal-projection": executeDeterministicProjection(
          "mutation-pagination-trace.v1", alternate.sources
        )
      }
    }
  }[controlId];
  if (!mutation) return null;
  return completeResultObservation(
    mutation.mutation_target,
    evaluateComplete(value, fixture, { bytesOverride: mutation.bytes })
  );
}

async function completeExactControl(controlId, value) {
  return assertCompleteControlScenario(
    controlId, await observeCompleteExactControl(controlId, value)
  );
}

test("snapshot pagination exact pack binds derived occurrences and distinct live versions", async () => {
  const value = await pack("proof.pagination.snapshot-consistency");
  const fixture = snapshotTraceFixture();
  const result = evaluate(value, fixture);
  assert.equal(result.satisfaction, "satisfied");
  assert.deepEqual(result.relation_results.map(({ operator, status }) =>
    [operator, status]), [
    ["distinct_content_sha256", "satisfied"],
    ["deterministic_projection", "satisfied"],
    ["same_content_sha256", "satisfied"]
  ]);
  const projection = result.bindings.find(
    ({ requirement_id: id }) => id === "f-projection"
  );
  for (const role of [
    "traversal", "first_page_attempt", "later_page_attempt",
    "first_returned_page", "later_returned_page", "relevant_mutation",
    "snapshot", "snapshot_state"
  ]) assert.equal(projection.role_coverage.find(
    (coverage) => coverage.role === role
  ).reference_ids.length, 1);
});

test("versioned cursor exact pack binds stale refusal and zero-effect populations", async () => {
  const value = await pack("proof.pagination.versioned-cursor-refusal");
  const result = evaluate(value, versionedCursorTraceFixture());
  assert.equal(result.satisfaction, "satisfied");
  assert.equal(result.relation_results.find(
    ({ relation_id: id }) => id === "primary-captured-content"
  ).operator, "distinct_content_sha256");
  const projection = result.bindings.find(
    ({ requirement_id: id }) => id === "f-projection"
  );
  assert.deepEqual(projection.role_coverage.find(
    ({ role }) => role === "effect_occurrences"
  ).reference_ids, []);
  assert.equal(projection.role_coverage.find(
    ({ role }) => role === "protected_effects"
  ).reference_ids.length, 4);
});

test("exact pagination packs refuse missing, swapped, stale, and caller-selected captures", async () => {
  const snapshot = await pack("proof.pagination.snapshot-consistency");
  const versioned = await pack("proof.pagination.versioned-cursor-refusal");
  const snapshotFixture = snapshotTraceFixture();
  const versionFixture = versionedCursorTraceFixture();
  assert.notEqual(evaluate(snapshot, snapshotFixture, {
    omitRequirement: "a-trace"
  }).satisfaction, "satisfied");
  const swapped = [...snapshotFixture.sources];
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  assert.equal(evaluate(snapshot, snapshotFixture, {
    sourceBytes: swapped,
    resultBytes: executeDeterministicProjection(
      "mutation-pagination-trace.v1", snapshotFixture.sources
    )
  }).satisfaction, "invalid");
  const staleResult = executeDeterministicProjection(
    "mutation-pagination-trace.v1", snapshotTraceFixture({
      snapshot_id: "snapshot-other"
    }).sources
  );
  assert.notEqual(evaluate(snapshot, snapshotFixture, {
    resultBytes: staleResult
  }).satisfaction, "satisfied");
  const callerInput = structuredClone(versioned.input);
  callerInput.reference_bindings.find(({ role }) => role === "stale_attempt")
    .reference_ids = callerInput.reference_bindings.find(
      ({ role }) => role === "control_attempt"
    ).reference_ids;
  assert.notEqual(evaluate(versioned, versionFixture, {
    input: callerInput
  }).satisfaction, "satisfied");
});

test("distinct content rejects identical current and stale version bytes", async () => {
  const value = await pack("proof.pagination.versioned-cursor-refusal");
  const fixture = versionedCursorTraceFixture();
  assert.equal(evaluate(value, fixture, {
    contentOverride: {
      "c-primary-after": sha256(fixture.sources[1])
    }
  }).satisfaction, "invalid");
});

test("exact-binding certifications bind independent fixed control corpora", async () => {
  for (const id of [
    "proof.pagination.snapshot-consistency",
    "proof.pagination.versioned-cursor-refusal",
    "proof.pagination.complete-traversal"
  ]) {
    const value = await pack(id);
    const executeControl = id.endsWith("snapshot-consistency")
      ? snapshotExactControl
      : id.endsWith("versioned-cursor-refusal")
        ? versionedExactControl
        : completeExactControl;
    const expected = EXPECTED_EXACT_CONTROLS[id];
    const corpusIds = value.corpus.controls.map(
      ({ control_id: controlId }) => controlId
    );
    const reproduced = [];
    for (const { control_id: controlId } of value.corpus.controls) {
      if (await executeControl(controlId, value)) reproduced.push(controlId);
    }
    assert.equal(value.certification.result.status, "passed");
    assert.deepEqual(corpusIds, expected);
    assert.deepEqual(reproduced, expected);
    assert.deepEqual(value.certification.result.passed_control_ids, expected);
    assert.equal(value.certification.corpus.executable_control_count, expected.length);
    assert.equal(value.admission.exact_binding.executable_control_count, expected.length);
    assert.deepEqual(value.admission.exact_binding.passed_control_ids, expected);
    assert.equal(value.certification.corpus.corpus_digest,
      sha256(canonicalJsonBytes(value.corpus, { file: true })));
    assert.equal(value.certification.exact_binding_declaration_digest,
      sha256(canonicalJsonBytes(value.declaration, { file: true })));
  }
});

test("complete traversal exact binding joins only package-owned authenticated sources", async () => {
  const value = await pack("proof.pagination.complete-traversal");
  const fixture = completeTraversalTraceFixture();
  assert.equal(evaluateComplete(value, fixture).satisfaction, "satisfied");
  const empty = completeTraversalTraceFixture({ member_ids: [], page_sizes: [0] });
  const emptyInput = buildCompletePaginationProfileFixture({
    profile: value.profile, trace_options: { member_ids: [], page_sizes: [0] }
  }).input;
  assert.equal(evaluateComplete(value, empty, { input: emptyInput }).satisfaction,
    "satisfied");
  assert.deepEqual(value.declaration.relations.map(({ transformer_id: id }) => id), [
    "authentication-provenance-occurrence-capture.v1",
    "mutation-pagination-trace.v1"
  ]);
});

test("complete traversal exact binding refuses capture swaps, splices, and caller selection", async () => {
  const value = await pack("proof.pagination.complete-traversal");
  for (const controlId of [
    "authenticated-population-substitution-refused",
    "authentication-result-splice-refused",
    "caller-selected-projection-refused",
    "capture-swapping-refused",
    "equality-policy-substitution-refused",
    "projection-result-splice-refused",
    "resource-policy-substitution-refused",
    "trace-splicing-refused"
  ]) assert.equal(await completeExactControl(controlId, value), true, controlId);
});

test("complete traversal loader refuses profile/admission and certification mismatches", async () => {
  const value = await pack("proof.pagination.complete-traversal");
  for (const controlId of [
    "profile-admission-mismatch-refused", "certification-mismatch-refused"
  ]) assert.equal(await completeExactControl(controlId, value), true, controlId);
});

test("complete traversal exact control IDs are pairwise scenario-bound", async () => {
  const value = await pack("proof.pagination.complete-traversal");
  const controls = EXPECTED_EXACT_CONTROLS["proof.pagination.complete-traversal"];
  const observations = new Map();
  for (const controlId of controls) observations.set(
    controlId, await observeCompleteExactControl(controlId, value)
  );
  for (let left = 0; left < controls.length; left += 1) {
    for (let right = left + 1; right < controls.length; right += 1) {
      assert.throws(() => assertCompleteControlScenario(
        controls[left], observations.get(controls[right])
      ), undefined, `${controls[left]} <- ${controls[right]}`);
      assert.throws(() => assertCompleteControlScenario(
        controls[right], observations.get(controls[left])
      ), undefined, `${controls[right]} <- ${controls[left]}`);
    }
  }
});
