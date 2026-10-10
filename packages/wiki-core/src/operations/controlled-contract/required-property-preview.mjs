

import { isDeepStrictEqual } from "node:util";
import {
  NATIVE_CONTRACT_SCHEMA_V1,
  PROFILE_ID_V1,
  SCHEMA_VERSION_V1,
  TEST_PROOF_VERSION_V1,
  VOCABULARY_VERSION_V1,
  buildStableTestProofBindingTemplate
} from "@agent-chassis/controlled-contract";
import { resolveNativeContractDag } from "@agent-chassis/controlled-contract/native-contract-dag";
import { validateAndResolveNativeContractV1 } from "@agent-chassis/controlled-contract/native-contract";
import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";
import { compileControlledContractRequirements } from "./contract-requirement-authoring.mjs";
import { deriveControlledContractAuthoringVocabulary } from "./contract-requirement-vocabulary.mjs";
import { requiredObligationSupport } from "./required-obligation-support.mjs";

const vocabulary = deriveControlledContractAuthoringVocabulary(NATIVE_CONTRACT_SCHEMA_V1);
const schemaIdentity = Object.freeze({ schema_version: SCHEMA_VERSION_V1,
  vocabulary_version: VOCABULARY_VERSION_V1, profile_id: PROFILE_ID_V1,
  test_proof_version: TEST_PROOF_VERSION_V1 });

const INPUT_FIELDS = Object.freeze(["wkId", "focus", "requiredProperties", "contract",
  "obligations"]);
const PROPERTY_FIELDS = Object.freeze(["requirement", "provenance", "requiredProof"]);
const PROOF_FIELDS = Object.freeze(["selection", "unresolved_parameters"]);

const SELECTION_PIN_FIELDS = Object.freeze(["proof_name", "proof_version", "profile_digest",
  "parameter_contract_digest", "admission_digest"]);
const SELECTION_FIELDS = Object.freeze([...SELECTION_PIN_FIELDS, "parameters"]);
const NODE_IDENTITY_FIELDS = Object.freeze({ references: "reference_id",
  propositions: "proposition_id", claims: "claim_id", relations: "relation_id",
  collections: "collection_id", residue: "residue_id", annotations: "annotation_id",
  test_proofs: "test_proof_id" });

const COMPILED_POPULATIONS = Object.freeze(["references", "propositions", "claims", "relations"]);
const POPULATION_OWNER = "caller supplying the required property population";
const CONTRACT_OWNER = "caller supplying the authored native contract";
const OBLIGATION_OWNER = "caller supplying saved obligations";

const clone = (value) => structuredClone(value);
const compare = (left, right) => String(left).localeCompare(String(right));
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function invalid(code, message, { subject, field, repair, owner, ...details }) {
  return new ControlledContractToolError(code, message, { subject, field, effects: "none",
    uncertainty: "required-property input was not assessed", repair,
    responsible_owner: owner, ...details });
}

function assertRecord(value, fields, { code, subject, field, owner }) {
  const label = field ?? "preview input";
  if (!isRecord(value)) throw invalid(code, `${label} must be an object`, { subject, field,
    repair: `Supply an object carrying only ${fields.join(", ")} and retry.`, owner });
  const unknown = Object.keys(value).filter((key) => !fields.includes(key)).sort();
  if (unknown.length > 0) throw invalid(code, `${label} carries unsupported member(s)`, {
    subject, field: field === undefined ? unknown[0] : `${field}.${unknown[0]}`,
    unknown_fields: unknown, accepted_fields: [...fields],
    repair: `Remove ${unknown.join(", ")}; use only ${fields.join(", ")}.`, owner });
}

