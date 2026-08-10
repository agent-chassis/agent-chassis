
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import Ajv from "ajv";

import {
  BASE_SCHEMA,
  bindGeneralSchema,
  buildReferenceCatalog,
  evaluateGeneralContract,
  normalizeGeneralPayload,
  numbersInSource,
  segmentCriterion,
  unresolvedIdentityMentions
} from "./controlled-contract-general-v026.mjs";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const context = { mode: "unconditional", operand_reference_ids: [] };

function payload() {
  return {
    schema_version: "controlled-contract-general.experimental.v0.26",
    vocabulary_version: "cv.experimental.0.26",
    profile_id: "general-controlled-contract.experimental.v0.26",
    variables: [],
    requirements: [],
    requirement_sets: [],
    collections: [],
    claims: [],
    relations: []
  };
}

test("v0.26 static grammar contains no development-WK vocabulary", () => {
  const serialized = JSON.stringify(BASE_SCHEMA);
  for (const forbidden of [
    "WK-1924",
    "SLICE-044",
    "FIFO",
    "caller-selected",
    "fallback",
    "stdio-mcp-conduit-channel.mjs",
    "write_scope",
    "expected_edit_targets",
    "work_kind"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("v0.26 static grammar retains the domain-neutral contract ontology", () => {
  const variableTypes = new Set(BASE_SCHEMA.$defs.variable.properties.type_term.enum);
  for (const type of [
    "cc:scope", "cc:requirement", "cc:invariant", "cc:evidence",
    "cc:conflict", "cc:escalation", "cc:authority", "cc:operation"
  ]) {
    assert.equal(variableTypes.has(type), true, type);
  }
  const predicates = new Set([
    ...BASE_SCHEMA.$defs.reference_claim.properties.predicate.enum,
    ...BASE_SCHEMA.$defs.boolean_claim.properties.predicate.enum,
    ...BASE_SCHEMA.$defs.number_claim.properties.predicate.enum,
    ...BASE_SCHEMA.$defs.range_claim.properties.predicate.enum
  ]);
  for (const predicate of [
    "depends_on", "supports", "conflicts_with", "allows", "blocks",
    "requests_authorization", "escalates_to", "authorizes", "approves", "performs", "replaces"
  ]) {
    assert.equal(predicates.has(predicate), true, predicate);
  }
});

test("v0.26 structural productions make illegal claim field combinations unavailable", () => {
  assert.equal("claims" in BASE_SCHEMA.properties, false);
  assert.deepEqual(BASE_SCHEMA.$defs.boolean_claim.properties.predicate.enum, [
    "authoritative", "deterministic", "exists", "fails_when", "immutable"
  ]);
  assert.equal("value_reference_ids" in BASE_SCHEMA.$defs.boolean_claim.properties, false);
  assert.equal("boolean_values" in BASE_SCHEMA.$defs.reference_claim.properties, false);
  assert.equal(BASE_SCHEMA.$defs.verification_reference_claim.required.includes("verification_method"), true);
  assert.equal(BASE_SCHEMA.$defs.verification_reference_claim.required.includes("falsifying_condition_spans"), true);
  assert.equal("applicability_context" in BASE_SCHEMA.$defs.reference_claim.properties, false);
  assert.equal("applicability_conditions" in BASE_SCHEMA.$defs.reference_claim.properties, true);
});

test("v0.26 segments coordinated modal clauses independently", () => {
  assert.deepEqual(
    segmentCriterion("Authorization must precede execution, and execution must precede publication."),
    ["Authorization must precede execution,", "and execution must precede publication."]
  );
  assert.deepEqual(
    segmentCriterion("The set contains red, green, and blue values."),
    ["The set contains red, green, and blue values."]
  );
  assert.deepEqual(
    segmentCriterion("Omitted or malformed identifier, family, role, fd, backing, or lifecycle input must fail."),
    ["Omitted or malformed identifier, family, role, fd, backing, or lifecycle input must fail."]
  );
});

test("v0.26 numeric operands exclude durable-ID suffixes", () => {
  assert.deepEqual(numbersInSource("After SLICE-041 and WK-1924#SLICE-044, retain exactly 3 artifacts."), [3]);
});

test("v0.26 numeric operands preserve comma-formatted values", () => {
  assert.deepEqual(
    numbersInSource("The 62,254,330-byte index contains 22,453 entries; ranges are 7.76-10.52s and 0.58-0.61s."),
    [62254330, 22453, 7.76, 10.52, 0.58, 0.61]
  );
});

test("v0.26 keeps Markdown headings and list items in distinct source elements", () => {
  assert.deepEqual(
    segmentCriterion("Determine the failure.\n\n- Finding ID:\nF-4\n- Severity:\nmedium\n\n## Prior Findings\n\nDo not accept prior conclusions."),
    [
      "Determine the failure.",
      "- Finding ID:",
      "F-4",
      "- Severity:",
      "medium",
      "## Prior Findings",
      "Do not accept prior conclusions."
    ]
  );
});

test("v0.26 binding changes terminals without changing grammar shape", () => {
  const unit = { read_scope: [], repo_paths: [], write_scope: [] };
  const leftCatalog = buildReferenceCatalog({
    sourceText: "ServiceAlpha returns \"ready\".",
    unitId: "WK-1000",
    unit,
    repoRoot: REPO_ROOT
  });
  const rightCatalog = buildReferenceCatalog({
    sourceText: "WorkerBeta returns \"done\".",
    unitId: "WK-2000",
    unit,
    repoRoot: REPO_ROOT
  });
  assert.deepEqual(leftCatalog.map((entry) => entry.kind), rightCatalog.map((entry) => entry.kind));
  const left = bindGeneralSchema(BASE_SCHEMA, {
    sourceText: "ServiceAlpha returns \"ready\".",
    catalog: leftCatalog
  });
  const right = bindGeneralSchema(BASE_SCHEMA, {
    sourceText: "WorkerBeta returns \"done\".",
    catalog: rightCatalog
  });
  assert.deepEqual(Object.keys(left.$defs), Object.keys(right.$defs));
  assert.deepEqual(
    left.$defs.reference_claim.properties.predicate.enum,
    right.$defs.reference_claim.properties.predicate.enum
  );
  assert.equal("requirements" in left.properties, false);
  assert.equal("requirement_sets" in right.properties, false);
});

test("v0.26 derives clause requirements and their closed set from a multi-item checklist", () => {
  const sourceText = "The audit suite covers all controls: access is refused; evidence is recorded.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  assert.deepEqual(catalog.filter((entry) => entry.kind === "source_requirement").map((entry) => entry.surface), [
    "access is refused;",
    "evidence is recorded."
  ]);
  const requirementSet = catalog.find((entry) => entry.kind === "requirement_set");
  assert.equal(requirementSet.member_reference_ids.length, 2);
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  assert.equal(bound.$defs.reference_id.enum.includes(requirementSet.id), true);
  for (const memberId of requirementSet.member_reference_ids) {
    assert.equal(bound.$defs.reference_id.enum.includes(memberId), false);
  }
  assert.equal("requirements" in BASE_SCHEMA.properties, false);
  assert.equal("requirement_sets" in BASE_SCHEMA.properties, false);
});

test("v0.26 binds only identities present in source or carrier resolver paths", () => {
  const catalog = buildReferenceCatalog({
    sourceText: "Caller supplies DEC-0170 and \"value\".",
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  assert.ok(catalog.some((entry) => entry.identity === "DEC-0170"));
  assert.ok(catalog.some((entry) => entry.identity === "string:\"value\""));
  assert.equal(catalog.some((entry) => entry.surface === "environment"), false);
});

test("v0.26 reports contradictory mandatory values as review candidates", () => {
  const sourceText = "The solution must exist and must not exist.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  for (const booleanValue of [true, false]) {
    candidate.claims.push({
      source_spans: [{ text: sourceText }],
      claim_kind: "behavior",
      modality: "MUST",
      subject_reference_id: "current_solution",
      predicate: "exists",
      applicability_context: context,
      quantifiers: [],
      value_kind: "boolean",
      value_reference_ids: [],
      boolean_values: [booleanValue],
      number_values: [],
      minimum_values: [],
      maximum_values: [],
      verification_methods: [],
      falsifying_condition_spans: []
    });
  }
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  for (const claim of candidate.claims) {
    delete claim.verification_methods;
    delete claim.falsifying_condition_spans;
  }
  const validate = new Ajv({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(normalizeGeneralPayload(candidate)), true, JSON.stringify(validate.errors));
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.evaluation.arithmetic.review_candidates.length, 1);
  assert.equal(result.evaluation.arithmetic.review_candidates[0].authority, "review_candidate_only");
});

test("v0.26 verification production requires an authored counterfactual signal", () => {
  const unit = { read_scope: [], repo_paths: [], write_scope: [] };
  for (const [sourceText, expectedMaximum] of [
    ["Run the focused test suite.", 0],
    ["Malformed input must fail through the typed error.", 0],
    ["The focused suite must fail when the implementation is reverted.", undefined]
  ]) {
    const catalog = buildReferenceCatalog({ sourceText, unitId: "WK-1000", unit, repoRoot: REPO_ROOT });
    const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
    const verificationAllowed = bound.properties.verification_reference_claims.maxItems !== 0;
    assert.equal(verificationAllowed, expectedMaximum !== 0);
    if (expectedMaximum === 0) {
      assert.equal(bound.properties.verification_reference_claims.maxItems, 0);
      assert.equal(bound.properties.verification_boolean_claims.maxItems, 0);
      assert.equal(bound.properties.verification_number_claims.maxItems, 0);
      assert.equal(bound.properties.verification_range_claims.maxItems, 0);
    }
  }
});

test("v0.26 compiler normalizes omitted inapplicable verification fields", () => {
  const sourceText = "Delivery precedes integration.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "Delivery", type_term: "cc:event" },
    { variable_id: "variable-002", surface_text: "integration", type_term: "cc:event" }
  ];
  const claim = {
    source_spans: [{ text: sourceText }],
    claim_kind: "behavior",
    modality: "MUST",
    subject_reference_id: "variable-001",
    predicate: "precedes",
    applicability_context: context,
    quantifiers: [],
    value_kind: "reference",
    value_reference_ids: ["variable-002"],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: []
  };
  candidate.claims.push(claim);
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  const validate = new Ajv({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(normalizeGeneralPayload(candidate)), true, JSON.stringify(validate.errors));
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.evaluation.status, "complete");
});

test("v0.26 unresolved explicit identifiers remain residue candidates", () => {
  const sourceText = "Use exact SOME_UNRESOLVED_SYMBOL and privateRoot.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  assert.deepEqual(
    unresolvedIdentityMentions(sourceText, catalog).sort(),
    ["SOME_UNRESOLVED_SYMBOL", "privateRoot"]
  );
});

test("v0.26 multi-valued predicates union required values", () => {
  const sourceText = "The solution uses \"a\" and \"b\".";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const values = catalog.filter((entry) => entry.kind === "literal_string");
  const candidate = payload();
  for (const value of values) {
    candidate.claims.push({
      source_spans: [{ text: sourceText }],
      claim_kind: "behavior",
      modality: "MUST",
      subject_reference_id: "current_solution",
      predicate: "uses",
      applicability_context: context,
      quantifiers: [],
      value_kind: "reference",
      value_reference_ids: [value.id],
      boolean_values: [],
      number_values: [],
      minimum_values: [],
      maximum_values: [],
      verification_methods: [],
      falsifying_condition_spans: []
    });
  }
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.evaluation.arithmetic.review_candidates, []);
});

