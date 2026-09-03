import { createPublicKey, verify as verifySignature } from "node:crypto";

import {
  ExactBindingError,
  canonicalDigest,
  canonicalJsonBytes,
  compareCodeUnits,
  deepFreeze,
  parseCanonicalDocument,
  sha256,
  sortedUnique
} from "./deterministic-projection-primitives.mjs";
import {
  deriveAuthenticationProvenanceOccurrenceCapture
} from "./authentication-provenance-occurrence-projection.mjs";
import { validateProjectedContractWithStableCore } from
  "./projected-contract-validation.mjs";
import { GRAPH_VERSION } from "./projected-contract-graph.mjs";

const TRANSFORMER_ID = "sound-negative-observation-capture.v1";
const EVIDENCE_VERSION = "controlled-contract.sound-negative-observation-evidence.v1";
const PROOF_VERSION = "controlled-contract.sound-negative-observation-capture-proof.v1";
const CONTRACT_VERSION = "controlled-acceptance-contract.experimental.v0.2";
const SHA256 = /^[0-9a-f]{64}$/u;
const REFERENCE_ID = /^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const TARGET_TYPES = new Set([
  "cc:artifact", "cc:configuration", "cc:entity", "cc:event", "cc:resource", "cc:state"
]);
const SOURCE_TYPES = new Set([
  "cc:actor", "cc:entity", "cc:process", "cc:resource", "cc:runtime_component"
]);
const ATTEMPT_TYPES = new Set(["cc:event", "cc:process"]);
const ENDPOINT_TYPES = new Set(["cc:event", "cc:state"]);
const CONCLUSIONS = Object.freeze(["absent", "present", "unavailable"]);

const POPULATION_IDS = Object.freeze({
  "absent-conclusion": "ref-sno-absent-conclusion-population",
  "assigned-sources": "ref-sno-assigned-sources-population",
  "declared-sources": "ref-sno-declared-sources-population",
  "endpoint-pairs": "ref-sno-endpoint-pairs-population",
  "invalidating-conditions": "ref-sno-invalidating-conditions-population",
  "observation-positions": "ref-sno-observation-positions-population",
  "observation-count-signal": "ref-sno-observation-count-signal-population",
  "observed-sources": "ref-sno-observed-sources-population",
  "present-conclusion": "ref-sno-present-conclusion-population",
  "raw-observations": "ref-sno-raw-observations-population",
  "resolved-targets": "ref-sno-resolved-targets-population",
  "source-count-signal": "ref-sno-source-count-signal-population",
  "source-outcomes": "ref-sno-source-outcomes-population",
  "selected-attempt": "ref-sno-selected-attempt-population",
  "selected-interval-end": "ref-sno-selected-interval-end-population",
  "selected-interval-start": "ref-sno-selected-interval-start-population",
  "selected-target": "ref-sno-selected-target-population",
  "unavailable-conclusion": "ref-sno-unavailable-conclusion-population",
  "valid-observations": "ref-sno-valid-observations-population"
});

function fail(code, message, details = {}) {
  throw new ExactBindingError(code, message, details);
}

function exactKeys(value, required, optional = []) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function nfc(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") ||
      value !== value.normalize("NFC")) fail(
    "sound_negative_text_invalid",
    "capture text must be nonempty canonical NFC without NUL",
    { field }
  );
  return value;
}

function safeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail(
    "sound_negative_integer_invalid",
    "capture counts and positions must be nonnegative safe integers",
    { field }
  );
  return value;
}

function identity(value, field) {
  const shapes = {
    repository_path: ["kind", "path", "repository"],
    code_symbol: Object.hasOwn(value ?? {}, "scip_symbol")
      ? ["kind", "path", "repository", "scip_symbol", "symbol"]
      : ["kind", "path", "repository", "symbol"],
    durable_id: ["domain", "kind", "value"],
    runtime_parameter: ["kind", "name"],
    profile_term: ["kind", "term"]
  };
  const keys = shapes[value?.kind];
  if (!keys || !exactKeys(value, keys)) fail(
    "sound_negative_identity_invalid", "grounded identity has an unknown or open shape", { field }
  );
  for (const key of keys.filter((key) => key !== "kind")) nfc(value[key], `${field}.${key}`);
  return structuredClone(value);
}

function role(value, field, allowedTypes) {
  if (!exactKeys(value, ["grounded_identity", "reference_id", "type_term"]) ||
      !REFERENCE_ID.test(value.reference_id ?? "") || !allowedTypes.has(value.type_term)) fail(
    "sound_negative_role_invalid", "capture role has an invalid closed shape or type", { field }
  );
  return {
    grounded_identity: identity(value.grounded_identity, `${field}.grounded_identity`),
    reference_id: value.reference_id,
    type_term: value.type_term
  };
}

function sameRole(left, right) {
  return left.type_term === right.type_term &&
    canonicalDigest(left.grounded_identity) === canonicalDigest(right.grounded_identity);
}

function canonicalBase64(value, field) {
  if (typeof value !== "string" || value.length === 0) fail(
    "sound_negative_base64_invalid", "embedded capture bytes must be canonical base64", { field }
  );
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) fail(
    "sound_negative_base64_invalid", "embedded capture bytes must be canonical base64", { field }
  );
  return bytes;
}

