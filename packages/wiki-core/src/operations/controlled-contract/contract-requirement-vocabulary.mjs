

export const CONTROLLED_CONTRACT_REQUIREMENT_LIMITS = Object.freeze({
  requirements_per_answer: 8,
  context_referents: 4,
  residue_per_answer: 8,
  criteria_offered: 32,
  notes_per_answer: 8,
  text_bytes: 4_096
});

export const CONTROLLED_CONTRACT_REQUIREMENT_INPUT_SHAPES = Object.freeze({
  referent: Object.freeze({
    schema_version: "controlled-contract-referent-input.v1",
    one_of: Object.freeze([
      Object.freeze({ select: "<returned selector>" }),
      Object.freeze({ declare: Object.freeze({
        type_term: "<vocabulary.type_terms member>",
        identity: "<vocabulary.identity_kinds member shape>"
      }) })
    ]),
    constraint_owners: Object.freeze({
      selectors: "declared_referents",
      type_terms: "vocabulary.type_terms",
      identity_shapes: "vocabulary.identity_kinds"
    })
  }),
  statement: Object.freeze({
    schema_version: "controlled-contract-statement-input.v1",
    shape: Object.freeze({
      relation: "<selected relation term>",
      objects: "<array of relation-owned operand shapes>",
      applies: "<optional applicability mode and referent context>"
    }),
    constraint_owners: Object.freeze({
      relation_terms: "vocabulary.relations_by_object_kind",
      operand_kinds_and_cardinalities: "vocabulary.relation_details",
      applicability: "vocabulary.relation_details[].applicability_modes and vocabulary.applicability_modes"
    })
  })
});

function operandKindFromRef(reference) {
  return String(reference).split("/").pop().replace(/_operand$/u, "");
}

function deriveOperatorSignatures(schema) {
  const proposition = schema.$defs.proposition;
  const signatures = new Map();
  for (const branch of proposition.anyOf ?? []) {
    const terms = branch.properties?.operator?.enum ?? [];
    const operands = branch.properties?.operands ?? {};
    const reference = operands.items?.$ref ?? operands.items?.allOf?.[0]?.$ref ?? null;
    if (reference === null) continue;
    const signature = Object.freeze({
      operand_kind: operandKindFromRef(reference),
      minimum_operands: operands.minItems ?? 1,
      maximum_operands: operands.maxItems ?? null,
      applicability_modes: Object.freeze([
        ...(branch.properties?.applicability_context?.properties?.mode?.enum ?? [])])
    });
    for (const term of terms) signatures.set(term, signature);
  }
  return signatures;
}

function deriveApplicabilityModes(schema) {
  const modes = new Map();
  for (const branch of schema.$defs.applicability_context.oneOf ?? []) {
    const [mode] = branch.properties?.mode?.enum ?? [];
    if (mode === undefined) continue;
    const operands = branch.properties?.operand_reference_ids ?? {};
    modes.set(mode, Object.freeze({ mode,
      minimum_context: operands.minItems ?? 0,
      maximum_context: operands.maxItems ?? null }));
  }
  return modes;
}

function deriveIdentityKinds(schema) {
  return (schema.$defs.reference.properties.identity.oneOf ?? []).map((branch) =>
    Object.freeze({
      kind: branch.properties.kind.enum[0],
      required_fields: Object.freeze([...branch.required].filter(
        (field) => field !== "kind")),
      optional_fields: Object.freeze(Object.keys(branch.properties)
        .filter((field) => field !== "kind" && !branch.required.includes(field)))
    }));
}

export function deriveControlledContractAuthoringVocabulary(schema) {
  return Object.freeze({
    operator_signatures: deriveOperatorSignatures(schema),
    applicability_modes: deriveApplicabilityModes(schema),
    type_terms: Object.freeze([...schema.$defs.reference.properties.type_term.enum]),
    identity_kinds: Object.freeze(deriveIdentityKinds(schema)),
    modalities: Object.freeze([
      ...schema.$defs.declarative_claim.properties.modality.enum]),
    claim_natures: Object.freeze([
      ...schema.$defs.declarative_claim.properties.kind.enum]),
    verification_methods: Object.freeze([
      ...schema.$defs.verification_claim.properties.verification_method.enum]),
    residue_reasons: Object.freeze([...schema.$defs.residue.properties.reason.enum]),
    note_kinds: Object.freeze([...schema.$defs.annotation.properties.kind.enum])
  });
}

function localRelationName(term, objectKind) {
  const prefix = `${objectKind}:`;
  return term.startsWith(prefix) ? term.slice(prefix.length) : term;
}

export const RELATION_APPLICABILITY_ALL_DECLARED_MODES = "all_declared_modes";
export const RELATION_APPLICABILITY_RESTRICTED = "restricted_modes";