test("v0.26 rejects a bad claim without discarding a valid sibling", () => {
  const sourceText = "The solution depends on itself. The solution contains itself.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  for (const [text, predicate] of [
    ["The solution depends on itself.", "depends_on"],
    ["The solution contains itself.", "contains"]
  ]) {
    candidate.claims.push({
      source_spans: [{ text }],
      claim_kind: "behavior",
      modality: "MUST",
      subject_reference_id: "current_solution",
      predicate,
      applicability_context: context,
      quantifiers: [],
      value_kind: "reference",
      value_reference_ids: ["current_solution"],
      boolean_values: [],
      number_values: [],
      minimum_values: [],
      maximum_values: [],
      verification_methods: [],
      falsifying_condition_spans: []
    });
  }
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.equal(result.evaluation.rejected_claims, 1);
  assert.equal(result.evaluation.status, "partial");
  assert.equal(result.evaluation.residue[0].text, "The solution depends on itself.");
});

test("v0.26 source-bound variables express general event dependencies", () => {
  const sourceText = "Delivery depends on authorization.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "Delivery", type_term: "cc:event" },
    { variable_id: "variable-002", surface_text: "authorization", type_term: "cc:authority" }
  ];
  candidate.claims.push({
    source_spans: [{ text: sourceText }],
    claim_kind: "behavior",
    modality: "MUST",
    subject_reference_id: "variable-001",
    predicate: "depends_on",
    applicability_context: context,
    quantifiers: [],
    value_kind: "reference",
    value_reference_ids: ["variable-002"],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const bound = bindGeneralSchema(BASE_SCHEMA, { sourceText, catalog });
  delete candidate.claims[0].verification_methods;
  delete candidate.claims[0].falsifying_condition_spans;
  const validate = new Ajv({ strict: true, allErrors: true }).compile(bound);
  assert.equal(validate(normalizeGeneralPayload(candidate)), true, JSON.stringify(validate.errors));
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.equal(result.evaluation.status, "complete");
});

test("v0.26 rejects an invented variable surface", () => {
  const sourceText = "Delivery depends on authorization.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "deployment gate", type_term: "cc:event" }
  ];
  candidate.claims.push({
    source_spans: [{ text: sourceText }],
    claim_kind: "behavior",
    modality: "MUST",
    subject_reference_id: "variable-001",
    predicate: "exists",
    applicability_context: context,
    quantifiers: [],
    value_kind: "boolean",
    value_reference_ids: [],
    boolean_values: [true],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.ok(result.diagnostics.some((entry) => entry.code === "variable_surface_not_verbatim"));
  assert.ok(result.diagnostics.some((entry) => entry.code === "reference_not_bound"));
  assert.equal(result.evaluation.admitted_claims, 0);
  assert.equal(result.evaluation.status, "residue_only");
});

test("v0.26 rejects the entire criterion as a synthetic operand", () => {
  const sourceText = "Inspection evidence must support the release criterion.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: sourceText, type_term: "cc:evidence" }
  ];
  candidate.claims.push({
    source_spans: [{ text: sourceText }],
    claim_kind: "evidence",
    modality: "MUST",
    subject_reference_id: "variable-001",
    predicate: "exists",
    applicability_context: context,
    quantifiers: [],
    value_kind: "boolean",
    value_reference_ids: [],
    boolean_values: [true],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.ok(result.diagnostics.some((entry) => entry.code === "variable_surface_is_entire_clause"));
  assert.equal(result.evaluation.admitted_claims, 0);
  assert.equal(result.evaluation.status, "residue_only");
});

test("v0.26 bound variables may be reused by later anaphoric clauses", () => {
  const sourceText = "Authorization precedes delivery; integration follows both.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "Authorization", type_term: "cc:event" },
    { variable_id: "variable-002", surface_text: "delivery", type_term: "cc:event" },
    { variable_id: "variable-003", surface_text: "integration", type_term: "cc:event" }
  ];
  for (const [text, subject, predicate, values] of [
    [sourceText, "variable-001", "precedes", ["variable-002"]],
    [sourceText, "variable-003", "follows", ["variable-001", "variable-002"]]
  ]) {
    candidate.claims.push({
      source_spans: [{ text }],
      claim_kind: "behavior",
      modality: "MUST",
      subject_reference_id: subject,
      predicate,
      applicability_context: context,
      quantifiers: [],
      value_kind: "reference",
      value_reference_ids: values,
      boolean_values: [],
      number_values: [],
      minimum_values: [],
      maximum_values: [],
      verification_methods: [],
      falsifying_condition_spans: []
    });
  }
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.evaluation.admitted_claims, 2);
  assert.equal(result.evaluation.status, "complete");
});

test("v0.26 keeps semicolon-linked parts in one source element", () => {
  assert.deepEqual(
    segmentCriterion("The study yields the factor; the pass must report the count."),
    ["The study yields the factor; the pass must report the count."]
  );
});

test("v0.26 uppercase prose verbs are not unresolved identities", () => {
  const sourceText = "THIS REPLACES THE EARLIER PASS.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  assert.deepEqual(unresolvedIdentityMentions(sourceText, catalog), []);
});

test("v0.26 apostrophes do not create cross-criterion string literals", () => {
  const sourceText = "THE OPERATOR'S POSITION differs from V22's pass.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  assert.deepEqual(catalog.filter(({ kind }) => kind === "literal_string"), []);
});

test("v0.26 requirement sets require a checklist header and stop at the next section header", () => {
  const sourceText = "CONTROLS: record slices; record reviews. QUESTION: which defects were detected?";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const requirementSet = catalog.find(({ kind }) => kind === "requirement_set");
  assert.deepEqual(
    requirementSet.member_reference_ids.map((id) => catalog.find((entry) => entry.id === id).surface),
    ["record slices;", "record reviews."]
  );
  assert.equal(requirementSet.surface.includes("which defects"), false);
  const proseCatalog = buildReferenceCatalog({
    sourceText: "METHOD: record slices; record reviews. QUESTION: which defects were detected?",
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  assert.equal(proseCatalog.some(({ kind }) => kind === "requirement_set"), false);
});

test("v0.26 rejects a grounded but type-invalid predicate signature", () => {
  const sourceText = "The artifact accepts the command.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "artifact", type_term: "cc:artifact" },
    { variable_id: "variable-002", surface_text: "command", type_term: "cc:command" }
  ];
  candidate.claims.push({
    source_spans: [{ text: sourceText }],
    claim_kind: "behavior",
    modality: "MUST",
    subject_reference_id: "variable-001",
    predicate: "accepts",
    applicability_context: context,
    quantifiers: [],
    value_kind: "reference",
    value_reference_ids: ["variable-002"],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.ok(result.diagnostics.some((entry) => entry.code === "predicate_subject_type_mismatch"));
  assert.equal(result.evaluation.admitted_claims, 0);
  assert.equal(result.evaluation.status, "residue_only");
});

test("v0.26 ordered collections preserve member order and list coverage", () => {
  const sourceText = "Namespace order is connector, endpoint, then token.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "connector", type_term: "cc:configuration" },
    { variable_id: "variable-002", surface_text: "endpoint", type_term: "cc:configuration" },
    { variable_id: "variable-003", surface_text: "token", type_term: "cc:configuration" }
  ];
  candidate.collections = [{
    collection_id: "collection-001",
    collection_kind: "ordered_sequence",
    member_reference_ids: ["variable-001", "variable-002", "variable-003"]
  }];
  candidate.claims.push({
    source_spans: [{ text: sourceText }],
    claim_kind: "behavior",
    modality: "MUST",
    subject_reference_id: "current_solution",
    predicate: "ordered_as",
    applicability_context: context,
    quantifiers: [],
    value_kind: "reference",
    value_reference_ids: ["collection-001"],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.equal(result.evaluation.residue_entries, 0);
  assert.equal(result.evaluation.status, "complete");
});

test("v0.26 does not mark an enumerated sentence covered by its final member", () => {
  const sourceText = "Add no module, package artifact, executable, or registry.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "registry", type_term: "cc:artifact" }
  ];
  candidate.claims.push({
    source_spans: [{ text: sourceText }],
    claim_kind: "behavior",
    modality: "MUST_NOT",
    subject_reference_id: "current_solution",
    predicate: "adds",
    applicability_context: context,
    quantifiers: [],
    value_kind: "reference",
    value_reference_ids: ["variable-001"],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.deepEqual(
    result.evaluation.residue.map((entry) => entry.text),
    ["Add no module", "package artifact", "executable"]
  );
  assert.equal(result.evaluation.status, "partial");
});

test("v0.26 rejects self-typing claims", () => {
  const sourceText = "The endpoint has type endpoint.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "endpoint", type_term: "cc:configuration" }
  ];
  candidate.claims.push({
    source_spans: [{ text: sourceText }],
    claim_kind: "behavior",
    modality: "MUST",
    subject_reference_id: "variable-001",
    predicate: "has_type",
    applicability_context: context,
    quantifiers: [],
    value_kind: "reference",
    value_reference_ids: ["variable-001"],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.ok(result.diagnostics.some((entry) => entry.code === "irreflexive_predicate_self_reference"));
  assert.equal(result.evaluation.status, "residue_only");
});

test("v0.26 preserves derived checklist membership without treating member prose as semantic capture", () => {
  const sourceText = "The audit suite covers all controls: access is refused; evidence is recorded.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "audit suite", type_term: "cc:test" }
  ];
  const requirementSet = catalog.find((entry) => entry.kind === "requirement_set");
  candidate.claims.push({
    source_spans: [{ text: "The audit suite covers all controls:" }],
    claim_kind: "behavior",
    modality: "MUST",
    subject_reference_id: "variable-001",
    predicate: "covers",
    applicability_context: context,
    quantifiers: [],
    value_kind: "reference",
    value_reference_ids: [requirementSet.id],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.diagnostics.some((entry) => entry.code === "variable_surface_is_entire_clause"), false);
  assert.equal(result.evaluation.admitted_claims, 1);
  assert.deepEqual(result.evaluation.residue.map((entry) => entry.text), [
    "access is refused; evidence is recorded."
  ]);
  assert.equal(result.evaluation.status, "partial");
});

test("v0.26 generic collections cannot contain clause requirements", () => {
  const sourceText = "The audit suite covers all controls: access is refused; evidence is recorded.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  const requirement = catalog.find((entry) => entry.kind === "source_requirement");
  candidate.collections = [{
    collection_id: "collection-001",
    collection_kind: "closed_set",
    member_reference_ids: [requirement.id]
  }];
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.schema_valid, true);
  assert.ok(result.diagnostics.some((entry) => entry.code === "requirement_member_requires_requirement_set"));
});

test("v0.26 rejects a solution as verification evidence", () => {
  const sourceText = "The audit suite verifies the access criterion.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "access criterion", type_term: "cc:criterion" }
  ];
  candidate.relations = [{
    source_spans: [{ text: sourceText }],
    role: "verifies",
    source_reference_id: "current_solution",
    target_reference_id: "variable-001"
  }];
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.ok(result.diagnostics.some((entry) => entry.code === "relation_source_type_mismatch"));
  assert.equal(result.evaluation.admitted_relations, 0);
  assert.equal(result.evaluation.status, "residue_only");
});

test("v0.26 a verified requirement set does not launder member prose into semantic capture", () => {
  const sourceText = "The audit suite verifies all controls: access is refused; evidence is recorded.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const candidate = payload();
  candidate.variables = [
    { variable_id: "variable-001", surface_text: "audit suite", type_term: "cc:test" }
  ];
  const requirementSet = catalog.find((entry) => entry.kind === "requirement_set");
  candidate.relations = [{
    source_spans: [{ text: "The audit suite verifies all controls:" }],
    role: "verifies",
    source_reference_id: "variable-001",
    target_reference_id: requirementSet.id
  }];
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.equal(result.evaluation.admitted_relations, 1);
  assert.deepEqual(result.evaluation.residue.map((entry) => entry.text), [
    "The audit suite verifies all controls:",
    "access is refused; evidence is recorded."
  ]);
  assert.equal(result.evaluation.status, "partial");
});

test("v0.26 rejects inclusion as a substitute for a verification checklist header", () => {
  const sourceText = "Directly test every control: access is refused; evidence is recorded.";
  const catalog = buildReferenceCatalog({
    sourceText,
    unitId: "WK-1000",
    unit: { read_scope: [], repo_paths: [], write_scope: [] },
    repoRoot: REPO_ROOT
  });
  const requirementSet = catalog.find((entry) => entry.kind === "requirement_set");
  const candidate = payload();
  candidate.claims.push({
    source_spans: [{ text: "Directly test every control:" }],
    claim_kind: "behavior",
    modality: "MUST",
    subject_reference_id: "current_solution",
    predicate: "includes",
    applicability_context: context,
    quantifiers: [],
    value_kind: "reference",
    value_reference_ids: [requirementSet.id],
    boolean_values: [],
    number_values: [],
    minimum_values: [],
    maximum_values: [],
    verification_methods: [],
    falsifying_condition_spans: []
  });
  const result = evaluateGeneralContract(candidate, { sourceText, catalog });
  assert.ok(result.diagnostics.some((entry) => entry.code === "verification_checklist_header_not_expressed"));
  assert.equal(result.evaluation.admitted_claims, 0);
  assert.equal(result.evaluation.residue.length, 2);
});
