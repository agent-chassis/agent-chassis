import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  CAPTURE_ROLE_DEFECTS,
  assembleCaptureEvaluationInput,
  canonicalCaptureEvaluationInputJson,
  capturePackIdentityMismatch,
  captureEvaluationInputDiagnostics,
  cardinalityMismatch,
  createCaptureResultFactory,
  diagnosticScalar,
  isPlainObject,
  planCaptureRoleBindings,
  resolveCapturePackSnapshot,
  resolveExactlyOneEvaluationStage,
  selectAllowedTerm
} from "../lib/capture-mapping.mjs";
import { loadAdmittedProofPack } from "../lib/admitted-proof-packs.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");

const FACTORY = createCaptureResultFactory({
  schemaVersion: "controlled-contract-capture-mapping-test.v1",
  identity: { profile_id: "proof.test.subject", profile_version: "1.2.3" },
  nullFields: ["extra_carrier"]
});

function profileWith(roles, stages = ["pre_dispatch"]) {
  return { evaluation_stages: stages, reference_roles: roles };
}

const member = (referenceId, value) => ({
  reference_id: referenceId,
  identity: { kind: "durable_id", domain: "test", value }
});

function planEntry(role, {
  typeTerms = ["cc:artifact"],
  identityKinds = ["durable_id"],
  build = () => [member(`ref-${role.replaceAll("_", "-")}`, role)]
} = {}) {
  return { role, typeTerms, identityKinds, build };
}

test("a refusal envelope is atomic, deeply frozen, and carries the adapter identity", () => {
  const detail = { role: "left_members", nested: { count: 2 } };
  const refusal = FACTORY.refuse("test.code.v1", "a stated reason", detail);

  assert.deepEqual(refusal, {
    schema_version: "controlled-contract-capture-mapping-test.v1",
    mapped: false,
    profile_id: "proof.test.subject",
    profile_version: "1.2.3",
    source: null,
    references: null,
    evaluation_input: null,
    extra_carrier: null,
    refusal: {
      code: "test.code.v1",
      reason: "a stated reason",
      detail: { role: "left_members", nested: { count: 2 } }
    }
  });

  for (const field of ["source", "references", "evaluation_input", "extra_carrier"]) {
    assert.equal(refusal[field], null, field);
  }
  assert.equal(Object.isFrozen(refusal), true);
  assert.equal(Object.isFrozen(refusal.refusal), true);
  assert.equal(Object.isFrozen(refusal.refusal.detail), true);
  assert.equal(Object.isFrozen(refusal.refusal.detail.nested), true);

  detail.nested.count = 99;
  assert.equal(refusal.refusal.detail.nested.count, 2);
});

test("a refusal with no detail states null rather than an empty object", () => {
  const refusal = FACTORY.refuse("test.code.v1", "a stated reason");
  assert.equal(refusal.refusal.detail, null);
});

test("an accepted envelope carries the adapter identity, its carriers, and no refusal", () => {
  const evaluationInput = assembleCaptureEvaluationInput({
    stage: "pre_dispatch", referenceBindings: []
  });
  const accepted = FACTORY.accept({
    source: { pair_id: "pair-1" },
    references: [{ reference_id: "ref-one", type_term: "cc:artifact", identity: null }],
    evaluationInput,
    additional: { extra_carrier: { requirement: "one" } }
  });

  assert.equal(accepted.mapped, true);
  assert.equal(accepted.refusal, null);
  assert.equal(accepted.schema_version, "controlled-contract-capture-mapping-test.v1");
  assert.equal(accepted.profile_id, "proof.test.subject");
  assert.deepEqual(accepted.extra_carrier, { requirement: "one" });
  assert.equal(accepted.evaluation_input, evaluationInput);
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(Object.isFrozen(accepted.source), true);
  assert.equal(Object.isFrozen(accepted.evaluation_input), true);
  assert.equal(Object.isFrozen(accepted.references[0]), true);

  assert.deepEqual(Object.keys(accepted), Object.keys(FACTORY.refuse("c", "r")));
});

test("an adapter that declares no additional carrier gets exactly the three common ones", () => {
  const factory = createCaptureResultFactory({
    schemaVersion: "controlled-contract-capture-mapping-test.v1"
  });
  assert.deepEqual(Object.keys(factory.refuse("c", "r")), [
    "schema_version", "mapped", "source", "references", "evaluation_input", "refusal"
  ]);
});

