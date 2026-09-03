import { canonicalDigest, canonicalJsonBytes, sha256 } from
  "../../lib/exact-binding-common.mjs";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  deriveAuthenticationProvenanceOccurrenceCapture,
  deriveEvidenceOccurrenceRole
} from
  "../../lib/authentication-provenance-occurrence-projection.mjs";
import { VOCABULARY_DIGESTS } from "../../vocabulary/controlled-contract-vocabulary.v1.mjs";

const durableIdentity = (domain, value) => ({ kind: "durable_id", domain, value });
const digestLabel = (value) => sha256(Buffer.from(value, "utf8"));
const role = (referenceId, typeTerm, identity) => ({
  grounded_identity: identity,
  reference_id: referenceId,
  type_term: typeTerm
});

function proofKey(label) {
  const seed = Buffer.from(sha256(Buffer.from(`test-proof-key:${label}`, "utf8")), "hex");
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8"
  });
  const publicKeyBytes = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return {
    privateKey,
    publicKeyBytes,
    signer: durableIdentity(
      "controlled-contract:ed25519-public-key:v1", sha256(publicKeyBytes)
    )
  };
}

function signedProof(proofKind, claims, key) {
  const unsigned = {
    schema_version: "controlled-contract.authentication-provenance-signed-proof.v1",
    proof_kind: proofKind,
    verification_method: "ed25519",
    signer_grounded_identity: structuredClone(key.signer),
    claims: structuredClone(claims)
  };
  return {
    ...unsigned,
    public_key_spki_base64: key.publicKeyBytes.toString("base64"),
    signature_base64: sign(null, canonicalJsonBytes(unsigned), key.privateKey)
      .toString("base64")
  };
}

function mechanismEvidenceFor(method, suffix) {
  const d = (field) => digestLabel(`${method}:${suffix}:${field}`);
  const values = {
    authenticated_record_key: {
      record_key: `record-${suffix}`, record_namespace: `namespace-${suffix}`,
      record_snapshot_sha256: d("record-snapshot")
    },
    signed_target_digest: {
      signature_envelope_sha256: d("signature-envelope"),
      signed_target_sha256: d("signed-target")
    },
    verified_manifest_entry: {
      manifest_entry_sha256: d("manifest-entry"), manifest_sha256: d("manifest")
    },
    authenticated_channel: {
      channel_identity: `channel-${suffix}`, message_sha256: d("message"),
      request_binding_sha256: d("request-binding"), session_sha256: d("session")
    },
    authenticated_store_read: {
      read_receipt_sha256: d("read-receipt"), record_key: `record-${suffix}`,
      store_identity: `store-${suffix}`, transaction_sha256: d("transaction")
    },
    verified_signature: {
      signature_envelope_sha256: d("signature-envelope"),
      signed_content_sha256: d("signed-content"), signer_key_sha256: d("signer-key")
    },
    authenticated_catalog_assignment: {
      assignment_record_sha256: d("assignment-record"),
      catalog_identity: `catalog-${suffix}`
    },
    signed_registry_assignment: {
      registry_entry_sha256: d("registry-entry"),
      registry_identity: `registry-${suffix}`,
      signature_envelope_sha256: d("signature-envelope")
    },
    transactional_store_assignment: {
      assignment_transaction_sha256: d("assignment-transaction"),
      store_identity: `store-${suffix}`
    },
    authenticated_channel_validation: {
      channel_witness_sha256: d("channel-witness"),
      request_binding_sha256: d("request-binding")
    },
    signature_validation: {
      manifest_or_payload_sha256: d("manifest-or-payload"),
      signature_envelope_sha256: d("signature-envelope")
    },
    trusted_store_validation: {
      read_provenance_sha256: d("read-provenance"),
      transaction_sha256: d("transaction")
    }
  };
  return values[method];
}

