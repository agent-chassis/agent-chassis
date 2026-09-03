import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DIAGNOSTIC_PROJECTION_VERSION,
  MAX_DIAGNOSTIC_COUNT,
  MAX_DIAGNOSTIC_FIELD_BYTES,
  MAX_PROJECTION_BYTES,
  projectBoundedDiagnostics
} from "../../lib/bounded-diagnostic-projection.mjs";
import { canonicalJsonBytes } from
  "../../lib/deterministic-projection-primitives.mjs";
import {
  STABLE_RESOURCE_LIMITS,
  evaluateVerificationProfileV1,
  validateProfileSemanticsV1
} from "../../lib/verification-profile-v1.mjs";
import { validateStableTestProofContract } from "../../current.mjs";
import { buildAuthenticationProvenanceFixture } from
  "../proof-packs/authentication-provenance-v1-fixture.mjs";
import { buildStableTestProofPopulation } from
  "../support/stable-v1-proof-pack-runtime.mjs";

const textualFields = [
  "code", "pointer", "claim_id", "keyword", "reason_code", "reason",
  "expected_identity", "actual_identity", "message"
];

function assertProjectionBounds(projection) {
  assert.ok(canonicalJsonBytes(projection).byteLength <= MAX_PROJECTION_BYTES);
  assert.ok(projection.returned_count <= MAX_DIAGNOSTIC_COUNT);
  for (const diagnostic of projection.diagnostics) {
    for (const field of textualFields) if (diagnostic[field] !== null) assert.ok(
      Buffer.byteLength(JSON.stringify(diagnostic[field]), "utf8") <=
        MAX_DIAGNOSTIC_FIELD_BYTES,
      field
    );
    for (const reason of diagnostic.reasons) assert.ok(
      Buffer.byteLength(JSON.stringify(reason), "utf8") <= MAX_DIAGNOSTIC_FIELD_BYTES,
      "reasons"
    );
    assert.equal(diagnostic.total_reason_count,
      diagnostic.returned_reason_count + diagnostic.omitted_reason_count);
  }
}

test("shared diagnostic projection is deterministic, bounded, and loss-aware", () => {
  assert.deepEqual(projectBoundedDiagnostics([]), {
    diagnostic_projection_version: "controlled-contract.bounded-diagnostic-projection.v1",
    total_count: 0, returned_count: 0, omitted_count: 0,
    truncated: false, diagnostics: []
  });
  const diagnostics = Array.from({ length: MAX_DIAGNOSTIC_COUNT + 20 }, (_, index) => ({
    code: `code-${index}`, pointer: `/items/${String(index).padStart(3, "0")}`,
    keyword: "const", reason_code: "stable_reason",
    expected_identity: `expected-${index}`, actual_identity: `actual-${index}`
  })).reverse();
  const first = projectBoundedDiagnostics(diagnostics);
  const second = projectBoundedDiagnostics([...diagnostics].reverse());
  assert.deepEqual(first, second);
  assert.equal(first.total_count, MAX_DIAGNOSTIC_COUNT + 20);
  assert.equal(first.returned_count, MAX_DIAGNOSTIC_COUNT);
  assert.equal(first.omitted_count, 20);
  assert.equal(first.truncated, true);
  assert.deepEqual(Object.keys(first.diagnostics[0]), [
    "code", "pointer", "claim_id", "keyword", "reason_code", "reason", "reason_truncated",
    "reasons", "total_reason_count", "returned_reason_count", "omitted_reason_count",
    "reasons_truncated", "expected_identity", "actual_identity", "message",
    "content_truncated"
  ]);
  assertProjectionBounds(first);
});

test("claim-bearing diagnostics retain bounded identities in deterministic order", () => {
  const diagnostics = ["claim-must-z", "claim-must-a", "claim-must-m"].map((claimId) => ({
    code: "mandatory_behavior_unverified",
    pointer: "/claims",
    claim_id: claimId,
    message: "mandatory behavior has no verification"
  }));
  const forward = projectBoundedDiagnostics(diagnostics);
  const reverse = projectBoundedDiagnostics([...diagnostics].reverse());

  assert.deepEqual(forward, reverse);
  assert.equal(canonicalJsonBytes(forward).toString("utf8"),
    canonicalJsonBytes(reverse).toString("utf8"));
  assert.deepEqual(forward.diagnostics.map(({ claim_id: claimId }) => claimId),
    ["claim-must-a", "claim-must-m", "claim-must-z"]);
  assertProjectionBounds(forward);

  const bounded = projectBoundedDiagnostics([{
    code: "mandatory_behavior_unverified",
    claim_id: "c".repeat(10_000)
  }]);
  const digest = createHash("sha256").update("c".repeat(10_000), "utf8").digest("hex");
  assert.equal(bounded.diagnostics[0].claim_id.endsWith(`-sha256-${digest}`), true);
  assert.equal(bounded.diagnostics[0].content_truncated, true);
  assertProjectionBounds(bounded);
});

