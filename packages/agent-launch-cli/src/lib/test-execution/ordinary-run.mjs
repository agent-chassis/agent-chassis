

import { assertTestProofExecutionBudget } from "./confined-capture.mjs";
import { runOrdinaryTestFile } from "./ordinary-test-runner.mjs";

export const ORDINARY_COMPARISON_STATES = Object.freeze({
  NOT_REQUESTED: "not_requested",
  NOT_ELIGIBLE: "not_eligible",
  UNAVAILABLE: "unavailable",
  ATTEMPTED: "attempted"
});

export function ordinaryComparisonIneligibility(result, { sourceCurrent = true, budget = null } = {}) {
  if (result?.status !== "executed") return result?.status === "not_run" ? "not_run" : result?.status ?? "not_run";
  const run = result.run;
  if (run?.ran !== true) return "not_run";
  if (run.ok === true || run.exit_code === 0) return "candidate_succeeded";
  if (run.timed_out === true) return "timed_out";
  if (run.cancelled === true) return "cancelled";
  if (run.signal !== null && run.signal !== undefined) return "signal_terminated";
  if (!Number.isSafeInteger(run.exit_code)) return "not_run";
  if (run.output_truncated === true) return "output_lost";
  if (run.cleanup_failed === true) return "cleanup_unsafe";
  if (!sourceCurrent) return "source_moved";
  if (budget !== null && (budget.interruption() !== null || budget.remainingMs() === 0)) return "budget_expired";
  return null;
}

export async function runOrdinaryTestWithComparison({ request, candidate, compareParent = false, resolveBaseline,
  budget, timeoutMs, runFile = runOrdinaryTestFile }) {
  assertTestProofExecutionBudget(budget);
  const ordinary = (source) => runFile({ repositoryRoot: source.repositoryRoot, checkoutRoot: source.checkoutRoot,
    target: request.target, runner: request.runner, environment: request.environment ?? null,
    selector: request.selector ?? null, timeoutMs, budget });
  const candidateResult = await ordinary(candidate);
  const candidateSource = Object.freeze({ ...candidate.current(candidateResult) });
  const settledCandidate = Object.freeze({ result: candidateResult, source: candidateSource });
  if (compareParent !== true) {
    return Object.freeze({ candidate: settledCandidate,
      comparison: Object.freeze({ state: ORDINARY_COMPARISON_STATES.NOT_REQUESTED }) });
  }
  const ineligible = ordinaryComparisonIneligibility(candidateResult,
    { sourceCurrent: candidateSource.current === true, budget });
  if (ineligible !== null) {
    return Object.freeze({ candidate: settledCandidate,
      comparison: Object.freeze({ state: ORDINARY_COMPARISON_STATES.NOT_ELIGIBLE, reason: ineligible }) });
  }
  const baseline = resolveBaseline();
  if (baseline?.status !== "available") {
    return Object.freeze({ candidate: settledCandidate, comparison: Object.freeze({
      state: ORDINARY_COMPARISON_STATES.UNAVAILABLE, reason: baseline?.reason ?? "baseline_unavailable",
      ...(baseline?.detail === undefined ? {} : { detail: baseline.detail }) }) });
  }
  const baselineResult = await ordinary(baseline);
  return Object.freeze({ candidate: settledCandidate, comparison: Object.freeze({
    state: ORDINARY_COMPARISON_STATES.ATTEMPTED,
    baseline: Object.freeze({ commit: baseline.commit, result: baselineResult,
      source: Object.freeze({ ...baseline.current(baselineResult) }) }) }) });
}
