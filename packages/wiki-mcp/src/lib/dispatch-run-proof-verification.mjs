

import { activeMcpInlineByteLimit, measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { selectedResponseDeliveryBound } from "./selected-response-snapshot.mjs";
import { AGENT_RUN_STATUS_SCHEMA_VERSION } from "./dispatch-tool-constants.mjs";
import { VERIFY_PROOF_OUTCOME_SUMMARY_SCHEMA_VERSION, projectVerifyProofOutcomeCore, selectableSubject }
  from "./verify-proof-result-summary.mjs";
import { buildNextCall } from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import { projectVerifyProofSelectedDetail } from "./verify-proof-result-detail.mjs";
import { buildDispatchContinuation, DISPATCH_FAILURE_ORIGINALS, projectRecordedFailureDetail }
  from "./dispatch-tool-helpers.mjs";
import { captureDiagnosticEvidence } from
  "../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs";
import { readVerifyProofRunRecord } from "./verify-proof-run-record-reader.mjs";
import { recordedProofVerificationOutcomeSummary } from
  "../../../agent-launch-core/src/lib/managed-run-observation.mjs";

export const RUN_PROOF_VERIFICATION_OBSERVATION_SCHEMA_VERSION = "run-proof-verification-observation.v1";
export const RUN_PROOF_VERIFICATION_DETAIL_KIND = "proof_verification";
export const RUN_PROOF_VERIFICATION_SELECTION_UNKNOWN_CODE = "proof_verification_selection_unknown";
const ROUTE = "workspace_agent_run_status";

const SELECTION_CHOICE_LIMIT = 50;
const VERIFY_PROOF_REFUSAL_SCHEMA = "workspace-verify-proof-refusal.v1";
const VERIFY_PROOF_TOOL = "workspace_verify_proof";

export function verifyProofSourceAmbiguityChoices(refusal) {
  if (refusal?.schema_version !== VERIFY_PROOF_REFUSAL_SCHEMA ||
      !["verify_proof.subject_ambiguous.v1", "verify_proof.source_tuple_ambiguous.v1"]
        .includes(refusal.reason_code) ||
      refusal.recovery?.action !== "select_source" ||
      !Array.isArray(refusal.recovery.choices) || refusal.recovery.choices.length === 0 ||
      refusal.recovery.choice_count !== refusal.recovery.choices.length) return null;
  const subject = refusal.subject?.requested;
  if (typeof subject !== "string" || subject.length === 0) return null;
  const choices = refusal.recovery.choices;
  if (choices.some((choice) => choice?.tool !== VERIFY_PROOF_TOOL ||
      choice.arguments?.subject !== subject || choice.arguments?.source?.unit === undefined)) return null;
  return choices;
}

export function selectedVerifyProofSourceChoice(refusal, source) {
  const choices = verifyProofSourceAmbiguityChoices(refusal);
  if (choices === null) return null;
  const canonical = { unit: source.unit, ...(source.focus === undefined ? {} : { focus: source.focus }) };
  return choices.find((choice) => JSON.stringify(choice.arguments.source) === JSON.stringify(canonical)) ?? null;
}

export function projectPublicVerifyProofRefusal(refusal, { readCall = null, selectedSource = null,
  fits = null, retentionFailed = false } = {}) {
  if (refusal === null || typeof refusal !== "object" || !Array.isArray(refusal.diagnostics)) return refusal;
  const publicRefusal = {
    ...refusal,
    diagnostics: Object.freeze(refusal.diagnostics.map((node) => {
      if (node === null || typeof node !== "object" || node.details === null ||
          typeof node.details !== "object" || !Object.hasOwn(node.details, "evidence")) return node;
      const { evidence: _capture, ...details } = node.details;
      return Object.freeze({ ...node, details: Object.freeze(details) });
    }))
  };
  const choices = verifyProofSourceAmbiguityChoices(refusal);
  if (choices === null) return Object.freeze(publicRefusal);
  if (selectedSource !== null && selectedVerifyProofSourceChoice(refusal, selectedSource) === null) {
    throw new TypeError("selected source is not in the retained ambiguity");
  }
  const { choices: _originalChoices, ...recovery } = publicRefusal.recovery;
  const selection = (shown, selected = null) => Object.freeze({
    ...publicRefusal,
    recovery: Object.freeze(recovery),
    source_selection: Object.freeze({ choice_count: choices.length,
      returned_count: shown.length, not_shown_count: choices.length - shown.length,
      ...(selected === null ? {} : { selected_source: selected }),
      choices: shown.map((choice) => Object.freeze({ ...choice.arguments.source })) }),
    next_calls: selected === null
      ? shown.map((choice) => readCall(choice.arguments.source))
      : [buildNextCall({ ...selectedVerifyProofSourceChoice(refusal, selected), recommended: false })]
  });
  if (selectedSource !== null) {
    const candidate = selection([selectedVerifyProofSourceChoice(refusal, selectedSource)], selectedSource);
    if (typeof fits !== "function" || !fits(candidate)) {
      throw new RangeError("selected source execution call exceeds the selected response bound");
    }
    return candidate;
  }
  if (retentionFailed) return selection([]);
  if (typeof readCall !== "function" || typeof fits !== "function") {
    throw new TypeError("source ambiguity public projection requires a bounded read context");
  }
  for (let count = Math.min(3, choices.length); count >= 1; count -= 1) {
    const candidate = selection(choices.slice(0, count));
    if (fits(candidate)) return candidate;
  }
  throw new RangeError("one complete source inspection call exceeds the selected response bound");
}

function detailCall(subject, attemptId, detail, { recommended = true } = {}) {
  return buildDispatchContinuation({
    recommended,
    tool: ROUTE,
    arguments: { subject, ...(attemptId === null ? {} : { attempt_id: attemptId }), detail },
    successPredicate: { fact: "monitor.proof_verification_detail_read", operator: "is_true" }
  });
}

function projectLastRecordedInvocation({ subject, attemptId, item, selectedInvocationId = null }) {
  if (item === null || typeof item !== "object") return null;
  const selected = selectedInvocationId !== null;
  const { outcome_summary: _recordedSummary, ...facts } = item;
  return Object.freeze({
    ...(selected ? facts : item),
    observation: "last_recorded_invocation",
    ...(selected && item.invocation_id === selectedInvocationId ? {} : {
      detail_call: detailCall(subject, attemptId,
        { kind: RUN_PROOF_VERIFICATION_DETAIL_KIND, invocation_id: item.invocation_id })
    })
  });
}

export async function observeRunProofVerification({ dispatchBackend, callerSessionId, status }) {
  const base = { schema_version: RUN_PROOF_VERIFICATION_OBSERVATION_SCHEMA_VERSION, grants_authority: false };
  if (typeof dispatchBackend?.readManagedRunObservation !== "function") {
    return Object.freeze({ ...base, state: "unavailable", code: "run_detail_backend_unavailable" });
  }
  let page;
  try {
    page = await dispatchBackend.readManagedRunObservation({
      caller_session_id: callerSessionId,
      subject: status.subject,
      attemptId: status.run_id,
      detail: { kind: RUN_PROOF_VERIFICATION_DETAIL_KIND, limit: 1 }
    });
  } catch (error) {
    page = { ok: false, code: typeof error?.code === "string" ? error.code : "run_detail_unavailable",
      observation_failure: error };
  }
  if (page?.ok !== true) {
    const failure = Object.hasOwn(page ?? {}, "observation_failure")
      ? page.observation_failure : page;

    return Object.freeze({ ...base, state: "unavailable",
      code: page?.code ?? page?.refusal?.code ?? "run_detail_unavailable",
      diagnostic: Object.freeze(projectRecordedFailureDetail({
        operation: "read_managed_run_proof_verification_observation",
        stage: "attempt_journal_observation",
        subject: status.subject,
        attempt_id: status.run_id,

        ...(failure !== null && typeof failure === "object" && !(failure instanceof Error)
          ? { failure } : {}),
        evidence: captureDiagnosticEvidence(failure)
      }, { original: DISPATCH_FAILURE_ORIGINALS.READ_OBSERVATION })) });
  }
  const recorded = page.summary.recorded_count;
  const attemptId = page.attempt_id ?? status.run_id;
  return Object.freeze({
    ...base,
    state: recorded === 0 ? "none_recorded" : "recorded",
    ...(recorded === 0 ? { meaning: "no explicit verification is recorded for this attempt; this is not a pass" } : {}),
    recorded_count: recorded,
    outcome_counts: page.summary.outcome_counts,
    status_counts: page.summary.status_counts,
    last_recorded_invocation: projectLastRecordedInvocation({
      subject: status.subject,
      attemptId,
      item: page.summary.last_recorded_invocation
    }),
    snapshot: page.snapshot,
    detail_call: detailCall(status.subject, attemptId,
      { kind: RUN_PROOF_VERIFICATION_DETAIL_KIND })
  });
}

function projectListedItem({ subject, attemptId, item }) {
  const { verification } = item;
  return Object.freeze({
    invocation_id: item.invocation_id,
    sequence: item.sequence,
    event_digest: item.digest,
    outcome: verification.outcome,
    status: verification.status,
    reason_code: verification.reason_code,
    result_digest: verification.result_digest,
    record_identity: verification.record_identity,
    counts: verification.counts,
    request: verification.request,
    caller: verification.caller,
    tested_source: verification.tested_source,
    coverage_scope: verification.coverage_scope,
    grants_authority: false,
    detail_call: detailCall(subject, attemptId,
      { kind: RUN_PROOF_VERIFICATION_DETAIL_KIND, invocation_id: item.invocation_id })
  });
}

function selectionUnknown({ subject, attemptId, invocationId, proofSubject, record }) {
  const proofs = record.proof_results ?? [];
  const choices = [...new Set([
    ...proofs.map(({ test_proof_id: id }) => id),
    ...proofs.flatMap((proof) => (proof.relationship_results ?? []).map(({ obligation_id: id }) => id))
  ])].sort();
  return Object.assign(new Error("recorded verification holds no proof or obligation by that identity"), {
    code: RUN_PROOF_VERIFICATION_SELECTION_UNKNOWN_CODE, details: {
      subject, attempt_id: attemptId, invocation_id: invocationId, proof_subject: proofSubject,
      choices: choices.slice(0, SELECTION_CHOICE_LIMIT),
      choice_count: choices.length
    } });
}

export function projectRunProofVerificationDetail({ subject, detail, workspaceDir, proofSubject = null,
  source = null, responseEnv = process.env }) {
  const attemptId = detail.attempt_id ?? null;
  const items = detail.items.map((item) => projectListedItem({ subject, attemptId, item }));
  const projected = { ...detail, items, grants_authority: false };
  if (detail.invocation_id === undefined) return Object.freeze(projected);
  const [item] = detail.items;

  const recorded = recordedProofVerificationOutcomeSummary(item.verification);
  if (!recorded.ok) {
    throw Object.assign(new Error("recorded verification is not a current record"), {
      code: recorded.code, details: {
        authority_limb: "mechanical_failure",
        operation: "project_run_proof_verification_detail",
        stage: "current_record_validation",
        subject,
        attempt_id: attemptId,
        invocation_id: detail.invocation_id,
        field: recorded.field,
        reason: recorded.reason
      } });
  }
  const { kind, record } = readVerifyProofRunRecord({ workspaceDir, verification: item.verification });
  if (detail.summary !== undefined) {
    projected.summary = Object.freeze({ ...detail.summary,
      last_recorded_invocation: projectLastRecordedInvocation({ subject, attemptId,
        item: detail.summary.last_recorded_invocation, selectedInvocationId: detail.invocation_id }) });
  }

  if (kind === "refusal") {
    const choices = verifyProofSourceAmbiguityChoices(record);
    if (source !== null && (choices === null ||
        selectedVerifyProofSourceChoice(record, source) === null)) {
      throw Object.assign(new Error("source is not an exact choice of this recorded ambiguity"), {
        code: RUN_PROOF_VERIFICATION_SELECTION_UNKNOWN_CODE,
        details: { subject, attempt_id: attemptId, invocation_id: detail.invocation_id,
          reason: "source_not_in_result" }
      });
    }
    if (choices === null) {
      return Object.freeze({ ...projected, refusal: projectPublicVerifyProofRefusal(record) });
    }
    const readCall = (choice) => detailCall(subject, attemptId, {
      kind: RUN_PROOF_VERIFICATION_DETAIL_KIND, invocation_id: detail.invocation_id,
      source: choice
    }, { recommended: false });
    const fit = (candidate) => {
      const { next_calls: nextCalls, ...refusal } = candidate;
      return measureMcpInlineResultBytes({
        schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION, accepted: true, subject,
        attempt_id: projected.attempt_id ?? null,
        detail: { ...projected, refusal }, next_calls: nextCalls
      }) <= selectedResponseDeliveryBound(responseEnv);
    };
    const { next_calls: nextCalls, ...refusal } = projectPublicVerifyProofRefusal(record, {
      readCall, selectedSource: source, fits: fit });
    return Object.freeze({ ...projected, refusal, next_calls: nextCalls });
  }
  if (source !== null) {
    throw Object.assign(new Error("source selection requires a retained source ambiguity"), {
      code: RUN_PROOF_VERIFICATION_SELECTION_UNKNOWN_CODE,
      details: { subject, attempt_id: attemptId, invocation_id: detail.invocation_id,
        reason: "source_selection_not_available" }
    });
  }
  const selectCall = (proof, options) => detailCall(subject, attemptId, {
    kind: RUN_PROOF_VERIFICATION_DETAIL_KIND, invocation_id: detail.invocation_id, proof_subject: proof
  }, options);
  const inlineByteLimit = activeMcpInlineByteLimit(responseEnv);
  if (proofSubject !== null) {

    const answerBytes = (candidate) => measureMcpInlineResultBytes({
      schema_version: AGENT_RUN_STATUS_SCHEMA_VERSION, accepted: true, subject,
      attempt_id: projected.attempt_id ?? null, detail: { ...projected, selected_detail: candidate } });
    const bound = selectedResponseDeliveryBound(responseEnv);
    const selected = projectVerifyProofSelectedDetail(record, proofSubject, {
      fits: (candidate) => answerBytes(candidate) <= bound });
    if (selected === null) {
      throw selectionUnknown({ subject, attemptId, invocationId: detail.invocation_id, proofSubject, record });
    }
    return Object.freeze({ ...projected, selected_detail: selected });
  }

  const outcomeSummary = projectVerifyProofOutcomeCore(record, {
    fits: (candidate) => measureMcpInlineResultBytes(candidate) <= inlineByteLimit,
    decorate: (core, kept) => ({ schema_version: VERIFY_PROOF_OUTCOME_SUMMARY_SCHEMA_VERSION, ...core,
      next_calls: kept.filter((row) => row.status !== "proven").map(selectableSubject)
        .filter((proof) => proof !== null)
        .map((proof, index) => selectCall(proof, { recommended: index === 0 })) })
  });
  return Object.freeze({ ...projected, outcome_summary: outcomeSummary });
}

export const COMPACT_PROOF_ROWS_BYTE_BUDGET = 384;

const COMPACT_INVOCATION_FACTS = Object.freeze([
  "invocation_id", "sequence", "outcome", "status", "reason_code", "result_digest",
  "coverage_scope"
]);
const COMPACT_PROOF_ROW_FACTS = Object.freeze([
  "status", "execution_status", "selected_status", "capability_limitations", "reason"
]);
const COMPACT_TESTED_SOURCE_FACTS = Object.freeze(["source_snapshot_digest"]);

const COMPACT_PROOF_COUNT_FACTS = Object.freeze(["total", "proven", "unproven", "not_executable"]);

function pickFacts(value, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(value ?? {}, field))
    .map((field) => [field, value[field]]));
}