function verifyCaptureProof(proof, evidenceBytes) {
  if (!exactKeys(proof, [
    "evidence_sha256", "public_key_spki_base64", "schema_version",
    "signature_base64", "signer_grounded_identity"
  ]) || proof.schema_version !== PROOF_VERSION || !SHA256.test(proof.evidence_sha256 ?? "") ||
      proof.evidence_sha256 !== sha256(evidenceBytes)) fail(
    "sound_negative_capture_proof_invalid", "capture proof does not bind the exact evidence bytes"
  );
  const publicBytes = canonicalBase64(proof.public_key_spki_base64, "public_key_spki_base64");
  const signer = identity(proof.signer_grounded_identity, "signer_grounded_identity");
  const expectedSigner = {
    kind: "durable_id",
    domain: "controlled-contract:ed25519-public-key:v1",
    value: sha256(publicBytes)
  };
  if (canonicalDigest(signer) !== canonicalDigest(expectedSigner)) fail(
    "sound_negative_capture_signer_mismatch", "capture signer is not grounded in the captured key"
  );
  let key;
  try { key = createPublicKey({ key: publicBytes, format: "der", type: "spki" }); } catch {
    fail("sound_negative_capture_key_invalid", "capture proof public key is invalid");
  }
  const signed = canonicalJsonBytes({
    evidence_sha256: proof.evidence_sha256,
    schema_version: proof.schema_version,
    signer_grounded_identity: proof.signer_grounded_identity
  });
  if (key.asymmetricKeyType !== "ed25519" || !verifySignature(
    null, signed, key, canonicalBase64(proof.signature_base64, "signature_base64")
  )) fail("sound_negative_capture_signature_invalid", "capture proof signature is invalid");
}

function durableReference(referenceId, typeTerm, domain, value = referenceId) {
  return {
    reference_id: referenceId,
    type_term: typeTerm,
    identity: { kind: "durable_id", domain, value }
  };
}

function capturedReference(captured) {
  return {
    reference_id: captured.reference_id,
    type_term: captured.type_term,
    identity: structuredClone(captured.grounded_identity)
  };
}

function ref(referenceId) { return { kind: "reference", reference_id: referenceId }; }
function num(value) { return { kind: "number", value }; }
function bool(value) { return { kind: "boolean", value }; }
function context(mode = "unconditional", ids = []) {
  return { mode, operand_reference_ids: [...ids].sort(compareCodeUnits) };
}
function outputId(kind, value) {
  return `ref-sno-${kind}-${sha256(canonicalJsonBytes(value))}`;
}

function parseEndpoint(value, field) {
  if (!exactKeys(value, ["boundary", "source", "state", "version"]) ||
      !["start", "end"].includes(value.boundary)) fail(
    "sound_negative_endpoint_invalid", "endpoint record has an invalid closed shape", { field }
  );
  return {
    boundary: value.boundary,
    source: role(value.source, `${field}.source`, SOURCE_TYPES),
    state: role(value.state, `${field}.state`, ENDPOINT_TYPES),
    version: role(value.version, `${field}.version`, ENDPOINT_TYPES)
  };
}

function parseEvidence(value) {
  if (!exactKeys(value, [
    "attempt", "declared_observation_total", "declared_source_total", "declared_sources",
    "interval", "schema_version", "source_outcomes", "target"
  ]) || value.schema_version !== EVIDENCE_VERSION || !exactKeys(value.interval, [
    "end", "end_sequence", "start", "start_sequence"
  ]) || !Array.isArray(value.declared_sources) || !Array.isArray(value.source_outcomes)) fail(
    "sound_negative_evidence_invalid", "observation evidence has an invalid closed outer shape"
  );
  return {
    target: role(value.target, "target", TARGET_TYPES),
    attempt: role(value.attempt, "attempt", ATTEMPT_TYPES),
    intervalStart: role(value.interval.start, "interval.start", ENDPOINT_TYPES),
    intervalEnd: role(value.interval.end, "interval.end", ENDPOINT_TYPES),
    startSequence: safeInteger(value.interval.start_sequence, "interval.start_sequence"),
    endSequence: safeInteger(value.interval.end_sequence, "interval.end_sequence"),
    declaredSourceTotal: safeInteger(value.declared_source_total, "declared_source_total"),
    declaredObservationTotal: safeInteger(
      value.declared_observation_total, "declared_observation_total"
    ),
    declaredSources: value.declared_sources.map((entry, index) =>
      role(entry, `declared_sources[${index}]`, SOURCE_TYPES)),
    sourceOutcomes: structuredClone(value.source_outcomes)
  };
}

function addReference(state, reference) {
  const existing = state.references.get(reference.reference_id);
  if (existing && canonicalDigest(existing) !== canonicalDigest(reference)) fail(
    "sound_negative_reference_collision", "derived references collide",
    { reference_id: reference.reference_id }
  );
  state.references.set(reference.reference_id, structuredClone(reference));
}

function addClaim(state, id, subject, operator, applicability, operands, options = {}) {
  const propositionId = `prop-sno-${id}`;
  state.propositions.push({
    proposition_id: propositionId,
    subject_reference_id: subject,
    operator,
    applicability_context: structuredClone(applicability),
    operands: structuredClone(operands)
  });
  const claim = {
    claim_id: `claim-sno-${id}`,
    kind: options.kind ?? "evidence",
    modality: options.modality ?? "MUST",
    proposition_id: propositionId
  };
  state.claims.push(claim);
  return claim.claim_id;
}

