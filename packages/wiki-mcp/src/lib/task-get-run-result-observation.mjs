

import { realpathSync } from "node:fs";
import { createObservationOriginals } from "./task-get-run-result-delivery.mjs";
import path from "node:path";
import { z } from "zod";
import { readManagedRunObservation } from
  "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { classifyAgentDispatchSubject } from "./dispatch-tool-helpers.mjs";
import { RUN_WAIT_TIMEOUT_MS_BOUNDS } from "./dispatch-monitor-call-deadline.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { selectedResponseCorrectableError, selectedResponseRequestSchema } from "./selected-response-snapshot.mjs";
import { retainedRunSourceFailure } from './get-run-result-source-failure.mjs';
import { runResultMeaning } from './get-run-result-final-result.mjs';
import { managedObservationFailureFacts } from '../../../agent-launch-core/src/lib/managed-run-observation.mjs';
import { captureDiagnosticEvidence } from '../../../agent-launch-cli/src/lib/diagnostic-evidence.mjs';
import { distillDispatchFailureDetail } from './dispatch-tool-helpers.mjs';
import { authenticateManagedWorkerSliceBinding, managedTestAuthorityAuthenticated,
  managedTestAuthorityIdentity } from "./managed-test-source-context.mjs";

export const GET_RUN_RESULT_LIVE_INPUT_SCHEMA = z.object({ subject: z.string().refine((subject) =>
  classifyAgentDispatchSubject(subject) !== null), attempt_id: z.string().min(1).optional(),
  timeout_ms: z.number().int().min(RUN_WAIT_TIMEOUT_MS_BOUNDS.min)
    .max(RUN_WAIT_TIMEOUT_MS_BOUNDS.max).optional() }).strict();
export const GET_RUN_RESULT_INVENTORY_INPUT_SCHEMA = z.object({
  subject: GET_RUN_RESULT_LIVE_INPUT_SCHEMA.shape.subject, attempt_id: z.string().min(1),
  detail: z.object({ member: z.literal("proof_verifications") }).strict() }).strict();
export const GET_RUN_RESULT_ASSIGNED_INPUT_SCHEMA = z.object({ assigned: z.literal(true) }).strict();

const EXACT_READ_REQUEST_SCHEMA = selectedResponseRequestSchema(z.object({
  subject: z.string(), attempt_id: z.string().min(1) }).strict());
function waitRefusal(reason, subject, attemptId) {
  return selectedResponseCorrectableError("get_run_result", reason, {}, {
    arguments: { subject, attempt_id: attemptId }, requestSchema: EXACT_READ_REQUEST_SCHEMA,
    prerequisite: "a wait observes a live attempt whose reservation is still held; this attempt is read, not waited on",
    successCondition: "the same subject and attempt without timeout_ms returns that attempt's recorded " +
      "observation at once; it waits for nothing and starts, captures and integrates nothing" });
}

export function projectRunObservationFailure(record) {
  const { ok: _ok, observation_failure: error, ...facts } = managedObservationFailureFacts(record);
  if (facts.refusal != null) {
    const { schema_version: _schema, ...refusal } = facts.refusal;
    facts.refusal = refusal;
  }
  const cause = Object.hasOwn(record, 'observation_failure') ? captureDiagnosticEvidence(error) : facts;
  return { state: 'unavailable', operation: 'read_managed_run_observation',
    cause: distillDispatchFailureDetail(cause, { nested: true }).detail,
    limitation: 'This source could not establish recorded results or deliveries. Earlier effects stand. Stop work requiring this evidence; no correction is available here.' };
}

