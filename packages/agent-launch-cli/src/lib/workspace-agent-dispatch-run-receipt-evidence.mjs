import { typedRefusal } from "./workspace-agent-dispatch-run-receipt-store-io.mjs";
import { projectTestProofRuntimeEvidenceReceipt } from "./workspace-agent-test-proof-evidence.mjs";
import { projectWriteConfinementEvidence } from "./workspace-agent-write-confinement-evidence.mjs";
import { assertBehavioralPreservationEvidencePair } from "./workspace-agent-behavioral-preservation-evidence.mjs";

export function extractTestProofRuntimeEvidenceReceipt(attempt) {
  return projectTestProofRuntimeEvidenceReceipt(attempt);
}

export function extractWriteConfinementEvidenceProjection(input) {
  return projectWriteConfinementEvidence(input);
}

export const PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_SCHEMA_VERSION =
  "workspace-agent-behavioral-preservation-pair-receipt.v1";
export const PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_REFUSAL_CODES = Object.freeze({
  INPUT_OVER_BOUND: "behavioral_preservation_pair_receipt.input_over_bound.v1",
  PROJECTION_FAILED: "behavioral_preservation_pair_receipt.projection_failed.v1"
});

const PRODUCED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function extractPairedBehavioralPreservationEvidenceReceipt(pair) {
  if (arguments.length > 1) {
    throw typedRefusal(
      "pair receipt projection accepts exactly one launcher-assembled pair evidence object",
      PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_REFUSAL_CODES.INPUT_OVER_BOUND
    );
  }
  const validated = assertBehavioralPreservationEvidencePair(pair);
  try {
    const producedAt = new Date().toISOString();
    if (!PRODUCED_AT_RE.test(producedAt) || validated.body_bytes.includes(producedAt)) {
      throw new Error("launcher production time is not a distinct envelope-only instant");
    }
    const envelope = Object.freeze({
      schema_version: PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_SCHEMA_VERSION,
      pair_id: validated.pair_id,
      pair_evidence: validated.pair_evidence,
      body_bytes: validated.body_bytes,
      body_digest: validated.body_digest,
      produced_at: producedAt,
      produced_by: "launcher",
      semantic_judgment: validated.semantic_judgment,
      advisory: true,
      admission_effect: "none",
      review_effect: "none",
      integration_effect: "none",
      publication_effect: "none",
      proof_credit_effect: "none",
      applicability_effect: "none",
      behavioral_equivalence_effect: "none",
      business_semantic_effect: "none",
      policy_effect: "none",
      authority_effect: "none"
    });
    if (envelope.body_bytes !== validated.body_bytes || envelope.body_digest !== validated.body_digest) {
      throw new Error("pair body bytes and digest are not carried byte-for-byte");
    }
    return envelope;
  } catch (cause) {
    throw typedRefusal(
      "a validated pair evidence object could not be projected into a timed envelope",
      PAIRED_BEHAVIORAL_PRESERVATION_RECEIPT_REFUSAL_CODES.PROJECTION_FAILED,
      cause
    );
  }
}
