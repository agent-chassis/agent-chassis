
import { isPlainObject } from "./backend-review-identity.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import { computeWorkRecordSourceDigest, projectSliceReviewReceiptContracts } from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import { parseCanonicalRecord } from "./slice-integration-authorization.mjs";
import {
  SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_POLICY_POSTURES
} from "./slice-integration-authorization.mjs";

const CCE_BOUNDARY_POLICY_DECISION_SCHEMA_VERSION =
  "cce-boundary-policy-decision.v1";
const CCE_BOUNDARY_POLICY_REQUEST_SCHEMA_VERSION =
  "cce-boundary-policy-request.v1";
const CCE_POLICY_REFUSAL_SCHEMA_VERSION = "cce-policy-refusal.v1";
export const CCE_POLICY_REFUSAL_CODES = Object.freeze({
  MISSING: "agent_launch.slice_integration.cce_policy_decision_missing.v1",
  UNAVAILABLE: "agent_launch.slice_integration.cce_policy_unavailable.v1",
  MALFORMED: "agent_launch.slice_integration.cce_policy_malformed.v1",
  OVERSIZED: "agent_launch.slice_integration.cce_policy_oversized.v1",
  UNRATIFIED: "agent_launch.slice_integration.cce_policy_unratified.v1",
  DENIED: "agent_launch.slice_integration.cce_policy_denied.v1",
  TARGET_MISMATCH: "agent_launch.slice_integration.cce_policy_target_mismatch.v1"
});
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const CCE_POLICY_DECISION_MAX_BYTES = 64 * 1024;
const CCE_POLICY_ID_MAX_CHARS = 256;
const CCE_BOUNDARY_POLICY_DECISION_FIELDS = Object.freeze([
  "attestation_digest", "attestation_valid", "decision", "decision_id", "operation",
  "policy_id", "ratified", "schema_version", "target"
]);
const CCE_BOUNDARY_TARGET_FIELDS = Object.freeze([
  "committed_target_digest", "diff_base_sha", "initiative", "reviewed_sha",
  "slice_ref", "subject"
]);

export function createIntegrationDispositionSource({ reader, context, inlineDispositions = null }) {
  let pending = null;
  let saved = null;
  const snapshot = parseCanonicalRecord(context.main_repo, context.record_id);
  if (projectSliceReviewReceiptContracts(snapshot, context.review_slice_id).canonical_parent_wk_contract !==
      context.canonical_parent_wk_contract) throw Object.assign(new Error("canonical integration contract moved before source selection"), {
    code: "agent_launch.slice_integration.current_binding_stale.v1",
    detail: { reason: "canonical integration contract moved before source selection" }
  });
  let expectedRevision = computeWorkRecordSourceDigest(snapshot);
  const fail = (code, message, detail) => { throw Object.assign(new Error(message), { code, detail: { reason: message, ...detail } }); };
  async function read(revision = expectedRevision) {
    if (reader === null) return inlineDispositions;
    if (pending === null) pending = (async () => {
      saved = await reader({ capturedUnit: { repoRoot: context.main_repo,
        unit: context.review_subject }, expectedRevision: revision,
      deliveryIdentity: { subject: context.review_subject, commit: context.reviewed_sha,
        base: context.diff_base_sha } });
      if (saved?.state !== "present" && saved?.state !== "absent") {
        fail(saved?.cause?.code ?? "agent_launch.slice_integration.saved_source_mismatch.v1",
          saved?.cause?.message ?? "saved integration disposition source is unavailable or changed", { saved_dispositions: saved });
      }
      if (saved.source?.revision !== revision || saved.source?.unit !== context.review_subject) {
        fail("agent_launch.slice_integration.saved_source_mismatch.v1",
          "saved disposition source does not match the admitted canonical revision", { saved_dispositions: saved });
      }
      expectedRevision = revision;
      return saved.state === "present" ? saved.rows : null;
    })();
    return pending;
  }
  function loadCanonicalRecord(mainRepo, wkId) {
    const record = parseCanonicalRecord(mainRepo, wkId);
    if (reader !== null && computeWorkRecordSourceDigest(record) !== expectedRevision) {
      fail("agent_launch.slice_integration.saved_source_mismatch.v1",
        "canonical saved source moved before integration effects", { expected_revision: expectedRevision,
          current_revision: computeWorkRecordSourceDigest(record), saved_dispositions: saved });
    }
    return record;
  }
  function wrote(record, result) {
    if (result?.written === true) expectedRevision = computeWorkRecordSourceDigest(record);
    return result;
  }
  return { read, loadCanonicalRecord, wrote, get saved() { return saved; } };
}

