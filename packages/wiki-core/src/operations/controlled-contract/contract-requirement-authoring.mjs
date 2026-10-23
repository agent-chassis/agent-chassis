
import { createHash } from "node:crypto";
import { canonicalMaterial } from "./contract-requirement-identity.mjs";
import { projectRequirementDescriptions } from "./contract-requirement-projection.mjs";
import { publicNativeValueOperand, valueRowMetadata } from "./contract-requirement-native-values.mjs";
import { valueReferences } from "@agent-chassis/controlled-contract/controlled-values-v1";
import { ControlledContractToolError, CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS } from "../../lib/controlled-contract-tools.mjs";
import { projectControlledContractDeclaredRuntimeTest } from "./contract-requirement-runtime-proof.mjs";

function projectionFailure(code, message, details) {
  throw new ControlledContractToolError(code, message, { changed: false, phase: "projection", ...details });
}

function indexedProjectionPopulation(contract, population, identityField) {
  const index = new Map();
  for (const [position, entry] of (contract[population] ?? []).entries()) {
    const identity = entry?.[identityField];
    if (typeof identity !== "string" || identity.length === 0) projectionFailure(
      "controlled_contract_requirement_projection_identity_invalid",
      `The canonical ${population} population contains an invalid identity`,
      { population, identity_field: identityField, position, identity: identity ?? null });
    const current = index.get(identity);
    if (current !== undefined && canonicalMaterial(current.entry) !== canonicalMaterial(entry)) {
      projectionFailure(
        "controlled_contract_requirement_projection_reference_inconsistent",
        `The canonical ${population} population defines one identity inconsistently`,
        { population, identity_field: identityField, identity,
          positions: [current.position, position] });
    }
    if (current === undefined) index.set(identity, { entry, position });
  }
  return new Map([...index].map(([identity, value]) => [identity, value.entry]));
}

function requiredProjectionNode(index, identity, { population, field, claimId, subject = "requirement" }) {
  const entry = typeof identity === "string" ? index.get(identity) : undefined;
  if (entry === undefined) projectionFailure(
    population === "references"
      ? "controlled_contract_requirement_projection_reference_missing"
      : "controlled_contract_requirement_projection_node_missing",
    `The canonical ${subject} ${field} does not resolve to one ${population} definition`,
    { population, field, claim_id: claimId, identity: identity ?? null });
  return entry;
}

function referentInput(referenceId, context) {
  requiredProjectionNode(context.references, referenceId, {
    population: "references", field: context.field, claimId: context.claimId
  });
  context.usedReferences.add(referenceId);
  return Object.freeze({ select: referenceId });
}

function statementInput(proposition, context) {
  if (proposition === undefined) projectionFailure(
    "controlled_contract_requirement_projection_node_missing",
    `The canonical requirement ${context.field} does not resolve to one propositions definition`,
    { population: "propositions", field: context.field,
      claim_id: context.claimId, identity: context.propositionId ?? null });
  return Object.freeze({
    relation: proposition.operator,
    applies: Object.freeze({
      mode: proposition.applicability_context.mode,
      context: Object.freeze((proposition.applicability_context.operand_reference_ids ?? [])
        .map((referenceId, index) => referentInput(referenceId, {
          ...context, field: `${context.field}.applies.context[${index}]`
        })))
    }),
    objects: Object.freeze((proposition.operands ?? []).map((operand, index) =>
      operand.kind === "reference"
        ? Object.freeze({ referent: referentInput(operand.reference_id, {
          ...context, field: `${context.field}.objects[${index}].referent`
        }) })
        : operand.kind === 'value' ? Object.freeze(publicNativeValueOperand(operand, id => referentInput(id, context)))
        : operand.kind === "range"
          ? Object.freeze({ range: Object.freeze({
            ...(operand.minimum === undefined ? {} : { minimum: operand.minimum }),
            ...(operand.maximum === undefined ? {} : { maximum: operand.maximum })
          }) })
          : Object.freeze({ [operand.kind]: operand.value })))
  });
}