export function createGetRunResultObservation({ workspace, sessionEnv,
  preparedDispatchBackend, dispatchSessionIdentity, parseRequest, refuse, responseEnv }) {
  return async function observe(request, selection = null) {

    const assigned = request?.assigned !== undefined;
    const parsed = parseRequest(assigned ? GET_RUN_RESULT_ASSIGNED_INPUT_SCHEMA : GET_RUN_RESULT_LIVE_INPUT_SCHEMA, request,
      "read_names_exactly_one_observation");
    const state = resolveLauncherRunState(sessionEnv);
    if (state.role !== (assigned ? "worker" : "orchestrator") ||
        !managedTestAuthorityAuthenticated(managedTestAuthorityIdentity(state))) {
      return refuse("session_not_authenticated_observer", { role: state.role ?? null });
    }
    if (assigned) {
      const subject = state.assignedUnit;
      if (classifyAgentDispatchSubject(subject) !== "work_record_slice") {
        return refuse("assigned_slice_required");
      }
      const mainRepo = realpathSync(path.resolve(workspace.dir));
      const sliceBinding = authenticateManagedWorkerSliceBinding({ mainRepo, state,
        wkId: subject.split("#")[0] });
      return readManagedRunObservation({ mainRepo, subject, sliceBinding, includeVerifiedSource: true });
    }

    const backend = preparedDispatchBackend;
    if (typeof backend?.getRunStatus !== "function" ||
        typeof backend?.waitForRunStatus !== "function" ||
        typeof dispatchSessionIdentity !== "string" || dispatchSessionIdentity.length === 0) {
      return refuse("prepared_observation_dependencies_missing");
    }
    const input = { caller_session_id: dispatchSessionIdentity, subject: parsed.subject };

    const live = await backend.getRunStatus({ ...input,
      ...(parsed.attempt_id === undefined ? {} : { run_id: parsed.attempt_id }) });
    const durable = async (attemptId) => {
      if (typeof backend.readManagedRunObservation !== "function") {
        return refuse("durable_observation_dependency_missing");
      }
      try { return await backend.readManagedRunObservation({ ...input, attemptId,
        ...(selection === null ? { includeProofSummary: true, includeReviewOriginal: true, includeVerifiedSource: true }
          : { detail: selection, includeVerifiedSource: true }) });
      } catch (error) {
        return { ok: false, code: error?.code, observation_failure: error };
      }
    };
    const withReceipts = (status, recorded) => {
      if (!recorded.ok) return { ...status, verified_source: recorded.verified_source,
        observation_detail: recorded, delivery: { state: 'unavailable' } };
      const receipts = recorded.selected.delivery_receipts;
      return { ...status, verified_source: recorded.verified_source,
        ...(recorded.selected.assignment_change === undefined ? {} : { assignment_change: recorded.selected.assignment_change }), proof_detail: recorded.proof_detail,
        delivery_receipts: receipts };
    };
    const taskCandidate = (candidate, original) => {
      const id = candidate.attempt_id;
      if (original.subject !== parsed.subject || original.run_id !== id || original.role !== candidate.role) {
        return refuse("observation_original_attempt_mismatch", { subject: parsed.subject, attempt_id: id });
      }
      const meaning = runResultMeaning(original.final_result);
      return { attempt_id: id, role: original.role, status: original.status, terminal: original.terminal,
        ...(meaning.unavailable ? { result_meaning: meaning.facts } : {}),
        ...(original.review_task === undefined ? {} : { review_task: original.review_task }),
        ...(original.worker_task === undefined ? {} : { worker_task: original.worker_task }) };
    };
    if (live?.accepted !== true) {
      if (live?.refusal?.reason === "attempt_selection_ambiguous" && Array.isArray(live.refusal.detail?.attempts)) {
        const attempts = [];
        for (const candidate of live.refusal.detail.attempts) {
          if (!["worker", "reviewer", "redteam"].includes(candidate.role)) { attempts.push(candidate); continue; }
          const exact = await backend.getRunStatus({ ...input, run_id: candidate.attempt_id });
          if (exact.accepted !== true) {
            attempts.push({ ...candidate, result_unavailable: projectRunObservationFailure(exact) });
            continue;
          }
          attempts.push(taskCandidate(candidate, exact));
        }
        return { ...live, refusal: { ...live.refusal, detail: { ...live.refusal.detail, attempts } } };
      }
      if (!["attempt_observation_unavailable", "unknown_run_or_handle"].includes(live?.refusal?.reason)) return live;
      const cold = await durable(parsed.attempt_id ?? null);
      if (!cold.ok && cold.code === "attempt_selection_ambiguous" &&
          (Array.isArray(cold.candidates) || Array.isArray(cold.attempts))) {
        const originals = createObservationOriginals({ workspace, sessionEnv, responseEnv });
        const candidates = [];
        let readable = 0, unavailable;
        for (const retainedCandidate of cold.candidates ?? cold.attempts) {
          const candidate = retainedCandidate.dispatch_tuple == null ? retainedCandidate : {
            attempt_id: retainedCandidate.dispatch_tuple.run_id, role: 'worker',
            original_result: retainedCandidate.original_result };
          if (candidate.original_result == null) { candidates.push(candidate); continue; }
          try {
            candidates.push(taskCandidate(candidate, originals.read(candidate.original_result, parsed.subject).carrier));
            readable += 1;
          } catch (error) {

            const cause = retainedRunSourceFailure(error);
            unavailable ??= error;
            candidates.push({ attempt_id: candidate.attempt_id, role: candidate.role, result_available: false,
              result_unavailable: cause });
          }
        }

        if (readable === 0 && unavailable !== undefined) throw unavailable;
        return { ...cold, candidates };
      }
      if (!cold.ok || selection !== null) return cold;

      const review = cold.review;
      if (parsed.timeout_ms !== undefined) {
        const selected = review?.run_id ?? cold.selected?.dispatch_tuple?.run_id;
        if (typeof selected !== "string" || (parsed.attempt_id !== undefined && parsed.attempt_id !== selected)) {
          return refuse("durable_observation_cannot_wait");
        }
        throw waitRefusal("durable_observation_cannot_wait", parsed.subject, selected);
      }
      const original = review?.original_result ?? cold.selected?.original_result;
      if (original == null) return cold;
      const retained = createObservationOriginals({ workspace, sessionEnv, responseEnv }).read(original, parsed.subject);
      if (retained.carrier.subject !== parsed.subject ||
          retained.carrier.run_id !== (review?.run_id ?? cold.selected.dispatch_tuple.run_id) ||
          (review !== undefined && retained.carrier.role !== review.role)) {
        return refuse("observation_original_attempt_mismatch");
      }
      const { status, terminal, exit, final_result } = retained.carrier;
      const failures = Object.fromEntries(["completion_failure", "completion_settlement_failure",
        "result_publication", "final_result_publication_failure"]
        .filter(field => retained.carrier[field] !== undefined).map(field => [field, retained.carrier[field]]));
      return { ...(review === undefined ? cold : { ok: true, subject: parsed.subject,
        run_id: review.run_id, role: review.role }), role: retained.carrier.role, status, terminal, exit, final_result,
        ...failures, original_result: original };
    }
    if (selection !== null) return await durable(live.run_id);
    if (parsed.timeout_ms === undefined) {
      if (live.role !== "worker") return live;
      const recorded = await durable(live.run_id);
      return withReceipts(live, recorded);
    }

    if (live.role === "worker") {
      const recorded = await durable(live.run_id);
      if (!recorded.ok) return withReceipts(live, recorded);
      if (recorded.selected.released) throw waitRefusal("released_attempt_cannot_wait", parsed.subject, live.run_id);
    }
    const waited = await backend.waitForRunStatus({ ...input, attempt_id: live.run_id, timeout_ms: parsed.timeout_ms });
    if (live.role !== "worker" || waited?.accepted !== true) return waited;
    const recorded = await durable(live.run_id);
    return withReceipts(waited, recorded);
  };
}