test("the package's own admitted pack is loaded when the caller supplies none", async () => {
  for (const supplied of [undefined, null]) {
    const { admitted, unrecognized } = await resolveCapturePackSnapshot({
      pack: supplied, profileId: "proof.scope.write-confinement"
    });
    assert.equal(unrecognized, false);
    assert.equal(admitted.profile.profile_id, "proof.scope.write-confinement");
  }
});

test("a caller-supplied pack must be the loader's own snapshot", async () => {
  const real = await loadAdmittedProofPack("proof.scope.write-confinement");
  const accepted = await resolveCapturePackSnapshot({
    pack: real, profileId: "proof.scope.write-confinement"
  });
  assert.equal(accepted.unrecognized, false);
  assert.equal(accepted.admitted, real);

  for (const pretender of [
    {}, { profile: structuredClone(real.profile) }, "pack", 7,
    structuredClone(real)
  ]) {
    const rejected = await resolveCapturePackSnapshot({
      pack: pretender, profileId: "proof.scope.write-confinement"
    });
    assert.equal(rejected.unrecognized, true);
    assert.equal(rejected.admitted, null);
  }
});

test("exact pack identity is matched on both id and version", () => {
  const profile = { profile_id: "proof.a.b", profile_version: "2.0.0" };
  assert.equal(capturePackIdentityMismatch(profile, {
    profileId: "proof.a.b", profileVersion: "2.0.0"
  }), null);
  assert.deepEqual(capturePackIdentityMismatch(profile, {
    profileId: "proof.a.b", profileVersion: "3.0.0"
  }), {
    expected: { profile_id: "proof.a.b", profile_version: "3.0.0" },
    supplied: { profile_id: "proof.a.b", profile_version: "2.0.0" }
  });
  assert.notEqual(capturePackIdentityMismatch(profile, {
    profileId: "proof.c.d", profileVersion: "2.0.0"
  }), null);
});

test("exactly one non-empty evaluation stage resolves and anything else does not", () => {
  assert.deepEqual(resolveExactlyOneEvaluationStage({ evaluation_stages: ["pre_dispatch"] }),
    { stage: "pre_dispatch", declaredStageCount: 1 });
  assert.deepEqual(resolveExactlyOneEvaluationStage({ evaluation_stages: [] }),
    { stage: null, declaredStageCount: 0 });
  assert.deepEqual(
    resolveExactlyOneEvaluationStage({ evaluation_stages: ["pre_dispatch", "post_delivery"] }),
    { stage: null, declaredStageCount: 2 }
  );
  assert.deepEqual(resolveExactlyOneEvaluationStage({ evaluation_stages: [""] }),
    { stage: null, declaredStageCount: 1 });
  assert.deepEqual(resolveExactlyOneEvaluationStage({ evaluation_stages: [7] }),
    { stage: null, declaredStageCount: 1 });

  assert.deepEqual(resolveExactlyOneEvaluationStage({}),
    { stage: null, declaredStageCount: 0 });
});

test("allowed selection honours adapter preference order and pack restriction", () => {
  assert.equal(selectAllowedTerm(["a", "b"], ["b", "a"]), "a");
  assert.equal(selectAllowedTerm(["a", "b"], ["b"]), "b");
  assert.equal(selectAllowedTerm(["a", "b"], ["c"]), null);
  assert.equal(selectAllowedTerm(["a", "b"], []), null);

  assert.equal(selectAllowedTerm(["a", "b"], undefined), "a");
  assert.equal(selectAllowedTerm(["a", "b"], null), "a");
});

test("cardinality is checked only where the pack constrains it", () => {
  assert.equal(cardinalityMismatch("exactly_one", 1), null);
  assert.equal(cardinalityMismatch("exactly_one", 0), "exactly_one");
  assert.equal(cardinalityMismatch("exactly_one", 2), "exactly_one");
  assert.equal(cardinalityMismatch("one_or_more", 1), null);
  assert.equal(cardinalityMismatch("one_or_more", 0), "one_or_more");
  assert.equal(cardinalityMismatch("zero_or_one", 0), null);
  assert.equal(cardinalityMismatch("zero_or_one", 2), "zero_or_one");
  assert.equal(cardinalityMismatch("zero_or_more", 0), null);
  assert.equal(cardinalityMismatch("zero_or_more", 9), null);
});

