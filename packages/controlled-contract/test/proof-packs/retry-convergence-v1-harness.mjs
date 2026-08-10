const DOMAINS = Object.freeze({
  "multipart-upload": { input: { upload: "u7" }, effect: "object:o7", expected: { object: "complete" } },
  "schema-migration": { input: { migration: 42 }, effect: "revision:42", expected: { revision: 42 } },
  "message-projection": { input: { message: "m9" }, effect: "projection:p9", expected: { projected: true } }
});
const MUTATIONS = Object.freeze({
  "retry-before-settlement": (run) => { run.retryIndex = 2; run.settlementIndex = 3; },
  "surviving-residue": (run) => { run.residue = ["residue:survivor"]; },
  "failed-attempt-effect": (run) => { run.finalEffects = [{ attempt: "failed", id: run.finalEffects[0].id }]; },
  "duplicate-final-effect": (run) => { run.finalEffects.push({ attempt: "retry", id: "effect:duplicate" }); },
  "different-input": (run) => { run.retryInput = { different: true }; },
  "wrong-state": (run) => { run.finalState = { wrong: true }; },
  "false-success": (run) => { run.retrySucceeded = false; }
});
function executeRetryConvergence({ domain = "multipart-upload", mutant = null } = {}) {
  const selected = DOMAINS[domain];
  if (!selected) throw new TypeError(`unknown retry-convergence domain: ${domain}`);
  const run = { domain, attempts: ["failed", "retry"], failedInput: structuredClone(selected.input),
    retryInput: structuredClone(selected.input), failedAccepted: false, failureIndex: 1,
    cleanupIndex: 2, settlementIndex: 3, retryIndex: 4, successIndex: 5,
    residue: [], retrySucceeded: true,
    finalEffects: [{ attempt: "retry", id: selected.effect }],
    finalState: structuredClone(selected.expected), expectedState: structuredClone(selected.expected) };
  if (mutant !== null) {
    const mutate = MUTATIONS[mutant];
    if (!mutate) throw new TypeError(`unknown retry-convergence mutant: ${mutant}`);
    mutate(run);
  }
  return run;
}
function retryConvergenceGuaranteeSatisfied(run) {
  return run.attempts.length === 2 && run.attempts[0] === "failed" && run.attempts[1] === "retry" &&
    JSON.stringify(run.failedInput) === JSON.stringify(run.retryInput) && !run.failedAccepted &&
    run.failureIndex < run.cleanupIndex && run.cleanupIndex < run.settlementIndex &&
    run.settlementIndex < run.retryIndex && run.retryIndex < run.successIndex &&
    run.residue.length === 0 && run.retrySucceeded && run.finalEffects.length === 1 &&
    run.finalEffects[0].attempt === "retry" &&
    JSON.stringify(run.finalState) === JSON.stringify(run.expectedState);
}
export { DOMAINS, MUTATIONS, executeRetryConvergence, retryConvergenceGuaranteeSatisfied };