function addVerifiedClaim(state, id, verifier, projection, subject, operator,
  applicability, operands, complement) {
  const targetClaim = addClaim(
    state, id, subject, operator, applicability, operands, { kind: "behavior" }
  );
  const verificationPropositionId = `prop-sno-verify-${id}`;
  const falsifierId = `prop-sno-falsifier-${id}`;
  state.propositions.push({
    proposition_id: verificationPropositionId,
    subject_reference_id: verifier,
    operator: "reference:reads",
    applicability_context: structuredClone(applicability),
    operands: [ref(projection), ref(subject), ...structuredClone(operands)]
  }, {
    proposition_id: falsifierId,
    subject_reference_id: subject,
    operator: complement,
    applicability_context: structuredClone(applicability),
    operands: structuredClone(operands)
  });
  const verificationClaim = `claim-sno-verify-${id}`;
  state.claims.push({
    claim_id: verificationClaim,
    kind: "verification",
    modality: "MUST",
    proposition_id: verificationPropositionId,
    verification_method: "test_execution",
    falsifying_proposition_id: falsifierId
  });
  state.relations.push({
    relation_id: `rel-sno-verifies-${id}`,
    role: "verifies",
    source_claim_id: verificationClaim,
    target_claim_id: targetClaim
  });
}

function addPopulation(state, name, memberIds, attemptId) {
  const populationId = POPULATION_IDS[name];
  const members = [...new Set(memberIds)].sort(compareCodeUnits);
  addReference(state, durableReference(
    populationId, "cc:population", "controlled-contract:sound-negative-population:v1", name
  ));
  if (members.length > 0) addClaim(
    state, `${name}-members`, populationId, "reference:contains",
    context("during", [attemptId]), members.map(ref)
  );
  addClaim(state, `${name}-cardinality`, populationId, "number:has_cardinality",
    context("during", [attemptId]), [num(members.length)]);
  return members;
}

function conditionReference(kind, sourceId, rawId, detail) {
  const id = outputId("condition", { kind, sourceId, rawId, detail });
  return durableReference(
    id, "cc:state", "controlled-contract:sound-negative-invalidating-condition:v1", `${kind}:${id}`
  );
}

function rawReference(outcomeIndex, observationIndex, observation, source) {
  const id = outputId("raw", {
    outcome_index: outcomeIndex,
    observation_index: observationIndex,
    source: { type_term: source.type_term, grounded_identity: source.grounded_identity },
    observation_sha256: sha256(canonicalJsonBytes(observation))
  });
  return durableReference(
    id, "cc:evidence_occurrence", "controlled-contract:sound-negative-raw-observation:v1", id
  );
}

function endpointPairReference(source, start, end) {
  const id = outputId("endpoint", {
    source: { type_term: source.type_term, grounded_identity: source.grounded_identity },
    start: { state: start.state, version: start.version },
    end: { state: end.state, version: end.version }
  });
  return durableReference(
    id, "cc:state", "controlled-contract:sound-negative-endpoint-pair:v1", id
  );
}

function positionReference(attempt, source, rawId, sequence) {
  const id = outputId("position", {
    attempt: { type_term: attempt.type_term, grounded_identity: attempt.grounded_identity },
    source: { type_term: source.type_term, grounded_identity: source.grounded_identity },
    raw_observation: rawId,
    sequence
  });
  return durableReference(
    id, "cc:event", "controlled-contract:sound-negative-observation-position:v1", id
  );
}

function candidateSources(value, field) {
  if (!exactKeys(value, [
    "assigned_source", "evidence_content_base64", "kind", "observation_attempt",
    "observed_state", "observed_version", "resolved_target", "sequence", "witnesses"
  ]) || value.kind !== "candidate" || !exactKeys(value.witnesses, [
    "attempt_binding", "authentication", "source_authentication", "source_of_record",
    "target_resolution"
  ])) fail("sound_negative_candidate_invalid", "candidate observation is malformed", { field });
  return {
    assignedSource: role(value.assigned_source, `${field}.assigned_source`, SOURCE_TYPES),
    attempt: role(value.observation_attempt, `${field}.observation_attempt`, ATTEMPT_TYPES),
    observedState: role(value.observed_state, `${field}.observed_state`, ENDPOINT_TYPES),
    observedVersion: role(value.observed_version, `${field}.observed_version`, ENDPOINT_TYPES),
    resolvedTarget: role(value.resolved_target, `${field}.resolved_target`, TARGET_TYPES),
    sequence: safeInteger(value.sequence, `${field}.sequence`),
    sources: {
      evidenceContentBytes: canonicalBase64(
        value.evidence_content_base64, `${field}.evidence_content_base64`
      ),
      targetResolutionWitnessBytes: canonicalBase64(
        value.witnesses.target_resolution, `${field}.witnesses.target_resolution`
      ),
      sourceAuthenticationWitnessBytes: canonicalBase64(
        value.witnesses.source_authentication, `${field}.witnesses.source_authentication`
      ),
      sourceOfRecordAssignmentWitnessBytes: canonicalBase64(
        value.witnesses.source_of_record, `${field}.witnesses.source_of_record`
      ),
      attemptBindingWitnessBytes: canonicalBase64(
        value.witnesses.attempt_binding, `${field}.witnesses.attempt_binding`
      ),
      authenticationWitnessBytes: canonicalBase64(
        value.witnesses.authentication, `${field}.witnesses.authentication`
      )
    }
  };
}

