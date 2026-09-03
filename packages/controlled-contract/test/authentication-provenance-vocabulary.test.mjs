import assert from "node:assert/strict";
import test from "node:test";

import { validateAndResolveNativeContractV034 } from
  "../lib/native-contract-carrier-v034.mjs";
import { buildAuthenticationProvenanceFixture } from
  "./proof-packs/authentication-provenance-v1-fixture.mjs";

function ref(referenceId) {
  return { kind: "reference", reference_id: referenceId };
}

function addMandatory(contract, {
  id, subject, operator, context, operand, kind = "evidence"
}) {
  contract.propositions.push({
    proposition_id: `prop-${id}`,
    subject_reference_id: subject,
    operator,
    applicability_context: structuredClone(context),
    operands: [ref(operand)]
  });
  contract.claims.push({
    claim_id: `claim-${id}`,
    kind,
    modality: "MUST",
    proposition_id: `prop-${id}`
  });
}

const validate = (contract) => validateAndResolveNativeContractV034(contract);
const diagnosticCodes = (contract) => validate(contract).diagnostics.map(({ code }) => code);

test("all four positive/complement pairs contradict on the exact normalized edge", () => {
  const fixture = buildAuthenticationProvenanceFixture();
  for (const claimId of [
    "claim-verify-evidence-authenticates-target",
    "claim-verify-evidence-originates-from-source",
    "claim-verify-target-has-source-of-record",
    "claim-verify-evidence-observed-in-attempt"
  ]) {
    const verification = fixture.contract.claims.find(({ claim_id: id }) => id === claimId);
    fixture.contract.claims.push({
      claim_id: `${claimId}-asserted-falsifier`,
      kind: "evidence",
      modality: "MUST",
      proposition_id: verification.falsifying_proposition_id
    });
  }
  const result = validate(fixture.contract);
  assert.equal(result.schema_valid, true);
  assert.equal(result.diagnostics.filter(({ code }) =>
    code === "direct_proposition_contradiction").length, 4);
  assert.ok(result.diagnostics.every(({ reason }) => reason === "opposed_operator"));
});

test("functional origin and source-of-record values conflict after scope equality", () => {
  const fixture = buildAuthenticationProvenanceFixture();
  fixture.contract.references.push({
    reference_id: "ref-other-source", type_term: "cc:resource",
    identity: { kind: "durable_id", domain: "authentication-provenance-test",
      value: "other-source" }
  }, {
    reference_id: "ref-other-attempt", type_term: "cc:event",
    identity: { kind: "durable_id", domain: "authentication-provenance-test",
      value: "other-attempt" }
  });
  addMandatory(fixture.contract, {
    id: "attempts-are-equal", subject: "ref-other-attempt",
    operator: "reference:equals",
    context: { mode: "unconditional", operand_reference_ids: [] },
    operand: "ref-observation-attempt-one"
  });
  addMandatory(fixture.contract, {
    id: "conflicting-origin", subject: fixture.roleIds.evidence_occurrence,
    operator: "reference:originates_from",
    context: { mode: "during", operand_reference_ids: ["ref-other-attempt"] },
    operand: "ref-other-source"
  });
  addMandatory(fixture.contract, {
    id: "conflicting-source-record", subject: fixture.roleIds.target,
    operator: "reference:has_source_of_record",
    context: { mode: "during", operand_reference_ids: ["ref-other-attempt"] },
    operand: "ref-other-source"
  });
  assert.equal(validate(fixture.contract).diagnostics.filter(({ code, reason }) =>
    code === "direct_proposition_contradiction" &&
      reason === "conflicting_functional_value").length, 2);
});

test("equality-concealed endpoints and applicability aliases cannot hide a complement", () => {
  const fixture = buildAuthenticationProvenanceFixture();
  fixture.contract.references.push({
    reference_id: "ref-target-alias", type_term: "cc:state",
    identity: { kind: "durable_id", domain: "authentication-provenance-test",
      value: "target-alias" }
  }, {
    reference_id: "ref-attempt-alias", type_term: "cc:event",
    identity: { kind: "durable_id", domain: "authentication-provenance-test",
      value: "attempt-alias" }
  });
  addMandatory(fixture.contract, {
    id: "attempt-alias", subject: "ref-attempt-alias",
    operator: "reference:equals",
    context: { mode: "unconditional", operand_reference_ids: [] },
    operand: fixture.roleIds.observation_attempt
  });
  addMandatory(fixture.contract, {
    id: "target-alias", subject: "ref-target-alias",
    operator: "reference:equals",
    context: { mode: "during",
      operand_reference_ids: [fixture.roleIds.observation_attempt] },
    operand: fixture.roleIds.target
  });
  addMandatory(fixture.contract, {
    id: "aliased-authentication-complement",
    subject: fixture.roleIds.evidence_occurrence,
    operator: "reference:does_not_authenticate",
    context: { mode: "during", operand_reference_ids: ["ref-attempt-alias"] },
    operand: "ref-target-alias"
  });
  assert.ok(validate(fixture.contract).diagnostics.some(({ code, reason }) =>
    code === "direct_proposition_contradiction" && reason === "opposed_operator"));
});

test("equality-concealed reflexivity is rejected for the new relations", () => {
  const fixture = buildAuthenticationProvenanceFixture();
  addMandatory(fixture.contract, {
    id: "occurrence-source-alias",
    subject: fixture.roleIds.evidence_occurrence,
    operator: "reference:equals",
    context: { mode: "during",
      operand_reference_ids: [fixture.roleIds.observation_attempt] },
    operand: fixture.roleIds.source
  });
  assert.ok(diagnosticCodes(fixture.contract).includes("irreflexive_proposition"));
});

test("operator-specific types and applicability fail closed", () => {
  const wrongScope = buildAuthenticationProvenanceFixture();
  wrongScope.contract.propositions.find(({ proposition_id: id }) =>
    id === "prop-evidence-authenticates-target").applicability_context = {
    mode: "unconditional", operand_reference_ids: []
  };
  assert.equal(validate(wrongScope.contract).schema_valid, false);

  const wrongType = buildAuthenticationProvenanceFixture();
  wrongType.contract.references.find(({ reference_id: id }) =>
    id === wrongType.roleIds.evidence_occurrence).type_term = "cc:artifact";
  const result = validate(wrongType.contract);
  assert.equal(result.schema_valid, true);
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "operator_subject_type_invalid"));
});