function compilerError(error, subject) {
  const added = { subject, field: "requiredProperties", effects: "none",
    uncertainty: "required-property input was not assessed",
    repair: "Correct the supplied semantic requirement at the named field and retry the preview.",
    responsible_owner: "controlled-contract requirement compiler" };
  if (error instanceof ControlledContractToolError) {
    error.details = { ...added, ...error.details };
    return error;
  }
  return new ControlledContractToolError("required_property_preview_invalid", error?.message ??
    "required-property preview input is invalid", { ...added, cause: error?.code ?? null });
}

function validateAndResolve(content, subject, field, owner) {
  const validation = validateAndResolveNativeContractV1(content);
  if (!validation.schema_valid) throw invalid("required_property_contract_invalid",
    `${field} is not a schema-valid native contract`, { subject, field,
      schema_errors: clone(validation.schema_errors),
      repair: `Correct ${field} at the named schema pointers and retry the preview.`, owner });
  return { diagnostics: clone(validation.diagnostics), valid: validation.valid,
    graph: resolveNativeContractDag(content) };
}

function selectors(value) {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, member]) =>
    key === "select" && typeof member === "string" ? [member] : selectors(member));
}

function assertCompilerIdentities(authored, answer, compile, subject) {
  const selected = new Set(selectors(answer));
  const minted = compile({ ...authored, propositions: [], claims: [], relations: [],
    collections: [], residue: [], annotations: [], test_proofs: [],
    references: authored.references.filter((row) => selected.has(row.reference_id)) });
  const stating = new Map(minted.compiled.flatMap((entry, index) =>
    COMPILED_POPULATIONS.flatMap((population) => entry.added[population].map((id) => [id, index])))
    .reverse());
  const inconsistent = COMPILED_POPULATIONS.flatMap((population) => {
    const identity = NODE_IDENTITY_FIELDS[population];
    const expected = new Map(minted.content[population].map((node) => [node[identity], node]));
    return authored[population].flatMap((node, position) => {
      const compiled = expected.get(node[identity]);
      return compiled === undefined || isDeepStrictEqual(node, compiled) ? [] : [{ population,
        identity: node[identity], field: `contract.${population}[${position}]`,
        property_index: stating.get(node[identity]) ?? null }];
    });
  });
  if (inconsistent.length > 0) throw invalid("required_property_contract_identity_inconsistent",
    "contract carries node(s) under a required property's compiler identity with other content", {
      subject, field: inconsistent[0].field, inconsistent_nodes: inconsistent,
      uncertainty: "the named identities do not establish the required meaning; nothing was assessed",
      repair: "Restore each named node to the content its identity was compiled from, or author " +
        "the changed meaning through the requirement compiler so it receives its own identity.",
      owner: CONTRACT_OWNER });
}

function proofExpectation(property, field, subject) {
  if (property.requiredProof === undefined) return null;
  const expectation = property.requiredProof;
  const options = { code: "required_property_entry_invalid", subject, owner: POPULATION_OWNER };
  assertRecord(expectation, PROOF_FIELDS, { ...options, field: `${field}.requiredProof` });
  const selectionField = `${field}.requiredProof.selection`;
  assertRecord(expectation.selection, SELECTION_FIELDS, { ...options, field: selectionField });
  const unresolved = expectation.unresolved_parameters;
  const bad = SELECTION_PIN_FIELDS.find((key) => typeof expectation.selection[key] !== "string" ||
    expectation.selection[key].length === 0) ?? (isRecord(expectation.selection.parameters)
    ? undefined : "parameters");
  if (bad !== undefined || !Array.isArray(unresolved) ||
      unresolved.some((name) => typeof name !== "string" || name.length === 0)) {
    throw invalid("required_property_entry_invalid",
      `${field}.requiredProof must carry a pinned selection and its unresolved parameter names`, {
        subject, field: bad === undefined ? `${field}.requiredProof.unresolved_parameters`
          : `${selectionField}.${bad}`,
        repair: `Supply ${SELECTION_FIELDS.join(", ")} and an array of unresolved parameter names.`,
        owner: POPULATION_OWNER });
  }
  return { selection: clone(expectation.selection), unresolved_parameters: [...unresolved].sort(compare) };
}

