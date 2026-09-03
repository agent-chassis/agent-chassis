import {
  ExactBindingError,
  canonicalDigest,
  canonicalJsonBytes,
  deepFreeze,
  parseCanonicalDocument,
  sha256
} from "./deterministic-projection-primitives.mjs";
import { createPublicKey, verify as verifySignature } from "node:crypto";

const TRANSFORMER_ID = "authentication-provenance-occurrence-capture.v1";
const RESULT_VERSION = "controlled-contract.authentication-provenance-occurrence-capture.v1";
const SHA256 = /^[0-9a-f]{64}$/u;
const REFERENCE_ID = /^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SOURCE_TYPES = new Set([
  "cc:actor", "cc:entity", "cc:process", "cc:resource", "cc:runtime_component"
]);
const ATTEMPT_TYPES = new Set(["cc:event", "cc:process"]);
const TARGET_TYPES = new Set([
  "cc:artifact", "cc:configuration", "cc:entity", "cc:event", "cc:resource", "cc:state"
]);

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) =>
      Object.hasOwn(value, key));
}

function nfcText(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      value !== value.normalize("NFC")) fail(
    "occurrence_capture_text_invalid",
    "occurrence-capture text must be nonempty canonical NFC without NUL", { field }
  );
  return value;
}

function digest(value, field) {
  if (!SHA256.test(value ?? "")) fail(
    "occurrence_capture_digest_invalid", "occurrence-capture digest is invalid", { field }
  );
  return value;
}

function canonicalBase64(value, field) {
  if (typeof value !== "string" || value.length === 0) fail(
    "occurrence_capture_proof_encoding_invalid",
    "proof key and signature values must be nonempty canonical base64", { field }
  );
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) fail(
    "occurrence_capture_proof_encoding_invalid",
    "proof key and signature values must be nonempty canonical base64", { field }
  );
  return bytes;
}

function verifyProof(value, proofKind, expectedClaims, field) {
  if (!exactKeys(value, [
    "claims", "proof_kind", "public_key_spki_base64", "schema_version",
    "signature_base64", "signer_grounded_identity", "verification_method"
  ]) || value.schema_version !==
      "controlled-contract.authentication-provenance-signed-proof.v1" ||
      value.proof_kind !== proofKind || value.verification_method !== "ed25519") fail(
    "occurrence_capture_proof_invalid",
    "authentication/provenance proof has an unknown or open shape", { field }
  );
  if (canonicalDigest(value.claims) !== canonicalDigest(expectedClaims)) fail(
    "occurrence_capture_proof_claim_mismatch",
    "signed proof claims do not match the witness occurrence", { field }
  );
  const publicKeyBytes = canonicalBase64(
    value.public_key_spki_base64, `${field}.public_key_spki_base64`
  );
  const signer = groundedIdentity(value.signer_grounded_identity,
    `${field}.signer_grounded_identity`);
  const expectedSigner = {
    kind: "durable_id",
    domain: "controlled-contract:ed25519-public-key:v1",
    value: sha256(publicKeyBytes)
  };
  if (canonicalDigest(signer) !== canonicalDigest(expectedSigner)) fail(
    "occurrence_capture_proof_signer_mismatch",
    "proof signer identity is not grounded in the captured public key", { field }
  );
  let key;
  try {
    key = createPublicKey({ key: publicKeyBytes, format: "der", type: "spki" });
  } catch {
    fail("occurrence_capture_proof_key_invalid", "proof public key is invalid", { field });
  }
  if (key.asymmetricKeyType !== "ed25519" || !verifySignature(
    null,
    canonicalJsonBytes({
      claims: value.claims,
      proof_kind: value.proof_kind,
      schema_version: value.schema_version,
      signer_grounded_identity: value.signer_grounded_identity,
      verification_method: value.verification_method
    }),
    key,
    canonicalBase64(value.signature_base64, `${field}.signature_base64`)
  )) fail(
    "occurrence_capture_proof_signature_invalid",
    "proof signature does not authenticate its exact claims", { field }
  );
  return { digest: canonicalDigest(value), signer };
}

