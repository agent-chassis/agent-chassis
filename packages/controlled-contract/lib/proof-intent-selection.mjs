import { referenceRoleValueMatches } from './proof-parameter-refinements.mjs';
import { createHash } from "node:crypto";

import { compiledValidatorCacheAvailability } from "./compiled-validator-cache.mjs";
import {
  ProofIntentSelectionError,
  assertPackagedProofIntentMetadata,
  deriveProofIntentSelection,
  normalizeIntentArtifact,
  normalizeProofPackCatalog,
  readPackagedProofIntentMetadata
} from "./proof-intent-metadata.mjs";
import { reduceProofIntentSelectionStatus } from
  "./proof-intent-selection-status.mjs";
import { validateIntentArtifact, validateSelectionResult, validateSelectionResultV2, validateProofPackAuthoringProjection } from "./proof-authoring-schemas.mjs";
const MAX_AUTHORING_PROJECTION_BYTES = 65_536;

function compareCodeUnits(left, right) {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort(compareCodeUnits).map(
      (key) => [key, canonicalValue(value[key])]
    )
  );
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function canonicalDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

function packKey({ profile_id: profileId, profile_version: version }) {
  return `${profileId}@${version}`;
}

const packagedMetadata = readPackagedProofIntentMetadata();
const PROOF_INTENT_ARTIFACT = deepFreeze(structuredClone(packagedMetadata.selection.intent_artifact));
const PROOF_INTENT_DIGESTS = deepFreeze(structuredClone(packagedMetadata.selection.digests));
const validatorCache = compiledValidatorCacheAvailability();
const derivedSelection = validatorCache.available ? await deriveProofIntentSelection() : null;
if (derivedSelection !== null) {
  assertPackagedProofIntentMetadata("selection", packagedMetadata.selection, {
    intent_artifact: derivedSelection.intent_artifact, digests: derivedSelection.digests });
}
const loadedPacks = derivedSelection?.loadedPacks ?? null;
const packByIdentity = loadedPacks === null ? null : new Map(loadedPacks.map((pack) => [packKey({
  profile_id: pack.profile.profile_id,
  profile_version: pack.profile.profile_version
}), pack]));

function admittedPacks() {
  if (loadedPacks === null) throw validatorCache.cause;
  return { loadedPacks, packByIdentity };
}

function requiredInput(inputId) {
  const mapping = {
    controlled_contract: [
      "controlled_contract_required",
      "Supply the controlled contract being assessed."
    ],
    evaluation_input: [
      "evaluation_input_required",
      "Supply a pack-specific evaluation input bound by digest in the proof plan."
    ]
  };
  return {
    input_id: inputId,
    reason_code: mapping[inputId][0],
    remediation: mapping[inputId][1]
  };
}

function missingCompatibleReferenceTypes(contract, pack) {
  const missing = [];
  for (const role of pack.profile.reference_roles ?? []) {
    if (!(contract?.references ?? []).some(reference => referenceRoleValueMatches(role, reference))) missing.push({
      input_id: `reference_role:${role.role}`,
      reason_code: "compatible_contract_reference_type_missing",
      remediation: `Add or identify ${role.cardinality} contract reference(s) for the ${role.role} role using one of its allowed type terms.`
    });
  }
  return missing.sort((left, right) => compareCodeUnits(left.input_id, right.input_id));
}

function sortedBy(values, key) {
  return [...values].sort((left, right) => compareCodeUnits(key(left), key(right)));
}

function renderOperand(operand) {
  if (operand.kind === "reference") return `$${operand.role}`;
  if (operand.kind === "number" && "value_role" in operand) {
    return `number($${operand.value_role})`;
  }
  if (operand.kind === "number") return `number(${operand.value})`;
  if (operand.kind === "boolean") return `boolean(${operand.value})`;
  if (operand.kind === "range") return `range(minimum=${operand.minimum})`;
  throw new ProofIntentSelectionError(
    "proof_pack_authoring_operand_unknown",
    "the admitted profile contains an operand the authoring projection cannot render",
    { operand }
  );
}