function proofAssessment(expectation, candidates, provenance) {
  const { selection, unresolved_parameters: unresolved } = expectation;
  const rows = candidates.map(({ row, qualifies }) => {
    const authored = row.selection;
    const mismatches = [];
    if (!qualifies) mismatches.push({ code: "obligation_not_qualifying" });
    if (row.proof_opt_out === true) mismatches.push({ code: "proof_opted_out" });
    else if (typeof authored?.proof_name !== "string") mismatches.push({ code: "proof_unselected" });
    else if (authored.proof_name !== selection.proof_name) mismatches.push({
      code: "proof_name_mismatch", field: "proof_name" });
    else {
      for (const key of SELECTION_PIN_FIELDS) if (authored[key] !== selection[key]) mismatches.push({
        code: "proof_pin_mismatch", field: key });
      for (const [name, value] of Object.entries(selection.parameters)) {
        if (!isRecord(authored.parameters) || !Object.hasOwn(authored.parameters, name)) {
          mismatches.push({ code: "parameter_missing", field: `parameters.${name}` });
        } else if (!isDeepStrictEqual(authored.parameters[name], value)) {
          mismatches.push({ code: "parameter_mismatch", field: `parameters.${name}` });
        }
      }
    }
    return { obligation_id: row.obligation_id ?? null, mismatches,
      selected: typeof authored?.proof_name === "string" };
  });
  const matching = unresolved.length > 0 ? [] : rows.filter((row) => row.mismatches.length === 0);
  return {
    origin: "policy_generated",
    provenance,
    status: unresolved.length > 0 ? "unresolved" : matching.length > 0 ? "declared"
      : rows.some((row) => row.selected) ? "mismatched" : "missing",
    selection,
    unresolved_parameters: unresolved,
    obligation_ids: matching.map((row) => row.obligation_id).sort(compare),
    mismatches: rows.flatMap((row) => row.mismatches.map((mismatch) =>
      ({ obligation_id: row.obligation_id, ...mismatch })))
  };
}

function strings(value) {
  if (typeof value === "string") return [value];
  return value !== null && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
}

function claimNodes(claim, propositions) {
  const ids = [claim.claim_id];
  for (const propositionId of [claim.proposition_id, claim.falsifying_proposition_id]) {
    if (typeof propositionId !== "string") continue;
    ids.push(propositionId);
    const proposition = propositions.get(propositionId);
    if (proposition !== undefined) ids.push(proposition.subject_reference_id,
      ...proposition.applicability_context.operand_reference_ids,
      ...proposition.operands.flatMap((operand) =>
        operand.kind === "reference" ? [operand.reference_id] : []));
  }
  return ids;
}

function authoredSupport(authored, subject) {
  if (authored === null) return { validation: null, contractNodes: undefined,
    assess: () => ({ authored: false, verified: false, diagnostics: [] }) };
  const { diagnostics, valid, graph } = validateAndResolve(authored, subject, "contract",
    CONTRACT_OWNER);
  const nodeIds = new Set(Object.entries(NODE_IDENTITY_FIELDS).flatMap(([population, field]) =>
    authored[population].map((node) => node[field])));
  const named = diagnostics.map((diagnostic) => ({ diagnostic,
    ids: strings(diagnostic).filter((id) => nodeIds.has(id)) }));
  const concerning = (ids) => named.filter((entry) => entry.ids.length === 0 ||
    entry.ids.some((id) => ids.includes(id))).map(({ diagnostic }) => diagnostic);
  const claims = new Map(authored.claims.map((claim) => [claim.claim_id, claim]));
  const propositions = new Map(authored.propositions.map((proposition) =>
    [proposition.proposition_id, proposition]));
  const qualifying = new Set(graph.facts.qualifying_verifies_relation_ids);
  return {
    validation: { valid, diagnostics },

    contractNodes: [...claims.keys(), ...authored.references.map((row) => row.reference_id)],
    assess(claimId) {
      const claim = claims.get(claimId);
      const own = claim === undefined ? [claimId] : claimNodes(claim, propositions);
      const verifications = authored.relations.filter((relation) =>
        relation.role === "verifies" && relation.target_claim_id === claimId).map((relation) => {
        const source = claims.get(relation.source_claim_id);
        return { qualifying: qualifying.has(relation.relation_id),
          ids: [relation.relation_id, ...(source === undefined ? [relation.source_claim_id] :
            claimNodes(source, propositions))] };
      });
      return {
        authored: claim !== undefined,
        verified: claim !== undefined && verifications.some((verification) =>
          verification.qualifying && concerning([...own, ...verification.ids]).length === 0),
        diagnostics: clone(concerning([...own, ...verifications.flatMap(({ ids }) => ids)]))
      };
    }
  };
}

