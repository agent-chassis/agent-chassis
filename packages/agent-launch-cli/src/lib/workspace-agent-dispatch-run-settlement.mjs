

import { settleAndProjectRunStatus, buildRunStatusEnvelope, attachAdvisoryReviewTarget } from "./workspace-agent-dispatch-run-lifecycle-settlement.mjs";
import { settleAndProjectAdvisoryProcess, projectAdvisoryProcess } from "./workspace-agent-advisory-result-settlement.mjs";
import { deriveBackendReviewResult } from "./workspace-agent-dispatch-review-result.mjs";
import { captureDiagnosticEvidence } from "./diagnostic-evidence.mjs";
import { resolveAdvisoryReviewMaterialKind } from './workspace-agent-advisory-review-contract.mjs';

const statusSettlementByRecord = new WeakMap();
const completionByRecord = new WeakMap();
const REVIEW_ORIGINAL_ROLES = new Set(["reviewer", "redteam"]);

export function subscribeRunCompletion(record, completion, dependencies) {
  if (completionByRecord.has(record)) return completionByRecord.get(record);
  let stage = "settlement";
  let capturePromise;
  const capture = () => capturePromise ??= (async () => {
    record.original_publication = { state: "pending" };
    const joined = statusSettlementByRecord.has(record);
    await settleAndProjectRunRecord(record, dependencies);
    if (joined && !record.terminal) {
      await settleAndProjectRunRecord(record, dependencies);
    }
    if (record.terminal && dependencies.captureRunOriginal !== null &&
        dependencies.captureRunOriginal !== undefined && record.original_result === undefined) {
      stage = "original_capture";
      record.original_result = await dependencies.captureRunOriginal(projectCapturedRunRecord(record));
    }

    const publishOriginal = record.role === "worker" ? dependencies.publishManagedRunOriginal
      : REVIEW_ORIGINAL_ROLES.has(record.role) ? dependencies.publishManagedReviewOriginal : null;
    if (record.original_result !== undefined && typeof publishOriginal === "function") {
      stage = "original_binding";
      const outcome = await publishOriginal(record.role === "worker" ? { subject: record.subject,
        dispatchTuple: record.managed_execution_tuple, result: record.final_result,
        originalResult: record.original_result }
        : { subject: record.subject, runId: record.run_id, role: record.role,
          originalResult: record.original_result });
      if (outcome?.ok !== true) throw Object.assign(new Error(outcome?.refusal?.reason ?? outcome?.code ??
        "retained original binding returned no outcome", { cause: outcome }), {
        code: outcome?.code ?? outcome?.refusal?.code });
      record.original_bound = true;
    }
    record.original_publication = { state: record.original_result !== undefined ? "captured"
      : record.terminal && dependencies.captureRunOriginal == null ? "not_configured" : "unavailable",
      ...(record.original_bound === true ? { bound: true } : {}) };
  })();
  const retainFailure = (error) => {
    record.completion_settlement_failure = captureDiagnosticEvidence(error);
    record.original_publication = { state: "failed", stage,
      owner: stage === "original_binding"
        ? record.role === "worker" ? "publishManagedRunOriginal" : "publishManagedReviewOriginal"
        : stage === "original_capture" ? "captureRunOriginal" : "settleAndProjectRunRecord",
      failure: record.completion_settlement_failure };
  };
  try {
    const pending = completion.then(capture, (error) => {
      record.completion_failure = captureDiagnosticEvidence(error);
      return capture();
    }).catch(retainFailure);
    completionByRecord.set(record, pending);
    return pending;
  } catch (error) {
    retainFailure(error);
    const failed = Promise.resolve();
    completionByRecord.set(record, failed);
    return failed;
  }
}

export function settleAndProjectRunRecord(record, {
  clock,
  captureSliceReviewTerminalResult,
  settleFormalReviewAttestation,
  publishManagedRunResult,
  assessManagedRunResult = null,
  readManagedRunCompletion = null,
  projectRunRecord = null
} = {}) {
  if (projectRunRecord !== null && record.producer_settlement_finished === true) {
    return Promise.resolve(projectRunRecord(record));
  }
  if (!statusSettlementByRecord.has(record)) {
    let settlement;
    settlement = (record.advisory_process === true
      ? settleAndProjectAdvisoryProcess(record, { clock, settleFormalReviewAttestation })
      : settleAndProjectRunStatus(record, {
          clock,
          captureSliceReviewTerminalResult,
          settleFormalReviewAttestation,
          publishManagedRunResult,
          assessManagedRunResult,
          readManagedRunCompletion
        })).finally(() => {
      if (statusSettlementByRecord.get(record) === settlement) {
        statusSettlementByRecord.delete(record);
      }
      if (projectRunRecord !== null && record.terminal) record.producer_settlement_finished = true;
    });
    statusSettlementByRecord.set(record, settlement);
  }
  return statusSettlementByRecord.get(record);
}

export function projectCapturedRunRecord(record) {
  const envelope = record.advisory_process === true
    ? projectAdvisoryProcess(record)
    : buildRunStatusEnvelope(record, deriveBackendReviewResult(record));
  const observation = attachAdvisoryReviewTarget(envelope, {
    ...envelope, producer_pending: statusSettlementByRecord.has(record) || record.original_publication?.state === "pending",
    ...(record.original_publication === undefined ? {} : { original_publication: record.original_publication }),
    ...(record.original_result === undefined ? {} : { original_result: record.original_result }),
    ...(record.completion_failure === undefined ? {} : { completion_failure: record.completion_failure }),
    ...(record.completion_settlement_failure === undefined ? {} : {
      completion_settlement_failure: record.completion_settlement_failure
    })
  });
  const input = record.advisory_review_input;
  if (REVIEW_ORIGINAL_ROLES.has(record.role) && input != null) {

    Object.defineProperty(observation, "review_task", { enumerable: false,
      value: Object.freeze({ brief: input.review_brief,
        base_sha: input.base_sha, reviewed_sha: input.reviewed_sha,
        material_kind: resolveAdvisoryReviewMaterialKind(input) }) });
  }
  return Object.freeze(observation);
}