function groundedIdentity(identity, field) {
  const shapes = {
    repository_path: ["kind", "repository", "path"],
    code_symbol: Object.hasOwn(identity ?? {}, "scip_symbol")
      ? ["kind", "repository", "path", "symbol", "scip_symbol"]
      : ["kind", "repository", "path", "symbol"],
    durable_id: ["kind", "domain", "value"],
    runtime_parameter: ["kind", "name"],
    profile_term: ["kind", "term"]
  };
  const keys = shapes[identity?.kind];
  if (!keys || !exactKeys(identity, keys)) fail(
    "occurrence_capture_grounded_identity_invalid",
    "grounded identity has an unknown or open shape", { field }
  );
  for (const key of keys.filter((key) => key !== "kind")) nfcText(
    identity[key], `${field}.${key}`
  );
  return structuredClone(identity);
}

const MECHANISM_EVIDENCE_FIELDS = Object.freeze({
  authenticated_record_key: ["record_key", "record_namespace", "record_snapshot_sha256"],
  signed_target_digest: ["signature_envelope_sha256", "signed_target_sha256"],
  verified_manifest_entry: ["manifest_entry_sha256", "manifest_sha256"],
  authenticated_channel: [
    "channel_identity", "message_sha256", "request_binding_sha256", "session_sha256"
  ],
  authenticated_store_read: [
    "read_receipt_sha256", "record_key", "store_identity", "transaction_sha256"
  ],
  verified_signature: [
    "signature_envelope_sha256", "signed_content_sha256", "signer_key_sha256"
  ],
  authenticated_catalog_assignment: ["assignment_record_sha256", "catalog_identity"],
  signed_registry_assignment: [
    "registry_entry_sha256", "registry_identity", "signature_envelope_sha256"
  ],
  transactional_store_assignment: ["assignment_transaction_sha256", "store_identity"],
  authenticated_channel_validation: [
    "channel_witness_sha256", "request_binding_sha256"
  ],
  signature_validation: ["manifest_or_payload_sha256", "signature_envelope_sha256"],
  trusted_store_validation: ["read_provenance_sha256", "transaction_sha256"]
});

function mechanismEvidence(value, method, field) {
  const keys = MECHANISM_EVIDENCE_FIELDS[method];
  if (!keys || !exactKeys(value, keys)) fail(
    "occurrence_capture_mechanism_evidence_invalid",
    "witness mechanism evidence does not match its declared validation method",
    { field, method }
  );
  for (const key of keys) {
    if (key.endsWith("_sha256")) digest(value[key], `${field}.${key}`);
    else nfcText(value[key], `${field}.${key}`);
  }
  return structuredClone(value);
}

function role(value, field, allowedTypes) {
  if (!exactKeys(value, ["grounded_identity", "reference_id", "type_term"]) ||
      !REFERENCE_ID.test(value.reference_id ?? "") ||
      !allowedTypes.has(value.type_term)) fail(
    "occurrence_capture_role_invalid",
    "occurrence-capture role has an invalid reference or type", { field }
  );
  return {
    grounded_identity: groundedIdentity(value.grounded_identity, `${field}.grounded_identity`),
    reference_id: value.reference_id,
    type_term: value.type_term
  };
}

function sameRole(left, right, field) {
  if (canonicalDigest(left) !== canonicalDigest(right)) fail(
    "occurrence_capture_role_splice",
    "witnesses do not name the same complete grounded role", { field }
  );
}

function deriveEvidenceOccurrenceRole({
  attempt,
  attemptBindingProofSha256,
  captureAuthority,
  evidenceContentSha256
}) {
  const occurrenceDigest = canonicalDigest({
    attempt_binding_proof_sha256: digest(
      attemptBindingProofSha256, "attempt.attempt_binding_proof_sha256"
    ),
    capture_authority_grounded_identity: groundedIdentity(
      captureAuthority, "capture_authority_grounded_identity"
    ),
    evidence_content_sha256: digest(
      evidenceContentSha256, "attempt.evidence_content_sha256"
    ),
    observation_attempt: role(attempt, "attempt", ATTEMPT_TYPES),
    occurrence_derivation_version:
      "controlled-contract.evidence-occurrence-identity.v1"
  });
  return {
    grounded_identity: {
      kind: "durable_id",
      domain: "controlled-contract:evidence-occurrence:v1",
      value: occurrenceDigest
    },
    reference_id: `ref-evidence-occurrence-${occurrenceDigest}`,
    type_term: "cc:evidence_occurrence"
  };
}