function deriveContract(evidenceValue, sourceDigests) {
  const evidence = parseEvidence(evidenceValue);
  const state = {
    references: new Map(), propositions: [], claims: [], relations: [], collections: []
  };
  for (const item of [
    evidence.target, evidence.attempt, evidence.intervalStart, evidence.intervalEnd,
    ...evidence.declaredSources
  ]) addReference(state, capturedReference(item));

  const verifier = durableReference(
    "ref-sno-verification", "cc:test", "controlled-contract:sound-negative-verifier:v1",
    TRANSFORMER_ID
  );
  const stableState = durableReference(
    "ref-sno-stable-endpoint-state", "cc:state",
    "controlled-contract:sound-negative-endpoint-stability:v1", "stable"
  );
  const evidenceCapture = durableReference(
    "ref-sno-observation-evidence-capture", "cc:artifact",
    "controlled-contract:sound-negative-evidence-source:v1", sourceDigests[0]
  );
  const captureProof = durableReference(
    "ref-sno-observation-capture-proof", "cc:artifact",
    "controlled-contract:sound-negative-proof-source:v1", sourceDigests[1]
  );
  const projection = durableReference(
    "ref-sno-projection-result", "cc:artifact",
    "controlled-contract:sound-negative-projection:v1",
    canonicalDigest({ transformer_id: TRANSFORMER_ID, source_content_sha256: sourceDigests })
  );
  for (const item of [verifier, stableState, evidenceCapture, captureProof, projection]) {
    addReference(state, item);
  }
  addClaim(state, "observation-evidence-capture-exists", evidenceCapture.reference_id,
    "boolean:exists", context("during", [evidence.attempt.reference_id]), [bool(true)]);
  addClaim(state, "observation-capture-proof-exists", captureProof.reference_id,
    "boolean:exists", context("during", [evidence.attempt.reference_id]), [bool(true)]);

  const populations = Object.fromEntries(Object.keys(POPULATION_IDS).map((name) => [name, []]));
  populations["selected-attempt"].push(evidence.attempt.reference_id);
  populations["selected-interval-end"].push(evidence.intervalEnd.reference_id);
  populations["selected-interval-start"].push(evidence.intervalStart.reference_id);
  populations["selected-target"].push(evidence.target.reference_id);
  const conditionKeys = new Set();
  const addCondition = (kind, sourceId = null, rawId = null, detail = null) => {
    const key = canonicalDigest({ kind, sourceId, rawId, detail });
    if (conditionKeys.has(key)) return;
    conditionKeys.add(key);
    const condition = conditionReference(kind, sourceId, rawId, detail);
    addReference(state, condition);
    populations["invalidating-conditions"].push(condition.reference_id);
  };

  const declaredKeys = evidence.declaredSources.map((source) => canonicalDigest({
    type_term: source.type_term, grounded_identity: source.grounded_identity
  }));
  populations["declared-sources"].push(...evidence.declaredSources.map(
    ({ reference_id: id }) => id
  ));
  if (new Set(declaredKeys).size !== declaredKeys.length ||
      evidence.declaredSourceTotal !== evidence.declaredSources.length) {
    addCondition("incomplete-declared-source-population", null, null, {
      declared_source_total: evidence.declaredSourceTotal,
      captured_source_count: evidence.declaredSources.length
    });
  }
  if (evidence.startSequence > evidence.endSequence) addCondition(
    "reversed-observation-interval", null, null,
    { start_sequence: evidence.startSequence, end_sequence: evidence.endSequence }
  );

  const outcomeSourceKeys = [];
  const rawOccurrenceIds = new Set();
  const orderedOutcomes = evidence.sourceOutcomes.map((outcome, originalIndex) => ({
    outcome, originalIndex
  })).sort((left, right) => compareCodeUnits(
    canonicalDigest(left.outcome), canonicalDigest(right.outcome)
  ) || left.originalIndex - right.originalIndex);

  for (const [orderedIndex, entry] of orderedOutcomes.entries()) {
    const { outcome } = entry;
    if (!exactKeys(outcome, ["endpoints", "kind", "observations", "source"]) ||
        !["observed", "store_failure", "missing_coverage"].includes(outcome.kind) ||
        !Array.isArray(outcome.endpoints) || !Array.isArray(outcome.observations)) fail(
      "sound_negative_source_outcome_invalid", "source outcome has an invalid closed shape",
      { outcome_index: entry.originalIndex }
    );
    const source = role(outcome.source, `source_outcomes[${entry.originalIndex}].source`, SOURCE_TYPES);
    addReference(state, capturedReference(source));
    const sourceKey = canonicalDigest({
      type_term: source.type_term, grounded_identity: source.grounded_identity
    });
    outcomeSourceKeys.push(sourceKey);
    populations["observed-sources"].push(source.reference_id);

    const outcomeRef = durableReference(
      outputId("outcome", { source, kind: outcome.kind, original_index: entry.originalIndex }),
      "cc:evidence_occurrence", "controlled-contract:sound-negative-source-outcome:v1"
    );
    addReference(state, outcomeRef);
    populations["source-outcomes"].push(outcomeRef.reference_id);
    addClaim(state, `source-outcome-${orderedIndex + 1}-declared-source`,
      outcomeRef.reference_id, "reference:depends_on",
      context("during", [evidence.attempt.reference_id]), [ref(source.reference_id)]);

    const declaredSource = evidence.declaredSources.find((candidate) => sameRole(candidate, source));
    if (!declaredSource) addCondition(
      "undeclared-observed-source", source.reference_id, null, null
    );
    if (outcome.kind === "missing_coverage") addCondition(
      "missing-source-coverage", source.reference_id, null, null
    );
    if (outcome.kind === "store_failure") addCondition(
      "source-store-failure", source.reference_id, null, null
    );

    const parsedEndpoints = [];
    for (const [endpointIndex, endpointValue] of outcome.endpoints.entries()) {
      try {
        parsedEndpoints.push(parseEndpoint(
          endpointValue,
          `source_outcomes[${entry.originalIndex}].endpoints[${endpointIndex}]`
        ));
      } catch (error) {
        if (!error?.code?.startsWith("sound_negative_")) throw error;
        addCondition("malformed-endpoint", source.reference_id, null, { endpointIndex });
      }
    }
    const starts = parsedEndpoints.filter(({ boundary }) => boundary === "start");
    const ends = parsedEndpoints.filter(({ boundary }) => boundary === "end");
    if (starts.length !== 1 || ends.length !== 1) addCondition(
      "endpoint-cardinality-invalid", source.reference_id, null,
      { start_count: starts.length, end_count: ends.length }
    );
    const start = starts[0];
    const end = ends[0];
    let endpointPair = null;
    if (start && end) {
      for (const endpoint of [start, end]) for (const item of [endpoint.state, endpoint.version]) {
        addReference(state, capturedReference(item));
      }
      if (!sameRole(start.source, source) || !sameRole(end.source, source)) addCondition(
        "mixed-source-endpoint-substitution", source.reference_id, null, null
      );
      endpointPair = endpointPairReference(source, start, end);
      addReference(state, endpointPair);
      populations["endpoint-pairs"].push(endpointPair.reference_id);
      addClaim(state, `source-outcome-${orderedIndex + 1}-endpoint`, outcomeRef.reference_id,
        "reference:has_state", context("during", [evidence.attempt.reference_id]),
        [ref(endpointPair.reference_id)]);
      const stateStable = sameRole(start.state, end.state);
      const versionStable = sameRole(start.version, end.version);
      if (stateStable && versionStable) addClaim(
        state, `endpoint-${orderedIndex + 1}-stable`, endpointPair.reference_id,
        "reference:has_status", context("during", [evidence.attempt.reference_id]),
        [ref(stableState.reference_id)]
      );
      else addCondition("endpoint-drift", source.reference_id, null, {
        state_changed: !stateStable, version_changed: !versionStable
      });
    }

    for (const [observationIndex, observation] of outcome.observations.entries()) {
      const raw = rawReference(orderedIndex, observationIndex, observation, source);
      addReference(state, raw);
      populations["raw-observations"].push(raw.reference_id);
      if (outcome.kind !== "observed") {
        addCondition("observation-on-nonobserved-outcome", source.reference_id, raw.reference_id);
        continue;
      }
      let candidate;
      try {
        candidate = candidateSources(
          observation,
          `source_outcomes[${entry.originalIndex}].observations[${observationIndex}]`
        );
      } catch (error) {
        if (!error?.code?.startsWith("sound_negative_")) throw error;
        addCondition("malformed-observation", source.reference_id, raw.reference_id, error.code);
        continue;
      }
      let occurrenceResult;
      try {
        occurrenceResult = JSON.parse(
          deriveAuthenticationProvenanceOccurrenceCapture(candidate.sources).toString("utf8")
        );
      } catch (error) {
        addCondition("authentication-or-provenance-failure", source.reference_id,
          raw.reference_id, error?.code ?? "untyped");
        continue;
      }
      const projected = {
        occurrence: occurrenceResult.roles.evidence_occurrence,
        attempt: occurrenceResult.roles.observation_attempt,
        source: occurrenceResult.roles.source,
        target: occurrenceResult.roles.target
      };
      const projectedRole = (value) => ({
        reference_id: value.raw_reference_id,
        type_term: value.type_term,
        grounded_identity: { kind: "durable_id", domain: "digest", value: value.grounded_identity_sha256 }
      });
      const projectedMatches =
        projected.attempt.type_term === candidate.attempt.type_term &&
        projected.attempt.grounded_identity_sha256 === canonicalDigest(candidate.attempt.grounded_identity) &&
        projected.source.type_term === candidate.assignedSource.type_term &&
        projected.source.grounded_identity_sha256 === canonicalDigest(candidate.assignedSource.grounded_identity) &&
        projected.target.type_term === candidate.resolvedTarget.type_term &&
        projected.target.grounded_identity_sha256 === canonicalDigest(candidate.resolvedTarget.grounded_identity) &&
        sameRole(candidate.attempt, evidence.attempt) && sameRole(candidate.assignedSource, source);
      if (!projectedMatches) {
        addCondition("observation-role-splice", source.reference_id, raw.reference_id);
        continue;
      }
      if (!endpointPair || !end || !sameRole(candidate.observedState, end.state) ||
          !sameRole(candidate.observedVersion, end.version)) {
        addCondition("stale-observation", source.reference_id, raw.reference_id);
        continue;
      }
      if (candidate.sequence < evidence.startSequence || candidate.sequence > evidence.endSequence) {
        addCondition("observation-outside-interval", source.reference_id, raw.reference_id,
          { sequence: candidate.sequence });
        continue;
      }
      if (rawOccurrenceIds.has(projected.occurrence.raw_reference_id)) {
        addCondition("duplicate-observation", source.reference_id, raw.reference_id);
        continue;
      }
      rawOccurrenceIds.add(projected.occurrence.raw_reference_id);
      const occurrenceReference = {
        reference_id: projected.occurrence.raw_reference_id,
        type_term: projected.occurrence.type_term,
        identity: structuredClone(candidate.attempt.grounded_identity)
      };
      occurrenceReference.identity = {
        kind: "durable_id",
        domain: "controlled-contract:evidence-occurrence:v1",
        value: projected.occurrence.grounded_identity_sha256
      };
      addReference(state, occurrenceReference);
      addReference(state, capturedReference(candidate.resolvedTarget));
      addReference(state, capturedReference(candidate.assignedSource));
      const position = positionReference(evidence.attempt, source, raw.reference_id, candidate.sequence);
      addReference(state, position);
      populations["valid-observations"].push(occurrenceReference.reference_id);
      populations["resolved-targets"].push(candidate.resolvedTarget.reference_id);
      populations["assigned-sources"].push(candidate.assignedSource.reference_id);
      populations["observation-positions"].push(position.reference_id);
      addClaim(state, `raw-${orderedIndex + 1}-${observationIndex + 1}-resolves`, raw.reference_id,
        "reference:resolves_to", context("during", [evidence.attempt.reference_id]),
        [ref(occurrenceReference.reference_id)]);
      addClaim(state, `occurrence-${orderedIndex + 1}-${observationIndex + 1}-position`,
        occurrenceReference.reference_id, "reference:depends_on",
        context("during", [evidence.attempt.reference_id]), [ref(position.reference_id)]);
      addClaim(state, `occurrence-${orderedIndex + 1}-${observationIndex + 1}-target`,
        occurrenceReference.reference_id, "reference:authenticates",
        context("during", [evidence.attempt.reference_id]),
        [ref(candidate.resolvedTarget.reference_id)]);
      addClaim(state, `occurrence-${orderedIndex + 1}-${observationIndex + 1}-source`,
        occurrenceReference.reference_id, "reference:originates_from",
        context("during", [evidence.attempt.reference_id]),
        [ref(candidate.assignedSource.reference_id)]);
      addVerifiedClaim(state, `occurrence-${orderedIndex + 1}-${observationIndex + 1}-authenticates`,
        verifier.reference_id, projection.reference_id, occurrenceReference.reference_id,
        "reference:authenticates", context("during", [evidence.attempt.reference_id]),
        [ref(candidate.resolvedTarget.reference_id)], "reference:does_not_authenticate");
      addVerifiedClaim(state, `occurrence-${orderedIndex + 1}-${observationIndex + 1}-origin`,
        verifier.reference_id, projection.reference_id, occurrenceReference.reference_id,
        "reference:originates_from", context("during", [evidence.attempt.reference_id]),
        [ref(candidate.assignedSource.reference_id)], "reference:does_not_originate_from");
      addVerifiedClaim(state, `occurrence-${orderedIndex + 1}-${observationIndex + 1}-source-record`,
        verifier.reference_id, projection.reference_id, candidate.resolvedTarget.reference_id,
        "reference:has_source_of_record", context("during", [evidence.attempt.reference_id]),
        [ref(candidate.assignedSource.reference_id)], "reference:does_not_have_source_of_record");
      addVerifiedClaim(state, `occurrence-${orderedIndex + 1}-${observationIndex + 1}-attempt`,
        verifier.reference_id, projection.reference_id, occurrenceReference.reference_id,
        "reference:observed_in", context(), [ref(evidence.attempt.reference_id)],
        "reference:not_observed_in");
      const intervalContext = context("during", [
        evidence.attempt.reference_id, evidence.intervalStart.reference_id,
        evidence.intervalEnd.reference_id, position.reference_id
      ]);
      addVerifiedClaim(state, `occurrence-${orderedIndex + 1}-${observationIndex + 1}-interval`,
        verifier.reference_id, projection.reference_id, occurrenceReference.reference_id,
        "reference:member_of", intervalContext,
        [ref(POPULATION_IDS["valid-observations"])], "reference:not_member_of");
      const matchesTarget = sameRole(candidate.resolvedTarget, evidence.target);
      if (matchesTarget) addClaim(
        state, `occurrence-${orderedIndex + 1}-${observationIndex + 1}-match`,
        candidate.resolvedTarget.reference_id, "reference:equals",
        context("during", [evidence.attempt.reference_id]), [ref(evidence.target.reference_id)]
      );
      else addVerifiedClaim(state,
        `occurrence-${orderedIndex + 1}-${observationIndex + 1}-nonmatch`,
        verifier.reference_id, projection.reference_id, candidate.resolvedTarget.reference_id,
        "reference:not_equals", context("during", [evidence.attempt.reference_id]),
        [ref(evidence.target.reference_id)], "reference:equals");
    }
  }

  const declaredSet = new Set(declaredKeys);
  const outcomeSet = new Set(outcomeSourceKeys);
  if (outcomeSourceKeys.length !== outcomeSet.size ||
      declaredSet.size !== outcomeSet.size ||
      [...declaredSet].some((key) => !outcomeSet.has(key)) ||
      [...outcomeSet].some((key) => !declaredSet.has(key))) addCondition(
    "source-coverage-incomplete", null, null,
    { declared: [...declaredSet].sort(), observed: [...outcomeSet].sort() }
  );
  if (evidence.declaredObservationTotal !== populations["raw-observations"].length) addCondition(
    "raw-observation-population-incomplete", null, null,
    { declared: evidence.declaredObservationTotal, captured: populations["raw-observations"].length }
  );

  const hasMatch = populations["valid-observations"].some((_, index) => {
    const targetId = populations["resolved-targets"][index];
    const target = state.references.get(targetId);
    return target?.type_term === evidence.target.type_term &&
      canonicalDigest(target.identity) === canonicalDigest(evidence.target.grounded_identity);
  });
  const conclusion = populations["invalidating-conditions"].length > 0
    ? "unavailable" : hasMatch ? "present" : "absent";
  const conclusionRef = durableReference(
    `ref-sno-conclusion-${conclusion}`, "cc:state",
    "controlled-contract:sound-negative-conclusion:v1", conclusion
  );
  addReference(state, conclusionRef);
  populations[`${conclusion}-conclusion`].push(conclusionRef.reference_id);

  const sourceCountSignal = durableReference(
    "ref-sno-source-count-signal", "cc:evidence",
    "controlled-contract:sound-negative-source-count:v1", String(evidence.declaredSourceTotal)
  );
  const observationCountSignal = durableReference(
    "ref-sno-observation-count-signal", "cc:evidence",
    "controlled-contract:sound-negative-observation-count:v1",
    String(evidence.declaredObservationTotal)
  );
  addReference(state, sourceCountSignal);
  addReference(state, observationCountSignal);
  populations["source-count-signal"].push(sourceCountSignal.reference_id);
  populations["observation-count-signal"].push(observationCountSignal.reference_id);
  addClaim(state, "declared-source-count", sourceCountSignal.reference_id, "number:equals",
    context("during", [evidence.attempt.reference_id]), [num(evidence.declaredSourceTotal)]);
  addClaim(state, "declared-observation-count", observationCountSignal.reference_id,
    "number:equals", context("during", [evidence.attempt.reference_id]),
    [num(evidence.declaredObservationTotal)]);

  for (const [name, members] of Object.entries(populations)) {
    populations[name] = addPopulation(state, name, members, evidence.attempt.reference_id);
  }
  if (conclusion === "absent") addClaim(
    state, "absent-conclusion-is-exact-projected", conclusionRef.reference_id,
    "reference:member_of", context("during", [evidence.attempt.reference_id]),
    [ref(POPULATION_IDS["absent-conclusion"])]
  );
  for (const source of evidence.declaredSources) addClaim(
    state, `declared-source-${source.reference_id}-observed`, source.reference_id,
    "reference:member_of", context("during", [evidence.attempt.reference_id]),
    [ref(POPULATION_IDS["observed-sources"])]
  );
  for (const sourceId of populations["observed-sources"]) addClaim(
    state, `observed-source-${sourceId}-declared`, sourceId,
    "reference:member_of", context("during", [evidence.attempt.reference_id]),
    [ref(POPULATION_IDS["declared-sources"])]
  );
  addClaim(state, "projection-exists", projection.reference_id, "boolean:exists", context(),
    [bool(true)]);

  return {
    schema_version: CONTRACT_VERSION,
    vocabulary_version: "cv.experimental.0.34",
    profile_id: "acceptance-contract.standard.experimental.v0.2",
    references: [...state.references.values()].sort((a, b) =>
      compareCodeUnits(a.reference_id, b.reference_id)),
    propositions: state.propositions.sort((a, b) =>
      compareCodeUnits(a.proposition_id, b.proposition_id)),
    claims: state.claims.sort((a, b) => compareCodeUnits(a.claim_id, b.claim_id)),
    relations: state.relations.sort((a, b) => compareCodeUnits(a.relation_id, b.relation_id)),
    collections: [], residue: [], annotations: []
  };
}

