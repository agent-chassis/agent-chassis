import { createPrivateKey, createPublicKey, sign } from "node:crypto";

import {
  canonicalDigest,
  canonicalJsonBytes,
  sha256
} from "../../lib/exact-binding-common.mjs";
import {
  EVIDENCE_VERSION,
  PROOF_VERSION,
  deriveSoundNegativeObservationCapture
} from "../../lib/sound-negative-observation-projection.mjs";
import {
  buildAuthenticationProvenanceSources,
  durableIdentity
} from "./authentication-provenance-v1-fixture.mjs";

const role = (referenceId, typeTerm, groundedIdentity) => ({
  grounded_identity: groundedIdentity,
  reference_id: referenceId,
  type_term: typeTerm
});

function proofKey(label) {
  const seed = Buffer.from(sha256(Buffer.from(`sound-negative-key:${label}`, "utf8")), "hex");
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8"
  });
  const publicKeyBytes = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return {
    privateKey,
    publicKeyBytes,
    signer: durableIdentity("controlled-contract:ed25519-public-key:v1", sha256(publicKeyBytes))
  };
}

function signEnvelope(evidence, label = "capture") {
  const evidenceBytes = canonicalJsonBytes(evidence, { file: true });
  const key = proofKey(label);
  const unsigned = {
    evidence_sha256: sha256(evidenceBytes),
    schema_version: PROOF_VERSION,
    signer_grounded_identity: structuredClone(key.signer)
  };
  const captureProof = {
    ...unsigned,
    public_key_spki_base64: key.publicKeyBytes.toString("base64"),
    signature_base64: sign(null, canonicalJsonBytes(unsigned), key.privateKey).toString("base64")
  };
  return {
    evidenceBytes,
    captureProofBytes: canonicalJsonBytes(captureProof, { file: true })
  };
}

function endpoint(source, boundary, variant = "stable") {
  const stateSide = ["state", "both"].includes(variant) && boundary === "end"
    ? "changed" : "stable";
  const versionSide = ["version", "both"].includes(variant) && boundary === "end"
    ? "changed" : "stable";
  return {
    boundary,
    source: structuredClone(source),
    state: role(`ref-endpoint-state-${source.reference_id.slice(4)}-${stateSide}`, "cc:state",
      durableIdentity("sound-negative:endpoint-state", `${source.reference_id}:${stateSide}`)),
    version: role(`ref-endpoint-version-${source.reference_id.slice(4)}-${versionSide}`, "cc:state",
      durableIdentity("sound-negative:endpoint-version", `${source.reference_id}:${versionSide}`))
  };
}

function candidate(capture, endpointValue, sequence) {
  return {
    kind: "candidate",
    sequence,
    assigned_source: structuredClone(capture.roles.source),
    observation_attempt: structuredClone(capture.roles.attempt),
    observed_state: structuredClone(endpointValue.state),
    observed_version: structuredClone(endpointValue.version),
    resolved_target: structuredClone(capture.roles.target),
    evidence_content_base64: capture.input.evidenceContentBytes.toString("base64"),
    witnesses: {
      attempt_binding: capture.input.attemptBindingWitnessBytes.toString("base64"),
      authentication: capture.input.authenticationWitnessBytes.toString("base64"),
      source_authentication: capture.input.sourceAuthenticationWitnessBytes.toString("base64"),
      source_of_record: capture.input.sourceOfRecordAssignmentWitnessBytes.toString("base64"),
      target_resolution: capture.input.targetResolutionWitnessBytes.toString("base64")
    }
  };
}

function buildSoundNegativeObservationSources({
  conclusion = "absent",
  sourceCount = conclusion === "absent" ? 2 : 1,
  observationCount = conclusion === "absent" ? 2 : 1,
  domain = "record-lookup",
  unicode = false,
  targetType = "cc:state",
  sourceType = "cc:resource",
  attemptType = "cc:event",
  endpointVariant = "stable"
} = {}) {
  const suffix = `${domain.replaceAll(/[^a-z0-9]+/gu, "-")}${unicode ? "-unicode" : ""}`;
  const captureCount = Math.max(sourceCount, observationCount, 1);
  const captures = Array.from({ length: captureCount }, (_, index) =>
    buildAuthenticationProvenanceSources({
      evidenceContentBytes: Buffer.from(`evidence:${domain}:${index}${unicode ? ":東京" : ""}\n`),
      occurrenceSuffix: suffix,
      targetSuffix: `${index + 1}`,
      sourceSuffix: `${index + 1}`,
      targetType,
      sourceType,
      attemptType,
      unicode
    }));
  const attempt = structuredClone(captures[0].roles.attempt);
  const target = conclusion === "present"
    ? structuredClone(captures[0].roles.target)
    : role("ref-query-target", targetType, durableIdentity(
      unicode ? "sound-negative:查询" : "sound-negative:query", `missing:${domain}`
    ));
  const declaredSources = captures.slice(0, sourceCount).map(({ roles }) =>
    structuredClone(roles.source)).sort((left, right) => {
      const a = canonicalDigest(left.grounded_identity);
      const b = canonicalDigest(right.grounded_identity);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const sourceOutcomes = declaredSources.map((source, index) => {
    const capture = captures.find(({ roles }) =>
      canonicalDigest(roles.source.grounded_identity) === canonicalDigest(source.grounded_identity));
    const start = endpoint(source, "start", endpointVariant);
    const end = endpoint(source, "end", endpointVariant);
    return {
      kind: "observed",
      source,
      endpoints: [start, end],
      observations: index < observationCount ? [candidate(capture, end, 10 + index)] : []
    };
  });
  const evidence = {
    schema_version: EVIDENCE_VERSION,
    target,
    attempt,
    interval: {
      start: role("ref-observation-interval-start", "cc:event",
        durableIdentity("sound-negative:interval", `${suffix}:start`)),
      end: role("ref-observation-interval-end", "cc:event",
        durableIdentity("sound-negative:interval", `${suffix}:end`)),
      start_sequence: 10,
      end_sequence: 10 + Math.max(observationCount - 1, 0)
    },
    declared_sources: declaredSources,
    source_outcomes: sourceOutcomes,
    declared_source_total: sourceCount,
    declared_observation_total: observationCount
  };
  if (conclusion === "unavailable" && sourceOutcomes.length > 0) {
    sourceOutcomes[0].kind = "store_failure";
    sourceOutcomes[0].observations = [];
    evidence.declared_observation_total = 0;
  }
  const signed = signEnvelope(evidence, `${domain}:${conclusion}:${endpointVariant}`);
  return {
    evidence,
    ...signed,
    projectionBytes: deriveSoundNegativeObservationCapture(signed)
  };
}

function resign(evidence, label) {
  const signed = signEnvelope(evidence, label);
  return { evidence, ...signed, projectionBytes: deriveSoundNegativeObservationCapture(signed) };
}

export {
  buildSoundNegativeObservationSources,
  candidate,
  endpoint,
  resign,
  signEnvelope
};
