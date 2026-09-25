

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
import { assessProofAuthoringRowSemantics } from "@agent-chassis/controlled-contract/proof-contract";
import { ControlledContractToolError } from "../../lib/controlled-contract-tools.mjs";
import { compileControlledContractRequirements } from "./contract-requirement-authoring.mjs";
import { deriveControlledContractAuthoringVocabulary } from "./contract-requirement-vocabulary.mjs";

const vocabulary = deriveControlledContractAuthoringVocabulary(NATIVE_CONTRACT_SCHEMA_V1);
const schemaIdentity = Object.freeze({ schema_version: SCHEMA_VERSION_V1,
  vocabulary_version: VOCABULARY_VERSION_V1, profile_id: PROFILE_ID_V1,
  test_proof_version: TEST_PROOF_VERSION_V1 });

const clone = (value) => structuredClone(value);
const compare = (left, right) => String(left).localeCompare(String(right));
const contractContent = (contract) => contract?.content ?? contract ?? null;

function inputError(error, subject, field) {
  if (error instanceof ControlledContractToolError) {
    error.details = { ...error.details, subject, field, effects: "none",
      uncertainty: "required-property input was not assessed",
      repair: "Correct the supplied semantic requirement at the named field and retry the preview.",
      responsible_owner: "controlled-contract requirement compiler" };
    return error;
  }
  return new ControlledContractToolError("required_property_preview_invalid", error?.message ??
    "required-property preview input is invalid", { subject, field, effects: "none",
    uncertainty: "required-property input was not assessed",
    repair: "Correct the supplied semantic requirement at the named field and retry the preview.",
    responsible_owner: "controlled-contract requirement compiler", cause: error?.code ?? null });
}

function requiredInput(input) {
  const properties = input.requiredProperties ?? input.required_properties;
  if (!Array.isArray(properties) || properties.length === 0) {
    throw new ControlledContractToolError("required_property_population_invalid",
      "requiredProperties must be a nonempty array", { field: "requiredProperties",
        effects: "none", uncertainty: "required population is absent",
        repair: "Supply the independently derived required property population.",
        responsible_owner: "caller supplying applicability" });
  }
  return properties;
}

function sourceOf(property) {
  return clone(property.provenance ?? property.source ?? null);
}

function obligationAssessment(rows, claimId, subject) {
  const candidates = [];
  const diagnostics = [];
  for (const [index, row] of rows.entries()) {
    const ids = row?.controlled_contract_node_ids;

    if (Array.isArray(ids) && ids.includes(claimId) && Array.isArray(row?.diagnostics)) {
      diagnostics.push(...clone(row.diagnostics));
    }
    if (row?.wk_id !== undefined && row.wk_id !== subject.wk_id) continue;
    if (row?.focus !== undefined && (row.focus ?? null) !== subject.focus) continue;
    const validShape = row !== null && typeof row === "object" &&
      typeof row.obligation_id === "string" && row.obligation_id.length > 0 &&
      typeof row.statement === "string" && row.statement.trim().length > 0 &&
      Array.isArray(ids) && ids.includes(claimId);
    if (!validShape || (row?.wk_id !== undefined && row.wk_id !== subject.wk_id) ||
        (row?.focus !== undefined && (row.focus ?? null) !== subject.focus)) continue;
    const semanticDiagnostics = assessProofAuthoringRowSemantics(row,
      `/obligations/${index}`, { contract_nodes: subject.contract_nodes });
    diagnostics.push(...clone(semanticDiagnostics));
    if (semanticDiagnostics.length === 0) candidates.push({ index,
      obligation_id: row.obligation_id, diagnostics: clone(row.diagnostics ?? []) });
  }
  return {
    candidates: candidates.sort((left, right) => compare(left.obligation_id, right.obligation_id)),
    diagnostics
  };
}

function missingParts(authored, obligations, verification) {
  return [
    ...(authored ? [] : ["authored_requirement"]),
    ...(obligations.length > 0 ? [] : ["same_subject_obligation"]),
    ...(verification ? [] : ["qualifying_verification_support"])
  ];
}

