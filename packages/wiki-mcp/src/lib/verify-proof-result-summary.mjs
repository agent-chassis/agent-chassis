const STABLE_CODE_RE = /^[a-z0-9_.-]{1,160}$/u;
import { VERIFY_PROOF_SUMMARY_SCHEMA_VERSION } from "./mcp-response.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { publicProofSelectedRow } from "./verify-proof-agent-meaning.mjs";
import { PUBLIC_PROOF_STATUS_VALUES, isVerifyProofPopulationSubject, projectProofEvidencePresentation,
  projectVerifyProofRegressions, projectVerifyProofSelectedDetail, projectProofTraversal,
  projectProofCheckLimitations, selectVerifyProofRows } from
  "./verify-proof-result-detail.mjs";
const SUMMARY_DIAGNOSTIC_CODE_LIMIT = 8;

export const RETAINED_OUTCOME_SUMMARY_BYTE_BUDGET = 4096;
export const VERIFY_PROOF_OUTCOME_SUMMARY_SCHEMA_VERSION = "workspace-verify-proof-outcome-summary.v1";
const SUMMARY_OPT_OUT_ID_LIMIT = 16;

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
  const { repair: rawRepair, subject, follow_up_call: call, acquisition,
    recovery_call: _recoveryCall, authoring_source: _authoringSource, ...rest } = structuredClone(recovery);
  const repair = summaryRepair(rawRepair);
  const ownSubject = proof !== null && subject?.test_proof_id === proof.test_proof_id &&
    subject?.verification_id === proof.verification_id;
  return {
    ...rest,
    ...(acquisition === undefined ? {} : { acquisition: {
      code: acquisition.code, state: acquisition.state,
      missing_capability: acquisition.missing_capability,
      source: { unit: acquisition.source.unit,
        ...(acquisition.source.focus_status === 'unknown' ? { focus_status: 'unknown' }
          : { focus: acquisition.source.focus }) },
      obligation_ids: acquisition.obligation_ids, reason: acquisition.reason,
      correction_boundary: acquisition.correction_boundary,
      ...(acquisition.cause === undefined ? {} : { cause: acquisition.cause }) } }),
    ...(subject === undefined || ownSubject ? {} : { subject }),
    ...(call === undefined ? {} : { follow_up_call: {
      tool: call.tool,
      arguments: Object.fromEntries(Object.entries(call.arguments ?? {}).map(([key, value]) =>
        [key, proof !== null && value === proof.test_proof_id ? { from_row: "test_proof_id" } : value]))
    } }),
    ...(repair === undefined ? {} : { repair })
  };
}

export function publicSelectedDetail(detail) {
  if (detail === null) return null;
  const candidate = detail.subject_binding?.candidate_identity;
  return {
    subject: { requested: detail.subject.requested }, selected_subject: detail.selected_subject,
    status: detail.result_status,
    ...(candidate?.commit === undefined ? {} : { subject_binding: { candidate_identity: {
      commit: candidate.commit,
      ...(candidate.resolved_branch === undefined ? {} : { resolved_branch: {
        selector: candidate.resolved_branch.selector, branch: candidate.resolved_branch.branch,
        commit: candidate.resolved_branch.commit } }) } } }),
    proofs: detail.proofs.map(publicProofSelectedRow),
    ...(detail.regressions === undefined ? {} : { regressions: detail.regressions })
  };
}