test("role bindings follow the pack's declared role order, terms, and kinds", () => {
  const profile = profileWith([
    {
      role: "subject",
      allowed_type_terms: ["cc:resource", "cc:artifact"],
      cardinality: "exactly_one",
      allowed_identity_kinds: ["repository_path", "durable_id"]
    },
    {
      role: "members",
      allowed_type_terms: ["cc:artifact"],
      cardinality: "zero_or_more"
    }
  ]);
  const kinds = [];
  const { bindings, references, defect } = planCaptureRoleBindings(profile, [

    planEntry("members", {
      build: () => [member("ref-member-one", "one"), member("ref-member-two", "two")]
    }),
    planEntry("subject", {
      typeTerms: ["cc:artifact", "cc:resource"],
      identityKinds: ["durable_id", "repository_path"],
      build: (identityKind) => {
        kinds.push(identityKind);
        return [member("ref-subject", "subject")];
      }
    })
  ]);

  assert.equal(defect, null);
  assert.deepEqual(bindings, [
    { role: "subject", reference_ids: ["ref-subject"] },
    { role: "members", reference_ids: ["ref-member-one", "ref-member-two"] }
  ]);
  assert.deepEqual(references.map(({ reference_id: id }) => id),
    ["ref-subject", "ref-member-one", "ref-member-two"]);

  assert.deepEqual(references.map(({ type_term: term }) => term),
    ["cc:artifact", "cc:artifact", "cc:artifact"]);

  assert.deepEqual(kinds, ["durable_id"]);
});

test("a pack role the plan cannot fill is a role-unfillable defect naming every gap", () => {
  const profile = profileWith([
    { role: "zebra", allowed_type_terms: ["cc:artifact"], cardinality: "exactly_one" },
    { role: "alpha", allowed_type_terms: ["cc:artifact"], cardinality: "exactly_one" },
    { role: "known", allowed_type_terms: ["cc:artifact"], cardinality: "exactly_one" }
  ]);
  const { bindings, references, defect } =
    planCaptureRoleBindings(profile, [planEntry("known")]);
  assert.equal(bindings, null);
  assert.equal(references, null);
  assert.equal(defect.kind, CAPTURE_ROLE_DEFECTS.ROLE_UNFILLABLE);
  assert.deepEqual(defect.detail, { unfillable_roles: ["alpha", "zebra"] });
});

test("a plan entry for a role the pack does not declare is simply not bound", () => {
  const profile = profileWith([
    { role: "known", allowed_type_terms: ["cc:artifact"], cardinality: "exactly_one" }
  ]);
  const { bindings, defect } = planCaptureRoleBindings(profile, [
    planEntry("known"), planEntry("retired")
  ]);
  assert.equal(defect, null);
  assert.deepEqual(bindings.map(({ role }) => role), ["known"]);
});

test("a pack that allows no supplied type term is a type-term defect", () => {
  const profile = profileWith([
    { role: "subject", allowed_type_terms: ["cc:population"], cardinality: "exactly_one" }
  ]);
  const { bindings, defect } = planCaptureRoleBindings(profile, [
    planEntry("subject", { typeTerms: ["cc:artifact", "cc:resource"] })
  ]);
  assert.equal(bindings, null);
  assert.equal(defect.kind, CAPTURE_ROLE_DEFECTS.TYPE_TERM_UNSUPPORTED);
  assert.deepEqual(defect.detail, {
    role: "subject", allowed_type_terms: ["cc:population"]
  });
});

test("a pack that allows no supplied identity kind is an identity-kind defect", () => {
  const profile = profileWith([
    {
      role: "subject",
      allowed_type_terms: ["cc:artifact"],
      cardinality: "exactly_one",
      allowed_identity_kinds: ["code_symbol"]
    }
  ]);
  const { bindings, defect } = planCaptureRoleBindings(profile, [
    planEntry("subject", { identityKinds: ["durable_id", "repository_path"] })
  ]);
  assert.equal(bindings, null);
  assert.equal(defect.kind, CAPTURE_ROLE_DEFECTS.IDENTITY_KIND_UNSUPPORTED);
  assert.deepEqual(defect.detail, {
    role: "subject", allowed_identity_kinds: ["code_symbol"]
  });
});

test("a member count the pack forbids is a cardinality defect naming the count", () => {
  const profile = profileWith([
    { role: "subject", allowed_type_terms: ["cc:artifact"], cardinality: "exactly_one" }
  ]);
  const { bindings, defect } = planCaptureRoleBindings(profile, [
    planEntry("subject", {
      build: () => [member("ref-one", "one"), member("ref-two", "two")]
    })
  ]);
  assert.equal(bindings, null);
  assert.equal(defect.kind, CAPTURE_ROLE_DEFECTS.CARDINALITY_INVALID);
  assert.deepEqual(defect.detail, {
    role: "subject", cardinality: "exactly_one", member_count: 2
  });
});