export function previewRequiredPropertyCoverage(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ControlledContractToolError("required_property_preview_invalid",
      "preview input must be an object", { effects: "none" });
  }
  const wkId = input.wkId ?? input.wk_id;
  const focus = input.focus ?? null;
  const subject = { wk_id: wkId, focus };
  if (typeof wkId !== "string" || wkId.trim().length === 0) {
    throw new ControlledContractToolError("required_property_preview_invalid",
      "wkId must identify the exact authored subject", { field: "wkId", subject,
        effects: "none", uncertainty: "required-property input was not assessed",
        repair: "Supply the canonical WK identifier for the authored subject.",
        responsible_owner: "caller supplying the required-property preview subject" });
  }
  const properties = requiredInput(input);
  const authored = contractContent(input.contract ?? input.authoredContract);
  const rows = input.obligationRows ?? input.obligations ?? [];
  if (!Array.isArray(rows)) throw new ControlledContractToolError(
    "required_property_preview_invalid", "obligationRows must be an array", {
      field: "obligationRows", subject, effects: "none",
      repair: "Supply saved obligation rows for the exact subject.",
      responsible_owner: "caller supplying saved obligations" });

  const answer = { requirements: properties.map((property, index) => {
    if (property === null || typeof property !== "object" || Array.isArray(property)) {
      throw new ControlledContractToolError("required_property_entry_invalid",
        `requiredProperties[${index}] must be an object`, { subject,
          field: `requiredProperties[${index}]`, effects: "none",
          uncertainty: "required property entry was not assessed",
          repair: `Supply a semantic requirement object at requiredProperties[${index}] and retry.`,
          responsible_owner: "caller supplying the required property population" });
    }
    const requirement = property.requirement ?? property;
    if (requirement === null || typeof requirement !== "object" || Array.isArray(requirement)) {
      throw new ControlledContractToolError("required_property_entry_invalid",
        `requiredProperties[${index}].requirement must be an object`, { subject,
          field: `requiredProperties[${index}].requirement`, effects: "none",
          uncertainty: "required property entry was not assessed",
          repair: `Supply a semantic requirement object at requiredProperties[${index}].requirement and retry.`,
          responsible_owner: "caller supplying the required property population" });
    }
    return clone(requirement);
  }) };
  let compilation;
  try {
    compilation = compileControlledContractRequirements({ wkId, focus, answer,
      contract: authored, vocabulary, schemaIdentity,
      buildTestProofTemplate: buildStableTestProofBindingTemplate });
  } catch (error) {
    throw inputError(error, subject, "requiredProperties");
  }

  const prospective = compilation.content;
  const graph = validateAndResolveNativeContractV1(prospective).graph;
  const authoredGraph = authored ? validateAndResolveNativeContractV1(authored).graph :
    resolveNativeContractDag(null);
  const authoredClaims = new Map((authored?.claims ?? []).map((claim) =>
    [claim.claim_id, claim]));
  const qualifying = new Set(authoredGraph.facts.verified_behavior_claim_ids);
  const contractNodes = authored ? ["references", "propositions", "claims", "relations",
    "collections", "residue", "annotations", "test_proofs"].flatMap((population) =>
    (authored[population] ?? []).flatMap((node) => Object.values(node).filter((value) =>
      typeof value === "string" && /^(?:ref|prop|claim|rel|col|res|ann|test-proof)-/.test(value)))) : [];
  const compiled = compilation.compiled;
  const uniqueCompiled = [...new Map(compiled.map((entry, index) => [entry.claim_id,
    { entry, indices: [...compiled.entries()].filter(([, candidate]) =>
      candidate.claim_id === entry.claim_id).map(([candidateIndex]) => candidateIndex) }])).values()];
  const assessments = uniqueCompiled.map(({ entry, indices }) => {
    const claimId = entry.claim_id;
    const authoredRequirement = authoredClaims.has(claimId);
    const obligationResult = obligationAssessment(rows, claimId,
      { ...subject, contract_nodes: contractNodes });
    const sameSubjectObligations = obligationResult.candidates;
    const verificationSupport = authoredRequirement && qualifying.has(claimId);
    const missing = missingParts(authoredRequirement, sameSubjectObligations,
      verificationSupport);
    const suppliedDiagnostics = obligationResult.diagnostics;
    return {
      property_index: indices[0],
      claim_id: claimId,
      provenance: indices.length === 1 ? sourceOf(properties[indices[0]]) :
        indices.map((index) => sourceOf(properties[index])),
      authored_requirement: authoredRequirement,
      same_subject_obligation: sameSubjectObligations.length > 0,
      qualifying_verification_support: verificationSupport,
      obligation_ids: sameSubjectObligations.map(({ obligation_id }) => obligation_id),
      diagnostics: [...suppliedDiagnostics, ...authoredGraph.diagnostics],
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
    graph: Object.freeze(clone(graph)),
    prospective_contract: Object.freeze(clone(prospective)),
    compiler: Object.freeze({ identity: "compileControlledContractRequirements",
      generated_claim_count: compilation.added.claims.length }),
    authority: Object.freeze({ policy: false, implementation_satisfaction: false,
      dispatch: false, persistent_effects: false })
  });
}

export const previewRequiredProperties = previewRequiredPropertyCoverage;
export const buildRequiredPropertyPreview = previewRequiredPropertyCoverage;
