import test from "node:test";
import assert from "node:assert/strict";
import * as previewModule from
  "../../packages/wiki-core/src/operations/controlled-contract/required-property-preview.mjs";

const { previewRequiredPropertyCoverage: preview } = previewModule;
const subject = { wkId: "WK-2696", focus: "candidate-construction" };
const ALL_PARTS = ["authored_requirement", "same_subject_obligation",
  "qualifying_verification_support"];
const NO_AUTHORITY = { policy: false, implementation_satisfaction: false, dispatch: false,
  persistent_effects: false };
const profileTerm = (typeTerm, term) => ({ declare: { type_term: typeTerm,
  identity: { kind: "profile_term", term } } });
const behavior = (term) => ({ nature: "behavior", modality: "MUST",
  subject: profileTerm("cc:runtime_component", term),
  behavior: { relation: "boolean:exists", objects: [{ boolean: true }] } });

const verified = (term) => ({ ...behavior(term), verification: { method: "test_execution",
  verifier: profileTerm("cc:test", `${term}-test`),
  observes: { relation: "boolean:exists", objects: [{ boolean: true }] },
  fails_when: { relation: "boolean:exists", objects: [{ boolean: false }] } } });
const property = (term, provenance = { source: "synthetic-candidate-example", term },
  build = behavior) => ({ requirement: build(term), provenance });
const run = (requiredProperties, contract = null, obligations = [], on = subject) =>
  preview({ ...on, requiredProperties, contract, obligations });

const claimOf = (entry, on = subject) => run([entry], null, [], on).properties[0].claim_id;
const authoredFrom = (entries) => structuredClone(run(entries).prospective_contract);
const obligation = (claimId, extra = {}) => ({ obligation_id: `OBL-${claimId}`,
  statement: "the candidate behavior holds", controlled_contract_node_ids: [claimId], ...extra });
const byClaim = (result, claimId) => {
  const rows = result.properties.filter((row) => row.claim_id === claimId);
  assert.equal(rows.length, 1, `exactly one row for ${claimId}`);
  return rows[0];
};
const codes = (row) => row.diagnostics.map(({ code }) => code);
const deepFreeze = (value) => {
  if (value !== null && typeof value === "object") Object.values(Object.freeze(value)).forEach(deepFreeze);
  return value;
};

test("PREVIEW-REQUIRED-POPULATION: retains all three required properties despite an unrelated complete sibling", () => {
  const sibling = property("unrelated-complete-sibling", { source: "synthetic-sibling" }, verified);
  const siblingClaim = claimOf(sibling);
  const contract = authoredFrom([sibling]);
  const obligations = [obligation(siblingClaim)];

  assert.deepEqual(run([sibling], contract, obligations).counts,
    { required: 1, definition_complete: 1, missing: 0 });

  const required = ["candidate-tree-equality", "candidate-parent-cardinality",
    "candidate-fixed-fork"].map((term) => property(term));
  const requiredClaims = required.map((entry) => claimOf(entry));
  assert.equal(new Set([...requiredClaims, siblingClaim]).size, 4);
  const result = run(required, contract, obligations);
  assert.equal(result.required_count, 3);
  assert.deepEqual(result.counts, { required: 3, definition_complete: 0, missing: 3 });
  assert.equal(result.definition_complete, false);
  assert.deepEqual(result.properties.map((row) => row.claim_id), [...requiredClaims].sort());
  for (const claimId of requiredClaims) {
    const row = byClaim(result, claimId);
    assert.deepEqual(row.missing_parts, ALL_PARTS);
    assert.deepEqual(row.obligation_ids, []);
    assert.deepEqual(row.diagnostics, []);
  }

  assert.equal(result.properties.some((row) => row.claim_id === siblingClaim), false);
  assert.ok(result.prospective_contract.claims.some((claim) => claim.claim_id === siblingClaim));
  assert.deepEqual(result.authored_validation, { valid: true, diagnostics: [] });

  const tree = property("candidate-tree-equality", undefined, verified);
  const treeBehavior = requiredClaims[0];
  const partial = run(required, authoredFrom([sibling, tree]),
    [...obligations, obligation(treeBehavior)]);
  assert.deepEqual(partial.counts, { required: 3, definition_complete: 1, missing: 2 });
  assert.deepEqual(byClaim(partial, treeBehavior).missing_parts, []);
  assert.deepEqual(byClaim(partial, requiredClaims[1]).missing_parts, ALL_PARTS);
  assert.deepEqual(byClaim(partial, requiredClaims[2]).missing_parts, ALL_PARTS);
  assert.deepEqual(result.authority, NO_AUTHORITY);
});