function buildAuthenticationProvenanceSources({
  evidenceContentBytes = Buffer.from("exact authenticated evidence\n", "utf8"),
  occurrenceSuffix = "one",
  targetSuffix = "one",
  sourceSuffix = "one",
  targetType = "cc:state",
  sourceType = "cc:resource",
  attemptType = "cc:event",
  targetResolutionMethod = "signed_target_digest",
  sourceAuthenticationMethod = "verified_signature",
  sourceOfRecordMethod = "signed_registry_assignment",
  authenticationMethod = "signature_validation",
  unicode = false,
  acquisitionKind = "direct",
  dishonestSourceGrounding = false,
  mutateWitnesses = null,
  mutateAuthentication = null,
  recomputeAuthentication = true
} = {}) {
  const marker = unicode ? "évidence-東京" : "authentication-provenance";
  const captureKey = proofKey(`${marker}:capture`);
  const sourceKey = proofKey(`${marker}:source:${sourceSuffix}`);
  const registryKey = proofKey(`${marker}:registry`);
  const evidenceDigest = sha256(evidenceContentBytes);
  const targetMechanismEvidence = mechanismEvidenceFor(
    targetResolutionMethod, occurrenceSuffix
  );
  const sourceMechanismEvidence = mechanismEvidenceFor(
    sourceAuthenticationMethod, occurrenceSuffix
  );
  const sourceOfRecordMechanismEvidence = mechanismEvidenceFor(
    sourceOfRecordMethod, occurrenceSuffix
  );
  const authenticationMechanismEvidence = mechanismEvidenceFor(
    authenticationMethod, occurrenceSuffix
  );
  const target = role(
    `ref-authenticated-target${targetSuffix === "one" ? "" : `-${targetSuffix}`}`,
    targetType, durableIdentity(marker,
      `target${targetSuffix === "one" ? "" : `-${targetSuffix}`}`)
  );
  const source = role(
    `ref-provenance-source${sourceSuffix === "one" ? "" : `-${sourceSuffix}`}`,
    sourceType, dishonestSourceGrounding
      ? durableIdentity(marker, `self-declared-source-${sourceSuffix}`)
      : structuredClone(sourceKey.signer)
  );
  const attempt = role(
    `ref-observation-attempt-${occurrenceSuffix}`,
    attemptType,
    durableIdentity(marker, `attempt-${occurrenceSuffix}`)
  );
  const captureAuthority = structuredClone(captureKey.signer);
  const attemptBindingProof = signedProof("attempt_binding", {
    attempt: structuredClone(attempt),
    capture_authority_grounded_identity: structuredClone(captureAuthority),
    evidence_content_sha256: evidenceDigest
  }, captureKey);
  const attemptBindingProofSha256 = canonicalDigest(attemptBindingProof);
  const evidenceOccurrence = deriveEvidenceOccurrenceRole({
    attempt,
    attemptBindingProofSha256,
    captureAuthority,
    evidenceContentSha256: evidenceDigest
  });
  const witnesses = {
    targetResolution: {
      schema_version: "controlled-contract.authentication-target-resolution-witness.v1",
      evidence_content_sha256: evidenceDigest,
      mechanism_evidence: targetMechanismEvidence,
      resolution_method: targetResolutionMethod,
      target: structuredClone(target),
      verification_proof: signedProof("target_resolution", {
        evidence_content_sha256: evidenceDigest,
        mechanism_evidence: targetMechanismEvidence,
        resolution_method: targetResolutionMethod,
        target: structuredClone(target)
      }, registryKey)
    },
    sourceAuthentication: {
      schema_version: "controlled-contract.source-authentication-witness.v1",
      acquisition_kind: acquisitionKind,
      authentication_method: sourceAuthenticationMethod,
      evidence_content_sha256: evidenceDigest,
      mechanism_evidence: sourceMechanismEvidence,
      source: structuredClone(source),
      authentication_proof: signedProof("source_authentication", {
        acquisition_kind: acquisitionKind,
        authentication_method: sourceAuthenticationMethod,
        evidence_content_sha256: evidenceDigest,
        mechanism_evidence: sourceMechanismEvidence,
        source: structuredClone(source)
      }, sourceKey)
    },
    sourceOfRecord: {
      schema_version: "controlled-contract.source-of-record-assignment-witness.v1",
      assignment_method: sourceOfRecordMethod,
      mechanism_evidence: sourceOfRecordMechanismEvidence,
      attempt: structuredClone(attempt),
      source: structuredClone(source),
      target: structuredClone(target),
      assignment_proof: signedProof("source_of_record_assignment", {
        assignment_method: sourceOfRecordMethod,
        mechanism_evidence: sourceOfRecordMechanismEvidence,
        attempt: structuredClone(attempt),
        source: structuredClone(source),
        target: structuredClone(target)
      }, registryKey)
    },
    attemptBinding: {
      schema_version: "controlled-contract.observation-attempt-binding-witness.v1",
      attempt: structuredClone(attempt),
      attempt_binding_proof: attemptBindingProof,
      attempt_binding_proof_sha256: attemptBindingProofSha256,
      capture_authority_grounded_identity: captureAuthority,
      evidence_content_sha256: evidenceDigest,
      evidence_occurrence: structuredClone(evidenceOccurrence)
    }
  };
  witnesses.targetResolution.verification_proof_sha256 = canonicalDigest(
    witnesses.targetResolution.verification_proof
  );
  witnesses.sourceAuthentication.authentication_proof_sha256 = canonicalDigest(
    witnesses.sourceAuthentication.authentication_proof
  );
  witnesses.sourceOfRecord.assignment_proof_sha256 = canonicalDigest(
    witnesses.sourceOfRecord.assignment_proof
  );
  mutateWitnesses?.(witnesses, {
    attempt, captureAuthority, evidenceOccurrence, source, target
  });
  const targetBytes = canonicalJsonBytes(witnesses.targetResolution, { file: true });
  const sourceBytes = canonicalJsonBytes(witnesses.sourceAuthentication, { file: true });
  const sourceOfRecordBytes = canonicalJsonBytes(witnesses.sourceOfRecord, { file: true });
  const attemptBytes = canonicalJsonBytes(witnesses.attemptBinding, { file: true });
  const authentication = {
    schema_version: "controlled-contract.authentication-witness.v1",
    acquisition_kind: acquisitionKind,
    attempt_binding_witness_sha256: sha256(attemptBytes),
    authentication_method: authenticationMethod,
    mechanism_evidence: authenticationMechanismEvidence,
    evidence_content_sha256: evidenceDigest,
    evidence_occurrence_grounded_identity_sha256: canonicalDigest(
      evidenceOccurrence.grounded_identity
    ),
    observation_attempt_grounded_identity_sha256: canonicalDigest(
      attempt.grounded_identity
    ),
    source_authentication_witness_sha256: sha256(sourceBytes),
    source_grounded_identity_sha256: canonicalDigest(source.grounded_identity),
    source_of_record_assignment_witness_sha256: sha256(sourceOfRecordBytes),
    target_grounded_identity_sha256: canonicalDigest(target.grounded_identity),
    target_resolution_witness_sha256: sha256(targetBytes)
  };
  authentication.authentication_proof = signedProof("aggregate_authentication", {
    acquisition_kind: acquisitionKind,
    authentication_method: authenticationMethod,
    mechanism_evidence: authenticationMechanismEvidence,
    attempt_binding_witness_sha256: authentication.attempt_binding_witness_sha256,
    evidence_content_sha256: authentication.evidence_content_sha256,
    evidence_occurrence_grounded_identity_sha256:
      authentication.evidence_occurrence_grounded_identity_sha256,
    observation_attempt_grounded_identity_sha256:
      authentication.observation_attempt_grounded_identity_sha256,
    source_authentication_witness_sha256:
      authentication.source_authentication_witness_sha256,
    source_grounded_identity_sha256: authentication.source_grounded_identity_sha256,
    source_of_record_assignment_witness_sha256:
      authentication.source_of_record_assignment_witness_sha256,
    target_grounded_identity_sha256: authentication.target_grounded_identity_sha256,
    target_resolution_witness_sha256: authentication.target_resolution_witness_sha256
  }, captureKey);
  authentication.authentication_proof_sha256 = canonicalDigest(
    authentication.authentication_proof
  );
  mutateAuthentication?.(authentication);
  if (!recomputeAuthentication) authentication.target_resolution_witness_sha256 =
    sha256(Buffer.from("stale-target-witness-digest", "utf8"));
  const authenticationBytes = canonicalJsonBytes(authentication, { file: true });
  const input = {
    evidenceContentBytes: Buffer.from(evidenceContentBytes),
    targetResolutionWitnessBytes: targetBytes,
    sourceAuthenticationWitnessBytes: sourceBytes,
    sourceOfRecordAssignmentWitnessBytes: sourceOfRecordBytes,
    attemptBindingWitnessBytes: attemptBytes,
    authenticationWitnessBytes: authenticationBytes
  };
  return {
    input,
    resultBytes: deriveAuthenticationProvenanceOccurrenceCapture(input),
    roles: { evidenceOccurrence, target, source, attempt },
    witnesses: { ...witnesses, authentication }
  };
}