test("one reference shared by two roles is emitted once and bound to both", () => {
  const profile = profileWith([
    { role: "left_members", allowed_type_terms: ["cc:artifact"], cardinality: "zero_or_more" },
    { role: "right_members", allowed_type_terms: ["cc:artifact"], cardinality: "zero_or_more" }
  ]);
  const shared = () => [member("ref-member-id-string", "id"), member("ref-member-total-decimal", "total")];
  const { bindings, references, defect } = planCaptureRoleBindings(profile, [
    planEntry("left_members", { build: shared }),
    planEntry("right_members", { build: shared })
  ]);
  assert.equal(defect, null);
  assert.deepEqual(bindings, [
    { role: "left_members", reference_ids: ["ref-member-id-string", "ref-member-total-decimal"] },
    { role: "right_members", reference_ids: ["ref-member-id-string", "ref-member-total-decimal"] }
  ]);

  assert.deepEqual(references.map(({ reference_id: id }) => id),
    ["ref-member-id-string", "ref-member-total-decimal"]);
});

test("two conflicting definitions of one reference id are a conflict, never a merge", () => {
  const profile = profileWith([
    { role: "left_members", allowed_type_terms: ["cc:artifact"], cardinality: "zero_or_more" },
    { role: "right_members", allowed_type_terms: ["cc:artifact"], cardinality: "zero_or_more" }
  ]);
  const { bindings, references, defect } = planCaptureRoleBindings(profile, [
    planEntry("left_members", { build: () => [member("ref-shared", "left")] }),
    planEntry("right_members", { build: () => [member("ref-shared", "right")] })
  ]);
  assert.equal(bindings, null);
  assert.equal(references, null);
  assert.equal(defect.kind, CAPTURE_ROLE_DEFECTS.REFERENCE_IDENTITY_CONFLICT);
  assert.deepEqual(defect.detail, { role: "right_members", reference_id: "ref-shared" });
});

test("a differing type term under one reference id is also a conflict", () => {
  const profile = profileWith([
    { role: "left_members", allowed_type_terms: ["cc:artifact"], cardinality: "zero_or_more" },
    { role: "right_members", allowed_type_terms: ["cc:entity"], cardinality: "zero_or_more" }
  ]);
  const { defect } = planCaptureRoleBindings(profile, [
    planEntry("left_members", {
      typeTerms: ["cc:artifact"], build: () => [member("ref-shared", "same")]
    }),
    planEntry("right_members", {
      typeTerms: ["cc:entity"], build: () => [member("ref-shared", "same")]
    })
  ]);
  assert.equal(defect.kind, CAPTURE_ROLE_DEFECTS.REFERENCE_IDENTITY_CONFLICT);
});