function parseSources(sourceBytes) {
  const values = sourceBytes.map((bytes, index) => ({
    bytes: Buffer.from(bytes),
    value: parseCanonicalDocument(bytes, `sound-negative source[${index}]`)
  }));
  const evidence = values.find(({ value }) => value?.schema_version === EVIDENCE_VERSION);
  const proof = values.find(({ value }) => value?.schema_version === PROOF_VERSION);
  if (!evidence || !proof || evidence === proof) fail(
    "projection_source_set_invalid",
    "sound-negative projection requires one evidence envelope and one capture proof"
  );
  verifyCaptureProof(proof.value, evidence.bytes);
  return [evidence.value, proof.value];
}

function transform(sourceValues, sourceDigests) {
  const evidenceDigest = sourceValues[1].evidence_sha256;
  const proofDigest = sourceDigests.find((digest) => digest !== evidenceDigest);
  if (!proofDigest) fail(
    "projection_source_set_invalid", "capture proof and evidence must be distinct exact sources"
  );
  return deriveContract(sourceValues[0], [evidenceDigest, proofDigest]);
}

function populationMembers(contract, name) {
  const populationId = POPULATION_IDS[name];
  const membership = contract.propositions.find((proposition) =>
    proposition.subject_reference_id === populationId &&
    proposition.operator === "reference:contains");
  const cardinality = contract.propositions.find((proposition) =>
    proposition.subject_reference_id === populationId &&
    proposition.operator === "number:has_cardinality");
  const members = membership?.operands.map(({ reference_id: id }) => id) ?? [];
  if (!cardinality || cardinality.operands.length !== 1 ||
      cardinality.operands[0].kind !== "number" ||
      cardinality.operands[0].value !== members.length || !sortedUnique(members)) fail(
    "sound_negative_projection_population_invalid",
    "projection population is not complete and canonical", { population: name }
  );
  return members;
}

