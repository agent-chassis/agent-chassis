import test from "node:test";
import assert from "node:assert/strict";
import { previewRequiredPropertyCoverage } from
  "../../packages/wiki-core/src/operations/controlled-contract/required-property-preview.mjs";

const subject = { wkId: "WK-2696", focus: "candidate-construction" };
const behavior = (term) => ({ nature: "behavior", modality: "MUST",
  subject: { declare: { type_term: "cc:runtime_component",
    identity: { kind: "profile_term", term } } },
  behavior: { relation: "boolean:exists", objects: [{ boolean: true }] } });

function property(term, provenance = { source: "synthetic-candidate-example", term }) {
  return { requirement: behavior(term), provenance };
}

test("PREVIEW-REQUIRED-POPULATION: retains all three required properties despite an unrelated complete sibling", () => {
  const sibling = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [property("unrelated-complete-sibling")], contract: null, obligations: [] });
  const siblingClaim = sibling.properties[0].claim_id;
  const seed = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [property("candidate-tree-equality"),
      property("candidate-parent-cardinality"), property("candidate-fixed-fork")],
    contract: sibling.prospective_contract,
    obligations: [{ obligation_id: "OBL-unrelated-complete", statement: "covers sibling",
      controlled_contract_node_ids: [siblingClaim] }] });
  const result = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [property("candidate-tree-equality"),
      property("candidate-parent-cardinality"), property("candidate-fixed-fork")],
    contract: sibling.prospective_contract,
    obligations: [{ obligation_id: "OBL-unrelated-complete", statement: "covers sibling",
      controlled_contract_node_ids: [siblingClaim] }] });
  assert.equal(seed.properties.filter((row) => row.claim_id === siblingClaim)[0]?.claim_id,
    siblingClaim);
  assert.equal(result.required_count, 3);
  assert.equal(result.definition_complete_count, 0);
  assert.deepEqual(result.properties.map((row) => row.missing_parts), [
    ["authored_requirement", "same_subject_obligation", "qualifying_verification_support"],
    ["authored_requirement", "same_subject_obligation", "qualifying_verification_support"]
  ]);
  assert.equal(result.authority.dispatch, false);
});

test("PREVIEW-COMPILER-IDENTITY: uses exact compiler identities and native verification semantics", () => {
  const seed = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [property("candidate-tree-equality")], contract: null, obligations: [] });
  const claimId = seed.properties[0].claim_id;
  const result = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [property("candidate-tree-equality")], contract: seed.prospective_contract,
    obligations: [{ obligation_id: "OBL-unrelated", statement: "other behavior",
      controlled_contract_node_ids: ["claim-not-the-required-property"] }] });
  assert.equal(result.properties[0].claim_id, claimId);
  assert.equal(result.properties[0].authored_requirement, true);
  assert.equal(result.properties[0].same_subject_obligation, false);
  assert.equal(result.properties[0].definition_complete, false);
});

test("PREVIEW-DEFINITION-COMPLETENESS: complete definitions require no runtime bindings or executed evidence", () => {
  const required = { ...behavior("candidate-parent-equality"), verification: {
    method: "test_execution", verifier: { declare: { type_term: "cc:test",
      identity: { kind: "profile_term", term: "candidate-test" } } },
    observes: { relation: "boolean:exists", objects: [{ boolean: true }] },
    fails_when: { relation: "boolean:exists", objects: [{ boolean: false }] }
  } };
  const seed = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [{ requirement: required, provenance: { source: "synthetic" } }],
    contract: null, obligations: [] });
  const claimId = seed.properties[0].claim_id;
  const result = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [{ requirement: required, provenance: { source: "synthetic" } }],
    contract: seed.prospective_contract,
    obligations: [{ obligation_id: "OBL-parent-equality", statement: "checks candidate parent",
      controlled_contract_node_ids: [claimId] }] });
  assert.equal(result.definition_complete, true);
  assert.equal(result.properties[0].qualifying_verification_support, true);
  assert.equal(result.authority.implementation_satisfaction, false);
  assert.equal(result.authority.dispatch, false);
});

