

import { classifyAgentDispatchSubject } from "./dispatch-tool-helpers.mjs";
import { resolveLauncherRunState } from "./launcher-run-credential.mjs";
import { terminalCandidateVerifyProofCall } from "./verify-proof-candidate-call.mjs";
import { projectAuthenticatedTerminalCandidateFailure } from "./dispatch-terminal-candidate-coordinator.mjs";

const shortFact = (value) => typeof value === "string" && value.length > 0
  ? value : null;

function unavailableCause(error) {
  const candidate = projectAuthenticatedTerminalCandidateFailure(error);
  return { code: shortFact(error?.code),
    reason: shortFact(error?.detail?.reason) ?? shortFact(error?.message),
    ...(candidate.kind !== "typed_candidate_error" ? {}
      : { candidate_failure: { code: candidate.code, detail: candidate.detail } }) };
}

function observedWorkerTuple(observation) {
  if (observation?.accepted === true) {
    return observation.role === "worker" && observation.terminal === true
      ? { subject: observation.subject, run_id: observation.run_id,
        monitor_handle: observation.monitor_handle } : null;
  }
  const tuple = observation?.ok === true ? observation.selected?.dispatch_tuple : null;
  return tuple == null ? null
    : { subject: tuple.assigned_unit, run_id: tuple.run_id, monitor_handle: tuple.launch_ref };
}

export function createCandidateVerificationObservation({ workspace, sessionEnv, preparedDispatchBackend }) {
  return async function observe(request, observation) {
    const backend = preparedDispatchBackend;
    if (typeof backend?.observeCompletedIntegrationCandidate !== "function" ||
        classifyAgentDispatchSubject(request.subject) !== "work_record_slice") return undefined;
    const tuple = observedWorkerTuple(observation);
    if (tuple === null || tuple.subject !== request.subject ||
        typeof tuple.run_id !== "string" || typeof tuple.monitor_handle !== "string") return undefined;
    let lifecycle;
    try {
      lifecycle = await backend.observeCompletedIntegrationCandidate({ subject: tuple.subject, status: tuple });
    } catch (error) {
      return { state: "unavailable", cause: unavailableCause(error) };
    }
    const call = terminalCandidateVerifyProofCall({ sessionRole: resolveLauncherRunState(sessionEnv).role,
      repository: workspace.repo, subject: tuple.subject, lifecycle });
    return call === null ? undefined : { state: "offered", candidate: call.arguments.git_sha, call };
  };
}
