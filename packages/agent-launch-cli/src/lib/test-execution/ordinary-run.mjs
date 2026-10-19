

import { assertTestProofExecutionBudget } from "./confined-capture.mjs";
import { runOrdinaryTest } from "./ordinary-test-glob.mjs";

export const ORDINARY_COMPARISON_STATES = Object.freeze({
  NOT_ELIGIBLE: "not_eligible",
  UNAVAILABLE: "unavailable",
  ATTEMPTED: "attempted"
});

function failureFacts(error, stage) {
  return Object.freeze({ stage, code: typeof error?.code === "string" ? error.code : null,
    message: String(error?.message ?? error), detail: error?.detail ?? null });
}

async function observeCurrentness(source, result, stage) {
  try {
    return Object.freeze({ ...await source.current(result) });
  } catch (error) {
    return Object.freeze({ current: null, status: "unknown", ...failureFacts(error, stage) });
  }
}

export function ordinaryComparisonIneligibility(result, { budget = null } = {}) {
  if (Array.isArray(result?.files)) {
    if (result.status !== "completed") return result.stopped ?? result.status;
    let failed = false;
    for (const { result: file } of result.files) {
      if (file.status === "covered") continue;
      const reason = ordinaryComparisonIneligibility(file);
      if (reason === "candidate_succeeded") continue;
      if (reason !== null) return reason;
      failed = true;
    }
    if (!failed) return "candidate_succeeded";
    if (budget !== null && (budget.interruption() !== null || budget.remainingMs() === 0)) return "budget_expired";
    return null;
  }
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
  if (budget !== null && (budget.interruption() !== null || budget.remainingMs() === 0)) return "budget_expired";
  return null;
}

export async function runOrdinaryTestWithComparison({ request, candidate, resolveBaseline,
  budget, timeoutMs, runFile = runOrdinaryTest }) {
  assertTestProofExecutionBudget(budget);
  const ordinary = (source) => runFile({ repositoryRoot: source.repositoryRoot, checkoutRoot: source.checkoutRoot,
    ...(request.harness === undefined ? { target: request.target, runner: request.runner,
      selector: request.selector ?? null } : { harness: request.harness }),
    environment: request.environment ?? null, timeoutMs, budget },
  ...(source.targets === undefined ? [] : [{ targets: source.targets }]));
  const candidateResult = await ordinary(candidate);
  const candidateSource = await observeCurrentness(candidate, candidateResult, "candidate_currentness");
  const settledCandidate = Object.freeze({ result: candidateResult, source: candidateSource });
  const ineligible = ordinaryComparisonIneligibility(candidateResult, { budget });
  if (ineligible !== null) {
    return Object.freeze({ candidate: settledCandidate,
      comparison: Object.freeze({ state: ORDINARY_COMPARISON_STATES.NOT_ELIGIBLE, reason: ineligible }) });
  }
  let baseline;
  try {
    baseline = await resolveBaseline();
  } catch (error) {
    return Object.freeze({ candidate: settledCandidate, comparison: Object.freeze({
      state: ORDINARY_COMPARISON_STATES.UNAVAILABLE, reason: "baseline_resolution_failed",
      failure: failureFacts(error, "baseline_resolution") }) });
  }
  if (baseline?.status !== "available") {
    return Object.freeze({ candidate: settledCandidate, comparison: Object.freeze({
      state: ORDINARY_COMPARISON_STATES.UNAVAILABLE, reason: baseline?.reason ?? "baseline_unavailable",
      ...(baseline?.detail === undefined ? {} : { detail: baseline.detail }) }) });
  }
  let comparison;
  try {
    if (baseline.definitionRefusal !== undefined) throw baseline.definitionRefusal;
    const baselineResult = await ordinary(baseline);
    comparison = {
      state: ORDINARY_COMPARISON_STATES.ATTEMPTED,
      baseline: Object.freeze({ commit: baseline.commit, dirty: baseline.dirty, result: baselineResult,
        source: await observeCurrentness(baseline, baselineResult, "baseline_currentness") }) };
  } catch (error) {
    comparison = {
      state: ORDINARY_COMPARISON_STATES.UNAVAILABLE, reason: baseline.definitionRefusal === undefined ? "baseline_execution_failed" : "baseline_definition_authorization_failed",
      failure: failureFacts(error, baseline.definitionRefusal === undefined ? "baseline_execution" : "baseline_definition_authorization"),
      baseline: Object.freeze({ commit: baseline.commit, dirty: baseline.dirty, result: null,
        source: Object.freeze({ current: null }) }) };
  }
  try {
    await baseline.cleanup?.({ primaryErrorCode: comparison.failure?.code ?? null });
  } catch (error) {
    const cleanup = failureFacts(error, "baseline_cleanup");
    comparison = { ...comparison, state: ORDINARY_COMPARISON_STATES.UNAVAILABLE,
      reason: comparison.reason ?? "baseline_cleanup_failed",
      failure: comparison.failure === undefined ? cleanup : Object.freeze({ ...comparison.failure,
        detail: { ...comparison.failure.detail, cleanup_failure: cleanup } }) };
  }
  return Object.freeze({ candidate: settledCandidate, comparison: Object.freeze(comparison) });
}