function missingParts(authored, obligations, verification, proofs) {
  return [
    ...(authored ? [] : ["authored_requirement"]),
    ...(obligations.length > 0 ? [] : ["same_subject_obligation"]),
    ...(verification ? [] : ["qualifying_verification_support"]),
    ...(proofs.every((proof) => proof.status === "declared") ? [] : ["required_proof_selection"])
  ];
}

export function previewRequiredPropertyCoverage(input) {
  const subject = isRecord(input) ? { wk_id: input.wkId, focus: input.focus ?? null } : undefined;
  assertRecord(input, INPUT_FIELDS, { code: "required_property_preview_invalid", subject,
    owner: "caller supplying the required-property preview input" });
  const { wkId, requiredProperties: properties, contract: authored, obligations: rows } = input;
  const { focus } = subject;
  if (typeof wkId !== "string" || wkId.trim().length === 0) {
    throw invalid("required_property_preview_invalid",
      "wkId must identify the exact authored subject", { subject, field: "wkId",
        repair: "Supply the canonical WK identifier for the authored subject.",
        owner: "caller supplying the required-property preview subject" });
  }
  if (!Array.isArray(properties) || properties.length === 0) {
    throw invalid("required_property_population_invalid",
      "requiredProperties must be a nonempty array", { subject, field: "requiredProperties",
        uncertainty: "required population is absent",
        repair: "Supply the independently derived required property population.",
        owner: "caller supplying applicability" });
  }
  if (!Array.isArray(rows)) throw invalid("required_property_preview_invalid",
    "obligations must be an array", { subject, field: "obligations",
      repair: "Supply the saved obligation rows for the exact subject.", owner: OBLIGATION_OWNER });
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) throw invalid("required_property_obligation_invalid",
      `obligations[${index}] must be an object`, { subject, field: `obligations[${index}]`,
        repair: `Supply the saved obligation row at obligations[${index}] and retry.`,
        owner: OBLIGATION_OWNER });
  }
  if (authored !== null && !isRecord(authored)) throw invalid(
    "required_property_contract_invalid", "contract must be native contract content or null", {
      subject, field: "contract", owner: CONTRACT_OWNER,
      repair: "Supply the authored native contract content, or null when none is authored." });
  const expectations = [];
  const answer = { requirements: properties.map((property, index) => {
    const field = `requiredProperties[${index}]`;
    assertRecord(property, PROPERTY_FIELDS, { code: "required_property_entry_invalid", subject,
      field, owner: POPULATION_OWNER });
    if (!isRecord(property.requirement)) throw invalid("required_property_entry_invalid",
      `${field}.requirement must be an object`, { subject, field: `${field}.requirement`,
        uncertainty: "required property entry was not assessed",
        repair: `Supply a semantic requirement object at ${field}.requirement and retry.`,
        owner: POPULATION_OWNER });
    expectations.push(proofExpectation(property, field, subject));
    return clone(property.requirement);
  }) };

  const support = authoredSupport(authored, subject);
  const compile = (contract) => {
    try {
      return compileControlledContractRequirements({ wkId, focus, answer, contract, vocabulary,
        schemaIdentity, buildTestProofTemplate: buildStableTestProofBindingTemplate });
    } catch (error) {
      throw compilerError(error, subject);
    }
  };
  if (authored !== null) assertCompilerIdentities(authored, answer, compile, subject);
  const compilation = compile(authored);
  const prospective = clone(compilation.content);
  const prospectiveResult = validateAndResolve(prospective, subject, "requiredProperties",
    "controlled-contract requirement compiler");

  const compiled = compilation.compiled;
  const uniqueCompiled = [...new Map(compiled.map((entry) => [entry.claim_id,
    { entry, indices: [...compiled.entries()].filter(([, candidate]) =>
      candidate.claim_id === entry.claim_id).map(([candidateIndex]) => candidateIndex) }])).values()];
  const assessments = uniqueCompiled.map(({ entry, indices }) => {
    const claimId = entry.claim_id;
    const authoredResult = support.assess(claimId);
    const obligationResult = requiredObligationSupport(rows, claimId, subject, support.contractNodes);

    const stated = indices.filter((index) => expectations[index] !== null);
    const proofs = stated.filter((index) => stated.find((candidate) =>
      isDeepStrictEqual(expectations[candidate], expectations[index])) === index).map((index) =>
      proofAssessment(expectations[index], obligationResult.candidates, stated.filter((candidate) =>
        isDeepStrictEqual(expectations[candidate], expectations[index])).map((candidate) =>
        clone(properties[candidate].provenance ?? null))));
    const missing = missingParts(authoredResult.authored, obligationResult.obligationIds,
      authoredResult.verified, proofs);
    return {
      property_index: indices[0],
      claim_id: claimId,
      provenance: indices.length === 1 ? clone(properties[indices[0]].provenance ?? null) :
        indices.map((index) => clone(properties[index].provenance ?? null)),
      authored_requirement: authoredResult.authored,
      same_subject_obligation: obligationResult.obligationIds.length > 0,
      qualifying_verification_support: authoredResult.verified,
      obligation_ids: obligationResult.obligationIds,
      required_proof_selection: proofs.length === 0 ? null :
        proofs.every((proof) => proof.status === "declared"),
      required_proofs: proofs,
      diagnostics: [...obligationResult.diagnostics, ...authoredResult.diagnostics],
      uncertainty: missing.length === 0 ? null : "authored support is incomplete or unresolved",
      repair: missing.length === 0 ? null : "Author the named missing relationship(s) for this exact subject and retry.",
      missing_parts: missing,
      definition_complete: missing.length === 0
    };
  }).sort((left, right) => compare(left.claim_id, right.claim_id));
  const completeCount = assessments.filter((entry) => entry.definition_complete).length;
  return Object.freeze({
    schema_version: "required-property-preview.v1",
    subject: Object.freeze(clone(subject)),
    provenance_kind: "supplied_prototype_input",
    required_count: assessments.length,
    definition_complete_count: completeCount,
    definition_complete: completeCount === assessments.length,
    counts: Object.freeze({ required: assessments.length, definition_complete: completeCount,
      missing: assessments.length - completeCount }),
    properties: Object.freeze(assessments.map((entry) => Object.freeze(entry))),
    authored_validation: Object.freeze(support.validation),
    prospective_validation: Object.freeze({ valid: prospectiveResult.valid,
      diagnostics: prospectiveResult.diagnostics }),
    graph: Object.freeze(prospectiveResult.graph),
    prospective_contract: Object.freeze(prospective),
    compiler: Object.freeze({ identity: "compileControlledContractRequirements",
      generated_claim_count: compilation.added.claims.length }),
    authority: Object.freeze({ policy: false, implementation_satisfaction: false,
      dispatch: false, persistent_effects: false })
  });
}