test("PREVIEW-COMPILER-IDENTITY: uses exact compiler identities and native verification semantics", () => {
  assert.deepEqual(Object.keys(previewModule), ["previewRequiredPropertyCoverage"]);
  const entry = property("candidate-tree-equality", undefined, verified);
  const claimId = claimOf(entry);
  const contract = authoredFrom([entry]);
  const complete = run([entry], contract, [obligation(claimId)]);
  assert.equal(complete.compiler.identity, "compileControlledContractRequirements");
  assert.equal(byClaim(complete, claimId).definition_complete, true);

  assert.notEqual(claimOf(entry, { ...subject, focus: "other-focus" }), claimId);
  const should = { ...entry, requirement: { ...entry.requirement, modality: "SHOULD" } };
  assert.notEqual(claimOf(should), claimId);
  assert.deepEqual(run([should], contract, [obligation(claimId)]).properties[0].missing_parts,
    ALL_PARTS);

  const supplementary = structuredClone(contract);
  supplementary.claims.find((claim) => claim.kind === "verification").modality = "SHOULD";
  const stated = property("candidate-tree-equality");
  assert.equal(claimOf(stated), claimId);
  const weak = byClaim(run([stated], supplementary, [obligation(claimId)]), claimId);
  assert.deepEqual(weak.missing_parts, ["qualifying_verification_support"]);
  assert.ok(codes(weak).includes("mandatory_behavior_unverified"));

  for (const authored of [null, authoredFrom([property("unrelated-complete-sibling")])]) {
    const injected = run([entry], authored, [obligation(claimId)]);
    assert.ok(injected.graph.facts.verified_behavior_claim_ids.includes(claimId));
    const row = byClaim(injected, claimId);
    assert.deepEqual(row.missing_parts, ALL_PARTS);
    assert.deepEqual(codes(row).filter((code) => code.startsWith("obligation_coverage_")),
      [authored === null ? "obligation_coverage_contract_unavailable"
        : "obligation_coverage_node_unknown"]);
  }
});

test("PREVIEW-DEFINITION-COMPLETENESS: complete definitions require no runtime bindings or executed evidence", () => {
  const entry = property("candidate-parent-equality", { source: "synthetic" }, verified);
  const claimId = claimOf(entry);
  const contract = authoredFrom([entry]);

  assert.deepEqual(contract.test_proofs, []);
  const result = run([entry], contract, [obligation(claimId)]);
  assert.equal(result.definition_complete, true);
  assert.deepEqual(result.counts, { required: 1, definition_complete: 1, missing: 0 });
  const row = byClaim(result, claimId);
  assert.deepEqual({ authored: row.authored_requirement, obligation: row.same_subject_obligation,
    verification: row.qualifying_verification_support, missing: row.missing_parts,
    obligations: row.obligation_ids, diagnostics: row.diagnostics, uncertainty: row.uncertainty,
    repair: row.repair }, { authored: true, obligation: true, verification: true, missing: [],
    obligations: [`OBL-${claimId}`], diagnostics: [], uncertainty: null, repair: null });
  assert.deepEqual(result.prospective_contract.test_proofs, []);
  assert.deepEqual(result.authority, NO_AUTHORITY);
});

