

import { isDeepStrictEqual } from "node:util";
import { activeMcpInlineByteLimit, measureMcpInlineResultBytes } from "./mcp-response.mjs";
import { selectedResponseDeliveryBound } from "./selected-response-snapshot.mjs";
import { projectVerifyProofSelectedDetail, selectVerifyProofRows } from "./verify-proof-result-detail.mjs";
import { projectVerifyProofSummary } from "./verify-proof-result-summary.mjs";
import { projectPublicVerifyProofRefusal, selectedVerifyProofSourceChoice,
  verifyProofSourceAmbiguityChoices } from "./dispatch-run-proof-verification.mjs";

const RESULT_SUBJECT_CHOICE_LIMIT = 50;

export function requestedVerifyProofSource(args) {
  return args.source === undefined ? null : { unit: args.source.unit,
    ...(args.source.focus === undefined ? {} : { focus: args.source.focus }) };
}

export function verifyProofAnswerAdmission(responseEnv, decoration = {}) {
  const inlineByteLimit = activeMcpInlineByteLimit(responseEnv);
  const bound = selectedResponseDeliveryBound(responseEnv);
  const measure = (candidate) => measureMcpInlineResultBytes({ ...candidate, ...decoration });
  return { fits: (candidate) => measure(candidate) <= inlineByteLimit,
    selectedFits: (candidate) => measure(candidate) <= bound };
}

export function projectPublicVerifyProofSourceRefusal(refusal, { readCall = null, selectedSource = null,
  decoration = {}, responseEnv, retentionFailed = false, executionCall = null }) {
  return projectPublicVerifyProofRefusal(refusal, { readCall, selectedSource, retentionFailed, executionCall,
    fits: (candidate) => measureMcpInlineResultBytes({ ...candidate, ...decoration },
      { isError: true }) <= selectedResponseDeliveryBound(responseEnv) });
}

function resultSubjectChoices(evidence) {
  const proofs = evidence.proof_results ?? [];
  return [...new Set([...proofs.map(({ test_proof_id: id }) => id),
    ...proofs.flatMap((proof) => (proof.relationship_results ?? []).map(({ obligation_id: id }) => id))])]
    .sort();
}

export function readVerifyProofOriginal({ original, request, decoration, calls, refuse, responseEnv }) {
  const { kind, record } = original;
  const sourceChoices = kind === "refusal" ? verifyProofSourceAmbiguityChoices(record) : null;
  if (request.source !== null && sourceChoices === null &&
      !isDeepStrictEqual(request.source, original.source)) {
    throw refuse("source_binding_mismatch", { held: kind });
  }
  if (kind === "refusal") {
    if (request.subject !== original.subject) throw refuse("subject_not_in_result", { held: kind });
    if (sourceChoices !== null && request.source !== null &&
        selectedVerifyProofSourceChoice(record, request.source) === null) {
      throw refuse("source_not_in_result", { held: kind });
    }
    return { kind, envelope: { ...projectPublicVerifyProofSourceRefusal(record, { responseEnv, decoration,
      selectedSource: sourceChoices === null ? null : request.source, readCall: calls.source, executionCall: calls.execution }),
    ...decoration } };
  }
  const admission = verifyProofAnswerAdmission(responseEnv, decoration);
  if (request.subject === original.subject) {
    const summary = projectVerifyProofSummary(record, { ...admission, detailCall: calls.detail,
      selectedSubject: request.subject });
    return { kind: "answer", value: { ...summary, ...decoration } };
  }
  if (selectVerifyProofRows(record, request.subject).length === 0) {
    const choices = resultSubjectChoices(record);
    throw refuse("subject_not_in_result", { held: kind, selection: { result_digest: record.result_digest,
      choices: choices.slice(0, RESULT_SUBJECT_CHOICE_LIMIT), choice_count: choices.length } });
  }

  return { kind: "answer", value: { ...projectVerifyProofSelectedDetail(record, request.subject,
    { fits: admission.selectedFits }), ...decoration } };
}