export function projectControlledContractRequirements(contract, {
  controlledContractNodeIds = null, descriptionOwner = null,
  sourceDescriptions = new Map(), sourceGeneration = null, visibleNodeIds = null
} = {}) {
  if (contract === null || contract === undefined) return Object.freeze({
    status: "absent", meaning_identity: null, requirements: Object.freeze([]),
    references: Object.freeze([]),
    selection: Object.freeze({ mode: controlledContractNodeIds === null ? "all" : "associated",
      total_requirements: 0, returned_requirements: 0, omitted_requirements: 0,
      reference_count: 0 }),
    residue: Object.freeze([]), notes: Object.freeze([])
  });
  const references = indexedProjectionPopulation(contract, "references", "reference_id");
  const propositions = indexedProjectionPopulation(contract, "propositions", "proposition_id");
  const claims = indexedProjectionPopulation(contract, "claims", "claim_id");
  const proofs = new Map((contract.test_proofs ?? []).map((entry) =>
    [entry.verification_claim_id, entry]));
  const verifications = new Map();
  for (const relation of contract.relations ?? []) {
    if (relation.role !== "verifies") continue;
    const rows = verifications.get(relation.target_claim_id) ?? [];
    rows.push({ relation });
    verifications.set(relation.target_claim_id, rows);
  }
  const selectedNodes = controlledContractNodeIds === null
    ? null : new Set(controlledContractNodeIds);
  const requirementClaims = (contract.claims ?? []).filter((claim) =>
    claim.kind !== "verification");
  const usedReferences = new Set();
  const requirements = requirementClaims.flatMap((claim) => {

    const linked = (verifications.get(claim.claim_id) ?? [])
      .map((row) => ({ ...row, claim: requiredProjectionNode(claims,
        row.relation.source_claim_id, { population: "claims",
          field: "verification_claim_ids", claimId: claim.claim_id }) }))
      .sort((left, right) => left.claim.claim_id.localeCompare(right.claim.claim_id));
    const closureIds = new Set([claim.claim_id, claim.proposition_id]);
    const addPropositionClosure = (propositionId) => {
      if (typeof propositionId !== "string") return;
      closureIds.add(propositionId);
      const proposition = propositions.get(propositionId);
      if (proposition === undefined) return;
      closureIds.add(proposition.subject_reference_id);
      for (const referenceId of proposition.applicability_context?.operand_reference_ids ?? []) {
        closureIds.add(referenceId);
      }
      for (const operand of proposition.operands ?? []) {
        if (operand.kind === "reference") closureIds.add(operand.reference_id);
      }
      for (const id of valueReferences([...(proposition.operands ?? []).filter(operand => operand.kind === "value"), proposition.for_each ?? [], proposition.within ?? null])) closureIds.add(id);
    };
    addPropositionClosure(claim.proposition_id);
    for (const { relation, claim: verificationClaim } of linked) {
      closureIds.add(relation.relation_id);
      closureIds.add(verificationClaim.claim_id);
      addPropositionClosure(verificationClaim.proposition_id);
      addPropositionClosure(verificationClaim.falsifying_proposition_id);
      const proof = proofs.get(verificationClaim.claim_id);
      if (proof?.test_proof_id) closureIds.add(proof.test_proof_id);
      for (const referenceId of proof?.system_under_test_boundary?.subject_reference_ids ?? []) {
        closureIds.add(referenceId);
      }
    }
    if (selectedNodes !== null && ![...closureIds].some(identity =>
      selectedNodes.has(identity))) return [];
    const behaviorProposition = requiredProjectionNode(propositions, claim.proposition_id, {
      population: "propositions", field: "meaning.behavior", claimId: claim.claim_id
    });
    const subject = referentInput(behaviorProposition.subject_reference_id, {
      references, usedReferences, field: "meaning.subject", claimId: claim.claim_id
    });
    const behavior = statementInput(behaviorProposition, {
      references, usedReferences, field: "meaning.behavior", claimId: claim.claim_id,
      propositionId: claim.proposition_id
    });

    const verificationMeanings = linked.map(({ claim: verification }, position) => {
      const field = `meaning.verifications[${position}]`;
      const proof = proofs.get(verification.claim_id) ?? null;
      for (const [index, referenceId] of
        (proof?.system_under_test_boundary?.subject_reference_ids ?? []).entries()) {
        referentInput(referenceId, { references, usedReferences,
          field: `${field}.runtime_test.boundary.subjects[${index}]`,
          claimId: claim.claim_id });
      }
      return Object.freeze({
        claim_id: verification.claim_id,
        method: verification.verification_method,
        verifier: referentInput(requiredProjectionNode(propositions,
          verification.proposition_id, { population: "propositions",
            field: `${field}.observes`,
            claimId: claim.claim_id }).subject_reference_id, {
          references, usedReferences, field: `${field}.verifier`,
          claimId: claim.claim_id
        }),
        observes: statementInput(propositions.get(verification.proposition_id), {
          references, usedReferences, field: `${field}.observes`,
          claimId: claim.claim_id, propositionId: verification.proposition_id
        }),
        fails_when: statementInput(propositions.get(verification.falsifying_proposition_id), {
          references, usedReferences, field: `${field}.fails_when`,
          claimId: claim.claim_id, propositionId: verification.falsifying_proposition_id
        }),
        ...(proof === null ? {} : {
          runtime_test: projectControlledContractDeclaredRuntimeTest(proof) })
      });
    });
    const meaning = Object.freeze({
      nature: claim.kind,
      modality: claim.modality,
      subject,
      ...valueRowMetadata(behaviorProposition, id => referentInput(id, { references, usedReferences, field: "meaning.lexical_scope", claimId: claim.claim_id })),
      behavior,
      verifications: Object.freeze(verificationMeanings)
    });
    return [Object.freeze({ claim_id: claim.claim_id,
      verification_claim_ids: Object.freeze(linked.map(({ claim: row }) => row.claim_id)),
      meaning })];
  }).sort((left, right) => left.claim_id.localeCompare(right.claim_id));
  const described = descriptionOwner === null ? { state: 'incomplete', roots: [], nodes: [],
    missing: [{ code: 'description_owning_scope_missing' }] } : projectRequirementDescriptions(contract, {
    unit: descriptionOwner, claimIds: selectedNodes === null ? null : new Set(requirements.map(row => row.claim_id)),
    visibleNodeIds, sourceDescriptions });
  for (const node of described.nodes) for (const referenceId of node.reference_ids) usedReferences.add(referenceId);
  const projectedReferences = [...usedReferences].sort().map(referenceId =>
    Object.freeze(structuredClone(references.get(referenceId))));
  const projection = {
    status: "present",
    requirements: Object.freeze(requirements),
    references: Object.freeze(projectedReferences),
    descriptions: described, source_generation: sourceGeneration,
    selection: Object.freeze({ mode: selectedNodes === null ? "all" : "associated",
      total_requirements: requirementClaims.length,
      returned_requirements: requirements.length,
      omitted_requirements: requirementClaims.length - requirements.length,
      reference_count: projectedReferences.length }),
    residue: Object.freeze(structuredClone(contract.residue ?? [])),
    notes: Object.freeze(structuredClone(contract.annotations ?? []))
  };
  return Object.freeze({ ...projection,
    meaning_identity: `sha256:${createHash("sha256")
      .update(canonicalMaterial(projection)).digest("hex")}` });
}