test("PREVIEW-REPEAT-OUTPUT: repeated preview is deterministic and adds no duplicate requirements", () => {
  const entries = [property("candidate-tree-equality"),
    property("candidate-parent-cardinality", undefined, verified)];
  const first = run(entries);
  assert.deepEqual(run(entries), first);
  assert.equal(JSON.stringify(run(entries)), JSON.stringify(first));
  assert.equal(first.compiler.generated_claim_count, 3);

  const repeat = run(entries, structuredClone(first.prospective_contract));
  assert.equal(repeat.compiler.generated_claim_count, 0);
  assert.deepEqual(repeat.prospective_contract, first.prospective_contract);
  assert.deepEqual(repeat.graph, first.graph);
  assert.equal(repeat.required_count, 2);

  const reversed = run([...entries].reverse());
  assert.deepEqual(reversed.properties.map(({ property_index: _, ...row }) => row),
    first.properties.map(({ property_index: _, ...row }) => row));
});

test("PREVIEW-SUPPORT-DIAGNOSTICS: removing each supporting relationship reopens only its property gap", () => {
  const entries = ["candidate-diagnostic-boundary", "candidate-untouched-neighbor"].map((term) =>
    property(term, undefined, verified));
  const [target, neighbor] = entries.map((entry) => claimOf(entry));
  const complete = authoredFrom(entries);
  const rows = [obligation(target), obligation(neighbor)];
  assert.deepEqual(run(entries, complete, rows).counts,
    { required: 2, definition_complete: 2, missing: 0 });
  const relation = complete.relations.find((row) => row.target_claim_id === target);
  const verifier = complete.claims.find((claim) => claim.claim_id === relation.source_claim_id);
  const supplied = { code: "wrong_subject", subject: "WK-other" };
  const cases = [
    ["obligation removed", {}, [rows[1]], ["same_subject_obligation"], []],
    ["verifies relation removed", { relations: (list) => list.filter((row) => row !== relation) },
      rows, ["qualifying_verification_support"], ["mandatory_behavior_unverified"]],
    ["authored requirement removed", { claims: (list) => list.filter((claim) =>
      claim.claim_id !== target) }, rows, ALL_PARTS,
    ["obligation_coverage_node_unknown", "dangling_relation_target"]],
    ["falsifying proposition removed", { propositions: (list) => list.filter((row) =>
      row.proposition_id !== verifier.falsifying_proposition_id) }, rows,
    ["qualifying_verification_support"], ["dangling_falsifying_proposition"]],
    ["obligation names an absent node", {}, [obligation(target,
      { controlled_contract_node_ids: [target, "claim-absent"] }), rows[1]],
    ["same_subject_obligation"], ["obligation_coverage_node_unknown"]],
    ["obligation has no statement", {}, [obligation(target, { statement: "" }), rows[1]],
      ["same_subject_obligation"], ["obligation_coverage_statement_missing"]],
    ["obligation of another work unit", {}, [obligation(target,
      { wk_id: "WK-other", diagnostics: [supplied] }), rows[1]],
    ["same_subject_obligation"], ["wrong_subject"]],
    ["obligation of another focus", {}, [obligation(target, { focus: "other-focus" }), rows[1]],
      ["same_subject_obligation"], []],
    ["obligation names only the neighbor", {}, [obligation(neighbor,
      { obligation_id: "OBL-second" }), rows[1]], ["same_subject_obligation"], []]
  ];
  for (const [name, edits, obligations, missing, expectedCodes] of cases) {
    const contract = structuredClone(complete);
    for (const [population, edit] of Object.entries(edits)) {
      contract[population] = edit(complete[population]).map((row) => structuredClone(row));
    }
    const result = run(entries, contract, obligations);
    const row = byClaim(result, target);
    assert.deepEqual(row.missing_parts, missing, name);
    assert.equal(row.definition_complete, false, name);
    for (const code of expectedCodes) assert.ok(codes(row).includes(code), `${name}: ${code}`);
    if (expectedCodes.length === 0) assert.deepEqual(row.diagnostics, [], name);

    assert.deepEqual(result.counts, { required: 2, definition_complete: 1, missing: 1 }, name);
    assert.deepEqual(byClaim(result, neighbor).missing_parts, [], name);
    assert.deepEqual(byClaim(result, neighbor).diagnostics, [], name);
  }
  const wrongUnit = run(entries, complete, cases[6][2]);
  assert.deepEqual(byClaim(wrongUnit, target).diagnostics, [supplied]);
  const dangling = byClaim(run(entries, complete, cases[4][2]), target).diagnostics;
  assert.deepEqual(dangling.map(({ code, path }) => ({ code, path })), [{
    code: "obligation_coverage_node_unknown", path: "/obligations/0/controlled_contract_node_ids" }]);
});