export function authoringCorrectionCalls(evidence) {
  const supplied = [evidence.recovery,
    ...evidence.proof_results.map((proof) => proof.recovery)]
    .map((recovery) => recovery?.recovery_call)
    .filter((call) => call !== undefined);
  const seen = new Set();
  return supplied.filter((call) => {
    const key = JSON.stringify(call);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((call, index) => buildNextCall({ ...call, recommended: index === 0 }));
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
    ...(typeof selected.node_id === "string" ? { node_id: selected.node_id } : {}),
    ...(Number.isSafeInteger(selected.nesting) ? { nesting: selected.nesting } : {})
  };
}

function summaryTiming(timing) {
  if (timing === null || typeof timing !== "object") return undefined;
  return {
    state: timing.state,
    ...(timing.execution_index === undefined ? {} : { execution_index: timing.execution_index }),
    ...(timing.elapsed_ms === undefined ? {} : { elapsed_ms: timing.elapsed_ms })
  };
}

export function projectVerifyProofSummaryRow(proof, { complete = false } = {}) {
  const limitations = summaryLimitations(proof);
  const presentation = projectProofEvidencePresentation(proof);
  const mutation = summaryMutation(presentation.mutation_evidence);
  const decidingMutation = mutation === undefined || complete ? mutation
    : mutation.survived || mutation.unevaluable ? Object.fromEntries(Object.entries(mutation)
      .filter(([key]) => key !== "detected")) : undefined;
  const selectedTest = summarySelectedTest(proof.selected_test);
  const timing = summaryTiming(proof.timing);
  const traversal = projectProofTraversal(proof, { complete, problemsOnly: !complete });
  return {
    test_proof_id: proof.test_proof_id,
    verification_id: proof.verification_id,
    status: proof.status,
    readiness_status: proof.readiness_status,
    execution_status: proof.execution_status,
    ...(selectedTest === undefined ? {} : { selected_test: selectedTest }),

    selected_status: presentation.test_observation.status,
    ...(decidingMutation === undefined ? {} : { mutation_evidence: decidingMutation }),
    ...(typeof proof.declared_target?.target === "string"
      ? { declared_target: proof.declared_target.target } : {}),

    ...(typeof proof.runtime_environment?.environment === "string"
      ? { environment: proof.runtime_environment.environment } : {}),
    ...(limitations === undefined || !complete ? {} : { capability_limitations: limitations }),
    ...(timing === undefined ? {} : { timing }),
    ...(traversal === undefined ? {} : { traversal }),
    reason: proofReason(proof),
    obligations: (proof.relationship_results ?? []).filter(row => complete || row.status !== "proven")
      .map((relationship) => ({
      obligation_id: relationship.obligation_id,
      status: relationship.status,
      reason: relationshipReason(relationship)
    }))
  };
}

const COVERAGE_LIMIT = "verify_proof.behavioral_coverage_not_established.v1";

export function isRoutineVerifyProofSuccess(proof) {
  const presentation = projectProofEvidencePresentation(proof);
  if (proof.execution_status !== "completed" || presentation.test_observation.status !== "passed" ||
      presentation.mutation_evidence.survived_count > 0 ||
      presentation.mutation_evidence.unevaluable_count > 0) return false;
  if (proof.status === "proven") return true;
  return proof.status === "unproven" && proof.reason_code === COVERAGE_LIMIT &&
    proof.relationship_results.length > 0 && proof.relationship_results.every(row =>
      row.status === "proven" || row.status === "unproven" && row.reason_code === COVERAGE_LIMIT);
}

function aggregateExecutionMeaning(evidence) {
  const execution = { proofs: {}, selected_observations: {} };
  const limitations = new Map();
  for (const proof of evidence.proof_results) {
    const status = proof.execution_status;
    execution.proofs[status] = (execution.proofs[status] ?? 0) + 1;
    const selected = projectProofEvidencePresentation(proof).test_observation.status;
    execution.selected_observations[selected] = (execution.selected_observations[selected] ?? 0) + 1;
    const meanings = projectProofCheckLimitations(proof).map(limitation => ({
      reason_code: limitation.reason_code, check_kind: limitation.check_kind,
      ...(limitation.detail?.reason === undefined ? {} : { reason: limitation.detail.reason }),
      ...(limitation.explanation === undefined ? {} : { explanation: limitation.explanation }),
      next_step: limitation.next_step
    }));
    if (proof.reason_code === COVERAGE_LIMIT || proof.relationship_results.some(row => row.reason_code === COVERAGE_LIMIT)) {
      meanings.push({ reason_code: COVERAGE_LIMIT,
        effect: "No requirement-satisfaction credit from execution validity alone.",
        next_step: "Report this evidence limit; an unchanged-input retry is not indicated." });
    }
    for (const key of new Set(meanings.map(meaning => JSON.stringify(meaning)))) {
      const group = limitations.get(key) ?? { ...JSON.parse(key), proof_count: 0 };
      group.proof_count++;
      limitations.set(key, group);
    }
  }
  return { execution, ...(limitations.size === 0 ? {} : { limitations: [...limitations.values()] }) };
}

function statusCounts(rows) {
  return Object.fromEntries(PUBLIC_PROOF_STATUS_VALUES.map((status) =>
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

export function projectVerifyProofOutcomeCore(evidence, { fits = () => true,
  decorate = (summary) => summary, invocationTiming = true, population = false } = {}) {
  const relevant = evidence.proof_results.filter(proof => population || !isRoutineVerifyProofSuccess(proof));
  const rows = relevant.map(proof => projectVerifyProofSummaryRow(proof, { complete: population }));
  const summarized = evidence.proof_results.length - relevant.length;
  const executionMeaning = aggregateExecutionMeaning(evidence);
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

  const optOuts = evidence.proof_opt_outs === undefined ? undefined : (({ obligation_ids: ids, ...facts }) => ({
    ...facts, count: ids.length, obligation_ids: ids.slice(0, SUMMARY_OPT_OUT_ID_LIMIT),
    obligation_ids_omitted: Math.max(0, ids.length - SUMMARY_OPT_OUT_ID_LIMIT) }))(evidence.proof_opt_outs);

  const regressions = projectVerifyProofRegressions(evidence, { complete: true, problemsOnly: !population });
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
      ...executionMeaning,
      ...(optOuts === undefined ? {} : { proof_opt_outs: optOuts }),
      ...(regressions === undefined ? {} : { regressions }),
      proofs,
      proofs_returned: proofs.length,
      proofs_summarized: summarized,
      proofs_omitted: omitted.length,
      proofs_omitted_by_status: statusCounts(omitted),
      reasons,
      ...aggregateFacts,
      diagnostic_redaction_count: Array.isArray(evidence.diagnostic_redactions)
        ? evidence.diagnostic_redactions.length : 0,

      ...(evidence.timing === undefined || !invocationTiming ? {}
        : { timing: structuredClone(evidence.timing) }),
      result_digest: evidence.result_digest
    }, kept));
  };
  return population ? build(rows.length) : fitWholePrefix(rows.length, build, fits);
}

