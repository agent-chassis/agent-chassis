

function reference(id, type) {
  return { reference_id: id, type_term: type, identity: {
    kind: "durable_id", domain: "bounded-state-stability.fixed", value: id.slice(4)
  } };
}
const u = () => ({ mode: "unconditional", operand_reference_ids: [] });
const at = (id) => ({ mode: "when", operand_reference_ids: [id] });
const r = (reference_id) => ({ kind: "reference", reference_id });
const n = (value) => ({ kind: "number", value });

function baseContract({ omitSecondRecord = false, wrongSecondSubject = false } = {}) {
  const contract = {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references: [
      ["ref-subject", "cc:resource"], ["ref-other-subject", "cc:resource"],
      ["ref-baseline-state", "cc:state"], ["ref-regressed-state", "cc:state"],
      ["ref-start-boundary", "cc:event"], ["ref-end-boundary", "cc:event"],
      ["ref-observation-population", "cc:population"],
      ["ref-observation-1", "cc:evidence"], ["ref-observation-2", "cc:evidence"],
      ["ref-baseline-state-population", "cc:population"],
      ["ref-observed-state-population", "cc:population"],
      ["ref-verification", "cc:test"], ["ref-state-regression-condition", "cc:state"],
      ["ref-status", "cc:state"], ["ref-baseline-artifact", "cc:artifact"],
      ["ref-candidate-artifact", "cc:artifact"]
    ].map(([id, type]) => reference(id, type)),
    propositions: [], claims: [], relations: [], collections: [], residue: [], annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const claims = new Map();
  let serial = 0;
  const add = ({ key, subject, operator, operands, context = u(), kind = "evidence",
    modality = "MUST", verification = false, falsifier }) => {
    serial += 1;
    const proposition_id = `prop-fixed-${serial}`;
    const claim_id = `claim-fixed-${serial}`;
    contract.propositions.push({ proposition_id, subject_reference_id: subject, operator,
      applicability_context: structuredClone(context), operands: structuredClone(operands) });
    contract.claims.push({ claim_id, proposition_id, kind, modality,
      ...(verification ? { verification_method: "test_execution" } : {}),
      ...(falsifier ? { falsifying_proposition_id: falsifier } : {}) });
    claims.set(key, claim_id);
    return claim_id;
  };
  add({ key: "observation-count", subject: "ref-observation-population",
    operator: "number:has_cardinality", operands: [n(2)] });
  add({ key: "observation-members", subject: "ref-observation-population",
    operator: "reference:contains", operands: [r("ref-observation-1"), r("ref-observation-2")] });
  for (const [key, population] of [["baseline", "ref-baseline-state-population"],
    ["observed", "ref-observed-state-population"]]) {
    add({ key: `${key}-count`, subject: population, operator: "number:has_cardinality",
      operands: [n(1)] });
    add({ key: `${key}-members`, subject: population, operator: "reference:contains",
      operands: [r("ref-baseline-state")] });
  }
  add({ key: "start-end", subject: "ref-start-boundary", operator: "reference:precedes",
    operands: [r("ref-end-boundary")] });
  add({ key: "baseline-at-start", subject: "ref-subject", operator: "reference:has_state",
    operands: [r("ref-baseline-state")], context: at("ref-start-boundary") });
  add({ key: "baseline-member", subject: "ref-baseline-state", operator: "reference:member_of",
    operands: [r("ref-baseline-state-population")] });
  for (const index of [1, 2]) {
    const observation = `ref-observation-${index}`;
    add({ key: `start-before-${index}`, subject: "ref-start-boundary",
      operator: "reference:precedes", operands: [r(observation)] });
    add({ key: `before-end-${index}`, subject: observation, operator: "reference:precedes",
      operands: [r("ref-end-boundary")] });
    add({ key: `reads-${index}`, subject: observation, operator: "reference:reads",
      operands: [r(wrongSecondSubject && index === 2 ? "ref-other-subject" : "ref-subject")] });
    if (!(omitSecondRecord && index === 2)) add({ key: `records-${index}`, subject: observation,
      operator: "reference:records", operands: [r("ref-baseline-state")] });
  }
  add({ key: "state-equality", subject: "ref-observed-state-population",
    operator: "reference:equals", operands: [r("ref-baseline-state-population")],
    kind: "behavior" });
  add({ key: "read-spine", subject: "ref-verification", operator: "reference:reads",
    operands: [r("ref-subject"), r("ref-baseline-state"), r("ref-start-boundary"),
      r("ref-end-boundary"), r("ref-observation-population"), r("ref-observation-1"),
      r("ref-observation-2"), r("ref-baseline-state-population"),
      r("ref-observed-state-population")] });
  serial += 1;
  const falsifier = `prop-fixed-${serial}`;
  contract.propositions.push({ proposition_id: falsifier,
    subject_reference_id: "ref-observed-state-population", operator: "reference:not_equals",
    applicability_context: at("ref-state-regression-condition"),
    operands: [r("ref-baseline-state-population")] });
  const verification = add({ key: "verification", subject: "ref-verification",
    operator: "reference:covers", operands: [r("ref-observation-population"),
      r("ref-observed-state-population"), r("ref-baseline-state-population")],
    kind: "verification", verification: true, falsifier });
  contract.relations.push({ relation_id: "rel-fixed-state", role: "verifies",
    source_claim_id: verification, target_claim_id: claims.get("state-equality") });
  return contract;
}

function endpointOnlyContract() {
  return baseContract({ omitSecondRecord: true });
}
function wrongSubjectContract() {
  return baseContract({ wrongSecondSubject: true });
}
function statusOnlyContract() {
  const contract = baseContract();
  const keepSubjects = new Set([
    "ref-observation-population", "ref-baseline-state-population", "ref-observed-state-population"
  ]);
  const keptProps = contract.propositions.filter(({ subject_reference_id, operator }) =>
    keepSubjects.has(subject_reference_id) &&
    ["number:has_cardinality", "reference:contains"].includes(operator));
  const ids = new Set(keptProps.map(({ proposition_id }) => proposition_id));
  contract.propositions = keptProps;
  contract.claims = contract.claims.filter(({ proposition_id }) => ids.has(proposition_id));
  contract.relations = [];
  addStandalone(contract, "ref-subject", "reference:has_status", [r("ref-status")]);
  return contract;
}
function p8ArtifactComparisonOnlyContract() {
  const contract = statusOnlyContract();
  addStandalone(contract, "ref-baseline-artifact", "reference:equals",
    [r("ref-candidate-artifact")], "behavior");
  addStandalone(contract, "ref-candidate-artifact", "reference:unchanged_from_frozen_base",
    [r("ref-baseline-artifact")]);
  addStandalone(contract, "ref-verification", "reference:reads",
    [r("ref-baseline-artifact"), r("ref-candidate-artifact")]);
  return contract;
}
function addStandalone(contract, subject, operator, operands, kind = "evidence") {
  const index = contract.propositions.length + 1;
  const proposition_id = `prop-standalone-${index}`;
  contract.propositions.push({ proposition_id, subject_reference_id: subject, operator,
    applicability_context: u(), operands });
  contract.claims.push({ claim_id: `claim-standalone-${index}`, proposition_id, kind,
    modality: "MUST" });
}

export { endpointOnlyContract, p8ArtifactComparisonOnlyContract, statusOnlyContract,
  wrongSubjectContract };