function parseTargetResolution(value, evidenceDigest) {
  if (!exactKeys(value, [
    "evidence_content_sha256", "mechanism_evidence", "resolution_method", "schema_version", "target",
    "verification_proof", "verification_proof_sha256"
  ]) || value.schema_version !==
      "controlled-contract.authentication-target-resolution-witness.v1" ||
      !["authenticated_record_key", "signed_target_digest", "verified_manifest_entry"]
        .includes(value.resolution_method)) fail(
    "target_resolution_witness_invalid", "target-resolution witness is invalid"
  );
  if (digest(value.evidence_content_sha256, "target.evidence_content_sha256") !==
      evidenceDigest) fail(
    "target_resolution_evidence_mismatch",
    "target-resolution witness does not bind the captured evidence bytes"
  );
  const target = role(value.target, "target", TARGET_TYPES);
  const evidence = mechanismEvidence(
    value.mechanism_evidence, value.resolution_method, "target.mechanism_evidence"
  );
  const proof = verifyProof(value.verification_proof, "target_resolution", {
    evidence_content_sha256: evidenceDigest,
    mechanism_evidence: evidence,
    resolution_method: value.resolution_method,
    target
  }, "target.verification_proof");
  if (digest(value.verification_proof_sha256, "target.verification_proof_sha256") !==
      proof.digest) fail("occurrence_capture_proof_digest_mismatch",
    "target-resolution proof digest does not match its captured proof", { field: "target" });
  return { role: target, proofDigest: proof.digest, proofSigner: proof.signer };
}

function parseSourceAuthentication(value, evidenceDigest) {
  if (!exactKeys(value, [
    "acquisition_kind", "authentication_method", "authentication_proof_sha256",
    "authentication_proof", "evidence_content_sha256", "mechanism_evidence", "schema_version", "source"
  ]) || value.schema_version !==
      "controlled-contract.source-authentication-witness.v1" ||
      value.acquisition_kind !== "direct" ||
      !["authenticated_channel", "authenticated_store_read", "verified_signature"]
        .includes(value.authentication_method)) fail(
    value?.acquisition_kind === "derived"
      ? "derived_evidence_refused_by_direct_source_capture"
      : "source_authentication_witness_invalid",
    "direct-source authentication witness is invalid"
  );
  if (digest(value.evidence_content_sha256, "source.evidence_content_sha256") !==
      evidenceDigest) fail(
    "source_authentication_evidence_mismatch",
    "source-authentication witness does not bind the captured evidence bytes"
  );
  const source = role(value.source, "source", SOURCE_TYPES);
  const evidence = mechanismEvidence(
    value.mechanism_evidence, value.authentication_method, "source.mechanism_evidence"
  );
  const proof = verifyProof(value.authentication_proof, "source_authentication", {
    acquisition_kind: value.acquisition_kind,
    authentication_method: value.authentication_method,
    evidence_content_sha256: evidenceDigest,
    mechanism_evidence: evidence,
    source
  }, "source.authentication_proof");
  if (digest(value.authentication_proof_sha256, "source.authentication_proof_sha256") !==
      proof.digest) fail("occurrence_capture_proof_digest_mismatch",
    "source-authentication proof digest does not match its captured proof", { field: "source" });
  if (canonicalDigest(proof.signer) !== canonicalDigest(source.grounded_identity)) fail(
    "occurrence_capture_source_authority_mismatch",
    "source-authentication proof signer is not the exact grounded provenance source"
  );
  return { role: source, proofDigest: proof.digest, proofSigner: proof.signer };
}