function fixedReference(contract, referenceId) {
  const reference = contract.references.find(({ reference_id: id }) => id === referenceId);
  if (!reference) fail(
    "sound_negative_projection_reference_missing", "projected reference is missing",
    { reference_id: referenceId }
  );
  return {
    grounded_identity_sha256: canonicalDigest(reference.identity),
    reference_id: reference.reference_id,
    type_term: reference.type_term
  };
}

function singletonPopulation(contract, name) {
  const members = populationMembers(contract, name);
  if (members.length !== 1) fail(
    "sound_negative_projection_singleton_invalid", "projected singleton is not present",
    { population: name }
  );
  return fixedReference(contract, members[0]);
}

function assertResult(value) {
  if (!exactKeys(value, [
    "annotations", "claims", "collections", "profile_id", "propositions", "references",
    "relations", "residue", "schema_version", "vocabulary_version"
  ]) || value.schema_version !== CONTRACT_VERSION ||
      value.vocabulary_version !== "cv.experimental.0.34" ||
      value.profile_id !== "acceptance-contract.standard.experimental.v0.2" ||
      !Array.isArray(value.references) || !Array.isArray(value.propositions) ||
      !Array.isArray(value.claims) || !Array.isArray(value.relations) ||
      !Array.isArray(value.collections) || value.collections.length !== 0 ||
      !Array.isArray(value.residue) || value.residue.length !== 0 ||
      !Array.isArray(value.annotations) || value.annotations.length !== 0) fail(
    "sound_negative_projection_result_invalid", "projection is not a closed v0.2 contract"
  );
  const graph = validateProjectedContractWithStableCore(value);
  if (!graph.schema_valid || graph.diagnostics.length !== 0) fail(
    "sound_negative_projection_result_invalid",
    "projection fails contract graph invariants",
    { diagnostics: graph.diagnostics, schema_errors: graph.schema_errors }
  );
  if (!sortedUnique(value.references.map(({ reference_id: id }) => id))) fail(
    "sound_negative_projection_result_noncanonical", "projection references are not canonical"
  );
  for (const name of Object.keys(POPULATION_IDS)) populationMembers(value, name);
  const selected = CONCLUSIONS.flatMap((name) => populationMembers(value, `${name}-conclusion`));
  if (selected.length !== 1) fail(
    "sound_negative_projection_conclusion_invalid", "projection must derive exactly one conclusion"
  );
  return deepFreeze(value);
}