test("PREVIEW-REPEAT-OUTPUT: repeated preview is deterministic and adds no duplicate requirements", () => {
  const input = { ...subject, requiredProperties: [property("candidate-tree-equality")],
    contract: null, obligations: [] };
  const before = structuredClone(input);
  const first = previewRequiredPropertyCoverage(input);
  const second = previewRequiredPropertyCoverage(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
  assert.equal(first.compiler.generated_claim_count, 1);
});

test("PREVIEW-SUPPORT-DIAGNOSTICS: removing each supporting relationship reopens only its property gap", () => {
  const seed = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [property("candidate-diagnostic-boundary")], contract: null,
    obligations: [] });
  const claimId = seed.properties[0].claim_id;
  const result = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [property("candidate-diagnostic-boundary")],
    contract: seed.prospective_contract,
    obligations: [{ wk_id: "WK-other", focus: subject.focus,
      obligation_id: "OBL-wrong-subject", statement: "wrong candidate subject",
      controlled_contract_node_ids: [claimId],
      diagnostics: [{ code: "wrong_subject", subject: "WK-other" }] }] });
  assert.equal(result.properties[0].same_subject_obligation, false);
  assert.deepEqual(result.properties[0].diagnostics, [
    { code: "wrong_subject", subject: "WK-other" }
  ]);
  const dangling = previewRequiredPropertyCoverage({ ...subject,
    requiredProperties: [property("candidate-dangling-obligation")],
    contract: seed.prospective_contract,
    obligations: [{ obligation_id: "OBL-dangling", statement: "references an absent node",
      controlled_contract_node_ids: [claimId, "claim-absent"] }] });
  assert.equal(dangling.properties[0].same_subject_obligation, false);
  assert.ok(dangling.properties[0].diagnostics.some(({ code }) =>
    code === "obligation_coverage_node_unknown"));
});

test("PREVIEW-FAILURE-RECOVERY: invalid inputs preserve diagnostics and actionable recovery", () => {
  assert.throws(() => previewRequiredPropertyCoverage({
    requiredProperties: [property("candidate-missing-subject")], obligations: []
  }), (error) => {
    assert.equal(error.code, "required_property_preview_invalid");
    assert.equal(error.details.field, "wkId");
    assert.equal(error.details.effects, "none");
    assert.equal(error.details.responsible_owner,
      "caller supplying the required-property preview subject");
    return true;
  });
});

test("PREVIEW-PROVENANCE-AND-COUNTS: reports complete provenance exact counts and no authority", () => {
  const population = [property("candidate-tree-equality", { source: "synthetic-tree", clause: "c1" }),
    property("candidate-parent-cardinality", { source: "synthetic-parent", clause: "c2" }),
    property("candidate-fixed-fork", { source: "synthetic-fork", clause: "c3" })];
  const result = previewRequiredPropertyCoverage({ ...subject, requiredProperties: population,
    contract: null, obligations: [] });
  assert.deepEqual(result.counts, { required: 3, definition_complete: 0, missing: 3 });
  assert.equal(result.required_count, 3);
  assert.deepEqual(result.properties.map((entry) => entry.provenance), [
    { source: "synthetic-tree", clause: "c1" },
    { source: "synthetic-parent", clause: "c2" },
    { source: "synthetic-fork", clause: "c3" }
  ]);
  assert.deepEqual(result.authority, { policy: false, implementation_satisfaction: false,
    dispatch: false, persistent_effects: false });
});

test("PREVIEW-NONMUTATION: preview leaves inputs and persistent state unchanged", () => {
  const input = { ...subject, requiredProperties: [property("candidate-immutable")],
    contract: null, obligations: [] };
  const before = structuredClone(input);
  const result = previewRequiredPropertyCoverage(input);
  assert.deepEqual(input, before);
  assert.equal(result.authority.persistent_effects, false);
});