export function publishAuthoringVocabularyForGuidance(projection) {
  const declaredModes = new Set(projection.applicability_modes.map(({ mode }) => mode));
  return Object.freeze({
    ...projection,

    relation_applicability_statement:
      `A relation row carries applicability: "${RELATION_APPLICABILITY_ALL_DECLARED_MODES}" when it ` +
      "admits every mode in this object's applicability_modes, and " +
      `applicability: "${RELATION_APPLICABILITY_RESTRICTED}" with its own exact applicability_modes ` +
      "when it admits fewer. restricted_applicability lists the same narrowing rows by term.",
    relation_details: Object.freeze(projection.relation_details.map((detail) => {
      const { applicability_modes: modes, ...rest } = detail;
      const admitsEveryMode = modes.length === declaredModes.size &&
        modes.every((mode) => declaredModes.has(mode));
      return Object.freeze(admitsEveryMode
        ? { ...rest, applicability: RELATION_APPLICABILITY_ALL_DECLARED_MODES }
        : {
          ...rest,
          applicability: RELATION_APPLICABILITY_RESTRICTED,
          applicability_modes: modes
        });
    }))
  });
}

export function projectControlledContractAuthoringVocabulary(vocabulary) {
  const relationDetails = Object.freeze([...vocabulary.operator_signatures.entries()]
    .map(([term, signature]) => Object.freeze({
      term,
      operand_kind: signature.operand_kind,
      minimum_operands: signature.minimum_operands,
      maximum_operands: signature.maximum_operands,
      applicability_modes: signature.applicability_modes
    }))
    .sort((left, right) => left.term.localeCompare(right.term)));
  return Object.freeze({
    schema_version: "controlled-contract-requirement-vocabulary.v1",
    modalities: vocabulary.modalities,
    claim_natures: vocabulary.claim_natures,
    verification_methods: vocabulary.verification_methods,
    type_terms: vocabulary.type_terms,
    identity_kinds: vocabulary.identity_kinds,
    residue_reasons: vocabulary.residue_reasons,
    note_kinds: vocabulary.note_kinds,
    applicability_modes: Object.freeze([...vocabulary.applicability_modes.values()]),
    relation_accounting: Object.freeze({
      total: relationDetails.length,
      returned: relationDetails.length,
      omitted: 0
    }),
    relation_details: relationDetails,

    relation_term_format: "<object_kind>:<name>",
    relations_by_object_kind: Object.freeze(Object.fromEntries(
      [...new Set([...vocabulary.operator_signatures.values()]
        .map(({ operand_kind: kind }) => kind))].sort().map((kind) => [kind,
        Object.freeze([...vocabulary.operator_signatures.entries()]
          .filter(([, signature]) => signature.operand_kind === kind)
          .map(([term]) => localRelationName(term, kind)).sort())]))),
    single_object_relations_by_object_kind: Object.freeze(Object.fromEntries(
      [...new Set([...vocabulary.operator_signatures.values()]
        .map(({ operand_kind: kind }) => kind))].sort().map((kind) => [kind,
        Object.freeze([...vocabulary.operator_signatures.entries()]
          .filter(([, signature]) => signature.operand_kind === kind &&
            signature.maximum_operands === 1)
          .map(([term]) => localRelationName(term, kind)).sort())]))),

    restricted_applicability: Object.freeze([...vocabulary.operator_signatures
      .entries()]
      .filter(([, signature]) =>
        signature.applicability_modes.length < vocabulary.applicability_modes.size)
      .map(([term, signature]) => Object.freeze({ term,
        admitted_modes: signature.applicability_modes }))
      .sort((left, right) => left.term.localeCompare(right.term)))
  });
}

function referentLabel(identity) {
  return identity?.symbol ?? identity?.path ?? identity?.term ??
    identity?.value ?? identity?.name ?? null;
}

export function projectControlledContractClaimSelectors(contract, limit = 64) {
  const references = new Map((contract?.references ?? []).map((entry) =>
    [entry.reference_id, entry]));
  const propositions = new Map((contract?.propositions ?? []).map((entry) =>
    [entry.proposition_id, entry]));
  const relations = contract?.relations ?? [];
  const summary = (claim) => {
    const proposition = propositions.get(claim.proposition_id) ?? null;
    const subject = references.get(proposition?.subject_reference_id ?? "") ?? null;
    return {
      selector: claim.claim_id,
      nature: claim.kind,
      modality: claim.modality,
      verification_method: claim.verification_method ?? null,
      subject: referentLabel(subject?.identity),
      relation: proposition?.operator ?? null,
      objects: Object.freeze((proposition?.operands ?? []).map((operand) =>
        operand.kind === "reference"
          ? referentLabel(references.get(operand.reference_id)?.identity)
          : operand.value ?? null))
    };
  };
  return Object.freeze((contract?.claims ?? []).slice(0, limit).map((claim) => {
    const verifies = relations.filter((relation) => relation.role === "verifies" &&
      relation.source_claim_id === claim.claim_id).map((relation) =>
      relation.target_claim_id);
    const verifiedBy = relations.filter((relation) => relation.role === "verifies" &&
      relation.target_claim_id === claim.claim_id).map((relation) =>
      relation.source_claim_id);
    return Object.freeze({ ...summary(claim),
      verifies: Object.freeze(verifies),

      verified_by: Object.freeze(verifiedBy)
    });
  }));
}

export function projectControlledContractReferentSelectors(contract, limit = 64) {
  return Object.freeze((contract?.references ?? []).slice(0, limit).map((entry) =>
    Object.freeze({ selector: entry.reference_id, type_term: entry.type_term,
      identity: Object.freeze(structuredClone(entry.identity)) })));
}
