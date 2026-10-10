

import { EXACT_IMPLEMENTATION_SLICE_RE } from "./backend-constants.mjs";

export function createCompletedIntegrationCandidateObservation({
  resolveCommittedSliceIntegrationContinuation,
  observeTerminalCandidate
}) {
  return async function observeCompletedIntegrationCandidate({ subject, status } = {}) {
    if (typeof observeTerminalCandidate !== "function" ||
        typeof subject !== "string" || !EXACT_IMPLEMENTATION_SLICE_RE.test(subject)) {
      return null;
    }
    const continuation = await resolveCommittedSliceIntegrationContinuation({ subject, status });
    if (continuation?.completed !== true) return null;

    const integration = continuation.completed_integration ?? continuation.integration;
    if (integration?.integrated !== true || typeof integration.wk_sha !== "string") return null;
    const candidate = await observeTerminalCandidate(subject.split("#")[0]);
    const binding = candidate?.binding;
    const materialization = candidate?.materialization;
    if (binding === null || typeof binding !== "object" ||
        materialization === null || typeof materialization !== "object" ||
        binding.wk_tip !== integration.wk_sha) {
      return null;
    }

    return Object.freeze({
      invoked: false,
      phase: "finalized",
      integrated: true,
      integration,
      terminal_candidate: Object.freeze({ binding, materialization })
    });
  };
}