test("production validation distinguishes bounded long claim identities in any order", () => {
  const commonPrefix = "a".repeat(5_000);
  const claimIds = {
    a: `claim-${commonPrefix}-one`,
    b: `claim-${commonPrefix}-two`
  };
  const buildContract = (order) => {
    const contract = buildAuthenticationProvenanceFixture().contract;
    contract.test_proofs = buildStableTestProofPopulation(contract);
    const propositionTemplate = contract.propositions.find(({ proposition_id: propositionId }) =>
      propositionId === "prop-evidence-authenticates-target"
    );
    assert.ok(propositionTemplate);
    for (const tag of order) {
      contract.propositions.push({
        ...structuredClone(propositionTemplate),
        proposition_id: `prop-long-claim-${tag}`
      });
      contract.claims.push({
        claim_id: claimIds[tag],
        kind: "behavior",
        modality: "MUST",
        proposition_id: `prop-long-claim-${tag}`
      });
    }
    return contract;
  };
  const validate = (order) => validateStableTestProofContract(buildContract(order)).diagnostics;
  const forward = validate(["a", "b"]);
  const reverse = validate(["b", "a"]);

  assert.equal(claimIds.a.length, 5_010);
  assert.equal(claimIds.b.length, 5_010);
  assert.equal(forward.total_count, 2);
  assert.equal(forward.returned_count, 2);
  assert.ok(forward.diagnostics.every(({ code }) =>
    code === "mandatory_behavior_unverified"));
  const projectedClaimIds = forward.diagnostics.map(({ claim_id: claimId }) => claimId);
  assert.equal(new Set(projectedClaimIds).size, 2);
  for (const sourceClaimId of Object.values(claimIds)) {
    const digest = createHash("sha256").update(sourceClaimId, "utf8").digest("hex");
    const projectedClaimId = projectedClaimIds.find((claimId) =>
      claimId.endsWith(`-sha256-${digest}`));
    assert.ok(projectedClaimId);
    assert.ok(projectedClaimId.startsWith(`claim-${commonPrefix.slice(0, 100)}`));
    assert.ok(Buffer.byteLength(JSON.stringify(projectedClaimId), "utf8") <=
      MAX_DIAGNOSTIC_FIELD_BYTES);
    assert.match(projectedClaimId, /^claim-[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  }
  assert.deepEqual(forward, reverse);
  assert.equal(canonicalJsonBytes(forward).toString("utf8"),
    canonicalJsonBytes(reverse).toString("utf8"));
  assertProjectionBounds(forward);
});

test("structured singular and plural semantic reasons remain deterministic", () => {
  assert.throws(
    () => projectBoundedDiagnostics([null]),
    /diagnostic must be an object/,
  );
  assert.throws(
    () => projectBoundedDiagnostics([{ code: "invalid-reasons", reasons: "opaque" }]),
    /diagnostic reasons must be an array/,
  );

  const none = projectBoundedDiagnostics([{ code: "none" }]).diagnostics[0];
  assert.equal(none.reason, "");
  assert.deepEqual(none.reasons, []);
  assert.deepEqual([
    none.total_reason_count, none.returned_reason_count, none.omitted_reason_count
  ], [0, 0, 0]);
  assert.equal(none.reasons_truncated, false);

  const singular = projectBoundedDiagnostics([{
    code: "singular", reason: "opposed_modality"
  }]).diagnostics[0];
  assert.equal(singular.reason, "opposed_modality");
  assert.equal(singular.reason_truncated, false);

  const one = projectBoundedDiagnostics([{
    code: "one", reasons: ["target_condition_differs"]
  }]).diagnostics[0];
  assert.deepEqual(one.reasons, ["target_condition_differs"]);
  assert.deepEqual([
    one.total_reason_count, one.returned_reason_count, one.omitted_reason_count
  ], [1, 1, 0]);

  const multiple = projectBoundedDiagnostics([{
    code: "multiple", reasons: ["z-last", "a-first", "middle", "a-first"]
  }]).diagnostics[0];
  assert.deepEqual(multiple.reasons, ["a-first", "a-first", "middle", "z-last"]);
  assert.deepEqual([
    multiple.total_reason_count,
    multiple.returned_reason_count,
    multiple.omitted_reason_count
  ], [4, 4, 0]);
  assert.equal(multiple.reasons_truncated, false);
});

test("one oversized diagnostic retains a useful bounded cause", () => {
  const result = projectBoundedDiagnostics([{ code: "oversized-cause", pointer: "/cause",
    keyword: "const", expected_identity: "expected", actual_identity: "actual",
    message: "x".repeat(70000), reasons: ["r".repeat(70000)] }]);
  assert.equal(result.total_count, 1);
  assert.equal(result.returned_count, 1);
  assert.equal(result.omitted_count, 0);
  assert.equal(result.truncated, true);
  assert.equal(result.diagnostics[0].content_truncated, true);
  assert.equal(result.diagnostics[0].code, "oversized-cause");
  assert.equal(result.diagnostics[0].pointer, "/cause");
  assert.equal(result.diagnostics[0].keyword, "const");
  assert.equal(result.diagnostics[0].expected_identity, "expected");
  assert.equal(result.diagnostics[0].actual_identity, "actual");
  assert.equal(result.diagnostics[0].total_reason_count, 1);
  assert.equal(result.diagnostics[0].returned_reason_count, 1);
  assert.equal(result.diagnostics[0].omitted_reason_count, 0);
  assert.equal(result.diagnostics[0].reasons_truncated, true);
  assert.equal(result.diagnostics[0].reasons[0].endsWith("…"), true);
  assertProjectionBounds(result);
});

test("encoded field and envelope bounds include escaping, Unicode, and truncation markers", () => {
  const nul = "\0".repeat(70000);
  const one = projectBoundedDiagnostics([{
    code: nul, pointer: nul, keyword: nul, reason_code: nul,
    reason: nul, reasons: [nul],
    expected_identity: nul, actual_identity: nul, message: nul
  }]);
  assert.equal(one.total_count, 1);
  assert.equal(one.returned_count, 1);
  assert.equal(one.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(one), "utf8") <= 65536);
  for (const field of textualFields) {
    assert.ok(Buffer.byteLength(JSON.stringify(one.diagnostics[0][field]), "utf8") <= 4096,
      field);
  }
  assert.equal(one.diagnostics[0].returned_reason_count, 1);
  assert.equal(one.diagnostics[0].reasons[0].endsWith("…"), true);

  const emoji = projectBoundedDiagnostics([{
    code: "emoji", message: "😀".repeat(2048), reasons: ["😀".repeat(2048)]
  }]);
  assert.equal(emoji.returned_count, 1);
  assert.equal(emoji.diagnostics[0].message.endsWith("…"), true);
  assert.equal(emoji.diagnostics[0].reasons[0].endsWith("…"), true);
  assert.ok(Buffer.byteLength(JSON.stringify(emoji.diagnostics[0].message), "utf8") <= 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(emoji.diagnostics[0].reasons[0]), "utf8") <=
    4096);

  const many = projectBoundedDiagnostics(Array.from({ length: 200 }, (_, index) => ({
    code: `oversized-${index}`, pointer: `/oversized/${index}`,
    message: nul, expected_identity: nul, actual_identity: nul
  })));
  assert.equal(many.total_count, 200);
  assert.ok(many.returned_count >= 1);
  assert.equal(many.omitted_count, 200 - many.returned_count);
  assert.equal(many.truncated, true);
  assertProjectionBounds(one);
  assertProjectionBounds(emoji);
  assertProjectionBounds(many);
});

