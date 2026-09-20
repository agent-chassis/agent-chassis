

import { createHash } from "node:crypto";
import { DEFAULT_MANDATORY_MODALITIES } from "@agent-chassis/controlled-contract";

import {
  CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS,
  CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE,
  ControlledContractToolError
} from "../../lib/controlled-contract-tools.mjs";

import { CONTROLLED_CONTRACT_REQUIREMENT_LIMITS } from
  "./contract-requirement-vocabulary.mjs";
import {
  applyRequirementCorrections,
  requirementCorrectionTargets,
  requirementRetirementTargets
} from "./contract-requirement-corrections.mjs";
import {
  buildControlledContractRuntimeTestTemplate,
  CONTROLLED_CONTRACT_RUNTIME_TEST_LIMITS,
  composeControlledContractRuntimeTestProof,
  projectControlledContractDeclaredRuntimeTest,
  sameControlledContractRuntimeTestProof
} from "./contract-requirement-runtime-proof.mjs";

function fail(code, message, details = {}) {
  throw new ControlledContractToolError(code, message, { changed: false, ...details });
}

function finiteVocabularyDetails(field, rejectedValue, acceptedAlternatives, guidance,
  details = {}) {
  return {
    ...details,
    field,
    rejected_value: rejectedValue ?? null,
    accepted_alternatives: [...acceptedAlternatives],
    guidance_path: guidanceLocation(guidance)
  };
}

function guidanceLocation(member) {
  return [...CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS[member]];
}

function locateRuntimeTestRefusal(error, runtimeTest, runtimeField) {
  const details = error?.details;
  if (!(error instanceof ControlledContractToolError) || typeof details?.field !== "string" ||
      Object.hasOwn(details, "guidance_path")) return error;
  const prefix = runtimeField + ".";
  const member = details.field === runtimeField ? null
    : details.field.startsWith(prefix) ? details.field.slice(prefix.length) : undefined;
  if (member === undefined) return error;
  const locations = CONTROLLED_CONTRACT_REQUIREMENT_GUIDANCE_LOCATIONS;
  const guidancePath = member === null ? locations.runtime_test
    : locations.runtime_test_fields[member] ?? locations.runtime_test_vocabulary;
  const authored = member === null ? undefined : member.split(".").reduce((value, key) =>
    value === null || typeof value !== "object" ? undefined : value[key], runtimeTest);
  const listed = guidancePath.reduce((value, key) => value?.[key],
    CONTROLLED_CONTRACT_REQUIREMENT_INPUT_GUIDANCE);
  const alternatives = Object.hasOwn(details, "accepted_alternatives") ? {}
    : Object.hasOwn(details, "bound_value") && details.bound_value !== null
      ? { accepted_alternatives: [structuredClone(details.bound_value)] }
      : member !== null && Array.isArray(listed)
        ? { accepted_alternatives: structuredClone(listed) } : {};
  error.details = {
    ...details,
    ...(authored === undefined || Object.hasOwn(details, "rejected_value")
      ? {} : { rejected_value: structuredClone(authored) }),
    ...alternatives,
    guidance_path: [...guidancePath]
  };
  return error;
}

function canonicalMaterial(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalMaterial).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalMaterial(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function mint(prefix, subject, body) {
  const digest = createHash("sha256")
    .update(canonicalMaterial({ subject, body })).digest("hex").slice(0, 40);
  return `${prefix}-${digest}`;
}

function projectionFailure(code, message, details) {
  fail(code, message, { phase: "projection", ...details });
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

function requiredProjectionNode(index, identity, { population, field, claimId }) {
  const entry = typeof identity === "string" ? index.get(identity) : undefined;
  if (entry === undefined) projectionFailure(
    population === "references"
      ? "controlled_contract_requirement_projection_reference_missing"
      : "controlled_contract_requirement_projection_node_missing",
    `The canonical requirement ${field} does not resolve to one ${population} definition`,
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
        : operand.kind === "range"
          ? Object.freeze({ range: Object.freeze({
            ...(operand.minimum === undefined ? {} : { minimum: operand.minimum }),
            ...(operand.maximum === undefined ? {} : { maximum: operand.maximum })
          }) })
          : Object.freeze({ [operand.kind]: operand.value })))
  });
}