test("PREVIEW-IDENTITY-INTEGRITY: a retained identity with other content is refused, never credited", () => {
  const cardinality = (count, modality = "MUST") => ({ requirement: { nature: "behavior", modality,
    subject: profileTerm("cc:population", "candidate-parents"),
    behavior: { relation: "number:has_cardinality", objects: [{ number: count }] } },
  provenance: { source: "synthetic-parent-cardinality" } });
  const withCheck = (entry) => ({ ...entry, requirement: { ...verified("candidate-parents"),
    ...entry.requirement } });
  const required = cardinality(1);
  const claimId = claimOf(required);
  const complete = authoredFrom([withCheck(required)]);
  const rows = [obligation(claimId)];

  assert.deepEqual(run([required], complete, rows).counts,
    { required: 1, definition_complete: 1, missing: 0 });
  const claim = complete.claims.find((row) => row.claim_id === claimId);
  const refused = (contract, population, identity, entries = [required]) => {
    const before = structuredClone(contract);
    assert.throws(() => run(entries, contract, rows), (error) => {
      assert.equal(error.name, "ControlledContractToolError");
      assert.equal(error.code, "required_property_contract_identity_inconsistent");
      const position = contract[population].findIndex((row) =>
        Object.values(row).includes(identity));
      assert.deepEqual(error.details.inconsistent_nodes, [{ population, identity,
        field: `contract.${population}[${position}]`, property_index: 0 }]);
      assert.equal(error.details.field, `contract.${population}[${position}]`);
      assert.deepEqual(error.details.subject, { wk_id: subject.wkId, focus: subject.focus });
      assert.equal(error.details.effects, "none");
      assert.equal(error.details.responsible_owner, "caller supplying the authored native contract");
      assert.ok(error.details.repair.length > 0);
      return true;
    });
    assert.deepEqual(contract, before);
  };
  const edited = (edit) => {
    const contract = structuredClone(complete);
    edit(contract);
    return contract;
  };

  const two = edited((contract) => {
    contract.propositions.find((row) => row.proposition_id === claim.proposition_id)
      .operands[0].value = 2;
  });
  refused(two, "propositions", claim.proposition_id);

  refused(edited((contract) => {
    contract.claims.find((row) => row.claim_id === claimId).modality = "SHOULD";
  }), "claims", claimId);

  const subjectId = complete.propositions.find((row) =>
    row.proposition_id === claim.proposition_id).subject_reference_id;
  refused(edited((contract) => {
    contract.references.find((row) => row.reference_id === subjectId).identity.term = "other";
  }), "references", subjectId);

  const stated = withCheck(required);
  const relation = complete.relations.find((row) => row.target_claim_id === claimId);
  refused(edited((contract) => {
    contract.relations.find((row) => row.relation_id === relation.relation_id)
      .target_claim_id = relation.source_claim_id;
  }), "relations", relation.relation_id, [stated]);

  const authoredTwo = authoredFrom([withCheck(cardinality(2))]);
  assert.deepEqual(run([required], authoredTwo, rows).properties[0].missing_parts, ALL_PARTS);
  assert.deepEqual(run([cardinality(2)], authoredTwo, [obligation(claimOf(cardinality(2)))]).counts,
    { required: 1, definition_complete: 1, missing: 0 });

  const reverified = authoredFrom([{ ...required, requirement: { ...required.requirement,
    verification: { ...verified("candidate-parents").verification, method: "analysis" } } }]);
  assert.ok(reverified.claims.some((row) => row.claim_id === claimId));
  assert.equal(reverified.claims.some((row) => row.claim_id === relation.source_claim_id), false);
  assert.deepEqual(run([required], reverified, rows).counts,
    { required: 1, definition_complete: 1, missing: 0 });

  const selecting = { ...required, requirement: { ...required.requirement,
    subject: { select: subjectId } } };
  assert.equal(claimOf(required), run([selecting], complete, rows).properties[0].claim_id);
  assert.deepEqual(run([selecting], complete, rows).counts,
    { required: 1, definition_complete: 1, missing: 0 });
});