export function fitWholePrefix(total, build, fits) {
  const complete = build(total);
  if (fits(complete)) return complete;
  let low = 0;
  let high = total - 1;
  let best = build(0);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const attempt = build(middle);
    if (fits(attempt)) { best = attempt; low = middle + 1; } else high = middle - 1;
  }
  return best;
}

export function selectableSubject(row) {
  if (typeof row.test_proof_id === "string" && row.test_proof_id.length > 0) return row.test_proof_id;
  const obligation = (row.obligations ?? []).find(({ obligation_id: id }) => typeof id === "string");
  return obligation?.obligation_id ?? null;
}

function selectedFailureDetail(evidence, subject, admission) {
  if (subject === null || isVerifyProofPopulationSubject(subject) ||
      !selectVerifyProofRows(evidence, subject).some(proof => !isRoutineVerifyProofSuccess(proof))) return null;
  return publicSelectedDetail(projectVerifyProofSelectedDetail(evidence, subject, {
    fits: (detail) => admission.fits(publicSelectedDetail(detail))
  }));
}

export function projectVerifyProofSummary(evidence, { fits = () => true, selectedFits = fits,
  detailCall = null, selectedSubject = null, population = false } = {}) {
  const correctionCalls = authoringCorrectionCalls(evidence);
  const decorate = (selectedDetail) => (core, kept) => {

    const readCalls = detailCall === null || population ? [] : kept.filter((row) => !isRoutineVerifyProofSuccess(
      evidence.proof_results.find(proof => proof.test_proof_id === row.test_proof_id)))
      .map(selectableSubject).filter((subject) => subject !== null)
      .map((subject, index) => detailCall(subject, {
        recommended: correctionCalls.length === 0 && index === 0
      }));
    if (!population && selectedDetail !== null && readCalls.length === 0 && detailCall !== null) {
      readCalls.push(detailCall(selectedSubject, { recommended: correctionCalls.length === 0 }));
    }
    if (!population && detailCall !== null &&
        (evidence.proof_results.length > 0 || evidence.regression_results?.results.length > 0) && !readCalls.some(call =>
      call.arguments.proof?.subject === evidence.subject.requested)) {
      readCalls.push({ ...detailCall(evidence.subject.requested, {
        population: true, recommended: core.proofs_omitted > 0 }),
        purpose: isVerifyProofPopulationSubject(evidence.subject.requested) ? "proof_population" : "proof_detail",
        information: "Optional complete selected outcomes and diagnosis." });
    }
    return {
      schema_version: VERIFY_PROOF_SUMMARY_SCHEMA_VERSION,
      ...core,
      ...(selectedDetail === null ? {} : { selected_detail: selectedDetail }),
      next_calls: [...correctionCalls, ...readCalls]
    };
  };

  const rowFree = (selectedDetail) => projectVerifyProofOutcomeCore(evidence, {
    population, fits: () => false, decorate: decorate(selectedDetail) });
  const selectedDetail = population ? { proofs: evidence.proof_results.flatMap(proof =>
    publicSelectedDetail(projectVerifyProofSelectedDetail(evidence, proof.test_proof_id,
      { completeDiagnosis: true })).proofs) } : selectedFailureDetail(evidence, selectedSubject, {
    fits: (detail) => selectedFits(rowFree(detail)) });
  return projectVerifyProofOutcomeCore(evidence, { population,
    fits: population ? () => true : selectedDetail === null ? fits : selectedFits,
    decorate: decorate(selectedDetail) });
}

export function projectRetainedVerifyProofOutcomeSummary(evidence) {
  return projectVerifyProofOutcomeCore(evidence, { invocationTiming: false,
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