function renderApplicability(applicability) {
  if (applicability.operand_roles.length === 0) return `@${applicability.mode}`;
  return `@${applicability.mode}(${applicability.operand_roles.map(
    (role) => `$${role}`
  ).join(", ")})`;
}

function renderProposition(template) {
  const operands = template.operands.map(renderOperand).join(", ");
  return [
    `$${template.subject_role}`,
    template.operator,
    operands.length === 0 ? null : `[${operands}]`,
    renderApplicability(template.applicability_context)
  ].filter((part) => part !== null).join(" ");
}

function authoringIntentDefinitions(intentDefinitions) {
  return sortedBy(intentDefinitions.map(({ intent_id: intentId, definition }) => ({
    intent_id: intentId,
    definition
  })), ({ intent_id: intentId }) => intentId);
}

function authoringIntentDistinctions(intentDefinitions) {
  const selectedIds = new Set(intentDefinitions.map(({ intent_id: id }) => id));
  const selectedEdges = intentDefinitions.flatMap((intent) =>
    intent.distinctions.map(({ from_intent_id: otherId, explanation }) => ({
      intent_id: intent.intent_id,
      from_intent_id: otherId,
      explanation
    }))
  );
  const representedPairs = new Set(selectedEdges.map((edge) =>
    sortedUnique([edge.intent_id, edge.from_intent_id]).join("\0")
  ));
  const inboundEdges = PROOF_INTENT_ARTIFACT.intents.flatMap((intent) =>
    intent.distinctions.filter(({ from_intent_id: otherId }) =>
      !selectedIds.has(intent.intent_id) && selectedIds.has(otherId) &&
      !representedPairs.has(sortedUnique([intent.intent_id, otherId]).join("\0"))
    ).map(({ from_intent_id: otherId, explanation }) => ({
      intent_id: intent.intent_id,
      from_intent_id: otherId,
      explanation
    }))
  );
  return sortedBy([...selectedEdges, ...inboundEdges], (distinction) =>
    `${distinction.intent_id}\0${distinction.from_intent_id}`
  );
}

function projectedClaimPattern(pattern) {
  return {
    pattern_id: pattern.pattern_id,

    claim_kind: pattern.claim_kind,
    allowed_modalities: sortedUnique(pattern.allowed_modalities),
    proposition: renderProposition(pattern.proposition_template),
    ...(pattern.for_each ? { for_each: structuredClone(pattern.for_each) } : {}),
    ...(pattern.verification_methods ? {
      verification_methods: sortedUnique(pattern.verification_methods)
    } : {}),
    ...(pattern.falsifying_proposition_template ? {
      falsifying_proposition: renderProposition(
        pattern.falsifying_proposition_template
      )
    } : {})
  };
}

function projectionCounts(profile) {
  return {
    reference_roles: (profile.reference_roles ?? []).length,
    number_roles: (profile.number_roles ?? []).length,
    binding_constraint_patterns: (profile.binding_constraint_patterns ?? []).length,
    reference_binding_patterns: (profile.reference_binding_patterns ?? []).length,
    claim_patterns: (profile.claim_patterns ?? []).length,
    relation_patterns: (profile.relation_patterns ?? []).length,
    collection_patterns: (profile.collection_patterns ?? []).length,
    resolver_fact_patterns: (profile.resolver_fact_patterns ?? []).length,
    evidence_patterns: (profile.evidence_patterns ?? []).length,
    falsifier_occurrence_bindings:
      (profile.falsifier_occurrence_bindings ?? []).length
  };
}