test("PREVIEW-FAILURE-RECOVERY: invalid inputs preserve diagnostics and actionable recovery", () => {
  const entry = property("candidate-recovery");
  const valid = { ...subject, requiredProperties: [entry], contract: null, obligations: [] };
  const owner = { input: "caller supplying the required-property preview input",
    subject: "caller supplying the required-property preview subject",
    population: "caller supplying the required property population",
    contract: "caller supplying the authored native contract",
    obligations: "caller supplying saved obligations",
    compiler: "controlled-contract requirement compiler" };
  const { contract: _contract, ...withoutContract } = valid;
  const { wkId: _wkId, ...withoutSubject } = valid;
  const cases = [
    [null, "required_property_preview_invalid", undefined, owner.input],
    [[valid], "required_property_preview_invalid", undefined, owner.input],
    [withoutSubject, "required_property_preview_invalid", "wkId", owner.subject],
    [{ ...withoutSubject, wk_id: "WK-2696" }, "required_property_preview_invalid", "wk_id", owner.input],
    [{ ...valid, obligationRows: [] }, "required_property_preview_invalid", "obligationRows", owner.input],
    [{ ...valid, requiredProperties: [] }, "required_property_population_invalid",
      "requiredProperties", "caller supplying applicability"],
    [{ ...valid, requiredProperties: [entry, null] }, "required_property_entry_invalid",
      "requiredProperties[1]", owner.population],
    [{ ...valid, requiredProperties: [{ requirement: null, provenance: null }] },
      "required_property_entry_invalid", "requiredProperties[0].requirement", owner.population],
    [{ ...valid, requiredProperties: [{ ...entry, source: "synthetic" }] },
      "required_property_entry_invalid", "requiredProperties[0].source", owner.population],

    [{ ...valid, requiredProperties: [entry.requirement] }, "required_property_entry_invalid",
      "requiredProperties[0].behavior", owner.population],
    [{ ...valid, obligations: null }, "required_property_preview_invalid", "obligations",
      owner.obligations],
    [{ ...valid, obligations: [null] }, "required_property_obligation_invalid", "obligations[0]",
      owner.obligations],
    [withoutContract, "required_property_contract_invalid", "contract", owner.contract],
    [{ ...valid, contract: {} }, "required_property_contract_invalid", "contract", owner.contract],
    [{ ...valid, requiredProperties: [{ ...entry,
      requirement: { ...entry.requirement, modality: "WILL" } }] },
    "controlled_contract_requirement_invalid", "requirements[0].modality", owner.compiler]
  ];
  for (const [input, code, field, responsibleOwner] of cases) {
    const before = structuredClone(input);
    assert.throws(() => preview(input), (error) => {
      const label = `${code} at ${field}`;
      assert.equal(error.name, "ControlledContractToolError", label);
      assert.equal(error.code, code, label);
      assert.equal(error.details.field, field, label);
      assert.equal(error.details.effects, "none", label);
      assert.equal(error.details.responsible_owner, responsibleOwner, label);
      assert.equal(typeof error.details.uncertainty, "string", label);
      assert.ok(error.details.repair.length > 0, label);
      if (input?.wkId !== undefined) assert.deepEqual(error.details.subject,
        { wk_id: subject.wkId, focus: subject.focus }, label);
      return true;
    });
    assert.deepEqual(input, before);
  }

  assert.throws(() => preview({ ...valid, contract: {} }), ({ details }) =>
    details.schema_errors.length > 0 && details.schema_errors.every((entry) =>
      entry.code === "stable_contract_schema_invalid"));
  assert.throws(() => preview(cases.at(-1)[0]), ({ details }) =>
    details.rejected_value === "WILL" && details.accepted_alternatives.includes("MUST") &&
    details.changed === false);

  assert.deepEqual(preview(valid).properties[0].missing_parts, ALL_PARTS);
});