const refOperand = (roleName) => ({ kind: "reference", role: roleName });
const applicability = (mode, ...operandRoles) => ({ mode, operand_roles: operandRoles });
const propositionTemplate = (subjectRole, operator, context, ...operandRoles) => ({
  subject_role: subjectRole,
  operator,
  applicability_context: context,
  operands: operandRoles.map(refOperand)
});

function buildAuthenticationProvenanceProfile() {
  const duringAttempt = applicability("during", "observation_attempt");
  const unconditional = applicability("unconditional");
  const behaviors = [
    ["evidence-authenticates-target", "evidence_occurrence", "reference:authenticates",
      duringAttempt, "target"],
    ["evidence-originates-from-source", "evidence_occurrence", "reference:originates_from",
      duringAttempt, "source"],
    ["target-has-source-of-record", "target", "reference:has_source_of_record",
      duringAttempt, "source"],
    ["evidence-observed-in-attempt", "evidence_occurrence", "reference:observed_in",
      unconditional, "observation_attempt"]
  ];
  const complements = new Map([
    ["reference:authenticates", "reference:does_not_authenticate"],
    ["reference:originates_from", "reference:does_not_originate_from"],
    ["reference:has_source_of_record", "reference:does_not_have_source_of_record"],
    ["reference:observed_in", "reference:not_observed_in"]
  ]);
  const verifierRoles = [
    "authentication_verification",
    "provenance_verification",
    "source_record_verification",
    "observation_verification"
  ];
  const claimPatterns = behaviors.flatMap(([
    patternId, subjectRole, operator, context, operandRole
  ], index) => {
    const verificationId = `verify-${patternId}`;
    return [{
      pattern_id: patternId,
      required_by_stage: "post_delivery",
      claim_kind: "behavior",
      allowed_modalities: ["MUST"],
      proposition_template: propositionTemplate(
        subjectRole, operator, structuredClone(context), operandRole
      )
    }, {
      pattern_id: verificationId,
      required_by_stage: "post_delivery",
      claim_kind: "verification",
      allowed_modalities: ["MUST"],
      proposition_template: propositionTemplate(
        verifierRoles[index], "reference:reads", unconditional,
        "evidence_content", "target_resolution_witness",
        "source_authentication_witness", "source_of_record_witness",
        "attempt_binding_witness", "authentication_witness", "occurrence_capture"
      ),
      verification_methods: ["analysis", "demonstration", "proof", "test_execution"],
      falsifying_proposition_template: propositionTemplate(
        subjectRole, complements.get(operator), structuredClone(context), operandRole
      )
    }];
  });
  const relationPatterns = behaviors.map(([patternId], index) => ({
    pattern_id: `verification-targets-${patternId}`,
    required_by_stage: "post_delivery",
    role: "verifies",
    source_claim_pattern_id: `verify-${patternId}`,
    target_claim_pattern_id: patternId
  }));
  const falsifierConditionBindings = relationPatterns.map((relation, index) => ({
    relation_pattern_id: relation.pattern_id,
    applicability_context: structuredClone(behaviors[index][3])
  }));
  const referenceRoles = [
    ["evidence_occurrence", ["cc:evidence_occurrence"], "exactly_one"],
    ["target", ["cc:artifact", "cc:configuration", "cc:entity", "cc:event",
      "cc:resource", "cc:state"], "exactly_one"],
    ["source", ["cc:actor", "cc:entity", "cc:process", "cc:resource",
      "cc:runtime_component"], "exactly_one"],
    ["observation_attempt", ["cc:event", "cc:process"], "exactly_one"],
    ["target_population", ["cc:population"], "exactly_one"],
    ["source_population", ["cc:population"], "exactly_one"],
    ["evidence_content", ["cc:artifact", "cc:evidence"], "exactly_one"],
    ["target_resolution_witness", ["cc:artifact", "cc:evidence"], "exactly_one"],
    ["source_authentication_witness", ["cc:artifact", "cc:evidence"], "exactly_one"],
    ["source_of_record_witness", ["cc:artifact", "cc:evidence"], "exactly_one"],
    ["attempt_binding_witness", ["cc:artifact", "cc:evidence"], "exactly_one"],
    ["authentication_witness", ["cc:artifact", "cc:evidence"], "exactly_one"],
    ["occurrence_capture", ["cc:artifact", "cc:evidence"], "exactly_one"],
    ...verifierRoles.map((roleName) => [roleName, ["cc:process", "cc:test"], "exactly_one"])
  ].map(([roleName, allowedTypeTerms, cardinality]) => ({
    role: roleName,
    allowed_type_terms: allowedTypeTerms,
    cardinality
  }));
  const satisfactionPatterns = [
    "complete-selected-target-population",
    "complete-selected-source-population",
    ...claimPatterns.map(({ pattern_id: patternId }) => patternId),
    ...relationPatterns.map(({ pattern_id: patternId }) => patternId)
  ];
  return {
    schema_version: "controlled-contract-verification-profile.v1",
    profile_id: "proof.authentication.direct-source-provenance",
    profile_version: "2.0.0",
    contract_schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    vocabulary_signature_digest: VOCABULARY_DIGESTS.signature,
    vocabulary_algebra_digest: VOCABULARY_DIGESTS.algebra,
    vocabulary_definitions_digest: VOCABULARY_DIGESTS.definitions,
    vocabulary_complete_digest: VOCABULARY_DIGESTS.complete,
    verification_falsifier_policy: "controlled_complement_per_target",
    evaluation_stages: ["post_delivery"],
    reference_roles: referenceRoles,
    number_roles: [],
    distinct_reference_role_sets: [{
      roles: ["evidence_occurrence", "source", "observation_attempt"],
      applicability_contexts: [structuredClone(duringAttempt)]
    }, {
      roles: ["target", "source", "observation_attempt"],
      applicability_contexts: [structuredClone(duringAttempt)]
    }],
    reference_binding_patterns: [{
      pattern_id: "complete-selected-target-population",
      required_by_stage: "post_delivery",
      comparison: "complete_population",
      roles: ["target_population", "target"],
      applicability_context: structuredClone(duringAttempt)
    }, {
      pattern_id: "complete-selected-source-population",
      required_by_stage: "post_delivery",
      comparison: "complete_population",
      roles: ["source_population", "source"],
      applicability_context: structuredClone(duringAttempt)
    }],
    claim_patterns: claimPatterns,
    relation_patterns: relationPatterns,
    collection_patterns: [],
    resolver_fact_patterns: [],
    evidence_patterns: [],
    falsifier_condition_bindings: falsifierConditionBindings,
    satisfaction_expression: {
      all_of: satisfactionPatterns.map((pattern) => ({ pattern }))
    }
  };
}