export function projectControlledContractReferenceClosure(contract, uses, { descriptionOwner = null, sourceDescriptions = new Map() } = {}) {
  if (uses.length === 0) return Object.freeze([]);
  const references = indexedProjectionPopulation(contract ?? {}, "references", "reference_id");
  const ids = new Set();
  for (const { reference_id: referenceId, field } of uses) {
    requiredProjectionNode(references, referenceId, { population: "references", field, claimId: null,
      subject: "case" });
    ids.add(referenceId);
  }
  const descriptions = descriptionOwner === null ? null : projectRequirementDescriptions(contract, {
    unit: descriptionOwner, claimIds: new Set(), additionalRoots: [...ids].map(id => ({ owner: descriptionOwner,
      entity: { type_term: references.get(id).type_term, identity: references.get(id).identity } })), sourceDescriptions });
  for (const node of descriptions?.nodes ?? []) for (const id of node.reference_ids) ids.add(id);
  return Object.freeze([...ids].sort().map(referenceId => Object.freeze({ ...structuredClone(references.get(referenceId)),
    ...(descriptions === null ? {} : { description: descriptions.roots.find(row =>
      canonicalMaterial(row.entity.identity) === canonicalMaterial(references.get(referenceId).identity)) ??
      { state: descriptions.state, role: 'definition_context' } }) })));
}

export function attributeControlledContractRequirementDiagnostics(error, _compilation) {
  const diagnostics = error?.details?.diagnostics?.diagnostics;
  if (!(error instanceof ControlledContractToolError) || !Array.isArray(diagnostics)) return error;
  for (const diagnostic of diagnostics) if (diagnostic.code === 'mandatory_behavior_unverified') {
    if (diagnostic.attribution?.status === 'mapped') diagnostic.attribution.field = 'verification';
    for (const choice of diagnostic.attribution?.choices ?? []) choice.field = 'verification';
    if (diagnostic.attribution?.status === 'unavailable') {
      diagnostic.correction = 'Stop this correction: the failed mandatory behavior has no established authored location. Do not guess a target or retry unchanged.';
    } else {
      diagnostic.guidance_path = [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS.mandatory_verification];
      diagnostic.correction = diagnostic.attribution?.status === 'ambiguous'
        ? 'Establish the intended affected declaration from the supplied choices before authoring its verification. If that choice cannot be established, stop without guessing or retrying unchanged.'
        : 'Supply the authored verification for the affected mandatory behavior, preserving its intended meaning and associations.';
    }
  }
  return error;
}
