const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;
import { VERIFY_PROOF_SUMMARY_SCHEMA_VERSION, isVerifyProofEvidenceReference } from "./mcp-response.mjs";
import { mcpContentReferenceFirstCall, mcpContentReferenceReassembly } from
  "./mcp-content-reference-tools.mjs";
import { PUBLIC_PROOF_STATUS_VALUES, projectProofEvidencePresentation } from
  "./verify-proof-result-detail.mjs";
const SUMMARY_DIAGNOSTIC_CODE_LIMIT = 8;
const SUMMARY_STATUSES = PUBLIC_PROOF_STATUS_VALUES;

export const RETAINED_OUTCOME_SUMMARY_BYTE_BUDGET = 4096;
export const VERIFY_PROOF_OUTCOME_SUMMARY_SCHEMA_VERSION = "workspace-verify-proof-outcome-summary.v1";

function summaryDiagnosticFacts(diagnostics) {
  const entries = Array.isArray(diagnostics) ? diagnostics : [];
  const codes = new Set();
  for (const entry of entries) {
    const code = entry?.code ?? entry?.reason_code;
    if (typeof code === "string" && STABLE_CODE_RE.test(code)) codes.add(code);
  }
  const sorted = [...codes].sort();
  return {
    diagnostic_count: entries.length,
    diagnostic_codes: sorted.slice(0, SUMMARY_DIAGNOSTIC_CODE_LIMIT),
    diagnostic_codes_omitted: Math.max(0, sorted.length - SUMMARY_DIAGNOSTIC_CODE_LIMIT)
  };
}

function summaryRepair(repair) {
  if (repair === null || typeof repair !== "object") return undefined;
  return {
    semantic_owner: repair.semantic_owner,
    capability_status: repair.capability_status,
    required_meaning: structuredClone(repair.required_meaning ?? {}),
    correction_route: repair.correction_route ?? null,
    next_step: repair.next_step,
    execution_evidence: "owned_by_workspace_verify_proof"
  };
}

function summaryRecovery(recovery, proof = null) {
  if (recovery === null || typeof recovery !== "object") return undefined;
  const { repair: rawRepair, subject, follow_up_call: call, ...rest } = structuredClone(recovery);
  const repair = summaryRepair(rawRepair);
  const ownSubject = proof !== null && subject?.test_proof_id === proof.test_proof_id &&
    subject?.verification_id === proof.verification_id;
  return {
    ...rest,
    ...(subject === undefined || ownSubject ? {} : { subject }),
    ...(call === undefined ? {} : { follow_up_call: {
      tool: call.tool,
      arguments: Object.fromEntries(Object.entries(call.arguments ?? {}).map(([key, value]) =>
        [key, proof !== null && value === proof.test_proof_id ? { from_row: "test_proof_id" } : value]))
    } }),
    ...(repair === undefined ? {} : { repair })
  };
}

function proofReason(proof) {
  if (proof.status === "proven") return undefined;
  const recovery = summaryRecovery(proof.recovery, proof);
  return { reason_code: proof.reason_code ?? null,
    ...(recovery === undefined ? {} : { recovery }) };
}

function relationshipReason(relationship) {
  if (relationship.status === "proven") return undefined;
  const facts = summaryDiagnosticFacts(relationship.diagnostics);
  return { reason_code: relationship.reason_code ?? null,
    ...(facts.diagnostic_count === 0 ? {} : facts) };
}

function summaryLimitations(proof) {
  const codes = new Set((proof.observed_evidence?.capability_limitations ?? [])
    .map(({ reason_code: code }) => code)
    .filter((code) => typeof code === "string" && STABLE_CODE_RE.test(code)));
  return codes.size === 0 ? undefined : [...codes].sort();
}

function summaryMutation(mutation) {
  if (mutation.status === "not_run") return undefined;
  return {
    status: mutation.status,
    ...Object.fromEntries(["detected", "survived", "unavailable", "unevaluable"]
      .filter((outcome) => mutation[`${outcome}_count`] > 0)
      .map((outcome) => [outcome, mutation[`${outcome}_count`]]))
  };
}

function summarySelectedTest(selected) {
  if (selected === null || typeof selected !== "object") return undefined;
  return {
    test_id: selected.test_id,
    ...(typeof selected.file === "string" ? { file: selected.file } : {}),
    ...(typeof selected.name === "string" ? { name: selected.name } : {}),
    ...(typeof selected.node_id === "string" ? { node_id: selected.node_id } : {})
  };
}

function summaryRow(proof) {
  const limitations = summaryLimitations(proof);
  const presentation = projectProofEvidencePresentation(proof);
  const mutation = summaryMutation(presentation.mutation_evidence);
  const selectedTest = summarySelectedTest(proof.selected_test);
  return {
    test_proof_id: proof.test_proof_id,
    verification_id: proof.verification_id,
    status: proof.status,
    readiness_status: proof.readiness_status,
    execution_status: proof.execution_status,
    ...(selectedTest === undefined ? {} : { selected_test: selectedTest }),

    selected_status: presentation.test_observation.status,
    ...(mutation === undefined ? {} : { mutation_evidence: mutation }),
    ...(typeof proof.declared_target?.target === "string"
      ? { declared_target: proof.declared_target.target } : {}),

    ...(typeof proof.runtime_environment?.environment === "string"
      ? { environment: proof.runtime_environment.environment } : {}),
    ...(limitations === undefined ? {} : { capability_limitations: limitations }),
    reason: proofReason(proof),
    obligations: (proof.relationship_results ?? []).map((relationship) => ({
      obligation_id: relationship.obligation_id,
      status: relationship.status,
      reason: relationshipReason(relationship)
    }))
  };
}