function buildProofPackAuthoringProjection(pack, intentDefinitions) {
  const profile = pack.profile;
  const body = {
    schema_version: "controlled-contract-proof-pack-authoring.v2",
    digest_algorithm: "sha256-canonical-json-v1",
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    requested_intents: sortedUnique(intentDefinitions.map(
      ({ intent_id: intentId }) => intentId
    )),
    intent_definitions: authoringIntentDefinitions(intentDefinitions),
    intent_distinctions: authoringIntentDistinctions(intentDefinitions),
    guarantee: pack.admission.guarantee,
    explicit_exclusions: sortedUnique(pack.admission.explicit_exclusions),
    compatibility: {
      contract_schema_version: profile.contract_schema_version,
      vocabulary_version: profile.vocabulary_version,
      admission_schema_version: pack.admission.schema_version
    },
    evaluation_input_skeleton: {
      input_version:
        "controlled-contract-verification-profile-input.v2",

      reference_bindings: sortedBy((profile.reference_roles ?? []).map((role) => ({
        role: role.role,
        cardinality: role.cardinality,
        allowed_type_terms: sortedUnique(role.allowed_type_terms),
        allowed_identity_kinds: sortedUnique(role.allowed_identity_kinds ?? []),
        value_source: "caller_supplied_contract_reference_ids"
      })), ({ role }) => role),
      number_bindings: sortedBy((profile.number_roles ?? []).map((role) => ({
        role: role.role,
        cardinality: role.cardinality,
        number_type: role.number_type,
        ...(role.minimum === undefined ? {} : { minimum: role.minimum }),
        ...(role.maximum === undefined ? {} : { maximum: role.maximum }),
        value_source: "caller_supplied_number"
      })), ({ role }) => role),
      claim_pattern_bindings:
        "optional_only_to_resolve_an_ambiguous_pattern_match",
      resolver_facts: (profile.resolver_fact_patterns ?? []).length === 0
        ? "not_required"
        : "supply_every_required_resolver_fact_pattern",
      delivered_evidence: (profile.evidence_patterns ?? []).length === 0
        ? "not_required"
        : "supply_every_required_delivered_evidence_pattern"
    },
    role_constraints: {
      binding_constraint_patterns: sortedBy(
        structuredClone(profile.binding_constraint_patterns ?? []),
        ({ pattern_id: patternId }) => patternId
      ),
      distinct_reference_role_sets: sortedBy(
        (profile.distinct_reference_role_sets ?? []).map(({ roles }) => ({
          roles: sortedUnique(roles)
        })), ({ roles }) => roles.join("\0")
      ),
      reference_binding_patterns: sortedBy(
        structuredClone(profile.reference_binding_patterns ?? []),
        ({ pattern_id: patternId }) => patternId
      ),
      reference_role_count_bindings: sortedBy(
        structuredClone(profile.reference_role_count_bindings ?? []),
        ({ reference_role: role, number_role: numberRole }) =>
          `${role}\0${numberRole}`
      )
    },
    proof_obligations: {
      claim_patterns: sortedBy((profile.claim_patterns ?? []).map(projectedClaimPattern),
        ({ pattern_id: patternId }) => patternId),
      relation_patterns: sortedBy(structuredClone(profile.relation_patterns ?? []),
        ({ pattern_id: patternId }) => patternId),
      collection_patterns: sortedBy(structuredClone(profile.collection_patterns ?? []),
        ({ pattern_id: patternId }) => patternId),
      resolver_fact_patterns: sortedBy(
        structuredClone(profile.resolver_fact_patterns ?? []),
        ({ pattern_id: patternId }) => patternId
      ),
      evidence_patterns: sortedBy(structuredClone(profile.evidence_patterns ?? []),
        ({ pattern_id: patternId }) => patternId),
      falsifier_condition_bindings: sortedBy(
        structuredClone(profile.falsifier_condition_bindings ?? []),
        ({ relation_pattern_id: patternId }) => patternId
      ),
      falsifier_occurrence_bindings: sortedBy(
        structuredClone(profile.falsifier_occurrence_bindings ?? []),
        ({ relation_pattern_id: patternId }) => patternId
      ),
      verification_falsifier_policy: profile.verification_falsifier_policy,
      satisfaction_expression: structuredClone(profile.satisfaction_expression)
    },
    counts: projectionCounts(profile),
    source_digests: {
      profile: pack.profile_digest,
      admission: pack.admission_digest,
      guarantee: pack.admission.guarantee_digest,
      intent_artifact: PROOF_INTENT_DIGESTS.intent_artifact
    },
    authority: "non_authoritative"
  };
  const result = {
    ...body,
    projection_digest: canonicalDigest(body)
  };
  const byteLength = Buffer.byteLength(canonicalJson(result), "utf8");
  if (byteLength > MAX_AUTHORING_PROJECTION_BYTES) {
    throw new ProofIntentSelectionError(
      "proof_pack_authoring_projection_too_large",
      "the admitted proof pack exceeds the bounded authoring projection",
      {
        profile_id: profile.profile_id,
        profile_version: profile.profile_version,
        byte_length: byteLength,
        maximum_bytes: MAX_AUTHORING_PROJECTION_BYTES
      }
    );
  }
  if (!validateProofPackAuthoringProjection(result)) {
    throw new ProofIntentSelectionError(
      "proof_pack_authoring_projection_invalid",
      "the admitted proof pack produced an invalid authoring projection",
      { diagnostics: structuredClone(validateProofPackAuthoringProjection.errors) }
    );
  }
  return deepFreeze(structuredClone(result));
}

