

import { realpathSync } from "node:fs";
import { createObservationOriginals } from "./task-get-run-result-delivery.mjs";
import path from "node:path";
import { z } from "zod";
import { readManagedRunObservation } from
  "../../../agent-launch-cli/src/lib/managed-run-process-identity-store.mjs";
import { classifyAgentDispatchSubject } from "./dispatch-tool-helpers.mjs";
import { RUN_WAIT_TIMEOUT_MS_BOUNDS } from "./dispatch-monitor-call-deadline.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
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
      return readManagedRunObservation({ mainRepo, subject, sliceBinding });
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
        ...(selection === null ? { includeProofSummary: true, includeReviewOriginal: true }
          : { detail: selection, includeVerifiedSource: true }) });
      } catch (error) {
        return { ok: false, code: error.code, observation_failure: error };
      }
    };
    const withReceipts = (status, recorded) => {
      if (!recorded.ok) return { ...status, proof_detail: recorded, delivery: { available: false, references: [],
        cause: recorded.refusal ?? { code: recorded.code } } };
      const receipts = recorded.selected.delivery_receipts;
      return { ...status, proof_detail: recorded.proof_detail,
        ...(receipts.length === 0 ? {} : { delivery_receipts: receipts }) };
    };
    if (live?.accepted !== true) {
      if (!["attempt_observation_unavailable", "unknown_run_or_handle"].includes(live?.refusal?.reason)) return live;
      const cold = await durable(parsed.attempt_id ?? null);
      if (!cold.ok || selection !== null) return cold;
      if (parsed.timeout_ms !== undefined) return refuse("durable_observation_cannot_wait");

      const review = cold.review;
      const original = review?.original_result ?? cold.selected?.original_result;
      if (original == null) return cold;
      const retained = createObservationOriginals({ workspace, sessionEnv, responseEnv }).read(original, parsed.subject);
      if (retained.carrier.subject !== parsed.subject ||
          retained.carrier.run_id !== (review?.run_id ?? cold.selected.dispatch_tuple.run_id) ||
          (review !== undefined && retained.carrier.role !== review.role)) {
        return refuse("observation_original_attempt_mismatch");
      }
      return review === undefined ? { ...cold, original_result: original }
        : { ok: true, subject: parsed.subject, run_id: review.run_id, role: review.role, original_result: original };
    }
    if (selection !== null) return await durable(live.run_id);
    if (parsed.timeout_ms === undefined) {
      if (live.role !== "worker") return live;
      const recorded = await durable(live.run_id);
      return withReceipts(live, recorded);
    }

    if (live.role === "worker") {
      const recorded = await durable(live.run_id);
      if (!recorded.ok) return recorded;
      if (recorded.selected.released) return refuse("released_attempt_cannot_wait");
    }
    const waited = await backend.waitForRunStatus({ ...input, attempt_id: live.run_id, timeout_ms: parsed.timeout_ms });
    if (live.role !== "worker" || waited?.accepted !== true) return waited;
    const recorded = await durable(live.run_id);
    return withReceipts(waited, recorded);
  };
}