export function projectControlledContractRequirements(contract, {
  controlledContractNodeIds = null
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
    rows.push({ relation, claim: claims.get(relation.source_claim_id) });
    verifications.set(relation.target_claim_id, rows);
  }
  const selectedNodes = controlledContractNodeIds === null
    ? null : new Set(controlledContractNodeIds);
  const requirementClaims = (contract.claims ?? []).filter((claim) =>
    claim.kind !== "verification");
  const usedReferences = new Set();
  const requirements = requirementClaims.flatMap((claim) => {
    const linked = (verifications.get(claim.claim_id) ?? [])
      .filter(({ claim: verification }) => verification !== undefined)
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
    const verification = linked[0]?.claim ?? null;
    const proof = verification === null ? null : proofs.get(verification.claim_id) ?? null;
    for (const [index, referenceId] of
      (proof?.system_under_test_boundary?.subject_reference_ids ?? []).entries()) {
      referentInput(referenceId, { references, usedReferences,
        field: `meaning.verification.runtime_test.boundary.subjects[${index}]`,
        claimId: claim.claim_id });
    }
    const behaviorProposition = requiredProjectionNode(propositions, claim.proposition_id, {
      population: "propositions", field: "meaning.behavior", claimId: claim.claim_id
    });
    const meaning = Object.freeze({
      nature: claim.kind,
      modality: claim.modality,
      subject: referentInput(behaviorProposition.subject_reference_id, {
        references, usedReferences, field: "meaning.subject", claimId: claim.claim_id
      }),
      behavior: statementInput(behaviorProposition, {
        references, usedReferences, field: "meaning.behavior", claimId: claim.claim_id,
        propositionId: claim.proposition_id
      }),
      ...(verification === null ? {} : { verification: Object.freeze({
        method: verification.verification_method,
        verifier: referentInput(requiredProjectionNode(propositions,
          verification.proposition_id, { population: "propositions",
            field: "meaning.verification.observes",
            claimId: claim.claim_id }).subject_reference_id, {
          references, usedReferences, field: "meaning.verification.verifier",
          claimId: claim.claim_id
        }),
        observes: statementInput(propositions.get(verification.proposition_id), {
          references, usedReferences, field: "meaning.verification.observes",
          claimId: claim.claim_id, propositionId: verification.proposition_id
        }),
        fails_when: statementInput(propositions.get(verification.falsifying_proposition_id), {
          references, usedReferences, field: "meaning.verification.fails_when",
          claimId: claim.claim_id, propositionId: verification.falsifying_proposition_id
        }),
        ...(proof === null ? {} : {
          runtime_test: projectControlledContractDeclaredRuntimeTest(proof) })
      }) })
    });
    return [Object.freeze({ claim_id: claim.claim_id,
      verification_claim_ids: Object.freeze(linked.map(({ claim: row }) => row.claim_id)),
      meaning })];
  }).sort((left, right) => left.claim_id.localeCompare(right.claim_id));
  const projectedReferences = [...usedReferences].sort().map(referenceId =>
    Object.freeze(structuredClone(references.get(referenceId))));
  const projection = {
    status: "present",
    requirements: Object.freeze(requirements),
    references: Object.freeze(projectedReferences),
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

function text(value, field) {
  if (typeof value !== "string" || value.trim().length === 0 ||
      Buffer.byteLength(value, "utf8") >
        CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.text_bytes) {
    fail("controlled_contract_requirement_invalid",
      `${field} must be one nonempty bounded statement`, { field });
  }
  return value;
}

class RequirementCompilation {
  constructor({ wkId, focus, vocabulary, contract, buildTestProofTemplate }) {
    this.subject = { wk_id: wkId, focus: focus ?? null };
    this.vocabulary = vocabulary;

    this.buildTestProofTemplate = buildTestProofTemplate;
    this.references = new Map((contract?.references ?? []).map((entry) =>
      [entry.reference_id, entry]));
    this.propositions = new Map((contract?.propositions ?? []).map((entry) =>
      [entry.proposition_id, entry]));
    this.claims = new Map((contract?.claims ?? []).map((entry) =>
      [entry.claim_id, entry]));
    this.relations = new Map((contract?.relations ?? []).map((entry) =>
      [entry.relation_id, entry]));
    this.residue = new Map((contract?.residue ?? []).map((entry) =>
      [entry.residue_id, entry]));
    this.annotations = new Map((contract?.annotations ?? []).map((entry) =>
      [entry.annotation_id, entry]));

    this.testProofs = new Map((contract?.test_proofs ?? []).map((entry) =>
      [entry.verification_claim_id, entry]));
    this.added = { references: [], propositions: [], claims: [], relations: [],
      residue: [], annotations: [], testProofs: [] };

    this.replaced = { testProofs: [] };
  }

  mark() {
    return Object.fromEntries(Object.entries(this.added).map(([population, ids]) =>
      [population, ids.length]));
  }

  since(mark) {
    return Object.freeze(Object.fromEntries(Object.entries(this.added).map(
      ([population, ids]) => [population,
        Object.freeze(ids.slice(mark[population]))])));
  }

  disposeTestProof(verificationClaimId, binding) {
    const stored = this.testProofs.get(verificationClaimId);
    if (stored === undefined) {
      this.add("testProofs", verificationClaimId, binding);
      return "created";
    }
    if (sameControlledContractRuntimeTestProof(stored, binding)) return "unchanged";
    this.testProofs.set(verificationClaimId, binding);
    this.replaced.testProofs.push(verificationClaimId);
    return "replaced";
  }

  add(population, key, value) {
    const store = this[population];
    if (!store.has(key)) {
      store.set(key, value);
      this.added[population].push(key);
    }
    return key;
  }

  referent(value, field) {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        (value.select === undefined) === (value.declare === undefined)) {
      fail("controlled_contract_requirement_invalid",
        `${field} must select exactly one existing referent or declare exactly one new one`,
        { field });
    }
    if (value.select !== undefined) {
      if (!this.references.has(value.select)) {
        fail("controlled_contract_requirement_selector_unknown",
          `${field} selects a referent this contract does not declare`,
          { field, selector: value.select });
      }
      return value.select;
    }
    const declared = value.declare;
    if (declared === null || typeof declared !== "object" ||
        !this.vocabulary.type_terms.includes(declared.type_term)) {
      fail("controlled_contract_requirement_invalid",
        `${field} declares no controlled type term`,
        finiteVocabularyDetails(`${field}.declare.type_term`, declared?.type_term,
          this.vocabulary.type_terms, "type_terms",
          { type_term: declared?.type_term ?? null }));
    }
    const identityKind = this.vocabulary.identity_kinds.find(
      ({ kind }) => kind === declared.identity?.kind);
    if (identityKind === undefined) {
      fail("controlled_contract_requirement_invalid",
        `${field} declares no controlled identity kind`,
        finiteVocabularyDetails(`${field}.declare.identity.kind`, declared.identity?.kind,
          this.vocabulary.identity_kinds.map(({ kind }) => kind),
          "identity_kinds", { identity_kind: declared.identity?.kind ?? null }));
    }
    const supplied = Object.keys(declared.identity).filter((key) => key !== "kind");
    const missing = identityKind.required_fields.filter(
      (key) => !supplied.includes(key));
    const unknown = supplied.filter((key) =>
      !identityKind.required_fields.includes(key) &&
      !identityKind.optional_fields.includes(key));
    if (missing.length > 0 || unknown.length > 0) {
      fail("controlled_contract_requirement_invalid",
        `${field} identity does not match its declared kind`,
        { field, identity_kind: identityKind.kind, missing_fields: missing.sort(),
          unknown_fields: unknown.sort(), guidance_path: guidanceLocation("identity_kinds") });
    }
    const reference = { type_term: declared.type_term,
      identity: structuredClone(declared.identity) };
    const id = mint("ref", this.subject, reference);
    return this.add("references", id, { reference_id: id, ...reference });
  }

  operand(value, signature, field) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail("controlled_contract_requirement_invalid",
        `${field} is not one controlled object`, { field });
    }
    const kind = signature.operand_kind;
    if (kind === "reference") {
      if (value.referent === undefined) fail(
        "controlled_contract_requirement_operand_kind_mismatch",
        `${field} takes a referent for this relation`, { field, expected: kind, guidance_path: guidanceLocation("relations") });
      return { kind: "reference",
        reference_id: this.referent(value.referent, `${field}.referent`) };
    }
    if (kind === "range") {
      if (value.range === null || typeof value.range !== "object" ||
          (value.range.minimum === undefined && value.range.maximum === undefined)) {
        fail("controlled_contract_requirement_operand_kind_mismatch",
          `${field} takes a range with a minimum, a maximum, or both`,
          { field, expected: kind, guidance_path: guidanceLocation("relations") });
      }
      return { kind: "range", ...(value.range.minimum === undefined
        ? {} : { minimum: value.range.minimum }),
      ...(value.range.maximum === undefined ? {} : { maximum: value.range.maximum }) };
    }
    if (typeof value[kind] !== (kind === "boolean" ? "boolean" : "number")) {
      fail("controlled_contract_requirement_operand_kind_mismatch",
        `${field} takes a ${kind} value for this relation`,
        { field, expected: kind, guidance_path: guidanceLocation("relations") });
    }
    return { kind, value: value[kind] };
  }

  proposition(subjectId, statement, field) {
    if (statement === null || typeof statement !== "object") {
      fail("controlled_contract_requirement_invalid", `${field} is missing`, { field });
    }
    const signature = this.vocabulary.operator_signatures.get(statement.relation);
    if (signature === undefined) {
      fail("controlled_contract_requirement_relation_unknown",
        `${field}.relation is not a controlled relation`,
        finiteVocabularyDetails(`${field}.relation`, statement.relation,
          this.vocabulary.operator_signatures.keys(),
          "relations", { relation: statement.relation ?? null }));
    }
    const applies = statement.applies ?? { mode: "unconditional" };
    const mode = this.vocabulary.applicability_modes.get(applies.mode);
    if (mode === undefined || !signature.applicability_modes.includes(applies.mode)) {
      fail("controlled_contract_requirement_applicability_invalid",
        `${field}.applies names no applicability mode this relation admits`,
        finiteVocabularyDetails(`${field}.applies.mode`, applies.mode,
          signature.applicability_modes, "applicability_modes",
          { mode: applies.mode ?? null,
            admitted_modes: [...signature.applicability_modes] }));
    }
    const context = applies.context ?? [];
    if (!Array.isArray(context) || context.length < mode.minimum_context ||
        (mode.maximum_context !== null && context.length > mode.maximum_context) ||
        context.length > CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.context_referents) {
      fail("controlled_contract_requirement_applicability_invalid",
        `${field}.applies carries the wrong number of context referents for its mode`,
        { field, mode: applies.mode, minimum: mode.minimum_context,
          maximum: mode.maximum_context,
          guidance_path: guidanceLocation("applicability_modes") });
    }
    const objects = statement.objects ?? [];
    if (!Array.isArray(objects) || objects.length < signature.minimum_operands ||
        (signature.maximum_operands !== null &&
          objects.length > signature.maximum_operands)) {
      fail("controlled_contract_requirement_invalid",
        `${field}.objects carries the wrong number of objects for this relation`,
        { field, minimum: signature.minimum_operands,
          maximum: signature.maximum_operands, guidance_path: guidanceLocation("relations") });
    }
    const body = {
      subject_reference_id: subjectId,
      operator: statement.relation,
      applicability_context: { mode: applies.mode,
        operand_reference_ids: context.map((entry, index) =>
          this.referent(entry, `${field}.applies.context[${index}]`)) },
      operands: objects.map((entry, index) =>
        this.operand(entry, signature, `${field}.objects[${index}]`))
    };
    const id = mint("prop", this.subject, body);
    return this.add("propositions", id, { proposition_id: id, ...body });
  }

  requirement(value, field) {
    const mark = this.mark();
    const compiled = this.requirementNodes(value, field);
    return Object.freeze({ ...compiled, added: this.since(mark) });
  }

  requirementNodes(value, field) {
    if (value === null || typeof value !== "object") {
      fail("controlled_contract_requirement_invalid", `${field} is missing`, { field });
    }
    const nature = value.nature ?? "behavior";
    if (!this.vocabulary.claim_natures.includes(nature)) {
      fail("controlled_contract_requirement_invalid",
        `${field}.nature is not a controlled claim nature`,
        finiteVocabularyDetails(`${field}.nature`, nature,
          this.vocabulary.claim_natures, "claim_natures", { nature }));
    }
    if (!this.vocabulary.modalities.includes(value.modality)) {
      fail("controlled_contract_requirement_invalid",
        `${field}.modality is not a controlled modality`,
        finiteVocabularyDetails(`${field}.modality`, value.modality,
          this.vocabulary.modalities, "modalities", { modality: value.modality ?? null }));
    }
    const subjectId = this.referent(value.subject, `${field}.subject`);
    const behaviourId = this.proposition(subjectId, value.behavior,
      `${field}.behavior`);
    const claimBody = { kind: nature, modality: value.modality,
      proposition_id: behaviourId };
    const claimId = mint("claim", this.subject, claimBody);
    this.add("claims", claimId, { claim_id: claimId, ...claimBody });
    if (value.verification === undefined) {
      return { claim_id: claimId, verification_claim_id: null, test_proof_id: null,
        test_proof_disposition: null };
    }
    const verification = value.verification;
    if (!this.vocabulary.verification_methods.includes(verification.method)) {
      fail("controlled_contract_requirement_invalid",
        `${field}.verification.method is not a controlled verification method`,
        finiteVocabularyDetails(`${field}.verification.method`, verification.method,
          this.vocabulary.verification_methods,
          "verification_methods", { method: verification.method ?? null }));
    }
    const verifierId = this.referent(verification.verifier,
      `${field}.verification.verifier`);
    const observesId = this.proposition(verifierId, verification.observes,
      `${field}.verification.observes`);

    const falsifyingId = this.proposition(subjectId, verification.fails_when,
      `${field}.verification.fails_when`);

    const verificationModality = DEFAULT_MANDATORY_MODALITIES.includes(value.modality)
      ? "MUST" : value.modality === "MAY" ? "MAY" : "SHOULD";
    const verificationBody = { kind: "verification", modality: verificationModality,
      proposition_id: observesId, verification_method: verification.method,
      falsifying_proposition_id: falsifyingId };
    const verificationClaimId = mint("claim", this.subject, verificationBody);
    this.add("claims", verificationClaimId,
      { claim_id: verificationClaimId, ...verificationBody });
    const relationBody = { role: "verifies", source_claim_id: verificationClaimId,
      target_claim_id: claimId };
    const relationId = mint("rel", this.subject, relationBody);
    this.add("relations", relationId, { relation_id: relationId, ...relationBody });

    const proof = verification.method === "test_execution" &&
      verification.runtime_test !== undefined
      ? this.runtimeProof({ verification, verificationClaimId, observesId,
        falsifyingId, field })
      : null;
    return { claim_id: claimId, verification_claim_id: verificationClaimId,
      test_proof_id: proof?.test_proof_id ?? null,
      test_proof_disposition: proof?.disposition ?? null };
  }

  runtimeProof(input) {
    try {
      return this.composeRuntimeProof(input);
    } catch (error) {
      throw locateRuntimeTestRefusal(error, input.verification.runtime_test ?? null,
        input.field + ".verification.runtime_test");
    }
  }

  composeRuntimeProof({ verification, verificationClaimId, observesId, falsifyingId,
    field }) {
    const runtimeTest = verification.runtime_test ?? null;
    const subjects = (runtimeTest?.boundary?.subjects ?? undefined);
    if (Array.isArray(subjects) && subjects.length >
        CONTROLLED_CONTRACT_RUNTIME_TEST_LIMITS.boundary_subjects) {
      fail("controlled_contract_requirement_invalid",
        `${field}.verification.runtime_test.boundary.subjects carries more referents than one boundary admits`,
        { field, maximum: CONTROLLED_CONTRACT_RUNTIME_TEST_LIMITS.boundary_subjects });
    }
    const binding = composeControlledContractRuntimeTestProof({
      template: buildControlledContractRuntimeTestTemplate(this.buildTestProofTemplate, { contract: null,
        verificationId: verificationClaimId, strategy: runtimeTest?.falsifier?.strategy },
      `${field}.verification.runtime_test`),
      currentBinding: this.testProofs.get(verificationClaimId) ?? null,
      runtimeTest,

      boundarySubjectReferenceIds: Array.isArray(subjects)
        ? subjects.map((entry, index) => this.referent(entry,
          `${field}.verification.runtime_test.boundary.subjects[${index}]`))
        : undefined,

      observesPropositionId: observesId,
      falsifyingPropositionId: falsifyingId,
      field: `${field}.verification.runtime_test`
    });
    return Object.freeze({ test_proof_id: binding.test_proof_id,
      disposition: this.disposeTestProof(verificationClaimId, binding) });
  }
}