function resolveAuthoringIntentDefinitions(pack, requestedIntents) {
  const capable = PROOF_INTENT_ARTIFACT.intents.filter((intent) =>
    intent.capable_packs.some((candidate) => packKey(candidate) === packKey({
      profile_id: pack.profile.profile_id,
      profile_version: pack.profile.profile_version
    }))
  );
  if (requestedIntents === undefined || requestedIntents === null) return capable;
  if (!Array.isArray(requestedIntents) || requestedIntents.length === 0 ||
      requestedIntents.some((id) => typeof id !== "string" || id.length === 0) ||
      new Set(requestedIntents).size !== requestedIntents.length) {
    throw new ProofIntentSelectionError(
      "proof_pack_authoring_intent_request_invalid",
      "authoring projection intent ids must be a non-empty unique string array"
    );
  }
  const capableById = new Map(capable.map((intent) => [intent.intent_id, intent]));
  const mismatched = sortedUnique(requestedIntents).filter((id) => !capableById.has(id));
  if (mismatched.length > 0) throw new ProofIntentSelectionError(
    "proof_pack_authoring_intent_mismatch",
    "one or more requested intents do not map to the exact admitted proof pack",
    { requested_intents: mismatched }
  );
  return sortedUnique(requestedIntents).map((id) => capableById.get(id));
}

function describeProofPackAuthoring({
  profileId,
  profileVersion,
  requestedIntents = null
}) {
  if (typeof profileId !== "string" || profileId.length === 0 ||
      typeof profileVersion !== "string" || profileVersion.length === 0) {
    throw new ProofIntentSelectionError(
      "proof_pack_authoring_identity_invalid",
      "authoring projection requires an exact profile id and version"
    );
  }
  const pack = admittedPacks().packByIdentity.get(packKey({
    profile_id: profileId,
    profile_version: profileVersion
  }));
  if (!pack) {

    const candidates = admittedPacks().loadedPacks.filter(({ profile }) =>
      profile.profile_id === profileId).map((candidate) => {
      const authoring = buildProofPackAuthoringProjection(candidate,
        resolveAuthoringIntentDefinitions(candidate, null));
      return {
        selected_pack: { profile_id: authoring.profile_id,
          profile_version: authoring.profile_version },
        requested_intents: authoring.requested_intents,

        source_digests: authoring.source_digests
      };
    });
    throw new ProofIntentSelectionError(
      "proof_pack_authoring_identity_unknown",
      "the exact proof-pack identity is absent from the admitted authoring catalog",
      { changed: false, profile_id: profileId, profile_version: profileVersion,
        selection_scope: "admitted_authoring_catalog",
        runtime_selection: "not_resolved",
        explanation: "Authoring selects an exact admitted catalog identity. " +
          "Implementation verification independently resolves its exact runtime identity; " +
          "this authoring refusal does not establish runtime availability or select a replacement version.",
        recovery: {
          status: candidates.length > 0 ? "semantic_selection_required" : "unavailable",
          candidates,
          discovery_tool: candidates.length > 0
            ? "workspace_controlled_proof_intents_discover" : null,
          semantic_owner: candidates.length > 0
            ? "workspace_controlled_contract_obligation_coverage_upsert" : null,
          next_step: candidates.length > 0
            ? "Discover the intended named proof, then save that proof name and its semantic inputs on the owning obligation."
            : null,
          unavailable_prerequisite: candidates.length > 0 ? null
            : "No admitted authoring candidate exists for the requested profile id."
        }
      }
    );
  }
  return buildProofPackAuthoringProjection(
    pack,
    resolveAuthoringIntentDefinitions(pack, requestedIntents)
  );
}