function parseAttemptBinding(value, evidenceDigest) {
  if (!exactKeys(value, [
    "attempt", "attempt_binding_proof", "attempt_binding_proof_sha256", "capture_authority_grounded_identity",
    "evidence_content_sha256", "evidence_occurrence", "schema_version"
  ]) || value.schema_version !== "controlled-contract.observation-attempt-binding-witness.v1") {
    fail("attempt_binding_witness_invalid", "attempt-binding witness is invalid");
  }
  if (digest(value.evidence_content_sha256, "attempt.evidence_content_sha256") !==
      evidenceDigest) fail(
    "attempt_binding_evidence_mismatch",
    "attempt-binding witness does not bind the captured evidence bytes"
  );
  const attempt = role(value.attempt, "attempt", ATTEMPT_TYPES);
  const captureAuthority = groundedIdentity(
    value.capture_authority_grounded_identity, "capture_authority_grounded_identity"
  );
  const proof = verifyProof(value.attempt_binding_proof, "attempt_binding", {
    attempt,
    capture_authority_grounded_identity: captureAuthority,
    evidence_content_sha256: evidenceDigest
  }, "attempt.attempt_binding_proof");
  if (digest(value.attempt_binding_proof_sha256,
    "attempt.attempt_binding_proof_sha256") !== proof.digest) fail(
    "occurrence_capture_proof_digest_mismatch",
    "attempt-binding proof digest does not match its captured proof", { field: "attempt" }
  );
  if (canonicalDigest(proof.signer) !== canonicalDigest(captureAuthority)) fail(
    "occurrence_capture_authority_mismatch",
    "attempt-binding proof was not minted by the named capture authority"
  );
  const derivedEvidenceOccurrence = deriveEvidenceOccurrenceRole({
    attempt,
    attemptBindingProofSha256: value.attempt_binding_proof_sha256,
    captureAuthority,
    evidenceContentSha256: evidenceDigest
  });
  const witnessedEvidenceOccurrence = role(
    value.evidence_occurrence,
    "evidence_occurrence",
    new Set(["cc:evidence_occurrence"])
  );
  sameRole(
    witnessedEvidenceOccurrence,
    derivedEvidenceOccurrence,
    "evidence_occurrence_mint"
  );
  return {
    attempt,
    captureAuthority,
    evidenceOccurrence: derivedEvidenceOccurrence,
    proofDigest: proof.digest
  };
}

function parseSourceOfRecord(value, target, source, attempt) {
  if (!exactKeys(value, [
    "assignment_method", "assignment_proof", "assignment_proof_sha256", "attempt", "mechanism_evidence", "schema_version",
    "source", "target"
  ]) || value.schema_version !== "controlled-contract.source-of-record-assignment-witness.v1" ||
      !["authenticated_catalog_assignment", "signed_registry_assignment",
        "transactional_store_assignment"].includes(value.assignment_method)) fail(
    "source_of_record_witness_invalid", "source-of-record assignment witness is invalid"
  );
  const witnessTarget = role(value.target, "source_of_record.target", TARGET_TYPES);
  const witnessSource = role(value.source, "source_of_record.source", SOURCE_TYPES);
  const witnessAttempt = role(value.attempt, "source_of_record.attempt", ATTEMPT_TYPES);
  sameRole(witnessTarget, target, "target");
  sameRole(witnessSource, source, "source");
  sameRole(witnessAttempt, attempt, "attempt");
  const evidence = mechanismEvidence(
    value.mechanism_evidence, value.assignment_method,
    "source_of_record.mechanism_evidence"
  );
  const proof = verifyProof(value.assignment_proof, "source_of_record_assignment", {
    assignment_method: value.assignment_method,
    attempt: witnessAttempt,
    source: witnessSource,
    target: witnessTarget,
    mechanism_evidence: evidence
  }, "source_of_record.assignment_proof");
  if (digest(value.assignment_proof_sha256,
    "source_of_record.assignment_proof_sha256") !== proof.digest) fail(
    "occurrence_capture_proof_digest_mismatch",
    "source-of-record proof digest does not match its captured proof",
    { field: "source_of_record" }
  );
  return { digest: proof.digest, signer: proof.signer };
}

function parseAuthentication(value, expected) {
  if (!exactKeys(value, [
    "acquisition_kind", "attempt_binding_witness_sha256", "authentication_method",
    "authentication_proof", "authentication_proof_sha256", "evidence_content_sha256", "mechanism_evidence",
    "evidence_occurrence_grounded_identity_sha256", "observation_attempt_grounded_identity_sha256",
    "schema_version", "source_authentication_witness_sha256",
    "source_grounded_identity_sha256", "source_of_record_assignment_witness_sha256",
    "target_grounded_identity_sha256", "target_resolution_witness_sha256"
  ]) || value.schema_version !== "controlled-contract.authentication-witness.v1" ||
      value.acquisition_kind !== "direct" ||
      !["authenticated_channel_validation", "signature_validation",
        "trusted_store_validation"].includes(value.authentication_method)) fail(
    value?.acquisition_kind === "derived"
      ? "derived_evidence_refused_by_direct_source_capture"
      : "authentication_witness_invalid",
    "aggregate authentication witness is invalid"
  );
  for (const [field, expectedValue] of Object.entries(expected)) if (
    digest(value[field], `authentication.${field}`) !== expectedValue
  ) fail(
    "authentication_witness_binding_mismatch",
    "aggregate authentication witness does not bind the complete captured occurrence",
    { field }
  );
  const evidence = mechanismEvidence(
    value.mechanism_evidence, value.authentication_method,
    "authentication.mechanism_evidence"
  );
  const proof = verifyProof(value.authentication_proof, "aggregate_authentication", {
    acquisition_kind: value.acquisition_kind,
    authentication_method: value.authentication_method,
    mechanism_evidence: evidence,
    ...expected
  }, "authentication.authentication_proof");
  if (digest(value.authentication_proof_sha256,
    "authentication.authentication_proof_sha256") !== proof.digest) fail(
    "occurrence_capture_proof_digest_mismatch",
    "aggregate authentication proof digest does not match its captured proof",
    { field: "authentication" }
  );
  return { digest: proof.digest, signer: proof.signer };
}