test("PREVIEW-PROVENANCE-AND-COUNTS: reports complete provenance exact counts and no authority", () => {
  const population = [property("candidate-tree-equality", { source: "synthetic-tree", clause: "c1" }),
    property("candidate-parent-cardinality", { source: "synthetic-parent", clause: "c2" }),
    property("candidate-fixed-fork", { source: "synthetic-fork", clause: "c3" })];

  const expected = new Map(population.map((entry) => [claimOf(entry), entry.provenance]));
  assert.equal(expected.size, 3);
  for (const supplied of [population, [...population].reverse(),
    [population[1], population[2], population[0]]]) {
    const result = run(supplied);
    assert.deepEqual(result.counts, { required: 3, definition_complete: 0, missing: 3 });
    assert.equal(result.required_count, 3);
    assert.equal(result.definition_complete_count, 0);
    assert.equal(result.properties.length, 3);
    for (const [claimId, provenance] of expected) {
      const row = byClaim(result, claimId);
      assert.deepEqual(row.provenance, provenance);
      assert.equal(supplied[row.property_index].provenance, provenance);
    }
    assert.equal(result.provenance_kind, "supplied_prototype_input");
    assert.deepEqual(result.authority, NO_AUTHORITY);
  }

  const twice = run([population[0], property("candidate-tree-equality", { source: "second" })]);
  assert.deepEqual(twice.counts, { required: 1, definition_complete: 0, missing: 1 });
  assert.deepEqual(twice.properties[0].provenance,
    [{ source: "synthetic-tree", clause: "c1" }, { source: "second" }]);
});

test("PREVIEW-NONMUTATION: preview leaves inputs and persistent state unchanged", () => {
  const entries = [property("candidate-immutable", undefined, verified),
    property("candidate-immutable-unauthored")];
  const claimId = claimOf(entries[0]);
  const input = { ...subject, requiredProperties: entries, contract: authoredFrom([entries[0]]),
    obligations: [obligation(claimId, { diagnostics: [{ code: "caller_note" }] })] };
  const before = structuredClone(input);

  const result = preview(deepFreeze(input));
  assert.deepEqual(input, before);
  assert.deepEqual(result.counts, { required: 2, definition_complete: 1, missing: 1 });

  assert.notEqual(result.prospective_contract.claims[0], input.contract.claims[0]);
  assert.notEqual(byClaim(result, claimId).provenance, entries[0].provenance);
  assert.notEqual(byClaim(result, claimId).diagnostics[0], input.obligations[0].diagnostics[0]);
  assert.throws(() => { result.counts.required = 0; }, TypeError);
  assert.deepEqual(result.authority, NO_AUTHORITY);
});