function assertExpectedDigests(expectedDigests) {
  if (expectedDigests === undefined || expectedDigests === null) return;
  for (const field of ["catalog", "vocabulary", "profiles", "intent_artifact"]) {
    if (expectedDigests[field] !== PROOF_INTENT_DIGESTS[field]) {
      throw new ProofIntentSelectionError(
        "proof_intent_digest_stale",
        `the expected ${field} digest does not identify the shipped selection substrate`,
        {
          digest_kind: field,
          expected: expectedDigests[field] ?? null,
          actual: PROOF_INTENT_DIGESTS[field]
        }
      );
    }
  }
}

function selectProofPacksV2({ contract, requestedIntents, expectedDigests = null }) {
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) {
    throw new ProofIntentSelectionError(
      "proof_intent_contract_invalid", "selection requires one controlled contract object"
    );
  }
  if (!Array.isArray(requestedIntents) || requestedIntents.length === 0 ||
      requestedIntents.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new ProofIntentSelectionError(
      "proof_intent_request_invalid", "selection requires one or more controlled intent ids"
    );
  }
  if (new Set(requestedIntents).size !== requestedIntents.length) {
    throw new ProofIntentSelectionError(
      "proof_intent_request_duplicate", "requested controlled intent ids must be unique"
    );
  }
  assertExpectedDigests(expectedDigests);
  const normalizedIntents = sortedUnique(requestedIntents);
  const intentById = new Map(PROOF_INTENT_ARTIFACT.intents.map((intent) => [
    intent.intent_id, intent
  ]));
  const unknown = normalizedIntents.filter((id) => !intentById.has(id));
  if (unknown.length > 0) throw new ProofIntentSelectionError(
    "proof_intent_unknown",
    "one or more requested controlled proof intents are unknown",
    { unknown_intents: unknown }
  );
  const providedPackByIdentity = new Map(admittedPacks().loadedPacks.map((pack) => [packKey({
    profile_id: pack.profile.profile_id,
    profile_version: pack.profile.profile_version
  }), pack]));
  const hardIncompatibilities = [];
  const candidateIntentIds = new Map();
  for (const intentId of normalizedIntents) {
    const intent = intentById.get(intentId);
    if (intent.capable_packs.length === 0) {
      continue;
    }
    for (const candidate of intent.capable_packs) {
      const key = packKey(candidate);
      const ids = candidateIntentIds.get(key) ?? [];
      ids.push(intentId);
      candidateIntentIds.set(key, ids);
      if (!intent.compatibility.contract_schema_versions.includes(contract.schema_version)) {
        hardIncompatibilities.push({
          ...candidate,
          intent_id: intentId,
          reason_code: "contract_schema_incompatible",
          remediation: `Use a contract schema admitted by ${candidate.profile_id}@${candidate.profile_version}; no semantic substitution is permitted.`
        });
      }
      if (!intent.compatibility.vocabulary_versions.includes(contract.vocabulary_version)) {
        hardIncompatibilities.push({
          ...candidate,
          intent_id: intentId,
          reason_code: "contract_vocabulary_incompatible",
          remediation: `Use a contract vocabulary admitted by ${candidate.profile_id}@${candidate.profile_version}; no semantic substitution is permitted.`
        });
      }
    }
  }
  const candidates = [...candidateIntentIds.entries()].map(([key, ids]) => {
    const pack = providedPackByIdentity.get(key);
    if (!pack) throw new ProofIntentSelectionError(
      "proof_intent_pack_snapshot_missing",
      "a selected admitted pack snapshot is unavailable",
      { pack_identity: key }
    );
    const intentDefinitions = ids.map((id) => intentById.get(id));
    const requiredIds = sortedUnique(intentDefinitions.flatMap(
      ({ required_evaluation_inputs: values }) => values
    ));
    const authoring = buildProofPackAuthoringProjection(pack, intentDefinitions);
    return {
      profile_id: pack.profile.profile_id,
      profile_version: pack.profile.profile_version,
      requested_intents: sortedUnique(ids),
      intent_definitions: structuredClone(authoring.intent_definitions),
      intent_distinctions: structuredClone(authoring.intent_distinctions),
      guarantee: pack.admission.guarantee,
      explicit_exclusions: structuredClone(authoring.explicit_exclusions),
      required_inputs: requiredIds.map(requiredInput),
      missing_compatible_reference_types:
        missingCompatibleReferenceTypes(contract, pack),
      authoring_projection: {
        schema_version: authoring.schema_version,
        digest_algorithm: authoring.digest_algorithm,
        projection_digest: authoring.projection_digest,
        maximum_bytes: MAX_AUTHORING_PROJECTION_BYTES,
        counts: structuredClone(authoring.counts)
      },
      source_digests: {
        profile: pack.profile_digest,
        admission: pack.admission_digest,
        guarantee: pack.admission.guarantee_digest,
        adequacy_declaration:
          pack.admission.certification.adequacy_declaration_digest,
        adequacy_result: pack.admission.certification.adequacy_result_digest
      }
    };
  }).sort((left, right) => compareCodeUnits(packKey(left), packKey(right)));
  const sortedHardIncompatibilities = hardIncompatibilities.sort((left, right) =>
    compareCodeUnits(`${left.intent_id}\0${packKey(left)}`,
      `${right.intent_id}\0${packKey(right)}`)
  );
  const candidateByIdentity = new Map(candidates.map((candidate) => [
    packKey(candidate), candidate
  ]));
  const missingBindingsByIdentity = new Map(candidates.map((candidate) => {
    const bindings = [
      ...candidate.required_inputs.filter(({ input_id: id }) =>
        id !== "controlled_contract"),
      ...candidate.missing_compatible_reference_types
    ].sort((left, right) => compareCodeUnits(left.input_id, right.input_id));
    return [packKey(candidate), bindings];
  }));
  const perIntentOutcomes = normalizedIntents.map((intentId) => {
    const intent = intentById.get(intentId);
    const candidateOutcomes = [...intent.capable_packs].sort((left, right) =>
      compareCodeUnits(packKey(left), packKey(right))).map((identity) => {
      const key = packKey(identity);
      const incompatibilities = sortedHardIncompatibilities.filter((entry) =>
        entry.intent_id === intentId && packKey(entry) === key);
      if (incompatibilities.length > 0) return {
        ...structuredClone(identity),
        compatibility_state: "hard_incompatible",
        hard_incompatibility_count: incompatibilities.length
      };
      const candidate = candidateByIdentity.get(key);
      const missingBindings = missingBindingsByIdentity.get(key);
      return {
        ...structuredClone(identity),
        compatibility_state: "compatible",
        authoring_state: missingBindings.length > 0
          ? "requires_bindings" : "ready_for_authoring",
        missing_authoring_binding_count: missingBindings.length
      };
    });
    const outcome = {
      intent_id: intentId,
      candidate_outcomes: candidateOutcomes
    };
    return {
      ...outcome,
      selection_status: reduceProofIntentSelectionStatus([outcome])
    };
  });
  const compatibleCandidateIdentities = new Map();
  for (const outcome of perIntentOutcomes) {
    for (const candidateOutcome of outcome.candidate_outcomes) {
      if (candidateOutcome.compatibility_state !== "compatible") continue;
      const key = packKey(candidateOutcome);
      const current = compatibleCandidateIdentities.get(key) ?? [];
      current.push(outcome.intent_id);
      compatibleCandidateIdentities.set(key, current);
    }
  }
  const compatibleCandidates = [...compatibleCandidateIdentities.entries()]
    .map(([key, compatibleRequestedIntents]) => {
      const candidate = candidateByIdentity.get(key);
      const missingAuthoringBindings = missingBindingsByIdentity.get(key);
      return {
        profile_id: candidate.profile_id,
        profile_version: candidate.profile_version,
        requested_intents: sortedUnique(compatibleRequestedIntents),
        authoring_state: missingAuthoringBindings.length > 0
          ? "requires_bindings" : "ready_for_authoring",
        missing_authoring_binding_count: missingAuthoringBindings.length
      };
    }).sort((left, right) => compareCodeUnits(packKey(left), packKey(right)));
  const uncoveredRequestedIntentCount = perIntentOutcomes.filter(
    ({ candidate_outcomes: outcomes }) => outcomes.length === 0
  ).length;
  const decision = {
    selection_scope: "requested_intents_only",
    selection_status: reduceProofIntentSelectionStatus(perIntentOutcomes),
    requested_intent_count: normalizedIntents.length,
    compatible_candidate_count: compatibleCandidates.length,
    uncovered_requested_intent_count: uncoveredRequestedIntentCount,
    hard_incompatibility_count: sortedHardIncompatibilities.length,
    missing_authoring_binding_count: compatibleCandidates.reduce(
      (count, candidate) => count + candidate.missing_authoring_binding_count, 0
    ),
    unrequested_intent_applicability: "not_evaluated",
    runtime_evidence_applicability: "not_evaluated"
  };
  const result = {
    schema_version: "controlled-contract-proof-pack-selection.v4",
    decision,
    requested_intents: normalizedIntents,
    per_intent_outcomes: perIntentOutcomes,
    compatible_candidates: compatibleCandidates,
    hard_incompatibilities: sortedHardIncompatibilities,
    candidates,
    digests: structuredClone(PROOF_INTENT_DIGESTS),
    authority: "non_authoritative"
  };
  if (!validateSelectionResultV2(result)) throw new ProofIntentSelectionError(
    "proof_intent_selection_invalid",
    "the selector emitted a schema-invalid typed result",
    { diagnostics: structuredClone(validateSelectionResultV2.errors) }
  );
  return deepFreeze(structuredClone(result));
}

