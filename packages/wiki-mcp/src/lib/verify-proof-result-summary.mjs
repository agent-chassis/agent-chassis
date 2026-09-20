const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;
const VERIFY_PROOF_TOOL_NAME = "workspace_verify_proof";
import { VERIFY_PROOF_SUMMARY_SCHEMA_VERSION, isVerifyProofEvidenceReference } from "./mcp-response.mjs";
import { projectProofEvidencePresentation } from
  "./verify-proof-result-detail.mjs";
const SUMMARY_DIAGNOSTIC_CODE_LIMIT = 8;
const SUMMARY_STATUSES = Object.freeze(["satisfied", "unsatisfied", "not_executable"]);

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

function summaryRecovery(recovery) {
  if (recovery === null || typeof recovery !== "object") return undefined;
  const repair = summaryRepair(recovery.repair);
  return {
    action: recovery.action,
    ...(recovery.recovery_call === undefined ? {} : {
      recovery_call: structuredClone(recovery.recovery_call)
    }),
    retry_operation: recovery.retry_operation ?? VERIFY_PROOF_TOOL_NAME,
    ...(repair === undefined ? {} : { repair })
  };
}

function proofReason(proof) {
  if (proof.status === "satisfied") return undefined;
  const recovery = summaryRecovery(proof.recovery);
  return { reason_code: proof.reason_code ?? null,
    ...(recovery === undefined ? {} : { recovery }) };
}

function relationshipReason(relationship) {
  if (relationship.status === "satisfied") return undefined;
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

function summaryRow(proof) {
  const selected = proof.observed_evidence?.selected_status;
  const limitations = summaryLimitations(proof);
  const presentation = projectProofEvidencePresentation(proof);
  return {
    test_proof_id: proof.test_proof_id,
    verification_id: proof.verification_id,
    status: proof.status,
    readiness_status: proof.readiness_status,
    execution_status: proof.execution_status,
    ...(presentation.mutation_evidence.status === "not_run" ? {}
      : { mutation_evidence: presentation.mutation_evidence.status }),
    ...(typeof proof.declared_target?.target === "string"
      ? { declared_target: proof.declared_target.target } : {}),
    ...((selected === "passed" || selected === "failed")
      ? { selected_status: selected } : {}),
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

function evidenceRetrieval(reference) {
  const { content_reference: contentReference } = reference;
  return Object.freeze({
    first_call: Object.freeze({
      tool: contentReference.read_tool,
      arguments: Object.freeze({ ref_id: contentReference.ref_id,
        offset: contentReference.range.offset, length: contentReference.range.length })
    }),
    reassembly: "repeat_with_offset_next_offset_until_eof_then_concatenate_data_base64_and_parse_utf8_json",
    expected: Object.freeze({ byte_count: contentReference.byte_count,
      sha256: contentReference.sha256,
      schema_version: reference.evidence_schema_version,
      result_digest: reference.item_identity })
  });
}

export function projectVerifyProofSummary(evidence, { evidenceReference, fits = () => true }) {
  if (!isVerifyProofEvidenceReference(evidenceReference) ||
      evidenceReference.item_identity !== evidence.result_digest) {
    throw new TypeError("verify-proof summary requires the evidence reference of the same result");
  }
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
    .sort((left, right) => Number(left.row.status === "satisfied") -
      Number(right.row.status === "satisfied") || left.index - right.index);
  const build = (retained) => {
    const keep = new Set(priority.slice(0, retained).map(({ index }) => index));
    const kept = rows.filter((_row, index) => keep.has(index));
    const omitted = rows.filter((_row, index) => !keep.has(index));
    const { proofs, reasons } = materializeRows(kept);
    return Object.freeze({
      schema_version: VERIFY_PROOF_SUMMARY_SCHEMA_VERSION,
      subject: structuredClone(evidence.subject),
      subject_binding: structuredClone(evidence.subject_binding),
      status: evidence.status,
      ...(evidence.authority_limb === undefined ? {} : { authority_limb: evidence.authority_limb }),
      ...(evidence.reason_code === undefined ? {} : { reason_code: evidence.reason_code }),
      ...(evidence.recovery === undefined ? {} : { recovery: structuredClone(evidence.recovery) }),
      counts,
      proofs,
      proofs_returned: proofs.length,
      proofs_omitted: omitted.length,
      proofs_omitted_by_status: statusCounts(omitted),
      reasons,
      ...aggregateFacts,
      diagnostic_redaction_count: Array.isArray(evidence.diagnostic_redactions)
        ? evidence.diagnostic_redactions.length : 0,
      result_digest: evidence.result_digest,
      evidence: structuredClone(evidenceReference),
      evidence_retrieval: evidenceRetrieval(evidenceReference)
    });
  };
  let candidate = build(rows.length);
  if (fits(candidate)) return candidate;
  let low = 0;
  let high = rows.length - 1;
  let best = build(0);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const attempt = build(middle);
    if (fits(attempt)) { best = attempt; low = middle + 1; } else high = middle - 1;
  }
  candidate = best;
  return candidate;
}