const projections = {};
for (const [name, populationId] of Object.entries(POPULATION_IDS)) {
  projections[name] = Object.freeze({
    cardinality: "set", project: (contract) => populationMembers(contract, name)
  });
  projections[`${name}-population`] = Object.freeze({
    cardinality: "singleton_reference", project: (contract) => fixedReference(contract, populationId)
  });
}
for (const [name, referenceId] of Object.entries({
  "capture-proof": "ref-sno-observation-capture-proof",
  "interval-end": null,
  "interval-start": null,
  "observation-attempt": null,
  "observation-evidence": "ref-sno-observation-evidence-capture",
  "projection-result": "ref-sno-projection-result",
  "stable-endpoint-state": "ref-sno-stable-endpoint-state",
  target: null,
  verification: "ref-sno-verification"
})) projections[name] = Object.freeze({
  cardinality: "singleton_reference",
  project: (contract) => referenceId ? fixedReference(contract, referenceId) :
    singletonPopulation(contract, ({
      "observation-attempt": "selected-attempt",
      "interval-start": "selected-interval-start",
      "interval-end": "selected-interval-end",
      target: "selected-target"
    })[name])
});

function projectGraph(contract) {
  return {
    schema_version: GRAPH_VERSION,
    references: structuredClone(contract.references),
    propositions: structuredClone(contract.propositions),
    claims: structuredClone(contract.claims),
    relations: structuredClone(contract.relations),
    collections: structuredClone(contract.collections)
  };
}