test("PREVIEW-REQUIRED-PROOF: a policy-required proof is a generated destination only its exact selection closes", () => {
  const selection = { proof_name: "proof.synthetic.example", proof_version: "1.0.0",
    profile_digest: "digest-profile", parameter_contract_digest: "digest-parameters",
    admission_digest: "digest-admission",
    parameters: { operation: { kind: "profile_term", term: "candidate.write" },
      effect_subject: { kind: "profile_term", term: "candidate.store" } } };
  const requiring = (term, requiredProof = { selection, unresolved_parameters: [] }, provenance) =>
    ({ ...property(term, provenance, verified), requiredProof });
  const entries = [requiring("candidate-proved"), property("candidate-plain", undefined, verified)];
  const [proved, plain] = entries.map((entry) => claimOf(entry));
  const contract = authoredFrom(entries);
  const rows = (first = {}) => [obligation(proved, first), obligation(plain)];
  const proofOf = (result) => byClaim(result, proved).required_proofs[0];

  const empty = run(entries);
  assert.deepEqual(empty.counts, { required: 2, definition_complete: 0, missing: 2 });
  assert.deepEqual(byClaim(empty, proved).missing_parts, [...ALL_PARTS, "required_proof_selection"]);
  assert.deepEqual(proofOf(empty), { origin: "policy_generated",
    provenance: [entries[0].provenance], status: "missing", selection, unresolved_parameters: [],
    obligation_ids: [], mismatches: [] });
  assert.equal(byClaim(empty, proved).required_proof_selection, false);

  assert.deepEqual(byClaim(empty, plain).missing_parts, ALL_PARTS);
  assert.deepEqual(byClaim(empty, plain).required_proofs, []);
  assert.equal(byClaim(empty, plain).required_proof_selection, null);

  const complete = run(entries, contract, rows({ selection }));
  assert.deepEqual(complete.counts, { required: 2, definition_complete: 2, missing: 0 });
  assert.equal(proofOf(complete).status, "declared");
  assert.deepEqual(proofOf(complete).obligation_ids, [`OBL-${proved}`]);
  assert.deepEqual(complete.prospective_contract.test_proofs, []);

  assert.equal(proofOf(run(entries, contract, rows({ selection: { ...selection,
    parameters: { ...selection.parameters, first_input: { kind: "profile_term", term: "x" } } } })))
    .status, "declared");

  const without = (name) => Object.fromEntries(Object.entries(selection.parameters)
    .filter(([key]) => key !== name));
  const cases = [
    ["selection removed", rows(), "missing", ["proof_unselected"]],
    ["proof declined", rows({ proof_opt_out: true }), "missing", ["proof_opted_out"]],
    ["another proof", rows({ selection: { ...selection, proof_name: "proof.synthetic.other" } }),
      "mismatched", ["proof_name_mismatch"]],
    ["another definition pin", rows({ selection: { ...selection, admission_digest: "other" } }),
      "mismatched", ["proof_pin_mismatch"]],
    ["another version", rows({ selection: { ...selection, proof_version: "2.0.0" } }),
      "mismatched", ["proof_pin_mismatch"]],
    ["required parameter absent", rows({ selection: { ...selection,
      parameters: without("effect_subject") } }), "mismatched", ["parameter_missing"]],
    ["controlled parameter differs", rows({ selection: { ...selection, parameters: {
      ...selection.parameters, operation: { kind: "profile_term", term: "candidate.read" } } } }),
    "mismatched", ["parameter_mismatch"]],
    ["selection on the sibling only", [obligation(proved), obligation(plain, { selection })],
      "missing", ["proof_unselected"]],
    ["selection on another work unit's row", [obligation(proved),
      obligation(proved, { obligation_id: "OBL-foreign", wk_id: "WK-other", selection }),
      obligation(plain)], "missing", ["proof_unselected"]],
    ["selection on a row that is no obligation", [obligation(proved),
      obligation(proved, { obligation_id: "OBL-unstated", statement: "", selection }),
      obligation(plain)], "mismatched", ["proof_unselected", "obligation_not_qualifying"]],

    ["partial selections on two rows", [
      obligation(proved, { selection: { ...selection, parameters: without("effect_subject") } }),
      obligation(proved, { obligation_id: "OBL-second",
        selection: { ...selection, parameters: without("operation") } }), obligation(plain)],
    "mismatched", ["parameter_missing", "parameter_missing"]]
  ];
  for (const [name, obligations, status, expectedCodes] of cases) {
    const result = run(entries, contract, obligations);
    const row = byClaim(result, proved);
    assert.equal(row.required_proofs[0].status, status, name);
    assert.deepEqual(row.required_proofs[0].mismatches.map(({ code }) => code), expectedCodes, name);
    assert.deepEqual(row.required_proofs[0].obligation_ids, [], name);
    assert.deepEqual(row.missing_parts, ["required_proof_selection"], name);

    assert.deepEqual(result.counts, { required: 2, definition_complete: 1, missing: 1 }, name);
    assert.deepEqual(byClaim(result, plain).missing_parts, [], name);
  }
  assert.deepEqual(proofOf(run(entries, contract, cases[3][1])).mismatches,
    [{ obligation_id: `OBL-${proved}`, code: "proof_pin_mismatch", field: "admission_digest" }]);

  const open = [requiring("candidate-proved", { selection: { ...selection,
    parameters: without("effect_subject") }, unresolved_parameters: ["effect_subject"] }), entries[1]];
  const unresolved = run(open, contract, rows({ selection }));
  assert.equal(proofOf(unresolved).status, "unresolved");
  assert.deepEqual(proofOf(unresolved).unresolved_parameters, ["effect_subject"]);
  assert.deepEqual(byClaim(unresolved, proved).missing_parts, ["required_proof_selection"]);
  assert.deepEqual(unresolved.counts, { required: 2, definition_complete: 1, missing: 1 });

  const twice = run([entries[0], requiring("candidate-proved", undefined, { source: "second" }),
    entries[1]], contract, rows({ selection }));
  assert.equal(twice.required_count, 2);
  assert.equal(byClaim(twice, proved).required_proofs.length, 1);
  assert.deepEqual(proofOf(twice).provenance, [entries[0].provenance, { source: "second" }]);
  assert.deepEqual(run(entries, structuredClone(complete.prospective_contract), rows({ selection })),
    complete);

  const reordered = { unresolved_parameters: [], selection: { parameters: {
    effect_subject: { term: "candidate.store", kind: "profile_term" },
    operation: { term: "candidate.write", kind: "profile_term" } },
  admission_digest: "digest-admission", parameter_contract_digest: "digest-parameters",
  profile_digest: "digest-profile", proof_version: "1.0.0", proof_name: "proof.synthetic.example" } };
  assert.notEqual(JSON.stringify(reordered.selection), JSON.stringify(selection));
  const regrouped = run([entries[0], requiring("candidate-proved", reordered, { source: "reordered" }),
    entries[1]], contract, rows({ selection }));
  assert.deepEqual(regrouped.counts, complete.counts);
  assert.equal(byClaim(regrouped, proved).required_proofs.length, 1);
  assert.deepEqual(proofOf(regrouped).provenance, [entries[0].provenance, { source: "reordered" }]);
  assert.equal(proofOf(regrouped).status, "declared");
  assert.deepEqual(proofOf(regrouped).obligation_ids, proofOf(complete).obligation_ids);

  const narrowed = structuredClone(reordered);
  narrowed.selection.parameters.operation.term = "candidate.read";
  assert.deepEqual(byClaim(run([entries[0], requiring("candidate-proved", narrowed), entries[1]],
    contract, rows({ selection })), proved).required_proofs.map(({ status }) => status),
  ["declared", "mismatched"]);

  const other = { selection: { ...selection, proof_name: "proof.synthetic.other" },
    unresolved_parameters: [] };
  const both = byClaim(run([entries[0], requiring("candidate-proved", other), entries[1]], contract,
    rows({ selection })), proved);
  assert.deepEqual(both.required_proofs.map(({ status }) => status), ["declared", "mismatched"]);
  assert.deepEqual(both.missing_parts, ["required_proof_selection"]);

  for (const [requiredProof, field] of [
    [null, "requiredProperties[0].requiredProof"],
    [{ selection }, "requiredProperties[0].requiredProof.unresolved_parameters"],
    [{ selection: { ...selection, admission_digest: "" }, unresolved_parameters: [] },
      "requiredProperties[0].requiredProof.selection.admission_digest"],
    [{ selection: { ...selection, parameters: null }, unresolved_parameters: [] },
      "requiredProperties[0].requiredProof.selection.parameters"],
    [{ selection: { ...selection, name: "x" }, unresolved_parameters: [] },
      "requiredProperties[0].requiredProof.selection.name"]
  ]) {
    assert.throws(() => run([requiring("candidate-proved", requiredProof)]), (error) => {
      assert.equal(error.code, "required_property_entry_invalid", field);
      assert.equal(error.details.field, field);
      assert.equal(error.details.effects, "none");
      return true;
    });
  }
});