function statusCounts(rows) {
  return Object.fromEntries(SUMMARY_STATUSES.map((status) =>
    [status, rows.filter((row) => row.status === status).length]));
}

function materializeRows(rows) {
  const refs = new Map();
  const reasons = {};
  const reference = (entry) => {
    if (entry === undefined) return undefined;
    const key = JSON.stringify(entry);
    if (!refs.has(key)) {
      const ref = `reason-${refs.size + 1}`;
      refs.set(key, ref);
      reasons[ref] = structuredClone(entry);
    }
    return refs.get(key);
  };
  const proofs = rows.map(({ reason: reasonEntry, obligations, ...facts }) => {
    const reason = reference(reasonEntry);
    return {
      ...facts,
      ...(reason === undefined ? {} : { reason }),
      obligations: obligations.map((obligation) => {
        const obligationReason = reference(obligation.reason);
        return { obligation_id: obligation.obligation_id, status: obligation.status,
          ...(obligationReason === undefined ? {} : { reason: obligationReason }) };
      })
    };
  });
  return { proofs, reasons };
}

export function verifyProofEvidenceRetrieval(reference) {
  const { content_reference: contentReference } = reference;
  return Object.freeze({
    first_call: mcpContentReferenceFirstCall(contentReference),
    reassembly: mcpContentReferenceReassembly("decode the verified bytes as UTF-8 and parse JSON"),
    expected: Object.freeze({ byte_count: contentReference.byte_count,
      sha256: contentReference.sha256,
      schema_version: reference.evidence_schema_version,
      result_digest: reference.item_identity })
  });
}

export function projectVerifyProofOutcomeCore(evidence, { fits = () => true,
  decorate = (summary) => summary } = {}) {
  const rows = evidence.proof_results.map(summaryRow);
  const relationshipRows = evidence.proof_results.flatMap((proof) => proof.relationship_results ?? []);
  const counts = Object.freeze({
    proofs: Object.freeze({ total: evidence.counts.proofs, ...structuredClone(
      (({ proofs: _proofs, relationships: _relationships, ...rest }) => rest)(evidence.counts)) }),
    obligation_relationships: Object.freeze({
      total: evidence.counts.relationships,
      distinct_obligations: new Set(relationshipRows.map(({ obligation_id: id }) => id)).size,
      ...statusCounts(relationshipRows)
    })
  });
  const aggregateFacts = summaryDiagnosticFacts(evidence.diagnostics);
  const priority = rows.map((row, index) => ({ row, index }))
    .sort((left, right) => Number(left.row.status === "proven") -
      Number(right.row.status === "proven") || left.index - right.index);
  const build = (retained) => {
    const keep = new Set(priority.slice(0, retained).map(({ index }) => index));
    const kept = rows.filter((_row, index) => keep.has(index));
    const omitted = rows.filter((_row, index) => !keep.has(index));
    const { proofs, reasons } = materializeRows(kept);
    const recovery = evidence.recovery === undefined ? undefined : summaryRecovery(evidence.recovery);
    return Object.freeze(decorate({
      subject: structuredClone(evidence.subject),
      subject_binding: structuredClone(evidence.subject_binding),
      status: evidence.status,
      ...(evidence.requested_environment == null ? {}
        : { requested_environment: evidence.requested_environment }),
      ...(evidence.authority_limb === undefined ? {} : { authority_limb: evidence.authority_limb }),
      ...(evidence.reason_code === undefined ? {} : { reason_code: evidence.reason_code }),
      ...(recovery === undefined ? {} : { recovery }),
      counts,
      proofs,
      proofs_returned: proofs.length,
      proofs_omitted: omitted.length,
      proofs_omitted_by_status: statusCounts(omitted),
      reasons,
      ...aggregateFacts,
      diagnostic_redaction_count: Array.isArray(evidence.diagnostic_redactions)
        ? evidence.diagnostic_redactions.length : 0,
      result_digest: evidence.result_digest
    }));
  };
  const complete = build(rows.length);
  if (fits(complete)) return complete;
  let low = 0;
  let high = rows.length - 1;
  let best = build(0);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const attempt = build(middle);
    if (fits(attempt)) { best = attempt; low = middle + 1; } else high = middle - 1;
  }
  return best;
}

export function projectVerifyProofSummary(evidence, { evidenceReference, fits = () => true }) {
  if (!isVerifyProofEvidenceReference(evidenceReference) ||
      evidenceReference.item_identity !== evidence.result_digest) {
    throw new TypeError("verify-proof summary requires the evidence reference of the same result");
  }
  return projectVerifyProofOutcomeCore(evidence, {
    fits,
    decorate: (core) => ({
      schema_version: VERIFY_PROOF_SUMMARY_SCHEMA_VERSION,
      ...core,
      evidence: structuredClone(evidenceReference),
      evidence_retrieval: verifyProofEvidenceRetrieval(evidenceReference)
    })
  });
}

export function projectRetainedVerifyProofOutcomeSummary(evidence) {
  return projectVerifyProofOutcomeCore(evidence, {
    fits: (candidate) => retainedOutcomeSummaryBytes(candidate) <=
      RETAINED_OUTCOME_SUMMARY_BYTE_BUDGET,
    decorate: (core) => ({ schema_version: VERIFY_PROOF_OUTCOME_SUMMARY_SCHEMA_VERSION, ...core })
  });
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  return value;
}

export function retainedOutcomeSummaryBytes(summary) {
  return Buffer.byteLength(JSON.stringify(canonicalValue(summary)), "utf8");
}
