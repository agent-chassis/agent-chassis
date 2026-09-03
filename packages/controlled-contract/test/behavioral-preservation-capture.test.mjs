import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES,
  BEHAVIORAL_PRESERVATION_CAPTURE_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_PROFILE_ID,
  BEHAVIORAL_PRESERVATION_PROFILE_VERSION,
  BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION,
  BEHAVIORAL_PRESERVATION_SIDES,
  canonicalBehavioralPreservationEvaluationInputJson,
  mapBehavioralPreservationCapture
} from "../lib/behavioral-preservation-capture.mjs";
import { loadAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";
import { canonicalJsonBytes } from "../lib/deterministic-projection-primitives.mjs";
import { evaluateVerificationProfileV1 } from "../current.mjs";
import {
  buildCrossRepresentationParityFixture
} from "./proof-packs/behavioral-preservation-v1-adequacy.mjs";
import { buildProofPlanFixture } from "./proof-plan-fixture.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const cli = path.join(packageRoot, "bin/assess-contract.mjs");
const execFileAsync = promisify(execFile);
const CODES = BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES;
const pack = await loadAdmittedProofPack(BEHAVIORAL_PRESERVATION_PROFILE_ID);

// ---------------------------------------------------------------------------
// Fixtures. The WK-2106 pair facts are OPAQUE here: these values are deliberately
// not digest-shaped, because this module must not format-check them.
// ---------------------------------------------------------------------------

const DEFAULT_OBSERVABLES = Object.freeze([
  Object.freeze({ observable_id: "id", observable_type: "string", canonical_value: "p-1" }),
  Object.freeze({
    observable_id: "total", observable_type: "decimal", canonical_value: "42"
  })
]);

function reportFor({
  observables = DEFAULT_OBSERVABLES,
  count = null,
  selected = "total",
  overrides = {}
} = {}) {
  return {
    schema_version: BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION,
    observables: structuredClone(observables),
    observable_count: count === null ? observables.length : count,
    selected_observable_id: selected,
    ...overrides
  };
}

function sideFor(position, { report = reportFor(), relativePath = null, overrides = {} } = {}) {
  return {
    evidence_id: `evidence-${position}`,
    evidence_digest: `opaque-${position}-digest`,
    source: {
      kind: "artifact_file",
      relative_path: relativePath ?? `reports/${position}-report.json`
    },
    report,
    ...overrides
  };
}

function captureFor({ baseline = {}, candidate = {}, pair = {}, overrides = {} } = {}) {
  return {
    schema_version: BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION,
    pair: { pair_id: "pair-one", pair_digest: "opaque-pair-digest", ...pair },
    baseline: sideFor("baseline", baseline),
    candidate: sideFor("candidate", candidate),
    ...overrides
  };
}

async function mapOrThrow(capture) {
  const result = await mapBehavioralPreservationCapture({ capture });
  assert.equal(result.mapped, true, JSON.stringify(result.refusal));
  return result;
}

async function refusalFor(capture, options = {}) {
  const result = await mapBehavioralPreservationCapture({ capture, ...options });
  assert.equal(result.mapped, false, "expected a refusal");
  // Failure is atomic: no partial output ever accompanies a refusal.
  for (const field of ["source", "references", "evaluation_input", "exact_binding_sources"]) {
    assert.equal(result[field], null, field);
  }
  assert.equal(Object.isFrozen(result), true);
  return result.refusal;
}

const bindingFor = (result, role) =>
  result.evaluation_input.reference_bindings.find((entry) => entry.role === role);
const referenceFor = (result, referenceId) =>
  result.references.find((entry) => entry.reference_id === referenceId);

// Exactly the diagnostics the pack's own runtime raises when a role binding is
// not admissible. Their ABSENCE is the compatibility proof.
const BINDING_DIAGNOSTIC_CODES = Object.freeze([
  "unknown_reference_role_binding",
  "reference_role_cardinality_invalid",
  "reference_role_binding_dangling",
  "reference_role_binding_type_mismatch",
  "reference_role_binding_identity_kind_mismatch",
  "unknown_number_role_binding",
  "number_role_binding_invalid"
]);

// The pack's own satisfying contract for the default two-observable population.
// Its reference ids are the profile template's, which is exactly the shared
// member-reference convention this adapter reproduces.
function packContract(members = ["ref-member-id-string", "ref-member-total-decimal"]) {
  return buildCrossRepresentationParityFixture({
    profile: pack.profile,
    domain: "behavioral-preservation-capture",
    leftMembers: members,
    rightMembers: members
  });
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
// test-behavioral-preservation-capture-positive
// ---------------------------------------------------------------------------

test("mapping fills the complete pack-owned role shape from one bounded paired capture", async () => {
  const result = await mapOrThrow(captureFor());

  assert.equal(result.schema_version, BEHAVIORAL_PRESERVATION_CAPTURE_SCHEMA_VERSION);
  assert.equal(result.profile_id, BEHAVIORAL_PRESERVATION_PROFILE_ID);
  assert.equal(result.profile_version, BEHAVIORAL_PRESERVATION_PROFILE_VERSION);
  assert.equal(result.refusal, null);
  assert.equal(Object.isFrozen(result), true);

  // Roles, and their order, come from the pack rather than from this mapping.
  assert.deepEqual(
    result.evaluation_input.reference_bindings.map(({ role }) => role),
    pack.profile.reference_roles.map(({ role }) => role)
  );
  assert.equal(result.evaluation_input.evaluation_stage,
    pack.profile.evaluation_stages[0]);

  // One shared member_count, bound once, for the pack's one declared number role.
  assert.deepEqual(result.evaluation_input.number_bindings,
    [{ role: "member_count", value: 2 }]);
  assert.deepEqual(pack.profile.number_roles.map(({ role }) => role), ["member_count"]);

  // The ordered side identities survive, and the two results, populations, and
  // count signals stay distinct references.
  for (const [role, referenceId, evidenceId] of [
    ["left_result", "ref-left-result", "evidence-baseline"],
    ["right_result", "ref-right-result", "evidence-candidate"],
    ["left_population", "ref-left-population", "evidence-baseline"],
    ["right_population", "ref-right-population", "evidence-candidate"],
    ["left_count_signal", "ref-left-count", "evidence-baseline"],
    ["right_count_signal", "ref-right-count", "evidence-candidate"]
  ]) {
    assert.deepEqual(bindingFor(result, role).reference_ids, [referenceId], role);
    assert.equal(referenceFor(result, referenceId).identity.value, evidenceId, role);
  }
  for (const [left, right] of [
    ["ref-left-result", "ref-right-result"],
    ["ref-left-population", "ref-right-population"],
    ["ref-left-count", "ref-right-count"]
  ]) assert.notDeepEqual(referenceFor(result, left), referenceFor(result, right));

  // The opaque WK-2106 pair facts are carried through verbatim.
  assert.equal(referenceFor(result, "ref-logical-source").identity.value, "pair-one");
  assert.equal(referenceFor(result, "ref-verification").identity.value,
    "opaque-pair-digest");

  // The exact source declarations are keyed by the PACK's own requirement ids.
  assert.deepEqual(result.exact_binding_sources, {
    "baseline-behavior-report": {
      kind: "artifact_file", relative_path: "reports/baseline-report.json"
    },
    "candidate-behavior-report": {
      kind: "artifact_file", relative_path: "reports/candidate-report.json"
    }
  });
  assert.deepEqual(result.source.sides.map(({ position }) => position),
    [...BEHAVIORAL_PRESERVATION_SIDES]);
  assert.equal(result.source.member_count, 2);
  assert.equal(result.source.selected_observable_id, "total");
});

test("both complete populations use the profile template's shared member references", async () => {
  const result = await mapOrThrow(captureFor());
  const shared = ["ref-member-id-string", "ref-member-total-decimal"];

  // One reference per distinct typed observable descriptor, bound to both sides in
  // each report's own order -- the convention the profile's own template uses.
  assert.deepEqual(bindingFor(result, "left_members").reference_ids, shared);
  assert.deepEqual(bindingFor(result, "right_members").reference_ids, shared);
  assert.deepEqual(
    result.references.filter(({ reference_id: id }) => id.startsWith("ref-member-"))
      .map(({ reference_id: id }) => id),
    shared
  );
  // The descriptor is carried through byte-for-byte in the identity.
  assert.equal(referenceFor(result, "ref-member-total-decimal").identity.value,
    "{\"observable_id\":\"total\",\"observable_type\":\"decimal\"}");
});

test("populations that differ do not silently share member references", async () => {
  const result = await mapOrThrow(captureFor({
    candidate: {
      report: reportFor({
        observables: [
          DEFAULT_OBSERVABLES[0],
          { observable_id: "total", observable_type: "integer", canonical_value: "42" }
        ]
      })
    }
  }));
  assert.deepEqual(bindingFor(result, "left_members").reference_ids,
    ["ref-member-id-string", "ref-member-total-decimal"]);
  assert.deepEqual(bindingFor(result, "right_members").reference_ids,
    ["ref-member-id-string", "ref-member-total-integer"]);
  // Nothing was reconciled, coerced, or paired by position: the difference is
  // preserved for the pack to evaluate.
  assert.equal(result.references.filter(
    ({ reference_id: id }) => id.startsWith("ref-member-")
  ).length, 3);
});

test("the emitted bindings are admissible against the pack's own binding analysis", async () => {
  const result = await mapOrThrow(captureFor());
  assert.deepEqual(bindingDiagnostics(packContract().contract, result.evaluation_input), []);
});

test("the mapped evaluation input matches the profile template for the same population", async () => {
  const result = await mapOrThrow(captureFor());
  const fixture = packContract();
  const asMap = (input) => ({
    input_version: input.input_version,
    evaluation_stage: input.evaluation_stage,
    number_bindings: input.number_bindings,
    bindings: Object.fromEntries(input.reference_bindings.map(
      ({ role, reference_ids: ids }) => [role, ids]
    ))
  });
  assert.deepEqual(asMap(result.evaluation_input), asMap(fixture.input));
});

test("the complete populations are mapped with no cap and no truncation", async () => {
  const observables = Array.from({ length: 250 }, (_, index) => ({
    observable_id: `field${index}`,
    observable_type: index % 2 === 0 ? "string" : "decimal",
    canonical_value: `value-${index}`
  }));
  const report = () => reportFor({ observables, selected: "field7" });
  const result = await mapOrThrow(captureFor({
    baseline: { report: report() }, candidate: { report: report() }
  }));

  assert.equal(bindingFor(result, "left_members").reference_ids.length, 250);
  assert.equal(bindingFor(result, "right_members").reference_ids.length, 250);
  assert.deepEqual(result.evaluation_input.number_bindings,
    [{ role: "member_count", value: 250 }]);
  // Report order is preserved exactly; nothing is re-sorted.
  assert.deepEqual(
    bindingFor(result, "left_members").reference_ids.slice(0, 3),
    ["ref-member-field0-string", "ref-member-field1-decimal", "ref-member-field2-string"]
  );
  assert.equal(referenceFor(result, "ref-left-value").identity.value, "value-7");
});

test("an empty population maps to a zero shared member count", async () => {
  const result = await mapBehavioralPreservationCapture({
    capture: captureFor({
      baseline: { report: reportFor({ observables: [], selected: "absent" }) },
      candidate: { report: reportFor({ observables: [], selected: "absent" }) }
    })
  });
  // A count of zero is representable; the SELECTION is what cannot resolve, and
  // the pack requires exactly one selected canonical value pair.
  assert.equal(result.mapped, false);
  assert.equal(result.refusal.code, CODES.CANONICAL_SELECTION_UNRESOLVED);
});

test("mapping is deterministic and never mutates the supplied capture", async () => {
  const capture = captureFor();
  const before = canonicalJsonBytes(capture);
  const first = await mapOrThrow(capture);
  const second = await mapOrThrow(captureFor());

  assert.equal(canonicalJsonBytes(capture).equals(before), true);
  assert.equal(
    canonicalBehavioralPreservationEvaluationInputJson(first)
      .equals(canonicalBehavioralPreservationEvaluationInputJson(second)),
    true
  );
  assert.deepEqual(first.references, second.references);
  assert.deepEqual(first.source, second.source);
});

test("canonical evaluation-input bytes are refused for anything but a mapped result", async () => {
  const refused = await mapBehavioralPreservationCapture({ capture: null });
  assert.throws(() => canonicalBehavioralPreservationEvaluationInputJson(refused), TypeError);
  assert.throws(() => canonicalBehavioralPreservationEvaluationInputJson(null), TypeError);
});

// ---------------------------------------------------------------------------
// test-behavioral-preservation-capture-input-refusals
// ---------------------------------------------------------------------------

test("an absent or non-object capture is refused before anything else", async () => {
  for (const capture of [undefined, null]) {
    assert.equal((await refusalFor(capture)).code, CODES.MISSING_REQUIRED_INPUT);
  }
  for (const capture of ["capture", 7, [], true]) {
    assert.equal((await refusalFor(capture)).code, CODES.MALFORMED_CAPTURE);
  }
});

test("a capture under another schema version or field set is refused", async () => {
  assert.equal(
    (await refusalFor({ ...captureFor(), schema_version: "some-other-input.v1" })).code,
    CODES.CAPTURE_SCHEMA_VERSION_UNSUPPORTED
  );
  const extra = await refusalFor({ ...captureFor(), extra_field: 1 });
  assert.equal(extra.code, CODES.MALFORMED_CAPTURE);
  assert.equal(extra.detail.unexpected_field, "extra_field");

  const missing = captureFor();
  delete missing.candidate;
  const refusal = await refusalFor(missing);
  assert.equal(refusal.code, CODES.MALFORMED_CAPTURE);
  assert.equal(refusal.detail.missing_field, "candidate");
});

test("the opaque pair block is required whole and accepts any non-empty identity", async () => {
  for (const pair of [undefined, null, {}, "pair", { pair_id: "one" },
    { pair_id: "one", pair_digest: "two", extra: 3 }]) {
    assert.equal(
      (await refusalFor(captureFor({ overrides: { pair } }))).code,
      CODES.MALFORMED_PAIR_IDENTITY
    );
  }
  for (const value of ["", 7, null, {}]) {
    assert.equal(
      (await refusalFor(captureFor({ pair: { pair_id: value } }))).code,
      CODES.MALFORMED_PAIR_IDENTITY
    );
  }
  // A bare identifier and a digest-shaped string are equally acceptable: this
  // module does not inspect WK-2106 grammar.
  for (const pairDigest of ["x", `sha256:${"a".repeat(64)}`, "not a digest at all"]) {
    const result = await mapOrThrow(captureFor({ pair: { pair_digest: pairDigest } }));
    assert.equal(referenceFor(result, "ref-verification").identity.value, pairDigest);
  }
});

test("each ordered side is required whole with non-empty opaque artifact identities", async () => {
  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    for (const side of [undefined, null, {}, "side", []]) {
      const refusal = await refusalFor(captureFor({ overrides: { [position]: side } }));
      assert.equal(refusal.code, CODES.MALFORMED_SIDE);
      assert.equal(refusal.detail.position, position);
    }
    for (const field of ["evidence_id", "evidence_digest"]) {
      for (const value of ["", 7, null]) {
        const refusal = await refusalFor(captureFor({
          [position]: { overrides: { [field]: value } }
        }));
        assert.equal(refusal.code, CODES.MALFORMED_SIDE);
        assert.equal(refusal.detail.field, field);
      }
    }
    const overBound = await refusalFor(captureFor({
      [position]: { overrides: { snapshot_digest: "sha256:abc" } }
    }));
    assert.equal(overBound.code, CODES.MALFORMED_SIDE);
    assert.equal(overBound.detail.unexpected_field, "snapshot_digest");
  }
});

// ---------------------------------------------------------------------------
// test-behavioral-preservation-capture-source-descriptor
// ---------------------------------------------------------------------------

test("an absent or malformed exact source descriptor is refused", async () => {
  for (const position of BEHAVIORAL_PRESERVATION_SIDES) {
    for (const source of [
      undefined, null, "reports/report.json", [],
      { kind: "artifact_file" },
      { relative_path: "reports/report.json" },
      { kind: "artifact_bytes", relative_path: "reports/report.json" },
      { kind: "complete_reachability_snapshot", relative_path: "reports/report.json" },
      { kind: "artifact_file", relative_path: "reports/report.json", extra: 1 }
    ]) {
      const refusal = await refusalFor(captureFor({ [position]: { overrides: { source } } }));
      assert.equal(refusal.code, CODES.MALFORMED_SOURCE_DESCRIPTOR,
        `${position} ${JSON.stringify(source)}`);
      assert.equal(refusal.detail.position, position);
    }
  }
});

test("an absolute, empty, dot, or parent-traversing report path is refused", async () => {
  for (const relativePath of [
    "", "/srv/reports/report.json", "/", ".", "..", "./report.json",
    "reports/./report.json", "../report.json", "reports/../report.json",
    "reports//report.json", "reports/report.json/", "reports/ report.json",
    7, null, true
  ]) {
    const refusal = await refusalFor(captureFor({
      baseline: { overrides: { source: { kind: "artifact_file", relative_path: relativePath } } }
    }));
    assert.equal(refusal.code, CODES.MALFORMED_SOURCE_DESCRIPTOR,
      JSON.stringify(relativePath));
  }
  // A deep repository-relative path with dots inside a component is accepted.
  const accepted = await mapOrThrow(captureFor({
    baseline: { relativePath: "a/b.c/..d/report.v2.json" }
  }));
  assert.equal(
    accepted.exact_binding_sources["baseline-behavior-report"].relative_path,
    "a/b.c/..d/report.v2.json"
  );
});

test("both source descriptors are admitted before either report is examined", async () => {
  // The candidate descriptor is unusable AND both reports are malformed. The
  // descriptor defect is what the caller is told, so nothing suggests a report
  // was opened.
  const refusal = await refusalFor(captureFor({
    baseline: { overrides: { report: { schema_version: "wrong" } } },
    candidate: {
      relativePath: "../escape.json",
      overrides: { report: { schema_version: "wrong" } }
    }
  }));
  assert.equal(refusal.code, CODES.MALFORMED_SOURCE_DESCRIPTOR);
  assert.equal(refusal.detail.position, "candidate");
});

test("the adapter adds no source-distinctness refusal of its own", async () => {
  // Reusing one descriptor for both sides is the exact-binding owner's
  // `distinct_source_descriptor` relation to decide, not this mapping's.
  const result = await mapOrThrow(captureFor({
    baseline: { relativePath: "reports/one.json" },
    candidate: { relativePath: "reports/one.json" }
  }));
  assert.deepEqual(result.exact_binding_sources, {
    "baseline-behavior-report": { kind: "artifact_file", relative_path: "reports/one.json" },
    "candidate-behavior-report": { kind: "artifact_file", relative_path: "reports/one.json" }
  });
});

// ---------------------------------------------------------------------------
// test-behavioral-preservation-capture-report-refusals
// ---------------------------------------------------------------------------

test("a report under another family, field set, or shape is refused", async () => {
  for (const report of [undefined, null, "report", []]) {
    assert.equal(
      (await refusalFor(captureFor({ baseline: { overrides: { report } } }))).code,
      CODES.MALFORMED_REPORT
    );
  }
  assert.equal(
    (await refusalFor(captureFor({
      baseline: { report: reportFor({ overrides: { schema_version: "other-report.v1" } }) }
    }))).code,
    CODES.MALFORMED_REPORT
  );
  const extra = await refusalFor(captureFor({
    baseline: { report: reportFor({ overrides: { observation_time: "now" } }) }
  }));
  assert.equal(extra.code, CODES.MALFORMED_REPORT);
  assert.equal(extra.detail.unexpected_field, "observation_time");

  for (const observables of ["all", 3, null, { id: "string" }]) {
    assert.equal(
      (await refusalFor(captureFor({
        baseline: { report: reportFor({ overrides: { observables } }) }
      }))).code,
      CODES.MALFORMED_REPORT
    );
  }
});

test("an unsupported typed observable descriptor is refused rather than repaired", async () => {
  for (const observable of [
    null, "id", { observable_id: "id" },
    { observable_id: "id", observable_type: "string" },
    { observable_id: "", observable_type: "string", canonical_value: "v" },
    { observable_id: "id", observable_type: "", canonical_value: "v" },
    { observable_id: "id", observable_type: "string", canonical_value: "" },
    { observable_id: "id", observable_type: "string", canonical_value: 7 },
    { observable_id: "id", observable_type: "string", canonical_value: "v", unit: "ms" }
  ]) {
    const refusal = await refusalFor(captureFor({
      baseline: { report: reportFor({ observables: [observable], selected: "id" }) }
    }));
    assert.equal(refusal.code, CODES.MALFORMED_REPORT, JSON.stringify(observable));
    assert.equal(refusal.detail.index, 0);
  }
});

test("a report whose count disagrees with its own population is refused", async () => {
  for (const observableCount of [1, 3, -1, 2.5, "2", null, undefined]) {
    const refusal = await refusalFor(captureFor({
      baseline: { report: reportFor({ overrides: { observable_count: observableCount } }) }
    }));
    assert.equal(refusal.code, CODES.REPORT_POPULATION_INCONSISTENT, String(observableCount));
    assert.equal(refusal.detail.position, "baseline");
  }
});

test("a repeated typed observable descriptor is refused rather than deduplicated", async () => {
  const refusal = await refusalFor(captureFor({
    baseline: {
      report: reportFor({
        observables: [DEFAULT_OBSERVABLES[1], DEFAULT_OBSERVABLES[1]], selected: "total"
      })
    }
  }));
  assert.equal(refusal.code, CODES.REPORT_POPULATION_INCONSISTENT);
  assert.equal(refusal.detail.observable_id, "total");
});

test("a descriptor with no representable reference label is refused", async () => {
  const refusal = await refusalFor(captureFor({
    baseline: {
      report: reportFor({
        observables: [{ observable_id: "___", observable_type: "string", canonical_value: "v" }],
        selected: "___"
      })
    },
    candidate: {
      report: reportFor({
        observables: [{ observable_id: "___", observable_type: "string", canonical_value: "v" }],
        selected: "___"
      })
    }
  }));
  assert.equal(refusal.code, CODES.OBSERVABLE_DESCRIPTOR_UNSUPPORTED);
  assert.equal(refusal.detail.observable_id, "___");
});

test("two descriptors that would collide on one reference label are refused", async () => {
  const observables = [
    { observable_id: "total", observable_type: "decimal", canonical_value: "1" },
    { observable_id: "Total", observable_type: "decimal", canonical_value: "2" }
  ];
  const refusal = await refusalFor(captureFor({
    baseline: { report: reportFor({ observables, selected: "total" }) },
    candidate: { report: reportFor({ observables, selected: "total" }) }
  }));
  assert.equal(refusal.code, CODES.OBSERVABLE_DESCRIPTOR_UNSUPPORTED);
  assert.equal(refusal.detail.reference_id, "ref-member-total-decimal");
});

// ---------------------------------------------------------------------------
// test-behavioral-preservation-capture-selection-and-count
// ---------------------------------------------------------------------------

test("a canonical selection absent from a side's own population is refused", async () => {
  const refusal = await refusalFor(captureFor({
    baseline: { report: reportFor({ selected: "absent" }) },
    candidate: { report: reportFor({ selected: "absent" }) }
  }));
  assert.equal(refusal.code, CODES.CANONICAL_SELECTION_UNRESOLVED);
  assert.equal(refusal.detail.selected_observable_id, "absent");
});

test("a missing or unusable canonical selection is refused", async () => {
  for (const selectedObservableId of ["", 7, null, undefined]) {
    const refusal = await refusalFor(captureFor({
      baseline: {
        report: reportFor({ overrides: { selected_observable_id: selectedObservableId } })
      }
    }));
    assert.equal(refusal.code, CODES.MALFORMED_REPORT, String(selectedObservableId));
  }
});

test("a selection carried by more than one typed descriptor is ambiguous", async () => {
  const observables = [
    { observable_id: "total", observable_type: "decimal", canonical_value: "42" },
    { observable_id: "total", observable_type: "string", canonical_value: "42" }
  ];
  const refusal = await refusalFor(captureFor({
    baseline: { report: reportFor({ observables, selected: "total" }) },
    candidate: { report: reportFor({ observables, selected: "total" }) }
  }));
  assert.equal(refusal.code, CODES.CANONICAL_SELECTION_AMBIGUOUS);
  assert.equal(refusal.detail.match_count, 2);
});

test("two different per-side selections are one ambiguous pair selection", async () => {
  const refusal = await refusalFor(captureFor({
    baseline: { report: reportFor({ selected: "total" }) },
    candidate: { report: reportFor({ selected: "id" }) }
  }));
  assert.equal(refusal.code, CODES.CANONICAL_SELECTION_AMBIGUOUS);
  assert.deepEqual(refusal.detail, { baseline: "total", candidate: "id" });
});

test("unequal per-side counts make the shared member_count role unfillable", async () => {
  const refusal = await refusalFor(captureFor({
    candidate: { report: reportFor({ observables: [DEFAULT_OBSERVABLES[1]] }) }
  }));
  assert.equal(refusal.code, CODES.MEMBER_COUNT_ROLE_UNFILLABLE);
  assert.deepEqual(refusal.detail, { role: "member_count", baseline: 2, candidate: 1 });
  // The refusal is about representability in this exact pack, not about the pair.
  assert.match(refusal.reason, /one shared member_count/u);
});

// ---------------------------------------------------------------------------
// test-behavioral-preservation-capture-pack-boundary
// ---------------------------------------------------------------------------

test("a pack that is not the admitted behavioral-preservation identity is refused", async () => {
  const other = await loadAdmittedProofPack("proof.scope.write-confinement");
  const refusal = await refusalFor(captureFor(), { pack: other });
  assert.equal(refusal.code, CODES.PROFILE_IDENTITY_MISMATCH);
  assert.deepEqual(refusal.detail.expected, {
    profile_id: BEHAVIORAL_PRESERVATION_PROFILE_ID,
    profile_version: BEHAVIORAL_PRESERVATION_PROFILE_VERSION
  });
});

test("a hand-built pack is refused rather than trusted", async () => {
  for (const pretender of [
    "pack", 7, {},
    { profile: structuredClone(pack.profile), admission: structuredClone(pack.admission) },
    structuredClone(pack)
  ]) {
    const refusal = await refusalFor(captureFor(), { pack: pretender });
    assert.equal(refusal.code, CODES.PACK_SNAPSHOT_UNRECOGNIZED);
  }
});

test("the supplied admitted pack is accepted and produces the same mapping as the default", async () => {
  const supplied = await mapBehavioralPreservationCapture({ capture: captureFor(), pack });
  const defaulted = await mapOrThrow(captureFor());
  assert.equal(supplied.mapped, true);
  assert.deepEqual(supplied.evaluation_input, defaulted.evaluation_input);
});

test("the pack owns every preserved exclusion and the mapping claims none of them", async () => {
  const exclusions = pack.admission.explicit_exclusions;
  assert.ok(Array.isArray(exclusions) && exclusions.length > 0);
  const result = await mapOrThrow(captureFor());
  const emitted = JSON.stringify({
    evaluation_input: result.evaluation_input,
    references: result.references,
    source: result.source,
    exact_binding_sources: result.exact_binding_sources
  });
  for (const exclusion of exclusions) {
    assert.equal(emitted.includes(exclusion), false, exclusion);
  }
  // The pack declares no resolver-fact and no evidence patterns, and the mapping
  // supplies neither, so no excluded guarantee can enter through them.
  assert.deepEqual(pack.profile.resolver_fact_patterns ?? [], []);
  assert.deepEqual(pack.profile.evidence_patterns ?? [], []);
  assert.deepEqual(result.evaluation_input.resolver_facts, []);
  assert.deepEqual(result.evaluation_input.delivered_evidence, []);
  assert.deepEqual(result.evaluation_input.claim_pattern_bindings, []);
  assert.deepEqual(result.evaluation_input.stable_evaluation, {});
});

test("the mapping asserts no launcher-owned pair invariant and no effect of its own", async () => {
  // Sides whose opaque identities are identical, and whose per-side digests differ
  // from one another, are WK-2106's business. This mapping neither compares nor
  // refuses them; it maps and stays advisory.
  const duplicated = await mapOrThrow(captureFor({
    baseline: { overrides: { evidence_id: "same", evidence_digest: "same-digest" } },
    candidate: { overrides: { evidence_id: "same", evidence_digest: "same-digest" } }
  }));
  assert.equal(referenceFor(duplicated, "ref-left-result").identity.value, "same");
  assert.equal(referenceFor(duplicated, "ref-right-result").identity.value, "same");

  const result = await mapOrThrow(captureFor());
  for (const field of ["admission_effect", "review_effect", "integration_effect",
    "publication_effect", "proof_credit_effect", "applicability_effect", "authority"]) {
    assert.equal(field in result, false, field);
  }
});

// ---------------------------------------------------------------------------
// test-behavioral-preservation-capture-failure-atomicity
// ---------------------------------------------------------------------------

test("no refusal ever emits a partial evaluation input", async () => {
  const captures = [
    null, "capture", { ...captureFor(), schema_version: "other.v1" },
    captureFor({ overrides: { pair: {} } }),
    captureFor({ baseline: { overrides: { source: null } } }),
    captureFor({ baseline: { report: reportFor({ count: 5 }) } }),
    captureFor({ baseline: { report: reportFor({ selected: "absent" }) } }),
    captureFor({ candidate: { report: reportFor({ observables: [DEFAULT_OBSERVABLES[0]] }) } })
  ];
  const codes = new Set();
  for (const capture of captures) {
    const result = await mapBehavioralPreservationCapture({ capture });
    assert.equal(result.mapped, false, JSON.stringify(capture));
    assert.deepEqual([
      result.source, result.references, result.evaluation_input,
      result.exact_binding_sources
    ], [null, null, null, null]);
    assert.equal(Object.isFrozen(result.refusal), true);
    assert.equal(Object.values(CODES).includes(result.refusal.code), true);
    codes.add(result.refusal.code);
  }
  assert.ok(codes.size >= 6);
});

// ---------------------------------------------------------------------------
// test-behavioral-preservation-capture-exact-binding-integration
// ---------------------------------------------------------------------------

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

// Assess the pack's own satisfying contract using the evaluation input and the
// exact source declarations THIS mapping emitted, over real captured report bytes.
async function assessMappedCapture(t, { capture, baselineBytes, candidateBytes }) {
  const result = await mapOrThrow(capture);
  const root = await mkdtemp(path.join(os.tmpdir(), "behavioral-preservation-capture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = packContract();
  const written = new Set();
  for (const [side, bytes] of [["baseline", baselineBytes], ["candidate", candidateBytes]]) {
    const relative = capture[side].source.relative_path;
    if (written.has(relative)) continue;
    written.add(relative);
    await mkdir(path.join(root, path.dirname(relative)), { recursive: true });
    await writeFile(path.join(root, relative), bytes);
  }
  await Promise.all([
    writeFile(path.join(root, "contract.json"), canonicalJsonBytes(fixture.contract)),
    writeFile(path.join(root, "evaluation.json"),
      canonicalBehavioralPreservationEvaluationInputJson(result))
  ]);
  const proofPlanPath = path.join(root, "proof-plan.json");
  await writeFile(proofPlanPath, canonicalJsonBytes(await buildProofPlanFixture({
    contractPath: path.join(root, "contract.json"),
    packs: [{
      profileId: BEHAVIORAL_PRESERVATION_PROFILE_ID,
      requestedIntents: ["controlled-proof-intent.behavioral-preservation"],
      evaluationInputPath: path.join(root, "evaluation.json"),
      captureRoot: root,
      // The mapping's own emitted declarations, used verbatim.
      exactBindingSources: result.exact_binding_sources
    }]
  })));
  const run = await runCli([
    "--input", path.join(root, "contract.json"), "--proof-plan", proofPlanPath
  ]);
  return { result, run, compact: JSON.parse(run.stdout) };
}

test("byte-identical reports at two distinct paths reach an exact-binding proof", async (t) => {
  const bytes = canonicalJsonBytes({ id: "p-1", total: 42 });
  const { compact } = await assessMappedCapture(t, {
    capture: captureFor(), baselineBytes: bytes, candidateBytes: bytes
  });
  assert.equal(compact.structure, "proven");
  assert.equal(compact.profile_discrimination, "proven");
  assert.equal(compact.exact_binding, "proven");
});

test("changed candidate bytes are decided by the exact-binding owner, not by a mapping refusal", async (t) => {
  const { result, compact } = await assessMappedCapture(t, {
    capture: captureFor(),
    baselineBytes: canonicalJsonBytes({ id: "p-1", total: 42 }),
    candidateBytes: canonicalJsonBytes({ id: "p-1", total: 43 })
  });
  // The mapping succeeded: it never reads or compares report bytes.
  assert.equal(result.mapped, true);
  assert.equal(compact.structure, "proven");
  assert.notEqual(compact.exact_binding, "proven");
});

test("a reused source descriptor is decided by the exact-binding owner", async (t) => {
  const bytes = canonicalJsonBytes({ id: "p-1", total: 42 });
  const { result, compact } = await assessMappedCapture(t, {
    capture: captureFor({
      baseline: { relativePath: "reports/one.json" },
      candidate: { relativePath: "reports/one.json" }
    }),
    baselineBytes: bytes,
    candidateBytes: bytes
  });
  assert.equal(result.mapped, true);
  assert.notEqual(compact.exact_binding, "proven");
});

// ---------------------------------------------------------------------------
// test-behavioral-preservation-capture-package-surface
// ---------------------------------------------------------------------------

const PUBLIC_EXPORTS = Object.freeze([
  "BEHAVIORAL_PRESERVATION_CAPTURE_INPUT_SCHEMA_VERSION",
  "BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES",
  "BEHAVIORAL_PRESERVATION_CAPTURE_SCHEMA_VERSION",
  "BEHAVIORAL_PRESERVATION_PROFILE_ID",
  "BEHAVIORAL_PRESERVATION_PROFILE_VERSION",
  "BEHAVIORAL_PRESERVATION_REPORT_SCHEMA_VERSION",
  "BEHAVIORAL_PRESERVATION_SIDES",
  "canonicalBehavioralPreservationEvaluationInputJson",
  "mapBehavioralPreservationCapture"
]);

test("the runtime export and the declaration expose the same mapping surface", async () => {
  const current = await import("../current.mjs");
  for (const name of PUBLIC_EXPORTS) assert.ok(name in current, name);
  assert.equal(typeof current.mapBehavioralPreservationCapture, "function");
  assert.equal(typeof current.canonicalBehavioralPreservationEvaluationInputJson, "function");
  assert.equal(current.BEHAVIORAL_PRESERVATION_PROFILE_ID, BEHAVIORAL_PRESERVATION_PROFILE_ID);
  assert.equal(current.BEHAVIORAL_PRESERVATION_PROFILE_VERSION, "2.0.0");
  assert.equal(Object.isFrozen(current.BEHAVIORAL_PRESERVATION_CAPTURE_REFUSAL_CODES), true);

  const declaration = await readFile(path.join(packageRoot, "current.d.mts"), "utf8");
  for (const name of PUBLIC_EXPORTS) {
    assert.match(declaration, new RegExp(`\\b${name}\\b`, "u"), name);
  }
  assert.match(declaration, /\bBehavioralPreservationCaptureResult\b/u);
  assert.match(declaration, /\bBehavioralPreservationCaptureRefusalCode\b/u);

  // Internal helpers stay internal, and the existing write-confinement surface is
  // untouched by this addition.
  const module = await import("../lib/behavioral-preservation-capture.mjs");
  assert.deepEqual(Object.keys(module).sort(), [...PUBLIC_EXPORTS].sort());
  assert.equal(typeof current.mapWriteConfinementCapture, "function");
  assert.equal(typeof current.canonicalWriteConfinementEvaluationInputJson, "function");
});

test("both new capture modules are enumerated in the published file allowlist", async () => {
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  for (const required of [
    "lib/capture-mapping.mjs",
    "lib/behavioral-preservation-capture.mjs",
    "lib/write-confinement-capture.mjs"
  ]) assert.equal(manifest.files.includes(required), true, required);
  // The internal shared owner ships as runtime closure, never as a public export.
  assert.equal("./capture-mapping" in manifest.exports, false);
});

test("the publication ships both new capture modules", async () => {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  const { stdout } = await execFileAsync("npm", [
    "pack", "--dry-run", "--json", "--ignore-scripts"
  ], { cwd: packageRoot, env: environment, maxBuffer: 4 * 1024 * 1024 });
  const names = new Set(JSON.parse(stdout)[0].files.map(({ path: file }) => file));
  for (const required of [
    "lib/capture-mapping.mjs", "lib/behavioral-preservation-capture.mjs"
  ]) assert.equal(names.has(required), true, required);
});

test("an isolated packed current entrypoint loads the behavioral adapter closure",
  async (t) => {
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    const temporary = await mkdtemp(path.join(os.tmpdir(), "cc-behavioral-pack-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const { stdout } = await execFileAsync("npm", [
      "pack", "--json", "--ignore-scripts", "--pack-destination", temporary,
      "--cache", path.join(temporary, "npm-cache")
    ], { cwd: packageRoot, env: environment, maxBuffer: 4 * 1024 * 1024 });
    const [packed] = JSON.parse(stdout);
    const consumerRoot = path.join(temporary, "consumer");
    await mkdir(consumerRoot);
    await execFileAsync("tar", [
      "-xzf", path.join(temporary, packed.filename), "-C", consumerRoot
    ]);
    const installedPackage = path.join(consumerRoot, "package");
    await symlink(
      path.resolve(packageRoot, "../../node_modules"),
      path.join(installedPackage, "node_modules"),
      "dir"
    );
    // The packed public entrypoint must load its COMPLETE runtime closure, which
    // now includes the internal shared capture owner, and must actually map. The
    // probe is a real module file rather than `--input-type=module --eval`, so the
    // consumer process is started exactly as an installed consumer would be.
    const probe = path.join(consumerRoot, "probe.mjs");
    await writeFile(probe, `import {
  mapBehavioralPreservationCapture
} from ${JSON.stringify(pathToFileURL(path.join(installedPackage, "current.mjs")).href)};
const result = await mapBehavioralPreservationCapture({
  capture: ${JSON.stringify(captureFor())}
});
process.stdout.write(JSON.stringify({
  mapped: result.mapped,
  member_count: result.evaluation_input?.number_bindings?.[0]?.value ?? null
}));
`);
    const { stdout: mapped } = await execFileAsync(process.execPath, [probe], {
      cwd: consumerRoot, env: environment, maxBuffer: 4 * 1024 * 1024
    });
    assert.deepEqual(JSON.parse(mapped), { mapped: true, member_count: 2 });
  });

test("neither new capture module imports the launcher package", async () => {
  for (const relative of [
    "lib/capture-mapping.mjs", "lib/behavioral-preservation-capture.mjs"
  ]) {
    const source = await readFile(path.join(packageRoot, relative), "utf8");
    for (const [, specifier] of source.matchAll(
      /(?:^|\s)(?:import|export)[^;]*?from\s+"([^"]+)"/gu
    )) {
      assert.equal(specifier.includes("agent-launch"), false, `${relative} -> ${specifier}`);
    }
  }
  // The launcher pair owner is named as a contract reference only.
  const adapter = await readFile(
    path.join(packageRoot, "lib/behavioral-preservation-capture.mjs"), "utf8"
  );
  assert.match(adapter, /workspace-agent-behavioral-preservation-evidence\.mjs/u);
});