export function compileControlledContractRequirements({
  wkId, focus = null, answer, contract = null, vocabulary, schemaIdentity,
  buildTestProofTemplate, retainedReferenceIds = []
}) {
  const requirements = answer.requirements ?? [];
  const retireClaimIds = answer.retire_claim_ids ?? [];

  const count = requirements.length + retireClaimIds.length;
  const populations = [["requirements", requirements], ["retire_claim_ids", retireClaimIds]];
  const emptySupplied = populations.find(([key, list]) => Object.hasOwn(answer, key) && list.length === 0);
  if (!Array.isArray(requirements) || !Array.isArray(retireClaimIds) || emptySupplied !== undefined ||
      count === 0 || count > CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer) {

    fail("controlled_contract_requirement_invalid",
      "one authoring answer carries between one and its bounded number of requirements",
      { maximum: CONTROLLED_CONTRACT_REQUIREMENT_LIMITS.requirements_per_answer,
        ...(Object.hasOwn(answer, "retire_claim_ids") || !Object.hasOwn(answer, "requirements") ? {
          field: emptySupplied?.[0] ?? "",
          requirement_count: requirements.length,
          retirement_count: retireClaimIds.length, guidance_path: guidanceLocation("requirement_retirement") } : {}) });
  }
  const correctionTargets = requirementCorrectionTargets(contract, requirements);
  const retirementTargets = requirementRetirementTargets(contract, retireClaimIds, correctionTargets);
  const compilation = new RequirementCompilation({ wkId, focus, vocabulary, contract,
    buildTestProofTemplate });
  const compiled = requirements.map((requirement, index) =>
    compilation.requirement(requirement, `requirements[${index}]`));

  for (const [index, entry] of (answer.unrepresentable_meaning ?? []).entries()) {
    if (!vocabulary.residue_reasons.includes(entry?.reason)) {
      fail("controlled_contract_requirement_invalid",
        `unrepresentable_meaning[${index}].reason is not a controlled residue reason`,
        finiteVocabularyDetails(`unrepresentable_meaning[${index}].reason`, entry?.reason,
          vocabulary.residue_reasons, "residue_reasons", { reason: entry?.reason ?? null }));
    }
    const body = { reason: entry.reason,
      text: text(entry.text, `unrepresentable_meaning[${index}].text`),
      ...(entry.candidate_concept === undefined
        ? {} : { candidate_concept: entry.candidate_concept }) };
    const id = mint("res", compilation.subject, body);
    compilation.add("residue", id, { residue_id: id, ...body });
  }
  for (const [index, entry] of (answer.notes ?? []).entries()) {
    if (!vocabulary.note_kinds.includes(entry?.kind)) {
      fail("controlled_contract_requirement_invalid",
        `notes[${index}].kind is not a controlled note kind`,
        finiteVocabularyDetails(`notes[${index}].kind`, entry?.kind,
          vocabulary.note_kinds, "note_kinds", { kind: entry?.kind ?? null }));
    }
    const body = { kind: entry.kind, text: text(entry.text, `notes[${index}].text`) };
    const id = mint("ann", compilation.subject, body);
    compilation.add("annotations", id, { annotation_id: id, ...body });
  }

  const { content, corrections, retirements } = applyRequirementCorrections({
    schema_version: schemaIdentity.schema_version,
    vocabulary_version: schemaIdentity.vocabulary_version,
    profile_id: schemaIdentity.profile_id,
    references: [...compilation.references.values()],
    propositions: [...compilation.propositions.values()],
    claims: [...compilation.claims.values()],
    relations: [...compilation.relations.values()],
    collections: structuredClone(contract?.collections ?? []),
    residue: [...compilation.residue.values()],
    annotations: [...compilation.annotations.values()],
    test_proof_version: schemaIdentity.test_proof_version,

    test_proofs: [...compilation.testProofs.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, binding]) => binding)
  }, requirements, compiled, correctionTargets, retainedReferenceIds, retirementTargets);
  return Object.freeze({ content, corrections, retirements,
    compiled: Object.freeze(compiled.map((entry, index) => Object.freeze({
      ...entry,
      replaced_claim_id: requirements[index].replace_claim_id ?? null
    }))),
    added: Object.freeze({
      references: Object.freeze([...compilation.added.references]),
      propositions: Object.freeze([...compilation.added.propositions]),
      claims: Object.freeze([...compilation.added.claims]),
      relations: Object.freeze([...compilation.added.relations]),
      residue: Object.freeze([...compilation.added.residue]),
      annotations: Object.freeze([...compilation.added.annotations]),
      test_proofs: Object.freeze([...compilation.added.testProofs])
    }),

    replaced: Object.freeze({
      test_proofs: Object.freeze([...compilation.replaced.testProofs])
    }) });
}