function parseSources(sourceBytes) {
  return [
    Buffer.from(sourceBytes[0]),
    ...sourceBytes.slice(1).map((bytes, index) =>
      parseCanonicalDocument(bytes, `authentication occurrence witness[${index + 1}]`)
    )
  ];
}

function projectOccurrence(sourceValues, sourceDigests) {
  const evidenceDigest = sourceDigests[0];
  const targetCapture = parseTargetResolution(sourceValues[1], evidenceDigest);
  const sourceCapture = parseSourceAuthentication(sourceValues[2], evidenceDigest);
  const target = targetCapture.role;
  const source = sourceCapture.role;
  const attemptBinding = parseAttemptBinding(sourceValues[4], evidenceDigest);
  const sourceOfRecordProof = parseSourceOfRecord(
    sourceValues[3], target, source, attemptBinding.attempt
  );
  if (canonicalDigest(sourceOfRecordProof.signer) !==
      canonicalDigest(targetCapture.proofSigner)) fail(
    "occurrence_capture_assignment_authority_mismatch",
    "target resolution and source-of-record assignment require one exact authority"
  );
  const roleDigests = {
    evidence_occurrence_grounded_identity_sha256: canonicalDigest(
      attemptBinding.evidenceOccurrence.grounded_identity
    ),
    observation_attempt_grounded_identity_sha256: canonicalDigest(
      attemptBinding.attempt.grounded_identity
    ),
    source_grounded_identity_sha256: canonicalDigest(source.grounded_identity),
    target_grounded_identity_sha256: canonicalDigest(target.grounded_identity)
  };
  const authenticationProof = parseAuthentication(sourceValues[5], {
    attempt_binding_witness_sha256: sourceDigests[4],
    evidence_content_sha256: evidenceDigest,
    source_authentication_witness_sha256: sourceDigests[2],
    source_of_record_assignment_witness_sha256: sourceDigests[3],
    target_resolution_witness_sha256: sourceDigests[1],
    ...roleDigests
  });
  if (canonicalDigest(authenticationProof.signer) !==
      canonicalDigest(attemptBinding.captureAuthority)) fail(
    "occurrence_capture_authentication_authority_mismatch",
    "aggregate authentication proof was not issued by the capture authority"
  );
  return {
    schema_version: RESULT_VERSION,
    transformer_id: TRANSFORMER_ID,
    acquisition_kind: "direct",
    authentication_proof_sha256: authenticationProof.digest,
    authentication_witness_sha256: sourceDigests[5],
    attempt_binding_proof_sha256: attemptBinding.proofDigest,
    attempt_binding_witness_sha256: sourceDigests[4],
    capture_authority_grounded_identity: attemptBinding.captureAuthority,
    capture_authority_grounded_identity_sha256: canonicalDigest(
      attemptBinding.captureAuthority
    ),
    complete_capture_source_set_sha256: canonicalDigest({
      authentication_witness_sha256: sourceDigests[5],
      authentication_proof_sha256: authenticationProof.digest,
      attempt_binding_witness_sha256: sourceDigests[4],
      attempt_binding_proof_sha256: attemptBinding.proofDigest,
      evidence_content_sha256: sourceDigests[0],
      source_authentication_witness_sha256: sourceDigests[2],
      source_authentication_proof_sha256: sourceCapture.proofDigest,
      source_of_record_assignment_witness_sha256: sourceDigests[3],
      source_of_record_assignment_proof_sha256: sourceOfRecordProof.digest,
      target_resolution_witness_sha256: sourceDigests[1]
      ,target_resolution_proof_sha256: targetCapture.proofDigest
    }),
    evidence_content_sha256: evidenceDigest,
    exact_normalized_applicability: {
      mode: "during",
      operand_grounded_identity_sha256: [
        roleDigests.observation_attempt_grounded_identity_sha256
      ],
      raw_operand_reference_ids: [attemptBinding.attempt.reference_id]
    },
    roles: {
      evidence_occurrence: {
        grounded_identity_sha256: roleDigests.evidence_occurrence_grounded_identity_sha256,
        raw_reference_id: attemptBinding.evidenceOccurrence.reference_id,
        type_term: attemptBinding.evidenceOccurrence.type_term
      },
      observation_attempt: {
        grounded_identity_sha256: roleDigests.observation_attempt_grounded_identity_sha256,
        raw_reference_id: attemptBinding.attempt.reference_id,
        type_term: attemptBinding.attempt.type_term
      },
      source: {
        grounded_identity_sha256: roleDigests.source_grounded_identity_sha256,
        raw_reference_id: source.reference_id,
        type_term: source.type_term
      },
      target: {
        grounded_identity_sha256: roleDigests.target_grounded_identity_sha256,
        raw_reference_id: target.reference_id,
        type_term: target.type_term
      }
    },
    source_authentication_witness_sha256: sourceDigests[2],
    source_authentication_proof_sha256: sourceCapture.proofDigest,
    source_of_record_assignment_witness_sha256: sourceDigests[3],
    source_of_record_assignment_proof_sha256: sourceOfRecordProof.digest,
    target_resolution_witness_sha256: sourceDigests[1],
    target_resolution_proof_sha256: targetCapture.proofDigest
  };
}