test("reason populations report exact nested omission without losing the cause", () => {
  const reasons = Array.from({ length: 100 }, (_, index) =>
    `reason-${String(index).padStart(3, "0")}-${"x".repeat(4080)}`);
  const result = projectBoundedDiagnostics([{ code: "many-reasons", reasons }]);
  assert.equal(result.returned_count, 1);
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.total_reason_count, 100);
  assert.ok(diagnostic.returned_reason_count >= 1);
  assert.ok(diagnostic.omitted_reason_count >= 1);
  assert.equal(diagnostic.reasons_truncated, true);
  assert.equal(diagnostic.content_truncated, true);
  assertProjectionBounds(result);
});

test("production authentication refusal retains target_condition_differs", async () => {
  const profile = JSON.parse(await readFile(new URL(
    "../../profiles/proof.authentication.direct-source-provenance/2.0.0/profile.json",
    import.meta.url
  )));
  const weakened = structuredClone(profile);
  weakened.reference_roles.push({
    role: "alternate_attempt",
    allowed_type_terms: ["cc:event"],
    cardinality: "exactly_one"
  });
  weakened.claim_patterns.find(({ pattern_id: patternId }) =>
    patternId === "evidence-authenticates-target"
  ).proposition_template.applicability_context.operand_roles = ["alternate_attempt"];
  const fixture = buildAuthenticationProvenanceFixture({
    mutateInput(input) {
      input.reference_bindings.push({
        role: "alternate_attempt",
        reference_ids: ["ref-observation-attempt-one"]
      });
    }
  });
  const semanticDiagnostic = validateProfileSemanticsV1(weakened).find(
    ({ code }) => code === "profile_verification_falsifier_not_complementary"
  );
  assert.ok(semanticDiagnostic.reasons.includes("target_condition_differs"));
  fixture.contract.test_proofs = buildStableTestProofPopulation(fixture.contract);

  const result = evaluateVerificationProfileV1({
    profile: weakened,
    contract: fixture.contract,
    evaluation_input: fixture.input
  });
  assert.notEqual(result.satisfaction, "satisfied");
  const projectedDiagnostic = result.diagnostics.find(({ code }) =>
    code === "profile_verification_falsifier_not_complementary"
  );
  assert.ok(projectedDiagnostic);
  assert.ok(projectedDiagnostic.reasons.includes("target_condition_differs"));
  const projection = {
    diagnostic_projection_version: DIAGNOSTIC_PROJECTION_VERSION,
    total_count: result.total_count,
    returned_count: result.returned_count,
    omitted_count: result.omitted_count,
    truncated: result.truncated,
    diagnostics: result.diagnostics
  };
  assertProjectionBounds(projection);
  assert.ok(canonicalJsonBytes(result).byteLength <=
    STABLE_RESOURCE_LIMITS.projection_result_bytes);
});