export function controlledContractRequirementPatchOperations({ compiled }) {
  const byPopulation = Object.freeze({ references: "references",
    propositions: "propositions", claims: "claims", relations: "relations",
    residue: "residue", annotations: "annotations" });
  const index = Object.freeze({
    references: new Map(compiled.content.references.map((entry) =>
      [entry.reference_id, entry])),
    propositions: new Map(compiled.content.propositions.map((entry) =>
      [entry.proposition_id, entry])),
    claims: new Map(compiled.content.claims.map((entry) => [entry.claim_id, entry])),
    relations: new Map(compiled.content.relations.map((entry) =>
      [entry.relation_id, entry])),
    residue: new Map(compiled.content.residue.map((entry) =>
      [entry.residue_id, entry])),
    annotations: new Map(compiled.content.annotations.map((entry) =>
      [entry.annotation_id, entry]))
  });
  return Object.entries(byPopulation).flatMap(([population, target]) =>
    compiled.added[population].map((id) => Object.freeze({
      op: "upsert", target, id, value: structuredClone(index[population].get(id))
    })));
}

export function controlledContractRequirementVerificationBundles({ compiled }) {
  const index = Object.freeze({
    references: new Map(compiled.content.references.map((entry) =>
      [entry.reference_id, entry])),
    propositions: new Map(compiled.content.propositions.map((entry) =>
      [entry.proposition_id, entry])),
    claims: new Map(compiled.content.claims.map((entry) => [entry.claim_id, entry])),
    relations: new Map(compiled.content.relations.map((entry) =>
      [entry.relation_id, entry])),
    residue: new Map(compiled.content.residue.map((entry) =>
      [entry.residue_id, entry])),
    annotations: new Map(compiled.content.annotations.map((entry) =>
      [entry.annotation_id, entry])),
    test_proofs: new Map(compiled.content.test_proofs.map((entry) =>
      [entry.verification_claim_id, entry]))
  });

  const added = new Set(compiled.added.test_proofs);
  const runtime = compiled.compiled.filter(({ verification_claim_id: id }) =>
    id !== null && added.has(id));

  if (compiled.replaced.test_proofs.length > 0) fail(
    "controlled_contract_requirement_runtime_replacement_not_isolated",
    "an answer that changes an existing stable test proof publishes through the replacement owner alone",
    { replaced_verification_ids: [...compiled.replaced.test_proofs],
      failed_constraint: "existing_runtime_test_replacement_isolated_from_other_requirement_changes",
      safe_correction: "Resubmit the changed runtime-test requirement by itself; the refused answer changed nothing.",
      next_answer: "restate the changed runtime-test requirement as its own answer" }
  );

  const answerLevel = Object.freeze({
    residue: compiled.added.residue,
    annotations: compiled.added.annotations
  });
  const claimed = new Set(runtime.flatMap(({ added }) =>
    [...added.references, ...added.propositions, ...added.claims,
      ...added.relations]));
  const orphaned = ["references", "propositions", "claims", "relations"]
    .flatMap((population) => compiled.added[population])
    .filter((id) => !claimed.has(id));
  if (orphaned.length > 0) fail(
    "controlled_contract_requirement_runtime_answer_not_isolated",
    "an answer that adds a runtime-test requirement to an existing contract carries only runtime-test requirements",
    { orphaned_node_count: orphaned.length,
      failed_constraint: "existing_contract_test_execution_additions_partitioned_from_analysis_and_unproven_requirements",
      safe_correction: "Split the unchanged semantic input by verification method: submit the test_execution requirements together, then submit analysis or other requirements in a separate answer. The refused mixed answer changed nothing.",
      next_answer: "author the remaining requirements as their own contract_requirements answer" }
  );
  const rows = (ids, store) => ids.map((id) => structuredClone(store.get(id)));
  return runtime.map(({ verification_claim_id: verificationId, added }, position) =>
    Object.freeze({ op: "upsert", verification_id: verificationId,
      bundle: {
        schema_version: "controlled-contract-verification-bundle.v1",
        verification_id: verificationId,
        references: rows(added.references, index.references),
        propositions: rows(added.propositions, index.propositions),
        claims: rows(added.claims, index.claims),
        relations: rows(added.relations, index.relations),
        collections: [],
        residue: position === 0 ? rows(answerLevel.residue, index.residue) : [],
        annotations: position === 0
          ? rows(answerLevel.annotations, index.annotations) : [],
        test_proof: structuredClone(index.test_proofs.get(verificationId))
      } }));
}

export function attributeControlledContractRequirementDiagnostics(error, compilation) {
  const diagnostics = error?.details?.diagnostics?.diagnostics;
  if (!(error instanceof ControlledContractToolError) || !Array.isArray(diagnostics) ||
      !Array.isArray(compilation?.compiled)) return error;
  const requirementByClaim = new Map(compilation.compiled.map((entry, index) =>
    [entry.claim_id, "requirements[" + index + "]"]));
  const attributions = diagnostics.flatMap((diagnostic) => {
    const requirement = requirementByClaim.get(diagnostic?.claim_id);
    if (requirement === undefined || diagnostic.code !== "mandatory_behavior_unverified") {
      return [];
    }
    return [{ code: diagnostic.code, claim_id: diagnostic.claim_id,
      field: requirement + ".verification",
      guidance_path: guidanceLocation("mandatory_verification") }];
  });
  if (attributions.length === 0) return error;
  error.details = { ...error.details, requirement_attributions: attributions };
  return error;
}