function assertResult(value) {
  if (value?.schema_version !== RESULT_VERSION || value?.transformer_id !== TRANSFORMER_ID ||
      value?.acquisition_kind !== "direct" || !exactKeys(value.roles ?? {}, [
        "evidence_occurrence", "observation_attempt", "source", "target"
      ])) fail(
    "occurrence_capture_result_invalid",
    "captured occurrence result does not identify the registered typed output"
  );
  return deepFreeze(value);
}

function deriveAuthenticationProvenanceOccurrenceCapture({
  evidenceContentBytes,
  targetResolutionWitnessBytes,
  sourceAuthenticationWitnessBytes,
  sourceOfRecordAssignmentWitnessBytes,
  attemptBindingWitnessBytes,
  authenticationWitnessBytes
}) {
  const sourceBytes = [
    evidenceContentBytes,
    targetResolutionWitnessBytes,
    sourceAuthenticationWitnessBytes,
    sourceOfRecordAssignmentWitnessBytes,
    attemptBindingWitnessBytes,
    authenticationWitnessBytes
  ];
  if (sourceBytes.some((bytes) => !Buffer.isBuffer(bytes))) fail(
    "projection_source_set_incomplete",
    "the occurrence capture requires all six exact Buffer sources"
  );
  const values = parseSources(sourceBytes);
  const first = canonicalJsonBytes(
    projectOccurrence(structuredClone(values), sourceBytes.map(sha256)), { file: true }
  );
  const second = canonicalJsonBytes(
    projectOccurrence(structuredClone(values), sourceBytes.map(sha256)), { file: true }
  );
  if (!first.equals(second)) fail(
    "projection_transformer_nondeterministic",
    "the occurrence capture was not byte deterministic"
  );
  return Buffer.from(first);
}

const AUTHENTICATION_PROVENANCE_OCCURRENCE_TRANSFORMER = Object.freeze({
  transformer_id: TRANSFORMER_ID,
  source_count: 6,
  parse_sources: parseSources,
  transform: projectOccurrence,
  validate_result: assertResult,
  projections: Object.freeze(Object.fromEntries([
    ["evidence-occurrence", "evidence_occurrence"],
    ["observation-attempt", "observation_attempt"],
    ["source", "source"],
    ["target", "target"]
  ].map(([projectionId, roleId]) => [projectionId, Object.freeze({
    cardinality: "singleton_reference",
    project: (value) => ({
      grounded_identity_sha256: value.roles[roleId].grounded_identity_sha256,
      reference_id: value.roles[roleId].raw_reference_id,
      type_term: value.roles[roleId].type_term
    })
  })])))
});

export {
  AUTHENTICATION_PROVENANCE_OCCURRENCE_TRANSFORMER,
  RESULT_VERSION,
  TRANSFORMER_ID,
  assertResult as assertAuthenticationProvenanceOccurrenceCapture,
  deriveAuthenticationProvenanceOccurrenceCapture,
  deriveEvidenceOccurrenceRole,
  projectOccurrence as projectAuthenticationProvenanceOccurrence
};