function hasExactKeys(value, expected) {
  return isPlainObject(value) &&
    Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

export function ccePolicyRefusal(code, reason, detail = null) {
  const diagnosticKind = new Set([
    CCE_POLICY_REFUSAL_CODES.UNRATIFIED,
    CCE_POLICY_REFUSAL_CODES.DENIED,
    CCE_POLICY_REFUSAL_CODES.TARGET_MISMATCH
  ]).has(code)
    ? "returned_cce_policy_decision"
    : "configured_cce_evidence_failure";
  return Object.freeze({
    integrated: false,
    refused: true,
    refusal: Object.freeze({
      schema_version: CCE_POLICY_REFUSAL_SCHEMA_VERSION,
      code,
      reason,
      detail,
      diagnostic_kind: diagnosticKind
    })
  });
}

function exactBoundaryTarget(context) {
  return Object.freeze({
    subject: context.review_subject,
    initiative: context.initiative,
    slice_ref: context.slice_ref,
    reviewed_sha: context.reviewed_sha,
    diff_base_sha: context.diff_base_sha,
    committed_target_digest: context.committed_target_digest
  });
}

function sameBoundaryTarget(left, right) {
  return left?.subject === right.subject &&
    left?.initiative === right.initiative &&
    left?.slice_ref === right.slice_ref &&
    left?.reviewed_sha === right.reviewed_sha &&
    left?.diff_base_sha === right.diff_base_sha &&
    left?.committed_target_digest === right.committed_target_digest;
}

function freeSubstrateBoundaryAuthorization(target) {
  return Object.freeze({
    schema_version: SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
    operation: "integrate_committed_slice",
    policy_posture: SLICE_INTEGRATION_POLICY_POSTURES.FREE_SUBSTRATE,
    policy_gate_configured: false,
    authority: "none",
    decision: "not_gated",
    ratified: false,
    attestation_valid: false,
    audit_grade: false,
    target
  });
}

export function createSliceIntegrationPolicyAuthorizer(sliceIntegrationCcePolicy) {
  async function resolveSliceIntegrationBoundaryAuthorization({
    context,
    evidence,
    orchestratorDispositions
  }) {
    const target = exactBoundaryTarget(context);
    if (sliceIntegrationCcePolicy === null || sliceIntegrationCcePolicy?.configured === false) {
      return { ok: true, authorization: freeSubstrateBoundaryAuthorization(target) };
    }
    if (!isPlainObject(sliceIntegrationCcePolicy) ||
        sliceIntegrationCcePolicy.configured !== true) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MALFORMED,
          "committed-slice CCE policy gate configuration is malformed"
        )
      };
    }
    if (typeof sliceIntegrationCcePolicy.authorize !== "function") {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MISSING,
          "configured CCE policy gate has no authorization resolver"
        )
      };
    }
    let decision;
    try {
      decision = await sliceIntegrationCcePolicy.authorize(Object.freeze({
        schema_version: CCE_BOUNDARY_POLICY_REQUEST_SCHEMA_VERSION,
        operation: "integrate_committed_slice",
        target,
        advisory_review_evidence: evidence,
        orchestrator_dispositions: orchestratorDispositions
      }));
    } catch (error) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.UNAVAILABLE,
          "configured CCE policy authorization is unavailable",
          {
            diagnostic_code: typeof error?.code === "string" ? error.code : null,
            evidence: captureDiagnosticEvidence(error)
          }
        )
      };
    }
    if (decision === null || decision === undefined) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MISSING,
          "configured CCE policy returned no decision"
        )
      };
    }
    let decisionBytes;
    let serializationEvidence = null;
    try {
      decisionBytes = Buffer.byteLength(JSON.stringify(decision), "utf8");
    } catch (error) {

      decisionBytes = CCE_POLICY_DECISION_MAX_BYTES + 1;
      serializationEvidence = captureDiagnosticEvidence(error);
    }
    if (decisionBytes > CCE_POLICY_DECISION_MAX_BYTES) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.OVERSIZED,
          "configured CCE policy returned an oversized decision",
          {
            observed_bytes: decisionBytes,
            max_bytes: CCE_POLICY_DECISION_MAX_BYTES,
            ...(serializationEvidence === null ? {} : { serialization_evidence: serializationEvidence })
          }
        )
      };
    }
    if (!hasExactKeys(decision, CCE_BOUNDARY_POLICY_DECISION_FIELDS) ||
        decision.schema_version !== CCE_BOUNDARY_POLICY_DECISION_SCHEMA_VERSION ||
        decision.operation !== "integrate_committed_slice" ||
        !new Set(["allow", "deny"]).has(decision.decision) ||
        typeof decision.policy_id !== "string" || decision.policy_id.length === 0 ||
        decision.policy_id.length > CCE_POLICY_ID_MAX_CHARS ||
        typeof decision.decision_id !== "string" || decision.decision_id.length === 0 ||
        decision.decision_id.length > CCE_POLICY_ID_MAX_CHARS ||
        !SHA256_DIGEST_RE.test(decision.attestation_digest ?? "") ||
        typeof decision.ratified !== "boolean" ||
        typeof decision.attestation_valid !== "boolean" ||
        !hasExactKeys(decision.target, CCE_BOUNDARY_TARGET_FIELDS)) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MALFORMED,
          "configured CCE policy returned a malformed decision"
        )
      };
    }
    if (!sameBoundaryTarget(decision.target, target)) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.TARGET_MISMATCH,
          "configured CCE policy decision is bound to a different exact target"
        )
      };
    }
    if (decision.ratified !== true || decision.attestation_valid !== true) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.UNRATIFIED,
          "configured CCE policy decision is unratified or has invalid attestation"
        )
      };
    }
    if (decision.decision !== "allow") {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.DENIED,
          "configured CCE policy denied committed-slice integration",
          { policy_id: decision.policy_id, decision_id: decision.decision_id }
        )
      };
    }
    return {
      ok: true,
      authorization: Object.freeze({
        schema_version: SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
        operation: "integrate_committed_slice",
        policy_posture: SLICE_INTEGRATION_POLICY_POSTURES.CCE_POLICY,
        policy_gate_configured: true,
        authority: "cce",
        decision: "allow",
        ratified: true,
        attestation_valid: true,
        audit_grade: true,
        policy_id: decision.policy_id,
        decision_id: decision.decision_id,
        attestation_digest: decision.attestation_digest,
        target
      })
    };
  }

  return resolveSliceIntegrationBoundaryAuthorization;
}