function compactOutcome(summary) {
  if (summary === null || typeof summary !== "object") return undefined;
  const rows = [];
  let bytes = 0;
  for (const row of summary.proofs ?? []) {
    const compact = pickFacts(row, COMPACT_PROOF_ROW_FACTS);
    const size = Buffer.byteLength(JSON.stringify(compact), "utf8");
    if (rows.length > 0 && bytes + size > COMPACT_PROOF_ROWS_BYTE_BUDGET) break;
    rows.push(compact);
    bytes += size;
  }
  const carried = summary.proofs?.length ?? 0;
  const referenced = new Set(rows.map((row) => row.reason).filter(Boolean));
  return Object.freeze({
    ...(summary.counts?.proofs === undefined ? {} : {
      proof_counts: pickFacts(summary.counts.proofs, COMPACT_PROOF_COUNT_FACTS) }),
    proofs: rows,
    proofs_returned: rows.length,
    proofs_omitted: (Number.isInteger(summary.proofs_omitted) ? summary.proofs_omitted : 0) +
      carried - rows.length,

    reasons: Object.fromEntries(Object.entries(summary.reasons ?? {})
      .filter(([key]) => referenced.has(key))
      .map(([key, reason]) => [key, pickFacts(reason, ["reason_code", ...(reason.diagnostic_count > 0
        ? ["diagnostic_count", "diagnostic_codes", "diagnostic_codes_omitted"] : [])])])),
    ...(summary.diagnostic_count > 0
      ? pickFacts(summary, ["diagnostic_count", "diagnostic_codes", "diagnostic_codes_omitted"]) : {})
  });
}

export function projectCompactRunProofVerification(observation) {
  const latest = observation?.last_recorded_invocation;
  if (latest === null || typeof latest !== "object") return observation;
  const outcome = compactOutcome(latest.outcome_summary);

  const { snapshot: _snapshot, ...facts } = observation;
  return Object.freeze({
    ...facts,
    last_recorded_invocation: Object.freeze({
      ...Object.fromEntries(Object.entries(pickFacts(latest, COMPACT_INVOCATION_FACTS))
        .filter(([, value]) => value !== null)),
      ...(latest.tested_source === null || typeof latest.tested_source !== "object" ? {} : {
        tested_source: pickFacts(latest.tested_source, COMPACT_TESTED_SOURCE_FACTS)
      }),
      ...(outcome === undefined ? {} : { outcome })
    })
  });
}