test("an evaluation input is assembled from adapter-supplied reference and number bindings", () => {
  const empty = assembleCaptureEvaluationInput({
    stage: "pre_dispatch", referenceBindings: []
  });
  assert.deepEqual(empty, {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "pre_dispatch",
    reference_bindings: [],
    number_bindings: [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [],
    stable_evaluation: {}
  });
  assert.equal(captureEvaluationInputDiagnostics(empty), null);

  const populated = assembleCaptureEvaluationInput({
    stage: "post_delivery",
    referenceBindings: [{ role: "left_members", reference_ids: ["ref-member-id-string"] }],
    numberBindings: [{ role: "member_count", value: 1 }]
  });
  assert.deepEqual(populated.reference_bindings,
    [{ role: "left_members", reference_ids: ["ref-member-id-string"] }]);
  assert.deepEqual(populated.number_bindings, [{ role: "member_count", value: 1 }]);
  assert.equal(populated.evaluation_stage, "post_delivery");

  assert.deepEqual(populated.claim_pattern_bindings, []);
  assert.deepEqual(populated.resolver_facts, []);
  assert.deepEqual(populated.delivered_evidence, []);
  assert.deepEqual(populated.stable_evaluation, {});
  assert.equal(captureEvaluationInputDiagnostics(populated), null);
});

test("schema failure is reported as cloned diagnostics rather than thrown", () => {
  const invalid = assembleCaptureEvaluationInput({
    stage: "not_a_declared_stage",
    referenceBindings: [{ role: "Bad Role", reference_ids: ["not-a-reference"] }]
  });
  const diagnostics = captureEvaluationInputDiagnostics(invalid);
  assert.ok(Array.isArray(diagnostics));
  assert.ok(diagnostics.length > 0);

  const again = captureEvaluationInputDiagnostics(invalid);
  assert.notEqual(diagnostics, again);
  assert.deepEqual(diagnostics, again);
});

test("canonical evaluation-input bytes are deterministic and key-order independent", () => {
  const build = (reversed) => FACTORY.accept({
    source: null,
    references: [],
    evaluationInput: reversed
      ? {
        stable_evaluation: {},
        delivered_evidence: [],
        resolver_facts: [],
        claim_pattern_bindings: [],
        number_bindings: [{ value: 2, role: "member_count" }],
        reference_bindings: [{ reference_ids: ["ref-member-id-string"], role: "left_members" }],
        evaluation_stage: "pre_dispatch",
        input_version: "controlled-contract-verification-profile-input.v1"
      }
      : assembleCaptureEvaluationInput({
        stage: "pre_dispatch",
        referenceBindings: [{ role: "left_members", reference_ids: ["ref-member-id-string"] }],
        numberBindings: [{ role: "member_count", value: 2 }]
      })
  });
  const first = canonicalCaptureEvaluationInputJson(build(false), "test capture");
  const second = canonicalCaptureEvaluationInputJson(build(true), "test capture");
  assert.equal(Buffer.isBuffer(first), true);
  assert.equal(first.equals(second), true);
  assert.equal(first.equals(
    canonicalCaptureEvaluationInputJson(build(false), "test capture")
  ), true);

  assert.equal(first.at(-1), 0x0a);
  assert.equal(first.toString("utf8").startsWith("{\"claim_pattern_bindings\""), true);
});

test("canonical bytes are refused for anything but a mapped result", () => {
  const refusal = FACTORY.refuse("test.code.v1", "a stated reason");
  for (const subject of [refusal, null, undefined, [], "mapped", 7,
    { mapped: true, evaluation_input: null }]) {
    assert.throws(
      () => canonicalCaptureEvaluationInputJson(subject, "test capture"),
      (error) => error instanceof TypeError &&
        error.message.includes("mapped test capture result")
    );
  }
});

test("a caller value is reduced to a clone-safe scalar before it enters a diagnostic", () => {
  assert.equal(diagnosticScalar("text"), "text");
  assert.equal(diagnosticScalar(4), 4);
  assert.equal(diagnosticScalar(false), false);
  assert.equal(diagnosticScalar(null), null);
  assert.equal(diagnosticScalar(undefined), null);
  assert.equal(diagnosticScalar(() => 1), "[function]");
  assert.equal(diagnosticScalar(Symbol("s")), "[symbol]");
  assert.equal(diagnosticScalar(1n), "[bigint]");
  assert.equal(diagnosticScalar({ secret: 1 }), "[object]");
  assert.equal(diagnosticScalar([1, 2]), "[object]");

  assert.doesNotThrow(() => FACTORY.refuse("c", "r", {
    supplied: diagnosticScalar(() => 1)
  }));
});

test("plain-object recognition excludes arrays and null", () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject("object"), false);
});

test("the shared capture owner stays package-internal", async () => {
  const current = await import("../current.mjs");
  for (const name of [
    "createCaptureResultFactory", "planCaptureRoleBindings",
    "assembleCaptureEvaluationInput", "canonicalCaptureEvaluationInputJson",
    "capturePackIdentityMismatch", "captureEvaluationInputDiagnostics",
    "resolveCapturePackSnapshot", "resolveExactlyOneEvaluationStage",
    "selectAllowedTerm", "cardinalityMismatch", "diagnosticScalar",
    "isPlainObject", "CAPTURE_ROLE_DEFECTS"
  ]) assert.equal(name in current, false, name);

  const declaration = await readFile(path.join(packageRoot, "current.d.mts"), "utf8");
  for (const name of ["CAPTURE_ROLE_DEFECTS", "planCaptureRoleBindings",
    "createCaptureResultFactory", "capture-mapping"]) {
    assert.doesNotMatch(declaration, new RegExp(name, "u"), name);
  }
  const runtime = await readFile(path.join(packageRoot, "current.mjs"), "utf8");
  assert.doesNotMatch(runtime, /capture-mapping/u);
});