const SOUND_NEGATIVE_OBSERVATION_TRANSFORMER = Object.freeze({
  transformer_id: TRANSFORMER_ID,
  source_count: 2,
  parse_sources: parseSources,
  transform,
  validate_result: assertResult,
  projections: Object.freeze(projections),
  graph_projections: Object.freeze({
    "observation-contract": Object.freeze({ project: projectGraph })
  })
});

function deriveSoundNegativeObservationCapture({ evidenceBytes, captureProofBytes }) {
  if (!Buffer.isBuffer(evidenceBytes) || !Buffer.isBuffer(captureProofBytes)) fail(
    "projection_source_set_incomplete", "sound-negative capture requires two exact Buffer sources"
  );
  const values = parseSources([evidenceBytes, captureProofBytes]);
  const digests = [sha256(evidenceBytes), sha256(captureProofBytes)];
  const first = canonicalJsonBytes(assertResult(transform(structuredClone(values), digests)), {
    file: true
  });
  const second = canonicalJsonBytes(assertResult(transform(structuredClone(values), digests)), {
    file: true
  });
  if (!first.equals(second)) fail(
    "projection_transformer_nondeterministic", "sound-negative projection is nondeterministic"
  );
  return Buffer.from(first);
}

export {
  EVIDENCE_VERSION,
  POPULATION_IDS,
  PROOF_VERSION,
  SOUND_NEGATIVE_OBSERVATION_TRANSFORMER,
  TRANSFORMER_ID,
  assertResult as assertSoundNegativeObservationCapture,
  deriveSoundNegativeObservationCapture
};