function projectProofIntentSelectionV1(result) {
  if (!validateSelectionResultV2(result)) throw new ProofIntentSelectionError(
    "proof_intent_selection_invalid",
    "v1 compatibility projection requires a valid canonical v2 result"
  );
  const ambiguousIntentIds = new Set(result.per_intent_outcomes.filter(
    ({ candidate_outcomes: outcomes }) => outcomes.length > 1
  ).map(({ intent_id: id }) => id));
  const hardIncompatiblePackIds = new Set(
    result.hard_incompatibilities.map(packKey)
  );
  const compatibleCandidateByIdentity = new Map(
    result.compatible_candidates.map((candidate) => [packKey(candidate), candidate])
  );
  const selectedPacks = result.candidates.filter((candidate) =>
    !hardIncompatiblePackIds.has(packKey(candidate)) &&
    !candidate.requested_intents.some((id) => ambiguousIntentIds.has(id))
  ).map((candidate) => ({
    profile_id: candidate.profile_id,
    profile_version: candidate.profile_version,
    requested_intents: [...candidate.requested_intents],
    selection_status: compatibleCandidateByIdentity.get(packKey(candidate))
      ?.authoring_state === "requires_bindings"
      ? "requires_bindings" : "ready"
  }));
  const v1 = {
    schema_version: "controlled-contract-proof-pack-selection.v3",
    requested_intents: [...result.requested_intents],
    selected_packs: selectedPacks,
    ambiguous_intents: result.per_intent_outcomes.filter(
      ({ candidate_outcomes: outcomes }) => outcomes.length > 1
    ).map(({ intent_id: intentId, candidate_outcomes: outcomes }) => ({
      intent_id: intentId,
      reason_code: "proof_intent_ambiguous",
      remediation: "Choose one candidate pack explicitly; the selector does not rank semantic alternatives.",
      candidate_packs: outcomes.map(({ profile_id: profileId,
        profile_version: profileVersion }) => ({
        profile_id: profileId, profile_version: profileVersion
      }))
    })),
    uncovered_intents: result.per_intent_outcomes.filter(
      ({ candidate_outcomes: outcomes }) => outcomes.length === 0
    ).map(({ intent_id: intentId }) => ({
      intent_id: intentId,
      reason_code: "proof_intent_uncovered",
      remediation: "No admitted proof pack establishes this controlled intent; retain it as an explicit uncovered obligation."
    })),
    packs_requiring_bindings: selectedPacks.filter(
      ({ selection_status: status }) => status === "requires_bindings"
    ).map(({ profile_id: profileId, profile_version: profileVersion }) => ({
      profile_id: profileId, profile_version: profileVersion
    })),
    hard_incompatibilities: structuredClone(result.hard_incompatibilities),
    candidates: structuredClone(result.candidates),
    digests: structuredClone(result.digests),
    authority: result.authority
  };
  if (!validateSelectionResult(v1)) throw new ProofIntentSelectionError(
    "proof_intent_selection_invalid",
    "the v1 compatibility projection is schema-invalid",
    { diagnostics: structuredClone(validateSelectionResult.errors) }
  );
  return deepFreeze(v1);
}