const fixtureIdentity = (value) => durableIdentity("authentication-provenance-fixture", value);
const fixtureReference = (referenceId, typeTerm, identityValue = referenceId) => ({
  reference_id: referenceId,
  type_term: typeTerm,
  identity: fixtureIdentity(identityValue)
});
const contractContext = (mode, ...operandReferenceIds) => ({
  mode, operand_reference_ids: operandReferenceIds
});
const contractRef = (referenceId) => ({ kind: "reference", reference_id: referenceId });
const contractNumber = (value) => ({ kind: "number", value });

function buildAuthenticationProvenanceFixture({
  sourceOptions = {},
  verificationMethod = "test_execution",
  mutateContract = null,
  mutateInput = null
} = {}) {
  const profile = buildAuthenticationProvenanceProfile();
  const captured = buildAuthenticationProvenanceSources(sourceOptions);
  const roleIds = {
    evidence_occurrence: captured.roles.evidenceOccurrence.reference_id,
    target: captured.roles.target.reference_id,
    source: captured.roles.source.reference_id,
    observation_attempt: captured.roles.attempt.reference_id,
    target_population: "ref-selected-target-population",
    source_population: "ref-selected-source-population",
    evidence_content: "ref-evidence-content",
    target_resolution_witness: "ref-target-resolution-witness",
    source_authentication_witness: "ref-source-authentication-witness",
    source_of_record_witness: "ref-source-of-record-witness",
    attempt_binding_witness: "ref-attempt-binding-witness",
    authentication_witness: "ref-authentication-witness",
    occurrence_capture: "ref-occurrence-capture",
    authentication_verification: "ref-authentication-verification",
    provenance_verification: "ref-provenance-verification",
    source_record_verification: "ref-source-record-verification",
    observation_verification: "ref-observation-verification"
  };
  const references = [
    { reference_id: roleIds.evidence_occurrence, type_term: "cc:evidence_occurrence",
      identity: structuredClone(captured.roles.evidenceOccurrence.grounded_identity) },
    { reference_id: roleIds.target, type_term: captured.roles.target.type_term,
      identity: structuredClone(captured.roles.target.grounded_identity) },
    { reference_id: roleIds.source, type_term: captured.roles.source.type_term,
      identity: structuredClone(captured.roles.source.grounded_identity) },
    { reference_id: roleIds.observation_attempt,
      type_term: captured.roles.attempt.type_term,
      identity: structuredClone(captured.roles.attempt.grounded_identity) },
    fixtureReference(roleIds.target_population, "cc:population"),
    fixtureReference(roleIds.source_population, "cc:population"),
    ...["evidence_content", "target_resolution_witness", "source_authentication_witness",
      "source_of_record_witness", "attempt_binding_witness", "authentication_witness",
      "occurrence_capture"].map((roleName) =>
      fixtureReference(roleIds[roleName], "cc:artifact")),
    ...["authentication_verification", "provenance_verification",
      "source_record_verification", "observation_verification"].map((roleName) =>
      fixtureReference(roleIds[roleName], "cc:test"))
  ];
  const duringAttempt = contractContext("during", roleIds.observation_attempt);
  const unconditional = contractContext("unconditional");
  const propositions = [];
  const claims = [];
  const addClaim = ({ id, subject, operator, context, operands, kind = "behavior",
    modality = "MUST", verification = false, falsifier = null }) => {
    const propositionId = `prop-${id}`;
    propositions.push({
      proposition_id: propositionId,
      subject_reference_id: subject,
      operator,
      applicability_context: structuredClone(context),
      operands
    });
    const claim = {
      claim_id: `claim-${id}`,
      kind: verification ? "verification" : kind,
      modality,
      proposition_id: propositionId
    };
    if (verification) {
      const falsifierId = `prop-falsifier-${id}`;
      propositions.push({ proposition_id: falsifierId, ...falsifier });
      claim.verification_method = verificationMethod;
      claim.falsifying_proposition_id = falsifierId;
    }
    claims.push(claim);
  };
  addClaim({ id: "selected-target-membership", subject: roleIds.target_population,
    operator: "reference:contains", context: duringAttempt,
    operands: [contractRef(roleIds.target)], kind: "evidence" });
  addClaim({ id: "selected-target-cardinality", subject: roleIds.target_population,
    operator: "number:has_cardinality", context: duringAttempt,
    operands: [contractNumber(1)], kind: "evidence" });
  addClaim({ id: "selected-source-membership", subject: roleIds.source_population,
    operator: "reference:contains", context: duringAttempt,
    operands: [contractRef(roleIds.source)], kind: "evidence" });
  addClaim({ id: "selected-source-cardinality", subject: roleIds.source_population,
    operator: "number:has_cardinality", context: duringAttempt,
    operands: [contractNumber(1)], kind: "evidence" });
  const behaviorSpecs = [
    ["evidence-authenticates-target", roleIds.evidence_occurrence,
      "reference:authenticates", duringAttempt, roleIds.target,
      "reference:does_not_authenticate", roleIds.authentication_verification],
    ["evidence-originates-from-source", roleIds.evidence_occurrence,
      "reference:originates_from", duringAttempt, roleIds.source,
      "reference:does_not_originate_from", roleIds.provenance_verification],
    ["target-has-source-of-record", roleIds.target,
      "reference:has_source_of_record", duringAttempt, roleIds.source,
      "reference:does_not_have_source_of_record", roleIds.source_record_verification],
    ["evidence-observed-in-attempt", roleIds.evidence_occurrence,
      "reference:observed_in", unconditional, roleIds.observation_attempt,
      "reference:not_observed_in", roleIds.observation_verification]
  ];
  const relations = [];
  for (const [id, subject, operator, context, operand, complement, verifier] of
    behaviorSpecs) {
    addClaim({ id, subject, operator, context, operands: [contractRef(operand)] });
    const verificationId = `verify-${id}`;
    addClaim({
      id: verificationId,
      subject: verifier,
      operator: "reference:reads",
      context: unconditional,
      operands: [
        roleIds.evidence_content,
        roleIds.target_resolution_witness,
        roleIds.source_authentication_witness,
        roleIds.source_of_record_witness,
        roleIds.attempt_binding_witness,
        roleIds.authentication_witness,
        roleIds.occurrence_capture
      ].map(contractRef),
      verification: true,
      falsifier: {
        subject_reference_id: subject,
        operator: complement,
        applicability_context: structuredClone(context),
        operands: [contractRef(operand)]
      }
    });
    relations.push({
      relation_id: `rel-verification-targets-${id}`,
      role: "verifies",
      source_claim_id: `claim-${verificationId}`,
      target_claim_id: `claim-${id}`
    });
  }
  const contract = {
    schema_version: "controlled-acceptance-contract.v1",
    vocabulary_version: "controlled-contract-vocabulary.v1",
    profile_id: "acceptance-contract.standard.v1",
    references,
    propositions,
    claims,
    relations,
    collections: [],
    residue: [],
    annotations: [], test_proof_version: "controlled-contract-test-proof.v1", test_proofs: []
  };
  const input = {
    input_version: "controlled-contract-verification-profile-input.v1",
    evaluation_stage: "post_delivery",
    reference_bindings: Object.entries(roleIds).map(([roleName, referenceId]) => ({
      role: roleName,
      reference_ids: [referenceId]
    })),
    number_bindings: [],
    claim_pattern_bindings: [],
    resolver_facts: [],
    delivered_evidence: [], stable_evaluation: {}
  };
  mutateContract?.(contract, { roleIds, captured });
  mutateInput?.(input, { roleIds, captured });
  return { captured, contract, input, profile, roleIds };
}

export {
  buildAuthenticationProvenanceFixture,
  buildAuthenticationProvenanceProfile,
  buildAuthenticationProvenanceSources,
  durableIdentity
};