function selectProofPacks(input) {
  return projectProofIntentSelectionV1(selectProofPacksV2(input));
}

function compactProofIntentSelection(result) {
  if (!validateSelectionResult(result)) throw new ProofIntentSelectionError(
    "proof_intent_selection_invalid", "compact projection requires a valid selection result"
  );
  return deepFreeze({
    requested_intents: [...result.requested_intents],
    selected_pack_count: result.selected_packs.length,
    selected_packs: result.selected_packs.map((pack) => ({
      profile_id: pack.profile_id,
      profile_version: pack.profile_version,
      requested_intents: [...pack.requested_intents],
      selection_status: pack.selection_status
    })),
    ambiguous_intent_count: result.ambiguous_intents.length,
    ambiguous_intents: cloneArray(result.ambiguous_intents),
    uncovered_intent_count: result.uncovered_intents.length,
    uncovered_intents: cloneArray(result.uncovered_intents),
    hard_incompatibility_count: result.hard_incompatibilities.length,
    hard_incompatibilities: cloneArray(result.hard_incompatibilities),
    candidates: result.candidates.map((candidate) => ({
      profile_id: candidate.profile_id,
      profile_version: candidate.profile_version,
      requested_intents: [...candidate.requested_intents],
      intent_definitions: structuredClone(candidate.intent_definitions),
      intent_distinctions: structuredClone(candidate.intent_distinctions),
      guarantee: candidate.guarantee,
      explicit_exclusions: [...candidate.explicit_exclusions],
      required_inputs: structuredClone(candidate.required_inputs),
      missing_compatible_reference_types:
        structuredClone(candidate.missing_compatible_reference_types),
      authoring_projection: structuredClone(candidate.authoring_projection),
      source_digests: structuredClone(candidate.source_digests)
    })),
    digests: structuredClone(result.digests),
    authority: result.authority
  });
}

function cloneArray(value) {
  return structuredClone(value);
}

export {
  PROOF_INTENT_ARTIFACT,
  PROOF_INTENT_DIGESTS,
  MAX_AUTHORING_PROJECTION_BYTES,
  ProofIntentSelectionError,
  compactProofIntentSelection,
  describeProofPackAuthoring,
  normalizeIntentArtifact,
  normalizeProofPackCatalog,
  selectProofPacks,
  selectProofPacksV2,
  validateIntentArtifact,
  validateProofPackAuthoringProjection,
  validateSelectionResult,
  validateSelectionResultV2
};
